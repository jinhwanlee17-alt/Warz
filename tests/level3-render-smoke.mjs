// New tool/shield equipment stays readable, restores canvas state and never reveals hidden builders.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'icons', 'render']);
const t = suite('Level three visuals');
const renderer = Object.create(W.Renderer.prototype);
function drawing() {
  const calls = [], stack = [];
  const ctx = new Proxy({
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    save() { stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, stack.pop()); },
    measureText(value) { return { width: String(value).length * 8 }; }
  }, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      for (const n of args) if (typeof n === 'number' && !Number.isFinite(n)) throw Error(key + ': nonfinite coordinate');
      calls.push({ op: key, args, fill: target.fillStyle, stroke: target.strokeStyle });
    };
  } });
  return { ctx, calls, stack };
}
for (const id of ['wrench', 'engineerhammer', 'shieldpistol', 'explosiveshield', 'rpg', 'shotgun3', 'dualrevolver', 'medicstaff', 'magicmedkit', 'pyroflamethrower', 'pyrodualrevolver', 'firegun']) {
  for (const active of [0, 1]) {
    const d = drawing(); renderer.drawWeapon(d.ctx, id, 24, .25, active, 1);
    t.equal(d.stack.length, 0, id + ' restores all canvas state, active=' + active);
    t.check(d.calls.some(c => c.op === 'stroke') && d.calls.some(c => c.op === 'fill'), id + ' renders solid tool/weapon geometry');
    if (id === 'shieldpistol') {
      t.check(d.calls.some(c => c.op === 'stroke' && c.stroke === '#9fd4ff'), 'pistol has a raised riot shield');
      t.check(d.calls.some(c => c.op === 'rect'), 'pistol remains visible with the shield');
    }
    if (id === 'explosiveshield') t.check(d.calls.some(c => c.op === 'stroke' && c.stroke === '#f15c5b'), 'explosive shield is visibly red');
  }
  const svg = W.Icons.weaponIcon(id);
  t.check(svg.includes('<svg') && !/undefined|NaN|Infinity/.test(svg), id + ' has a complete finite hotbar icon');
}
{
  const d = drawing(), oldShield = renderer.drawShield, shields = [];
  renderer.drawShield = function (ctx, r, red, active) { shields.push(active); return oldShield.apply(this, arguments); };
  renderer.drawWeapon(d.ctx, 'shieldpistol', 24, 0, 0, 1, true);
  renderer.drawShield = oldShield;
  t.check(shields.length === 1 && shields[0] === false, 'reloading pistol draws an inactive lowered shield');
  t.check(d.calls.some(c => c.op === 'rotate' && c.args[0] === Math.PI / 2), 'reloading shield visibly rotates down beside the player');
  t.equal(d.stack.length, 0, 'lowered shield restores canvas state');
}
for (const id of ['engineer', 'shieldoperator', 'rocketeer', 'shotgunner3', 'magicmedic', 'pyromaniac']) {
  const svg = W.Icons.classIcon(id);
  t.check(svg.includes('<svg') && !/undefined|NaN|Infinity/.test(svg), id + ' has a complete finite class portrait');
}
const player = { id: 1, alive: true, classId: 'engineer', x: 100, y: 120, ox: 3, oy: -4, r: 24,
  angle: .8, held: -1, dropT: 0, recoil: 0, color: '#c5c98a', outline: '#515538',
  weapons: [{ id: 'wrench' }, { id: 'pistol' }], slot: 0, hp: 100, maxHp: 100, fx: {},
  healFlash: 0, hitFlash: 0, isLocal: true, sentryBuild: { elapsed: 5, x: 200, y: 150 } };
