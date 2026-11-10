// One bot. It is driven exactly like a player: every tick it returns the same intent a client would send
// (move, aim point, fire, slot, gear, held item, interact, drop), built from what a player could see on screen.
// The layers, top to bottom: senses -> a goal ("mode") -> feet (path following), eyes (aim with lag and wobble),
// trigger -> item plays. Combat, looting and items live in bot-combat.mjs, bot-loot.mjs and bot-items.mjs.
import { canSee, viewHalf } from './sense.mjs';
import { classPlan } from './profile.mjs';

const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
const MEMORY = 6;            // seconds an enemy who left the screen stays in mind
const CALLOUT_RANGE = 900;   // teammates this close hear "one over there"

function freshIntent() {
  return { mx: 0, my: 0, aimX: null, aimY: null, fire: false, firePressed: false, scope: false, reload: false, slot: null, cycle: 0,
    swap: false, utility: false, charge: 0, utilityCharge: 0, iv: false, held: null, interactPressed: false, dropPressed: false };
}

export class Bot {
  constructor(director, player, profile) {
    const W = director.W, rng = W.U.rng((director.seed ^ Math.imul(player.id, 0x9e3779b1)) >>> 0);
    this.d = director; this.W = W; this.world = director.world; this.nav = director.nav; this.cover = director.cover;
    this.p = player; this.prof = profile; this.rng = rng;
    this.plan = classPlan(rng, profile, director.teamSize);
    this.now = 0; this.dt = 0.05; this.out = freshIntent();
    this.mode = 'roam'; this.modeAt = 0; this.redecide = true;
    this.tSense = rng.range(0, 0.25); this.tHazard = rng.range(0, 0.1); this.tDecide = rng.range(0, 0.3); this.tPlan = rng.range(0.2, 0.6);
    this.known = new Map(); this.target = null; this.mates = [];
    this.crates = new Set(); this.visited = new Set(); this.explore = null; this.busy = new Map();
    this.attacker = null; this.hurtAt = -99; this.hurtRecent = 0; this.alertUntil = 0; this.heardAt = -99; this.heard = null; this.bearing = null;
    this.nearMissAt = -99; this.sentryHurtAt = -99; this.sentryFoe = null; this.inHeat = 0; this.outHeat = 0; this.inBurst = 0;
    this.route = null; this.routeHold = 0; this.zig = 1; this.zigAt = 0; this.moveGoal = null; this.moveDir = null; this.still = false;
    this.seenCells = new Set();
    this.stuck = { x: player.x, y: player.y, at: 0, n: 0 }; this.unstick = null; this.noWay = null; this.shove = 0;
    this.look = null; this.shoot = null; this.clickAt = null;
    this.aimA = player.angle || 0; this.aimN = 0; this.aimOn = 0; this.aimId = 0; this.triggerAt = 0; this.nextTap = 0; this.sprayUntil = 0;
    this.aimV = 0; this.aimWant = 0; this.aimWantId = 0; this.aimHold = 0;
    this.strafeDir = 1; this.strafeUntil = 0; this.swapAt = 0; this.reloadAt = 0;
    this.coverSpot = null; this.coverAt = -9; this.coverWanted = false; this.coverRollAt = -9;
    this.shotAt = -9; this.shotOk = false; this.shotFor = 0;
    this.fleeing = null; this.fightSince = 0; this.engage = new Map();
    this.loot = null; this.badLoot = new Map(); this.lootAt = 0; this.nextInteract = 0;
    this.station = null; this.badStation = new Map();
    this.storm = { must: false, soon: false, x: 0, y: 0 };
    this.hazards = []; this.evade = null; this.heed = new Map(); this.avoid = [];
    this.act = null; this.queue = []; this.hes = new Map(); this.itemAt = 0; this.openers = 0; this.strikeAt = -9;
    this.pauseUntil = 0; this.landAt = Infinity; this.landed = false; this.roam = null; this.lastX = player.x; this.lastY = player.y;
    this.home = null; this.padWait = null; this.myRock = null; this.siege = null; this.siegeBan = new Map(); this.huntAt = null; this.huntHold = 0; this.mountIdle = 0; this.mountAt = 0; this.gearAt = 0;
    this.lastEnemyAt = -99; this.reviving = null; this.scopeScan = 0;
    this.launchCharge = null; this.gearCharge = null;
  }

  // ---------------------------------------------------------------- small helpers
  dist(o) { return Math.hypot(o.x - this.p.x, o.y - this.p.y); }
  hpFrac() { const p = this.p; return clamp((p.hp + p.armor * 0.6) / p.maxHp, 0, 1.6); }
  speed() { return this.W.CONFIG.playerSpeed * this.world.speedMul(this.p) * (this.p.inPond ? this.W.CONFIG.pondSpeedMul : 1); }
  gauss() { const r = this.rng; return (r.next() + r.next() + r.next() + r.next() - 2) * 1.732; } // ~N(0,1)
  projectileChargeAtDistance(id, distance) {
    const def = this.W.WEAPONS[id], launcher = def && def.kind === 'launcher';
    const min = launcher ? def.minRange : 70, max = launcher ? def.range : this.W.WEAPONS.grenade.throwRange;
    return clamp((distance - min) / (max - min), 0, 1) * this.W.CONFIG.projectileChargeTime;
  }
  pause(lo, hi) { this.pauseUntil = Math.max(this.pauseUntil, this.now + this.rng.range(lo, hi) * this.prof.hesitation); }
  setMode(mode) {
    if (this.mode !== mode) { this.mode = mode; this.modeAt = this.now; this.route = null; if (mode === 'fight') { this.fightSince = this.now; this.openers = 0; } }
    return true;
  }
  // Inside the next circle (and the current one).
  inSafe(x, y, pad) {
    const s = this.world.storm;
    if (!s) return true;
    const c = s.next || s;
    return Math.hypot(x - c.x, y - c.y) < c.r - (pad || 0) && Math.hypot(x - s.x, y - s.y) < s.r - (pad || 0) * 0.5;
  }
  // Somewhere it makes sense to go right now: out of the storm, and inside the next circle once that is about to matter.
  inZone(x, y, pad) {
    const s = this.world.storm;
    if (!s) return true;
    if (this.storm.soon) return this.inSafe(x, y, pad);
    return Math.hypot(x - s.x, y - s.y) < s.r - (pad || 0);
  }

  // ---------------------------------------------------------------- one tick
  think(dt) {
    const p = this.p, out = this.out = freshIntent();
    this.now = this.world.time; this.dt = dt;
    if (p.dropT > 0) { this.launchCharge = this.gearCharge = null; this.landAt = this.now + p.dropT + this.rng.range(0.1, 0.55) * this.prof.hesitation; return out; }
    if (!this.landed) { this.landed = true; this.aimA = p.angle; }
    if (Math.hypot(p.x - this.lastX, p.y - this.lastY) > 150) { this.route = null; this.coverSpot = null; this.padWait = null; } // teleported or pulled
    this.lastX = p.x; this.lastY = p.y;
    this.hurtRecent = Math.max(0, this.hurtRecent - dt * 14);
    const fade = Math.exp(-dt / 1.5);
    this.inHeat *= fade; this.outHeat *= fade;             // damage taken from / dealt to players lately (rate = heat / 1.5)
    this.inBurst *= Math.exp(-dt / 0.5);                   // the same, over the last half second
    if ((this.tSense -= dt) <= 0) { this.tSense = this.prof.senseEvery; this.sense(); }
    for (const rec of this.known.values()) if (!rec.noticed && rec.visible && this.now >= rec.noticeAt) { rec.noticed = true; this.redecide = true; }
    if ((this.tHazard -= dt) <= 0) { this.tHazard = 0.1; this.scanHazards(); }
    this.moveGoal = null; this.moveDir = null; this.look = null; this.shoot = null; this.still = false; this.clickAt = null; this.freeze = false;
    if ((p.downed || p.mount) && this.act) this.act.chargeAt = null;
    if (p.downed) this.thinkDowned();
    else if (p.mount) this.thinkMounted();
    else if (this.now >= this.landAt) {
      if ((this.tDecide -= dt) <= 0 || this.redecide) { this.tDecide = this.prof.decideEvery; this.redecide = false; this.decide(); }
      this.runMode();
      this.runItems();
    }
    this.chargeGear();
    this.launchRequested = false;
    this.steer();
    this.aim();
    if (!this.launchRequested) this.launchCharge = null;
    return out;
  }

