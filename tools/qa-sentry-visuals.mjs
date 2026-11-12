// Actual Sentry IV simulation and canvas rendering against immortal offline Practice targets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedUrl = process.env.WARZ_QA_URL || '';
const outDir = path.join(root, 'output', publishedUrl ? 'qa-live-sentry-visuals' : 'qa-sentry-visuals');
const app = createApp({ dataDir: null, log: { info() {}, warn: console.warn, error: console.error } });
let b; const checks = [];
const check = (ok, text) => { assert.ok(ok, text); checks.push(text); console.log('ok  ' + text); };
try {
  const port = publishedUrl ? null : (await app.listen(0, '127.0.0.1')).port;
  b = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  await b.cmd('Page.navigate', { url: publishedUrl || 'http://127.0.0.1:' + port + '/?seed=57' });
  await b.waitFor('window.Warz?.App?.ready');
  await evaluate(() => {
    Warz.App.startPractice();
    const W = Warz, m = W.debug.match(), w = m.world, p = m.player;
    for (const key of ['trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations', 'drops', 'rocks']) w.map[key] = [];
    w.structures = []; w.bullets = []; w.sentryProjectiles = []; w.solids = new W.U.SpatialHash(256); w.buildSolids(); w.storm.enabled = false;
    for (const v of w.vehicles) { v.x = 15000 + v.id * 200; v.y = 15000; }
    for (const other of w.players) if (other !== p) { other.x = other.y = 16000; other.controller = () => ({}); }
    w.setClass(p, 'engineer', true); p.dropT = 0; p.x = p.px = 5000; p.y = p.py = 5000; p.held = 1;
    p.items = [null, null, null]; p.vx = p.vy = p.ox = p.oy = 0;
    window.sentryVisualQA = { shots: {}, draws: {}, heights: { high: 0, low: 0 }, targets: [], structs: [], damage: 0 };
    const emit = w.emit;
    w.emit = function (e) {
      if (e.type === 'sentry-projectiles') for (const g of e.projectiles) sentryVisualQA.shots[g.kind] = (sentryVisualQA.shots[g.kind] || 0) + 1;
      if (e.type === 'damage' && e.target?.practiceBot) sentryVisualQA.damage++;
      return emit.apply(this, arguments);
    };
    const renderer = W.debug.renderer(), draw = renderer.drawSentryProjectiles;
    renderer.drawSentryProjectiles = function (ctx, world, view, airborne) {
      for (const g of world.sentryProjectiles || []) {
        sentryVisualQA.draws[g.kind] = (sentryVisualQA.draws[g.kind] || 0) + 1;
        if (g.kind === 'grenades') sentryVisualQA.heights[(g.z || 0) > 40 ? 'high' : 'low']++;
      }
      return draw.apply(this, arguments);
    };
    Object.keys(W.SENTRY_IV).forEach((variant, i) => {
      const def = W.SENTRY_IV[variant], x = 4630 + Math.floor(i / 3) * 650, y = 4710 + (i % 3) * 230;
      const target = w.spawnPracticeBot(p); target.x = target.px = x + 270; target.y = target.py = y;
      target.name = W.SENTRY_IV[variant].name.replace(' Sentry IV', '') + ' target'; sentryVisualQA.targets.push(target.id);
      const s = w.addStruct({ kind: 'sentry', item: def.item, x, y, r: 24, hp: def.hp, maxHp: def.hp, owner: p.id, team: p.team });
      sentryVisualQA.structs.push(s.id);
    });
    m.cam.x = 5090; m.cam.y = 4940; m.cam.zoom = 0.9;
    // Keep the presentation camera steady while the real simulation and render loop continue.
    const render = renderer.render;
    renderer.render = function (world, cam, options) { if (world === w) { cam.x = 5090; cam.y = 4940; cam.zoom = 0.9; } return render.apply(this, arguments); };
    renderer.map = null; W.Hud.banner('', '', .01);
  });
  await b.waitFor('Object.keys(Warz.SENTRY_IV).every(id=>sentryVisualQA.shots[id] && sentryVisualQA.draws[id])');
  check(await evaluate(() => Object.keys(Warz.SENTRY_IV).every(id => sentryVisualQA.shots[id] > 0 && sentryVisualQA.draws[id] > 0)), 'All six actual Sentry IV weapons fire and reach the canvas renderer');
  await b.shot('all-six-sentries-firing.png');
  await sleep(700);
  check(await evaluate(() => sentryVisualQA.heights.high > 0 && sentryVisualQA.heights.low > 0), 'Grenade arcs render both elevated and low flight frames');
  check(await evaluate(() => sentryVisualQA.targets.every(id => { const p = Warz.debug.match().world.players.find(p => p.id === id); return p.alive && p.hp === p.maxHp && p.stats.shots === 0; }) && sentryVisualQA.damage > 0), 'Practice targets receive real hits, stay immortal and never fire back');
  // Separate the grenade launcher and lengthen its lob for easy-to-read high/low arc screenshots.
  await evaluate(() => {
    const m = Warz.debug.match(), w = m.world, s = w.structures.find(s => s.item === Warz.SENTRY_IV.grenades.item);
    w.structures.forEach(other => { if (other !== s) other.alive = false; });
    const target = w.players.find(p => p.id === sentryVisualQA.targets[1]);
    w.players.forEach(p => { if (p !== m.player && p !== target) p.x = p.y = 16000; });
    s.x = 4750; s.y = 5000; s.cooldown = 0; target.x = target.px = 5330; target.y = target.py = 5000;
    w.sentryProjectiles = []; w.texts = []; w.particles = []; w.explosions = []; w.buildSolids();
  });
  await b.waitFor('Warz.debug.match().world.sentryProjectiles.some(g=>g.kind==="grenades" && g.z>120)');
  await b.shot('grenade-sentry-high-arc.png');
  await b.waitFor('Warz.debug.match().world.sentryProjectiles.some(g=>g.kind==="grenades" && g.flightElapsed>g.flightTime*.8 && g.z<80)');
  await b.shot('grenade-sentry-low-arc.png');
  await evaluate(() => {
    const m = Warz.debug.match(), w = m.world, s = w.structures.find(s => s.item === Warz.SENTRY_IV.cannons.item);
    w.structures.forEach(other => { other.alive = other === s; });
    const target = w.players.find(p => p.id === sentryVisualQA.targets[5]);
    w.players.forEach(p => { if (p !== m.player && p !== target) p.x = p.y = 16000; });
    s.x = 4750; s.y = 5000; s.cooldown = 0; target.x = target.px = 5450; target.y = target.py = 5000;
    m.player.y = m.player.py = 5200;
    w.sentryProjectiles = []; w.texts = []; w.particles = []; w.explosions = []; w.buildSolids();
  });
  await b.waitFor('Warz.debug.match().world.sentryProjectiles.some(g=>g.kind==="cannons")');
  await b.shot('cannon-sentry-projectile.png');
  check(b.errors.length === 0, 'Sentry, projectile, hit and status visuals render without browser exceptions');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, simulation: await evaluate(() => sentryVisualQA), errors: b.errors }, null, 2));
  console.log('Sentry browser visuals: all ' + checks.length + ' checks passed');
} finally { if (b) await b.close(); if (!publishedUrl) await app.close(); }
