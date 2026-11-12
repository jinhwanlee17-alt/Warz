// Authoritative input, choice validation and recoverable state replication into an independent client.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';

const t = suite('Sentry online'), W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls']), DT = .05;
const sent = []; let clock = 0, state, active, last, seq = 0;
W.MatchNet = { send(m) { sent.push(m); }, close() {} };
const sandbox = { Warz: W, performance: { now: () => clock * 1000 } }; sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
const Online = W.Online;
const match = new Match({ W: ServerW, id: 'sentry-network', seed: 91, mode: 'solo', teamSize: 1,
  clock: false, emptyTimeout: Infinity,
  teams: [{ members: [{ name: 'Builder' }] }, { members: [{ name: 'Target' }] }, { members: [{ name: 'Observer' }] }] });
const world = match.world, [p, foe, observer] = match.players;
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
  active = conn; match.attach(who, conn, rejoin); match.sendSnapshots([]);
  state.seq = seq;
  return conn;
}
function flush() { match.sendSnapshots(world.events.splice(0)); }
function input(fields = {}) { match.handleInput(p, { s: ++seq, a: 0, d: 100, ...fields }); match.tick(); }
function choice(variant) { match.onMessage(p.net.conn, JSON.stringify({ t: 'sentry-choice', variant })); }
function clientInput(down = [], hit = []) {
  state.seq = seq;
  const keyboard = { down: k => down.includes(k), hit: k => hit.includes(k), lift: () => false, wheel: 0, mouse: { x: 0, y: 0 } };
  Online.latch(keyboard);
  Online.step(keyboard, { screenToWorld: () => ({ x: state.me.x + 100, y: state.me.y }) }, false, false);
  const m = sent.at(-1); seq = m.s; match.handleInput(p, m); match.tick(); return m;
}
function impact(kind, target, vehicle = false) {
  const g = world.spawnSentryProjectile({ kind, owner: p.id, team: p.team, sentry: 999, x: target.x - 40, y: target.y, dx: 1, dy: 0 });
  world.sentryProjectileImpact(g, vehicle ? { solid: { vehicle: target } } : { player: target }, target.x, target.y);
  world.removeSentryProjectile(g.id); return g;
}
function statusMatches(server, client, message) {
  const a = (server.sentrySnow || []).filter(x => x > world.time).map(x => x - world.time);
  const b = (client.sentrySnow || []).filter(x => x > state.world.time).map(x => x - state.world.time);
  t.equal(b.length, a.length, message + ': active stack count');
  a.forEach((left, i) => t.near(b[i], left, .0011, message + ': stack ' + i + ' remaining time'));
  t.near(Math.max(0, (client.sentryFreezeUntil || 0) - state.world.time), Math.max(0, (server.sentryFreezeUntil || 0) - world.time), .0011, message + ': freeze remaining time');
  if (server.sentryBurn) {
    t.check(!!client.sentryBurn && client.sentryBurn.owner === server.sentryBurn.owner, message + ': burn owner');
    t.near(client.sentryBurn?.until - state.world.time, server.sentryBurn.until - world.time, .0011, message + ': burn remaining time');
  }
}

