// Sentry IV simulation: rates, real projectiles/cover, status timers and the same vehicle damage path used online.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'render']), t = suite('Sentry IV');
const X = 5000, Y = 5000, DT = .05;
function arena(extra = {}, remote = false) {
  const map = Object.assign({ seed: 73, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
    pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], tanks: [], nextPickupId: 1 }, extra);
  const w = new W.World({ map, remote, storm: false });
  const owner = w.addPlayer({ x: X - 150, y: Y + 200, team: 1 });
  const target = w.addPlayer({ x: X + 350, y: Y, team: 2 });
  target.hp = target.maxHp = 10000;
  return { w, owner, target };
}
function sentry(a, kind) {
  const d = W.SENTRY_IV[kind];
  return a.w.addStruct({ kind: 'sentry', item: d.item, x: X, y: Y, r: W.STRUCT_RADIUS.sentry,
    hp: d.hp, maxHp: d.hp, owner: a.owner.id, team: a.owner.team, angle: 0 });
}
function flight(a, seconds = 1, dt = DT) {
  for (let i = 0; i < Math.round(seconds / dt); i++) { a.w.time += dt; a.w.updateSentryProjectiles(dt); }
}
function shot(a, kind) {
  const s = sentry(a, kind); a.w.updateSentry(s, 0); a.w.updateSentryProjectiles(0); return s;
}
function impact(a, kind, target = a.target) {
  const isVehicle = target.type === 'tank' || target.type === 'humvee';
  const g = { id: 123, kind, x: X, y: Y, dx: 1, dy: 0, owner: a.owner.id, team: a.owner.team };
  a.w.sentryProjectileImpact(g, isVehicle ? { solid: { vehicle: target } } : { player: target }, target.x - target.r, target.y);
}

