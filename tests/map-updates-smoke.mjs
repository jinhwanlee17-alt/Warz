// Expanded-map invariants and the actual shared minimap/full-map marker drawing.
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'map-art']);
const t = suite('map updates');
const C = W.CONFIG;
t.equal(C.worldSize, 19200, 'island is three times the original width and height');
t.near(C.worldSize * C.worldSize / (6400 * 6400), 9, 1e-10, 'tripling both dimensions makes nine times the original area');
t.equal(C.stationCount, 9, 'nine upgrade stations are 75 percent fewer than before');
t.equal(C.regularCrateCount, 90, 'ninety regular crates plus the central legendary');
t.equal(W.CRATE_ORDER.map(id => W.CRATES[id].share).join(), '0.8,0.1,0.08,0.02,0', 'regular crate shares exclude the fixed legendary');
for (const total of [0, 1, 2, 10, 91, 101, 1000]) {
  const q = W.Rules.crateQuota(total), ordinary = Math.max(0, total - 1);
  t.equal(Object.values(q).reduce((sum, n) => sum + n, 0), total, `quota ${total}: no missing or extra crates`);
  t.equal(q.legendary, total > 0 ? 1 : 0, `quota ${total}: at most one legendary`);
  t.check(['common','rare','epic','mythic'].every(id => Math.abs(q[id] - ordinary * W.CRATES[id].share) < 1), `quota ${total}: regular proportions rounded by at most one crate`);
}
const hundred = W.Rules.crateQuota(101);
t.equal(['common','rare','epic','mythic'].map(id => hundred[id]).join(), '80,10,8,2', '100 regular crates split exactly 80/10/8/2');

const seeds = [1, 42, 57, 79, 991, 9001, 31337, 123456, 777777, 0xffffffff];
const started = Date.now();
for (const seed of seeds) {
  const map = W.MapGen.generate(seed), center = map.size / 2;
  const legendary = map.crates.filter(c => c.tier === 'legendary');
  t.equal(map.crates.length, C.regularCrateCount + 1, `seed ${seed}: exactly 91 crates`);
  t.equal(legendary.length, 1, `seed ${seed}: one legendary crate`);
  t.check(legendary[0].x === center && legendary[0].y === center, `seed ${seed}: legendary is at the exact centre`);
  t.equal(map.legendaryCrateId, legendary[0].id, `seed ${seed}: centre crate identifier is stable`);
  t.check(map.crates.every((c, i) => c.id === i && c.hp === W.CRATES[c.tier].hp), `seed ${seed}: crate IDs and health match their tiers`);
  const q = W.Rules.crateQuota(map.crates.length);
  t.check(W.CRATE_ORDER.every(id => map.crates.filter(c => c.tier === id).length === q[id]), `seed ${seed}: regular rarity quota is exact`);
  t.check(map.buildings.every(b => !(center >= b.x - C.legendaryClearRadius && center <= b.x + b.w + C.legendaryClearRadius && center >= b.y - C.legendaryClearRadius && center <= b.y + b.h + C.legendaryClearRadius) || Math.hypot(center - W.U.clamp(center,b.x,b.x+b.w),center - W.U.clamp(center,b.y,b.y+b.h)) >= C.legendaryClearRadius), `seed ${seed}: centre is outside every building`);
  t.check(map.ponds.every(p => Math.hypot(p.x-center,p.y-center) >= p.r + C.legendaryClearRadius), `seed ${seed}: centre approaches are dry`);
  const world = new W.World({ map, storm: false });
  let clear = true;
  for (let i = 0; i < 16; i++) for (const radius of [85, 145, 210]) {
    const angle = i / 16 * Math.PI * 2;
    if (!world.spotFree(center + Math.cos(angle)*radius,center + Math.sin(angle)*radius,C.playerRadius,true)) clear = false;
  }
  t.check(clear, `seed ${seed}: players can approach and circle the centre crate from every side`);
  let separated = true;
  for (let i=0;i<map.crates.length;i++) for(let j=i+1;j<map.crates.length;j++) {
    const a=map.crates[i],b=map.crates[j],gap=(a.size+b.size)/2;
    if(Math.abs(a.x-b.x)<gap && Math.abs(a.y-b.y)<gap) separated=false;
  }
  t.check(separated, `seed ${seed}: crate hitboxes never overlap`);
  t.equal(map.stations.length,C.stationCount,`seed ${seed}: upgrade station count preserved`);
  t.equal(map.drops.length,16,`seed ${seed}: sixteen distributed spawns preserved`);
  for (const list of [map.drops,map.stations,map.crates]) {
    const quadrants=new Set(list.map(o=>(o.x>=center?1:0)+(o.y>=center?2:0)));
    t.equal(quadrants.size,4,`seed ${seed}: key locations cover every map quadrant`);
  }
  t.check(map.trees.length===2700 && map.rocks.length===1260 && map.ponds.length>=36, `seed ${seed}: terrain coverage scales with the expanded area`);
}
t.check(Date.now()-started<5000, 'expanded maps still generate promptly');
t.equal(JSON.stringify(W.MapGen.generate(57)),JSON.stringify(W.MapGen.generate(57)),'same seed rebuilds the full map identically');

