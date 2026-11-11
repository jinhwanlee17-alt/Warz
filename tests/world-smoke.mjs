// Map generation and match simulation: weapons, damage, grenades, medkit, upgrades, keys, pickups, storm.
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz();
const t = suite('world');
const { CONFIG: C, WEAPONS, MapGen, World } = W;
const DT = 1 / 60;

// ---------------------------------------------------------------- map generation
const started = Date.now();
for (const seed of [1, 42, 9001, 123456, 777777]) {
  const m = MapGen.generate(seed);
  t.equal(m.stations.length, C.stationCount, 'seed ' + seed + ': ' + C.stationCount + ' upgrade stations');
  t.equal(m.drops.length, 50, 'seed ' + seed + ': 50 Solo edge drop stations');
  t.check(m.stations.every((s) => W.U.insideIsland(s.x, s.y, 300, C.worldSize, C.cornerRadius)), 'seed ' + seed + ': stations on land');
  let minGap = Infinity;
  for (let i = 0; i < m.stations.length; i++) for (let j = i + 1; j < m.stations.length; j++) {
    minGap = Math.min(minGap, Math.hypot(m.stations[i].x - m.stations[j].x, m.stations[i].y - m.stations[j].y));
  }
  t.check(minGap >= C.stationMinGap, 'seed ' + seed + ': stations spread out (closest pair ' + Math.round(minGap) + ')');
  t.check(m.buildings.length >= 18, 'seed ' + seed + ': towns have buildings (' + m.buildings.length + ')');
  t.equal(m.crates.length, C.regularCrateCount + 1, 'seed ' + seed + ': regular crate quota plus one legendary crate');
  const tokens = m.pickups.filter((p) => p.type === 'token').length;
  t.check(tokens >= 35 && tokens <= 100, 'seed ' + seed + ': fewer loose tokens (' + tokens + ')');
  t.check(m.pickups.filter((p) => p.type === 'key').length >= 3, 'seed ' + seed + ': a few station keys');
  t.equal(m.bushes.length, 0, 'seed ' + seed + ': no bushes');
  t.check(m.trees.length > 200 && m.rocks.length > 80 && m.ponds.length >= 3, 'seed ' + seed + ': trees, rocks and ponds');
  t.check(m.towns.length >= 4, 'seed ' + seed + ': named towns');
}
t.check(Date.now() - started < 4000, 'five maps generate quickly (' + (Date.now() - started) + ' ms)');
const a = MapGen.generate(31337), b = MapGen.generate(31337), c = MapGen.generate(31338);
t.check(JSON.stringify(a.stations) === JSON.stringify(b.stations), 'same seed rebuilds the same map');
t.check(JSON.stringify(a.stations) !== JSON.stringify(c.stations), 'different seeds give different maps');

// An empty test range: real island, nothing on it except what each test adds.
function range(extra) {
  const map = MapGen.generate(5);
  map.rocks = []; map.trees = []; map.bushes = []; map.buildings = []; map.crates = []; map.pickups = []; map.ponds = [];
  map.stations = [];
  Object.assign(map, extra || {});
  return map;
}
function crate(id, x, y) { return { id, x, y, size: C.crateSize, hp: C.crateHp, maxHp: C.crateHp, alive: true, shake: 0 }; }
function steps(world, seconds) { for (let i = 0; i < Math.round(seconds / DT); i++) world.update(DT); }
function holdFire(player, aimX, aimY, charge) {
  player.controller = () => ({ mx: 0, my: 0, aimX, aimY, fire: true, firePressed: true, charge });
}
function idle(player, aimX, aimY) { player.controller = () => ({ mx: 0, my: 0, aimX, aimY, fire: false, firePressed: false }); }
function fireOnce(world, player, aimX, aimY) {
  holdFire(player, aimX, aimY);
  world.update(DT);
  idle(player, aimX, aimY);
  steps(world, 0.8);
}
function events(world, type) { return world.events.filter((e) => e.type === type); }

