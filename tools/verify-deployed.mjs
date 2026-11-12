// Verify that a deployment serves the tested files and accepts multiplayer connections.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL(process.argv[2] || 'https://warz-io.warz-io.workers.dev/');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const linkedAssets = new Map([...page.matchAll(/(?:src|href)="((?:js|css)\/[^"\s]+)"/g)].map(m => [m[1].split('?')[0], m[1]]));
const files = ['index.html', ...linkedAssets.keys()];
await Promise.all(files.map(async file => {
  const url = new URL(linkedAssets.get(file) || file, base);
  url.searchParams.set('verify', Date.now());
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(file + ' HTTP ' + response.status);
  if (!Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync(path.join(root, file)))) throw new Error(file + ' differs from the tested local source');
}));
console.log('Verified all ' + files.length + ' live game assets match the tested local files.');
const response = await fetch(new URL('api/config', base), { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error('Live API unavailable');
const config = await response.json();
console.log('Live API responds: platform=' + config.platform + ', lobby=' + config.lobbyMin);
await new Promise((resolve, reject) => {
  const url = new URL('ws', base); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket timeout')); }, 10000);
  socket.onopen = () => { clearTimeout(timer); socket.close(); console.log('Live multiplayer WebSocket connected successfully.'); resolve(); };
  socket.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket failed')); };
});
