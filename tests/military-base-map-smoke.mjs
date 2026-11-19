import assert from 'node:assert/strict';
import { loadWarz } from './harness.mjs';

const W = loadWarz();
const sizes = new Set(), zones = new Set();
for (const [seed, teamSize] of [[1, 1], [2, 1], [4, 1], [16, 1], [42, 2], [123456, 4]]) {
  const map = W.MapGen.generate(seed, teamSize), world = new W.World({ map, teams: teamSize > 1, storm: false });
  const available = W.MapGen.militaryZones.filter(zone => !map.towns.some(town => W.MapGen.settlementInMilitaryZone(town, zone, map.size)));
  assert.equal(map.militaryBases.length, available.length ? 2 : 1);
  const center = map.militaryBases[0];
  assert.ok(center.center && center.x === map.size / 2 && center.y === map.size / 2);
  assert.equal(center.big, !available.length);
  assert.equal(map.crates[map.legendaryCrateId].militaryBase, center.id);
  assert.ok(map.crates.every(c => !['token', 'classToken'].includes(c.tier) || c.militaryBase));
  for (const base of map.militaryBases) {
    sizes.add(base.big);
    if (!base.center) {
      zones.add(base.zone);
      const zone = available.find(z => z.id === base.zone);
      assert.ok(zone);
      const dx = zone.x2 - zone.x1, dy = zone.y2 - zone.y1, len = Math.hypot(dx, dy);
      for (const side of [-1, 1]) for (const end of [-1, 1]) {
        const x = (base.x + side * base.halfW) / map.size - zone.x1, y = (base.y + end * base.halfH) / map.size - zone.y1;
        assert.ok(Math.abs(x * dy - y * dx) / len <= zone.halfWidth);
        assert.ok(x * dx + y * dy >= 0 && x * dx + y * dy <= len * len);
      }
    }
    const inBase = p => p.militaryBase === base.id;
    const houses = map.buildings.filter(inBase), crates = map.crates.filter(inBase), stations = map.stations.filter(inBase);
    const vehicles = world.vehicles.filter(inBase), guards = map.militaryStructures.filter(inBase);
    const loot = base.big ? 3 : 1, defense = base.big ? 2 : 1;
    assert.equal(houses.length, base.big ? 25 : 10);
    assert.equal(stations.length, houses.length);
    for (const house of houses) {
      assert.ok(house.style === 'barracks' && house.x > base.x && house.w * house.h === 3 * 240 * 220);
      const station = stations.filter(s => s.building === house.id);
      assert.equal(station.length, 1);
      const houseLoot = crates.filter(c => c.building === house.id);
      for (const [tier, min] of [['epic', 2], ['rare', 1], ['common', 1]]) {
        assert.ok(houseLoot.filter(c => c.tier === tier).length >= min);
      }
      assert.ok(houseLoot.concat(station).every(p => p.x > house.x && p.x < house.x + house.w &&
        p.y > house.y && p.y < house.y + house.h));
      for (const door of house.doorways) {
        assert.equal(door.side, 'left');
        for (const offset of [-35, 0, 35]) {
          assert.ok(world.spotFree(door.x + door.w / 2 + offset, door.y + door.h / 2, W.CONFIG.playerRadius, true), 'clear barracks entrance');
        }
      }
    }
    for (const [tier, n] of [['epic', 20], ['rare', 10], ['common', 10], ['token', 3], ['classToken', 2], ['legendary', base.center ? 1 : 0]]) {
      assert.equal(crates.filter(c => c.tier === tier).length, n * loot);
    }
    assert.ok(crates.filter(c => c.tier === 'token').every(c => Number.isInteger(c.building)));
    assert.ok(crates.filter(c => c.tier === 'classToken').every(c => c.size > W.CONFIG.crateSize));
    assert.ok(vehicles.every(v => v.x < base.x));
    assert.equal(vehicles.filter(v => v.type === 'tank').length, 10 * defense);
    assert.equal(vehicles.filter(v => v.type === 'artillery' && !v.fixed).length, 10 * defense);
    assert.equal(vehicles.filter(v => v.type === 'artillery' && v.fixed).length, 5 * defense);
    for (const vehicle of vehicles) for (const seat of W.VEHICLE_SEATS) {
      const at = world.vehicleSeatPoint(vehicle, seat, true);
      assert.ok(world.spotFree(at.x, at.y, W.CONFIG.playerRadius, true), 'clear military vehicle boarding point');
    }
    assert.equal(guards.filter(s => s.item === 'turret3' && s.aiRider).length, 4 * defense);
    assert.equal(guards.filter(s => s.item === 'sentry3' && s.guardRole === 'perimeter').length, 7 * defense);
    assert.equal(guards.filter(s => s.item === 'sentry3' && s.guardRole === 'vault').length, 3 * defense);
    assert.ok(map.rocks.concat(map.cacti, map.trees, map.bushes, map.ponds).every(p =>
      Math.abs(p.x - base.x) >= base.halfW || Math.abs(p.y - base.y) >= base.halfH));
    assert.ok(map.towns.every(t => Math.abs(t.x - base.x) >= t.halfW + base.halfW || Math.abs(t.y - base.y) >= t.halfH + base.halfH));
  }
}
assert.equal(sizes.size, 2);
assert.equal(zones.size, 3);
console.log('Military base maps passed for all three placement zones and the big-base fallback.');
