// Client replication runs against server-shaped messages without a DOM. Damage
// events are feedback, while snapshots own health, inventory and class state.
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'class-combat', 'online', 'map-art']);
const t = suite('online replication'), Online = W.Online;
const state = Online.start({ seed: 15, teamSize: 2, you: 1, rejoin: true, time: 0,
  players: [{ id: 1, name: 'Commander', team: 1 }, { id: 2, name: 'Teammate', team: 1 }, { id: 3, name: 'Enemy', team: 2 }] });
const world = state.world, me = state.me, mate = world.playerById(2), enemy = world.playerById(3);
me.x = 3000; me.y = 3000; mate.x = 3100; mate.y = 3000; enemy.x = 3500; enemy.y = 3000;
function you(over = {}) {
  return Object.assign({ x: me.x, y: me.y, vx: 0, vy: 0, ack: 0, hp: 100, mhp: 100, ar: 0, tok: 0, keys: 0,
    cls: W.CLASS_ORDER.indexOf(me.classId), slot: 0, ammo: me.weapons.map(w => w.ammo), rel: [0, 0], gren: 0, med: 0,
    down: false, downT: 0, rev: 0, sc: false, near: -1, alive: true, drop: 0, team: 1, storm: false,
    cmd: 0, cb: 0, spin: 0, ft: 0, from: null, held: -1, mnt: 0, fx: W.FX_KEYS.map(() => 0), rg: 0, dr: 0, tp: 0 }, over);
}
function snap(y, events = [], players = []) { Online.applySnapshot({ time: state.serverTime + 0.05, you: y, p: players, e: events, alive: 3, teams: 2 }); }
snap(you({ hp: 62 }), [{ t: 'dmg', id: me.id, src: me.id, n: 38, c: 'launcher', x: me.x, y: me.y }]);
t.equal(me.hp, 62, 'same-packet grenade damage feedback does not subtract from snapshot HP again');
snap(you({ hp: 100, ar: 70 }), [{ t: 'dmg', id: me.id, src: enemy.id, n: 30, c: 'ar', x: me.x, y: me.y }]);
t.check(me.hp === 100 && me.armor === 70, 'armor-only damage leaves authoritative HP intact');
snap(you({ hp: 750, mhp: 1000 }), [{ t: 'dmg', id: me.id, src: enemy.id, n: 250, c: 'airstrike', x: me.x, y: me.y }]);
t.equal(me.hp, 750, 'airstrike feedback does not subtract its 250 damage a second time');

world.setClass(me, 'medic', true);
const station = world.map.stations[0];
snap(you({ cls: W.CLASS_ORDER.indexOf('juggernaut'), from: 'medic', hp: 90, mhp: W.CLASSES.juggernaut.hp,
  ar: 37, ammo: [17, 3], slot: 1, cmd: 12, cb: 9, spin: 0.4 }),
  [{ t: 'upg', id: me.id, cls: 'juggernaut', st: station.id, key: false }]);
t.equal(me.classId, 'juggernaut', 'upgrade snapshot applies the advanced class');
t.equal(me.upgradeFrom, 'medic', 'upgrade fireworks preserve the actual source branch from the snapshot');
t.check(me.weapons[0].ammo === 17 && me.weapons[1].ammo === 3 && me.slot === 1, 'upgrade event does not refill magazines or reset selected slot');
t.check(me.commandCd === 12 && me.commandBuff === 9 && me.minigunSpin === 0.4, 'upgrade event preserves authoritative cooldowns and spin');
t.equal(me.armor, 37, 'class changes preserve the authoritative snapshot armor value');
t.check(world.events.some(e => e.type === 'upgrade') && station.cooldown === W.CONFIG.stationCooldown, 'upgrade still produces its effects and station state');