const hp = { bullets: 250, grenades: 310, rockets: 150, snowballs: 100, fireballs: 300, cannons: 760 };
for (const [kind, health] of Object.entries(hp)) {
  const d = W.SENTRY_IV[kind];
  t.equal(W.ITEMS[d.item].hp, health, kind + ': upgrade has requested health');
  t.check(!W.ITEM_ORDER.includes(d.item), kind + ': upgrade-only weapon cannot change ordinary crate loot');
  const a = arena(), ownerHp = a.owner.hp; shot(a, kind); flight(a);
  t.equal(10000 - a.target.hp, d.damage, kind + ': actual projectile deals its exact direct impact damage');
  t.equal(a.w.sentryProjectiles.length, 0, kind + ': direct hit consumes the projectile');
  t.equal(a.w.events.filter(e => e.type === 'sentry-impact').length, 1, kind + ': emits one authoritative impact');
  t.check(a.w.events.find(e => e.type === 'sentry-projectiles').projectiles.length === 1, kind + ': shot uses a batch event');
  t.equal(a.owner.hp, ownerHp, kind + ': sentry never hits its owner');
  for (const dt of [.05, 1 / 60]) {
    const b = arena(), s = sentry(b, kind);
    for (let i = 0; i < Math.round(1 / dt); i++) b.w.updateSentry(s, dt);
    const count = b.w.events.filter(e => e.type === 'sentry-projectiles').reduce((sum, e) => sum + e.projectiles.length, 0);
    t.equal(count, Math.floor((1 + 1e-8) / d.fireInterval) + 1, kind + ': requested rate survives ' + Math.round(1 / dt) + ' Hz simulation');
    t.check(b.w.events.filter(e => e.type === 'sentry-projectiles').length <= Math.round(1 / dt), kind + ': batches at most one fire event per simulation tick');
  }
}
t.near(W.SENTRY_IV.bullets.fireInterval, W.ITEMS.sentry3.fireInterval / 1.25, 1e-12, 'Bullet IV increases rate, rather than reducing the interval by the wrong25%');
{
  const a = arena(), s = sentry(a, 'snowballs'); a.w.updateSentry(s, DT); a.w.updateSentryProjectiles(DT);
  t.equal(a.w.sentryProjectiles.length, 3, '50Hz snow fires three physical shots in first20Hz server tick');
  const positions = a.w.sentryProjectiles.map(g => g.x);
  t.near(positions[0] - positions[1], W.SENTRY_IV.snowballs.speed * .02, 1e-8, 'batched shots retain their physical20ms spacing');
  t.near(positions[1] - positions[2], W.SENTRY_IV.snowballs.speed * .02, 1e-8, 'last shot does not advance a full tick too early');
}
for (const kind of ['bullets', 'rockets', 'snowballs', 'fireballs']) {
  const a = arena({ rocks: [{ id: 1, x: X + 175, y: Y, r: 40, alive: true }] });
  const s = sentry(a, kind); a.w.updateSentry(s, DT);
  t.equal(a.w.sentryProjectiles?.length || 0, 0, kind + ': target hidden by solid rock is not fired upon');
  // A new obstruction in an already-fired projectile path still physically stops it.
  a.w.map.rocks[0].alive = false; a.w.buildSolids(); a.w.updateSentry(s, DT); a.w.updateSentryProjectiles(0);
  a.w.map.rocks[0].alive = true; a.w.buildSolids(); flight(a);
  t.equal(a.target.hp, 10000, kind + ': shot cannot tunnel through cover added after firing');
  t.check(a.w.map.rocks[0].alive, kind + ': ordinary projectile cannot break natural rock');
}
{
  const a = arena({ rocks: [{ id: 1, x: X + 175, y: Y, r: 40, alive: true }] });
  shot(a, 'grenades'); flight(a);
  t.equal(a.target.hp, 9900, 'grenade arcs above intervening rock and explodes immediately on landing/contact');
  t.check(a.w.map.rocks[0].alive && a.w.grenades.length === 0, 'arcing sentry grenade neither changes rock rules nor enters delayed-fuse grenade storage');
}
for (const portable of [false, true]) {
  const a = arena(portable ? {} : { rocks: [{ id: 1, x: X + 175, y: Y, r: 40, alive: true }] });
  const rock = portable ? a.w.addStruct({ kind: 'rock', item: 'rock', x: X + 175, y: Y, r: 40, hp: 1000, maxHp: 1000, team: 2 }) : a.w.map.rocks[0];
  shot(a, 'cannons'); flight(a);
  t.check(!rock.alive, 'cannon one-shots ' + (portable ? 'player rock with1000HP' : 'binary natural rock'));
  t.equal(a.target.hp, 10000, 'cannon disappears at ' + (portable ? 'player' : 'natural') + ' rock without hitting the player behind it');
}
{
  const a = arena(); a.target.x = X + 6000; shot(a, 'rockets'); flight(a, 6);
  t.equal(a.target.hp, 9975, 'rocket acquires and physically reaches an enemy thousands of units beyond ordinary sentry range');
  t.equal(W.SENTRY_IV.rockets.blastRadius, W.WEAPONS.grenade.explosion.radius / 2, 'rocket splash radius is half a grenade');
}
for (const distance of [0, 37.5, 74, 75, 100]) {
  const a = arena(); a.target.x = X; a.target.y = Y + a.target.r + distance;
  a.w.sentryProjectileImpact({ id: 4, kind: 'rockets', owner: a.owner.id, team: 1, dx: 1, dy: 0 }, null, X, Y);
  const expected = distance < 75 ? Math.round(25 * (1 - distance / 75) * 10) / 10 : 0;
  t.near(10000 - a.target.hp, expected, 1e-8, 'rocket infantry radial damage at edge distance' + distance + ' follows0–25 falloff');
}
for (const type of ['humvee', 'tank']) for (const distance of [0, 37.5, 74.9, 75, 100]) {
  const a = arena({ vehicles: [{ id: 1, type, x: X, y: Y + 500, angle: 0 }] }), v = a.w.vehicles[0];
  v.y = Y + v.r + distance;
  const before = v.hp, originalDamage = a.w.damageVehicle, rawDamage = [];
  a.w.damageVehicle = function (vehicle, amount, owner, cause) { rawDamage.push({ vehicle, amount, cause }); return originalDamage.apply(this, arguments); };
  a.w.sentryProjectileImpact({ id: 5, kind: 'rockets', owner: a.owner.id, team: 1, dx: 1, dy: 0 }, null, X, Y);
  const max = type === 'tank' ? 100 : 80, raw = distance < 75 ? 10 + (max - 10) * (1 - distance / 75) : 0;
  t.near(rawDamage[0]?.amount || 0, raw, 1e-8, type + ': rocket hull falloff measures surface distance' + distance);
  const hullDamage = Math.round(raw * 100) / 100;
  t.near(before - v.hp, hullDamage, 1e-8, type + ': rocket hull damage at surface distance' + distance + ' bypasses sentry resistance');
  if (distance < 75) t.equal(rawDamage[0].cause, 'sentry-rockets', type + ': rocket keeps its dedicated armor-bypass cause');
}
for (const distance of [0, 37.4, 75, 149, 150]) {
  const a = arena(); a.target.x = X; a.target.y = Y + a.target.r + distance;
  a.w.sentryProjectileImpact({ id: 4, kind: 'grenades', owner: a.owner.id, team: 1, dx: 1, dy: 0 }, null, X, Y);
  t.equal(10000 - a.target.hp, W.Rules.explosionDamage(100, 150, distance), 'grenade IV splash uses identical ordinary grenade falloff and rounding at' + distance);
}
for (const kind of Object.keys(hp)) {
  const a = arena(); a.target.team = 1; const s = sentry(a, kind); a.w.updateSentry(s, DT);
  t.equal(a.w.sentryProjectiles?.length || 0, 0, kind + ': allied players are never targeted');
  a.target.team = 2; a.target.fx.invisible = 2; a.w.updateSentry(s, DT);
  t.equal(a.w.sentryProjectiles?.length || 0, 0, kind + ': invisible players are never targeted');
}
for (const kind of Object.keys(hp)) for (const slot of [0, 1]) {
  const a = arena(); a.w.setClass(a.target, 'shieldoperator', true); a.target.hp = a.target.maxHp = 10000;
  a.target.angle = Math.PI; a.w.switchSlot(a.target, slot); impact(a, kind);
  const blocked = ['bullets', 'snowballs'].includes(kind) || (slot === 1 && ['grenades', 'rockets'].includes(kind));
  t.equal(10000 - a.target.hp, blocked ? 0 : W.SENTRY_IV[kind].damage, kind + ': real impact respects shield slot' + slot + ' exceptions');
  if (kind === 'snowballs') t.equal(a.w.activeSentrySnow(a.target), 0, 'shield-blocked snowball adds no slow');
}
for (const kind of Object.keys(hp)) {
  const a = arena(), turret = a.w.addStruct({ kind: 'turret', item: 'turret', x: a.target.x, y: a.target.y,
    r: W.STRUCT_RADIUS.turret, hp: 500, maxHp: 500, team: a.target.team, owner: a.target.id });
  t.check(a.w.mountTurret(a.target, turret), kind + ': mounted target fixture boards its turret');
  shot(a, kind); flight(a);
  t.equal(10000 - a.target.hp, W.SENTRY_IV[kind].damage, kind + ': mounted turret rider can be targeted and hit exactly once');
  t.equal(turret.hp, 500, kind + ': rider takes damage instead of duplicating it onto turret chassis');
}
{
  const a = arena(), p = a.target;
  for (let i = 1; i < 20; i++) {
    impact(a, 'snowballs');
    t.near(a.w.speedMul(p), 1 - i * .05, 1e-10, 'snow stack' + i + ' slows player movement by5%');
  }
  impact(a, 'snowballs');
  t.equal(p.sentryFreezeUntil, 5, 'twentieth snowball starts a five-second freeze');
  const before = p.x; a.w.moveStep(p, { mx: 1, my: 0, sprint: true }, .5);
  t.equal(p.x, before, 'frozen player cannot move or sprint');
  p.controller = () => ({ fire: true, aimX: X, aimY: Y, mx: 1, my: 0 });
  const fired = p.stats.shots; a.w.updatePlayer(p, .05);
  t.check(p.stats.shots > fired && p.x === before, 'freeze blocks movement but keeps aiming and personal weapon firing available');
  a.w.time = 4.99; impact(a, 'snowballs');
  t.equal(p.sentryFreezeUntil, 5, 'hits during freeze cannot indefinitely refresh five-second immobilization');
  a.w.time = 5; a.w.updatePlayerSentryEffects(p);
  t.equal(a.w.speedMul(p), 1, 'five-second freeze clears with no residual expired slow');
  a.w.moveStep(p, { mx: 1, my: 0 }, .05); t.check(p.x > before, 'movement resumes after freeze');
}
{
  const a = arena(), p = a.target;
  a.w.applyPlayerSentrySnow(p); a.w.time = 1; a.w.applyPlayerSentrySnow(p);
  a.w.time = 3; a.w.updatePlayerSentryEffects(p); t.near(a.w.speedMul(p), .95, 1e-12, 'earlier snow hit expires independently after three seconds');
  a.w.time = 4; a.w.updatePlayerSentryEffects(p); t.equal(a.w.speedMul(p), 1, 'last snow hit expires independently');
}
{
  const a = arena(), p = a.target; impact(a, 'fireballs');
  for (let i = 1; i <= 60; i++) { a.w.time = i * DT; a.w.updatePlayerSentryEffects(p); }
  t.equal(p.hp, 9950, 'fireball deals20 impact plus exactly30 burn damage across three seconds');
  t.equal(p.sentryBurn, null, 'burn clears after its last0.1-second tick');
  a.w.time = 10; impact(a, 'fireballs'); a.w.time = 10.05; impact(a, 'fireballs'); a.w.time = 10.1; a.w.updatePlayerSentryEffects(p);
  t.equal(p.hp, 9909, 'repeated fireballs refresh one burn timer instead of creating exponential damage stacks');
  t.near(p.sentryBurn.until, 13.05, 1e-10, 'latest hit refreshes burn duration to three seconds');
}
for (const type of ['tank', 'humvee']) for (const kind of Object.keys(hp)) {
  const a = arena({ vehicles: [{ id: 1, type, x: X + 350, y: Y, angle: 0 }] }), v = a.w.vehicles[0];
  a.target.x = v.x; a.target.y = v.y; a.w.enterVehicle(a.target, v, 'driver');
  const s = sentry(a, kind), chosen = a.w.sentryIVTarget(s, W.SENTRY_IV[kind]);
  t.check(chosen?.type === 'vehicle' && chosen.target === v, kind + ': targets occupied ' + type + ' hull instead of protected rider');
  const before = v.hp; impact(a, kind, v);
  const base = kind === 'rockets' ? W.SENTRY_IV.rockets.vehicleBlast[type].maxDamage : W.SENTRY_IV[kind].damage;
  const expected = kind === 'cannons' ? 510 : kind === 'rockets' ? base : base * (type === 'tank' ? .25 : kind === 'snowballs' ? .5 : 1);
  t.near(before - v.hp, expected, 1e-8, kind + ': actual impact has correct ' + type + ' hull damage');
  t.equal(a.target.hp, 10000, kind + ': hull absorbs all damage from its passengers');
  if (kind === 'snowballs') t.near(a.w.vehicleSentryRate(v), .95, 1e-12, type + ': real snow impact invokes weapon-clock slow');
  if (kind === 'fireballs') t.equal(!!v.sentryBurn, type === 'humvee', type + ': real fireball applies requested burn immunity');
}
{
  const a = arena({}, true), g = a.w.spawnSentryProjectile({ id: 91, kind: 'rockets', owner: a.owner.id, team: 1, x: X, y: Y, dx: 1, dy: 0, age: 2, traveled: 2200 });
  const again = a.w.spawnSentryProjectile({ id: 91, kind: 'rockets', x: X + 50, age: 2.05 });
  t.check(g === again && a.w.sentryProjectiles.length === 1 && g.age === 2.05, 'remote snapshot restores and updates projectile state without duplicate identity');
  t.check(a.w.nextSentryProjectileId > 91, 'restoring authoritative IDs preserves future projectile IDs');
  flight(a);
  t.equal(a.target.hp, 10000, 'client prediction never authorizes projectile damage');
  t.equal(a.w.events.filter(e => e.type === 'sentry-impact').length, 0, 'client prediction never emits a second authoritative explosion');
  const s = sentry(a, 'snowballs'); a.w.updateSentry(s, DT); t.equal(a.w.sentryProjectiles.length, 0, 'remote sentry never spawns unauthorized shots');
}
// Canvas geometry stays finite at all variants and high-rate projectile types.
const renderer = Object.create(W.Renderer.prototype), view = { x0: X - 1000, x1: X + 1000, y0: Y - 1000, y1: Y + 1000 };
function drawing() {
  const calls = [], stack = [];
  const ctx = new Proxy({ fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    save() { stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, stack.pop()); }
  }, { get(target, key) { if (key in target) return target[key]; return (...args) => {
    for (const n of args) if (typeof n === 'number' && !Number.isFinite(n)) throw Error(key + ': nonfinite coordinate');
    calls.push({ op: key, args, fill: target.fillStyle, stroke: target.strokeStyle, lineWidth: target.lineWidth });
  }; } });
  return { ctx, calls, stack };
}
for (const kind of Object.keys(hp)) {
  const a = arena(), s = sentry(a, kind), d = drawing(); renderer.drawEmplacement(d.ctx, s, W.TIERS.legendary, true);
  t.equal(d.stack.length, 0, kind + ': emplacement drawing balances canvas state');
  t.check(d.calls.some(c => c.op === 'fill' && c.fill === W.SENTRY_IV[kind].color), kind + ': upgraded head has its own readable accent');
  a.w.spawnSentryProjectile({ kind, x: X + 100, y: Y, dx: 1, dy: 0, traveled: 100, age: .25, z: kind === 'grenades' ? 80 : 0 });
  const fx = drawing(); renderer.drawSentryProjectiles(fx.ctx, a.w, view, false); renderer.drawSentryProjectiles(fx.ctx, a.w, view, true);
  t.equal(fx.stack.length, 0, kind + ': projectile drawing balances canvas state');
  t.check(fx.calls.some(c => c.op === 'fill'), kind + ': projectile draws finite geometry');
}
{
  const a = arena(), s = sentry(a, 'cannons');
  s.hp = s.maxHp / 2;
  const before = JSON.stringify(s), drawingBody = drawing();
  renderer.drawStructures(drawingBody.ctx, a.w, view, 0, a.owner);
  t.check(drawingBody.calls.some(c => c.op === 'scale' && c.args[0] === 2 && c.args[1] === 2), 'cannon sentry head, body and chassis render at twice their former size');
  t.equal(JSON.stringify(s), before, 'larger cannon presentation never changes its collision body or health');
  t.check(drawingBody.calls.some(c => c.op === 'moveTo' && c.fill === 'rgba(20,24,30,0.75)' && c.args[1] === s.y - (s.r + 18) * 2), 'cannon health bar moves above the enlarged head');
  t.check(drawingBody.calls.some(c => c.op === 'fillText' && c.args[0] === 'Cannon Sentry IV' && c.args[2] === s.y + (s.r + 24) * 2), 'cannon label moves beneath the enlarged chassis');
  t.equal(drawingBody.stack.length, 0, 'enlarged cannon body and health rendering preserve canvas state');
  const edgeView = { x0: X + 80, x1: X + 300, y0: Y - 50, y1: Y + 50 }, edgeBody = drawing();
  renderer.drawStructures(edgeBody.ctx, a.w, edgeView, 0, a.owner);
  t.check(edgeBody.calls.some(c => c.op === 'scale' && c.args[0] === 2), 'cannon still draws when its enlarged barrel crosses the viewport edge');
  const g = a.w.spawnSentryProjectile({ kind: 'cannons', x: X + 100, y: Y, dx: 1, dy: 0, traveled: 200, age: .25 });
  const projectileBefore = JSON.stringify(g), shell = drawing();
  renderer.drawSentryProjectiles(shell.ctx, a.w, view, false);
  t.check(shell.calls.some(c => c.op === 'arc' && c.args[0] === 0 && c.args[1] === 0 && c.args[2] === 50), 'cannonball visibly matches a100-unit-diameter natural rock');
  t.check(shell.calls.some(c => c.op === 'moveTo' && c.args[0] === -150 && c.args[1] === 0 && c.lineWidth === 40), 'cannonball trail grows with its enlarged silhouette');
  t.equal(g.r, 4.5, 'visual cannonball radius50 preserves prior4.5 collision radius');
  t.equal(JSON.stringify(g), projectileBefore, 'drawing a massive cannonball does not mutate replicated physics');
  const trailView = { x0: X - 80, x1: X - 20, y0: Y - 50, y1: Y + 50 }, tail = drawing();
  renderer.drawSentryProjectiles(tail.ctx, a.w, trailView, false);
  t.check(tail.calls.some(c => c.op === 'lineTo' && c.lineWidth === 40), 'large cannonball trail remains visible before the projectile center enters the viewport');
}
{
  const a = arena(); a.target.sentryFreezeUntil = 5; a.target.sentryBurn = { until: 3 };
  const d = drawing(); renderer.drawSentryStatus(d.ctx, a.w, a.target, a.owner);
  t.check(d.calls.length > 0 && d.stack.length === 0, 'freeze and burn show visible balanced status cues');
  a.target.fx.invisible = 3;
  const hidden = drawing(); renderer.drawSentryStatus(hidden.ctx, a.w, a.target, a.owner);
  t.equal(hidden.calls.length, 0, 'status drawing never reveals an invisible enemy');
}
t.done();
