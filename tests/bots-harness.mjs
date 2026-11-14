// Small worlds for bot tests: an empty island (or a real one), a director, and helpers to drop bots and
// scripted players into it and step the simulation exactly the way a match does.
import { Warz as W } from '../server/core/sim.mjs';
import { BotDirector } from '../server/core/bots/index.mjs';

export { W };
export const TICK = 1 / 20;

// A real island with everything on it removed, so each test adds only what it is about.
export function emptyMap(seed = 5, extra = {}) {
  const map = W.MapGen.generate(seed);
  map.biomes = []; map.cacti = [];
  map.rocks = []; map.trees = []; map.bushes = []; map.buildings = []; map.crates = []; map.pickups = []; map.ponds = []; map.stations = []; map.vehicles = []; map.tanks = [];
  return Object.assign(map, extra);
}

export function arena(opts = {}) {
  const map = opts.map || emptyMap(opts.seed || 5, opts.extra);
  const world = new W.World({ map, teams: !!opts.teams, storm: opts.storm ? undefined : false });
  const dir = new BotDirector({ W, world, seed: opts.seed || 5, teamSize: opts.teams ? (opts.teamSize || 2) : 1, log: opts.log || console });
  const seen = [];          // every event since the last clear()
  const a = {
    W, world, dir, map, events: seen,
    clear() { seen.length = 0; },
    count(type, pred) { let n = 0; for (const e of seen) if (e.type === type && (!pred || pred(e))) n++; return n; },
    used(item, by) { return a.count('item-used', (e) => e.item === item && (!by || e.player === by)); },
    tick() {
      dir.beforeTick(TICK);
      world.update(TICK);
      const ev = world.events;
      world.events = [];
      dir.observe(ev);
      for (const e of ev) seen.push(e);
      if (seen.length > 20000) seen.splice(0, seen.length - 20000);
    },
    step(seconds) { for (let i = 0, n = Math.round(seconds / TICK); i < n; i++) a.tick(); },
    // Run until pred() is true; returns the seconds it took, or -1 after `max` seconds.
    until(pred, max = 20) {
      const t0 = world.time;
      while (world.time - t0 < max) { a.tick(); if (pred()) return world.time - t0; }
      return -1;
    },
    // A bot that has "already landed". `profile` pins skill / aggression / caution.
    bot(x, y, profile = {}, o = {}) {
      const p = world.addPlayer({ name: o.name || 'bot' + (world.players.length + 1), x, y, team: o.team, classId: o.classId, angle: o.angle || 0 });
      const b = dir.add(p, Object.assign({ skill: 0.6, aggression: 0.6, caution: 0.5 }, profile));
      b.landAt = -100; b.landed = true;
      if (o.items) for (const [id, n] of o.items) world.addItem(p, id, n);
      if (o.tokens) p.tokens = o.tokens;
      if (o.hp !== undefined) p.hp = o.hp;
      if (o.plan) b.plan = o.plan;
      return b;
    },
    // A scripted player (a "human" as far as bots can tell). `brain(p, world)` returns an intent; default: stand still.
    human(x, y, brain, o = {}) {
      const p = world.addPlayer({ name: o.name || 'human' + (world.players.length + 1), x, y, team: o.team, classId: o.classId, angle: o.angle || 0 });
      p.controller = brain ? (pl, w, dt) => brain(pl, w, dt) : () => null;
      if (o.hp !== undefined) { p.hp = o.hp; if (o.hp > p.maxHp) p.maxHp = o.hp; }
      if (o.items) for (const [id, n] of o.items) world.addItem(p, id, n);
      return p;
    },
    // Pin a bot's feet (for tests about what it sees or how it aims from one spot).
    plant(bot) { const think = bot.think.bind(bot); bot.think = (dt) => { const o = think(dt); o.mx = 0; o.my = 0; return o; }; return bot; },
    // Bystanders in a far corner of the island, so head counts say "middle of a match" rather than "last two standing".
    crowd(n = 24) {
      for (let i = 0; i < n; i++) a.human(3200 + (i % 8) * 90, 3200 + Math.floor(i / 8) * 90, null, { name: 'far' + i, team: 1000 + i });
      dir.beforeTick(TICK);
    }
  };
  return a;
}

// Intent helpers for scripted players.
export const shootAt = (target) => (p) => ({ mx: 0, my: 0, aimX: target.x, aimY: target.y, fire: true, firePressed: false });
export const chase = (target, keep = 250) => (p) => {
  const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1, k = d > keep ? 1 : 0;
  return { mx: dx / d * k, my: dy / d * k, aimX: target.x, aimY: target.y, fire: true, firePressed: false };
};
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
