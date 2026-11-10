// Regression: replicated projectiles and strike animations must never abort a frame.
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'render']);
const t = suite('Effect rendering');
const view = { x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 };
const ctx = new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      for (const value of args) if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(key + ' received a non-finite drawing coordinate');
      }
      if (key === 'createRadialGradient') return { addColorStop() {} };
    };
  }
});
const renderer = Object.create(W.Renderer.prototype);
const ids = [null, ...Object.keys(W.ITEMS).filter(id => W.ITEMS[id].kind === 'throw')];

for (const remote of [false, true]) {
  for (const id of ids) {
    const world = new W.World({ map: W.MapGen.generate(57), remote, storm: false });
    const p = world.addPlayer({ x: 3000, y: 3000, team: 1 });
    const item = id && W.ITEMS[id];
    // Online throw events contain the simulated fuse (1 for a landing-triggered item).
    const fuse = item ? (remote && item.fuse === 0 ? 1 : item.fuse) : W.WEAPONS.grenade.fuse;
    const g = world.spawnGrenade(p, { x: p.x, y: p.y, vx: 600, vy: 0, fuse, item: id });
    let frames = 0, error = null;
    try {
      while (world.grenades.length && frames < 240) {
        renderer.drawGrenades(ctx, world, view, frames / 60);
        world.updateGrenades(1 / 60);
        frames++;
      }
    } catch (e) { error = e.message; }
    const label = (remote ? 'online' : 'practice') + ' ' + (id || 'class grenade');
    t.check(!error, label + ' renders through launch and landing' + (error ? ': ' + error : ''));
    t.check(frames > 1 && world.grenades.length === 0, label + ' completes its flight');
    if (item && item.fuse === 0) t.equal(g.instant, true, label + ' bursts on landing in both modes');
  }
}
for (const remote of [false, true]) {
  const world = new W.World({ map: W.MapGen.generate(57), remote, storm: false });
  const st = world.addStrike({ kind: 'airstrike', x: 3000, y: 3000, t: 5, radius: 225, damage: 250, owner: 0, team: 1 });
  let planes = 0, bombs = 0, impacts = 0;
  const animated = Object.create(W.Renderer.prototype);
  animated.drawStrikeAircraft = function (...args) { planes++; W.Renderer.prototype.drawStrikeAircraft.apply(this, args); };
  animated.drawStrikeBomb = function (...args) { bombs++; W.Renderer.prototype.drawStrikeBomb.apply(this, args); };
  animated.drawAirstrikeImpact = function (...args) { impacts++; W.Renderer.prototype.drawAirstrikeImpact.apply(this, args); };
  const label = remote ? 'online' : 'practice';
  for (const left of [5, 3, 2.8, 2, 1.1, 0.5, 0, -0.2]) {
    st.t = left;
    const before = JSON.stringify(st), oldPlanes = planes, oldBombs = bombs;
    animated.drawStrikes(ctx, world, view, 5 - left);
    t.equal(JSON.stringify(st), before, label + ' airstrike rendering does not change timing, damage or position at ' + left + 's');
    t.equal(planes - oldPlanes, left <= 2.8 ? 1 : 0, label + ' aircraft arrives during the warning');
    t.equal(bombs - oldBombs, left <= 1.1 ? 1 : 0, label + ' bomb descends only after aircraft release');
  }
  t.equal(world.explosions.length, 0, label + ' rendering never predicts an impact or applies damage');
  world.resolveStrike(st.id, st.x, st.y);
  t.check(world.explosions.some(e => e.kind === 'airstrike'), label + ' resolved strike identifies its existing authoritative explosion');
  for (const age of [0, 0.1, 0.3, 0.6, 0.79]) {
    world.explosions.forEach(e => { e.t = age; });
    animated.drawExplosions(ctx, world);
  }
  t.equal(impacts, 5, label + ' authoritative impact renders the fire and smoke animation through its lifetime');
  t.equal(world.strikes.length, 0, label + ' impact removes the pending aircraft and bomb');
}

{
  const nearbyAircraft = Object.create(W.Renderer.prototype);
  let planes = 0;
  nearbyAircraft.drawStrikeAircraft = () => { planes++; };
  nearbyAircraft.drawStrikes(ctx, { strikes: [{ kind: 'airstrike', x: 0, y: 0, t: 2, dur: 5, radius: 225 }] },
    { x0: -1100, x1: -650, y0: -550, y1: -200 }, 3);
  t.equal(planes, 1, 'an aircraft crossing the view is drawn even when its ground target is offscreen');
}

t.done();
