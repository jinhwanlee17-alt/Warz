// Biome colors, cover palettes, damage feedback and map cache invalidation.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'map-art', 'render']);
const t = suite('Biome rendering');
function drawing() {
  const ops = [], stack = [];
  const g = new Proxy({ globalAlpha: 1, fillStyle: '', strokeStyle: '',
    save() { stack.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle }); },
    restore() { Object.assign(this, stack.pop()); },
    measureText(text) { return { width: String(text).length * 6 }; }
  }, { get(obj, key) {
    if (key in obj) return obj[key];
    return (...args) => {
      if (args.some(a => typeof a === 'number' && !Number.isFinite(a))) throw new Error(key + ': nonfinite coordinate');
      ops.push({ op: key, args, fill: obj.fillStyle, stroke: obj.strokeStyle });
    };
  } });
  return { g, ops, stack };
}
const empty = () => ({ size: W.CONFIG.worldSize, coast: [0,0,48000,0,48000,48000,0,48000],
  trees: [], bushes: [], cacti: [], ponds: [], buildings: [], towns: [], drops: [], tufts: [] });
const renderer = Object.create(W.Renderer.prototype);
for (const [expected, ids] of [
  ['tundra', ['tundra']], ['forest', ['forest']], ['grassland', ['grassland']], ['desert', ['desert']],
  ['tundra-forest', ['tundra', 'forest']], ['savannah', ['desert', 'grassland']], ['normal', ['grassland', 'forest']]
]) {
  const map = empty();
  map.biomes = ids.map(id => ({ id, x: 2000, y: 2000, w: 1000, h: 1000 }));
  renderer.cache = { biomes: W.Biomes.cells(map) };
  const ground = drawing(), chart = drawing();
  renderer.drawBiomes(ground.g, map, { x0: 1900, y0: 1900, x1: 3100, y1: 3100 });
  W.MapArt.paintBase(chart.g, map, 900, { big: true });
  if (expected === 'normal') {
    t.equal(ground.ops.filter(o => o.op === 'fillRect').length, 0, 'forest and grassland overlap keeps original ground');
  } else {
    const color = W.Biomes.definitions[expected].color;
    t.check(ground.ops.some(o => o.op === 'fillRect' && o.fill === color), expected + ': gameplay terrain uses the resolved biome color');
    t.check(chart.ops.some(o => o.op === 'fillRect' && o.fill === color), expected + ': map matches gameplay terrain');
    t.check(chart.ops.some(o => o.op === 'fillText' && o.args[0] === W.Biomes.definitions[expected].name.toUpperCase()), expected + ': full map names the biome');
  }
  t.check(ground.stack.length === 0 && chart.stack.length === 0, expected + ': terrain restores canvas state');
}
{
  const map = empty();
  map.towns = [{ name: 'Pebble Junction Castle', x: 47900, y: 47900 },
    { name: 'Cedar Grove Base', x: 24000, y: 24000 }, { name: 'Dusty Ridge City', x: 24020, y: 24020 }];
  const mini = drawing(); W.MapArt.paintBase(mini.g, map, 190, {});
  t.check(!mini.ops.some(o => o.op === 'fillText'), 'minimap omits crowded settlement names');
  const full = drawing(); W.MapArt.paintBase(full.g, map, 358, { big: true, labelPx: 13 });
  const labels = full.ops.filter(o => o.op === 'fillText');
  t.equal(labels.length, map.towns.length, 'small full map retains all settlement names');
  t.check(labels.every(o => o.args[1] >= o.args[0].length * 3 && o.args[1] + o.args[0].length * 3 <= 358 && o.args[2] > 0 && o.args[2] < 358), 'edge settlement names remain inside the full map');
  t.check(Math.abs(labels[1].args[2] - labels[2].args[2]) >= 12, 'nearby settlement names use separate rows');
}
{
  const map = empty();
  map.trees = [{ x: 3000, y: 3000, r: 100, biome: 'tundra-forest' }, { x: 3300, y: 3000, r: 100, alive: false }];
  map.bushes = [{ x: 3500, y: 3000, r: 50, biome: 'savannah' }];
  map.cacti = [{ x: 3600, y: 3000, r: 30 }, { x: 3800, y: 3000, r: 30, alive: false }];
  const chart = drawing(); W.MapArt.paintBase(chart.g, map, 900, { big: true });
  t.check(chart.ops.some(o => o.fill === '#e5f2e9'), 'snow-covered trees retain their snowy map palette');
  t.check(chart.ops.some(o => o.fill === '#e1c76b'), 'savannah bushes appear yellow on the map');
  t.check(!chart.ops.some(o => o.fill === '#327a32'), 'destroyed tree is absent from the map');
  t.equal(chart.ops.filter(o => o.op === 'stroke' && o.stroke === '#477a43').length, 1, 'only living cacti appear on the map');
  const sprite = { canvas: {}, R: 110, size: 250 };
  renderer.trees = renderer.bushes = [sprite];
  renderer.foliagePalettes = { snow: { trees: [sprite], bushes: [sprite] }, dry: { trees: [sprite], bushes: [sprite] } };
  map.trees[0].hp = 100; map.trees[0].maxHp = 250;
  map.bushes[0].hp = 10; map.bushes[0].maxHp = 50;
  const live = drawing(); renderer.drawCanopies(live.g, map, { x0: 0, y0: 0, x1: 5000, y1: 5000 }, { x: 3000, y: 3000, alive: true }, .1);
  t.equal(live.ops.filter(o => o.op === 'drawImage').length, 2, 'only live tree and bush canopies draw');
  t.check(map.trees[0].fade < 1, 'cover fades for the player standing beneath it');
  t.check(!live.ops.some(o => o.op === 'fillRect' && o.fill === '#edd28a'), 'leafy cover never shows HP bars, including legacy damaged cover');
  const cactus = drawing();
  renderer.drawCactus(cactus.g, { ...map.cacti[0], hp: 25, maxHp: 50 });
  t.check(cactus.ops.some(o => o.op === 'fillRect' && o.fill === '#edd28a'), 'damaged cactus shows its health bar');
  const frozen = drawing();
  renderer.drawSentryStatus(frozen.g, { time: 10 }, { x: 0, y: 0, r: 20, alive: true, snowFrozen: true, fx: {} }, null);
  t.check(frozen.ops.some(o => o.op === 'stroke' && o.stroke === '#d5f9ff'), 'tundra snow freeze renders its ice outline');
}
{
  let builds = 0;
  const canvas = { width: 0, getContext: () => drawing().g, style: {} };
  const el = { hidden: true, setAttribute() {} };
  const sandbox = { Warz: { ...W, Controls: { primary: () => 'M' }, MapArt: { base() { builds++; return {}; }, overlay() {} } },
    innerWidth: 1200, innerHeight: 900, document: { getElementById: id => id === 'bigmap' ? canvas : el,
      body: { classList: { add() {}, remove() {} } } } };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../js/map-screen.js', import.meta.url), 'utf8'), sandbox);
  const screen = sandbox.Warz.MapScreen, world = { map: empty() };
  screen.init(); screen.show(); screen.draw(world, null); screen.draw(world, null);
  t.equal(builds, 1, 'unchanged full-map terrain is cached');
  world.map.foliageVersion = 1; screen.draw(world, null);
  t.equal(builds, 2, 'foliage destruction invalidates the full-map cache');
}
t.done();
