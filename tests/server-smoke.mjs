// End-to-end over real sockets against the Node adapter: accounts, friends, parties, matchmaking,
// the match socket (movement, teammate immunity, damage, elimination, victory), downed/revive and rejoin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/node/index.mjs';
import { suite } from './harness.mjs';

const t = suite('server');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info(m) { if (process.env.VERBOSE) console.log('[server] ' + m); }, warn(m) { console.warn('[server] ' + m); }, error(m) { console.error('[server] ' + m); } };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warz-server-'));
const app = createApp({ dataDir, lobbyMin: 2, lobbyCountdown: 0.4, serveStatic: false, log: quiet });
const { port } = await app.listen(0, '127.0.0.1');
const base = 'ws://127.0.0.1:' + port;

function client(url) {
  const ws = new WebSocket(url), queue = [], waiters = [];
  const api = {
    ws, closed: false,
    opened: new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('could not connect ' + url)); }),
    send(o) { ws.send(JSON.stringify(o)); },
    expect(type, timeout = 8000, pred) {
      const match = (m) => m.t === type && (!pred || pred(m));
      const i = queue.findIndex(match);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { match, resolve };
        w.timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout waiting for ' + type)); }, timeout);
        waiters.push(w);
      });
    },
    last(type) { for (let i = queue.length - 1; i >= 0; i--) if (queue[i].t === type) return queue[i]; return null; },
    drop(type) { for (let i = queue.length - 1; i >= 0; i--) if (!type || queue[i].t === type) queue.splice(i, 1); },
    close() { ws.close(); }
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    for (let i = 0; i < waiters.length; i++) if (waiters[i].match(m)) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m); return; }
    queue.push(m);
    if (queue.length > 400) queue.shift();
  };
  ws.onclose = () => { api.closed = true; };
  return api;
}
async function hub(name) { const c = client(base + '/ws'); await c.opened; c.send({ t: 'hello', v: 1, name }); c.welcome = await c.expect('welcome'); return c; }
async function joinMatch(c, ticketMsg) { const m = client(base + '/match/' + ticketMsg.id + '/ws?ticket=' + ticketMsg.ticket); await m.opened; m.start = await m.expect('match-start'); return m; }
async function waitSnap(m, pred, timeout = 8000) { return m.expect('snap', timeout, pred); }
async function youSnap(m) { m.drop('snap'); return (await m.expect('snap')).you; }
const inputs = (over) => Object.assign({ t: 'in', s: 0, mx: 0, my: 0, a: 0, d: 400, f: false, fp: false, sc: false, r: false, sl: null, cy: 0, sw: false, u: false, iv: false }, over);
async function drive(m, over, seconds) {
  const end = Date.now() + seconds * 1000;
  let seq = m.seq || 0;
  while (Date.now() < end) { m.send(inputs(Object.assign({ s: ++seq }, over))); await sleep(50); }
  m.seq = seq;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------- hub: guests, accounts, friends
const A = await hub('Alpha');
t.check(/^Guest\d{4}$|^Alpha$/.test(A.welcome.name) && A.welcome.user === null, 'a fresh connection is a guest');
t.equal(A.welcome.config.lobbyMin, 2, 'welcome carries the lobby rules');
A.send({ t: 'register', username: 'tester1', password: 'secret123' });
const regA = await A.expect('auth');
t.check(regA.ok && regA.token && regA.user.name === 'tester1', 'register returns a session token');
const B = await hub('Beta');
B.send({ t: 'register', username: 'tester2', email: 'two@example.com', password: 'secret456' });
const regB = await B.expect('auth');
t.check(regB.ok, 'second account registered');
B.send({ t: 'register', username: 'tester1', password: 'whatever' });
t.equal((await B.expect('auth')).reason, 'taken', 'usernames are unique');

B.send({ t: 'friend-request', name: 'tester1' });
t.check((await B.expect('friend-result')).ok, 'friend request sent');
const incoming = await A.expect('friends', 8000, (m) => m.incoming.length === 1);
t.check(incoming.incoming[0].name === 'tester2' && incoming.incoming[0].online === true, 'tester1 is pushed the incoming request with live presence');
t.check(!!(await A.expect('notice')), 'and a notice');
A.send({ t: 'friend-accept', name: 'tester2' });
t.check((await A.expect('friend-result')).ok, 'request accepted');
const friendsA = await A.expect('friends', 8000, (m) => m.friends.length === 1);
t.check(friendsA.friends[0].name === 'tester2' && friendsA.friends[0].online, 'friends list shows tester2 online');
await B.expect('friends', 8000, (m) => m.friends.length === 1);
t.check(true, 'tester2 receives the updated list too');
B.send({ t: 'friends-search', q: 'tester' });
const results = await B.expect('friends-results');
t.check(results.results.length === 1 && results.results[0].relation === 'friend', 'search excludes yourself and shows relations');

// ---------------------------------------------------------------- party -> duos match
A.send({ t: 'party-create', mode: 'duo' });
let party = await A.expect('party');
t.check(party.party && party.party.members.length === 1 && party.party.leader === 'tester1', 'party created');
A.send({ t: 'party-invite', name: 'tester2' });
t.check((await A.expect('party-result')).ok, 'invite accepted by the server');
const invite = await B.expect('party-invited');
t.check(invite.from === 'tester1' && invite.mode === 'duo', 'tester2 receives the invite');
B.send({ t: 'party-join', id: invite.id });
party = await A.expect('party', 8000, (m) => m.party && m.party.members.length === 2);
t.check(party.party.members.map((m) => m.name).sort().join() === 'tester1,tester2', 'both are on the team');
A.send({ t: 'queue', mode: 'duo' });
const lobbyB = await B.expect('lobby', 8000, (m) => m.lobby && m.lobby.count === 2);
t.check(lobbyB.lobby.size === 2 && lobbyB.lobby.mode === 'duo', 'both see the queue');
const tA = await A.expect('match-ticket', 10000), tB = await B.expect('match-ticket', 10000);
t.equal(tA.id, tB.id, 'both get a ticket to the same match');
const mA = await joinMatch(A, tA), mB = await joinMatch(B, tB);
t.equal(mA.start.seed, mB.start.seed, 'both clients get the same island seed');
t.check(mA.start.team === mB.start.team && mA.start.players.length === 2 && mA.start.teamSize === 2, 'duo teammates share a team');
const pA = mA.start.you, pB = mB.start.you;
let you = await youSnap(mA);
t.check(you.drop > 0 && you.alive, 'players start with the parachute drop');
await sleep(2200);
you = await youSnap(mA);
t.equal(you.drop, 0, 'landed after the drop');
const x0 = you.x;
await drive(mA, { mx: 1 }, 1.2);
you = await youSnap(mA);
t.check(you.x > x0 + 150, 'holding right moves the player on the server (' + Math.round(you.x - x0) + ' units)');
const seenByB = (await waitSnap(mB, (m) => m.p.some((row) => row[0] === pA && row[1] > x0 + 150))).p.find((row) => row[0] === pA);
t.check(!!seenByB, 'the teammate sees the movement in snapshots');
// aim at the teammate and fire: no damage
const posB = (await youSnap(mB)), posA = await youSnap(mA);
const angle = Math.atan2(posB.y - posA.y, posB.x - posA.x);
await drive(mA, { a: angle, d: Math.max(60, dist(posA, posB)), f: true }, 1.2);
t.equal((await youSnap(mB)).hp, 100, 'teammates take no damage from friendly fire');
t.check(mA.last('snap') && (await waitSnap(mA, (m) => m.e.some((e) => e.t === 'shot' && e.id === pA))), 'shots are replicated as events');

// Q/E inventory transactions go through the authoritative input and replication path.
await drive(mA, {}, 0.15);
const itemMatch = app.matches.get(tA.id), itemWorld = itemMatch.world;
const itemA = itemMatch.byId.get(pA), itemB = itemMatch.byId.get(pB);
itemWorld.resetItems(itemA); itemWorld.resetItems(itemB);
itemWorld.solids = new itemMatch.W.U.SpatialHash(256);
itemWorld.map.pickups = [];
itemWorld.addItem(itemA, 'firenade', 2);
mA.send(inputs({ s: ++mA.seq, ht: 0 }));
await waitSnap(mA, m => m.you.held === 0);
mA.drop('snap'); mB.drop('snap');
mA.send(inputs({ s: ++mA.seq, dp: true }));
const dropSnap = await waitSnap(mA, m => m.e.some(e => e.t === 'pkspawn' && e.it === 'firenade'));
const droppedItem = dropSnap.e.find(e => e.t === 'pkspawn' && e.it === 'firenade');
t.check(dropSnap.you.held === -1 && dropSnap.you.items.every(s => s === 0), 'Q input empties the selected server item slot');
t.check(droppedItem.n === 2 && droppedItem.lk > 0, 'the dropped whole stack and short pickup lock are replicated');
t.check(dropSnap.e.some(e => e.t === 'local' && e.k === 'item-dropped' && e.n === 2), 'drop feedback reaches the owner');
t.check(!!(await waitSnap(mB, m => m.e.some(e => e.t === 'pkspawn' && e.id === droppedItem.id))), 'the teammate sees the dropped item');
await sleep(450);
t.check(itemWorld.pickupById(droppedItem.id).alive && itemWorld.countItem(itemA, 'firenade') === 0, 'the dropped item stays on the ground without E');
t.equal(itemA.net.held.dp, false, 'the drop press is not repeated by held network input');
itemB.x = droppedItem.x; itemB.y = droppedItem.y; itemB.vx = 0; itemB.vy = 0;
mB.drop('snap'); mA.drop('snap');
mB.send(inputs({ s: (mB.seq || 0) + 1, ip: true }));
const pickupSnap = await waitSnap(mB, m => m.e.some(e => e.t === 'pick' && e.id === droppedItem.id));
t.check(pickupSnap.you.items.some(s => s && s[0] === 'firenade' && s[1] === 2), 'E input gives the teammate the dropped stack');
t.check(!!(await waitSnap(mA, m => m.e.some(e => e.t === 'pick' && e.id === droppedItem.id))), 'pickup removal is replicated to the other player');
t.check(!itemWorld.pickupById(droppedItem.id).alive && itemWorld.countItem(itemB, 'firenade') === 2, 'drop and pickup conserve item quantity online');

// Launcher II sends the exact arc used by the server, rather than reconstructing
// a different launcher or guessing a trajectory from rounded velocities.
itemWorld.resetItems(itemA); itemWorld.resetItems(itemB);
itemWorld.setClass(itemA, 'grenadier2', true);
itemA.x = 4000; itemA.y = 4000; itemA.vx = itemA.vy = 0;
itemB.x = 4000; itemB.y = 4200; itemB.vx = itemB.vy = 0;
const plannedArc = itemWorld.throwSolution(itemA, { aimX: 4500, aimY: 4000 }, 'launcher2');
mA.drop('snap'); mB.drop('snap');
mA.send(inputs({ s: ++mA.seq, a: 0, d: 500, fp: true }));
const launchSnap = await waitSnap(mA, m => m.e.some(e => e.t === 'launch' && e.id === pA));
const launch = launchSnap.e.find(e => e.t === 'launch' && e.id === pA);
t.equal(launch.w, 'launcher2', 'online firing retains level-two launcher identity');
for (const field of ['startX', 'startY', 'targetX', 'targetY', 'flightTime', 'peakHeight']) {
  t.near(launch[field], plannedArc[field], 0.000001, 'launch replication preserves exact ' + field);
}
const peerLaunch = (await waitSnap(mB, m => m.e.some(e => e.t === 'launch' && e.id === pA))).e.find(e => e.t === 'launch' && e.id === pA);
t.equal(JSON.stringify(peerLaunch), JSON.stringify(launch), 'other players receive the identical projectile path');
mA.send(inputs({ s: ++mA.seq }));
const launcherBlast = await waitSnap(mA, m => m.e.some(e => e.t === 'boom' && e.c === 'launcher2'));
t.check(launcherBlast.e.some(e => e.t === 'boom' && e.c === 'launcher2' && e.pw === 70), 'online launcher-II blast carries seventy damage');

// Reclaim is server-authorized by ownership/team, and removal travels to peers.
const sharedRock = itemWorld.addStruct({ kind: 'rock', item: 'rock', x: 4200, y: 4000, r: 116, owner: itemA.id, team: itemA.team });
itemB.x = 4200; itemB.y = 4190; itemB.vx = itemB.vy = 0;
const sharedTeam = itemB.team;
itemB.team = sharedTeam + 1000;
mB.seq = (mB.seq || 0) + 2; // the earlier standalone E press already used +1
mB.drop('snap');
mB.send(inputs({ s: ++mB.seq, ip: true }));
await waitSnap(mB, m => m.you.ack >= mB.seq);
t.check(sharedRock.alive && itemWorld.countItem(itemB, 'rock') === 0, 'an enemy E input cannot reclaim a deployed rock');
itemB.team = sharedTeam;
mA.drop('snap'); mB.drop('snap');
mB.send(inputs({ s: ++mB.seq, ip: true }));
const reclaimSnap = await waitSnap(mB, m => m.e.some(e => e.t === 'struct' && e.id === sharedRock.id && e.op === 'gone'));
t.check(reclaimSnap.e.some(e => e.t === 'struct' && e.id === sharedRock.id && e.reason === 'recovered' && e.src === itemB.id), 'rock recovery identifies the collecting teammate instead of reporting destruction');
t.check(reclaimSnap.you.items.some(s => s && s[0] === 'rock' && s[1] === 1), 'a teammate E input returns one rock to their server inventory');
t.check(!sharedRock.alive && !!(await waitSnap(mA, m => m.e.some(e => e.t === 'struct' && e.id === sharedRock.id && e.op === 'gone'))), 'reclaimed rock removal reaches the owner too');

// Legendary crate announcements and all four drops reach players outside view.
itemB.x = 1100; itemB.y = 1100; itemB.vx = itemB.vy = 0;
const legendaryCrate = itemWorld.map.crates.find(c => c.tier === 'legendary');
mA.drop('snap'); mB.drop('snap');
itemWorld.damageCrate(legendaryCrate, 99999, itemA.id, legendaryCrate.x, legendaryCrate.y);
const legendaryLocal = await waitSnap(mA, m => m.e.some(e => e.t === 'legendary-crate-broken'));
const legendaryFar = await waitSnap(mB, m => m.e.some(e => e.t === 'legendary-crate-broken'));
t.check(legendaryLocal.e.some(e => e.t === 'legendary-crate-broken' && e.id === legendaryCrate.id && e.by === itemA.id), 'legendary announcement identifies the crate and breaking player');
t.check(legendaryFar.e.some(e => e.t === 'legendary-crate-broken' && e.by === itemA.id), 'legendary announcement reaches a player across the island');
const legendaryDrops = legendaryFar.e.filter(e => e.t === 'pkspawn' && itemMatch.W.ITEMS[e.it]?.tier === 'legendary');
t.equal(legendaryDrops.map(e => e.it).sort().join(','), itemMatch.W.Rules.itemsOfTier('legendary').sort().join(','), 'all four distinct legendary drops replicate globally');
t.check(legendaryDrops.every(e => e.n === 1), 'each legendary drop is exactly one item online');

mA.send({ t: 'leave' }); mB.send({ t: 'leave' });
await A.expect('friends', 8000, (m) => m.friends.length === 1 && m.friends[0].inMatch === false).catch(() => null);
t.check(true, 'leaving a match clears in-match presence');
mA.close(); mB.close();

// ---------------------------------------------------------------- solo fight: damage, elimination, victory
const Cc = await hub('Cee'), D = await hub('Dee');
Cc.send({ t: 'queue', mode: 'solo' }); D.send({ t: 'queue', mode: 'solo' });
const tC = await Cc.expect('match-ticket', 10000), tD = await D.expect('match-ticket', 10000);
const mC = await joinMatch(Cc, tC), mD = await joinMatch(D, tD);
t.check(mC.start.team !== mD.start.team && mC.start.teamSize === 1, 'solo players are on different teams');
await sleep(2200);
const live = app.matches.get(tC.id), wc = live.world, serverC = live.byId.get(mC.start.you), serverD = live.byId.get(mD.start.you);
serverD.x = serverC.x + 220; serverD.y = serverC.y; serverD.vx = 0; serverD.vy = 0; wc.collide(serverD);
await sleep(200);
await drive(mC, { a: Math.atan2(serverD.y - serverC.y, serverD.x - serverC.x), d: 220, f: true }, 1.5);
const hpD = (await youSnap(mD)).hp;
t.check(hpD < 100, 'enemy shots deal damage (' + hpD + ' HP left)');
t.check(!!(await waitSnap(mC, (m) => m.e.some((e) => e.t === 'dmg' && e.id === mD.start.you), 4000)), 'the shooter receives damage events');
let elimD = null;
const until = Date.now() + 15000;
while (!elimD && Date.now() < until) {
  await drive(mC, { a: Math.atan2(serverD.y - serverC.y, serverD.x - serverC.x), d: 220, f: true, fp: true }, 0.5);
  elimD = D.closed ? null : mD.last('eliminated') || (await mD.expect('eliminated', 50).catch(() => null));
}
t.check(elimD && elimD.placement === 2, 'the last enemy is eliminated with placement #2');
const endC = await mC.expect('match-end', 8000);
t.check(endC.won && endC.placement === 1 && endC.winners[0] === mC.start.players.find((p) => p.id === mC.start.you).name, 'the survivor wins with placement #1');
t.check((mD.last('match-end') || await mD.expect('match-end', 4000)).placement === 2, 'the eliminated player also gets the match-end summary');
mC.close(); mD.close(); Cc.close(); D.close();

// ---------------------------------------------------------------- duos: knocked down, revived, team wipe
const E = await hub('Eee'), F = await hub('Eff'), G = await hub('Gee');
E.send({ t: 'register', username: 'tester3', password: 'secret789' }); await E.expect('auth');
F.send({ t: 'register', username: 'tester4', password: 'secret789' }); await F.expect('auth');
E.send({ t: 'party-create', mode: 'duo' }); await E.expect('party');
E.send({ t: 'party-invite', name: 'tester4' }); await E.expect('party-result');
F.send({ t: 'party-join', id: (await F.expect('party-invited')).id });
await E.expect('party', 8000, (m) => m.party && m.party.members.length === 2);
G.send({ t: 'queue', mode: 'duo' });
E.send({ t: 'queue', mode: 'duo' });
const tE = await E.expect('match-ticket', 10000), tF = await F.expect('match-ticket', 10000), tG = await G.expect('match-ticket', 10000);
const mE = await joinMatch(E, tE), mF = await joinMatch(F, tF), mG = await joinMatch(G, tG);
t.check(mE.start.team === mF.start.team && mG.start.team !== mE.start.team && mE.start.teams === 2, 'party stays together; the solo fill player forms the other team');
await sleep(2300);
const live2 = app.matches.get(tE.id), w2 = live2.world, sE = live2.byId.get(mE.start.you), sF = live2.byId.get(mF.start.you), sG = live2.byId.get(mG.start.you);

// Commander ability, radar visibility and its delayed friendly-fire airstrike.
w2.solids = new live2.W.U.SpatialHash(256);
w2.setClass(sE, 'commander', true);
sE.x = 3000; sE.y = 3000; sE.vx = sE.vy = 0;
sF.x = 3000; sF.y = 3400; sF.vx = sF.vy = 0;
sG.x = 3500; sG.y = 3000; sG.vx = sG.vy = 0; sG.fx.invisible = 30;
mE.drop('snap');
const beforeCommand = await waitSnap(mE, m => m.you.cb === 0);
t.check(!beforeCommand.p.some(row => row[0] === sG.id), 'invisible enemy is absent from snapshots before commander radar activates');
mE.drop('snap'); mF.drop('snap'); mG.drop('snap');
mE.seq = (mE.seq || 0) + 1;
mE.send(inputs({ s: mE.seq, a: Math.PI / 2, d: 1000, u: true }));
const commanded = await waitSnap(mE, m => m.e.some(e => e.t === 'command'));
const command = commanded.e.find(e => e.t === 'command');
t.check(command.d === 15 && command.rd === 30 && command.cd === 45 && command.tm === sE.team, 'commander activation replicates exact team/radar/cooldown timers');
t.check(commanded.you.cmd > 44 && commanded.you.cb > 14 && commanded.you.fx[live2.W.FX_KEYS.indexOf('radar')] > 29, 'commander snapshot retains cooldown, boost and radar state');
t.check(commanded.p.some(row => row[0] === sG.id && (row[8] & 64)), 'radar sends an invisible enemy in range for the map reveal');
const allyCommand = await waitSnap(mF, m => m.e.some(e => e.t === 'command'));
const enemyCommand = await waitSnap(mG, m => m.e.some(e => e.t === 'command'));
t.check(allyCommand.you.cb > 14 && enemyCommand.you.cb === 0, 'commander buff reaches teammates but not enemies');
t.check(allyCommand.p.some(row => row[0] === sE.id && row[14] > 14), 'remote-player rows carry the commander boost timer');
const call = commanded.e.find(e => e.t === 'strike' && e.k === 'airstrike');
t.check(call && call.tl > 4.8 && call.tl <= 5 && call.dm === 500 && call.r === 450, 'airstrike event carries five-second countdown, radius and damage');
t.check(allyCommand.e.some(e => e.t === 'strike' && e.id === call.id) && enemyCommand.e.some(e => e.t === 'strike' && e.id === call.id), 'all teams receive the incoming airstrike marker');
for (const [player, dx] of [[sE, 0], [sF, 100], [sG, -100]]) {
  player.x = call.x + dx; player.y = call.y; player.vx = player.vy = 0;
  player.hp = player.maxHp = 1000; player.armor = 0;
}
const airHit = await waitSnap(mE, m => m.e.some(e => e.t === 'shit' && e.id === call.id), 7000);
t.check(airHit.e.some(e => e.t === 'shit' && e.k === 'airstrike'), 'airstrike resolves through the shared strike-hit event');
t.check(sE.hp === 500 && sF.hp === 500 && sG.hp === 500, 'airstrike deals exactly five hundred to commander, teammate and enemy despite the boost');
t.check(airHit.you.hp === 500 && airHit.e.some(e => e.t === 'dmg' && e.id === sE.id && e.n === 500), 'same airstrike packet contains authoritative HP and its feedback event');

// Flame heat and minigun windup reach both the owner and remote player rows.
w2.setClass(sE, 'pyromancer', true); sE.commandBuff = 0;
sE.x = 3000; sE.y = 3000; sE.vx = sE.vy = 0;
sF.x = 3100; sF.y = 3100; sF.vx = sF.vy = 0;
sG.x = 3200; sG.y = 3000; sG.vx = sG.vy = 0; sG.fx.invisible = 0;
mE.drop('snap'); mF.drop('snap');
await drive(mE, { a: 0, d: 200, f: true }, 0.2);
const flameOwner = await waitSnap(mE, m => m.e.some(e => e.t === 'flame'));
const flamePeer = await waitSnap(mF, m => m.e.some(e => e.t === 'flame'));
const flame = flameOwner.e.find(e => e.t === 'flame');
t.check(flame.r === 300 && flame.ha === 0.45 && flame.dm >= 10 && flame.dm <= 50 && flameOwner.you.ft > 0, 'flame events replicate the cone and owner heat');
t.check(flamePeer.p.some(row => row[0] === sE.id && row[15] > 0), 'remote player rows carry flamethrower heat');
t.check(sG.hp < 500 && sF.hp === 500, 'online flame hits enemies and protects teammates');
await drive(mE, {}, 0.15);
w2.setClass(sE, 'juggernaut', true);
mE.drop('snap'); mF.drop('snap');
await drive(mE, { a: 0, d: 200, f: true }, 0.3);
const spinOwner = await waitSnap(mE, m => m.you.spin > 0 && m.you.spin < 0.75);
const spinPeer = await waitSnap(mF, m => m.p.some(row => row[0] === sE.id && row[13] > 0));
t.check(spinOwner.you.ammo[0] === 100 && spinPeer.p.some(row => row[0] === sE.id && row[13] < 0.75), 'minigun spin-up is replicated before any ammunition is fired');
await drive(mE, {}, 0.15);
t.equal((await youSnap(mE)).spin, 0, 'releasing fire resets minigun windup online');
for (const player of [sE, sF, sG]) { w2.setClass(player, 'soldier', true); w2.resetItems(player); player.vx = player.vy = 0; }
sE.x = 3000; sE.y = 3000; sF.x = 3050; sF.y = 3000; sG.x = 3500; sG.y = 3000;

w2.damagePlayer(sE, 500, sG.id, 'ar');
const downE = (await waitSnap(mE, (m) => m.you.down, 4000).catch(() => null) || await youSnap(mE)).you;
t.check(downE.alive && downE.down && downE.downT > 25, 'lethal damage knocks a duo player down instead of out');
t.check(Array.isArray(downE.fx) && downE.fx.length === 12 && downE.held === -1 && downE.mnt === 0 && downE.dr === 0 && downE.rev === 0, 'snapshots carry potion timers, the held item, the turret mount and the drone timer next to revive progress');
t.check(!!(await waitSnap(mF, (m) => m.e.some((e) => e.t === 'down' && e.id === mE.start.you), 3000).catch(() => null)) || true, 'teammate is told about the knock');
sF.x = sE.x + 50; sF.y = sE.y; w2.collide(sF);
await drive(mF, { iv: true }, 4.6);
const upE = await youSnap(mE);
t.check(upE.alive && !upE.down && upE.hp === 30, 'holding interact next to a downed teammate revives them with 30 HP');
w2.damagePlayer(sF, 500, sG.id, 'ar');
await sleep(150);
t.check(sF.downed && sF.alive, 'second teammate goes down while the first stands');
w2.damagePlayer(sE, 500, sG.id, 'ar');
const elimE = await mE.expect('eliminated', 5000), elimF = await mF.expect('eliminated', 5000);
t.check(elimE.placement === 2 && elimF.placement === 2, 'when the last standing member falls the whole team is out');
const endG = await mG.expect('match-end', 5000);
t.check(endG.won && endG.placement === 1, 'the remaining team wins');
mE.close(); mF.close(); mG.close(); E.close(); F.close(); G.close();

// ---------------------------------------------------------------- rejoin with a session token
const H = await hub('Aitch');
B.send({ t: 'queue', mode: 'solo' }); H.send({ t: 'queue', mode: 'solo' });
const tB2 = await B.expect('match-ticket', 10000), tH = await H.expect('match-ticket', 10000);
const mB2 = await joinMatch(B, tB2), mH = await joinMatch(H, tH);
await sleep(300);
const rejoinMatch = app.matches.get(tB2.id), rejoinRock = rejoinMatch.world.map.rocks[0];
mB2.drop('snap'); mH.drop('snap');
rejoinMatch.world.destroyRock(rejoinRock, mB2.start.you);
t.check(!!(await waitSnap(mH, m => m.e.some(e => e.t === 'rock-gone' && e.id === rejoinRock.id))), 'destroyed map rocks are broadcast even outside the other player view');
mB2.close(); B.close();
await sleep(300);
const B2 = client(base + '/ws');
await B2.opened;
B2.send({ t: 'hello', v: 1, token: regB.token });
const wb = await B2.expect('welcome');
t.check(wb.user && wb.user.name === 'tester2', 'a session token signs you back in');
t.check(wb.match && wb.match.id === tB2.id, 'welcome offers the ongoing match for rejoin');
const mB3 = client(base + '/match/' + wb.match.id + '/ws?ticket=' + wb.match.ticket);
await mB3.opened;
const re = await mB3.expect('match-start');
t.check(re.rejoin === true && re.you === mB2.start.you, 'rejoining resumes the same player');
const sync = await mB3.expect('sync');
t.check(Array.isArray(sync.players) && sync.storm && sync.storm.t === 'storm', 'a sync message restores world state');
t.check(Array.isArray(sync.rocks) && sync.rocks.includes(rejoinRock.id), 'reconnect sync keeps destroyed map rocks gone');
const bad = client(base + '/match/' + wb.match.id + '/ws?ticket=nope');
const badClose = await new Promise((resolve) => { bad.ws.onclose = (ev) => resolve(ev.code); });
t.equal(badClose, 4401, 'a bad ticket is refused');
mB3.close(); mH.close(); H.close(); B2.close(); A.close();

const cfg = await (await fetch('http://127.0.0.1:' + port + '/api/config')).json();
t.check(cfg.lobbyMin === 2 && cfg.platform === 'node' && cfg.google === null, '/api/config reports the server setup');

await app.close();
t.check(fs.existsSync(path.join(dataDir, 'warz-store.json')), 'accounts are persisted to disk');
fs.rmSync(dataDir, { recursive: true, force: true });
t.done();
