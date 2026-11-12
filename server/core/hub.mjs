// The hub: one WebSocket per player for accounts, friends and presence, parties and matchmaking.
// Matches run elsewhere (a Node process or a Durable Object) behind the `matchHost` interface:
//   matchHost.start({ mode, teamSize, teams:[{ members:[{ userKey, name }] }] }) -> { id, tickets: string[] } (same order)
// Platform adapters create `conn` objects ({ open, sendJson, sendText, close }) and call onConnection / onMessage / onClose.
import { Lobby } from './lobby.mjs';

export const VERSION = 1;
const MESSAGE_RATE = 40;              // hub messages per second per connection
const MATCH_TTL = 20 * 60 * 1000;     // how long a rejoin ticket stays offered

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

export class Hub {
  constructor({ accounts, config, matchHost, log = console }) {
    this.accounts = accounts;
    this.config = config;
    this.matchHost = matchHost;
    this.log = log;
    this.conns = new Set();
    this.online = new Map();          // userKey -> Set<conn>
    this.activeMatches = new Map();   // userKey -> { id, ticket, at }
    this.matchUsers = new Map();      // matchId -> [userKey]
    this.practicePartyReturns = new Map(); // authenticated reconnects may recover their private-practice party
    accounts.presence = (key) => this.presence(key);
    this.lobby = new Lobby({
      config, log,
      send: (c, m) => c.sendJson(m),
      findConns: (k) => this.findConns(k),
      startMatch: (spec) => this.startMatch(spec)
    });
  }

  size() { return this.conns.size; }
  presence(key) {
    const set = this.online.get(key);
    if (!set || !set.size) return { online: false, inMatch: false };
    let inMatch = false;
    for (const c of set) if (c.match) inMatch = true;
    return { online: true, inMatch };
  }
  findConns(key) { return [...(this.online.get(key) || [])]; }

  // ---------------------------------------------------------------- lifecycle
  onConnection(conn) {
    this.conns.add(conn);
    Object.assign(conn, { user: null, name: this.guestName(''), session: null, party: null, queue: null, match: null, hello: false, rate: { at: Date.now(), n: 0 } });
  }

  onMessage(conn, text) {
    let m;
    try { m = JSON.parse(text); } catch (e) { conn.close(1003, 'bad json'); return; }
    if (!m || typeof m.t !== 'string') return;
    const now = Date.now();
    if (now - conn.rate.at >= 1000) { conn.rate.at = now; conn.rate.n = 0; }
    if (++conn.rate.n > MESSAGE_RATE) { conn.close(1008, 'too many messages'); return; }
    if (!conn.hello && m.t !== 'hello') return;
    if (m.t === 'hello') { if (conn.hello) return; conn.hello = true; }
    const h = this.handlers[m.t];
    if (!h) return;
    return Promise.resolve().then(() => h.call(this, conn, m)).catch((err) => {
      this.log.error('hub handler ' + m.t + ' failed: ' + (err && err.stack || err));
      conn.sendJson({ t: 'error', reason: 'internal' });
    });
  }

  onClose(conn) {
    if (!this.conns.has(conn)) return;
    const key = conn.user, active = key && this.activeMatches.get(key), party = conn.party;
    if (party && active && active.practice && conn.match && conn.match.id === active.id) {
      this.practicePartyReturns.set(key, { id: party.id, mode: party.mode, fill: party.fill, match: active.id, at: Date.now() });
    }
    this.conns.delete(conn);
    this.lobby.removeConn(conn);
    this.setUser(conn, null);
    // A replacement socket can authenticate before the browser finishes closing its old one.
    if (key) this.findConns(key).forEach((other) => this.restorePracticeParty(other));
  }

  tick(now) {
    this.lobby.tick(now);
    for (const [u, a] of this.activeMatches) if (now - a.at > MATCH_TTL) this.activeMatches.delete(u);
    for (const [u, a] of this.practicePartyReturns) if (now - a.at > MATCH_TTL || !this.activeMatches.has(u)) this.practicePartyReturns.delete(u);
  }

