import { loadWarz, suite, MemoryStorage } from './harness.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls']);
const t = suite('Trench movement');
const origin = { x: 8000, y: 8000 };
const trench = W.Trenches.create(1, origin.x, origin.y, 0, 'normal');
const [first, second] = trench.points;
const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
const wall = W.Trenches.wall(trench, center.x, center.y);
const atWall = offset => ({ x: wall.x + wall.nx * offset, y: wall.y + wall.ny * offset });
const wire = trench.wires[0], contact = { x: (wire.a.x + wire.b.x) / 2, y: (wire.a.y + wire.b.y) / 2 };
const dt = 1 / 20;

function arena(extra = {}) {
  const map = { seed: 17, size: W.CONFIG.worldSize, trenches: [W.Trenches.create(1, origin.x, origin.y, 0, 'normal')], rocks: [], trees: [], bushes: [],
    buildings: [], crates: [], pickups: [], ponds: [], stations: [], towns: [], drops: [], nextPickupId: 1, ...extra };
  return new W.World({ map, storm: false });
}
function tick(world, p, intent = {}, count = 1) {
  p.controller = () => intent;
  for (let i = 0; i < count; i++) world.update(dt);
}

{
  const world = arena(), p = world.addPlayer(atWall(30));
  const inward = { mx: -wall.nx, my: -wall.ny }, outward = { mx: wall.nx, my: wall.ny };
  for (let i = 0; i < 16 && !p.trenchId; i++) tick(world, p, inward);
  t.equal(p.trenchPhase, 'enter', 'walking across the lip starts a descent');
  tick(world, p, {}, 3);
  t.check(p.trenchDepth > 0 && p.trenchDepth < 1, 'descent takes multiple frames');
  tick(world, p, {}, 12);
  t.equal(p.trenchDepth, 1, 'the player settles on the trench floor');
  tick(world, p, outward, 50);
  t.check(p.trenchId === 1 && W.Trenches.contains(trench, p.x, p.y), 'walking against the bank stays inside');
  const gun = p.weapons[p.slot];
  tick(world, p, { trenchHeld: true, trenchPress: 1, fire: true });
  t.check(p.trenchPeeking && gun.ammo === W.WEAPONS[gun.id].mag - 1, 'hold and fire at a wall work on the same tick');
  tick(world, p, { trenchHeld: true }, 10);
  t.check(p.trenchPeeking && p.trenchPhase === 'inside', 'a continuous hold never becomes a climb');
  gun.cooldown = 0;
  tick(world, p, { fire: true });
  t.check(!p.trenchPeeking && gun.ammo === W.WEAPONS[gun.id].mag - 2, 'releasing gives cover while the gun fires a second round from below');
  tick(world, p, { trenchPress: 1 });
  tick(world, p, {}, 8);
  tick(world, p, { trenchPress: 1 });
  t.equal(p.trenchPhase, 'inside', 'slow separate presses are not a double tap');
  tick(world, p);
  tick(world, p, { trenchPress: 1 });
  t.check(p.trenchPhase === 'exit' && p.trenchDepth > 0 && p.trenchDepth < 1, 'the second quick tap begins the climb');
  tick(world, p, {}, 13);
  t.check(!p.trenchId && !p.trenchDepth && !W.Trenches.at(world.map, p.x, p.y), 'climb lands outside the trench');
  tick(world, p, { trenchHeld: true }, 12);
  t.check(!p.trenchId, 'continuing to hold after an exit does not pull the player back in');
}

{
  const world = arena(), p = world.addPlayer(atWall(10));
  tick(world, p, { trenchHeld: true, trenchPress: 1 });
  t.equal(p.trenchPhase, 'enter', 'holding Space at the outer bank also starts a descent');
  tick(world, p, {}, 12);
  Object.assign(p, center);
  tick(world, p, { trenchHeld: true });
  t.check(!p.trenchPeeking, 'standing in the middle cannot expose the player by holding alone');
  // Walk the centerline through every change of direction at ordinary speed.
  let traversed = true;
  for (const waypoint of trench.points.slice(1)) {
    for (let i = 0; i < 80; i++) {
      const dx = waypoint.x - p.x, dy = waypoint.y - p.y, d = Math.hypot(dx, dy);
      if (d < 16) break;
      tick(world, p, { mx: dx / d, my: dy / d });
      traversed &&= W.Trenches.contains(trench, p.x, p.y);
    }
    traversed &&= Math.hypot(waypoint.x - p.x, waypoint.y - p.y) < 16;
  }
  t.check(traversed && p.trenchPhase === 'inside', 'all turns of the zigzag are walkable without climbing out');
  world.respawn(p, origin.x + 1000, origin.y, 'soldier');
  t.check(!p.trenchId && !p.trenchDepth && !p.trenchPeeking, 'respawning clears the trench state');
}

