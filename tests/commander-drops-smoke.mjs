import assert from 'node:assert/strict';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
import { loadWarz } from './harness.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'online', 'map-art', 'render']);
const x = 6000, y = 6000;
function arena() {
  const map = { size: W.CONFIG.worldSize, seed: 7, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
    stations: [], ponds: [], pickups: [], drops: [], nextPickupId: 1 };
  const world = new W.World({ map, storm: false });
  const caller = world.addPlayer({ classId: 'commander', x, y, team: 1 });
  const observer = world.addPlayer({ x: x + 2000, y, team: 2 });
  return { world, caller, observer };
}
function fire(world, p, item) {
  assert.equal(world.addItem(p, item, 1), 0);
  p.held = p.items.findIndex(s => s && s.id === item);
  p.itemCd = 0;
  assert.ok(world.useHeld(p, { firePressed: true }));
  assert.equal(world.countItem(p, item), 0);
  return world.signalDrops.at(-1);
}
function open(world, crate, opener) {
  world.damageCrate(crate, crate.maxHp, opener.id, crate.x, crate.y);
  assert.equal(crate.alive, false);
}

const labels = [], fills = [];
const ctx = new Proxy({}, { get(target, key) {
  if (key in target) return target[key];
  return (...args) => {
    assert.ok(args.every(v => typeof v !== 'number' || Number.isFinite(v)), key + ' received a non-finite canvas coordinate');
    if (key === 'createRadialGradient') return { addColorStop() {} };
    if (key === 'fillText') labels.push(args[0]);
    if (key === 'fill') fills.push(target.fillStyle);
    if (key === 'measureText') return { width: args[0].length * 6 };
  };
} });
const renderer = Object.create(W.Renderer.prototype);
const view = { x0: 0, y0: 0, x1: W.CONFIG.worldSize, y1: W.CONFIG.worldSize };
function markers(world, p) {
  labels.length = 0;
  W.MapArt.overlay(ctx, world, p, 600, { big: true });
  return labels.slice();
}

{
  const { world, caller, observer } = arena();
  const drops = [fire(world, caller, 'flaregun'), fire(world, caller, 'strikegun')];
  assert.ok(Math.hypot(drops[0].x - drops[1].x, drops[0].y - drops[1].y) > W.CONFIG.crateSize);
  assert.equal(world.map.crates.length, 0);
  fills.length = 0;
  renderer.drawFlares(ctx, world, view);
  assert.equal(fills.filter(c => c === W.CRATES.epic.color).length, 2);
  assert.equal(markers(world, observer).filter(label => label === 'Epic Crate').length, 2);
  assert.ok(labels.includes('Flare'));
  world.time = W.SIGNAL_DROP.descent;
  world.updateSignalDrops();
  fills.length = 0;
  renderer.drawFlares(ctx, world, view);
  assert.ok(!fills.includes(W.CRATES.epic.color), 'airborne art disappears on landing');
  for (const d of drops) {
    assert.equal(d.crate.tier, 'epic');
    assert.equal(d.crate.hp, W.CRATES.epic.hp);
    assert.ok(!world.spotFree(d.x, d.y, 1, true), 'landed crate has a physical hitbox');
    renderer.drawCrate(ctx, d.crate, world.time);
  }
  assert.equal(fills.filter(c => c === W.CRATES.epic.color).length, 2);
  const [supply] = drops;
  Object.assign(caller, { x: supply.x, y: supply.y });
  world.updateSignalDrops();
  Object.assign(caller, { x, y });
  world.updateSignalDrops();
  assert.ok(!world.signalDropPing(supply, caller));
  assert.ok(world.signalDropPing(supply, observer), 'arrivals are per player and permanent');
  open(world, supply.crate, observer);
  const items = world.map.pickups.filter(p => p.type === 'item');
  assert.equal(new Set(items.map(p => p.item)).size, 5);
  assert.ok(items.every(p => !W.ITEMS[p.item].shopOnly));
  assert.ok(!world.signalDropPing(supply, observer));
  world.storm = { x: 0, y: 0, r: 1 };
  world.updateSignalDrops();
  world.storm = null;
  assert.equal(markers(world, observer).filter(label => label === 'Epic Crate').length, 0);
}
for (const [roll, rarity] of [[0, 'rare'], [.5, 'epic'], [.8, 'mythic'], [.99, 'legendary']]) {
  const { world, caller } = arena();
  const supply = fire(world, caller, 'flaregun');
  const crate = world.landSignalDrop(supply);
  world.rng.next = () => roll;
  open(world, crate, caller);
  const items = world.map.pickups.filter(p => p.type === 'item').map(p => p.item);
  assert.equal(new Set(items).size, 5);
  const possible = Math.min(5, W.Rules.itemsOfTier(rarity).length);
  assert.equal(items.filter(id => W.ITEMS[id].tier === rarity).length, possible);
  assert.ok(items.every(id => !W.ITEMS[id].shopOnly));
}
{
  const { world, caller, observer } = arena();
  const d = fire(world, caller, 'strikegun'), crate = world.landSignalDrop(d);
  const ally = world.addPlayer({ x: d.x - 60, y: d.y, team: caller.team });
  const mask = world.addPlayer({ classId: 'gastroop', x: d.x, y: d.y + 60, team: observer.team });
  const edge = world.addPlayer({ x: d.x + W.ITEMS.snowbomb.radius - 5, y: d.y, team: observer.team });
  const outside = world.addPlayer({ x: d.x, y: d.y - W.ITEMS.snowbomb.radius - 100, team: observer.team });
  for (const p of world.players) p.hp = p.maxHp = 250;
  observer.x = d.x + 70; observer.y = d.y; observer.armor = 20;
  open(world, crate, observer);
  assert.equal(world.map.pickups.length, 0, 'strike crate yields no loot');
  assert.equal(observer.hp, 170, 'the opener takes the full blast minus worn armor');
  for (const p of [edge, ally, mask, caller]) assert.equal(p.hp, 150, 'the blast has flat damage for everyone in range');
  assert.equal(outside.hp, 250);
  assert.equal(world.zones.length, 1);
  assert.equal(world.zones[0].r, W.WEAPONS.gasgrenade.radius);
  assert.equal(world.zones[0].dur, W.WEAPONS.gasgrenade.duration);
  for (let i = 0; i < 20; i++) { world.time += .05; world.updateZones(.05); }
  assert.equal(observer.hp, 145);
  assert.ok(observer.inGas && Math.abs(world.speedMul(observer) - .2) < 1e-8);
  for (const p of [edge, ally, mask, caller]) assert.ok(!p.inGas && p.hp === 150);
}

