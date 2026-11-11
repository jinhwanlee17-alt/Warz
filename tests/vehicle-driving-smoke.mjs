// Humvee steering follows continuous arcs; high-speed crate contact is authoritative and swept.
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(), C = W.CONFIG, V = W.VEHICLE, t = suite('Humvee driving');
const EAST = { mx: 1, my: 0 }, SOUTH = { mx: 0, my: 1 }, WEST = { mx: -1, my: 0 }, IDLE = { mx: 0, my: 0 };
const origin = { x: 8000, y: 8000 };
function crate(id, x, y = origin.y, tier = 'common') {
  return { id, x, y, tier, size: C.crateSize, hp: W.CRATES[tier].hp, maxHp: W.CRATES[tier].hp, alive: true, shake: 0 };
}
function arena(extra = {}, remote = false) {
  const map = Object.assign({ seed: 5, size: C.worldSize, rocks: [], trees: [], bushes: [], buildings: [],
    crates: [], pickups: [], ponds: [], stations: [], drops: [], towns: [], nextPickupId: 1,
    vehicles: [{ id: 1, x: origin.x, y: origin.y, angle: 0 }], tanks: [] }, extra);
  const w = new W.World({ map, remote, storm: false }), v = w.vehicles[0];
  const p = w.addPlayer({ x: origin.x + 28, y: origin.y - 104, team: 1 });
  if (remote) { p.vehicle = v.id; p.vehicleSeat = 'driver'; v.seats.driver = p.id; v.hidden = false; w.syncVehicleSeats(v); }
  else if (!w.enterVehicle(p, v, 'driver')) throw new Error('Fixture driver could not board');
  w.events = [];
  return { w, v, p };
}
function prime(a, fraction = 1, angle = 0) {
  a.v.angle = angle; a.v.vx = Math.cos(angle) * V.maxSpeed * fraction; a.v.vy = Math.sin(angle) * V.maxSpeed * fraction;
}
function drive(a, intent, seconds, dt = 1 / 20, authoritative = false) {
  a.p.vehicleIntent = intent;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    if (authoritative) { a.w.time += dt; a.w.updateVehicles(dt); }
    else a.w.driveVehicle(a.v, intent, dt);
  }
}
function atSpeed(a) { return Math.hypot(a.v.vx, a.v.vy); }
function crateEvents(a) { return a.w.events.filter(e => e.type === 'crate'); }

