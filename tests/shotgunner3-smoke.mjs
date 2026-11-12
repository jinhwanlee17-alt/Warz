import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(), t = suite('Shotgunner III'), X = 5000, Y = 5000;
function arena(extra = {}, remote = false) {
  const map = Object.assign({ seed: 53, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], nextPickupId: 1 }, extra);
  const w = new W.World({ map, remote, storm: false });
  const p = w.addPlayer({ classId: 'shotgunner3', x: X, y: Y, team: 1 });
  const target = w.addPlayer({ x: X + 300, y: Y, team: 2 }); target.hp = target.maxHp = 10000;
  return { w, p, target };
}
function fly(a, seconds = .5) { for (let i = 0; i < seconds / .01; i++) a.w.updateBullets(.01); }

{
  const { w, p } = arena();
  t.equal(p.hp, 175, 'class starts with 175 HP');
  t.equal(p.weapons.map(w => w.id).join(), 'shotgun3,dualrevolver', 'class gets Shotgun III and Dual Heavy Revolvers');
  t.equal(W.Rules.upgradeCostFor('shotgunner3'), 40, 'upgrade costs 40 tokens');
  t.equal(W.Rules.classParents('shotgunner3').join(), 'shotgunner2', 'only Shotgunner II can upgrade');
  t.equal(w.outgoingClassDamageMul(p), 1.1, 'all outgoing damage receives the ten-percent passive');
  t.equal(W.Rules.shotgunDamage(0, W.WEAPONS.shotgun3), 500, 'point-blank shotgun base damage is 500');
  t.equal(W.Rules.shotgunDamage(W.WEAPONS.shotgun3.range, W.WEAPONS.shotgun3), 50, 'shotgun base damage falls to 50 at maximum range');
  t.equal(W.Rules.shotgunDamage((W.WEAPONS.shotgun3.range + W.WEAPONS.shotgun3.pointBlank) / 2, W.WEAPONS.shotgun3), 275, 'shotgun falloff is linear between the endpoints');
  t.check(!/penetrat|tank.*defen/i.test(W.WEAPONS.shotgun3.blurb + W.Rules.weaponLine('shotgun3') + W.CLASSES.shotgunner3.description), 'player-facing descriptions do not reveal the ammunition behavior');
}
{
  const a = arena(); a.p.slot = 1;
  a.w.trigger(a.p, { firePressed: true });
  t.equal(a.p.weapons[1].ammo, 8, 'a dual-revolver volley consumes two of ten rounds');
  t.equal(a.w.bullets.length, 2, 'one click launches two physical bullets');
  t.check(a.w.bullets.every(b => !b.shot), 'dual bullets are independent hits rather than a grouped shotgun blast');
  const shot = a.w.events.find(e => e.type === 'shot');
  t.equal(shot.angles.length, 2, 'network shot event carries both simultaneous bullet directions');
  fly(a);
  t.equal(a.target.hp, 9835, 'both 75-damage rounds hit with the ten-percent class bonus (165 total)');
  a.p.weapons[1].cooldown = 0;
  a.w.trigger(a.p, { fire: true });
  t.equal(a.p.weapons[1].ammo, 8, 'holding the button does not fire another semi-automatic volley');
  for (let i = 0; i < 4; i++) { a.p.weapons[1].cooldown = 0; a.w.trigger(a.p, { firePressed: true }); }
  t.equal(a.p.weapons[1].ammo, 0, 'five volleys empty the ten-round magazine');
  t.check(a.p.weapons[1].reloading, 'last volley automatically starts the reload');
  t.equal(a.p.weapons[1].reloadT, W.WEAPONS.revolver.reload, 'dual revolvers retain the heavy revolver reload duration');
  a.w.updatePlayer(a.p, W.WEAPONS.revolver.reload);
  t.equal(a.p.weapons[1].ammo, 10, 'a complete reload restores all ten rounds');
}
{
  const a = arena(); a.target.x = X + 70;
  a.w.trigger(a.p, { firePressed: true }); fly(a);
  t.equal(a.target.hp, 9450, 'one close shotgun blast deals 550 after class bonus without multiplying by eight pellets');
}
for (const cause of ['pistol', 'grenade', 'fire', 'poison', 'lightning', 'meteor', 'airstrike', 'ram', 'tank-cannon', 'tankmg', 'sentry', 'sentry-cannons', 'sentry-burn']) {
  const a = arena(); a.w.damagePlayer(a.target, 100, a.p.id, cause);
  t.near(a.target.hp, 9890, 1e-8, cause + ': player damage applies the intrinsic class bonus once');
}
for (const cause of ['pistol', 'grenade', 'lightning', 'meteor', 'storm', 'snow', 'tank-cannon', 'sentry-cannons']) {
  const a = arena(); a.w.damagePlayer(a.p, 100, a.target.id, cause);
  t.equal(a.p.hp, 100, cause + ': permanent resistance reduces 100 incoming damage to 75');
}
{
  const a = arena(); a.target.fx.shield = 10;
  a.w.damagePlayer(a.target, 100, a.p.id, 'pistol');
  t.near(a.target.hp, 10000 - Math.round(110 * (1 - W.ITEMS.shield.reduce) * 10) / 10, 1e-8, 'class damage bonus composes with target potion resistance');
  a.p.fx.strength = 10; a.target.fx.shield = 0; a.target.hp = 10000;
  a.w.damagePlayer(a.target, 100, a.p.id, 'pistol');
  t.near(a.target.hp, 10000 - Math.round(110 * (1 + W.ITEMS.strength.damage) * 10) / 10, 1e-8, 'class damage bonus composes once with strength potion');
}
for (const type of ['humvee', 'tank']) {
  const a = arena({ vehicles: [{ id: 1, type, x: X + 500, y: Y, angle: 0 }] }), v = a.w.vehicles[0];
  for (const cause of ['pistol', 'shotgun3', 'grenade', 'lightning', 'tank-cannon', 'tankmg', 'sentry', 'sentry-rockets', 'sentry-cannons']) {
    v.hp = v.maxHp;
    a.w.damageVehicle(v, 100, a.p.id, cause);
    const mul = type === 'tank' ? cause === 'shotgun3' ? .35 : ['pistol', 'tankmg', 'sentry'].includes(cause) ? .25 : 1 : 1;
    t.near(v.maxHp - v.hp, 110 * mul, 1e-8, type + ' / ' + cause + ': intrinsic bonus and hull defenses each apply once');
  }
  t.equal(a.w.vehicleSentryDamageMul(v, 'dualrevolver'), type === 'tank' ? .25 : 1, type + ': dual revolvers retain ordinary bullet resistance');
  a.target.vehicle = v.id; v.seats.driver = a.target.id; v.hp = v.maxHp;
  a.w.damagePlayer(a.target, 500, a.p.id, 'shotgun3');
  t.near(v.maxHp - v.hp, type === 'tank' ? 192.5 : 550, 1e-8, type + ': redirected occupant hit does not double-apply class bonus');
  t.equal(a.target.hp, 10000, type + ': intact vehicle still protects its passenger');
}
{
  const a = arena();
  const crate = { id: 1, x: X + 300, y: Y, size: 50, hp: 1000, alive: true, tier: 'common' };
  a.w.damageCrate(crate, 100, a.p.id, crate.x, crate.y);
  t.near(crate.hp, 890, 1e-8, 'crate damage receives the class bonus');
  const s = a.w.addStruct({ kind: 'sentry', item: 'sentry', x: X + 500, y: Y, r: 30, owner: a.target.id, team: 2, hp: 1000, maxHp: 1000 });
  a.w.damageStruct(s, 100, a.p.id, s.x, s.y, 'pistol');
  t.near(s.hp, 890, 1e-8, 'deployable damage receives the class bonus');
  const rock = a.w.addStruct({ kind: 'rock', item: 'rock', x: X + 800, y: Y, r: 45, team: 2 });
  a.w.damagePlayerRock(rock, a.p.id, rock.x, rock.y);
  t.near(rock.hp, 890, 1e-8, 'tank ramming portable cover receives the class damage bonus');
  const turret = a.w.addStruct({ kind: 'turret', item: 'turret', x: a.target.x, y: a.target.y, r: 35, hp: 1000, maxHp: 1000, mounted: a.target.id });
  a.w.damageStruct(turret, 100, a.p.id, turret.x, turret.y, 'pistol');
  t.equal(a.target.hp, 9890, 'mounted turret redirection applies class bonus only at the rider');
}
{
  const a = arena({}, true);
  a.w.spawnShot(a.p, W.WEAPONS.dualrevolver, [0, 0]);
  t.equal(a.w.bullets.length, 2, 'online visual mirror constructs both dual-revolver bullets');
  fly(a);
  t.equal(a.target.hp, 10000, 'online visual mirror never predicts authoritative damage');
}
t.done();
