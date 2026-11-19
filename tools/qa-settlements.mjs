import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const outDir = path.resolve('output/qa-settlements');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: .2, botFill: 4, log: { info() {}, warn() {}, error: console.error } });
const checks = [];
let b;
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
try {
  const { port } = await app.listen(0, '127.0.0.1');
  b = await openBrowser({ outDir, width: 1440, height: 1000 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = async (code, down) => b.cmd('Input.dispatchKeyEvent', {
    type: down ? 'rawKeyDown' : 'keyUp', code, key: code === 'Escape' ? code : code.slice(-1).toLowerCase(),
    windowsVirtualKeyCode: code === 'Escape' ? 27 : code.charCodeAt(code.length - 1)
  });
  const press = async code => { await key(code, true); await sleep(60); await key(code, false); await sleep(100); };
  await b.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=42' });
  await b.waitFor('window.Warz?.App?.ready && Warz.Net.online()');
  await evaluate(() => {
    Warz.App.startPractice();
    const m = Warz.debug.match(); m.world.storm = null; m.player.dropT = 0;
    // Pause guard fire only in the preview fixture while testing doorway movement.
    m.world.structures.filter(s => s.kind === 'sentry').forEach(s => { s.cooldown = 9999; });
    Warz.Hud.banner('', '', .01);
    const renderer = Warz.debug.renderer(), render = renderer.render;
    renderer.render = function (world, cam, opts) { cam.zoom = window.qaZoom || 1; return render.call(this, world, cam, opts); };
  });
  const counts = await evaluate(() => {
    const m = Warz.debug.match(), towns = m.world.map.towns;
    return { villages: towns.filter(t => t.kind === 'village').length, towns: towns.filter(t => t.kind === 'town').length,
      other: towns.filter(t => !['village','town'].includes(t.kind)).length,
      guards: m.world.structures.filter(s => s.neutral && !s.militaryBase).length, expected: m.world.map.settlementStructures.length };
  });
  check(counts.villages >= 4 && counts.villages <= 6 && counts.towns === 2 && counts.other === 0, 'only four to six villages and two towns replace the old settlements');
  check(counts.guards === counts.expected && counts.guards > 0, 'offline play initializes every seeded neutral guard');
  await press('KeyM'); await b.waitFor('Warz.MapScreen.isOpen()'); await b.shot('settlement-island.png'); await press('Escape');
  for (const kind of ['village','town']) {
    await evaluate(kind => {
      const m = Warz.debug.match(), t = m.world.map.towns.find(t => t.kind === kind);
      Warz.debug.teleport(t.x, t.y + 190); m.cam.x = t.x; m.cam.y = t.y;
      window.qaZoom = kind === 'village' ? .55 : .25;
    }, kind);
    await sleep(180); await b.shot(kind + '-layout.png');
  }
  const door = await evaluate(() => {
    const m = Warz.debug.match(), house = m.world.map.buildings.find(b => !b.ruined), d = house.doorways[0];
    const out = { top: [0,-1,'KeyS'], bottom: [0,1,'KeyW'], left: [-1,0,'KeyD'], right: [1,0,'KeyA'] }[d.side];
    const x = d.x + d.w / 2, y = d.y + d.h / 2;
    Warz.debug.teleport(x + out[0] * 65, y + out[1] * 65); m.player.vx = m.player.vy = 0;
    m.cam.x = house.x + house.w / 2; m.cam.y = house.y + house.h / 2; window.qaZoom = 1;
    window.qaHouse = house;
    return { code: out[2], house };
  });
  await sleep(150); await b.shot('house-visible-entrance.png');
  await key(door.code, true); await sleep(700); await key(door.code, false); await sleep(100);
  check(await evaluate(() => { const p = Warz.debug.player(), h = window.qaHouse; return p.x > h.x && p.x < h.x + h.w && p.y > h.y && p.y < h.y + h.h; }), 'a physical movement key enters through the visible door without wall searching');
  await b.shot('house-interior.png');
  await evaluate(() => {
    const m = Warz.debug.match(), t = m.world.map.towns.find(t => t.kind === 'village');
    Warz.debug.teleport(t.x, t.y + 75); m.player.vx = m.player.vy = 0;
  });
  await press('KeyE');
  check(await evaluate(() => { const m = Warz.debug.match(), s = m.world.structById(m.player.mount); return s?.neutral && s.kind === 'turret' && s.mounted === m.player.id; }), 'the center neutral turret is rideable through the normal interact key');
  await press('KeyE');
  check(await evaluate(() => !Warz.debug.player().mount), 'the player can leave the neutral turret normally');
  await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('duo'); });
  await b.waitFor('Warz.App.state() === "play" && Warz.debug.match().online && Warz.debug.online().snapCount > 2', 30000);
  const id = await evaluate(() => Warz.debug.match().id), live = app.matches.get(String(id));
  const client = await evaluate(() => {
    const m = Warz.debug.match();
    return { structures: m.world.structures.filter(s => s.neutral).map(s => [s.id,s.item,s.x,s.y,s.hp]),
      vehicles: m.world.vehicles.filter(v => v.settlement !== null).map(v => [v.id,v.armed]),
      buildings: m.world.map.buildings.map(b => [b.id,b.ruined,b.crateTier]) };
  });
  const serverGuards = live.world.structures.filter(s => s.neutral);
  check(client.structures.length === serverGuards.length && client.structures.every(row => {
    const s = serverGuards.find(s => s.id === row[0]);
    return s && row[1] === s.item && Math.hypot(row[2] - s.x, row[3] - s.y) < .15 && row[4] === s.hp;
  }) &&
    JSON.stringify(client.buildings) === JSON.stringify(live.world.map.buildings.map(b => [b.id,b.ruined,b.crateTier])), 'browser and server agree on house plots, loot tiers and neutral guard state');
  check(client.vehicles.length === 2 && client.vehicles.every(v => v[1]), 'Duos towns each have their guaranteed armed Humvee');
  const guard = live.world.structures.find(s => s.neutral), playerId = await evaluate(() => Warz.debug.player().id);
  live.world.damageStruct(guard, guard.hp, playerId, guard.x, guard.y);
  await b.waitFor('!Warz.debug.match().world.structById(' + guard.id + ')');
  check(true, 'destroying an authoritative neutral guard removes it from the browser');
  check(b.errors.length === 0, 'new settlements render and run offline and online without browser exceptions');
  fs.writeFileSync(path.join(outDir,'report.json'), JSON.stringify({checks,counts,errors:b.errors},null,2));
  console.log('Settlement browser QA: all ' + checks.length + ' checks passed');
} catch (error) {
  if (b) console.error(JSON.stringify({ errors: b.errors, state: await b.evaluate('({state:Warz.App.state(),online:Warz.Net.online(),body:document.body.innerText.slice(-1000)})') }, null, 2));
  throw error;
} finally { if (b) await b.close(); await app.close(); }
