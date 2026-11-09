// Level-two upgrades exercise the same combat code used by the browser and multiplayer server.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(), t = suite('classes');
const { World, CLASSES, WEAPONS, Rules } = W;
const template = W.MapGen.generate(15);
function arena(teams = false, remote = false) {
  const map = { ...template, rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [], ponds: [], stations: [] };
  return new World({ map, teams, remote, storm: false });
}
function idle(p) { p.controller = () => ({ mx: 0, my: 0, aimX: p.x + 100, aimY: p.y }); }
function run(w, seconds, dt = .05) { for (let i = 0; i < Math.round(seconds / dt); i++) w.update(dt); }
function player(w, cls, x = 4000, y = 4000, team) { const p = w.addPlayer({ classId: cls, x, y, team }); idle(p); return p; }

const active = W.CLASS_ORDER.filter(id => CLASSES[id].tier === 2);
t.equal(active.length, 7, 'seven level-two classes are playable');
for (const id of active) {
  const c = CLASSES[id], w = arena(), p = player(w, id);
  t.check(Rules.upgradeCheck({ from: c.parent, to: id, tokens: 15, keys: 0, stationCooldown: 0 }).ok, id + ' upgrades for fifteen tokens');
  t.equal(p.items.length + p.weapons.length, 5, id + ' preserves the five-slot hotbar');
  t.check(p.weapons.every(slot => WEAPONS[slot.id] && W.BARRELS[slot.id]), id + ' has complete combat and drawing definitions');
  t.check(Number.isFinite(p.commandCd) && Number.isFinite(p.commandBuff), id + ' initializes serializable ability state');
}
t.check(!Rules.upgradeCheck({ from: 'medic', to: 'sniper2', tokens: 99, keys: 9, stationCooldown: 0 }).ok, 'unrelated level-two branches remain locked');
for (const first of ['sniper','shotgunner','medic','grenadier']) {
  t.equal(Rules.nextClasses(first).length, 4, first + ' has four active level-two choices');
  for (const shared of ['pyromancer','juggernaut','commander']) t.check(Rules.upgradeCheck({from:first,to:shared,tokens:15,keys:0,stationCooldown:0}).ok, first + ' can choose ' + shared);
  t.check(Rules.classParents('armorcrew').includes(first) && !Rules.upgradeCheck({from:first,to:'armorcrew',tokens:99,keys:9,stationCooldown:0}).ok, first + ' sees planned armor crew without a playable vehicle class');
}
{
  const w=arena(),p=player(w,'soldier'),st={id:0,x:p.x,y:p.y,cooldown:0};
  w.map.stations=[st];p.tokens=23;
  t.check(w.upgrade(p,st,'medic').ok && p.tokens===15, 'first upgrade spends exactly eight of twenty-three tokens');
  st.cooldown=0;p.tokens=14;
  t.check(!w.upgrade(p,st,'commander').ok && p.tokens===14 && st.cooldown===0, 'fourteen tokens cannot buy level two or consume the station');
  p.tokens=15;
  t.check(w.upgrade(p,st,'commander').ok && p.tokens===0, 'second upgrade spends exactly fifteen tokens');
  t.check(p.upgradeFrom==='medic' && Rules.relation(p,'medic')==='owned' && Rules.relation(p,'sniper')==='branch', 'shared class remembers the actual selected ancestor');
  w.setClass(p,'commander',false);
  t.equal(p.upgradeFrom,'medic','reapplying the same shared class preserves its actual ancestor');
}
t.check(!CLASSES.armorcrew && W.CLASS_PLANNED.armorcrew.planned, 'vehicle-only armor crew remains a planned class');
t.check(W.CLASS_PLANNED.armorcrew.vehicleTraits.damage === 1.35 && W.CLASS_PLANNED.armorcrew.vehicleTraits.fireRate === 1.15 && W.CLASS_PLANNED.armorcrew.vehicleTraits.repair === 1.5 && W.CLASS_PLANNED.armorcrew.vehicleTraits.speed === 1.35 && W.CLASS_PLANNED.armorcrew.vehicleTraits.excludesPlanes, 'all future vehicle traits are recorded, with planes excluded');
t.equal(WEAPONS.deagle.damage, 45, 'all classes share the 45-damage Deagle');
t.check(Rules.shotgunDamage(0, WEAPONS.shotgun2) === 200 && Rules.shotgunDamage(560, WEAPONS.shotgun2) === 10, 'advanced shotgun damage spans 200 down to 10');

