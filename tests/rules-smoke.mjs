// Class, weapon and upgrade rules exactly as designed.
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(['config']);
const t = suite('rules');
const { CLASSES, WEAPONS, CONFIG, Rules } = W;

// Lobby, stations, upgrades
t.equal(CONFIG.lobbySize, 50, 'lobby holds 50 players');
t.equal(CONFIG.stationCount, 9, 'nine stations remain after the seventy-five-percent reduction');
t.check(CONFIG.stationMinGap >= 500, 'stations keep their distance from each other');
t.equal(CONFIG.stationCooldown, 90, 'used station recharges for 1:30');
t.equal(CONFIG.upgradeCost, 8, 'first-tier upgrades cost eight tokens');
t.check(Rules.upgradeCostFor('sniper') === 8 && Rules.upgradeCostFor('sniper2') === 15, 'target tiers use eight and fifteen tokens');
t.check(Rules.nextUpgradeCost('soldier') === 8 && Rules.nextUpgradeCost('medic') === 15 && Rules.nextUpgradeCost('medic2') === 40 && Rules.nextUpgradeCost('engineer') === 0, 'next-tier cost follows all three upgrade levels');
t.equal(CONFIG.bushes, false, 'bushes are temporarily removed');
t.check(CONFIG.tokenLoose <= 50 && CONFIG.regularCrateCount === 210, 'sparse loose tokens and 210 regular crates');

// Soldier (starting class)
t.equal(CLASSES.soldier.hp, 100, 'soldier HP');
t.equal(CLASSES.soldier.armor, 0, 'soldier armor');
t.equal(CLASSES.soldier.loadout.join(), 'ar,pistol', 'soldier loadout');
t.equal(WEAPONS.ar.damage, 10, 'AR damage');
t.equal(WEAPONS.ar.mag, 20, 'AR magazine');
t.equal(WEAPONS.pistol.damage, 8, 'pistol damage');
t.equal(WEAPONS.pistol.mag, 10, 'pistol magazine');

// Lvl 1 classes
['sniper', 'shotgunner', 'medic', 'grenadier'].forEach((id) => {
  t.equal(CLASSES[id].tier, 1, id + ' is lvl 1');
  t.equal(CLASSES[id].parent, 'soldier', id + ' upgrades from soldier');
  t.equal(CLASSES[id].armor, 0, id + ' armor');
});
t.equal(CLASSES.sniper.hp, 95, 'sniper HP');
t.equal(CLASSES.sniper.loadout.join(), 'sniper,pistol', 'sniper loadout');
t.equal(WEAPONS.sniper.damage, 95, 'sniper rifle damage');
t.equal(WEAPONS.sniper.mag, 1, 'sniper rifle magazine');
t.check(WEAPONS.sniper.zoom > 1, 'sniper rifle can scope out');
t.equal(CLASSES.shotgunner.hp, 100, 'shotgunner HP');
t.equal(CLASSES.shotgunner.loadout.join(), 'shotgun,deagle', 'shotgunner loadout');
t.equal(WEAPONS.shotgun.mag, 5, 'shotgun magazine');
t.equal(WEAPONS.deagle.damage, 45, 'deagle damage');
t.equal(WEAPONS.deagle.mag, 6, 'deagle magazine');
t.equal(CLASSES.medic.hp, 100, 'medic HP');
t.equal(CLASSES.medic.loadout.join(), 'pistol,medkit', 'medic loadout: same pistol plus medkit');
t.equal(WEAPONS.medkit.heal, 30, 'medkit heals 30');
t.equal(WEAPONS.medkit.cooldown, 50, 'medkit 50 s cooldown');
t.equal(CLASSES.grenadier.hp, 100, 'grenadier HP');
t.equal(CLASSES.grenadier.loadout.join(), 'launcher,grenade', 'grenadier loadout');
t.equal(WEAPONS.grenade.count, 10, '10 hand grenades');
t.equal(WEAPONS.launcher.mag, 10, 'grenade launcher magazine');
t.equal(WEAPONS.grenade.explosion.maxDamage, 100, 'hand grenade up to 100');
t.equal(WEAPONS.launcher.explosion.maxDamage, 100 * 0.5 * 0.75, 'launcher grenade: half a hand grenade, then 25% less (37.5)');
t.equal(WEAPONS.launcher.landFuse, 0.5, 'launcher grenade bursts half a second after landing');

