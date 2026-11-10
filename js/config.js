/* warz.io: tuning tables and pure rules shared by the game, the menu demo and the Node tests. */
(function () {
  'use strict';
  var W = window.Warz = window.Warz || {};

  W.VERSION = '0.1 test build';

  var CONFIG = W.CONFIG = {
    worldSize: 6400 * 3,        // three times the original width and height (nine times the area)
    cornerRadius: 760 * 3,
    mapAreaScale: 9,            // preserve terrain coverage across the larger island
    beach: 210,
    lobbySize: 50,
    viewArea: 1800 * 1013,      // world area visible on screen at normal zoom
    playerRadius: 24,
    playerSpeed: 270,
    playerAccel: 12,
    sprintSpeedMul: 1.5,
    staminaMax: 100,
    staminaDrain: 10,
    staminaWalkRegen: 15,
    staminaRestRegen: 30,
    staminaRestDelay: 1,
    projectileChargeTime: 0.75, // hold time for maximum grenade or launcher range
    pondSpeedMul: 0.62,
    upgradeCost: 8,             // first-tier compatibility value; use Rules.upgradeCostFor for a target class
    upgradeCosts: { 1: 8, 2: 15 },
    stationCooldown: 90,        // seconds before a used upgrade station works again
    stationCount: 9,            // 75% fewer upgrade stations than the previous 36
    stationMinGap: 520,
    tokenLoose: 40,             // tokens lying in the open
    keyLoose: 4,                // station keys lying in the open
    regularCrateCount: 90,      // about 50% more crates than the former ~60, plus one central legendary crate
    legendaryClearRadius: 240,  // an open approach to the single crate at the exact map centre
    crateInBuilding: 0.56,      // chance a building holds a crate (was 0.7)
    armorPlate: 25,             // armor granted by an armor plate pickup
    armorMax: 100,
    hotbarSize: 3,              // item slots; two class weapon/gear slots make five slots total
    bushes: false,              // temporarily removed
    dropStationCount: 16,
    dropStationRadius: 104,
    stationPadRadius: 54,
    stationCoreRadius: 28,
    stationInteractRadius: 100,
    crateSize: 52,
    crateHp: 100,
    pickupRadius: 34,
    magnetRadius: 120,
    dropDuration: 1.8,
    stormTick: 1
  };


  // Every gun has a magazine and reloads forever: ammo is infinite, magazines are not.
  var WEAPONS = W.WEAPONS = {
    ar: {
      id: 'ar', name: 'Basic AR', kind: 'gun',
      damage: 10, mag: 20, fireInterval: 0.115, reload: 1.7,
      bulletSpeed: 1900, range: 980, spread: 0.035, bulletRadius: 5.5, recoil: 10,
      blurb: 'Full-auto rifle. Hold the mouse to spray.'
    },
    pistol: {
      id: 'pistol', name: 'Basic Pistol', kind: 'gun',
      damage: 8, mag: 10, fireInterval: 0.2, reload: 1.15,
      bulletSpeed: 1750, range: 820, spread: 0.02, bulletRadius: 5, recoil: 6,
      blurb: 'Light sidearm with a quick reload.'
    },
    sniper: {
      id: 'sniper', name: 'Sniper Rifle', kind: 'gun',
      damage: 95, mag: 1, fireInterval: 0.25, reload: 2.2,
      bulletSpeed: 3800, range: 2100, spread: 0, bulletRadius: 5, recoil: 150, zoom: 1.3,
      blurb: 'One huge shot per reload. Hold right click to scope out for a wider view.'
    },
    shotgun: {
      id: 'shotgun', name: 'Shotgun', kind: 'gun',
      damageNear: 115, damageFar: 5, pointBlank: 70, mag: 5, fireInterval: 0.75, reload: 2.3,
      bulletSpeed: 1750, range: 560, spread: 0.2, pellets: 8, bulletRadius: 4.2, recoil: 160,
      blurb: 'Eight-pellet blast. 115 point blank, down to 5 at max range. One hit per target per blast.'
    },
    deagle: {
      id: 'deagle', name: 'Deagle', kind: 'gun',
      damage: 45, mag: 6, fireInterval: 0.42, reload: 1.7,
      bulletSpeed: 2500, range: 980, spread: 0.012, bulletRadius: 6.5, recoil: 60,
      blurb: 'Heavy pistol. Each hit deals 45 damage.'
    },
    launcher: {
      id: 'launcher', name: 'Grenade Launcher', kind: 'launcher',
      mag: 10, fireInterval: 0.6, reload: 2.5, projectileSpeed: 950, range: 660, minRange: 140,
      explosion: { maxDamage: 37.5, radius: 150 }, landFuse: 0.5, recoil: 70,
      blurb: 'Release to launch. Tap for a short shot; hold 0.75 seconds for maximum range. Bursts half a second after landing. 0–37.5 damage.'
    },
    grenade: {
      id: 'grenade', name: 'Grenades', kind: 'throwable',
      count: 10, cooldown: 0.6, fuse: 1.6, throwRange: 560,
      explosion: { maxDamage: 100, radius: 150 },
      blurb: '10 hand grenades. Release to throw: tap for short range, hold 0.75 seconds for maximum range. 100 damage at the center, 0 at the edge.'
    },
    medkit: {
      id: 'medkit', name: "Medic's Medkit", kind: 'medkit',
      heal: 30, cooldown: 50,
      blurb: 'Heals you for 30 HP, then recharges for 50 seconds.'
    },
    medkit2: { id: 'medkit2', name: 'Advanced Medkit', kind: 'medkit', heal: 50, cooldown: 50, reviveFraction: 0.5, blurb: 'Heals you and nearby teammates for 50 HP; revives nearby downed teammates at half maximum HP.' },
    shotgun2: { id: 'shotgun2', name: 'Shotgun II', kind: 'gun', damageNear: 200, damageFar: 10, pointBlank: 70, mag: 5, fireInterval: 0.75, reload: 2.3, bulletSpeed: 1750, range: 560, spread: 0.2, pellets: 8, bulletRadius: 4.2, recoil: 160, blurb: '10–200 damage by distance, with one hit per target per blast.' },
    sniper2: { id: 'sniper2', name: 'Sniper Rifle II', kind: 'gun', damage: 95, damageMax: 300, damageRampRange: 2100, mag: 3, fireInterval: 0.25, reload: 2.2, bulletSpeed: 3800, range: 1000000, unlimitedRange: true, spread: 0, bulletRadius: 5, recoil: 150, zoom: 1.65, blurb: 'Three shots and wider scope. Damage rises from 95 to 300 over 2100 units; shots cross the entire island.' },
    launcher2: { id: 'launcher2', name: 'Grenade Launcher II', kind: 'launcher', mag: 10, fireInterval: 0.6, reload: 2.5, projectileSpeed: 1100, range: 700, minRange: 140, explosion: { maxDamage: 70, radius: 150, demolition: true }, landFuse: 0.2, demolition: true, recoil: 80, blurb: 'Release to launch; hold 0.75 seconds for maximum range. 70 maximum blast damage, a 0.2-second landing fuse, and one-hit demolition of rocks and crates.' },
    flamethrower: { id: 'flamethrower', name: 'Flamethrower', kind: 'flame', damage: 10, damageMax: 50, damageStep: 5, fireInterval: 0.15, range: 375, halfAngle: 0.45, mag: 100, reload: 2.5, recoil: 0, blurb: 'A flame cone hits every enemy inside. Each 0.15-second tick grows from 10 to 50 damage; releasing fire resets the heat.' },
    revolver: { id: 'revolver', name: 'Heavy Revolver', kind: 'gun', damage: 75, mag: 5, fireInterval: 0.9, reload: 2.3, semiAuto: true, bulletSpeed: 2300, range: 980, spread: 0.015, bulletRadius: 7, recoil: 80, blurb: 'Five rounds, 75 damage. Slow, deliberate shots: click once per shot.' },
    minigun: { id: 'minigun', name: 'Minigun', kind: 'gun', damage: 5, mag: 100, fireInterval: 0.05, reload: 3.5, bulletSpeed: 1900, range: 900, spread: 0.12, bulletRadius: 4.5, recoil: 5, windup: 0.75, blurb: 'Hold fire to spin up for 0.75 seconds, then fire 20 rounds per second with moderate spread.' },
    commandpistol: { id: 'commandpistol', name: 'Command Pistol', kind: 'gun', damage: 15, mag: 12, fireInterval: 0.2, reload: 1.15, bulletSpeed: 1750, range: 820, spread: 0.02, bulletRadius: 5, recoil: 6, blurb: 'Twelve rounds, 15 damage each.' },
    commandradar: { id: 'commandradar', name: 'Command Radar', kind: 'ability', cooldown: 45, duration: 15, radarDuration: 30, radius: 1050, bonus: 0.25, strikeRadius: 225, strikeDelay: 5, strikeDamage: 250, blurb: 'Radar plus 15 seconds of +25% team damage, speed and fire rate. Marks the cursor for an airstrike in 5 seconds: 250 damage to everyone inside, including your team.' },
    // Bullets fired from a mounted turret (damage comes from the turret item).
    turret: {
      id: 'turret', name: 'Turret', kind: 'turret',
      damage: 15, bulletSpeed: 1900, range: 1100, spread: 0.03, bulletRadius: 6, recoil: 0,
      blurb: 'Mounted gun.'
    }
  };

  var CLASSES = W.CLASSES = {
    soldier: {
      id: 'soldier', name: 'Soldier', tier: 0, parent: null, hp: 100, armor: 0,
      loadout: ['ar', 'pistol'], color: '#6caaff',
      description: 'Everyone drops in as a Soldier: a full-auto Basic AR backed by a Basic Pistol.'
    },
    sniper: {
      id: 'sniper', name: 'Sniper', tier: 1, parent: 'soldier', hp: 95, armor: 0,
      loadout: ['sniper', 'pistol'], color: '#66efb3',
      description: 'Gives up 5 HP for a Sniper Rifle that hits for 95 from across the screen. One round per reload, so make it count.'
    },
    shotgunner: {
      id: 'shotgunner', name: 'Shotgunner', tier: 1, parent: 'soldier', hp: 100, armor: 0,
      loadout: ['shotgun', 'deagle'], color: '#ff9a48',
      description: 'Built for close fights. The Shotgun hits for up to 115 point blank, and the Deagle finishes the job at 45 a shot.'
    },
    medic: {
      id: 'medic', name: 'Medic', tier: 1, parent: 'soldier', hp: 100, armor: 0,
      loadout: ['pistol', 'medkit'], color: '#ff6b9e',
      description: 'Basic Pistol plus a Medic’s Medkit that heals 30 HP every 50 seconds. Healing and reviving teammates unlocks when multiplayer launches.'
    },
    grenadier: {
      id: 'grenadier', name: 'Grenadier', tier: 1, parent: 'soldier', hp: 100, armor: 0,
      loadout: ['launcher', 'grenade'], color: '#ffd568',
      description: 'Explosives expert. A Grenade Launcher with endless grenades that burst half a second after landing (up to 37.5 per blast) plus 10 hand grenades (up to 100).'
    }
  };
  Object.assign(CLASSES, {
    medic2: { id: 'medic2', name: 'Medic II', tier: 2, parent: 'medic', hp: 100, armor: 0, loadout: ['deagle', 'medkit2'], color: '#ff87b4', reviveSeconds: 2, reviveFraction: 0.5, description: 'Deagle and an advanced medkit. Heal 50 HP; revive teammates at half their maximum health.' },
    shotgunner2: { id: 'shotgunner2', name: 'Shotgunner II', tier: 2, parent: 'shotgunner', hp: 135, armor: 0, loadout: ['shotgun2', 'deagle'], color: '#ffae60', description: '135 HP, a 10–200 damage shotgun, and a 45-damage Deagle.' },
    grenadier2: { id: 'grenadier2', name: 'Grenadier II', tier: 2, parent: 'grenadier', hp: 115, armor: 0, loadout: ['launcher2', 'grenade'], color: '#ffe47b', description: '115 HP and 70-damage launcher blasts with a faster fuse. Demolishes rocks and crates in one blast.' },
    sniper2: { id: 'sniper2', name: 'Sniper II', tier: 2, parent: 'sniper', hp: 95, armor: 0, loadout: ['sniper2', 'pistol'], color: '#9bffd0', description: 'Three-round rifle, wider scope and unlimited reach. Damage grows from 95 nearby to 300 at long range.' },
    pyromancer: { id: 'pyromancer', name: 'Pyromancer', tier: 2, parent: 'grenadier', hp: 135, armor: 0, speed: 0.9, loadout: ['flamethrower', 'revolver'], color: '#ff643b', description: '135 HP, 10% slower. A ramping flame cone burns groups; a 75-damage revolver covers longer shots.' },
    juggernaut: { id: 'juggernaut', name: 'Juggernaut', tier: 2, parent: 'shotgunner', hp: 150, armor: 0, speed: 0.75, loadout: ['minigun', 'pistol'], color: '#b1bdce', description: '150 HP, 25% slower. Spin up the minigun for 0.75 seconds to unleash 20 five-damage shots per second.' },
    commander: { id: 'commander', name: 'Commander', tier: 2, parent: 'sniper', hp: 100, armor: 0, loadout: ['commandpistol', 'commandradar'], color: '#a78bfa', description: 'A 15-damage pistol and command radar. Rally your team and call a delayed airstrike at the cursor. Airstrikes hit allies too.' }
  });
  W.CLASS_ORDER = ['soldier', 'sniper', 'shotgunner', 'medic', 'grenadier', 'sniper2', 'commander', 'shotgunner2', 'juggernaut', 'medic2', 'grenadier2', 'pyromancer'];
  W.CLASS_PLANNED = { armorcrew: { id: 'armorcrew', name: 'Armor Crewmember', tier: 2, parent: 'medic', planned: true, vehicleTraits: { damage: 1.35, fireRate: 1.15, repair: 1.5, speed: 1.35, excludesPlanes: true }, description: 'Reserved for vehicles: +35% damage, +15% fire rate, +50% repair and +35% speed. Planes excluded.' } };
  ['pyromancer', 'juggernaut', 'commander'].forEach(function (id) { CLASSES[id].parents = ['sniper', 'shotgunner', 'medic', 'grenadier']; });
  W.CLASS_PLANNED.armorcrew.parents = ['sniper', 'shotgunner', 'medic', 'grenadier'];

  // Crate tiers. `share` divides the regular crates (80/10/8/2); the one central legendary is separate. `tokens` is the drop range,
  // `armor` the chance of an armor plate, and `loot` the chance of an item of each rarity (one roll, one item at most).
  var CRATES = W.CRATES = {
    common: { id: 'common', name: 'Crate', share: 0.80, tokens: [1, 2], tokenBonus: 0.1, armor: 0.05, key: 0.05, hp: 100,
      loot: { common: 0.20, rare: 0.10, epic: 0.05 }, color: '#c98f45', edge: '#86561f', dark: '#a8722f' },
    rare: { id: 'rare', name: 'Rare Crate', share: 0.10, tokens: [2, 4], armor: 0.05, key: 0.08, hp: 120,
      loot: { common: 0.30, rare: 0.40, epic: 0.20, mythic: 0.10 }, color: '#4fa3ff', edge: '#1f5ea8', dark: '#3a82d6' },
    epic: { id: 'epic', name: 'Epic Crate', share: 0.08, tokens: [3, 5], armor: 0.05, key: 0.10, hp: 140,
      loot: { rare: 0.50, epic: 0.30, mythic: 0.15, legendary: 0.05 }, color: '#b06cff', edge: '#6b3bb3', dark: '#9252e0' },
    mythic: { id: 'mythic', name: 'Mythic Crate', share: 0.02, tokens: [4, 6], armor: 0.05, key: 0.12, hp: 160,
      loot: { rare: 0.40, epic: 0.30, mythic: 0.20, legendary: 0.10 }, color: '#ff5a8a', edge: '#b02a58', dark: '#e0456f' },
    legendary: { id: 'legendary', name: 'Legendary Crate', share: 0, tokens: [6, 8], armor: 0.05, key: 0.15, hp: 200,
      loot: { legendary: 1 }, color: '#ffb020', edge: '#b86a00', dark: '#e59a10' }
  };
  W.CRATE_ORDER = ['common', 'rare', 'epic', 'mythic', 'legendary'];
  W.TIERS = {
    common: { name: 'Common', color: '#e4e9f2', ink: '#5b6982' },
    rare: { name: 'Rare', color: '#4fa3ff', ink: '#1f5ea8' },
    epic: { name: 'Epic', color: '#b06cff', ink: '#6b3bb3' },
    mythic: { name: 'Mythic', color: '#ff5a8a', ink: '#b02a58' },
    legendary: { name: 'Legendary', color: '#ffb020', ink: '#b86a00' }
  };

  // Items found in crates. kind: consume (eat or drink now) | throw (lands at the cursor) | place (build at the cursor)
  // | hold (held up while selected) | target (click a spot) | use (switches on for a while). `stack` is the most per
  // hotbar slot, `found` how many a crate gives. Distances are world units; a hand grenade bursts in a 150 radius (G).
  var G = WEAPONS.grenade.explosion.radius;
  var ITEMS = W.ITEMS = {
    bandage: { id: 'bandage', name: 'Bandages', tier: 'common', kind: 'consume', heal: 20, stack: 9, found: 3, blurb: 'Patch up for 20 HP. Found in sets of 3.' },
    flashbang: { id: 'flashbang', name: 'Flash Bang', tier: 'common', kind: 'throw', fuse: WEAPONS.grenade.fuse, radius: G, flash: 2.5, stack: 3, found: 1,
      blurb: 'Bursts like a grenade. Anyone caught in the blast sees white for a moment.' },
    grenade: { id: 'grenade', name: 'Grenade', tier: 'common', kind: 'throw', fuse: WEAPONS.grenade.fuse, radius: G, explosion: WEAPONS.grenade.explosion, stack: 5, found: 2,
      blurb: 'Just like the Grenadier’s: 0–100 damage, 1.6 s fuse. Found in pairs.' },
    smoke: { id: 'smoke', name: 'Smoke Grenade', tier: 'common', kind: 'throw', fuse: WEAPONS.grenade.fuse, radius: G * 3, duration: 12, stack: 3, found: 1,
      blurb: 'Fills an area three grenades wide with smoke nobody can see through. Lasts 12 s.' },
    smoothie: { id: 'smoothie', name: 'Smoothie', tier: 'common', kind: 'consume', heal: 15, stack: 5, found: 1, blurb: 'Drink for 15 HP.' },
    energybar: { id: 'energybar', name: 'Energy Bar', tier: 'common', kind: 'consume', effect: 'energy', duration: 20, speed: 0.15, stack: 5, found: 1,
      blurb: '+15% movement speed for 20 s.' },

    firenade: { id: 'firenade', name: 'Grenade of Fire', tier: 'rare', kind: 'throw', fuse: 0, radius: G * 2, duration: 5, dps: 25, stack: 3, found: 1,
      blurb: 'Bursts on landing into a wall of fire two grenades wide. 25 damage per second inside, for 5 s.' },
    shieldo: { id: 'shieldo', name: 'Shieldo Shieldo', tier: 'rare', kind: 'consume', effect: 'shieldo', immune: 1, reduce: 0.5, reduceFor: 5, stack: 3, found: 1,
      blurb: 'Immune to all weapons (not the storm) for 1 s, then 50% less damage for 5 s.' },
    firstaid: { id: 'firstaid', name: 'First Aid Kit', tier: 'rare', kind: 'consume', heal: 100, over: 15, stack: 3, found: 1,
      blurb: 'Heals 100 HP over 15 seconds.' },
    strength: { id: 'strength', name: 'Strength Potion', tier: 'rare', kind: 'consume', effect: 'strength', duration: 30, damage: 0.10, stack: 3, found: 1, blurb: '+10% damage for 30 s.' },
    speed: { id: 'speed', name: 'Speed Potion', tier: 'rare', kind: 'consume', effect: 'speed', duration: 45, speed: 0.15, stack: 3, found: 1, blurb: '+15% movement speed for 45 s.' },
    health: { id: 'health', name: 'Health Potion', tier: 'rare', kind: 'consume', heal: 75, stack: 3, found: 1, blurb: 'Heals 75 HP instantly.' },
    shield: { id: 'shield', name: 'Shield Potion', tier: 'rare', kind: 'consume', effect: 'shield', duration: 30, reduce: 0.15, stack: 3, found: 1, blurb: 'Take 15% less damage for 30 s.' },
    poison: { id: 'poison', name: 'Poison Potion', tier: 'rare', kind: 'throw', fuse: 0, radius: G, effect: 'poison', duration: 10, dps: 10, slow: 0.5, stack: 3, found: 1,
      blurb: 'Shatters where it lands. Enemies splashed take 10 damage per second for 10 s and move at half speed.' },
    mystery: { id: 'mystery', name: 'Mystery Potion', tier: 'rare', kind: 'consume', mystery: true, stack: 3, found: 1,
      blurb: 'A random potion effect. Could be great. Could be poison.' },

    drone: { id: 'drone', name: 'Drone', tier: 'epic', kind: 'use', effect: 'drone', duration: 60, stack: 2, found: 1,
      blurb: 'Shows every player on the island to you and your team for 1 minute.' },
    rock: { id: 'rock', name: 'Rock', tier: 'epic', kind: 'place', struct: 'rock', radius: 116, reach: 280, stack: 3, found: 1,
      blurb: 'Place a huge boulder that blocks everyone. You or a teammate can reclaim it with the interact key.' },
    riotshield: { id: 'riotshield', name: 'Riot Shield', tier: 'epic', kind: 'hold', arc: 1.25, slow: 0.75, stack: 1, found: 1,
      blurb: 'Hold it up to block everything coming at your front. You move 75% slower while it is up.' },
    turret: { id: 'turret', name: 'Turret', tier: 'epic', kind: 'place', struct: 'turret', hp: 100, damage: 15, fireInterval: 0.09, reach: 150, stack: 2, found: 1,
      blurb: 'Place it, then press your interact key next to it to mount it. 15 damage per bullet, faster than an AR, infinite ammo. You cannot move while mounted.' },
    sentry: { id: 'sentry', name: 'Sentry', tier: 'epic', kind: 'place', struct: 'sentry', hp: 50, damage: 5, fireInterval: WEAPONS.pistol.fireInterval, range: 720, reach: 150, stack: 2, found: 1,
      blurb: 'An automatic gun that never misses: 5 damage at pistol speed, no reloads. 50 HP.' },
    blackhole: { id: 'blackhole', name: 'Black Hole Grenade', tier: 'epic', kind: 'throw', fuse: 0, radius: G * 3, stack: 2, found: 1,
      blurb: 'Bursts on landing and sucks every enemy (and everything loose) within three grenade radii into its middle.' },
    snowbomb: { id: 'snowbomb', name: 'Snowbomb', tier: 'epic', kind: 'throw', fuse: WEAPONS.grenade.fuse, radius: G * 5, duration: 10, slow: 0.5, graceTime: 4, stack: 2, found: 1,
      blurb: 'A blizzard five grenades wide for 10 s. Everyone inside moves at half speed, and after 4 s takes storm damage.' },
    overheal: { id: 'overheal', name: 'Overheal Potion', tier: 'epic', kind: 'consume', heal: 30, overheal: 30, stack: 3, found: 1,
      blurb: '+30 HP, even past your maximum (up to 130).' },

    invisibility: { id: 'invisibility', name: 'Invisibility Potion', tier: 'mythic', kind: 'consume', effect: 'invisible', duration: 30, stack: 2, found: 1,
      blurb: 'Vanish for 30 s. Only your team can see you.' },
    radar: { id: 'radar', name: 'Radar', tier: 'mythic', kind: 'use', effect: 'radar', duration: 30, radius: G * 7, stack: 2, found: 1,
      blurb: 'Pings every player within seven grenade radii of you for 30 s.' },
    teleporter: { id: 'teleporter', name: 'Teleporter', tier: 'mythic', kind: 'place', struct: 'teleporter', radius: 36, reach: 170, stack: 4, found: 2, teamTime: 1, otherTime: 3,
      blurb: 'Comes in pairs. Place both pads, then stand on one for 1 s (3 s for anyone else) to pop out at the other.' },
    turret2: { id: 'turret2', name: 'Turret II', tier: 'mythic', kind: 'place', struct: 'turret', hp: 200, damage: 20, fireInterval: 0.045, reach: 150, stack: 2, found: 1,
      blurb: 'Double the HP and twice the fire rate of a Turret, 20 damage per bullet.' },
    sentry2: { id: 'sentry2', name: 'Sentry II', tier: 'mythic', kind: 'place', struct: 'sentry', hp: 100, damage: 10, fireInterval: WEAPONS.pistol.fireInterval / 2, range: 720, reach: 150, stack: 2, found: 1,
      blurb: 'Double everything: 100 HP, 10 damage, twice the fire rate.' },
    lightning: { id: 'lightning', name: 'Lightning Strike', tier: 'mythic', kind: 'target', delay: 1, damage: 50, lock: G, range: 1400, stack: 10, found: 5,
      blurb: 'Click on an enemy: one second later lightning hits them for 50, straight through shields, armor and overheal. Found in stacks of 5.' },
    power: { id: 'power', name: 'Power Potion', tier: 'mythic', kind: 'consume', effect: 'power', duration: 60, damage: 0.15, speed: 0.15, reduce: 0.15, stack: 2, found: 1,
      blurb: '+15% damage, +15% speed and 15% less damage taken for 1 minute.' },

    turret3: { id: 'turret3', name: 'Turret III', tier: 'legendary', kind: 'place', struct: 'turret', hp: 500, damage: 30, fireInterval: 0.045, reach: 150, stack: 1, found: 1,
      blurb: '500 HP, 30 damage per bullet, Turret II fire rate.' },
    sentry3: { id: 'sentry3', name: 'Sentry III', tier: 'legendary', kind: 'place', struct: 'sentry', hp: 700, damage: 30, fireInterval: 0.09, range: 720, reach: 150, stack: 1, found: 1,
      blurb: '700 HP and 30 damage at Turret speed. It never misses.' },
    power2: { id: 'power2', name: 'Power Potion II', tier: 'legendary', kind: 'consume', effect: 'power', duration: 75, damage: 0.15, speed: 0.15, reduce: 0.15, deathImmune: 10, stack: 1, found: 1,
      blurb: 'Power Potion for 1:15, plus 10 s of death immunity: a killing blow leaves you at 30 HP instead, and the potion wears off.' },
    meteor: { id: 'meteor', name: 'Meteor Launcher', tier: 'legendary', kind: 'target', delay: 2, damage: 99, radius: G * 2, lock: G, range: 1400, stack: 3, found: 3,
      blurb: 'Click a spot: two seconds later a giant meteor lands there for 99 damage across two grenade radii. 3 meteors.' }
  };
  W.ITEM_ORDER = Object.keys(ITEMS);
  W.MYSTERY = [
    { id: 'strength', w: 15 }, { id: 'speed', w: 15 }, { id: 'health', w: 15 }, { id: 'shield', w: 15 }, { id: 'poison', w: 15 },
    { id: 'overheal', w: 10 }, { id: 'invisibility', w: 8 }, { id: 'power', w: 7 }
  ];

  // Class tree layout in a 1000 x 600 box. Vehicle-only Armor Crewmember remains a planned node.
  W.TREE_LAYOUT = {
    soldier: { x: 500, y: 510 },
    sniper: { x: 140, y: 305 }, shotgunner: { x: 380, y: 305 }, medic: { x: 620, y: 305 }, grenadier: { x: 860, y: 305 },
    sniper2: { x: 80, y: 78 }, commander: { x: 200, y: 78 }, shotgunner2: { x: 320, y: 78 }, juggernaut: { x: 440, y: 78 },
    medic2: { x: 560, y: 78 }, grenadier2: { x: 800, y: 78 }, pyromancer: { x: 920, y: 78 }
  };
  W.TREE_SOON = [
    { id: 'armorcrew', parent: 'medic', x: 680, y: 78, name: 'Armor Crewmember' }
  ];

  W.MODES = [
    { id: 'solo', name: 'Solo', size: 1, blurb: 'Just you against the lobby.' },
    { id: 'duo', name: 'Duos', size: 2, blurb: 'Teams of two.' },
    { id: 'trio', name: 'Trios', size: 3, blurb: 'Teams of three.' },
    { id: 'squad', name: 'Squads', size: 4, blurb: 'Teams of four.' }
  ];

  // Storm schedule in seconds after the match starts.
  W.STORM = [
    { start: 150, end: 195, radius: 2500, dps: 1 },
    { start: 245, end: 285, radius: 1600, dps: 2 },
    { start: 330, end: 365, radius: 950, dps: 4 },
    { start: 405, end: 435, radius: 520, dps: 7 },
    { start: 470, end: 495, radius: 230, dps: 10 },
    { start: 525, end: 555, radius: 0, dps: 15 }
  ];

  // Barrel shapes in multiples of the player radius, shared by the canvas renderer and the SVG icons.
  W.BARRELS = {
    ar: { parts: [{ x: 0.2, len: 1.75, h: 0.5 }] },
    pistol: { parts: [{ x: 0.2, len: 1.25, h: 0.42 }] },
    sniper: { parts: [{ x: 0.2, len: 2.3, h: 0.34 }, { x: 0.62, len: 0.6, h: 0.66 }] },
    shotgun: { trap: { x: 0.2, len: 1.5, h0: 0.5, h1: 0.86 } },
    deagle: { parts: [{ x: 0.2, len: 1.4, h: 0.56 }] },
    launcher: { parts: [{ x: 0.2, len: 1.5, h: 0.8 }, { x: 1.28, len: 0.22, h: 0.94 }] },
    grenade: { held: 'grenade' },
    medkit: { held: 'medkit' },
    turret: { parts: [{ x: 0.3, len: 2.1, h: 0.5 }] },
    sentry: { parts: [{ x: 0.3, len: 1.6, h: 0.4 }] }
  };
  W.BARRELS.medkit2 = { held: 'medkit' };
  W.BARRELS.shotgun2 = { trap: { x: 0.2, len: 1.75, h0: 0.6, h1: 1.05 } };
  W.BARRELS.sniper2 = { parts: [{ x: 0.2, len: 2.65, h: 0.36 }, { x: 0.7, len: 0.8, h: 0.72 }] };
  W.BARRELS.launcher2 = { parts: [{ x: 0.2, len: 1.75, h: 0.92 }, { x: 1.55, len: 0.3, h: 1.1 }] };
  W.BARRELS.flamethrower = { parts: [{ x: 0.2, len: 1.6, h: 0.65 }, { x: 1.3, len: 0.5, h: 0.9 }] };
  W.BARRELS.revolver = { parts: [{ x: 0.2, len: 1.6, h: 0.5 }, { x: 0.5, len: 0.5, h: 0.75 }] };
  W.BARRELS.minigun = { parts: [{ x: 0.2, len: 2.0, h: 0.85 }, { x: 1.7, len: 0.4, h: 1.05 }] };
  W.BARRELS.commandpistol = { parts: [{ x: 0.2, len: 1.4, h: 0.5 }] };
  W.BARRELS.commandradar = { parts: [{ x: 0.25, len: 0.85, h: 0.9 }] };
  W.muzzleLength = function (weaponId) {
    var b = W.BARRELS[weaponId], max = 1.2;
    if (b && b.parts) b.parts.forEach(function (p) { max = Math.max(max, p.x + p.len); });
    if (b && b.trap) max = b.trap.x + b.trap.len;
    return max;
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  var Rules = W.Rules = {
    shotgunDamage: function (distance, weapon) {
      var w = weapon || WEAPONS.shotgun;
      var t = clamp((distance - w.pointBlank) / (w.range - w.pointBlank), 0, 1);
      return Math.round(w.damageNear + (w.damageFar - w.damageNear) * t);
    },
    explosionDamage: function (maxDamage, radius, distance) {
      if (distance >= radius) return 0;
      return Math.round(maxDamage * (1 - Math.max(0, distance) / radius));
    },
    classParents: function (id) {
      var c = CLASSES[id] || W.CLASS_PLANNED[id];
      return c ? c.parents || (c.parent ? [c.parent] : []) : [];
    },
    upgradeCostFor: function (id) {
      var c = CLASSES[typeof id === 'object' ? id.classId : id] || W.CLASS_PLANNED[id];
      return c ? (CONFIG.upgradeCosts[c.tier] || 0) : 0;
    },
    childClasses: function (classId) {
      if (typeof classId === 'object') classId = classId.classId;
      return W.CLASS_ORDER.filter(function (id) { return Rules.classParents(id).indexOf(classId) >= 0; });
    },
    nextClasses: function (classId) { return Rules.childClasses(classId); },
    nextUpgradeCost: function (classId) {
      var children = Rules.childClasses(classId);
      return children.length ? Rules.upgradeCostFor(children[0]) : 0;
    },
    // current | owned (an earlier class on your path) | available | branch (locked by your choice) | locked
    relation: function (current, target) {
      var player = typeof current === 'object' ? current : null;
      if (player) current = player.classId;
      if (!CLASSES[current] || !CLASSES[target]) return 'locked';
      if (current === target) return 'current';
      var walk = CLASSES[current];
      while (walk && walk.parent) {
        var parent = walk.id === current && player && player.upgradeFrom ? player.upgradeFrom : walk.parent;
        if (parent === target) return 'owned';
        walk = CLASSES[parent];
      }
      if (Rules.classParents(target).indexOf(current) >= 0) return 'available';
      if (CLASSES[target].tier <= CLASSES[current].tier) return 'branch';
      return 'locked';
    },
    upgradeCheck: function (o) {
      if (!CLASSES[o.to] || !CLASSES[o.from]) return { ok: false, reason: 'unknown' };
      var rel = Rules.relation(o.from, o.to);
      if (rel !== 'available') return { ok: false, reason: rel };
      var cost = Rules.upgradeCostFor(o.to);
      if (o.tokens < cost) return { ok: false, reason: 'tokens', need: cost - o.tokens, cost: cost };
      if (o.stationCooldown > 0 && o.keys < 1) return { ok: false, reason: 'cooldown' };
      return { ok: true, useKey: o.stationCooldown > 0, cost: cost };
    },
    itemsOfTier: function (tier) {
      return W.ITEM_ORDER.filter(function (id) { return ITEMS[id].tier === tier; });
    },
    // One loot roll for a broken crate: the rarity that drops, or null, from a number in [0,1).
    crateLootTier: function (crateTier, roll) {
      var table = CRATES[crateTier].loot, acc = 0, tiers = W.CRATE_ORDER;
      for (var i = 0; i < tiers.length; i++) {
        var p = table[tiers[i]] || 0;
        acc += p;
        if (p > 0 && roll < acc) return tiers[i];
      }
      return null;
    },
    crateTokens: function (crateTier, roll) {
      var c = CRATES[crateTier];
      if (c.tokenBonus !== undefined) return roll < c.tokenBonus ? c.tokens[1] : c.tokens[0];
      return c.tokens[0] + Math.floor(roll * (c.tokens[1] - c.tokens[0] + 1));
    },
    // `total` includes the single central legendary. Largest remainders keep
    // the remaining crates as close as possible to 80/10/8/2 without losing crates.
    crateQuota: function (total) {
      total = Math.max(0, Math.floor(Number(total) || 0));
      var out = { common: 0, rare: 0, epic: 0, mythic: 0, legendary: total > 0 ? 1 : 0 };
      var count = Math.max(0, total - out.legendary), used = 0;
      var fractions = W.CRATE_ORDER.filter(function (tier) { return tier !== 'legendary'; }).map(function (tier, order) {
        var exact = count * CRATES[tier].share, n = Math.floor(exact);
        out[tier] = n; used += n;
        return { tier: tier, fraction: exact - n, order: order };
      });
      fractions.sort(function (a, b) { return b.fraction - a.fraction || a.order - b.order; });
      for (var i = 0; i < count - used; i++) out[fractions[i].tier]++;
      return out;
    },
    // Pick a mystery potion result from a number in [0,1).
    mysteryPick: function (roll) {
      var total = 0, i;
      for (i = 0; i < W.MYSTERY.length; i++) total += W.MYSTERY[i].w;
      var acc = 0;
      for (i = 0; i < W.MYSTERY.length; i++) { acc += W.MYSTERY[i].w / total; if (roll < acc) return W.MYSTERY[i].id; }
      return W.MYSTERY[W.MYSTERY.length - 1].id;
    },
    itemLine: function (id) {
      var it = ITEMS[id], bits = [W.TIERS[it.tier].name];
      if (it.heal) bits.push('+' + it.heal + ' HP' + (it.over ? ' over ' + it.over + ' s' : ''));
      if (it.explosion) bits.push('0–' + it.explosion.maxDamage + ' blast');
      if (it.damage && it.kind === 'target') bits.push(it.damage + ' dmg · ' + it.delay + ' s delay');
      if (it.struct === 'turret' || it.struct === 'sentry') bits.push(it.hp + ' HP · ' + it.damage + ' dmg');
      if (it.duration && it.kind !== 'throw') bits.push(it.duration + ' s');
      return bits.join(' · ');
    },
    weaponLine: function (id) {
      var w = WEAPONS[id];
      if (w.kind === 'gun') {
        if (w.pellets) return w.damageFar + '–' + w.damageNear + ' dmg by distance · ' + w.mag + ' rounds';
        if (w.unlimitedRange) return w.damage + '–' + w.damageMax + ' dmg by distance · ' + w.mag + ' rounds · unlimited range';
        if (w.windup) return w.damage + ' dmg · ' + Math.round(1 / w.fireInterval) + '/s · ' + w.windup + ' s spin-up';
        return w.damage + ' dmg · ' + w.mag + (w.mag === 1 ? ' round' : ' rounds');
      }
      if (w.kind === 'launcher') return '0–' + w.explosion.maxDamage + ' blast · ' + w.landFuse + ' s fuse · ' + w.mag + ' rounds · endless grenades';
      if (w.kind === 'throwable') return '×' + w.count + ' · 0–' + w.explosion.maxDamage + ' blast';
      if (w.kind === 'flame') return w.damage + '–' + w.damageMax + ' dmg per ' + w.fireInterval + ' s · area flame';
      if (w.kind === 'ability') return '+25% team buffs · ' + w.cooldown + ' s cooldown · ' + w.strikeDamage + '-damage airstrike';
      return '+' + w.heal + ' HP · ' + w.cooldown + ' s cooldown';
    }
  };
}());