  // ---------------------------------------------------------------- presence + pushes
  pushFriends(key) {
    if (!key) return;
    const state = this.accounts.friendsState(key);
    for (const c of this.findConns(key)) c.sendJson(Object.assign({ t: 'friends' }, state));
  }
  pushFriendsAround(key) {
    this.pushFriends(key);
    for (const f of this.accounts.list(key)) this.pushFriends(f);
  }
  notify(key, text, kind) { for (const c of this.findConns(key)) c.sendJson({ t: 'notice', text, kind: kind || 'info' }); }
  setUser(conn, key) {
    if (conn.user) {
      const old = conn.user, set = this.online.get(old);
      if (set) { set.delete(conn); if (!set.size) this.online.delete(old); }
      conn.user = null;
      this.pushFriendsAround(old);
    }
    if (key) {
      conn.user = key;
      if (!this.online.has(key)) this.online.set(key, new Set());
      this.online.get(key).add(conn);
      conn.name = this.accounts.user(key).name;
      this.restorePracticeParty(conn);
      this.pushFriendsAround(key);
    }
  }
  guestName(wanted) {
    const clean = String(wanted || '').replace(/[^A-Za-z0-9_ ]/g, '').trim().slice(0, 16);
    return clean.length >= 2 ? clean : 'Guest' + Math.floor(1000 + Math.random() * 9000);
  }
  restorePracticeParty(conn) {
    const saved = conn.user && this.practicePartyReturns.get(conn.user), active = conn.user && this.activeMatches.get(conn.user);
    if (!saved || !active || !active.practice || saved.match !== active.id || Date.now() - saved.at > MATCH_TTL || conn.party) return;
    if (this.lobby.restorePracticeMember(conn, saved)) {
      conn.match = { id: active.id, ticket: active.ticket, practice: true };
      this.practicePartyReturns.delete(conn.user);
    }
  }
  rejoinFor(conn) {
    if (!conn.user) return null;
    const a = this.activeMatches.get(conn.user);
    return a && Date.now() - a.at < MATCH_TTL ? { id: a.id, ticket: a.ticket } : null;
  }
  welcome(conn) {
    const c = this.config;
    conn.sendJson({
      t: 'welcome', v: VERSION, user: conn.user ? this.accounts.publicUser(conn.user) : null, name: conn.name, online: this.conns.size,
      match: this.rejoinFor(conn),
      config: { google: c.googleClientId || null, apple: c.appleClientId || null, appleRedirect: c.publicUrl ? c.publicUrl.replace(/\/$/, '') + '/' : null, lobbyMin: c.lobbyMin, lobbyMax: c.lobbyMax, bots: this.lobby.botTarget() }
    });
  }
  authReply(conn, r) {
    if (r.ok && r.token) { conn.session = r.token; this.setUser(conn, r.key); }
    conn.sendJson({ t: 'auth', ok: r.ok, reason: r.reason, token: r.token, user: r.ok ? (r.user || null) : undefined, fresh: !!r.fresh, name: conn.name, match: r.ok ? this.rejoinFor(conn) : null });
    if (r.ok && r.key) this.pushFriends(r.key);
  }
  friendOp(conn, action, name, fn) {
    const r = fn(conn.user, name);
    conn.sendJson(Object.assign({ t: 'friend-result', action, name }, r));
    if (!r.ok) return;
    this.pushFriends(conn.user);
    this.pushFriends(r.to);
    if (action === 'request') this.notify(r.to, r.accepted ? conn.name + ' accepted your friend request.' : conn.name + ' sent you a friend request.', 'friend');
    if (action === 'accept') this.notify(r.to, conn.name + ' accepted your friend request.', 'friend');
  }

  // ---------------------------------------------------------------- matches
  startMatch(spec) {
    const flat = [];
    spec.teams.forEach((t) => t.members.forEach((m) => flat.push(m)));
    // Bot seats travel as { bot: true }; the match names and plays them. They get no ticket.
    const plain = { mode: spec.mode, teamSize: spec.teamSize, practice: spec.practice === true, teams: spec.teams.map((t) => ({ members: t.members.map((m) => (m.bot ? { bot: true } : { userKey: m.userKey || null, name: m.name })) })) };
    const started = Promise.resolve().then(() => this.matchHost.start(plain));
    started.then(({ id, tickets }) => {
      const users = [];
      tickets.forEach((ticket, i) => {
        const m = flat[i];
        if (!m || m.bot || !ticket) return;
        if (m.conn && m.conn.open) {
          m.conn.match = { id, ticket, practice: spec.practice === true };
          m.conn.sendJson({ t: 'match-ticket', id, ticket, mode: spec.mode, teamSize: spec.teamSize, practice: spec.practice === true });
        }
        if (m.userKey) { this.activeMatches.set(m.userKey, { id, ticket, at: Date.now(), practice: spec.practice === true }); users.push(m.userKey); }
      });
      this.matchUsers.set(id, users);
      users.forEach((u) => this.pushFriendsAround(u));
      const bots = flat.filter((m) => m.bot).length;
      if (this.log.info) this.log.info('match ' + id + ' started: ' + spec.mode + ', ' + spec.teams.length + ' teams, ' + (flat.length - bots) + ' players' + (bots ? ' + ' + bots + ' bots' : ''));
    }).catch((err) => {
      this.log.error('could not start match: ' + (err && err.stack || err));
      flat.forEach((m) => m.conn && m.conn.open && m.conn.sendJson({ t: 'lobby-error', reason: 'start-failed' }));
    });
    return started;
  }

