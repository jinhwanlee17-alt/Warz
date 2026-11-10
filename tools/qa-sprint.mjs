// Physical Shift/movement inputs through Practice and a real multiplayer match.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-sprint');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 2,
  log: { info() {}, warn: console.warn, error: console.error } });
const checks = [], check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
let browser;
function prepare(W, w, p) {
  ['rocks', 'trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations'].forEach(k => w.map[k] = []);
  w.solids = new W.U.SpatialHash(256);
  w.resetItems(p); w.setClass(p, 'soldier', true);
  p.x = 5000; p.y = 5000; p.vx = p.vy = 0; p.dropT = 0; p.alive = true; p.downed = false;
  p.stamina = 100; p.sprintExhausted = false; p.sprintRestT = 0; p.sprinting = false;
}
try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = (code, down) => browser.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code,
    key: code === 'ShiftLeft' ? 'Shift' : 'd', windowsVirtualKeyCode: code === 'ShiftLeft' ? 16 : 68 });
  const read = () => evaluate(() => {
    const p = Warz.debug.player();
    return { stamina: p.stamina, exhausted: p.sprintExhausted, rest: p.sprintRestT, sprinting: p.sprinting,
      speed: Math.hypot(p.vx, p.vy), text: document.getElementById('hud-stamina-text').textContent };
  });
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=22' });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  check(await evaluate(() => Warz.Controls.primary('sprint') === 'L Shift'), 'Left Shift is the default sprint binding');
  for (const online of [false, true]) {
    const label = online ? 'Online' : 'Practice';
    if (online) {
      await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('solo'); });
      await browser.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.player().dropT===0');
    } else await evaluate(() => Warz.App.startPractice());
    const live = online ? app.matches.get(String(await evaluate(() => Warz.debug.match().id))) : null;
    const owner = online ? live.byId.get(await evaluate(() => Warz.debug.player().id)) : null;
    if (live) {
      prepare(live.W, live.world, owner);
      for (const p of live.players.filter(p => p !== owner)) { p.controller = () => ({ mx: 0, my: 0 }); p.x = p.y = 12000; }
    }
    await evaluate((src, online) => {
      const m = Warz.debug.match(); (0, eval)('(' + src + ')')(Warz, m.world, m.player);
      if (!online) m.world.storm = null;
      m.cam.x = m.player.x; m.cam.y = m.player.y; m.cam.zoom = 1;
    }, prepare.toString(), online);
    const setStamina = async (value, exhausted) => {
      if (owner) { owner.stamina = value; owner.sprintExhausted = exhausted; owner.sprintRestT = 0; }
      await evaluate((value, exhausted) => {
        const p = Warz.debug.player(); p.stamina = value; p.sprintExhausted = exhausted; p.sprintRestT = 0;
      }, value, exhausted);
    };
    await key('KeyD', true);
    await browser.waitFor('Warz.debug.player().vx>260');
    let p = await read();
    check(p.stamina === 100 && !p.sprinting && p.speed < 280, label + ': walking uses normal speed and preserves full stamina');
    await key('ShiftLeft', true);
    await browser.waitFor('Warz.debug.player().sprinting && Warz.debug.player().vx>390');
    const sprintStart = await read(); await sleep(600); p = await read();
    check(p.stamina < sprintStart.stamina - 3 && p.stamina > sprintStart.stamina - 10, label + ': held sprint drains stamina at about 10 per second');
    check(p.speed > 395 && p.speed <= 406, label + ': sprint reaches the 50 percent speed boost');
    check(p.text.startsWith(Math.round(p.stamina) + ' / 100'), label + ': stamina HUD shows a rounded whole number');
    if (owner) check(owner.sprinting && owner.stamina < 100 && owner.vx > 390, 'Online: the server applies sprint speed and stamina');
    await browser.shot(label.toLowerCase() + '-sprinting.png');
    await key('ShiftLeft', false);
    await browser.waitFor('!Warz.debug.player().sprinting');
    const walkStart = await read(); await sleep(400); p = await read();
    check(p.stamina > walkStart.stamina + 3 && p.stamina < walkStart.stamina + 9, label + ': releasing sprint regenerates immediately while walking');
    await key('KeyD', false); await sleep(150); await setStamina(40, false);
    await sleep(450); p = await read();
    check(Math.abs(p.stamina - 40) < 0.01, label + ': a complete stop waits before regeneration');
    await browser.waitFor('Warz.debug.player().sprintRestT>=1');
    const restStart = await read(); await sleep(500); p = await read();
    check(p.stamina > restStart.stamina + 10 && p.stamina < restStart.stamina + 21, label + ': after one second resting regenerates at 30 per second');
    await setStamina(0, true); await key('KeyD', true); await key('ShiftLeft', true);
    await browser.waitFor('Warz.debug.player().stamina>5'); p = await read();
    check(p.exhausted && !p.sprinting && p.speed < 285, label + ': empty stamina locks sprint while the bar recovers');
    check(p.text.includes('Recovering'), label + ': HUD explains the exhaustion lockout');
    await browser.shot(label.toLowerCase() + '-exhausted.png');
    await setStamina(99, true);
    await browser.waitFor('!Warz.debug.player().sprintExhausted && Warz.debug.player().sprinting');
    check((await read()).stamina > 97, label + ': sprint becomes available again only after reaching full stamina');
    await key('ShiftLeft', false); await key('KeyD', false);
    check(await evaluate(() => {
      const m = Warz.debug.match(), p = m.player;
      p.stamina = 42.49; Warz.Hud.update(m.world, p, 0, {});
      const low = document.getElementById('hud-stamina-text').textContent.startsWith('42 / 100') && p.stamina === 42.49;
      p.stamina = 42.5; Warz.Hud.update(m.world, p, 0, {});
      const high = document.getElementById('hud-stamina-text').textContent.startsWith('43 / 100') && p.stamina === 42.5;
      const a = document.getElementById('hud-stamina').getBoundingClientRect(), b = document.querySelector('.bar-armor').getBoundingClientRect();
      return low && high && a.bottom <= b.top;
    }), label + ': rounding preserves fractions and the stamina bar sits above armor');
  }
  await evaluate(() => Warz.App.leaveMatch());
  check(browser.errors.length === 0, 'no browser exceptions');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, errors: browser.errors }, null, 2));
  console.log('Sprint browser QA: ' + checks.length + ' checks passed.');
} finally { if (browser) await browser.close(); await app.close(); }
