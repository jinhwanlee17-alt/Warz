import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'class-combat', 'vehicles', 'sentry-combat', 'level3-combat', 'engineer', 'rpg', 'magic-medic']);
const t = suite('Magic Medic healing'), X = 5000, Y = 5000, DT = 0.05;
function arena(remote = false) {
  const map = { seed: 7, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [], ponds: [], stations: [], towns: [], drops: [], tanks: [], vehicles: [], nextPickupId: 1 };
  const world = new W.World({ map, remote, teams: true, storm: false });
  const p = world.addPlayer({ classId: 'magicmedic', x: X, y: Y, team: 1 });
  world.switchSlot(p, 1);
  const intent = { mx: 0, my: 0, aimX: X + 60, aimY: Y, fire: false, firePressed: false };
  return { world, p, intent };
}
function ally(a, x = X + 100, y = Y, hp = 10, maxHp = 100) {
  const o = a.world.addPlayer({ x, y, team: 1 }); o.hp = hp; o.maxHp = maxHp; return o;
}
function tick(a, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) a.world.updateMedicStaff(a.p, a.intent, DT);
}
{
  const a = arena();
  t.equal(a.p.maxHp, 300, 'Magic Medic has 300 maximum HP');
  t.equal(a.p.weapons.map(w => w.id).join(','), 'revolver,medicstaff,magicmedkit', 'three class items in their requested order');
  const o = ally(a, X + 100, Y, 150, 175), other = ally(a, X - 80, Y, 20);
  a.p.hp = 160; a.world.switchSlot(a.p, 2);
  t.check(a.world.trigger(a.p, { firePressed: true, aimX: o.x, aimY: o.y }), 'clicking a teammate uses the medkit');
  t.equal(o.hp, 450, '300 HP is added in full: 150 of 175 becomes 450');
  t.equal(a.p.hp, 160, 'targeted kit does not also heal the Medic');
  t.equal(other.hp, 20, 'targeted kit is not an area heal');
  t.equal(a.p.medkitCd, 30, 'medkit starts its 30-second cooldown');
  t.check(!a.world.useMedkit(a.p), 'cooldown blocks repeated healing');
  a.p.medkitCd = 0;
  t.check(a.world.useMedkit(a.p, { aimX: X + 400, aimY: Y + 300 }), 'clicking empty ground heals the Medic');
  t.equal(a.p.hp, 460, 'self medkit also overheals without a maximum-HP cap');
  a.p.medkitCd = 0; a.world.switchSlot(a.p, 2); other.x = X - 65;
  t.equal(a.world.nearestMedicPatient(a.p), other, 'equipped medkit exposes nearest E patient');
  t.check(a.world.pressInteract(a.p), 'E heals the nearby selected patient');
  t.equal(other.hp, 320, 'E gives only the chosen teammate 300 HP');
  t.equal(a.p.hp, 460, 'E teammate healing does not consume overheal from owner');
  a.p.medkitCd = 0; o.x = X + 300;
  t.check(!a.world.useMedkit(a.p, { aimX: o.x, aimY: o.y }), 'clicked teammate beyond heal reach is rejected');
  t.equal(a.p.medkitCd, 0, 'out-of-range targeting does not spend the cooldown');
}
{
  const a = arena(), o = ally(a, X + 65, Y, 10, 175);
  a.world.downPlayer(o, null, 'test'); a.p.medkitCd = 30; a.p.wantsRevive = true;
  a.world.updateRevives(2);
  t.check(!o.downed, 'holding interact revives without using an item');
  t.equal(o.hp, 175, 'Magic Medic revive restores all target maximum HP');
  t.equal(a.p.medkitCd, 30, 'revival works during medkit cooldown and does not change it');
  t.equal(a.p.stats.revives, 1, 'free revive counts normally');
}
{
  const a = arena(), lowHp = ally(a, X + 100, Y, 40, 100), lowPercent = ally(a, X - 100, Y, 60, 300);
  a.p.hp = 1; tick(a, 1);
  t.near(lowPercent.hp, 61, 1e-8, 'held staff selects lowest HP percentage instead of lowest absolute HP');
  t.equal(lowHp.hp, 40, 'held staff heals only one patient at once');
  t.equal(a.p.hp, 1, 'held staff never heals the Medic');
  t.equal(a.p.medicStaff.target, lowPercent.id, 'held beam tracks its patient');
  lowPercent.x = X + 151; lowHp.x = X - 151; const elapsed = a.p.medicStaff.elapsed;
  tick(a, 1); t.near(a.p.medicStaff.elapsed, elapsed, 1e-8, 'staff pauses when nobody injured is in grenade range');
  lowHp.x = X - 150; tick(a, 1); t.near(lowHp.hp, 41, 1e-8, 'held staff reaches the grenade-radius boundary');
  a.world.switchSlot(a.p, 0); tick(a, 1); t.near(lowHp.hp, 41, 1e-8, 'stowed staff stops held healing');
}
{
  const a = arena(), o = ally(a, X + 100, Y, 1, 10000);
  const segments = [[10, 10, 2], [10, 20, 3], [5, 15, 10], [3, 30, 25], [5, 125, 0]];
  let expected = 1;
  for (const [seconds, amount, nextRate] of segments) {
    tick(a, seconds); expected += amount;
    t.near(o.hp, expected, 1e-7, 'held stage heals ' + amount + ' across ' + seconds + ' seconds');
    t.equal(W.MedicStaff.status(a.p).rate, nextRate, 'held stage advances to expected rate');
  }
  t.near(a.p.medicStaff.recharge, 25, 1e-8, '33 seconds of held healing starts a full 25-second recharge');
  a.world.switchSlot(a.p, 0); tick(a, 24.95);
  t.near(a.p.medicStaff.recharge, 0.05, 1e-7, 'recharge continues while staff is stowed');
  t.near(o.hp, expected, 1e-7, 'no healing during recharge');
  tick(a, 0.05); t.equal(a.p.medicStaff.recharge, 0, 'recharge ends at exactly 25 seconds');
  a.world.switchSlot(a.p, 1); tick(a, 1); t.near(o.hp, expected + 1, 1e-7, 'new cycle restarts at one HP per second');
}
{
  const a = arena(); a.p.hp = 1; a.p.maxHp = 10000;
  t.check(a.world.placeMedicStaff(a.p, a.intent), 'staff can be placed in open ground');
  const s = a.p.medicStaff;
  const patients = [a.p, ally(a, s.x + 100, s.y, 1, 10000), ally(a, s.x - 100, s.y, 1, 10000), ally(a, s.x, s.y + 100, 1, 10000), ally(a, s.x, s.y - 100, 1, 10000)];
  const enemy = ally(a, s.x, s.y + 150, 1, 10000); enemy.team = 2;
  const outside = ally(a, s.x + 301, s.y, 1, 10000);
  const segments = [[5, 5, 2], [5, 10, 3], [2, 6, 10], [5, 50, 25], [5, 125, 50], [30, 1500, 0]];
  a.world.switchSlot(a.p, 0);
  let total = 0;
  for (const [seconds, amount, nextRate] of segments) {
    tick(a, seconds); total += amount;
    for (const o of patients) t.near(o.hp, 1 + total / 5, 1e-6, 'placed staff splits stage budget evenly across five patients');
    t.equal(W.MedicStaff.status(a.p).rate, nextRate, 'placed stage advances at requested time');
  }
  t.equal(enemy.hp, 1, 'enemy inside placed radius gets no healing');
  t.equal(outside.hp, 1, 'ally outside fire-grenade radius gets no healing');
  t.near(s.recharge, 25, 1e-7, '52 seconds of placed healing starts 25-second recharge');
  t.equal(a.world.placedMedicStaffs().length, 1, 'placed staff remains a waypoint during recharge');
  t.equal(a.world.placedMedicStaffs()[0].owner, a.p.id, 'public marker identifies the staff owner');
}
{
  const a = arena(), o = ally(a, X + 100, Y, 1, 10000); tick(a, 12);
  t.check(a.world.placeMedicStaff(a.p, { aimX: X, aimY: Y + 60 }), 'a partly used staff can be placed');
  t.equal(a.p.medicStaff.elapsed, 0, 'placing restarts healing stages as requested');
  tick(a, 6); t.near(a.p.medicStaff.elapsed, 6, 1e-8, 'placed healing progresses independently from the old held stage');
  t.check(a.world.pickupMedicStaff(a.p), 'owner can pick the placed staff up');
  t.equal(a.p.medicStaff.elapsed, 0, 'pickup restarts held stages');
  t.equal(a.world.placedMedicStaffs().length, 0, 'pickup immediately removes global waypoint');
  a.p.medicStaff.recharge = 15;
  a.world.placeMedicStaff(a.p, { aimX: X, aimY: Y + 60 }); a.world.pickupMedicStaff(a.p);
  t.equal(a.p.medicStaff.recharge, 15, 'mode switches cannot bypass active recharge');
  a.p.medicStaff.recharge = 0; a.world.placeMedicStaff(a.p, { aimX: X, aimY: Y + 60 });
  const thief = ally(a, X, Y + 50); thief.team = 2;
  t.check(!a.world.pickupMedicStaff(thief), 'other players cannot steal class equipment');
  t.check(!a.world.placeMedicStaff(a.p, { aimX: X, aimY: Y - 60 }), 'only one staff per Medic can be placed');
  a.world.downPlayer(a.p, null, 'test');
  t.equal(a.world.placedMedicStaffs().length, 0, 'being knocked down removes the healing waypoint');
  t.check(!a.p.medicStaff.placed, 'downed Medic recalls the staff');
  a.world.revivePlayer(a.p, o); a.world.switchSlot(a.p, 1);
  a.world.placeMedicStaff(a.p, { aimX: X, aimY: Y - 60 }); a.world.killPlayer(a.p, null, 'test');
  t.equal(a.p.medicStaff, null, 'death removes class staff state');
}
{
  const a = arena(), o = ally(a, X + 100, Y, 99.8, 100), over = ally(a, X - 100, Y, 400, 100);
  tick(a, 1);
  t.near(o.hp, 100, 1e-8, 'staff stops at maximum HP');
  t.equal(over.hp, 400, 'staff does not erase existing medkit overheal');
  t.near(a.p.medicStaff.elapsed, 0.2, 1e-8, 'unused healing time is not charged after everybody reaches full HP');
  a.world.setClass(a.p, 'soldier', false); t.equal(a.p.medicStaff, null, 'changing class removes staff');
}
{
  const a = arena(true), o = ally(a);
  const hp = o.hp; a.p.medicStaff.placed = true;
  tick(a, 10);
  t.equal(o.hp, hp, 'client mirror cannot authoritatively heal');
  t.check(!a.world.useMedkit(a.p), 'client mirror cannot spend or grant medkit healing');
  t.check(!a.world.placeMedicStaff(a.p, a.intent), 'client mirror cannot place a staff');
  a.world.medicStaffMarkers = [{ owner: 99, team: 2, x: 10, y: 20, placed: true }];
  t.equal(a.world.placedMedicStaffs()[0].owner, 99, 'client global markers come from authoritative snapshot');
}
{
  const a = arena(), o = ally(a, X + 100, Y, 1, 10000);
  tick(a, 3);
  t.equal(a.world.events.filter(e => e.type === 'heal' && e.item === 'medicstaff').length, 3, 'continuous healing emits at most one feedback event per patient per second');
  t.near(o.hp, 4, 1e-8, 'feedback throttling retains exact fractional simulation healing');
}
{
  const a = arena(), o = ally(a, X + 100, Y, 1, 10000);
  a.p.net = { conn: null }; tick(a, 1);
  t.equal(o.hp, 1, 'disconnected human cannot passively heal with the recalled staff still equipped');
  t.equal(a.p.medicStaff.elapsed, 0, 'disconnect pauses the healing cycle');
  t.check(!a.world.placeMedicStaff(a.p, { aimX: X, aimY: Y + 60 }), 'queued fire cannot re-place a staff after disconnect');
  t.check(!a.world.useMedkit(a.p), 'queued gear use cannot heal after disconnect');
  a.p.medicStaff.recharge = 2; tick(a, 1);
  t.near(a.p.medicStaff.recharge, 1, 1e-8, 'recharge keeps counting while disconnected');
  a.p.net.conn = {}; tick(a, 2);
  t.near(o.hp, 2, 1e-8, 'connected player resumes healing when remaining recharge ends');
}
{
  const a = arena(); a.p.hp = 1;
  a.world.placeMedicStaff(a.p, { aimX: X, aimY: Y + 60 });
  const patients = [a.p, ally(a, X + 100), ally(a, X - 100), ally(a, X, Y + 150), ally(a, X, Y - 150)];
  const before = patients.map(p => p.hp); tick(a, 1);
  t.equal(a.world.events.filter(e => e.type === 'heal' && e.item === 'medicstaff').length, 0, 'fractional shared healing never emits a +0 HP label');
  for (let i = 0; i < patients.length; i++) t.near(patients[i].hp, before[i] + .2, 1e-8, 'suppressing tiny feedback preserves the actual healing');
  tick(a, 2);
  const heals = a.world.events.filter(e => e.type === 'heal' && e.item === 'medicstaff');
  t.equal(heals.length, 5, 'fractional feedback accumulates until each patient has a visible amount');
  t.check(heals.every(e => Math.round(e.amount) >= 1), 'all accumulated labels show at least one HP');
}
t.done();
