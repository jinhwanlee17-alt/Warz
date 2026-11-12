/* Level-three Engineer construction, shared by Practice and the authoritative server. */
(function () {
  'use strict';
  var W = window.Warz, World = W.World, U = W.U;
  var baseUpdate = World.prototype.updateClassCombat, baseTrigger = World.prototype.trigger;

  World.prototype.cancelSentryBuild = function (p) { p.sentryBuild = null; };
  World.prototype.sentryBuildSpot = function (p, intent) {
    var def = W.WEAPONS.wrench, reach = def.range, r = W.STRUCT_RADIUS.sentry;
    var ax = intent.aimX, ay = intent.aimY;
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
      ax = p.x + Math.cos(p.angle) * reach * 0.6;
      ay = p.y + Math.sin(p.angle) * reach * 0.6;
    }
    var dx = ax - p.x, dy = ay - p.y, d = Math.hypot(dx, dy);
    var angle = d > 0 ? Math.atan2(dy, dx) : p.angle;
    d = U.clamp(d, p.r + r + 8, reach);
    return { elapsed: 0, x: p.x + Math.cos(angle) * d, y: p.y + Math.sin(angle) * d };
  };
  World.prototype.sentryBuildSpotClear = function (p, at) {
    var reach = W.WEAPONS.wrench.range;
    if (Math.hypot(at.x - p.x, at.y - p.y) > reach + 0.000001 ||
        !this.spotFree(at.x, at.y, W.STRUCT_RADIUS.sentry, false) || !this.lineClear(p.x, p.y, at.x, at.y)) return false;
    // Crates are transparent to normal lineClear, but a wrench cannot reach through one.
    for (var i = 0; i < this.map.crates.length; i++) {
      var c = this.map.crates[i];
      if (c.alive && U.segRect(p.x, p.y, at.x, at.y, c.x - c.size / 2, c.y - c.size / 2, c.size, c.size) >= 0) return false;
    }
    return true;
  };
  World.prototype.updateSentryBuild = function (p, intent, dt) {
    if (this.remote) return;
    var weapon = p.weapons[p.slot], def = W.WEAPONS.wrench;
    var changing = (intent.slot !== undefined && intent.slot !== null && intent.slot !== p.slot) || intent.cycle || intent.swap ||
      (intent.held !== undefined && intent.held !== null && intent.held >= 0) || intent.interactPressed || intent.dropPressed;
    if (p.classId !== 'engineer' || !p.alive || p.downed || p.mount || p.vehicle || p.dropT > 0 || p.held >= 0 ||
        !weapon || weapon.id !== 'wrench' || changing || !(intent.fire || intent.firePressed)) {
      this.cancelSentryBuild(p); return;
    }
    var at = p.sentryBuild || this.sentryBuildSpot(p, intent);
    if (!this.sentryBuildSpotClear(p, at)) {
      this.cancelSentryBuild(p);
      if (intent.firePressed) this.emit({ type: 'deny', player: p, reason: 'blocked' });
      return;
    }
    p.sentryBuild = at;
    at.elapsed = Math.min(def.buildSeconds, at.elapsed + dt);
    if (at.elapsed + 0.00000001 < def.buildSeconds) return;
    var item = W.ITEMS.sentry;
    this.addStruct({ kind: 'sentry', item: 'sentry', x: at.x, y: at.y, r: W.STRUCT_RADIUS.sentry,
      owner: p.id, team: p.team, hp: item.hp, maxHp: item.hp, angle: p.angle });
    this.cancelSentryBuild(p);
  };
  World.prototype.updateClassCombat = function (p, intent, dt) {
    baseUpdate.call(this, p, intent, dt);
    this.updateSentryBuild(p, intent, dt);
  };
  World.prototype.trigger = function (p, intent) {
    var weapon = p.weapons[p.slot];
    if (weapon && weapon.id === 'wrench') return !!p.sentryBuild;
    return baseTrigger.call(this, p, intent);
  };

  // Clear progress immediately for direct API actions as well as their input-driven paths.
  ['setClass', 'downPlayer', 'killPlayer'].forEach(function (name) {
    var base = World.prototype[name];
    World.prototype[name] = function (p) { this.cancelSentryBuild(p); return base.apply(this, arguments); };
  });
  ['switchSlot', 'selectItem', 'enterVehicle', 'mountTurret'].forEach(function (name) {
    var base = World.prototype[name];
    World.prototype[name] = function (p) {
      var result = base.apply(this, arguments);
      if (p.vehicle || p.mount || p.held >= 0 || !p.weapons[p.slot] || p.weapons[p.slot].id !== 'wrench') this.cancelSentryBuild(p);
      return result;
    };
  });
}());
