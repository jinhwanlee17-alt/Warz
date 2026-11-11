// Who a bot is: how well it plays, how it likes to play, what it is called and which classes it goes for.
// Everything is drawn from a seeded generator, so a match seed always produces the same lobby of bots.
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Most bots are average, a fifth are clearly weaker, a fifth clearly better, and a few are sharp.
// Nobody is an aimbot: even the best one reacts in about a fifth of a second and still misses.
// `level` (0..1, the server's BOT_SKILL setting) slides the whole lobby down or up: 0.5 is the mix above, 0 makes
// nearly everyone a weak bot, 1 makes most of them good. Nobody ever leaves the 0.14 to 0.90 range.
export const SKILL_MIN = 0.14, SKILL_MAX = 0.9;
export function rollSkill(rng, level = 0.5) {
  const r = rng.next();
  const s = r < 0.20 ? rng.range(0.14, 0.34) : r < 0.75 ? rng.range(0.34, 0.60) : r < 0.95 ? rng.range(0.60, 0.78) : rng.range(0.78, 0.90);
  return clamp(s + (clamp(level, 0, 1) - 0.5) * 0.5, SKILL_MIN, SKILL_MAX);
}

export function makeProfile(rng, opts = {}) {
  const skill = clamp(opts.skill === undefined ? rollSkill(rng, opts.level) : opts.skill, 0, 1);
  const vary = (v, by) => v * (1 + rng.range(-by, by));
  const trait = (given, base) => clamp(given === undefined ? base : given, 0.05, 0.95);
  const aggression = trait(opts.aggression, 0.2 + rng.next() * 0.6 + (skill - 0.5) * 0.2);
  const caution = trait(opts.caution, 0.25 + rng.next() * 0.5 - (aggression - 0.5) * 0.3);
  return {
    skill, aggression, caution,
    greed: trait(opts.greed, 0.3 + rng.next() * 0.6),
    // Perception and hands.
    reaction: vary(lerp(0.74, 0.26, skill), 0.12),        // seconds to notice someone who walks into view
    triggerDelay: vary(lerp(0.42, 0.14, skill), 0.2),     // seconds between "on target" and the first shot
    aimSigma: vary(lerp(0.105, 0.045, skill), 0.1),       // wobble of the aim angle, radians
    shotAccuracy: lerp(0.6, 0.9, clamp((skill - SKILL_MIN) / (SKILL_MAX - SKILL_MIN), 0, 1)), // clear, easy shots; evasion/cover can do better
    aimTau: vary(lerp(0.22, 0.11, skill), 0.1),           // how slowly the crosshair closes on where it should be, seconds
    track: clamp(vary(lerp(0.2, 0.7, skill), 0.1), 0, 0.9), // share of a target's sweep the hand matches without thinking
    trackTau: vary(lerp(0.3, 0.18, skill), 0.1),          // seconds before a change of direction registers
    lead: clamp(vary(lerp(0.12, 0.85, skill), 0.15), 0, 1), // share of the correct lead for bullet travel
    turnRate: lerp(6, 13, skill),                         // fastest sweep of the aim, radians per second
    sprayLoose: lerp(1.9, 1.1, skill),                    // how far off target it still pulls the trigger
    // Habits.
    strafe: clamp(lerp(0.3, 1, skill) + rng.range(-0.1, 0.1), 0.15, 1),   // share of a firefight spent strafing
    dodge: clamp(lerp(0.3, 0.92, skill) + rng.range(-0.08, 0.08), 0, 1),  // chance to run from a grenade or strike
    coverUse: clamp(lerp(0.1, 0.85, skill) + rng.range(-0.1, 0.1), 0, 1), // chance to reload or heal behind cover
    itemSense: lerp(0.4, 0.95, skill),                    // how readily the right item comes to mind
    hesitation: lerp(1.5, 0.45, skill),                   // scales pauses between decisions
    swapSense: clamp(lerp(0.1, 0.9, skill) + rng.range(-0.1, 0.1), 0, 1), // swaps weapons instead of reloading in a fight
    fleeHp: lerp(0.2, 0.48, caution),                     // health share where it tries to get out
    healHp: lerp(0.55, 0.85, caution),                    // health share where it reaches for a heal
    stormSlack: lerp(2, 16, caution) + lerp(-2, 3, skill),// seconds of safety margin against the storm
    senseEvery: lerp(0.3, 0.16, skill),
    decideEvery: lerp(0.5, 0.26, skill),
    teamwork: trait(opts.teamwork, 0.45 + rng.next() * 0.5)
  };
}

// ---------------------------------------------------------------- classes
const LVL1 = ['sniper', 'shotgunner', 'medic', 'grenadier'];
function weighted(rng, table) {
  let total = 0;
  for (const k in table) total += Math.max(0, table[k]);
  let roll = rng.next() * total;
  for (const k in table) { roll -= Math.max(0, table[k]); if (roll < 0) return k; }
  return Object.keys(table)[0];
}

