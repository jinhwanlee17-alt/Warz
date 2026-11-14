// Actual browser rendering, controls and client/server geography for the biome island.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-biomes');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: .2, botFill: 2, log: { info() {}, warn() {}, error: console.error } });
let b;
const checks = [], shots = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
try {
  const { port } = await app.listen(0, '127.0.0.1');
  b = await openBrowser({ outDir, width: 1440, height: 1000 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const press = async code => {
    const key = code === 'Escape' ? 'Escape' : code.slice(-1).toLowerCase(), vk = code === 'Escape' ? 27 : code.charCodeAt(code.length - 1);
    await b.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key, windowsVirtualKeyCode: vk });
    await sleep(60);
    await b.cmd('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
    await sleep(100);
  };
  await b.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=1' });
  await b.waitFor('window.Warz?.App?.ready && Warz.Net.online()');
  await evaluate(() => {
    Warz.App.startPractice();
    const m = Warz.debug.match();
    m.world.storm = null; m.player.dropT = 0;
    Warz.Hud.banner('', '', .01);
  });
  const layout = await evaluate(() => {
    const m = Warz.debug.match().world.map;
    return { size: m.size, regions: m.biomes, towns: m.towns, cells: Warz.Biomes.cells(m),
      trees: m.trees.length, bushes: m.bushes.length, cacti: m.cacti.length, itemName: Warz.ITEMS.firenade.name };
  });
  check(layout.size === 48000 && layout.regions.length === 5, 'browser generates the doubled island with five selected biome regions');
  check(layout.itemName === 'Molotov' && layout.trees > 0 && layout.bushes > 0 && layout.cacti > 0, 'Molotov, foliage and desert cacti are present');
  await press('KeyM');
  await b.waitFor('Warz.MapScreen.isOpen()');
  shots.push(await b.shot('island-biomes.png'));
  await b.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await sleep(250);
  check(await evaluate(() => {
    const r = document.getElementById('bigmap').getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  }), 'biome map remains inside the mobile viewport');
  shots.push(await b.shot('island-biomes-mobile.png'));
  await press('Escape');
  await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const id of [...new Set(layout.cells.map(c => c.id))]) {
    const spot = await evaluate(id => {
      const m = Warz.debug.match(), cell = Warz.Biomes.cells(m.world.map).filter(c => c.id === id).sort((a, b) => b.w * b.h - a.w * a.h)[0];
      if (!cell) return null;
      let x = cell.x + cell.w / 2, y = cell.y + cell.h / 2;
      const plants = id === 'desert' || id === 'savannah' ? m.world.map.cacti : m.world.map.trees;
      const plant = plants.find(p => Warz.Biomes.at(m.world.map, p.x, p.y) === id);
      if (plant) { x = plant.x + 90; y = plant.y + 90; }
      Warz.debug.teleport(x, y); m.cam.x = m.player.x; m.cam.y = m.player.y; m.cam.zoom = 1;
      return { x, y };
    }, id);
    if (!spot) continue;
    await sleep(200);
    shots.push(await b.shot('terrain-' + id + '.png'));
  }
  await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('solo'); });
  await b.waitFor('Warz.App.state() === "play" && Warz.debug.match().online && Warz.debug.online().snapCount > 1', 30000);
  const matchId = await evaluate(() => Warz.debug.match().id), live = app.matches.get(String(matchId));
  const replica = await evaluate(() => {
    const m = Warz.debug.match().world.map;
    return { size: m.size, biomes: m.biomes, towns: m.towns.map(t => [t.kind, t.x, t.y]),
      plants: [m.trees.length, m.bushes.length, m.cacti.length],
      rings: [...m.vehicles, ...m.tanks, ...m.artillery, ...m.groundArtillery].map(v => [v.x, v.y]) };
  });
  const map = live.world.map;
  check(replica.size === map.size && JSON.stringify(replica.biomes) === JSON.stringify(map.biomes) &&
    JSON.stringify(replica.towns) === JSON.stringify(map.towns.map(t => [t.kind, t.x, t.y])) &&
    replica.plants.join() === [map.trees.length, map.bushes.length, map.cacti.length].join(),
  'browser and server agree on biome choices, settlements and vegetation');
  const rings = [...map.vehicles, ...map.tanks, ...map.artillery, ...map.groundArtillery];
  check(replica.rings.every((v, i) => Math.hypot(v[0] - rings[i].x, v[1] - rings[i].y) < 1e-7), 'all four vehicle groups match authoritative ring positions');
  await press('KeyM');
  await b.waitFor('Warz.MapScreen.isOpen()');
  shots.push(await b.shot('online-biomes.png'));
  check(b.errors.length === 0, 'offline and online biome rendering run without browser exceptions');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, shots, layout, errors: b.errors }, null, 2));
  console.log('Biome browser QA: all ' + checks.length + ' checks passed');
} finally {
  if (b) await b.close();
  await app.close();
}
