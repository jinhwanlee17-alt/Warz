/* warz.io: match simulation (players, weapons, bullets, grenades, pickups, stations, storm). No DOM access.
   Players are driven by a controller function, so the same code runs the local player, the menu demo soldiers
   and the authoritative server. With `remote: true` the world is a client-side mirror: positions and state come
   from server snapshots, bullets and grenades are cosmetic, and damage arrives as events. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, C = W.CONFIG, WEAPONS = W.WEAPONS, CLASSES = W.CLASSES, Rules = W.Rules;
  var IDLE = { mx: 0, my: 0, aimX: null, aimY: null, fire: false, firePressed: false };
  var SPARK = { wall: '#e0d2bd', rock: '#cfd4da', trunk: '#b08354', station: '#8cefff', crate: '#e7ad62' };
  var DOWNED_TIME = 30, DOWNED_HP = 40, REVIVE_HP = 30, REVIVE_RANGE = 70, TEAM_HEAL_RANGE = 160;

  function damageColor(amount) { return amount >= 90 ? '#ff9a3c' : amount >= 40 ? '#ffd84a' : '#ffffff'; }
  function damageSize(amount) { return 17 + Math.min(17, amount * 0.15); }

  function World(opts) {
    opts = opts || {};
    this.map = opts.map;
    this.demo = !!opts.demo;
    this.remote = !!opts.remote;
    this.practice = !!opts.practice && !this.remote && !this.demo;
    this.teams = !!opts.teams;
    this.rng = U.rng((this.map.seed ^ 0x5bd1e995) >>> 0);
    this.time = 0;
    this.players = [];
    this.bullets = [];
    this.grenades = [];
    this.explosions = [];
    this.particles = [];
    this.texts = [];
    this.events = [];
    this.structures = [];   // rocks, turrets, sentries, teleporter pads (items.js)
    this.zones = [];        // fire, smoke, snow
    this.strikes = [];      // pending lightning and meteors
    this.reveal = {};       // team -> seconds of drone reveal left
    this.nextId = 1;
    this.nextStructId = 1;
    this.cleanupT = 5;
    this.solids = new U.SpatialHash(256);
    this.buildSolids();
    this.vehicles = [];
    if (this.initVehicles) this.initVehicles();
    if (this.remote) this.storm = { remote: true, x: C.worldSize / 2, y: C.worldSize / 2, r: C.worldSize, next: null, state: 'waiting', timeLeft: 0, dps: 0, phase: 0 };
    else this.storm = (this.demo || opts.storm === false) ? null : new Storm(this);
  }

  World.prototype.emit = function (e) { e.time = this.time; this.events.push(e); };

  World.prototype.buildSolids = function () {
    var h = this.solids, m = this.map, cr = C.stationCoreRadius;
    // Leafy cover has no collision or health. Discard old trunk metadata too.
    ['trees', 'bushes'].forEach(function (kind) {
      (m[kind] || []).forEach(function (plant) {
        delete plant.hp; delete plant.maxHp; delete plant.hitRadius; delete plant.foliageKind;
      });
    });
    // Cacti remain damageable hazards, separate from movement collision.
    this.foliage = new U.SpatialHash(256);
    var foliage = this.foliage;
    ['cacti'].forEach(function (kind) {
      (m[kind] || []).forEach(function (plant, index) {
        if (plant.id === undefined) plant.id = index;
        plant.foliageKind = kind;
        plant.maxHp = 50;
        if (plant.hp === undefined) plant.hp = plant.maxHp;
        if (plant.alive === undefined) plant.alive = true;
        plant.hitRadius = plant.r;
        foliage.insert(plant, plant.x - plant.r, plant.y - plant.r, plant.x + plant.r, plant.y + plant.r);
      });
    });
    m.rocks.forEach(function (r, index) {
      if (r.id === undefined) r.id = index;
      if (r.alive === undefined) r.alive = true;
      delete r.hp; delete r.maxHp; // Natural rocks are binary cover, including maps from older clients.
      if (r.alive) h.insert({ type: 'rock', shape: 'circle', x: r.x, y: r.y, r: r.r, rock: r }, r.x - r.r, r.y - r.r, r.x + r.r, r.y + r.r);
    });
    // Green foliage is cover art, not an invisible central collision post.
    m.buildings.forEach(function (b) {
      b.walls.forEach(function (wl) {
        h.insert({ type: 'wall', shape: 'rect', x: wl.x, y: wl.y, w: wl.w, h: wl.h }, wl.x, wl.y, wl.x + wl.w, wl.y + wl.h);
      });
    });
    m.stations.forEach(function (st) {
      h.insert({ type: 'station', shape: 'circle', x: st.x, y: st.y, r: cr, station: st }, st.x - cr, st.y - cr, st.x + cr, st.y + cr);
    });
    m.crates.forEach(function (c) {
      var half = c.size / 2;
      h.insert({ type: 'crate', shape: 'rect', x: c.x - half, y: c.y - half, w: c.size, h: c.size, crate: c },
        c.x - half, c.y - half, c.x + half, c.y + half);
    });
  };

  // ---------------------------------------------------------------- players
  World.prototype.addPlayer = function (o) {
    var look = W.Cosmetics.normalize(o.cosmetics || { color: o.color, face: o.face, emotes: o.emotes });
    var color = o.cosmetics ? look.color : o.color || look.color;
    var p = {
      id: o.id || this.nextId++, name: o.name || 'Player', color: color, outline: o.outline || U.shade(color, -0.3),
      face: look.face, emotes: look.emotes, emote: null, emoteReadyAt: 0,
      x: o.x, y: o.y, vx: 0, vy: 0, r: C.playerRadius, angle: o.angle || 0,
      classId: 'soldier', hp: 100, maxHp: 100, armor: 0, weapons: [], slot: 0, lastSlot: 0,
      grenades: 0, medkitCd: 0, throwCd: 0, tokens: o.tokens || 0, keys: o.keys || 0,
      alive: true, deadT: 0, isLocal: !!o.isLocal, bot: !!o.bot, controller: null, ai: null,
      recoil: 0, hitFlash: 0, healFlash: 0, dropT: o.drop ? C.dropDuration : 0,
      inPond: false, inStorm: false, nearStation: null, scoping: false,
      stamina: C.staminaMax, sprintExhausted: false, sprintRestT: 0, sprinting: false,
      team: o.team || 0, downed: false, downT: 0, revive: 0, wantsRevive: false,
      vehicle: 0, vehicleSeat: null, vehicleWeapon: 0, repairVehicle: 0, meleeSwing: 0, meleeAngle: o.angle || 0,
      ox: 0, oy: 0, snaps: null,
      stats: { damage: 0, crateDamage: 0, crates: 0, tokens: 0, shots: 0, hits: 0, kills: 0, knocks: 0, revives: 0, upgrades: 0, healed: 0 }
    };
    if (!p.team) p.team = p.id; // solo: everyone is their own team
    if (o.id) this.nextId = Math.max(this.nextId, o.id + 1);
    this.initItems(p);
    this.setClass(p, o.classId || 'soldier', true);
    this.players.push(p);
    return p;
  };

  World.prototype.applyCosmetics = function (p, value) {
    var look = W.Cosmetics.normalize(value);
    p.color = look.color; p.outline = U.shade(look.color, -0.3); p.face = look.face; p.emotes = look.emotes;
    return look;
  };

  // Training targets exist only in an explicitly offline Practice world. Keep HP
  // finite for physics/rendering while allowing hits and damage feedback forever.
  World.prototype.isPracticeBot = function (p) { return this.practice && !this.remote && !!p && p.practiceBot === true; };
  World.prototype.spawnPracticeBot = function (player) {
    if (!this.practice || this.remote || !player || this.players.indexOf(player) < 0 || !player.alive || player.downed || player.dropT > 0) return null;
    for (var radius = 140; radius <= 380; radius += 40) {
      for (var i = 0; i < 32; i++) {
        var offset = Math.ceil(i / 2) * (i % 2 ? 1 : -1) / 32 * U.TAU;
        var angle = player.angle + offset, x = player.x + Math.cos(angle) * radius, y = player.y + Math.sin(angle) * radius;
        if (!this.spotFree(x, y, C.playerRadius + 6, false) || this.inPond(x, y) || !this.lineClear(player.x, player.y, x, y)) continue;
        var p = this.addPlayer({ name: 'Practice target', x: x, y: y, color: '#ff9a48', bot: true, angle: angle + Math.PI });
        p.practiceBot = true;
        p.controller = null;
        this.text(x, y - p.r - 35, '∞ HP', '#ffdc75', 20);
        return p;
      }
    }
    return null;
  };
  World.prototype.useEmote = function (p, slot) {
    if (this.remote || !p || !p.alive || p.downed || p.dropT > 0 || !Number.isInteger(slot) || slot < 0 || slot >= 9 || this.time + 1e-8 < p.emoteReadyAt) return false;
    var id = p.emotes[slot];
    if (!W.Cosmetics.emote(id)) return false;
    p.emote = { id: id, until: this.time + W.Cosmetics.EMOTE_DURATION };
    p.emoteReadyAt = this.time + W.Cosmetics.EMOTE_COOLDOWN;
    this.emit({ type: 'emote', player: p, id: id, duration: W.Cosmetics.EMOTE_DURATION });
    return true;
  };

  World.prototype.teamStanding = function (team, except) {
    var n = 0;
    for (var i = 0; i < this.players.length; i++) {
      var o = this.players[i];
      if (o !== except && o.team === team && o.alive && !o.downed) n++;
    }
    return n;
  };
  World.prototype.teammates = function (p) {
    return this.players.filter(function (o) { return o !== p && o.team === p.team; });
  };

  // Changing class swaps in the new loadout with full magazines. HP is kept, capped at the new maximum.
  World.prototype.setClass = function (p, classId, fresh) {
    var c = CLASSES[classId];
    p.classId = classId;
    p.maxHp = c.hp;
    p.hp = fresh ? c.hp : Math.min(p.hp, c.hp);
    p.armor = c.armor;
    p.weapons = c.loadout.map(function (id) {
      return { id: id, ammo: WEAPONS[id].mag || 0, cooldown: 0, reloadT: 0, reloading: false };
    });
    p.slot = 0;
    p.lastSlot = p.weapons.length > 1 ? 1 : 0;
    p.grenades = c.loadout.indexOf('grenade') >= 0 ? WEAPONS.grenade.count : 0;
    p.medkitCd = 0;
    p.throwCd = 0;
  };

  World.prototype.respawn = function (p, x, y, classId) {
    if (p.vehicle && this.exitVehicle) this.exitVehicle(p, true);
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.alive = true; p.deadT = 0; p.hitFlash = 0;
    p.downed = false; p.downT = 0; p.revive = 0;
    p.emote = null; p.emoteReadyAt = 0;
    p.stamina = C.staminaMax; p.sprintExhausted = false; p.sprintRestT = 0; p.sprinting = false;
    this.resetItems(p);
    this.setClass(p, classId || 'soldier', true);
    this.collide(p);
  };

  World.prototype.playerById = function (id) {
    for (var i = 0; i < this.players.length; i++) if (this.players[i].id === id) return this.players[i];
    return null;
  };

  World.prototype.update = function (dt) {
    this.time += dt;
    var i, st = this.map.stations, crates = this.map.crates;
    for (i = 0; i < st.length; i++) if (st[i].cooldown > 0) st[i].cooldown = Math.max(0, st[i].cooldown - dt);
    for (i = 0; i < crates.length; i++) if (crates[i].shake > 0) crates[i].shake = Math.max(0, crates[i].shake - dt * 5);
    for (i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (this.remote) this.cosmeticTick(p, dt);
      else if (p.alive) this.updatePlayer(p, dt);
      else p.deadT += dt;
    }
    if (this.updateVehicles) this.updateVehicles(dt);
    if (!this.remote) {
      this.separatePlayers();
      this.updateCactusContacts();
      if (this.teams) this.updateRevives(dt);
      if (this.storm) this.storm.update(dt);
    }
    this.updateBullets(dt);
    this.updateGrenades(dt);
    this.updateItems(dt);
    this.updatePickups(dt);
    this.updateEffects(dt);
  };

  // Client mirror: timers and flashes only; positions and state come from snapshots.
  World.prototype.cosmeticTick = function (p, dt) {
    p.meleeSwing = Math.max(0, (p.meleeSwing || 0) - dt);
    p.recoil = Math.max(0, p.recoil - dt * 7);
    p.hitFlash = Math.max(0, p.hitFlash - dt * 6);
    p.healFlash = Math.max(0, p.healFlash - dt * 1.4);
    if (!p.alive) p.deadT += dt;
    if (!p.isLocal && (p.ox || p.oy)) { // the local player's offset is managed by the prediction code
      var k = Math.exp(-dt * 14);
      p.ox *= k; p.oy *= k;
      if (Math.abs(p.ox) + Math.abs(p.oy) < 0.2) { p.ox = 0; p.oy = 0; }
    }
    if (p.alive && p.dropT > 0 && !p.isLocal) p.dropT = Math.max(0, p.dropT - dt);
  };

  World.prototype.updatePlayer = function (p, dt) {
    var intent = this.isPracticeBot(p) ? IDLE : (p.controller && p.controller(p, this, dt)) || IDLE;
    p.meleeSwing = Math.max(0, (p.meleeSwing || 0) - dt);
    p.recoil = Math.max(0, p.recoil - dt * 7);
    p.hitFlash = Math.max(0, p.hitFlash - dt * 6);
    p.healFlash = Math.max(0, p.healFlash - dt * 1.4);
    p.medkitCd = Math.max(0, p.medkitCd - dt);
    p.throwCd = Math.max(0, p.throwCd - dt);
    for (var i = 0; i < p.weapons.length; i++) if (p.weapons[i].cooldown > 0) p.weapons[i].cooldown -= dt;
    var cur = p.weapons[p.slot];
    if (cur.reloading) {
      cur.reloadT -= dt;
      if (cur.reloadT <= 0.00000001) {
        cur.reloading = false; cur.reloadT = 0; cur.ammo = WEAPONS[cur.id].mag;
        this.emit({ type: 'reloaded', player: p, weapon: cur.id });
      }
    }
    if (intent.aimX !== null && intent.aimX !== undefined) p.angle = Math.atan2(intent.aimY - p.y, intent.aimX - p.x);
    p.scoping = false;
    p.wantsRevive = !!intent.iv;
    if (p.dropT > 0) {
      this.tickStamina(p, IDLE, dt);
      p.dropT -= dt;
      if (p.dropT <= 0) { p.dropT = 0; this.land(p); }
      return;
    }
    this.tickEffects(p, dt);
    if (this.updateClassCombat) this.updateClassCombat(p, intent, dt);
    if (!p.alive) return; // poison can finish you off
    if (p.downed) {
      // Knocked down: crawl slowly toward teammates, no weapons, bleed out unless revived.
      p.downT -= dt;
      if (p.downT <= 0) { this.killPlayer(p, null, 'bleedout'); return; }
      this.moveStep(p, intent, dt);
      return;
    }
    if (p.vehicle && this.updateVehiclePlayer) { this.tickStamina(p, IDLE, dt); this.updateVehiclePlayer(p, intent, dt); return; }
    if (p.mount) { this.tickStamina(p, IDLE, dt); this.updateMounted(p, intent, dt); return; } // on a turret: aim and fire it, no walking
    if (intent.interactPressed) this.pressInteract(p);
    if (p.mount || p.vehicle) { this.tickStamina(p, IDLE, dt); return; }
    if (intent.held !== undefined && intent.held !== null) this.selectItem(p, intent.held);
    p.scoping = !!intent.scope && p.held < 0 && !!WEAPONS[cur.id].zoom;
    if (intent.slot !== undefined && intent.slot !== null) this.switchSlot(p, intent.slot);
    if (intent.cycle) this.switchSlot(p, p.held >= 0 ? p.slot : (p.slot + intent.cycle + p.weapons.length * 4) % p.weapons.length);
    if (intent.swap) this.switchSlot(p, p.held >= 0 ? p.slot : p.lastSlot);
    var dropped = !!intent.dropPressed && this.dropHeld(p);
    if (intent.reload) this.startReload(p);
    if (!dropped && intent.utility) this.useUtility(p, intent);
    if (!dropped && (intent.fire || intent.firePressed)) { if (p.held >= 0) this.useHeld(p, intent); else this.trigger(p, intent); }
    this.refreshShield(p);
    this.moveStep(p, intent, dt);
  };

  // Integrate stamina through boundaries instead of granting an entire tick of recovery or sprint
  // when a meter empties, refills, or reaches the standing-rest delay midway through that tick.
  World.prototype.tickStamina = function (p, intent, dt) {
    p.sprinting = false;
    if (!p.alive || !(dt > 0)) return 1;
    var moving = !!(intent.mx || intent.my), canSprint = !p.downed && !p.mount && !p.vehicle && p.dropT <= 0;
    var wants = moving && !!intent.sprint && canSprint, left = dt, sprintTime = 0, epsilon = 1e-9;
    if (p.stamina <= 0) { p.stamina = 0; p.sprintExhausted = true; }
    if (p.stamina >= C.staminaMax) { p.stamina = C.staminaMax; p.sprintExhausted = false; }
    if (!moving) {
      var wait = Math.min(left, Math.max(0, C.staminaRestDelay - p.sprintRestT));
      p.sprintRestT = Math.min(C.staminaRestDelay, p.sprintRestT + wait);
      left -= wait;
      p.stamina = Math.min(C.staminaMax, p.stamina + left * C.staminaRestRegen);
      if (p.stamina >= C.staminaMax - epsilon) { p.stamina = C.staminaMax; p.sprintExhausted = false; }
      return 1;
    }
    p.sprintRestT = 0;
    while (left > epsilon) {
      if (wants && !p.sprintExhausted) {
        var run = Math.min(left, p.stamina / C.staminaDrain);
        p.stamina -= run * C.staminaDrain;
        sprintTime += run; left -= run;
        if (p.stamina <= epsilon) { p.stamina = 0; p.sprintExhausted = true; }
      } else {
        // At full recovery, a held sprint key can take effect for the rest of this step.
        var recover = wants && p.sprintExhausted ? Math.min(left, (C.staminaMax - p.stamina) / C.staminaWalkRegen) : left;
        p.stamina = Math.min(C.staminaMax, p.stamina + recover * C.staminaWalkRegen);
        left -= recover;
        if (p.stamina >= C.staminaMax - epsilon) { p.stamina = C.staminaMax; p.sprintExhausted = false; }
      }
    }
    p.sprinting = wants && !p.sprintExhausted && p.stamina > 0;
    return 1 + (C.sprintSpeedMul - 1) * sprintTime / dt;
  };

  // Movement and stamina: shared by the authoritative world and local prediction/replay.
  World.prototype.moveStep = function (p, intent, dt) {
    if (!p.alive || p.mount || p.vehicle || p.dropT > 0) { this.tickStamina(p, IDLE, dt); return; }
    var mx = intent.mx || 0, my = intent.my || 0, len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    p.inPond = this.inPond(p.x, p.y);
    var sprint = this.tickStamina(p, intent, dt);
    var speed = C.playerSpeed * (p.inPond ? C.pondSpeedMul : 1) * (p.downed ? 0.35 : 1) * this.speedMul(p) * sprint, k = Math.min(1, C.playerAccel * dt);
    if (p.snowFrozen) p.vx = p.vy = 0;
    p.vx += (mx * speed - p.vx) * k;
    p.vy += (my * speed - p.vy) * k;
    // Boosted practice movement must still meet thin walls instead of skipping them.
    var steps = this.practice && p.isLocal && p.practiceSpeed > 1
      ? Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy) * dt / (p.r * 0.5))) : 1;
    for (var step = 0; step < steps; step++) {
      p.x += p.vx * dt / steps;
      p.y += p.vy * dt / steps;
      this.collide(p);
    }
    p.nearStation = this.nearestStation(p.x, p.y, C.stationInteractRadius + p.r);
  };

  // Teammates holding the interact key next to a downed player bring them back up (medics twice as fast).
  World.prototype.updateRevives = function (dt) {
    for (var i = 0; i < this.players.length; i++) {
      var d = this.players[i];
      if (!d.alive || !d.downed) continue;
      var rate = 0;
      for (var j = 0; j < this.players.length; j++) {
        var r = this.players[j];
        if (r === d || r.team !== d.team || !r.alive || r.downed || r.vehicle || !r.wantsRevive || r.dropT > 0) continue;
        if (Math.hypot(r.x - d.x, r.y - d.y) > REVIVE_RANGE + r.r) continue;
        var candidateRate = 1 / (CLASSES[r.classId].reviveSeconds || (r.classId === 'medic' ? 2 : 4));
        if (candidateRate > rate || (candidateRate === rate && CLASSES[r.classId].reviveFraction)) { rate = candidateRate; d.reviver = r; }
      }
      if (rate > 0) {
        d.revive = Math.min(1, d.revive + rate * dt);
        if (d.revive >= 1) this.revivePlayer(d, d.reviver);
      } else {
        d.revive = Math.max(0, d.revive - dt * 0.5);
        d.reviver = null;
      }
    }
  };

  World.prototype.downPlayer = function (p, src, cause) {
    if (this.isPracticeBot(p)) return;
    if (this.stopVehicleRepair) this.stopVehicleRepair(p);
    p.downed = true; p.downT = DOWNED_TIME; p.hp = DOWNED_HP; p.revive = 0; p.reviver = null;
    p.emote = null;
    p.vx = 0; p.vy = 0; p.scoping = false;
    p.sprinting = false;
    if (p.mount) this.dismount(p, true);
    if (p.vehicle && this.exitVehicle) this.exitVehicle(p, true);
    p.held = -1; p.shieldUp = false; p.regen = 0;
    var w = p.weapons[p.slot];
    if (w && w.reloading) { w.reloading = false; w.reloadT = 0; }
    if (src && src !== p) src.stats.knocks++;
    if (!this.remote || !p.hidden) this.explosions.push({ x: p.x, y: p.y, r: p.r * 2.6, t: 0, dur: 0.5, ring: true, color: '#ff5a4f' });
    this.emit({ type: 'downed', player: p, source: src, cause: cause });
  };

  World.prototype.revivePlayer = function (p, by) {
    if (!p.alive || !p.downed) return false;
    p.downed = false; p.downT = 0; p.revive = 0; p.reviver = null;
    p.hp = by && CLASSES[by.classId].reviveFraction ? p.maxHp * CLASSES[by.classId].reviveFraction : Math.min(p.maxHp, REVIVE_HP);
    p.healFlash = 1;
    if (by) by.stats.revives++;
    if (!this.remote || !p.hidden) {
      this.explosions.push({ x: p.x, y: p.y, r: 120, t: 0, dur: 0.6, ring: true, color: '#63ff9e' });
      this.text(p.x, p.y - p.r - 14, 'REVIVED', '#63ff9e', 22);
    }
    this.emit({ type: 'revived', player: p, by: by || null });
    return true;
  };

  // When the last standing member of a team falls, the downed ones are out too.
  World.prototype.checkWipe = function (team, src, cause) {
    if (!this.teams || this.teamStanding(team) > 0) return;
    for (var i = 0; i < this.players.length; i++) {
      var o = this.players[i];
      if (o.team === team && o.alive && o.downed) this.killPlayer(o, src, 'wiped');
    }
  };

  World.prototype.collide = function (p) {
    if (p.mount && this.structById) {
      var seat = this.structById(p.mount);
      if (seat && seat.alive) { p.x = seat.x; p.y = seat.y; p.vx = p.vy = 0; return; }
    }
    for (var iter = 0; iter < 3; iter++) {
      var moved = false;
      this.solids.query(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r, function (s) {
        if ((s.crate && (!s.crate.alive || (p.vehicleCrates && p.vehicleCrates[s.crate.id]))) || (s.rock && (!s.rock.alive || (p.vehicleRocks && p.vehicleRocks[s.rock.id]))) || (s.struct && (!s.struct.alive || (p.vehicleStructRocks && p.vehicleStructRocks[s.struct.id])))) return;
        var px, py;
        if (s.shape === 'circle') {
          var dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy), min = s.r + p.r;
          if (d >= min) return;
          if (d < 1e-4) { dx = 1; dy = 0; d = 1; }
          px = dx / d * (min - d); py = dy / d * (min - d);
        } else {
          var push = U.circleRectPush(p.x, p.y, p.r, s.x, s.y, s.w, s.h);
          if (!push) return;
          px = push.x; py = push.y;
        }
        p.x += px; p.y += py; moved = true;
        var pl = Math.hypot(px, py);
        if (pl > 1e-6) {
          var nx = px / pl, ny = py / pl, vn = p.vx * nx + p.vy * ny;
          if (vn < 0) { p.vx -= vn * nx; p.vy -= vn * ny; }
        }
      });
      if (!moved) break;
    }
    U.clampToIsland(p, p.r, C.worldSize, C.cornerRadius);
    if (this.collideVehicles) this.collideVehicles(p);
  };

  World.prototype.separatePlayers = function () {
    var ps = this.players;
    for (var i = 0; i < ps.length; i++) {
      var a = ps[i];
      if (!a.alive || a.dropT > 0 || a.vehicle || a.mount) continue;
      for (var j = i + 1; j < ps.length; j++) {
        var b = ps[j];
        if (!b.alive || b.dropT > 0 || b.vehicle || b.mount) continue;
        var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
        if (d >= min || d < 1e-4) continue;
        var push = (min - d) / 2, nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      }
    }
  };

  World.prototype.inPond = function (x, y) {
    var ps = this.map.ponds;
    for (var i = 0; i < ps.length; i++) if (Math.hypot(ps[i].x - x, ps[i].y - y) < ps[i].r * 0.9) return true;
    return false;
  };

  World.prototype.nearestStation = function (x, y, maxD) {
    var best = null, bd = maxD, list = this.map.stations;
    for (var i = 0; i < list.length; i++) {
      var d = Math.hypot(list[i].x - x, list[i].y - y);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return best;
  };

  // ---------------------------------------------------------------- weapons
  World.prototype.switchSlot = function (p, slot) {
    if (slot < 0 || slot >= p.weapons.length) return;
    if (p.held >= 0) {
      // Putting an item away: back to the weapon, even if it is the same slot as before.
      p.held = -1; p.shieldUp = false;
      if (slot === p.slot) { this.emit({ type: 'switch', player: p }); return; }
    }
    if (slot === p.slot) return;
    var cur = p.weapons[p.slot];
    if (cur.reloading) { cur.reloading = false; cur.reloadT = 0; }
    p.lastSlot = p.slot;
    p.slot = slot;
    var next = p.weapons[slot];
    next.cooldown = Math.max(next.cooldown, 0.12);
    this.emit({ type: 'switch', player: p });
  };

  World.prototype.startReload = function (p) {
    var w = p.weapons[p.slot], def = WEAPONS[w.id];
    if (!def.mag || w.reloading || w.ammo >= def.mag) return false;
    w.reloading = true;
    w.reloadT = def.reload;
    this.emit({ type: 'reload', player: p, weapon: w.id });
    return true;
  };

  World.prototype.trigger = function (p, intent) {
    var w = p.weapons[p.slot], def = WEAPONS[w.id];
    if (def.kind === 'gun' || def.kind === 'launcher') {
      if ((def.semiAuto || def.kind === 'launcher') && !intent.firePressed) return;
      if (w.reloading || w.cooldown > 0.00000001) return;
      if (w.ammo < (def.roundsPerShot || 1)) { this.startReload(p); return; }
      if (p.automaticWeapon !== w.id) w.cooldown = Math.max(0, w.cooldown);
      p.automaticWeapon = w.id;
      var fired = 0, interval = def.fireInterval / (this.fireRateMul ? this.fireRateMul(p) : 1);
      do {
        w.ammo -= def.roundsPerShot || 1; w.cooldown += interval; p.stats.shots++; fired++;
        if (def.kind === 'gun') this.fireGun(p, def); else this.fireLauncher(p, def, intent);
        if (w.ammo <= 0) { this.startReload(p); break; }
      } while (def.kind === 'gun' && !def.semiAuto && intent.fire && w.cooldown <= 0.00000001 && fired < 8);
    } else if (intent.firePressed) {
      if (def.kind === 'throwable') this.throwGrenade(p, intent);
      else if (def.kind === 'medkit') this.useMedkit(p);
    }
  };

  // F / right click: the class's gear (medkit or hand grenade) without switching weapons.
  World.prototype.useUtility = function (p, intent) {
    for (var i = 0; i < p.weapons.length; i++) {
      var kind = WEAPONS[p.weapons[i].id].kind;
      if (kind === 'throwable') return this.throwGrenade(p, Object.assign({}, intent, { charge: intent.utilityCharge === undefined ? intent.charge : intent.utilityCharge }));
      if (kind === 'medkit') return this.useMedkit(p);
    }
    this.emit({ type: 'deny', player: p, reason: 'nogear' });
    return false;
  };

  World.prototype.fireGun = function (p, def) {
    var n = def.pellets || def.roundsPerShot || 1, angles = [];
    for (var i = 0; i < n; i++) {
      var a = p.angle;
      if (n > 1) a += (i / (n - 1) - 0.5) * 2 * def.spread + (this.rng.next() - 0.5) * def.spread * 0.3;
      else a += (this.rng.next() - 0.5) * 2 * def.spread;
      angles.push(a);
    }
    this.spawnShot(p, def, angles);
    this.emit({ type: 'shot', player: p, weapon: def.id, x: p.x, y: p.y, angles: angles });
  };

  // Bullets for one trigger pull. Also used by the client to mirror shots the server reports.
  World.prototype.spawnShot = function (p, def, angles) {
    var n = angles.length, shot = def.pellets && n > 1 ? { hit: {} } : null, muzzle = W.muzzleLength(def.id) * p.r;
    for (var i = 0; i < n; i++) {
      var a = angles[i];
      var b = {
        owner: p.id, team: p.team, color: p.color, outline: p.outline, weapon: def.id, damage: def.damage || 0, shot: shot,
        x: p.x, y: p.y, ox: p.x, oy: p.y, dx: Math.cos(a), dy: Math.sin(a),
        speed: def.bulletSpeed * (n > 1 ? 0.9 + this.rng.next() * 0.2 : 1), traveled: 0, range: def.range, r: def.bulletRadius
      };
      // Bullets start at the player's center and sweep out to the muzzle, so a barrel poking through a wall cannot shoot through it.
      if (this.advanceBullet(b, muzzle)) this.bullets.push(b);
    }
    var ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    if (!this.remote) { p.vx -= ca * def.recoil; p.vy -= sa * def.recoil; }
    p.recoil = 1;
    this.flash(p.x + ca * muzzle, p.y + sa * muzzle, p.angle, def.id);
  };

  // One deterministic ground path + height arc for the preview, server and mirror.
  World.prototype.aimedProjectile = function (p) {
    if (p.mount || p.vehicle) return null; // Mounted fire belongs to the turret, regardless of the equipped weapon.
    var held = this.heldItem(p);
    if (p.held >= 0 && !held) return null;
    if (held) return held.kind === 'throw' ? held.id : null;
    var w = p.weapons[p.slot], def = w && WEAPONS[w.id];
    return def && (def.kind === 'launcher' || def.kind === 'throwable') ? def.id : null;
  };
  World.prototype.safeGrenadeLanding = function (x, y, r, fromX, fromY) {
    var point = { x: x, y: y };
    for (var iter = 0; iter < 5; iter++) {
      var moved = false;
      this.solids.query(point.x - r, point.y - r, point.x + r, point.y + r, function (s) {
        if ((s.crate && !s.crate.alive) || (s.rock && !s.rock.alive) || (s.struct && !s.struct.alive)) return;
        var push;
        if (s.shape === 'circle') {
          var dx = point.x - s.x, dy = point.y - s.y, d = Math.hypot(dx, dy), min = s.r + r + 1;
          if (d >= min) return;
          if (d < 0.001) { dx = fromX - s.x; dy = fromY - s.y; d = Math.hypot(dx, dy); if (d < 0.001) { dx = 1; dy = 0; d = 1; } }
          push = { x: dx / d * (min - Math.hypot(point.x - s.x, point.y - s.y)), y: dy / d * (min - Math.hypot(point.x - s.x, point.y - s.y)) };
        } else push = U.circleRectPush(point.x, point.y, r + 1, s.x, s.y, s.w, s.h);
        if (push) { point.x += push.x; point.y += push.y; moved = true; }
      });
      U.clampToIsland(point, r + 1, C.worldSize, C.cornerRadius);
      if (!moved) break;
    }
    return point;
  };
  World.prototype.throwSolution = function (p, aim, weaponId) {
    aim = aim || {};
    var id = weaponId || this.aimedProjectile(p) || 'grenade', def = WEAPONS[id] || WEAPONS.grenade, item = W.ITEMS[id];
    var launcher = def.kind === 'launcher', maxRange = launcher ? def.range : WEAPONS.grenade.throwRange;
    var ax = aim.aimX === undefined ? aim.x : aim.aimX, ay = aim.aimY === undefined ? aim.y : aim.aimY;
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) { ax = p.x + Math.cos(p.angle) * maxRange; ay = p.y + Math.sin(p.angle) * maxRange; }
    var dx = ax - p.x, dy = ay - p.y, d = Math.hypot(dx, dy), ux = d > 0.001 ? dx / d : Math.cos(p.angle), uy = d > 0.001 ? dy / d : Math.sin(p.angle);
    // Aim chooses the direction only. Range comes from how long the trigger was held.
    var charge = Number.isFinite(aim.charge) ? U.clamp(aim.charge, 0, C.projectileChargeTime) : 0;
    var distance = U.lerp(launcher ? def.minRange : 70, maxRange, charge / C.projectileChargeTime), start = Math.min(p.r + 10, distance * 0.35);
    var end = this.safeGrenadeLanding(p.x + ux * distance, p.y + uy * distance, launcher ? 8 : 9, p.x, p.y);
    var sx = p.x + ux * start, sy = p.y + uy * start, travel = Math.hypot(end.x - sx, end.y - sy);
    var duration = launcher ? Math.max(0.12, travel / def.projectileSpeed) : 0.35 + travel / 900;
    return { weapon: launcher ? id : 'grenade', item: item && item.kind === 'throw' ? id : null,
      x: sx, y: sy, startX: sx, startY: sy, targetX: end.x, targetY: end.y,
      vx: (end.x - sx) / duration, vy: (end.y - sy) / duration,
      flightTime: duration, peakHeight: (launcher ? 65 : 70) + travel * 0.16, range: distance,
      radius: item ? item.radius : def.explosion.radius, travel: travel };
  };
  World.prototype.trajectoryPoint = function (solution, progress) {
    var k = U.clamp(progress, 0, 1);
    return { x: U.lerp(solution.startX, solution.targetX, k), y: U.lerp(solution.startY, solution.targetY, k), z: 4 * solution.peakHeight * k * (1 - k) };
  };
  World.prototype.projectileEvent = function (g) {
    return { weapon: g.weapon, x: g.startX, y: g.startY, vx: g.vx, vy: g.vy,
      startX: g.startX, startY: g.startY, targetX: g.targetX, targetY: g.targetY, flightTime: g.flightTime, peakHeight: g.peakHeight };
  };
  World.prototype.fireLauncher = function (p, def, intent) {
    var solution = this.throwSolution(p, intent, def.id), g = this.spawnShell(p, solution);
    this.emit(Object.assign({ type: 'launch', player: p, travel: g.maxTravel }, this.projectileEvent(g)));
  };

  World.prototype.spawnShell = function (p, s) {
    var def = WEAPONS[s.weapon] && WEAPONS[s.weapon].kind === 'launcher' ? WEAPONS[s.weapon] : WEAPONS.launcher;
    var speed = Math.hypot(s.vx, s.vy) || def.projectileSpeed, duration = s.flightTime || (s.travel || def.range) / speed;
    var sx = s.startX === undefined ? s.x : s.startX, sy = s.startY === undefined ? s.y : s.startY;
    var tx = s.targetX === undefined ? sx + s.vx * duration : s.targetX, ty = s.targetY === undefined ? sy + s.vy * duration : s.targetY;
    var g = { id: this.nextId++, kind: 'launcher', weapon: def.id, owner: p.id, team: p.team,
      x: sx, y: sy, x0: sx, y0: sy, startX: sx, startY: sy, targetX: tx, targetY: ty,
      vx: (tx - sx) / duration, vy: (ty - sy) / duration, traveled: 0, maxTravel: Math.hypot(tx - sx, ty - sy),
      flightTime: duration, flightElapsed: 0, peakHeight: s.peakHeight || 65 + Math.hypot(tx - sx, ty - sy) * 0.16,
      air: duration, z: 0, explosion: def.explosion, landFuse: def.landFuse, r: 8, age: 0 };
    this.grenades.push(g);
    var ca = Math.cos(p.angle), sa = Math.sin(p.angle), muzzle = W.muzzleLength(def.id) * p.r;
    if (!this.remote) { p.vx -= ca * def.recoil; p.vy -= sa * def.recoil; }
    p.recoil = 1;
    this.flash(p.x + ca * muzzle, p.y + sa * muzzle, p.angle, def.id);
    return g;
  };

  World.prototype.throwGrenade = function (p, intent) {
    if (p.grenades <= 0) { this.emit({ type: 'deny', player: p, reason: 'nogrenades' }); return false; }
    if (p.throwCd > 0) return false;
    var def = WEAPONS.grenade, ax = intent && intent.aimX, ay = intent && intent.aimY;
    if (ax === null || ax === undefined) {
      ax = p.x + Math.cos(p.angle) * def.throwRange;
      ay = p.y + Math.sin(p.angle) * def.throwRange;
    }
    var g = this.lob(p, ax, ay, def.fuse, null, intent && intent.charge);
    p.grenades--;
    p.throwCd = def.cooldown;
    this.emit(Object.assign({ type: 'throw', player: p, left: p.grenades, fuse: g.fuse }, this.projectileEvent(g)));
    return true;
  };

  // All grenades follow the preview's arc and clear walls while airborne.
  World.prototype.lob = function (p, ax, ay, fuse, item, charge) {
    var solution = this.throwSolution(p, { aimX: ax, aimY: ay, charge: charge }, item || 'grenade');
    var g = this.spawnGrenade(p, Object.assign(solution, { fuse: fuse, item: item }));
    p.recoil = 0.7;
    return g;
  };

  World.prototype.spawnGrenade = function (p, s) {
    // Landing-triggered items stay that way when an online event includes the
    // server's placeholder fuse, rather than the item's original zero fuse.
    var it = s.item ? W.ITEMS[s.item] : null, instant = !!it && it.fuse === 0;
    var duration = s.flightTime || 0.55, sx = s.startX === undefined ? s.x : s.startX, sy = s.startY === undefined ? s.y : s.startY;
    var tx = s.targetX === undefined ? sx + s.vx / 3.2 : s.targetX, ty = s.targetY === undefined ? sy + s.vy / 3.2 : s.targetY;
    var g = {
      id: this.nextId++, kind: 'hand', weapon: 'grenade', owner: p.id, team: p.team, x: sx, y: sy, vx: (tx - sx) / duration, vy: (ty - sy) / duration, friction: 3.2,
      startX: sx, startY: sy, targetX: tx, targetY: ty, flightTime: duration, flightElapsed: 0, peakHeight: s.peakHeight || 100, z: 0,
      fuse: instant ? 1 : s.fuse, maxFuse: instant ? 1 : s.fuse, air: duration, age: 0, r: 9, spin: 0,
      item: s.item || null, instant: instant, radius: it ? it.radius : WEAPONS.grenade.explosion.radius,
      explosion: it ? (it.explosion || null) : WEAPONS.grenade.explosion
    };
    this.grenades.push(g);
    return g;
  };

  // The medkit heals you and any teammates close by.
  World.prototype.useMedkit = function (p) {
    var kit = p.weapons.map(function (w) { return WEAPONS[w.id]; }).filter(function (w) { return w.kind === 'medkit'; })[0];
    if (!kit) return false;
    if (p.medkitCd > 0) { this.emit({ type: 'deny', player: p, reason: 'medkit', value: p.medkitCd }); return false; }
    var self = this, targets = [p].concat(this.teammates(p).filter(function (o) {
      return o.alive && (!o.downed || kit.reviveFraction) && o.dropT <= 0 && Math.hypot(o.x - p.x, o.y - p.y) <= TEAM_HEAL_RANGE;
    })).filter(function (o) { return o.downed || o.hp < o.maxHp; });
    if (!targets.length) { this.emit({ type: 'deny', player: p, reason: 'fullhp' }); return false; }
    p.medkitCd = kit.cooldown;
    targets.forEach(function (o) {
      if (o.downed && kit.reviveFraction) { self.revivePlayer(o, p); return; }
      var healed = Math.min(kit.heal, o.maxHp - o.hp);
      o.hp += healed;
      p.stats.healed += healed;
      self.healFx(o, healed);
      self.emit({ type: 'heal', player: o, by: p, amount: healed });
    });
    if (WEAPONS[p.weapons[p.slot].id].kind === 'medkit') this.switchSlot(p, p.lastSlot !== p.slot ? p.lastSlot : 0);
    return true;
  };

  World.prototype.healFx = function (p, healed) {
    p.healFlash = 1;
    if (this.remote && p.hidden) return;
    this.text(p.x, p.y - p.r - 12, '+' + Math.round(healed) + ' HP', '#63ff9e', 22);
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * U.TAU;
      this.particles.push({ kind: 'cross', x: p.x + Math.cos(a) * p.r, y: p.y + Math.sin(a) * p.r, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40 - 50,
        life: 0.9, max: 0.9, size: 6, color: '#63ff9e', drag: 1.5 });
    }
  };

  // ---------------------------------------------------------------- projectiles
  // Nearest thing a moving circle of radius br hits along a segment: a solid, a live crate, a structure or an enemy
  // player. Teammates (and your team's own turrets and sentries) never block or take a shot; rocks block everyone.
  World.prototype.sweep = function (x1, y1, x2, y2, br, ownerId, ownerTeam) {
    var bestT = 2, best = null, bestPlayer = null, teamed = ownerTeam !== undefined && ownerTeam !== null;
    this.solids.query(Math.min(x1, x2) - br, Math.min(y1, y2) - br, Math.max(x1, x2) + br, Math.max(y1, y2) + br, function (s) {
      if (s.crate && !s.crate.alive) return;
      if (s.rock && !s.rock.alive) return;
      if (s.struct && (!s.struct.alive || (teamed && s.struct.team === ownerTeam && s.struct.kind !== 'rock'))) return; // rocks block everyone
      var t = s.shape === 'circle'
        ? U.segCircle(x1, y1, x2, y2, s.x, s.y, s.r + br)
        : U.segRect(x1, y1, x2, y2, s.x - br, s.y - br, s.w + br * 2, s.h + br * 2);
      if (t >= 0 && t < bestT) { bestT = t; best = s; }
    });
    this.foliage.query(Math.min(x1, x2) - br, Math.min(y1, y2) - br, Math.max(x1, x2) + br, Math.max(y1, y2) + br, function (plant) {
      if (plant.alive === false) return;
      var t = U.segCircle(x1, y1, x2, y2, plant.x, plant.y, plant.hitRadius + br);
      if (t >= 0 && t < bestT) { bestT = t; best = { type: 'foliage', plant: plant }; }
    });
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.alive || p.id === ownerId || p.dropT > 0 || p.vehicle) continue;
      // Hidden client replicas have no current position; only the server can hit them.
      if (this.remote && p.hidden) continue;
      if (teamed && p.team === ownerTeam) continue;
      var t = U.segCircle(x1, y1, x2, y2, p.x, p.y, p.r + br);
      if (t >= 0 && t < bestT) { bestT = t; best = null; bestPlayer = p; }
    }
    var owner = this.playerById(ownerId), vehicles = this.vehicles || [];
    for (var j = 0; j < vehicles.length; j++) {
      var v = vehicles[j];
      if (this.remote && v.hidden) continue;
      if (owner && owner.vehicle === v.id) continue;
      if (!v.wreck && teamed && this.vehicleTeam && this.vehicleTeam(v) === ownerTeam) continue;
      var vt = U.segCircle(x1, y1, x2, y2, v.x, v.y, v.r + br);
      if (vt >= 0 && vt < bestT) { bestT = vt; bestPlayer = null; best = { type: 'vehicle', shape: 'circle', x: v.x, y: v.y, r: v.r, vehicle: v }; }
    }
    if (!best && !bestPlayer) return null;
    return { t: bestT, solid: best, player: bestPlayer };
  };

  // Walls, rocks and placed structures block explosions and line of sight.
  World.prototype.lineClear = function (x1, y1, x2, y2, ignore, demolition, ignoreVehicle) {
    var clear = true;
    this.solids.query(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), function (s) {
      if (!clear || (ignore && (s === ignore || s.rock === ignore || s.struct === ignore)) || (s.type !== 'wall' && s.type !== 'rock' && s.type !== 'struct')) return;
      if (demolition && (s.type === 'rock' || (s.struct && s.struct.kind === 'rock'))) return;
      if (s.rock && !s.rock.alive) return;
      if (s.struct && !s.struct.alive) return;
      var t = s.shape === 'circle' ? U.segCircle(x1, y1, x2, y2, s.x, s.y, s.r) : U.segRect(x1, y1, x2, y2, s.x, s.y, s.w, s.h);
      if (t >= 0 && t < 0.999) clear = false;
    });
    var vehicles = this.vehicles || [];
    for (var i = 0; clear && i < vehicles.length; i++) {
      var v = vehicles[i];
      if (this.remote && v.hidden) continue;
      if (v === ignore || v === ignoreVehicle || (ignore && ignore.vehicle === v)) continue;
      var t = U.segCircle(x1, y1, x2, y2, v.x, v.y, v.r);
      if (t >= 0 && t < 0.999) clear = false;
    }
    return clear;
  };

  World.prototype.advanceBullet = function (b, step) {
    var last = false;
    if (b.traveled + step >= b.range) { step = b.range - b.traveled; last = true; }
    var x2 = b.x + b.dx * step, y2 = b.y + b.dy * step, hit = this.sweep(b.x, b.y, x2, y2, b.r, b.owner, b.team);
    if (hit) {
      this.bulletHit(b, hit, b.x + (x2 - b.x) * hit.t, b.y + (y2 - b.y) * hit.t);
      return false;
    }
    b.x = x2; b.y = y2; b.traveled += step;
    if (last) {
      this.particles.push({ kind: 'dot', x: b.x, y: b.y, vx: 0, vy: 0, life: 0.18, max: 0.18, size: b.r, color: b.color, drag: 0 });
      return false;
    }
    return true;
  };

  World.prototype.bulletHit = function (b, hit, hx, hy) {
    var target = null, key = null, struct = null, vehicle = null, plant = null;
    if (hit.player) { target = hit.player; key = 'p' + target.id; }
    else if (hit.solid.type === 'crate') { target = hit.solid.crate; key = 'c' + target.id; }
    else if (hit.solid.type === 'struct' && hit.solid.struct.maxHp) { struct = hit.solid.struct; key = 's' + struct.id; }
    else if (hit.solid.type === 'vehicle') { vehicle = hit.solid.vehicle; key = 'v' + vehicle.id; }
    else if (hit.solid.type === 'foliage') { plant = hit.solid.plant; key = plant.foliageKind + plant.id; }
    if (!target && !struct && !vehicle && !plant) { this.sparks(hx, hy, b.dx, b.dy, SPARK[hit.solid.type] || '#dddddd', 4); return; }
    var color = hit.player ? target.color : vehicle ? '#c8d0ad' : struct ? SPARK.rock : SPARK.crate;
    if (this.remote) { this.sparks(hx, hy, b.dx, b.dy, color, 5); return; } // damage arrives from the server
    if (b.shot) {
      if (b.shot.hit[key]) return; // one shotgun blast damages each target once; extra pellets are absorbed
      b.shot.hit[key] = true;
    }
    var weapon = WEAPONS[b.weapon], distance = Math.hypot(hx - b.ox, hy - b.oy);
    var dmg = weapon && weapon.pellets ? Rules.shotgunDamage(distance, weapon) : b.damage;
    if (weapon && weapon.damageRampRange) dmg = weapon.damage + (weapon.damageMax - weapon.damage) * U.clamp(distance / weapon.damageRampRange, 0, 1);
    if (hit.player) this.damagePlayer(target, dmg, b.owner, b.weapon, hx, hy, { x: hx - b.dx * 40, y: hy - b.dy * 40 });
    else if (vehicle && this.damageVehicle) {
      var occupants = b.shot ? Object.keys(vehicle.seats).map(function (seat) { return vehicle.seats[seat]; }) : [];
      this.damageVehicle(vehicle, dmg, b.owner, b.weapon, hx, hy);
      if (b.shot && vehicle.wreck) occupants.forEach(function (id) { if (id) b.shot.hit['p' + id] = true; });
    }
    else if (struct) this.damageStruct(struct, dmg, b.owner, hx, hy, b.weapon);
    else if (plant) this.damageFoliage(plant, dmg, b.owner, b.weapon);
    else this.damageCrate(target, dmg, b.owner, hx, hy);
    this.sparks(hx, hy, b.dx, b.dy, color, 5);
  };

  World.prototype.updateBullets = function (dt) {
    var out = [];
    for (var i = 0; i < this.bullets.length; i++) {
      var b = this.bullets[i];
      if (this.advanceBullet(b, b.speed * dt)) out.push(b);
    }
    this.bullets = out;
  };

  // Launcher shells clear intervening cover and start their fuse at the endpoint.
  World.prototype.advanceShell = function (g, step) {
    g.traveled = Math.min(g.maxTravel, g.traveled + step);
    var progress = g.maxTravel > 0 ? g.traveled / g.maxTravel : 1, point = this.trajectoryPoint(g, progress);
    g.x = point.x; g.y = point.y; g.z = point.z; g.flightElapsed = progress * g.flightTime;
    if (progress >= 1) return this.landShell(g, g.targetX, g.targetY);
    return true;
  };

  World.prototype.landShell = function (g, x, y) {
    g.kind = 'hand'; g.shell = true; g.landed = this.time;
    var point = this.safeGrenadeLanding(x, y, g.r, g.startX, g.startY);
    g.x = point.x; g.y = point.y; g.z = 0; g.vx = 0; g.vy = 0; g.friction = 3.2; g.air = 0; g.spin = 0;
    g.fuse = g.landFuse === undefined ? WEAPONS.launcher.landFuse : g.landFuse; g.maxFuse = g.fuse;
    this.particles.push({ kind: 'dot', x: x, y: y, vx: 0, vy: 0, life: 0.2, max: 0.2, size: 10, color: '#d8c25a', drag: 0 });
    this.emit({ type: 'shell-land', x: g.x, y: g.y, owner: g.owner, weapon: g.weapon });
    return true;
  };

  World.prototype.updateHand = function (g, dt) {
    g.age += dt;
    g.fuse -= dt;
    g.spin += dt * Math.hypot(g.vx, g.vy) * 0.03;
    if (g.air > 0) {
      g.flightElapsed = Math.min(g.flightTime, g.flightElapsed + dt);
      var point = this.trajectoryPoint(g, g.flightElapsed / g.flightTime);
      g.x = point.x; g.y = point.y; g.z = point.z;
      if (g.flightElapsed >= g.flightTime) {
        point = this.safeGrenadeLanding(g.targetX, g.targetY, g.r, g.startX, g.startY);
        g.x = point.x; g.y = point.y; g.z = 0; g.air = 0; g.vx = 0; g.vy = 0; g.landed = this.time;
      }
    }
    var done = g.air <= 0 && (g.instant || g.fuse <= 0);
    if (done) {
      // On the client the server's burst event draws the effect, so cosmetic grenades just vanish.
      if (!this.remote) this.detonate(g);
      return false;
    }
    return true;
  };

  World.prototype.detonate = function (g) {
    if (g.item) this.itemBurst(g.item, g.x, g.y, g.owner);
    else this.explode(g.x, g.y, g.explosion, g.owner, g.weapon || (g.shell ? 'launcher' : 'grenade'));
  };

  World.prototype.updateGrenades = function (dt) {
    var out = [];
    for (var i = 0; i < this.grenades.length; i++) {
      var g = this.grenades[i], alive;
      if (g.kind === 'hand') alive = this.updateHand(g, dt);
      else {
        g.age += dt;
        alive = this.advanceShell(g, Math.hypot(g.vx, g.vy) * dt);
        if (alive && g.kind === 'launcher' && this.rng.next() < 0.7) {
          this.particles.push({ kind: 'smoke', x: g.x, y: g.y - (g.z || 0), vx: 0, vy: 0, life: 0.45, max: 0.45, size: 5, grow: 18, color: '#d9d9d9', drag: 0 });
        }
      }
      if (alive) out.push(g);
    }
    this.grenades = out;
  };

  World.prototype.damageFoliage = function (plant, amount, sourceId, cause) {
    if (this.remote || !plant || plant.foliageKind !== 'cacti' || plant.alive === false || !(amount > 0)) return false;
    plant.hp = Math.max(0, plant.hp - amount);
    if (!plant.hp) {
      plant.alive = false;
      this.map.foliageVersion = (this.map.foliageVersion || 0) + 1;
      this.burst(plant.x, plant.y, 14, plant.foliageKind === 'cacti' ? '#7aab52' : '#a6ba67', 140, 0.6, 6);
    }
    this.emit({ type: 'foliage', plant: plant, source: sourceId || 0, cause: cause });
    return true;
  };
  World.prototype.damageFoliageInArea = function (x, y, radius, amount, sourceId, cause, throughCover) {
    if (this.remote) return;
    var self = this, hits = [];
    this.foliage.query(x - radius, y - radius, x + radius, y + radius, function (plant) {
      if (plant.alive === false || Math.hypot(plant.x - x, plant.y - y) - plant.hitRadius >= radius) return;
      if (throughCover || self.lineClear(x, y, plant.x, plant.y)) hits.push(plant);
    });
    hits.forEach(function (plant) { self.damageFoliage(plant, typeof amount === 'function' ? amount(plant) : amount, sourceId, cause); });
  };
  World.prototype.updateCactusContacts = function () {
    var self = this;
    this.players.forEach(function (p) {
      if (!p.alive || p.vehicle || p.dropT > 0) return;
      var contacts = {};
      self.foliage.query(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r, function (plant) {
        if (plant.foliageKind !== 'cacti' || plant.alive === false || Math.hypot(p.x - plant.x, p.y - plant.y) >= p.r + plant.r) return;
        var until = p.cactusUntil && p.cactusUntil[plant.id] || 0;
        if (until <= self.time) { self.damagePlayer(p, 8, null, 'cactus'); until = self.time + 1; }
        contacts[plant.id] = until;
      });
      p.cactusUntil = contacts;
    });
  };

  // Heavy vehicle impacts break natural rocks outright, without a health state.
  World.prototype.damageMapRock = function (rock, cause, sourceId, hx, hy) {
    if (this.remote || !rock || rock.alive === false || this.map.rocks.indexOf(rock) < 0 || (cause !== 'tankram' && cause !== 'tank-cannon' && cause !== 'artillery')) return false;
    return this.destroyRock(rock, sourceId);
  };
  World.prototype.damageMapRocksInArea = function (x, y, radius, cause, sourceId, throughCover) {
    if (this.remote || (cause !== 'tankram' && cause !== 'tank-cannon' && cause !== 'artillery')) return 0;
    var candidates = [], self = this;
    this.solids.query(x - radius, y - radius, x + radius, y + radius, function (s) {
      if (s.type !== 'rock' || !s.rock || !s.rock.alive || Math.hypot(s.x - x, s.y - y) - s.r > radius) return;
      if (candidates.indexOf(s.rock) < 0) candidates.push(s.rock);
    });
    var hits = candidates.filter(function (rock) { return throughCover || self.lineClear(x, y, rock.x, rock.y, rock); });
    // Determine cover before breaking anything, so one blast cannot propagate through a rock it just removed.
    var damaged = 0;
    hits.forEach(function (rock) { if (self.damageMapRock(rock, cause, sourceId)) damaged++; });
    return damaged;
  };
  World.prototype.destroyRock = function (rock, sourceId) {
    if (!rock || rock.alive === false) return false;
    rock.alive = false;
    this.burst(rock.x, rock.y, 20, '#a5afb9', 260, 0.7, 8);
    this.smoke(rock.x, rock.y, 12, '#a0a3a8', Math.min(rock.r, 45), 0.9, 130);
    if (!this.remote) this.emit({ type: 'rock-gone', rock: rock, source: sourceId || 0 });
    return true;
  };

  // Explosions hurt their owner; other teammates stay protected. Launcher II demolishes crates,
  // while heavy cannons break natural rocks and portable boulders stay solid.
  World.prototype.explode = function (x, y, ex, ownerId, cause) {
    var R = ex.radius, self = this, crates = [], hitMounts = {}, i;
    var owner = ownerId ? this.playerById(ownerId) : null, ownerTeam = owner ? owner.team : null;
    if (!this.remote) {
      for (i = 0; i < this.players.length; i++) {
        var p = this.players[i];
        if (!p.alive || p.vehicle || p.dropT > 0 || (p.id !== ownerId && ownerTeam !== null && p.team === ownerTeam)) continue;
        var d = Math.hypot(p.x - x, p.y - y) - p.r;
        if (d >= R || !this.lineClear(x, y, p.x, p.y, p.mount ? this.structById(p.mount) : null)) continue;
        var dmg = Rules.explosionDamage(ex.maxDamage, R, d);
        if (dmg > 0) { if (p.mount) hitMounts[p.mount] = true; this.damagePlayer(p, dmg, ownerId, cause, p.x, p.y - p.r, { x: x, y: y }); }
      }
      // Collect first, then damage: lineClear queries the same spatial hash.
      var structs = [];
      this.solids.query(x - R, y - R, x + R, y + R, function (s) {
        if (s.type === 'crate' && s.crate.alive) crates.push(s);
        else if (s.type === 'struct' && s.struct.alive && s.struct.maxHp && (ownerTeam === null || s.struct.team !== ownerTeam)) structs.push(s.struct);
      });
      crates.forEach(function (s) {
        var nx = U.clamp(x, s.x, s.x + s.w), ny = U.clamp(y, s.y, s.y + s.h), d2 = Math.hypot(x - nx, y - ny);
        if (d2 >= R || !self.lineClear(x, y, nx, ny)) return;
        var dmg2 = ex.demolition ? s.crate.hp : Rules.explosionDamage(ex.maxDamage, R, d2);
        if (dmg2 > 0) self.damageCrate(s.crate, dmg2, ownerId, s.crate.x, s.crate.y - s.h / 2);
      });
      structs.forEach(function (s) {
        if (hitMounts[s.id]) return;
        var d3 = Math.hypot(x - s.x, y - s.y) - s.r;
        if (d3 >= R || !self.lineClear(x, y, s.x, s.y, s)) return;
        var dmg3 = Rules.explosionDamage(ex.maxDamage, R, Math.max(0, d3));
        if (dmg3 > 0) self.damageStruct(s, dmg3, ownerId, s.x, s.y - s.r, cause);
      });
      if (this.damageVehiclesInArea) this.damageVehiclesInArea(x, y, R, function (v) {
        return Rules.explosionDamage(ex.maxDamage, R, Math.max(0, Math.hypot(v.x - x, v.y - y) - v.r));
      }, ownerId, cause, { lineOfSight: true });
      if (cause === 'tank-cannon') this.damageMapRocksInArea(x, y, R, cause, ownerId, false);
      this.damageFoliageInArea(x, y, R, function (plant) {
        return Rules.explosionDamage(ex.maxDamage, R, Math.max(0, Math.hypot(plant.x - x, plant.y - y) - plant.hitRadius));
      }, ownerId, cause);
    }
    this.explosions.push({ x: x, y: y, r: R, t: 0, dur: 0.6, power: ex.maxDamage });
    var big = ex.maxDamage >= 80;
    for (i = 0; i < (big ? 22 : 14); i++) {
      var a = this.rng.next() * U.TAU, sp = (big ? 260 : 190) * (0.4 + this.rng.next() * 0.8);
      this.particles.push({ kind: 'dot', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, max: 0.5,
        size: 5 + this.rng.next() * 6, color: this.rng.chance(0.5) ? '#ffb347' : '#ffe08a', drag: 3.5 });
    }
    this.smoke(x, y, big ? 12 : 8, '#8f8f8f', big ? 22 : 16, 1.1, big ? 120 : 90);
    this.emit({ type: 'explosion', x: x, y: y, power: ex.maxDamage, owner: ownerId, cause: cause });
  };

  // ---------------------------------------------------------------- damage
  // Intrinsic class bonuses apply at the final recipient, including fixed-damage
  // abilities and vehicle weapons; potion and command bonuses keep their own rules.
  World.prototype.outgoingClassDamageMul = function (p) {
    return 1 + (p && CLASSES[p.classId] ? CLASSES[p.classId].damageBonus || 0 : 0);
  };
  // `from` is where the hit came from (a raised riot shield blocks damage arriving from the front). Lightning is true
  // damage: it ignores shields, armor, potions and overheal. The storm and snow ignore potions too.
  World.prototype.damagePlayer = function (p, amount, sourceId, cause, hx, hy, from) {
    if (!p.alive || amount <= 0) return;
    if (cause === 'poison' && p.vehiclePoisonProtectionAt === this.time) return;
    if (p.vehicle && this.damageVehicle) {
      var vehicle = this.vehicleById(p.vehicle);
      if (vehicle && !vehicle.wreck) {
        if (cause === 'poison' && vehicle.poisonAt === this.time) return;
        if (cause === 'poison') vehicle.poisonAt = this.time;
        this.damageVehicle(vehicle, amount, sourceId, cause, hx, hy);
        return;
      }
    }
    var src = sourceId ? this.playerById(sourceId) : null, fx = p.fx;
    amount *= this.outgoingClassDamageMul(src);
    var trueDamage = cause === 'lightning', raw = cause === 'storm' || cause === 'snow';
    if (!trueDamage && !raw) {
      if (fx && fx.immune > 0) { this.text(p.x, p.y - p.r - 14, 'IMMUNE', '#7fe9ff', 18); this.emit({ type: 'blocked', player: p, how: 'immune', source: src }); return; }
      if (from && this.shieldBlocks(p, from.x, from.y, cause)) {
        this.sparks(hx === undefined ? p.x : hx, hy === undefined ? p.y : hy, 1, 0, '#cfd8e6', 4);
        this.text(p.x, p.y - p.r - 14, 'BLOCKED', '#cfd8e6', 16);
        this.emit({ type: 'blocked', player: p, how: 'shield', source: src });
        return;
      }
      if (src && src !== p && cause !== 'airstrike' && cause !== 'ram' && cause !== 'tank-cannon' && cause !== 'tankmg' && cause !== 'sentry-cannons' && cause !== 'sentry-burn' && cause !== 'pyro-burn') amount *= this.damageMul(src);
      amount = Math.round(amount * this.reduceMul(p) * 10) / 10;
      if (amount <= 0) return;
    }
    // The Armor Crew passive is permanent personal protection, including true damage and the storm.
    if (p.classId === 'armorcrew') amount = Math.round(amount * W.ARMOR_CREW.damageTakenMul * 10) / 10;
    if (CLASSES[p.classId].damageTakenMul) amount = Math.round(amount * CLASSES[p.classId].damageTakenMul * 10) / 10;
    var absorbed = trueDamage ? 0 : Math.min(p.armor, amount);
    if (!this.isPracticeBot(p)) {
      p.armor -= absorbed;
      p.hp -= amount - absorbed;
    }
    if (src && src !== p) { src.stats.damage += amount; src.stats.hits++; }
    this.showDamage(p, amount, hx, hy);
    this.emit({ type: 'damage', target: p, source: src, amount: amount, cause: cause, x: hx === undefined ? p.x : hx, y: hy === undefined ? p.y - p.r : hy });
    if (p.hp > 0.0001) return;
    // Power Potion II: the first killing blow leaves you at 30 HP and ends the potion.
    if (fx && fx.deathImmune > 0) {
      p.hp = W.ItemRules.SAVED_HP; fx.deathImmune = 0; fx.power = 0; p.healFlash = 1;
      this.explosions.push({ x: p.x, y: p.y, r: 150, t: 0, dur: 0.7, ring: true, color: '#ffd23f' });
      this.text(p.x, p.y - p.r - 30, 'SAVED!', '#ffd23f', 26);
      this.emit({ type: 'saved', player: p, source: src, cause: cause });
      return;
    }
    // Team modes: you are knocked down while a teammate is still standing; otherwise you are out.
    if (this.teams && !p.downed && this.teamStanding(p.team, p) > 0) this.downPlayer(p, src, cause);
    else this.killPlayer(p, src, cause);
  };

  // Floating number and hit flash. The client calls this for damage the server reports.
  World.prototype.showDamage = function (p, amount, hx, hy) {
    p.hitFlash = 1;
    var tx = hx === undefined ? p.x : hx, ty = hy === undefined ? p.y - p.r : hy;
    this.text(tx, ty - 8, String(Math.round(amount)), p.isLocal ? '#ff6b6b' : damageColor(amount), damageSize(amount));
  };

  World.prototype.killPlayer = function (p, src, cause) {
    if (this.isPracticeBot(p)) return;
    var wasDowned = p.downed, team = p.team;
    p.alive = false; p.hp = 0; p.deadT = 0; p.vx = 0; p.vy = 0; p.nearStation = null;
    p.emote = null;
    p.sprinting = false;
    p.downed = false; p.downT = 0; p.revive = 0; p.scoping = false; p.wantsRevive = false;
    if (src && src !== p) src.stats.kills++;
    this.clearItemState(p);
    if (!this.remote) {
      if (p.tokens > 0) {
        var n = Math.min(p.tokens, 8), each = Math.floor(p.tokens / n), rem = p.tokens - each * n;
        for (var i = 0; i < n; i++) this.spawnPickup('token', p.x, p.y, each + (i < rem ? 1 : 0), true);
      }
      for (var k = 0; k < p.keys; k++) this.spawnPickup('key', p.x, p.y, 1, true);
      this.dropItems(p);
      p.tokens = 0;
      p.keys = 0;
    }
    if (!this.remote || !p.hidden) {
      this.burst(p.x, p.y, 26, p.color, 320, 0.8, 7);
      this.explosions.push({ x: p.x, y: p.y, r: p.r * 3.2, t: 0, dur: 0.45, ring: true, color: p.color });
    }
    this.emit({ type: 'death', victim: p, killer: src, cause: cause, wasDowned: wasDowned });
    if (!this.remote) this.checkWipe(team, src, cause);
  };

  World.prototype.damageCrate = function (c, amount, sourceId, hx, hy) {
    if (!c.alive || amount <= 0) return;
    var src = sourceId ? this.playerById(sourceId) : null;
    amount *= this.outgoingClassDamageMul(src);
    c.hp -= amount;
    c.shake = 1;
    if (src) src.stats.crateDamage += amount;
    this.text(hx, hy - 6, String(Math.round(amount)), damageColor(amount), damageSize(amount));
    this.emit({ type: 'crate-hp', crate: c, hp: Math.max(0, c.hp), source: src, amount: amount, x: hx, y: hy });
    if (c.hp > 0) return;
    if (src) src.stats.crates++;
    this.crateBreakFx(c);
    this.crateLoot(c, src); // tokens every time, sometimes an armor plate or a key, and items by the crate's tier
    this.emit({ type: 'crate', crate: c, source: src });
  };

  // Crate splinters. The client calls this when the server reports a crate at 0 HP.
  World.prototype.crateBreakFx = function (c) {
    c.alive = false;
    c.hp = 0;
    var tier = W.CRATES[c.tier] || W.CRATES.common;
    for (var i = 0; i < 14; i++) {
      var a = this.rng.next() * U.TAU, sp = 120 + this.rng.next() * 240;
      this.particles.push({ kind: 'debris', x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.7, max: 0.7,
        size: 6 + this.rng.next() * 7, color: this.rng.chance(0.5) ? tier.color : tier.edge, drag: 4, angle: a, spin: (this.rng.next() - 0.5) * 18 });
    }
    if (c.tier && c.tier !== 'common') this.explosions.push({ x: c.x, y: c.y, r: 110, t: 0, dur: 0.5, ring: true, color: tier.color });
  };

  // ---------------------------------------------------------------- pickups & stations
  // type: token | key | armor | item (with `item` = item id and `amount` = how many)
  World.prototype.spawnPickup = function (type, x, y, amount, scatter, item, lockT) {
    var pk = { id: this.map.nextPickupId++, type: type, item: item || null, x: x, y: y, amount: amount || 1, alive: true, age: 0, vx: 0, vy: 0, lockT: Math.max(0, lockT || 0) };
    if (scatter) {
      var a = this.rng.next() * U.TAU, sp = 160 + this.rng.next() * 200;
      pk.vx = Math.cos(a) * sp;
      pk.vy = Math.sin(a) * sp;
    } else {
      pk.age = 1;
    }
    this.map.pickups.push(pk);
    this.emit({ type: 'spawn-pickup', pickup: pk });
    return pk;
  };

  // Client mirror helpers: pickups the server created or removed.
  World.prototype.spawnPickupAt = function (s) {
    var pk = this.pickupById(s.id);
    if (pk) { pk.alive = true; pk.x = s.x; pk.y = s.y; pk.vx = s.vx || 0; pk.vy = s.vy || 0; pk.type = s.type; pk.item = s.item || null; pk.amount = s.amount || 1; pk.lockT = Math.max(0, s.lockT || 0); return pk; }
    pk = { id: s.id, type: s.type, item: s.item || null, x: s.x, y: s.y, amount: s.amount || 1, alive: true, age: 0, vx: s.vx || 0, vy: s.vy || 0, lockT: Math.max(0, s.lockT || 0) };
    this.map.nextPickupId = Math.max(this.map.nextPickupId, s.id + 1);
    this.map.pickups.push(pk);
    return pk;
  };
  World.prototype.pickupById = function (id) {
    var list = this.map.pickups;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };
  World.prototype.removePickup = function (id, by, what, amount, total, item) {
    var pk = this.pickupById(id);
    if (!pk || !pk.alive) return;
    pk.alive = false;
    this.pickupFx(pk);
    if (by) this.pickupText(by, what || pk.type, amount || pk.amount, total, item || pk.item);
  };
  World.prototype.pickupColor = function (pk) {
    if (pk.type === 'token') return '#ffe680';
    if (pk.type === 'key') return '#d9b8ff';
    if (pk.type === 'armor') return '#9cc6ff';
    var it = pk.item && W.ITEMS[pk.item];
    return it ? W.TIERS[it.tier].color : '#ffffff';
  };
  World.prototype.pickupFx = function (pk) {
    var color = this.pickupColor(pk);
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * U.TAU;
      this.particles.push({ kind: 'dot', x: pk.x, y: pk.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: 0.35, max: 0.35, size: 3.5, color: color, drag: 4 });
    }
  };
  World.prototype.pickupText = function (p, what, amount, total, item) {
    if (!this.remote || !p.hidden) {
      if (what === 'token') this.text(p.x, p.y - p.r - 16, '+' + amount + (amount === 1 ? ' token' : ' tokens'), '#ffd23f', 18);
      else if (what === 'key') this.text(p.x, p.y - p.r - 16, '+1 station key', '#c9a2ff', 18);
      else if (what === 'armor') this.text(p.x, p.y - p.r - 16, '+' + (C.armorPlate * (amount || 1)) + ' armor', '#9cc6ff', 18);
      else if (what === 'item' && item && W.ITEMS[item]) this.text(p.x, p.y - p.r - 16, '+' + amount + ' ' + W.ITEMS[item].name, W.TIERS[W.ITEMS[item].tier].color, 18);
    }
    this.emit({ type: 'pickup', player: p, what: what, amount: amount, total: total, item: item || null });
  };

  World.prototype.updatePickups = function (dt) {
    var list = this.map.pickups, players = this.players, magnet = C.magnetRadius;
    for (var i = 0; i < list.length; i++) {
      var pk = list[i];
      if (!pk.alive) continue;
      pk.age += dt;
      if (pk.lockT > 0) pk.lockT = Math.max(0, pk.lockT - dt);
      if (pk.vx || pk.vy) {
        pk.x += pk.vx * dt;
        pk.y += pk.vy * dt;
        var decay = Math.exp(-4 * dt);
        pk.vx *= decay;
        pk.vy *= decay;
        if (Math.abs(pk.vx) + Math.abs(pk.vy) < 4) { pk.vx = 0; pk.vy = 0; }
        U.clampToIsland(pk, 12, C.worldSize, C.cornerRadius);
      }
      // Items stay where they land until the player presses interact. Currency,
      // station keys and armor retain their automatic pickup behaviour.
      if (this.demo || this.remote || pk.type === 'item' || pk.lockT > 0) continue;
      for (var j = 0; j < players.length; j++) {
        var p = players[j];
        if (!p.alive || p.dropT > 0 || p.downed || p.vehicle) continue;
        var dx = p.x - pk.x, dy = p.y - pk.y, d = Math.hypot(dx, dy);
        if (d >= magnet) continue;
        if (!this.wantsPickup(p, pk)) continue;
        if (d < p.r + 12) { this.collect(p, pk); break; }
        if (pk.age > 0.35) {
          var pull = Math.min(d, (520 + (1 - d / magnet) * 600) * dt);
          pk.x += dx / d * pull;
          pk.y += dy / d * pull;
        }
      }
    }
    this.cleanupT -= dt;
    if (this.cleanupT <= 0) {
      this.cleanupT = 5;
      this.map.pickups = list.filter(function (pk) { return pk.alive; });
      // Behind the menu nobody collects anything and crates keep coming back, so keep only the newest pickups.
      if (this.demo && this.map.pickups.length > 300) this.map.pickups = this.map.pickups.slice(this.map.pickups.length - 300);
    }
  };

  // Tokens and keys always; armor only below the cap; items only while a hotbar slot (or stack) has room.
  World.prototype.wantsPickup = function (p, pk) {
    if (this.isPracticeBot(p)) return false;
    if (pk.type === 'armor') return p.armor < C.armorMax;
    if (pk.type === 'item') return !!pk.item && this.canTake(p, pk.item);
    return true;
  };
  World.prototype.collect = function (p, pk) {
    if (this.remote || !p || !p.alive || p.downed || p.vehicle || p.dropT > 0 || !pk || !pk.alive || pk.lockT > 0 || !this.wantsPickup(p, pk)) return false;
    if (pk.type === 'item' && (p.mount || Math.hypot(pk.x - p.x, pk.y - p.y) > W.ItemRules.PICKUP_RANGE || !this.lineClear(p.x, p.y, pk.x, pk.y))) return false;
    pk.alive = false;
    var total = 0;
    if (pk.type === 'token') { p.tokens += pk.amount; p.stats.tokens += pk.amount; total = p.tokens; }
    else if (pk.type === 'key') { p.keys += 1; total = p.keys; }
    else if (pk.type === 'armor') { p.armor = Math.min(C.armorMax, p.armor + C.armorPlate * pk.amount); total = p.armor; }
    else if (pk.type === 'item') {
      var left = this.addItem(p, pk.item, pk.amount), got = pk.amount - left;
      if (left > 0) this.spawnPickup('item', pk.x, pk.y, left, false, pk.item); // what did not fit stays on the ground
      pk.amount = got;
      total = this.countItem(p, pk.item);
    }
    this.pickupFx(pk);
    this.emit({ type: 'collected', player: p, pickup: pk, total: total });
    this.pickupText(p, pk.type, pk.amount, total, pk.item);
    return true;
  };

  // Spend 5 tokens at a station. A station that is recharging needs a station key, which is used up.
  World.prototype.upgrade = function (p, station, classId) {
    if (!p.alive || p.downed) return { ok: false, reason: 'dead' };
    if (!station || Math.hypot(station.x - p.x, station.y - p.y) > C.stationInteractRadius + p.r + 30) return { ok: false, reason: 'far' };
    var check = Rules.upgradeCheck({ from: p.classId, to: classId, tokens: p.tokens, keys: p.keys, stationCooldown: station.cooldown });
    if (!check.ok) return check;
    p.tokens -= check.cost;
    if (check.useKey) p.keys -= 1;
    this.applyUpgrade(p, station, classId, check.useKey);
    return { ok: true, usedKey: check.useKey };
  };

  // Class change plus its fireworks. The client calls this for upgrades the server reports.
  World.prototype.applyUpgrade = function (p, station, classId, usedKey) {
    station.cooldown = C.stationCooldown;
    station.usedBy = p.id;
    if (!this.remote || p.classId !== classId) this.setClass(p, classId, false);
    p.stats.upgrades++;
    var color = CLASSES[classId].color;
    if (!this.remote || !p.hidden) {
      this.burst(p.x, p.y, 30, color, 360, 0.9, 6);
      this.explosions.push({ x: p.x, y: p.y, r: 150, t: 0, dur: 0.75, ring: true, color: color });
      this.text(p.x, p.y - p.r - 30, CLASSES[classId].name.toUpperCase() + '!', color, 28);
    }
    this.explosions.push({ x: station.x, y: station.y, r: 90, t: 0, dur: 0.6, ring: true, color: '#7fe9ff' });
    this.emit({ type: 'upgrade', player: p, classId: classId, station: station, usedKey: !!usedKey });
  };

  World.prototype.land = function (p) {
    if (!this.remote || !p.hidden) {
      this.explosions.push({ x: p.x, y: p.y, r: 140, t: 0, dur: 0.55, ring: true, color: '#ffffff' });
      this.smoke(p.x, p.y, 14, '#efe7d2', 16, 0.8, 210);
    }
    this.emit({ type: 'land', player: p });
  };

  // ---------------------------------------------------------------- effects
  World.prototype.burst = function (x, y, n, color, speed, life, size) {
    for (var i = 0; i < n; i++) {
      var a = this.rng.next() * U.TAU, s = speed * (0.35 + this.rng.next() * 0.65);
      this.particles.push({ kind: 'dot', x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life * (0.6 + this.rng.next() * 0.4), max: life, size: size * (0.6 + this.rng.next() * 0.6), color: color, drag: 3 });
    }
  };
  World.prototype.sparks = function (x, y, dx, dy, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.atan2(-dy, -dx) + (this.rng.next() - 0.5) * 1.9, s = 180 + this.rng.next() * 260;
      this.particles.push({ kind: 'spark', x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.2 + this.rng.next() * 0.15, max: 0.35, size: 2.5, color: color, drag: 6 });
    }
  };
  World.prototype.smoke = function (x, y, n, color, size, life, speed) {
    for (var i = 0; i < n; i++) {
      var a = this.rng.next() * U.TAU, s = speed * (0.2 + this.rng.next() * 0.8);
      this.particles.push({ kind: 'smoke', x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life * (0.6 + this.rng.next() * 0.4), max: life, size: size * (0.6 + this.rng.next() * 0.5), grow: size * 1.2, color: color, drag: 2.5 });
    }
  };
  World.prototype.flash = function (x, y, angle, weapon) {
    var heavy = weapon === 'sniper' || weapon === 'shotgun' || weapon === 'deagle' || weapon === 'launcher';
    this.particles.push({ kind: 'flash', x: x, y: y, vx: 0, vy: 0, life: 0.07, max: 0.07, size: heavy ? 24 : 14, color: '#fff3b0', drag: 0, angle: angle });
    if (heavy) this.smoke(x, y, 3, '#e6e6e6', 9, 0.5, 60);
  };
  World.prototype.text = function (x, y, str, color, size) {
    var tx = x + (this.rng.next() - 0.5) * 18, ty = y, moved = true, guard = 0;
    // Rapid hits on one target stack upward instead of overlapping ("10" on top of "10" would read as "100").
    // Each push moves the new number above a neighbour, so repeat until it no longer touches any recent number.
    while (moved && guard++ < 12) {
      moved = false;
      for (var i = this.texts.length - 1; i >= 0 && i >= this.texts.length - 12; i--) {
        var o = this.texts[i];
        if (o.life > o.max - 0.45 && Math.abs(o.x - tx) < 46 && Math.abs(o.y - ty) < 26) { ty = o.y - 26; moved = true; }
      }
    }
    this.texts.push({ x: tx, y: ty, vy: -72, str: str, color: color, size: size, life: 0.95, max: 0.95 });
    if (this.texts.length > 80) this.texts.shift();
  };

  World.prototype.updateEffects = function (dt) {
    var parts = this.particles, out = [], i;
    for (i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.drag) { var dr = Math.exp(-p.drag * dt); p.vx *= dr; p.vy *= dr; }
      if (p.grow) p.size += p.grow * dt;
      if (p.spin) p.angle += p.spin * dt;
      out.push(p);
    }
    this.particles = out.length > 900 ? out.slice(out.length - 900) : out;
    var texts = [];
    for (i = 0; i < this.texts.length; i++) {
      var t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) continue;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.6 * dt);
      texts.push(t);
    }
    this.texts = texts;
    var ex = [];
    for (i = 0; i < this.explosions.length; i++) {
      var e = this.explosions[i];
      e.t += dt;
      if (e.t < e.dur) ex.push(e);
    }
    this.explosions = ex;
  };

  // ---------------------------------------------------------------- storm
  var stormLand = null;
  function stormLandShape() {
    var S = C.worldSize, corner = C.cornerRadius;
    if (stormLand && stormLand.size === S && stormLand.corner === corner) return stormLand;
    // Midpoint strips follow the same rounded square as insideIsland. These are computed once,
    // and only used while choosing the six circles, never during a gameplay update.
    var count = 2048, step = S / count, coast = new Float64Array(count);
    for (var i = 0; i < count; i++) {
      var x = (i + 0.5) * step, edge = Math.min(x, S - x);
      coast[i] = edge < corner ? corner - Math.sqrt(corner * corner - (corner - edge) * (corner - edge)) : 0;
    }
    stormLand = { size: S, corner: corner, step: step, coast: coast, area: S * S - (4 - Math.PI) * corner * corner };
    return stormLand;
  }

  function stormSafeArea(x, y, r, land) {
    if (r <= 0) return 0;
    if (U.insideIsland(x, y, r, land.size, land.corner)) return Math.PI * r * r;
    var step = land.step, coast = land.coast, S = land.size, rr = r * r, sum = 0;
    var first = Math.max(0, Math.ceil((x - r) / step - 0.5));
    var last = Math.min(coast.length - 1, Math.floor((x + r) / step - 0.5));
    for (var i = first; i <= last; i++) {
      var dx = (i + 0.5) * step - x, half = Math.sqrt(Math.max(0, rr - dx * dx));
      sum += Math.max(0, Math.min(S - coast[i], y + half) - Math.max(coast[i], y - half));
    }
    return sum * step;
  }

  function stormRadius(x, y, target, limit, land) {
    if (target <= 0) return 0;
    var lo = 0, hi = limit;
    for (var i = 0; i < 28; i++) {
      var mid = (lo + hi) * 0.5;
      if (stormSafeArea(x, y, mid, land) < target) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  function Storm(world) {
    var S = C.worldSize, rng = world.rng, phases = W.STORM, land = stormLandShape();
    this.world = world;
    this.circles = [{ x: S / 2, y: S / 2, r: S * 0.75 }];
    for (var i = 0; i < phases.length; i++) {
      var prev = this.circles[i], target = phases[i].safeArea * land.area;
      // A circle needs at least this much radius to contain the requested land area. Reject
      // centers that cannot fit the target wholly inside the previous safe circle.
      var room = Math.max(0, prev.r - Math.sqrt(target / Math.PI)), x = prev.x, y = prev.y, limit = prev.r;
      for (var t = 0; t < 60; t++) {
        var a = rng.next() * U.TAU, d = Math.sqrt(rng.next()) * room;
        var cx = prev.x + Math.cos(a) * d, cy = prev.y + Math.sin(a) * d;
        if (!U.insideIsland(cx, cy, C.playerRadius, S, C.cornerRadius)) continue;
        var available = Math.max(0, prev.r - d);
        if (target > 0 && stormSafeArea(cx, cy, available, land) < target) continue;
        x = cx; y = cy; limit = available; break;
      }
      this.circles.push({ x: x, y: y, r: stormRadius(x, y, target, limit, land) });
    }
    this.x = S / 2; this.y = S / 2; this.r = S * 0.75;
    this.next = this.circles[1];
    this.state = 'waiting'; this.phase = 0; this.timeLeft = phases[0].start; this.dps = 0;
    this.tick = C.stormTick;
    this.announced = {};
  }

  Storm.prototype.update = function (dt) {
    var t = this.world.time, phases = W.STORM, i = 0, j, p;
    while (i < phases.length && t >= phases[i].end) i++;
    if (i >= phases.length) {
      var last = this.circles[this.circles.length - 1];
      this.x = last.x; this.y = last.y; this.r = last.r;
      this.state = 'final'; this.timeLeft = 0; this.dps = phases[phases.length - 1].dps; this.next = null;
    } else {
      var ph = phases[i], from = this.circles[i], to = this.circles[i + 1];
      this.next = to;
      if (t < ph.start) {
        this.state = 'waiting';
        this.x = from.x; this.y = from.y; this.r = from.r;
        this.timeLeft = ph.start - t;
        this.dps = i > 0 ? phases[i - 1].dps : 0;
      } else {
        var k = (t - ph.start) / (ph.end - ph.start);
        this.state = 'shrinking';
        this.x = U.lerp(from.x, to.x, k); this.y = U.lerp(from.y, to.y, k); this.r = U.lerp(from.r, to.r, k);
        this.timeLeft = ph.end - t;
        this.dps = ph.dps;
      }
    }
    this.phase = i;
    var key = i + ':' + this.state;
    if (!this.announced[key]) {
      this.announced[key] = true;
      this.world.emit({ type: 'storm', phase: i, state: this.state, timeLeft: this.timeLeft });
    }
    var players = this.world.players;
    for (j = 0; j < players.length; j++) {
      p = players[j];
      p.inStorm = p.alive && (this.r <= 0 || Math.hypot(p.x - this.x, p.y - this.y) > this.r);
    }
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick += C.stormTick;
      if (this.dps > 0) {
        for (j = 0; j < players.length; j++) {
          p = players[j];
          if (p.alive && !p.vehicle && p.inStorm && p.dropT <= 0) this.world.damagePlayer(p, this.dps * C.stormTick, null, 'storm');
        }
        if (this.world.damageVehiclesInStorm) this.world.damageVehiclesInStorm(this, this.dps * C.stormTick);
      }
    }
  };

  W.World = World;
  W.Storm = Storm;
}());