// Which level-one class, then which level-two class, this bot is saving for.
export function classPlan(rng, prof, teamSize) {
  const team = teamSize > 1;
  const first = weighted(rng, {
    sniper: 1.0 + (1 - prof.aggression) * 0.9 + prof.skill * 0.4,
    shotgunner: 1.1 + prof.aggression * 1.2,
    medic: team ? 0.9 + prof.teamwork * 0.8 : 0.45,
    grenadier: 0.9 + prof.aggression * 0.4
  });
  const second = weighted(rng, {
    [first + '2']: 2.4,
    pyromancer: 0.5 + prof.aggression * 0.9,
    juggernaut: 0.7 + prof.aggression * 0.4,
    commander: team ? 0.9 : 0.3
  });
  return [first, second];
}
export const LEVEL_ONE = LVL1;

// ---------------------------------------------------------------- items
// How much a hotbar slot of each item is worth to a bot (it has three slots, so it has to choose).
export const ITEM_VALUE = {
  bandage: 50, flashbang: 30, grenade: 46, smoke: 36, smoothie: 34, energybar: 30,
  firenade: 58, shieldo: 60, firstaid: 62, strength: 44, speed: 40, health: 68, shield: 46, poison: 62, mystery: 28,
  drone: 42, rock: 60, riotshield: 38, turret: 54, sentry: 64, blackhole: 60, snowbomb: 58, overheal: 55,
  invisibility: 72, radar: 48, teleporter: 56, turret2: 70, sentry2: 78, lightning: 84, power: 76,
  turret3: 86, sentry3: 94, power2: 90, meteor: 92
};
export const HEALS = { bandage: 20, smoothie: 15, health: 75, firstaid: 100, overheal: 30 };

// ---------------------------------------------------------------- names
const HANDLES = ['NoScopeNed', 'Sgt_Pickles', 'PixelPanda', 'xXBlastXx', 'TacoTank', 'Ripley', 'KarmaKid', 'MrBoom', 'Juno', 'Static',
  'Moose', 'Echo7', 'Wanda', 'BoltBoy', 'Nova', 'Grizzly', 'Sprocket', 'Lumen', 'Pebbles', 'Dash', 'Vex', 'Kiwi', 'Bandit', 'Orbit',
  'Mango', 'Rook', 'Ziggy', 'Pixel', 'Ghost', 'Hazel', 'Turbo', 'Maple', 'Jinx', 'Comet', 'Biscuit', 'Raptor', 'Sable', 'Tango', 'Fizz',
  'Onyx', 'Clover', 'Blitz', 'Noodle', 'Viper', 'Sunny', 'Quill', 'Drift', 'Pogo', 'Wasabi', 'Flint', 'Otter', 'Nimbus', 'Rascal',
  'Cobalt', 'Peanut', 'Storm', 'Gizmo', 'Lynx', 'Bubbles', 'Hawk', 'Mochi', 'Rusty', 'Skye', 'Tater', 'Wolfie', 'Zephyr', 'Ace',
  'Bean', 'Crash', 'Dusty', 'Ember', 'Frosty', 'Gadget', 'Hopper', 'Indy', 'Jelly', 'Koda', 'Lucky', 'Mittens', 'Nacho', 'Ozzy',
  'Pickle', 'Quake', 'Ranger', 'Scout', 'Toast', 'Ursa', 'Vinny', 'Waffles', 'Yeti', 'Zorro', 'Astro', 'Boomer', 'Chip', 'Dizzy',
  'Elmo', 'Fang', 'Goose', 'Havoc', 'Iggy', 'Jax', 'Kermit', 'Loki', 'Milo', 'Neo', 'Opal', 'Pippin', 'Remy', 'Salsa', 'Tux',
  'CaptainSnack', 'sn1perwolf', 'big_tuna', 'lilpotato', 'DrPew', 'ItsMeMario', 'SneakyPete', 'CouchHero', 'NotABot', 'ToastyBoi',
  'grandma_gamer', 'ok_boomer', 'SirShootsALot', 'LagWizard', 'PotatoAim', 'QuietKid', 'BananaJoe', 'el_fuego', 'KnockKnock',
  'HideAndSeek', 'OneTapTom', 'ReloadRita', 'MedicPlz', 'CrateHunter', 'StormChaser', 'RockLobster', 'TurretSyndrome', 'DukeOfDrop'];
const TAILS = ['', '', '', '', '7', '99', '_x', 'YT', '2k', '13', '42', '_tv', '101', 'xd', '23'];

// `count` distinct display names that none of the real players are using.
export function makeNames(rng, count, taken) {
  const used = new Set((taken || []).map((n) => String(n).toLowerCase())), out = [];
  const pool = rng.shuffle(HANDLES);
  let cursor = 0;
  for (let guard = 0; out.length < count && guard < count * 60; guard++) {
    let name;
    if (rng.next() < 0.3) name = 'Guest' + rng.int(1000, 9999); // real guests are called this too
    else {
      name = pool[cursor++ % pool.length];
      if (cursor > pool.length || rng.next() < 0.3) name += rng.pick(TAILS);
      if (rng.next() < 0.18) name = name.toLowerCase();
    }
    name = name.slice(0, 16);
    if (used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    out.push(name);
  }
  while (out.length < count) { const n = 'Guest' + (10000 + out.length); used.add(n.toLowerCase()); out.push(n); }
  return out;
}
