// Vehicle lanes from the annotated map: independent geometry and real boarding clearance.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(), t = suite('Vehicle spawn lanes');
const C = W.CONFIG, S = C.worldSize;
const lanes = [
  { field: 'vehicles', type: 'humvee', count: 8, inset: .055, corner: .075 },
  { field: 'artillery', type: 'artillery', count: 4, inset: .15, corner: .055 },
  { field: 'tanks', type: 'tank', count: 4, inset: .28, corner: .035 }
];
// Signed distance to a rounded square, independently of the generator's path parameterization.
function laneDistance(v, lane) {
  const half = .5 - lane.inset;
  const qx = Math.abs(v.x / S - .5) - half + lane.corner;
  const qy = Math.abs(v.y / S - .5) - half + lane.corner;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - lane.corner;
}
function side(v) {
  const dx = v.x - S / 2, dy = v.y - S / 2;
  return Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'east' : 'west' : dy > 0 ? 'south' : 'north';
}
let varied = false;
const baselines = new Map();
for (const teamSize of [1, 2, 3, 4]) for (const seed of [1, 42, 57, 9001, 123456, 0xffffffff]) {
  const map = W.MapGen.generate(seed, teamSize), world = new W.World({ map, teams: teamSize > 1, storm: false });
  if (seed === 1) baselines.set(teamSize, map);
  const regenerated = W.MapGen.generate(seed, teamSize);
  const tag = 'mode ' + teamSize + ' seed ' + seed;
  for (const lane of lanes) {
    const list = map[lane.field], sides = new Map();
    t.equal(list.length, lane.count, tag + ': requested ' + lane.type + ' count');
    // A 0.004 inset shift moves a corner in both axes, up to sqrt(2) * 0.004.
    t.check(list.every(v => Math.abs(laneDistance(v, lane)) <= .006), tag + ': ' + lane.type + ' follows its rounded-square line');
    for (const v of list) sides.set(side(v), (sides.get(side(v)) || 0) + 1);
    t.check(sides.size === 4 && [...sides.values()].every(n => n === lane.count / 4), tag + ': ' + lane.type + ' spread evenly over all four sides');
    t.equal(JSON.stringify(list), JSON.stringify(regenerated[lane.field]), tag + ': deterministic ' + lane.type + ' positions and IDs');
    if (seed !== 1 && Math.abs(list[0].x - baselines.get(teamSize)[lane.field][0].x) > 1) varied = true;
  }
  const extents = lanes.map(lane => map[lane.field].map(v => Math.max(Math.abs(v.x - S / 2), Math.abs(v.y - S / 2))));
  t.check(Math.min(...extents[0]) > Math.max(...extents[1]) && Math.min(...extents[1]) > Math.max(...extents[2]), tag + ': red Humvees outside yellow artillery outside blue tanks');
  const radial = map.vehicles.map(v => Math.hypot(v.x - S / 2, v.y - S / 2));
  t.check(Math.max(...radial) / Math.min(...radial) > 1.15, tag + ': Humvees follow square sides and corners rather than a circular ring');
  t.equal(new Set(world.vehicles.map(v => v.id)).size, 22, tag + ': every mobile vehicle and fixed cannon has a unique ID');
  for (const v of world.vehicles) {
    t.check(W.U.insideIsland(v.x, v.y, v.r + 60, S, C.cornerRadius), tag + ': ' + v.type + ' hull stays inland');
    t.check(world.vehicles.every(o => o === v || Math.hypot(o.x - v.x, o.y - v.y) > o.r + v.r + 80), tag + ': no overlapping vehicle parking');
    for (const seat of W.VEHICLE_SEATS) {
      const p = world.vehicleSeatPoint(v, seat, true);
      t.check(world.spotFree(p.x, p.y, C.playerRadius, true) && !world.inPond(p.x, p.y), tag + ': dry clear ' + v.type + ' boarding point');
    }
  }
}
t.check(varied, 'seed variation keeps vehicles near their lanes without fixing identical positions');
const configured = W.ARTILLERY.count;
try {
  W.ARTILLERY.count = 7;
  t.equal(W.MapGen.generate(57).artillery.length, 4, 'generator enforces the requested maximum of four artillery');
} finally { W.ARTILLERY.count = configured; }
t.done();
