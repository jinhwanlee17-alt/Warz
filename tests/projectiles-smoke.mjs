// Shared preview/physics, airborne cover clearance, self damage, demolition and
// decorative foliage. Exercise the simulation used by both Practice and online.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(), t = suite('projectiles');
const { World, MapGen, WEAPONS, ITEMS, CONFIG: C } = W;
const DT = 1 / 120;
function map(extra = {}) {
  return Object.assign(MapGen.generate(22), { rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [], stations: [], ponds: [] }, extra);
}
function steps(world, seconds) { for (let i = 0; i < Math.ceil(seconds / DT); i++) world.update(DT); }
function crate(id, x, y) { return { id, x, y, size: 52, hp: 180, maxHp: 180, tier: 'epic', alive: true, shake: 0 }; }
const wall = { walls: [{ x: 3380, y: 3050, w: 24, h: 300 }] };
const throwIds = W.ITEM_ORDER.filter(id => ITEMS[id].kind === 'throw');
for (const id of ['grenade', ...throwIds.filter(id => id !== 'grenade'), 'launcher', 'launcher2']) {
  const world = new World({ map: map({ buildings: [wall] }), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200, classId: id === 'launcher2' ? 'grenadier2' : 'grenadier' });
  const launcher = id === 'launcher' || id === 'launcher2';
  const before = JSON.stringify({ p: [p.x, p.y, p.vx, p.vy], grenades: world.grenades });
  const solution = world.throwSolution(p, { aimX: 3600, aimY: 3200 }, id);
  t.equal(JSON.stringify({ p: [p.x, p.y, p.vx, p.vy], grenades: world.grenades }), before, id + ': preview does not mutate the simulation');
  t.near(solution.targetX, 3600, 0.001, id + ': preview aims through cover to selected landing spot');
  const middle = world.trajectoryPoint(solution, 0.5);
  t.check(middle.z > 60 && middle.x > solution.startX && middle.x < solution.targetX, id + ': preview has an actual elevated arc');
  const g = launcher ? world.spawnShell(p, solution) : world.spawnGrenade(p, { ...solution, item: id, fuse: ITEMS[id].fuse });
  steps(world, solution.flightTime * 0.65);
  t.check(g.x > 3404 && g.z > 0, id + ': projectile clears the building wall while airborne');
  const point = world.trajectoryPoint(solution, Math.min(1, g.flightElapsed / g.flightTime));
  t.near(g.x, point.x, 0.001, id + ': flight x matches shared preview');
  t.near(g.z, point.z, 0.001, id + ': flight height matches shared preview');
  steps(world, solution.flightTime * 0.35 + DT);
  t.near(g.x, solution.targetX, 0.001, id + ': landing matches the preview x');
  t.near(g.y, solution.targetY, 0.001, id + ': landing matches the preview y');
  t.equal(g.z, 0, id + ': lands back at ground height');
  if (launcher) {
    t.check(g.shell && g.fuse > 0 && world.grenades.includes(g), id + ': landing starts the weapon-specific fuse');
    t.near(g.maxFuse, WEAPONS[id].landFuse, 0.00001, id + ': retains configured fuse');
    steps(world, WEAPONS[id].landFuse + DT);
    const blast = world.events.find(e => e.type === 'explosion');
    t.check(blast && blast.cause === id && blast.power === WEAPONS[id].explosion.maxDamage, id + ': retains configured damage and source id');
  } else if (ITEMS[id].fuse === 0) t.check(!world.grenades.includes(g), id + ': landing-triggered grenade bursts on landing');
}
{
  const world = new World({ map: map({ buildings: [wall], rocks: [{ x: 3550, y: 3300, r: 60 }] }), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200 });
  const hitWall = world.throwSolution(p, { x: 3390, y: 3200 }, 'grenade');
  t.check(hitWall.targetX <= 3370 || hitWall.targetX >= 3414, 'landing target inside a wall is pushed safely to its surface');
  const hitRock = world.throwSolution(p, { x: 3550, y: 3300 }, 'grenade');
  t.check(Math.hypot(hitRock.targetX - 3550, hitRock.targetY - 3300) >= 69, 'landing target inside a rock moves outside its collision radius');
  const ranged = world.throwSolution(p, { x: 6000, y: 3200 }, 'grenade');
  t.near(ranged.range, WEAPONS.grenade.throwRange, 0.001, 'throw preview clamps range exactly like firing');
}
{
  const world = new World({ map: map(), storm: false }), mirror = new World({ map: map(), remote: true });
  const p = world.addPlayer({ id: 4, x: 3200, y: 3200, classId: 'grenadier2' });
  const mp = mirror.addPlayer({ id: 4, x: 3200, y: 3200, classId: 'grenadier2' });
  world.fireLauncher(p, WEAPONS.launcher2, { aimX: 3700, aimY: 3300 });
  const event = world.events.find(e => e.type === 'launch'), original = world.grenades[0];
  const copy = mirror.spawnShell(mp, event);
  t.check(event.weapon === 'launcher2' && Number.isFinite(event.targetX) && event.flightTime > 0, 'launch replication carries exact trajectory and weapon identity');
  steps(world, 0.25); steps(mirror, 0.25);
  t.near(copy.x, original.x, 0.0001, 'mirrored launcher x matches authoritative arc');
  t.near(copy.z, original.z, 0.0001, 'mirrored launcher height matches authoritative arc');
  t.equal(copy.explosion.maxDamage, 70, 'mirrored level-two shell preserves its damage definition');
  const g = world.lob(p, 3450, 3400, 0, 'firenade');
  const handEvent = { ...world.projectileEvent(g), item: 'firenade', fuse: g.fuse };
  const handCopy = mirror.spawnGrenade(mp, handEvent);
  world.updateHand(g, 0.2); mirror.updateHand(handCopy, 0.2);
  t.near(g.x, handCopy.x, 0.0001, 'mirrored item grenade follows transmitted path');
  t.near(g.z, handCopy.z, 0.0001, 'mirrored item grenade has matching height');
  t.check(handCopy.instant, 'replicated fire grenade still bursts on landing');
}
{
  const world = new World({ map: map(), storm: false, teams: true });
  const p = world.addPlayer({ x: 3200, y: 3200, team: 1 });
  const mate = world.addPlayer({ x: 3250, y: 3200, team: 1 });
  const enemy = world.addPlayer({ x: 3200, y: 3250, team: 2 });
  world.explode(p.x, p.y, WEAPONS.launcher.explosion, p.id, 'launcher');
  t.equal(p.hp, 62, 'own launcher blast hurts its owner');
  t.equal(mate.hp, 100, 'launcher blast still protects another teammate');
  t.check(enemy.hp < 100, 'launcher blast also damages enemies');
  world.itemBurst('firenade', p.x, p.y, p.id); world.updateZones(0.25);
  t.check(p.hp < 62 && mate.hp === 100, 'own fire grenade burns the owner but protects teammates');
  world.itemBurst('poison', p.x, p.y, p.id);
  t.check(p.fx.poison > 0 && mate.fx.poison === 0, 'own poison grenade poisons the owner but protects teammates');
}
{
  const rocks = [{ x: 3500, y: 3200, r: 45 }, { x: 3570, y: 3200, r: 35 }];
  const c = crate(7, 3550, 3260), world = new World({ map: map({ rocks, crates: [c] }), storm: false });
  const p = world.addPlayer({ x: 3000, y: 3000 });
  const portable = world.addStruct({ kind: 'rock', item: 'rock', x: 3500, y: 3350, r: 116, owner: p.id, team: p.team });
  const enemy = world.addPlayer({ x: 3500, y: 3070 });
  world.explode(3500, 3070, WEAPONS.launcher2.explosion, p.id, 'launcher2');
  t.equal(enemy.hp, 30, 'level-two launcher deals seventy at the blast center');
  t.check(rocks.every(r => !r.alive), 'one demolition blast destroys all map rocks it reaches');
  // The second blast reaches the crate and portable boulder without player overlap.
  world.explode(3500, 3260, WEAPONS.launcher2.explosion, p.id, 'launcher2');
  t.check(!c.alive && !portable.alive, 'one demolition blast destroys even an armored crate and allied portable rock');
  t.equal(world.events.filter(e => e.type === 'rock-gone').length, 2, 'one rock-gone event is emitted per destroyed map rock');
  world.explode(3500, 3260, WEAPONS.launcher2.explosion, p.id, 'launcher2');
  t.equal(world.events.filter(e => e.type === 'rock-gone').length, 2, 'repeated blasts cannot destroy the same map rock twice');
  const bullet = { owner: p.id, team: p.team, weapon: 'ar', damage: 10, x: 3400, y: 3200, ox: 3400, oy: 3200, dx: 1, dy: 0, speed: 1000, traveled: 0, range: 600, r: 5 };
  t.check(world.advanceBullet(bullet, 240) && bullet.x === 3640, 'destroyed map rocks no longer block bullets');
  p.x = 3500; p.y = 3200; p.vx = p.vy = 0; world.collide(p);
  t.check(p.x === 3500 && p.y === 3200, 'destroyed map rocks no longer leave an invisible collision circle');
}
{
  const tree = { x: 3300, y: 3200, r: 100, trunk: 20 }, world = new World({ map: map({ trees: [tree] }), storm: false });
  const p = world.addPlayer({ x: 3300, y: 3200 });
  world.collide(p);
  t.check(p.x === 3300 && p.y === 3200, 'green tree canopy has no hidden center movement collision');
  t.equal(world.sweep(3200, 3200, 3400, 3200, 5, p.id, p.team), null, 'decorative foliage also does not invisibly stop bullets');
}
t.done();