{
  const w = arena(true), medic = player(w, 'medic2', 4000, 4000, 1), mate = player(w, 'juggernaut', 4100, 4000, 1);
  const far = player(w, 'soldier', 4500, 4000, 1), foe = player(w, 'soldier', 4200, 4000, 2);
  medic.hp = 30; mate.hp = 70; far.hp = 10;
  t.check(w.useMedkit(medic), 'advanced medkit activates for hurt teammates');
  t.equal(medic.hp, 80, 'medic heals 50'); t.equal(mate.hp, 120, 'nearby teammate heals 50'); t.equal(far.hp, 10, 'out-of-range teammate is not healed');
  t.equal(medic.medkitCd, 50, 'advanced kit keeps the 50-second cooldown');
  t.check(!w.useMedkit(medic), 'medkit cannot be spammed during cooldown');
  medic.medkitCd = 0; w.downPlayer(mate, foe, 'ar');
  t.check(w.useMedkit(medic) && !mate.downed && mate.hp === 75, 'advanced kit revives a nearby juggernaut at half of 150 HP');
  w.downPlayer(mate, foe, 'ar'); mate.x = 4080;
  medic.controller = () => ({ mx: 0, my: 0, aimX: mate.x, aimY: mate.y, iv: true });
  run(w, 2.1);
  t.check(!mate.downed && mate.hp === 75, 'holding E also revives at half the teammate maximum HP');
}
{
  const w = arena(), p = player(w, 'sniper2'), e = player(w, 'soldier', 6000, 4000);
  t.check(p.weapons[0].ammo === 3 && WEAPONS.sniper2.zoom > WEAPONS.sniper.zoom, 'advanced sniper has three rounds and a wider scope');
  for (const distance of [0, 1050, 2100, 4000]) {
    e.hp = e.maxHp = 1000;
    w.bulletHit({ owner: p.id, weapon: 'sniper2', damage: 95, ox: p.x, oy: p.y, dx: 1, dy: 0 }, { player: e }, p.x + distance, p.y);
    t.near(1000 - e.hp, 95 + 205 * Math.min(1, distance / 2100), .11, 'sniper distance damage at ' + distance);
  }
  e.hp = e.maxHp = 1000; e.x = p.x + 3500;
  w.fireGun(p, WEAPONS.sniper2); run(w, 1);
  t.equal(e.hp, 700, 'a real sniper bullet travels past the old 2100-unit limit and deals 300');
  t.check(Number.isFinite(WEAPONS.sniper2.range) && !JSON.stringify(w.bullets).includes('null'), 'long-range projectiles remain JSON-safe');
}
{
  const w = arena(true), p = player(w, 'pyromancer', 4000, 4000, 1);
  const a = player(w, 'soldier', 4200, 3960, 2), b = player(w, 'soldier', 4200, 4040, 3), mate = player(w, 'soldier', 4120, 4000, 1);
  for (const o of [a,b,mate]) o.hp = o.maxHp = 5000;
  t.near(w.speedMul(p), .9, 1e-9, 'pyromancer moves ten percent slower');
  p.controller = () => ({ mx: 0, my: 0, aimX: 4500, aimY: 4000, fire: true });
  run(w, .5);
  const pulses = w.events.filter(e => e.type === 'flame');
  t.equal(pulses.slice(0, 4).map(e => e.damage).join(','), '10,15,20,25', 'flames ramp five damage per 0.15-second tick');
  t.check(a.hp < 5000 && a.hp === b.hp, 'flame cone splashes multiple enemies equally');
  t.equal(mate.hp, 5000, 'flame cone spares teammates');
  run(w, 1);
  t.equal(w.events.filter(e => e.type === 'flame').at(-1).damage, 50, 'flame damage caps at 50');
  idle(p); run(w, .2); t.equal(p.flameTicks, 0, 'releasing fire resets heat');
  p.controller = () => ({ mx: 0, my: 0, aimX: 4500, aimY: 4000, fire: true }); run(w, .05);
  t.equal(w.events.filter(e => e.type === 'flame').at(-1).damage, 10, 'a new flame burst starts at ten damage');
  w.switchSlot(p, 1); p.weapons[1].cooldown = 0;
  const before = p.stats.shots;
  p.controller = () => ({ mx: 0, my: 0, aimX: 4500, aimY: 4000, fire: true, firePressed: false }); run(w, 1.1);
  t.equal(p.stats.shots, before, 'holding the revolver without a fresh click does not fire');
  w.trigger(p, { fire: true, firePressed: true }); t.equal(p.weapons[1].ammo, 4, 'a deliberate revolver click uses one of five rounds');
}
{
  const w = arena(), p = player(w, 'juggernaut');
  t.check(p.maxHp === 150 && w.speedMul(p) === .75, 'juggernaut has 150 HP and 25% slower movement');
  p.controller = () => ({ mx: 0, my: 0, aimX: p.x + 1000, aimY: p.y, fire: true });
  run(w, .7); t.equal(p.stats.shots, 0, 'minigun cannot fire before spin-up');
  run(w, .05); t.equal(p.stats.shots, 1, 'minigun begins at 0.75 seconds');
  const before = p.stats.shots; run(w, 1); t.equal(p.stats.shots - before, 20, 'minigun sustains twenty shots per second at the 20Hz server tick');
  p.commandBuff = 10; run(w, .2); const boosted = p.stats.shots; run(w, 2); t.equal(p.stats.shots - boosted, 50, 'commander buff sustains twenty-five shots per second at 20Hz');
  idle(p); run(w, .1); t.equal(p.minigunSpin, 0, 'releasing minigun resets spin');
}
{
  const w = arena(true), p = player(w, 'commander', 4000, 4000, 1), mate = player(w, 'juggernaut', 4100, 4000, 1);
  const enemy = player(w, 'soldier', 4000, 4100, 2), out = player(w, 'soldier', 4700, 4000, 3);
  for (const o of [p,mate,enemy,out]) { o.hp = o.maxHp = 1000; }
  t.check(!w.useCommandRadar(p, {}) && p.commandCd === 0, 'invalid strike target does not consume commander cooldown');
  t.check(w.useCommandRadar(p, { aimX: 4000, aimY: 4000 }), 'command radar activates at the cursor');
  t.check(p.commandCd === 45 && p.fx.radar === 30 && p.commandBuff === 15 && mate.commandBuff === 15, 'radar, team buff and cooldown durations are exact');
  t.check(enemy.commandBuff === 0 && out.commandBuff === 0, 'rally does not buff enemies');
  t.near(w.speedMul(mate), .75 * 1.25, 1e-9, 'team speed buff multiplies juggernaut class speed');
  t.near(w.damageMul(mate), 1.25, 1e-9, 'team damage buff is 25 percent');
  t.check(!w.useCommandRadar(p, { aimX: 7000, aimY: 7000 }) && w.strikes.length === 1, 'cooldown prevents duplicate airstrikes');
  run(w, 4.9); t.equal(p.hp, 1000, 'airstrike does not arrive early');
  run(w, .15);
  t.check(p.hp === 500 && mate.hp === 500 && enemy.hp === 500, 'airstrike deals exactly 500 to self, teammate and enemy');
  t.equal(out.hp, 1000, 'players outside the 450 radius are safe');
  t.equal(w.strikes.length, 0, 'resolved airstrike leaves no pending strike');
  run(w, 10.1); t.check(p.commandBuff === 0 && mate.commandBuff === 0, 'team rally expires after fifteen seconds');
  t.near(w.damageMul(mate), 1, 1e-9, 'damage returns to normal after the rally');
}
{
  const w = arena(false, true), p = player(w, 'commander'), e = player(w, 'soldier', 4050, 4000);
  t.check(!w.useCommandRadar(p, { aimX: e.x, aimY: e.y }), 'remote mirror cannot activate authoritative commander abilities');
  w.addStrike({ kind: 'airstrike', x: 4000, y: 4000, t: .1, owner: p.id, team: p.team, radius: 450, damage: 500 });
  run(w, .2); t.equal(e.hp, 100, 'remote airstrikes wait for server damage');
}
t.done();
