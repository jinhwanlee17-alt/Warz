import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(), t = suite('Rocketeer RPG'), DT = .05, X = 5000, Y = 5000;
function arena(extra = {}, remote = false) {
  const map = Object.assign({ seed: 47, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], nextPickupId: 1 }, extra);
  const w = new W.World({ map, remote, storm: false });
  const p = w.addPlayer({ classId: 'rocketeer', x: X, y: Y, team: 1 });
  const target = w.addPlayer({ x: X + 400, y: Y, team: 2 }); target.hp = target.maxHp = 10000;
  return { w, p, target };
}
function run(a, seconds, dt = DT) { for (let i = 0; i < Math.round(seconds / dt); i++) a.w.update(dt); }
function fly(a, seconds, dt = DT) { for (let i = 0; i < Math.round(seconds / dt); i++) { a.w.time += dt; a.w.updateRpgRockets(dt); } }
function impact(a, target = a.target) {
  const g = { id: 100, owner: a.p.id, team: a.p.team, x: target.x - target.r, y: target.y, dx: 1, dy: 0 };
  a.w.rpgImpact(g, target.type ? { solid: { vehicle: target } } : { player: target }, g.x, g.y);
}
function vehicleArena(type) {
  const a = arena({ vehicles: [{ id: 1, type, x: X + 400, y: Y, angle: 0 }] });
  const v = a.w.vehicles[0]; Object.assign(a.target, a.w.vehicleSeatPoint(v, 'driver', true));
  if (!a.w.enterVehicle(a.target, v, 'driver')) throw Error('vehicle fixture');
  return { ...a, v };
}

