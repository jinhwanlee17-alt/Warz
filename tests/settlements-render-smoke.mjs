// Entrances stay readable outside opaque roofs; ruined houses are rubble rather than intact rooms.
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'map-art', 'render']);
const t = suite('Settlement rendering'), renderer = Object.create(W.Renderer.prototype);
const view = { x0: 0, y0: 0, x1: 6000, y1: 6000 };
function drawing() {
  const ops = [], stack = [];
  const ctx = new Proxy({ fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, matrix: [1,0,0,1,0,0],
    save() { stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha, lineWidth: this.lineWidth, matrix: this.matrix.slice() }); },
    restore() { Object.assign(this, stack.pop()); },
    translate(x,y) { const m=this.matrix; m[4]+=m[0]*x+m[2]*y; m[5]+=m[1]*x+m[3]*y; },
    rotate(a) { const m=this.matrix, c=Math.cos(a),s=Math.sin(a),v=m.slice(); m[0]=v[0]*c+v[2]*s;m[1]=v[1]*c+v[3]*s;m[2]=v[2]*c-v[0]*s;m[3]=v[3]*c-v[1]*s; },
    measureText(s) { return { width: String(s).length * 7 }; }
  }, { get(o,key) {
    if (key in o) return o[key];
    return (...args) => {
      if (args.some(a=>typeof a==='number'&&!Number.isFinite(a))) throw Error(key+' uses nonfinite coordinate');
      const m=o.matrix, x=args[0]||0,y=args[1]||0,w=args[2]||0,h=args[3]||0;
      const cx=x+w/2,cy=y+h/2;
      ops.push({ op:key,args,fill:o.fillStyle,stroke:o.strokeStyle,alpha:o.globalAlpha,lineWidth:o.lineWidth,
        center:{x:m[0]*cx+m[2]*cy+m[4],y:m[1]*cx+m[3]*cy+m[5]} });
    };
  } });
  return { ctx,ops,stack };
}
function house(side) {
  const b={id:4,x:2000,y:2000,w:240,h:200,roof:'#b5533c',fade:1,ridgeVertical:false,walls:[],kind:'village',doorways:[]};
  b.doorways=[side==='top'?{side,x:2077,y:2000,w:86,h:18}:side==='bottom'?{side,x:2077,y:2182,w:86,h:18}:
    side==='left'?{side,x:2000,y:2057,w:18,h:86}:{side,x:2222,y:2057,w:18,h:86}];
  return b;
}
for (const side of ['top','bottom','left','right']) {
  const b=house(side), d=drawing();
  renderer.drawRoofs(d.ctx,{buildings:[b]},view,null,.05);
  const roof=d.ops.find(o=>o.op==='fillRect'&&o.fill===b.roof);
  t.check(roof&&roof.args[0]>=b.x&&roof.args[1]>=b.y&&roof.args[0]+roof.args[2]<=b.x+b.w&&roof.args[1]+roof.args[3]<=b.y+b.h,side+': roof stays inside the house footprint');
  const edge=d.ops.find(o=>o.op==='strokeRect'&&o.stroke===W.U.shade(b.roof,-.35));
  t.check(edge&&edge.args[0]-edge.lineWidth/2>=b.x&&edge.args[1]-edge.lineWidth/2>=b.y&&edge.args[0]+edge.args[2]+edge.lineWidth/2<=b.x+b.w&&edge.args[1]+edge.args[3]+edge.lineWidth/2<=b.y+b.h,side+': roof edging does not overhang the wall opening');
  const threshold=d.ops.find(o=>o.op==='fillRect'&&o.fill==='#f1d69b'), door=b.doorways[0];
  t.check(threshold&&Math.abs(threshold.center.x-door.x-door.w/2)<1e-8&&Math.abs(threshold.center.y-door.y-door.h/2)<1e-8&&threshold.alpha===1,side+': visible threshold aligns with the real doorway gap');
  const path=d.ops.find(o=>o.op==='fillRect'&&o.fill==='#c6b18a');
  t.check(path&&(side==='top'?path.center.y<b.y:side==='bottom'?path.center.y>b.y+b.h:side==='left'?path.center.x<b.x:path.center.x>b.x+b.w),side+': entrance path is visible outside the roof');
  t.check(d.ops.indexOf(threshold)>d.ops.indexOf(roof),side+': doorway draws above the opaque roof');
  const inside=drawing(); renderer.drawRoofs(inside.ctx,{buildings:[b]},view,{x:b.x+100,y:b.y+100,alive:true},1);
  t.check(!inside.ops.some(o=>o.op==='fillRect'&&o.fill===b.roof)&&inside.ops.some(o=>o.fill==='#f1d69b'),side+': entrance remains marked when the roof fades inside');
  t.equal(d.stack.length+inside.stack.length,0,side+': roof and entrance restore drawing state');
}
{
  const b={...house('bottom'),ruined:true},d=drawing();
  renderer.drawFloor(d.ctx,b); renderer.drawWalls(d.ctx,{buildings:[b]},view); renderer.drawRoofs(d.ctx,{buildings:[b]},view,null,.05);
  t.check(d.ops.some(o=>o.op==='fillRect'&&o.fill==='#8e897e')&&d.ops.some(o=>o.op==='fillRect'&&o.fill==='#a0734d'),'ruined house draws stone and broken timber debris');
  t.check(!d.ops.some(o=>o.fill===b.roof||o.fill==='#f1d69b'),'ruined house has no intact roof or entrance');
  const again=drawing(); renderer.drawFloor(again.ctx,b);
  t.equal(JSON.stringify(again.ops),JSON.stringify(d.ops),'rubble positions remain stable across frames');
  const map={size:48000,coast:[0,0,48000,0,48000,48000,0,48000],trees:[],bushes:[],cacti:[],ponds:[],tufts:[],towns:[],drops:[],buildings:[b]};
  const chart=drawing();W.MapArt.paintBase(chart.ctx,map,900,{big:true});
  t.check(chart.ops.some(o=>o.fill==='#6f7068')&&!chart.ops.some(o=>o.fill===b.roof),'map shows ruined houses as rubble instead of roofs');
  t.equal(d.stack.length+chart.stack.length,0,'ruins restore drawing state on both surfaces');
}
for(const item of ['turret','turret3','sentry2']) {
  const kind=item.startsWith('sentry')?'sentry':'turret',s={id:100,item,kind,x:3000,y:3000,r:30,angle:0,flash:0,alive:true,neutral:true,team:null,hp:W.ITEMS[item].hp/2,maxHp:W.ITEMS[item].hp};
  const d=drawing();renderer.drawStructures(d.ctx,{structures:[s]},view,0,{id:1,team:1});
  const label=d.ops.find(o=>o.op==='fillText'&&o.args[0]===(kind==='turret'?'Neutral ':'')+W.ITEMS[item].name);
  t.check(label&&label.fill===(kind==='turret'?'#f2c230':'#ffb3ad'),item+': neutral turret labels and hostile sentry labels remain distinct');
  t.check(d.ops.some(o=>o.op==='fill'&&o.fill==='#ffd23f'),item+': damaged guards retain health feedback');
  t.equal(d.stack.length,0,item+': guard rendering restores drawing state');
}
t.done();
