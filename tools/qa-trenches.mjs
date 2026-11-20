// Walk an actual generated trench with keyboard input; sample the rendered soldier's scale.
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const outDir = path.resolve('output/qa-trenches');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: .2, botFill: 2,
  log: { info() {}, warn() {}, error: console.error } });
const checks = [], screenshots = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log(message); };
let browser;

function startingBank(W, world, player) {
  const trench = world.map.trenches.find(t => t.biome === 'grassland') || world.map.trenches[0];
  const middle = Math.floor(trench.points.length / 2);
  const a = trench.points[middle - 1], b = trench.points[middle];
  const wall = W.Trenches.wall(trench, (a.x + b.x) / 2, (a.y + b.y) / 2);
  world.resetTrench(player);
  player.x = wall.x + wall.nx * 46; player.y = wall.y + wall.ny * 46;
  player.vx = player.vy = player.dropT = 0;
  return Math.abs(wall.nx) > Math.abs(wall.ny) ? (wall.nx > 0 ? 'KeyA' : 'KeyD') : (wall.ny > 0 ? 'KeyW' : 'KeyS');
}

function startingWire(W, world, player) {
  const trench = world.map.trenches[0], wire = trench.wires[0];
  world.resetTrench(player);
  player.x = (wire.a.x + wire.b.x) / 2; player.y = (wire.a.y + wire.b.y) / 2;
  player.vx = player.vy = 0;
  const wall = W.Trenches.wall(trench, player.x, player.y);
  return Math.abs(wall.nx) > Math.abs(wall.ny) ? (wall.nx > 0 ? 'KeyD' : 'KeyA') : (wall.ny > 0 ? 'KeyS' : 'KeyW');
}

function stageTank(W, world, player) {
  const tank = world.vehicles.find(v => v.type === 'tank' && !v.wreck && !v.seats.driver);
  for (const trench of world.map.trenches) {
    const index = trench.wires.findIndex(w => !w.destroyed);
    if (index < 0) continue;
    const wire = trench.wires[index], x = (wire.a.x + wire.b.x) / 2, y = (wire.a.y + wire.b.y) / 2;
    const wall = W.Trenches.wall(trench, x, y), distance = tank.r + W.Trenches.wireRadius + 22;
    const start = { x: x - wall.nx * distance, y: y - wall.ny * distance };
    if (!world.spotFree(start.x, start.y, tank.r, false)) continue;
    const horizontal = Math.abs(wall.nx) > Math.abs(wall.ny);
    const dx = horizontal ? Math.sign(wall.nx) : 0, dy = horizontal ? 0 : Math.sign(wall.ny);
    Object.assign(tank, start, { angle: Math.atan2(dy, dx), vx: 0, vy: 0 });
    world.resetTrench(player);
    Object.assign(player, start, { vx: 0, vy: 0 });
    if (world.enterVehicle(player, tank, 'driver')) {
      return { tank: tank.id, trench: trench.id, index, key: horizontal ? (dx > 0 ? 'KeyD' : 'KeyA') : (dy > 0 ? 'KeyS' : 'KeyW') };
    }
  }
  throw new Error('No clear approach for the test tank');
}

