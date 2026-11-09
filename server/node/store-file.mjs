// JSON file store for the Node server (local play and tests). Debounced, atomic writes.
import fs from 'node:fs';
import path from 'node:path';

export function blank() {
  return { users: {}, friends: {}, requests: [], sessions: {}, providers: { google: {}, apple: {} } };
}

export class FileStore {
  constructor(file, { log = console } = {}) {
    this.file = file;
    this.log = log;
    this.data = blank();
    this.timer = null;
    this.load();
  }

  load() {
    if (!this.file) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const data = blank();
      data.users = saved.users || {};
      data.friends = saved.friends || {};
      data.requests = Array.isArray(saved.requests) ? saved.requests : [];
      data.sessions = saved.sessions || {};
      data.providers = Object.assign(data.providers, saved.providers || {});
      this.data = data;
    } catch (e) {
      if (e.code !== 'ENOENT') this.log.warn('store: could not read ' + this.file + ' (' + e.message + '); starting empty');
    }
  }

  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 150);
    if (this.timer.unref) this.timer.unref();
  }

  flush() {
    if (!this.file) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.log.warn('store: could not write ' + this.file + ' (' + e.message + ')');
    }
  }
}
