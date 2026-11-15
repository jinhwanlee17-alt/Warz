// Bots and vehicles: getting into a tank, a Humvee or an artillery piece, fighting from it, riding along in a
// teammate's, getting out again, steering round settlements, and on foot staying out of an enemy tank's way.
import { suite } from './harness.mjs';
import { arena, W, TICK, dist } from './bots-harness.mjs';

const t = suite('bot vehicles');
const still = () => null;
const tank = (x, y, angle = 0) => ({ id: 1, type: 'tank', x, y, angle });
const dmg = (a, target, cause) => a.events.filter((e) => e.type === 'damage' && e.target === target && (!cause || e.cause === cause)).reduce((n, e) => n + e.amount, 0);
const entered = (a, p) => a.events.find((e) => e.type === 'vehicle' && e.op === 'enter' && e.player === p);

// ---------------------------------------------------------------- tanks
{
  const a = arena({ extra: { tanks: [tank(9000, 9000)] } });
  a.crowd();
  const b = a.bot(9000, 9180, { skill: 0.6, aggression: 0.7 });
  b.wheels = 1;
  const v = a.world.vehicles[0], h = a.human(9800, 9100, still, { hp: 5000 });
  const boarded = a.until(() => b.p.vehicle === v.id, 6);
  t.check(boarded >= 0 && b.p.vehicleSeat === 'driver', 'a bot that likes vehicles walks to a tank next to it and takes the driver\'s seat (' + boarded.toFixed(1) + ' s)');
  a.step(30);
  const shells = a.count('tank-shell', (e) => e.op === 'spawn'), mg = a.count('vehicle-shot', (e) => e.player === b.p);
  t.check(shells >= 4 && mg > 20, 'from the tank it fires the cannon (' + shells + ' shells in 30 s) and the machine gun while the cannon reloads (' + mg + ' rounds)');
  t.check(dmg(a, h, 'tank-cannon') >= 500 && dmg(a, h) >= 900, 'and hurts a player standing in the open (' + Math.round(dmg(a, h, 'tank-cannon')) + ' cannon damage, ' + Math.round(dmg(a, h)) + ' in all)');
  t.check(a.count('damage', (e) => e.target === b.p) === 0 && v.hp > v.maxHp * 0.9, 'without its own shells ever hurting it or its hull');
  t.equal(a.dir.errors, 0, 'tank driving and gunnery do not throw');
  // Nearly wrecked: out, and fighting on foot.
  v.hp = v.maxHp * 0.08;
  b.redecide = true;
  const out = a.until(() => !b.p.vehicle, 3);
  a.step(0.2);
  t.check(out >= 0 && b.p.alive && !b.p.vehicle && !b.drive, 'with the hull nearly gone it climbs out before it burns (' + out.toFixed(1) + ' s)');
  t.check(a.until(() => a.count('shot', (e) => e.player === b.p) > 0, 8) >= 0, 'and carries on the fight on foot');
}
{
  // Not every bot wants one.
  const a = arena({ extra: { tanks: [tank(9000, 9000)] } });
  a.crowd();
  const b = a.bot(9000, 9180, {});
  b.wheels = 0.1;
  a.step(10);
  t.check(!b.p.vehicle && !entered(a, b.p), 'a bot that does not care for vehicles walks past a tank');
}

// ---------------------------------------------------------------- Humvees
{
  // Unarmed: it runs people over.
  const a = arena({ extra: { vehicles: [{ id: 1, type: 'humvee', x: 9000, y: 9000, angle: 0 }] } });
  a.crowd();
  const b = a.bot(9000, 9150, { skill: 0.6, aggression: 0.9 });
  b.wheels = 0.9;
  const h = a.human(9700, 8900, still, { hp: 1000 });
  const boarded = a.until(() => !!b.p.vehicle, 6);
  const ram = a.until(() => dmg(a, h, 'ram') > 0, 25);
  t.check(boarded >= 0 && ram >= 0, 'in an unarmed Humvee a bot drives a player down (rammed ' + ram.toFixed(1) + ' s after climbing in)');
  t.equal(a.dir.errors, 0, 'ramming does not throw');
}

