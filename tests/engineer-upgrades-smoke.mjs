import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(), t = suite('Engineer hammer upgrades'), DT = .05;
function arena(item = 'sentry', remote = false) {
  const map = { seed: 93, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], nextPickupId: 1 };
  const world = new W.World({ map, remote, storm: false });
  const p = world.addPlayer({ classId: 'engineer', x: 5000, y: 5000, team: 1 });
  p.slot = 2; p.angle = 0; p.tokens = 100;
  const s = world.addStruct({ kind: 'sentry', item, x: 5100, y: 5000, r: W.STRUCT_RADIUS.sentry, team: 1, owner: p.id, hp: W.ITEMS[item].hp, maxHp: W.ITEMS[item].hp });
  const intent = { mx: 0, my: 0, aimX: s.x, aimY: s.y, fire: true };
  p.controller = () => intent;
  return { world, p, s, intent };
}
function run(a, sec) { for (let i = 0; i < Math.round(sec / DT); i++) a.world.update(DT); }
{
  const a = arena(); a.s.hp = 10; run(a, 1);
  t.near(a.s.hp, 22, 1e-8, 'hammer repairs exactly 12 HP per second');
  t.equal(a.p.tokens, 100, 'repairing spends no tokens');
  t.check(a.p.sentryWork?.kind === 'repair', 'repair progress is available to HUD and server');
  t.check(a.world.events.some(e => e.type === 'struct' && e.op === 'repair'), 'repair HP emits structure updates');
  run(a, 2.35); t.near(a.s.hp, 50, 1e-8, 'repair caps at maximum HP');
}
for (const [item, next] of [['sentry', 'sentry2'], ['sentry2', 'sentry3']]) {
  const a = arena(item); run(a, 7.95);
  t.equal(a.s.item, item, item + ': upgrade waits the full eight seconds');
  t.equal(a.p.tokens, 100, item + ': incomplete work does not spend tokens');
  run(a, DT);
  t.equal(a.s.item, next, item + ': eight seconds upgrades in place');
  t.equal(a.p.tokens, 92, item + ': exactly eight tokens charged');
  t.equal(a.s.hp, W.ITEMS[next].hp, item + ': new tier starts at its full HP');
  t.equal(a.world.structures.length, 1, item + ': upgrading preserves structure identity');
}
for (const kind of ['release', 'slot', 'empty', 'range', 'team', 'death', 'damage']) {
  const a = arena(); run(a, 7.95);
  if (kind === 'release') a.intent.fire = false;
  if (kind === 'slot') a.intent.slot = 1;
  if (kind === 'empty') a.intent.held = 0;
  if (kind === 'range') a.p.x -= 400;
  if (kind === 'team') a.s.team = 2;
  if (kind === 'death') a.world.killPlayer(a.p, null, 'test');
  if (kind === 'damage') a.s.hp -= 15;
  run(a, DT);
  t.equal(a.s.item, 'sentry', kind + ': last-tick interruption prevents upgrade');
  if (kind !== 'death') t.equal(a.p.tokens, 100, kind + ': cancelled work does not spend tokens');
  t.check(a.p.sentryWork?.kind !== 'upgrade', kind + ': build progress clears');
}
{
  const a = arena(); a.p.tokens = 7; run(a, 10);
  t.equal(a.s.item, 'sentry', 'insufficient tokens cannot build an upgrade');
  a.p.tokens = 8; run(a, 4); a.intent.fire = false; run(a, DT); a.intent.fire = true; run(a, 4);
  t.equal(a.s.item, 'sentry', 'interrupted construction restarts its full timer');
}
{
  const a = arena('sentry3'); run(a, DT);
  const options = [...a.p.sentryChoice.options];
  t.equal(options.join(), 'bullets,grenades,rockets,snowballs,fireballs,cannons', 'Sentry IV offers all six specializations in stable order');
  t.check(options.every(k => W.SENTRY_IV[k]), 'every choice is a released specialization');
  a.intent.fire = false; run(a, .5);
  t.check(!!a.p.sentryChoice, 'opening the choice menu does not cancel its pending offer');
  t.equal(a.world.chooseSentryUpgrade(a.p, 'invalid-sentry'), false, 'unknown variant cannot be requested');
  a.world.chooseSentryUpgrade(a.p, null); a.intent.fire = true; run(a, DT);
  t.equal(a.p.sentryChoice.options.join(), options.join(), 'reopening preserves all six choices and their order');
  const picked = options[5];
  t.equal(a.world.chooseSentryUpgrade(a.p, picked), true, 'last offered Cannon specialization can be selected');
  run(a, 29.95);
  t.equal(a.s.item, 'sentry3', 'Sentry IV waits thirty complete seconds');
  run(a, DT);
  t.equal(a.s.item, W.SENTRY_IV[picked].item, 'thirty seconds produces selected Cannon Sentry IV');
  t.equal(a.p.tokens, 70, 'Sentry IV costs exactly thirty tokens');
  t.equal(a.s.hp, W.SENTRY_IV[picked].hp, 'specialization has its specified HP');
  run(a, 35); t.equal(a.p.tokens, 70, 'completed Sentry IV cannot charge for a further upgrade');
  a.s.hp -= 24; run(a, 2); t.near(a.s.hp, a.s.maxHp, 1e-8, 'hammer still repairs Sentry IV');
}
{
  const a = arena('sentry3', true); a.s.hp -= 20; a.world.updateEngineerWork(a.p, a.intent, 8);
  t.equal(a.s.hp, a.s.maxHp - 20, 'client mirror cannot grant repair HP');
  a.p.sentryChoice = { struct: a.s.id, options: ['bullets'] };
  t.equal(a.world.chooseSentryUpgrade(a.p, 'bullets'), false, 'client mirror cannot authorize an upgrade');
}
{
  const a = arena(); a.s.alive = false;
  const enemy = a.world.addPlayer({ x: 5060, y: 5000, team: 2 });
  a.world.trigger(a.p, a.intent);
  t.equal(enemy.hp, enemy.maxHp - 30, 'Engineer hammer retains Armor Crew hammer melee damage');
}
t.done();
