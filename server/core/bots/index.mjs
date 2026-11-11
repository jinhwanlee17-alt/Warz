// Bots for a match. The director owns what bots share (the navigation grid, the "what hides whom" index,
// team callouts) and feeds each bot the world events a player would notice. A bot is an ordinary world player
// whose controller is its brain, so everything it does goes through the same rules as a human's input.
import { Nav } from './nav.mjs';
import { Cover } from './sense.mjs';
import { Bot } from './bot.mjs';
import './bot-combat.mjs';
import './bot-loot.mjs';
import './bot-items.mjs';
import { makeProfile, makeNames } from './profile.mjs';

const HEAR = 1500;            // gunfire carries about this far (the client fades it out at the same distance)
const SEARCHES_PER_TICK = 4;  // path searches all bots may run in one tick
const NEAR_MISS = 75;         // a bullet this close to a bot counts as "someone is shooting at me"
// Pacing. A lobby full of bots that all fight on sight is over in three minutes, long before the storm has done
// anything. So bots pick fights with *each other* more or less readily depending on whether the lobby is ahead of
// or behind this curve (share of the lobby still alive, by match time). How they treat a human never changes.
function makePace(phases) {
  const pace = [1, 0.97, 0.93, 0.88, 0.82].map((alive, i) => [phases[0].start * i / 5, alive]);
  const starts = [0.76, 0.54, 0.34, 0.19, 0.1, 0.04], ends = [0.66, 0.44, 0.26, 0.14, 0.06, 0.02];
  phases.forEach((phase, i) => pace.push([phase.start, starts[i]], [phase.end, ends[i]]));
  return pace;
}
function paceAt(t, pace) {
  for (let i = 1; i < pace.length; i++) {
    if (t <= pace[i][0]) { const a = pace[i - 1], b = pace[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); }
  }
  return pace[pace.length - 1][1];
}

export class BotDirector {
  constructor({ W, world, seed, teamSize = 1, log = console, level = 0.5 }) {
    this.W = W;
    this.world = world;
    this.pace = makePace(W.STORM);
    this.seed = seed >>> 0;
    this.teamSize = teamSize;
    this.log = log;
    const lv = Number(level);
    this.level = Number.isFinite(lv) ? Math.min(1, Math.max(0, lv)) : 0.5;   // how good this lobby's bots are (BOT_SKILL)
    this.nav = new Nav(W, world);
    this.cover = new Cover(W, world);
    this.rng = W.U.rng((this.seed ^ 0x51ed270b) >>> 0);
    // Crates under a roof or under leaves cannot be seen from afar (bots find crates the way players do: by looking).
    const scratch = [];
    this.crateMeta = world.map.crates.map((c) => ({ building: this.cover.buildingAt(c.x, c.y), tree: this.cover.canopiesAt(c.x, c.y, scratch).length > 0 }));
    this.cratesIn = world.map.buildings.map(() => []);
    this.crateMeta.forEach((m, i) => { if (m.building >= 0) this.cratesIn[m.building].push(i); });
    this.bots = [];
    this.byId = new Map();
    this.teamIntel = new Map();
    this.teamFocus = new Map();
    this.claims = new Map();
    this.noiseAt = new Map();
    this.lastHit = new Map();
    this.aggro = new Map();
    this.alive = 0;
    this.heat = 0;
    // How readily a bot picks a fight with a person who has not provoked it. At the usual level bots go for people a
    // little more often than for each other, not several times as often: the lobby should not be harder on a
    // player than on a bot that plays as well as they do.
    this.humanKeen = 0.2 + this.level * 0.8;
    this.keen = 1;
    this.endgame = false;
    this.late = false;
    this.errors = 0;
    this.coverT = 0;
  }

