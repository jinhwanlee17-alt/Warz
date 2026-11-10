// Real browser regression: dropped render frames must not slow the online input clock.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
const require = createRequire(import.meta.url);
const { openBrowser, sleep } = require('./qa-browser.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-lag');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 50, log: { info() {}, warn: console.warn, error: console.error } });
let browser;
try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir });
  await browser.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `
    const nativeFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => nativeFrame(time => {
      if (window.qaFrameDelay) setTimeout(() => callback(performance.now()), window.qaFrameDelay);
      else callback(time);
    });
  ` });
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?demoSeed=99' });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  await browser.evaluate('Warz.Lobby.queue("solo"); true');
  await browser.waitFor('Warz.App.state() === "play" && Warz.debug.player().dropT === 0', 20000);
  const live = app.matches.get(String(await browser.evaluate('Warz.debug.online().info.id')));
  const player = live.byId.get(await browser.evaluate('Warz.debug.player().id'));
  player.hp = player.maxHp = 1e6;
  const read = () => browser.evaluate('({ seq: Warz.debug.online().seq, time: performance.now(), pending: Warz.debug.online().pending.length })');
  const samples = [];
  for (const delay of [0, 100]) {
    await browser.evaluate('window.qaFrameDelay = ' + delay);
    await sleep(500);
    const before = await read();
    await sleep(3000);
    const after = await read();
    samples.push({ frameDelayMs: delay, inputHz: (after.seq - before.seq) * 1000 / (after.time - before.time), pending: after.pending });
  }
  // A long background-tab pause should resume promptly without flooding the connection.
  await browser.evaluate('window.qaFrameDelay = 1200');
  await sleep(1500);
  await browser.evaluate('window.qaFrameDelay = 0');
  await sleep(1500);
  const recovered = await read();
  await browser.evaluate('Warz.App.leaveMatch(); true');
  fs.writeFileSync(path.join(outDir, 'timing.json'), JSON.stringify({ samples, recoveredPending: recovered.pending, errors: browser.errors }, null, 2));
  console.log(JSON.stringify({ samples, recoveredPending: recovered.pending, errors: browser.errors }, null, 2));
  for (const sample of samples) assert.ok(sample.inputHz >= 17 && sample.inputHz <= 23, 'online input stays near 20 Hz with frame delay ' + sample.frameDelayMs);
  assert.ok(recovered.pending < 8, 'a long render pause does not leave an input backlog');
  assert.equal(browser.errors.length, 0, 'no browser errors');
  console.log('Input pacing browser checks passed.');
} finally {
  if (browser) await browser.close();
  await app.close();
}
