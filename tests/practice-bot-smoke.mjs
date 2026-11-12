// Passive targets are restricted to offline Practice and keep real hit feedback.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'render']), t = suite('Practice target');
const template = { seed: 57, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
  pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], tanks: [], nextPickupId: 1 };
function arena(options = {}) {
  const world = new W.World({ map: { ...template }, practice: true, storm: false, ...options });
  const p = world.addPlayer({ x: 5000, y: 5000, isLocal: true, team: 1 });
  return { world, p };
}
function run(world, seconds) { for (let i = 0; i < seconds * 20; i++) world.update(.05); }
for (const opts of [{ practice: false }, { remote: true }, { demo: true }]) {
  const { world, p } = arena(opts), before = world.players.length;
  t.check(!world.spawnPracticeBot(p) && world.players.length === before, JSON.stringify(opts) + ' cannot create a Practice target');
}
{
  const { world, p } = arena({ practice: false });
  p.practiceBot = true;
  world.damagePlayer(p, p.hp + 1, null, 'ar');
  t.check(!p.alive, 'a forged Practice marker never grants protection outside Practice');
}
for (const state of ['dead', 'downed']) {
  const { world, p } = arena();
  if (state === 'dead') p.alive = false; else p.downed = true;
  t.check(!world.spawnPracticeBot(p), state + ' player cannot spawn a target');
}
{
  const { world, p } = arena();
  world.solids.insert({ type: 'wall', shape: 'rect', x: 3000, y: 3000, w: 4000, h: 4000 }, 3000, 3000, 7000, 7000);
  t.check(!world.spawnPracticeBot(p) && world.players.length === 1, 'no room leaves the world unchanged rather than spawning inside cover');
}
{
  const { world, p } = arena(), target = world.spawnPracticeBot(p);
  t.check(target && target.practiceBot && target.alive && target.team !== p.team, 'spawn returns a live target on an opposing team');
  t.check(Number.isFinite(target.hp) && Number.isFinite(target.maxHp) && target.hp > 0, 'infinite health keeps finite safe simulation values internally');
  t.check(Math.hypot(target.x - p.x, target.y - p.y) > p.r + target.r && Math.hypot(target.x - p.x, target.y - p.y) <= 600, 'target spawns nearby without overlapping the player');
  const next = world.spawnPracticeBot(p);
  t.check(next && next.id !== target.id && Math.hypot(next.x - target.x, next.y - target.y) >= next.r + target.r, 'successive clicks add distinct targets on unoccupied ground');
  const start = { x: target.x, y: target.y, hp: p.hp };
  run(world, 12);
  t.check(target.x === start.x && target.y === start.y && p.hp === start.hp && target.stats.shots === 0, 'idle target stays passive and causes no attacks over twelve seconds');
  target.controller = () => ({ mx: 1, my: 1, fire: true, aimX: p.x, aimY: p.y });
  run(world, 1);
  t.check(target.x === start.x && target.y === start.y && target.stats.shots === 0 && p.hp === start.hp, 'Practice target ignores accidental combat or movement controllers');
  target.controller = null;
  world.downPlayer(target, p, 'test'); world.killPlayer(target, p, 'test');
  t.check(target.alive && !target.downed && target.hp === target.maxHp, 'direct knockout and death paths cannot remove a Practice target');
  let pickupId = 800;
  for (const type of ['token', 'key', 'armor', 'item']) {
    const pk = world.spawnPickupAt({ id: pickupId++, type, item: type === 'item' ? 'grenade' : null, x: target.x, y: target.y, amount: 1 });
    t.check(!world.collect(target, pk) && pk.alive, 'Practice targets leave ' + type + ' pickups available to the player');
  }
  for (const cause of ['ar', 'shotgun2', 'sniper2', 'hammer', 'grenade', 'launcher2', 'flamethrower', 'sentry', 'storm', 'snow', 'poison', 'lightning', 'meteor', 'airstrike', 'tankmg', 'tank-cannon', 'ram']) {
    const before = target.hp, events = world.events.length, damage = p.stats.damage;
    world.damagePlayer(target, 1000000, p.id, cause, target.x, target.y);
    t.check(target.alive && !target.downed && target.hp === before, cause + ' cannot deplete target health');
    t.check(world.events.slice(events).some(e => e.type === 'damage' && e.target === target), cause + ' still produces ordinary hit feedback');
    t.check(p.stats.damage > damage, cause + ' still records damage for practice');
  }
  t.check(!world.events.some(e => e.type === 'death' && e.victim === target), 'damage never emits a target death or loot drop');
  const other = world.addPlayer({ x: 6000, y: 6000, team: 8 });
  world.damagePlayer(other, other.maxHp + 1, p.id, 'ar');
  t.check(!other.alive, 'ordinary players remain killable in Practice');
  const before = target.hp;
  const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy);
  p.angle = Math.atan2(dy, dx); p.controller = () => ({ fire: true, aimX: target.x, aimY: target.y });
  const hits = p.stats.hits; run(world, 3); p.controller = null;
  t.check(target.alive && target.hp === before && p.stats.hits > hits, 'actual held gunfire hits repeatedly without killing the target');
  const calls = [], ctx = new Proxy({ measureText: () => ({ width: 80 }) }, { get(o, k) {
    if (k in o) return o[k];
    return (...args) => { for (const n of args) if (typeof n === 'number' && !Number.isFinite(n)) throw Error(k + ' uses nonfinite drawing coordinate'); calls.push([k, ...args]); };
  } });
  const renderer = Object.create(W.Renderer.prototype);
  renderer.drawPlayer(ctx, target, world.time, { viewer: p, names: false });
  t.check(calls.some(c => c[0] === 'fillText' && String(c[1]).includes('∞')), 'target renders its infinity indicator even when player names are hidden');
}
t.done();
