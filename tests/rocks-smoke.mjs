// Natural rocks are binary tank-breakable cover; placed rocks retain their separate HP rules.
import { loadWarz, suite } from './harness.mjs';
import { BotDirector } from '../server/core/bots/index.mjs';

const W = loadWarz(), t = suite('rocks');
function arena(extra = {}, remote = false) {
  const map = W.MapGen.generate(19);
  map.biomes = []; map.cacti = [];
  Object.assign(map, { rocks: [{ x: 9200, y: 9000, r: 60 }], buildings: [], trees: [], bushes: [], crates: [], pickups: [], ponds: [], stations: [], vehicles: [], tanks: [] }, extra);
  const world = new W.World({ map, storm: false, remote });
  const p = world.addPlayer({ x: 8800, y: 9000 });
  p.fx.strength = p.fx.power = 30;
  return { world, p, rock: map.rocks[0] };
}
const noHealth = rock => !('hp' in rock) && !('maxHp' in rock);

for (const cause of ['tankram', 'tank-cannon', 'artillery']) {
  const { world, p, rock } = arena();
  t.check(noHealth(rock) && rock.alive, cause + ': natural rock begins intact without health');
  t.check(world.damageMapRock(rock, cause, p.id), cause + ': heavy-vehicle hit immediately breaks the rock');
  t.check(!rock.alive && noHealth(rock), cause + ': broken rock still has no health fields');
  t.equal(world.events.filter(e => e.type === 'rock-gone').length, 1, cause + ': breaking emits one removal event');
  t.check(!world.events.some(e => e.type === 'rock-hp') && world.texts.length === 0, cause + ': no health event or damage number is created');
  t.equal(world.damageMapRock(rock, cause, p.id), false, cause + ': the same rock cannot break twice');
  t.equal(world.events.filter(e => e.type === 'rock-gone').length, 1, cause + ': repeated contact emits no duplicate removal');
}
{
  const { world, p, rock } = arena({ rocks: [{ x: 9200, y: 9000, r: 60, hp: 265, maxHp: 1000 }] });
  t.check(noHealth(rock) && rock.alive, 'legacy natural-rock HP is removed during world construction');
  world.buildSolids();
  t.check(noHealth(rock), 'rebuilding collisions does not recreate natural-rock HP');
  for (const cause of ['grenade', 'launcher', 'launcher2', 'lightning', 'meteor', 'airstrike', 'ar', 'smg', 'sniper', 'pistol', 'shotgun', 'tankmg', 'turret', 'sentry', 'fire', 'poison', 'snow', 'storm', 'ram', 'unknown']) {
    t.equal(world.damageMapRock(rock, cause, p.id), false, cause + ': cannot damage or break a natural rock');
    t.equal(world.damageMapRocksInArea(rock.x, rock.y, 500, cause, p.id, true), 0, cause + ': area damage cannot break natural rocks');
  }
  t.check(rock.alive && noHealth(rock) && world.events.length === 0, 'unsupported hits leave only the original intact state');
}
for (const cause of ['grenade', 'launcher', 'launcher2']) {
  const { world, p, rock } = arena();
  world.explode(rock.x, rock.y, W.WEAPONS[cause].explosion, p.id, cause);
  t.check(rock.alive && noHealth(rock), cause + ': actual explosion leaves natural cover intact');
}
for (const kind of ['lightning', 'meteor', 'airstrike']) {
  const { world, p, rock } = arena();
  world.addStrike({ kind, x: rock.x, y: rock.y, target: 0, t: 0, radius: 300, damage: 9999, owner: p.id, team: p.team });
  world.updateStrikes(0.05);
  t.check(rock.alive && noHealth(rock), kind + ': actual overhead strike cannot break natural cover');
}
{
  const { world, p, rock } = arena();
  t.equal(world.targetItem(p, W.ITEMS.lightning, { aimX: rock.x, aimY: rock.y }), false, 'lightning cannot lock onto an invulnerable natural rock');
  const bullet = { owner: p.id, team: p.team, weapon: 'ar', damage: 9999, x: 9000, y: 9000, ox: 9000, oy: 9000, dx: 1, dy: 0, speed: 1000, traveled: 0, range: 600, r: 5 };
  t.check(!world.advanceBullet(bullet, 400) && rock.alive && noHealth(rock), 'ordinary bullets stop at natural cover without health mutation');
  const portable = world.addStruct({ kind: 'rock', item: 'rock', x: 9500, y: 9500, r: 116, owner: p.id, team: p.team });
  t.equal(world.damageMapRock(portable, 'tank-cannon', p.id), false, 'natural-rock API cannot break a player-placed rock');
}
{
  const { world, p, rock } = arena({ rocks: [{ x: 9100, y: 9000, r: 40 }, { x: 9200, y: 9000, r: 40 }] });
  world.damageMapRocksInArea(9000, 9000, 300, 'tank-cannon', p.id, false);
  t.check(!rock.alive && world.map.rocks[1].alive, 'one cannon blast cannot propagate through a rock it just broke');
  t.check(world.map.rocks.every(noHealth), 'cannon area contact never creates rock health');
}
{
  const { world, p, rock } = arena();
  const dir = new BotDirector({ W, world, seed: 19, teamSize: 1 });
  t.equal(dir.nav.freeAt(rock.x, rock.y), false, 'navigation initially caches natural cover as blocked');
  t.equal(world.lineClear(9000, 9000, 9400, 9000), false, 'intact natural rock blocks sight');
  t.check(!!world.sweep(9000, 9000, 9400, 9000, 5, p.id, p.team), 'intact natural rock blocks bullets');
  world.damageMapRock(rock, 'tankram', p.id);
  dir.observe(world.events);
  t.equal(dir.nav.freeAt(rock.x, rock.y), true, 'tank break event invalidates navigation');
  t.equal(world.lineClear(9000, 9000, 9400, 9000), true, 'broken natural rock no longer blocks sight');
  t.equal(world.sweep(9000, 9000, 9400, 9000, 5, p.id, p.team), null, 'broken natural rock no longer blocks bullets');
  p.x = rock.x; p.y = rock.y; world.collide(p);
  t.check(p.x === rock.x && p.y === rock.y, 'broken rock leaves no invisible movement collider');
}
{
  const { world, p, rock } = arena({}, true);
  t.equal(world.damageMapRock(rock, 'tank-cannon', p.id), false, 'remote mirror cannot break natural rocks');
  t.equal(world.damageMapRocksInArea(rock.x, rock.y, 500, 'tank-cannon', p.id, true), 0, 'remote area prediction cannot remove rocks');
  t.check(noHealth(rock) && rock.alive && world.events.length === 0, 'remote collision and effects wait for server state');
}
for (const relation of ['own', 'friendly', 'enemy']) {
  const { world, p } = arena({ rocks: [] });
  const owner = relation === 'own' ? p : world.addPlayer({ x: 9700, y: 9000, team: relation === 'friendly' ? p.team : p.team + 1 });
  const boulder = world.addStruct({ kind: 'rock', item: 'rock', x: 9200, y: 9000, r: 116, owner: owner.id, team: owner.team });
  t.check(boulder.hp === 1000 && boulder.maxHp === 1000, relation + ': placed rock starts with 1000 HP');
  world.events = [];
  for (let hit = 1; hit <= 9; hit++) {
    t.check(world.damagePlayerRock(boulder, p.id), relation + ': tank impact ' + hit + ' is accepted');
    t.check(boulder.alive && boulder.hp === 1000 - hit * 100, relation + ': each tank impact removes exactly 100 HP despite source buffs');
  }
  t.check(world.lineClear(9000, 9000, 9400, 9000) === false, relation + ': a 100 HP placed rock still blocks sight');
  t.equal(world.events.filter(e => e.type === 'struct' && e.op === 'hp' && e.amount === 100 && e.source === p).length, 9, relation + ': partial impacts use normal structure health events');
  t.check(world.damagePlayerRock(boulder, p.id) && !boulder.alive && boulder.hp === 0, relation + ': tenth impact removes the rock at zero HP');
  t.check(!world.structures.includes(boulder) && world.lineClear(9000, 9000, 9400, 9000), relation + ': removed player rock releases its collision body');
  t.equal(world.damagePlayerRock(boulder, p.id), false, relation + ': later impacts cannot damage a removed rock');
  t.equal(world.events.filter(e => e.type === 'struct' && e.op === 'gone').length, 1, relation + ': destruction emits exactly one structure removal');
}
{
  const { world, p } = arena({ rocks: [] });
  const enemy = world.addPlayer({ x: 9600, y: 9000 });
  const boulder = world.addStruct({ kind: 'rock', item: 'rock', x: 9200, y: 9000, r: 116, owner: enemy.id, team: enemy.team });
  for (const cause of ['ar', 'turret', 'tankmg', 'grenade', 'launcher', 'launcher2', 'tank-cannon', 'lightning', 'meteor', 'airstrike', 'fire', 'tankram']) {
    world.damageStruct(boulder, 10000, p.id, boulder.x, boulder.y, cause);
    t.check(boulder.alive && boulder.hp === 1000, cause + ': generic structure damage cannot bypass portable-rock immunity');
  }
  for (const cause of ['grenade', 'launcher', 'launcher2']) {
    world.explode(boulder.x, boulder.y, W.WEAPONS[cause].explosion, p.id, cause);
    t.equal(boulder.hp, 1000, cause + ': actual enemy blast leaves placed-rock HP unchanged');
  }
  for (const kind of ['meteor', 'airstrike']) {
    world.addStrike({ kind, x: boulder.x, y: boulder.y, t: 0, radius: 300, damage: 9999, owner: p.id, team: p.team });
    world.updateStrikes(0.05);
    t.check(boulder.alive && boulder.hp === 1000, kind + ': actual overhead strike preserves portable cover');
  }
  const bullet = { owner: p.id, team: p.team, weapon: 'ar', damage: 9999, x: 9000, y: 9000, ox: 9000, oy: 9000, dx: 1, dy: 0, speed: 1000, traveled: 0, range: 600, r: 5 };
  t.check(!world.advanceBullet(bullet, 400) && boulder.hp === 1000, 'a real bullet stops at the portable rock without damaging it');
  const partial = world.addStruct({ kind: 'rock', item: 'rock', id: 100, x: 9500, y: 9500, r: 116, hp: 200, maxHp: 1000 });
  t.check(partial.hp === 200 && partial.maxHp === 1000, 'loading a partially damaged player rock preserves its HP');
  t.equal(world.damagePlayerRock(world.addStruct({ kind: 'turret', item: 'turret', x: 9800, y: 9500, r: 38, hp: 100, maxHp: 100 }), p.id), false, 'portable-rock impact API rejects other structure kinds');
}
{
  const { world, p } = arena({ rocks: [] }, true);
  const boulder = world.addStruct({ kind: 'rock', item: 'rock', x: 9200, y: 9000, r: 116, hp: 900, maxHp: 1000, owner: p.id, team: p.team });
  world.events = [];
  t.equal(world.damagePlayerRock(boulder, p.id), false, 'remote mirror cannot authoritatively damage player rocks');
  t.check(boulder.hp === 900 && boulder.alive && world.events.length === 0, 'predicted player-rock contact leaves HP and events for the server');
}
t.done();
