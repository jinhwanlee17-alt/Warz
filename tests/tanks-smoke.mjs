// Tank gameplay through the shared authority and prediction paths.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(), C = W.CONFIG, T = W.TANK, t = suite('Tanks');
const X = 8000, Y = 8000, EAST = { mx: 1, my: 0 }, DT = 0.05;
function arena(extra = {}, teams = false, remote = false, type = 'tank') {
  const map = Object.assign({ seed: 7, size: C.worldSize, rocks: [], trees: [], bushes: [], buildings: [],
    crates: [], pickups: [], ponds: [], stations: [], drops: [], towns: [], nextPickupId: 1,
    vehicles: [{ id: 1, type, x: X, y: Y, angle: 0 }], tanks: [] }, extra);
  const w = new W.World({ map, teams, remote, storm: false }), v = w.vehicles[0];
  const at = w.vehicleSeatPoint(v, 'driver', true), p = w.addPlayer({ ...at, team: 1 });
  if (remote) { p.vehicle = v.id; p.vehicleSeat = 'driver'; v.seats.driver = p.id; v.hidden = false; w.syncVehicleSeats(v); }
  else if (!w.enterVehicle(p, v, 'driver')) throw Error('Driver boarding fixture failed');
  w.events = [];
  return { w, v, p };
}
function board(a, seat, team = 1) {
  const p = a.w.addPlayer({ ...a.w.vehicleSeatPoint(a.v, seat, true), team });
  const ok = a.w.enterVehicle(p, a.v, seat);
  return { p, ok };
}
function prime(a, ratio = 1) { a.v.vx = W.vehicleDef(a.v).maxSpeed * ratio; a.v.vy = 0; a.v.angle = 0; }
function tick(a, count = 1, dt = DT) { for (let i = 0; i < count; i++) { a.w.time += dt; a.w.updateVehicles(dt); } }
function enemy(a, x, y = Y, team = 2) { const p = a.w.addPlayer({ x, y, team }); p.hp = p.maxHp = 2000; return p; }
function rock(x = X + T.radius + 50 + 2) { return { id: 0, x, y: Y, r: 50, alive: true }; }
function crate(x = X + T.radius + C.crateSize / 2 + 2) { return { id: 0, x, y: Y, size: C.crateSize, tier: 'common', hp: 100, maxHp: 100, alive: true }; }
function impact(a, x, y, hit = null) { a.w.tankShellImpact({ id: 99, owner: a.p.id, vehicle: a.v.id, team: 1 }, hit, x, y); }