// ---------------------------------------------------------------- drop-in
{
  const world = new World({ map: range(), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200, drop: true, isLocal: true });
  p.controller = () => ({ mx: 1, my: 0, aimX: 3300, aimY: 3200, fire: true });
  steps(world, 1);
  t.check(p.dropT > 0 && Math.abs(p.x - 3200) < 0.01, 'cannot move or shoot while dropping in');
  t.equal(world.bullets.length, 0, 'no shots during the drop');
  steps(world, 1);
  t.check(p.dropT === 0 && p.x > 3200, 'moves after landing');
  t.check(events(world, 'land').length === 1, 'landing event');
}

// ---------------------------------------------------------------- AR: magazine, infinite reloads, damage
{
  const world = new World({ map: range({ crates: [crate(0, 3400, 3200)] }), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200 });
  fireOnce(world, p, 3400, 3200);
  t.equal(world.map.crates[0].hp, 90, 'one AR bullet deals 10');
  world.map.crates = [];
  world.solids = new W.U.SpatialHash(256);
  holdFire(p, 3200, 2000);
  let shots = 0;
  for (let i = 0; i < 600 && shots < 60; i++) { world.update(DT); shots = p.stats.shots; }
  t.check(p.stats.shots >= 60, 'keeps firing past three magazines: ammo is infinite');
  idle(p, 3200, 2000);
  steps(world, 0.1);
  const w = p.weapons[0];
  t.check(w.ammo <= 20 && w.ammo >= 0, 'magazine never exceeds 20');
  p.weapons[0].ammo = 0;
  holdFire(p, 3200, 2000);
  world.update(DT);
  idle(p, 3200, 2000);
  t.check(p.weapons[0].reloading, 'empty magazine reloads automatically');
  steps(world, WEAPONS.ar.reload + 0.1);
  t.equal(p.weapons[0].ammo, 20, 'reload refills to 20');
}

// ---------------------------------------------------------------- every gun's damage on a 100 HP crate
function gunTest(classId, slot, distance, expected, label, tolerance) {
  const world = new World({ map: range({ crates: [crate(0, 3200 + distance, 3200)] }), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200, classId });
  if (slot) world.switchSlot(p, slot);
  steps(world, 0.3);
  fireOnce(world, p, 3200 + distance, 3200);
  if (tolerance) t.near(100 - world.map.crates[0].hp, expected, tolerance, label);
  else t.equal(100 - world.map.crates[0].hp, expected, label);
  return world;
}
gunTest('soldier', 1, 220, 8, 'pistol deals 8');
gunTest('sniper', 0, 700, 95, 'sniper rifle deals 95');
gunTest('shotgunner', 1, 300, 45, 'deagle deals 45');
const close = gunTest('shotgunner', 0, 60, 100, 'shotgun point blank destroys a 100 HP crate');
t.check(!close.map.crates[0].alive, 'crate broken by the point-blank blast');
const far = W.Rules.shotgunDamage(520 - C.crateSize / 2);
gunTest('shotgunner', 0, 520, far, 'shotgun at long range: one pellet hit per blast, about ' + far + ' damage', 3);
{
  const world = new World({ map: range(), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200, classId: 'sniper' });
  fireOnce(world, p, 3600, 3200);
  t.check(p.weapons[0].reloading || p.weapons[0].ammo === 1, 'sniper reloads after every shot');
}

// ---------------------------------------------------------------- scope flag (camera zoom follows it)
{
  const world = new World({ map: range(), storm: false });
  const sniper = world.addPlayer({ x: 3200, y: 3200, classId: 'sniper' });
  const soldier = world.addPlayer({ x: 3400, y: 3400 });
  sniper.controller = () => ({ mx: 0, my: 0, aimX: 3300, aimY: 3200, scope: true });
  soldier.controller = () => ({ mx: 0, my: 0, aimX: 3300, aimY: 3200, scope: true });
  world.update(DT);
  t.check(sniper.scoping, 'holding scope with the sniper rifle scopes');
  t.check(!soldier.scoping, 'the AR has no scope');
  sniper.controller = () => ({ mx: 0, my: 0, aimX: 3300, aimY: 3200, scope: false });
  world.update(DT);
  t.check(!sniper.scoping, 'releasing the button unscopes');
}

