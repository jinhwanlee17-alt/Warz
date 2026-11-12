// Real authoritative Match packets drive an independent browser simulation.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
const t = suite('level3 online'), W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls']);
const sandbox = { Warz: W, performance: { now: () => clock * 1000 } }; sandbox.window = sandbox;
let clock = 0, state, last, seq = 0;
W.MatchNet = { send() {}, close() {} };
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
const Online = W.Online, responses = [];
const match = new Match({ W: ServerW, id: 'level3-check', seed: 23, mode: 'solo', teamSize: 1, clock: false,
  emptyTimeout: Infinity, teams: [{ members: [{ name: 'Builder' }] }, { members: [{ name: 'Observer' }] }] });
const [p, foe] = match.players, world = match.world;
function clear(world) {
  for (const key of ['rocks', 'trees', 'buildings', 'crates', 'pickups', 'ponds']) world.map[key] = [];
  world.solids = new W.U.SpatialHash(256);
  world.vehicles.forEach((v, i) => { v.x = 2000 + i * 300; v.y = 2000; });
  world.map.stations = [{ id: 0, number: 1, x: 5000, y: 5000, cooldown: 0 }];
}
function connect(who, rejoin = false) {
  match.players.forEach(o => { o.net.conn = null; });
  state = Online.start(match.startMessage(who, rejoin)); clear(state.world);
  const conn = { open: true, player: who, bufferedAmount: 0, close() {}, sendJson(m) { responses.push(m); }, sendText(text) {
    const m = JSON.parse(text);
    if (m.t === 'snap') { last = m; clock += 0.05; Online.applySnapshot(m); }
  } };
  who.net.conn = conn;
  if (rejoin) Online.applySync(match.syncMessage());
  match.sendSnapshots([]);
  return conn;
}
function input(fields = {}) { match.handleInput(p, { s: ++seq, a: 0, d: 100, ...fields }); match.tick(); }
function upgrade(conn, id) { match.onMessage(conn, JSON.stringify({ t: 'upgrade', cls: id })); return responses.at(-1); }
try {
  clear(world); p.x = 5000; p.y = 5000; p.dropT = 0; foe.x = 5900; foe.y = 5000; foe.dropT = 0;
  world.setClass(p, 'grenadier', false); world.setClass(p, 'armorcrew', false);
  const station = world.map.stations[0]; p.nearStation = station;
  let conn = connect(p);
  p.tokens = 39;
  t.check(!upgrade(conn, 'engineer').ok && p.classId === 'armorcrew' && p.tokens === 39, 'upgrade packet cannot bypass the forty-token price');
  p.tokens = 40;
  t.check(!upgrade(conn, 'tankcommander').ok && p.tokens === 40, 'named unfinished class remains server-locked');
  t.check(upgrade(conn, 'engineer').ok && p.tokens === 0, 'valid packet upgrades any level-two branch to Engineer for forty tokens');
  match.tick();
  t.check(state.me.classId === 'engineer' && state.me.weapons.map(w => w.id).join() === 'wrench,pistol,engineerhammer', 'snapshot reconstructs all three Engineer weapon slots');
  t.equal(state.me.upgradePath.join(), 'soldier,grenadier,armorcrew', 'actual universal-branch ancestry survives multiplayer replication');
  t.equal(W.Rules.relation(state.me, 'grenadier'), 'owned', 'tree can display the true earlier branch after upgrading online');
  input({ f: true, fp: true });
  for (let i = 1; i < 100; i++) input({ f: true });
  t.near(p.sentryBuild.elapsed, 5, 0.00001, 'held fire advances construction by server time');
  t.near(state.me.sentryBuild.elapsed, 5, 0.001, 'local client receives authoritative construction progress');
  t.check(state.me.sentryBuild.x === 5100 && state.me.sentryBuild.y === 5000, 'build marker position arrives with progress');
  const saved = state.me.sentryBuild.elapsed; state.world.update(0.5);
  t.equal(state.me.sentryBuild.elapsed, saved, 'remote mirror cannot advance construction or spawn a sentry locally');
  world.useEmote(p, 0); connect(foe);
  const row = last.p.find(row => row[0] === p.id), seen = state.world.playerById(p.id);
  t.check(row?.[20]?.[0] === p.emote.id && row?.[21]?.[0] === 5, 'construction snapshot preserves the existing emote column');
  t.check(seen.sentryBuild?.elapsed === 5 && seen.emote?.id === p.emote.id, 'other players can see construction and emotes together');
  connect(p, true);
  t.near(state.me.sentryBuild.elapsed, 5, 0.001, 'rejoining restores in-progress construction');
  input({ f: false });
  t.check(!p.sentryBuild && !state.me.sentryBuild, 'release packet cancels construction on both sides');
  input({ f: true, fp: true });
  for (let i = 1; i < 199; i++) input({ f: true });
  t.equal(world.structures.length, 0, 'no authoritative structure before ten seconds');
  input({ f: true });
  t.check(world.structures.length === 1 && state.world.structures.length === 1, 'completed sentry replicates through the normal structure event exactly once');
  t.check(!p.sentryBuild && !state.me.sentryBuild, 'completion clears both progress displays');
  const s = world.structures[0];
  t.check(s.hp === ServerW.ITEMS.sentry.hp && state.world.structures[0].hp === s.hp, 'network-built sentry uses normal sentry health');
  conn = connect(p, true);
  t.equal(state.world.structures.length, 1, 'reconnect restores the completed sentry without duplication');
  input({ f: false }); world.setClass(p, 'medic2', true); station.cooldown = 0; p.tokens = 40; p.nearStation = station;
  t.check(upgrade(conn, 'shieldoperator').ok, 'Shield Operator can be bought from a different level-two branch');
  match.tick();
  t.check(state.me.classId === 'shieldoperator' && state.me.shieldUp && state.me.weapons[0].ammo === 10, 'online combined shield and ten-round pistol start ready');
  input({ f: true, fp: true, d: 900 });
  t.check(p.weapons[0].ammo === 9 && state.me.weapons[0].ammo === 9 && state.me.shieldUp, 'firing consumes one authoritative round without lowering the shield');
  input({ sl: 1 });
  t.check(state.me.slot === 1 && state.me.shieldUp && state.me.weapons[1].id === 'explosiveshield', 'slot-two input selects the red shield in the client');
  const hp = p.hp;
  world.explode(p.x + 80, p.y, ServerW.WEAPONS.grenade.explosion, foe.id, 'grenade'); match.tick();
  t.check(p.hp === hp && state.me.hp === hp, 'server blocks a frontal grenade and client never applies extra damage');
  world.damagePlayer(p, 8, foe.id, 'tankmg', p.x, p.y, { x: p.x + 80, y: p.y }); match.tick();
  t.check(p.hp === hp - 8 && state.me.hp === hp - 8, 'tank machine gun bypasses the red shield on server and client');
  connect(foe);
  t.check(state.world.playerById(p.id).slot === 1 && state.world.playerById(p.id).shieldUp, 'other players receive the active red shield slot and raised flag');
  const tank = world.vehicles.find(v => v.type === 'tank');
  tank.x = 5500; tank.y = 5000; tank.hp = tank.maxHp;
  foe.x = tank.x + tank.r + 20; foe.y = tank.y;
  t.check(world.enterVehicle(foe, tank, 'driver'), 'opponent enters a tank in sentry range');
  connect(p);
  const hullHp = tank.hp, crewHp = foe.hp; s.cooldown = 0;
  world.updateSentry(s, 0.05);
  const events = world.events.splice(0); match.sendSnapshots(events);
  t.equal(tank.hp, hullHp - ServerW.ITEMS.sentry.damage * .25, 'sentry damages occupied enemy tank hull with75% resistance');
  t.equal(foe.hp, crewHp, 'tank occupants retain their personal health');
  t.equal(state.world.vehicleById(tank.id).hp, tank.hp, 'sentry hull damage reaches client vehicle state');
  t.check(state.world.events.some(e => e.type === 'sentry-shot'), 'sentry shot effect also reaches the client');
} finally { match.destroy(); }
t.done();
