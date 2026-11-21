// Bots toward people (the health rule), turrets, and the level-three classes: the plan, the upgrade credit that
// lets a bot afford them, and each class fighting with what it carries.
import { suite } from './harness.mjs';
import { arena, W, TICK, dist } from './bots-harness.mjs';
import { thirdClass, makeProfile } from '../server/core/bots/profile.mjs';

const t = suite('bot rules, turrets and level-three classes');
const still = () => null;
const sprayer = (b, spread, seed = 77) => { const rng = W.U.rng(seed); return () => ({ mx: 0, my: 0, aimX: b.p.x + (rng.next() - 0.5) * spread, aimY: b.p.y + (rng.next() - 0.5) * spread, fire: true, firePressed: false }); };
const shotsBy = (a, b) => a.count('shot', (e) => e.player === b.p);

// ---------------------------------------------------------------- toward a person: health decides
{
  const N = 10;
  const tally = { timid: 0, seventy: 0, hurtNoHeal: 0, healFirst: 0, ran: 0, finisher: 0 };
  for (let k = 0; k < N; k++) {
    // `hits` within `secs`: did the player lose health?
    const scene = (prof, o, hp) => {
      const a = arena({ seed: 2000 + k });
      a.crowd();
      const b = a.bot(9000, 9000, prof, o), h = a.human(9500, 9000, still, hp === undefined ? { hp: 1e6 } : {});
      if (hp !== undefined) h.hp = hp;
      return { a, b, h, hp0: h.hp };
    };
    let s = scene({ aggression: 0.1, caution: 0.9 });
    if (s.a.until(() => s.h.hp < s.hp0, 6) >= 0) tally.timid++;
    s = scene({ aggression: 0.5 }, { hp: 70 });
    if (s.a.until(() => s.h.hp < s.hp0, 6) >= 0) tally.seventy++;
    s = scene({ aggression: 0.5 }, { hp: 45 });
    if (s.a.until(() => s.h.hp < s.hp0, 6) >= 0) tally.hurtNoHeal++;
    s = scene({ aggression: 0.5 }, { hp: 45, items: [['bandage', 3]] });
    const first = s.a.until(() => s.h.hp < s.hp0, 25);
    if (first >= 0 && s.a.used('bandage', s.b.p) > 0) tally.healFirst++;
    s = scene({ aggression: 0.9 }, { hp: 25 });
    s.a.step(8);
    if (shotsBy(s.a, s.b) === 0 && dist(s.b.p, s.h) > 700) tally.ran++;
    s = scene({ aggression: 0.5 }, { hp: 25 }, 10);
    if (s.a.until(() => shotsBy(s.a, s.b) > 0, 6) >= 0) tally.finisher++;
  }
  t.equal(tally.timid, N, 'at full health even the most timid, cautious bot strikes first at a player it can see (' + tally.timid + ' of ' + N + ' within 6 s)');
  t.equal(tally.seventy, N, 'so does a bot at 70 HP (' + tally.seventy + ' of ' + N + ')');
  t.equal(tally.hurtNoHeal, N, 'and one at 45 HP with nothing to heal with (' + tally.hurtNoHeal + ' of ' + N + ')');
  t.check(tally.healFirst >= N - 1, 'a bot at 45 HP carrying bandages backs off from a healthier player, patches up, then comes back shooting (' + tally.healFirst + ' of ' + N + ' within 25 s)');
  t.check(tally.ran >= N - 1, 'at 25 HP a bot runs from a player instead: no shots, and well away within 8 s (' + tally.ran + ' of ' + N + '), however bold it is');
  t.check(tally.finisher >= N - 1, 'unless the player is in even worse shape (10 HP): then it finishes them (' + tally.finisher + ' of ' + N + ')');
}
{
  // Somebody sitting in a self-propelled gun is not ignored; a tank is left alone by a bot with only a rifle.
  let hull = 0, kept = 0;
  const N = 8;
  for (let k = 0; k < N; k++) {
    const a = arena({ seed: 2100 + k, extra: { artillery: [{ id: 1, type: 'artillery', x: 9500, y: 9000, angle: 0 }] } });
    a.crowd();
    const b = a.bot(9000, 9000, { aggression: 0.5 }, { team: 1 });
    b.gunnerish = 0;
    const h = a.human(9500, 9150, still, { team: 2 }), v = a.world.vehicles[0];
    if (!a.world.enterVehicle(h, v, 'driver')) throw new Error('the test player could not board');
    if (a.until(() => v.hp < v.maxHp, 8) >= 0) hull++;
    const a2 = arena({ seed: 2100 + k, extra: { tanks: [{ id: 1, type: 'tank', x: 9600, y: 9000, angle: Math.PI }] } });
    a2.crowd();
    const b2 = a2.bot(9000, 9000, { aggression: 0.5 }, { team: 1 });
    b2.wheels = 0;
    const h2 = a2.human(9600, 9150, still, { team: 2 }), tank = a2.world.vehicles[0];
    a2.world.enterVehicle(h2, tank, 'driver');
    a2.step(6);
    if (shotsBy(a2, b2) === 0 && tank.hp === tank.maxHp) kept++;
  }
  t.equal(hull, N, 'a player sitting in self-propelled artillery gets shot at: the bot opens up on the hull (' + hull + ' of ' + N + ' within 8 s)');
  t.equal(kept, N, 'a tank is different: a bot with nothing that dents armour stays out of its way (' + kept + ' of ' + N + ')');
  // A Rocketeer has something that dents it.
  const a = arena({ seed: 2190, extra: { tanks: [{ id: 1, type: 'tank', x: 9800, y: 9000, angle: Math.PI }] } });
  a.crowd();
  const b = a.bot(9000, 9000, { aggression: 0.5, skill: 0.7 }, { team: 1, classId: 'rocketeer' });
  b.wheels = 0;
  const h = a.human(9800, 9150, still, { team: 2 }), tank = a.world.vehicles[0];
  a.world.enterVehicle(h, tank, 'driver');
  const hit = a.until(() => a.count('vehicle', (e) => e.op === 'hp' && e.cause === 'rpg') > 0, 14);
  t.check(hit >= 0 && tank.hp <= tank.maxHp - 500, 'a Rocketeer does take a tank on, with rockets (' + (tank.maxHp - tank.hp) + ' hull damage after ' + hit.toFixed(1) + ' s)');
}

