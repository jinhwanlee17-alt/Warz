// Measure real emitted projectiles hitting real bodies, not just the distance from a crosshair to a target.
// Pin the combat choice so these checks isolate the aim/trigger layer from roaming and weapon selection.
import { suite } from './harness.mjs';
import { arena, W, TICK } from './bots-harness.mjs';
import { freshIntent } from '../server/core/bots/bot.mjs';
import { makeProfile } from '../server/core/bots/profile.mjs';

const t = suite('bot accuracy');
const seeds = [71, 102, 149];
const rates = [];

function measure({ weapon = 'ar', skill = 0.55, distance = 100, motion = false, seed = 71, seconds = 90, baseline = false, wall = false, buff = false } = {}) {
  const a = arena({ seed }), b = a.bot(9000, 9000, { skill }, { team: 1 });
  const h = a.human(9000 + distance, 9000, motion ? (p, w) => ({ mx: 0, my: Math.floor(w.time / 1.5) % 2 ? -1 : 1 }) : null,
    { team: 2, hp: 1e7 });
  const def = W.WEAPONS[weapon];
  if (weapon === 'turret') {
    const s = a.world.addStruct({ kind: 'turret', item: 'turret', x: b.p.x, y: b.p.y, r: 38, owner: b.p.id, team: 1,
      hp: 500, maxHp: 500, mounted: b.p.id });
    b.p.mount = s.id;
  } else b.p.weapons = [{ id: weapon, ammo: def.mag, reloading: false, reloadT: 0, cooldown: 0 }];
  b.p.slot = 0;
  if (buff) b.p.commandBuff = 1e6;
  if (wall) { a.map.buildings.push({ walls: [{ x: 9200, y: 7500, w: 35, h: 3000 }] }); a.world.buildSolids(); }
  const rec = b.newRecord(h); rec.visible = true; rec.noticed = true;
  let samples = 0, unmatched = 0, changedWithoutShot = 0, shotTicks = 0, firstShot = null, damage = 0;
  const rngNext = b.shotRng.next;
  b.shotRng.next = () => { samples++; return rngNext(); };
  if (baseline) b.shotAim = (s, mount, angle) => angle;
  b.p.controller = (p, w, dt) => {
    // Recoil moves an idle player. Anchor the test firing line so a 100-unit trial stays at 100 units.
    p.x = 9000; p.y = 9000; p.vx = p.vy = 0;
    b.now = w.time; b.dt = dt;
    rec.x = h.x; rec.y = h.y; rec.vx = h.vx; rec.vy = h.vy;
    b.shoot = { rec, def }; b.act = b.gearCharge = null;
    b.out = freshIntent();
    b.aim();
    return b.out;
  };
  const shotTimes = [], shotAngles = [], launches = [];
  let hits = 0;
  function tick(firing) {
    const beforeSamples = samples, beforeError = b.shotError;
    a.clear(); a.tick();
    const shots = a.events.filter(e => e.player === b.p && e.weapon === weapon && (e.type === 'shot' || e.type === 'launch'));
    for (const e of shots) {
      if (firstShot === null) firstShot = a.world.time;
      shotTimes.push(+a.world.time.toFixed(5));
      if (e.angles) shotAngles.push(e.angles.slice());
      if (e.type === 'launch') launches.push({ x: e.targetX, y: e.targetY });
    }
    for (const e of a.events) if (e.type === 'damage' && e.source === b.p && e.target === h && e.cause === weapon) { hits++; damage += e.amount || e.n || 0; }
    if (firing) {
      if (shots.length) shotTicks++;
      if (!baseline && ((samples - beforeSamples === 2) !== (shots.length > 0))) unmatched++;
      if (!shots.length && b.shotError !== beforeError) changedWithoutShot++;
    }
  }
  for (let i = 0; i < seconds / TICK; i++) tick(true);
  b.p.controller = () => freshIntent();
  for (let i = 0; i < 3 / TICK; i++) tick(false); // Let the last bullet/grenade reach the target.
  return { shots: shotTimes.length, hits, rate: hits / shotTimes.length, samples, unmatched, changedWithoutShot, shotTicks, firstShot,
    shotTimes, shotAngles, launches, damage, profile: b.prof, errors: a.dir.errors };
}

