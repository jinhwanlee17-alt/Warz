// Leafy cover passes shots through; cacti must not trap bots in blocked firing lanes.
import { suite } from './harness.mjs';
import { arena, dist, W } from './bots-harness.mjs';
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
{
  const house = { x: 10000, y: 10000, w: 240, h: 220, walls: [], ruined: false };
  const a = arena({ extra: { buildings: [house] } });
  const viewer = a.human(9700, 10100), occupant = a.human(10120, 10100);
  a.dir.cover.refresh(a.world.players);
  t.check(a.dir.cover.hidden(viewer, occupant), 'an intact house roof conceals its occupant');
  house.ruined = true;
  a.dir.cover.refresh(a.world.players);
  t.check(a.dir.cover.buildingAt(occupant.x, occupant.y) === -1 && !a.dir.cover.hidden(viewer, occupant), 'open house debris does not conceal an occupant beneath a nonexistent roof');
}
{
  // Cacti cost 8 HP a second to stand against. A bot going somewhere walks round them.
  let arrived = 0, unhurt = 0;
  const N = 8;
  for (let k = 0; k < N; k++) {
    const rng = W.U.rng(900 + k), cacti = [];
    for (let i = 0; cacti.length < 60 && i < 4000; i++) {
      const x = rng.range(9300, 10700), y = rng.range(8500, 9500), r = rng.range(22, 34);
      if (cacti.every((c) => Math.hypot(c.x - x, c.y - y) > c.r + r + 45)) cacti.push({ id: cacti.length, x, y, r, hp: 50, maxHp: 50, alive: true, biome: 'desert', variant: 0 });
    }
    const a = arena({ seed: 900 + k, extra: { cacti } });
    const b = a.bot(9000, 9000 + rng.range(-200, 200), {});
    b.roam = { x: 11000, y: 9000 + rng.range(-200, 200), at: 0, until: 1e9 };
    if (a.until(() => b.p.x > 10850, 25) >= 0) arrived++;
    if (a.count('damage', (e) => e.target === b.p && e.cause === 'cactus') === 0) unhurt++;
  }
  t.check(arrived === N && unhurt === N, 'a bot crosses a field of sixty cacti without touching one (arrived ' + arrived + ', unhurt ' + unhurt + ' of ' + N + ')');
}

t.done();
