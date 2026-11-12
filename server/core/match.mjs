// One running match: the authoritative World at 20 Hz, player inputs, interest-managed snapshots,
// event replication, placements, spectating, reconnection and the end-of-match sequence.
// Players connect with a per-slot ticket; a `conn` is { open, sendText(text), sendJson(obj), close(code, reason), bufferedAmount }.
// Team members marked `bot` have no connection: a BotDirector plays them through the same World as everyone else.
import { newToken } from './auth.mjs';
import { BotDirector, makeNames } from './bots/index.mjs';

export const TICK = 1 / 20;
const VIEW = 3600;          // includes the wider level-two sniper scope
const AFK_KILL = 25;        // seconds a disconnected body stays before it is removed
const END_LINGER = 12;      // seconds the result screen stays before teardown
const EMPTY_TIMEOUT = 10;   // seconds without any connected player before an early end (see checkEnd for who is still waited for)
const INPUT_RATE = 60;      // inputs per second per player
export const COLORS = [
  ['#2f9bff', '#1c6cbd'], ['#f14e54', '#b23a3f'], ['#00b06d', '#007d4e'], ['#be7ff5', '#8a59b8'], ['#ffb43a', '#c4861d'],
  ['#ff7ab8', '#c2578a'], ['#3fd1c8', '#2a958e'], ['#9ccc3d', '#6f9628'], ['#ff8c42', '#c2661f'], ['#5ee7ff', '#2aa6bf'],
  ['#e8536a', '#a83348'], ['#86ea64', '#46b52f'], ['#ffd95a', '#f0a81c'], ['#a2a6ff', '#6a6fd6'], ['#ffa9ca', '#d16a92']
];

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function idleInput() { return { seq: 0, mx: 0, my: 0, sp: false, a: 0, d: 400, f: false, fp: false, ch: 0, sc: false, r: false, sl: null, cy: 0, sw: false, u: false, uch: 0, iv: false, ht: null, ip: false, dp: false }; }

// Held controls use the newest packet; button presses must survive when older packets are superseded.
function carryPresses(older, newer) {
  if (older.fp && !newer.fp) newer.ch = older.ch;
  if (older.u && !newer.u) newer.uch = older.uch;
  newer.fp = newer.fp || older.fp; newer.r = newer.r || older.r; newer.sw = newer.sw || older.sw; newer.u = newer.u || older.u; newer.ip = newer.ip || older.ip; newer.dp = newer.dp || older.dp;
  if (newer.sl === null) newer.sl = older.sl;
  if (newer.ht === null) newer.ht = older.ht;
  newer.cy += older.cy;
}

export class Match {
  // `clock: false` leaves the 20 Hz timer off so tests can call tick() themselves; `emptyTimeout` is how long
  // a match with no connected player keeps running (bots alone do not keep it alive); `botSkill` (0..1) is how
  // good the bots in it are (0.5: the usual mix).
  constructor({ W, id, mode, teamSize, teams, seed, onEnd, log = console, clock = true, emptyTimeout = EMPTY_TIMEOUT, botSkill = 0.5 }) {
    this.W = W;
    this.id = String(id);
    this.mode = mode;
    this.teamSize = teamSize;
    this.seed = seed >>> 0;
    this.onEnd = onEnd;
    this.log = log;
    this.emptyTimeout = emptyTimeout;
    this.map = W.MapGen.generate(this.seed, teamSize);
    this.world = new W.World({ map: this.map, teams: teamSize > 1 });
    this.classIndex = W.CLASS_ORDER;
    this.itemIndex = W.ITEM_ORDER;
    this.fxKeys = W.FX_KEYS;
    this.initialPickupMax = this.map.nextPickupId - 1;
    this.gonePickups = new Set();
    this.players = [];
    this.slots = [];
    this.byId = new Map();
    this.byUser = new Map();
    this.byTicket = new Map();
    this.teamInfo = [];
    this.teamsAlive = teams.length;
    this.ended = false;
    this.endAt = 0;
    this.emptyT = 0;
    this.tickCount = 0;
    this.cosmeticsVersion = 0;
    this.aliveCount = 0;
    this.lastReal = Date.now();
    this.acc = 0;
    this.started = Date.now();

    // Bots get names nobody in the lobby is using.
    const botSeats = [];
    teams.forEach((team) => team.members.forEach((m) => { if (m.bot) botSeats.push(m); }));
    if (botSeats.length) {
      const taken = [];
      teams.forEach((team) => team.members.forEach((m) => { if (!m.bot && m.name) taken.push(m.name); }));
      const names = makeNames(W.U.rng((this.seed ^ 0x2545f491) >>> 0), botSeats.length, taken);
      botSeats.forEach((m, i) => { if (!m.name) m.name = names[i]; });
      this.bots = new BotDirector({ W, world: this.world, seed: this.seed, teamSize, log, level: botSkill });
    } else this.bots = null;

    const drops = W.U.rng(this.seed ^ 0x1234567).shuffle(this.map.drops.slice());
    // Assign shared pads fairly without changing roster/ticket order. A 50-player
    // Trio/Squad lobby may include one partial team beyond the 16/12 drop pads.
    const assignedDrops = W.U.rng(this.seed ^ 0x7f4a7c15).shuffle(teams.map((team, ti) => drops[ti % drops.length]));
    const anchors = this.spawnAnchors(teams, assignedDrops);
    teams.forEach((team, ti) => {
      const drop = assignedDrops[ti], color = COLORS[ti % COLORS.length], at = anchors[ti];
      const info = { index: ti + 1, alive: true, placement: null, players: [] };
      this.teamInfo.push(info);
      team.members.forEach((m, mi) => {
        const a = (mi / Math.max(1, team.members.length)) * Math.PI * 2, off = team.members.length > 1 ? 36 : 0;
        const p = this.world.addPlayer({
          name: m.name, x: at.x + Math.cos(a) * off, y: at.y + Math.sin(a) * off,
          color: color[0], outline: color[1], drop: true, team: ti + 1, angle: -Math.PI / 2, bot: !!m.bot
        });
        p.user = m.userKey || null;
        p.dropLabel = drop.label;
        p.teamInfo = info;
        p.net = { conn: null, inputs: [], held: idleInput(), ack: 0, afk: 0, specId: 0, placement: null, left: false, killerId: 0, rate: { at: 0, n: 0 } };
        if (m.bot) this.bots.add(p);
        else p.controller = () => this.pullInput(p);
        info.players.push(p);
        this.players.push(p);
        this.byId.set(p.id, p);
        if (p.user) this.byUser.set(p.user, p);
        // Every seat keeps its place in `slots` (the hub lines tickets up with its member list); only humans can claim one.
        const ticket = m.bot ? null : newToken(16);
        this.slots.push({ index: this.slots.length, player: p, ticket, userKey: p.user, name: p.name, bot: !!m.bot });
        if (ticket) this.byTicket.set(ticket, p);
      });
    });
    this.running = true;
    this.timer = clock ? setInterval(() => this.pump(), 10) : null;
  }

