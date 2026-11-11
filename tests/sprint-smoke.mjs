// Sprint stamina, exhaustion recovery, saved controls and authoritative prediction/replay.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite, MemoryStorage } from './harness.mjs';
import { Match } from '../server/core/match.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'class-combat', 'controls']);
const t = suite('sprint'), C = W.CONFIG, DT = 0.05;
const walk = { mx: 1, my: 0 }, sprint = { mx: 1, my: 0, sprint: true }, rest = { mx: 0, my: 0 };
function clearWorld(world) {
  world.map.rocks = []; world.map.trees = []; world.map.buildings = []; world.map.crates = [];
  world.map.pickups = []; world.map.ponds = []; world.map.stations = [];
  world.solids = new W.U.SpatialHash(256); world.storm = null;
}
function arena() {
  const world = new W.World({ map: W.MapGen.generate(22), storm: false });
  clearWorld(world);
  const p = world.addPlayer({ x: 8000, y: 8000 });
  return { world, p };
}
function advance(a, intent, seconds, dt = DT) {
  a.p.controller = () => intent;
  for (let i = 0; i < Math.round(seconds / dt); i++) a.world.update(dt);
}

{
  const a = arena(), b = arena(), d = arena();
  t.check(a.p.stamina === 100 && !a.p.sprintExhausted, 'players start with 100 stamina and sprint available');
  advance(a, sprint, 1); advance(b, walk, 1); advance(d, { mx: 1, my: 1, sprint: true }, 1);
  t.near(a.p.stamina, 90, 1e-9, 'one second of sprinting drains exactly 10 stamina');
  t.near(a.p.x - 8000, (b.p.x - 8000) * 1.5, 1e-8, 'sprinting moves 50 percent faster through the same acceleration');
  t.check(a.p.sprinting && !b.p.sprinting && b.p.stamina === 100, 'walking retains normal speed and does not drain stamina');
  t.near(Math.hypot(d.p.x - 8000, d.p.y - 8000), a.p.x - 8000, 1e-8, 'diagonal sprinting has the same speed as straight sprinting');
  t.equal(d.p.stamina, a.p.stamina, 'diagonal movement does not multiply stamina drain');
}
{
  const a = arena(); a.p.stamina = 50;
  advance(a, walk, 1);
  t.near(a.p.stamina, 65, 1e-9, 'walking without sprint restores 15 stamina per second');
  advance(a, rest, 1);
  t.near(a.p.stamina, 65, 1e-9, 'the first full second standing still grants no recovery');
  advance(a, rest, 0.5);
  t.near(a.p.stamina, 80, 1e-9, 'standing after the delay restores 30 stamina per second');
  advance(a, walk, 0.4);
  t.near(a.p.stamina, 86, 1e-9, 'walking switches recovery back to 15 per second');
  t.equal(a.p.sprintRestT, 0, 'moving resets the standing recovery delay');
  advance(a, rest, 0.75);
  a.world.tickStamina(a.p, rest, 0.5);
  t.near(a.p.stamina, 93.5, 1e-8, 'a step crossing the rest delay recovers only for its remaining fraction');
  a.world.tickStamina(a.p, rest, 10);
  t.equal(a.p.stamina, 100, 'recovery caps at exactly 100');
}
{
  const a = arena(); advance(a, sprint, 10);
  t.check(a.p.stamina === 0 && a.p.sprintExhausted && !a.p.sprinting, 'ten seconds of sprinting empties stamina and locks sprint');
  advance(a, sprint, 1);
  t.check(a.p.stamina === 15 && a.p.sprintExhausted && !a.p.sprinting, 'holding Shift while exhausted walks and recovers without restarting sprint');
  a.p.stamina = 99.5;
  a.world.tickStamina(a.p, walk, 0.03);
  t.check(a.p.stamina < 100 && a.p.sprintExhausted, 'exhaustion remains locked just below full stamina');
  a.world.tickStamina(a.p, walk, 0.01);
  t.check(a.p.stamina === 100 && !a.p.sprintExhausted, 'exhaustion unlocks only when recovery reaches 100');
  a.world.tickStamina(a.p, sprint, DT);
  t.check(a.p.stamina === 99.5 && a.p.sprinting, 'sprint works again after a full recovery');
  a.p.stamina = 1; a.p.sprintExhausted = false;
  const mul = a.world.tickStamina(a.p, sprint, 0.2);
  t.near(a.p.stamina, 1.5, 1e-9, 'a step crossing zero drains to zero, then recovers only while walking');
  t.check(a.p.sprintExhausted && !a.p.sprinting, 'crossing zero keeps the exhaustion lock even after fractional recovery');
  t.near(mul, 1.25, 1e-9, 'a partial sprint gets only the speed boost paid for by remaining stamina');
  const b = arena(); b.p.stamina = 1;
  for (let i = 0; i < 4; i++) b.world.tickStamina(b.p, sprint, DT);
  t.near(b.p.stamina, a.p.stamina, 1e-9, 'splitting a step does not change stamina across exhaustion');
}
{
  for (const state of ['dead', 'mounted', 'dropping', 'downed']) {
    const a = arena(); a.p.stamina = 50;
    if (state === 'dead') a.p.alive = false;
    if (state === 'mounted') a.p.mount = 99;
    if (state === 'dropping') a.p.dropT = 1;
    if (state === 'downed') a.p.downed = true;
    a.world.moveStep(a.p, sprint, DT);
    t.check(!a.p.sprinting && a.p.stamina >= 50, state + ' players cannot sprint or drain stamina');
    if (state !== 'downed') t.equal(a.p.x, 8000, state + ' players do not move through client prediction');
    else t.near(a.p.vx, C.playerSpeed * 0.35 * C.playerAccel * DT, 1e-9, 'downed players keep their normal crawl speed');
  }
  const a = arena(); a.p.stamina = 42.125; a.p.sprintExhausted = true; a.p.sprintRestT = 0.35;
  a.world.setClass(a.p, 'sniper', false);
  t.check(a.p.stamina === 42.125 && a.p.sprintExhausted && a.p.sprintRestT === 0.35, 'changing class preserves stamina and exhaustion');
  a.world.respawn(a.p, 8000, 8000);
  t.check(a.p.stamina === 100 && !a.p.sprintExhausted && a.p.sprintRestT === 0 && !a.p.sprinting, 'respawning resets the stamina lifecycle');
  a.world.remote = true; a.p.stamina = 42.125; a.p.sprinting = true;
  a.world.update(1);
  t.equal(a.p.stamina, 42.125, 'cosmetic world updates do not drain predicted stamina a second time');
}

