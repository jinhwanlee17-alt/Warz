// Native dropdowns must remain stable while the live Practice menu refreshes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-practice-picker');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: .2, botFill: 2, log: { info() {}, warn() {}, error: console.error } });
const checks = [];
let b;
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };

try {
  const { port } = await app.listen(0, '127.0.0.1');
  b = await openBrowser({ outDir, width: 1280, height: 900 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const frames = () => evaluate(() => new Promise(resolve => {
    let left = 18;
    const tick = () => { if (--left) requestAnimationFrame(tick); else resolve(); };
    requestAnimationFrame(tick);
  }));
  const click = async selector => {
    const point = await evaluate(selector => {
      const node = document.querySelector(selector);
      node.scrollIntoView({ block: 'center' });
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, selector);
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await b.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
  };
  const press = async code => {
    const key = { Escape: 'Escape', Home: 'Home', End: 'End', ArrowDown: 'ArrowDown', Enter: 'Enter', Tab: 'Tab', Digit5: '5' }[code];
    const vk = { Escape: 27, Home: 36, End: 35, ArrowDown: 40, Enter: 13, Tab: 9, Digit5: 53 }[code];
    await b.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key, windowsVirtualKeyCode: vk });
    await b.cmd('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
  };
  const resetObserver = () => evaluate(() => { window.pickerMutations = 0; });
  const mutations = () => evaluate(() => window.pickerMutations);

  await b.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
  await b.waitFor('window.Warz?.App?.ready');
  await evaluate(() => {
    Warz.App.startPractice();
    const match = Warz.debug.match();
    match.world.storm = null;
    match.player.dropT = 0;
    match.player.items = [null, null, null];
  });
  await press('Escape');
  await b.waitFor('!document.getElementById("pause-menu").hidden');
  check(await evaluate(() => !document.getElementById('practice-speed').hidden && document.getElementById('practice-speed').textContent === 'Movement speed: 1×'), 'offline Practice tools start at 1× speed');
  for (const speed of [1.5, 2, 3, 5, 10, 1]) {
    await click('#practice-speed');
    check(await evaluate(speed => {
      const m = Warz.debug.match(), button = document.getElementById('practice-speed');
      return m.player.practiceSpeed === speed && m.world.speedMul(m.player) === speed &&
        button.textContent === 'Movement speed: ' + speed + '×' && button.getAttribute('aria-pressed') === String(speed > 1);
    }, speed), 'Practice speed cycle reaches ' + speed + '× with the correct button state and movement');
    if (speed === 10) await b.shot('practice-speed-toggle.png');
  }
  await click('[data-test="items"]');
  await b.waitFor('!document.getElementById("practice-items").hidden');
  await evaluate(() => {
    const slot = document.getElementById('practice-item-slot');
    window.pickerOptions = [...slot.options];
    window.pickerMutations = 0;
    window.pickerObserver = new MutationObserver(records => { window.pickerMutations += records.length; });
    window.pickerObserver.observe(slot, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await frames();
  check(await mutations() === 0, 'unchanged slots cause no dropdown mutations across live game frames');

  await click('#practice-item');
  await press('Home');
  await press('ArrowDown');
  await press('Enter');
  const item = await evaluate(() => {
    const id = document.getElementById('practice-item').value;
    return { id, quantity: Warz.ITEMS[id].stack };
  });
  check(await evaluate(n => Number(document.getElementById('practice-item-quantity').value) === n, item.quantity), 'choosing an item updates its stack quantity');

  for (const slot of [2, 0, 1]) {
    await resetObserver();
    await click('#practice-item-slot');
    await frames();
    check(await mutations() === 0, 'slot ' + (slot + 1) + ': open native dropdown stays unchanged');
    await press('Home');
    for (let i = 0; i < slot; i++) await press('ArrowDown');
    await press('Enter');
    check(await evaluate(value => document.getElementById('practice-item-slot').value === String(value), slot), 'slot ' + (slot + 1) + ': native keyboard selection is retained');
    await click('#practice-items button[type="submit"]');
    await frames();
    check(await evaluate((slot, item) => {
      const p = Warz.debug.player(), actual = p.items[slot];
      return actual?.id === item.id && actual.n === item.quantity && p.held === -1 &&
        document.getElementById('practice-item-slot').options[slot].textContent.includes(Warz.ITEMS[item.id].name);
    }, slot, item), 'slot ' + (slot + 1) + ': submit places the selected stack without activating gameplay');
  }

  await click('#practice-item-slot');
  const labels = await evaluate(() => [...document.getElementById('practice-item-slot').options].map(o => o.textContent));
  await resetObserver();
  await evaluate(() => {
    const match = Warz.debug.match();
    // Model inventory/class changes arriving while the native popup is open.
    match.player.items[0] = { id: 'smoke', n: 1 };
    match.world.setClass(match.player, 'engineer', false);
  });
  await frames();
  check(await mutations() === 0 && await evaluate(labels => JSON.stringify([...document.getElementById('practice-item-slot').options].map(o => o.textContent)) === JSON.stringify(labels), labels), 'inventory and class changes are deferred while the picker has focus');
  await press('End');
  await press('Enter');
  await click('#practice-item-quantity');
  await frames();
  check(await evaluate(() => {
    const select = document.getElementById('practice-item-slot'), p = Warz.debug.player();
    return select.value === '2' && [...select.options].every((o, i) =>
      o === window.pickerOptions[i] && o.textContent.includes('(' + Warz.Controls.primary(Warz.Controls.itemAction(p, i)) + ')')) &&
      select.options[0].textContent.includes(Warz.ITEMS.smoke.name);
  }), 'leaving the picker refreshes inventory and class bindings without replacing options or resetting the choice');
  await resetObserver();
  await frames();
  check(await mutations() === 0, 'refreshed labels stop mutating once current');

  await click('#practice-item-slot');
  await press('Escape');
  await click('[data-test="items"]');
  check(await evaluate(() => document.getElementById('practice-items').hidden && document.querySelector('[data-test="items"]').getAttribute('aria-expanded') === 'false'), 'Escape dismisses the picker and its toggle closes the form');
  await click('[data-test="items"]');
  await click('#resume-btn');
  await b.waitFor('document.getElementById("pause-menu").hidden');
  await press('Digit5');
  await b.waitFor('Warz.debug.player().held === 2');
  check(true, 'Resume and gameplay hotbar keys still work after closing the picker');
  await evaluate(() => {
    const m = Warz.debug.match(), tree = m.world.map.trees.find(t => t.biome === 'tundra-forest');
    Warz.debug.teleport(tree.x, tree.y - 35);
    m.cam.x = m.player.x; m.cam.y = m.player.y; m.cam.zoom = 1;
  });
  await frames();
  check(await evaluate(() => {
    const m = Warz.debug.match(), tree = m.world.map.trees.find(t => t.biome === 'tundra-forest');
    return tree.hp === undefined && tree.maxHp === undefined && tree.hitRadius === undefined &&
      m.world.sweep(tree.x - 40, tree.y, tree.x + 40, tree.y, 5, m.player.id, m.player.team) === null;
  }), 'leafy canopy has no health pool or hidden projectile hitbox in the running browser');
  await b.shot('foliage-under-cover.png');
  await press('Escape');
  await b.waitFor('!document.getElementById("pause-menu").hidden');
  await click('#practice-speed');
  await click('#leave-btn');
  await b.waitFor('Warz.App.state() === "menu"');
  await evaluate(() => Warz.App.startPractice());
  await press('Escape');
  await b.waitFor('!document.getElementById("pause-menu").hidden');
  check(await evaluate(() => (Warz.debug.player().practiceSpeed || 1) === 1 && document.getElementById('practice-speed').getAttribute('aria-pressed') === 'false'), 'a fresh offline match starts with normal speed');
  await click('#leave-btn');
  await b.waitFor('Warz.Net.online()');
  await evaluate(() => Warz.Lobby.queue('solo'));
  await b.waitFor('Warz.App.state() === "play" && Warz.debug.match().online');
  await press('Escape');
  await b.waitFor('!document.getElementById("pause-menu").hidden');
  check(await evaluate(() => document.getElementById('practice-speed').hidden), 'online matches do not offer the offline speed boost');
  await evaluate(() => Warz.App.leaveMatch());
  await b.cmd('Page.reload');
  await b.waitFor('window.Warz?.App?.ready && Warz.App.state() === "menu"');
  check(b.errors.length === 0, 'leaving and reloading remain responsive with no browser exceptions');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, errors: b.errors }, null, 2));
  console.log('Practice picker browser QA: all ' + checks.length + ' checks passed');
} finally {
  if (b) await b.close();
  await app.close();
}
