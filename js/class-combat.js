/* Level-two class combat, shared by Practice and the authoritative multiplayer simulation. */
(function () {
  'use strict';
  var W = window.Warz, World = W.World, U = W.U, WEAPONS = W.WEAPONS, CLASSES = W.CLASSES, CREW = W.ARMOR_CREW;
  var baseSetClass = World.prototype.setClass, baseTrigger = World.prototype.trigger, baseUtility = World.prototype.useUtility;
  var baseSpeed = World.prototype.speedMul, baseDamage = World.prototype.damageMul, baseStrikes = World.prototype.updateStrikes;
  var baseAdvanceBullet = World.prototype.advanceBullet, baseSwitch = World.prototype.switchSlot;

  World.prototype.setClass = function (p, id, fresh) {
    var previous = p.classId, origin = p.upgradeFrom, path = (p.upgradePath || []).slice();
    this.stopVehicleRepair(p);
    baseSetClass.call(this, p, id, fresh);
    var parents = W.Rules.classParents(id);
    p.upgradeFrom = CLASSES[id].tier >= 2 ? (previous === id && !fresh && parents.indexOf(origin) >= 0 ? origin : parents.indexOf(previous) >= 0 ? previous : CLASSES[id].parent) : null;
    if (!fresh && previous === id) p.upgradePath = path;
    else if (!fresh && parents.indexOf(previous) >= 0) p.upgradePath = path.concat(previous);
    else {
      p.upgradePath = [];
      var ancestor = CLASSES[id].parent;
      while (ancestor && CLASSES[ancestor]) { p.upgradePath.unshift(ancestor); ancestor = CLASSES[ancestor].parent; }
    }
    this.refreshShield(p);
    p.commandCd = 0;
    p.commandBuff = fresh ? 0 : (p.commandBuff || 0);
    p.minigunSpin = 0; p.flameTicks = 0; p.automaticWeapon = null; p.meleeSwing = 0;
  };
  World.prototype.switchSlot = function (p, slot) {
    if (p.repairVehicle && slot !== p.slot) this.stopVehicleRepair(p);
    if (slot !== p.slot) { p.minigunSpin = 0; p.flameTicks = 0; p.automaticWeapon = null; }
    return baseSwitch.call(this, p, slot);
  };
  World.prototype.updateClassCombat = function (p, intent, dt) {
    this.updateVehicleRepair(p, intent, dt);
    p.commandCd = Math.max(0, (p.commandCd || 0) - dt);
    p.commandBuff = Math.max(0, (p.commandBuff || 0) - dt);
    var w = p.weapons[p.slot], def = WEAPONS[w.id];
    var firing = p.alive && !p.downed && !p.mount && !p.vehicle && p.dropT <= 0 && p.held < 0 && !w.reloading && (intent.fire || intent.firePressed);
    p.minigunSpin = firing && def.windup ? Math.min(def.windup, (p.minigunSpin || 0) + dt) : 0;
    if (!firing || def.kind !== 'flame') p.flameTicks = 0;
    if (!firing) p.automaticWeapon = null;
  };
  World.prototype.speedMul = function (p) {
    return baseSpeed.call(this, p) * (CLASSES[p.classId].speed || 1) * (p.commandBuff > 0 ? 1.25 : 1);
  };
  World.prototype.classDamageMul = function (p) { return p && p.classId === 'armorcrew' ? CREW.damageMul : 1; };
  World.prototype.damageMul = function (p) { return baseDamage.call(this, p) * (p && p.commandBuff > 0 ? 1.25 : 1); };
  World.prototype.fireRateMul = function (p) { return p.commandBuff > 0 ? 1.25 : 1; };
  World.prototype.trigger = function (p, intent) {
    if (p.vehicle) return false;
    var def = WEAPONS[p.weapons[p.slot].id];
    if (def.kind === 'melee') return this.fireHammer(p, def);
    if (def.kind === 'ability') return intent.firePressed ? this.useCommandRadar(p, intent) : false;
    if (def.windup && p.minigunSpin + 0.00000001 < def.windup) return false;
    if (def.kind === 'flame') return this.fireFlame(p, def);
    return baseTrigger.call(this, p, intent);
  };
  World.prototype.useUtility = function (p, intent) {
    if (p.vehicle) return false;
    if (p.classId === 'armorcrew') return this.toggleVehicleRepair(p, intent);
    if (p.classId === 'commander') return this.useCommandRadar(p, intent);
    return baseUtility.call(this, p, intent);
  };

  World.prototype.nearestRepairVehicle = function (p) {
    if (!p || p.classId !== 'armorcrew' || !p.alive || p.downed || p.vehicle || p.mount || p.dropT > 0) return null;
    var nearest = null, best = CREW.repairReach + 0.000001;
    for (var i = 0; i < (this.vehicles || []).length; i++) {
      var v = this.vehicles[i], distance = Math.hypot(p.x - v.x, p.y - v.y) - v.r;
      if (v.wreck || !(v.hp > 0) || v.hp >= v.maxHp || (this.remote && v.hidden) || distance > best || !this.lineClear(p.x, p.y, v.x, v.y, v)) continue;
      nearest = v; best = distance;
    }
    return nearest;
  };
  World.prototype.vehicleRepairRate = function (v) {
    return 100 / (CREW.repairSecondsPer100[v && v.type] || CREW.repairSecondsPer100.humvee);
  };
  World.prototype.flushVehicleRepair = function (p) {
    var v = p.repairVehicle && this.vehicleById(p.repairVehicle);
    if (!this.remote && v && p.repairAmount > 0) this.emit({ type: 'vehicle', op: 'repair', vehicle: v, player: p, source: p, amount: p.repairAmount });
    p.repairAmount = 0; p.repairSyncT = 0;
  };
  World.prototype.stopVehicleRepair = function (p) {
    if (!p || !p.repairVehicle) return false;
    var v = this.vehicleById(p.repairVehicle);
    this.flushVehicleRepair(p); p.repairVehicle = 0;
    if (!this.remote) this.emit({ type: 'repair', player: p, vehicle: v, active: false });
    return true;
  };
  World.prototype.toggleVehicleRepair = function (p, intent) {
    if (this.remote || !p || p.classId !== 'armorcrew' || !p.alive || p.downed || p.vehicle || p.mount || p.dropT > 0) return false;
    if (p.repairVehicle) return this.stopVehicleRepair(p);
    intent = intent || {};
    if (intent.mx || intent.my || intent.fire || intent.firePressed) return false;
    var v = this.nearestRepairVehicle(p);
    if (!v) { this.emit({ type: 'deny', player: p, reason: 'repairtarget' }); return false; }
    var hammer = p.weapons.findIndex(function (w) { return w.id === 'hammer'; });
    if (hammer < 0) return false;
    this.switchSlot(p, hammer);
    p.repairVehicle = v.id; p.repairX = p.x; p.repairY = p.y; p.repairAmount = 0; p.repairSyncT = 0;
    this.emit({ type: 'repair', player: p, vehicle: v, active: true });
    return true;
  };
  World.prototype.updateVehicleRepair = function (p, intent, dt) {
    if (this.remote || !p.repairVehicle) return;
    var v = this.vehicleById(p.repairVehicle);
    if (p.classId !== 'armorcrew' || !p.alive || p.downed || p.vehicle || p.mount || p.dropT > 0 || p.held >= 0 || p.weapons[p.slot].id !== 'hammer' || intent.mx || intent.my || intent.fire || intent.firePressed ||
        Math.hypot(p.x - p.repairX, p.y - p.repairY) > 0.5 || !v || v.wreck || !(v.hp > 0) || v.hp >= v.maxHp ||
        Math.hypot(p.x - v.x, p.y - v.y) - v.r > CREW.repairReach || !this.lineClear(p.x, p.y, v.x, v.y, v)) { this.stopVehicleRepair(p); return; }
    if (intent.utility || intent.interactPressed) return; // a toggle or seat interaction resolves later in this tick
    p.angle = Math.atan2(v.y - p.y, v.x - p.x);
    var amount = Math.min(v.maxHp - v.hp, this.vehicleRepairRate(v) * dt);
    v.hp += amount; p.repairAmount += amount; p.repairSyncT += dt;
    if (p.repairSyncT >= 0.2 - 0.000001) this.flushVehicleRepair(p);
    if (v.hp >= v.maxHp - 0.000001) { v.hp = v.maxHp; this.stopVehicleRepair(p); }
  };
  World.prototype.fireHammer = function (p, def) {
    var w = p.weapons[p.slot];
    if (this.remote || !p.alive || p.downed || p.mount || p.vehicle || p.dropT > 0 || w.reloading || w.cooldown > 0.00000001) return false;
    this.stopVehicleRepair(p);
    w.cooldown = def.fireInterval / this.fireRateMul(p); p.stats.shots++;
    p.meleeSwing = 0.24; p.meleeAngle = p.angle; p.recoil = 1;
    var self = this, best = null, distance = Infinity;
    function consider(kind, target, radius, ignore) {
      var dx = target.x - p.x, dy = target.y - p.y, d = Math.max(0, Math.hypot(dx, dy) - radius);
      if (d > def.range || d >= distance || Math.abs(U.angleDiff(p.angle, Math.atan2(dy, dx))) > def.halfAngle || !self.lineClear(p.x, p.y, target.x, target.y, ignore || target)) return;
      best = { kind: kind, target: target }; distance = d;
    }
    this.players.forEach(function (o) { if (o !== p && o.alive && !o.vehicle && o.dropT <= 0 && o.team !== p.team) consider('player', o, o.r, o.mount ? self.structById(o.mount) : null); });
    (this.vehicles || []).forEach(function (v) { if (!v.wreck && self.vehicleTeam(v) !== p.team) consider('vehicle', v, v.r); });
    this.map.crates.forEach(function (c) { if (c.alive) consider('crate', c, c.size / 2); });
    this.foliage.query(p.x - def.range, p.y - def.range, p.x + def.range, p.y + def.range, function (plant) {
      if (plant.alive !== false) consider('foliage', plant, plant.hitRadius);
    });
    this.structures.forEach(function (s) { if (s.alive && s.kind !== 'teleporter' && (s.kind === 'rock' || s.team !== p.team)) consider('struct', s, s.r); });
    if (best) {
      var target = best.target;
      if (best.kind === 'player') this.damagePlayer(target, def.damage, p.id, def.id, target.x, target.y - target.r, { x: p.x, y: p.y });
      else if (best.kind === 'vehicle') this.damageVehicle(target, def.damage, p.id, def.id, target.x, target.y - target.r);
      else if (best.kind === 'crate') this.damageCrate(target, def.damage, p.id, target.x, target.y - target.size / 2);
      else if (best.kind === 'foliage') this.damageFoliage(target, def.damage, p.id, def.id);
      else this.damageStruct(target, def.damage, p.id, target.x, target.y - target.r, def.id);
    }
    this.emit({ type: 'melee', player: p, weapon: def.id, x: p.x, y: p.y, a: p.angle, reach: def.range });
    return true;
  };

  // A finite serialized range spans the complete island. Discard misses after they leave its bounds.
  World.prototype.advanceBullet = function (b, step) {
    var alive = baseAdvanceBullet.call(this, b, step), def = WEAPONS[b.weapon];
    if (def && def.unlimitedRange && (b.x < -100 || b.y < -100 || b.x > W.CONFIG.worldSize + 100 || b.y > W.CONFIG.worldSize + 100)) return false;
    return alive;
  };

  World.prototype.flameFx = function (x, y, angle, range) {
    for (var i = 0; i < 9; i++) {
      var a = angle + (this.rng.next() - 0.5) * WEAPONS.flamethrower.halfAngle * 2;
      var speed = range * (1.3 + this.rng.next() * 0.8), life = 0.32 + this.rng.next() * 0.12;
      this.particles.push({ kind: 'dot', x: x + Math.cos(a) * 30, y: y + Math.sin(a) * 30,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: life, max: life, size: 10 + this.rng.next() * 7,
        color: i % 3 === 0 ? '#fff59a' : i % 3 === 1 ? '#ffb52d' : '#ff6034', drag: 1 });
    }
  };
  World.prototype.fireFlame = function (p, def) {
    var w = p.weapons[p.slot];
    if (this.remote || w.reloading || w.cooldown > 0.00000001) return false;
    if (w.ammo <= 0) { this.startReload(p); return false; }
    if (p.automaticWeapon !== w.id) w.cooldown = Math.max(0, w.cooldown);
    p.automaticWeapon = w.id;
    var pulses = 0, self = this;
    do {
      var damage = Math.min(def.damageMax, def.damage + (p.flameTicks || 0) * def.damageStep);
      p.flameTicks = Math.min(8, (p.flameTicks || 0) + 1);
      w.ammo--; w.cooldown += def.fireInterval / this.fireRateMul(p); p.stats.shots++; pulses++;
      function inFlame(o, radius) {
        return Math.hypot(o.x - p.x, o.y - p.y) - (radius || 0) <= def.range &&
          Math.abs(U.angleDiff(p.angle, Math.atan2(o.y - p.y, o.x - p.x))) <= def.halfAngle && self.lineClear(p.x, p.y, o.x, o.y, o);
      }
      this.players.forEach(function (o) {
        if (o !== p && !o.vehicle && o.alive && o.dropT <= 0 && o.team !== p.team && inFlame(o, o.r)) self.damagePlayer(o, damage, p.id, 'flamethrower', o.x, o.y - o.r, { x: p.x, y: p.y });
      });
      if (this.damageVehiclesMatching) this.damageVehiclesMatching(function (v) { return inFlame(v, v.r); }, damage, p.id, 'flamethrower', { team: p.team });
      this.map.crates.forEach(function (c) { if (c.alive && inFlame(c, c.size / 2)) self.damageCrate(c, damage, p.id, c.x, c.y); });
      this.foliage.query(p.x - def.range, p.y - def.range, p.x + def.range, p.y + def.range, function (plant) {
        if (plant.alive !== false && inFlame(plant, plant.hitRadius)) self.damageFoliage(plant, damage, p.id, 'flamethrower');
      });
      this.structures.forEach(function (s) { if (s.alive && s.maxHp && s.team !== p.team && inFlame(s, s.r)) self.damageStruct(s, damage, p.id, s.x, s.y); });
      this.flameFx(p.x, p.y, p.angle, def.range);
      this.emit({ type: 'flame', player: p, x: p.x, y: p.y, angle: p.angle, range: def.range, halfAngle: def.halfAngle, damage: damage });
      if (w.ammo <= 0) { this.startReload(p); break; }
    } while (w.cooldown <= 0.00000001 && pulses < 8);
    return true;
  };

  World.prototype.useCommandRadar = function (p, intent) {
    if (this.remote || p.classId !== 'commander' || !p.alive || p.downed || p.mount || p.vehicle || p.dropT > 0) return false;
    var def = WEAPONS.commandradar;
    if (p.commandCd > 0) { this.emit({ type: 'deny', player: p, reason: 'command', value: p.commandCd }); return false; }
    var ax = intent && intent.aimX, ay = intent && intent.aimY;
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) { this.emit({ type: 'deny', player: p, reason: 'notarget' }); return false; }
    p.commandCd = def.cooldown;
    p.fx.radar = Math.max(p.fx.radar || 0, def.radarDuration);
    this.players.forEach(function (o) { if (o.alive && o.team === p.team) o.commandBuff = Math.max(o.commandBuff || 0, def.duration); });
    this.emit({ type: 'command', player: p, team: p.team, duration: def.duration, radarDuration: def.radarDuration, cooldown: def.cooldown });
    this.addStrike({ kind: 'airstrike', x: U.clamp(ax, 0, W.CONFIG.worldSize), y: U.clamp(ay, 0, W.CONFIG.worldSize),
      target: 0, t: def.strikeDelay, radius: def.strikeRadius, damage: def.strikeDamage, owner: p.id, team: p.team });
    return true;
  };
  World.prototype.updateStrikes = function (dt) {
    // Keep existing lightning/meteor behavior and replication; airstrikes deliberately hit all teams.
    var air = this.strikes.filter(function (s) { return s.kind === 'airstrike'; });
    this.strikes = this.strikes.filter(function (s) { return s.kind !== 'airstrike'; });
    baseStrikes.call(this, dt);
    for (var i = 0; i < air.length; i++) {
      var st = air[i]; st.t -= dt;
      if (st.t > 0 || this.remote) { if (st.t > -1.5) this.strikes.push(st); continue; }
      this.strikeFx(st);
      for (var j = 0; j < this.players.length; j++) {
        var p = this.players[j];
        if (p.alive && !p.vehicle && p.dropT <= 0 && Math.hypot(p.x - st.x, p.y - st.y) - p.r < st.radius) this.damagePlayer(p, st.damage, st.owner, 'airstrike', p.x, p.y - p.r);
      }
      if (this.damageVehiclesInArea) this.damageVehiclesInArea(st.x, st.y, st.radius, st.damage, st.owner, 'airstrike', { friendly: true });
      this.emit({ type: 'strike-hit', strike: st });
    }
  };
}());