// New defaults migrate once without stealing an existing custom control.
{
  t.equal(W.Controls.bindings('sprint')[0], 'ShiftLeft', 'Left Shift is the default sprint control');
  const old = { drop: ['KeyQ', null], inventory: ['Tab', null], reload: ['KeyT', null] };
  function saved(bindings) {
    const storage = new MemoryStorage();
    storage.setItem('warz.settings.v1', JSON.stringify({ bindings, muted: true }));
    return { storage, controls: loadWarz(['config', 'controls'], { storage }).Controls };
  }
  const normal = saved(old);
  t.check(normal.controls.primary('sprint') === 'L Shift' && normal.controls.primary('reload') === 'T' && normal.controls.muted(), 'legacy saves gain sprint while retaining custom controls and sound');
  t.equal(JSON.parse(normal.storage.getItem('warz.settings.v1')).bindings.sprint[0], 'ShiftLeft', 'the migrated sprint binding is persisted');
  const occupied = saved({ ...old, reload: ['ShiftLeft', null] });
  t.check(occupied.controls.primary('reload') === 'L Shift' && occupied.controls.primary('sprint') === 'R Shift', 'an existing Left Shift assignment is preserved with free Right Shift for sprint');
  const full = saved({ ...old, reload: ['ShiftLeft', 'ShiftRight'] });
  t.check(full.controls.bindings('sprint').every(x => x === null) && full.controls.bindings('reload').join() === 'ShiftLeft,ShiftRight', 'both occupied Shift keys remain assigned without a duplicate sprint binding');
  normal.controls.rebind('sprint', 0, 'KeyZ');
  t.equal(loadWarz(['config', 'controls'], { storage: normal.storage }).Controls.primary('sprint'), 'Z', 'a rebound sprint key survives later loads');
  normal.controls.rebind('sprint', 0, null);
  t.check(loadWarz(['config', 'controls'], { storage: normal.storage }).Controls.bindings('sprint').every(x => x === null), 'an explicitly cleared sprint binding stays cleared');
}

