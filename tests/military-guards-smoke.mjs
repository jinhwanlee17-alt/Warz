import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';

const t = suite('Military guards and vehicles');
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls', 'online', 'render']);
const X = 6000, Y = 6000;
function arena(remote = false) {
  const map = { seed: 7, size: W.CONFIG.worldSize, teamSize: 1, trees: [], rocks: [], stations: [], buildings: [], crates: [],
    ponds: [], pickups: [], towns: [], drops: [], militaryStructures: [{ item: 'turret3', x: X, y: Y, aiRider: true, militaryBase: 1 }],
    militaryVehicles: [{ id: 23, type: 'tank', x: X, y: Y + 600, militaryBase: 1 }], nextPickupId: 1 };
  return new W.World({ map, remote, storm: false });
}
{
  const world = arena(), turret = world.structures[0], tank = world.vehicles[0];
  const intruder = world.addPlayer({ x: X + 350, y: Y, team: 2 });
  t.check(turret.aiRider && turret.militaryBase === 1 && turret.neutral && !turret.mounted, 'AI guard leaves the seat available to any team');
  t.check(tank.militaryBase === 1 && tank.type === 'tank' && tank.hp === W.TANK.hp, 'parking seeds become ordinary operable hulls');
  world.updateItems(.05);
  t.equal(intruder.maxHp - intruder.hp, W.ITEMS.turret3.damage, 'unoccupied military turret fires at an intruder');
  t.equal(turret.cooldown, W.ITEMS.turret3.fireInterval, 'AI uses its Turret III fire interval');
  t.check(world.events.some(event => event.type === 'sentry-shot' && event.struct === turret), 'AI fire uses the replicated shot effect');
  const hp = intruder.hp;
  intruder.fx.invisible = 1; world.updateItems(.05);
  t.equal(intruder.hp, hp, 'AI obeys sentry invisibility rules');
  intruder.fx.invisible = 0; intruder.x = X + W.ITEMS.sentry3.range + 20; world.updateItems(.05);
  t.equal(intruder.hp, hp, 'AI range matches Sentry III');
  intruder.x = X + 320;
  const wall = { type: 'wall', shape: 'rect', x: X + 140, y: Y - 80, w: 15, h: 160 };
  world.solids.insert(wall, wall.x, wall.y, wall.x + wall.w, wall.y + wall.h);
  world.updateItems(.05);
  t.equal(intruder.hp, hp, 'a wall protects a player from the AI gunner');
  intruder.x = X - 320;
  const rider = world.addPlayer({ x: X + 80, y: Y, team: 1 });
  t.check(world.pressInteract(rider) && rider.mount === turret.id, 'ordinary interact takes over the AI seat');
  world.updateItems(.05);
  t.equal(intruder.hp, hp, 'AI yields to the player in the seat');
  t.equal(world.automaticGuardRange(turret), 0, 'bots recognize that a player has taken over the guard');
  world.updateMounted(rider, { aimX: intruder.x, aimY: intruder.y, fire: true }, .05);
  t.check(world.bullets.some(b => b.team === rider.team && b.damage === W.ITEMS.turret3.damage), 'player controls the normal turret weapon');
  t.check(world.dismount(rider), 'player can leave the AI seat');
  rider.x = X + 2000;
  world.updateItems(.1);
  t.equal(hp - intruder.hp, W.ITEMS.turret3.damage, 'AI takes over after dismounting');
  intruder.x = tank.x; intruder.y = tank.y;
  t.check(world.enterVehicle(intruder, tank, 'driver'), 'military tank supports ordinary boarding');
  world.updateItems(.1);
  t.check(tank.hp < tank.maxHp, 'AI gunner targets an occupied hull');
  world.damageStruct(turret, turret.hp, intruder.id);
  t.check(!world.structById(turret.id), 'destroying the turret removes its gunner');
}
{
  const world = arena(true), p = world.addPlayer({ x: X + 200, y: Y, team: 2 });
  world.updateItems(.05);
  t.check(p.hp === p.maxHp && !world.events.some(e => e.type === 'sentry-shot'), 'browser replicas cannot author AI shots or damage');
}
{
  const renderer = Object.create(W.Renderer.prototype), world = arena(), turret = world.structures[0];
  const view = { x0: X - 100, y0: Y - 100, x1: X + 100, y1: Y + 100 }, labels = [], fills = [];
  const ctx = new Proxy({
    fillText(label) { labels.push(label); }, fill() { fills.push(this.fillStyle); }
  }, { get(obj, key) { return key in obj ? obj[key] : () => {}; } });
  renderer.drawStructures(ctx, world, view, 0, null);
  t.check(labels.includes('Turret III · AI gunner') && fills.includes('#687751'), 'unoccupied military turret displays its helmeted AI gunner');
  turret.mounted = 10; labels.length = fills.length = 0;
  renderer.drawStructures(ctx, world, view, 0, null);
  t.check(labels.includes('Turret III') && !fills.includes('#687751'), 'player takeover removes the AI rider and its label');
}
{
  const match = new Match({ W: ServerW, id: 'military-guards', seed: 42, mode: 'solo', teamSize: 1, clock: false,
    emptyTimeout: Infinity, teams: [{ members: [{ name: 'Raider' }] }, { members: [{ name: 'Observer' }] }] });
  try {
    const world = match.world, p = match.players[0], turret = world.structures.find(s => s.aiRider);
    const sentry = world.structures.find(s => s.guardRole === 'vault'), tank = world.vehicles.find(v => v.militaryBase && v.type === 'tank');
    const client = W.Online.start(match.startMessage(p, true));
    t.equal(client.world.structById(turret.id).militaryBase, turret.militaryBase, 'map seed reconstructs the same military turret on the browser');
    t.equal(client.world.structById(sentry.id).guardRole, 'vault', 'crate guards retain their seed role');
    client.world.destroyStruct(client.world.structById(turret.id), 0);
    W.Online.applySync(match.syncMessage());
    t.check(client.world.structById(turret.id).aiRider, 'a full structure resync restores the AI gunner to a missing turret');
    let snapshot;
    const conn = { open: true, bufferedAmount: 0, close() {}, sendText(text) {
      snapshot = JSON.parse(text); W.Online.applySnapshot(snapshot);
    } };
    p.net.conn = conn;
    match.sendSnapshots([]);
    t.check(snapshot.vehicles.find(row => row.id === tank.id)?.militaryBase === tank.militaryBase, 'first snapshot carries complete military hulls');
    const guardReplica = client.world.structById(sentry.id);
    world.itemBurst('firenade', sentry.x, sentry.y, p.id);
    world.updateZones(.05);
    match.sendSnapshots(world.events.splice(0));
    t.check(sentry.hp < sentry.maxHp && guardReplica.hp === Math.round(sentry.hp), 'Molotov damage to a neutral base sentry replicates online');
    const guardHP = guardReplica.hp;
    client.world.updateZones(.25);
    t.equal(guardReplica.hp, guardHP, 'a mirrored fire zone leaves sentry damage to the server');
    world.zones = [];
    world.rpgImpact({ id: 1, owner: p.id, team: p.team }, null, sentry.x, sentry.y);
    match.sendSnapshots(world.events.splice(0));
    t.check(!sentry.alive && !client.world.structById(sentry.id), 'rocket blast destroys a base sentry on the server and the browser');
    match.sendSnapshots([]);
    t.check(snapshot.vehicles.includes(tank.id) && !client.world.vehicleById(tank.id).hidden, 'unchanged parked hulls remain visible using compact references');
    world.damageVehicle(tank, 100, p.id, 'artillery');
    conn.bufferedAmount = 200000; match.sendSnapshots([]); conn.bufferedAmount = 0;
    t.check(client.world.vehicleById(tank.id).hp !== tank.hp, 'fixture skipped a slow-link tick');
    match.sendSnapshots([]);
    t.equal(client.world.vehicleById(tank.id).hp, tank.hp, 'changed hull is resent after a skipped snapshot');
    world.destroyStruct(turret, p.id);
    W.Online.applySync(match.syncMessage());
    t.check(!client.world.structById(turret.id), 'reconnect keeps a destroyed military turret destroyed');
  } finally { match.destroy(); }
}
t.done();
