// Bot combat: who to fight, whether to fight at all, how to move in a firefight, weapon handling,
// class gear (hand grenades, medkit, command radar), running away, and sitting on a turret.
import { Bot, clamp, lerp, TAU } from './bot.mjs';

// Per weapon: [closest comfortable distance, farthest comfortable distance, farthest it bothers shooting].
const BANDS = {
  ar: [240, 520, 900], pistol: [200, 430, 760], commandpistol: [200, 430, 760], sniper: [620, 1050, 1700], sniper2: [700, 1300, 2600],
  shotgun: [0, 150, 420], shotgun2: [0, 170, 440], deagle: [240, 560, 900], revolver: [260, 600, 900],
  launcher: [300, 560, 660], launcher2: [320, 600, 700], flamethrower: [0, 190, 290], minigun: [200, 480, 820], turret: [0, 900, 1050]
};
const TOO_CLOSE = { sniper: 260, sniper2: 260, launcher: 210, launcher2: 210 };   // step back (or swap) inside this
const CLOSE = { shotgun: 1, shotgun2: 1, flamethrower: 1 };
const LANDING_GRACE = 14;   // seconds after landing in which no bot picks a fight with a person unprovoked
const POWER = { ar: 1, pistol: 0.6, commandpistol: 0.9, sniper: 1.3, sniper2: 1.5, shotgun: 1.5, shotgun2: 1.8, deagle: 1, revolver: 1,
  launcher: 0.9, launcher2: 1.2, flamethrower: 1.6, minigun: 1.3 };

function fit(id, dist, band) {
  const b = band || BANDS[id];
  if (!b) return 0;
  if (dist > b[2]) return 0.02;
  if (TOO_CLOSE[id] && dist < TOO_CLOSE[id]) return 0.12;
  if (dist < b[0]) return 0.55 + 0.45 * dist / b[0];
  if (dist <= b[1]) return 1;
  return 1 - 0.8 * (dist - b[1]) / (b[2] - b[1]);
}

