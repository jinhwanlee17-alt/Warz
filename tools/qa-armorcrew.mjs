// Disposable Practice + actual local-server input/UI smoke. Never touches a public match.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-armorcrew');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: .2, botFill: 8, log: { info() {}, warn: console.warn, error: console.error } });
let b; const checks = [], observations = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
function clearTerrain(W, w) {
  for (const key of ['trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations', 'drops', 'rocks']) w.map[key] = [];
  w.structures = []; w.solids = new W.U.SpatialHash(256); w.buildSolids();
}
function fixture(W, w, p) {
  for (const v of w.vehicles) {
    v.x = v.id === 9 ? 5000 : 15000 + v.id * 200; v.y = v.id === 9 ? 5000 : 15000;
    v.angle = v.cannonAngle = v.gunAngle = v.vx = v.vy = v.ox = v.oy = v.oa = 0;
    v.hp = v.maxHp; v.wreck = false; v.seats = { driver: 0, gunner: 0, rearLeft: 0, rearRight: 0 };
  }
  for (const o of w.players) { o.vehicle = o.mount = o.repairVehicle = 0; o.vehicleSeat = null; o.dropT = 0; o.x = o.y = 16000; o.vx = o.vy = 0; }
  w.setClass(p, 'armorcrew', true); p.alive = true; p.downed = false; p.hp = p.maxHp; p.held = -1; p.slot = 0; p.x = p.px = 5000; p.y = p.py = 5400; p.angle = 0;
  let target = w.players.find(o => o !== p && o.team !== p.team);
  if (!target) target = w.addPlayer({ name: 'QA target', x: 5068, y: 5400, team: p.team + 100 });
  w.setClass(target, 'soldier', true); target.alive = true; target.downed = false; target.armor = 0; target.hp = 100;
  target.x = 5068; target.y = 5400; target.controller = () => ({ mx: 0, my: 0 }); w.qaTarget = target;
}
try {
  const { port } = await app.listen(0, '127.0.0.1');
  b = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = (code, down) => b.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code, key: code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(code.length - 1) });
  const press = async code => { await key(code, true); await sleep(75); await key(code, false); await sleep(150); };
  const mouse = down => b.cmd('Input.dispatchMouseEvent', { type: down ? 'mousePressed' : 'mouseReleased', x: 1150, y: 450, button: 'left', buttons: down ? 1 : 0, clickCount: 1 });
  const click = async selector => {
    const at = await evaluate(selector => { const e = document.querySelector(selector); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
    await b.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 });
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 }); await sleep(100);
  };
  await b.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
  await b.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  await evaluate(() => {
    window.crewQA = { swings: 0, repairs: 0, sounds: [], shells: 0 };
    const renderer = Warz.debug.renderer(), hammer = renderer.drawHammer, repair = renderer.drawRepair, shell = renderer.drawTankShells, sound = Warz.Audio.play;
    renderer.drawHammer = function (g, r, swing) { if (Warz.debug.player()?.meleeSwing > 0) crewQA.swings++; return hammer.call(this, g, r, swing); };
    renderer.drawRepair = function (...args) { crewQA.repairs++; return repair.apply(this, args); };
    renderer.drawTankShells = function (g, w, ...args) { if (w.tankShells.length) crewQA.shells++; return shell.call(this, g, w, ...args); };
    Warz.Audio.play = function (name, volume) { crewQA.sounds.push(name); return sound.call(this, name, volume); };
    Warz.App.startPractice();
    const m = Warz.debug.match(), p = m.player, station = m.world.map.stations[0];
    p.dropT = 0; m.world.setClass(p, 'sniper', true); p.tokens = 15; p.x = station.x + 70; p.y = station.y; station.cooldown = 0;
    Warz.UpgradeTree.open({ world: m.world, player: p, station });
  });
  await click('#ut-node-armorcrew');
  check(await evaluate(() => !document.getElementById('ut-action').disabled && document.getElementById('ut-detail-title').textContent === 'Armor Crewmember' && document.getElementById('ut-stats').textContent.includes('Humvee: 3.5s') && document.getElementById('ut-stats').textContent.includes('Tank: 2s')),
    'Released Armor Crewmember tree card explains repair and is purchasable');
  await b.shot('armorcrew-upgrade.png'); await click('#ut-action');
  await b.waitFor('Warz.debug.player().classId==="armorcrew"');
  check(await evaluate(() => { const p = Warz.debug.player(); return p.tokens === 0 && p.maxHp === 150 && p.weapons.map(w => w.id).join(',') === 'hammer,pistol'; }),
    'Actual upgrade purchase spends15 tokens and grants150 HP, hammer and pistol');
  await evaluate(() => Warz.UpgradeTree.close());
  for (const online of [false, true]) {
    const label = online ? 'Online Duo' : 'Practice', prefix = online ? 'online' : 'practice';
    await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    if (online) { await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('duo'); }); await b.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>2'); }
    const live = online ? app.matches.get(String(await evaluate(() => Warz.debug.match().id))) : null;
    const owner = live ? live.byId.get(await evaluate(() => Warz.debug.player().id)) : null;
    const mutate = async (fn, ...args) => live ? fn(live.W, live.world, owner, ...args) : evaluate((source, args) => {
      const m = Warz.debug.match(); return (0, eval)('(' + source + ')')(Warz, m.world, m.player, ...args);
    }, fn.toString(), args);
    if (live) { for (const p of live.players) if (p !== owner) p.controller = () => ({ mx: 0, my: 0 }); clearTerrain(live.W, live.world); fixture(live.W, live.world, owner); }
    else await mutate((W, w) => { w.storm = null; });
    await evaluate((clear, init, online) => {
      const m = Warz.debug.match(); (0, eval)('(' + clear + ')')(Warz, m.world);
      if (!online) (0, eval)('(' + init + ')')(Warz, m.world, m.player);
      m.cam.x = 5000; m.cam.y = 5400; m.cam.zoom = 1; Warz.debug.renderer().map = null; Warz.Hud.banner('', '', .01);
      crewQA.swings = crewQA.repairs = crewQA.shells = 0; crewQA.sounds = [];
    }, clearTerrain.toString(), fixture.toString(), online);
    await b.waitFor('Warz.debug.player().classId==="armorcrew" && document.getElementById("hud-ammo").textContent==="Hammer"');
    await sleep(450);
    check(await evaluate(() => !document.getElementById('hud-armor-fill') && document.getElementById('hud-stamina-fill') && document.getElementById('hud-ammo-label').textContent.includes('swing')),
      label + ': armor bar is removed while stamina and hammer controls remain');
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1150, y: 450 });
    await mouse(true); await sleep(90); await b.shot(prefix + '-hammer-swing.png'); await mouse(false); await sleep(150);
    const hit = await mutate((W, w) => ({ hp: w.qaTarget.hp, armor: w.qaTarget.armor }));
    check(hit.hp === 70 && hit.armor === 0 && await evaluate(() => crewQA.swings > 0), label + ': physical click swings visible hammer and deals exactly30 damage');
    check(await evaluate(() => crewQA.sounds.includes('hammer') || crewQA.sounds.includes('melee')), label + ': hammer attack reaches synthesized audio handler');
    for (const [id, name, seconds] of [[1, 'Humvee', 3.5], [9, 'Tank', 2]]) {
      await mutate((W, w, p, id) => {
        w.qaTarget.x = w.qaTarget.y = 16000;
        const v = w.vehicleById(id); v.x = id === 1 ? 4600 : 5000; v.y = 5000; v.hp = v.maxHp - 100;
        p.x = p.px = v.x; p.y = p.py = v.y + v.r + 45; p.vx = p.vy = 0;
        w.qaRepairTiming = { id, elapsed: 0, gain: 0, ticks: 0, maxTick: 0, fractionalError: 0 };
        if (!w.qaRepairWrapped) {
          const update = w.updateVehicleRepair;
          w.updateVehicleRepair = function (p, intent, dt) {
            const clock = this.qaRepairTiming, v = clock && this.vehicleById(clock.id), before = v && v.hp;
            update.call(this, p, intent, dt);
            if (clock && clock.gain < 100 - 1e-7 && v.hp > before) { const gain = v.hp - before; clock.elapsed += dt; clock.gain += gain; clock.ticks++; clock.maxTick = Math.max(clock.maxTick, dt); if (v.hp < v.maxHp) clock.fractionalError = Math.max(clock.fractionalError, Math.abs(gain - this.vehicleRepairRate(v) * dt)); }
          }; w.qaRepairWrapped = true;
        }
      }, id);
      await b.waitFor('document.getElementById("hud-prompt").textContent.includes("Repair ' + name + '")');
      check(await evaluate(seconds => document.getElementById('hud-prompt').textContent.includes('100 HP / ' + seconds + 's'), seconds), label + ': ' + name + ' approach prompt shows its own repair rate');
      await press('KeyF'); await b.waitFor('Warz.debug.player().repairVehicle===' + id);
      check(await evaluate(seconds => document.getElementById('hud-repair-note').textContent.includes('100 HP / ' + seconds + 's'), seconds), label + ': active ' + name + ' repair panel uses the same rate');
      await b.shot(prefix + '-repair-rate-' + name.toLowerCase() + '.png');
      await b.waitFor('Warz.debug.match().world.vehicleById(' + id + ').hp===Warz.debug.match().world.vehicleById(' + id + ').maxHp && !Warz.debug.player().repairVehicle', 7000);
      const timing = await mutate((W, w) => Object.assign({}, w.qaRepairTiming)); observations.push({ mode: label, vehicle: name, timing });
      check(Math.abs(timing.gain - 100) < 1e-7 && timing.elapsed >= seconds - 1e-6 && timing.elapsed <= seconds + timing.maxTick + 1e-6 && timing.fractionalError < 1e-8,
        label + ': ' + name + ' gains exactly100 HP in' + seconds + ' simulation seconds, preserving fractional HP each tick');
    }
    await mutate((W, w, p) => { w.qaTarget.x = 16000; w.qaTarget.y = 16000; p.x = p.px = 5000; p.y = p.py = 5150; p.vx = p.vy = 0; w.vehicleById(9).hp = 4500; });
    await b.waitFor('document.getElementById("hud-prompt").textContent.includes("Repair Tank")');
    await press('KeyF'); await b.waitFor('Warz.debug.player().repairVehicle===9 && !document.getElementById("hud-repair").hidden');
    const before = await mutate((W, w) => ({ time: w.time, hp: w.vehicleById(9).hp })); await sleep(1050);
    const after = await mutate((W, w) => ({ time: w.time, hp: w.vehicleById(9).hp }));
    check(Math.abs((after.hp - before.hp) / (after.time - before.time) - 50) < .05, label + ': tank repair maintains50 HP/s across ordinary browser frames');
    check(await evaluate(() => crewQA.repairs > 0 && document.getElementById('hud-repair-note').textContent.includes('Visible to nearby enemies')),
      label + ': active repair draws welding sparks and explains enemy exposure');
    await b.shot(prefix + '-repair.png');
    await b.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await sleep(180);
    check(await evaluate(() => { const r = document.getElementById('hud-repair').getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight; }), label + ': repair panel fits390px viewport');
    await b.shot(prefix + '-repair-mobile.png');
    await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await press('KeyG'); await b.waitFor('!Warz.debug.player().repairVehicle && document.getElementById("hud-repair").hidden');
    check(true, label + ': physical G toggles repair off');
    await press('Digit2'); await b.waitFor('Warz.debug.player().slot===1');
    await press('KeyF'); await b.waitFor('Warz.debug.player().repairVehicle===9 && Warz.debug.player().slot===0');
    check(true, label + ': starting repair from pistol automatically equips the hammer');
    await press('Digit2'); await b.waitFor('!Warz.debug.player().repairVehicle && Warz.debug.player().slot===1');
    check(true, label + ': selecting the pistol stops repair and restores normal weapon HUD');
    await press('KeyF'); await b.waitFor('Warz.debug.player().repairVehicle===9');
    await key('KeyS', true); await sleep(100); await key('KeyS', false); await b.waitFor('!Warz.debug.player().repairVehicle');
    check(true, label + ': movement cancels repair and hides active feedback');
    await mutate((W, w, p) => { p.x = p.px = 5000; p.y = p.py = 5150; p.vx = p.vy = 0; });
    await sleep(220); await press('KeyE'); await b.waitFor('Warz.debug.player().vehicle===9');
    check(await evaluate(() => Warz.debug.player().vehicleSeat === 'driver'), label + ': E on the opposite hull side still boards the first available driver seat');
    await b.waitFor('Warz.debug.match().world.vehicleById(9).cannonAmmo===2 && document.getElementById("hud-ammo-max").textContent.includes("2")');
    const shotBefore = await mutate((W, w, p) => p.stats.shots);
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1150, y: 450 }); await mouse(true); await sleep(700); await mouse(false); await sleep(100);
    const fired = await mutate((W, w, p) => { const v = w.vehicleById(9); return { shots: p.stats.shots, ammo: v.cannonAmmo, reload: v.cannonReload }; });
    observations.push({ mode: label, repair: { before, after }, fired });
    check(fired.shots - shotBefore === 2 && fired.ammo === 0 && fired.reload > 2 && fired.reload <= 3, label + ': holding click fires two cannon shots then starts the fixed3-second reload');
    check(await evaluate(() => crewQA.shells > 0 && document.getElementById('hud-ammo').textContent === '0' && !document.getElementById('hud-reload').hidden),
      label + ': cannon shell visuals,0/2 ammo and reload bar track the burst');
    await b.shot(prefix + '-cannon-reload.png');
    await b.waitFor('Warz.debug.match().world.vehicleById(9).cannonAmmo===2 && Warz.debug.match().world.vehicleById(9).cannonReload===0', 5000);
    await press('Digit2'); await b.waitFor('Warz.debug.player().vehicleWeapon===1 && document.getElementById("hud-ammo-label").textContent.startsWith("Machine gun")');
    await mouse(true); await sleep(220); await mouse(false);
    check(await evaluate(() => Warz.debug.match().world.vehicleById(9).mgAmmo < 1000), label + ': physical2 switches to machine gun and consumes its own magazine');
    if (online) {
      await mutate((W, w, p) => {
        const v = w.vehicleById(9); w.exitVehicle(p, true);
        const driver = w.players.find(o => o !== p); driver.team = p.team; driver.x = 5000; driver.y = 5150; driver.alive = true; driver.downed = false;
        w.enterVehicle(driver, v, 'driver'); p.x = p.px = 5000; p.y = p.py = 4850;
      });
      await b.waitFor('!Warz.debug.player().vehicle'); await press('KeyE');
      await b.waitFor('Warz.debug.player().vehicleSeat==="rearLeft"');
      check(await evaluate(() => document.getElementById('hud-vehicle-role').textContent === 'Cannon & machine gun' && document.querySelectorAll('#hud-vehicle-seats>span').length === 2),
        'Online Duo: second seat is the combined cannon/MG operator and only two seats are offered');
      await press('Digit1'); await b.waitFor('Warz.debug.match().world.vehicleWeaponFor(Warz.debug.player())==="cannon"');
      await press('Digit2'); await b.waitFor('Warz.debug.match().world.vehicleWeaponFor(Warz.debug.player())==="mg"');
      check(true, 'Online Duo: physical1/2 switches the second operator between both weapons');
      await b.shot('online-duo-operator.png');
    }
  }
  for (const [mode, seats] of [['trio', 3], ['squad', 4]]) {
    await evaluate(mode => { Warz.App.leaveMatch(); Warz.Lobby.queue(mode); }, mode);
    await b.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>2');
    const live = app.matches.get(String(await evaluate(() => Warz.debug.match().id))), p = live.byId.get(await evaluate(() => Warz.debug.player().id));
    for (const o of live.players) if (o !== p) o.controller = () => ({ mx: 0, my: 0 });
    clearTerrain(live.W, live.world); fixture(live.W, live.world, p);
    const v = live.world.vehicleById(9); p.y = 5150; live.world.enterVehicle(p, v, 'driver');
    await evaluate(source => { const w = Warz.debug.match().world; (0, eval)('(' + source + ')')(Warz, w); Warz.debug.renderer().map = null; Warz.Hud.banner('', '', .01); }, clearTerrain.toString());
    await b.waitFor('Warz.debug.player().vehicle===9');
    check(await evaluate(n => { const e = document.getElementById('hud-vehicle-seats'); return e.children.length === n && e.textContent.includes('Cannon operator') && e.textContent.includes('Machine gunner') && (n === 3 || e.textContent.includes('Passenger')); }, seats),
      'Online ' + mode + ': HUD shows exactly' + seats + ' mode-appropriate seats and dedicated weapon roles');
    await b.shot('online-' + mode + '-roles.png');
  }
  check(b.errors.length === 0, 'No browser exceptions through upgrade, hammer, repair, burst reload and crew HUD');
  console.log('Armor Crew browser QA: all ' + checks.length + ' checks passed');
} catch (error) {
  if (b) { await b.shot('failure.png'); observations.push({ failure: error.stack, state: await b.evaluate('({p:Warz.debug.player(),v:Warz.debug.match()?.world.vehicleById(9),prompt:document.getElementById("hud-prompt").textContent, errors:crewQA})').catch(() => null) }); }
  throw error;
} finally {
  if (b) { fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, observations, errors: b.errors }, null, 2)); await b.close(); }
  await app.close();
}
