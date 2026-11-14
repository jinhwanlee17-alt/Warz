// Exercise the shared map art at the small sizes used by every map surface.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config','util','map','world','items','map-art']);
const t = suite('Map miniature details');
function drawing() {
  const ops=[], stack=[];
  const g={fillStyle:'#000',strokeStyle:'#000',globalAlpha:.4,lineWidth:1,path:[],
    save(){stack.push({fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,globalAlpha:this.globalAlpha,lineWidth:this.lineWidth});ops.push({op:'save'});},
    restore(){Object.assign(this,stack.pop());ops.push({op:'restore'});},
    beginPath(){this.path=[];},closePath(){this.path.push(['Z']);},
    moveTo(...a){this.path.push(['M',...a]);},lineTo(...a){this.path.push(['L',...a]);},
    arc(...a){this.path.push(['arc',...a]);},arcTo(...a){this.path.push(['arcTo',...a]);},rect(...a){this.path.push(['rect',...a]);},
    translate(...a){ops.push({op:'translate',a});},rotate(...a){ops.push({op:'rotate',a});},scale(...a){ops.push({op:'scale',a});},
    fill(){ops.push({op:'fill',color:this.fillStyle,path:this.path.map(a=>a.slice())});},
    stroke(){ops.push({op:'stroke',color:this.strokeStyle,path:this.path.map(a=>a.slice())});},
    fillRect(...a){ops.push({op:'fillRect',color:this.fillStyle,a});},strokeRect(...a){ops.push({op:'strokeRect',color:this.strokeStyle,a});},
    setLineDash(){},strokeText(){},fillText(){},clip(){},
    measureText(s){return {width:String(s).length*7};}
  };
  return {g,ops,stack};
}
function glyph(type,size=7.5,extra={}) {
  const d=drawing();
  W.MapArt.vehicleGlyph(d.g,{type,angle:.45,cannonAngle:1.25,gunAngle:.75,...extra},100,200,size,false);
  return d;
}
for(const size of [2.5,6,7.5,15]) {
  const h=glyph('humvee',size), tank=glyph('tank',size), arty=glyph('artillery',size);
  t.equal(h.ops.filter(o=>o.op==='fillRect'&&o.color==='#29372f').length,4,'Humvee has four separate wheels at size '+size);
  t.check(h.ops.some(o=>o.op==='fill'&&o.color==='#5b8f8e'),'Humvee has windshield glass at size '+size);
  t.equal(h.ops.filter(o=>o.op==='fill'&&o.path.some(p=>p[0]==='arc')).length,2,'Humvee rear spare has a tyre and hub at size '+size);
  for(const [name,d] of [['tank',tank],['artillery',arty]]) {
    t.equal(d.ops.filter(o=>o.op==='fillRect'&&o.color==='#293b31').length,2,name+' has separate track belts at size '+size);
    t.equal(d.ops.filter(o=>o.op==='stroke'&&o.color==='#68785a').length,6,name+' track treads remain detailed at size '+size);
    t.check(d.ops.some(o=>o.op==='fill'&&o.color==='#455b3a'),name+' has a turret hatch at size '+size);
    t.check(d.ops.some(o=>o.op==='rotate'&&Math.abs(o.a[0]-.8)<1e-9),name+' cannon turns independently of its hull');
  }
  const ventCount=d=>d.ops.filter(o=>o.op==='stroke'&&o.color==='#52613d').length;
  t.check(ventCount(arty)>ventCount(tank),'artillery rear deck has its own longer grille');
  const cannonReach=d=>Math.max(...d.ops.filter(o=>o.op==='fill'&&['#d2c590','#b6bd8b'].includes(o.color)).flatMap(o=>o.path.filter(p=>p[0]==='L').map(p=>p[1])));
  t.check(cannonReach(arty)>cannonReach(tank),'artillery barrel is visibly longer than the tank cannon');
  for(const d of [h,tank,arty]) {
    t.equal(d.stack.length,0,'map glyph restores the drawing stack');
    t.equal(d.g.globalAlpha,.4,'map glyph does not change caller transparency');
    t.check(d.ops.every(o=>(o.a||[]).every(Number.isFinite)&&(!o.path||o.path.every(p=>p.slice(1).every(Number.isFinite)))),'miniature drawing has finite dimensions');
  }
}
const bare=glyph('humvee'), armed=glyph('humvee',7.5,{armed:true});
t.check(armed.ops.length>bare.ops.length&&armed.ops.some(o=>o.op==='stroke'&&o.path.some(p=>p[0]==='L'&&p[1]===7.5*1.3)),'armed Humvee carries its own mounted gun');