// Shotgun 5-115 by distance
const sg = WEAPONS.shotgun;
t.equal(Rules.shotgunDamage(0), 115, 'shotgun point blank');
t.equal(Rules.shotgunDamage(sg.pointBlank), 115, 'shotgun at point-blank edge');
t.equal(Rules.shotgunDamage(sg.range), 5, 'shotgun at max range');
t.equal(Rules.shotgunDamage(sg.range + 500), 5, 'shotgun never below 5');
let prev = Infinity, mono = true;
for (let d = 0; d <= sg.range; d += 10) { const v = Rules.shotgunDamage(d); if (v > prev) mono = false; prev = v; }
t.check(mono, 'shotgun damage only falls with distance');

// Grenades 0-100 by distance
t.equal(Rules.explosionDamage(100, 150, 0), 100, 'grenade at center');
t.equal(Rules.explosionDamage(100, 150, 75), 50, 'grenade halfway');
t.equal(Rules.explosionDamage(100, 150, 150), 0, 'grenade at edge');
t.equal(Rules.explosionDamage(WEAPONS.launcher.explosion.maxDamage, 150, 0), 38, 'launcher grenade at center (37.5 rounded)');
t.check(/37\.5/.test(Rules.weaponLine('launcher')) && /0\.5 s fuse/.test(Rules.weaponLine('launcher')), 'launcher stat line shows damage and fuse');

// Skill-tree upgrade rules
const ok = Rules.upgradeCheck({ from: 'soldier', to: 'sniper', tokens: 8, keys: 0, stationCooldown: 0 });
t.check(ok.ok && !ok.useKey && ok.cost === 8, 'soldier -> sniper with eight tokens at a ready station');
t.equal(Rules.upgradeCheck({ from: 'soldier', to: 'medic', tokens: 7, keys: 3, stationCooldown: 0 }).reason, 'tokens', 'first-tier upgrade needs eight tokens');
t.equal(Rules.upgradeCheck({ from: 'soldier', to: 'medic', tokens: 9, keys: 0, stationCooldown: 30 }).reason, 'cooldown', 'recharging station needs a key');
const withKey = Rules.upgradeCheck({ from: 'soldier', to: 'medic', tokens: 8, keys: 1, stationCooldown: 30 });
t.check(withKey.ok && withKey.useKey, 'station key skips the recharge');
t.equal(Rules.upgradeCheck({ from: 'sniper', to: 'medic', tokens: 50, keys: 5, stationCooldown: 0 }).reason, 'branch', 'other lvl 1 branches lock after choosing');
t.equal(Rules.relation('sniper', 'soldier'), 'owned', 'soldier is on the sniper path');
t.equal(Rules.relation('soldier', 'soldier'), 'current', 'current class');
t.equal(Rules.childClasses('soldier').join(), 'sniper,shotgunner,medic,grenadier', 'four lvl 1 choices');
t.equal(Rules.childClasses('sniper').length, 5, 'sniper has its matching upgrade and four active shared choices');

