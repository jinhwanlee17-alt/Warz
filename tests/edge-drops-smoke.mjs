// Coastal spacing and real lobby/server/client spawn parity for every game mode.
import { createHash } from 'node:crypto';
import { loadWarz, suite } from './harness.mjs';
import { Warz as W } from '../server/core/sim.mjs';
import { Lobby } from '../server/core/lobby.mjs';
import { Match } from '../server/core/match.mjs';

const t = suite('edge drops'), C = W.CONFIG, S = C.worldSize, R = C.cornerRadius, inset = C.dropCoastInset;
const modes = [['solo', 1, 50], ['duo', 2, 25], ['trio', 3, 16], ['squad', 4, 12]];
const seeds = [1, 57, 9001, 0xffffffff], TAU = Math.PI * 2;
const flat = S - 2 * R, arcRadius = R - inset, arc = Math.PI * arcRadius / 2;
const perimeter = 4 * flat + 4 * arc;
// Spatial queries add per-runtime visitation stamps; those are not map content.
const hash = value => createHash('sha256').update(JSON.stringify(value, (key, v) => /^_sh\d+$/.test(key) ? undefined : v)).digest('hex');
const wrap = value => ((value % perimeter) + perimeter) % perimeter;
function coastDistance(x, y) {
  const qx = Math.abs(x - S / 2) - (S / 2 - R), qy = Math.abs(y - S / 2) - (S / 2 - R);
  return R - Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - Math.min(Math.max(qx, qy), 0);
}
// Recover boundary distance independently from the generated position, including
// each corner's actual curved length (angular spacing alone would fail here).
function boundaryDistance(p) {
  const e = 1e-6;
  if (Math.abs(p.y - inset) < e && p.x >= R && p.x <= S - R) return p.x - R;
  if (Math.abs(p.x - (S - inset)) < e && p.y >= R && p.y <= S - R) return flat + arc + p.y - R;
  if (Math.abs(p.y - (S - inset)) < e && p.x >= R && p.x <= S - R) return 2 * (flat + arc) + S - R - p.x;
  if (Math.abs(p.x - inset) < e && p.y >= R && p.y <= S - R) return 3 * (flat + arc) + S - R - p.y;
  if (p.x > S - R && p.y < R) return flat + (Math.atan2(p.y - R, p.x - S + R) + Math.PI / 2) * arcRadius;
  if (p.x > S - R && p.y > S - R) return 2 * flat + arc + Math.atan2(p.y - S + R, p.x - S + R) * arcRadius;
  if (p.x < R && p.y > S - R) return 3 * flat + 2 * arc + (Math.atan2(p.y - S + R, p.x - R) - Math.PI / 2) * arcRadius;
  return wrap(4 * flat + 3 * arc + (Math.atan2(p.y - R, p.x - R) + Math.PI) * arcRadius);
}
function dryOpen(world, x, y, radius) {
  return world.spotFree(x, y, radius, true) &&
    world.map.ponds.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + radius) &&
    world.map.buildings.every(b => x + radius <= b.x || x - radius >= b.x + b.w || y + radius <= b.y || y - radius >= b.y + b.h);
}

