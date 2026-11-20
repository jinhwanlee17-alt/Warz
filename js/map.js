/* warz.io: seeded island generator. Every match gets a fresh random layout. No DOM access. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, C = W.CONFIG;

  var PREFIX = ['Rusty', 'Sunny', 'Dusty', 'Misty', 'Lucky', 'Rocky', 'Shady', 'Windy', 'Copper', 'Maple',
    'Pebble', 'Thunder', 'Crimson', 'Salty', 'Mossy', 'Breezy', 'Iron', 'Amber', 'Cedar', 'Foggy'];
  var SUFFIX = ['Ridge', 'Harbor', 'Fields', 'Grove', 'Point', 'Springs', 'Valley', 'Outpost', 'Town', 'Bay',
    'Park', 'Junction', 'Mill', 'Heights', 'Crossing', 'Depot', 'Flats', 'Hills'];
  var ROOFS = ['#b5533c', '#4f6d8f', '#7a6a9a', '#a3753f', '#5f8a6a', '#8f4f63'];
  var WALL = 18, DOOR = 86;

  function inside(x, y, margin) { return U.insideIsland(x, y, margin, C.worldSize, C.cornerRadius); }

  // One traversed communication trench. The lip, floor and combat footprint share
  // the same mitered corners and squared ends at every rotation.
  var TRENCH_WIDTH = 106, WIRE_OFFSET = 33, WIRE_RADIUS = 10;
  var TRENCH_CLEARANCE = TRENCH_WIDTH / 2 + WIRE_OFFSET + WIRE_RADIUS + 12;
  var trenchRun = [[-795, 32], [-648, 32], [-572, -60], [-432, -60], [-341, 32], [-205, 32],
    [-143, -32], [-31, -32], [31, 32], [143, 32], [205, -32], [341, -32],
    [432, 60], [572, 60], [648, -32], [795, -32]];
  function normal(a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    return { x: -dy / length, y: dx / length };
  }
  function trenchBank(side) {
    return trenchRun.map(function (p, i) {
      var a = i ? normal(trenchRun[i - 1], p) : normal(p, trenchRun[1]);
      var b = i < trenchRun.length - 1 ? normal(p, trenchRun[i + 1]) : a;
      var offset = side * TRENCH_WIDTH / (2 * (1 + a.x * b.x + a.y * b.y));
      return [p[0] + (a.x + b.x) * offset, p[1] + (a.y + b.y) * offset];
    });
  }
  var trenchRim = trenchBank(1).concat(trenchBank(-1).reverse());
  // Test the same swept clearance at every orientation. Probe both ends and
  // the bends first, so a blocked run rarely needs its intermediate samples.
  var trenchSamples = trenchRun.slice();
  trenchRun.forEach(function (b, i) {
    if (!i) return;
    var a = trenchRun[i - 1], steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 60);
    for (var j = 1; j < steps; j++) {
      trenchSamples.push([U.lerp(a[0], b[0], j / steps), U.lerp(a[1], b[1], j / steps)]);
    }
  });

  function makeTrench(id, x, y, angle, biome) {
    var c = Math.cos(angle), s = Math.sin(angle);
    function transform(p) { return { x: x + p[0] * c - p[1] * s, y: y + p[0] * s + p[1] * c }; }
    var outline = trenchRim.map(transform), wires = [];
    // Leave the turns and both ends open. Runs on the opposite bank are
    // staggered, so the player can see a clear approach from either side.
    for (var i = 0; i < trenchRun.length - 1; i += 2) {
      var a = trenchRun[i], b = trenchRun[i + 1], bay = i / 2;
      var side = (Math.floor(bay / 2) + id) % 2 ? 1 : -1;
      var wy = a[1] + side * (TRENCH_WIDTH / 2 + WIRE_OFFSET);
      wires.push({ a: transform([a[0] + 22, wy]), b: transform([b[0] - 22, wy]) });
    }
    return { id: id, x: x, y: y, width: TRENCH_WIDTH, biome: biome, points: trenchRun.map(transform), outline: outline, wires: wires,
      x0: Math.min.apply(null, outline.map(function (p) { return p.x; })), x1: Math.max.apply(null, outline.map(function (p) { return p.x; })),
      y0: Math.min.apply(null, outline.map(function (p) { return p.y; })), y1: Math.max.apply(null, outline.map(function (p) { return p.y; })) };
  }

  function containsTrench(t, x, y) {
    if (x < t.x0 || x > t.x1 || y < t.y0 || y > t.y1) return false;
    var rim = t.outline, hit = false;
    for (var i = 0, j = rim.length - 1; i < rim.length; j = i++) {
      var a = rim[i], b = rim[j];
      if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)) hit = !hit;
    }
    return hit;
  }

  function trenchWall(t, x, y) {
    var rim = t.outline, best = Infinity, bestIndex = -1, bestU, bestX, bestY;
    for (var i = 0; i < rim.length; i++) {
      var a = rim[i], b = rim[(i + 1) % rim.length], dx = b.x - a.x, dy = b.y - a.y;
      var length2 = dx * dx + dy * dy, u = U.clamp(((x - a.x) * dx + (y - a.y) * dy) / length2, 0, 1);
      var wx = a.x + u * dx, wy = a.y + u * dy, d2 = (wx - x) * (wx - x) + (wy - y) * (wy - y);
      if (d2 >= best) continue;
      best = d2; bestIndex = i; bestU = u; bestX = wx; bestY = wy;
    }
    if (bestIndex < 0) return;
    var start = rim[bestIndex], end = rim[(bestIndex + 1) % rim.length];
    var sx = end.x - start.x, sy = end.y - start.y, length = Math.sqrt(sx * sx + sy * sy);
    var nx = -sy / length, ny = sx / length;
    if (bestU === 0 || bestU === 1) {
      var prev = bestU === 0 ? rim[(bestIndex + rim.length - 1) % rim.length] : end;
      var next = bestU === 0 ? start : rim[(bestIndex + 2) % rim.length];
      var ex = next.x - prev.x, ey = next.y - prev.y, edge = Math.hypot(ex, ey);
      nx -= ey / edge; ny += ex / edge;
      var bisector = Math.hypot(nx, ny); nx /= bisector; ny /= bisector;
    }
    return { x: bestX, y: bestY, nx: nx, ny: ny, distance: Math.sqrt(best) };
  }

  // Tiny per-cell lists avoid scanning the whole island for every moving player
  // or projectile. Keep the index separate from serializable seeded terrain.
  var trenchIndices = new WeakMap(), trenchQueryPad = 64;
  function trenchIndex(map) {
    var list = map.trenches;
    if (!list || !list.length) return null;
    var index = trenchIndices.get(map);
    if (!index || index.list !== list || index.count !== list.length) {
      var grid = new U.SpatialHash(256), wireGrid = new U.SpatialHash(256), coarse = new U.SpatialHash(1024);
      var pad = trenchQueryPad, outer = WIRE_OFFSET + WIRE_RADIUS;
      list.forEach(function (t) {
        var entry = { trench: t, wires: [] };
        grid.insert(entry, t.x0 - pad, t.y0 - pad, t.x1 + pad, t.y1 + pad);
        coarse.insert(entry, t.x0 - outer, t.y0 - outer, t.x1 + outer, t.y1 + outer);
        (t.wires || []).forEach(function (wire, wireIndex) {
          var a = wire.a, b = wire.b, dx = b.x - a.x, dy = b.y - a.y;
          var segment = { wire: wire, wireIndex: wireIndex, trench: t, dx: dx, dy: dy, length2: dx * dx + dy * dy };
          entry.wires.push(segment);
          wireGrid.insert(segment,
            Math.min(a.x, b.x) - pad, Math.min(a.y, b.y) - pad, Math.max(a.x, b.x) + pad, Math.max(a.y, b.y) + pad);
        });
      });
      index = { list: list, count: list.length, grid: grid, wireGrid: wireGrid, coarse: coarse };
      trenchIndices.set(map, index);
    }
    return index;
  }
  function trenchCandidates(index, x, y, reach, wires) {
    // The grid padding covers a player's full reach from any point in its cell.
    var grid = wires ? index.wireGrid : index.grid;
    if (reach <= trenchQueryPad) return grid.cells.get(grid.key(Math.floor(x / grid.cell), Math.floor(y / grid.cell)));
    // Large footprints can touch several wires. Preserve the island's terrain
    // query order and each trench's original wire order for those contacts.
    var matches = [];
    index.coarse.query(x - reach, y - reach, x + reach, y + reach, function (entry) {
      if (wires) matches.push.apply(matches, entry.wires); else matches.push(entry);
    });
    return matches;
  }
  function trenchAt(map, x, y, reach) {
    var index = trenchIndex(map);
    if (!index) return null;
    var candidates = trenchCandidates(index, x, y, reach, false);
    if (!candidates) return null;
    var found = null, nearest = reach;
    for (var i = 0; i < candidates.length; i++) {
      var t = candidates[i].trench;
      if (x < t.x0 - reach || x > t.x1 + reach || y < t.y0 - reach || y > t.y1 + reach) continue;
      if (containsTrench(t, x, y)) { found = t; nearest = 0; }
      else if (nearest > 0) {
        var d = trenchWall(t, x, y).distance;
        if (d <= nearest) { found = t; nearest = d; }
      }
    }
    return found;
  }

  function wireAt(map, x, y, radius) {
    var index = trenchIndex(map);
    if (!index) return null;
    var reach = (radius || 0) + WIRE_RADIUS, candidates = trenchCandidates(index, x, y, reach, true);
    if (!candidates) return null;
    for (var i = 0; i < candidates.length; i++) {
      var entry = candidates[i], wire = entry.wire;
      if (wire.destroyed) continue;
      var ax = x - wire.a.x, ay = y - wire.a.y;
      var u = U.clamp((ax * entry.dx + ay * entry.dy) / entry.length2, 0, 1);
      var ex = ax - u * entry.dx, ey = ay - u * entry.dy;
      if (ex * ex + ey * ey <= reach * reach && !containsTrench(entry.trench, x, y)) return wire;
    }
    return null;
  }

  function wiresAlong(map, x1, y1, x2, y2, radius, onContact) {
    var index = trenchIndex(map);
    if (!index) return;
    var reach = radius + WIRE_RADIUS;
    index.wireGrid.query(Math.min(x1, x2) - reach, Math.min(y1, y2) - reach,
      Math.max(x1, x2) + reach, Math.max(y1, y2) + reach, function (entry) {
        var wire = entry.wire;
        if (wire.destroyed) return;
        // In wire-local coordinates, the swept hull hits a rectangle with rounded ends.
        var a = wire.a, b = wire.b, length = Math.sqrt(entry.length2);
        var ux = entry.dx / length, uy = entry.dy / length;
        var ax = x1 - a.x, ay = y1 - a.y, bx = x2 - a.x, by = y2 - a.y;
        var hitsSpan = U.segRect(ax * ux + ay * uy, ay * ux - ax * uy,
          bx * ux + by * uy, by * ux - bx * uy, 0, -reach, length, 2 * reach) >= 0;
        if (hitsSpan || U.segCircle(x1, y1, x2, y2, a.x, a.y, reach) >= 0 ||
            U.segCircle(x1, y1, x2, y2, b.x, b.y, reach) >= 0) onContact(entry.trench.id, entry.wireIndex);
      });
  }

  function crushWire(map, trenchId, wireIndex) {
    if (!Number.isInteger(trenchId) || !Number.isInteger(wireIndex)) return false;
    var trench = map.trenches && map.trenches[trenchId - 1];
    var wire = trench && trench.wires && trench.wires[wireIndex];
    if (!wire || wire.destroyed) return false;
    wire.destroyed = true;
    map.wireVersion = (map.wireVersion || 0) + 1;
    return true;
  }

  function generateTrenches(map, occ) {
    var rng = U.rng((map.seed ^ 0x762fc13b) >>> 0), byBiome = {}, trenches = [];
    map.biomeCells.forEach(function (cell) {
      var group = byBiome[cell.id] || (byBiome[cell.id] = { cells: [], area: 0 });
      group.area += cell.w * cell.h;
      group.cells.push({ cell: cell, end: group.area });
    });
    function pointInBiome(group) {
      var draw = rng.next() * group.area;
      var cell = group.cells.find(function (entry) { return draw < entry.end; }).cell;
      return { x: rng.range(cell.x, cell.x + cell.w), y: rng.range(cell.y, cell.y + cell.h) };
    }
    function clearFoliage(plants, t) {
      var moves = [];
      for (var plant of plants) {
        var radius = plant.r * (plant.trunk ? .55 : .8), destination = null;
        for (var i = 0; i < 256; i++) {
          var angle = rng.next() * U.TAU, distance = 115 + i * 8;
          var p = i < 100 ? { x: plant.x + Math.cos(angle) * distance, y: plant.y + Math.sin(angle) * distance } :
            pointInBiome(byBiome[plant.biome]);
          if (!inside(p.x, p.y, C.beach + 70) || W.Biomes.at(map, p.x, p.y) !== plant.biome ||
              !occ.circleFree(p.x, p.y, radius) || containsTrench(t, p.x, p.y) ||
              trenchWall(t, p.x, p.y).distance < radius + 45 ||
              moves.some(function (m) { return Math.hypot(p.x - m.p.x, p.y - m.p.y) < m.radius + radius; })) continue;
          destination = p; break;
        }
        if (!destination) return false;
        moves.push({ plant: plant, p: destination, radius: radius });
      }
      // Only commit moves once every displaced plant has a clear spot. This
      // preserves IDs, counts and biome membership even in thin overlap regions.
      moves.forEach(function (m) {
        m.plant.x = m.p.x; m.plant.y = m.p.y;
        occ.addCircle(m.p.x, m.p.y, m.radius);
      });
      return true;
    }
    // Most runs keep clear of entire towns. A narrow biome may lie entirely
    // within a town's scatter exclusion. There, check the actual buildings,
    // boarding areas and defenses to find any open ground in the district.
    var townSpace;
    function townObstacles() {
      if (townSpace) return townSpace;
      townSpace = new Occupancy();
      map.buildings.forEach(function (b) { townSpace.addRect(b.x - 16, b.y - 16, b.w + 32, b.h + 32); });
      map.settlementStructures.forEach(function (s) { townSpace.addCircle(s.x, s.y, 90); });
      map.settlementVehicles.forEach(function (v) { townSpace.addCircle(v.x, v.y, W.vehicleDef(v).radius + 60); });
      map.crates.forEach(function (c) { if (c.settlement !== undefined) townSpace.addCircle(c.x, c.y, c.size); });
      return townSpace;
    }
    function place(x, y, angle, biome, clearBrush, towns) {
      var foliage = clearBrush ? new Set() : null;
      if (!inside(x, y, C.beach + TRENCH_CLEARANCE) || !occ.circleFree(x, y, TRENCH_CLEARANCE, foliage, towns)) return false;
      var cos = Math.cos(angle), sin = Math.sin(angle);
      for (var i = 0; i < trenchSamples.length; i++) {
        var q = trenchSamples[i], sx = x + q[0] * cos - q[1] * sin, sy = y + q[0] * sin + q[1] * cos;
        if (!inside(sx, sy, C.beach + TRENCH_CLEARANCE) || !occ.circleFree(sx, sy, TRENCH_CLEARANCE, foliage, towns)) return false;
      }
      var t = makeTrench(trenches.length + 1, x, y, angle, biome);
      if (foliage && !clearFoliage(foliage, t)) return false;
      trenchSamples.forEach(function (q) { occ.addCircle(x + q[0] * cos - q[1] * sin, y + q[0] * sin + q[1] * cos, TRENCH_CLEARANCE); });
      trenches.push(t);
      return true;
    }
    // Mixed biomes can be narrow strips. Give them first choice of ground,
    // before a longer run from a neighbouring biome spans that strip.
    Object.keys(byBiome).sort(function (a, b) { return byBiome[a].area - byBiome[b].area; }).forEach(function (biome) {
      var group = byBiome[biome], sites = Math.max(1, Math.round(group.area / (5300 * 5300)));
      var first = trenches.length;
      for (var site = 0; site < sites; site++) {
        // A tiny overlap can have just one viable orientation around a pond or
        // settlement. Spend the larger search budget only on its first run.
        var tries = trenches.length === first ? 20000 : 240;
        for (var attempt = 0; attempt < tries; attempt++) {
          var point = pointInBiome(group), x = point.x, y = point.y, angle = rng.range(0, U.TAU);
          var towns = trenches.length === first && attempt >= 180 ? townObstacles() : null;
          if (!place(x, y, angle, biome, attempt >= 10, towns)) continue;
          // Nearby but disconnected runs form a prepared position. Open ground
          // and blocked approaches naturally break up its footprint.
          for (var partner = 0; partner < 32; partner++) {
            var side = rng.range(300, 740) * (rng.chance(.5) ? 1 : -1), along = rng.range(-440, 440);
            var px = x + Math.cos(angle) * along - Math.sin(angle) * side;
            var py = y + Math.sin(angle) * along + Math.cos(angle) * side;
            if (W.Biomes.at(map, px, py) === biome && place(px, py, angle + rng.range(-.22, .22), biome, partner >= 3)) break;
          }
          break;
        }
      }
    });
    return trenches;
  }

  W.Trenches = { width: TRENCH_WIDTH, wireRadius: WIRE_RADIUS, create: makeTrench, contains: containsTrench, wall: trenchWall,
    at: function (map, x, y) { return trenchAt(map, x, y, 0); }, near: trenchAt, wireAt: wireAt,
    wiresAlong: wiresAlong, crushWire: crushWire };

  function Occupancy() { this.hash = new U.SpatialHash(256); }
  Occupancy.prototype.addCircle = function (x, y, r, plant) {
    this.hash.insert({ k: 0, x: x, y: y, r: r, plant: plant }, x - r, y - r, x + r, y + r);
  };
  Occupancy.prototype.addRect = function (x, y, w, h, town) {
    this.hash.insert({ k: 1, x: x, y: y, w: w, h: h, town: town }, x, y, x + w, y + h);
  };
  Occupancy.prototype.circleFree = function (x, y, r, foliage, towns) {
    var free = true;
    this.hash.query(x - r, y - r, x + r, y + r, function (it) {
      if (!free) return;
      if (it.k === 0) {
        // A plant relocated for an earlier trench has a new occupancy entry.
        if (it.plant && (it.x !== it.plant.x || it.y !== it.plant.y)) return;
        var dx = it.x - x, dy = it.y - y, gap = it.r + r;
        if (dx * dx + dy * dy < gap * gap) {
          if (foliage && it.plant) foliage.add(it.plant);
          else free = false;
        }
      } else {
        var nx = U.clamp(x, it.x, it.x + it.w), ny = U.clamp(y, it.y, it.y + it.h);
        var ex = x - nx, ey = y - ny;
        if (ex * ex + ey * ey < r * r) free = !!(it.town && towns && towns.circleFree(x, y, r));
      }
    });
    return free;
  };
  Occupancy.prototype.rectFree = function (x, y, w, h) {
    var free = true;
    this.hash.query(x, y, x + w, y + h, function (it) {
      if (!free) return;
      if (it.k === 0) {
        var nx = U.clamp(it.x, x, x + w), ny = U.clamp(it.y, y, y + h);
        if (Math.hypot(it.x - nx, it.y - ny) < it.r) free = false;
      } else if (it.x < x + w && it.x + it.w > x && it.y < y + h && it.y + it.h > y) {
        free = false;
      }
    });
    return free;
  };

  // Wobbly closed outline (flat [x0,y0,x1,y1,...]) for ponds and rocks.
  function blob(rng, x, y, r, n, wobble) {
    var pts = [], phase = rng.next() * U.TAU;
    for (var i = 0; i < n; i++) {
      var a = phase + i / n * U.TAU, k = 1 + rng.range(-wobble, wobble);
      pts.push(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
    }
    return pts;
  }

  // Grass edge: a rounded square inset by the beach, pushed in and out by layered sine noise.
  function coastline(rng, inset, amp) {
    var S = C.worldSize, R = C.cornerRadius, rr = R - inset, step = 60, pts = [], s = 0;
    var p0 = rng.next() * U.TAU, p1 = rng.next() * U.TAU, p2 = rng.next() * U.TAU;
    function push(x, y, nx, ny) {
      var n = Math.sin(s * 0.004 + p0) * 0.5 + Math.sin(s * 0.011 + p1) * 0.3 + Math.sin(s * 0.027 + p2) * 0.2;
      pts.push(x - nx * n * amp, y - ny * n * amp);
      s += step;
    }
    function arc(cx, cy, a0, a1) {
      var count = Math.max(2, Math.ceil(rr * (a1 - a0) / step));
      for (var i = 0; i < count; i++) {
        var a = a0 + (a1 - a0) * i / count, nx = Math.cos(a), ny = Math.sin(a);
        push(cx + nx * rr, cy + ny * rr, nx, ny);
      }
    }
    var x, y;
    for (x = R; x < S - R; x += step) push(x, inset, 0, -1);
    arc(S - R, R, -Math.PI / 2, 0);
    for (y = R; y < S - R; y += step) push(S - inset, y, 1, 0);
    arc(S - R, S - R, 0, Math.PI / 2);
    for (x = S - R; x > R; x -= step) push(x, S - inset, 0, 1);
    arc(R, S - R, Math.PI / 2, Math.PI);
    for (y = S - R; y > R; y -= step) push(inset, y, -1, 0);
    arc(R, R, Math.PI, Math.PI * 1.5);
    return pts;
  }

  function makeBuilding(rng, id, x, y, w, h, entrance) {
    var walls = [], doorways = [], sides = rng.shuffle(['top', 'bottom', 'left', 'right']);
    var doors = entrance ? [entrance] : sides.slice(0, rng.chance(0.55) ? 2 : 1), doorSet = {};
    doors.forEach(function (d) { doorSet[d] = true; });
    function horizontal(yy, door) {
      if (!door) { walls.push({ x: x, y: yy, w: w, h: WALL }); return; }
      var dx = x + WALL + rng.range(30, w - WALL * 2 - DOOR - 30);
      doorways.push({ x: dx, y: yy, w: DOOR, h: WALL, side: yy === y ? 'top' : 'bottom' });
      walls.push({ x: x, y: yy, w: dx - x, h: WALL });
      walls.push({ x: dx + DOOR, y: yy, w: x + w - dx - DOOR, h: WALL });
    }
    function vertical(xx, door) {
      var top = y + WALL, len = h - WALL * 2;
      if (!door) { walls.push({ x: xx, y: top, w: WALL, h: len }); return; }
      var dy = top + rng.range(26, len - DOOR - 26);
      doorways.push({ x: xx, y: dy, w: WALL, h: DOOR, side: xx === x ? 'left' : 'right' });
      walls.push({ x: xx, y: top, w: WALL, h: dy - top });
      walls.push({ x: xx, y: dy + DOOR, w: WALL, h: top + len - dy - DOOR });
    }
    horizontal(y, doorSet.top);
    horizontal(y + h - WALL, doorSet.bottom);
    vertical(x, doorSet.left);
    vertical(x + w - WALL, doorSet.right);
    return {
      id: id, x: x, y: y, w: w, h: h, walls: walls, doors: doors, doorways: doorways,
      roof: rng.pick(ROOFS), ridgeVertical: h > w, vent: rng.chance(0.6), fade: 1
    };
  }

  function snap(v) { return Math.round(v / 20) * 20; }

  function edgeLength(inset) {
    if (inset === undefined) inset = C.dropCoastInset;
    return 4 * (C.worldSize - C.cornerRadius * 2) + U.TAU * (C.cornerRadius - inset);
  }
  function edgePoint(distance, inset) {
    if (inset === undefined) inset = C.dropCoastInset;
    var S = C.worldSize, R = C.cornerRadius, cr = R - inset, flat = S - R * 2;
    var side = flat + Math.PI * cr / 2, perimeter = side * 4;
    distance = ((distance % perimeter) + perimeter) % perimeter;
    var edge = Math.floor(distance / side), offset = distance - edge * side, x, y;
    if (offset < flat) { x = R + offset; y = inset; }
    else { var angle = -Math.PI / 2 + (offset - flat) / cr; x = S - R + Math.cos(angle) * cr; y = R + Math.sin(angle) * cr; }
    for (var rotate = 0; rotate < edge; rotate++) { var oldX = x; x = S - y; y = oldX; }
    return { x: x, y: y };
  }

  // The annotated vehicle lanes follow nested rounded squares, rather than circles.
  var VEHICLE_RINGS = {
    humvee: { inset: 0.055, corner: 0.075 },
    artillery: { inset: 0.15, corner: 0.055 },
    tank: { inset: 0.28, corner: 0.035 }
  };
  function ringPoint(fraction, inset, corner) {
    var S = C.worldSize, flat = S - inset * 2 - corner * 2, side = flat + Math.PI * corner / 2;
    var distance = ((fraction % 1) + 1) % 1 * side * 4;
    var edge = Math.min(3, Math.floor(distance / side)), offset = distance - edge * side, x, y;
    if (offset < flat) { x = inset + corner + offset; y = inset; }
    else {
      var angle = -Math.PI / 2 + (offset - flat) / corner;
      x = S - inset - corner + Math.cos(angle) * corner;
      y = inset + corner + Math.sin(angle) * corner;
    }
    for (var turn = 0; turn < edge; turn++) { var oldX = x; x = S - y; y = oldX; }
    return { x: x, y: y };
  }
  function vehicleRingPoint(type, fraction) {
    var lane = VEHICLE_RINGS[type];
    return ringPoint(fraction, lane.inset * C.worldSize, lane.corner * C.worldSize);
  }

  function groundArtilleryRingPoint(ring, fraction) {
    var lane = W.GROUND_ARTILLERY.rings[ring], S = C.worldSize, r = lane.corner * S;
    var left = lane.left * S, right = lane.right * S, top = lane.top * S, bottom = lane.bottom * S;
    var w = right - left - r * 2, h = bottom - top - r * 2, arc = Math.PI * r / 2;
    var lengths = [w, arc, h, arc, w, arc, h, arc], d = ((fraction % 1) + 1) % 1 * (2 * w + 2 * h + U.TAU * r), part = 0;
    while (part < 7 && d > lengths[part]) { d -= lengths[part]; part++; }
    if (part === 0) return { x: left + r + d, y: top };
    if (part === 2) return { x: right, y: top + r + d };
    if (part === 4) return { x: right - r - d, y: bottom };
    if (part === 6) return { x: left, y: bottom - r - d };
    var angle = (part - 3) * Math.PI / 4 + d / r;
    return { x: (part === 1 || part === 3 ? right - r : left + r) + Math.cos(angle) * r,
      y: (part === 1 || part === 7 ? top + r : bottom - r) + Math.sin(angle) * r };
  }

  // Centerlines and half-widths of the three angled rectangles on the annotated map.
  var MILITARY_ZONES = [
    { id: 'north', x1: .397, y1: .215, x2: .744, y2: .255, halfWidth: .044 },
    { id: 'east', x1: .708, y1: .356, x2: .667, y2: .644, halfWidth: .047 },
    { id: 'southwest', x1: .349, y1: .484, x2: .489, y2: .742, halfWidth: .043 }
  ];
  function settlementInMilitaryZone(town, zone, size) {
    var dx = zone.x2 - zone.x1, dy = zone.y2 - zone.y1, length = Math.hypot(dx, dy);
    var ux = dx / length, uy = dy / length, half = length * size / 2, width = zone.halfWidth * size;
    var x = town.x - (zone.x1 + zone.x2) * size / 2, y = town.y - (zone.y1 + zone.y2) * size / 2;
    // Separating-axis test of the complete town footprint against the drawn rectangle.
    return Math.abs(x) <= town.halfW + Math.abs(ux) * half + Math.abs(uy) * width &&
      Math.abs(y) <= town.halfH + Math.abs(uy) * half + Math.abs(ux) * width &&
      Math.abs(x * ux + y * uy) <= half + town.halfW * Math.abs(ux) + town.halfH * Math.abs(uy) &&
      Math.abs(y * ux - x * uy) <= width + town.halfW * Math.abs(uy) + town.halfH * Math.abs(ux);
  }
  function militaryBase(x, y, zone, big, size) {
    var center = zone === 'center';
    return { id: center ? 1 : 2, zone: zone, center: center, big: big, x: x, y: y,
      halfW: big ? 3220 : 1540, halfH: 1250, name: big ? 'Big Military Base' : 'Military Base',
      pingRadius: size * (big ? .36 : .18), pingCycles: big ? 2 : 1 };
  }
  function reserveBase(space, base) {
    space.addRect(base.x - base.halfW, base.y - base.halfH, 2 * base.halfW, 2 * base.halfH);
  }
  function populateBase(map, base, rng, firstVehicleId, addStation, addCrate) {
    var big = base.big, multiple = big ? 2 : 1, columns = big ? 5 : 2, houses = [], count = columns * 5;
    // A 440 by 360 barracks has three times the floor area of a 240 by 220 house.
    for (var i = 0; i < count; i++) {
      var x = base.x + 345 + (i % columns) * 550, y = base.y - 1080 + Math.floor(i / columns) * 450;
      var b = makeBuilding(rng, map.buildings.length, x, y, 440, 360, 'left');
      b.kind = 'military'; b.style = 'barracks'; b.militaryBase = base.id;
      b.roof = rng.pick(['#40583c', '#394f38', '#435c41']);
      map.buildings.push(b); houses.push(b);
      var station = addStation(x + 345, y + 180);
      station.building = b.id; station.militaryBase = base.id;
    }

    // Seed rewards into separate interior slots, with a clear entrance and station approach.
    var rewards = houses.map(function () { return ['epic', 'epic', 'rare', 'common']; });
    var shuffled = rng.shuffle(houses.map(function (_, i) { return i; }));
    // A big base has 60 epic, 30 rare and 30 common crates across 25 barracks.
    if (big) ['epic', 'epic', 'rare', 'common'].forEach(function (tier, group) {
      for (var j = 0; j < 5; j++) rewards[shuffled[group * 5 + j]].push(tier);
    });
    var tokens = big ? 9 : 3, classCrates = big ? 6 : 2;
    for (var j = 0; j < tokens; j++) rewards[shuffled[j]].push('token');
    for (j = 0; j < classCrates - (base.center ? 0 : 1); j++) rewards[shuffled[tokens + j]].push('classToken');
    var locations = [[120,70], [220,70], [120,290], [220,290], [340,65], [340,295]];
    houses.forEach(function (b, i) {
      rng.shuffle(rewards[i]).forEach(function (tier, index) {
        var loc = locations[index], crate = addCrate(b.x + loc[0], b.y + loc[1], tier);
        crate.building = b.id; crate.militaryBase = base.id;
      });
    });
    if (base.center) {
      map.crates[map.legendaryCrateId].militaryBase = base.id;
      if (big) [-340, 340].forEach(function (dy) { addCrate(base.x, base.y + dy, 'legendary').militaryBase = base.id; });
    } else {
      addCrate(base.x, base.y, 'classToken').militaryBase = base.id;
    }

    // Parking rows face west onto the apron. All four access points remain clear.
    var parkingCols = big ? 8 : 4, vehicles = 25 * multiple;
    for (i = 0; i < vehicles; i++) {
      map.militaryVehicles.push({ id: ++firstVehicleId, militaryBase: base.id,
        type: i < 10 * multiple ? 'tank' : 'artillery', fixed: i >= 20 * multiple,
        x: base.x - 405 - (i % parkingCols) * 305, y: base.y + (Math.floor(i / parkingCols) - 3) * 305, angle: Math.PI });
    }
    // Space the sentries and turrets around the full perimeter, with separate courtyard guards.
    function guard(item, x, y, angle, role) {
      map.militaryStructures.push({ kind: item === 'turret3' ? 'turret' : 'sentry', item: item, x: base.x + x, y: base.y + y,
        angle: angle, guardRole: role, aiRider: item === 'turret3', neutral: true, militaryBase: base.id });
    }
    var w = 2 * (base.halfW - 56), h = 2 * (base.halfH - 56), perimeterCount = 11 * multiple;
    for (i = 0; i < perimeterCount; i++) {
      var d = (i + .5) / perimeterCount * 2 * (w + h), px, py;
      if (d < w) { px = d - w / 2; py = -h / 2; }
      else if (d < w + h) { px = w / 2; py = d - w - h / 2; }
      else if (d < 2 * w + h) { px = w / 2 - (d - w - h); py = h / 2; }
      else { px = -w / 2; py = h / 2 - (d - 2 * w - h); }
      var turret = [0, 3, 6, 8].indexOf(i % 11) >= 0;
      guard(turret ? 'turret3' : 'sentry3', px, py, Math.atan2(py, px), 'perimeter');
    }
    for (i = 0; i < 3 * multiple; i++) {
      var angle = Math.PI / 2 + i / (3 * multiple) * U.TAU;
      guard('sentry3', Math.cos(angle) * (big ? 195 : 285), Math.sin(angle) * (big ? 545 : 390), angle, 'vault');
    }
    return firstVehicleId;
  }

  function generate(seed, teamSize) {
    seed = (seed >>> 0) || 1;
    teamSize = teamSize === 2 || teamSize === 3 || teamSize === 4 ? teamSize : 1;
    var rng = U.rng(seed), S = C.worldSize, area = C.mapAreaScale || 1, occ = new Occupancy();
    // Area can be fractional: round each density target once to the nearest item.
    function scaledCount(count) { return Math.round(count * area); }
    var map = {
      seed: seed, teamSize: teamSize, size: S, coast: null, ponds: [], patches: [], tufts: [], towns: [], buildings: [],
      rocks: [], trees: [], bushes: [], cacti: [], crates: [], stations: [], drops: [], vehicles: [], tanks: [], artillery: [], groundArtillery: [],
      settlementStructures: [], settlementVehicles: [], militaryBases: [], militaryStructures: [], militaryVehicles: [], pickups: [], nextPickupId: 1
    };
    map.biomes = W.Biomes.generate(seed, S);
    map.biomeCells = W.Biomes.cells(map);
    map.coast = coastline(rng, C.beach, 34);
    // Reserve the centre before any terrain, building, station or spawn is placed.
    // The legendary crate can always be approached from every direction.
    occ.addCircle(S / 2, S / 2, C.legendaryClearRadius);

    function near(list, x, y, d) {
      var range2 = d * d;
      for (var i = 0; i < list.length; i++) {
        var dx = list[i].x - x, dy = list[i].y - y;
        if (dx * dx + dy * dy < range2) return true;
      }
      return false;
    }
    var pondSpace = new U.SpatialHash(512);
    function inPond(x, y, pad) {
      var found = false;
      pondSpace.query(x - pad, y - pad, x + pad, y + pad, function (p) {
        var dx = p.x - x, dy = p.y - y, reach = p.r + pad;
        if (dx * dx + dy * dy < reach * reach) found = true;
      });
      return found;
    }
    function scatter(count, attempts, place) {
      for (var made = 0, t = 0; made < count && t < attempts; t++) {
        var x = rng.range(300, S - 300), y = rng.range(300, S - 300);
        if (place(x, y)) made++;
      }
    }
    // Allocate a density budget per resolved cell, so excluded terrain is not
    // redistributed into the other biomes and overlap rules stay exact.
    function scatterBiome(base, property, place) {
      map.biomeCells.forEach(function (cell) {
        var density = W.Biomes.definitions[cell.id][property] || 0;
        var expected = base * area * cell.w * cell.h / (S * S) * density;
        var target = Math.floor(expected) + (rng.chance(expected % 1) ? 1 : 0);
        for (var made = 0, tries = 0; made < target && tries < target * 30; tries++) {
          if (place(rng.range(cell.x, cell.x + cell.w), rng.range(cell.y, cell.y + cell.h), cell.id)) made++;
        }
      });
    }

    // Equal arc-length spacing on the rounded coastline, including its curved corners.
    // A common seeded phase moves the whole ring without making individual spawn gaps uneven.
    var gx, gy, tries, x, y, inset = C.dropCoastInset, perimeter = edgeLength(inset);
    var drng = U.rng((seed ^ 0xa5b35705) >>> 0), phase = drng.next() * perimeter;
    var dropCount = C.dropStationCounts[teamSize];
    // A pad can serve more than one team in a no-fill lobby; reserve their coastal approaches too.
    var clearRadius = Math.max(C.dropStationRadius + 90, (Math.ceil(C.lobbySize / dropCount) - 1) * 250 + 110);
    for (var di = 0; di < dropCount; di++) {
      var distance = (phase + di * perimeter / dropCount) % perimeter, point = edgePoint(distance, inset);
      map.drops.push({ id: di, label: di + 1, x: point.x, y: point.y, r: C.dropStationRadius, edgeDistance: distance, clearRadius: clearRadius });
      occ.addCircle(point.x, point.y, clearRadius);
    }

    // Humvees use the outer red lane, artillery the middle yellow lane, and tanks
    // the inner blue lane. Reserve boarding space before generating any terrain.
    function spawnVehicles(type, count, salt, def, idOffset) {
      var lane = VEHICLE_RINGS[type], laneRng = U.rng((seed ^ salt) >>> 0), list = [];
      var phase = laneRng.range(-0.035, 0.035), parking = def.radius + C.playerRadius * 2 + 32;
      for (var i = 0; i < count; i++) {
        var fraction = (i + phase + laneRng.range(-0.02, 0.02)) / count;
        var point = ringPoint(fraction, S * (lane.inset + laneRng.range(-0.004, 0.004)), S * lane.corner);
        list.push({ id: idOffset + i + 1, type: type, x: point.x, y: point.y, angle: laneRng.range(0, U.TAU) });
        occ.addCircle(point.x, point.y, parking);
      }
      return { list: list, rng: laneRng };
    }
    var humvees = spawnVehicles('humvee', W.VEHICLE.count, 0x6e624eb7, W.VEHICLE, 0);
    var vrng = humvees.rng;
    map.vehicles = humvees.list;
    map.vehicles = vrng.shuffle(map.vehicles);
    map.vehicles.forEach(function (v, i) { v.id = i + 1; });
    map.tanks = spawnVehicles('tank', W.TANK.count, 0x3f98c671, W.TANK, W.VEHICLE.count).list;
    map.artillery = spawnVehicles('artillery', Math.min(4, W.ARTILLERY.count), 0x71ac438f, W.ARTILLERY, W.VEHICLE.count + W.TANK.count).list;

    // Keep a potential site in each box dry. Settlements are free to occupy any of
    // the boxes, and only the selected base footprints exclude the later scatter.
    var brng = U.rng((seed ^ 0x3197dfa3) >>> 0), potentialSites = new Occupancy();
    var centerReserve = militaryBase(S / 2, S / 2, 'center', true, S);
    reserveBase(potentialSites, centerReserve);
    var candidates = MILITARY_ZONES.map(function (zone) {
      var fraction = brng.range(.22, .78);
      return militaryBase((zone.x1 + fraction * (zone.x2 - zone.x1)) * S,
        (zone.y1 + fraction * (zone.y2 - zone.y1)) * S, zone.id, false, S);
    });
    candidates.forEach(function (base) { reserveBase(potentialSites, base); });

    // Two anchored cannons on opposite sides of each hand-drawn ring. Their own
    // seeded stream preserves crate rarity rolls and keeps every approach clear.
    var grng = U.rng((seed ^ 0x4c158ab3) >>> 0), groundDef = W.GROUND_ARTILLERY;
    var parking = groundDef.radius + C.playerRadius * 2 + 32;
    var groundId = W.VEHICLE.count + W.TANK.count + map.artillery.length;
    groundDef.rings.forEach(function (lane, ring) {
      var phase = grng.next(), points;
      for (var attempt = 0; attempt < 1024; attempt++) {
        var f = phase + attempt * .61803398875;
        points = [groundArtilleryRingPoint(ring, f), groundArtilleryRingPoint(ring, f + .5)];
        if (points.every(function (p) { return inside(p.x, p.y, parking) && occ.circleFree(p.x, p.y, parking) &&
          potentialSites.circleFree(p.x, p.y, parking); })) break;
      }
      if (attempt === 1024) throw new Error('No clear ground artillery position on ring ' + ring);
      points.forEach(function (p) {
        map.groundArtillery.push({ id: ++groundId, type: 'artillery', fixed: true, ring: ring, x: p.x, y: p.y, angle: grng.range(0, U.TAU) });
        occ.addCircle(p.x, p.y, parking);
      });
    });

    // Ponds slow players down.
    var pondTarget = scaledCount(rng.int(4, 6));
    for (tries = 0; map.ponds.length < pondTarget && tries < 500; tries++) {
      var pr = rng.range(150, 300);
      x = rng.range(600, S - 600); y = rng.range(600, S - 600);
      if (!inside(x, y, pr + 420) || !occ.circleFree(x, y, pr + 60) || !potentialSites.circleFree(x, y, pr + 60)) continue;
      var pond = { x: x, y: y, r: pr, pts: blob(rng, x, y, pr, 22, 0.12) };
      map.ponds.push(pond);
      // The query stamp belongs to a private proxy, never to the seeded map data.
      pondSpace.insert({ x: x, y: y, r: pr }, x - pr, y - pr, x + pr, y + pr);
      occ.addCircle(x, y, pr + 30);
    }

    // Settlements have a clear courtyard, inward-facing house entrances and a
    // reserved perimeter for their neutral guards. No other settlement types spawn.
    var srng = U.rng((seed ^ 0x28d7e3a1) >>> 0), names = {}, villageCount = srng.int(4, 6);
    var settlementKinds = ['town', 'town'];
    for (var village = 0; village < villageCount; village++) settlementKinds.push('village');
    var settlementVehicleId = Math.max.apply(null, [0].concat(map.vehicles, map.tanks, map.artillery, map.groundArtillery).map(function (v) { return v.id || 0; }));
    settlementKinds.forEach(function (kind) {
      var want = kind === 'village' ? srng.int(6, 12) : srng.int(20, 30), cols = Math.ceil(want / 2);
      var halfW = kind === 'town' ? 1800 : Math.max(900, (cols - 1) * 200 + 400), halfH = kind === 'town' ? 1800 : 760;
      var radius = Math.hypot(halfW, halfH), t;
      for (var attempt = 0; attempt < 3000; attempt++) {
        x = srng.range(radius + 500, S - radius - 500); y = srng.range(radius + 500, S - radius - 500);
        if (!inside(x, y, radius + 420) || !occ.rectFree(x - halfW - 100, y - halfH - 100, halfW * 2 + 200, halfH * 2 + 200) ||
          (Math.abs(x - centerReserve.x) < halfW + centerReserve.halfW + 100 && Math.abs(y - centerReserve.y) < halfH + centerReserve.halfH + 100) ||
          map.drops.some(function (drop) {
            var dx = Math.max(0, Math.abs(drop.x - x) - halfW), dy = Math.max(0, Math.abs(drop.y - y) - halfH);
            return Math.hypot(dx, dy) < drop.clearRadius + Math.max(W.ITEMS.sentry.range, W.ITEMS.sentry2.range, W.ITEMS.sentry3.range);
          }) ||
          map.towns.some(function (other) { return Math.hypot(other.x - x, other.y - y) < other.radius + radius + 400; })) continue;
        var name;
        do { name = srng.pick(PREFIX) + ' ' + srng.pick(SUFFIX) + (kind === 'village' ? ' Village' : ' Town'); } while (names[name]);
        names[name] = true;
        t = { id: map.towns.length, x: x, y: y, radius: radius, halfW: halfW, halfH: halfH,
          kind: kind, name: name, houseCount: want, buildingCount: want };
        map.towns.push(t);
        break;
      }
      if (!t) throw new Error('No clear settlement footprint for ' + kind);
      var slots = [];
      if (kind === 'village') {
        for (var i = 0; i < want; i++) slots.push({ x: (i % cols - (cols - 1) / 2) * 400, y: i < cols ? -340 : 340 });
      } else {
        var inner = [];
        for (var row = 0; row < 6; row++) for (var col = 0; col < 6; col++) {
          var slot = { x: (col - 2.5) * 500, y: (row - 2.5) * 500 };
          if (row === 0 || row === 5 || col === 0 || col === 5) slots.push(slot);
          else if (Math.abs(slot.x) > 250 || Math.abs(slot.y) > 250) inner.push(slot);
        }
        slots = slots.concat(srng.shuffle(inner)).slice(0, want);
      }
      var crateTiers;
      if (kind === 'village') {
        crateTiers = slots.map(function () { return 'common'; });
        crateTiers[srng.int(0, want - 1)] = want > 10 ? 'mythic' : 'epic';
      } else {
        crateTiers = srng.shuffle(['common','common','common','common','common','common','common','common','common','common','common',
          'rare','rare','rare','rare','rare','epic','epic','epic','mythic']);
        for (var extra = 20; extra < want; extra++) { var roll = srng.next(); crateTiers.push(roll < .75 ? 'common' : roll < .95 ? 'rare' : 'epic'); }
      }
      slots.forEach(function (slot, index) {
        var w = snap(srng.range(220, 280)), h = snap(srng.range(200, 240));
        var entrance = kind === 'village' ? (slot.y < 0 ? 'bottom' : 'top') :
          Math.abs(slot.x) > Math.abs(slot.y) ? (slot.x < 0 ? 'right' : 'left') : (slot.y < 0 ? 'bottom' : 'top');
        var b = makeBuilding(srng, map.buildings.length, t.x + slot.x - w / 2, t.y + slot.y - h / 2, w, h, entrance);
        b.kind = kind; b.style = 'house'; b.settlement = t.id; b.crateTier = crateTiers[index];
        b.ruined = kind === 'town' && srng.chance(.05);
        if (b.ruined) { b.walls = []; b.ruinSeed = srng.int(1, 2147483647); }
        map.buildings.push(b);
      });
      var directions = kind === 'village'
        ? [{ name: 'north', x: 0, y: -halfH + 140 }, { name: 'east', x: halfW - 140, y: 0 },
          { name: 'south', x: 0, y: halfH - 140 }, { name: 'west', x: -halfW + 140, y: 0 }]
        : [{ name: 'north', x: 0, y: -1600 }, { name: 'northeast', x: 1600, y: -1600 },
          { name: 'east', x: 1600, y: 0 }, { name: 'southeast', x: 1600, y: 1600 },
          { name: 'south', x: 0, y: 1600 }, { name: 'southwest', x: -1600, y: 1600 },
          { name: 'west', x: -1600, y: 0 }, { name: 'northwest', x: -1600, y: -1600 }];
      var upgraded = kind === 'village' ? (want === 12 ? 2 : want > 8 ? 1 : 0) : 0;
      var upgradeOrder = srng.shuffle([0, 1, 2, 3]);
      directions.forEach(function (direction, index) {
        var item = kind === 'town' ? (want === 30 ? 'sentry3' : 'sentry2') : (upgradeOrder.indexOf(index) < upgraded ? 'sentry2' : 'sentry');
        map.settlementStructures.push({ kind: 'sentry', item: item, x: t.x + direction.x, y: t.y + direction.y,
          angle: Math.atan2(direction.y, direction.x), bearing: direction.name, settlement: t.id, neutral: true });
      });
      map.settlementStructures.push({ kind: 'turret', item: kind === 'town' ? 'turret3' : 'turret',
        x: t.x + (kind === 'town' && teamSize > 1 ? 130 : 0), y: t.y, angle: 0, settlement: t.id, neutral: true });
      if (kind === 'town' && teamSize > 1) map.settlementVehicles.push({ id: ++settlementVehicleId, type: 'humvee',
        x: t.x - 130, y: t.y, angle: 0, armed: true, settlement: t.id, neutral: true });
      // Protect every house, doorway, guard and boarding approach from later scatter.
      occ.addRect(t.x - halfW, t.y - halfH, halfW * 2, halfH * 2, t);
    });

    var eligible = candidates.filter(function (base, index) {
      return !map.towns.some(function (town) { return settlementInMilitaryZone(town, MILITARY_ZONES[index], S); });
    });
    map.militaryBases.push(eligible.length ? militaryBase(S / 2, S / 2, 'center', false, S) : centerReserve);
    if (eligible.length) map.militaryBases.push(brng.pick(eligible));
    map.militaryBases.forEach(function (base) { reserveBase(occ, base); });

    // Upgrade stations: one per cell of a jittered grid, topped up randomly if a cell was blocked.
    function addStation(sx, sy) {
      var station = { id: map.stations.length, number: map.stations.length + 1, x: sx, y: sy, cooldown: 0 };
      map.stations.push(station);
      occ.addCircle(sx, sy, 92);
      return station;
    }
    function stationFits(sx, sy) { return inside(sx, sy, 360) && occ.circleFree(sx, sy, 96) && !near(map.stations, sx, sy, C.stationMinGap); }
    var sm = 520, sgrid = Math.max(1, Math.round(Math.sqrt(C.stationCount))), scell = (S - sm * 2) / sgrid;
    for (gy = 0; gy < sgrid && map.stations.length < C.stationCount; gy++) {
      for (gx = 0; gx < sgrid && map.stations.length < C.stationCount; gx++) {
        for (tries = 0; tries < 80; tries++) {
          x = sm + (gx + rng.range(0.15, 0.85)) * scell;
          y = sm + (gy + rng.range(0.15, 0.85)) * scell;
          if (stationFits(x, y)) { addStation(x, y); break; }
        }
      }
    }
    for (tries = 0; map.stations.length < C.stationCount && tries < 8000; tries++) {
      x = rng.range(500, S - 500); y = rng.range(500, S - 500);
      if (stationFits(x, y)) addStation(x, y);
    }

    scatterBiome(140, 'rockDensity', function (rx, ry, biome) {
      var r = rng.range(26, 66);
      if (!inside(rx, ry, 300 + r) || !occ.circleFree(rx, ry, r + 26)) return false;
      map.rocks.push({ x: rx, y: ry, r: r, biome: biome, pts: blob(rng, rx, ry, r, rng.int(7, 10), 0.16), shine: rng.range(0, U.TAU) });
      occ.addCircle(rx, ry, r + 10);
      return true;
    });
    scatterBiome(300, 'treeDensity', function (tx, ty, biome) {
      var r = rng.range(68, 112);
      if (!inside(tx, ty, 280 + r * 0.5) || !occ.circleFree(tx, ty, r * 0.55)) return false;
      if (near(map.stations, tx, ty, r + 70) || near(map.drops, tx, ty, r + C.dropStationRadius + 10)) return false;
      map.trees.push({ id: map.trees.length, x: tx, y: ty, r: r, trunk: Math.max(14, r * 0.17), variant: rng.int(0, 11), rot: rng.range(0, U.TAU), fade: 1,
        biome: biome, conceals: biome === 'forest' || biome === 'tundra-forest' || biome === 'savannah', alive: true });
      occ.addCircle(tx, ty, r * 0.5, map.trees[map.trees.length - 1]);
      return true;
    });
    if (C.bushes) {
      scatterBiome(170, 'bushDensity', function (bx, by, biome) {
        var r = rng.range(32, 50);
        if (!inside(bx, by, 280) || !occ.circleFree(bx, by, r * 0.8) || near(map.stations, bx, by, r + 60)) return false;
        map.bushes.push({ x: bx, y: by, r: r, biome: biome, variant: rng.int(0, 7), rot: rng.range(0, U.TAU), fade: 1 });
        occ.addCircle(bx, by, r * 0.7, map.bushes[map.bushes.length - 1]);
        return true;
      });
    }
    map.biomeCells.forEach(function (cell) {
      if (cell.id !== 'desert' && cell.id !== 'savannah') return;
      var target = Math.round(120 * area * cell.w * cell.h / (S * S));
      for (var made = 0, attempt = 0; made < target && attempt < target * 30; attempt++) {
        x = rng.range(cell.x, cell.x + cell.w); y = rng.range(cell.y, cell.y + cell.h);
        var r = rng.range(22, 34);
        if (!inside(x, y, 320) || !occ.circleFree(x, y, r + 30)) continue;
        map.cacti.push({ id: map.cacti.length, x: x, y: y, r: r, hp: 50, maxHp: 50, alive: true, biome: cell.id, variant: rng.int(0, 2) });
        occ.addCircle(x, y, r + 15); made++;
      }
    });

    // Crates (tiered: tokens, sometimes an armor plate or a key, and items by rarity) and loose pickups.
    function addCrate(cx, cy, tier) {
      tier = tier || 'common';
      var hp = W.CRATES[tier].hp;
      var crate = { id: map.crates.length, x: cx, y: cy, size: C.crateSize * (tier === 'classToken' ? 1.5 : 1), tier: tier, hp: hp, maxHp: hp, alive: true, shake: 0 };
      map.crates.push(crate);
      return crate;
    }
    function addPickup(type, px, py, amount) {
      map.pickups.push({ id: map.nextPickupId++, type: type, x: px, y: py, amount: amount || 1, alive: true, age: rng.range(0, 6), vx: 0, vy: 0 });
    }
    map.buildings.forEach(function (b) {
      var spots = [], tries2;
      function free(px, py, gap) {
        for (var i = 0; i < spots.length; i++) if (Math.hypot(spots[i].x - px, spots[i].y - py) < gap) return false;
        return true;
      }
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2, houseCrate = addCrate(cx, cy, b.crateTier);
      houseCrate.building = b.id; houseCrate.settlement = b.settlement;
      spots.push({ x: cx, y: cy });
      var loot = [];
      if (rng.chance(0.55)) loot.push('token');
      if (rng.chance(0.06)) loot.push('key');
      for (tries2 = 0; tries2 < 40 && loot.length; tries2++) {
        var lx = rng.range(b.x + WALL + 30, b.x + b.w - WALL - 30), ly = rng.range(b.y + WALL + 30, b.y + b.h - WALL - 30);
        if (!free(lx, ly, 54)) continue;
        spots.push({ x: lx, y: ly });
        addPickup(loot.pop(), lx, ly, 1);
      }
    });
    function outdoorCrates(cx, cy) {
      if (!inside(cx, cy, 320) || inPond(cx, cy, 40)) return false;
      // Mostly single crates, sometimes a pair 74 apart so two 52-wide crates never overlap, even diagonally.
      var n = Math.min(C.regularCrateCount - map.crates.length, rng.chance(0.25) ? 2 : 1), a = rng.range(0, U.TAU), spots = [];
      for (var i = 0; i < n; i++) {
        var px = cx + (i ? Math.cos(a + i * 1.7) * 74 : 0), py = cy + (i ? Math.sin(a + i * 1.7) * 74 : 0);
        if (occ.circleFree(px, py, 44) && !inPond(px, py, 40)) spots.push([px, py]);
        else if (!i) return false;
      }
      spots.forEach(function (s) { addCrate(s[0], s[1]); occ.addCircle(s[0], s[1], 40); });
      return true;
    }
    for (tries = 0; map.crates.length < C.regularCrateCount && tries < 14000; tries++) {
      outdoorCrates(rng.range(300, S - 300), rng.range(300, S - 300));
    }
    // A deterministic fallback makes the promised crate count independent of
    // random placement luck, without putting crates inside occupied terrain.
    for (y = 380; map.crates.length < C.regularCrateCount && y < S - 380; y += 160) {
      for (x = 380; map.crates.length < C.regularCrateCount && x < S - 380; x += 160) outdoorCrates(x, y);
    }
    // House rewards stay fixed. Only outdoor crates enter the ordinary rarity deck.
    var outdoor = map.crates.filter(function (crate) { return crate.building === undefined; });
    var quota = W.Rules.crateQuota(outdoor.length + 1), deck = [];
    W.CRATE_ORDER.forEach(function (tier) { if (tier !== 'legendary') for (var q = 0; q < (quota[tier] || 0); q++) deck.push(tier); });
    rng.shuffle(deck).forEach(function (tier, idx) {
      var cr = outdoor[idx];
      cr.tier = tier;
      cr.hp = cr.maxHp = W.CRATES[tier].hp;
    });
    map.legendaryCrateId = map.crates.length;
    addCrate(S / 2, S / 2, 'legendary');
    map.towns.forEach(function (town) {
      if (town.kind !== 'town' || town.houseCount !== 30) return;
      var bonus = addCrate(town.x, town.y + 240, 'legendary');
      bonus.settlement = town.id; bonus.legendaryDrops = 1;
      town.legendaryCrateId = bonus.id;
    });
    map.militaryBases.forEach(function (base) {
      settlementVehicleId = populateBase(map, base, brng, settlementVehicleId, addStation, addCrate);
    });
    scatter(C.tokenLoose, 4000, function (px, py) {
      if (!inside(px, py, 300) || !occ.circleFree(px, py, 22) || inPond(px, py, 20)) return false;
      addPickup('token', px, py, 1);
      occ.addCircle(px, py, 18);
      return true;
    });
    scatter(C.keyLoose, 2000, function (px, py) {
      if (!inside(px, py, 320) || !occ.circleFree(px, py, 26) || inPond(px, py, 20)) return false;
      addPickup('key', px, py, 1);
      occ.addCircle(px, py, 20);
      return true;
    });

    // Ground decoration only (no collision).
    for (var d = 0, patchCount = scaledCount(650); d < patchCount; d++) {
      map.patches.push({ x: rng.range(200, S - 200), y: rng.range(200, S - 200), r: rng.range(40, 130), light: rng.chance(0.45) });
    }
    for (var tuftAttempts = scaledCount(1100), d = 0; d < tuftAttempts; d++) {
      x = rng.range(250, S - 250); y = rng.range(250, S - 250);
      if (inside(x, y, 260) && !inPond(x, y, 10)) map.tufts.push({ x: x, y: y, s: rng.range(0.7, 1.3), flower: rng.chance(0.12) ? rng.pick(['#fff4f0', '#ffe066', '#ff9ec7']) : null });
    }
    map.trenches = generateTrenches(map, occ);
    return map;
  }

  W.MapGen = { generate: generate, inside: inside, edgePoint: edgePoint, edgeLength: edgeLength,
    militaryZones: MILITARY_ZONES, settlementInMilitaryZone: settlementInMilitaryZone,
    vehicleRings: VEHICLE_RINGS, vehicleRingPoint: vehicleRingPoint, groundArtilleryRingPoint: groundArtilleryRingPoint, WALL: WALL, DOOR: DOOR };
}());