const match = new Match({ W: ServerW, id: 'signal-drops', seed: 16, mode: 'solo', teamSize: 1, clock: false,
  teams: ['Caller', 'Visitor', 'Far observer'].map(name => ({ members: [{ name }] })) });
try {
  const world = match.world, [caller, visitor, far] = match.players, packets = new Map();
  for (const [i, p] of match.players.entries()) {
    Object.assign(p, { x: x + 2000 * i, y, dropT: 0 });
    p.net.conn = { open: true, bufferedAmount: 0, close() {}, sendText(text) { packets.set(p.id, JSON.parse(text)); } };
  }
  let client = W.Online.start(match.startMessage(far, true));
  const drop = fire(world, caller, 'strikegun');
  function snapshot() {
    match.sendSnapshots(world.events.splice(0));
    const packet = packets.get(far.id);
    W.Online.applySnapshot(packet);
    return packet;
  }
  const pending = snapshot();
  assert.deepEqual(pending.signalDrops, [[drop.x, drop.y, drop.landAt, -1]], 'public crate state conceals its payload');
  assert.ok(pending.flares && pending.dropPings.includes(0));
  assert.ok(markers(client.world, client.me).includes('Epic Crate'));
  far.net.conn.bufferedAmount = 1000000;
  world.time += W.SIGNAL_DROP.descent;
  Object.assign(visitor, { x: drop.x, y: drop.y });
  world.updateSignalDrops();
  match.sendSnapshots(world.events.splice(0));
  assert.deepEqual(packets.get(visitor.id).dropPings, []);
  assert.deepEqual(packets.get(caller.id).dropPings, [0]);
  far.net.conn.bufferedAmount = 0;
  snapshot();
  let mirror = client.world.signalDrops[0].crate;
  assert.equal(mirror.id, drop.crate.id, 'missed landing recreates the authoritative crate');
  assert.equal(mirror.hp, drop.crate.hp);
  world.damageCrate(drop.crate, 40, visitor.id, drop.x, drop.y);
  client = W.Online.start(match.startMessage(far, true));
  W.Online.applySync(match.syncMessage(far));
  mirror = client.world.signalDrops[0].crate;
  assert.equal(mirror.hp, drop.crate.hp);
  assert.ok(markers(client.world, client.me).includes('Epic Crate'));
  assert.deepEqual(match.syncMessage(visitor).dropPings, []);
  far.net.conn.bufferedAmount = 1000000;
  open(world, drop.crate, visitor);
  match.sendSnapshots(world.events.splice(0));
  far.net.conn.bufferedAmount = 0;
  snapshot();
  assert.equal(mirror.alive, false);
  assert.ok(!markers(client.world, client.me).includes('Epic Crate'));
  assert.equal(client.world.zones.filter(z => z.kind === 'gas').length, 1);
} finally {
  match.destroy();
}
console.log('Commander drops passed for Epic loot, traps, rendering, personal markers, storm cleanup, missed packets and rejoin.');
