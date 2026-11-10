/* warz.io: client side of an online match. Mirrors the server's world: local movement is predicted and
   reconciled, other players are interpolated between snapshots, and server events become the same
   world effects the offline game uses, so the renderer, HUD and sounds need no network knowledge. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, WEAPONS = W.WEAPONS, MatchNet = W.MatchNet, Controls = W.Controls;
  var STEP = 1 / 20, INTERP = 0.1, state = null, cbs = {}, pendingJoin = null;

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
      case 'match-start': start(m); pendingJoin = null; if (cbs.onStart) cbs.onStart(state); break;
      case 'snap': applySnapshot(m); break;
      case 'sync': applySync(m); break;
      case 'storm': applyStorm(m); break;
      case 'eliminated': if (state) { state.placement = m.placement; state.result = m; } if (cbs.onEliminated) cbs.onEliminated(m); break;
      case 'spectating': if (cbs.onSpectating) cbs.onSpectating(m); break;
      case 'match-end': if (state) { state.ended = true; state.result = m; if (m.placement) state.placement = m.placement; } if (cbs.onEnd) cbs.onEnd(m); break;
    }
  }

  function leave() { MatchNet.send({ t: 'leave' }); MatchNet.close(); state = null; pendingJoin = null; }
  function stop() { MatchNet.close(); state = null; pendingJoin = null; }

  function start(info) {
    var map = W.MapGen.generate(info.seed), world = new W.World({ map: map, remote: true, teams: info.teamSize > 1 });
    info.players.forEach(function (o) {
      var p = world.addPlayer({ id: o.id, name: o.name, team: o.team, color: o.color, outline: o.outline, x: map.size / 2, y: map.size / 2, drop: !info.rejoin, angle: -Math.PI / 2 });
      p.snaps = [];
      p.seenAt = -1;
      // The roster contains identities, not positions. Keep every body out of the
      // world until its first authoritative snapshot (including our own spawn).
      p.hidden = true;
    });
    var me = world.playerById(info.you);
    me.isLocal = true;
    me.px = me.x; me.py = me.y;
    state = {
      info: info, world: world, me: me, cam: { x: me.x, y: me.y, zoom: info.rejoin ? 1 : 0.45 }, seq: 0, pending: [], latch: freshLatch(),
      corr: { x: 0, y: 0 }, serverTime: info.time || 0, recvAt: performance.now() / 1000, spec: 0,
      alive: info.players.length, teamsAlive: info.teams || 0, placement: null, ended: false, result: null, snapCount: 0
    };
    return state;
  }

  // ---------------------------------------------------------------- snapshots
  function setClassIfChanged(p, idx) {
    var cls = W.CLASS_ORDER[idx];
    if (cls && p.classId !== cls) state.world.setClass(p, cls, false);
  }

  function applySnapshot(s) {
    if (!state) return;
    var world = state.world, me = state.me, now = performance.now() / 1000;
    state.serverTime = s.time;
    state.recvAt = now;
    state.snapCount++;
    var y = s.you;
    if (y) {
      me.seenAt = s.time;
      me.hidden = false;
      setClassIfChanged(me, y.cls);
      var prevX = me.x + state.corr.x, prevY = me.y + state.corr.y;
      me.x = y.x; me.y = y.y; me.vx = y.vx; me.vy = y.vy;
      state.pending = state.pending.filter(function (i) { return i.seq > y.ack; });
      me.alive = y.alive; me.dropT = y.drop; me.downed = y.down; me.downT = y.downT; me.revive = y.rev; me.team = y.team;
      me.hp = y.hp; me.maxHp = y.mhp; me.armor = y.ar; me.tokens = y.tok; me.keys = y.keys;
      me.upgradeFrom = y.from || null;
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
      if (me.mount !== (y.mnt || 0)) {
        // A click queued for one weapon must not fire after mounting or dismounting.
        state.latch.fp = false; state.latch.ch = 0;
        state.latch.u = false; state.latch.uch = 0; state.latch.use = false;
      }
      me.mount = y.mnt || 0;
      if (y.fx) for (var fi = 0; fi < W.FX_KEYS.length; fi++) me.fx[W.FX_KEYS[fi]] = y.fx[fi] || 0;
      me.regen = y.rg || 0;
      me.tpProgress = y.tp || 0;
      var heldIt = world.heldItem(me);
      me.shieldUp = !!heldIt && heldIt.kind === 'hold' && !me.mount && !me.downed;
      world.reveal[me.team] = y.dr || 0;
      // Restore authoritative stamina and every speed/mount modifier before replay. Replaying
      // unacknowledged input from this baseline cannot drain the same frame a second time.
      me.stamina = typeof y.stam === 'number' ? U.clamp(y.stam, 0, W.CONFIG.staminaMax) : W.CONFIG.staminaMax;
      me.sprintExhausted = !!y.exh;
      me.sprintRestT = U.clamp(y.rest || 0, 0, W.CONFIG.staminaRestDelay);
      me.sprinting = !!y.spr;
      if (me.alive && me.dropT <= 0) state.pending.forEach(function (i) { world.moveStep(me, i.intent, STEP); });
      // Fold the correction into a visual offset that decays, so small mispredictions never pop.
      var ex = prevX - me.x, ey = prevY - me.y;
      if (state.snapCount > 1 && Math.abs(ex) + Math.abs(ey) < 140) { state.corr.x = ex; state.corr.y = ey; } else { state.corr.x = 0; state.corr.y = 0; }
      me.px = me.x; me.py = me.y;
    }
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
    for (var k = 0; k < s.e.length; k++) applyEvent(s.e[k]);
  }

  function updatePresence(p) {
    if (p === state.me) return;
    p.hidden = p.seenAt < 0 || (p.team !== state.me.team && state.serverTime - p.seenAt > 0.4);
  }

  function pushSnap(p, time, a) {
    var prev = p.snaps.length ? p.snaps[p.snaps.length - 1] : null;
    // Reappearing players start at the newly received position rather than
    // blending from an old body that left our view or turned invisible.
    if (prev && (p.hidden || time - prev.t > 0.4 || Math.hypot(prev.x - a[1], prev.y - a[2]) > 500)) p.snaps.length = 0;
    p.snaps.push({ t: time, x: a[1], y: a[2], a: a[3] });
    if (p.snaps.length > 16) p.snaps.shift();
    p.seenAt = time;
    p.hidden = false;
    p.hp = a[4]; p.maxHp = a[5];
    setClassIfChanged(p, a[6]);
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
    p.held = heldId ? 0 : -1;
    p.dropT = a[9]; p.downT = a[10]; p.revive = a[11];
    p.minigunSpin = a[13] || 0; p.commandBuff = a[14] || 0; p.flameTicks = a[15] || 0;
    if (p.snaps.length === 1) { p.x = a[1]; p.y = a[2]; p.angle = a[3]; }
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
  }

  // Per render frame: decay the reconciliation offset and blend the local player between 20 Hz steps.
  function frame(dt, alpha) {
    if (!state) return;
    var me = state.me, c = state.corr, k = Math.exp(-dt * 10);
    c.x *= k; c.y *= k;
    if (Math.abs(c.x) + Math.abs(c.y) < 0.2) { c.x = 0; c.y = 0; }
    me.ox = c.x - (1 - U.clamp(alpha, 0, 1)) * (me.x - me.px);
    me.oy = c.y - (1 - U.clamp(alpha, 0, 1)) * (me.y - me.py);
  }

  // ---------------------------------------------------------------- events -> world effects
  function proxy(p, x, y, angle) {
    return { id: p.id, team: p.team, color: p.color, outline: p.outline, r: p.r, x: x, y: y, angle: angle, recoil: 0, vx: 0, vy: 0, isLocal: p.isLocal };
  }

  function applyEvent(e) {
    var world = state.world, me = state.me, p, def, station, crate, s, pr;
    switch (e.t) {
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
        world.emit({ type: 'flame', player: p, x: e.x, y: e.y, angle: e.a, range: e.r });
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
    if (typeof m.time === 'number') { state.serverTime = m.time; state.recvAt = performance.now() / 1000; }
    m.crates.forEach(function (c) { var crate = map.crates[c[0]]; if (!crate) return; crate.hp = c[1]; if (c[1] <= 0) crate.alive = false; });
    m.gone.forEach(function (id) { var pk = world.pickupById(id); if (pk) pk.alive = false; });
    (m.rocks || []).forEach(function (id) { if (map.rocks[id]) map.rocks[id].alive = false; });
    (m.strikes || []).forEach(function (s) { applyEvent(Object.assign({ t: 'strike' }, s)); });
    m.added.forEach(function (pk) { world.spawnPickupAt({ id: pk.id, type: pk.type, item: pk.it, x: pk.x, y: pk.y, amount: pk.n, lockT: pk.lk || 0 }); });
    (m.structs || []).forEach(function (s) { if (!world.structById(s.id)) world.structFromServer(Object.assign({ op: 'add' }, s)); });
    (m.zones || []).forEach(function (z) { if (!world.zoneById(z.id)) world.addZone({ id: z.id, kind: z.k, x: z.x, y: z.y, r: z.r, dur: z.dur, t: z.tl, age: z.dur - z.tl, owner: z.o, team: z.tm, dps: z.dps }); });
    m.stations.forEach(function (s) { if (map.stations[s[0]]) map.stations[s[0]].cooldown = s[1]; });
    m.players.forEach(function (row) {
      var p = world.playerById(row[0]);
      if (!p) return;
      setClassIfChanged(p, row[1]);
      p.alive = !!row[2]; p.downed = !!row[3]; p.x = row[4]; p.y = row[5]; p.dropT = 0;
      // Sync restores the entire roster, including distant or invisible enemies.
      // Only interest-filtered snapshots may reveal their bodies again.
      p.snaps.length = 0;
      p.seenAt = p === state.me ? state.serverTime : -1;
      p.hidden = p !== state.me;
      if (p === state.me) { p.px = p.x; p.py = p.y; }
      if (!p.alive) p.deadT = 10;
    });
    if (m.storm) applyStorm(m.storm);
  }

  function applyStorm(m) {
    if (!state) return;
    var s = state.world.storm;
    s.x = m.x; s.y = m.y; s.r = m.r; s.state = m.st; s.timeLeft = m.tl; s.dps = m.dps; s.phase = m.ph;
    s.next = m.nx === null || m.nx === undefined ? null : { x: m.nx, y: m.ny, r: m.nr };
    if (m.alive !== undefined) state.alive = m.alive;
    if (m.teams !== undefined) state.teamsAlive = m.teams;
  }

  // ---------------------------------------------------------------- input
  function latch(input, projectiles) {
    if (!state) return;
    var L = state.latch;
    var projectile = state.world.aimedProjectile(state.me), fire = projectiles && projectiles.fire, gear = projectiles && projectiles.gear;
    var released = projectile ? !!(fire && fire.released) : Controls.hit(input, 'fire');
    if (released) { L.fp = true; L.ch = projectile ? fire.seconds : 0; }
    L.r = L.r || Controls.hit(input, 'reload');
    L.sw = L.sw || Controls.hit(input, 'swap');
    L.dp = L.dp || Controls.hit(input, 'drop');
    var grenadeGear = state.me.weapons.some(function (w) { return w.id === 'grenade'; });
    if (grenadeGear ? !!(gear && gear.released) : Controls.hit(input, 'gear')) { L.u = true; L.uch = grenadeGear ? gear.seconds : 0; }
    if (Controls.hit(input, 'weapon1')) L.sl = 0;
    if (Controls.hit(input, 'weapon2')) L.sl = 1;
    L.cy += input.wheel;
  }

  // One fixed 20 Hz step: predict the local move, send the input, remember it for reconciliation.
  function step(input, renderer, blocked, mapOpen) {
    if (!state) return;
    var me = state.me, L = state.latch;
    var aim = renderer.screenToWorld(state.cam, input.mouse.x, input.mouse.y);
    var a = Math.atan2(aim.y - (me.y + me.oy), aim.x - (me.x + me.ox)), d = U.clamp(Math.hypot(aim.x - me.x, aim.y - me.y), 40, 3000);
    var intent = blocked ? { mx: 0, my: 0 } : {
      mx: (Controls.down(input, 'right') ? 1 : 0) - (Controls.down(input, 'left') ? 1 : 0),
      my: (Controls.down(input, 'down') ? 1 : 0) - (Controls.down(input, 'up') ? 1 : 0),
      sprint: Controls.down(input, 'sprint')
    };
    var act = !blocked && !mapOpen;
    var msg = {
      t: 'in', s: ++state.seq, mx: intent.mx, my: intent.my, sp: !!intent.sprint, a: Math.round(a * 1000) / 1000, d: Math.round(d),
      f: act && !state.world.aimedProjectile(me) && Controls.down(input, 'fire'), fp: (act && L.fp) || L.use, sc: !blocked && Controls.down(input, 'scope'),
      ch: L.use ? 0 : L.ch, uch: L.uch,
      r: L.r, sl: L.sl, cy: L.cy, sw: L.sw, u: act && L.u, iv: !blocked && Controls.down(input, 'interact'),
      ht: L.ht, ip: L.ip, dp: act && L.dp
    };
    if (me.alive) me.angle = a;
    state.pending.push({ seq: msg.s, intent: intent });
    if (state.pending.length > 120) state.pending.shift();
    me.px = me.x; me.py = me.y;
    if (me.alive && me.dropT <= 0) state.world.moveStep(me, intent, STEP);
    MatchNet.send(msg);
    state.latch = freshLatch();
  }

  function requestUpgrade(classId) { return MatchNet.request({ t: 'upgrade', cls: classId }, 'upgrade-result', 6000); }
  // Hotbar and interact presses decided by the app (the inventory screen, the E key): sent with the next input.
  function selectItem(idx) { if (state) state.latch.ht = idx; }
  function useItem(idx) { if (state) { if (idx !== null && idx !== undefined) state.latch.ht = idx; state.latch.use = true; } }
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
    latch: latch, step: step, interpolate: interpolate, frame: frame, requestUpgrade: requestUpgrade, focus: focus,
    selectItem: selectItem, useItem: useItem, pressInteract: pressInteract,
    state: function () { return state; }, joining: function () { return !!pendingJoin; }, STEP: STEP
  };
}());
