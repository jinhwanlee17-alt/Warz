import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const outDir = path.resolve('output/qa-military-bases');
const app = createApp({ dataDir: null });
let browser;
try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir, width: 1440, height: 1000 });
  const run = fn => browser.evaluate('(' + fn.toString() + ')()');
  const key = (code, down) => browser.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp',
    code, key: code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(code.length - 1) });
  async function press(code, ms = 100) { await key(code, true); await sleep(ms); await key(code, false); }
  for (const seed of [1, 16]) {
    const name = seed === 1 ? 'regular' : 'big';
    await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=' + seed });
    await browser.waitFor('window.Warz?.App?.ready');
    await run(() => {
      Warz.App.startPractice();
      const { world, player } = Warz.debug.match(), base = world.map.militaryBases[0];
      player.dropT = 0;
      // Keep the tour still while checking physical entrances and interaction keys.
      world.structures.filter(s => s.militaryBase).forEach(s => { s.cooldown = 1000; });
      Warz.debug.teleport(base.x, base.y + 120);
      Warz.Hud.banner('', '', .01);
    });
    await browser.waitFor('document.querySelector(".buff-baseLocal")');
    assert.equal(await run(() => Warz.debug.match().world.map.militaryBases.length), seed === 1 ? 2 : 1);
    await press('KeyM');
    await browser.waitFor('Warz.MapScreen.isOpen()');
    await browser.shot(name + '-island.png');
    await press('KeyM');
    await browser.waitFor('!Warz.MapScreen.isOpen()');
    const overview = await run(() => {
      const m = Warz.debug.match(), b = m.world.map.militaryBases[0];
      // Capture the same canvas renderer at a zoom that fits the entire compound.
      Warz.debug.renderer().render(m.world, { x: b.x, y: b.y, zoom: b.big ? .21 : .39 }, { viewer: m.player });
      return document.getElementById('game').toDataURL().split(',')[1];
    });
    await writeFile(path.join(outDir, name + '-base.png'), Buffer.from(overview, 'base64'));
    await run(() => {
      const m = Warz.debug.match(), base = m.world.map.militaryBases[0];
      const yellow = m.world.map.crates.find(c => c.militaryBase === base.id && c.tier === 'token');
      const b = m.world.map.buildings[yellow.building], door = b.doorways[0];
      window.qaBarracks = b;
      Warz.debug.teleport(door.x - 36, door.y + door.h / 2);
    });
    await press('KeyD', 650);
    await browser.waitFor('Warz.debug.player().x > qaBarracks.x + 22 && qaBarracks.fade < .05');
    await browser.shot(name + '-barracks.png');
    await run(() => {
      const turret = Warz.debug.match().world.structures.find(s => s.militaryBase && s.aiRider);
      Warz.debug.teleport(turret.x, turret.y + 70);
    });
    await press('KeyE');
    await browser.waitFor('Warz.debug.player().mount && document.querySelector(".buff-baseGlobal")');
    await press('KeyE');
    await browser.waitFor('!Warz.debug.player().mount && document.querySelector(".buff-baseGlobal")');
    await run(() => {
      const base = Warz.debug.match().world.map.militaryBases[0];
      Warz.debug.teleport(base.x, base.y - base.halfH - 125);
    });
    await browser.waitFor('!document.querySelector(".buff-baseGlobal") && document.querySelector(".buff-baseLocal b")');
    await run(() => {
      const { world, player } = Warz.debug.match();
      const crate = world.map.crates.find(c => c.tier === 'classToken' && c.building !== undefined);
      world.damageCrate(crate, crate.hp, player.id, crate.x, crate.y);
      Warz.debug.teleport(crate.x, crate.y);
      window.qaUpgradeStation = world.map.stations.find(s => s.building === crate.building);
    });
    await browser.waitFor('Warz.debug.player().classTokens === 1 && !document.getElementById("hud-class-tokens").hidden');
    await run(() => Warz.debug.teleport(qaUpgradeStation.x - 75, qaUpgradeStation.y));
    await browser.waitFor('Warz.debug.player().nearStation === qaUpgradeStation');
    await press('KeyE');
    await browser.waitFor('Warz.UpgradeTree.isOpen()');
    await run(() => {
      document.getElementById('ut-node-medic').click();
      document.getElementById('ut-action').click();
    });
    await browser.waitFor('Warz.debug.player().classId === "medic" && Warz.debug.player().classTokens === 0');
    assert.equal(await run(() => Warz.debug.player().tokens), 0);
    console.log(name + ' base passed map, barracks entrance, turret alerts and free station upgrade');
  }
  assert.deepEqual(browser.errors, []);
} finally {
  if (browser) await browser.close();
  await app.close();
}
