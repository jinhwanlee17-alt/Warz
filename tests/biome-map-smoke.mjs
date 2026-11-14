// Seeded regions, overlap rules, settlement footprints and biome terrain budgets.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map']), t = suite('Biome map');
const B = W.Biomes, S = W.CONFIG.worldSize;
t.equal(S, 48000, 'new island is twice the previous width and height');
t.equal(W.CONFIG.cornerRadius / S, 2850 / 24000, 'rounded coastline keeps its proportions');
t.equal(W.CONFIG.dropCoastInset / S, 480 / 24000, 'drop ring keeps its relative coastal position');
t.equal(W.ITEMS.firenade.name, 'Molotov', 'existing fire-grenade ID has its new display name');

function overlap(ids) { return B.at({ biomes: ids.map(id => ({ id, x: 0, y: 0, w: 100, h: 100 })) }, 50, 50); }
t.equal(overlap(['forest', 'tundra']), 'tundra-forest', 'forest and tundra create a tundra forest');
t.equal(overlap(['forest', 'grassland']), 'normal', 'grassland and forest cancel back to original terrain');
t.equal(overlap(['desert', 'grassland']), 'savannah', 'desert and grassland create savannah');
t.equal(overlap(['grassland', 'desert']), 'savannah', 'overlaps are independent of region order');
t.equal(B.at({}, 50, 50), 'normal', 'legacy and test maps without regions retain normal rules');

const selections = { tundra: new Set(), forest: new Set(), grassland: new Set() };
for (const seed of [1, 42, 57, 79, 991, 9001]) {
  const map = W.MapGen.generate(seed), at = (p) => B.at(map, p.x, p.y);
  for (const [id, count] of [['tundra', 2], ['forest', 1], ['grassland', 1], ['desert', 1]]) {
    const regions = map.biomes.filter(r => r.id === id);
    t.equal(regions.length, count, seed + ': selected ' + id + ' count');
    t.equal(new Set(regions.map(r => r.candidate)).size, count, seed + ': region candidates are distinct');
    regions.forEach(r => selections[id]?.add(r.candidate));
  }
  t.near(map.biomeCells.reduce((sum, c) => sum + c.w * c.h, 0), S * S, 0.001, seed + ': biome cells cover exactly the whole map');
  t.check(map.biomeCells.every(c => c.id === B.at(map, c.x + c.w / 2, c.y + c.h / 2)), seed + ': draw cells resolve the same overlap as combat');
  t.check(['village', 'small-town', 'city', 'castle', 'military-base'].every(kind => map.towns.some(town => town.kind === kind)), seed + ': all five settlement types exist');
  t.check(map.towns.filter(town => town.kind === 'village').every(town => {
    const houses = map.buildings.filter(b => b.settlement === town.id);
    return houses.length >= 7 && houses.length <= 12 && houses.length === town.buildingCount && houses.every(b => b.style === 'house');
  }), seed + ': villages contain seven to twelve actual houses');
  t.check(map.towns.every(town => town.buildingCount === map.buildings.filter(b => b.settlement === town.id).length), seed + ': all settlement counts match collision buildings');
  t.check(map.buildings.some(b => b.style === 'keep') && map.buildings.some(b => b.style === 'tower') && map.buildings.some(b => b.style === 'hangar'), seed + ': castles and bases have distinct structures');
  t.check(map.trees.every((tree, i) => tree.id === i && tree.hp === undefined && tree.maxHp === undefined && tree.alive), seed + ': leafy cover has stable IDs without health pools');
  t.check(map.trees.every(tree => tree.biome === at(tree) && tree.conceals === ['forest', 'tundra-forest', 'savannah'].includes(tree.biome)), seed + ': forest and savannah trees conceal players');
  t.check(map.bushes.length > 0 && map.bushes.every(bush => !['grassland', 'desert'].includes(at(bush))), seed + ': bushes return except in grassland and desert');
  t.check(map.cacti.length > 0 && map.cacti.every((c, i) => c.id === i && c.hp === 50 && c.maxHp === 50 && c.alive && ['desert', 'savannah'].includes(at(c))), seed + ': 50 HP cactuses occur only in arid biomes');
  const terrainArea = {};
  map.biomeCells.forEach(c => { terrainArea[c.id] = (terrainArea[c.id] || 0) + c.w * c.h; });
  for (const [kind, list, property, base] of [['rocks', map.rocks, 'rockDensity', 140], ['trees', map.trees, 'treeDensity', 300], ['bushes', map.bushes, 'bushDensity', 170]]) {
    for (const id of Object.keys(terrainArea)) {
      const count = list.filter(p => p.biome === id).length;
      const expected = base * W.CONFIG.mapAreaScale * terrainArea[id] / (S * S) * B.definitions[id][property];
      t.check(Math.abs(count - expected) < Math.max(25, expected * .06), seed + ': ' + id + ' ' + kind + ' follows its area/density budget');
    }
  }
}
t.check(selections.tundra.size === 4 && selections.forest.size === 3 && selections.grassland.size === 2, 'different seeds exercise every annotated optional region');
t.equal(JSON.stringify(B.generate(57, S)), JSON.stringify(B.generate(57, S)), 'same seed preserves biome selection');
for (const type of ['humvee', 'artillery', 'tank']) {
  for (const fraction of [0, .13, .25, .51, .87]) {
    const expanded = W.MapGen.vehicleRingPoint(type, fraction);
    W.CONFIG.worldSize = 24000;
    const previous = W.MapGen.vehicleRingPoint(type, fraction);
    W.CONFIG.worldSize = S;
    t.near(expanded.x, previous.x * 2, 1e-8, type + ' ring x scales exactly with the map');
    t.near(expanded.y, previous.y * 2, 1e-8, type + ' ring y scales exactly with the map');
  }
}
for (let ring = 0; ring < W.GROUND_ARTILLERY.rings.length; ring++) {
  const expanded = W.MapGen.groundArtilleryRingPoint(ring, .37);
  W.CONFIG.worldSize = 24000;
  const previous = W.MapGen.groundArtilleryRingPoint(ring, .37);
  W.CONFIG.worldSize = S;
  t.near(expanded.x, previous.x * 2, 1e-8, 'fixed artillery ring x keeps its relative position');
  t.near(expanded.y, previous.y * 2, 1e-8, 'fixed artillery ring y keeps its relative position');
}
t.done();