// The server owns stamina; inputs carry only the request to sprint. Prediction replays from the
// authoritative stamina baseline and must not charge earlier predicted frames twice.
{
  const m = new Match({ W, id: 'sprint', mode: 'solo', teamSize: 1, seed: 22, clock: false, emptyTimeout: Infinity,
    teams: [{ members: [{ name: 'Sprinter' }] }, { members: [{ name: 'Other' }] }] });
  clearWorld(m.world);
  const p = m.players[0]; p.x = 8000; p.y = 8000; p.vx = p.vy = 0; p.dropT = 0; p.stamina = 40;
  const sent = [];
  W.MatchNet = { send: message => sent.push(message) };
  const sandbox = { Warz: W, performance }; sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
  const st = W.Online.start(m.startMessage(p, false)); clearWorld(st.world);
  const snapshot = () => ({ time: m.world.time, you: m.encodeYou(p), p: [], e: [], alive: 2, teams: 2 });
  W.Online.applySnapshot(snapshot());
  const input = held => ({ down: code => held.includes(code), hit: () => false, lift: () => false, mouse: { x: 0, y: 0 } });
  const renderer = { screenToWorld: () => ({ x: st.me.x + 400, y: st.me.y }) };
  const run = input(['KeyD', 'ShiftLeft']);
  W.Online.step(run, renderer, false, false); W.Online.step(run, renderer, false, false);
  t.check(sent[0].sp === true && !('stam' in sent[0]) && st.me.stamina === 39, 'online input requests sprint while predicting two stamina steps locally');
  m.handleInput(p, sent[0]); m.tick();
  const first = snapshot();
  t.check(first.you.stam === 39.5 && first.you.exh === false && first.you.rest === 0 && first.you.spr === true, 'snapshots carry the authoritative fractional stamina and sprint state');
  W.Online.applySnapshot(first);
  t.equal(st.me.stamina, 39, 'reconciliation replays only the one unacknowledged sprint frame');
  const predictedX = st.me.x;
  W.Online.applySnapshot(first);
  t.check(st.me.stamina === 39 && st.me.x === predictedX, 'reapplying the same snapshot does not double-drain or double-move');
  m.handleInput(p, sent[1]); m.tick(); W.Online.applySnapshot(snapshot());
  t.check(st.me.stamina === p.stamina && st.pending.length === 0, 'acknowledging all input leaves client stamina equal to the server');

  p.stamina = 50; p.sprintRestT = 0.975; p.sprinting = false;
  const waiting = snapshot(); W.Online.applySnapshot(waiting);
  W.Online.step(input([]), renderer, false, false);
  t.near(st.me.stamina, 50.75, 1e-8, 'prediction honors the fractional remainder of the stationary delay');
  W.Online.applySnapshot(waiting); W.Online.applySnapshot(waiting);
  t.near(st.me.stamina, 50.75, 1e-8, 'reconciliation does not double-award stationary recovery');
  st.pending = []; p.stamina = 0; p.sprintExhausted = true; p.sprintRestT = 0;
  W.Online.applySnapshot(snapshot()); W.Online.step(run, renderer, false, false);
  t.check(st.me.stamina === 0.75 && st.me.sprintExhausted && !st.me.sprinting, 'exhaustion remains authoritative during local prediction');
  st.pending = []; p.mount = 99; p.stamina = 50; p.sprintExhausted = false;
  W.Online.applySnapshot(snapshot()); const mountedX = st.me.x;
  W.Online.step(run, renderer, false, false);
  t.check(st.me.x === mountedX && st.me.stamina === 50 && !st.me.sprinting, 'mount snapshots prevent predicted sprint movement and drain');
  W.Online.step(run, renderer, true, false);
  t.equal(sent.at(-1).sp, false, 'blocked controls release sprint on the wire');
  m.handleInput(p, { s: 100, mx: 1, sp: true });
  m.handleInput(p, { s: 101, mx: 1, sp: false });
  t.equal(m.pullInput(p).sprint, false, 'the newest delayed packet releases held sprint');
  m.handleInput(p, { s: 102, mx: 1, sp: 'true', stam: 1000 });
  t.check(!m.pullInput(p).sprint && p.stamina === 50, 'malformed sprint and client-supplied stamina cannot override server state');
  m.destroy();
}
t.done();