// ---------------------------------------------------------------- turrets
{
  let mounted = 0, fired = 0, off = 0;
  const N = 10;
  for (let k = 0; k < N; k++) {
    const a = arena({ seed: 3000 + k, extra: { settlementStructures: [{ kind: 'turret', item: 'turret', x: 9150, y: 9100, angle: 0, settlement: 0, neutral: true }] } });
    a.crowd();
    const b = a.bot(9000, 9000, { aggression: 0.5, skill: 0.5 }, { team: 1 });
    const h = a.human(9750, 9050, still, { hp: 5000, team: 2 });
    if (a.until(() => !!b.p.mount, 8) >= 0) mounted++;
    a.step(6);
    if (a.count('shot', (e) => e.player === b.p && e.weapon === 'turret') > 10) fired++;
    h.x = 30000; h.y = 30000;
    if (a.until(() => !b.p.mount, 12) >= 0) off++;
    if (a.dir.errors) t.check(false, 'turret use threw');
  }
  t.check(mounted >= N - 2 && fired >= N - 2, 'in a fight a bot takes a free turret a few steps away (here a settlement\'s neutral one) and fires from it (mounted ' + mounted + ', fired ' + fired + ' of ' + N + ')');
  t.equal(off, N, 'and gets off again when there is nobody left to shoot');
}
{
  // No fight needed: a free turret on the screen is worth walking over to and holding for a while.
  const turret = { kind: 'turret', item: 'turret', x: 9600, y: 9200, angle: 0, settlement: 0, neutral: true };
  const a = arena({ extra: { settlementStructures: [turret] } });
  a.crowd();
  const b = a.bot(9000, 9000, { caution: 0.5 });
  const on = a.until(() => b.p.mount > 0, 10);
  const held = on >= 0 ? a.until(() => !b.p.mount, 40) : -1;
  t.check(on >= 0 && held >= 12 && held <= 24, 'with nobody about, a bot that sees a free turret walks over and sits down at it (' + on.toFixed(1) + ' s), and holds it for a while (' + held.toFixed(0) + ' s)');
  a.step(20);
  t.check(!b.p.mount && Math.hypot(b.p.x - turret.x, b.p.y - turret.y) > 150, 'then moves on instead of sitting straight back down');
  // A settlement's guard in the way: that turret belongs to the guard until somebody shoots it down.
  const g = arena({ extra: { settlementStructures: [turret, { kind: 'sentry', item: 'sentry2', x: 9600, y: 8700, angle: 0, settlement: 0, neutral: true }] } });
  g.crowd();
  const c = g.bot(8600, 9200, { caution: 0.5 });
  g.step(12);
  t.check(!c.p.mount && c.p.hp === c.p.maxHp && g.count('mounted') === 0, 'a turret it could only reach by crossing a guard sentry\'s reach is left alone, and the bot is not shot going for it');
  t.equal(a.dir.errors + g.dir.errors, 0, 'going for a turret does not throw');
}

