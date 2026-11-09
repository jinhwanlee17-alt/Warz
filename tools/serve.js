#!/usr/bin/env node
'use strict';
// Tiny static server: `npm run dev`, then open the printed URL. (Opening index.html directly also works.)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml'
};

function localPath(url) {
  let pathname = '/';
  try { pathname = decodeURIComponent(new URL(url, 'http://local/').pathname); } catch (_) { return null; }
  if (pathname === '/') pathname = '/index.html';
  const resolved = path.resolve(ROOT, '.' + pathname);
  return resolved.startsWith(ROOT + path.sep) ? resolved : null;
}

function createServer() {
  return http.createServer((req, res) => {
    const file = localPath(req.url || '/');
    if (!file) { res.writeHead(400); res.end('Bad request'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500); res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
}

module.exports = { createServer };

if (require.main === module) {
  const host = process.env.HOST || '127.0.0.1';
  let port = Number(process.env.PORT || 5180);
  const server = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < 5200) { port += 1; server.listen(port, host); }
    else { console.error(err.message); process.exitCode = 1; }
  });
  server.on('listening', () => console.log('warz.io: http://' + host + ':' + port + '/\nPress Ctrl+C to stop.'));
  server.listen(port, host);
}
