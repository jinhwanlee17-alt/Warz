// Physical mouse/key regression: carried launchers or hand grenades must not steal mounted turret input.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'output', 'qa-turret');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 2,
  log: { info() {}, warn: console.warn, error: console.error } });
let browser;
const report = [], check = (ok, message) => { assert.ok(ok, message); report.push(message); console.log('ok  ' + message); };

function prepare(W, world, p, cls) {
  ['rocks', 'trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations', 'drops'].forEach(k => world.map[k] = []);
  world.solids = new W.U.SpatialHash(256); world.structures = [];
  world.resetItems(p); world.setClass(p, cls, true);
  p.x = 5000; p.y = 5000; p.vx = 0; p.vy = 0; p.dropT = 0; p.alive = true; p.downed = false;
  world.grenades = []; world.bullets = []; world.zones = []; world.explosions = []; world.particles = [];
}

try {
  const { port } = await app.listen(0, '127.0.0.1');
  browser = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => browser.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const mouse = type => browser.cmd('Input.dispatchMouseEvent', { type, x: 1150, y: 450, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  const selectSlot = async slot => {
    const key = String(slot + 1), code = 'Digit' + key;
    await browser.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key, windowsVirtualKeyCode: 49 + slot });
    await sleep(100);
    await browser.cmd('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: 49 + slot });
    await browser.waitFor('Warz.debug.player().slot===' + slot);
  };
  const interact = async () => {
    await browser.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69 });
    await sleep(100);
    await browser.cmd('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyE', key: 'e', windowsVirtualKeyCode: 69 });
  };
  await browser.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=22' });
  await browser.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
  await evaluate(() => {
    const renderer = Warz.debug.renderer(), original = renderer.render;
    renderer.render = function (world, cam, opts) {
      if (window.turretQA && opts && opts.trajectory) {
        turretQA.preview = opts.trajectory.range;
        turretQA.trajectory++;
        if (Warz.debug.player().mount) turretQA.mountedTrajectory++;
      }
      return original.call(this, world, cam, opts);
    };
  });
  for (const online of [false, true]) {
    if (online) {
      await browser.evaluate('Warz.App.leaveMatch(); Warz.Lobby.queue("solo")');
      await browser.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>1');
    } else await browser.evaluate('Warz.App.startPractice()');
    const live = online ? app.matches.get(String(await browser.evaluate('Warz.debug.match().id'))) : null;
    const owner = online ? live.byId.get(await browser.evaluate('Warz.debug.player().id')) : null;
    let serverEvents = [];
    if (online) {
      for (const bot of live.players.filter(p => p !== owner)) {
        bot.controller = () => ({ mx: 0, my: 0 }); bot.x = 12000; bot.y = 12000; bot.dropT = 0;
      }
      const original = live.world.emit;
      live.world.emit = function (event) {
        if (event.player && event.player.id === owner.id) serverEvents.push({ type: event.type, weapon: event.weapon });
        return original.call(this, event);
      };
    }
    for (const variant of [
      { cls: 'grenadier', slot: 0, name: 'Launcher I', turret: 'turret', turretHp: 100 },
      { cls: 'grenadier2', slot: 0, name: 'Launcher II', turret: 'turret2', turretHp: 200 },
      { cls: 'grenadier', slot: 1, name: 'Hand grenade', turret: 'turret3', turretHp: 500 }
    ]) {
      const { cls, slot } = variant, grenade = slot === 1;
      const label = (online ? 'Online ' : 'Practice ') + variant.name + ' / ' + variant.turret;
      const shotPrefix = (online ? 'online-' : 'practice-') + cls + '-slot' + slot + '-' + variant.turret;
      await mouse('mouseReleased');
      await sleep(100);
      if (online) {
        prepare(live.W, live.world, owner, cls);
        await browser.waitFor('Warz.debug.player().classId===' + JSON.stringify(cls));
      }
      await evaluate((source, cls, online) => {
        const m = Warz.debug.match(), world = m.world, p = m.player;
        (0, eval)('(' + source + ')')(Warz, world, p, cls);
        if (!online) world.storm = null;
        m.cam.x = p.x; m.cam.y = p.y; m.cam.zoom = 1; Warz.debug.renderer().map = null;
        window.turretQA = { shots: [], launches: [], throws: [], trajectory: 0, mountedTrajectory: 0, preview: null };
        if (!world.turretQAWatching) {
          const emit = world.emit;
          world.emit = function (event) {
            if (event.player && event.player.id === p.id) {
              if (event.type === 'shot') turretQA.shots.push(event.weapon);
              else if (event.type === 'launch') turretQA.launches.push(event.weapon);
              else if (event.type === 'throw') turretQA.throws.push(event.item || event.weapon);
            }
            return emit.call(this, event);
          };
          world.turretQAWatching = true;
        }
      }, prepare.toString(), cls, online);
      await selectSlot(slot);
      const spec = { kind: 'turret', item: variant.turret, x: 5060, y: 5000, r: 24, hp: variant.turretHp, maxHp: variant.turretHp };
      if (online) live.world.addStruct({ ...spec, owner: owner.id, team: owner.team });
      else await evaluate(spec => { const m = Warz.debug.match(); m.world.addStruct({ ...spec, owner: m.player.id, team: m.player.team }); }, spec);
      await browser.waitFor('!!Warz.debug.match().world.nearestMountable(Warz.debug.player())');
      const ammoBefore = await browser.evaluate('Warz.debug.player().weapons[0].ammo');
      const grenadesBefore = await browser.evaluate('Warz.debug.player().grenades');
      await interact();
      await browser.waitFor('Warz.debug.player().mount>0');
      check(await browser.evaluate('Warz.debug.match().world.aimedProjectile(Warz.debug.player())===null'), label + ': mounting overrides the carried projectile weapon');
      check(await browser.evaluate('document.getElementById("hud-ammo-label").textContent.startsWith("turret")'), label + ': mounted HUD describes turret fire rather than grenade charging');
      serverEvents = [];
      await mouse('mouseMoved'); await mouse('mousePressed'); await sleep(650);
      check(await browser.evaluate('turretQA.shots.length>=4 && turretQA.shots.every(w=>w==="turret")'), label + ': held mouse continuously fires only turret bullets');
      check(await browser.evaluate('turretQA.launches.length===0 && turretQA.throws.length===0 && turretQA.mountedTrajectory===0'), label + ': no launcher shell, grenade or aiming arc while mounted');
      check(await evaluate((ammo, grenades) => Warz.debug.player().weapons[0].ammo === ammo && Warz.debug.player().grenades === grenades, ammoBefore, grenadesBefore), label + ': launcher ammunition and grenades stay untouched');
      if (online) {
        check(serverEvents.filter(e => e.type === 'shot').length >= 4 && serverEvents.filter(e => e.type === 'shot').every(e => e.weapon === 'turret') && !serverEvents.some(e => e.type === 'launch' || e.type === 'throw'), label + ': server also receives automatic turret fire only');
      }
      await browser.shot(shotPrefix + '-mounted.png');
      // Dismount with the same physical hold still down. Releasing it must not
      // become a projectile charge inherited from operating the turret.
      await interact(); await browser.waitFor('Warz.debug.player().mount===0');
      await sleep(150); await mouse('mouseReleased'); await sleep(200);
      check(await browser.evaluate('turretQA.launches.length===0 && turretQA.throws.length===0'), label + ': dismount and release do not fire a leftover charge');
      check(await evaluate(ammo => Warz.debug.player().weapons[0].ammo === ammo, ammoBefore), label + ': dismount preserves launcher ammunition');
      await mouse('mousePressed'); await sleep(850);
      check(await evaluate(min => turretQA.launches.length === 0 && turretQA.throws.length === 0 && turretQA.trajectory > 0 && turretQA.preview > min, grenade ? 500 : 600), label + ': a fresh hold charges the projectile and shows its aiming arc');
      await browser.shot(shotPrefix + '-dismounted-charge.png');
      await mouse('mouseReleased');
      if (grenade) {
        await browser.waitFor('turretQA.throws.length===1');
        await browser.waitFor('Warz.debug.player().grenades===' + (grenadesBefore - 1));
        check(await evaluate(ammo => turretQA.throws.length === 1 && turretQA.launches.length === 0 && Warz.debug.player().weapons[0].ammo === ammo, ammoBefore), label + ': fresh release throws exactly one hand grenade without consuming launcher ammunition');
        if (online) check(owner.grenades === grenadesBefore - 1 && serverEvents.filter(e => e.type === 'throw').length === 1, label + ': server confirms one hand grenade consumed after dismount');
      } else {
        await browser.waitFor('turretQA.launches.length===1');
        await browser.waitFor('Warz.debug.player().weapons[0].ammo===' + (ammoBefore - 1));
        check(await browser.evaluate('turretQA.launches.length===1 && turretQA.throws.length===0'), label + ': fresh release launches exactly one shell');
        if (online) check(owner.weapons[0].ammo === ammoBefore - 1 && serverEvents.filter(e => e.type === 'launch').length === 1, label + ': server confirms one shell and one round consumed after dismount');
      }
    }
  }
  await browser.evaluate('Warz.App.leaveMatch()');
  check(browser.errors.length === 0, 'no page errors during mounting, automatic fire, dismounting and charging');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks: report, errors: browser.errors }, null, 2));
  console.log('Turret browser QA: ' + report.length + ' checks passed. Screenshots: ' + outDir);
} finally {
  if (browser) await browser.close();
  await app.close();
}
