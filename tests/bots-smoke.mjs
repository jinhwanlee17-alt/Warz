// Bots, one behaviour at a time, in small worlds: getting around, what they can and cannot see, fighting, staying
// alive, looting and upgrading, every item, and playing on a team. (Whole matches are in bots-match-smoke.mjs.)
import { suite } from './harness.mjs';
import { arena, emptyMap, W, TICK, shootAt, dist } from './bots-harness.mjs';
import { Nav } from '../server/core/bots/nav.mjs';
import { makeProfile, makeNames, classPlan, rollSkill, ITEM_VALUE } from '../server/core/bots/profile.mjs';

const t = suite('bots');
const still = () => null;
const crate = (id, x, y, tier = 'common') => ({ id, x, y, size: 52, tier, hp: W.CRATES[tier].hp, maxHp: W.CRATES[tier].hp, alive: true, shake: 0 });
const tree = (x, y, r = 110) => ({ x, y, r, trunk: 18, variant: 0, rot: 0, fade: 1 });
// A square room with one doorway in its south wall (the same wall rectangles the map generator makes).
function room(x, y, w = 320, h = 300) {
  const T = 18, door = 86, dx = x + (w - door) / 2;
  return { id: 0, x, y, w, h, doors: ['bottom'], roof: '#b5533c', ridgeVertical: false, vent: false, fade: 1, walls: [
    { x, y, w, h: T }, { x, y: y + h - T, w: dx - x, h: T }, { x: dx + door, y: y + h - T, w: x + w - dx - door, h: T },
    { x, y: y + T, w: T, h: h - T * 2 }, { x: x + w - T, y: y + T, w: T, h: h - T * 2 }] };
}
// A player who shoots at a bot but not well (so a fight lasts long enough to watch).
const sprayer = (a, b, spread = 260, seed = 77) => { const rng = W.U.rng(seed); return () => ({ mx: 0, my: 0, aimX: b.p.x + (rng.next() - 0.5) * spread, aimY: b.p.y + (rng.next() - 0.5) * spread, fire: true, firePressed: false }); };

// A player who leads the target and rarely misses (for "about to die" situations).
const marksman = (a, b) => (p) => { const d = Math.hypot(b.p.x - p.x, b.p.y - p.y), lead = d / 1900; return { mx: 0, my: 0, aimX: b.p.x + b.p.vx * lead, aimY: b.p.y + b.p.vy * lead, fire: true, firePressed: false }; };

// ---------------------------------------------------------------- who they are
{
  const a = arena();
  a.crowd(50);
  const pace = a.dir.pace;
  t.check(W.STORM.every((phase, i) => pace[5 + i * 2][0] === phase.start && pace[6 + i * 2][0] === phase.end),
    'match pacing follows every storm wait and closure instead of an obsolete match duration');
  a.world.time = W.STORM[2].start;
  a.world.players.forEach((p, i) => { p.alive = i < 17; });
  a.dir.beforeTick(TICK);
  t.near(a.dir.heat, 0, 1e-9, '17 of 50 alive at the third closure is on pace, even with longer waits');
}
{
  const rng = W.U.rng(42), skills = [];
  for (let i = 0; i < 2000; i++) skills.push(rollSkill(rng));
  const share = (lo, hi) => skills.filter((s) => s >= lo && s < hi).length / skills.length;
  t.check(Math.min(...skills) >= 0.14 && Math.max(...skills) <= 0.9, 'skill stays between 0.14 and 0.90: nobody is hopeless, nobody is an aimbot');
  t.near(share(0.34, 0.6), 0.55, 0.05, 'a little over half the bots are average');
  t.near(share(0, 0.34), 0.2, 0.04, 'a fifth are clearly weaker');
  t.near(share(0.6, 1), 0.25, 0.04, 'a quarter are better than average (and one in twenty is sharp)');
  // The server's BOT_SKILL setting slides the whole lobby down or up without anyone leaving that range.
  const mean = (level) => { const r = W.U.rng(9); let sum = 0, lo = 1, hi = 0; for (let i = 0; i < 1000; i++) { const s = rollSkill(r, level); sum += s; lo = Math.min(lo, s); hi = Math.max(hi, s); } return { avg: sum / 1000, lo, hi }; };
  const easy = mean(0), normal = mean(0.5), hard = mean(1);
  t.check(easy.avg < 0.3 && normal.avg > 0.42 && normal.avg < 0.52 && hard.avg > 0.66, 'the difficulty setting moves the average bot from weak (' + easy.avg.toFixed(2) + ') through the usual ' + normal.avg.toFixed(2) + ' to good (' + hard.avg.toFixed(2) + ')');
  t.check(easy.lo >= 0.14 && hard.hi <= 0.9 && easy.hi > easy.lo + 0.3, 'at either end there are still better and worse bots, and still no aimbots');
  const weak = makeProfile(W.U.rng(1), { skill: 0.2 }), sharp = makeProfile(W.U.rng(1), { skill: 0.9 });
  t.check(weak.reaction > sharp.reaction * 2 && weak.aimSigma > sharp.aimSigma * 1.8 && weak.track < sharp.track && weak.dodge < sharp.dodge, 'a weak bot reacts slower, aims shakier, tracks worse and dodges less than a sharp one');
  t.check(sharp.reaction >= 0.2 && sharp.aimSigma >= 0.035, 'even the sharpest bot takes a fifth of a second to react and still wobbles');
  const names = makeNames(W.U.rng(7), 49, ['Mango', 'guest1234']);
  t.equal(new Set(names.map((n) => n.toLowerCase())).size, 49, '49 bot names, all different');
  t.check(names.every((n) => n.length >= 2 && n.length <= 16 && n.toLowerCase() !== 'mango' && n.toLowerCase() !== 'guest1234'), 'names fit the name rules and never copy a real player in the lobby');
  t.equal(makeNames(W.U.rng(7), 49, []).join(), makeNames(W.U.rng(7), 49, []).join(), 'the same seed names the same bots');
  const plans = [];
  for (let i = 0; i < 400; i++) plans.push(classPlan(W.U.rng(i + 1), makeProfile(W.U.rng(i + 9)), i % 2 ? 2 : 1));
  t.check(plans.every((p) => W.CLASSES[p[0]].tier === 1 && W.CLASSES[p[1]].tier === 2 && W.Rules.classParents(p[1]).includes(p[0])), 'every class plan is a legal level-one class followed by a level-two class it leads to');
  t.check(['sniper', 'shotgunner', 'medic', 'grenadier'].every((c) => plans.some((p) => p[0] === c)) && ['pyromancer', 'juggernaut', 'commander', 'sniper2', 'shotgunner2', 'medic2', 'grenadier2'].every((c) => plans.some((p) => p[1] === c)), 'between them bots go for every class in the tree');
  t.check(W.ITEM_ORDER.every((id) => ITEM_VALUE[id] > 0), 'every item in the game has a worth to a bot');
}

// ---------------------------------------------------------------- getting around
{
  const b0 = room(9000, 9000);
  const a = arena({ extra: { buildings: [b0] } });
  const nav = new Nav(W, a.world);
  nav.budget = 99;
  const inside = { x: 9160, y: 9120 }, north = { x: 9160, y: 8700 };
  const path = nav.findPath(north.x, north.y, inside.x, inside.y);
  t.check(!!path && !path.partial, 'a path from behind a building leads round to its door and inside');
  let px = north.x, py = north.y, clear = true, len = 0;
  for (const pt of path.points) { if (!nav.segmentClear(px, py, pt.x, pt.y)) clear = false; len += Math.hypot(pt.x - px, pt.y - py); px = pt.x; py = pt.y; }
  t.check(clear, 'every leg of the path is walkable');
  t.check(Math.hypot(px - inside.x, py - inside.y) < 40 && len > 700, 'it ends at the goal after going the long way round (' + Math.round(len) + ' units for 420 as the crow flies)');
  t.check(!nav.segmentClear(north.x, north.y, inside.x, inside.y), 'the straight line through the wall is not walkable');
  // The corner regression: a player touching the outside corner of a wall is not "inside the wall".
  const cx = b0.x - 17, cy = b0.y - 17;
  t.check(a.world.solids && !nav.solidAt(cx, cy, 23.9), 'a spot diagonally off a wall corner is free ground');
  t.check(nav.segmentClear(cx, cy, cx - 200, cy - 200) && nav.segmentClear(cx, cy, cx - 200, cy + 60), 'and a player standing there can walk away from it');
  t.check(!!nav.findPath(cx, cy, inside.x, inside.y), 'and plan a path from it');
  // Shoved into a wall by a crowd (closer to it than a player can walk on their own): still not "inside" it.
  const wx = b0.x + 18 + 12, wy = b0.y + 150;
  t.check(nav.segmentClear(wx, wy, wx + 100, wy) && nav.segmentClear(wx, wy, wx, wy + 60), 'a player pressed into a wall can walk away from it, or along it');
  t.check(!nav.segmentClear(wx, wy, wx - 60, wy), 'but not further into it');
  const outWay = nav.findPath(wx, wy, north.x, north.y);
  t.check(!!outWay && !outWay.partial, 'and a path out of the building starts from there');
  nav.budget = 0;
  t.equal(nav.findPath(north.x, north.y, inside.x, inside.y), undefined, 'with this tick\'s search budget spent the answer is "ask again"');
  // Sealed in: no way.
  const sealed = room(9000, 9000);
  sealed.walls = [{ x: 9000, y: 9000, w: 320, h: 18 }, { x: 9000, y: 9282, w: 320, h: 18 }, { x: 9000, y: 9018, w: 18, h: 264 }, { x: 9302, y: 9018, w: 18, h: 264 }];
  const a2 = arena({ extra: { buildings: [sealed] } }), nav2 = new Nav(W, a2.world);
  nav2.budget = 99;
  const none = nav2.findPath(north.x, north.y, inside.x, inside.y, { maxNodes: 4000 });
  t.check(!none || none.partial, 'a walled-in goal has no complete path');
  // A crate in the way stops being in the way once it is broken.
  const a3 = arena({ extra: { crates: [crate(0, 9000, 9000)] } }), nav3 = new Nav(W, a3.world);
  t.check(!nav3.freeAt(9000, 9000), 'a crate blocks its cell');
  a3.map.crates[0].alive = false;
  nav3.invalidate(9000, 9000, 40);
  t.check(nav3.freeAt(9000, 9000), 'and frees it when it breaks');
  // Real islands: every indoor crate can be reached or at least shot at from a reachable spot.
  let reach = 0, total = 0;
  for (const seed of [5, 99]) {
    const real = arena({ map: W.MapGen.generate(seed), seed });
    const bot = real.bot(0, 0, {});
    for (let i = 0; i < real.map.crates.length; i++) {
      if (real.dir.crateMeta[i].building < 0) continue;
      total++;
      const c = real.map.crates[i];
      bot.p.x = c.x + 500; bot.p.y = c.y + 500;
      const spot = bot.crateSpot(c, { range: 280, min: 0 });
      if (!spot) continue;
      real.dir.nav.budget = 99;
      const way = real.dir.nav.findPath(bot.p.x, bot.p.y, spot.x, spot.y, { maxNodes: 6000 });
      if (way && !way.partial) reach++;
    }
  }
  t.check(total > 30 && reach >= total * 0.9, 'on real islands a bot finds a reachable spot with a line to nearly every indoor crate (' + reach + '/' + total + ')');
}

