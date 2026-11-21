import assert from 'node:assert/strict';
import { Match } from '../server/core/match.mjs';
import { Warz as W } from '../server/core/sim.mjs';

const match = new Match({ W, id: 'station-shop', mode: 'solo', teamSize: 1, seed: 112,
  teams: [{ members: [{ name: 'Shopper' }] }], clock: false });
const world = match.world, player = match.players[0], station = match.map.stations[0];
let reply;
const conn = { player, open: true, close() { this.open = false; }, sendJson(message) { reply = message; } };
player.net.conn = conn;
function equip(id, tokens = 10) {
  world.setClass(player, id, true);
  Object.assign(player, { x: station.x, y: station.y, nearStation: station, tokens, dropT: 0, classTokens: 0, keys: 0 });
  player.items.fill(null);
  station.cooldown = 0;
}
function command(message) {
  reply = null;
  match.onMessage(conn, JSON.stringify(message));
  assert.ok(reply, 'station replies to the buying player');
  return reply;
}
function buy(id) { return command({ t: 'buy-supply', id }); }

for (const [id, count] of [['grenadier', 3], ['grenadier2', 5]]) {
  equip(id, 1);
  player.grenades = 0;
  station.cooldown = 30;
  assert.ok(buy('grenade').ok);
  assert.equal(player.grenades, count);
  assert.equal(player.tokens, 0);
  assert.equal(station.cooldown, 30);
  assert.equal(buy('grenade').reason, 'tokens');
}
for (const id of ['medic', 'medic2', 'magicmedic']) {
  equip(id, 2);
  assert.ok(buy('bandage').ok && buy('firstaid').ok);
  assert.equal(player.tokens, 0);
  assert.equal(world.countItem(player, 'bandage'), 3);
  assert.equal(world.countItem(player, 'firstaid'), 1);
}
equip('medic');
player.items = player.items.map(() => ({ id: 'bandage', n: 9 }));
player.items[0].n = 7;
assert.equal(buy('bandage').reason, 'full');
assert.equal(player.items[0].n, 7, 'an incomplete pack is never granted');
assert.equal(player.tokens, 10);
player.items[1].n = 8;
assert.ok(buy('bandage').ok);
assert.equal(player.items[0].n, 9);
assert.equal(player.items[1].n, 9, 'a full pack can fill multiple stacks');

for (const [cls, item, cost] of [['sniper', 'sniperradar', 3], ['sniper2', 'sniper2radar', 5], ['sniper2', 'drone', 3], ['commander', 'flaregun', 10]]) {
  equip(cls, cost);
  assert.ok(buy(item).ok);
  assert.equal(world.countItem(player, item), 1);
  assert.equal(player.tokens, 0);
}
for (const cls of ['grenadier2', 'rocketeer']) {
  for (const [id, amount, price] of [['firenade', 3, 5], ['flashbang', 5, 2], ['landmine', 3, 1], ['smoke', 5, 2]]) {
    equip(cls, price);
    assert.ok(buy(id).ok, cls + ' can buy ' + id);
    assert.equal(player.tokens, 0);
    assert.equal(world.countItem(player, id), amount);
  }
}
for (const [cls, id, amount, price] of [['rocketeer', 'vehiclemine', 10, 5], ['commander', 'strikegun', 1, 10],
  ['engineer', 'sentry3', 1, 8], ['engineer', 'engineerhammer2', 1, 15]]) {
  equip('grenadier2', price);
  assert.equal(buy(id).reason, 'class');
  equip(cls, price - 1);
  assert.equal(buy(id).reason, 'tokens');
  player.tokens = price;
  assert.ok(buy(id).ok);
  assert.equal(player.tokens, 0);
  assert.equal(world.countItem(player, id), amount);
}
for (const cls of ['shotgunner', 'shotgunner2', 'shotgunner3']) {
  equip(cls);
  assert.equal(W.Rules.stationOffers(cls).length, 0);
  assert.equal(buy('bandage').reason, 'class');
  assert.equal(player.tokens, 10);
}
for (const cls of ['pyromancer', 'pyromaniac']) {
  equip(cls);
  assert.ok(buy('fireupgrade').ok && buy('fireupgrade').ok);
  assert.equal(buy('fireupgrade').reason, 'max');
  assert.equal(player.tokens, 4);
  assert.equal(player.pyroFireUpgrades, 2);
}
equip('gastroop', 1);
assert.ok(buy('gascylinder').ok);
assert.equal(player.gasCylinders, 4);
assert.equal(player.gasCylindersUsed, 0, 'buying stock does not increase movement speed');
assert.equal(player.tokens, 0);

equip('soldier', 8);
player.classTokens = 1;
assert.ok(command({ t: 'upgrade', cls: 'sniper', payment: 'tokens' }).ok);
assert.equal(player.classTokens, 1);
assert.equal(player.tokens, 0);
player.tokens = 15;
assert.equal(command({ t: 'upgrade', cls: 'sniper2', payment: 'classKey' }).reason, 'cooldown');
player.keys = 1;
assert.ok(command({ t: 'upgrade', cls: 'sniper2', payment: 'classKey' }).ok);
assert.equal(player.tokens, 15);
assert.equal(player.classTokens, 0);
assert.equal(player.keys, 0);
station.cooldown = 0;
assert.equal(command({ t: 'upgrade', cls: 'gastroop', payment: 'classKey' }).reason, 'classKey');
player.x += 2000;
assert.equal(buy('drone').reason, 'far');

equip('medic');
world.itemBurst('flashbang', player.x, player.y, player.id);
assert.equal(player.fx.flash, 10);
const tick = 1 / 32;
for (let i = 0; i < 10 / tick - 1; i++) world.update(tick);
assert.equal(player.fx.flash, tick);
world.update(tick);
assert.equal(player.fx.flash, 0);
match.destroy();
console.log('Station shop, class-key payments and ten-second flash passed.');
