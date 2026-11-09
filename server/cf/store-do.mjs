// Durable Object storage adapter with the same shape as the file store: an in-memory `data` object and a
// debounced `save()` that writes only the entries that changed (one storage key per user / friend list / session).
export function blank() {
  return { users: {}, friends: {}, requests: [], sessions: {}, providers: { google: {}, apple: {} } };
}

const PREFIX = { users: 'u:', friends: 'f:', sessions: 's:', google: 'p:google:', apple: 'p:apple:' };

export class DoStore {
  constructor(storage) {
    this.storage = storage;
    this.data = blank();
    this.shadow = new Map();
    this.timer = null;
    this.flushing = null;
  }

  async load() {
    const data = blank(), shadow = new Map();
    const read = async (prefix, into) => {
      const map = await this.storage.list({ prefix });
      for (const [k, v] of map) { into[k.slice(prefix.length)] = v; shadow.set(k, JSON.stringify(v)); }
    };
    await read(PREFIX.users, data.users);
    await read(PREFIX.friends, data.friends);
    await read(PREFIX.sessions, data.sessions);
    await read(PREFIX.google, data.providers.google);
    await read(PREFIX.apple, data.providers.apple);
    const requests = await this.storage.get('requests');
    if (Array.isArray(requests)) { data.requests = requests; shadow.set('requests', JSON.stringify(requests)); }
    this.data = data;
    this.shadow = shadow;
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 100);
  }

  snapshot() {
    const entries = new Map();
    const add = (prefix, obj) => { for (const k of Object.keys(obj)) entries.set(prefix + k, obj[k]); };
    add(PREFIX.users, this.data.users);
    add(PREFIX.friends, this.data.friends);
    add(PREFIX.sessions, this.data.sessions);
    add(PREFIX.google, this.data.providers.google || {});
    add(PREFIX.apple, this.data.providers.apple || {});
    entries.set('requests', this.data.requests);
    return entries;
  }

  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const entries = this.snapshot(), puts = {}, deletes = [];
      let putCount = 0;
      for (const [k, v] of entries) {
        const json = JSON.stringify(v);
        if (this.shadow.get(k) !== json) { puts[k] = v; putCount++; this.shadow.set(k, json); }
      }
      for (const k of this.shadow.keys()) if (!entries.has(k)) { deletes.push(k); this.shadow.delete(k); }
      const keys = Object.keys(puts);
      for (let i = 0; i < keys.length; i += 128) {
        const chunk = {};
        keys.slice(i, i + 128).forEach((k) => { chunk[k] = puts[k]; });
        await this.storage.put(chunk);
      }
      for (let i = 0; i < deletes.length; i += 128) await this.storage.delete(deletes.slice(i, i + 128));
      return putCount + deletes.length;
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
}