// A bot standing against a wall corner still gets where it is going (it used to freeze there for the whole match).
{
  const b0 = room(9000, 9000);
  const a = arena({ extra: { buildings: [b0], crates: [crate(0, 9600, 9600)] } });
  const b = a.bot(b0.x - 17, b0.y - 17, {});
  b.crates.add(0);
  t.check(a.until(() => !a.map.crates[0].alive, 14) >= 0, 'starting wedged against a building corner, a bot still walks off to its crate');
}

// A room full of bots that are leaving each other alone must not turn into a crush: everyone still gets out of its
// one door. (Keeping their distance from each other used to pin them all against the walls until the storm came.)
{
  const b0 = room(9000, 9000, 280, 260);
  const a = arena({ extra: { buildings: [b0] } });
  a.crowd();
  const bots = [];
  for (let i = 0; i < 12; i++) {
    const b = a.bot(9050 + (i % 4) * 58, 9050 + Math.floor(i / 4) * 58, {});
    b.decide = function () { this.updateStorm(); this.pickTarget(); this.setMode('roam'); };   // no fighting, no looting: just walk
    b.roam = { x: 8500 + i * 110, y: 8300, at: 0, until: 1e9 };                              // somewhere north: out of the door and round the house
    bots.push(b);
  }
  const out = a.until(() => bots.every((b) => a.dir.cover.buildingAt(b.p.x, b.p.y) < 0), 12);
  t.check(out >= 0, 'twelve bots packed into one small house all get out through its one door (' + out.toFixed(1) + ' s)');
  t.check(a.until(() => bots.every((b) => b.p.y < 8950), 30) >= 0, 'and round it to where they were going');
}

// ---------------------------------------------------------------- what they can see
{
  const a = arena({ extra: { trees: [tree(9500, 9000)], buildings: [room(9000, 8560)] } });
  a.crowd();
  const b = a.plant(a.bot(9000, 9000, { aggression: 0.5 }));
  const open = a.human(9000, 9400, still), leafy = a.human(9500, 9000, still), roofed = a.human(9160, 8710, still), far = a.human(9000 + 1000, 9000, still), ghost = a.human(8600, 9000, still);
  ghost.fx.invisible = 30;
  a.step(2.5);
  const knows = (p) => !!(b.known.get(p.id) && b.known.get(p.id).noticed);
  t.check(knows(open), 'a player standing in the open on screen is noticed');
  t.check(!knows(leafy), 'one under a tree canopy is not');
  t.check(!knows(roofed), 'nor one under a roof');
  t.check(!knows(far), 'nor one beyond the edge of the screen (1000 units to the side)');
  t.check(!knows(ghost), 'nor one who drank an Invisibility Potion');
  // Muzzle flashes give a hidden shooter away.
  leafy.controller = () => ({ mx: 0, my: 0, aimX: 9500, aimY: 8000, fire: true });
  t.check(a.until(() => knows(leafy), 3) >= 0, 'shooting from under the tree gives the position away');
  // Radar marks even invisible players.
  b.p.fx.radar = 30;
  t.check(a.until(() => knows(ghost), 3) >= 0, 'radar shows the invisible one');
  // Inside the same building the roof is no cover.
  const a2 = arena({ extra: { buildings: [room(9000, 9000)] } });
  a2.crowd();
  const b2 = a2.plant(a2.bot(9100, 9100, {})), h2 = a2.human(9230, 9200, still);
  t.check(a2.until(() => !!(b2.known.get(h2.id) && b2.known.get(h2.id).noticed), 2) >= 0, 'two players in the same building see each other');
}
{
  // Noticing takes time, and more of it for a weaker bot.
  const seen = (skill) => {
    let sum = 0;
    for (let k = 0; k < 12; k++) {
      const a = arena({ seed: 20 + k });
      a.crowd();
      const b = a.plant(a.bot(9000, 9000, { skill }));
      a.step(0.5);
      const h = a.human(9000 + 500, 9000 + 150, still);
      sum += a.until(() => !!(b.known.get(h.id) && b.known.get(h.id).noticed), 5);
    }
    return sum / 12;
  };
  const slow = seen(0.2), quick = seen(0.9);
  t.check(quick >= 0.15 && quick < 0.6, 'a sharp bot notices someone walking into view in a fraction of a second, not instantly (' + quick.toFixed(2) + ' s)');
  t.check(slow > quick + 0.2 && slow < 1.6, 'a weak one takes clearly longer (' + slow.toFixed(2) + ' s)');
}

