// Actual keyboard/mouse tank controls, cover damage and centered turret seating.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-tanks');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 8,
  log: { info() {}, warn: console.warn, error: console.error } });
let browser;
const checks = [], observations = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
function terrain(W, w) {
  ['trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations', 'drops'].forEach(k => w.map[k] = []);
  w.map.rocks = [0, 1, 2].map(i => {
    const x = 4800 + i * 200, y = 4700, r = 50;
    return { id: i, x, y, r, alive: true, pts: Array.from({ length: 16 }, (_, j) => j % 2 ? y + Math.sin(Math.floor(j / 2) / 8 * Math.PI * 2) * r : x + Math.cos(Math.floor(j / 2) / 8 * Math.PI * 2) * r) };
  });
  w.structures = []; w.solids = new W.U.SpatialHash(256); w.buildSolids();
}
function prepare(W, w, p) {
  terrain(W, w);
  w.vehicles.forEach((v, i) => {
    v.x = v.id === 9 ? 5000 : v.id === 1 ? 4600 : 14000 + i * 300; v.y = v.id === 9 || v.id === 1 ? 5000 : 14000;
    v.angle = v.gunAngle = v.cannonAngle = 0; v.vx = v.vy = v.ox = v.oy = v.oa = 0;
    v.seats = { driver: 0, gunner: 0, rearLeft: 0, rearRight: 0 };
  });
  w.players.forEach(o => { o.vehicle = 0; o.mount = 0; o.vehicleSeat = null; o.dropT = 0; o.x = o.y = 16000; o.vx = o.vy = 0; });
  w.setClass(p, 'grenadier2', true); p.alive = true; p.downed = false; p.hp = p.maxHp; p.held = -1;
  const at = w.vehicleSeatPoint(w.vehicleById(9), 'driver', true);
  p.x = p.px = at.x; p.y = p.py = at.y;
}
function ramTerrain(W, w, kind) {
  const r = w.map.rocks[0], x = kind === 'natural' ? 5900 : 9000, y = 6000;
  const dx = x - r.x, dy = y - r.y;
  r.pts = r.pts.map((n, i) => n + (i % 2 ? dy : dx)); r.x = x; r.y = y; delete r.hp; delete r.maxHp; r.alive = true;
  w.solids = new W.U.SpatialHash(256); w.buildSolids();
}
function ramFixture(W, w, p, kind) {
  ramTerrain(W, w, kind);
  if (p.vehicle) w.exitVehicle(p, true);
  const v = w.vehicleById(10); v.x = 5000; v.y = 6000; v.angle = v.cannonAngle = v.gunAngle = 0;
  v.vx = v.vy = v.ox = v.oy = v.oa = 0; v.hp = v.maxHp = 5000; v.wreck = false; v.contacts = {}; v.ramUntil = {};
  v.seats = { driver: 0, gunner: 0, rearLeft: 0, rearRight: 0 };
  p.vehicle = 0; p.vehicleSeat = null; p.mount = 0; p.dropT = 0; p.vx = p.vy = 0;
  const at = w.vehicleSeatPoint(v, 'driver', true); p.x = p.px = at.x; p.y = p.py = at.y;
  w.qaRamTarget = kind === 'natural' ? w.map.rocks[0] : w.addStruct({ kind: 'rock', item: 'rock', x: 5900, y: 6000, r: W.ITEMS.rock.radius || 46,
    hp: 1000, maxHp: 1000, owner: p.id, team: p.team });
  w.qaRam = [];
  if (!w.qaRamWatching) {
    const drive = w.driveVehicle;
    w.driveVehicle = function (car, ...args) {
      const before = car.hp, result = drive.call(this, car, ...args);
      if (car.id === 10 && car.hp < before) this.qaRam.push({ hp: car.hp, targetHp: this.qaRamTarget.hp, alive: this.qaRamTarget.alive, speed: Math.hypot(car.vx, car.vy), maxSpeed: W.TANK.maxSpeed });
      return result;
    };
    w.qaRamWatching = true;
  }
}

