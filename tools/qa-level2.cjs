'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createServer } = require('./serve.js');
const { openBrowser } = require('./qa-browser.cjs');

async function main() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const report = [], outDir = path.resolve(__dirname, '../output/qa-level2');
  let b;
  const check = (ok, message) => { assert.ok(ok, message); report.push(message); console.log('ok  ' + message); };
  try {
    b = await openBrowser({ outDir, width: 1440, height: 900 });
    const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
    await b.cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/?seed=101' });
    await b.waitFor('window.Warz?.App?.ready');
    await evaluate(() => {
      Warz.App.startPractice();
      const W=Warz,m=W.debug.match(),w=m.world,p=m.player,r=W.debug.renderer();
      window.qaStation={...w.map.stations[0]};
      ['rocks','trees','bushes','buildings','crates','pickups','ponds','stations','drops'].forEach(k=>w.map[k]=[]);
      w.solids=new W.U.SpatialHash(256);w.structures=[];w.storm=null;w.players=[p];p.x=5000;p.y=5000;p.dropT=0;p.vx=p.vy=0;
      m.cam.x=p.x;m.cam.y=p.y;m.cam.zoom=1;r.map=null;
      window.qaFrames=0;window.qaAimFrames=0;window.qaEvents=[];window.qaConsole=[];
      const render=r.render;r.render=function(...args){const value=render.apply(this,args);qaFrames++;if(args[2]?.trajectory)qaAimFrames++;return value;};
      const emit=w.emit;w.emit=function(e){qaEvents.push({type:e.type,weapon:e.weapon,damage:e.damage,kind:e.strike?.kind});return emit.call(this,e);};
      const error=console.error;console.error=(...args)=>{qaConsole.push(args.map(String).join(' '));error.apply(console,args);};
    });
    const nextFrames = async (n=2) => { const before = await b.evaluate('qaFrames'); await b.waitFor('qaFrames >= ' + (before+n)); };
    const key = async code => {
      const key = /^Digit/.test(code) ? code.slice(-1) : /^Key/.test(code) ? code.slice(-1).toLowerCase() : code;
      const vk = code === 'Escape' ? 27 : code === 'Tab' ? 9 : key.toUpperCase().charCodeAt(0);
      await b.cmd('Input.dispatchKeyEvent',{type:'rawKeyDown',code,key,windowsVirtualKeyCode:vk}); await nextFrames();
      await b.cmd('Input.dispatchKeyEvent',{type:'keyUp',code,key,windowsVirtualKeyCode:vk}); await nextFrames();
    };
    const mouse = (type, x=1100, y=450) => b.cmd('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});
    const click = async selector => {
      const pos=await evaluate(selector=>{const e=document.querySelector(selector);e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},selector);
      await mouse('mouseMoved',pos.x,pos.y);await mouse('mousePressed',pos.x,pos.y);await mouse('mouseReleased',pos.x,pos.y);await nextFrames();
    };
    const fixture = async cls => {
      await mouse('mouseReleased');
      await evaluate(cls=>{
        const m=Warz.debug.match(),w=m.world,p=m.player;Warz.UpgradeTree.close();Warz.MapScreen.hide();Warz.Inventory.hide();
        w.players=[p];w.map.pickups=[];w.map.stations=[];w.grenades=[];w.bullets=[];w.strikes=[];w.zones=[];w.explosions=[];w.particles=[];w.texts=[];
        w.resetItems(p);w.setClass(p,cls,true);p.alive=true;p.downed=false;p.dropT=0;p.x=5000;p.y=5000;p.vx=p.vy=0;p.nearStation=null;p.stats.shots=0;
        m.cam.x=p.x;m.cam.y=p.y;qaEvents=[];Warz.Hud.reset(w,p,'Practice');
      },cls); await nextFrames(3);
    };
    for (const cls of await b.evaluate('Warz.CLASS_ORDER')) {
      await fixture(cls);
      check(await evaluate(()=>{
        const p=Warz.debug.player(),html=document.getElementById('hud').innerHTML;
        return document.querySelectorAll('#hud-slots>.slot').length===5&&document.querySelectorAll('#hud-slots>.slot>.slot-icon').length===2&&!/undefined|NaN/.test(html)&&Warz.Icons.classIcon(p.classId).includes('<svg');
      }), cls + ': complete portrait and five-slot HUD without missing values');
    }
    await fixture('soldier');
    await evaluate(()=>{const m=Warz.debug.match(),p=m.player;Object.assign(qaStation,{id:0,x:p.x+75,y:p.y,cooldown:0});m.world.map.stations=[qaStation];p.tokens=23;p.keys=1;});
    await nextFrames();await key('KeyE');await b.waitFor('Warz.UpgradeTree.isOpen()');
    await click('#ut-node-sniper');await click('#ut-action');await b.waitFor('Warz.debug.player().classId==="sniper"');await b.waitFor('!Warz.UpgradeTree.isOpen()');
    await b.evaluate('qaStation.cooldown=0');await key('KeyE');await b.waitFor('Warz.UpgradeTree.isOpen()');
    check(await evaluate(()=>document.querySelectorAll('.ut-node').length===13 && !document.querySelector('#ut-node-sniper2').classList.contains('is-locked')), 'tree exposes twelve active classes and the planned vehicle class');
    await b.shot('level-two-tree.png');await click('#ut-node-sniper2');await click('#ut-action');await b.waitFor('Warz.debug.player().classId==="sniper2"');await b.waitFor('!Warz.UpgradeTree.isOpen()');
    check(await evaluate(()=>Warz.debug.player().weapons[0].id==='sniper2'&&Warz.debug.player().weapons[0].ammo===3&&Warz.debug.player().tokens===0), 'station UI upgrades Soldier to Sniper to Sniper II for eight plus fifteen tokens');
    await fixture('juggernaut');await mouse('mouseMoved');await mouse('mousePressed');
    await b.waitFor('Warz.debug.player().minigunSpin>=.2');
    check(await evaluate(()=>Warz.debug.player().stats.shots===0&&document.getElementById('hud-ammo-label').textContent.includes('Spinning')), 'held minigun shows spin-up and does not fire early');
    await b.shot('minigun-spin-up.png');await b.waitFor('qaEvents.some(e=>e.type==="shot"&&e.weapon==="minigun")');
    await mouse('mouseReleased');await nextFrames();check(await b.evaluate('Warz.debug.player().minigunSpin===0'), 'releasing minigun resets spin-up');
    await fixture('pyromancer');
    await evaluate(()=>{const w=Warz.debug.match().world,p=Warz.debug.player();for(const dy of[-40,40]){const e=w.addPlayer({x:p.x+180,y:p.y+dy,team:900+dy});e.hp=e.maxHp=1000;}});
    await mouse('mouseMoved',1000,450);await mouse('mousePressed',1000,450);await b.waitFor('qaEvents.filter(e=>e.type==="flame").length>=4');
    check(await evaluate(()=>qaEvents.filter(e=>e.type==='flame').slice(0,4).map(e=>e.damage).join(',')==='10,15,20,25'&&Warz.debug.match().world.players.slice(1).every(p=>p.hp<1000)), 'held flames ramp and damage multiple enemies');
    await b.shot('pyromancer-flame.png');await mouse('mouseReleased',1000,450);await nextFrames();
    check(await b.evaluate('Warz.debug.player().flameTicks===0'), 'letting go resets flame damage ramp');
    await fixture('commander');
    await evaluate(()=>{const w=Warz.debug.match().world,p=Warz.debug.player();const mate=w.addPlayer({x:p.x-160,y:p.y,team:p.team});mate.name='Teammate';});
    await key('Digit2');await mouse('mouseMoved',1000,450);await mouse('mousePressed',1000,450);await mouse('mouseReleased',1000,450);await nextFrames();
    check(await evaluate(()=>{
      const w=Warz.debug.match().world,p=Warz.debug.player();
      return w.strikes.some(s=>s.kind==='airstrike'&&s.radius===450)&&p.commandCd>43&&p.fx.radar>28&&w.players.every(p=>p.commandBuff>13)&&document.getElementById('hud-buffs').textContent.includes('Command boost')&&document.getElementById('hud-feed').textContent.includes('Airstrike incoming');
    }), 'radar click shows cooldown, team rally and five-second airstrike warning');
    await b.shot('commander-airstrike-warning.png');
    await fixture('grenadier2');await mouse('mouseMoved',1100,450);const aimBefore=await b.evaluate('qaAimFrames');await mouse('mousePressed',1100,450);await b.sleep(300);await nextFrames();
    check(await evaluate(before=>Warz.debug.match().world.grenades.length===0&&Warz.debug.player().weapons[0].ammo===10&&qaAimFrames>before,aimBefore), 'holding launcher fire draws trajectory without consuming ammo');
    await b.shot('launcher-trajectory.png');await mouse('mouseReleased',1100,450);await b.waitFor('Warz.debug.match().world.grenades.length>0');
    check(await evaluate(()=>Warz.debug.player().weapons[0].ammo===9&&Warz.debug.match().world.grenades[0].weapon==='launcher2'), 'release launches one upgraded shell');
    await b.shot('launcher-in-flight.png');
    await fixture('soldier');await b.evaluate('Warz.debug.giveItem("firenade",2)');await key('Digit3');
    await mouse('mouseMoved',1100,450);await mouse('mousePressed',1100,450);await b.sleep(250);await nextFrames();
    check(await evaluate(()=>Warz.debug.match().world.grenades.length===0&&Warz.debug.player().items[0].n===2), 'holding a fire grenade previews without consuming it');
    await b.shot('fire-grenade-trajectory.png');await mouse('mouseReleased',1100,450);await b.waitFor('Warz.debug.match().world.grenades.some(g=>g.item==="firenade")');
    check(await b.evaluate('Warz.debug.player().items[0].n===1'), 'release consumes exactly one fire grenade');
    await b.waitFor('Warz.debug.match().world.zones.some(z=>z.kind==="fire")');await b.shot('fire-grenade-landed.png');
    check(b.errors.length===0 && await b.evaluate('qaConsole.length===0'), 'all class and trajectory frames complete without browser errors');
    fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify({checks:report,errors:b.errors},null,2));
    console.log('Level-two browser QA: all '+report.length+' checks passed');
  } finally { if(b) await b.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
