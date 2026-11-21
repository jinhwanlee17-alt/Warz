import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'online', 'map-art']);
const t = suite('Landmines'), X = 6000, Y = 6000;
function arena(extra = {}) {
  const map = { seed: 25, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
    pickups: [], stations: [], ponds: [], drops: [], nextPickupId: 1, ...extra };
  const w = new W.World({ map, storm: false, teams: true });
  const owner = w.addPlayer({ x: X - 100, y: Y, team: 1 });
  return { w, owner };
}
function equip(w, p, item, n) {
  w.addItem(p, item, n); p.held = p.items.findIndex(slot => slot && slot.id === item); p.itemCd = 0;
}
function place(w, p, x = X, y = Y) {
  return w.useHeld(p, { firePressed: true, aimX: x, aimY: y });
}
function markers(w, p, big) {
  let icons = 0, warnings = 0;
  const g = new Proxy({
    measureText(text) { return { width: text.length * 6 }; },
    fill() { if (this.fillStyle === '#f4d850' || this.fillStyle === '#ffa453') icons++; },
    fillText(text) { if (text === '!') warnings++; }
  }, { get(obj, name) { return name in obj ? obj[name] : () => {}; } });
  W.MapArt.overlay(g, w, p, big ? 800 : 180, { big });
  return { icons, warnings };
}
{
  const { w, owner } = arena(), mate = w.addPlayer({ x: X, y: Y, team: owner.team });
  const enemy = w.addPlayer({ x: X + W.ITEMS.snowbomb.radius + 1, y: Y, team: 2 });
  equip(w, owner, 'landmine', 3);
  t.check(!place(w, owner) && w.countItem(owner, 'landmine') === 3 && !w.mines.length, 'occupied placement preserves inventory');
  mate.x = X + 100;
  t.check(place(w, owner) && w.countItem(owner, 'landmine') === 2 && w.mines.length === 1, 'placing consumes one mine');
  t.check(!w.structures.length && !w.map.pickups.length, 'a planted mine has no visible structure or ground item');
  const mine = w.mines[0], radius = W.ITEMS.snowbomb.radius, warnings = () => w.events.filter(e => e.type === 'mine-alert');
  w.updateItems(.05); w.updateItems(.05);
  t.check(mine.alert && warnings().length === 1 && warnings()[0].player === owner && warnings()[0].x === X && warnings()[0].y === Y,
    'placing within range pings the placer once at the mine position');
  enemy.x = X + 125; w.updateItems(.05);
  t.equal(warnings().length, 1, 'an enemy stepping into warning range does not ping the placer again');
  for (const big of [false, true]) {
    t.equal(markers(w, owner, big).warnings, 1, 'nearby placer sees one exclamation mark on map size ' + big);
    for (const viewer of [mate, enemy]) {
      const visible = markers(w, viewer, big);
      t.check(!visible.icons && !visible.warnings, 'nearby ' + (viewer === mate ? 'teammate' : 'opponent') + ' sees no mine or warning on map size ' + big);
    }
  }
  owner.x = X + radius + .1; w.updateItems(.05);
  for (const big of [false, true]) {
    const visible = markers(w, owner, big);
    t.check(!mine.alert && !visible.warnings && visible.icons === 1, 'outside warning range the placer sees just the ordinary marker on map size ' + big);
  }
  enemy.x = X + radius + 1; mate.x = X - radius - 10; w.updateItems(.05);
  enemy.x = X + 125; mate.x = X + 100; w.updateItems(.05);
  t.check(!mine.alert && warnings().length === 1, 'enemy and teammate arrivals give no warning while the placer is away');
  owner.x = X + .8 * radius; owner.y = Y + .8 * radius; w.updateItems(.05);
  t.check(!mine.alert && !markers(w, owner, true).warnings && warnings().length === 1,
    'diagonal proximity uses circular snowbomb range');
  owner.x = X + radius; owner.y = Y; w.updateItems(.05); w.updateItems(.05);
  t.check(mine.alert && warnings().length === 2 && mine.pings === 2, 'the exact snowbomb boundary is inside and reentry pings once');
  owner.alive = false;
  w.updateItems(.05);
  t.check(!mine.alert && !markers(w, owner, true).warnings && mine.pings === 2, 'a dead placer receives no warning');
  owner.alive = true;
  mate.x = X; mate.y = Y + 60;
  enemy.x = X - 130; enemy.hp = enemy.maxHp = 900; enemy.armor = 500; enemy.fx.shield = 60;
  w.addPlayer({ team: enemy.team, x: X - 500, y: Y }); owner.y -= 140;
  w.moveStep(enemy, { mx: 1, my: 0 }, 1);
  t.check(!enemy.alive && !enemy.downed && enemy.hp === 0 && !w.mines.length && owner.stats.kills === 1,
    'crossing a mine instantly eliminates even an armored player with a living teammate');
  t.near(enemy.x, X - enemy.r - W.ITEMS.landmine.radius, .001, 'a fast-moving player stops at first contact');
  t.check(mate.alive && mate.hp === mate.maxHp && !markers(w, owner, true).icons, 'contact leaves nearby bystanders unharmed and clears the marker');
}
{
  const { w, owner } = arena(), secondSite = X + W.ITEMS.snowbomb.radius * 2 + 30;
  equip(w, owner, 'landmine', 2); place(w, owner); w.updateMineAlerts();
  owner.x = secondSite - 100; owner.itemCd = 0; place(w, owner, secondSite, Y); w.updateMineAlerts();
  t.check(w.mines.length === 2 && !w.mines[0].alert && w.mines[1].alert && markers(w, owner, true).warnings === 1,
    'each mine checks its own distance from the same placer');
}
for (const [id, humvee, tank] of [['landmine', 400, 150], ['vehiclemine', 1650, 1550]]) {
  {
    const { w, owner } = arena();
    equip(w, owner, id, 1); place(w, owner);
    owner.y = Y + owner.r + 18.1;
    w.moveStep(owner, { mx: 1, my: 0 }, .8);
    t.check(owner.x > X && owner.alive && w.mines.length === 1, id + ' remains armed just outside its enlarged 18-unit contact radius');
    owner.x = X - 100; owner.y = Y + owner.r + 17.9;
    w.moveStep(owner, { mx: 1, my: 0 }, .8);
    t.check(!owner.alive && !w.mines.length, id + ' eliminates its placer inside the enlarged contact radius');
    t.check(w.explosions.some(e => e.x === X && e.y === Y && e.r === 97.5), id + ' shows a fifty-percent larger detonation');
  }
  for (const [type, damage] of [['humvee', humvee], ['tank', tank], ['artillery', tank]]) {
    const { w, owner } = arena({ vehicles: [{ type, x: X + 400, y: Y, angle: Math.PI }] });
    const v = w.vehicles[0], driver = w.addPlayer({ x: v.x, y: v.y, team: owner.team });
    w.enterVehicle(driver, v, 'driver'); driver.vehicleIntent = { mx: -1, my: 0 };
    v.maxHp = v.hp = 4000; owner.fx.strength = 30; owner.commandBuff = 10;
    equip(w, owner, id, 1); place(w, owner); owner.y -= 300;
    for (let i = 0; i < 150 && w.mines.length; i++) w.updateVehicles(.05);
    t.equal(v.hp, 4000 - damage, id + ' deals exactly ' + damage + ' to a moving ' + type);
    t.check(!w.mines.length && driver.alive && driver.hp === driver.maxHp, id + ' damages a friendly hull without hitting its driver');
  }
}
{
  const { w, owner } = arena({ vehicles: [{ type: 'humvee', x: X + 350, y: Y, angle: Math.PI }] });
  const hull = w.vehicles[0], driver = w.addPlayer({ x: hull.x, y: hull.y, team: 2 });
  w.enterVehicle(driver, hull, 'driver'); driver.vehicleIntent = { mx: -1, my: 0 }; hull.hp = 350;
  equip(w, owner, 'landmine', 1); place(w, owner); owner.y -= 300;
  for (let i = 0; i < 150 && w.mines.length; i++) w.updateVehicles(.05);
  t.check(hull.wreck && !hull.hp && driver.alive && !driver.vehicle && !w.mines.length,
    'destroying a low-health hull ejects the living driver and spends the mine');
}
{
  const match = new Match({ W: ServerW, id: 'landmines', seed: 15, clock: false, mode: 'solo', teamSize: 1,
    teams: [{ members: [{ name: 'Placer' }] }, { members: [{ name: 'Opponent' }] }] });
  try {
    const w = match.world, [owner, enemy] = match.players;
    w.solids = new ServerW.U.SpatialHash(256); w.vehicles = []; w.structures = []; w.map.trenches = [];
    Object.assign(owner, { x: X - 100, y: Y, dropT: 0 }); Object.assign(enemy, { x: X + 1050, y: Y, dropT: 0 });
    let ownPacket, otherPacket;
    const client = W.Online.start(match.startMessage(owner, false));
    const ownerSocket = owner.net.conn = { open: true, bufferedAmount: 0, close() {}, sendText(text) {
      ownPacket = JSON.parse(text); W.Online.applySnapshot(ownPacket);
    } };
    enemy.net.conn = { open: true, bufferedAmount: 0, close() {}, sendText(text) { otherPacket = JSON.parse(text); } };
    match.sendSnapshots([]); ownerSocket.bufferedAmount = 100 * 1024;
    equip(w, owner, 'vehiclemine', 1); t.check(place(w, owner), 'server accepts a legal placement');
    match.sendSnapshots(w.events.splice(0));
    t.check(!otherPacket.you.mines && !otherPacket.e.some(e => e.it === 'vehiclemine' || e.t === 'sound'),
      'opponents receive neither the placement location nor a placement sound');
    w.updateMineAlerts(); ownerSocket.bufferedAmount = 0; match.sendSnapshots(w.events.splice(0));
    t.check(ownPacket.you.mines.length === 1 && client.world.mines[0].alert && client.world.events.some(e => e.type === 'mine-alert'),
      'after a missed placement the owner receives the private map marker and proximity warning');
    t.check(!otherPacket.you.mines && !otherPacket.e.some(e => e.t === 'mine-alert') && !JSON.stringify(match.syncMessage()).includes('vehiclemine'),
      'opponent snapshots and the shared reconnect payload contain no private mine');
    match.sendSnapshots([]); t.check(!ownPacket.you.mines, 'unchanged mine markers do not resend each movement snapshot');
    const warnings = () => client.world.events.filter(e => e.type === 'mine-alert').length, prior = warnings();
    owner.x = X + 1050; w.updateMineAlerts(); match.sendSnapshots(w.events.splice(0));
    enemy.x = X + 100; w.updateMineAlerts(); match.sendSnapshots(w.events.splice(0));
    t.check(warnings() === prior && !client.world.mines[0].alert && !ownPacket.you.mines,
      'an opponent approaching while the placer is away produces no online mine update');
    owner.x = X - 100; w.updateMineAlerts(); owner.x = X + 1050; w.updateMineAlerts();
    match.sendSnapshots(w.events.splice(0));
    t.check(warnings() === prior && !client.world.mines[0].alert, 'a brief visit between snapshots leaves no stale ping or warning after the placer exits range');
    const away = W.Online.start(match.startMessage(owner, true));
    match.attach(owner, { ...ownerSocket, sendJson() {} }, true); match.sendSnapshots([]);
    t.check(away.world.mines.length === 1 && !away.world.mines[0].alert && !away.world.events.some(e => e.type === 'mine-alert'),
      'rejoining outside range restores the private map pin without replaying a warning');
    owner.x = X - 100; w.updateMineAlerts();
    const fresh = W.Online.start(match.startMessage(owner, true));
    match.attach(owner, { ...ownerSocket, sendJson() {} }, true); match.sendSnapshots([]);
    t.check(fresh.world.mines[0]?.alert && fresh.world.mines[0]?.x === X, 'reconnection recovers the existing mine for its owner');
    w.moveStep(enemy, { mx: -1, my: 0 }, .8); match.sendSnapshots(w.events.splice(0));
    t.check(!enemy.alive && ownPacket.you.mines.length === 0 && !fresh.world.mines.length,
      'authoritative detonation clears the owner marker, even across reconnect');
    t.check(otherPacket.e.some(e => e.t === 'boom' && e.c === 'vehiclemine' && e.r === 97.5),
      'nearby players receive the enlarged detonation radius after the hidden mine goes off');
  } finally { match.destroy(); }
}
t.done();
