import assert from 'node:assert/strict';
import { Warz as W } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
import { loadWarz } from './harness.mjs';

const match = new Match({ W, id: 'recon', mode: 'solo', teamSize: 1, seed: 16, clock: false,
  teams: ['Scout', 'Commander', 'Observer'].map(name => ({ members: [{ name }] })) });
try {
  const world = match.world, [scout, commander, observer] = match.players;
  for (const p of match.players) p.dropT = 0;
  world.setClass(scout, 'sniper2');
  world.setClass(commander, 'commander');
  const browser = loadWarz(['config', 'util', 'map', 'world', 'items', 'online', 'map-art']);
  const client = browser.Online.start(match.startMessage(scout, true));
  const packets = new Map();
  for (const p of match.players) p.net.conn = { open: true, close() {}, sendText(text) { packets.set(p.id, JSON.parse(text)); } };
  function use(p, id) {
    assert.equal(world.addItem(p, id, 1), 0);
    p.held = p.items.findIndex(slot => slot && slot.id === id);
    p.itemCd = 0;
    assert.ok(world.useHeld(p, { firePressed: true }));
  }
  function sync() {
    match.sendSnapshots([]);
    const packet = packets.get(scout.id);
    browser.Online.applySnapshot(packet);
    return packet;
  }
  for (const id of ['sniperradar', 'sniper2radar', 'flaregun']) {
    assert.ok(!W.Rules.itemsOfTier(W.ITEMS[id].tier).includes(id), 'shop gear never rolls in crates');
  }
  world.addItem(commander, 'sniperradar', 1);
  commander.held = commander.items.findIndex(s => s && s.id === 'sniperradar');
  assert.ok(world.dropHeld(commander));
  let dropped = world.map.pickups.at(-1);
  assert.equal(dropped.item, 'radar');
  Object.assign(scout, { x: dropped.x, y: dropped.y });
  dropped.lockT = 0;
  assert.ok(world.collect(scout, dropped), 'enemy drop is usable by Sniper II');
  world.addItem(commander, 'sniper2radar', 1);
  world.dropItems(commander);
  assert.equal(world.map.pickups.at(-1).item, 'radar', 'eliminated owners drop normal radar too');

  Object.assign(scout, { x: 6000, y: 6000 });
  Object.assign(commander, { x: 9149, y: 6000 });
  Object.assign(observer, { x: 12000, y: 6000 });
  scout.held = scout.items.findIndex(s => s && s.id === 'radar');
  assert.ok(world.useHeld(scout, { firePressed: true }));
  assert.ok(world.revealedEnemies(scout).includes(commander), 'standard radar reaches 3,149 units');
  commander.x += 2;
  assert.equal(world.revealedEnemies(scout).length, 0);
  use(scout, 'sniperradar');
  assert.equal(world.revealedEnemies(scout).length, 2, 'purchased field radar reaches 6,000 units');
  observer.x = scout.x + 6301;
  assert.equal(world.revealedEnemies(scout).length, 1);
  world.tickEffects(scout, 10);
  use(scout, 'radar');
  world.tickEffects(scout, 20);
  assert.equal(world.revealedEnemies(scout).length, 0, 'standard radar does not extend double range');
  assert.equal(scout.fx.radar, 10);

  const crate = world.map.crates.find(c => c.tier === 'common');
  crate.alive = false; crate.hp = 0; // Break event was skipped by an earlier frame.
  Object.assign(observer, { x: 42000, y: 32000, hp: 47 });
  observer.fx.invisible = 30;
  use(scout, 'sniper2radar');
  const packet = sync();
  assert.ok(packet.p.some(row => row[0] === observer.id && row[4] === 47));
  assert.ok(!packets.get(commander.id).p.some(row => row[0] === observer.id), 'intel stays private');
  assert.equal(client.world.map.crates[crate.id].alive, false);
  assert.ok(client.world.revealedEnemies(client.me).some(o => o.id === observer.id));
  const labels = [], fills = [], strokes = [];
  const canvas = new Proxy({
    measureText: text => ({ width: text.length * 6 }), fillText: text => labels.push(text),
    fillRect() { fills.push(this.fillStyle); }, stroke() { strokes.push(this.strokeStyle); }
  }, { get(obj, key) { return key in obj ? obj[key] : (() => {}); } });
  browser.MapArt.overlay(canvas, client.world, client.me, 800, { big: true });
  assert.ok(labels.includes('Soldier · 47 HP') && labels.includes('Commander · 100 HP'));
  assert.ok(fills.includes(W.CRATES.common.color) && strokes.includes('#80f5dd'), 'full radar marks crates and trenches');

  use(commander, 'flaregun');
  assert.equal(world.countItem(commander, 'flaregun'), 0);
  assert.equal(world.flares.length, 1);
  commander.x += 200;
  sync();
  assert.ok(match.players.every(p => packets.get(p.id).flares[0][1] === commander.x - 200), 'all teams see the fixed launch site');
  assert.equal(client.world.events.filter(e => e.type === 'flare').length, 1);
  sync();
  assert.equal(client.world.events.filter(e => e.type === 'flare').length, 1, 'subsequent snapshots do not repeat the alert');
  browser.MapArt.overlay(canvas, client.world, client.me, 800, { big: true });
  assert.ok(labels.includes('Flare'));
  world.time = world.flares[0].until;
  world.update(0.01);
  world.tickEffects(scout, 30);
  const expired = sync();
  assert.equal(client.world.flares.length, 0);
  assert.ok(!expired.p.some(row => row[0] === observer.id), 'far invisible player leaves interest when full radar expires');

  const island = new browser.World({ map: client.world.map, storm: false });
  const classes = Object.keys(W.CLASSES);
  for (const [i, drop] of island.map.drops.entries()) {
    const player = island.addPlayer({ x: drop.x, y: drop.y, team: i + 1 });
    island.setClass(player, classes[i % classes.length], true);
  }
  assert.equal(island.players.length, 50);
  const viewer = island.players[0];
  viewer.fx.sniper2radar = 30;
  const boxes = [];
  canvas.measureText = function (text) { return { width: text.length * parseInt(this.font.match(/\d+/)[0]) * .52 }; };
  canvas.fillRect = function (x, y, w, h) {
    if (this.fillStyle === 'rgba(14,23,31,.9)') boxes.push({ x, y, w, h });
  };
  for (const px of [288, 358, 863]) {
    boxes.length = 0;
    browser.MapArt.overlay(canvas, island, viewer, px, { big: true });
    assert.equal(boxes.length, 50);
    boxes.forEach((a, i) => {
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= px + .001 && a.y + a.h <= px + .001);
      assert.ok(boxes.slice(0, i).every(b => a.x + a.w <= b.x + .001 || b.x + b.w <= a.x + .001 ||
        a.y + a.h <= b.y + .001 || b.y + b.h <= a.y + .001), 'player labels fit the ' + px + '-pixel map without overlap');
    });
  }
  console.log('Recon passed for loot provenance, ranges, independent timers, island-wide intel and public flares.');
} finally {
  match.destroy();
}
