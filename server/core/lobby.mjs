// Parties and matchmaking queues. A queue entry is one party (or one solo player); when a mode has enough
// players a countdown runs and the entries are packed into teams for a new match.
// With `config.botFill` set, every lobby is topped up to that many players with bots: each real player who joins
// takes a bot's place, so 5 players wait with 45 bots, and a sixth makes it 6 and 44.
export const MODES = { solo: 1, duo: 2, trio: 3, squad: 4 };

function lower(s) { return String(s || '').trim().toLowerCase(); }

export class Lobby {
  constructor({ config, send, startMatch, findConns, log = console }) {
    this.config = config;
    this.send = send;
    this.startMatch = startMatch;
    this.findConns = findConns;
    this.log = log;
    this.parties = new Map();
    this.nextParty = 1;
    this.nextEntry = 1;
    this.queues = { solo: [], duo: [], trio: [], squad: [] };
    this.countdown = { solo: 0, duo: 0, trio: 0, squad: 0 };
    this.lastLobby = new Map();
  }

  teamSize(mode) { return MODES[mode] || 0; }

  // ---------------------------------------------------------------- parties
  partyView(party, conn) {
    return {
      id: party.id, mode: party.mode, size: this.teamSize(party.mode), leader: party.leader.name, you: conn ? conn.name : null,
      members: party.members.map((m) => ({ name: m.name, leader: m === party.leader })),
      invited: [...party.invited.keys()].map((k) => party.invitedNames.get(k) || k),
      fill: party.fill, queued: !!party.entry, starting: !!party.starting
    };
  }
  pushParty(party) { for (const m of party.members) this.send(m, { t: 'party', party: this.partyView(party, m) }); }

  restorePracticeMember(conn, saved) {
    if (!conn.user || conn.party) return false;
    let party = this.parties.get(saved.id);
    if (party && (party.starting || party.entry || party.members.length >= this.teamSize(party.mode) ||
        party.members.some((m) => m.user === conn.user || (m.match && m.match.id !== saved.match)))) return false;
    if (!party) {
      party = { id: saved.id, mode: saved.mode, leader: conn, members: [], invited: new Map(), invitedNames: new Map(), fill: saved.fill, entry: null };
      this.parties.set(party.id, party);
    }
    party.members.push(conn); conn.party = party; this.pushParty(party);
    return true;
  }

  createParty(conn, mode) {
    if (!this.teamSize(mode) || mode === 'solo') return { ok: false, reason: 'mode' };
    if (conn.match) return { ok: false, reason: 'inmatch' };
    this.dequeue(conn);
    this.leaveParty(conn);
    const party = { id: this.nextParty++, mode, leader: conn, members: [conn], invited: new Map(), invitedNames: new Map(), fill: true, entry: null };
    this.parties.set(party.id, party);
    conn.party = party;
    this.pushParty(party);
    return { ok: true, party };
  }

  invite(conn, name) {
    const party = conn.party;
    if (!party) return { ok: false, reason: 'noparty' };
    if (party.leader !== conn) return { ok: false, reason: 'leader' };
    const key = lower(name);
    if (!key) return { ok: false, reason: 'name' };
    if (party.members.some((m) => m.user === key)) return { ok: false, reason: 'member' };
    if (party.members.length + party.invited.size >= this.teamSize(party.mode) && !party.invited.has(key)) return { ok: false, reason: 'full' };
    const targets = this.findConns(key);
    if (!targets.length) return { ok: false, reason: 'offline' };
    party.invited.set(key, Date.now());
    party.invitedNames.set(key, targets[0].name);
    for (const t of targets) this.send(t, { t: 'party-invited', id: party.id, from: conn.name, mode: party.mode, size: this.teamSize(party.mode) });
    this.pushParty(party);
    return { ok: true };
  }

  join(conn, partyId) {
    const party = this.parties.get(Number(partyId));
    if (!party) return { ok: false, reason: 'gone' };
    if (!conn.user || !party.invited.has(conn.user)) return { ok: false, reason: 'notinvited' };
    if (party.starting || party.members.some((m) => m.match)) return { ok: false, reason: 'inmatch' };
    if (party.members.length >= this.teamSize(party.mode)) return { ok: false, reason: 'full' };
    if (conn.match) return { ok: false, reason: 'inmatch' };
    this.dequeue(conn);
    this.leaveParty(conn);
    party.invited.delete(conn.user);
    party.invitedNames.delete(conn.user);
    party.members.push(conn);
    conn.party = party;
    if (party.entry) { party.entry.conns = party.members.slice(); conn.queue = party.entry; this.pushLobby(party.mode, true); }
    this.pushParty(party);
    for (const m of party.members) if (m !== conn) this.send(m, { t: 'notice', text: conn.name + ' joined the team.', kind: 'friend' });
    return { ok: true };
  }

