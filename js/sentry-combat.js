/* Engineer Sentry IV weapons and status effects. Shared by Practice and the server. */
(function () {
  'use strict';
  var W = window.Warz, World = W.World, U = W.U, C = W.CONFIG, ITEMS = W.ITEMS;
  var IV = W.SENTRY_IV = {
    bullets: { name: 'Bullet Sentry IV', hp: 250, damage: 50, fireInterval: ITEMS.sentry3.fireInterval / 1.25, range: 720, speed: W.WEAPONS.ar.bulletSpeed, radius: 5.5, color: '#ffe29a', blurb: '50 damage per bullet; 25% faster fire rate than Sentry III.' },
    grenades: { name: 'Grenade Sentry IV', hp: 310, damage: 100, fireInterval: 1 / 8, range: 720, speed: 950, radius: 9, blastRadius: W.WEAPONS.grenade.explosion.radius, color: '#a5d675', blurb: 'Eight arcing grenades per second. Explode on contact or landing for normal grenade damage.' },
    rockets: { name: 'Rocket Sentry IV', hp: 150, damage: 25, minDamage: 0, vehicleBlast: { humvee: { minDamage: 10, maxDamage: 80 }, tank: { minDamage: 10, maxDamage: 100 } }, fireInterval: 1 / 15, range: C.worldSize * 2, unlimitedRange: true, speed: 1100, radius: 6, blastRadius: W.WEAPONS.grenade.explosion.radius / 2, color: '#ffb784', blurb: 'Fifteen rockets per second with unlimited island range. 0–25 damage to players, 10–80 to Humvees, 10–100 to tanks, bypassing tank resistance; half a grenade blast radius.' },
    snowballs: { name: 'Snowball Sentry IV', hp: 100, damage: 10, fireInterval: 1 / 50, range: 720, speed: W.WEAPONS.pistol.bulletSpeed, radius: 5.5, color: '#b7f4ff', blurb: 'Fifty snowballs per second. Each slows movement 5% for 3 seconds; twenty active hits freeze for 5 seconds.' },
    fireballs: { name: 'Fireball Sentry IV', hp: 300, damage: 20, fireInterval: 1 / 50, range: 720, speed: W.WEAPONS.pistol.bulletSpeed, radius: 6, color: '#ff884f', blurb: 'Fifty fireballs per second. 20 impact damage and a 3-second burn ticking 1 damage every 0.1 seconds.' },
    cannons: { name: 'Cannon Sentry IV', hp: 760, damage: 500, vehicleDamage: 510, fireInterval: 5, range: 980, speed: W.WEAPONS.ar.bulletSpeed, radius: 4.5, visualRadius: 50, visualScale: 2, color: '#d5d9e6', blurb: 'One massive, fast cannonball every 5 seconds. 500 damage through shields, 510 to vehicles; breaks a rock and stops.' }
  };
  Object.keys(IV).forEach(function (key) {
    var d = IV[key]; d.id = key; d.item = 'sentry4' + key;
    // Upgrade-only: these do not enter ITEM_ORDER or alter crate rarity/drop tables.
    ITEMS[d.item] = { id: d.item, name: d.name, tier: 'legendary', kind: 'place', struct: 'sentry',
      level: 4, sentryVariant: key, hp: d.hp, damage: d.damage, fireInterval: d.fireInterval,
      range: d.range, reach: 150, stack: 1, found: 1, blurb: d.blurb };
  });

  var baseSentry = World.prototype.updateSentry, baseUpdate = World.prototype.update;
  var baseClassUpdate = World.prototype.updateClassCombat, baseSpeed = World.prototype.speedMul, baseMove = World.prototype.moveStep;
  var baseSetClass = World.prototype.setClass;

  World.prototype.activeSentrySnow = function (p) {
    var now = this.time;
    return (p.sentrySnow || []).filter(function (until) { return until > now + 1e-8; }).length;
  };
  World.prototype.applyPlayerSentrySnow = function (p) {
    if (this.remote || !p || !p.alive || p.vehicle || p.sentryFreezeUntil > this.time) return;
    var now = this.time;
    p.sentrySnow = (p.sentrySnow || []).filter(function (until) { return until > now + 1e-8; });
    p.sentrySnow.push(now + 3);
    if (p.sentrySnow.length >= 20) { p.sentrySnow = []; p.sentryFreezeUntil = now + 5; p.vx = p.vy = 0; }
  };
  World.prototype.applyPlayerSentryBurn = function (p, ownerId) {
    if (this.remote || !p || !p.alive || p.vehicle) return;
    var old = p.sentryBurn;
    p.sentryBurn = { until: this.time + 3, next: old && old.until > this.time ? old.next : this.time + 0.1, owner: ownerId };
  };
  World.prototype.updatePlayerSentryEffects = function (p) {
    var now = this.time;
    p.sentrySnow = (p.sentrySnow || []).filter(function (until) { return until > now + 1e-8; });
    if (!(p.sentryFreezeUntil > now)) p.sentryFreezeUntil = 0;
    if (this.remote || !p.sentryBurn) return;
    var burn = p.sentryBurn;
    while (p.alive && burn.next <= now + 1e-8 && burn.next <= burn.until + 1e-8) {
      this.damagePlayer(p, 1, burn.owner, 'sentry-burn', p.x, p.y - p.r);
      burn.next += 0.1;
    }
    if (!p.alive || burn.until < now + 1e-8) p.sentryBurn = null;
  };
  World.prototype.updateClassCombat = function (p, intent, dt) {
    this.updatePlayerSentryEffects(p);
    baseClassUpdate.call(this, p, intent, dt);
  };
  World.prototype.speedMul = function (p) {
    return baseSpeed.call(this, p) * (p.sentryFreezeUntil > this.time ? 0 : Math.max(0, 1 - this.activeSentrySnow(p) * 0.05));
  };
  World.prototype.moveStep = function (p, intent, dt) {
    if (p.sentryFreezeUntil > this.time && p.alive && !p.vehicle && !p.mount) {
      p.vx = p.vy = 0; this.tickStamina(p, {}, dt); return;
    }
    return baseMove.call(this, p, intent, dt);
  };
  World.prototype.setClass = function (p, id, fresh) {
    if (fresh) { p.sentrySnow = []; p.sentryFreezeUntil = 0; p.sentryBurn = null; }
    return baseSetClass.call(this, p, id, fresh);
  };

  World.prototype.sentryVariant = function (s) { var it = s && ITEMS[s.item]; return it && IV[it.sentryVariant] || null; };
  World.prototype.sentryIVLineClear = function (s, target, type, variant) {
    if (variant === 'grenades') return true; // A lob can clear cover; its height still controls physical contact.
    // A mounted turret is the target's seat, not cover hiding its rider.
    var mount = type === 'player' && target.mount && this.structById(target.mount);
    if (mount) {
      var distance = Math.hypot(target.x - s.x, target.y - s.y) || 1;
      var sx = s.x + (target.x - s.x) / distance * (s.r + 2), sy = s.y + (target.y - s.y) / distance * (s.r + 2);
      if (!this.lineClear(sx, sy, target.x, target.y, mount, variant === 'cannons')) return false;
      for (var ci = 0; ci < this.map.crates.length; ci++) {
        var crate = this.map.crates[ci];
        if (crate.alive && U.segRect(sx, sy, target.x, target.y, crate.x - crate.size / 2, crate.y - crate.size / 2, crate.size, crate.size) >= 0) return false;
      }
      return true;
    }
    if (variant !== 'cannons') return this.sentryLineClear(s, target.x, target.y, type === 'crate' ? target : null, type === 'vehicle' ? target.id : null);
    if (!this.lineClear(s.x, s.y, target.x, target.y, s, true, type === 'vehicle' ? target : null)) return false;
    for (var i = 0; i < this.map.crates.length; i++) {
      var c = this.map.crates[i];
      if (c.alive && c !== target && U.segRect(s.x, s.y, target.x, target.y, c.x - c.size / 2, c.y - c.size / 2, c.size, c.size) >= 0) return false;
    }
    return true;
  };
  World.prototype.sentryIVTarget = function (s, def) {
    var best = null, distance = def.range, i;
    for (i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.alive || p.vehicle || p.dropT > 0 || p.fx.invisible > 0 || p.team === s.team) continue;
      var d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < distance && this.sentryIVLineClear(s, p, 'player', def.id)) { distance = d; best = { target: p, type: 'player' }; }
    }
    for (i = 0; i < (this.vehicles || []).length; i++) {
      var v = this.vehicles[i], team = this.vehicleTeam(v);
      if (v.wreck || !(v.hp > 0) || team === null || team === s.team) continue;
      var vd = Math.max(0, Math.hypot(v.x - s.x, v.y - s.y) - v.r);
      if (vd < distance && this.sentryIVLineClear(s, v, 'vehicle', def.id)) { distance = vd; best = { target: v, type: 'vehicle' }; }
    }
    if (!best) for (i = 0; i < this.map.crates.length; i++) {
      var c = this.map.crates[i], cd = Math.hypot(c.x - s.x, c.y - s.y);
      if (c.alive && cd < distance && this.sentryIVLineClear(s, c, 'crate', def.id)) { distance = cd; best = { target: c, type: 'crate' }; }
    }
    return best;
  };
  World.prototype.updateSentry = function (s, dt) {
    var def = this.sentryVariant(s);
    if (!def) return baseSentry.call(this, s, dt);
    if (this.remote || !s.alive) return;
    var chosen = this.sentryIVTarget(s, def);
    if (!chosen) { s.cooldown = Math.max(0, s.cooldown - dt); s.target = 0; s.targetKind = null; return; }
    var target = chosen.target;
    s.target = target.id; s.targetKind = chosen.type; s.angle = Math.atan2(target.y - s.y, target.x - s.x);
    s.cooldown -= dt;
    var batch = [], count = 0;
    while (s.cooldown <= 1e-8 && count++ < 16) {
      var shot = { kind: def.id, owner: s.owner, team: s.team, sentry: s.id, x: s.x, y: s.y,
        dx: Math.cos(s.angle), dy: Math.sin(s.angle), r: def.radius, speed: def.speed, range: def.range,
        firstStep: Math.min(dt, Math.max(0, -s.cooldown)) };
      if (def.id === 'grenades') {
        var travel = Math.hypot(target.x - s.x, target.y - s.y);
        Object.assign(shot, { startX: s.x, startY: s.y, targetX: target.x, targetY: target.y,
          flightTime: Math.max(0.2, travel / def.speed), peakHeight: 70 + travel * 0.16, flightElapsed: 0, z: 0 });
      }
      var g = this.spawnSentryProjectile(shot); batch.push(Object.assign({}, g));
      s.cooldown += def.fireInterval;
    }
    if (batch.length) {
      s.flash = 1; this.flash(s.x + Math.cos(s.angle) * s.r, s.y + Math.sin(s.angle) * s.r, s.angle, 'sentry');
      this.emit({ type: 'sentry-projectiles', struct: s, projectiles: batch, x: s.x, y: s.y });
    }
  };
  World.prototype.spawnSentryProjectile = function (o) {
    if (!o || !IV[o.kind]) return null;
    if (!this.sentryProjectiles) this.sentryProjectiles = [];
    if (!this.nextSentryProjectileId) this.nextSentryProjectileId = 1;
    var id = o.id || this.nextSentryProjectileId++, old = this.sentryProjectiles.find(function (g) { return g.id === id; });
    if (old) return Object.assign(old, o);
    this.nextSentryProjectileId = Math.max(this.nextSentryProjectileId, id + 1);
    var def = IV[o.kind], g = Object.assign({ id: id, traveled: 0, age: 0, z: 0, flightElapsed: 0,
      r: def.radius, speed: def.speed, range: def.range }, o);
    this.sentryProjectiles.push(g); return g;
  };
  World.prototype.removeSentryProjectile = function (id) {
    this.sentryProjectiles = (this.sentryProjectiles || []).filter(function (g) { return g.id !== id; });
  };

  // Grenades collide only when their arc reaches the object, rather than hitting
  // the 2D footprint of a rock that they are flying above.
  World.prototype.sentryGrenadeSweep = function (g, x2, y2, z2) {
    var self = this, best = null, bestT = 2, z1 = g.z || 0;
    function consider(t, height, solid, player) {
      if (t < 0 || t >= bestT || U.lerp(z1, z2, t) - g.r > height) return;
      bestT = t; best = { t: t, solid: solid || null, player: player || null };
    }
    this.solids.query(Math.min(g.x, x2) - g.r, Math.min(g.y, y2) - g.r, Math.max(g.x, x2) + g.r, Math.max(g.y, y2) + g.r, function (s) {
      if ((s.crate && !s.crate.alive) || (s.rock && !s.rock.alive) || (s.struct && (!s.struct.alive || (s.struct.team === g.team && s.struct.kind !== 'rock')))) return;
      var t = s.shape === 'circle' ? U.segCircle(g.x, g.y, x2, y2, s.x, s.y, s.r + g.r) : U.segRect(g.x, g.y, x2, y2, s.x - g.r, s.y - g.r, s.w + g.r * 2, s.h + g.r * 2);
      consider(t, s.type === 'wall' ? 70 : s.type === 'rock' || (s.struct && s.struct.kind === 'rock') ? 48 : 38, s);
    });
    this.players.forEach(function (p) {
      if (!p.alive || p.vehicle || p.dropT > 0 || p.team === g.team || p.id === g.owner || (self.remote && p.hidden)) return;
      consider(U.segCircle(g.x, g.y, x2, y2, p.x, p.y, p.r + g.r), p.r, null, p);
    });
    (this.vehicles || []).forEach(function (v) {
      if ((self.remote && v.hidden) || (!v.wreck && self.vehicleTeam(v) === g.team)) return;
      consider(U.segCircle(g.x, g.y, x2, y2, v.x, v.y, v.r + g.r), v.type === 'tank' ? 48 : 40,
        { type: 'vehicle', vehicle: v, x: v.x, y: v.y, r: v.r });
    });
    return best;
  };
  World.prototype.advanceSentryProjectile = function (g, dt) {
    var x2, y2, z2 = 0, done = false, hit;
    g.age += dt;
    if (g.kind === 'grenades') {
      g.flightElapsed = Math.min(g.flightTime, g.flightElapsed + dt);
      var point = this.trajectoryPoint(g, g.flightElapsed / g.flightTime);
      x2 = point.x; y2 = point.y; z2 = point.z; done = g.flightElapsed >= g.flightTime;
      hit = this.sentryGrenadeSweep(g, x2, y2, z2);
    } else {
      var distance = Math.min(g.speed * dt, Math.max(0, g.range - g.traveled));
      x2 = g.x + g.dx * distance; y2 = g.y + g.dy * distance;
      hit = this.sweep(g.x, g.y, x2, y2, g.r, g.owner, g.team);
      g.traveled += distance; done = g.traveled >= g.range;
      if (x2 < -100 || y2 < -100 || x2 > C.worldSize + 100 || y2 > C.worldSize + 100) done = true;
    }
    if (hit) {
      var hx = U.lerp(g.x, x2, hit.t), hy = U.lerp(g.y, y2, hit.t);
      if (!this.remote) this.sentryProjectileImpact(g, hit, hx, hy);
      return false;
    }
    g.x = x2; g.y = y2; g.z = z2;
    if (done) {
      if (!this.remote && g.kind === 'grenades') this.sentryProjectileImpact(g, null, x2, y2);
      return false;
    }
    return true;
  };
  World.prototype.updateSentryProjectiles = function (dt) {
    var out = [], list = this.sentryProjectiles || [];
    for (var i = 0; i < list.length; i++) {
      var g = list[i], step = g.firstStep === undefined ? dt : g.firstStep;
      delete g.firstStep;
      // Substeps prevent high arcs from changing height too far across a small obstacle.
      var remaining = step, alive = true;
      do { var part = Math.min(remaining, g.kind === 'grenades' ? 0.025 : remaining); alive = this.advanceSentryProjectile(g, part); remaining -= part; } while (alive && remaining > 1e-8);
      if (alive) out.push(g);
    }
    this.sentryProjectiles = out;
  };
  World.prototype.sentryImpactFx = function (kind, x, y) {
    var def = IV[kind]; if (!def) return;
    var blast = kind === 'grenades' || kind === 'rockets';
    if (blast) this.explosions.push({ x: x, y: y, r: def.blastRadius, t: 0, dur: 0.4, power: def.damage });
    else if (kind === 'cannons') this.explosions.push({ x: x, y: y, r: Math.max(34, def.visualRadius * 1.4), t: 0, dur: 0.25, ring: true, color: '#fff0c4' });
    this.sparks(x, y, 0, -1, def.color, blast ? 5 : 2);
  };
  World.prototype.sentryBlast = function (g, hit, x, y) {
    var self = this, def = IV[g.kind], radius = def.blastRadius, directPlayer = hit && hit.player;
    var solid = hit && hit.solid, directVehicle = solid && solid.vehicle;
    if (solid && solid.struct && solid.struct.mounted) directPlayer = this.playerById(solid.struct.mounted);
    function damage(d, direct, vehicle) {
      var profile = vehicle && def.vehicleBlast && def.vehicleBlast[vehicle.type];
      var maxDamage = profile ? profile.maxDamage : def.damage, minDamage = profile ? profile.minDamage : def.minDamage;
      if (direct) return maxDamage;
      if (g.kind === 'grenades') return W.Rules.explosionDamage(def.damage, radius, d);
      return minDamage + (maxDamage - minDamage) * (1 - U.clamp(d / radius, 0, 1));
    }
    var players = this.players.filter(function (p) { return p.alive && !p.vehicle && p.dropT <= 0 && p.team !== g.team; }).map(function (p) {
      var d = Math.max(0, Math.hypot(p.x - x, p.y - y) - p.r), direct = p === directPlayer;
      return { p: p, damage: direct || (d < radius && self.lineClear(x, y, p.x, p.y, p.mount ? self.structById(p.mount) : null)) ? damage(d, direct) : 0 };
    });
    var vehicles = (this.vehicles || []).filter(function (v) { return !v.wreck && self.vehicleTeam(v) !== g.team; }).map(function (v) {
      var d = Math.max(0, Math.hypot(v.x - x, v.y - y) - v.r), direct = v === directVehicle;
      return { v: v, damage: direct || (d < radius && self.lineClear(x, y, v.x, v.y, v)) ? damage(d, direct, v) : 0 };
    });
    var objects = [];
    this.solids.query(x - radius, y - radius, x + radius, y + radius, function (s) {
      var o = s.crate || s.struct;
      if (!o || !o.alive || (s.struct && (s.struct.kind === 'rock' || s.struct.mounted || s.struct.team === g.team))) return;
      var d = s.crate ? Math.hypot(x - U.clamp(x, s.x, s.x + s.w), y - U.clamp(y, s.y, s.y + s.h)) : Math.max(0, Math.hypot(x - o.x, y - o.y) - o.r);
      var direct = solid && (solid.crate === o || solid.struct === o);
      if (direct || (d < radius && self.lineClear(x, y, o.x, o.y, o))) objects.push({ s: s, o: o, damage: damage(d, direct) });
    });
    var cause = 'sentry-' + g.kind;
    players.forEach(function (entry) { if (entry.damage > 0) self.damagePlayer(entry.p, entry.damage, g.owner, cause, entry.p.x, entry.p.y, { x: x, y: y }); });
    vehicles.forEach(function (entry) { if (entry.damage > 0) self.damageVehicle(entry.v, entry.damage, g.owner, cause, entry.v.x, entry.v.y); });
    objects.forEach(function (entry) { if (entry.s.crate) self.damageCrate(entry.o, entry.damage, g.owner, entry.o.x, entry.o.y); else self.damageStruct(entry.o, entry.damage, g.owner, entry.o.x, entry.o.y, cause); });
  };
  World.prototype.sentryProjectileImpact = function (g, hit, x, y) {
    if (this.remote) return;
    var def = IV[g.kind], cause = 'sentry-' + g.kind, solid = hit && hit.solid, target = hit && hit.player;
    if (g.kind === 'grenades' || g.kind === 'rockets') this.sentryBlast(g, hit, x, y);
    else {
      if (solid && solid.struct && solid.struct.mounted) target = this.playerById(solid.struct.mounted);
      if (target) {
        var from = { x: x - g.dx * 40, y: y - g.dy * 40 }, bypass = g.kind === 'cannons' || g.kind === 'fireballs';
        var blocked = target.fx.immune > 0 || (!bypass && this.shieldBlocks(target, from.x, from.y, cause));
        this.damagePlayer(target, def.damage, g.owner, cause, x, y, bypass ? undefined : from);
        if (!blocked && target.alive) {
          if (g.kind === 'snowballs') this.applyPlayerSentrySnow(target);
          if (g.kind === 'fireballs') this.applyPlayerSentryBurn(target, g.owner);
        }
      } else if (solid && solid.vehicle) {
        var v = solid.vehicle, dealt = this.damageVehicle(v, def.vehicleDamage || def.damage, g.owner, cause, x, y);
        if (dealt && !v.wreck) {
          if (g.kind === 'snowballs' && this.applyVehicleSentrySnow) this.applyVehicleSentrySnow(v);
          if (g.kind === 'fireballs' && this.applyVehicleSentryBurn) this.applyVehicleSentryBurn(v, g.owner);
        }
      } else if (solid && solid.rock && g.kind === 'cannons') this.destroyRock(solid.rock, g.owner);
      else if (solid && solid.struct) {
        if (solid.struct.kind === 'rock' && g.kind === 'cannons') this.destroyStruct(solid.struct, g.owner);
        else this.damageStruct(solid.struct, def.damage, g.owner, x, y, cause);
      } else if (solid && solid.crate) this.damageCrate(solid.crate, def.damage, g.owner, x, y);
    }
    this.sentryImpactFx(g.kind, x, y);
    this.emit({ type: 'sentry-impact', id: g.id, kind: g.kind, x: x, y: y });
  };
  World.prototype.update = function (dt) {
    baseUpdate.call(this, dt);
    this.updateSentryProjectiles(dt);
  };
}());
