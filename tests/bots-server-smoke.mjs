// Bots in the lobby and in a live match, over real sockets against the Node adapter: a lobby is always 50 strong,
// every real player who joins takes a bot's seat (and gives it back on leaving), the match starts with 50 players,
// the bots in it play, and a match nobody is connected to any more does not run on for the bots.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/node/index.mjs';
import { Lobby } from '../server/core/lobby.mjs';
import { suite } from './harness.mjs';

const t = suite('bots online');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { info(m) { if (process.env.VERBOSE) console.log('[server] ' + m); }, warn(m) { console.warn('[server] ' + m); }, error(m) { console.error('[server] ' + m); } };

// ---------------------------------------------------------------- how a lobby is packed into teams
{
  const pack = (mode, entries, config = {}) => {
    let spec = null;
    const lobby = new Lobby({ config: Object.assign({ lobbyMin: 1, lobbyMax: 50, lobbyCountdown: 20, botFill: 50 }, config), send() {}, startMatch(s) { spec = s; return null; }, findConns() { return []; }, log: quiet });
    let n = 0;
    for (const e of entries) {
      const conns = [];
      for (let i = 0; i < e.players; i++) conns.push({ name: 'P' + (++n), user: null, open: true, party: null, queue: null, match: null });
      if (e.players > 1 || e.fill === false) {
        const party = { id: n, mode, leader: conns[0], members: conns, invited: new Map(), invitedNames: new Map(), fill: e.fill !== false, entry: null };
        conns.forEach((c) => { c.party = party; });
      }
      lobby.queue(conns[0], mode);
    }
    const view = lobby.lobbyView(mode);
    lobby.launch(mode);
    return { view, spec, teams: spec ? spec.teams.map((team) => team.members.map((m) => (m.bot ? 'bot' : m.name))) : [] };
  };
  const seats = (r) => r.teams.reduce((n, team) => n + team.length, 0), bots = (r) => r.teams.reduce((n, team) => n + team.filter((m) => m === 'bot').length, 0);

  let r = pack('solo', [{ players: 1 }, { players: 1 }, { players: 1 }, { players: 1 }, { players: 1 }]);
  t.check(r.view.count === 5 && r.view.bots === 45 && r.view.total === 50, 'five players waiting for Solo: the lobby shows 5 players and 45 bots');
  t.check(r.teams.length === 50 && bots(r) === 45 && r.teams.every((team) => team.length === 1), 'and the match is 50 teams of one: those five and 45 bots');
  r = pack('solo', [{ players: 1 }, { players: 1 }, { players: 1 }, { players: 1 }, { players: 1 }, { players: 1 }]);
  t.check(r.view.count === 6 && r.view.bots === 44 && bots(r) === 44 && seats(r) === 50, 'a sixth player takes a bot\'s seat: 6 players, 44 bots');
  r = pack('trio', [{ players: 1 }]);
  t.check(seats(r) === 50 && r.teams.length === 17 && r.teams[0].join() === 'P1,bot,bot', 'alone in Trios: two bot teammates, and 50 players in 17 teams');
  t.check(r.teams.slice(1, 16).every((team) => team.join() === 'bot,bot,bot') && r.teams[16].join() === 'bot,bot', 'the other teams are bots (the last one is two short of a multiple of three)');
  r = pack('duo', [{ players: 2 }, { players: 1 }, { players: 1 }]);
  t.check(seats(r) === 50 && r.teams[0].join() === 'P1,P2' && r.teams[1].join() === 'P3,P4' && bots(r) === 46, 'in Duos a party of two stays together, two strangers are paired with each other, bots make up the other 23 teams');
  r = pack('squad', [{ players: 2, fill: false }, { players: 1 }]);
  t.check(r.teams[0].join() === 'P1,P2' && r.teams[1].join() === 'P3,bot,bot,bot', 'a party that switched Fill off keeps its two empty spots; a lone player gets three bot teammates');
  t.check(seats(r) === 50 && r.teams.length === 13, 'and the lobby is still 50 players');
  r = pack('squad', [{ players: 3 }, { players: 1 }, { players: 2 }]);
  t.check(r.teams[0].join() === 'P1,P2,P3,P4' && r.teams[1].join() === 'P5,P6,bot,bot' && seats(r) === 50, 'real players are put together first, bots only fill what is left');
  r = pack('solo', [{ players: 1 }, { players: 1 }], { botFill: 0 });
  t.check(r.view.bots === 0 && r.view.total === 2 && seats(r) === 2, 'with BOT_FILL=0 there are no bots at all');
  r = pack('solo', [{ players: 1 }], { botFill: 50, lobbyMax: 20 });
  t.check(r.view.total === 20 && seats(r) === 20, 'bots never push a lobby past its maximum size');
  const empty = new Lobby({ config: { lobbyMin: 1, lobbyMax: 50, lobbyCountdown: 20, botFill: 50 }, send() {}, startMatch() { throw new Error('started an empty lobby'); }, findConns() { return []; }, log: quiet });
  t.check(empty.lobbyView('solo').total === 0 && empty.lobbyView('solo').bots === 0, 'a lobby nobody is waiting in has no bots in it');
  empty.tick(Date.now()); empty.tick(Date.now() + 60000);
  t.check(true, 'and never starts a match on its own');
  // One player and nobody to play against (bots off, or a fill that only makes up their own team): wait for a second player.
  const alone = (mode, config, players = 1) => {
    let started = 0;
    const lobby = new Lobby({ config: Object.assign({ lobbyMin: 1, lobbyMax: 50, lobbyCountdown: 0, botFill: 50 }, config), send() {}, startMatch() { started++; return null; }, findConns() { return []; }, log: quiet });
    for (let i = 0; i < players; i++) lobby.queue({ name: 'Lone' + i, user: null, open: true, party: null, queue: null, match: null }, mode);
    const min = lobby.lobbyView(mode).min;
    lobby.tick(1000); lobby.tick(2000);
    return { started, min };
  };
  t.check(alone('solo', {}).started === 1 && alone('squad', { botFill: 8 }).started === 1, 'one player starts a match when bots make up at least one other team');
  let lone = alone('solo', { botFill: 0 });
  t.check(lone.started === 0 && lone.min === 2, 'with bots off, one player alone does not start a match against nobody: the lobby waits for a second');
  lone = alone('squad', { botFill: 4 });
  t.check(lone.started === 0 && lone.min === 2, 'nor when the bots would only fill their own team');
  t.equal(alone('solo', { botFill: 0 }, 2).started, 1, 'two players with bots off do start');
}

