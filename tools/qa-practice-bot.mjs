// Exercise Settings, passive target survival, hit feedback and offline-only guards.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedUrl = process.env.WARZ_QA_URL || '';
const outDir = path.join(root, 'output', publishedUrl ? 'qa-live-practice-bot' : 'qa-practice-bot');
const app = publishedUrl ? null : createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: .2, botFill: 2,
  log: { info() {}, warn: console.warn, error: console.error } });
let b; const checks = [], screenshots = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
try {
  const port = app ? (await app.listen(0, '127.0.0.1')).port : null;
  b = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const click = async selector => {
    const point = await evaluate(selector => {
      const el = document.querySelector(selector); el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit !== el && !el.contains(hit)) throw new Error('Control covered: ' + selector);
      return { x, y };
    }, selector);
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await b.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(80);
  };
  const pause = async () => {
    for (const type of ['rawKeyDown', 'keyUp']) await b.cmd('Input.dispatchKeyEvent', { type, code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 });
    await b.waitFor('!document.getElementById("pause-menu").hidden');
  };
  const shot = async name => screenshots.push(await b.shot(name));
  await b.cmd('Page.navigate', { url: publishedUrl || 'http://127.0.0.1:' + port + '/?seed=57' });
  await b.waitFor('window.Warz?.App?.ready && typeof Warz.World.prototype.spawnPracticeBot === "function"');
  await click('#settings-btn');
  check(await evaluate(() => document.getElementById('settings-practice-tools').hidden), 'Main-menu Settings hides in-match Practice tools');
  await click('#settings-dialog [data-close]');
  await evaluate(() => {
    Warz.App.startPractice();
    const m = Warz.debug.match(), w = m.world, p = m.player;
    for (const key of ['rocks', 'trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations', 'drops']) w.map[key] = [];
    w.structures = []; w.vehicles = []; w.storm = null; w.solids = new Warz.U.SpatialHash(256);
    p.x = p.px = m.cam.x = 5000; p.y = p.py = m.cam.y = 5000; p.vx = p.vy = p.ox = p.oy = 0; p.dropT = 0; p.angle = 0; m.cam.zoom = 1;
    Warz.debug.renderer().map = null;
    window.practiceTargetQA = { labels: 0, hits: 0 };
    const text = CanvasRenderingContext2D.prototype.fillText, damage = w.damagePlayer;
    CanvasRenderingContext2D.prototype.fillText = function (textValue) { if (String(textValue).includes('∞ HP')) practiceTargetQA.labels++; return text.apply(this, arguments); };
    w.damagePlayer = function (target) { if (target.practiceBot) practiceTargetQA.hits++; return damage.apply(this, arguments); };
  });
  check(await evaluate(() => !Warz.debug.match().online && Warz.debug.match().world.practice), 'Fixture is genuine offline Practice, never a public match');
  await pause(); await click('#pause-settings-btn');
  check(await evaluate(() => !document.getElementById('settings-practice-tools').hidden && !document.getElementById('settings-spawn-bot').disabled), 'Pause → Settings exposes the enabled Spawn practice bot button');
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await b.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(100);
    await evaluate(() => document.getElementById('settings-spawn-bot').scrollIntoView({ block: 'center' }));
    check(await evaluate(() => {
      const button = document.getElementById('settings-spawn-bot'), r = button.getBoundingClientRect(), panel = button.closest('.modal-card');
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.height >= 36 && panel.scrollWidth <= panel.clientWidth;
    }), width + 'px Settings keeps the spawn control readable and inside the dialog');
    await shot('settings-' + width + '.png');
  }
  await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await click('#settings-spawn-bot');
  check(await evaluate(() => {
    const m = Warz.debug.match(), bot = m.world.players.find(p => p.practiceBot);
    return m.world.players.length === 2 && bot.alive && bot.team !== m.player.team && Math.hypot(bot.x - m.player.x, bot.y - m.player.y) <= 380 && m.world.spotFree(bot.x, bot.y, bot.r, true);
  }), 'One Settings click spawns one nearby enemy target');
  check(await evaluate(() => /unlimited HP, no attacks/.test(document.getElementById('settings-practice-status').textContent)), 'Settings reports unlimited HP and no attacks');
  await click('#settings-spawn-bot');
  check(await evaluate(() => {
    const bots = Warz.debug.match().world.players.filter(p => p.practiceBot);
    return bots.length === 2 && Math.hypot(bots[0].x - bots[1].x, bots[0].y - bots[1].y) >= bots[0].r + bots[1].r;
  }), 'Additional clicks spawn distinct non-overlapping targets');
  await click('#settings-dialog [data-close]'); await click('#resume-btn');
  await b.waitFor('practiceTargetQA.labels > 0');
  check(await evaluate(() => practiceTargetQA.labels > 0), 'Actual game rendering shows the persistent infinity-HP label');
  await evaluate(() => { const p = Warz.debug.player(), target = Warz.debug.match().world.players.find(p => p.practiceBot); window.targetStart = { x: target.x, y: target.y, playerHp: p.hp }; });
  const aim = await evaluate(() => { const m = Warz.debug.match(), target = m.world.players.find(p => p.practiceBot); return Warz.debug.renderer().worldToScreen(m.cam, target.x, target.y); });
  await b.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', ...aim });
  await b.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...aim, button: 'left', buttons: 1, clickCount: 1 });
  await b.waitFor('Warz.debug.player().stats.damage >= 200', 6000);
  await b.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...aim, button: 'left', buttons: 0, clickCount: 1 });
  check(await evaluate(() => {
    const m = Warz.debug.match(), target = m.world.players.find(p => p.practiceBot);
    return target.alive && target.hp === target.maxHp && m.player.stats.hits >= 10 && m.player.stats.kills === 0 && practiceTargetQA.hits >= 10;
  }), 'Real held fire deals over a normal health bar of damage with hits, while the target survives');
  check(await evaluate(() => {
    const m = Warz.debug.match(), target = m.world.players.find(p => p.practiceBot);
    return target.stats.shots === 0 && m.player.hp === targetStart.playerHp && target.x === targetStart.x && target.y === targetStart.y;
  }), 'Target never shoots back or moves during shooting practice');
  await shot('shooting-target.png');
  check(await evaluate(() => {
    const m = Warz.debug.match(), target = m.world.players.find(p => p.practiceBot);
    ['lightning', 'meteor', 'tank-cannon', 'storm'].forEach(cause => m.world.damagePlayer(target, 1000000, m.player.id, cause, target.x, target.y));
    return target.alive && !target.downed && target.hp === target.maxHp && Number.isFinite(target.hp);
  }), 'Extreme strike, tank, and storm damage cannot kill the Practice target');
  await evaluate(() => { Warz.App.leaveMatch(); Warz.App.startPractice(); Warz.debug.player().dropT = 0; });
  check(await evaluate(() => Warz.debug.match().world.players.length === 1), 'Starting fresh Practice removes every previously spawned target');
  if (app) {
    await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('solo'); });
    await b.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>1');
    await pause(); await click('#pause-settings-btn');
    check(await evaluate(() => document.getElementById('settings-practice-tools').hidden && document.getElementById('settings-spawn-bot').disabled && !Warz.debug.match().world.practice), 'Real local multiplayer hides and disables the Practice spawn controls');
    check(await evaluate(() => {
      const m = Warz.debug.match(), before = m.world.players.length;
      document.getElementById('settings-spawn-bot').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const result = m.world.spawnPracticeBot(m.player);
      return !result && m.world.players.length === before && !m.world.players.some(p => p.practiceBot);
    }), 'Even directly invoking hidden handlers cannot spawn targets in multiplayer');
  }
  check(b.errors.length === 0, 'No browser exceptions in settings, target combat, or rendering');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ published: !!publishedUrl, checks, screenshots, errors: b.errors }, null, 2));
  console.log('Practice bot browser QA: all ' + checks.length + ' checks passed');
} finally { if (b) await b.close(); if (app) await app.close(); }
