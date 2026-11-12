// Real browser check of Locker editing, accessibility, persistence and responsive layout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deployed = process.argv.includes('--deployed');
const outDir = path.join(root, 'output', deployed ? 'qa-live-locker' : 'qa-locker');
const app = deployed ? null : createApp({ dataDir: null, botFill: 0, log: { info() {}, warn: console.warn, error: console.error } });
const report = { deployed, cache: '20261111i', checks: [], screenshots: [], errors: [] };
let browser;
const check = (ok, text) => { assert.ok(ok, text); report.checks.push(text); console.log('ok  ' + text); };
try {
  const address = app ? await app.listen(0, '127.0.0.1') : null;
  report.url = deployed ? 'https://warz-io.warz-io.workers.dev/?seed=57&qa=locker' : 'http://127.0.0.1:' + address.port + '/?seed=57';
  browser = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const click = async selector => {
    const r = await evaluate(selector => { const e = document.querySelector(selector); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...r, button: 'left', buttons: 1, clickCount: 1 });
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...r, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(70);
  };
  const key = async (code, text, shift = false) => {
    await browser.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: text, modifiers: shift ? 8 : 0 });
    await browser.cmd('Input.dispatchKeyEvent', { type: 'keyUp', code, key: text }); await sleep(40);
  };
  const input = async (selector, value) => evaluate((selector, value) => {
    const e = document.querySelector(selector); e.focus(); e.value = value; e.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector, value);
  const shot = async name => { report.screenshots.push(await browser.shot(name)); };
  await browser.cmd('Page.navigate', { url: report.url });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready');
  if (deployed) check(await evaluate(() => [...document.scripts].filter(s => s.src.includes('/js/')).every(s => new URL(s.src).searchParams.get('v') === '20261111i') && Warz.Locker && Warz.Cosmetics && Warz.EmotePicker), 'Published20261111i includes Locker and the compact emote picker');
  check(await evaluate(() => !!document.getElementById('locker-btn')), 'Main menu has a Locker button');
  await click('#locker-btn');
  check(await evaluate(() => Warz.Locker.isOpen() && document.activeElement.id === 'locker-tab-colours'), 'Locker opens and focuses the selected category');
  check(await evaluate(() => document.querySelectorAll('[data-locker-color]').length === 20 && document.querySelectorAll('[data-locker-tab]').length === 4), 'Four categories and exactly twenty preset colours');
  await click('[data-locker-color="#ff943d"]');
  check(await evaluate(() => Warz.Locker.get().color === '#ff943d' && document.querySelectorAll('[data-locker-color][aria-pressed="true"]').length === 1), 'Clicking a colour applies it and selects exactly one swatch');
  await input('#locker-rgb-r', '12'); await input('#locker-rgb-g', '34'); await input('#locker-rgb-b', '56');
  check(await evaluate(() => Warz.Locker.get().color === '#0c2238' && document.getElementById('locker-hex').value === '#0C2238'), 'RGB values generate and persist their exact colour');
  await input('#locker-rgb-r', '999');
  check(await evaluate(() => Warz.Locker.get().color === '#0c2238' && document.getElementById('locker-rgb-r').getAttribute('aria-invalid') === 'true'), 'Out-of-range RGB input cannot save an invalid colour');
  await click('#locker-hex');
  check(await evaluate(() => document.getElementById('locker-rgb-r').value === '12'), 'Leaving invalid RGB restores the last valid value');
  await input('#locker-hex', '#A13BD2');
  check(await evaluate(() => Warz.Locker.get().color === '#a13bd2'), 'Hex entry accepts case-insensitive six-digit colours');
  await input('#locker-hex', '#zzz');
  check(await evaluate(() => Warz.Locker.get().color === '#a13bd2' && document.getElementById('locker-hex').getAttribute('aria-invalid') === 'true'), 'Malformed hex never enters saved cosmetics');
  await evaluate(() => document.getElementById('locker-wheel').focus());
  const beforeWheel = await evaluate(() => Warz.Locker.get().color);
  await key('ArrowRight', 'ArrowRight');
  check(await evaluate(before => Warz.Locker.get().color !== before, beforeWheel), 'Colour wheel supports keyboard hue selection');
  const point = await evaluate(() => { const r = document.getElementById('locker-wheel').getBoundingClientRect(); return { x: r.x + r.width * .75, y: r.y + r.height / 2 }; });
  await browser.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
  await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
  check(await evaluate(() => { const [r, g, b] = Warz.Locker.get().color.slice(1).match(/../g).map(s => parseInt(s, 16)); return r > g && Math.abs(g - b) <= 1; }), 'Physical wheel click selects the corresponding hue and saturation');
  await input('#locker-brightness', '50');
  check(await evaluate(() => Math.max(...Warz.Locker.get().color.slice(1).match(/../g).map(s => parseInt(s, 16))) === 128 && document.getElementById('locker-brightness-value').textContent === '50%'), 'Brightness adjusts actual RGB output');
  await shot('colours-desktop.png');
  await click('#locker-tab-face');
  check(await evaluate(() => document.querySelectorAll('[data-locker-face]').length === 7), 'Six requested faces plus a no-face option');
  for (const id of ['smile', 'sad', 'angry', 'evil', 'laugh', 'cry']) {
    await click('[data-locker-face="' + id + '"]');
    check(await evaluate(id => Warz.Locker.get().face === id && document.querySelector('[data-locker-face="' + id + '"]').getAttribute('aria-pressed') === 'true', id), 'Face selection works: ' + id);
  }
  await shot('faces-desktop.png');
  await click('#locker-tab-items');
  check(await evaluate(() => document.getElementById('locker-panel-items').textContent.includes('locked for now') && !document.querySelector('#locker-panel-items button')), 'Items remain locked with no equip or purchase action');
  await shot('items-locked.png');
  await click('#locker-tab-emotes');
  check(await evaluate(() => document.querySelectorAll('[data-locker-slot]').length === 9 && document.querySelectorAll('[data-locker-emote]').length === 13), 'Nine equipped slots and all thirteen requested emotes');
  await click('[data-locker-slot="0"]'); await click('[data-locker-emote="cooked"]');
  check(await evaluate(() => Warz.Locker.get().emotes[0] === 'cooked' && new Set(Warz.Locker.get().emotes).size === 9), 'An unequipped emote replaces the selected slot');
  const prior = await evaluate(() => Warz.Locker.get().emotes[8]);
  await click('[data-locker-slot="8"]'); await click('[data-locker-emote="cooked"]');
  check(await evaluate(prior => Warz.Locker.get().emotes[8] === 'cooked' && Warz.Locker.get().emotes[0] === prior && new Set(Warz.Locker.get().emotes).size === 9, prior), 'Equipping an already-used emote swaps slots without losing or duplicating a choice');
  check(await evaluate(() => [...document.querySelectorAll('.locker-emote-slot kbd')].map(e => e.textContent).join('') === 'QWERTYUIO'), 'Emote slots display Q W E R T Y U I O in order');
  await shot('emotes-desktop.png');
  await evaluate(() => document.getElementById('locker-close').focus());
  await key('Tab', 'Tab', true);
  check(await evaluate(() => document.getElementById('locker-dialog').contains(document.activeElement)), 'Shift-Tab keeps focus inside the modal');
  const saved = await evaluate(() => Warz.Locker.get());
  await key('Escape', 'Escape');
  check(await evaluate(() => !Warz.Locker.isOpen() && document.activeElement.id === 'locker-btn'), 'Escape closes Locker and returns focus to its menu button');
  await browser.cmd('Page.reload', {}); await browser.waitFor('window.Warz && Warz.App && Warz.App.ready');
  check(await evaluate(saved => JSON.stringify(Warz.Locker.get()) === JSON.stringify(saved), saved), 'Colour, face and all nine slots survive a reload');
  await click('#locker-btn');
  await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  for (const tab of ['colours', 'face', 'items', 'emotes']) {
    await click('#locker-tab-' + tab); await sleep(80);
    check(await evaluate(() => { const card = document.querySelector('.locker-card'), r = card.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && card.scrollWidth <= card.clientWidth + 1; }), '390px ' + tab + ' layout fits without horizontal scrolling');
    await shot(tab + '-mobile.png');
  }
  await click('[data-locker-slot="8"]'); await click('[data-locker-emote="rose"]');
  check(await evaluate(() => Warz.Locker.get().emotes[8] === 'rose'), 'Mobile can equip the withered rose in the ninth slot');
  await click('#locker-close');
  check(await evaluate(() => !Warz.Locker.isOpen()), 'Close button remains usable after scrolling the mobile dialog');
  // Use only disposable client-side Practice, including on the deployed site. Never join a public match.
  await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(() => {
    const W = Warz; window.lockerPracticeQA = { faces: 0, bubbles: 0 };
    const drawFace = W.CosmeticArt.face;
    W.CosmeticArt.face = function (g, id, radius, color) { if (id === W.Locker.get().face && color === W.Locker.get().color) lockerPracticeQA.faces++; return drawFace.apply(this, arguments); };
    W.App.startPractice(); const m = W.debug.match(), w = m.world, p = m.player, renderer = W.debug.renderer();
    w.storm = null; p.dropT = 0; p.x = p.px = 9000; p.y = p.py = 9000; p.vx = p.vy = 0;
    for (const field of ['trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations', 'rocks']) w.map[field] = [];
    w.structures = []; w.solids = new W.U.SpatialHash(256); w.buildSolids(); renderer.map = null;
    for (const v of w.vehicles) { v.x = 16000 + v.id * 180; v.y = 16000; }
    m.cam.x = p.x; m.cam.y = p.y; m.cam.zoom = 1;
    const drawEmote = renderer.drawEmote;
    renderer.drawEmote = function (g, player) { const rendered = drawEmote.apply(this, arguments); if (player === p && rendered) lockerPracticeQA.bubbles++; return rendered; };
    w.addItem(p, 'grenade', 2); p.held = p.items.findIndex(item => item && item.id === 'grenade');
    lockerPracticeQA.itemSlot = p.held; lockerPracticeQA.itemCount = p.items[p.held].n; lockerPracticeQA.shots = p.stats.shots;
    W.Hud.banner('', '', .01);
  });
  await sleep(250);
  check(await evaluate(() => { const m = Warz.debug.match(), p = m.player, look = Warz.Locker.get(); return !m.online && p.color === look.color && p.face === look.face && lockerPracticeQA.faces > 0; }), 'Practice uses and visibly draws the selected custom colour and face');
  await key('KeyB', 'b'); await browser.waitFor('Warz.EmotePicker.isOpen()');
  check(await evaluate(() => document.querySelectorAll('[data-emote-slot]').length === 9 && [...document.querySelectorAll('.emote-choice kbd')].map(e => e.textContent).join('') === 'QWERTYUIO'), 'Physical B opens all nine equipped slots with the correct letters');
  check(await evaluate(() => { const p = document.getElementById('emote-picker'); return p.getAttribute('role') === 'region' && !p.hasAttribute('aria-modal') && !p.contains(document.activeElement); }), 'Opening the mini picker is nonmodal and does not steal keyboard focus');
  const miniGeometry = async label => {
    const shape = await evaluate(() => {
      const panel = document.querySelector('.emote-card'), r = panel.getBoundingClientRect(), tiles = [...document.querySelectorAll('.emote-choice')].map(e => e.getBoundingClientRect());
      return { width: r.width, height: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight,
        canvasAtCenter: document.elementFromPoint(innerWidth / 2, innerHeight / 2).id === 'game',
        square: tiles.every(t => Math.abs(t.width - t.height) < 1),
        grid: tiles.length === 9 && tiles[0].y === tiles[1].y && tiles[1].y === tiles[2].y && tiles[3].y > tiles[0].y && tiles[6].y > tiles[3].y,
        transparent: getComputedStyle(document.getElementById('emote-picker')).backgroundColor === 'rgba(0, 0, 0, 0)',
        hintsVisible: getComputedStyle(document.getElementById('hud-keys')).visibility !== 'hidden',
        noOverflow: panel.scrollWidth <= panel.clientWidth + 1 };
    });
    check(shape.width <= 221 && shape.width <= shape.vw * .45 + 1 && shape.height <= shape.vh * .45 + 2 && shape.left > shape.vw / 2 && shape.right <= shape.vw && shape.top >= 0 && shape.bottom <= shape.vh && shape.square && shape.grid && shape.noOverflow,
      label + ': compact square three-by-three grid fits on the right');
    check(shape.canvasAtCenter && shape.transparent && shape.hintsVisible, label + ': center camera stays clickable with no backdrop or hidden HUD');
  };
  await miniGeometry('Desktop');
  await shot('practice-picker-desktop.png');
  await key('KeyQ', 'q');
  await browser.waitFor('Warz.debug.player().emote && lockerPracticeQA.bubbles>0');
  check(await evaluate(() => { const p = Warz.debug.player(); return !Warz.EmotePicker.isOpen() && p.emote.id === Warz.Locker.get().emotes[0] && p.items[lockerPracticeQA.itemSlot].n === lockerPracticeQA.itemCount && p.stats.shots === lockerPracticeQA.shots; }), 'Physical Q sends slotone visibly, closes the picker, and does not drop or fire the held item');
  await shot('practice-emote.png');
  await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await evaluate(() => { Warz.debug.player().emotes[8] = 'cooked'; });
  await key('KeyB', 'b'); await browser.waitFor('Warz.EmotePicker.isOpen()');
  await miniGeometry('390px mobile');
  check(await evaluate(() => { const glyph = document.querySelector('[data-emote-slot="8"] .emote-glyph'), g = glyph.getBoundingClientRect(), t = glyph.parentElement.getBoundingClientRect(); return g.left >= t.left && g.right <= t.right && g.top >= t.top && g.bottom <= t.bottom; }), 'Get Cooked! fits inside a390px mobile tile');
  await shot('practice-picker-mobile.png');
  await browser.cmd('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: false });
  await evaluate(() => { const p = Warz.debug.player(); p.emotes[8] = 'cooked'; Warz.EmotePicker.show(p.emotes); });
  await sleep(100); await miniGeometry('Short landscape');
  check(await evaluate(() => { const glyph = document.querySelector('[data-emote-slot="8"] .emote-glyph'), g = glyph.getBoundingClientRect(), t = glyph.parentElement.getBoundingClientRect(); return g.left >= t.left && g.right <= t.right && g.top >= t.top && g.bottom <= t.bottom; }), 'Get Cooked! fits inside a small landscape tile');
  await shot('practice-picker-landscape.png'); await key('Escape', 'Escape');
  check(await evaluate(() => !Warz.EmotePicker.isOpen()), 'Escape closes Practice emotes');
  report.errors = browser.errors.slice(); check(report.errors.length === 0, 'No browser exceptions');
} finally {
  if (browser) { report.errors = browser.errors.slice(); await browser.close(); }
  if (app) await app.close(); fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
}
console.log('Locker browser QA: ' + report.checks.length + ' checks passed');
