// Engineer construction runs in the same simulation as multiplayer; sentries damage occupied hulls.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'class-combat', 'vehicles', 'level3-combat']);
const t = suite('Engineer and sentry vehicles'), DT = 0.05, X = 5000, Y = 5000;
function arena(extra = {}, remote = false) {
  const map = Object.assign({ seed: 7, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
    pickups: [], ponds: [], stations: [], towns: [], drops: [], tanks: [], vehicles: [], nextPickupId: 1 }, extra);
  const world = new W.World({ map, remote, storm: false });
  const p = world.addPlayer({ classId: 'engineer', x: X, y: Y, team: 1 });
  const intent = { mx: 0, my: 0, aimX: X + 100, aimY: Y, fire: true };
  p.controller = () => intent;
  return { world, p, intent };
}
function run(a, seconds) { for (let i = 0; i < Math.round(seconds / DT); i++) a.world.update(DT); }
function sentries(a) { return a.world.structures.filter(s => s.kind === 'sentry'); }
function crate(x, y = Y) { return { id: 1, x, y, size: 30, tier: 'common', hp: 100, maxHp: 100, alive: true, shake: 0 }; }

{
  const a = arena();
  t.equal(a.p.weapons.map(w => w.id).join(','), 'wrench,pistol,engineerhammer', 'Engineer carries wrench, basic pistol and its third-slot hammer');
  run(a, 9.95);
  t.equal(sentries(a).length, 0, 'no sentry appears before the full ten seconds');
  t.near(a.p.sentryBuild.elapsed, 9.95, 1e-8, 'construction progress preserves exact simulation time');
  run(a, 0.05);
  const s = sentries(a)[0];
  t.check(!!s && s.item === 'sentry' && s.hp === W.ITEMS.sentry.hp && s.maxHp === W.ITEMS.sentry.hp, 'ten seconds creates the ordinary sentry with normal HP');
  t.check(s.x === X + 100 && s.y === Y && s.team === a.p.team && s.owner === a.p.id, 'sentry uses anchored location, owner and team');
  t.equal(a.p.sentryBuild, null, 'completion clears progress');
  t.check(a.world.events.some(e => e.type === 'struct' && e.op === 'add' && e.struct === s), 'completion emits the existing authoritative structure event');
  run(a, 10);
  t.equal(sentries(a).length, 1, 'holding at the occupied anchor never stacks sentries');
  a.intent.aimY = Y + 120; run(a, 10);
  t.equal(sentries(a).length, 2, 'a fresh clear location can build another sentry');
}
{
  const a = arena(); run(a, 4);
  a.intent.aimX = X - 120; a.intent.aimY = Y + 10;
  run(a, 6);
  t.equal(sentries(a)[0]?.x, X + 100, 'aim changes do not teleport an in-progress construction');
}
for (const kind of ['release', 'slot', 'item', 'cycle', 'swap', 'interact', 'range', 'death', 'down', 'class', 'vehicle', 'turret']) {
  const a = arena(); run(a, 9.95);
  if (kind === 'release') a.intent.fire = false;
  if (kind === 'slot') a.intent.slot = 1;
  if (kind === 'item') { a.world.addItem(a.p, 'medkit', 1); a.intent.held = 0; }
  if (kind === 'cycle') a.intent.cycle = 1;
  if (kind === 'swap') a.intent.swap = true;
  if (kind === 'interact') a.intent.interactPressed = true;
  if (kind === 'range') a.p.x -= 100;
  if (kind === 'death') a.world.killPlayer(a.p, null, 'test');
  if (kind === 'down') a.world.downPlayer(a.p, null, 'test');
  if (kind === 'class') a.world.setClass(a.p, 'soldier', true);
  if (kind === 'vehicle') a.p.vehicle = 999;
  if (kind === 'turret') a.p.mount = 999;
  run(a, 0.05);
  t.equal(sentries(a).length, 0, kind + ': cancellation takes effect even on the completing tick');
  t.equal(a.p.sentryBuild, null, kind + ': progress is cleared');
}
{
  const a = arena(); run(a, 5); a.intent.fire = false; run(a, DT); a.intent.fire = true; run(a, 5);
  t.equal(sentries(a).length, 0, 'released partial construction cannot be resumed for a shortened build');
  t.near(a.p.sentryBuild.elapsed, 5, 1e-8, 'new build starts its full duration');
}
for (const kind of ['wall', 'crate', 'rock', 'structure', 'player']) {
  const extra = kind === 'wall' ? { buildings: [{ walls: [{ x: X + 50, y: Y - 50, w: 10, h: 100 }] }] }
    : kind === 'crate' ? { crates: [crate(X + 55)] }
    : kind === 'rock' ? { rocks: [{ id: 1, x: X + 100, y: Y, r: 25, alive: true }] } : {};
  const a = arena(extra);
  if (kind === 'structure') a.world.addStruct({ kind: 'turret', item: 'turret', x: X + 100, y: Y, r: 38, team: 1, hp: 100 });
  if (kind === 'player') a.world.addPlayer({ x: X + 100, y: Y, team: 2 });
  run(a, 10);
  t.equal(sentries(a).length, 0, kind + ': cannot build through or overlap cover and actors');
}
{
  const a = arena(); run(a, 9.95); a.world.addPlayer({ x: X + 100, y: Y, team: 2 }); run(a, DT);
  t.equal(sentries(a).length, 0, 'placement is revalidated when an actor enters the anchor at completion');
}
{
  const a = arena({}, true); a.world.updateSentryBuild(a.p, a.intent, 10);
  t.equal(sentries(a).length, 0, 'client mirror cannot create authoritative sentries');
  t.equal(a.p.sentryBuild, null, 'client mirror never invents construction progress');
}