{
  const a = arena(); prime(a);
  a.w.driveVehicle(a.v, SOUTH, 0.05);
  t.check(a.v.angle > 0 && a.v.angle < Math.PI / 2, 'a right-angle input begins a turn instead of snapping the hull');
  t.check(a.v.angle <= V.turnRate * 0.05 + 1e-9, 'heading change respects the configured angular rate');
  t.check(a.v.x > origin.x && a.v.y > origin.y, 'the first turning step follows an arc with forward and sideways travel');
  t.near(W.U.angleDiff(a.v.angle, Math.atan2(a.v.vy, a.v.vx)), 0, 1e-8, 'velocity follows the hull instead of sliding along the old vector');
  let largestTurn = 0, previous = a.v.angle;
  for (let i = 0; i < 60; i++) {
    a.w.driveVehicle(a.v, SOUTH, 1 / 60);
    largestTurn = Math.max(largestTurn, Math.abs(W.U.angleDiff(previous, a.v.angle)));
    previous = a.v.angle;
  }
  t.check(largestTurn <= V.turnRate / 60 + 1e-9, 'all subsequent steps keep the same turn-rate limit');
  t.near(W.U.angleDiff(a.v.angle, Math.PI / 2), 0, 1e-8, 'holding the new direction settles at its requested heading');
  t.near(atSpeed(a), V.maxSpeed, 1e-8, 'a steady full-throttle turn retains the normal top-speed limit');
}
{
  const a = arena(); prime(a);
  a.w.driveVehicle(a.v, WEST, 0.05);
  t.check(Math.abs(a.v.angle) > 0 && Math.abs(a.v.angle) < Math.PI, 'opposite input starts a continuous U-turn');
  t.check(a.v.vx > 0 && Math.abs(a.v.vy) > 0, 'reverse input does not instantly reverse velocity');
  drive(a, WEST, 2);
  t.near(Math.abs(W.U.angleDiff(0, a.v.angle)), Math.PI, 1e-8, 'the U-turn eventually faces the opposite direction');
  t.check(a.v.vx < 0 && Math.abs(a.v.y - origin.y) > 20, 'the U-turn describes a real curve rather than pivoting in place');

  const b = arena(); prime(b, 1, Math.PI - 0.04);
  const target = -Math.PI + 0.04;
  b.w.driveVehicle(b.v, { mx: Math.cos(target), my: Math.sin(target) }, 0.05);
  t.check(Math.abs(W.U.angleDiff(b.v.angle, target)) < 0.08, 'crossing the angle wrap takes the short turn');
  t.check(Math.abs(W.U.angleDiff(Math.PI - 0.04, b.v.angle)) <= V.turnRate * 0.05 + 1e-9, 'angle wrapping never causes a full-circle jump');
}
{
  const a = arena(); prime(a, 1, 0.7);
  a.w.driveVehicle(a.v, IDLE, 0.05);
  t.near(a.v.angle, 0.7, 1e-12, 'releasing movement keeps the current heading');
  t.check(atSpeed(a) > 0 && atSpeed(a) < V.maxSpeed, 'release decelerates naturally');
  drive(a, IDLE, 3);
  t.near(atSpeed(a), 0, 0.1, 'the vehicle comes to rest without movement input');

  const straight = arena(), diagonal = arena(); diagonal.v.angle = Math.PI / 4;
  drive(straight, EAST, 3); drive(diagonal, { mx: 1, my: 1 }, 3);
  t.check(atSpeed(diagonal) <= V.maxSpeed + 1e-9, 'diagonal keys cannot exceed the configured top speed');
  t.near(atSpeed(diagonal), atSpeed(straight), 1e-8, 'diagonal and straight acceleration have equal speed');
  t.near(Math.hypot(diagonal.v.x - origin.x, diagonal.v.y - origin.y), straight.v.x - origin.x, 1e-6, 'diagonal travel is normalized');

  const pond = arena({ ponds: [{ x: origin.x, y: origin.y, r: 5000 }] });
  drive(pond, EAST, 3);
  t.near(atSpeed(pond), V.maxSpeed * C.pondSpeedMul, 0.01, 'ponds retain their existing slowdown');
}
{
  function route(dt) {
    const a = arena();
    for (const [intent, seconds] of [[EAST, 1], [SOUTH, 0.5], [WEST, 0.5], [{ mx: -1, my: -1 }, 0.5], [IDLE, 0.5]]) drive(a, intent, seconds, dt);
    return a;
  }
  const server = route(1 / 20), local = route(1 / 60), repeat = route(1 / 20);
  t.near(Math.hypot(server.v.x - local.v.x, server.v.y - local.v.y), 0, 4, '20 Hz and 60 Hz follow the same acceleration and curved route');
  t.near(W.U.angleDiff(server.v.angle, local.v.angle), 0, 1e-8, 'heading is independent of simulation frame rate');
  t.near(atSpeed(server), atSpeed(local), 0.1, 'braking speed is consistent at 20 Hz and 60 Hz');
  t.check(server.v.x === repeat.v.x && server.v.y === repeat.v.y && server.v.angle === repeat.v.angle && server.v.vx === repeat.v.vx && server.v.vy === repeat.v.vy, 'identical steering inputs replay deterministically');
}

