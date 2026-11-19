// Bot vehicles: walking over to a Humvee, a tank or an artillery piece, driving it, fighting from it and getting out.
// Everything goes through a player's rules. An empty vehicle is on everyone's map, so bots know where those are;
// getting in is the interact key next to the hull. A driver steers with the movement keys (there is no reverse gear:
// a hull turns while it rolls), a turret seat aims with the mouse, and an artillery crew has the targeting map, which
// shows everybody on the island as a dot (nobody invisible, and people inside vehicles only as the vehicle) but cannot
// make a shell land any sooner: whoever moves off in the two to four seconds it is in the air is missed.
import { Bot, clamp, lerp, TAU } from './bot.mjs';
import { LANDING_GRACE } from './bot-combat.mjs';

const VALUE = { tank: 9, artillery: 6.5, ride: 5, ram: 3 };    // how much a seat in each kind is worth
// Everybody can see on the map where the empty tanks and guns stand, and straight off the drop the lobby runs for
// them: for the first minute and a half none is too far away. After that a tank or a gun is still worth a long walk
// (world units; a screen is 1800 wide), and a Humvee, which can only run people down, a short one.
const RACE = 100, REACH = { tank: 7000, sp: 5500, ground: 5000, ram: 1100 };
// How many bots race for the same empty one. A tank can look after itself once somebody is in it; a gun cannot (its
// shells do not land that close), and a second runner arriving behind the first only shoots it to pieces.
const RUNNERS = { tank: 3, artillery: 1, humvee: 1 };
const PACE = 330;                                              // units a second on foot, sprints included: who is there first
// How long a vehicle is left alone by the bot that got out of it, by why it got out (seconds; 25 otherwise).
const AWAY = { enemy: 12, revive: 15, stuck: 60, hull: 120, idle: 240, storm: 240, edge: 240, arrived: 240 };
const STEER = [0, 0.3, 0.6, 0.95, 1.3, 1.7, 2.15, 2.6, Math.PI];
const SETTLE_PAD = 640;                                        // houses, plus the reach of the guards on a settlement's edge

