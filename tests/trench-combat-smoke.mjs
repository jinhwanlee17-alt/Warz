import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(), t = suite('Trench combat');
const X = 5000, Y = 5000, outsideY = Y + 90;
function arena(extra = {}) {
  const map = { seed: 1, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
    pickups: [], ponds: [], stations: [], towns: [], drops: [], nextPickupId: 1,
    trenches: [W.Trenches.create(1, X, Y, 0, 'normal')], ...extra };
  return new W.World({ map, storm: false });
}
function soldier(w, y, trenchId, x = X) {
  const p = w.addPlayer({ x, y });
  Object.assign(p, { trenchId, hp: 1000, maxHp: 1000, trenchDepth: trenchId ? 1 : 0 });
  return p;
}
const held = { fire: true, firePressed: true, aimX: X, aimY: outsideY + 100 };
{
  const w = arena(), below = soldier(w, Y, 1), surface = soldier(w, outsideY, 0);
  const gun = below.weapons[below.slot], ammo = gun.ammo;
  w.trigger(below, held);
  t.equal(gun.ammo, ammo - 1, 'concealed rifle fires a normal round');
  t.check(gun.cooldown > 0 && below.recoil > 0 && below.vx !== 0 && below.stats.shots === 1, 'floor fire retains cadence, recoil and shot count');
  t.check(w.events.some(e => e.type === 'shot' && e.trenchId === 1) && w.particles.some(p => p.kind === 'flash' && p.trenchId === 1),
    'the shot event and muzzle flash carry the layer where the weapon fired');
  t.equal(w.sweep(X, outsideY, X, Y, 4, surface.id, surface.team), null, 'surface bullet passes above a concealed player');
  below.trenchPeeking = true;
  gun.cooldown = 0;
  w.trigger(below, held);
  t.equal(gun.ammo, ammo - 2, 'peeking infantry can fire a rifle');
  t.equal(w.events.filter(e => e.type === 'shot').at(-1).trenchId, 0, 'peeking shots are fired at surface height');
  t.equal(w.sweep(X, outsideY, X, Y, 4, surface.id, surface.team)?.player, below, 'peeking infantry can be shot');
  below.trenchPeeking = false;
  w.setClass(below, 'grenadier', true);
  w.trigger(below, held); w.useUtility(below, held);
  t.equal(w.grenades.length, 2, 'launcher and hand grenade both work below the lip');
}
{
  const w = arena(), trench = w.map.trenches[0];
  const [a, b] = trench.points, x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const shooter = soldier(w, y, 1, x), hidden = soldier(w, y, 1, x + 32), peeker = soldier(w, y, 1, x + 52);
  peeker.trenchPeeking = true;
  const later = trench.points.find((p, i) => i > 2 && p.y === y);
  t.check(!!later && later.x > x && W.Trenches.contains(trench, later.x, later.y), 'the shot can cross a bend and return to this trench in one step');
  w.spawnShot(shooter, W.WEAPONS.sniper2, [0]);
  const round = w.bullets[0];
  t.check(round && round.trenchId === 1, 'a floor tracer passes through the silhouettes of enemies in the trench');
  shooter.trenchPeeking = true;
  w.updateBullets((later.x - x) / W.WEAPONS.sniper2.bulletSpeed);
  t.check(!w.bullets.length && hidden.hp === 1000 && peeker.hp === 1000 && shooter.stats.hits === 0,
    'a floor round stays harmless after its shooter peeks');
  const impact = w.particles.find(p => p.kind === 'spark' && p.trenchId === 1);
  t.check(impact && impact.x > x && impact.x < later.x && W.Trenches.wall(trench, impact.x, impact.y).distance < 1e-5,
    'the round stops with dirt at the first bank even when its tick would end back in the trench');
}
{
  const w = arena(), p = soldier(w, Y, 1);
  p.angle = Math.PI / 2;
  const above = soldier(w, outsideY, 0);
  const enemy = w.addStruct({ kind: 'sentry', item: 'sentry', x: X, y: outsideY + 30, r: 25, team: 99, hp: 200, maxHp: 200 });
  w.setClass(p, 'shotgunner', true);
  const gun = p.weapons[p.slot];
  gun.ammo = 1;
  w.trigger(p, held);
  t.check(gun.ammo === 0 && gun.reloading, 'a floor shotgun blast uses its final shell and starts reloading');
  w.updateBullets(1);
  t.check(above.hp === 1000 && enemy.hp === 200 && p.stats.hits === 0 && !w.bullets.length, 'all pellets stop before damaging surface infantry or defenses');
}
{
  const w = arena({ tanks: [{ id: 1, type: 'tank', x: X, y: Y }] }), tank = w.vehicles[0];
  const p = soldier(w, Y, 1), hp = tank.hp;
  w.setClass(p, 'juggernaut', true);
  w.updateClassCombat(p, held, W.WEAPONS.minigun.windup);
  w.trigger(p, held); w.updateBullets(1);
  t.check(p.stats.shots === 1 && p.weapons[0].ammo === W.WEAPONS.minigun.mag - 1, 'the minigun winds up and fires below the lip');
  w.setClass(p, 'pyromaniac', true); w.applyPyroFiregun(p, true); w.switchSlot(p, 1);
  w.update(.13); // Finish the ordinary equip delay.
  const bar = p.pyroFireBar;
  w.trigger(p, held); w.updateBullets(1);
  t.check(p.pyroFireBar < bar && tank.hp === hp && !tank.pyroBurn, 'the Firegun spends heat without damaging or burning an overhead tank');
}
{
  const w = arena(), y = Y + 32;
  const p = soldier(w, y, 1, X + 42);
  const rock = w.addStruct({ kind: 'rock', item: 'rock', x: X + 112, y, r: 15, team: 99 });
  const hp = rock.hp;
  w.spawnShot(p, W.WEAPONS.sniper2, [0]); w.updateBullets(1);
  t.check(!w.bullets.length && rock.hp === hp && w.particles.some(e => e.kind === 'spark' && e.x > p.x && e.x < rock.x),
    'a buried obstacle stops the round without damaging enemy equipment');
}
for (const [name, impact] of Object.entries({
  grenade: (w, x, y) => w.explode(x, y, W.WEAPONS.grenade.explosion, 0, 'grenade'),
  launcher: (w, x, y) => w.detonate({ weapon: 'launcher', explosion: W.WEAPONS.launcher.explosion, owner: 0, x, y }),
  artillery: (w, x, y) => w.artilleryImpact({ owner: 0, team: 90, targetX: x, targetY: y }),
  tank: (w, x, y) => w.tankShellImpact({ owner: 0, team: 90 }, null, x, y),
  'grenade sentry': (w, x, y) => w.sentryBlast({ kind: 'grenades', owner: 0, team: 90 }, null, x, y),
  'fire grenade': (w, x, y) => { w.itemBurst('firenade', x, y, 0); w.updateZones(.05); }
})) {
  for (const inside of [true, false]) {
    const w = arena(), below = soldier(w, Y, 1), surface = soldier(w, outsideY, 0);
    below.trenchPeeking = true;
    impact(w, X, inside ? Y : outsideY);
    t.check(inside ? below.hp < 1000 : below.hp === 1000, name + ' damages peeking infantry only on a trench-floor impact');
    t.check(inside ? surface.hp === 1000 : surface.hp < 1000, name + ' damages surface infantry only on a surface impact');
  }
}
for (const [landing, burstY] of [['surface', outsideY], ['trench floor', Y]]) {
  const w = arena({ tanks: [{ id: 1, type: 'tank', x: X + 150, y: outsideY }] });
  w.map.trenches.push(W.Trenches.create(2, X, Y + 300, 0, 'normal'));
  const below = soldier(w, Y, 1), surface = soldier(w, outsideY, 0), adjacent = soldier(w, Y + 300, 2);
  const far = soldier(w, burstY + W.ITEMS.snowbomb.radius + 1, 0), crossing = soldier(w, outsideY, 0);
  const tank = w.vehicles[0], hullHp = tank.hp;
  const burning = landing === 'surface' ? below : surface;
  w.applyPyroBurn(burning, crossing.id, 'firegun', 10, 0);
  w.applyPyroBurn(far, crossing.id, 'firegun', 10, 0);
  t.check(w.pyroBurnTime(burning) > 0, 'cross-bank target is burning before the ' + landing + ' snowbomb bursts');
  w.itemBurst('snowbomb', X, burstY, 0);
  t.check(!burning.pyroBurn && w.pyroBurnTime(far) > 0,
    'snowbomb on ' + landing + ' extinguishes a burn across the bank while fire outside its radius persists');
  for (let i = 0; i < W.ITEMS.snowbomb.graceTime * 4 - 1; i++) w.updateZones(.25);
  t.check([below, surface, adjacent].every(p => p.inSnow && p.hp === 1000),
    'snowbomb on ' + landing + ' chills surface infantry and occupants of both trenches during its grace period');
  crossing.y = Y;
  w.enterTrench(crossing, w.map.trenches[0]);
  w.updateZones(.25);
  t.check(below.hp < 1000 && surface.hp === below.hp && adjacent.hp === below.hp,
    'snowbomb on ' + landing + ' deals equal cold damage across the banks and into a separate trench');
  t.check(crossing.hp < 1000 && crossing.hp === below.hp,
    'entering a trench within the ' + landing + ' blizzard preserves accumulated cold exposure');
  t.check(tank.hp < hullHp, 'snowbomb on ' + landing + ' damages a surface tank in range');
  t.check(!far.inSnow && far.hp === 1000, 'infantry just beyond the ' + landing + ' snowbomb radius escape its cold');
}
{
  const w = arena({ tanks: [{ id: 1, type: 'tank', x: X, y: Y }] }), tank = w.vehicles[0], hp = tank.hp;
  const below = soldier(w, Y, 1);
  w.artilleryImpact({ owner: 0, team: 90, targetX: X, targetY: Y });
  t.equal(tank.hp, hp, 'artillery bursting on the floor spares a tank crossing overhead');
  t.check(below.hp < 1000, 'a crossing tank does not shield the trench floor from a floor impact');
}
{
  const w = arena(), below = soldier(w, Y, 1);
  function mount(kind, item, x, y) {
    return w.addStruct({ kind, item, x, y, r: 25, team: 90, hp: 200, maxHp: 200 });
  }
  const s = mount('sentry', 'sentry', X, Y + 250);
  w.updateSentry(s, .1);
  t.equal(s.target, 0, 'surface gun sentry ignores concealed infantry');
  below.trenchPeeking = true; w.updateSentry(s, .1);
  t.check(s.target === below.id && below.hp < 1000, 'surface gun sentry shoots a peeker');
  below.trenchPeeking = false;
  s.item = W.SENTRY_IV.grenades.item; s.cooldown = 0;
  w.updateSentry(s, 0);
  t.check(w.sentryProjectiles?.length > 0, 'surface grenade sentry can lob at a concealed occupant');
  const hp = below.hp;
  for (let i = 0; i < 32; i++) w.updateSentryProjectiles(.05);
  t.check(below.hp < hp, 'the sentry grenade lands inside and damages the occupant');
  const buried = mount('sentry', W.SENTRY_IV.grenades.item, X - 100, Y - 32);
  w.updateSentry(buried, .1);
  t.equal(w.sentryProjectiles.length, 0, 'buried grenade sentry cannot fire');
  const turret = mount('turret', 'turret', X + 60, outsideY);
  turret.team = below.team;
  t.check(!w.mountTurret(below, turret), 'trench occupant cannot mount a surface gun through the wall');
}
{
  const w = arena(), builder = soldier(w, Y + 115, 0, X - 130), inside = { aimX: X - 130, aimY: Y - 20 };
  t.check(w.spotFree(inside.aimX, inside.aimY, W.STRUCT_RADIUS.sentry, false), 'placement fixture is clear of other objects');
  t.check(!w.placeItem(builder, W.ITEMS.sentry, inside), 'a sentry item cannot be placed in a trench');
  t.check(!w.sentryBuildSpotClear(builder, { x: inside.aimX, y: inside.aimY }), 'an Engineer cannot construct a sentry on the trench floor');
}
{
  const w = arena(), y = Y + 32, below = soldier(w, y, 1, X + 135);
  const rock = w.addStruct({ kind: 'rock', item: 'rock', x: X + 85, y, r: 22 });
  t.equal(rock.trenchId, 1, 'a floor rock is below the surface');
  w.explode(X + 42, y, W.WEAPONS.grenade.explosion, 0, 'grenade');
  t.equal(below.hp, 1000, 'a floor rock shields a trench occupant from an in-trench blast');
  below.trenchPeeking = true;
  t.equal(w.sweep(X + 42, y, below.x, y, 3, 99, 99)?.player, below, 'a surface projectile clears the floor rock and hits an exposed head');
  t.check(w.sentryLineClear({ x: X + 42, y, r: 7 }, below.x, y), 'a sentry can see over floor cover');
}
{
  const w = arena(), exposed = soldier(w, Y, 1), hidden = soldier(w, Y + 32, 1, X + 65), surface = soldier(w, outsideY, 0);
  exposed.trenchPeeking = true;
  w.tankShellImpact({ owner: 0, team: 90 }, { player: exposed }, exposed.x, exposed.y);
  t.check(exposed.hp < 1000 && surface.hp < 1000, 'a shell hitting an exposed head bursts at surface height');
  t.equal(hidden.hp, 1000, 'a surface-height contact over a trench leaves its occupants below protected');
}
t.done();