// Capture actual arrow paths, transforms and fill alpha from MapArt.overlay.
// This exercises both map modes without relying on their implementation names.
function drawing() {
  const fills=[],stack=[];
  const g={fillStyle:'#000',strokeStyle:'#000',globalAlpha:.2,lineWidth:1,x:0,y:0,angle:0,path:[],
    save(){stack.push({fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,globalAlpha:this.globalAlpha,lineWidth:this.lineWidth,x:this.x,y:this.y,angle:this.angle});},
    restore(){Object.assign(this,stack.pop());},
    beginPath(){this.path=[];},moveTo(x,y){this.path.push(['M',x,y]);},lineTo(x,y){this.path.push(['L',x,y]);},closePath(){this.path.push(['Z']);},
    arc(){this.path.push(['arc']);},rect(){this.path.push(['rect']);},
    translate(x,y){this.x+=x;this.y+=y;},rotate(a){this.angle+=a;},
    fill(){fills.push({path:this.path.map(p=>p.slice()),color:this.fillStyle,alpha:this.globalAlpha,x:this.x,y:this.y,angle:this.angle});},
    stroke(){},fillRect(){},setLineDash(){},strokeText(){},fillText(){}};
  return {g,fills,stack};
}
const map = W.MapGen.generate(123), world = new W.World({map,teams:true,storm:false});
map.stations=[];
const center=map.size/2;
const self=world.addPlayer({x:center,y:center,team:1,angle:.4});
const ally=world.addPlayer({x:map.size-100,y:100,team:1,angle:1.2});
ally.downed=true;ally.hidden=true; // neither offscreen nor a downed state changes team identity.
const foe=world.addPlayer({x:100,y:map.size-100,team:2,angle:-.7});
world.reveal[self.team]=60;
for(const big of [false,true]) {
  const px=big?600:190,dpr=big?2:1;
  const {g,fills,stack}=drawing();
  W.MapArt.overlay(g,world,self,px,{big,dpr});
  const arrows=fills.filter(f=>f.path[0]?.[0]==='M');
  t.equal(arrows.length,3,`${big?'full map':'minimap'}: self, offscreen ally and drone-revealed foe remain visible`);
  const white=arrows.find(a=>a.color==='#ffffff'),blue=arrows.find(a=>a.color==='#4fa3ff'),red=arrows.find(a=>a.color==='#ff454f');
  t.check(!!white&&!!blue&&!!red,`${big?'full map':'minimap'}: white self, blue teammate and red enemy`);
  t.check(arrows.every(a=>JSON.stringify(a.path)===JSON.stringify(white.path)),`${big?'full map':'minimap'}: every player shares the same arrow silhouette`);
  t.check(white.angle===self.angle&&blue.angle===ally.angle&&red.angle===foe.angle,`${big?'full map':'minimap'}: arrows point in each player's actual direction`);
  t.check(arrows.every(a=>a.alpha===1),`${big?'full map':'minimap'}: all markers stay fully opaque`);
  t.check(arrows.every(a=>a.x>0&&a.x<px&&a.y>0&&a.y<px),`${big?'full map':'minimap'}: edge markers stay inside the canvas`);
  t.equal(stack.length,0,`${big?'full map':'minimap'}: drawing context is restored`);
  world.time=1.37;
  const second=drawing();W.MapArt.overlay(second.g,world,self,px,{big,dpr});
  t.equal(JSON.stringify(second.fills.filter(f=>f.path[0]?.[0]==='M')),JSON.stringify(arrows),`${big?'full map':'minimap'}: reveal arrows never pulse off between frames`);
}
world.reveal[self.team]=0;
const hidden=drawing();W.MapArt.overlay(hidden.g,world,self,190,{});
t.check(!hidden.fills.some(f=>f.color==='#ff454f'),'enemy arrows disappear when reveal ends');
foe.x=self.x+W.ITEMS.radar.radius-1;foe.y=self.y;self.fx.radar=30;
const radar=drawing();W.MapArt.overlay(radar.g,world,self,190,{});
t.check(radar.fills.some(f=>f.color==='#ff454f'),'radar reveals its in-range enemy as a red arrow');
foe.x=self.x+W.ITEMS.radar.radius+1;
const outside=drawing();W.MapArt.overlay(outside.g,world,self,190,{});
t.check(!outside.fills.some(f=>f.color==='#ff454f'),'radar does not expose an out-of-range enemy');
map.rocks=[{x:center,y:center,r:50},{x:center+200,y:center,r:60,alive:false}];
const terrain=drawing();W.MapArt.overlay(terrain.g,world,self,600,{big:true});
t.equal(terrain.fills.filter(f=>f.color==='#8f969e').length,1,'full map draws only the surviving rock from the live terrain layer');
map.rocks[0].alive=false;
const demolished=drawing();W.MapArt.overlay(demolished.g,world,self,600,{big:true});
t.equal(demolished.fills.filter(f=>f.color==='#8f969e').length,0,'destroying the final rock removes it from the next map frame');
t.done();
