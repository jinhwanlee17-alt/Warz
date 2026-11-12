// Fire-bar authority, snapshots and reconnect recovery with the actual browser decoder.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
const t = suite('Pyromaniac fire bar online');
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls']);
let state, active, last, clock = 0;
W.MatchNet = { send() {}, close() {} };
const sandbox = { Warz: W, performance: { now: () => clock * 1000 } }; sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
const Online = W.Online;
const match = new Match({ W: ServerW, id: 'pyro-firebar-network', seed: 17, mode: 'duo', teamSize: 2,
  clock: false, emptyTimeout: Infinity, teams: [{ members: [{ name: 'Pyro' }, { name: 'Observer' }] }] });
const world = match.world, [p, observer] = match.players;
function clear(w) {
  for (const key of ['rocks', 'trees', 'buildings', 'crates', 'pickups', 'ponds', 'stations']) w.map[key] = [];
  w.solids = new W.U.SpatialHash(256); w.storm = null;
}
function connect(who, rejoin = false) {
  const conn = { player: who, open: true, bufferedAmount: 0, close() { this.open = false; }, sendJson(m) {
    if (active !== this) return;
    if (m.t === 'match-start') { state = Online.start(m); clear(state.world); }
    if (m.t === 'sync') Online.applySync(m);
  }, sendText(text) {
    if (active !== this) return;
    const m = JSON.parse(text);
    if (m.t === 'snap') { last = m; clock += .05; Online.applySnapshot(m); }
  } };
  active = conn; match.attach(who, conn, rejoin); match.sendSnapshots([]); return conn;
}
function flush() { match.sendSnapshots(world.events.splice(0)); }
function fire() { p.weapons[1].cooldown = 0; return world.trigger(p, { fire: true }); }
try {
  clear(world); world.time = 100;
  world.vehicles.forEach((v, i) => { v.x = 14000 + i * 200; v.y = 14000; });
  p.x = 5000; p.y = 5000; observer.x = 5200; observer.y = 5000;
  for (const player of match.players) { player.dropT = 0; player.net.conn = { player, open: true, bufferedAmount: 0, close() {}, sendText() {}, sendJson() {} }; }
  world.setClass(p, 'pyromaniac', true); p.tokens = 50; world.useUtility(p, {}); world.switchSlot(p, 1);
  connect(p);
  t.check(state.me.pyroFiregun && W.WEAPONS[state.me.weapons[1].id].infiniteAmmo, 'owner receives the purchased unlimited-ammo Firegun');
  t.equal(state.me.pyroFireBar, 50, 'fresh fire bar arrives full');
  t.equal(state.me.pyroFireResetT, 0, 'unused bar has no active reset timer');
  fire(); flush();
  t.equal(p.pyroFireBar, 43, 'authority spends seven fire units for the first shot');
  t.equal(state.me.pyroFireBar, 43, 'first shot remaining fire reaches the owner');
  t.near(state.me.pyroFireResetT, 60, .001, 'first shot starts the one-minute countdown');
  t.near(world.bullets.at(-1).damage, 900, .001, 'first projectile damage uses the full bar before spending fuel');
  const deadline = p.pyroFireResetAt;
  world.time += .125; fire(); flush();
  t.equal(state.me.pyroFireBar, 36, 'second shot leaves thirty-six fuel on the owner');
  t.near(world.bullets.at(-1).damage, 774, .001, 'subsequent damage scales with the remaining fire before firing');
  t.equal(p.pyroFireResetAt, deadline, 'additional shots do not postpone the window reset');
  t.near(state.me.pyroFireResetT, 59.875, .001, 'countdown reflects the original window');
  const serverBar = p.pyroFireBar;
  state.world.spendPyroFire(state.me, 30);
  state.world.trigger(state.me, { fire: true });
  t.equal(state.me.pyroFireBar, serverBar, 'client combat mirror cannot author fire usage');
  const beforeTimer = state.me.pyroFireResetT;
  state.world.update(.2);
  t.near(state.me.pyroFireResetT, beforeTimer - .2, .001, 'remote countdown animates between snapshots');
  match.onMessage(active, JSON.stringify({ t: 'in', s: 1, fire: 0, pyroFireBar: 50, py: { fire: 50, reset: 0 } }));
  t.equal(p.pyroFireBar, serverBar, 'client-supplied bar and timer values cannot reset the authority');
  connect(observer);
  const remote = () => state.world.playerById(p.id);
  t.equal(remote().pyroFireBar, 36, 'nearby observer receives remaining fire');
  t.near(remote().pyroFireResetT, 59.875, .001, 'nearby observer receives the same reset window');
  t.check(remote().pyroFiregun && remote().weapons[1].id === 'firegun', 'observer sees the permanent weapon transformation');
  for (let i = 0; i < 6; i++) { world.time += .125; fire(); }
  flush();
  t.equal(p.pyroFireBar, 0, 'authority clamps remaining fuel to zero after the eighth shot');
  t.equal(remote().pyroFireBar, 0, 'empty bar replicates to observer');
  t.near(world.bullets.at(-1).damage, 18, .001, 'last projectile uses the one remaining fire unit before spending it');
  const cappedShots = p.stats.shots;
  t.check(!fire() && p.stats.shots === cappedShots, 'authority prevents firing with an empty bar');
  connect(p, true);
  t.check(state.me.pyroFireBar === 0 && state.me.pyroFireResetT > 59, 'owner reconnect preserves the empty bar without refreshing its timer');
  t.check(!state.me.weapons[1].reloading && !world.startReload(p), 'unlimited Firegun never enters a magazine reload');
  // Sync alone restores the values even if snapshots have not resumed yet.
  state.me.pyroFireBar = 50; state.me.pyroFireResetT = 0; Online.applySync(match.syncMessage());
  t.check(state.me.pyroFireBar === 0 && state.me.pyroFireResetT > 59, 'full synchronization preserves an explicit zero fuel value');
  const legacySync = match.syncMessage(); delete legacySync.players.find(row => row[0] === p.id)[12].fire;
  Online.applySync(legacySync);
  t.equal(state.me.pyroFireBar, 50, 'missing legacy fire field defaults to full for Pyromaniac');
  Online.applySync(match.syncMessage());
  world.switchSlot(p, 0); p.weapons[0].cooldown = 0;
  world.updateClassCombat(p, { fire: true }, .5); world.trigger(p, { fire: true }); flush();
  t.check(p.stats.shots > cappedShots && state.me.pyroFireBar === 0, 'empty bar leaves flamethrower firing available');
  world.time = deadline - .01; world.updateClassCombat(p, {}, 0); flush();
  t.equal(state.me.pyroFireBar, 0, 'bar remains empty until its original deadline');
  world.time = deadline; world.updateClassCombat(p, {}, 0); flush();
  t.check(state.me.pyroFireBar === 50 && state.me.pyroFireResetT === 0, 'idle window expiry refills the owner bar and clears its timer');
  connect(observer, true);
  t.check(remote().pyroFireBar === 50 && remote().pyroFireResetT === 0, 'observer reconnect restores the refilled bar');
  connect(p); world.switchSlot(p, 0); world.updateClassCombat(p, { fire: true }, 1.25); flush();
  t.equal(state.me.pyroFireBar, 48.75, 'fractional flamethrower fuel drain replicates without rounding to whole units');
  t.near(state.me.pyroFireResetT, 60, .001, 'flamethrower use starts its own fresh reset window');
  world.setClass(p, 'soldier', true); flush();
  t.check(!state.me.pyroFireBar && !state.me.pyroFireResetT, 'changing class clears stale fire-bar HUD state');
} finally { match.destroy(); }
t.done();