// ---------------------------------------------------------------- the plan and the credit
{
  const seconds = ['sniper2', 'shotgunner2', 'medic2', 'grenadier2', 'pyromancer', 'juggernaut', 'commander'], seen = new Set();
  let legal = true;
  for (let i = 0; i < 700; i++) {
    const second = seconds[i % seconds.length], third = thirdClass(W.U.rng(i + 1), makeProfile(W.U.rng(i + 77)), second);
    seen.add(third);
    if (!W.CLASSES[third] || W.CLASSES[third].tier !== 3 || !W.Rules.classParents(third).includes(second)) legal = false;
  }
  t.check(legal, 'every bot plans a level-three class its level-two class really leads to');
  t.check(['engineer', 'shieldoperator', 'rocketeer', 'shotgunner3', 'magicmedic', 'pyromaniac', 'gastroop'].every((c) => seen.has(c)), 'between them bots go for all seven level-three classes');
}
{
  const station = { id: 0, x: 9300, y: 9000, cooldown: 0 };
  const a = arena({ extra: { stations: [station] } });
  a.crowd();
  const b = a.bot(9000, 9000, {}, { plan: ['sniper', 'sniper2', 'engineer'] }), c0 = b.credit;
  a.step(3);
  const gain = b.credit - c0;
  t.check(b.p.classId === 'soldier' && c0 >= 0 && c0 <= 3 && gain > 0.12 && gain < 0.4 && b.p.tokens === 0, 'a living bot earns upgrade credit slowly, at its own pace (' + gain.toFixed(2) + ' in three seconds), and it is not tokens');
  // Two bots are not offered a class in the same second: each has its own rate and head start.
  const others = [a.bot(9050, 9300, {}), a.bot(9100, 9300, {}), a.bot(9150, 9300, {})];
  t.check(new Set(others.map((o) => o.creditRate.toFixed(3))).size === 3 && others.every((o) => o.creditRate >= 0.6 && o.creditRate <= 1.4), 'different bots earn it at different rates (' + others.map((o) => o.creditRate.toFixed(2)).join(', ') + ')');
  for (const o of others) a.world.killPlayer(o.p, null, 'left');
  b.credit = 8;
  const up = a.until(() => b.p.classId === 'sniper', 10);
  t.check(up >= 0 && b.p.tokens === 0 && b.credit < 1, 'with enough credit for its next class a bot walks to an Upgrade Station and takes it (' + up.toFixed(1) + ' s); the credit is spent, no tokens appear');
  station.cooldown = 0; b.credit = 15;
  t.check(a.until(() => b.p.classId === 'sniper2', 12) >= 0, 'the same for level two');
  station.cooldown = 0; b.credit = 30; b.p.tokens = 10;
  const l3 = a.until(() => b.p.classId === 'engineer', 14);
  t.check(l3 >= 0 && b.p.tokens === 0 && Math.abs(b.credit - 0) < 1.5, 'and for level three: tokens in its pocket are spent first, credit covers the rest (' + l3.toFixed(1) + ' s)');
  // Credit is never loot.
  b.credit = 50;
  const before = a.map.pickups.filter((pk) => pk.alive && pk.type === 'token').length, foe = a.human(12000, 12000, still);
  a.world.damagePlayer(b.p, 5000, foe.id, 'ar');
  t.check(!b.p.alive && a.map.pickups.filter((pk) => pk.alive && pk.type === 'token').length === before, 'a bot that dies drops no tokens for its credit');
}

