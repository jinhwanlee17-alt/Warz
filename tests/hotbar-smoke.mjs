// Ten hotbar slots for every class, empty-hand selection and the item slot a third class tool closes, through actual shared player input.
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
  const open = W.Controls.itemOrder(p), closed = W.Rules.closedItemSlots(p);
  t.equal(p.items.length, 8, classId + ': eight item entries are stored for every class');
  t.equal(p.weapons.length + open.length, 10, classId + ': exactly ten hotbar slots');
  t.equal(closed, p.weapons.length - 2, classId + ': each class tool beyond the second closes one item slot');
  t.check(p.items.every((s, index) => world.itemSlotOpen(p, index) === open.includes(index)) && !world.itemSlotOpen(p, 8) && !world.itemSlotOpen(p, -1) && !world.itemSlotOpen(p, 1.5),
    classId + ': the simulation and the HUD agree on which item slots are open');
  t.equal(open.map(index => W.Controls.primary(W.Controls.itemAction(p, index))).join(), ['3', '4', '5', '6', '7', '8', '9', '0'].slice(closed).join(), classId + ': item index i sits on hotbar slot i + 3');
  for (let index = 0; index < closed; index++) {
    world.events = [];
    p.controller = () => ({ held: index, aimX: 5500, aimY: 5000 }); world.update(1 / 60);
    t.check(p.held === -1 && !world.events.some(e => e.type === 'switch'), classId + ': closed item ' + index + ' cannot be selected');
    t.check(world.addItem(p, 'bandage', 1) === 0 && p.items[index] === null && p.items[closed].id === 'bandage', classId + ': closed item ' + index + ' takes no item; the first open slot does');
    p.items[closed] = null;
  }
  p.controller = () => ({ held: 8, aimX: 5500, aimY: 5000 }); world.update(1 / 60);
  t.equal(p.held, -1, classId + ': there is no ninth item slot to select');
  for (const index of open) {
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
  const list = () => p.items.map(s => s ? s.id + ':' + s.n : '-').join();
  world.addItem(p, 'bandage', 2); world.addItem(p, 'smoke', 1); world.addItem(p, 'riotshield', 1);
  t.equal(list(), 'bandage:2,smoke:1,riotshield:1,-,-,-,-,-', 'a two-tool class fills item slots from hotbar slot 3');
  const items = p.items, bandages = p.items[0];
  p.held = 0;
  world.setClass(p, 'engineer', false);
  t.equal(p.weapons.map(w => w.id).join(), 'wrench,pistol,engineerhammer', 'Engineer has three permanent class tools');
  t.check(p.items === items && p.items[3] === bandages && list() === '-,smoke:1,riotshield:1,bandage:2,-,-,-,-',
    'becoming Engineer moves the slot-3 stack to the first free item slot and leaves every other stack on its index');
  t.equal(p.held, 3, 'a held stack stays held when it moves');
  t.check(world.map.pickups.length === 0 && !world.events.some(e => e.type === 'item-dropped'), 'nothing drops while an item slot is free');
  t.equal(W.Controls.itemOrder(p).map(i => p.items[i] ? p.items[i].id : '-').join(), 'smoke,riotshield,bandage,-,-,-,-', 'the hammer takes hotbar slot 3 and the seven item slots follow: ten slots, no extra one');
  world.selectItem(p, 0);
  t.equal(p.held, 3, 'the closed slot cannot be selected, and asking for it does not put the held item away');
  p.held = -1;
  world.switchSlot(p, 2);
  world.update(0.2);
  t.equal(p.weapons[p.slot].id, 'engineerhammer', 'third weapon slot equips the Engineer hammer');
  const foe = world.addPlayer({ x: 5060, y: 5000, team: 2 }); foe.hp = foe.maxHp = 100;
  p.angle = 0; p.controller = () => ({ fire: true, firePressed: true, aimX: foe.x, aimY: foe.y });
  world.update(1 / 60);
  t.equal(foe.hp, 70, 'equipped Engineer hammer hits for 30 damage');
  world.setClass(p, 'soldier', false);
  t.check(p.weapons.length === 2 && p.items === items && list() === '-,smoke:1,riotshield:1,bandage:2,-,-,-,-', 'leaving Engineer reopens the first item slot without moving or discarding inventory');
  t.check(world.addItem(p, 'grenade', 1) === 0 && p.items[0].id === 'grenade', 'the reopened slot takes the next item');
}
{
  // Every item slot occupied: the displaced stack has nowhere to go.
  const { world, p } = arena('soldier');
  const ids = ['bandage', 'smoke', 'riotshield', 'grenade', 'smoothie', 'energybar', 'flashbang', 'firenade'];
  ids.forEach(id => world.addItem(p, id, id === 'bandage' ? 5 : 1));
  t.equal(p.items.map(s => s.id).join(), ids.join(), 'eight different stacks fill a two-tool hotbar');
  p.held = 0; world.events = [];
  world.setClass(p, 'magicmedic', false);
  t.check(p.items[0] === null && p.items.slice(1).map(s => s.id).join() === ids.slice(1).join(), 'with a full hotbar the seven other stacks keep their slots');
  const drops = world.map.pickups.filter(pk => pk.alive);
  t.check(drops.length === 1 && drops[0].type === 'item' && drops[0].item === 'bandage' && drops[0].amount === 5, 'the displaced stack drops whole as an ordinary item pickup');
  t.check(drops[0].x === p.x && drops[0].y === p.y && drops[0].vx === 0 && drops[0].vy === 0 && !(drops[0].lockT > 0), 'it lies at the player\'s feet, not scattered or locked');
  t.equal(p.held, -1, 'a selection on the dropped stack is cleared');
  t.check(world.events.filter(e => e.type === 'item-dropped').length === 1 && world.events.some(e => e.type === 'item-dropped' && e.player === p && e.item === 'bandage' && e.amount === 5 && e.reason === 'noroom'),
    'the owner is told once that the stack dropped for lack of room');
  t.check(world.events.some(e => e.type === 'spawn-pickup' && e.pickup === drops[0]), 'the drop is replicated like any other new pickup');
  t.equal(world.nearestItemPickup(p), drops[0], 'the dropped stack offers the normal pickup prompt');
  world.events = [];
  t.check(world.pressInteract(p) && drops[0].alive && p.items[0] === null && world.events.some(e => e.type === 'deny' && e.reason === 'full'), 'seven occupied slots are a full hotbar for a three-tool class: the closed slot takes nothing back');
  world.takeItem(p, 4, 1);
  t.check(world.pressInteract(p) && !drops[0].alive && p.items[4].id === 'bandage' && p.items[4].n === 5 && p.items[0] === null, 'after freeing a slot the stack is picked up into it');
  world.setClass(p, 'magicmedic', false);
  t.check(world.map.pickups.filter(pk => pk.alive).length === 0 && p.items[4].id === 'bandage', 'setting the same class again moves and drops nothing');
}
{
  // Selecting the empty slot that then closes.
  const { world, p } = arena('soldier');
  p.held = 0;
  world.setClass(p, 'engineer', false);
  t.equal(p.held, -1, 'empty hands on the slot that closes return to the class weapon');
}
{
  // The client mirror keeps a one-entry stand-in for what another player holds; only the server rearranges hotbars.
  const map = { seed: 19, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
    pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], tanks: [], nextPickupId: 1 };
  const world = new W.World({ map, remote: true });
  const p = world.addPlayer({ x: 5000, y: 5000, team: 1 });
  p.items[0] = { id: 'bandage', n: 1 }; p.held = 0;
  world.events = [];
  world.setClass(p, 'engineer', false);
  t.check(p.weapons.length === 3 && p.items[0] && p.items[0].id === 'bandage' && p.held === 0 && map.pickups.length === 0 && world.events.length === 0,
    'a remote mirror changes class without moving, dropping or deselecting anything');
}
{
  // world.js is also loaded without items.js.
  const bare = loadWarz(['config', 'util', 'map', 'world']), q = { classId: 'soldier', hp: 100 };
  bare.World.prototype.setClass.call({}, q, 'engineer', true);
  t.equal(q.weapons.length, 3, 'setClass still works where items.js is not loaded');
}
t.done();