for (const preview of [false, true]) {
  const d = drawing(), before = JSON.stringify(player);
  renderer.drawSentryBuild(d.ctx, player, 1, preview);
  t.check(d.calls.length > 0, preview ? 'anchored construction spot displays a ghost sentry' : 'active builder displays progress');
  t.equal(d.stack.length, 0, 'construction drawing restores canvas state');
  t.equal(JSON.stringify(player), before, 'construction drawing cannot advance the server build timer');
  for (const state of [{ hidden: true }, { alive: false }, { downed: true }, { vehicle: 9 }, { mount: 4 }, { dropT: 1 }, { sentryBuild: null }]) {
    const blocked = drawing(); renderer.drawSentryBuild(blocked.ctx, { ...player, ...state }, 1, preview);
    t.equal(blocked.calls.length, 0, 'inactive construction has no ' + (preview ? 'ghost: ' : 'progress: ') + Object.keys(state)[0]);
  }
}
{
  const d = drawing(); renderer.drawPlayer(d.ctx, { ...player, face: 'smile' }, 1, { viewer: player });
  t.equal(d.stack.length, 0, 'engineer with face and progress restores canvas state');
  const hidden = drawing(); renderer.drawPlayer(hidden.ctx, { ...player, fx: { invisible: 10 }, team: 2 }, 1, { viewer: { team: 1 } });
  t.equal(hidden.calls.length, 0, 'enemy invisibility hides construction visuals too');
}
{
  const oldWeapon = renderer.drawWeapon, oldHeld = renderer.drawHeld, draws = [];
  renderer.drawWeapon = () => draws.push('weapon'); renderer.drawHeld = () => draws.push('held');
  const d = drawing(); renderer.drawPlayer(d.ctx, { ...player, held: 1, items: [null, null, null] }, 1, { viewer: player });
  renderer.drawWeapon = oldWeapon; renderer.drawHeld = oldHeld;
  t.equal(draws.length, 0, 'selected empty slot visibly holds neither a class weapon nor a phantom item');
  t.equal(d.stack.length, 0, 'empty hands preserve canvas state');
}
{
  const rocket = { id: 1, x: 100, y: 120, dx: .6, dy: .8, r: W.WEAPONS.rpg.projectileRadius, traveled: 80 };
  const d = drawing(), before = JSON.stringify(rocket);
  renderer.drawRpgRockets(d.ctx, { rpgRockets: [rocket] }, { x0: 0, y0: 0, x1: 300, y1: 300 });
  t.check(d.calls.some(c => c.op === 'fill') && d.calls.some(c => c.op === 'stroke'), 'RPG rocket draws a solid body, outline and exhaust');
  t.equal(d.stack.length, 0, 'RPG rocket restores canvas state');
  t.equal(JSON.stringify(rocket), before, 'RPG drawing never changes physical projectile state');
  const offscreen = drawing(); renderer.drawRpgRockets(offscreen.ctx, { rpgRockets: [{ ...rocket, x: 10000 }] }, { x0: 0, y0: 0, x1: 300, y1: 300 });
  t.equal(offscreen.calls.length, 0, 'offscreen RPG rockets are culled');
}
{
  const staff = { owner: 8, x: 120, y: 130, recharge: 0, rate: 25, active: true };
  const world = { placedMedicStaffs: () => [staff], players: [] }, view = { x0: 0, y0: 0, x1: 400, y1: 400 };
  const before = JSON.stringify(staff), d = drawing();
  renderer.drawMedicStaffs(d.ctx, world, view, 1, { team: 1 });
  t.check(d.calls.some(c => c.op === 'fillText' && c.args[0] === 'Medic Staff'), 'placed staff visibly identifies its public waypoint even without the owner in view');
  t.check(d.calls.some(c => c.op === 'arc' && c.args[2] === 300), 'placed healing area shows the full fire-grenade radius');
  t.equal(d.stack.length, 0, 'staff world drawing restores canvas state');
  t.equal(JSON.stringify(staff), before, 'staff drawing never changes healing progress');
  const hidden = drawing();
  renderer.drawMedicStaffs(hidden.ctx, { ...world, placedMedicStaffs: () => [{ ...staff, x: 10000 }] }, view, 1, null);
  t.equal(hidden.calls.length, 0, 'distant placed staff world art is culled while the map waypoint remains available');
}
{
  const bullet = { weapon: 'firegun', x: 120, y: 140, dx: .6, dy: .8, r: 9, traveled: 90, speed: 1400 };
  const d = drawing(), before = JSON.stringify(bullet), view = { x0: 0, y0: 0, x1: 400, y1: 400 };
  renderer.drawBullets(d.ctx, { bullets: [bullet] }, view);
  t.check(d.calls.some(c => c.op === 'quadraticCurveTo') && d.calls.some(c => c.op === 'fill' && c.fill === '#fff0b6'), 'Firegun rounds visibly render as fireballs with bright cores');
  t.equal(d.stack.length, 0, 'fireball bullet restores canvas state');
  t.equal(JSON.stringify(bullet), before, 'fireball rendering never changes projectile physics');
  const offscreen = drawing(); renderer.drawBullets(offscreen.ctx, { bullets: [{ ...bullet, x: 10000 }] }, view);
  t.equal(offscreen.calls.length, 0, 'offscreen fireballs are culled');
  const flameTarget = { ...player, pyroBurning: 3, team: 1 }, world = { time: 1 };
  const burning = drawing(); renderer.drawSentryStatus(burning.ctx, world, flameTarget, flameTarget);
  t.check(burning.calls.some(c => c.op === 'stroke' && c.stroke === '#ff964c'), 'replicated Pyromaniac burn draws a visible flame ring');
  t.equal(burning.stack.length, 0, 'burn ring restores canvas state');
  const quenched = drawing(); renderer.drawSentryStatus(quenched.ctx, world, { ...flameTarget, pyroBurning: 0 }, flameTarget);
  t.equal(quenched.calls.length, 0, 'extinguished burn no longer draws its status ring');
  const hidden = drawing(); renderer.drawSentryStatus(hidden.ctx, world, { ...flameTarget, team: 2, fx: { invisible: 1 } }, flameTarget);
  t.equal(hidden.calls.length, 0, 'burn status cannot reveal an invisible enemy');
  const oldVehicle = renderer.drawVehicle; renderer.drawVehicle = function () {};
  for (const type of ['humvee', 'tank']) {
    const car = { type, id: 1, x: 120, y: 140, angle: 0, pyroBurning: 4 }, vehicleDraw = drawing();
    renderer.drawVehicles(vehicleDraw.ctx, { vehicles: [car] }, view, 1, null);
    t.equal(vehicleDraw.calls.some(c => c.op === 'stroke' && c.stroke === '#ff964c'), type === 'humvee', type + ' reflects its burn eligibility in vehicle art');
    t.equal(vehicleDraw.stack.length, 0, type + ' burn art restores canvas state');
  }
  renderer.drawVehicle = oldVehicle;
}
t.done();
