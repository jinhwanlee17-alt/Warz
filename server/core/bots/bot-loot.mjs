// Bot looting and upgrading: which crate or pickup is worth the walk, breaking crates with the right gun from a
// spot that actually has a line to them, picking items up with the interact key (and dropping a worse stack to
// make room, since there are only three item slots), and spending tokens at an Upgrade Station.
import { Bot, TAU } from './bot.mjs';
import { ITEM_VALUE } from './profile.mjs';

const CRATE_VALUE = { common: 4, rare: 7, epic: 10, mythic: 13, legendary: 20 };
// Best tool for opening a crate, and how close to stand ([preference, distance, minimum distance]).
const CRATE_GUN = { shotgun: [5, 92, 0], shotgun2: [5, 92, 0], flamethrower: [5, 170, 0], minigun: [4, 260, 0], ar: [4, 280, 0], deagle: [3, 280, 0],
  commandpistol: [3, 260, 0], launcher2: [3, 320, 225], revolver: [2.5, 280, 0], pistol: [2.5, 260, 0], launcher: [2, 320, 225], sniper2: [1.2, 300, 0], sniper: [1, 300, 0] };

Object.assign(Bot.prototype, {
  nextClass() {
    const p = this.p, W = this.W, tier = W.CLASSES[p.classId].tier;
    if (tier >= 2) return null;
    const want = this.plan[tier];
    if (W.Rules.relation(p, want) === 'available') return want;
    const kids = W.Rules.childClasses(p.classId);
    return kids.length ? kids[0] : null;
  },
  tokenNeed() {
    const next = this.nextClass();
    return next ? Math.max(0, this.W.Rules.upgradeCostFor(next) - this.p.tokens) : 0;
  },

  // ---------------------------------------------------------------- what is an item worth to me?
  itemWorth(id) {
    const p = this.p, it = this.W.ITEMS[id];
    if (!it) return 0;
    let v = ITEM_VALUE[id] || 30;
    if (it.heal && !this.hasHeal()) v += 18;                       // no way to heal: any heal looks good
    if (this.badItem && this.badItem.id === id && this.now < this.badItem.until) return 0;
    if (it.stack === 1 && this.world.countItem(p, id) >= 1) v *= 0.4; // a second riot shield is just dead weight
    return v;
  },
  worstSlot() {
    const p = this.p;
    let worst = null;
    for (let i = 0; i < p.items.length; i++) {
      const s = p.items[i];
      if (!s) continue;
      const it = this.W.ITEMS[s.id], value = (ITEM_VALUE[s.id] || 30) * (0.75 + 0.25 * Math.min(1, s.n / Math.max(1, it.found)));
      if (!worst || value < worst.value) worst = { idx: i, id: s.id, value };
    }
    return worst;
  },
  // 0 when it is not worth bending down for.
  wantItem(id) {
    const v = this.itemWorth(id);
    if (v <= 0) return 0;
    if (this.world.canTake(this.p, id)) return v;
    const worst = this.worstSlot();
    return worst && v > worst.value + 10 ? v - worst.value : 0;
  },
  pickupValue(pk, need) {
    const p = this.p, C = this.W.CONFIG;
    if (pk.type === 'token') return (need > 0 ? 3 : this.W.CLASSES[p.classId].tier < 2 ? 1.2 : 0.3) * Math.min(3, pk.amount);
    if (pk.type === 'key') return p.keys < 1 ? 4 : p.keys < 2 ? 1.5 : 0.2;
    if (pk.type === 'armor') return p.armor < C.armorMax ? 5 : 0;
    if (pk.type === 'item') return pk.item ? this.wantItem(pk.item) / 12 : 0;
    return 0;
  },

  // ---------------------------------------------------------------- choosing
  lootValid(L) {
    if (L.kind === 'crate') return L.ref.alive;
    if (L.kind === 'rock') return L.ref.alive && this.world.canTake(this.p, 'rock');
    return L.ref.alive && (L.ref.type !== 'item' || this.wantItem(L.ref.item) > 0);
  },
  pickLoot() {
    const now = this.now;
    if (this.loot && now < this.lootAt && this.lootValid(this.loot)) return true;
    this.lootAt = now + 1.4;
    const cur = this.loot && this.lootValid(this.loot) ? this.loot : null;
    this.curScore = cur ? 0 : undefined;                  // bestLoot fills in what the current target is worth now
    const cand = this.bestLoot(cur ? cur.key : null);
    if (cur && this.curScore > 0 && (!cand || cand.key === cur.key || cand.score < this.curScore * 1.4)) { cur.score = this.curScore; return true; } // stick with it
    if (this.loot && this.loot.kind === 'crate') this.d.unclaim(this.loot.ref.id, this.p);
    if (!cand) { this.loot = null; return false; }
    this.loot = Object.assign(cand, { since: now, spot: null, spotAt: -9, progAt: now, best: Infinity });
    if (cand.kind === 'crate') this.d.claim(cand.ref.id, this.p);
    return true;
  },
  bestLoot(curKey) {
    const p = this.p, world = this.world, map = world.map, now = this.now, speed = Math.max(120, this.speed());
    const need = this.tokenNeed(), bold = 0.6 + this.prof.aggression * 0.8;
    // On a team, loot is only worth it within reach of whoever leads (closer still when that is a person).
    const lead = this.following(), leash = lead ? (lead.bot ? 1100 : 700) : 0;
    let best = null;
    // Loot next to someone with a gun is worth less, and a lot less when they will get there first.
    const danger = (x, y, d) => {
      let k = 1;
      for (const r of this.known.values()) {
        if (!r.noticed || r.downed || r.dropping || now - r.seenAt > 4) continue;
        const de = Math.hypot(r.x - x, r.y - y);
        if (de < 450) k = Math.min(k, (de < d * 0.9 ? 0.1 : 0.3) * bold);
        else if (de < d && this.dist(r) < 600) k = Math.min(k, 0.22 * bold);   // walking the same way, and they are ahead
      }
      return k;
    };
    // Tastes differ a little, so bots that land together do not all rank the same crate first.
    const taste = (key) => { let h = (p.id * 2654435761) >>> 0; for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0; return 0.75 + (h % 1000) / 2000; };
    const offer = (kind, ref, key, value, d, extra) => {
      if (value <= 0 || this.badLoot.has(key)) return;
      if (!this.inZone(ref.x, ref.y, 40)) return;                 // not worth dying in the storm for
      if (lead && Math.hypot(ref.x - lead.x, ref.y - lead.y) > leash) return;
      for (const h of this.hazards) if (Math.hypot(ref.x - h.x, ref.y - h.y) < h.r) return; // or in fire, or under a sentry
      const score = value / (d / speed + extra) * danger(ref.x, ref.y, d) * taste(key);
      if (key === curKey) this.curScore = score;
      if (!best || score > best.score) best = { kind, ref, key, score };
    };
    // Things lying on the ground, as far as the screen shows them.
    for (let i = 0; i < map.pickups.length; i++) {
      const pk = map.pickups[i];
      if (!pk.alive || Math.abs(pk.x - p.x) > 760 || Math.abs(pk.y - p.y) > 470) continue;
      const d = Math.hypot(pk.x - p.x, pk.y - p.y);
      if (d > 300) { const b = this.cover.buildingAt(pk.x, pk.y); if (b >= 0 && this.cover.buildingAt(p.x, p.y) !== b) continue; } // under a roof
      offer('pickup', pk, 'p' + pk.id, this.pickupValue(pk, need), d, 0.5);
    }
    // Crates we have seen (and not seen break).
    for (const i of this.crates) {
      const c = map.crates[i];
      if (!c.alive) { this.crates.delete(i); continue; }
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d > 2600 || this.d.claimedByMate(c.id, p)) continue;
      offer('crate', c, 'c' + c.id, CRATE_VALUE[c.tier] * (need > 0 ? 1 : 0.55), d, 2.5 + c.hp / 70);
    }
    // Everybody knows where the legendary crate is (dead centre). Only the bold go for it.
    const legend = map.crates[map.legendaryCrateId];
    if (legend && legend.alive && this.prof.aggression > 0.55 && !this.crates.has(map.legendaryCrateId)) {
      const d = Math.hypot(legend.x - p.x, legend.y - p.y);
      if (d < 4200) offer('crate', legend, 'c' + legend.id, CRATE_VALUE.legendary * (this.prof.aggression - 0.2), d, 6);
    }
    // Our own boulder is worth picking back up when nobody is around.
    const rock = this.myRock;
    if (rock && rock.alive && !this.target && world.canTake(p, 'rock')) { const d = this.dist(rock); if (d < 600) offer('rock', rock, 's' + rock.id, 5, d, 0.6); }
    else if (rock && !rock.alive) this.myRock = null;
    return best;
  },

  // ---------------------------------------------------------------- doing
  doLoot() {
    const L = this.loot, now = this.now;
    if (!L || !this.lootValid(L)) {
      if (L && L.kind === 'crate') { this.pause(0.08, 0.4); this.d.unclaim(L.ref.id, this.p); }
      this.loot = null; this.lootAt = 0; this.redecide = true;
      return;
    }
    // Watchdog: getting closer (or the crate getting weaker) counts as progress. Coming back to it after a fight
    // or a detour starts the clock again.
    if (now - (L.ranAt || 0) > 1) { L.progAt = now; L.best = Infinity; }
    L.ranAt = now;
    const left = this.dist(L.ref) + (L.kind === 'crate' ? L.ref.hp * 3 : 0);
    if (left < L.best - 20) { L.best = left; L.progAt = now; }
    if (now - L.progAt > 7 || (this.noWay && this.noWay.at > L.since && Math.hypot(this.noWay.x - L.ref.x, this.noWay.y - L.ref.y) < 200)) {
      this.badLoot.set(L.key, now + 30); this.noWay = null;
      if (L.kind === 'crate') this.d.unclaim(L.ref.id, this.p);
      this.loot = null; this.lootAt = 0; this.redecide = true;
      return;
    }
    if (L.kind === 'crate') this.lootCrate(L); else if (L.kind === 'rock') this.lootRock(L); else this.lootPickup(L);
  },

  crateGun() {
    const p = this.p;
    let best = null;
    for (let i = 0; i < p.weapons.length; i++) {
      const g = CRATE_GUN[p.weapons[i].id];
      if (g && (!best || g[0] > best.pref)) best = { slot: i, pref: g[0], range: g[1], min: g[2], id: p.weapons[i].id };
    }
    return best;
  },
  crateClear(c, def) {
    const now = this.now;
    if (this.crateFor === c.id && now - this.crateAt < 0.2) return this.crateOk;
    const p = this.p;
    let ok;
    if (def.kind === 'launcher') ok = true;                       // shells arc over walls
    else if (def.kind === 'flame') ok = this.world.lineClear(p.x, p.y, c.x, c.y);
    else { const hit = this.world.sweep(p.x, p.y, c.x, c.y, def.bulletRadius || 5, p.id, p.team); ok = !!hit && !!hit.solid && hit.solid.crate === c; }
    this.crateFor = c.id; this.crateAt = now; this.crateOk = ok;
    return ok;
  },
  // A free spot with a clean line to the crate (through a doorway if need be), nearest to us.
  crateSpot(c, gun) {
    const p = this.p, nav = this.nav, world = this.world, lob = gun.min > 0;
    const radii = lob ? [gun.min + 30, gun.range - 20] : gun.range < 120 ? [72, gun.range] : [90, 160, Math.min(240, gun.range - 20)];
    let best = null, bs = Infinity;
    for (const R of radii) {
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * TAU + 0.26, x = c.x + Math.cos(a) * R, y = c.y + Math.sin(a) * R;
        if (!nav.freeAt(x, y)) continue;
        if (!lob) { const hit = world.sweep(x, y, c.x, c.y, 5, p.id, p.team); if (!(hit && hit.solid && hit.solid.crate === c)) continue; }
        const s = Math.hypot(x - p.x, y - p.y) + (nav.pondAt(x, y) ? 150 : 0);
        if (s < bs) { bs = s; best = { x, y }; }
      }
    }
    return best;
  },
  lootCrate(L) {
    const c = L.ref, p = this.p, now = this.now, gun = this.crateGun();
    if (!gun) { this.badLoot.set(L.key, now + 60); this.loot = null; return; }
    if (gun.slot !== p.slot && now >= this.swapAt && !this.act && !this.sentryFoe) { this.out.slot = gun.slot; this.swapAt = now + 0.8; }
    const def = this.weaponDef(), d = Math.hypot(c.x - p.x, c.y - p.y);
    this.look = c;
    if (p.slot === gun.slot && d <= gun.range + 30 && d >= gun.min - 30 && this.crateClear(c, def)) {
      this.shoot = { x: c.x, y: c.y, r: 22, def, crate: c };
      this.still = true;
      return;
    }
    if (gun.min && d < gun.min - 30) { const v = this.safeDir(p.x - c.x, p.y - c.y); if (v) { this.moveDir = v; return; } } // too close for explosives
    if (!L.spot || now - L.spotAt > 4 || (this.arrivedAt(L.spot, 22) && now - L.spotAt > 0.6)) {
      L.spot = this.crateSpot(c, gun); L.spotAt = now;
      if (!L.spot) { this.badLoot.set(L.key, now + 20); this.d.unclaim(c.id, p); this.loot = null; this.redecide = true; return; }
    }
    this.moveGoal = { x: L.spot.x, y: L.spot.y, tol: 14 };
  },
  lootPickup(L) {
    const pk = L.ref, p = this.p, now = this.now, d = Math.hypot(pk.x - p.x, pk.y - p.y);
    if (!this.target) this.look = pk;
    if (pk.type !== 'item') { this.moveGoal = { x: pk.x, y: pk.y, tol: 22 }; return; }
    this.moveGoal = { x: pk.x, y: pk.y, tol: 16 };
    if (d > 62 || now < this.nextInteract || this.act || pk.lockT > 0) return;
    if (this.world.nearestItemPickup(p) !== pk) return;            // keep walking until it is the nearest thing to grab
    if (this.world.canTake(p, pk.item)) { this.out.interactPressed = true; this.nextInteract = now + 0.4; return; }
    // Full hotbar: put down the stack we value least, then take this one.
    const worst = this.worstSlot();
    if (!worst || this.itemWorth(pk.item) <= worst.value + 10) { this.badLoot.set(L.key, now + 40); this.loot = null; this.redecide = true; return; }
    const away = Math.atan2(p.y - pk.y, p.x - pk.x) + (d < 4 ? this.rng.range(0, TAU) : 0);
    this.startAct({ kind: 'drop', idx: worst.idx, id: worst.id, aim: { x: p.x + Math.cos(away) * 120, y: p.y + Math.sin(away) * 120 },
      then: () => { this.badItem = { id: worst.id, until: this.now + 8 }; this.nextInteract = this.now + 0.3; } });
  },
  lootRock(L) {
    const s = L.ref, p = this.p, now = this.now, d = this.dist(s) - s.r - p.r;
    this.look = s;
    if (d > 60) { this.moveGoal = { x: s.x, y: s.y, tol: s.r + p.r + 40 }; return; }
    this.still = true;
    if (now < this.nextInteract || this.act) return;
    if (this.world.nearestItemPickup(p)) { this.badLoot.set(L.key, now + 15); this.loot = null; return; } // E would grab that instead
    if (this.world.nearestRecoverableRock(p) === s) { this.out.interactPressed = true; this.nextInteract = now + 0.5; }
  },

  // ---------------------------------------------------------------- upgrade stations
  // A teammate bot that is following us has the tokens for its next class: then the station is our errand too.
  mateWantsStation() {
    if (!this.mates.length || this.following()) return null;
    for (const m of this.mates) {
      if (!m.bot || !m.ai || m.downed || this.dist(m) > 1000) continue;
      const next = m.ai.nextClass();
      if (next && m.tokens >= this.W.Rules.upgradeCostFor(next)) return m;
    }
    return null;
  },
  pickStation() {
    const p = this.p, now = this.now, next = this.nextClass();
    const mine = !!next && p.tokens >= this.W.Rules.upgradeCostFor(next), mate = mine ? null : this.mateWantsStation();
    if (!mine && !mate) { this.station = null; return false; }
    if (this.station && this.station.cls === (mine ? next : null) && now < this.station.checkAt && !this.inHazard(this.station.st.x, this.station.st.y)) return true;
    const speed = Math.max(120, this.speed()), lead = this.following(), keys = mine ? p.keys : mate.keys;
    let best = null, bt = Infinity;
    for (const st of this.world.map.stations) {
      if ((this.badStation.get(st.id) || 0) > now) continue;
      const d = this.dist(st), travel = d / speed, wait = keys > 0 ? 0 : Math.max(0, st.cooldown - travel);
      if (wait > 25) continue;                                     // somebody just used it: try another, or keep looting
      if (!this.inZone(st.x, st.y, 40)) continue;
      if (this.inHazard(st.x, st.y)) continue;                      // steering cannot enter a known sentry/fire danger zone
      if (lead && Math.hypot(st.x - lead.x, st.y - lead.y) > (lead.bot ? 1500 : 1300)) continue;   // a follower does not go shopping on its own
      const t = travel + wait * 1.3 + (this.station && this.station.st === st ? -2 : 0);
      if (t < bt) { bt = t; best = st; }
    }
    if (!best) { this.station = null; return false; }
    if (!this.station || this.station.st !== best) this.station = { st: best, cls: null, browseAt: 0, fails: 0, checkAt: 0, since: now };
    this.station.cls = mine ? next : null; this.station.checkAt = now + 2;
    return true;
  },
  doUpgrade() {
    const S = this.station, p = this.p, now = this.now;
    if (!S) { this.redecide = true; return; }
    const st = S.st;
    // A danger can appear after choosing the errand. Drop it now instead of oscillating along its boundary;
    // unlike an unreachable building, this station can be reconsidered as soon as the danger disappears.
    if (this.inHazard(st.x, st.y)) { this.station = null; this.moveGoal = null; this.route = null; this.redecide = true; return; }
    if (p.nearStation !== st && !(!S.cls && S.waitSpot)) { this.moveGoal = { x: st.x, y: st.y, tol: 88 }; S.browseAt = 0; return; }
    this.still = true;
    if (!this.target) this.look = st;
    if (!S.cls) {
      // An escort standing at interaction range can pin the paying teammate just outside it.
      // Wait to one side of their approach instead, keeping the station's entrance clear.
      if (!S.waitSpot || !this.nav.freeAt(S.waitSpot.x, S.waitSpot.y)) {
        const mate = this.mateWantsStation() || p, angle = Math.atan2(mate.y - st.y, mate.x - st.x);
        const radius = this.W.CONFIG.stationInteractRadius + p.r * 3;
        let best = null, distance = Infinity;
        for (const turn of [Math.PI / 2, -Math.PI / 2, Math.PI / 3, -Math.PI / 3, Math.PI * 2 / 3, -Math.PI * 2 / 3]) {
          const x = st.x + Math.cos(angle + turn) * radius, y = st.y + Math.sin(angle + turn) * radius;
          if (!this.inZone(x, y, p.r) || !this.nav.freeAt(x, y) || this.nav.pondAt(x, y) || !this.nav.segmentClear(p.x, p.y, x, y)) continue;
          if (this.mates.some((m) => m.alive && Math.hypot(m.x - x, m.y - y) < m.r + p.r + 20)) continue;
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < distance) { distance = d; best = { x, y }; }
        }
        S.waitSpot = best;
      }
      if (S.waitSpot && !this.arrivedAt(S.waitSpot, 22)) { this.still = false; this.moveGoal = { x: S.waitSpot.x, y: S.waitSpot.y, tol: 18 }; }
      // Here for a teammate: wait while they use it, but not for ever (they may have found something better to do).
      if (!S.hereAt || now - (S.waitAt || 0) > 1) S.hereAt = now;
      S.waitAt = now;
      if (now - S.hereAt > 12) { this.badStation.set(st.id, now + 40); this.station = null; this.redecide = true; }
      return;
    }
    if (st.cooldown > 0 && p.keys < 1) {
      // Someone got here first. Wait out a short recharge, otherwise go elsewhere.
      if (st.cooldown > 14) { this.badStation.set(st.id, now + st.cooldown - 10); this.station = null; this.redecide = true; }
      return;
    }
    if (!S.browseAt) S.browseAt = now + this.rng.range(0.7, 2.1) * this.prof.hesitation;   // reading the class tree
    if (now < S.browseAt) return;
    const r = this.d.upgrade(p, st, S.cls);
    if (r && r.ok) { this.station = null; this.swapCheck = 0; this.pause(0.4, 1.1); this.redecide = true; return; }
    S.browseAt = now + 1;
    if (++S.fails >= 3) { this.badStation.set(st.id, now + 30); this.station = null; this.redecide = true; }
  }
});

export { CRATE_VALUE };