// ---------------------------------------------------------------- fighting
// How well a bot of each skill hits a strafing target at 300 (feet locked so only the aim is measured).
function accuracy(skill, strafe, d = 300) {
  let hits = 0, shots = 0;
  for (let k = 0; k < 4; k++) {
    const a = arena({ seed: 11 + k * 31 });
    const b = a.bot(9000, 9000, { skill, aggression: 0.9 });
    const dummy = a.human(9000 + d, 9000, null, { hp: 1e7 });
    b.stance = () => 'fight';
    const think = b.think.bind(b);
    b.think = (dt) => { const o = think(dt); o.mx = 0; o.my = 0; return o; };
    const rng = W.U.rng(k * 7 + 3);
    let side = 1, flip = 0;
    dummy.controller = (p, w) => {
      if (!strafe) return null;
      if (w.time >= flip) { side = rng.next() < 0.5 ? 1 : -1; flip = w.time + rng.range(0.35, 1.3); }
      const dx = p.x - b.p.x, dy = p.y - b.p.y, dd = Math.hypot(dx, dy) || 1, pull = dd > d + 30 ? -0.5 : dd < d - 30 ? 0.5 : 0;
      return { mx: -dy / dd * side + dx / dd * pull, my: dx / dd * side + dy / dd * pull, aimX: b.p.x, aimY: b.p.y };
    };
    a.step(30);
    hits += b.p.stats.hits; shots += b.p.stats.shots;
  }
  return shots ? hits / shots : 0;
}
{
  const weak = accuracy(0.2, true), mid = accuracy(0.5, true), sharp = accuracy(0.9, true), standing = accuracy(0.5, false);
  t.check(weak > 0.08 && weak < 0.3, 'a weak bot lands roughly one bullet in five on a strafing target (' + (weak * 100).toFixed(0) + '%)');
  t.check(mid > weak && mid > 0.2 && mid < 0.45, 'an average bot about one in three (' + (mid * 100).toFixed(0) + '%)');
  t.check(sharp > mid + 0.1 && sharp < 0.75, 'the sharpest clearly more, and still nowhere near all of them (' + (sharp * 100).toFixed(0) + '%)');
  t.check(standing > 0.6 && standing > mid + 0.2, 'standing still gives an average bot at least 60% hits and at least 20 points more than dodging (' + (standing * 100).toFixed(0) + '%)');
}
{
  // Shot at: fights back, and beats someone who cannot aim.
  const a = arena();
  a.crowd();
  const b = a.bot(9000, 9000, { skill: 0.55 });
  const h = a.human(9400, 9000, null, { hp: 100 });
  h.controller = sprayer(a, b, 300);
  const time = a.until(() => !h.alive || !b.p.alive, 40);
  t.check(!h.alive && b.p.alive, 'a bot that is shot at shoots back, and wins against a player who cannot aim (' + time.toFixed(1) + ' s, ' + Math.round(b.p.hp) + ' HP left)');
  t.check(a.count('shot', (e) => e.player === b.p) >= 10, 'with its own gun, one bullet at a time');
}
{
  // Left alone, a bot mostly leaves a harmless player alone right after landing; when the circle is small it does not.
  let early = 0, late = 0;
  const N = 24;
  for (let k = 0; k < N; k++) {
    const a = arena({ seed: 300 + k });
    a.crowd();
    const b = a.bot(9000, 9000, {}), h = a.human(9450, 9000, still, { hp: 1e6 });
    b.landAt = 0; b.prof.aggression = 0.5;
    if (a.until(() => h.hp < 1e6, 18) >= 0) early++;
    const a2 = arena({ seed: 300 + k });
    const b2 = a2.bot(9000, 9000, {}), h2 = a2.human(9450, 9000, still, { hp: 1e6 });
    b2.prof.aggression = 0.5;
    if (a2.until(() => h2.hp < 1e6, 18) >= 0) late++;       // no crowd: these two are the last ones standing
  }
  t.check(early <= N * 0.2, 'fresh off the parachute, few bots pick a fight with a player who is leaving them alone (' + early + ' of ' + N + ' within 18 s)');
  t.check(late >= N * 0.6, 'with only two left on the island, most do (' + late + ' of ' + N + ')');
}
{
  // The first seconds on the ground belong to the player: not even the most trigger-happy bot opens fire on someone
  // who has only just landed and done nothing. Shoot at it, though, and it shoots back at once.
  let unprovoked = 0, answered = 0;
  const N = 16, M = 64;
  for (let k = 0; k < M; k++) {
    // A squad of the keenest bots there are around one player (without the rule, about one such bot in ten goes for them).
    const a = arena({ seed: 500 + k, teams: true, teamSize: 4 });
    a.crowd();
    const h = a.human(9000, 9000, still, { hp: 1e6, team: 2 });
    for (const [x, y] of [[9330, 9000], [8670, 9000], [9000, 9330], [9000, 8670]]) { const b = a.bot(x, y, { aggression: 0.95, skill: 0.8 }, { team: 1 }); b.landAt = 0; b.pauseUntil = 1e9; }
    if (a.until(() => h.hp < 1e6, 12) >= 0) unprovoked++;
  }
  for (let k = 0; k < N; k++) {
    const a2 = arena({ seed: 500 + k });
    a2.crowd();
    const b2 = a2.bot(9000, 9000, { aggression: 0.2 }), h2 = a2.human(9330, 9000, null, { hp: 1e6 });
    b2.landAt = 0;
    h2.controller = shootAt(b2.p);
    if (a2.until(() => h2.hp < 1e6, 4) >= 0) answered++;
  }
  t.equal(unprovoked, 0, 'for the first twelve seconds after landing no bot, however aggressive, shoots a player who has done nothing (' + M + ' landings with four such bots around)');
  t.check(answered >= N - 1, 'a player who opens fire in those seconds gets fire back all the same (' + answered + ' of ' + N + ' within 4 s)');
}
{
  // Two bots that had both decided to leave the other alone: in the open they walk on, in the same room they do not.
  const pair = (a) => {
    const x = a.bot(9080, 9100, { aggression: 0.2 }), y = a.bot(9240, 9200, { aggression: 0.2 });
    x.engage.set(y.p.id, { fight: false, hp: 1, until: 1e9 }); y.engage.set(x.p.id, { fight: false, hp: 1, until: 1e9 });
    x.pauseUntil = y.pauseUntil = 1e9;                       // both stay where they are unless a fight moves them
  };
  const open = arena(); open.crowd(); pair(open);
  open.step(8);
  t.equal(open.count('damage'), 0, 'two bots 190 units apart in the open, neither looking for a fight, leave each other be');
  const indoors = arena({ extra: { buildings: [room(9000, 9000)] } }); indoors.crowd(); pair(indoors);
  t.check(indoors.until(() => indoors.count('damage', (e) => e.source && e.source.bot && e.target.bot) > 0, 8) >= 0, 'the same two in the same room fight: nobody loots a house with an armed stranger standing in it');
}
{
  // Going looking for someone ends in a fight, not in walking up to them and standing there.
  const a = arena();
  for (let i = 0; i < 4; i++) a.human(3200 + i * 90, 3200, still, { team: 1000 + i });   // six alive: late in a match, not yet the last three
  a.world.time = 320;
  const b = a.bot(9000, 9000, { aggression: 0.7 }), h = a.human(9700, 9000, still, { hp: 500 });
  b.landAt = 0;
  b.engage.set(h.id, { fight: false, hp: 1, until: 1e9 });   // it already looked at this one once and let them be
  const hit = a.until(() => h.hp < 500, 10);
  t.check(hit >= 0, 'late in a match a bot that walks over to someone it can see opens fire when it gets there (' + hit.toFixed(1) + ' s)');
  // Hurt, it does not go looking for anyone.
  const a2 = arena();
  for (let i = 0; i < 4; i++) a2.human(3200 + i * 90, 3200, still, { team: 1000 + i });
  a2.world.time = 320;
  const b2 = a2.bot(9000, 9000, { aggression: 0.7, caution: 0.5 }, { hp: 30 }), h2 = a2.human(9700, 9000, still, { hp: 500 });
  b2.landAt = 0;
  a2.step(10);
  t.check(h2.hp === 500 && a2.count('shot', (e) => e.player === b2.p) === 0 && dist(b2.p, h2) > 500, 'with 30 HP it does not: it keeps its distance (' + Math.round(dist(b2.p, h2)) + ' units)');
}
{
  // Not through walls.
  const wall = { id: 0, x: 9150, y: 8700, w: 30, h: 600, doors: [], roof: '#000', fade: 1, walls: [{ x: 9150, y: 8700, w: 30, h: 600 }] };
  const a = arena({ extra: { buildings: [wall] } });
  const b = a.bot(9000, 9000, { aggression: 0.9 }), h = a.human(9330, 9000, still, { hp: 400 });
  b.stance = () => 'fight';
  b.think = ((think) => (dt) => { const o = think(dt); o.mx = 0; o.my = 0; return o; })(b.think.bind(b));
  a.step(6);
  t.equal(a.count('shot', (e) => e.player === b.p), 0, 'a bot does not fire at someone it has no line to (a wall in between, six seconds, no shots)');
}
// Each class uses its own weapons.
// Projectile users spend actual simulation time charging instead of requesting instant full-range shots.
{
  const quietBot = (classId) => {
    const a = arena(), b = a.bot(9000, 9000, { aimSigma: 0 }, { classId });
    b.decide = () => {}; b.sense = () => {}; b.scanHazards = () => {}; b.steer = () => {};
    return { a, b };
  };
  for (const classId of ['grenadier', 'grenadier2']) {
    const { a, b } = quietBot(classId), def = W.WEAPONS[b.p.weapons[0].id];
    let target = { x: b.p.x + def.range, y: b.p.y };
    b.runMode = function () { this.shoot = { ...target, r: 24, def, crate: target }; };
    b.runItems = () => {};
    a.step(0.4);
    target = { ...target }; // a different target cancels the partial charge
    a.step(0.4);
    t.equal(a.count('launch'), 0, classId + ': retargeting cancels the old charge instead of releasing early');
    a.step(0.4);
    const launch = a.events.find(e => e.type === 'launch');
    t.check(launch && Math.abs(Math.hypot(launch.targetX - 9000, launch.targetY - 9000) - def.range) < 0.01, classId + ': a full timed charge reaches the configured maximum');
  }
  {
    const { a, b } = quietBot('soldier');
    a.world.addItem(b.p, 'firenade', 1);
    b.p.held = 0;
    b.useItem(0, { aim: { x: 9560, y: 9000 } });
    b.act.phase = 1; b.act.wait = 0;
    b.runMode = () => {};
    a.step(0.7);
    t.check(a.used('firenade') === 0 && b.p.items[0].n === 1, 'a bot holds its grenade item without consuming it while charging');
    a.step(0.1);
    const thrown = a.events.find(e => e.type === 'throw');
    t.check(thrown && Math.abs(thrown.targetX - 9560) < 0.01 && a.used('firenade') === 1, 'a grenade item releases once at the fully charged range');
  }
  {
    const { a, b } = quietBot('grenadier');
    let requested = false;
    b.runItems = () => {};
    b.runMode = function () { if (!requested) { this.out.utility = true; this.clickAt = { x: 9560, y: 9000 }; requested = true; } };
    a.step(0.7);
    t.equal(a.count('throw'), 0, 'the class grenade shortcut also waits while charging');
    a.step(0.1);
    const thrown = a.events.find(e => e.type === 'throw');
    t.check(thrown && Math.abs(thrown.targetX - 9560) < 0.01 && b.p.grenades === W.WEAPONS.grenade.count - 1, 'the charged class grenade lands at range and consumes exactly one grenade');
  }
}
function classFight(classId, d, seconds = 14, o = {}) {
  const a = arena({ seed: o.seed || 5 });
  a.crowd();
  const b = a.bot(9000, 9000, { skill: 0.7, aggression: o.aggression || 0.9 }, { classId });
  const h = a.human(9000 + d, 9000, null, { hp: o.hp || 900 });
  h.controller = o.brain ? o.brain(a, b, h) : sprayer(a, b, 420);
  b.stance = () => 'fight';
  let minD = Infinity, maxD = 0, scoped = false, slots = new Set();
  for (let i = 0; i < seconds / TICK && h.alive && b.p.alive; i++) { a.tick(); const dd = dist(b.p, h); minD = Math.min(minD, dd); maxD = Math.max(maxD, dd); if (b.p.scoping) scoped = true; slots.add(b.p.weapons[b.p.slot].id); }
  const dmg = (cause) => a.events.filter((e) => e.type === 'damage' && e.source === b.p && e.target === h && (!cause || e.cause === cause)).reduce((n, e) => n + e.amount, 0);
  return { a, b, h, minD, maxD, scoped, slots, dmg, selfHurt: a.count('damage', (e) => e.target === b.p && e.source === b.p) };
}
{
  let r = classFight('sniper', 900);
  t.check(r.scoped && r.dmg('sniper') >= 95, 'a Sniper scopes in and lands rifle shots from 900 away (' + Math.round(r.dmg('sniper')) + ' damage)');
  r = classFight('sniper', 180, 8);
  t.check(r.slots.has('pistol') && r.dmg('pistol') > 0, 'and pulls the pistol when someone is in its face');
  r = classFight('shotgunner', 500, 10);
  t.check(r.minD < 200 && r.dmg('shotgun') >= 100, 'a Shotgunner closes in and uses the shotgun (got to ' + Math.round(r.minD) + ' units, ' + Math.round(r.dmg('shotgun')) + ' damage)');
  r = classFight('grenadier', 450, 14);
  t.check(r.dmg('launcher') > 30 && r.selfHurt === 0, 'a Grenadier shells from a distance without blowing itself up (' + Math.round(r.dmg('launcher')) + ' launcher damage)');
  r = classFight('grenadier', 120, 6);
  t.check(r.maxD > 230 && r.selfHurt === 0, 'and backs off from someone standing on top of it instead of shelling its own feet');
  r = classFight('juggernaut', 380, 10);
  t.check(r.dmg('minigun') > 150, 'a Juggernaut spins the minigun up and keeps it on target (' + Math.round(r.dmg('minigun')) + ' damage)');
  r = classFight('pyromancer', 420, 10);
  t.check(r.minD < 300 && r.dmg('flamethrower') > 100, 'a Pyromancer walks into flame range and burns (' + Math.round(r.dmg('flamethrower')) + ' damage)');
  r = classFight('pyromancer', 520, 10, { aggression: 0.2 });
  t.check(r.dmg('revolver') >= 150 && r.minD > 200, 'a careful one stays back and uses the revolver instead (one click per shot, ' + Math.round(r.dmg('revolver')) + ' damage)');
  // (With the airstrike at 225 radius the Commander no longer has to stand far back from it, so it trades shots at
  // pistol range while the bombs are on their way: against a poor shot, or it would not live to see them land.)
  r = classFight('commander', 700, 9, { brain: (a, b) => sprayer(a, b, 800) });
  t.check(r.a.count('command') === 1 && r.b.p.alive && r.dmg('airstrike') >= W.WEAPONS.commandradar.strikeDamage, 'a Commander calls the radar boost and drops the airstrike on the enemy, not on itself');
  r = classFight('medic', 400, 12, { hp: 300 });
  t.check(r.a.count('heal', (e) => e.by === r.b.p) >= 1, 'a Medic uses the medkit when hurt');
  r = classFight('soldier', 420, 12, { brain: (a, b) => { const rng = W.U.rng(5); return () => ({ mx: 0, my: 0, aimX: b.p.x + (rng.next() - 0.5) * 420, aimY: b.p.y + (rng.next() - 0.5) * 420, fire: true }); } });
  t.check(r.a.count('reload', (e) => e.player === r.b.p) >= 1 && r.dmg() > 200, 'a Soldier empties magazines and reloads');
}
{
  // Kiting: a rifleman does not let a shotgunner walk up to it.
  const a = arena();
  a.crowd();
  const b = a.bot(9000, 9000, { skill: 0.6 });
  const h = a.human(9400, 9000, null, { classId: 'shotgunner', hp: 500 });
  h.controller = (p) => { const dx = b.p.x - p.x, dy = b.p.y - p.y, d = Math.hypot(dx, dy) || 1; return { mx: dx / d, my: dy / d, aimX: b.p.x, aimY: b.p.y, fire: d < 200 }; };
  b.stance = () => 'fight';
  let close = 0, n = 0;
  for (let i = 0; i < 8 / TICK && b.p.alive; i++) { a.tick(); n++; if (dist(b.p, h) < 170) close++; }
  t.check(close < n * 0.25, 'chased by a shotgun, a rifleman backs away while shooting instead of standing there (' + Math.round(close / n * 100) + '% of the time inside 170 units)');
}

