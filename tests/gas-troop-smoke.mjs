import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls', 'online']), t = suite('Gas Troop');
const X = 5800, Y = 6000;
function arena(extra = {}) {
  const map = { seed: 41, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [],
    stations: [], ponds: [], drops: [], nextPickupId: 1, ...extra };
  const w = new W.World({ map, storm: false });
  const p = w.addPlayer({ classId: 'gastroop', team: 1, x: X, y: Y });
  const target = w.addPlayer({ team: 2, x: X + 75, y: Y });
  return { w, p, target };
}
function stepZones(w, seconds) {
  for (let i = 0; i < Math.round(seconds * 20); i++) { w.time += .05; w.updateZones(.05); }
}
{
  const { w, p, target } = arena();
  t.equal(p.hp, 135, 'spawn HP');
  t.equal(p.weapons.map(x => x.id).join(), 'boltrifle,heavydeagle,gasgrenade,gascylinder', 'four dedicated slots, in order');
  t.equal(W.Controls.itemOrder(p).join(), '2,3,4,5,6,7', 'six other inventory slots stay accessible');
  t.equal(p.items.filter(Boolean).length, 0, 'the mask uses no inventory space');
  t.equal(p.grenades, 20, 'twenty gas grenades');
  t.equal(p.gasCylinders, 3, 'three cylinders');
  t.near(w.speedMul(p), .85, 1e-8, 'starting walk speed');
  for (const [slot, ammo, damage, interval] of [[0, 5, 85, .4], [1, 6, 105, 1]]) {
    p.slot = slot; target.hp = 1000; target.x = X + 170; p.angle = 0;
    const gun = p.weapons[slot];
    t.equal(gun.ammo, ammo, gun.id + ' magazine');
    w.trigger(p, { firePressed: true }); w.trigger(p, { firePressed: true }); w.updateBullets(.09);
    t.equal(gun.ammo, ammo - 1, gun.id + ' gates simultaneous shots');
    t.equal(target.hp, 1000 - damage, gun.id + ' damage per shot');
    t.near(gun.cooldown, interval, 1e-8, gun.id + ' firing interval');
  }
  target.x = X + 70;
  p.slot = 2; w.trigger(p, { firePressed: true, aimX: X + 80, aimY: Y });
  t.equal(p.grenades, 19, 'third slot consumes a grenade');
  const grenade = w.grenades[0];
  t.equal(grenade.item, 'gasgrenade', 'throw carries its gas payload');
  t.equal(grenade.explosion, null, 'gas projectile carries no blast damage');
  for (let i = 0; i < 33; i++) w.updateGrenades(.05);
  t.equal(w.zones[0].r, 2 * W.WEAPONS.grenade.explosion.radius, 'twice the grenade radius');
  const mate = w.addPlayer({ x: target.x, y: Y, team: p.team });
  const mask = w.addPlayer({ x: target.x, y: Y, team: 2, classId: 'gastroop' });
  target.trenchId = 1; target.hp = 100;
  w.itemBurst('gasgrenade', grenade.x, grenade.y, p.id);
  stepZones(w, 1);
  t.check(target.inGas && Math.abs(w.speedMul(target) - .2) < 1e-8, 'enemy in a trench is blind and 80% slower');
  t.equal(target.hp, 75, 'overlapping clouds deal 25 damage per second in total');
  t.check(!mate.inGas && !mask.inGas && !p.inGas && mate.hp === 100 && mask.hp === 135, 'teammates and all Gas Troops stay unaffected');
  target.x += 500; stepZones(w, 1);
  t.check(!target.inGas && w.speedMul(target) === 1 && target.hp === 75, 'leaving clears every gas effect');
}
{
  const { w, p, target } = arena();
  p.slot = 3; target.hp = 1000; target.x = X + 600;
  w.trigger(p, { firePressed: true }); w.trigger(p, { fire: true });
  const cloud = w.zones[0], def = W.WEAPONS.gascylinder;
  t.equal(p.gasCylinders, 2, 'holding the trigger uses just one cylinder');
  t.near(w.speedMul(p), .90, 1e-8, 'using a cylinder adds five speed points');
  t.equal(cloud.r, W.WEAPONS.grenade.explosion.radius, 'cylinder starts one grenade wide');
  stepZones(w, 1); t.check(!target.inGas, 'target outside the growing cloud is unaffected');
  stepZones(w, def.spreadTime / 2 - 1);
  t.near(cloud.r, (def.startRadius + 2 * W.ITEMS.snowbomb.radius) / 2, .01, 'cloud expands steadily at its midpoint');
  t.check(target.inGas && target.hp < 1000, 'expanding cloud reaches and damages its target');
  stepZones(w, def.spreadTime / 2 + 1);
  t.equal(cloud.r, 2 * W.ITEMS.snowbomb.radius, 'cloud stops at two snowbombs wide');
  stepZones(w, def.duration - def.spreadTime);
  t.check(!target.inGas && !w.zones.length, 'expiry clears the cloud and blindness');
  for (let i = 0; i < 3; i++) w.trigger(p, { firePressed: true });
  t.check(p.gasCylinders === 0 && p.gasCylindersUsed === 3 && w.zones.length === 2, 'empty cylinder stock cannot create a cloud or speed bonus');
  w.respawn(p, X, Y, 'gastroop');
  t.check(p.gasCylinders === 3 && p.grenades === 20 && w.speedMul(p) === .85, 'respawn restores starting stock and speed');
}
for (const type of ['turret', 'artillery', 'sp', 'tank']) {
  const isTurret = type === 'turret', protectedSeat = type === 'sp' || type === 'tank';
  const { w, p, target } = arena({ vehicles: isTurret ? [] : [{ id: 1, type: type === 'sp' ? 'artillery' : type, fixed: type === 'artillery', x: X + 120, y: Y }] });
  const platform = isTurret ? w.addStruct({ kind: 'turret', item: 'turret', team: target.team, x: target.x, y: Y, r: 38 }) : w.vehicles[0];
  const sentry = w.addStruct({ kind: 'sentry', item: 'sentry', team: target.team, x: target.x, y: Y + 90, r: 20 });
  const hp = platform.hp, sentryHp = sentry.hp;
  t.check(isTurret ? w.mountTurret(target, platform) : w.enterVehicle(target, platform, 'driver'), type + ' occupied');
  w.itemBurst('gasgrenade', platform.x, platform.y, p.id);
  stepZones(w, 1);
  t.equal(target.hp, protectedSeat ? 100 : 75, type + ' occupant damage');
  t.equal(target.inGas, !protectedSeat, type + ' occupant visibility and slow');
  t.check(platform.hp === hp && sentry.hp === sentryHp, type + ' platform and sentry take no damage');
}
{
  const match = new Match({ W: ServerW, id: 'gas-test', seed: 44, mode: 'solo', teamSize: 1, clock: false,
    emptyTimeout: Infinity, teams: [{ members: [{ name: 'Gas Troop' }] }, { members: [{ name: 'Opponent' }] }] });
  try {
    const [p, target] = match.players, w = match.world;
    w.setClass(p, 'gastroop', true); Object.assign(p, { x: X, y: Y, dropT: 0 }); Object.assign(target, { x: X + 100, y: Y, dropT: 0 });
    match.handleInput(p, { s: 1, sl: 3, fp: true });
    t.equal(p.net.inputs.at(-1).sl, 3, 'server accepts slot four from the network');
    p.slot = 3; w.trigger(p, { firePressed: true });
    stepZones(w, 2);
    let client = W.Online.start(match.startMessage(p, true));
    W.Online.applySync(match.syncMessage());
    W.Online.applySnapshot({ time: w.time, you: match.encodeYou(p), p: [], e: [], alive: 2, teams: 2 });
    t.check(client.me.slot === 3 && client.me.gasCylinders === 2 && client.me.gasCylindersUsed === 1, 'snapshot restores fourth slot, stock and movement bonus');
    const replicated = client.world.zoneById(w.zones[0].id);
    t.near(replicated.r, w.zones[0].r, 1e-8, 'reconnect restores a partially expanded cloud');
    stepZones(w, 1); stepZones(client.world, 1);
    t.near(replicated.r, w.zones[0].r, 1e-8, 'client and server expansion stay in step');
    client = W.Online.start(match.startMessage(target, true)); W.Online.applySync(match.syncMessage());
    W.Online.applySnapshot({ time: w.time, you: match.encodeYou(target), p: [], e: [], alive: 2, teams: 2 });
    const hp = client.me.hp;
    stepZones(client.world, .4);
    t.check(client.me.inGas && client.me.hp === hp, 'online victim sees gas without client-authored damage');
  } finally { match.destroy(); }
}
{
  const match = new Match({ W: ServerW, id: 'gas-recovery', seed: 44, mode: 'solo', teamSize: 1, clock: false,
    teams: [{ members: [{ name: 'Thrower' }] }, { members: [{ name: 'Observer' }] }] });
  try {
    const w = match.world, [p, target] = match.players;
    w.setClass(p, 'gastroop', true); Object.assign(p, { x: X, y: Y, dropT: 0, slot: 3 });
    Object.assign(target, { x: X + 100, y: Y, dropT: 0, hp: 2500, maxHp: 2500 });
    const client = W.Online.start(match.startMessage(target, false));
    let delivered = 0, packet;
    const conn = target.net.conn = { open: true, bufferedAmount: 0, close() {}, sendText(text) {
      delivered++; packet = JSON.parse(text); W.Online.applySnapshot(packet);
    } };
    w.itemBurst('gasgrenade', X + 1800, Y, p.id);
    match.sendSnapshots(w.events.splice(0));
    const known = client.world.zones[0], before = delivered;
    conn.bufferedAmount = 100 * 1024;
    w.trigger(p, { firePressed: true });
    w.itemBurst('gasgrenade', target.x, target.y, p.id);
    const [, cylinder, grenade] = w.zones;
    match.sendSnapshots(w.events.splice(0));
    stepZones(w, .65); stepZones(client.world, .65);
    t.check(delivered === before && target.inGas && !client.me.inGas, 'socket backpressure skips both gas creation events');
    conn.bufferedAmount = 0; match.sendSnapshots([]);
    for (const cloud of [cylinder, grenade]) {
      const replica = client.world.zoneById(cloud.id);
      t.check(replica && Math.abs(replica.t - cloud.t) < .0001 && Math.abs(replica.r - cloud.r) < .0001, cloud.kind + ' recovers current radius and original expiry');
    }
    t.check(client.world.zones.length === 3 && client.world.zoneById(known.id) === known, 'catch-up leaves a previously visible cloud intact');
    match.sendSnapshots([]);
    t.check(!packet.e.some(e => e.t === 'zone'), 'healthy delivery returns to sending new clouds only');
    stepZones(w, .05); stepZones(client.world, .05);
    t.check(target.inGas && client.me.inGas && Math.abs(client.world.speedMul(client.me) - .2) < 1e-8, 'blindness and slow persist through the next client simulation tick');
    stepZones(w, 17.25); stepZones(client.world, 17.25);
    t.check(!client.world.zoneById(grenade.id) && client.me.inGas, 'recovered grenade expires while the longer cylinder is still active');
    stepZones(w, .1); stepZones(client.world, .1);
    t.check(!w.zones.length && !client.world.zones.length && !client.me.inGas && !target.inGas, 'last recovered cloud and its effects expire on the original schedule');
    conn.bufferedAmount = 100 * 1024;
    w.itemBurst('gasgrenade', target.x, target.y, p.id);
    match.sendSnapshots(w.events.splice(0)); stepZones(w, 10.05);
    conn.bufferedAmount = 0; match.sendSnapshots([]);
    t.check(!packet.e.some(e => e.t === 'zone') && !client.world.zones.length, 'a cloud that expired during backpressure never reappears');
    conn.bufferedAmount = 100 * 1024;
    w.itemBurst('smoke', target.x, target.y, p.id);
    const smoke = w.zones[0];
    match.sendSnapshots(w.events.splice(0)); stepZones(w, 6.25);
    conn.bufferedAmount = 0; match.sendSnapshots([]);
    const recoveredSmoke = client.world.zoneById(smoke.id);
    t.check(recoveredSmoke?.kind === 'smoke' && Math.abs(recoveredSmoke.t - 17.75) < .001 &&
      client.world.structureInSmoke(target), 'a slow client recovers the smoke that disables defenses with its original expiry');
  } finally { match.destroy(); }
}
t.done();