for (const seed of [1, 57, 9001]) {
  const map = W.MapGen.generate(seed), w = new W.World({ map, storm: false });
  t.equal(map.tanks.length, 4, seed + ': four tanks spawn');
  t.equal(w.vehicles.length, 12, seed + ': tanks coexist with eight Humvees');
  t.equal(JSON.stringify(map.tanks), JSON.stringify(W.MapGen.generate(seed).tanks), seed + ': deterministic tank spawns');
  for (const v of w.vehicles.filter(v => v.type === 'tank')) {
    const radius = Math.hypot(v.x-map.size/2, v.y-map.size/2)/map.size;
    t.check(v.hp === 5000 && radius >= .32 && radius <= .34, 'tank has 5000 HP and spawns on inner ring');
    t.check(map.rocks.every(r => Math.hypot(r.x-v.x,r.y-v.y) > r.r+v.r+60) &&
      map.ponds.every(r => Math.hypot(r.x-v.x,r.y-v.y) > r.r+v.r+60), 'tank has dry clear boarding space');
  }
}
{
  const a = arena(); a.p.vehicleIntent = EAST; a.p.commandBuff = 10;
  tick(a, 80);
  t.near(Math.hypot(a.v.vx,a.v.vy), C.playerSpeed*C.sprintSpeedMul*1.35*.7, .001, 'tank top speed is reduced30% and ignores driver buffs');
  a.w.driveVehicle(a.v,{mx:0,my:1},DT);
  t.check(a.v.angle > 0 && a.v.angle <= T.turnRate*DT+1e-9 && a.v.x > X && a.v.y > Y, 'tank follows a smooth turning arc');
  t.check(['gunner','rearLeft','rearRight'].every(seat=>!a.w.vehicleSeatAvailable(a.v,seat,a.p)), 'solo tank can be operated by its driver alone');
  a.w.updateVehiclePlayer(a.p,{slot:1}); t.equal(a.w.vehicleWeaponFor(a.p),'mg','2 selects driver machine gun');
  a.w.updateVehiclePlayer(a.p,{slot:0}); t.equal(a.w.vehicleWeaponFor(a.p),'cannon','1 selects driver cannon');
}
{
  const a = arena({},true), mg = board(a,'gunner'), cannon = board(a,'rearLeft'), passenger = board(a,'rearRight');
  t.check(mg.ok && cannon.ok && passenger.ok, 'tank seats four total');
  t.check(!board(a,'rearRight').ok && !board(a,'gunner',2).ok, 'occupied seats cannot take extra or enemy riders');
  t.equal(a.w.vehicleWeaponFor(mg.p),'mg','gunner has dedicated machine gun');
  t.equal(a.w.vehicleWeaponFor(cannon.p),'cannon','cannon operator has dedicated cannon');
  t.equal(a.w.vehicleWeaponFor(passenger.p),null,'fourth passenger cannot fire');
  a.p.vehicleWeapon = 0; t.equal(a.w.vehicleWeaponFor(a.p),null,'driver cannot override occupied cannon');
  a.p.vehicleWeapon = 1; t.equal(a.w.vehicleWeaponFor(a.p),null,'driver cannot override occupied MG');
  a.w.exitVehicle(mg.p,true); t.equal(a.w.vehicleWeaponFor(a.p),'mg','driver can take over vacant MG');
  a.w.exitVehicle(cannon.p,true); a.p.vehicleWeapon=0;
  t.equal(a.w.vehicleWeaponFor(a.p),'cannon','driver can take over vacant cannon');
}
{
  const a = arena(); a.w.setClass(a.p,'grenadier2',true);
  a.p.controller = () => ({ ...EAST, slot:0, fire:true, firePressed:true, utility:true, charge:.75, utilityCharge:.75, aimX:X+3000,aimY:Y });
  const ammo = a.p.weapons.map(w=>w.ammo).join(','), grenades = a.p.grenades;
  a.w.update(DT);
  t.equal(a.w.events.filter(e=>e.type==='tank-shell'&&e.op==='spawn').length,1,'holding fire shoots first cannon shell');
  for(let i=0;i<59;i++) a.w.update(DT);
  t.equal(a.w.events.filter(e=>e.type==='tank-shell'&&e.op==='spawn').length,1,'second cannon shell waits three seconds');
  a.w.update(DT);
  t.equal(a.w.events.filter(e=>e.type==='tank-shell'&&e.op==='spawn').length,2,'held cannon fires again after three seconds');
  t.equal(a.p.weapons.map(w=>w.ammo).join(','),ammo,'cannon uses no personal ammo');
  t.equal(a.p.grenades,grenades,'tank cannot throw class grenades');
  t.equal(a.w.grenades.length,0,'held launcher never interferes with tank weapons');
  t.check(a.v.x > X && a.v.hp===5000,'single driver moves and shoots without hitting own hull');
}
{
  const a=arena(); a.p.vehicleWeapon=1; a.p.vehicleIntent={fire:true}; a.p.commandBuff=10;
  tick(a);
  t.equal(a.v.mgAmmo,999,'machine gun consumes one of 1000 rounds');
  t.check(a.w.bullets.length>0 && a.w.bullets.every(b=>b.damage===8),'machine gun projectile deals eight base damage');
  const b=a.w.bullets[0], target=enemy(a,X+500);
  a.w.damagePlayer(target,b.damage,a.p.id,'tankmg');
  t.equal(target.hp,1992,'driver damage buff cannot increase specified eight damage');
  a.v.mgAmmo=1; a.v.cooldown=0; tick(a);
  t.equal(a.v.mgAmmo,0,'last round empties magazine'); t.equal(a.v.mgReload,4,'empty magazine automatically starts four-second reload');
  const shots=a.p.stats.shots; tick(a,79);
  t.equal(a.p.stats.shots,shots,'cannot shoot during reload');
  tick(a); t.equal(a.v.mgAmmo,999,'infinite reserves refill then held fire resumes');
  t.equal(a.p.stats.shots,shots+1,'one shot after reload');
  const turret=arena({},true,'', 'humvee'), gunner=board(turret,'gunner');
  gunner.p.vehicleIntent={fire:true}; turret.w.events=[];
  const tank=arena(); tank.p.vehicleWeapon=1; tank.p.vehicleIntent={fire:true};
  tick(turret,100); tick(tank,100);
  t.equal(tank.p.stats.shots,gunner.p.stats.shots,'tank MG matches Turret I fire rate');
}
{
  const a=arena(), target=enemy(a,X+450); a.p.commandBuff=10;
  a.w.fireTankCannon(a.p,a.v); tick(a,8);
  t.equal(target.hp,1500,'swept direct cannon hit deals500 without class amplification');
  t.equal(a.w.tankShells.length,0,'shell ends at its impact');
  t.check(a.w.explosions.some(e=>e.r===75),'cannon explosion uses half ordinary grenade radius');
}
for(const d of [0,37.5,74.9,75.1]) {
  const a=arena(), target=enemy(a,X+1000+d+C.playerRadius);
  impact(a,X+1000,Y);
  const expected=d<75 ? Math.round((75+425*(1-d/75))*10)/10 : 0;
  t.near(2000-target.hp,expected,.1,'cannon splash falloff at surface distance '+d);
}
{
  const cover=rock(X+1000),a=arena({rocks:[cover]}),target=enemy(a,cover.x+cover.r+C.playerRadius+2);
  impact(a,cover.x-cover.r-8,Y,{solid:{rock:cover}});
  t.check(!cover.alive&&!('hp' in cover)&&!('maxHp' in cover),'cannon instantly breaks a natural rock without health');
  t.equal(target.hp,2000,'natural cover blocks cannon splash');
}
{
  const a=arena({},true),friend=enemy(a,X+1000,Y,1); impact(a,friend.x,friend.y,{player:friend});
  t.equal(friend.hp,2000,'friendly teammates remain protected');
  const b=arena({},true),crew=[b.p,board(b,'gunner').p,board(b,'rearLeft').p,board(b,'rearRight').p];
  const shooter=enemy(b,X+1000); b.v.hp=100;
  b.w.tankShellImpact({id:10,owner:shooter.id,team:2,vehicle:0},{solid:{vehicle:b.v}},X+T.radius+8,Y);
  t.check(b.v.wreck&&crew.every(p=>!p.vehicle&&p.hp===100),'fatal hull hit ejects crew without same explosion damaging them again');
  t.check(!b.w.enterVehicle(b.p,b.v,'driver')&&!b.w.damageVehicle(b.v,999,null,'tank-cannon'),'wreck is unrideable and indestructible');
}
for(const type of ['tank','humvee']) {
  const box=crate(X+W.vehicleDef({type}).radius+C.crateSize/2+2),a=arena({crates:[box]},false,false,type);
  prime(a); a.p.vehicleIntent=EAST; tick(a);
  t.check(!box.alive&&a.p.stats.crates===1,type+': full-speed crush releases normal crate reward once');
  t.equal(a.v.hp,W.vehicleDef(a.v).hp-10,type+': crushing costs10 hullHP');
  tick(a,10); t.equal(a.v.hp,W.vehicleDef(a.v).hp-10,type+': broken crate has no repeated cost');
  const b=arena({},false,false,type); prime(b); b.p.vehicleIntent=EAST;
  const target=enemy(b,X+b.v.r+C.playerRadius+2); tick(b);
  t.near(2000-target.hp,65,.1,type+': fullspeed player ram damage65');
  t.equal(b.v.hp,W.vehicleDef(b.v).hp-10,type+': player ram costs10 hullHP');
  tick(b); t.equal(b.v.hp,W.vehicleDef(b.v).hp-10,type+': continuous player contact is charged once');
  const c=arena({crates:[crate(X+W.vehicleDef({type}).radius+C.crateSize/2+2)]},false,false,type);
  c.v.hp=10; prime(c); c.p.vehicleIntent=EAST; tick(c);
  t.check(c.v.wreck && c.v.vx===0 && !c.p.vehicle,type+': fatal crush stops vehicle and safely ejects driver');
}
{
  const r=rock(),a=arena({rocks:[r]}); prime(a);
  a.w.driveVehicle(a.v,EAST,1/120);
  t.check(!r.alive&&!('hp' in r)&&!('maxHp' in r),'full-speed tank ram instantly destroys a natural rock without health');
  t.equal(a.v.hp,4950,'natural rock ram costs50 tankHP');
  t.near(Math.hypot(a.v.vx,a.v.vy),T.maxSpeed/2,.001,'rock impact halves speed');
  t.equal(r.alive,false,'rammed natural rock immediately disappears');
  t.check(a.v.vx>0,'tank continues forward through the broken natural rock');
  const copy=rock(),remote=arena({rocks:[copy]},false,true); prime(remote);
  const before=JSON.stringify({rng:remote.w.rng,loot:remote.w.map.pickups});
  remote.w.driveVehicle(remote.v,EAST,1/120);
  t.near(remote.v.x,a.v.x,1e-9,'prediction matches rock-ram position');
  t.near(remote.v.vx,a.v.vx,1e-9,'prediction matches rock-ram velocity');
  t.check(copy.alive&&!('hp' in copy)&&remote.v.hp===5000&&remote.w.events.length===0,'prediction cannot remove natural rock, inventHP, changehullHP or publish damage');
  t.equal(JSON.stringify({rng:remote.w.rng,loot:remote.w.map.pickups}),before,'prediction consumes no randomness or loot');
}
for(const hp of [1000,100,1]) {
  function setup(remote=false) {
    const a=arena({},false,remote);
    const placed=a.w.addStruct({kind:'rock',item:'rock',x:X+T.radius+116+2,y:Y,r:116,hp,maxHp:1000,owner:a.p.id,team:a.p.team});
    a.w.events=[]; prime(a); return {...a,placed};
  }
  const a=setup(); a.w.driveVehicle(a.v,EAST,DT);
  t.equal(a.placed.hp,Math.max(0,hp-100),'player rock loses100 HP per full-speed ram');
  t.equal(a.v.hp,4925,'player rock ram costs75 hullHP');
  t.equal(a.v.vx,0,'player rock stops tank completely for the rest of the tick, even on destruction');
  t.equal(a.placed.alive,hp>100,'player rock disappears only when HP reaches0');
  t.check(a.v.x<=a.placed.x-a.placed.r-a.v.r+.01,'tank stops outside player rock');
  const replica=setup(true),before=JSON.stringify({rng:replica.w.rng,loot:replica.w.map.pickups});
  replica.w.driveVehicle(replica.v,EAST,DT);
  t.near(replica.v.x,a.v.x,1e-8,'placed-rock prediction matches authoritative stop position');
  t.equal(replica.v.vx,0,'placed-rock prediction stops immediately');
  t.check(replica.placed.hp===hp&&replica.v.hp===5000&&replica.w.events.length===0,'prediction does not change player rockHP/hullHP/events');
  t.equal(JSON.stringify({rng:replica.w.rng,loot:replica.w.map.pickups}),before,'placed-rock prediction consumes no RNG or loot');
  t.equal(!!replica.v.predictedStructRocks[replica.placed.id],hp<=100,'prediction ignores only a rock destroyed by the ram');
  for(let i=0;i<40;i++) { a.w.driveVehicle(a.v,EAST,DT); replica.w.driveVehicle(replica.v,EAST,DT); }
  t.near(replica.v.x,a.v.x,.001,'following input converges through removed rock or stays blocked by surviving rock');
  t.equal(a.v.hp,4925,'holding movement against the rock cannot repeatedly charge hull damage');
  t.equal(a.placed.hp,Math.max(0,hp-100),'low-speed contact after the first ram cannot repeat rock damage');
}
{
  const a=arena(),r=a.w.addStruct({kind:'rock',item:'rock',x:X+T.radius+116+2,y:Y,r:116,team:2});
  t.equal(r.hp,1000,'new player-placed rock starts with1000 HP');
  for(let i=1;i<=10;i++) {
    a.v.x=X; a.v.y=Y; prime(a); a.w.driveVehicle(a.v,EAST,DT);
    t.equal(r.hp,1000-i*100,'separate full-speed ram '+i+' deals exactly100 player-rock damage');
    t.equal(r.alive,i<10,'player rock survives until the tenth full-speed hit');
  }
  t.equal(a.v.hp,4250,'ten player-rock rams each cost75 hullHP');
  t.equal(a.w.events.filter(e=>e.type==='struct'&&e.op==='gone').length,1,'player rock emits one removal at zero');
}
{
  const r=rock(),a=arena({rocks:[r]}); prime(a,.5); a.w.driveVehicle(a.v,{mx:.5,my:0},1);
  t.check(r.alive&&!('hp' in r),'slow tank leaves natural rock intact without health');
  t.check(a.v.x <= r.x-r.r-a.v.r+.01,'rock remains solid at low speed');
}
t.done();
