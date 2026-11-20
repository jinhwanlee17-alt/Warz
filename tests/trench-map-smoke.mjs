// The collision rim, ground art and artillery map all follow the same seeded excavation.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'map-art', 'render']);
const t = suite('Trench terrain'), T = W.Trenches;
const seen = new Set();
let first;
for (const [seed, teamSize] of [[1, 1], [42, 2], [57, 3], [79, 4], [991, 1]]) {
  const m = W.MapGen.generate(seed, teamSize);
  first ??= m.trenches;
  const biomes = new Set(m.biomeCells.filter(c => c.w > 1 && c.h > 1).map(c => c.id));
  const runs = m.trenches;
  for (const biome of biomes) {
    seen.add(biome);
    t.check(runs.some(r => r.biome === biome && W.Biomes.at(m, r.x, r.y) === biome), 'every resolved biome contains a trench: ' + seed + ' ' + biome);
  }
  t.check(runs.every((r, i) => r.id === i + 1 && r.width === T.width && r.points.length === 16 &&
    r.outline.every(p => W.MapGen.inside(p.x, p.y, W.CONFIG.beach))), 'uniform trenches stay on dry land with stable IDs ' + seed);
  t.check(runs.every(r => T.at(m, r.x, r.y) === r), 'all centers resolve to the right trench ' + seed);
  t.check(runs.some((r, i) => runs.slice(i + 1).some(s => Math.hypot(r.x - s.x, r.y - s.y) < 710)), 'trenches form groups ' + seed);
  t.check(runs.some(r => runs.every(s => s === r || Math.hypot(r.x - s.x, r.y - s.y) > 710)), 'some positions are isolated ' + seed);
  for (const [label, objects] of Object.entries({ trees: m.trees, bushes: m.bushes, rocks: m.rocks, ponds: m.ponds, cacti: m.cacti,
    drops: m.drops, crates: m.crates, stations: m.stations, tanks: m.tanks, artillery: m.artillery })) {
    t.check(objects.every(o => !T.near(m, o.x, o.y, o.trunk || (label === 'trees' ? 14 : o.r) || 25)), 'clear of ' + label + ' ' + seed);
  }
  t.check(runs.every(r => r.points.every(p => !m.buildings.some(b => p.x > b.x - T.width && p.x < b.x + b.w + T.width &&
    p.y > b.y - T.width && p.y < b.y + b.h + T.width))), 'trenches leave room around buildings ' + seed);
}
t.equal(seen.size, Object.keys(W.Biomes.definitions).length, 'coverage includes all seven biomes');
t.equal(JSON.stringify(first), JSON.stringify(W.MapGen.generate(1, 1).trenches), 'same seed and mode regenerate identical geometry');
const walkLength = first[0].points.reduce((total, p, i, points) => i ? total + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0, 0);
t.check(walkLength > 1750 && T.width >= 106, 'the usable course is over twice as long as the original and has a wider floor');
t.check(T.width < W.TANK.width && T.width < W.ARTILLERY.width && T.width > W.CONFIG.playerRadius * 2,
  'one player fits between banks, while tracked vehicles span the opening');
t.equal(T.at({}, 0, 0), null, 'legacy maps without trenches are surface ground');
t.equal(T.wireAt({}, 0, 0, 24), null, 'legacy maps without wire stay traversable');
for (const seed of [82, 99, 303]) {
  const m = W.MapGen.generate(seed, 1 + seed % 4);
  t.check(m.trenches.some(run => W.Biomes.at(m, run.x, run.y) === 'savannah'),
    'narrow savannah overlaps still receive a full wired run: seed ' + seed);
}

