// Independent browser replica driven by real server packets and player inputs.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';

const t = suite('tanks online'), STEP = 0.05;
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls']);
const sent = []; let clock = 0;
W.MatchNet = { send(message) { sent.push(message); } };
const sandbox = { Warz: W, performance: { now: () => clock * 1000 } }; sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
const Online = W.Online;
function clearTerrain(world) {
  for (const key of ['rocks', 'trees', 'buildings', 'crates', 'pickups', 'ponds', 'stations']) world.map[key] = [];
  world.solids = new W.U.SpatialHash(256);
}
for (const teamSize of [1, 4]) {
  const tag = teamSize === 1 ? 'solo' : 'squad';
  const names = teamSize === 1 ? ['Driver'] : ['Driver', 'MG operator', 'Cannon operator', 'Passenger'];
  const match = new Match({ W: ServerW, id: 'tanks-' + tag, mode: tag, teamSize, seed: 57, clock: false,
    emptyTimeout: Infinity, teams: [{ members: names.map(name => ({ name })) }, { members: [{ name: 'Observer' }] }] });
  try {
    clearTerrain(match.world);
    const [driver, gunner, cannon, passenger] = match.players, observer = match.players.at(-1);
    const tank = match.world.vehicles.find(v => v.type === 'tank');
    match.world.vehicles.forEach((v, i) => { v.x = 2000 + i * 400; v.y = 3000; });
    tank.x = 8000; tank.y = 8000; tank.angle = tank.gunAngle = tank.cannonAngle = 0;
    match.players.forEach((p, i) => { p.x = 5000 + i * 100; p.y = 5000; p.dropT = 0; });
    let state, last;
    function connect(p, rejoin = false) {
      match.players.forEach(player => { player.net.conn = null; });
      state = Online.start(match.startMessage(p, rejoin)); clearTerrain(state.world);
      state.world.map.rocks = match.map.rocks.map(rock => ({ ...rock })); state.world.buildSolids();
      p.net.conn = { open: true, bufferedAmount: 0, close() {}, sendText(text) {
        const message = JSON.parse(text);
        if (message.t === 'snap') { last = message; clock += STEP; Online.applySnapshot(last); }
      } };
      if (rejoin) Online.applySync(match.syncMessage());
      match.sendSnapshots([]); state.seq = p.net.ack;
      return state.world.vehicleById(tank.id);
    }
    function input(down = [], hit = []) {
      return { down: key => down.includes(key), hit: key => hit.includes(key), lift: () => false,
        wheel: 0, mouse: { x: 0, y: 0 } };
    }
    const renderer = { screenToWorld: () => ({ x: tank.x + 900, y: tank.y + 40 }) };
    function step(down = [], hit = []) {
      const controls = input(down, hit); Online.latch(controls); Online.step(controls, renderer, false, false);
      return sent.at(-1);
    }
    function deliver(p, message) { match.handleInput(p, message); match.tick(); }
    function enter(p, seat) {
      const at = match.world.vehicleSeatPoint(tank, seat, true); p.x = at.x; p.y = at.y;
      return match.world.enterVehicle(p, tank, seat);
    }
    let replica = connect(driver);
    t.check(last.vehicles.length === W.VEHICLE.count + W.TANK.count + W.ARTILLERY.count + W.GROUND_ARTILLERY.count && state.world.vehicles.filter(v => v.type === 'tank').length === 4,
      tag + ': real initial snapshots include Humvees, tanks and artillery');
    t.check(replica.r === W.TANK.radius && replica.hp === W.TANK.hp && replica.mgAmmo === 1000,
      tag + ': tank geometry, health and magazine survive decoding');
    const at = match.world.vehicleSeatPoint(tank, 'driver', true); driver.x = at.x; driver.y = at.y;
    match.sendSnapshots([]); Online.pressInteract(); deliver(driver, step());
    t.check(driver.vehicle === tank.id && state.me.vehicle === tank.id && replica.predicted,
      tag + ': real interact input enters the tank and enables driver prediction');
    const first = step(['KeyD']), second = step(['KeyD']), predictedX = replica.x;
    deliver(driver, first);
    t.near(replica.x, predictedX, 0.04, tag + ': acknowledging one drive input replays only the remaining tank input');
    deliver(driver, second);
    t.near(replica.x, tank.x, 0.02, tag + ': acknowledged tank movement converges to the server');
    replica.predictedRocks = { 999: true }; replica.predictedStructRocks = { 999: true }; replica.predictedStructRockDamage = { 999: 100 };
    match.sendSnapshots([]);
    t.check(!replica.predictedRocks[999] && !replica.predictedStructRocks[999] && !replica.predictedStructRockDamage[999],
      tag + ': authoritative baselines discard speculative natural and placed-rock contacts');

    match.world.setClass(driver, 'grenadier', true); driver.slot = 1; match.sendSnapshots([]);
    const personal = JSON.stringify({ ammo: driver.weapons.map(w => w.ammo), grenades: driver.grenades });
    let message = step(['Mouse1'], ['Digit1']); deliver(driver, message);
    t.check(message.f && message.sl === 0 && !message.fp && !message.u && message.ch === 0,
      tag + ': cannon controls bypass held grenade charge without leaking personal actions');
    t.check(match.world.tankShells.length === 1 && state.world.tankShells.length === 1 && replica.cannonFlash > 0,
      tag + ': authoritative cannon fire replicates one shell and muzzle flash');
    t.equal(state.world.events.filter(e => e.type === 'tank-shell' && e.op === 'spawn').length, 1,
      tag + ': replicated cannon fire emits one launcher audio event');
    t.check(Math.hypot(match.world.tankShells[0].x - state.world.tankShells[0].x,
      match.world.tankShells[0].y - state.world.tankShells[0].y) < 0.15,
      tag + ': replicated shell starts at the same post-barrel position as the server');
    t.check(last.you.vw === 0 && last.vehicles.find(v => v.id === tank.id).cc > 0,
      tag + ': selected cannon and its cooldown are authoritative');
    message = step(['Mouse1'], ['Digit2']); deliver(driver, message);
    t.check(driver.vehicleWeapon === 1 && state.me.vehicleWeapon === 1 && message.sl === 1,
      tag + ': key 2 selects the driver machine gun through the network');
    t.check(tank.mgAmmo === 999 && replica.mgAmmo === 999 && state.world.events.some(e => e.type === 'shot' && e.weapon === 'tankmg'),
      tag + ': tank MG ammunition and actual cosmetic bullets use the tank weapon');
    t.equal(JSON.stringify({ ammo: driver.weapons.map(w => w.ammo), grenades: driver.grenades }), personal,
      tag + ': tank weapons consume no personal launcher rounds or grenades');
    tank.mgAmmo = 7; match.sendSnapshots([]);
    message = step([], ['KeyR']); deliver(driver, message);
    t.check(message.r && tank.mgReload > 0 && replica.mgReload > 0 && replica.mgAmmo === 7,
      tag + ': manual MG reload and remaining magazine synchronize');
    t.check(state.world.events.some(e => e.type === 'vehicle' && e.op === 'reload' && e.vehicle.id === tank.id),
      tag + ': MG reload reaches the local vehicle audio handler');
    const cannonAngle = replica.cannonAngle;
    Online.interpolate();
    t.check(Number.isFinite(replica.gunAngle) && replica.cannonAngle === cannonAngle,
      tag + ': aiming the selected MG leaves the independent cannon angle unchanged');
    replica = connect(driver, true);
    t.check(replica.type === 'tank' && state.me.vehicleWeapon === 1 && replica.mgReload === Math.round(tank.mgReload * 1000) / 1000,
      tag + ': rejoin restores the selected weapon and in-progress reload');
    t.check(state.world.tankShells.length === match.world.tankShells.length && state.world.tankShells.length === 1,
      tag + ': rejoin restores an already traveling cannon shell');
    const shell = match.world.tankShells[0], hp = state.me.hp, tankHp = replica.hp;
    Online.applyEvent({ t: 'tank-shell', op: 'impact', id: shell.id, x: state.me.x, y: state.me.y });
    t.check(state.world.tankShells.length === 0 && state.me.hp === hp && replica.hp === tankHp,
      tag + ': remote shell impact removes cosmetics without dealing local damage');
    connect(driver, true);
    for (let tick = 0; tick < 25 && match.world.tankShells.some(s => s.id === shell.id); tick++) match.tick();
    t.check(last.e.some(e => e.t === 'tank-shell' && e.op === 'impact' && e.id === shell.id) &&
      !last.e.some(e => e.t === 'boom' && e.c === 'tank-cannon'), tag + ': real cannon impact has one dedicated wire event, without a duplicate grenade blast');
    t.check(state.world.tankShells.length === 0 && state.world.explosions.length === 1 &&
      state.world.explosions[0].r === W.TANK.cannonRadius && state.world.events.filter(e => e.type === 'explosion').length === 1,
      tag + ': real impact uses the cannon radius and plays its effects once');

    if (teamSize > 1) {
      t.check(enter(gunner, 'gunner') && enter(cannon, 'rearLeft') && enter(passenger, 'rearRight'),
        'squad: all dedicated stations and the passenger seat can be occupied');
      connect(driver); tank.cooldown = tank.cannonCooldown = tank.mgReload = 0;
      const shots = driver.stats.shots; deliver(driver, step(['Mouse1'], ['Digit1']));
      t.check(match.world.vehicleWeaponFor(driver) === null && driver.stats.shots === shots,
        'squad: the driver cannot fire a weapon reserved by another operator');
      connect(gunner); tank.cooldown = tank.mgReload = 0;
      const ammo = tank.mgAmmo; message = step(['Mouse1'], ['Digit1']); deliver(gunner, message);
      t.check(message.sl === null && tank.mgAmmo === ammo - 1 && match.world.vehicleWeaponFor(gunner) === 'mg',
        'squad: dedicated MG operator fires independently and cannot steal the cannon via key 1');
      connect(cannon); tank.cannonCooldown = 0; tank.cannonReload = 0; tank.cannonAmmo = 1;
      const shells = match.world.tankShells.length; message = step(['Mouse1'], ['Digit2']); deliver(cannon, message);
      t.check(message.sl === null && match.world.tankShells.length === shells + 1 && match.world.vehicleWeaponFor(cannon) === 'cannon',
        'squad: dedicated cannon operator fires independently and cannot steal the MG via key 2');
      connect(passenger); message = step(['Mouse1'], ['Digit1', 'Digit2', 'KeyR']);
      t.check(!message.f && !message.r && message.sl === null && !message.fp && !message.u,
        'squad: rear passenger cannot fire, reload or select vehicle or personal weapons');
      Online.interpolate(); Online.frame(STEP, 0.4);
      const visualTank = state.world.vehicleById(tank.id);
      t.check(state.world.players.filter(p => p.vehicle === tank.id).every(p => {
        const at = state.world.vehicleSeatPoint({ ...visualTank, angle: visualTank.angle + (visualTank.oa || 0) }, p.vehicleSeat);
        return Math.hypot(p.x + p.ox - at.x - (visualTank.ox || 0), p.y + p.oy - at.y - (visualTank.oy || 0)) < 1e-6;
      }), 'squad: all four occupants stay attached to the displayed tank hull during interpolation');
      tank.cannonAngle = 0; tank.cannonCooldown = 0; tank.cannonReload = 0; tank.cannonAmmo = 1; tank.vx = tank.vy = 0;
      match.world.updateVehiclePlayer(driver, { mx: 0, my: 0, aimX: tank.x, aimY: tank.y - 1000, fire: true, slot: 0 });
      match.world.updateVehiclePlayer(cannon, { mx: 0, my: 0, interactPressed: true });
      const beforeHandoff = match.world.tankShells.length;
      match.world.updateVehicles(STEP);
      match.sendSnapshots(match.world.events.splice(0));
      const handoffShell = match.world.tankShells.at(-1);
      t.check(!tank.seats.rearLeft && match.world.tankShells.length === beforeHandoff + 1 &&
        Math.abs(handoffShell.dx) < 1e-6 && handoffShell.dy < -0.999,
        'squad: same-tick cannon crew exit gives the driver its current northward aim, not the former operator angle');
    }

    // Natural rocks are binary terrain; only tank cannon/ram destruction travels.
    const rock = { id: 0, x: tank.x + 250, y: tank.y, r: 60, alive: true };
    match.map.rocks = [rock]; match.world.buildSolids(); connect(observer);
    t.check(rock.alive && state.world.map.rocks[0].alive && !('hp' in rock) && !('maxHp' in rock) && !('hp' in state.world.map.rocks[0]),
      tag + ': natural rocks initialize intact without health fields');
    t.check(!('rockHp' in match.syncMessage()) && !('rockHp' in last),
      tag + ': natural-rock health is absent from sync and snapshot packets');
    match.world.damageMapRock(rock, 'grenade', driver.id); match.sendSnapshots(match.world.events.splice(0));
    t.check(rock.alive && state.world.map.rocks[0].alive && !last.e.some(e => e.t === 'rock-hp' || e.t === 'rock-gone'),
      tag + ': ordinary explosives do not alter or replicate natural-rock health');
    match.world.damageMapRock(rock, 'tank-cannon', driver.id); match.sendSnapshots(match.world.events.splice(0));
    t.check(!rock.alive && !state.world.map.rocks[0].alive && !('hp' in state.world.map.rocks[0]) &&
      last.e.filter(e => e.t === 'rock-gone').length === 1 && !last.e.some(e => e.t === 'rock-hp'),
      tag + ': one cannon hit globally removes natural terrain without introducing health');
    connect(observer, true);
    t.check(!state.world.map.rocks[0].alive && !('hp' in state.world.map.rocks[0]),
      tag + ': reconnect keeps broken natural rocks absent without health fields');
    Online.applySync({ ...match.syncMessage(), rockHp: [[rock.id, 1000]] });
    Online.applyEvent({ t: 'rock-hp', id: rock.id, hp: 1000, n: 100, x: rock.x, y: rock.y });
    t.check(!state.world.map.rocks[0].alive && !('hp' in state.world.map.rocks[0]),
      tag + ': legacy natural-rock HP fields are ignored without resurrecting terrain');
    tank.x = 8000; tank.y = 8000; tank.angle = 0; tank.vx = W.TANK.maxSpeed; tank.vy = 0;
    match.world.syncVehicleSeats(tank);
    const obstacle = { id: 0, x: tank.x + tank.r + 60 + 5, y: tank.y, r: 60, alive: true };
    match.map.rocks = [obstacle]; match.world.solids = new ServerW.U.SpatialHash(256); match.world.buildSolids();
    replica = connect(driver);
    step(['KeyD']);
    match.world.damageMapRock(obstacle, 'tank-cannon', driver.id);
    match.sendSnapshots(match.world.events.splice(0));
    t.check(!state.world.map.rocks[0].alive && replica.x > tank.x + W.TANK.maxSpeed * STEP * 0.9 && !replica.predictedRocks[0],
      tag + ': same-packet rock destruction removes its stale hitbox before pending drive replay');
    t.near(replica.x - tank.x, W.TANK.maxSpeed * STEP, 0.02,
      tag + ': unobstructed replay respects the reduced tank speed cap');

    // Placed rocks use structure messages and survive until exactly zero HP.
    match.map.rocks = []; match.world.solids = new ServerW.U.SpatialHash(256); match.world.buildSolids();
    tank.x = 9000; tank.y = 9000; tank.angle = 0; tank.vx = W.TANK.maxSpeed; tank.vy = 0;
    match.world.syncVehicleSeats(tank);
    const placed = match.world.addStruct({ kind: 'rock', item: 'rock', x: tank.x + tank.r + 116 + 5, y: tank.y,
      r: 116, hp: 1000, maxHp: 1000, owner: observer.id, team: observer.team });
    match.world.events = [];
    replica = connect(driver, true);
    const hullBefore = tank.hp, placedReplica = state.world.structById(placed.id);
    t.check(placedReplica && placedReplica.hp === 1000 && placedReplica.maxHp === 1000,
      tag + ': initial fullsync restores a placed rock and its 1000 HP');
    message = step(['KeyD']);
    t.check(placedReplica.hp === 1000 && placedReplica.alive && replica.hp === hullBefore &&
      replica.predictedStructRockDamage[placed.id] === 100 && replica.vx === 0 && replica.vy === 0,
      tag + ': a predicted placed-rock ram stops the hull without changing authoritative rock or vehicle health');
    deliver(driver, message);
    t.check(placed.hp === 900 && placedReplica.hp === 900 && tank.hp === hullBefore - 75 && replica.hp === tank.hp,
      tag + ': accepted ram synchronizes exactly 100 rock damage and 75 hull damage');
    t.check(tank.vx === 0 && tank.vy === 0 && replica.vx === 0 && replica.vy === 0 && Math.abs(replica.x - tank.x) < 0.02,
      tag + ': authoritative and predicted placed-rock rams finish at the same full stop');
    replica = connect(driver, true);
    t.equal(state.world.structById(placed.id).hp, 900, tag + ': reconnect preserves partial placed-rock HP');
    for (let i = 0; i < 8; i++) match.world.damagePlayerRock(placed, driver.id);
    match.sendSnapshots(match.world.events.splice(0));
    t.check(placed.alive && placed.hp === 100 && state.world.structById(placed.id).alive && state.world.structById(placed.id).hp === 100,
      tag + ': placed rock remains present through its final 100 HP');
    match.world.damagePlayerRock(placed, driver.id); match.sendSnapshots(match.world.events.splice(0));
    t.check(!placed.alive && placed.hp === 0 && !state.world.structById(placed.id),
      tag + ': final 100 damage removes the placed rock at zero HP');
    t.equal(state.world.events.filter(e => e.type === 'struct' && e.op === 'gone' && e.struct && e.struct.id === placed.id).length, 1,
      tag + ': pre-replay placed-rock removal emits its destruction effects once');
    connect(driver, true);
    t.check(!state.world.structById(placed.id), tag + ': reconnect keeps a destroyed placed rock absent');

    tank.x = 9000; tank.y = 9000; tank.angle = 0; tank.vx = W.TANK.maxSpeed; tank.vy = 0;
    match.world.syncVehicleSeats(tank);
    const lastHitRock = match.world.addStruct({ kind: 'rock', item: 'rock', x: tank.x + tank.r + 116 + 5, y: tank.y,
      r: 116, hp: 100, maxHp: 1000, owner: observer.id, team: observer.team });
    match.world.events = []; replica = connect(driver, true);
    step(['KeyD']);
    t.check(replica.predictedStructRocks[lastHitRock.id] && state.world.structById(lastHitRock.id).hp === 100 && replica.vx === 0,
      tag + ': predicted final placed-rock hit records passability but still stops for the hit tick');
    match.world.damagePlayerRock(lastHitRock, observer.id); match.sendSnapshots(match.world.events.splice(0));
    t.check(!state.world.structById(lastHitRock.id) && replica.x > tank.x + W.TANK.maxSpeed * STEP * 0.9 && !replica.predictedStructRocks[lastHitRock.id] &&
      !replica.predictedStructRockDamage[lastHitRock.id], tag + ': placed-rock gone event removes the stale collider before unacknowledged driving replays');

    tank.x = 10000; tank.y = 10000; tank.angle = 0; tank.vx = W.TANK.maxSpeed; tank.vy = 0;
    match.world.syncVehicleSeats(tank);
    const natural = { id: 0, x: tank.x + tank.r + 60 + 5, y: tank.y, r: 60, alive: true };
    match.map.rocks = [natural]; match.world.solids = new ServerW.U.SpatialHash(256); match.world.buildSolids();
    replica = connect(driver); const beforeNatural = tank.hp;
    message = step(['KeyD']);
    t.check(state.world.map.rocks[0].alive && replica.predictedRocks[0] && replica.vx > W.TANK.maxSpeed * 0.49 && replica.vx < W.TANK.maxSpeed * 0.65,
      tag + ': natural-rock prediction passes its collider at roughly half speed while awaiting authoritative destruction');
    deliver(driver, message);
    t.check(!natural.alive && !state.world.map.rocks[0].alive && tank.hp === beforeNatural - 50 && replica.hp === tank.hp,
      tag + ': full-speed natural-rock ram instantly destroys it and costs exactly 50 hull HP');
    t.check(Math.abs(replica.x - tank.x) < 0.02 && Math.abs(replica.vx - tank.vx) < 0.02,
      tag + ': natural-rock half-speed prediction converges to authoritative movement');
  } finally { match.destroy(); }
}
t.done();