  matchEnded(id) {
    const users = this.matchUsers.get(id) || [];
    this.matchUsers.delete(id);
    for (const [user, saved] of this.practicePartyReturns) if (saved.match === id) this.practicePartyReturns.delete(user);
    for (const u of users) {
      const a = this.activeMatches.get(u);
      if (a && a.id === id) this.activeMatches.delete(u);
    }
    for (const c of this.conns) if (c.match && c.match.id === id) c.match = null;
    users.forEach((u) => this.pushFriendsAround(u));
  }

  // ---------------------------------------------------------------- message handlers
  get handlers() {
    return HANDLERS;
  }
}

const HANDLERS = {
  hello(conn, m) {
    const token = str(m.token, 128), key = this.accounts.session(token);
    if (key) { conn.session = token; this.setUser(conn, key); }
    else conn.name = this.guestName(m.name);
    this.welcome(conn);
    if (conn.user) this.pushFriends(conn.user);
  },
  'set-name'(conn, m) {
    if (conn.user) return;
    conn.name = this.guestName(m.name);
    conn.sendJson({ t: 'name', name: conn.name });
  },
  async register(conn, m) { this.authReply(conn, await this.accounts.register({ username: str(m.username, 32), email: str(m.email, 120), password: str(m.password, 200) })); },
  async login(conn, m) { this.authReply(conn, await this.accounts.login(str(m.username, 32), str(m.password, 200))); },
  async oauth(conn, m) {
    const provider = m.provider === 'apple' ? 'apple' : 'google';
    const r = await this.accounts.oauth(provider, str(m.idToken, 8192), { name: str(m.name, 60) });
    if (!r.ok && r.detail && this.log.warn) this.log.warn(provider + ' sign-in rejected: ' + r.detail);
    this.authReply(conn, r);
  },
  'set-username'(conn, m) {
    const r = this.accounts.setUsername(conn.user, str(m.username, 32));
    if (r.ok) { this.setUser(conn, null); this.setUser(conn, r.key); }
    conn.sendJson({ t: 'auth', ok: r.ok, reason: r.reason, user: r.ok ? r.user : undefined, name: conn.name });
  },
  logout(conn) {
    this.accounts.logout(conn.session);
    conn.session = null;
    this.lobby.removeConn(conn);
    this.setUser(conn, null);
    conn.name = this.guestName('');
    conn.sendJson({ t: 'auth', ok: true, user: null, name: conn.name });
  },
  'friends-search'(conn, m) { conn.sendJson({ t: 'friends-results', q: str(m.q, 32), results: conn.user ? this.accounts.search(conn.user, str(m.q, 32)) : [] }); },
  'friend-request'(conn, m) { this.friendOp(conn, 'request', str(m.name, 32), (me, n) => this.accounts.sendRequest(me, n)); },
  'friend-accept'(conn, m) { this.friendOp(conn, 'accept', str(m.name, 32), (me, n) => this.accounts.accept(me, n)); },
  'friend-decline'(conn, m) { this.friendOp(conn, 'decline', str(m.name, 32), (me, n) => this.accounts.decline(me, n)); },
  'friend-cancel'(conn, m) { this.friendOp(conn, 'cancel', str(m.name, 32), (me, n) => this.accounts.cancel(me, n)); },
  'friend-remove'(conn, m) { this.friendOp(conn, 'remove', str(m.name, 32), (me, n) => this.accounts.remove(me, n)); },
  'party-create'(conn, m) { const r = this.lobby.createParty(conn, str(m.mode, 10)); if (!r.ok) conn.sendJson({ t: 'party-error', reason: r.reason }); },
  'party-invite'(conn, m) { const r = this.lobby.invite(conn, str(m.name, 32)); conn.sendJson({ t: 'party-result', action: 'invite', name: str(m.name, 32), ok: r.ok, reason: r.reason }); },
  'party-join'(conn, m) { const r = this.lobby.join(conn, m.id); if (!r.ok) conn.sendJson({ t: 'party-error', reason: r.reason }); },
  'party-ignore'(conn, m) { this.lobby.ignore(conn, m.id); },
  'party-leave'(conn) { this.lobby.leaveParty(conn); },
  'party-kick'(conn, m) { this.lobby.kick(conn, str(m.name, 32)); },
  'party-fill'(conn, m) { this.lobby.setFill(conn, !!m.fill); },
  queue(conn, m) { const r = this.lobby.queue(conn, str(m.mode, 10)); if (!r.ok) conn.sendJson({ t: 'lobby-error', reason: r.reason }); },
  'practice-start'(conn) { const r = this.lobby.startPractice(conn); conn.sendJson({ t: 'practice-start-result', ok: r.ok, reason: r.reason }); },
  dequeue(conn) { this.lobby.dequeue(conn); },
  'left-match'(conn) {
    conn.match = null;
    if (conn.user) { this.activeMatches.delete(conn.user); this.pushFriendsAround(conn.user); }
  },
  ping(conn, m) { conn.sendJson({ t: 'pong', c: m.c, s: Date.now() }); }
};
