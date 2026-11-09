/* warz.io: account, friends, party and lobby state as pushed by the hub. Everything here is a thin
   client over W.Net; the server owns the truth. Sessions persist in warz.session.v1. */
(function () {
  'use strict';
  var W = window.Warz, Net = W.Net;
  var TOKEN = 'warz.session.v1', GUEST = 'warz.guest.v1';
  var user = null, name = null, friendsState = { friends: [], incoming: [], outgoing: [] };
  var party = null, lobby = null, invites = [], config = { google: null, apple: null, appleRedirect: null, lobbyMin: 2, lobbyMax: 50 };
  var listeners = [], onlineCount = 0;

  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (e) { /* storage blocked */ } }
  function emit(what, data) { listeners.forEach(function (fn) { try { fn(what, data); } catch (e) { console.error('account listener', e); } }); }

  function guestName() {
    var saved = read(GUEST);
    if (saved) return saved;
    var fresh = 'Guest' + Math.floor(1000 + Math.random() * 9000);
    write(GUEST, fresh);
    return fresh;
  }

  Net.on('welcome', function (m) {
    user = m.user || null;
    name = m.name || (user ? user.name : guestName());
    if (!user && read(TOKEN)) write(TOKEN, null); // the server rejected a stale session
    if (m.config) config = Object.assign(config, m.config);
    onlineCount = m.online || 0;
    if (!user) friendsState = { friends: [], incoming: [], outgoing: [] };
    emit('welcome');
    if (m.match) emit('rejoin', m.match);
  });
  Net.on('auth', function (m) {
    if (!m.ok) return;
    if (m.token) write(TOKEN, m.token);
    if (m.user === null) { user = null; write(TOKEN, null); friendsState = { friends: [], incoming: [], outgoing: [] }; party = null; }
    else if (m.user) user = m.user;
    if (m.name) name = m.name;
    emit('auth');
    if (m.match) emit('rejoin', m.match);
  });
  Net.on('name', function (m) { name = m.name; emit('name'); });
  Net.on('friends', function (m) { friendsState = { friends: m.friends || [], incoming: m.incoming || [], outgoing: m.outgoing || [] }; emit('friends'); });
  Net.on('party', function (m) { party = m.party || null; emit('party'); });
  Net.on('party-invited', function (m) {
    invites = invites.filter(function (i) { return i.id !== m.id; });
    invites.push({ id: m.id, from: m.from, mode: m.mode, size: m.size, at: Date.now() });
    emit('invite');
  });
  Net.on('lobby', function (m) { lobby = m.lobby || null; emit('lobby'); });
  Net.on('net-status', function (m) {
    if (m.status !== 'online') { party = null; lobby = null; invites = []; }
    emit('status');
  });

  function authRequest(msg) {
    return Net.request(msg, 'auth', 15000).then(function (r) {
      if (r.ok && r.user) { user = r.user; name = r.user.name; emit('auth'); }
      return r;
    });
  }

  W.Account = {
    current: function () { return user; },
    name: function () { return name || (user ? user.name : guestName()); },
    config: function () { return config; },
    onlineCount: function () { return onlineCount; },
    isOnline: function () { return Net.online(); },
    token: function () { return read(TOKEN); },
    hello: function () { return { token: read(TOKEN) || undefined, name: guestName() }; },
    setGuestName: function (n) {
      n = String(n || '').trim().slice(0, 16);
      if (!n) return;
      write(GUEST, n);
      if (!user) { name = n; Net.send({ t: 'set-name', name: n }); emit('name'); }
    },
    register: function (o) { return authRequest({ t: 'register', username: o.username, email: o.email, password: o.password }); },
    signIn: function (u, p) { return authRequest({ t: 'login', username: u, password: p }); },
    oauth: function (provider, idToken, hint) { return authRequest({ t: 'oauth', provider: provider, idToken: idToken, name: hint || '' }); },
    setUsername: function (n) { return authRequest({ t: 'set-username', username: n }); },
    signOut: function () { Net.send({ t: 'logout' }); user = null; write(TOKEN, null); friendsState = { friends: [], incoming: [], outgoing: [] }; party = null; emit('auth'); },
    leftMatch: function () { Net.send({ t: 'left-match' }); },
    friends: function () { return friendsState.friends; },
    incoming: function () { return friendsState.incoming; },
    outgoing: function () { return friendsState.outgoing; },
    search: function (q) { return Net.request({ t: 'friends-search', q: q }, 'friends-results', 6000).then(function (r) { return r.results || []; }); },
    sendRequest: function (n) { return Net.request({ t: 'friend-request', name: n }, 'friend-result', 6000); },
    accept: function (n) { return Net.request({ t: 'friend-accept', name: n }, 'friend-result', 6000); },
    decline: function (n) { return Net.request({ t: 'friend-decline', name: n }, 'friend-result', 6000); },
    cancel: function (n) { return Net.request({ t: 'friend-cancel', name: n }, 'friend-result', 6000); },
    removeFriend: function (n) { return Net.request({ t: 'friend-remove', name: n }, 'friend-result', 6000); },
    onChange: function (fn) { listeners.push(fn); return fn; }
  };

  W.Party = {
    current: function () { return party; },
    invites: function () { return invites; },
    create: function (mode) { Net.send({ t: 'party-create', mode: mode }); },
    invite: function (n) { return Net.request({ t: 'party-invite', name: n }, 'party-result', 6000); },
    join: function (id) { invites = invites.filter(function (i) { return i.id !== id; }); Net.send({ t: 'party-join', id: id }); emit('invite'); },
    ignore: function (id) { invites = invites.filter(function (i) { return i.id !== id; }); Net.send({ t: 'party-ignore', id: id }); emit('invite'); },
    leave: function () { if (party) Net.send({ t: 'party-leave' }); party = null; emit('party'); },
    kick: function (n) { Net.send({ t: 'party-kick', name: n }); },
    setFill: function (v) { Net.send({ t: 'party-fill', fill: !!v }); }
  };

  W.Lobby = {
    current: function () { return lobby; },
    queue: function (mode) { Net.send({ t: 'queue', mode: mode }); },
    leave: function () { Net.send({ t: 'dequeue' }); lobby = null; emit('lobby'); }
  };
}());
