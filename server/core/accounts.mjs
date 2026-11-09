// Accounts, sessions and friends over a store that exposes `data` and `save()`. Pure logic: no sockets.
import { hashPassword, verifyPassword, newToken } from './auth.mjs';

const SESSION_DAYS = 90;

export function usernameFrom(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const s = String(c).split('@')[0].replace(/[^A-Za-z0-9_]/g, '');
    if (s.length >= 3) return s.slice(0, 14);
  }
  return 'player' + Math.floor(1000 + Math.random() * 9000);
}

export class Accounts {
  constructor(store, { verifiers = {}, presence = null } = {}) {
    this.store = store;
    this.data = store.data;
    this.verifiers = verifiers;
    this.presence = presence; // (userKey) -> { online, inMatch }
    this.pruneSessions();
  }

  key(name) { return String(name || '').trim().toLowerCase(); }
  validUsername(name) { return /^[A-Za-z0-9_]{3,16}$/.test(String(name || '').trim()); }
  validEmail(email) { return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
  user(key) { return this.data.users[key] || null; }
  save() { this.store.save(); }
  publicUser(key) {
    const u = this.user(key);
    return u ? { name: u.name, email: u.email || '', created: u.created, provisional: !!u.provisional, google: !!u.google, apple: !!u.apple, hasPassword: !!u.pass } : null;
  }

  // ---------------------------------------------------------------- sign up / sign in
  async register({ username, email, password }) {
    const name = String(username || '').trim(), key = this.key(name);
    if (!this.validUsername(name)) return { ok: false, reason: 'username' };
    if (this.data.users[key]) return { ok: false, reason: 'taken' };
    email = String(email || '').trim();
    if (!this.validEmail(email)) return { ok: false, reason: 'email' };
    if (!password || String(password).length < 6) return { ok: false, reason: 'password' };
    const pass = await hashPassword(String(password));
    if (this.data.users[key]) return { ok: false, reason: 'taken' };
    this.data.users[key] = { name, email, created: Date.now(), pass, google: null, apple: null, provisional: false };
    return this.finish(key);
  }

  async login(username, password) {
    const key = this.key(username), u = this.user(key);
    if (!u) return { ok: false, reason: 'nouser' };
    if (!u.pass) return { ok: false, reason: 'nopassword' };
    if (!(await verifyPassword(String(password || ''), u.pass))) return { ok: false, reason: 'password' };
    return this.finish(key);
  }

  // Google / Apple: the ID token is verified against the provider's keys; the account is keyed by `sub`.
  async oauth(provider, idToken, hint) {
    const verify = this.verifiers[provider];
    if (!verify) return { ok: false, reason: 'provider-disabled' };
    let payload;
    try { payload = await verify(idToken); } catch (e) { return { ok: false, reason: 'token', detail: e.message }; }
    const links = this.data.providers[provider] || (this.data.providers[provider] = {});
    let key = links[payload.sub];
    if (key && this.user(key)) return this.finish(key);
    const name = this.uniqueName(usernameFrom(hint && hint.name, payload.email, payload.name));
    key = this.key(name);
    const record = { name, email: payload.email || '', created: Date.now(), pass: null, google: null, apple: null, provisional: true };
    record[provider] = payload.sub;
    this.data.users[key] = record;
    links[payload.sub] = key;
    return this.finish(key, { fresh: true });
  }

  uniqueName(base) {
    let name = base, n = 1;
    while (this.data.users[this.key(name)]) name = base.slice(0, 12) + (++n);
    return name;
  }

  // A provider-created account may pick its username once.
  setUsername(key, username) {
    const u = this.user(key);
    if (!u) return { ok: false, reason: 'signin' };
    if (!u.provisional) return { ok: false, reason: 'locked' };
    const name = String(username || '').trim(), k2 = this.key(name);
    if (!this.validUsername(name)) return { ok: false, reason: 'username' };
    if (k2 !== key && this.data.users[k2]) return { ok: false, reason: 'taken' };
    if (k2 !== key) {
      this.data.users[k2] = u;
      delete this.data.users[key];
      this.data.friends[k2] = this.data.friends[key] || [];
      delete this.data.friends[key];
      for (const list of Object.values(this.data.friends)) { const i = list.indexOf(key); if (i >= 0) list[i] = k2; }
      this.data.requests.forEach((r) => { if (r.from === key) r.from = k2; if (r.to === key) r.to = k2; });
      for (const s of Object.values(this.data.sessions)) if (s.user === key) s.user = k2;
      for (const prov of Object.values(this.data.providers)) for (const sub of Object.keys(prov)) if (prov[sub] === key) prov[sub] = k2;
    }
    u.name = name;
    u.provisional = false;
    this.save();
    return { ok: true, key: k2, user: this.publicUser(k2) };
  }

  finish(key, extra) {
    const token = newToken();
    this.data.sessions[token] = { user: key, created: Date.now(), seen: Date.now() };
    this.save();
    return Object.assign({ ok: true, token, key, user: this.publicUser(key) }, extra || {});
  }
  session(token) {
    const s = token && this.data.sessions[token];
    if (!s || !this.user(s.user)) return null;
    if (Date.now() - (s.seen || 0) > 60 * 1000) { s.seen = Date.now(); this.save(); }
    return s.user;
  }
  logout(token) { if (token && this.data.sessions[token]) { delete this.data.sessions[token]; this.save(); } }
  pruneSessions() {
    const cutoff = Date.now() - SESSION_DAYS * 86400000;
    let changed = false;
    for (const [t, s] of Object.entries(this.data.sessions)) {
      if (!s.seen || s.seen < cutoff || !this.user(s.user)) { delete this.data.sessions[t]; changed = true; }
    }
    if (changed) this.save();
  }

  // ---------------------------------------------------------------- friends
  list(key) { return this.data.friends[key] || (this.data.friends[key] = []); }
  hasRequest(from, to) { return this.data.requests.some((r) => r.from === from && r.to === to); }
  dropRequest(from, to) { this.data.requests = this.data.requests.filter((r) => !(r.from === from && r.to === to)); }
  relation(me, other) {
    if (!me || me === other) return 'self';
    if (this.list(me).includes(other)) return 'friend';
    if (this.hasRequest(me, other)) return 'outgoing';
    if (this.hasRequest(other, me)) return 'incoming';
    return 'none';
  }
  status(key) { return this.presence ? this.presence(key) : { online: false, inMatch: false }; }
  entry(key) { const u = this.user(key); return Object.assign({ name: u ? u.name : key }, this.status(key)); }
  friendsState(key) {
    if (!key) return { friends: [], incoming: [], outgoing: [] };
    return {
      friends: this.list(key).map((k) => this.entry(k)),
      incoming: this.data.requests.filter((r) => r.to === key).map((r) => this.entry(r.from)),
      outgoing: this.data.requests.filter((r) => r.from === key).map((r) => this.entry(r.to))
    };
  }
  search(me, query) {
    const q = this.key(query);
    if (!q) return [];
    return Object.keys(this.data.users)
      .filter((k) => k.includes(q) && k !== me)
      .sort((a, b) => (a === q ? -1 : b === q ? 1 : a.localeCompare(b)))
      .slice(0, 8)
      .map((k) => Object.assign({ name: this.user(k).name, relation: this.relation(me, k) }, this.status(k)));
  }
  sendRequest(me, name) {
    const to = this.key(name);
    if (!me) return { ok: false, reason: 'signin' };
    if (!this.user(to)) return { ok: false, reason: 'nouser' };
    const rel = this.relation(me, to);
    if (rel === 'self') return { ok: false, reason: 'self' };
    if (rel === 'friend') return { ok: false, reason: 'friends' };
    if (rel === 'outgoing') return { ok: false, reason: 'pending' };
    if (rel === 'incoming') { this.accept(me, name); return { ok: true, accepted: true, to }; }
    this.data.requests.push({ from: me, to, at: Date.now() });
    this.save();
    return { ok: true, to };
  }
  accept(me, name) {
    const from = this.key(name);
    if (!me || !this.hasRequest(from, me)) return { ok: false, reason: 'gone' };
    this.dropRequest(from, me);
    this.dropRequest(me, from);
    if (!this.list(me).includes(from)) this.list(me).push(from);
    if (!this.list(from).includes(me)) this.list(from).push(me);
    this.save();
    return { ok: true, to: from };
  }
  decline(me, name) {
    const from = this.key(name);
    if (!me || !this.hasRequest(from, me)) return { ok: false, reason: 'gone' };
    this.dropRequest(from, me);
    this.save();
    return { ok: true, to: from };
  }
  cancel(me, name) {
    const to = this.key(name);
    if (!me || !this.hasRequest(me, to)) return { ok: false, reason: 'gone' };
    this.dropRequest(me, to);
    this.save();
    return { ok: true, to };
  }
  remove(me, name) {
    const other = this.key(name);
    if (!me) return { ok: false, reason: 'signin' };
    this.data.friends[me] = this.list(me).filter((k) => k !== other);
    this.data.friends[other] = this.list(other).filter((k) => k !== me);
    this.save();
    return { ok: true, to: other };
  }
}