  // Class hand grenades use the same hold-and-release delay as a player's gear key.
  // Keep the chosen landing point while charging; switching actions safely cancels it.
  chargeGear() {
    const p = this.p, out = this.out;
    if (!p.alive || p.downed || p.mount || p.held >= 0 || this.act || this.gearKind() !== 'grenade' || p.grenades <= 0) {
      this.gearCharge = null;
      return;
    }
    if (out.utility) {
      out.utility = false;
      if (!this.gearCharge && this.clickAt) this.gearCharge = { at: this.now, point: { ...this.clickAt }, target: this.target && this.target.id };
    }
    const charging = this.gearCharge;
    if (!charging) return;
    if (charging.target && (!this.target || this.target.id !== charging.target || !this.target.ref.alive)) { this.gearCharge = null; return; }
    this.shoot = null;
    this.clickAt = charging.point;
    const required = this.projectileChargeAtDistance('grenade', this.dist(charging.point));
    if (this.now - charging.at + 1e-8 < required || p.throwCd > 0) return;
    out.utility = true;
    out.utilityCharge = Math.min(this.W.CONFIG.projectileChargeTime, this.now - charging.at);
    this.gearCharge = null;
  }

  // ---------------------------------------------------------------- senses
  newRecord(o) {
    return { id: o.id, ref: o, x: o.x, y: o.y, vx: 0, vy: 0, hp: 1, seenAt: this.now, firstAt: this.now, noticeAt: Infinity, noticed: false, visible: false,
      hurtMeAt: -99, shotAtMeAt: -99, hitAt: -99, stillSince: this.now, downed: false, dropping: false, revealed: false, aimsAtMe: false };
  }
  noticeDelay(o, half) {
    const ecc = Math.max(Math.abs(o.x - this.p.x) / half.w, Math.abs(o.y - this.p.y) / half.h);
    const busy = this.mode === 'loot' || this.mode === 'upgrade' || !!this.act;
    return this.prof.reaction * (0.7 + 0.9 * ecc * ecc) * (busy ? 1.3 : 1) * (this.now < this.alertUntil ? 0.6 : 1) * this.rng.range(0.8, 1.25);
  }
  sense() {
    const p = this.p, world = this.world, now = this.now, known = this.known, cover = this.cover;
    const half = viewHalf(this.W, p), blind = p.fx.flash > 0.5;
    const reveal = (world.reveal[p.team] || 0) > 0 || p.fx.radar > 0 ? world.revealedEnemies(p) : null;
    const revealed = reveal && reveal.length ? new Set(reveal.map((o) => o.id)) : null;
    this.mates.length = 0;
    for (let i = 0; i < world.players.length; i++) {
      const o = world.players[i];
      if (o === p || !o.alive) continue;
      if (o.team === p.team) { this.mates.push(o); continue; }
      let rec = known.get(o.id);
      const marked = !!revealed && revealed.has(o.id);
      const seen = !blind && canSee(this.W, cover, p, o, half, revealed);
      if (seen || marked) {
        if (!rec) { rec = this.newRecord(o); known.set(o.id, rec); rec.noticeAt = marked ? now + 0.25 : now + this.noticeDelay(o, half); }
        else if (!rec.visible && now - rec.seenAt > 2 && !rec.noticed) rec.noticeAt = now + this.noticeDelay(o, half);
        const sp = Math.hypot(o.vx, o.vy);
        if (sp > 55 || o.mount !== rec.mounted) rec.stillSince = now;
        rec.x = o.x; rec.y = o.y; rec.vx = o.vx; rec.vy = o.vy; rec.seenAt = now; rec.visible = seen; rec.revealed = marked; rec.lost = false;
        if (seen) rec.hp = o.hp / o.maxHp;                       // a marker beyond the edge of the screen is an arrow, not a health bar
        rec.downed = o.downed; rec.dropping = o.dropT > 0; rec.mounted = o.mount;
        rec.aimsAtMe = seen && Math.abs(this.W.U.angleDiff(o.angle, Math.atan2(p.y - o.y, p.x - o.x))) < 0.3;
        if (!rec.noticed && now >= rec.noticeAt) { rec.noticed = true; this.redecide = true; }
        if (rec.noticed && !rec.dropping) { this.lastEnemyAt = now; this.d.callout(p, rec); }
      } else if (rec) {
        rec.visible = false; rec.revealed = false; rec.aimsAtMe = false;
        if (!rec.noticed && now - rec.seenAt > 0.5) known.delete(o.id);       // glimpsed, never registered
        else if (now - rec.seenAt > MEMORY) { known.delete(o.id); if (this.target === rec) this.target = null; }
      }
    }
    for (const [id, rec] of known) if (!rec.ref.alive) { known.delete(id); if (this.target === rec) { this.target = null; this.redecide = true; } }
    // Crates on screen: out in the open you see them from afar, under leaves only up close, under a roof only from inside.
    if (!blind) {
      const crates = world.map.crates, meta = this.d.crateMeta, seenCrates = this.crates, here = cover.info.get(p.id), inside = here ? here.building : -1;
      for (let i = 0; i < crates.length; i++) {
        const c = crates[i];
        if (!c.alive || seenCrates.has(i)) continue;
        const dx = Math.abs(c.x - p.x), dy = Math.abs(c.y - p.y);
        if (dx > half.w || dy > half.h) continue;
        const m = meta[i];
        if (m.building >= 0 ? inside === m.building : !m.tree || dx + dy < 300) seenCrates.add(i);
      }
      if (inside >= 0) this.visited.add(inside);
    }
    // "One over there": positions teammates call out.
    const intel = this.d.intel(p.team);
    if (intel) {
      for (const [id, c] of intel) {
        if (c.by === p.id || now - c.at > 1.5 || !c.ref.alive || Math.hypot(c.rx - p.x, c.ry - p.y) > CALLOUT_RANGE) continue;
        let rec = known.get(id);
        if (rec) { if (!rec.noticed) rec.noticeAt = Math.min(rec.noticeAt, now + 0.2); continue; }
        rec = this.newRecord(c.ref);
        rec.x = c.x; rec.y = c.y; rec.noticed = true; rec.hp = c.hp; rec.seenAt = c.at;
        known.set(id, rec);
      }
    }
  }

