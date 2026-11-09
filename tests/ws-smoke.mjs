// The zero-dependency WebSocket server: handshake, small/large frames, pings, close codes, size limit.
import http from 'node:http';
import { attach } from '../server/node/ws.mjs';
import { suite } from './harness.mjs';

const t = suite('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
attach(server, {
  pingInterval: 200,
  onConnection(conn, url) {
    conn.on('message', (m) => { if (m === 'close-me') conn.close(4000, 'bye'); else conn.send(url.pathname + ':' + m); });
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const open = (path) => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://127.0.0.1:' + port + path);
  ws.onopen = () => resolve(ws);
  ws.onerror = () => reject(new Error('connect failed'));
});
const next = (ws) => new Promise((resolve) => { ws.onmessage = (ev) => resolve(ev.data); });

const ws = await open('/echo');
ws.send('hello');
t.equal(await next(ws), '/echo:hello', 'echo of a small text frame');
const mid = 'y'.repeat(2000);
ws.send(mid);
t.equal(await next(ws), '/echo:' + mid, 'echo of a 2 KB frame (16-bit length)');
const big = 'x'.repeat(100000);
ws.send(big);
t.equal((await next(ws)).length, big.length + 6, 'echo of a 100 KB frame (64-bit length)');
ws.send('éè 😀');
t.equal(await next(ws), '/echo:éè 😀', 'utf-8 survives the round trip');
await sleep(900);
ws.send('still');
t.equal(await next(ws), '/echo:still', 'connection survives server pings');
const closed = new Promise((r) => { ws.onclose = (ev) => r(ev); });
ws.send('close-me');
const ev = await closed;
t.equal(ev.code, 4000, 'server close code reaches the client');
t.equal(ev.reason, 'bye', 'server close reason reaches the client');

const ws2 = await open('/big');
const closed2 = new Promise((r) => { ws2.onclose = (ev2) => r(ev2); });
ws2.send('z'.repeat(300 * 1024));
t.equal((await closed2).code, 1009, 'oversized messages close with 1009');

const ws3 = await open('/c');
const closed3 = new Promise((r) => { ws3.onclose = (ev3) => r(ev3); });
ws3.close(1000, 'done');
t.equal((await closed3).code, 1000, 'client-initiated close completes with its code');

const a = await open('/a'), b = await open('/b');
a.send('1'); b.send('2');
t.equal(await next(a), '/a:1', 'two connections are independent (a)');
t.equal(await next(b), '/b:2', 'two connections are independent (b)');
await Promise.all([a, b].map((s) => new Promise((r) => { s.onclose = r; s.close(); })));

server.close();
await sleep(100);
t.done();
