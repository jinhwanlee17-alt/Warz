/* Level-two class combat, shared by Practice and the authoritative multiplayer simulation. */
(function () {
  'use strict';
  var W = window.Warz, World = W.World, U = W.U, WEAPONS = W.WEAPONS, CLASSES = W.CLASSES;
  var baseSetClass = World.prototype.setClass, baseTrigger = World.prototype.trigger, baseUtility = World.prototype.useUtility;
  var baseSpeed = World.prototype.speedMul, baseDamage = World.prototype.damageMul, baseStrikes = World.prototype.updateStrikes;
  var baseAdvanceBullet = World.prototype.advanceBullet, baseSwitch = World.prototype.switchSlot;

  World.prototype.setClass = function (p, id, fresh) {
    var previous = p.classId, origin = p.upgradeFrom;
    baseSetClass.call(this, p, id, fresh);
    var parents = W.Rules.classParents(id);
    p.upgradeFrom = CLASSES[id].tier === 2 ? (previous === id && !fresh && parents.indexOf(origin) >= 0 ? origin : parents.indexOf(previous) >= 0 ? previous : CLASSES[id].parent) : null;
    p.commandCd = 0;
    p.commandBuff = fresh ? 0 : (p.commandBuff || 0);
    p.minigunSpin = 0; p.flameTicks = 0; p.automaticWeapon = null;
  };
  World.prototype.switchSlot = function (p, slot) {
    if (slot !== p.slot) { p.minigunSpin = 0; p.flameTicks = 0; p.automaticWeapon = null; }
    return baseSwitch.call(this, p, slot);
  };
  World.prototype.updateClassCombat = function (p, intent, dt) {
    p.commandCd = Math.max(0, (p.commandCd || 0) - dt);
    p.commandBuff = Math.max(0, (p.commandBuff || 0) - dt);
    var w = p.weapons[p.slot], def = WEAPONS[w.id];
    var firing = p.alive && !p.downed && !p.mount && p.dropT <= 0 && p.held < 0 && !w.reloading && (intent.fire || intent.firePressed);
    p.minigunSpin = firing && def.windup ? Math.min(def.windup, (p.minigunSpin || 0) + dt) : 0;
    if (!firing || def.kind !== 'flame') p.flameTicks = 0;
    if (!firing) p.automaticWeapon = null;
  };
  World.prototype.speedMul = function (p) {
    return baseSpeed.call(this, p) * (CLASSES[p.classId].speed || 1) * (p.commandBuff > 0 ? 1.25 : 1);
  };
  World.prototype.damageMul = function (p) { return baseDamage.call(this, p) * (p && p.commandBuff > 0 ? 1.25 : 1); };
  World.prototype.fireRateMul = function (p) { return p.commandBuff > 0 ? 1.25 : 1; };
  World.prototype.trigger = function (p, intent) {
    var def = WEAPONS[p.weapons[p.slot].id];
    if (def.kind === 'ability') return intent.firePressed ? this.useCommandRadar(p, intent) : false;
    if (def.windup && p.minigunSpin + 0.00000001 < def.windup) return false;
    if (def.kind === 'flame') return this.fireFlame(p, def);
    return baseTrigger.call(this, p, intent);
  };
  World.prototype.useUtility = function (p, intent) {
    if (p.classId === 'commander') return this.useCommandRadar(p, intent);
    return baseUtility.call(this, p, intent);
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
          Math.abs(U.angleDiff(p.angle, Math.atan2(o.y - p.y, o.x - p.x))) <= def.halfAngle && self.lineClear(p.x, p.y, o.x, o.y);
      }
      this.players.forEach(function (o) {
        if (o !== p && o.alive && o.dropT <= 0 && o.team !== p.team && inFlame(o, o.r)) self.damagePlayer(o, damage, p.id, 'flamethrower', o.x, o.y - o.r, { x: p.x, y: p.y });
      });
      this.map.crates.forEach(function (c) { if (c.alive && inFlame(c, c.size / 2)) self.damageCrate(c, damage, p.id, c.x, c.y); });
      this.structures.forEach(function (s) { if (s.alive && s.maxHp && s.team !== p.team && inFlame(s, s.r)) self.damageStruct(s, damage, p.id, s.x, s.y); });
      this.flameFx(p.x, p.y, p.angle, def.range);
      this.emit({ type: 'flame', player: p, x: p.x, y: p.y, angle: p.angle, range: def.range, halfAngle: def.halfAngle, damage: damage });
      if (w.ammo <= 0) { this.startReload(p); break; }
    } while (w.cooldown <= 0.00000001 && pulses < 8);
    return true;
  };

  World.prototype.useCommandRadar = function (p, intent) {
    if (this.remote || p.classId !== 'commander' || !p.alive || p.downed || p.mount || p.dropT > 0) return false;
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
        if (p.alive && p.dropT <= 0 && Math.hypot(p.x - st.x, p.y - st.y) - p.r < st.radius) this.damagePlayer(p, st.damage, st.owner, 'airstrike', p.x, p.y - p.r);
      }
      this.emit({ type: 'strike-hit', strike: st });
    }
  };
}());