function vehicleArena(type = 'tank', team = 2, item = 'sentry', extra = {}) {
  const a = arena(Object.assign({ vehicles: [{ id: 1, type, x: X + 250, y: Y, angle: 0 }] }, extra));
  a.intent.fire = false;
  const v = a.world.vehicles[0];
  const rider = a.world.addPlayer({ ...a.world.vehicleSeatPoint(v, 'driver', true), team });
  if (!a.world.enterVehicle(rider, v, 'driver')) throw Error('Unable to board vehicle test fixture');
  const def = W.ITEMS[item];
  const s = a.world.addStruct({ kind: 'sentry', item, x: X, y: Y - 10, r: W.STRUCT_RADIUS.sentry,
    team: 1, owner: a.p.id, hp: def.hp, maxHp: def.hp });
  a.world.events = [];
  return { ...a, v, rider, s };
}
for (const type of ['tank', 'humvee']) for (const item of ['sentry', 'sentry2', 'sentry3']) {
  const a = vehicleArena(type, 2, item), hp = a.v.hp, riderHp = a.rider.hp;
  a.world.updateSentry(a.s, DT);
  t.equal(a.v.hp, hp - W.ITEMS[item].damage * (type === 'tank' ? .25 : 1), type + '/' + item + ': shoots occupied enemy hull with its sentry resistance');
  t.equal(a.rider.hp, riderHp, type + '/' + item + ': hull protects occupants');
  t.equal(a.s.targetKind, 'vehicle', type + '/' + item + ': targets the vehicle explicitly');
  t.check(a.world.events.some(e => e.type === 'vehicle' && e.op === 'hp' && e.vehicle === a.v), type + '/' + item + ': hull damage replicates through the vehicle event');
  a.world.updateSentry(a.s, DT);
  t.equal(a.v.hp, hp - W.ITEMS[item].damage * (type === 'tank' ? .25 : 1), type + '/' + item + ': retains existing fire interval');
}
for (const kind of ['friendly', 'empty', 'wreck', 'wall', 'crate', 'blockingVehicle', 'range']) {
  const extra = kind === 'wall' ? { buildings: [{ walls: [{ x: X + 100, y: Y - 100, w: 15, h: 200 }] }] }
    : kind === 'crate' ? { crates: [crate(X + 100, Y - 5)] } : {};
  const a = vehicleArena('tank', kind === 'friendly' ? 1 : 2, 'sentry', extra);
  if (kind === 'empty') a.world.exitVehicle(a.rider, true);
  if (kind === 'wreck') a.v.wreck = true;
  if (kind === 'blockingVehicle') {
    a.world.vehicles.push({ ...a.v, id: 2, x: X + 110, y: Y, r: 40, seats: { driver: 0, rearLeft: 0, rearRight: 0, gunner: 0 } });
  }
  if (kind === 'range') { a.v.x += W.ITEMS.sentry.range; a.world.syncVehicleSeats(a.v); }
  const hp = a.v.hp;
  a.world.updateSentry(a.s, DT);
  t.equal(a.v.hp, hp, kind + ': sentries do not damage invalid or obscured vehicle targets');
}
{
  const a = vehicleArena(); a.rider.fx.invisible = 10;
  const hp = a.v.hp; a.world.updateSentry(a.s, DT);
  t.equal(a.v.hp, hp - W.ITEMS.sentry.damage * .25, 'invisible occupant does not hide the tank or bypass its sentry resistance');
}
{
  const a = vehicleArena();
  const enemy = a.world.addPlayer({ x: X + 60, y: Y + 60, team: 2 });
  const hp = a.v.hp; a.world.updateSentry(a.s, DT);
  t.equal(enemy.hp, enemy.maxHp - W.ITEMS.sentry.damage, 'a closer visible enemy on foot still takes priority');
  t.equal(a.v.hp, hp, 'one sentry shot hits only one target');
}
t.done();
