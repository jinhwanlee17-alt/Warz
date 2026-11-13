// Local-only browser check for nearby sound bearings. Never connects to the published game.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), outDir = path.join(root, 'output/qa-sound-cues');
const app = createApp({ dataDir: null, log: { info() {}, warn: console.warn, error: console.error } });
let b; const checks = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
try {
  const port = (await app.listen(0, '127.0.0.1')).port;
  b = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  await b.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
  await b.waitFor('window.Warz?.App?.ready && Warz.SoundCues && Warz.Net.online()');
  await evaluate(() => Warz.App.startPractice());
  await b.waitFor('Warz.App.state()==="play" && Warz.debug.player()');
  await evaluate(() => {
    const w = Warz.debug.match().world, p = Warz.debug.player();
    w.storm = null; w.events = []; w.structures = [];
    w.players.forEach(o => { if (o !== p) { o.x = o.y = 17000; o.controller = () => ({ mx: 0, my: 0 }); } });
    p.x = p.px = 5000; p.y = p.py = 5000; p.ox = p.oy = p.vx = p.vy = 0; p.alive = true; p.downed = false; p.dropT = 0;
    window.soundQA = { played: [] }; const play = Warz.Audio.play;
    Warz.Audio.play = function (id, volume) { soundQA.played.push({ id, volume }); return play.call(this, id, volume); };
    Warz.SoundCues.clear();
    w.emit({ type: 'shot', weapon: 'ar', x: 5300, y: 4600, player: { id: 777, x: 5300, y: 4600 } });
  });
  await b.waitFor('document.querySelectorAll(".sound-cue").length===1');
  check(await evaluate(() => !document.getElementById('sound-cues').hidden && document.querySelector('.sound-cue-label').textContent === 'Gunfire'), 'actual game shot event displays a nearby sound row');
  check(await evaluate(() => document.querySelector('.sound-cue-arrow').style.transform === 'rotate(36.87deg)'), 'bearing uses the exact northeast angle');
  check(await evaluate(() => soundQA.played.some(s => s.id === 'ar' && s.volume > 0)), 'the same event still produces spatial gunfire audio');
  check(await evaluate(() => !document.getElementById('hud-keys')), 'the old keybind guide has been removed');
  await evaluate(() => {
    const w = Warz.debug.match().world;
    w.emit({ type: 'sound', kind: 'heal', x: 3800, y: 5000, source: 778, sound: 'heal' });
    w.emit({ type: 'sound', kind: 'repair', x: 6900, y: 6200, source: 779, sound: 'repair' });
    w.emit({ type: 'sound', kind: 'build', x: 5000, y: 1800, source: 780, sound: 'repair' });
    w.emit({ type: 'throw', x: 9900, y: 5000, player: { id: 781, x: 9900, y: 5000 } });
  });
  await b.waitFor('document.querySelectorAll(".sound-cue").length===5');
  check(await evaluate(() => new Set([...document.querySelectorAll('.sound-cue')].map(e => e.style.color)).size >= 4), 'near and far sounds display smoothly varied proximity colours');
  check(await evaluate(() => {
    const a = document.getElementById('sound-cues').getBoundingClientRect(), e = document.getElementById('emotes-btn').getBoundingClientRect();
    return a.width < 220 && a.right <= innerWidth && a.bottom <= innerHeight && e.bottom <= a.top;
  }), 'compact corner widget fits beneath the Emotes button without overlap');
  await b.shot('01-nearby-sounds.png');
  await evaluate(() => {
    const w = Warz.debug.match().world, p = Warz.debug.player(); Warz.SoundCues.clear();
    w.emit({ type: 'sound', kind: 'heal', x: p.x + Warz.SoundCues.range() + 100, y: p.y, source: 782, sound: 'heal' });
    w.emit({ type: 'shot', weapon: 'ar', x: p.x + Warz.SoundCues.range() + 100, y: p.y, player: { id: 783 } });
  });
  await sleep(100);
  check(await evaluate(() => document.getElementById('sound-cues').hidden && soundQA.played.at(-1).volume === 0), 'sounds outside seven snowbomb radii have no cue or audible volume');
  await b.cmd('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(() => { const w = Warz.debug.match().world, p = Warz.debug.player(); w.emit({ type: 'sound', kind: 'repair', x: p.x - 500, y: p.y - 1000, source: 784, sound: 'repair' }); });
  await b.waitFor('document.querySelectorAll(".sound-cue").length===1');
  check(await evaluate(() => {
    const r = document.getElementById('sound-cues').getBoundingClientRect();
    const hotbar = document.getElementById('hud-slots').getBoundingClientRect();
    return r.width > 100 && r.left >= 0 && r.right <= innerWidth && r.bottom <= hotbar.top && getComputedStyle(document.querySelector('.hud-br')).display !== 'none';
  }), 'sound bearings remain visible on a narrow viewport');
  await b.shot('02-nearby-sounds-narrow.png');
  await sleep(2000);
  check(await evaluate(() => document.getElementById('sound-cues').hidden), 'old sound rows fade and disappear');
  check(b.errors.length === 0, 'sound indicator browser play completes without exceptions');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, errors: b.errors }, null, 2));
  console.log('Directional sounds browser QA: all ' + checks.length + ' checks passed');
} finally { if (b) await b.close(); await app.close(); }