// ---------------------------------------------------------------- walls stop bullets
{
  const map = range({ crates: [crate(0, 3500, 3200)] });
  map.buildings = [{ id: 0, x: 3330, y: 3100, w: 18, h: 200, walls: [{ x: 3330, y: 3100, w: 18, h: 200 }], doors: [], roof: '#888888', fade: 1 }];
  const world = new World({ map, storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200, classId: 'shotgunner' });
  world.switchSlot(p, 1);
  steps(world, 0.3);
  fireOnce(world, p, 3500, 3200);
  t.equal(world.map.crates[0].hp, 100, 'a wall blocks the bullet');
}

// ---------------------------------------------------------------- explosions
{
  const world = new World({ map: range(), storm: false });
  const thrower = world.addPlayer({ x: 3000, y: 3000 });
  const target = world.addPlayer({ x: 3200 + 75 + C.playerRadius, y: 3200 });
  world.explode(3200, 3200, WEAPONS.grenade.explosion, thrower.id, 'grenade');
  t.equal(target.hp, 50, 'grenade 75 from the target edge deals 50');
  target.hp = 100;
  world.explode(3200, 3200, WEAPONS.launcher.explosion, thrower.id, 'launcher');
  t.equal(target.hp, 81, 'launcher grenade at the same spot deals 19 (37.5 at the center)');
  target.hp = 100;
  world.explode(target.x, target.y, WEAPONS.launcher.explosion, thrower.id, 'launcher');
  t.equal(target.hp, 62, 'direct launcher hit deals 38');
  target.hp = 100;
  world.explode(target.x, target.y, WEAPONS.grenade.explosion, thrower.id, 'grenade');
  t.equal(target.hp, 0, 'direct grenade hit deals 100');
  t.check(!target.alive, 'and eliminates a 100 HP player');
  world.explode(thrower.x, thrower.y, WEAPONS.grenade.explosion, thrower.id, 'grenade');
  t.check(!thrower.alive && thrower.hp <= 0, 'your own grenade can eliminate you at the blast center');
}

// ---------------------------------------------------------------- grenadier kit: launcher fuse and hand grenades
{
  const world = new World({ map: range(), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200, classId: 'grenadier' });
  t.equal(p.grenades, 10, 'grenadier starts with 10 grenades');
  steps(world, 0.2);
  holdFire(p, 3600, 3200, (400 - WEAPONS.launcher.minRange) / (WEAPONS.launcher.range - WEAPONS.launcher.minRange) * C.projectileChargeTime);
  world.update(DT);
  idle(p, 3600, 3200);
  steps(world, 0.6); // 400 units at 950/s: the shell has landed by now
  const shell = world.grenades.find((g) => g.shell);
  t.check(!!shell, 'launcher shell lands instead of exploding on arrival');
  t.near(shell ? shell.x : 0, 3600, 12, 'shell lands at its charged range');
  t.equal(events(world, 'explosion').length, 0, 'no explosion yet during the fuse');
  steps(world, 0.6);
  const boom = events(world, 'explosion');
  t.equal(boom.length, 1, 'shell bursts after its 0.5 s fuse');
  t.check(boom[0] && boom[0].cause === 'launcher' && boom[0].power === WEAPONS.launcher.explosion.maxDamage, 'launcher blast at 37.5 power');
  t.equal(world.grenades.filter((g) => g.shell).length, 0, 'shell is gone after bursting');
  t.equal(p.grenades, 10, 'the launcher never uses hand grenades');
  p.controller = () => ({ mx: 0, my: 0, aimX: 3500, aimY: 3200, utility: true, utilityCharge: (300 - 70) / (WEAPONS.grenade.throwRange - 70) * C.projectileChargeTime });
  world.update(DT);
  idle(p, 3500, 3200);
  t.equal(p.grenades, 9, 'gear key throws a hand grenade');
  const g = world.grenades.find((x) => x.kind === 'hand' && !x.shell);
  steps(world, 1.5);
  t.near(Math.hypot(g.x - 3200, g.y - 3200), 300, 20, 'hand grenade lands at its charged range');
  steps(world, 0.2);
  t.check(!world.grenades.includes(g), 'hand grenade explodes after its fuse');
}
{
  // An airborne shell clears an intervening crate and lands at the selected spot.
  const world = new World({ map: range({ crates: [crate(0, 3400, 3200)] }), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200, classId: 'grenadier' });
  steps(world, 0.2);
  holdFire(p, 3700, 3200, (500 - WEAPONS.launcher.minRange) / (WEAPONS.launcher.range - WEAPONS.launcher.minRange) * C.projectileChargeTime);
  world.update(DT);
  idle(p, 3700, 3200);
  steps(world, 0.35);
  t.equal(world.map.crates[0].hp, 100, 'crate untouched while the shell flies above it');
  t.check(world.grenades.some((g) => g.x > 3400 && g.z > 0), 'shell clears the crate while airborne');
  steps(world, 0.8);
  t.equal(world.map.crates[0].hp, 100, 'the crate outside the landing blast stays intact');
}

