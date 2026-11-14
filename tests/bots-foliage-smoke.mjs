// Leafy cover passes shots through; cacti must not trap bots in blocked firing lanes.
import { suite } from './harness.mjs';
import { arena, dist } from './bots-harness.mjs';
const t = suite('Bot foliage firing lanes');
for (const kind of ['trees', 'cacti']) {
  const plant = { x: 10000, y: 10000, r: kind === 'trees' ? 90 : 30, conceals: true };
  const a = arena({ seed: 7, extra: { [kind]: [plant] } });
  const left = a.bot(9976, 10000, { skill: .7, aggression: 1, caution: 0 }),
    right = a.bot(10024, 10000, { skill: .7, aggression: 1, caution: 0 });
  a.dir.beforeTick(.05);
  for (const [bot, enemy] of [[left, right], [right, left]]) {
    bot.sense();
    const rec = bot.known.get(enemy.p.id);
    rec.noticed = true; rec.noticeAt = -100; rec.hurtMeAt = 0;
    bot.target = rec; bot.setMode('fight'); bot.engage.set(rec.id, { fight: true, until: 100 });
  }
  const start = { x: left.p.x, y: left.p.y };
  if (kind === 'trees') t.check(left.shotClear(left.target), 'leafy cover does not block a bot firing at an opponent');
  a.step(1);
  if (kind === 'cacti') t.check(dist(left.p, start) > 60 || !left.p.alive, kind + ': bot backs away from a blocked close-range muzzle');
  a.step(14);
  t.check(!plant.alive || left.p.hp < left.p.maxHp || right.p.hp < right.p.maxHp || !left.p.alive || !right.p.alive,
    kind + ': bots clear the foliage or move to a usable firing lane and engage');
  t.equal(a.dir.errors, 0, kind + ': clearing cover does not throw');
}
t.done();
