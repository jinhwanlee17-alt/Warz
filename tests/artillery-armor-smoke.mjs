// Tank hull defenses also apply to SP artillery, with separate 1200-HP hulls.
import {loadWarz,suite} from './harness.mjs';
const W=loadWarz(),t=suite('Artillery hull armor'),X=5000,Y=5000;
function arena(type='artillery',fixed=false,remote=false) {
  const map={seed:1,size:W.CONFIG.worldSize,teamSize:1,rocks:[],trees:[],buildings:[],crates:[],pickups:[],ponds:[],stations:[],towns:[],drops:[],nextPickupId:1,
    vehicles:[{id:1,type,fixed,x:X,y:Y,angle:0}]};
  const w=new W.World({map,storm:false,remote}),v=w.vehicles[0];v.hidden=false;
  const owner=w.addPlayer({x:X-700,y:Y,team:2});
  const operator=w.addPlayer({x:X+v.r+30,y:Y,team:1,classId:'armorcrew'});
  if(!remote)w.enterVehicle(operator,v,'driver');
  return {w,v,owner,operator};
}
function tick(a,n) {for(let i=0;i<Math.round(n/.05);i++)a.w.update(.05);}
const resisted=['ar','pistol','sniper','shotgun','deagle','sniper2','shotgun2','revolver','dualrevolver','pyrodualrevolver','minigun','commandpistol','shieldpistol',
  'turret','tankmg','sentry','sentry-bullets','sentry-grenades','sentry-fireballs'];
const bypass=['grenade','launcher','launcher2','fire','flamethrower','pyroflamethrower','firegun','snow','storm','lightning','meteor','airstrike','tank-cannon','rpg','ram','ram-impact','sentry-cannons','sentry-rockets'];
for(const [type,fixed] of [['tank',false],['artillery',false],['artillery',true]]) {
  const a=arena(type,fixed),{w,v,owner,operator}=a,armored=type==='tank'||!fixed,tag=type+(fixed?' ground':' mobile');
  t.equal(v.hp,type==='tank'?5000:1200,tag+': hull keeps its own requested health');
  t.equal(v.maxHp,type==='tank'?5000:1200,tag+': correct maximum health');
  for(const cause of [...resisted,...bypass,'shotgun3','sentry-snowballs','sentry-burn','pyro-burn']) {
    v.hp=v.maxHp;v.pyroBurn=null;v.sentryBurn=null;
    const damageBefore=owner.stats.damage;
    const expected=resisted.includes(cause)?armored?25:100
      :cause==='shotgun3'?armored?35:100
      :cause==='sentry-snowballs'?armored?25:50
      :cause==='sentry-burn'||cause==='pyro-burn'?armored?0:100:100;
    w.damageVehicle(v,100,owner.id,cause);
    t.near(v.maxHp-v.hp,expected,1e-8,tag+': '+cause+' applies correct hull resistance exactly once');
    t.near(owner.stats.damage-damageBefore,expected,1e-8,tag+': '+cause+' records actual hull damage');
    t.equal(operator.hp,operator.maxHp,tag+': '+cause+' never leaks damage through to operator');
  }
  v.hp=v.maxHp;v.pyroBurn=null;v.sentryBurn=null;
  w.damagePlayer(operator,100,owner.id,'ar');
  t.equal(v.maxHp-v.hp,armored?25:100,tag+': direct occupant damage uses hull armor without personal mitigation');
  t.equal(operator.hp,150,tag+': Armor Crewmember stays protected inside the hull');
  v.hp=v.maxHp;
  t.equal(w.applyVehicleSentryBurn(v,owner.id),!armored,tag+': sentry burn eligibility matches hull armor');
  tick(a,3);
  t.near(v.maxHp-v.hp,armored?0:30,1e-8,tag+': residual sentry fire matches tank or ground behavior');
  v.hp=v.maxHp;w.applyPyroBurn(v,owner.id,'firegun',10,0);tick(a,3);
  t.near(v.maxHp-v.hp,armored?0:18,.11,tag+': residual firegun burn matches tank or ground behavior');
  t.check(!w.pyroBurnTime(v)&&!v.sentryBurn,tag+': expired or immune burn leaves no visuals');
  if(armored) {
    v.sentryBurn={until:w.time+3,next:w.time+.1,owner:owner.id};
    v.pyroBurn={firegun:{until:w.time+3,last:w.time,dps:6,pending:0,tick:0,owner:owner.id}};
    tick(a,.1);
    t.check(!v.sentryBurn&&!v.pyroBurn,tag+': stale burn states are cleared without damage');
  }
}
for(const fixed of [false,true]) {
  const a=arena('artillery',fixed),{w,v,owner,operator}=a;
  w.spawnShot(owner,W.WEAPONS.pistol,[0]);tick(a,.6);
  t.near(v.maxHp-v.hp,W.WEAPONS.pistol.damage*(fixed?1:.25),1e-8,(fixed?'ground':'SP')+': a real bullet applies hull damage once');
  t.equal(operator.hp,150,'a real bullet cannot also hit the artillery operator');
  w.damageVehicle(v,v.hp+1,owner.id,'tank-cannon');
  t.check(v.wreck&&!operator.vehicle&&operator.alive,'wreck ejects the operator without overflowing damage');
  const hp=v.hp;w.damageVehicle(v,1000,owner.id,'ar');
  t.equal(v.hp,hp,'wreck remains indestructible');
}
{
  const a=arena('artillery',false,true);a.w.damageVehicle(a.v,100,a.owner.id,'ar');
  t.equal(a.v.hp,1200,'client mirror cannot apply armored hull damage');
}
t.done();
