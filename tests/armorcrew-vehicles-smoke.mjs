import {loadWarz,suite} from './harness.mjs';
const W=loadWarz(),t=suite('Armor Crew vehicles'),DT=.05,X=8000,Y=8000;
function arena(type='tank',teamSize=1,armed=true) {
  const map={seed:5,size:W.CONFIG.worldSize,teamSize,rocks:[],trees:[],bushes:[],buildings:[],crates:[],pickups:[],ponds:[],stations:[],drops:[],towns:[],nextPickupId:1,
    vehicles:[{id:1,type,x:X,y:Y,angle:0}],tanks:[]};
  const w=new W.World({map,teams:teamSize>1,storm:false}),v=w.vehicles[0];
  if(type==='humvee')v.armed=armed&&teamSize>1;
  return{w,v};
}
function rider(a,classId='soldier',angle=0,team=1){const p=a.w.addPlayer({classId,team,x:a.v.x+Math.cos(angle)*(a.v.r+24+25),y:a.v.y+Math.sin(angle)*(a.v.r+24+25)});return p;}
function board(a,classId='armorcrew',angle=0){const p=rider(a,classId,angle);if(!a.w.pressInteract(p))throw Error('Board fixture failed');return p;}
function ticks(a,n){for(let i=0;i<n;i++){a.w.time+=DT;a.w.updateVehicles(DT);}}
function enemy(a,x=X+600,y=Y){const p=a.w.addPlayer({x,y,team:2});p.hp=p.maxHp=2000;return p;}
for(const type of ['humvee','tank'])for(let i=0;i<8;i++){
  const a=arena(type),p=rider(a,'soldier',i*Math.PI/4);
  t.check(a.w.pressInteract(p)&&p.vehicleSeat==='driver',type+': E boards from angle '+i*45);
}
for(const size of [1,2,3,4])for(const type of ['humvee','tank'])for(const armed of type==='humvee'?[false,true]:[true]){
  const a=arena(type,size,armed),expected=(type==='tank'?['driver','rearLeft','gunner','rearRight']:armed&&size>1?['driver','gunner','rearLeft','rearRight']:['driver','rearLeft','rearRight']).slice(0,size);
  const crew=expected.map((seat,i)=>{const p=board(a,'soldier',i*1.5);t.equal(p.vehicleSeat,seat,type+size+': arrival '+(i+1)+' takes '+seat);return p;});
  t.check(!a.w.nearestVehicleSeat(rider(a)),type+size+': seats respect mode capacity');
  t.check(!a.w.nearestVehicleSeat(rider(a,'soldier',0,2)),type+size+': enemies cannot board friendly crew');
  if(type==='tank'&&size===2){const op=crew[1];a.w.updateVehiclePlayer(op,{slot:1});t.equal(a.w.vehicleWeaponFor(op),'mg','Duo second rider selects MG');a.w.updateVehiclePlayer(op,{slot:0});t.equal(a.w.vehicleWeaponFor(op),'cannon','Duo second rider selects cannon');for(const slot of[0,1]){crew[0].vehicleWeapon=slot;t.equal(a.w.vehicleWeaponFor(crew[0]),null,'Duo driver cannot override second rider weapons');}}
  if(type==='tank'&&size>=3){t.equal(a.w.vehicleWeaponFor(crew[1]),'cannon','third-mode second rider controls cannon');t.equal(a.w.vehicleWeaponFor(crew[2]),'mg','third rider controls MG');if(size===4)t.equal(a.w.vehicleWeaponFor(crew[3]),null,'fourth tank rider is passenger');}
}
{
  const a=arena();a.w.map.buildings=[{walls:[{x:X+110,y:Y-160,w:15,h:320}]}];a.w.solids=new W.U.SpatialHash(256);a.w.buildSolids();
  t.check(!a.w.pressInteract(rider(a)),'all-side entry cannot pass through a wall');
}
for(const type of ['humvee','tank']){
  const a=arena(type),p=board(a);p.vehicleIntent={mx:1,my:0};ticks(a,80);
  t.near(Math.hypot(a.v.vx,a.v.vy),W.vehicleDef(a.v).maxSpeed*(type==='humvee'?1.15:1),.001,type+': Armor Crew gets only specified speed boost');
  t.equal(p.stamina,100,'riding does not consume stamina');
}
{
  const a=arena(),p=board(a);ticks(a,1);
  t.check(a.v.cannonAmmo===2&&a.v.cannonMaxAmmo===2,'Armor Crew loads a two-round cannon');
  p.vehicleIntent={fire:true};ticks(a,1);t.equal(a.v.cannonAmmo,1,'first shot leaves one round');
  ticks(a,6);t.equal(p.stats.shots,1,'second shot respects the faster firing interval');
  ticks(a,1);t.equal(p.stats.shots,2,'second shot fires after its short interval');
  t.check(a.v.cannonAmmo===0&&a.v.cannonReload===3,'empty two-round magazine starts exactly3-second reload');
  p.vehicleIntent={};ticks(a,59);t.equal(a.v.cannonAmmo,0,'cannot refill before3 seconds');ticks(a,1);t.equal(a.v.cannonAmmo,2,'reload restores both rounds from infinite reserve');
  p.vehicleIntent={fire:true};ticks(a,1);ticks(a,7);const reload=a.v.cannonReload;
  a.w.exitVehicle(p,true);a.w.enterVehicle(p,a.v,'driver');ticks(a,1);
  t.check(a.v.cannonAmmo===0&&a.v.cannonReload<reload&&a.v.cannonReload>0,'exiting and reboarding cannot bypass cannon reload');
}
{
  function machine(classId){const a=arena(),p=board(a,classId);p.vehicleWeapon=1;p.vehicleIntent={fire:true};ticks(a,200);return{...a,p};}
  const base=machine('soldier'),crew=machine('armorcrew');
  t.near(crew.p.stats.shots/base.p.stats.shots,1.15,.015,'tank MG fires15% faster across20Hz ticks');
  t.check(crew.w.bullets.every(b=>Math.abs(b.damage-8.4)<1e-9),'Armor Crew tankMG stamps8.4 damage');
  t.check(base.w.bullets.every(b=>b.damage===8),'ordinary tankMG remains8 damage');
  const target=enemy(crew);crew.w.damagePlayer(target,8.4,crew.p.id,'tankmg');t.near(target.hp,1991.6,.001,'vehicle bonus is not applied twice');
}
{
  const a=arena('humvee',2),driver=board(a,'soldier'),gunner=board(a,'armorcrew');
  gunner.vehicleIntent={fire:true};ticks(a,1);
  t.near(a.w.bullets[0].damage,15*1.05,1e-9,'Humvee MG receives5% weapon damage bonus');
  t.near(a.w.vehicleMaxSpeed(a.v),W.VEHICLE.maxSpeed,1e-9,'gunner class does not boost another driver speed');
}
{
  const a=arena(),p=board(a),target=enemy(a);a.w.fireTankCannon(p,a.v);
  const shell=a.w.tankShells[0];t.equal(shell.damageMul,1.05,'cannon captures operator damage bonus at fire time');
  a.w.exitVehicle(p,true);ticks(a,8);
  t.equal(target.hp,1475,'direct hit keeps525 damage after operator exits');
}
{
  const a=arena(),p=board(a),target=enemy(a,X+W.TANK.radius+W.CONFIG.playerRadius+2);
  a.v.vx=W.TANK.maxSpeed;p.vehicleIntent={mx:1,my:0};ticks(a,1);
  t.near(target.hp,1935,.1,'vehicle weapon bonus does not increase ram damage');
}
t.done();
