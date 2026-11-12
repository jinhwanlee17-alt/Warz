// Hull resistances and timed Sentry IV effects through the shared vehicle simulation.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(), t = suite('Sentry vehicle effects'), DT = 0.05;
function arena(type = 'tank', remote = false) {
  const map = { seed: 47, size: W.CONFIG.worldSize, teamSize: 4, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
    pickups: [], ponds: [], stations: [], drops: [], towns: [], nextPickupId: 1, tanks: [],
    vehicles: [{ id: 1, type, x: 8000, y: 8000, angle: 0 }] };
  const w = new W.World({ map, teams: true, remote, storm: false }), v = w.vehicles[0];
  v.hidden = false; v.armed = true;
  const owner = w.addPlayer({ x: 10000, y: 10000, team: 2 });
  return { w, v, owner };
}
function board(a, seat = 'driver', classId = 'soldier') {
  const p = a.w.addPlayer({ ...a.w.vehicleSeatPoint(a.v, seat, true), classId, team: 1 });
  if (!a.w.enterVehicle(p, a.v, seat)) throw Error('Boarding fixture failed: ' + seat);
  return p;
}
function tick(a, seconds, dt = DT) {
  for (let i = 0; i < Math.round(seconds / dt); i++) { a.w.time += dt; a.w.updateVehicles(dt); }
}
const reduced = ['ar', 'pistol', 'sniper', 'shotgun', 'deagle', 'sniper2', 'shotgun2', 'revolver', 'minigun', 'commandpistol',
  'shieldpistol', 'turret', 'tankmg', 'sentry', 'sentry-bullets', 'sentry-grenades', 'sentry-fireballs'];