world.setClass(me, 'commander', true);
Online.applyEvent({ t: 'command', id: me.id, tm: me.team, d: 15, rd: 30, cd: 45 });
t.check(me.commandCd === 45 && me.commandBuff === 15 && me.fx.radar === 30, 'commander event starts the correct cooldown, boost and radar');
t.check(mate.commandBuff === 15 && enemy.commandBuff === 0, 'commander replica boosts only its own team');
enemy.hidden = true;
Online.applySnapshot({ time: state.serverTime + 0.05, p: [[enemy.id, 3500, 3000, 0, 100, 100, 0, 0, 65, 0, 0, 0, 0, 0, 0, 0]], e: [], alive: 3, teams: 2 });
t.check(!enemy.hidden && enemy.fx.invisible > 0, 'a radar-revealed snapshot restores an invisible enemy hidden by stale network visibility');
t.check(world.revealedEnemies(me).includes(enemy) && !world.visibleTo(enemy, me), 'radar shows the hidden enemy on the map without making their body visible');

Online.applySnapshot({ time: state.serverTime + 0.05,
  p: [[mate.id, 3100, 3000, 0, 150, 150, W.CLASS_ORDER.indexOf('juggernaut'), 0, 1, 0, 0, 0, 0, 0.45, 12, 0]], e: [], alive: 3, teams: 2 });
t.check(mate.minigunSpin === 0.45 && mate.commandBuff === 12, 'remote minigun windup and commander buff survive snapshot decoding');
Online.applySnapshot({ time: state.serverTime + 0.05,
  p: [[mate.id, 3100, 3000, 0, 100, 100, W.CLASS_ORDER.indexOf('pyromancer'), 0, 1, 0, 0, 0, 0, 0, 8, 4]], e: [], alive: 3, teams: 2 });
t.equal(mate.flameTicks, 4, 'remote flame heat survives snapshot decoding');
const particlesBefore = world.particles.length, hpBefore = me.hp;
Online.applyEvent({ t: 'flame', id: mate.id, x: mate.x, y: mate.y, a: 0, r: 300, ha: 0.45, dm: 30 });
t.check(world.particles.length > particlesBefore && mate.recoil > 0 && me.hp === hpBefore, 'replicated flame renders effects without dealing local damage');
Online.applyEvent({ t: 'flashed' });
t.equal(me.fx.flash, W.ITEMS.flashbang.flash, 'flashbang owner event restores its flash duration');

Online.applySync({ crates: [], gone: [], rocks: [], added: [], structs: [], zones: [], stations: [], players: [],
  strikes: [{ id: 999, k: 'airstrike', x: 3000, y: 4000, tg: 0, tl: 3, o: me.id, tm: me.team, r: 225, dm: 250 }] });
const strike = world.strikeById(999);
t.check(strike && strike.kind === 'airstrike' && strike.t === 3 && strike.radius === 225 && strike.damage === 250, 'reconnect sync restores the smaller airstrike marker and 250 damage');
world.updateStrikes(3.1);
t.check(world.strikeById(999) && me.hp === hpBefore, 'remote airstrike waits for its authoritative impact');
Online.applyEvent({ t: 'shit', id: 999, k: 'airstrike', x: 3000, y: 4000 });
t.check(!world.strikeById(999) && world.events.some(e => e.type === 'strike-hit' && e.strike.kind === 'airstrike'), 'airstrike impact removes the pending marker and emits matching effects');

const solution = world.throwSolution(me, { x: 3500, y: 3200 }, 'launcher2');
Online.applyEvent({ t: 'launch', id: me.id, w: 'launcher2', tr: solution.travel, ...solution });
const shell = world.grenades[world.grenades.length - 1];
t.check(shell.weapon === 'launcher2' && shell.targetX === solution.targetX && shell.flightTime === solution.flightTime && shell.landFuse === 0.2, 'online event decoder preserves the level-two launcher and exact arc');

