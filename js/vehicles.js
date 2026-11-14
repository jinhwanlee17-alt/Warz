/* Vehicles: shared movement, crew weapons, hull damage and permanent wrecks. No DOM access. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, C = W.CONFIG, V = W.VEHICLE, T = W.TANK, World = W.World;
  var SEATS = ['driver', 'gunner', 'rearLeft', 'rearRight'];
  var OFFSETS = { driver: [20, -20], gunner: [0, 0], rearLeft: [-35, -24], rearRight: [-35, 24] };
  var ACCESS = { driver: [28, -104], gunner: [28, 104], rearLeft: [-52, -96], rearRight: [-52, 96] };
  var TANK_OFFSETS = { driver: [43, -24], gunner: [0, 26], rearLeft: [-20, -28], rearRight: [-48, 24] };
  var TANK_ACCESS = { driver: [53, -132], gunner: [20, 132], rearLeft: [-25, -132], rearRight: [-132, 28] };
  var IDLE = { mx: 0, my: 0 };

  function terrainClear(world, x, y, r, ignoredCrates, ignoredRocks, ignoredStructRocks) {
    if (!U.insideIsland(x, y, r, C.worldSize, C.cornerRadius)) return false;
    var free = true;
    world.solids.query(x - r, y - r, x + r, y + r, function (s) {
      if (!free || (s.crate && (!s.crate.alive || (ignoredCrates && ignoredCrates[s.crate.id]))) || (s.rock && (!s.rock.alive || (ignoredRocks && ignoredRocks[s.rock.id]))) || (s.struct && (!s.struct.alive || (ignoredStructRocks && ignoredStructRocks[s.struct.id])))) return;
      if (s.shape === 'circle' ? Math.hypot(x - s.x, y - s.y) < r + s.r - 0.0001 : U.circleRectPush(x, y, r - 0.0001, s.x, s.y, s.w, s.h)) free = false;
    });
    return free;
  }
  function terrainPathClear(world, x, y, tx, ty, r, ignoredCrates, ignoredRocks, ignoredStructRocks) {
    var dx = tx - x, dy = ty - y, len = Math.hypot(dx, dy), free = true;
    if (len < 0.001) return true;
    // Move just off a touching boundary before testing; a body may slide away from a wall.
    x += dx / len * 0.001; y += dy / len * 0.001;
    world.solids.query(Math.min(x, tx) - r, Math.min(y, ty) - r, Math.max(x, tx) + r, Math.max(y, ty) + r, function (s) {
      if (!free || (s.crate && (!s.crate.alive || (ignoredCrates && ignoredCrates[s.crate.id]))) || (s.rock && (!s.rock.alive || (ignoredRocks && ignoredRocks[s.rock.id]))) || (s.struct && (!s.struct.alive || (ignoredStructRocks && ignoredStructRocks[s.struct.id])))) return;
      var hit = s.shape === 'circle' ? U.segCircle(x, y, tx, ty, s.x, s.y, s.r + r - 0.0001)
        : U.segRect(x, y, tx, ty, s.x - r + 0.0001, s.y - r + 0.0001, s.w + r * 2 - 0.0002, s.h + r * 2 - 0.0002);
      if (hit >= 0 && hit < 0.99999) free = false;
    });
    return free;
  }

  World.prototype.initVehicles = function () {
    var self = this;
    this.tankShells = []; this.nextTankShellId = 1;
    this.vehicles = this.demo ? [] : (this.map.vehicles || []).concat(this.map.tanks || [], this.map.artillery || [], this.map.groundArtillery || []).map(function (s, i) {
      var tank = s.type === 'tank', artillery = s.type === 'artillery', def = W.vehicleDef(s);
      return { id: s.id || i + 1, x: s.x, y: s.y, vx: 0, vy: 0, angle: s.angle || 0,
        type: artillery ? 'artillery' : tank ? 'tank' : 'humvee', fixed: artillery && !!s.fixed, r: def.radius, hp: def.hp, maxHp: def.hp, wreck: false, armed: tank || (!artillery && self.teams && i < 2),
        seats: { driver: 0, gunner: 0, rearLeft: 0, rearRight: 0 }, gunAngle: s.angle || 0,
        cannonAngle: s.angle || 0, cannonCooldown: 0, cannonAmmo: 1, cannonMaxAmmo: 1, cannonReload: 0, cannonUpgraded: false,
        cannonFlash: 0, mgAmmo: tank ? T.mgMagazine : 0, mgReload: 0,
        cooldown: 0, flash: 0, hitFlash: 0, contacts: {}, ramUntil: {}, snowT: 0, snowTick: 0,
        sentrySnow: [], sentryBurn: null, stationaryT: 0, artilleryCooldown: 0 };
    });
  };
  World.prototype.vehicleById = function (id) {
    var list = this.vehicles || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };
  World.prototype.vehicleTeam = function (v) {
    for (var i = 0; i < SEATS.length; i++) {
      var p = this.playerById(v.seats[SEATS[i]]);
      if (p && p.alive) return p.team;
    }
    return null;
  };
  World.prototype.vehicleSeatPoint = function (v, seat, access) {
    var offsets = v.type === 'tank' || v.type === 'artillery' ? (access ? TANK_ACCESS : TANK_OFFSETS) : (access ? ACCESS : OFFSETS);
    var o = offsets[seat] || [0, 0], ca = Math.cos(v.angle), sa = Math.sin(v.angle);
    if (access && v.type === 'artillery') o = [o[0] * 1.1, o[1] * 1.1];
    return { x: v.x + o[0] * ca - o[1] * sa, y: v.y + o[0] * sa + o[1] * ca };
  };
  World.prototype.vehicleSeatAvailable = function (v, seat, p) {
    if (!v || (this.remote && v.hidden) || v.wreck || !Object.prototype.hasOwnProperty.call(v.seats, seat) || v.seats[seat]) return false;
    if (this.vehicleSeatOrder(v).indexOf(seat) < 0) return false;
    var team = this.vehicleTeam(v);
    return team === null || team === p.team;
  };
  World.prototype.vehicleTeamSize = function () { return this.teams ? Math.max(2, Math.min(4, this.map.teamSize > 1 ? this.map.teamSize : 4)) : 1; };
  World.prototype.vehicleSeatOrder = function (v) {
    if (v.type === 'artillery') return ['driver'];
    var n = this.vehicleTeamSize();
    var order = v.type === 'tank' ? ['driver', 'rearLeft', 'gunner', 'rearRight']
      : v.armed ? ['driver', 'gunner', 'rearLeft', 'rearRight'] : ['driver', 'rearLeft', 'rearRight'];
    return order.slice(0, n);
  };
  World.prototype.vehicleSeatRole = function (v, seat) {
    if (v.fixed && v.type === 'artillery') return 'Artillery operator';
    if (seat === 'driver') return 'Driver';
    if (v.type === 'tank' && seat === 'rearLeft') return this.vehicleTeamSize() === 2 ? 'Cannon & machine gun' : 'Cannon operator';
    return seat === 'gunner' ? 'Machine gunner' : 'Passenger';
  };
  World.prototype.vehicleBoardingDistance = function (p, v) { return Math.hypot(p.x - v.x, p.y - v.y) - v.r - p.r; };
  World.prototype.vehicleMaxSpeed = function (v) {
    var driver = this.playerById(v.seats.driver), mul = 1;
    if (driver && driver.classId === 'armorcrew') {
      if (v.type === 'humvee') mul = W.ARMOR_CREW.humveeSpeedMul;
      else if (v.type === 'artillery' && !v.fixed) mul = W.ARMOR_CREW.artillerySpeedMul;
    }
    return W.vehicleDef(v).maxSpeed * mul;
  };
  World.prototype.nearestVehicleSeat = function (p) {
    if (!p || !p.alive || p.downed || p.dropT > 0 || p.mount || p.vehicle) return null;
    var best = null, bd = V.interactRange, list = this.vehicles || [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i], order = this.vehicleSeatOrder(v), d = this.vehicleBoardingDistance(p, v);
      if (d > bd || !this.lineClear(p.x, p.y, v.x, v.y, v)) continue;
      for (var j = 0; j < order.length; j++) if (this.vehicleSeatAvailable(v, order[j], p)) {
        best = { vehicle: v, seat: order[j], x: v.x, y: v.y, d: d }; bd = d; break;
      }
    }
    return best;
  };
  World.prototype.enterVehicle = function (p, v, seat) {
    if (this.remote || !p || !p.alive || p.downed || p.dropT > 0 || p.mount || p.vehicle || !this.vehicleSeatAvailable(v, seat, p)) return false;
    if (this.vehicleBoardingDistance(p, v) > V.interactRange || !this.lineClear(p.x, p.y, v.x, v.y, v)) return false;
    if (this.stopVehicleRepair) this.stopVehicleRepair(p);
    v.seats[seat] = p.id; p.vehicle = v.id; p.vehicleSeat = seat;
    p.vehicleWeapon = seat === 'gunner' || (v.type === 'artillery' && v.fixed) ? 1 : 0;
    p.vx = p.vy = 0; p.scoping = false; p.sprinting = false; p.shieldUp = false; p.held = -1; p.nearStation = null; p.wantsRevive = false; p.repairVehicle = 0;
    p.vehicleIntent = IDLE;
    var w = p.weapons[p.slot];
    if (w) { w.reloading = false; w.reloadT = 0; }
    this.syncVehicleSeats(v);
    this.emit({ type: 'vehicle', op: 'enter', vehicle: v, player: p, seat: seat });
    return true;
  };
  World.prototype.exitVehicle = function (p, forced) {
    var v = p.vehicle && this.vehicleById(p.vehicle), seat = p.vehicleSeat;
    if (!v) { p.vehicle = 0; p.vehicleSeat = null; return false; }
    var at = this.vehicleSeatPoint(v, seat, true), angle = Math.atan2(at.y - v.y, at.x - v.x), spot = null;
    var max = forced ? 1200 : 260;
    for (var distance = v.r + p.r + V.exitGap; distance <= max && !spot; distance += 24) {
      for (var i = 0; i < 24; i++) {
        var a = angle + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * U.TAU / 24;
        var x = v.x + Math.cos(a) * distance, y = v.y + Math.sin(a) * distance;
        if (!this.spotFree(x, y, p.r, true) || this.inPond(x, y)) continue;
        var occupied = this.players.some(function (o) { return o !== p && o.alive && !o.vehicle && o.dropT <= 0 && Math.hypot(o.x - x, o.y - y) < o.r + p.r + 2; });
        if (!occupied && (forced || this.lineClear(at.x, at.y, x, y, v))) { spot = { x: x, y: y }; break; }
      }
    }
    if (!spot && !forced) { this.emit({ type: 'deny', player: p, reason: 'blocked' }); return false; }
    if (!spot) { spot = { x: at.x, y: at.y, vx: 0, vy: 0, r: p.r }; this.collide(spot); }
    if (v.seats[seat] === p.id) v.seats[seat] = 0;
    p.vehicle = 0; p.vehicleSeat = null; p.vehicleIntent = null;
    p.x = spot.x; p.y = spot.y; p.vx = p.vy = p.ox = p.oy = 0;
    p.scoping = false; p.sprinting = false; p.wantsRevive = false; p.nearStation = null;
    this.emit({ type: 'vehicle', op: 'exit', vehicle: v, player: p, seat: seat });
    return true;
  };
  World.prototype.syncVehicleSeats = function (v) {
    if (this.remote && v.hidden) return;
    for (var i = 0; i < SEATS.length; i++) {
      var seat = SEATS[i], p = this.playerById(v.seats[seat]);
      if (!p || !p.alive || p.vehicle !== v.id || p.vehicleSeat !== seat) continue;
      var at = this.vehicleSeatPoint(v, seat);
      p.x = at.x; p.y = at.y; p.vx = v.vx; p.vy = v.vy;
      p.ox = v.ox || 0; p.oy = v.oy || 0; p.scoping = false; p.nearStation = null; p.sprinting = false;
    }
  };
  World.prototype.updateVehiclePlayer = function (p, intent) {
    var v = this.vehicleById(p.vehicle);
    if (!v || v.wreck || v.seats[p.vehicleSeat] !== p.id) { this.exitVehicle(p, true); return; }
    p.wantsRevive = false; p.scoping = false; p.nearStation = null; p.shieldUp = false;
    if (intent.interactPressed) { this.exitVehicle(p, false); return; }
    p.vehicleIntent = intent;
    if (v.type === 'tank' && (p.vehicleSeat === 'driver' || (p.vehicleSeat === 'rearLeft' && this.vehicleTeamSize() === 2)) && (intent.slot === 0 || intent.slot === 1)) p.vehicleWeapon = intent.slot;
    var weapon = this.vehicleWeaponFor(p);
    if (weapon && Number.isFinite(intent.aimX) && Number.isFinite(intent.aimY)) {
      var aim = Math.atan2(intent.aimY - v.y, intent.aimX - v.x);
      if (weapon === 'cannon') v.cannonAngle = aim; else v.gunAngle = aim;
    }
    if (v.type === 'tank' && weapon === 'mg' && intent.reload) this.reloadTankGun(v);
    if (v.type === 'tank' && weapon === 'cannon' && intent.reload) this.reloadTankCannon(v);
  };
  World.prototype.vehicleWeaponFor = function (p) {
    var v = p && this.vehicleById(p.vehicle);
    if (!v || v.wreck || v.seats[p.vehicleSeat] !== p.id) return null;
    if (v.type !== 'tank') return v.armed && p.vehicleSeat === 'gunner' ? 'mg' : null;
    if (p.vehicleSeat === 'gunner') return 'mg';
    if (p.vehicleSeat === 'rearLeft') return this.vehicleTeamSize() === 2 && p.vehicleWeapon === 1 ? 'mg' : 'cannon';
    if (p.vehicleSeat !== 'driver') return null;
    if (this.vehicleTeamSize() === 2 && v.seats.rearLeft) return null;
    return p.vehicleWeapon === 1 ? (v.seats.gunner ? null : 'mg') : (v.seats.rearLeft ? null : 'cannon');
  };
  World.prototype.reloadTankGun = function (v) {
    if (this.remote || v.type !== 'tank' || v.wreck || v.mgReload > 0 || v.mgAmmo >= T.mgMagazine) return false;
    v.mgReload = T.mgReload;
    this.emit({ type: 'vehicle', op: 'reload', vehicle: v });
    return true;
  };
  World.prototype.reloadTankCannon = function (v) {
    if (this.remote || v.wreck || v.cannonReload > 0 || v.cannonAmmo >= v.cannonMaxAmmo) return false;
    v.cannonReload = T.cannonInterval;
    v.cannonCooldown = Math.max(v.cannonCooldown, v.cannonReload);
    if (v.cannonMaxAmmo > 1) this.emit({ type: 'vehicle', op: 'reload', vehicle: v, weapon: 'cannon' });
    return true;
  };
  World.prototype.prepareTankCannon = function (v, p) {
    if (!p) return;
    var upgraded = p.classId === 'armorcrew', cap = upgraded ? W.ARMOR_CREW.cannonMagazine : 1;
    if (upgraded && !v.cannonUpgraded) {
      // This tank receives its extra loaded round once. Reboarding never refills ammunition.
      if (v.cannonReload <= 0 && v.cannonAmmo > 0) v.cannonAmmo++;
      v.cannonUpgraded = true;
    }
    v.cannonMaxAmmo = cap; v.cannonAmmo = Math.min(cap, v.cannonAmmo);
  };

  // Exact circle sweep around rectangular corners; a square expansion would crush near misses.
  function hullContact(x, y, tx, ty, r, s) {
    if (s.shape === 'circle') return U.segCircle(x, y, tx, ty, s.x, s.y, s.r + r);
    var best = 2, t;
    function take(value) { if (value >= 0 && value < best) best = value; }
    take(U.segRect(x, y, tx, ty, s.x - r, s.y, s.w + r * 2, s.h));
    take(U.segRect(x, y, tx, ty, s.x, s.y - r, s.w, s.h + r * 2));
    for (var i = 0; i < 4; i++) {
      t = U.segCircle(x, y, tx, ty, s.x + (i % 2) * s.w, s.y + (i > 1 ? s.h : 0), r);
      take(t);
    }
    return best <= 1 ? best : -1;
  }
  World.prototype.crushVehicleCrates = function (v, body, tx, ty) {
    var hits = [], blockedAt = 2, r = v.r, ignored = body.vehicleCrates;
    this.solids.query(Math.min(body.x, tx) - r, Math.min(body.y, ty) - r, Math.max(body.x, tx) + r, Math.max(body.y, ty) + r, function (s) {
      if ((s.crate && (!s.crate.alive || (ignored && ignored[s.crate.id]))) || (s.rock && (!s.rock.alive || (body.vehicleRocks && body.vehicleRocks[s.rock.id]))) || (s.struct && (!s.struct.alive || (body.vehicleStructRocks && body.vehicleStructRocks[s.struct.id])))) return;
      var t = hullContact(body.x, body.y, tx, ty, s.crate ? r : r - 0.0001, s);
      if (t < 0) return;
      if (s.crate) hits.push({ crate: s.crate, t: t });
      else blockedAt = Math.min(blockedAt, t);
    });
    if (!hits.length) return;
    for (var i = 0; i < this.vehicles.length; i++) {
      var other = this.vehicles[i];
      if (other === v || (this.remote && other.hidden)) continue;
      var t = U.segCircle(body.x, body.y, tx, ty, other.x, other.y, other.r + r - 0.0001);
      if (t >= 0) blockedAt = Math.min(blockedAt, t);
    }
    hits.sort(function (a, b) { return a.t - b.t || a.crate.id - b.crate.id; });
    for (var j = 0; j < hits.length; j++) {
      var hit = hits[j], c = hit.crate;
      if (hit.t > blockedAt + 0.000001) break;
      // Prediction remembers contact only for this vehicle. HP, effects and loot wait for the server.
      if (this.remote) ignored[c.id] = true;
      else {
        this.damageCrate(c, c.hp, v.seats.driver || null, c.x, c.y);
        v.x = body.x; v.y = body.y;
        this.damageVehicle(v, T.collisionHullCost, null, 'ram-impact');
        if (v.wreck) break;
      }
    }
  };

  // Shared steering and collision for server, offline play and input replay.
  World.prototype.driveVehicle = function (v, intent, dt) {
    if (!v || (this.remote && v.hidden) || !(dt > 0)) return;
    if (v.wreck) { v.vx = v.vy = 0; return; }
    intent = intent || IDLE;
    var mx = intent.mx || 0, my = intent.my || 0, len = Math.hypot(mx, my);
    var def = W.vehicleDef(v), maxSpeed = this.vehicleMaxSpeed(v), throttle = Math.min(1, len), targetAngle = len ? Math.atan2(my, mx) : v.angle;
    if (!len && Math.hypot(v.vx, v.vy) < 0.1) { v.vx = v.vy = 0; return; }
    // Small fixed-size steps keep online (20 Hz) and Practice (60 Hz) on the same curved path.
    var steps = Math.max(1, Math.ceil(dt * 120 - 0.0000001)), h = dt / steps, k = 1 - Math.exp(-def.accel * h);
    var body = { x: v.x, y: v.y, vx: v.vx, vy: v.vy, r: v.r, vehicleCollider: v.id,
      vehicleCrates: this.remote ? (v.predictedCrates || (v.predictedCrates = {})) : null,
      vehicleRocks: this.remote ? (v.predictedRocks || (v.predictedRocks = {})) : null,
      vehicleStructRocks: this.remote ? (v.predictedStructRocks || (v.predictedStructRocks = {})) : null };
    for (var i = 0; i < steps; i++) {
      var signed = body.vx * Math.cos(v.angle) + body.vy * Math.sin(v.angle) < -0.01 ? -1 : 1;
      var turn = len ? U.clamp(U.angleDiff(v.angle, targetAngle), -def.turnRate * h, def.turnRate * h) : 0;
      v.angle = U.angleDiff(0, v.angle + turn);
      var targetSpeed = maxSpeed * throttle * (this.inPond(body.x, body.y) ? C.pondSpeedMul : 1);
      var speed = signed * Math.min(maxSpeed, Math.hypot(body.vx, body.vy));
      speed += (targetSpeed - speed) * k;
      if (!len && Math.abs(speed) < 0.1) speed = 0;
      body.vx = Math.cos(v.angle) * speed; body.vy = Math.sin(v.angle) * speed;
      var tx = body.x + body.vx * h, ty = body.y + body.vy * h;
      if (speed >= maxSpeed * def.crushSpeedRatio) {
        this.crushVehicleCrates(v, body, tx, ty);
        if (v.wreck) { body.vx = body.vy = 0; break; }
        var rockImpact = (v.type === 'tank' || v.type === 'artillery') && this.ramTankRock(v, body, tx, ty);
        if (rockImpact) {
          if (v.wreck || rockImpact === 'stop') { body.vx = body.vy = 0; break; }
          continue;
        }
      }
      if (speed !== 0) { body.x = tx; body.y = ty; this.collide(body); }
    }
    v.x = body.x; v.y = body.y; v.vx = body.vx; v.vy = body.vy;
  };
  World.prototype.ramTankRock = function (v, body, tx, ty) {
    var nearest = null, block = 2;
    this.solids.query(Math.min(body.x, tx) - v.r, Math.min(body.y, ty) - v.r, Math.max(body.x, tx) + v.r, Math.max(body.y, ty) + v.r, function (s) {
      if ((s.crate && (!s.crate.alive || (body.vehicleCrates && body.vehicleCrates[s.crate.id]))) ||
          (s.rock && (!s.rock.alive || (body.vehicleRocks && body.vehicleRocks[s.rock.id]))) ||
          (s.struct && (!s.struct.alive || (body.vehicleStructRocks && body.vehicleStructRocks[s.struct.id])))) return;
      var t = hullContact(body.x, body.y, tx, ty, v.r, s);
      if (t < 0) return;
      if (s.rock || (s.struct && s.struct.kind === 'rock')) {
        if (!nearest || t < nearest.t) nearest = { rock: s.rock || s.struct, placed: !!s.struct, t: t };
      }
      else block = Math.min(block, t);
    });
    if (!nearest || nearest.t > block + 0.000001) return false;
    for (var i = 0; i < this.vehicles.length; i++) {
      var other = this.vehicles[i];
      if (other === v || (this.remote && other.hidden)) continue;
      var vt = U.segCircle(body.x, body.y, tx, ty, other.x, other.y, other.r + v.r);
      if (vt >= 0 && vt < nearest.t) return false;
    }
    var rock = nearest.rock, placed = nearest.placed;
    if (this.remote) {
      if (placed) {
        var damage = v.predictedStructRockDamage || (v.predictedStructRockDamage = {});
        damage[rock.id] = (damage[rock.id] || 0) + T.playerRockRamDamage;
        if (rock.hp - damage[rock.id] <= 0) body.vehicleStructRocks[rock.id] = true;
      } else body.vehicleRocks[rock.id] = true;
    } else {
      if (placed) this.damagePlayerRock(rock, v.seats.driver || null, rock.x, rock.y);
      else this.damageMapRock(rock, 'tankram', v.seats.driver || null, rock.x, rock.y);
    }
    body.x += (tx - body.x) * nearest.t; body.y += (ty - body.y) * nearest.t;
    var mul = placed ? 0 : 0.5;
    body.vx *= mul; body.vy *= mul;
    // A player rock stops a tracked vehicle, including the hit that destroys it.
    if (placed) {
      var dx = body.x - rock.x, dy = body.y - rock.y, d = Math.hypot(dx, dy) || 1;
      body.x = rock.x + dx / d * (rock.r + v.r + 0.001);
      body.y = rock.y + dy / d * (rock.r + v.r + 0.001);
    }
    if (!this.remote) {
      v.x = body.x; v.y = body.y;
      this.damageVehicle(v, placed ? T.playerRockRamHullCost : T.rockRamHullCost, null, 'ram-impact');
    }
    return placed ? 'stop' : 'through';
  };

  World.prototype.updateTankWeapons = function (v, dt) {
    dt = this.vehicleSentryWeaponTime(v, dt);
    for (var ci = 0; ci < SEATS.length; ci++) {
      var cp = this.playerById(v.seats[SEATS[ci]]);
      if (this.vehicleWeaponFor(cp) === 'cannon') { this.prepareTankCannon(v, cp); break; }
    }
    v.cannonCooldown = Math.max(0, v.cannonCooldown - dt);
    v.cooldown = Math.max(-dt, v.cooldown - dt);
    if (v.cannonReload > 0) {
      v.cannonReload = Math.max(0, v.cannonReload - dt);
      if (v.cannonReload <= 0.000001) {
        v.cannonReload = 0; v.cannonAmmo = v.cannonMaxAmmo;
        if (v.cannonMaxAmmo > 1) this.emit({ type: 'vehicle', op: 'reloaded', vehicle: v, weapon: 'cannon' });
      }
    }
    if (v.mgReload > 0) {
      v.mgReload = Math.max(0, v.mgReload - dt);
      if (v.mgReload <= 0.000001) { v.mgReload = 0; v.mgAmmo = T.mgMagazine; this.emit({ type: 'vehicle', op: 'reloaded', vehicle: v }); }
    }
    var mgFiring = false;
    for (var i = 0; i < SEATS.length; i++) {
      var p = this.playerById(v.seats[SEATS[i]]), weapon = this.vehicleWeaponFor(p), input = p && p.vehicleIntent;
      if (!p || !p.alive || !input || !(input.fire || input.firePressed)) continue;
      // A crewmate may have exited after the driver's input was processed this tick.
      // Aim a newly available weapon using its current operator before it can fire.
      if (weapon && Number.isFinite(input.aimX) && Number.isFinite(input.aimY)) {
        var aim = Math.atan2(input.aimY - v.y, input.aimX - v.x);
        if (weapon === 'cannon') v.cannonAngle = aim; else v.gunAngle = aim;
      }
      var crew = p.classId === 'armorcrew', rate = crew ? W.ARMOR_CREW.tankFireRateMul : 1;
      if (weapon === 'mg') mgFiring = true;
      if (weapon === 'cannon' && v.cannonCooldown <= 0.000001 && v.cannonReload <= 0 && v.cannonAmmo > 0) {
        this.fireTankCannon(p, v); v.cannonAmmo--;
        v.cannonCooldown = crew ? W.ARMOR_CREW.cannonBurstInterval / rate : T.cannonInterval;
        if (v.cannonAmmo <= 0) this.reloadTankCannon(v);
      } else if (weapon === 'mg' && v.cooldown <= 0.000001 && v.mgReload <= 0) {
        if (v.mgAmmo <= 0) { this.reloadTankGun(v); continue; }
        var def = Object.assign({}, W.WEAPONS.tankmg, { damage: W.WEAPONS.tankmg.damage * (crew ? W.ARMOR_CREW.damageMul : 1) });
        var a = v.gunAngle + (this.rng.next() - 0.5) * 2 * def.spread;
        this.vehicleShot(p, v, def, [a]); v.cooldown += T.mgInterval / rate; v.mgAmmo--; p.stats.shots++;
        this.emit({ type: 'vehicle-shot', vehicle: v, player: p, x: v.x, y: v.y, angle: v.gunAngle, angles: [a], weapon: 'tankmg' });
        if (!v.mgAmmo) this.reloadTankGun(v);
      }
    }
    if (!mgFiring || v.mgReload > 0) v.cooldown = Math.max(0, v.cooldown);
  };
  World.prototype.spawnTankShell = function (o) {
    this.tankShells = this.tankShells || [];
    var shell = Object.assign({ id: this.nextTankShellId++, dx: 1, dy: 0, speed: T.cannonSpeed, range: T.cannonRange, traveled: 0, r: 8 }, o);
    this.nextTankShellId = Math.max(this.nextTankShellId || 1, shell.id + 1);
    if (!this.tankShells.some(function (s) { return s.id === shell.id; })) this.tankShells.push(shell);
    return shell;
  };
  World.prototype.fireTankCannon = function (p, v) {
    var shell = this.spawnTankShell({ owner: p.id, team: p.team, vehicle: v.id, x: v.x, y: v.y,
      damageMul: p.classId === 'armorcrew' ? W.ARMOR_CREW.damageMul : 1,
      dx: Math.cos(v.cannonAngle), dy: Math.sin(v.cannonAngle) });
    p.stats.shots++; v.cannonFlash = 1;
    this.emit({ type: 'tank-shell', op: 'spawn', shell: Object.assign({}, shell) });
    if (!this.advanceTankShell(shell, v.r + 24)) this.tankShells = this.tankShells.filter(function (s) { return s !== shell; });
  };
  World.prototype.advanceTankShell = function (shell, step) {
    var remaining = Math.max(0, shell.range - shell.traveled), distance = Math.min(step, remaining);
    var tx = shell.x + shell.dx * distance, ty = shell.y + shell.dy * distance;
    var hit = this.sweep(shell.x, shell.y, tx, ty, shell.r, shell.owner, shell.team);
    if (hit) {
      var x = shell.x + (tx - shell.x) * hit.t, y = shell.y + (ty - shell.y) * hit.t;
      if (!this.remote) this.tankShellImpact(shell, hit, x, y);
      return false;
    }
    shell.x = tx; shell.y = ty; shell.traveled += distance;
    if (distance >= remaining) {
      if (!this.remote) this.tankShellImpact(shell, null, tx, ty);
      return false;
    }
    return true;
  };
  World.prototype.updateTankShells = function (dt) {
    var out = [], shells = this.tankShells || [];
    for (var i = 0; i < shells.length; i++) if (this.advanceTankShell(shells[i], shells[i].speed * dt)) out.push(shells[i]);
    this.tankShells = out;
  };
  World.prototype.tankShellImpact = function (shell, hit, x, y) {
    var self = this, R = T.cannonRadius, owner = this.playerById(shell.owner), team = owner ? owner.team : shell.team;
    var solid = hit && hit.solid, directPlayer = hit && hit.player;
    if (solid && solid.struct && solid.struct.mounted) directPlayer = this.playerById(solid.struct.mounted);
    function damage(distance, direct) { return (direct ? T.cannonMaxDamage : T.cannonMinDamage + (T.cannonMaxDamage - T.cannonMinDamage) * (1 - U.clamp(distance / R, 0, 1))) * (shell.damageMul || 1); }
    function canHit(target) { return target.id === shell.owner || target.team !== team; }
    if (!this.remote) {
      // Capture targets before hull/cover destruction can eject riders or reveal targets behind it.
      var people = this.players.filter(function (p) { return p.alive && !p.vehicle && p.dropT <= 0 && canHit(p); }).map(function (p) {
        var d = Math.max(0, Math.hypot(p.x - x, p.y - y) - p.r), direct = p === directPlayer;
        var mount = p.mount && self.structById(p.mount);
        return { target: p, amount: direct || (d < R && self.lineClear(x, y, p.x, p.y, mount)) ? damage(d, direct) : 0 };
      });
      var hulls = this.vehicles.filter(function (v) { return !v.wreck && (v.id === shell.vehicle || self.vehicleTeam(v) !== team); }).map(function (v) {
        var d = Math.max(0, Math.hypot(v.x - x, v.y - y) - v.r), direct = solid && solid.vehicle === v;
        return { target: v, amount: direct || (d < R && self.lineClear(x, y, v.x, v.y, v)) ? damage(d, direct) : 0 };
      });
      var objects = [];
      this.solids.query(x - R, y - R, x + R, y + R, function (s) {
        if ((s.crate && s.crate.alive) || (s.struct && s.struct.alive && s.struct.maxHp && !s.struct.mounted && s.struct.team !== team)) objects.push(s);
      });
      objects = objects.map(function (s) {
        var target = s.crate || s.struct;
        var d = s.crate ? Math.hypot(x - U.clamp(x, s.x, s.x + s.w), y - U.clamp(y, s.y, s.y + s.h)) : Math.max(0, Math.hypot(x - s.x, y - s.y) - s.r);
        var direct = solid && ((s.crate && solid.crate === s.crate) || (s.struct && solid.struct === s.struct));
        return { solid: s, target: target, amount: direct || (d < R && self.lineClear(x, y, target.x, target.y, target)) ? damage(d, direct) : 0 };
      });
      // Evaluate rock cover before this explosion removes any nearby crate or structure.
      this.damageFoliageInArea(x, y, R, function (plant) {
        return damage(Math.max(0, Math.hypot(plant.x - x, plant.y - y) - plant.hitRadius), solid && solid.plant === plant);
      }, shell.owner, 'tank-cannon');
      if (this.damageMapRocksInArea) this.damageMapRocksInArea(x, y, R, 'tank-cannon', shell.owner, false);
      people.forEach(function (entry) { if (entry.amount) self.damagePlayer(entry.target, entry.amount, shell.owner, 'tank-cannon', entry.target.x, entry.target.y, { x: x, y: y }); });
      hulls.forEach(function (entry) { if (entry.amount) self.damageVehicle(entry.target, entry.amount, shell.owner, 'tank-cannon', x, y); });
      objects.forEach(function (entry) {
        if (!entry.amount) return;
        if (entry.solid.crate) self.damageCrate(entry.target, entry.amount, shell.owner, entry.target.x, entry.target.y);
        else self.damageStruct(entry.target, entry.amount, shell.owner, entry.target.x, entry.target.y, 'tank-cannon');
      });
      this.emit({ type: 'tank-shell', op: 'impact', shell: Object.assign({}, shell), x: x, y: y });
    }
    this.explosions.push({ x: x, y: y, r: R, t: 0, dur: 0.6, power: T.cannonMaxDamage });
    this.burst(x, y, 22, '#ffbf63', 250, 0.55, 6);
    this.smoke(x, y, 12, '#8f8f8f', 22, 1.1, 100);
    this.emit({ type: 'explosion', x: x, y: y, power: T.cannonMaxDamage, owner: shell.owner, cause: 'tank-cannon' });
  };

  World.prototype.collideVehicles = function (p) {
    if (p.vehicle && !p.vehicleCollider) return;
    var list = this.vehicles || [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if ((this.remote && v.hidden) || v.id === p.vehicleCollider) continue;
      var dx = p.x - v.x, dy = p.y - v.y, d = Math.hypot(dx, dy), min = p.r + v.r;
      if (d >= min) continue;
      var angle = d < 0.0001 ? 0 : Math.atan2(dy, dx), spot = null;
      // The nearest radial push can point through a wall when a vehicle pins a body against it.
      // Find a clear exit around the hull and verify the whole displacement against terrain.
      for (var ring = 0; ring < 4 && !spot; ring++) for (var turn = 0; turn < 24; turn++) {
        var a = angle + (turn % 2 ? 1 : -1) * Math.ceil(turn / 2) * U.TAU / 24;
        var tx = v.x + Math.cos(a) * (min + 0.001 + ring * 24), ty = v.y + Math.sin(a) * (min + 0.001 + ring * 24);
        if (!terrainClear(this, tx, ty, p.r, p.vehicleCrates, p.vehicleRocks, p.vehicleStructRocks) || !terrainPathClear(this, p.x, p.y, tx, ty, p.r, p.vehicleCrates, p.vehicleRocks, p.vehicleStructRocks)) continue;
        var blocked = false;
        for (var j = 0; j < list.length; j++) {
          var other = list[j];
          if ((this.remote && other.hidden) || other === v || other.id === p.vehicleCollider) continue;
          if (Math.hypot(tx - other.x, ty - other.y) < p.r + other.r) { blocked = true; break; }
        }
        if (!blocked) { spot = { x: tx, y: ty }; break; }
      }
      if (!spot) { p.vx = p.vy = 0; continue; }
      p.x = spot.x; p.y = spot.y;
      var dist = Math.hypot(p.x - v.x, p.y - v.y), nx = (p.x - v.x) / dist, ny = (p.y - v.y) / dist;
      var vn = p.vx * nx + p.vy * ny;
      if (vn < 0) { p.vx -= vn * nx; p.vy -= vn * ny; }
    }
  };
  World.prototype.updateVehicles = function (dt) {
    this.updateTankShells(dt);
    for (var i = 0; i < this.vehicles.length; i++) {
      var v = this.vehicles[i];
      v.flash = Math.max(0, v.flash - dt * 9); v.hitFlash = Math.max(0, v.hitFlash - dt * 6);
      v.cannonFlash = Math.max(0, (v.cannonFlash || 0) - dt * 4);
      this.updateVehicleSentryBurn(v);
      if (this.remote || v.wreck) continue;
      var driver = this.playerById(v.seats.driver), oldX = v.x, oldY = v.y;
      this.driveVehicle(v, driver && driver.alive ? driver.vehicleIntent : IDLE, dt);
      this.syncVehicleSeats(v);
      if (v.wreck) continue;
      var def = W.vehicleDef(v), maxSpeed = this.vehicleMaxSpeed(v), speed = Math.min(maxSpeed, Math.hypot(v.x - oldX, v.y - oldY) / dt);
      for (var j = 0; j < this.players.length; j++) {
        var p = this.players[j], contact = Math.hypot(p.x - v.x, p.y - v.y) <= v.r + p.r + 12;
        if (!contact) delete v.contacts[p.id];
        if (!p.alive || p.dropT > 0 || p.vehicle) continue;
        var hit = speed > 1 && U.segCircle(oldX, oldY, v.x, v.y, p.x, p.y, v.r + p.r) >= 0;
        if (hit && !v.contacts[p.id] && !(v.ramUntil[p.id] > this.time)) {
          v.contacts[p.id] = true; v.ramUntil[p.id] = this.time + def.ramCooldown;
          if (!(driver && p.team === driver.team)) this.damagePlayer(p, def.ramDamage * speed / maxSpeed, driver ? driver.id : null, 'ram', p.x, p.y - p.r);
          this.damageVehicle(v, T.collisionHullCost, null, 'ram-impact');
        }
        if (p.alive && (hit || contact)) this.collideVehicles(p);
        if (v.wreck) break;
      }
      if (v.wreck) continue;
      if (v.type === 'tank') { this.updateTankWeapons(v, dt); this.pruneVehicleSentrySnow(v); continue; }
      if (v.type === 'artillery') { if (this.updateArtilleryWeapons) this.updateArtilleryWeapons(v, dt); this.pruneVehicleSentrySnow(v); continue; }
      var weaponDt = this.vehicleSentryWeaponTime(v, dt);
      v.cooldown = Math.max(-weaponDt, v.cooldown - weaponDt);
      var gunner = v.armed && this.playerById(v.seats.gunner), input = gunner && gunner.vehicleIntent;
      if (gunner && gunner.alive && input && (input.fire || input.firePressed) && v.cooldown <= 0) {
        var def = Object.assign({}, W.WEAPONS.turret, { damage: W.ITEMS.turret.damage * (gunner.classId === 'armorcrew' ? W.ARMOR_CREW.damageMul : 1) });
        var a = v.gunAngle + (this.rng.next() - 0.5) * 2 * def.spread;
        this.vehicleShot(gunner, v, def, [a]); v.cooldown += W.ITEMS.turret.fireInterval;
        gunner.stats.shots++;
        this.emit({ type: 'vehicle-shot', vehicle: v, player: gunner, x: v.x, y: v.y, angle: v.gunAngle, angles: [a], weapon: 'turret' });
      }
      if (!input || !(input.fire || input.firePressed)) v.cooldown = Math.max(0, v.cooldown);
      this.pruneVehicleSentrySnow(v);
    }
  };
  World.prototype.vehicleShot = function (p, v, def, angles) {
    var proxy = { id: p.id, team: p.team, color: p.color, outline: p.outline, r: 24, x: v.x, y: v.y, angle: v.gunAngle, vx: 0, vy: 0, isLocal: p.isLocal };
    this.spawnShot(proxy, def, angles); v.flash = 1;
  };

  // Hull armor applies once, regardless of whether the hit came from a physical
  // projectile or a basic sentry's direct shot. Tier-IV rockets and cannons bypass it.
  World.prototype.vehicleSentryDamageMul = function (v, cause) {
    var armored = W.vehicleHasTankArmor(v);
    if (cause === 'sentry-cannons' || cause === 'sentry-rockets') return 1;
    if (cause === 'sentry-burn') return armored ? 0 : 1;
    if (cause === 'sentry-snowballs') return armored ? 0.25 : 0.5;
    var weapon = W.WEAPONS[cause];
    if (armored && weapon && weapon.kind === 'gun' && weapon.tankDefensePenetration) return 0.25 + weapon.tankDefensePenetration;
    return armored && ((weapon && weapon.kind === 'gun') || cause === 'turret' || cause === 'tankmg' ||
      cause === 'sentry' || (typeof cause === 'string' && cause.indexOf('sentry-') === 0)) ? 0.25 : 1;
  };
  World.prototype.pruneVehicleSentrySnow = function (v) {
    var now = this.time;
    v.sentrySnow = (v.sentrySnow || []).filter(function (until) { return Number.isFinite(until) && until > now + 0.00000001; }).slice(-10);
  };
  World.prototype.applyVehicleSentrySnow = function (v) {
    if (this.remote || !v || v.wreck) return false;
    this.pruneVehicleSentrySnow(v);
    v.sentrySnow.push(this.time + 3);
    // At the cap, a new hit replaces the oldest stack rather than extending all
    // stacks. The remaining hits still expire independently three seconds later.
    if (v.sentrySnow.length > 10) v.sentrySnow.shift();
    return true;
  };
  World.prototype.vehicleSentryRate = function (v) {
    var now = this.time, n = (v.sentrySnow || []).filter(function (until) { return until > now + 0.00000001; }).length;
    return 1 - Math.min(10, n) * 0.05;
  };
  World.prototype.vehicleSentryWeaponTime = function (v, dt) {
    // Integrate through expiration boundaries. A stack expiring halfway through
    // a tick only slows the first half, independent of Practice/server tick size.
    var from = this.time - dt, lost = 0;
    (v.sentrySnow || []).slice(-10).forEach(function (until) { if (Number.isFinite(until)) lost += U.clamp(until - from, 0, dt) * 0.05; });
    return Math.max(dt * 0.5, dt - lost);
  };
  World.prototype.applyVehicleSentryBurn = function (v, ownerId) {
    if (this.remote || !v || v.wreck || W.vehicleHasTankArmor(v)) return false;
    var burn = v.sentryBurn;
    if (!burn || burn.until < this.time - 0.00000001) burn = { until: this.time + 3, next: this.time + 0.1, owner: ownerId || 0 };
    else { burn.until = this.time + 3; burn.owner = ownerId || 0; }
    v.sentryBurn = burn;
    return true;
  };
  World.prototype.updateVehicleSentryBurn = function (v) {
    var burn = v.sentryBurn;
    if (!burn) return;
    if (v.wreck || W.vehicleHasTankArmor(v)) { v.sentryBurn = null; return; }
    if (!this.remote) {
      var end = Math.min(this.time, burn.until);
      while (!v.wreck && burn.next <= end + 0.00000001) {
        this.damageVehicle(v, 1, burn.owner, 'sentry-burn', v.x, v.y - v.r);
        burn.next += 0.1;
      }
    }
    if (this.time >= burn.until - 0.00000001) v.sentryBurn = null;
  };

  World.prototype.damageVehicle = function (v, amount, sourceId, cause, hx, hy) {
    if (this.remote || !v || v.wreck || !(amount > 0)) return false;
    var src = sourceId ? this.playerById(sourceId) : null;
    if (src && src.vehicle !== v.id && this.vehicleTeam(v) === src.team && cause !== 'airstrike') return false;
    if (src && src.vehicle !== v.id && cause !== 'airstrike' && cause !== 'lightning' && cause !== 'storm' && cause !== 'snow' && cause !== 'ram' && cause !== 'tank-cannon' && cause !== 'tankmg' && cause !== 'sentry-cannons' && cause !== 'sentry-burn' && cause !== 'pyro-burn') amount *= this.damageMul(src);
    amount *= this.outgoingClassDamageMul(src);
    amount = Math.round(amount * this.vehicleSentryDamageMul(v, cause) * 100) / 100;
    if (!(amount > 0)) return false;
    v.hp = Math.max(0, v.hp - amount); v.hitFlash = 1;
    if (src) { src.stats.damage += amount; src.stats.hits++; }
    this.text(hx === undefined ? v.x : hx, (hy === undefined ? v.y - v.r : hy) - 8, String(Math.round(amount)), '#ffd84a', 20);
    this.emit({ type: 'vehicle', op: 'hp', vehicle: v, amount: amount, source: src, cause: cause, x: hx, y: hy });
    if (v.hp > 0) return true;
    v.wreck = true; v.vx = v.vy = 0; v.cooldown = 0; v.sentrySnow = []; v.sentryBurn = null;
    for (var i = 0; i < SEATS.length; i++) {
      var p = this.playerById(v.seats[SEATS[i]]);
      if (p && p.vehicle === v.id) { if (cause === 'poison') p.vehiclePoisonProtectionAt = this.time; this.exitVehicle(p, true); }
      v.seats[SEATS[i]] = 0;
    }
    this.burst(v.x, v.y, 30, '#ffb347', 260, 0.8, 7);
    this.smoke(v.x, v.y, 16, '#555b62', 28, 1.6, 130);
    this.emit({ type: 'vehicle', op: 'wreck', vehicle: v, source: src, cause: cause });
    return true;
  };
  World.prototype.damageVehiclesMatching = function (test, amount, sourceId, cause, options) {
    if (this.remote) return;
    options = options || {};
    var src = sourceId ? this.playerById(sourceId) : null, team = options.team === undefined ? (src ? src.team : null) : options.team;
    var list = (this.vehicles || []).filter(function (v) { return !v.wreck && test(v); });
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!options.friendly && team !== null && this.vehicleTeam(v) === team && !(src && src.vehicle === v.id)) continue;
      this.damageVehicle(v, typeof amount === 'function' ? amount(v) : amount, sourceId, cause, v.x, v.y - v.r);
    }
  };
  World.prototype.damageVehiclesInArea = function (x, y, radius, amount, sourceId, cause, options) {
    var self = this;
    this.damageVehiclesMatching(function (v) {
      return Math.hypot(v.x - x, v.y - y) - v.r < radius && (!(options && options.lineOfSight) || self.lineClear(x, y, v.x, v.y, v));
    }, amount, sourceId, cause, options);
  };
  World.prototype.damageVehiclesInStorm = function (storm, amount) {
    this.damageVehiclesMatching(function (v) { return storm.r <= 0 || Math.hypot(v.x - storm.x, v.y - storm.y) > storm.r; }, amount, null, 'storm', { friendly: true });
  };
  World.prototype.updateVehicleSnow = function (dt) {
    for (var i = 0; i < this.vehicles.length; i++) {
      var v = this.vehicles[i];
      if (v.wreck) continue;
      var snowDamage = 0, baseDps = Math.max(W.ItemRules.SNOW_MIN_DPS, this.storm ? this.storm.dps : 0);
      this.zones.forEach(function (z) {
        if (z.kind === 'snow' && Math.hypot(v.x - z.x, v.y - z.y) < z.r + v.r) snowDamage = Math.max(snowDamage, z.dps === undefined ? baseDps * (z.damageMul === undefined ? 1 : z.damageMul) : z.dps);
      });
      if (!snowDamage) { v.snowT = 0; v.snowTick = 0; continue; }
      v.snowT += dt;
      if (v.snowT < W.ITEMS.snowbomb.graceTime) continue;
      v.snowTick -= dt;
      if (v.snowTick > 0) continue;
      v.snowTick += W.ItemRules.SNOW_TICK;
      this.damageVehicle(v, snowDamage * W.ItemRules.SNOW_TICK, null, 'snow');
    }
  };

  // Direct API calls obey the same restriction as the input path; seat occupants never use personal gear.
  ['trigger', 'useUtility', 'useMedkit', 'throwGrenade', 'useHeld', 'consumeItem', 'throwItem', 'placeItem', 'targetItem', 'activateItem', 'upgrade', 'switchSlot', 'startReload'].forEach(function (name) {
    var base = World.prototype[name];
    if (!base) return;
    World.prototype[name] = function (p) { if (p && p.vehicle) return false; return base.apply(this, arguments); };
  });
  W.VEHICLE_SEATS = SEATS;
}());