// Each crate tier is opened by real hull contact at cruising speed, with its normal rewards.
for (const tier of W.CRATE_ORDER) {
  const box = crate(0, origin.x + 180, origin.y, tier), a = arena({ crates: [box] }); prime(a);
  drive(a, EAST, 0.6, 1 / 20, true);
  t.check(!box.alive && box.hp === 0 && a.v.x > box.x, tier + ': a full-speed Humvee drives through and breaks the crate');
  t.equal(crateEvents(a).length, 1, tier + ': one normal crate-break event');
  t.equal(a.p.stats.crates, 1, tier + ': driver receives one crate credit');
  t.equal(a.p.stats.crateDamage, box.maxHp, tier + ': driver receives the crate damage credit');
  const tokens = a.w.map.pickups.filter(p => p.type === 'token').length;
  t.check(tokens >= W.CRATES[tier].tokens[0] && tokens <= W.CRATES[tier].tokens[1], tier + ': normal token loot is retained');
  if (tier === 'legendary') t.equal(a.w.map.pickups.filter(p => p.type === 'item' && W.ITEMS[p.item].tier === 'legendary').length, 4, 'legendary crushing preserves its four guaranteed legendary items');
  const loot = JSON.stringify(a.w.map.pickups);
  drive(a, EAST, 0.5, 1 / 20, true);
  t.check(crateEvents(a).length === 1 && a.p.stats.crates === 1 && JSON.stringify(a.w.map.pickups) === loot, tier + ': passing the broken crate cannot grant loot or credit twice');
}
{
  const boxes = W.CRATE_ORDER.map((tier, i) => crate(i, origin.x + 180 + i * 160, origin.y, tier));
  const a = arena({ crates: boxes }); prime(a); a.p.vehicleIntent = EAST;
  a.w.time += 2; a.w.updateVehicles(2);
  t.check(boxes.every(c => !c.alive), 'one long movement step sweeps every crate along the travelled path');
  t.equal(crateEvents(a).length, 5, 'a multi-crate crossing grants exactly one event per crate');
  t.equal(a.p.stats.crates, 5, 'all swept crates are credited to the driver');
}
for (const fraction of [0, 0.5, 0.97]) {
  const box = crate(0, origin.x + V.radius + C.crateSize / 2 + 5), a = arena({ crates: [box] }); prime(a, fraction);
  drive(a, { mx: fraction, my: 0 }, 1, 1 / 20, true);
  t.check(box.alive && box.hp === box.maxHp, 'speed fraction ' + fraction + ': insufficient speed does not crush or damage a crate');
  t.check(a.v.x <= box.x - box.size / 2 - a.v.r + 0.01, 'speed fraction ' + fraction + ': the intact crate remains solid');
  t.check(a.w.map.pickups.length === 0 && a.p.stats.crates === 0, 'speed fraction ' + fraction + ': no early loot or credit');
}
{
  const box = crate(0, origin.x + 180), a = arena({ crates: [box] }); prime(a, 0.99);
  drive(a, { mx: 0.99, my: 0 }, 0.6, 1 / 20, true);
  t.check(!box.alive, 'practical cruising speed just below the asymptotic maximum can crush crates');
  for (const dt of [1 / 20, 1 / 60]) {
    const naturalBox = crate(0, origin.x + 1200), b = arena({ crates: [naturalBox] });
    drive(b, EAST, 1200 / V.maxSpeed + 0.5, dt, true);
    t.check(!naturalBox.alive && b.p.stats.crates === 1, Math.round(1 / dt) + ' Hz: normal acceleration reaches crate-crushing speed without manually setting velocity');
  }
}
{
  const side = crate(0, origin.x + 220, origin.y + V.radius + C.crateSize / 2 - 8), far = crate(1, origin.x + 220, origin.y + V.radius + C.crateSize / 2 + 8);
  const a = arena({ crates: [side, far] }); prime(a);
  drive(a, EAST, 0.8, 1 / 20, true);
  t.check(!side.alive, 'the side of the hull can crush a crate without its center crossing the crate');
  t.check(far.alive, 'a nearby crate outside the swept hull stays intact');
}
{
  const box = crate(0, origin.x + 180, origin.y + 100), a = arena({ crates: [box] }); prime(a); a.p.vehicleIntent = EAST;
  const beforeCorner = 90 / V.maxSpeed, throughCorner = 54 / V.maxSpeed;
  a.w.time += beforeCorner; a.w.updateVehicles(beforeCorner);
  t.check(box.alive, 'an expanded bounding-box corner alone does not count as actual hull contact');
  a.w.time += throughCorner; a.w.updateVehicles(throughCorner);
  t.check(!box.alive, 'the crate breaks once the swept circular hull actually reaches its corner');
}
for (const obstacle of ['wall', 'rock', 'wreck']) {
  const before = crate(0, origin.x + 125), behind = crate(1, origin.x + 380);
  const extra = { crates: [before, behind] };
  if (obstacle === 'wall') extra.buildings = [{ walls: [{ x: origin.x + 220, y: origin.y - 500, w: 30, h: 1000 }] }];
  if (obstacle === 'rock') extra.rocks = [{ id: 0, x: origin.x + 265, y: origin.y, r: 45, alive: true }];
  if (obstacle === 'wreck') extra.vehicles = [{ id: 1, ...origin, angle: 0 }, { id: 2, x: origin.x + 300, y: origin.y, angle: 0 }];
  const a = arena(extra); prime(a);
  if (obstacle === 'wreck') { a.w.vehicles[1].wreck = true; a.w.vehicles[1].hp = 0; }
  a.p.vehicleIntent = EAST; a.w.time += 1; a.w.updateVehicles(1);
  t.check(!before.alive, obstacle + ': reachable crate before the obstruction is crushed');
  t.check(behind.alive && behind.hp === behind.maxHp, obstacle + ': the obstruction protects a crate behind it');
  t.check(a.v.x <= origin.x + 140.01, obstacle + ': crushing does not permit tunnelling through the obstruction');
  t.equal(a.p.stats.crates, 1, obstacle + ': only the reachable crate awards credit');
}
{
  const box = crate(0, origin.x + 180), a = arena({ crates: [box] }, true), reference = arena({}, true);
  prime(a); prime(reference);
  const before = JSON.stringify({ crate: box, pickups: a.w.map.pickups, stats: a.p.stats, events: a.w.events });
  drive(a, EAST, 0.8);
  t.check(a.v.x > box.x, 'remote high-speed prediction passes an eligible crate smoothly');
  t.equal(JSON.stringify({ crate: box, pickups: a.w.map.pickups, stats: a.p.stats, events: a.w.events }), before, 'prediction does not mutate crate HP/alive, generate loot, credit stats or emit destruction');
  t.equal(a.w.rng.next(), reference.w.rng.next(), 'prediction does not consume authoritative loot randomness');
  a.v.x = origin.x; a.v.y = origin.y; prime(a);
  drive(a, EAST, 0.8);
  t.check(box.alive && box.hp === box.maxHp && a.w.map.pickups.length === 0, 'reconciliation replay also waits for authoritative crate events');
}
{
  const box = crate(0, origin.x + 180), a = arena({ crates: [box] }, true); prime(a);
  drive(a, EAST, 90 / V.maxSpeed);
  const x = a.v.x;
  t.check(a.v.predictedCrates && a.v.predictedCrates[box.id] && x > box.x - box.size / 2 - a.v.r,
    'high-speed prediction remembers the crate while the hull is still crossing it');
  prime(a, 100 / V.maxSpeed);
  drive(a, { mx: 100 / V.maxSpeed, my: 0 }, 0.2);
  t.check(a.v.x > x + 15, 'slowing down after predicted crushing does not collide again with the same unknown crate');
  t.check(box.alive && box.hp === box.maxHp && a.w.map.pickups.length === 0 && a.w.events.length === 0,
    'remembering the predicted contact still leaves all authoritative crate state untouched');
}

t.done();
