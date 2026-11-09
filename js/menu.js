/* warz.io: menu dialogs. Mode picker, team (party) screen, matchmaking lobby, Settings
   (Controls / Sound / Online / Account with Google and Apple sign-in) and Friends. One dialog is open at a time. */
(function () {
  'use strict';
  var W = window.Warz, Controls = W.Controls, Account = W.Account, Party = W.Party, Lobby = W.Lobby, Net = W.Net;
  var DIALOGS = ['mode-dialog', 'party-dialog', 'lobby-dialog', 'settings-dialog', 'friends-dialog'];
  var opts = {}, capture = null, lastQuery = '', lastResults = null, googleLoading = false, appleLoading = false, appleReady = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function initial(name) { return esc(String(name || '?').charAt(0).toUpperCase()); }
  function avatar(name) { return '<span class="avatar" aria-hidden="true">' + initial(name) + '</span>'; }
  function status(id, text) { var node = $(id); if (node) node.textContent = text || ''; }
  function isOpen(id) { return !$(id).hidden; }
  function online() { return Net.online(); }
  function inMatch() { return !!(opts.inMatch && opts.inMatch()); }

  var REASONS = {
    username: 'Usernames are 3–16 letters, numbers or underscores.',
    taken: 'That username is already taken.',
    email: 'That email address doesn’t look right.',
    password: 'Passwords need at least 6 characters.',
    nouser: 'No account with that username.',
    nopassword: 'That account signs in with Google or Apple.',
    mismatch: 'Those passwords don’t match.',
    offline: 'You’re offline. Check the server address under Settings › Online.',
    timeout: 'The server didn’t answer in time.',
    token: 'The sign-in token was rejected by the server.',
    'provider-disabled': 'That sign-in method isn’t set up on this server.',
    locked: 'Your username is already set.',
    signin: 'Sign in first.',
    self: 'That’s you.',
    friends: 'You are already friends.',
    pending: 'You already sent that request.',
    gone: 'That request is gone.',
    leader: 'Only the team leader can do that.',
    full: 'The team is full.',
    member: 'They are already on the team.',
    notinvited: 'That invite expired.',
    inmatch: 'Finish or leave your current match first.',
    'start-failed': 'The server could not start the match. Try again.'
  };
  function reason(r) { return REASONS[r] || 'Something went wrong (' + r + ').'; }

  // ---------------------------------------------------------------- dialog plumbing
  function anyOpen() { return DIALOGS.some(isOpen); }
  function openDialog(id) {
    DIALOGS.forEach(function (d) { if (d !== id) $(d).hidden = true; });
    stopCapture();
    $(id).hidden = false;
    var first = $(id).querySelector('[data-autofocus]') || $(id).querySelector('input, button:not([disabled]):not(.modal-close)');
    if (first && first.focus) first.focus();
  }
  // silent: a match is starting, so leave the party and queue state alone.
  function closeDialogs(silent) {
    var was = anyOpen();
    if (!silent) {
      if (isOpen('party-dialog') && Party.current()) Party.leave();
      if (isOpen('lobby-dialog') && Lobby.current()) Lobby.leave();
    }
    DIALOGS.forEach(function (d) { $(d).hidden = true; });
    stopCapture();
    if (was && opts.onClose) opts.onClose();
  }
  function closeTop() {
    if (capture) { stopCapture(); status('bind-status', 'Cancelled.'); renderBindings(); return true; }
    if (isOpen('party-dialog')) { Party.leave(); openModePicker(); return true; }
    if (isOpen('lobby-dialog')) { Lobby.leave(); openModePicker(); return true; }
    if (!anyOpen()) return false;
    closeDialogs();
    return true;
  }

  // ---------------------------------------------------------------- mode picker
  function dots(n) {
    var s = '';
    for (var i = 0; i < 4; i++) s += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    return s;
  }
  function modeName(id) { var m = W.MODES.filter(function (x) { return x.id === id; })[0]; return m ? m.name : id; }
  function renderModes() {
    var on = online(), party = Party.current();
    $('mode-list').innerHTML = W.MODES.map(function (m) {
      return '<button type="button" class="mode" data-mode="' + m.id + '"' + (on ? '' : ' disabled') + '><span class="mode-dots" aria-hidden="true">' + dots(m.size) + '</span>' +
        '<b>' + m.name + '</b><small>' + m.blurb + '</small></button>';
    }).join('');
    $('mode-offline-note').hidden = on;
    $('mode-team-row').hidden = !(on && party);
    if (on && party) {
      var others = party.members.filter(function (m) { return m.name !== party.you; }).map(function (m) { return m.name; });
      $('mode-team-text').textContent = 'You’re in a ' + modeName(party.mode) + ' team' + (others.length ? ' with ' + others.join(', ') : '') + '.';
    }
    var cfg = Account.config();
    $('mode-online-note').textContent = on ? 'Online as ' + Account.name() + ' · ' + Account.onlineCount() + ' online · matches start with ' + cfg.lobbyMin + '+ players, up to ' + cfg.lobbyMax + '.' : '';
  }
  function openModePicker() {
    renderModes();
    status('mode-status', '');
    openDialog('mode-dialog');
  }
  function chooseMode(id) {
    if (!online()) { status('mode-status', reason('offline')); return; }
    var mode = W.MODES.filter(function (m) { return m.id === id; })[0], party = Party.current();
    if (!mode) return;
    if (mode.size === 1) {
      if (party) Party.leave(); // Solo means solo: step out of the team first
      Lobby.queue('solo');
      openLobby();
      return;
    }
    if (party && party.mode === id) { renderParty(); openDialog('party-dialog'); return; }
    Party.create(id); // the server leaves any other team for us
    renderParty();
    openDialog('party-dialog');
  }
  function startPractice() { closeDialogs(true); if (opts.onPractice) opts.onPractice(); }

  // ---------------------------------------------------------------- lobby (solo queue)
  function openLobby() { renderLobby(); openDialog('lobby-dialog'); }
  function lobbyLine(l) {
    if (!l) return 'Joining the queue…';
    if (l.count < l.min) return 'Waiting for ' + (l.min - l.count) + ' more player' + (l.min - l.count === 1 ? '' : 's') + ' (matches start with ' + l.min + ').';
    if (l.countdown !== null && l.countdown !== undefined) return 'Starting in ' + l.countdown + ' s. More players can still drop in.';
    return 'Starting…';
  }
  function renderLobby() {
    var l = Lobby.current();
    $('lobby-count').textContent = l ? String(l.count) : '–';
    $('lobby-max').textContent = '/ ' + (l ? l.max : Account.config().lobbyMax) + ' players';
    $('lobby-fill').style.width = l ? Math.min(100, l.count / l.max * 100).toFixed(1) + '%' : '0%';
    $('lobby-note').textContent = lobbyLine(l);
    $('lobby-title').textContent = l && l.count >= l.min ? 'Match starting' : 'Finding a match';
  }

  // ---------------------------------------------------------------- party (team) screen
  function renderParty() {
    var party = Party.current(), me = Account.name(), modeName = function (id) { var m = W.MODES.filter(function (x) { return x.id === id; })[0]; return m ? m.name : id; };
    if (!party) {
      $('party-eyebrow').textContent = 'Team';
      $('party-slots').innerHTML = '<div class="party-slot is-empty"><span class="avatar" aria-hidden="true">…</span><b>Creating your team</b><small>One moment</small></div>';
      $('party-friends').innerHTML = '';
      $('party-status').textContent = '';
      $('party-start').disabled = true;
      return;
    }
    var leader = party.members.some(function (m) { return m.leader && m.name === party.you; });
    $('party-eyebrow').textContent = modeName(party.mode) + ' · teams of ' + party.size;
    var slots = party.members.map(function (m) {
      return '<div class="party-slot' + (m.name === party.you ? ' is-you' : '') + '">' + avatar(m.name) + '<b>' + esc(m.name) + '</b><small>' + (m.leader ? 'Team leader' : 'Teammate') + '</small>' +
        (leader && !m.leader ? '<button type="button" class="mini" data-kick="' + esc(m.name) + '" aria-label="Remove ' + esc(m.name) + '">×</button>' : '') + '</div>';
    });
    party.invited.forEach(function (n) {
      slots.push('<div class="party-slot is-invited">' + avatar(n) + '<b>' + esc(n) + '</b><small>Invited · waiting</small>' +
        (leader ? '<button type="button" class="mini" data-kick="' + esc(n) + '" aria-label="Cancel invite for ' + esc(n) + '">×</button>' : '') + '</div>');
    });
    for (var i = slots.length; i < party.size; i++) {
      slots.push('<div class="party-slot is-empty"><span class="avatar" aria-hidden="true">' + (party.fill ? '?' : '+') + '</span><b>' +
        (party.fill ? 'Random player' : 'Open spot') + '</b><small>' + (party.fill ? 'Filled by matchmaking' : 'Invite a friend below') + '</small></div>');
    }
    $('party-slots').innerHTML = slots.join('');
    $('party-fill').checked = party.fill;
    $('party-fill').disabled = !leader;
    var friends = Account.current() ? Account.friends() : [], room = party.members.length + party.invited.length < party.size;
    $('party-friends').innerHTML = !Account.current()
      ? '<li class="friend-row is-muted"><span>Sign in to invite friends. Random fill still works.</span><button type="button" class="mini mini-go" data-open-account>Sign in</button></li>'
      : !friends.length
        ? '<li class="friend-row is-muted"><span>No friends yet. Add some with the Friends button on the main menu.</span></li>'
        : friends.map(function (f) {
          var inTeam = party.members.some(function (m) { return m.name === f.name; }), invited = party.invited.indexOf(f.name) >= 0;
          var action = inTeam ? '<span class="tag">In team</span>' : invited ? '<span class="tag">Invited</span>'
            : !f.online ? '<span class="tag is-off">Offline</span>' : f.inMatch ? '<span class="tag is-off">In a match</span>'
            : '<button type="button" class="mini mini-go" data-invite="' + esc(f.name) + '"' + (leader && room ? '' : ' disabled') + '>Invite</button>';
          return '<li class="friend-row">' + avatar(f.name) + '<b>' + esc(f.name) + '</b><small>' + (f.online ? (f.inMatch ? 'In a match' : 'Online') : 'Offline') + '</small>' + action + '</li>';
        }).join('');
    var l = Lobby.current(), start = $('party-start');
    if (party.queued) {
      $('party-status').textContent = l ? 'In queue · ' + l.count + '/' + l.max + ' players · ' + lobbyLine(l) : 'In queue…';
      start.textContent = leader ? 'Leave queue' : 'In queue…';
    } else {
      $('party-status').textContent = leader ? '' : 'Waiting for ' + party.leader + ' to find a match.';
      start.textContent = leader ? 'Find match' : 'Waiting for the leader';
    }
    start.disabled = !leader;
    $('party-note').textContent = party.fill ? 'Empty spots get random players. Turn off fill to play with your invites only.' : 'Fill is off: only invited players join your team.';
  }
  function partyStart() {
    var party = Party.current();
    if (!party) return;
    if (party.queued) Lobby.leave(); else Lobby.queue(party.mode);
  }

  // ---------------------------------------------------------------- invites (toasts)
  function renderInvites() {
    var list = Party.invites();
    $('invites').innerHTML = list.map(function (i) {
      var m = W.MODES.filter(function (x) { return x.id === i.mode; })[0];
      return '<div class="invite" data-id="' + i.id + '">' + avatar(i.from) + '<div><b>' + esc(i.from) + '</b><small>invited you to ' + (m ? m.name : i.mode) + '</small></div>' +
        '<button type="button" class="mini mini-go" data-join="' + i.id + '">Join</button><button type="button" class="mini" data-ignore="' + i.id + '">Ignore</button></div>';
    }).join('');
  }

  // ---------------------------------------------------------------- settings
  function openSettings(tab) {
    openDialog('settings-dialog');
    showTab(tab || 'controls');
  }
  function showTab(name) {
    Array.prototype.forEach.call($('settings-dialog').querySelectorAll('[role="tab"]'), function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    ['controls', 'sound', 'online', 'account'].forEach(function (id) { $('tab-' + id).hidden = id !== name; });
    status('bind-status', '');
    status('account-status', '');
    if (name === 'controls') renderBindings();
    if (name === 'account') renderAccount();
    if (name === 'sound') syncSound();
    if (name === 'online') renderOnline();
  }
  function renderBindings() {
    var groups = {}, order = [];
    Controls.ACTIONS.forEach(function (a) {
      if (!groups[a.group]) { groups[a.group] = []; order.push(a.group); }
      groups[a.group].push(a);
    });
    var html = order.map(function (g) {
      return '<h4>' + g + '</h4>' + groups[g].map(function (a) {
        var b = Controls.bindings(a.id);
        return '<div class="bind-row"><span>' + a.name + '</span>' + [0, 1].map(function (i) {
          return '<button type="button" class="bind' + (b[i] ? '' : ' is-empty') + '" data-bind="' + a.id + '" data-slot="' + i + '" aria-label="' +
            a.name + ', ' + (i ? 'secondary' : 'primary') + ' binding: ' + esc(Controls.label(b[i])) + '. Select to change.">' + esc(Controls.label(b[i])) + '</button>';
        }).join('') + '</div>';
      }).join('');
    }).join('');
    html += '<h4>Fixed</h4><div class="bind-row is-fixed"><span>Match menu / close</span><button type="button" class="bind" disabled>Esc</button><button type="button" class="bind is-empty" disabled>—</button></div>';
    $('bindings').innerHTML = html;
  }
  function startCapture(btn) {
    stopCapture();
    capture = { action: btn.getAttribute('data-bind'), slot: Number(btn.getAttribute('data-slot')), btn: btn };
    btn.classList.add('is-listening');
    btn.textContent = 'Press a key…';
    status('bind-status', 'Press a key or mouse button for ' + Controls.actionName(capture.action) + '. Backspace clears it, Esc cancels.');
    window.addEventListener('keydown', onCaptureKey, true);
    window.addEventListener('mousedown', onCaptureMouse, true);
    window.addEventListener('contextmenu', swallow, true);
  }
  function stopCapture() {
    if (!capture) return;
    capture.btn.classList.remove('is-listening');
    capture = null;
    window.removeEventListener('keydown', onCaptureKey, true);
    window.removeEventListener('mousedown', onCaptureMouse, true);
    window.removeEventListener('contextmenu', swallow, true);
  }
  function swallow(e) { e.preventDefault(); e.stopPropagation(); }
  function finishCapture(code) {
    var c = capture;
    stopCapture();
    if (!c) return;
    var freed = Controls.rebind(c.action, c.slot, code), name = Controls.actionName(c.action);
    renderBindings();
    if (!code) status('bind-status', name + ' binding cleared.');
    else {
      var lost = freed.filter(function (id) { return id !== c.action; }).map(Controls.actionName);
      status('bind-status', name + ' is now ' + Controls.label(code) + (lost.length ? '. Removed from ' + lost.join(', ') + '.' : '.'));
    }
    if (opts.onBindingsChanged) opts.onBindingsChanged();
    var again = $('settings-dialog').querySelector('[data-bind="' + c.action + '"][data-slot="' + c.slot + '"]');
    if (again) again.focus();
  }
  function onCaptureKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') { stopCapture(); renderBindings(); status('bind-status', 'Cancelled.'); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') { finishCapture(null); return; }
    finishCapture(e.code);
  }
  function onCaptureMouse(e) {
    e.preventDefault();
    e.stopPropagation();
    finishCapture('Mouse' + (e.button + 1));
  }
  function syncSound() { var toggle = $('sound-toggle'); if (toggle) toggle.checked = !Controls.muted(); }

  function renderOnline() {
    var input = $('server-url');
    if (document.activeElement !== input) input.value = Net.url();
    var s = Net.status(), text;
    if (s === 'online') text = 'Online as ' + Account.name() + ' · ' + Account.onlineCount() + ' player' + (Account.onlineCount() === 1 ? '' : 's') + ' connected · ping ' + Net.latency() + ' ms';
    else if (s === 'connecting') text = 'Connecting to ' + Net.url() + '…';
    else text = 'Offline. No server answered at ' + Net.url() + (Net.lastError() ? ' (' + Net.lastError() + ')' : '') + '.';
    $('server-status').textContent = text;
    $('server-status').className = 'status-line' + (s === 'online' ? '' : ' is-warn');
  }

  // ---------------------------------------------------------------- account
  function renderAccount() {
    var on = online(), me = Account.current();
    $('account-offline').hidden = on;
    $('account-signed-out').hidden = !(on && !me);
    $('account-provisional').hidden = !(on && me && me.provisional);
    $('account-signed-in').hidden = !(on && me && !me.provisional);
    if (on && !me) {
      var guest = $('guest-name');
      if (document.activeElement !== guest) guest.value = Account.name();
      setupGoogle();
      setupApple();
    }
    if (on && me && me.provisional) {
      var field = $('username-form').elements.username;
      if (document.activeElement !== field && !field.value) field.value = me.name;
    }
    if (on && me && !me.provisional) {
      $('account-avatar').textContent = String(me.name).charAt(0).toUpperCase();
      $('account-name').textContent = me.name;
      $('account-email').textContent = me.email ? me.email : 'No email added';
      $('account-since').textContent = 'Account created ' + new Date(me.created).toLocaleDateString();
      var ways = [];
      if (me.hasPassword) ways.push('password');
      if (me.google) ways.push('Google');
      if (me.apple) ways.push('Apple');
      $('account-providers').textContent = 'Signs in with ' + (ways.join(', ') || 'this device');
    }
    syncChips();
  }
  function syncChips() {
    var me = Account.current(), chip = $('account-chip'), badge = $('friends-badge'), net = $('net-chip'), s = Net.status();
    if (chip) chip.innerHTML = me ? avatar(me.name) + '<span>' + esc(me.name) + '</span>' : '<span>' + (s === 'online' ? esc(Account.name()) + ' · Sign in' : 'Sign in') + '</span>';
    if (badge) {
      var n = me ? Account.incoming().length : 0;
      badge.hidden = n === 0;
      badge.textContent = String(n);
    }
    if (net) {
      net.className = 'net-chip is-' + s;
      net.textContent = s === 'online' ? 'Online · ' + Account.onlineCount() : s === 'connecting' ? 'Connecting…' : 'Offline';
      net.title = s === 'online' ? 'Connected to ' + Net.url() : 'No server at ' + Net.url() + '. Change it under Settings › Online.';
    }
  }
  function fieldValue(form, name) { var f = form.elements[name]; return f ? f.value : ''; }
  function afterAuth(r, ok) {
    if (!r.ok) { status('account-status', r.reason === 'password' ? 'Wrong password.' : reason(r.reason)); return false; }
    renderAccount();
    if (r.fresh) status('account-status', 'Welcome! Pick the username other players will see.');
    else status('account-status', ok);
    if (opts.onAccountChanged) opts.onAccountChanged();
    return true;
  }
  function onCreate(e) {
    e.preventDefault();
    var form = e.target;
    if (fieldValue(form, 'password') !== fieldValue(form, 'confirm')) { status('account-status', REASONS.mismatch); return; }
    status('account-status', 'Creating your account…');
    Account.register({ username: fieldValue(form, 'username'), email: fieldValue(form, 'email'), password: fieldValue(form, 'password') }).then(function (r) {
      if (afterAuth(r, 'Welcome, ' + (r.user ? r.user.name : '') + '! You are signed in.')) form.reset();
    });
  }
  function onSignIn(e) {
    e.preventDefault();
    var form = e.target;
    status('account-status', 'Signing in…');
    Account.signIn(fieldValue(form, 'username'), fieldValue(form, 'password')).then(function (r) {
      if (afterAuth(r, 'Signed in as ' + (r.user ? r.user.name : '') + '.')) form.reset();
    });
  }
  function onUsername(e) {
    e.preventDefault();
    Account.setUsername(fieldValue(e.target, 'username')).then(function (r) { afterAuth(r, 'Username saved. Have fun, ' + (r.user ? r.user.name : '') + '!'); });
  }
  function onGuest(e) {
    e.preventDefault();
    Account.setGuestName($('guest-name').value);
    status('account-status', 'Playing as ' + Account.name() + '. Create an account to keep friends and stats.');
    syncChips();
  }
  function signOut() {
    Account.signOut();
    renderAccount();
    status('account-status', 'Signed out.');
    if (opts.onAccountChanged) opts.onAccountChanged();
  }

  // Google Identity Services: the button comes from Google; the ID token goes to our server for verification.
  function loadScript(src, onload) {
    var s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    s.onload = onload;
    s.onerror = function () { s.failed = true; renderAccount(); };
    document.head.appendChild(s);
    return s;
  }
  function setupGoogle() {
    var cfg = Account.config(), box = $('google-button'), note = $('google-note');
    if (!cfg.google) {
      box.innerHTML = '<button type="button" class="sso-btn" disabled>Continue with Google</button>';
      note.textContent = 'Google sign-in isn’t set up on this server yet: add GOOGLE_CLIENT_ID (see README).';
      return;
    }
    if (window.google && window.google.accounts) {
      note.textContent = '';
      window.google.accounts.id.initialize({ client_id: cfg.google, callback: onGoogleCredential, ux_mode: 'popup', auto_select: false });
      box.innerHTML = '';
      window.google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 280 });
      return;
    }
    box.innerHTML = '<button type="button" class="sso-btn" disabled>Continue with Google</button>';
    if (googleLoading && googleLoading.failed) { note.textContent = 'Could not load Google sign-in. Check your connection and reload.'; return; }
    note.textContent = 'Loading Google sign-in…';
    if (!googleLoading) googleLoading = loadScript('https://accounts.google.com/gsi/client', function () { if (isOpen('settings-dialog')) renderAccount(); });
  }
  function onGoogleCredential(resp) {
    status('account-status', 'Checking with the server…');
    Account.oauth('google', resp.credential).then(function (r) { afterAuth(r, 'Signed in with Google as ' + (r.user ? r.user.name : '') + '.'); });
  }
  // Sign in with Apple needs an https page and a registered Services ID.
  function setupApple() {
    var cfg = Account.config(), box = $('apple-button'), note = $('apple-note');
    var why = !cfg.apple ? 'Apple sign-in isn’t set up on this server yet: add APPLE_CLIENT_ID and PUBLIC_URL (see README).'
      : location.protocol !== 'https:' ? 'Apple sign-in only works on an https address.' : '';
    box.innerHTML = '<button type="button" id="apple-signin" class="sso-btn sso-apple"' + (why ? ' disabled' : '') + '> Continue with Apple</button>';
    note.textContent = why;
    if (why) return;
    if (!window.AppleID) {
      note.textContent = 'Loading Apple sign-in…';
      $('apple-signin').disabled = true;
      if (!appleLoading) appleLoading = loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js', function () { if (isOpen('settings-dialog')) renderAccount(); });
      return;
    }
    if (!appleReady) {
      window.AppleID.auth.init({ clientId: cfg.apple, scope: 'name email', redirectURI: cfg.appleRedirect, usePopup: true });
      appleReady = true;
    }
    $('apple-signin').addEventListener('click', function () {
      status('account-status', 'Waiting for Apple…');
      window.AppleID.auth.signIn().then(function (res) {
        var name = res.user && res.user.name ? [res.user.name.firstName, res.user.name.lastName].filter(Boolean).join(' ') : '';
        return Account.oauth('apple', res.authorization.id_token, name).then(function (r) { afterAuth(r, 'Signed in with Apple as ' + (r.user ? r.user.name : '') + '.'); });
      }).catch(function (err) { status('account-status', 'Apple sign-in was cancelled' + (err && err.error ? ' (' + err.error + ')' : '') + '.'); });
    });
  }

  // ---------------------------------------------------------------- friends
  function openFriends() {
    lastQuery = '';
    lastResults = null;
    $('friend-query').value = '';
    status('friends-status', '');
    openDialog('friends-dialog');
    renderFriends();
    if (!$('friends-signed-in').hidden) $('friend-query').focus();
  }
  function row(name, sub, actions, cls) { return '<li class="friend-row' + (cls ? ' ' + cls : '') + '">' + avatar(name) + '<b>' + esc(name) + '</b><small>' + sub + '</small>' + actions + '</li>'; }
  function presenceText(f) { return f.online ? (f.inMatch ? 'In a match' : 'Online') : 'Offline'; }
  function renderFriends() {
    var on = online(), me = Account.current();
    $('friends-offline').hidden = on;
    $('friends-signed-out').hidden = !(on && !me);
    $('friends-signed-in').hidden = !(on && me);
    syncChips();
    if (!(on && me)) return;
    var inc = Account.incoming(), out = Account.outgoing(), list = Account.friends();
    $('requests-count').textContent = inc.length + out.length ? '(' + (inc.length + out.length) + ')' : '';
    $('friend-requests').innerHTML = (!inc.length && !out.length)
      ? '<li class="friend-row is-muted"><span>No pending requests.</span></li>'
      : inc.map(function (f) {
        return row(f.name, 'wants to be friends', '<button type="button" class="mini mini-go" data-accept="' + esc(f.name) + '">Accept</button><button type="button" class="mini" data-decline="' + esc(f.name) + '">Decline</button>');
      }).join('') + out.map(function (f) {
        return row(f.name, 'request sent', '<button type="button" class="mini" data-cancel="' + esc(f.name) + '">Cancel</button>');
      }).join('');
    $('friends-count').textContent = list.length ? '(' + list.length + ')' : '';
    $('friend-list').innerHTML = list.length
      ? list.map(function (f) { return row(f.name, presenceText(f), '<button type="button" class="mini" data-remove="' + esc(f.name) + '">Remove</button>', f.online ? 'is-online' : ''); }).join('')
      : '<li class="friend-row is-muted"><span>No friends yet. Search for a username above.</span></li>';
    renderResults();
  }
  function renderResults() {
    var box = $('friend-results');
    if (!lastQuery) { box.innerHTML = ''; return; }
    if (!lastResults) { box.innerHTML = '<p class="result-empty">Searching…</p>'; return; }
    if (!lastResults.length) { box.innerHTML = '<p class="result-empty">No player named “' + esc(lastQuery) + '”.</p>'; return; }
    box.innerHTML = '<ul class="friend-list">' + lastResults.map(function (r) {
      var action = r.relation === 'friend' ? '<span class="tag">Friends</span>'
        : r.relation === 'outgoing' ? '<span class="tag">Request sent</span>'
        : r.relation === 'incoming' ? '<button type="button" class="mini mini-go" data-accept="' + esc(r.name) + '">Accept</button>'
        : '<button type="button" class="mini mini-go" data-request="' + esc(r.name) + '">Add friend</button>';
      return row(r.name, presenceText(r), action, r.online ? 'is-online' : '');
    }).join('') + '</ul>';
  }
  function onSearch(e) {
    e.preventDefault();
    lastQuery = $('friend-query').value.trim();
    lastResults = null;
    status('friends-status', '');
    renderResults();
    if (!lastQuery) return;
    var q = lastQuery;
    Account.search(q).then(function (results) { if (q === lastQuery) { lastResults = results; renderResults(); } });
  }
  function refreshSearch() {
    if (!lastQuery) return;
    var q = lastQuery;
    Account.search(q).then(function (results) { if (q === lastQuery) { lastResults = results; renderResults(); } });
  }
  function friendAction(target) {
    var name, p;
    if ((name = target.getAttribute('data-request'))) {
      p = Account.sendRequest(name).then(function (r) {
        status('friends-status', r.ok ? (r.accepted ? 'You and ' + name + ' are now friends.' : 'Friend request sent to ' + name + '.') : reason(r.reason));
      });
    } else if ((name = target.getAttribute('data-accept'))) {
      p = Account.accept(name).then(function (r) { status('friends-status', r.ok ? 'You and ' + name + ' are now friends.' : reason(r.reason)); });
    } else if ((name = target.getAttribute('data-decline'))) {
      p = Account.decline(name).then(function () { status('friends-status', 'Request from ' + name + ' declined.'); });
    } else if ((name = target.getAttribute('data-cancel'))) {
      p = Account.cancel(name).then(function () { status('friends-status', 'Request to ' + name + ' cancelled.'); });
    } else if ((name = target.getAttribute('data-remove'))) {
      p = Account.removeFriend(name).then(function () { status('friends-status', name + ' removed from your friends.'); });
    } else return false;
    p.then(function () { refreshSearch(); });
    return true;
  }

  // ---------------------------------------------------------------- live updates from the hub
  function onAccountChange(what, data) {
    if (what === 'party') {
      var party = Party.current();
      if (party && !inMatch() && !isOpen('party-dialog') && (opts.inMenu ? opts.inMenu() : true)) openDialog('party-dialog');
      if (!party && isOpen('party-dialog')) { openModePicker(); status('mode-status', 'The team was disbanded.'); }
      if (isOpen('party-dialog')) renderParty();
    } else if (what === 'lobby') {
      if (isOpen('lobby-dialog')) renderLobby();
      if (isOpen('party-dialog')) renderParty();
      if (!Lobby.current() && isOpen('lobby-dialog') && !inMatch()) { /* left the queue elsewhere */ }
    } else if (what === 'invite') {
      renderInvites();
    } else if (what === 'friends') {
      if (isOpen('friends-dialog')) renderFriends();
      if (isOpen('party-dialog')) renderParty();
      syncChips();
    } else {
      syncChips();
      if (isOpen('settings-dialog')) { if (!$('tab-account').hidden) renderAccount(); if (!$('tab-online').hidden) renderOnline(); }
      if (isOpen('friends-dialog')) renderFriends();
      if (isOpen('mode-dialog')) renderModes();
      if (what === 'status' && Net.status() !== 'online') {
        renderInvites();
        if (isOpen('party-dialog') || isOpen('lobby-dialog')) { openModePicker(); status('mode-status', 'Connection lost. Reconnecting…'); }
      }
    }
  }

  // ---------------------------------------------------------------- wiring
  function init(o) {
    opts = o || {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (btn) { btn.addEventListener('click', function () { closeDialogs(); }); });
    $('mode-list').addEventListener('click', function (e) { var btn = e.target.closest('[data-mode]'); if (btn && !btn.disabled) chooseMode(btn.getAttribute('data-mode')); });
    $('practice-btn').addEventListener('click', startPractice);
    $('mode-team-open').addEventListener('click', function () { renderParty(); openDialog('party-dialog'); });
    $('mode-team-leave').addEventListener('click', function () { Party.leave(); renderModes(); status('mode-status', 'You left the team.'); });
    $('lobby-leave').addEventListener('click', function () { Lobby.leave(); openModePicker(); });
    $('lobby-practice').addEventListener('click', function () { Lobby.leave(); startPractice(); });
    $('party-fill').addEventListener('change', function () { Party.setFill(this.checked); });
    $('party-dialog').addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      var name;
      if ((name = t.getAttribute('data-invite'))) {
        Party.invite(name).then(function (r) { status('party-status', r.ok ? 'Invite sent to ' + name + '.' : reason(r.reason)); });
      } else if ((name = t.getAttribute('data-kick'))) Party.kick(name);
      else if (t.hasAttribute('data-open-account')) openSettings('account');
    });
    $('party-start').addEventListener('click', partyStart);
    $('party-back').addEventListener('click', function () { Party.leave(); openModePicker(); });
    $('invites').addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.hasAttribute('data-join')) Party.join(Number(t.getAttribute('data-join')));
      else if (t.hasAttribute('data-ignore')) Party.ignore(Number(t.getAttribute('data-ignore')));
    });
    Array.prototype.forEach.call($('settings-dialog').querySelectorAll('[role="tab"]'), function (tab) {
      tab.addEventListener('click', function () { showTab(tab.getAttribute('data-tab')); });
      tab.addEventListener('keydown', function (e) {
        var tabs = Array.prototype.slice.call($('settings-dialog').querySelectorAll('[role="tab"]')), i = tabs.indexOf(tab);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
          showTab(next.getAttribute('data-tab'));
          next.focus();
          e.preventDefault();
        }
      });
    });
    $('bindings').addEventListener('click', function (e) { var btn = e.target.closest('[data-bind]'); if (btn && !capture) startCapture(btn); });
    $('reset-bindings').addEventListener('click', function () {
      Controls.reset();
      renderBindings();
      status('bind-status', 'Controls reset to defaults.');
      if (opts.onBindingsChanged) opts.onBindingsChanged();
    });
    $('sound-toggle').addEventListener('change', function () { if (opts.onMuteChanged) opts.onMuteChanged(!this.checked); });
    $('server-connect').addEventListener('click', function () { Net.setUrl($('server-url').value); renderOnline(); });
    $('server-reset').addEventListener('click', function () { Net.setUrl(''); $('server-url').value = Net.defaultUrl(); renderOnline(); });
    $('account-online-btn').addEventListener('click', function () { showTab('online'); });
    $('guest-form').addEventListener('submit', onGuest);
    $('create-form').addEventListener('submit', onCreate);
    $('signin-form').addEventListener('submit', onSignIn);
    $('username-form').addEventListener('submit', onUsername);
    $('signout-btn').addEventListener('click', signOut);
    $('friend-search').addEventListener('submit', onSearch);
    $('friends-dialog').addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.id === 'friends-signin-btn') { openSettings('account'); return; }
      if (t.id === 'friends-online-btn') { openSettings('online'); return; }
      friendAction(t);
    });
    window.addEventListener('keydown', function (e) {
      if (e.code !== 'Escape' || !anyOpen() || capture) return;
      e.preventDefault();
      e.stopPropagation();
      closeTop();
    }, true);
    Account.onChange(onAccountChange);
    setInterval(function () { if (isOpen('settings-dialog') && !$('tab-online').hidden) renderOnline(); }, 2000);
    syncChips();
  }

  W.Menu = {
    init: init, openModePicker: openModePicker, openSettings: openSettings, openFriends: openFriends, openLobby: openLobby,
    closeAll: closeDialogs, closeTop: closeTop, anyOpen: anyOpen, syncChips: syncChips, syncSound: syncSound,
    capturing: function () { return !!capture; }
  };
}());
