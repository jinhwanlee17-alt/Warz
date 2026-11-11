// Exercise the actual Practice controls and map through an isolated browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-practice');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 2,
  log: { info() {}, warn: console.warn, error: console.error } });
let browser;
const checks = [], layouts = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };

try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const click = async selector => {
    const point = await evaluate(selector => {
      const el = document.querySelector(selector); el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit !== el && !el.contains(hit)) throw new Error('Control covered: ' + selector);
      return { x, y };
    }, selector);
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(80);
  };
  const key = async (code, value, number) => {
    await browser.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: value, windowsVirtualKeyCode: number });
    await sleep(90);
    await browser.cmd('Input.dispatchKeyEvent', { type: 'keyUp', code, key: value, windowsVirtualKeyCode: number });
    await sleep(90);
  };
  const pause = async () => { await key('Escape', 'Escape', 27); await browser.waitFor('!document.getElementById("pause-menu").hidden'); };
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  await evaluate(() => { Warz.App.startPractice(); Warz.debug.player().dropT = 0; });
  await pause();
  check(await evaluate(() => !document.getElementById('test-tools-section').hidden && document.getElementById('practice-items').hidden),
    'Practice shows test tools and keeps the item chooser closed initially');
  await click('[data-test="items"]');
  check(await evaluate(() => {
    const select = document.getElementById('practice-item'), values = [...select.options].map(o => o.value);
    return !document.getElementById('practice-items').hidden && new Set(values).size === Warz.ITEM_ORDER.length &&
      values.length === Warz.ITEM_ORDER.length && Warz.ITEM_ORDER.every(id => values.includes(id)) &&
      select.querySelectorAll('optgroup').length === Warz.CRATE_ORDER.length &&
      document.getElementById('practice-item-slot').options.length === 3;
  }), 'Item chooser offers every item in all five tiers and exactly three item slots');
  const originalWeapons = await evaluate(() => ({ classId: Warz.debug.player().classId, weapons: Warz.debug.player().weapons.map(w => w.id) }));
  const items = await evaluate(() => Warz.ITEM_ORDER.map(id => ({ id, stack: Warz.ITEMS[id].stack })));
  for (let i = 0; i < items.length; i++) {
    const item = items[i], slot = i % 3;
    await evaluate((id, slot) => {
      const select = document.getElementById('practice-item'); select.value = id; select.dispatchEvent(new Event('change'));
      document.getElementById('practice-item-slot').value = String(slot);
    }, item.id, slot);
    assert.equal(await evaluate(() => Number(document.getElementById('practice-item-quantity').value)), item.stack, item.id + ' defaults to full stack');
    await click('#practice-items button[type="submit"]');
    assert.deepEqual(await evaluate(slot => Warz.debug.player().items[slot], slot), { id: item.id, n: item.stack }, item.id + ' assigned correctly');
  }
  check(true, 'Every item can fill the selected slot at its full stack size (' + items.length + ' items exercised)');
  check(JSON.stringify(originalWeapons) === JSON.stringify(await evaluate(() => ({ classId: Warz.debug.player().classId, weapons: Warz.debug.player().weapons.map(w => w.id) }))),
    'Choosing items preserves the player class and both class weapon slots');
  const stackable = items.find(item => item.stack > 1);
  await evaluate(id => {
    const select = document.getElementById('practice-item'); select.value = id; select.dispatchEvent(new Event('change'));
    document.getElementById('practice-item-slot').value = '1'; document.getElementById('practice-item-quantity').value = '1';
  }, stackable.id);
  await click('#practice-items button[type="submit"]');
  check(await evaluate(id => Warz.debug.player().items[1].id === id && Warz.debug.player().items[1].n === 1, stackable.id),
    'Custom quantity places one item in the selected second slot');
  await evaluate(stack => { document.getElementById('practice-item-quantity').value = String(stack + 1); }, stackable.stack);
  check(await evaluate(() => !document.getElementById('practice-item-quantity').checkValidity()), 'Quantity control rejects a value over the selected item stack limit');
  await click('#practice-items button[type="submit"]');
  check(await evaluate(() => Warz.debug.player().items[1].n === 1), 'Invalid quantity does not overwrite the hotbar');
  await evaluate(() => { document.getElementById('practice-item-quantity').value = '1'; document.activeElement.blur(); });

  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(120);
    await evaluate(() => document.getElementById('practice-items').scrollIntoView({ block: 'center' }));
    check(await evaluate(() => {
      const form = document.getElementById('practice-items'), panel = document.querySelector('#pause-menu .modal-card');
      const box = form.getBoundingClientRect();
      return panel.scrollWidth <= panel.clientWidth && box.left >= 0 && box.right <= innerWidth &&
        [...form.querySelectorAll('select,input,button')].every(el => {
          const b = el.getBoundingClientRect(); return b.width >= 62 && b.left >= box.left && b.right <= box.right;
        });
    }), width + 'px: item chooser fits the pause panel with usable fields');
    await browser.shot('item-chooser-' + width + '.png');
  }
  await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(() => {
    const m = Warz.debug.match(); window.practiceStormQA = m.world.storm;
    m.player.inStorm = true; m.player.hp = m.player.maxHp;
  });
  await click('[data-test="storm"]');
  check(await evaluate(() => Warz.debug.match().world.storm === null && !Warz.debug.player().inStorm && document.getElementById('practice-storm').textContent === 'Enable storm'),
    'Disable storm removes its simulation and clears the player warning');
  await click('#resume-btn');
  await evaluate(() => { const m = Warz.debug.match(); m.world.time = 1200; window.practiceHpQA = m.player.hp; });
  await sleep(1200);
  check(await evaluate(() => Warz.debug.player().hp === practiceHpQA && Warz.debug.match().world.storm === null),
    'Disabled storm causes no damage after a tick, even late in the match');
  await pause();
  // Restore the early clock before enabling so this check cannot kill the fixture.
  await evaluate(() => { Warz.debug.match().world.time = 1; });
  await click('[data-test="storm"]');
  check(await evaluate(() => Warz.debug.match().world.storm === practiceStormQA && document.getElementById('practice-storm').textContent === 'Disable storm'),
    'Enable storm restores the existing storm and updates the button');
  await click('[data-test="storm"]');

  // Begin mounted at a distant station-free point; the actual button must choose the nearest real station and dismount safely.
  await evaluate(() => {
    const m = Warz.debug.match(), p = m.player, w = m.world;
    p.x = p.y = 7000; p.dropT = 0; p.vx = 140; p.vy = -80; p.ox = 35; p.oy = 20;
    const s = w.addStruct({ kind: 'turret', item: 'turret', x: p.x, y: p.y, r: 32, owner: p.id, team: p.team, hp: 100, maxHp: 100 });
    p.mount = s.id; s.mounted = p.id;
    window.practiceTeleportQA = { station: w.nearestStation(p.x, p.y, Infinity).number, turret: s.id, items: JSON.stringify(p.items) };
  });
  await click('[data-test="station"]');
  check(await evaluate(() => {
    const m = Warz.debug.match(), p = m.player, s = p.nearStation;
    return s && s.number === practiceTeleportQA.station && Math.hypot(s.x - p.x, s.y - p.y) < Warz.CONFIG.stationInteractRadius + p.r &&
      !p.mount && !m.world.structById(practiceTeleportQA.turret).mounted && !p.dropT && !p.vx && !p.vy && !p.ox && !p.oy &&
      m.cam.x === p.x && m.cam.y === p.y && JSON.stringify(p.items) === practiceTeleportQA.items;
  }), 'Teleport lands within the nearest real station interaction radius, releases the turret and preserves items');
  check(await evaluate(() => {
    const m = Warz.debug.match(), p = m.player, x = p.x, y = p.y;
    m.world.collide(p);
    return Math.hypot(p.x - x, p.y - y) < 0.001 && !m.world.inPond(p.x, p.y) &&
      Warz.U.insideIsland(p.x, p.y, p.r + 2, Warz.CONFIG.worldSize, Warz.CONFIG.cornerRadius);
  }), 'Teleport landing is inside the island, outside water and does not overlap map solids');
  await click('#resume-btn');
  await browser.shot('teleport-station.png');
  await key('KeyE', 'e', 69);
  check(await evaluate(() => Warz.UpgradeTree.isOpen()), 'The teleported player can open the nearby Upgrade Station with E');
  await evaluate(() => Warz.UpgradeTree.close());

  for (const [width, height, dpr] of [[1440, 900, 1], [800, 600, 1], [390, 844, 2], [844, 390, 1]]) {
    await browser.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
    await key('KeyM', 'm', 77);
    await browser.waitFor('Warz.MapScreen.isOpen()');
    const layout = await evaluate(() => {
      const el = document.getElementById('map-screen'), canvas = document.getElementById('bigmap'), r = canvas.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom,
        children: el.children.length, direct: canvas.parentElement === el, accessible: el.getAttribute('aria-label'), px: canvas.width,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight };
    });
    layouts.push(layout);
    check(layout.children === 1 && layout.direct && Math.abs(layout.w - layout.h) < 0.1 &&
      layout.x >= 8 && layout.y >= 8 && layout.right <= width - 8 && layout.bottom + 5 <= height &&
      layout.scrollWidth === width && layout.scrollHeight === height && layout.accessible.includes('Escape'),
    width + 'x' + height + ' DPR ' + dpr + ': map is a single tightly framed square with no title, legend or overflowing card');
    await browser.shot('island-map-' + width + 'x' + height + '.png');
    await key(width === 800 ? 'Escape' : 'KeyM', width === 800 ? 'Escape' : 'm', width === 800 ? 27 : 77);
    check(await evaluate(() => !Warz.MapScreen.isOpen() && document.getElementById('map-screen').hidden && document.getElementById('pause-menu').hidden),
      width + 'px: ' + (width === 800 ? 'Escape' : 'M') + ' closes the map back to the game');
  }

  await evaluate(() => { Warz.App.leaveMatch(); Warz.App.startPractice(); });
  await pause();
  check(await evaluate(() => !!Warz.debug.match().world.storm && document.getElementById('practice-items').hidden && document.getElementById('practice-storm').textContent === 'Disable storm'),
    'A new Practice match starts with a fresh enabled storm and closed chooser');
  await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('solo'); });
  await browser.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>1');
  await pause();
  check(await evaluate(() => document.getElementById('test-tools-section').hidden && getComputedStyle(document.getElementById('test-tools-section')).display === 'none'),
    'Real online match hides all Practice controls');
  check(await evaluate(() => {
    const m = Warz.debug.match(), p = m.player, before = JSON.stringify({ x: p.x, y: p.y, items: p.items, classId: p.classId }), storm = m.world.storm;
    ['items', 'storm', 'station'].forEach(action => document.querySelector('[data-test="' + action + '"]').click());
    document.getElementById('practice-items').dispatchEvent(new Event('submit', { cancelable: true }));
    return storm === m.world.storm && before === JSON.stringify({ x: p.x, y: p.y, items: p.items, classId: p.classId }) && document.getElementById('practice-items').hidden;
  }), 'Online match rejects Practice item, storm and teleport handlers even if invoked directly');
  check(browser.errors.length === 0, 'No browser exceptions in Practice tools, responsive map or online guard checks');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, layouts, errors: browser.errors }, null, 2));
  console.log('Practice/map browser QA: all ' + checks.length + ' checks passed');
} finally {
  if (browser) await browser.close();
  await app.close();
}