try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = (code, down) => browser.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code,
    key: code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(code.length - 1) });
  const press = async code => { await key(code, true); await sleep(85); await key(code, false); await sleep(85); };
  const mouse = down => browser.cmd('Input.dispatchMouseEvent', { type: down ? 'mousePressed' : 'mouseReleased', x: 1150, y: 450,
    button: 'left', buttons: down ? 1 : 0, clickCount: 1 });
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  check(await evaluate(() => Math.abs(Warz.VEHICLE.maxSpeed - 378) < 1e-6 && Math.abs(Warz.TANK.maxSpeed - 382.725) < 1e-6),
    'Both vehicle top speeds are thirty percent lower');
  await evaluate(() => {
    window.tankQA = { tankFrames: 0, shellFrames: 0, naturalCount: 0, naturalNoHp: true, naturalHealthDraws: 0, portable: {}, wreckFrames: 0, maxCrew: 0, trajectory: 0, events: [] };
    const r = Warz.debug.renderer(), tank = r.drawTank, shells = r.drawTankShells, drawRock = r.drawRock, health = r.drawRockHealth, render = r.render;
    r.drawTank = function (g, w, v, ...args) {
      tankQA.tankFrames++; if (v.wreck) tankQA.wreckFrames++;
      tankQA.maxCrew = Math.max(tankQA.maxCrew, Object.values(v.seats).filter(Boolean).length);
      return tank.call(this, g, w, v, ...args);
    };
    r.drawTankShells = function (g, w, ...args) { if (w.tankShells.length) tankQA.shellFrames++; return shells.call(this, g, w, ...args); };
    r.drawRock = function (g, rock, ...args) { tankQA.naturalCount++; if ('hp' in rock || 'maxHp' in rock) tankQA.naturalNoHp = false; return drawRock.call(this, g, rock, ...args); };
    r.drawRockHealth = function (g, rock) { if (rock.kind === 'rock') tankQA.portable[rock.hp] = true; else tankQA.naturalHealthDraws++; return health.call(this, g, rock); };
    r.render = function (w, cam, opts) { if (opts.trajectory && Warz.debug.player().vehicle) tankQA.trajectory++; return render.call(this, w, cam, opts); };
  });
  for (const online of [false, true]) {
    const label = online ? 'Online Squad' : 'Practice Solo', prefix = online ? 'online' : 'practice';
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    if (online) {
      await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('squad'); });
      await browser.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>2');
    } else await evaluate(() => Warz.App.startPractice());
    const live = online ? app.matches.get(String(await evaluate(() => Warz.debug.match().id))) : null;
    const owner = live ? live.byId.get(await evaluate(() => Warz.debug.player().id)) : null;
    const mutate = async (fn, ...args) => live ? fn(live.W, live.world, owner, ...args) : evaluate((source, args) => {
      const m = Warz.debug.match(); return (0, eval)('(' + source + ')')(Warz, m.world, m.player, ...args);
    }, fn.toString(), args);
    check(await evaluate(() => {
      const w = Warz.debug.match().world;
      return w.vehicles.filter(v => v.type === 'tank' && v.hp === 5000).length === 4 && w.vehicles.filter(v => v.type === 'humvee').length === 8;
    }), label + ': four 5000-HP tanks join the eight Humvees');
    if (live) {
      for (const p of live.players) if (p !== owner) p.controller = () => ({ mx: 0, my: 0 });
      prepare(live.W, live.world, owner);
      await evaluate(source => { const w = Warz.debug.match().world; (0, eval)('(' + source + ')')(Warz, w); }, terrain.toString());
    } else await evaluate(source => { const m = Warz.debug.match(); window.fixtureTerrain = (0, eval)('(' + source + ')'); }, terrain.toString());
    if (!live) await evaluate((source, prep) => {
      window.terrain = (0, eval)('(' + source + ')'); const m = Warz.debug.match(); (0, eval)('(' + prep + ')')(Warz, m.world, m.player); m.world.storm = null;
    }, terrain.toString(), prepare.toString());
    await evaluate(() => { const m = Warz.debug.match(); m.cam.x = 5000; m.cam.y = 5000; m.cam.zoom = 1; Warz.debug.renderer().map = null;
      tankQA.shellFrames = tankQA.trajectory = tankQA.wreckFrames = tankQA.maxCrew = tankQA.naturalCount = tankQA.naturalHealthDraws = 0; tankQA.naturalNoHp = true; Warz.Hud.banner('', '', 0.01); });
    await browser.waitFor('Warz.debug.match().world.vehicleById(9).x===5000 && document.getElementById("hud-prompt").textContent.includes("Drive Tank")');
    await browser.shot(prefix + '-tank-natural-rocks.png');
    check(await evaluate(() => tankQA.naturalCount >= 3 && tankQA.naturalNoHp && tankQA.naturalHealthDraws === 0 && tankQA.tankFrames > 0),
      label + ': natural rocks render intact without any HP fields, health bars or damage scratches');
    await press('KeyE'); await browser.waitFor('Warz.debug.player().vehicle===9');
    check(await evaluate(() => document.getElementById('hud-vehicle-name').textContent === 'Tank' && document.getElementById('hud-vehicle-text').textContent.includes('5000 / 5000') &&
      document.getElementById('hud-ammo-label').textContent.startsWith('Cannon')), label + ': physical E boards tank with correct HP and cannon HUD');
    await key('KeyD', true); await sleep(650); await key('KeyD', false); await sleep(650);
    check(await evaluate(() => Warz.debug.match().world.vehicleById(9).x - 5000 > Warz.TANK.maxSpeed * 0.3), label + ': physical WASD drives the tank at the revised speed');
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1150, y: 450 });
    await mouse(true); await sleep(180); await browser.shot(prefix + '-cannon-fired.png'); await sleep(220); await mouse(false);
    check(await evaluate(() => { const w = Warz.debug.match().world, v = w.vehicleById(9); return tankQA.shellFrames > 0 && v.cannonCooldown > 1.5 && v.mgAmmo === 1000 && tankQA.trajectory === 0; }),
      label + ': cannon launches a visible shell and cooldown without spending MG ammo or showing a launcher arc');
    await press('Digit2'); await browser.waitFor('Warz.debug.player().vehicleWeapon===1 && document.getElementById("hud-ammo-label").textContent.startsWith("Machine gun")');
    await mouse(true); await sleep(650); await mouse(false);
    check(await evaluate(() => { const v = Warz.debug.match().world.vehicleById(9); return v.mgAmmo <= 995 && v.mgAmmo >= 988 && document.getElementById('hud-ammo-max').textContent === '/ 1000'; }),
      label + ': key2 selects automatic MG with a real 1000-round magazine');
    await press('KeyR'); await browser.waitFor('Warz.debug.match().world.vehicleById(9).mgReload>0 && !document.getElementById("hud-reload").hidden');
    await browser.shot(prefix + '-mg-reloading.png');
    check(await evaluate(() => document.getElementById('hud-vehicle-weapons').textContent.includes('Reloading')), label + ': R displays tank MG reload progress');
    await browser.waitFor('Warz.debug.match().world.vehicleById(9).mgReload===0 && Warz.debug.match().world.vehicleById(9).mgAmmo===1000', 6500);
    check(true, label + ': reload restores the MG magazine');
    await press('Digit1'); await browser.waitFor('Warz.debug.player().vehicleWeapon===0 && document.getElementById("hud-ammo-label").textContent.startsWith("Cannon")');
    await mouse(true); await sleep(180); await mouse(false);
    check(await evaluate(() => { const v = Warz.debug.match().world.vehicleById(9); return v.cannonCooldown > 2 && v.mgAmmo === 1000; }),
      label + ': physical key1 switches back from MG and fires the cannon');
    await press('Digit2');
    if (online) {
      await mutate((W, w, p) => {
        const v = w.vehicleById(9), others = w.players.filter(o => o !== p).slice(0, 3);
        ['rearLeft', 'gunner', 'rearRight'].forEach((seat, i) => {
          const o = others[i], at = w.vehicleSeatPoint(v, seat, true); o.team = p.team; o.x = at.x; o.y = at.y; o.dropT = 0;
          w.enterVehicle(o, v, seat);
        });
      });
      await browser.waitFor('Object.values(Warz.debug.match().world.vehicleById(9).seats).filter(Boolean).length===4');
      check(await evaluate(() => { const w = Warz.debug.match().world; return w.vehicleWeaponFor(Warz.debug.player()) === null && tankQA.maxCrew === 4 && document.getElementById('hud-vehicle-seats').textContent.includes('Cannon operator'); }),
        'Online Squad: all four crew seats render with dedicated cannon and MG ownership');
      await browser.shot('online-full-crew.png');
    }
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false }); await sleep(170);
    check(await evaluate(() => { const r = document.getElementById('hud-vehicle').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }),
      label + ': tank weapon and HP panel fits the compact viewport');
    await browser.shot(prefix + '-mobile-hud.png');
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await mutate((W, w, p) => w.damageVehicle(w.vehicleById(9), 500, null, 'tankcannon'));
    await browser.waitFor('Warz.debug.match().world.vehicleById(9).hp===4500 && document.getElementById("hud-vehicle-text").textContent.includes("4500 / 5000")');
    check(await evaluate(() => document.getElementById('hud-vehicle-text').textContent.includes('4500 / 5000') && Warz.debug.player().hp === Warz.debug.player().maxHp),
      label + ': authoritative tank damage changes hull HUD and protects seated player HP');
    await mutate((W, w, p) => w.damageVehicle(w.vehicleById(9), 5000, null, 'tankcannon'));
    await browser.waitFor('Warz.debug.match().world.vehicleById(9).wreck && !Warz.debug.player().vehicle && tankQA.wreckFrames>0');
    check(true, label + ': destroyed tank becomes a dark wreck and ejects its crew');
    await browser.shot(prefix + '-wreck.png');
    await mutate((W, w, p) => w.damageMapRock(w.map.rocks[0], 'tank-cannon', p.id));
    await browser.waitFor('!Warz.debug.match().world.map.rocks[0].alive');
    check(await evaluate(() => !('hp' in Warz.debug.match().world.map.rocks[0])), label + ': tank cannon instantly removes a natural rock without introducing health');
    await mutate((W, w, p) => {
      for (let i = 0; i < 20; i++) w.damageMapRock(w.map.rocks[2], 'grenade', p.id);
    });
    await sleep(120);
    check(await evaluate(() => { const r = Warz.debug.match().world.map.rocks[2]; return r.alive && !('hp' in r) && !('maxHp' in r) && tankQA.naturalHealthDraws === 0; }),
      label + ': repeated grenades leave natural rock unchanged and no health graphics appear');
    await mutate((W, w, p) => {
      p.x = p.px = 5000; p.y = p.py = 5500; p.vx = p.vy = 0; p.itemCd = 0; p.held = -1;
      p.items = [{ id: 'turret3', n: 1 }, null, null];
    });
    await browser.waitFor('Warz.debug.player().items[0]?.id==="turret3" && Math.abs(Warz.debug.player().y-5500)<5');
    await sleep(200); await press('Digit3');
    await browser.waitFor('Warz.debug.player().held===0');
    const target = await evaluate(() => { const m = Warz.debug.match(); return Warz.debug.renderer().worldToScreen(m.cam, 5120, 5500); });
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(90);
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 });
    await browser.waitFor('Warz.debug.player().mount>0');
    check(await evaluate(() => {
      const m = Warz.debug.match(), p = m.player, s = m.world.structById(p.mount);
      return s.r === 38 && Math.hypot(p.x - s.x, p.y - s.y) < 0.01 && document.getElementById('hud-ammo-label').textContent.startsWith('turret');
    }), label + ': physical turret placement seats the player at the enlarged platform center');
    await browser.shot(prefix + '-placed-turret-seated.png');
    const mounted = await evaluate(() => { const m = Warz.debug.match(), s = m.world.structById(m.player.mount); return { x: s.x, y: s.y, r: s.r }; });
    await press('KeyE'); await browser.waitFor('!Warz.debug.player().mount');
    check(await evaluate(s => { const p = Warz.debug.player(); return Math.hypot(p.x - s.x, p.y - s.y) >= s.r + p.r; }, mounted),
      label + ': E safely leaves the turret outside the enlarged platform');
    for (const kind of ['natural', 'portable']) {
      if (live) {
        ramFixture(live.W, live.world, owner, kind);
        await evaluate((source, kind) => { (0, eval)('(' + source + ')')(Warz, Warz.debug.match().world, kind); }, ramTerrain.toString(), kind);
      } else await evaluate((terrainSource, fixtureSource, kind) => {
        window.ramTerrain = (0, eval)('(' + terrainSource + ')'); const m = Warz.debug.match(); (0, eval)('(' + fixtureSource + ')')(Warz, m.world, m.player, kind);
      }, ramTerrain.toString(), ramFixture.toString(), kind);
      await evaluate(() => { const m = Warz.debug.match(); m.cam.x = 5000; m.cam.y = 6000; Warz.debug.renderer().map = null; });
      await browser.waitFor('Warz.debug.match().world.vehicleById(10).x===5000 && document.getElementById("hud-prompt").textContent.includes("Drive Tank")');
      await press('KeyE'); await browser.waitFor('Warz.debug.player().vehicle===10');
      await key('KeyD', true);
      await browser.waitFor('Warz.debug.match().world.vehicleById(10).hp<5000', 5000);
      await sleep(150); await key('KeyD', false);
      const hits = live ? live.world.qaRam : await evaluate(() => Warz.debug.match().world.qaRam);
      observations.push({ mode: label, ram: kind, hits });
      if (kind === 'natural') {
        check(hits.length === 1 && hits[0].hp === 4950 && !hits[0].alive && hits[0].targetHp === undefined && hits[0].speed > hits[0].maxSpeed * 0.45 && hits[0].speed < hits[0].maxSpeed * 0.65,
          label + ': physical full-speed ram removes natural rock, costs50hullHP and halves tank speed');
      } else {
        check(hits.length === 1 && hits[0].hp === 4925 && hits[0].alive && hits[0].targetHp === 900 && hits[0].speed < 0.01,
          label + ': physical full-speed ram deals100to portable rock, costs75hullHP and stops tank');
        await browser.waitFor('Warz.debug.match().world.structures.some(s=>s.kind==="rock" && s.hp===900)');
        await browser.shot(prefix + '-portable-rock-damaged.png');
        const rockId = await mutate((W, w, p) => {
          const s = w.qaRamTarget; for (let i = 0; i < 7; i++) w.damagePlayerRock(s, p.id); return s.id;
        });
        await browser.waitFor('Warz.debug.match().world.structures.some(s=>s.id===' + rockId + ' && s.hp===200 && s.alive) && tankQA.portable[200]');
        check(true, label + ': portable rock remains visible with a health bar and large cracks at200HP');
        await browser.shot(prefix + '-portable-rock-low-hp.png');
        await mutate((W, w, p) => { w.damagePlayerRock(w.qaRamTarget, p.id); w.damagePlayerRock(w.qaRamTarget, p.id); });
        await browser.waitFor('!Warz.debug.match().world.structures.some(s=>s.id===' + rockId + ' && s.alive)');
        check(true, label + ': portable rock disappears only after its final200HP is removed');
      }
      await press('KeyE'); await browser.waitFor('!Warz.debug.player().vehicle');
    }
    observations.push({ mode: label, state: await evaluate(() => ({ naturalNoHp: tankQA.naturalNoHp, naturalHealthDraws: tankQA.naturalHealthDraws, shellFrames: tankQA.shellFrames, maxCrew: tankQA.maxCrew, wreckFrames: tankQA.wreckFrames })) });
  }
  check(browser.errors.length === 0, 'No browser exceptions during tank, rock and HUD rendering');
  console.log('Tank browser QA: ' + checks.length + ' checks passed');
} catch (error) {
  if (browser) { await browser.shot('failure.png'); observations.push({ failure: error.stack, debug: await browser.evaluate('({p:Warz.debug.player(),v:Warz.debug.match()?.world.vehicleById(9),prompt:document.getElementById("hud-prompt").textContent})').catch(() => null) }); }
  throw error;
} finally {
  if (browser) { fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, observations, errors: [...new Set(browser.errors)] }, null, 2)); await browser.close(); }
  await app.close();
}
