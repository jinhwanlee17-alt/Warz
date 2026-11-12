import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
const t = suite('Magic Medic and Shotgunner III online'), DT = .05;
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls']);
let state, active, last, clock = 0, seq = 0;
const sent = [];
W.MatchNet = { send(m) { sent.push(m); }, close() {} };
const sandbox = { Warz: W, performance: { now: () => clock * 1000 } }; sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
const Online = W.Online;
const match = new Match({ W: ServerW, id: 'medic-shotgun-network', seed: 17, mode: 'duos', teamSize: 2,
  clock: false, emptyTimeout: Infinity, teams: [{ members: [{ name: 'Medic' }, { name: 'Ally' }] }, { members: [{ name: 'Observer' }, { name: 'Enemy' }] }] });
const world = match.world, [p, ally, foe, extra] = match.players;
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
function input(down = [], hit = [], aim = { x: p.x + 1000, y: p.y }) {
  state.seq = seq;
  const keyboard = { down: k => down.includes(k), hit: k => hit.includes(k), lift: () => false, wheel: 0, mouse: { x: 0, y: 0 } };
  const item = W.Controls.itemSlotHit(keyboard, state.me); if (item !== null) Online.selectItem(item);
  if (hit.includes('KeyE')) Online.pressInteract();
  Online.latch(keyboard); Online.step(keyboard, { screenToWorld: () => aim }, false, false);
  const m = sent.at(-1); seq = m.s; match.handleInput(p, m); match.tick(); return m;
}
try {
  clear(world);
  world.vehicles.forEach((v, i) => { v.x = 12000 + i * 200; v.y = 12000; });
  p.x = 5000; p.y = 5000; ally.x = 5060; ally.y = 5000; foe.x = 14000; foe.y = 5000; extra.x = 14000; extra.y = 5500;
  for (const player of match.players) { player.dropT = 0; player.net.conn = { player, open: true, bufferedAmount: 0, close() {}, sendText() {}, sendJson() {} }; }
  world.setClass(p, 'medic2', true); p.tokens = 40; p.items[0] = { id: 'bandage', n: 3 };
  const station = { id: 0, number: 1, x: 4940, y: 5000, cooldown: 0 }; world.map.stations = [station];
  t.check(world.upgrade(p, station, 'magicmedic').ok, 'Medic II buys Magic Medic through authoritative station rules');
  connect(p);
  t.equal(state.me.classId, 'magicmedic', 'Magic Medic identity reaches the owner');
  t.equal(state.me.maxHp, 300, '300 maximum HP replicates');
  t.equal(state.me.weapons.map(w => w.id).join(), 'revolver,medicstaff,magicmedkit', 'all three class weapons reach the owner');
  t.equal(state.me.tokens, 0, 'upgrade costs 40 tokens');
  input([], ['Digit6']);
  t.check(p.held === 0 && state.me.items[0].id === 'bandage', 'old slot-three item remains accessible in physical slot six online');
  input([], ['Digit3']);
  t.check(p.held < 0 && p.slot === 2 && state.me.weapons[state.me.slot].id === 'magicmedkit', 'physical slot three selects the medkit');
  p.hp = 150; flush(); input(['Mouse1'], ['Mouse1']); input();
  t.equal(p.hp, 450, 'empty-ground medkit click adds 300 HP above maximum');
  t.equal(state.me.hp, 450, 'owner retains authoritative overheal');
  t.check(p.medkitCd > 29 && state.me.medkitCd > 29, '30-second medkit cooldown reaches HUD state');
  t.equal(ally.hp, ally.maxHp, 'self use does not also heal nearby teammates');
  // First observation may change class and HP in the same packet: do not clamp overheal.
  foe.x = 5300; connect(foe);
  t.equal(state.world.playerById(p.id).hp, 450, 'first observer snapshot preserves overheal when learning the new class');
  connect(p); input([], ['Digit3']); p.medkitCd = 0; ally.hp = 50; flush();
  input(['Mouse1'], ['Mouse1'], { x: ally.x, y: ally.y }); input();
  t.equal(ally.hp, 350, 'aimed teammate click heals exactly that teammate by 300');
  t.equal(p.hp, 450, 'teammate use does not also heal the caster');
  p.medkitCd = 0; world.switchSlot(p, 2); flush(); input(['KeyE'], ['KeyE']); input();
  t.equal(ally.hp, 650, 'E beside a teammate uses the held medkit on that teammate');
  const cd = p.medkitCd; world.downPlayer(ally, foe, 'pistol'); world.switchSlot(p, 0); flush();
  for (let i = 0; i < 41; i++) input(['KeyE'], i === 0 ? ['KeyE'] : []);
  input();
  t.check(!ally.downed && ally.hp === ally.maxHp, 'holding E revives to full HP even with medkit cooling down and revolver equipped');
  t.check(p.medkitCd > 0 && p.medkitCd < cd, 'revival does not spend or reset medkit cooldown');
  world.downPlayer(ally, foe, 'pistol'); world.revivePlayer(ally, p); p.medkitCd = 0;
  world.useMedkit(p, null, ally); flush();
  t.equal(state.world.playerById(ally.id).hp, ally.maxHp + 300, 'same-packet knock/revive feedback cannot overwrite final overhealed health');
  ally.hp = 40; p.hp = 150; input([], ['Digit2']);
  for (let i = 0; i < 20; i++) input();
  t.check(ally.hp > 40 && p.hp === 150, 'held staff heals the teammate and excludes the caster online');
  t.check(state.me.medicStaff.active && state.me.medicStaff.elapsed > 0, 'held staff progress and activity replicate');
  const heldProgress = p.medicStaff.elapsed;
  input(['Mouse1'], ['Mouse1'], { x: p.x + 40, y: p.y + 40 }); input();
  t.check(p.medicStaff.placed && state.me.medicStaff.placed, 'staff placement is authoritative');
  t.check(p.medicStaff.elapsed < heldProgress, 'placement restarts the healing stages');
  t.equal(state.world.placedMedicStaffs().length, 1, 'placed staff appears in the global marker list');
  t.check(state.world.placedMedicStaffs()[0].owner === p.id, 'marker carries owner and position');
  flush(); t.check(last.ms === undefined && state.world.placedMedicStaffs().length === 1, 'unchanged global waypoint is retained without resending it each tick');
  const remoteHp = state.me.hp, serverProgress = p.medicStaff.elapsed;
  state.world.update(.5);
  t.equal(state.me.hp, remoteHp, 'remote rendering never authors healing');
  t.equal(p.medicStaff.elapsed, serverProgress, 'remote visual updates cannot alter authoritative cycle');
  foe.x = 14000; connect(foe);
  t.check(!last.p.some(row => row[0] === p.id), 'far-away enemy Medic body remains interest-culled');
  t.equal(state.world.placedMedicStaffs().length, 1, 'enemy still sees the global staff waypoint outside interest range');
  connect(foe, true);
  t.equal(state.world.placedMedicStaffs().length, 1, 'rejoin restores the staff waypoint');
  // Backpressure skips a removal packet; the next complete marker list repairs it.
  active.bufferedAmount = 100 * 1024;
  world.pressInteract(p); flush();
  t.check(!p.medicStaff.placed && state.world.placedMedicStaffs().length === 1, 'test dropped the pickup snapshot');
  active.bufferedAmount = 0; flush();
  t.equal(state.world.placedMedicStaffs().length, 0, 'next snapshot removes a waypoint even when pickup event was missed');
  connect(p); input([], ['Digit2']); input(['Mouse1'], ['Mouse1'], { x: p.x + 40, y: p.y + 40 }); input();
  t.check(p.medicStaff.placed, 'staff can be placed again after pickup');
  match.detach(active); connect(foe); flush();
  t.equal(state.world.placedMedicStaffs().length, 0, 'disconnect removes the Medic healing waypoint');
  connect(p); world.setClass(p, 'shotgunner2', true); station.cooldown = 0; p.tokens = 40;
  t.check(world.upgrade(p, station, 'shotgunner3').ok, 'Shotgunner II buys Shotgunner III'); flush();
  t.check(state.me.maxHp === 175 && state.me.weapons.map(w => w.id).join() === 'shotgun3,dualrevolver', 'Shotgunner III health and both weapons replicate');
  input([], ['Digit2']); input(); input(); const before = world.bullets.length;
  input(['Mouse1'], ['Mouse1']);
  const shot = last.e.find(e => e.t === 'shot' && e.w === 'dualrevolver');
  t.check(shot && shot.a.length === 2, 'dual revolver replicates both bullet angles in one trigger event');
  t.check(world.bullets.length >= before + 2 && p.weapons[1].ammo === 8 && state.me.weapons[1].ammo === 8, 'two bullets consume two of ten rounds on authority and owner');
  t.check(!state.me.medicStaff && !state.world.placedMedicStaffs().length, 'switching class clears Medic state and markers');
} finally { match.destroy(); }
t.done();
