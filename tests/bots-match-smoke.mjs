// Whole matches played by bots, as fast as the machine will go: a full 50-player lobby in Solo, Duos and Squads
// has to land spread out, loot, upgrade, use its items, thin out at a believable pace and end with a winner,
// without a single bot throwing or freezing, and cheaply enough for a free Durable Object.
import { suite } from './harness.mjs';
import { Warz as W } from '../server/core/sim.mjs';
import { Match, TICK } from '../server/core/match.mjs';

const t = suite('bot matches');
const quiet = { info() {}, warn() {}, error(m) { console.error(m); } };
const fakeConn = () => ({ open: true, bufferedAmount: 0, sent: 0, sendText() { this.sent++; }, sendJson() { this.sent++; }, close() { this.open = false; } });

function lobby(teamSize, humans = 0) {
  const teams = [];
  let seat = 0;
  for (let i = 0; i < 50; ) {
    const members = [];
    for (let k = 0; k < teamSize && i < 50; k++, i++) members.push(seat++ < humans ? { userKey: null, name: 'Player' + seat } : { bot: true });
    teams.push({ members });
  }
  return teams;
}
function play(seed, teamSize, o = {}) {
  const match = new Match({ W, id: 'test', mode: 'x', teamSize, teams: lobby(teamSize, o.humans || 0), seed, log: quiet, clock: false, emptyTimeout: o.emptyTimeout === undefined ? Infinity : o.emptyTimeout, botSkill: o.botSkill });
  const world = match.world, dir = match.bots, s = { match, world, dir, alive: {}, causes: {}, items: {}, upgrades: 0, lvl2: 0, crates: 0, downs: 0, revives: 0, worst: 0, ms: 0, ticks: 0, frozen: 0, spawn: Infinity };
  for (const a of match.players) for (const b of match.players) if (a.id < b.id && a.team !== b.team) s.spawn = Math.min(s.spawn, Math.hypot(a.x - b.x, a.y - b.y));
  const observe = dir.observe.bind(dir);
  dir.observe = (events) => {
    for (const e of events) {
      if (e.type === 'death') s.causes[e.cause] = (s.causes[e.cause] || 0) + 1;
      else if (e.type === 'item-used') s.items[e.item] = (s.items[e.item] || 0) + 1;
      else if (e.type === 'upgrade') { s.upgrades++; if (W.CLASSES[e.classId].tier === 2) s.lvl2++; }
      else if (e.type === 'crate') s.crates++;
      else if (e.type === 'downed') s.downs++;
      else if (e.type === 'revived') s.revives++;
    }
    observe(events);
  };
  if (o.setup) o.setup(s);
  const marks = [60, 150, 300], spots = new Map(match.players.map((p) => [p.id, { x: p.x, y: p.y, t: 0 }]));
  const t0 = performance.now();
  while (!match.ended && world.time < (o.until || W.STORM.at(-1).end + 85)) {
    const t1 = performance.now();
    match.tick();
    s.worst = Math.max(s.worst, performance.now() - t1);
    s.ticks++;
    if (marks.length && world.time >= marks[0]) s.alive[marks.shift()] = match.players.filter((p) => p.alive).length;
    if (s.ticks % 20 === 0) {
      for (const p of match.players) {
        if (!p.alive || !p.bot || p.downed || p.mount) continue;
        const at = spots.get(p.id);
        if (Math.hypot(p.x - at.x, p.y - at.y) > 60) { at.x = p.x; at.y = p.y; at.t = world.time; }
        else if (world.time - at.t > 40 && world.storm.phase < 4) { s.frozen++; at.t = world.time; }   // late on, holding a spot in a tiny circle is the right thing to do
      }
    }
  }
  s.ms = (performance.now() - t0) / s.ticks;
  s.time = world.time;
  return s;
}