Object.assign(Bot.prototype, {
  weaponDef() { return this.W.WEAPONS[this.p.weapons[this.p.slot].id]; },
  // Has a close-range primary and the temperament to use it.
  closeClass() { return !!CLOSE[this.p.weapons[0].id]; },
  pusher() { return this.closeClass() && this.prof.aggression > 0.3; },
  band(def) {
    def = def || this.weaponDef();
    const b = BANDS[def.id] || BANDS.ar;
    if (def.kind === 'launcher') return [b[0], Math.min(b[1], def.range - 60), def.range - 20];
    if (def.kind === 'flame') return [b[0], b[1] * def.range / 300, def.range - 10];
    return b;
  },

  // ---------------------------------------------------------------- targets
  pickTarget() {
    const now = this.now, focus = this.d.focus(this.p.team);
    let best = null, bestScore = -Infinity;
    for (const rec of this.known.values()) {
      if (!rec.noticed || rec.dropping || !rec.ref.alive || rec.lost) continue;
      const age = now - rec.seenAt;
      if (age > 3.5 && !rec.revealed) continue;
      const d = this.dist(rec);
      if (d > 2400) continue;
      let score = 1000 - d * 0.6 + (1 - rec.hp) * 200;
      if (now - rec.hurtMeAt < 3) score += 350;
      if (rec.visible) score += 150;
      if (rec === this.target) score += 130;
      const c = this.engage.get(rec.id);
      if (c && c.fight && now < c.until) score += 250;      // the one we made up our mind to fight
      if (rec.downed) score -= 450;
      if (focus === rec.id) score += 140;
      if (score > bestScore) { bestScore = score; best = rec; }
    }
    if (best !== this.target) { this.target = best; this.coverSpot = null; }
    return best;
  },

  foesNear() { let n = 0; for (const r of this.known.values()) if (r.noticed && !r.downed && !r.dropping && this.now - r.seenAt < 2 && this.dist(r) < 750) n++; return n; },
  friendsNear() { let n = 1; for (const m of this.mates) if (!m.downed && this.dist(m) < 650) n++; return n; },
  // 'fight' | 'flee' | 'avoid' | 'ignore' toward the current target.
  stance(e) {
    const p = this.p, now = this.now, prof = this.prof, d = this.dist(e), hp = this.hpFrac(), human = !e.ref.bot;
    const early = now - this.landAt < 45 && this.W.CLASSES[p.classId].tier === 0;        // nothing to win yet: most people loot first
    // They hit us, their bullets are flying past us, or they are right in our face: within arm's reach, or in the
    // same room (nobody loots a house with an armed stranger standing in it). Right after landing two bots that
    // bump into each other just walk on, and while the lobby is thinning too fast it takes a closer brush.
    const here = this.cover.info.get(p.id), there = e.visible ? this.cover.info.get(e.id) : null;
    const sameRoom = !!here && !!there && here.building >= 0 && here.building === there.building;
    const inFace = human ? d < (early ? 80 : 115) || (sameRoom && !early) : !early && (d < (this.d.heat > -0.4 ? 120 : 85) || sameRoom);
    let teamFight = this.mates.length > 0 && d < 950 && this.d.focus(p.team) === e.id;     // a teammate is already shooting at them
    const provoked = now - e.hurtMeAt < 3 || now - e.shotAtMeAt < 1.5;
    if (teamFight && human && !provoked && !this.mates.some((m) => !m.bot)) {
      // A team of bots does not land on a person all at once: the second gun takes a moment to turn up, so the
      // first seconds of that fight are one against one (and the person's own teammates have time to turn round).
      let j = this.joinFor;
      if (!j || j.id !== e.id || now - j.at > 15) j = this.joinFor = { id: e.id, at: now + this.rng.range(1.5, 3.5) };
      if (now < j.at) teamFight = false;
    }
    const threatened = provoked || inFace || teamFight;
    const foes = this.foesNear(), friends = this.friendsNear();
    const eHp = e.downed ? 0.2 : e.hp;
    // Losing: health is low, or the exchange is going so badly that it will be over in a couple of seconds
    // (health bars are visible, so both sides of that sum are things a player can see).
    // (Before any of our own bullets have landed, assume we will hit about as well as usual.)
    const inRate = Math.max(this.inHeat / 1.5, this.inBurst * 1.4), outRate = Math.max(this.outHeat / 1.5, e.visible ? 18 : 4);
    const myLife = (p.hp + p.armor) / Math.max(4, inRate), theirLife = (e.visible ? e.ref.hp : e.hp * e.ref.maxHp) / outRate;
    // With a way out in the hotbar (a boulder, a potion) a bot bails sooner: there is no point holding it until it is too late.
    const outs = this.slotOf('rock', 'invisibility', 'snowbomb', 'smoke') >= 0 ? 0.8 : 0;
    const dying = inRate > 12 && myLife < 1.4 + prof.caution * 2.6 + outs && myLife < theirLife * 0.65;
    const losing = (hp < prof.fleeHp && eHp > hp * 0.8) || dying, swamped = foes >= friends + 2 && hp < 0.85;
    // Turning your back in the open just gets you shot in it: only run when there is somewhere (or something) to run with.
    if (threatened) return (losing || swamped) && this.escapePlan(e, d) ? 'flee' : 'fight';
    // In no state to start anything. Hurt, with one of them in plain view: back off somewhere quiet (and patch up there).
    if (losing || swamped) return losing && e.visible && d < 520 && !e.downed && !this.d.endgame && now >= (this.fleeTired || 0) ? 'avoid' : 'ignore';
    if (e.downed) return prof.aggression > 0.35 && d < 600 && foes <= 1 ? 'fight' : 'ignore';   // finish them when it is cheap
    // A free choice: pick this fight or leave them be. It is remembered, so a bot does not dither at the edge of
    // a fight; it thinks again when the other one turns up hurt.
    let c = this.engage.get(e.id);
    if (!c || now > c.until || (!c.fight && !human && eHp < c.hp - 0.3)) {
      const a = prof.aggression, storm = this.world.storm;
      const phase = storm ? storm.phase : 0, endgame = this.d.endgame || phase >= 4;
      let want;
      if (human) {
        // Toward a person: keener than toward another bot, but still a choice, and one that follows the arc of a
        // match. Nearly everyone loots first after landing; through the middle of the match a bot picks this fight
        // about one time in ten that it thinks about it (a bold one one time in four, a timid one hardly ever); once
        // the circle is small, most do. Whoever shoots at a bot gets a fight regardless.
        want = (early ? 0.01 + a * a * a * 0.1 : 0.02 + a * a * 0.3 + (phase >= 3 ? 0.2 : phase >= 2 ? 0.09 : 0)) * this.d.humanKeen;
        want += (1 - eHp) * 0.1 + (endgame ? 0.3 : 0);
        // No ganging up: while some other bot is on this person, the rest mostly stay out of it.
        const others = this.d.aggressors(e.id, p.id);
        if (others > 0) want *= endgame ? 0.5 : 0.15;
      } else {
        // Toward each other bots are choosier, and how choosy follows the match's pace (see the director): it keeps
        // the island populated for the whole match instead of settling everything in the first three minutes.
        want = early ? 0.003 + Math.pow(a, 4) * 0.07 : (0.04 + a * a * a * 0.25 + (phase >= 3 ? 0.2 : phase >= 2 ? 0.08 : 0)) * (0.6 + hp * 0.5);
        want += (1 - eHp) * (0.1 + a * 0.25) + (endgame ? 0.3 : 0);                        // easy prey
        want *= phase >= 5 ? Math.max(1, this.d.keen) : phase >= 4 ? Math.max(0.6, this.d.keen) : this.d.keen;
        // A bot that is busy shooting someone else is worth a flank.
        const busyWith = this.d.attackerOf(e.id, 3);
        if (busyWith && busyWith !== p.id && this.d.teamOf(busyWith) !== p.team) want *= 1.3;
      }
      if (d > this.band()[2]) want -= 0.3;
      if (this.storm.must) want -= 0.25;
      if (this.mode === 'fight' && this.target === e) want += 0.25;
      // Everyone has only just landed: nobody opens fire on a person who has not done anything yet (it thinks again in a moment).
      const fresh = human && now - this.landAt < LANDING_GRACE;
      const fight = !fresh && this.rng.next() < want;
      c = { fight, hp: eHp, until: fresh ? this.landAt + LANDING_GRACE + this.rng.range(0, 6)
        : now + (fight ? this.rng.range(4, 8) : endgame ? this.rng.range(4, 9) : human ? this.rng.range(25, 50) : this.rng.range(45, 90)) };
      this.engage.set(e.id, c);
      if (this.engage.size > 40) this.engage.delete(this.engage.keys().next().value);
    }
    return c.fight ? 'fight' : 'ignore';
  },

  // ---------------------------------------------------------------- weapons
  chooseWeapon(dist) {
    const p = this.p, W = this.W, now = this.now;
    let best = -1, bestScore = -1;
    for (let i = 0; i < p.weapons.length; i++) {
      const w = p.weapons[i], id = w.id;
      if (!BANDS[id]) continue;
      let s = fit(id, dist, this.band(W.WEAPONS[id])) * (POWER[id] || 1);
      if (w.reloading) s *= 0.55; else if (W.WEAPONS[id].mag && w.ammo <= 0) s *= 0.4;
      if (i === p.slot) s *= 1.3;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    if (best < 0 || best === p.slot) return;
    const cur = p.weapons[p.slot], forced = !BANDS[cur.id];
    // Swapping because the gun ran dry is something only better players think of in the moment.
    if (!forced && (cur.reloading || cur.ammo <= 0) && this.rng.next() > this.prof.swapSense) { this.swapAt = now + 1.2; return; }
    if (forced || now >= this.swapAt) { this.out.slot = best; this.swapAt = now + this.rng.range(1.0, 1.9); }
  },
  // Would a bullet fired now reach them (or at least some enemy)?
  shotClear(rec) {
    const now = this.now;
    if (this.shotFor === rec.id && now - this.shotAt < 0.12) return this.shotOk;
    const p = this.p, def = this.weaponDef(), o = rec.ref;
    const mount = p.mount ? this.world.structById(p.mount) : null, ox = mount ? mount.x : p.x, oy = mount ? mount.y : p.y;
    this.shotBlocker = null;
    let ok;
    if (def.kind === 'flame') ok = this.world.lineClear(ox, oy, o.x, o.y, o.vehicle ? this.world.vehicleById(o.vehicle) : null);
    else {
      const hit = this.world.sweep(ox, oy, o.x, o.y, def.bulletRadius || 5, p.id, p.team);
      if (hit && hit.solid && hit.solid.plant) this.shotBlocker = hit.solid.plant;
      ok = !!hit && (!!hit.player || !!(o.vehicle && hit.solid && hit.solid.vehicle && hit.solid.vehicle.id === o.vehicle && !hit.solid.vehicle.wreck));
    }
    this.shotFor = rec.id; this.shotAt = now; this.shotOk = ok;
    return ok;
  },
  // Walkable trunks can block a shot even when two opponents have already
  // reached each other. Clear that cover instead of waiting inside chase tolerance.
  clearFoliageLane(def) {
    const plant = this.shotBlocker, p = this.p;
    if (!plant || plant.alive === false || !def.bulletSpeed || this.dist(plant) > def.range * .9) return false;
    const dx = p.x - plant.x, dy = p.y - plant.y, distance = Math.hypot(dx, dy);
    // The muzzle starts ahead of the player. Step out of the trunk before
    // aiming at it, otherwise shots can spawn on the far side and never hit it.
    if (distance < 100) {
      const e = this.target, ax = distance > 1 ? dx : e ? p.x - e.x : 1, ay = distance > 1 ? dy : e ? p.y - e.y : 0;
      this.moveDir = this.safeDir(ax, ay) || this.safeDir(-ay, ax) || this.safeDir(ay, -ax);
      this.look = plant;
    } else this.shoot = { x: plant.x, y: plant.y, r: plant.hitRadius, def, plant };
    return true;
  },
  strafeNow() {
    if (this.now >= this.strafeUntil) {
      this.strafeDir = this.rng.next() > this.prof.strafe ? 0 : this.rng.next() < 0.5 ? 1 : -1;
      this.strafeUntil = this.now + this.rng.range(0.45, 1.5);
    }
    return this.strafeDir;
  },

  // ---------------------------------------------------------------- cover
  // The nearest spot a straight dash away that puts something solid between us and (x, y).
  findCover(x0, y0) {
    const p = this.p, nav = this.nav, world = this.world, dist = Math.hypot(x0 - p.x, y0 - p.y);
    let best = null, bestScore = -Infinity;
    const base = this.rng.range(0, TAU);
    for (let ring = 0; ring < 3; ring++) {
      const R = 110 + ring * 110;
      for (let k = 0; k < 10; k++) {
        const a = base + k / 10 * TAU, x = p.x + Math.cos(a) * R, y = p.y + Math.sin(a) * R;
        if (!nav.freeAt(x, y) || nav.pondAt(x, y)) continue;
        if (world.lineClear(x, y, x0, y0)) continue;              // still in the open
        if (!nav.segmentClear(p.x, p.y, x, y)) continue;          // has to be a straight dash
        const score = -R - (Math.hypot(x - x0, y - y0) < dist - 40 ? 90 : 0);
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
      if (best) break;
    }
    return best;
  },
  coverFrom(e) {
    if (this.coverSpot && this.now - this.coverAt < 0.8) return this.coverSpot.none ? null : this.coverSpot;
    const best = this.findCover(e.x, e.y);
    this.coverAt = this.now;
    this.coverSpot = best || { none: true };
    return best;
  },
  // How would we get away from them? null when running would only mean being shot in the back: then a bot stays in
  // the fight (and uses what it has, a boulder say, as cover in it).
  escapePlan(e, d) {
    const now = this.now;
    if (d < 110 || (this.fleeTired && now < this.fleeTired)) return null;
    const heal = this.hasHeal() || this.p.regen > 0;
    if (this.slotOf('invisibility', 'snowbomb') >= 0) return 'item';             // they cannot follow what they cannot see, or at half speed
    const home = this.home && this.world.structById(this.home.id);
    if (home && home.alive && !home.pair && this.p.openPad === home.id && this.dist(home) > 450 && this.inZone(home.x, home.y, 0) && this.slotOf('teleporter') >= 0) return 'item';
    if (heal && this.slotOf('rock', 'smoke', 'poison') >= 0) return 'item';       // break the line of fire, then patch up
    if ((heal || d > 300) && this.coverFrom(e)) return 'cover';
    if (d > 560) return 'range';
    return null;
  },

  // ---------------------------------------------------------------- the firefight
  doFight() {
    const p = this.p, e = this.target, now = this.now, prof = this.prof, world = this.world;
    if (!e || !e.ref.alive) { this.target = null; this.redecide = true; return; }
    const o = e.ref, live = e.visible, tx = live ? o.x : e.x, ty = live ? o.y : e.y;
    const dx = tx - p.x, dy = ty - p.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
    if (now >= (this.swapCheck || 0)) { this.swapCheck = now + 0.4; this.chooseWeapon(dist); }
    const w = p.weapons[p.slot], def = this.W.WEAPONS[w.id], lob = def.kind === 'launcher';
    // A shotgunner or pyromancer who means it closes the distance, firing the sidearm on the way in.
    const band = this.pusher() && !CLOSE[def.id] ? [0, BANDS[p.weapons[0].id][1], this.band(def)[2]] : this.band(def);
    if (!live) {
      // Lost them: push to where they were, or let it go.
      this.look = { x: e.x, y: e.y };
      if (now - e.seenAt > lerp(1.5, 5, prof.aggression)) { e.lost = true; this.engage.set(e.id, { fight: false, until: now + 4 }); this.target = null; this.redecide = true; return; }   // (lost: until they show themselves again)
      if (prof.aggression > 0.4 || e.hp < 0.45) this.moveGoal = { x: e.x, y: e.y, tol: 70 };
      return;
    }
    const clear = lob ? true : this.shotClear(e);
    if (!clear && this.clearFoliageLane(def)) return;
    const reloading = w.reloading && w.reloadT > 0.6, hp = this.hpFrac();
    if (now - this.coverRollAt > 3) { this.coverRollAt = now; this.coverWanted = this.rng.next() < prof.coverUse; }
    let placed = false;
    if (this.coverWanted && dist > 220 && (reloading || (hp < 0.4 && now - this.hurtAt < 2))) {
      // Reload and bleed behind something solid, when there is something solid.
      const c = this.coverFrom(e);
      if (c) { if (this.arrivedAt(c, 20)) this.still = true; else this.moveGoal = { x: c.x, y: c.y, tol: 16 }; placed = true; }
    }
    if (!placed) {
      if (!clear) this.moveGoal = { x: tx, y: ty, tol: 70 };                               // walk around whatever is in the way (the moment there is a line, the distance rules below take over)
      else {
        // Someone coming at us with a shotgun or a flamethrower: keep them at arm's length (unless that is our game too).
        const theirs = o.weapons[o.slot] ? o.weapons[o.slot].id : '';
        const near = Math.max(band[0], TOO_CLOSE[def.id] || 0, CLOSE[theirs] && !CLOSE[def.id] && !this.pusher() ? 330 : 0);
        let radial = dist > band[1] ? 1 : dist < near ? -1 : 0;
        if (radial > 0 && band[1] < 300 && (reloading || now < (this.holdPush || 0))) radial = 0; // no charging in with an empty gun, or before the flashbang is thrown
        if (e.downed && radial < 0) radial = 0;
        const strafe = this.strafeNow(), k = radial ? 0.7 : 1;
        let v = this.safeDir(ux * radial - uy * strafe * k, uy * radial + ux * strafe * k);
        if (!v && strafe) { this.strafeDir = -strafe; v = radial ? this.safeDir(ux * radial, uy * radial) : null; }
        this.moveDir = v;
      }
    }
    if (clear && dist <= band[2] && !(lob && dist < 190)) { this.shoot = { rec: e, def }; this.d.setFocus(p, e.id); } // "on this one": teammates pile in
    else this.look = { x: tx, y: ty };
    if (!o.bot) this.d.noteAggro(o.id, p);
    this.useGear(e, dist, clear);
  },

  // Shoot at someone without committing the feet to it.
  fireBack(e) {
    const p = this.p, def = this.weaponDef(), d = this.dist(e);
    if (!BANDS[def.id]) { this.chooseWeapon(d); return; }
    if (d > this.band(def)[2] || (def.kind === 'launcher' && d < 190)) return;
    if (def.kind !== 'launcher' && !this.shotClear(e)) return;
    this.shoot = { rec: e, def };
    if (p.weapons[p.slot].ammo <= 0 && this.now >= (this.swapCheck || 0)) { this.swapCheck = this.now + 0.4; this.chooseWeapon(d); }
  },

  // ---------------------------------------------------------------- class gear
  gearKind() {
    const p = this.p, W = this.W;
    if (p.classId === 'commander') return 'command';
    for (const w of p.weapons) { const k = W.WEAPONS[w.id].kind; if (k === 'throwable') return 'grenade'; if (k === 'medkit') return 'medkit'; }
    return null;
  },
  // Where a thrown thing should land to catch a target that keeps moving (bots only half believe their own lead).
  throwPoint(e, fuse) {
    const p = this.p, d = this.dist(e), t = Math.max(fuse || 0, 0.35 + d / 900) * this.prof.lead * 0.6;
    const o = e.visible ? e.ref : e;
    const noise = (12 + d * 0.06) * (1.5 - this.prof.skill);
    return { x: o.x + (o.vx || 0) * t + this.gauss() * noise, y: o.y + (o.vy || 0) * t + this.gauss() * noise };
  },
  isStill(e) { return this.now - e.stillSince > 0.7 || !!e.mounted || e.downed; },
  useGear(e, dist, clear) {
    const p = this.p, now = this.now, out = this.out;
    if (now < this.gearAt || this.act || p.held >= 0) return;
    const kind = this.gearKind();
    if (kind === 'grenade') {
      // Hand grenades: for people who stand still or hide, never point blank.
      if (p.grenades <= 0 || p.throwCd > 0 || dist < 230 || dist > 600) return;
      if (!(this.isStill(e) || !clear || e.hp < 0.35) || !this.ready('gear-nade', true)) return;
      const pt = this.throwPoint(e, 1.6);
      if (Math.hypot(pt.x - p.x, pt.y - p.y) < 215) return;
      this.clickAt = pt; out.utility = true; this.hes.delete('gear-nade');
      this.gearAt = now + this.rng.range(1.6, 4.2);
    } else if (kind === 'command') {
      if ((p.commandCd || 0) > 0 || dist > 1100 || !this.ready('gear-cmd', true)) return;
      const pt = this.strikePoint(e);
      if (!pt) { this.gearAt = now + 1.5; return; }
      this.clickAt = pt; out.utility = true; this.hes.delete('gear-cmd');
      this.gearAt = now + 2;
    }
  },
  // The airstrike kills everyone under it, friends included: drop it on them only if all of us are well clear.
  strikePoint(e) {
    const p = this.p, R = this.W.WEAPONS.commandradar.strikeRadius + 130;
    const safe = (x, y) => {
      if (Math.hypot(x - p.x, y - p.y) < R) return false;
      for (const m of this.mates) if (Math.hypot(x - m.x, y - m.y) < R) return false;
      return true;
    };
    if (safe(e.x, e.y)) return { x: e.x, y: e.y };
    const d = this.dist(e) || 1, ux = (e.x - p.x) / d, uy = (e.y - p.y) / d;
    for (const push of [380, 620]) { const x = e.x + ux * push, y = e.y + uy * push; if (safe(x, y)) return { x, y }; } // cut off their way back
    return null;
  },

  // ---------------------------------------------------------------- running away
  // `calm`: nobody is shooting yet; we are only getting out of a stranger's sight while hurt.
  startFlee(e, calm) {
    if (this.mode !== 'flee' || !this.fleeing) { this.fleeing = { since: this.now, safeAt: 0, spot: null, pickAt: 0, from: e || null, exposedAt: -9, exposed: true, calm: !!calm }; this.tPlan = 0; }
    else if (!calm) this.fleeing.calm = false;
    return this.setMode('flee');
  },
  hasHeal() {
    const p = this.p;
    for (const s of p.items) if (s && this.W.ITEMS[s.id].heal) return true;
    return this.gearKind() === 'medkit' && p.medkitCd <= 0;
  },
  // Out of their sight: is this a place to stop? With something to heal with, yes unless they are about to come
  // round the corner. With nothing, only once we are well away (or under leaves and not too close).
  fleeRest(e) {
    const p = this.p;
    if (!e) return true;
    const d = this.dist(e), hidden = this.cover.concealedSpot(p);
    if (this.hasHeal() || p.regen > 0) return d > 300 || hidden;
    return d > 650 || (hidden && d > 350);
  },
  fleeDone() {
    const f = this.fleeing, now = this.now;
    if (!f) return true;
    if (now - f.since > 16) { this.fleeTired = now + 8; return this.endFlee(); }
    if (!(f.safeAt && now - f.safeAt > 1.2)) return false;
    if (this.hpFrac() >= Math.min(0.85, this.prof.fleeHp + 0.3)) return this.endFlee();
    if (!this.hasHeal() && !(this.p.regen > 0) && f.restAt && now - f.restAt > 2) return this.endFlee();   // away, and this is as good as it gets
    return false;
  },
  endFlee() { this.fleeing = null; this.padWait = null; this.engage.clear(); this.route = null; return true; },
  fleeSpot(e, hiddenNow) {
    const p = this.p, nav = this.nav, world = this.world, tmp = [];
    const ex = e ? e.x : p.x - Math.cos(this.aimA) * 200, ey = e ? e.y : p.y - Math.sin(this.aimA) * 200;
    // First choice: the nearest thing to hide behind. Once behind it, the next stop is further off (in its shadow if possible).
    if (e && !hiddenNow && this.dist(e) > 200) { const c = this.findCover(ex, ey); if (c && this.inZone(c.x, c.y, 0)) return c; }
    const away = Math.atan2(p.y - ey, p.x - ex);
    let mate = null, md = 1500, fallen = null, fd = 900;
    for (const m of this.mates) { const d = this.dist(m); if (!m.downed) { if (d < md) { md = d; mate = m; } } else if (d < fd) { fd = d; fallen = m; } }
    let best = null, bestScore = -Infinity;
    for (let j = -4; j <= 4; j++) {
      for (const R of [420, 720]) {
        const a = away + j * 0.45, x = p.x + Math.cos(a) * R, y = p.y + Math.sin(a) * R;
        if (!nav.freeAt(x, y)) continue;
        let score = Math.hypot(x - ex, y - ey) * 0.5 - Math.abs(j) * 25 - (nav.pondAt(x, y) ? 160 : 0);
        if (!world.lineClear(x, y, ex, ey)) score += 300;                    // something solid in between
        if (this.cover.canopiesAt(x, y, tmp).length) score += 110;            // or at least leaves overhead
        if (!this.inZone(x, y, 60)) score -= 600;
        if (mate) score -= Math.hypot(x - mate.x, y - mate.y) * 0.15;
        if (fallen) score -= Math.hypot(x - fallen.x, y - fallen.y) * 0.3;   // not far from a teammate who needs picking up
        for (const h of this.hazards) if (Math.hypot(x - h.x, y - h.y) < h.r) score -= 400;
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    return best;
  },
  doFlee() {
    const f = this.fleeing, p = this.p, now = this.now;
    if (!f) { this.redecide = true; return; }
    let e = f.from && this.known.get(f.from.id);
    if (!e || !e.ref.alive) e = this.target || this.nearestKnown(1200);
    f.from = e || null;
    if (this.padWait) {
      // Standing on our teleporter pad: one second and we are gone.
      const pad = this.world.structById(this.padWait.id);
      if (!pad || !pad.alive || now > this.padWait.until) this.padWait = null;
      else { if (this.dist(pad) > 10) this.moveGoal = { x: pad.x, y: pad.y, tol: 6 }; else this.still = true; if (e) this.look = e; return; }
    }
    if (now - f.exposedAt > 0.2) {
      f.exposedAt = now;
      f.exposed = !!e && e.visible && this.dist(e) < 950 && this.world.lineClear(p.x, p.y, e.ref.x, e.ref.y);
    }
    if (f.exposed) f.safeAt = 0; else if (!f.safeAt) f.safeAt = now;
    const safe = f.safeAt && now - f.safeAt > 0.6;
    if (safe && this.fleeRest(e)) {
      this.still = true;                                   // catch our breath here; the item layer does the healing
      if (!f.restAt) f.restAt = now;
      if (e) this.look = e;
    } else {
      f.restAt = 0;
      if (!f.spot || now >= f.pickAt || this.arrivedAt(f.spot, 44) || (safe && !f.far)) { f.spot = this.fleeSpot(e, safe); f.far = !!safe; f.pickAt = now + 2.2; }
      if (f.spot) this.moveGoal = { x: f.spot.x, y: f.spot.y, tol: 30 };
    }
    // Movement and aim are independent: shoot back on the run, but only at whoever is actually after us.
    if (e && e.visible && !this.still && (now - e.hurtMeAt < 4 || now - e.shotAtMeAt < 2)) this.fireBack(e);
  },

  // ---------------------------------------------------------------- on a turret
  thinkMounted() {
    const p = this.p, now = this.now, out = this.out, s = this.world.structById(p.mount);
    if (!s) return;
    if (this.act || this.queue.length) { this.act = null; this.queue.length = 0; this.holding = false; }   // (it would keep the trigger locked)
    if ((this.tDecide -= this.dt) <= 0) { this.tDecide = this.prof.decideEvery; this.updateStorm(); this.pickTarget(); }
    const e = this.target, def = this.W.WEAPONS.turret;
    let firing = false;
    if (e && e.visible && Math.hypot(e.x - s.x, e.y - s.y) < BANDS.turret[2] && this.shotClear(e)) { this.shoot = { rec: e, def }; firing = true; this.mountIdle = 0; }
    else { this.mountIdle += this.dt; if (e) this.look = e; }
    const close = e && Math.hypot(e.x - p.x, e.y - p.y) < 120 && !firing;
    const hurt = this.hpFrac() < 0.35 && now - this.hurtAt < 1.2;
    if (now - this.mountAt > 0.8 && (this.evade || this.storm.must || hurt || close || this.mountIdle > 3.5 + this.prof.caution * 3)) {
      out.interactPressed = true;                          // get off: a grenade, the storm, too hurt, flanked, or nobody left to shoot
      this.mountIdle = 0;
      this.redecide = true;
    }
  },

  // ---------------------------------------------------------------- big sentries
  // A Sentry II or III kills whatever walks into its 720 range, and it never leaves. When one sits where the
  // storm is about to send everyone, the answer is the one a player finds: most guns outrange it, so stand
  // outside its reach and shoot it down.
  pickSiege() {
    const p = this.p, W = this.W, st = this.storm, storm = this.world.storm, now = this.now;
    let best = null, bd = Infinity;
    for (const s of this.world.structures) {
      if (s.kind !== 'sentry' || !s.alive || s.team === p.team || (this.siegeBan.get(s.id) || 0) > now) continue;
      const it = W.ITEMS[s.item];
      if (this.smallSentry(s) && this.gunFor(it.range) >= 0) continue;                 // the basic one is shot on sight (see runMode)
      const d = this.dist(s);
      if (d > it.range + 1000 || d >= bd) continue;
      const circle = storm ? (storm.next || storm) : null;
      const inTheWay = (st.fixed && Math.hypot(st.x - s.x, st.y - s.y) < it.range + 80) || (circle && circle.r < 1700 && Math.hypot(circle.x - s.x, circle.y - s.y) < circle.r + it.range * 0.5);
      if (!inTheWay) continue;
      let slot = -1, reach = 0;
      for (let i = 0; i < p.weapons.length; i++) { const def = W.WEAPONS[p.weapons[i].id]; if (def.bulletSpeed && def.range > reach && !def.pellets) { reach = def.range; slot = i; } }
      if (slot < 0 || reach < it.range + 150) continue;                                // nothing that outranges it by enough
      best = { s, slot, reach, keep: Math.min(reach - 60, it.range + 150), range: it.range, spot: null, spotAt: 0, hp: s.hp, progAt: now }; bd = d;
    }
    // The same job as a moment ago: keep the firing spot we were walking to.
    const cur = this.siege;
    if (best && cur && cur.s === best.s && cur.slot === best.slot) return true;
    this.siege = best;
    return !!best;
  },
  doSiege() {
    const S = this.siege, p = this.p, now = this.now;
    if (!S || !S.s.alive) { this.siege = null; this.redecide = true; return; }
    const s = S.s, d = this.dist(s) || 1;
    // Getting nowhere (no clear line from anywhere we can stand, or someone keeps patching it up): leave it for now.
    if (s.hp < S.hp - 4 || now - (S.ranAt || 0) > 1) { S.hp = s.hp; S.progAt = now; }   // (back at it after doing something else: the clock starts again)
    S.ranAt = now;
    if (now - S.progAt > 14) { this.siegeBan.set(s.id, now + 40); this.siege = null; this.redecide = true; return; }
    if (p.slot !== S.slot && now >= this.swapAt && !this.act) { this.out.slot = S.slot; this.swapAt = now + 0.8; }
    this.look = s;
    if (p.slot === S.slot && d > S.range + 50 && d < S.reach - 20) {
      const def = this.weaponDef(), hit = this.world.sweep(p.x, p.y, s.x, s.y, def.bulletRadius || 5, p.id, p.team);
      if (hit && hit.solid && hit.solid.struct === s) { this.shoot = { x: s.x, y: s.y, r: s.r, def, struct: s }; this.still = true; return; }
    }
    // Walk to the firing line: the nearest place just outside its reach that has a clear line to it.
    if (!S.spot || now >= S.spotAt || this.arrivedAt(S.spot, 30)) {
      S.spot = this.siegeSpot(S); S.spotAt = now + 4;
      if (!S.spot) { this.siegeBan.set(s.id, now + 25); this.siege = null; this.redecide = true; return; }
    }
    this.moveGoal = { x: S.spot.x, y: S.spot.y, tol: 24 };
  },
  siegeSpot(S) {
    const p = this.p, s = S.s, nav = this.nav, br = this.W.WEAPONS[p.weapons[S.slot].id].bulletRadius || 5;
    const base = Math.atan2(p.y - s.y, p.x - s.x);
    let best = null, bs = Infinity;
    for (let k = 0; k <= 16; k++) {
      const a = base + Math.ceil(k / 2) * 0.2 * (k % 2 ? 1 : -1), x = s.x + Math.cos(a) * S.keep, y = s.y + Math.sin(a) * S.keep;
      const walk = Math.hypot(x - p.x, y - p.y);
      if (walk >= bs || walk < 36 || !nav.freeAt(x, y) || nav.pondAt(x, y) || !this.inZone(x, y, 0)) continue;   // (where we stand has no line, or we would be shooting)
      const hit = this.world.sweep(x, y, s.x, s.y, br, p.id, p.team);
      if (hit && hit.solid && hit.solid.struct === s) { bs = walk; best = { x, y }; }
    }
    return best;
  },

  // ---------------------------------------------------------------- looking for trouble
  pickHunt() {
    const p = this.p, now = this.now, prof = this.prof;
    if (now < this.huntHold || this.hpFrac() < Math.max(0.5, prof.fleeHp + 0.15) || this.foesNear() >= this.friendsNear() + 2) return false;   // hurt or outnumbered: not now
    const late = this.d.late || now > 300, strong = this.W.CLASSES[p.classId].tier >= 1 && this.hpFrac() > 0.7;
    if (!(late || (strong && prof.aggression > 0.55))) return false;
    const storm = this.world.storm, closing = storm && storm.phase >= 4;
    if (!closing && this.d.keen < 0.6) return false;                // the lobby is thinning fast enough without us going looking
    let pt = null, bd = Infinity;
    for (const rec of this.known.values()) {
      if (!rec.noticed || rec.dropping || now - rec.seenAt > 5) continue;
      if (!rec.ref.bot && !this.d.endgame && this.d.aggressors(rec.id, p.id) > 0) continue;   // a person some other bot is already on: no ganging up
      const d = this.dist(rec);
      if (d < bd && this.inZone(rec.x, rec.y, 0)) { bd = d; pt = { x: rec.x, y: rec.y, id: rec.id }; }
    }
    if (!pt && this.heard && now - this.heardAt < 8 && this.inZone(this.heard.x, this.heard.y, 0)) pt = { x: this.heard.x, y: this.heard.y, id: 0 };
    if (!pt) return false;
    this.huntAt = pt;
    return true;
  },
  doHunt() {
    const h = this.huntAt, now = this.now;
    if (!h) { this.redecide = true; return; }
    // Close enough to start something: that was the point of coming.
    const rec = h.id ? this.known.get(h.id) : null;
    if (rec && rec.visible && this.dist(rec) < Math.max(260, this.band()[1])) {
      this.engage.set(rec.id, { fight: true, hp: rec.downed ? 0.2 : rec.hp, until: now + this.rng.range(6, 10) });
      this.huntAt = null; this.huntHold = now + this.rng.range(3, 6); this.redecide = true;
      return;
    }
    // Got there and whoever it was has gone: look around for a moment before chasing the next noise.
    if (this.arrivedAt(h, 170)) { this.heard = null; this.huntAt = null; this.huntHold = now + this.rng.range(2, 5); this.redecide = true; return; }
    this.moveGoal = { x: h.x, y: h.y, tol: 150 };
  }
});

export { BANDS, TOO_CLOSE };
