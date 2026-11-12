import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
const t = suite('Rocketeer online'), DT = .05;
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls']);
let state, active, last, clock = 0, seq = 0;
const sent = [];
W.MatchNet = { send(m) { sent.push(m); }, close() {} };
const sandbox = { Warz: W, performance: { now: () => clock * 1000 } }; sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
const Online = W.Online;
const match = new Match({ W: ServerW, id: 'rpg-network', seed: 17, mode: 'solo', teamSize: 1,
  clock: false, emptyTimeout: Infinity, teams: [{ members: [{ name: 'RPG' }] }, { members: [{ name: 'Target' }] }] });
const world = match.world, [p, foe] = match.players;
function clear(w) {
  for (const key of ['rocks', 'trees', 'buildings', 'crates', 'pickups', 'ponds', 'stations']) w.map[key] = [];
  w.solids = new W.U.SpatialHash(256);
}
function connect(who, rejoin = false) {
  const conn = { player: who, open: true, bufferedAmount: 0, close() { this.open = false; }, sendJson(m) {
    if (active !== this) return;
    if (m.t === 'match-start') { state = Online.start(m); clear(state.world); }
    if (m.t === 'sync') Online.applySync(m);
  }, sendText(text) {
    if (active !== this) return;
    const m = JSON.parse(text);
    if (m.t === 'snap') { last = m; clock += DT; Online.applySnapshot(m); }
  } };
  active = conn; match.attach(who, conn, rejoin); match.sendSnapshots([]); state.seq = seq;
  return conn;
}
function flush() { match.sendSnapshots(world.events.splice(0)); }
function input(down = [], hit = []) {
  state.seq = seq;
  const keyboard = { down: k => down.includes(k), hit: k => hit.includes(k), lift: () => false, wheel: 0, mouse: { x: 0, y: 0 } };
  Online.latch(keyboard); Online.step(keyboard, { screenToWorld: () => ({ x: state.me.x + 1000, y: state.me.y }) }, false, false);
  const m = sent.at(-1); seq = m.s; match.handleInput(p, m); match.tick(); return m;
}
try {
  clear(world);
  world.vehicles.forEach((v, i) => { v.x = 12000 + i * 200; v.y = 12000; });
  p.x = 5000; p.y = 5000; foe.x = 12000; foe.y = 5000;
  for (const player of match.players) { player.dropT = 0; player.net.conn = { player, open: true, bufferedAmount: 0, close() {}, sendText() {}, sendJson() {} }; }
  world.setClass(p, 'grenadier2', true); p.tokens = 40;
  const station = { id: 0, number: 1, x: 5060, y: 5000, cooldown: 0 }; world.map.stations = [station];
  t.check(world.upgrade(p, station, 'rocketeer').ok, 'Grenadier II buys Rocketeer through the authoritative station rules');
  connect(p);
  t.check(state.me.classId === 'rocketeer' && state.me.hp === 65 && state.me.maxHp === 65 && state.me.tokens === 0, 'owner receives new class,65HP and40-token cost');
  t.equal(state.me.weapons.map(w => w.id).join(), 'rpg,pistol', 'RPG/pistol loadout reaches the owner');
  t.equal(state.world.aimedProjectile(state.me), null, 'RPG input bypasses grenade hold-to-charge');
  const fireX = p.x, fireY = p.y;
  let flashAt; const baseFlash = state.world.flash;
  state.world.flash = function (x, y, angle, weapon) { if (weapon === 'rpg') flashAt = { x, y, angle }; return baseFlash.apply(this, arguments); };
  const packet = input(['Mouse1'], ['Mouse1']);
  t.check(packet.f && packet.fp && p.stats.shots === 1, 'a physical fire press launches one authoritative rocket immediately');
  t.check(p.weapons[0].ammo === 0 && p.weapons[0].reloading && state.me.weapons[0].ammo === 0 && state.me.weapons[0].reloading, 'one-shot magazine and reload replicate together');
  t.check(last.e.some(e => e.t === 'rpg-shot') && last.rp.length === 1 && state.world.rpgRockets.length === 1, 'shot event and projectile snapshot arrive without duplicate rockets');
  t.check(last.e.find(e => e.t === 'rpg-shot').x === fireX && last.e.find(e => e.t === 'rpg-shot').y === fireY, 'shot event retains the firing origin before recoil and movement');
  t.near(flashAt.x, fireX + W.muzzleLength('rpg') * p.r, .001, 'online muzzle flash uses the same barrel offset as Practice');
  t.equal(flashAt.y, fireY, 'online muzzle flash retains captured firing direction');
  const first = world.rpgRockets[0], copy = state.world.rpgRockets[0];
  for (const key of ['id', 'owner', 'team', 'dx', 'dy', 'r', 'speed', 'range']) t.equal(copy[key], first[key], key + ' survives RPG transport');
  t.near(copy.x, first.x, .011, 'authoritative rocket position reaches the client');
  const hp = state.me.hp, x = copy.x; state.world.update(DT);
  t.check(state.world.rpgRockets[0].x > x && state.me.hp === hp, 'client advances rocket visuals without authoring damage');
  input(); flush(); flush();
  t.equal(state.world.rpgRockets.length, 1, 'repeated snapshots never duplicate rockets');
  for (let i = 0; i < 58; i++) match.tick();
  t.check(p.weapons[0].reloading && p.stats.shots === 1, 'RPG remains reloading before the full three seconds');
  match.tick();
  t.check(!p.weapons[0].reloading && p.weapons[0].ammo === 1 && state.me.weapons[0].ammo === 1, 'completed reload restores one round on authority and client');
  const far = world.spawnRpgRocket({ owner: p.id, team: p.team, x: 12000, y: 12000, dx: -1, dy: 0 }); flush();
  t.check(!state.world.rpgRockets.some(g => g.id === far.id), 'offscreen RPG is interest-culled');
  far.x = 5300; far.y = 5100; flush();
  t.check(state.world.rpgRockets.some(g => g.id === far.id), 'a traveling RPG appears when it enters view');
  world.removeRpgRocket(far.id); world.emit({ type: 'rpg-impact', id: far.id, x: 5300, y: 5100, owner: p.id }); flush();
  t.check(!state.world.rpgRockets.some(g => g.id === far.id) && state.world.events.some(e => e.type === 'rpg-impact'), 'impact removes the rocket and carries cosmetic/audio feedback');
  connect(p, true);
  t.equal(state.world.rpgRockets.length, world.rpgRockets.length, 'rejoin restores every flying RPG');
  foe.x = 5300; foe.y = 5300; connect(foe);
  t.check(state.world.playerById(p.id).classId === 'rocketeer' && state.world.playerById(p.id).weapons[0].id === 'rpg', 'observer receives Rocketeer identity and held RPG');
  connect(p); world.rpgRockets = []; flush();
  t.equal(state.world.rpgRockets.length, 0, 'empty authoritative snapshot removes stale rockets');
  Online.selectItem(0); const shots = p.stats.shots; input(['Mouse1'], ['Mouse1']);
  t.check(p.held === 0 && !p.items[0] && p.stats.shots === shots, 'empty hotbar selection cannot fire the remembered RPG');
  input([], ['Digit2']);
  t.check(p.slot === 1 && state.me.weapons[p.slot].id === 'pistol', 'basic pistol remains usable through normal slot controls');
  const tank = world.vehicles.find(v => v.type === 'tank'); tank.x = 5500; tank.y = 5000;
  foe.x = 9000; foe.y = 9000;
  const at = world.vehicleSeatPoint(tank, 'driver', true); foe.x = at.x; foe.y = at.y;
  t.check(world.enterVehicle(foe, tank, 'driver'), 'target boards tank for authoritative hull test');
  const passengerHp = foe.hp, tankHp = tank.hp;
  const g = world.spawnRpgRocket({ owner: p.id, team: p.team, x: tank.x - tank.r - 20, y: tank.y, dx: 1, dy: 0 });
  world.rpgImpact(g, { solid: { vehicle: tank } }, tank.x - tank.r, tank.y); world.removeRpgRocket(g.id); flush();
  t.equal(tank.hp, tankHp - 1000, 'direct RPG hit deals1000 tank damage without bullet/sentry resistance');
  t.check(state.world.vehicleById(tank.id).hp === tank.hp && foe.hp === passengerHp, 'tank damage replicates once while occupants stay protected');
} finally { match.destroy(); }
t.done();
