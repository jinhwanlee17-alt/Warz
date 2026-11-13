import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config','util','map','world','items','render','map-art']);
const t = suite('Ground artillery'), S = W.CONFIG.worldSize, X = 5000, Y = 5000;
const rings = [
  { left:.175, top:.095, right:.825, bottom:.825, corner:.085 },
  { left:.305, top:.23, right:.745, bottom:.715, corner:.055 },
  { left:.38, top:.30, right:.665, bottom:.60, corner:.065 }
];
function distance(v, r) {
  const qx = Math.abs(v.x/S-(r.left+r.right)/2)-(r.right-r.left)/2+r.corner;
  const qy = Math.abs(v.y/S-(r.top+r.bottom)/2)-(r.bottom-r.top)/2+r.corner;
  return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r.corner;
}
for (const mode of [1,2,3,4]) for (const seed of [1,57,0xffffffff]) {
  const map = W.MapGen.generate(seed,mode), repeated = W.MapGen.generate(seed,mode);
  const world = new W.World({map,teams:mode>1,storm:false});
  const tag = mode+' players per team, seed '+seed;
  t.equal(map.groundArtillery.length,6,tag+': six fixed cannons');
  t.equal(world.vehicles.filter(v=>v.type==='artillery'&&!v.fixed).length,4,tag+': four mobile SP artillery remain');
  t.equal(world.vehicles.filter(v=>v.fixed).length,6,tag+': fixed flags survive initialization');
  t.equal(JSON.stringify(map.groundArtillery),JSON.stringify(repeated.groundArtillery),tag+': deterministic cannon positions');
  t.equal(new Set(world.vehicles.map(v=>v.id)).size,22,tag+': all hull IDs are unique');
  for (const [i,r] of rings.entries()) {
    const pair = map.groundArtillery.filter(v=>v.ring===i);
    t.equal(pair.length,2,tag+': two cannons on ring '+i);
    t.check(pair.every(v=>v.fixed&&v.type==='artillery'&&Math.abs(distance(v,r))<1e-9),tag+': cannons follow drawn ring '+i);
    t.near(pair[0].x+pair[1].x,(r.left+r.right)*S,1e-7,tag+': opposite horizontal spacing on ring '+i);
    t.near(pair[0].y+pair[1].y,(r.top+r.bottom)*S,1e-7,tag+': opposite vertical spacing on ring '+i);
  }
  for (const v of world.vehicles.filter(v=>v.fixed)) {
    t.check(world.vehicles.every(o=>o===v||Math.hypot(o.x-v.x,o.y-v.y)>o.r+v.r+80),tag+': reserved parking never overlaps another hull');
    const at = world.vehicleSeatPoint(v,'driver',true);
    t.check(world.spotFree(at.x,at.y,W.CONFIG.playerRadius,true)&&!world.inPond(at.x,at.y),tag+': cannon has a dry unobstructed approach');
  }
}
function arena(extra={}) {
  const map=Object.assign({seed:1,size:S,teamSize:4,rocks:[],trees:[],buildings:[],crates:[],pickups:[],ponds:[],stations:[],towns:[],drops:[],
    groundArtillery:[{id:17,type:'artillery',fixed:true,x:X,y:Y,angle:.3}],nextPickupId:1},extra);
  const world=new W.World({map,teams:true,storm:false}),v=world.vehicles[0];
  const p=world.addPlayer({x:X-v.r-30,y:Y,team:1,classId:'grenadier2'});
  t.check(world.enterVehicle(p,v,'driver'),'can board the ground cannon');
  const intent={mx:0,my:0,aimX:X+4000,aimY:Y}; p.controller=()=>intent;
  return {world,v,p,intent};
}
function tick(a,n) { for(let i=0;i<Math.round(n/.05);i++) a.world.update(.05); }
{
  const rock={x:X+170,y:Y,r:50},crate={id:0,x:X+170,y:Y+180,tier:'common',hp:100,alive:true};
  const a=arena({rocks:[rock],crates:[crate]}),{world,v,p,intent}=a;
  t.equal(v.hp,1200,'fixed cannon shares the reduced SP artillery hull health');
  t.equal(world.vehicleMaxSpeed(v),0,'fixed cannon has zero maximum travel speed');
  t.equal(world.vehicleSeatOrder(v).join(),'driver','only one operator can board');
  t.equal(world.vehicleSeatRole(v,'driver'),'Artillery operator','operator is described without a driving role');
  t.equal(p.vehicleWeapon,1,'boarding selects targeting immediately');
  intent.mx=1; intent.my=1; intent.slot=0; v.vx=2000; v.vy=-2000;
  tick(a,2);
  t.check(v.x===X&&v.y===Y&&v.angle===.3&&v.vx===0&&v.vy===0,'drive-mode keys and stale velocity cannot move or turn the emplacement');
  t.check(rock.alive&&crate.alive&&v.hp===1200,'a fixed cannon cannot ram rocks or crush crates');
  world.remote=true;v.vx=1000;v.vy=1000;world.driveVehicle(v,{mx:-1,my:0},1);
  t.check(v.x===X&&v.y===Y&&v.angle===.3&&v.vx===0&&v.vy===0,'remote prediction also leaves the cannon anchored');
  world.remote=false;intent.slot=1;intent.mx=0;intent.my=0;
  t.check(!world.fireArtillery(p,v,X+4000,Y),'fixed cannon still observes initial setup');
  tick(a,8);
  t.check(world.artilleryReady(v),'stationary ground cannon completes setup');
  const ammo=p.weapons.map(w=>w.ammo).join();intent.fire=true;intent.firePressed=true;tick(a,.2);
  t.equal(world.artilleryShells.length,0,'ordinary mouse fire never fires a shell or personal weapon');
  t.equal(p.weapons.map(w=>w.ammo).join(),ammo,'personal weapons stay stowed at a fixed cannon');
  t.check(world.fireArtillery(p,v,X+4000,Y),'ready ground cannon accepts an island-wide target');
  t.equal(v.artilleryCooldown,10,'fixed cannon uses the same firing interval');
  t.check(!world.fireArtillery(p,v,X+4000,Y),'cannot bypass shell cooldown');
  tick(a,4);
  t.equal(world.artilleryShells.length,0,'ground artillery shell finishes indirect flight');
}
{
  const a=arena(),{world,v,p}=a,R=W.ARTILLERY.blastRadius;
  const enemy=world.addPlayer({x:X+3000,y:Y,team:2}),edge=world.addPlayer({x:X+3000+R,y:Y,team:2});
  enemy.hp=enemy.maxHp=edge.hp=edge.maxHp=10000;edge.r=0;
  const ally=world.addPlayer({x:X+3000,y:Y,team:1});
  world.artilleryImpact({owner:p.id,team:1,vehicle:v.id,targetX:enemy.x,targetY:enemy.y});
  t.equal(10000-enemy.hp,1050,'direct ground artillery blast deals full SP artillery damage');
  t.equal(10000-edge.hp,75,'ground artillery blast edge deals minimum damage');
  t.equal(ally.hp,ally.maxHp,'normal teammate protection remains');
  const rock={id:0,x:X+6000,y:Y,r:60,alive:true};world.map.rocks=[rock];world.buildSolids();
  world.artilleryImpact({owner:p.id,team:1,vehicle:v.id,targetX:rock.x,targetY:rock.y});
  t.check(!rock.alive&&!('hp' in rock),'ground artillery shells also break natural rocks without adding health');
  world.damagePlayer(p,100,enemy.id,'pistol');
  t.equal(p.hp,p.maxHp,'fixed cannon shields its operator like SP artillery');
  t.equal(v.hp,1100,'incoming damage goes to the fixed cannon hull');
  world.damageVehicle(v,v.hp+1,enemy.id,'artillery');
  t.check(v.wreck&&!p.vehicle&&p.alive,'destroying the cannon releases a living operator');
  t.check(!world.enterVehicle(p,v,'driver'),'a destroyed cannon cannot be operated');
  const x=v.x,y=v.y;world.driveVehicle(v,{mx:1,my:1},1);
  t.check(v.x===x&&v.y===y&&!world.spotFree(x,y,24,true),'destroyed cannon remains solid and immovable');
}
{
  const renderer=Object.create(W.Renderer.prototype),a=arena(),ops=[],stack=[];
  const ctx=new Proxy({save(){stack.push(1);},restore(){stack.pop();},measureText(s){return {width:s.length*7};}},
    {get(o,k){if(k in o)return o[k];return (...args)=>{if(args.some(n=>typeof n==='number'&&!Number.isFinite(n)))throw Error('Nonfinite '+k);ops.push({k,args,color:o.fillStyle});};}});
  for(const wreck of [false,true]) {
    a.v.wreck=wreck;a.v.hp=wreck?0:1200;ops.length=0;const before=JSON.stringify(a.v);
    renderer.drawVehicle(ctx,a.world,a.v,0,a.p);
    t.equal(JSON.stringify(a.v),before,'ground cannon drawing preserves simulation state');
    t.equal(stack.length,0,'ground cannon drawing restores canvas state');
    t.check(ops.some(o=>o.k==='fillText'&&o.args[0]===(wreck?'ARTILLERY WRECK':'Artillery Cannon')),'ground cannon label reflects hull state');
  }
  ops.length=0;W.MapArt.vehicleGlyph(ctx,a.v,10,20,7.5,false);
  t.check(!ops.some(o=>o.k==='fillRect'&&o.color==='#293b31'),'miniature fixed cannon has no tracks');
  t.equal(ops.filter(o=>o.k==='fillRect'&&o.color==='#3e4c36').length,4,'miniature fixed cannon shows its four anchoring feet');
  t.equal(stack.length,0,'miniature cannon restores canvas state');
}
t.done();
