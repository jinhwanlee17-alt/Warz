// Verify that a deployment serves the tested files and accepts multiplayer connections.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = new URL(process.argv[2] || 'https://warz-io.warz-io.workers.dev/');
const files = ['index.html', 'js/config.js', 'js/class-combat.js', 'js/world.js', 'js/items.js',
  'js/main.js', 'js/online.js', 'js/render.js', 'js/input.js', 'js/controls.js', 'js/icons.js',
  'js/map.js', 'js/map-art.js', 'js/map-screen.js', 'js/hud.js', 'js/upgrade-tree.js',
  'js/util.js', 'js/audio.js', 'js/inventory.js', 'js/net.js', 'js/account.js', 'js/menu.js', 'js/demo.js',
  'css/style.css', 'css/upgrade-tree.css'];
await Promise.all(files.map(async file => {
  const response = await fetch(new URL(file + '?verify=' + Date.now(), base), { signal: AbortSignal.timeout(15000) });
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
