// Crates by tier, the hotbar and every item: consumables and potions, throwables and zones, structures (rock, turret,
// sentry, teleporter), riot shield, strikes, drone, radar, invisibility, death drops and the client mirror.
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz();
const t = suite('items');
const { CONFIG: C, ITEMS, CRATES, Rules, MapGen, World, WEAPONS } = W;
const DT = 1 / 60;

function range(extra) {
  const map = MapGen.generate(5);
  map.rocks = []; map.trees = []; map.bushes = []; map.buildings = []; map.crates = []; map.pickups = []; map.ponds = []; map.stations = [];
  Object.assign(map, extra || {});
  return map;
}
function crate(id, x, y, tier) { const tr = CRATES[tier || 'common']; return { id, x, y, size: C.crateSize, tier: tier || 'common', hp: tr.hp, maxHp: tr.hp, alive: true, shake: 0 }; }
function steps(world, seconds) { for (let i = 0; i < Math.round(seconds / DT); i++) world.update(DT); }
function idle(p, ax, ay) { p.controller = () => ({ mx: 0, my: 0, aimX: ax, aimY: ay }); }
function once(world, p, intent) { p.controller = () => intent; world.update(DT); idle(p, intent.aimX, intent.aimY); }
function give(world, p, id, n) { return world.addItem(p, id, n || ITEMS[id].found); }
function slotOf(p, id) { return p.items.findIndex((s) => s && s.id === id); }
function hold(world, p, id, ax, ay) {
  if (slotOf(p, id) < 0) give(world, p, id);
  const i = slotOf(p, id);
  if (p.held !== i) once(world, p, { mx: 0, my: 0, aimX: ax === undefined ? p.x + 100 : ax, aimY: ay === undefined ? p.y : ay, held: i });
  return i;
}
function use(world, p, id, ax, ay) {
  ax = ax === undefined ? p.x + 100 : ax; ay = ay === undefined ? p.y : ay;
  hold(world, p, id, ax, ay);
  p.itemCd = 0; // skip the short anti-double-click cooldown between uses (tested on its own below)
  // These item-effect scenarios keep their chosen landing positions by charging to that distance.
  const charge = ITEMS[id].kind === 'throw' ? Math.max(0, Math.min(1, (Math.hypot(ax - p.x, ay - p.y) - 70) / (WEAPONS.grenade.throwRange - 70))) * C.projectileChargeTime : 0;
  once(world, p, { mx: 0, my: 0, aimX: ax, aimY: ay, firePressed: true, charge });
}
function fireOnce(world, p, ax, ay) {
  p.controller = () => ({ mx: 0, my: 0, aimX: ax, aimY: ay, fire: true, firePressed: true });
  world.update(DT);
  idle(p, ax, ay);
  steps(world, 0.8);
}
function walk(world, p, mx, my, seconds) { const x0 = p.x, y0 = p.y; for (let i = 0; i < Math.round(seconds / DT); i++) world.moveStep(p, { mx, my }, DT); return Math.hypot(p.x - x0, p.y - y0); }
const events = (world, type) => world.events.filter((e) => e.type === type);
const pickups = (world, type) => world.map.pickups.filter((pk) => pk.alive && pk.type === type);

// ---------------------------------------------------------------- crates on the island
for (const seed of [1, 42, 9001]) {
  const m = MapGen.generate(seed), tiers = {};
  m.crates.forEach((c) => { tiers[c.tier] = (tiers[c.tier] || 0) + 1; });
  const q = Rules.crateQuota(m.crates.length);
  t.equal(m.crates.length, 211, 'seed ' + seed + ': 210 regular crates plus the center legendary crate');
  t.check(W.CRATE_ORDER.every((id) => (tiers[id] || 0) === q[id]), 'seed ' + seed + ': crates dealt by tier ' + JSON.stringify(tiers));
  t.check((tiers.legendary || 0) >= 1 && (tiers.mythic || 0) >= 1 && (tiers.epic || 0) >= 5, 'seed ' + seed + ': rare crates exist');
  t.check(m.crates.filter((c) => c.tier === 'legendary').every((c) => c.hp === CRATES.legendary.hp), 'seed ' + seed + ': legendary crates are tougher');
}

// ---------------------------------------------------------------- loot by tier
{
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 });
  const stats = (tier, n) => {
    let tokens = 0, items = 0, armor = 0, byTier = {};
    for (let i = 0; i < n; i++) {
      const c = crate(i, 5000, 5000, tier);
      world.map.crates = [c];
      const before = world.map.pickups.length;
      world.damageCrate(c, 999, p.id, 5000, 5000);
      const added = world.map.pickups.slice(before);
      tokens += added.filter((pk) => pk.type === 'token').length;
      added.filter((pk) => pk.type === 'item').forEach((pk) => { items++; byTier[ITEMS[pk.item].tier] = (byTier[ITEMS[pk.item].tier] || 0) + 1; });
      armor += added.filter((pk) => pk.type === 'armor').length;
    }
    return { tokens, items, armor, byTier };
  };
  const common = stats('common', 600);
  t.check(common.tokens >= 600 && common.tokens <= 720, 'common crates: 1 token, sometimes 2 (' + common.tokens + ' from 600)');
  t.check(common.items > 150 && common.items < 270, 'common crates: an item about 35% of the time (' + common.items + ' of 600)');
  t.check(!common.byTier.mythic && !common.byTier.legendary, 'common crates never hold mythic or legendary items');
  t.check(common.armor > 10 && common.armor < 60, 'common crates: armor plate about 5% of the time (' + common.armor + ' of 600)');
  const rare = stats('rare', 300);
  t.check(rare.items === 300, 'rare crates always hold an item');
  t.check(rare.tokens >= 600 && rare.tokens <= 1200, 'rare crates: 2 to 4 tokens (' + rare.tokens + ' from 300)');
  t.check((rare.byTier.mythic || 0) > 10 && !rare.byTier.legendary, 'rare crates: some mythic, never legendary');
  const epic = stats('epic', 300);
  t.check(epic.items === 300 && !epic.byTier.common && (epic.byTier.legendary || 0) > 3, 'epic crates: rare or better, a few legendary');
  const legendary = stats('legendary', 50);
  t.check(legendary.items === 200 && legendary.byTier.legendary === 200, 'each legendary crate drops all four legendary items');
  const myth = stats('mythic', 300);
  t.check(myth.items === 300 && (myth.byTier.legendary || 0) > 15, 'mythic crates: legendary about 10% of the time (' + (myth.byTier.legendary || 0) + ' of 300)');
}