function aggregate(options) {
  const results = seeds.map(seed => measure({ ...options, seed }));
  const shots = results.reduce((n, r) => n + r.shots, 0), hits = results.reduce((n, r) => n + r.hits, 0);
  const result = { ...options, shots, hits, rate: hits / shots };
  rates.push(result);
  t.equal(results.reduce((n, r) => n + r.unmatched + r.changedWithoutShot + r.errors, 0), 0,
    `${options.weapon} skill ${options.skill}: aim error samples only actual firing ticks, including reload completion`);
  return result;
}

for (const skill of [0, 0.14, 0.55, 0.9, 1]) {
  const p = makeProfile(W.U.rng(1), { skill });
  t.check(p.shotAccuracy >= 0.6 && p.shotAccuracy <= 0.9, `skill ${skill} has a 60–90% easy-shot target`);
}

// Enough independent real shots to catch the old 100% close-range behavior, including low-rate sniper/shotgun shots.
for (const weapon of ['ar', 'sniper', 'shotgun', 'turret']) {
  const measured = [];
  for (const skill of [0.2, 0.55, 0.9]) {
    const r = aggregate({ weapon, skill, distance: 100, seconds: weapon === 'sniper' ? 120 : 90 });
    measured.push(r.rate);
    const expected = makeProfile(W.U.rng(1), { skill }).shotAccuracy;
    t.check(r.shots >= 150 && r.rate >= expected - 0.1 && r.rate <= Math.min(0.95, expected + 0.08),
      `${weapon} close stationary skill ${skill}: ${r.hits}/${r.shots} (${(100 * r.rate).toFixed(1)}%), near profile target without perfect aim`);
  }
  t.check(measured[2] > measured[1] && measured[1] > measured[0], `${weapon}: higher skill remains measurably more accurate`);
}

// At medium range the old lag and wobble already created misses. Do not stack a full second accuracy penalty.
for (const skill of [0.2, 0.55, 0.9]) {
  const still = aggregate({ weapon: 'ar', skill, distance: 450, seconds: 90 });
  const moving = aggregate({ weapon: 'ar', skill, distance: 450, motion: true, seconds: 90 });
  t.check(still.rate > 0.5 && still.rate < 0.94, `skill ${skill}: clear medium-range shooting remains useful (${(100 * still.rate).toFixed(1)}%)`);
  t.check(moving.rate < still.rate - 0.05, `skill ${skill}: strafing still defeats imperfect lead (${(100 * moving.rate).toFixed(1)}%)`);
}
for (const weapon of ['ar', 'turret', 'shotgun']) {
  const r = aggregate({ weapon, skill: 0.9, distance: 100, motion: true, seconds: 90 });
  t.check(r.rate > 0.45 && r.rate < 0.95, `${weapon}: even a sharp bot misses a moving nearby target (${(100 * r.rate).toFixed(1)}%)`);
}
const far = aggregate({ weapon: 'ar', skill: 0.9, distance: 800, motion: true, seconds: 90 });
t.check(far.rate > 0.05 && far.rate < 0.5, `long-range dodging still works (${(100 * far.rate).toFixed(1)}%)`);

// A regular pistol and the spin-up weapon use the same real firing gate, not a noise reroll every held-fire tick.
for (const weapon of ['pistol', 'minigun']) {
  const r = aggregate({ weapon, skill: 0.55, distance: 100, seconds: 60 });
  t.check(r.rate > 0.55 && r.rate < 0.92, `${weapon}: nearby shots retain deliberate misses (${(100 * r.rate).toFixed(1)}%)`);
}
const spinning = measure({ weapon: 'minigun', skill: 0.9, seconds: 6, buff: true });
t.check(spinning.firstShot >= W.WEAPONS.minigun.windup && spinning.shots > spinning.shotTicks,
  'minigun waits for spin-up; faster fire can emit multiple normal bullets from one sampled firing tick');
