// Live Legendary markers and dense edge-drop labels on the actual shared map painter.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { loadWarz, suite, ROOT } from './harness.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items']);
const t = suite('Map live markers');
function drawing() {
  const rects = [], labels = [], stack = [];
  const g = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 0.4, font: '10px sans-serif', textBaseline: 'alphabetic',
    save() { stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, stack.pop()); },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {}, arcTo() {}, rect() {}, fill() {}, stroke() {},
    scale() {}, translate() {}, rotate() {}, setLineDash() {}, strokeRect() {}, strokeText() {}, clip() {},
    measureText(text) { return { width: String(text).length * Number(this.font.match(/[\d.]+/)[0]) * 0.58 }; },
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, color: this.fillStyle, alpha: this.globalAlpha }); },
    fillText(text, x, y) { labels.push({ text, x, y, width: this.measureText(text).width, height: Number(this.font.match(/[\d.]+/)[0]), color: this.fillStyle }); }
  };
  return { g, rects, labels, stack };
}
let canvasDraw;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'map-art.js'), 'utf8'), {
  window: { Warz: W }, document: { createElement() { canvasDraw = drawing(); return { getContext() { return canvasDraw.g; } }; } }
});

const map = W.MapGen.generate(57), world = new W.World({ map, storm: false });
const crate = map.crates.find(c => c.tier === 'legendary');
function icons(draw) { return draw.rects.filter(r => r.color === '#ffd44f'); }
for (const [big, px, dpr] of [[false, 190, 1], [false, 280, 2], [true, 863, 1], [true, 716, 2]]) {
  const label = (big ? 'full map' : 'minimap') + ' DPR ' + dpr;
  crate.alive = true; crate.hp = crate.maxHp;
  const before = drawing(); W.MapArt.overlay(before.g, world, null, px, { big, dpr });
  const icon = icons(before);
  t.equal(icon.length, 1, label + ': one Legendary crate icon without ordinary crate clutter');
  t.check(Math.abs(icon[0].x + icon[0].w / 2 - px / 2) < 1e-8 && Math.abs(icon[0].y + icon[0].h / 2 - px / 2) < 1e-8, label + ': marker sits at the actual center crate');
  t.check(icon[0].w / dpr >= 10 && icon[0].alpha === 1, label + ': icon stays readable and opaque');
  t.equal(before.stack.length, 0, label + ': marker restores the canvas state');
  t.equal(before.g.globalAlpha, 0.4, label + ': caller alpha is preserved');
  crate.hp = 1;
  const damaged = drawing(); W.MapArt.overlay(damaged.g, world, null, px, { big, dpr });
  t.equal(icons(damaged).length, 1, label + ': badly damaged but unbroken crate remains marked');
  crate.hp = 0;
  const zero = drawing(); W.MapArt.overlay(zero.g, world, null, px, { big, dpr });
  t.equal(icons(zero).length, 0, label + ': zero HP removes marker immediately even before alive flag changes');
  crate.hp = crate.maxHp; crate.alive = false;
  const broken = drawing(); W.MapArt.overlay(broken.g, world, null, px, { big, dpr });
  t.equal(icons(broken).length, 0, label + ': replicated broken state never leaves a stale marker');
}
crate.alive = true; crate.hp = crate.maxHp;
const viewer = world.addPlayer({ id: 'map-viewer', name: 'Map viewer', x: 5000, y: 5000 });
world.remote = true; viewer.hidden = true;
const joining = drawing(); W.MapArt.overlay(joining.g, world, viewer, 600, { big: true });
t.equal(icons(joining).length, 0, 'remote join waits for authoritative state rather than briefly showing a seeded marker');
viewer.hidden = false;
const joined = drawing(); W.MapArt.overlay(joined.g, world, viewer, 600, { big: true });
t.equal(icons(joined).length, 1, 'authoritative local presence reveals an unbroken Legendary marker');
world.remote = false;
for (const [px, dpr] of [[863, 1], [716, 2]]) {
  for (const [x, y] of [[0, 0], [map.size / 2, 0], [map.size, 0], [0, map.size], [map.size, map.size]]) {
    viewer.x = x; viewer.y = y;
    const edge = drawing(); W.MapArt.overlay(edge.g, world, viewer, px, { big: true, dpr });
    const label = edge.labels.find(l => l.text === 'You');
    t.check(label && label.x - label.width / 2 >= 0 && label.x + label.width / 2 <= px &&
      label.y - label.height / 2 >= 0 && label.y + label.height / 2 <= px, 'coastal You label remains inside ' + px + 'px map at ' + x + ',' + y);
    if (y === 0) t.check(label.y > 20 * dpr, 'top-edge You label moves below the arrow at DPR ' + dpr);
  }
}
W.MapArt.base(map, 600, { big: true, labelPx: 13, dpr: 1 });
t.equal(icons(canvasDraw).length, 0, 'Legendary marker is absent from the cached terrain layer');
world.damageCrate(crate, crate.hp, null, crate.x, crate.y);
const destroyed = drawing(); W.MapArt.overlay(destroyed.g, world, null, 600, { big: true });
t.equal(icons(destroyed).length, 0, 'actual crate destruction removes the next live marker');