// ---------------------------------------------------------------- hotbar
{
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 });
  t.equal(p.items.length, 3, 'three item slots');
  t.equal(p.weapons.length + p.items.length, 5, 'weapons and items share a five-slot hotbar');
  t.equal(world.addItem(p, 'bandage', 12), 0, 'twelve bandages fit (stacks of 9)');
  t.check(p.items[0].n === 9 && p.items[1].n === 3, 'stacked 9 + 3');
  t.equal(world.countItem(p, 'bandage'), 12, 'count across stacks');
  Rules.itemsOfTier('rare').slice(0, C.hotbarSize - 2).forEach((id) => world.addItem(p, id, ITEMS[id].stack));
  t.check(!world.canTake(p, 'grenade'), 'a full hotbar takes nothing new');
  t.check(world.canTake(p, 'bandage'), 'but a partial stack still has room');
  t.equal(world.addItem(p, 'turret', 1), 1, 'overflow is returned');
  world.takeItem(p, 1, 3);
  t.check(p.items[1] === null, 'an emptied stack frees its slot');
  idle(p, 3300, 3200);
  once(world, p, { mx: 0, my: 0, aimX: 3300, aimY: 3200, held: 0 });
  t.equal(p.held, 0, 'hotbar key holds that slot');
  once(world, p, { mx: 0, my: 0, aimX: 3300, aimY: 3200, held: 0 });
  t.equal(p.held, -1, 'pressing it again puts the item away');
  once(world, p, { mx: 0, my: 0, aimX: 3300, aimY: 3200, held: 1 });
  t.check(p.held === 1 && !events(world, 'deny').some((e) => e.reason === 'emptyslot'), 'an empty slot can be selected without a denied-use message');
  once(world, p, { mx: 0, my: 0, aimX: 3300, aimY: 3200, held: 0 });
  once(world, p, { mx: 0, my: 0, aimX: 3300, aimY: 3200, slot: 0 });
  t.equal(p.held, -1, 'weapon key puts the item away');
  once(world, p, { mx: 0, my: 0, aimX: 3300, aimY: 3200, held: 2 });
  t.equal(p.held, 2, 'the last item card (overall slot 5) can be selected');
  once(world, p, { mx: 0, my: 0, aimX: 3300, aimY: 3200, held: 3 });
  t.equal(p.held, 2, 'there is no hidden fourth item slot to select');
}

// ---------------------------------------------------------------- picking items up
{
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 });
  idle(p, 3300, 3200);
  const bandages = world.spawnPickup('item', 3250, 3200, 3, false, 'bandage');
  world.spawnPickup('armor', 3160, 3200, 1, false);
  world.spawnPickup('token', 3200, 3200, 2, false);
  world.spawnPickup('key', 3200, 3200, 1, false);
  steps(world, 1);
  t.equal(world.countItem(p, 'bandage'), 0, 'walking near items does not collect them');
  t.check(bandages.alive && bandages.x === 3250 && bandages.y === 3200, 'items do not magnet toward the player');
  once(world, p, { mx: 0, my: 0, interactPressed: true });
  t.equal(world.countItem(p, 'bandage'), 3, 'pressing E collects the nearby item stack');
  t.equal(p.armor, C.armorPlate, 'an armor plate grants 25 armor');
  t.check(p.tokens === 2 && p.keys === 1, 'tokens and keys still collect automatically');
  world.spawnPickup('armor', 3160, 3200, 1, false); world.spawnPickup('armor', 3160, 3200, 1, false); world.spawnPickup('armor', 3160, 3200, 1, false); world.spawnPickup('armor', 3160, 3200, 1, false);
  steps(world, 1);
  t.equal(p.armor, C.armorMax, 'armor caps at 100');
  t.equal(pickups(world, 'armor').length, 1, 'extra plates stay on the ground once armor is full');
  world.damagePlayer(p, 30, null, 'test');
  t.check(p.armor === 70 && p.hp === 100, 'armor absorbs damage before HP');
  W.ITEM_ORDER.filter((id) => ITEMS[id].tier !== 'common').slice(0, 10).forEach((id) => world.addItem(p, id, ITEMS[id].stack));
  world.events.length = 0;
  world.spawnPickup('item', 3235, 3200, 1, false, 'grenade');
  steps(world, 1);
  t.check(pickups(world, 'item').length === 1 && events(world, 'deny').length === 0, 'a full hotbar leaves ground items alone without repeated warnings');
  t.equal(world.nearestItemPickup(p).item, 'grenade', 'full items still qualify for the interact prompt');
  once(world, p, { mx: 0, my: 0, interactPressed: true });
  t.check(pickups(world, 'item').length === 1 && events(world, 'deny').filter((e) => e.reason === 'full').length === 1, 'pressing E with a full hotbar leaves the item and warns once');
}

