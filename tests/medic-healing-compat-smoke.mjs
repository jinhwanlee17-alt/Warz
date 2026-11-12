import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(), t = suite('Medic overheal compatibility'), X = 5000, Y = 5000;
function arena(classId = 'medic') {
  const map = { seed: 53, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], nextPickupId: 1 };
  const world = new W.World({ map, teams: true, storm: false });
  const magic = world.addPlayer({ classId: 'magicmedic', x: X, y: Y, team: 1 });
  const medic = world.addPlayer({ classId, x: X + 40, y: Y, team: 1 });
  const target = world.addPlayer({ classId: 'shotgunner3', x: X + 80, y: Y, team: 1 });
  target.hp = 150;
  world.useMedkit(magic, { aimX: target.x, aimY: target.y });
  return { world, magic, medic, target };
}
for (const classId of ['medic', 'medic2']) {
  const { world, magic, medic, target } = arena(classId);
  t.equal(target.hp, 450, classId + ': fixture receives real Magic Medic overheal');
  t.equal(world.useMedkit(medic), false, classId + ': full and overhealed allies do not consume a regular medkit');
  t.equal(medic.medkitCd, 0, classId + ': denied healing starts no cooldown');
  t.equal(target.hp, 450, classId + ': full-health denial preserves overheal');
  medic.hp = 50;
  t.equal(world.useMedkit(medic), true, classId + ': injured Medic can still use their ordinary medkit');
  t.equal(medic.hp, classId === 'medic' ? 80 : 100, classId + ': ordinary self healing retains its original amount');
  t.equal(target.hp, 450, classId + ': healing another patient cannot subtract an overhealed ally health');
  t.equal(medic.stats.healed, classId === 'medic' ? 30 : 50, classId + ': stats contain only positive healing');
  medic.medkitCd = 0; magic.medkitCd = 0;
  world.useMedkit(magic, { aimX: medic.x, aimY: medic.y });
  const before = medic.hp;
  t.equal(world.useMedkit(medic), false, classId + ': overhealed Medic cannot spend ordinary medkit while all allies are healthy');
  t.equal(medic.hp, before, classId + ': self overheal is preserved too');
}
{
  const { world, medic, target } = arena('medic2');
  const downed = world.addPlayer({ x: X + 110, y: Y, team: 1 });
  world.downPlayer(downed, null, 'pistol');
  t.equal(world.useMedkit(medic), true, 'Medic II may spend a medkit solely to revive a downed ally');
  t.check(!downed.downed && downed.hp === downed.maxHp / 2, 'ordinary Medic II revive still restores half health');
  t.equal(medic.medkitCd, W.WEAPONS.medkit2.cooldown, 'successful Medic II revive starts its existing cooldown');
  t.equal(target.hp, 450, 'reviving one ally leaves a different overhealed ally unchanged');
}
for (const item of Object.values(W.ITEMS).filter(it => it.kind === 'consume' && it.heal)) {
  const { world, target } = arena();
  target.items[0] = { id: item.id, n: 1 }; target.held = 0;
  t.equal(world.useHeld(target, { firePressed: true }), false, item.id + ': capped healing is rejected above its maximum');
  t.equal(target.hp, 450, item.id + ': rejected consumption cannot remove Magic Medic overheal');
  t.equal(target.items[0].n, 1, item.id + ': rejected consumption preserves the item');
}
{
  const { world, magic, target } = arena();
  const regenItem = Object.values(W.ITEMS).find(it => it.heal && it.over);
  target.hp = 50; magic.medkitCd = 0;
  t.equal(world.consumeItem(target, regenItem), true, 'healing-over-time item starts while the patient is injured');
  world.useMedkit(magic, { aimX: target.x, aimY: target.y });
  world.tickEffects(target, 1);
  t.equal(target.hp, 350, 'pending regeneration cannot erase overheal supplied by the Magic Medic');
  t.equal(target.regen, 0, 'ordinary regeneration ends safely when health exceeds its cap');
}
t.done();
