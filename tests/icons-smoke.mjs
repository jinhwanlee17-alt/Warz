// Item art is shared by the inventory and canvas. Every gameplay item must have
// a drawing, and silhouettes/emblems must distinguish it without rarity colour.
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(['config', 'util', 'icons']);
const t = suite('Item visuals');
const shapes = new Map();
for (const id of W.ITEM_ORDER) {
  const svg = W.Icons.itemIcon(id);
  t.check(svg.startsWith('<svg ') && svg.endsWith('</svg>'), id + ' has a complete SVG');
  t.check(svg.includes('xmlns="http://www.w3.org/2000/svg"'), id + ' can be decoded as a canvas image');
  t.check(svg.includes('viewBox="0 0 48 48"'), id + ' uses the shared icon frame');
  // Remove colour only: a differently coloured copy is not a unique visual.
  const geometry = svg.replace(/#[0-9a-f]{3,8}/gi, '#COLOR');
  t.check(!shapes.has(geometry), id + ' has distinct art from ' + shapes.get(geometry));
  shapes.set(geometry, id);
  t.equal(W.Icons.itemImage(id), null, id + ' is safe in the DOM-free server runtime');
}
t.equal(W.Icons.itemIcon('missing'), '', 'unknown item has no icon');
t.equal(W.Icons.itemImage('missing'), null, 'unknown item has no canvas image');
t.done();