  // Keep every landing on the coastal contour. Generator reservations include
  // these separate team footprints, even with 50 no-fill parties in team modes.
  spawnAnchors(teams, assignedDrops) {
    const totals = new Map(), used = new Map();
    assignedDrops.forEach(drop => totals.set(drop.id, (totals.get(drop.id) || 0) + 1));
    return teams.map((team, ti) => {
      const drop = assignedDrops[ti], n = totals.get(drop.id), k = used.get(drop.id) || 0;
      used.set(drop.id, k + 1);
      if (n === 1) return { x: drop.x, y: drop.y };
      return this.W.MapGen.edgePoint(drop.edgeDistance + (k - (n - 1) / 2) * 500, this.W.CONFIG.dropCoastInset);
    });
  }

  broadcast(msg) {
    const text = JSON.stringify(msg);
    for (const p of this.players) if (p.net.conn && p.net.conn.open) p.net.conn.sendText(text);
  }
  send(conn, msg) { if (conn && conn.open) conn.sendJson(msg); }

  // ---------------------------------------------------------------- connections
  claim(ticket, conn) {
    const p = this.byTicket.get(String(ticket || ''));
    if (!p || this.ended) return null;
    const rejoin = p.net.everConnected;
    this.attach(p, conn, rejoin && p.net.left === false);
    return p;
  }

  ticketFor(userKey) {
    const p = this.byUser.get(userKey);
    if (!p || this.ended || p.net.left) return null;
    for (const s of this.slots) if (s.player === p) return s.ticket;
    return null;
  }

  startMessage(p, rejoin) {
    return {
      t: 'match-start', id: this.id, seed: this.seed, mode: this.mode, teamSize: this.teamSize, you: p.id, team: p.team,
      drop: p.dropLabel, rejoin: !!rejoin, time: r3(this.world.time), teams: this.teamInfo.length,
      cosmetics: this.cosmeticLook(p),
      players: this.players.map((o) => ({ id: o.id, name: o.name, team: o.team, color: o.color, outline: o.outline, face: o.face, emote: this.encodeEmote(o) }))
    };
  }

  attach(p, conn, rejoin) {
    if (p.net.conn && p.net.conn !== conn) { const old = p.net.conn; this.detach(old); old.close(4409, 'replaced'); }
    p.net.conn = conn;
    p.net.afk = 0;
    p.net.everConnected = true;
    p.net.itemsKey = ''; // resend the hotbar with the next snapshot
    p.net.lookVersion = -1; p.net.cosmeticsKey = ''; p.net.cosmeticsSet = false;
    conn.player = p;
    this.send(conn, this.startMessage(p, rejoin));
    if (rejoin) {
      this.send(conn, this.syncMessage());
      if (p.net.placement && !this.ended) this.send(conn, { t: 'eliminated', placement: p.net.placement, of: this.teamInfo.length, players: this.players.length, stats: this.stats(p), cause: 'rejoin' });
    }
  }

  detach(conn) {
    const p = conn.player;
    if (p && p.net.conn === conn) p.net.conn = null;
    conn.player = null;
  }

  leave(conn) {
    const p = conn.player;
    this.detach(conn);
    if (!p) return;
    p.net.left = true;
    if (p.alive) this.world.killPlayer(p, null, 'left');
  }

