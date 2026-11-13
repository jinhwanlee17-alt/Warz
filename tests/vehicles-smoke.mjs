// Vehicle rules exercised through shared simulation, including real collision/damage paths.
import { loadWarz, suite } from './harness.mjs';
import { Nav } from '../server/core/bots/nav.mjs';
import { BotDirector } from '../server/core/bots/index.mjs';
const W = loadWarz(), C = W.CONFIG, V = W.VEHICLE, t = suite('Humvees');
const DT = 1 / 20;
function arena(teams = false, extra = {}) {
  const map = Object.assign({ seed: 5, size: C.worldSize, rocks: [], trees: [], bushes: [], buildings: [],
    crates: [], pickups: [], ponds: [], stations: [], drops: [], towns: [], nextPickupId: 1,
    vehicles: [{ id: 1, x: 8000, y: 8000, angle: 0 }], tanks: [] }, extra);
  return new W.World({ map, teams, storm: false });
}
function board(w, seat = 'driver', team = 1, v = w.vehicles[0], classId = 'soldier') {
  const at = w.vehicleSeatPoint(v, seat, true);
  const p = w.addPlayer({ x: at.x, y: at.y, team, classId });
  t.check(w.enterVehicle(p, v, seat), seat + ': nearby player enters a free seat');
  return p;
}
function crew(w) { return ['driver', 'gunner', 'rearLeft', 'rearRight'].map(seat => board(w, seat)); }
function step(w, seconds) { for (let i = 0; i < Math.round(seconds / DT); i++) w.update(DT); }

