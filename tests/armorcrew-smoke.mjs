// Armor Crew personal combat, authoritative repair and enemy exposure.
import { loadWarz, suite } from './harness.mjs';
import { BotDirector } from '../server/core/bots/index.mjs';
const W = loadWarz(), t = suite('Armor Crew'), STEP = 0.05;
function arena(extra = {}, remote = false) {
  const map = Object.assign({ seed: 5, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
    pickups: [], ponds: [], stations: [], towns: [], drops: [], tanks: [], nextPickupId: 1,
    vehicles: [{ id: 1, x: 5000, y: 5000, angle: 0 }] }, extra);
  const world = new W.World({ map, remote, storm: false });
  const p = world.addPlayer({ classId: 'armorcrew', x: 4800, y: 5000, team: 1 });
  p.controller = () => ({ mx: 0, my: 0, aimX: p.x + 100, aimY: p.y });
  const v = world.vehicles[0]; if (v) v.hp = v.maxHp - 200;
  return { world, p, v };
}
function run(world, seconds, dt = STEP) { for (let i = 0; i < Math.round(seconds / dt); i++) world.update(dt); }
function foe(world, x = 4870, y = 5000, team = 2) { const p = world.addPlayer({ x, y, team }); p.hp = p.maxHp = 1000; return p; }
function swing(a) { return a.world.trigger(a.p, { fire: true, firePressed: true }); }