for (const type of ['tank', 'humvee']) {
  const a = arena(type), { w, v, owner } = a;
  for (const cause of reduced) {
    v.hp = v.maxHp;
    w.damageVehicle(v, 100, owner.id, cause);
    t.equal(v.maxHp - v.hp, type === 'tank' ? 25 : 100, type + ': ' + cause + ' uses the requested hull resistance once');
  }
  for (const amount of [10, 55, 100]) {
    v.hp = v.maxHp; w.damageVehicle(v, amount, owner.id, 'sentry-rockets');
    t.equal(v.maxHp - v.hp, amount, type + ': rocket sentry bypasses armor for ' + amount + ' raw hull damage');
  }
  for (const cause of ['grenade', 'launcher', 'launcher2', 'fire', 'flamethrower', 'snow', 'storm', 'lightning', 'meteor', 'airstrike', 'tank-cannon', 'ram', 'ram-impact']) {
    v.hp = v.maxHp; w.damageVehicle(v, 100, owner.id, cause);
    t.equal(v.maxHp - v.hp, 100, type + ': ordinary ' + cause + ' keeps existing damage');
  }
  v.hp = v.maxHp; w.damageVehicle(v, 10, owner.id, 'sentry-snowballs');
  t.equal(v.maxHp - v.hp, type === 'tank' ? 2.5 : 5, type + ': snowball-specific resistance is not applied twice');
  v.hp = v.maxHp; owner.commandBuff = 30; owner.fx.strength = 30;
  w.damageVehicle(v, 510, owner.id, 'sentry-cannons');
  t.equal(v.maxHp - v.hp, 510, type + ': cannon retains exactly510 hull damage despite owner buffs and tank armor');
  v.hp = v.maxHp; w.damageVehicle(v, 1, owner.id, 'sentry-burn');
  t.equal(v.maxHp - v.hp, type === 'tank' ? 0 : 1, type + ': burn is one unamplified damage or tank immunity');
  owner.commandBuff = 0; owner.fx.strength = 0;
}
{
  const { w, v, owner } = arena();
  w.damageVehicle(v, 5, owner.id, 'sentry');
  t.equal(v.maxHp - v.hp, 1.25, 'basic five-damage sentry retains the exact75% tank reduction');
  t.equal(owner.stats.damage, 1.25, 'damage statistics record the actual reduced hull damage');
  const crew = w.addPlayer({ ...w.vehicleSeatPoint(v, 'driver', true), team: 1 });
  w.enterVehicle(crew, v, 'driver');
  const ally = w.addPlayer({ x: 9000, y: 8000, team: 1 });
  const before = v.hp;
  t.check(!w.damageVehicle(v, 500, ally.id, 'sentry-cannons') && v.hp === before, 'cannon armor bypass does not bypass team protection');
}
for (const type of ['tank', 'humvee']) {
  const a = arena(type), { w, v } = a;
  t.equal(w.vehicleSentryRate(v), 1, type + ': undebuffed weapon clocks run normally');
  for (let i = 1; i <= 12; i++) {
    w.applyVehicleSentrySnow(v);
    t.near(w.vehicleSentryRate(v), 1 - Math.min(i, 10) * .05, 1e-12, type + ': snow hit ' + i + ' slows weapon clocks up to50%');
  }
  t.equal(v.sentrySnow.length, 10, type + ': capped stacks do not grow without bound');
  tick(a, 2.95);
  t.near(w.vehicleSentryRate(v), .5, 1e-12, type + ': stacks remain for their full three seconds');
  tick(a, .05);
  t.equal(w.vehicleSentryRate(v), 1, type + ': snow expires at three seconds');
  t.equal(v.sentrySnow.length, 0, type + ': expired stack storage is cleared');
}
{
  const { w, v } = arena();
  w.applyVehicleSentrySnow(v); w.time = 1; w.applyVehicleSentrySnow(v);
  w.time = 3.05;
  t.near(w.vehicleSentryRate(v), .95, 1e-12, 'staggered snow hits expire independently');
  v.sentrySnow = [3.025];
  t.near(w.vehicleSentryWeaponTime(v, .05), .04875, 1e-12, 'mid-tick snow expiry only slows the active part of the tick');
  w.time = 4.01; t.equal(w.vehicleSentryRate(v), 1, 'the last snow stack expires independently');
}
for (const type of ['tank', 'humvee']) {
  const base = arena(type), slow = arena(type);
  for (let i = 0; i < 10; i++) slow.w.applyVehicleSentrySnow(slow.v);
  base.w.driveVehicle(base.v, { mx: 1, my: 0 }, 1);
  slow.w.driveVehicle(slow.v, { mx: 1, my: 0 }, 1);
  t.near(slow.v.x, base.v.x, 1e-9, type + ': snowballs do not slow driving');
  t.near(slow.v.vx, base.v.vx, 1e-9, type + ': snowballs do not alter top-speed acceleration');
}
{
  const a = arena(), { w, v } = a;
  const driver = board(a); driver.vehicleIntent = {};
  v.mgAmmo = 0; w.reloadTankGun(v);
  v.cannonAmmo = 0; w.reloadTankCannon(v);
  for (let i = 0; i < 10; i++) w.applyVehicleSentrySnow(v);
  tick(a, 2);
  t.near(v.mgReload, W.TANK.mgReload - 1, 1e-8, 'two seconds at max slow advance MG reload by one second');
  t.near(v.cannonReload, W.TANK.cannonInterval - 1, 1e-8, 'two seconds at max slow advance cannon reload by one second');
  tick(a, 1); // slow expires precisely here after1.5 reload seconds
  tick(a, 1.5);
  t.check(v.cannonReload === 0 && v.cannonAmmo === 1, 'cannon reload resumes normal speed after the last snow expires');
}
function firing(type, slowed, crew = false) {
  const a = arena(type), p = board(a, type === 'tank' ? 'driver' : 'gunner', crew ? 'armorcrew' : 'soldier');
  p.vehicleWeapon = 1; p.vehicleIntent = { fire: true, aimX: 9000, aimY: 8000 };
  for (let i = 0; i < 200; i++) {
    if (slowed) for (let j = 0; j < 10; j++) a.w.applyVehicleSentrySnow(a.v);
    tick(a, DT);
  }
  return p.stats.shots;
}
for (const type of ['tank', 'humvee']) {
  const fast = firing(type, false), slow = firing(type, true);
  t.near(slow / fast, .5, .015, type + ': sustained max snow halves actual mounted weapon fire rate');
}
{
  const plain = firing('tank', true), crew = firing('tank', true, true);
  t.near(crew / plain, W.ARMOR_CREW.tankFireRateMul, .025, 'Armor Crew fire-rate bonus composes once with snow slowdown');
}
for (const dt of [.05, 1 / 60, .2]) {
  const a = arena('humvee'), { w, v, owner } = a;
  w.applyVehicleSentryBurn(v, owner.id); tick(a, 3, dt);
  t.near(v.maxHp - v.hp, 30, 1e-8, 'three-second Humvee burn deals thirty ticks at dt=' + dt);
  t.equal(v.sentryBurn, null, 'burn stops after its exact duration at dt=' + dt);
}
{
  const a = arena('humvee'), { w, v, owner } = a;
  w.applyVehicleSentryBurn(v, owner.id); tick(a, 1);
  for (let i = 0; i < 20; i++) w.applyVehicleSentryBurn(v, owner.id);
  tick(a, 3);
  t.near(v.maxHp - v.hp, 40, 1e-8, 'repeated fireballs refresh one burn instead of multiplying periodic damage');
  v.hp = 2; w.applyVehicleSentryBurn(v, owner.id); tick(a, .2);
  t.check(v.wreck && !v.sentryBurn && !v.sentrySnow.length, 'burn can wreck a Humvee and clears all status effects');
}
{
  const tank = arena();
  t.check(!tank.w.applyVehicleSentryBurn(tank.v, tank.owner.id) && !tank.v.sentryBurn, 'tank cannot start burning');
  const a = arena('humvee', true), { w, v, owner } = a;
  t.check(!w.applyVehicleSentryBurn(v, owner.id) && !w.applyVehicleSentrySnow(v), 'client mirror cannot originate debuffs');
  v.sentryBurn = { until: 3, next: .1, owner: owner.id }; v.sentrySnow = [3];
  tick(a, 3);
  t.equal(v.hp, v.maxHp, 'remote status timers never subtract hull health locally');
  t.equal(v.sentryBurn, null, 'remote burn visuals expire without authoring damage');
}
t.done();
