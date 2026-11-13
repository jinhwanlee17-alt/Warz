// Coastal drops, nested vehicle spawn contours and authoritative Legendary markers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-map-layout');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 8,
  log: { info() {}, warn: console.warn, error: console.error } });
let browser;
const checks = [], layouts = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const pressMap = async () => {
    await browser.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyM', key: 'm', windowsVirtualKeyCode: 77 });
    await sleep(80);
    await browser.cmd('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyM', key: 'm', windowsVirtualKeyCode: 77 });
    await sleep(80);
  };
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  await evaluate(() => {
    window.mapLayoutQA = { labels: [], full: [], mini: [], markerHistory: [] };
    const base = Warz.MapArt.base, overlay = Warz.MapArt.overlay;
    Warz.MapArt.base = function (map, px, opts) {
      const labels = [], original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
        if (opts.big && this.fillStyle === '#ffe9a8') labels.push({ text, x, y, width: this.measureText(text).width, height: parseFloat(this.font.match(/[\d.]+/)[0]) });
        return original.call(this, text, x, y, ...args);
      };
      try { return base.call(this, map, px, opts); }
      finally { CanvasRenderingContext2D.prototype.fillText = original; if (opts.big) mapLayoutQA.labels = { px, labels }; }
    };
    Warz.MapArt.overlay = function (g, world, player, px, opts) {
      const original = g.fillRect, originalText = g.fillText, markers = [];
      g.fillRect = function (x, y, w, h) { if (this.fillStyle === '#ffd44f') markers.push({ x, y, w, h }); return original.call(this, x, y, w, h); };
      g.fillText = function (text, x, y, ...args) {
        if (opts.big && text === 'You') mapLayoutQA.self = { x, y, width: this.measureText(text).width, height: parseFloat(this.font.match(/[\d.]+/)[0]) };
        return originalText.call(this, text, x, y, ...args);
      };
      try { return overlay.call(this, g, world, player, px, opts); }
      finally {
        g.fillRect = original; g.fillText = originalText; mapLayoutQA[opts.big ? 'full' : 'mini'] = markers;
        if (mapLayoutQA.recordReconnect) mapLayoutQA.markerHistory.push(markers.length);
      }
    };
  });

  const layout = async (mode, count, width, height) => {
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width === 390 ? 2 : 1, mobile: false });
    await sleep(170);
    const result = await evaluate(() => ({ ...mapLayoutQA.labels, marker: mapLayoutQA.full, mini: mapLayoutQA.mini, self: mapLayoutQA.self,
      width: innerWidth, height: innerHeight, singleCanvas: document.getElementById('map-screen').children.length === 1 }));
    layouts.push({ mode, ...result });
    check(result.labels.length === count && result.labels.every(l => l.x - l.width / 2 >= 0 && l.x + l.width / 2 <= result.px && l.y - l.height / 2 >= 0 && l.y + l.height / 2 <= result.px),
      mode + ' ' + width + 'px: all ' + count + ' coastal drop labels fit inside the map');
    check(result.labels.every((a, i) => result.labels.slice(0, i).every(b => Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2)),
      mode + ' ' + width + 'px: drop labels remain readable without overlapping each other');
    check(result.marker.length === 1 && result.mini.length === 1 && result.singleCanvas,
      mode + ' ' + width + 'px: one gold Legendary crate icon appears on both maps without extra panel clutter');
    check(result.self.x - result.self.width / 2 >= 0 && result.self.x + result.self.width / 2 <= result.px &&
      result.self.y - result.self.height / 2 >= 0 && result.self.y + result.self.height / 2 <= result.px,
      mode + ' ' + width + 'px: coastal You label remains entirely within the map');
    await browser.shot(mode + '-map-' + width + '.png');
  };

  await evaluate(() => { Warz.App.startPractice(); Warz.debug.player().dropT = 0; });
  await pressMap(); await browser.waitFor('Warz.MapScreen.isOpen()');
  check(await evaluate(() => { const w = Warz.debug.match().world; return w.map.drops.length === 50 && w.map.crates.length === 211; }),
    'Practice uses fifty coastal drops and 210 regular crates plus the center Legendary');
  await layout('practice', 50, 1440, 900); await layout('practice', 50, 390, 844);
  await evaluate(() => { const w = Warz.debug.match().world, c = w.map.crates.find(c => c.tier === 'legendary'); w.damageCrate(c, c.hp, null, c.x, c.y); });
  await browser.waitFor('mapLayoutQA.full.length===0 && mapLayoutQA.mini.length===0');
  check(true, 'Breaking the Practice Legendary removes both live map markers immediately');

  let finalLive, finalOwner;
  for (const [mode, teamSize, count] of [['solo', 1, 50], ['duo', 2, 25], ['trio', 3, 16], ['squad', 4, 12]]) {
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(mode => { Warz.App.leaveMatch(); Warz.Lobby.queue(mode); }, mode);
    await browser.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>1');
    const live = app.matches.get(String(await evaluate(() => Warz.debug.match().id))), owner = live.byId.get(await evaluate(() => Warz.debug.player().id));
    for (const p of live.players) if (p !== owner) p.controller = () => ({ mx: 0, my: 0 });
    owner.dropT = 0;
    const state = await evaluate(() => {
      const w = Warz.debug.match().world, m = w.map, S = m.size;
      const extent = v => Math.max(Math.abs(v.x - S / 2), Math.abs(v.y - S / 2)) / S;
      return { teamSize: m.teamSize, dropCount: m.drops.length, crates: m.crates.length,
        drops: m.drops.map(d => [d.x, d.y]), vehicles: m.vehicles.map(v => [v.x, v.y]),
        tanks: m.tanks.map(v => [v.x, v.y]), artillery: m.artillery.map(v => [v.x, v.y]),
        ring: m.vehicles.length === 8 && m.tanks.length === 4 && m.artillery.length === 4 &&
          m.vehicles.every(v => extent(v) >= .40 && extent(v) <= .46) &&
          m.artillery.every(v => extent(v) >= .30 && extent(v) <= .38) &&
          m.tanks.every(v => extent(v) >= .18 && extent(v) <= .25) };
    });
    // Chrome and Node trigonometry can differ at ~1e-12; this tolerance is far below one map pixel.
    const samePoints = (points, server) => points.length === server.length && points.every((p, i) => Math.hypot(p[0] - server[i].x, p[1] - server[i].y) < 1e-8);
    const agreement = { teamSize: state.teamSize, dropCount: state.dropCount, crates: state.crates, ring: state.ring,
      drops: samePoints(state.drops, live.world.map.drops), vehicles: samePoints(state.vehicles, live.world.map.vehicles),
      tanks: samePoints(state.tanks, live.world.map.tanks), artillery: samePoints(state.artillery, live.world.map.artillery) };
    layouts.push({ mode, state, agreement });
    check(state.teamSize === teamSize && state.dropCount === count && state.crates === 211 && state.ring && agreement.drops && agreement.vehicles && agreement.tanks && agreement.artillery,
      mode + ': client and server agree on outer Humvees, middle artillery, inner tanks, coastal drops and crates');
    await pressMap(); await browser.waitFor('Warz.MapScreen.isOpen()');
    await layout(mode, count, 1440, 900); await layout(mode, count, 390, 844);
    finalLive = live; finalOwner = owner;
  }
  const legendary = finalLive.world.map.crates.find(c => c.tier === 'legendary');
  const breaker = finalLive.players.find(p => p !== finalOwner);
  check(Math.hypot(finalOwner.x - legendary.x, finalOwner.y - legendary.y) > 3000, 'Viewer is far outside the center crate interest area');
  finalLive.world.damageCrate(legendary, legendary.hp, breaker.id, legendary.x, legendary.y);
  await browser.waitFor('!Warz.debug.match().world.map.crates.find(c=>c.tier==="legendary").alive && mapLayoutQA.full.length===0 && mapLayoutQA.mini.length===0');
  check(true, 'Another player breaking the Legendary removes full-map and minimap markers through the real socket');
  await browser.shot('online-legendary-broken.png');
  const ticket = finalLive.slots.find(s => s.player === finalOwner).ticket;
  await evaluate((id, ticket) => { mapLayoutQA.markerHistory = []; mapLayoutQA.recordReconnect = true; Warz.Online.join(id, ticket, true); }, String(finalLive.id), ticket);
  await browser.waitFor('Warz.debug.online().info.rejoin && Warz.debug.online().snapCount>2');
  await pressMap(); await browser.waitFor('Warz.MapScreen.isOpen()');
  await sleep(150);
  check(await evaluate(() => mapLayoutQA.full.length === 0 && mapLayoutQA.mini.length === 0 && mapLayoutQA.markerHistory.every(n => n === 0)),
    'Reconnect preserves the broken crate state without flashing a seeded marker');
  await browser.shot('online-rejoin-marker-absent.png');
  check(browser.errors.length === 0, 'No browser exceptions across all map modes, marker destruction or reconnect');
  console.log('Map layout browser QA: ' + checks.length + ' checks passed');
} finally {
  if (browser) {
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, layouts, errors: browser.errors }, null, 2));
    await browser.close();
  }
  await app.close();
}
