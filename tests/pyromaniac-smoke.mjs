import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'class-combat', 'vehicles', 'sentry-combat', 'level3-combat', 'engineer', 'rpg', 'magic-medic', 'pyromaniac']);
const t = suite('Pyromaniac combat'), X = 5000, Y = 5000;
function arena(extra = {}, remote = false) {
  const map = Object.assign({ seed: 5, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], nextPickupId: 1 }, extra);
  const world = new W.World({ map, remote, storm: false });
  const p = world.addPlayer({ classId: 'pyromaniac', x: X, y: Y, team: 1 });
  const target = world.addPlayer({ x: X + 250, y: Y, team: 2 }); target.hp = target.maxHp = 100000;
  const intent = { mx: 0, my: 0, aimX: X + 1000, aimY: Y, fire: false, firePressed: false };
  p.controller = () => intent;
  return { world, p, target, intent };
}
function tick(a, seconds, dt = .05) { for (let i = 0; i < Math.round(seconds / dt); i++) a.world.update(dt); }
function fly(a, seconds = .5) { for (let i = 0; i < seconds / .01; i++) a.world.updateBullets(.01); }
{
  const a = arena();
  t.equal(a.p.hp, 150, 'Pyromaniac starts with150HP');
  t.equal(a.p.weapons.map(w => w.id).join(), 'pyroflamethrower,pyrodualrevolver', 'class loadout has upgraded flame and paired heavy revolvers');
  t.equal(W.Rules.classParents('pyromaniac').join(), 'pyromancer', 'Pyromancer is the required predecessor');
  t.equal(W.Rules.upgradeCostFor('pyromaniac'), 40, 'class costs40tokens separately fromfiregun');
  t.check(!W.CLASS_PLANNED.pyromaniac && W.CLASS_ORDER.at(-1) === 'pyromaniac', 'class is released with existing network indices preserved');
  t.check(W.CLASS_ORDER.every(id => W.TREE_LAYOUT[id] && Number.isFinite(W.TREE_LAYOUT[id].x) && Number.isFinite(W.TREE_LAYOUT[id].y)), 'every released class has a finite menu layout');
  t.check(W.WEAPONS.pyroflamethrower.range > W.WEAPONS.flamethrower.range, 'upgraded flame reaches farther than Pyromancer');
  for (const cause of ['pistol', 'grenade', 'lightning', 'storm', 'snow', 'pyro-burn', 'tank-cannon', 'sentry-cannons']) {
    a.p.hp = 150; a.world.damagePlayer(a.p, 100, a.target.id, cause); t.equal(a.p.hp, 100, cause + ' receives permanent50%damage resistance');
  }
}
{
  const a = arena(); a.p.slot = 1; a.world.trigger(a.p, { firePressed: true });
  t.equal(a.p.weapons[1].ammo, 8, 'one dualvolley consumes two of ten rounds');
  t.equal(a.world.bullets.length, 2, 'dualvolley creates two independent physical bullets');
  fly(a); t.near(a.target.hp, 99800, 1e-8, 'both100damage bullets can hit the same target');
  a.p.weapons[1].cooldown = 0; a.world.trigger(a.p, { fire: true });
  t.equal(a.p.weapons[1].ammo, 8, 'holding does not repeatedlyfire the untransformed dual revolvers');
  for (let i = 0; i < 4; i++) { a.p.weapons[1].cooldown = 0; a.world.trigger(a.p, { firePressed: true }); }
  t.check(a.p.weapons[1].ammo === 0 && a.p.weapons[1].reloading, 'five volleys empty magazine and startreload');
  tick(a, 2.3); t.equal(a.p.weapons[1].ammo, 10, 'reload restores ten paired revolver rounds');
}
{
  const a = arena(); a.intent.fire = true;
  for (const [seconds, total, damage] of [[2.5, 50, 10], [2.5, 150, 15], [2.5, 300, 45]]) {
    tick(a, seconds);
    t.near(100000 - a.target.hp, total, .001, 'continuous flame stage has correct cumulative direct damage');
    t.equal(W.Pyro.flameStage(a.p.pyroHeat).damage, damage, 'heat reaches the next stage at its exact duration');
  }
  t.near(a.target.pyroBurn.flame.damage, 300, .001, 'residual burn tracks direct damage once');
  t.near(a.target.pyroBurn.flame.exposure, 7.5, .001, 'residual burn tracks 7.5 seconds of flame exposure');
  t.near(a.target.pyroBurn.flame.dps, 30, .001, 'residual DPS is 10% of cumulative direct damage');
  tick(a, 1.5); t.near(100000 - a.target.hp, 750, .001, 'fourth stage sustains 45 damage every .15 seconds');
  tick(a, 1); t.equal(W.Pyro.flameStage(a.p.pyroHeat).damage, 70, 'fifth stage becomes available after ten seconds');
  const before = a.target.hp; tick(a, 1);
  t.near(before - a.target.hp, 700, .001, 'final stage sustains 70 damage every .1 seconds');
  t.check(a.p.weapons[0].ammo === 1 && !a.p.weapons[0].reloading && !a.world.startReload(a.p), 'flamethrower never consumes ammo or reloads');
  a.intent.fire = false; tick(a, .05); t.equal(a.p.pyroHeat, 0, 'releasing fire resets heat');
  a.intent.fire = true; a.p.weapons[0].cooldown = 0; tick(a, .05);
  t.equal(a.world.events.filter(e => e.type === 'flame').at(-1).damage, 5, 'a fresh burst returns to five damage');
}
{
  const a = arena(); a.intent.fire = true; tick(a, 5); a.intent.fire = false;
  tick(a, 2.05);
  t.near(100000 - a.target.hp, 180, .11, '150 direct damage over five seconds leaves 30 residual damage (15 DPS for two seconds)');
  t.equal(a.world.pyroBurnTime(a.target), 0, 'residual burn ends after its calculated duration');
}
{
  const a = arena(); a.target.x = X + 475; a.intent.fire = true; tick(a, .05);
  t.equal(a.target.hp, 99995, 'newflame hits beyond old375unit range');
  a.target.x = X + W.WEAPONS.pyroflamethrower.range + a.target.r + 1; a.target.pyroBurn = null; tick(a, .3);
  t.equal(a.target.hp, 99995, 'flame respects its upgraded outerboundary');
  const ally = a.world.addPlayer({ x: X + 150, y: Y, team: 1 }); tick(a, .3);
  t.equal(ally.hp, 100, 'flame doesnotdamage teammates in ordinary play');
}
{
  const a = arena(); a.p.tokens = 49;
  t.check(!a.world.useUtility(a.p, {}) && !a.p.pyroFiregun && a.p.tokens === 49, 'upgrade requires50tokens without charging partial funds');
  a.p.tokens = 100; a.p.slot = 1; a.p.weapons[1].reloading = true;
  t.check(a.world.useUtility(a.p, {}), 'Use Gear purchases the firegun');
  t.check(a.p.pyroFiregun && a.p.weapons[1].id === 'firegun' && W.WEAPONS.firegun.infiniteAmmo && !a.p.weapons[1].reloading, 'upgrade replaces both revolvers with one unlimited-ammo Firegun');
  t.equal(a.p.tokens, 50, 'purchase spends exactly50tokens');
  t.check(!a.world.useUtility(a.p, {}) && a.p.tokens === 50, 'repeatgearpress cannot doublecharge');
  t.check(a.world.events.some(e => e.type === 'pyro-upgrade') && a.world.explosions.length, 'transformation has visible feedback and a replication event');
  const ammo = a.p.weapons[1].ammo;
  a.target.x = X + 5000; a.intent.fire = true; tick(a, 1.2);
  t.check(a.p.stats.shots === 8 && a.p.pyroFireBar === 0, 'seven points per fireball empties the fire bar on the eighth shot');
  t.check(a.p.weapons[1].ammo === ammo && !a.p.weapons[1].reloading && !a.world.startReload(a.p), 'Firegun keeps unlimited ammo and cannot reload');
  a.intent.fire = false; tick(a, 2.3);
  t.equal(a.p.pyroFireBar, 0, 'waiting a reload interval does not refill the fire bar');
  const resetAt = a.p.pyroFireResetAt;
  a.world.setClass(a.p, 'pyromaniac', false); t.check(a.p.pyroFiregun && a.p.pyroFireBar === 0 && a.p.pyroFireResetAt === resetAt, 'same-class reconciliation preserves the upgrade and active fire window');
  a.world.setClass(a.p, 'pyromaniac', true); t.check(!a.p.pyroFiregun && a.p.weapons[1].id === 'pyrodualrevolver', 'fresh life resets50token upgrade');
  t.equal(a.p.pyroFireBar, 50, 'a fresh life fills the fire bar');
}
{
  const a = arena(); a.world.applyPyroFiregun(a.p, true); a.p.slot = 1;
  a.world.trigger(a.p, { firePressed: true }); fly(a);
  t.equal(a.target.hp, 99100, 'first Firegun projectile deals (50 / 2 / 50) * 1800 = 900 impact damage');
  t.equal(a.target.pyroBurn.firegun.dps, 6, 'firegun burn startsat6DPS');
  tick(a, .5); a.p.weapons[1].cooldown = 0; a.world.trigger(a.p, { firePressed: true }); fly(a);
  t.equal(a.target.pyroBurn.firegun.dps, 6, 'multiplefireballs never stackburnDPS');
  t.near(a.target.pyroBurn.firegun.until, 6, .001, 'secondfireball adds3seconds toremainingburn');
  const hp = a.target.hp; tick(a, 1); t.near(hp - a.target.hp, 6, .11, 'stackedburnstilldeals6damagepersecond');
  a.world.applyPlayerSentrySnow(a.target); t.equal(a.world.pyroBurnTime(a.target), 0, 'snowball immediately extinguishes stackedfiregunburn');
  const cooled = a.target.hp; tick(a, 1); t.equal(a.target.hp, cooled, 'extinguishedburn cannot keep ticking');
}
{
  const a = arena(); a.world.applyPyroBurn(a.target, a.p.id, 'flame', 100, 5); a.world.applyPyroBurn(a.target, a.p.id, 'firegun', 10, 0);
  a.world.applyPlayerSentryBurn(a.target, a.p.id);
  a.world.addZone({ kind: 'snow', x: a.target.x, y: a.target.y, r: 300, dur: 10, owner: a.p.id, team: 1 });
  t.check(!a.target.pyroBurn && !a.target.sentryBurn, 'snowbomb instantly clearsall activeburn families');
  a.world.damagePlayer(a.target, 10, a.p.id, 'firegun'); t.equal(a.target.pyroBurn, null, 'standingin snow prevents immediate reignition');
}
for (const type of ['humvee', 'tank']) {
  const a = arena({ vehicles: [{ id: 1, type, x: X + 300, y: Y, angle: 0 }] }), v = a.world.vehicles[0];
  a.target.x = X + 5000; a.world.applyPyroFiregun(a.p, true); a.p.slot = 1;
  a.world.trigger(a.p, { firePressed: true }); fly(a);
  t.equal(v.maxHp - v.hp, 900, type + ' takes formula impact damage without regular bullet/sentry resistance');
  if (type === 'tank') { t.check(!v.pyroBurn, 'tankcannotcatchfire'); tick(a, 1); t.equal(v.maxHp - v.hp, 900, 'tank has no residual fire damage'); }
  else {
    t.check(!!v.pyroBurn, 'Humveecatchesfire'); tick(a, 1); t.near(v.maxHp - v.hp, 906, .11, 'Humvee burns at six damage per second');
    a.world.applyVehicleSentrySnow(v); t.check(!v.pyroBurn, 'snowballs extinguishHumvees too');
  }
}
for (const type of ['humvee', 'tank']) {
  const a = arena({ vehicles: [{ id: 1, type, x: X + 300, y: Y, angle: 0 }] }), v = a.world.vehicles[0];
  a.world.applyPyroBurn(a.target, a.p.id, 'firegun', 10, 0);
  const spot = a.world.vehicleSeatPoint(v, 'driver', true); a.target.x = spot.x; a.target.y = spot.y;
  t.check(a.world.enterVehicle(a.target, v, 'driver'), type + ': burningplayercanboard');
  const hp = a.target.hp; tick(a, 1);
  t.equal(a.target.hp, hp, type + ': existingburncannotbypassoccupantprotection');
  t.near(v.maxHp - v.hp, type === 'tank' ? 0 : 6, .11, type + ': existingpassengerburnrespectsvehiclefirebehavior');
  a.world.applyVehicleSentrySnow(v); t.check(!a.target.pyroBurn, type + ': snowextinguishesburningpassengersaswell');
}
{
  const a = arena();
  const turret = a.world.addStruct({ kind: 'turret', item: 'turret', x: a.target.x, y: a.target.y, owner: a.target.id, team: 2, r: 38, hp: 100, maxHp: 100 });
  turret.mounted = a.target.id; a.target.mount = turret.id; a.intent.fire = true; tick(a, .05);
  t.equal(a.target.hp, 99995, 'a mountedturretoccupant takesoneflamehit ratherthanusingturretasashield');
  t.equal(turret.hp, 100, 'occupiedturret isnotseparatelydoublehitbytheflamecone');
}
{
  const a = arena(); a.p.fx.strength = 10; a.p.pyroHitInterval = 1;
  a.world.damagePlayer(a.target, 100, a.p.id, 'pyroflamethrower');
  const direct = 100000 - a.target.hp;
  t.near(a.target.pyroBurn.flame.dps, direct * .1, .001, 'burnformula usesactualdirectdamage includingsourcebuff once');
  tick(a, 1.4); t.near(100000 - a.target.hp - direct, direct * .1 * .4, .11, 'residualburn doesnotapply sourcebuffasecondtime');
}
{
  const a = arena();
  t.equal(a.p.pyroFireBar, 50, 'new class starts with a full fire bar');
  tick(a, 10);
  t.equal(a.world.pyroFireTime(a.p), 0, 'idle before first use does not start the minute');
  a.intent.fire = true; tick(a, 2.5); a.intent.fire = false;
  t.near(a.p.pyroFireBar, 47.5, .0001, 'flamethrower spends one fire point per second before buying the Firegun');
  const resetAt = a.p.pyroFireResetAt;
  a.world.applyPyroFiregun(a.p, true); a.p.slot = 1; a.p.weapons[1].cooldown = 0;
  a.world.trigger(a.p, { firePressed: true });
  t.near(a.p.pyroFireBar, 40.5, .0001, 'Firegun shares the flamethrower fire bar');
  t.near(a.world.bullets.at(-1).damage, 855, .0001, 'fractional remaining fire determines damage before spending seven points');
  t.equal(a.p.pyroFireResetAt, resetAt, 'switching weapons and firing does not restart the minute');
  a.p.held = 0; tick(a, 10);
  t.near(a.p.pyroFireBar, 40.5, .0001, 'remaining fire stays unchanged until the fixed refill, with no gradual regeneration');
  a.world.time = resetAt - .1; tick(a, .05);
  t.near(a.p.pyroFireBar, 40.5, .0001, 'bar does not refill early');
  tick(a, .05);
  t.equal(a.p.pyroFireBar, 50, 'fire bar refills exactly at sixty seconds while stowed');
  t.equal(a.world.pyroFireTime(a.p), 0, 'reset waits for next use before starting a new minute');
  a.p.held = -1; a.p.weapons[1].cooldown = 0;
  a.world.trigger(a.p, { firePressed: true });
  t.equal(a.p.pyroFireBar, 43, 'first shot after refill spends seven points and starts a new fire window');
  t.near(a.world.pyroFireTime(a.p), 60, .0001, 'new window lasts a full minute');
}
{
  const a = arena(); a.target.x = X + 5000;
  a.world.applyPyroFiregun(a.p, true); a.p.slot = 1;
  const damages = [];
  for (let i = 0; i < 8; i++) {
    a.p.weapons[1].cooldown = 0;
    t.check(a.world.trigger(a.p, { firePressed: true }), 'Firegun shot ' + (i + 1) + ' succeeds while fire remains');
    damages.push(a.world.bullets.at(-1).damage);
  }
  t.equal(damages.map(n => Math.round(n)).join(), '900,774,648,522,396,270,144,18', 'shot damage declines with remaining fire, including a final shot using the last point');
  t.near(a.world.bullets[0].damage, 900, .00001, 'later usage does not change already fired projectile damage');
  a.p.weapons[1].cooldown = 0;
  t.check(!a.world.trigger(a.p, { firePressed: true }) && a.p.stats.shots === 8, 'empty fire bar stops Firegun shots without a reload');
  a.p.slot = 0; a.intent.fire = true; tick(a, 11);
  t.equal(a.p.pyroFireBar, 0, 'flamethrower cannot drain the fire bar below zero');
  const flames = a.world.events.filter(e => e.type === 'flame');
  t.check(flames.length > 0 && flames.at(-1).damage === 70, 'flamethrower continues firing and ramping at an empty fire bar');
}
{
  const a = arena(); a.p.slot = 1; a.intent.firePressed = true; tick(a, .05);
  t.equal(a.p.pyroFireBar, 50, 'ordinary dual revolvers do not affect the fire bar');
  a.intent.firePressed = false; a.p.slot = 0; a.intent.fire = true; a.p.held = 0; tick(a, .1);
  t.equal(a.p.pyroFireBar, 50, 'holding an empty gear slot does not spend fire');
  a.p.held = -1; a.p.downed = true; tick(a, .1);
  t.equal(a.p.pyroFireBar, 50, 'downed players cannot spend fire');
}
{
  const a = arena({}, true); a.p.tokens = 100;
  t.check(!a.world.useUtility(a.p, {}) && a.p.tokens === 100, 'clientmirrorcannotbuy anupgrade');
  a.world.applyPyroFiregun(a.p, true); a.p.slot = 1;
  t.check(!a.world.trigger(a.p, { firePressed: true }) && a.target.hp === 100000, 'clientmirrorcannot authorfiregundamage');
  a.target.pyroBurning = 3; t.equal(a.world.pyroBurnTime(a.target), 3, 'clientrenderreadsreplicatedburnstatus');
  a.p.pyroFireBar = 21; a.p.pyroFireResetT = 42;
  t.equal(a.world.pyroFireTime(a.p), 42, 'client fire timer uses replicated remaining time');
  t.equal(a.p.pyroFireBar, 21, 'client cannot spend authoritative fire usage locally');
}
t.done();