{
  const world = arena(), open = arena({ trenches: [] });
  const p = world.addPlayer(contact), reference = open.addPlayer(contact);
  const bank = W.Trenches.wall(trench, contact.x, contact.y), away = { mx: bank.nx, my: bank.ny };
  tick(world, p, away); tick(open, reference, away);
  const speed = player => Math.hypot(player.vx, player.vy);
  t.near(speed(p), speed(reference) * W.CONFIG.barbedWireSpeedMul, .0001, 'crossing visible wire slows infantry');
  t.check(!p.trenchId && p.hp === p.maxHp, 'brief wire contact slows the player before the first damage tick');
  tick(world, p, away, 30);
  t.check(!W.Trenches.wireAt(world.map, p.x, p.y, p.r) && speed(p) >= W.CONFIG.playerSpeed * .99,
    'the player recovers walking speed after clearing the wire');

  // A boosted player can first touch a coil between two frame boundaries.
  world.practice = open.practice = true;
  const approach = { x: contact.x + bank.nx * 55, y: contact.y + bank.ny * 55,
    vx: -bank.nx * W.CONFIG.playerSpeed * 5, vy: -bank.ny * W.CONFIG.playerSpeed * 5,
    practiceSpeed: 5, isLocal: true };
  Object.assign(p, approach); Object.assign(reference, approach);
  const toward = { mx: -bank.nx, my: -bank.ny };
  tick(world, p, toward); tick(open, reference, toward);
  t.check(Math.hypot(p.x - approach.x, p.y - approach.y) + 1 < Math.hypot(reference.x - approach.x, reference.y - approach.y),
    'boosted practice movement slows during the frame that crosses a wire');
}

{
  const world = arena(), p = world.addPlayer(contact), sheltered = world.addPlayer(center);
  tick(world, p, {}, 19);
  t.equal(p.hp, p.maxHp, 'standing on wire for less than a second costs no HP');
  tick(world, p);
  t.equal(p.hp, p.maxHp - 10, 'the first full second of wire contact deals 10 damage');
  tick(world, p, {}, 40);
  t.equal(p.hp, p.maxHp - 30, 'three seconds standing still on wire deal exactly 30 damage');
  t.check(sheltered.trenchPhase === 'inside' && sheltered.hp === sheltered.maxHp, 'the nearby trench floor is clear of wire damage');

  tick(world, p, {}, 13);
  Object.assign(p, { x: wire.b.x + 44, y: wire.b.y });
  tick(world, p, {}, 25);
  t.check(!p.trenchId && !W.Trenches.wireAt(world.map, p.x, p.y, p.r) && p.hp === p.maxHp - 30,
    'standing in the open gap stops the damage');
  Object.assign(p, contact);
  tick(world, p, {}, 19);
  t.equal(p.hp, p.maxHp - 30, 'leaving the wire clears partial exposure before reentry');
  tick(world, p);
  t.equal(p.hp, p.maxHp - 40, 'reentry deals 10 damage after a new full second');
  for (let frame = 0; frame < 30; frame++) world.update(1 / 30);
  t.equal(p.hp, p.maxHp - 50, 'a second at 30 frames per second deals the same damage as 20 server ticks');

  const vehicleWorld = arena({ tanks: [{ id: 1, type: 'tank', ...contact, angle: 0 }] });
  const tank = vehicleWorld.vehicles[0], driver = vehicleWorld.addPlayer(contact);
  t.check(vehicleWorld.enterVehicle(driver, tank, 'driver') && W.Trenches.wireAt(vehicleWorld.map, driver.x, driver.y, driver.r),
    'the tank driver sits directly over the visible wire');
  tick(vehicleWorld, driver, {}, 40);
  t.check(driver.hp === driver.maxHp && tank.hp === tank.maxHp, 'a parked tank protects its driver from wire damage');
}