// ---------------------------------------------------------------- medkit
{
  const world = new World({ map: range(), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200, classId: 'medic' });
  t.check(!world.useMedkit(p), 'medkit refuses at full HP');
  p.hp = 50;
  t.check(world.useMedkit(p), 'medkit works when hurt');
  t.equal(p.hp, 80, 'medkit heals 30');
  p.hp = 40;
  t.check(!world.useMedkit(p), 'medkit is on cooldown');
  steps(world, 49.9);
  t.check(!world.useMedkit(p), 'still recharging at 49.9 s');
  steps(world, 0.2);
  t.check(world.useMedkit(p), 'ready again after 50 s');
  p.hp = 90;
  p.medkitCd = 0;
  world.useMedkit(p);
  t.equal(p.hp, 100, 'healing caps at max HP');
}

// ---------------------------------------------------------------- upgrade stations, tokens and keys
{
  const station = { id: 0, number: 1, x: 3200, y: 3260, cooldown: 0 };
  const world = new World({ map: range({ stations: [station] }), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200 });
  idle(p, 3300, 3200);
  world.update(DT);
  t.check(p.nearStation === station, 'standing next to a station');
  p.tokens = 7;
  t.equal(world.upgrade(p, station, 'sniper').reason, 'tokens', 'need eight tokens');
  p.tokens = 8;
  const r = world.upgrade(p, station, 'sniper');
  t.check(r.ok, 'upgrade with eight tokens');
  t.equal(p.classId, 'sniper', 'now a sniper');
  t.equal(p.maxHp, 95, 'sniper max HP 95');
  t.equal(p.hp, 95, 'HP capped at the new max');
  t.equal(p.tokens, 0, 'tokens spent');
  t.equal(station.cooldown, 90, 'station recharges for 90 s');
  t.equal(world.upgrade(p, station, 'medic').reason, 'branch', 'cannot take a second lvl 1 class');
  world.setClass(p, 'soldier', false);
  p.tokens = 8;
  t.equal(world.upgrade(p, station, 'medic').reason, 'cooldown', 'recharging station refuses without a key');
  p.keys = 1;
  const k = world.upgrade(p, station, 'medic');
  t.check(k.ok && k.usedKey, 'station key skips the recharge');
  t.equal(p.keys, 0, 'key used up');
  t.equal(p.classId, 'medic', 'now a medic');
  steps(world, 89.9);
  t.check(station.cooldown > 0, 'still recharging at 89.9 s');
  steps(world, 0.2);
  t.equal(station.cooldown, 0, 'station ready again after 90 s');
}
{
  const world = new World({ map: range(), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200 });
  idle(p, 3300, 3200);
  world.spawnPickup('token', 3260, 3200, 1, false);
  world.spawnPickup('key', 3140, 3200, 1, false);
  steps(world, 1);
  t.equal(p.tokens, 1, 'walking near a token collects it');
  t.equal(p.keys, 1, 'walking near a key collects it');
  let withTokens = 0, tokenTotal = 0;
  for (let i = 0; i < 200; i++) {
    const c1 = crate(i, 3500, 3200);
    world.map.crates = [c1];
    const before = world.map.pickups.length;
    world.damageCrate(c1, 100, p.id, 3500, 3200);
    const tokens = world.map.pickups.slice(before).filter((pk) => pk.type === 'token').length;
    if (tokens) withTokens++;
    tokenTotal += tokens;
  }
  t.equal(withTokens, 200, 'every crate drops tokens now');
  t.check(tokenTotal > 200 && tokenTotal < 260, 'common crates drop 1 token, sometimes 2 (' + tokenTotal + ' from 200)');
}

