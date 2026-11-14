/* Mobile and anchored artillery: authoritative deployment, indirect shells and matching client effects. */
(function () {
  'use strict';
  var W = window.Warz, World = W.World, U = W.U, A = W.ARTILLERY, EPS = 1e-8;
  W.WEAPONS.rpg.vehicleDamage.artillery = Object.assign({}, W.WEAPONS.rpg.vehicleDamage.tank);
  if (W.SENTRY_IV) W.SENTRY_IV.rockets.vehicleBlast.artillery = Object.assign({}, W.SENTRY_IV.rockets.vehicleBlast.tank);
  var init = World.prototype.initVehicles, update = World.prototype.updateVehicles;
  var drive = World.prototype.driveVehicle, playerUpdate = World.prototype.updateVehiclePlayer;
  var weaponFor = World.prototype.vehicleWeaponFor, shield = World.prototype.shieldBlocks;
  World.prototype.initVehicles = function () {
    init.apply(this, arguments); this.artilleryShells = []; this.nextArtilleryShellId = 1;
  };
  World.prototype.vehicleWeaponFor = function (p) {
    var v = p && this.vehicleById(p.vehicle);
    if (v && v.type === 'artillery') return !v.wreck && v.seats.driver === p.id && p.vehicleWeapon === 1 ? 'artillery' : null;
    return weaponFor.apply(this, arguments);
  };
  World.prototype.updateVehiclePlayer = function (p, intent) {
    var v = this.vehicleById(p.vehicle);
    if (!v || v.type !== 'artillery') return playerUpdate.apply(this, arguments);
    playerUpdate.apply(this, arguments);
    if (p.vehicle !== v.id || p.vehicleSeat !== 'driver') return;
    if (intent.slot === 0 || intent.slot === 1) p.vehicleWeapon = intent.slot;
    p.vehicleIntent = Object.assign({}, intent, p.vehicleWeapon === 1 ? { mx: 0, my: 0 } : {});
    if (p.vehicleWeapon === 1 && Number.isFinite(intent.aimX) && Number.isFinite(intent.aimY)) {
      v.targetX = U.clamp(intent.aimX, 0, W.CONFIG.worldSize); v.targetY = U.clamp(intent.aimY, 0, W.CONFIG.worldSize);
      v.cannonAngle = Math.atan2(v.targetY - v.y, v.targetX - v.x);
    }
  };
  World.prototype.driveVehicle = function (v, intent, dt) {
    if (!v || v.type !== 'artillery') return drive.apply(this, arguments);
    // Guard both authority and input replay, including stale incoming velocity.
    // A fixed cannon must never enter steering, crate crushing or rock ramming.
    if (v.fixed) { v.vx = v.vy = 0; v.artilleryMoving = false; return; }
    var p = this.playerById(v.seats.driver), oldX = v.x, oldY = v.y;
    drive.call(this, v, p && p.vehicleWeapon === 1 ? { mx: 0, my: 0 } : intent, dt);
    if (!this.remote) v.artilleryMoving = Math.hypot(v.x - oldX, v.y - oldY) > .001 || Math.hypot(v.vx, v.vy) > .1;
  };
  World.prototype.artilleryReady = function (v) {
    return !!v && v.type === 'artillery' && !v.wreck && v.stationaryT >= A.stationarySeconds - EPS && v.artilleryCooldown <= EPS;
  };
  World.prototype.updateArtilleryWeapons = function (v, dt) {
    v.stationaryT = v.artilleryMoving ? 0 : Math.min(A.stationarySeconds, (v.stationaryT || 0) + dt);
    v.artilleryCooldown = Math.max(0, (v.artilleryCooldown || 0) - this.vehicleSentryWeaponTime(v, dt));
    var p = this.playerById(v.seats.driver), input = p && p.vehicleIntent;
    if (p && input && input.artilleryFire) this.fireArtillery(p, v, input.aimX, input.aimY);
  };
  World.prototype.fireArtillery = function (p, v, x, y) {
    if (this.remote || !p || !p.alive || p.downed || p.dropT > 0 || p.vehicle !== v.id || v.seats.driver !== p.id || p.vehicleWeapon !== 1 ||
        (p.net && !p.bot && !p.net.conn) || !this.artilleryReady(v) || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > W.CONFIG.worldSize || y > W.CONFIG.worldSize) return false;
    var distance = Math.hypot(x - v.x, y - v.y), crew = p.classId === 'armorcrew';
    // Capture the operator's bonuses at launch so a seat/class change cannot
    // retime an in-flight shell or reset the reload already in progress.
    var flightTime = U.clamp(2 + distance / W.CONFIG.worldSize * 2, 2, 4) / (crew ? W.ARMOR_CREW.artilleryShellSpeedMul : 1);
    var shell = this.spawnArtilleryShell({ owner: p.id, team: p.team, vehicle: v.id, x: v.x, y: v.y, startX: v.x, startY: v.y,
      targetX: x, targetY: y, elapsed: 0, flightTime: flightTime });
    v.artilleryCooldown = A.fireInterval - (crew ? W.ARMOR_CREW.artilleryIntervalReduction : 0); v.cannonFlash = 1; p.stats.shots++;
    this.emit({ type: 'artillery-shell', op: 'spawn', shell: Object.assign({}, shell), x: v.x, y: v.y, player: p });
    return true;
  };
  World.prototype.spawnArtilleryShell = function (o) {
    this.artilleryShells = this.artilleryShells || [];
    var shell = Object.assign({ id: this.nextArtilleryShellId++, elapsed: 0, flightTime: 3 }, o);
    this.nextArtilleryShellId = Math.max(this.nextArtilleryShellId || 1, shell.id + 1);
    if (!this.artilleryShells.some(function (s) { return s.id === shell.id; })) this.artilleryShells.push(shell);
    return shell;
  };
  World.prototype.artilleryImpact = function (shell) {
    var x = shell.targetX, y = shell.targetY, self = this, R = A.blastRadius;
    function damage(distance) { return A.minDamage + (A.maxDamage - A.minDamage) * (1 - U.clamp(distance / R, 0, 1)); }
    if (!this.remote) {
      var owner = this.playerById(shell.owner), team = owner ? owner.team : shell.team;
      // Capture cover before destroying it, so a blast cannot hit twice through a destroyed hull.
      var people = this.players.filter(function (p) { return p.alive && !p.vehicle && p.dropT <= 0 && (p.id === shell.owner || p.team !== team); }).map(function (p) {
        var d = Math.max(0, Math.hypot(p.x - x, p.y - y) - p.r);
        return { p: p, n: d <= R && self.lineClear(x, y, p.x, p.y, p.mount ? self.structById(p.mount) : p) ? damage(d) : 0 };
      });
      var hulls = (this.vehicles || []).filter(function (v) { return !v.wreck && (v.id === shell.vehicle || self.vehicleTeam(v) !== team); }).map(function (v) {
        var d = Math.max(0, Math.hypot(v.x - x, v.y - y) - v.r);
        return { v: v, n: d <= R && self.lineClear(x, y, v.x, v.y, v) ? damage(d) : 0 };
      });
      var objects = [];
      this.solids.query(x - R, y - R, x + R, y + R, function (s) {
        if (s.crate && s.crate.alive) {
          var d = Math.hypot(x - U.clamp(x, s.x, s.x + s.w), y - U.clamp(y, s.y, s.y + s.h));
          if (d <= R && self.lineClear(x, y, s.crate.x, s.crate.y, s.crate)) objects.push({ c: s.crate, n: damage(d) });
        } else if (s.struct && s.struct.alive && s.struct.maxHp && !s.struct.mounted && s.struct.team !== team) {
          var d = Math.max(0, Math.hypot(x - s.x, y - s.y) - s.r);
          if (d <= R && self.lineClear(x, y, s.x, s.y, s.struct)) objects.push({ s: s.struct, n: damage(d) });
        }
      });
      this.damageFoliageInArea(x, y, R, function (plant) { return damage(Math.max(0, Math.hypot(plant.x - x, plant.y - y) - plant.hitRadius)); }, shell.owner, 'artillery');
      this.damageMapRocksInArea(x, y, R, 'artillery', shell.owner, false);
      people.forEach(function (e) { if (e.n) self.damagePlayer(e.p, e.n, shell.owner, 'artillery', e.p.x, e.p.y, { x: x, y: y }); });
      hulls.forEach(function (e) { if (e.n) self.damageVehicle(e.v, e.n, shell.owner, 'artillery', x, y); });
      objects.forEach(function (e) { if (e.c) self.damageCrate(e.c, e.n, shell.owner, e.c.x, e.c.y); else self.damageStruct(e.s, e.n, shell.owner, e.s.x, e.s.y, 'artillery'); });
      this.emit({ type: 'artillery-shell', op: 'impact', shell: Object.assign({}, shell), x: x, y: y });
    }
    this.explosions.push({ x: x, y: y, r: R, t: 0, dur: .85, power: A.maxDamage });
    this.burst(x, y, 42, '#ffbf63', 360, .85, 9); this.smoke(x, y, 20, '#767b7e', 32, 1.5, 140);
    this.emit({ type: 'explosion', x: x, y: y, power: A.maxDamage, owner: shell.owner, cause: 'artillery' });
  };
  World.prototype.shieldBlocks = function (p, x, y, cause) { return cause === 'artillery' ? false : shield.apply(this, arguments); };
  World.prototype.updateVehicles = function (dt) {
    update.apply(this, arguments);
    var self = this;
    this.artilleryShells = (this.artilleryShells || []).filter(function (s) {
      s.elapsed += dt;
      var k = U.clamp(s.elapsed / s.flightTime, 0, 1);
      s.x = U.lerp(s.startX, s.targetX, k); s.y = U.lerp(s.startY, s.targetY, k);
      if (s.elapsed < s.flightTime - EPS) return true;
      if (!self.remote) self.artilleryImpact(s);
      return false;
    });
  };
}());
