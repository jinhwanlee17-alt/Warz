'use strict';
// Real-browser regression for throwable rendering, item art, the five-slot HUD,
// and keyboard-driven dropping, manual pickup and inventory controls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createServer } = require('./serve.js');
const { openBrowser } = require('./qa-browser.cjs');

async function main() {
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const site = 'http://127.0.0.1:' + server.address().port;
  let b;
  const report = [];
  const check = (ok, message) => { assert.ok(ok, message); report.push(message); console.log('ok  ' + message); };
  try {
    b = await openBrowser({ width: 1440, height: 900 });
    await b.cmd('Page.navigate', { url: site + '/?seed=57' });
    await b.waitFor('window.Warz && Warz.App && Warz.App.ready');
    await b.waitFor('Warz.ITEM_ORDER.every(id => Warz.Icons.itemImage(id))');
    check(await b.evaluate(`Warz.ITEM_ORDER.length === 34 && Warz.ITEM_ORDER.every(id => Warz.Icons.itemImage(id).naturalWidth > 0)`), 'All 34 item images decode for canvas rendering');
    await b.evaluate(`Warz.App.startPractice(); (() => {
      const m = Warz.debug.match(), p = m.player;
      m.world.players = [p]; p.dropT = 0; m.cam.zoom = 1;
      m.world.resetItems(p); ['firenade','turret','sentry'].forEach(id => m.world.addItem(p,id,2));
      window.renderPhases = {ground:0, players:0, canopies:0, roofs:0, storm:0};
      const r = Warz.debug.renderer();
      for (const [phase,method] of Object.entries({ground:'drawIsland',players:'drawPlayer',canopies:'drawCanopies',roofs:'drawRoofs',storm:'drawStorm'})) {
        const original = r[method]; r[method] = function(...args) { renderPhases[phase]++; return original.apply(this,args); };
      }
    })()`);
    await b.sleep(250);
    const layout = () => b.evaluate(`(() => {
      const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
      const slots = [...document.querySelectorAll('#hud-slots > .slot')];
      return {count:slots.length, legacy:!!document.getElementById('hud-hotbar'), boxes:slots.map(rect),
        art:slots.filter(e=>e.classList.contains('has-item')).map(e=>({icon:rect(e.querySelector('svg')),name:rect(e.querySelector('.slot-name')),count:rect(e.querySelector('.slot-state'))})), stats:rect(document.querySelector('.hud-bl')),ammo:rect(document.querySelector('.ammo')),width:innerWidth};
    })()`);
    for (const [width,height] of [[1440,900],[800,600],[390,844]]) {
      await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await b.sleep(180);
      const l = await layout();
      await b.shot('hotbar-' + width + '.png');
      fs.writeFileSync(path.join(b.outDir,'layout-'+width+'.json'),JSON.stringify(l,null,2));
      check(l.count === 5 && !l.legacy, width + 'px: exactly five slots and no second hotbar');
      check(l.boxes.every((r,i)=>Math.abs(r.y-l.boxes[0].y)<=8 && r.x>=0 && r.right<=l.width && (!i || r.x>=l.boxes[i-1].right)), width + 'px: all five slots stay side by side inside the viewport');
      check(l.art.every(a=>a.icon.bottom<=a.name.y+1 && a.name.bottom<=a.count.y+1 && a.icon.w>=34), width + 'px: icons, labels and counts have separate readable space');
      if(width<=600) check(l.stats.bottom<l.ammo.y, width+'px: health and ammo do not overlap');
    }
    if(process.argv.includes('--layout-only')) { console.log('Responsive layout QA passed'); return; }
    await b.cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    // Real key selection followed by the normal click-to-throw input path.
    await b.cmd('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'3',code:'Digit3',windowsVirtualKeyCode:51});
    await b.sleep(65);
    await b.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'3',code:'Digit3',windowsVirtualKeyCode:51});
    await b.sleep(90);
    check(await b.evaluate('Warz.debug.player().held === 0'), 'Key 3 selects the first item in the unified row');
    await b.evaluate('Object.keys(renderPhases).forEach(k => renderPhases[k]=0)');
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:1000,y:440});
    await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:1000,y:440,button:'left',buttons:1,clickCount:1});
    await b.sleep(80);
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:1000,y:440,button:'left',buttons:0,clickCount:1});
    check(await b.evaluate(`Warz.debug.match().world.grenades.some(g=>g.item==='firenade')`), 'Fire grenade launches through normal game input');
    await b.shot('fire-in-flight.png');
    await b.sleep(1450);
    const phase = await b.evaluate('renderPhases');
    check(phase.ground>5 && phase.ground===phase.canopies && phase.ground===phase.roofs && phase.ground===phase.storm && phase.players>=phase.ground, 'Every fire-grenade frame completes players, canopies, roofs and storm rendering');
    check(await b.evaluate(`Warz.debug.match().world.zones.some(z=>z.kind==='fire')`), 'Fire zone appears after landing');
    await b.shot('fire-landed.png');
    // Full renderer checks all throwable types together, in both simulation modes.
    const flights = await b.evaluate(`(() => {
      const W=Warz, r=W.debug.renderer(), results=[];
      for (const remote of [false,true]) {
        const w=new W.World({map:W.MapGen.generate(79),remote,storm:false});
        const p=w.addPlayer({x:3200,y:3200,team:1});
        const ids=W.ITEM_ORDER.filter(id=>W.ITEMS[id].kind==='throw');
        ids.forEach((id,i)=>w.spawnGrenade(p,{x:3000+i*65,y:3200,vx:110,vy:20,fuse:remote&&W.ITEMS[id].fuse===0?1:W.ITEMS[id].fuse,item:id}));
        for(let i=0;i<190;i++){w.update(1/60);r.render(w,{x:3200,y:3200,zoom:1},{viewer:p});}
        results.push({remote,remaining:w.grenades.length});
      }
      return results;
    })()`);
    check(flights.every(f=>f.remaining===0), 'All seven special throwables render and complete in practice and online mirror worlds');
    // Exercise the actual key handlers against an isolated, unobstructed scene.
    // Fixture setup may supply items; all drop/pickup/inventory actions use keys.
    const keyEvent = (type, code, autoRepeat = false) => b.cmd('Input.dispatchKeyEvent', {
      type, code, key: code === 'Tab' ? 'Tab' : code.slice(-1).toLowerCase(),
      windowsVirtualKeyCode: code === 'Tab' ? 9 : code.charCodeAt(code.length - 1), autoRepeat
    });
    const press = async code => {
      const frame = await b.evaluate('renderPhases.ground');
      await keyEvent('rawKeyDown',code);
      await b.waitFor('renderPhases.ground > ' + frame);
      await keyEvent('keyUp',code);
      await b.sleep(100);
    };
    await b.evaluate(`(() => {
      const W=Warz,m=W.debug.match(),w=m.world,p=m.player;
      ['rocks','trees','bushes','buildings','crates','pickups','ponds','stations','drops'].forEach(k=>w.map[k]=[]);
      w.solids=new W.U.SpatialHash(256);w.structures=[];w.zones=[];w.grenades=[];w.explosions=[];w.particles=[];
      p.x=3200;p.y=3200;p.vx=0;p.vy=0;p.dropT=0;p.nearStation=null;m.cam.x=p.x;m.cam.y=p.y;m.cam.zoom=1;
      w.resetItems(p);[['bandage',3],['smoke',2],['sentry',1]].forEach(([id,n])=>w.addItem(p,id,n));
      W.debug.renderer().map=null;
    })()`);
    await b.sleep(150);
    await press('Digit3');
    const selectedStack = await b.evaluate(`(() => {const p=Warz.debug.player();return {held:p.held,items:p.items};})()`);
    check(selectedStack.held===0 && selectedStack.items[0]?.n===3, 'Key 3 holds the supplied three-item stack');
    await keyEvent('rawKeyDown','KeyQ');
    await b.sleep(120);
    check(await b.evaluate(`(() => { const w=Warz.debug.match().world,p=w.players[0],drops=w.map.pickups.filter(pk=>pk.alive&&pk.type==='item');return p.items[0]===null&&p.held===-1&&drops.length===1&&drops[0].item==='bandage'&&drops[0].amount===3;})()`), 'Q drops the selected whole stack as one ground pickup and clears its slot');
    // Hold Q while selecting another item, then send the OS repeat event.
    // The newly selected stack must remain held until a fresh Q press.
    await press('Digit4');
    await keyEvent('rawKeyDown','KeyQ',true);
    await b.sleep(650);
    check(await b.evaluate(`(() => {const m=Warz.debug.match(),p=m.player;return p.held===1&&p.items[1].id==='smoke'&&p.items[1].n===2&&m.world.map.pickups.filter(pk=>pk.alive&&pk.type==='item').length===1;})()`), 'Holding Q and receiving a repeated key event does not drop another selected stack');
    await keyEvent('keyUp','KeyQ');
    check(await b.evaluate(`(() => {const m=Warz.debug.match(),p=m.player,pk=m.world.map.pickups.find(pk=>pk.alive&&pk.item==='bandage');return !p.items[0]&&pk&&pk.lockT===0&&Math.hypot(pk.x-p.x,pk.y-p.y)<=Warz.ItemRules.PICKUP_RANGE;})()`), 'A reachable dropped item stays on the ground after its lock expires, without automatic pickup');
    await b.shot('manual-pickup-prompt.png');
    await b.cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await b.sleep(250);
    const pickupLayout = await b.evaluate(`(() => {
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height};};
      return {prompt:rect('#hud-prompt'),stats:rect('.hud-bl'),ammo:rect('.ammo'),slots:rect('#hud-slots'),hidden:document.getElementById('hud-prompt').hidden};
    })()`);
    fs.writeFileSync(path.join(b.outDir,'pickup-layout-390.json'),JSON.stringify(pickupLayout,null,2));
    await b.shot('manual-pickup-390.png');
    const overlaps = (a,c) => a.x<c.right && a.right>c.x && a.y<c.bottom && a.bottom>c.y;
    check(!pickupLayout.hidden && !overlaps(pickupLayout.prompt,pickupLayout.stats) && !overlaps(pickupLayout.prompt,pickupLayout.ammo) && !overlaps(pickupLayout.prompt,pickupLayout.slots), '390px: the E pickup prompt is visible without overlapping health, ammo or slots');
    // The full-bag instruction wraps further than the normal pickup prompt.
    await b.evaluate(`(() => {
      const m=Warz.debug.match(),p=m.player,pk=m.world.map.pickups.find(pk=>pk.alive&&pk.item==='bandage');
      window.qaPromptFixture={pk,item:pk.item,amount:pk.amount,slot:p.items[0]};
      pk.item='blackhole';pk.amount=2;p.items[0]={id:'bandage',n:9};
    })()`);
    const promptFrame = await b.evaluate('renderPhases.ground');
    await b.waitFor('renderPhases.ground > ' + promptFrame);
    const fullPickupLayout = await b.evaluate(`(() => {
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
      return {prompt:rect('#hud-prompt'),stats:rect('.hud-bl'),ammo:rect('.ammo'),slots:rect('#hud-slots'),text:document.getElementById('hud-prompt').textContent};
    })()`);
    fs.writeFileSync(path.join(b.outDir,'full-pickup-layout-390.json'),JSON.stringify(fullPickupLayout,null,2));
    await b.shot('full-manual-pickup-390.png');
    check(fullPickupLayout.text.includes('Black Hole Grenade') && fullPickupLayout.text.includes('full') && !overlaps(fullPickupLayout.prompt,fullPickupLayout.stats) && !overlaps(fullPickupLayout.prompt,fullPickupLayout.ammo) && !overlaps(fullPickupLayout.prompt,fullPickupLayout.slots), '390px: a long item name and full-bag instructions also stay clear of the HUD');
    await b.cmd('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:1,mobile:false});
    await b.sleep(150);
    const tabletPickupLayout = await b.evaluate(`(() => {
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
      return {prompt:rect('#hud-prompt'),stats:rect('.hud-bl'),ammo:rect('.ammo'),slots:rect('#hud-slots')};
    })()`);
    await b.shot('full-manual-pickup-800.png');
    check(!overlaps(tabletPickupLayout.prompt,tabletPickupLayout.stats) && !overlaps(tabletPickupLayout.prompt,tabletPickupLayout.ammo) && !overlaps(tabletPickupLayout.prompt,tabletPickupLayout.slots), '800px: full-bag pickup instructions stay clear of health, ammo and slots');
    await b.evaluate(`(() => {const f=qaPromptFixture;f.pk.item=f.item;f.pk.amount=f.amount;Warz.debug.player().items[0]=f.slot;delete window.qaPromptFixture;})()`);
    await b.cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await press('KeyE');
    check(await b.evaluate(`(() => {const m=Warz.debug.match(),p=m.player;return p.items[0]?.id==='bandage'&&p.items[0].n===3&&!m.world.map.pickups.some(pk=>pk.alive&&pk.item==='bandage')&&!Warz.Inventory.isOpen();})()`), 'E picks the nearby whole stack back into the free hotbar slot without opening inventory');
    await press('KeyE');
    check(await b.evaluate(`!Warz.Inventory.isOpen() && document.getElementById('inventory-screen').hidden`), 'E with no nearby item does not fall back to opening inventory');
    await press('Tab');
    check(await b.evaluate(`Warz.Inventory.isOpen() && !document.getElementById('inventory-screen').hidden`), 'Tab opens inventory through the normal keyboard input');
    await press('KeyQ');
    check(await b.evaluate(`Warz.debug.player().items[1]?.n===2 && !Warz.debug.match().world.map.pickups.some(pk=>pk.alive&&pk.type==='item')`), 'Q does not drop the held item while inventory is open');
    await press('Tab');
    check(await b.evaluate('!Warz.Inventory.isOpen()'), 'Tab closes inventory');
    await press('Digit1');
    const classWeapons = await b.evaluate('Warz.debug.player().weapons.map(w=>w.id)');
    await press('KeyQ');
    check(await b.evaluate(`(() => {const m=Warz.debug.match(),p=m.player;return p.slot===0&&p.held===-1&&JSON.stringify(p.weapons.map(w=>w.id))===${JSON.stringify(JSON.stringify(classWeapons))}&&!m.world.map.pickups.some(pk=>pk.alive&&pk.type==='item');})()`), 'Q with a class weapon selected neither drops it nor swaps weapons');
    // Two close pickups prove one E press collects only one item, even when held.
    await b.evaluate(`(() => {const m=Warz.debug.match(),w=m.world,p=m.player;w.resetItems(p);w.spawnPickup('item',p.x+12,p.y,1,false,'bandage');w.spawnPickup('item',p.x+24,p.y,1,false,'smoothie');})()`);
    await b.sleep(450);
    check(await b.evaluate(`Warz.debug.player().items.every(s=>!s)`), 'Walking distance alone does not collect loose items');
    await keyEvent('rawKeyDown','KeyE');
    await b.sleep(140);
    await keyEvent('rawKeyDown','KeyE',true);
    await b.sleep(300);
    await keyEvent('keyUp','KeyE');
    check(await b.evaluate(`(() => {const m=Warz.debug.match(),p=m.player;return p.items.filter(Boolean).length===1&&p.items[0].id==='bandage'&&m.world.map.pickups.some(pk=>pk.alive&&pk.item==='smoothie');})()`), 'One E press picks only the nearest item; holding E does not repeatedly collect');
    await press('KeyE');
    check(await b.evaluate(`Warz.debug.player().items.some(s=>s&&s.id==='smoothie')`), 'A fresh E press collects the next nearby item');
    // A stable in-world gallery checks pickup/held and placed turret/sentry readability.
    await b.evaluate(`(() => {
      const W=Warz,m=W.debug.match(),w=m.world,p=m.player;
      p.x=3200;p.y=3370;p.vx=0;p.vy=0;p.angle=-Math.PI/2;m.cam.x=p.x;m.cam.y=p.y;m.cam.zoom=1;
      ['rocks','trees','bushes','buildings','crates','pickups','ponds','stations','drops'].forEach(k=>w.map[k]=[]);
      w.solids=new W.U.SpatialHash(256);w.zones=[];w.structures=[];w.grenades=[];
      const ids=['turret','turret2','turret3','sentry','sentry2','sentry3'];
      ids.forEach((id,i)=>{ const it=W.ITEMS[id];w.addStruct({id:900+i,kind:it.struct,item:id,x:2880+i*128,y:3150,r:it.struct==='turret'?24:20,team:p.team,angle:-Math.PI/2,hp:it.hp,maxHp:it.hp}); });
      w.explosions=[];w.particles=[];
      ['firenade','flashbang','smoke','blackhole','snowbomb','poison'].forEach((id,i)=>w.spawnPickup('item',2880+i*128,3280,2,false,id));
      p.items=[{id:'firenade',n:2},{id:'turret3',n:1},{id:'sentry3',n:1}];p.held=0;
      W.debug.renderer().map=null;
    })()`);
    await b.sleep(200);
    await b.shot('world-items.png');
    // Render every catalog icon at both inventory and small pickup sizes.
    await b.evaluate(`(() => {
      const panel=document.createElement('section'); panel.id='item-art-gallery';
      panel.style='position:fixed;inset:0;z-index:9999;background:#101b2b;color:#e6edf8;padding:28px;display:grid;grid-template-columns:repeat(7,1fr);gap:12px;font:14px Arial';
      panel.innerHTML=Warz.ITEM_ORDER.map(id=>'<div style="background:#203047;border:1px solid #40546a;border-radius:12px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:8px"><div style="display:flex;gap:16px;align-items:center">'+Warz.Icons.itemIcon(id).replace('<svg ','<svg style="width:58px;height:58px" ')+Warz.Icons.itemIcon(id).replace('<svg ','<svg style="width:30px;height:30px" ')+'</div><span>'+Warz.ITEMS[id].name+'</span></div>').join('');
      document.body.appendChild(panel);
    })()`);
    await b.shot('item-catalog.png');
    if(b.errors.length) console.error(b.errors.join('\n'));
    check(b.errors.length===0,'No browser rendering exceptions during the complete item QA run');
    fs.writeFileSync(path.join(b.outDir,'report.json'),JSON.stringify({checks:report,errors:b.errors},null,2));
    console.log('Item browser QA: all '+report.length+' checks passed');
  } finally {
    if(b) await b.close();
    await new Promise(r=>server.close(r));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
