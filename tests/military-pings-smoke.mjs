import assert from 'node:assert/strict';
import { Warz as W } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
import { loadWarz } from './harness.mjs';

const browser = loadWarz(['config', 'util', 'map', 'world', 'items', 'online']);
for (const seed of [1, 16]) {
  const match = new Match({ W, id: 'base-pings', mode: 'solo', teamSize: 1, seed, clock: false,
    teams: ['Visitor', 'Observer'].map(name => ({ members: [{ name }] })) });
  try {
    const world = match.world, [visitor, observer] = match.players;
    const base = match.map.militaryBases[0], big = seed === 16;
    assert.equal(base.big, big);
    assert.equal(base.pingRadius, match.map.size * (big ? .36 : .18));
    const client = browser.Online.start(match.startMessage(observer, true));
    let snap;
    observer.net.conn = { open: true, close() {}, sendText(text) { snap = JSON.parse(text); } };
    function visible(expectPing) {
      match.sendSnapshots([]);
      browser.Online.applySnapshot(snap);
      const contacts = client.world.militaryPingsFor(client.me);
      assert.equal(contacts.length, expectPing ? 1 : 0);
      if (expectPing) {
        assert.equal(contacts[0].id, visitor.id);
        assert.ok(Math.hypot(contacts[0].x - visitor.x, contacts[0].y - visitor.y) < .1);
      }
      assert.ok(!snap.p.some(row => row[0] === visitor.id), 'a ping alone never replicates an invisible enemy body');
    }
    function place(p, x, y) { Object.assign(p, { x, y, dropT: 0 }); }
    place(visitor, base.x, base.y + 120);
    visitor.fx.invisible = 20;
    world.update(.01);
    place(observer, visitor.x + base.pingRadius, visitor.y);
    visible(true);
    observer.x++;
    visible(false);

    const turret = world.structures.find(s => s.militaryBase === base.id && s.item === 'turret3');
    place(visitor, turret.x, turret.y + 66);
    place(observer, 1500, 1500);
    assert.ok(world.mountTurret(visitor, turret));
    visible(true);
    assert.ok(world.dismount(visitor, true));
    place(visitor, base.x, base.y + 120);
    world.updateBaseSignal(visitor);
    visible(true);
    assert.equal(match.encodeYou(visitor).baseSignal[1], 1, 'global alert stays active after dismount inside the base');

    world.time = W.STORM[0].end + 10;
    place(visitor, base.x + base.halfW + 1, base.y);
    world.updateBaseSignal(visitor);
    const expiry = world.time + (W.STORM[1].end - W.STORM[0].end) * (big ? 2 : 1);
    assert.equal(visitor.baseSignal.until, expiry);
    visible(false);
    place(observer, visitor.x + 4000, visitor.y);
    world.time = expiry - .01;
    visible(true);
    world.time = expiry;
    world.updateBaseSignal(visitor);
    visible(false);
    place(visitor, base.x, base.y);
    world.updateBaseSignal(visitor);
    assert.equal(visitor.baseSignal.until, 0);
    assert.equal(visitor.baseSignal.global, false);
    world.respawn(visitor, 1500, 1500);
    assert.equal(visitor.baseSignal, null);
    if (big) {
      const legendaries = match.map.crates.filter(c => c.militaryBase === base.id && c.tier === 'legendary');
      const extra = legendaries.find(c => c.id !== match.map.legendaryCrateId);
      world.damageCrate(extra, extra.hp, visitor.id, extra.x, extra.y);
      match.sendSnapshots([]); // Simulate missing the original break event.
      browser.Online.applySnapshot(snap);
      assert.ok(!client.world.map.crates[extra.id].alive);
      assert.equal(legendaries.filter(c => client.world.map.crates[c.id].alive).length, 2);
    }
  } finally { match.destroy(); }
}
console.log('Military pings passed for regular and big bases, online map visibility, turret exposure, expiry and respawn.');
