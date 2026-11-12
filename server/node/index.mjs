#!/usr/bin/env node
// warz.io Node server: the same hub + match code as the Cloudflare Worker, for LAN play and tests.
// `npm start` (or `node server/node/index.mjs`). Environment: PORT (5180), HOST (0.0.0.0), DATA_DIR (server/data),
// GOOGLE_CLIENT_ID, APPLE_CLIENT_ID, PUBLIC_URL, LOBBY_MIN (1), LOBBY_COUNTDOWN (20 s), LOBBY_MAX (50),
// BOT_FILL (players a lobby is filled up to with bots; defaults to LOBBY_MAX, 0 turns bots off).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attach } from './ws.mjs';
import { FileStore } from './store-file.mjs';
import { Warz } from '../core/sim.mjs';
import { makeVerifiers } from '../core/auth.mjs';
import { Accounts } from '../core/accounts.mjs';
import { Hub, VERSION } from '../core/hub.mjs';
import { Match } from '../core/match.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };
const PUBLIC = [/^\/index\.html$/, /^\/js\/[A-Za-z0-9_-]+\.js$/, /^\/css\/[A-Za-z0-9_-]+\.css$/, /^\/README\.md$/];

function envNum(v, d) { const n = Number(v); return v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; }   // (an empty variable is "not set", not 0)

function wrap(ws) {
  return {
    get open() { return ws.open; },
    get bufferedAmount() { return ws.bufferedAmount; },
    sendText: (t) => ws.send(t),
    sendJson: (o) => ws.send(JSON.stringify(o)),
    close: (code, reason) => ws.close(code, reason),
    remoteAddress: ws.remoteAddress
  };
}

export function createApp(options = {}) {
  const env = process.env;
  const log = options.log || console;
  const dataDir = options.dataDir !== undefined ? options.dataDir : (env.DATA_DIR || path.join(ROOT, 'server', 'data'));
  const config = {
    googleClientId: options.googleClientId !== undefined ? options.googleClientId : (env.GOOGLE_CLIENT_ID || ''),
    appleClientId: options.appleClientId !== undefined ? options.appleClientId : (env.APPLE_CLIENT_ID || ''),
    publicUrl: options.publicUrl !== undefined ? options.publicUrl : (env.PUBLIC_URL || ''),
    lobbyMin: Math.max(1, envNum(options.lobbyMin !== undefined ? options.lobbyMin : env.LOBBY_MIN, 1)),
    lobbyCountdown: envNum(options.lobbyCountdown !== undefined ? options.lobbyCountdown : env.LOBBY_COUNTDOWN, 20),
    lobbyMax: Math.max(2, envNum(options.lobbyMax !== undefined ? options.lobbyMax : env.LOBBY_MAX, 50)),
    serveStatic: options.serveStatic !== false
  };
  config.botFill = Math.min(config.lobbyMax, envNum(options.botFill !== undefined ? options.botFill : env.BOT_FILL, config.lobbyMax));
  config.botSkill = Math.min(1, envNum(options.botSkill !== undefined ? options.botSkill : env.BOT_SKILL, 0.5));   // 0 easiest .. 1 hardest
  const store = new FileStore(dataDir ? path.join(dataDir, 'warz-store.json') : null, { log });
  const verifiers = Object.assign(makeVerifiers(config, options.fetch), options.verifiers || {});
  const accounts = new Accounts(store, { verifiers });
  const matches = new Map();
  let nextMatch = 1;

  const matchHost = {
    start(spec) {
      const id = String(nextMatch++);
      const match = new Match({
        W: Warz, id, mode: spec.mode, teamSize: spec.teamSize, teams: spec.teams, practice: spec.practice === true, seed: (Math.random() * 2147483647) | 0, log, botSkill: config.botSkill,
        onEnd: () => { matches.delete(id); hub.matchEnded(id); }
      });
      matches.set(id, match);
      return { id, tickets: match.slots.map((s) => s.ticket) };
    }
  };
  const hub = new Hub({ accounts, config, matchHost, log });

  function localPath(url) {
    let pathname = '/';
    try { pathname = decodeURIComponent(new URL(url, 'http://local/').pathname); } catch (e) { return null; }
    if (pathname === '/') pathname = '/index.html';
    if (!PUBLIC.some((re) => re.test(pathname))) return null;
    const resolved = path.resolve(ROOT, '.' + pathname);
    return resolved.startsWith(ROOT + path.sep) ? resolved : null;
  }
  function handleHttp(req, res) {
    const url = (req.url || '/').split('?')[0];
    if (url === '/api/config') {
      res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ google: config.googleClientId || null, apple: config.appleClientId || null, lobbyMin: config.lobbyMin, lobbyMax: config.lobbyMax, bots: config.botFill, online: hub.size(), matches: matches.size, version: VERSION, platform: 'node' }));
      return;
    }
    if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    if (!config.serveStatic) { res.writeHead(404); res.end('Not found'); return; }
    const file = localPath(url);
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' }); res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }

  const server = http.createServer(handleHttp);
  const wss = attach(server, {
    onConnection(ws, url) {
      const conn = wrap(ws);
      if (url.pathname === '/ws') {
        hub.onConnection(conn);
        ws.on('message', (t) => hub.onMessage(conn, t));
        ws.on('close', () => hub.onClose(conn));
        return;
      }
      const m = url.pathname.match(/^\/match\/([^/]+)\/ws$/);
      if (m) {
        const match = matches.get(m[1]);
        if (!match || match.ended) { ws.close(4404, 'no such match'); return; }
        const p = match.claim(url.searchParams.get('ticket') || '', conn);
        if (!p) { ws.close(4401, 'bad ticket'); return; }
        ws.on('message', (t) => match.onMessage(conn, t));
        ws.on('close', () => match.detach(conn));
        return;
      }
      ws.close(4404, 'unknown path');
    }
  });
  const timer = setInterval(() => hub.tick(Date.now()), 250);
  if (timer.unref) timer.unref();

  return {
    server, store, accounts, hub, lobby: hub.lobby, matches, config,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host || '0.0.0.0', () => resolve({ port: server.address().port }));
      });
    },
    close() {
      clearInterval(timer);
      for (const m of matches.values()) m.destroy();
      wss.close();
      store.flush();
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT || 5180), host = process.env.HOST || '0.0.0.0';
  app.listen(port, host).then(({ port: p }) => {
    console.log('warz.io server listening on http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + p + '/');
    console.log('lobby: starts with ' + app.config.lobbyMin + '+ players after ' + app.config.lobbyCountdown + ' s' +
      (app.config.botFill ? ', filled to ' + app.config.botFill + ' with bots' : ', no bots') +
      ' · Google sign-in ' + (app.config.googleClientId ? 'on' : 'off (set GOOGLE_CLIENT_ID)') + ' · Apple sign-in ' + (app.config.appleClientId ? 'on' : 'off (set APPLE_CLIENT_ID)'));
  }).catch((err) => { console.error(err.message); process.exit(1); });
  const stop = () => { app.close().then(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