// ---------------------------------------------------------------- the lobby itself
{
  const s = play(7, 1, { until: 1 });
  const m = s.match;
  t.equal(m.players.length, 50, 'a Solo lobby of bot seats makes a 50-player match');
  t.check(m.players.every((p) => p.bot && p.ai && typeof p.controller === 'function'), 'every seat is a bot with a brain behind it');
  t.equal(new Set(m.players.map((p) => p.name.toLowerCase())).size, 50, 'with 50 different names');
  t.check(m.slots.length === 50 && m.slots.every((x) => x.ticket === null) && m.byTicket.size === 0, 'bot seats have no ticket: nobody can connect as one');
  t.check(s.spawn > 380, 'no two enemies land on top of each other, even with three or four to a Drop Station (closest pair ' + Math.round(s.spawn) + ' units apart)');
  t.check(m.players.every((p) => W.U.insideIsland(p.x, p.y, 200, W.CONFIG.worldSize, W.CONFIG.cornerRadius) && !m.world.inPond(p.x, p.y) && !s.dir.nav.solidAt(p.x, p.y, 24)), 'everyone lands on open ground');
  const skills = m.players.map((p) => p.ai.prof.skill);
  t.check(Math.max(...skills) - Math.min(...skills) > 0.45, 'the lobby is a mix of weaker and better bots (skill ' + Math.min(...skills).toFixed(2) + ' to ' + Math.max(...skills).toFixed(2) + ')');
  const again = play(7, 1, { until: 1 });
  t.equal(again.match.players.map((p) => p.name + ':' + p.ai.prof.skill.toFixed(3)).join(), m.players.map((p) => p.name + ':' + p.ai.prof.skill.toFixed(3)).join(), 'the same seed fills the lobby with the same bots');
  // The BOT_SKILL setting reaches the lobby.
  const avg = (s) => s.match.players.reduce((n, p) => n + p.ai.prof.skill, 0) / 50;
  const easy = play(7, 1, { until: 1, botSkill: 0 }), hard = play(7, 1, { until: 1, botSkill: 1 });
  t.check(avg(easy) < 0.3 && avg(hard) > 0.66 && avg(s) > 0.4 && avg(s) < 0.55, 'the server\'s bot skill setting makes the lobby weaker (' + avg(easy).toFixed(2) + ') or stronger (' + avg(hard).toFixed(2) + ') than the usual ' + avg(s).toFixed(2));
  t.check(easy.dir.humanKeen < s.dir.humanKeen && hard.dir.humanKeen > s.dir.humanKeen, 'and bots that go looking for players less often, or more');
  m.destroy(); again.match.destroy(); easy.match.destroy(); hard.match.destroy();
}
{
  for (const [size, teams, label] of [[2, 25, 'Duos'], [3, 17, 'Trios'], [4, 13, 'Squads']]) {
    const s = play(11, size, { until: 1 }), m = s.match;
    t.check(m.players.length === 50 && m.teamInfo.length === teams, label + ': 50 players in ' + teams + ' teams');
    t.check(m.teamInfo.every((info) => new Set(info.players.map((p) => p.team)).size === 1 && info.players.every((p, i) => i === 0 || Math.hypot(p.x - info.players[0].x, p.y - info.players[0].y) < 90)), label + ': teammates share a team and land together');
    m.destroy();
  }
}