t.equal(C.lobbySize, 50, 'the player capacity remains 50');
t.near(W.MapGen.edgeLength(), perimeter, 1e-8, 'public edge length includes all four rounded corners');
for (const distance of [-12345, 0, flat + arc / 2, perimeter + 12345]) {
  const point = W.MapGen.edgePoint(distance);
  t.near(coastDistance(point.x, point.y), inset, 1e-8, 'wrapped edge positions stay at the configured coastal inset');
  t.near(boundaryDistance(point), wrap(distance), 1e-8, 'edge coordinates preserve requested arc distance across wrapping');
}
const defaultMap = W.MapGen.generate(57);
t.equal(hash(defaultMap), hash(W.MapGen.generate(57, 1)), 'omitting the mode produces the explicit Solo map');
for (const invalid of [0, 5, 2.5, '2']) t.equal(W.MapGen.generate(1, invalid).teamSize, 1, 'invalid team size defaults to Solo');
let cornerDrops = 0;
for (const [mode, teamSize, count] of modes) for (const seed of seeds) {
  const map = W.MapGen.generate(seed, teamSize), signature = hash(map), world = new W.World({ map, teams: teamSize > 1, storm: false });
  const tag = mode + ' seed ' + seed;
  t.check(map.teamSize === teamSize && map.drops.length === count, tag + ': exact mode-specific drop count');
  t.check(map.drops.every((d, i) => d.id === i && d.label === i + 1), tag + ': stable unique drop IDs and visible labels');
  t.check(map.drops.every(d => Math.abs(coastDistance(d.x, d.y) - inset) < 1e-7), tag + ': every pad follows the same coastal inset');
  const distances = map.drops.map(boundaryDistance).sort((a, b) => a - b);
  const gaps = distances.map((d, i) => wrap((distances[(i + 1) % count] || 0) - d));
  t.check(gaps.every(g => Math.abs(g - perimeter / count) < 1e-7), tag + ': all coast gaps are equal, including the closing gap');
  cornerDrops += map.drops.filter(d => d.x < R || d.x > S - R).filter(d => d.y < R || d.y > S - R).length;
  let reserved = true;
  const sharing = Math.ceil(50 / count);
  for (const drop of map.drops) for (let i = 0; i < sharing; i++) {
    const p = W.MapGen.edgePoint(drop.edgeDistance + (i - (sharing - 1) / 2) * 500);
    if (!dryOpen(world, p.x, p.y, 60)) reserved = false;
  }
  t.check(reserved, tag + ': even maximum no-fill sharing has dry, unobstructed team footprints');
  t.equal(map.crates.length, 211, tag + ': 210 regular crates and one legendary');
  t.equal(W.CRATE_ORDER.map(tier => map.crates.filter(c => c.tier === tier).length).join(), '168,21,17,4,1', tag + ': crate rarity quotas retain the same odds');
  const legendary = map.crates.find(c => c.tier === 'legendary');
  t.check(legendary.x === S / 2 && legendary.y === S / 2 && map.legendaryCrateId === legendary.id, tag + ': the reserved legendary stays at the center');
  const cars = map.vehicles, sectors = new Set(cars.map(v => (Math.round(Math.atan2(v.y - S / 2, v.x - S / 2) / (TAU / 8)) + 8) % 8));
  t.check(cars.length === 8 && sectors.size === 8, tag + ': one Humvee occupies each of eight outer-lane sectors');
  t.check(cars.every(v => { const extent = Math.max(Math.abs(v.x - S / 2), Math.abs(v.y - S / 2)) / S; return extent >= .40 && extent <= .46; }), tag + ': Humvees follow the outer red rounded-square lane');
  const angles = cars.map(v => (Math.atan2(v.y - S / 2, v.x - S / 2) + TAU) % TAU).sort((a, b) => a - b);
  t.check(angles.every((a, i) => Math.abs(((angles[(i + 1) % 8] - a + TAU) % TAU) - TAU / 8) <= 0.26), tag + ': Humvees remain spread around all sides and rounded corners');
  let accessClear = true;
  for (const v of world.vehicles) for (const seat of W.VEHICLE_SEATS) {
    const point = world.vehicleSeatPoint(v, seat, true);
    if (!dryOpen(world, point.x, point.y, C.playerRadius)) accessClear = false;
  }
  t.check(accessClear, tag + ': every Humvee, tank and artillery access point is dry and clear');
  t.equal(hash(W.MapGen.generate(seed, teamSize)), signature, tag + ': repeated generation is identical');
}
t.check(cornerDrops > 0, 'spacing tests include the curved corners');

