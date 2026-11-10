#!/usr/bin/env node
// Real browsers against the Node server with bots switched on: the lobby that is always 50 strong (one bot out for
// every player in), a Solo match of two people and 48 bots as a client sees it, being eliminated by a bot and
// spectating, then Duos with a bot for a teammate. Screenshots in output/qa-bots/; any page error fails the run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = arg('out') ? path.resolve(arg('out')) : path.join(ROOT, 'output', 'qa-bots');
const CHROME = process.env.CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'
].find((f) => fs.existsSync(f));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [], failures = [], log = [];
const check = (ok, msg) => { log.push((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures.push(msg); };
const fetchJSON = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
});

class Tab {
  constructor(send, sessionId, name) { this.send = send; this.sessionId = sessionId; this.name = name; }
  cmd(method, params) { return this.send(method, params, this.sessionId); }
  async evaluate(expression) {
    const r = await this.cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(this.name + ': ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  }
  async waitFor(expression, what, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await this.evaluate(expression)) return true; await sleep(80); }
    throw new Error(this.name + ': timed out waiting for ' + what);
  }
  async shot(name) {
    const { data } = await this.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
  }
  center(selector) {
    return this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)});
      if (!e || !e.getClientRects().length) throw new Error('missing ' + ${JSON.stringify(selector)});
      e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y);
      if (hit !== e && !e.contains(hit)) throw new Error(${JSON.stringify(selector)} + ' is covered by ' + (hit && (hit.id || hit.className || hit.tagName)));
      return { x, y }; })()`);
  }
  mouse(type, x, y) { return this.cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); }
  async click(selector) { const p = await this.center(selector); await this.mouse('mouseMoved', p.x, p.y); await this.mouse('mousePressed', p.x, p.y); await this.mouse('mouseReleased', p.x, p.y); await sleep(100); }
  vk(code) { return code === 'Escape' ? 27 : /^Key[A-Z]$/.test(code) ? code.charCodeAt(3) : 0; }
  keyDown(code) { return this.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: code === 'Escape' ? 'Escape' : code.slice(-1).toLowerCase(), windowsVirtualKeyCode: this.vk(code) }); }
  keyUp(code) { return this.cmd('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code === 'Escape' ? 'Escape' : code.slice(-1).toLowerCase(), windowsVirtualKeyCode: this.vk(code) }); }
  async press(code) { await this.keyDown(code); await sleep(50); await this.keyUp(code); await sleep(130); }
  text(selector) { return this.evaluate(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent || ''`); }
  visible(selector) { return this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`); }
}

// What the client's own copy of the world says about the players around the local one.
const AROUND = `(() => { const m = Warz.debug.match(), me = Warz.debug.player();
  return m.world.players.filter((o) => o !== me && o.alive && Math.hypot(o.x - me.x, o.y - me.y) < 700).map((o) => ({ id: o.id, name: o.name, x: o.x, y: o.y, team: o.team })); })()`;

async function main() {
  if (!CHROME) throw new Error('Chrome/Edge not found; set CHROME_PATH');
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warz-qa-bots-'));
  const app = createApp({ dataDir, lobbyMin: 1, lobbyCountdown: 8, botFill: 50, log: { info() {}, warn: console.warn, error: console.error } });
  const { port: sitePort } = await app.listen(0, '127.0.0.1');
  const site = 'http://127.0.0.1:' + sitePort + '/';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warz-qa-chrome-'));
  const browser = spawn(CHROME, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    let port;
    for (let i = 0; i < 100 && !port; i++) {
      try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(100); }
    }
    if (!port) throw new Error('Chrome debugging port did not open');
    const version = await fetchJSON('http://127.0.0.1:' + port + '/json/version');
    console.log('Browser: ' + version.Browser + ' · server: ' + site);
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('CDP socket failed')); });
    let id = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      }
      if (msg.method === 'Runtime.exceptionThrown') { const d = msg.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const rid = ++id;
      pending.set(rid, { resolve, reject });
      socket.send(JSON.stringify({ id: rid, method, params, sessionId }));
    });
    async function openTab(name, url) {
      // Each player gets its own window: a background tab's requestAnimationFrame loop is paused, which would freeze that player's game.
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true, width: 1400, height: 820 });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const tab = new Tab(send, sessionId, name);
      await tab.cmd('Page.enable');
      await tab.cmd('Runtime.enable');
      await tab.cmd('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
      await tab.cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 820, deviceScaleFactor: 1, mobile: false });
      await tab.cmd('Page.navigate', { url });
      await tab.waitFor('window.Warz && Warz.App && Warz.App.ready', 'boot');
      await tab.evaluate('document.fonts.ready.then(() => true)');
      await tab.waitFor('Warz.Net.online()', 'connection to the server', 15000);
      await tab.evaluate('Warz.Controls.reset(); true');
      return tab;
    }
    // Out of a match by whichever door is open: the result screen's menu button, or Esc and Leave.
    const exitMatch = async (tab) => {
      if (await tab.visible('#death-screen')) { await tab.click('#menu-btn'); return; }
      await tab.press('Escape');
      if (await tab.visible('#leave-btn')) await tab.click('#leave-btn');
      else if (await tab.visible('#death-screen')) await tab.click('#menu-btn');
    };
    const A = await openTab('A', site + '?demoSeed=99'), B = await openTab('B', site + '?demoSeed=99');
    await sleep(600);

    // ---------------------------------------------------------- the lobby
    await A.click('#play-btn');
    const modeNote = await A.text('#mode-online-note');
    check(/matches have 50 players\./.test(modeNote) && !/\bbots?\b/i.test(modeNote), 'the mode picker describes matches as 50 players');
    await A.shot('01-modes');
    await A.click('[data-mode="solo"]');
    await A.waitFor('!document.getElementById("lobby-dialog").hidden && document.getElementById("lobby-count").textContent === "50"', 'a lobby of 50');
    check(!/\bbots?\b/i.test(await A.text('#lobby-dialog')), 'one person in the queue: the lobby shows all participants as players');
    check(/50 players/.test(await A.text('#lobby-max')) && await A.evaluate('!document.getElementById("lobby-split")'), 'the lobby reads 50 / 50 players with no separate player breakdown');
    await A.waitFor('/Starting in \\d+ s/.test(document.getElementById("lobby-note").textContent)', 'the countdown');
    check(/^Starting in \d+ s\.$/.test(await A.text('#lobby-note')), 'the lobby note shows the countdown');
    await A.shot('02-lobby-1-player-49-bots');
    await B.click('#play-btn');
    await B.click('[data-mode="solo"]');
    await A.waitFor('Warz.Lobby.current() && Warz.Lobby.current().count === 2', 'the second player in A\'s lobby');
    const fill = await A.evaluate('document.getElementById("lobby-fill").style.width');
    check(!/\bbots?\b/i.test(await A.text('#lobby-dialog')) && await A.text('#lobby-count') === '50', 'a second person joins: the lobby still shows 50 players');
    check(parseFloat(fill) === 100 && await A.evaluate('!document.getElementById("lobby-fill-bots")'), 'one full bar represents all 50 players');
    await A.shot('03-lobby-2-players-48-bots');

    // ---------------------------------------------------------- a Solo match with 48 bots
    await A.waitFor('Warz.App.state() === "play"', 'match start (A)', 30000);
    await B.waitFor('Warz.App.state() === "play"', 'match start (B)', 30000);
    const matchId = String(await A.evaluate('Warz.debug.online().info.id'));
    const live = app.matches.get(matchId);
    check(await A.evaluate('Warz.debug.match().world.players.length') === 50 && await B.evaluate('Warz.debug.match().world.players.length') === 50, 'both clients start a match of 50 players');
    check(live.players.filter((p) => p.bot).length === 48, 'on the server: 2 people and 48 bots');
    // (The two players here are guests from one browser profile and may share a name; the bots never do.)
    const names = await A.evaluate('Warz.debug.match().world.players.map((p) => p.name)'), botNames = live.players.filter((p) => p.bot).map((p) => p.name);
    const people = live.players.filter((p) => !p.bot).map((p) => p.name.toLowerCase());
    check(names.length === 50 && botNames.every((n) => names.includes(n)) && new Set(botNames.map((n) => n.toLowerCase())).size === 48 && !botNames.some((n) => people.includes(n.toLowerCase())),
      'the client\'s roster has all 48 bots on it, each with its own name, none of them a player\'s');
    await A.waitFor('/50<\\/b> alive/.test(document.getElementById("hud-lobby").innerHTML) || /\\b50 alive/.test(document.getElementById("hud-lobby").textContent)', 'HUD alive count').catch(() => null);
    const hud = await A.text('#hud-lobby');
    check(/^(4[5-9]|50) alive · 50 players · Solo/.test(hud), 'the HUD counts them: "' + hud + '"');
    await A.waitFor('Warz.debug.player().dropT === 0', 'landing (A)');
    await B.waitFor('Warz.debug.player().dropT === 0', 'landing (B)');
    await sleep(500);
    await A.shot('04-landed');

    // Stand next to a bot: the client draws it and follows it like any other player.
    const sa = live.byId.get(await A.evaluate('Warz.debug.player().id')), sb = live.byId.get(await B.evaluate('Warz.debug.player().id'));
    const nearest = (to) => live.players.filter((p) => p.bot && p.alive && p.dropT <= 0).sort((p, q) => Math.hypot(p.x - to.x, p.y - to.y) - Math.hypot(q.x - to.x, q.y - to.y))[0];
    let bot = nearest(sa);
    sa.x = bot.x + 230; sa.y = bot.y + 40; sa.vx = 0; sa.vy = 0; live.world.collide(sa);
    await A.waitFor(`Warz.debug.match().world.players.some((o) => o.id === ${bot.id} && o.alive && Math.hypot(o.x - Warz.debug.player().x, o.y - Warz.debug.player().y) < 600)`, 'the bot in A\'s world', 5000);
    const first = (await A.evaluate(AROUND)).find((o) => o.id === bot.id);
    check(!!first && first.name === bot.name && Math.hypot(first.x - bot.x, first.y - bot.y) < 120, 'a bot next to the player is in the client\'s world under its name (' + bot.name + ')');
    await sleep(700);
    await A.shot('05-next-to-a-bot');
    // Ten seconds of watching whoever is around: they walk, they shoot crates.
    const track = new Map();
    let shotsSeen = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      for (const o of await A.evaluate(AROUND)) {
        const s = track.get(o.id) || { x0: o.x, y0: o.y, moved: 0, name: o.name };
        s.moved = Math.max(s.moved, Math.hypot(o.x - s.x0, o.y - s.y0));
        track.set(o.id, s);
      }
      shotsSeen = Math.max(shotsSeen, await A.evaluate('Warz.debug.match().world.bullets.length'));
      // Stay with them (the server moves A along with whichever bot is nearest).
      bot = nearest(sa);
      if (Math.hypot(bot.x - sa.x, bot.y - sa.y) > 420) { sa.x = bot.x + 230; sa.y = bot.y + 40; live.world.collide(sa); }
      await sleep(250);
    }
    const movers = [...track.values()].filter((s) => s.moved > 100);
    check(movers.length >= 1, 'bots near the player move about on the client\'s screen (' + movers.map((s) => s.name + ' ' + Math.round(s.moved)).join(', ') + ' units)');
    check(live.bots.errors === 0, 'no bot has thrown on the server');
    await A.shot('06-bots-at-work');
    const frames = await A.evaluate('new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { if (++n >= 30 || performance.now() - t0 > 3000) r({ n, ms: performance.now() - t0 }); else requestAnimationFrame(f); }; requestAnimationFrame(f); })');
    check(frames.n >= 30 && frames.ms < 2500, 'the client keeps its frame rate with 50 players in the match (30 frames in ' + Math.round(frames.ms) + ' ms)');

    // Eliminated by a bot: placement out of 50, the bot's name, and spectating it.
    const killer = nearest(sa), aliveNow = live.players.filter((p) => p.alive).length;
    live.world.damagePlayer(sa, 500, killer.id, 'ar');
    await A.waitFor('!document.getElementById("death-screen").hidden', 'A eliminated', 8000);
    const place = await A.text('#death-place');
    check(new RegExp('^#' + aliveNow + ' of 50 teams · 50 players').test(place), 'eliminated by a bot: the result says "' + place + '"');
    check((await A.text('#death-screen')).includes(killer.name), 'and names the bot that did it (' + killer.name + ')');
    await A.shot('07-eliminated-by-a-bot');
    if (await A.visible('#spectate-btn')) {
      await A.click('#spectate-btn');
      await A.waitFor('!document.getElementById("hud-spectate").hidden', 'spectating');
      check(/Spectating /.test(await A.text('#hud-spectate')), 'the player can stay and watch: "' + (await A.text('#hud-spectate')) + '"');
      await sleep(1500);
      await A.shot('08-spectating-a-bot');
    }
    await exitMatch(A);
    await A.waitFor('Warz.App.state() === "menu"', 'A back in the menu');
    // The other player leaves too: the match winds up instead of running on for the bots.
    live.emptyTimeout = 1.5;
    await exitMatch(B);
    await B.waitFor('Warz.App.state() === "menu"', 'B back in the menu');
    const t1 = Date.now();
    while (app.matches.has(matchId) && !live.ended && Date.now() - t1 < 8000) await sleep(100);
    check(live.ended, 'with both players gone the match ends on the server');
    void sb;

    // ---------------------------------------------------------- Duos with a bot teammate
    await A.click('#play-btn');
    await A.click('[data-mode="duo"]');
    await A.waitFor('!document.getElementById("party-dialog").hidden && document.querySelectorAll(".party-slot").length === 2', 'the team screen');
    const partySlots = await A.text('#party-slots');
    check(/Random player/.test(partySlots) && /Filled by matchmaking/.test(partySlots) && !/\bbots?\b/i.test(partySlots), 'the empty team spot is a random player filled by matchmaking');
    check(await A.text('#party-note') === 'Empty spots get random players. Turn off fill to play with your invites only.', 'the Fill note describes random players');
    await A.shot('09-duos-team');
    await A.click('#party-start');
    await A.waitFor('document.getElementById("party-status").textContent.startsWith("In queue · 50/50 players · ")', 'queue status showing 50 players');
    await A.shot('10-duos-queued');
    await A.waitFor('Warz.App.state() === "play"', 'duos match', 30000);
    const duoId = String(await A.evaluate('Warz.debug.online().info.id')), duo = app.matches.get(duoId);
    const me = duo.byId.get(await A.evaluate('Warz.debug.player().id')), mate = duo.players.find((p) => p.team === me.team && p !== me);
    check(await A.evaluate('Warz.debug.match().world.players.length') === 50 && duo.teamInfo.length === 25, 'the Duos match is 50 players in 25 teams');
    check(!!mate && mate.bot, 'the player\'s teammate is a bot (' + (mate && mate.name) + ')');
    await A.waitFor('Warz.debug.player().dropT === 0', 'landing');
    await sleep(600);
    check(await A.visible('#hud-team') && (await A.text('#hud-team')).includes(mate.name), 'the teammate panel lists it');
    check(/alive · 50 players · Duos/.test(await A.text('#hud-lobby')), 'HUD: "' + (await A.text('#hud-lobby')) + '"');
    await A.shot('11-duos-with-a-bot');
    // Run for a few seconds: the bot comes along.
    await A.keyDown('KeyD'); await sleep(4500); await A.keyUp('KeyD');
    await sleep(1500);
    const gap = Math.hypot(mate.x - me.x, mate.y - me.y);
    check(mate.alive && gap < 700, 'the player runs off across the island and the bot teammate follows (' + Math.round(gap) + ' units behind)');
    await A.shot('12-duos-teammate-follows');
    // Knocked down: the bot comes to revive.
    const foe = duo.players.find((p) => p.team !== me.team && p.alive);
    duo.world.damagePlayer(me, 500, foe.id, 'ar');
    await A.waitFor('Warz.debug.player().downed === true', 'knocked down', 4000);
    await A.shot('13-knocked-down');
    const up = await A.waitFor('Warz.debug.player().downed === false && Warz.debug.player().alive', 'the revive', 20000).then(() => true).catch(() => false);
    check(up && me.alive && !me.downed, 'knocked down, the player is picked back up by the bot teammate');
    await A.shot('14-revived-by-a-bot');
    check(duo.bots.errors === 0, 'no bot has thrown in the Duos match');
    duo.emptyTimeout = 1.5;
    await exitMatch(A);
    await A.waitFor('Warz.App.state() === "menu"', 'back in the menu');
    check(true, 'and back to the menu');
  } finally {
    try { socket && socket.close(); } catch (_) {}
    browser.kill();
    await app.close();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  }
  errors.forEach((e) => failures.push('page error: ' + e));
  console.log(log.join('\n'));
  console.log('Screenshots: ' + OUT);
  if (failures.length) { console.error('\nQA FAILED (' + failures.length + '):\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('\nBots QA passed: ' + log.length + ' checks, no page errors.');
}

main().catch((e) => { console.log(log.join('\n')); console.error(e && e.stack || e); errors.forEach((x) => console.error('page error: ' + x)); process.exit(1); });