// ---------------------------------------------------------------- full matches
const totals = { items: {}, upgrades: 0, lvl2: 0 };
for (const [seed, size, label] of [[7, 1, 'Solo'], [2024, 1, 'Solo'], [21, 2, 'Duos'], [303, 4, 'Squads']]) {
  const s = play(seed, size);
  const tag = label + ' (seed ' + seed + '): ';
  t.equal(s.dir.errors, 0, tag + 'no bot throws');
  t.check(s.match.ended && s.match.teamInfo.filter((x) => x.alive).length === 1, tag + 'the match ends with one team standing');
  t.check(s.time > 300 && s.time < W.STORM.at(-1).end + 45, tag + 'after ' + Math.round(s.time) + ' s (the storm closes for good at ' + W.STORM.at(-1).end + ')');
  t.check(s.alive[60] >= 38, tag + 'the landing is not a massacre (' + s.alive[60] + ' alive after a minute)');
  t.check(s.alive[150] >= 24 && s.alive[150] <= 45, tag + 'the lobby thins steadily (' + s.alive[150] + ' alive when the storm starts moving)');
  // New vehicle clearings change seeded routes and encounters. This broad pacing guard requires at least
  // one-third eliminated after five minutes, with enough survivors to keep the match contested.
  t.check(s.alive[300] >= 6 && s.alive[300] <= Math.floor(W.CONFIG.lobbySize * 2 / 3), tag + 'and is still a contest at five minutes (' + s.alive[300] + ' alive)');
  t.check(s.crates >= 50, tag + 'crates get opened (' + s.crates + ')');
  t.check(s.upgrades >= 4, tag + 'bots spend tokens at Upgrade Stations (' + s.upgrades + ' upgrades)');
  t.check(Object.keys(s.items).length >= 8, tag + 'and use what they find (' + Object.keys(s.items).length + ' different items)');
  t.check((s.causes.storm || 0) <= 9, tag + 'few of them die to the storm (' + (s.causes.storm || 0) + ')');
  t.equal(s.frozen, 0, tag + 'nobody stands frozen in one place');
  t.check(s.ms < 2.5, tag + 'cheap to run: ' + s.ms.toFixed(2) + ' ms per tick on average (50 ms are available)');
  // Encounter outcomes vary with the map and routes. The focused team scenarios verify revive decisions and
  // timing; a full match must also demonstrate that at least one rescue actually completes under match conditions.
  if (size > 1) t.check(s.downs >= 10 && s.revives >= 1, tag + 'teammates get knocked down and picked back up (' + s.revives + ' revives of ' + s.downs + ' knockdowns)');
  for (const id in s.items) totals.items[id] = (totals.items[id] || 0) + s.items[id];
  totals.upgrades += s.upgrades; totals.lvl2 += s.lvl2;
  s.match.destroy();
}
{
  const kinds = Object.keys(totals.items), by = (k) => kinds.filter((id) => W.ITEMS[id].kind === k).length;
  t.check(kinds.length >= 20, 'across these matches bots used ' + kinds.length + ' of the 34 items');
  t.check(by('consume') >= 6 && by('throw') >= 4 && by('place') >= 2, 'of every sort: potions and food, throwables, things to build');
}
{
  // The same seed plays out the same way (bots only use the match's seeded randomness).
  const a = play(99, 1, { until: 120 }), b = play(99, 1, { until: 120 });
  const sig = (s) => s.match.players.map((p) => (p.alive ? Math.round(p.x) + ',' + Math.round(p.y) + ',' + Math.round(p.hp) : 'x')).join(';');
  t.equal(sig(a), sig(b), 'two runs of the same seed are identical after two minutes');
  a.match.destroy(); b.match.destroy();
}

// ---------------------------------------------------------------- with a person in the lobby
{
  const s = play(31, 1, { humans: 1, until: 40, emptyTimeout: 3, setup(x) { x.conn = fakeConn(); x.match.claim(x.match.slots[0].ticket, x.conn); } });
  const m = s.match, me = m.players[0];
  t.check(!me.bot && m.players.filter((p) => p.bot).length === 49, 'one player and 49 bots share a match');
  t.check(typeof m.slots[0].ticket === 'string' && m.slots.slice(1).every((x) => x.ticket === null), 'only the player\'s seat has a ticket');
  t.check(!m.ended && s.conn.sent > 400, 'the match runs and the player gets snapshots (' + s.conn.sent + ' messages in 40 s)');
  t.check(m.players.filter((p) => p.bot && p.alive).length >= 40, 'the bots are not removed for having no connection (the idle-player rule is for people)');
  // The player leaves: bots do not keep the match (and the server's free quota) going on their own.
  m.leave(s.conn);
  for (let i = 0; i < 5 / TICK && !m.ended; i++) m.tick();
  t.check(m.ended, 'when the last person leaves, the match winds up a few seconds later instead of running on for the bots');
  m.destroy();
}

// ---------------------------------------------------------------- a connection that drops and comes back
{
  const s = play(31, 1, { humans: 1, until: 20, emptyTimeout: 3, setup(x) { x.conn = fakeConn(); x.match.claim(x.match.slots[0].ticket, x.conn); } });
  const m = s.match, me = m.players[0];
  s.conn.open = false; m.detach(s.conn);                     // the socket drops: a tunnel, a phone switching tabs, a reload
  for (let i = 0; i < 12 / TICK; i++) m.tick();
  const back = me.alive && !m.ended ? m.claim(m.slots[0].ticket, fakeConn()) : null;
  t.check(me.alive && !m.ended && back === me, 'a player whose connection drops for 12 seconds still has a match (and a body) to come back to, though nobody else is connected');
  // Gone for good: the body is removed after the idle limit and the match winds up with it.
  back.net.conn.open = false; m.detach(back.net.conn);
  for (let i = 0; i < 30 / TICK && !m.ended; i++) m.tick();
  t.check(!me.alive && m.ended, 'one who never comes back is removed after the idle limit, and the match ends then instead of running on for the bots');
  m.destroy();
}

t.done();
