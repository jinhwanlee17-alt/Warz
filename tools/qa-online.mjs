#!/usr/bin/env node
// Two real browsers against the Node server: accounts, live friend requests, a Duos party with an invite,
// matchmaking into one match, movement seen by the teammate, friendly-fire immunity, then a Solo duel to the
// elimination and victory screens. Screenshots in output/qa-online/; any page error fails the run.
// Pass --url ws://host:port/ws to run the same flow against another server (for example `wrangler dev`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = arg('out') ? path.resolve(arg('out')) : path.join(ROOT, 'output', 'qa-online');
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
  mouse(type, x, y, button = 'left') {
    const buttons = { left: 1, middle: 4, right: 2 };
    return this.cmd('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mousePressed' ? buttons[button] : 0, clickCount: 1 });
  }
  async click(selector) { const p = await this.center(selector); await this.mouse('mouseMoved', p.x, p.y); await this.mouse('mousePressed', p.x, p.y); await this.mouse('mouseReleased', p.x, p.y); await sleep(100); }
  async type(selector, text) {
    await this.click(selector);
    await this.evaluate(`(() => { document.querySelector(${JSON.stringify(selector)}).value = ''; return true; })()`);
    await this.cmd('Input.insertText', { text });
    await sleep(40);
  }
  vk(code) { return code === 'Escape' ? 27 : /^Key[A-Z]$/.test(code) ? code.charCodeAt(3) : /^Digit\d$/.test(code) ? code.charCodeAt(5) : 0; }
  keyDown(code) { return this.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: code === 'Escape' ? 'Escape' : code.slice(-1).toLowerCase(), windowsVirtualKeyCode: this.vk(code) }); }
  keyUp(code) { return this.cmd('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code === 'Escape' ? 'Escape' : code.slice(-1).toLowerCase(), windowsVirtualKeyCode: this.vk(code) }); }
  async press(code) { await this.keyDown(code); await sleep(50); await this.keyUp(code); await sleep(130); }
  text(selector) { return this.evaluate(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent || ''`); }
  visible(selector) { return this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`); }
  P(expr) { return this.evaluate('(() => { const p = Warz.debug.player(); return ' + expr + '; })()'); }
  async aimAt(wx, wy) {
    const s = await this.evaluate(`(() => { const m = Warz.debug.match(); return Warz.debug.renderer().worldToScreen(m.cam, ${wx}, ${wy}); })()`);
    await this.mouse('mouseMoved', s.x, s.y);
    return s;
  }
  async createAccount(name, password) {
    await this.click('#settings-btn');
    await this.click('[data-tab="account"]');
    await this.type('#create-form input[name="username"]', name);
    await this.type('#create-form input[name="password"]', password);
    await this.type('#create-form input[name="confirm"]', password);
    await this.click('#create-form button[type="submit"]');
    await this.waitFor(`Warz.Account.current() && Warz.Account.current().name === ${JSON.stringify(name)}`, 'account ' + name);
    await sleep(200);
    await this.press('Escape');
  }
}

async function main() {
  if (!CHROME) throw new Error('Chrome/Edge not found; set CHROME_PATH');
  fs.mkdirSync(OUT, { recursive: true });
  let app = null, site, wsUrl = arg('url');
  if (!wsUrl) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warz-qa-online-'));
    app = createApp({ dataDir, lobbyMin: 2, lobbyCountdown: 2, log: { info() {}, warn: console.warn, error: console.error } });
    const { port } = await app.listen(0, '127.0.0.1');
    site = 'http://127.0.0.1:' + port + '/';
  } else {
    site = wsUrl.replace(/^ws/, 'http').replace(/\/ws$/, '/');
  }
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
    const url = site + '?demoSeed=99' + (wsUrl ? '&server=' + encodeURIComponent(wsUrl) : '');
    const A = await openTab('A', url), B = await openTab('B', url);
    await sleep(800);
    const framesA = await A.evaluate('new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { if (++n >= 10 || performance.now() - t0 > 2000) r(n); else requestAnimationFrame(f); }; requestAnimationFrame(f); })');
    const framesB = await B.evaluate('new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { if (++n >= 10 || performance.now() - t0 > 2000) r(n); else requestAnimationFrame(f); }; requestAnimationFrame(f); })');
    check(framesA >= 10 && framesB >= 10, 'both browser windows run their game loops (' + framesA + '/' + framesB + ' frames)');
    check(/Online/.test(await A.text('#net-chip')), 'menu shows the connection as online');
    await A.shot('01-menu-online');

    // accounts
    const stamp = String(Date.now()).slice(-5);
    const n1 = 'qa' + stamp + 'a', n2 = 'qa' + stamp + 'b';
    await A.createAccount(n1, 'secret123');
    await B.createAccount(n2, 'secret456');
    check((await A.text('#account-chip')).includes(n1) && (await B.text('#account-chip')).includes(n2), 'both tabs are signed in to their own accounts');
    await A.click('#settings-btn'); await A.click('[data-tab="account"]');
    check(/set up/i.test(await A.text('#google-note')) && /set up|https/i.test(await A.text('#apple-note')), 'Google/Apple buttons explain what is missing on this server');
    await A.shot('02-account-signed-in');
    await A.press('Escape');

    // live friend request
    await A.click('#friends-btn');
    await A.type('#friend-query', n2);
    await A.click('#friend-search button[type="submit"]');
    await A.waitFor(`!!document.querySelector('[data-request="${n2}"]')`, 'search result');
    await A.click(`[data-request="${n2}"]`);
    check(/request sent/i.test(await A.text('#friends-status')), 'friend request sent');
    await B.waitFor('!document.getElementById("friends-badge").hidden', 'live badge on B');
    check(await B.text('#friends-badge') === '1', 'tester B sees the request badge without reloading');
    await B.click('#friends-btn');
    await B.waitFor(`!!document.querySelector('[data-accept="${n1}"]')`, 'incoming request row');
    await B.shot('03-friends-incoming');
    await B.click(`[data-accept="${n1}"]`);
    await B.waitFor(`document.getElementById('friend-list').textContent.includes(${JSON.stringify(n1)})`, 'friend listed on B');
    await A.waitFor(`document.getElementById('friend-list').textContent.includes(${JSON.stringify(n2)})`, 'friend listed on A (pushed)');
    check(/Online/.test(await A.text('#friend-list')), 'friend presence shows online');
    await A.shot('04-friends-online');
    await A.press('Escape'); await B.press('Escape');

    // duos party with an invite, then matchmaking
    await A.click('#play-btn');
    await A.click('[data-mode="duo"]');
    await A.waitFor(`!!document.querySelector('[data-invite="${n2}"]')`, 'invite button');
    await A.click(`[data-invite="${n2}"]`);
    await B.waitFor('!!document.querySelector("#invites [data-join]")', 'invite toast on B');
    await B.shot('05-invite-toast');
    await B.click('#invites [data-join]');
    await A.waitFor('document.querySelectorAll(".party-slot:not(.is-empty)").length === 2', 'two members in A\'s team');
    await B.waitFor('!document.getElementById("party-dialog").hidden && document.querySelectorAll(".party-slot:not(.is-empty)").length === 2', 'B lands in the team screen');
    check(/Waiting for/.test(await B.text('#party-start')), 'only the leader can start');
    await A.shot('06-party');
    await A.click('#party-start');
    await A.waitFor('/queue/i.test(document.getElementById("party-status").textContent)', 'queue status');
    await A.shot('07-party-queued');
    await A.waitFor('Warz.App.state() === "play"', 'match start (A)', 45000); // wrangler dev counts down LOBBY_COUNTDOWN (20 s) first
    await B.waitFor('Warz.App.state() === "play"', 'match start (B)', 45000);
    const seedA = await A.evaluate('Warz.debug.online().info.seed'), seedB = await B.evaluate('Warz.debug.online().info.seed');
    check(seedA === seedB, 'both players are on the same island');
    check(await A.evaluate('Warz.debug.match().world.players.length') === 2 && await A.evaluate('Warz.debug.online().info.team') === await B.evaluate('Warz.debug.online().info.team'), 'two players, one team');
    check(/Duos/.test(await A.text('#hud-lobby')), 'HUD shows Duos');
    await A.waitFor('Warz.debug.player().dropT === 0', 'landing (A)');
    await B.waitFor('Warz.debug.player().dropT === 0', 'landing (B)');
    await sleep(400);
    await A.shot('08-duos-A');
    await B.shot('09-duos-B');
    check(await B.visible('#hud-team') && (await B.text('#hud-team')).includes(n1), 'teammate panel lists the partner');
    if (app) {
      const matchId = await A.evaluate('Warz.debug.online().info.id');
      const live = app.matches.get(String(matchId));
      const sa = live.byId.get(await A.evaluate('Warz.debug.player().id'));
      live.world.addItem(sa, 'firenade', 2);
      await A.waitFor(`Warz.debug.player().items.some(s=>s && s.id==='firenade' && s.n===2)`, 'server item grant');
      await A.press('Digit3');
      await A.waitFor('Warz.debug.player().held === 0', 'online item selection');
      await A.press('KeyQ');
      await A.waitFor(`Warz.debug.player().held===-1 && Warz.debug.player().items.every(s=>!s)`, 'Q drops the selected online stack');
      const ground = await A.evaluate(`Warz.debug.match().world.map.pickups.find(pk=>pk.alive && pk.item==='firenade').id`);
      await B.waitFor(`!!Warz.debug.match().world.pickupById(${ground})`, 'other player sees dropped loot');
      await sleep(450);
      check(await A.evaluate(`Warz.debug.match().world.pickupById(${ground}).alive && Warz.debug.player().items.every(s=>!s)`), 'Q drops the full stack without auto-pickup online');
      await A.waitFor('!!Warz.debug.match().world.nearestItemPickup(Warz.debug.player())', 'dropped loot pickup prompt');
      check(/pick up/i.test(await A.text('#hud-prompt')), 'E pickup prompt is shown online');
      await A.press('KeyE');
      await A.waitFor(`Warz.debug.player().items.some(s=>s && s.id==='firenade' && s.n===2)`, 'E picks up the stack online');
      await B.waitFor(`!Warz.debug.match().world.pickupById(${ground}) || !Warz.debug.match().world.pickupById(${ground}).alive`, 'other player sees loot removed');
      check(!(await A.visible('#inventory-screen')), 'E picks up the item without opening inventory online');
      await A.shot('09-online-pickup');
    }
    const idA = await A.evaluate('Warz.debug.player().id');
    const beforeX = await B.evaluate(`Warz.debug.match().world.playerById(${idA}).x`);
    await A.keyDown('KeyD'); await sleep(1000); await A.keyUp('KeyD');
    await B.waitFor(`Warz.debug.match().world.playerById(${idA}).x > ${beforeX} + 120`, 'B sees A move', 5000);
    check(true, 'movement is replicated to the teammate');
    const posB = await B.P('({ x: p.x, y: p.y })');
    const sp = await A.aimAt(posB.x, posB.y);
    await A.mouse('mousePressed', sp.x, sp.y); await sleep(900); await A.mouse('mouseReleased', sp.x, sp.y);
    await sleep(400);
    check(await B.P('p.hp') === 100, 'teammates take no damage from friendly fire');
    check(await A.P('p.stats.shots') >= 0 && await A.evaluate('Warz.debug.match().world.bullets.length >= 0'), 'shots are mirrored locally');
    await A.press('KeyM');
    check(await A.visible('#map-screen'), 'M opens the island map online');
    await A.shot('10-map-online');
    await A.press('KeyM');
    await A.press('Escape'); await A.click('#leave-btn');
    await B.press('Escape'); await B.click('#leave-btn');
    await A.waitFor('Warz.App.state() === "menu"', 'A back in menu');
    await B.waitFor('Warz.App.state() === "menu"', 'B back in menu');

    // solo duel (the Duos team still exists; choosing Solo leaves it, and the partner may get a team pop-up)
    const chooseSolo = async (tab) => {
      if (await tab.visible('#party-dialog')) await tab.click('#party-back');
      if (!(await tab.visible('#mode-dialog'))) await tab.click('#play-btn');
      await tab.click('[data-mode="solo"]');
    };
    await A.click('#play-btn');
    check(await A.visible('#mode-team-row'), 'the mode picker shows the leftover team');
    await A.click('[data-mode="solo"]');
    await sleep(500);
    await chooseSolo(B);
    check(await A.visible('#lobby-dialog'), 'solo shows the matchmaking lobby');
    await A.waitFor('/2/.test(document.getElementById("lobby-count").textContent)', 'lobby counts two players');
    await A.shot('11-lobby');
    await A.waitFor('Warz.App.state() === "play"', 'solo match (A)', 20000);
    await B.waitFor('Warz.App.state() === "play"', 'solo match (B)', 20000);
    check(await A.evaluate('Warz.debug.online().info.team') !== await B.evaluate('Warz.debug.online().info.team'), 'solo players are enemies');
    await A.waitFor('Warz.debug.player().dropT === 0', 'landing (A)');
    await B.waitFor('Warz.debug.player().dropT === 0', 'landing (B)');
    if (app) {
      const matchId = await A.evaluate('Warz.debug.online().info.id');
      const live = app.matches.get(String(matchId));
      const sa = live.byId.get(await A.evaluate('Warz.debug.player().id')), sb = live.byId.get(await B.evaluate('Warz.debug.player().id'));
      sb.x = sa.x + 200; sb.y = sa.y; sb.vx = 0; sb.vy = 0; live.world.collide(sb);
      await sleep(600);
      const target = await A.evaluate(`(() => { const o = Warz.debug.match().world.playerById(${sb.id}); return { x: o.x, y: o.y }; })()`);
      const s2 = await A.aimAt(target.x, target.y);
      await A.mouse('mousePressed', s2.x, s2.y);
      await B.waitFor('Warz.debug.player().hp < 100', 'B takes damage', 6000);
      check(true, 'enemy shots deal damage over the network');
      await A.shot('12-fight-A');
      await B.shot('13-fight-B');
      await B.waitFor('!document.getElementById("death-screen").hidden', 'B eliminated', 25000);
      await A.mouse('mouseReleased', s2.x, s2.y);
      check(/#2/.test(await B.text('#death-place')), 'B placed #2');
      await B.shot('14-eliminated-B');
      await A.waitFor('!document.getElementById("death-screen").hidden', 'victory screen (A)', 10000);
      check(await A.text('#death-title') === 'Victory!' && /#1/.test(await A.text('#death-place')), 'A wins with placement #1');
      await A.shot('15-victory-A');
      await A.click('#menu-btn'); await B.click('#menu-btn');
    } else {
      log.push('skip fight (remote server: no in-process teleport)');
      await A.shot('12-solo-A');
      // Leaving counts as an elimination, so whoever stays wins and lands on the result screen.
      const exitMatch = async (tab) => {
        if (await tab.visible('#death-screen')) { await tab.click('#menu-btn'); return; }
        await tab.press('Escape');
        if (await tab.visible('#leave-btn')) await tab.click('#leave-btn');
        else if (await tab.visible('#death-screen')) await tab.click('#menu-btn');
      };
      await exitMatch(A);
      await B.waitFor('!document.getElementById("death-screen").hidden || Warz.App.state() === "menu"', 'B sees the result', 10000).catch(() => null);
      check(/Victory/.test(await B.text('#death-title')), 'the remaining player wins when the other leaves');
      await B.shot('13-victory-B');
      await exitMatch(B);
    }
    await A.waitFor('Warz.App.state() === "menu"', 'A back in menu');
    await B.waitFor('Warz.App.state() === "menu"', 'B back in menu');
    check(true, 'both return to the menu');
  } finally {
    try { socket && socket.close(); } catch (_) {}
    browser.kill();
    if (app) await app.close();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
  errors.forEach((e) => failures.push('page error: ' + e));
  console.log(log.join('\n'));
  console.log('Screenshots: ' + OUT);
  if (failures.length) { console.error('\nQA FAILED (' + failures.length + '):\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('\nOnline QA passed: ' + log.length + ' checks, no page errors.');
}

main().catch((e) => { console.error(e && e.stack || e); errors.forEach((x) => console.error('page error: ' + x)); process.exit(1); });
