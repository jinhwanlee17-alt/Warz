// Physical E, movement and mouse input through Practice and a real local Squad match.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-vehicles');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 8,
  log: { info() {}, warn: console.warn, error: console.error } });
let browser;
const checks = [], check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
function clearTerrain(W, world) {
  ['rocks', 'trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations'].forEach(key => world.map[key] = []);
  world.solids = new W.U.SpatialHash(256);
}
function prepare(W, world, p, teams) {
  clearTerrain(W, world); world.teams = teams;
  world.vehicles.forEach((v, i) => {
    v.x = i ? 10000 + i * 300 : 5000; v.y = i ? 10000 : 5000; v.angle = v.gunAngle = 0;
    v.vx = v.vy = v.ox = v.oy = 0; v.wreck = false; v.hp = v.maxHp = 1000; v.armed = teams && i < 2;
    v.seats = { driver: 0, gunner: 0, rearLeft: 0, rearRight: 0 };
  });
  world.players.forEach(other => { other.vehicle = 0; other.vehicleSeat = null; other.dropT = 0; other.x = other.y = 15000; other.vx = other.vy = 0; });
  world.setClass(p, 'grenadier2', true); p.items[0] = { id: 'grenade', n: 5 }; p.held = 0;
  p.hp = p.maxHp; p.alive = true; p.downed = false;
  const at = world.vehicleSeatPoint(world.vehicles[0], 'driver', true);
  p.x = p.px = at.x; p.y = p.py = at.y;
}
try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = (code, down) => browser.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code,
    key: code === 'Escape' ? 'Escape' : code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code === 'Escape' ? 27 : code.charCodeAt(code.length - 1) });
  const press = async code => { await key(code, true); await sleep(90); await key(code, false); await sleep(90); };
  const mouse = async down => {
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1150, y: 450 });
    await browser.cmd('Input.dispatchMouseEvent', { type: down ? 'mousePressed' : 'mouseReleased', x: 1150, y: 450,
      button: 'left', buttons: down ? 1 : 0, clickCount: 1 });
  };
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  await evaluate(() => {
    window.vehicleQA = { cars: [], personalWeapons: 0, trajectories: 0, events: [] };
    const r = Warz.debug.renderer(), vehicle = r.drawVehicle, weapon = r.drawWeapon, trajectory = r.drawTrajectory;
    r.drawVehicle = function (ctx, w, v, ...args) { vehicleQA.cars.push({ id: v.id, wreck: v.wreck, armed: v.armed }); if (vehicleQA.cars.length > 80) vehicleQA.cars.shift(); return vehicle.call(this, ctx, w, v, ...args); };
    r.drawWeapon = function (...args) { if (Warz.debug.player() && Warz.debug.player().vehicle) vehicleQA.personalWeapons++; return weapon.apply(this, args); };
    r.drawTrajectory = function (...args) { if (Warz.debug.player() && Warz.debug.player().vehicle) vehicleQA.trajectories++; return trajectory.apply(this, args); };
  });

  for (const scenario of [{ label: 'Practice Solo', online: false, teams: false }, { label: 'Practice Team', online: false, teams: true }, { label: 'Online Squad', online: true, teams: true }]) {
    const { label, online, teams } = scenario, prefix = label.toLowerCase().replaceAll(' ', '-');
    if (online) {
      await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('squad'); });
      await browser.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>1');
    } else await evaluate(() => { if (Warz.debug.match()) Warz.App.leaveMatch(); Warz.App.startPractice(); });
    const live = online ? app.matches.get(String(await evaluate(() => Warz.debug.match().id))) : null;
    const owner = live ? live.byId.get(await evaluate(() => Warz.debug.player().id)) : null;
    check(await evaluate(() => {
      const w = Warz.debug.match().world;
      return w.vehicles.length === 8 && w.vehicles.every(v => v.hp === 1000) && w.vehicles.filter(v => v.armed).length === (w.teams ? 2 : 0);
    }), label + ': eight 1000-HP Humvees spawn with the correct mode-specific turret count');
    let events = [];
    if (live) {
      for (const p of live.players.filter(p => p !== owner)) p.controller = () => ({ mx: 0, my: 0 });
      prepare(live.W, live.world, owner, teams);
      const emit = live.world.emit;
      live.world.emit = function (event) { events.push({ type: event.type, weapon: event.weapon, cause: event.cause }); return emit.call(this, event); };
      await evaluate(src => { (0, eval)('(' + src + ')')(Warz, Warz.debug.match().world); }, clearTerrain.toString());
      await browser.waitFor('Warz.debug.match().world.vehicles[0].x===5000 && Warz.debug.player().classId==="grenadier2"');
    } else {
      await evaluate((clear, prep, teams) => {
        window.clearTerrain = (0, eval)('(' + clear + ')');
        const m = Warz.debug.match(); (0, eval)('(' + prep + ')')(Warz, m.world, m.player, teams); m.world.storm = null;
        const emit = m.world.emit;
        m.world.emit = function (event) { vehicleQA.events.push({ type: event.type, weapon: event.weapon, cause: event.cause }); return emit.call(this, event); };
      }, clearTerrain.toString(), prepare.toString(), teams);
    }
    await evaluate(() => { const m = Warz.debug.match(); m.cam.x = 5000; m.cam.y = 5000; m.cam.zoom = 1; vehicleQA.cars = []; vehicleQA.personalWeapons = 0; vehicleQA.trajectories = 0; vehicleQA.events = []; });
    const eventList = () => online ? events : evaluate(() => vehicleQA.events);
    const resetEvents = async () => { events = []; await evaluate(() => { vehicleQA.events = []; }); };
    const putAtSeat = async seat => {
      if (live) {
        const at = live.world.vehicleSeatPoint(live.world.vehicles[0], seat, true);
        owner.x = at.x; owner.y = at.y; owner.vx = owner.vy = 0;
      } else await evaluate(seat => {
        const m = Warz.debug.match(), at = m.world.vehicleSeatPoint(m.world.vehicles[0], seat, true);
        m.player.x = m.player.px = at.x; m.player.y = m.player.py = at.y; m.player.vx = m.player.vy = 0;
      }, seat);
      await sleep(200);
    };
    const enter = async seat => {
      await putAtSeat(seat); await browser.waitFor('document.getElementById("hud-prompt").textContent.includes("' + (seat === 'driver' ? 'Drive Humvee' : seat === 'gunner' ? 'Humvee Turret I' : 'Ride Humvee') + '")');
      await press('KeyE'); await browser.waitFor('Warz.debug.player().vehicleSeat===' + JSON.stringify(seat));
    };
    const exit = async () => { await press('KeyE'); await browser.waitFor('!Warz.debug.player().vehicle'); };
    if (!teams) {
      await putAtSeat('rearLeft'); await press('KeyE');
      check(await evaluate(() => !Warz.debug.player().vehicle), label + ': rear passenger access is unavailable in Solo');
    }
    await enter('driver');
    check(await evaluate(() => !document.getElementById('hud-vehicle').hidden && document.getElementById('hud-vehicle-role').textContent === 'Driver' && document.getElementById('hud-vehicle-text').textContent === '1000 / 1000 Vehicle HP'),
      label + ': entering the driver seat shows role, vehicle health and exit instructions');
    await resetEvents();
    const ammo = await evaluate(() => Warz.debug.player().weapons[0].ammo);
    await mouse(true); await sleep(400); await mouse(false);
    check(!(await eventList()).some(e => ['shot', 'launch', 'throw', 'vehicle-shot'].includes(e.type)) && await evaluate(() => !vehicleQA.trajectories),
      label + ': driver cannot fire personal weapons, throw held grenades or show a trajectory');
    const start = await evaluate(() => Warz.debug.match().world.vehicles[0].x);
    await key('KeyD', true); await sleep(850); await key('KeyD', false); await sleep(120);
    check(await evaluate(x => {
      const m = Warz.debug.match(), v = m.world.vehicles[0], at = m.world.vehicleSeatPoint(v, 'driver');
      return v.x - x > 250 && Math.hypot(m.player.x - at.x, m.player.y - at.y) < 2 && document.getElementById('hud-ammo').textContent === 'Drive';
    }, start), label + ': physical movement drives the Humvee and carries the driver seat');
    await browser.shot(prefix + '-driver.png');
    check(await evaluate(() => vehicleQA.cars.some(v => v.id === Warz.debug.player().vehicle) && vehicleQA.personalWeapons === 0),
      label + ': vehicle renders with occupants and no floating personal weapon');
    await exit();
    check(await evaluate(() => document.getElementById('hud-vehicle').hidden), label + ': E exits safely and restores the personal HUD');

    if (teams) {
      await enter('rearLeft');
      const stopped = await evaluate(() => ({ x: Warz.debug.match().world.vehicles[0].x, y: Warz.debug.match().world.vehicles[0].y }));
      await resetEvents(); await key('KeyD', true); await mouse(true); await sleep(500); await mouse(false); await key('KeyD', false);
      check(await evaluate(at => {
        const v = Warz.debug.match().world.vehicles[0];
        return Math.hypot(v.x - at.x, v.y - at.y) < 3 && document.getElementById('hud-ammo').textContent === 'Ride';
      }, stopped) && !(await eventList()).some(e => ['shot', 'launch', 'throw', 'vehicle-shot'].includes(e.type)),
      label + ': rear passenger can ride but cannot drive or fire');
      await browser.shot(prefix + '-passenger.png'); await exit();
      await enter('rearRight');
      check(await evaluate(() => Warz.debug.player().vehicleSeat === 'rearRight'), label + ': second rear passenger access selects its own seat');
      await exit(); await enter('gunner');
      // Fill the other three seats with actual teammate players, then let the separate driver move.
      if (live) {
        const mates = live.players.filter(p => p !== owner && p.team === owner.team).slice(0, 3);
        assert.equal(mates.length, 3, 'Squad supplies three crew members');
        ['driver', 'rearLeft', 'rearRight'].forEach((seat, i) => {
          const p = mates[i], at = live.world.vehicleSeatPoint(live.world.vehicles[0], seat, true);
          p.x = at.x; p.y = at.y; p.dropT = 0; live.world.enterVehicle(p, live.world.vehicles[0], seat);
        });
        live.vehicleQaCrew = mates;
        mates[0].controller = () => ({ mx: 1, my: 0 });
      } else await evaluate(() => {
        const m = Warz.debug.match(), v = m.world.vehicles[0];
        window.vehicleQaCrew = ['driver', 'rearLeft', 'rearRight'].map((seat, i) => {
          const at = m.world.vehicleSeatPoint(v, seat, true), p = m.world.addPlayer({ name: 'Crew ' + (i + 1), team: m.player.team, x: at.x, y: at.y, color: '#68b9ff', outline: '#2f648a' });
          p.controller = () => ({ mx: i === 0 ? 1 : 0, my: 0 }); m.world.enterVehicle(p, v, seat); return p;
        });
      });
      const crewStart = await evaluate(() => Warz.debug.match().world.vehicles[0].x);
      await sleep(550);
      if (live) live.vehicleQaCrew[0].controller = () => ({ mx: 0, my: 0 });
      else await evaluate(() => { vehicleQaCrew[0].controller = () => ({ mx: 0, my: 0 }); });
      check(await evaluate(x => {
        const w = Warz.debug.match().world, v = w.vehicles[0];
        return v.x - x > 100 && Object.values(v.seats).filter(Boolean).length === 4 && Object.entries(v.seats).every(([seat, id]) => {
          const rider = w.playerById(id), at = w.vehicleSeatPoint(v, seat);
          return rider && rider.vehicle === v.id && Math.hypot(rider.x - at.x, rider.y - at.y) < 2;
        });
      }, crewStart), label + ': separate driver carries the gunner and both rear passengers in their assigned seats');
      await resetEvents(); await mouse(true); await sleep(650); await mouse(false);
      const fired = await eventList();
      check(fired.filter(e => e.type === 'vehicle-shot').length >= 5 && !fired.some(e => ['launch', 'throw'].includes(e.type)) &&
        await evaluate(ammo => Warz.debug.player().weapons[0].ammo === ammo && !vehicleQA.trajectories && document.getElementById('hud-ammo-label').textContent.includes('Turret I'), ammo),
      label + ': launcher-equipped gunner auto-fires only Turret I without launcher ammo or grenade use');
      await browser.shot(prefix + '-gunner.png');
      if (online) {
        await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await sleep(180);
        check(await evaluate(() => {
          const panel = document.getElementById('hud-vehicle'), box = panel.getBoundingClientRect();
          return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && panel.scrollWidth <= panel.clientWidth;
        }), '390px: vehicle role, health and seat status fit the screen without horizontal overflow');
        await browser.shot('online-squad-gunner-390.png');
        await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      }
      await mouse(true); await sleep(150); await exit(); await resetEvents(); await mouse(false); await sleep(200);
      check(!(await eventList()).some(e => ['launch', 'throw'].includes(e.type)), label + ': exiting while holding fire does not release a stored personal projectile');
      if (live) live.vehicleQaCrew.forEach(p => { live.world.exitVehicle(p, true); p.x = p.y = 15000; });
      else await evaluate(() => { const w = Warz.debug.match().world; vehicleQaCrew.forEach(p => { w.exitVehicle(p, true); p.x = p.y = 15000; }); });
      await sleep(220);
      check(await evaluate(() => Warz.debug.match().world.vehicles[0].flash === 0), label + ': turret muzzle flash fades after firing stops');
      await enter('driver');
    } else await enter('driver');

    if (live) live.world.damageVehicle(live.world.vehicles[0], 700, null, 'test');
    else await evaluate(() => { const w = Warz.debug.match().world; w.damageVehicle(w.vehicles[0], 700, null, 'test'); });
    await browser.waitFor('document.getElementById("hud-vehicle-text").textContent==="300 / 1000 Vehicle HP"');
    check(await evaluate(() => Warz.debug.player().hp === Warz.debug.player().maxHp && parseFloat(document.getElementById('hud-vehicle-fill').style.width) === 30),
      label + ': hull takes damage while occupant health is preserved and the HUD updates');
    await browser.shot(prefix + '-damaged.png');
    if (live) live.world.damageVehicle(live.world.vehicles[0], 1000, null, 'test');
    else await evaluate(() => { const w = Warz.debug.match().world; w.damageVehicle(w.vehicles[0], 1000, null, 'test'); });
    await browser.waitFor('Warz.debug.match().world.vehicles[0].wreck && !Warz.debug.player().vehicle');
    await sleep(700);
    check(await evaluate(() => {
      const v = Warz.debug.match().world.vehicles[0];
      return v.hp === 0 && Object.values(v.seats).every(id => !id) && vehicleQA.cars.some(c => c.id === v.id && c.wreck) && document.getElementById('hud-vehicle').hidden;
    }), label + ': destroyed Humvee becomes a visible wreck, ejects occupants and clears seat HUD');
    const wreck = await evaluate(() => { const v = Warz.debug.match().world.vehicles[0]; return { x: v.x, y: v.y }; });
    if (live) { live.world.damageVehicle(live.world.vehicles[0], 9999, null, 'test'); owner.x = wreck.x + 150; owner.y = wreck.y; }
    else await evaluate(() => { const m = Warz.debug.match(), v = m.world.vehicles[0]; m.world.damageVehicle(v, 9999, null, 'test'); m.player.x = v.x + 150; m.player.y = v.y; });
    await sleep(150); await key('KeyA', true); await sleep(450); await key('KeyA', false); await press('KeyE');
    check(await evaluate(at => {
      const m = Warz.debug.match(), v = m.world.vehicles[0], p = m.player;
      return !p.vehicle && v.hp === 0 && v.wreck && Math.hypot(v.x - at.x, v.y - at.y) < 0.01 && Math.hypot(p.x - v.x, p.y - v.y) >= v.r + p.r - 2;
    }, wreck), label + ': wreck is invincible, immovable, solid and cannot be entered');
    await browser.shot(prefix + '-wreck.png');
  }
  check(browser.errors.length === 0, 'No browser exceptions in vehicle rendering, seats, driving, firing or wrecks' + (browser.errors.length ? ': ' + browser.errors.join('\n') : ''));
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, errors: browser.errors }, null, 2));
  console.log('Vehicle browser QA: ' + checks.length + ' checks passed');
} finally {
  if (browser) await browser.close();
  await app.close();
}
