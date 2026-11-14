import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items']), t = suite('Biome combat');
function arena(ids = [], extra = {}, remote = false) {
  const map = { seed: 27, size: W.CONFIG.worldSize, rocks: [], trees: [], cacti: [], bushes: [], buildings: [], crates: [], pickups: [],
    ponds: [], stations: [], towns: [], drops: [], vehicles: [], tanks: [], artillery: [], groundArtillery: [], nextPickupId: 1,
    biomes: ids.map(id => ({ id, x: 1000, y: 1000, w: 2000, h: 2000 })), ...extra };
  const world = new W.World({ map, remote, storm: false });
  const p = world.addPlayer({ x: 2000, y: 2000, isLocal: true });
  p.hp = p.maxHp = 1000;
  return { world, p, map };
}
function tick(world, seconds) {
  for (let left = seconds; left > 1e-8; left -= .05) { const dt = Math.min(.05, left); world.time += dt; world.updateZones(dt); }
}
for (const [ids, fireDamage, fireDuration, snowDamage, slow, duration, frozen] of [
  [[], 1, 1, 1, .5, 20, false], [['forest'], 1, 1, 1, .5, 20, false],
  [['tundra'], .25, .5, 2, .625, 20, true], [['tundra', 'forest'], .25, .5, 2, .625, 20, true],
  [['desert'], 2, 2, .5, .25, 10, false], [['desert', 'grassland'], 2, 2, .5, .25, 10, false],
  [['forest', 'grassland'], 1, 1, 1, .5, 20, false]
]) {
  const label = ids.join('+') || 'normal', { world, p } = arena(ids);
  world.itemBurst('firenade', p.x, p.y, p.id);
  const fire = world.zones[0];
  t.equal(fire.dur, W.ITEMS.firenade.duration * fireDuration, label + ': Molotov lifetime follows climate');
  t.equal(fire.dps, W.ITEMS.firenade.dps * fireDamage, label + ': Molotov damage follows climate');
  world.updateZones(.05);
  t.near(1000 - p.hp, fire.dps * .25, .051, label + ': actual fire applies the modified damage (tenths-of-HP rounding)');
  world.zones = []; p.hp = 1000;
  world.itemBurst('snowbomb', p.x, p.y, p.id);
  t.equal(world.zones[0].dur, duration, label + ': snow lifetime follows climate');
  tick(world, 3.9);
  t.equal(p.hp, 1000, label + ': four-second cold-damage grace remains unchanged');
  t.near(world.speedMul(p), 1 - slow, 1e-8, label + ': movement uses climate slow');
  tick(world, .2);
  t.near(1000 - p.hp, 2 * snowDamage, 1e-8, label + ': first cold-damage tick uses climate multiplier');
  tick(world, .9);
  t.equal(p.snowFrozen, frozen, label + ': only tundra freezes at five continuous seconds');
  if (frozen) {
    const x = p.x, y = p.y;
    p.vx = 400; p.vy = 200; world.moveStep(p, { mx: 1, my: 1 }, .05);
    t.check(p.x === x && p.y === y && world.speedMul(p) === 0, label + ': freeze stops held movement and leftover velocity');
  }
  tick(world, duration);
  t.check(!p.inSnow && !p.snowFrozen && p.snowT === 0 && world.speedMul(p) === 1, label + ': expiration releases slow and freeze');
}
{
  const { world, p } = arena(['tundra']);
  world.storm = { dps: 30 };
  world.itemBurst('snowbomb', p.x, p.y, p.id);
  tick(world, 4.1);
  t.equal(1000 - p.hp, 4, 'tundra cold damage stays exactly four even during a late high-damage storm');
}
{
  const { world, p } = arena(['tundra']);
  world.itemBurst('snowbomb', p.x, p.y, p.id);
  tick(world, 4.8); p.x += 2000; tick(world, .05); p.x -= 2000; tick(world, .3);
  t.check(!p.snowFrozen && p.tundraSnowT < 1, 'leaving snow resets continuous freeze exposure');
}
{
  const tree = { id: 0, x: 2100, y: 2000, r: 80, hp: 100, maxHp: 250, hitRadius: 20 },
    bush = { x: 2200, y: 2000, r: 40, hp: 20, maxHp: 50, hitRadius: 15 },
    cactus = { id: 0, x: 2600, y: 2000, r: 23 };
  const { world, p, map } = arena([], { trees: [tree], bushes: [bush], cacti: [cactus] });
  t.check([tree, bush].every(plant => plant.hp === undefined && plant.maxHp === undefined && plant.hitRadius === undefined), 'leafy cover discards legacy health and trunk hitboxes');
  t.equal(cactus.hp, 50, 'cacti retain their separate health pool');
  function bullet(x, damage) { return { owner: p.id, team: p.team, weapon: 'ar', damage, x, y: 2000, ox: x, oy: 2000, dx: 1, dy: 0, speed: 1000, traveled: 0, range: 600, r: 5 }; }
  const enemy = world.addPlayer({ x: 2350, y: 2000, team: 2 });
  world.advanceBullet(bullet(2000, 30), 400);
  t.equal(enemy.hp, 70, 'actual bullets pass through tree and bush cover to hit the opponent');
  world.explode(tree.x, tree.y, { radius: 100, maxDamage: 200 }, p.id, 'grenade');
  t.check(tree.alive !== false && tree.hp === undefined && bush.hp === undefined, 'explosions do not damage leafy cover');
  t.equal(world.damageFoliage(tree, 250, p.id, 'ar'), false, 'direct damage cannot restore tree health or collision');
  world.advanceBullet(bullet(2500, 50), 150);
  t.check(!cactus.alive && map.foliageVersion === 1, 'gunfire still destroys a fifty-health cactus');
  t.equal(world.sweep(2500, 2000, 2700, 2000, 3, p.id, p.team), null, 'destroyed cacti cannot intercept later projectiles');
}
{
  const cactus = { id: 0, x: 2000, y: 2000, r: 23 }, { world, p } = arena([], { cacti: [cactus] });
  p.hp = 100;
  world.updateCactusContacts(); t.equal(p.hp, 92, 'touching a cactus deals eight damage');
  for (let i = 0; i < 10; i++) { world.time += .05; world.updateCactusContacts(); }
  t.equal(p.hp, 92, 'continued contact cannot deal damage every frame');
  world.time += .6; world.updateCactusContacts(); t.equal(p.hp, 84, 'remaining against a cactus deals another hit after one second');
  p.x += 200; world.updateCactusContacts(); p.x -= 200; world.updateCactusContacts();
  t.equal(p.hp, 76, 'leaving and touching a cactus again triggers a new contact');
  world.damageFoliage(cactus, 50, p.id, 'ar'); world.time += 2; world.updateCactusContacts();
  t.equal(p.hp, 76, 'destroyed cactus stops contact damage');
}
{
  const cactus = { id: 0, x: 2050, y: 2000, r: 23 }, { world, p } = arena([], { cacti: [cactus] });
  world.setClass(p, 'armorcrew', true); p.angle = 0;
  world.fireHammer(p, W.WEAPONS.hammer);
  t.equal(cactus.hp, 20, 'actual melee hammer still damages a cactus');
}
for (const weapon of ['tank', 'artillery', 'rpg', 'sentry-cannon', 'sentry-rocket', 'pyromaniac']) {
  const cactus = { id: 0, x: 2100, y: 2000, r: 23 }, { world, p } = arena([], { cacti: [cactus] });
  const hit = { solid: { type: 'foliage', plant: cactus } }, shot = { id: 9, owner: p.id, team: p.team, dx: 1, dy: 0 };
  if (weapon === 'tank') world.tankShellImpact(shot, hit, cactus.x, cactus.y);
  if (weapon === 'artillery') world.artilleryImpact({ ...shot, targetX: cactus.x, targetY: cactus.y });
  if (weapon === 'rpg') world.rpgImpact(shot, hit, cactus.x, cactus.y);
  if (weapon === 'sentry-cannon') world.sentryProjectileImpact({ ...shot, kind: 'cannons' }, hit, cactus.x, cactus.y);
  if (weapon === 'sentry-rocket') world.sentryProjectileImpact({ ...shot, kind: 'rockets' }, hit, cactus.x, cactus.y);
  if (weapon === 'pyromaniac') { world.setClass(p, 'pyromaniac', true); p.angle = 0; world.firePyroFlame(p); }
  t.check(cactus.hp < 50, weapon + ': specialized weapon path still damages cacti');
}
{
  const cactus = { id: 0, x: 2000, y: 2000, r: 23 }, { world, p } = arena(['tundra'], { cacti: [cactus] }, true);
  world.addZone({ kind: 'snow', x: p.x, y: p.y, r: 100, dur: 20, slow: .625, damageMul: 2, freezeAfter: 5 });
  const hp = p.hp; tick(world, 5.1);
  t.check(p.hp === hp && p.snowFrozen, 'mirror predicts freeze without authoring cold damage');
  t.equal(world.damageFoliage(cactus, 50, p.id, 'ar'), false, 'mirror cannot author foliage destruction');
}
t.done();
