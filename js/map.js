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

  function Occupancy() { this.hash = new U.SpatialHash(256); }
  Occupancy.prototype.addCircle = function (x, y, r) {
    this.hash.insert({ k: 0, x: x, y: y, r: r }, x - r, y - r, x + r, y + r);
  };
  Occupancy.prototype.addRect = function (x, y, w, h) {
    this.hash.insert({ k: 1, x: x, y: y, w: w, h: h }, x, y, x + w, y + h);
  };
  Occupancy.prototype.circleFree = function (x, y, r) {
    var free = true;
    this.hash.query(x - r, y - r, x + r, y + r, function (it) {
      if (!free) return;
      if (it.k === 0) {
        if (Math.hypot(it.x - x, it.y - y) < it.r + r) free = false;
      } else {
        var nx = U.clamp(x, it.x, it.x + it.w), ny = U.clamp(y, it.y, it.y + it.h);
        if (Math.hypot(x - nx, y - ny) < r) free = false;
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

  function makeBuilding(rng, id, x, y, w, h) {
    var walls = [], sides = rng.shuffle(['top', 'bottom', 'left', 'right']);
    var doors = sides.slice(0, rng.chance(0.55) ? 2 : 1), doorSet = {};
    doors.forEach(function (d) { doorSet[d] = true; });
    function horizontal(yy, door) {
      if (!door) { walls.push({ x: x, y: yy, w: w, h: WALL }); return; }
      var dx = x + WALL + rng.range(30, w - WALL * 2 - DOOR - 30);
      walls.push({ x: x, y: yy, w: dx - x, h: WALL });
      walls.push({ x: dx + DOOR, y: yy, w: x + w - dx - DOOR, h: WALL });
    }
    function vertical(xx, door) {
      var top = y + WALL, len = h - WALL * 2;
      if (!door) { walls.push({ x: xx, y: top, w: WALL, h: len }); return; }
      var dy = top + rng.range(26, len - DOOR - 26);
      walls.push({ x: xx, y: top, w: WALL, h: dy - top });
      walls.push({ x: xx, y: dy + DOOR, w: WALL, h: top + len - dy - DOOR });
    }
    horizontal(y, doorSet.top);
    horizontal(y + h - WALL, doorSet.bottom);
    vertical(x, doorSet.left);
    vertical(x + w - WALL, doorSet.right);
    return {
      id: id, x: x, y: y, w: w, h: h, walls: walls, doors: doors,
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

  function generate(seed, teamSize) {
    seed = (seed >>> 0) || 1;
    teamSize = teamSize === 2 || teamSize === 3 || teamSize === 4 ? teamSize : 1;
    var rng = U.rng(seed), S = C.worldSize, area = C.mapAreaScale || 1, occ = new Occupancy();
    // Area can be fractional: round each density target once to the nearest item.
    function scaledCount(count) { return Math.round(count * area); }
    var map = {
      seed: seed, teamSize: teamSize, size: S, coast: null, ponds: [], patches: [], tufts: [], towns: [], buildings: [],
      rocks: [], trees: [], bushes: [], cacti: [], crates: [], stations: [], drops: [], vehicles: [], tanks: [], artillery: [], groundArtillery: [], pickups: [], nextPickupId: 1
    };
    map.biomes = W.Biomes.generate(seed, S);
    map.biomeCells = W.Biomes.cells(map);
    map.coast = coastline(rng, C.beach, 34);
    // Reserve the centre before any terrain, building, station or spawn is placed.
    // The legendary crate can always be approached from every direction.
    occ.addCircle(S / 2, S / 2, C.legendaryClearRadius);

    function near(list, x, y, d) {
      for (var i = 0; i < list.length; i++) if (Math.hypot(list[i].x - x, list[i].y - y) < d) return true;
      return false;
    }
    var pondSpace = new U.SpatialHash(512);
    function inPond(x, y, pad) {
      var found = false;
      pondSpace.query(x - pad, y - pad, x + pad, y + pad, function (p) {
        if (Math.hypot(p.x - x, p.y - y) < p.r + pad) found = true;
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
        if (points.every(function (p) { return inside(p.x, p.y, parking) && occ.circleFree(p.x, p.y, parking); })) break;
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
      if (!inside(x, y, pr + 420) || !occ.circleFree(x, y, pr + 60)) continue;
      var pond = { x: x, y: y, r: pr, pts: blob(rng, x, y, pr, 22, 0.12) };
      map.ponds.push(pond);
      // The query stamp belongs to a private proxy, never to the seeded map data.
      pondSpace.insert({ x: x, y: y, r: pr }, x - pr, y - pr, x + pr, y + pr);
      occ.addCircle(x, y, pr + 30);
    }

    // Distinct settlements: small villages, denser towns/cities, stone castles
    // and regimented military compounds. Reserve their full footprint first.
    var names = {}, settlementKinds = ['village','village','village','village','village','village',
      'small-town','small-town','small-town','city','city','castle','castle','military-base','military-base'];
    var settlementNames = { village: 'Village', 'small-town': 'Town', city: 'City', castle: 'Castle', 'military-base': 'Base' };
    settlementKinds.forEach(function (kind) {
      var radius = kind === 'city' ? 2300 : kind === 'small-town' || kind === 'military-base' ? 1800 : 1500;
      for (var attempt = 0; attempt < 3000; attempt++) {
        x = rng.range(radius + 600, S - radius - 600); y = rng.range(radius + 600, S - radius - 600);
        if (!inside(x, y, radius + 500) || !occ.rectFree(x - radius, y - radius, radius * 2, radius * 2) ||
          map.towns.some(function (t) { return Math.hypot(t.x - x, t.y - y) < t.radius + radius + 500; })) continue;
        var name;
        do { name = rng.pick(PREFIX) + ' ' + rng.pick(SUFFIX) + ' ' + settlementNames[kind]; } while (names[name]);
        names[name] = true;
        map.towns.push({ id: map.towns.length, x: x, y: y, radius: radius, kind: kind, name: name });
        break;
      }
    });
    function tryBuilding(bx, by, w, h) {
      var pad = 80;
      if (!inside(bx, by, 420) || !inside(bx + w, by, 420) || !inside(bx, by + h, 420) || !inside(bx + w, by + h, 420)) return false;
      if (!occ.rectFree(bx - pad, by - pad, w + pad * 2, h + pad * 2)) return false;
      map.buildings.push(makeBuilding(rng, map.buildings.length, bx, by, w, h));
      occ.addRect(bx - 30, by - 30, w + 60, h + 60);
      return true;
    }
    map.towns.forEach(function (t) {
      var want = t.kind === 'village' ? rng.int(7, 12) : t.kind === 'small-town' ? rng.int(14, 20) :
        t.kind === 'city' ? rng.int(28, 36) : t.kind === 'castle' ? 9 : rng.int(10, 14);
      var cols = t.kind === 'city' ? 6 : t.kind === 'small-town' ? 5 : 4, rows = Math.ceil(want / cols), pitch = 600;
      t.buildingCount = 0;
      for (var k = 0; k < want; k++) {
        var w = snap(rng.range(260, 400)), h = snap(rng.range(240, 360)), style = 'house';
        var ox = (k % cols - (cols - 1) / 2) * pitch, oy = (Math.floor(k / cols) - (rows - 1) / 2) * pitch;
        if (t.kind === 'castle') {
          var positions = [[0,0],[-950,-950],[950,-950],[-950,950],[950,950],[0,-950],[0,950],[-950,0],[950,0]];
          ox = positions[k][0]; oy = positions[k][1]; style = k === 0 ? 'keep' : k < 5 ? 'tower' : 'gatehouse';
          w = h = k === 0 ? 600 : k < 5 ? 260 : 340;
        } else if (t.kind === 'military-base') { style = k === 0 ? 'command' : k < 3 ? 'hangar' : 'barracks'; w = 420; h = 300; }
        if (tryBuilding(t.x + ox - w / 2, t.y + oy - h / 2, w, h)) {
          var building = map.buildings[map.buildings.length - 1];
          building.kind = t.kind; building.style = style; building.settlement = t.id;
          if (t.kind === 'castle') building.roof = '#727a88';
          if (t.kind === 'military-base') building.roof = k < 3 ? '#6b7770' : '#657348';
          t.buildingCount++;
        }
      }
    });
    for (var k = 0, extra = 0; k < 600 && extra < 12; k++) {
      var bw = snap(rng.range(240, 380)), bh = snap(rng.range(220, 320));
      if (tryBuilding(rng.range(500, S - 500 - bw), rng.range(500, S - 500 - bh), bw, bh)) extra++;
    }

    // Upgrade stations: one per cell of a jittered grid, topped up randomly if a cell was blocked.
    function addStation(sx, sy) {
      map.stations.push({ id: map.stations.length, number: map.stations.length + 1, x: sx, y: sy, cooldown: 0 });
      occ.addCircle(sx, sy, 92);
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
      occ.addCircle(tx, ty, r * 0.5);
      return true;
    });
    if (C.bushes) {
      scatterBiome(170, 'bushDensity', function (bx, by, biome) {
        var r = rng.range(32, 50);
        if (!inside(bx, by, 280) || !occ.circleFree(bx, by, r * 0.8) || near(map.stations, bx, by, r + 60)) return false;
        map.bushes.push({ x: bx, y: by, r: r, biome: biome, variant: rng.int(0, 7), rot: rng.range(0, U.TAU), fade: 1 });
        occ.addCircle(bx, by, r * 0.7);
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
      map.crates.push({ id: map.crates.length, x: cx, y: cy, size: C.crateSize, tier: tier, hp: hp, maxHp: hp, alive: true, shake: 0 });
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
      var crates = map.crates.length < C.regularCrateCount && rng.chance(C.crateInBuilding) ? 1 : 0;
      for (tries2 = 0; tries2 < 40 && crates > 0; tries2++) {
        var cx = rng.range(b.x + WALL + 40, b.x + b.w - WALL - 40), cy = rng.range(b.y + WALL + 40, b.y + b.h - WALL - 40);
        if (!free(cx, cy, 76)) continue;
        spots.push({ x: cx, y: cy }); addCrate(cx, cy); crates--;
      }
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
    // Only regular crates enter the 80/10/8/2 deck. The legendary is never
    // shuffled into a building: it is the single crate at the island centre.
    var quota = W.Rules.crateQuota(map.crates.length + 1), deck = [];
    W.CRATE_ORDER.forEach(function (tier) { if (tier !== 'legendary') for (var q = 0; q < (quota[tier] || 0); q++) deck.push(tier); });
    rng.shuffle(deck).forEach(function (tier, idx) {
      var cr = map.crates[idx];
      cr.tier = tier;
      cr.hp = cr.maxHp = W.CRATES[tier].hp;
    });
    map.legendaryCrateId = map.crates.length;
    addCrate(S / 2, S / 2, 'legendary');
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
    return map;
  }

  W.MapGen = { generate: generate, inside: inside, edgePoint: edgePoint, edgeLength: edgeLength,
    vehicleRings: VEHICLE_RINGS, vehicleRingPoint: vehicleRingPoint, groundArtilleryRingPoint: groundArtilleryRingPoint, WALL: WALL, DOOR: DOOR };
}());
