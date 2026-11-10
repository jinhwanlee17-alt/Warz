// Loads the DOM-free game scripts into a Node vm sandbox with an in-memory localStorage.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}

export function loadWarz(files = ['config', 'util', 'map', 'world', 'items', 'class-combat'], options = {}) {
  // Keep explicit simulation subsets on the same combat implementation as the game.
  if (files.includes('items') && !files.includes('class-combat')) { files = files.slice(); files.splice(files.indexOf('items') + 1, 0, 'class-combat'); }
  const storage = options.storage || new MemoryStorage();
  const sandbox = { console, localStorage: storage, crypto: globalThis.crypto, TextEncoder, setTimeout, clearTimeout, performance };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of files) {
    const file = path.join(ROOT, 'js', name + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  return sandbox.Warz;
}

export function suite(title) {
  const failures = [];
  let passed = 0;
  // WARZ_TEST_VERBOSE=1 prints every check that passes too (many of them carry measured numbers in their text).
  const pass = (message) => { passed++; if (process.env.WARZ_TEST_VERBOSE) console.log('  ok   ' + message); };
  return {
    check(ok, message) { if (ok) pass(message); else failures.push(message); },
    equal(actual, expected, message) {
      if (actual === expected) pass(message);
      else failures.push(message + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
    },
    near(actual, expected, tolerance, message) {
      if (Math.abs(actual - expected) <= tolerance) pass(message);
      else failures.push(message + ' (expected ~' + expected + ' ±' + tolerance + ', got ' + actual + ')');
    },
    done() {
      if (failures.length) {
        console.error(title + ': ' + failures.length + ' failed, ' + passed + ' passed');
        failures.forEach((f) => console.error('  FAIL ' + f));
        // Let open sockets wind down before exiting; force it if something keeps the loop alive.
        process.exitCode = 1;
        const timer = setTimeout(() => process.exit(1), 800);
        if (timer.unref) timer.unref();
        return;
      }
      console.log(title + ': all ' + passed + ' checks passed');
    }
  };
}