// ---------------------------------------------------------------- staying alive
{
  // A partial path can point exactly into a sentry's danger circle. There is no residual tangent after
  // removing that inward component, but an open side is still usable (and a blocked side must be rejected).
  const a = arena({ extra: { rocks: [{ x: 9000, y: 8936, r: 16 }] } });
  const b = a.bot(9000, 9000);
  b.now = 1; b.pauseUntil = 0;
  b.moveGoal = { x: 10000, y: 9000, tol: 30 };
  b.route = { gx: 10000, gy: 9000, pts: [{ x: 9064, y: 9000 }], i: 0, partial: true, at: 1, cut: 10, blocked: 0 };
  b.hazards = [{ x: 9800, y: 9000, r: 780, d: 800 }];
  b.steer();
  const end = { x: b.p.x + b.out.mx * 64, y: b.p.y + b.out.my * 64 };
  t.check(Math.hypot(b.out.mx, b.out.my) > 0.9, 'a path aimed directly into a sentry danger circle takes an open side instead of freezing');
  t.check(dist(end, b.hazards[0]) >= 780 && b.nav.segmentClear(b.p.x, b.p.y, end.x, end.y), 'the sidestep stays outside the danger circle and does not cross nearby cover');
}
{
  // With no safe sidestep, an actual blocked errand must reach the existing route recovery. Waiting on
  // purpose (for a shot, a crate or a teammate) must still be left alone.
  const x = 8960, y = 8960, w = 80, h = 80, thick = 10;
  const a = arena({ extra: { buildings: [{ id: 0, x, y, w, h, doors: [], walls: [
    { x, y, w, h: thick }, { x, y: y + h - thick, w, h: thick },
    { x, y, w: thick, h }, { x: x + w - thick, y, w: thick, h }
  ] }] } });
  const b = a.bot(9000, 9000);
  b.now = 1; b.pauseUntil = 0;
  b.moveGoal = { x: 10000, y: 9000, tol: 30 };
  b.route = { gx: 10000, gy: 9000, pts: [{ x: 9028, y: 9000 }], i: 0, partial: true, at: 1, cut: 10, blocked: 0 };
  b.hazards = [{ x: 9800, y: 9000, r: 780, d: 800 }];
  b.steer();
  t.check(b.out.mx === 0 && b.out.my === 0 && b.stuck.n === 1 && b.route === null, 'a cancelled errand with no safe side step triggers route recovery instead of being mistaken for a deliberate wait');
  b.still = true; b.now += 0.6;
  b.steer();
  t.equal(b.stuck.n, 0, 'deliberately standing still does not trigger movement recovery');
}
{
  const dodged = (skill) => {
    let ok = 0;
    for (let k = 0; k < 16; k++) {
      const a = arena({ seed: 5 + k });
      const b = a.bot(9000, 9000, { skill });
      const h = a.human(9450, 9000, still, { classId: 'grenadier' });
      b.stance = () => 'ignore';
      b.pauseUntil = 1e9;                                    // standing around, not wandering out of the blast by luck
      a.step(1);
      a.world.throwGrenade(h, { aimX: b.p.x, aimY: b.p.y, charge: (dist(h, b.p) - 70) / (W.WEAPONS.grenade.throwRange - 70) * W.CONFIG.projectileChargeTime });
      const hp = b.p.hp;
      a.step(2.2);
      if (b.p.hp >= hp) ok++;
    }
    return ok;
  };
  const good = dodged(0.75), bad = dodged(0.15);
  t.check(good >= 12, 'a decent bot standing where a grenade lands walks out of the blast unhurt (' + good + ' of 16)');
  t.check(bad < good && bad <= 11 && bad >= 3, 'a weak one starts running too late more often (unhurt ' + bad + ' of 16)');
}
{
  // Hurt, with a stranger in plain view who is not shooting: back off out of their sight and patch up, without
  // starting anything and without spending the boulder on someone who is not even after it.
  let away = 0, healed = 0, kept = 0;
  const N = 8;
  for (let k = 0; k < N; k++) {
    const a = arena({ seed: 40 + k, extra: { rocks: [{ x: 8700, y: 9000, r: 70 }] } });
    a.crowd();
    const b = a.bot(9000, 9000, { caution: 0.6 }, { hp: 24, items: [['bandage', 3], ['rock', 1]] });
    const h = a.human(9480, 9000, still);
    b.roam = { x: 9800, y: 9000, at: 0, until: 1e9 };          // its errand leads straight past them
    let nearest = Infinity, gone = false;
    for (let i = 0; i < 6 / TICK; i++) { a.tick(); nearest = Math.min(nearest, dist(b.p, h)); if (!a.world.lineClear(b.p.x, b.p.y, h.x, h.y) || dist(b.p, h) > 650) gone = true; }
    if (gone && nearest > 260 && a.count('shot', (e) => e.player === b.p) === 0) away++;
    if (a.until(() => b.p.hp >= 60, 10) >= 0) healed++;
    if (a.world.countItem(b.p, 'rock') === 1 && h.hp === 100) kept++;
  }
  t.check(away >= N - 1, 'a bot on 24 HP whose way leads past someone turns back when it sees them and gets out of their sight, without starting anything (' + away + ' of ' + N + ')');
  t.check(healed >= N - 1 && kept === N, 'bandages itself there (' + healed + ' of ' + N + '), and keeps its boulder for when someone is actually shooting');
}
{
  // Fire, airstrikes and the storm.
  const a = arena();
  a.crowd();
  const b = a.bot(9000, 9000, {});
  const h = a.human(9700, 9700, still);
  a.world.addZone({ kind: 'fire', x: 9000, y: 9000, r: 300, dur: 5, owner: h.id, team: h.team, dps: 25 });
  const out = a.until(() => dist(b.p, { x: 9000, y: 9000 }) > 300, 4);
  t.check(out >= 0 && out < 2.2 && b.p.hp > 50, 'standing in someone\'s fire, a bot walks straight out (' + out.toFixed(1) + ' s, ' + Math.round(b.p.hp) + ' HP)');
  const a2 = arena();
  a2.crowd();
  const b2 = a2.bot(9000, 9000, {});
  a2.world.addStrike({ kind: 'airstrike', x: 9100, y: 9000, target: 0, t: 5, radius: 450, damage: 500, owner: 0, team: -1 });
  a2.step(5.5);
  t.check(b2.p.alive && b2.p.hp === 100, 'an airstrike marker on top of it: gone before the bombs land');
  // A crate in the middle of an airstrike is not worth it.
  const a3 = arena({ extra: { crates: [crate(0, 9500, 9000)] } });
  a3.crowd();
  const b3 = a3.bot(9000, 9000, {});
  b3.crates.add(0);
  a3.world.addStrike({ kind: 'airstrike', x: 9500, y: 9000, target: 0, t: 5, radius: 450, damage: 500, owner: 0, team: -1 });
  a3.step(5.4);
  t.check(b3.p.alive && b3.p.hp === 100, 'and it does not walk into one for a crate');
}
{
  let inside = 0, total = 0;
  // Start on uncovered coast that the first closure will actually engulf, even on larger islands.
  for (let angle = 0; angle < Math.PI * 2 && total < 5; angle += Math.PI / 8) {
    const a = arena({ storm: true, seed: 5 });
    a.crowd();
    const c = a.world.storm.circles[1];
    let lo = 0, hi = W.CONFIG.worldSize * 2;
    for (let n = 0; n < 24; n++) {
      const r = (lo + hi) / 2;
      if (W.U.insideIsland(c.x + Math.cos(angle) * r, c.y + Math.sin(angle) * r, 150, W.CONFIG.worldSize, W.CONFIG.cornerRadius)) lo = r;
      else hi = r;
    }
    if (lo < c.r + 500) continue;
    const b = a.bot(c.x + Math.cos(angle) * lo, c.y + Math.sin(angle) * lo, {});
    a.world.time = W.STORM[0].start - 32;
    const end = W.STORM[0].end + 45;
    while (a.world.time < end && b.p.alive) a.tick();
    total++;
    if (b.p.alive && Math.hypot(b.p.x - c.x, b.p.y - c.y) < c.r) inside++;
  }
  t.equal(total, 5, 'five coastal starting points are outside the upcoming first circle');
  t.equal(inside, total, 'wherever it is on the island, a bot is inside the first circle when the storm has closed (' + inside + ' of ' + total + ')');
}
{
  // Hurt and alone: heals.
  const a = arena();
  a.crowd();
  const b = a.bot(9000, 9000, {}, { items: [['bandage', 3], ['health', 1]], hp: 22 });
  const took = a.until(() => b.p.hp >= 97, 12);
  t.check(took >= 0 && a.used('health') === 1, 'badly hurt and safe: the Health Potion goes down first (back to ' + Math.round(b.p.hp) + ' HP in ' + took.toFixed(1) + ' s)');
  t.equal(a.used('bandage'), 0, 'and the bandages are kept for when they are needed (3 HP missing is not it)');
  const a2 = arena();
  a2.crowd();
  const b2 = a2.bot(9000, 9000, {}, { items: [['bandage', 3]], hp: 55 });
  a2.step(8);
  t.check(a2.used('bandage') === 2 && b2.p.hp === 95, 'bandages one after another until another one would be wasted (55 -> 95 HP with two)');
}
// Getting out of a losing fight on a real island: the plays happen, and they are the ones a player would make.
function escape(items, k, o = {}) {
  const map = W.MapGen.generate(5);
  map.crates = []; map.pickups = [];
  const a = arena({ map, seed: 5 + k });
  a.crowd();
  const rng = W.U.rng(5 * 31 + k * 7 + 1);
  let x, y, hx, hy;
  for (let i = 0; i < 400; i++) {
    x = rng.range(4000, 15000); y = rng.range(4000, 15000);
    const ang = rng.range(0, 6.283);
    hx = x + Math.cos(ang) * 380; hy = y + Math.sin(ang) * 380;
    if (a.dir.nav.freeAt(x, y) && a.dir.nav.freeAt(hx, hy) && !a.dir.nav.pondAt(x, y) && a.dir.cover.buildingAt(x, y) < 0 && a.dir.cover.buildingAt(hx, hy) < 0 && a.world.lineClear(x, y, hx, hy)) break;
  }
  const b = a.bot(x, y, { skill: 0.55, caution: 0.6, aggression: 0.5 }, { items });
  const h = a.human(hx, hy, null, { hp: o.humanHp || 300 });
  // Record the choice at the moment it is made. Generated terrain may leave no
  // room for a boulder, or already block the bullets; snow-first is valid then.
  let firstEscape = null;
  const useItem = b.useItem.bind(b);
  b.useItem = (idx, opts) => {
    const id = b.p.items[idx]?.id;
    if (!firstEscape && (id === 'rock' || id === 'snowbomb')) {
      const e = b.target;
      firstEscape = { id, canBlock: !!e && e.visible && a.world.lineClear(b.p.x, b.p.y, e.ref.x, e.ref.y) && !!b.rockSpot(e) };
    }
    return useItem(idx, opts);
  };
  let err = 0;
  const trail = [];
  h.controller = (p) => {          // chases, aims where the bot was a moment ago with a wobble, cannot see through leaves or potions
    const vis = !(b.p.fx.invisible > 0) && !a.dir.cover.hidden(p, b.p) && Math.abs(b.p.x - p.x) < 900 && Math.abs(b.p.y - p.y) < 506;
    if (!vis) return null;
    trail.push({ x: b.p.x, y: b.p.y }); if (trail.length > 4) trail.shift();
    err += (rng.next() + rng.next() - 1) * 0.035 - err * 0.12;
    const dx = trail[0].x - p.x, dy = trail[0].y - p.y, d = Math.hypot(dx, dy) || 1, ang = Math.atan2(dy, dx) + err, go = d > 260 ? 1 : 0;
    return { mx: dx / d * go, my: dy / d * go, aimX: p.x + Math.cos(ang) * d, aimY: p.y + Math.sin(ang) * d, fire: d < 900 && a.world.lineClear(p.x, p.y, b.p.x, b.p.y), firePressed: false };
  };
  const t0 = a.world.time;
  while (a.world.time - t0 < 25 && b.p.alive && h.alive) a.tick();
  return { a, b, h, firstEscape, used: (id) => a.used(id, b.p) };
}
{
  const N = 16, tally = { rock: 0, snowbomb: 0, combo: 0, rockFirst: 0, eligible: 0, rockPriority: 0, smoke: 0, invisibility: 0, alive: 0, bandage: 0 };
  for (let k = 0; k < N; k++) {
    const r = escape([['snowbomb', 1], ['rock', 1], ['bandage', 3]], k);
    if (r.used('rock')) tally.rock++;
    if (r.used('snowbomb')) tally.snowbomb++;
    if (r.used('rock') && r.used('snowbomb')) {
      tally.combo++;
      const order = r.a.events.filter((e) => e.type === 'item-used' && e.player === r.b.p && (e.item === 'rock' || e.item === 'snowbomb')).map((e) => e.item);
      if (order[0] === 'rock') tally.rockFirst++;
    }
    if (r.firstEscape?.canBlock) { tally.eligible++; if (r.firstEscape.id === 'rock') tally.rockPriority++; }
    if (r.used('bandage')) tally.bandage++;
  }
  t.check(tally.snowbomb >= N * 0.35 && tally.rock >= N * 0.35, 'losing a fight with a Snowbomb and a Rock in the hotbar, a bot uses them to get away (' + tally.snowbomb + ' and ' + tally.rock + ' of ' + N + ' fights; it wins some outright)');
  t.check(tally.combo >= 3 && tally.eligible >= 3 && tally.rockPriority === tally.eligible, 'uses the pair and prioritises the boulder whenever exposed with room to place it (' + tally.combo + ' pairs, ' + tally.rockFirst + ' rock-first, ' + tally.rockPriority + '/' + tally.eligible + ' eligible choices)');
  t.check(tally.bandage >= 2, 'and patches itself up behind the boulder when it gets the chance (' + tally.bandage + ' fights)');
  let never = 0;
  for (let k = 0; k < 8; k++) { const r = escape([['snowbomb', 1], ['rock', 1]], k, { humanHp: 30 }); if (!r.used('rock') && !r.used('snowbomb')) never++; }
  t.check(never >= 6, 'in a fight it is winning it keeps both in its pocket (' + never + ' of 8): they are for trouble, not for show');
  for (let k = 0; k < N; k++) { const r = escape([['invisibility', 1]], k); if (r.used('invisibility')) tally.invisibility++; if (r.b.p.alive) tally.alive++; const s = escape([['smoke', 1], ['bandage', 3]], k); if (s.used('smoke')) tally.smoke++; }
  t.check(tally.invisibility >= N * 0.4 && tally.alive >= N * 0.8, 'an Invisibility Potion gets drunk when a fight turns, and it works (' + tally.invisibility + ' uses, ' + tally.alive + ' of ' + N + ' bots alive after 25 s)');
  t.check(tally.smoke >= N * 0.4, 'smoke goes down to break the line of sight (' + tally.smoke + ' of ' + N + ')');
}

