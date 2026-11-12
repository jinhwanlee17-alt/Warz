// Physical keys/clicks exercise dynamic hotbar layout and shield reload in Practice and authoritative play.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedUrl = process.env.WARZ_QA_URL || '';
const outDir = path.join(root, 'output', publishedUrl ? 'qa-live-hotbar' : 'qa-hotbar');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: .2, botFill: 2, log: { info() {}, warn: console.warn, error: console.error } });
let b; const checks = [];
const check = (ok, text) => { assert.ok(ok, text); checks.push(text); console.log('ok  ' + text); };
function fixture(W, world, player, classId) {
  for (const key of ['trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations', 'drops', 'rocks']) world.map[key] = [];
  world.structures = []; world.bullets = []; world.solids = new W.U.SpatialHash(256); world.buildSolids();
  for (const v of world.vehicles) { v.x = 15000 + v.id * 200; v.y = 15000; }
  for (const p of world.players) if (p !== player) { p.x = p.y = 16000; p.controller = () => ({}); }
  world.setClass(player, classId, true); player.alive = true; player.downed = false; player.dropT = 0;
  player.x = player.px = 5000; player.y = player.py = 5000; player.vx = player.vy = player.ox = player.oy = 0;
  player.items = [{ id: 'bandage', n: 2 }, { id: 'smoke', n: 1 }, null]; player.held = -1; player.slot = 0;
}
try {
  const port = publishedUrl ? null : (await app.listen(0, '127.0.0.1')).port;
  b = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = (code, down) => b.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code, key: code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(code.length - 1) });
  const press = async code => { await key(code, true); await sleep(80); await key(code, false); await sleep(180); };
  const mouse = down => b.cmd('Input.dispatchMouseEvent', { type: down ? 'mousePressed' : 'mouseReleased', x: 1150, y: 450, button: 'left', buttons: down ? 1 : 0, clickCount: 1 });
  await b.cmd('Page.navigate', { url: publishedUrl || 'http://127.0.0.1:' + port + '/?seed=57' });
  await b.waitFor('window.Warz?.App?.ready && Warz.Net.online()');
  await evaluate(() => Warz.App.startPractice());
  for (const online of publishedUrl ? [false] : [false, true]) {
    const label = online ? 'Online' : 'Practice';
    if (online) { await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('solo'); }); await b.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>2'); }
    const live = online ? app.matches.get(String(await evaluate(() => Warz.debug.match().id))) : null;
    const owner = live ? live.byId.get(await evaluate(() => Warz.debug.player().id)) : null;
    const mutate = async (fn, ...args) => live ? fn(live.W, live.world, owner, ...args) : evaluate((source, args) => {
      const m = Warz.debug.match(); return (0, eval)('(' + source + ')')(Warz, m.world, m.player, ...args);
    }, fn.toString(), args);
    await mutate(fixture, 'engineer');
    await evaluate(() => { const m = Warz.debug.match(); m.cam.x = m.cam.y = 5000; m.cam.zoom = 1; Warz.Hud.banner('', '', .01); });
    await b.waitFor('Warz.debug.player().classId==="engineer" && document.querySelectorAll("#hud-slots .slot").length===6');
    check(await evaluate(() => [...document.querySelectorAll('#hud-slots .slot-key')].map(e => e.firstChild.textContent).join() === '1,2,3,4,5,6'), label + ': Engineer shows six consecutive hotbar keys');
    check(await evaluate(() => [...document.querySelectorAll('#hud-slots .item-slot')].map(e => e.dataset.slot).join() === '1,2,0' && document.querySelector('#hud-slots [data-slot="0"] .slot-name').textContent === Warz.ITEMS.bandage.name), label + ': original item slot three is visibly moved to slot six');
    await press('Digit3');
    await b.waitFor('Warz.debug.player().slot===2 && Warz.debug.player().held===-1');
    check(await mutate((W, w, p) => p.weapons[p.slot].id === 'engineerhammer'), label + ': physical key 3 equips the Engineer hammer on authority');
    await press('Digit6');
    await b.waitFor('Warz.debug.player().held===0');
    check(await mutate((W, w, p) => p.held === 0 && p.items[0].id === 'bandage'), label + ': physical key 6 selects the original retained item');
    await press('Digit5');
    await b.waitFor('Warz.debug.player().held===2 && document.getElementById("hud-ammo").textContent==="Empty"');
    const shots = await mutate((W, w, p) => p.stats.shots);
    await mouse(true); await sleep(400); await mouse(false);
    check(await mutate((W, w, p, shots) => p.held === 2 && p.stats.shots === shots, shots), label + ': firing an empty slot keeps empty hands and never fires a stowed weapon');
    await key('KeyW', true); await sleep(220); await key('KeyW', false);
    check(await mutate((W, w, p) => p.held === 2 && p.y < 4990), label + ': empty hands still allow normal movement');
    await b.shot(label.toLowerCase() + '-six-slot-empty.png');
    await press('Tab');
    await b.waitFor('Warz.Inventory.isOpen()');
    check(await evaluate(() => [...document.querySelectorAll('#inv-grid .inv-key')].map(e => e.textContent).join() === '4,5,6'), label + ': inventory shows matching Engineer item key labels');
    await press('Tab');
    await mutate((W, w, p) => {
      p.tokens = 100; p.held = -1; w.switchSlot(p, 2); p.angle = 0;
      w.addStruct({ kind: 'sentry', item: 'sentry3', x: p.x + 80, y: p.y, r: 22, hp: W.ITEMS.sentry3.hp, maxHp: W.ITEMS.sentry3.hp, team: p.team, owner: p.id });
    });
    await b.waitFor('Warz.debug.player().slot===2 && Warz.debug.match().world.structures.some(s=>s.item==="sentry3")');
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1150, y: 450 });
    await mouse(true); await b.waitFor('Warz.SentryUpgradeUI.isOpen()'); await mouse(false);
    check(await evaluate(() => [...document.querySelectorAll('#sentry-upgrade [data-sentry-variant]')].map(e => e.dataset.sentryVariant).join() === 'bullets,grenades,rockets,snowballs,fireballs,cannons'), label + ': hammering Sentry III opens all six specializations in stable order');
    await b.shot(label.toLowerCase() + '-sentry-popup-desktop.png');
    {
      await b.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await sleep(120);
      check(await evaluate(() => {
        const card = document.querySelector('#sentry-upgrade .modal-card'), r = card.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && card.scrollWidth <= card.clientWidth + 1;
      }), label + ' 390x844: Sentry IV popup fits the viewport without horizontal overflow');
      await b.shot(label.toLowerCase() + '-sentry-popup-mobile.png');
      await evaluate(() => document.querySelector('#sentry-upgrade [data-sentry-variant]:last-child').focus());
      check(await evaluate(() => {
        const last = document.activeElement, r = last.getBoundingClientRect();
        return last.dataset.sentryVariant === 'cannons' && r.top >= 0 && r.bottom <= innerHeight;
      }), label + ' 390x844: last Cannon specialization remains reachable through the scrolling dialog');
      await b.shot(label.toLowerCase() + '-sentry-popup-mobile-last-option.png');
      await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await evaluate(() => { document.querySelector('#sentry-upgrade .modal-card').scrollTop = 0; document.querySelector('#sentry-upgrade [data-sentry-variant]').focus(); });
      await sleep(120);
    }
    const beforeChoice = await mutate((W, w, p) => ({ x: p.x, y: p.y, tokens: p.tokens, shots: p.stats.shots }));
    await press('Digit1'); await key('KeyW', true); await sleep(200);
    check(await mutate((W, w, p, before) => p.slot === 2 && Math.hypot(p.x - before.x, p.y - before.y) < 1, beforeChoice), label + ': popup blocks movement and hotbar input');
    const option = await evaluate(() => {
      const e = document.querySelector('#sentry-upgrade [data-sentry-variant]:last-child'); e.scrollIntoView({ block: 'nearest' });
      const r = e.getBoundingClientRect();
      return { variant: e.dataset.sentryVariant, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    for (const down of [true, false]) await b.cmd('Input.dispatchMouseEvent', { type: down ? 'mousePressed' : 'mouseReleased', x: option.x, y: option.y, button: 'left', buttons: down ? 1 : 0, clickCount: 1 });
    await b.waitFor('!Warz.SentryUpgradeUI.isOpen()'); await sleep(220);
    check(option.variant === 'cannons' && await mutate((W, w, p, before, variant) => p.sentrySelection?.variant === variant && p.tokens === before.tokens && Math.hypot(p.x - before.x, p.y - before.y) < 1 && !p.sentryWork && p.stats.shots === before.shots, beforeChoice, option.variant), label + ': choosing the last Cannon option preserves tokens and suppresses held movement/click input');
    await key('KeyW', false);
    await b.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1150, y: 450 });
    await mouse(true); await b.waitFor('Warz.debug.player().sentryWork?.elapsed>.2 && !document.getElementById("hud-repair").hidden');
    check(await evaluate(() => document.getElementById('hud-repair-text').textContent.includes('remaining') && document.getElementById('hud-repair-note').textContent.includes('30 tokens')), label + ': selected Sentry IV build displays remaining time and 30-token cost');
    await b.shot(label.toLowerCase() + '-sentry-upgrade-progress.png');
    await mouse(false);
    await mutate((W, w, p) => { p.sentrySelection = null; });
    await sleep(180); await mouse(true); await b.waitFor('Warz.SentryUpgradeUI.isOpen()'); await mouse(false);
    await press('Escape'); await b.waitFor('!Warz.SentryUpgradeUI.isOpen() && !Warz.debug.player().sentryChoice');
    check(await evaluate(() => document.getElementById('pause-menu').hidden && !Warz.debug.player().sentrySelection), label + ': Escape cancels the choice without opening the pause menu');
    await mutate(fixture, 'shieldoperator');
    await b.waitFor('Warz.debug.player().classId==="shieldoperator" && document.querySelectorAll("#hud-slots .slot").length===5');
    await mouse(true); await b.waitFor('Warz.debug.player().weapons[0].ammo<10'); await mouse(false);
    await press('KeyR');
    await b.waitFor('Warz.debug.player().weapons[0].reloading && document.getElementById("hud-ammo-label").textContent.includes("shield lowered")');
    check(await mutate((W, w, p) => !w.activeShield(p)), label + ': pressing reload removes frontal riot shield protection');
    await b.shot(label.toLowerCase() + '-shield-reloading.png');
    await b.waitFor('!Warz.debug.player().weapons[0].reloading && Warz.debug.player().shieldUp');
    check(await mutate((W, w, p) => !!w.activeShield(p)), label + ': shield protection returns when the actual reload ends');
    await press('Digit5');
    await b.waitFor('Warz.debug.player().held===2');
    check(await mutate((W, w, p) => !w.activeShield(p)), label + ': choosing an empty slot also puts the class shield away');
  }
  check(b.errors.length === 0, 'HUD and physical controls run without browser exceptions');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, errors: b.errors }, null, 2));
  console.log('Hotbar browser QA: all ' + checks.length + ' checks passed');
} finally { if (b) await b.close(); if (!publishedUrl) await app.close(); }
