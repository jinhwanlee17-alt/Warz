// warz.io on Cloudflare Workers (free plan): static assets serve the game, one Hub Durable Object handles
// accounts / friends / parties / matchmaking, and every match runs in its own Match Durable Object.
import { Warz } from '../core/sim.mjs';
import { makeVerifiers } from '../core/auth.mjs';
import { Accounts } from '../core/accounts.mjs';
import { Hub, VERSION } from '../core/hub.mjs';
import { Match } from '../core/match.mjs';
import { DoStore } from './store-do.mjs';

function configFrom(env) {
  const n = (v, d) => { const x = Number(v); return v !== undefined && v !== '' && Number.isFinite(x) && x >= 0 ? x : d; };
  const lobbyMax = Math.max(2, n(env.LOBBY_MAX, 50));
  return {
    googleClientId: env.GOOGLE_CLIENT_ID || '', appleClientId: env.APPLE_CLIENT_ID || '', publicUrl: env.PUBLIC_URL || '',
    lobbyMin: Math.max(1, n(env.LOBBY_MIN, 1)), lobbyCountdown: n(env.LOBBY_COUNTDOWN, 20), lobbyMax,
    botFill: Math.min(lobbyMax, n(env.BOT_FILL, lobbyMax)),  // lobbies are topped up to this many players with bots; 0 = no bots
    botSkill: Math.min(1, n(env.BOT_SKILL, 0.5))             // how good the bots are: 0 easiest .. 1 hardest
  };
}

function wrapSocket(ws) {
  const conn = {
    open: true, bufferedAmount: 0,
    sendText(text) { if (!conn.open) return false; try { ws.send(text); return true; } catch (e) { conn.open = false; return false; } },
    sendJson(obj) { return conn.sendText(JSON.stringify(obj)); },
    close(code, reason) { conn.open = false; try { ws.close(code, reason); } catch (e) { /* already closed */ } }
  };
  return conn;
}

function acceptSocket(request) {
  if (request.headers.get('Upgrade') !== 'websocket') return null;
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  return { client, server };
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export class HubObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.timer = null;
    this.ready = state.blockConcurrencyWhile(async () => {
      const store = new DoStore(state.storage);
      await store.load();
      const config = configFrom(env);
      const accounts = new Accounts(store, { verifiers: makeVerifiers(config) });
      const matchHost = {
        async start(spec) {
          const doId = env.MATCH.newUniqueId(), id = doId.toString();
          const res = await env.MATCH.get(doId).fetch('https://match/start', { method: 'POST', body: JSON.stringify(spec) });
          if (!res.ok) throw new Error('match start failed: ' + res.status);
          const body = await res.json();
          return { id, tickets: body.tickets };
        }
      };
      this.hub = new Hub({ accounts, config, matchHost, log: console });
    });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname === '/internal/match-ended' && request.method === 'POST') {
      const body = await request.json();
      this.hub.matchEnded(String(body.id));
      return new Response('ok');
    }
    if (url.pathname === '/ws') {
      const pair = acceptSocket(request);
      if (!pair) return new Response('expected websocket', { status: 426 });
      const conn = wrapSocket(pair.server);
      this.hub.onConnection(conn);
      this.ensureTimer();
      pair.server.addEventListener('message', (ev) => { if (typeof ev.data === 'string') this.hub.onMessage(conn, ev.data); });
      const closed = () => {
        conn.open = false;
        this.hub.onClose(conn);
        if (!this.hub.size()) this.stopTimer();
      };
      pair.server.addEventListener('close', closed);
      pair.server.addEventListener('error', closed);
      return new Response(null, { status: 101, webSocket: pair.client });
    }
    return new Response('not found', { status: 404 });
  }

  ensureTimer() { if (!this.timer) this.timer = setInterval(() => this.hub.tick(Date.now()), 250); }
  stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}

export class MatchObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.match = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/start' && request.method === 'POST') {
      if (this.match) return new Response('already started', { status: 409 });
      const spec = await request.json(), id = this.state.id.toString(), env = this.env;
      this.match = new Match({
        W: Warz, id, mode: spec.mode, teamSize: spec.teamSize, teams: spec.teams, seed: (Math.random() * 2147483647) | 0, log: console, botSkill: configFrom(env).botSkill,
        onEnd() {
          env.HUB.get(env.HUB.idFromName('hub')).fetch('https://hub/internal/match-ended', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => {});
        }
      });
      return json({ tickets: this.match.slots.map((s) => s.ticket) });
    }
    if (url.pathname === '/ws' || url.pathname.endsWith('/ws')) {
      const pair = acceptSocket(request);
      if (!pair) return new Response('expected websocket', { status: 426 });
      if (!this.match || this.match.ended) {
        pair.server.close(4404, 'match over');
        return new Response(null, { status: 101, webSocket: pair.client });
      }
      const conn = wrapSocket(pair.server);
      const p = this.match.claim(url.searchParams.get('ticket') || '', conn);
      if (!p) {
        pair.server.close(4401, 'bad ticket');
        return new Response(null, { status: 101, webSocket: pair.client });
      }
      pair.server.addEventListener('message', (ev) => { if (typeof ev.data === 'string' && this.match) this.match.onMessage(conn, ev.data); });
      const closed = () => { conn.open = false; if (this.match) this.match.detach(conn); };
      pair.server.addEventListener('close', closed);
      pair.server.addEventListener('error', closed);
      return new Response(null, { status: 101, webSocket: pair.client });
    }
    return new Response('not found', { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/config') {
      const c = configFrom(env);
      return json({ google: c.googleClientId || null, apple: c.appleClientId || null, lobbyMin: c.lobbyMin, lobbyMax: c.lobbyMax, bots: c.botFill, version: VERSION, platform: 'cloudflare' });
    }
    if (url.pathname === '/healthz') return new Response('ok');
    if (url.pathname === '/ws') return env.HUB.get(env.HUB.idFromName('hub')).fetch(request);
    const m = url.pathname.match(/^\/match\/([0-9a-f]{64})\/ws$/);
    if (m) {
      let id;
      try { id = env.MATCH.idFromString(m[1]); } catch (e) { return new Response('bad match id', { status: 400 }); }
      // The match object sees a plain /ws path; the ticket travels in the query string.
      return env.MATCH.get(id).fetch(new Request('https://match/ws' + url.search, request));
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('not found', { status: 404 });
  }
};
