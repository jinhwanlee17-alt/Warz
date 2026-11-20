import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match, TICK } from '../server/core/match.mjs';

const t = suite('trenches online');
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls']);
let clock = 0, lastInput;
W.MatchNet = { send(message) { lastInput = message; } };
const sandbox = { Warz: W, performance: { now: () => clock * 1000 } };
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
const online = W.Online;
const match = new Match({ W: ServerW, id: 'trench', mode: 'solo', teamSize: 1, seed: 74, clock: false,
  emptyTimeout: Infinity, teams: [{ members: [{ name: 'Scout' }] }, { members: [{ name: 'Observer' }] }] });
const [player, other] = match.players, trench = match.map.trenches[0];
const [a, b] = trench.points, wall = ServerW.Trenches.wall(trench, (a.x + b.x) / 2, (a.y + b.y) / 2);
player.x = wall.x - wall.nx * 15; player.y = wall.y - wall.ny * 15; player.dropT = other.dropT = 0;
other.x = wall.x + wall.nx * 200; other.y = wall.y + wall.ny * 200;
const st = online.start(match.startMessage(player, false)), me = st.me, remote = st.world.playerById(other.id);
const renderer = { screenToWorld: () => ({ x: me.x + 400, y: me.y }) };
function keys(held = false, presses = 0) {
  return { down: k => held && k === 'Space', hit: () => false, pressCount: k => k === 'Space' ? presses : 0,
    wheel: 0, mouse: { x: 0, y: 0 } };
}
function step(held = false, presses = 0, blocked = false) {
  const input = keys(held, presses);
  online.latch(input); online.step(input, renderer, blocked, false);
  return lastInput;
}
function snapshot(events = []) {
  return JSON.parse(JSON.stringify({ time: match.world.time, you: match.encodeYou(player),
    p: [match.encodePlayer(other)], e: events, alive: 2, teams: 2 }));
}
function deliver(packet) {
  match.handleInput(player, packet); match.tick(); clock += TICK; online.applySnapshot(snapshot());
}

