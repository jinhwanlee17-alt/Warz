import fs from 'node:fs';
import vm from 'node:vm';
import {loadWarz,suite} from './harness.mjs';
import {Warz as ServerW} from '../server/core/sim.mjs';
import {Match} from '../server/core/match.mjs';
const t=suite('Ground artillery online'),W=loadWarz(['config','util','map','world','items','controls']);
let state,last,clock=0,active;
const sent=[];W.MatchNet={send:m=>sent.push(m)};
const sandbox={Warz:W,performance:{now:()=>clock*1000}};sandbox.window=sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js',import.meta.url),'utf8'),sandbox);
const O=W.Online;
const match=new Match({W:ServerW,id:'ground-arty-test',mode:'duos',teamSize:2,seed:57,clock:false,emptyTimeout:Infinity,
  teams:[{members:[{name:'Operator'},{name:'Teammate'}]},{members:[{name:'Target'}]}]});
const world=match.world,[p,ally,enemy]=match.players,v=world.vehicles.find(v=>v.fixed);
function clear(w){for(const key of ['rocks','trees','buildings','crates','pickups','ponds','stations'])w.map[key]=[];w.solids=new W.U.SpatialHash(256);w.storm=null;}
function connect(rejoin=false){
  const conn={player:p,open:true,bufferedAmount:0,close(){},sendJson(m){if(active!==this)return;if(m.t==='match-start'){
    state=O.start(m);clear(state.world);state.world.map.rocks=world.map.rocks.map(r=>({...r,alive:true}));state.world.buildSolids();
  }if(m.t==='sync')O.applySync(m);},sendText(s){if(active!==this)return;const m=JSON.parse(s);if(m.t==='snap'){last=m;clock+=.05;O.applySnapshot(m);}}};
  active=conn;match.attach(p,conn,rejoin);match.sendSnapshots([]);return state.world.vehicleById(v.id);
}
const input=(s,over={})=>({t:'in',s,mx:0,my:0,a:0,d:400,...over});
try {
  clear(world);world.vehicles.forEach((o,i)=>{o.x=2000+i*300;o.y=2000;});
  v.x=v.y=5000;v.angle=.3;v.stationaryT=0;
  for(const it of match.players){it.dropT=0;it.net.conn={open:true,sendText(){},sendJson(){},close(){}};}
  p.x=v.x-v.r-30;p.y=v.y;ally.x=p.x;ally.y=p.y+10;enemy.x=11000;enemy.y=5000;enemy.hp=enemy.maxHp=10000;
  let replica=connect();
  t.equal(last.vehicles.length,22,'all mobile hulls and six fixed cannons reach snapshots');
  t.equal(last.vehicles.filter(v=>v.fixed).length,6,'snapshots identify exactly six fixed cannons');
  t.check(replica.fixed&&replica.type==='artillery','client keeps fixed identity and artillery weapon family');
  t.equal(state.world.vehicleMaxSpeed(replica),0,'replica uses immovable cannon definition');
  t.check(world.enterVehicle(p,v,'driver'),'authority allows ground cannon boarding');match.sendSnapshots([]);
  t.check(state.me.vehicle===v.id&&state.me.vehicleWeapon===1,'boarding restores the operator directly into targeting mode');
  t.check(last.p.some(row=>row[0]===enemy.id),'targeting mode streams distant tiny player markers');
  t.check(!world.nearestVehicleSeat(ally),'occupied cannon has no second seat');
  match.handleInput(p,input(1,{sl:0,mx:1,my:1}));
  for(let i=0;i<20;i++)match.tick();
  t.check(v.x===5000&&v.y===5000&&v.angle===.3&&v.vx===0&&v.vy===0,'drive-mode movement cannot displace the authoritative fixed cannon');
  t.check(replica.x===5000&&replica.y===5000&&replica.vx===0&&replica.vy===0,'replica remains at authoritative anchor');
  const controls={down:()=>false,hit:()=>false,lift:()=>false,wheel:0,mouse:{x:10,y:10}};
  const moving={...controls,down:code=>code==='KeyD'};
  O.step(moving,{screenToWorld:()=>({x:5500,y:5000})},false,false);
  t.check(replica.x===5000&&replica.y===5000&&replica.vx===0&&replica.vy===0,'local driving input prediction cannot move the cannon');
  replica.vx=900;replica.vy=-900;state.world.driveVehicle(replica,{mx:1,my:1},.5);
  t.check(replica.vx===0&&replica.vy===0&&replica.x===5000&&replica.y===5000,'even stale network velocity is discarded by prediction');
  match.handleInput(p,input(2,{sl:1,af:true,ax:11000,ay:5000}));match.tick();
  t.equal(world.artilleryShells.length,0,'authority enforces ground artillery setup time');
  v.stationaryT=10;match.sendSnapshots([]);
  match.handleInput(p,input(3,{sl:1,af:true,ax:11000,ay:5000}));match.tick();
  t.equal(world.artilleryShells.length,1,'Enter fires one authoritative ground artillery shell');
  t.equal(state.world.artilleryShells.length,1,'ground artillery launch replicates to operator');
  t.check(replica.artilleryCooldown>9,'ground cannon reload remains authoritative');
  replica=connect(true);
  t.check(replica.fixed&&state.me.vehicleWeapon===1&&replica.artilleryCooldown>9,'rejoin preserves fixed identity, targeting mode and cooldown');
  t.equal(state.world.artilleryShells.length,1,'rejoin restores in-flight ground artillery shell');
  for(let i=0;i<90&&world.artilleryShells.length;i++)match.tick();
  t.equal(10000-enemy.hp,1050,'remote target receives full cannon blast damage');
  t.equal(state.world.artilleryShells.length,0,'remote impact removes the cosmetic shell');
  t.check(v.x===5000&&v.y===5000,'firing creates no hull movement');
  world.map.rocks=[{id:0,x:8000,y:7000,r:50,alive:true}];world.buildSolids();
  v.stationaryT=10;v.artilleryCooldown=0;replica=connect(true);
  match.handleInput(p,input(4,{sl:1,af:true,ax:8000,ay:7000}));match.tick();
  for(let i=0;i<90&&world.artilleryShells.length;i++)match.tick();
  t.check(!world.map.rocks[0].alive&&!state.world.map.rocks[0].alive,'ground artillery rock breaking reaches server and client');
  replica=connect(true);
  t.check(replica.fixed&&!state.world.map.rocks[0].alive,'rejoin preserves fixed cannon and broken natural cover');
  world.damageVehicle(v,v.hp+1,enemy.id,'artillery');match.sendSnapshots(world.events.splice(0));
  t.check(replica.fixed&&replica.wreck&&!state.me.vehicle,'destroyed fixed cannon ejects its operator on both sides');
  replica=connect(true);
  t.check(replica.fixed&&replica.wreck&&!state.me.vehicle,'rejoin cannot revive or board the destroyed cannon');
} finally { match.destroy(); }
t.done();
