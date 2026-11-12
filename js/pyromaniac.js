/* Pyromaniac weapons and extinguishable burns, shared by Practice and multiplayer. */
(function () {
  'use strict';
  var W = window.Warz, World = W.World, U = W.U, EPS = 1e-8;
  var baseClass = World.prototype.setClass, baseClassUpdate = World.prototype.updateClassCombat;
  var baseTrigger = World.prototype.trigger, baseUtility = World.prototype.useUtility, baseReload = World.prototype.startReload;
  var basePlayerDamage = World.prototype.damagePlayer, baseVehicleDamage = World.prototype.damageVehicle;
  var baseUpdate = World.prototype.update, baseShield = World.prototype.shieldBlocks, baseZone = World.prototype.addZone;
  var basePlayerSnow = World.prototype.applyPlayerSentrySnow, baseVehicleSnow = World.prototype.applyVehicleSentrySnow;
  var P = W.Pyro = {
    firegunCost: 50, fireBarMax: 50, fireWindow: 60, burnDamageFraction: 0.1, burnTimeFraction: 0.4,
    flameStage: function (seconds) {
      if (seconds >= 10 - EPS) return { damage: 70, interval: 0.1 };
      if (seconds >= 7.5 - EPS) return { damage: 45, interval: 0.15 };
      return { damage: seconds >= 5 - EPS ? 15 : seconds >= 2.5 - EPS ? 10 : 5, interval: 0.25 };
    },
    firegunDamage: function (bar) { return U.clamp(bar || 0, 0, P.fireBarMax) / 2 / P.fireBarMax * 1800; }
  };
  function detached(p) { return !!(p.net && !p.bot && !p.net.conn); }
  World.prototype.applyPyroFiregun = function (p, enabled) {
    if (!p || p.classId !== 'pyromaniac') return false;
    p.pyroFiregun = !!enabled;
    var id = enabled ? 'firegun' : 'pyrodualrevolver', old = p.weapons[1];
    if (!old || old.id !== id) p.weapons[1] = { id: id, ammo: W.WEAPONS[id].mag, cooldown: 0, reloadT: 0, reloading: false };
    return true;
  };
  World.prototype.setClass = function (p, id, fresh) {
    var sameLife = p.classId === id && !fresh, keep = sameLife && p.pyroFiregun;
    var result = baseClass.apply(this, arguments);
    p.pyroHeat = 0; p.pyroFiring = false; p.pyroFiregun = false;
    if (!sameLife) { p.pyroFireBar = id === 'pyromaniac' ? P.fireBarMax : 0; p.pyroFireResetAt = 0; p.pyroFireResetT = 0; }
    if (id === 'pyromaniac') this.applyPyroFiregun(p, keep);
    if (fresh) { p.pyroBurn = null; p.pyroBurning = 0; }
    return result;
  };
  World.prototype.upgradePyroFiregun = function (p) {
    if (this.remote || !p || p.classId !== 'pyromaniac' || !p.alive || p.downed || p.dropT > 0 || p.mount || p.vehicle || detached(p) || p.pyroFiregun) return false;
    if (p.tokens < P.firegunCost) { this.emit({ type: 'deny', player: p, reason: 'tokens', value: P.firegunCost }); return false; }
    p.tokens -= P.firegunCost; this.applyPyroFiregun(p, true);
    this.pyroUpgradeFx(p); this.emit({ type: 'pyro-upgrade', player: p, x: p.x, y: p.y });
    return true;
  };
  World.prototype.pyroUpgradeFx = function (p) {
    this.burst(p.x, p.y, 28, '#ff934d', 190, 0.8, 9);
    this.explosions.push({ x: p.x, y: p.y, r: 85, t: 0, dur: .65, ring: true, color: '#ffbc66' });
  };
  World.prototype.useUtility = function (p, intent) {
    if (p.classId === 'pyromaniac') return this.upgradePyroFiregun(p);
    return baseUtility.apply(this, arguments);
  };
  World.prototype.startReload = function (p) {
    var weapon = p && p.weapons[p.slot];
    if (weapon && W.WEAPONS[weapon.id].infiniteAmmo) return false;
    return baseReload.apply(this, arguments);
  };
  World.prototype.pyroFireTime = function (p) {
    if (!p) return 0;
    return Math.max(0, this.remote ? p.pyroFireResetT || 0 : (p.pyroFireResetAt || 0) - this.time);
  };
  World.prototype.resetExpiredPyroFire = function (p) {
    if (!this.remote && p.pyroFireResetAt > 0 && this.time >= p.pyroFireResetAt - EPS) {
      p.pyroFireBar = p.classId === 'pyromaniac' ? P.fireBarMax : 0; p.pyroFireResetAt = 0;
    }
  };
  World.prototype.spendPyroFire = function (p, amount) {
    if (this.remote || !(amount > 0)) return;
    this.resetExpiredPyroFire(p);
    if (!(p.pyroFireResetAt > 0)) p.pyroFireResetAt = this.time + P.fireWindow;
    p.pyroFireBar = Math.max(0, (p.pyroFireBar || 0) - amount);
  };
  World.prototype.updateClassCombat = function (p, intent, dt) {
    baseClassUpdate.apply(this, arguments);
    if (this.remote || p.classId !== 'pyromaniac') return;
    this.resetExpiredPyroFire(p);
    var w = p.weapons[p.slot], switching = intent.swap || intent.cycle || (intent.slot !== undefined && intent.slot !== null && intent.slot !== p.slot) ||
      (intent.held !== undefined && intent.held !== null && intent.held >= 0);
    var firing = !switching && !detached(p) && p.alive && !p.downed && p.dropT <= 0 && !p.mount && !p.vehicle && p.held < 0 &&
      w && w.id === 'pyroflamethrower' && (intent.fire || intent.firePressed);
    p.pyroHeat = firing ? (p.pyroHeat || 0) + dt : 0;
    p.pyroFiring = !!firing;
    if (firing) this.spendPyroFire(p, dt);
  };
  World.prototype.trigger = function (p, intent) {
    var w = p.weapons[p.slot];
    if (w && w.id === 'pyroflamethrower') return this.firePyroFlame(p);
    if (w && w.id === 'firegun') return this.firePyroGun(p);
    return baseTrigger.apply(this, arguments);
  };
  World.prototype.firePyroFlame = function (p) {
    if (this.remote || !p.alive || p.downed || p.dropT > 0 || p.mount || p.vehicle || p.held >= 0 || detached(p)) return false;
    var w = p.weapons[p.slot], def = W.WEAPONS.pyroflamethrower;
    if (!w || w.id !== def.id || w.cooldown > EPS) return false;
    if (p.automaticWeapon !== w.id) w.cooldown = Math.max(0, w.cooldown);
    p.automaticWeapon = w.id;
    var pulses = 0, self = this;
    do {
      var stage = P.flameStage(p.pyroHeat || 0), interval = stage.interval / this.fireRateMul(p);
      p.pyroHitInterval = interval; w.cooldown += interval; p.stats.shots++; pulses++;
      function inFlame(o, radius) {
        return Math.hypot(o.x - p.x, o.y - p.y) - (radius || 0) <= def.range &&
          Math.abs(U.angleDiff(p.angle, Math.atan2(o.y - p.y, o.x - p.x))) <= def.halfAngle && self.lineClear(p.x, p.y, o.x, o.y, o.mount ? self.structById(o.mount) : o);
      }
      this.players.forEach(function (o) {
        if (o !== p && !o.vehicle && o.alive && o.dropT <= 0 && o.team !== p.team && inFlame(o, o.r)) self.damagePlayer(o, stage.damage, p.id, def.id, o.x, o.y - o.r, { x: p.x, y: p.y });
      });
      this.damageVehiclesMatching(function (v) { return inFlame(v, v.r); }, stage.damage, p.id, def.id, { team: p.team });
      this.map.crates.forEach(function (c) { if (c.alive && inFlame(c, c.size / 2)) self.damageCrate(c, stage.damage, p.id, c.x, c.y); });
      this.structures.forEach(function (s) { if (s.alive && s.maxHp && !s.mounted && s.team !== p.team && inFlame(s, s.r)) self.damageStruct(s, stage.damage, p.id, s.x, s.y, def.id); });
      this.flameFx(p.x, p.y, p.angle, def.range);
      this.emit({ type: 'flame', weapon: def.id, player: p, x: p.x, y: p.y, angle: p.angle, range: def.range, halfAngle: def.halfAngle, damage: stage.damage });
    } while (w.cooldown <= EPS && pulses < 8);
    return true;
  };
  World.prototype.firePyroGun = function (p) {
    if (this.remote || !p.alive || p.downed || p.dropT > 0 || p.mount || p.vehicle || p.held >= 0 || detached(p)) return false;
    var w = p.weapons[p.slot], def = W.WEAPONS.firegun;
    if (!w || w.id !== def.id || w.cooldown > EPS) return false;
    this.resetExpiredPyroFire(p);
    if (!(p.pyroFireBar > EPS)) return false;
    w.reloading = false; w.reloadT = 0;
    if (p.automaticWeapon !== w.id) w.cooldown = Math.max(0, w.cooldown);
    p.automaticWeapon = w.id;
    var count = 0;
    do {
      var damage = P.firegunDamage(p.pyroFireBar);
      this.spendPyroFire(p, 7);
      w.cooldown += def.fireInterval / this.fireRateMul(p); p.stats.shots++; count++;
      this.fireGun(p, Object.assign({}, def, { damage: damage }));
      if (!(p.pyroFireBar > EPS)) break;
    } while (w.cooldown <= EPS && count < 8);
    return true;
  };
  World.prototype.shieldBlocks = function (p, x, y, cause) {
    if (cause === 'pyroflamethrower' || cause === 'firegun' || cause === 'pyro-burn') return false;
    return baseShield.apply(this, arguments);
  };
  World.prototype.inPyroSnow = function (target) {
    var r = target.seats ? target.r : 0;
    return this.zones.some(function (z) { return z.kind === 'snow' && z.t > 0 && Math.hypot(target.x - z.x, target.y - z.y) <= z.r + r; });
  };
  World.prototype.extinguishPyro = function (target) {
    if (!target) return;
    target.pyroBurn = null; target.pyroBurning = 0; target.sentryBurn = null;
    if (target.seats) {
      var self = this;
      Object.keys(target.seats).forEach(function (seat) { var occupant = self.playerById(target.seats[seat]); if (occupant) self.extinguishPyro(occupant); });
    }
  };
  World.prototype.applyPyroBurn = function (target, ownerId, kind, damage, interval) {
    if (this.remote || !target || (target.seats ? target.wreck || target.type === 'tank' : !target.alive || target.vehicle)) return;
    if (this.inPyroSnow(target)) { this.extinguishPyro(target); return; }
    var now = this.time, all = target.pyroBurn || (target.pyroBurn = {}), old = all[kind];
    if (kind === 'firegun') {
      all.firegun = { owner: ownerId, dps: W.WEAPONS.firegun.burnDps, until: Math.max(now, old ? old.until : 0) + W.WEAPONS.firegun.burnSeconds,
        last: old && old.until > now ? old.last : now, pending: old && old.until > now ? old.pending : 0, tick: old && old.until > now ? old.tick : 0 };
    } else {
      var continuous = old && now <= old.lastHit + Math.max(old.interval, interval) + 0.051;
      var total = (continuous ? old.damage : 0) + damage, seconds = (continuous ? old.exposure : 0) + interval;
      var start = now + interval;
      all.flame = { owner: ownerId, damage: total, exposure: seconds, lastHit: now, interval: interval,
        dps: total * P.burnDamageFraction, until: start + seconds * P.burnTimeFraction, last: start, pending: 0, tick: 0 };
    }
  };
  World.prototype.damagePlayer = function (p, amount, source, cause) {
    var at = this.events.length, result = basePlayerDamage.apply(this, arguments);
    if (this.remote || (cause !== 'pyroflamethrower' && cause !== 'firegun') || !p.alive || p.vehicle) return result;
    for (var i = at; i < this.events.length; i++) {
      var e = this.events[i];
      if (e.type === 'damage' && e.target === p && e.cause === cause && e.amount > 0) {
        var owner = this.playerById(source);
        this.applyPyroBurn(p, source, cause === 'firegun' ? 'firegun' : 'flame', e.amount, owner && owner.pyroHitInterval || 0.25); break;
      }
    }
    return result;
  };
  World.prototype.damageVehicle = function (v, amount, source, cause) {
    if (v && v.type === 'tank' && cause === 'pyro-burn') return false;
    var before = v && v.hp, result = baseVehicleDamage.apply(this, arguments);
    if (result && v && !v.wreck && (cause === 'pyroflamethrower' || cause === 'firegun')) {
      var owner = this.playerById(source);
      this.applyPyroBurn(v, source, cause === 'firegun' ? 'firegun' : 'flame', before - v.hp, owner && owner.pyroHitInterval || 0.25);
    }
    return result;
  };
  World.prototype.pyroBurnTime = function (target) {
    if (!target) return 0;
    if (this.remote) return target.pyroBurning || 0;
    var b = target.pyroBurn || {};
    return Math.max(0, b.flame ? b.flame.until - this.time : 0, b.firegun ? b.firegun.until - this.time : 0);
  };
  World.prototype.tickPyroBurn = function (target) {
    if (!target.pyroBurn) return;
    if ((target.seats ? target.wreck || target.type === 'tank' : !target.alive) || this.inPyroSnow(target)) { this.extinguishPyro(target); return; }
    var self = this, now = this.time, all = target.pyroBurn;
    ['flame', 'firegun'].forEach(function (key) {
      var b = all[key]; if (!b) return;
      var end = Math.min(now, b.until), elapsed = Math.max(0, end - b.last);
      if (elapsed > 0) { b.pending += elapsed * b.dps; b.tick += elapsed; b.last = end; }
      var ended = now >= b.until - EPS;
      if (b.tick >= .1 - EPS || ended) {
        var amount = ended ? Math.round((b.pending + EPS) * 10) / 10 : Math.floor((b.pending + EPS) * 10) / 10;
        if (amount > 0) {
          b.pending = Math.max(0, b.pending - amount); b.tick = 0;
          if (target.seats) self.damageVehicle(target, amount, b.owner, 'pyro-burn', target.x, target.y - target.r);
          else self.damagePlayer(target, amount, b.owner, 'pyro-burn', target.x, target.y - target.r);
        }
      }
      if (ended) delete all[key];
    });
    if (!all.flame && !all.firegun) target.pyroBurn = null;
  };
  World.prototype.applyPlayerSentrySnow = function (p) {
    if (!this.remote) this.extinguishPyro(p);
    return basePlayerSnow.apply(this, arguments);
  };
  World.prototype.applyVehicleSentrySnow = function (v) {
    if (!this.remote) this.extinguishPyro(v);
    return baseVehicleSnow.apply(this, arguments);
  };
  World.prototype.addZone = function (o) {
    var z = baseZone.apply(this, arguments), self = this;
    if (!this.remote && z && z.kind === 'snow') this.players.concat(this.vehicles || []).forEach(function (p) { if (self.inPyroSnow(p)) self.extinguishPyro(p); });
    return z;
  };
  World.prototype.update = function (dt) {
    baseUpdate.apply(this, arguments);
    if (this.remote) {
      this.players.forEach(function (p) { p.pyroFireResetT = Math.max(0, (p.pyroFireResetT || 0) - dt); });
    } else {
      var self = this;
      this.players.concat(this.vehicles || []).forEach(function (p) {
        self.resetExpiredPyroFire(p);
        if (!p.pyroBurn && !p.sentryBurn) return;
        if (self.inPyroSnow(p)) self.extinguishPyro(p);
        self.tickPyroBurn(p);
      });
    }
  };
}());
