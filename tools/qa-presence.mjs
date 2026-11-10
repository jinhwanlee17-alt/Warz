// Real 50-player match: roster entries are not actors until their positions arrive.
// Screenshots exercise the original centre-of-map phantom and interest/rejoin transitions.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 50,
  log: { info() {}, warn: console.warn, error: console.error } });
let browser, checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; console.log('ok  ' + message); };

try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir: path.join(root, 'output', 'qa-presence'), width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?demoSeed=57' });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  await evaluate(() => {
    window.presenceQA = { phantomDraws: [], drawn: [], frames: 0 };
    const proto = Warz.Renderer.prototype, render = proto.render, player = proto.drawPlayer;
    proto.render = function (...args) {
      presenceQA.drawn = []; presenceQA.frames++;
      return render.apply(this, args);
    };
    proto.drawPlayer = function (...args) {
      const p = args[1], m = Warz.debug.match();
      if (m && m.online) {
        presenceQA.drawn.push(p.id);
        if (p !== m.player && (!p.snaps || !p.snaps.length)) presenceQA.phantomDraws.push(p.id);
      }
      return player.apply(this, args);
    };
    Warz.Lobby.queue('solo');
  });
  await browser.waitFor('Warz.App.state() === "play" && Warz.debug.online().snapCount >= 2');
  const info = await evaluate(() => ({ id: Warz.debug.match().id, you: Warz.debug.player().id }));
  const live = app.matches.get(String(info.id)), me = live.byId.get(info.you), center = live.map.size / 2;
  check(live.players.length === 50, 'match contains one connected player and 49 opponents');
  // Keep all test opponents alive and out of the centre's interest region. Their
  // server entities remain ordinary players; only their scripted inputs are idle.
  for (let i = 0; i < live.players.length; i++) {
    const p = live.players[i];
    p.dropT = 0; p.vx = 0; p.vy = 0;
    if (p !== me) {
      p.controller = () => ({ mx: 0, my: 0 });
      p.x = 1800 + i % 7 * 80; p.y = 1800 + Math.floor(i / 7) * 80;
    }
  }
  me.x = center - 180; me.y = center - 130;
  await browser.waitFor(`Math.abs(Warz.debug.player().x - ${me.x}) < 2 && Math.abs(Warz.debug.player().y - ${me.y}) < 2`);
  await browser.sleep(750);
  const unseen = await evaluate(() => {
    const w = Warz.debug.match().world, me = Warz.debug.player();
    return w.players.filter(p => p !== me && !p.snaps.length).map(p => ({ id: p.id, hidden: p.hidden, x: p.x, y: p.y }));
  });
  check(unseen.length >= 20, 'many roster entries have never received a position (' + unseen.length + ')');
  check(unseen.every(p => p.hidden), 'all unseen roster entries remain hidden');
  check(await evaluate(() => presenceQA.phantomDraws.length === 0), 'no unsnapshotted opponent was ever submitted to the renderer');
  check(await evaluate(() => presenceQA.drawn.every(id => id === Warz.debug.player().id)), 'the centre shows only the actual local player');
  await browser.shot('01-center-no-phantoms.png');

  const enemy = live.byId.get(unseen[0].id);
  enemy.x = center + 140; enemy.y = center - 130; enemy.vx = 0; enemy.vy = 0;
  await browser.waitFor(`(() => { const p=Warz.debug.match().world.playerById(${enemy.id}); return !p.hidden && Math.abs(p.x-${enemy.x})<2 && Math.abs(p.y-${enemy.y})<2 && presenceQA.drawn.includes(p.id); })()`);
  check(await evaluate(id => {
    const p = Warz.debug.match().world.playerById(id);
    return p.snaps.length > 0 && !p.hidden && presenceQA.drawn.includes(id);
  }, enemy.id), 'a real opponent entering interest appears at its authoritative position');
  await browser.shot('02-real-enemy-visible.png');

  const aim = await evaluate(id => {
    const m = Warz.debug.match(), p = m.world.playerById(id);
    return Warz.debug.renderer().worldToScreen(m.cam, p.x, p.y);
  }, enemy.id);
  const hpBefore = enemy.hp;
  await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: aim.x, y: aim.y });
  await browser.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: aim.x, y: aim.y, button: 'left', buttons: 1, clickCount: 1 });
  try {
    await browser.waitFor(`Warz.debug.match().world.playerById(${enemy.id}).hp < ${hpBefore}`, 5000);
  } finally {
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: aim.x, y: aim.y, button: 'left', buttons: 0, clickCount: 1 });
  }
  check(enemy.hp < hpBefore && enemy.alive, 'browser fire damages the real opponent on the server');
  check(await evaluate(id => Warz.debug.match().world.playerById(id).hp, enemy.id) < hpBefore, 'server damage is reflected in the visible opponent');
  await browser.shot('03-enemy-damaged.png');

  enemy.x = 2300; enemy.y = 2300; enemy.vx = 0; enemy.vy = 0;
  await browser.waitFor(`Warz.debug.match().world.playerById(${enemy.id}).hidden && !presenceQA.drawn.includes(${enemy.id})`);
  check(await evaluate(id => {
    const m = Warz.debug.match(), p = m.world.playerById(id), me = m.player;
    const hit = m.world.sweep(p.x - 90, p.y, p.x + 90, p.y, 5.5, me.id, me.team);
    return !hit;
  }, enemy.id), 'a missing opponent no longer blocks cosmetic bullets at its stale position');
  check(await evaluate(() => presenceQA.drawn.every(id => id === Warz.debug.player().id)), 'leaving interest removes the real opponent without leaving a stationary copy');
  await browser.shot('04-enemy-out-of-interest.png');

  await evaluate(id => {
    const world = Warz.debug.match().world, emit = world.emit;
    world.emit = function (event) {
      if (event.type === 'shot' && event.player.id === id) {
        presenceQA.remoteShot = { canonical: event.player === world.playerById(id), hidden: event.player.hidden,
          x: event.x, y: event.y };
      }
      return emit.call(this, event);
    };
  }, enemy.id);
  // This source is outside player interest but inside the shot-event margin.
  // Its sound/effect must use event coordinates, never its stale replica position.
  enemy.x = me.x + 3750; enemy.y = me.y; enemy.angle = Math.PI; enemy.vx = 0; enemy.vy = 0;
  live.world.fireGun(enemy, live.W.WEAPONS.ar);
  await browser.waitFor('!!presenceQA.remoteShot');
  const remoteShot = await evaluate(() => presenceQA.remoteShot);
  check(remoteShot.canonical && remoteShot.hidden, 'a hidden source keeps its canonical player identity for shot events');
  check(Math.abs(remoteShot.x - enemy.x) < 1 && Math.abs(remoteShot.y - enemy.y) < 1,
    'shot effects and audio receive authoritative source coordinates outside player interest');

  const ticket = live.slots.find(s => s.player === me).ticket;
  await evaluate((id, ticket) => Warz.Online.join(id, ticket, true), String(live.id), ticket);
  await browser.waitFor('Warz.debug.online().info.rejoin && Warz.debug.online().snapCount >= 3');
  await browser.sleep(550);
  check(await evaluate(() => presenceQA.drawn.every(id => id === Warz.debug.player().id)), 'rejoining at the centre does not expose the full roster');
  check(await evaluate(() => {
    const m = Warz.debug.match();
    return m.world.players.every(p => p === m.player || p.hidden);
  }), 'global rejoin sync keeps distant opponents hidden until they enter interest');
  check(await evaluate(() => presenceQA.phantomDraws.length === 0), 'initial join and rejoin both avoid placeholder player rendering');
  await browser.shot('05-rejoined-no-phantoms.png');
  check(browser.errors.length === 0, 'no page exceptions during visibility, damage and reconnect checks');
  console.log('Presence QA passed: ' + checks + ' checks. Screenshots: ' + browser.outDir);
} finally {
  if (browser) await browser.close();
  await app.close();
}
