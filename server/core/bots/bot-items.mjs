// Bot item play. A bot holds three item stacks and uses them the way a player who knows the game would:
// heals when it is safe to, buffs before a fight rather than in the middle of one, grenades and fire for people
// who stand still or hide, an escape (snowbomb on the chaser, a boulder in the line of fire, smoke, a teleporter
// home) when a fight is going badly, strikes on targets that cannot dodge them, and so on. Using an item takes the
// same steps it takes a player: select the slot, point, click, put it away, and no shooting in the meantime.
import { Bot, clamp } from './bot.mjs';

const THROW_MAX = 560;       // WEAPONS.grenade.throwRange
const CLOSE_GUNS = { shotgun: 1, shotgun2: 1, flamethrower: 1 };

Object.assign(Bot.prototype, {
  // ---------------------------------------------------------------- inventory helpers
  slotOf(...ids) {
    const items = this.p.items;
    for (const id of ids) for (let i = 0; i < items.length; i++) if (items[i] && items[i].id === id) return i;
    return -1;
  },
  // Hesitation: the first time a play becomes possible a timer starts; it only happens once the timer runs out
  // while the play is still on. Weaker bots take longer to think of it (and sometimes much longer).
  ready(key, on, urgent) {
    const now = this.now;
    let h = this.hes.get(key);
    if (!on) { if (h) this.hes.delete(key); return false; }
    if (!h || now - h.seen > 1.5) {
      const slow = this.rng.next() < this.prof.itemSense ? 1 : 3;
      // Being shot concentrates the mind: escapes come quicker than clever plays.
      h = { at: now + (urgent ? this.rng.range(0.02, 0.2) : this.rng.range(0.15, 0.9) * slow) * this.prof.hesitation, seen: now };
      this.hes.set(key, h);
      if (urgent) this.tPlan = Math.min(this.tPlan, h.at - now + 0.01);
    }
    h.seen = now;
    return now >= h.at;
  },
  startAct(a) {
    a.phase = 0; a.t = 0; a.tries = 0; a.sent = false;
    if (this.act) this.queue.push(a); else this.act = a;
    return true;
  },
  useItem(idx, opts) {
    const s = this.p.items[idx];
    if (!s) return false;
    return this.startAct(Object.assign({ kind: 'use', idx, id: s.id, aim: null }, opts || {}));
  },
  endAct(ok) {
    const a = this.act;
    this.act = null; this.holding = false;
    this.itemAt = this.now + 0.15;
    if (a && ok && a.then) a.then();
    if (!ok) this.queue.length = 0;
  },

  // ---------------------------------------------------------------- doing it (select, point, click)
  runItems() {
    const p = this.p, out = this.out, dt = this.dt;
    if (this.mountTry && this.now >= this.mountTry) {
      // Hop on the turret we just put down.
      this.mountTry = 0;
      if (this.world.nearestMountable(p) && !this.world.nearestItemPickup(p) && !this.world.nearestRecoverableRock(p)) {
        out.interactPressed = true; this.mountAt = this.now; this.mountIdle = 0;
        this.act = null; this.queue.length = 0; this.holding = false;
        return;
      }
    }
    if (!this.act) {
      if (this.queue.length) { const next = this.queue.shift(); if (!next.valid || next.valid()) this.act = next; }
      else if (!this.mountTry && (this.tPlan -= dt) <= 0) { this.tPlan = this.inBurst > 8 ? 0.1 : 0.25; if (p.itemCd <= 0 && this.now >= this.itemAt) this.planItems(); } // thinks faster while being shot
      if (!this.act) return;
    }
    const a = this.act, slot = p.items[a.idx];
    if (!slot || slot.id !== a.id) return this.endAct(a.phase >= 2);   // the stack is gone: we just used the last one (or lost it)
    a.t += dt;
    if (a.phase === 1 && p.held !== a.idx) { a.phase = 0; a.sent = false; a.t = 0; a.chargeAt = null; }   // it got put away (knocked down, mounted): take it out again
    if (a.phase === 0) {
      if (p.held !== a.idx) {
        if (!a.sent || a.t > 0.3) { out.held = a.idx; out.slot = null; a.sent = true; a.t = 0; }
        return;
      }
      a.phase = 1; a.t = 0; a.wait = (a.urgent || this.mode === 'flee' ? this.rng.range(0.06, 0.16) : this.rng.range(0.12, 0.3)) * this.prof.hesitation;
    }
    if (a.aim) { this.shoot = null; this.look = a.aim; }
    if (a.place) this.freeze = true;                                   // building something: feet still, or the spot is under them by the time of the click
    if (a.kind === 'hold') {
      // Riot shield: keep it between us and them.
      this.holding = true;
      const face = a.face && a.face();
      if (face) { this.shoot = null; this.look = face; }
      if (this.now >= a.until || (a.done && a.done())) { out.slot = p.slot; this.endAct(true); }
      return;
    }
    if (a.phase === 1) {
      if (a.t < a.wait || p.itemCd > 0) return;
      if (a.aimFn) a.aim = a.aimFn() || a.aim;                         // re-point at a moving target as the hand lets go
      if (a.kind !== 'drop' && this.W.ITEMS[a.id].kind === 'throw') {
        if (a.chargeAt === undefined || a.chargeAt === null) a.chargeAt = this.now;
        const distance = a.aim ? this.dist(a.aim) : 70, required = this.projectileChargeAtDistance(a.id, distance);
        if (this.now - a.chargeAt + 1e-8 < required) return;
        out.charge = Math.min(this.W.CONFIG.projectileChargeTime, this.now - a.chargeAt);
      }
      if (a.aim) this.clickAt = a.aim;
      if (a.kind === 'drop') out.dropPressed = true; else out.firePressed = true;
      a.phase = 2; a.t = 0; a.n0 = slot.n;
      return;
    }
    if (slot.n < a.n0) return this.endAct(true);
    if (a.t > 0.2) {
      // Refused: no room to build there, nobody under the cursor, already at full health.
      if (a.retry && a.tries < 3) {
        const alt = a.retry(++a.tries);
        if (alt) { a.aim = alt; a.phase = 1; a.t = 0; a.chargeAt = null; a.wait = 0.12; return; }
      }
      this.endAct(false);
    }
  },

  // ---------------------------------------------------------------- deciding
  planItems() {
    const p = this.p, now = this.now, e = this.target;
    let any = false;
    for (const s of p.items) if (s) { any = true; break; }
    const S = { hp: p.hp, max: p.maxHp, miss: Math.max(0, p.maxHp - p.hp - (p.regen || 0)), frac: p.hp / p.maxHp, e, dist: e ? this.dist(e) : Infinity,
      vis: !!e && e.visible, underFire: now - this.hurtAt < 1.0 && !!this.attacker && now - this.attacker.at < 1.0,
      calm: !e && now - this.hurtAt > 4 && now - this.lastEnemyAt > 3 };
    S.exposed = S.vis && S.dist < 950 && this.world.lineClear(p.x, p.y, e.ref.x, e.ref.y);
    S.clear = S.vis && this.shotClear(e);
    if (e) { const d = S.dist || 1; S.ux = (e.x - p.x) / d; S.uy = (e.y - p.y) / d; }
    if (this.medkitPlay(S)) return true;
    if (!any) return false;
    return this.itemEmergency(S) || this.itemEscape(S) || this.itemHeal(S) || this.itemProtect(S) || this.itemTravel(S)
      || this.itemOpeners(S) || this.itemAttack(S) || this.itemCalm(S);
  },

  // The Medic's kit: for us or for a teammate standing close.
  medkitPlay(S) {
    const p = this.p;
    if (this.gearKind() !== 'medkit' || p.medkitCd > 0 || this.now < this.gearAt) return false;
    const kit = this.W.WEAPONS[p.classId === 'medic2' ? 'medkit2' : 'medkit'];
    let want = S.miss >= kit.heal - 4 || (S.frac < 0.5 && !S.exposed);
    for (const m of this.mates) {
      if (this.dist(m) > 150) continue;
      if ((m.downed && kit.reviveFraction) || (!m.downed && m.maxHp - m.hp >= kit.heal - 4)) want = true;
    }
    if (!want || !this.ready('medkit', true)) return false;
    this.out.utility = true; this.hes.delete('medkit');
    this.gearAt = this.now + 1;
    return true;
  },

  // About to die: the things that buy a second.
  itemEmergency(S) {
    const ev = this.evade;
    if (ev && ev.cant && ev.h.eta < 0.75 && (ev.h.kind === 'blast' || ev.h.kind === 'grenade' || ev.h.kind === 'meteor' || ev.h.kind === 'airstrike')) {
      const i = this.slotOf('shieldo');                                // cannot outrun it: one second of immunity, timed for the bang
      if (i >= 0 && this.rng.next() < this.prof.itemSense) return this.useItem(i, { urgent: true });
    }
    if (!(S.frac < 0.5 && S.underFire)) return false;
    let i = this.slotOf('power2');
    if (i >= 0 && S.frac < 0.45 && this.ready('em-power2', true, true)) return this.useItem(i, { urgent: true });   // death immunity
    i = this.slotOf('shieldo');
    if (i >= 0 && S.exposed && this.ready('em-shieldo', true, true)) return this.useItem(i, { urgent: true });
    return false;
  },

  // Getting away from a fight that is going badly. What stops the bullets comes first, what slows the chase second.
  itemEscape(S) {
    const p = this.p, e = S.e, f = this.fleeing;
    if (this.mode !== 'flee' || !f || !e || S.dist > 760 || !(S.exposed || S.underFire) || this.padWait) return false;
    if (f.calm && !S.underFire) return false;              // only walking away from someone: nothing to spend a boulder on
    if (!this.ready('escape', true, true)) return false;
    let i;
    // A teleporter pad waiting somewhere safe: drop the second one and step through.
    const home = this.home && this.world.structById(this.home.id);
    if (home && home.alive && !home.pair && p.openPad === home.id && this.dist(home) > 450 && this.inZone(home.x, home.y, 0)
      && (i = this.slotOf('teleporter')) >= 0 && this.world.spotFree(p.x, p.y, 36, true)) {
      return this.useItem(i, { aim: { x: p.x, y: p.y }, then: () => {
        const pad = this.world.structures.find((s) => s.kind === 'teleporter' && s.pair === home.id);
        if (pad) this.padWait = { id: pad.id, until: this.now + 3.5 };
        this.home = null;
      } });
    }
    const snow = () => {
      // Snowbomb onto the chaser: thrown past them, so they are deep in it and we are at its rim.
      const k = this.slotOf('snowbomb'), d = this.dist(e) || 1;
      if (k < 0 || d < 110 || d > 560) return false;
      const reach = Math.min(THROW_MAX, d + 200), ux = (e.x - p.x) / d, uy = (e.y - p.y) / d;
      return this.useItem(k, { aim: { x: p.x + ux * reach, y: p.y + uy * reach }, then: () => { if (this.slotOf('rock') >= 0 && !(this.myRock && this.myRock.alive && this.dist(this.myRock) < 320)) this.rockPlay(e); } });
    };
    // Under fire in the open, the boulder goes down first (it stops bullets now; a snowbomb takes 1.6 s to burst),
    // then the snowbomb over the top of it. With no room for a boulder, the other way round.
    if (S.exposed && S.dist > 170 && this.slotOf('rock') >= 0 && !(this.myRock && this.myRock.alive && this.dist(this.myRock) < 320) && this.rockPlay(e, snow)) return true;
    if (this.slotOf('snowbomb') >= 0 && S.dist > 110 && S.dist < 540 && snow()) return true;
    if ((i = this.slotOf('invisibility')) >= 0 && !(p.fx.invisible > 0)) return this.useItem(i);
    if ((i = this.slotOf('poison')) >= 0 && S.dist > 190 && S.dist < THROW_MAX && !this.poisoned(e)) return this.useItem(i, { aim: this.throwPoint(e, 0), then: () => { this.poisonAt = this.now + 1.5; } }); // halves their speed
    if ((i = this.slotOf('smoke')) >= 0 && S.exposed && !this.cover.smokeAt(p.x, p.y)) {
      const g = f.spot || { x: p.x - S.ux * 200, y: p.y - S.uy * 200 }, d = Math.hypot(g.x - p.x, g.y - p.y) || 1;
      return this.useItem(i, { aim: { x: p.x + (g.x - p.x) / d * 130, y: p.y + (g.y - p.y) / d * 130 } });            // run into it
    }
    if ((i = this.slotOf('blackhole')) >= 0 && S.dist > 80 && S.dist < 420) {
      const x = p.x + S.ux * THROW_MAX, y = p.y + S.uy * THROW_MAX;                                                    // behind them: it drags them away from us
      if (Math.hypot(x - e.x, y - e.y) < 430) return this.useItem(i, { aim: { x, y } });
    }
    if ((i = this.slotOf('firenade')) >= 0 && S.dist > 340 && S.dist < 640) return this.useItem(i, { aim: { x: e.x, y: e.y } });
    if ((i = this.slotOf('flashbang')) >= 0 && S.exposed && S.dist > 210 && S.dist < 540) return this.useItem(i, { aim: this.throwPoint(e, 1.6) });
    if ((i = this.slotOf('speed', 'energybar', 'power')) >= 0 && !this.hasBuff(p.items[i].id)) return this.useItem(i);
    if ((i = this.slotOf('riotshield')) >= 0 && S.exposed && S.dist > 240 && S.frac < 0.4) {
      return this.startAct({ kind: 'hold', idx: i, id: 'riotshield', until: this.now + this.rng.range(2, 3.5),
        face: () => this.whereIs(e.id), done: () => !this.fleeing || !this.fleeing.exposed });
    }
    return false;
  },
  // Where an enemy is as far as we know: where they stand while they are on screen, where we last saw them otherwise.
  whereIs(id) {
    const r = this.known.get(id);
    if (!r || !r.ref.alive) return null;
    return r.visible ? { x: r.ref.x, y: r.ref.y } : { x: r.x, y: r.y };
  },
  hasBuff(id) {
    const fx = this.p.fx;
    return id === 'speed' ? fx.speed > 2 : id === 'energybar' ? fx.energy > 2 : id === 'power' || id === 'power2' ? fx.power > 2
      : id === 'strength' ? fx.strength > 2 : id === 'shield' ? fx.shield > 2 : false;
  },
  // Already green (or about to be: our potion is in the air): a second one on top would be wasted.
  poisoned(e) {
    if (this.now < (this.poisonAt || 0)) return true;
    return e.visible && e.ref.fx.poison > 2;
  },
  // Where a structure fits, starting in direction (ux, uy) from us.
  structSpot(id, ux, uy) {
    const W = this.W, it = W.ITEMS[id], p = this.p, r = it.radius || W.STRUCT_RADIUS[it.struct] || 30, reach = it.reach || 150;
    const base = Math.atan2(uy, ux), near = r + p.r + 8;
    for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3]) {
      for (const d of [near + 8, Math.min(reach, near + 56)]) {
        const x = p.x + Math.cos(base + off) * d, y = p.y + Math.sin(base + off) * d;
        if (d <= reach && this.world.spotFree(x, y, r, false)) return { x, y };
      }
    }
    return null;
  },
  // Where a boulder would block their line of fire. It may not touch a player, so with them close it has to sit a
  // little off the line (it is 232 wide: up to about 90 off still does the job).
  rockSpot(e) {
    const p = this.p, o = e.visible && e.ref.alive ? e.ref : e, dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d, it = this.W.ITEMS.rock;
    for (const side of [0, 48, -48, 72, -72, 92, -92]) {
      for (const k of [0.5, 0.42, 0.58, 0.34]) {
        const along = clamp(d * k, 60, it.reach - 10), x = p.x + ux * along - uy * side, y = p.y + uy * along + ux * side;
        if (Math.hypot(x - p.x, y - p.y) <= it.reach && this.world.spotFree(x, y, it.radius, false)) return { x, y };
      }
    }
    return null;
  },
  // A boulder between us and them. `after` runs once it is down (the second half of a combo).
  rockPlay(e, after) {
    const p = this.p, i = this.slotOf('rock');
    if (i < 0) return false;
    const spot = this.rockSpot(e);
    if (!spot) return false;
    return this.useItem(i, { aim: spot, place: true, aimFn: () => this.rockSpot(e), retry: () => this.rockSpot(e), then: () => {
      let best = null, bd = 120;
      for (const s of this.world.structures) if (s.kind === 'rock' && s.owner === p.id) { const sd = this.dist(s) - s.r; if (sd < bd && s.age < 1) { bd = sd; best = s; } }
      if (best) this.myRock = best;
      this.coverSpot = null;
      if (this.fleeing) this.fleeing.pickAt = 0;         // hide behind it
      if (typeof after === 'function') after();
    } });
  },

  // Healing: when nobody has a line on us. In the open, mid-fight, only a big instant heal is worth the half
  // second of not shooting, and only when things are getting desperate.
  itemHeal(S) {
    const p = this.p, prof = this.prof;
    if (S.miss < 12 || p.hp >= p.maxHp + 29) return false;
    const safe = !S.exposed && !S.underFire;
    if (!safe) {
      if (S.frac > 0.5) return false;
      const i = this.slotOf('health', 'overheal');
      if (i < 0 || !this.ready('heal-hot', true, true)) return false;
      this.hes.delete('heal-hot');
      return this.useItem(i, { urgent: true });
    }
    if (!(S.frac < prof.healHp || S.calm || this.mode === 'flee')) return false;
    const big = S.miss >= 55 || S.frac < 0.35;
    const order = big ? ['health', 'firstaid', 'overheal', 'bandage', 'smoothie'] : ['bandage', 'smoothie', 'firstaid', 'overheal', 'health'];
    const least = { health: big ? 30 : 45, firstaid: 40, overheal: 24, bandage: 17, smoothie: 12 };
    for (const id of order) {
      const i = this.slotOf(id);
      if (i < 0 || S.miss < least[id]) continue;
      if (id === 'firstaid' && (p.regen > 0 || S.underFire)) continue;
      if (!this.ready('heal', true)) return false;
      this.hes.delete('heal');
      return this.useItem(i);
    }
    return false;
  },

  // Getting a teammate back up under fire.
  itemProtect(S) {
    const mate = this.reviving, e = S.e;
    if (this.mode !== 'revive' || !mate || !e || !(S.exposed || S.underFire)) return false;
    const p = this.p;
    let i;
    if ((i = this.slotOf('smoke')) >= 0 && this.ready('rev-smoke', true, true)) return this.useItem(i, { aim: { x: mate.x, y: mate.y } });
    if (this.slotOf('rock') >= 0 && this.dist(mate) < 240 && this.ready('rev-rock', true, true) && this.rockPlay(e)) return true;
    if ((i = this.slotOf('riotshield')) >= 0 && this.dist(mate) < 140 && this.ready('rev-shield', true, true)) {
      return this.startAct({ kind: 'hold', idx: i, id: 'riotshield', until: this.now + 5, face: () => this.whereIs(e.id),
        done: () => !mate.downed || this.mode !== 'revive' });
    }
    return false;
  },

  // Racing the storm, or a long walk to the next circle.
  itemTravel(S) {
    const p = this.p;
    if (!(this.mode === 'storm' && (p.inStorm || this.dist(this.storm) > 1400))) return false;
    const i = this.slotOf('speed', 'energybar');
    if (i < 0 || this.hasBuff(p.items[i].id) || !this.ready('travel', true)) return false;
    return this.useItem(i);
  },

  // The start of a fight: one buff (two if they have not seen us yet), then hardware.
  itemOpeners(S) {
    const p = this.p, e = S.e, now = this.now;
    if (this.mode !== 'fight' || !e || e.downed || S.dist > 900) return false;
    let i;
    if (now - this.fightSince < 6 && this.openers < (S.exposed ? 1 : 2)) {
      const buffs = e.hp > 0.45 ? ['power2', 'power', 'strength', 'shield', 'overheal'] : ['strength', 'shield'];
      for (const id of buffs) {
        if ((i = this.slotOf(id)) < 0 || this.hasBuff(id)) continue;
        if (id === 'overheal' && S.frac < 0.7) continue;
        if (id === 'shield' && S.dist > 650) continue;
        if (!this.ready('open-buff', true)) return false;
        this.openers++; this.hes.delete('open-buff');
        return this.useItem(i);
      }
    }
    // A sentry covering the fight.
    if ((i = this.slotOf('sentry3', 'sentry2', 'sentry')) >= 0 && S.dist > 170 && S.dist < 640 && this.ready('open-sentry', true)) {
      const id = p.items[i].id, find = () => { const d = this.dist(e) || 1; return this.structSpot(id, (e.x - p.x) / d, (e.y - p.y) / d); }, spot = find();
      if (spot && this.world.lineClear(spot.x, spot.y, e.x, e.y)) return this.useItem(i, { aim: spot, place: true, aimFn: find, retry: find });
    }
    // A turret, when there is distance, health and time to sit down behind it.
    if ((i = this.slotOf('turret3', 'turret2', 'turret')) >= 0 && S.dist > 340 && S.dist < 980 && S.clear && S.frac > 0.55 && !this.storm.soon
      && !this.evade && !CLOSE_GUNS[e.ref.weapons[e.ref.slot].id] && this.ready('open-turret', true)) {
      const id = p.items[i].id, find = () => { const d = this.dist(e) || 1; return this.structSpot(id, (e.x - p.x) / d, (e.y - p.y) / d); }, spot = find();
      if (spot) return this.useItem(i, { aim: spot, place: true, aimFn: find, retry: find, then: () => { this.mountTry = this.now + this.rng.range(0.15, 0.4) * this.prof.hesitation; } });
    }
    return false;
  },

  // Mid-fight plays.
  itemAttack(S) {
    const p = this.p, e = S.e, now = this.now;
    if (!e || !S.vis || e.dropping || !(this.mode === 'fight' || now - e.hurtMeAt < 2.5)) return false;
    const o = e.ref, still = this.isStill(e), band = this.band();
    let i;
    // Lightning cannot miss and ignores armor: a finisher, or for someone we cannot hit otherwise.
    if ((i = this.slotOf('lightning')) >= 0 && S.dist < 1300) {
      const finisher = o.hp <= 52 && !e.downed;
      if ((finisher || !S.clear || S.dist > band[1] + 120 || now - this.strikeAt > 3.5) && this.ready(finisher ? 'atk-zap-kill' : 'atk-zap', true)) {
        return this.useItem(i, { aim: { x: o.x, y: o.y }, aimFn: () => (o.alive ? { x: o.x, y: o.y } : null), then: () => { this.strikeAt = this.now; } });
      }
    }
    // Meteor: two seconds of warning, so only for people who are not going anywhere. It spares us, so "on my own feet" works when rushed.
    if ((i = this.slotOf('meteor')) >= 0) {
      const slowed = o.inSnow || (o.fx && o.fx.poison > 0) || e.downed;
      if (S.dist < 1350 && (still || slowed) && this.ready('atk-meteor', true)) return this.useItem(i, { aim: { x: o.x, y: o.y } });
      if (S.dist < 230 && this.ready('atk-meteor-self', true)) return this.useItem(i, { aim: { x: p.x + S.ux * 60, y: p.y + S.uy * 60 } });
    }
    const hole = this.slotOf('blackhole');
    if (hole >= 0 && S.dist < THROW_MAX + 380 && S.dist > 150) {
      // Black hole: only with a plan for whoever it pulls in.
      const follow = this.slotOf('grenade', 'firenade', 'meteor');
      const gearNade = this.gearKind() === 'grenade' && p.grenades > 0;
      const close = this.pusher();
      let land = null;
      if (follow >= 0 || gearNade) { const r = Math.min(THROW_MAX, Math.max(240, S.dist)); land = { x: p.x + S.ux * r, y: p.y + S.uy * r }; }   // on top of them, then the follow-up
      else if (close && S.dist > 200) { land = { x: p.x + S.ux * 170, y: p.y + S.uy * 170 }; this.holdPush = now + 0.6; }                     // drag them into shotgun range
      else if (!S.clear && S.dist > 260) { const r = Math.min(S.dist - 150, 300); if (this.world.lineClear(p.x, p.y, p.x + S.ux * r, p.y + S.uy * r)) land = { x: p.x + S.ux * r, y: p.y + S.uy * r }; } // out of their cover
      if (land && Math.hypot(land.x - o.x, land.y - o.y) < 420 && this.ready('atk-hole', true, close)) {
        return this.useItem(hole, { aim: land, then: () => {
          const f = this.slotOf('grenade', 'firenade', 'meteor');
          if (f >= 0 && Math.hypot(land.x - p.x, land.y - p.y) > (p.items[f].id === 'firenade' ? 340 : 215)) this.queue.push({ kind: 'use', idx: f, id: p.items[f].id, aim: land, phase: 0, t: 0, tries: 0, sent: false });
          else if (gearNade && Math.hypot(land.x - p.x, land.y - p.y) > 215) this.gearThrow = { at: this.now + 0.5, x: land.x, y: land.y };
        } });
      }
    }
    if (this.gearThrow && now >= this.gearThrow.at) {
      const g = this.gearThrow; this.gearThrow = null;
      if (p.grenades > 0 && p.throwCd <= 0 && now - g.at < 1.5) { this.clickAt = { x: g.x, y: g.y }; this.out.utility = true; return true; }
    }
    // Snowbomb to pin them: for a meteor, or because they are running from a gun that reaches.
    if ((i = this.slotOf('snowbomb')) >= 0 && S.dist > 300 && S.dist < THROW_MAX + 250) {
      const running = (o.vx * S.ux + o.vy * S.uy) > 130 && band[1] > 300 && e.hp < 0.6;
      if ((this.slotOf('meteor') >= 0 || running) && this.ready('atk-snow', true)) {
        const r = Math.min(THROW_MAX, S.dist + (running ? 120 : 0));
        return this.useItem(i, { aim: { x: p.x + S.ux * r, y: p.y + S.uy * r } });
      }
    }
    if ((i = this.slotOf('poison')) >= 0 && S.dist > 190 && S.dist < THROW_MAX + 40 && !this.poisoned(e) && this.ready('atk-poison', true)) return this.useItem(i, { aim: this.throwPoint(e, 0), then: () => { this.poisonAt = this.now + 1.5; } });
    if ((i = this.slotOf('firenade')) >= 0 && S.dist > 345 && S.dist < THROW_MAX + 150 && (still || !S.clear) && this.ready('atk-fire', true)) return this.useItem(i, { aim: this.throwPoint(e, 0) });
    if ((i = this.slotOf('grenade')) >= 0 && S.dist > 225 && S.dist < THROW_MAX + 60 && (still || !S.clear) && this.ready('atk-nade', true)) {
      const pt = this.throwPoint(e, 1.6);
      if (Math.hypot(pt.x - p.x, pt.y - p.y) > 215) return this.useItem(i, { aim: pt });
    }
    // Flash, then go in: for the classes that have to get close (they wait with the charge until it is in the air).
    if ((i = this.slotOf('flashbang')) >= 0 && this.pusher() && S.clear && S.dist > 200 && S.dist < 560) {
      this.holdPush = now + 0.6;
      if (this.ready('atk-flash', true, true)) return this.useItem(i, { aim: this.throwPoint(e, 1.6) });
    }
    // Caught reloading in the open, or losing the exchange with nowhere to hide: a boulder is instant cover to fight from.
    const w = p.weapons[p.slot], pressed = (w.reloading && w.reloadT > 1) || (S.frac < 0.6 && this.inBurst > 12);
    if (pressed && S.exposed && S.dist > 215 && now - this.hurtAt < 1.2 && this.slotOf('rock') >= 0 && !(this.myRock && this.myRock.alive && this.dist(this.myRock) < 300)
      && !this.coverFrom(e) && this.ready('atk-rock', true, true)) return this.rockPlay(e);
    return false;
  },

  // Quiet moments.
  itemCalm(S) {
    const p = this.p, now = this.now;
    let i;
    // Someone is shooting and we cannot see who: radar.
    if ((i = this.slotOf('radar')) >= 0 && !(p.fx.radar > 0) && ((this.bearing && now - this.bearing.at < 3 && !S.vis) || (this.mode === 'hunt' && S.calm)) && this.ready('calm-radar', true)) return this.useItem(i);
    if (!S.calm) return false;
    // The first teleporter pad goes down somewhere safe; the second is the way back when a fight goes wrong.
    if ((i = this.slotOf('teleporter')) >= 0 && p.items[i].n >= 2 && !p.openPad && !this.storm.soon && this.inSafe(p.x, p.y, 260)
      && (this.mode === 'loot' || this.mode === 'roam') && this.world.spotFree(p.x, p.y, 36, true) && this.ready('calm-pad', true)) {
      return this.useItem(i, { aim: { x: p.x, y: p.y }, then: () => { if (p.openPad) this.home = { id: p.openPad }; } });
    }
    // Late game (or out hunting): a drone shows where everyone is.
    if ((i = this.slotOf('drone')) >= 0 && !((this.world.reveal[p.team] || 0) > 0) && (this.d.late || this.mode === 'hunt') && this.ready('calm-drone', true)) return this.useItem(i);
    // Mystery potion: it can be poison (100 damage over 10 s), so only with health to spare.
    if ((i = this.slotOf('mystery')) >= 0 && p.hp + p.armor + (this.hasHeal() ? 30 : 0) >= 125 && this.ready('calm-mystery', true)) return this.useItem(i);
    return false;
  }
});
