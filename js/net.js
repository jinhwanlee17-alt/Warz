/* warz.io: connections to the warz.io server. W.Net is the hub socket (accounts, friends, parties, matchmaking);
   W.MatchNet is the per-match socket. The hub reconnects with backoff and pauses while the tab is hidden;
   offline play keeps working when no server answers. */
(function () {
  'use strict';
  var W = window.Warz;
  var STORE = 'warz.server.v1';
  var ws = null, url = null, status = 'offline', handlers = {}, wanted = false, backoff = 1000, reconnectTimer = null;
  var pingTimer = null, latency = 0, pingSeq = 0, pings = {}, helloFn = null, waiters = [], welcomed = false, lastError = '';
  var hideTimer = null, pausedByHide = false;

  function storedUrl() { try { return localStorage.getItem(STORE) || ''; } catch (e) { return ''; } }
  function defaultUrl() {
    if (location.protocol === 'file:' || !location.host) return 'ws://127.0.0.1:5180/ws';
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }
  function base() { return (url || storedUrl() || defaultUrl()).replace(/\/ws(\?.*)?$/, ''); }
  function setStatus(s) {
    if (status === s) return;
    status = s;
    dispatch({ t: 'net-status', status: s });
  }
  function dispatch(msg) {
    var list = handlers[msg.t];
    if (list) list.slice().forEach(function (fn) { try { fn(msg); } catch (e) { console.error('net handler ' + msg.t, e); } });
    for (var i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].type === msg.t) { var w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(msg); }
    }
  }
  function failWaiters(reason) {
    waiters.splice(0).forEach(function (w) { clearTimeout(w.timer); w.resolve({ t: w.type, ok: false, reason: reason }); });
  }

  function connect(opts) {
    opts = opts || {};
    helloFn = opts.hello || helloFn;
    url = opts.url || storedUrl() || defaultUrl();
    wanted = true;
    pausedByHide = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { var old = ws; ws = null; try { old.onclose = null; old.close(); } catch (e) { /* ignore */ } }
    open();
  }

  function open() {
    setStatus('connecting');
    welcomed = false;
    var sock;
    try { sock = new WebSocket(url); } catch (e) { lastError = e.message; setStatus('offline'); scheduleReconnect(); return; }
    ws = sock;
    sock.onopen = function () {
      if (ws !== sock) return;
      backoff = 1000;
      send(Object.assign({ t: 'hello', v: 1 }, helloFn ? helloFn() : {}));
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(ping, 2500);
      ping();
    };
    sock.onmessage = function (ev) {
      if (ws !== sock) return;
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'pong') {
        var sent = pings[msg.c];
        if (sent) { latency = Math.round(performance.now() - sent); delete pings[msg.c]; }
        return;
      }
      if (msg.t === 'welcome') { welcomed = true; setStatus('online'); }
      dispatch(msg);
    };
    sock.onclose = function (ev) {
      if (ws !== sock) return;
      ws = null;
      lastError = (ev && ev.reason) || '';
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      failWaiters('offline');
      setStatus('offline');
      dispatch({ t: 'net-closed', code: ev && ev.code, reason: lastError, wasOnline: welcomed });
      scheduleReconnect();
    };
    sock.onerror = function () { /* onclose follows */ };
  }

  function scheduleReconnect() {
    if (!wanted || pausedByHide || reconnectTimer) return;
    reconnectTimer = setTimeout(function () { reconnectTimer = null; if (wanted && !ws && !pausedByHide) open(); }, backoff);
    backoff = Math.min(15000, backoff * 1.6);
  }

  function ping() {
    if (!ws || ws.readyState !== 1 || document.hidden) return;
    var c = ++pingSeq;
    pings[c] = performance.now();
    if (c > 5) delete pings[c - 5];
    send({ t: 'ping', c: c });
  }

  function send(msg) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  // Sends a message and resolves with the first reply of `replyType` (or {ok:false, reason}).
  function request(msg, replyType, timeout) {
    return new Promise(function (resolve) {
      if (!online()) { resolve({ t: replyType, ok: false, reason: 'offline' }); return; }
      var w = { type: replyType, resolve: resolve };
      w.timer = setTimeout(function () {
        var i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        resolve({ t: replyType, ok: false, reason: 'timeout' });
      }, timeout || 8000);
      waiters.push(w);
      send(msg);
    });
  }

  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); return fn; }
  function off(type, fn) { var list = handlers[type]; if (list) { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); } }
  function online() { return status === 'online' && !!ws && ws.readyState === 1; }
  function disconnect() {
    wanted = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
  }

  // A tab hidden for five minutes drops the hub connection (keeps the free server budget for players who are
  // actually there); it reconnects the moment the tab is visible again. Matches are not affected.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        hideTimer = null;
        if (document.hidden && wanted && !W.MatchNet.active()) { pausedByHide = true; if (ws) ws.close(); }
      }, 5 * 60 * 1000);
    } else {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (pausedByHide) { pausedByHide = false; if (wanted && !ws) open(); }
    }
  });

  W.Net = {
    connect: connect, disconnect: disconnect, send: send, request: request, on: on, off: off,
    online: online, status: function () { return status; }, latency: function () { return latency; },
    url: function () { return url || storedUrl() || defaultUrl(); }, base: base, defaultUrl: defaultUrl, lastError: function () { return lastError; },
    setUrl: function (u) {
      u = String(u || '').trim();
      try { if (u) localStorage.setItem(STORE, u); else localStorage.removeItem(STORE); } catch (e) { /* storage blocked */ }
      connect({ url: u || defaultUrl() });
    }
  };

  // ---------------------------------------------------------------- match socket
  var match = { ws: null, handlers: null, latency: 0, pings: {}, seq: 0, timer: null, id: null, waiters: [] };
  function matchPing() {
    if (!match.ws || match.ws.readyState !== 1) return;
    var c = ++match.seq;
    match.pings[c] = performance.now();
    if (c > 5) delete match.pings[c - 5];
    match.ws.send(JSON.stringify({ t: 'ping', c: c }));
  }
  W.MatchNet = {
    connect: function (id, ticket, h) {
      W.MatchNet.close();
      var u = base() + '/match/' + encodeURIComponent(id) + '/ws?ticket=' + encodeURIComponent(ticket);
      var sock = new WebSocket(u);
      match.ws = sock; match.handlers = h || {}; match.id = id;
      sock.onopen = function () {
        if (match.ws !== sock) return;
        if (match.timer) clearInterval(match.timer);
        match.timer = setInterval(matchPing, 2000);
        matchPing();
        if (match.handlers.onOpen) match.handlers.onOpen();
      };
      sock.onmessage = function (ev) {
        if (match.ws !== sock) return;
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!msg || typeof msg.t !== 'string') return;
        if (msg.t === 'pong') { var sent = match.pings[msg.c]; if (sent) { match.latency = Math.round(performance.now() - sent); delete match.pings[msg.c]; } return; }
        for (var i = match.waiters.length - 1; i >= 0; i--) {
          if (match.waiters[i].type === msg.t) { var w = match.waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(msg); }
        }
        if (match.handlers.onMessage) match.handlers.onMessage(msg);
      };
      sock.onclose = function (ev) {
        if (match.ws !== sock) return;
        match.ws = null;
        if (match.timer) { clearInterval(match.timer); match.timer = null; }
        match.waiters.splice(0).forEach(function (w) { clearTimeout(w.timer); w.resolve({ t: w.type, ok: false, reason: 'closed' }); });
        if (match.handlers.onClose) match.handlers.onClose(ev && ev.code, (ev && ev.reason) || '');
      };
      sock.onerror = function () { /* onclose follows */ };
    },
    send: function (msg) { if (match.ws && match.ws.readyState === 1) match.ws.send(JSON.stringify(msg)); },
    request: function (msg, replyType, timeout) {
      return new Promise(function (resolve) {
        if (!match.ws || match.ws.readyState !== 1) { resolve({ t: replyType, ok: false, reason: 'offline' }); return; }
        var w = { type: replyType, resolve: resolve };
        w.timer = setTimeout(function () { var i = match.waiters.indexOf(w); if (i >= 0) match.waiters.splice(i, 1); resolve({ t: replyType, ok: false, reason: 'timeout' }); }, timeout || 6000);
        match.waiters.push(w);
        match.ws.send(JSON.stringify(msg));
      });
    },
    close: function () {
      if (!match.ws) return;
      var s = match.ws;
      match.ws = null;
      if (match.timer) { clearInterval(match.timer); match.timer = null; }
      try { s.onclose = null; s.close(); } catch (e) { /* ignore */ }
    },
    active: function () { return !!match.ws; },
    id: function () { return match.ws ? match.id : null; },
    latency: function () { return match.latency; }
  };
}());