// ---------------------------------------------------------------- each class with its own weapons
function fight(classId, d, secs, o = {}) {
  const a = arena({ seed: o.seed || 5 });
  a.crowd();
  const b = a.bot(9000, 9000, { skill: 0.6, aggression: o.aggression === undefined ? 0.7 : o.aggression }, { classId, team: 1, hp: o.botHp });
  const h = a.human(9000 + d, 9000, null, { hp: o.hp || 4000, team: 2 });
  h.controller = o.passive ? still : sprayer(b, o.spread || 420);
  let minD = Infinity;
  for (let i = 0; i < secs / TICK && h.alive && b.p.alive; i++) { a.tick(); minD = Math.min(minD, dist(b.p, h)); }
  const dmg = (cause) => a.events.filter((e) => e.type === 'damage' && e.source === b.p && e.target === h && (!cause || e.cause === cause)).reduce((n, e) => n + e.amount, 0);
  return { a, b, h, dmg, minD, selfHurt: a.count('damage', (e) => e.target === b.p && e.source === b.p) };
}
{
  let r = fight('shotgunner3', 500, 10);
  t.check(r.minD < 220 && r.dmg('shotgun3') >= 500, 'a Shotgunner III closes in and uses Shotgun III (' + Math.round(r.dmg('shotgun3')) + ' damage, got to ' + Math.round(r.minD) + ' units)');
  r = fight('pyromaniac', 600, 12);
  t.check(r.dmg('pyroflamethrower') > 150, 'a Pyromaniac walks into flame range and burns (' + Math.round(r.dmg('pyroflamethrower')) + ' damage)');
  r = fight('pyromaniac', 600, 12, { aggression: 0.2 });
  t.check(r.dmg('pyrodualrevolver') >= 300 && r.minD > 350, 'a careful one keeps its distance with the dual revolvers (' + Math.round(r.dmg('pyrodualrevolver')) + ' damage)');
  r = fight('rocketeer', 800, 12, { passive: true });
  t.check(r.dmg('rpg') >= 400 && r.selfHurt === 0, 'a Rocketeer lands rockets from 800 away without ever catching itself in the blast (' + Math.round(r.dmg('rpg')) + ' damage in 12 s)');
  r = fight('rocketeer', 150, 6, { passive: true });
  t.check(r.selfHurt === 0 && (r.dmg('pistol') > 0 || r.dmg('rpg') > 0), 'with somebody on top of it, it backs off or pulls the pistol rather than fire a rocket at its own feet');
  r = fight('magicmedic', 500, 14, { botHp: 120 });
  t.check(r.a.count('heal', (e) => e.by === r.b.p && e.item === 'magicmedkit' && e.amount === 300) === 1 && r.dmg('revolver') > 0, 'a hurt Magic Medic uses its 300 HP kit on itself and fights with the revolver (' + Math.round(r.dmg('revolver')) + ' damage)');
  r = fight('shieldoperator', 450, 10, { spread: 60 });
  t.check(r.a.count('blocked', (e) => e.player === r.b.p && e.how === 'shield') >= 5 && r.dmg('shieldpistol') > 0, 'a Shield Operator keeps the riot shield toward the shooter while firing (' + r.a.count('blocked', (e) => e.player === r.b.p) + ' bullets stopped)');
  r = fight('engineer', 450, 10);
  t.check(r.dmg('pistol') > 0 && r.a.count('struct', (e) => e.op === 'add') === 0, 'an Engineer in a fight puts the wrench away and shoots (' + Math.round(r.dmg('pistol')) + ' damage)');
  r = fight('gastroop', 170, 6, { passive: true });
  t.check(r.b.p.gasCylinders === 2 && r.dmg('gas') > 0 && r.selfHurt === 0, 'a Gas Troop bot releases one cylinder against a nearby opponent');
  t.check([r].every((x) => x.a.dir.errors === 0), 'none of it throws');
}
{
  // An Engineer with a quiet moment: a sentry, and with tokens to spare a better one.
  const a = arena();
  a.crowd();
  const b = a.bot(9000, 9000, {}, { classId: 'engineer', tokens: 10, plan: ['sniper', 'sniper2', 'engineer'] });
  const mine = () => a.world.structures.find((s) => s.alive && s.kind === 'sentry' && s.owner === b.p.id);
  const built = a.until(() => !!mine(), 30);
  t.check(built >= 10, 'left alone, an Engineer bot builds a sentry with the wrench (the full ten seconds: done after ' + built.toFixed(1) + ' s)');
  const up = a.until(() => mine() && mine().item === 'sentry2', 20);
  t.check(up >= 7 && b.p.tokens === 2, 'and with eight tokens to spare hammers it up to Sentry II (' + up.toFixed(1) + ' s more, ' + b.p.tokens + ' tokens left)');
  a.step(3);
  t.check(!!W.WEAPONS[b.p.weapons[b.p.slot].id].bulletSpeed, 'then puts the tools away and has a gun in hand again (' + b.p.weapons[b.p.slot].id + ')');
  t.equal(a.dir.errors, 0, 'building does not throw');
}
{
  const a = arena();
  const b = a.bot(9000, 9000, {}, { classId: 'soldier', team: 4, items: [['engineerhammer2', 1]] });
  t.check(b.wantItem('engineerhammer2') === 0 && b.worstSlot()?.value === 0, 'other classes leave the Engineer hammer for an Engineer and can drop an unusable one');
  a.world.setClass(b.p, 'engineer', true);
  t.check(b.wantItem('engineerhammer2') > 0, 'an Engineer recognizes a dropped instant-upgrade hammer');
}
for (const item of ['sentry', 'sentry3']) {
  const a = arena(), b = a.bot(9000, 9000, {}, { classId: 'engineer', team: 5, items: [['engineerhammer2', 1]] });
  const s = a.world.addStruct({ kind: 'sentry', item, x: 8950, y: 9050, r: 22, hp: 1, maxHp: W.ITEMS[item].hp, team: b.p.team, owner: 1234 });
  const used = a.until(() => a.used('engineerhammer2', b.p) > 0, 3);
  t.check(used >= 0 && (item === 'sentry3' ? Object.values(W.SENTRY_IV).some(v => v.item === s.item) : s.item === 'sentry2'), 'an Engineer bot aims its hammer at a damaged friendly ' + item + ' and upgrades it');
  t.check(!a.world.countItem(b.p, 'engineerhammer2') && b.p.tokens === 0 && s.hp === s.maxHp && !a.dir.errors, 'the authoritative ' + item + ' upgrade consumes one hammer with zero tokens');
}

t.done();
