// Storm percentages measure safe island land, with seeded movement and progressively longer pauses.
import { performance } from 'node:perf_hooks';
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(), C = W.CONFIG, t = suite('storm');
const fractions = [1, 0.8, 0.5, 0.2, 0.05, 0.025, 0];
const waits = [150, 180, 210, 240, 270, 300], durations = [45, 40, 35, 30, 25, 30];
const damage = [1, 2, 4, 7, 10, 15];
const landArea = C.worldSize ** 2 - (4 - Math.PI) * C.cornerRadius ** 2;

function storm(seed) {
  const world = { rng: W.U.rng(seed), time: 0, players: [], events: [], emit(e) { this.events.push(e); } };
  return new W.Storm(world);
}

// Independently integrate horizontal slices at higher resolution than the production vertical
// strips. Include the island's rounded corners and exclude ocean, even when the safe circle overlaps it.
function measuredLandArea(circle) {
  if (circle.r === 0) return 0;
  const S = C.worldSize, corner = C.cornerRadius, count = 32768;
  const lo = Math.max(0, circle.y - circle.r), hi = Math.min(S, circle.y + circle.r), step = (hi - lo) / count;
  let area = 0;
  for (let i = 0; i < count; i++) {
    const y = lo + (i + 0.5) * step, edge = Math.min(y, S - y);
    const inset = edge >= corner ? 0 : corner - Math.sqrt(corner ** 2 - (corner - edge) ** 2);
    const half = Math.sqrt(Math.max(0, circle.r ** 2 - (y - circle.y) ** 2));
    area += Math.max(0, Math.min(S - inset, circle.x + half) - Math.max(inset, circle.x - half));
  }
  return area * step;
}

let previousEnd = 0;
for (const [i, phase] of W.STORM.entries()) {
  t.equal(phase.start - previousEnd, waits[i], 'stage ' + (i + 1) + ': wait increases by 30 seconds');
  t.equal(phase.end - phase.start, durations[i], 'stage ' + (i + 1) + ': shrinking duration retained');
  t.equal(phase.dps, damage[i], 'stage ' + (i + 1) + ': damage per second retained');
  t.equal(phase.safeArea, fractions[i + 1], 'stage ' + (i + 1) + ': configured safe land fraction');
  previousEnd = phase.end;
}
t.equal(previousEnd, 1555, 'the final closure ends at 25 minutes 55 seconds');

let maxAreaError = 0, minShift = Infinity, clippedCircle = false;
const seeds = [1, 2, 5, 42, 99, 9001, 123456, 777777, 2147483647, 4294967295];
for (const seed of seeds) {
  const a = storm(seed), b = storm(seed);
  t.equal(JSON.stringify(a.circles), JSON.stringify(b.circles), 'seed ' + seed + ': deterministic circles');
  t.equal(a.circles.length, fractions.length, 'seed ' + seed + ': full island plus six closures');
  for (const [i, circle] of a.circles.entries()) {
    const actual = measuredLandArea(circle) / landArea;
    maxAreaError = Math.max(maxAreaError, Math.abs(actual - fractions[i]));
    t.near(actual, fractions[i], 0.0001, 'seed ' + seed + ', stage ' + i + ': correct fraction of playable land');
    t.check(W.U.insideIsland(circle.x, circle.y, C.playerRadius, C.worldSize, C.cornerRadius), 'seed ' + seed + ', stage ' + i + ': center stays on land');
    if (i) {
      const prev = a.circles[i - 1], shift = Math.hypot(circle.x - prev.x, circle.y - prev.y);
      minShift = Math.min(minShift, shift);
      t.check(shift > 1, 'seed ' + seed + ', stage ' + i + ': center moves');
      t.check(shift + circle.r <= prev.r + 1e-7, 'seed ' + seed + ', stage ' + i + ': next circle is nested');
      if (circle.r > 0 && Math.PI * circle.r ** 2 > landArea * fractions[i] * 1.01) clippedCircle = true;
    }
  }
  t.equal(a.circles.at(-1).r, 0, 'seed ' + seed + ': final safe area is exactly zero');
}
t.check(clippedCircle, 'area checks exercise circles that include ocean, not just circles entirely on land');
t.check(JSON.stringify(storm(42).circles) !== JSON.stringify(storm(43).circles), 'different seeds produce different center paths');

// Check every phase boundary and midpoint without tying the test to the former short match schedule.
{
  const s = storm(54321);
  for (const [i, phase] of W.STORM.entries()) {
    const from = s.circles[i], to = s.circles[i + 1];
    s.world.time = phase.start - 0.25; s.update(0);
    t.check(s.state === 'waiting' && s.phase === i && s.r === from.r && s.x === from.x && s.y === from.y, 'stage ' + (i + 1) + ': safe circle holds through the longer wait');
    t.near(s.timeLeft, 0.25, 1e-9, 'stage ' + (i + 1) + ': wait countdown');
    s.world.time = phase.start; s.update(0);
    t.check(s.state === 'shrinking' && s.dps === phase.dps, 'stage ' + (i + 1) + ': shrinking begins at the scheduled time');
    s.world.time = (phase.start + phase.end) / 2; s.update(0);
    t.check(s.x === (from.x + to.x) / 2 && s.y === (from.y + to.y) / 2 && s.r === (from.r + to.r) / 2, 'stage ' + (i + 1) + ': center and radius move together');
    s.world.time = phase.end; s.update(0);
    t.check(s.x === to.x && s.y === to.y && s.r === to.r, 'stage ' + (i + 1) + ': closure reaches the exact target circle');
  }
  t.check(s.state === 'final' && s.next === null && s.timeLeft === 0, 'final closure has no remaining safe destination or countdown');
}

// A zero-radius circle must not leave one immortal point at its exact center.
{
  const map = { seed: 42, rocks: [], trees: [], buildings: [], crates: [], stations: [], pickups: [], ponds: [], bushes: [] };
  const world = new W.World({ map }), s = world.storm, last = s.circles.at(-1);
  const center = world.addPlayer({ x: last.x, y: last.y }), other = world.addPlayer({ x: last.x + 100, y: last.y });
  world.time = W.STORM.at(-1).end;
  s.update(C.stormTick);
  t.check(center.inStorm && other.inStorm, 'zero safe area includes the exact final center in the storm');
  t.near(center.hp, 100 - 15 * C.stormTick, 1e-9, 'the final center takes the configured storm damage');
  for (let i = 0; i < 20; i++) { world.time += C.stormTick; s.update(C.stormTick); }
  t.check(!center.alive && !other.alive, 'the final storm eliminates stationary players including its center');
  t.check(world.events.filter((e) => e.type === 'death').every((e) => e.cause === 'storm'), 'final deaths are credited to the storm');
}

const started = performance.now();
for (let seed = 1; seed <= 100; seed++) storm(seed);
console.log('storm: maximum land-area error ' + (maxAreaError * 100).toFixed(5) + ' percentage points; smallest center shift ' + Math.round(minShift) + '; 100 schedules ' + Math.round(performance.now() - started) + ' ms');
t.done();