try {
  online.applySnapshot(snapshot());
  const first = step(), second = step(), predictedDepth = me.trenchDepth;
  t.check(me.trenchId === trench.id && me.trenchPhase === 'enter' && predictedDepth > 0 && predictedDepth < 1,
    'local prediction begins descending immediately over the seeded trench');
  match.handleInput(player, first); match.tick(); clock += TICK;
  const baseline = snapshot();
  online.applySnapshot(baseline); online.applySnapshot(baseline);
  t.check(st.pending.length === 1 && me.trenchDepth === predictedDepth, 'repeat reconciliation advances only the outstanding descent tick');
  deliver(second);
  for (let i = 0; i < 12; i++) deliver(step());
  t.check(player.trenchPhase === 'inside' && me.trenchPhase === 'inside' && me.trenchDepth === 1, 'descent converges on the floor');
  deliver(step(true, 1));
  t.check(player.trenchPeeking && me.trenchPeeking && me.trenchTapT === player.trenchTapT, 'hold and first physical tap reach the authoritative wall');
  deliver(step(false));
  t.check(!player.trenchPeeking && !me.trenchPeeking, 'releasing Space lowers the player on both peers');
  for (let i = 0; i < 8; i++) deliver(step());
  online.latch(keys(false, 1)); // Two separate render frames before the next network step.
  const exit = step(false, 1);
  t.check(exit.tp === 2 && !exit.th && me.trenchPhase === 'exit', 'two short taps in a single network step start a predicted climb');
  const exitNext = step();
  deliver(exit);
  const exitBaseline = snapshot(), x = me.x, y = me.y;
  online.applySnapshot(exitBaseline);
  t.check(me.trenchPhase === 'exit' && me.trenchExitX === player.trenchExitX && me.trenchExitY === player.trenchExitY &&
    me.x === x && me.y === y && me.trenchDepth < player.trenchDepth, 'exit destination and depth replay identically with one outstanding movement');
  online.applySync(JSON.parse(JSON.stringify(match.syncMessage())));
  t.check(me.trenchDepth === player.trenchDepth && me.trenchExitX === player.trenchExitX && me.trenchPhase === 'exit',
    'reconnecting mid-climb restores an exact exit baseline');
  deliver(exitNext);
  for (let i = 0; i < 12; i++) deliver(step());
  t.check(!me.trenchId && !player.trenchId && me.trenchDepth === 0 && me.trenchPhase === '', 'both peers clear trench state on reaching the bank');

  match.handleInput(player, { s: 101, th: true, tp: 1 });
  match.handleInput(player, { s: 102, th: false, tp: 1 });
  const caughtUp = match.pullInput(player), held = match.pullInput(player);
  t.check(caughtUp.trenchPress === 2 && !caughtUp.trenchHeld && held.trenchPress === 0,
    'server burst coalescing keeps both taps and the last hold state without repeating a press');
  match.handleInput(player, { s: 103, th: 'yes', tp: '2' });
  const invalid = match.pullInput(player);
  t.check(!invalid.trenchHeld && invalid.trenchPress === 0, 'invalid wire types cannot synthesize a trench action');
  const blocked = step(true, 2, true);
  t.check(!blocked.th && blocked.tp === 0, 'open menus suppress both held and tapped trench input');

  Object.assign(other, { trenchId: trench.id, trenchPhase: 'enter', trenchDepth: 0.2 });
  match.world.time += 1; online.applySnapshot(snapshot());
  Object.assign(other, { trenchPhase: 'inside', trenchDepth: 1, trenchPeeking: true });
  match.world.time += 0.05; online.applySnapshot(snapshot());
  clock += 0.075; online.interpolate();
  t.near(remote.trenchDepth, 0.6, 1e-7, 'spectators see a smooth descent between remote snapshots');
  clock += 0.1; online.interpolate();
  t.check(remote.trenchPhase === 'inside' && remote.trenchPeeking, 'spectators receive the exposed wall pose');
  player.trenchId = trench.id; player.trenchPhase = 'inside'; player.trenchDepth = 1;
  match.teleportPracticePlayer(player, { x: other.x + 150, y: other.y });
  match.teleportPracticePlayer(other, { x: other.x + 300, y: other.y });
  const displacements = match.world.events.filter(e => e.type === 'teleport').map(e => match.encodeEvent(e).msg);
  online.applySnapshot(snapshot(displacements)); online.interpolate();
  t.check(!me.trenchId && !remote.trenchId && remote.snaps.length === 1 && !st.pending.length,
    'teleporting out clears stale local input and remote climb interpolation');

  // Events can be delivered after the shooter's pose has changed in the same snapshot.
  // Aim along the first bay so the replicated muzzle sweep clears the weapon.
  Object.assign(other, { x: a.x + (b.x - a.x) * .3, y: a.y + (b.y - a.y) * .3,
    angle: Math.atan2(b.y - a.y, b.x - a.x), trenchId: trench.id, trenchPhase: 'inside',
    trenchDepth: 1, trenchPeeking: false });
  function shootThenChangePose(peekingAfter) {
    match.world.events = [];
    other.weapons[other.slot].cooldown = 0;
    match.world.trigger(other, { fire: true, firePressed: true });
    const shot = match.world.events.find(e => e.type === 'shot');
    if (!shot) throw new Error('The server did not emit the rifle shot');
    other.trenchPeeking = peekingAfter;
    const message = match.encodeEvent(shot).msg;
    st.world.bullets = []; st.world.particles = [];
    match.world.time += TICK;
    online.applySnapshot(snapshot([message]));
    return message;
  }
  const ammo = other.weapons[other.slot].ammo;
  const floorShot = shootThenChangePose(true);
  t.check(floorShot.tr === trench.id && other.weapons[other.slot].ammo === ammo - 1,
    'the authoritative floor shot spends ammunition and encodes its launch trench after the shooter peeks');
  t.check(st.world.bullets.length === 1 && st.world.bullets[0].trenchId === trench.id && remote.recoil === 1 &&
    st.world.particles.some(fx => fx.kind === 'flash' && fx.trenchId === trench.id),
    'remote floor fire produces a below-ground tracer, muzzle flash and recoil');
  st.world.updateBullets(2);
  t.check(!st.world.bullets.length && st.world.particles.some(fx => fx.trenchId === trench.id && fx.kind !== 'flash'),
    'the delayed floor round stops at the bank with a below-ground impact');
  const peekShot = shootThenChangePose(false);
  t.check(!peekShot.tr && st.world.bullets.length === 1 && !st.world.bullets[0].trenchId &&
    st.world.particles.some(fx => fx.kind === 'flash' && !fx.trenchId),
    'a shot fired while exposed stays on the surface after the shooter ducks');

  const wire = trench.wires.at(-1);
  Object.assign(player, { x: (wire.a.x + wire.b.x) / 2, y: (wire.a.y + wire.b.y) / 2, vx: 0, vy: 0, armor: 0 });
  online.applySnapshot(snapshot());
  st.seq = Math.max(st.seq, player.net.ack); // Account for the server-only input packets above.
  const healthOnEntry = player.hp;
  match.world.events = [];
  for (let i = 0; i < Math.round(1 / TICK); i++) {
    step();
    match.world.update(TICK);
    clock += TICK;
  }
  t.equal(me.hp, healthOnEntry, 'one second of predicted wire contact waits for authoritative damage');
  t.equal(player.hp, healthOnEntry - 10, 'the server takes ten health from a player standing on the wire for one second');
  const wireHits = match.world.events.filter(e => e.type === 'damage' && e.cause === 'barbed-wire' && e.target === player)
    .map(e => match.encodeEvent(e).msg);
  t.check(wireHits.length === 1 && wireHits[0].n === 10 && wireHits[0].src === 0, 'the server reports one environmental wire hit');
  const afterWire = snapshot(wireHits);
  online.applySnapshot(afterWire);
  t.check(st.pending.length > 0 && me.hp === healthOnEntry - 10, 'damage feedback and replay of pending inputs display the single server hit');
  online.applySync(match.syncMessage());
  online.applySnapshot(snapshot());
  t.equal(me.hp, healthOnEntry - 10, 'resyncing on the wire preserves the health reported by the server');

  const wireIndex = trench.wires.length - 1, clientTrench = st.world.map.trenches[trench.id - 1];
  function connection() {
    return { open: true, bufferedAmount: 0, sendText(raw) { this.snap = JSON.parse(raw); }, close() {} };
  }
  function crush(index) {
    if (!ServerW.Trenches.crushWire(match.map, trench.id, index)) throw new Error('expected intact server wire');
    return { type: 'wire-crushed', trenchId: trench.id, wireIndex: index };
  }
  const localConn = player.net.conn = connection(), farConn = other.net.conn = connection();
  other.x = player.x < match.map.size / 2 ? match.map.size - 1000 : 1000;
  step(); // Pending input should replay against the cleared coil on this snapshot.
  const cut = crush(wireIndex);
  match.sendSnapshots([cut]);
  t.check([localConn, farConn].every(conn => conn.snap.e.some(e => e.t === 'wire-crushed' && e.tr === trench.id && e.w === wireIndex)),
    'the tank opening reaches both nearby and distant players');
  const move = st.world.moveStep;
  let replaySawOpening = false;
  st.world.moveStep = function (...args) {
    replaySawOpening = !W.Trenches.wireAt(this.map, player.x, player.y, player.r);
    return move.apply(this, args);
  };
  try { online.applySnapshot(localConn.snap); } finally { st.world.moveStep = move; }
  t.check(replaySawOpening && clientTrench.wires[wireIndex].destroyed && !clientTrench.wires[1].destroyed,
    'only the impacted section disappears before pending movement replays');
  const version = st.world.map.wireVersion;
  online.applySnapshot(localConn.snap);
  t.equal(st.world.map.wireVersion, version, 'a duplicate snapshot keeps the same opening');

  farConn.bufferedAmount = 100 * 1024;
  match.sendSnapshots([crush(0)]);
  farConn.bufferedAmount = 0;
  match.sendSnapshots([]);
  t.check(farConn.snap.e.some(e => e.t === 'wire-crushed' && e.w === 0) && !localConn.snap.e.some(e => e.t === 'wire-crushed'),
    'a congested connection receives its missed removal once the next snapshot can be sent');
  match.sendSnapshots([]);
  t.check(!farConn.snap.e.some(e => e.t === 'wire-crushed'), 'subsequent frames omit already delivered removals');
  const late = online.start(match.startMessage(other, false));
  function correctOpenings(world) {
    const wires = world.map.trenches[trench.id - 1].wires;
    return wires[0].destroyed && wires[wireIndex].destroyed && !wires[1].destroyed;
  }
  t.check(correctOpenings(late.world), 'a first-time late join starts with both openings in the seeded map');
  const rejoin = online.start(match.startMessage(other, true));
  online.applySync(match.syncMessage());
  t.check(correctOpenings(rejoin.world), 'a reconnect restores both removed sections from the full sync');
} finally { match.destroy(); }
t.done();
