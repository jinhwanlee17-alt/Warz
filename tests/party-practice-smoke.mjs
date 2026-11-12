// Private party Practice over real hub/match sockets, including authority and recovery.
import { createApp } from '../server/node/index.mjs';
import { Match } from '../server/core/match.mjs';
import { Warz as W } from '../server/core/sim.mjs';
import { suite } from './harness.mjs';
const t = suite('Private party Practice'), sockets = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 60, botFill: 50, log: { info() {}, warn() {}, error: console.error } });
const { port } = await app.listen(0, '127.0.0.1'), base = 'ws://127.0.0.1:' + port;
function client(url) {
  const ws = new WebSocket(url), queue = [], waiting = [];
  const c = { ws, open: new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }),
    send(m) { ws.send(JSON.stringify(m)); },
    expect(type, predicate = () => true, timeout = 8000) {
      const accepts = m => m.t === type && predicate(m), i = queue.findIndex(accepts);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => { const w = { accepts, resolve }; w.timer = setTimeout(() => { waiting.splice(waiting.indexOf(w), 1); reject(new Error('Timed out waiting for ' + type)); }, timeout); waiting.push(w); });
    },
    discard(type) { for (let i = queue.length - 1; i >= 0; i--) if (queue[i].t === type) queue.splice(i, 1); },
    close() { ws.close(); }
  };
  ws.onmessage = e => { const m = JSON.parse(e.data), i = waiting.findIndex(w => w.accepts(m)); if (i >= 0) { const w = waiting.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m); } else { queue.push(m); if (queue.length > 500) queue.shift(); } };
  sockets.push(c); return c;
}
async function hub(name) { const c = client(base + '/ws'); await c.open; c.send({ t: 'hello', name }); await c.expect('welcome'); return c; }
async function cmd(c, action, data = {}) { await sleep(145); c.send({ t: 'practice', action, ...data }); return c.expect('practice-result', m => m.action === action); }
async function snap(c, pred) { c.discard('snap'); return c.expect('snap', pred || (() => true)); }
function clean(world) { for (const k of ['rocks', 'trees', 'buildings', 'crates', 'pickups', 'ponds']) world.map[k] = []; world.solids = new W.U.SpatialHash(256); world.vehicles.forEach(v => { v.x = v.y = 15000; }); }
try {
  const a = await hub('PracticeAlpha'), b = await hub('PracticeBeta'), outsider = await hub('PublicPlayer');
  let currentB = b;
  a.send({ t: 'register', username: 'practicealpha', password: 'private123' }); const authA = await a.expect('auth');
  b.send({ t: 'register', username: 'practicebeta', password: 'private123' }); const authB = await b.expect('auth');
  t.check(authA.ok && authB.ok, 'two friends register through normal account flow');
  outsider.send({ t: 'queue', mode: 'solo' }); await outsider.expect('lobby', m => m.lobby && m.lobby.count === 1);
  outsider.send({ t: 'practice-start' }); t.equal((await outsider.expect('practice-start-result')).reason, 'party', 'solo hub user cannot create a private party match');
  a.send({ t: 'party-create', mode: 'duo' }); const party = (await a.expect('party', m => !!m.party)).party;
  a.send({ t: 'party-invite', name: 'practicebeta' }); await b.expect('party-invited');
  b.send({ t: 'party-join', id: party.id }); await b.expect('party', m => m.party && m.party.members.length === 2);
  b.send({ t: 'practice-start' }); t.equal((await b.expect('practice-start-result')).reason, 'leader', 'only the party leader starts shared practice');
  a.send({ t: 'practice-start' }); t.check((await a.expect('practice-start-result')).ok, 'leader starts private practice immediately');
  const ta = await a.expect('match-ticket'), tb = await b.expect('match-ticket');
  t.check(ta.id === tb.id && ta.practice && tb.practice, 'both friends receive tickets for the same private match');
  const match = app.matches.get(ta.id), [pa, pb] = match.players;
  t.check(match.practice && match.world.practice && match.players.length === 2 && !match.bots, 'private practice contains exactly the party and no automatic bots');
  t.equal(app.lobby.count('solo'), 1, 'private practice leaves the unrelated public matchmaking queue untouched');
  t.equal(app.lobby.parties.get(party.id).members.length, 2, 'party survives entering practice');
  const ma = client(base + '/match/' + ta.id + '/ws?ticket=' + ta.ticket), mb = client(base + '/match/' + tb.id + '/ws?ticket=' + tb.ticket);
  await Promise.all([ma.open, mb.open]); const [sa, sb] = await Promise.all([ma.expect('match-start'), mb.expect('match-start')]);
  t.check(sa.practice && sb.practice && sa.ps.leader === pa.id && !sa.ps.storm && !sa.ps.friendlyFire, 'start packets expose private settings and leader');
  t.check(pa.team === pb.team && match.world.teams && !match.world.storm, 'friends begin as teammates with the storm disabled');
  clean(match.world); pa.x = 5000; pa.y = 5000; pb.x = 5080; pb.y = 5000;
  const tokens = pa.tokens;
  t.check((await cmd(ma, 'tokens')).ok && pa.tokens === tokens + W.CONFIG.upgradeCost, 'tokens tool grants only the configured practice increment');
  t.check((await cmd(ma, 'key')).ok && pa.keys === 1, 'station keys can be granted in practice');
  t.check((await cmd(ma, 'item', { slot: 0, id: 'bandage', n: 9999 })).ok && pa.items[0].n === W.ITEMS.bandage.stack, 'item tool clamps quantity to the real stack size');
  t.equal(pb.items[0], null, 'item tool changes only the requesting player');
  t.equal((await cmd(ma, 'item', { slot: 8, id: 'bandage', n: 1 })).reason, 'item', 'invalid slot is rejected');
  t.equal((await cmd(ma, 'item', { slot: 1, id: '__proto__', n: 1 })).reason, 'item', 'invalid item is rejected');
  t.equal((await cmd(mb, 'storm', { enabled: true })).reason, 'leader', 'shared storm setting requires leader');
  t.check((await cmd(ma, 'storm', { enabled: true })).ok && !!match.world.storm, 'leader enables authoritative storm');
  t.check((await snap(mb, s => s.ps && s.ps.storm)).ps.storm, 'storm setting reaches the other player');
  t.check((await cmd(ma, 'storm', { enabled: false })).ok && !match.world.storm, 'leader disables storm');
  t.check((await mb.expect('storm', m => m.disabled === true)).disabled, 'disabled storm gets an explicit network message');
  t.check((await cmd(ma, 'bot')).ok, 'participant spawns a shared training target');
  const dummy = match.players.find(p => p.practiceBot), rosterEvent = await mb.expect('practice-player');
  t.check(dummy && dummy.bot && !dummy.controller && rosterEvent.player.practiceBot, 'new practice target has no AI and is announced to peers');
  const originalHp = dummy.hp, dx = dummy.x, dy = dummy.y;
  match.world.damagePlayer(dummy, 100000, pa.id, 'pistol'); match.world.update(.5);
  t.check(dummy.alive && dummy.hp === originalHp && dummy.x === dx && dummy.y === dy, 'practice target has unlimited effective HP and stays stationary');
  const rosterPacket = await mb.expect('snap', s => s.pr && s.pr.some(p => p.id === dummy.id));
  t.check(rosterPacket.pr.some(p => p.practiceBot), 'versioned complete roster recovers target creation without relying on its event');
  mb.close(); b.close(); await sleep(100);
  currentB = client(base + '/ws'); await currentB.open; currentB.send({ t: 'hello', token: authB.token });
  const hubReturn = await currentB.expect('welcome'), restoredParty = await currentB.expect('party', m => m.party && m.party.members.length === 2);
  t.check(hubReturn.match.id === ta.id && restoredParty.party.id === party.id, 'page reload restores the authenticated friend to the original private-practice party');
  const rejoin = client(base + '/match/' + tb.id + '/ws?ticket=' + tb.ticket); await rejoin.open;
  const rs = await rejoin.expect('match-start'), sync = await rejoin.expect('sync');
  t.check(rs.rejoin && rs.players.some(p => p.id === dummy.id && p.practiceBot), 'rejoin restores dynamically spawned target identity');
  t.check(sync.roster.some(p => p.id === dummy.id) && sync.ps && !sync.ps.storm, 'full sync restores target roster and practice settings');
  t.check((await cmd(ma, 'friendly-fire', { enabled: true })).ok && pa.team !== pb.team && !match.world.teams, 'leader can switch to practice fights without changing party or vehicle capacity');
  t.equal(match.teamSize, 2, 'duo vehicle seating survives the combat-team switch');
  const duel = await snap(rejoin, s => s.ps.friendlyFire && s.you.team === pb.id);
  t.check(duel.p.find(row => row[0] === pa.id)[22].team === pa.id, 'changed opponent team replicates in player extras');
  const oldBullet = { owner: pb.id, team: pb.team, x: 12000, y: 12000, dx: 0, dy: 0, r: 1, speed: 0, range: 10000, traveled: 0, life: 30, weapon: 'pistol', damage: 8 };
  match.world.bullets.push(oldBullet); pa.sentryBurn = { owner: pb.id, until: match.world.time + 20, next: match.world.time + 10 };
  t.check((await cmd(ma, 'friendly-fire', { enabled: false })).ok && pa.team === pb.team && match.world.teams, 'cooperative teammate play can be restored');
  t.check(oldBullet.team === pa.team && !pa.sentryBurn, 'returning to cooperative play retags old bullets and ends hostile burn damage');
  match.world.setClass(pa, 'engineer', true); pa.tokens = 80; pa.keys = 2; pa.items[0] = { id: 'bandage', n: 3 }; match.tick();
  match.world.killPlayer(pa, pb, 'test'); match.tick();
  t.check(!match.ended && !pa.alive, 'a practice elimination does not end the session');
  await sleep(2250);
  t.check(pa.alive && pa.hp === pa.maxHp && pa.classId === 'engineer' && pa.weapons.length === 3, 'practice automatically respawns after two seconds with class equipment');
  t.check(pa.tokens === 80 && pa.keys === 2 && pa.items[0].id === 'bandage' && pa.items[0].n === 3, 'practice respawn preserves tokens, keys and carried item stacks');
  match.world.map.stations = [{ id: 0, number: 1, x: 6000, y: 6000, cooldown: 0 }];
  t.check((await cmd(ma, 'station')).ok && Math.hypot(pa.x - 6000, pa.y - 6000) < W.CONFIG.stationInteractRadius + pa.r, 'station tool finds a clear authoritative landing');
  match.world.setClass(pa, 'pyromaniac', true); pa.tokens = 50;
  t.check(match.world.upgradePyroFiregun(pa), 'practice player can purchase the permanent 50-token firegun');
  match.world.killPlayer(pa, pb, 'test'); match.tick();
  t.check((await cmd(ma, 'respawn')).ok && pa.pyroFiregun && pa.weapons[1].id === 'firegun' && W.WEAPONS.firegun.infiniteAmmo && !pa.weapons[1].reloading && pa.pyroFireBar === 50 && pa.tokens === 0,
    'manual practice respawn preserves a firegun bought immediately before elimination');
  const prior = pa.tokens;
  for (let i = 0; i < 15; i++) ma.send({ t: 'practice', action: 'tokens' });
  await ma.expect('practice-result', m => m.reason === 'rate');
  t.check(pa.tokens - prior <= 8 * W.CONFIG.upgradeCost, 'practice command flood is rate limited');
  // Ordinary matches never trust these tools, even when a request looks valid.
  const ordinary = new Match({ W, id: 'ordinary', mode: 'solo', teamSize: 1, seed: 9, clock: false, teams: [{ members: [{ name: 'Public' }] }] });
  try {
    const publicPlayer = ordinary.players[0], replies = [];
    const conn = { player: publicPlayer, open: true, bufferedAmount: 0, sendJson(m) { replies.push(m); }, sendText() {}, close() {} }; ordinary.attach(publicPlayer, conn, false);
    const before = publicPlayer.tokens;
    for (const action of ['tokens', 'item', 'storm', 'bot', 'respawn', 'friendly-fire']) ordinary.onMessage(conn, JSON.stringify({ t: 'practice', action, id: 'bandage', slot: 0, n: 1, enabled: false }));
    t.check(replies.filter(m => m.t === 'practice-result').every(m => !m.ok && m.reason === 'mode'), 'all practice commands are rejected in public matches');
    t.check(publicPlayer.tokens === before && !publicPlayer.items[0] && ordinary.players.length === 1 && !!ordinary.world.storm, 'rejected requests cannot grant equipment or change public simulation');
  } finally { ordinary.destroy(); }
  const recovery = new Match({ W, id: 'practice-recovery', mode: 'duo', teamSize: 2, practice: true, seed: 9, clock: false, teams: [{ members: [{ name: 'Returning' }, { name: 'Friend' }] }] });
  try {
    const who = recovery.players[0], messages = [], conn = { open: true, bufferedAmount: 0, sendJson(m) { messages.push(m); }, sendText() {}, close() {} };
    who.net.everConnected = true; who.net.left = true; who.alive = false;
    recovery.claim(recovery.slots[0].ticket, conn);
    t.check(messages.some(m => m.t === 'match-start' && m.rejoin) && messages.some(m => m.t === 'sync') && who.alive,
      'returning after AFK removal respawns and receives full changed-world synchronization');
  } finally { recovery.destroy(); }
  ma.send({ t: 'leave' }); a.send({ t: 'left-match' }); await sleep(150);
  t.equal(app.lobby.parties.get(party.id).members.length, 2, 'leaving the match keeps the friend party together');
  rejoin.send({ t: 'leave' }); currentB.send({ t: 'left-match' }); await sleep(100);
  t.check(match.players.filter(p => !p.practiceBot).every(p => p.net.left), 'both humans can leave while targets stay inert');
  const finalParty = app.lobby.parties.get(party.id);
  t.check(finalParty.members.length === 2 && finalParty.members.every(m => m.open && !m.match), 'both friends remain in the same reusable party after a page reload and leaving practice');
  a.send({ t: 'practice-start' }); t.check((await a.expect('practice-start-result')).ok, 'the retained party can immediately start another private practice together');
  const nextA = await a.expect('match-ticket'), nextB = await currentB.expect('match-ticket');
  t.check(nextA.id === nextB.id && nextA.id !== ta.id, 'both retained party members receive the new private practice tickets');
  a.close(); currentB.close(); await sleep(100);
  const returnA = client(base + '/ws'), returnB = client(base + '/ws'); await Promise.all([returnA.open, returnB.open]);
  returnA.send({ t: 'hello', token: authA.token }); returnB.send({ t: 'hello', token: authB.token });
  await Promise.all([returnA.expect('welcome'), returnB.expect('welcome')]);
  const bothReturned = await Promise.all([returnA.expect('party', m => m.party && m.party.members.length === 2), returnB.expect('party', m => m.party && m.party.members.length === 2)]);
  t.check(bothReturned.every(m => m.party.id === party.id), 'simultaneous page reloads recreate and restore the same private-practice party');
} finally { sockets.forEach(c => c.close()); await sleep(100); await app.close(); }
t.done();