t.equal(spinning.unmatched, 0, 'minigun wind-up/cooldown ticks do not consume an aim sample');

// Compare the same AI's shot/reload schedule with and without execution error: cadence is not a hit-rate control.
for (const weapon of ['ar', 'pistol', 'sniper', 'turret', 'launcher', 'minigun']) {
  const options = { weapon, skill: 0.55, distance: weapon === 'launcher' ? 450 : 100, seconds: 25 };
  const normal = measure(options), old = measure({ ...options, baseline: true });
  t.equal(JSON.stringify(normal.shotTimes), JSON.stringify(old.shotTimes), `${weapon}: added aim error preserves every shot and reload time`);
  t.equal(normal.unmatched, 0, `${weapon}: charging/reloading never silently rerolls a pending shot`);
}
const repeatA = measure({ weapon: 'ar', seconds: 20 }), repeatB = measure({ weapon: 'ar', seconds: 20 });
t.equal(JSON.stringify([repeatA.shotAngles, repeatA.hits]), JSON.stringify([repeatB.shotAngles, repeatB.hits]), 'same seed/input reproduces every shot angle and hit');
const covered = measure({ distance: 450, wall: true, seconds: 20 });
t.check(covered.shots > 50 && covered.hits === 0, 'miss/hit outcomes still come from real projectiles and solid cover');

// Launcher errors must move the real landing point far enough to miss splash, without changing flight/charge rules.
for (const skill of [0.2, 0.55, 0.9]) {
  const r = aggregate({ weapon: 'launcher', skill, distance: 450, seconds: 120 });
  const expected = makeProfile(W.U.rng(1), { skill }).shotAccuracy;
  t.check(r.shots > 150 && r.rate > expected - 0.12 && r.rate < Math.min(0.95, expected + 0.08),
    `launcher skill ${skill}: real blast misses remain possible (${(100 * r.rate).toFixed(1)}%)`);
}
const launch = measure({ weapon: 'launcher', distance: 450, seconds: 35 });
t.check(launch.launches.length > 15 && launch.launches.some(g => Math.abs(g.y - 9000) > 15), 'launchers retain imperfect, varied landing positions');
{
  const a = arena(), b = a.bot(9000, 9000), h = a.human(9450, 9000);
  const rec = b.newRecord(h); rec.visible = true;
  const points = Array.from({ length: 20 }, () => b.throwPoint(rec, 1.6));
  t.check(points.some(p => Math.hypot(p.x - h.x, p.y - h.y) > 25), 'hand grenade planning already scatters throws instead of snapping perfectly');
  b.gearCharge = { at: 0, point: points[0], target: rec.id }; b.target = rec;
  b.p.weapons.push({ id: 'grenade', ammo: 0, cooldown: 0, reloading: false, reloadT: 0 });
  b.p.grenades = 10; b.now = 0; b.out = freshIntent(); b.chargeGear();
  const charging = b.clickAt;
  b.now = 0.1; b.out = freshIntent(); b.chargeGear();
  t.check(b.clickAt === charging && !b.out.utility, 'a charging grenade retains its chosen imperfect landing point without rerolling');
  b.target = null; b.now = 0.2; b.out = freshIntent(); b.chargeGear();
  t.check(!b.gearCharge && !b.out.utility, 'losing the selected throw target still cancels grenade charge');
}

console.log('Measured hit rates:', JSON.stringify(rates.map(({ weapon, skill, distance, motion, shots, hits, rate }) =>
  ({ weapon, skill, distance, moving: !!motion, shots, hits, percent: +(100 * rate).toFixed(1) }))));
t.done();