// ---------------------------------------------------------------- manual pickup and selected-stack dropping
{
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 });
  give(world, p, 'bandage', 8); give(world, p, 'grenade', 5); give(world, p, 'riotshield', 1);
  const pk = world.spawnPickup('item', 3230, 3200, 4, false, 'bandage');
  world.events.length = 0;
  t.check(world.pressInteract(p), 'E can fill a partial stack even with all three slots occupied');
  t.equal(world.countItem(p, 'bandage'), 9, 'only the one available stack space is filled');
  t.check(!pk.alive && pk.amount === 1, 'collected pickup event records the actual quantity taken');
  const remainder = pickups(world, 'item');
  t.check(remainder.length === 1 && remainder[0].amount === 3, 'three remaining bandages stay on the ground exactly once');
  t.check(events(world, 'pickup').length === 1 && events(world, 'pickup')[0].amount === 1, 'pickup text reports one bandage, not the entire source stack');
  t.check(!world.collect(p, pk), 'a consumed pickup cannot be collected a second time');
  t.equal(world.countItem(p, 'bandage'), 9, 'double collect cannot duplicate items');
  const weaponsBefore = JSON.stringify(p.weapons);
  t.check(!world.dropHeld(p) && events(world, 'deny').some(e => e.reason === 'noitem'), 'Q on a weapon reports no selected item');
  t.equal(JSON.stringify(p.weapons), weaponsBefore, 'class weapons stay equipped');
  p.held = 2; p.shieldUp = true;
  world.events.length = 0;
  t.check(world.dropHeld(p), 'Q drops a held riot shield');
  const shield = pickups(world, 'item').find(s => s.item === 'riotshield');
  t.check(!!shield && shield.amount === 1 && shield.lockT > 0, 'new drop has its exact count and a short pickup lock');
  t.check(p.items[2] === null && p.held === -1 && !p.shieldUp, 'dropping frees the slot and lowers the shield immediately');
  t.check(shield.x > p.x && Math.hypot(shield.x - p.x, shield.y - p.y) <= W.ItemRules.PICKUP_RANGE, 'drop lands ahead of the player within E reach');
  t.check(events(world, 'item-dropped').length === 1 && events(world, 'item-dropped')[0].item === 'riotshield', 'drop emits one owner feedback event');
  t.check(!world.collect(p, shield), 'a fresh drop cannot be collected in the same tick');
  t.check(!world.dropHeld(p), 'repeating Q after drop cannot duplicate the stack');
  world.map.pickups = [shield];
  t.equal(world.nearestItemPickup(p), null, 'locked drops do not get an E prompt');
  steps(world, 0.5);
  t.check(shield.alive && shield.lockT === 0 && world.countItem(p, 'riotshield') === 0, 'unlocking does not automatically pick the item up');
  t.check(world.pressInteract(p) && !shield.alive && world.countItem(p, 'riotshield') === 1, 'E can recover the dropped item after the lock');
  p.held = 0; world.events.length = 0;
  once(world, p, { mx: 0, my: 0, aimX: 3300, aimY: 3200, dropPressed: true, fire: true, firePressed: true });
  t.equal(world.countItem(p, 'bandage'), 0, 'Q drops the whole selected stack');
  t.check(pickups(world, 'item').some(s => s.item === 'bandage' && s.amount === 9), 'all nine bandages are conserved on the ground');
  t.check(events(world, 'shot').length === 0 && events(world, 'item-used').length === 0, 'Q suppresses accidental firing/using in the same frame');
  const grenadeSlot = slotOf(p, 'grenade'); p.held = -1;
  once(world, p, { mx: 0, my: 0, held: grenadeSlot, dropPressed: true, firePressed: true });
  t.check(world.countItem(p, 'grenade') === 0 && world.grenades.length === 0, 'selecting then dropping in one tick drops instead of throwing');
}
{
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 });
  const far = world.spawnPickup('item', 3286, 3200, 1, false, 'grenade');
  const near = world.spawnPickup('item', 3225, 3200, 1, false, 'bandage');
  const next = world.spawnPickup('item', 3250, 3200, 1, false, 'smoothie');
  const locked = world.spawnPickup('item', 3205, 3200, 1, false, 'drone', 2);
  t.equal(world.nearestItemPickup(p), near, 'nearest eligible item is selected, skipping locked loot');
  t.check(world.pressInteract(p) && !near.alive && next.alive, 'one press collects only the nearest item');
  t.check(world.pressInteract(p) && !next.alive && far.alive, 'the next press collects the next nearby item');
  t.equal(world.nearestItemPickup(p), null, 'items beyond 85px and locked drops have no prompt');
  t.check(!world.collect(p, far) && far.alive, 'out-of-range direct pickup is also rejected');
  const onPlayer = world.spawnPickup('item', p.x, p.y, 1, false, 'grenade');
  steps(world, 0.5);
  t.check(onPlayer.alive, 'standing directly on an item still requires E');
  t.check(world.pressInteract(p) && !onPlayer.alive, 'E works directly on top of an item');
}
{
  const wall = { walls: [{ x: 3230, y: 3150, w: 12, h: 100 }] };
  const world = new World({ map: range({ buildings: [wall] }), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 });
  const blocked = world.spawnPickup('item', 3255, 3200, 1, false, 'turret');
  t.equal(world.nearestItemPickup(p), null, 'a close item behind a wall is not an interact target');
  t.check(!world.pressInteract(p) && blocked.alive && !world.collect(p, blocked), 'E and collect cannot take items through walls');
  give(world, p, 'bandage', 3); p.held = 0; p.angle = 0;
  t.check(world.dropHeld(p), 'an item can be dropped while facing a nearby wall');
  const drop = pickups(world, 'item').find(s => s.item === 'bandage');
  t.check(drop.x + 12 <= 3230 && world.lineClear(p.x, p.y, drop.x, drop.y), 'the drop backs up to this side of the wall instead of disappearing through it');
}
{
  const world = new World({ map: range(), storm: false, teams: true }), p = world.addPlayer({ x: 3200, y: 3200, team: 1 });
  const mate = world.addPlayer({ x: 3260, y: 3200, team: 1 });
  const pk = world.spawnPickup('item', 3210, 3200, 1, false, 'bandage');
  mate.downed = true; mate.downT = 30;
  t.check(!world.pressInteract(p) && pk.alive, 'reviving a nearby teammate has priority over picking up loot');
  mate.downed = false;
  const mount = world.addStruct({ kind: 'turret', item: 'turret', x: 3200, y: 3270, r: 24, hp: 100, owner: p.id, team: p.team });
  t.check(world.pressInteract(p) && !pk.alive && !p.mount, 'a nearby item is picked up before mounting a turret');
  give(world, p, 'grenade', 5); give(world, p, 'riotshield', 1);
  const full = world.spawnPickup('item', 3210, 3200, 1, false, 'turret');
  world.events.length = 0;
  t.check(world.pressInteract(p) && !p.mount && full.alive && events(world, 'deny')[0].reason === 'full', 'a full inventory denies E without accidentally mounting a turret');
  full.x = 3400;
  t.check(world.pressInteract(p) && p.mount === mount.id, 'turret mounting still works when there is no pickup target');
  p.held = 0;
  t.check(!world.dropHeld(p), 'mounted players cannot drop carried items');
  full.x = p.x; full.y = p.y;
  t.check(world.pressInteract(p) && !p.mount && full.alive, 'E dismounts before considering nearby loot');
  for (const state of ['dead', 'downed', 'landing']) {
    p.alive = state !== 'dead'; p.downed = state === 'downed'; p.dropT = state === 'landing' ? 1 : 0; p.held = 0;
    const before = JSON.stringify(p.items), count = pickups(world, 'item').length;
    t.check(!world.dropHeld(p) && !world.pressInteract(p) && !world.collect(p, full), state + ' player cannot drop or pick up an item');
    t.check(JSON.stringify(p.items) === before && pickups(world, 'item').length === count, state + ' interaction leaves inventory and ground unchanged');
  }
}
{
  const world = new World({ map: range(), remote: true }), p = world.addPlayer({ x: 3200, y: 3200 });
  give(world, p, 'bandage', 3); p.held = 0;
  const pk = world.spawnPickupAt({ id: 123, type: 'item', item: 'grenade', x: 3210, y: 3200, amount: 2 });
  const before = JSON.stringify(p.items);
  t.equal(world.nearestItemPickup(p), pk, 'remote client can find nearby pickup for its prompt');
  t.check(!world.dropHeld(p) && !world.pressInteract(p) && !world.collect(p, pk), 'remote mirrors await authoritative pickup and drop results');
  t.check(before === JSON.stringify(p.items) && pk.alive && world.map.pickups.length === 1, 'remote interaction calls never mutate inventory or ground loot');
  world.spawnPickupAt({ id: 123, type: 'item', item: 'grenade', x: 3210, y: 3200, amount: 2, lockT: 0.35 });
  t.equal(world.nearestItemPickup(p), null, 'replicated pickup locks also hide remote prompts briefly');
  steps(world, 0.5);
  t.equal(world.nearestItemPickup(p), pk, 'remote pickup lock expires cosmetically');
}