for (const count of [50, 25, 16, 12]) {
  // Stress the entire square perimeter, including corners closer to the canvas than real playable drops.
  const inset = 120, side = map.size - inset * 2;
  map.drops = Array.from({ length: count }, (_, i) => {
    const at = ((i + 0.19) / count * 4) % 4, edge = Math.floor(at), along = (at - edge) * side;
    return { label: i + 1, r: 104, x: edge === 0 ? inset + along : edge === 1 ? map.size - inset : edge === 2 ? map.size - inset - along : inset,
      y: edge === 0 ? inset : edge === 1 ? inset + along : edge === 2 ? map.size - inset : map.size - inset - along };
  });
  for (const [px, dpr] of [[863, 1], [358, 1], [716, 2], [263, 1]]) {
    W.MapArt.base(map, px, { big: true, labelPx: 13 * dpr, dpr });
    const labels = canvasDraw.labels.filter(l => l.color === '#ffe9a8'), prefix = count + ' edge drops, ' + px + 'px DPR ' + dpr;
    t.equal(labels.length, count, prefix + ': every drop remains labelled');
    t.check(labels.every(l => l.x - l.width / 2 >= 0 && l.x + l.width / 2 <= px && l.y - l.height / 2 >= 0 && l.y + l.height / 2 <= px), prefix + ': no label clips outside the canvas');
    t.check(labels.every((a, i) => labels.slice(0, i).every(b => Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2)), prefix + ': labels do not overlap');
  }
  W.MapArt.base(map, 190, { big: false, labelPx: 9, dpr: 1 });
  t.equal(canvasDraw.labels.filter(l => l.color === '#ffe9a8').length, 0, count + ' drops: minimap avoids tiny drop-label clutter');
}
{
  const staff = { owner: 'enemy-medic', team: 'enemy-team', x: map.size - 2, y: 2, recharge: 0, rate: 25 };
  let staffs = [staff];
  world.placedMedicStaffs = () => staffs;
  for (const big of [false, true]) {
    const d = drawing(); W.MapArt.overlay(d.g, world, viewer, big ? 600 : 190, { big, dpr: 1 });
    t.equal(d.rects.filter(r => r.color === '#b7ffe3').length, 2, 'public staff cross appears on ' + (big ? 'island map' : 'minimap') + ' without a visible owner');
    t.equal(d.stack.length, 0, 'public staff marker restores canvas state');
    if (big) {
      const label = d.labels.find(l => l.text === 'Medic Staff');
      t.check(label && label.x + label.width / 2 <= 600 && label.y - label.height / 2 >= 0, 'staff waypoint label stays inside the coastal map edge');
    }
  }
  staffs = [];
  const pickedUp = drawing(); W.MapArt.overlay(pickedUp.g, world, viewer, 600, { big: true });
  t.equal(pickedUp.rects.filter(r => r.color === '#b7ffe3').length, 0, 'picking up a staff removes its next live waypoint without rebuilding terrain');
}
t.done();
