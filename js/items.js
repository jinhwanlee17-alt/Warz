/* warz.io: crate loot, the three item slots in the five-slot hotbar, and every item: consumables and potions, throwables, placed structures
   (rocks, turrets, sentries, teleporter pads), the riot shield, zones (fire, smoke, snow), lightning and meteor strikes,
   drone and radar. Extends World, so it runs in Practice, behind the menu and on the server. In a remote (mirror)
   world only the visuals run: effects, damage, zones, structures and strikes arrive from the server. No DOM access. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, C = W.CONFIG, ITEMS = W.ITEMS, CRATES = W.CRATES, WEAPONS = W.WEAPONS, Rules = W.Rules, World = W.World;
  var FX_KEYS = W.FX_KEYS = ['energy', 'speed', 'strength', 'shield', 'poison', 'invisible', 'power', 'immune', 'reduce', 'deathImmune', 'radar', 'flash'];
  var MOUNT_RANGE = 96, PICKUP_RANGE = 85, DROP_LOCK = 0.35, TURRET_R = 38, SENTRY_R = 20, FIRE_TICK = 0.25, POISON_TICK = 0.5, SNOW_TICK = 1, SNOW_MIN_DPS = 2;
  var ZONE_COLORS = { fire: '#ff7a2a', smoke: '#9aa0a8', snow: '#bfe9ff' };
  var SAVED_HP = 30;

  function freshFx() { var fx = {}; for (var i = 0; i < FX_KEYS.length; i++) fx[FX_KEYS[i]] = 0; return fx; }
  W.freshFx = freshFx;
  W.STRUCT_RADIUS = { turret: TURRET_R, sentry: SENTRY_R };

  // ---------------------------------------------------------------- player state
  World.prototype.initItems = function (p) {
    p.items = [];
    for (var i = 0; i < C.hotbarSize; i++) p.items.push(null);
    p.held = -1; p.mount = 0; p.shieldUp = false; p.itemCd = 0; p.hidden = false;
    p.fx = freshFx(); p.regen = 0; p.regenRate = 0; p.regenAcc = 0; p.poisonT = 0; p.poisonBy = 0;
    p.inSnow = false; p.snowT = 0; p.snowTick = 0; p.tpT = 0; p.tpPad = 0; p.tpLock = 0; p.tpProgress = 0; p.openPad = 0; p.fullNoteT = 0;
  };
  World.prototype.resetItems = function (p) { this.initItems(p); };
  World.prototype.clearItemState = function (p) {
    if (this.stopVehicleRepair) this.stopVehicleRepair(p);
    if (p.mount) this.dismount(p, true);
    if (p.vehicle && this.exitVehicle) this.exitVehicle(p, true);
    p.held = -1; p.fx = freshFx(); p.regen = 0; p.regenAcc = 0; p.shieldUp = false; p.inSnow = false; p.snowT = 0; p.tpT = 0; p.tpProgress = 0; p.poisonT = 0;
  };
  World.prototype.dropItems = function (p) {
    for (var i = 0; i < p.items.length; i++) {
      var s = p.items[i];
      if (s) this.spawnPickup('item', p.x, p.y, s.n, true, s.id);
      p.items[i] = null;
    }
    p.held = -1;
  };

  // ---------------------------------------------------------------- hotbar
  World.prototype.addItem = function (p, id, n) {
    var it = ITEMS[id];
    if (!it) return n;
    var left = n, i, s, take;
    for (i = 0; i < p.items.length && left > 0; i++) {
      s = p.items[i];
      if (s && s.id === id && s.n < it.stack) { take = Math.min(it.stack - s.n, left); s.n += take; left -= take; }
    }
    for (i = 0; i < p.items.length && left > 0; i++) {
      if (!p.items[i]) { take = Math.min(it.stack, left); p.items[i] = { id: id, n: take }; left -= take; }
    }
    return left;
  };
  World.prototype.canTake = function (p, id) {
    var it = ITEMS[id];
    if (!it) return false;
    for (var i = 0; i < p.items.length; i++) {
      var s = p.items[i];
      if (!s || (s.id === id && s.n < it.stack)) return true;
    }
    return false;
  };
  World.prototype.countItem = function (p, id) {
    var n = 0;
    for (var i = 0; i < p.items.length; i++) if (p.items[i] && p.items[i].id === id) n += p.items[i].n;
    return n;
  };
  World.prototype.takeItem = function (p, idx, n) {
    var s = p.items[idx];
    if (!s) return;
    s.n -= n;
    if (s.n <= 0) { p.items[idx] = null; if (p.held === idx) p.held = -1; }
  };
  World.prototype.heldItem = function (p) { return p.held >= 0 && p.items[p.held] ? ITEMS[p.items[p.held].id] : null; };
  // Drop the whole selected item stack. Class weapons are never ground loot.
  World.prototype.dropHeld = function (p) {
    if (this.remote || !p || !p.alive || p.downed || p.dropT > 0 || p.mount || p.vehicle) return false;
    var index = p.held, stack = index >= 0 && p.items[index];
    if (!stack || !ITEMS[stack.id] || stack.n <= 0) { this.emit({ type: 'deny', player: p, reason: 'noitem' }); return false; }
    var angle = Number.isFinite(p.angle) ? p.angle : 0, spot = null;
    // Keep the drop reachable. Back it toward the player when aiming at a wall,
    // instead of placing it through that wall or inside a solid object.
    for (var d = Math.min(PICKUP_RANGE - 16, p.r + 32); d >= 0; d -= 8) {
      var x = p.x + Math.cos(angle) * d, y = p.y + Math.sin(angle) * d;
      if (this.lineClear(p.x, p.y, x, y) && this.spotFree(x, y, 12, true)) { spot = { x: x, y: y }; break; }
    }
    if (!spot && this.spotFree(p.x, p.y, 12, true)) spot = { x: p.x, y: p.y };
    if (!spot) { this.emit({ type: 'deny', player: p, reason: 'blocked' }); return false; }
    var id = stack.id, n = stack.n;
    p.items[index] = null; p.held = -1; p.shieldUp = false; p.scoping = false;
    this.spawnPickup('item', spot.x, spot.y, n, false, id, DROP_LOCK);
    this.emit({ type: 'item-dropped', player: p, item: id, amount: n });
    return true;
  };
  // Capacity is deliberately not considered here: a nearby full-stack item must
  // still show a prompt and produce a useful "full" response when E is pressed.
  World.prototype.nearestItemPickup = function (p) {
    if (!p || !p.alive || p.downed || p.dropT > 0 || p.mount || p.vehicle) return null;
    var best = null, bd = PICKUP_RANGE;
    for (var i = 0; i < this.map.pickups.length; i++) {
      var pk = this.map.pickups[i];
      if (!pk.alive || pk.type !== 'item' || !ITEMS[pk.item] || pk.amount <= 0 || pk.lockT > 0) continue;
      var d = Math.hypot(pk.x - p.x, pk.y - p.y);
      if (d <= bd && this.lineClear(p.x, p.y, pk.x, pk.y) && (!best || d < bd || pk.id < best.id)) { best = pk; bd = d; }
    }
    return best;
  };
  // Hotbar key: select that slot, or press it again to go back to your weapon.
  World.prototype.selectItem = function (p, idx) {
    if (p.mount || p.vehicle || p.downed) return;
    if (idx < 0 || idx === p.held) {
      if (p.held >= 0) { p.held = -1; this.emit({ type: 'switch', player: p }); }
      return;
    }
    if (!Number.isInteger(idx) || idx >= p.items.length) return;
    p.held = idx;
    var w = p.weapons[p.slot];
    if (w && w.reloading) { w.reloading = false; w.reloadT = 0; }
    p.scoping = false;
    this.refreshShield(p);
    this.emit({ type: 'switch', player: p });
  };

  // Clicking with an item selected uses it. The riot shield just needs to be held.
  World.prototype.useHeld = function (p, intent) {
    if (p.vehicle) return false;
    var held = p.held, it = this.heldItem(p);
    if (!it) return false;
    if (!intent.firePressed || p.itemCd > 0 || it.kind === 'hold') return false;
    var ok = false;
    if (it.kind === 'consume') ok = this.consumeItem(p, it);
    else if (it.kind === 'throw') ok = this.throwItem(p, it, intent);
    else if (it.kind === 'place') ok = this.placeItem(p, it, intent);
    else if (it.kind === 'target') ok = this.targetItem(p, it, intent);
    else if (it.kind === 'use') ok = this.activateItem(p, it);
    if (!ok) return false;
    this.takeItem(p, held, 1);
    p.itemCd = 0.4;
    p.recoil = 0.6;
    this.emit({ type: 'item-used', player: p, item: it.id });
    return true;
  };

  // ---------------------------------------------------------------- consumables and potions
  World.prototype.consumeItem = function (p, it) {
    if (it.mystery) {
      var pick = Rules.mysteryPick(this.rng.next()), chosen = ITEMS[pick];
      if (pick === 'poison') this.applyPoison(p, 0);
      else if (!this.consumeItem(p, chosen)) pick = 'nothing';
      this.emit({ type: 'buff', player: p, effect: 'mystery', mystery: pick, duration: chosen.duration || 0, item: it.id });
      return true;
    }
    if (it.heal) {
      var cap = p.maxHp + (it.overheal || 0), room = cap - p.hp;
      if (room <= 0.01) { this.emit({ type: 'deny', player: p, reason: 'fullhp' }); return false; }
      if (it.over) {
        p.regen = Math.max(p.regen, Math.min(it.heal, room));
        p.regenRate = it.heal / it.over;
        this.emit({ type: 'buff', player: p, effect: 'regen', duration: it.over, item: it.id });
        return true;
      }
      var healed = Math.min(it.heal, room);
      p.hp += healed;
      p.stats.healed += healed;
      this.healFx(p, healed);
      this.emit({ type: 'heal', player: p, by: p, amount: healed, item: it.id });
      return true;
    }
    if (it.effect) {
      this.applyEffect(p, it);
      this.emit({ type: 'buff', player: p, effect: it.effect, duration: it.duration || (it.immune || 0) + (it.reduceFor || 0), item: it.id });
      return true;
    }
    return false;
  };
  World.prototype.applyEffect = function (p, it) {
    var fx = p.fx;
    if (it.effect === 'shieldo') { fx.immune = Math.max(fx.immune, it.immune); fx.reduce = Math.max(fx.reduce, it.immune + it.reduceFor); return; }
    if (it.effect === 'power') {
      fx.power = Math.max(fx.power, it.duration);
      if (it.deathImmune) fx.deathImmune = Math.max(fx.deathImmune, it.deathImmune);
      return;
    }
    if (it.effect === 'poison') { this.applyPoison(p, 0); return; }
    fx[it.effect] = Math.max(fx[it.effect] || 0, it.duration);
  };
  World.prototype.applyPoison = function (p, byId) {
    p.fx.poison = Math.max(p.fx.poison, ITEMS.poison.duration);
    p.poisonBy = byId || 0;
  };
  World.prototype.activateItem = function (p, it) {
    if (it.effect === 'drone') {
      this.reveal[p.team] = Math.max(this.reveal[p.team] || 0, it.duration);
      this.emit({ type: 'buff', player: p, effect: 'drone', duration: it.duration, item: it.id, team: p.team });
      return true;
    }
    if (it.effect === 'radar') {
      p.fx.radar = Math.max(p.fx.radar, it.duration);
      this.emit({ type: 'buff', player: p, effect: 'radar', duration: it.duration, item: it.id });
      return true;
    }
    return false;
  };

  // Multipliers used by movement and damage (also by client-side prediction, so they only read player state).
  World.prototype.speedMul = function (p) {
    var fx = p.fx;
    if (!fx) return 1;
    var k = 1 + (fx.energy > 0 ? ITEMS.energybar.speed : 0) + (fx.speed > 0 ? ITEMS.speed.speed : 0) + (fx.power > 0 ? ITEMS.power.speed : 0);
    if (fx.poison > 0) k *= 1 - ITEMS.poison.slow;
    if (p.inSnow) k *= 1 - ITEMS.snowbomb.slow;
    if (p.shieldUp) k *= 1 - ITEMS.riotshield.slow;
    return k;
  };
  World.prototype.damageMul = function (src) {
    var fx = src && src.fx;
    if (!fx) return 1;
    return 1 + (fx.strength > 0 ? ITEMS.strength.damage : 0) + (fx.power > 0 ? ITEMS.power.damage : 0);
  };
  World.prototype.reduceMul = function (p) {
    var fx = p.fx;
    if (!fx) return 1;
    var k = 1;
    if (fx.shield > 0) k *= 1 - ITEMS.shield.reduce;
    if (fx.power > 0) k *= 1 - ITEMS.power.reduce;
    if (fx.reduce > 0) k *= 1 - ITEMS.shieldo.reduce;
    return k;
  };
  // The class shields occupy weapon slots; selecting a hotbar item puts them away.
  World.prototype.activeShield = function (p) {
    if (!p || !p.alive || p.downed || p.mount || p.vehicle || p.dropT > 0) return null;
    var held = this.heldItem(p);
    if (held) return held.id === 'riotshield' ? 'legacy' : null;
    if (p.held >= 0) return null;
    var weapon = p.weapons[p.slot], def = weapon && WEAPONS[weapon.id];
    if (weapon && weapon.id === 'shieldpistol' && weapon.reloading) return null;
    return def && def.shield || null;
  };
  World.prototype.refreshShield = function (p) { p.shieldUp = !!this.activeShield(p); };
  // Both class shields cover the same forward arc. Red adds blast/flash protection,
  // but area hazards and every tank attack pass through either class shield.
  World.prototype.shieldBlocks = function (p, fx, fy, cause) {
    var shield = this.activeShield(p);
    if (!shield || fx === undefined || fx === null) return false;
    if (['sentry-fireballs', 'sentry-burn', 'sentry-cannons'].indexOf(cause) >= 0) return false;
    if (shield !== 'legacy') {
      if (['fire', 'flamethrower', 'firenade', 'snow', 'snowbomb', 'blackhole', 'smoke', 'poison', 'lightning', 'meteor', 'airstrike', 'tank-cannon', 'tankmg', 'ram'].indexOf(cause) >= 0) return false;
      if (['grenade', 'launcher', 'launcher2', 'rpg', 'sentry-grenades', 'sentry-rockets', 'flashbang'].indexOf(cause) >= 0 && shield !== 'explosive') return false;
    } else if (cause === 'flashbang') return false;
    var a = Math.atan2(fy - p.y, fx - p.x);
    return Math.abs(U.angleDiff(p.angle, a)) <= ITEMS.riotshield.arc;
  };

  // Per-tick effect bookkeeping for a simulated player.
  World.prototype.tickEffects = function (p, dt) {
    var fx = p.fx, i, k;
    for (i = 0; i < FX_KEYS.length; i++) { k = FX_KEYS[i]; if (fx[k] > 0) fx[k] = Math.max(0, fx[k] - dt); }
    p.itemCd = Math.max(0, p.itemCd - dt);
    p.fullNoteT = Math.max(0, p.fullNoteT - dt);
    if (fx.poison > 0) {
      p.poisonT += dt;
      if (p.poisonT >= POISON_TICK) {
        p.poisonT -= POISON_TICK;
        this.damagePlayer(p, ITEMS.poison.dps * POISON_TICK, p.poisonBy && p.poisonBy !== p.id ? p.poisonBy : null, 'poison');
      }
    } else p.poisonT = 0;
    if (p.regen > 0 && p.alive) {
      var h = Math.min(p.regen, p.regenRate * dt, p.maxHp - p.hp);
      if (h <= 0) { p.regen = 0; p.regenAcc = 0; }
      else {
        p.hp += h; p.regen -= h; p.regenAcc += h; p.stats.healed += h;
        if (p.regenAcc >= 10 || p.regen <= 0.001) {
          this.text(p.x, p.y - p.r - 12, '+' + Math.round(p.regenAcc) + ' HP', '#63ff9e', 18);
          p.healFlash = 1;
          p.regenAcc = 0;
        }
      }
    }
    this.refreshShield(p);
  };

  // ---------------------------------------------------------------- throwables
  World.prototype.throwItem = function (p, it, intent) {
    var ax = intent.aimX, ay = intent.aimY;
    if (ax === null || ax === undefined) {
      ax = p.x + Math.cos(p.angle) * WEAPONS.grenade.throwRange;
      ay = p.y + Math.sin(p.angle) * WEAPONS.grenade.throwRange;
    }
    var g = this.lob(p, ax, ay, it.fuse > 0 ? it.fuse : 0, it.id, intent.charge);
    this.emit(Object.assign({ type: 'throw', player: p, left: p.items[p.held].n - 1, fuse: g.fuse, item: it.id }, this.projectileEvent(g)));
    return true;
  };

  // What happens where an item grenade comes to rest. Visuals run everywhere; effects only in the simulation.
  World.prototype.itemBurst = function (id, x, y, ownerId) {
    var it = ITEMS[id], self = this, owner = ownerId ? this.playerById(ownerId) : null, team = owner ? owner.team : null, sim = !this.remote;
    switch (id) {
      case 'grenade':
        this.explode(x, y, it.explosion, ownerId, 'grenade');
        return;
      case 'flashbang':
        this.explosions.push({ x: x, y: y, r: it.radius, t: 0, dur: 0.45, ring: true, color: '#ffffff' });
        this.explosions.push({ x: x, y: y, r: it.radius * 0.6, t: 0, dur: 0.3, power: 10, color: '#ffffff' });
        this.burst(x, y, 18, '#ffffff', 320, 0.4, 5);
        if (sim) {
          this.players.forEach(function (p) {
            if (!p.alive || p.dropT > 0 || Math.hypot(p.x - x, p.y - y) - p.r >= it.radius || !self.lineClear(x, y, p.x, p.y)) return;
            if (self.shieldBlocks(p, x, y, 'flashbang')) {
              self.emit({ type: 'blocked', player: p, how: 'shield', source: owner });
              return;
            }
            p.fx.flash = Math.max(p.fx.flash, it.flash);
            self.emit({ type: 'flashed', player: p, by: ownerId });
          });
        }
        break;
      case 'smoke':
        this.smoke(x, y, 10, '#b7bcc4', 40, 1.2, 160);
        if (sim) this.addZone({ kind: 'smoke', x: x, y: y, r: it.radius, dur: it.duration, owner: ownerId, team: team });
        break;
      case 'firenade':
        this.burst(x, y, 24, '#ff9a3c', 300, 0.6, 6);
        this.explosions.push({ x: x, y: y, r: it.radius, t: 0, dur: 0.45, ring: true, color: '#ff7a2a' });
        if (sim) this.addZone({ kind: 'fire', x: x, y: y, r: it.radius, dur: it.duration, owner: ownerId, team: team, dps: it.dps });
        break;
      case 'snowbomb':
        this.burst(x, y, 30, '#ffffff', 380, 0.8, 5);
        this.explosions.push({ x: x, y: y, r: it.radius, t: 0, dur: 0.7, ring: true, color: '#bfe9ff' });
        if (sim) this.addZone({ kind: 'snow', x: x, y: y, r: it.radius, dur: it.duration, owner: ownerId, team: team });
        break;
      case 'poison':
        this.explosions.push({ x: x, y: y, r: it.radius, t: 0, dur: 0.5, ring: true, color: '#8cff4a' });
        this.smoke(x, y, 10, '#7be35a', 20, 1, 110);
        if (sim) {
          this.players.forEach(function (p) {
            if (!p.alive || p.dropT > 0 || (p.id !== ownerId && team !== null && p.team === team) || Math.hypot(p.x - x, p.y - y) - p.r >= it.radius) return;
            self.applyPoison(p, ownerId);
            self.emit({ type: 'buff', player: p, effect: 'poison', duration: it.duration, item: id, by: ownerId });
          });
        }
        break;
      case 'blackhole':
        this.explosions.push({ x: x, y: y, r: it.radius, t: 0, dur: 0.7, ring: true, color: '#7a3bff' });
        this.explosions.push({ x: x, y: y, r: 90, t: 0, dur: 0.6, hole: true, color: '#120826' });
        for (var i = 0; i < 26; i++) {
          var a = this.rng.next() * U.TAU, d = it.radius * (0.4 + this.rng.next() * 0.6);
          this.particles.push({ kind: 'dot', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: -Math.cos(a) * d * 2.2, vy: -Math.sin(a) * d * 2.2, life: 0.45, max: 0.45, size: 5, color: '#b58cff', drag: 0 });
        }
        if (sim) this.pullEverything(x, y, it.radius, team);
        break;
      default:
        return;
    }
    if (sim) this.emit({ type: 'burst', item: id, x: x, y: y, owner: ownerId || 0 });
  };

  World.prototype.pullEverything = function (x, y, R, team) {
    var self = this, victims = this.players.filter(function (p) {
      return p.alive && p.dropT <= 0 && !p.mount && !p.vehicle && (team === null || p.team !== team) && Math.hypot(p.x - x, p.y - y) - p.r < R;
    });
    victims.forEach(function (p, i) {
      var a = i / Math.max(1, victims.length) * U.TAU, d = victims.length > 1 ? 28 : 0;
      p.x = x + Math.cos(a) * d; p.y = y + Math.sin(a) * d; p.vx = 0; p.vy = 0;
      self.collide(p);
      self.emit({ type: 'pulled', player: p, x: p.x, y: p.y });
    });
    this.map.pickups.forEach(function (pk) {
      if (!pk.alive || Math.hypot(pk.x - x, pk.y - y) >= R) return;
      pk.x = x + (self.rng.next() - 0.5) * 36; pk.y = y + (self.rng.next() - 0.5) * 36; pk.vx = 0; pk.vy = 0;
      self.emit({ type: 'spawn-pickup', pickup: pk });
    });
    this.grenades.forEach(function (g) { if (Math.hypot(g.x - x, g.y - y) < R) { g.x = x; g.y = y; g.vx = 0; g.vy = 0; } });
  };

  // ---------------------------------------------------------------- zones: fire, smoke, snow
  World.prototype.addZone = function (z) {
    z.id = z.id || this.nextId++;
    if (z.t === undefined) z.t = z.dur;
    z.tick = 0; z.age = z.age || 0;
    this.zones.push(z);
    if (!this.remote) this.emit({ type: 'zone', zone: z });
    return z;
  };
  World.prototype.zoneById = function (id) {
    for (var i = 0; i < this.zones.length; i++) if (this.zones[i].id === id) return this.zones[i];
    return null;
  };
  World.prototype.updateZones = function (dt) {
    var i, j, out = [], players = this.players, p, z, inside;
    for (j = 0; j < players.length; j++) players[j].inSnow = false;
    for (i = 0; i < this.zones.length; i++) {
      z = this.zones[i];
      z.t -= dt; z.age += dt;
      if (z.t <= 0) continue;
      out.push(z);
      this.zoneAmbience(z, dt);
      for (j = 0; j < players.length; j++) {
        p = players[j];
        if (!p.alive || p.dropT > 0) continue;
        if (z.kind === 'snow' && Math.hypot(p.x - z.x, p.y - z.y) < z.r) p.inSnow = true;
      }
      if (this.remote || z.kind !== 'fire') continue;
      z.tick -= dt;
      if (z.tick > 0) continue;
      z.tick += FIRE_TICK;
      for (j = 0; j < players.length; j++) {
        p = players[j];
        if (!p.alive || p.vehicle || p.dropT > 0 || (p.id !== z.owner && z.team !== null && z.team !== undefined && p.team === z.team)) continue;
        inside = Math.hypot(p.x - z.x, p.y - z.y) - p.r * 0.5 < z.r;
        if (inside) this.damagePlayer(p, z.dps * FIRE_TICK, z.owner, 'fire', p.x, p.y - p.r);
      }
      if (this.damageVehiclesInArea) this.damageVehiclesInArea(z.x, z.y, z.r, z.dps * FIRE_TICK, z.owner, 'fire', { team: z.team });
    }
    this.zones = out;
    if (this.remote) return;
    for (j = 0; j < players.length; j++) {
      p = players[j];
      if (!p.inSnow || !p.alive || p.vehicle) { p.snowT = 0; p.snowTick = 0; continue; }
      p.snowT += dt;
      if (p.snowT < ITEMS.snowbomb.graceTime) continue;
      p.snowTick -= dt;
      if (p.snowTick > 0) continue;
      p.snowTick += SNOW_TICK;
      var dps = Math.max(SNOW_MIN_DPS, this.storm && this.storm.dps ? this.storm.dps : 0);
      this.damagePlayer(p, dps * SNOW_TICK, null, 'snow');
    }
    if (this.updateVehicleSnow) this.updateVehicleSnow(dt);
  };
  World.prototype.zoneAmbience = function (z, dt) {
    var n = z.kind === 'smoke' ? 0 : Math.min(4, Math.round(z.r / 150 * (z.kind === 'fire' ? 2.2 : 1.3)));
    for (var i = 0; i < n; i++) {
      if (this.rng.next() > dt * 10) continue;
      var a = this.rng.next() * U.TAU, d = Math.sqrt(this.rng.next()) * z.r;
      if (z.kind === 'fire') {
        this.particles.push({ kind: 'dot', x: z.x + Math.cos(a) * d, y: z.y + Math.sin(a) * d, vx: (this.rng.next() - 0.5) * 30, vy: -60 - this.rng.next() * 60,
          life: 0.5 + this.rng.next() * 0.3, max: 0.8, size: 6 + this.rng.next() * 8, color: this.rng.chance(0.5) ? '#ff9a3c' : '#ffd36b', drag: 1 });
      } else {
        this.particles.push({ kind: 'dot', x: z.x + Math.cos(a) * d, y: z.y + Math.sin(a) * d - 20, vx: (this.rng.next() - 0.5) * 40, vy: 40 + this.rng.next() * 40,
          life: 0.9, max: 0.9, size: 3 + this.rng.next() * 3, color: '#ffffff', drag: 0 });
      }
    }
  };

  // ---------------------------------------------------------------- structures: rock, turret, sentry, teleporter
  World.prototype.structById = function (id) {
    for (var i = 0; i < this.structures.length; i++) if (this.structures[i].id === id) return this.structures[i];
    return null;
  };
  World.prototype.placeItem = function (p, it, intent) {
    var ax = intent.aimX, ay = intent.aimY, reach = it.reach || 150;
    if (ax === null || ax === undefined) { ax = p.x + Math.cos(p.angle) * reach * 0.6; ay = p.y + Math.sin(p.angle) * reach * 0.6; }
    var dx = ax - p.x, dy = ay - p.y, d = Math.hypot(dx, dy) || 1;
    if (d > reach) { ax = p.x + dx / d * reach; ay = p.y + dy / d * reach; }
    var r = it.radius || W.STRUCT_RADIUS[it.struct] || 30, pad = it.struct === 'teleporter';
    if (!this.spotFree(ax, ay, r, pad)) { this.emit({ type: 'deny', player: p, reason: 'blocked' }); return false; }
    var s = this.addStruct({ kind: it.struct, item: it.id, x: ax, y: ay, r: r, owner: p.id, team: p.team, hp: it.hp || 0, maxHp: it.hp || 0, angle: p.angle });
    if (it.struct === 'turret') this.mountTurret(p, s);
    if (pad) {
      var open = p.openPad ? this.structById(p.openPad) : null;
      if (open && open.alive && !open.pair) {
        open.pair = s.id; s.pair = open.id; p.openPad = 0;
        this.emit({ type: 'struct', op: 'pair', struct: s });
        this.emit({ type: 'struct', op: 'pair', struct: open });
      } else p.openPad = s.id;
    }
    return true;
  };
  World.prototype.spotFree = function (x, y, r, pad) {
    if (!U.insideIsland(x, y, r + 10, C.worldSize, C.cornerRadius)) return false;
    var free = true, i;
    this.solids.query(x - r, y - r, x + r, y + r, function (s) {
      if (!free || (s.crate && !s.crate.alive) || (s.rock && !s.rock.alive) || (s.struct && !s.struct.alive)) return;
      if (s.shape === 'circle') { if (Math.hypot(s.x - x, s.y - y) < s.r + r) free = false; }
      else if (U.circleRectPush(x, y, r, s.x, s.y, s.w, s.h)) free = false;
    });
    if (!free) return false;
    for (i = 0; i < (this.vehicles || []).length; i++) {
      var vehicle = this.vehicles[i];
      if (this.remote && vehicle.hidden) continue;
      if (Math.hypot(vehicle.x - x, vehicle.y - y) < vehicle.r + r) return false;
    }
    for (i = 0; i < this.structures.length; i++) {
      var st = this.structures[i];
      if (st.alive && Math.hypot(st.x - x, st.y - y) < st.r + r) return false;
    }
    if (!pad) {
      for (i = 0; i < this.players.length; i++) {
        var p = this.players[i];
        if (p.alive && p.dropT <= 0 && Math.hypot(p.x - x, p.y - y) < p.r + r) return false;
      }
    }
    return true;
  };
  World.prototype.addStruct = function (o) {
    var portableRock = o.kind === 'rock', rockHp = W.PLAYER_ROCK ? W.PLAYER_ROCK.hp : 1000;
    var s = {
      id: o.id || this.nextStructId++, kind: o.kind, item: o.item, x: o.x, y: o.y, r: o.r, owner: o.owner || 0, team: o.team === undefined ? null : o.team,
      hp: portableRock ? (Number.isFinite(o.hp) && o.hp > 0 ? Math.min(rockHp, o.hp) : rockHp) : o.hp || 0,
      maxHp: portableRock ? rockHp : o.maxHp || 0, alive: true, angle: o.angle || 0, cooldown: 0, mounted: o.mounted || 0, target: 0, pair: o.pair || 0, age: 0, shake: 0, flash: 0
    };
    if (o.id) this.nextStructId = Math.max(this.nextStructId, o.id + 1);
    this.structures.push(s);
    if (s.kind !== 'teleporter') {
      this.solids.insert({ type: 'struct', shape: 'circle', x: s.x, y: s.y, r: s.r, struct: s }, s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r);
    }
    this.explosions.push({ x: s.x, y: s.y, r: s.r * 2.2, t: 0, dur: 0.4, ring: true, color: '#ffffff' });
    this.smoke(s.x, s.y, 8, '#d8d2c4', 14, 0.6, 120);
    if (!this.remote) this.emit({ type: 'struct', op: 'add', struct: s });
    return s;
  };
  // A full-speed tank impact chips portable rocks, including the driver's own or a teammate's cover.
  // Weapons and explosions use damageStruct below and cannot hurt these rocks.
  World.prototype.damagePlayerRock = function (s, sourceId, hx, hy) {
    if (this.remote || !s || !s.alive || s.kind !== 'rock' || this.structById(s.id) !== s) return false;
    if (!(s.maxHp > 0)) { s.maxHp = W.PLAYER_ROCK ? W.PLAYER_ROCK.hp : 1000; s.hp = s.maxHp; }
    var damage = W.TANK ? W.TANK.playerRockRamDamage : 100, src = sourceId ? this.playerById(sourceId) : null;
    damage = Math.round(damage * this.outgoingClassDamageMul(src) * 10) / 10;
    var amount = Math.min(s.hp, damage);
    s.hp = Math.max(0, s.hp - damage); s.shake = 1;
    if (src) src.stats.damage += amount;
    var x = hx === undefined ? s.x : hx, y = hy === undefined ? s.y - s.r : hy;
    this.text(x, y - 6, String(amount), '#ffd84a', 18);
    if (s.hp > 0) this.emit({ type: 'struct', op: 'hp', struct: s, amount: amount, source: src, x: x, y: y });
    else this.destroyStruct(s, sourceId);
    return true;
  };
  World.prototype.damageStruct = function (s, amount, sourceId, hx, hy, cause) {
    if (!s.alive || s.kind === 'rock' || amount <= 0 || !s.maxHp) return;
    if (s.mounted) {
      // Whoever is on the turret takes the hit: a turret is not a shield.
      var m = this.playerById(s.mounted);
      if (m && m.alive) { this.damagePlayer(m, amount, sourceId, cause || 'turret', hx, hy); return; }
    }
    var src = sourceId ? this.playerById(sourceId) : null;
    amount *= this.outgoingClassDamageMul(src);
    s.hp -= amount;
    s.shake = 1;
    if (src) src.stats.damage += amount;
    this.text(hx === undefined ? s.x : hx, (hy === undefined ? s.y - s.r : hy) - 6, String(Math.round(amount)), '#ffd84a', 18);
    if (s.hp > 0) { this.emit({ type: 'struct', op: 'hp', struct: s, amount: amount, source: src, x: hx, y: hy }); return; }
    this.destroyStruct(s, sourceId);
  };
  World.prototype.destroyStruct = function (s, sourceId, reason) {
    if (!s.alive) return;
    s.alive = false; s.hp = 0;
    s.removalReason = reason || 'destroyed';
    if (s.mounted) { var m = this.playerById(s.mounted); if (m && m.mount === s.id) this.dismount(m, true); s.mounted = 0; }
    this.burst(s.x, s.y, 20, '#9aa1a9', 260, 0.7, 6);
    this.explosions.push({ x: s.x, y: s.y, r: s.r * 2.4, t: 0, dur: 0.5, ring: true, color: '#ffb347' });
    this.smoke(s.x, s.y, 10, '#8f8f8f', 18, 1, 100);
    var i = this.structures.indexOf(s);
    if (i >= 0) this.structures.splice(i, 1);
    if (!this.remote) this.emit({ type: 'struct', op: 'gone', struct: s, source: sourceId || 0, reason: s.removalReason });
  };
  // Client mirror helpers.
  World.prototype.structFromServer = function (m) {
    var s = this.structById(m.id);
    if (m.op === 'add' && !s) {
      return this.addStruct({ id: m.id, kind: m.k, item: m.it, x: m.x, y: m.y, r: m.r, owner: m.o, team: m.tm, hp: m.hp, maxHp: m.mhp, angle: m.a, mounted: m.m, pair: m.pr });
    }
    if (!s) return null;
    if (m.op === 'hp') { s.hp = m.hp; s.shake = 1; if (m.n) this.text(m.x === undefined ? s.x : m.x, (m.y === undefined ? s.y - s.r : m.y) - 6, String(Math.round(m.n)), '#ffd84a', 18); }
    else if (m.op === 'repair' || m.op === 'upgrade' || m.op === 'state') { s.hp = m.hp; s.maxHp = m.mhp; s.item = m.it; s.angle = m.a; if (m.op === 'state') { s.mounted = m.m || 0; s.pair = m.pr || 0; } }
    else if (m.op === 'gone') this.destroyStruct(s, m.src, m.reason);
    else if (m.op === 'mount') { s.mounted = m.m || 0; var mp = s.mounted ? this.playerById(s.mounted) : null; if (mp) mp.mount = s.id; }
    else if (m.op === 'pair') s.pair = m.pr || 0;
    return s;
  };

  // ---------------------------------------------------------------- turrets (mounted) and sentries (automatic)
  World.prototype.nearestMountable = function (p) {
    var best = null, bd = Infinity;
    for (var i = 0; i < this.structures.length; i++) {
      var s = this.structures[i];
      if (!s.alive || s.kind !== 'turret' || s.mounted || (s.team !== null && s.team !== p.team)) continue;
      var d = Math.hypot(s.x - p.x, s.y - p.y) - s.r - p.r;
      if (d < MOUNT_RANGE && d < bd && this.lineClear(p.x, p.y, s.x, s.y, s)) { bd = d; best = s; }
    }
    return best;
  };
  World.prototype.nearestRecoverableRock = function (p) {
    if (!p || !p.alive || p.downed || p.dropT > 0 || p.mount) return null;
    var best = null, bd = PICKUP_RANGE;
    for (var i = 0; i < this.structures.length; i++) {
      var s = this.structures[i];
      if (!s.alive || s.kind !== 'rock' || (s.owner !== p.id && (s.team === null || s.team !== p.team))) continue;
      var d = Math.hypot(s.x - p.x, s.y - p.y) - s.r - p.r;
      if (d <= bd && this.lineClear(p.x, p.y, s.x, s.y, s)) { best = s; bd = d; }
    }
    return best;
  };
  World.prototype.recoverRock = function (p, s) {
    if (this.remote || !s || this.nearestRecoverableRock(p) !== s) return false;
    if (!this.canTake(p, 'rock')) { this.emit({ type: 'deny', player: p, reason: 'full', item: 'rock' }); return false; }
    if (this.addItem(p, 'rock', 1) !== 0) return false;
    this.destroyStruct(s, p.id, 'recovered');
    this.pickupText(p, 'item', 1, this.countItem(p, 'rock'), 'rock');
    return true;
  };
  // A press resolves one interaction: dismount, revive, item, owned rock, mount.
  World.prototype.pressInteract = function (p) {
    if (this.remote || !p || !p.alive || p.downed || p.dropT > 0) return false;
    if (p.vehicle && this.exitVehicle) return this.exitVehicle(p, false);
    if (p.mount) return this.dismount(p, false);
    if (this.teams && this.teammates(p).some(function (o) { return o.alive && o.downed && Math.hypot(o.x - p.x, o.y - p.y) <= 70 + p.r; })) return false;
    var pk = this.nearestItemPickup(p);
    if (pk) {
      if (!this.wantsPickup(p, pk)) this.emit({ type: 'deny', player: p, reason: 'full', item: pk.item });
      else this.collect(p, pk);
      return true;
    }
    var rock = this.nearestRecoverableRock(p);
    if (rock) { this.recoverRock(p, rock); return true; }
    var seat = this.nearestVehicleSeat && this.nearestVehicleSeat(p);
    if (seat) return this.enterVehicle(p, seat.vehicle, seat.seat);
    var s = this.nearestMountable(p);
    if (!s) return false;
    return this.mountTurret(p, s);
  };
  World.prototype.mountTurret = function (p, s) {
    if (this.remote || !p || !p.alive || p.downed || p.dropT > 0 || p.mount || p.vehicle || !s || !s.alive || s.kind !== 'turret' || s.mounted || (s.team !== null && s.team !== p.team)) return false;
    if (Math.hypot(p.x - s.x, p.y - s.y) > MOUNT_RANGE + s.r + p.r || !this.lineClear(p.x, p.y, s.x, s.y, s)) return false;
    if (this.stopVehicleRepair) this.stopVehicleRepair(p);
    p.mount = s.id; s.mounted = p.id;
    p.x = s.x; p.y = s.y; p.vx = p.vy = p.ox = p.oy = 0; p.held = -1; p.scoping = false; p.shieldUp = false; p.sprinting = false; p.nearStation = null; p.wantsRevive = false;
    var w = p.weapons[p.slot];
    if (w && w.reloading) { w.reloading = false; w.reloadT = 0; }
    this.emit({ type: 'mounted', player: p, struct: s });
    this.emit({ type: 'struct', op: 'mount', struct: s });
    return true;
  };
  World.prototype.dismount = function (p, forced) {
    var s = p.mount ? this.structById(p.mount) : null;
    if (!s) { p.mount = 0; return false; }
    var spot = null, base = p.angle + Math.PI, max = forced ? 1200 : 260, self = this;
    function pathFree(x, y) {
      var clear = self.lineClear(s.x, s.y, x, y, s), r = p.r;
      self.solids.query(Math.min(s.x, x) - r, Math.min(s.y, y) - r, Math.max(s.x, x) + r, Math.max(s.y, y) + r, function (solid) {
        if (!clear || solid.struct === s || (solid.struct && !solid.struct.alive) || (solid.rock && !solid.rock.alive) || (solid.crate && !solid.crate.alive)) return;
        var hit = solid.shape === 'circle' ? U.segCircle(s.x, s.y, x, y, solid.x, solid.y, solid.r + r)
          : U.segRect(s.x, s.y, x, y, solid.x - r, solid.y - r, solid.w + r * 2, solid.h + r * 2);
        if (hit >= 0) clear = false;
      });
      for (var k = 0; clear && k < (self.vehicles || []).length; k++) {
        var vehicle = self.vehicles[k];
        if (self.remote && vehicle.hidden) continue;
        if (U.segCircle(s.x, s.y, x, y, vehicle.x, vehicle.y, vehicle.r + r) >= 0) clear = false;
      }
      return clear;
    }
    for (var distance = s.r + p.r + 8; distance <= max && !spot; distance += 24) {
      for (var i = 0; i < 24; i++) {
        var angle = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * U.TAU / 24;
        var x = s.x + Math.cos(angle) * distance, y = s.y + Math.sin(angle) * distance;
        if (!this.spotFree(x, y, p.r, true) || this.inPond(x, y)) continue;
        if (this.players.some(function (o) { return o !== p && o.alive && !o.vehicle && o.dropT <= 0 && Math.hypot(o.x - x, o.y - y) < o.r + p.r + 2; })) continue;
        if (forced || pathFree(x, y)) { spot = { x: x, y: y }; break; }
      }
    }
    if (!spot && !forced) { this.emit({ type: 'deny', player: p, reason: 'blocked' }); return false; }
    p.mount = 0;
    if (spot) { p.x = spot.x; p.y = spot.y; }
    else this.collide(p);
    p.vx = p.vy = p.ox = p.oy = 0; p.sprinting = false; p.wantsRevive = false; p.nearStation = null;
    if (s && s.mounted === p.id) { s.mounted = 0; this.emit({ type: 'struct', op: 'mount', struct: s }); }
    this.emit({ type: 'dismounted', player: p });
    return true;
  };
  World.prototype.updateMounted = function (p, intent, dt) {
    var s = this.structById(p.mount);
    if (!s || !s.alive) { p.mount = 0; return; }
    if (intent.interactPressed) { this.dismount(p); return; }
    p.x = s.x; p.y = s.y; p.wantsRevive = false; p.nearStation = null; p.sprinting = false;
    if (intent.aimX !== null && intent.aimX !== undefined) p.angle = Math.atan2(intent.aimY - s.y, intent.aimX - s.x);
    s.angle = p.angle;
    s.cooldown -= dt;
    p.vx = 0; p.vy = 0;
    if (!(intent.fire || intent.firePressed) || s.cooldown > 0) return;
    var it = ITEMS[s.item], def = Object.assign({}, WEAPONS.turret, { damage: it.damage });
    s.cooldown = it.fireInterval;
    var a = p.angle + (this.rng.next() - 0.5) * 2 * def.spread;
    this.turretShot(p, s, def, a);
    p.stats.shots++;
    this.emit({ type: 'shot', player: p, weapon: 'turret', x: s.x, y: s.y, angles: [a], struct: s.id });
  };
  World.prototype.turretShot = function (p, s, def, a) {
    var proxy = { id: p.id, team: p.team, color: p.color, outline: p.outline, r: s.r, x: s.x, y: s.y, angle: a, vx: 0, vy: 0, recoil: 0, isLocal: p.isLocal };
    this.spawnShot(proxy, def, [a]);
    s.flash = 1;
    s.angle = a;
  };
  World.prototype.updateSentry = function (s, dt) {
    var it = ITEMS[s.item], target = null, targetCrate = false, targetVehicle = false, bd = it.range;
    s.cooldown -= dt;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.alive || p.vehicle || p.dropT > 0 || p.fx.invisible > 0 || (s.team !== null && p.team === s.team)) continue;
      var d = Math.hypot(p.x - s.x, p.y - s.y) || 1;
      if (d < bd && this.sentryLineClear(s, p.x, p.y)) { bd = d; target = p; }
    }
    // Vehicle hulls protect their occupants, so target the occupied hull itself.
    // A passenger's invisibility does not hide a tank or Humvee.
    for (var vi = 0; vi < (this.vehicles || []).length; vi++) {
      var v = this.vehicles[vi], team = this.vehicleTeam(v);
      if (v.wreck || !(v.hp > 0) || team === null || (s.team !== null && team === s.team)) continue;
      var dv = Math.max(0, Math.hypot(v.x - s.x, v.y - s.y) - v.r);
      if (dv < bd && this.sentryLineClear(s, v.x, v.y, null, v.id)) { bd = dv; target = v; targetVehicle = true; }
    }
    // Enemies always take priority. When no enemy is visible, open nearby crates.
    if (!target) for (var j = 0; j < this.map.crates.length; j++) {
      var c = this.map.crates[j];
      if (!c.alive) continue;
      var dc = Math.hypot(c.x - s.x, c.y - s.y);
      if (dc < bd && this.sentryLineClear(s, c.x, c.y, c)) { bd = dc; target = c; targetCrate = true; }
    }
    if (!target) { s.target = 0; s.targetKind = null; return; }
    s.target = targetCrate ? -(target.id + 1) : target.id;
    s.targetKind = targetCrate ? 'crate' : targetVehicle ? 'vehicle' : 'player';
    s.angle = Math.atan2(target.y - s.y, target.x - s.x);
    if (s.cooldown > 0) return;
    s.cooldown = it.fireInterval;
    s.flash = 1;
    this.sentryTracer(s, target.x, target.y);
    if (targetCrate) this.damageCrate(target, it.damage, s.owner, target.x, target.y - target.size / 2);
    else if (targetVehicle) this.damageVehicle(target, it.damage, s.owner, 'sentry', target.x, target.y - target.r);
    else this.damagePlayer(target, it.damage, s.owner, 'sentry', target.x, target.y - target.r, { x: s.x, y: s.y });
    this.emit({ type: 'sentry-shot', struct: s, x: s.x, y: s.y, tx: target.x, ty: target.y });
  };
  World.prototype.sentryLineClear = function (s, tx, ty, targetCrate, vehicleId) {
    var distance = Math.hypot(tx - s.x, ty - s.y) || 1;
    var x = s.x + (tx - s.x) / distance * (s.r + 2), y = s.y + (ty - s.y) / distance * (s.r + 2);
    if (!this.lineClear(x, y, tx, ty, s, false, vehicleId && this.vehicleById ? this.vehicleById(vehicleId) : null)) return false;
    for (var i = 0; i < this.map.crates.length; i++) {
      var c = this.map.crates[i];
      if (!c.alive || c === targetCrate) continue;
      var hit = U.segRect(x, y, tx, ty, c.x - c.size / 2, c.y - c.size / 2, c.size, c.size);
      if (hit >= 0 && hit < 0.999) return false;
    }
    return true;
  };
  World.prototype.sentryTracer = function (s, tx, ty) {
    this.particles.push({ kind: 'tracer', x: s.x, y: s.y, tx: tx, ty: ty, vx: 0, vy: 0, life: 0.09, max: 0.09, size: 3, color: '#ff5a4f', drag: 0 });
    this.flash(s.x + Math.cos(s.angle) * s.r, s.y + Math.sin(s.angle) * s.r, s.angle, 'sentry');
  };

  // ---------------------------------------------------------------- teleporter pads
  World.prototype.padAt = function (x, y) {
    for (var i = 0; i < this.structures.length; i++) {
      var s = this.structures[i];
      if (s.alive && s.kind === 'teleporter' && Math.hypot(s.x - x, s.y - y) < s.r) return s;
    }
    return null;
  };
  World.prototype.updatePads = function (dt) {
    var it = ITEMS.teleporter;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      p.tpProgress = 0;
      if (!p.alive || p.dropT > 0 || p.mount || p.vehicle) { p.tpT = 0; p.tpPad = 0; continue; }
      var pad = this.padAt(p.x, p.y);
      if (!pad) { p.tpT = 0; p.tpPad = 0; p.tpLock = 0; continue; }
      if (p.tpLock === pad.id) continue; // just arrived here: step off before this pad works again
      var pair = pad.pair ? this.structById(pad.pair) : null;
      if (!pair || !pair.alive) { p.tpT = 0; continue; }
      if (p.tpPad !== pad.id) { p.tpPad = pad.id; p.tpT = 0; }
      p.tpT += dt;
      var need = pad.team !== null && p.team === pad.team ? it.teamTime : it.otherTime;
      p.tpProgress = Math.min(1, p.tpT / need);
      if (p.tpT < need) continue;
      var fromX = p.x, fromY = p.y;
      p.x = pair.x; p.y = pair.y; p.vx = 0; p.vy = 0;
      this.collide(p);
      p.tpLock = pair.id; p.tpPad = pair.id; p.tpT = 0; p.tpProgress = 0;
      this.teleportFx(fromX, fromY, p.x, p.y);
      this.emit({ type: 'teleport', player: p, fromX: fromX, fromY: fromY, x: p.x, y: p.y });
    }
  };
  World.prototype.teleportFx = function (x1, y1, x2, y2) {
    this.explosions.push({ x: x1, y: y1, r: 80, t: 0, dur: 0.45, ring: true, color: '#7fe9ff' });
    this.explosions.push({ x: x2, y: y2, r: 80, t: 0, dur: 0.45, ring: true, color: '#7fe9ff' });
    this.burst(x2, y2, 16, '#7fe9ff', 260, 0.6, 5);
  };

  // ---------------------------------------------------------------- lightning and meteor strikes
  World.prototype.targetItem = function (p, it, intent) {
    var ax = intent.aimX, ay = intent.aimY;
    if (ax === null || ax === undefined) { this.emit({ type: 'deny', player: p, reason: 'notarget' }); return false; }
    var dx = ax - p.x, dy = ay - p.y, d = Math.hypot(dx, dy) || 1;
    if (d > it.range) { ax = p.x + dx / d * it.range; ay = p.y + dy / d * it.range; }
    var target = null, bd = it.lock;
    for (var i = 0; i < this.players.length; i++) {
      var o = this.players[i];
      if (!o.alive || o.dropT > 0 || o.team === p.team || o.fx.invisible > 0) continue;
      var od = Math.hypot(o.x - ax, o.y - ay) - o.r;
      if (od < bd) { bd = od; target = o; }
    }
    if (it.id === 'lightning' && !target) { this.emit({ type: 'deny', player: p, reason: 'notarget' }); return false; }
    if (target) { ax = target.x; ay = target.y; }
    this.addStrike({ kind: it.id, x: ax, y: ay, target: target ? target.id : 0, t: it.delay, owner: p.id, team: p.team, radius: it.radius || 0, damage: it.damage });
    return true;
  };
  World.prototype.addStrike = function (o) {
    o.id = o.id || this.nextId++;
    if (o.dur === undefined) o.dur = o.t;
    this.strikes.push(o);
    if (!this.remote) this.emit({ type: 'strike', strike: o });
    return o;
  };
  World.prototype.strikeById = function (id) {
    for (var i = 0; i < this.strikes.length; i++) if (this.strikes[i].id === id) return this.strikes[i];
    return null;
  };
  World.prototype.updateStrikes = function (dt) {
    var out = [], i, j;
    for (i = 0; i < this.strikes.length; i++) {
      var st = this.strikes[i];
      st.t -= dt;
      if (st.kind === 'lightning' && st.target) {
        var tp = this.playerById(st.target);
        if (tp && tp.alive) { st.x = tp.x; st.y = tp.y; }
      }
      if (st.t > 0 || this.remote) { if (st.t > -1.5) out.push(st); continue; } // the client waits for the server's hit event
      this.strikeFx(st);
      var owner = st.owner ? this.playerById(st.owner) : null, team = owner ? owner.team : st.team;
      if (st.kind === 'lightning') {
        var victim = this.playerById(st.target);
        if (victim && victim.alive) this.damagePlayer(victim, st.damage, st.owner, 'lightning', victim.x, victim.y - victim.r);
      } else {
        var R = st.radius, self = this, hitMounts = {};
        for (j = 0; j < this.players.length; j++) {
          var p = this.players[j];
          if (!p.alive || p.vehicle || p.dropT > 0 || (team !== null && team !== undefined && p.team === team)) continue;
          if (Math.hypot(p.x - st.x, p.y - st.y) - p.r < R) { if (p.mount) hitMounts[p.mount] = true; this.damagePlayer(p, st.damage, st.owner, 'meteor', p.x, p.y - p.r); }
        }
        var crates = [], structs = [];
        this.solids.query(st.x - R, st.y - R, st.x + R, st.y + R, function (s) {
          if (s.type === 'crate' && s.crate.alive) crates.push(s.crate);
          if (s.type === 'struct' && s.struct.alive && s.struct.maxHp && (team === null || s.struct.team !== team)) structs.push(s.struct);
        });
        crates.forEach(function (c) { if (Math.hypot(c.x - st.x, c.y - st.y) < R + c.size / 2) self.damageCrate(c, st.damage, st.owner, c.x, c.y - c.size / 2); });
        structs.forEach(function (s) { if (!hitMounts[s.id] && Math.hypot(s.x - st.x, s.y - st.y) < R + s.r) self.damageStruct(s, st.damage, st.owner, s.x, s.y - s.r, 'meteor'); });
        if (this.damageVehiclesInArea) this.damageVehiclesInArea(st.x, st.y, R, st.damage, st.owner, 'meteor', { team: team });
      }
      this.emit({ type: 'strike-hit', strike: st });
    }
    this.strikes = out;
  };
  // Client: the server says a strike landed.
  World.prototype.resolveStrike = function (id, x, y) {
    var st = this.strikeById(id);
    if (st) { this.strikes.splice(this.strikes.indexOf(st), 1); if (x !== undefined) { st.x = x; st.y = y; } this.strikeFx(st); return st; }
    return null;
  };
  World.prototype.strikeFx = function (st) {
    if (st.kind === 'lightning') {
      this.particles.push({ kind: 'bolt', x: st.x, y: st.y, vx: 0, vy: 0, life: 0.28, max: 0.28, size: 6, color: '#ffffff', drag: 0, seed: this.rng.next() * 1000 });
      this.explosions.push({ x: st.x, y: st.y, r: 110, t: 0, dur: 0.35, ring: true, color: '#fff6a8' });
      this.burst(st.x, st.y, 14, '#fff6a8', 300, 0.4, 4);
    } else {
      this.explosions.push({ x: st.x, y: st.y, r: st.radius, t: 0, dur: 0.9, power: 120, kind: st.kind });
      this.explosions.push({ x: st.x, y: st.y, r: st.radius * 1.25, t: 0, dur: 0.8, ring: true, color: '#ff8a3c' });
      this.burst(st.x, st.y, 40, '#ff9a3c', 420, 0.9, 8);
      this.smoke(st.x, st.y, 18, '#6b5a4a', 30, 1.4, 180);
    }
  };

  // ---------------------------------------------------------------- per tick
  World.prototype.updateItems = function (dt) {
    var i, team;
    for (team in this.reveal) if (this.reveal[team] > 0) this.reveal[team] = Math.max(0, this.reveal[team] - dt);
    for (i = 0; i < this.structures.length; i++) {
      var s = this.structures[i];
      s.age += dt;
      s.shake = Math.max(0, s.shake - dt * 5);
      s.flash = Math.max(0, s.flash - dt * 9);
      if (!this.remote && s.alive && s.kind === 'sentry') this.updateSentry(s, dt);
    }
    this.updateZones(dt);
    this.updateStrikes(dt);
    if (!this.remote) this.updatePads(dt);
  };

  // Is `p` visible to `viewer`? Invisible players only show to their own team.
  World.prototype.visibleTo = function (p, viewer) {
    if (!p.fx || p.fx.invisible <= 0) return true;
    return !viewer || viewer === p || viewer.team === p.team;
  };
  // Drone/radar targets and nearby crew exposed by active vehicle repair.
  World.prototype.revealedEnemies = function (viewer) {
    if (!viewer) return [];
    var drone = (this.reveal[viewer.team] || 0) > 0, radar = viewer.fx && viewer.fx.radar > 0, R = ITEMS.radar.radius;
    var repairRadius = ITEMS.smoke.radius * W.ARMOR_CREW.repairRevealMul, out = [];
    for (var i = 0; i < this.players.length; i++) {
      var o = this.players[i];
      if (o === viewer || !o.alive || o.team === viewer.team || o.hidden || o.dropT > 0) continue;
      var distance = Math.hypot(o.x - viewer.x, o.y - viewer.y);
      var repairing = o.classId === 'armorcrew' && o.repairVehicle && !o.downed && !o.vehicle && !o.mount;
      if (drone || (radar && distance < R) || (repairing && distance <= repairRadius)) out.push(o);
    }
    return out;
  };

  // ---------------------------------------------------------------- crate loot
  World.prototype.crateLoot = function (c, src) {
    var tier = CRATES[c.tier] || CRATES.common, rng = this.rng, t;
    var tokens = Rules.crateTokens(tier.id, rng.next());
    for (t = 0; t < tokens; t++) this.spawnPickup('token', c.x, c.y, 1, true);
    if (rng.next() < tier.armor) this.spawnPickup('armor', c.x, c.y, 1, true);
    if (rng.next() < tier.key) this.spawnPickup('key', c.x, c.y, 1, true);
    if (tier.id === 'legendary') {
      Rules.itemsOfTier('legendary').forEach(function (id) { this.spawnPickup('item', c.x, c.y, 1, true, id); }, this);
      this.emit({ type: 'legendary-crate-broken', crate: c, player: src || null });
      return { tokens: tokens, item: 'legendary' };
    }
    var lootTier = Rules.crateLootTier(tier.id, rng.next());
    if (lootTier) {
      var id = rng.pick(Rules.itemsOfTier(lootTier));
      this.spawnPickup('item', c.x, c.y, ITEMS[id].found, true, id);
    }
    return { tokens: tokens, item: lootTier };
  };

  W.ZONE_COLORS = ZONE_COLORS;
  W.ItemRules = { MOUNT_RANGE: MOUNT_RANGE, PICKUP_RANGE: PICKUP_RANGE, DROP_LOCK: DROP_LOCK, FIRE_TICK: FIRE_TICK, POISON_TICK: POISON_TICK, SNOW_TICK: SNOW_TICK, SNOW_MIN_DPS: SNOW_MIN_DPS, SAVED_HP: SAVED_HP };
}());
