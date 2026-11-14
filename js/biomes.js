/* Seeded biome regions follow the annotated map in normalized island coordinates. */
(function () {
  'use strict';
  var W = window.Warz;
  var definitions = {
    normal: { name: 'Wildlands', color: '#8eb865', treeDensity: 1, bushDensity: 1, rockDensity: 1 },
    tundra: { name: 'Tundra', color: '#e3edf0', treeDensity: 0.35, bushDensity: 0.5, rockDensity: 1 },
    forest: { name: 'Forest', color: '#527d46', treeDensity: 2, bushDensity: 3, rockDensity: 1 },
    grassland: { name: 'Grasslands', color: '#acd077', treeDensity: 0.2, bushDensity: 0, rockDensity: 1 / 3 },
    desert: { name: 'Desert', color: '#e4c47e', treeDensity: 0, bushDensity: 0, rockDensity: 0.5 },
    'tundra-forest': { name: 'Tundra Forest', color: '#b7cfc5', treeDensity: 2, bushDensity: 3, rockDensity: 1 },
    savannah: { name: 'Savannah', color: '#c6bc68', treeDensity: 0.12, bushDensity: 0.65, rockDensity: 0.1 }
  };
  // [left, top, right, bottom]. Green is forest; blue is grassland (the final legend).
  var candidates = {
    tundra: [[.02,.045,.37,.41], [.59,.025,.88,.36], [.815,.34,.985,.65], [.765,.615,.97,.975]],
    forest: [[.22,.085,.64,.39], [.365,.31,.56,.665], [.125,.325,.395,.68]],
    grassland: [[.075,.62,.385,.91], [.325,.48,.515,.665]],
    desert: [[.56,.435,.755,.705], [.335,.66,.755,.98]]
  };
  function generate(seed, size) {
    var rng = W.U.rng((seed ^ 0x72b6a531) >>> 0), regions = [];
    Object.keys(candidates).forEach(function (id) {
      var choices = candidates[id].map(function (bounds, index) { return { bounds: bounds, index: index }; });
      var count = id === 'tundra' ? 2 : 1;
      rng.shuffle(choices).slice(0, count).forEach(function (choice) {
        var b = choice.bounds;
        regions.push({ id: id, candidate: choice.index, x: b[0] * size, y: b[1] * size,
          w: (b[2] - b[0]) * size, h: (b[3] - b[1]) * size });
      });
    });
    return regions;
  }
  function at(map, x, y) {
    var active = {};
    (map.biomes || []).forEach(function (r) {
      if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) active[r.id] = true;
    });
    // Grassland and forest cancel back to the original terrain. Any third region remains.
    if (active.forest && active.grassland) { delete active.forest; delete active.grassland; }
    if (active.tundra) return active.forest ? 'tundra-forest' : 'tundra';
    if (active.desert) return active.grassland ? 'savannah' : 'desert';
    if (active.forest) return 'forest';
    return active.grassland ? 'grassland' : 'normal';
  }
  function cells(map) {
    if (!map.biomes || !map.biomes.length) return [{ id: 'normal', x: 0, y: 0, w: map.size, h: map.size }];
    var xs = [0, map.size], ys = [0, map.size], result = [];
    map.biomes.forEach(function (r) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); });
    function unique(values) { return values.sort(function (a, b) { return a - b; }).filter(function (v, i, all) { return !i || v !== all[i - 1]; }); }
    xs = unique(xs); ys = unique(ys);
    for (var yi = 0; yi < ys.length - 1; yi++) for (var xi = 0; xi < xs.length - 1; xi++) {
      var x = xs[xi], y = ys[yi], w = xs[xi + 1] - x, h = ys[yi + 1] - y;
      result.push({ id: at(map, x + w / 2, y + h / 2), x: x, y: y, w: w, h: h });
    }
    return result;
  }
  W.Biomes = { definitions: definitions, candidates: candidates, generate: generate, at: at, cells: cells };
}());
