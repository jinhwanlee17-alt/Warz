// Roster identities are not bodies: mirror a real 50-player match and its
// interest-filtered snapshots, including players the client has never seen.
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerWarz } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';

const t = suite('online presence');
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'class-combat', 'online']);
const Online = W.Online;
const teams = Array.from({ length: 50 }, (_, i) => ({ members: [i ? { bot: true } : { name: 'Observer' }] }));
const match = new Match({ W: ServerWarz, id: 'presence-test', mode: 'solo', teamSize: 1,
  teams, seed: 15, clock: false, emptyTimeout: 1e9 });
const human = match.players[0];
let state = Online.start(match.startMessage(human, false));
let snapshots = 0;
human.net.conn = { open: true, bufferedAmount: 0, sendJson() {}, close() {}, sendText(text) {
  const m = JSON.parse(text);
  if (m.t === 'snap') { snapshots++; Online.applySnapshot(m); }
} };

try {
  t.equal(state.world.players.length, 50, 'the complete roster remains available');
  t.check(state.world.players.every(p => p.hidden), 'roster-only identities have no visible placeholder bodies, including our spawn');
  for (let i = 0; i < 200; i++) { match.tick(); state.world.update(0.05); Online.interpolate(); }
  const world = state.world;
  const unknown = world.players.filter(p => p !== state.me && p.seenAt < 0 && p.alive);
  t.equal(snapshots, 200, 'the client receives ten seconds of real interest-filtered snapshots');
  t.check(unknown.length > 30, 'the reproduction includes many live players outside the observer interest range');
  t.check(unknown.every(p => p.hidden && p.dropT === 0), 'unseen players stay hidden after their cosmetic parachutes finish');
  t.check(!state.me.hidden && state.me.seenAt >= 0, 'our body becomes visible at the authoritative spawn');
  const remote = unknown[0], actual = match.byId.get(remote.id);
  t.check(Math.hypot(actual.x - remote.x, actual.y - remote.y) > 3600,
    'the unseen roster placeholder is not the real server player position');

  const textCount = world.texts.length, ringCount = world.explosions.length, eventCount = world.events.length;
  Online.applyEvent({ t: 'saved', id: remote.id });
  Online.applyEvent({ t: 'blocked', id: remote.id, how: 'immune' });
  t.check(world.texts.length === textCount && world.explosions.length === ringCount,
    'unknown-player status events do not paint SAVED or IMMUNE at the placeholder');
  t.equal(world.events.length, eventCount + 2, 'global status events remain available to the HUD');

  actual.x = human.x + 150; actual.y = human.y; actual.dropT = 0;
  match.sendSnapshots([]);
  t.check(!remote.hidden && remote.snaps.length === 1, 'the first nearby snapshot reveals the real player');
  t.near(remote.x, actual.x, 0.11, 'first appearance uses the received x without interpolating from map center');
  t.near(remote.y, actual.y, 0.11, 'first appearance uses the received y');
  const previousX = remote.x;

  actual.x = human.x < world.map.size / 2 ? world.map.size - 1200 : 1200;
  match.world.time += 0.5;
  const beforeStaleText = world.texts.length;
  const beforeStaleEvents = world.events.length;
  match.sendSnapshots([{ type: 'saved', player: actual }]);
  t.check(remote.hidden, 'a player outside interest becomes hidden before this snapshot events run');
  t.check(world.events.slice(beforeStaleEvents).some(e => e.type === 'saved' && e.player === remote),
    'the global status event is delivered despite the player being outside interest');
  t.equal(world.texts.length, beforeStaleText, 'a same-packet status event cannot draw at a stale position');

  actual.x = previousX + 120;
  match.world.time += 0.05;
  match.sendSnapshots([]);
  t.check(!remote.hidden && remote.snaps.length === 1, 'reappearance clears the obsolete interpolation history');
  t.near(remote.x, actual.x, 0.11, 'even a short reappearance does not briefly draw the old position');

  actual.x = human.x < world.map.size / 2 ? world.map.size - 1200 : 1200;
  match.world.time += 0.5;
  match.sendSnapshots([]);
  Online.applyEvent({ t: 'death', id: remote.id, k: human.id, c: 'ar', wd: false });
  Online.interpolate();
  t.check(!remote.alive && remote.hidden, 'a globally reported death does not reveal a stale corpse');
  const neverSeen = unknown[1];
  Online.applyEvent({ t: 'death', id: neverSeen.id, k: human.id, c: 'ar', wd: false });
  Online.interpolate();
  t.check(!neverSeen.alive && neverSeen.hidden, 'a never-seen death stays hidden while updating roster state');

  // Rejoining restores world-wide state, but sync is not a visibility grant.
  state = Online.start(match.startMessage(human, true));
  Online.applySync(match.syncMessage());
  t.check(!state.me.hidden && state.me.x !== state.world.map.size / 2,
    'rejoin sync positions and reveals our own player');
  t.check(state.world.players.filter(p => p !== state.me).every(p => p.hidden),
    'rejoin sync does not expose distant or invisible opponents');
  t.check(state.world.players.some(p => p !== state.me && p.x !== state.world.map.size / 2),
    'hidden rejoin roster entries still retain their synchronized positions');
  match.sendSnapshots([]);
  const nearby = state.world.players.filter(p => p !== state.me && p.seenAt >= 0);
  t.check(nearby.length > 0 && nearby.every(p => !p.hidden), 'the next interest snapshot reveals nearby rejoined players normally');
  t.check(state.world.players.filter(p => p.seenAt < 0).every(p => p.hidden), 'other rejoined roster entries stay hidden');

  // Explicit event coordinates are valid even if the firing body is unknown.
  const unseenShooter = state.world.players.find(p => p !== state.me && p.hidden && p.alive);
  Online.applyEvent({ t: 'shot', id: unseenShooter.id, w: 'ar', x: 4800, y: 4200, a: [0] });
  const shot = state.world.events.at(-1);
  t.check(shot.type === 'shot' && shot.player === unseenShooter && shot.x === 4800 && shot.y === 4200,
    'shot feedback preserves actor identity and authoritative coordinates for spatial sound');
  t.check(unseenShooter.hidden, 'a position-bearing shot does not reveal its unknown owner body');
} finally {
  match.destroy();
}
t.done();