Object.assign(Bot.prototype, {
  hull() { return this.p.vehicle ? this.world.vehicleById(this.p.vehicle) : null; },
  manned(v) { for (const s in v.seats) if (v.seats[s]) return true; return false; },
  // The seat this bot would get by pressing the interact key at this vehicle now (null: nothing for us).
  seatIn(v) {
    const world = this.world, p = this.p;
    if (!v || v.wreck) return null;
    for (const s of world.vehicleSeatOrder(v)) if (world.vehicleSeatAvailable(v, s, p)) return s;
    return null;
  },
  // Inside a settlement's rectangle grown by a hull's radius plus `pad` (by default the guards' reach)?
  inSettleBox(x, y, r, pad = SETTLE_PAD) { return this.d.settleBoxes(pad + Math.round(r)).some((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1); },

  // ---------------------------------------------------------------- choosing one
  // `urgent`: the storm is coming and only a car parked right here is worth the detour.
  pickVehicle(urgent) {
    const p = this.p, now = this.now, world = this.world;
    if (p.vehicle || p.downed || !world.vehicles || !world.vehicles.length) return false;
    const lead = this.following();
    if (lead) {
      // On a team the one in front picks the vehicle; the others ride along in it.
      const v = lead.vehicle ? world.vehicleById(lead.vehicle) : null;
      if (v && !v.wreck && this.seatIn(v) && this.dist(v) < 900 && !((this.badVehicle.get(v.id) || 0) > now)) {
        if (!this.ride || this.ride.v !== v) this.ride = { v, why: 'crew', until: now + 12, spot: null, spotAt: 0, side: 0 };
        return true;
      }
      this.ride = null;
      return false;
    }
    const cur = this.ride;
    if (cur && !(now < cur.until && this.vehicleUse(cur.v, urgent) === cur.why)) this.dropRide(cur.v);
    if (now < this.vehicleAt) return !!this.ride;
    this.vehicleAt = now + 1.2;
    let best = null, bs = -Infinity;
    for (const v of world.vehicles) {
      const why = this.vehicleUse(v, urgent);
      if (!why) continue;
      // The walk costs a point for every twenty seconds, and so does every bot that will be there before us. The one
      // we are already running for stays the choice unless another is clearly better.
      const eta = this.dist(v) / PACE;
      const score = VALUE[why] - eta / 20 - this.d.vehicleRivals(v, p, eta) * 1.2 + (this.ride && this.ride.v === v ? 1 : 0);
      if (score > bs) { bs = score; best = { v, why }; }
    }
    if (!best) { if (this.ride) this.dropRide(this.ride.v); return false; }
    if (this.ride && this.ride.v === best.v) return true;
    if (this.ride) this.dropRide(this.ride.v);
    this.ride = { v: best.v, why: best.why, until: now + 12 + this.dist(best.v) / 150, spot: null, spotAt: 0, side: 0 };
    return true;
  },
  // In a fight, or running from one, an empty tank a few steps away is worth more than either: in first.
  tankAtHand() {
    const p = this.p, now = this.now, world = this.world;
    if (p.vehicle || p.downed || !world.vehicles || this.following()) return false;
    const cur = this.ride;
    for (const v of world.vehicles) {
      if (v.type !== 'tank' || this.dist(v) > v.r + 340 || this.vehicleUse(v, false) !== 'tank') continue;
      if (cur && cur.v === v && now < cur.until) return true;
      if (cur) this.dropRide(cur.v);
      this.ride = { v, why: 'tank', until: now + 10, spot: null, spotAt: 0, side: 0 };
      return true;
    }
    return false;
  },
  // What this bot would do with that vehicle ('tank', 'ram', 'ride', 'artillery'), or null to leave it be. Every bot
  // wants a tank or a gun; only some care to run people down in a Humvee.
  vehicleUse(v, urgent) {
    const p = this.p, now = this.now;
    if (!this.rides || !v || v.wreck || this.manned(v) || (v.settlement !== null && v.settlement !== undefined)) return null;
    if ((this.badVehicle.get(v.id) || 0) > now || !this.seatIn(v)) return null;
    if (this.inHazard(v.x, v.y) || v.hp < v.maxHp * (p.classId === 'armorcrew' ? 0.15 : 0.35)) return null;
    const d = this.dist(v), st = this.storm, far = Math.hypot(st.x - p.x, st.y - p.y);
    if (d > 1500 && now - this.landAt < this.raceDelay) return null;      // just landed: still looking at the map
    // Somebody is at it already, and nearer to it than we are: they will be in the seat first.
    for (const r of this.known.values()) if (r.noticed && r.visible && !r.downed && Math.hypot(r.x - v.x, r.y - v.y) < Math.min(600, d - 80)) return null;
    let why = null;
    if (urgent) why = (v.type === 'humvee' || v.type === 'tank') && d < 650 && far > 2500 ? 'ride' : null;
    else if (!this.inZone(v.x, v.y, 300)) return null;
    else if (v.type === 'tank') why = this.world.time < RACE || d < REACH.tank ? 'tank' : null;
    else if (v.type === 'humvee') why = st.soon && d < 900 && far > 3000 ? 'ride' : this.wheels > 0.6 && d < REACH.ram ? 'ram' : null;
    else if (v.type === 'artillery') {
      if (v.fixed && !this.inSafe(v.x, v.y, 500)) return null;           // the next circle leaves it behind: not worth setting up
      why = this.world.time < RACE || d < (v.fixed ? REACH.ground : REACH.sp) ? 'artillery' : null;
    }
    // It is a race: with enough others who will be there before us, this one is theirs.
    return why && this.d.vehicleRivals(v, p, d / PACE) < RUNNERS[v.type] ? why : null;
  },
  dropRide(v) { if (v) this.d.unclaimVehicle(v, this.p); this.ride = null; },

  // ---------------------------------------------------------------- getting in
  doBoard() {
    const r = this.ride, p = this.p, now = this.now, world = this.world, v = r && r.v;
    const ok = !!v && !v.wreck && !!this.seatIn(v) && now < r.until && (r.why === 'crew' || !this.manned(v));
    if (!ok) { if (v) this.badVehicle.set(v.id, now + (r.why === 'crew' ? 6 : 30)); this.dropRide(v); this.redecide = true; return; }
    if (r.why !== 'crew') this.d.claimVehicle(v, p, this.dist(v) / PACE);
    const gap = world.vehicleBoardingDistance(p, v);
    if (gap <= this.W.VEHICLE.interactRange - 6 && world.lineClear(p.x, p.y, v.x, v.y, v)) {
      this.still = true; this.look = v;
      if (now < this.nextInteract || this.act) return;
      // The interact key takes a loose item first: one we cannot carry would only say "full", so come round the other side.
      const pk = world.nearestItemPickup(p);
      if (pk && !world.canTake(p, pk.item)) { r.side++; r.spot = null; r.spotAt = 0; this.still = false; this.nextInteract = now + 0.6; return; }
      this.out.interactPressed = true; this.nextInteract = now + 0.45;
      return;
    }
    if (!r.spot || now > r.spotAt) { r.spot = this.boardSpot(v, r.side); r.spotAt = now + (r.why === 'crew' ? 0.5 : 1.5); }
    if (!r.spot) { this.badVehicle.set(v.id, now + 20); this.dropRide(v); this.redecide = true; return; }
    this.moveGoal = { x: r.spot.x, y: r.spot.y, tol: 10 };
    if (this.dist(v) > 450) this.sprint = true;
  },
  // A free spot just outside the hull, on our side of it (or round to `side`), with nothing between it and the door.
  boardSpot(v, side) {
    const p = this.p, nav = this.nav, R = v.r + p.r + 28, base = Math.atan2(p.y - v.y, p.x - v.x) + side * 1.3;
    for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, 2.6, -2.6, Math.PI]) {
      const a = base + off, x = v.x + Math.cos(a) * R, y = v.y + Math.sin(a) * R;
      if (nav.freeAt(x, y) && this.world.lineClear(x, y, v.x, v.y, v)) return { x, y };
    }
    return null;
  },

  // ---------------------------------------------------------------- inside
  startDrive(v) {
    const r = this.ride, now = this.now;
    // Pressing the interact key for something else next to a vehicle can put a bot in a seat it never wanted.
    const why = r && r.v === v ? r.why : 'oops';
    this.drive = { id: v.id, why, since: now, route: null, routeGoal: null, routeAt: -9, edge: null, side: 1, dir: null, dirAt: 0,
      sx: v.x, sy: v.y, stuckAt: now, stuckN: 0, turnAt: now, unstick: null, wedges: [], tried: [], hullHitAt: -99, hullBy: 0, exitAt: 0, exitTries: 0, leave: false, foe: null, openAt: -99,
      orbit: this.vrng.next() < 0.5 ? 1 : -1, orbitAt: now + 5, passUntil: 0, passDir: 0, passSide: 0, patrol: null, parkUntil: 0, lastFightAt: now,
      lastShotAt: now, scanAt: 0, pick: null, aimAt: null, relocate: null, lineFor: 0, lineAt: -9, lineOk: false };
    if (r) this.d.unclaimVehicle(r.v, this.p);
    this.ride = null; this.watch.clear();
    this.setMode('vehicle');
    this.tDecide = 0;
  },
  leftVehicle() {
    const dr = this.drive;
    this.drive = null; this.route = null; this.redecide = true; this.stuck.n = 0; this.watch.clear();
    if (dr && dr.why !== 'crew') this.badVehicle.set(dr.id, this.now + (AWAY[dr.leave] || 25));
    if (this.mode === 'vehicle') this.mode = 'roam';
  },
  thinkVehicle() {
    const p = this.p, now = this.now, out = this.out, v = this.hull();
    if (!v) return;
    if (!this.drive || this.drive.id !== v.id) this.startDrive(v);
    const dr = this.drive;
    if (this.act || this.queue.length) { this.act = null; this.queue.length = 0; this.holding = false; }   // no items from a seat
    this.gearCharge = null;
    if ((this.tDecide -= this.dt) <= 0 || this.redecide) {
      this.tDecide = this.prof.decideEvery; this.redecide = false;
      this.updateStorm(); this.pickTarget();
      dr.leave = this.shouldLeave(v);
    }
    if (dr.leave) {
      // Out. The game refuses while there is nowhere to step down (wedged between rocks, say): then the driver works
      // the hull loose for a moment and tries again.
      if (dr.unstick && now < dr.unstick.until && p.vehicleSeat === 'driver' && v.type !== 'artillery') return this.driveToward(v, { x: v.x + dr.unstick.x * 300, y: v.y + dr.unstick.y * 300, tol: 10 }, 0.8, true);
      if (now >= dr.exitAt) {
        out.interactPressed = true; dr.exitAt = now + 0.5;
        if (++dr.exitTries % 3 === 0 && p.vehicleSeat === 'driver' && !v.fixed) { dr.unstick = this.openHeading(v); dr.unstick.until = now + 1.5; }
      }
      return;
    }
    if (v.type === 'artillery') { if (p.vehicleSeat === 'driver') this.runArtillery(v); return; }
    if (p.vehicleSeat === 'driver') this.runDriver(v);
    this.runGun(v);
  },
  // Why to get out now ('' to stay).
  shouldLeave(v) {
    const p = this.p, now = this.now, dr = this.drive, frac = v.hp / v.maxHp, e = this.target;
    if (dr.why === 'oops') return 'oops';
    if (this.mates.some((m) => m.downed && this.dist(m) < 600)) return 'revive';     // a teammate is down right here
    if (p.vehicleSeat !== 'driver') {
      // Riding with a teammate: out when they get out (or when the hull is about to go).
      const driver = this.world.playerById(v.seats.driver), lead = this.following();
      return !driver || !driver.alive || (!!lead && lead.vehicle !== v.id) ? 'driver' : frac < 0.15 ? 'hull' : '';
    }
    if (frac < (v.type === 'tank' ? 0.1 : 0.22)) return 'hull';    // before it burns out under us: on foot we can still hide
    if (dr.stuckN >= 4) return 'stuck';                             // wedged for good
    if (v.type !== 'artillery' && dr.edge && this.storm.soon && this.arrivedAt(dr.edge, 280)) return 'edge';   // the safe ground is a settlement: on foot from here
    if (v.type === 'artillery') {
      if (!v.fixed) return '';                                      // a self-propelled gun sets up wherever it got to
      if (this.storm.soon && !this.inSafe(v.x, v.y, 150)) return 'storm';
      // Somebody at the gun, where its shells cannot reach: deal with them on foot. (Another bot walking past is left
      // alone until it comes right up to the gun or starts on the hull.)
      if (e && e.visible && !e.ref.vehicle && this.dist(e) < 560 && (!e.ref.bot || this.dist(e) < 260 || (dr.hullBy === e.id && now - dr.hullHitAt < 3))) return 'enemy';
      if (now - dr.hullHitAt < 2 && frac < 0.5) return 'hull';
      return now - dr.lastShotAt > 80 ? 'idle' : '';                // nothing worth a shell for a long while
    }
    if (dr.why === 'ride') return !this.storm.soon && this.inSafe(v.x, v.y, 250) && now - dr.since > 4 ? 'arrived' : '';   // the lift is over
    if (dr.why === 'ram' && now - dr.lastFightAt > 50) return 'idle';   // nobody to run down: back to looting
    return '';
  },
  // Bullets on a hull never reach its riders, so the director passes the news on (who, and how close).
  onHullHit(e) {
    const now = this.now = this.world.time, src = e.source, p = this.p, dr = this.drive;
    if (!src || src === p || src.team === p.team) return;
    if (dr) { dr.hullHitAt = now; dr.hullBy = src.id; }
    this.alertUntil = now + 7;
    let rec = this.known.get(src.id);
    if (src.alive && this.shows(src)) {
      if (!rec) { rec = this.newRecord(src); this.known.set(src.id, rec); }
      rec.hurtMeAt = now; rec.noticeAt = Math.min(rec.noticeAt, now + this.prof.reaction * 0.45);
      rec.x = src.x; rec.y = src.y; rec.seenAt = now; rec.lost = false;
    } else if (rec) rec.hurtMeAt = now;
    this.redecide = true;
  },

  // ---------------------------------------------------------------- driving
  runDriver(v) {
    const now = this.now, dr = this.drive, st = this.storm;
    const danger = this.hullDanger(v);
    if (danger) { dr.foe = this.vehicleFoe(v); return this.driveToward(v, { x: v.x + danger.x * 600, y: v.y + danger.y * 600, tol: 40 }, 1, true); }
    if (this.waitForCrew(v)) { dr.foe = this.vehicleFoe(v); return this.driveToward(v, null); }
    const e = dr.foe = this.vehicleFoe(v);
    if (st.must) return this.driveToward(v, { x: st.x, y: st.y, tol: 140, storm: true }, 1);   // the guns keep working on the way
    if (e) { dr.lastFightAt = now; return this.fightDrive(v, e); }
    if (st.soon) return this.driveToward(v, { x: st.x, y: st.y, tol: 140, storm: true }, 1);
    return this.driveToward(v, this.patrolGoal(v), 0.85);
  },
  // Something about to land on the hull (a strike, a shell, fire under a Humvee): the way out of it.
  hullDanger(v) {
    let worst = null;
    for (const h of this.hazards) {
      if (h.kind === 'sentry') continue;
      if (v.type === 'tank' && h.kind !== 'airstrike' && h.kind !== 'meteor' && h.kind !== 'artillery') continue;   // a grenade is nothing to a tank
      const d = Math.hypot(v.x - h.x, v.y - h.y);
      if (d < h.r + v.r * 0.5 && (!worst || h.eta < worst.h.eta)) worst = { h, d };
    }
    if (!worst) return null;
    const { h, d } = worst;
    return d > 1 ? { x: (v.x - h.x) / d, y: (v.y - h.y) / d } : { x: Math.cos(v.angle), y: Math.sin(v.angle) };
  },
  // A bot that leads its team gives teammates a moment to climb in before setting off.
  waitForCrew(v) {
    const now = this.now, dr = this.drive;
    if (now - dr.since > 9) return false;
    for (const m of this.mates) {
      if (!m.bot || !m.ai || m.downed || m.vehicle || this.dist(m) > 800 || !m.ai.seatIn(v)) continue;
      if (now - dr.since < 1.5 || (m.ai.mode === 'board' && m.ai.ride && m.ai.ride.v === v)) return true;
    }
    return false;
  },
  armed(v) { return v.type === 'tank' || (!!v.armed && !!v.seats.gunner); },
  // Who the driver goes after: the same choice as on foot (a person is fair game once the landing grace is over), with
  // a tank's confidence. An unarmed Humvee can only run people down, so only someone on foot out in the open.
  vehicleFoe(v) {
    const e = this.target, now = this.now, dr = this.drive;
    if (!e || !e.ref.alive || e.dropping || now - e.seenAt > 2.5) return null;
    const d = this.dist(e), human = !e.ref.bot, theirs = e.ref.vehicle ? this.world.vehicleById(e.ref.vehicle) : null;
    const provoked = now - e.hurtMeAt < 4 || now - e.shotAtMeAt < 2 || (dr.hullBy === e.id && now - dr.hullHitAt < 4);
    if (!this.armed(v)) {
      // (Somebody it was already bearing down on is not forgotten the moment a rock gets in the way or they leave the
      // edge of the screen, say while the hull backs out of a tight spot: it has a few seconds to come round.)
      const keep = dr.foe === e && now - dr.openAt < 4;
      if (theirs || d > (keep ? 1300 : 950)) return null;
      if (e.visible && this.world.lineClear(v.x, v.y, e.ref.x, e.ref.y, v)) dr.openAt = now;
      else if (!keep) return null;
    }
    if (theirs && !theirs.wreck && theirs.type === 'tank' && v.type !== 'tank') return null;   // nothing to win against a tank
    if (provoked || (d < 320 && !(human && now - this.landAt < LANDING_GRACE))) return e;
    if (this.mates.length && this.d.focus(this.p.team) === e.id) return e;
    if (!e.visible) return dr.foe === e ? e : null;                 // still after someone who has just slipped out of sight
    if (human) return now - this.landAt < LANDING_GRACE ? null : e;  // a person in view is a target, as on foot
    return this.freeChoice(e, d, e.downed ? 0.2 : e.hp, 1) ? e : null;
  },
  fightDrive(v, e) {
    const now = this.now, dr = this.drive, o = e.visible ? e.ref : e;
    const dx = o.x - v.x, dy = o.y - v.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    if (!this.armed(v)) {
      // Run them down: aim where they will be, carry on past, come round again. The pass veers off to one side: a
      // ram only counts again once the hull has let go of them, and somebody standing still would otherwise be pushed
      // along in front of it for the length of the island.
      if (now < dr.passUntil) return this.driveToward(v, { x: v.x + Math.cos(dr.passDir) * 400, y: v.y + Math.sin(dr.passDir) * 400, tol: 10 }, 1, true);
      if (d < 110) { dr.passUntil = now + 0.8; dr.passSide = -(dr.passSide || dr.orbit); dr.passDir = v.angle + dr.passSide * 0.6; }
      const sp = Math.max(150, Math.hypot(v.vx, v.vy)), t = Math.min(1.2, d / sp) * (0.4 + this.prof.lead * 0.6);
      return this.driveToward(v, { x: o.x + (o.vx || 0) * t, y: o.y + (o.vy || 0) * t, tol: 0 }, 1, true);
    }
    const theirs = e.ref.vehicle ? this.world.vehicleById(e.ref.vehicle) : null;
    const lo = theirs && this.W.vehicleHasTankArmor(theirs) ? 650 : 420, hi = theirs ? 1050 : 820;
    // No line on them: go and find one. Already close with something in the way (a rock they stand behind, a cactus
    // between two hulls), coming closer finds nothing and stopping there is how two tanks sat side by side for
    // minutes: round them it goes, like below.
    const line = e.visible && this.gunLine(v, e);
    if (!line && d > 340) return this.driveToward(v, { x: o.x, y: o.y, tol: 300 }, 1);
    if (line && d > hi) return this.driveToward(v, { x: o.x, y: o.y, tol: hi - 50 }, 1);
    if (line && d < lo) return this.driveToward(v, { x: v.x - ux * 500, y: v.y - uy * 500, tol: 20 }, 1, true);
    // In range: circle them, now one way, now the other, never sitting still for their rockets (and never round into
    // a street of houses).
    if (now > dr.orbitAt) { dr.orbit = -dr.orbit; dr.orbitAt = now + this.vrng.range(3, 7); }
    for (let k = 0; k < 2; k++) {
      const x = v.x - uy * dr.orbit * 400 + ux * 60, y = v.y + ux * dr.orbit * 400 + uy * 60;
      if (!this.inSettleBox(x, y, v.r, 60) || k) return this.driveToward(v, { x, y, tol: 10 }, 0.55, true);
      dr.orbit = -dr.orbit;
    }
    return this.driveToward(v, null);
  },
  // Nobody to fight: go where the shooting is, or where people are bound to be (the edge of a settlement inside the
  // circle: that is where the loot is), and wait there a while; failing that, look round somewhere inside the circle.
  patrolGoal(v) {
    const now = this.now, dr = this.drive, rng = this.vrng, W = this.W, U = W.U, S = W.CONFIG.worldSize;
    if (now < dr.parkUntil) return null;
    if (this.heard && now - this.heardAt < 8 && this.inZone(this.heard.x, this.heard.y, 0)) return { x: this.heard.x, y: this.heard.y, tol: 260 };
    let g = dr.patrol;
    if (g && (now > g.until || Math.hypot(g.x - v.x, g.y - v.y) < g.tol + 30)) { dr.parkUntil = now + (g.watch ? rng.range(8, 16) : rng.range(2, 6)); dr.patrol = null; return null; }
    if (!g && rng.next() < 0.75) {
      const towns = this.world.map.towns || [], boxes = this.d.settleBoxes(SETTLE_PAD + Math.round(v.r)), spots = [];
      towns.forEach((t, i) => {
        const b = boxes[i];
        if (!b || !this.inZone(t.x, t.y, 0)) return;
        for (const [x, y] of [[(b.x0 + b.x1) / 2, b.y0 - 30], [(b.x0 + b.x1) / 2, b.y1 + 30], [b.x0 - 30, (b.y0 + b.y1) / 2], [b.x1 + 30, (b.y0 + b.y1) / 2]]) {
          const d = Math.hypot(x - v.x, y - v.y);
          if (d > 500 && U.insideIsland(x, y, v.r + 150, S, W.CONFIG.cornerRadius) && this.inZone(x, y, 100)) spots.push({ x, y, d });
        }
      });
      spots.sort((a, b) => a.d - b.d);
      const s = spots[Math.floor(rng.next() * Math.min(3, spots.length))];
      if (s) g = dr.patrol = { x: s.x, y: s.y, tol: 160, until: now + 20 + s.d / 250, watch: true };
    }
    if (!g) {
      const s = this.world.storm, c = s ? (s.next || s) : { x: S / 2, y: S / 2, r: S / 2 };
      for (let i = 0; i < 10 && !g; i++) {
        const a = rng.range(0, TAU), dd = rng.range(1200, 3500);
        let x = v.x + Math.cos(a) * dd, y = v.y + Math.sin(a) * dd;
        const dc = Math.hypot(x - c.x, y - c.y), lim = Math.max(200, c.r * 0.85);
        if (dc > lim) { const k = lim * rng.range(0.4, 1) / dc; x = c.x + (x - c.x) * k; y = c.y + (y - c.y) * k; }
        if (W.U.insideIsland(x, y, v.r + 200, S, W.CONFIG.cornerRadius) && !this.inSettleBox(x, y, v.r)) g = { x, y, tol: 200, until: now + rng.range(18, 32) };
      }
      dr.patrol = g;
    }
    return g;
  },
  // Steer for `goal` ({x, y, tol}; null: brake). Long trips go round settlements; `direct` skips that for short moves.
  driveToward(v, goal, throttle = 1, direct = false) {
    const out = this.out, dr = this.drive, now = this.now;
    if (!goal) { out.mx = 0; out.my = 0; this.hullStuck(v, false); return; }
    let wp = goal, final = true;
    if (!direct) {
      if (!dr.route || now - dr.routeAt > 6 || Math.hypot(dr.routeGoal.x - goal.x, dr.routeGoal.y - goal.y) > 300) {
        const r = this.d.vehicleRoute(v.x, v.y, goal.x, goal.y, v.r);
        dr.route = r.pts; dr.routeGoal = { x: goal.x, y: goal.y }; dr.routeAt = now; dr.edge = goal.storm ? r.edge : null;
      }
      while (dr.route.length > 1 && Math.hypot(dr.route[0].x - v.x, dr.route[0].y - v.y) < 200) dr.route.shift();
      wp = dr.route[0] || goal; final = dr.route.length <= 1;
    }
    const dx = wp.x - v.x, dy = wp.y - v.y, d = Math.hypot(dx, dy), tol = goal.tol || 0;
    if (final && (d <= tol || d < 1)) { out.mx = 0; out.my = 0; this.hullStuck(v, false); return; }
    let dir = dr.unstick && now < dr.unstick.until ? dr.unstick : null;
    if (!dir) {
      if (now >= dr.dirAt || !dr.dir) { dr.dir = this.hullSteer(v, dx / d, dy / d, d); dr.dirAt = now + 0.1; }
      dir = dr.dir;
    }
    if (!dir) { out.mx = 0; out.my = 0; this.hullStuck(v, true); return; }
    const turn = Math.abs(this.W.U.angleDiff(v.angle, Math.atan2(dir.y, dir.x)));
    let k = throttle * (turn > 1.5 ? 0.35 : turn > 0.8 ? 0.65 : 1);
    if (final && tol > 0) k *= clamp(d / 350, 0.3, 1);              // ease in
    out.mx = dir.x * k; out.my = dir.y * k;
    // (Swinging round to a new heading it barely rolls: that is not being stuck, for as long as a full turn takes.)
    if (turn < 0.8) dr.turnAt = now;
    this.hullStuck(v, k > 0.25 && (turn < 0.8 || now - dr.turnAt >= 1.5));
  },
  // The heading nearest the wanted one along which the hull fits for the next few hundred units (null: none).
  hullSteer(v, ux, uy, far) {
    // Far enough ahead that the turning circle still has room once something shows up (a hull is no player).
    const dr = this.drive, L = Math.min(260 + Math.hypot(v.vx, v.vy) * 0.6, Math.max(60, far)), r = v.r + 10;
    const base = Math.atan2(uy, ux), side = dr.side || 1;
    for (const off of STEER) {
      for (const s of off ? [side, -side] : [1]) {
        const a = base + off * s, x = v.x + Math.cos(a) * L, y = v.y + Math.sin(a) * L;
        if (!this.hullClear(v, v.x, v.y, x, y, r)) continue;
        if (off) dr.side = s;
        return { x: Math.cos(a), y: Math.sin(a) };
      }
    }
    return null;
  },
  // Can a hull of radius r roll straight from (x1, y1) to (x2, y2)? Walls, rocks, crates, stations, structures, other
  // vehicles and the coast; a Humvee also keeps out of big sentries' reach. A hull already scraping something may
  // pull away from it or slide along it, never press further in: two rocks it is touching make a gap it does not fit.
  // `free` leaves out the memory of gaps it got wedged in.
  hullClear(v, x1, y1, x2, y2, r, free) {
    const U = this.W.U, C = this.W.CONFIG, world = this.world;
    if (!U.insideIsland(x2, y2, r + 8, C.worldSize, C.cornerRadius)) return false;
    let clear = true;
    world.solids.query(Math.min(x1, x2) - r, Math.min(y1, y2) - r, Math.max(x1, x2) + r, Math.max(y1, y2) + r, (s) => {
      if (!clear || (s.crate && !s.crate.alive) || (s.rock && !s.rock.alive) || (s.struct && !s.struct.alive)) return;
      if (s.shape === 'circle') {
        const d0 = Math.hypot(s.x - x1, s.y - y1);
        if (U.segCircle(x1, y1, x2, y2, s.x, s.y, Math.max(0, Math.min(s.r + r, d0 - 2))) >= 0) clear = false;
        return;
      }
      const d0 = Math.hypot(x1 - clamp(x1, s.x, s.x + s.w), y1 - clamp(y1, s.y, s.y + s.h));
      if (d0 < r) { if (Math.hypot(x2 - clamp(x2, s.x, s.x + s.w), y2 - clamp(y2, s.y, s.y + s.h)) < d0) clear = false; return; }
      if (U.segRect(x1, y1, x2, y2, s.x - r, s.y - r, s.w + r * 2, s.h + r * 2) >= 0) clear = false;
    });
    if (!clear) return false;
    for (const o of world.vehicles) {
      if (o === v) continue;
      const d0 = Math.hypot(o.x - x1, o.y - y1);
      if (U.segCircle(x1, y1, x2, y2, o.x, o.y, Math.max(0, Math.min(o.r + r, d0 - 2))) >= 0) return false;
    }
    if (v.type !== 'tank') {
      for (const h of this.hazards) {
        if (h.kind === 'sentry' && Math.hypot(x1 - h.x, y1 - h.y) >= h.r && U.segCircle(x1, y1, x2, y2, h.x, h.y, h.r) >= 0) return false;
      }
    }
    // A gap this hull got wedged in a moment ago is not tried again straight away.
    const wedges = !free && this.drive && this.drive.wedges;
    if (wedges) for (const w of wedges) if (w.until > this.now && Math.hypot(x1 - w.x, y1 - w.y) >= w.r && U.segCircle(x1, y1, x2, y2, w.x, w.y, w.r) >= 0) return false;
    return true;
  },
  // Wanting to roll and not rolling: swing round to an open heading and give the turn time to work. Four times
  // without getting anywhere in between and the vehicle is given up.
  hullStuck(v, trying) {
    const dr = this.drive, now = this.now;
    if (now - dr.stuckAt < 0.7) return;
    const moved = Math.hypot(v.x - dr.sx, v.y - dr.sy);
    dr.sx = v.x; dr.sy = v.y; dr.stuckAt = now;
    if (dr.unstick && now < dr.unstick.until) { if (moved > 60) dr.unstick.until = now; return; }   // rolling again: back to the route
    if (trying && moved < 30) {
      dr.stuckN++; dr.route = null; dr.dir = null;
      dr.wedges = dr.wedges.filter((w) => w.until > now).slice(-5);
      dr.wedges.push({ x: v.x + Math.cos(v.angle) * 60, y: v.y + Math.sin(v.angle) * 60, r: v.r + 30, until: now + 20 });
      dr.unstick = this.openHeading(v);
      dr.unstick.until = now + 1.8;
    } else if (moved > 150) dr.stuckN = Math.max(0, dr.stuckN - 1);
  },
  // The way out of a wedge: of the headings with room to roll, the one nearest to where we are going. (Any of them
  // can be reached: a hull turns on the spot, it just cannot push through what it is up against.)
  openHeading(v) {
    const dr = this.drive, U = this.W.U, now = this.now, g = dr.routeGoal, want = g ? Math.atan2(g.y - v.y, g.x - v.x) : v.angle;
    // A heading already tried from this very spot evidently did not get the hull out of it.
    dr.tried = dr.tried.filter((t) => t.until > now && Math.hypot(t.x - v.x, t.y - v.y) < 60).slice(-12);
    const stale = (a) => dr.tried.some((t) => Math.abs(U.angleDiff(t.a, a)) < 0.3);
    let best = null, bd = Infinity;
    for (const free of [false, true]) {                             // boxed in by its own memory of bad gaps: forget them
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * TAU;
        if (stale(a) || !this.hullClear(v, v.x, v.y, v.x + Math.cos(a) * 150, v.y + Math.sin(a) * 150, v.r + 2, free)) continue;
        const d = Math.abs(U.angleDiff(want, a)) + this.vrng.next() * 0.4;
        if (d < bd) { bd = d; best = a; }
      }
      if (best !== null) break;
    }
    if (best === null) best = this.pushOff(v, stale);
    dr.tried.push({ a: best, x: v.x, y: v.y, until: now + 15 });
    return { x: Math.cos(best), y: Math.sin(best), until: 0 };
  },
  // Nothing looks open: straight away from whatever the hull is up against, and failing that anywhere not tried yet.
  pushOff(v, stale) {
    const reach = v.r + 14, seen = new Set();
    let ax = 0, ay = 0;
    const add = (dx, dy) => { const d = Math.hypot(dx, dy) || 1; ax += dx / d; ay += dy / d; };
    this.world.solids.query(v.x - reach, v.y - reach, v.x + reach, v.y + reach, (s) => {
      if (seen.has(s) || (s.crate && !s.crate.alive) || (s.rock && !s.rock.alive) || (s.struct && !s.struct.alive)) return;
      seen.add(s);
      if (s.shape === 'circle') { if (Math.hypot(s.x - v.x, s.y - v.y) - s.r < reach) add(v.x - s.x, v.y - s.y); return; }
      const cx = clamp(v.x, s.x, s.x + s.w), cy = clamp(v.y, s.y, s.y + s.h);
      if (Math.hypot(v.x - cx, v.y - cy) < reach) add(v.x - cx, v.y - cy);
    });
    for (const o of this.world.vehicles) if (o !== v && Math.hypot(o.x - v.x, o.y - v.y) - o.r < reach) add(v.x - o.x, v.y - o.y);
    if (Math.hypot(ax, ay) > 0.2) { const a = Math.atan2(ay, ax); if (!stale(a)) return a; }
    for (let i = 0; i < 8; i++) { const a = this.vrng.next() * TAU; if (!stale(a)) return a; }
    return this.vrng.next() * TAU;
  },

  // ---------------------------------------------------------------- guns
  // Which vehicle weapons this seat works, by weapon slot (the seat's own 1 / 2 keys), and whether it can switch.
  seatGuns(v) {
    const p = this.p, world = this.world, was = p.vehicleWeapon, g = { cannon: -1, mg: -1, swap: false };
    for (const slot of [0, 1]) {
      p.vehicleWeapon = slot;
      const w = world.vehicleWeaponFor(p);
      if ((w === 'cannon' || w === 'mg') && g[w] < 0) g[w] = slot;
    }
    p.vehicleWeapon = was;
    g.swap = v.type === 'tank' && (p.vehicleSeat === 'driver' || (p.vehicleSeat === 'rearLeft' && world.vehicleTeamSize() === 2));
    return g;
  },
  runGun(v) {
    const p = this.p, out = this.out, W = this.W, g = this.seatGuns(v);
    if (g.cannon < 0 && g.mg < 0) { const t = this.target; if (t && t.visible) this.look = t; return; }   // a passenger
    const e = p.vehicleSeat === 'driver' ? this.drive.foe : this.crewFoe(v);
    if (!e || !e.visible) { const t = e || this.target; if (t && t.visible) this.look = t; return; }
    const o = e.ref, d = Math.hypot(o.x - v.x, o.y - v.y), theirs = o.vehicle ? this.world.vehicleById(o.vehicle) : null;
    const armoured = !!theirs && W.vehicleHasTankArmor(theirs);
    const ready = v.cannonReload <= 0 && v.cannonCooldown <= 0.2 && v.cannonAmmo > 0;
    // The cannon whenever it is loaded (and always against armour, where the machine gun barely scratches);
    // the machine gun while it reloads. Never the cannon point blank: its blast would reach our own hull.
    let pick = null;
    if (g.cannon >= 0 && d > 260 && d < W.TANK.cannonRange - 40 && (ready || armoured || g.mg < 0 || d > 1000)) pick = 'cannon';
    else if (g.mg >= 0 && !armoured && d < 1000) pick = 'mg';
    this.look = e;
    if (!pick) return;
    if (g.swap && p.vehicleWeapon !== g[pick]) { out.slot = g[pick]; return; }
    if (!this.gunLine(v, e)) return;
    this.shoot = { rec: e, def: pick === 'cannon' ? this.d.cannonDef : v.type === 'tank' ? W.WEAPONS.tankmg : W.WEAPONS.turret };
    if (!o.bot) this.d.noteAggro(o.id, p);
    if (this.mates.length) this.d.setFocus(p, e.id);
  },
  // From a teammate's vehicle: whoever is shooting at us, whoever the team is on, otherwise the usual choice.
  crewFoe(v) {
    const e = this.target, now = this.now, dr = this.drive;
    if (!e || !e.ref.alive || e.dropping || !e.visible) return null;
    const human = !e.ref.bot;
    if (now - e.hurtMeAt < 4 || now - e.shotAtMeAt < 2 || (dr.hullBy === e.id && now - dr.hullHitAt < 4) || this.d.focus(this.p.team) === e.id) return e;
    if (human) return now - this.landAt < LANDING_GRACE ? null : e;
    return this.freeChoice(e, this.dist(e), e.downed ? 0.2 : e.hp, 1) ? e : null;
  },
  // Does a shot from the hull's centre reach them (or the vehicle they are in)?
  gunLine(v, e) {
    const dr = this.drive, now = this.now;
    if (dr.lineFor === e.id && now - dr.lineAt < 0.15) return dr.lineOk;
    const o = e.ref, hit = this.world.sweep(v.x, v.y, o.x, o.y, 8, this.p.id, this.p.team);
    const ok = !!hit && (hit.player === o || (!!o.vehicle && !!hit.solid && !!hit.solid.vehicle && hit.solid.vehicle.id === o.vehicle));
    dr.lineFor = e.id; dr.lineAt = now; dr.lineOk = ok;
    return ok;
  },

  // ---------------------------------------------------------------- artillery
  runArtillery(v) {
    const p = this.p, out = this.out, now = this.now, dr = this.drive;
    if (!v.fixed) {
      // Self-propelled: set up somewhere quiet inside the circle; move off when somebody comes for us or the storm does.
      const threat = this.artyThreat(v);
      if (threat) {
        const x = v.x + threat.x * 1400, y = v.y + threat.y * 1400, C = this.W.CONFIG;
        dr.relocate = this.W.U.insideIsland(x, y, v.r + 200, C.worldSize, C.cornerRadius) ? { x, y, tol: 200, until: now + 12 }
          : { x: this.storm.x || v.x - threat.x * 1400, y: this.storm.y || v.y - threat.y * 1400, tol: 200, until: now + 12 };
      } else if (this.storm.soon && !this.inSafe(v.x, v.y, 200) && !dr.relocate) dr.relocate = { x: this.storm.x, y: this.storm.y, tol: 160, until: now + 40, storm: true };
      if (dr.relocate && (now > dr.relocate.until || Math.hypot(dr.relocate.x - v.x, dr.relocate.y - v.y) < dr.relocate.tol + 40)) dr.relocate = null;
      if (dr.relocate) {
        if (p.vehicleWeapon !== 0) { out.slot = 0; return; }
        return this.driveToward(v, dr.relocate, 1);
      }
      if (p.vehicleWeapon !== 1) {
        out.mx = 0; out.my = 0;
        if (Math.hypot(v.vx, v.vy) < 40) out.slot = 1;              // stop, then switch to the targeting map
        return;
      }
    }
    this.artilleryFire(v);
  },
  artyThreat(v) {
    const dr = this.drive, now = this.now;
    let best = null, bd = 850;
    for (const r of this.known.values()) {
      if (!r.noticed || !r.visible || r.downed || r.dropping) continue;
      const d = Math.hypot(r.x - v.x, r.y - v.y);
      // A person coming this way means it; another bot only once it is right here or has started on the hull.
      if (r.ref.bot && d > 320 && !(dr.hullBy === r.id && now - dr.hullHitAt < 4)) continue;
      if (d < bd) { bd = d; best = r; }
    }
    return best ? { x: (v.x - best.x) / (bd || 1), y: (v.y - best.y) / (bd || 1) } : null;
  },
  artilleryFire(v) {
    const now = this.now, dr = this.drive;
    if (now >= dr.scanAt) { dr.scanAt = now + 0.5; this.watchIsland(v); }
    if (dr.aimAt) this.clickAt = dr.aimAt;                          // the crosshair stays where the last shell went
    if (!this.world.artilleryReady(v)) { dr.pick = null; return; }
    if (!dr.pick || now > dr.pick.until) dr.pick = this.artyPick(v);
    const t = dr.pick;
    if (!t || t.none || now < t.at) return;
    const pt = this.artyAim(t);
    dr.pick = null;
    if (!pt) return;
    this.clickAt = dr.aimAt = pt;
    this.out.artilleryFire = true;
    dr.lastShotAt = now;
    this.d.noteShell(t.id);
  },
  // What the targeting map shows: every enemy dot (or the vehicle they sit in), and how long each has kept still.
  watchIsland(v) {
    const now = this.now, world = this.world, p = this.p, watch = this.watch;
    for (const o of world.players) {
      if (!o.alive || o.team === p.team || o.dropT > 0 || (o.fx && o.fx.invisible > 0)) { watch.delete(o.id); continue; }
      const hv = o.vehicle ? world.vehicleById(o.vehicle) : null, x = hv ? hv.x : o.x, y = hv ? hv.y : o.y, hid = hv ? hv.id : 0;
      let w = watch.get(o.id);
      if (!w || w.hull !== hid || Math.hypot(x - w.ax, y - w.ay) > 45) { w = { ax: x, ay: y, since: now, hull: hid }; watch.set(o.id, w); }
      w.x = x; w.y = y; w.seen = now;
    }
  },
  // The best dot to shell: someone who has kept still for a while (looting, healing, camping, crewing a gun).
  artyPick(v) {
    const now = this.now, world = this.world, prof = this.prof, dr = this.drive;
    let best = null, bs = -Infinity;
    for (const [id, w] of this.watch) {
      const o = world.playerById(id);
      if (!o || !o.alive || now - w.seen > 0.8) continue;
      const still = now - w.since, d = Math.hypot(w.x - v.x, w.y - v.y), human = !o.bot;
      // (Closer than 600 the blast reaches our own hull. A bot has to have been standing there a while longer than a
      // person: every gun on the island is crewed now, and one that fired at every bot that stopped to open a crate
      // would do most of the lobby's killing.)
      // (How long is by the match's pace, like every fight between bots: with too many of the lobby still alive a
      // crew settles for a shorter standstill.)
      if (still < (human ? 1.4 : this.d.keen > 1.5 ? 2.5 : 3.5) || d < 600 || !this.d.shellOk(id, human)) continue;
      // Nobody is shelled at an Upgrade Station: it is the one place a player has to stand still (reading the class
      // tree), and with every gun crewed nearly half the bots that artillery killed died standing at one.
      if (this.d.atStation(w.x, w.y)) continue;
      // Nor somebody who is down, or the teammate kneeling over them: that shell wipes a team that had a chance.
      if (o.downed || world.players.some((q) => q.downed && q.alive && q.team === o.team && Math.hypot(q.x - w.x, q.y - w.y) < 160)) continue;
      if (human && world.time < 50) continue;                        // nobody is shelled straight off the parachute
      let s = Math.min(still, 8) * 1.5 - d / 5000 + (1 - o.hp / o.maxHp) * 2;
      if (w.hull) {
        const hv = world.vehicleById(w.hull);
        if (!hv || hv.wreck) continue;
        // Gun against gun settles nothing but both guns, and a parked tank is five shells' work for a dozen guns
        // (with the whole lobby crewing the artillery there was no gun left after a minute and no tank after three):
        // another bot's gun or tank is left alone until late on, unless it has just landed one on ours.
        if (hv.type !== 'humvee' && !human && !this.d.late && !(dr.hullBy === id && now - dr.hullHitAt < 30)) continue;
        s += hv.type === 'tank' ? -4 : hv.type === 'artillery' ? 3 : 2;   // a gun crew is going nowhere; a tank hardly notices
      }
      if (s > bs) { bs = s; best = { id, human, at: 0, until: 0 }; }
    }
    if (!best) return { none: true, until: now + this.vrng.range(1.5, 3) };
    // Whether to fire at all: a person is fair game; other bots follow the lobby's pace, like every other fight between them.
    const keen = best.human ? this.d.humanKeen : clamp(this.d.keen, 0, 2.5) * 0.2;
    if (this.vrng.next() >= keen) return { none: true, until: now + this.vrng.range(2, 4) };
    best.at = now + this.vrng.range(0.3, 1.2) * prof.hesitation; best.until = now + 4;
    return best;
  },
  // Where the shell goes: on the dot, give or take a hand's worth of map (a weaker bot clicks wider).
  artyAim(t) {
    const w = this.watch.get(t.id), now = this.now, S = this.W.CONFIG.worldSize, r = this.vrng;
    if (!w || now - w.seen > 0.8 || now - w.since < 1.2) return null;   // they have started moving again
    const sigma = lerp(170, 50, this.prof.skill), g = () => (r.next() + r.next() + r.next() + r.next() - 2) * 1.732;
    return { x: clamp(w.x + g() * sigma, 0, S), y: clamp(w.y + g() * sigma, 0, S) };
  }
});

export { SETTLE_PAD };