  // The match feeds these from world events.
  onDamaged(e) {
    const p = this.p, now = this.now = this.world.time, src = e.source;
    this.hurtAt = now;
    this.hurtRecent += e.amount;
    if (e.cause === 'sentry') this.sentryHurtAt = now;
    if (!src || src === p || src.team === p.team) return;
    this.inHeat += e.amount; this.inBurst += e.amount;
    this.alertUntil = now + 7;
    const direct = e.cause !== 'fire' && e.cause !== 'poison' && e.cause !== 'meteor' && e.cause !== 'lightning' && e.cause !== 'airstrike' && e.cause !== 'sentry';
    if (!direct) return;
    if (this.notMeantForMe(src)) return;                  // caught a stray (a bullet or a blast meant for someone else)
    this.attacker = { id: src.id, at: now };
    let rec = this.known.get(src.id);
    if (src.alive && this.shows(src)) {
      // Bullets hitting you point straight back at the shooter: the muzzle flash is on the screen, leaves or no leaves.
      if (!rec) { rec = this.newRecord(src); this.known.set(src.id, rec); }
      rec.hurtMeAt = now;
      rec.noticeAt = Math.min(rec.noticeAt, now + this.prof.reaction * 0.45);
      rec.x = src.x; rec.y = src.y; rec.seenAt = now; rec.lost = false;
    } else {
      // Hurt by someone who is not on the screen to be seen (a grenade from behind a roof, an invisible thrower):
      // that says somebody is out there, not where.
      if (rec) rec.hurtMeAt = now;
      this.bearing = { at: now };
    }
    if (now - this.modeAt > 0.3) this.redecide = true;
  }
  // Is this shooter a bot whose bullets are meant for something else (a crate, someone behind us)?
  // People can usually tell; it stops a stray round from turning into a duel.
  notMeantForMe(src) {
    const ai = src && src.bot ? src.ai : null;
    if (!ai) return false;
    if (ai.target && ai.target.id === this.p.id && (ai.mode === 'fight' || ai.mode === 'flee')) return false;
    const s = ai.shoot;
    return !s || !s.rec || s.rec.id !== this.p.id;
  }
  // A bullet went past: find out who is shooting.
  onShotAt(ownerId) {
    const now = this.world.time;
    if (this.notMeantForMe(this.world.playerById(ownerId))) return;
    let rec = this.known.get(ownerId);
    if (rec) { rec.shotAtMeAt = now; if (!rec.noticed) rec.noticeAt = Math.min(rec.noticeAt, now + this.prof.reaction * 0.6); return; }
    if (now - this.nearMissAt < 0.4) return;
    this.nearMissAt = now;
    const src = this.world.playerById(ownerId), p = this.p;
    if (!src || !src.alive) return;
    this.alertUntil = now + 6;
    if (this.shows(src)) {
      rec = this.newRecord(src);
      rec.shotAtMeAt = now; rec.noticeAt = now + this.prof.reaction * 0.6;
      this.known.set(ownerId, rec);
    } else this.bearing = { at: now };
  }
  // Is this player drawn on our screen right now (inside the view, not under a roof or leaves, not invisible,
  // unless they have just fired)?
  shows(o) { return !(this.p.fx.flash > 0.5) && canSee(this.W, this.cover, this.p, o, viewHalf(this.W, this.p), null); }
  onHit(e) {
    this.outHeat += e.amount;
    const rec = this.known.get(e.target.id);
    if (rec) { rec.hitAt = this.world.time; rec.hp = e.target.hp / e.target.maxHp; }
  }
  onHeard(x, y, seen) {
    const now = this.world.time;
    this.alertUntil = Math.max(this.alertUntil, now + 4);
    if (seen) { this.heardAt = now; this.heard = { x, y }; }
  }
  onKill(victim) {
    if (this.target && this.target.id === victim.id) this.target = null;
    this.known.delete(victim.id);
    this.pause(0.1, 0.5);
    this.redecide = true;
  }

