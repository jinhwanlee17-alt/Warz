// Exercise physical mouse/key charging through the actual Practice and online game loops.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
const require = createRequire(import.meta.url), { openBrowser, sleep } = require('./qa-browser.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), outDir = path.join(root, 'output', 'qa-charge');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 50, log: { info() {}, warn: console.warn, error: console.error } });
let b;
const report = [], check = (ok, message) => { assert.ok(ok, message); report.push(message); console.log('ok  ' + message); };
try {
  const { port } = await app.listen(0, '127.0.0.1');
  b = await openBrowser({ outDir });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  await b.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=22' });
  await b.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  const mouse = (type, x = 1100) => b.cmd('Input.dispatchMouseEvent', { type, x, y: 400, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  const key = type => b.cmd('Input.dispatchKeyEvent', { type, code: 'KeyG', key: 'g', windowsVirtualKeyCode: 71 });
  for (const online of [false, true]) {
    if (online) {
      await b.evaluate('Warz.App.leaveMatch(); Warz.Lobby.queue("solo"); true');
      await b.waitFor('Warz.App.state() === "play" && Warz.debug.match().online && Warz.debug.player().dropT === 0', 20000);
    } else await b.evaluate('Warz.App.startPractice(); true');
    const live = online ? app.matches.get(String(await b.evaluate('Warz.debug.online().info.id'))) : null;
    const owner = online ? live.byId.get(await b.evaluate('Warz.debug.player().id')) : null;
    const setup = (w, p, cls, slot, item) => {
      ['rocks', 'trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations'].forEach(k => w.map[k] = []);
      w.solids = new (w.U || globalThis.Warz.U).SpatialHash(256);
      w.resetItems(p); w.setClass(p, cls, true); p.slot = slot; p.hp = p.maxHp = 1e6;
      p.x = 5000; p.y = 5000; p.vx = p.vy = 0; p.alive = true; p.downed = false; p.dropT = 0;
      if (item) { w.addItem(p, item, 3); p.held = 0; }
      w.grenades = []; w.zones = []; w.explosions = []; w.particles = [];
    };
    for (const spec of [
      { cls: 'grenadier', slot: 0, max: 660, min: 140 },
      { cls: 'grenadier2', slot: 0, max: 700, min: 140 },
      { cls: 'grenadier', slot: 1, max: 560, min: 70 },
      { cls: 'soldier', slot: 0, item: 'grenade', max: 560, min: 70 },
      { cls: 'grenadier', slot: 0, gear: true, max: 560, min: 70 }
    ]) {
      const label = (online ? 'Online ' : 'Practice ') + (spec.gear ? 'gear grenade' : spec.item || spec.cls + ' slot ' + spec.slot);
      for (const full of [false, true]) {
        if (online) {
          live.world.U = live.W.U;
          setup(live.world, owner, spec.cls, spec.slot, spec.item);
          await b.waitFor('Warz.debug.player().classId === ' + JSON.stringify(spec.cls));
        }
        await evaluate((setupText, spec, online) => {
          const m = Warz.debug.match(), w = m.world, p = m.player;
          (0, eval)('(' + setupText + ')')(w, p, spec.cls, spec.slot, spec.item);
          if (!online) w.storm = null;
          m.cam.x = p.x; m.cam.y = p.y; m.cam.zoom = 1;
          window.qaLaunch = null; window.qaPreview = null;
          if (!w.qaWatching) {
            for (const name of ['spawnShell', 'spawnGrenade']) {
              const original = w[name];
              w[name] = function (who, solution) {
                const g = original.call(this, who, solution);
                if (who.id === p.id) window.qaLaunch = { range: solution.range || Math.hypot(g.targetX - g.startX, g.targetY - g.startY) + 34, weapon: g.weapon };
                return g;
              };
            }
            const r = Warz.debug.renderer(), render = r.render;
            r.render = function (world, cam, opts) { if (opts && opts.trajectory) window.qaPreview = opts.trajectory.range; return render.call(this, world, cam, opts); };
            w.qaWatching = true;
          }
        }, setup.toString(), spec, online);
        await sleep(200);
        await mouse('mouseMoved', full ? 700 : 1100);
        if (spec.gear) await key('rawKeyDown'); else await mouse('mousePressed', full ? 700 : 1100);
        await sleep(full ? 850 : 20);
        if (full) {
          check(await b.evaluate('qaLaunch === null'), label + ': holding does not fire');
          check(Math.abs(await b.evaluate('qaPreview') - spec.max) < 0.01, label + ': preview reaches maximum at 0.75 seconds');
        }
        if (spec.gear) await key('keyUp'); else await mouse('mouseReleased', full ? 700 : 1100);
        await b.waitFor('qaLaunch !== null', 4000);
        const shot = await b.evaluate('qaLaunch');
        check(full ? Math.abs(shot.range - spec.max) < 0.3 : shot.range >= spec.min - 0.3 && shot.range < spec.min + 120,
          label + ': ' + (full ? 'full hold reaches ' + spec.max : 'quick tap stays short') + ' (' + shot.range.toFixed(1) + ')');
      }
    }
    await b.shot(online ? 'online-charge.png' : 'practice-charge.png');
  }
  await b.evaluate('Warz.App.leaveMatch(); true');
  check(b.errors.length === 0, 'no browser errors');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: report, errors: b.errors }, null, 2));
  console.log('Charge browser QA: ' + report.length + ' checks passed.');
} finally {
  if (b) await b.close();
  await app.close();
}
