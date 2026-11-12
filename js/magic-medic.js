/* Magic Medic: shared authoritative healing, portable staff and overhealing medkit. */
(function () {
  'use strict';
  var W = window.Warz, World = W.World, U = W.U, EPS = 1e-8;
  var HELD = [[10, 1], [10, 2], [5, 3], [3, 10], [5, 25]];
  var PLACED = [[5, 1], [5, 2], [2, 3], [5, 10], [5, 25], [30, 50]];
  var baseUpdate = World.prototype.updateClassCombat, baseTrigger = World.prototype.trigger;
  var baseKit = World.prototype.useMedkit, baseInteract = World.prototype.pressInteract, baseUtility = World.prototype.useUtility;
  var baseClass = World.prototype.setClass;

  function duration(placed) { return placed ? 52 : 33; }
  function detached(p) { return !!(p && p.net && !p.bot && !p.net.conn); }
  function stage(s) {
    var schedule = s.placed ? PLACED : HELD, elapsed = s.elapsed || 0;
    for (var i = 0; i < schedule.length; i++) {
      if (elapsed < schedule[i][0] - EPS) return { index: i, rate: schedule[i][1], remaining: schedule[i][0] - elapsed };
      elapsed -= schedule[i][0];
    }
    return { index: schedule.length, rate: 0, remaining: 0 };
  }
  function fresh(p) { return { placed: false, x: p.x, y: p.y, elapsed: 0, recharge: 0, active: false, target: 0, rate: 0 }; }
  function changeMode(s, placed) {
    if (s.placed !== placed) s.elapsed = 0;
    s.placed = placed; s.active = false; s.target = 0; s.rate = 0;
  }
  W.MedicStaff = {
    heldSchedule: HELD, placedSchedule: PLACED, rechargeSeconds: 25, pickupRange: 90,
    heldRadius: W.WEAPONS.grenade.explosion.radius, placedRadius: W.ITEMS.firenade.radius,
    status: function (p) {
      var s = p && p.medicStaff;
      if (!s) return null;
      return { placed: !!s.placed, x: s.x, y: s.y, elapsed: s.elapsed || 0, duration: duration(s.placed),
        recharge: s.recharge || 0, rate: s.recharge > EPS ? 0 : stage(s).rate,
        radius: s.placed ? W.ITEMS.firenade.radius : W.WEAPONS.grenade.explosion.radius,
        active: !!s.active, target: s.target || 0 };
    }
  };
  World.prototype.setClass = function (p, id, isFresh) {
    var previous = p.classId, old = p.medicStaff;
    var result = baseClass.apply(this, arguments);
    p.medicStaff = id === 'magicmedic' ? (!isFresh && previous === id && old ? old : fresh(p)) : null;
    p.medicHealPending = {}; p.medicHealTimer = 0;
    return result;
  };
  World.prototype.placedMedicStaffs = function () {
    if (this.remote) return this.medicStaffMarkers || [];
    var markers = [];
    this.players.forEach(function (p) {
      if (p.classId !== 'magicmedic' || !p.alive || p.downed || !p.medicStaff || !p.medicStaff.placed) return;
      markers.push(Object.assign({ owner: p.id, team: p.team }, W.MedicStaff.status(p)));
    });
    return markers;
  };
  World.prototype.nearestMedicStaff = function (p) {
    if (!p || p.classId !== 'magicmedic' || !p.alive || p.downed || p.mount || p.vehicle || p.dropT > 0) return null;
    var marker = this.placedMedicStaffs().find(function (s) { return s.owner === p.id; });
    return marker && Math.hypot(marker.x - p.x, marker.y - p.y) <= W.MedicStaff.pickupRange &&
      this.lineClear(p.x, p.y, marker.x, marker.y) ? marker : null;
  };
  World.prototype.pickupMedicStaff = function (p) {
    if (this.remote || detached(p) || !this.nearestMedicStaff(p) || !p.medicStaff) return false;
    this.recallMedicStaff(p);
    var slot = p.weapons.findIndex(function (w) { return w.id === 'medicstaff'; });
    if (slot >= 0) this.switchSlot(p, slot);
    return true;
  };
  World.prototype.recallMedicStaff = function (p) {
    if (!p || !p.medicStaff) return;
    changeMode(p.medicStaff, false); p.medicStaff.x = p.x; p.medicStaff.y = p.y;
  };
  World.prototype.placeMedicStaff = function (p, intent) {
    if (this.remote || !p || detached(p) || p.classId !== 'magicmedic' || !p.alive || p.downed || p.mount || p.vehicle || p.dropT > 0 || p.held >= 0 ||
        !p.weapons[p.slot] || p.weapons[p.slot].id !== 'medicstaff' || !p.medicStaff || p.medicStaff.placed) return false;
    intent = intent || {};
    var ax = Number.isFinite(intent.aimX) ? intent.aimX : p.x + Math.cos(p.angle) * 60;
    var ay = Number.isFinite(intent.aimY) ? intent.aimY : p.y + Math.sin(p.angle) * 60;
    var d = Math.hypot(ax - p.x, ay - p.y), angle = d > EPS ? Math.atan2(ay - p.y, ax - p.x) : p.angle;
    d = U.clamp(d, p.r + 18, W.WEAPONS.medicstaff.range);
    var x = p.x + Math.cos(angle) * d, y = p.y + Math.sin(angle) * d;
    var clear = this.spotFree(x, y, 12, false) && this.lineClear(p.x, p.y, x, y);
    for (var i = 0; clear && i < this.map.crates.length; i++) {
      var c = this.map.crates[i];
      if (c.alive && U.segRect(p.x, p.y, x, y, c.x - c.size / 2, c.y - c.size / 2, c.size, c.size) >= 0) clear = false;
    }
    if (!clear) { this.emit({ type: 'deny', player: p, reason: 'blocked' }); return false; }
    changeMode(p.medicStaff, true); p.medicStaff.x = x; p.medicStaff.y = y;
    return true;
  };
  World.prototype.pressInteract = function (p) {
    var reviving = this.teams && p && this.teammates(p).some(function (o) {
      return o.alive && o.downed && Math.hypot(o.x - p.x, o.y - p.y) <= 70 + p.r;
    });
    if (!reviving && this.pickupMedicStaff(p)) return true;
    var patient = !reviving && this.nearestMedicPatient(p);
    if (patient) return this.useMedkit(p, null, patient);
    return baseInteract.apply(this, arguments);
  };
  World.prototype.trigger = function (p, intent) {
    var weapon = p.weapons[p.slot];
    if (weapon && weapon.id === 'medicstaff') return !!intent.firePressed && this.placeMedicStaff(p, intent);
    if (weapon && weapon.id === 'magicmedkit') return !!intent.firePressed && this.useMedkit(p, intent);
    return baseTrigger.apply(this, arguments);
  };
  World.prototype.useUtility = function (p, intent) {
    if (p.classId === 'magicmedic') return this.useMedkit(p, intent);
    return baseUtility.apply(this, arguments);
  };
  World.prototype.nearestMedicPatient = function (p) {
    if (!p || p.classId !== 'magicmedic' || !p.alive || p.downed || p.mount || p.vehicle || p.dropT > 0 || p.held >= 0 ||
        !p.weapons[p.slot] || p.weapons[p.slot].id !== 'magicmedkit') return null;
    var best = null, distance = 90 + EPS, self = this;
    this.teammates(p).forEach(function (o) {
      var d = Math.hypot(o.x - p.x, o.y - p.y);
      if (o.alive && !o.downed && o.dropT <= 0 && d < distance && self.lineClear(p.x, p.y, o.x, o.y)) { best = o; distance = d; }
    });
    return best;
  };
  World.prototype.useMedkit = function (p, intent, selected) {
    if (!p || p.classId !== 'magicmedic') return baseKit.apply(this, arguments);
    if (this.remote || detached(p) || !p.alive || p.downed || p.mount || p.vehicle || p.dropT > 0 ||
        !p.weapons.some(function (w) { return w.id === 'magicmedkit'; })) return false;
    if (p.medkitCd > EPS) { this.emit({ type: 'deny', player: p, reason: 'medkit', value: p.medkitCd }); return false; }
    var kit = W.WEAPONS.magicmedkit, target = selected || p, self = this;
    if (!selected && intent && Number.isFinite(intent.aimX) && Number.isFinite(intent.aimY)) {
      var distance = Infinity;
      this.teammates(p).forEach(function (o) {
        var d = Math.hypot(o.x - intent.aimX, o.y - intent.aimY);
        if (o.alive && !o.downed && o.dropT <= 0 && d <= o.r + 12 && d < distance) { target = o; distance = d; }
      });
    }
    if (!target.alive || target.downed || target.team !== p.team || target.dropT > 0 ||
        Math.hypot(target.x - p.x, target.y - p.y) > kit.range || !this.lineClear(p.x, p.y, target.x, target.y)) {
      this.emit({ type: 'deny', player: p, reason: 'notarget' }); return false;
    }
    p.medkitCd = kit.cooldown;
    target.hp += kit.heal; p.stats.healed += kit.heal;
    self.healFx(target, kit.heal); self.emit({ type: 'heal', player: target, by: p, amount: kit.heal, item: 'magicmedkit' });
    if (p.weapons[p.slot].id === 'magicmedkit') this.switchSlot(p, p.lastSlot !== p.slot ? p.lastSlot : 0);
    return true;
  };
  World.prototype.medicStaffPatients = function (p) {
    var s = p.medicStaff, at = s.placed ? s : p;
    var radius = s.placed ? W.ITEMS.firenade.radius : W.WEAPONS.grenade.explosion.radius;
    var targets = this.players.filter(function (o) {
      return (s.placed || o !== p) && o.team === p.team && o.alive && !o.downed && o.dropT <= 0 &&
        o.hp < o.maxHp - EPS && Math.hypot(o.x - at.x, o.y - at.y) <= radius;
    });
    if (s.placed) return targets;
    targets.sort(function (a, b) { return a.hp / a.maxHp - b.hp / b.maxHp || a.id - b.id; });
    return targets.slice(0, 1);
  };
  World.prototype.flushMedicHealing = function (p) {
    var pending = p.medicHealPending || {}, carry = {}, self = this;
    Object.keys(pending).forEach(function (id) {
      var o = self.playerById(Number(id)), amount = pending[id];
      if (!o || !o.alive || !(amount > EPS)) return;
      // Sharing a low-rate stage can heal less than half a point per second.
      // Keep that feedback credit until its rounded label would be meaningful.
      if (amount < 0.5) { carry[id] = amount; return; }
      self.healFx(o, amount); self.emit({ type: 'heal', player: o, by: p, amount: amount, item: 'medicstaff' });
    });
    p.medicHealPending = carry; p.medicHealTimer = 0;
  };
  World.prototype.updateMedicStaff = function (p, intent, dt) {
    if (this.remote || !p.medicStaff || p.classId !== 'magicmedic') return;
    var s = p.medicStaff;
    s.active = false; s.target = 0; s.rate = 0;
    if (!p.alive || p.downed || p.dropT > 0) return;
    p.medicHealTimer = (p.medicHealTimer || 0) + dt;
    var remaining = dt;
    if (s.recharge > EPS) {
      var rest = Math.min(remaining, s.recharge); s.recharge = Math.max(0, s.recharge - rest); remaining -= rest;
      if (s.recharge <= EPS) { s.recharge = 0; s.elapsed = 0; }
    }
    if (!s.placed) { s.x = p.x; s.y = p.y; }
    var changing = intent.cycle || intent.swap || intent.interactPressed || intent.dropPressed ||
      (intent.slot !== undefined && intent.slot !== null && intent.slot !== p.slot) ||
      (intent.held !== undefined && intent.held !== null && intent.held >= 0);
    var equipped = !p.mount && !p.vehicle && p.held < 0 && p.weapons[p.slot] && p.weapons[p.slot].id === 'medicstaff' && !changing;
    if (!detached(p) && (s.placed || equipped)) {
      // Split at stage/full-health boundaries so fractional ticks neither lose healing
      // nor skip a stage. A full-health squad does not drain the staff's charge.
      while (remaining > EPS && s.recharge <= EPS) {
        var current = stage(s), patients = this.medicStaffPatients(p);
        if (!current.rate || !patients.length) break;
        var share = current.rate / patients.length;
        var step = Math.min(remaining, current.remaining);
        patients.forEach(function (o) { step = Math.min(step, (o.maxHp - o.hp) / share); });
        if (!(step > EPS)) break;
        s.active = true; s.target = s.placed ? 0 : patients[0].id; s.rate = current.rate;
        p.medicHealPending = p.medicHealPending || {};
        patients.forEach(function (o) {
          var healed = Math.min(o.maxHp - o.hp, share * step);
          o.hp += healed; o.healFlash = Math.max(o.healFlash || 0, 0.3); p.stats.healed += healed;
          p.medicHealPending[o.id] = (p.medicHealPending[o.id] || 0) + healed;
        });
        s.elapsed += step; remaining -= step;
        if (s.elapsed >= duration(s.placed) - EPS) {
          s.elapsed = 0; s.recharge = W.MedicStaff.rechargeSeconds;
          s.active = false; s.target = 0; s.rate = 0;
          var cooldownStep = Math.min(remaining, s.recharge);
          s.recharge -= cooldownStep; remaining -= cooldownStep;
        }
      }
    }
    if (p.medicHealTimer >= 1 - EPS) this.flushMedicHealing(p);
  };
  World.prototype.updateClassCombat = function (p, intent, dt) {
    baseUpdate.call(this, p, intent, dt); this.updateMedicStaff(p, intent, dt);
  };
  ['downPlayer', 'killPlayer'].forEach(function (name) {
    var base = World.prototype[name];
    World.prototype[name] = function (p) {
      var result = base.apply(this, arguments);
      if (p.medicStaff && (p.downed || !p.alive)) {
        this.recallMedicStaff(p);
        if (!p.alive) p.medicStaff = null;
        p.medicHealPending = {}; p.medicHealTimer = 0;
      }
      return result;
    };
  });
}());
