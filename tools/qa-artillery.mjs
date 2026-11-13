// Local browser coverage for fullscreen artillery maps and fire-control input.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), outDir = path.join(root, 'output/qa-artillery');
const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: .15, botFill: 4, log: { info() {}, warn: console.warn, error: console.error } });
let b;
const checks = [], check = (ok, message) => { assert.ok(ok, message); checks.push(message); console.log('ok  ' + message); };
function terrain(W, world) {
  ['rocks', 'trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'stations'].forEach(key => world.map[key] = []);
  world.structures = []; world.solids = new W.U.SpatialHash(256); world.buildSolids(); world.storm = null;
}
function prepare(W, world, p) {
  terrain(W, world);
  world.vehicles.forEach((v, i) => { v.x = 13000 + i * 220; v.y = 13000; v.seats = { driver: 0, gunner: 0, rearLeft: 0, rearRight: 0 }; });
  world.players.forEach(o => { o.vehicle = 0; o.mount = 0; o.vehicleSeat = null; o.dropT = 0; o.x = o.y = 16000; o.vx = o.vy = 0; });
  world.setClass(p, 'grenadier2', true); p.alive = true; p.downed = false; p.hp = p.maxHp; p.held = -1;
  const v = world.vehicles.find(v => v.type === 'artillery'); v.x = 5000; v.y = 5000; v.vx = v.vy = v.ox = v.oy = 0; v.angle = 0; v.stationaryT = 0; v.artilleryCooldown = 0;
  const at = world.vehicleSeatPoint(v, 'driver', true); p.x = p.px = at.x; p.y = p.py = at.y;
  world.qaArtillery = v;
  if (!world.qaImpactWatching) { const impact = world.artilleryImpact; world.artilleryImpact = function (shell) { this.qaArtilleryImpacts = (this.qaArtilleryImpacts || 0) + 1; return impact.call(this, shell); }; world.qaImpactWatching = true; }
}
try {
  const { port } = await app.listen(0, '127.0.0.1');
  b = await openBrowser({ outDir, width: 1440, height: 900 });
  const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
  const key = (code, down) => b.cmd('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code, key: code === 'Enter' ? 'Enter' : code === 'Escape' ? 'Escape' : code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code === 'Enter' ? 13 : code === 'Escape' ? 27 : code.charCodeAt(code.length - 1) });
  const press = async code => { await key(code, true); await sleep(85); await key(code, false); await sleep(85); };
  const mouse = (down, right = false, x = 1100, y = 450) => b.cmd('Input.dispatchMouseEvent', { type: down ? 'mousePressed' : 'mouseReleased', x, y, button: right ? 'right' : 'left', buttons: down ? right ? 2 : 1 : 0, clickCount: 1 });
  const wheel = (deltaY, x, y) => b.cmd('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  const watchMaps = () => evaluate(() => {
    if (window.artilleryMapQA) return;
    window.artilleryMapQA = { terrain: {}, overlay: {}, paintCalls: 0 };
    const base = Warz.MapArt.base, paintBase = Warz.MapArt.paintBase, overlay = Warz.MapArt.overlay;
    Warz.MapArt.base = function (map, px, opts) {
      const canvas = base.apply(this, arguments);
      if (opts.big) { const name = Warz.ArtilleryUI.isOpen() ? 'artillery' : 'island'; artilleryMapQA.terrain[name] = { px, image: canvas.toDataURL() }; }
      return canvas;
    };
    Warz.MapArt.overlay = function (g, world, player, px, opts) {
      if (opts.big && Warz.ArtilleryUI.isOpen()) artilleryMapQA.overlay = { allVehicles: !!opts.allVehicles, tinyPlayers: !!opts.tinyPlayers };
      return overlay.apply(this, arguments);
    };
    Warz.MapArt.paintBase = function (g, map, px, opts) {
      artilleryMapQA.paintCalls++; artilleryMapQA.paint = { big: opts.big, seed: map.seed, view: opts.view };
      return paintBase.apply(this, arguments);
    };
  });
  await b.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
  await b.waitFor('window.Warz?.App?.ready && Warz.Net.online()');
  check((await evaluate(() => Warz.Account.register({ username: 'ArtilleryQA', email: 'artillery@example.test', password: 'local-artillery-qa-only' }))).ok, 'local test account supports reconnect validation');
  for (const online of [false, true]) {
    const label = online ? 'Online' : 'Practice';
    if (online) { await evaluate(() => { Warz.App.leaveMatch(); Warz.Lobby.queue('solo'); }); await b.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>2'); }
    else await evaluate(() => Warz.App.startPractice());
    const live = online ? app.matches.get(String(await evaluate(() => Warz.debug.match().id))) : null;
    const owner = live ? live.byId.get(await evaluate(() => Warz.debug.player().id)) : null;
    const mutate = async (fn, ...args) => live ? fn(live.W, live.world, owner, ...args) : evaluate((source, args) => { const m = Warz.debug.match(); return (0, eval)('(' + source + ')')(Warz, m.world, m.player, ...args); }, fn.toString(), args);
    await evaluate(source => { window.terrain = (0, eval)('(' + source + ')'); }, terrain.toString());
    if (live) { live.players.forEach(p => { if (p !== owner) p.controller = () => ({ mx: 0, my: 0 }); }); prepare(live.W, live.world, owner); }
    else await mutate(prepare);
    await evaluate((source) => (0, eval)('(' + source + ')')(Warz, Warz.debug.match().world), terrain.toString());
    await watchMaps();
    await b.waitFor('document.getElementById("hud-prompt").textContent.includes("Drive SP Artillery")');
    check(await evaluate(() => { const list = Warz.debug.match().world.vehicles.filter(v => v.type === 'artillery'); return list.filter(v => !v.fixed).length === 4 && list.filter(v => v.fixed).length === 6; }), label + ': four mobile and six fixed artillery spawn alongside existing vehicles');
    await press('KeyE'); await b.waitFor('Warz.debug.player().vehicle && Warz.debug.match().world.vehicleById(Warz.debug.player().vehicle).type==="artillery"');
    check(await evaluate(() => document.getElementById('hud-vehicle-name').textContent === 'SP Artillery' && document.getElementById('hud-ammo-label').textContent.includes('2 targeting map')), label + ': driver has dedicated artillery HUD and mode controls');
    await b.waitFor('Math.abs(Warz.debug.match().cam.zoom-1)<.01');
    check(true, label + ': boarding artillery keeps the normal gameplay camera zoom');
    await mutate((W, world, p) => world.setClass(p, 'armorcrew', true));
    await b.waitFor('Warz.debug.player().classId==="armorcrew"');
    check(await evaluate(() => { const w = Warz.debug.match().world, v = w.vehicleById(Warz.debug.player().vehicle); return Math.abs(w.vehicleMaxSpeed(v) - Warz.ARTILLERY.maxSpeed * 1.1) < .001; }), label + ': Armor Crew SP artillery uses the 10% driving speed bonus');
    check(await evaluate(() => { const v = Warz.debug.match().world.vehicleById(Warz.debug.player().vehicle); return v.hp === 1200 && v.maxHp === 1200; }), label + ': SP artillery has 1200 HP');
    await mutate((W, w, p) => w.damageVehicle(w.vehicleById(p.vehicle), 100, null, 'ar'));
    await b.waitFor('document.getElementById("hud-vehicle-text").textContent.startsWith("1175 / 1200")');
    check(await evaluate(() => Warz.debug.player().hp === 150), label + ': tank armor reduces 100 bullet damage to 25 hull HP and protects the operator');
    await sleep(600); const initial = await evaluate(() => Warz.debug.player().x);
    await key('KeyD', true); await sleep(450); await key('KeyD', false); await sleep(350);
    check(await evaluate(x => Warz.debug.player().x > x + 20, initial), label + ': WASD drives the artillery');
    await mutate((W, w, p) => { const v = w.vehicleById(p.vehicle); v.vx = v.vy = 0; v.stationaryT = 0; });
    await press('Digit2'); await b.waitFor('Warz.ArtilleryUI.isOpen() && document.getElementById("artillery-screen").hidden===false');
    check(await evaluate(() => { const r = document.getElementById('artillery-map').getBoundingClientRect(), view = Warz.ArtilleryUI.view(); return r.left === 0 && r.top === 0 && r.width === innerWidth && r.height === innerHeight && view.width === innerWidth && view.height === innerHeight && view.zoom === 3; }), label + ': targeting fills the entire viewport and opens ready to pan');
    check(await evaluate(() => { const q = artilleryMapQA; return q.paintCalls > 0 && q.paint.big && q.paint.view && q.overlay.allVehicles && q.overlay.tinyPlayers; }), label + ': fullscreen targeting uses the shared detailed island painter and live map overlay');
    check(await evaluate(() => document.getElementById('artillery-fire').disabled), label + ': firing is locked during the ten-second stationary setup');
    await b.shot(online ? 'online-fullscreen.png' : 'practice-fullscreen.png');
    const panAt = await evaluate(() => ({ center: Warz.ArtilleryUI.view().centerX, x: Warz.debug.player().x, y: Warz.debug.player().y }));
    await key('KeyD', true); await sleep(450); await key('KeyD', false);
    check(await evaluate(at => { const p = Warz.debug.player(); return Warz.ArtilleryUI.view().centerX > at.center + 100 && Math.hypot(p.x - at.x, p.y - at.y) < .25; }, panAt), label + ': WASD immediately pans the fullscreen menu without moving the vehicle');
    const before = live ? owner.stats.shots : await evaluate(() => Warz.debug.player().stats.shots);
    const fullPoint = await evaluate(() => { const r = document.getElementById('artillery-map').getBoundingClientRect(); return { x: r.left + r.width * .7, y: r.top + r.height * .5 }; });
    await mouse(true, false, fullPoint.x, fullPoint.y); await mouse(false, false, fullPoint.x, fullPoint.y); await sleep(100);
    check((live ? owner.stats.shots : await evaluate(() => Warz.debug.player().stats.shots)) === before, label + ': clicking the map only selects a target');
    await mutate((W, w, p) => { w.vehicleById(p.vehicle).stationaryT = 0; });
    await press('Enter');
    check((live ? owner.stats.shots : await evaluate(() => Warz.debug.player().stats.shots)) === before, label + ': Enter cannot bypass stationary setup');
    const anchor = await evaluate(() => { const r = document.getElementById('artillery-map').getBoundingClientRect(), x = Math.round(r.left + r.width * .6), y = Math.round(r.top + r.height * .4); return { x, y, world: Warz.ArtilleryUI.screenToWorld(x, y) }; });
    await wheel(-500, anchor.x, anchor.y); await sleep(150);
    check(await evaluate(at => { const v = Warz.ArtilleryUI.view(), p = Warz.ArtilleryUI.screenToWorld(at.x, at.y); return v.zoom > 6 && v.zoom < 6.5 && Math.hypot(p.x - at.world.x, p.y - at.world.y) < .1; }, anchor), label + ': wheel up zooms in around the cursor');
    await sleep(250); const vehicleAt = await evaluate(() => { const v = Warz.debug.match().world.vehicleById(Warz.debug.player().vehicle); return { x: v.x, y: v.y }; });
    const centerBefore = await evaluate(() => Warz.ArtilleryUI.view().centerX);
    await key('KeyD', true); await sleep(1900); await key('KeyD', false);
    check(await evaluate((at, center) => { const v = Warz.debug.match().world.vehicleById(Warz.debug.player().vehicle); return Math.hypot(v.x - at.x, v.y - at.y) < .25 && Warz.ArtilleryUI.view().centerX > center + 50; }, vehicleAt, centerBefore), label + ': WASD pans the zoomed map without driving');
    const targetBeforeZoom = await evaluate(() => Warz.ArtilleryUI.view().target);
    await wheel(9000, anchor.x, anchor.y); await sleep(100);
    check(await evaluate(target => { const v = Warz.ArtilleryUI.view(); return v.zoom === 1 && v.centerX === Warz.CONFIG.worldSize / 2 && v.centerY === Warz.CONFIG.worldSize / 2 && JSON.stringify(v.target) === JSON.stringify(target); }, targetBeforeZoom), label + ': wheel down restores the whole island without changing the selected world target');
    await wheel(-9000, anchor.x, anchor.y); await sleep(100);
    check(await evaluate(() => { const v = Warz.ArtilleryUI.view(), c = document.getElementById('artillery-map'), r = c.getBoundingClientRect(), S = Warz.CONFIG.worldSize, a = Warz.ArtilleryUI.screenToWorld(r.left, r.top), b = Warz.ArtilleryUI.screenToWorld(r.right, r.bottom); return v.zoom === 8 && a.x >= -.1 && a.y >= -.1 && b.x <= S + .1 && b.y <= S + .1 && Math.abs(b.x - a.x - v.width / v.scale) < .1 && Math.abs(b.y - a.y - v.height / v.scale) < .1; }), label + ': maximum zoom is bounded and the rectangular viewport stays inside the island');
    await b.cmd('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 2, mobile: false }); await sleep(150);
    const clickAt = await evaluate(() => { const c = document.getElementById('artillery-map'), r = c.getBoundingClientRect(), v = Warz.ArtilleryUI.view(); return { x: r.left + r.width / 2 + 30, y: r.top + r.height / 2 - 20, expectedX: v.centerX + 30 / v.scale, expectedY: v.centerY - 20 / v.scale }; });
    await mouse(true, false, clickAt.x, clickAt.y); await mouse(false, false, clickAt.x, clickAt.y); await sleep(100);
    check(await evaluate(at => { const t = Warz.ArtilleryUI.view().target; return Math.hypot(t.x - at.expectedX, t.y - at.expectedY) < .1; }, clickAt), label + ': clicking after zoom and DPR resize selects the correct world coordinates');
    check(await evaluate(at => { const c = document.getElementById('artillery-map'), r = c.getBoundingClientRect(), x = Math.round((at.x - r.left - c.clientLeft) * c.width / c.clientWidth), y = Math.round((at.y - r.top - c.clientTop) * c.height / c.clientHeight), data = c.getContext('2d').getImageData(x - 2, y - 2, 5, 5).data; for (let i = 0; i < data.length; i += 4) if (data[i] > 220 && data[i + 1] < 120 && data[i + 2] < 140) return true; return false; }, clickAt), label + ': the drawn target cross aligns with the clicked pixel after zoom and DPR resize');
    await mutate((W, w, p) => { w.vehicleById(p.vehicle).stationaryT = W.ARTILLERY.stationarySeconds; });
    await b.waitFor('document.getElementById("artillery-fire").disabled===false');
    await b.shot(online ? 'online-targeting-map.png' : 'practice-targeting-map.png');
    await press('Enter'); await b.waitFor('Warz.debug.match().world.artilleryShells.length>0');
    const shell = live ? live.world.artilleryShells[0] : await evaluate(() => Warz.debug.match().world.artilleryShells[0]);
    const normalFlight = await evaluate(shell => Math.min(4, 2 + Math.hypot(shell.targetX - shell.startX, shell.targetY - shell.startY) / Warz.CONFIG.worldSize * 2), shell);
    check(Math.abs(shell.flightTime - normalFlight / 1.25) < .001, label + ': Armor Crew shell travel is 25% faster');
    check(await evaluate(() => { const v = Warz.debug.match().world.vehicleById(Warz.debug.player().vehicle); return v.artilleryCooldown > 6.8 && v.artilleryCooldown <= 7.5 && document.getElementById('artillery-status').textContent.includes('Reloading'); }), label + ': Armor Crew reload countdown starts at 7.5 seconds');
    check(shell && Math.hypot(shell.targetX - shell.startX, shell.targetY - shell.startY) > 3000, label + ': Enter fires at the selected map position beyond normal aim range');
    check(shell && Math.hypot(shell.targetX - clickAt.expectedX, shell.targetY - clickAt.expectedY) < .2, label + ': launched shell keeps the selected coordinates through the network input');
    if (online) {
      await b.cmd('Page.reload', {});
      await b.waitFor('window.Warz?.App?.ready && Warz.debug.match()?.online && Warz.debug.online()?.info.rejoin && Warz.ArtilleryUI.isOpen()', 15000);
      check(true, 'Online: reconnecting in fire-control mode restores the targeting menu');
    }
    await press('Escape'); await b.waitFor('!Warz.ArtilleryUI.isOpen()');
    check(await evaluate(() => document.getElementById('pause-menu').hidden && !Warz.MapScreen.isOpen()), label + ': Escape returns to driving without opening the pause menu');
    await b.waitFor('Warz.debug.player().vehicleWeapon===0');
    await press('Digit2'); await b.waitFor('Warz.ArtilleryUI.isOpen()');
    await press('KeyE'); await b.waitFor('!Warz.debug.player().vehicle && !Warz.ArtilleryUI.isOpen()');
    check(true, label + ': interact exits the vehicle and closes its targeting menu');
    await mutate((W, w, p) => { const v = w.qaArtillery; v.hp = 1000; v.vx = v.vy = 0; p.x = p.px = v.x - v.r - 60; p.y = p.py = v.y; });
    await b.waitFor('document.getElementById("hud-prompt").textContent.includes("Repair SP Artillery")');
    check(await evaluate(() => document.getElementById('hud-prompt').textContent.includes('100 HP / 2s')), label + ': SP artillery repair prompt explains the two-second rate');
    await press('KeyF');
    await b.waitFor('Warz.debug.player().repairVehicle>0');
    check(await evaluate(() => document.getElementById('hud-repair').textContent.includes('SP Artillery') && document.getElementById('hud-repair').textContent.includes('100 HP / 2s')), label + ': F starts SP artillery repair with its own HUD');
    await b.waitFor('Warz.debug.match().world.qaArtillery?.hp>=1050 || Warz.debug.match().world.vehicleById(Warz.debug.player().repairVehicle)?.hp>=1050');
    await press('KeyG'); await b.waitFor('!Warz.debug.player().repairVehicle');
    await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(80);
    await mutate((W, w, p) => w.setClass(p, 'rocketeer', true));
    await b.waitFor('Warz.debug.player().classId==="rocketeer"');
    await mouse(true, true); await b.waitFor('Warz.debug.player().scoping && Warz.debug.match().cam.zoom < .8'); await sleep(300);
    const rpgZoom = await evaluate(() => Warz.debug.match().cam.zoom); await mouse(false, true);
    check(rpgZoom < .8, label + ': Rocketeer can scope out while holding the RPG');
    await mutate((W, w, p) => w.setClass(p, 'sniper2', true)); await b.waitFor('Warz.debug.player().classId==="sniper2"');
    await mouse(true, true); await b.waitFor('Warz.debug.player().scoping && Warz.debug.match().cam.zoom < .52'); await mouse(false, true);
    check(await evaluate(rpg => Warz.debug.match().cam.zoom < rpg && Warz.WEAPONS.sniper2.zoom > 1.65, rpgZoom), label + ': Sniper II still scopes farther than Rocketeer');
    await mutate((W, world, p) => {
      const v = world.qaArtillery; v.hp = v.maxHp; v.wreck = false; v.vx = v.vy = 0;
      const at = world.vehicleSeatPoint(v, 'driver', true); p.x = p.px = at.x; p.y = p.py = at.y;
      world.enterVehicle(p, v, 'driver');
    });
    await b.waitFor('Warz.debug.player().vehicle>0'); await press('Digit2'); await b.waitFor('Warz.ArtilleryUI.isOpen()');
    await mutate((W, world, p) => { const v = world.vehicleById(p.vehicle); world.damageVehicle(v, v.hp + 1, p.id, 'test'); });
    await b.waitFor('!Warz.ArtilleryUI.isOpen() && !Warz.debug.player().vehicle');
    check(true, label + ': a wreck closes fire control and releases its driver');
    await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  await evaluate(() => {
    Warz.App.leaveMatch(); Warz.App.startPractice();
    const w = Warz.debug.match().world, p = Warz.debug.player(), v = w.vehicles.find(v => v.type === 'artillery');
    const clearNear = entity => Math.hypot(entity.x - v.x, entity.y - v.y) > 350;
    for (const key of ['rocks', 'trees', 'buildings', 'crates']) w.map[key] = w.map[key].filter(clearNear);
    w.solids = new Warz.U.SpatialHash(256); w.buildSolids(); w.storm = null;
    p.dropT = 0; const at = w.vehicleSeatPoint(v, 'driver', true); p.x = p.px = at.x; p.y = p.py = at.y;
    w.enterVehicle(p, v, 'driver');
    const humvee = w.vehicles.find(v => v.type === 'humvee'), tank = w.vehicles.find(v => v.type === 'tank');
    humvee.x = v.x + 650; humvee.y = v.y + 300; tank.x = v.x - 700; tank.y = v.y + 450;
    w.addPlayer({ x: v.x + 400, y: v.y - 300, team: 99, name: 'Map-size reference' });
  });
  await b.waitFor('Warz.debug.player().vehicle>0'); await sleep(800); await b.shot('generated-island-artillery-driving.png');
  await press('Digit2'); await b.waitFor('Warz.ArtilleryUI.isOpen()'); await sleep(150); await b.shot('generated-island-targeting.png');
  check(await evaluate(() => Warz.ArtilleryUI.view().zoom === 3), 'generated targeting map fills the screen with familiar island terrain and miniature details');
  const driverAt = await evaluate(() => { const p = Warz.debug.player(); return Warz.ArtilleryUI.worldToScreen(p.x, p.y); });
  await wheel(-700, driverAt.x, driverAt.y); await sleep(150); await b.shot('generated-island-targeting-zoomed.png');
  check(await evaluate(() => Warz.ArtilleryUI.view().zoom > 2), 'generated island supports a detailed zoomed targeting view');
  await press('Escape'); await press('Digit2');
  await b.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false }); await sleep(150);
  check(await evaluate(() => { const r = document.getElementById('artillery-map').getBoundingClientRect(), fire = document.getElementById('artillery-fire').getBoundingClientRect(); return Warz.ArtilleryUI.view().zoom === 3 && r.left === 0 && r.right === innerWidth && r.top === 0 && r.bottom === innerHeight && fire.left >= 0 && fire.right <= innerWidth; }), 'fullscreen map and fire control fit a narrow viewport');
  await b.shot('generated-island-targeting-narrow.png');
  await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await press('Escape'); await press('KeyM'); await b.waitFor('Warz.MapScreen.isOpen()');
  await b.shot('generated-island-normal-map-details.png');
  await evaluate(() => {
    const c = document.createElement('canvas'); c.id = 'map-detail-contact-sheet'; c.width = 720; c.height = 340;
    c.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1000;border:2px solid #15243a;border-radius:12px';
    document.body.appendChild(c); const g = c.getContext('2d');
    g.fillStyle = '#e6ecd9'; g.fillRect(0,0,720,340); g.fillStyle='#20382b'; g.font='bold 19px sans-serif'; g.fillText('Map miniatures — actual size and enlarged detail',20,30);
    const world=Warz.debug.match().world;
    ['humvee','tank','artillery'].forEach((type,i)=>{
      const v=Object.assign({},world.vehicles.find(v=>v.type===type),{angle:0,cannonAngle:-.25,gunAngle:0,armed:true,flash:0,cannonFlash:0});
      const x=120+i*240; g.fillStyle='#20382b';g.font='bold 15px sans-serif';g.textAlign='center';g.fillText(type==='artillery'?'SP Artillery':type==='humvee'?'Humvee':'Tank',x,64);
      g.fillStyle='#76b75a';g.fillRect(x-95,80,190,62);
      Warz.MapArt.vehicleGlyph(g,v,x-38,110,type==='humvee'?6:7.5,false); Warz.MapArt.vehicleGlyph(g,v,x+40,110,type==='humvee'?2.5:3.5,false);
      g.fillStyle='#20382b';g.font='11px sans-serif';g.fillText('Island map / Minimap',x,160);
      g.fillStyle='#76b75a';g.fillRect(x-95,177,190,135);g.save();g.translate(x,240);g.scale(6,6);Warz.MapArt.vehicleGlyph(g,v,0,0,type==='humvee'?6:7.5,false);g.restore();
      g.fillStyle='#20382b';g.fillText('6× detail inspection',x,330);
    });
  });
  await b.shot('map-vehicle-miniatures.png');
  await evaluate(() => document.getElementById('map-detail-contact-sheet').remove());
  check(true, 'normal island map and all three miniature vehicle designs captured at map and minimap sizes');
  check(await evaluate(() => !document.getElementById('hud-keys') && !!document.getElementById('sound-cues')), 'the bottom-right keybind guide is replaced by sound cues');
  check(b.errors.length === 0, 'artillery controls complete without browser exceptions');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ checks, errors: b.errors }, null, 2));
  console.log('Artillery browser QA: all ' + checks.length + ' checks passed');
} finally { if (b) await b.close(); await app.close(); }