// ---------------------------------------------------------------- over the wire
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warz-bots-'));
const app = createApp({ dataDir, lobbyMin: 1, lobbyCountdown: 1.5, botFill: 50, serveStatic: false, log: quiet });
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
    drop(type) { for (let i = queue.length - 1; i >= 0; i--) if (!type || queue[i].t === type) queue.splice(i, 1); },
    close() { ws.close(); }
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (api.onAny) api.onAny(m);
    for (let i = 0; i < waiters.length; i++) if (waiters[i].match(m)) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m); return; }
    queue.push(m);
    if (queue.length > 400) queue.shift();
  };
  ws.onclose = () => { api.closed = true; };
  return api;
}
async function hub(name) { const c = client(base + '/ws'); await c.opened; c.send({ t: 'hello', v: 1, name }); c.welcome = await c.expect('welcome'); return c; }
async function joinMatch(ticketMsg) { const m = client(base + '/match/' + ticketMsg.id + '/ws?ticket=' + ticketMsg.ticket); await m.opened; m.start = await m.expect('match-start'); return m; }

try {
  const cfg = await (await fetch('http://127.0.0.1:' + port + '/api/config')).json();
  t.check(cfg.bots === 50 && cfg.lobbyMin === 1 && cfg.lobbyMax === 50, '/api/config says lobbies are filled to 50 and one player is enough to start');

  // ------------------------------------------------------------ a Solo lobby
  const A = await hub('Ann'), B = await hub('Ben'), C = await hub('Cal');
  t.check(A.welcome.config.bots === 50 && A.welcome.config.lobbyMin === 1, 'the welcome message carries the same');
  A.send({ t: 'queue', mode: 'solo' });
  let lobby = (await A.expect('lobby', 8000, (m) => m.lobby && m.lobby.count === 1)).lobby;
  t.check(lobby.bots === 49 && lobby.total === 50 && lobby.max === 50, 'one player queues for Solo: the lobby is 1 player and 49 bots');
  B.send({ t: 'queue', mode: 'solo' });
  lobby = (await A.expect('lobby', 8000, (m) => m.lobby && m.lobby.count === 2)).lobby;
  t.check(lobby.bots === 48 && lobby.total === 50, 'a second player joins: a bot leaves, 2 players and 48 bots');
  C.send({ t: 'queue', mode: 'solo' });
  lobby = (await A.expect('lobby', 8000, (m) => m.lobby && m.lobby.count === 3)).lobby;
  t.check(lobby.bots === 47 && lobby.total === 50, 'a third: 3 and 47');
  C.send({ t: 'dequeue' });
  lobby = (await A.expect('lobby', 8000, (m) => m.lobby && m.lobby.count === 2)).lobby;
  t.check(lobby.bots === 48 && lobby.total === 50, 'the third leaves the lobby again: the bot is back, 2 and 48');
  lobby = (await A.expect('lobby', 8000, (m) => m.lobby && m.lobby.countdown !== null)).lobby;
  t.check(lobby.countdown <= 2 && lobby.total === 50, 'the countdown to the match runs from the moment the first player is waiting (' + lobby.countdown + ' s left)');

  const tA = await A.expect('match-ticket', 10000), tB = await B.expect('match-ticket', 10000);
  t.check(tA.id === tB.id && tA.ticket !== tB.ticket, 'both players get their own ticket to the same match');
  await sleep(300);
  t.check(C.closed === false && !(await C.expect('match-ticket', 400).catch(() => null)), 'the player who left the lobby gets none');

  const match = app.matches.get(tA.id);
  t.check(!!match && match.players.length === 50 && match.players.filter((p) => p.bot).length === 48, 'on the server the match has 50 players: 2 people and 48 bots');
  const mA = await joinMatch(tA), mB = await joinMatch(tB);
  const roster = mA.start.players;
  t.equal(roster.length, 50, 'the match starts with a roster of 50');
  t.check(mA.start.teams === 50 && mA.start.teamSize === 1, 'fifty teams of one');
  t.equal(new Set(roster.map((p) => p.name.toLowerCase())).size, 50, 'every name on it is different');
  t.check(roster.some((p) => p.name === A.welcome.name) && roster.some((p) => p.name === B.welcome.name), 'the two players are on it under their own names');
  t.check(roster.every((p) => Object.keys(p).sort().join() === 'color,emote,face,id,name,outline,team'), 'bots share the same identity and cosmetic fields as everybody else (nothing marks them)');
  const bad = client(base + '/match/' + tA.id + '/ws?ticket=null');
  const badClose = await new Promise((resolve) => { bad.ws.onclose = (ev) => resolve(ev.code); });
  t.check(match.slots.filter((x) => x.ticket).length === 2 && badClose === 4401, 'only the two people have tickets: nobody can connect as a bot');

  // Nine seconds of the match: the bots land, walk off and start on the crates.
  const seenBy = new Map();
  let storm = null, botShots = 0, crates = 0;
  mA.onAny = (m) => {
    if (m.t === 'storm') storm = m;
    if (m.t === 'snap') for (const row of m.p) seenBy.set(row[0], { x: row[1], y: row[2] });
  };
  const observe = match.bots.observe.bind(match.bots);
  match.bots.observe = (events) => {
    for (const e of events) { if (e.type === 'shot' && e.player && e.player.bot) botShots++; else if (e.type === 'crate') crates++; }
    observe(events);
  };
  const spawn = new Map(match.players.map((p) => [p.id, { x: p.x, y: p.y }]));
  await sleep(9000);
  const walked = match.players.filter((p) => p.bot && Math.hypot(p.x - spawn.get(p.id).x, p.y - spawn.get(p.id).y) > 150).length;
  t.check(walked >= 40, 'nine seconds in, nearly every bot has left its landing spot (' + walked + ' of 48)');
  t.check(botShots > 20 && crates > 0, 'and they are shooting crates open (' + botShots + ' shots, ' + crates + ' crates so far)');
  t.check(!!storm && storm.alive >= 44 && storm.alive <= 50, 'the count on the HUD says about 50 alive (' + (storm && storm.alive) + ')');
  t.equal(match.bots.errors, 0, 'no bot has thrown');

  // A client is told about bots exactly as about anyone else: stand a player next to one and it is in their snapshots.
  const meA = match.byId.get(mA.start.you);
  const bot = match.players.filter((p) => p.bot && p.alive).sort((p, q) => Math.hypot(p.x - meA.x, p.y - meA.y) - Math.hypot(q.x - meA.x, q.y - meA.y))[0];
  meA.x = bot.x + 260; meA.y = bot.y; match.world.collide(meA);
  seenBy.clear();
  const t1 = Date.now();
  while (!seenBy.has(bot.id) && Date.now() - t1 < 3000) await sleep(50);
  const row = seenBy.get(bot.id);
  t.check(!!row && Math.hypot(row.x - bot.x, row.y - bot.y) < 60, 'a bot near a player is in that player\'s snapshots, where the server has it');

  // A bot's death is counted like any other.
  const victim = match.players.find((p) => p.bot && p.alive && p !== bot);
  const before = match.players.filter((p) => p.alive).length;
  match.world.killPlayer(victim, null, 'storm');
  await sleep(1200);
  t.check(!victim.alive && match.aliveCount === match.players.filter((p) => p.alive).length && match.aliveCount < before && !!storm && storm.alive <= before - 1, 'a bot that dies is counted out, on the server and on the HUD');

  // Explicitly leave, as the menu does. A dropped socket alone preserves the body for reconnection.
  match.emptyTimeout = 1;
  mA.send({ t: 'leave' }); mB.send({ t: 'leave' });
  await sleep(100);
  mA.close(); mB.close();
  A.send({ t: 'left-match' }); B.send({ t: 'left-match' });
  const t0 = Date.now();
  while (!match.ended && Date.now() - t0 < 6000) await sleep(100);
  t.check(match.ended, 'when the last person leaves the match ends by itself (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s later here; 10 s in production)');

  // ------------------------------------------------------------ a team mode
  A.send({ t: 'queue', mode: 'squad' });
  lobby = (await A.expect('lobby', 8000, (m) => m.lobby && m.lobby.count === 1 && m.lobby.mode === 'squad')).lobby;
  t.check(lobby.bots === 49 && lobby.size === 4, 'alone in the Squads queue: 49 bots');
  const tS = await A.expect('match-ticket', 10000);
  const mS = await joinMatch(tS);
  const mine = mS.start.players.filter((p) => p.team === mS.start.team);
  t.check(mS.start.players.length === 50 && mS.start.teams === 13 && mS.start.teamSize === 4, 'the Squads match has 50 players in 13 teams');
  t.check(mine.length === 4 && mine.filter((p) => p.id !== mS.start.you).length === 3, 'and the player has three bot teammates');
  const squad = app.matches.get(tS.id), me = squad.byId.get(mS.start.you), mates = squad.players.filter((p) => p.team === me.team && p !== me);
  t.check(mates.length === 3 && mates.every((p) => p.bot && Math.hypot(p.x - me.x, p.y - me.y) < 120), 'who land right next to them');
  // Run inland through the reserved drop clearing. A fixed world direction can point out to sea from
  // a random coastal spawn, making the travel assertion measure shoreline collision rather than following.
  const from = { x: me.x, y: me.y };
  const dx = squad.map.size / 2 - from.x, dy = squad.map.size / 2 - from.y, distance = Math.hypot(dx, dy);
  const mx = dx / distance, my = dy / distance, runDistance = 900;
  t.check(squad.bots.nav.segmentClear(from.x, from.y, from.x + mx * runDistance, from.y + my * runDistance, { dry: true }),
    'the squad-follow route is dry, open ground inside the coastal drop clearing');
  let seq = 0;
  const run = setInterval(() => {
    const moving = Math.hypot(me.x - from.x, me.y - from.y) < runDistance;
    mS.send({ t: 'in', s: ++seq, mx: moving ? mx : 0, my: moving ? my : 0, a: 0, d: 400, f: false, fp: false, sc: false, r: false, sl: null, cy: 0, sw: false, u: false, iv: false });
  }, 50);
  await sleep(8000);
  clearInterval(run);
  const ran = Math.hypot(me.x - from.x, me.y - from.y), near = mates.filter((p) => Math.hypot(p.x - me.x, p.y - me.y) < 800).length;
  t.check(ran > 700 && near >= 2, 'the player runs ' + Math.round(ran) + ' units from the landing spot: the bot teammates come along (' + near + ' of 3 within 800 units)');
  t.equal(squad.bots.errors, 0, 'no bot has thrown in the team match either');
  squad.emptyTimeout = 1;
  mS.close();
  A.close(); B.close(); C.close();
} catch (err) {
  t.check(false, 'the run finished without an exception (' + (err && err.stack || err) + ')');
} finally {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

t.done();
