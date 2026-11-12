// The small right-side picker must leave live movement, sprinting, aiming and fire running.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const outDir = path.resolve('output/qa-emotes');
const app = createApp({ dataDir: null, lobbyMin: 2, lobbyCountdown: .2, botFill: 0, log: { info() {}, warn: console.warn, error: console.error } });
const browsers = [], checks = [], held = new WeakMap();
const check = (value, message) => { assert.ok(value, message); checks.push(message); console.log('ok  ' + message); };
const evaluate = (b, fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
const key = async (b, code, down, repeat = false) => {
  const state = held.get(b) || new Set(); held.set(b, state); if (down) state.add(code); else state.delete(code);
  const special = { Escape: ['Escape', 27], ShiftLeft: ['Shift', 16], Tab: ['Tab', 9], Space: [' ', 32] }, name = special[code] || [code.slice(-1).toLowerCase(), code.charCodeAt(code.length - 1)];
  await b.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code, key: name[0], windowsVirtualKeyCode: name[1], autoRepeat: repeat, modifiers: state.has('ShiftLeft') ? 8 : 0 });
};
const press = async (b, code) => { await key(b, code, true); await sleep(70); await key(b, code, false); await sleep(90); };
const mouse = (b, down) => b.cmd('Input.dispatchMouseEvent', { type: down ? 'mousePressed' : 'mouseReleased', x: 560, y: 230, button: 'left', buttons: down ? 1 : 0, clickCount: 1 });
const releaseCombat = async b => { await mouse(b, false); await key(b, 'KeyW', false); await key(b, 'ShiftLeft', false); await sleep(180); };
const open = async b => { await press(b, 'KeyB'); await b.waitFor('Warz.EmotePicker.isOpen()'); };
const look = { color: '#18c3a4', face: 'evil', emotes: ['cooked', 'cry', 'rose', 'fire', 'gg', 'hi', 'bye', 'haha', 'evil'] };
const read = b => evaluate(b, () => { const p = Warz.debug.player(); return { x: p.x, y: p.y, stamina: p.stamina, shots: p.stats.shots, sprinting: p.sprinting, emote: p.emote && p.emote.id, open: Warz.EmotePicker.isOpen() }; });
function clearArena(w, W) {
  for (const key of ['trees', 'bushes', 'rocks', 'buildings', 'ponds', 'crates', 'pickups', 'stations']) w.map[key] = [];
  w.structures = []; for (const v of w.vehicles) { v.x = 15000 + v.id * 200; v.y = 15000; }
  w.solids = new W.U.SpatialHash(256); w.buildSolids();
}
async function layout(b, width, height) {
  await b.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(120);
  const result = await evaluate(b, () => {
    const root = document.getElementById('emote-picker'), card = root.querySelector('.emote-card'), grid = root.querySelector('.emote-grid'), r = card.getBoundingClientRect();
    const buttons = [...root.querySelectorAll('[data-emote-slot]')].map(el => { const b = el.getBoundingClientRect(), glyph = el.querySelector('.emote-glyph'); return { x: b.x, y: b.y, w: b.width, h: b.height, fits: glyph.scrollWidth <= glyph.clientWidth + 1 && glyph.scrollHeight <= el.clientHeight }; });
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, count: buttons.length,
      modal: root.getAttribute('aria-modal'), region: root.getAttribute('role'), focused: root.contains(document.activeElement), canvas: document.elementFromPoint(innerWidth * .4, innerHeight * .35)?.id, buttons };
  });
  check(result.count === 9 && result.columns === 3 && result.x > width / 2 && result.w <= 222 && result.right <= width && result.y >= 0 && result.bottom <= height,
    width + 'x' + height + ': compact 3x3 picker stays on the right inside the camera');
  check(result.buttons.every(b => Math.abs(b.w - b.h) < 1 && b.fits), width + 'x' + height + ': square tiles fit emojis and Get Cooked!');
  check(result.modal !== 'true' && result.region === 'region' && !result.focused && result.canvas === 'game', width + 'x' + height + ': no modal focus trap or pointer-blocking overlay');
  await b.shot('picker-' + width + 'x' + height + '.png');
}
try {
  const { port } = await app.listen(0, '127.0.0.1'), url = 'http://127.0.0.1:' + port + '/?seed=57';
  for (let i = 0; i < 2; i++) {
    const b = await openBrowser({ outDir: path.join(outDir, 'client-' + i), width: 1280, height: 850 }); browsers.push(b);
    await b.cmd('Page.navigate', { url }); await b.waitFor('window.Warz && Warz.App && Warz.App.ready');
    await evaluate(b, v => localStorage.setItem('warz.locker.v1', JSON.stringify(v)), i ? { ...look, color: '#ee4a4a', face: 'smile' } : look);
    await b.cmd('Page.navigate', { url }); await b.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
    check(await evaluate(b, () => Warz.Locker.get().emotes[0] === 'cooked'), 'Client ' + i + ' restores equipped emotes');
  }
  const [a, b] = browsers;
  await evaluate(a, () => { Warz.App.startPractice(); const w = Warz.debug.match().world, p = Warz.debug.player(); w.storm = null; p.dropT = 0; p.x = p.px = 5000; p.y = p.py = 5000; p.vx = p.vy = 0; });
  await a.evaluate('(' + clearArena.toString() + ')(Warz.debug.match().world, Warz)');
  await evaluate(a, () => { const w = Warz.debug.match().world, p = Warz.debug.player(); window.emoteQA = { launches: [] }; const emit = w.emit; w.emit = function(e) { if (e.type === 'launch' && e.player === p) emoteQA.launches.push(e.travel); return emit.call(this, e); }; });
  await sleep(450);
  check(await evaluate(a, () => Warz.debug.player().color === '#18c3a4' && Warz.debug.player().face === 'evil'), 'Practice keeps the saved colour and face');
  await key(a, 'KeyW', true); await key(a, 'ShiftLeft', true); await mouse(a, true); await sleep(180);
  const before = await read(a); await key(a, 'KeyB', true); await a.waitFor('Warz.EmotePicker.isOpen()'); await sleep(180); await key(a, 'KeyB', true, true); await sleep(120);
  const during = await read(a);
  check(during.open && during.y < before.y - 30 && during.shots > before.shots && during.stamina < before.stamina && during.sprinting, 'Practice keeps pre-held W, sprint and mouse fire running while B opens the picker');
  await key(a, 'KeyB', false); await press(a, 'KeyQ');
  const chosen = await read(a); await sleep(180); const continuing = await read(a);
  check(!chosen.open && chosen.emote === 'cooked' && continuing.y < chosen.y - 20 && continuing.shots > chosen.shots && continuing.sprinting, 'Q selection leaves the existing movement, sprint and firing holds running');
  await releaseCombat(a);
  await sleep(1550); await open(a); const freshAt = await read(a); await key(a, 'KeyW', true); await sleep(160); await key(a, 'KeyW', true, true); await sleep(140);
  check(await evaluate(a, y => { const p = Warz.debug.player(); return p.emote.id === 'cry' && p.y < y - 20 && !Warz.EmotePicker.isOpen(); }, freshAt.y), 'Fresh W selects slot two and continues normal walking, including held-key auto-repeat');
  await key(a, 'KeyW', false); await sleep(180); await open(a); await press(a, 'Escape');
  check(await evaluate(a, () => !Warz.EmotePicker.isOpen() && document.getElementById('pause-menu').hidden), 'Escape closes only the small panel');
  // Held-item Q must not drop, and E/R must not enter a nearby vehicle or reload.
  await evaluate(a, () => { const w = Warz.debug.match().world, p = Warz.debug.player(); w.addItem(p, 'grenade', 3); p.held = 0; const v = w.vehicles[0]; v.x = p.x + 140; v.y = p.y; emoteQA.items = JSON.stringify(p.items); emoteQA.pickups = w.map.pickups.length; });
  await sleep(1550); await open(a); await press(a, 'KeyQ');
  check(await evaluate(a, () => JSON.stringify(Warz.debug.player().items) === emoteQA.items && Warz.debug.match().world.map.pickups.length === emoteQA.pickups), 'Q selects an emote without dropping the held grenade');
  await sleep(1550); await open(a); await press(a, 'KeyE');
  check(await evaluate(a, () => { const p = Warz.debug.player(); return p.emote.id === 'rose' && !p.vehicle && !p.mount; }), 'E selects slot three without boarding the nearby Humvee');
  await evaluate(a, () => { const p = Warz.debug.player(); p.held = -1; p.weapons[p.slot].ammo = 3; });
  await sleep(1550); await open(a); await press(a, 'KeyR');
  check(await evaluate(a, () => { const p = Warz.debug.player(), gun = p.weapons[p.slot]; return p.emote.id === 'fire' && !gun.reloading && gun.ammo === 3; }), 'R selects slot four without starting a reload');
  // Opening and selecting the panel must not cancel a grenade-launcher charge.
  await evaluate(a, () => { const w = Warz.debug.match().world, p = Warz.debug.player(); w.setClass(p, 'grenadier', true); p.held = -1; p.slot = 0; emoteQA.launches = []; });
  await mouse(a, true); await sleep(450); await open(a); await sleep(350); await press(a, 'KeyQ');
  check(await evaluate(a, () => emoteQA.launches.length === 0), 'Opening and selecting the panel does not release a held launcher early');
  await mouse(a, false); await a.waitFor('emoteQA.launches.length===1');
  check(await evaluate(a, () => Math.abs(emoteQA.launches[0] - (Warz.WEAPONS.launcher.range - Warz.debug.player().r - 10)) < .1), 'Physical mouse release still launches at full charged range after using the picker');
  await open(a); await layout(a, 1280, 850); await layout(a, 390, 844); await layout(a, 844, 390); await press(a, 'Escape');
  await a.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false });
  await evaluate(a, () => Warz.App.leaveMatch());
  await Promise.all(browsers.map(browser => evaluate(browser, () => Warz.Lobby.queue('solo'))));
  await Promise.all(browsers.map(browser => browser.waitFor('Warz.debug.match()?.online && Warz.debug.online().snapCount>2', 15000)));
  const ids = await Promise.all(browsers.map(browser => evaluate(browser, () => Warz.debug.player().id)));
  const matchId = await evaluate(a, () => Warz.debug.match().id), live = app.matches.get(matchId), first = live.byId.get(ids[0]), second = live.byId.get(ids[1]);
  clearArena(live.world, live.W); live.world.storm.update = function () {};
  first.dropT = second.dropT = 0; first.x = 5000; first.y = 5000; first.vx = first.vy = 0; second.x = 5400; second.y = 5200;
  await Promise.all(browsers.map(browser => browser.evaluate('(' + clearArena.toString() + ')(Warz.debug.match().world, Warz)')));
  await a.waitFor('Warz.debug.player().dropT<=0 && Math.abs(Warz.debug.player().y-5000)<2'); await sleep(250);
  check(first.color === look.color && first.face === look.face && first.emotes[0] === 'cooked', 'Server accepts the selected appearance and nine emotes');
  check(await evaluate(b, id => { const p = Warz.debug.match().world.playerById(id); return !p.hidden && p.color === '#18c3a4' && p.face === 'evil'; }, first.id), 'Second client sees the selected colour and face');
  await key(a, 'KeyW', true); await key(a, 'ShiftLeft', true); await mouse(a, true); await sleep(180);
  const serverBefore = { y: first.y, shots: first.stats.shots, stamina: first.stamina };
  await open(a); await sleep(250);
  check(first.y < serverBefore.y - 40 && first.stats.shots > serverBefore.shots && first.stamina < serverBefore.stamina && await evaluate(a, () => Warz.EmotePicker.isOpen()), 'Authoritative online movement, sprint and firing continue while the panel is open');
  const serverChoice = { y: first.y, shots: first.stats.shots }; await press(a, 'KeyQ'); await sleep(150);
  await b.waitFor('Warz.debug.match().world.playerById(' + first.id + ').emote?.id==="cooked"');
  check(first.y < serverChoice.y - 30 && first.stats.shots > serverChoice.shots && first.emote.id === 'cooked', 'Other client receives the emote while server movement and firing continue through selection');
  await releaseCombat(a); await a.shot('online-own-emote.png'); await b.shot('online-other-emote.png');
  live.world.addItem(first, 'grenade', 3); first.held = 0; first.net.itemsKey = ''; const v = live.world.vehicles[0]; v.x = first.x + 140; v.y = first.y;
  await sleep(1550); const startItems = JSON.stringify(first.items); await open(a); await press(a, 'KeyQ'); await sleep(150);
  check(JSON.stringify(first.items) === startItems && first.held === 0, 'Online Q never leaks an item-drop action');
  await sleep(1550); await open(a); await press(a, 'KeyE'); await sleep(150);
  check(first.emote.id === 'rose' && !first.vehicle && !first.mount, 'Online E never leaks a vehicle/turret interaction');
  first.held = -1; first.weapons[first.slot].ammo = 3; first.net.itemsKey = ''; await sleep(1550); await open(a); await press(a, 'KeyR'); await sleep(150);
  check(first.emote.id === 'fire' && !first.weapons[first.slot].reloading && first.weapons[first.slot].ammo === 3, 'Online R never leaks a reload action');
  await sleep(1550); await open(a); const serverWalkY = first.y; await key(a, 'KeyW', true); await sleep(300); await key(a, 'KeyW', false);
  check(first.emote.id === 'cry' && first.y < serverWalkY - 20, 'Online fresh W selects slot two and still walks');
  const beforeSpam = first.emote.id; await evaluate(a, () => { for (let i = 0; i < 20; i++) Warz.MatchNet.send({ t: 'emote', slot: 0 }); Warz.MatchNet.send({ t: 'emote', slot: 'arbitrary chat' }); });
  await sleep(200); check(first.emote.id === beforeSpam, 'Rate limiting and fixed emote-only payload validation stay intact');
  check(browsers.every(browser => browser.errors.length === 0), 'Both browser clients finish without runtime exceptions');
  fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, ids, matchId }, null, 2));
  console.log('Emote browser QA: ' + checks.length + ' checks passed');
} finally {
  for (const b of browsers) await b.close();
  await app.close();
}