  onMessage(conn, text) {
    const p = conn.player;
    if (!p) return;
    let m;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'cosmetics': {
        // Locker choices are submitted once per connection, not continuously during combat.
        if (p.net.cosmeticsSet || !m.value || typeof m.value !== 'object' || Array.isArray(m.value)) return;
        p.net.cosmeticsSet = true;
        this.world.applyCosmetics(p, m.value);
        this.cosmeticsVersion++;
        return;
      }
      case 'emote': this.world.useEmote(p, m.slot); return;
      case 'sentry-choice':
        this.world.chooseSentryUpgrade(p, m.variant === null ? null : str(m.variant, 16));
        return;
      case 'in': {
        const now = Date.now(), rate = p.net.rate;
        if (now - rate.at >= 1000) { rate.at = now; rate.n = 0; }
        if (++rate.n > INPUT_RATE) return;
        this.handleInput(p, m);
        return;
      }
      case 'upgrade': {
        const cls = str(m.cls, 20), r = p.nearStation ? this.world.upgrade(p, p.nearStation, cls) : { ok: false, reason: 'far' };
        this.send(conn, { t: 'upgrade-result', ok: !!r.ok, reason: r.reason, usedKey: !!r.usedKey, cls });
        return;
      }
      case 'leave': this.leave(conn); return;
      case 'ping': this.send(conn, { t: 'pong', c: m.c, s: Date.now() }); return;
      default: return;
    }
  }

  syncMessage() {
    const map = this.map;
    return {
      t: 'sync', time: r3(this.world.time),
      crates: map.crates.filter((c) => c.hp < c.maxHp || !c.alive).map((c) => [c.id, c.alive ? Math.max(1, Math.ceil(c.hp)) : 0]),
      gone: [...this.gonePickups],
      rocks: map.rocks.filter((rock) => rock.alive === false).map((rock) => rock.id),
      strikes: this.world.strikes.map((s) => ({ id: s.id, k: s.kind, x: s.x, y: s.y, tg: s.target, tl: s.t, o: s.owner, tm: s.team, r: s.radius, dm: s.damage })),
      added: map.pickups.filter((pk) => pk.alive && pk.id > this.initialPickupMax).map((pk) => ({ id: pk.id, type: pk.type, it: pk.item || undefined, x: r1(pk.x), y: r1(pk.y), n: pk.amount, lk: r2(pk.lockT || 0) })),
      stations: map.stations.filter((s) => s.cooldown > 0).map((s) => [s.id, r1(s.cooldown)]),
      players: this.players.map((o) => [o.id, this.classIndex.indexOf(o.classId), o.alive ? 1 : 0, o.downed ? 1 : 0, r1(o.x), r1(o.y), o.vehicle || 0, o.vehicleSeat || null, o.vehicleWeapon || 0, o.repairVehicle || 0, this.encodeSentryBuild(o)]),
      looks: this.players.map((o) => [o.id, o.color, o.face]),
      emotes: this.players.map((o) => [o.id, this.encodeEmote(o)]),
      vehicles: (this.world.vehicles || []).map((v) => this.encodeVehicle(v)),
      tankShells: (this.world.tankShells || []).map((shell) => this.encodeTankShell(shell)),
      sentryProjectiles: (this.world.sentryProjectiles || []).map((shell) => this.encodeSentryProjectile(shell)),
      rpgRockets: (this.world.rpgRockets || []).map((rocket) => this.encodeRpgRocket(rocket)),
      structs: this.world.structures.filter((s) => s.alive).map((s) => this.encodeStruct(s)),
      zones: this.world.zones.map((z) => this.encodeZone(z)),
      storm: this.stormMessage()
    };
  }

  encodeStruct(s) {
    return { id: s.id, k: s.kind, it: s.item, x: r1(s.x), y: r1(s.y), r: s.r, o: s.owner || 0, tm: s.team, hp: Math.round(s.hp), mhp: s.maxHp, a: r2(s.angle), m: s.mounted || 0, pr: s.pair || 0 };
  }
  encodeSentryProjectile(p) {
    const row = [p.id, p.kind, p.owner, p.team, p.sentry, r2(p.x), r2(p.y), p.dx, p.dy, p.r, p.speed, r2(p.traveled), p.range, r3(p.age)];
    if (p.kind === 'grenades') row.push([p.startX, p.startY, p.targetX, p.targetY, p.flightTime, p.peakHeight, p.z, p.flightElapsed]);
    return row;
  }
  encodeSentryStatus(p) {
    const now = this.world.time, snow = (p.sentrySnow || []).filter(t => t > now).map(t => r3(t - now));
    const freeze = Math.max(0, (p.sentryFreezeUntil || 0) - now), b = p.sentryBurn;
    return snow.length || freeze || (b && b.until > now) ? { snow, freeze: r3(freeze), burn: b && b.until > now ? [r3(b.until - now), r3(b.next - now), b.owner] : null } : null;
  }
  encodeRpgRocket(p) {
    return { id: p.id, owner: p.owner, team: p.team, x: r2(p.x), y: r2(p.y), dx: p.dx, dy: p.dy,
      r: p.r, speed: p.speed, range: p.range, traveled: r2(p.traveled || 0), age: r3(p.age || 0) };
  }
  encodeSentryWork(p) {
    const w = p.sentryWork;
    return w ? { struct: w.struct, kind: w.kind, elapsed: r3(w.elapsed), total: w.total, cost: w.cost, next: w.next, variant: w.variant } : null;
  }
  cosmeticLook(p) { return { color: p.color, face: p.face, emotes: p.emotes.slice() }; }
  encodeEmote(p) {
    return p.alive && !p.downed && p.emote && p.emote.until > this.world.time
      ? [p.emote.id, r3(p.emote.until - this.world.time)] : null;
  }
  encodeZone(z) {
    return { id: z.id, k: z.kind, x: r1(z.x), y: r1(z.y), r: z.r, dur: z.dur, tl: r1(z.t), o: z.owner || 0, tm: z.team, dps: z.dps };
  }
  encodeVehicle(v) {
    const row = { id: v.id, type: v.type || 'humvee', x: r2(v.x), y: r2(v.y), vx: r2(v.vx), vy: r2(v.vy), a: r3(v.angle),
      hp: r2(v.hp), mhp: v.maxHp, wreck: !!v.wreck, armed: !!v.armed, ga: r3(v.gunAngle || 0), ss: this.encodeSentryStatus(v),
      seats: ['driver', 'gunner', 'rearLeft', 'rearRight'].map((seat) => v.seats[seat] || 0) };
    if (v.type === 'tank') Object.assign(row, { ca: r3(v.cannonAngle || 0), cc: r3(v.cannonCooldown || 0),
      cn: v.cannonAmmo, cm: v.cannonMaxAmmo, cr: r3(v.cannonReload || 0),
      cd: r3(v.cooldown || 0), ma: v.mgAmmo, mr: r3(v.mgReload || 0) });
    return row;
  }
  encodeTankShell(shell) {
    return { id: shell.id, owner: shell.owner, team: shell.team, vehicle: shell.vehicle,
      x: r2(shell.x), y: r2(shell.y), dx: r3(shell.dx), dy: r3(shell.dy), speed: shell.speed,
      range: shell.range, traveled: r2(shell.traveled || 0), r: shell.r, damageMul: shell.damageMul === undefined ? 1 : shell.damageMul };
  }

  // ---------------------------------------------------------------- inputs
  handleInput(p, m) {
    const q = p.net.inputs;
    const input = {
      seq: num(m.s, 0, 1e9, 0) | 0, mx: num(m.mx, -1, 1, 0), my: num(m.my, -1, 1, 0), a: num(m.a, -10, 10, 0), d: num(m.d, 40, 3000, 400),
      sp: m.sp === true,
      f: !!m.f, fp: !!m.fp, sc: !!m.sc, r: !!m.r, sl: (m.sl === 0 || m.sl === 1 || m.sl === 2) ? m.sl : null,
      ch: num(m.ch, 0, this.W.CONFIG.projectileChargeTime, 0), uch: num(m.uch, 0, this.W.CONFIG.projectileChargeTime, 0),
      cy: num(m.cy, -3, 3, 0) | 0, sw: !!m.sw, u: !!m.u, iv: !!m.iv,
      ht: Number.isInteger(m.ht) && m.ht >= -1 && m.ht < this.W.CONFIG.hotbarSize ? m.ht : null, ip: !!m.ip, dp: !!m.dp
    };
    q.push(input);
    // Bound packets arriving between ticks, while retaining their button presses.
    while (q.length > 6) {
      const dropped = q.shift(), next = q[0];
      carryPresses(dropped, next);
    }
  }

  pullInput(p) {
    const q = p.net.inputs;
    let input;
    if (q.length) {
      // A delayed burst must not leave every later command stuck behind stale movement. The world has
      // already advanced using held input while packets were in transit; apply the latest controls on
      // this tick, acknowledge them, and preserve any one-shot actions from the burst.
      while (q.length > 1) carryPresses(q.shift(), q[0]);
      input = q.shift();
      p.net.ack = input.seq;
      p.net.held = Object.assign({}, input, { fp: false, ch: 0, r: false, sw: false, u: false, uch: 0, sl: null, cy: 0, ht: null, ip: false, dp: false });
    } else input = p.net.held;
    const ca = Math.cos(input.a), sa = Math.sin(input.a);
    return {
      mx: input.mx, my: input.my, sprint: input.sp, aimX: p.x + ca * input.d, aimY: p.y + sa * input.d,
      fire: input.f, firePressed: input.fp, charge: input.ch, utilityCharge: input.uch, scope: input.sc, reload: input.r, slot: input.sl,
      cycle: input.cy % p.weapons.length || (input.cy ? p.weapons.length : 0),
      swap: input.sw, utility: input.u, iv: input.iv, held: input.ht, interactPressed: input.ip, dropPressed: input.dp
    };
  }

  // ---------------------------------------------------------------- loop
  pump() {
    const now = Date.now();
    this.acc += Math.min(0.25, (now - this.lastReal) / 1000);
    this.lastReal = now;
    let n = 0;
    while (this.acc >= TICK && n++ < 4) { this.acc -= TICK; this.tick(); }
  }

  tick() {
    if (!this.running) return;
    const world = this.world;
    this.tickCount++;
    for (const p of this.players) {
      if (p.alive && !p.bot && !p.net.conn && !p.net.left) {
        p.net.afk += TICK;
        if (p.net.afk > AFK_KILL) { p.net.left = true; world.killPlayer(p, null, 'left'); }
      }
    }
    if (this.bots) this.bots.beforeTick(TICK);
    world.update(TICK);
    const events = world.events;
    world.events = [];
    if (this.bots) this.bots.observe(events);
    this.aliveCount = this.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
    for (const e of events) this.track(e);
    this.sendSnapshots(events);
    if (this.tickCount % 20 === 0) this.broadcast(this.stormMessage());
    if (!this.ended) this.checkEnd();
    else if (Date.now() >= this.endAt) this.destroy();
  }

  track(e) {
    if (e.type === 'collected') this.gonePickups.add(e.pickup.id);
    if (e.type === 'damage' && e.source && e.target.net) e.target.net.killerId = e.source.id;
    if (e.type === 'death') this.onDeath(e);
  }

  onDeath(e) {
    const p = e.victim, info = p.teamInfo;
    if (e.killer) p.net.killerId = e.killer.id;
    if (info.alive && !info.players.some((o) => o.alive)) {
      info.alive = false;
      info.placement = this.teamsAlive;
      this.teamsAlive--;
      for (const o of info.players) {
        o.net.placement = info.placement;
        this.send(o.net.conn, { t: 'eliminated', placement: info.placement, of: this.teamInfo.length, players: this.players.length, stats: this.stats(o), by: e.killer ? e.killer.name : null, cause: e.cause });
      }
    } else if (!p.net.placement) {
      this.send(p.net.conn, { t: 'spectating', stats: this.stats(p), by: e.killer ? e.killer.name : null, cause: e.cause });
    }
  }

  checkEnd() {
    const aliveTeams = this.teamInfo.filter((t) => t.alive);
    const connected = this.players.some((p) => p.net.conn && p.net.conn.open);
    this.emptyT = connected ? 0 : this.emptyT + TICK;
    // Nobody connected: wind up. But a player whose connection dropped mid-match is waited for as long as their body
    // stands (AFK_KILL), since with bots one player is usually the whole audience and may be about to come back.
    const awaited = !connected && this.players.some((p) => !p.bot && p.alive && !p.net.left && p.net.everConnected);
    const over = (aliveTeams.length <= 1 && (this.teamInfo.length > 1 || aliveTeams.length === 0)) || (this.emptyT > this.emptyTimeout && !awaited);
    if (!over) return;
    this.ended = true;
    this.endAt = Date.now() + END_LINGER * 1000;
    const winner = aliveTeams.length === 1 ? aliveTeams[0] : null;
    if (winner) { winner.placement = 1; winner.players.forEach((o) => { o.net.placement = 1; }); }
    const winners = winner ? winner.players.map((o) => o.name) : [];
    for (const p of this.players) {
      this.send(p.net.conn, { t: 'match-end', placement: p.net.placement, of: this.teamInfo.length, players: this.players.length, winners, won: !!winner && p.teamInfo === winner, stats: this.stats(p), time: r1(this.world.time) });
    }
  }

  destroy() {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const p of this.players) if (p.net.conn) { const c = p.net.conn; this.detach(c); c.close(1000, 'match over'); }
    if (this.onEnd) this.onEnd(this);
  }

  stats(p) {
    const s = p.stats;
    return { kills: s.kills, knocks: s.knocks, revives: s.revives, damage: Math.round(s.damage), tokens: s.tokens, upgrades: s.upgrades, crates: s.crates, shots: s.shots, healed: Math.round(s.healed), survived: r1(this.world.time), classId: p.classId };
  }

  stormMessage() {
    const s = this.world.storm;
    return {
      t: 'storm', x: r1(s.x), y: r1(s.y), r: r1(s.r), nx: s.next ? r1(s.next.x) : null, ny: s.next ? r1(s.next.y) : null, nr: s.next ? r1(s.next.r) : null,
      st: s.state, tl: r1(s.timeLeft), dps: s.dps, ph: s.phase, alive: this.aliveCount, teams: this.teamsAlive, time: r3(this.world.time)
    };
  }

  // ---------------------------------------------------------------- snapshots
  viewCenter(p) {
    if (p.alive) return p;
    let target = p.net.specId ? this.byId.get(p.net.specId) : null;
    if (!target || !target.alive) {
      target = p.teamInfo.players.find((o) => o.alive) || (p.net.killerId && this.byId.get(p.net.killerId)) || null;
      if (!target || !target.alive) target = this.players.find((o) => o.alive) || null;
      p.net.specId = target ? target.id : 0;
    }
    return target || p;
  }

  encodePlayer(o) {
    const flags = (o.alive ? 1 : 0) | (o.downed ? 2 : 0) | (o.scoping ? 4 : 0) | (o.weapons[o.slot] && o.weapons[o.slot].reloading ? 8 : 0) | (o.inStorm ? 16 : 0)
      | (o.mount ? 32 : 0) | (o.fx.invisible > 0 ? 64 : 0) | (o.shieldUp ? 128 : 0);
    const held = o.held >= 0 && o.items[o.held] ? this.itemIndex.indexOf(o.items[o.held].id) + 1 : 0;
    const row = [o.id, r1(o.x), r1(o.y), r2(o.angle), Math.ceil(o.hp), o.maxHp, this.classIndex.indexOf(o.classId), o.slot, flags, r2(o.dropT), o.downed ? r1(o.downT) : 0, o.downed ? r2(o.revive) : 0, held, r2(o.minigunSpin || 0), r1(o.commandBuff || 0), o.flameTicks || 0, o.vehicle || 0, o.vehicleSeat || null, o.vehicleWeapon || 0, o.repairVehicle || 0];
    const emote = this.encodeEmote(o);
    const build = this.encodeSentryBuild(o);
    const empty = o.held >= 0 && !o.items[o.held], status = this.encodeSentryStatus(o), work = this.encodeSentryWork(o);
    if (emote || build || empty || status || work) row.push(emote);
    if (build || empty || status || work) row.push(build);
    if (empty || status || work) row.push({ empty, status, work });
    return row;
  }

  encodeSentryBuild(p) {
    const b = p.sentryBuild;
    return p.alive && !p.downed && b ? [r3(b.elapsed), r1(b.x), r1(b.y)] : null;
  }

  encodeYou(p) {
    const you = {
      x: r2(p.x), y: r2(p.y), vx: r2(p.vx), vy: r2(p.vy), ack: p.net.ack, hp: Math.ceil(p.hp * 10) / 10, mhp: p.maxHp, ar: p.armor,
      stam: r3(p.stamina), exh: p.sprintExhausted, rest: r3(p.sprintRestT), spr: p.sprinting,
      tok: p.tokens, keys: p.keys, cls: this.classIndex.indexOf(p.classId), slot: p.slot,
      ammo: p.weapons.map((w) => w.ammo), rel: p.weapons.map((w) => (w.reloading ? r2(w.reloadT) : 0)), gren: p.grenades, med: r1(p.medkitCd),
      down: p.downed, downT: r1(p.downT), rev: r2(p.revive), sc: p.scoping, near: p.nearStation ? p.nearStation.id : -1,
      alive: p.alive, drop: r2(p.dropT), team: p.team, storm: p.inStorm,
      cmd: r1(p.commandCd || 0), cb: r1(p.commandBuff || 0), spin: r2(p.minigunSpin || 0), ft: p.flameTicks || 0,
      from: p.upgradeFrom || null, path: p.upgradePath || [], sb: this.encodeSentryBuild(p),
      sw: this.encodeSentryWork(p), sch: p.sentryChoice || null, ss: this.encodeSentryStatus(p),
      held: p.held, mnt: p.mount || 0, veh: p.vehicle || 0, seat: p.vehicleSeat || null, vw: p.vehicleWeapon || 0, rv: p.repairVehicle || 0,
      em: this.encodeEmote(p), emcd: r3(Math.max(0, p.emoteReadyAt - this.world.time)),
      fx: this.fxKeys.map((k) => r1(p.fx[k])), rg: r1(p.regen), dr: r1(this.world.reveal[p.team] || 0), tp: r2(p.tpProgress || 0)
    };
    // The hotbar only travels when it changes.
    const items = p.items.map((s) => (s ? [s.id, s.n] : 0)), key = JSON.stringify(items);
    if (key !== p.net.itemsKey) { p.net.itemsKey = key; you.items = items; }
    const look = this.cosmeticLook(p), lookKey = JSON.stringify(look);
    if (lookKey !== p.net.cosmeticsKey) { p.net.cosmeticsKey = lookKey; you.cosmetics = look; }
    return you;
  }

  // Returns { msg, x, y, global, to:[ids], only:id, far } or null for events that are not replicated.
  encodeEvent(e) {
    switch (e.type) {
      case 'emote': return { msg: { t: 'emote', id: e.player.id, em: e.id, d: e.duration }, global: true };
      case 'shot': return { msg: { t: 'shot', id: e.player.id, w: e.weapon, x: r1(e.x), y: r1(e.y), a: e.angles.map(r3), st: e.struct || undefined }, x: e.x, y: e.y };
      case 'melee': return { msg: { t: 'melee', id: e.player.id, w: e.weapon || 'hammer', x: r1(e.x), y: r1(e.y), a: r3(e.a), r: e.reach }, x: e.x, y: e.y };
      case 'repair': return { msg: { t: 'repair', id: e.player.id, v: e.vehicle ? e.vehicle.id : 0, on: !!e.active }, global: true };
      case 'vehicle-shot': return { msg: { t: 'vshot', id: e.player.id, v: e.vehicle.id, w: e.weapon || 'turret', x: r1(e.x), y: r1(e.y), a: r3(e.angle), angles: e.angles.map(r3) }, x: e.x, y: e.y };
      case 'tank-shell': return { msg: e.op === 'spawn' ? { t: 'tank-shell', op: 'spawn', shell: this.encodeTankShell(e.shell) }
        : { t: 'tank-shell', op: 'impact', id: e.shell.id, x: r1(e.x), y: r1(e.y) }, global: true };
      case 'vehicle': return { msg: { t: 'vehicle', op: e.op, id: e.vehicle.id, by: e.player ? e.player.id : 0,
        seat: e.seat || null, n: r1(e.amount || 0), x: r1(e.x === undefined ? e.vehicle.x : e.x), y: r1(e.y === undefined ? e.vehicle.y : e.y),
        src: typeof e.source === 'number' ? e.source : e.source ? e.source.id : 0 }, global: true };
      case 'launch': case 'throw': return { msg: { t: e.type, id: e.player.id, w: e.weapon, x: r1(e.x), y: r1(e.y), vx: r1(e.vx), vy: r1(e.vy), tr: r1(e.travel || 0), fuse: e.fuse, it: e.item || undefined, startX: e.startX, startY: e.startY, targetX: e.targetX, targetY: e.targetY, flightTime: e.flightTime, peakHeight: e.peakHeight }, x: e.x, y: e.y };
      case 'rock-gone': return { msg: { t: 'rock-gone', id: e.rock.id }, global: true };
      case 'legendary-crate-broken': return { msg: { t: 'legendary-crate-broken', id: e.crate.id, by: e.player ? e.player.id : 0 }, global: true };
      case 'command': return { msg: { t: 'command', id: e.player.id, d: e.duration, rd: e.radarDuration, cd: e.cooldown, tm: e.team }, global: true };
      case 'flame': return { msg: { t: 'flame', id: e.player.id, x: e.x, y: e.y, a: e.angle, r: e.range, ha: e.halfAngle, dm: e.damage }, x: e.x, y: e.y };
      case 'explosion': return e.cause === 'tank-cannon' ? null : { msg: { t: 'boom', x: r1(e.x), y: r1(e.y), pw: e.power, c: e.cause, o: e.owner || 0 }, x: e.x, y: e.y, far: true };
      case 'burst': return { msg: { t: 'burst', it: e.item, x: r1(e.x), y: r1(e.y), o: e.owner || 0 }, x: e.x, y: e.y, far: true };
      case 'zone': return { msg: Object.assign({ t: 'zone' }, this.encodeZone(e.zone)), global: true };
      case 'struct': return { msg: Object.assign({ t: 'struct', op: e.op, reason: e.reason, n: e.amount ? r1(e.amount) : undefined, src: typeof e.source === 'number' ? e.source : e.source ? e.source.id : 0 }, this.encodeStruct(e.struct)), global: true };
      case 'strike': return { msg: { t: 'strike', id: e.strike.id, k: e.strike.kind, x: r1(e.strike.x), y: r1(e.strike.y), tg: e.strike.target || 0, tl: r2(e.strike.t), o: e.strike.owner || 0, tm: e.strike.team, r: e.strike.radius, dm: e.strike.damage }, global: true };
      case 'strike-hit': return { msg: { t: 'shit', id: e.strike.id, k: e.strike.kind, x: r1(e.strike.x), y: r1(e.strike.y) }, global: true };
      case 'teleport': return { msg: { t: 'tele', id: e.player.id, fx: r1(e.fromX), fy: r1(e.fromY), x: r1(e.x), y: r1(e.y) }, global: true };
      case 'pulled': return { msg: { t: 'pulled', id: e.player.id, x: r1(e.x), y: r1(e.y) }, global: true };
      case 'sentry-shot': return { msg: { t: 'sshot', id: e.struct.id, x: r1(e.x), y: r1(e.y), tx: r1(e.tx), ty: r1(e.ty) }, x: e.x, y: e.y };
      case 'sentry-projectiles': return { msg: { t: 'sentry-fire', id: e.struct.id, x: e.x, y: e.y, a: e.struct.angle }, x: e.x, y: e.y };
      case 'sentry-impact': return { msg: { t: 'sentry-impact', id: e.id, k: e.kind, x: e.x, y: e.y }, x: e.x, y: e.y };
      case 'rpg-shot': return { msg: { t: 'rpg-shot', id: e.player.id, x: r2(e.x), y: r2(e.y), a: r3(e.angle) }, x: e.x, y: e.y };
      case 'rpg-impact': return { msg: { t: 'rpg-impact', id: e.id, x: r1(e.x), y: r1(e.y), o: e.owner }, x: e.x, y: e.y, far: true };
      case 'buff': return { msg: { t: 'buff', id: e.player.id, k: e.effect, d: e.duration, it: e.item, my: e.mystery, by: e.by || 0 }, to: e.team ? this.players.filter((o) => o.team === e.team).map((o) => o.id) : [e.player.id] };
      case 'flashed': return { msg: { t: 'flashed' }, only: e.player.id };
      case 'saved': return { msg: { t: 'saved', id: e.player.id }, global: true };
      case 'blocked': return { msg: { t: 'blocked', id: e.player.id, how: e.how }, x: e.player.x, y: e.player.y };
      case 'damage': return { msg: { t: 'dmg', id: e.target.id, src: e.source ? e.source.id : 0, n: r1(e.amount), c: e.cause, x: r1(e.x), y: r1(e.y) }, x: e.x, y: e.y, to: [e.target.id, e.source ? e.source.id : 0] };
      case 'death': return { msg: { t: 'death', id: e.victim.id, k: e.killer ? e.killer.id : 0, c: e.cause, wd: !!e.wasDowned }, global: true };
      case 'downed': return { msg: { t: 'down', id: e.player.id, k: e.source ? e.source.id : 0, c: e.cause }, global: true };
      case 'revived': return { msg: { t: 'revive', id: e.player.id, by: e.by ? e.by.id : 0 }, global: true };
      case 'heal': return { msg: { t: 'heal', id: e.player.id, by: e.by ? e.by.id : 0, n: r1(e.amount), it: e.item || undefined }, x: e.player.x, y: e.player.y, to: [e.player.id] };
      case 'collected': return { msg: { t: 'pick', id: e.pickup.id, by: e.player.id, what: e.pickup.type, it: e.pickup.item || undefined, n: e.pickup.amount, tot: e.total }, global: true };
      case 'spawn-pickup': return { msg: { t: 'pkspawn', id: e.pickup.id, type: e.pickup.type, it: e.pickup.item || undefined, x: r1(e.pickup.x), y: r1(e.pickup.y), vx: r1(e.pickup.vx), vy: r1(e.pickup.vy), n: e.pickup.amount, lk: r2(e.pickup.lockT || 0) }, global: true };
      case 'crate-hp': return { msg: { t: 'crate', id: e.crate.id, hp: Math.ceil(Math.max(0, e.hp)), src: e.source ? e.source.id : 0, n: r1(e.amount), x: r1(e.x), y: r1(e.y) }, global: true };
      case 'upgrade': return { msg: { t: 'upg', id: e.player.id, cls: e.classId, st: e.station.id, key: !!e.usedKey }, global: true };
      case 'land': return { msg: { t: 'land', id: e.player.id }, x: e.player.x, y: e.player.y, to: [e.player.id] };
      case 'reload': case 'reloaded': case 'switch': case 'deny': case 'item-used': case 'item-dropped': case 'mounted': case 'dismounted':
        return { msg: { t: 'local', k: e.type, w: e.weapon, reason: e.reason, value: e.value, it: e.item, n: e.amount }, only: e.player.id };
      default: return null;
    }
  }

  sendSnapshots(events) {
    const encoded = [];
    for (const e of events) { const enc = this.encodeEvent(e); if (enc) encoded.push(enc); }
    const time = r3(this.world.time);
    // Repair the global legendary marker after a slow connection skips a break event.
    const legendary = this.map.crates[this.map.legendaryCrateId];
    const lc = legendary ? (legendary.alive ? Math.max(1, Math.ceil(legendary.hp)) : 0) : undefined;
    // Shared vehicles are cheap to synchronize globally. This keeps vacated seats,
    // wrecks and vehicles crossing the view boundary authoritative without stale ownership.
    const vehicles = (this.world.vehicles || []).map((v) => this.encodeVehicle(v));
    const structs = this.world.structures.filter(s => s.alive).map(s => this.encodeStruct(s)), structKey = JSON.stringify(structs);
    for (const p of this.players) {
      const conn = p.net.conn;
      if (!conn || !conn.open) continue;
      if (conn.bufferedAmount > 96 * 1024) continue; // slow link: skip this tick rather than pile up
      const c = this.viewCenter(p);
      const list = [];
      for (const enc of encoded) {
        if (enc.only !== undefined) { if (enc.only === p.id) list.push(enc.msg); continue; }
        if (enc.global || (enc.to && enc.to.includes(p.id))) { list.push(enc.msg); continue; }
        if (Math.hypot(enc.x - c.x, enc.y - c.y) < VIEW + (enc.far ? 900 : 300)) list.push(enc.msg);
      }
      // Teammates always; enemies within view, or everyone while a drone flies for this team. Invisible enemies are never sent.
      const players = [], drone = (this.world.reveal[p.team] || 0) > 0, revealed = new Set(this.world.revealedEnemies(p).map((o) => o.id));
      for (const o of this.players) {
        if (!o.alive && o.deadT > 1.5) continue;
        const mate = o === p || o.team === p.team;
        if (!mate && !drone && !revealed.has(o.id) && o.fx.invisible > 0) continue;
        if (mate || drone || revealed.has(o.id) || Math.hypot(o.x - c.x, o.y - c.y) < VIEW) players.push(this.encodePlayer(o));
      }
      // Identity changes are small and rare. Retry the current roster after any skipped slow-link frame.
      const looks = p.net.lookVersion !== this.cosmeticsVersion ? this.players.map(o => [o.id, o.color, o.face]) : undefined;
      const projectiles = (this.world.sentryProjectiles || []).filter(o => Math.hypot(o.x - c.x, o.y - c.y) < VIEW + 400).map(o => this.encodeSentryProjectile(o));
      const rockets = (this.world.rpgRockets || []).filter(o => Math.hypot(o.x - c.x, o.y - c.y) < VIEW + 400).map(o => this.encodeRpgRocket(o));
      conn.sendText(JSON.stringify({ t: 'snap', time, you: this.encodeYou(p), looks, spec: p.alive ? 0 : p.net.specId, p: players, vehicles, sp: projectiles, rp: rockets, structs: p.net.structKey !== structKey ? structs : undefined, lc, e: list, alive: this.aliveCount, teams: this.teamsAlive }));
      p.net.structKey = structKey;
      p.net.lookVersion = this.cosmeticsVersion;
    }
  }
}