{
  const a = arena(), { world, p } = a, target = foe(world);
  t.check(p.hp === 150 && p.maxHp === 150 && p.weapons.map(w => w.id).join() === 'hammer,pistol', 'class starts at150 HP with hammer and pistol');
  t.equal(world.classDamageMul(p), 1.05, 'vehicle weapon helper exposes the5% class bonus');
  t.equal(world.damageMul(p), 1, 'ordinary attacks receive no class damage bonus');
  t.check(swing(a), 'hammer accepts its first swing');
  t.equal(target.hp, 970, 'hammer deals exactly30 damage');
  t.check(p.meleeSwing === 0.24 && p.meleeAngle === 0 && world.events.some(e => e.type === 'melee' && e.weapon === 'hammer' && e.reach === 90), 'swing initializes matching animation and network event fields');
  t.equal(swing(a), false, 'hammer cannot bypass its cooldown');
  run(world, 0.55); t.equal(swing(a), false, 'hammer remains on cooldown before0.6 seconds');
  run(world, 0.05); t.check(swing(a) && target.hp === 940, 'hammer can swing again after0.6 seconds');
  world.damagePlayer(target, W.WEAPONS.pistol.damage, p.id, 'pistol');
  t.equal(target.hp, 940 - W.WEAPONS.pistol.damage, 'pistol keeps its normal damage');
}
for (const scenario of ['range', 'behind', 'friendly', 'wall']) {
  const extra = scenario === 'wall' ? { buildings: [{ walls: [{ x: 4835, y: 4920, w: 10, h: 160 }] }] } : {};
  const a = arena(extra), target = foe(a.world, scenario === 'range' ? 4915 : scenario === 'behind' ? 4730 : 4870, 5000, scenario === 'friendly' ? 1 : 2);
  swing(a);
  t.equal(target.hp, 1000, scenario + ': hammer respects reach, aim cone, teams and cover');
}
{
  const a = arena({ vehicles: [] }), near = foe(a.world, 4870), far = foe(a.world, 4900);
  swing(a);
  t.check(near.hp === 970 && far.hp === 1000, 'one hammer swing hits only its nearest target');
}
for (const kind of ['crate', 'turret', 'rock', 'vehicle']) {
  const a = arena({ vehicles: kind === 'vehicle' ? [{ id: 1, x: 4950, y: 5000, angle: 0 }] : [] });
  let target;
  if (kind === 'crate') {
    target = { id: 0, x: 4870, y: 5000, size: 52, hp: 100, maxHp: 100, tier: 'common', alive: true, shake: 0 };
    a.world.map.crates.push(target); a.world.solids.insert({ type: 'crate', shape: 'rect', x: 4844, y: 4974, w: 52, h: 52, crate: target }, 4844, 4974, 4896, 5026);
  } else if (kind === 'vehicle') target = a.v;
  else target = a.world.addStruct({ kind, item: kind, x: kind === 'rock' ? 4970 : 4870, y: 5000, r: kind === 'rock' ? 116 : 38, hp: kind === 'rock' ? 1000 : 100, maxHp: kind === 'rock' ? 1000 : 100, team: 2 });
  const hp = target.hp; swing(a);
  t.equal(target.hp, hp - (kind === 'rock' ? 0 : 30), kind + ': hammer uses normal damage paths and preserves placed-rock immunity');
}
{
  const a = arena({ vehicles: [] }), rider = foe(a.world, 4870);
  const mount = a.world.addStruct({ kind: 'turret', item: 'turret', x: 4870, y: 5000, r: 38, hp: 100, maxHp: 100, team: 2 });
  a.world.mountTurret(rider, mount); swing(a);
  t.check(rider.hp === 970 && mount.hp === 100, 'hammer hits a turret rider once without also damaging the platform');
}
{
  const a = arena(), rock = a.world.addStruct({ kind: 'rock', item: 'rock', x: 5400, y: 5000, r: 116, team: a.p.team, owner: a.p.id });
  a.world.damagePlayerRock(rock, a.p.id);
  t.equal(rock.hp, 900, 'Armor Crew ram damage to placed rocks remains100 because the bonus is for vehicle weapons only');
}
for (const cause of ['ar', 'grenade', 'tank-cannon', 'tankmg', 'ram', 'lightning', 'storm', 'snow', 'poison']) {
  const { world, p } = arena(), source = foe(world, 5500);
  world.damagePlayer(p, 20, source.id, cause);
  t.equal(p.hp, 132, cause + ': permanent mitigation reduces incoming personal damage by10%');
}
{
  const { world, p } = arena(), source = foe(world, 5500);
  p.armor = 10; world.damagePlayer(p, 20, source.id, 'ar');
  t.check(p.armor === 0 && p.hp === 142, 'personal mitigation applies before armor absorption');
  p.hp = 150; p.armor = 50; world.damagePlayer(p, 20, source.id, 'lightning');
  t.check(p.armor === 50 && p.hp === 132, 'lightning retains armor bypass while respecting permanent personal protection');
  p.hp = 150; p.armor = 0; p.fx.shield = 5; world.damagePlayer(p, 20, source.id, 'ar');
  t.near(150 - p.hp, 20 * (1 - W.ITEMS.shield.reduce) * 0.9, 0.1, 'permanent protection stacks once with a shield potion');
}
for (const [type, fixed] of [['humvee', false], ['tank', false], ['artillery', false], ['artillery', true]]) for (const dt of [1 / 20, 1 / 60]) {
  const { world, p, v } = arena({ vehicles: [{ id: 1, type, fixed, x: 5000, y: 5000, angle: 0 }] });
  p.x = v.x - v.r - 120;
  t.equal(world.nearestRepairVehicle(p), v, 'repair selects a damaged hull at exactly120 units from its surface');
  t.check(world.useUtility(p, {}), 'class utility toggles repair on');
  const seconds = type === 'humvee' ? 3.5 : 2;
  run(world, seconds, dt);
  t.near(v.hp, v.maxHp - 100, 1e-7, type + ' at ' + Math.round(1 / dt) + ' Hz: repairs100HP in' + seconds + 'seconds');
  const events = world.events.filter(e => e.type === 'vehicle' && e.op === 'repair');
  t.check(events.length <= Math.ceil(seconds * 5) && events.length >= Math.floor(seconds * 5), 'repair health events remain limited to five per second');
  t.check(world.useUtility(p, {}) && p.repairVehicle === 0, 'pressing utility again stops repair');
  t.near(world.events.filter(e => e.type === 'vehicle' && e.op === 'repair').reduce((n, e) => n + e.amount, 0), 100, 1e-7, 'batched repair events plus final flush conserve exact healing');
  const hp = v.hp; run(world, 0.5, dt); t.equal(v.hp, hp, 'stopped repair does not heal later ticks');
}
{
  const { world, p, v } = arena();
  v.hp = v.maxHp - 0.25; world.toggleVehicleRepair(p); world.update(STEP);
  t.check(v.hp === v.maxHp && !p.repairVehicle, 'repair caps at maximum HP and stops immediately');
  t.near(world.events.find(e => e.type === 'vehicle' && e.op === 'repair').amount, 0.25, 1e-9, 'final fractional repair amount is flushed');
}
for (const action of ['move', 'fire', 'displaced', 'out-of-range', 'wreck', 'full', 'downed', 'dead', 'class-change', 'weapon-change', 'held-item', 'vehicle', 'turret']) {
  const { world, p, v } = arena(); world.toggleVehicleRepair(p);
  if (action === 'move') p.controller = () => ({ mx: 1, my: 0 });
  if (action === 'fire') p.controller = () => ({ mx: 0, my: 0, fire: true, aimX: 4700, aimY: 5000 });
  if (action === 'displaced') p.x -= 1;
  if (action === 'out-of-range') v.x += 100;
  if (action === 'wreck') v.wreck = true;
  if (action === 'full') v.hp = v.maxHp;
  if (action === 'downed') world.downPlayer(p, null, 'ar');
  if (action === 'dead') world.killPlayer(p, null, 'ar');
  if (action === 'class-change') world.setClass(p, 'soldier', false);
  if (action === 'weapon-change') world.switchSlot(p, 1);
  if (action === 'held-item') { world.addItem(p, 'bandage', 1); world.selectItem(p, 0); }
  if (action === 'vehicle') { const at = world.vehicleSeatPoint(v, 'driver', true); p.x = at.x; p.y = at.y; world.enterVehicle(p, v, 'driver'); }
  if (action === 'turret') { const s = world.addStruct({ kind: 'turret', item: 'turret', x: p.x, y: p.y, r: 38, hp: 100, maxHp: 100, team: p.team }); world.mountTurret(p, s); }
  const hp = v.hp; world.update(STEP);
  t.equal(p.repairVehicle, 0, action + ': cancels repair');
  t.equal(v.hp, hp, action + ': cancellation does not grant another repair tick');
}
{
  const { world, p } = arena();
  world.switchSlot(p, 1); world.addItem(p, 'bandage', 1); world.selectItem(p, 0);
  t.check(world.toggleVehicleRepair(p) && p.weapons[p.slot].id === 'hammer' && p.held === -1, 'repair automatically equips the hammer from a pistol or held item');
}
{
  const { world, p, v } = arena();
  v.wreck = true; t.equal(world.nearestRepairVehicle(p), null, 'wrecks cannot be repaired');
  v.wreck = false; v.hp = v.maxHp; t.equal(world.nearestRepairVehicle(p), null, 'full hulls cannot start repair');
  v.hp -= 100; p.x -= 0.1; t.equal(world.nearestRepairVehicle(p), null, 'repair reach ends at120 units from the hull');
  p.x += 0.1; world.setClass(p, 'soldier', false); t.equal(world.nearestRepairVehicle(p), null, 'other classes cannot repair');
}
{
  const { world, p } = arena(); world.toggleVehicleRepair(p); p.fx.invisible = 10;
  const enemy = foe(world, p.x + 1125), distant = foe(world, p.x + 1125.01), friend = foe(world, p.x + 300, p.y, p.team);
  t.check(world.revealedEnemies(enemy).includes(p), 'active repair reveals the crew at exactly2.5 smoke radii even while invisible');
  t.check(!world.revealedEnemies(distant).includes(p), 'repair does not reveal beyond1125 units');
  t.check(!world.revealedEnemies(friend).includes(p), 'repair does not add friendly reveal markers');
  const dir = new BotDirector({ W, world, seed: 5, teamSize: 1 });
  const brain = dir.add(enemy, { skill: 0.6 }); brain.now = world.time; brain.sense();
  t.check(brain.known.get(p.id)?.revealed, 'bots receive repair exposure without already using radar or a drone');
  world.stopVehicleRepair(p);
  t.check(!world.revealedEnemies(enemy).includes(p), 'exposure ends as soon as repair stops');
}
{
  const a = arena({}, true); a.v.hidden = false;
  const hp = a.v.hp;
  t.equal(a.world.toggleVehicleRepair(a.p), false, 'client mirror cannot start authoritative repair');
  a.p.repairVehicle = a.v.id; a.world.updateVehicleRepair(a.p, {}, 1);
  t.equal(a.v.hp, hp, 'client mirror never heals its own hull replica');
  t.equal(swing(a), false, 'client mirror never performs authoritative hammer hits');
}
t.done();
