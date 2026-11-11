// Real server packets drive an independent client replica, including driver replay,
// shared seat poses, reconnects and destruction while inputs remain in flight.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';

const t = suite('vehicles online'), STEP = 0.05;
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'class-combat', 'controls']);
const sent = []; let clientClock = 0;
W.MatchNet = { send(message) { sent.push(message); } };
const sandbox = { Warz: W, performance: { now: () => clientClock * 1000 } }; sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
const Online = W.Online;
const match = new Match({ W: ServerW, id: 'vehicles-online', mode: 'squad', teamSize: 4, seed: 42,
  clock: false, emptyTimeout: Infinity,
  teams: [{ members: ['Driver', 'Gunner', 'Left', 'Right'].map(name => ({ name })) }, { members: [{ name: 'Observer' }] }] });
const [driver, gunner, left, right, enemy] = match.players;
let state, lastSnapshot;
function clearTerrain(world) {
  for (const key of ['rocks', 'trees', 'buildings', 'crates', 'pickups', 'ponds', 'stations']) world.map[key] = [];
  world.solids = new W.U.SpatialHash(256);
}
clearTerrain(match.world);
match.world.vehicles.forEach((v, i) => { v.x = i ? 14000 + i * 500 : 8000; v.y = 8000; v.angle = 0; v.gunAngle = 0; });
const vehicle = match.world.vehicles[0];
match.players.forEach((p, i) => { p.x = 4000 + i * 200; p.y = 4000; p.dropT = 0; });
function connect(p, rejoin = false) {
  match.players.forEach(p => { p.net.conn = null; });
  state = Online.start(match.startMessage(p, rejoin)); clearTerrain(state.world);
  p.net.conn = { open: true, bufferedAmount: 0, sendJson() {}, close() {}, sendText(text) {
    const message = JSON.parse(text);
    if (message.t === 'snap') { lastSnapshot = message; clientClock += STEP; Online.applySnapshot(message); }
  } };
  if (rejoin) Online.applySync(match.syncMessage());
  match.sendSnapshots([]);
  state.seq = p.net.ack;
  return state;
}
function input(keys = []) {
  return { down: code => keys.includes(code), hit: () => false, lift: () => false, wheel: 0, mouse: { x: 0, y: 0 } };
}
const renderer = { screenToWorld: () => ({ x: state.me.x + 500, y: state.me.y + 80 }) };
function clientStep(keys = []) { Online.step(input(keys), renderer, false, false); return sent.at(-1); }
function deliver(p, message) { match.handleInput(p, message); match.tick(); }
function enter(p, seat) {
  const at = match.world.vehicleSeatPoint(vehicle, seat, true);
  p.x = at.x; p.y = at.y; p.vx = p.vy = 0;
  return match.world.enterVehicle(p, vehicle, seat);
}
function seatAttached(p, v, world) {
  const at = world.vehicleSeatPoint(v, p.vehicleSeat);
  const drawn = world.vehicleSeatPoint({ ...v, angle: v.angle + (v.oa || 0) }, p.vehicleSeat);
  return Math.hypot(p.x - at.x, p.y - at.y) < 1e-7 &&
    Math.hypot(p.x + p.ox - drawn.x - (v.ox || 0), p.y + p.oy - drawn.y - (v.oy || 0)) < 1e-7;
}