// ---------------------------------------------------------------- food, kits and potions
{
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 });
  idle(p, 3300, 3200);
  p.hp = 50;
  use(world, p, 'bandage');
  t.check(p.hp === 70 && world.countItem(p, 'bandage') === 2, 'bandage heals 20 and uses one of three');
  t.check(p.itemCd > 0.3, 'a short cooldown follows every use');
  once(world, p, { mx: 0, my: 0, aimX: 3300, aimY: 3200, firePressed: true });
  t.check(p.hp === 70 && world.countItem(p, 'bandage') === 2, 'so a double click does not use two');
  use(world, p, 'smoothie');
  t.equal(p.hp, 85, 'smoothie heals 15');
  p.hp = 10;
  use(world, p, 'health');
  t.equal(p.hp, 85, 'health potion heals 75 instantly');
  p.hp = 100;
  world.events.length = 0;
  use(world, p, 'bandage');
  t.check(p.hp === 100 && world.countItem(p, 'bandage') === 2 && events(world, 'deny').some((e) => e.reason === 'fullhp'), 'full HP: the bandage is not wasted');
  use(world, p, 'overheal');
  t.equal(p.hp, 130, 'overheal at 100 HP gives 130');
  p.hp = 80;
  use(world, p, 'overheal');
  t.equal(p.hp, 110, 'overheal at 80 HP gives 110');
  use(world, p, 'overheal');
  t.equal(p.hp, 130, 'overheal never passes 130');
  p.hp = 1;
  use(world, p, 'firstaid');
  steps(world, 7.5);
  t.check(p.hp > 45 && p.hp < 60, 'first aid kit heals over time (' + Math.round(p.hp) + ' HP after 7.5 s)');
  steps(world, 8);
  t.equal(Math.round(p.hp), 100, 'first aid kit heals 100 over 15 s (capped at max HP)');
  t.equal(p.regen, 0, 'regen ends');
}
{
  // Potion timers and their effects on speed and damage.
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 }), e = world.addPlayer({ x: 3600, y: 3200 });
  idle(p, 3600, 3200); idle(e, 3000, 3200);
  const base = walk(world, p, 1, 0, 1); p.x = 3200; p.y = 3200; p.vx = p.vy = 0;
  use(world, p, 'energybar');
  t.check(p.fx.energy > 19.5 && p.fx.energy <= 20, 'energy bar lasts 20 s');
  t.near(world.speedMul(p), 1.15, 1e-9, 'energy bar: +15% speed');
  const quick = walk(world, p, 1, 0, 1); p.x = 3200; p.y = 3200; p.vx = p.vy = 0;
  t.check(quick > base * 1.1, 'and you really move faster (' + Math.round(quick) + ' vs ' + Math.round(base) + ')');
  use(world, p, 'speed');
  t.check(p.fx.speed > 44.5 && world.speedMul(p) > 1.29, 'speed potion: 45 s, stacks with the energy bar');
  use(world, p, 'strength');
  t.check(p.fx.strength > 29.5 && world.damageMul(p) === 1.1, 'strength potion: +10% damage for 30 s');
  fireOnce(world, p, 3600, 3200);
  t.equal(e.hp, 89, 'an AR bullet now deals 11');
  use(world, e, 'shield');
  t.check(e.fx.shield > 29.5, 'shield potion lasts 30 s');
  e.hp = 100;
  fireOnce(world, p, 3600, 3200);
  t.near(e.hp, 100 - 11 * 0.85, 0.11, 'shield potion: 15% less damage taken');
  use(world, e, 'power');
  e.hp = 100;
  t.check(e.fx.power > 59.5 && world.speedMul(e) > 1.14 && world.damageMul(e) > 1.14, 'power potion: 1 minute of +15% speed and damage');
  fireOnce(world, p, 3600, 3200);
  t.near(e.hp, 100 - 11 * 0.85 * 0.85, 0.11, 'power potion: another 15% off incoming damage');
  // Shieldo shieldo: immune, then half damage.
  const s = world.addPlayer({ x: 3200, y: 3600 }), g = world.addPlayer({ x: 3600, y: 3600 });
  idle(g, 3200, 3600);
  use(world, s, 'shieldo');
  t.check(s.fx.immune > 0.9, 'shieldo: immune for 1 s');
  fireOnce(world, g, 3200, 3600);
  t.equal(s.hp, 100, 'shots do nothing while immune');
  steps(world, 0.5);
  fireOnce(world, g, 3200, 3600);
  t.equal(s.hp, 95, 'then 50% damage reduction (10 -> 5)');
  steps(world, 5);
  fireOnce(world, g, 3200, 3600);
  t.equal(s.hp, 85, 'full damage again after 5 s');
  s.hp = 100; s.fx.immune = 1;
  world.damagePlayer(s, 7, null, 'storm');
  t.equal(s.hp, 93, 'immunity never covers the storm');
}
{
  // Poison, mystery potion, invisibility and Power Potion II's death immunity.
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 }), e = world.addPlayer({ x: 3400, y: 3200 });
  idle(p, 3400, 3200); idle(e, 3000, 3200);
  use(world, p, 'poison', 3400, 3200);
  steps(world, 1.4);
  t.check(e.fx.poison > 8 && e.fx.poison <= 10, 'a thrown poison potion poisons the enemy it lands on');
  t.equal(p.fx.poison, 0, 'but never the thrower');
  t.near(world.speedMul(e), 0.5, 1e-9, 'poison halves movement speed');
  steps(world, 5);
  t.check(e.hp < 100 - 40 && e.hp > 100 - 65, 'poison deals about 10 per second (' + Math.round(100 - e.hp) + ' so far)');
  steps(world, 6);
  t.check(e.fx.poison === 0 && e.hp > 0, 'poison wears off after 10 s');
  const before = e.hp;
  steps(world, 1);
  t.equal(e.hp, before, 'and stops hurting');
  world.rng = W.U.rng(7);
  use(world, p, 'mystery');
  const rolled = events(world, 'buff').find((b) => b.effect === 'mystery');
  t.check(!!rolled && rolled.mystery && rolled.mystery !== 'nothing', 'mystery potion rolls a random effect (' + (rolled && rolled.mystery) + ')');
  use(world, p, 'invisibility');
  t.check(p.fx.invisible > 29.5 && !world.visibleTo(p, e) && world.visibleTo(p, p), 'invisibility: 30 s, enemies cannot see you');
  const victim = world.addPlayer({ x: 3200, y: 3800 });
  use(world, victim, 'power2');
  t.check(victim.fx.power > 74.5 && victim.fx.deathImmune > 9.5, 'power potion II: 1:15 of power and 10 s death immunity');
  world.damagePlayer(victim, 500, e.id, 'ar');
  t.check(victim.alive && victim.hp === 30, 'a killing blow leaves you at 30 HP');
  t.check(victim.fx.power === 0 && victim.fx.deathImmune === 0, 'and the potion is gone');
  t.check(events(world, 'saved').length === 1, 'saved event');
  world.damagePlayer(victim, 500, e.id, 'ar');
  t.check(!victim.alive, 'it only works once');
}

