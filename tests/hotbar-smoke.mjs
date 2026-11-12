// Empty-hand selection and Engineer's additional class slot use actual shared player input.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls']);
const t = suite('Dynamic hotbar');
function arena(classId) {
  const map = { seed: 19, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
    pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], tanks: [], nextPickupId: 1 };
  const world = new W.World({ map, storm: false });
  const p = world.addPlayer({ x: 5000, y: 5000, classId, team: 1 });
  return { world, p };
}
for (const classId of Object.keys(W.CLASSES).filter(id => !W.CLASSES[id].locked)) {
  const { world, p } = arena(classId);
  p.items = [null, null, null];
  for (let index = 0; index < 3; index++) {
    world.switchSlot(p, 0);
    p.controller = () => ({ held: index, aimX: 5500, aimY: 5000 }); world.update(1 / 60);
    t.equal(p.held, index, classId + ': empty item ' + index + ' can be selected');
    const shots = p.stats.shots, before = JSON.stringify(p.weapons);
    world.events = [];
    p.controller = () => ({ fire: true, firePressed: true, aimX: 5500, aimY: 5000 });
    for (let tick = 0; tick < 5; tick++) world.update(1 / 60);
    t.equal(p.held, index, classId + ': clicking empty item ' + index + ' keeps empty hands');
    t.check(p.stats.shots === shots && JSON.stringify(p.weapons) === before, classId + ': empty-hand fire cannot use a stowed class weapon');
    t.check(!world.events.some(e => e.type === 'deny'), classId + ': empty-hand fire produces no denied-use spam');
    t.equal(world.aimedProjectile(p), null, classId + ': empty item has no stowed-weapon trajectory');
  }
}
{
  const { world, p } = arena('soldier');
  p.items = [{ id: 'bandage', n: 2 }, { id: 'smoke', n: 1 }, { id: 'riotshield', n: 1 }];
  const items = p.items, contents = JSON.stringify(items);
  world.setClass(p, 'engineer', false);
  t.check(p.items === items && JSON.stringify(p.items) === contents, 'becoming Engineer preserves every inventory stack and its storage index');
  t.equal(p.weapons.map(w => w.id).join(), 'wrench,pistol,engineerhammer', 'Engineer has three permanent class tools');
  t.equal(W.Controls.itemOrder(p).map(i => p.items[i].id).join(), 'smoke,riotshield,bandage', 'existing third-slot item appears in slot six with the other items unchanged');
  world.switchSlot(p, 2);
  world.update(0.2);
  t.equal(p.weapons[p.slot].id, 'engineerhammer', 'third weapon slot equips the Engineer hammer');
  const foe = world.addPlayer({ x: 5060, y: 5000, team: 2 }); foe.hp = foe.maxHp = 100;
  p.angle = 0; p.controller = () => ({ fire: true, firePressed: true, aimX: foe.x, aimY: foe.y });
  world.update(1 / 60);
  t.equal(foe.hp, 70, 'equipped Engineer hammer hits for 30 damage');
  world.setClass(p, 'soldier', false);
  t.check(p.weapons.length === 2 && p.items === items && JSON.stringify(p.items) === contents, 'leaving Engineer restores five-slot layout without discarding inventory');
}
t.done();
