// Real browser rendering/HUD/replication checks; advance authoritative match time rather than waiting 26 minutes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-storm');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 2,
  log: { info() {}, warn: console.warn, error: console.error } });
let browser;
const checks = [], traces = [], geometry = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
const fractions = [0.8, 0.5, 0.2, 0.05, 0.025, 0];
const lerp = (a, b, t) => a + (b - a) * t;
const close = (a, b, tolerance = 0.11) => Math.abs(a - b) < tolerance;

// Independent 1024x1024 midpoint grid over playable land, rather than the production radius solver.
function gridAreaFractions(size, corner, circles) {
  const n = 1024, step = size / n, safe = circles.map(() => 0);
  let land = 0;
  for (let row = 0; row < n; row++) {
    const y = (row + 0.5) * step, cy = Math.max(corner, Math.min(size - corner, y));
    for (let col = 0; col < n; col++) {
      const x = (col + 0.5) * step, cx = Math.max(corner, Math.min(size - corner, x));
      if ((x - cx) ** 2 + (y - cy) ** 2 > corner ** 2) continue;
      land++;
      circles.forEach((c, i) => { if ((x - c.x) ** 2 + (y - c.y) ** 2 <= c.r ** 2) safe[i]++; });
    }
  }
  return safe.map(count => count / land);
}