// ---------------------------------------------------------------- throwables and zones
{
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 }), e = world.addPlayer({ x: 3580, y: 3200 });
  idle(e, 3000, 3200);
  use(world, p, 'grenade', 3500, 3200);
  t.check(world.grenades.some((g) => g.item === 'grenade'), 'grenade item is thrown like a hand grenade');
  steps(world, 2.2);
  const boom = events(world, 'explosion');
  t.check(boom.length === 1 && boom[0].power === 100 && e.hp < 60 && e.alive, 'and bursts for up to 100 damage (' + Math.round(100 - e.hp) + ' from 80 away)');
  e.hp = 100;
  use(world, p, 'flashbang', 3500, 3200);
  steps(world, 2.2);
  t.check(e.fx.flash > 1.5 && events(world, 'flashed').some((f) => f.player === e), 'flash bang whites out players in the blast');
  t.equal(e.hp, 100, 'without hurting them');
  use(world, p, 'smoke', 3500, 3200);
  steps(world, 2.2);
  const smoke = world.zones.find((z) => z.kind === 'smoke');
  t.check(!!smoke && smoke.r === 450 && smoke.t > 11, 'smoke grenade: a 450-wide cloud for 12 s');
  t.check(events(world, 'burst').some((b) => b.item === 'smoke'), 'burst event for the client');
}
{
  const world = new World({ map: range(), storm: false, teams: true });
  const p = world.addPlayer({ x: 3200, y: 3200, team: 1 }), mate = world.addPlayer({ x: 3560, y: 3400, team: 1 }), e = world.addPlayer({ x: 3500, y: 3200, team: 2 });
  idle(mate, 3000, 3200); idle(e, 3000, 3200);
  use(world, p, 'firenade', 3500, 3200);
  steps(world, 1.2);
  const fire = world.zones.find((z) => z.kind === 'fire');
  t.check(!!fire && fire.r === 300 && fire.t > 3.5 && fire.t <= 5, 'grenade of fire bursts on landing into a 5 s fire wall');
  steps(world, 2);
  t.check(e.hp < 60 && e.hp >= 25, 'fire deals 25 per second to enemies inside after landing (' + Math.round(100 - e.hp) + ' damage)');
  t.equal(mate.hp, 100, 'your team walks through your fire');
  e.x = 4400; e.y = 4400; p.x = 3000; // step out before it burns you down
  steps(world, 3);
  t.check(!world.zones.some((z) => z.kind === 'fire'), 'the fire goes out after 5 s');
  t.check(e.alive, 'the enemy got out alive');
  e.hp = 100; e.x = 3600; e.y = 3200; p.x = 3200;
  world.spawnPickup('token', 3550, 3300, 1, false);
  use(world, p, 'blackhole', 3400, 3200);
  steps(world, 1.2);
  t.check(Math.hypot(e.x - 3400, e.y - 3200) < 40, 'black hole grenade pulls enemies within 450 into its middle');
  t.check(Math.hypot(mate.x - 3560, mate.y - 3400) < 1, 'but not your team');
  t.check(pickups(world, 'token').every((pk) => Math.hypot(pk.x - 3400, pk.y - 3200) < 40), 'loose pickups get sucked in too');
  e.hp = 100; e.x = 3500; e.y = 3200;
  use(world, p, 'snowbomb', 3500, 3200);
  steps(world, 2.2);
  const snow = world.zones.find((z) => z.kind === 'snow');
  t.check(!!snow && snow.r === 750 && snow.dur === 20, 'snowbomb: a twenty-second blizzard 750 wide');
  t.check(e.inSnow && world.speedMul(e) === 0.5, 'everyone inside moves at half speed');
  steps(world, 3);
  t.equal(e.hp, 100, 'no damage during the first 4 s inside');
  steps(world, 2.5);
  t.check(e.hp < 100 && e.hp >= 94, 'then storm-like damage ticks in (' + (100 - e.hp) + ')');
  steps(world, 4);
  t.check(world.zones.includes(snow) && e.inSnow && world.speedMul(e) === 0.5, 'snow and its slow remain active beyond the old ten-second lifetime');
  e.x = 4400; e.y = 4400;
  steps(world, DT);
  t.check(!e.inSnow && world.speedMul(e) === 1, 'leaving the blizzard immediately removes its slow');
  e.x = 3500; e.y = 3200; e.hp = 1000;
  steps(world, snow.t - 0.1);
  t.check(world.zones.includes(snow) && e.inSnow, 'snow remains active until the end of its twenty seconds');
  steps(world, 0.2);
  t.check(!world.zones.some((z) => z.kind === 'snow') && !e.inSnow, 'the snow and its slow end after twenty seconds');
}