// Crates and items
const { CRATES, ITEMS } = W;
t.check(CONFIG.regularCrateCount === 210 && CONFIG.crateInBuilding < 0.7, '210 regular crates spread across the larger island');
t.near(W.CRATE_ORDER.reduce((s, id) => s + CRATES[id].share, 0), 1, 1e-9, 'crate tiers cover 100% of crates');
t.equal(W.CRATE_ORDER.map((id) => CRATES[id].share).join(), '0.8,0.1,0.08,0.02,0', 'regular crate mix 80/10/8/2 plus a reserved legendary');
t.equal(JSON.stringify(Rules.crateQuota(101)), JSON.stringify({ common: 80, rare: 10, epic: 8, mythic: 2, legendary: 1 }), '100 regular crates plus one central legendary');
t.equal(JSON.stringify(Rules.crateQuota(CONFIG.regularCrateCount + 1)), JSON.stringify({ common: 168, rare: 21, epic: 17, mythic: 4, legendary: 1 }), 'expanded island retains the regular crate odds with one central legendary');
t.equal(Rules.crateQuota(10).legendary, 1, 'even a tiny island gets one legendary crate');
t.equal(Rules.crateTokens('common', 0.5), 1, 'common crate: 1 token 90% of the time');
t.equal(Rules.crateTokens('common', 0.05), 2, 'common crate: 2 tokens 10% of the time');
t.check(Rules.crateTokens('rare', 0) === 2 && Rules.crateTokens('rare', 0.999) === 4, 'rare crate: 2 to 4 tokens');
t.equal(CRATES.common.armor, 0.05, 'crates grant an armor plate 5% of the time');
t.equal(Rules.crateLootTier('common', 0.1), 'common', 'common crate: 20% a common item');
t.equal(Rules.crateLootTier('common', 0.25), 'rare', 'common crate: 10% a rare item');
t.equal(Rules.crateLootTier('common', 0.33), 'epic', 'common crate: 5% an epic item');
t.equal(Rules.crateLootTier('common', 0.5), null, 'common crate: otherwise no item');
t.equal(JSON.stringify(CRATES.rare.loot), JSON.stringify({ common: 0.3, rare: 0.4, epic: 0.2, mythic: 0.1 }), 'rare crate item odds');
t.equal(JSON.stringify(CRATES.epic.loot), JSON.stringify({ rare: 0.5, epic: 0.3, mythic: 0.15, legendary: 0.05 }), 'epic crate item odds');
t.equal(JSON.stringify(CRATES.mythic.loot), JSON.stringify({ rare: 0.4, epic: 0.3, mythic: 0.2, legendary: 0.1 }), 'mythic crate item odds');
t.equal(Rules.crateLootTier('legendary', 0.99), 'legendary', 'legendary crates always hold a legendary item');
t.equal(Rules.itemsOfTier('common').join(), 'bandage,flashbang,grenade,smoke,smoothie,energybar', 'six common items');
t.equal(Rules.itemsOfTier('rare').join(), 'firenade,shieldo,firstaid,strength,speed,health,shield,poison,mystery', 'nine rare items (no gravity bomb)');
t.equal(Rules.itemsOfTier('epic').join(), 'drone,rock,riotshield,turret,sentry,blackhole,snowbomb,overheal', 'eight epic items');
t.equal(Rules.itemsOfTier('mythic').join(), 'invisibility,radar,teleporter,turret2,sentry2,lightning,power', 'seven mythic items');
t.equal(Rules.itemsOfTier('legendary').join(), 'turret3,sentry3,power2,meteor', 'four legendary items');
t.check(!ITEMS.gravitybomb, 'the gravity bomb is gone');
t.equal(CONFIG.hotbarSize, 3, 'three item slots accompany the two class slots');
t.check(Object.entries(CLASSES).every(([id, c]) => c.loadout.length + CONFIG.hotbarSize === (id === 'engineer' ? 6 : 5)), 'Engineer has six total slots and other classes keep five');
t.check(ITEMS.bandage.heal === 20 && ITEMS.bandage.found === 3, 'bandages: 20 HP, sets of 3');
t.check(ITEMS.smoothie.heal === 15 && ITEMS.energybar.speed === 0.15, 'smoothie 15 HP, energy bar +15% speed');
t.check(ITEMS.flashbang.radius === 150 && ITEMS.flashbang.fuse === WEAPONS.grenade.fuse, 'flash bang: grenade range and timing');
t.check(ITEMS.smoke.radius === 450 && ITEMS.firenade.radius === 300 && ITEMS.blackhole.radius === 450 && ITEMS.snowbomb.radius === 750, 'smoke 3x, fire 2x, black hole 3x, snowbomb 5x a grenade');
t.check(ITEMS.firenade.dps === 25 && ITEMS.firenade.duration === 5 && ITEMS.firenade.fuse === 0, 'fire: 25 HP/s for 5 s, no fuse');
t.check(ITEMS.shieldo.immune === 1 && ITEMS.shieldo.reduce === 0.5 && ITEMS.shieldo.reduceFor === 5, 'shieldo shieldo: 1 s immune then 50% for 5 s');
t.check(ITEMS.firstaid.heal === 100 && ITEMS.firstaid.over === 15, 'first aid kit: 100 HP over 15 s');
t.check(ITEMS.strength.damage === 0.1 && ITEMS.strength.duration === 30, 'strength +10% for 30 s');
t.check(ITEMS.speed.speed === 0.15 && ITEMS.speed.duration === 45, 'speed +15% for 45 s');
t.check(ITEMS.health.heal === 75 && ITEMS.shield.reduce === 0.15 && ITEMS.shield.duration === 30, 'health 75, shield 15% for 30 s');
t.check(ITEMS.poison.dps === 10 && ITEMS.poison.duration === 10 && ITEMS.poison.slow === 0.5, 'poison 10/s for 10 s, half speed');
t.check(ITEMS.drone.duration === 60 && ITEMS.radar.radius === 1050 && ITEMS.radar.duration === 30, 'drone 1 minute, radar 7 grenade radii');
t.check(ITEMS.riotshield.slow === 0.75, 'riot shield: 75% slower');
t.check(ITEMS.turret.hp === 100 && ITEMS.turret.damage === 15 && ITEMS.turret.fireInterval < WEAPONS.ar.fireInterval, 'turret: 100 HP, 15 dmg, faster than the AR');
t.check(ITEMS.sentry.hp === 50 && ITEMS.sentry.damage === 5 && ITEMS.sentry.fireInterval === WEAPONS.pistol.fireInterval, 'sentry: 50 HP, 5 dmg at pistol speed');
t.check(ITEMS.turret2.hp === 200 && ITEMS.turret2.damage === 20 && ITEMS.turret2.fireInterval === ITEMS.turret.fireInterval / 2, 'turret II: 200 HP, 20 dmg, twice the fire rate');
t.check(ITEMS.sentry2.hp === 100 && ITEMS.sentry2.damage === 10 && ITEMS.sentry2.fireInterval === ITEMS.sentry.fireInterval / 2, 'sentry II: doubled');
t.check(ITEMS.turret3.hp === 500 && ITEMS.turret3.damage === 30 && ITEMS.turret3.fireInterval === ITEMS.turret2.fireInterval, 'turret III: 500 HP, 30 dmg, turret II speed');
t.check(ITEMS.sentry3.hp === 700 && ITEMS.sentry3.damage === 30 && ITEMS.sentry3.fireInterval === ITEMS.turret.fireInterval, 'sentry III: 700 HP, 30 dmg, turret speed');
t.check(ITEMS.overheal.heal === 30 && ITEMS.overheal.overheal === 30, 'overheal: +30 up to 130');
t.check(ITEMS.invisibility.duration === 30, 'invisibility 30 s');
t.check(ITEMS.teleporter.found === 2 && ITEMS.teleporter.teamTime === 1 && ITEMS.teleporter.otherTime === 3, 'teleporters come in pairs: 1 s for your team, 3 s for others');
t.check(ITEMS.lightning.damage === 50 && ITEMS.lightning.delay === 1 && ITEMS.lightning.found === 5 && ITEMS.lightning.lock === 150, 'lightning: 50 dmg after 1 s, auto-aim one grenade radius, stacks of 5');
t.check(ITEMS.power.duration === 60 && ITEMS.power.damage === 0.15 && ITEMS.power.speed === 0.15 && ITEMS.power.reduce === 0.15, 'power potion: 1 minute of +15%/+15%/15%');
t.check(ITEMS.power2.duration === 75 && ITEMS.power2.deathImmune === 10, 'power potion II: 1:15 plus 10 s death immunity');
t.check(ITEMS.meteor.delay === 2 && ITEMS.meteor.damage === 99 && ITEMS.meteor.radius === 300, 'meteor: 2 s delay, 99 dmg, twice a grenade wide');
t.equal(Rules.mysteryPick(0.99), 'power', 'mystery potion can roll a power potion');
t.check(W.MYSTERY.some((m) => m.id === 'poison'), 'mystery potion can roll poison');
t.check(/Rare/.test(Rules.itemLine('firstaid')) && /100 HP over 15 s/.test(Rules.itemLine('firstaid')), 'item stat line');

// Modes and tree layout
t.equal(W.MODES.map((m) => m.id).join(), 'solo,duo,trio,squad', 'solo, duos, trios and squads');
t.equal(W.MODES.map((m) => m.size).join(), '1,2,3,4', 'team sizes');
t.check(W.CLASS_ORDER.every((id) => W.TREE_LAYOUT[id]), 'every class has a spot in the tree');

t.done();