  // Turn a world player into a bot. `opts` may pin the profile (tests do); normally it is rolled from the seed.
  add(player, opts) {
    const bot = new Bot(this, player, makeProfile(this.rng, Object.assign({ level: this.level }, opts)));
    player.bot = true;
    player.ai = bot;
    player.controller = (p, world, dt) => this.drive(bot, dt);
    this.bots.push(bot);
    this.byId.set(player.id, bot);
    return bot;
  }
  // A bug in one bot must never take the match down with it: that bot just stands still for the tick.
  drive(bot, dt) {
    try {
      const out = bot.think(dt);
      // Nor may a stray NaN reach the simulation: a position that is not a number cannot be walked back.
      if (!(Number.isFinite(out.mx) && Number.isFinite(out.my) && (out.aimX === null || (Number.isFinite(out.aimX) && Number.isFinite(out.aimY))))) {
        if (this.errors++ < 5) this.log.error('bot ' + bot.p.name + ' produced an intent that is not a number (mode ' + bot.mode + ')');
        out.mx = 0; out.my = 0; out.aimX = null; out.aimY = null; out.fire = false; out.firePressed = false; out.utility = false;
      }
      return out;
    } catch (err) {
      if (this.errors++ < 5) this.log.error('bot ' + bot.p.name + ' failed: ' + ((err && err.stack) || err));
      return null;
    }
  }