// ---------------------------------------------------------------- structures: rock, turret, sentry, teleporter
{
  const world = new World({ map: range({ crates: [crate(0, 3700, 3200)] }), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 });
  const far = world.addPlayer({ x: 3200, y: 4200 });
  idle(far, 3200, 3000);
  use(world, p, 'rock', 3380, 3200);
  const rock = world.structures.find((s) => s.kind === 'rock');
  t.check(!!rock && rock.r === 116 && rock.hp === 1000 && rock.maxHp === 1000 && Math.abs(rock.x - 3380) < 1, 'rock placed at the cursor with its normal radius and 1000 HP');
  fireOnce(world, p, 3700, 3200);
  t.equal(world.map.crates[0].hp, CRATES.common.hp, 'the rock stops bullets (even your own)');
  const moved = walk(world, p, 1, 0, 1);
  t.check(moved < 60, 'and blocks walking (' + Math.round(moved) + ' units)');
  world.events.length = 0;
  use(world, p, 'rock', 3380, 3200);
  t.check(world.structures.filter((s) => s.kind === 'rock').length === 1 && events(world, 'deny').some((e) => e.reason === 'blocked'), 'cannot place on top of something');
  p.x = 3200; p.y = 3600; p.vx = p.vy = 0;
  use(world, p, 'turret', 3300, 3600);
  const turret = world.structures.find((s) => s.kind === 'turret');
  t.check(!!turret && turret.hp === 100 && turret.team === p.team, 'turret placed with 100 HP');
  t.check(p.mount === turret.id && turret.mounted === p.id, 'placing the turret automatically mounts it');
  t.check(p.x === turret.x && p.y === turret.y && turret.r === 38, 'the larger turret platform seats the player at its center');
  t.equal(world.countItem(p, 'turret'), 0, 'automatic mounting consumes the placed turret exactly once');
  const wx = p.x;
  p.controller = () => ({ mx: 1, my: 0, aimX: 3700, aimY: 3600 });
  steps(world, 0.5);
  t.equal(p.x, wx, 'cannot move while mounted');
  world.map.crates.push(crate(1, 3700, 3600));
  world.solids.insert({ type: 'crate', shape: 'rect', x: 3700 - 26, y: 3600 - 26, w: 52, h: 52, crate: world.map.crates[1] }, 3674, 3574, 3726, 3626);
  p.controller = () => ({ mx: 0, my: 0, aimX: 3700, aimY: 3600, fire: true });
  steps(world, 0.5);
  const shots = events(world, 'shot').filter((s) => s.weapon === 'turret');
  t.check(shots.length >= 4 && shots.length <= 7, 'the turret fires faster than an AR (' + shots.length + ' shots in 0.5 s)');
  t.check(world.map.crates[1].hp < CRATES.common.hp && (CRATES.common.hp - world.map.crates[1].hp) % 15 === 0, 'turret bullets deal 15 each');
  idle(p, 3700, 3600);
  const hpBefore = p.hp;
  world.damageStruct(turret, 20, far.id, turret.x, turret.y);
  t.check(turret.hp === 100 && p.hp === hpBefore - 20, 'hits on a mounted turret hurt the rider instead');
  once(world, p, { mx: 0, my: 0, aimX: 3700, aimY: 3600, interactPressed: true });
  t.check(p.mount === 0 && turret.mounted === 0, 'interact again dismounts');
  t.check(Math.hypot(p.x - turret.x, p.y - turret.y) >= p.r + turret.r && world.spotFree(p.x, p.y, p.r, true), 'dismount places the rider clear of the turret collider');
  world.damageStruct(turret, 100, far.id, turret.x, turret.y);
  t.check(!turret.alive && !world.structures.includes(turret) && events(world, 'struct').some((e) => e.op === 'gone'), 'an empty turret can be destroyed');
}
{
  const wall = { x: 3220, y: 3490, w: 30, h: 220 };
  const world = new World({ map: range({ vehicles: [], buildings: [{ id: 0, x: wall.x, y: wall.y, w: wall.w, h: wall.h, walls: [wall] }] }), storm: false });
  const p = world.addPlayer({ x: 3400, y: 3600 });
  use(world, p, 'turret', 3300, 3600);
  const turret = world.structures.find(s => s.kind === 'turret');
  t.check(p.mount === turret.id && p.x === turret.x && p.y === turret.y, 'turret seats safely next to a wall');
  const other = world.addPlayer({ x: turret.x + 20, y: turret.y, team: p.team });
  world.separatePlayers(); world.collide(p);
  t.check(p.x === turret.x && p.y === turret.y, 'player separation and collision cannot push a mounted rider off the platform');
  other.x = 3800; p.angle = 0;
  t.check(world.dismount(p) && !p.mount && world.spotFree(p.x, p.y, p.r, true), 'a wall blocking the preferred exit makes the rider use another clear side');
  t.check(p.x > wall.x + wall.w + p.r, 'safe dismount does not teleport the rider through the wall');
}
{
  const walls = [{ x: 3230, y: 3530, w: 140, h: 20 }, { x: 3230, y: 3650, w: 140, h: 20 },
    { x: 3230, y: 3550, w: 20, h: 100 }, { x: 3350, y: 3550, w: 20, h: 100 }];
  const world = new World({ map: range({ vehicles: [], buildings: [{ id: 0, x: 3230, y: 3530, w: 140, h: 140, walls }] }), storm: false });
  const p = world.addPlayer({ x: 3300, y: 3600 });
  const turret = world.addStruct({ kind: 'turret', item: 'turret', x: 3300, y: 3600, r: W.STRUCT_RADIUS.turret, hp: 100, maxHp: 100, owner: p.id, team: p.team });
  t.check(world.mountTurret(p, turret), 'an accessible platform can be mounted directly');
  t.check(!world.dismount(p) && p.mount === turret.id && turret.mounted === p.id, 'an enclosed platform denies an unsafe exit and keeps its occupant seated');
  t.check(events(world, 'deny').some(e => e.reason === 'blocked'), 'a blocked turret exit reports the reason');
  world.clearItemState(p);
  t.check(!p.mount && !turret.mounted && world.spotFree(p.x, p.y, p.r, true), 'forced removal clears the seat and finds safe ground outside an enclosed platform');
}
{
  for (const cause of ['grenade', 'own-grenade', 'meteor', 'tankmg', 'tank-cannon']) {
    const world = new World({ map: range({ vehicles: [] }), storm: false });
    const p = world.addPlayer({ x: 3300, y: 3600 }), enemy = world.addPlayer({ x: 4300, y: 3600 });
    const turret = world.addStruct({ kind: 'turret', item: 'turret', x: 3300, y: 3600, r: W.STRUCT_RADIUS.turret, hp: 100, maxHp: 100, owner: p.id, team: p.team });
    world.mountTurret(p, turret); p.hp = p.maxHp = 1000;
    if (cause === 'meteor') { world.addStrike({ kind: cause, x: p.x, y: p.y, t: 0, radius: 200, damage: 100, owner: enemy.id, team: enemy.team }); world.updateStrikes(0.05); }
    else if (cause === 'grenade' || cause === 'own-grenade') world.explode(p.x, p.y, { radius: 200, maxDamage: 100 }, cause === 'own-grenade' ? p.id : enemy.id, 'grenade');
    else { enemy.fx.strength = enemy.fx.power = 20; world.damageStruct(turret, 100, enemy.id, turret.x, turret.y, cause); }
    t.equal(p.hp, 900, cause + ': centered turret rider takes exactly one hit with the proper fixed tank damage');
    t.equal(turret.hp, 100, cause + ': a rider hit is not repeated on the platform');
  }
  const world = new World({ map: range({ vehicles: [] }), storm: false });
  const p = world.addPlayer({ x: 3300, y: 3600 }), enemy = world.addPlayer({ x: 4300, y: 3600 });
  const turret = world.addStruct({ kind: 'turret', item: 'turret', x: 3300, y: 3600, r: W.STRUCT_RADIUS.turret, hp: 100, maxHp: 100, owner: p.id, team: p.team });
  world.mountTurret(p, turret); p.hp = 50;
  world.explode(p.x, p.y, { radius: 200, maxDamage: 100 }, enemy.id, 'grenade');
  t.check(!p.alive && !p.mount && !turret.mounted && turret.hp === 100, 'a fatal blast clears the turret seat without reapplying that blast to the newly emptied platform');
}
{
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 }), e = world.addPlayer({ x: 3700, y: 3200 });
  idle(e, 3000, 3200);
  use(world, p, 'sentry', 3300, 3200);
  const sentry = world.structures.find((s) => s.kind === 'sentry');
  t.check(!!sentry && sentry.hp === 50, 'sentry placed with 50 HP');
  steps(world, 1.05);
  const dealt = 100 - e.hp;
  t.check(dealt >= 20 && dealt <= 30 && dealt % 5 === 0, 'sentry shoots the enemy at pistol speed for 5 each, never missing (' + dealt + ' in 1 s)');
  t.equal(p.hp, 100, 'never its owner');
  t.check(events(world, 'sentry-shot').length >= 4, 'sentry shot events');
  e.fx.invisible = 30; e.hp = 100;
  steps(world, 1);
  t.equal(e.hp, 100, 'a sentry cannot see an invisible player');
  e.fx.invisible = 0;
  // Your own sentry never blocks your shots: a bullet fired through it keeps flying.
  p.controller = () => ({ mx: 0, my: 0, aimX: 3700, aimY: 3200, fire: true, firePressed: true });
  world.update(DT);
  idle(p, 3700, 3200);
  steps(world, 0.1);
  t.check(world.bullets.some((b) => b.owner === p.id && b.x > 3340), 'your own bullets pass through your sentry');
  fireOnce(world, e, 3300, 3200);
  t.check(sentry.hp < 50, 'enemies can shoot the sentry');
  world.damageStruct(sentry, 100, e.id, sentry.x, sentry.y);
  t.check(!sentry.alive, 'and destroy it');
  use(world, p, 'rock', 3380, 3200);
  e.hp = 100;
  fireOnce(world, p, 3700, 3200);
  t.equal(e.hp, 100, 'a rock blocks everyone, including whoever placed it');
}
{
  const world = new World({ map: range(), storm: false, teams: true });
  const p = world.addPlayer({ x: 3200, y: 3200, team: 1 }), o = world.addPlayer({ x: 5000, y: 5000, team: 2 });
  idle(o, 5100, 5000);
  use(world, p, 'teleporter', 3300, 3200);
  const a = world.structures.find((s) => s.kind === 'teleporter');
  t.check(!!a && !a.pair, 'first pad placed, waiting for its pair');
  p.x = 4000; p.y = 4000;
  use(world, p, 'teleporter', 4100, 4000);
  const b = world.structures.filter((s) => s.kind === 'teleporter')[1];
  t.check(a.pair === b.id && b.pair === a.id && world.countItem(p, 'teleporter') === 0, 'second pad links the pair');
  p.x = a.x; p.y = a.y; p.vx = p.vy = 0;
  idle(p, 3400, 3200);
  steps(world, 0.8);
  t.check(Math.hypot(p.x - a.x, p.y - a.y) < 1 && p.tpProgress > 0.6, 'charging while standing on your pad');
  steps(world, 0.4);
  t.check(Math.hypot(p.x - b.x, p.y - b.y) < 40 && events(world, 'teleport').length === 1, 'after 1 s you pop out at the other pad');
  steps(world, 2);
  t.check(Math.hypot(p.x - b.x, p.y - b.y) < 40, 'standing on the destination does not bounce you back');
  o.x = a.x; o.y = a.y; o.vx = o.vy = 0;
  steps(world, 2);
  t.check(Math.hypot(o.x - a.x, o.y - a.y) < 1, 'another team needs longer');
  steps(world, 1.2);
  t.check(Math.hypot(o.x - b.x, o.y - b.y) < 40, 'and teleports after 3 s');
}