const map={seed:1,size:W.CONFIG.worldSize,coast:[0,0,24000,0,24000,24000,0,24000],trees:[{x:2000,y:2000,r:100,variant:3}],
  bushes:[{x:2100,y:2200,r:50,variant:4}],tufts:[{x:2300,y:2400,s:1}],ponds:[],buildings:[],drops:[],towns:[],rocks:[],crates:[],pickups:[],stations:[],nextPickupId:1,
  vehicles:[{id:1,type:'humvee',x:4000,y:4000},{id:2,type:'tank',x:5000,y:5000},{id:3,type:'artillery',x:6000,y:6000}]};
const before=JSON.stringify(map), foliage=drawing();
W.MapArt.paintBase(foliage.g,map,900,{big:true,dpr:1});
t.check(foliage.ops.some(o=>o.op==='fill'&&o.color==='#327a32'&&o.path.filter(p=>p[0]==='arc').length===5),'map trees have lobed canopies rather than one circle');
t.equal(foliage.ops.filter(o=>o.op==='fill'&&o.color==='#367e38').length,2,'actual bushes and sampled ground tufts both add shrub details');
t.equal(JSON.stringify(map),before,'cartography details do not create terrain or change the map');
const generated=W.MapGen.generate(57), decor=drawing();
W.MapArt.paintBase(decor.g,generated,900,{big:true});
t.check(W.CONFIG.bushes&&generated.bushes.length>0&&decor.ops.some(o=>o.op==='fill'&&o.color==='#367e38'),'biome maps render actual gameplay bush cover alongside ground decoration');
const clipped=drawing();
W.MapArt.paintBase(clipped.g,map,900,{big:true,view:{x0:10000,y0:10000,x1:11000,y1:11000}});
t.check(!clipped.ops.some(o=>o.op==='fill'&&['#327a32','#367e38'].includes(o.color)),'zoomed viewport skips offscreen foliage details');

const world=new W.World({map,teams:true,storm:false}), viewer=world.addPlayer({x:3000,y:3000,team:1}), enemy=world.addPlayer({x:5000,y:5000,team:2});
const tank=world.vehicles.find(v=>v.type==='tank');tank.seats.driver=enemy.id;enemy.vehicle=tank.id;
const normal=drawing();W.MapArt.overlay(normal.g,world,viewer,900,{big:true});
t.equal(normal.ops.filter(o=>o.op==='fillRect'&&o.color==='#293b31').length,2,'ordinary map hides the occupied enemy tank but draws the empty artillery tracks');
const targetMap=drawing();W.MapArt.overlay(targetMap.g,world,viewer,900,{big:true,allVehicles:true,tinyPlayers:true});
t.equal(targetMap.ops.filter(o=>o.op==='fillRect'&&o.color==='#293b31').length,4,'artillery targeting draws both miniature tracked vehicles');
t.equal(targetMap.ops.filter(o=>o.op==='fillRect'&&o.color==='#29372f').length,4,'artillery targeting uses the same detailed Humvee painter');
t.equal(targetMap.stack.length,0,'full targeting layer restores the context');
const mini=drawing();W.MapArt.overlay(mini.g,world,viewer,190,{dpr:1});
t.check(mini.ops.some(o=>o.op==='fill'&&o.color==='#5b8f8e'),'minimap also retains miniature windshield detail');
t.done();