// Exercise the real globally visible map layer against authoritative snapshots,
// including a connection that misses the entire tick containing the break event.
function legendaryMarkers(client, big) {
  let markers = 0;
  const g = {};
  g.measureText = text => ({ width: String(text).length * 8 });
  for (const name of ['save', 'restore', 'beginPath', 'arc', 'rect', 'fill', 'stroke', 'setLineDash',
    'translate', 'rotate', 'moveTo', 'lineTo', 'closePath', 'strokeRect', 'strokeText', 'fillText']) g[name] = () => {};
  g.fillRect = function () { if (this.fillStyle === '#ffd44f') markers++; };
  W.MapArt.overlay(g, client.world, client.me, big ? 800 : 180, { big });
  return markers;
}
for (const skipBreak of [true, false]) {
  const tag = skipBreak ? 'skipped break' : 'normal break';
  const match = new Match({ W: ServerW, id: 'legendary-' + tag, mode: 'solo', teamSize: 1, seed: 57,
    teams: [{ members: [{ name: 'Observer' }] }, { members: [{ name: 'Attacker' }] }], clock: false });
  try {
    const observer = match.players[0], attacker = match.players[1];
    let client = Online.start(match.startMessage(observer, false)), received = 0, last;
    const conn = { open: true, bufferedAmount: 0, close() {}, sendText(text) {
      last = JSON.parse(text); received++; Online.applySnapshot(last);
    } };
    observer.net.conn = conn;
    const actual = match.map.crates[match.map.legendaryCrateId];
    const replica = client.world.map.crates[client.world.map.legendaryCrateId];
    match.sendSnapshots([]);
    t.check(last.lc === actual.hp && legendaryMarkers(client, false) === 1 && legendaryMarkers(client, true) === 1,
      tag + ': first snapshot supplies healthy legendary state to both map sizes');
    actual.hp -= 25;
    match.sendSnapshots([]);
    t.equal(replica.hp, actual.hp, tag + ': persistent state repairs missed partial damage');
    replica.shake = 0.25;
    match.sendSnapshots([]);
    t.equal(replica.shake, 0.25, tag + ': unchanged HP does not restart hit feedback');
    const legacy = { ...last }; delete legacy.lc;
    Online.applySnapshot(legacy);
    t.check(replica.alive && replica.hp === actual.hp, tag + ': old snapshots without legendary state remain compatible');

    match.world.damageCrate(actual, actual.hp - 0.25, attacker.id, actual.x, actual.y);
    match.sendSnapshots(match.world.events.splice(0));
    t.check(actual.hp === 0.25 && last.lc === 1 && last.e.some(e => e.t === 'crate' && e.hp === 1),
      tag + ': positive fractional HP stays positive in both persistent and event encoding');
    t.check(replica.alive && legendaryMarkers(client, false) === 1 && legendaryMarkers(client, true) === 1 &&
      !client.world.events.some(e => e.type === 'crate'), tag + ': final fraction of HP preserves the marker without premature break effects');
    t.equal(match.syncMessage().crates.find(row => row[0] === actual.id)[1], 1,
      tag + ': reconnect sync preserves a living crate at fractional HP');

    const before = received;
    if (skipBreak) conn.bufferedAmount = 96 * 1024 + 1;
    match.world.damageCrate(actual, actual.hp, attacker.id, actual.x, actual.y);
    match.sendSnapshots(match.world.events.splice(0));
    if (skipBreak) {
      t.check(received === before && replica.alive && legendaryMarkers(client, false) === 1,
        tag + ': backpressure actually suppresses the break snapshot and leaves stale client state');
      conn.bufferedAmount = 0;
      match.sendSnapshots([]);
      t.check(last.e.length === 0 && last.lc === 0, tag + ': a later event-free snapshot carries the permanent break');
    }
    t.check(!replica.alive && replica.hp === 0 && legendaryMarkers(client, false) === 0 && legendaryMarkers(client, true) === 0,
      tag + ': both map markers disappear when authoritative HP reaches zero');
    const breakCount = () => client.world.events.filter(e => e.type === 'crate' && e.crate.id === actual.id).length;
    t.equal(breakCount(), 1, tag + ': recovery and ordinary delivery produce exactly one break effect');
    const particles = client.world.particles.length;
    replica.shake = 0.125;
    match.sendSnapshots([]);
    t.check(breakCount() === 1 && client.world.particles.length === particles && replica.shake === 0.125,
      tag + ': repeated permanent state does not duplicate effects or shake');
    client = Online.start(match.startMessage(observer, true));
    Online.applySync(match.syncMessage());
    match.sendSnapshots([]);
    t.check(legendaryMarkers(client, false) === 0 && legendaryMarkers(client, true) === 0,
      tag + ': rejoin keeps the destroyed legendary marker absent');
  } finally { match.destroy(); }
}
t.done();