// ---------------------------------------------------------------- artillery
{
  // An artillery piece: the whole island on the targeting map, shells for whoever keeps still.
  const a = arena({ extra: { groundArtillery: [{ id: 1, type: 'artillery', fixed: true, ring: 0, x: 9000, y: 9000, angle: 0 }] } });
  a.crowd();
  a.world.time = 100;
  const b = a.bot(9000, 9200, { skill: 0.7, aggression: 0.6 });
  b.gunnerish = 1;
  const far = a.human(11500, 10400, still, { hp: 1e6 }), near = a.human(9000, 9450, still, { hp: 1e6 });
  near.fx.invisible = 1e9;                                       // (keeps the bot in its seat: it would get out to deal with someone this close)
  const boarded = a.until(() => !!b.p.vehicle, 6);
  t.check(boarded >= 0 && b.p.vehicleWeapon === 1, 'a bot with a taste for artillery climbs into a gun emplacement (' + boarded.toFixed(1) + ' s)');
  a.step(45);
  const shells = a.events.filter((e) => e.type === 'artillery-shell' && e.op === 'spawn');
  const close = shells.filter((e) => Math.hypot(e.shell.targetX - far.x, e.shell.targetY - far.y) < 400).length;
  t.check(shells.length >= 2 && close >= 1, 'and shells a player standing still across the map (' + shells.length + ' shells, ' + close + ' near them)');
  t.check(dmg(a, far, 'artillery') > 0, 'hitting them (' + Math.round(dmg(a, far, 'artillery')) + ' damage)');
  const atFar = shells.filter((e) => Math.hypot(e.shell.targetX - far.x, e.shell.targetY - far.y) < 600).map((e) => e.time);
  t.check(atFar.length <= 3 && atFar.every((at, i) => i === 0 || at - atFar[i - 1] >= 18), 'at most one shell at the same person every eighteen seconds, however long they stand there (' + atFar.map((x) => x.toFixed(0)).join(', ') + ' s)');
  t.check(shells.every((e) => Math.hypot(e.shell.targetX - b.p.x, e.shell.targetY - b.p.y) > 450), 'never close enough to its own gun to hurt it');
  t.equal(a.dir.errors, 0, 'artillery does not throw');
}
{
  // Self-propelled: stop, set up for ten seconds, fire; drive off when somebody comes for it.
  const a = arena({ extra: { artillery: [{ id: 1, type: 'artillery', x: 9000, y: 9000, angle: 0 }] } });
  a.crowd();
  a.world.time = 100;
  const b = a.bot(9000, 9200, { skill: 0.7, aggression: 0.6 });
  b.gunnerish = 1;
  const far = a.human(11800, 9400, still, { hp: 1e6 });
  a.until(() => !!b.p.vehicle, 6);
  const v = a.world.vehicles[0];
  const deployed = a.until(() => b.p.vehicleWeapon === 1, 4);
  const fired = a.until(() => a.count('artillery-shell', (e) => e.op === 'spawn') > 0, 25);
  t.check(deployed >= 0 && fired >= 9, 'a bot in self-propelled artillery switches to the targeting map, waits out the ten-second setup and fires (' + fired.toFixed(1) + ' s)');
  const intruder = a.human(v.x + 500, v.y, still, { hp: 1e6 });
  const at = { x: v.x, y: v.y }, moved = a.until(() => dist(v, at) > 400, 10);
  t.check(moved >= 0 && b.p.vehicle === v.id, 'when somebody walks up to it, it drives off rather than sit there (' + Math.round(dist(v, intruder)) + ' units away after ' + moved.toFixed(1) + ' s)');
  t.equal(a.dir.errors, 0, 'self-propelled artillery does not throw');
}
{
  // Shells coming down on screen are dodged like any other blast.
  let ok = 0;
  for (let k = 0; k < 8; k++) {
    const a = arena({ seed: 60 + k });
    a.crowd();
    const b = a.bot(9000, 9000, { skill: 0.8 });
    b.stance = () => 'ignore'; b.pauseUntil = 1e9;
    const gunner = a.human(30000, 9000, still, { team: 77 });
    a.step(0.5);
    a.world.spawnArtilleryShell({ owner: gunner.id, team: gunner.team, vehicle: 0, x: 9500, y: 9000, startX: 9500, startY: 9000, targetX: 9000, targetY: 9000, elapsed: 0, flightTime: 2.6 });
    const hp = b.p.hp;
    a.step(3);
    if (b.p.hp >= hp) ok++;
  }
  t.check(ok >= 5, 'a decent bot that sees an artillery shell coming gets out from under it (' + ok + ' of 8)');
}

