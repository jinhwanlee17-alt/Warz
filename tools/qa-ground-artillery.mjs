// Local-only browser coverage for anchored artillery, including live input and rejoin.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/node/index.mjs';
import { openBrowser, sleep } from './qa-browser.cjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),outDir=path.join(root,'output/qa-ground-artillery');
const app=createApp({dataDir:null,lobbyMin:1,lobbyCountdown:.15,botFill:4,log:{info(){},warn:console.warn,error:console.error}});
const checks=[],check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('ok  '+label);};
let b;
function clearGroundTerrain(W,w){
  for(const k of ['rocks','trees','bushes','buildings','crates','pickups','ponds','stations'])w.map[k]=[];
  w.structures=[];w.solids=new W.U.SpatialHash(256);w.buildSolids();w.storm=null;
}
function prepare(W,w,p){
  clearGroundTerrain(W,w);
  w.vehicles.forEach((v,i)=>{v.x=13000+i*240;v.y=13000;v.seats={driver:0,gunner:0,rearLeft:0,rearRight:0};});
  w.players.forEach(o=>{o.vehicle=0;o.mount=0;o.vehicleSeat=null;o.dropT=0;o.x=o.y=22000;o.vx=o.vy=0;});
  w.setClass(p,'grenadier2',true);p.alive=true;p.downed=false;p.hp=p.maxHp;p.held=-1;
  const v=w.vehicles.find(v=>v.fixed);v.x=v.y=5000;v.angle=.35;v.vx=v.vy=v.ox=v.oy=0;v.stationaryT=0;v.artilleryCooldown=0;
  p.x=p.px=v.x-v.r-35;p.y=p.py=v.y;w.qaGround=v;
}
try {
  const {port}=await app.listen(0,'127.0.0.1');b=await openBrowser({outDir,width:1440,height:900});
  const evaluate=(fn,...args)=>b.evaluate('('+fn.toString()+')(...'+JSON.stringify(args)+')');
  const key=(code,down)=>b.cmd('Input.dispatchKeyEvent',{type:down?'rawKeyDown':'keyUp',code,
    key:code==='Enter'?'Enter':code==='Escape'?'Escape':code.slice(-1).toLowerCase(),
    windowsVirtualKeyCode:code==='Enter'?13:code==='Escape'?27:code.charCodeAt(code.length-1)});
  const press=async code=>{await key(code,true);await sleep(85);await key(code,false);await sleep(85);};
  const click=async(x,y)=>{for(const down of [true,false])await b.cmd('Input.dispatchMouseEvent',{type:down?'mousePressed':'mouseReleased',x,y,button:'left',buttons:down?1:0,clickCount:1});};
  const wheel=deltaY=>b.cmd('Input.dispatchMouseEvent',{type:'mouseWheel',x:900,y:350,deltaX:0,deltaY});
  await b.cmd('Page.navigate',{url:'http://127.0.0.1:'+port+'/?seed=57'});
  await b.waitFor('window.Warz?.App?.ready && Warz.Net.online()');
  check((await evaluate(()=>Warz.Account.register({username:'GroundArtyQA',email:'ground-artillery@example.test',password:'local-ground-artillery-qa-only'}))).ok,'local test account supports rejoin');
  await evaluate(source=>{window.clearGroundTerrain=(0,eval)('('+source+')');},clearGroundTerrain.toString());
  for(const online of [false,true]) {
    const label=online?'Online':'Practice';
    if(online){await evaluate(()=>{Warz.App.leaveMatch();Warz.Lobby.queue('solo');});await b.waitFor('Warz.App.state()==="play" && Warz.debug.match().online && Warz.debug.online().snapCount>2');}
    else await evaluate(()=>Warz.App.startPractice());
    check(await evaluate(()=>{const w=Warz.debug.match().world;return w.vehicles.filter(v=>v.fixed).length===6&&w.vehicles.filter(v=>v.type==='artillery'&&!v.fixed).length===4;}),label+': six fixed and four mobile artillery coexist');
    const live=online?app.matches.get(String(await evaluate(()=>Warz.debug.match().id))):null;
    const owner=live?live.byId.get(await evaluate(()=>Warz.debug.player().id)):null;
    const mutate=async(fn,...args)=>live?fn(live.W,live.world,owner,...args):evaluate((source,args)=>{const m=Warz.debug.match();return(0,eval)('('+source+')')(Warz,m.world,m.player,...args);},fn.toString(),args);
    if(live){live.players.forEach(p=>{if(p!==owner)p.controller=()=>({mx:0,my:0});});prepare(live.W,live.world,owner);}
    else await mutate(prepare);
    await evaluate(source=>(0,eval)('('+source+')')(Warz,Warz.debug.match().world),clearGroundTerrain.toString());
    await b.waitFor('document.getElementById("hud-prompt").textContent.includes("Operate Artillery Cannon")');
    await sleep(700);await b.shot(label.toLowerCase()+'-ground-cannon.png');
    await press('KeyE');await b.waitFor('Warz.ArtilleryUI.isOpen() && Warz.debug.player().vehicleWeapon===1');
    check(await evaluate(()=>{const v=Warz.debug.match().world.vehicleById(Warz.debug.player().vehicle);return v.fixed&&document.querySelector('.artillery-map-name small').textContent==='Ground artillery'&&document.querySelector('.artillery-close-label').textContent.includes('Close');}),label+': E opens the fixed cannon targeting map with appropriate controls');
    check(await evaluate(()=>{const r=document.getElementById('artillery-map').getBoundingClientRect();return r.width===innerWidth&&r.height===innerHeight&&Warz.ArtilleryUI.view().zoom===3;}),label+': fixed cannon uses fullscreen island targeting');
    check(await evaluate(()=>document.getElementById('artillery-fire').disabled),label+': setup blocks premature firing');
    const before=await evaluate(()=>({center:Warz.ArtilleryUI.view().centerX,x:Warz.debug.player().x,y:Warz.debug.player().y}));
    await key('KeyD',true);await sleep(450);await key('KeyD',false);
    check(await evaluate(at=>{const p=Warz.debug.player();return Warz.ArtilleryUI.view().centerX>at.center+100&&Math.hypot(p.x-at.x,p.y-at.y)<.25;},before),label+': WASD pans the targeting view while the emplacement stays fixed');
    await wheel(-300);await sleep(150);
    check(await evaluate(()=>Warz.ArtilleryUI.view().zoom>3),label+': scroll up zooms in');
    await wheel(9000);await sleep(150);
    check(await evaluate(()=>Warz.ArtilleryUI.view().zoom===1),label+': scroll down reveals the whole island');
    const aim=await evaluate(()=>{const at=Warz.ArtilleryUI.worldToScreen(11000,5000);at.x=Math.round(at.x);at.y=Math.round(at.y);return {...at,target:Warz.ArtilleryUI.screenToWorld(at.x,at.y)};});
    const shots=live?owner.stats.shots:await evaluate(()=>Warz.debug.player().stats.shots);
    await click(aim.x,aim.y);await sleep(100);
    check((live?owner.stats.shots:await evaluate(()=>Warz.debug.player().stats.shots))===shots,label+': map clicks select a target without firing personal weapons');
    await mutate((W,w,p)=>{w.setClass(p,'armorcrew',true);const v=w.vehicleById(p.vehicle);v.stationaryT=10;v.artilleryCooldown=0;});
    await b.waitFor('Warz.debug.player().classId==="armorcrew"');
    await b.waitFor('document.getElementById("artillery-fire").disabled===false');
    await b.shot(label.toLowerCase()+'-ground-targeting.png');
    await press('Enter');await b.waitFor('Warz.debug.match().world.artilleryShells.length>0');
    check(await evaluate(aim=>{const s=Warz.debug.match().world.artilleryShells[0];return Math.hypot(s.targetX-aim.target.x,s.targetY-aim.target.y)<.2;},aim),label+': Enter fires at the selected island-wide target');
    check(await evaluate(()=>{const s=Warz.debug.match().world.artilleryShells[0],v=Warz.debug.match().world.vehicleById(Warz.debug.player().vehicle);
      const normal=Math.min(4,2+Math.hypot(s.targetX-s.startX,s.targetY-s.startY)/Warz.CONFIG.worldSize*2);
      return Math.abs(s.flightTime-normal/1.25)<.001&&v.artilleryCooldown>6.8&&v.artilleryCooldown<=7.5&&Warz.debug.match().world.vehicleMaxSpeed(v)===0;
    }),label+': Armor Crew gets faster shells and a 7.5-second reload while the ground cannon stays fixed');
    if(online){await b.cmd('Page.reload',{});await b.waitFor('window.Warz?.App?.ready && Warz.debug.match()?.online && Warz.ArtilleryUI.isOpen() && Warz.debug.online()?.info.rejoin');
      // Reapply the empty-terrain fixture after the client regenerates its seed.
      await evaluate(source=>(0,eval)('('+source+')')(Warz,Warz.debug.match().world),clearGroundTerrain.toString());
      check(await evaluate(()=>Warz.debug.match().world.vehicleById(Warz.debug.player().vehicle).fixed),'Online: reload restores the fixed cannon and its targeting menu');}
    await press('Escape');await b.waitFor('!Warz.ArtilleryUI.isOpen() && Warz.debug.player().vehicleWeapon===0');
    check(await evaluate(()=>document.getElementById('pause-menu').hidden),label+': Escape closes targeting without pausing or leaving the cannon');
    await key('KeyD',true);await sleep(600);await key('KeyD',false);
    check(await evaluate(()=>{const v=Warz.debug.match().world.vehicleById(Warz.debug.player().vehicle);return v.x===5000&&v.y===5000&&Math.abs(v.angle-.35)<.001&&v.vx===0&&v.vy===0;}),label+': movement outside targeting cannot drive or rotate the fixed cannon');
    check(await evaluate(()=>document.getElementById('hud-vehicle-name').textContent==='Artillery Cannon'&&!document.getElementById('hud-ammo-label').textContent.includes('drive')),label+': cannon HUD has no driving instructions');
    await press('Digit2');await b.waitFor('Warz.ArtilleryUI.isOpen()');await press('KeyE');
    await b.waitFor('!Warz.ArtilleryUI.isOpen() && !Warz.debug.player().vehicle');
    check(true,label+': E leaves the cannon from fire control');
    await mutate((W,w,p)=>{const v=w.qaGround;v.hp=1000;p.x=p.px=v.x-v.r-60;p.y=p.py=v.y;});
    await b.waitFor('document.getElementById("hud-prompt").textContent.includes("Repair Artillery Cannon")');
    check(await evaluate(()=>document.getElementById('hud-prompt').textContent.includes('100 HP / 2s')),label+': ground artillery repair prompt shows the two-second rate');
    await press('KeyF');await b.waitFor('Warz.debug.player().repairVehicle>0');
    check(await evaluate(()=>{const w=Warz.debug.match().world,v=w.vehicleById(Warz.debug.player().repairVehicle);return v.maxHp===1200&&document.getElementById('hud-repair').textContent.includes('Artillery Cannon')&&document.getElementById('hud-repair').textContent.includes('100 HP / 2s');}),label+': F repairs the 1200-HP ground cannon with the correct HUD');
    await b.waitFor('Warz.debug.match().world.vehicleById(Warz.debug.player().repairVehicle)?.hp>=1050');
    await press('KeyG');await b.waitFor('!Warz.debug.player().repairVehicle');
    await mutate((W,w,p)=>{const v=w.qaGround;p.x=p.px=v.x-v.r-35;p.y=p.py=v.y;w.enterVehicle(p,v,'driver');});
    await b.waitFor('Warz.ArtilleryUI.isOpen()');
    await mutate((W,w,p)=>w.damageVehicle(w.vehicleById(p.vehicle),5000,p.id,'artillery'));
    await b.waitFor('!Warz.ArtilleryUI.isOpen() && !Warz.debug.player().vehicle');
    check(true,label+': destruction ejects the operator and closes targeting');
  }
  // Inspect all three ground-cannon rings and a detailed miniature on a fresh island.
  await evaluate(()=>{Warz.App.leaveMatch();Warz.App.startPractice();const w=Warz.debug.match().world,p=Warz.debug.player(),v=w.vehicles.find(v=>v.fixed);
    p.dropT=0;p.x=p.px=v.x-v.r-35;p.y=p.py=v.y;w.storm=null;});
  await sleep(500);await b.shot('generated-ground-emplacement.png');
  await press('KeyM');await b.waitFor('Warz.MapScreen.isOpen()');await b.shot('generated-ground-cannon-map.png');
  check(b.errors.length===0,'ground artillery completes offline and online controls without browser exceptions');
  fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify({checks,errors:b.errors},null,2));
  console.log('Ground artillery browser QA: all '+checks.length+' checks passed');
} finally {if(b)await b.close();await app.close();}
