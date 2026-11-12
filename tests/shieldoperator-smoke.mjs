// Exercise the actual shared damage/projectile paths, including frontal versus rear cover.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(), t = suite('Shield Operator');
function arena() {
  const map = { seed: 9, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [],
    pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], tanks: [], nextPickupId: 1 };
  const world = new W.World({ map, storm: false });
  const p = world.addPlayer({ x: 5000, y: 5000, classId: 'shieldoperator', team: 1 });
  const foe = world.addPlayer({ x: 5200, y: 5000, team: 2 });
  p.hp = p.maxHp = foe.hp = foe.maxHp = 1000;
  return { world, p, foe };
}
function hit(a, cause, x = 5100) {
  a.p.hp = 1000;
  a.world.damagePlayer(a.p, 40, a.foe.id, cause, a.p.x, a.p.y, { x, y: a.p.y });
  return 1000 - a.p.hp;
}
for (const slot of [0, 1]) {
  const a = arena(), { world, p } = a;
  world.switchSlot(p, slot); world.tickEffects(p, 0);
  t.check(p.shieldUp, 'slot ' + slot + ' raises its shield without a separate hold action');
  t.equal(world.speedMul(p), 0.25, 'slot ' + slot + ' retains the ordinary riot shield movement penalty');
  for (const cause of ['pistol', 'ar', 'sniper2', 'shotgun2', 'sentry', 'turret']) {
    t.equal(hit(a, cause), 0, cause + ' blocked by front of slot ' + slot);
    t.equal(hit(a, cause, 4900), 40, cause + ' still hits the back of slot ' + slot);
  }
  for (const cause of ['grenade', 'launcher', 'launcher2', 'sentry-grenades', 'sentry-rockets']) t.equal(hit(a, cause), slot === 1 ? 0 : 40, cause + ' requires the red shield');
  for (const cause of ['fire', 'flamethrower', 'snow', 'poison', 'lightning', 'meteor', 'airstrike', 'tank-cannon', 'tankmg', 'ram', 'sentry-fireballs', 'sentry-burn', 'sentry-cannons']) {
    t.equal(hit(a, cause), 40, cause + ' bypasses class shield slot ' + slot);
  }
  p.hp = 1000;
  world.explode(5100, 5000, W.WEAPONS.grenade.explosion, a.foe.id, 'grenade');
  t.check(slot === 1 ? p.hp === 1000 : p.hp < 1000, 'real grenade blast uses selected shield protection');
  world.itemBurst('flashbang', 5100, 5000, a.foe.id);
  t.check(slot === 1 ? p.fx.flash === 0 : p.fx.flash > 0, 'real frontal flashbang blocked only by red shield');
  p.fx.flash = 0;
  world.itemBurst('flashbang', 4900, 5000, a.foe.id);
  t.check(p.fx.flash > 0, 'rear flashbang affects either shield');
  p.items[0] = { id: 'bandage', n: 1 }; world.selectItem(p, 0);
  t.equal(hit(a, 'pistol'), 40, 'hotbar selection puts weapon shield away immediately');
  world.switchSlot(p, slot);
  t.equal(hit(a, 'pistol'), 0, 'returning to class slot restores frontal protection immediately');
  for (const flag of ['downed', 'mount', 'vehicle', 'dropT']) {
    p[flag] = flag === 'downed' ? true : 1;
    t.check(!world.activeShield(p), flag + ' prevents class shield protection');
    p[flag] = flag === 'downed' ? false : 0;
  }
}
{
  const { world, p, foe } = arena();
  p.controller = () => ({ fire: true, aimX: foe.x, aimY: foe.y });
  foe.controller = () => ({ fire: true, aimX: p.x, aimY: p.y });
  for (let i = 0; i < 228; i++) world.update(1 / 120);
  t.equal(p.stats.shots, 10, 'combined pistol fires its ten-round magazine');
  t.check(p.weapons[0].reloading, 'combined pistol automatically reloads after ten rounds');
  t.check(!world.activeShield(p), 'pistol has no shield protection during its actual automatic reload');
  const beforeReloadHit = p.hp;
  world.bullets = [];
  world.spawnShot(foe, W.WEAPONS.pistol, [Math.PI]); world.updateBullets(0.2);
  t.equal(beforeReloadHit - p.hp, W.WEAPONS.pistol.damage, 'actual frontal bullet hits while the pistol lowers its shield for reload');
  t.equal(foe.hp, 920, 'ten actual pistol hits deal ordinary eight damage each');
  p.controller = () => ({}); foe.controller = () => ({});
  for (let i = 0; i < 144; i++) world.update(1 / 120);
  t.check(p.weapons[0].ammo === 10 && !p.weapons[0].reloading, 'reload restores the ten-round pistol magazine');
  t.check(world.activeShield(p) && world.shieldBlocks(p, p.x + 100, p.y, 'pistol'), 'front shield protection returns after reload completes');
  world.switchSlot(p, 1); const shots = p.stats.shots;
  world.trigger(p, { fire: true, firePressed: true });
  t.equal(p.stats.shots, shots, 'explosive shield cannot fire the stowed pistol');
}
// Exercise excluded effects through their gameplay entry points, including the tank projectile path.
for (const slot of [0, 1]) {
  for (const kind of ['firenade', 'snowbomb', 'poison', 'blackhole', 'smoke']) {
    const { world, p, foe } = arena(); world.switchSlot(p, slot);
    world.itemBurst(kind, p.x + 60, p.y, foe.id);
    if (kind === 'firenade') {
      world.updateZones(0.25);
      t.equal(p.hp, 1000 - Math.round(W.ITEMS.firenade.dps * 0.25 * 10) / 10, 'slot ' + slot + ': fire grenade zone burns through the shield');
    } else if (kind === 'snowbomb') {
      world.updateZones(W.ITEMS.snowbomb.graceTime + 0.01);
      t.check(p.inSnow && p.hp < 1000, 'slot ' + slot + ': snowbomb slows and damages through the shield');
    } else if (kind === 'poison') {
      world.tickEffects(p, 0.5);
      t.check(p.fx.poison > 0 && p.hp === 1000 - W.ITEMS.poison.dps * 0.5, 'slot ' + slot + ': poison potion still poisons and damages');
    } else if (kind === 'blackhole') {
      t.equal(p.x, 5060, 'slot ' + slot + ': gravity grenade still pulls its victim');
    } else {
      t.check(world.zones.some(z => z.kind === 'smoke' && Math.hypot(p.x - z.x, p.y - z.y) < z.r), 'slot ' + slot + ': smoke remains over the shield carrier');
    }
  }
  for (const kind of ['lightning', 'meteor', 'airstrike']) {
    const { world, p, foe } = arena(); world.switchSlot(p, slot);
    world.addStrike({ kind, x: p.x + 10, y: p.y, target: kind === 'lightning' ? p.id : 0, t: 0.05,
      radius: 100, damage: 50, owner: foe.id, team: foe.team });
    world.updateStrikes(0.05);
    t.equal(p.hp, 950, 'slot ' + slot + ': real ' + kind + ' strike bypasses shield');
  }
  {
    const { world, p, foe } = arena(); world.switchSlot(p, slot);
    foe.angle = Math.PI;
    world.spawnShot(foe, W.WEAPONS.tankmg, [Math.PI]);
    world.updateBullets(0.2);
    t.equal(p.hp, 1000 - W.WEAPONS.tankmg.damage, 'slot ' + slot + ': actual tank machine-gun bullet bypasses frontal cover');
    world.tankShellImpact({ id: 1, owner: foe.id, vehicle: 0, team: foe.team }, { player: p }, p.x + 10, p.y);
    t.equal(p.hp, 1000 - W.WEAPONS.tankmg.damage - W.TANK.cannonMaxDamage, 'slot ' + slot + ': direct cannon hit still deals500 damage');
  }
  {
    const a = arena(); a.world.switchSlot(a.p, slot); a.p.angle = Math.PI / 2;
    const arc = W.ITEMS.riotshield.arc;
    const source = angle => ({ x: a.p.x + Math.cos(angle) * 100, y: a.p.y + Math.sin(angle) * 100 });
    const inside = source(a.p.angle + arc - 0.001), outside = source(a.p.angle + arc + 0.001);
    t.check(a.world.shieldBlocks(a.p, inside.x, inside.y, 'pistol'), 'slot ' + slot + ': protection follows rotated shield within its arc');
    t.check(!a.world.shieldBlocks(a.p, outside.x, outside.y, 'pistol'), 'slot ' + slot + ': shots just outside the forward arc remain exposed');
  }
}
{
  const { world, p } = arena();
  world.setClass(p, 'soldier', true); world.addItem(p, 'riotshield', 1); world.selectItem(p, 0);
  t.check(world.shieldBlocks(p, p.x + 100, p.y, 'grenade'), 'existing loot riot shield keeps its established frontal explosive protection');
  world.itemBurst('flashbang', p.x + 100, p.y, 0);
  t.check(p.fx.flash > 0, 'existing loot shield does not acquire the new red shield flashbang protection');
}
t.done();