// ---------------------------------------------------------------- teams
{
  // A bot rides in its human teammate's tank and works the cannon.
  const a = arena({ teams: true, extra: { tanks: [tank(9000, 9000)] } });
  a.crowd();
  const v = a.world.vehicles[0], lead = a.human(9000, 9150, still, { team: 1 });
  t.check(a.world.enterVehicle(lead, v, 'driver'), 'a person climbs into a tank');
  const b = a.bot(9100, 9400, { aggression: 0.8 }, { team: 1 });
  const foe = a.human(9850, 8800, still, { team: 2, hp: 5000 });
  const boarded = a.until(() => b.p.vehicle === v.id, 8);
  t.check(boarded >= 0 && b.p.vehicleSeat !== 'driver', 'their bot teammate climbs in after them, into a gunner\'s seat (' + b.p.vehicleSeat + ')');
  const shot = a.until(() => dmg(a, foe) > 0, 15);
  t.check(shot >= 0 && a.events.some((e) => e.type === 'damage' && e.target === foe && e.source === b.p), 'and opens up on an enemy from it (' + shot.toFixed(1) + ' s)');
  a.world.exitVehicle(lead, true);
  t.check(a.until(() => !b.p.vehicle, 3) >= 0, 'when the person gets out, so does the bot');
  t.equal(a.dir.errors, 0, 'riding along does not throw');
}

// ---------------------------------------------------------------- on foot against a tank
{
  const a = arena({ extra: { tanks: [tank(9600, 9000, Math.PI)] } });
  a.crowd();
  const b = a.bot(9000, 9000, { aggression: 0.8 });
  b.wheels = 0;
  const enemy = a.human(9600, 9150, still, { hp: 500 }), v = a.world.vehicles[0];
  a.world.enterVehicle(enemy, v, 'driver');
  a.step(6);
  t.check(a.count('vehicle', (e) => e.op === 'hp' && e.vehicle === v && e.source === b.p) === 0, 'on foot, a bot does not pick a fight with a tank that leaves it alone (bullets barely scratch one)');
  t.check(dist(b.p, v) > 800 || !a.world.lineClear(b.p.x, b.p.y, v.x, v.y, v), 'it gets out of the tank\'s sight instead (' + Math.round(dist(b.p, v)) + ' units away)');
}

// ---------------------------------------------------------------- routes
{
  const town = { id: 0, x: 20000, y: 20000, halfW: 1800, halfH: 1800, kind: 'town' };
  const a = arena({ extra: { towns: [town] } });
  const r = a.dir.vehicleRoute(16000, 20000, 24000, 20100, 105);
  const crosses = (p, q) => W.U.segRect(p.x, p.y, q.x, q.y, town.x - town.halfW - 100, town.y - town.halfH - 100, town.halfW * 2 + 200, town.halfH * 2 + 200) >= 0;
  let prev = { x: 16000, y: 20000 }, ok = true;
  for (const pt of r.pts) { if (crosses(prev, pt)) ok = false; prev = pt; }
  t.check(r.pts.length >= 3 && ok, 'a vehicle crossing the island goes round a settlement, not through its streets (' + r.pts.length + ' legs)');
  const g = a.dir.vehicleRoute(16000, 20000, 20000, 20000, 105);
  t.check(!!g.edge && Math.hypot(g.edge.x - 20000, g.edge.y - 20000) > town.halfW + 600, 'and stops at its edge when the destination is inside it');
}

t.done();
