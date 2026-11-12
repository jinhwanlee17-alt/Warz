// Physical input + HUD/renderer smoke in isolated Practice and an authoritative local match.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedUrl = process.env.WARZ_QA_URL || '';
const outDir = path.join(root, 'output', publishedUrl ? 'qa-live-level3' : 'qa-level3');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: .2, botFill: 2, log: { info() {}, warn: console.warn, error: console.error } });
let b; const checks = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
function clearTerrain(W, w) {
  for (const key of ['trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations', 'drops', 'rocks']) w.map[key] = [];
  w.structures = []; w.solids = new W.U.SpatialHash(256); w.buildSolids();
  for (const v of w.vehicles) { v.x = 15000 + v.id * 200; v.y = 15000; }
}
function fixture(W, w, p, classId) {
  for (const other of w.players) if (other !== p) { other.x = other.y = 16000; other.controller = () => ({ mx: 0, my: 0 }); }
  w.setClass(p, classId, true); p.alive = true; p.downed = false; p.dropT = 0; p.held = -1; p.slot = 0;
  p.x = p.px = 5000; p.y = p.py = 5000; p.vx = p.vy = p.ox = p.oy = 0; p.angle = 0;
  w.structures = []; w.bullets = []; w.buildSolids();
}
try {
  const port = publishedUrl ? null : (await app.listen(0, '127.0.0.1')).port;
  b = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = (code, down) => b.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code, key: code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(code.length - 1) });
  const press = async code => { await key(code, true); await sleep(80); await key(code, false); await sleep(150); };
  const mouse = down => b.cmd('Input.dispatchMouseEvent', { type: down ? 'mousePressed' : 'mouseReleased', x: 1150, y: 450, button: 'left', buttons: down ? 1 : 0, clickCount: 1 });
  await b.cmd('Page.navigate', { url: publishedUrl || 'http://127.0.0.1:' + port + '/?seed=57' });
  await b.waitFor('window.Warz?.App?.ready && Warz.Net.online()');
  await evaluate(() => {
    window.level3QA = { ghosts: 0, progress: 0, blue: 0, red: 0, sounds: [] };
    const renderer = Warz.debug.renderer(), build = renderer.drawSentryBuild, shield = renderer.drawShield, sound = Warz.Audio.play;
    renderer.drawSentryBuild = function (g, p, t, preview) { if (p.sentryBuild) level3QA[preview ? 'ghosts' : 'progress']++; return build.apply(this, arguments); };
    renderer.drawShield = function (g, r, explosive) { level3QA[explosive ? 'red' : 'blue']++; return shield.apply(this, arguments); };
    Warz.Audio.play = function (name, volume) { level3QA.sounds.push(name); return sound.call(this, name, volume); };
    Warz.App.startPractice();
  });
  // Published verification uses local Practice only; it never joins a public lobby.
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
    await mutate(fixture, 'engineer');
    await evaluate(() => { const m = Warz.debug.match(); m.cam.x = m.cam.y = 5000; m.cam.zoom = 1; Warz.Hud.banner('', '', .01); });
    await b.waitFor('Warz.debug.player().classId==="engineer" && document.getElementById("hud-ammo-label").textContent.includes("build a sentry")');
    check(await evaluate(() => document.getElementById('hud-ammo').textContent === '10s' && !/undefined|NaN/.test(document.getElementById('hud').innerHTML)), label + ': wrench HUD advertises 10-second construction with valid values');
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1150, y: 450 });
    await mouse(true);
    await b.waitFor('Warz.debug.player().sentryBuild?.elapsed > 1 && !document.getElementById("hud-repair").hidden');
    check(await evaluate(() => level3QA.ghosts > 0 && level3QA.progress > 0 && document.getElementById('hud-repair-name').textContent === 'Building Sentry' && document.getElementById('hud-repair-text').textContent.includes('remaining')), label + ': real held input displays ghost, avatar progress and build countdown');
    check(await mutate((W, w) => w.structures.filter(s => s.kind === 'sentry').length === 0), label + ': no early sentry while the ten-second timer is running');
    await b.shot(prefix + '-engineer-building.png');
    await b.waitFor('Warz.debug.match().world.structures.some(s=>s.kind==="sentry" && s.owner===Warz.debug.player().id)', 14000);
    await mouse(false);
    check(await mutate((W, w, p) => { const s = w.structures.find(s => s.owner === p.id); return s?.item === 'sentry' && s.maxHp === W.ITEMS.sentry.hp; }), label + ': full sustained input produces ordinary Sentry equipment');
    await b.waitFor('!Warz.debug.player().sentryBuild && document.getElementById("hud-repair").hidden');
    await b.shot(prefix + '-engineer-built.png');
    await mutate(fixture, 'shieldoperator');
    await b.waitFor('Warz.debug.player().classId==="shieldoperator" && Warz.debug.player().shieldUp && document.getElementById("hud-ammo").textContent==="10"');
    check(await evaluate(() => level3QA.blue > 0 && document.getElementById('hud-ammo-label').textContent.includes('Riot shield raised')), label + ': pistol slot displays raised blue riot shield and ten-round magazine');
    await b.shot(prefix + '-riot-pistol.png');
    await mouse(true); await b.waitFor('Warz.debug.player().weapons[0].ammo<10'); await mouse(false);
    check(await mutate((W, w, p) => p.shieldUp && p.weapons[0].ammo < 10), label + ': pistol fires while riot shield stays raised');
    check(await evaluate(() => level3QA.sounds.includes('shieldpistol')), label + ': shield pistol fires through the actual sound handler');
    await press('Digit2');
    await b.waitFor('Warz.debug.player().slot===1 && document.getElementById("hud-ammo").textContent==="Raised"');
    check(await evaluate(() => level3QA.red > 0 && document.getElementById('hud-ammo-max').textContent === '' && document.getElementById('hud-ammo-label').textContent.includes('Explosive shield')), label + ': second slot is a visible red shield without fictional ammunition');
    await b.shot(prefix + '-explosive-shield.png');
    await mouse(true); await sleep(300); await mouse(false);
    check(await mutate((W, w, p) => p.weapons[0].ammo < 10 && p.shieldUp && p.slot === 1 && !p.weapons[1].reloading), label + ': explosive shield remains raised when primary fire is held');
  }
  check(b.errors.length === 0, 'All live HUD, icon and canvas frames complete without browser exceptions');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, errors: b.errors }, null, 2));
  console.log('Level three browser QA: all ' + checks.length + ' checks passed');
} finally { if (b) await b.close(); if (!publishedUrl) await app.close(); }