// ---------------------------------------------------------------- storm
{
  const world = new World({ map: range() });
  const p = world.addPlayer({ x: 400, y: 3200 });
  idle(p, 500, 3200);
  steps(world, 10);
  t.equal(p.hp, 100, 'no storm damage before the first circle');
  t.equal(world.storm.state, 'waiting', 'storm waiting at the start');
  world.time = W.STORM[0].start + 1;
  world.update(DT);
  t.equal(world.storm.state, 'shrinking', 'storm shrinks on schedule');
  world.time = W.STORM[W.STORM.length - 1].end + 1;
  steps(world, 20);
  t.check(!p.alive, 'the final storm eliminates players');
  const death = world.events.find((e) => e.type === 'death');
  t.check(death && death.cause === 'storm', 'death is credited to the storm');
}

// ---------------------------------------------------------------- teams: friendly fire, team heal, downed and revive
{
  const world = new World({ map: range(), storm: false, teams: true });
  const a = world.addPlayer({ x: 3200, y: 3200, team: 1 }), b = world.addPlayer({ x: 3400, y: 3200, team: 1, classId: 'medic' }), e = world.addPlayer({ x: 3600, y: 3200, team: 2 });
  idle(b, 3700, 3200); idle(e, 3000, 3200);
  fireOnce(world, a, 3600, 3200);
  t.equal(b.hp, 100, 'bullets pass through teammates');
  t.check(e.hp < 100, 'and still hit the enemy behind them');
  world.explode(3400, 3200, WEAPONS.grenade.explosion, a.id, 'grenade');
  t.equal(b.hp, 100, 'your own blasts never hurt teammates');
  a.hp = 50; b.hp = 60;
  b.x = 3480;
  world.useMedkit(b);
  t.equal(a.hp, 50, 'medkit does not reach a teammate 280 units away');
  t.equal(b.hp, 90, 'but heals the medic');
  b.hp = 60; b.medkitCd = 0; b.x = 3300;
  world.useMedkit(b);
  t.equal(a.hp, 80, 'medkit heals a nearby teammate');
  t.equal(b.hp, 90, 'and the medic');
  world.damagePlayer(a, 500, e.id, 'ar');
  t.check(a.alive && a.downed, 'lethal damage knocks you down while a teammate is standing');
  t.equal(e.stats.knocks, 1, 'knock counted');
  b.x = 3250; b.y = 3200;
  b.controller = () => ({ mx: 0, my: 0, aimX: 3300, aimY: 3200, iv: true });
  a.controller = () => ({ mx: 0, my: 0, aimX: 3300, aimY: 3200 });
  steps(world, 1.5);
  t.check(a.downed && a.revive > 0.5, 'revive progress builds while the medic holds interact');
  steps(world, 0.7);
  t.check(!a.downed && a.hp === 30, 'revived with 30 HP after 2 s (medic speed)');
  t.equal(b.stats.revives, 1, 'revive counted');
  world.damagePlayer(a, 500, e.id, 'ar');
  b.controller = () => ({ mx: 0, my: 0, aimX: 3300, aimY: 3200 });
  steps(world, 30.2);
  t.check(!a.alive, 'a downed player bleeds out after 30 s');
  t.check(b.alive, 'the standing teammate plays on');
  const w2 = new World({ map: range(), storm: false, teams: true });
  const c = w2.addPlayer({ x: 3200, y: 3200, team: 1 }), d = w2.addPlayer({ x: 3260, y: 3200, team: 1 }), f = w2.addPlayer({ x: 3600, y: 3200, team: 2 });
  w2.damagePlayer(c, 500, f.id, 'ar');
  t.check(c.downed, 'first teammate down');
  w2.damagePlayer(d, 500, f.id, 'ar');
  t.check(!c.alive && !d.alive, 'when the last teammate falls, the team is out');
  t.equal(events(w2, 'death').length, 2, 'two eliminations');
  const w3 = new World({ map: range(), storm: false });
  const s1 = w3.addPlayer({ x: 3200, y: 3200 }), s2 = w3.addPlayer({ x: 3400, y: 3200 });
  w3.damagePlayer(s1, 500, s2.id, 'ar');
  t.check(!s1.alive && !s1.downed, 'solo players are eliminated outright');
}