  // Once per tick, before world.update.
  beforeTick(dt) {
    this.nav.budget = SEARCHES_PER_TICK;
    if ((this.coverT -= dt) <= 0) { this.coverT = 0.1; this.cover.refresh(this.world.players); }
    let n = 0;
    for (const p of this.world.players) if (p.alive) n++;
    this.alive = n;
    // Ahead of the pace (too many alive): keener. Behind it: bots leave each other be.
    const want = paceAt(this.world.time, this.pace) * this.world.players.length, heat = (n - want) / Math.max(2.5, want * 0.12);
    this.heat = heat < -1 ? -1 : heat > 2 ? 2 : heat;
    this.keen = this.heat >= 0 ? 1 + this.heat * 1.3 : Math.max(0.05, 1 + this.heat * 0.95);
    // How far along the match is, by head count (as shares of the lobby, so small lobbies behave the same way).
    const total = this.world.players.length;
    this.endgame = n <= Math.max(3, Math.round(total * 0.16));   // the last 8 of 50
    this.late = n <= Math.max(4, Math.round(total * 0.3));       // the last 15 of 50
    // Bullets passing close by: you notice being shot at even when they miss.
    const bullets = this.world.bullets;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      for (let k = 0; k < this.bots.length; k++) {
        const p = this.bots[k].p;
        if (p.team === b.team || !p.alive || Math.abs(b.x - p.x) > NEAR_MISS || Math.abs(b.y - p.y) > NEAR_MISS) continue;
        try { this.bots[k].onShotAt(b.owner); } catch (err) { this.oops(this.bots[k], err); }
      }
    }
  }

  // Once per tick, after world.update, with that tick's events.
  observe(events) {
    const time = this.world.time;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      try { this.notice(e, time); } catch (err) { this.oops(null, err); }
    }
  }
  oops(bot, err) { if (this.errors++ < 5) this.log.error('bot ' + (bot ? bot.p.name : 'director') + ' failed: ' + ((err && err.stack) || err)); }
  // What bots make of one world event.
  notice(e, time) {
    switch (e.type) {
      case 'damage': {
        const hurt = this.byId.get(e.target.id);
        if (hurt) hurt.onDamaged(e);
        if (e.source && e.source !== e.target) {
          this.lastHit.set(e.target.id, { by: e.source.id, team: e.source.team, at: time });
          const by = this.byId.get(e.source.id);
          if (by) by.onHit(e);
          // A human's fight is their bot teammates' fight: whoever they shoot, and whoever shoots them.
          if (this.teamSize > 1 && e.source.team !== e.target.team) {
            if (!e.source.bot) this.teamFocus.set(e.source.team, { id: e.target.id, at: time });
            if (!e.target.bot) this.teamFocus.set(e.target.team, { id: e.source.id, at: time });
          }
        }
        break;
      }
      case 'shot': case 'launch': case 'flame':
        this.cover.noteShot(e.player.id, time);
        this.noise(e.player.id, e.x === undefined ? e.player.x : e.x, e.y === undefined ? e.player.y : e.y, time);
        break;
      case 'vehicle-shot':
        this.cover.noteShot(e.player.id, time);
        this.noise(e.player.id, e.x, e.y, time);
        break;
      case 'explosion': this.noise(0, e.x, e.y, time); break;
      case 'death': { const by = e.killer && this.byId.get(e.killer.id); if (by) by.onKill(e.victim); break; }
      case 'crate': this.nav.invalidate(e.crate.x, e.crate.y, 40); this.claims.delete(e.crate.id); break;
      case 'rock-gone': this.nav.invalidate(e.rock.x, e.rock.y, e.rock.r); break;
      case 'struct': if (e.op === 'add' || e.op === 'gone') this.nav.invalidate(e.struct.x, e.struct.y, e.struct.r); break;
      case 'teleport': case 'pulled': { const b = this.byId.get(e.player.id); if (b) { b.route = null; b.padWait = null; } break; }
      default: break;
    }
  }
  // Shots make everyone nearby wary; you only learn where from if the muzzle flash was on your screen.
  noise(sourceId, x, y, time) {
    if (sourceId) { if (time - (this.noiseAt.get(sourceId) || -9) < 0.5) return; this.noiseAt.set(sourceId, time); }
    for (const bot of this.bots) {
      const p = bot.p;
      if (!p.alive || p.id === sourceId) continue;
      const dx = Math.abs(p.x - x), dy = Math.abs(p.y - y);
      if (dx > HEAR || dy > HEAR) continue;
      bot.onHeard(x, y, dx < 880 && dy < 492);
    }
  }

  upgrade(p, station, classId) { return this.world.upgrade(p, station, classId); }
  // Who has been hitting this player in the last `within` seconds (a player id, or 0)?
  attackerOf(id, within) { const h = this.lastHit.get(id); return h && this.world.time - h.at < within ? h.by : 0; }
  teamOf(id) { const h = this.world.playerById(id); return h ? h.team : 0; }
  // Bots currently fighting a given (human) player: used so that a person is not ganged up on.
  noteAggro(humanId, p) {
    let m = this.aggro.get(humanId);
    if (!m) { m = new Map(); this.aggro.set(humanId, m); }
    m.set(p.id, { at: this.world.time, team: p.team });
  }
  aggressors(humanId, exceptId) {
    const m = this.aggro.get(humanId), me = this.world.playerById(exceptId);
    if (!m) return 0;
    let n = 0;
    for (const [id, a] of m) {
      if (this.world.time - a.at > 4) { m.delete(id); continue; }
      if (id !== exceptId && !(me && a.team === me.team)) n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- team talk
  callout(p, rec) {
    if (this.teamSize < 2) return;
    let m = this.teamIntel.get(p.team);
    if (!m) { m = new Map(); this.teamIntel.set(p.team, m); }
    m.set(rec.id, { ref: rec.ref, x: rec.x, y: rec.y, hp: rec.hp, at: this.world.time, by: p.id, rx: p.x, ry: p.y });
  }
  intel(team) { return this.teamSize < 2 ? null : this.teamIntel.get(team) || null; }
  setFocus(p, enemyId) { if (this.teamSize > 1) this.teamFocus.set(p.team, { id: enemyId, at: this.world.time }); }
  focus(team) { const f = this.teamFocus.get(team); return f && this.world.time - f.at < 2 ? f.id : 0; }
  claim(crateId, p) { this.claims.set(crateId, p.id); }
  unclaim(crateId, p) { if (this.claims.get(crateId) === p.id) this.claims.delete(crateId); }
  claimedByMate(crateId, p) {
    const id = this.claims.get(crateId);
    if (!id || id === p.id) return false;
    const o = this.byId.get(id);
    return !!o && o.p.alive && !o.p.downed && o.p.team === p.team;
  }
}

export { makeNames };
