// Neutral settlement defenses use the same damage, interaction and loot paths as play.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(), t = suite('Settlement defenses');
function arena(seeds = [], extra = {}, remote = false) {
  const map = { seed: 29, size: W.CONFIG.worldSize, teamSize: 2, rocks: [], trees: [], bushes: [], cacti: [], buildings: [], crates: [],
    pickups: [], ponds: [], stations: [], drops: [], towns: [], vehicles: [], tanks: [], artillery: [], groundArtillery: [],
    settlementStructures: seeds, settlementVehicles: [], nextPickupId: 1, ...extra };
  return new W.World({ map, teams: true, storm: false, remote });
}
const seed = (item, x = 5000, y = 5000) => ({ item, kind: W.ITEMS[item].struct, x, y, angle: 0, settlement: 0, neutral: true });
for (const item of ['sentry', 'sentry2', 'sentry3', 'turret', 'turret3']) {
  const world = arena([seed(item)]), s = world.structures[0], def = W.ITEMS[item];
  t.check(s.id === 1 && s.neutral && s.seeded && s.team === null && s.owner === 0 && s.settlement === 0, item + ': neutral seeded identity is deterministic');
  t.check(s.hp === def.hp && s.maxHp === def.hp, item + ': guard keeps normal equipment HP');
  t.check(world.events.length === 0 && world.particles.length === 0, item + ': static defenses do not emit placement effects on load');
  const placed = world.addStruct({ kind: 'turret', item: 'turret', x: 5500, y: 5000, r: W.STRUCT_RADIUS.turret, hp: 100, maxHp: 100 });
  t.equal(placed.id, 2, item + ': later player structures cannot collide with seed IDs');
}
for (const item of ['sentry', 'sentry2', 'sentry3']) for (const team of [0, 1, 2]) {
  const world = arena([seed(item)]), s = world.structures[0];
  const p = world.addPlayer({ x: 5300, y: 5000, team });
  world.updateSentry(s, .05);
  t.equal(p.maxHp - p.hp, W.ITEMS[item].damage, item + ': attacks team ' + team + ' using its normal damage');
  t.equal(s.cooldown, W.ITEMS[item].fireInterval, item + ': keeps its normal fire interval');
  p.x = s.x + W.ITEMS[item].range + 30; s.cooldown = 0;
  const hp = p.hp; world.updateSentry(s, .05);
  t.equal(p.hp, hp, item + ': cannot hit team ' + team + ' outside its range');
}
{
  const crate = { id: 0, x: 5250, y: 5000, size: 52, tier: 'common', hp: 100, maxHp: 100, alive: true };
  const world = arena([seed('sentry')], { crates: [crate] });
  for (let i = 0; i < 100; i++) world.updateSentry(world.structures[0], .05);
  t.equal(crate.hp, 100, 'neutral sentries do not destroy settlement loot while idle');
  t.check(!world.events.some(e => e.type === 'sentry-shot'), 'empty neutral defenses stay quiet');
}
for (const item of ['turret', 'turret3']) {
  const world = arena([seed(item)]), s = world.structures[0];
  const p = world.addPlayer({ x: 5070, y: 5000, team: 1 });
  const enemy = world.addPlayer({ x: 5400, y: 5000, team: 2 });
  for (let i = 0; i < 20; i++) world.updateItems(.05);
  t.equal(enemy.hp, enemy.maxHp, item + ': neutral turret never fires without a rider');
  t.equal(world.nearestMountable(p), s, item + ': any nearby team can see its mount prompt');
  t.check(world.mountTurret(p, s), item + ': team one can ride it');
  world.updateMounted(p, { fire: true, aimX: enemy.x, aimY: enemy.y }, .05);
  t.check(world.bullets.length > 0 && world.bullets[0].damage === W.ITEMS[item].damage && world.bullets[0].team === p.team,
    item + ': rider fires its normal tier weapon with rider allegiance');
  world.damageStruct(s, 10, p.id, s.x, s.y, 'ar');
  t.equal(s.hp, W.ITEMS[item].hp - 10, item + ': even the rider can damage the neutral hull');
  t.check(world.dismount(p), item + ': rider can dismount');
  enemy.x = 5070; enemy.y = 5000;
  t.check(world.mountTurret(enemy, s), item + ': another team can use the same abandoned turret');
  world.damageStruct(s, 10000, p.id, s.x, s.y, 'ar');
  t.check(!s.alive && enemy.mount === 0 && !world.structById(s.id), item + ': any team can destroy an occupied turret and eject its rider');
}
for (const item of ['sentry', 'sentry2', 'sentry3']) {
  const world = arena([seed(item), seed('turret', 5500, 5000)]), guard = world.structures[0], turret = world.structures[1];
  const rider = world.addPlayer({ x: 5580, y: 5000, team: 2 });
  world.mountTurret(rider, turret);
  world.updateSentry(guard, .05);
  t.equal(rider.maxHp - rider.hp, W.ITEMS[item].damage, item + ': a mounted turret cannot hide a rider from settlement guards');
  const wall = { type: 'wall', shape: 'rect', x: 5250, y: 4900, w: 18, h: 200 };
  world.solids.insert(wall, wall.x, wall.y, wall.x + wall.w, wall.y + wall.h);
  const hp = rider.hp; guard.cooldown = 0; world.updateSentry(guard, .05);
  t.equal(rider.hp, hp, item + ': actual walls still protect mounted players');
}
{
  const world = arena([seed('sentry2')], { settlementVehicles: [{ id: 23, type: 'humvee', x: 5400, y: 5000, armed: true, settlement: 0 }] });
  const p = world.addPlayer({ x: 5400, y: 5000, team: 2 }), v = world.vehicles[0];
  t.check(v.id === 23 && v.armed && v.settlement === 0, 'town Humvee is armed and retains its separate settlement identity');
  t.check(world.enterVehicle(p, v, 'driver'), 'town Humvee can be driven by an arriving player');
  world.updateSentry(world.structures[0], .05);
  t.equal(v.maxHp - v.hp, W.ITEMS.sentry2.damage, 'neutral sentries attack occupied vehicle hulls from every team');
}
{
  const world = arena();
  for (const [legendaryDrops, count] of [[1, 1], [undefined, 4]]) {
    world.map.pickups = [];
    world.crateLoot({ id: 0, tier: 'legendary', x: 5000, y: 5000, legendaryDrops }, null);
    const items = world.map.pickups.filter(p => p.type === 'item');
    t.equal(items.length, count, legendaryDrops === 1 ? 'town Legendary drops exactly one item' : 'center Legendary still drops all four items');
    t.check(items.every(p => W.ITEMS[p.item].tier === 'legendary'), 'guaranteed Legendary reward always comes from its proper tier');
  }
}
for (const weapon of ['bullet', 'grenade', 'meteor', 'tank', 'artillery', 'rpg', 'sentry-cannon', 'sentry-rocket', 'pyromaniac']) {
  const world = arena([seed('turret3')]), s = world.structures[0];
  const attacker = world.addPlayer({ x: 4800, y: 5000, team: 1 }), rider = world.addPlayer({ x: 5070, y: 5000, team: 2 });
  rider.hp = rider.maxHp = 10000;
  world.mountTurret(rider, s);
  const before = s.hp, hit = { solid: { type: 'struct', struct: s } }, shot = { id: 9, owner: attacker.id, team: attacker.team, dx: 1, dy: 0 };
  if (weapon === 'bullet') world.advanceBullet({ ...shot, weapon: 'ar', damage: 25, x: 4800, y: 5000, ox: 4800, oy: 5000, traveled: 0, range: 600, r: 5, speed: 1000 }, 300);
  if (weapon === 'grenade') world.explode(s.x, s.y, { radius: 200, maxDamage: 100 }, attacker.id, 'grenade');
  if (weapon === 'meteor') {
    world.addStrike({ kind: 'meteor', x: s.x, y: s.y, t: 0, owner: attacker.id, team: attacker.team, radius: 200, damage: 99 });
    world.updateStrikes(.05);
  }
  if (weapon === 'tank') world.tankShellImpact(shot, hit, s.x, s.y);
  if (weapon === 'artillery') world.artilleryImpact({ ...shot, targetX: s.x, targetY: s.y });
  if (weapon === 'rpg') world.rpgImpact(shot, hit, s.x, s.y);
  if (weapon === 'sentry-cannon') world.sentryProjectileImpact({ ...shot, kind: 'cannons' }, hit, s.x, s.y);
  if (weapon === 'sentry-rocket') world.sentryProjectileImpact({ ...shot, kind: 'rockets' }, hit, s.x, s.y);
  if (weapon === 'pyromaniac') { world.setClass(attacker, 'pyromaniac', true); attacker.angle = 0; world.firePyroFlame(attacker); }
  t.check(s.hp < before, weapon + ': an occupied neutral turret hull remains damageable');
}
t.done();