// ---------------------------------------------------------------- remote mirror: cosmetic only, prediction matches the server
{
  const station = { id: 0, x: 4200, y: 4300, cooldown: 0 };
  const world = new World({ map: range({ stations: [station] }), remote: true, storm: false });
  const unknown = world.addPlayer({ x: 3200, y: 3200 });
  unknown.hidden = true;
  world.downPlayer(unknown, null, 'ar');
  t.check(unknown.downed && events(world, 'downed').length === 1 && world.explosions.length === 0,
    'an unseen player can be knocked down without drawing a ring at their placeholder');
  world.revivePlayer(unknown, null);
  t.check(!unknown.downed && unknown.hp === 30 && events(world, 'revived').length === 1,
    'unseen revival still updates health and emits its gameplay event');
  t.check(world.explosions.length === 0 && world.texts.length === 0,
    'unseen revival produces no ring or text at an unknown position');
  world.healFx(unknown, 10);
  world.land(unknown);
  t.check(unknown.healFlash === 1 && events(world, 'land').length === 1 && world.particles.length === 0 && world.texts.length === 0 && world.explosions.length === 0,
    'unseen healing and landing retain state and events without placeholder effects');
  world.applyUpgrade(unknown, station, 'sniper', false);
  t.check(unknown.classId === 'sniper' && station.cooldown === C.stationCooldown && events(world, 'upgrade').length === 1,
    'an unseen upgrade still updates class, station cooldown and gameplay events');
  t.check(world.particles.length === 0 && world.texts.length === 0 && world.explosions.length === 1 && world.explosions[0].x === station.x && world.explosions[0].y === station.y,
    'unseen upgrade effects remain at the known station instead of the placeholder player');
  const pickup = world.spawnPickupAt({ id: 999, type: 'token', x: 4100, y: 4400, amount: 1 });
  world.removePickup(pickup.id, unknown, 'token', 1, 1);
  t.check(!pickup.alive && events(world, 'pickup').length === 1 && world.texts.length === 0,
    'an unseen collector still removes the pickup and emits its event without floating placeholder text');
  t.check(world.particles.length === 8 && world.particles.every(p => p.x === pickup.x && p.y === pickup.y),
    'pickup particles retain the authoritative pickup location');
  world.killPlayer(unknown, null, 'ar');
  t.check(!unknown.alive && unknown.hp === 0 && events(world, 'death').length === 1,
    'an unseen death still updates the roster and emits the elimination');
  t.check(world.particles.length === 8 && world.explosions.length === 1,
    'an unseen death creates no extra burst or ring at the placeholder');
  const known = world.addPlayer({ x: 3600, y: 3200 });
  world.land(known);
  world.healFx(known, 10);
  t.check(world.explosions.length === 2 && world.particles.length > 8 && world.texts.length === 1,
    'visible players keep their landing and healing graphics');
}
{
  const world = new World({ map: range(), remote: true, storm: false });
  const shooter = world.addPlayer({ x: 3200, y: 3200 });
  const unknown = world.addPlayer({ x: 3300, y: 3200 });
  const stale = world.addPlayer({ x: 3400, y: 3200 });
  const visible = world.addPlayer({ x: 3700, y: 3200 });
  // Unknown roster entries and previously seen players outside snapshot range have no current body here.
  unknown.hidden = true; unknown.snaps = [];
  stale.hidden = true; stale.snaps = [{ t: 0, x: stale.x, y: stale.y, a: 0 }];
  const hit = world.sweep(3200, 3200, 3800, 3200, WEAPONS.ar.bulletRadius, shooter.id, shooter.team);
  t.check(hit && hit.player === visible, 'cosmetic shots ignore unknown and stale hidden replicas and reach the visible enemy behind them');
  world.spawnShot(shooter, WEAPONS.ar, [0]);
  const bullet = world.bullets[0];
  t.check(world.advanceBullet(bullet, 250) && bullet.x > stale.x + stale.r, 'a mirrored bullet travels through hidden replica positions instead of disappearing there');
  t.check(!world.advanceBullet(bullet, 500), 'the same cosmetic bullet still collides with a visible replicated body');
  t.equal(visible.hp, 100, 'that cosmetic collision still leaves damage to the authoritative server');
  unknown.hidden = false;
  unknown.snaps = [{ t: 1, x: unknown.x, y: unknown.y, a: 0 }];
  const restored = world.sweep(3200, 3200, 3800, 3200, WEAPONS.ar.bulletRadius, shooter.id, shooter.team);
  t.check(restored && restored.player === unknown, 'a replica starts blocking cosmetic shots once its authoritative position becomes visible');
}
{
  const world = new World({ map: range(), storm: false });
  const shooter = world.addPlayer({ x: 3200, y: 3200 });
  const target = world.addPlayer({ x: 3400, y: 3200 });
  target.hidden = true;
  target.fx.invisible = 10;
  fireOnce(world, shooter, target.x, target.y);
  t.equal(target.hp, 90, 'authoritative bullets still damage hidden and invisible players at their real positions');
  t.check(target.hidden && target.fx.invisible > 0, 'the hit does not rely on removing hidden or invisibility state');
}
{
  const world = new World({ map: range({ crates: [crate(0, 3400, 3200)] }), remote: true });
  const p = world.addPlayer({ id: 7, x: 3200, y: 3200, name: 'Remote' });
  world.spawnShot({ id: 7, team: 7, color: '#fff', outline: '#000', r: 24, x: 3200, y: 3200, angle: 0 }, WEAPONS.ar, [0]);
  steps(world, 0.5);
  t.equal(world.map.crates[0].hp, 100, 'mirrored bullets never deal damage');
  world.explode(3400, 3200, WEAPONS.grenade.explosion, 7, 'grenade');
  t.equal(world.map.crates[0].hp, 100, 'mirrored explosions are visual only');
  t.equal(world.playerById(7), p, 'players keep server ids');
  const a1 = new World({ map: range(), storm: false }), a2 = new World({ map: range(), storm: false });
  const q1 = a1.addPlayer({ x: 3200, y: 3200 }), q2 = a2.addPlayer({ x: 3200, y: 3200 });
  for (let i = 0; i < 40; i++) { a1.moveStep(q1, { mx: 1, my: 0.3 }, 1 / 20); a2.moveStep(q2, { mx: 1, my: 0.3 }, 1 / 20); }
  t.check(q1.x === q2.x && q1.y === q2.y && q1.x > 3200, 'moveStep is deterministic (client prediction matches the server)');
}

t.done();