try {
  clear(world);
  world.vehicles.forEach((v, i) => { v.x = 1000 + i * 300; v.y = 2000; });
  match.players.forEach((who, i) => {
    who.x = i ? 9000 + i * 300 : 5000; who.y = i ? 9000 : 5000; who.dropT = 0;
    who.net.conn = { player: who, open: true, bufferedAmount: 0, close() {}, sendText() {}, sendJson() {} };
  });
  world.setClass(p, 'engineer', true); p.tokens = 30;
  const s = world.addStruct({ kind: 'sentry', item: 'sentry3', owner: p.id, team: p.team,
    x: 5100, y: 5000, r: 22, hp: ServerW.ITEMS.sentry3.hp, maxHp: ServerW.ITEMS.sentry3.hp });
  connect(p); flush();
  choice('bullets');
  t.check(!p.sentrySelection && p.tokens === 30, 'unsolicited choice packet cannot start or pay for an upgrade');
  const third = clientInput([], ['Digit3']);
  t.check(third.sl === 2 && p.slot === 2 && state.me.slot === 2 && state.me.weapons[2].id === 'engineerhammer', 'Digit3 selects the new hammer through actual client and server input');
  Online.selectItem(2); const empty = clientInput(['Mouse1'], ['Mouse1']);
  t.check(empty.ht === 2 && p.held === 2 && state.me.held === 2 && !p.items[2], 'an empty hotbar slot remains selectable online');
  t.check(!p.sentryWork && !p.sentryBuild, 'firing with the empty slot cannot trigger the remembered class weapon');
  observer.x = 5300; observer.y = 5300; connect(observer);
  const seenEmpty = state.world.playerById(p.id);
  t.check(seenEmpty.held >= 0 && !seenEmpty.items[seenEmpty.held], 'remote player row preserves visibly empty hands');
  connect(p, true); clientInput([], ['Digit3']);
  p.tokens = 29; input({ f: true, fp: true });
  t.check(!p.sentryChoice && !state.me.sentryChoice && !p.sentryWork, 'twenty-nine tokens cannot open the final upgrade menu');
  p.tokens = 30; input({ f: true, fp: true });
  const offered = p.sentryChoice.options.slice(), picked = offered[5];
  t.equal(offered.join(), 'bullets,grenades,rockets,snowballs,fireballs,cannons', 'server offers all six specializations in stable order');
  t.equal(state.me.sentryChoice.options.join(), offered.join(), 'local client receives exactly the server offer');
  const firstOfferNonce = p.sentryChoice.nonce;
  t.check(firstOfferNonce > 0 && state.me.sentryChoice.nonce === firstOfferNonce, 'authoritative offer identity survives the local snapshot');
  for (const bad of ['invalid-sentry', 'unknown', { variant: picked }, 1]) {
    choice(bad); t.check(!p.sentrySelection && !!p.sentryChoice && p.tokens === 30, 'server rejects unknown/malformed variant ' + JSON.stringify(bad));
  }
  const position = p.x; p.x -= 300; choice(picked); p.x = position;
  t.check(!p.sentrySelection && !p.sentryChoice, 'choice packet cannot bypass hammer reach and invalidates its stale offer');
  input({ f: true });
  t.check(state.me.sentryChoice.nonce > firstOfferNonce && state.me.sentryChoice.nonce === p.sentryChoice.nonce, 'retry packet replaces a rejected offer with a new client-visible identity');
  s.hp--; choice(picked); s.hp++;
  t.check(!p.sentrySelection && !p.sentryChoice, 'choice packet cannot bypass full sentry health and invalidates its stale offer');
  input({ f: true });
  p.tokens = 29; choice(picked); p.tokens = 30;
  t.check(!p.sentrySelection && !p.sentryChoice, 'choice packet rechecks available tokens and invalidates its stale offer');
  input({ f: true });
  p.held = 1; choice(picked); p.held = -1;
  t.check(!p.sentrySelection && !p.sentryChoice, 'choice packet cannot upgrade while an empty utility slot is selected');
  input({ f: true });
  choice(null); flush();
  t.check(!p.sentryChoice && !p.sentrySelection && !state.me.sentryChoice, 'explicit cancel clears both server and client menus');
  input({ f: true });
  t.equal(p.sentryChoice.options.join(), offered.join(), 'reopening preserves all six choices and their order');
  Online.chooseSentryUpgrade(picked);
  const packet = sent.at(-1); match.onMessage(p.net.conn, JSON.stringify(packet)); flush();
  t.check(packet.t === 'sentry-choice' && p.sentrySelection.variant === 'cannons' && !state.me.sentryChoice && p.tokens === 30, 'accepted last Cannon choice reserves its variant without charging early');
  for (let i = 0; i < 40; i++) input({ f: true });
  t.near(p.sentryWork.elapsed, 2, 1e-8, 'upgrade requires actual server build time');
  t.near(state.me.sentryWork.elapsed, 2, .001, 'owner receives authoritative work progress');
  world.useEmote(p, 0); connect(observer);
  const seen = state.world.playerById(p.id), row = last.p.find(x => x[0] === p.id);
  t.check(row[20] && !row[21] && row[22].work && seen.emote && seen.sentryWork.elapsed === 2, 'work replication preserves emote/build columns for another player');
  connect(p, true);
  t.check(state.me.slot === 2 && state.me.sentryWork.elapsed === 2, 'rejoin restores third slot and unfinished upgrade work');
  const elapsed = state.me.sentryWork.elapsed, hpBeforeMirror = state.world.structById(s.id).hp;
  state.world.update(.25);
  t.check(state.me.sentryWork.elapsed === elapsed && state.world.structById(s.id).hp === hpBeforeMirror, 'client cannot advance build work or structure health');
  input({ f: false });
  t.check(!p.sentryWork && !state.me.sentryWork && p.tokens === 30, 'releasing the hammer cancels work without spending tokens');
  for (let i = 0; i < 599; i++) input({ f: true });
  t.check(s.item === 'sentry3' && p.tokens === 30, 'upgrade is still uncommitted at29.95 seconds');
  input({ f: true });
  t.check(s.item === ServerW.SENTRY_IV[picked].item && p.tokens === 0 && !p.sentryWork, 'full thirty seconds spends exactly thirty tokens once');
  let mirror = state.world.structById(s.id);
  t.check(mirror.item === s.item && mirror.hp === s.hp && mirror.maxHp === s.maxHp, 'completed variant and its distinct HP replicate together');
  input({ f: false });

  // Skip an event-bearing frame, then prove complete state repairs the mirror.
  const oldHp = mirror.hp; active.bufferedAmount = 100 * 1024;
  world.damageStruct(s, 17, foe.id, s.x, s.y, 'pistol'); flush();
  t.equal(mirror.hp, oldHp, 'slow connection really skips a damage event');
  active.bufferedAmount = 0; flush();
  t.equal(mirror.hp, s.hp, 'next snapshot repairs structure health without replaying the lost event');
  active.bufferedAmount = 100 * 1024; world.destroyStruct(s, foe.id); flush();
  active.bufferedAmount = 0; flush();
  t.check(!state.world.structById(s.id), 'next complete structure list removes a missed destroyed sentry');

  // Every projectile family retains its own authoritative identity and trajectory.
  const shots = Object.keys(ServerW.SENTRY_IV).map((kind, i) => world.spawnSentryProjectile({
    kind, owner: p.id, team: p.team, sentry: 987, x: 5200 + i * 25, y: 5600, dx: 1, dy: 0,
    ...(kind === 'grenades' ? { startX: 5225, startY: 5600, targetX: 5825, targetY: 5600, flightTime: 1, peakHeight: 120, flightElapsed: .2, z: 70 } : {})
  }));
  flush();
  t.equal(state.world.sentryProjectiles.length, 6, 'all six projectile types arrive in the interest snapshot');
  for (const shot of shots) {
    const copy = state.world.sentryProjectiles.find(g => g.id === shot.id);
    t.check(copy?.kind === shot.kind && copy.owner === p.id && copy.team === p.team && copy.sentry === 987, shot.kind + ': projectile identity survives transport');
    t.check(copy?.speed === shot.speed && copy.range === shot.range && copy.r === shot.r, shot.kind + ': physical projectile properties survive transport');
  }
  let lob = state.world.sentryProjectiles.find(g => g.kind === 'grenades');
  t.check(lob.flightTime === 1 && lob.peakHeight === 120 && lob.flightElapsed === .2 && lob.z === 70 && lob.targetX === 5825, 'grenade snapshot carries complete airborne trajectory');
  const hp = state.me.hp, sx = state.world.sentryProjectiles.find(g => g.kind === 'bullets').x;
  state.world.update(DT);
  t.check(state.world.sentryProjectiles.find(g => g.kind === 'bullets').x > sx && state.me.hp === hp, 'mirror advances projectile cosmetics without authoring damage');
  flush(); flush();
  t.equal(state.world.sentryProjectiles.length, 6, 'repeated snapshots replace projectile state without duplicating IDs');
  const far = world.spawnSentryProjectile({ kind: 'rockets', owner: p.id, team: p.team, sentry: 987, x: 12000, y: 12000, dx: 1, dy: 0 }); flush();
  t.check(!state.world.sentryProjectiles.some(g => g.id === far.id), 'snapshot excludes a projectile outside the viewer interest radius');
  far.x = 5300; far.y = 5600; flush();
  t.check(state.world.sentryProjectiles.some(g => g.id === far.id), 'existing projectile appears when it enters view');
  world.removeSentryProjectile(shots[0].id); world.emit({ type: 'sentry-impact', id: shots[0].id, kind: shots[0].kind, x: 5350, y: 5600 }); flush();
  t.check(!state.world.sentryProjectiles.some(g => g.id === shots[0].id), 'impact packet and snapshot cannot leave a ghost projectile');
  connect(p, true);
  t.equal(state.world.sentryProjectiles.length, world.sentryProjectiles.length, 'full sync restores all live projectile IDs without duplication');
  world.sentryProjectiles = []; flush();
  t.equal(state.world.sentryProjectiles.length, 0, 'empty authoritative projectile list clears all mirrored shots');

  // Player effects and quarter-damage hull HP come from the same authoritative hits.
  p.x = 5400; p.y = 5000; foe.x = 5000; foe.y = 5000; observer.x = 5200; observer.y = 5300;
  foe.maxHp = foe.hp = 1000; connect(foe);
  impact('fireballs', foe); for (let i = 0; i < 5; i++) impact('snowballs', foe); flush();
  t.equal(state.me.hp, foe.hp, 'fireball/snow impact damage arrives once through the authoritative HP snapshot');
  statusMatches(foe, state.me, 'local player status');
  t.near(state.world.speedMul(state.me), world.speedMul(foe), 1e-9, 'movement prediction reads the replicated snow penalty');
  const hitHp = state.me.hp; state.world.update(.2);
  t.equal(state.me.hp, hitHp, 'client burn visuals never apply periodic player damage');
  for (let i = 0; i < 15; i++) impact('snowballs', foe); flush();
  statusMatches(foe, state.me, 'twentieth snowball freeze');
  t.check(state.me.sentryFreezeUntil > state.world.time && state.world.speedMul(state.me) === 0, 'twentieth hit freezes the predictive movement path');
  const x = state.me.x; state.world.moveStep(state.me, { mx: 1, my: 0 }, DT);
  t.equal(state.me.x, x, 'frozen client movement does not drift before reconciliation');
  connect(observer); statusMatches(foe, state.world.playerById(foe.id), 'remote player status');
  connect(foe, true); statusMatches(foe, state.me, 'rejoin player status');

  foe.sentrySnow = []; foe.sentryFreezeUntil = 0; foe.sentryBurn = null;
  const tank = world.vehicles.find(v => v.type === 'tank'), humvee = world.vehicles.find(v => v.type === 'humvee');
  tank.x = 5200; tank.y = 5000; humvee.x = 5600; humvee.y = 5000;
  const at = world.vehicleSeatPoint(tank, 'driver', true); foe.x = at.x; foe.y = at.y;
  t.check(world.enterVehicle(foe, tank, 'driver'), 'status target boards a tank through authoritative seat rules');
  const beforeRocket = tank.hp, riderBeforeRocket = foe.hp;
  const rocket = world.spawnSentryProjectile({ kind: 'rockets', owner: p.id, team: p.team, sentry: 999,
    x: tank.x - tank.r - 40, y: tank.y, dx: 1, dy: 0 });
  world.updateSentryProjectiles(.1); flush();
  t.equal(beforeRocket - tank.hp, 100, 'actual rocket projectile direct hit bypasses tank armor for exactly100 HP');
  t.equal(state.world.vehicleById(tank.id).hp, beforeRocket - 100, 'authoritative100-HP rocket damage replicates exactly to the driver hull snapshot');
  t.check(!world.sentryProjectiles.some(g => g.id === rocket.id) && !state.world.sentryProjectiles.some(g => g.id === rocket.id), 'direct rocket impact consumes the projectile on server and client');
  t.check(foe.hp === riderBeforeRocket && state.me.hp === riderBeforeRocket, 'rocket tank armor bypass never bypasses passenger protection');
  connect(foe, true);
  t.equal(state.world.vehicleById(tank.id).hp, beforeRocket - 100, 'rejoining restores the exact full-damage rocket hull result');
  const tankHp = tank.hp, passengerHp = foe.hp;
  world.damageVehicle(tank, 5, p.id, 'sentry'); for (let i = 0; i < 10; i++) impact('snowballs', tank, true);
  impact('fireballs', tank, true); impact('fireballs', humvee, true); impact('snowballs', humvee, true); flush();
  const clientTank = state.world.vehicleById(tank.id), clientHumvee = state.world.vehicleById(humvee.id);
  t.near(tank.hp, tankHp - 1.25 - 25 - 5, 1e-9, 'tank applies base sentry and IV resistances exactly once');
  t.equal(clientTank.hp, tank.hp, 'snapshot retains the fractional quarter-damage hull HP');
  t.check(foe.hp === passengerHp && state.me.hp === foe.hp, 'passenger HP remains protected during sentry hull hits');
  statusMatches(tank, clientTank, 'tank status'); statusMatches(humvee, clientHumvee, 'Humvee status');
  t.check(!clientTank.sentryBurn && !!clientHumvee.sentryBurn, 'only the Humvee receives replicated burn');
  t.equal(state.world.vehicleSentryRate(clientTank), .5, 'replicated ten-stack tank weapon clock is halved');
  tank.mgAmmo = 0; world.reloadTankGun(tank); flush();
  const reload = tank.mgReload;
  for (let i = 0; i < 10; i++) match.tick();
  t.near(tank.mgReload, reload - .25, 1e-8, 'server advances a snow-slowed tank reload at half speed');
  t.near(state.world.vehicleById(tank.id).mgReload, tank.mgReload, .0011, 'slow reload state reaches the driver snapshot');
  t.equal(state.world.vehicleById(humvee.id).hp, Math.round(humvee.hp * 100) / 100, 'Humvee burn ticks replicate without double damage');
  const hull = state.world.vehicleById(humvee.id).hp; state.world.update(.2);
  t.equal(state.world.vehicleById(humvee.id).hp, hull, 'client vehicle burn update remains cosmetic');
  connect(foe, true); statusMatches(tank, state.world.vehicleById(tank.id), 'rejoin tank status');
  statusMatches(humvee, state.world.vehicleById(humvee.id), 'rejoin Humvee status');
  foe.sentrySnow = []; foe.sentryFreezeUntil = 0; foe.sentryBurn = null;
  tank.sentrySnow = []; tank.sentryBurn = null; humvee.sentrySnow = []; humvee.sentryBurn = null; flush();
  t.check(!state.me.sentrySnow.length && !state.me.sentryFreezeUntil && !state.me.sentryBurn && !state.world.vehicleById(tank.id).sentrySnow.length && !state.world.vehicleById(humvee.id).sentryBurn, 'absent authoritative status clears every stale effect');
} finally { match.destroy(); }
t.done();