{
  const start = { x: contact.x, y: contact.y + W.TANK.radius + W.Trenches.wireRadius + 6, angle: -Math.PI / 2 };
  const seedTank = { id: 1, type: 'tank', ...start };
  const world = arena({ tanks: [seedTank] }), tank = world.vehicles[0], driver = world.addPlayer(start);
  const coils = world.map.trenches[0].wires;
  t.check(world.enterVehicle(driver, tank, 'driver'), 'driver boards the tank facing the wire');
  tick(world, driver, {}, 20);
  t.check(!coils[0].destroyed, 'a parked tank leaves wire intact');
  tick(world, driver, { my: -1 }, 4);
  t.check(coils[0].destroyed && Math.abs(tank.vy) < W.TANK.maxSpeed * W.TANK.crushSpeedRatio,
    'driving onto a coil crushes it even before the tank reaches cruising speed');
  t.check(coils.slice(1).every(w => !w.destroyed) && tank.hp === tank.maxHp, 'only the contacted wire breaks and the hull takes no damage');
  tick(world, driver, { my: -1 }, 30);
  t.equal(world.events.filter(e => e.type === 'wire-crushed').length, 1, 'continued driving through the coil emits one permanent removal');
  const infantry = world.addPlayer(contact), clear = arena({ trenches: [] }), reference = clear.addPlayer(contact);
  tick(world, infantry, {}, 24);
  t.equal(infantry.hp, infantry.maxHp, 'infantry can stand in the cleared passage without taking wire damage');
  tick(world, infantry, { mx: 1 }); tick(clear, reference, { mx: 1 });
  t.near(infantry.vx, reference.vx, .000001, 'walking through the crushed coil has open-ground speed');

  const blocked = arena({ tanks: [seedTank] }), stoppedDriver = blocked.addPlayer(start);
  const barrier = { shape: 'rect', x: contact.x - 200, y: contact.y + 4, w: 400, h: W.Trenches.wireRadius - 3.5 };
  blocked.solids.insert(barrier, barrier.x, barrier.y, barrier.x + barrier.w, barrier.y + barrier.h);
  blocked.enterVehicle(stoppedDriver, blocked.vehicles[0], 'driver');
  tick(blocked, stoppedDriver, { my: -1 }, 40);
  t.check(blocked.vehicles[0].y < start.y && !blocked.map.trenches[0].wires[0].destroyed,
    'a wall that stops the hull just short of the wire keeps that coil intact');
}

for (const type of ['tank', 'artillery']) {
  const start = atWall(320), angle = Math.atan2(-wall.ny, -wall.nx);
  const world = arena({ [type === 'tank' ? 'tanks' : 'artillery']: [{ id: 1, type, ...start, angle }] });
  const p = world.addPlayer(center), v = world.vehicles[0], driver = world.addPlayer(atWall(460));
  const rock = world.addStruct({ kind: 'rock', item: 'rock', x: center.x + 64, y: center.y, r: 28 });
  t.check(world.enterVehicle(driver, v, 'driver'), type + ' driver boards on the surface');
  driver.controller = () => ({ mx: -wall.nx, my: -wall.ny });
  tick(world, p, {}, 45);
  t.check((v.x - center.x) * wall.nx + (v.y - center.y) * wall.ny < -v.r, type + ' crosses the whole trench');
  t.check(p.trenchId === 1 && p.x === center.x && p.y === center.y && p.hp === p.maxHp && v.hp === v.maxHp,
    type + ' passes over the infantry without pushing or ramming them');
  t.check(rock.trenchId && rock.alive && rock.hp === rock.maxHp, type + ' leaves cover placed on the trench floor intact');
}

{
  const world = arena(), p = world.addPlayer(center);
  tick(world, p, {}, 12);
  for (let i = 0; i < 30 && !p.trenchPeeking; i++) tick(world, p, botIntent(true));
  t.check(p.trenchPeeking, 'a bot can approach the bank to peek');
  for (let i = 0; i < 40 && p.trenchId; i++) tick(world, p, botIntent(false));
  t.check(!p.trenchId, 'a bot leaving cover can climb through the same controls');
  function botIntent(fighting) {
    const intent = { mx: wall.nx, my: wall.ny };
    world.steerInTrench(p, intent, fighting);
    return intent;
  }
}

{
  const storage = new MemoryStorage();
  storage.setItem('warz.settings.v1', JSON.stringify({ bindings: { reload: ['Space', null] } }));
  const saved = loadWarz(['config', 'controls'], { storage }).Controls;
  t.check(W.Controls.primary('trench') === 'Space' && saved.primary('reload') === 'Space' && !saved.bindings('trench')[0],
    'fresh controls use Space and older custom bindings are preserved');
}
t.done();
