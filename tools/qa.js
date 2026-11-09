#!/usr/bin/env node
'use strict';
// Offline QA against the static dev server (no game server running): settings and rebinding, the mode
// picker's offline state, a full Practice match (map, every class, scope, launcher fuse, medic, storm,
// elimination) and a small window. Screenshots land in output/qa/; any page error fails the run.
// The online flows (accounts, friends, parties, matchmaking) are covered by tools/qa-online.mjs.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const { createServer } = require('./serve');

const OUT = path.resolve(__dirname, '..', 'output', 'qa');
const CHROME = process.env.CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'
].find((f) => fs.existsSync(f));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [], failures = [], log = [];
const check = (ok, msg) => { log.push((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures.push(msg); };

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}

async function main() {
  if (!CHROME) throw new Error('Chrome/Edge not found; set CHROME_PATH');
  fs.mkdirSync(OUT, { recursive: true });
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const site = 'http://127.0.0.1:' + server.address().port + '/';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'warz-qa-'));
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
    console.log('Browser: ' + version.Browser);
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
    const targets = await send('Target.getTargets');
    const target = targets.targetInfos.find((t) => t.type === 'page');
    const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const cmd = (method, params) => send(method, params, sessionId);
    const evaluate = async (expression) => {
      const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
      return r.result.value;
    };
    const waitFor = async (expression, what, ms = 15000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await evaluate(expression)) return true; await sleep(60); }
      throw new Error('Timed out waiting for ' + what);
    };
    const shot = async (name) => {
      const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    };
    const center = async (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)});
      if (!e || !e.getClientRects().length) throw new Error('missing ' + ${JSON.stringify(selector)});
      e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y);
      if (hit !== e && !e.contains(hit)) throw new Error(${JSON.stringify(selector)} + ' is covered by ' + (hit && (hit.id || hit.className || hit.tagName)));
      return { x, y }; })()`);
    const BUTTONS = { left: 1, middle: 4, right: 2 };
    const mouse = (type, x, y, button = 'left') => cmd('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mousePressed' ? BUTTONS[button] : 0, clickCount: 1 });
    const click = async (selector) => { const p = await center(selector); await mouse('mouseMoved', p.x, p.y); await mouse('mousePressed', p.x, p.y); await mouse('mouseReleased', p.x, p.y); await sleep(90); };
    const vk = (code) => code === 'Escape' ? 27 : code === 'Tab' ? 9 : /^Key[A-Z]$/.test(code) ? code.charCodeAt(3) : /^Digit\d$/.test(code) ? code.charCodeAt(5) : 0;
    const keyDown = (code) => cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: code === 'Escape' || code === 'Tab' ? code : code.slice(-1).toLowerCase(), windowsVirtualKeyCode: vk(code) });
    const keyUp = (code) => cmd('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code === 'Escape' || code === 'Tab' ? code : code.slice(-1).toLowerCase(), windowsVirtualKeyCode: vk(code) });
    const press = async (code) => { await keyDown(code); await sleep(50); await keyUp(code); await sleep(130); };
    const text = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent || ''`);
    const visible = (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`);
    const P = (expr) => evaluate('(() => { const p = Warz.debug.player(); return ' + expr + '; })()');
    const aimAt = async (wx, wy) => {
      const s = await evaluate(`(() => { const m = Warz.debug.match(); return Warz.debug.renderer().worldToScreen(m.cam, ${wx}, ${wy}); })()`);
      await mouse('mouseMoved', s.x, s.y);
      return s;
    };
    const fireAt = async (wx, wy, ms) => { const s = await aimAt(wx, wy); await mouse('mousePressed', s.x, s.y); await sleep(ms); await mouse('mouseReleased', s.x, s.y); };
    const nearestCrate = () => evaluate(`(() => { const m = Warz.debug.match(), p = m.player;
      const list = m.world.map.crates.filter(c => c.alive && !m.world.map.buildings.some(b => c.x > b.x - 40 && c.x < b.x + b.w + 40 && c.y > b.y - 40 && c.y < b.y + b.h + 40)
        && !m.world.sweep(c.x - 230, c.y, c.x - c.size / 2 - 40, c.y, 8, p.id) && !m.world.inPond(c.x - 150, c.y));
      list.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)); return { x: list[0].x, y: list[0].y, id: list[0].id }; })()`);
    const readyStation = (skip = 0) => evaluate(`(() => { const m = Warz.debug.match(), p = m.player;
      const list = m.world.map.stations.filter(s => s.cooldown <= 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      const s = list[${skip}]; return { x: s.x, y: s.y, id: s.id }; })()`);
    const goTo = (x, y) => evaluate(`Warz.debug.teleport(${x}, ${y})`);
    const openStationAt = async (st) => {
      await goTo(st.x, st.y + 78);
      await sleep(250);
      await press('KeyE');
      await waitFor('!document.getElementById("upgrade-panel").hidden', 'upgrade panel to open');
      await sleep(300);
    };
    const startPractice = async () => {
      await click('#play-btn');
      check(await visible('#mode-dialog'), 'Play opens the mode picker');
      await click('#practice-btn');
      await sleep(400);
      check(await evaluate('Warz.App.state()') === 'play' && await evaluate('Warz.debug.match().online') === false, 'Practice starts an offline match');
    };

    await cmd('Page.enable');
    await cmd('Runtime.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await cmd('Page.navigate', { url: site + '?seed=4242&demoSeed=99&server=' + encodeURIComponent('ws://127.0.0.1:1/ws') });
    await waitFor('window.Warz && Warz.App && Warz.App.ready', 'game boot');
    await evaluate('document.fonts.ready.then(() => true)');
    await evaluate('Warz.Controls.reset(); true');
    await sleep(1500);

    // ---- menu (offline)
    check(await text('#logo') === 'Warz!', 'menu logo reads Warz!');
    check(/Offline/.test(await text('#net-chip')), 'connection chip shows offline without a server');
    check(await evaluate('(() => { const bots = Warz.debug.demo().world.players; return bots.length === 14 && bots.every(p => p.bot && p.name) && bots.some(p => p.alive); })()'), 'menu background runs fourteen named soldiers (including those waiting to respawn)');
    await shot('01-menu');
    await click('#play-btn');
    check(await visible('#mode-offline-note') && await evaluate('document.querySelectorAll("#mode-list .mode:disabled").length') === 4, 'online modes are disabled while offline, with an explanation');
    await shot('02-modes-offline');
    await press('Escape');

    // ---- settings
    await click('#settings-btn');
    check(await visible('#settings-dialog') && await visible('#tab-controls'), 'Settings opens on the Controls tab');
    check(await evaluate('document.querySelectorAll("#bindings .bind[data-bind]").length') === 38, 'every action (incl. pickup, drop and inventory) has two binding slots');
    await click('[data-bind="reload"][data-slot="0"]');
    await press('KeyT');
    check(await evaluate('Warz.Controls.bindings("reload")[0]') === 'KeyT', 'pressing T rebinds Reload to T');
    await click('[data-bind="map"][data-slot="0"]');
    await press('KeyT');
    check(await evaluate('Warz.Controls.bindings("reload")[0]') === null && await evaluate('Warz.Controls.bindings("map")[0]') === 'KeyT', 'a key can only belong to one action');
    await click('#reset-bindings');
    check(await evaluate('Warz.Controls.bindings("reload")[0]') === 'KeyR', 'reset restores the defaults');
    await shot('03-settings-controls');
    await click('[data-tab="online"]');
    check(/Offline/.test(await text('#server-status')), 'Online tab reports the failed connection');
    await click('[data-tab="account"]');
    check(await visible('#account-offline'), 'Account tab explains accounts need the server');
    await shot('04-settings-offline');
    await press('Escape');
    await click('#friends-btn');
    check(await visible('#friends-offline'), 'Friends explains it needs the server');
    await press('Escape');

    // ---- practice match
    await startPractice();
    check(await evaluate('Warz.debug.match().world.map.stations.length') === 9, '9 upgrade stations on the island');
    check(await evaluate('Warz.debug.match().world.map.bushes.length') === 0, 'no bushes');
    check(await P('p.dropT > 0'), 'player is dropping in');
    await shot('05-dropping');
    await waitFor('Warz.debug.player().dropT === 0', 'landing');
    await sleep(500);
    check(await P('p.classId') === 'soldier' && await P('p.hp') === 100 && await P('p.armor') === 0, 'start as Soldier, 100 HP, 0 armor');
    await shot('06-landed');
    const x0 = await P('p.x');
    await keyDown('KeyD'); await sleep(700); await keyUp('KeyD');
    await sleep(150);
    check(await P('p.x') > x0 + 80, 'D moves right');

    await press('KeyM');
    check(await visible('#map-screen'), 'M opens the island map');
    await shot('07-map');
    await press('KeyM');
    check(!(await visible('#map-screen')), 'M closes the island map');

    const crate = await nearestCrate();
    await goTo(crate.x - 190, crate.y);
    await sleep(200);
    await fireAt(crate.x, crate.y, 450);
    await sleep(80);
    check(await P('p.stats.shots') >= 3, 'clicking fires the AR toward the cursor');
    check(await P('p.stats.crateDamage') > 0 && await P('p.stats.crateDamage') % 10 === 0, 'AR hits deal 10 each');
    await sleep(600);

    const s1 = await readyStation(0);
    await evaluate('Warz.debug.giveTokens(8 - Warz.debug.player().tokens)');
    await openStationAt(s1);
    await shot('08-tree');
    check(await evaluate('document.querySelectorAll("#ut-nodes .ut-node.is-available").length') === 4, 'four lvl 1 classes available');
    await click('#ut-node-sniper');
    await click('#ut-action');
    await sleep(200);
    check(await P('p.classId') === 'sniper' && await P('p.maxHp') === 95, 'upgraded to Sniper (95 HP)');
    await waitFor('document.getElementById("upgrade-panel").hidden', 'panel to close');
    await sleep(1200);
    check(Math.abs((await evaluate('Warz.debug.match().cam.zoom')) - 1) < 0.03, 'holding the sniper rifle does not zoom by itself');
    const sp = await aimAt(await P('p.x') + 300, await P('p.y'));
    await mouse('mousePressed', sp.x, sp.y, 'right');
    await sleep(800);
    check(await P('p.scoping') === true && (await evaluate('Warz.debug.match().cam.zoom')) < 0.85, 'holding right click scopes out');
    await shot('09-scoped');
    await mouse('mouseReleased', sp.x, sp.y, 'right');
    await sleep(800);
    const cool = await evaluate(`Warz.debug.match().world.map.stations[${s1.id}].cooldown`);
    check(cool > 83 && cool <= 90, 'used station recharges for 1:30');

    await press('Escape');
    check(await visible('#pause-menu') && await visible('#test-tools-section'), 'match menu shows test tools in practice');
    await click('[data-test="reset"]'); await click('[data-test="tokens"]'); await click('[data-test="key"]');
    await press('Escape');
    await openStationAt(s1);
    await click('#ut-node-shotgunner');
    check(/station key/i.test(await text('#ut-action')), 'recharging station offers to use the key');
    await click('#ut-action');
    await sleep(200);
    check(await P('p.classId') === 'shotgunner' && await P('p.keys') === 0, 'station key used to upgrade to Shotgunner');
    await waitFor('document.getElementById("upgrade-panel").hidden', 'panel to close');
    const c2 = await nearestCrate();
    await goTo(c2.x - 85, c2.y);
    await sleep(300);
    await fireAt(c2.x, c2.y, 120);
    await sleep(150);
    check(await evaluate(`!Warz.debug.match().world.map.crates[${c2.id}].alive`), 'point-blank shotgun blast breaks a crate');
    check(await evaluate(`Warz.debug.match().world.map.pickups.some(pk => pk.type === "token" && Math.hypot(pk.x - ${c2.x}, pk.y - ${c2.y}) < 200)`) || await P('p.stats.tokens') > 0, 'every broken crate drops tokens');
    check(await evaluate('Warz.debug.match().world.map.crates.filter(c => c.tier !== "common").length') >= 15, 'the island has rare, epic, mythic and legendary crates');

    await evaluate('(() => { const m = Warz.debug.match(); m.world.setClass(m.player, "soldier", false); m.player.tokens += 8; })()');
    await openStationAt(await readyStation(0));
    await click('#ut-node-grenadier'); await click('#ut-action');
    await waitFor('document.getElementById("upgrade-panel").hidden', 'panel to close');
    check(await P('p.classId') === 'grenadier' && await P('p.grenades') === 10, 'Grenadier with 10 grenades');
    const px = await P('p.x'), py = await P('p.y');
    await fireAt(px + 350, py, 60);
    await sleep(520);
    check(await evaluate('Warz.debug.match().world.grenades.some(g => g.shell)'), 'launcher shell lands and waits instead of exploding on impact');
    await shot('10-shell-fuse');
    await sleep(700);
    check(await evaluate('!Warz.debug.match().world.grenades.some(g => g.shell)'), 'shell bursts after its 0.5 s fuse');
    await aimAt(px + 260, py);
    await press('KeyF');
    await sleep(200);
    check(await P('p.grenades') === 9, 'F throws a hand grenade; the launcher does not use them');
    await sleep(1200);

    await evaluate('(() => { const m = Warz.debug.match(); m.world.setClass(m.player, "soldier", false); m.player.tokens += 8; })()');
    await openStationAt(await readyStation(0));
    await click('#ut-node-medic'); await click('#ut-action');
    await waitFor('document.getElementById("upgrade-panel").hidden', 'panel to close');
    await evaluate('Warz.debug.match().world.damagePlayer(Warz.debug.player(), 45, null, "test")');
    const hurtHp = await P('p.hp');
    await press('KeyF');
    await sleep(250);
    check(await P('p.hp') === hurtHp + 30 && await P('p.medkitCd') > 49, 'medkit heals 30 and starts a 50 s cooldown');

    // ---- items, hotbar and inventory
    check(await evaluate('document.querySelectorAll("#hud-slots > .slot").length') === 5, 'HUD shows one five-slot hotbar');
    check(await evaluate('!document.getElementById("hud-hotbar")'), 'the separate mini-hotbar is removed');
    const away = await evaluate(`(() => { const m = Warz.debug.match(), R = 400; for (let y = 900; y < 5500; y += 60) for (let x = 900; x < 5500; x += 60) {
      if (!Warz.U.insideIsland(x, y, 320, Warz.CONFIG.worldSize, Warz.CONFIG.cornerRadius) || m.world.inPond(x, y) || m.world.inPond(x, y + 130)) continue;
      if (m.world.map.stations.some(s => Math.hypot(s.x - x, s.y - y) < 260)) continue;
      let blocked = false; m.world.solids.query(x - R, y - R, x + R, y + R, (s) => {
        if (s.shape === 'circle' ? Math.hypot(s.x - x, s.y - y) < s.r + R : !!Warz.U.circleRectPush(x, y, R, s.x, s.y, s.w, s.h)) blocked = true; });
      if (!blocked) return { x, y }; } return null; })()`);
    check(!!away, 'found an open spot away from stations');
    await goTo(away.x, away.y);
    await sleep(250);
    await press('KeyE');
    check(!(await visible('#inventory-screen')), 'E without a nearby interaction leaves inventory closed');
    await press('Tab');
    check(await visible('#inventory-screen'), 'Tab opens the inventory');
    await shot('10b-inventory');
    await press('Tab');
    check(!(await visible('#inventory-screen')), 'Tab again closes it');
    await evaluate('Warz.debug.giveItem("bandage", 3); Warz.debug.giveItem("rock", 1); Warz.debug.giveItem("turret", 1); true');
    await sleep(150);
    check(await P('p.items.filter(Boolean).length') === 3 && await evaluate('document.querySelectorAll("#hud-slots .item-slot.has-item").length') === 3, 'three items join the weapons in the hotbar');
    check(await evaluate(`(() => { const r = [...document.querySelectorAll('#hud-slots > .slot')].map(e => e.getBoundingClientRect()); return r.length === 5 && r.every(b => Math.abs(b.y - r[0].y) < 5) && r.slice(1).every((b, i) => b.left >= r[i].right); })()`), 'all five cards fit side by side without overlapping');
    const classSlot = await P('p.slot');
    await press('KeyQ');
    check(await P('p.slot') === classSlot && await P('p.weapons.length') === 2, 'Q retains class weapons and does not swap them');
    await press('Digit3');
    await press('KeyQ');
    await sleep(450);
    check(await P('p.items[0]') === null && await evaluate('Warz.debug.match().world.map.pickups.some(p => p.alive && p.type === "item" && p.item === "bandage" && p.amount === 3)'), 'Q drops the entire selected stack and leaves it on the ground');
    await press('KeyE');
    await sleep(150);
    check(await P('p.items[0] && p.items[0].id === "bandage" && p.items[0].n === 3'), 'E picks the dropped stack back up');
    await evaluate('Warz.debug.match().world.damagePlayer(Warz.debug.player(), 45, null, "test")');
    const hpItems = await P('p.hp');
    await press('Digit3');
    check(await P('p.held') === 0, 'hotbar key 3 holds the first item');
    check(await evaluate('document.querySelectorAll("#hud-slots .selected").length === 1 && document.querySelector("#hud-slots .selected").classList.contains("item-slot")'), 'only the held item is highlighted, not the previous weapon');
    await fireAt(away.x + 100, away.y, 60);
    await sleep(200);
    check(await P('p.hp') === hpItems + 20 && await P('p.items[0].n') === 2, 'clicking uses a bandage: +20 HP, two left');
    await press('Digit4');
    await fireAt(away.x + 260, away.y, 60);
    await sleep(250);
    check(await evaluate('Warz.debug.match().world.structures.some(s => s.kind === "rock")'), 'a rock is placed at the cursor');
    await press('Digit5');
    await fireAt(away.x, away.y + 120, 60);
    await sleep(250);
    check(await evaluate('Warz.debug.match().world.structures.some(s => s.kind === "turret")') && await P('p.items[2]') === null, 'a turret is placed and the slot empties');
    await goTo(away.x, away.y + 66);
    await sleep(250);
    check(/mount/i.test(await text('#hud-prompt')), 'prompt offers to mount the turret');
    await press('KeyE');
    await sleep(200);
    check(await P('p.mount') > 0, 'E mounts the turret');
    const shotsBefore = await P('p.stats.shots');
    await fireAt(away.x + 500, away.y + 120, 300);
    await sleep(120);
    check(await P('p.stats.shots') >= shotsBefore + 2, 'the mounted turret fires');
    await shot('10c-turret');
    await press('KeyE');
    await sleep(200);
    check(await P('p.mount') === 0, 'E again dismounts');
    await goTo(away.x + 100, away.y);
    await sleep(200);
    check(/pick up team rock/i.test(await text('#hud-prompt')), 'E prompt offers to recover the larger allied rock');
    await press('KeyE');
    await sleep(200);
    check(await evaluate('!Warz.debug.match().world.structures.some(s => s.kind === "rock" && s.alive) && Warz.debug.player().items.some(s => s && s.id === "rock")'), 'E returns the placed rock to the hotbar');

    await evaluate('Warz.debug.skipTime(Warz.STORM[0].start + 20 - Warz.debug.match().world.time)');
    await sleep(500);
    check(await evaluate('Warz.debug.match().world.storm.state') === 'shrinking', 'storm shrinks on schedule');
    await evaluate('Warz.debug.skipTime(Warz.STORM[Warz.STORM.length - 1].end + 2 - Warz.debug.match().world.time)');
    await waitFor('!document.getElementById("death-screen").hidden', 'elimination screen', 20000);
    await sleep(400);
    check(/storm/i.test(await text('#death-cause')), 'result screen blames the storm');
    await shot('11-eliminated');
    await click('#menu-btn');
    await sleep(400);
    check(await evaluate('Warz.App.state()') === 'menu', 'Main menu button returns to the menu');

    await cmd('Emulation.setDeviceMetricsOverride', { width: 1024, height: 640, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    await click('#play-btn'); await click('#practice-btn');
    await waitFor('Warz.debug.player() && Warz.debug.player().dropT === 0', 'landing (small window)');
    await evaluate('Warz.debug.giveTokens(8)');
    await openStationAt(await readyStation(0));
    await shot('12-small-tree');
    await press('Escape');
    await sleep(200);
    await shot('13-small-hud');
  } finally {
    try { socket && socket.close(); } catch (_) {}
    browser.kill();
    server.close();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
  errors.forEach((e) => failures.push('page error: ' + e));
  console.log(log.join('\n'));
  console.log('Screenshots: ' + OUT);
  if (failures.length) { console.error('\nQA FAILED (' + failures.length + '):\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('\nQA passed: ' + log.length + ' checks, no page errors.');
}

main().catch((e) => { console.error(e && e.stack || e); errors.forEach((x) => console.error('page error: ' + x)); process.exit(1); });
