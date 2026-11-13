import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config','util','map','world','items','controls']);
const t = suite('SP artillery'), X=5000,Y=5000;
function arena(cls='soldier',extra={}) {
  const map=Object.assign({seed:1,size:W.CONFIG.worldSize,teamSize:1,rocks:[],trees:[],buildings:[],crates:[],pickups:[],ponds:[],stations:[],towns:[],drops:[],artillery:[{id:1,type:'artillery',x:X,y:Y}],nextPickupId:1},extra);
  const world=new W.World({map,storm:false}),v=world.vehicles[0],p=world.addPlayer({classId:cls,x:X+v.r+35,y:Y,team:1});
  world.enterVehicle(p,v,'driver');
  const intent={mx:0,my:0,aimX:X+3000,aimY:Y,slot:0};p.controller=()=>intent;
  return {world,v,p,intent};
}
function tick(a,n){for(let i=0;i<Math.round(n/.05);i++)a.world.update(.05);}
{
  const map=W.MapGen.generate(47,4), a=arena();
  t.equal(map.artillery.length,4,'four artillery spawn on the middle yellow lane');
  t.check(map.artillery.every(v=>{const extent=Math.max(Math.abs(v.x-map.size/2),Math.abs(v.y-map.size/2))/map.size;return extent>=.30&&extent<=.38;}),'artillery occupy the middle yellow lane between Humvees and tanks');
  t.equal(a.v.hp,1200,'artillery has the reduced 1200 HP');
  t.equal(a.v.maxHp,1200,'maximum hull HP is correct');
  t.equal(a.world.vehicleMaxSpeed(a.v),W.TANK.maxSpeed,'artillery uses tank movement speed');
  t.equal(a.world.vehicleSeatOrder(a.v).join(),'driver','artillery has a single driving/firing operator');
  t.check(a.p.vehicle===a.v.id,'E interaction enters the driver seat');
  t.check(W.WEAPONS.rpg.zoom>1 && W.WEAPONS.sniper2.zoom>1.65,'Rocketeer and Sniper II retain their wider scopes');
  t.equal(W.ARTILLERY.blastRadius,W.WEAPONS.grenade.explosion.radius*1.5,'artillery blast is 1.5 grenade radii');
}
{
  const a=arena(); a.intent.slot=1; a.intent.artilleryFire=true;tick(a,9.95);
  t.equal(a.world.artilleryShells.length,0,'cannot fire before ten stationary seconds');
  tick(a,.05);
  t.equal(a.world.artilleryShells.length,1,'can fire exactly after ten stationary seconds');
  t.equal(a.p.stats.shots,1,'one Enter press creates one shot');
  a.intent.artilleryFire=false; tick(a,.1);
  t.check(!a.world.fireArtillery(a.p,a.v,X+3000,Y),'cooldown blocks immediate second shot');
  a.intent.slot=0;a.intent.mx=1;tick(a,.2);
  t.equal(a.v.stationaryT,0,'moving resets the stationary deployment timer');
  a.intent.slot=1;a.intent.mx=1;tick(a,3);
  const x=a.v.x;tick(a,1);
  t.near(a.v.x,x,.01,'WASD in firing mode does not drive the hull');
  t.check(a.v.stationaryT<10,'stopping must settle and complete a fresh ten seconds');
  a.intent.mx=0;tick(a,10);
  t.check(a.world.artilleryReady(a.v),'artillery becomes ready again after stopping and cooldown');
  a.intent.slot=0;tick(a,.05);
  t.check(!a.world.fireArtillery(a.p,a.v,X+3000,Y),'drive mode cannot fire artillery');
}
{
  const a=arena();a.intent.slot=1;tick(a,10);
  const ammo=a.p.weapons.map(w=>w.ammo).join();
  a.intent.fire=true;a.intent.firePressed=true;tick(a,.2);
  t.equal(a.p.stats.shots,0,'mouse fire and held click do not launch artillery');
  t.equal(a.p.weapons.map(w=>w.ammo).join(),ammo,'personal weapons stay stowed');
  t.check(!a.world.fireArtillery(a.p,a.v,NaN,Y),'invalid aim coordinates rejected');
  t.check(!a.world.fireArtillery(a.p,a.v,-1,Y),'out-of-map targets rejected');
  t.check(a.world.fireArtillery(a.p,a.v,X+6000,Y),'island-wide target beyond the old 3000 input limit is accepted');
  const shell=a.world.artilleryShells[0];
  t.check(shell.flightTime>=2&&shell.flightTime<=4,'indirect shell has visible flight time');
  tick(a,shell.flightTime+.1);
  t.equal(a.world.artilleryShells.length,0,'travelled shells expire once');
  t.check(a.world.events.some(e=>e.type==='artillery-shell'&&e.op==='impact'),'impact has a dedicated replication event');
}
for(const cls of ['soldier','armorcrew']) {
  const a=arena(cls);a.intent.slot=1;tick(a,10);
  const target=a.world.addPlayer({x:X+1000,y:Y,team:2});target.hp=target.maxHp=10000;
  a.world.artilleryImpact({owner:a.p.id,team:1,vehicle:a.v.id,targetX:target.x,targetY:target.y});
  t.equal(10000-target.hp,1050,cls+': direct blast deals 1050 without Armor Crew bonus');
  t.near(a.world.vehicleMaxSpeed(a.v),W.TANK.maxSpeed*(cls==='armorcrew'?1.1:1),1e-8,cls+': correct SP artillery driving speed');
  a.world.fireArtillery(a.p,a.v,X+3000,Y);
  t.equal(a.v.artilleryCooldown,cls==='armorcrew'?7.5:10,cls+': correct artillery firing interval');
}
{
  const a=arena(), R=W.ARTILLERY.blastRadius;
  const p=a.world.addPlayer({x:X+1000+R,y:Y,team:2});p.r=0;p.hp=p.maxHp=10000;
  a.world.artilleryImpact({owner:a.p.id,team:1,vehicle:a.v.id,targetX:X+1000,targetY:Y});
  t.equal(10000-p.hp,75,'outer blast edge deals 75 damage');
  p.x+=.1;p.hp=10000;
  a.world.artilleryImpact({owner:a.p.id,team:1,vehicle:a.v.id,targetX:X+1000,targetY:Y});
  t.equal(p.hp,10000,'outside blast radius is unharmed');
  const ally=a.world.addPlayer({x:X+1000,y:Y,team:1});
  a.world.artilleryImpact({owner:a.p.id,team:1,vehicle:a.v.id,targetX:ally.x,targetY:ally.y});
  t.equal(ally.hp,100,'normal team protection remains in effect');
}
{
  const a=arena('armorcrew');a.world.exitVehicle(a.p,true);a.v.hp=1000;
  a.p.x=a.v.x+a.v.r+20;a.p.y=a.v.y;
  t.equal(a.world.nearestRepairVehicle(a.p),a.v,'Armor Crewmember can repair SP artillery');
  a.world.remote=true;a.v.stationaryT=10;a.p.vehicle=a.v.id;a.v.seats.driver=a.p.id;a.p.vehicleWeapon=1;
  t.check(!a.world.fireArtillery(a.p,a.v,X+1000,Y),'client replica cannot author a shell');
}
{
  const cover={x:X+1000,y:Y,r:60},outside={x:X+1600,y:Y,r:50};
  const a=arena('soldier',{rocks:[cover,outside]});
  const enemy=a.world.addPlayer({x:cover.x+cover.r+W.CONFIG.playerRadius+2,y:Y,team:2});enemy.hp=enemy.maxHp=10000;
  a.intent.slot=1;tick(a,10);
  t.check(a.world.fireArtillery(a.p,a.v,cover.x-cover.r-8,Y),'an actual artillery shell can target natural cover');
  const shell=a.world.artilleryShells[0];tick(a,shell.flightTime+.1);
  t.check(!cover.alive&&!('hp' in cover)&&!('maxHp' in cover),'artillery shell impact instantly removes a natural rock without adding HP');
  t.equal(a.world.events.filter(e=>e.type==='rock-gone'&&e.rock===cover).length,1,'artillery impact emits one authoritative natural-rock removal');
  t.check(outside.alive,'artillery does not remove rocks outside its blast');
  t.equal(enemy.hp,10000,'the rock still shields players from the explosion that breaks it');
  t.check(a.world.lineClear(cover.x-cover.r-8,Y,enemy.x,Y),'broken natural cover no longer blocks later sight or shots');
  a.world.artilleryImpact({owner:a.p.id,team:1,vehicle:a.v.id,targetX:cover.x-cover.r-8,targetY:Y});
  t.equal(a.world.events.filter(e=>e.type==='rock-gone'&&e.rock===cover).length,1,'later explosions cannot break the same natural rock twice');
  const portable=a.world.addStruct({kind:'rock',item:'rock',x:X+2500,y:Y,r:116,owner:enemy.id,team:2});
  a.world.artilleryImpact({owner:a.p.id,team:1,vehicle:a.v.id,targetX:portable.x,targetY:portable.y});
  t.check(portable.alive&&portable.hp===1000,'shell rock-breaking preserves the existing protection of player-placed rocks');
}
{
  function setup(remote=false,ratio=1){
    const rock={x:X+W.ARTILLERY.radius+50+2,y:Y,r:50},a=arena('soldier',{rocks:[rock]});
    a.world.remote=remote;a.world.events=[];a.v.angle=0;a.v.vx=W.ARTILLERY.maxSpeed*ratio;a.v.vy=0;
    return {...a,rock};
  }
  const a=setup();a.world.driveVehicle(a.v,{mx:1,my:0},1/120);
  t.check(!a.rock.alive,'full-speed artillery ram breaks a normal rock');
  t.equal(a.v.hp,W.ARTILLERY.hp-50,'normal rock impact costs artillery 50 HP');
  t.near(Math.hypot(a.v.vx,a.v.vy),W.TANK.maxSpeed/2,.001,'normal rock impact halves artillery speed');
  const slow=setup(false,.5);slow.world.driveVehicle(slow.v,{mx:1,my:0},1/120);
  t.check(slow.rock.alive&&slow.v.hp===W.ARTILLERY.hp,'slow artillery cannot break rocks or pay the full-speed hull cost');
  const remote=setup(true);remote.world.driveVehicle(remote.v,{mx:1,my:0},1/120);
  t.near(remote.v.x,a.v.x,1e-8,'artillery rock-ram prediction matches the authoritative pose');
  t.near(remote.v.vx,a.v.vx,1e-8,'artillery rock-ram prediction matches the authoritative speed');
  t.check(remote.rock.alive&&remote.v.hp===W.ARTILLERY.hp&&!remote.world.events.length,'prediction never authors rock destruction or hull damage');
  const placed=arena();placed.v.angle=0;placed.v.vx=W.TANK.maxSpeed;placed.v.vy=0;
  const boulder=placed.world.addStruct({kind:'rock',item:'rock',x:X+placed.v.r+116+2,y:Y,r:116,owner:placed.p.id,team:1});
  placed.world.driveVehicle(placed.v,{mx:1,my:0},1/120);
  t.check(boulder.alive&&boulder.hp===900,'artillery chips a player rock with the existing 100-damage tracked ram');
  t.equal(placed.v.hp,W.ARTILLERY.hp-75,'a player-rock impact costs artillery 75 HP');
  t.equal(Math.hypot(placed.v.vx,placed.v.vy),0,'a player rock stops artillery completely');
}
for (const fixed of [false,true]) {
  const tag=fixed?'ground cannon':'SP artillery';
  const extra={artillery:[{id:1,type:'artillery',fixed,x:X,y:Y}]};
  const a=arena('armorcrew',extra);a.intent.slot=1;tick(a,9.95);
  t.check(!a.world.artilleryReady(a.v),tag+': Armor Crew still needs the initial ten-second setup');
  tick(a,.05);
  for (const at of [{x:X+100,y:Y},{x:X+6000,y:Y},{x:W.CONFIG.worldSize,y:W.CONFIG.worldSize}]) {
    a.v.artilleryCooldown=0;
    t.check(a.world.fireArtillery(a.p,a.v,at.x,at.y),tag+': Armor Crew can fire at the selected range');
    const normalTime=Math.max(2,Math.min(4,2+Math.hypot(at.x-X,at.y-Y)/W.CONFIG.worldSize*2));
    t.near(a.world.artilleryShells.at(-1).flightTime,normalTime/1.25,1e-10,tag+': 25% faster shell travel, including minimum/maximum flight time');
    t.equal(a.v.artilleryCooldown,7.5,tag+': each Armor Crew launch starts a 7.5-second interval');
  }
  // Keep only the distant shell while testing reload and an operator change.
  a.world.artilleryShells=a.world.artilleryShells.slice(-1);
  const shell=a.world.artilleryShells[0],flight=shell.flightTime;
  a.world.exitVehicle(a.p,true);a.world.setClass(a.p,'soldier',true);
  a.p.x=X-a.v.r-35;a.p.y=Y;
  t.check(a.world.enterVehicle(a.p,a.v,'driver'),tag+': a different class can take over the cannon');
  t.equal(shell.flightTime,flight,tag+': leaving/changing class cannot retime a launched shell');
  t.equal(a.v.artilleryCooldown,7.5,tag+': reboarding cannot reset or skip the running reload');
  tick(a,7.45);
  t.check(!a.world.fireArtillery(a.p,a.v,X+6000,Y),tag+': next shell is blocked before 7.5 seconds');
  tick(a,.05);
  t.check(a.world.fireArtillery(a.p,a.v,X+6000,Y),tag+': next shell is allowed at exactly 7.5 seconds');
  t.equal(a.v.artilleryCooldown,10,tag+': ordinary operator uses the normal firing interval on the next shot');
  t.near(a.world.artilleryShells.at(-1).flightTime,2.5,1e-10,tag+': ordinary operator has normal shell travel speed');
  t.near(a.world.vehicleMaxSpeed(a.v),fixed?0:W.ARTILLERY.maxSpeed,1e-8,tag+': ordinary driver cannot inherit the speed bonus');
}
for (const fixed of [false,true]) {
  const extra={artillery:[{id:1,type:'artillery',fixed,x:X,y:Y,angle:0}]};
  const a=arena('armorcrew',extra),prediction=arena('armorcrew',extra);prediction.world.remote=true;
  a.p.vehicleWeapon=prediction.p.vehicleWeapon=0;
  a.world.driveVehicle(a.v,{mx:1,my:0},2);prediction.world.driveVehicle(prediction.v,{mx:1,my:0},2);
  t.near(prediction.v.x,a.v.x,1e-8,'Armor Crew movement prediction matches '+(fixed?'fixed':'mobile')+' artillery authority');
  t.near(prediction.v.vx,a.v.vx,1e-8,'Armor Crew predicted artillery velocity matches authority');
  t.near(a.world.vehicleMaxSpeed(a.v),fixed?0:W.ARTILLERY.maxSpeed*1.1,1e-8,'Armor Crew driving bonus applies only to mobile artillery');
  if(fixed)t.check(a.v.x===X&&a.v.y===Y&&a.v.vx===0,'ground cannon remains anchored with Armor Crew aboard');
  else t.near(a.v.vx,W.ARTILLERY.maxSpeed*1.1,.1,'SP artillery actually accelerates to the boosted top speed');
}
t.done();
