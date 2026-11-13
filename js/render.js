/* warz.io: canvas renderer for a World (ground, objects, players, effects, storm). */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, C = W.CONFIG, TAU = U.TAU;
  var FONT = "'Lilita One', 'Arial Black', 'Trebuchet MS', sans-serif";

  var PAL = {
    ocean: '#2f7fc2', shallow: '#56b0e0', sand: '#ecd9a0', grass: '#76b75a', grassEdge: '#61a14a',
    grid: 'rgba(28,64,20,0.075)', patchDark: 'rgba(36,86,28,0.09)', patchLight: 'rgba(255,255,210,0.07)', tuft: 'rgba(40,96,34,0.45)',
    pond: '#4aa3dc', pondEdge: '#3a86bd', pondRim: '#d9c98f',
    rock: '#a3a9b0', rockEdge: '#6c737b', rockShine: '#bdc3c9',
    crate: '#c98f45', crateEdge: '#86561f', crateDark: '#a8722f',
    wall: '#6e6258', wallEdge: '#463c35', floor: '#c9ab84', floorLine: 'rgba(96,64,32,0.15)',
    barrel: '#9aa1a9', barrelEdge: '#636a72'
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hexPath(ctx, R) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 6 + i * Math.PI / 3;
      if (i) ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); else ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    ctx.closePath();
  }
  function mix(a, b, t) {
    var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    var r = Math.round((x >> 16) + (((y >> 16) - (x >> 16)) * t));
    var g = Math.round(((x >> 8) & 255) + ((((y >> 8) & 255) - ((x >> 8) & 255)) * t));
    var bl = Math.round((x & 255) + (((y & 255) - (x & 255)) * t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  var rgbaCache = {};
  function rgba(hex, a) {
    var key = hex + a.toFixed(2);
    return rgbaCache[key] || (rgbaCache[key] = U.rgba(hex, +a.toFixed(2)));
  }

  // Fluffy canopy sprites: drawn once, then stamped (scaled and rotated) for every tree and bush.
  function makeCanopy(seed, R, kind) {
    var rng = U.rng(seed), size = Math.ceil(R * 2.5), c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d'), cx = size / 2, cy = size / 2, lumps = [{ x: 0, y: 0, r: R * 0.74 }];
    var n = kind === 'tree' ? rng.int(6, 8) : rng.int(4, 6);
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU + rng.range(-0.3, 0.3), d = R * rng.range(0.36, 0.5);
      lumps.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: R * rng.range(0.42, 0.55) });
    }
    var col = kind === 'tree'
      ? { edge: '#2a6629', fill: '#3d8b39', dark: '#347c31', shine: '#53a44b' }
      : { edge: '#307a2c', fill: '#4c9c43', dark: '#428c3a', shine: '#66b65a' };
    function pass(color, grow, dx, dy, scale) {
      g.fillStyle = color;
      lumps.forEach(function (l) {
        g.beginPath();
        g.arc(cx + l.x + dx * l.r, cy + l.y + dy * l.r, l.r * scale + grow, 0, TAU);
        g.fill();
      });
    }
    pass(col.edge, R * 0.075, 0, 0, 1);
    pass(col.fill, 0, 0, 0, 1);
    pass(col.dark, 0, 0.18, 0.2, 0.78);
    pass(col.fill, 0, -0.08, -0.08, 0.72);
    pass(col.shine, 0, -0.26, -0.26, 0.42);
    if (kind === 'bush') {
      g.fillStyle = '#e8536a';
      for (var b = 0; b < 5; b++) {
        var ba = rng.range(0, TAU), bd = R * rng.range(0.15, 0.6);
        g.beginPath(); g.arc(cx + Math.cos(ba) * bd, cy + Math.sin(ba) * bd, R * 0.07, 0, TAU); g.fill();
      }
    }
    return { canvas: c, R: R, size: size };
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1; this.h = 1; this.dpr = 1;
    this.map = null;
    this.cache = null;
    this.trees = null;
    this.bushes = null;
    this.lastNow = 0;
    this.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  Renderer.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = window.innerWidth, h = window.innerHeight;
    this.dpr = dpr; this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  };

  // CSS px per world unit: every screen shows about the same world area.
  Renderer.prototype.scale = function (zoom) { return Math.sqrt(this.w * this.h / C.viewArea) * zoom; };
  Renderer.prototype.screenToWorld = function (cam, sx, sy) {
    var z = this.scale(cam.zoom);
    return { x: cam.x + (sx - this.w / 2) / z, y: cam.y + (sy - this.h / 2) / z };
  };
  Renderer.prototype.worldToScreen = function (cam, x, y) {
    var z = this.scale(cam.zoom);
    return { x: (x - cam.x) * z + this.w / 2, y: (y - cam.y) * z + this.h / 2 };
  };

  Renderer.prototype.prepare = function (map) {
    if (!this.trees) {
      var res = Math.min(2, this.dpr) * 1.1, i;
      this.trees = []; this.bushes = [];
      for (i = 0; i < 12; i++) this.trees.push(makeCanopy(101 + i * 7, 110 * res, 'tree'));
      for (i = 0; i < 8; i++) this.bushes.push(makeCanopy(501 + i * 11, 50 * res, 'bush'));
    }
    if (this.map === map) return;
    this.map = map;
    var S = C.worldSize, island = new Path2D(), coast = new Path2D(), pts = map.coast, R = C.cornerRadius;
    island.moveTo(R, 0);
    island.arcTo(S, 0, S, S, R); island.arcTo(S, S, 0, S, R); island.arcTo(0, S, 0, 0, R); island.arcTo(0, 0, S, 0, R);
    island.closePath();
    coast.moveTo(pts[0], pts[1]);
    for (var k = 2; k < pts.length; k += 2) coast.lineTo(pts[k], pts[k + 1]);
    coast.closePath();
    var ponds = map.ponds.map(function (p) {
      var path = new Path2D();
      path.moveTo(p.pts[0], p.pts[1]);
      for (var j = 2; j < p.pts.length; j += 2) {
        var nx = p.pts[(j + 2) % p.pts.length], ny = p.pts[(j + 3) % p.pts.length];
        path.quadraticCurveTo(p.pts[j], p.pts[j + 1], (p.pts[j] + nx) / 2, (p.pts[j + 1] + ny) / 2);
      }
      path.closePath();
      return path;
    });
    var rocks = map.rocks.map(function (r) {
      var path = new Path2D();
      path.moveTo(r.pts[0] - r.x, r.pts[1] - r.y);
      for (var j = 2; j < r.pts.length; j += 2) path.lineTo(r.pts[j] - r.x, r.pts[j + 1] - r.y);
      path.closePath();
      return path;
    });
    this.cache = { island: island, coast: coast, ponds: ponds, rocks: rocks };
  };

  function visible(v, x, y, r) { return x + r > v.x0 && x - r < v.x1 && y + r > v.y0 && y - r < v.y1; }

  Renderer.prototype.render = function (world, cam, opts) {
    opts = opts || {};
    this.prepare(world.map);
    var now = performance.now() / 1000, dt = Math.min(0.1, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    var ctx = this.ctx, dpr = this.dpr, w = this.w, h = this.h, z = this.scale(cam.zoom), t = world.time;
    var sx = 0, sy = 0;
    if (opts.shake && !this.reducedMotion) { sx = (Math.random() - 0.5) * opts.shake * 16; sy = (Math.random() - 0.5) * opts.shake * 16; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAL.ocean;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - cam.x * z + sx), dpr * (h / 2 - cam.y * z + sy));
    var v = { x0: cam.x - w / 2 / z - 60, y0: cam.y - h / 2 / z - 60, x1: cam.x + w / 2 / z + 60, y1: cam.y + h / 2 / z + 60 };
    var map = world.map, viewer = opts.viewer || null, i;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    this.drawOcean(ctx, v, t);
    this.drawIsland(ctx, v, t, map);
    for (i = 0; i < map.drops.length; i++) if (visible(v, map.drops[i].x, map.drops[i].y, 140)) this.drawDrop(ctx, map.drops[i], t);
    for (i = 0; i < map.buildings.length; i++) {
      var b = map.buildings[i];
      if (visible(v, b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h))) this.drawFloor(ctx, b);
    }
    var near = viewer && viewer.alive ? viewer.nearStation : null;
    for (i = 0; i < map.stations.length; i++) if (visible(v, map.stations[i].x, map.stations[i].y, 80)) this.drawStationPad(ctx, map.stations[i], t, map.stations[i] === near);
    for (i = 0; i < map.pickups.length; i++) {
      var pk = map.pickups[i];
      if (pk.alive && visible(v, pk.x, pk.y, 30)) this.drawPickup(ctx, pk, t);
    }
    for (i = 0; i < map.crates.length; i++) if (map.crates[i].alive && visible(v, map.crates[i].x, map.crates[i].y, 60)) this.drawCrate(ctx, map.crates[i], t);
    for (i = 0; i < map.rocks.length; i++) if (map.rocks[i].alive !== false && visible(v, map.rocks[i].x, map.rocks[i].y, map.rocks[i].r + 10)) this.drawRock(ctx, map.rocks[i], this.cache.rocks[i]);
    this.drawWalls(ctx, map, v);
    for (i = 0; i < map.stations.length; i++) if (visible(v, map.stations[i].x, map.stations[i].y, 80)) this.drawStationCore(ctx, map.stations[i], t);
    this.drawZones(ctx, world, v, t, false, viewer);
    this.drawMedicStaffs(ctx, world, v, t, viewer);
    this.drawStructures(ctx, world, v, t, viewer);
    if (viewer && viewer.alive && !viewer.downed && !viewer.vehicle && viewer.sentryBuild) this.drawSentryBuild(ctx, viewer, t, true);
    this.drawVehicles(ctx, world, v, t, viewer);
    this.drawGrenades(ctx, world, v, t, false);
    this.drawBullets(ctx, world, v);
    this.drawTankShells(ctx, world, v);
    this.drawRpgRockets(ctx, world, v);
    this.drawSentryProjectiles(ctx, world, v, false);
    for (i = 0; i < world.players.length; i++) {
      var p = world.players[i];
      if (p.dropT <= 0 && !p.hidden && visible(v, p.x, p.y, 90)) {
        this.drawPlayer(ctx, p, t, opts);
        this.drawSentryStatus(ctx, world, p, viewer);
      }
    }
    this.drawCanopies(ctx, map, v, viewer, dt);
    this.drawRoofs(ctx, map, v, viewer, dt);
    this.drawGrenades(ctx, world, v, t, true);
    this.drawSentryProjectiles(ctx, world, v, true);
    // Dropping players are above everything, parachute and all.
    for (i = 0; i < world.players.length; i++) if (world.players[i].dropT > 0 && !world.players[i].hidden) this.drawPlayer(ctx, world.players[i], t, opts);
    this.drawZones(ctx, world, v, t, true, viewer); // smoke hides whatever is under it
    this.drawStrikes(ctx, world, v, t);
    if (opts.trajectory) this.drawTrajectory(ctx, world, opts.trajectory);
    this.drawExplosions(ctx, world);
    this.drawParticles(ctx, world, v);
    this.drawTexts(ctx, world, v);
    this.drawStorm(ctx, world.storm, v);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (viewer) this.drawReveal(ctx, world, cam, viewer);
  };

  // ---------------------------------------------------------------- ground
  Renderer.prototype.drawOcean = function (ctx, v, t) {
    var S = C.worldSize, R = C.cornerRadius;
    if (U.insideIsland(v.x0, v.y0, 0, S, R) && U.insideIsland(v.x1, v.y0, 0, S, R) &&
        U.insideIsland(v.x0, v.y1, 0, S, R) && U.insideIsland(v.x1, v.y1, 0, S, R)) return;
    var step = 150;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (var y = Math.floor(v.y0 / step) * step; y < v.y1; y += step) {
      for (var x = Math.floor(v.x0 / step) * step; x < v.x1; x += step) {
        var px = x + (Math.abs(Math.round(y / step)) % 2) * step * 0.5 + Math.sin(t * 0.8 + y * 0.01) * 20;
        var py = y + Math.sin(t * 1.3 + x * 0.02) * 6;
        if (U.insideIsland(px, py, -80, S, R)) continue;
        ctx.moveTo(px - 18, py);
        ctx.quadraticCurveTo(px - 9, py - 7, px, py);
        ctx.quadraticCurveTo(px + 9, py + 7, px + 18, py);
      }
    }
    ctx.stroke();
  };

  Renderer.prototype.drawIsland = function (ctx, v, t, map) {
    var c = this.cache, i;
    ctx.strokeStyle = PAL.shallow; ctx.lineWidth = 110; ctx.stroke(c.island);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 50; ctx.stroke(c.island);
    ctx.fillStyle = PAL.sand; ctx.fill(c.island);
    ctx.setLineDash([46, 30]);
    ctx.lineDashOffset = -t * 18;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 6; ctx.stroke(c.island);
    ctx.setLineDash([]);
    ctx.fillStyle = PAL.grass; ctx.fill(c.coast);
    ctx.strokeStyle = PAL.grassEdge; ctx.lineWidth = 12; ctx.stroke(c.coast);

    ctx.save();
    ctx.clip(c.coast);
    for (i = 0; i < map.patches.length; i++) {
      var p = map.patches[i];
      if (!visible(v, p.x, p.y, p.r)) continue;
      ctx.fillStyle = p.light ? PAL.patchLight : PAL.patchDark;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    var gs = 80, x, y;
    ctx.strokeStyle = PAL.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (x = Math.floor(v.x0 / gs) * gs; x < v.x1; x += gs) { ctx.moveTo(x, v.y0); ctx.lineTo(x, v.y1); }
    for (y = Math.floor(v.y0 / gs) * gs; y < v.y1; y += gs) { ctx.moveTo(v.x0, y); ctx.lineTo(v.x1, y); }
    ctx.stroke();
    ctx.strokeStyle = PAL.tuft;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    var flowers = [];
    for (i = 0; i < map.tufts.length; i++) {
      var tf = map.tufts[i];
      if (!visible(v, tf.x, tf.y, 12)) continue;
      var s = tf.s * 7;
      ctx.moveTo(tf.x - s, tf.y - s * 0.9); ctx.lineTo(tf.x - s * 0.3, tf.y + s * 0.5);
      ctx.moveTo(tf.x, tf.y - s * 1.2); ctx.lineTo(tf.x, tf.y + s * 0.5);
      ctx.moveTo(tf.x + s, tf.y - s * 0.9); ctx.lineTo(tf.x + s * 0.3, tf.y + s * 0.5);
      if (tf.flower) flowers.push(tf);
    }
    ctx.stroke();
    flowers.forEach(function (f) {
      ctx.fillStyle = f.flower;
      ctx.beginPath(); ctx.arc(f.x + 6, f.y - 8, 4, 0, TAU); ctx.fill();
    });
    ctx.restore();

    for (i = 0; i < map.ponds.length; i++) {
      var pd = map.ponds[i];
      if (!visible(v, pd.x, pd.y, pd.r * 1.3)) continue;
      var path = c.ponds[i];
      ctx.strokeStyle = PAL.pondRim; ctx.lineWidth = 28; ctx.stroke(path);
      ctx.fillStyle = PAL.pond; ctx.fill(path);
      ctx.strokeStyle = PAL.pondEdge; ctx.lineWidth = 8; ctx.stroke(path);
      ctx.save();
      ctx.clip(path);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 3;
      for (var k = 0; k < 3; k++) {
        var rr = ((t * 26 + k * pd.r * 0.33 + pd.r * 0.2) % (pd.r * 0.9));
        ctx.globalAlpha = 1 - rr / (pd.r * 0.9);
        ctx.beginPath(); ctx.arc(pd.x + pd.r * 0.15, pd.y + pd.r * 0.1, rr, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath(); ctx.ellipse(pd.x - pd.r * 0.32, pd.y - pd.r * 0.38, pd.r * 0.34, pd.r * 0.13, -0.3, 0, TAU); ctx.fill();
      ctx.restore();
    }
  };

  Renderer.prototype.drawDrop = function (ctx, d, t) {
    var R = d.r, i;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath(); ctx.arc(4, 6, R + 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2c3037';
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2c230';
    for (i = 0; i < 24; i += 2) {
      var a0 = i / 24 * TAU, a1 = (i + 1) / 24 * TAU;
      ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); ctx.arc(0, 0, R * 0.8, a1, a0, true); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = '#1b1e23'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#3b414b';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.64, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 3; ctx.stroke();
    for (i = 0; i < 3; i++) {
      var phase = (t * 1.6 - i * 0.33) % 1, alpha = phase < 0 ? 0 : 0.25 + 0.75 * (1 - Math.abs(phase - 0.5) * 2);
      ctx.strokeStyle = 'rgba(242,194,48,' + alpha.toFixed(2) + ')';
      ctx.lineWidth = 7;
      var yy = -30 + i * 17;
      ctx.beginPath(); ctx.moveTo(-18, yy); ctx.lineTo(0, yy + 13); ctx.lineTo(18, yy); ctx.stroke();
    }
    ctx.fillStyle = '#f2c230';
    ctx.font = '17px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DROP ' + d.label, 0, R * 0.44);
    for (i = 0; i < 4; i++) {
      var la = Math.PI / 4 + i * Math.PI / 2, on = Math.sin(t * 4 + i * 1.57) > 0;
      ctx.fillStyle = on ? '#ff4d4d' : '#6b2222';
      ctx.beginPath(); ctx.arc(Math.cos(la) * R * 0.9, Math.sin(la) * R * 0.9, 5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };

  // ---------------------------------------------------------------- buildings
  Renderer.prototype.drawFloor = function (ctx, b) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
    ctx.fillStyle = PAL.floor;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = PAL.floorLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var y = b.y + 28; y < b.y + b.h; y += 28) { ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.w, y); }
    ctx.stroke();
  };
  Renderer.prototype.drawWalls = function (ctx, map, v) {
    ctx.fillStyle = PAL.wall;
    ctx.strokeStyle = PAL.wallEdge;
    ctx.lineWidth = 4;
    for (var i = 0; i < map.buildings.length; i++) {
      var b = map.buildings[i];
      if (!visible(v, b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h))) continue;
      for (var j = 0; j < b.walls.length; j++) {
        var wl = b.walls[j];
        ctx.fillRect(wl.x, wl.y, wl.w, wl.h);
        ctx.strokeRect(wl.x, wl.y, wl.w, wl.h);
      }
    }
  };
  Renderer.prototype.drawRoofs = function (ctx, map, v, viewer, dt) {
    for (var i = 0; i < map.buildings.length; i++) {
      var b = map.buildings[i];
      var inside = viewer && viewer.alive && viewer.x > b.x - 6 && viewer.x < b.x + b.w + 6 && viewer.y > b.y - 6 && viewer.y < b.y + b.h + 6;
      b.fade += ((inside ? 0 : 1) - b.fade) * Math.min(1, dt * 9);
      if (b.fade < 0.02 || !visible(v, b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h))) continue;
      var o = 8, x = b.x - o, y = b.y - o, w = b.w + o * 2, h = b.h + o * 2;
      ctx.globalAlpha = b.fade;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x + 10, y + 12, w, h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      if (b.ridgeVertical) ctx.fillRect(x + w / 2, y, w / 2, h); else ctx.fillRect(x, y + h / 2, w, h / 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      var k;
      if (b.ridgeVertical) for (k = x + 22; k < x + w; k += 22) { ctx.moveTo(k, y); ctx.lineTo(k, y + h); }
      else for (k = y + 22; k < y + h; k += 22) { ctx.moveTo(x, k); ctx.lineTo(x + w, k); }
      ctx.stroke();
      ctx.strokeStyle = U.shade(b.roof, -0.35);
      ctx.lineWidth = 6;
      ctx.strokeRect(x, y, w, h);
      ctx.beginPath();
      if (b.ridgeVertical) { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); } else { ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); }
      ctx.stroke();
      if (b.vent) {
        ctx.fillStyle = '#8d939b';
        ctx.strokeStyle = '#5a6067';
        ctx.lineWidth = 3;
        var vx = x + w * 0.25, vy = y + h * 0.28;
        ctx.fillRect(vx, vy, 30, 30); ctx.strokeRect(vx, vy, 30, 30);
      }
      ctx.globalAlpha = 1;
    }
  };

  // ---------------------------------------------------------------- stations & pickups
  Renderer.prototype.drawStationPad = function (ctx, st, t, near) {
    var R = C.stationPadRadius, ready = st.cooldown <= 0, i;
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.translate(4, 6); hexPath(ctx, R); ctx.fill(); ctx.translate(-4, -6);
    hexPath(ctx, R);
    ctx.fillStyle = '#2b3446'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = '#161c28'; ctx.stroke();
    hexPath(ctx, R * 0.78);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ready ? 'rgba(94,231,255,' + (0.45 + 0.25 * Math.sin(t * 3 + st.id)).toFixed(2) + ')' : 'rgba(255,107,129,0.45)';
    ctx.stroke();
    ctx.fillStyle = '#4b566b';
    for (i = 0; i < 6; i++) {
      var a = Math.PI / 6 + i * Math.PI / 3;
      ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88, 3.5, 0, TAU); ctx.fill();
    }
    if (near) {
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.3 * Math.sin(t * 6)).toFixed(2) + ')';
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]);
      ctx.lineDashOffset = -t * 30;
      ctx.beginPath(); ctx.arc(0, 0, C.stationInteractRadius, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  };

  Renderer.prototype.drawStationCore = function (ctx, st, t) {
    var R = C.stationCoreRadius, ready = st.cooldown <= 0;
    ctx.save();
    ctx.translate(st.x, st.y);
    if (ready) {
      var pulse = 0.5 + 0.5 * Math.sin(t * 3 + st.id), gr = R * (2 + pulse * 0.45);
      var grad = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, gr);
      grad.addColorStop(0, 'rgba(90,228,255,0.42)');
      grad.addColorStop(1, 'rgba(90,228,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, gr, 0, TAU); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU);
    ctx.fillStyle = ready ? '#3fd6ff' : '#3a3245'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = ready ? '#127aa1' : '#1f1927'; ctx.stroke();
    if (ready) {
      var bob = Math.sin(t * 4 + st.id) * 2;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(-9, 1 + bob); ctx.lineTo(0, -8 + bob); ctx.lineTo(9, 1 + bob);
      ctx.moveTo(-9, 10 + bob); ctx.lineTo(0, 1 + bob); ctx.lineTo(9, 10 + bob);
      ctx.stroke();
    } else {
      var k = 1 - st.cooldown / C.stationCooldown;
      ctx.strokeStyle = 'rgba(94,231,255,0.25)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, R - 7, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#5ee7ff';
      ctx.beginPath(); ctx.arc(0, 0, R - 7, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
      ctx.strokeStyle = '#ff8a9c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -3, 5, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#ff8a9c';
      ctx.fillRect(-7, -3, 14, 10);
    }
    ctx.restore();
    if (!ready) {
      var label = U.formatTime(st.cooldown);
      ctx.font = '19px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(18,20,30,0.85)';
      ctx.strokeText(label, st.x, st.y - R - 22);
      ctx.fillStyle = '#ffd1d8';
      ctx.fillText(label, st.x, st.y - R - 22);
    }
  };

  Renderer.prototype.drawPickup = function (ctx, pk, t) {
    var bob = Math.sin(t * 3 + pk.id) * 3, x = pk.x, y = pk.y + bob;
    var it = pk.type === 'item' && pk.item ? W.ITEMS[pk.item] : null, tier = it ? W.TIERS[it.tier] : null;
    var glowColor = pk.type === 'token' ? '#ffd646' : pk.type === 'key' ? '#be8cff' : pk.type === 'armor' ? '#9cc6ff' : tier ? tier.color : '#ffffff';
    var big = tier && (it.tier === 'mythic' || it.tier === 'legendary');
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(pk.x, pk.y + (it ? 24 : 14), it ? 23 : 11, it ? 7 : 4, 0, 0, TAU); ctx.fill();
    var glow = ctx.createRadialGradient(x, y, 4, x, y, big ? 44 : 28);
    glow.addColorStop(0, rgba(glowColor, big ? 0.7 : 0.55));
    glow.addColorStop(1, rgba(glowColor, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, big ? 44 : 28, 0, TAU); ctx.fill();
    if (pk.type === 'armor') {
      // An armor plate.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(t * 2 + pk.id) * 0.12);
      ctx.beginPath(); ctx.moveTo(-11, -12); ctx.lineTo(11, -12); ctx.lineTo(11, 2); ctx.quadraticCurveTo(11, 10, 0, 14); ctx.quadraticCurveTo(-11, 10, -11, 2); ctx.closePath();
      ctx.fillStyle = '#5b93e6'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#1f4f9a'; ctx.stroke();
      ctx.fillStyle = '#9cc6ff'; ctx.fillRect(-7, -8, 5, 10);
      ctx.restore();
      return;
    }
    if (it) {
      // The same large, distinct item silhouette used in the inventory and hand.
      ctx.save();
      ctx.translate(x, y);
      roundRect(ctx, -24, -24, 48, 48, 10);
      ctx.fillStyle = '#202b3b'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = tier.color; ctx.stroke();
      var art = W.Icons && W.Icons.itemImage(it.id);
      if (art) ctx.drawImage(art, -22, -22, 44, 44);
      else { ctx.fillStyle = tier.color; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill(); }
      if (pk.amount > 1) {
        // Counts have their own space below the artwork, never over its silhouette.
        roundRect(ctx, -15, 25, 30, 18, 6); ctx.fillStyle = '#172131'; ctx.fill();
        ctx.font = '13px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff'; ctx.fillText('×' + pk.amount, 0, 34);
      }
      ctx.restore();
      return;
    }
    if (pk.type === 'token') {
      var squash = 0.75 + 0.25 * Math.abs(Math.cos(t * 2.2 + pk.id));
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(squash, 1);
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU);
      ctx.fillStyle = '#ffd23f'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#b8860b'; ctx.stroke();
      ctx.fillStyle = '#fff2b0';
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 4, r = i % 2 ? 2.6 : 6.5;
        if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.5 + Math.sin(t * 2 + pk.id) * 0.15);
      ctx.strokeStyle = '#4b2a80'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(-7, 0, 6.5, 0, TAU); ctx.moveTo(0, 0); ctx.lineTo(14, 0); ctx.moveTo(10, 0); ctx.lineTo(10, 6); ctx.moveTo(14, 0); ctx.lineTo(14, 5); ctx.stroke();
      ctx.strokeStyle = '#c9a2ff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(-7, 0, 6.5, 0, TAU); ctx.moveTo(0, 0); ctx.lineTo(14, 0); ctx.moveTo(10, 0); ctx.lineTo(10, 6); ctx.moveTo(14, 0); ctx.lineTo(14, 5); ctx.stroke();
      ctx.restore();
    }
  };

  Renderer.prototype.drawCrate = function (ctx, cr, t) {
    var s = cr.size, h = s / 2, shake = cr.shake > 0 ? Math.sin(t * 90) * cr.shake * 3 : 0;
    var tier = W.CRATES[cr.tier] || W.CRATES.common, rare = cr.tier && cr.tier !== 'common';
    ctx.save();
    ctx.translate(cr.x + shake, cr.y);
    if (rare) {
      // Rarer crates glow so they stand out from across the field.
      var pulse = 0.5 + 0.5 * Math.sin(t * 3 + cr.id), gr = h * (1.9 + pulse * 0.4);
      var grad = ctx.createRadialGradient(0, 0, h * 0.8, 0, 0, gr);
      grad.addColorStop(0, rgba(tier.color, 0.45));
      grad.addColorStop(1, rgba(tier.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, gr, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-h + 4, -h + 6, s, s);
    roundRect(ctx, -h, -h, s, s, 5);
    ctx.fillStyle = tier.color; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = tier.edge; ctx.stroke();
    ctx.strokeStyle = tier.dark; ctx.lineWidth = 3;
    ctx.strokeRect(-h + 7, -h + 7, s - 14, s - 14);
    ctx.beginPath(); ctx.moveTo(-h + 9, -h + 9); ctx.lineTo(h - 9, h - 9); ctx.moveTo(h - 9, -h + 9); ctx.lineTo(-h + 9, h - 9); ctx.stroke();
    if (rare) {
      // A white gem on the lid: the rarer the crate, the more facets.
      var n = cr.tier === 'rare' ? 4 : cr.tier === 'epic' ? 5 : cr.tier === 'mythic' ? 6 : 8;
      ctx.beginPath();
      for (var k = 0; k < n; k++) { var a = -Math.PI / 2 + k / n * TAU; if (k) ctx.lineTo(Math.cos(a) * 11, Math.sin(a) * 11); else ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 11); }
      ctx.closePath();
      ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = tier.edge; ctx.stroke();
    }
    ctx.restore();
    if (cr.hp < cr.maxHp) {
      var bw = s + 6, k = cr.hp / cr.maxHp;
      ctx.fillStyle = 'rgba(20,24,30,0.75)';
      roundRect(ctx, cr.x - bw / 2 - 2, cr.y - h - 16, bw + 4, 9, 4); ctx.fill();
      ctx.fillStyle = '#ffcf6b';
      roundRect(ctx, cr.x - bw / 2, cr.y - h - 14, Math.max(2, bw * k), 5, 2.5); ctx.fill();
    }
  };

  Renderer.prototype.drawRock = function (ctx, r, path) {
    if (r.alive === false) return;
    ctx.save();
    ctx.translate(r.x + 5, r.y + 7);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fill(path);
    ctx.translate(-5, -7);
    ctx.fillStyle = PAL.rock; ctx.fill(path);
    ctx.lineWidth = 5; ctx.strokeStyle = PAL.rockEdge; ctx.stroke(path);
    ctx.translate(-r.r * 0.14, -r.r * 0.16);
    ctx.scale(0.6, 0.6);
    ctx.fillStyle = PAL.rockShine; ctx.fill(path);
    ctx.restore();
  };

  Renderer.prototype.drawRockHealth = function (ctx, r) {
    if (r.alive === false) return;
    if (Number.isFinite(r.maxHp) && r.maxHp > 0) {
      var hp = Number.isFinite(r.hp) ? r.hp : r.maxHp, damaged = hp < r.maxHp, heavy = hp < 600;
      if (damaged) {
        ctx.save(); ctx.translate(r.x, r.y);
        ctx.strokeStyle = heavy ? '#505a63' : '#6c737b'; ctx.lineWidth = heavy ? 4 : 2;
        ctx.beginPath();
        if (heavy) {
          ctx.moveTo(-r.r * 0.56, -r.r * 0.35); ctx.lineTo(-r.r * 0.2, -r.r * 0.08); ctx.lineTo(-r.r * 0.32, r.r * 0.2); ctx.lineTo(r.r * 0.04, r.r * 0.48);
          ctx.moveTo(-r.r * 0.2, -r.r * 0.08); ctx.lineTo(r.r * 0.16, -r.r * 0.25); ctx.lineTo(r.r * 0.5, -r.r * 0.08);
          ctx.moveTo(r.r * 0.16, -r.r * 0.25); ctx.lineTo(r.r * 0.27, -r.r * 0.56);
          ctx.moveTo(r.r * 0.28, r.r * 0.1); ctx.lineTo(r.r * 0.48, r.r * 0.32); ctx.lineTo(r.r * 0.36, r.r * 0.5);
        } else {
          ctx.moveTo(-r.r * 0.4, -r.r * 0.08); ctx.lineTo(-r.r * 0.18, r.r * 0.02); ctx.lineTo(-r.r * 0.24, r.r * 0.16);
          ctx.moveTo(r.r * 0.18, -r.r * 0.3); ctx.lineTo(r.r * 0.34, -r.r * 0.2);
        }
        ctx.stroke(); ctx.restore();
      }
      var bw = Math.max(48, Math.min(96, r.r * 1.7)), by = r.y - r.r - 17, ratio = U.clamp(hp / r.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(20,24,30,0.75)'; roundRect(ctx, r.x - bw / 2 - 2, by - 2, bw + 4, 9, 4); ctx.fill();
      ctx.fillStyle = heavy ? '#ffd23f' : '#a7c5d8'; roundRect(ctx, r.x - bw / 2, by, Math.max(2, bw * ratio), 5, 2.5); ctx.fill();
      ctx.font = '11px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,24,30,0.8)';
      var label = Math.ceil(hp) + ' / ' + r.maxHp;
      ctx.strokeText(label, r.x, by - 5); ctx.fillStyle = '#e7edf2'; ctx.fillText(label, r.x, by - 5);
    }
  };

  Renderer.prototype.drawCanopies = function (ctx, map, v, viewer, dt) {
    var self = this, k = Math.min(1, dt * 8), vx = viewer && viewer.alive ? viewer.x : -1e9, vy = viewer && viewer.alive ? viewer.y : -1e9;
    function stamp(list, sprites, base, under) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        var inside = Math.hypot(vx - o.x, vy - o.y) < o.r * under;
        o.fade += ((inside ? 0.4 : 1) - o.fade) * k;
        if (!visible(v, o.x, o.y, o.r * 1.3)) continue;
        var spr = sprites[o.variant % sprites.length], scale = o.r / base;
        ctx.save();
        ctx.globalAlpha = o.fade;
        ctx.translate(o.x, o.y);
        ctx.rotate(o.rot);
        var size = spr.size * scale * (base / spr.R);
        ctx.drawImage(spr.canvas, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }
    stamp(map.bushes, self.bushes, 50, 1.0);
    stamp(map.trees, self.trees, 110, 0.9);
  };

  // ---------------------------------------------------------------- players
  function emblem(ctx, classId, r) {
    classId = classId.replace(/[23]$/, '');
    if (classId === 'soldier') return;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = r * 0.13;
    if (classId === 'pyromancer' || classId === 'pyromaniac') {
      ctx.beginPath(); ctx.moveTo(0, -r * 0.6); ctx.quadraticCurveTo(r * 0.8, r * 0.35, 0, r * 0.5); ctx.quadraticCurveTo(-r * 0.65, r * 0.25, 0, -r * 0.6); ctx.fill();
      if (classId === 'pyromaniac') { ctx.beginPath(); ctx.moveTo(-r * .6, -r * .4); ctx.lineTo(-r * .43, -r * .23); ctx.moveTo(r * .6, -r * .4); ctx.lineTo(r * .43, -r * .23); ctx.stroke(); }
    } else if (classId === 'juggernaut') {
      ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.45); ctx.lineTo(r * 0.45, -r * 0.45); ctx.lineTo(r * 0.38, r * 0.2); ctx.lineTo(0, r * 0.55); ctx.lineTo(-r * 0.38, r * 0.2); ctx.closePath(); ctx.stroke();
    } else if (classId === 'commander') {
      for (var ci = -1; ci <= 1; ci++) { ctx.beginPath(); ctx.moveTo(-r * 0.4, ci * r * 0.25); ctx.lineTo(0, ci * r * 0.25 - r * 0.2); ctx.lineTo(r * 0.4, ci * r * 0.25); ctx.stroke(); }
    } else if (classId === 'armorcrew') {
      ctx.save(); ctx.rotate(-0.55);
      roundRect(ctx, -r * 0.1, -r * 0.08, r * 0.2, r * 0.65, r * 0.06); ctx.fill();
      roundRect(ctx, -r * 0.45, -r * 0.4, r * 0.9, r * 0.32, r * 0.08); ctx.fill(); ctx.restore();
    } else if (classId === 'engineer') {
      ctx.save(); ctx.rotate(-0.7);
      ctx.beginPath(); ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.23, 0); ctx.lineWidth = r * 0.22; ctx.stroke();
      ctx.beginPath(); ctx.arc(r * 0.28, 0, r * 0.24, 0.7, TAU - 0.7); ctx.lineWidth = r * 0.14; ctx.stroke(); ctx.restore();
    } else if (classId === 'shieldoperator') {
      ctx.beginPath(); ctx.moveTo(-r * 0.48, -r * 0.42); ctx.quadraticCurveTo(0, -r * 0.65, r * 0.48, -r * 0.42);
      ctx.lineTo(r * 0.4, r * 0.24); ctx.lineTo(0, r * 0.6); ctx.lineTo(-r * 0.4, r * 0.24); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.22, -r * 0.18); ctx.lineTo(r * 0.22, -r * 0.18); ctx.stroke();
    } else if (classId === 'rocketeer') {
      ctx.save(); ctx.rotate(-0.6);
      ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.17); ctx.lineTo(r * 0.25, -r * 0.17); ctx.lineTo(r * 0.65, 0); ctx.lineTo(r * 0.25, r * 0.17); ctx.lineTo(-r * 0.6, r * 0.17); ctx.lineTo(-r * 0.4, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-r * 0.32, -r * 0.17); ctx.lineTo(-r * 0.52, -r * 0.42); ctx.lineTo(-r * 0.12, -r * 0.42); ctx.lineTo(r * 0.05, -r * 0.17); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-r * 0.32, r * 0.17); ctx.lineTo(-r * 0.52, r * 0.42); ctx.lineTo(-r * 0.12, r * 0.42); ctx.lineTo(r * 0.05, r * 0.17); ctx.fill(); ctx.restore();
    } else if (classId === 'magicmedic') {
      ctx.fillRect(-r * 0.14, -r * 0.48, r * 0.28, r * 0.96);
      ctx.fillRect(-r * 0.48, -r * 0.14, r * 0.96, r * 0.28);
      ctx.beginPath(); ctx.moveTo(r * 0.43, -r * 0.76); ctx.lineTo(r * 0.52, -r * 0.52); ctx.lineTo(r * 0.76, -r * 0.43); ctx.lineTo(r * 0.52, -r * 0.34); ctx.lineTo(r * 0.43, -r * 0.1); ctx.lineTo(r * 0.34, -r * 0.34); ctx.lineTo(r * 0.1, -r * 0.43); ctx.lineTo(r * 0.34, -r * 0.52); ctx.closePath(); ctx.fill();
    } else if (classId === 'medic') {
      var a = r * 0.16, b = r * 0.5;
      ctx.fillRect(-a, -b, a * 2, b * 2);
      ctx.fillRect(-b, -a, b * 2, a * 2);
    } else if (classId === 'sniper') {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.36, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.58, 0); ctx.lineTo(-r * 0.18, 0); ctx.moveTo(r * 0.18, 0); ctx.lineTo(r * 0.58, 0);
      ctx.moveTo(0, -r * 0.58); ctx.lineTo(0, -r * 0.18); ctx.moveTo(0, r * 0.18); ctx.lineTo(0, r * 0.58);
      ctx.stroke();
    } else if (classId === 'shotgunner') {
      for (var i = 0; i < 3; i++) {
        var an = -Math.PI / 2 + i * TAU / 3;
        ctx.beginPath(); ctx.arc(Math.cos(an) * r * 0.27, Math.sin(an) * r * 0.27, r * 0.15, 0, TAU); ctx.fill();
      }
    } else if (classId === 'grenadier') {
      ctx.beginPath(); ctx.arc(0, r * 0.1, r * 0.3, 0, TAU); ctx.fill();
      ctx.fillRect(-r * 0.1, -r * 0.34, r * 0.2, r * 0.18);
      ctx.beginPath(); ctx.moveTo(0, -r * 0.34); ctx.quadraticCurveTo(r * 0.25, -r * 0.6, r * 0.42, -r * 0.42); ctx.stroke();
    }
  }

  Renderer.prototype.drawHammer = function (ctx, r, recoil) {
    var swing = U.clamp(recoil || 0, 0, 1);
    ctx.save();
    if (swing > 0.15) {
      ctx.strokeStyle = 'rgba(255,236,168,' + (swing * 0.5).toFixed(2) + ')'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(0, 0, r * 2, -0.9, 0.5 - swing, false); ctx.stroke();
    }
    ctx.rotate(swing > 0.02 ? 0.5 - swing * 1.4 : 0.5);
    ctx.fillStyle = '#b9874c'; ctx.strokeStyle = '#65452c'; ctx.lineWidth = 3;
    roundRect(ctx, r * 0.45, -r * 0.13, r * 1.55, r * 0.26, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#56636b'; ctx.strokeStyle = '#25333c';
    roundRect(ctx, r * 1.62, -r * 0.55, r * 0.65, r * 1.1, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#becbd0'; roundRect(ctx, r * 1.7, -r * 0.44, r * 0.18, r * 0.86, 2); ctx.fill();
    ctx.fillStyle = '#705236'; ctx.fillRect(r * 0.65, -r * 0.13, r * 0.12, r * 0.26); ctx.fillRect(r * 0.85, -r * 0.13, r * 0.12, r * 0.26);
    ctx.restore();
  };

  Renderer.prototype.drawWeapon = function (ctx, weaponId, r, recoil, spin, time, reloading) {
    if (weaponId === 'dualrevolver' || weaponId === 'pyrodualrevolver') {
      for (var side = -1; side <= 1; side += 2) {
        ctx.save(); ctx.translate(r * 0.05, side * r * 0.58); this.drawWeapon(ctx, 'revolver', r * 0.85, recoil, 0, time, reloading); ctx.restore();
      }
      if (weaponId === 'pyrodualrevolver') { ctx.save(); ctx.fillStyle = '#f5a14d'; ctx.fillRect(r * .65, -r * .67, r * .18, r * .18); ctx.fillRect(r * .65, r * .49, r * .18, r * .18); ctx.restore(); }
      return;
    }
    if (weaponId === 'pyroflamethrower' || weaponId === 'firegun') { this.drawPyroWeapon(ctx, weaponId, r, recoil, time); return; }
    if (weaponId === 'medicstaff') { this.drawMedicStaff(ctx, r, time, false); return; }
    if (weaponId === 'hammer' || weaponId === 'engineerhammer') { this.drawHammer(ctx, r, recoil); return; }
    if (weaponId === 'wrench') { this.drawWrench(ctx, r, spin, time); return; }
    if (weaponId === 'rpg') {
      ctx.save(); ctx.translate(-recoil * r * 0.22, 0);
      ctx.fillStyle = '#899755'; ctx.strokeStyle = '#39452d'; ctx.lineWidth = 3;
      roundRect(ctx, r * 0.1, -r * 0.26, r * 1.8, r * 0.52, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#52603e'; ctx.fillRect(r * 0.1, -r * 0.33, r * 0.18, r * 0.66);
      ctx.fillStyle = '#bdc48e'; ctx.beginPath(); ctx.moveTo(r * 1.55, -r * 0.3); ctx.lineTo(r * 1.95, -r * 0.43); ctx.lineTo(r * 2.4, 0); ctx.lineTo(r * 1.95, r * 0.43); ctx.lineTo(r * 1.55, r * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#344533'; ctx.fillRect(r * 0.65, -r * 0.39, r * 0.35, r * 0.15); ctx.restore(); return;
    }
    if (weaponId === 'shieldpistol' || weaponId === 'explosiveshield') {
      ctx.save();
      if (weaponId === 'shieldpistol' && reloading) { ctx.rotate(Math.PI / 2); ctx.globalAlpha *= 0.6; }
      this.drawShield(ctx, r, weaponId === 'explosiveshield', !reloading);
      ctx.restore();
      if (weaponId === 'shieldpistol') {
        ctx.save(); ctx.translate(r * 0.56, 0); this.drawWeapon(ctx, 'pistol', r, recoil, 0, time); ctx.restore();
      }
      return;
    }
    var b = W.BARRELS[weaponId] || {}, kick = -recoil * r * 0.22;
    ctx.lineWidth = 3.5;
    ctx.fillStyle = PAL.barrel;
    ctx.strokeStyle = PAL.barrelEdge;
    if (weaponId === 'commandradar') {
      ctx.fillStyle = '#294b70'; ctx.strokeStyle = '#77c8ff'; ctx.beginPath(); ctx.arc(r * 1.1, r * 0.35, r * 0.55, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 1.1, r * 0.35); ctx.lineTo(r * 1.48, r * 0.05); ctx.stroke();
    } else if (b.parts) {
      for (var i = 0; i < b.parts.length; i++) {
        var pt = b.parts[i];
        ctx.beginPath(); ctx.rect(pt.x * r + kick, -pt.h * r / 2, pt.len * r, pt.h * r); ctx.fill(); ctx.stroke();
      }
      if (weaponId === 'minigun') {
        ctx.strokeStyle = '#e0e8f3'; ctx.lineWidth = 2;
        for (var bi = 0; bi < 3; bi++) { var by = Math.sin((time || 0) * (spin > 0 ? 65 : 0) + bi * TAU / 3) * r * 0.22; ctx.beginPath(); ctx.moveTo(r * 1.1 + kick, by); ctx.lineTo(r * 2.45 + kick, by); ctx.stroke(); }
      }
    } else if (b.trap) {
      var tp = b.trap, x0 = tp.x * r + kick, x1 = (tp.x + tp.len) * r + kick;
      ctx.beginPath();
      ctx.moveTo(x0, -tp.h0 * r / 2); ctx.lineTo(x1, -tp.h1 * r / 2); ctx.lineTo(x1, tp.h1 * r / 2); ctx.lineTo(x0, tp.h0 * r / 2);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (b.held === 'grenade') {
      var gx = r * 1.02 + kick * 2, gy = r * 0.6;
      ctx.beginPath(); ctx.arc(gx, gy, r * 0.36, 0, TAU);
      ctx.fillStyle = '#56733f'; ctx.fill(); ctx.strokeStyle = '#2f4222'; ctx.stroke();
      ctx.fillStyle = '#8b939c'; ctx.fillRect(gx - r * 0.1, gy - r * 0.52, r * 0.2, r * 0.2);
    } else if (b.held === 'medkit') {
      var mx = r * 0.78, my = r * 0.28, s = r * 0.72;
      roundRect(ctx, mx, my, s, s * 0.8, 4);
      ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#b9c0c8'; ctx.stroke();
      ctx.fillStyle = '#ff4d63';
      ctx.fillRect(mx + s * 0.4, my + s * 0.12, s * 0.2, s * 0.56);
      ctx.fillRect(mx + s * 0.2, my + s * 0.3, s * 0.6, s * 0.2);
    }
  };

  Renderer.prototype.drawPyroWeapon = function (ctx, id, r, recoil, time) {
    ctx.save(); ctx.translate(-(recoil || 0) * r * .22, 0);
    ctx.fillStyle = '#965237'; ctx.strokeStyle = '#4a3831'; ctx.lineWidth = 3;
    var firegun = id === 'firegun';
    roundRect(ctx, r * .25, -r * .3, r * (firegun ? 1.35 : 1.85), r * .6, 4); ctx.fill(); ctx.stroke();
    if (!firegun) {
      ctx.fillStyle = '#dca044';
      roundRect(ctx, r * .25, -r * .55, r * .5, r * 1.1, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#573b35'; ctx.fillRect(r * .39, -r * .5, r * .11, r);
    }
    ctx.strokeStyle = '#ffbf72'; ctx.lineWidth = 3;
    for (var i = 0; i < 3; i++) { var x = r * (firegun ? .6 + i * .22 : 1 + i * .22); ctx.beginPath(); ctx.moveTo(x, -r * .27); ctx.lineTo(x, r * .27); ctx.stroke(); }
    var muzzle = r * (firegun ? 1.62 : 2.12), pulse = .2 + Math.sin((time || 0) * 10) * .035;
    ctx.fillStyle = '#ff7139'; ctx.strokeStyle = '#6b3c2c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(muzzle, 0, r * pulse, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffefae'; ctx.beginPath(); ctx.arc(muzzle, 0, r * .09, 0, TAU); ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawMedicStaff = function (ctx, r, t, recharging) {
    ctx.save(); ctx.rotate(-0.32);
    ctx.lineWidth = 3; ctx.strokeStyle = '#584363'; ctx.fillStyle = '#d4b475';
    roundRect(ctx, r * 0.3, -r * 0.12, r * 1.75, r * 0.24, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = recharging ? '#8f9d9d' : '#b7ffe3'; ctx.strokeStyle = '#527a79';
    ctx.beginPath(); ctx.arc(r * 2.12, 0, r * 0.46, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = recharging ? '#677d77' : '#42ad88';
    ctx.fillRect(r * 2.04, -r * 0.3, r * 0.16, r * 0.6); ctx.fillRect(r * 1.82, -r * 0.08, r * 0.6, r * 0.16);
    if (!recharging) {
      ctx.strokeStyle = 'rgba(201,255,228,0.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r * 2.12, 0, r * (0.58 + Math.sin((t || 0) * 3) * 0.05), 0, TAU); ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype.drawMedicStaffs = function (ctx, world, v, t, viewer) {
    var self = this, staffs = world.placedMedicStaffs ? world.placedMedicStaffs() : [];
    staffs.forEach(function (staff) {
      if (!visible(v, staff.x, staff.y, 310)) return;
      ctx.save(); ctx.translate(staff.x, staff.y);
      var charging = staff.recharge > 0, color = charging ? '#aabbb7' : '#b7ffe3';
      ctx.fillStyle = charging ? 'rgba(165,185,180,0.04)' : 'rgba(120,247,184,0.07)';
      ctx.strokeStyle = charging ? 'rgba(165,185,180,0.32)' : 'rgba(150,255,205,0.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, W.MedicStaff ? W.MedicStaff.placedRadius : 300, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#423b4d'; ctx.beginPath(); ctx.ellipse(0, 12, 24, 12, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(-8, 28); ctx.rotate(-Math.PI / 2 + 0.32); self.drawMedicStaff(ctx, 27, t, charging); ctx.restore();
      ctx.font = '15px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.strokeStyle = '#263c36'; ctx.lineWidth = 4;
      var label = 'Medic Staff' + (charging ? ' · ' + Math.ceil(staff.recharge) + 's' : '');
      ctx.strokeText(label, 0, -60); ctx.fillStyle = color; ctx.fillText(label, 0, -60);
      ctx.restore();
    });
    (world.players || []).forEach(function (p) {
      var s = p.medicStaff;
      if (!s || s.placed || !s.active || !p.alive || p.hidden || p.downed || !visible(v, p.x, p.y, 160) ||
          (p.fx && p.fx.invisible > 0 && viewer && viewer.team !== p.team)) return;
      var target = world.playerById(s.target);
      if (!target || target.hidden || !target.alive || (target.fx && target.fx.invisible > 0 && viewer && viewer.team !== target.team)) return;
      ctx.save(); ctx.strokeStyle = 'rgba(150,255,205,0.65)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(target.x, target.y); ctx.stroke(); ctx.restore();
    });
  };

  Renderer.prototype.drawWrench = function (ctx, r, building, t) {
    ctx.save(); ctx.rotate(building ? Math.sin((t || 0) * 14) * 0.18 : 0.35);
    ctx.fillStyle = '#b7cbd7'; ctx.strokeStyle = '#344854'; ctx.lineWidth = 3;
    roundRect(ctx, r * 0.55, -r * 0.15, r * 1.25, r * 0.3, 3); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(r * 1.88, 0, r * 0.43, 0.75, TAU - 0.75); ctx.lineTo(r * 1.79, -r * 0.17);
    ctx.lineTo(r * 1.79, r * 0.17); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#344854'; ctx.beginPath(); ctx.arc(r * 0.72, 0, r * 0.06, 0, TAU); ctx.fill(); ctx.restore();
  };

  Renderer.prototype.drawShield = function (ctx, r, explosive, raised) {
    var R = r + 10, arc = W.ITEMS.riotshield.arc;
    ctx.beginPath(); ctx.arc(0, 0, R, -arc, arc);
    ctx.strokeStyle = explosive ? '#6e2933' : '#3f4c63'; ctx.lineWidth = 16; ctx.stroke();
    ctx.strokeStyle = explosive ? '#f15c5b' : raised ? '#9fd4ff' : '#c3ccda'; ctx.lineWidth = 9; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, R + 3, -arc * 0.7, arc * 0.7); ctx.stroke();
    if (explosive) {
      ctx.fillStyle = '#fff2c6'; ctx.beginPath(); ctx.moveTo(R + 4, 0); ctx.lineTo(R - 3, -5); ctx.lineTo(R - 3, 5); ctx.closePath(); ctx.fill();
    }
  };

  Renderer.prototype.drawSentryBuild = function (ctx, p, t, preview) {
    var build = p.sentryBuild;
    if (!build || !p.alive || p.downed || p.mount || p.vehicle || p.hidden || p.dropT > 0) return;
    var progress = U.clamp(build.elapsed / W.WEAPONS.wrench.buildSeconds, 0, 1);
    ctx.save();
    if (preview) {
      ctx.translate(build.x, build.y); ctx.globalAlpha *= 0.25 + progress * 0.4;
      this.drawEmplacement(ctx, { r: W.STRUCT_RADIUS.sentry, kind: 'sentry', item: 'sentry', angle: p.angle, flash: 0, target: 0 }, W.TIERS.epic, true);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ffe893'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.arc(0, 0, W.STRUCT_RADIUS.sentry + 16, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.translate(p.x + (p.ox || 0), p.y + (p.oy || 0));
      ctx.strokeStyle = 'rgba(27,43,54,0.8)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, p.r + 10, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#ffe893'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, p.r + 10, -Math.PI / 2, -Math.PI / 2 + progress * TAU); ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype.drawParachute = function (ctx, r, drop, color, t) {
    var R = r * 2.3, alpha = Math.min(1, (drop - 0.08) * 4);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= 0.94 * alpha;
    ctx.rotate(Math.sin(t * 2.2) * 0.1);
    for (var i = 0; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, i / 8 * TAU, (i + 1) / 8 * TAU); ctx.closePath();
      ctx.fillStyle = i % 2 ? '#ffffff' : color; ctx.fill();
    }
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.16, 0, TAU); ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawPlayer = function (ctx, p, t, opts) {
    opts = opts || {};
    if (p.hidden || p.vehicle) return; // Occupants are drawn in their seats by drawVehicle.
    if (p.fx && p.fx.invisible > 0 && opts.viewer && opts.viewer !== p && opts.viewer.team !== p.team) return;
    var r = p.r, scale = 1, alpha = 1, lift = 0, drop = p.dropT > 0 ? p.dropT / C.dropDuration : 0;
    var px = p.x + (p.ox || 0), py = p.y + (p.oy || 0); // ox/oy: smoothed correction toward the server position
    var invisible = p.fx && p.fx.invisible > 0, held = p.held >= 0 && p.items && p.items[p.held] ? W.ITEMS[p.items[p.held].id] : null;
    if (!p.alive) {
      if (p.deadT > 0.35) return;
      scale = 1 + p.deadT * 1.6;
      alpha = 1 - p.deadT / 0.35;
    }
    if (drop > 0) {
      ctx.fillStyle = 'rgba(0,0,0,' + (0.1 + 0.2 * (1 - drop)).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(px, py, r * (1.15 - drop * 0.45), 0, TAU); ctx.fill();
      scale = 1 + drop * 2.4;
      lift = drop * 46;
    }
    if (p.downed && p.alive) {
      // Knocked down: bleed-out ring (red, draining) and revive progress (green, filling).
      var kd = U.clamp(p.downT / 30, 0, 1), pulse = 0.55 + 0.45 * Math.sin(t * 6);
      ctx.strokeStyle = 'rgba(255,90,79,' + (0.35 + 0.4 * pulse).toFixed(2) + ')';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(px, py, r + 11, -Math.PI / 2, -Math.PI / 2 + TAU * kd); ctx.stroke();
      if (p.revive > 0) {
        ctx.strokeStyle = '#63ff9e';
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(px, py, r + 19, -Math.PI / 2, -Math.PI / 2 + TAU * U.clamp(p.revive, 0, 1)); ctx.stroke();
      }
    }
    ctx.save();
    ctx.globalAlpha = alpha * (p.downed ? 0.85 : 1) * (invisible ? 0.38 : 1);
    ctx.translate(px, py - lift);
    ctx.scale(scale * (p.downed ? 0.9 : 1), scale * (p.downed ? 0.9 : 1));
    if (!p.downed && !p.mount) {
      ctx.save();
      var hammerSwing = p.meleeSwing > 0 ? U.clamp(p.meleeSwing / 0.24, 0, 1) : 0;
      ctx.rotate(hammerSwing && !p.repairVehicle ? p.meleeAngle : p.angle);
      if (p.repairVehicle) this.drawHammer(ctx, r, 0.5 + 0.5 * Math.sin(t * 13));
      else if (held) this.drawHeld(ctx, held, r, p.recoil, p.shieldUp);
      else if (p.held < 0 && !(p.weapons[p.slot].id === 'medicstaff' && p.medicStaff && p.medicStaff.placed)) this.drawWeapon(ctx, p.weapons[p.slot].id, r, W.WEAPONS[p.weapons[p.slot].id].kind === 'melee' ? hammerSwing : p.recoil, p.sentryBuild ? 1 : p.minigunSpin, t, p.weapons[p.slot].reloading);
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
    var body = p.downed ? mix(p.color, '#6b7280', 0.55) : p.color;
    ctx.fillStyle = p.hitFlash > 0.02 ? mix(body, '#ffffff', p.hitFlash * 0.65) : body;
    ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = p.outline;
    if (invisible) ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (p.fx && p.fx.immune > 0) {
      ctx.strokeStyle = 'rgba(127,233,255,0.9)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, r + 9, 0, TAU); ctx.stroke();
    } else if (p.fx && (p.fx.reduce > 0 || p.fx.shield > 0 || p.fx.power > 0)) {
      ctx.strokeStyle = p.fx.power > 0 ? 'rgba(255,210,63,0.7)' : 'rgba(159,212,255,0.6)'; ctx.lineWidth = 3;
      ctx.setLineDash([8, 7]); ctx.lineDashOffset = -t * 30;
      ctx.beginPath(); ctx.arc(0, 0, r + 8, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.fx && p.fx.poison > 0) {
      ctx.fillStyle = 'rgba(140,255,74,' + (0.35 + 0.25 * Math.sin(t * 8)).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU); ctx.fill();
    }
    if (p.downed) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.4); ctx.lineTo(r * 0.4, r * 0.4); ctx.moveTo(r * 0.4, -r * 0.4); ctx.lineTo(-r * 0.4, r * 0.4);
      ctx.stroke();
    } else if (W.CosmeticArt && W.CosmeticArt.face(ctx, p.face, r, body)) {
      // A chosen face owns the head; preserve the class mark as a small shoulder badge.
      if (p.classId !== 'soldier') {
        ctx.save(); ctx.translate(r * 0.76, r * 0.63);
        ctx.fillStyle = '#283748'; ctx.strokeStyle = '#f2f3de'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.43, 0, TAU); ctx.fill(); ctx.stroke();
        emblem(ctx, p.classId, r * 0.56); ctx.restore();
      }
    } else emblem(ctx, p.classId, r);
    if (p.healFlash > 0) {
      ctx.strokeStyle = 'rgba(99,255,158,' + p.healFlash.toFixed(2) + ')';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, r + 8 + (1 - p.healFlash) * 14, 0, TAU); ctx.stroke();
    }
    if (drop > 0) this.drawParachute(ctx, r, drop, p.color, t);
    ctx.restore();
    if (p.repairVehicle && p.alive && !p.downed) this.drawRepair(ctx, p, px, py, t);
    if (p.sentryBuild && !(invisible && opts.viewer && opts.viewer !== p && opts.viewer.team !== p.team)) this.drawSentryBuild(ctx, p, t, false);
    if (!p.alive || drop > 0) return;
    if (p.hp < p.maxHp || p.downed) {
      var bw = r * 2.3, bx = px - bw / 2, by = py + r + 11, k = U.clamp(p.hp / p.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(20,24,30,0.72)';
      roundRect(ctx, bx - 2, by - 2, bw + 4, 11, 5); ctx.fill();
      ctx.fillStyle = p.downed ? '#ff5a4f' : k > 0.5 ? '#7ee05c' : k > 0.25 ? '#ffd23f' : '#ff5a4f';
      roundRect(ctx, bx, by, Math.max(3, bw * k), 7, 3.5); ctx.fill();
    }
    if ((opts.names && !p.isLocal) || p.downed || p.practiceBot) {
      var viewer = opts.viewer, mate = viewer && viewer !== p && viewer.team === p.team;
      var label = p.downed ? (p.isLocal ? 'DOWNED' : p.name + ' · DOWNED') : p.name + (p.practiceBot ? ' · ∞ HP' : '');
      ctx.font = '16px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20,22,30,0.8)';
      ctx.strokeText(label, px, py - r - 16);
      ctx.fillStyle = p.downed ? '#ff8a7a' : mate ? '#8cff6a' : '#ffffff';
      ctx.fillText(label, px, py - r - 16);
    }
    this.drawEmote(ctx, p, t, px, py - r - 66, opts.viewer);
  };

  // These are fixed Locker emotes, not arbitrary chat text. Draw below foliage, roofs and smoke like the body.
  Renderer.prototype.drawEmote = function (ctx, p, t, x, y, viewer) {
    if (!p || p.hidden || p.alive === false || p.downed || p.dropT > 0 || !p.emote || !W.Cosmetics) return false;
    if (p.fx && p.fx.invisible > 0 && viewer && viewer !== p && viewer.team !== p.team) return false;
    var left = p.emote.until - t, def = W.Cosmetics.emote(p.emote.id);
    if (!(left > 0) || !Number.isFinite(left) || !def) return false;
    var age = Math.max(0, (W.Cosmetics.EMOTE_DURATION || 3) - left);
    var pop = this.reducedMotion ? 1 : age < 0.16 ? 0.76 + age / 0.16 * 0.3 : age < 0.28 ? 1.06 - (age - 0.16) / 0.12 * 0.06 : 1;
    var words = /^(gg|hi|bye|haha|cooked)$/.test(def.id), text = def.glyph || def.label;
    ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
    ctx.globalAlpha = Math.min(1, left / 0.3);
    ctx.font = words ? '20px ' + FONT : '30px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    var width = Math.max(52, ctx.measureText(text).width + 28), height = 46;
    ctx.fillStyle = 'rgba(9,17,27,0.24)'; roundRect(ctx, -width / 2 + 2, -height / 2 + 4, width, height, 13); ctx.fill();
    ctx.fillStyle = '#fffdf3'; ctx.strokeStyle = '#263446'; ctx.lineWidth = 3;
    roundRect(ctx, -width / 2, -height / 2, width, height, 13); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, height / 2 - 1); ctx.lineTo(0, height / 2 + 8); ctx.lineTo(7, height / 2 - 1); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6, height / 2); ctx.lineTo(0, height / 2 + 8); ctx.lineTo(7, height / 2); ctx.stroke();
    ctx.fillStyle = '#243648'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, words ? 1 : 2);
    ctx.restore(); return true;
  };

  Renderer.prototype.drawVehicleEmotes = function (ctx, world, car, t, viewer) {
    if (car.wreck || car.hidden || !car.seats || !W.Cosmetics) return;
    var occupants = ['driver', 'rearLeft', 'gunner', 'rearRight'].map(function (seat) {
      return car.seats[seat] && world.playerById(car.seats[seat]);
    }).filter(function (p) {
      return p && p.emote && p.emote.until > t && W.Cosmetics.emote(p.emote.id) && !p.hidden && p.alive !== false && !p.downed && !(p.dropT > 0) &&
        !(p.fx && p.fx.invisible > 0 && viewer && viewer !== p && viewer.team !== p.team);
    });
    // Two columns keep even four long phrases readable without covering the entire vehicle in one row.
    var column = 82;
    ctx.save();
    for (var n = 0; n < occupants.length; n++) {
      var def = W.Cosmetics.emote(occupants[n].emote.id), words = /^(gg|hi|bye|haha|cooked)$/.test(def.id);
      ctx.font = words ? '20px ' + FONT : '30px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      column = Math.max(column, ctx.measureText(def.glyph || def.label).width + 42);
    }
    ctx.restore();
    for (var i = 0; i < occupants.length; i++) {
      var p = occupants[i], row = Math.floor(i / 2), pair = occupants.length - row * 2 > 1;
      var dx = pair ? (i % 2 - 0.5) * column : 0;
      this.drawEmote(ctx, p, t, car.x + (car.ox || 0) + dx, car.y + (car.oy || 0) - (car.r || 80) - 56 - row * 64, viewer);
    }
  };

  Renderer.prototype.drawRepair = function (ctx, p, x, y, t) {
    var angle = p.angle, hx = x + Math.cos(angle) * p.r * 2.2, hy = y + Math.sin(angle) * p.r * 2.2;
    ctx.save(); ctx.translate(hx, hy);
    var pulse = 0.6 + Math.sin(t * 26) * 0.3;
    ctx.fillStyle = 'rgba(117,225,255,' + pulse.toFixed(2) + ')'; ctx.beginPath(); ctx.arc(0, 0, 7 + pulse * 3, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffe893'; ctx.lineWidth = 2;
    for (var i = 0; i < 5; i++) {
      var a = t * 4 + i * TAU / 5, length = 11 + (Math.sin(t * 19 + i) + 1) * 6;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7); ctx.lineTo(Math.cos(a) * length, Math.sin(a) * length); ctx.stroke();
    }
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill(); ctx.restore();
  };

  // ---------------------------------------------------------------- items: held, structures, zones, strikes, reveals
  Renderer.prototype.drawHeld = function (ctx, it, r, recoil, shieldUp) {
    var tier = W.TIERS[it.tier], kick = -recoil * r * 0.2;
    ctx.lineWidth = 3;
    if (it.kind === 'hold') {
      this.drawShield(ctx, r, false, shieldUp);
      return;
    }
    var hx = r * 1.45 + kick, hy = r * 0.65;
    var art = W.Icons && W.Icons.itemImage(it.id);
    if (art) { ctx.drawImage(art, hx - 18, hy - 18, 36, 36); return; }
    if (it.kind === 'consume' || it.kind === 'use') {
      roundRect(ctx, hx - 7, hy - 9, 14, 18, 4);
      ctx.fillStyle = tier.color; ctx.fill(); ctx.strokeStyle = tier.ink; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(hx - 3, hy - 14, 6, 6);
    } else if (it.kind === 'throw') {
      ctx.beginPath(); ctx.arc(hx, hy, r * 0.36, 0, TAU);
      ctx.fillStyle = it.id === 'grenade' ? '#56733f' : tier.color; ctx.fill();
      ctx.strokeStyle = it.id === 'grenade' ? '#2f4222' : tier.ink; ctx.stroke();
      ctx.fillStyle = '#8b939c'; ctx.fillRect(hx - r * 0.1, hy - r * 0.52, r * 0.2, r * 0.2);
    } else if (it.kind === 'place') {
      roundRect(ctx, hx - 9, hy - 9, 18, 18, 3);
      ctx.fillStyle = '#8f969e'; ctx.fill(); ctx.strokeStyle = tier.ink; ctx.stroke();
      ctx.fillStyle = tier.color; ctx.fillRect(hx - 4, hy - 4, 8, 8);
    } else {
      // Targeting remote with an antenna.
      roundRect(ctx, hx - 6, hy - 10, 12, 20, 3);
      ctx.fillStyle = '#2b3446'; ctx.fill(); ctx.strokeStyle = tier.ink; ctx.stroke();
      ctx.strokeStyle = tier.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx + 4, hy - 10); ctx.lineTo(hx + 10, hy - 22); ctx.stroke();
      ctx.fillStyle = tier.color; ctx.beginPath(); ctx.arc(hx, hy - 2, 3, 0, TAU); ctx.fill();
    }
  };

  Renderer.prototype.blobPath = function (ctx, r, seed) {
    ctx.beginPath();
    for (var i = 0; i < 9; i++) {
      var a = i / 9 * TAU, k = 1 + 0.14 * Math.sin(seed * 3.1 + i * 2.3);
      if (i) ctx.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k); else ctx.moveTo(Math.cos(a) * r * k, Math.sin(a) * r * k);
    }
    ctx.closePath();
  };

  Renderer.prototype.drawEmplacement = function (ctx, s, tier, mine) {
    var r = s.r, sentry = s.kind === 'sentry', item = W.ITEMS[s.item], variant = item && item.sentryVariant;
    var iv = variant && W.SENTRY_IV && W.SENTRY_IV[variant], level = iv ? 4 : /3$/.test(s.item) ? 3 : /2$/.test(s.item) ? 2 : 1;
    var teamColor = mine ? '#8cff6a' : '#ff5a4f', edge = '#172130';
    var visualScale = iv && iv.visualScale || 1;
    if (visualScale !== 1) { ctx.save(); ctx.scale(visualScale, visualScale); }
    ctx.fillStyle = 'rgba(0,0,0,0.24)'; ctx.beginPath(); ctx.ellipse(4, 7, r + 10, r + 6, 0, 0, TAU); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = edge;
    if (sentry) {
      // Automatic sentries have a three-legged chassis and an angular sensor head.
      for (var i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate(i * TAU / 3 + Math.PI);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r + 6, 0);
        ctx.strokeStyle = edge; ctx.lineWidth = 10; ctx.stroke();
        ctx.strokeStyle = '#9aaec2'; ctx.lineWidth = 5; ctx.stroke();
        roundRect(ctx, r - 1, -6, 13, 12, 3);
        ctx.fillStyle = '#33475b'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = teamColor; ctx.stroke();
        ctx.restore();
      }
      ctx.save(); ctx.rotate(s.angle);
      // Upgraded heads gain side armor and twin/triple forward emitters.
      if (level > 1) {
        ctx.fillStyle = iv ? iv.color : tier.color; ctx.strokeStyle = edge; ctx.lineWidth = 3;
        roundRect(ctx, -r * 0.75, -r * 0.95, r * 1.15, r * 1.9, 5); ctx.fill(); ctx.stroke();
      }
      ctx.strokeStyle = edge; ctx.lineWidth = 3; ctx.fillStyle = '#d1e1e9';
      var emitters = iv ? (variant === 'bullets' ? 4 : variant === 'rockets' ? 3 : 1) : level;
      var bore = iv && variant !== 'bullets' && variant !== 'rockets' ? (variant === 'cannons' ? 14 : 11) : 6;
      for (var b = 0; b < emitters; b++) {
        roundRect(ctx, r * 0.3 - s.flash * 3, (b - (emitters - 1) / 2) * 9 - bore / 2, r * (variant === 'cannons' ? 1.55 : 1.15), bore, 2); ctx.fill(); ctx.stroke();
      }
      roundRect(ctx, -r * 0.7, -r * 0.65, r * 1.35, r * 1.3, 5);
      ctx.fillStyle = '#35465d'; ctx.fill(); ctx.strokeStyle = edge; ctx.stroke();
      if (iv) {
        ctx.fillStyle = iv.color; ctx.beginPath(); ctx.arc(-r * 0.27, 0, 6, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#172130'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.fillStyle = s.target ? '#ff5a4f' : '#7fe9ff';
      roundRect(ctx, r * 0.12, -r * 0.4, 7, r * 0.8, 3); ctx.fill();
      ctx.strokeStyle = '#bfd6e7'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.4); ctx.lineTo(-r, -r * 1.15); ctx.stroke();
      ctx.fillStyle = teamColor; ctx.beginPath(); ctx.arc(-r, -r * 1.15, 4, 0, TAU); ctx.fill();
      ctx.restore();
    } else {
      // Mounted turrets have a broad wheeled platform, seat and a heavy cannon.
      ctx.fillStyle = '#27313e'; ctx.strokeStyle = edge; ctx.lineWidth = 4;
      roundRect(ctx, -r * 0.92, -r, r * 1.84, r * 2, 7); ctx.fill(); ctx.stroke();
      for (var side = -1; side <= 1; side += 2) {
        roundRect(ctx, -r - 5, side * r * 0.77 - 6, r * 2 + 10, 12, 4);
        ctx.fillStyle = '#526171'; ctx.fill(); ctx.stroke();
      }
      ctx.strokeStyle = teamColor; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.69, 0, TAU); ctx.stroke();
      ctx.save(); ctx.rotate(s.angle);
      ctx.fillStyle = '#9dadbb'; ctx.strokeStyle = edge; ctx.lineWidth = 3;
      var barrels = level === 3 ? 2 : 1;
      for (var j = 0; j < barrels; j++) {
        var by = (j - (barrels - 1) / 2) * 15;
        roundRect(ctx, r * 0.1 - s.flash * 4, by - 6, r * (level > 1 ? 1.95 : 1.7), 12, 3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#526171'; ctx.fillRect(r * 1.45 - s.flash * 4, by - 7, 9, 14); ctx.fillStyle = '#9dadbb';
      }
      if (level > 1) {
        roundRect(ctx, -5, -r * 0.85, 16, r * 1.7, 4);
        ctx.fillStyle = tier.color; ctx.fill(); ctx.stroke();
      }
      roundRect(ctx, -r * 0.7, -r * 0.4, r * 0.9, r * 0.8, 4);
      ctx.fillStyle = '#253043'; ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#b8c8d6'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-r * 0.4, -r * 0.6); ctx.lineTo(-r * 0.4, r * 0.6); ctx.stroke();
      ctx.restore();
    }
    // Rank lights sit along the back of the chassis, apart from the weapon.
    ctx.fillStyle = tier.color; ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
    for (var n = 0; n < level; n++) {
      ctx.beginPath(); ctx.arc((n - (level - 1) / 2) * 9, r + 7, 3, 0, TAU); ctx.fill(); ctx.stroke();
    }
    if (s.mounted) {
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(0, 0, r + 13, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    if (visualScale !== 1) ctx.restore();
  };

  // ---------------------------------------------------------------- vehicles
  function seatFace(ctx, p, x, y, rotation, viewer) {
    if (!p || p.hidden || !W.CosmeticArt || (p.fx && p.fx.invisible > 0 && viewer && viewer !== p && viewer.team !== p.team)) return;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-rotation);
    W.CosmeticArt.face(ctx, p.face, 10, p.color); ctx.restore();
  }
  Renderer.prototype.drawTank = function (ctx, world, car, t, viewer, access) {
    var x = car.x + (car.ox || 0), y = car.y + (car.oy || 0), angle = car.angle + (car.oa || 0), wreck = car.wreck;
    var edge = '#27342b', body = wreck ? '#505551' : '#6f8151', cannonFlash = car.cannonFlash || 0, flash = car.flash || 0;
    if (!wreck && car.hitFlash > 0) body = mix(body, '#ffffff', Math.min(1, car.hitFlash) * 0.65);
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = 'rgba(9,17,14,0.28)'; roundRect(ctx, -92, -61, 190, 132, 16); ctx.fill();
    // Continuous track belts and their tread blocks distinguish the tank from wheeled vehicles.
    for (var side = -1; side <= 1; side += 2) {
      var ty = side * 54 - 12;
      ctx.fillStyle = wreck ? '#272d2c' : '#303936'; ctx.strokeStyle = '#1d2926'; ctx.lineWidth = 4;
      roundRect(ctx, -90, ty, 180, 24, 10); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = wreck ? '#424a46' : '#657064'; ctx.lineWidth = 4;
      var travel = Math.hypot(car.vx || 0, car.vy || 0) > 3 ? (t * 45) % 14 : 0;
      for (var tread = 0; tread < 12; tread++) {
        var tx = -80 + (tread * 14 + travel) % 164;
        ctx.beginPath(); ctx.moveTo(tx, ty + 5); ctx.lineTo(tx, ty + 19); ctx.stroke();
      }
    }
    ctx.beginPath(); ctx.moveTo(-83, -43); ctx.lineTo(62, -48); ctx.lineTo(86, -31); ctx.lineTo(86, 31);
    ctx.lineTo(62, 48); ctx.lineTo(-83, 43); ctx.closePath();
    ctx.fillStyle = body; ctx.strokeStyle = edge; ctx.lineWidth = 5; ctx.fill(); ctx.stroke();
    ctx.fillStyle = wreck ? '#61685b' : '#9ba56b';
    ctx.beginPath(); ctx.moveTo(53, -39); ctx.lineTo(77, -27); ctx.lineTo(77, 27); ctx.lineTo(53, 39); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = wreck ? '#373e39' : '#485c3d'; ctx.lineWidth = 4;
    for (var vent = 0; vent < 5; vent++) {
      ctx.beginPath(); ctx.moveTo(-73 + vent * 7, -30); ctx.lineTo(-73 + vent * 7, 30); ctx.stroke();
    }
    ctx.fillStyle = wreck ? '#313a38' : '#5c8b83'; roundRect(ctx, 36, -34, 21, 20, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = wreck ? '#777466' : '#fff0b2'; ctx.fillRect(78, -28, 6, 9); ctx.fillRect(78, 19, 6, 9);
    ctx.strokeStyle = '#394c36'; ctx.lineWidth = 4; ctx.fillStyle = wreck ? '#3c443c' : '#83945e';
    ctx.beginPath(); ctx.arc(0, 0, 37, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.rotate((Number.isFinite(car.cannonAngle) ? car.cannonAngle : car.angle) - angle + (wreck ? 0.25 : 0));
    var recoil = cannonFlash * 9;
    ctx.fillStyle = wreck ? '#626962' : '#a3ae82'; ctx.strokeStyle = edge; ctx.lineWidth = 4;
    roundRect(ctx, 20 - recoil, -9, 94, 18, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = wreck ? '#393f3c' : '#556747'; roundRect(ctx, 100 - recoil, -12, 19, 24, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = body; roundRect(ctx, -27, -27, 64, 54, 13); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = wreck ? '#747a6d' : '#b5be8d'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-17, -18); ctx.lineTo(18, -18); ctx.lineTo(27, -11); ctx.stroke();
    if (!wreck && cannonFlash > 0.05) {
      ctx.fillStyle = '#ffe487'; ctx.beginPath(); ctx.moveTo(119 - recoil, -10); ctx.lineTo(145 + cannonFlash * 16, -18);
      ctx.lineTo(137 + cannonFlash * 12, 0); ctx.lineTo(145 + cannonFlash * 16, 18); ctx.lineTo(119 - recoil, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff8d6'; ctx.beginPath(); ctx.ellipse(125, 0, 19 * cannonFlash, 7, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
    // The machine gun has its own pivot and aim; its operator never turns the main cannon.
    ctx.save(); ctx.translate(0, 26); ctx.rotate((Number.isFinite(car.gunAngle) ? car.gunAngle : car.angle) - angle + (wreck ? -0.4 : 0));
    ctx.fillStyle = wreck ? '#444d4b' : '#72818a'; ctx.strokeStyle = '#25332e'; ctx.lineWidth = 3;
    roundRect(ctx, 6 - flash * 3, -4, 48, 8, 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3c4b43'; roundRect(ctx, -9, -9, 24, 18, 4); ctx.fill(); ctx.stroke();
    if (!wreck && flash > 0.05) {
      ctx.fillStyle = '#ffe487'; ctx.beginPath(); ctx.moveTo(53, -4); ctx.lineTo(70 + flash * 7, -9); ctx.lineTo(64, 0); ctx.lineTo(70 + flash * 7, 9); ctx.lineTo(53, 4); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    var seats = car.seats || {}, offsets = { driver: [43, -24], gunner: [0, 26], rearLeft: [-20, -28], rearRight: [-48, 24] };
    Object.keys(offsets).forEach(function (seat) {
      var at = offsets[seat], p = seats[seat] && world.playerById(seats[seat]);
      if (wreck || !seats[seat]) return;
      ctx.fillStyle = '#293c32'; ctx.strokeStyle = '#a4af82'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(at[0], at[1], 15, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = p ? p.color : '#b4bec9'; ctx.strokeStyle = p ? p.outline : '#35434b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(at[0], at[1], 11, 0, TAU); ctx.fill(); ctx.stroke();
      seatFace(ctx, p, at[0], at[1], angle, viewer);
      if (p && p.isLocal) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(at[0], at[1], 15, 0, TAU); ctx.stroke(); }
    });
    if (wreck) {
      ctx.fillStyle = 'rgba(18,24,23,0.45)'; ctx.beginPath(); ctx.ellipse(7, 0, 33, 25, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#222d27'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(56, -35); ctx.lineTo(40, -15); ctx.lineTo(61, 5); ctx.lineTo(48, 34); ctx.moveTo(-72, -23); ctx.lineTo(-55, -3); ctx.lineTo(-67, 26); ctx.stroke();
    }
    ctx.restore();
    this.drawVehicleInfo(ctx, world, car, viewer, access);
    this.drawVehicleEmotes(ctx, world, car, t, viewer);
  };

  Renderer.prototype.drawGroundArtillery = function (ctx, world, car, t, viewer, access) {
    var wreck = car.wreck, angle = car.angle + (car.oa || 0), body = wreck ? '#63665c' : '#a69565';
    ctx.save(); ctx.translate(car.x + (car.ox || 0), car.y + (car.oy || 0)); ctx.rotate(angle);
    ctx.fillStyle = 'rgba(9,17,14,.25)'; ctx.beginPath(); ctx.ellipse(4, 8, 106, 98, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = wreck ? '#76796c' : '#b5b19a'; ctx.strokeStyle = '#4d5745'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, 77, 0, TAU); ctx.fill(); ctx.stroke();
    // Four bolted outriggers distinguish this emplacement from the tracked SP.
    for (var i = 0; i < 4; i++) {
      ctx.save(); ctx.rotate(Math.PI / 4 + i * Math.PI / 2);
      ctx.fillStyle = wreck ? '#4a5145' : '#6e7a53'; roundRect(ctx, 39, -12, 60, 24, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#414c3c'; roundRect(ctx, 85, -19, 24, 38, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c3c8aa'; ctx.beginPath(); ctx.arc(97, 0, 4, 0, TAU); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = car.hitFlash > 0 && !wreck ? mix(body, '#fff8de', car.hitFlash * .6) : body;
    ctx.strokeStyle = '#3e4933'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 50, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.rotate((Number.isFinite(car.cannonAngle) ? car.cannonAngle : car.angle) - angle + (wreck ? .4 : 0));
    var recoil = (car.cannonFlash || 0) * 15;
    ctx.fillStyle = wreck ? '#737668' : '#c8be8d'; roundRect(ctx, 0 - recoil, -12, 148, 24, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4d5b3c'; roundRect(ctx, 134 - recoil, -17, 27, 34, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = body; roundRect(ctx, -42, -32, 77, 64, 8); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#d5c99a'; ctx.lineWidth = 3; ctx.strokeRect(-30, -19, 45, 38);
    if (!wreck && car.cannonFlash > .05) { ctx.fillStyle = '#ffe7a0'; ctx.beginPath(); ctx.moveTo(157 - recoil, -10); ctx.lineTo(190, -25); ctx.lineTo(180, 0); ctx.lineTo(190, 25); ctx.lineTo(157 - recoil, 10); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    var operator = world.playerById(car.seats.driver);
    if (!wreck && operator) {
      ctx.fillStyle = '#303e30'; ctx.beginPath(); ctx.arc(43, -24, 18, 0, TAU); ctx.fill();
      ctx.fillStyle = operator.color; ctx.strokeStyle = operator.outline; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(43, -24, 13, 0, TAU); ctx.fill(); ctx.stroke(); seatFace(ctx, operator, 43, -24, angle, viewer);
    }
    if (wreck) { ctx.strokeStyle = '#2d382c'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-45, -34); ctx.lineTo(-24, -8); ctx.lineTo(-47, 20); ctx.stroke(); }
    ctx.restore(); this.drawVehicleInfo(ctx, world, car, viewer, access); this.drawVehicleEmotes(ctx, world, car, t, viewer);
  };

  Renderer.prototype.drawArtillery = function (ctx, world, car, t, viewer, access) {
    if (car.fixed) { this.drawGroundArtillery(ctx, world, car, t, viewer, access); return; }
    var wreck = car.wreck, angle = car.angle + (car.oa || 0), body = wreck ? '#64665c' : '#968657';
    ctx.save(); ctx.translate(car.x + (car.ox || 0), car.y + (car.oy || 0)); ctx.rotate(angle);
    ctx.fillStyle = 'rgba(9,17,14,.3)'; roundRect(ctx, -109, -68, 222, 145, 14); ctx.fill();
    for (var side = -1; side <= 1; side += 2) {
      var ty = side * 57 - 14; ctx.fillStyle = wreck ? '#323a32' : '#344336'; ctx.strokeStyle = '#23342c'; ctx.lineWidth = 4;
      roundRect(ctx, -106, ty, 212, 28, 9); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#72816b'; ctx.lineWidth = 4;
      var travel = Math.hypot(car.vx || 0, car.vy || 0) > 3 ? (t * 45) % 15 : 0;
      for (var j = 0; j < 13; j++) { var tx = -96 + (j * 15 + travel) % 190; ctx.beginPath(); ctx.moveTo(tx, ty + 5); ctx.lineTo(tx, ty + 23); ctx.stroke(); }
    }
    ctx.fillStyle = car.hitFlash > 0 && !wreck ? mix(body, '#fff8de', car.hitFlash * .6) : body;
    ctx.strokeStyle = '#3e422e'; ctx.lineWidth = 5; roundRect(ctx, -100, -46, 198, 92, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = wreck ? '#434b41' : '#c0ad72'; roundRect(ctx, 43, -37, 46, 74, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#334737'; roundRect(ctx, 59, -30, 23, 20, 4); ctx.fill();
    ctx.strokeStyle = '#655d3e'; ctx.lineWidth = 4;
    for (var vent = 0; vent < 6; vent++) { ctx.beginPath(); ctx.moveTo(-87 + vent * 8, -32); ctx.lineTo(-87 + vent * 8, 32); ctx.stroke(); }
    ctx.save(); ctx.translate(-10, 0); ctx.rotate((Number.isFinite(car.cannonAngle) ? car.cannonAngle : car.angle) - angle + (wreck ? .35 : 0));
    var recoil = (car.cannonFlash || 0) * 15; ctx.fillStyle = wreck ? '#737668' : '#b9b48b'; ctx.strokeStyle = '#343d2e'; ctx.lineWidth = 5;
    roundRect(ctx, 0 - recoil, -12, 170, 24, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#515b3e'; roundRect(ctx, 154 - recoil, -17, 28, 34, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = body; roundRect(ctx, -45, -36, 88, 72, 9); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#d3c793'; ctx.lineWidth = 3; ctx.strokeRect(-30, -23, 48, 46);
    if (!wreck && car.cannonFlash > .05) { ctx.fillStyle = '#ffe7a0'; ctx.beginPath(); ctx.moveTo(177 - recoil, -9); ctx.lineTo(210, -25); ctx.lineTo(199, 0); ctx.lineTo(210, 25); ctx.lineTo(177 - recoil, 9); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    var driver = world.playerById(car.seats.driver);
    if (!wreck && driver) { ctx.fillStyle = driver.color; ctx.strokeStyle = driver.outline; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(57, 20, 13, 0, TAU); ctx.fill(); ctx.stroke(); seatFace(ctx, driver, 57, 20, angle, viewer); }
    if (wreck) { ctx.strokeStyle = '#2e392f'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-80, -32); ctx.lineTo(-57, -8); ctx.lineTo(-73, 23); ctx.moveTo(35, -25); ctx.lineTo(20, 4); ctx.lineTo(42, 28); ctx.stroke(); }
    ctx.restore(); this.drawVehicleInfo(ctx, world, car, viewer, access); this.drawVehicleEmotes(ctx, world, car, t, viewer);
  };

  Renderer.prototype.drawVehicle = function (ctx, world, car, t, viewer, access) {
    if (car.type === 'artillery') { this.drawArtillery(ctx, world, car, t, viewer, access); return; }
    if (car.type === 'tank') { this.drawTank(ctx, world, car, t, viewer, access); return; }
    var x = car.x + (car.ox || 0), y = car.y + (car.oy || 0), angle = car.angle + (car.oa || 0), wreck = car.wreck;
    var mine = viewer && viewer.vehicle === car.id, r = car.r || 80, flash = car.flash || 0;
    var edge = wreck ? '#24282c' : '#28352b', body = wreck ? '#4e5151' : '#778754';
    if (!wreck && car.hitFlash > 0) body = mix(body, '#ffffff', Math.min(1, car.hitFlash) * 0.65);
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = 'rgba(9,17,14,0.26)';
    roundRect(ctx, -68, -39, 140, 88, 12); ctx.fill();
    for (var side = -1; side <= 1; side += 2) {
      for (var axle = -1; axle <= 1; axle += 2) {
        var wheelX = axle > 0 ? 31 : -53, wheelY = side * 42 - 8;
        ctx.fillStyle = '#252b2e'; ctx.strokeStyle = '#151c22'; ctx.lineWidth = 3;
        roundRect(ctx, wheelX, wheelY, 29, 16, 5); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = wreck ? '#414649' : '#647078'; ctx.lineWidth = 2;
        for (var tread = 0; tread < 4; tread++) {
          var at = wheelX + 5 + tread * 6;
          ctx.beginPath(); ctx.moveTo(at, wheelY + 4); ctx.lineTo(at, wheelY + 12); ctx.stroke();
        }
      }
    }
    ctx.fillStyle = body; ctx.strokeStyle = edge; ctx.lineWidth = 5;
    roundRect(ctx, -66, -39, 132, 78, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = wreck ? '#666660' : '#a3ad76';
    roundRect(ctx, 30, -32, 30, 64, 5); ctx.fill();
    ctx.strokeStyle = wreck ? '#363b39' : '#657345'; ctx.lineWidth = 3;
    for (var rib = 0; rib < 3; rib++) {
      ctx.beginPath(); ctx.moveTo(38 + rib * 7, -19); ctx.lineTo(38 + rib * 7, 19); ctx.stroke();
    }
    ctx.fillStyle = wreck ? '#292f32' : '#8ebdc3'; ctx.strokeStyle = edge; ctx.lineWidth = 3;
    roundRect(ctx, 10, -31, 20, 62, 4); ctx.fill(); ctx.stroke();
    if (!wreck) { ctx.fillStyle = 'rgba(220,249,249,0.45)'; ctx.fillRect(13, -26, 5, 50); }
    ctx.fillStyle = wreck ? '#3c413e' : '#5d714c';
    roundRect(ctx, -25, -31, 34, 62, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = wreck ? '#55564e' : '#89986a';
    roundRect(ctx, -60, -31, 29, 62, 4); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = wreck ? '#363b36' : '#b1ba88'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-56, -22); ctx.lineTo(-35, -22); ctx.moveTo(-56, 22); ctx.lineTo(-35, 22); ctx.stroke();
    // Bumpers, lights and door handles keep the front and access sides readable.
    ctx.fillStyle = '#465254'; ctx.strokeStyle = edge; ctx.lineWidth = 3;
    roundRect(ctx, 65, -32, 7, 64, 3); ctx.fill(); ctx.stroke();
    roundRect(ctx, -73, -32, 7, 64, 3); ctx.fill(); ctx.stroke();
    for (var side = -1; side <= 1; side += 2) {
      ctx.fillStyle = wreck ? '#787365' : '#fff0af'; ctx.fillRect(61, side * 24 - 6, 5, 12);
      ctx.fillStyle = wreck ? '#573f39' : '#d66b55'; ctx.fillRect(-66, side * 26 - 4, 4, 8);
      ctx.strokeStyle = '#d3d9bb'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-16, side * 36); ctx.lineTo(-7, side * 36); ctx.moveTo(-48, side * 36); ctx.lineTo(-39, side * 36); ctx.stroke();
    }
    var seats = car.seats || {}, seatOffsets = { driver: [20, -20], rearLeft: [-35, -24], rearRight: [-35, 24] };
    Object.keys(seatOffsets).forEach(function (seat) {
      if (wreck || !seats[seat]) return;
      var p = world.playerById(seats[seat]), at = seatOffsets[seat];
      ctx.beginPath(); ctx.arc(at[0], at[1], 11, 0, TAU);
      ctx.fillStyle = p ? p.color : '#b4bec9'; ctx.fill(); ctx.strokeStyle = p ? p.outline : '#35434b'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(at[0] - 3, at[1] - 3, 4, 0, TAU); ctx.fill();
      seatFace(ctx, p, at[0], at[1], angle, viewer);
      if (p && p.isLocal) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(at[0], at[1], 14, 0, TAU); ctx.stroke(); }
    });
    if (car.armed) {
      ctx.fillStyle = wreck ? '#33383b' : '#4c5b56'; ctx.strokeStyle = '#263136'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.rotate((Number.isFinite(car.gunAngle) ? car.gunAngle : car.angle) - angle + (wreck ? 0.48 : 0));
      ctx.fillStyle = wreck ? '#5b6061' : '#a0b0bb';
      roundRect(ctx, 6 - flash * 3, -6, 56, 12, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#43515a'; ctx.fillRect(46 - flash * 3, -8, 11, 16);
      roundRect(ctx, -12, -13, 27, 26, 5); ctx.fill(); ctx.stroke();
      if (!wreck && seats.gunner) {
        var gunner = world.playerById(seats.gunner);
        ctx.fillStyle = gunner ? gunner.color : '#b4bec9'; ctx.strokeStyle = gunner ? gunner.outline : '#35434b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(-8, 0, 11, 0, TAU); ctx.fill(); ctx.stroke();
        seatFace(ctx, gunner, -8, 0, Number.isFinite(car.gunAngle) ? car.gunAngle : car.angle, viewer);
        if (gunner && gunner.isLocal) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-8, 0, 14, 0, TAU); ctx.stroke(); }
      }
      if (!wreck && flash > 0.05) {
        ctx.fillStyle = '#ffe487'; ctx.beginPath(); ctx.moveTo(61, -6); ctx.lineTo(75 + flash * 9, -11); ctx.lineTo(69, 0); ctx.lineTo(75 + flash * 9, 11); ctx.lineTo(61, 6); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    if (wreck) {
      ctx.strokeStyle = '#20282a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(35, -26); ctx.lineTo(46, -7); ctx.lineTo(31, 10); ctx.lineTo(43, 29); ctx.moveTo(-51, -23); ctx.lineTo(-35, 3); ctx.lineTo(-53, 20); ctx.stroke();
      ctx.fillStyle = 'rgba(24,29,30,0.3)'; ctx.beginPath(); ctx.arc(37, 0, 20, 0, TAU); ctx.fill();
    }
    ctx.restore();
    this.drawVehicleInfo(ctx, world, car, viewer, access);
    this.drawVehicleEmotes(ctx, world, car, t, viewer);
  };

  Renderer.prototype.drawVehicleInfo = function (ctx, world, car, viewer, access) {
    var x = car.x + (car.ox || 0), y = car.y + (car.oy || 0), wreck = car.wreck, r = car.r || 80;
    var mine = viewer && viewer.vehicle === car.id, tank = car.type === 'tank';
    if (access && access.vehicle.id === car.id && !wreck) {
      ctx.strokeStyle = '#7fe9ff'; ctx.fillStyle = 'rgba(12,30,39,0.7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(access.x + (car.ox || 0), access.y + (car.oy || 0), 17, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.font = '16px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff';
      ctx.fillText(car.fixed ? 'A' : access.seat === 'driver' ? 'D' : access.seat === 'gunner' ? 'G' : tank && access.seat === 'rearLeft' ? 'C' : 'R', access.x + (car.ox || 0), access.y + (car.oy || 0));
    }
    var nearby = viewer && Math.hypot(viewer.x - car.x, viewer.y - car.y) < 300;
    if (mine || nearby || (!wreck && car.hp < car.maxHp)) {
      var ratio = U.clamp(car.hp / car.maxHp, 0, 1), by = y - r - 16;
      if (!wreck) {
        ctx.fillStyle = '#263136'; roundRect(ctx, x - 54, by, 108, 12, 6); ctx.fill();
        ctx.fillStyle = ratio > 0.5 ? '#a9d878' : ratio > 0.25 ? '#ffd23f' : '#ff715e';
        roundRect(ctx, x - 51, by + 3, Math.max(2, 102 * ratio), 6, 3); ctx.fill();
      }
      ctx.font = '14px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,25,27,0.85)';
      var label = wreck ? (car.type === 'artillery' ? 'ARTILLERY WRECK' : tank ? 'TANK WRECK' : 'WRECK') : car.type === 'artillery' ? (car.fixed ? 'Artillery Cannon' : 'SP Artillery') : tank ? 'Tank' : car.armed ? 'Humvee · Turret I' : 'Humvee';
      ctx.strokeText(label, x, y + r + 19); ctx.fillStyle = wreck ? '#9ba2a3' : mine ? '#8ee4f0' : '#eff5d5'; ctx.fillText(label, x, y + r + 19);
    }
  };

  Renderer.prototype.drawVehicles = function (ctx, world, view, t, viewer) {
    var cars = world.vehicles || [], access = viewer && !viewer.vehicle && world.nearestVehicleSeat ? world.nearestVehicleSeat(viewer) : null;
    for (var i = 0; i < cars.length; i++) {
      var car = cars[i];
      if (!car.hidden && visible(view, car.x + (car.ox || 0), car.y + (car.oy || 0), (car.r || 80) + 90)) {
        this.drawVehicle(ctx, world, car, t, viewer, access);
        var burning = world.pyroBurnTime ? world.pyroBurnTime(car) > 0 : car.pyroBurning > 0;
        if (burning && !car.wreck && !W.vehicleHasTankArmor(car)) {
          ctx.save(); ctx.translate(car.x + (car.ox || 0), car.y + (car.oy || 0)); ctx.rotate(car.angle + (car.oa || 0));
          ctx.strokeStyle = '#ff964c'; ctx.lineWidth = 4; ctx.setLineDash([7, 5]); ctx.lineDashOffset = -t * 20;
          ctx.beginPath(); ctx.ellipse(0, 0, 77, 53, 0, 0, TAU); ctx.stroke(); ctx.restore();
        }
      }
    }
  };

  Renderer.prototype.drawStructures = function (ctx, world, v, t, viewer) {
    var list = world.structures;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var it = W.ITEMS[s.item], tier = it ? W.TIERS[it.tier] : W.TIERS.epic, mine = !!viewer && s.team === viewer.team;
      var iv = it && W.SENTRY_IV && W.SENTRY_IV[it.sentryVariant], visualScale = iv && iv.visualScale || 1;
      if (!s.alive || !visible(v, s.x, s.y, (s.r + 40) * visualScale)) continue;
      var shake = s.shake > 0 ? Math.sin(t * 90) * s.shake * 2 : 0;
      ctx.save();
      ctx.translate(s.x + shake, s.y);
      if (s.kind === 'rock') {
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(5, 7, s.r, 0, TAU); ctx.fill();
        this.blobPath(ctx, s.r, s.id);
        ctx.fillStyle = mine ? '#477eb9' : '#b95a5d'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = mine ? '#264e80' : '#813c43'; ctx.stroke();
        ctx.save(); ctx.translate(-s.r * 0.14, -s.r * 0.16); ctx.scale(0.6, 0.6); this.blobPath(ctx, s.r, s.id); ctx.fillStyle = mine ? '#76aae0' : '#e38a89'; ctx.fill(); ctx.restore();
      } else if (s.kind === 'teleporter') {
        var linked = !!s.pair, pulse = 0.5 + 0.5 * Math.sin(t * 4 + s.id);
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.arc(3, 4, s.r, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(0, 0, s.r, 0, TAU); ctx.fillStyle = '#1f2a44'; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = linked ? '#7fe9ff' : '#5b6982'; ctx.stroke();
        ctx.lineWidth = 3; ctx.strokeStyle = linked ? 'rgba(127,233,255,' + (0.4 + 0.5 * pulse).toFixed(2) + ')' : 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(0, 0, s.r * (0.45 + 0.25 * pulse), 0, TAU); ctx.stroke();
        ctx.setLineDash([8, 8]); ctx.lineDashOffset = -t * 40;
        ctx.beginPath(); ctx.arc(0, 0, s.r - 7, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        if (!linked) { ctx.fillStyle = '#ffd23f'; ctx.font = '16px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', 0, 0); }
        if (viewer && viewer.tpProgress > 0 && world.padAt(viewer.x, viewer.y) === s) {
          ctx.strokeStyle = '#7fe9ff'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(0, 0, s.r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * viewer.tpProgress); ctx.stroke();
        }
      } else {
        this.drawEmplacement(ctx, s, tier, mine);
      }
      ctx.restore();
      if (s.kind === 'rock') this.drawRockHealth(ctx, s);
      if (s.kind !== 'rock' && s.maxHp && s.hp < s.maxHp) {
        var bw = s.r * 2.4 * visualScale, k = s.hp / s.maxHp, barY = s.y - (s.r + 18) * visualScale;
        ctx.fillStyle = 'rgba(20,24,30,0.75)'; roundRect(ctx, s.x - bw / 2 - 2, barY, bw + 4, 9, 4); ctx.fill();
        ctx.fillStyle = k > 0.5 ? '#7ee05c' : k > 0.25 ? '#ffd23f' : '#ff5a4f'; roundRect(ctx, s.x - bw / 2, barY + 2, Math.max(2, bw * k), 5, 2.5); ctx.fill();
      }
      if (it && s.kind !== 'rock' && s.kind !== 'teleporter') {
        ctx.font = '13px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,22,30,0.8)'; ctx.strokeText(it.name, s.x, s.y + (s.r + 24) * visualScale);
        ctx.fillStyle = mine ? '#8cff6a' : '#ffb3ad'; ctx.fillText(it.name, s.x, s.y + (s.r + 24) * visualScale);
      }
    }
  };

  // Fire and snow lie on the ground (over = false); smoke is drawn over everything.
  Renderer.prototype.drawZones = function (ctx, world, v, t, over, viewer) {
    var zs = world.zones, i, f;
    for (i = 0; i < zs.length; i++) {
      var z = zs[i];
      if ((z.kind === 'smoke') !== over || !visible(v, z.x, z.y, z.r + 60)) continue;
      var k = Math.min(1, z.age / 0.5) * Math.min(1, z.t / 0.8);
      if (z.kind === 'fire') {
        var flick = 0.85 + 0.15 * Math.sin(t * 23 + z.id);
        var grad = ctx.createRadialGradient(z.x, z.y, z.r * 0.2, z.x, z.y, z.r);
        grad.addColorStop(0, 'rgba(255,120,30,' + (0.55 * k).toFixed(2) + ')');
        grad.addColorStop(0.7, 'rgba(255,80,20,' + (0.45 * k * flick).toFixed(2) + ')');
        grad.addColorStop(1, 'rgba(255,60,10,' + (0.15 * k).toFixed(2) + ')');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,170,60,' + (0.8 * k).toFixed(2) + ')'; ctx.lineWidth = 6; ctx.setLineDash([18, 12]); ctx.lineDashOffset = -t * 60;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      } else if (z.kind === 'snow') {
        ctx.fillStyle = 'rgba(200,236,255,' + (0.38 * k).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * k).toFixed(2) + ')'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,' + (0.7 * k).toFixed(2) + ')';
        for (f = 0; f < 40; f++) {
          var fx = Math.cos(f * 2.399 + t * 0.3) * ((f * 37) % 100) / 100 * z.r, fy = ((t * 60 + f * 53) % (z.r * 2)) - z.r;
          if (fx * fx + fy * fy > z.r * z.r) continue;
          ctx.beginPath(); ctx.arc(z.x + fx, z.y + fy, 3, 0, TAU); ctx.fill();
        }
      } else {
        // Smoke: thick blobs nobody sees through (a little thinner for someone standing inside it).
        var inside = viewer && viewer.alive && Math.hypot(viewer.x - z.x, viewer.y - z.y) < z.r, a = (inside ? 0.6 : 0.94) * k;
        ctx.fillStyle = 'rgba(150,156,166,' + a.toFixed(2) + ')';
        for (f = 0; f < 7; f++) {
          var ba = f * 0.9 + t * 0.15, bd = f ? z.r * 0.42 : 0, br = f ? z.r * 0.6 : z.r * 0.72;
          ctx.beginPath(); ctx.arc(z.x + Math.cos(ba) * bd, z.y + Math.sin(ba) * bd, br, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = 'rgba(200,204,212,' + (0.5 * k).toFixed(2) + ')';
        for (f = 0; f < 5; f++) {
          var ca = f * 1.3 - t * 0.1;
          ctx.beginPath(); ctx.arc(z.x + Math.cos(ca) * z.r * 0.3, z.y + Math.sin(ca) * z.r * 0.3, z.r * 0.35, 0, TAU); ctx.fill();
        }
      }
    }
  };

  Renderer.prototype.drawStrikes = function (ctx, world, v, t) {
    for (var i = 0; i < world.strikes.length; i++) {
      var st = world.strikes[i];
      if (st.kind === 'airstrike') { this.drawAirstrike(ctx, st, v); continue; }
      if (!visible(v, st.x, st.y, Math.max(400, st.radius || 0))) continue;
      var k = 1 - U.clamp(st.t / (st.dur || 1), 0, 1); // 0 when called, 1 when it lands
      if (st.kind === 'lightning') {
        var R = 40 + 20 * Math.sin(t * 12);
        ctx.strokeStyle = 'rgba(255,246,168,' + (0.5 + 0.5 * k).toFixed(2) + ')'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(st.x, st.y, R, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(st.x - R - 10, st.y); ctx.lineTo(st.x + R + 10, st.y); ctx.moveTo(st.x, st.y - R - 10); ctx.lineTo(st.x, st.y + R + 10); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(120,20,0,' + (0.15 + 0.3 * k).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(st.x, st.y, st.radius * (0.5 + 0.5 * k), 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,120,60,0.9)'; ctx.lineWidth = 5; ctx.setLineDash([16, 12]); ctx.lineDashOffset = -t * 80;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.radius, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        if (k > 0.6) {
          // The meteor itself, falling in from the top right.
          var f = (k - 0.6) / 0.4, mx = st.x + (1 - f) * 900, my = st.y - (1 - f) * 1400, mr = 40 + 30 * f;
          ctx.strokeStyle = 'rgba(255,200,120,0.6)'; ctx.lineWidth = mr * 0.6; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + 220, my - 340); ctx.stroke();
          ctx.fillStyle = '#ff8a3c'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
          ctx.fillStyle = '#5a2a10'; ctx.beginPath(); ctx.arc(mx - mr * 0.2, my - mr * 0.2, mr * 0.7, 0, TAU); ctx.fill();
        }
      }
    }
  };

  // The flyover and falling bomb are purely visual. The server's strike-hit event
  // still decides when the explosion appears, including after a delayed packet.
  Renderer.prototype.drawAirstrike = function (ctx, st, v) {
    var remaining = Math.max(0, st.t), radius = st.radius || 450;
    if (visible(v, st.x, st.y, radius + 20)) {
      ctx.fillStyle = 'rgba(255,45,45,0.15)'; ctx.beginPath(); ctx.arc(st.x, st.y, radius, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ff5959'; ctx.lineWidth = 6; ctx.setLineDash([22, 14]); ctx.beginPath(); ctx.arc(st.x, st.y, radius, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff0dc'; ctx.strokeStyle = '#852323'; ctx.lineWidth = 7;
      ctx.font = 'bold 190px ' + FONT; ctx.strokeText('!', st.x, st.y - 25); ctx.fillText('!', st.x, st.y - 25);
      ctx.font = 'bold 30px ' + FONT; ctx.fillText('AIRSTRIKE · ' + Math.ceil(remaining) + 's', st.x, st.y + 110);
    }
    if (remaining > 2.8) return;
    var planeX = st.x + (1.1 - st.t) * 900, planeY = st.y - 370;
    if (visible(v, planeX, planeY, 320)) this.drawStrikeAircraft(ctx, planeX, planeY);
    if (remaining <= 1.1) {
      var fall = U.clamp(1 - remaining / 1.1, 0, 1), bombY = st.y - 370 * (1 - fall * fall);
      if (visible(v, st.x, bombY, 90)) this.drawStrikeBomb(ctx, st.x, bombY, 0.55 + 0.45 * fall);
    }
  };

  Renderer.prototype.drawStrikeAircraft = function (ctx, x, y) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(242,250,255,0.35)'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(-290, -45); ctx.lineTo(-75, -45); ctx.moveTo(-290, 45); ctx.lineTo(-75, 45); ctx.stroke();
    ctx.fillStyle = '#718d87'; ctx.strokeStyle = '#243b3c'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(135, 0); ctx.lineTo(72, -18); ctx.lineTo(16, -21);
    ctx.lineTo(-18, -102); ctx.lineTo(-51, -102); ctx.lineTo(-36, -18); ctx.lineTo(-89, -15);
    ctx.lineTo(-111, -52); ctx.lineTo(-132, -52); ctx.lineTo(-117, 0); ctx.lineTo(-132, 52);
    ctx.lineTo(-111, 52); ctx.lineTo(-89, 15); ctx.lineTo(-36, 18); ctx.lineTo(-51, 102);
    ctx.lineTo(-18, 102); ctx.lineTo(16, 21); ctx.lineTo(72, 18); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#b9c9be'; ctx.beginPath(); ctx.moveTo(127, 0); ctx.lineTo(52, -12); ctx.lineTo(-86, -8); ctx.lineTo(-86, 8); ctx.lineTo(52, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#64cbeb'; ctx.strokeStyle = '#243b3c'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(57, 0, 27, 11, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f5cd55'; ctx.fillRect(-36, -85, 22, 9); ctx.fillRect(-36, 76, 22, 9);
    ctx.restore();
  };

  Renderer.prototype.drawStrikeBomb = function (ctx, x, y, scale) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.strokeStyle = 'rgba(255,239,190,0.65)'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(0, -105); ctx.lineTo(0, -40); ctx.stroke();
    ctx.fillStyle = '#586c66'; ctx.strokeStyle = '#1d3034'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-22, -16); ctx.lineTo(-31, -46); ctx.lineTo(-8, -32);
    ctx.lineTo(8, -32); ctx.lineTo(31, -46); ctx.lineTo(22, -16); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 2, 20, 37, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f5cd55'; ctx.fillRect(-17, 8, 34, 10);
    ctx.strokeStyle = '#d4e0d3'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-8, -16); ctx.lineTo(-8, 1); ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.drawAirstrikeImpact = function (ctx, e, k) {
    var grow = U.easeOut(Math.min(1, k * 3)), fade = 1 - k, spread = e.r * 0.48 * grow;
    ctx.save(); ctx.globalAlpha = fade * 0.85;
    for (var i = 0; i < 7; i++) {
      var a = i / 7 * TAU, x = e.x + Math.cos(a) * spread, y = e.y + Math.sin(a) * spread * 0.65 - k * 85;
      var r = e.r * (0.13 + 0.12 * k) * (0.65 + 0.35 * grow);
      ctx.fillStyle = k < 0.3 ? '#e46b2e' : '#5e6066'; ctx.strokeStyle = k < 0.3 ? '#9a3e29' : '#434951'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
      if (k < 0.65) {
        ctx.globalAlpha = fade * (1 - k / 0.65);
        ctx.fillStyle = '#ffb54a'; ctx.beginPath(); ctx.arc(x - r * 0.12, y - r * 0.18, r * 0.65, 0, TAU); ctx.fill();
        ctx.globalAlpha = fade * 0.85;
      }
    }
    ctx.globalAlpha = Math.max(0, 1 - k * 2.2); ctx.fillStyle = '#fff1ac';
    ctx.beginPath(); ctx.arc(e.x, e.y - k * 60, e.r * 0.28 * (0.7 + grow * 0.3), 0, TAU); ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawTrajectory = function (ctx, world, solution) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(solution.startX, solution.startY); ctx.lineTo(solution.targetX, solution.targetY); ctx.stroke();
    ctx.setLineDash([]); ctx.strokeStyle = '#ffe17c'; ctx.lineWidth = 4; ctx.beginPath();
    for (var i = 0; i <= 32; i++) { var pt = world.trajectoryPoint(solution, i / 32); if (!i) ctx.moveTo(pt.x, pt.y - pt.z); else ctx.lineTo(pt.x, pt.y - pt.z); }
    ctx.stroke(); ctx.fillStyle = 'rgba(255,218,90,0.12)'; ctx.strokeStyle = '#ffe17c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(solution.targetX, solution.targetY, solution.radius || 28, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(solution.targetX, solution.targetY, 8, 0, TAU); ctx.fillStyle = '#fff4bd'; ctx.fill(); ctx.restore();
  };

  // Drone and radar: enemies the viewer can see on the map get an arrow at the screen edge (or a ring on screen).
  Renderer.prototype.drawReveal = function (ctx, world, cam, viewer) {
    var list = world.revealedEnemies(viewer);
    if (!list.length) return;
    var dpr = this.dpr, w = this.w, h = this.h, m = 46;
    ctx.save();
    ctx.scale(dpr, dpr);
    for (var i = 0; i < list.length; i++) {
      var o = list[i], s = this.worldToScreen(cam, o.x, o.y), on = s.x > 0 && s.x < w && s.y > 0 && s.y < h;
      ctx.save();
      ctx.translate(U.clamp(s.x, m, w - m), U.clamp(s.y, m, h - m));
      if (on) ctx.translate(0, -40);
      ctx.rotate(on ? o.angle || 0 : Math.atan2(s.y - h / 2, s.x - w / 2));
      ctx.fillStyle = '#ff454f'; ctx.strokeStyle = '#1d2433'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -12); ctx.lineTo(-4, 0); ctx.lineTo(-10, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  // ---------------------------------------------------------------- projectiles & effects
  Renderer.prototype.drawBullets = function (ctx, world, v) {
    var bs = world.bullets;
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (!visible(v, b.x, b.y, 80)) continue;
      if (b.weapon === 'firegun') {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.dy, b.dx));
        var flameTail = Math.min(Math.max(0, b.traveled || 0), 42);
        ctx.strokeStyle = 'rgba(255,132,55,.45)'; ctx.lineWidth = b.r * 1.6;
        ctx.beginPath(); ctx.moveTo(-flameTail, 0); ctx.lineTo(0, 0); ctx.stroke();
        ctx.fillStyle = '#ff7839'; ctx.strokeStyle = '#cf4c28'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-b.r * 2.4, 0); ctx.quadraticCurveTo(b.r, -b.r * 1.65, b.r, 0); ctx.quadraticCurveTo(b.r, b.r * 1.65, -b.r * 2.4, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff0b6'; ctx.beginPath(); ctx.arc(0, 0, b.r * .56, 0, TAU); ctx.fill(); ctx.restore();
        continue;
      }
      var tail = Math.min(b.traveled - 20, b.speed * 0.03 + 8);
      if (tail > 0) {
        ctx.strokeStyle = rgba(b.color, 0.42);
        ctx.lineWidth = b.r * 1.4;
        ctx.beginPath(); ctx.moveTo(b.x - b.dx * tail, b.y - b.dy * tail); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fillStyle = b.color; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = b.outline; ctx.stroke();
    }
  };

  Renderer.prototype.drawRpgRockets = function (ctx, world, view) {
    (world.rpgRockets || []).forEach(function (rocket) {
      if (!visible(view, rocket.x, rocket.y, 90)) return;
      var r = rocket.r || W.WEAPONS.rpg.projectileRadius, tail = Math.min(90, rocket.traveled || 0);
      ctx.save(); ctx.translate(rocket.x, rocket.y); ctx.rotate(Math.atan2(rocket.dy, rocket.dx));
      ctx.strokeStyle = 'rgba(255,190,95,.55)'; ctx.lineWidth = r * .8;
      if (tail > 0) { ctx.beginPath(); ctx.moveTo(-tail, 0); ctx.lineTo(-r, 0); ctx.stroke(); }
      ctx.fillStyle = '#b8c47c'; ctx.strokeStyle = '#35462f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(r * 1.6, 0); ctx.lineTo(r * .35, -r * .65); ctx.lineTo(-r * 1.3, -r * .65); ctx.lineTo(-r * 1.3, r * .65); ctx.lineTo(r * .35, r * .65); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff983d'; ctx.beginPath(); ctx.moveTo(-r * 1.3, -r * .45); ctx.lineTo(-r * 2.7, 0); ctx.lineTo(-r * 1.3, r * .45); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e4ecc0'; ctx.fillRect(-r * .2, -r * .53, r * .25, r * 1.06); ctx.restore();
    });
  };

  Renderer.prototype.drawTankShells = function (ctx, world, view) {
    (world.artilleryShells || []).forEach(function (shell) {
      var k = U.clamp(shell.elapsed / shell.flightTime, 0, 1), z = Math.sin(k * Math.PI) * 180;
      if (!visible(view, shell.x, shell.y, z + 90)) return;
      var angle = Math.atan2(shell.targetY - shell.startY, shell.targetX - shell.startX);
      ctx.fillStyle = 'rgba(20,25,22,.24)'; ctx.beginPath(); ctx.ellipse(shell.x, shell.y, 14, 7, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(shell.x, shell.y - z); ctx.rotate(angle);
      ctx.strokeStyle = 'rgba(255,222,147,.75)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-55, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.fillStyle = '#e0bd70'; ctx.strokeStyle = '#4b5135'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 17, 9, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff4ce'; ctx.fillRect(5, -5, 6, 10); ctx.restore();
    });
    (world.tankShells || []).forEach(function (shell) {
      if (!visible(view, shell.x, shell.y, 90)) return;
      var tail = Math.min(74, shell.traveled || 0), dx = shell.dx, dy = shell.dy;
      ctx.strokeStyle = 'rgba(255,224,139,0.7)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(shell.x - dx * tail, shell.y - dy * tail); ctx.lineTo(shell.x, shell.y); ctx.stroke();
      ctx.save(); ctx.translate(shell.x, shell.y); ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = '#c9b66c'; ctx.strokeStyle = '#4b5535'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 5.5, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff2bf'; ctx.fillRect(4, -3, 4, 6);
      ctx.restore();
    });
  };

  Renderer.prototype.drawSentryProjectiles = function (ctx, world, view, airborne) {
    var list = world.sentryProjectiles || [];
    for (var i = 0; i < list.length; i++) {
      var g = list[i], def = W.SENTRY_IV && W.SENTRY_IV[g.kind], z = g.z || 0;
      if (!def || airborne !== (z > 1)) continue;
      var visualRadius = def.visualRadius || g.r;
      var tailLimit = g.kind === 'cannons' ? Math.max(75, visualRadius * 3) : g.kind === 'fireballs' ? 30 : 40;
      if (!visible(view, g.x, g.y, z + Math.max(70, tailLimit + visualRadius))) continue;
      ctx.save();
      if (g.kind === 'grenades') {
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(g.x, g.y + 3, g.r, g.r * .7, 0, 0, TAU); ctx.fill();
      }
      ctx.translate(g.x, g.y - z); ctx.rotate(Math.atan2(g.dy, g.dx));
      var tail = Math.min(g.traveled || 0, tailLimit);
      if (tail > 0) {
        ctx.strokeStyle = rgba(def.color, .5); ctx.lineWidth = visualRadius * (g.kind === 'fireballs' ? 1.7 : .8);
        ctx.beginPath(); ctx.moveTo(-tail, 0); ctx.lineTo(0, 0); ctx.stroke();
      }
      ctx.fillStyle = def.color; ctx.strokeStyle = g.kind === 'snowballs' ? '#5d9ebb' : '#303a37'; ctx.lineWidth = 2;
      if (g.kind === 'rockets') {
        ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(1, -5); ctx.lineTo(-10, -5); ctx.lineTo(-10, 5); ctx.lineTo(1, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff6f32'; ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-22, 0); ctx.lineTo(-10, 4); ctx.fill();
      } else if (g.kind === 'fireballs') {
        ctx.beginPath(); ctx.moveTo(-g.r * 2.5, 0); ctx.quadraticCurveTo(g.r, -g.r * 1.6, g.r, 0); ctx.quadraticCurveTo(g.r, g.r * 1.6, -g.r * 2.5, 0); ctx.fill();
        ctx.fillStyle = '#ffeaa5'; ctx.beginPath(); ctx.arc(0, 0, g.r * .55, 0, TAU); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, visualRadius, 0, TAU); ctx.fill(); ctx.stroke();
        if (g.kind === 'grenades') {
          ctx.rotate(g.age * 8); ctx.fillStyle = '#57723a'; ctx.fillRect(-3, -g.r - 4, 6, 6);
          ctx.strokeStyle = '#e6edc4'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-4, -g.r + 1); ctx.lineTo(5, -g.r + 1); ctx.stroke();
        } else {
          ctx.fillStyle = '#fff7df'; ctx.beginPath(); ctx.arc(-visualRadius * .25, -visualRadius * .25, visualRadius * .3, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }
  };

  Renderer.prototype.drawSentryStatus = function (ctx, world, p, viewer) {
    if (!p.alive || p.hidden || p.vehicle || p.dropT > 0 || (p.fx.invisible > 0 && viewer && viewer !== p && viewer.team !== p.team)) return;
    var frozen = p.sentryFreezeUntil > world.time, slow = world.activeSentrySnow && world.activeSentrySnow(p);
    var burning = (p.sentryBurn && p.sentryBurn.until > world.time) || (world.pyroBurnTime ? world.pyroBurnTime(p) > 0 : p.pyroBurning > 0);
    if (!frozen && !slow && !burning) return;
    ctx.save(); ctx.translate(p.x + (p.ox || 0), p.y + (p.oy || 0));
    if (frozen || slow) {
      ctx.strokeStyle = frozen ? '#d5f9ff' : '#80d7f2'; ctx.lineWidth = frozen ? 4 : 2; ctx.fillStyle = 'rgba(155,225,255,.2)';
      ctx.beginPath();
      for (var i = 0; i < 6; i++) { var a = i * TAU / 6, x = Math.cos(a) * (p.r + 7), y = Math.sin(a) * (p.r + 7); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath(); if (frozen) ctx.fill(); ctx.stroke();
    }
    if (burning) {
      ctx.strokeStyle = '#ff964c'; ctx.lineWidth = 3; ctx.setLineDash([5, 6]); ctx.lineDashOffset = -world.time * 20;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 4, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype.drawGrenades = function (ctx, world, v, t, airborne) {
    for (var i = 0; i < world.grenades.length; i++) {
      var g = world.grenades[i];
      if (typeof airborne === 'boolean' && airborne !== ((g.z || 0) > 1)) continue;
      if (!visible(v, g.x, g.y, 170)) continue;
      if (g.kind === 'hand') {
        // Only explosive grenades have a blast radius. Special throwables (fire,
        // smoke, poison, etc.) have a zone instead; reading their null explosion
        // used to abort the frame here, hiding players and the rest of the map.
        if (g.fuse < 1 && !g.instant && g.explosion) {
          var k = 1 - g.fuse;
          ctx.fillStyle = 'rgba(255,70,50,' + (k * 0.1).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(g.x, g.y, g.explosion.radius, 0, TAU); ctx.fill();
          ctx.strokeStyle = 'rgba(255,70,50,' + (0.2 + k * 0.4).toFixed(2) + ')';
          ctx.lineWidth = 3;
          ctx.setLineDash([12, 10]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        var z = g.z || 0, s = 1 + z / 450;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(g.x, g.y + 3, g.r * 1.1, g.r * 0.8, 0, 0, TAU); ctx.fill();
        ctx.save();
        ctx.translate(g.x, g.y - z);
        ctx.scale(s, s);
        var rate = g.fuse < 0.6 ? 16 : 7, blink = Math.sin(t * rate * Math.PI) > 0;
        if (g.shell) {
          // A landed launcher shell: lies flat and blinks through its short fuse.
          ctx.beginPath(); ctx.ellipse(0, 0, 12, 7.5, 0, 0, TAU);
          ctx.fillStyle = '#6f7f3c'; ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = '#3b451f'; ctx.stroke();
          ctx.fillStyle = blink ? '#ff3b3b' : '#d8c25a'; ctx.fillRect(3, -6, 3, 12);
        } else {
          ctx.rotate(g.spin);
          var art = g.item && W.Icons && W.Icons.itemImage(g.item), size = g.r * 2.9;
          if (art) ctx.drawImage(art, -size / 2, -size / 2, size, size);
          else {
            ctx.beginPath(); ctx.arc(0, 0, g.r, 0, TAU);
            ctx.fillStyle = '#56733f'; ctx.fill();
            ctx.lineWidth = 3; ctx.strokeStyle = '#2c3f20'; ctx.stroke();
            ctx.fillStyle = '#8b939c'; ctx.fillRect(-3, -g.r - 4, 6, 6);
          }
          if (blink && g.explosion && g.fuse < 1) { ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill(); }
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(g.x, g.y - (g.z || 0));
        ctx.rotate(Math.atan2(g.vy, g.vx));
        ctx.beginPath(); ctx.ellipse(0, 0, 12, 7.5, 0, 0, TAU);
        ctx.fillStyle = '#6f7f3c'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#3b451f'; ctx.stroke();
        ctx.fillStyle = '#d8c25a'; ctx.fillRect(3, -6, 3, 12);
        ctx.restore();
      }
    }
  };

  Renderer.prototype.drawExplosions = function (ctx, world) {
    for (var i = 0; i < world.explosions.length; i++) {
      var e = world.explosions[i], k = e.t / e.dur;
      if (e.ring) {
        ctx.strokeStyle = rgba(e.color, (1 - k) * 0.9);
        ctx.lineWidth = 10 * (1 - k) + 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * U.easeOut(k), 0, TAU); ctx.stroke();
        continue;
      }
      if (e.hole) {
        ctx.fillStyle = rgba(e.color, 1 - k);
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 - k * 0.6), 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(181,140,255,' + (1 - k).toFixed(2) + ')'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1.3 - k * 0.6), 0, TAU); ctx.stroke();
        continue;
      }
      var rr = e.r * (0.3 + 0.7 * U.easeOut(Math.min(1, k * 1.6)));
      var grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, rr);
      grad.addColorStop(0, 'rgba(255,250,215,' + (1 - k).toFixed(2) + ')');
      grad.addColorStop(0.45, 'rgba(255,168,60,' + (0.85 * (1 - k)).toFixed(2) + ')');
      grad.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(e.x, e.y, rr, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.65 * (1 - k)).toFixed(2) + ')';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * U.easeOut(k), 0, TAU); ctx.stroke();
      if (e.kind === 'airstrike') this.drawAirstrikeImpact(ctx, e, k);
    }
  };

  Renderer.prototype.drawParticles = function (ctx, world, v) {
    var ps = world.particles;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (!visible(v, p.x, p.y, 40)) continue;
      var a = p.life / p.max;
      if (p.kind === 'dot') {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * a), 0, TAU); ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke();
      } else if (p.kind === 'smoke') {
        ctx.globalAlpha = a * 0.45;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
      } else if (p.kind === 'flash') {
        ctx.globalAlpha = Math.min(1, a * 1.5);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.ellipse(p.size * 0.35, 0, p.size, p.size * 0.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(p.size * 0.2, 0, p.size * 0.45, p.size * 0.25, 0, 0, TAU); ctx.fill();
        ctx.restore();
      } else if (p.kind === 'debris') {
        ctx.globalAlpha = a;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else if (p.kind === 'cross') {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 6, p.size, p.size / 3);
        ctx.fillRect(p.x - p.size / 6, p.y - p.size / 2, p.size / 3, p.size);
      } else if (p.kind === 'bolt') {
        // Lightning: a jagged line from high above down to the target.
        ctx.globalAlpha = Math.min(1, a * 1.4);
        ctx.beginPath(); ctx.moveTo(p.x + 80, p.y - 760);
        for (var bi = 1; bi <= 6; bi++) ctx.lineTo(p.x + (bi < 6 ? Math.sin(p.seed + bi * 7.3) * 40 : 0), p.y - 760 + bi * 760 / 6);
        ctx.strokeStyle = 'rgba(255,246,168,0.6)'; ctx.lineWidth = p.size * 3; ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = p.size; ctx.stroke();
      } else if (p.kind === 'tracer') {
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.tx, p.ty); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  };

  Renderer.prototype.drawTexts = function (ctx, world, v) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < world.texts.length; i++) {
      var tx = world.texts[i];
      if (!visible(v, tx.x, tx.y, 100)) continue;
      var age = tx.max - tx.life, pop = age < 0.1 ? 0.6 + age / 0.1 * 0.55 : Math.max(1, 1.15 - (age - 0.1) * 0.6);
      ctx.globalAlpha = Math.min(1, tx.life / 0.3);
      ctx.font = Math.round(tx.size * pop) + 'px ' + FONT;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(22,22,32,0.9)';
      ctx.strokeText(tx.str, tx.x, tx.y);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.str, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
  };

  Renderer.prototype.drawStorm = function (ctx, storm, v) {
    if (!storm) return;
    var r = Math.max(0.5, storm.r);
    ctx.beginPath();
    ctx.rect(v.x0 - 200, v.y0 - 200, v.x1 - v.x0 + 400, v.y1 - v.y0 + 400);
    ctx.arc(storm.x, storm.y, r, 0, TAU, true);
    ctx.fillStyle = 'rgba(118,48,196,0.33)';
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(205,150,255,0.95)';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(storm.x, storm.y, r, 0, TAU); ctx.stroke();
    if (storm.next && storm.state !== 'final') {
      ctx.setLineDash([26, 18]);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(storm.next.x, storm.next.y, Math.max(1, storm.next.r), 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  W.Renderer = Renderer;
  W.RenderUtil = { roundRect: roundRect, hexPath: hexPath, PAL: PAL, FONT: FONT };
}());
