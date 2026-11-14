/* Rocketeer RPG: straight, contact-detonated anti-vehicle rockets. */
(function () {
  'use strict';
  var W = window.Warz, World = W.World, U = W.U, C = W.CONFIG;
  var baseTrigger = World.prototype.trigger, baseUpdate = World.prototype.update;

  World.prototype.spawnRpgRocket = function (o) {
    if (!o) return null;
    var def = W.WEAPONS.rpg;
    if (!this.rpgRockets) this.rpgRockets = [];
    if (!this.nextRpgRocketId) this.nextRpgRocketId = 1;
    var id = o.id || this.nextRpgRocketId++, old = this.rpgRockets.find(function (g) { return g.id === id; });
    if (old) return Object.assign(old, o);
    this.nextRpgRocketId = Math.max(this.nextRpgRocketId, id + 1);
    var g = Object.assign({ id: id, traveled: 0, age: 0, r: def.projectileRadius, speed: def.projectileSpeed, range: def.range }, o);
    this.rpgRockets.push(g); return g;
  };
  World.prototype.removeRpgRocket = function (id) {
    this.rpgRockets = (this.rpgRockets || []).filter(function (g) { return g.id !== id; });
  };
  World.prototype.fireRpg = function (p) {
    if (this.remote || !p.alive || p.downed || p.dropT > 0 || p.mount || p.vehicle || p.held >= 0) return false;
    var weapon = p.weapons[p.slot], def = W.WEAPONS.rpg;
    if (!weapon || weapon.id !== def.id || weapon.reloading || weapon.cooldown > 1e-8) return false;
    if (weapon.ammo <= 0) { this.startReload(p); return false; }
    weapon.ammo--; weapon.cooldown = def.fireInterval / (this.fireRateMul ? this.fireRateMul(p) : 1);
    p.stats.shots++; p.automaticWeapon = def.id;
    var dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    var rocket = this.spawnRpgRocket({ owner: p.id, team: p.team, x: p.x, y: p.y, dx: dx, dy: dy });
    this.emit({ type: 'rpg-shot', player: p, rocket: rocket, x: p.x, y: p.y, angle: p.angle });
    // Sweep from the player through the muzzle so nearby cover cannot be skipped.
    var muzzle = W.muzzleLength(def.id) * p.r;
    if (!this.advanceRpgRocket(rocket, muzzle / rocket.speed)) this.removeRpgRocket(rocket.id);
    p.vx -= dx * (def.recoil || 0); p.vy -= dy * (def.recoil || 0); p.recoil = 1;
    this.flash(p.x + dx * muzzle, p.y + dy * muzzle, p.angle, def.id);
    if (weapon.ammo <= 0 && p.alive) this.startReload(p);
    return true;
  };
  World.prototype.trigger = function (p, intent) {
    var weapon = p.weapons[p.slot];
    if (weapon && weapon.id === 'rpg') return intent.fire || intent.firePressed ? this.fireRpg(p) : false;
    return baseTrigger.call(this, p, intent);
  };

  World.prototype.advanceRpgRocket = function (g, dt) {
    var distance = Math.min(g.speed * dt, Math.max(0, g.range - g.traveled));
    var x = g.x + g.dx * distance, y = g.y + g.dy * distance;
    var hit = this.sweep(g.x, g.y, x, y, g.r, g.owner, g.team);
    g.age += dt;
    if (hit) {
      g.traveled += distance * hit.t; g.x = U.lerp(g.x, x, hit.t); g.y = U.lerp(g.y, y, hit.t);
      if (!this.remote) this.rpgImpact(g, hit, g.x, g.y);
      return false;
    }
    g.x = x; g.y = y; g.traveled += distance;
    return g.traveled < g.range && x >= -100 && y >= -100 && x <= C.worldSize + 100 && y <= C.worldSize + 100;
  };
  World.prototype.updateRpgRockets = function (dt) {
    var self = this;
    this.rpgRockets = (this.rpgRockets || []).filter(function (g) { return self.advanceRpgRocket(g, dt); });
  };
  World.prototype.rpgDamageAt = function (distance, vehicleType, direct) {
    var def = W.WEAPONS.rpg, profile = vehicleType && def.vehicleDamage[vehicleType] || def.explosion;
    if (direct) return profile.maxDamage;
    if (distance > def.explosion.radius) return 0;
    return profile.minDamage + (profile.maxDamage - profile.minDamage) * (1 - U.clamp(distance / def.explosion.radius, 0, 1));
  };
  World.prototype.rpgImpact = function (g, hit, x, y) {
    if (this.remote) return;
    var self = this, def = W.WEAPONS.rpg, radius = def.explosion.radius;
    var solid = hit && hit.solid, directPlayer = hit && hit.player, directVehicle = solid && solid.vehicle;
    if (solid && solid.struct && solid.struct.mounted) directPlayer = this.playerById(solid.struct.mounted);
    // Resolve the complete blast against intact cover before any damage destroys it.
    var players = this.players.filter(function (p) {
      return p.alive && !p.vehicle && p.dropT <= 0 && (p.id === g.owner || p.team !== g.team);
    }).map(function (p) {
      var d = Math.max(0, Math.hypot(p.x - x, p.y - y) - p.r), direct = p === directPlayer;
      return { p: p, damage: direct || (d <= radius && self.lineClear(x, y, p.x, p.y, p.mount ? self.structById(p.mount) : null)) ? self.rpgDamageAt(d, null, direct) : 0 };
    });
    var vehicles = (this.vehicles || []).filter(function (v) {
      return !v.wreck && self.vehicleTeam(v) !== g.team;
    }).map(function (v) {
      var d = Math.max(0, Math.hypot(v.x - x, v.y - y) - v.r), direct = v === directVehicle;
      return { v: v, damage: direct || (d <= radius && self.lineClear(x, y, v.x, v.y, v)) ? self.rpgDamageAt(d, v.type, direct) : 0 };
    });
    var objects = [];
    this.solids.query(x - radius, y - radius, x + radius, y + radius, function (entry) {
      var o = entry.crate || entry.struct;
      if (!o || !o.alive || (entry.struct && (o.kind === 'rock' || o.mounted || o.team === g.team))) return;
      var d = entry.crate ? Math.hypot(x - U.clamp(x, entry.x, entry.x + entry.w), y - U.clamp(y, entry.y, entry.y + entry.h)) : Math.max(0, Math.hypot(x - o.x, y - o.y) - o.r);
      var direct = solid && (solid.crate === o || solid.struct === o);
      if (direct || (d <= radius && self.lineClear(x, y, o.x, o.y, o))) objects.push({ o: o, crate: !!entry.crate, damage: self.rpgDamageAt(d, null, direct) });
    });
    this.damageFoliageInArea(x, y, radius, function (plant) {
      return self.rpgDamageAt(Math.max(0, Math.hypot(plant.x - x, plant.y - y) - plant.hitRadius), null, solid && solid.plant === plant);
    }, g.owner, 'rpg');
    players.forEach(function (entry) { if (entry.damage > 0) self.damagePlayer(entry.p, entry.damage, g.owner, 'rpg', entry.p.x, entry.p.y, { x: x, y: y }); });
    vehicles.forEach(function (entry) { if (entry.damage > 0) self.damageVehicle(entry.v, entry.damage, g.owner, 'rpg', entry.v.x, entry.v.y); });
    objects.forEach(function (entry) {
      if (entry.crate) self.damageCrate(entry.o, entry.damage, g.owner, entry.o.x, entry.o.y);
      else self.damageStruct(entry.o, entry.damage, g.owner, entry.o.x, entry.o.y, 'rpg');
    });
    this.rpgImpactFx(x, y);
    this.emit({ type: 'rpg-impact', id: g.id, x: x, y: y, owner: g.owner });
  };
  World.prototype.rpgImpactFx = function (x, y) {
    var def = W.WEAPONS.rpg;
    this.explosions.push({ x: x, y: y, r: def.explosion.radius, t: 0, dur: .5, power: def.explosion.maxDamage });
    this.burst(x, y, 18, '#ffc066', 260, .5, 7);
    this.smoke(x, y, 10, '#8f8f8f', 22, 1.1, 120);
  };
  World.prototype.update = function (dt) {
    baseUpdate.call(this, dt); this.updateRpgRockets(dt);
  };
}());
