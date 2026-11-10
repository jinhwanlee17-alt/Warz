'use strict';
// Follow the actual five-second strike in Practice and over the multiplayer socket.
const assert = require('node:assert/strict');
const path = require('node:path');
const { openBrowser } = require('./qa-browser.cjs');

(async () => {
  const { createApp } = await import('../server/node/index.mjs');
  const app = createApp({ dataDir: null, lobbyMin: 1, lobbyCountdown: 0.2, botFill: 2, log: { info() {}, warn: console.warn, error: console.error } });
  const { port } = await app.listen(0, '127.0.0.1');
  let b, checks = 0;
  const check = (ok, message) => { assert.ok(ok, message); checks++; console.log('ok  ' + message); };
  try {
    b = await openBrowser({ outDir: path.resolve(__dirname, '../output/qa-airstrike'), width: 1680, height: 1050 });
    await b.cmd('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?seed=57' });
    await b.waitFor('window.Warz && Warz.App && Warz.App.ready && Warz.Net.online()');
    await b.evaluate(`window.airstrikeDraws={plane:0,bomb:0,impact:0};
      for (const [name,key] of [['drawStrikeAircraft','plane'],['drawStrikeBomb','bomb'],['drawAirstrikeImpact','impact']]) {
        const old=Warz.Renderer.prototype[name];Warz.Renderer.prototype[name]=function(...args){airstrikeDraws[key]++;return old.apply(this,args);};
      }`);
    for (const mode of ['practice', 'online']) {
      let strike;
      if (mode === 'practice') {
        await b.evaluate(`Warz.App.startPractice();const m=Warz.debug.match(),p=m.player;
          m.world.setClass(p,'commander',true);p.dropT=0;p.x=9000;p.y=9600;p.vx=p.vy=0;m.cam.x=p.x;m.cam.y=p.y;m.cam.zoom=1;
          m.world.useCommandRadar(p,{aimX:9600,aimY:9600});airstrikeDraws={plane:0,bomb:0,impact:0};`);
      } else {
        await b.evaluate(`Warz.App.leaveMatch();Warz.Lobby.queue('solo')`);
        await b.waitFor(`Warz.App.state()==='play' && Warz.debug.match().online`);
        const matchId = await b.evaluate('Warz.debug.match().id'), live = app.matches.get(String(matchId));
        const player = live.players.find(p => !p.bot);
        live.world.setClass(player, 'commander', true); player.dropT = 0;
        player.x = 9000; player.y = 9600; player.vx = 0; player.vy = 0;
        // Keep the test player safely outside the 225-unit damage radius.
        live.world.useCommandRadar(player, { aimX: 9600, aimY: 9600 });
        strike = live.world.strikes.find(s => s.kind === 'airstrike');
        await b.waitFor(`Warz.debug.match().world.strikes.some(s=>s.kind==='airstrike')`);
        await b.evaluate(`airstrikeDraws={plane:0,bomb:0,impact:0}`);
      }
      await b.waitFor(`Warz.debug.match().world.strikes.some(s=>s.kind==='airstrike' && s.t<4.5 && s.t>2.8)`);
      check(await b.evaluate(`airstrikeDraws.plane===0 && airstrikeDraws.bomb===0 && airstrikeDraws.impact===0`), mode + ': warning precedes aircraft, bomb and impact');
      await b.shot(mode + '-01-warning.png');
      await b.waitFor(`airstrikeDraws.plane>0 && Warz.debug.match().world.strikes.some(s=>s.kind==='airstrike' && s.t<1.8 && s.t>1.1)`);
      await b.shot(mode + '-02-aircraft.png');
      check(await b.evaluate(`airstrikeDraws.plane>0 && airstrikeDraws.bomb===0`), mode + ': visible aircraft approaches before releasing its bomb');
      await b.waitFor(`airstrikeDraws.bomb>0 && Warz.debug.match().world.strikes.some(s=>s.kind==='airstrike' && s.t<0.85 && s.t>0.2)`);
      await b.shot(mode + '-03-bomb.png');
      check(await b.evaluate(`airstrikeDraws.bomb>0 && airstrikeDraws.impact===0`), mode + ': bomb visibly falls without an early explosion');
      await b.waitFor(`airstrikeDraws.impact>0`);
      await b.shot(mode + '-04-impact.png');
      check(await b.evaluate(`Warz.debug.match().world.explosions.some(e=>e.kind==='airstrike') && !Warz.debug.match().world.strikes.some(s=>s.kind==='airstrike')`), mode + ': authoritative impact replaces the warning with animated fire and smoke');
      if (strike) check(strike.radius === 225 && strike.damage === 250 && strike.dur === 5, 'online: halved radius and 250 damage retain the five-second delay');
      await b.waitFor(`!Warz.debug.match().world.explosions.some(e=>e.kind==='airstrike')`);
      check(await b.evaluate('Warz.debug.player().alive'), mode + ': player outside the radius stays alive');
    }
    check(b.errors.length === 0, 'no browser exceptions through either animation');
    console.log('Airstrike QA passed: ' + checks + ' checks. Screenshots: ' + b.outDir);
  } finally { if (b) await b.close(); await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
