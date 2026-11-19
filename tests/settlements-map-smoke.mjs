// Real settlement footprints, traversable entrances, guaranteed rewards and seeded guards.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items']);
const t = suite('Settlement map'), C = W.CONFIG;
const cardinal = ['north', 'east', 'south', 'west'];
const compass = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const totals = { houses: 0, ruined: 0, extra: { common: 0, rare: 0, epic: 0 } };
const observed = { villages: new Set(), towns: new Set(), counts: new Set() };
function overlaps(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
function footprint(town) { return { x: town.x - town.halfW, y: town.y - town.halfH, w: town.halfW * 2, h: town.halfH * 2 }; }
for (const seed of [1, 2, 3, 4, 7, 9, 42, 57, 991, 2024]) {
  const map = W.MapGen.generate(seed, 2), villages = map.towns.filter(town => town.kind === 'village'),
    towns = map.towns.filter(town => town.kind === 'town');
  const signature = JSON.stringify(map);
  t.check(map.settlementStructures.filter(s => s.kind === 'sentry').every(s => map.drops.every(drop =>
    Math.hypot(s.x - drop.x, s.y - drop.y) >= W.ITEMS[s.item].range + drop.clearRadius)),
    seed + ': settlement guards cannot cover coastal landing clearings');
  observed.counts.add(villages.length);
  t.check(villages.length >= 4 && villages.length <= 6 && towns.length === 2 && map.towns.length === villages.length + 2,
    seed + ': only four to six villages and exactly two towns spawn');
  t.check(map.towns.every((town, index) => map.towns.slice(index + 1).every(other => !overlaps(footprint(town), footprint(other)))),
    seed + ': all settlement footprints are separated');
  const settlementBuildings = map.buildings.filter(b => b.militaryBase === undefined);
  t.check(settlementBuildings.every(b => b.style === 'house' && map.towns.some(town => town.id === b.settlement)),
    seed + ': old settlements and stray houses are absent');
  t.check(map.buildings.every((b, index) => map.buildings.slice(index + 1).every(other => !overlaps(b, other))),
    seed + ': house footprints never overlap');
  t.check(settlementBuildings.every(b => b.w >= 200 && b.w <= 280 && b.h >= 180 && b.h <= 240),
    seed + ': houses use compact rectangular footprints');
  const world = new W.World({ map, teams: true, storm: false });
  let entrancesClear = true;
  for (const b of settlementBuildings) {
    const crates = map.crates.filter(c => c.building === b.id);
    t.check(crates.length === 1 && crates[0].settlement === b.settlement && crates[0].x > b.x + W.MapGen.WALL &&
      crates[0].x < b.x + b.w - W.MapGen.WALL && crates[0].y > b.y + W.MapGen.WALL && crates[0].y < b.y + b.h - W.MapGen.WALL,
    seed + ': house ' + b.id + ' has exactly one interior crate, including ruins');
    if (b.ruined) { t.equal(b.walls.length, 0, seed + ': ruined plot ' + b.id + ' has no solid house walls'); continue; }
    t.check(b.doorways.length >= 1 && b.doorways.every(d => Math.max(d.w, d.h) === W.MapGen.DOOR),
      seed + ': house ' + b.id + ' records its full-width entrance');
    for (const d of b.doorways) {
      const nx = d.side === 'left' ? -1 : d.side === 'right' ? 1 : 0,
        ny = d.side === 'top' ? -1 : d.side === 'bottom' ? 1 : 0;
      for (let offset = 35; offset >= -35; offset -= 5) {
        const x = d.x + d.w / 2 + nx * offset, y = d.y + d.h / 2 + ny * offset,
          actor = { x, y, r: C.playerRadius, vx: -nx, vy: -ny };
        world.collide(actor);
        if (Math.hypot(actor.x - x, actor.y - y) > 1e-7) entrancesClear = false;
      }
    }
  }
  t.check(entrancesClear, seed + ': actual player collision can pass through every marked doorway');
  for (const town of map.towns) {
    const houses = map.buildings.filter(b => b.settlement === town.id),
      rewards = houses.map(b => map.crates.find(c => c.building === b.id)),
      guards = map.settlementStructures.filter(s => s.settlement === town.id && s.kind === 'sentry'),
      turrets = map.settlementStructures.filter(s => s.settlement === town.id && s.kind === 'turret'),
      vehicles = map.settlementVehicles.filter(v => v.settlement === town.id);
    t.equal(houses.length, town.houseCount, seed + ': ' + town.name + ' has its full planned house count');
    t.check(houses.length === town.buildingCount && turrets.length === 1 && turrets[0].neutral,
      seed + ': ' + town.name + ' has one neutral courtyard turret');
    if (town.kind === 'village') {
      observed.villages.add(houses.length);
      t.check(houses.length >= 6 && houses.length <= 12 && houses.every(b => !b.ruined), seed + ': village house count is six to twelve');
      const special = houses.length > 10 ? 'mythic' : 'epic';
      t.check(rewards.filter(c => c.tier === special).length === 1 && rewards.filter(c => c.tier === 'common').length === houses.length - 1 &&
        rewards.every(c => c.tier === 'common' || c.tier === special), seed + ': village special crate replaces exactly one common crate');
      t.check(guards.length === 4 && cardinal.every(bearing => guards.some(s => s.bearing === bearing)), seed + ': village has four cardinal guards');
      t.equal(guards.filter(s => s.item === 'sentry2').length, houses.length === 12 ? 2 : houses.length > 8 ? 1 : 0,
        seed + ': village sentry upgrades follow house count');
      t.check(turrets[0].item === 'turret' && vehicles.length === 0, seed + ': village courtyard has the basic unmanned turret');
    } else {
      observed.towns.add(houses.length);
      totals.houses += houses.length; totals.ruined += houses.filter(b => b.ruined).length;
      t.check(houses.length >= 20 && houses.length <= 30, seed + ': town house count is twenty to thirty');
      const base = rewards.slice(0, 20);
      t.check([['common', 11], ['rare', 5], ['epic', 3], ['mythic', 1]].every(([tier, count]) => base.filter(c => c.tier === tier).length === count),
        seed + ': first twenty town houses have the guaranteed rarity split');
      rewards.slice(20).forEach(c => { totals.extra[c.tier]++; });
      t.check(rewards.slice(20).every(c => ['common', 'rare', 'epic'].includes(c.tier)), seed + ': extra houses use the weighted common/rare/epic table');
      t.check(guards.length === 8 && compass.every(bearing => guards.some(s => s.bearing === bearing)) &&
        guards.every(s => s.item === (houses.length === 30 ? 'sentry3' : 'sentry2')), seed + ': town guards cover all eight compass points at the correct tier');
      t.check(turrets[0].item === 'turret3' && vehicles.length === 1 && vehicles[0].armed &&
        Math.hypot(vehicles[0].x - turrets[0].x, vehicles[0].y - turrets[0].y) < 350,
      seed + ': team-mode town has an armed Humvee beside its neutral Turret III');
      const bonuses = map.crates.filter(c => c.settlement === town.id && c.tier === 'legendary');
      t.check(bonuses.length === (houses.length === 30 ? 1 : 0) && bonuses.every(c => c.legendaryDrops === 1 && c.building === undefined),
        seed + ': only thirty-house towns earn the single-item Legendary crate');
    }
    t.check(guards.every(s => s.neutral && houses.every(b => !overlaps({ x: s.x - 55, y: s.y - 55, w: 110, h: 110 }, b))),
      seed + ': perimeter guards have clear positions outside houses');
    const bounds = footprint(town);
    t.check([].concat(map.trees, map.bushes, map.rocks, map.cacti, map.stations).every(p =>
      !(p.x >= bounds.x && p.x <= bounds.x + bounds.w && p.y >= bounds.y && p.y <= bounds.y + bounds.h)),
    seed + ': settlement interiors stay clear of scattered terrain and upgrade stations');
  }
  const bonusCount = towns.filter(town => town.houseCount === 30).length, center = map.crates[map.legendaryCrateId];
  t.check(map.crates.filter(c => c.militaryBase === undefined).length === C.regularCrateCount + bonusCount && center.tier === 'legendary' &&
    center.x === map.size / 2 && center.y === map.size / 2 && center.legendaryDrops === undefined,
  seed + ': ordinary crate count and central four-item reward survive town bonuses');
  const vehicleIds = [].concat(map.vehicles, map.tanks, map.artillery, map.groundArtillery, map.settlementVehicles).map(v => v.id);
  t.equal(new Set(vehicleIds).size, vehicleIds.length, seed + ': settlement Humvees have unique IDs without replacing ring vehicles');
  t.equal(JSON.stringify(W.MapGen.generate(seed, 2)), signature, seed + ': complete settlement generation is deterministic');
}
t.check(observed.counts.size === 3 && observed.villages.has(6) && observed.villages.has(12) && observed.towns.has(20) && observed.towns.has(30),
  'seed coverage exercises village-count and house-count endpoints');
t.check(totals.ruined / totals.houses > .015 && totals.ruined / totals.houses < .09, 'seed sample has a small ruined-house fraction consistent with five percent');
const extraCount = Object.values(totals.extra).reduce((a, b) => a + b, 0);
t.check(extraCount > 50 && totals.extra.common / extraCount > .6 && totals.extra.common / extraCount < .9 && totals.extra.rare > 0 && totals.extra.epic > 0,
  'extra-house sample exercises the 75/20/5 weighted rewards');
for (const teamSize of [1, 2, 3, 4]) {
  const map = W.MapGen.generate(42, teamSize);
  t.equal(map.settlementVehicles.length, teamSize === 1 ? 0 : 2, teamSize + ': town armed Humvees are exclusive to team modes');
  t.check(map.vehicles.length === W.VEHICLE.count && map.tanks.length === W.TANK.count && map.artillery.length === 4 && map.groundArtillery.length === 6,
    teamSize + ': all existing ring vehicle groups keep their counts');
}
t.done();