// ---------------------------------------------------------------- loot and upgrades
{
  // A station under a known sentry is not a reachable errand: movement correctly refuses the danger zone.
  // This used to alternate between two tangents for minutes while the short stuck detector saw movement.
  const near = { id: 0, number: 1, x: 9500, y: 9000, cooldown: 0 };
  const safe = { id: 1, number: 2, x: 7600, y: 9000, cooldown: 0 };
  const a = arena({ extra: { stations: [near, safe] } });
  const b = a.bot(9000, 9000, {}, { tokens: 8, plan: ['shotgunner', 'juggernaut'] });
  b.now = 1;
  t.check(b.pickStation() && b.station.st === near, 'an unobstructed nearby station is initially selected');
  b.hazards = [{ kind: 'sentry', x: 10000, y: 9000, r: 780, d: 1000 }];
  t.check(b.pickStation() && b.station.st === safe, 'a new sentry hazard invalidates even a still-cached station and selects a safe alternative');
  b.hazards = []; b.now = 4;
  t.check(b.pickStation() && b.station.st === near, 'when that danger clears the nearer station is immediately eligible again');
  b.mode = 'upgrade'; b.redecide = false; b.doUpgrade();
  t.check(b.moveGoal && b.moveGoal.x === near.x, 'the bot begins walking toward its chosen upgrade station');
  b.route = { gx: near.x, gy: near.y, pts: [near], i: 0 };
  b.hazards = [{ kind: 'sentry', x: 10000, y: 9000, r: 780, d: 1000 }];
  b.doUpgrade();
  t.check(!b.station && !b.moveGoal && !b.route && b.redecide, 'a hazard appearing en route cancels the impossible errand before boundary oscillation');
  b.hazards = []; b.now = 4.1;
  t.check(b.pickStation() && b.station.st === near && !b.badStation.has(near.id), 'temporary danger does not permanently blacklist the station');
}
{
  const a = arena({ extra: { crates: [crate(0, 9600, 9100)] } });
  a.crowd();
  const b = a.bot(9000, 9000, {});
  const broke = a.until(() => !a.map.crates[0].alive, 14);
  const got = a.until(() => b.p.tokens > 0 && !a.map.pickups.some((pk) => pk.alive && pk.type === 'token'), 8);
  t.check(broke >= 0 && got >= 0, 'a crate in sight: shot open in ' + broke.toFixed(1) + ' s, tokens swept up ' + got.toFixed(1) + ' s later (' + b.p.tokens + ')');
  t.check(a.count('damage') === 0 && dist(b.p, a.map.crates[0]) < 200, 'from close up, hurting nobody');
}
{
  // A crate indoors has to be found: look inside the building, then go in and open it.
  const b0 = room(9000, 9000);
  const a = arena({ extra: { buildings: [b0], crates: [crate(0, 9200, 9110)] } });
  a.crowd();
  const b = a.bot(9160, 8500, {});
  a.step(0.6);
  t.check(!b.crates.has(0), 'a crate under a roof is not visible from outside');
  const broke = a.until(() => !a.map.crates[0].alive, 25);
  t.check(broke >= 0 && b.visited.has(0), 'so the bot checks the building, finds it and opens it (' + broke.toFixed(1) + ' s)');
  t.check(a.until(() => b.p.tokens > 0, 8) >= 0, 'and walks in through the door for the tokens');
}
{
  // Items: pick up with the interact key, and when the hotbar is full swap out the least useful stack.
  const a = arena();
  a.crowd();
  const b = a.bot(9000, 9000, {});
  a.world.spawnPickup('item', 9250, 9000, 3, false, 'bandage');
  t.check(a.until(() => a.world.countItem(b.p, 'bandage') === 3, 8) >= 0, 'an item on the ground: walked to and picked up');
  a.world.addItem(b.p, 'smoothie', 1); a.world.addItem(b.p, 'energybar', 1);
  a.world.spawnPickup('item', 9000, 9300, 5, false, 'lightning');
  const swapped = a.until(() => a.world.countItem(b.p, 'lightning') === 5, 10);
  t.check(swapped >= 0 && a.count('item-dropped', (e) => e.player === b.p) === 1, 'hotbar full and a Lightning Strike on the ground: one stack is dropped to make room');
  t.check(a.world.countItem(b.p, 'bandage') === 3 && a.world.countItem(b.p, 'energybar') === 0, 'the least useful one (the Energy Bar went, the bandages stayed)');
  a.clear();
  a.world.spawnPickup('item', 9200, 9200, 1, false, 'smoothie');
  a.step(6);
  t.check(a.count('item-dropped') === 0 && a.world.countItem(b.p, 'lightning') === 5, 'and nothing better is given up for a Smoothie');
}
{
  const a = arena({ extra: { stations: [{ id: 0, number: 1, x: 9800, y: 9000, cooldown: 0 }] } });
  a.crowd();
  const b = a.bot(9000, 9000, {}, { tokens: 8, plan: ['shotgunner', 'juggernaut'] });
  const first = a.until(() => b.p.classId === 'shotgunner', 15);
  t.check(first > 3 && b.p.tokens === 0 && a.map.stations[0].cooldown > 80, 'eight tokens: walks to the Upgrade Station and takes its level-one class (' + first.toFixed(1) + ' s, not instantly)');
  b.p.tokens = 15;
  a.step(6);
  t.equal(b.p.classId, 'shotgunner', 'the station is recharging: no second upgrade without a key');
  b.p.keys = 1;
  t.check(a.until(() => b.p.classId === 'juggernaut', 8) >= 0 && b.p.keys === 0, 'with a station key it takes the level-two class straight away and the key is spent');
}
{
  // Somebody hanging about at the door of a house: a bot that was going to look inside leaves it for later.
  const b0 = room(9000, 9000);
  const a = arena({ extra: { buildings: [b0], crates: [crate(0, 9200, 9110)] } });
  a.crowd();
  const b = a.bot(9160, 8500, { aggression: 0.2 }), h = a.human(9160, 9350, still);
  b.engage.set(h.id, { fight: false, hp: 1, until: 1e9 });
  let nearest = Infinity, inside = false;
  for (let i = 0; i < 20 / TICK; i++) { a.tick(); nearest = Math.min(nearest, dist(b.p, h)); if (a.dir.cover.buildingAt(b.p.x, b.p.y) >= 0) inside = true; }
  t.check(!inside && !b.visited.has(0) && nearest > 110 && h.hp === 100, 'with a stranger standing at its door a bot does not go into the house (never closer than ' + Math.round(nearest) + ' units to them)');
}
{
  // On a team nobody stands at a recharging Upgrade Station for a minute waiting for a teammate's turn.
  const a = arena({ teams: true, extra: { stations: [{ id: 0, number: 1, x: 9500, y: 9000, cooldown: 80 }] } });
  a.crowd();
  const lead = a.bot(9000, 9000, {}, { team: 1 }), tail = a.bot(9080, 9000, {}, { team: 1, tokens: 8, plan: ['shotgunner', 'juggernaut'] });
  let waiting = 0;
  for (let i = 0; i < 40 / TICK; i++) { a.tick(); if (lead.mode === 'upgrade' && lead.still) waiting += TICK; }
  t.check(waiting < 14 && tail.p.classId === 'soldier', 'a teammate has the tokens but the station was just used: the leader does not park there (' + waiting.toFixed(0) + ' s of 40 spent waiting at it)');
  const upgraded = a.until(() => tail.p.classId === 'shotgunner', 90) >= 0;
  // The shopper may use the full 1500-unit team leash; give the pair a few steps to regroup after buying.
  t.check(upgraded && a.until(() => dist(lead.p, tail.p) < 1300, 5) >= 0, 'once it has recharged the teammate takes its class and the pair regroups');
}

