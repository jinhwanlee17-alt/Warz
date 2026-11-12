/* warz.io: client side of an online match. Mirrors the server's world: local movement is predicted and
   reconciled, other players are interpolated between snapshots, and server events become the same
   world effects the offline game uses, so the renderer, HUD and sounds need no network knowledge. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, WEAPONS = W.WEAPONS, MatchNet = W.MatchNet, Controls = W.Controls;
  var STEP = 1 / 20, INTERP = 0.1, state = null, cbs = {}, pendingJoin = null;
  var VEHICLE_SEATS = ['driver', 'gunner', 'rearLeft', 'rearRight'];

  function byId(id) { return id && state ? state.world.playerById(id) : null; }
  function freshLatch() { return { fp: false, ch: 0, r: false, sl: null, cy: 0, sw: false, u: false, uch: 0, ht: null, ip: false, dp: false, use: false }; }

  function init(callbacks) { cbs = callbacks || {}; }

  function join(id, ticket, rejoin) {
    pendingJoin = { id: id, ticket: ticket, rejoin: !!rejoin };
    MatchNet.connect(id, ticket, {
      onMessage: onMessage,
      onClose: function (code, reason) {
        var was = pendingJoin;
        pendingJoin = null;
        if (cbs.onClosed) cbs.onClosed(code, reason, was);
      }
    });
  }

  function onMessage(m) {
    switch (m.t) {
      case 'match-start':
        start(m); pendingJoin = null;
        if (W.Locker && W.Locker.get) updateCosmetics(W.Locker.get());
        if (cbs.onStart) cbs.onStart(state);
        break;
      case 'snap': applySnapshot(m); break;
      case 'sync': applySync(m); break;
      case 'storm': applyStorm(m); break;
      case 'practice-player': if (state && state.info.practice) applyPracticeRoster([m.player]); break;
      case 'eliminated': if (state) { state.placement = m.placement; state.result = m; } if (cbs.onEliminated) cbs.onEliminated(m); break;
      case 'spectating': if (cbs.onSpectating) cbs.onSpectating(m); break;
      case 'match-end': if (state) { state.ended = true; state.result = m; if (m.placement) state.placement = m.placement; } if (cbs.onEnd) cbs.onEnd(m); break;
    }
  }

  function leave() { MatchNet.send({ t: 'leave' }); MatchNet.close(); state = null; pendingJoin = null; }
  function stop() { MatchNet.close(); state = null; pendingJoin = null; }

  function start(info) {
    var map = W.MapGen.generate(info.seed, info.teamSize), world = new W.World({ map: map, remote: true, teams: info.teamSize > 1 });
    world.practice = !!info.practice;
    (world.vehicles || []).forEach(function (v) { v.hidden = true; v.snaps = []; v.ox = v.oy = v.oa = 0; });
    info.players.forEach(function (o) {
      var p = world.addPlayer({ id: o.id, name: o.name, team: o.team, color: o.color, outline: o.outline, face: o.face, x: map.size / 2, y: map.size / 2, drop: !info.rejoin, angle: -Math.PI / 2 });
      setEmote(p, o.emote, world);
      p.practiceBot = !!o.practiceBot;
      p.snaps = [];
      p.seenAt = -1;
      // The roster contains identities, not positions. Keep every body out of the
      // world until its first authoritative snapshot (including our own spawn).
      p.hidden = true;
    });
    var me = world.playerById(info.you);
    if (info.cosmetics) world.applyCosmetics(me, info.cosmetics);
    me.isLocal = true;
    me.px = me.x; me.py = me.y;
    state = {
      info: info, world: world, me: me, cam: { x: me.x, y: me.y, zoom: info.rejoin ? 1 : 0.45 }, seq: 0, pending: [], latch: freshLatch(),
      corr: { x: 0, y: 0 }, vehicleCorr: { x: 0, y: 0, a: 0 }, serverTime: info.time || 0, recvAt: performance.now() / 1000, spec: 0,
      alive: info.players.length, teamsAlive: info.teams || 0, placement: null, ended: false, result: null, snapCount: 0,
      practiceSettings: null
    };
    applyPracticeSettings(info.ps);
    return state;
  }

  function applyPracticeRoster(rows) {
    if (!state || !state.info.practice || !Array.isArray(rows)) return;
    rows.forEach(function (o) {
      if (!o || !Number.isInteger(o.id)) return;
      var p = byId(o.id);
      if (!p) {
        p = state.world.addPlayer({ id: o.id, name: o.name, team: o.team, color: o.color, outline: o.outline, face: o.face,
          x: state.world.map.size / 2, y: state.world.map.size / 2 });
        p.snaps = []; p.seenAt = -1; p.hidden = true;
        if (!state.info.players.some(function (row) { return row.id === o.id; })) state.info.players.push(o);
      }
      p.name = o.name; p.team = o.team; p.practiceBot = !!o.practiceBot;
    });
  }
  function applyPracticeSettings(value) {
    if (!state || !state.info.practice || !value) return;
    var changed = JSON.stringify(state.practiceSettings) !== JSON.stringify(value);
    state.practiceSettings = Object.assign({}, value);
    state.world.teams = state.info.teamSize > 1 && !value.friendlyFire;
    if (!value.storm) {
      if (state.world.storm) state.practiceStorm = state.world.storm;
      state.world.storm = null;
      state.world.players.forEach(function (p) { p.inStorm = false; });
    } else if (!state.world.storm) state.world.storm = state.practiceStorm || new W.Storm(state.world);
    if (changed && cbs.onPracticeSettings) cbs.onPracticeSettings(value);
  }

  // ---------------------------------------------------------------- snapshots
  function setEmote(p, value, world) {
    world = world || state.world;
    p.emote = value && W.Cosmetics.emote(value[0]) && typeof value[1] === 'number' && value[1] > 0
      ? { id: value[0], until: world.time + Math.min(W.Cosmetics.EMOTE_DURATION, value[1]) } : null;
  }
  function applyLooks(rows) {
    (rows || []).forEach(function (row) {
      var p = byId(row[0]);
      if (!p) return;
      state.world.applyCosmetics(p, { color: row[1], face: row[2], emotes: p.emotes });
    });
  }
  function setClassIfChanged(p, idx) {
    var cls = W.CLASS_ORDER[idx];
    if (cls && p.classId !== cls) state.world.setClass(p, cls, false);
  }

  function vehicleFor(p) {
    if (!p.vehicle || !state.world.vehicleById) return null;
    var v = state.world.vehicleById(p.vehicle);
    return v && !v.wreck && v.seats[p.vehicleSeat] === p.id ? v : null;
  }

  function applyVehicles(rows, time, driver, sync) {
    if (!rows) return;
    var world = state.world, seen = {};
    world.vehicles = world.vehicles || [];
    // Seat occupancy is a complete authoritative list, including vehicles outside
    // player interest range. Never leave a stale passenger attached to an empty seat.
    world.players.forEach(function (p) { if (p !== state.me) { p.vehicle = 0; p.vehicleSeat = null; } });
    rows.forEach(function (row) {
      var v = world.vehicles.find(function (it) { return it.id === row.id; });
      if (!v) { v = { id: row.id, r: W.VEHICLE.radius, seats: {}, flash: 0, cooldown: 0 }; world.vehicles.push(v); }
      seen[v.id] = true;
      var predicted = v.id === driver && row.seats[0] === state.me.id && !row.wreck, history = v.snaps || [], prev = history.length ? history[history.length - 1] : null;
      if (sync || !!v.predicted !== predicted || !!v.wreck !== !!row.wreck || (prev && (time - prev.t > 0.4 || Math.hypot(prev.x - row.x, prev.y - row.y) > 500))) history = [];
      var next = { t: time, x: row.x, y: row.y, a: row.a, ga: row.ga, ca: row.ca || 0 };
      if (history.length && history[history.length - 1].t === time) history[history.length - 1] = next;
      else history.push(next);
      if (history.length > 16) history.shift();
      v.snaps = history; v.predicted = predicted; v.hidden = false;
      // Speculative crate pass-through belongs only to the unacknowledged
      // movement being replayed from this authoritative vehicle baseline.
      v.predictedCrates = {};
      v.predictedRocks = {};
      v.predictedStructRocks = {};
      v.predictedStructRockDamage = {};
      v.type = row.type || 'humvee';
      v.r = v.type === 'tank' && W.TANK ? W.TANK.radius : W.VEHICLE.radius;
      v.hp = row.hp; v.maxHp = row.mhp; v.wreck = !!row.wreck; v.armed = !!row.armed;
      setSentryStatus(v, row.ss);
      v.pyroBurning = row.py && row.py.burn || 0;
      if (v.type === 'tank') {
        v.cannonCooldown = row.cc || 0; v.cooldown = row.cd || 0;
        v.cannonAmmo = row.cn === undefined ? 1 : row.cn;
        v.cannonMaxAmmo = row.cm === undefined ? 1 : row.cm; v.cannonReload = row.cr || 0;
        v.mgAmmo = row.ma === undefined ? 1000 : row.ma; v.mgReload = row.mr || 0;
      }
      v.vx = row.vx; v.vy = row.vy;
      v.seats = {};
      VEHICLE_SEATS.forEach(function (seat, index) {
        var id = v.wreck ? 0 : row.seats[index] || 0, p = world.playerById(id);
        v.seats[seat] = p ? id : 0;
        if (p && p !== state.me) { p.vehicle = v.id; p.vehicleSeat = seat; }
      });
      if (predicted || history.length === 1) {
        v.x = row.x; v.y = row.y; v.angle = row.a; v.gunAngle = row.ga; v.cannonAngle = row.ca || 0;
        v.px = v.x; v.py = v.y; v.pa = v.angle;
      }
      if (!predicted) v.ox = v.oy = v.oa = 0;
    });
    world.vehicles.forEach(function (v) {
      if (seen[v.id]) return;
      v.hidden = true; v.predicted = false; v.seats = { driver: 0, gunner: 0, rearLeft: 0, rearRight: 0 };
    });
  }

  function predictInput(entry) {
    var world = state.world, me = state.me;
    // Inputs sent before entering/exiting a seat cannot be replayed as another
    // movement mode while their acknowledgments are still in flight.
    if ((entry.vehicle || 0) !== (me.vehicle || 0) || (entry.seat || null) !== (me.vehicleSeat || null)) return;
    var v = vehicleFor(me);
    if (me.vehicle) {
      world.tickStamina(me, { mx: 0, my: 0 }, STEP);
      if (v && me.vehicleSeat === 'driver') { v.px = v.x; v.py = v.y; v.pa = v.angle; world.driveVehicle(v, entry.intent, STEP); world.syncVehicleSeats(v); }
      return;
    }
    world.moveStep(me, entry.intent, STEP);
  }

  function terrainEvent(e) {
    return e.t === 'crate' || e.t === 'rock-gone' || e.t === 'struct';
  }

  function applySnapshot(s) {
    if (!state) return;
    var world = state.world, me = state.me, now = performance.now() / 1000;
    applyPracticeRoster(s.pr);
    applyPracticeSettings(s.ps);
    applyLooks(s.looks);
    var oldVehicle = me.vehicle || 0, oldSeat = me.vehicleSeat || null, oldRide = vehicleFor(me), oldMount = me.mount || 0;
    // Reconciliation preserves its own correction, not the render interpolation
    // offset; counting the latter again would make a healthy driver drift backward.
    var rideX = oldRide ? oldRide.x + state.vehicleCorr.x : 0, rideY = oldRide ? oldRide.y + state.vehicleCorr.y : 0;
    var rideAngle = oldRide ? oldRide.angle + state.vehicleCorr.a : 0;
    state.serverTime = s.time;
    state.recvAt = now;
    state.snapCount++;
    applySentryProjectiles(s.sp);
    applyRpgRockets(s.rp);
    applyMedicStaffMarkers(s.ms);
    // The packet's terrain state must be current before replay: an input sent
    // before a crate broke must not collide with its obsolete client hitbox.
    for (var ci = 0; ci < s.e.length; ci++) if (terrainEvent(s.e[ci])) applyEvent(s.e[ci]);
    if (s.structs) applySentryStructures(s.structs);
    var legendary = world.map.crates[world.map.legendaryCrateId];
    if (legendary && typeof s.lc === 'number' &&
        (legendary.hp !== s.lc || legendary.alive !== (s.lc > 0))) {
      if (s.lc > 0) legendary.alive = true;
      applyEvent({ t: 'crate', id: legendary.id, hp: s.lc, x: legendary.x, y: legendary.y, n: 0, src: 0 });
    }
    var y = s.you;
    applyVehicles(s.vehicles, s.time, y && y.seat === 'driver' ? y.veh : 0, false);
    if (y) {
      if (y.cosmetics) world.applyCosmetics(me, y.cosmetics);
      setEmote(me, y.em);
      me.emoteReadyAt = world.time + U.clamp(y.emcd || 0, 0, W.Cosmetics.EMOTE_COOLDOWN);
      me.seenAt = s.time;
      me.hidden = false;
      setClassIfChanged(me, y.cls);
      var prevX = me.x + state.corr.x, prevY = me.y + state.corr.y;
      me.x = y.x; me.y = y.y; me.vx = y.vx; me.vy = y.vy;
      state.pending = state.pending.filter(function (i) { return i.seq > y.ack; });
      me.alive = y.alive; me.dropT = y.drop; me.downed = y.down; me.downT = y.downT; me.revive = y.rev; me.team = y.team;
      me.hp = y.hp; me.maxHp = y.mhp; me.armor = y.ar; me.tokens = y.tok; me.keys = y.keys;
      me.upgradeFrom = y.from || null;
      me.upgradePath = Array.isArray(y.path) ? y.path.filter(function (id) { return !!W.CLASSES[id]; }) : [];
      setSentryBuild(me, y.sb);
      setMedicStaff(me, y.ms);
      setPyroState(me, y.py);
      me.sentryWork = y.sw || null; me.sentryChoice = y.sch || null;
      setSentryStatus(me, y.ss);
      me.slot = y.slot;
      me.weapons.forEach(function (w, i) {
        if (y.ammo[i] !== undefined) w.ammo = y.ammo[i];
        var rel = y.rel[i] || 0;
        w.reloading = rel > 0;
        w.reloadT = rel;
      });
      me.grenades = y.gren; me.medkitCd = y.med; me.scoping = y.sc; me.inStorm = !!y.storm;
      me.commandCd = y.cmd || 0; me.commandBuff = y.cb || 0; me.minigunSpin = y.spin || 0; me.flameTicks = y.ft || 0;
      me.nearStation = y.near >= 0 ? world.map.stations[y.near] : null;
      // Inventory, held item, turret mount and potion timers: the server owns them, prediction only reads them.
      if (y.items) me.items = y.items.map(function (s) { return s ? { id: s[0], n: s[1] } : null; });
      me.held = y.held === undefined ? -1 : y.held;
      var changedSeat = oldVehicle !== (y.veh || 0) || oldSeat !== (y.seat || null);
      if (me.mount !== (y.mnt || 0) || changedSeat) {
        // A click queued for one weapon must not fire after mounting or dismounting.
        state.latch.fp = false; state.latch.ch = 0;
        state.latch.u = false; state.latch.uch = 0; state.latch.use = false;
        if (changedSeat) state.latch = freshLatch();
      }
      me.mount = y.mnt || 0;
      me.vehicle = y.veh || 0; me.vehicleSeat = y.seat || null;
      me.vehicleWeapon = y.vw || 0;
      me.repairVehicle = y.rv || 0;
      if (me.vehicle && !vehicleFor(me)) { me.vehicle = 0; me.vehicleSeat = null; changedSeat = true; }
      if (changedSeat) me.ox = me.oy = 0;
      if (y.fx) for (var fi = 0; fi < W.FX_KEYS.length; fi++) me.fx[W.FX_KEYS[fi]] = y.fx[fi] || 0;
      me.regen = y.rg || 0;
      me.tpProgress = y.tp || 0;
      world.refreshShield(me);
      world.reveal[me.team] = y.dr || 0;
      // Restore authoritative stamina and every speed/mount modifier before replay. Replaying
      // unacknowledged input from this baseline cannot drain the same frame a second time.
      me.stamina = typeof y.stam === 'number' ? U.clamp(y.stam, 0, W.CONFIG.staminaMax) : W.CONFIG.staminaMax;
      me.sprintExhausted = !!y.exh;
      me.sprintRestT = U.clamp(y.rest || 0, 0, W.CONFIG.staminaRestDelay);
      me.sprinting = !!y.spr;
      if (me.alive && me.dropT <= 0) state.pending.forEach(predictInput);
      // Fold the correction into a visual offset that decays, so small mispredictions never pop.
      var ex = prevX - me.x, ey = prevY - me.y;
      if (!changedSeat && oldMount === me.mount && !me.vehicle && state.snapCount > 1 && Math.abs(ex) + Math.abs(ey) < 140) { state.corr.x = ex; state.corr.y = ey; } else { state.corr.x = 0; state.corr.y = 0; }
      var ride = vehicleFor(me), vc = state.vehicleCorr;
      if (ride && me.vehicleSeat === 'driver' && !changedSeat && Math.abs(rideX - ride.x) + Math.abs(rideY - ride.y) < 240) {
        vc.x = rideX - ride.x; vc.y = rideY - ride.y;
        var angleError = U.angleDiff(ride.angle, rideAngle);
        vc.a = Math.abs(angleError) < Math.PI / 2 ? angleError : 0;
      } else { vc.x = 0; vc.y = 0; vc.a = 0; }
      if (ride) world.syncVehicleSeats(ride);
      me.px = me.x; me.py = me.y;
    }
    // Revealed repairers are included even outside normal view. Clear their old
    // marker state when they leave this viewer's authoritative interest set.
    world.players.forEach(function (p) { if (p !== me) { p.repairVehicle = 0; p.sentryBuild = null; } });
    for (var i = 0; i < s.p.length; i++) {
      var a = s.p[i], p = world.playerById(a[0]);
      if (!p || p === me) continue;
      pushSnap(p, s.time, a);
    }
    state.spec = s.spec || 0;
    state.alive = s.alive;
    state.teamsAlive = s.teams;
    // Global events can refer to players outside our interest range. Hide stale
    // bodies before applying those events, not only on the next render frame.
    world.players.forEach(updatePresence);
    for (var k = 0; k < s.e.length; k++) if (!terrainEvent(s.e[k])) applyEvent(s.e[k]);
    // Events can contain a knock, revive and heal from the same tick. Their
    // feedback must not replace the final health already sent by the authority.
    if (y) me.hp = y.hp;
    s.p.forEach(function (row) { var other = byId(row[0]); if (other && other !== me) other.hp = row[4]; });
  }

  function updatePresence(p) {
    if (p === state.me) return;
    p.hidden = p.seenAt < 0 || (p.team !== state.me.team && state.serverTime - p.seenAt > 0.4);
  }

  function pushSnap(p, time, a) {
    var prev = p.snaps.length ? p.snaps[p.snaps.length - 1] : null;
    var changedSeat = prev && ((prev.vehicle || 0) !== (a[16] || 0) || (prev.seat || null) !== (a[17] || null));
    var changedMount = prev && !!prev.mounted !== !!(a[8] & 32);
    // Reappearing players start at the newly received position rather than
    // blending from an old body that left our view or turned invisible.
    if (prev && (changedSeat || changedMount || p.hidden || time - prev.t > 0.4 || Math.hypot(prev.x - a[1], prev.y - a[2]) > 500)) p.snaps.length = 0;
    if (changedSeat || changedMount) p.ox = p.oy = 0;
    p.snaps.push({ t: time, x: a[1], y: a[2], a: a[3], vehicle: a[16] || 0, seat: a[17] || null, mounted: !!(a[8] & 32) });
    if (p.snaps.length > 16) p.snaps.shift();
    p.seenAt = time;
    p.hidden = false;
    setEmote(p, a[20]);
    setClassIfChanged(p, a[6]);
    p.hp = a[4]; p.maxHp = a[5];
    setSentryBuild(p, a[21]);
    setMedicStaff(p, a[22] && a[22].staff);
    setPyroState(p, a[22] && a[22].py);
    if (a[22] && a[22].team !== undefined) p.team = a[22].team;
    if (a[22] && a[22].practiceBot !== undefined) p.practiceBot = !!a[22].practiceBot;
    p.sentryWork = a[22] && a[22].work || null;
    setSentryStatus(p, a[22] && a[22].status);
    p.slot = a[7];
    var f = a[8], alive = !!(f & 1);
    if (p.alive && !alive) p.deadT = 0;
    p.alive = alive;
    p.downed = !!(f & 2); p.scoping = !!(f & 4); p.inStorm = !!(f & 16);
    if (p.weapons[p.slot]) p.weapons[p.slot].reloading = !!(f & 8);
    p.mount = (f & 32) ? (p.mount || -1) : 0;
    p.fx.invisible = (f & 64) ? 1 : 0;
    p.shieldUp = !!(f & 128);
    // Other players' hotbars stay private; only what they hold is shown (slot 0 of a stand-in list).
    var heldId = a[12] ? W.ITEM_ORDER[a[12] - 1] : null;
    p.items[0] = heldId ? { id: heldId, n: 1 } : null;
    p.held = heldId || (a[22] && a[22].empty) ? 0 : -1;
    p.dropT = a[9]; p.downT = a[10]; p.revive = a[11];
    p.minigunSpin = a[13] || 0; p.commandBuff = a[14] || 0; p.flameTicks = a[15] || 0;
    if (a.length > 16) {
      p.vehicle = a[16] || 0; p.vehicleSeat = a[17] || null;
      p.vehicleWeapon = a[18] || 0;
      p.repairVehicle = a[19] || 0;
      if (p.vehicle && !vehicleFor(p)) { p.vehicle = 0; p.vehicleSeat = null; }
    }
    if (p.snaps.length === 1) { p.x = a[1]; p.y = a[2]; p.angle = a[3]; }
  }

  function setSentryBuild(p, row) {
    p.sentryBuild = Array.isArray(row) && row.length === 3 && row.every(Number.isFinite)
      ? { elapsed: U.clamp(row[0], 0, W.WEAPONS.wrench.buildSeconds), x: row[1], y: row[2] } : null;
  }
  function setMedicStaff(p, value) {
    p.medicStaff = p.classId === 'magicmedic' && value ? Object.assign({}, value) : null;
  }
  function setPyroState(p, value) {
    if (state.world.applyPyroFiregun) state.world.applyPyroFiregun(p, !!(value && value.up));
    p.pyroHeat = value && value.heat || 0;
    p.pyroBurning = value && value.burn || 0;
    p.pyroFireBar = value && Number.isFinite(value.fire) ? U.clamp(value.fire, 0, W.Pyro ? W.Pyro.fireBarMax : 50) : p.classId === 'pyromaniac' ? (W.Pyro ? W.Pyro.fireBarMax : 50) : 0;
    p.pyroFireResetT = value && Number.isFinite(value.reset) ? U.clamp(value.reset, 0, W.Pyro ? W.Pyro.fireWindow : 60) : 0;
  }
  function applyMedicStaffMarkers(rows) {
    if (!Array.isArray(rows)) return;
    state.world.medicStaffMarkers = rows.map(function (s) { return Object.assign({}, s); });
  }
  function setSentryStatus(p, row) {
    var now = state.world.time;
    p.sentrySnow = row && Array.isArray(row.snow) ? row.snow.map(function (left) { return now + Math.max(0, left); }) : [];
    p.sentryFreezeUntil = row && row.freeze > 0 ? now + row.freeze : 0;
    p.sentryBurn = row && row.burn ? { until: now + row.burn[0], next: now + row.burn[1], owner: row.burn[2] } : null;
  }
  function applySentryProjectiles(rows) {
    if (!rows) return;
    var world = state.world; world.sentryProjectiles = [];
    rows.forEach(function (r) {
      var p = { id: r[0], kind: r[1], owner: r[2], team: r[3], sentry: r[4], x: r[5], y: r[6], dx: r[7], dy: r[8], r: r[9], speed: r[10], traveled: r[11], range: r[12], age: r[13] };
      if (r[14]) Object.assign(p, { startX: r[14][0], startY: r[14][1], targetX: r[14][2], targetY: r[14][3], flightTime: r[14][4], peakHeight: r[14][5], z: r[14][6], flightElapsed: r[14][7] });
      world.spawnSentryProjectile(p);
    });
  }
  function applySentryStructures(rows) {
    var world = state.world, ids = {};
    rows.forEach(function (row) { ids[row.id] = true; world.structFromServer(Object.assign({ op: world.structById(row.id) ? 'state' : 'add' }, row)); });
    world.structures.slice().forEach(function (s) { if (!ids[s.id]) { world.destroyStruct(s, 0); world.emit({ type: 'struct', op: 'gone', struct: s, source: null }); } });
  }
  function applyRpgRockets(rows) {
    if (!rows) return;
    state.world.rpgRockets = [];
    rows.forEach(function (rocket) { state.world.spawnRpgRocket(rocket); });
  }

  // Remote players render slightly in the past so there is always a snapshot pair to blend between.
  function interpolate() {
    if (!state) return;
    var now = performance.now() / 1000, rt = state.serverTime + (now - state.recvAt) - INTERP, me = state.me;
    state.world.players.forEach(function (p) {
      if (p === me) return;
      updatePresence(p);
      if (p.hidden || !p.snaps || !p.snaps.length) return;
      var s = p.snaps, i = s.length - 1;
      while (i > 0 && s[i - 1].t > rt) i--;
      var b = s[i], a = i > 0 ? s[i - 1] : b;
      if (rt <= a.t || a === b) { p.x = a.x; p.y = a.y; p.angle = a.a; return; }
      if (rt >= b.t) { p.x = b.x; p.y = b.y; p.angle = b.a; return; }
      var k = (rt - a.t) / (b.t - a.t);
      p.x = a.x + (b.x - a.x) * k;
      p.y = a.y + (b.y - a.y) * k;
      p.angle = a.a + U.angleDiff(a.a, b.a) * k;
    });
    (state.world.vehicles || []).forEach(function (v) {
      if (v.hidden) return;
      if (!v.predicted && v.snaps && v.snaps.length) {
        var s = v.snaps, i = s.length - 1;
        while (i > 0 && s[i - 1].t > rt) i--;
        var b = s[i], a = i > 0 ? s[i - 1] : b, k = a === b ? 0 : U.clamp((rt - a.t) / (b.t - a.t), 0, 1);
        v.x = U.lerp(a.x, b.x, k); v.y = U.lerp(a.y, b.y, k);
        v.angle = a.a + U.angleDiff(a.a, b.a) * k;
        v.gunAngle = a.ga + U.angleDiff(a.ga, b.ga) * k;
        v.cannonAngle = a.ca + U.angleDiff(a.ca, b.ca) * k;
      }
      if (v.type === 'tank' && me.vehicle === v.id && state.world.vehicleWeaponFor) {
        var weapon = state.world.vehicleWeaponFor(me), aim = state.vehicleAim;
        var angle = aim && aim.vehicle === v.id ? Math.atan2(aim.y - v.y, aim.x - v.x) : me.angle;
        if (weapon === 'cannon') v.cannonAngle = angle;
        else if (weapon === 'mg') v.gunAngle = angle;
      } else if (v.seats.gunner === me.id) v.gunAngle = me.angle;
      state.world.syncVehicleSeats(v);
    });
  }

  // Per render frame: decay the reconciliation offset and blend the local player between 20 Hz steps.
  function frame(dt, alpha) {
    if (!state) return;
    var me = state.me, c = state.corr, k = Math.exp(-dt * 10);
    c.x *= k; c.y *= k;
    if (Math.abs(c.x) + Math.abs(c.y) < 0.2) { c.x = 0; c.y = 0; }
    me.ox = c.x - (1 - U.clamp(alpha, 0, 1)) * (me.x - me.px);
    me.oy = c.y - (1 - U.clamp(alpha, 0, 1)) * (me.y - me.py);
    var ride = vehicleFor(me), vc = state.vehicleCorr;
    vc.x *= k; vc.y *= k; vc.a *= k;
    if (Math.abs(vc.x) + Math.abs(vc.y) < 0.2) vc.x = vc.y = 0;
    if (Math.abs(vc.a) < 0.0001) vc.a = 0;
    (state.world.vehicles || []).forEach(function (v) {
      v.ox = v.oy = v.oa = 0;
      if (v === ride && v.predicted) {
        v.ox = vc.x - (1 - U.clamp(alpha, 0, 1)) * (v.x - v.px);
        v.oy = vc.y - (1 - U.clamp(alpha, 0, 1)) * (v.y - v.py);
        v.oa = vc.a - (1 - U.clamp(alpha, 0, 1)) * U.angleDiff(v.pa, v.angle);
      }
      VEHICLE_SEATS.forEach(function (seat) {
        var p = byId(v.seats[seat]);
        if (p && p.vehicle === v.id) {
          // The camera and occupant indicators follow the displayed hull rotation,
          // while authoritative seat positions remain untouched for prediction.
          var dx = p.x - v.x, dy = p.y - v.y, ca = Math.cos(v.oa), sa = Math.sin(v.oa);
          p.ox = v.ox + dx * ca - dy * sa - dx;
          p.oy = v.oy + dx * sa + dy * ca - dy;
        }
      });
    });
  }

  // ---------------------------------------------------------------- events -> world effects
  function proxy(p, x, y, angle) {
    return { id: p.id, team: p.team, color: p.color, outline: p.outline, r: p.r, x: x, y: y, angle: angle, recoil: 0, vx: 0, vy: 0, isLocal: p.isLocal };
  }

  function applyEvent(e) {
    var world = state.world, me = state.me, p, def, station, crate, s, pr;
    switch (e.t) {
      case 'pyro-upgrade':
        p = byId(e.id); if (p) { if (!p.hidden && world.pyroUpgradeFx) world.pyroUpgradeFx(p); world.emit({ type: 'pyro-upgrade', player: p }); }
        return;
      case 'rpg-shot':
        p = byId(e.id);
        if (p) { var muzzle = W.muzzleLength('rpg') * p.r; p.recoil = 1; world.flash(e.x + Math.cos(e.a) * muzzle, e.y + Math.sin(e.a) * muzzle, e.a, 'rpg'); world.emit({ type: 'rpg-shot', player: p, x: e.x, y: e.y }); }
        return;
      case 'rpg-impact':
        world.removeRpgRocket(e.id); world.rpgImpactFx(e.x, e.y);
        world.emit({ type: 'rpg-impact', id: e.id, x: e.x, y: e.y, owner: e.o });
        return;
      case 'sentry-fire':
        s = world.structById(e.id);
        if (s) { s.flash = 1; s.angle = e.a; world.emit({ type: 'sentry-shot', struct: s, x: e.x, y: e.y }); }
        return;
      case 'sentry-impact':
        world.removeSentryProjectile(e.id); world.sentryImpactFx(e.k, e.x, e.y);
        return;
      case 'emote':
        p = byId(e.id);
        if (p && p.alive && !p.downed) setEmote(p, [e.em, e.d]);
        return;
      case 'repair':
        p = byId(e.id);
        if (p) world.emit({ type: 'repair', player: p, vehicle: world.vehicleById(e.v), active: !!e.on });
        return;
      case 'melee':
        p = byId(e.id);
        if (!p) return;
        p.meleeSwing = 0.24; p.meleeAngle = e.a; p.recoil = 1;
        world.emit({ type: 'melee', player: p, weapon: e.w || 'hammer', x: e.x, y: e.y, a: e.a, reach: e.r });
        return;
      case 'vshot':
        p = byId(e.id); s = world.vehicleById(e.v);
        if (!p) return;
        world.vehicleShot(p, Object.assign({}, s, { x: e.x, y: e.y, gunAngle: e.a }), WEAPONS[e.w] || WEAPONS.turret, e.angles);
        if (s) { s.flash = 1; s.gunAngle = e.a; }
        world.emit({ type: 'shot', player: p, weapon: e.w || 'turret', vehicle: s, x: e.x, y: e.y });
        return;
      case 'tank-shell':
        if (e.op === 'spawn') {
          pr = world.spawnTankShell(e.shell);
          s = world.vehicleById(e.shell.vehicle);
          // The server emits before its barrel sweep so a point-blank hit can
          // follow in this same packet. Mirror that travel without local damage.
          if (s && !e.shell.traveled && !world.advanceTankShell(pr, s.r + 24)) {
            world.tankShells = world.tankShells.filter(function (shell) { return shell.id !== pr.id; });
          }
          if (s) { s.cannonFlash = 1; s.cannonAngle = Math.atan2(e.shell.dy, e.shell.dx); }
          world.emit({ type: 'tank-shell', op: 'spawn', shell: e.shell });
        } else if (e.op === 'impact') {
          s = (world.tankShells || []).find(function (shell) { return shell.id === e.id; });
          world.tankShells = (world.tankShells || []).filter(function (shell) { return shell.id !== e.id; });
          world.tankShellImpact(s || { id: e.id, owner: 0, vehicle: 0 }, null, e.x, e.y);
        }
        return;
      case 'vehicle':
        s = world.vehicleById(e.id);
        if (!s) return;
        // Snapshot state owns seats and health; events only provide feedback.
        if (e.op === 'hp') { s.hitFlash = 1; if (e.n) world.text(e.x, e.y - 8, String(Math.round(e.n)), '#ffd84a', 20); }
        if (e.op === 'wreck') { world.burst(e.x, e.y, 30, '#ffb347', 260, 0.8, 7); world.smoke(e.x, e.y, 16, '#555b62', 28, 1.6, 130); }
        world.emit({ type: 'vehicle', op: e.op, vehicle: s, player: byId(e.by), seat: e.seat, amount: e.n, source: byId(e.src) });
        return;
      case 'shot':
        p = byId(e.id); def = WEAPONS[e.w];
        if (!p || !def) return;
        pr = proxy(p, e.x, e.y, e.a[0]);
        if (e.st) { s = world.structById(e.st); pr.r = W.STRUCT_RADIUS.turret; if (s) { s.flash = 1; s.angle = e.a[0]; } }
        world.spawnShot(pr, def, e.a);
        p.recoil = 1;
        world.emit({ type: 'shot', player: p, weapon: e.w, x: e.x, y: e.y });
        return;
      case 'launch':
        p = byId(e.id);
        if (!p) return;
        world.spawnShell(proxy(p, e.x, e.y, Math.atan2(e.vy, e.vx)), Object.assign({}, e, { weapon: e.w || 'launcher', travel: e.tr }));
        p.recoil = 1;
        world.emit({ type: 'launch', player: p, x: e.x, y: e.y });
        return;
      case 'throw':
        p = byId(e.id);
        if (!p) return;
        world.spawnGrenade(proxy(p, e.x, e.y, Math.atan2(e.vy, e.vx)), Object.assign({}, e, { weapon: e.w || 'grenade', item: e.it || null }));
        p.recoil = 0.7;
        world.emit({ type: 'throw', player: p, item: e.it || null, x: e.x, y: e.y });
        return;
      case 'flame':
        p = byId(e.id); if (!p) return;
        world.flameFx(e.x, e.y, e.a, e.r);
        p.recoil = 0.4;
        world.emit({ type: 'flame', player: p, weapon: e.w || 'flamethrower', x: e.x, y: e.y, angle: e.a, range: e.r });
        return;
      case 'command':
        p = byId(e.id); if (!p) return;
        p.commandCd = e.cd;
        world.players.forEach(function (o) { if (o.team === e.tm && o.alive) o.commandBuff = e.d; });
        p.fx.radar = e.rd;
        world.emit({ type: 'command', player: p, team: e.tm, duration: e.d });
        return;
      case 'rock-gone':
        if (world.map.rocks[e.id]) world.map.rocks[e.id].alive = false;
        return;
      case 'legendary-crate-broken':
        world.emit({ type: 'legendary-crate-broken', crate: world.map.crates[e.id], player: byId(e.by) });
        return;
      case 'boom':
        world.explode(e.x, e.y, { maxDamage: e.pw, radius: WEAPONS.grenade.explosion.radius }, e.o, e.c);
        return;
      case 'burst':
        world.itemBurst(e.it, e.x, e.y, e.o);
        world.emit({ type: 'burst', item: e.it, x: e.x, y: e.y, owner: e.o });
        return;
      case 'zone':
        if (world.zoneById(e.id)) return;
        world.addZone({ id: e.id, kind: e.k, x: e.x, y: e.y, r: e.r, dur: e.dur, t: e.tl, age: e.dur - e.tl, owner: e.o, team: e.tm, dps: e.dps });
        world.emit({ type: 'zone', zone: world.zoneById(e.id) });
        return;
      case 'struct':
        s = world.structFromServer(e);
        world.emit({ type: 'struct', op: e.op, reason: e.reason, struct: s, source: byId(e.src) });
        return;
      case 'strike':
        if (world.strikeById(e.id)) return;
        world.addStrike({ id: e.id, kind: e.k, x: e.x, y: e.y, target: e.tg, t: e.tl, dur: e.tl, owner: e.o, team: e.tm, radius: e.r, damage: e.dm });
        world.emit({ type: 'strike', strike: world.strikeById(e.id) });
        return;
      case 'shit':
        s = world.resolveStrike(e.id, e.x, e.y);
        world.emit({ type: 'strike-hit', strike: s || { kind: e.k, x: e.x, y: e.y, radius: 0 } });
        return;
      case 'tele':
        p = byId(e.id);
        if (!p) return;
        world.teleportFx(e.fx, e.fy, e.x, e.y);
        if (p === me) { me.x = e.x; me.y = e.y; me.px = e.x; me.py = e.y; state.corr.x = 0; state.corr.y = 0; state.pending = []; }
        world.emit({ type: 'teleport', player: p, x: e.x, y: e.y });
        return;
      case 'pulled':
        p = byId(e.id);
        if (!p) return;
        if (p === me) { me.x = e.x; me.y = e.y; me.px = e.x; me.py = e.y; state.corr.x = 0; state.corr.y = 0; state.pending = []; }
        world.emit({ type: 'pulled', player: p });
        return;
      case 'sshot':
        s = world.structById(e.id);
        if (s) { s.angle = Math.atan2(e.ty - s.y, e.tx - s.x); world.sentryTracer(s, e.tx, e.ty); }
        world.emit({ type: 'sentry-shot', x: e.x, y: e.y, tx: e.tx, ty: e.ty });
        return;
      case 'buff':
        p = byId(e.id);
        world.emit({ type: 'buff', player: p || me, effect: e.k, duration: e.d, item: e.it, mystery: e.my, by: byId(e.by) });
        return;
      case 'flashed':
        me.fx.flash = Math.max(me.fx.flash, W.ITEMS.flashbang.flash);
        world.emit({ type: 'flashed', player: me });
        return;
      case 'saved':
        p = byId(e.id);
        if (!p) return;
        if (!p.hidden) {
          world.explosions.push({ x: p.x, y: p.y, r: 150, t: 0, dur: 0.7, ring: true, color: '#ffd23f' });
          world.text(p.x, p.y - p.r - 30, 'SAVED!', '#ffd23f', 26);
        }
        world.emit({ type: 'saved', player: p });
        return;
      case 'blocked':
        p = byId(e.id);
        if (!p) return;
        if (!p.hidden) world.text(p.x, p.y - p.r - 14, e.how === 'immune' ? 'IMMUNE' : 'BLOCKED', e.how === 'immune' ? '#7fe9ff' : '#cfd8e6', 16);
        world.emit({ type: 'blocked', player: p, how: e.how });
        return;
      case 'dmg':
        p = byId(e.id);
        if (!p) return;
        world.showDamage(p, e.n, e.x, e.y);
        // Health/armor already came from this packet's authoritative snapshot.
        world.emit({ type: 'damage', target: p, source: byId(e.src), amount: e.n, cause: e.c });
        return;
      case 'death':
        p = byId(e.id);
        if (p && p.alive) world.killPlayer(p, byId(e.k), e.c);
        else if (p) world.emit({ type: 'death', victim: p, killer: byId(e.k), cause: e.c, wasDowned: e.wd });
        return;
      case 'down':
        p = byId(e.id);
        if (!p) return;
        if (!p.downed) world.downPlayer(p, byId(e.k), e.c);
        else world.emit({ type: 'downed', player: p, source: byId(e.k), cause: e.c });
        return;
      case 'revive':
        p = byId(e.id);
        if (!p) return;
        if (!p.downed) p.downed = true;
        world.revivePlayer(p, byId(e.by));
        return;
      case 'heal':
        p = byId(e.id);
        if (!p) return;
        world.healFx(p, e.n);
        world.emit({ type: 'heal', player: p, by: byId(e.by), amount: e.n, item: e.it });
        return;
      case 'pick':
        p = byId(e.by);
        if (p === me) { if (e.what === 'token') me.tokens = e.tot; else if (e.what === 'key') me.keys = e.tot; else if (e.what === 'armor') me.armor = e.tot; }
        world.removePickup(e.id, p, e.what, e.n, e.tot, e.it);
        return;
      case 'pkspawn':
        world.spawnPickupAt({ id: e.id, type: e.type, item: e.it, x: e.x, y: e.y, vx: e.vx, vy: e.vy, amount: e.n, lockT: e.lk || 0 });
        return;
      case 'crate':
        crate = world.map.crates[e.id];
        if (!crate) return;
        crate.hp = e.hp;
        crate.shake = 1;
        if (e.n) world.text(e.x, e.y - 6, String(Math.round(e.n)), e.n >= 90 ? '#ff9a3c' : e.n >= 40 ? '#ffd84a' : '#ffffff', 17 + Math.min(17, e.n * 0.15));
        if (e.hp <= 0 && crate.alive) { world.crateBreakFx(crate); world.emit({ type: 'crate', crate: crate, source: byId(e.src) }); }
        return;
      case 'upg':
        p = byId(e.id); station = world.map.stations[e.st];
        if (!p || !station) return;
        world.applyUpgrade(p, station, e.cls, e.key);
        return;
      case 'land':
        p = byId(e.id);
        if (!p) return;
        p.dropT = 0;
        world.land(p);
        return;
      case 'local':
        world.emit({ type: e.k, player: me, weapon: e.w, reason: e.reason, value: e.value, item: e.it, amount: e.n });
        return;
    }
  }

  function applySync(m) {
    if (!state) return;
    var world = state.world, map = world.map;
    applyPracticeRoster(m.roster);
    applyPracticeSettings(m.ps);
    applyLooks(m.looks);
    if (typeof m.time === 'number') { state.serverTime = m.time; state.recvAt = performance.now() / 1000; }
    applyVehicles(m.vehicles, state.serverTime, 0, true);
    state.pending = []; state.latch = freshLatch(); state.corr.x = state.corr.y = 0; state.vehicleCorr.x = state.vehicleCorr.y = state.vehicleCorr.a = 0;
    m.crates.forEach(function (c) { var crate = map.crates[c[0]]; if (!crate) return; crate.hp = c[1]; if (c[1] <= 0) crate.alive = false; });
    m.gone.forEach(function (id) { var pk = world.pickupById(id); if (pk) pk.alive = false; });
    (m.rocks || []).forEach(function (id) { if (map.rocks[id]) map.rocks[id].alive = false; });
    (m.strikes || []).forEach(function (s) { applyEvent(Object.assign({ t: 'strike' }, s)); });
    if (m.tankShells) { world.tankShells = []; m.tankShells.forEach(function (shell) { world.spawnTankShell(shell); }); }
    applySentryProjectiles(m.sentryProjectiles);
    applyRpgRockets(m.rpgRockets);
    applyMedicStaffMarkers(m.medicStaffs);
    m.added.forEach(function (pk) { world.spawnPickupAt({ id: pk.id, type: pk.type, item: pk.it, x: pk.x, y: pk.y, amount: pk.n, lockT: pk.lk || 0 }); });
    (m.structs || []).forEach(function (s) { if (!world.structById(s.id)) world.structFromServer(Object.assign({ op: 'add' }, s)); });
    (m.zones || []).forEach(function (z) { if (!world.zoneById(z.id)) world.addZone({ id: z.id, kind: z.k, x: z.x, y: z.y, r: z.r, dur: z.dur, t: z.tl, age: z.dur - z.tl, owner: z.o, team: z.tm, dps: z.dps }); });
    m.stations.forEach(function (s) { if (map.stations[s[0]]) map.stations[s[0]].cooldown = s[1]; });
    m.players.forEach(function (row) {
      var p = world.playerById(row[0]);
      if (!p) return;
      setClassIfChanged(p, row[1]);
      p.alive = !!row[2]; p.downed = !!row[3]; p.x = row[4]; p.y = row[5]; p.dropT = 0;
      p.vehicle = row[6] || 0; p.vehicleSeat = row[7] || null;
      p.vehicleWeapon = row[8] || 0;
      p.repairVehicle = row[9] || 0;
      setSentryBuild(p, row[10]);
      setMedicStaff(p, row[11]);
      setPyroState(p, row[12]);
      if (p.vehicle && !vehicleFor(p)) { p.vehicle = 0; p.vehicleSeat = null; }
      // Sync restores the entire roster, including distant or invisible enemies.
      // Only interest-filtered snapshots may reveal their bodies again.
      p.snaps.length = 0;
      p.seenAt = p === state.me ? state.serverTime : -1;
      p.hidden = p !== state.me;
      if (p === state.me) { p.px = p.x; p.py = p.y; }
      if (!p.alive) p.deadT = 10;
    });
    (m.emotes || []).forEach(function (row) { var p = byId(row[0]); if (p) setEmote(p, row[1]); });
    (world.vehicles || []).forEach(function (v) {
      v.predicted = state.me.vehicle === v.id && state.me.vehicleSeat === 'driver';
      v.ox = v.oy = v.oa = 0;
      if (!v.hidden && world.syncVehicleSeats) world.syncVehicleSeats(v);
    });
    if (m.storm) applyStorm(m.storm);
  }

  function applyStorm(m) {
    if (!state) return;
    if (m.disabled || (state.info.practice && state.practiceSettings && !state.practiceSettings.storm)) { state.world.storm = null; return; }
    var s = state.world.storm || (state.world.storm = new W.Storm(state.world));
    s.x = m.x; s.y = m.y; s.r = m.r; s.state = m.st; s.timeLeft = m.tl; s.dps = m.dps; s.phase = m.ph;
    s.next = m.nx === null || m.nx === undefined ? null : { x: m.nx, y: m.ny, r: m.nr };
    if (m.alive !== undefined) state.alive = m.alive;
    if (m.teams !== undefined) state.teamsAlive = m.teams;
  }

  // ---------------------------------------------------------------- input
  function latch(input, projectiles) {
    if (!state) return;
    if (state.me.vehicle) {
      var previous = state.latch, ride = vehicleFor(state.me), seat = state.me.vehicleSeat;
      state.latch = freshLatch(); state.latch.ip = previous.ip;
      if (ride && ride.type === 'tank' && seat !== 'rearRight') {
        state.latch.r = previous.r || Controls.hit(input, 'reload');
        if (seat === 'driver' || (state.world.map.teamSize === 2 && seat === 'rearLeft')) state.latch.sl = Controls.hit(input, 'weapon1') ? 0 : Controls.hit(input, 'weapon2') ? 1 : previous.sl;
      }
      return;
    }
    var L = state.latch;
    var projectile = state.world.aimedProjectile(state.me), fire = projectiles && projectiles.fire, gear = projectiles && projectiles.gear;
    var released = projectile ? !!(fire && fire.released) : Controls.hit(input, 'fire');
    if (released) { L.fp = true; L.ch = projectile ? fire.seconds : 0; }
    L.r = L.r || Controls.hit(input, 'reload');
    L.sw = L.sw || Controls.hit(input, 'swap');
    L.dp = L.dp || Controls.hit(input, 'drop');
    var grenadeGear = state.me.weapons.some(function (w) { return w.id === 'grenade'; });
    if (grenadeGear ? !!(gear && gear.released) : Controls.hit(input, 'gear')) { L.u = true; L.uch = grenadeGear ? gear.seconds : 0; }
    var selectedWeapon = Controls.weaponSlotHit(input, state.me);
    if (selectedWeapon !== null) L.sl = selectedWeapon;
    L.cy += input.wheel;
  }

  // One fixed 20 Hz step: predict the local move, send the input, remember it for reconciliation.
  function step(input, renderer, blocked, mapOpen) {
    if (!state) return;
    var me = state.me, L = state.latch, ride = vehicleFor(me), seated = !!me.vehicle;
    var tankOperator = !!ride && ride.type === 'tank' && (me.vehicleSeat === 'driver' || me.vehicleSeat === 'gunner' || me.vehicleSeat === 'rearLeft');
    var aim = renderer.screenToWorld(state.cam, input.mouse.x, input.mouse.y);
    var a = Math.atan2(aim.y - (me.y + me.oy), aim.x - (me.x + me.ox)), d = U.clamp(Math.hypot(aim.x - me.x, aim.y - me.y), 40, 3000);
    var intent = blocked ? { mx: 0, my: 0 } : {
      mx: (Controls.down(input, 'right') ? 1 : 0) - (Controls.down(input, 'left') ? 1 : 0),
      my: (Controls.down(input, 'down') ? 1 : 0) - (Controls.down(input, 'up') ? 1 : 0),
      sprint: !seated && Controls.down(input, 'sprint')
    };
    var act = !blocked && !mapOpen;
    var msg = {
      t: 'in', s: ++state.seq, mx: intent.mx, my: intent.my, sp: !!intent.sprint, a: Math.round(a * 1000) / 1000, d: Math.round(d),
      f: act && (seated ? tankOperator || (!!ride && ride.armed && me.vehicleSeat === 'gunner') : !state.world.aimedProjectile(me)) && Controls.down(input, 'fire'),
      fp: !seated && ((act && L.fp) || L.use), sc: !seated && !blocked && Controls.down(input, 'scope'),
      ch: seated || L.use ? 0 : L.ch, uch: seated ? 0 : L.uch,
      r: (!seated || tankOperator) && L.r, sl: !seated || (tankOperator && (me.vehicleSeat === 'driver' || (state.world.map.teamSize === 2 && me.vehicleSeat === 'rearLeft'))) ? L.sl : null, cy: seated ? 0 : L.cy, sw: !seated && L.sw, u: !seated && act && L.u, iv: !seated && !blocked && Controls.down(input, 'interact'),
      ht: seated ? null : L.ht, ip: L.ip, dp: !seated && act && L.dp
    };
    if (me.alive) me.angle = a;
    state.vehicleAim = ride ? { vehicle: ride.id, x: aim.x, y: aim.y } : null;
    var entry = { seq: msg.s, intent: intent, vehicle: me.vehicle || 0, seat: me.vehicleSeat || null };
    state.pending.push(entry);
    if (state.pending.length > 120) state.pending.shift();
    me.px = me.x; me.py = me.y;
    if (me.alive && me.dropT <= 0) predictInput(entry);
    MatchNet.send(msg);
    state.latch = freshLatch();
  }

  function requestUpgrade(classId) { return MatchNet.request({ t: 'upgrade', cls: classId }, 'upgrade-result', 6000); }
  function practiceCommand(action, data) {
    if (!state || !state.info.practice) return Promise.resolve({ ok: false, reason: 'practice-only' });
    return MatchNet.request(Object.assign({}, data || {}, { t: 'practice', action: action }), 'practice-result', 6000);
  }
  function chooseSentryUpgrade(variant) {
    if (!state) return false;
    MatchNet.send({ t: 'sentry-choice', variant: variant });
    state.me.sentryChoice = null;
    return true;
  }
  function updateCosmetics(value) {
    if (!state) return false;
    MatchNet.send({ t: 'cosmetics', value: W.Cosmetics.normalize(value) });
    return true;
  }
  function emote(slot) {
    if (!state || !state.me.alive || state.me.downed || state.me.dropT > 0 || !Number.isInteger(slot) || slot < 0 || slot >= 9 || state.world.time + 1e-8 < state.me.emoteReadyAt) return false;
    state.me.emoteReadyAt = state.world.time + W.Cosmetics.EMOTE_COOLDOWN;
    MatchNet.send({ t: 'emote', slot: slot });
    return true;
  }
  function clearActions() { if (state) state.latch = freshLatch(); }
  // Hotbar and interact presses decided by the app (the inventory screen, the E key): sent with the next input.
  function selectItem(idx) { if (state && !state.me.vehicle) state.latch.ht = idx; }
  function useItem(idx) { if (state && !state.me.vehicle) { if (idx !== null && idx !== undefined) state.latch.ht = idx; state.latch.use = true; } }
  function pressInteract() { if (state) state.latch.ip = true; }

  // Camera target: me while alive, otherwise whoever the server says we are spectating.
  function focus() {
    if (!state) return null;
    if (state.me.alive) return state.me;
    return (state.spec && byId(state.spec)) || state.me;
  }

  W.Online = {
    init: init, join: join, leave: leave, stop: stop, start: start,
    applySnapshot: applySnapshot, applyEvent: applyEvent, applySync: applySync, applyStorm: applyStorm,
    latch: latch, step: step, interpolate: interpolate, frame: frame, requestUpgrade: requestUpgrade, practiceCommand: practiceCommand, focus: focus,
    selectItem: selectItem, useItem: useItem, pressInteract: pressInteract,
    updateCosmetics: updateCosmetics, emote: emote, clearActions: clearActions, chooseSentryUpgrade: chooseSentryUpgrade,
    state: function () { return state; }, joining: function () { return !!pendingJoin; }, STEP: STEP
  };
}());