  ignore(conn, partyId) {
    const party = this.parties.get(Number(partyId));
    if (party && conn.user && party.invited.has(conn.user)) {
      party.invited.delete(conn.user);
      party.invitedNames.delete(conn.user);
      this.pushParty(party);
    }
    return { ok: true };
  }

  leaveParty(conn) {
    const party = conn.party;
    if (!party) return;
    party.members = party.members.filter((m) => m !== conn);
    conn.party = null;
    if (party.entry) {
      conn.queue = null;
      this.send(conn, { t: 'lobby', lobby: null });
      if (party.members.length) { party.entry.conns = party.members.slice(); this.pushLobby(party.mode, true); }
      else this.removeEntry(party.entry);
    }
    this.send(conn, { t: 'party', party: null });
    if (!party.members.length) { this.parties.delete(party.id); return; }
    if (party.leader === conn) party.leader = party.members[0];
    this.pushParty(party);
  }

  kick(conn, name) {
    const party = conn.party;
    if (!party || party.leader !== conn) return { ok: false, reason: 'leader' };
    const key = lower(name);
    const target = party.members.find((m) => m !== conn && (m.user === key || lower(m.name) === key));
    if (target) {
      this.leaveParty(target);
      this.send(target, { t: 'notice', text: 'You were removed from the team.', kind: 'muted' });
      return { ok: true };
    }
    if (party.invited.has(key)) {
      party.invited.delete(key);
      party.invitedNames.delete(key);
      this.pushParty(party);
      return { ok: true };
    }
    return { ok: false, reason: 'nomember' };
  }

  setFill(conn, fill) {
    const party = conn.party;
    if (!party || party.leader !== conn) return;
    party.fill = !!fill;
    if (party.entry) party.entry.fill = party.fill;
    this.pushParty(party);
  }

  // ---------------------------------------------------------------- queue
  startPractice(conn) {
    const party = conn.party;
    if (!party || party.members.length < 2) return { ok: false, reason: 'party' };
    if (party.leader !== conn) return { ok: false, reason: 'leader' };
    if (party.starting || party.members.some((m) => m.match)) return { ok: false, reason: 'inmatch' };
    if (party.members.some((m) => !m.open)) return { ok: false, reason: 'offline' };
    const members = [conn, ...party.members.filter((m) => m !== conn)];
    members.forEach((m) => this.dequeue(m));
    party.starting = true; this.pushParty(party);
    const spec = { mode: party.mode, teamSize: this.teamSize(party.mode), practice: true,
      teams: [{ members: members.map((m) => ({ userKey: m.user, name: m.name, conn: m })) }] };
    let started;
    try { started = this.startMatch(spec); }
    catch (err) { party.starting = false; this.pushParty(party); return { ok: false, reason: 'start-failed' }; }
    Promise.resolve(started).catch(() => {}).finally(() => { party.starting = false; if (this.parties.has(party.id)) this.pushParty(party); });
    return { ok: true };
  }

  queue(conn, mode) {
    if (conn.match) return { ok: false, reason: 'inmatch' };
    if (conn.party && mode === 'solo') this.leaveParty(conn); // Solo means solo: step out of the team first
    const party = conn.party;
    let conns, fill = true;
    if (party) {
      if (party.starting) return { ok: false, reason: 'inmatch' };
      if (party.leader !== conn) return { ok: false, reason: 'leader' };
      mode = party.mode;
      conns = party.members.slice();
      fill = party.fill;
      if (conns.some((c) => c.match)) return { ok: false, reason: 'inmatch' };
    } else conns = [conn];
    if (!this.teamSize(mode)) return { ok: false, reason: 'mode' };
    if (conns.length > this.teamSize(mode)) return { ok: false, reason: 'toobig' };
    conns.forEach((c) => this.dequeue(c));
    const entry = { id: this.nextEntry++, mode, conns, fill, since: Date.now(), party: party || null };
    this.queues[mode].push(entry);
    conns.forEach((c) => { c.queue = entry; });
    if (party) { party.entry = entry; this.pushParty(party); }
    this.pushLobby(mode, true);
    return { ok: true, entry };
  }

  dequeue(conn) { if (conn.queue) this.removeEntry(conn.queue); }