// ---------------------------------------------------------------- items in a fight
function duel(items, d, o = {}) {
  const a = arena({ seed: o.seed || 5 });
  if (!o.last) a.crowd();
  const b = a.bot(9000, 9000, Object.assign({ skill: 0.8, aggression: 0.9, caution: 0.5 }, o.profile), { items, classId: o.classId, hp: o.hp });
  const h = a.human(9000 + d, 9000, null, { hp: o.humanHp || 600, classId: o.humanClass });
  h.controller = o.brain ? o.brain(a, b, h) : sprayer(a, b, o.spray === undefined ? 260 : o.spray);
  b.stance = o.stance || (() => 'fight');
  return { a, b, h };
}
const usedIn = (a, b, item, seconds) => a.until(() => a.used(item, b.p) > 0, seconds);
{
  for (const [item, d, why] of [['poison', 400, 'thrown at them'], ['firenade', 450, 'on someone standing still'], ['grenade', 420, 'on someone standing still'], ['lightning', 500, 'called on them'],
    ['meteor', 600, 'on someone standing still'], ['sentry', 400, 'set up to cover the fight'], ['sentry2', 400, 'set up to cover the fight'], ['strength', 500, 'drunk as the fight starts'],
    ['shield', 500, 'drunk as the fight starts'], ['power', 500, 'drunk as the fight starts'], ['overheal', 500, 'drunk as the fight starts']]) {
    const { a, b } = duel([[item, W.ITEMS[item].found]], d);
    t.check(usedIn(a, b, item, 14) >= 0, W.ITEMS[item].name + ': ' + why);
  }
  let r = duel([['grenade', 2]], 420, { brain: (a, b) => (p) => { const dx = p.x - b.p.x, dy = p.y - b.p.y, d = Math.hypot(dx, dy) || 1; return { mx: -dy / d, my: dx / d, aimX: b.p.x + 300, aimY: b.p.y, fire: true }; } });
  r.a.step(10);
  t.equal(r.a.used('grenade', r.b.p), 0, 'a grenade is not wasted on someone who is running about in the open');
  r = duel([['flashbang', 1]], 420, { classId: 'shotgunner' });
  t.check(usedIn(r.a, r.b, 'flashbang', 10) >= 0 && dist(r.b.p, r.h) > 150, 'Flash Bang: a Shotgunner throws it before going in, not after');
  r = duel([['flashbang', 1]], 420);
  r.a.step(8);
  t.equal(r.a.used('flashbang', r.b.p), 0, 'a rifleman with no plan to rush keeps it');
  r = duel([['blackhole', 1], ['grenade', 2]], 480);
  const hole = usedIn(r.a, r.b, 'blackhole', 12), nade = usedIn(r.a, r.b, 'grenade', 5);
  t.check(hole >= 0 && nade >= 0 && nade < 2, 'Black Hole Grenade with a follow-up: hole first, grenade into the same spot ' + nade.toFixed(1) + ' s later');
  r.a.step(3);
  t.check(r.a.count('pulled', (e) => e.player === r.h) === 1 && r.a.events.some((e) => e.type === 'damage' && e.target === r.h && e.cause === 'grenade'), 'the player is pulled in and caught by the blast');
  r = duel([['blackhole', 1]], 480, { classId: 'shotgunner' });
  usedIn(r.a, r.b, 'blackhole', 10);
  r.a.step(1.5);
  t.check(dist(r.b.p, r.h) < 320, 'for a Shotgunner the hole lands at its own feet: the enemy arrives in shotgun range (' + Math.round(dist(r.b.p, r.h)) + ' units)');
  r = duel([['blackhole', 1]], 480);
  r.a.step(8);
  t.equal(r.a.used('blackhole', r.b.p), 0, 'with no plan for whoever it pulls in, a rifleman does not throw it');
  const orbit = (a, b) => (p) => { const dx = p.x - b.p.x, dy = p.y - b.p.y, d = Math.hypot(dx, dy) || 1; return { mx: -dy / d, my: dx / d, aimX: b.p.x + 200, aimY: b.p.y + 200, fire: true }; };
  r = duel([['snowbomb', 1], ['meteor', 3]], 520, { brain: orbit });
  const snow = usedIn(r.a, r.b, 'snowbomb', 14), rockfall = usedIn(r.a, r.b, 'meteor', 10);
  t.check(snow >= 0 && rockfall >= 0, 'Snowbomb and Meteor Launcher: the snow pins a moving target, then the meteor lands on it');
  r = duel([['meteor', 3]], 520, { brain: orbit });
  r.a.step(8);
  t.equal(r.a.used('meteor', r.b.p), 0, 'a meteor alone is not thrown at someone who will have walked away by the time it lands');
  r = duel([['turret', 1]], 600);
  const placed = usedIn(r.a, r.b, 'turret', 12), mounted = r.a.until(() => r.b.p.mount > 0, 4);
  r.a.step(2);
  t.check(placed >= 0 && mounted >= 0 && r.a.count('shot', (e) => e.weapon === 'turret') > 3, 'Turret: put down, mounted and fired');
  r = duel([['turret', 1]], 600, { humanClass: 'shotgunner' });
  r.a.step(8);
  t.equal(r.a.used('turret', r.b.p), 0, 'but not against someone with a shotgun (sitting still is how you lose that)');
  r = duel([['shieldo', 1]], 300, { brain: marksman, humanClass: 'medic', humanHp: 2000 });
  const sh = usedIn(r.a, r.b, 'shieldo', 10), hpThen = r.b.p.hp;
  r.a.step(0.9);
  t.check(sh >= 0 && r.b.p.hp === hpThen && r.a.count('blocked', (e) => e.player === r.b.p) > 0, 'Shieldo Shieldo: when it is about to lose, and for the next second the bullets bounce off');
  r = duel([['power2', 1]], 300, { brain: marksman, humanClass: 'medic', humanHp: 2000 });
  t.check(usedIn(r.a, r.b, 'power2', 10) >= 0, 'Power Potion II: drunk (as an opener, or for the death immunity when it is nearly dead)');
  r = duel([['health', 1]], 350, { spray: 60, humanHp: 3000 });
  t.check(usedIn(r.a, r.b, 'health', 10) >= 0, 'a Health Potion mid-fight when it is that or lose');
  r = duel([['bandage', 3]], 350, { spray: 60, humanHp: 3000 });
  r.a.until(() => !r.b.p.alive, 8);
  t.equal(r.a.used('bandage', r.b.p), 0, 'but no stopping to bandage with bullets coming in');
}
{
  // Quiet-time items.
  let a = arena(); a.crowd();
  let b = a.bot(9000, 9000, {}, { items: [['mystery', 1], ['bandage', 3]] });
  t.check(usedIn(a, b, 'mystery', 12) >= 0, 'Mystery Potion: drunk when safe, healthy and holding a heal (it might be poison)');
  a = arena(); a.crowd();
  b = a.bot(9000, 9000, {}, { items: [['mystery', 1]], hp: 60 });
  a.step(10);
  t.equal(a.used('mystery'), 0, 'and left alone at 60 HP with nothing to heal with');
  a = arena(); a.crowd();
  b = a.bot(9000, 9000, {}, { items: [['firstaid', 1]], hp: 40 });
  t.check(usedIn(a, b, 'firstaid', 8) >= 0 && (a.step(16), b.p.hp > 99.5), 'First Aid Kit: started when hurt and safe, and it runs its course (' + b.p.hp.toFixed(1) + ' HP)');
  a = arena(); a.crowd();
  b = a.bot(9000, 9000, {}, { items: [['radar', 1]] });
  const sn = a.human(10000, 9300, null, { classId: 'sniper' });
  sn.controller = () => ({ mx: 0, my: 0, aimX: b.p.x, aimY: b.p.y, fire: true, scope: true });
  t.check(usedIn(a, b, 'radar', 14) >= 0, 'Radar: switched on when it is being shot from somewhere off its screen');
  a = arena(); a.crowd(40);
  b = a.bot(9000, 9000, {}, { items: [['drone', 1]] });
  a.world.players.filter((p) => p !== b.p).slice(0, 33).forEach((p) => a.world.killPlayer(p, null, 'test'));
  t.check(usedIn(a, b, 'drone', 10) >= 0, 'Drone: sent up late in the match to find the last players (8 of 41 left)');
  a = arena(); a.crowd(40);
  b = a.bot(9000, 9000, {}, { items: [['drone', 1]] });
  a.step(8);
  t.equal(a.used('drone'), 0, 'not while the island is still full');
  a = arena({ storm: true });
  a.world.time = 200; a.world.storm.update(TICK);
  b = a.bot(3000, 3000, {}, { items: [['energybar', 1]] });
  t.check(usedIn(a, b, 'energybar', 10) >= 0 && b.p.inStorm, 'Energy Bar: eaten when the storm has caught it and there is ground to cover');
  a = arena({ storm: true }); a.crowd();
  b = a.bot(a.world.storm.circles[1].x + 300, a.world.storm.circles[1].y, {}, { items: [['speed', 1]] });
  a.step(8);
  t.equal(a.used('speed'), 0, 'a Speed Potion is not drunk for a stroll');
}
{
  // Teleporter: one pad somewhere safe while things are quiet, the other when a fight is being lost.
  const a = arena({ storm: true });
  a.crowd();
  const c = a.world.storm.circles[1];
  const b = a.bot(c.x + 200, c.y + 200, { caution: 0.8 }, { items: [['teleporter', 2], ['bandage', 3]] });
  const home = usedIn(a, b, 'teleporter', 14);
  const pads = () => a.world.structures.filter((s) => s.kind === 'teleporter');
  t.check(home >= 0 && pads().length === 1 && a.world.countItem(b.p, 'teleporter') === 1, 'Teleporter: the first pad goes down while it is quiet, the second stays in the hotbar');
  const padAt = { x: pads()[0].x, y: pads()[0].y };
  b.p.x += 900; a.world.collide(b.p); b.route = null;
  const h = a.human(b.p.x + 330, b.p.y, null, { hp: 900 });
  h.controller = sprayer(a, b, 240, 3);
  const jumped = a.until(() => a.count('teleport', (e) => e.player === b.p) > 0, 25);
  t.check(jumped >= 0 && b.p.alive && dist(b.p, padAt) < 400, 'losing a fight 900 units away, it drops the second pad, stands on it and is back at the first (' + jumped.toFixed(1) + ' s into the fight)');
  t.check(pads().length === 2 && pads()[0].pair === pads()[1].id, 'the two pads are linked');
}
{
  // Sentries: shoot a small one, keep out of reach of a big one, and take a big one down from outside its range.
  const world = (item, at, classId) => {
    const a = arena({ storm: true });
    a.crowd();
    // A deliberately small upcoming circle isolates siege behavior from map/storm balance.
    const center = W.CONFIG.worldSize / 2;
    a.world.storm.circles[1] = { x: center, y: center, r: 2500 };
    a.world.storm.circles[2] = { x: center, y: center, r: 1600 };
    a.world.time = W.STORM[0].end + 5; a.world.storm.update(TICK);
    const c = a.world.storm.next, owner = a.human(c.x + 3000, c.y, still), it = W.ITEMS[item];
    const s = a.world.addStruct({ kind: 'sentry', item, x: c.x, y: c.y, r: 20, owner: owner.id, team: owner.team, hp: it.hp, maxHp: it.hp });
    return { a, s, b: a.bot(c.x + at, c.y, { skill: 0.6 }, { classId }) };
  };
  let r = world('sentry', 420);
  r.b.still = true;
  r.b.think = ((think) => (dt) => { const o = think(dt); o.mx = 0; o.my = 0; return o; })(r.b.think.bind(r.b));
  t.check(r.a.until(() => !r.s.alive, 8) >= 0, 'a small Sentry that has a bot in its sights gets shot down (50 HP)');
  r = world('sentry3', 1300);
  let nearest = Infinity;
  const down = r.a.until(() => { nearest = Math.min(nearest, dist(r.b.p, r.s)); return !r.s.alive || !r.b.p.alive; }, 80);
  t.check(!r.s.alive && r.b.p.alive && r.b.p.hp === 100, 'a Sentry III sitting in the next circle: shot down from outside its reach, without a scratch (' + down.toFixed(0) + ' s)');
  t.check(nearest > 730, 'never closer than ' + Math.round(nearest) + ' units (it reaches 720)');
  // A boulder in the line of fire: it moves along the firing line until it has a clear shot.
  r = world('sentry3', 1300);
  const boulder = { id: 999, x: r.s.x + 600, y: r.s.y, r: 70, alive: true };
  r.a.map.rocks.push(boulder);
  r.a.world.solids.insert({ type: 'rock', shape: 'circle', x: boulder.x, y: boulder.y, r: boulder.r, rock: boulder }, boulder.x - 70, boulder.y - 70, boulder.x + 70, boulder.y + 70);
  r.a.dir.nav.invalidate(boulder.x, boulder.y, 70);
  const down2 = r.a.until(() => !r.s.alive || !r.b.p.alive, 80);
  t.check(!r.s.alive && r.b.p.alive && r.b.p.hp === 100 && Math.abs(r.b.p.y - r.s.y) > 90, 'with a boulder between them it sidesteps to a clear line and still takes the sentry down (' + down2.toFixed(0) + ' s)');
  r = world('sentry3', 1300, 'medic');
  nearest = Infinity;
  r.a.until(() => { nearest = Math.min(nearest, dist(r.b.p, r.s)); return !r.b.p.alive; }, 25);
  t.check(r.b.p.alive && nearest > 730 && r.s.hp === 700, 'a Medic\'s pistol cannot outrange it, so the Medic just stays out of its reach');
}