for (const seed of [1, 42, 57, 9001, 123456]) {
  const map = W.MapGen.generate(seed), w = new W.World({ map, storm: false });
  const humvees = w.vehicles.filter(v => v.type === 'humvee');
  t.equal(humvees.length, 8, 'seed ' + seed + ': exactly eight Humvees spawn');
  t.equal(w.vehicles.filter(v => v.type === 'tank').length, 4, 'seed ' + seed + ': four tanks share the map with the Humvees');
  t.equal(map.crates.length, 211, 'seed ' + seed + ': extra crates retain the single legendary');
  t.equal(new Set(w.vehicles.map(v => v.id)).size, W.VEHICLE.count + W.TANK.count + W.ARTILLERY.count + W.GROUND_ARTILLERY.count, 'Humvees, tanks and artillery have unique vehicle identifiers');
  t.equal(new Set(humvees.map(v => Math.floor(((Math.atan2(v.y-map.size/2,v.x-map.size/2)+Math.PI/8+Math.PI*2)%(Math.PI*2))/(Math.PI/4)))).size, 8,
    'each of eight outer-lane sectors has one Humvee');
  t.check(humvees.every(v => { const extent=Math.max(Math.abs(v.x-map.size/2),Math.abs(v.y-map.size/2))/map.size; return extent>=.40 && extent<=.46; }),
    'all eight Humvees stay near the requested red perimeter lane');
  for (const v of humvees) {
    t.check(v.hp === 1000 && !v.armed && !v.wreck, 'Solo Humvee begins intact, unarmed and at 1,000 HP');
    t.check(W.U.insideIsland(v.x, v.y, v.r + 70, C.worldSize, C.cornerRadius) &&
      map.ponds.every(p => Math.hypot(p.x-v.x,p.y-v.y) > p.r + v.r + 70) &&
      map.rocks.every(p => Math.hypot(p.x-v.x,p.y-v.y) > p.r + v.r + 70), 'spawn is dry with room to enter and exit');
  }
  const team = new W.World({ map, teams: true, storm: false });
  const teamHumvees = team.vehicles.filter(v => v.type === 'humvee');
  t.equal(teamHumvees.filter(v => v.armed).length, 2, 'team matches have exactly two armed Humvees');
  t.check(teamHumvees.every(v => ['rearLeft', 'rearRight'].every(seat => team.vehicleSeatAvailable(v, seat, { team: 1 }))), 'all team Humvees have two rear seats');
  t.check(JSON.stringify(map.vehicles) === JSON.stringify(W.MapGen.generate(seed).vehicles), 'vehicle spawn locations are deterministic');
}
{
  const w = arena(), v = w.vehicles[0], p = board(w);
  t.check(['gunner', 'rearLeft', 'rearRight'].every(seat => !w.vehicleSeatAvailable(v, seat, { team: p.team })), 'Solo offers no gunner or passenger seats');
  t.check(!w.vehicleSeatAvailable(v, 'driver', { team: p.team }), 'an occupied seat cannot be claimed twice');
  t.check(w.pressInteract(p) && !p.vehicle && !v.seats.driver, 'E exits and releases the driver seat');
  t.check(Math.hypot(p.x-v.x,p.y-v.y) >= v.r + p.r, 'exit lands outside the hull');
  const at = w.vehicleSeatPoint(v, 'driver', true); p.x=at.x; p.y=at.y;
  t.check(w.pressInteract(p) && p.vehicle === v.id, 'E boards the nearest available seat');
  const enemy = w.addPlayer({ x: at.x, y: at.y, team: 2 });
  t.check(!w.enterVehicle(enemy, v, 'driver'), 'an enemy cannot steal an occupied driver seat');
}
{
  const w = arena(true), v = w.vehicles[0], occupants = crew(w);
  t.equal(new Set(Object.values(v.seats)).size, 4, 'driver, gunner and two passengers occupy distinct seats');
  t.check(w.vehicleSeatPoint(v, 'gunner', true).y > v.y, 'the gun is boarded from the side');
  occupants.forEach((p, i) => { p.controller = () => ({ mx: i ? -1 : 1, my: i ? 1 : 0, sprint: true, fire: false }); });
  occupants[0].commandBuff = 10; occupants[0].fx.speed = 10;
  step(w, 3);
  t.near(Math.hypot(v.vx,v.vy), C.playerSpeed * 2 * 0.7, 0.001, 'top speed is 30% below the original double-player speed, unaffected by driver buffs or sprint');
  t.near(v.y, 8000, 0.001, 'passenger steering does not affect the vehicle');
  t.check(occupants.every(p => { const at=w.vehicleSeatPoint(v,p.vehicleSeat); return Math.hypot(p.x-at.x,p.y-at.y)<0.001; }), 'all occupants move with their seats');
  t.check(occupants.every(p => p.stamina === 100 && !p.sprinting), 'driving and riding do not consume sprint stamina');
  occupants[0].controller=()=>({mx:0,my:0}); step(w,3);
  t.near(Math.hypot(v.vx,v.vy), 0, 0.01, 'releasing movement brings the Humvee to a stop');
}
for (const fraction of [0, 0.25, 0.5, 1]) {
  const w=arena(), v=w.vehicles[0], driver=board(w);
  driver.commandBuff=10; driver.vehicleIntent={mx:fraction,my:0}; v.vx=V.maxSpeed*fraction;
  const enemy=w.addPlayer({x:v.x+v.r+C.playerRadius+v.vx*DT/2,y:v.y,team:2});
  w.time+=DT; w.updateVehicles(DT);
  t.near(100-enemy.hp,65*fraction,0.06,'ram damage scales linearly at '+fraction*100+'% speed without driver damage buffs');
  const hp=enemy.hp; w.time+=DT; w.updateVehicles(DT);
  t.equal(enemy.hp,hp,'continuous contact does not reapply ram damage every tick');
}
{
  const w=arena(true), v=w.vehicles[0], driver=board(w,'driver',1,v,'grenadier'), gunner=board(w,'gunner',1,v,'grenadier');
  w.addItem(gunner,'firenade',2); gunner.held=0;
  const before=driver.grenades, startX=v.x;
  driver.controller=()=>({mx:1,my:0,fire:true,firePressed:true,utility:true,charge:0.75,utilityCharge:0.75,aimX:v.x+500,aimY:v.y});
  gunner.controller=()=>({mx:-1,my:1,fire:true,utility:true,aimX:v.x+500,aimY:v.y});
  step(w,1.2);
  const shots=w.events.filter(e=>e.type==='vehicle-shot');
  t.check(shots.length>=10 && shots.every(e=>e.player===gunner),'holding fire uses the gunner machine gun even with grenades equipped');
  t.check(v.x>startX && Math.abs(v.y-8000)<0.001,'driver can move while a separate gunner shoots');
  t.equal(driver.grenades,before,'driver cannot throw class grenades');
  t.equal(w.grenades.length,0,'seated launcher and item inputs do not launch grenades');
  t.equal(w.countItem(gunner,'firenade'),2,'gunner cannot use held throwables');
  t.equal(v.hp,1000,'mounted bullets cannot hit their own Humvee');
  t.check(w.bullets.every(b=>b.damage===W.ITEMS.turret.damage),'machine gun uses Turret I damage');
  w.exitVehicle(gunner,true); const n=shots.length; step(w,0.3);
  t.equal(w.events.filter(e=>e.type==='vehicle-shot').length,n,'driver fire cannot control an empty gunner seat');
}
for (const kind of ['direct','explosion','airstrike','flame','storm','fire']) {
  const w=arena(true),v=w.vehicles[0],occupants=crew(w),attacker=w.addPlayer({x:v.x-250,y:v.y,team:2,classId:'juggernaut'});
  let damage;
  if(kind==='direct'){damage=80;w.damagePlayer(occupants[1],damage,attacker.id,'ar');}
  if(kind==='explosion'){damage=120;w.explode(v.x,v.y,{radius:260,maxDamage:damage},attacker.id,'grenade');}
  if(kind==='airstrike'){damage=250;w.addStrike({kind:'airstrike',x:v.x,y:v.y,t:0.01,radius:225,damage,owner:attacker.id,team:attacker.team});w.updateStrikes(0.02);}
  if(kind==='flame'){w.setClass(attacker,'pyromancer',true); attacker.angle=0; const def=W.WEAPONS[attacker.weapons[0].id]; damage=def.damage;w.fireFlame(attacker,def);}
  if(kind==='storm'){damage=15;w.storm=new W.Storm(w);w.time=W.STORM.at(-1).end+1;w.storm.tick=0;w.storm.update(1);}
  if(kind==='fire'){damage=5;w.addZone({kind:'fire',x:v.x,y:v.y,r:200,dur:2,dps:20,owner:attacker.id,team:attacker.team});w.updateZones(0.01);}
  t.near(1000-v.hp,damage,0.1,kind+': damage is applied once to the hull, independent of crew size');
  t.check(occupants.every(p=>p.hp===100 && p.armor===0 && p.vehicle===v.id),kind+': every occupant stays protected');
}
{
  const w=arena(true),v=w.vehicles[0],occupants=crew(w),enemy=w.addPlayer({x:v.x-500,y:v.y,team:2});
  w.damageVehicle(v,5000,enemy.id,'ar');
  t.check(v.wreck && v.hp===0 && v.vx===0 && v.vy===0,'destroyed Humvee becomes an immovable wreck');
  t.check(occupants.every(p=>p.hp===100 && !p.vehicle && Math.hypot(p.x-v.x,p.y-v.y)>=v.r+p.r),'destruction ejects everyone safely without overflow damage');
  const x=v.x,y=v.y; w.driveVehicle(v,{mx:1,my:1},1);w.damageVehicle(v,9999,enemy.id,'ar');
  t.check(v.x===x && v.y===y && v.hp===0,'wreck stays indestructible and stationary');
  t.check(!w.lineClear(x-200,y,x+200,y),'wreck blocks shots and sight');
  t.check(!w.spotFree(x,y,24,true),'wreck blocks placement and walking');
  t.check(!w.enterVehicle(occupants[0],v,'driver'),'wreck cannot be boarded');
  const nav=new Nav(W,w);t.check(!nav.freeAt(x,y),'bots route around the solid wreck');
  v.x+=500;t.check(nav.freeAt(x,y),'navigation does not cache a vehicle at an old position');
}
{
  const wall={x:8150,y:7600,w:30,h:800};
  const w=arena(false,{buildings:[{walls:[wall]}]}),v=w.vehicles[0];
  v.vx=V.maxSpeed;w.driveVehicle(v,{mx:1,my:0},0.5);
  t.check(v.x<=wall.x-v.r+0.01,'fast movement cannot tunnel through a wall');
  const onFoot=w.addPlayer({x:v.x,y:v.y,team:2});w.collide(onFoot);
  t.check(Math.hypot(onFoot.x-v.x,onFoot.y-v.y)>=onFoot.r+v.r-0.01,'an intact Humvee is solid to players');
  t.check(!W.U.circleRectPush(onFoot.x,onFoot.y,onFoot.r,wall.x,wall.y,wall.w,wall.h),'a Humvee cannot push a player through an adjacent wall');
}
{
  const w=arena(true),v=w.vehicles[0],occupants=crew(w),ally=w.addPlayer({x:v.x-400,y:v.y,team:1});
  const hit=w.sweep(v.x-200,v.y,v.x+200,v.y,5,ally.id,ally.team);
  t.check(!hit,'friendly bullets pass an allied occupied Humvee without hitting its passengers');
  w.damageVehicle(v,50,ally.id,'ar');t.equal(v.hp,1000,'team immunity also applies to hull damage');
  w.damageVehicle(v,250,ally.id,'airstrike');t.equal(v.hp,750,'commander airstrike retains its existing friendly damage rule');
  w.explode(v.x,v.y,{radius:260,maxDamage:100},occupants[0].id,'grenade');
  t.equal(v.hp,650,'a crew member own explosive can damage their vehicle');
  t.check(occupants.every(p=>p.hp===100),'friendly and self damage still stay on the hull');
}
{
  const w=arena(true),v=w.vehicles[0],occupants=crew(w),enemy=w.addPlayer({x:v.x-300,y:v.y,team:2});
  const it=W.ITEMS.sentry;
  const sentry=w.addStruct({kind:'sentry',item:'sentry',x:v.x-200,y:v.y,r:20,owner:enemy.id,team:enemy.team,hp:it.hp,maxHp:it.hp});
  w.updateSentry(sentry,DT);
  t.equal(v.hp,1000-it.damage,'enemy sentry can target occupied vehicle hulls');
  t.check(occupants.every(p=>p.hp===100),'sentry fire cannot bypass hull protection');
  v.hp=1;
  const shot={hit:{}}, pellet={owner:enemy.id,team:enemy.team,weapon:'shotgun',damage:50,shot,ox:enemy.x,oy:enemy.y,dx:1,dy:0};
  w.bulletHit(pellet,{solid:{type:'vehicle',vehicle:v}},v.x-v.r,v.y);
  t.check(v.wreck,'first pellet can destroy a damaged hull');
  occupants.forEach(p=>w.bulletHit(pellet,{player:p},p.x,p.y));
  t.check(occupants.every(p=>p.hp===100),'later pellets of the same shotgun blast cannot hit newly ejected occupants');
}
{
  const w=arena(),v=w.vehicles[0],driver=board(w,'driver',2);
  const attacker=w.addPlayer({x:v.x-500,y:v.y,team:1});
  const director=new BotDirector({W,world:w,seed:5,log:console});
  const bot=director.add(attacker,{skill:1,aggression:1,caution:0});
  bot.landed=true;bot.landAt=-100;
  for(let i=0;i<160;i++){director.beforeTick(DT);w.update(DT);director.observe(w.events);w.events=[];}
  t.check(v.hp<1000,'bots recognize an occupied enemy Humvee as a shootable target');
  t.equal(driver.hp,100,'bot bullets hit the hull instead of its driver');
  t.equal(director.errors,0,'bots can fight around vehicles without exceptions');
}
{
  const w=arena(),v=w.vehicles[0];w.remote=true;v.hidden=true;
  const at=w.vehicleSeatPoint(v,'driver',true),p=w.addPlayer({x:at.x,y:at.y,team:1});
  t.check(!w.nearestVehicleSeat(p),'an unknown remote vehicle cannot offer a ghost boarding prompt');
  t.check(w.lineClear(v.x-200,v.y,v.x+200,v.y),'an unknown vehicle does not block line of sight');
  t.check(!w.sweep(v.x-200,v.y,v.x+200,v.y,5,p.id,p.team),'unknown vehicle replicas cannot absorb cosmetic bullets');
  t.check(w.spotFree(v.x,v.y,24,true),'unknown vehicle replicas do not block placement');
  const probe={x:v.x,y:v.y,r:24,vx:0,vy:0};w.collide(probe);
  t.check(probe.x===v.x && probe.y===v.y,'unknown vehicle replicas cannot push players');
  const x=v.x;w.driveVehicle(v,{mx:1,my:0},DT);
  t.equal(v.x,x,'prediction waits for an authoritative vehicle position');
  v.hidden=false;
  t.check(!w.lineClear(v.x-200,v.y,v.x+200,v.y),'revealed authoritative hull becomes solid normally');
}
{
  const w=arena(),v=w.vehicles[0],p=board(w);
  w.respawn(p,9000,9000);
  t.check(!p.vehicle && !v.seats.driver && p.x===9000 && p.y===9000,'respawning releases the seat and keeps the requested spawn position');
  const other=board(w);w.killPlayer(other,null,'disconnect');
  t.check(!other.vehicle && !v.seats.driver,'removing a player also releases their vehicle seat');
}
t.done();
