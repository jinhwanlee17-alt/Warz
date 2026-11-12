// Real upgrade/fire/reload controls in isolated Practice and a local authoritative match.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedUrl = process.env.WARZ_QA_URL || '';
const outDir = path.join(root, 'output', publishedUrl ? 'qa-live-rocketeer' : 'qa-rocketeer');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: .2, botFill: 2, log: { info() {}, warn: console.warn, error: console.error } });
let b; const checks = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
function clearTerrain(W, w) {
  const station = { ...w.map.stations[0], id: 0, x: 4940, y: 5000, cooldown: 0 };
  for (const key of ['trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'drops', 'rocks']) w.map[key] = [];
  w.map.stations = [station]; w.structures = []; w.rpgRockets = []; w.bullets = [];
  w.solids = new W.U.SpatialHash(256); w.buildSolids();
  for (const v of w.vehicles) { v.x = 15000 + v.id * 200; v.y = 15000; }
}
function fixture(W, w, p) {
  for (const other of w.players) if (other !== p) { other.x = other.y = 16000; other.controller = () => ({ mx: 0, my: 0 }); }
  w.setClass(p, 'grenadier2', true); p.alive = true; p.downed = false; p.dropT = 0; p.held = -1; p.slot = 0;
  p.x = p.px = 5000; p.y = p.py = 5000; p.vx = p.vy = p.ox = p.oy = 0; p.angle = 0; p.tokens = 40; p.keys = 0;
  w.map.stations[0].cooldown = 0; p.nearStation = w.map.stations[0];
}
try {
  const port = publishedUrl ? null : (await app.listen(0, '127.0.0.1')).port;
  b = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = (code, down) => b.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code, key: code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(code.length - 1) });
  const press = async code => { await key(code, true); await sleep(70); await key(code, false); await sleep(150); };
  const mouse = down => b.cmd('Input.dispatchMouseEvent', { type: down ? 'mousePressed' : 'mouseReleased', x: 1150, y: 450, button: 'left', buttons: down ? 1 : 0, clickCount: 1 });
  const click = async selector => {
    const at = await evaluate(s => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
    for (const down of [true, false]) await b.cmd('Input.dispatchMouseEvent', { type: down ? 'mousePressed' : 'mouseReleased', ...at, button: 'left', buttons: down ? 1 : 0, clickCount: 1 });
  };
  await b.cmd('Page.navigate', { url: publishedUrl || 'http://127.0.0.1:' + port + '/?seed=57' });
  await b.waitFor('window.Warz?.App?.ready && Warz.Net.online()');
  await evaluate(() => {
    window.rpgQA = { frames: 0, sounds: [] };
    const renderer = Warz.debug.renderer(), draw = renderer.drawRpgRockets, play = Warz.Audio.play;
    renderer.drawRpgRockets = function (g, w, v) { if (w.rpgRockets?.length) rpgQA.frames++; return draw.apply(this, arguments); };
    Warz.Audio.play = function (id, volume) { rpgQA.sounds.push(id); return play.call(this, id, volume); };
    Warz.App.startPractice();
  });
  // Live verification deliberately stays in local Practice; no public lobby is joined.
  for (const online of publishedUrl ? [false] : [false, true]) {
    const label = online ? 'Online' : 'Practice', prefix = online ? 'online' : 'practice';
    if (online) { await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('solo'); }); await b.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>2'); }
    const live = online ? app.matches.get(String(await evaluate(() => Warz.debug.match().id))) : null;
    const owner = live ? live.byId.get(await evaluate(() => Warz.debug.player().id)) : null;
    const mutate = async (fn, ...args) => live ? fn(live.W, live.world, owner, ...args) : evaluate((source, args) => {
      const m = Warz.debug.match(); return (0, eval)('(' + source + ')')(Warz, m.world, m.player, ...args);
    }, fn.toString(), args);
    if (live) clearTerrain(live.W, live.world);
    await evaluate(clear => { const m = Warz.debug.match(); (0, eval)('(' + clear + ')')(Warz, m.world); Warz.debug.renderer().map = null; }, clearTerrain.toString());
    await mutate(fixture);
    await evaluate(() => { const m = Warz.debug.match(); m.cam.x = m.cam.y = 5000; m.cam.zoom = 1; Warz.Hud.banner('', '', .01); rpgQA.frames = 0; rpgQA.sounds = []; });
    await b.waitFor('Warz.debug.player().classId==="grenadier2" && Warz.debug.player().nearStation');
    await press('KeyE'); await b.waitFor('Warz.UpgradeTree.isOpen()');
    await click('#ut-node-rocketeer'); await click('#ut-action');
    await b.waitFor('Warz.debug.player().classId==="rocketeer" && !Warz.UpgradeTree.isOpen()');
    check(await mutate((W, w, p) => p.hp === 65 && p.maxHp === 65 && p.tokens === 0 && p.weapons.map(v => v.id).join() === 'rpg,pistol'), label + ': physical station controls buy Rocketeer for 40 tokens with 65 HP and RPG plus pistol');
    check(await evaluate(() => document.getElementById('hud-ammo').textContent === '1' && document.getElementById('hud-ammo-label').textContent.includes('unlimited range') && !/undefined|NaN/.test(document.getElementById('hud').innerHTML)), label + ': RPG HUD shows one ready rocket, unlimited range and valid values');
    await b.shot(prefix + '-rocketeer-ready.png');
    const before = await mutate((W, w, p) => p.stats.shots);
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1150, y: 450 });
    await mouse(true); await b.waitFor('Warz.debug.player().weapons[0].reloading', 1500);
    check(await mutate((W, w, p, before) => p.stats.shots === before + 1 && p.weapons[0].ammo === 0 && p.weapons[0].reloadT > 2, before), label + ': RPG fires immediately while mouse is held and starts its three-second reload');
    check(await evaluate(() => rpgQA.frames > 0 && rpgQA.sounds.includes('rpg')), label + ': fired RPG is visibly rendered and reaches the actual firing-sound handler');
    await b.shot(prefix + '-rocketeer-rocket-flight.png');
    await mouse(false);
    check(await evaluate(() => document.getElementById('hud-ammo-label').textContent.includes('Reloading RPG')), label + ': reload state is clear in the HUD');
    await b.waitFor('!Warz.debug.player().weapons[0].reloading && Warz.debug.player().weapons[0].ammo===1', 4500);
    check(await mutate((W, w, p, before) => p.stats.shots === before + 1 && p.weapons[0].ammo === 1, before), label + ': reload provides another rocket from unlimited reserve without a release-triggered extra shot');
    await press('Digit2'); await b.waitFor('Warz.debug.player().slot===1');
    await mouse(true); await b.waitFor('Warz.debug.player().weapons[1].ammo<10'); await mouse(false);
    check(await mutate((W, w, p) => p.weapons[1].id === 'pistol' && p.weapons[1].ammo < 10), label + ': basic pistol remains usable in slot two');
    await press('Digit3'); await b.waitFor('Warz.debug.player().held===0');
    const empty = await mutate((W, w, p) => p.stats.shots);
    await mouse(true); await sleep(250); await mouse(false);
    check(await mutate((W, w, p, shots) => p.held === 0 && !p.items[0] && p.stats.shots === shots, empty), label + ': empty hotbar selection cannot accidentally fire the RPG or pistol');
    await press('Digit1'); await b.waitFor('Warz.debug.player().held<0 && Warz.debug.player().slot===0');
    await b.shot(prefix + '-rocketeer-loadout.png');
  }
  check(b.errors.length === 0, 'Rocketeer menu, HUD, sound and canvas rendering complete without browser exceptions');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, errors: b.errors }, null, 2));
  console.log('Rocketeer browser QA: all ' + checks.length + ' checks passed');
} finally { if (b) await b.close(); if (!publishedUrl) await app.close(); }
