// Minimal RFC 6455 WebSocket server (text frames, fragmentation, ping/pong, close) on top of Node's http
// upgrade event. Zero dependencies, so `npm start` works without an install step.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const MAX_MESSAGE = 256 * 1024;
const EMPTY = Buffer.alloc(0);

export class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.remoteAddress = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || socket.remoteAddress;
    this.open = true;
    this.closing = false;
    this.alive = true;
    this.buffer = EMPTY;
    this.fragments = null;
    this.fragOp = 0;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish(1006, 'socket closed'));
    socket.on('error', () => this.finish(1006, 'socket error'));
    socket.on('end', () => this.finish(1006, 'socket ended'));
  }

  onData(data) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data;
    while (this.open) {
      const frame = this.readFrame();
      if (!frame) break;
      this.handleFrame(frame);
    }
  }

  readFrame() {
    const b = this.buffer;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0, rsv = b[0] & 0x70, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (rsv) { this.fail(1002, 'reserved bits set'); return null; }
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      if (b.readUInt32BE(2) !== 0) { this.fail(1009, 'message too large'); return null; }
      len = b.readUInt32BE(6); off = 10;
    }
    if (!masked) { this.fail(1002, 'client frames must be masked'); return null; }
    if (len > MAX_MESSAGE) { this.fail(1009, 'message too large'); return null; }
    if (b.length < off + 4 + len) return null;
    const mask = b.subarray(off, off + 4);
    off += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
    this.buffer = b.subarray(off + len);
    return { fin, op, payload };
  }

  handleFrame(f) {
    switch (f.op) {
      case 0x0:
        if (!this.fragments) return this.fail(1002, 'unexpected continuation frame');
        this.fragments.push(f.payload);
        if (this.fragments.reduce((n, p) => n + p.length, 0) > MAX_MESSAGE) return this.fail(1009, 'message too large');
        if (f.fin) {
          const data = Buffer.concat(this.fragments), op = this.fragOp;
          this.fragments = null;
          this.deliver(op, data);
        }
        return;
      case 0x1:
      case 0x2:
        if (this.fragments) return this.fail(1002, 'nested fragmented message');
        if (!f.fin) { this.fragments = [f.payload]; this.fragOp = f.op; return; }
        return this.deliver(f.op, f.payload);
      case 0x8: {
        let code = 1005, reason = '';
        if (f.payload.length >= 2) { code = f.payload.readUInt16BE(0); reason = f.payload.subarray(2).toString('utf8'); }
        if (!this.closing) { this.closing = true; this.sendFrame(0x8, f.payload.subarray(0, 125)); }
        this.finish(code, reason);
        return;
      }
      case 0x9: this.sendFrame(0xA, f.payload); return;
      case 0xA: this.alive = true; return;
      default: this.fail(1002, 'unknown opcode');
    }
  }

  deliver(op, data) {
    this.alive = true;
    if (op === 0x1) {
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch (e) { return this.fail(1007, 'invalid utf-8'); }
      this.emit('message', text);
    } else this.emit('binary', data);
  }

  sendFrame(op, payload) {
    if (!this.open) return false;
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.allocUnsafe(2); header[1] = len; }
    else if (len < 65536) { header = Buffer.allocUnsafe(4); header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.allocUnsafe(10); header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
    header[0] = 0x80 | op;
    try { return this.socket.write(Buffer.concat([header, payload])); } catch (e) { this.finish(1006, 'write failed'); return false; }
  }

  send(text) { return this.sendFrame(0x1, Buffer.from(String(text), 'utf8')); }
  get bufferedAmount() { return this.socket.writableLength; }
  ping() { this.alive = false; this.sendFrame(0x9, EMPTY); }

  close(code = 1000, reason = '') {
    if (!this.open || this.closing) return;
    this.closing = true;
    const r = Buffer.from(reason, 'utf8').subarray(0, 123), p = Buffer.allocUnsafe(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.sendFrame(0x8, p);
    const timer = setTimeout(() => this.finish(code, reason), 1000);
    if (timer.unref) timer.unref();
  }

  // Protocol error: send the close frame, let it flush, then end the connection ourselves.
  fail(code, reason) {
    if (!this.open) return;
    this.closing = true;
    const r = Buffer.from(reason, 'utf8').subarray(0, 123), p = Buffer.allocUnsafe(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.sendFrame(0x8, p);
    this.open = false;
    try { this.socket.end(); } catch (e) { /* already gone */ }
    const timer = setTimeout(() => { try { this.socket.destroy(); } catch (e) { /* already gone */ } }, 1000);
    if (timer.unref) timer.unref();
    this.emit('close', code, reason);
  }

  finish(code, reason) {
    if (!this.open) return;
    this.open = false;
    try { this.socket.destroy(); } catch (e) { /* already gone */ }
    this.emit('close', code, reason);
  }
}

// Completes the HTTP upgrade handshake. Returns the connection, or null after answering with 400.
export function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  const version = req.headers['sec-websocket-version'];
  if (upgrade !== 'websocket' || !key || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n');
  return new WsConnection(socket, req);
}

// Attaches to an http.Server: every upgrade becomes a WsConnection passed to onConnection(conn, url).
export function attach(server, { onConnection, pingInterval = 20000 } = {}) {
  const connections = new Set();
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://local/');
    const conn = accept(req, socket);
    if (!conn) return;
    connections.add(conn);
    conn.on('close', () => connections.delete(conn));
    onConnection(conn, url);
    if (head && head.length) conn.onData(head);
  });
  const timer = setInterval(() => {
    for (const conn of connections) {
      if (!conn.alive) conn.finish(1001, 'ping timeout');
      else conn.ping();
    }
  }, pingInterval);
  if (timer.unref) timer.unref();
  return {
    connections,
    close() {
      clearInterval(timer);
      for (const conn of connections) conn.close(1001, 'server shutting down');
    }
  };
}
