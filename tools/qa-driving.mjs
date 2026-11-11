// Direction-change samples and physical crate/wall contacts through the real browser input path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-driving');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 8,
  log: { info() {}, warn: console.warn, error: console.error } });
let browser;
const checks = [], runs = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function clear(W, w) {
  ['rocks', 'trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations'].forEach(k => w.map[k] = []);
  w.solids = new W.U.SpatialHash(256); w.bullets = []; w.grenades = []; w.structures = [];
}
function fixture(W, w, kind) {
  clear(W, w);
  const v = w.vehicles[0];
  // Each fixture is a fresh terrain set; it may reuse crate id 0 from the previous fixture.
  v.predictedCrates = {};
  if (!w.remote) {
    v.x = v.y = 5000; v.vx = v.vy = v.ox = v.oy = v.oa = 0; v.angle = 0; v.gunAngle = 0;
    v.speed = 0; w.syncVehicleSeats(v);
  }
  if (kind === 'fast' || kind === 'slow') {
    const hp = W.CRATES.common.hp;
    w.map.crates.push({ id: 0, tier: 'common', x: kind === 'fast' ? 5900 : 5120, y: 5000,
      size: W.CONFIG.crateSize, hp, maxHp: hp, alive: true, shake: 0 });
  } else if (kind === 'wall') {
    w.map.buildings.push({ x: 5300, y: 4750, w: 150, h: 500, roof: '#7a6a9a', ridgeVertical: true, fade: 1,
      walls: [{ x: 5300, y: 4750, w: 150, h: 500 }] });
  }
  w.buildSolids();
}