// ---------------------------------------------------------------- riot shield, lightning, meteor
{
  const world = new World({ map: range(), storm: false }), p = world.addPlayer({ x: 3200, y: 3200 }), e = world.addPlayer({ x: 3600, y: 3200 });
  hold(world, e, 'riotshield', 3000, 3200); // facing the shooter
  world.update(DT);
  t.check(e.shieldUp && world.speedMul(e) === 0.25, 'riot shield up: 75% slower');
  fireOnce(world, p, 3600, 3200);
  t.check(e.hp === 100 && events(world, 'blocked').some((b) => b.player === e && b.how === 'shield'), 'bullets from the front are blocked');
  world.explode(3450, 3200, WEAPONS.grenade.explosion, p.id, 'grenade');
  t.equal(e.hp, 100, 'so are blasts in front of you');
  const back = world.addPlayer({ x: 4000, y: 3200 });
  fireOnce(world, back, 3600, 3200);
  t.equal(e.hp, 90, 'shots from behind still hit');
  once(world, e, { mx: 0, my: 0, aimX: 3000, aimY: 3200, slot: 0 });
  world.update(DT);
  t.check(!e.shieldUp && e.held === -1, 'switching to a weapon lowers the shield');
  // Lightning: true damage, auto-aims to the player near the click.
  e.hp = 100; e.armor = 100; e.fx.shield = 30;
  world.events.length = 0;
  use(world, p, 'lightning', 3650, 3260); // a little off, within one grenade radius
  const strike = world.strikes.find((s) => s.kind === 'lightning');
  t.check(!!strike && strike.target === e.id, 'lightning locks onto the enemy near the cursor');
  steps(world, 0.8);
  t.equal(e.hp, 100, 'nothing happens during the 1 s delay');
  steps(world, 0.3);
  t.check(e.hp === 50 && e.armor === 100, 'then 50 damage straight through armor and shields');
  t.check(events(world, 'strike-hit').length === 1 && world.countItem(p, 'lightning') === 4, 'strike resolved, four bolts left');
  use(world, p, 'lightning', 4600, 4600);
  t.check(world.countItem(p, 'lightning') === 4 && events(world, 'deny').some((d) => d.reason === 'notarget'), 'no enemy under the cursor: nothing is used');
  e.hp = 100; e.armor = 0; e.fx.shield = 0;
  const c = crate(0, 3660, 3300);
  world.map.crates.push(c);
  world.solids.insert({ type: 'crate', shape: 'rect', x: c.x - 26, y: c.y - 26, w: 52, h: 52, crate: c }, c.x - 26, c.y - 26, c.x + 26, c.y + 26);
  use(world, p, 'meteor', 3600, 3200);
  const meteor = world.strikes.find((s) => s.kind === 'meteor');
  t.check(!!meteor && meteor.radius === 300 && meteor.t > 1.9 && meteor.dur === 2, 'meteor called: 2 s delay, 300 radius');
  steps(world, 1.8);
  t.equal(e.hp, 100, 'still falling at 1.8 s');
  steps(world, 0.4);
  t.check(e.hp === 1 && c.hp === 1, 'the meteor deals 99 to everyone and everything in the area');
  t.equal(world.countItem(p, 'meteor'), 2, 'two meteors left of three');
}

// ---------------------------------------------------------------- drone, radar, death drops
{
  const world = new World({ map: range(), storm: false, teams: true });
  const p = world.addPlayer({ x: 3200, y: 3200, team: 1 }), mate = world.addPlayer({ x: 3300, y: 3200, team: 1 });
  const near = world.addPlayer({ x: 3900, y: 3200, team: 2 }), farAway = world.addPlayer({ x: 5600, y: 5600, team: 3 });
  idle(mate, 3000, 3000); idle(near, 3000, 3000); idle(farAway, 3000, 3000);
  t.equal(world.revealedEnemies(p).length, 0, 'nothing revealed by default');
  use(world, p, 'radar');
  t.check(p.fx.radar > 29.5 && world.revealedEnemies(p).map((o) => o.id).join() === String(near.id), 'radar pings enemies within 1050');
  use(world, p, 'drone');
  t.check(world.reveal[1] > 59.5 && world.revealedEnemies(mate).length === 2, 'drone shows every enemy to the whole team for 60 s');
  t.equal(world.revealedEnemies(near).length, 0, 'the other teams see nothing');
  give(world, p, 'bandage'); give(world, p, 'turret');
  world.damagePlayer(mate, 500, near.id, 'ar');
  world.damagePlayer(p, 500, near.id, 'ar');
  t.check(!p.alive, 'eliminated');
  const dropped = pickups(world, 'item');
  t.check(dropped.some((pk) => pk.item === 'bandage' && pk.amount === 3) && dropped.some((pk) => pk.item === 'turret'), 'your items drop when you die');
  t.check(p.items.every((s) => s === null) && p.held === -1, 'and your hotbar is empty');
}

