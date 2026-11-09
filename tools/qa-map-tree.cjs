'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createServer}=require('./serve.js');
const {openBrowser}=require('./qa-browser.cjs');

(async()=>{
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const b=await openBrowser({outDir:path.resolve(__dirname,'../output/qa-map-tree'),width:1440,height:900});
  let passed=0;
  const check=(ok,message)=>{assert.ok(ok,message);passed++;console.log('ok  '+message);};
  const click=async selector=>{
    const p=await b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw new Error('Control covered by '+(hit?.className||hit?.tagName));return{x,y};})()`);
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});
    await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',buttons:1,clickCount:1});
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',buttons:0,clickCount:1});
    await b.sleep(100);
  };
  try{
    await b.cmd('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?seed=57'});
    await b.waitFor('window.Warz&&Warz.App&&Warz.App.ready');
    await b.evaluate(`Warz.App.startPractice();(()=>{const W=Warz,m=W.debug.match(),p=m.player,s=m.world.map.stations[0];p.dropT=0;p.tokens=23;p.x=s.x+70;p.y=s.y;s.cooldown=0;W.UpgradeTree.open({world:m.world,player:p,station:s});})()`);
    check(await b.evaluate(`Warz.CLASS_ORDER.filter(id=>Warz.CLASSES[id].tier===2).length===7&&document.querySelectorAll('#ut-nodes .is-soon').length===1`),'Seven playable level-two classes and one planned vehicle class');
    for(const [branch,matching]of [['sniper','sniper2'],['shotgunner','shotgunner2'],['medic','medic2'],['grenadier','grenadier2']]){
      await click('#ut-node-'+branch);
      const visible=await b.evaluate(`([...document.querySelectorAll('#ut-nodes .ut-node')].filter(e=>!e.hidden&&(Warz.CLASSES[e.dataset.node]?.tier===2||e.dataset.node==='armorcrew')).map(e=>e.dataset.node)).sort()`);
      check(JSON.stringify(visible)===JSON.stringify([matching,'pyromancer','juggernaut','commander','armorcrew'].sort()),branch+': exactly its matching upgrade, three shared classes and planned Armor Crewmember');
    }
    await click('#ut-node-sniper');
    check(await b.evaluate(`document.getElementById('ut-action').textContent.includes('8 tokens')&&!document.getElementById('ut-action').disabled`),'Level-one action shows an eight-token cost');
    await click('#ut-action');
    await b.waitFor(`Warz.debug.player().classId==='sniper'`);
    check(await b.evaluate('Warz.debug.player().tokens===15'),'Actual level-one purchase spends eight tokens');
    await b.sleep(1000);
    await b.evaluate(`(()=>{const W=Warz,m=W.debug.match(),s=m.world.map.stations[0];s.cooldown=0;W.UpgradeTree.open({world:m.world,player:m.player,station:s});})()`);
    check(await b.evaluate(`['sniper2','pyromancer','juggernaut','commander'].every(id=>document.getElementById('ut-node-'+id).classList.contains('is-available'))`),'Current level-one class can buy its matching upgrade or any shared active class');
    const inspect=()=>b.evaluate(`(()=>{const nodes=[...document.querySelectorAll('#ut-nodes .ut-node')].filter(e=>!e.hidden&&(Warz.CLASSES[e.dataset.node]?.tier===2||e.dataset.node==='armorcrew'));const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}};return{width:innerWidth,scrollWidth:document.getElementById('upgrade-panel').scrollWidth,wrap:rect(document.querySelector('.ut-tree-wrap')),nodes:nodes.map(e=>({id:e.dataset.node,box:rect(e),label:rect(e.querySelector('.ut-node-name')),font:parseFloat(getComputedStyle(e.querySelector('.ut-node-name')).fontSize)}))}})()`);
    for(const [width,height]of [[1440,900],[800,600],[390,844]]){
      await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await b.sleep(150);
      const layout=await inspect();fs.writeFileSync(path.join(b.outDir,'tree-layout-'+width+'.json'),JSON.stringify(layout,null,2));
      check(layout.scrollWidth<=width+1,width+'px: tree panel stays within viewport');
      check(layout.nodes.length===5&&layout.nodes.every(n=>n.box.w>=76&&n.label.w>=100&&n.font>=12),width+'px: all five contextual choices keep readable card and label sizes');
      const labels=layout.nodes.map(n=>n.label).sort((a,c)=>a.x-c.x);
      check(labels.every((n,i)=>!i||n.x>=labels[i-1].right),width+'px: level-two labels never overlap');
      await b.shot('class-tree-'+width+'.png');
    }
    await b.evaluate('Warz.UpgradeTree.close()');
    await b.sleep(180);
    const pips=await b.evaluate(`(()=>{const r=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom}};return{count:document.querySelectorAll('#hud-token-pips i').length,token:r(document.getElementById('hud-tokens')),map:r(document.getElementById('minimap')),storm:r(document.getElementById('hud-storm')),ready:r(document.getElementById('hud-upgrade-ready')),hidden:document.getElementById('hud-token-pips').hidden};})()`);
    check(pips.count===15&&!pips.hidden&&pips.token.right<pips.map.x,'390px: fifteen upgrade pips wrap compactly without touching the minimap');
    check(pips.storm.y>pips.token.bottom&&pips.ready.right<pips.map.x,'390px: storm and upgrade-ready labels do not cover the expanded token HUD or minimap');
    await b.shot('fifteen-token-pips-390.png');
    await b.cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await b.evaluate(`(()=>{const m=Warz.debug.match();Warz.UpgradeTree.open({world:m.world,player:m.player,station:m.world.map.stations[0]});})()`);
    await click('#ut-node-armorcrew');
    check(await b.evaluate(`document.getElementById('ut-detail-title').textContent==='Armor Crewmember'&&document.getElementById('ut-action').disabled&&document.getElementById('ut-detail-desc').textContent.includes('vehicles')`),'Armor Crewmember has named vehicle details and cannot be purchased');
    await b.shot('armor-crew-planned.png');
    await click('#ut-node-sniper2');
    check(await b.evaluate(`document.getElementById('ut-detail-title').textContent==='Sniper II'&&!document.getElementById('ut-action').disabled&&document.getElementById('ut-action').textContent.includes('15 tokens')`),'Sniper II is available from its parent and shows the fifteen-token cost');
    await click('#ut-action');
    await b.waitFor(`Warz.debug.player().classId==='sniper2'`);
    check(await b.evaluate(`Warz.debug.player().tokens===0&&Warz.debug.player().upgradeFrom==='sniper'`),'Actual level-two purchase spends fifteen tokens and preserves its origin');
    await b.sleep(1000);
    await b.evaluate(`(()=>{const W=Warz,m=W.debug.match(),p=m.player,s=m.world.map.stations[0];m.world.setClass(p,'medic',false);p.tokens=15;s.cooldown=0;W.UpgradeTree.open({world:m.world,player:p,station:s});})()`);
    await click('#ut-node-commander');
    check(await b.evaluate(`!document.getElementById('ut-action').disabled`),'Medic can buy Commander without a Sniper branch restriction');
    await click('#ut-action');await b.waitFor(`Warz.debug.player().classId==='commander'`);
    await b.evaluate(`(()=>{const m=Warz.debug.match();Warz.UpgradeTree.open({world:m.world,player:m.player,station:m.world.map.stations[0]});})()`);
    check(await b.evaluate(`Warz.debug.player().upgradeFrom==='medic'&&document.getElementById('ut-branch-label').textContent.startsWith('Medic upgrades')&&!document.getElementById('ut-node-commander').hidden&&!document.getElementById('ut-node-medic2').hidden`),'Reopening a shared class preserves the actual Medic origin and keeps the current class visible');
    await b.evaluate(`(()=>{const W=Warz,m=W.debug.match(),p=m.player;W.UpgradeTree.close();m.world.teams=true;m.world.addPlayer({x:m.world.map.size-150,y:150,team:p.team,angle:1.2,name:'Teammate'});m.world.addPlayer({x:150,y:m.world.map.size-150,team:p.team+1,angle:-.7,name:'Revealed enemy'});m.world.reveal[p.team]=60;W.MapScreen.show();})()`);
    await b.sleep(150);await b.shot('expanded-map-markers.png');
    check(await b.evaluate(`document.querySelector('.map-legend .lg-enemy')&&getComputedStyle(document.querySelector('.lg-mate'),'::before').backgroundColor==='rgb(79, 163, 255)'`),'Map legend matches blue allies and includes revealed enemies');
    check(b.errors.length===0,'No browser exceptions in the expanded map and class-tree flow');
    console.log('Map/tree browser QA: all '+passed+' checks passed');
  }finally{await b.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
