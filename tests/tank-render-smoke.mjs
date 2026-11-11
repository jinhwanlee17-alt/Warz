// Visual state follows authoritative vehicle/rock state without changing combat.
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'render']);
const t = suite('Tank and cover rendering');
const renderer = Object.create(W.Renderer.prototype);
function drawing() {
  const calls = [], stack = [];
  const ctx = new Proxy({
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    save() { stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }); },
    restore() { Object.assign(this, stack.pop()); },
    measureText(text) { return { width: String(text).length * 7 }; },
    createRadialGradient() { return { addColorStop() {} }; }
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        for (const value of args) if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(key + ': nonfinite coordinate');
        calls.push({ op: key, args, fill: target.fillStyle, stroke: target.strokeStyle, lineWidth: target.lineWidth });
      };
    }
  });
  return { ctx, calls, stack };
}

for (const hp of [undefined, 1000, 999, 600, 599, 300, 299, 1]) {
  // Even obsolete health fields must not reintroduce natural-rock damage graphics.
  const rock = { id: 1, x: 500, y: 500, r: 50, alive: true };
  if (hp !== undefined) { rock.hp = hp; rock.maxHp = 1000; }
  const draw = drawing(), before = JSON.stringify(rock);
  renderer.drawRock(draw.ctx, rock, {});
  t.equal(JSON.stringify(rock), before, hp + ' HP rock rendering leaves simulation untouched');
  t.equal(draw.stack.length, 0, hp + ' HP rock drawing restores transforms');
  t.check(!draw.calls.some(c => c.op === 'fillText'), 'natural rock has no health label, legacy HP=' + hp);
  const cracks = draw.calls.filter(c => c.op === 'stroke' && c.args.length === 0);
  t.equal(cracks.length, 0, 'natural rock never displays damage scratches, legacy HP=' + hp);
  t.check(!draw.calls.some(c => c.fill === '#a7c5d8' || c.fill === '#ffd23f'), 'natural rock never displays an HP bar, legacy HP=' + hp);
}
{
  const gone = drawing(); renderer.drawRock(gone.ctx, { x: 0, y: 0, r: 50, alive: false }, {});
  t.equal(gone.calls.length, 0, 'destroyed map rock has no remaining body, scratches or HP bar');
  for (const hp of [1000, 900, 600, 500, 299, 1, 0]) {
    const placed = drawing();
    renderer.drawStructures(placed.ctx, { structures: [{ id: 1, kind: 'rock', item: 'rock', x: 0, y: 0, r: 40, alive: hp > 0, team: 1, maxHp: 1000, hp }] },
      { x0: -100, y0: -100, x1: 100, y1: 100 }, 0, { team: 1 });
    t.equal(placed.calls.some(c => c.op === 'fillText' && c.args[0] === hp + ' / 1000'), hp > 0, 'portable rock HP bar remains until zero: ' + hp);
    t.equal(placed.calls.some(c => c.op === 'stroke' && c.stroke === '#505a63'), hp > 0 && hp < 600, 'portable rock shows heavy scratches while badly damaged: ' + hp);
  }
}

for (const wreck of [false, true]) {
  const crew = ['#ec5678', '#75a1ff', '#e4b950', '#65bc8c'].map((color, i) => ({ id: i + 1, color, outline: '#223344', isLocal: i === 0 }));
  const tank = { id: 9, type: 'tank', x: 500, y: 700, ox: 3, oy: -4, angle: 0.6, oa: 0.07, cannonAngle: 1.4, gunAngle: -0.5,
    vx: 120, vy: 0, r: 105, hp: wreck ? 0 : 5000, maxHp: 5000, wreck, flash: 0.4, cannonFlash: 0.7,
    seats: { driver: 1, gunner: 2, rearLeft: 3, rearRight: 4 } };
  const world = { playerById(id) { return crew.find(p => p.id === id); } }, draw = drawing(), before = JSON.stringify(tank);
  renderer.drawVehicle(draw.ctx, world, tank, 1.5, { id: 1, vehicle: 9, x: 500, y: 700 });
  t.equal(JSON.stringify(tank), before, (wreck ? 'wreck' : 'tank') + ' drawing preserves authoritative motion and weapon state');
  t.equal(draw.stack.length, 0, 'tank hull, weapons and crew restore canvas transforms');
  t.check(draw.calls.some(c => c.op === 'translate' && c.args[0] === 503 && c.args[1] === 696), 'tank body respects shared positional smoothing');
  t.check(draw.calls.some(c => c.op === 'rotate' && Math.abs(c.args[0] - 0.67) < 1e-8), 'tank hull respects angular smoothing');
  for (const p of crew) t.equal(draw.calls.filter(c => c.op === 'fill' && c.fill === p.color).length, wreck ? 0 : 1, 'each living crew member appears in one fixed seat');
  t.check(draw.calls.some(c => c.op === 'fillText' && c.args[0] === (wreck ? 'TANK WRECK' : 'Tank')), 'tank name and wreck status remain distinct from Humvee');
  if (!wreck) {
    t.check(draw.calls.some(c => c.op === 'rotate' && Math.abs(c.args[0] - (1.4 - 0.67)) < 1e-8), 'main cannon retains world aim during hull smoothing');
    t.check(draw.calls.some(c => c.op === 'rotate' && Math.abs(c.args[0] - (-0.5 - 0.67)) < 1e-8), 'machine gun retains its independent world aim');
  }
}
{
  const shells = [{ id: 1, x: 300, y: 400, dx: 0.6, dy: 0.8, traveled: 60 }, { id: 2, x: 5000, y: 5000, dx: 1, dy: 0, traveled: 50 }];
  const draw = drawing(), before = JSON.stringify(shells);
  renderer.drawTankShells(draw.ctx, { tankShells: shells }, { x0: 0, y0: 0, x1: 1000, y1: 1000 });
  t.equal(draw.calls.filter(c => c.op === 'ellipse').length, 1, 'tank shell painter culls offscreen projectiles');
  t.check(draw.calls.some(c => c.op === 'moveTo' && c.args[0] === 264 && c.args[1] === 352), 'shell streak follows actual heading and traveled distance');
  t.equal(JSON.stringify(shells), before, 'cosmetic shell rendering never moves projectiles or predicts damage');
  t.equal(draw.stack.length, 0, 'shell drawing restores transforms');
}
{
  const original = renderer.drawVehicle, ids = [];
  renderer.drawVehicle = (ctx, world, car) => ids.push(car.id);
  renderer.drawVehicles(drawing().ctx, { vehicles: [{ id: 9, x: 0, y: 0, r: 105, hidden: true }, { id: 10, x: 0, y: 0, r: 105 }] },
    { x0: -200, y0: -200, x1: 200, y1: 200 }, 0, null);
  t.equal(ids.join(','), '10', 'hidden seeded tank never renders before its authoritative snapshot');
  renderer.drawVehicle = original;
}

t.done();