for (const angle of [0, .77, 2.2, 4]) {
  const r = T.create(1, 1000, 1000, angle, 'normal'), map = { trenches: [r] };
  t.check(r.wires.length === 8 && r.wires.every(wire => {
    const x = (wire.a.x + wire.b.x) / 2, y = (wire.a.y + wire.b.y) / 2;
    return !T.at(map, x, y) && T.wireAt(map, x, y, 0) === wire && T.wall(r, x, y).distance >= 32.99;
  }), 'separate wire sections sit outside the lip and share the rendered geometry');
  t.check(r.points.every(p => !T.wireAt(map, p.x, p.y, W.CONFIG.playerRadius)), 'the floor is clear of all wire');
  const wire = r.wires[0], dx = wire.b.x - wire.a.x, dy = wire.b.y - wire.a.y, len = Math.hypot(dx, dy);
  const x = (wire.a.x + wire.b.x) / 2, y = (wire.a.y + wire.b.y) / 2, reach = T.wireRadius + W.CONFIG.playerRadius;
  t.equal(T.wireAt(map, x - dy / len * (reach - 1), y + dx / len * (reach - 1), W.CONFIG.playerRadius), wire, 'feet brushing the coil count');
  t.equal(T.wireAt(map, x - dy / len * (reach + 1), y + dx / len * (reach + 1), W.CONFIG.playerRadius), null, 'beyond the coil the infantry footprint clears it');
  t.equal(T.wireAt(map, wire.b.x + dx / len * 44, wire.b.y + dy / len * 44, W.CONFIG.playerRadius), null, 'gaps after wired sections admit infantry');
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1], b = r.points[i], x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    const wall = T.wall(r, x, y);
    t.near(wall.distance, T.width / 2, .000001, 'straight and diagonal bays have the same usable width');
    const outside = { x: wall.x + wall.nx * 5, y: wall.y + wall.ny * 5 };
    t.equal(T.at(map, outside.x, outside.y), null, 'immediately beyond a wall is surface');
    t.equal(T.near(map, outside.x, outside.y, 6), r, 'surface-side approach finds its wall');
    t.equal(T.at(map, wall.x - wall.nx, wall.y - wall.ny), r, 'inside of a lip resolves to its trench');
  }
  for (const p of r.outline) {
    const wall = T.wall(r, p.x, p.y);
    t.check(!T.contains(r, p.x + 4 * wall.nx, p.y + 4 * wall.ny) && T.contains(r, p.x - 4 * wall.nx, p.y - 4 * wall.ny),
      'corner normal works on both sides of every turn and squared end');
  }

  const ux = dx / len, uy = dy / len, tankRadius = W.TANK.radius;
  function drive(x1, y1, x2, y2) {
    const hits = [];
    T.wiresAlong(map, x1, y1, x2, y2, tankRadius, (id, index) => hits.push(id + '/' + index));
    return hits.sort().join(',');
  }
  t.equal(drive(x - uy * 600, y + ux * 600, x + uy * 600, y - ux * 600), '1/0',
    'driving through the middle catches a coil even when both tank endpoints are far clear');
  t.equal(drive(x - ux * 1400, y - uy * 1400, x + ux * 2400, y + uy * 2400), '1/0,1/1,1/4,1/5',
    'long sweeping contact finds each section exactly once, including adjacent bays within hull reach');
  for (const [offset, expected] of [[-1, true], [1, false]]) {
    const edge = tankRadius + T.wireRadius + offset, ex = wire.a.x - ux * edge, ey = wire.a.y - uy * edge;
    t.equal(drive(ex, ey, ex, ey).includes('1/0'), expected, 'a stationary footprint tests the rounded wire end');
    const sx = x - uy * edge, sy = y + ux * edge;
    t.equal(drive(sx, sy, sx, sy).includes('1/0'), expected, 'tank contact includes the visible half-width along a wire');
  }
  t.check(T.crushWire(map, 1, 0) && wire.destroyed && map.wireVersion === 1, 'crushing marks the wire and invalidates cached terrain');
  t.check(!T.crushWire(map, 1, 0) && !T.crushWire(map, 1, 8) && !T.crushWire(map, 2, 0) && map.wireVersion === 1,
    'duplicate or unknown wire destruction leaves the terrain revision stable');
  t.equal(T.wireAt(map, x, y, W.CONFIG.playerRadius), null, 'the removed coil no longer slows or damages infantry');
  t.equal(drive(x - uy * 600, y + ux * 600, x + uy * 600, y - ux * 600), '', 'a repeat crossing cannot ram a removed wire');
  const neighbor = r.wires[1];
  t.equal(T.wireAt(map, (neighbor.a.x + neighbor.b.x) / 2, (neighbor.a.y + neighbor.b.y) / 2, 0), neighbor,
    'untouched sections keep their original indices and infantry contacts');
}

// Verify map targeting and main-view art draw the generated course.
const trench = first[0], lines = [];
let coils = 0;
const ctx = new Proxy({ measureText: () => ({ width: 0 }) }, {
  get(target, key) {
    if (key in target) return target[key];
    return (...coords) => { if (key === 'lineTo' || key === 'moveTo') lines.push(coords); if (key === 'bezierCurveTo') coils++; };
  }
});
const sparse = { size: 48000, coast: [0, 0, 48000, 0, 48000, 48000], trenches: [trench],
  trees: [], ponds: [], buildings: [], drops: [], towns: [] };
function traced(points) { return points.every(p => lines.some(([x, y]) => x === p.x && y === p.y)); }
W.MapArt.paintBase(ctx, sparse, 900, { big: true });
t.check(traced(trench.points), 'shared map art traces every centerline turn');
t.check(trench.wires.every(wire => traced([wire.a, wire.b])), 'detailed maps mark only the actual wire spans');
lines.length = 0;
W.Renderer.prototype.drawTrench(ctx, trench);
t.check(traced(trench.outline) && traced(trench.points), 'world view draws the actual banks and recessed floor');
t.check(coils >= 4 * trench.wires.length, 'ground view draws coiled strands beside the bays');
t.done();
