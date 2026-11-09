// Regression: special throwables must never abort a frame while their fuse runs.
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'render']);
const t = suite('Throwable rendering');
const view = { x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 };
const ctx = new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      for (const value of args) if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(key + ' received a non-finite drawing coordinate');
      }
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
t.done();
