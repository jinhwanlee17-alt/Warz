import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(), t = suite('level3 rules'), { CLASSES, Rules, WEAPONS } = W;
const parents = W.CLASS_ORDER.filter(id => CLASSES[id].tier === 2);
const released = W.CLASS_ORDER.filter(id => CLASSES[id].tier === 3);
const planned = {
  shotgunner3: 'shotgunner2', sniper3: 'sniper2', magicmedic: 'medic2',
  president: 'commander', pyromaniac: 'pyromancer', tankcommander: 'armorcrew', juggernaut2: 'juggernaut'
};
t.equal(released.join(), 'engineer,shieldoperator,rocketeer', 'Engineer, Shield Operator and Rocketeer are released at level three without reordering older class indices');
t.equal(Object.keys(W.CLASS_PLANNED).sort().join(), Object.keys(planned).sort().join(), 'the seven unreleased classes remain planned');
t.equal(W.TREE_SOON.length, 7, 'seven future branches remain visible in the tree');
for (const id of released) {
  const allowed = id === 'rocketeer' ? ['grenadier2'] : parents;
  t.equal(Rules.upgradeCostFor(id), 40, id + ' costs 40 tokens');
  t.equal(Rules.nextUpgradeCost(id), 0, id + ' is the final upgrade');
  t.equal(Rules.classParents(id).slice().sort().join(), allowed.slice().sort().join(), id + ' accepts its specified level-two predecessors');
  for (const from of W.CLASS_ORDER) {
    const result = Rules.upgradeCheck({ from, to: id, tokens: 40, keys: 0, stationCooldown: 0 });
    t.equal(result.ok, allowed.includes(from), from + ' -> ' + id + ' respects its upgrade branch');
  }
  for (const from of allowed) {
    t.check(!Rules.upgradeCheck({ from, to: id, tokens: 39, keys: 9, stationCooldown: 0 }).ok, from + ' cannot buy ' + id + ' for 39 tokens');
    t.check(!Rules.upgradeCheck({ from, to: id, tokens: 40, keys: 0, stationCooldown: 1 }).ok, id + ' respects station cooldown');
    const key = Rules.upgradeCheck({ from, to: id, tokens: 40, keys: 1, stationCooldown: 1 });
    t.check(key.ok && key.useKey && key.cost === 40, id + ' supports a station key without reducing token cost');
  }
  t.check(CLASSES[id].loadout.every(weapon => WEAPONS[weapon] && !/undefined|NaN/.test(Rules.weaponLine(weapon))), id + ' has complete weapon definitions and readable stat lines');
}
for (const [id, from] of Object.entries(planned)) {
  t.check(!CLASSES[id] && !W.CLASS_ORDER.includes(id), id + ' cannot be selected as a playable class');
  t.equal(Rules.classParents(id).join(), from, id + ' requires its specified level-two class');
  t.equal(Rules.upgradeCostFor(id), 40, id + ' advertises the future 40-token cost');
  t.check(!Rules.upgradeCheck({ from, to: id, tokens: 999, keys: 9, stationCooldown: 0 }).ok, id + ' is server-locked even with enough tokens');
  t.check(!Rules.childClasses(from).includes(id), id + ' is excluded from live upgrade choices');
}
t.equal(WEAPONS.shieldpistol.mag, 10, 'shield pistol keeps the basic ten-round magazine');
t.equal(WEAPONS.shieldpistol.damage, WEAPONS.pistol.damage, 'shield pistol uses basic pistol damage');
t.equal(WEAPONS.wrench.buildSeconds, 10, 'sentry wrench builds for ten seconds');
t.equal(CLASSES.rocketeer.hp, 65, 'Rocketeer trades health for its anti-vehicle weapon');
t.equal(CLASSES.rocketeer.loadout.join(), 'rpg,pistol', 'Rocketeer carries the RPG and Basic Pistol');
t.equal(WEAPONS.rpg.mag, 1, 'RPG carries one loaded rocket');
t.equal(WEAPONS.rpg.reload, 3, 'RPG reloads for three seconds');
t.near(WEAPONS.rpg.explosion.radius, WEAPONS.grenade.explosion.radius * .9, 1e-8, 'RPG blast radius is ten percent smaller than a grenade');
t.check(WEAPONS.rpg.unlimitedRange && WEAPONS.rpg.projectileRadius > W.SENTRY_IV.rockets.radius, 'RPG is a larger physical rocket with unlimited travel');

const template = W.MapGen.generate(112);
function arena() {
  return new W.World({ map: { ...template, rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [], ponds: [], stations: [], vehicles: [] }, storm: false });
}
for (const id of released) {
  const first = id === 'rocketeer' ? 'grenadier' : 'medic', second = id === 'rocketeer' ? 'grenadier2' : 'commander';
  const w = arena(), p = w.addPlayer({ classId: 'soldier', x: 4000, y: 4000 });
  const st = { id: 0, number: 1, x: p.x + 60, y: p.y, cooldown: 0 }; w.map.stations = [st];
  p.tokens = 63; p.keys = 1;
  t.check(w.upgrade(p, st, first).ok, id + ' starts with a real level-one upgrade');
  st.cooldown = 0;
  t.check(w.upgrade(p, st, second).ok, id + ' follows an eligible level-two branch');
  p.hp = 70;
  const result = w.upgrade(p, st, id);
  t.check(result.ok && result.usedKey && p.tokens === 0 && p.keys === 0, id + ' spends exactly 40 tokens and one key at a cooling station');
  t.equal(p.hp, Math.min(70, CLASSES[id].hp), id + ' preserves existing health capped at its new maximum');
  t.equal(p.weapons.map(slot => slot.id).join(), CLASSES[id].loadout.join(), id + ' gives the class loadout');
  t.check(p.weapons.length === (id === 'engineer' ? 3 : 2) && p.items.length === 3, id + ' has its class weapon slots and preserves all three item stacks');
  t.equal(p.upgradeFrom, second, id + ' remembers the actual level-two predecessor');
  t.check(Rules.relation(p, first) === 'owned' && Rules.relation(p, second) === 'owned' && Rules.relation(p, 'sniper') === 'branch', id + ' remembers the entire actual class path');
  w.setClass(p, id, false);
  t.equal(p.upgradeFrom, second, id + ' retains its actual predecessor after a state refresh');
  p.tokens = 999; st.cooldown = 0;
  const other = id === 'engineer' ? 'shieldoperator' : 'engineer';
  t.check(!w.upgrade(p, st, other).ok && p.tokens === 999, id + ' cannot switch sideways to another level-three class');
}
t.done();