{
  const a = arena(), d = W.WEAPONS.rpg;
  t.equal(a.p.hp, 65, 'Rocketeer spawns with 65 HP');
  t.equal(a.p.weapons.map(w => w.id).join(), 'rpg,pistol', 'Rocketeer carries the RPG and Basic Pistol');
  t.equal(d.explosion.radius, W.WEAPONS.grenade.explosion.radius * .9, 'RPG blast radius is ten percent smaller than a grenade');
  t.check(d.unlimitedRange && d.range > W.CONFIG.worldSize * Math.SQRT2, 'RPG range covers the entire island diagonal');
  t.check(d.projectileRadius > W.SENTRY_IV.rockets.radius, 'RPG projectile is larger than a sentry rocket');
  t.equal(a.w.aimedProjectile(a.p), null, 'RPG fires straight without grenade hold-to-charge input');
  t.check(a.w.trigger(a.p, { firePressed: true }), 'clicking once fires the RPG immediately');
  t.equal(a.p.weapons[0].ammo, 0, 'one rocket empties the one-round magazine');
  t.check(a.p.weapons[0].reloading && a.p.weapons[0].reloadT === d.reload, 'empty magazine automatically starts the configured reload');
  t.equal(a.p.stats.shots, 1, 'a shot is counted exactly once');
  t.equal(a.w.events.filter(e => e.type === 'rpg-shot').length, 1, 'one authoritative firing event is emitted');
  fly(a, .5);
  t.equal(a.target.hp, 9800, 'physical direct impact deals 200 infantry damage');
  t.equal(a.w.rpgRockets.length, 0, 'contact immediately consumes the rocket');
  t.equal(a.w.events.filter(e => e.type === 'rpg-impact').length, 1, 'one authoritative impact event is emitted');
  t.equal(a.w.grenades.length, 0, 'RPG does not enter grenade arcs or delayed-fuse storage');
}
{
  const a = arena(); a.target.x = X + 6000; a.w.trigger(a.p, { fire: true }); fly(a, 6);
  t.equal(a.target.hp, 9800, 'rocket physically crosses thousands of units without range falloff');
}
{
  const a = arena(); a.target.x = X + 10000;
  const intent = { mx: 0, my: 0, aimX: a.target.x, aimY: a.target.y, fire: true };
  a.p.controller = () => intent; a.w.trigger(a.p, intent);
  a.w.updatePlayer(a.p, W.WEAPONS.rpg.reload - .01);
  t.equal(a.p.stats.shots, 1, 'holding fire cannot shoot during the reload');
  a.w.updatePlayer(a.p, .02);
  t.equal(a.p.stats.shots, 2, 'holding fire shoots the next rocket when reload completes');
  t.check(a.p.weapons[0].reloading && a.p.weapons[0].ammo === 0, 'second shot automatically reloads again with unlimited reserves');
  for (let i = 0; i < 5; i++) a.w.updatePlayer(a.p, W.WEAPONS.rpg.reload + .01);
  t.equal(a.p.stats.shots, 7, 'successive reloads do not consume a hidden reserve limit');
}
for (const kind of ['dead', 'downed', 'dropping', 'mounted', 'vehicle', 'empty', 'reloading', 'cooldown']) {
  const a = arena();
  if (kind === 'dead') a.p.alive = false;
  if (kind === 'downed') a.p.downed = true;
  if (kind === 'dropping') a.p.dropT = 1;
  if (kind === 'mounted') a.p.mount = 9;
  if (kind === 'vehicle') a.p.vehicle = 9;
  if (kind === 'empty') a.p.held = 0;
  if (kind === 'reloading') a.p.weapons[0].reloading = true;
  if (kind === 'cooldown') a.p.weapons[0].cooldown = 1;
  t.equal(a.w.trigger(a.p, { fire: true, firePressed: true }), false, kind + ': cannot fire RPG');
  t.equal(a.p.stats.shots, 0, kind + ': does not count a shot or consume ammunition');
}
{
  const a = arena(); a.w.trigger(a.p, { fire: true }); a.w.switchSlot(a.p, 1);
  t.check(!a.p.weapons[0].reloading && a.p.weapons[0].ammo === 0, 'switching to pistol cancels the partial RPG reload');
  a.w.switchSlot(a.p, 0); a.p.weapons[0].cooldown = 0; a.w.trigger(a.p, { fire: true });
  t.equal(a.p.weapons[0].reloadT, W.WEAPONS.rpg.reload, 'switching back starts the full reload before another rocket');
  t.equal(a.p.stats.shots, 1, 'switching does not bypass the reload');
}
for (const [kind, max] of [[null, 200], ['humvee', 500], ['tank', 1000]]) {
  const a = arena(), radius = W.WEAPONS.rpg.explosion.radius;
  t.equal(a.w.rpgDamageAt(0, kind, false), max, (kind || 'player') + ': center damage matches requested maximum');
  t.equal(a.w.rpgDamageAt(radius, kind, false), 10, (kind || 'player') + ': blast edge retains ten damage');
  t.equal(a.w.rpgDamageAt(radius + .01, kind, false), 0, (kind || 'player') + ': outside blast deals no damage');
  t.equal(a.w.rpgDamageAt(radius / 2, kind, false), (max + 10) / 2, (kind || 'player') + ': blast damage falls off linearly');
  t.equal(a.w.rpgDamageAt(radius * 2, kind, true), max, (kind || 'player') + ': direct contact receives full damage');
}
for (const type of ['humvee', 'tank']) {
  const a = vehicleArena(type), before = a.v.hp, riderHp = a.target.hp;
  a.w.trigger(a.p, { firePressed: true }); fly(a, .5);
  t.equal(before - a.v.hp, type === 'tank' ? 1000 : 500, type + ': real rocket hits the hull for its anti-vehicle maximum');
  t.equal(a.target.hp, riderHp, type + ': occupants are protected by the hull');
  t.equal(a.w.events.filter(e => e.type === 'vehicle' && e.op === 'hp').length, 1, type + ': hull is damaged once, without duplicate rider hits');
  t.equal(a.w.vehicleSentryDamageMul(a.v, 'rpg'), 1, type + ': RPG is not reduced by tank bullet/sentry resistance');
}
for (const type of ['humvee', 'tank']) for (const portion of [.5, 1, 1.01]) {
  const a = vehicleArena(type), before = a.v.hp, radius = W.WEAPONS.rpg.explosion.radius;
  const x = a.v.x - a.v.r - radius * portion, max = type === 'tank' ? 1000 : 500;
  a.w.rpgImpact({ id: 1, owner: a.p.id, team: a.p.team }, null, x, a.v.y);
  t.near(before - a.v.hp, portion > 1 ? 0 : 10 + (max - 10) * (1 - portion), .001, type + ': actual splash at ' + portion + ' radius uses hull-distance anti-vehicle falloff');
}
for (const portion of [.5, 1, 1.01]) {
  const a = arena(), x = a.target.x - a.target.r - W.WEAPONS.rpg.explosion.radius * portion;
  a.w.rpgImpact({ id: 1, owner: a.p.id, team: a.p.team }, null, x, a.target.y);
  t.near(10000 - a.target.hp, portion > 1 ? 0 : 10 + 190 * (1 - portion), .001, 'actual infantry splash at ' + portion + ' radius uses ten-to-two-hundred falloff');
}
{
  const a = vehicleArena('humvee'); a.v.hp = 100; const riderHp = a.target.hp;
  impact(a, a.v);
  t.check(a.v.wreck && !a.target.vehicle, 'lethal RPG hull hit ejects the occupant');
  t.equal(a.target.hp, riderHp, 'a hull breaking during the blast does not expose its occupant to duplicate splash');
}
for (const blocker of ['rock', 'portable', 'wall', 'crate']) {
  const extra = blocker === 'rock' ? { rocks: [{ id: 1, x: X + 200, y: Y, r: 50, alive: true }] }
    : blocker === 'wall' ? { buildings: [{ walls: [{ x: X + 200, y: Y - 80, w: 15, h: 160 }] }] }
    : blocker === 'crate' ? { crates: [{ id: 1, x: X + 200, y: Y, size: 40, tier: 'common', hp: 100, maxHp: 100, alive: true, shake: 0 }] } : {};
  const a = arena(extra);
  if (blocker === 'portable') a.w.addStruct({ kind: 'rock', item: 'rock', x: X + 200, y: Y, r: 50, team: 2 });
  a.w.trigger(a.p, { firePressed: true }); fly(a, .5);
  t.equal(a.target.hp, 10000, blocker + ': first contact stops a rocket before the player behind it');
  t.equal(a.w.events.filter(e => e.type === 'rpg-impact').length, 1, blocker + ': contact detonates immediately without a fuse');
  if (blocker === 'rock') t.check(a.w.map.rocks[0].alive, 'RPG does not change natural rock destruction rules');
  if (blocker === 'portable') t.equal(a.w.structures[0].hp, 1000, 'RPG preserves existing portable rock explosive protection');
  if (blocker === 'crate') t.check(!a.w.map.crates[0].alive, 'direct RPG blast can destroy a crate');
}
{
  const a = arena({ buildings: [{ walls: [{ x: X + 35, y: Y - 50, w: 10, h: 100 }] }] });
  a.w.trigger(a.p, { firePressed: true });
  t.equal(a.w.rpgRockets.length, 0, 'muzzle overlapping a nearby wall cannot spawn through it');
  t.equal(a.w.events.filter(e => e.type === 'rpg-impact').length, 1, 'muzzle obstruction explodes immediately');
  t.check(!a.p.alive, 'normal explosive self-damage makes point-blank cover dangerous for Rocketeer');
}
{
  const a = arena(); a.target.x = X + 80; a.target.team = 1; a.p.hp = a.p.maxHp = 1000;
  a.w.rpgImpact({ id: 1, owner: a.p.id, team: 1 }, null, X + 40, Y);
  t.check(a.p.hp < 1000, 'RPG splash damages its owner');
  t.equal(a.target.hp, 10000, 'RPG splash preserves teammate immunity');
}
for (const shield of ['riot', 'explosive', 'legacy', 'rear', 'reload']) {
  const a = arena(); a.w.setClass(a.target, 'shieldoperator', true); a.target.hp = a.target.maxHp = 1000; a.target.angle = Math.PI;
  if (shield === 'explosive' || shield === 'rear') a.target.slot = 1;
  if (shield === 'legacy') { a.target.items[0] = { id: 'riotshield', n: 1 }; a.target.held = 0; }
  if (shield === 'rear') a.target.angle = 0;
  if (shield === 'reload') a.target.weapons[0].reloading = true;
  impact(a);
  t.equal(a.target.hp, shield === 'explosive' || shield === 'legacy' ? 1000 : 800, shield + ': RPG follows explosion shield directional rules');
}
{
  const a = arena();
  const turret = a.w.addStruct({ kind: 'turret', item: 'turret', x: a.target.x, y: a.target.y, r: W.STRUCT_RADIUS.turret, team: 2, hp: 100, maxHp: 100 });
  t.check(a.w.mountTurret(a.target, turret), 'mounted rider fixture boards its turret');
  a.w.trigger(a.p, { firePressed: true }); fly(a, .5);
  t.equal(a.target.hp, 9800, 'RPG hits a mounted turret rider exactly once');
  t.equal(turret.hp, 100, 'mounted turret does not take duplicate blast damage');
}
{
  const a = arena({}, true); a.w.trigger(a.p, { firePressed: true });
  t.equal(a.p.stats.shots, 0, 'remote mirror cannot fire authoritative rockets');
  const g = a.w.spawnRpgRocket({ id: 88, owner: a.p.id, team: 1, x: X, y: Y, dx: 1, dy: 0, age: .4, traveled: 80 });
  t.check(g.age === .4 && g.traveled === 80 && a.w.spawnRpgRocket({ ...g }) === g, 'network spawn restores flight state and deduplicates rocket IDs');
  fly(a, .5);
  t.equal(a.target.hp, 10000, 'remote projectile collision cannot deal damage');
  t.equal(a.w.events.filter(e => e.type === 'rpg-impact').length, 0, 'remote collision does not invent impact feedback');
  a.w.rpgImpact({ id: 1, owner: a.p.id, team: 1 }, { player: a.target }, a.target.x, a.target.y);
  t.equal(a.target.hp, 10000, 'remote direct impact method cannot deal damage');
  a.w.rpgImpactFx(a.target.x, a.target.y);
  t.check(a.w.explosions.length > 0 && a.w.particles.length > 0, 'authoritative impact event can invoke cosmetic-only blast effects');
}
t.done();
