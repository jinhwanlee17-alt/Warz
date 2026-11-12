// Real server snapshots and input packets drive an independent Armor Crew client.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';

const t = suite('armor crew online'), STEP = 0.05;
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls']);
const sent = []; let clock = 0;
W.MatchNet = { send(message) { sent.push(message); } };
const sandbox = { Warz: W, performance: { now: () => clock * 1000 } }; sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
const Online = W.Online;
const match = new Match({ W: ServerW, id: 'armorcrew-online', mode: 'duo', teamSize: 2, seed: 57, clock: false,
  emptyTimeout: Infinity, teams: [{ members: [{ name: 'Engineer' }, { name: 'Operator' }] }, { members: [{ name: 'Observer' }] }] });
const [engineer, operator, observer] = match.players;
let state, last, aim;
function clearTerrain(world) {
  for (const key of ['rocks', 'trees', 'buildings', 'crates', 'pickups', 'ponds', 'stations']) world.map[key] = [];
  world.solids = new W.U.SpatialHash(256);
}
function connect(p, rejoin = false) {
  match.players.forEach(player => { player.net.conn = null; });
  state = Online.start(match.startMessage(p, rejoin)); clearTerrain(state.world);
  p.net.conn = { open: true, bufferedAmount: 0, close() {}, sendText(text) {
    const message = JSON.parse(text);
    if (message.t === 'snap') { last = message; clock += STEP; Online.applySnapshot(last); }
  } };
  if (rejoin) Online.applySync(match.syncMessage());
  match.sendSnapshots([]); state.seq = p.net.ack;
}
function step(down = [], hit = []) {
  const input = { down: key => down.includes(key), hit: key => hit.includes(key), lift: () => false,
    wheel: 0, mouse: { x: 0, y: 0 } };
  Online.latch(input); Online.step(input, { screenToWorld: () => aim || ({ x: state.me.x + 700, y: state.me.y }) }, false, false);
  return sent.at(-1);
}
function deliver(p, message) { match.handleInput(p, message); match.tick(); }
function enter(p, v, seat) {
  const at = match.world.vehicleSeatPoint(v, seat, true); p.x = at.x; p.y = at.y; p.dropT = 0;
  return match.world.enterVehicle(p, v, seat);
}
try {
  clearTerrain(match.world);
  match.world.vehicles.forEach((v, i) => { v.x = 2000 + i * 400; v.y = 3000; });
  const humvee = match.world.vehicles.find(v => v.type === 'humvee'), tank = match.world.vehicles.find(v => v.type === 'tank');
  humvee.x = 8000; humvee.y = 8000; humvee.angle = 0;
  tank.x = 10000; tank.y = 8000; tank.angle = tank.cannonAngle = tank.gunAngle = 0;
  match.players.forEach((p, i) => { p.x = 7000 + i * 200; p.y = 7000; p.dropT = 0; });
  match.world.setClass(engineer, 'armorcrew', true);
  match.world.setClass(operator, 'armorcrew', true);
  connect(engineer);
  t.check(state.world.map.teamSize === 2 && state.me.classId === 'armorcrew' && state.me.maxHp === 150,
    'match-start preserves Duo seat rules and the released Armor Crew class');
  t.check(state.me.weapons[0].id === 'hammer' && state.me.weapons[1].id === 'pistol',
    'Armor Crew snapshot reconstructs its hammer and pistol loadout');

  observer.x = engineer.x + 60; observer.y = engineer.y; operator.x = engineer.x - 300;
  aim = { x: observer.x, y: observer.y }; match.sendSnapshots([]);
  const beforeMelee = observer.hp;
  deliver(engineer, step(['Mouse1'], ['Mouse1']));
  t.near(beforeMelee - observer.hp, W.WEAPONS.hammer.damage, 0.001,
    'personal hammer hit deals its base damage once on the server');
  t.check(state.me.meleeSwing > 0 && state.world.events.some(e => e.type === 'melee' && e.weapon === 'hammer' && e.x === Math.round(engineer.x * 10) / 10),
    'melee event supplies the swing animation and authoritative audio position');
  t.equal(state.world.playerById(observer.id).hp, Math.ceil(observer.hp),
    'replicated melee cosmetics do not subtract damage a second time');

  engineer.x = humvee.x + humvee.r + 30; engineer.y = humvee.y;
  observer.x = 4000; observer.y = 4000; humvee.hp = 800; aim = null;
  match.sendSnapshots([]);
  let message = step([], ['KeyF']); deliver(engineer, message);
  t.check(message.u && !message.uch && engineer.repairVehicle === humvee.id && state.me.repairVehicle === humvee.id,
    'F uses the existing utility edge to start authoritative vehicle repair');
  t.check(state.world.events.some(e => e.type === 'repair' && e.player === state.me && e.active),
    'repair toggle reaches the client feedback handler');
  const repairStart = humvee.hp;
  for (let i = 0; i < 3.5 / STEP; i++) match.tick();
  t.near(humvee.hp - repairStart, 100, 0.001, 'toggled Humvee repair restores100 HP in3.5 seconds without repeated key presses');
  t.near(state.world.vehicleRepairRate(state.world.vehicleById(humvee.id)), 100 / 3.5, 0.001,
    'client repair-rate helper agrees with the authoritative Humvee rate');
  t.equal(state.world.vehicleById(humvee.id).hp, Math.round(humvee.hp * 100) / 100,
    'vehicle snapshots own repaired HP without applying repair event amounts twice');
  const cosmeticHp = state.world.vehicleById(humvee.id).hp;
  state.world.update(STEP);
  t.equal(state.world.vehicleById(humvee.id).hp, cosmeticHp, 'client cosmetic updates never repair the hull locally');
  t.check(state.world.events.some(e => e.type === 'vehicle' && e.op === 'repair' && e.vehicle.id === humvee.id),
    'repair feedback reaches the client vehicle event handler');
  connect(engineer, true);
  t.check(state.me.repairVehicle === humvee.id && match.syncMessage().players.find(row => row[0] === engineer.id)[9] === humvee.id,
    'reconnect restores the active repair target in local state and fullsync');

  const revealRadius = W.ITEMS.smoke.radius * W.ARMOR_CREW.repairRevealMul;
  const revealDistance = revealRadius * 0.8;
  observer.x = engineer.x + revealDistance; observer.y = engineer.y;
  connect(observer);
  t.check(last.p.some(row => row[0] === engineer.id && row[19] === humvee.id),
    'enemy snapshots carry the active repair target for nearby map reveal');
  t.check(state.world.revealedEnemies(state.me).includes(state.world.playerById(engineer.id)),
    'the nearby repairer appears in the client map reveal set');
  observer.x = engineer.x + revealRadius + 200; match.sendSnapshots([]);
  t.check(!state.world.revealedEnemies(state.me).includes(state.world.playerById(engineer.id)),
    'leaving repair reveal range clears the old map marker on the next snapshot');
  observer.x = engineer.x + 4000; match.sendSnapshots([]);
  t.check(!last.p.some(row => row[0] === engineer.id) && !state.world.playerById(engineer.id).repairVehicle,
    'leaving player interest also clears stale repair state');
  observer.x = engineer.x + revealDistance; match.sendSnapshots([]);
  t.check(state.world.playerById(engineer.id).repairVehicle === humvee.id, 're-entering reveal range restores the active repair marker');
  match.handleInput(engineer, { s: engineer.net.ack + 1, u: true }); match.tick();
  t.check(!engineer.repairVehicle && !state.world.playerById(engineer.id).repairVehicle,
    'stopping repair clears a distant enemy marker without waiting for stale presence timeout');
  connect(engineer);
  message = step([], ['KeyG']); deliver(engineer, message);
  t.check(message.u && engineer.repairVehicle === humvee.id, 'G also starts repair through its bound utility edge');
  deliver(engineer, step([], ['KeyG']));
  const stoppedHp = humvee.hp;
  for (let i = 0; i < 10; i++) match.tick();
  t.check(!state.me.repairVehicle && humvee.hp === stoppedHp, 'the second G press stops healing completely');

  t.check(enter(engineer, humvee, 'driver'), 'Armor Crew can board the Humvee driver seat');
  humvee.vx = W.VEHICLE.maxSpeed * W.ARMOR_CREW.humveeSpeedMul; humvee.vy = 0;
  match.world.syncVehicleSeats(humvee); connect(engineer, true);
  const baselineX = humvee.x, first = step(['KeyD']), second = step(['KeyD']);
  const predictedX = state.world.vehicleById(humvee.id).x;
  t.near(predictedX - baselineX, W.VEHICLE.maxSpeed * W.ARMOR_CREW.humveeSpeedMul * STEP * 2, 0.02,
    'local Humvee prediction uses the Armor Crew15% speed bonus');
  deliver(engineer, first);
  t.near(state.world.vehicleById(humvee.id).x, predictedX, 0.03,
    'class is restored before replaying unacknowledged boosted driving');
  deliver(engineer, second);
  t.near(state.world.vehicleById(humvee.id).x, humvee.x, 0.02, 'boosted Humvee driving converges after acknowledgments');
  match.world.exitVehicle(engineer, true);

  t.check(enter(engineer, tank, 'driver') && enter(operator, tank, 'rearLeft'), 'Duo tank supports its driver and dual weapon operator');
  t.check(!match.world.vehicleSeatAvailable(tank, 'gunner', observer) && !match.world.vehicleSeatAvailable(tank, 'rearRight', observer),
    'Duo tank does not expose third or fourth crew seats');
  match.handleInput(engineer, { s: engineer.net.ack + 1, mx: 0, my: 0 });
  connect(operator, true); aim = { x: tank.x + 900, y: tank.y + 40 };
  const personalAmmo = operator.weapons.map(w => w.ammo).join();
  message = step(['Mouse1'], ['Digit1']); deliver(operator, message);
  let replicaTank = state.world.vehicleById(tank.id), wireTank = last.vehicles.find(v => v.id === tank.id);
  t.check(message.sl === 0 && match.world.vehicleWeaponFor(operator) === 'cannon' && tank.cannonMaxAmmo === 2 && tank.cannonAmmo === 1,
    'Duo operator key1 fires the first round of the Armor Crew two-round cannon magazine');
  t.check(replicaTank.cannonAmmo === 1 && replicaTank.cannonMaxAmmo === 2 && wireTank.cn === 1 && wireTank.cm === 2,
    'cannon loaded rounds and magazine capacity are synchronized independently');
  t.check(state.world.tankShells.some(shell => shell.owner === operator.id && shell.damageMul === 1.05),
    'cannon shell snapshots preserve the Armor Crew vehicle damage multiplier captured at firing');
  for (let i = 0; i < 7; i++) match.tick();
  t.check(tank.cannonAmmo === 0 && tank.cannonReload === 3 && replicaTank.cannonAmmo === 0,
    'held cannon fire uses the second round then starts the fixed three-second reload');
  connect(operator, true); replicaTank = state.world.vehicleById(tank.id);
  t.check(replicaTank.cannonAmmo === 0 && replicaTank.cannonMaxAmmo === 2 && replicaTank.cannonReload === Math.round(tank.cannonReload * 1000) / 1000,
    'reconnect preserves an empty two-round cannon magazine and its reload progress');
  const mgBefore = tank.mgAmmo;
  message = step(['Mouse1'], ['Digit2']); deliver(operator, message);
  t.check(message.sl === 1 && operator.vehicleWeapon === 1 && state.me.vehicleWeapon === 1 && match.world.vehicleWeaponFor(operator) === 'mg' && tank.mgAmmo === mgBefore - 1,
    'Duo operator key2 switches to the MG while the cannon reloads');
  t.check(match.world.vehicleWeaponFor(engineer) === null, 'the driver cannot take a weapon while the Duo operator occupies it');
  t.equal(operator.weapons.map(w => w.ammo).join(), personalAmmo, 'vehicle weapon selection never consumes personal hammer or pistol ammunition');
  deliver(operator, step());
  for (let i = 0; i < 60; i++) match.tick();
  t.check(tank.cannonAmmo === 2 && !tank.cannonReload && state.world.vehicleById(tank.id).cannonAmmo === 2,
    'infinite cannon ammunition refills the two-round magazine after reload');
  match.world.exitVehicle(engineer, true); match.world.exitVehicle(operator, true);
  tank.vx = tank.vy = 0; tank.hp = tank.maxHp - 100;
  engineer.x = tank.x + tank.r + 30; engineer.y = tank.y;
  connect(engineer); aim = null;
  deliver(engineer, step([], ['KeyF']));
  const tankRepairStart = tank.hp;
  for (let i = 0; i < 2 / STEP; i++) match.tick();
  t.near(tank.hp - tankRepairStart, 100, 0.001, 'toggled tank repair restores100 HP in2 seconds');
  t.check(state.world.vehicleById(tank.id).hp === tank.maxHp && !state.me.repairVehicle,
    'finishing tank repair synchronizes full health and clears the repair target');
} finally { match.destroy(); }
t.done();