// ---------------------------------------------------------------- teams
{
  const a = arena({ teams: true });
  a.crowd();
  const b = a.bot(9000, 9000, {}, { team: 1 }), mate = a.human(9300, 9100, still, { team: 1 }), foe = a.human(12000, 12000, still, { team: 2 });
  a.world.damagePlayer(mate, 500, foe.id, 'ar');
  t.check(mate.downed && mate.alive, 'a teammate is knocked down');
  const up = a.until(() => !mate.downed, 12);
  t.check(up >= 4 && up < 8 && mate.alive && mate.hp === 30, 'the bot walks over and holds the revive for the full four seconds (' + up.toFixed(1) + ' s in all)');
  const a2 = arena({ teams: true });
  a2.crowd();
  const medic = a2.bot(9000, 9000, {}, { team: 1, classId: 'medic' }), mate2 = a2.human(9100, 9000, still, { team: 1 }), foe2 = a2.human(12000, 12000, still, { team: 2 });
  a2.world.damagePlayer(mate2, 500, foe2.id, 'ar');
  const up2 = a2.until(() => !mate2.downed, 8);
  t.check(up2 >= 2 && up2 < 4.5 && medic.p.alive, 'a Medic bot does it in half the time (' + up2.toFixed(1) + ' s)');
}
{
  // A bot follows a human teammate, and fights who they fight.
  const a = arena({ teams: true });
  a.crowd();
  const b = a.bot(9000, 9000, { aggression: 0.2 }, { team: 1 });
  const lead = a.human(9100, 9000, (p) => ({ mx: 1, my: 0.2, aimX: p.x + 100, aimY: p.y }), { team: 1 });
  a.step(12);
  t.check(dist(b.p, lead) < 520 && lead.x > 11500, 'a human teammate runs 2,700 units: the bot is still with them (' + Math.round(dist(b.p, lead)) + ' units away)');
  const foe = a.human(lead.x + 450, lead.y + 100, still, { team: 2, hp: 400 });
  lead.controller = shootAt(foe);
  a.clear();
  t.check(a.until(() => a.count('damage', (e) => e.source === b.p && e.target === foe) > 0, 6) >= 0, 'the human opens fire on someone: so does the bot, timid as it is');
  // Two bots: one leads, the other stays within reach.
  const a2 = arena({ teams: true, map: W.MapGen.generate(5, 2), seed: 5 });
  const lead2 = a2.bot(9000, 9000, {}, { team: 1 }), tail = a2.bot(9080, 9000, {}, { team: 1 });
  a2.step(45);
  t.check(lead2.p.alive && tail.p.alive && dist(lead2.p, tail.p) < 1200, 'two bots on a team stay together while they loot (' + Math.round(dist(lead2.p, tail.p)) + ' units apart after 45 s)');
}
{
  // A team of bots does not land on a lone player all in the same instant: one opens up, the other takes a moment
  // to turn up, so the player (and whoever is on the player's side) gets a second to react.
  const gaps = [];
  for (let k = 0; k < 8; k++) {
    const a = arena({ teams: true, seed: 700 + k });
    a.crowd();
    const x = a.bot(9000, 9000, { aggression: 0.6 }, { team: 1 }), y = a.bot(9000, 9120, { aggression: 0.6 }, { team: 1 });
    const h = a.human(9420, 9060, still, { team: 2, hp: 1e6 });
    x.engage.set(h.id, { fight: true, hp: 1, until: 1e9 });     // one of the two has made up its mind
    y.engage.set(h.id, { fight: false, hp: 1, until: 1e9 });    // the other had not
    const first = { x: -1, y: -1 };
    for (let i = 0; i < 10 / TICK && (first.x < 0 || first.y < 0); i++) {
      a.tick();
      for (const e of a.events) if (e.type === 'damage' && e.target === h) { if (e.source === x.p && first.x < 0) first.x = a.world.time; if (e.source === y.p && first.y < 0) first.y = a.world.time; }
      a.clear();
    }
    gaps.push(first.x < 0 ? -99 : first.y < 0 ? 99 : first.y - first.x);
  }
  const lo = Math.min(...gaps), hi = Math.max(...gaps);
  t.check(lo >= 0.8 && hi < 8, 'two bots going for a lone player: the second joins ' + lo.toFixed(1) + ' to ' + hi.toFixed(1) + ' s after the first has started hitting, never in the same instant');
}
{
  // Knocked down: crawl to a teammate.
  const a = arena({ teams: true });
  a.crowd();
  const b = a.bot(9000, 9000, {}, { team: 1 }), mate = a.human(9500, 9000, still, { team: 1 }), foe = a.human(12000, 12000, still, { team: 2 });
  a.world.damagePlayer(b.p, 500, foe.id, 'ar');
  const d0 = dist(b.p, mate);
  a.step(4);
  t.check(b.p.downed && dist(b.p, mate) < d0 - 250, 'a knocked-down bot crawls toward its teammate (' + Math.round(d0 - dist(b.p, mate)) + ' units in 4 s)');
}
{
  // Protecting a revive, and no friendly fire from its own explosives.
  let a = arena({ teams: true }); a.crowd();
  let b = a.bot(9000, 9000, {}, { items: [['riotshield', 1]], team: 1 }), mate = a.human(9000, 9110, still, { team: 1 }), foe = a.human(9500, 9000, null, { team: 2, hp: 800 });
  a.world.damagePlayer(mate, 500, foe.id, 'ar');
  foe.controller = shootAt(b.p);
  const shield = a.until(() => b.p.shieldUp, 8), up = a.until(() => !mate.downed, 8);
  t.check(shield >= 0 && up >= 0 && mate.alive && b.p.alive, 'Riot Shield: raised toward the shooter while reviving, and the revive goes through (' + Math.round(b.p.hp) + ' HP left)');
  a = arena({ teams: true }); a.crowd();
  b = a.bot(9000, 9000, {}, { items: [['smoke', 1]], team: 1 }); mate = a.human(9000, 9200, still, { team: 1 }); foe = a.human(9700, 9000, null, { team: 2, hp: 800 });
  a.world.damagePlayer(mate, 500, foe.id, 'ar');
  foe.controller = shootAt(b.p);
  t.check(usedIn(a, b, 'smoke', 8) >= 0, 'Smoke Grenade: thrown onto a downed teammate before reviving under fire');
  a = arena({ teams: true }); a.crowd();
  b = a.bot(9000, 9000, { aggression: 0.9 }, { team: 1, classId: 'commander' }); mate = a.human(9520, 9000, still, { team: 1 }); foe = a.human(9560, 9060, null, { team: 2, hp: 2000 });
  foe.controller = sprayer(a, b, 300);
  b.stance = () => 'fight';
  a.step(9);
  t.check(a.count('command') === 1 && !a.events.some((e) => e.type === 'damage' && e.target === mate && e.cause === 'airstrike'), 'a Commander with a teammate standing next to the enemy still calls the boost, and puts the airstrike where it cannot hit them');
}