try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = (code, down) => browser.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code,
    key: code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(code.length - 1) });
  const press = async code => { await key(code, true); await sleep(80); await key(code, false); await sleep(100); };
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  await evaluate(() => {
    window.drivingQA = { capture: false, samples: [], events: [] };
    const renderer = Warz.debug.renderer(), draw = renderer.drawVehicle;
    renderer.drawVehicle = function (ctx, w, v, ...args) {
      if (drivingQA.capture && v.id === w.vehicles[0].id) {
        const a = v.angle + (v.oa || 0), ca = Math.cos(a), sa = Math.sin(a);
        const offsets = { driver: [20, -20], gunner: [0, 0], rearLeft: [-35, -24], rearRight: [-35, 24] };
        const errors = Object.entries(v.seats).filter(([, id]) => id).map(([seat, id]) => {
          const p = w.playerById(id), [x, y] = offsets[seat];
          return p ? Math.hypot(p.x + (p.ox || 0) - (v.x + (v.ox || 0) + x * ca - y * sa),
            p.y + (p.oy || 0) - (v.y + (v.oy || 0) + x * sa + y * ca)) : 0;
        });
        drivingQA.samples.push({ t: performance.now(), x: v.x + (v.ox || 0), y: v.y + (v.oy || 0),
          angle: a, rawAngle: v.angle, speed: Math.hypot(v.vx, v.vy), gunAngle: v.gunAngle,
          seatError: Math.max(0, ...errors), occupied: errors.length });
      }
      return draw.call(this, ctx, w, v, ...args);
    };
  });

  for (const online of [false, true]) {
    const label = online ? 'Online Squad' : 'Practice', prefix = online ? 'online' : 'practice';
    if (online) {
      await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('squad'); });
      await browser.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>1');
    } else await evaluate(() => Warz.App.startPractice());
    const live = online ? app.matches.get(String(await evaluate(() => Warz.debug.match().id))) : null;
    const owner = live ? live.byId.get(await evaluate(() => Warz.debug.player().id)) : null;
    let serverEvents = [];
    const run = { label, segments: {}, tuning: await evaluate(() => Warz.VEHICLE) }; runs.push(run);
    await evaluate(clear => { window.clear = (0, eval)('(' + clear + ')'); }, clear.toString());
    if (live) {
      clear(live.W, live.world);
      live.players.forEach(p => { p.dropT = 0; p.x = p.y = 15000; if (p !== owner) p.controller = () => ({ mx: 0, my: 0 }); });
      live.world.vehicles.forEach((v, i) => { v.x = i ? 12000 + i * 300 : 5000; v.y = i ? 12000 : 5000; v.vx = v.vy = 0; v.angle = 0; });
      const at = live.world.vehicleSeatPoint(live.world.vehicles[0], 'driver', true); owner.x = at.x; owner.y = at.y;
      const emit = live.world.emit;
      live.world.emit = function (e) { serverEvents.push({ type: e.type, id: e.crate?.id ?? e.pickup?.id, src: e.source?.id }); return emit.call(this, e); };
      await evaluate(() => clear(Warz, Warz.debug.match().world));
      await browser.waitFor('Warz.debug.match().world.vehicles[0].x===5000 && Warz.debug.player().dropT===0');
    } else await evaluate(() => {
      const m = Warz.debug.match(), w = m.world, p = m.player;
      clear(Warz, w); w.teams = true; w.storm = null;
      w.vehicles.forEach((v, i) => { v.x = i ? 12000 + i * 300 : 5000; v.y = i ? 12000 : 5000; v.vx = v.vy = 0; v.angle = 0; v.armed = i < 2; });
      p.dropT = 0; const at = w.vehicleSeatPoint(w.vehicles[0], 'driver', true); p.x = at.x; p.y = at.y;
      const emit = w.emit;
      w.emit = function (e) { drivingQA.events.push({ type: e.type, id: e.crate?.id ?? e.pickup?.id, src: e.source?.id }); return emit.call(this, e); };
    });
    await evaluate(() => { const m = Warz.debug.match(); m.cam.x = 5000; m.cam.y = 5000; m.cam.zoom = 1; });
    await press('KeyE'); await browser.waitFor('Warz.debug.player().vehicleSeat==="driver"');
    if (live) {
      const mates = live.players.filter(p => p !== owner && p.team === owner.team).slice(0, 3), v = live.world.vehicles[0];
      ['gunner', 'rearLeft', 'rearRight'].forEach((seat, i) => {
        const p = mates[i], at = live.world.vehicleSeatPoint(v, seat, true); p.x = at.x; p.y = at.y;
        live.world.enterVehicle(p, v, seat); p.controller = () => ({ mx: 0, my: 0, aimX: v.x + 1000, aimY: v.y });
      });
    } else await evaluate(() => {
      const m = Warz.debug.match(), w = m.world, v = w.vehicles[0];
      ['gunner', 'rearLeft', 'rearRight'].forEach((seat, i) => {
        const at = w.vehicleSeatPoint(v, seat, true), p = w.addPlayer({ name: 'Crew ' + (i + 1), team: m.player.team, x: at.x, y: at.y });
        w.enterVehicle(p, v, seat); p.controller = () => ({ mx: 0, my: 0, aimX: v.x + 1000, aimY: v.y });
      });
    });
    await sleep(150);
    const begin = () => evaluate(() => { drivingQA.samples = []; drivingQA.capture = true; });
    const finish = () => evaluate(() => { drivingQA.capture = false; return drivingQA.samples; });
    const read = () => evaluate(() => { const v = Warz.debug.match().world.vehicles[0]; return { x: v.x, y: v.y, angle: v.angle + (v.oa || 0), speed: Math.hypot(v.vx, v.vy) }; });
    await key('KeyD', true); await sleep(1100);
    check((await read()).speed > run.tuning.maxSpeed * 0.9, label + ': holding D accelerates to near top speed');
    await begin(); await browser.shot(prefix + '-turn-0-right.png');
    await key('KeyD', false); await key('KeyW', true);
    await sleep(150); await browser.shot(prefix + '-turn-1-early.png');
    await sleep(160); await browser.shot(prefix + '-turn-2-middle.png');
    await sleep(550); await browser.shot(prefix + '-turn-3-up.png');
    const turn = await finish(); run.segments.turn = turn;
    const changes = turn.slice(1).map((s, i) => Math.abs(angleDelta(s.angle, turn[i].angle)));
    const middle = turn.filter(s => s.angle < -0.12 && s.angle > -1.44);
    check(middle.length >= 5 && Math.max(...changes) < 25 * Math.PI / 180 && Math.abs(angleDelta(turn.at(-1).angle, -Math.PI / 2)) < 0.12,
      label + ': D to W rotates through intermediate headings without an instant 45/90-degree snap');
    check(turn.at(-1).x - turn[0].x > 25 && turn.at(-1).y - turn[0].y < -150 &&
      middle.some((s, i) => i && s.x > middle[i - 1].x && s.y < middle[i - 1].y),
      label + ': the moving Humvee traces a continuous forward arc before travelling upward');
    check(turn.every(s => s.occupied === 4 && s.seatError < 3 && Math.abs(angleDelta(s.gunAngle, 0)) < 0.02),
      label + ': all four seats stay attached during the turn while gunner aim remains independent');
    await key('KeyW', false); await sleep(1400);
    check((await read()).speed < 5, label + ': releasing movement brakes to a stable stop');
    await begin(); await key('KeyA', true); await sleep(800); await key('KeyA', false);
    const stopTurn = await finish(); run.segments.stopTurn = stopTurn;
    check(stopTurn.length > 5 && stopTurn.slice(1).every((s, i) => Math.abs(angleDelta(s.angle, stopTurn[i].angle)) < 25 * Math.PI / 180),
      label + ': restarting toward another direction also turns smoothly');
    await sleep(1200);

    const reset = async kind => {
      await key('KeyD', false); await key('KeyW', false); await key('KeyA', false);
      if (live) fixture(live.W, live.world, kind);
      await evaluate((src, kind, online) => {
        const m = Warz.debug.match(); (0, eval)('(' + src + ')')(Warz, m.world, kind);
        if (!online) m.world.syncVehicleSeats(m.world.vehicles[0]);
        m.cam.x = 5000; m.cam.y = 5000; m.cam.zoom = 1;
      }, fixture.toString(), kind, online);
      await sleep(220); serverEvents = [];
      await evaluate(() => { drivingQA.events = []; });
    };
    const events = () => live ? serverEvents : evaluate(() => drivingQA.events);
    await reset('fast'); await begin(); await key('KeyD', true); await sleep(2200); await key('KeyD', false);
    run.segments.crush = await finish();
    await browser.waitFor('!Warz.debug.match().world.map.crates[0].alive');
    const crushedEvents = await events(), lootEvents = crushedEvents.filter(e => e.type === 'spawn-pickup');
    check(crushedEvents.filter(e => e.type === 'crate' && e.id === 0).length === 1 && lootEvents.length > 0 &&
      await evaluate(() => Warz.debug.match().world.vehicles[0].x > 5940),
      label + ': near-full-speed contact breaks the crate, drops loot and drives through it');
    const nearCrate = run.segments.crush.filter(s => s.x > 5740 && s.x < 6060);
    check(nearCrate.length > 2 && nearCrate.every(s => s.speed > run.tuning.maxSpeed * 0.7),
      label + ': crate impact keeps forward speed without a prediction stop or rollback');
    await browser.shot(prefix + '-crate-crushed.png');
    await key('KeyD', true); await sleep(300); await key('KeyD', false); await sleep(150);
    const afterEvents = await events();
    check(afterEvents.filter(e => e.type === 'crate' && e.id === 0).length === 1 && afterEvents.filter(e => e.type === 'spawn-pickup').length === lootEvents.length,
      label + ': a crushed crate awards its loot only once');

    await reset('slow'); await key('KeyD', true); await sleep(900); await key('KeyD', false);
    check(await evaluate(() => {
      const w = Warz.debug.match().world, c = w.map.crates[0], v = w.vehicles[0];
      return c.alive && c.hp === c.maxHp && v.x <= c.x - c.size / 2 - v.r + 1;
    }) && !(await events()).some(e => e.type === 'crate' || e.type === 'spawn-pickup'),
      label + ': a low-speed bump leaves the crate intact and blocks the vehicle');
    await browser.shot(prefix + '-crate-slow-blocked.png');
    await reset('wall'); await key('KeyD', true); await sleep(1400); await key('KeyD', false);
    check(await evaluate(() => { const v = Warz.debug.match().world.vehicles[0]; return v.x <= 5300 - v.r + 1 && v.x > 5050; }),
      label + ': walls remain solid and stop the Humvee');
    await browser.shot(prefix + '-wall-blocked.png');
  }
  check(browser.errors.length === 0, 'No browser exceptions in smooth driving and crate crushing' + (browser.errors.length ? ': ' + browser.errors.join('\n') : ''));
  console.log('Driving browser QA: ' + checks.length + ' checks passed');
} finally {
  if (browser) {
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, runs, errors: browser.errors }, null, 2));
    await browser.close();
  }
  await app.close();
}
