// Hammer/repair cosmetics follow authoritative state without changing combat.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'icons', 'render']);
const t = suite('Armor Crew rendering');
const renderer = Object.create(W.Renderer.prototype);
function drawing() {
  const calls = [], stack = [];
  const ctx = new Proxy({
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    save() { stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, stack.pop()); }
  }, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      for (const n of args) if (typeof n === 'number' && !Number.isFinite(n)) throw Error(key + ': nonfinite coordinate');
      calls.push({ op: key, args, fill: target.fillStyle, stroke: target.strokeStyle });
    };
  } });
  return { ctx, calls, stack };
}
for (const swing of [0, .25, .5, 1]) {
  const d = drawing(); renderer.drawWeapon(d.ctx, 'hammer', 24, swing, 0, 0);
  t.equal(d.stack.length, 0, 'hammer restores transforms at swing ' + swing);
  t.check(d.calls.some(c => c.op === 'fill' && c.fill === '#56636b'), 'hammer steel head renders at swing ' + swing);
  t.check(d.calls.some(c => c.op === 'fill' && c.fill === '#b9874c'), 'hammer wooden handle renders at swing ' + swing);
  t.equal(d.calls.some(c => c.op === 'arc'), swing > .15, 'only an active swing has a sweep trail');
}
const p = { id: 1, alive: true, classId: 'armorcrew', x: 100, y: 120, ox: 3, oy: -4, r: 24,
  angle: .8, meleeAngle: -.5, meleeSwing: .12, repairVehicle: 0, held: -1, dropT: 0, recoil: 0,
  color: '#c5c98a', outline: '#515538', weapons: [{ id: 'hammer' }, { id: 'pistol' }], slot: 0,
  hp: 150, maxHp: 150, fx: {}, healFlash: 0, hitFlash: 0, isLocal: true };
{
  const d = drawing(), before = JSON.stringify(p), drawHammer = renderer.drawHammer, swings = [];
  renderer.drawHammer = function (ctx, r, swing) { swings.push(swing); return drawHammer.call(this, ctx, r, swing); };
  renderer.drawPlayer(d.ctx, p, 1, {});
  t.equal(swings[0], .5, 'swing phase follows the replicated .24-second timer rather than gun recoil');
  t.check(d.calls.some(c => c.op === 'rotate' && c.args[0] === -.5), 'active hammer swing uses captured attack heading');
  t.equal(JSON.stringify(p), before, 'swing does not change damage, timers or player state');
  t.equal(d.stack.length, 0, 'hammer player drawing restores canvas state');
  renderer.drawHammer = drawHammer;
}
{
  const d = drawing(), repairing = { ...p, meleeSwing: 0, repairVehicle: 9 }, before = JSON.stringify(repairing);
  renderer.drawPlayer(d.ctx, repairing, 1, {});
  t.check(d.calls.some(c => c.op === 'stroke' && c.stroke === '#ffe893'), 'active repair emits welding sparks');
  t.check(d.calls.some(c => c.op === 'rotate' && c.args[0] === repairing.angle), 'repair tool follows authoritative hull-facing heading');
  t.equal(JSON.stringify(repairing), before, 'repair drawing never heals hull or changes simulation');
  t.equal(d.stack.length, 0, 'repair drawing restores transforms');
  const idle = drawing(); renderer.drawPlayer(idle.ctx, { ...p, meleeSwing: 0 }, 1, {});
  t.check(!idle.calls.some(c => c.stroke === '#ffe893'), 'repair spark disappears when authoritative repair stops');
  for (const state of [{ hidden: true }, { vehicle: 9 }, { downed: true, downT: 30 }]) {
    const blocked = drawing(); renderer.drawPlayer(blocked.ctx, { ...repairing, ...state }, 1, {});
    t.check(!blocked.calls.some(c => c.stroke === '#ffe893'), 'inactive/hidden/seated bodies cannot leak repair effects: ' + Object.keys(state)[0]);
  }
}
for (const [label, svg] of [['portrait', W.Icons.classIcon('armorcrew')], ['weapon', W.Icons.weaponIcon('hammer')]]) {
  t.check(svg.includes('<svg') && svg.includes('<rect'), label + ' supplies real hammer artwork');
  t.check(!/NaN|undefined|Infinity/.test(svg), label + ' has finite SVG geometry');
}
t.done();