// ---------------------------------------------------------------- reclaimable rocks, sentry crate work and legendary loot
{
  const world = new World({ map: range(), storm: false, teams: true });
  const p = world.addPlayer({ x: 3200, y: 3200, team: 1 });
  use(world, p, 'rock', 3380, 3200);
  const rock = world.structures.find(s => s.kind === 'rock');
  const mate = world.addPlayer({ x: 3380, y: 3380, team: 1 }), enemy = world.addPlayer({ x: 3580, y: 3200, team: 2 });
  t.check(rock && rock.r === 116 && rock.owner === p.id && rock.team === p.team, 'portable boulder is twice as large and retains ownership');
  t.equal(world.nearestRecoverableRock(p), rock, 'owner can reclaim a boulder by interacting near its edge');
  t.equal(world.nearestRecoverableRock(mate), rock, 'teammate can reclaim the shared boulder');
  t.equal(world.nearestRecoverableRock(enemy), null, 'enemy never gets a rock-reclaim target');
  t.check(!world.recoverRock(enemy, rock) && rock.alive, 'enemy reclaim cannot steal the boulder');
  give(world, p, 'bandage', 9); give(world, p, 'grenade', 5); give(world, p, 'smoothie', 5);
  t.check(world.pressInteract(p) && rock.alive && events(world, 'deny').some(e => e.reason === 'full'), 'full inventory reports failure and leaves deployed rock intact');
  t.check(world.pressInteract(mate) && !rock.alive && world.countItem(mate, 'rock') === 1, 'E returns exactly one rock to a teammate with space');
  t.check(rock.removalReason === 'recovered' && events(world, 'struct').some(e => e.op === 'gone' && e.struct === rock && e.reason === 'recovered'), 'rock reclaim reports recovery rather than destruction');
  t.check(!world.recoverRock(mate, rock) && world.countItem(mate, 'rock') === 1, 'reclaiming twice cannot duplicate a rock');
  p.x = rock.x; p.y = rock.y; p.vx = p.vy = 0; world.collide(p);
  t.check(p.x === rock.x && p.y === rock.y, 'reclaimed rock immediately stops blocking movement');
}
{
  const front = crate(8, 3450, 3200), back = crate(9, 3550, 3200);
  const world = new World({ map: range({ crates: [front, back] }), storm: false });
  const p = world.addPlayer({ x: 3100, y: 3200 });
  const sentry = world.addStruct({ kind: 'sentry', item: 'sentry', x: 3300, y: 3200, r: 20, owner: p.id, team: p.team, hp: 50 });
  world.updateSentry(sentry, DT);
  t.check(front.hp === 95 && back.hp === 100, 'sentry shoots the unobstructed crate rather than one behind it');
  t.check(sentry.targetKind === 'crate' && events(world, 'crate-hp').length === 1, 'crate targeting uses ordinary authoritative damage events');
  const enemy = world.addPlayer({ x: 3500, y: 3300, team: 2 });
  sentry.cooldown = 0; world.updateSentry(sentry, DT);
  t.check(enemy.hp === 95 && front.hp === 95, 'visible enemy takes priority over a nearby crate');
  enemy.fx.invisible = 20; sentry.cooldown = 0; world.updateSentry(sentry, DT);
  t.equal(front.hp, 90, 'sentry resumes opening crates when enemies are hidden');
  front.hp = 5; sentry.cooldown = 0; world.updateSentry(sentry, DT);
  t.check(!front.alive && events(world, 'crate').some(e => e.crate === front), 'sentry finishes crates and creates their normal loot');
  sentry.cooldown = 0; world.updateSentry(sentry, DT);
  t.equal(back.hp, 95, 'destroying the front crate exposes the next one');
  world.solids.insert({ type: 'wall', shape: 'rect', x: 3370, y: 3100, w: 20, h: 200 }, 3370, 3100, 3390, 3300);
  sentry.cooldown = 0; world.updateSentry(sentry, DT);
  t.equal(back.hp, 95, 'sentry cannot shoot a crate through a building wall');
}
{
  const c = crate(12, 3400, 3200, 'legendary'), world = new World({ map: range({ crates: [c] }), storm: false });
  const p = world.addPlayer({ x: 3200, y: 3200, name: 'Legend breaker' });
  world.damageCrate(c, 99999, p.id, c.x, c.y);
  const loot = pickups(world, 'item'), ids = loot.map(pk => pk.item).sort();
  t.equal(ids.join(','), Rules.itemsOfTier('legendary').slice().sort().join(','), 'legendary crate drops all four unique legendary item types exactly once');
  t.check(loot.every(pk => pk.amount === 1), 'each of the four legendary drops contains one item');
  const notice = events(world, 'legendary-crate-broken');
  t.check(notice.length === 1 && notice[0].player === p && notice[0].crate === c, 'legendary break exposes one named-player announcement event');
  world.damageCrate(c, 99999, p.id, c.x, c.y);
  t.check(pickups(world, 'item').length === 4 && events(world, 'legendary-crate-broken').length === 1, 'dead legendary crate cannot duplicate loot or announcements');
}

// ---------------------------------------------------------------- client mirror
{
  const world = new World({ map: range(), remote: true }), p = world.addPlayer({ id: 3, x: 3200, y: 3200 });
  world.itemBurst('firenade', 3400, 3200, 3);
  t.equal(world.zones.length, 0, 'a mirrored burst draws effects but creates no zone (the server sends it)');
  const s = world.structFromServer({ op: 'add', id: 9, k: 'turret', it: 'turret', x: 3300, y: 3200, r: 24, o: 3, tm: 3, hp: 100, mhp: 100, a: 0, m: 0, pr: 0 });
  t.check(!!s && world.structById(9) === s, 'structures arrive from the server');
  world.structFromServer({ op: 'hp', id: 9, hp: 40, n: 60, x: 3300, y: 3200 });
  t.equal(s.hp, 40, 'hp updates apply');
  world.structFromServer({ op: 'mount', id: 9, m: 3 });
  t.check(s.mounted === 3 && p.mount === 9, 'mount state applies');
  world.structFromServer({ op: 'gone', id: 9, src: 0 });
  t.check(!s.alive && !world.structById(9), 'destroyed structures vanish');
  t.equal(s.removalReason, 'destroyed', 'ordinary structural removal retains the destruction reason');
  const recovered = world.structFromServer({ op: 'add', id: 10, k: 'rock', it: 'rock', x: 3400, y: 3200, r: 116, o: 3, tm: 3, hp: 0, mhp: 0 });
  world.structFromServer({ op: 'gone', id: 10, src: 3, reason: 'recovered' });
  t.check(!recovered.alive && recovered.removalReason === 'recovered', 'recovery reason survives the server structure-removal message');
  world.addZone({ id: 5, kind: 'snow', x: 3200, y: 3200, r: 750, dur: 10, t: 10, owner: 0, team: null });
  world.update(DT);
  t.check(p.inSnow && world.events.every((e) => e.type !== 'damage'), 'mirrored snow slows locally but never damages');
  world.addStrike({ id: 7, kind: 'meteor', x: 3200, y: 3200, target: 0, t: 2, owner: 0, team: null, radius: 300, damage: 99 });
  steps(world, 2.5);
  t.check(world.strikeById(7) && events(world, 'strike-hit').length === 0, 'the client waits for the server to resolve a strike');
  t.check(!!world.resolveStrike(7, 3200, 3200) && !world.strikeById(7), 'resolveStrike removes it and plays the effect');
}

t.done();