  // ---------------------------------------------------------------- hazards: grenades, fire, snow, strikes
  scanHazards() {
    const p = this.p, world = this.world, now = this.now, list = this.hazards, avoid = this.avoid;
    list.length = 0; avoid.length = 0;
    const add = (id, x, y, r, eta, kind, lasting) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > r + 420) return;
      let h = this.heed.get(id);
      if (h === undefined) {
        // Decide once per danger how quickly this bot reacts. Nobody stands on a grenade on purpose, but a bot that
        // was looking the wrong way only starts running after a moment (a weaker one more often), and gets caught by it.
        const late = !lasting && this.rng.next() >= this.prof.dodge;
        h = { at: now + this.prof.reaction * this.rng.range(0.5, 1.1) + (late ? this.rng.range(0.45, 1.1) : 0), heed: true };
        this.heed.set(id, h);
        if (this.heed.size > 60) this.heed.delete(this.heed.keys().next().value);
      }
      if (!h.heed || now < h.at) return;
      list.push({ id, x, y, r, eta, kind, d });
      if (lasting || eta < 4) avoid.push({ x, y, r: r + 30, cost: 25 });
    };
    for (const g of world.grenades) {
      const own = g.owner === p.id, mate = !own && g.team === p.team, it = g.item;
      if (it === 'smoke') continue;
      if (mate && it !== 'flashbang' && it !== 'snowbomb') continue;         // teammates' blasts, fire and poison spare you
      if (own && (it === 'blackhole' || it === 'snowbomb')) continue;        // thrown on purpose; the snow rim is handled as a zone
      const R = it === 'firenade' ? 300 : it === 'snowbomb' ? 0 : it === 'blackhole' ? 0 : (g.radius || (g.explosion && g.explosion.radius) || 150);
      if (!R) continue;
      const x = g.air > 0 && g.targetX !== undefined ? g.targetX : g.x, y = g.air > 0 && g.targetY !== undefined ? g.targetY : g.y;
      const eta = g.kind === 'launcher' ? (g.maxTravel - g.traveled) / (Math.hypot(g.vx, g.vy) || 900) + (g.landFuse || 0.4)
        : g.instant ? Math.max(0, g.flightTime - g.flightElapsed) : Math.max(g.fuse, g.air > 0 ? g.flightTime - g.flightElapsed : 0);
      add('g' + g.id, x, y, R + 34, eta, it || 'blast', false);
    }
    for (const z of world.zones) {
      if (z.kind === 'fire') { if (z.owner !== p.id && z.team !== null && z.team !== undefined && z.team === p.team) continue; add('z' + z.id, z.x, z.y, z.r + 26, 0, 'fire', true); }
      else if (z.kind === 'snow') add('z' + z.id, z.x, z.y, z.r + 10, 0, 'snow', true);
    }
    for (const s of world.strikes) {
      if (s.t <= 0) continue;
      if (s.kind === 'airstrike') add('s' + s.id, s.x, s.y, s.radius + 50, s.t, 'airstrike', true);
      else if (s.kind === 'meteor' && s.team !== p.team) add('s' + s.id, s.x, s.y, s.radius + 44, s.t, 'meteor', false);
    }
    // Enemy sentries never miss. The basic one is worth shooting down, for a bot carrying a gun that reaches it from
    // wherever it reaches us; a bigger one (or one we have nothing to answer with) is a circle to stay out of.
    this.sentryFoe = null;
    for (const s of world.structures) {
      if (s.kind !== 'sentry' || !s.alive || s.team === p.team) continue;
      const it = this.W.ITEMS[s.item], d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d > it.range + 420) continue;
      const inSight = d < it.range && world.sentryLineClear(s, p.x, p.y);
      if (this.smallSentry(s) && this.gunFor(it.range) >= 0) { if (inSight && (!this.sentryFoe || d < this.dist(this.sentryFoe))) this.sentryFoe = s; }
      else if (d >= it.range || inSight) add('t' + s.id, s.x, s.y, it.range + 60, 0, 'sentry', true);
    }
    // Pick the escape: out of whatever we are standing in (or about to be standing in), most urgent first.
    let worst = null;
    for (const h of list) if (h.d < h.r && (!worst || h.eta < worst.eta)) worst = h;
    if (!worst) { this.evade = null; return; }
    this.evade = this.escapeFrom(worst);
  }
  // A sentry weak enough to stand in front of and shoot (the basic one: 25 damage a second, 50 HP).
  smallSentry(s) { const it = this.W.ITEMS[s.item]; return it.damage / it.fireInterval <= 40; }
  // The slot of a gun of ours that hits at that range (bullets only; the one in hand if it does). -1: we have none.
  gunFor(range) {
    const p = this.p, ok = (i) => { const def = this.W.WEAPONS[p.weapons[i].id]; return !!def.bulletSpeed && def.range * 0.9 >= range; };
    if (ok(p.slot)) return p.slot;
    for (let i = 0; i < p.weapons.length; i++) if (ok(i)) return i;
    return -1;
  }
  escapeFrom(h) {
    const p = this.p, nav = this.nav, now = this.now;
    if (h.kind === 'sentry' && h.r - h.d > 150) {
      // Deep inside its range: out of its sight is closer than out of its reach (but never by running further in).
      const c = this.findCover(h.x, h.y);
      if (c && Math.hypot(c.x - h.x, c.y - h.y) >= h.d - 30) { c.h = h; c.cant = false; return c; }
    }
    let ax = p.x - h.x, ay = p.y - h.y;
    const d = Math.hypot(ax, ay);
    if (d < 1) { ax = Math.cos(this.aimA + Math.PI); ay = Math.sin(this.aimA + Math.PI); } else { ax /= d; ay /= d; }
    // Prefer the way we were already heading if that also leads out.
    const g = this.fleeing && this.fleeing.spot ? this.fleeing.spot : null;
    const need = h.r - d + 40, base = Math.atan2(ay, ax);
    let best = null, bestScore = -Infinity;
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
      const a = base + off, x = p.x + Math.cos(a) * need, y = p.y + Math.sin(a) * need;
      if (!nav.freeAt(x, y) || !nav.segmentClear(p.x, p.y, x, y)) continue;
      let score = -Math.abs(off) * 60 - (nav.pondAt(x, y) ? 80 : 0);
      if (g) score -= Math.hypot(g.x - x, g.y - y) * 0.15;
      for (const o of this.hazards) if (o !== h && Math.hypot(x - o.x, y - o.y) < o.r) score -= 200;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    let walk = need;
    if (!best) {
      // No straight line out (walls all round: we are in a house): leave the way a walker does, through the door.
      const was = this.evade;
      if (was && was.path && was.h.id === h.id && now - was.at < 1.2 && this.route && this.route.out === was.at) best = was;
      else {
        const pts = nav.wayOut(p.x, p.y, this.hazards.map((o) => ({ x: o.x, y: o.y, r: o === h ? o.r + 30 : o.r })));
        if (pts && pts.length) {
          const end = pts[pts.length - 1];
          let len = 0, px = p.x, py = p.y;
          for (const pt of pts) { len += Math.hypot(pt.x - px, pt.y - py); px = pt.x; py = pt.y; }
          best = { x: end.x, y: end.y, path: true, at: now, len };
          this.route = { gx: end.x, gy: end.y, pts, i: 0, partial: false, at: now, cut: 0, blocked: 0, out: now };
        }
      }
      if (best) walk = best.len;
    }
    if (!best) best = { x: p.x + ax * need, y: p.y + ay * need, blind: true };      // nowhere to go: push away from it anyway
    best.h = h;
    best.cant = h.eta > 0 && walk / Math.max(60, this.speed()) > h.eta + 0.15; // will not make it out in time
    return best;
  }

  // ---------------------------------------------------------------- storm
  updateStorm() {
    const p = this.p, s = this.world.storm, st = this.storm;
    st.must = false; st.soon = false;
    if (!s) return;
    const next = s.next || s, dNext = Math.hypot(p.x - next.x, p.y - next.y), dNow = Math.hypot(p.x - s.x, p.y - s.y);
    const pad = Math.min(next.r * 0.45, 140 + this.prof.caution * 260);
    const need = dNext - (next.r - pad);                // distance still to cover to be comfortably inside the next circle
    if (need > 0 || p.inStorm) {
      // When does the wall reach where we stand? (the margin r - d shrinks roughly linearly during a phase)
      const phase = this.W.STORM[Math.min(s.phase, this.W.STORM.length - 1)];
      const m0 = s.r - dNow, m1 = next.r - dNext, len = s.state === 'shrinking' ? s.timeLeft : phase ? phase.end - phase.start : 30;
      const wait = s.state === 'waiting' ? s.timeLeft : 0;
      const hit = p.inStorm ? 0 : m1 >= 0 ? Infinity : wait + len * clamp(m0 / Math.max(1, m0 - m1), 0, 1);
      const reach = Math.max(0, need) / Math.max(120, this.speed() * 0.92);
      st.must = p.inStorm || hit - reach < this.prof.stormSlack;
      st.soon = st.must || hit - reach < this.prof.stormSlack + 25;
      // Aim for a spot inside the next circle on our side of it (deeper for small circles).
      const k = dNext > 1 ? Math.max(0, next.r - pad - this.rng.range(0, Math.min(200, next.r * 0.3))) / dNext : 0;
      if (!st.fixed || Math.hypot(st.x - next.x, st.y - next.y) > next.r - pad * 0.5 || st.phase !== s.phase) {
        st.x = next.x + (p.x - next.x) * Math.min(1, k); st.y = next.y + (p.y - next.y) * Math.min(1, k); st.fixed = true; st.phase = s.phase;
        if (!this.nav.freeAt(st.x, st.y)) { const c = this.nav.freeCellNear(st.x, st.y, 5, false); if (c >= 0) { const pt = this.nav.center(c); st.x = pt.x; st.y = pt.y; } }
        // Not into a fire, an airstrike or a big sentry's reach: swing round the circle to a clear spot.
        const rr = Math.hypot(st.x - next.x, st.y - next.y), a0 = Math.atan2(st.y - next.y, st.x - next.x);
        for (let turn = 1; turn <= 8 && this.inHazard(st.x, st.y); turn++) {
          const a = a0 + Math.ceil(turn / 2) * 0.6 * (turn % 2 ? 1 : -1);
          st.x = next.x + Math.cos(a) * rr; st.y = next.y + Math.sin(a) * rr;
        }
      }
    } else st.fixed = false;
  }

  // ---------------------------------------------------------------- deciding what to do
  decide() {
    const p = this.p, now = this.now;
    this.updateStorm();
    this.pickTarget();
    for (const [k, until] of this.badLoot) if (now > until) this.badLoot.delete(k);
    // Mid-escape: keep going until it is over.
    if (this.mode === 'flee' && this.fleeing && !this.fleeDone()) {
      if (!(this.fleeing.calm && this.storm.must)) return;
      this.endFlee();                                      // only keeping out of someone's sight: the storm matters more
    }
    if (this.storm.must && p.inStorm && this.world.storm.dps >= 2) return this.setMode('storm');
    const e = this.target;
    // A teammate is down right here and we have something to do it behind (smoke, a boulder, a riot shield): get them up first.
    if (e && this.mates.length && this.slotOf('smoke', 'rock', 'riotshield') >= 0 && this.hpFrac() > 0.35 && this.pickRevive() && this.dist(this.reviving) < 420) return this.setMode('revive');
    const stance = e ? this.stance(e) : 'ignore';
    if (stance === 'flee') return this.startFlee(e);
    if (stance === 'fight') return this.setMode('fight');
    if (this.pickSiege() && !(this.storm.must && p.inStorm)) return this.setMode('siege');
    if (this.storm.must) return this.setMode('storm');
    if (this.pickRevive()) return this.setMode('revive');
    if (stance === 'avoid') return this.startFlee(e, true);   // hurt, and a stranger in plain view: somewhere quiet first
    if (this.pickStation()) return this.setMode('upgrade');
    if (this.needRegroup()) return this.setMode('regroup');
    if (this.pickLoot()) return this.setMode('loot');
    if (this.following()) return this.setMode('escort');   // nothing to pick up here: stay with whoever leads the team
    if (this.pickHunt()) return this.setMode('hunt');
    if (this.pickExplore()) return this.setMode('explore');
    return this.setMode('roam');
  }

  runMode() {
    switch (this.mode) {
      case 'fight': this.doFight(); break;
      case 'flee': this.doFlee(); break;
      case 'storm': this.doStorm(); break;
      case 'revive': this.doRevive(); break;
      case 'upgrade': this.doUpgrade(); break;
      case 'loot': this.doLoot(); break;
      case 'regroup': this.doRegroup(); break;
      case 'hunt': this.doHunt(); break;
      case 'explore': this.doExplore(); break;
      case 'siege': this.doSiege(); break;
      case 'escort': this.doEscort(); break;
      default: this.doRoam();
    }
    // Feet may be busy with something else; the gun still answers whoever is shooting at us.
    const e = this.target;
    if (!this.shoot && e && this.mode !== 'fight' && this.mode !== 'flee' && e.visible && (this.now - e.hurtMeAt < 2.5 || this.now - e.shotAtMeAt < 1.5)) this.fireBack(e);
    // A basic enemy sentry that can see us: shoot it down (it has 50 HP) unless a player needs the bullets more.
    const s = this.sentryFoe;
    if (s && s.alive && (!this.shoot || !this.shoot.rec || this.now - this.sentryHurtAt < 1.5)) this.shootStruct(s);
    this.handleWeapon();
  }
  shootStruct(s) {
    const p = this.p, W = this.W, d = this.dist(s);
    const reaches = (i) => { const g = W.WEAPONS[p.weapons[i].id]; return !!g.bulletSpeed && d <= g.range * 0.9; };
    let slot = reaches(p.slot) ? p.slot : -1;
    // The gun in hand does not reach it (a shotgun, a launcher): take out the one that does, unless a fight needs this one.
    if (slot < 0 && this.mode !== 'fight') for (let i = 0; i < p.weapons.length && slot < 0; i++) if (reaches(i)) slot = i;
    if (slot < 0) return;
    if (slot !== p.slot) { if (this.now >= this.swapAt && !this.act) { this.out.slot = slot; this.swapAt = this.now + 0.8; } return; }
    const def = W.WEAPONS[p.weapons[slot].id];
    const hit = this.world.sweep(p.x, p.y, s.x, s.y, def.bulletRadius || 5, p.id, p.team);
    if (hit && hit.solid && hit.solid.struct === s) this.shoot = { x: s.x, y: s.y, r: s.r, def, struct: s };
  }

  doStorm() {
    const st = this.storm;
    if (!st.must && !st.soon) { this.redecide = true; return; }
    this.moveGoal = { x: st.x, y: st.y, tol: 70 };
    if (this.arrivedAt(st, 80)) { st.fixed = false; this.redecide = true; }
  }
  arrivedAt(pt, tol) { return Math.hypot(pt.x - this.p.x, pt.y - this.p.y) <= tol; }
  inHazard(x, y) { for (const h of this.hazards) if (Math.hypot(x - h.x, y - h.y) < h.r) return true; return false; }

  // Nothing in sight worth having: look inside the nearest building we have not been in (that is where crates hide).
  pickExplore() {
    const p = this.p, now = this.now, list = this.world.map.buildings;
    if (this.tokenNeed() <= 0 && this.W.CLASSES[p.classId].tier >= 2) return false;
    const cur = this.explore;
    if (cur && !this.visited.has(cur.index) && now < cur.until && !this.occupied(cur.index)) return true;
    let best = -1, bd = 1700;
    for (let i = 0; i < list.length; i++) {
      if (this.visited.has(i)) continue;
      const b = list[i], x = b.x + b.w / 2, y = b.y + b.h / 2, d = Math.hypot(x - p.x, y - p.y);
      if (d < bd && this.inZone(x, y, 60) && !this.occupied(i)) { bd = d; best = i; }
    }
    if (best < 0) { this.explore = null; return false; }
    const b = list[best];
    this.explore = { index: best, x: b.x + b.w / 2, y: b.y + b.h / 2, until: now + 6 + bd / 180 };
    return true;
  }
  // A house some stranger was just seen walking into, or standing at the door of, can wait: that is an ambush, not a search.
  occupied(index) {
    const now = this.now, until = this.busy.get(index);
    if (until !== undefined) { if (now < until) return true; this.busy.delete(index); }
    const b = this.world.map.buildings[index], here = this.cover.info.get(this.p.id);
    if (here && here.building === index) return false;                 // already inside: whoever is here gets dealt with
    for (const r of this.known.values()) {
      if (!r.noticed || r.downed || r.dropping || r.x < b.x - 90 || r.x > b.x + b.w + 90 || r.y < b.y - 90 || r.y > b.y + b.h + 90) continue;
      this.busy.set(index, now + this.rng.range(25, 50));
      return true;
    }
    return false;
  }
  doExplore() {
    const e = this.explore;
    if (!e || this.visited.has(e.index) || this.now > e.until) { if (e) this.foundIn(e.index); this.explore = null; this.redecide = true; return; }
    this.moveGoal = { x: e.x, y: e.y, tol: 70 };
    if (this.arrivedAt(e, 80)) { this.foundIn(e.index); this.pause(0.2, 0.8); this.redecide = true; }
  }
  // We have been to (or been stopped at the door of) this building: whatever crate is in there, we know about it now.
  foundIn(index) {
    this.visited.add(index);
    for (const i of this.d.cratesIn[index]) this.crates.add(i);
  }

  // Nothing particular to do: cover ground nobody on this bot's screen has looked at yet (towns first), staying
  // inside the next circle. Once the circle is small there is nothing left to explore and it holds a spot instead.
  doRoam() {
    const p = this.p, now = this.now, rng = this.rng, nav = this.nav, CELL = 900;
    this.seenCells.add(Math.floor(p.x / CELL) * 64 + Math.floor(p.y / CELL));
    let r = this.roam;
    if (!r || now > r.until || this.arrivedAt(r, 90) || (this.noWay && this.noWay.at > r.at)) {
      const s = this.world.storm, c = s ? (s.next || s) : { x: nav.size / 2, y: nav.size / 2, r: nav.size };
      if (r && this.arrivedAt(r, 90)) { if (c.r < 1000) this.pause(1.5, 5); else this.pause(0.3, 1.4); }
      r = null;
      const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), towns = this.world.map.towns;
      let best = null, bs = Infinity;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const ix = cx + dx, iy = cy + dy;
          if (this.seenCells.has(ix * 64 + iy)) continue;
          const x = (ix + 0.5) * CELL, y = (iy + 0.5) * CELL;
          if (!this.W.U.insideIsland(x, y, 320, nav.size, nav.corner) || !this.inZone(x, y, 80)) continue;
          let score = Math.hypot(x - p.x, y - p.y) + rng.range(0, 500);
          for (const t of towns) if (Math.hypot(t.x - x, t.y - y) < 800) { score -= 500; break; }
          if (score < bs) { bs = score; best = { x, y }; }
        }
      }
      for (let i = 0; i < 12 && !r; i++) {
        let x, y;
        if (best) { x = best.x + rng.range(-300, 300); y = best.y + rng.range(-300, 300); }
        else {
          // Seen it all (or the circle is tiny): somewhere inside the circle, not too far.
          const a = rng.range(0, TAU), d = rng.range(300, 1300);
          x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d;
          const dc = Math.hypot(x - c.x, y - c.y), lim = Math.max(60, c.r * 0.8);
          if (dc > lim) { const k = lim * rng.range(0.3, 1) / dc; x = c.x + (x - c.x) * k; y = c.y + (y - c.y) * k; }
        }
        if (nav.freeAt(x, y) && !nav.pondAt(x, y)) r = { x, y, at: now, until: now + rng.range(10, 20) };
      }
      this.roam = r || { x: c.x, y: c.y, at: now, until: now + 6 };
      r = this.roam;
    }
    this.moveGoal = { x: r.x, y: r.y, tol: 80 };
  }

  // ---------------------------------------------------------------- team
  leader() {
    const p = this.p;
    let best = p;
    for (const o of this.mates) {
      if (o.downed) continue;
      // Follow a human teammate if there is one; otherwise the lowest id leads.
      if ((best.bot && !o.bot) || (best.bot === o.bot && o.id < best.id)) best = o;
    }
    return best;
  }
  // The teammate this bot sticks with (null when it leads, or plays alone).
  following() {
    if (!this.mates.length) return (this.lead = null);
    const lead = this.leader();
    return (this.lead = lead === this.p ? null : lead);
  }
  needRegroup() {
    const lead = this.following();
    if (!lead) return false;
    const d = this.dist(lead), far = lead.bot ? 760 : 520;
    return d > far || (this.mode === 'regroup' && d > far * 0.45);
  }
  // Walking with the leader: a few steps off to one side, stopping when they stop.
  doEscort() {
    const lead = this.lead, p = this.p;
    if (!lead || !lead.alive || lead.downed) { this.redecide = true; return; }
    if (!this.escortAt || this.now > this.escortAt.until) this.escortAt = { a: this.rng.range(0, TAU), r: this.rng.range(110, 230), until: this.now + this.rng.range(4, 9) };
    const x = lead.x + Math.cos(this.escortAt.a) * this.escortAt.r, y = lead.y + Math.sin(this.escortAt.a) * this.escortAt.r;
    if (Math.hypot(x - p.x, y - p.y) > 70 && this.nav.freeAt(x, y)) this.moveGoal = { x, y, tol: 50 };
    else if (this.dist(lead) > 300) this.moveGoal = { x: lead.x, y: lead.y, tol: 180 };
  }
  doRegroup() {
    const lead = this.lead;
    if (!lead || !lead.alive) { this.redecide = true; return; }
    this.moveGoal = { x: lead.x, y: lead.y, tol: 200 };
    if (this.dist(lead) < 240) this.redecide = true;
  }
  pickRevive() {
    const p = this.p;
    let best = null, bd = 1500;
    for (const o of this.mates) {
      if (!o.downed) continue;
      const d = this.dist(o);
      if (d >= bd) continue;
      // The closest standing teammate goes; a bot does not leave a human to do it alone.
      let closer = false;
      for (const m of this.mates) {
        if (m === o || m.downed || !m.bot || Math.hypot(m.x - o.x, m.y - o.y) >= d - 1) continue;
        const ai = m.ai;
        if (!ai || ai.reviving === o || (ai.mode !== 'fight' && ai.mode !== 'flee')) closer = true;   // (one in a firefight is not coming)
      }
      if (closer && d > 260) continue;
      best = o; bd = d;
    }
    if (!best) { this.reviving = null; return false; }
    if (this.hpFrac() < 0.3 && this.now - this.hurtAt < 1.5) return false; // would only die next to them
    this.reviving = best;
    return true;
  }
  doRevive() {
    const o = this.reviving, p = this.p;
    if (!o || !o.alive || !o.downed) { this.reviving = null; this.redecide = true; return; }
    const d = this.dist(o), e = this.target, now = this.now;
    if (e && (e.visible || now - e.hurtMeAt < 4 || now - e.shotAtMeAt < 3)) {
      // Someone is shooting: kneel on their side of the teammate, so the bullets (and a raised shield) stop at us.
      const dx = e.x - o.x, dy = e.y - o.y, dd = Math.hypot(dx, dy) || 1, sx = o.x + dx / dd * 46, sy = o.y + dy / dd * 46;
      if (Math.hypot(sx - p.x, sy - p.y) > 16 && this.nav.freeAt(sx, sy)) this.moveGoal = { x: sx, y: sy, tol: 10 };
      else if (d > 62) this.moveGoal = { x: o.x, y: o.y, tol: 50 };
      else this.still = true;
    } else if (d > 62) this.moveGoal = { x: o.x, y: o.y, tol: 50 };
    else this.still = true;
    if (d < 88) this.out.iv = true;
    if (!e) this.look = o;
  }
  thinkDowned() {
    // Crawl toward whoever can pick us up; failing that, away from the people shooting.
    const p = this.p;
    this.act = null; this.queue.length = 0; this.fleeing = null;
    let mate = null, bd = 1400;
    for (const o of this.mates) if (!o.downed) { const d = this.dist(o); if (d < bd) { bd = d; mate = o; } }
    if (mate) { if (bd > 60) this.moveGoal = { x: mate.x, y: mate.y, tol: 50 }; return; }
    const e = this.nearestKnown(700);
    if (e) { const d = this.dist(e) || 1; this.moveDir = { x: (p.x - e.x) / d, y: (p.y - e.y) / d }; }
  }
  nearestKnown(range) {
    let best = null, bd = range;
    for (const rec of this.known.values()) { if (!rec.noticed || rec.dropping) continue; const d = this.dist(rec); if (d < bd) { bd = d; best = rec; } }
    return best;
  }

  // ---------------------------------------------------------------- feet
  planRoute(g, d) {
    const p = this.p, nav = this.nav, opts = { avoid: this.avoid.length ? this.avoid : null, dry: true };
    if (d < 900 && nav.segmentClear(p.x, p.y, g.x, g.y, opts)) return (this.route = { gx: g.x, gy: g.y, pts: [{ x: g.x, y: g.y }], i: 0, partial: false, at: this.now, cut: 0, blocked: 0 });
    const res = nav.findPath(p.x, p.y, g.x, g.y, { avoid: opts.avoid, maxNodes: d > 2500 ? 3200 : 2400 });
    if (res === undefined) return this.route && Math.hypot(this.route.gx - g.x, this.route.gy - g.y) < 400 ? this.route : null; // out of search budget this tick
    if (!res) { this.noWay = { x: g.x, y: g.y, at: this.now }; return (this.route = null); }
    if (res.partial) {
      // A partial path that ends where the last one did, with us already there, is a dead end (a crate in the only doorway, say).
      const end = res.points[res.points.length - 1], was = this.lastPartial;
      if (was && Math.hypot(end.x - was.x, end.y - was.y) < 48 && Math.hypot(end.x - p.x, end.y - p.y) < 70) { this.noWay = { x: g.x, y: g.y, at: this.now }; this.lastPartial = null; return (this.route = null); }
      this.lastPartial = end;
    }
    return (this.route = { gx: g.x, gy: g.y, pts: res.points, i: 0, partial: res.partial, at: this.now, cut: 0, blocked: 0 });
  }
  follow(g) {
    const p = this.p, nav = this.nav, d = Math.hypot(g.x - p.x, g.y - p.y);
    if (d <= (g.tol || 24)) return null;
    let r = this.route;
    const stale = !r || Math.hypot(r.gx - g.x, r.gy - g.y) > Math.max(40, d * 0.12) || this.now - r.at > 7;
    if (stale || r.i >= r.pts.length) {
      if (this.now < this.routeHold) return null;          // a search just failed or was put off: do not hammer the pathfinder
      r = this.planRoute(g, d);
      if (!r) {
        this.routeHold = this.now + this.rng.range(0.3, 0.7);
        // No way from this exact spot: shuffle a step in any open direction and try again from there.
        if (this.noWay && this.noWay.at === this.now) { const v = this.safeDir(Math.cos(this.rng.range(0, TAU)), Math.sin(this.rng.range(0, TAU))); if (v) this.unstick = { x: v.x, y: v.y, until: this.now + 0.3 }; }
        return null;
      }
    }
    const pts = r.pts, last = pts.length - 1;
    while (r.i < last && Math.hypot(pts[r.i].x - p.x, pts[r.i].y - p.y) < 30) r.i++;
    if (this.now >= r.cut) {
      r.cut = this.now + 0.25;
      const opts = { avoid: this.avoid.length ? this.avoid : null, dry: true };
      let jumped = false;
      for (let k = Math.min(last, r.i + 3); k > r.i; k--) if (nav.segmentClear(p.x, p.y, pts[k].x, pts[k].y, opts)) { r.i = k; jumped = true; break; }
      if (!jumped && !nav.segmentClear(p.x, p.y, pts[r.i].x, pts[r.i].y)) { if (++r.blocked >= 2) { this.route = null; return null; } } else r.blocked = 0;
    }
    const t = pts[r.i], td = Math.hypot(t.x - p.x, t.y - p.y);
    if (r.i === last && td < 16) {
      if (r.partial) { this.route = null; return null; }
      // The path ends in the middle of the nearest free cell; the goal itself can be a few steps on, close to a wall.
      if (d > Math.max(16, g.tol || 24) && nav.segmentClear(p.x, p.y, g.x, g.y)) return { x: (g.x - p.x) / d, y: (g.y - p.y) / d };
      return null;
    }
    return { x: (t.x - p.x) / td, y: (t.y - p.y) / td };
  }
  // A direction that does not walk into a wall, a pond or a danger zone; null when there is none.
  safeDir(vx, vy, reach) {
    const p = this.p, nav = this.nav, len = Math.hypot(vx, vy);
    if (len < 1e-6) return null;
    vx /= len; vy /= len;
    const step = reach || 64, base = Math.atan2(vy, vx);
    for (const off of [0, 0.7, -0.7, 1.4, -1.4]) {
      const a = base + off, x = p.x + Math.cos(a) * step, y = p.y + Math.sin(a) * step;
      if (!nav.freeAt(x, y) || (nav.pondAt(x, y) && !p.inPond)) continue;
      let bad = false;
      for (const h of this.hazards) if (Math.hypot(x - h.x, y - h.y) < h.r && h.d >= h.r) { bad = true; break; }
      if (!bad) return { x: Math.cos(a), y: Math.sin(a) };
    }
    return null;
  }
  steer() {
    const p = this.p, out = this.out, now = this.now;
    let v = null;
    if (this.evade && !p.mount) {
      const e = this.evade, d = Math.hypot(e.x - p.x, e.y - p.y);
      if ((e.path || e.blind) && this.unstick && now < this.unstick.until) v = this.unstick;   // wedged on the way out: wriggle
      else if (e.path) v = this.follow({ x: e.x, y: e.y, tol: 8 });
      else v = d > 8 ? { x: (e.x - p.x) / d, y: (e.y - p.y) / d } : null;
    } else if (this.freeze) v = null;
    else if (this.unstick && now < this.unstick.until) v = this.unstick;
    else if (this.moveDir) v = this.moveDir;
    else if (this.moveGoal && !this.still && now >= this.pauseUntil) {
      v = this.follow(this.moveGoal);
      // Running from someone who can see us: never in a straight line.
      if (v && this.mode === 'flee' && this.fleeing && this.fleeing.exposed && !this.fleeing.calm) {
        if (now >= this.zigAt) { this.zig = -(this.zig || 1); this.zigAt = now + this.rng.range(0.3, 0.7); }
        const z = this.safeDir(v.x - v.y * this.zig * 0.6, v.y + v.x * this.zig * 0.6);
        if (z) v = z;
      }
    }
    if (v && !this.evade) {
      // Do not step into a danger zone we are standing outside of: slide along its rim instead.
      for (const h of this.hazards) {
        if (h.d < h.r) continue;
        const nx = p.x + v.x * 60 - h.x, ny = p.y + v.y * 60 - h.y;
        if (Math.hypot(nx, ny) >= h.r) continue;
        const rx = (p.x - h.x) / (h.d || 1), ry = (p.y - h.y) / (h.d || 1), inward = v.x * rx + v.y * ry;
        if (inward < 0) { v = { x: v.x - rx * inward, y: v.y - ry * inward }; const l = Math.hypot(v.x, v.y); if (l > 0.05) { v.x /= l; v.y /= l; } else v = null; }
        if (!v) break;
      }
    }
    if (v) {
      // A little personal space, so bots do not walk through each other's shoulders.
      let sx = 0, sy = 0;
      for (const o of this.mates) { const d = this.dist(o); if (d < 58 && d > 0.1) { sx += (p.x - o.x) / d * 0.5; sy += (p.y - o.y) / d * 0.5; } }
      // Strangers we are not fighting get a wide berth: nobody walks shoulder to shoulder with an armed enemy.
      // Out in the open only: indoors there is no room for it (a few strangers would pin each other to the walls),
      // and a bot that has been hemmed in for a while stops being polite and walks where its path says.
      const here = this.cover.info.get(p.id);
      if (this.mode !== 'fight' && this.mode !== 'flee' && !this.evade && now >= this.shove && !(here && here.building >= 0)) {
        for (const r of this.known.values()) {
          if (!r.noticed || !r.visible || r.downed || r.dropping) continue;
          const d = this.dist(r);
          if (d < 300 && d > 0.1) { const k = (300 - d) / 300 * 1.6; sx += (p.x - r.x) / d * k; sy += (p.y - r.y) / d * k; }
        }
      }
      out.mx = v.x + sx; out.my = v.y + sy;
    }
    // Stuck? (wanting to move, not moving)
    const st = this.stuck;
    if (now - st.at >= 0.5) {
      const moved = Math.hypot(p.x - st.x, p.y - st.y), trying = !!v && !p.mount && !p.downed;
      if (trying && moved < 9) {
        st.n++;
        this.route = null; this.coverSpot = null;
        if (st.n >= 2) { const a = this.rng.range(0, TAU); this.unstick = { x: Math.cos(a), y: Math.sin(a), until: now + 0.35 }; }
        if (st.n >= 5) { st.n = 0; this.shove = now + 4; this.giveUp(); }
      } else if (moved > 30 || !trying) st.n = 0;
      st.x = p.x; st.y = p.y; st.at = now;
    }
  }
  // Whatever we were walking to cannot be reached: forget it for a while.
  giveUp() {
    if (this.mode === 'loot' && this.loot) { this.badLoot.set(this.loot.key, this.now + 25); this.loot = null; }
    if (this.mode === 'upgrade' && this.station) { this.badStation.set(this.station.st.id, this.now + 30); this.station = null; }
    if (this.mode === 'explore' && this.explore) { this.foundIn(this.explore.index); this.explore = null; }
    this.roam = null; this.coverSpot = null; if (this.fleeing) this.fleeing.spot = null;
    this.redecide = true;
  }

  // ---------------------------------------------------------------- eyes and trigger
  aim() {
    const p = this.p, out = this.out, prof = this.prof, dt = this.dt, U = this.W.U;
    const mount = p.mount ? this.world.structById(p.mount) : null, ox = mount ? mount.x : p.x, oy = mount ? mount.y : p.y;
    if (this.clickAt) {
      // A deliberate click (throwing, placing, calling a strike): the hand jumps there.
      const c = this.clickAt;
      this.aimA = Math.atan2(c.y - oy, c.x - ox);
      out.aimX = c.x; out.aimY = c.y;
      return;
    }
    const s = this.shoot;
    let tx, ty, tau = 0.22, wobble = 0.5;
    if (s) {
      const rec = s.rec, def = s.def;
      tx = rec ? rec.x : s.x; ty = rec ? rec.y : s.y;
      if (rec) {
        // Eyes stay on a target that is on screen; how far the crosshair trails it is the aim lag below.
        const o = rec.visible && rec.ref.alive ? rec.ref : rec;
        tx = o.x; ty = o.y;
        const speed = def.bulletSpeed || def.projectileSpeed || 0, d = Math.hypot(tx - ox, ty - oy);
        const lead = speed ? (d / speed + (def.landFuse || 0)) * prof.lead : 0;
        tx += o.vx * lead; ty += o.vy * lead;
        tau = prof.aimTau;
        const id = rec.id;
        if (this.aimId !== id) { this.aimId = id; this.aimOn = 0; this.triggerAt = this.now + prof.triggerDelay * this.rng.range(0.7, 1.3); }
        this.aimOn += dt;
        wobble = (1.25 - 0.5 * Math.min(1, this.aimOn / 1.2)) * (this.now - this.hurtAt < 0.35 ? 1.5 : 1) * (out.mx || out.my ? 1.15 : 0.9) * (mount ? 1.25 : 1);
      } else { tau = 0.1; wobble = 0.4; this.aimId = 0; }
    } else {
      this.aimId = 0; this.aimOn = 0;
      if (this.look) { tx = this.look.x; ty = this.look.y; }
      else if (out.mx || out.my) { tx = p.x + out.mx * 200; ty = p.y + out.my * 200; tau = 0.3; }
      else { tx = ox + Math.cos(this.aimA) * 200; ty = oy + Math.sin(this.aimA) * 200; }
    }
    if (p.fx.flash > 0.4) wobble *= 4;
    const want = Math.atan2(ty - oy, tx - ox), maxStep = prof.turnRate * dt;
    // Tracking: the hand matches the target's sweep across the screen (as well as this bot can) and closes the rest
    // of the gap with a lag. The sweep it matches is a smoothed estimate, so every time the target changes direction
    // the crosshair first carries on the old way and then has to come back: strafing works against bots.
    let feed = 0;
    if (s && s.rec && this.aimWantId === s.rec.id) {
      const sweep = clamp(U.angleDiff(this.aimWant, want) / dt, -6, 6);
      this.aimV += (sweep - this.aimV) * (1 - Math.exp(-dt / prof.trackTau));
      feed = this.aimV * prof.track * dt;
    } else this.aimV = 0;
    this.aimWant = want; this.aimWantId = s && s.rec ? s.rec.id : 0;
    this.aimA += feed;
    this.aimA += clamp(U.angleDiff(this.aimA, want) * (1 - Math.exp(-dt / tau)), -maxStep, maxStep);
    const sigma = prof.aimSigma * wobble * (1 + 0.4 * Math.abs(this.aimV)), corr = 0.38; // a fast sweep is a shaky sweep
    this.aimN += -this.aimN / corr * dt + sigma * Math.sqrt(2 * dt / corr) * this.gauss();
    const a = this.aimA + this.aimN, d = clamp(Math.hypot(tx - ox, ty - oy), 60, 2800);
    out.aimX = ox + Math.cos(a) * d; out.aimY = oy + Math.sin(a) * d;
    if (s) this.pullTrigger(s, a, want, Math.hypot(tx - ox, ty - oy));
  }

  pullTrigger(s, a, want, dist) {
    const p = this.p, out = this.out, prof = this.prof, now = this.now, def = s.def, U = this.W.U;
    if (this.act || this.gearCharge || p.held >= 0 || now < this.triggerAt || !def) return;
    const err = Math.abs(U.angleDiff(a, want));
    const cone = Math.atan2((s.rec ? p.r : s.r || 20) + 12, Math.max(40, dist)) * prof.sprayLoose;
    const on = err < cone;
    if (def.windup) {
      // Minigun: keep it spinning while the target is roughly in front.
      if (err < cone * 3 || (p.minigunSpin || 0) > 0) out.fire = true;
      return;
    }
    if (def.kind === 'flame') { if (dist < def.range + 20 && err < def.halfAngle * 0.8) out.fire = true; return; }
    if (on) this.sprayUntil = now + (1.1 - prof.skill) * 0.3;
    if (def.kind === 'launcher') {
      const w = p.weapons[p.slot];
      if (w.id !== def.id || w.reloading || w.ammo <= 0 || w.cooldown > 0 || now < this.nextTap || out.slot !== null || out.swap) return;
      const target = s.rec ? s.rec.ref : s.crate || s.struct;
      if (!this.launchCharge || this.launchCharge.weapon !== def.id || this.launchCharge.target !== target) this.launchCharge = { at: now, weapon: def.id, target };
      this.launchRequested = true;
      const required = this.projectileChargeAtDistance(def.id, dist);
      if (now - this.launchCharge.at + 1e-8 < required || (!on && now >= this.sprayUntil)) return;
      out.charge = Math.min(this.W.CONFIG.projectileChargeTime, now - this.launchCharge.at);
      out.firePressed = true;
      this.launchCharge = null;
      this.nextTap = now + def.fireInterval + this.rng.range(0.04, 0.3) * prof.hesitation;
      return;
    }
    if (!on && now >= this.sprayUntil) { if (def.zoom) this.aimHold = 0; return; }
    if (def.semiAuto) {
      if (now >= this.nextTap) { out.firePressed = true; this.nextTap = now + def.fireInterval + this.rng.range(0.04, 0.3) * prof.hesitation; }
      return;
    }
    if (def.zoom && !p.mount) {
      // Sniper rifles: line the shot up first.
      this.aimHold = (this.aimHold || 0) + this.dt;
      if (this.aimHold < lerp(0.85, 0.3, prof.skill)) return;
      if (p.weapons[p.slot].ammo <= 1) this.aimHold = 0;
    }
    out.fire = true;
  }

  // Reload when it is quiet, put an item away, scope while scanning.
  handleWeapon() {
    const p = this.p, out = this.out, now = this.now, w = p.weapons[p.slot], def = this.W.WEAPONS[w.id];
    if (this.act) return;
    if (p.held >= 0) { if (!this.holding && now >= this.itemAt) out.slot = p.slot; return; }
    if (def.mag && !w.reloading && w.ammo < def.mag && !this.shoot && now >= this.reloadAt) {
      const quiet = !this.target || !this.target.visible;
      if (w.ammo === 0 || (quiet && w.ammo < def.mag * (0.35 + this.prof.skill * 0.35))) { out.reload = true; this.reloadAt = now + 1; }
    }
    if (def.zoom && !this.act) {
      const e = this.target;
      if (e && this.mode === 'fight') out.scope = this.dist(e) > 520;
      else if (this.mode === 'roam' || this.mode === 'hunt') out.scope = (this.scopeScan = (this.scopeScan + this.dt) % 6) < 2.2; // look around through the scope now and then
    }
  }
}

export { freshIntent, TAU };