  removeEntry(entry) {
    const q = this.queues[entry.mode], i = q.indexOf(entry);
    if (i >= 0) q.splice(i, 1);
    entry.conns.forEach((c) => { if (c.queue === entry) { c.queue = null; this.send(c, { t: 'lobby', lobby: null }); } });
    if (entry.party && entry.party.entry === entry) { entry.party.entry = null; this.pushParty(entry.party); }
    this.pushLobby(entry.mode, true);
  }

  count(mode) { return this.queues[mode].reduce((n, e) => n + e.conns.length, 0); }

  // How many players a lobby is filled up to with bots (0: no bots).
  botTarget() {
    const fill = Math.floor(Number(this.config.botFill) || 0);
    return fill > 0 ? Math.min(fill, this.config.lobbyMax) : 0;
  }

  // Real players a match needs before its countdown starts. One is enough when bots make up at least one other
  // team; without them (bots off, or a fill no bigger than a single team) nobody starts a match against no one.
  minPlayers(mode) { return Math.max(this.config.lobbyMin, this.botTarget() > this.teamSize(mode) ? 1 : 2); }

  // `count` is real players; `bots` fill the rest of the lobby once at least one player is waiting.
  lobbyView(mode, now) {
    const end = this.countdown[mode], count = this.count(mode), bots = count > 0 ? Math.max(0, this.botTarget() - count) : 0;
    return {
      mode, count, bots, total: count + bots, min: this.minPlayers(mode), max: this.config.lobbyMax, size: this.teamSize(mode),
      countdown: end ? Math.max(0, Math.ceil((end - (now || Date.now())) / 1000)) : null
    };
  }

  pushLobby(mode, force, now) {
    const view = this.lobbyView(mode, now), json = JSON.stringify(view);
    if (!force && this.lastLobby.get(mode) === json) return;
    this.lastLobby.set(mode, json);
    for (const e of this.queues[mode]) for (const c of e.conns) this.send(c, { t: 'lobby', lobby: view });
  }

  tick(now) {
    for (const mode of Object.keys(this.queues)) {
      const n = this.count(mode);
      if (n > 0 && n >= this.minPlayers(mode)) {
        if (!this.countdown[mode]) this.countdown[mode] = now + this.config.lobbyCountdown * 1000;
        if (n >= this.config.lobbyMax) this.countdown[mode] = Math.min(this.countdown[mode], now + 5000);
        if (now >= this.countdown[mode]) { this.launch(mode); continue; }
      } else this.countdown[mode] = 0;
      this.pushLobby(mode, false, now);
    }
  }

  // Pack queued entries into teams. Parties stay together; "fill" teams are topped up with other fill entries.
  launch(mode) {
    const size = this.teamSize(mode), q = this.queues[mode], picked = [];
    let total = 0;
    for (const e of q) {
      if (total + e.conns.length > this.config.lobbyMax) continue;
      picked.push(e);
      total += e.conns.length;
    }
    this.countdown[mode] = 0;
    this.lastLobby.delete(mode);
    if (!picked.length) return null;
    const teams = [], open = [];
    for (const e of picked) {
      const members = e.conns.map((c) => ({ userKey: c.user, name: c.name, conn: c }));
      if (size === 1 || !e.fill || members.length === size) { teams.push({ members }); continue; }
      let team = open.find((t) => t.members.length + members.length <= size);
      if (!team) { team = { members: [] }; teams.push(team); open.push(team); }
      team.members.push(...members);
      if (team.members.length >= size) open.splice(open.indexOf(team), 1);
    }
    // Bots take the seats nobody is in: first the open spots on teams that asked for fill, then whole bot teams
    // until the lobby is full. (A party with fill switched off keeps its empty spots.)
    let seats = this.botTarget() - total;
    for (const team of open) while (seats > 0 && team.members.length < size) { team.members.push({ bot: true }); seats--; }
    while (seats > 0) {
      const team = { members: [] };
      while (seats > 0 && team.members.length < size) { team.members.push({ bot: true }); seats--; }
      teams.push(team);
    }
    for (const e of picked) {
      const i = q.indexOf(e);
      if (i >= 0) q.splice(i, 1);
      e.conns.forEach((c) => { c.queue = null; });
      if (e.party) e.party.entry = null;
    }
    let started = null;
    try { started = this.startMatch({ mode, teamSize: size, teams }); } catch (err) { this.log.error('match start failed: ' + (err && err.stack || err)); }
    for (const e of picked) if (e.party) this.pushParty(e.party);
    return started;
  }

  removeConn(conn) {
    this.dequeue(conn);
    this.leaveParty(conn);
  }
}