// ---------------------------------------------------------------- found by a second review
// Fire in a house: the way out is the door, even when the door is on the fire's side of the room.
{
  const a = arena({ extra: { buildings: [room(9000, 9000)] } });
  a.crowd();
  const b = a.bot(9160, 9080, { skill: 0.6 }), foe = a.human(3000, 9000, null), it = W.ITEMS.firenade;
  b.pauseUntil = 1e9; a.step(0.5); b.pauseUntil = 0;
  a.world.addZone({ kind: 'fire', x: 9160, y: 9250, r: it.radius, dur: it.duration, owner: foe.id, team: foe.team, dps: it.dps });
  const out = a.until(() => !b.p.alive || Math.hypot(b.p.x - 9160, b.p.y - 9250) > it.radius, it.duration + 0.5);
  t.check(b.p.alive && out > 0 && out < 3, 'fire lands by the only door of the room a bot is in: it leaves through the door and lives (out after ' + out.toFixed(1) + ' s with ' + Math.round(b.p.hp) + ' HP)');
}
// Sentries: only the basic one is worth standing in front of, and only with a gun that reaches it.
{
  const walkPast = (item, classId) => {
    const a = arena();
    a.crowd();
    const b = a.bot(9000, 9000, { skill: 0.6, aggression: 0.5, caution: 0.5 }, { classId }), owner = a.human(3000, 3000, null), it = W.ITEMS[item];
    const s = a.world.addStruct({ kind: 'sentry', item, x: 10100, y: 9000, r: 20, owner: owner.id, team: owner.team, hp: it.hp, maxHp: it.hp });
    a.dir.nav.invalidate(s.x, s.y, s.r);
    b.roam = { x: 11000, y: 9000, at: 0, until: 1e9 };                // its errand lies on the far side
    a.until(() => !b.p.alive || !s.alive, 25);
    return { b, s };
  };
  let r = walkPast('sentry2', 'soldier');
  t.check(r.b.p.alive && r.b.p.hp > 60, 'a Sentry II in the way (100 damage a second, it never misses): a bot keeps out of its reach instead of trading shots with it');
  r = walkPast('sentry', 'grenadier');
  t.check(r.b.p.alive && r.b.p.hp > 60, 'a Grenadier has nothing that reaches a basic Sentry: it keeps out of its reach too');
  // A basic Sentry watching a crate from further away than a shotgun reaches.
  const a = arena({ extra: { crates: [Object.assign(crate(0, 9300, 9000), { hp: 1500, maxHp: 1500 })] } });
  a.crowd();
  const b = a.bot(9000, 9000, { skill: 0.6, aggression: 0.5, caution: 0.5 }, { classId: 'shotgunner' }), owner = a.human(3000, 3000, null);
  const s = a.world.addStruct({ kind: 'sentry', item: 'sentry', x: 9300, y: 8400, r: 20, owner: owner.id, team: owner.team, hp: W.ITEMS.sentry.hp, maxHp: W.ITEMS.sentry.hp });
  a.dir.nav.invalidate(s.x, s.y, s.r);
  a.until(() => !b.p.alive || !s.alive, 25);
  t.check(b.p.alive && !s.alive, 'a Shotgunner being shot by a basic Sentry out of shotgun reach takes out the pistol and shoots it down');
}
// On a turret with an item play still pending from the moment before sitting down: the gun fires all the same.
{
  const r = duel([['turret', 1]], 600);
  usedIn(r.a, r.b, 'turret', 12);
  const mounted = r.a.until(() => r.b.p.mount > 0, 4);
  r.b.act = { kind: 'use', idx: 1, id: 'bandage', aim: null, phase: 0, t: 0, tries: 0, sent: false };
  r.a.clear();
  r.a.step(2);
  t.check(mounted >= 0 && r.b.act === null && r.a.count('shot', (e) => e.weapon === 'turret') > 3, 'a half-started item play does not lock the trigger of a turret the bot has just sat down on');
}
// What a bot cannot see it does not know.
{
  const unseen = () => {
    const a = arena();
    a.crowd();
    const b = a.plant(a.bot(9000, 9000, { skill: 0.6, aggression: 0.5, caution: 0.5 })), h = a.human(9620, 9000, null);
    a.until(() => { const rec = b.known.get(h.id); return rec && rec.noticed && rec.visible; }, 5);
    h.fx.invisible = 30;                                             // an Invisibility Potion: gone from every enemy screen
    a.until(() => { const rec = b.known.get(h.id); return rec && !rec.visible; }, 2);
    return { a, b, h, rec: b.known.get(h.id) };
  };
  const stanceAt = (hp) => {
    const s = unseen();
    s.h.hp = hp;                                                     // what happens to them while nobody can see it
    s.b.p.hp = 50; s.b.inHeat = 45; s.b.inBurst = 0; s.b.outHeat = 0; s.rec.hurtMeAt = s.a.world.time; s.b.now = s.a.world.time;
    return s.b.stance(s.rec);
  };
  t.equal(stanceAt(6), stanceAt(100), 'fight or flee does not depend on the health of an enemy who is out of sight: the bar the bot last saw is all it has');
  const s = unseen();
  s.h.x = 9400; s.h.y = 9300;                                        // they walk off unseen, and a grenade of theirs goes off at the bot's feet
  s.a.world.damagePlayer(s.b.p, 20, s.h.id, 'grenade');
  s.a.step(0.1);
  t.check(!!s.rec && Math.hypot(s.rec.x - 9620, s.rec.y - 9000) < 1 && !s.rec.visible && s.b.bearing && s.a.world.time - s.b.bearing.at < 0.2,
    'a blast from someone it cannot see tells a bot that somebody is out there, not where they are standing');
}
// No line of fire: a bot keeps walking round whatever is in the way, however close the enemy is.
{
  const a = arena();
  a.crowd();
  const b = a.bot(9000, 9000, { skill: 0.6, aggression: 0.7, caution: 0.5 }), h = a.human(9330, 9000, null, { hp: 5000 });
  a.world.addStruct({ kind: 'rock', item: 'rock', x: 9165, y: 9000, r: 116, owner: h.id, team: h.team, hp: 0, maxHp: 0 });
  a.dir.nav.invalidate(9165, 9000, 116);
  b.stance = () => 'fight';
  a.step(12);
  const shots = a.count('shot', (e) => e.player === b.p);
  t.check(shots > 10, 'an enemy 330 away behind a boulder (closer than a rifle likes): the bot walks round it and opens fire (' + shots + ' shots in 12 s)');
}
// One Poison Potion at a time: the rest of the stack is for later.
{
  const a = arena();
  a.crowd();
  const b = a.bot(9000, 9000, { skill: 0.8, aggression: 0.9, caution: 0.5 }, { items: [['poison', 3]] }), h = a.human(9400, 9000, null, { hp: 5000 });
  h.controller = sprayer(a, b, 600);
  b.stance = () => 'fight';
  let wasted = 0, thrown = 0;
  for (let i = 0; i < 8 / TICK; i++) {
    const before = a.events.length;
    a.tick();
    for (let k = before; k < a.events.length; k++) { const e = a.events[k]; if (e.type === 'item-used' && e.item === 'poison' && e.player === b.p) { thrown++; if (h.fx.poison > 2) wasted++; } }
  }
  t.check(thrown === 1 && wasted === 0, 'three Poison Potions and one target: one is thrown, the others are kept while the first is still working (' + thrown + ' thrown in 8 s)');
}

// ---------------------------------------------------------------- nothing silly
{
  const a = arena({ map: W.MapGen.generate(99), seed: 99, storm: true });
  const bots = [];
  for (let i = 0; i < 12; i++) { const d = a.map.drops[Math.floor(i * a.map.drops.length / 12)]; bots.push(a.bot(d.x, d.y, { skill: 0.2 + i * 0.05 })); }
  let bad = 0, frozen = 0;
  const last = bots.map((b) => ({ x: b.p.x, y: b.p.y, t: 0 }));
  for (let i = 0; i < 90 / TICK; i++) {
    a.tick();
    bots.forEach((b, k) => {
      const o = b.out;
      if (![o.mx, o.my].every(Number.isFinite) || (o.aimX !== null && !(Number.isFinite(o.aimX) && Number.isFinite(o.aimY)))) bad++;
      if (!b.p.alive) return;
      if (Math.hypot(b.p.x - last[k].x, b.p.y - last[k].y) > 40) { last[k].x = b.p.x; last[k].y = b.p.y; last[k].t = a.world.time; }
      else if (a.world.time - last[k].t > 25) frozen++;
    });
  }
  t.equal(bad, 0, 'ninety seconds of twelve bots on a real island: every intent they return is made of finite numbers');
  t.equal(frozen, 0, 'and none of them stands in one spot for 25 seconds');
  t.equal(a.dir.errors, 0, 'and no bot throws');
  t.check(bots.filter((b) => b.p.tokens > 0 || W.CLASSES[b.p.classId].tier > 0).length >= 9, 'most of them have picked up tokens by then');
}

t.done();