try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const mapKey = async () => {
    await browser.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyM', key: 'm', windowsVirtualKeyCode: 77 });
    await sleep(70);
    await browser.cmd('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyM', key: 'm', windowsVirtualKeyCode: 77 });
    await sleep(70);
  };
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  await evaluate(() => {
    window.stormQA = { render: null, map: null, mini: null };
    function capture(ctx, draw) {
      const arcs = [], arc = ctx.arc;
      ctx.arc = function (x, y, r, ...rest) { arcs.push({ x, y, r }); return arc.call(this, x, y, r, ...rest); };
      try { draw(); } finally { ctx.arc = arc; }
      return arcs;
    }
    const renderer = Warz.debug.renderer(), original = renderer.drawStorm;
    renderer.drawStorm = function (ctx, storm, view) {
      stormQA.render = { storm: storm ? { x: storm.x, y: storm.y, r: storm.r, state: storm.state } : null,
        arcs: capture(ctx, () => original.call(this, ctx, storm, view)) };
    };
    const overlay = Warz.MapArt.overlay;
    Warz.MapArt.overlay = function (ctx, world, player, px, opts) {
      const arcs = capture(ctx, () => overlay.call(this, ctx, world, player, px, opts));
      stormQA[opts.big ? 'map' : 'mini'] = { arcs, scale: px / world.map.size, px };
    };
  });

  for (const online of [false, true]) {
    const label = online ? 'Online' : 'Practice';
    if (online) {
      await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('solo'); });
      await browser.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>1');
    } else await evaluate(() => Warz.App.startPractice());
    const live = online ? app.matches.get(String(await evaluate(() => Warz.debug.match().id))) : null;
    const owner = live ? live.byId.get(await evaluate(() => Warz.debug.player().id)) : null;
    if (live) {
      // Stop only this QA-owned match timer. World state still crosses the real socket as server messages.
      clearInterval(live.timer); live.timer = null;
      for (const p of live.players) { p.controller = () => ({ mx: 0, my: 0 }); p.hp = p.maxHp; p.dropT = 0; }
    } else {
      await evaluate(() => {
        const world = Warz.debug.match().world, update = world.update;
        world.stormQaTime = 0;
        world.update = function (dt) { this.time = this.stormQaTime - dt; update.call(this, dt); };
      });
    }
    const data = live ? { size: live.world.map.size, corner: live.W.CONFIG.cornerRadius,
      circles: live.world.storm.circles, phases: live.W.STORM } : await evaluate(() => {
      const w = Warz.debug.match().world;
      return { size: w.map.size, corner: Warz.CONFIG.cornerRadius, circles: w.storm.circles, phases: Warz.STORM };
    });
    const map = await evaluate(() => {
      const m = Warz.debug.match().world.map, counts = {};
      m.crates.forEach(c => { counts[c.tier] = (counts[c.tier] || 0) + 1; });
      const legendary = m.crates.filter(c => c.tier === 'legendary');
      return { size: m.size, counts, total: m.crates.length, center: legendary.length === 1 && legendary[0].x === m.size / 2 && legendary[0].y === m.size / 2 };
    });
    check(map.size === 48000 && data.size === 48000 && map.total === 211 && map.center &&
      Object.entries({ common: 168, rare: 21, epic: 17, mythic: 4, legendary: 1 }).every(([tier, count]) => map.counts[tier] === count),
    label + ': 48,000-unit island has 210 regular crates at the existing rarity split plus one center Legendary');
    check(JSON.stringify(data.phases.map(p => p.safeArea)) === JSON.stringify(fractions) &&
      data.phases.every((p, i) => p.start - (i ? data.phases[i - 1].end : 0) === 150 + i * 30),
    label + ': all six safe-area targets and 150/180/210/240/270/300-second pauses are loaded');
    const measured = gridAreaFractions(data.size, data.corner, data.circles);
    geometry.push({ label, circles: data.circles, measured });
    check(measured.every((area, i) => Math.abs(area - [1, ...fractions][i]) < 0.001),
      label + ': independent land sampling confirms 100%, 80%, 50%, 20%, 5%, 2.5% and 0% safe areas');
    check(data.circles.slice(1).every((c, i) => Math.hypot(c.x - data.circles[i].x, c.y - data.circles[i].y) + c.r <= data.circles[i].r + 0.01) &&
      data.circles.slice(1).some((c, i) => Math.hypot(c.x - data.circles[i].x, c.y - data.circles[i].y) > 10),
    label + ': target circles have randomized centers and remain inside their previous circles');

    const advance = async (time, expected) => {
      if (live) {
        const w = live.world;
        w.time = time; owner.x = expected.x; owner.y = expected.y; owner.px = owner.x; owner.py = owner.y;
        owner.vx = owner.vy = 0; owner.dropT = 0; owner.hp = owner.maxHp;
        w.storm.update(0);
        live.broadcast(live.stormMessage()); live.sendSnapshots(w.events.splice(0));
      } else {
        await evaluate((time, expected) => {
          const m = Warz.debug.match(), p = m.player;
          m.world.stormQaTime = m.world.time = time; p.x = p.px = expected.x; p.y = p.py = expected.y;
          p.vx = p.vy = 0; p.dropT = 0; p.hp = p.maxHp; m.world.storm.update(0);
          m.cam.x = p.x; m.cam.y = p.y; m.cam.zoom = 1;
        }, time, expected);
      }
      await browser.waitFor('Warz.debug.match().world.storm.state===' + JSON.stringify(expected.state) +
        ' && Warz.debug.match().world.storm.phase===' + expected.phase +
        ' && Math.abs(Warz.debug.match().world.storm.r-' + expected.r + ')<0.11');
      await sleep(140);
      return evaluate(() => {
        const m = Warz.debug.match(), s = m.world.storm;
        return { time: m.world.time, storm: { x: s.x, y: s.y, r: s.r, next: s.next, state: s.state, phase: s.phase, timeLeft: s.timeLeft },
          render: stormQA.render, map: stormQA.map, mini: stormQA.mini,
          hud: document.getElementById('hud-storm-text').textContent, inStorm: m.player.inStorm };
      });
    };
    const assertTrace = (trace, expected, message) => {
      const s = trace.storm, current = trace.render;
      const hasArc = (arcs, x, y, r) => arcs.some(a => close(a.x, x) && close(a.y, y) && close(a.r, r));
      check(close(s.x, expected.x) && close(s.y, expected.y) && close(s.r, expected.r) &&
        s.state === expected.state && s.phase === expected.phase && close(s.timeLeft, expected.timeLeft) &&
        hasArc(current.arcs, s.x, s.y, Math.max(0.5, s.r)) &&
        ['map', 'mini'].every(key => {
          const part = trace[key], scale = part.scale;
          return hasArc(part.arcs, s.x * scale, s.y * scale, Math.max(0.5, s.r * scale)) &&
            (!s.next || hasArc(part.arcs, s.next.x * scale, s.next.y * scale, Math.max(1, s.next.r * scale)));
        }) && (!s.next || hasArc(current.arcs, s.next.x, s.next.y, Math.max(1, s.next.r))), message);
      traces.push({ label, expected, ...trace });
    };
    await mapKey(); await browser.waitFor('Warz.MapScreen.isOpen()');
    for (let i = 0; i < data.phases.length; i++) {
      const ph = data.phases[i], from = data.circles[i], to = data.circles[i + 1];
      const waitAt = (i ? data.phases[i - 1].end : 0) + 0.5;
      let expected = { ...from, state: 'waiting', phase: i, timeLeft: ph.start - waitAt };
      let trace = await advance(waitAt, expected);
      assertTrace(trace, expected, label + ' phase ' + (i + 1) + ': current/next circles and pause countdown reach the world, minimap and expanded map');
      check(trace.hud.startsWith(i === 0 ? 'Storm forms in ' : 'Storm moves in '), label + ' phase ' + (i + 1) + ': HUD explains the waiting period');
      expected = { x: lerp(from.x, to.x, 0.5), y: lerp(from.y, to.y, 0.5), r: lerp(from.r, to.r, 0.5),
        state: 'shrinking', phase: i, timeLeft: (ph.end - ph.start) / 2 };
      trace = await advance((ph.start + ph.end) / 2, expected);
      assertTrace(trace, expected, label + ' phase ' + (i + 1) + ': center and radius animate halfway to the authoritative target');
      check(trace.hud.startsWith('Storm closing'), label + ' phase ' + (i + 1) + ': HUD shows the closing countdown');
      const final = i === data.phases.length - 1, endAt = ph.end + 0.5;
      expected = { ...to, state: final ? 'final' : 'waiting', phase: i + 1,
        timeLeft: final ? 0 : data.phases[i + 1].start - endAt };
      trace = await advance(endAt, expected);
      assertTrace(trace, expected, label + ' phase ' + (i + 1) + ': reached ' + (fractions[i] * 100) + '% safe area and the correct next state');
      if ([0, 2, 4, 5].includes(i)) await browser.shot(label.toLowerCase() + '-safe-' + String(fractions[i] * 100).replace('.', '_') + '.png');
      if (final) check(trace.storm.r === 0 && trace.storm.next === null && trace.inStorm && trace.hud.includes('In the storm!'),
        label + ': final zero-radius storm has no safe center, no next circle and the danger HUD');
    }
    await mapKey();
    await browser.shot(label.toLowerCase() + '-final-world.png');
  }
  check(browser.errors.length === 0, 'No browser exceptions while tracing every storm phase in Practice and multiplayer');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, geometry, traces, errors: browser.errors }, null, 2));
  console.log('Storm browser QA: all ' + checks.length + ' checks passed');
} finally {
  if (browser) await browser.close();
  await app.close();
}
