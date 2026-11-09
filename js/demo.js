/* warz.io: main-menu background. Spectates simulated soldiers fighting on a random island.
   These soldiers exist only behind the menu: real matches have no bots yet. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, WEAPONS = W.WEAPONS, CLASSES = W.CLASSES;
  var NAMES = ['NoScopeNed', 'Sgt_Pickles', 'PixelPanda', 'xXBlastXx', 'TacoTank', 'Ripley', 'KarmaKid', 'MrBoom', 'Juno',
    'Static', 'Moose', 'Echo7', 'Wanda', 'BoltBoy', 'Nova', 'Grizzly', 'Sprocket', 'Lumen', 'Pebbles', 'Dash'];
  var COLORS = [['#f14e54', '#b23a3f'], ['#00b06d', '#007d4e'], ['#be7ff5', '#8a59b8'], ['#ffb43a', '#c4861d'],
    ['#2f9bff', '#1f6fbf'], ['#ff7ab8', '#c2578a'], ['#3fd1c8', '#2a958e'], ['#9ccc3d', '#6f9628']];
  var PREF = { soldier: 360, sniper: 640, shotgunner: 160, medic: 380, grenadier: 420 };
  var LVL1 = ['sniper', 'shotgunner', 'medic', 'grenadier'];

  function randomClass(rng) { return rng.chance(0.4) ? 'soldier' : rng.pick(LVL1); }

  function spot(demo, radius) {
    var w = demo.world, rng = demo.rng;
    for (var i = 0; i < 30; i++) {
      var a = rng.range(0, U.TAU), d = Math.sqrt(rng.next()) * radius;
      var x = demo.hub.x + Math.cos(a) * d, y = demo.hub.y + Math.sin(a) * d;
      if (!U.insideIsland(x, y, 300, W.CONFIG.worldSize, W.CONFIG.cornerRadius)) continue;
      var blocked = false;
      w.solids.query(x - 40, y - 40, x + 40, y + 40, function (s) { if (!(s.crate && !s.crate.alive)) blocked = true; });
      if (!blocked && !w.inPond(x, y)) return { x: x, y: y };
    }
    return { x: demo.hub.x, y: demo.hub.y };
  }

  function think(demo, p, world, dt) {
    var ai = p.ai, rng = demo.rng, intent = { mx: 0, my: 0, aimX: null, aimY: null, fire: false, firePressed: false };
    ai.scan -= dt;
    if (ai.scan <= 0) {
      ai.scan = 0.25 + rng.next() * 0.2;
      var best = null, bd = 780;
      for (var i = 0; i < world.players.length; i++) {
        var o = world.players[i];
        if (o === p || !o.alive) continue;
        var d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bd && world.lineClear(p.x, p.y, o.x, o.y)) { bd = d; best = o; }
      }
      if (best !== ai.enemy) { ai.enemy = best; ai.aimErr = 0.32; ai.react = 0.25 + rng.next() * 0.4; }
    }
    var e = ai.enemy && ai.enemy.alive ? ai.enemy : null, w = p.weapons[p.slot], def = WEAPONS[w.id];
    if (e) {
      var dx = e.x - p.x, dy = e.y - p.y, dist = Math.hypot(dx, dy) || 1;
      ai.aimErr = Math.max(0.04, ai.aimErr - dt * 0.22);
      var speed = def.bulletSpeed || def.projectileSpeed || 1500, lead = dist / speed;
      var ang = Math.atan2(e.y + e.vy * lead - p.y, e.x + e.vx * lead - p.x) + Math.sin(world.time * 2.1 + p.id * 1.7) * ai.aimErr;
      intent.aimX = p.x + Math.cos(ang) * dist;
      intent.aimY = p.y + Math.sin(ang) * dist;
      ai.react -= dt;
      var range = def.range || 500;
      if (ai.react <= 0 && dist < range * 0.92) { intent.fire = true; intent.firePressed = rng.chance(0.08); }
      var pref = PREF[p.classId], radial = dist > pref + 70 ? 1 : dist < pref - 70 ? -1 : 0, ux = dx / dist, uy = dy / dist;
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeT = 0.7 + rng.next() * 1.4; ai.strafe = rng.chance(0.5) ? 1 : -1; }
      intent.mx = ux * radial - uy * ai.strafe * 0.8;
      intent.my = uy * radial + ux * ai.strafe * 0.8;
      if (p.grenades > 0) {
        ai.nadeT -= dt;
        if (ai.nadeT <= 0 && dist > 200 && dist < 520) { intent.utility = true; ai.nadeT = 3 + rng.next() * 4; }
      }
      if (p.classId === 'medic' && p.hp < p.maxHp - 30 && p.medkitCd <= 0) intent.utility = true;
    } else {
      ai.retarget -= dt;
      var tdx = ai.tx - p.x, tdy = ai.ty - p.y, td = Math.hypot(tdx, tdy) || 1;
      if (td < 70 || ai.retarget <= 0) {
        // Soldiers with nothing to do often head for a ready upgrade station, like real players would.
        var station = CLASSES[p.classId].tier === 0 && rng.chance(0.6) ? world.nearestStation(p.x, p.y, 1600) : null;
        if (station && station.cooldown <= 0) {
          var sa = rng.range(0, U.TAU);
          ai.tx = station.x + Math.cos(sa) * 70; ai.ty = station.y + Math.sin(sa) * 70; ai.retarget = 9;
        } else {
          var s = spot(demo, 1100);
          ai.tx = s.x; ai.ty = s.y; ai.retarget = 4 + rng.next() * 5;
        }
      }
      intent.mx = tdx / td;
      intent.my = tdy / td;
      intent.aimX = ai.tx;
      intent.aimY = ai.ty;
    }
    var moving = intent.mx || intent.my, sp = Math.hypot(p.vx, p.vy);
    if (moving && sp < 30) {
      ai.stuckT += dt;
      if (ai.stuckT > 0.7) { ai.stuckT = 0; ai.retarget = 0; ai.strafe = -ai.strafe; ai.tx = p.x + rng.range(-500, 500); ai.ty = p.y + rng.range(-500, 500); }
    } else ai.stuckT = 0;
    return intent;
  }

  function addBot(demo, name, i) {
    var s = spot(demo, 1000), col = COLORS[i % COLORS.length];
    var p = demo.world.addPlayer({ name: name, x: s.x, y: s.y, color: col[0], outline: col[1], classId: randomClass(demo.rng), bot: true, angle: demo.rng.range(0, U.TAU) });
    p.ai = { tx: s.x, ty: s.y, retarget: 0, scan: 0, enemy: null, strafe: 1, strafeT: 0, aimErr: 0.3, react: 0.4, stuckT: 0, nadeT: 2 + demo.rng.next() * 3 };
    p.controller = function (pl, world, dt) { return think(demo, pl, world, dt); };
    return p;
  }

  function pickFollow(demo) {
    var alive = demo.world.players.filter(function (p) { return p.alive; });
    if (!alive.length) return;
    var busy = alive.filter(function (p) { return p.ai.enemy && p.ai.enemy.alive; });
    var list = busy.length ? busy : alive, choice = demo.rng.pick(list);
    if (choice.id === demo.followId && list.length > 1) choice = list[(list.indexOf(choice) + 1) % list.length];
    demo.followId = choice.id;
    demo.followT = 12 + demo.rng.next() * 6;
  }

  function update(demo, dt) {
    var world = demo.world;
    world.update(dt);
    // A plain soldier passing a ready station grabs an upgrade (a few times per second of standing there).
    world.players.forEach(function (p) {
      if (p.alive && CLASSES[p.classId].tier === 0 && p.nearStation && p.nearStation.cooldown <= 0 && demo.rng.chance(Math.min(1, dt * 4))) {
        p.tokens = Math.max(p.tokens, W.CONFIG.upgradeCost);
        world.upgrade(p, p.nearStation, demo.rng.pick(LVL1));
      }
    });
    if (demo.onEvent) world.events.forEach(demo.onEvent);
    world.events.length = 0;
    world.players.forEach(function (p) {
      if (!p.alive && p.deadT > 3.5) {
        var s = spot(demo, 1000);
        world.respawn(p, s.x, s.y, randomClass(demo.rng));
        p.ai.enemy = null;
      }
    });
    demo.followT -= dt;
    var f = world.playerById(demo.followId);
    if (!f || (!f.alive && f.deadT > 1.6) || demo.followT <= 0) { pickFollow(demo); f = world.playerById(demo.followId); }
    if (f) {
      var k = Math.min(1, dt * 1.8);
      demo.cam.x += (f.x - demo.cam.x) * k;
      demo.cam.y += (f.y - demo.cam.y) * k;
    }
    // Keep the map full of action: stations recharge and crates come back faster than in a real match.
    if (world.map.crates.length) {
      demo.crateT -= dt;
      if (demo.crateT <= 0) {
        demo.crateT = 2;
        world.map.crates.forEach(function (c) { if (!c.alive && demo.rng.chance(0.1)) { c.alive = true; c.hp = c.maxHp; } });
      }
    }
  }

  function create(seed) {
    seed = seed || ((Math.random() * 2147483647) | 0);
    var map = W.MapGen.generate(seed), world = new W.World({ map: map, demo: true });
    var rng = U.rng(seed ^ 0x9e3779b9), town = map.towns.length ? rng.pick(map.towns) : { x: map.size / 2, y: map.size / 2 };
    var demo = { world: world, rng: rng, hub: { x: town.x, y: town.y }, cam: { x: town.x, y: town.y, zoom: 0.92 }, followId: null, followT: 0, crateT: 2, viewer: null };
    rng.shuffle(NAMES).slice(0, 14).forEach(function (name, i) { addBot(demo, name, i); });
    for (var i = 0; i < 120; i++) update(demo, 1 / 30);
    var f = world.playerById(demo.followId);
    if (f) { demo.cam.x = f.x; demo.cam.y = f.y; }
    return demo;
  }

  W.Demo = { create: create, update: update };
}());
