// Faces and emote bubbles are presentation only: no mutation, hidden-body leaks or arbitrary chat text.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'cosmetics', 'util', 'map', 'world', 'items', 'cosmetic-art', 'render']);
const t = suite('Cosmetic rendering'), renderer = Object.create(W.Renderer.prototype);

function drawing() {
  const calls = [], stack = [];
  const ctx = new Proxy({
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    save() { stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, stack.pop()); },
    measureText(text) { return { width: String(text).length * 11 }; }
  }, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      for (const n of args) if (typeof n === 'number' && !Number.isFinite(n)) throw Error(key + ': nonfinite coordinate');
      calls.push({ op: key, args, fill: target.fillStyle, stroke: target.strokeStyle, alpha: target.globalAlpha });
    };
  } });
  return { ctx, calls, stack };
}
const faceIds = W.Cosmetics.FACES.filter(f => f.id !== 'none').map(f => f.id);
for (const color of ['#000000', '#ffffff', '#2f9bff']) {
  const signatures = new Set();
  for (const id of faceIds) {
    const d = drawing();
    t.check(W.CosmeticArt.face(d.ctx, id, 24, color), color + ': ' + id + ' draws recognized face art');
    t.equal(d.stack.length, 0, id + ' restores canvas state');
    signatures.add(JSON.stringify(d.calls));
  }
  t.equal(signatures.size, 6, color + ': all six faces have different visible geometry');
}
t.check(W.CosmeticArt.ink('#000000') !== W.CosmeticArt.ink('#ffffff'), 'face ink switches contrast for dark and light custom colours');
for (const id of ['none', 'unknown', '<script>', undefined]) {
  const d = drawing();
  t.check(!W.CosmeticArt.face(d.ctx, id, 24, '#2f9bff') && !d.calls.length, 'no-face/invalid selection does not invent artwork: ' + id);
}