try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = (code, down) => browser.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp',
    code, key: code === 'Space' ? ' ' : code.at(-1).toLowerCase(), windowsVirtualKeyCode: code === 'Space' ? 32 : code.charCodeAt(code.length - 1) });
  const tap = async code => { await key(code, true); await key(code, false); };
  const shot = async name => screenshots.push(await browser.shot(name + '.png'));
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=74' });
  await browser.waitFor('window.Warz?.App?.ready && Warz.Net.online()');

  for (const mode of ['practice', 'online']) {
    if (mode === 'practice') await evaluate(() => Warz.App.startPractice());
    else {
      await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('solo'); });
      await browser.waitFor('Warz.debug.match()?.online && Warz.debug.online().snapCount > 2', 30000);
    }
    const matchId = await evaluate(() => Warz.debug.match().id);
    const live = mode === 'online' ? app.matches.get(String(matchId)) : null;
    const owner = live && live.byId.get(await evaluate(() => Warz.debug.player().id));
    if (live) {
      startingBank(live.W, live.world, owner);
      live.players.filter(p => p !== owner).forEach(p => { p.controller = () => ({}); });
    }
    const moveKey = await evaluate((src, mode) => {
      const m = Warz.debug.match(), p = m.player, renderer = Warz.debug.renderer();
      const code = (0, eval)('(' + src + ')')(Warz, m.world, p);
      if (mode === 'practice') m.world.storm = null;
      m.cam.x = p.x; m.cam.y = p.y; m.cam.zoom = 1;
      Warz.Hud.banner('', '', .01);
      window.trenchFrames = [];
      if (!window.trenchScaleProbe) {
        const draw = renderer.drawPlayer;
        renderer.drawPlayer = function (ctx, player, ...args) {
          if (player !== Warz.debug.player()) return draw.call(this, ctx, player, ...args);
          const scale = ctx.scale;
          let recorded = false;
          ctx.scale = function (x, y) {
            if (!recorded) {
              window.trenchFrames.push({ phase: player.trenchPhase, peek: player.trenchPeeking, scale: x });
              recorded = true;
            }
            return scale.call(this, x, y);
          };
          try { return draw.call(this, ctx, player, ...args); } finally { ctx.scale = scale; }
        };
        window.trenchScaleProbe = true;
      }
      return code;
    }, startingBank.toString(), mode);
    await sleep(300);
    await key(moveKey, true);
    await browser.waitFor('Warz.debug.player().trenchPhase === "enter"');
    await key(moveKey, false);
    await browser.waitFor('Warz.debug.player().trenchPhase === "inside" && document.getElementById("hud-prompt").textContent.includes("In cover")');
    if (mode === 'practice') await shot('01-trench-floor');
    const playerOnWall = await evaluate(() => {
      const m = Warz.debug.match(), p = m.player, wall = Warz.Trenches.wall(m.world.map.trenches[p.trenchId - 1], p.x, p.y);
      return wall.distance <= p.r * .9;
    });
    check(playerOnWall, mode + ' walking over the bank enters the trench beside its wall');
    await key('Space', true);
    await browser.waitFor('Warz.debug.player().trenchPeeking && document.getElementById("hud-prompt").textContent.includes("Peeking")');
    if (live) { await sleep(120); check(owner.trenchPeeking, 'online server confirms the held Space peek'); }
    if (mode === 'practice') await shot('02-peeking');
    await key('Space', false);
    await browser.waitFor('!Warz.debug.player().trenchPeeking && document.getElementById("hud-prompt").textContent.includes("In cover")');
    const ammo = await evaluate(() => Warz.debug.player().weapons[0].ammo);
    const pointer = { x: 880, y: 440, button: 'left', clickCount: 1 };
    await browser.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', buttons: 1, ...pointer });
    try {
      await browser.waitFor('Warz.debug.player().weapons[0].ammo < ' + ammo);
    } finally {
      await browser.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', buttons: 0, ...pointer });
    }
    check(await evaluate(() => Warz.debug.player().trenchPhase === 'inside' && !Warz.debug.player().trenchPeeking) &&
      (!owner || owner.weapons[0].ammo < ammo), mode + ' primary fire spends ammunition on the trench floor while the player stays in cover');
    await sleep(450);
    await tap('Space'); await sleep(45); await tap('Space');
    await browser.waitFor('Warz.debug.player().trenchPhase === "exit" && document.getElementById("hud-prompt").textContent.includes("Climbing out")');
    if (mode === 'practice') await shot('03-climbing');
    await browser.waitFor('!Warz.debug.player().trenchId && !Warz.Trenches.at(Warz.debug.match().world.map,Warz.debug.player().x,Warz.debug.player().y)');
    if (mode === 'practice') await shot('04-bank');
    const animation = await evaluate(() => {
      const values = phase => [...new Set(window.trenchFrames.filter(f => f.phase === phase).map(f => f.scale))];
      const enter = values('enter'), exit = values('exit');
      const floor = window.trenchFrames.find(f => f.phase === 'inside' && !f.peek)?.scale;
      const peek = window.trenchFrames.find(f => f.peek)?.scale;
      return enter.length > 3 && exit.length > 3 && enter.at(-1) < enter[0] && exit.at(-1) > exit[0] &&
        floor < peek && peek < 1 && window.trenchFrames.at(-1)?.scale === 1;
    });
    check(animation, mode + ' soldier shrinks in stages, rises to peek, and grows to full size on exit');
    if (owner) {
      const until = Date.now() + 1500;
      while (owner.trenchId && Date.now() < until) await sleep(25);
    }
    check(!owner || !owner.trenchId, mode + ' double-tap exits onto the surface');
    if (mode === 'practice') {
      await tap('KeyM'); await browser.waitFor('Warz.MapScreen.isOpen() && document.getElementById("bigmap").width > 350');
      await shot('05-island-map');
      const mapPixels = await evaluate(() => {
        const map = Warz.debug.match().world.map, px = document.getElementById('bigmap').width;
        const image = m => Warz.MapArt.base(m, px, { big: true, dpr: 1 }).getContext('2d').getImageData(0, 0, px, px).data;
        const drawn = image(map), plain = image({ ...map, trenches: [] });
        return map.trenches.some(t => t.points.some(p => {
          const x = Math.floor(p.x * px / map.size), y = Math.floor(p.y * px / map.size), i = 4 * (y * px + x);
          return Math.abs(drawn[i] - plain[i]) + Math.abs(drawn[i + 1] - plain[i + 1]) + Math.abs(drawn[i + 2] - plain[i + 2]) > 40;
        }));
      });
      check(mapPixels, 'trench ink is visible at generated coordinates on the full island map');
      await tap('KeyM');
    }
    const hpBeforeWire = await evaluate(() => Warz.debug.player().hp);
    if (owner) startingWire(live.W, live.world, owner);
    const leaveWire = await evaluate(src => (0, eval)('(' + src + ')')(Warz, Warz.debug.match().world, Warz.debug.player()), startingWire.toString());
    await browser.waitFor('document.getElementById("hud-prompt").textContent.includes("Barbed wire · movement slowed · 10 damage per second")');
    await browser.waitFor('Warz.debug.player().hp < ' + hpBeforeWire);
    const hpAfterWireHit = await evaluate(() => Warz.debug.player().hp);
    check(hpAfterWireHit === hpBeforeWire - 10 && (!owner || owner.hp === hpAfterWireHit),
      mode + ' standing in barbed wire costs 10 HP on the first damage tick');
    await key(leaveWire, true);
    try {
      await browser.waitFor('!document.getElementById("hud-prompt").textContent.includes("Barbed wire")');
    } finally {
      await key(leaveWire, false);
    }
    check(await evaluate(() => {
      const p = Warz.debug.player();
      return !p.trenchId && !Warz.Trenches.wireAt(Warz.debug.match().world.map, p.x, p.y, p.r);
    }), mode + ' walking clear of the wire removes its slowdown prompt on the surface');
    const clearTime = await evaluate(() => Warz.debug.match().world.time);
    await browser.waitFor('Warz.debug.match().world.time >= ' + (clearTime + 1.1));
    check(await evaluate(() => Warz.debug.player().hp) === hpAfterWireHit && (!owner || owner.hp === hpAfterWireHit),
      mode + ' health stays steady for the next second after leaving the wire');

    const target = owner ? stageTank(live.W, live.world, owner) :
      await evaluate(src => (0, eval)('(' + src + ')')(Warz, Warz.debug.match().world, Warz.debug.player()), stageTank.toString());
    await browser.waitFor('Warz.debug.player().vehicle === ' + target.tank);
    await key(target.key, true);
    try {
      await browser.waitFor('Warz.debug.match().world.map.trenches[' + (target.trench - 1) + '].wires[' + target.index + '].destroyed === true');
    } finally {
      await key(target.key, false);
    }
    const cleared = await evaluate(({ trench, index }) => {
      const map = Warz.debug.match().world.map, wire = map.trenches[trench - 1].wires[index];
      return !Warz.Trenches.wireAt(map, (wire.a.x + wire.b.x) / 2, (wire.a.y + wire.b.y) / 2, Warz.CONFIG.playerRadius);
    }, target);
    check(cleared && (!live || live.world.map.trenches[target.trench - 1].wires[target.index].destroyed),
      mode + ' driving a tank over the coil clears it for infantry');
  }
  check(!browser.errors.length, 'both modes run without browser exceptions');
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify({ checks, screenshots, errors: browser.errors }, null, 2));
} finally {
  if (browser) await browser.close();
  await app.close();
}