try {
  state = Online.start(match.startMessage(driver, false));
  t.check(state.world.vehicles.length === 12 && state.world.vehicles.every(v => v.hidden), 'roster startup hides all eight Humvees and four tanks until the first server packet');
  connect(driver);
  t.check(lastSnapshot.vehicles.length === 12 && state.world.vehicles.every(v => !v.hidden), 'initial snapshots synchronize all twelve vehicles');
  t.check(state.world.vehicles.filter(v => v.type === 'humvee' && v.armed).length === 2, 'the two armed team Humvees survive snapshot decoding');
  const at = match.world.vehicleSeatPoint(vehicle, 'driver', true);
  driver.x = at.x; driver.y = at.y; driver.stamina = 40;
  match.sendSnapshots([]);
  state.latch.fp = true; state.latch.ch = 0.75; state.latch.u = true; state.latch.uch = 0.75;
  Online.pressInteract(); deliver(driver, clientStep());
  let ride = state.world.vehicleById(vehicle.id);
  t.check(driver.vehicle === vehicle.id && state.me.vehicle === vehicle.id && state.me.vehicleSeat === 'driver', 'the real E input enters the driver seat and replicates its ownership');
  t.check(ride.seats.driver === driver.id && ride.predicted && seatAttached(state.me, ride, state.world), 'driver and hull use the same authoritative seat transform');
  t.check(!state.latch.fp && !state.latch.u && state.latch.ch === 0 && state.latch.uch === 0, 'entering a seat clears any queued projectile charge');

  const one = clientStep(['KeyD', 'ShiftLeft']), two = clientStep(['KeyD', 'ShiftLeft']);
  const predictedX = ride.x, predictedStamina = state.me.stamina;
  t.check(predictedX > vehicle.x && !one.sp && !state.me.sprinting, 'local driving predicts immediately without sprinting');
  deliver(driver, one);
  t.near(ride.x, predictedX, 0.03, 'acknowledging the first step replays only the second vehicle step');
  t.near(state.me.stamina, predictedStamina, 0.001, 'driver replay does not double-charge stamina or recovery');
  const repeatedX = ride.x, repeatedStamina = state.me.stamina;
  Online.applySnapshot(lastSnapshot);
  t.check(ride.x === repeatedX && state.me.stamina === repeatedStamina, 'repeating a snapshot neither double-drives nor double-recovers stamina');
  Online.frame(STEP, 0.5);
  const correctionBefore = state.vehicleCorr.x;
  Online.applySnapshot(lastSnapshot);
  t.near(state.vehicleCorr.x, correctionBefore, 1e-9, 'render interpolation is not accumulated again as driver reconciliation drift');
  deliver(driver, two);
  t.check(state.pending.length === 0 && Math.abs(ride.x - vehicle.x) < 0.01, 'all acknowledged driver input converges to the authoritative hull');

  // A server crate break and a still-pending drive input can arrive together.
  // Replaying against the old live hitbox would stop the client behind the server.
  {
    vehicle.x = 8000; vehicle.y = 8000; vehicle.angle = 0; vehicle.vx = 300; vehicle.vy = 0;
    match.world.syncVehicleSeats(vehicle);
    const crate = { id: 0, x: 8110, y: 8000, size: 52, tier: 'common', hp: 100, maxHp: 100, alive: true, shake: 0 };
    match.world.map.crates = [crate]; state.world.map.crates = [{ ...crate }];
    for (const world of [match.world, state.world]) { world.solids = new W.U.SpatialHash(256); world.buildSolids(); }
    match.sendSnapshots([]);
    const pendingDrive = clientStep(['KeyD']);
    t.check(ride.x < vehicle.x + 10, 'fixture: a live crate blocks the pending low-speed vehicle step');
    const beforeFx = state.world.events.filter(e => e.type === 'crate').length;
    match.world.damageCrate(crate, 100, enemy.id, crate.x, crate.y);
    const expected = { ...vehicle };
    match.world.driveVehicle(expected, { mx: 1, my: 0 }, STEP);
    match.sendSnapshots(match.world.events.splice(0));
    t.check(!state.world.map.crates[0].alive && state.world.map.crates[0].hp === 0, 'the same snapshot removes the authoritative crate hitbox');
    t.near(ride.x, expected.x, 0.01, 'pending driving replays through a crate broken by that incoming packet');
    t.equal(state.world.events.filter(e => e.type === 'crate').length, beforeFx + 1, 'pre-replay crate removal still emits exactly one break effect');
    deliver(driver, pendingDrive);
    t.near(ride.x, vehicle.x, 0.01, 'the next acknowledgment confirms the cleared route without rubberbanding');
    match.world.map.crates = []; state.world.map.crates = [];
    for (const world of [match.world, state.world]) { world.solids = new W.U.SpatialHash(256); world.buildSolids(); }
  }

  // Heading is shared simulation state; visual interpolation must not feed back
  // into replay or accumulate an extra correction after each acknowledgment.
  {
    const from = ride.angle, turnOne = clientStep(['KeyW']), firstAngle = ride.angle;
    const turnTwo = clientStep(['KeyW']), predictedAngle = ride.angle, predictedPosition = { x: ride.x, y: ride.y };
    t.check(Math.abs(W.U.angleDiff(from, firstAngle)) > 0 && Math.abs(W.U.angleDiff(from, firstAngle)) < Math.PI / 4,
      'a predicted right-angle turn begins gradually instead of snapping to the requested heading');
    deliver(driver, turnOne);
    t.near(W.U.angleDiff(predictedAngle, ride.angle), 0, 0.0011, 'turn replay restores authoritative heading before replaying the unacknowledged turn');
    t.check(Math.hypot(ride.x - predictedPosition.x, ride.y - predictedPosition.y) < 0.05, 'curved client movement matches the authoritative turning path');
    const rawAngle = ride.angle, midpoint = ride.pa + W.U.angleDiff(ride.pa, rawAngle) * 0.5;
    Online.frame(0, 0.5);
    t.near(W.U.angleDiff(midpoint + state.vehicleCorr.a, ride.angle + ride.oa), 0, 1e-9, 'driver display heading interpolates between fixed steps along the short arc');
    t.equal(ride.angle, rawAngle, 'render interpolation never changes the physics heading');
    t.check(seatAttached(state.me, ride, state.world), 'the driver camera follows the visually rotated seat');
    const angularCorrection = state.vehicleCorr.a;
    Online.applySnapshot(lastSnapshot);
    t.near(state.vehicleCorr.a, angularCorrection, 1e-9, 'display angle interpolation is not accumulated again during reconciliation');
    deliver(driver, turnTwo);
    t.near(W.U.angleDiff(vehicle.angle, ride.angle), 0, 0.00051, 'acknowledged turning converges to the server heading');

    vehicle.angle = Math.PI - 0.04; vehicle.vx = Math.cos(vehicle.angle) * 100; vehicle.vy = Math.sin(vehicle.angle) * 100;
    match.world.syncVehicleSeats(vehicle); match.sendSnapshots([]);
    const wrapFrom = ride.angle, wrapInput = clientStep(['KeyA', 'KeyW']);
    t.check(W.U.angleDiff(wrapFrom, ride.angle) > 0 && W.U.angleDiff(wrapFrom, ride.angle) <= W.VEHICLE.turnRate * STEP + 0.0001,
      'steering across the angle wrap chooses the short turn without a full-circle spin');
    deliver(driver, wrapInput);
  }

  // Prediction can cross a full-speed crate without generating speculative loot.
  // Slowing while inside that hitbox must stay passable until the server responds.
  for (const rejected of [false, true]) {
    const startX = rejected ? 10010 : 9000, crateX = rejected ? 10120 : 9120;
    vehicle.x = startX; vehicle.y = 9000; vehicle.angle = 0; vehicle.vx = rejected ? 0 : ServerW.VEHICLE.maxSpeed; vehicle.vy = 0;
    match.world.syncVehicleSeats(vehicle);
    const crate = { id: 0, x: crateX, y: 9000, size: 52, tier: 'common', hp: 100, maxHp: 100, alive: true, shake: 0 };
    match.world.map.crates = [crate]; state.world.map.crates = [{ ...crate }];
    for (const world of [match.world, state.world]) { world.solids = new W.U.SpatialHash(256); world.buildSolids(); }
    match.sendSnapshots([]);
    if (rejected) ride.vx = W.VEHICLE.maxSpeed; // A deliberately wrong speed must be corrected by the server.
    const beforePickups = state.world.map.pickups.length, beforeCrateEvents = state.world.events.filter(e => e.type === 'crate').length;
    const fast = clientStep(['KeyD']), crossedX = ride.x;
    t.check(ride.x > crate.x - crate.size / 2 - ride.r && ride.predictedCrates[crate.id],
      (rejected ? 'rejected' : 'accepted') + ' crush fixture: fast prediction enters the crate contact volume');
    t.check(state.world.map.crates[0].alive && state.world.map.crates[0].hp === 100 && state.world.map.pickups.length === beforePickups,
      'speculative crush changes no authoritative crate HP or loot');
    if (!rejected) {
      const coast = clientStep();
      t.check(ride.x > crossedX && Math.hypot(ride.vx, ride.vy) < W.VEHICLE.maxSpeed * W.VEHICLE.crushSpeedRatio,
        'slowing inside a predicted-crushed crate does not push the driver backward');
      const beforeAck = ride.x;
      deliver(driver, fast);
      t.check(!crate.alive && !state.world.map.crates[0].alive, 'the server confirms the crush and replicates the actual crate break');
      t.near(ride.x, beforeAck, 0.02, 'the confirmed crush replays coasting without a position jump');
      t.equal(state.world.events.filter(e => e.type === 'crate').length, beforeCrateEvents + 1, 'only the authoritative crush emits the crate break');
      deliver(driver, coast);
      t.near(ride.x, vehicle.x, 0.01, 'all crush input acknowledgments converge to the server position');
    } else {
      deliver(driver, fast);
      t.check(crate.alive && !Object.keys(ride.predictedCrates).length, 'an authoritative correction discards a rejected speculative crush');
      const slow = clientStep(['KeyD']);
      t.check(ride.x <= crate.x - crate.size / 2 - ride.r + 0.01 && state.world.map.crates[0].alive,
        'the next slow prediction collides with the server-confirmed intact crate');
      deliver(driver, slow);
    }
    match.world.map.crates = []; state.world.map.crates = [];
    for (const world of [match.world, state.world]) { world.solids = new W.U.SpatialHash(256); world.buildSolids(); }
  }
  t.check(enter(gunner, 'gunner') && enter(left, 'rearLeft') && enter(right, 'rearRight'), 'all three teammate seats are occupied through authoritative APIs');
  match.sendSnapshots([]);
  const moving = clientStep(['KeyD']); Online.interpolate(); Online.frame(1 / 60, 0.5);
  t.check(['driver', 'gunner', 'rearLeft', 'rearRight'].every(seat => seatAttached(state.world.playerById(ride.seats[seat]), ride, state.world)), 'every occupant follows the predicted hull and shares its visual correction');
  deliver(driver, moving);

  // Personal weapons and items stay inert in every role; only a gunner sends held fire.
  for (const p of [driver, gunner, left, right]) {
    connect(p, true); ride = state.world.vehicleById(vehicle.id);
    Object.assign(state.latch, { fp: true, ch: 0.75, r: true, sl: 1, cy: 2, sw: true, u: true, uch: 0.75, ht: 0, dp: true, use: true });
    const message = clientStep(['Mouse1', 'Mouse3', 'KeyD', 'ShiftLeft', 'KeyE']);
    t.check(!message.fp && !message.u && !message.r && !message.sw && !message.dp && !message.sc && !message.sp && message.ch === 0 && message.uch === 0 && message.sl === null && message.ht === null && message.cy === 0,
      p.vehicleSeat + ': seated inputs suppress personal weapons, items, scopes, reloads and sprint');
    t.equal(message.f, p === gunner, p.vehicleSeat + ': held fire is reserved for the armed gunner');
    const hullX = ride.x, hullY = ride.y;
    if (p !== driver) {
      clientStep(['KeyW', 'ShiftLeft']);
      t.check(ride.x === hullX && ride.y === hullY, p.vehicleSeat + ': passenger movement never drives or independently walks away');
    }
  }

  connect(gunner, true);
  ServerW.World.prototype.setClass.call(match.world, gunner, 'grenadier', true); gunner.slot = 1;
  match.sendSnapshots([]);
  const ammo = gunner.weapons[0].ammo, grenades = gunner.grenades, shots = gunner.stats.shots;
  const replicaShots = () => state.world.events.filter(e => e.type === 'shot' && e.weapon === 'turret').length;
  const priorReplicaShots = replicaShots();
  for (let tick = 0; tick < 8; tick++) deliver(gunner, clientStep(['Mouse1']));
  t.check(gunner.stats.shots >= shots + 4 && replicaShots() >= priorReplicaShots + 4, 'selected hand grenades still allow continuous authoritative Humvee turret fire');
  t.check(gunner.grenades === grenades && gunner.weapons[0].ammo === ammo, 'vehicle fire consumes no personal grenades or launcher ammunition');
  t.check(state.world.bullets.length > 0 && state.world.vehicleById(vehicle.id).flash > 0 && state.world.events.some(e => e.type === 'shot' && e.weapon === 'turret'), 'vehicle shots replicate bullets, muzzle flash and turret audio events');
  const encodedShot = match.encodeEvent({ type: 'vehicle-shot', player: gunner, vehicle, x: vehicle.x, y: vehicle.y, angle: 0.2, angles: [0.2134] }).msg;
  t.check(encodedShot.a === 0.2 && encodedShot.angles[0] === 0.213, 'turret spread and gun aim remain separate on the wire');

  connect(left, true);
  t.check(state.me.vehicleSeat === 'rearLeft' && seatAttached(state.me, state.world.vehicleById(vehicle.id), state.world), 'rejoining a moving passenger restores the exact seat before the next frame');
  const poses = [];
  for (let tick = 0; tick < 3; tick++) {
    match.handleInput(driver, { s: driver.net.ack + 1, mx: 1, my: 0 }); match.tick();
    poses.push({ x: vehicle.x, y: vehicle.y });
  }
  clientClock += 0.075; Online.interpolate(); Online.frame(1 / 60, 0.5);
  ride = state.world.vehicleById(vehicle.id);
  t.near(ride.x, (poses[1].x + poses[2].x) / 2, 0.02, 'a passenger sees the interpolated hull between server steps');
  t.check(seatAttached(state.me, ride, state.world), 'the local passenger follows that same interpolated hull without a second smoothing offset');
  t.check(state.world.players.filter(p => p.vehicle === vehicle.id).every(p => seatAttached(p, ride, state.world)), 'remote passengers and gunner remain attached to the same interpolated vehicle');

  match.world.damageVehicle(vehicle, 37, enemy.id, 'ar', vehicle.x, vehicle.y);
  match.sendSnapshots(match.world.events.splice(0));
  ride = state.world.vehicleById(vehicle.id);
  t.check(ride.hp === vehicle.hp && ride.hitFlash === 1, 'vehicle damage events add feedback without subtracting snapshot health twice');

  connect(enemy, true); enemy.x = 2000; enemy.y = 2000; match.sendSnapshots([]);
  t.check(!lastSnapshot.p.some(row => row[0] === gunner.id) && state.world.playerById(gunner.id).vehicle === vehicle.id, 'distant occupants are tracked by authoritative seats without exposing a placeholder body');
  match.world.exitVehicle(gunner, true); match.sendSnapshots(match.world.events.splice(0));
  t.check(!state.world.vehicleById(vehicle.id).seats.gunner && !state.world.playerById(gunner.id).vehicle && state.world.playerById(gunner.id).vehicleSeat === null,
    'an out-of-interest exit clears both the seat and stale player ownership');

  connect(driver, true);
  clientStep(['KeyD']); state.latch.fp = true; state.latch.ch = 0.75; state.latch.u = true; state.latch.uch = 0.75;
  match.world.damageVehicle(vehicle, 10000, enemy.id, 'ar', vehicle.x, vehicle.y);
  match.sendSnapshots(match.world.events.splice(0));
  ride = state.world.vehicleById(vehicle.id);
  t.check(ride.wreck && ride.hp === 0 && Object.values(ride.seats).every(id => id === 0), 'destruction replicates a permanent wreck with no occupied seats');
  t.check(!state.me.vehicle && state.me.vehicleSeat === null && !ride.predicted, 'destroying a predicted vehicle returns its driver to authoritative foot movement');
  t.near(state.me.x, lastSnapshot.you.x, 1e-9, 'unacknowledged driving cannot replay as walking after forced exit');
  t.check(!state.latch.fp && !state.latch.u && state.latch.ch === 0 && state.latch.uch === 0, 'forced exit drops all pending mounted projectile actions');
  const afterExit = clientStep();
  t.check(!afterExit.fp && !afterExit.u && afterExit.ch === 0 && afterExit.uch === 0, 'the next packet cannot fire a stale grenade after vehicle destruction');
  connect(left, true); ride = state.world.vehicleById(vehicle.id);
  t.check(ride.wreck && ride.hp === 0 && !state.me.vehicle && Object.values(ride.seats).every(id => id === 0), 'rejoin preserves the wreck and every forced passenger exit');
} finally { match.destroy(); }
t.done();