function packed(mode, noFill = false) {
  let spec;
  const lobby = new Lobby({ config: { lobbyMin: 1, lobbyMax: 50, lobbyCountdown: 20, botFill: 50 },
    send() {}, startMatch(s) { spec = s; }, findConns() { return []; }, log: { info() {}, warn() {}, error() {} } });
  for (let i = 0; i < (noFill ? 50 : 1); i++) {
    const conn = { name: 'Player ' + i, user: 'edge-test-' + i, open: true, party: null, queue: null, match: null };
    if (noFill && mode !== 'solo') conn.party = { id: i, mode, leader: conn, members: [conn], invited: new Map(), invitedNames: new Map(), fill: false, entry: null };
    lobby.queue(conn, mode);
  }
  lobby.launch(mode);
  return spec;
}
const ClientW = loadWarz(['config', 'util', 'map', 'world', 'items', 'online']);
let minFilledGap = Infinity, minNoFillGap = Infinity;
const firstTeamUnshared = { trio: false, squad: false };
for (const [mode, teamSize, count] of modes) {
  const filled = packed(mode), noFill = packed(mode, true);
  t.check(filled.teams.reduce((n, team) => n + team.members.length, 0) === 50 && filled.teams.length === Math.ceil(50 / teamSize), mode + ': real lobby keeps 50 players, including the final partial team');
  t.check(noFill.teams.length === 50 && noFill.teams.every(team => team.members.length === 1), mode + ': no-fill parties retain all 50 separate teams');
  for (const scenario of ['filled', 'no-fill', 'tiny']) for (const seed of (scenario === 'tiny' ? [57] : [1, 57, 9001])) {
    const source = scenario === 'tiny' ? { teams: [{ members: [{ name: 'Tiny A' }] }, { members: [{ name: 'Tiny B' }] }] } : scenario === 'filled' ? filled : noFill;
    const teams = source.teams.map((team, i) => ({ members: team.members.map((m, j) => ({ ...m, name: m.name || 'Seat ' + i + '-' + j })) }));
    const expectedOrder = teams.flatMap(team => team.members.map(m => m.name)).join();
    const match = new Match({ W, id: 'edge-' + mode + '-' + scenario + '-' + seed, mode, teamSize, teams, seed, clock: false, emptyTimeout: Infinity });
    try {
      const tag = mode + ' ' + scenario + ' seed ' + seed;
      t.equal(match.players.length, scenario === 'tiny' ? 2 : 50, tag + ': no players are dropped to fit pad counts');
      t.equal(match.players.map(p => p.name).join(), expectedOrder, tag + ': randomized station assignment preserves roster and ticket ordering');
      t.equal(match.map.drops.length, count, tag + ': match generator receives the selected mode');
      const used = new Map(), centers = match.teamInfo.map(team => {
        const first = team.players[0], p = { x: team.players.reduce((n, p) => n + p.x, 0) / team.players.length, y: team.players.reduce((n, p) => n + p.y, 0) / team.players.length };
        used.set(first.dropLabel, (used.get(first.dropLabel) || 0) + 1);
        return p;
      });
      t.check(centers.every(p => Math.abs(coastDistance(p.x, p.y) - inset) < 1e-7), tag + ': shared and single-team landings stay on the coastal contour');
      t.check(match.players.every(p => dryOpen(match.world, p.x, p.y, p.r)), tag + ': all actual players spawn on dry land clear of terrain and vehicles');
      t.check(match.teamInfo.every(team => team.players.every(p => p.dropLabel === team.players[0].dropLabel)), tag + ': teammates retain one shared station label');
      let minEnemy = Infinity, overlap = false;
      for (let i = 0; i < match.players.length; i++) for (let j = i + 1; j < match.players.length; j++) {
        const a = match.players[i], b = match.players[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < a.r + b.r - 1e-7) overlap = true;
        if (a.team !== b.team) minEnemy = Math.min(minEnemy, d);
      }
      t.check(!overlap, tag + ': no teammate or enemy bodies overlap at spawn');
      t.check(minEnemy >= (scenario === 'no-fill' ? 498 : 425), tag + ': shared-pad enemies have safe separation');
      if (scenario === 'filled') minFilledGap = Math.min(minFilledGap, minEnemy);
      if (scenario === 'no-fill') minNoFillGap = Math.min(minNoFillGap, minEnemy);
      const occupancy = [...used.values()];
      t.check(used.size === Math.min(count, teams.length) && Math.max(...occupancy) - Math.min(...occupancy) <= 1, tag + ': teams are balanced across the available pads');
      if (scenario === 'filled' && teamSize > 2 && used.get(match.players[0].dropLabel) === 1) firstTeamUnshared[mode] = true;
      if (scenario === 'filled' && seed === 1) {
        const state = ClientW.Online.start(match.startMessage(match.players[0], false));
        t.equal(hash(state.world.map), hash(match.map), mode + ': a real match-start rebuilds identical client/server terrain, drops, crates and vehicles');
        t.check(state.info.teamSize === teamSize && state.world.vehicles.filter(v => v.type === 'humvee' && v.armed).length === (teamSize > 1 ? 2 : 0)
          && state.world.vehicles.filter(v => v.type === 'tank').length === 4, mode + ': client mode, armed Humvees and tank count agree with the server');
      }
    } finally { match.destroy(); }
  }
}
t.check(firstTeamUnshared.trio && firstTeamUnshared.squad, 'the first queued player is not automatically assigned every overflow hot drop');
console.log('edge drops: minimum enemy gap ' + minFilledGap.toFixed(2) + ' units filled, ' + minNoFillGap.toFixed(2) + ' units no-fill');
t.done();
