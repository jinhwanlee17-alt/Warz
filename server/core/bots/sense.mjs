// What a bot is allowed to see. The rule is "whatever a player's screen would show": a rectangle around
// the bot (wider while scoped), minus everyone the renderer hides under a tree canopy, under a roof, inside
// smoke or behind an invisibility potion. Walls do not hide anyone on screen, so they do not here either;
// whether a bullet can get there is a separate question (see Bot.shotClear).
const HALF_W = 880, HALF_H = 492;   // a 16:9 screen shows 1800 x 1013 world units; things at the very edge go unnoticed
const SHOT_REVEAL = 0.5;            // seconds a muzzle flash keeps giving a hidden shooter away

export class Cover {
  constructor(W, world) {
    this.W = W;
    this.world = world;
    this.map = world.map;
    this.trees = new W.U.SpatialHash(256);
    for (const t of [...this.map.trees, ...(this.map.bushes || [])]) this.trees.insert(t, t.x - t.r, t.y - t.r, t.x + t.r, t.y + t.r);
    this.info = new Map();    // player id -> { trees, building, smoke }
    this.fired = new Map();   // player id -> world time of the last shot
  }

  canopiesAt(x, y, out) {
    out.length = 0;
    this.trees.query(x, y, x, y, (t) => { if (t.alive !== false && Math.hypot(t.x - x, t.y - y) < t.r * 0.92 - 20) out.push(t); });
    return out;
  }
  buildingAt(x, y) {
    const list = this.map.buildings;
    for (let i = 0; i < list.length; i++) { const b = list[i]; if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return i; }
    return -1;
  }
  smokeAt(x, y) {
    const zones = this.world.zones;
    for (let i = 0; i < zones.length; i++) { const z = zones[i]; if (z.kind === 'smoke' && Math.hypot(z.x - x, z.y - y) < z.r * 0.95) return z; }
    return null;
  }

  // Once per scan for everyone alive: what is above each player's head.
  refresh(players) {
    for (const p of players) {
      if (!p.alive) continue;
      let i = this.info.get(p.id);
      if (!i) { i = { trees: [], building: -1, smoke: null }; this.info.set(p.id, i); }
      this.canopiesAt(p.x, p.y, i.trees);
      i.building = this.buildingAt(p.x, p.y);
      i.smoke = this.world.zones.length ? this.smokeAt(p.x, p.y) : null;
    }
  }

  noteShot(id, time) { this.fired.set(id, time); }
  firedLately(id) { const t = this.fired.get(id); return t !== undefined && this.world.time - t < SHOT_REVEAL; }

  // Is `target` drawn on `viewer`'s screen (given that it is inside the view rectangle)?
  hidden(viewer, target) {
    const t = this.info.get(target.id), v = this.info.get(viewer.id);
    if (!t) return false;
    if (t.building >= 0) {
      // A roof only fades for players standing in that building (the renderer's 6-unit doorway margin).
      const b = this.map.buildings[t.building];
      if (!(viewer.x > b.x - 6 && viewer.x < b.x + b.w + 6 && viewer.y > b.y - 6 && viewer.y < b.y + b.h + 6)) return true;
    }
    for (let i = 0; i < t.trees.length; i++) {
      const tree = t.trees[i];
      if (Math.hypot(viewer.x - tree.x, viewer.y - tree.y) >= tree.r * 0.9) return true; // leaves only thin out for someone under the same tree
    }
    if (t.smoke) {
      if (!v || v.smoke !== t.smoke) return true;
      if (Math.hypot(viewer.x - target.x, viewer.y - target.y) > 260) return true; // inside the cloud you see a little
    }
    return false;
  }
  concealedSpot(p) { const i = this.info.get(p.id); return !!i && (i.trees.length > 0 || i.building >= 0 || !!i.smoke); }
}

export function viewHalf(W, p) {
  const def = p.weapons[p.slot] && W.WEAPONS[p.weapons[p.slot].id];
  const z = p.scoping && def && def.zoom ? def.zoom : 1;
  return { w: HALF_W * z, h: HALF_H * z };
}

// 'yes' | 'no'. `revealed` is the set of enemy ids a drone or radar is showing this viewer.
export function canSee(W, cover, viewer, target, half, revealed) {
  const dx = Math.abs(target.x - viewer.x), dy = Math.abs(target.y - viewer.y);
  if (dx > half.w || dy > half.h) return false;
  if (revealed && revealed.has(target.id)) return true;       // a ring marks them on screen, hidden or not
  if (cover.firedLately(target.id)) return true;               // muzzle flashes show through leaves, roofs and potions
  if (target.fx && target.fx.invisible > 0) return false;
  return !cover.hidden(viewer, target);
}

export const VIEW = { HALF_W, HALF_H };