const player = { id: 1, team: 1, name: 'Player', alive: true, classId: 'medic', x: 100, y: 120, ox: 3, oy: -4,
  r: 24, angle: 0.4, face: 'smile', emote: { id: 'gg', until: 13 }, held: -1, dropT: 0, recoil: 0,
  color: '#2f9bff', outline: '#1c5d99', weapons: [{ id: 'pistol' }], slot: 0, hp: 100, maxHp: 100,
  fx: {}, healFlash: 0, hitFlash: 0, isLocal: true };
{
  const d = drawing(), before = JSON.stringify(player);
  renderer.drawPlayer(d.ctx, player, 10.5, { viewer: player });
  t.check(d.calls.some(c => c.op === 'fillText' && c.args[0] === 'GG'), 'visible player displays the equipped fixed emote');
  t.check(d.calls.some(c => c.op === 'translate' && c.args[0] === 103 && c.args[1] === 26), 'bubble follows authoritative position plus visual correction');
  t.check(d.calls.some(c => c.op === 'arc' && c.args[2] === 24 * .43 && c.fill === '#283748'), 'face-equipped upgraded player keeps a separate class badge');
  t.equal(JSON.stringify(player), before, 'rendering leaves health, cosmetics, position and emote expiry untouched');
  t.equal(d.stack.length, 0, 'body, badge and bubble restore canvas state');
}
for (const state of [{ hidden: true }, { vehicle: 9 }, { fx: { invisible: 1 } }]) {
  const d = drawing(); renderer.drawPlayer(d.ctx, { ...player, ...state }, 11, { viewer: { id: 2, team: 2 } });
  t.equal(d.calls.length, 0, 'off-body/hidden/invisible-to-enemy player cannot leak face or emote: ' + Object.keys(state)[0]);
}
for (const def of W.Cosmetics.EMOTES) {
  const p = { ...player, emote: { id: def.id, until: 13 } }, d = drawing(), before = JSON.stringify(p);
  t.check(renderer.drawEmote(d.ctx, p, 11, 100, 20, player), def.id + ' produces a visible fixed bubble');
  t.check(d.calls.some(c => c.op === 'fillText' && c.args[0] === def.glyph), def.id + ' displays its allowlisted emoji or phrase');
  t.equal(JSON.stringify(p), before, def.id + ' rendering never consumes/restarts the emote');
}
for (const change of [{ hidden: true }, { alive: false }, { downed: true }, { dropT: 1 }, { emote: { id: 'gg', until: 11 } }, { emote: { id: 'arbitrary chat', until: 13 } }, { emote: { id: 'gg', until: NaN } }]) {
  const d = drawing();
  t.check(!renderer.drawEmote(d.ctx, { ...player, ...change }, 11, 0, 0, player) && !d.calls.length,
    'hidden, inactive, expired or invalid emote does not draw: ' + JSON.stringify(change));
}
{
  const d = drawing(); renderer.drawEmote(d.ctx, player, 12.85, 0, 0, player);
  t.check(d.calls.some(c => c.op === 'fillText' && c.alpha > .49 && c.alpha < .51), 'bubble fades during its final300ms without changing expiry');
  renderer.reducedMotion = true;
  const quiet = drawing(); renderer.drawEmote(quiet.ctx, player, 10.1, 0, 0, player);
  t.check(quiet.calls.some(c => c.op === 'scale' && c.args[0] === 1 && c.args[1] === 1), 'reduced motion disables the emote pop animation');
  renderer.reducedMotion = false;
}
for (const type of ['humvee', 'tank']) {
  const crew = [player, { ...player, id: 2, isLocal: false, face: 'cry', emote: { id: 'hi', until: 13 } }];
  const world = { playerById(id) { return crew.find(p => p.id === id); } };
  const car = { id: 9, type, x: 500, y: 700, ox: 2, oy: -3, angle: .4, oa: .03, cannonAngle: .8, gunAngle: -.2,
    vx: 0, vy: 0, r: type === 'tank' ? 105 : 80, hp: 1000, maxHp: 1000, armed: true,
    seats: { driver: 1, gunner: 2 }, flash: 0 };
  const d = drawing(), face = W.CosmeticArt.face, seen = [];
  W.CosmeticArt.face = function (ctx, id, r, color) { seen.push(id); return face(ctx, id, r, color); };
  const before = JSON.stringify([car, crew]); renderer.drawVehicle(d.ctx, world, car, 11, player);
  W.CosmeticArt.face = face;
  t.equal(seen.join(','), 'smile,cry', type + ': occupants keep their chosen faces in their actual seats');
  t.equal(d.calls.filter(c => c.op === 'fillText' && ['GG', 'Hi'].includes(c.args[0])).length, 2, type + ': each active crew emote is shown once');
  t.equal(JSON.stringify([car, crew]), before, type + ': vehicle cosmetics never mutate crew or hull state');
  t.equal(d.stack.length, 0, type + ': heads and crew bubbles restore all transforms');
  const hidden = drawing(); renderer.drawVehicleEmotes(hidden.ctx, world, { ...car, hidden: true }, 11, player);
  t.equal(hidden.calls.length, 0, type + ': hidden vehicle cannot reveal its crew emotes');
  const wreck = drawing(); renderer.drawVehicleEmotes(wreck.ctx, world, { ...car, wreck: true }, 11, player);
  t.equal(wreck.calls.length, 0, type + ': wreck cannot retain crew emotes');
}
{
  const crew = [1, 2, 3, 4].map(id => ({ ...player, id, emote: { id: 'cooked', until: 13 } }));
  const world = { playerById(id) { return crew.find(p => p.id === id); } };
  const car = { id: 9, x: 0, y: 0, r: 105, seats: { driver: 1, rearLeft: 2, gunner: 3, rearRight: 4 } };
  const draw = renderer.drawEmote, positions = [];
  renderer.drawEmote = (ctx, p, time, x, y) => positions.push({ x, y });
  renderer.drawVehicleEmotes(drawing().ctx, world, car, 11, player);
  renderer.drawEmote = draw;
  t.equal(positions.length, 4, 'four riders can display emotes concurrently');
  t.check(positions[0].y === positions[1].y && positions[2].y === positions[3].y && positions[0].y - positions[2].y === 64,
    'four crew bubbles use two separated rows');
  t.check(positions[1].x - positions[0].x > 'Get Cooked!'.length * 11 + 28,
    'even the longest allowed phrases have a horizontal gap');
}
t.done();
