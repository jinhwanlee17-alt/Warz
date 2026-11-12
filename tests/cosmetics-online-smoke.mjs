// Two independent clients exchange actual match protocol messages; no public lobby is used.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
import { Warz as W } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
const t = suite('cosmetics online'), STEP = .05;
const match = new Match({ W, id: 'locker', mode: 'duo', teamSize: 2, seed: 57, clock: false, emptyTimeout: Infinity,
  teams: [{ members: [{ name: 'Alice' },{ name: 'Bob' }] },{ members: [{ name:'Far observer' }] }] });
const [alice,bob,far] = match.players;
function empty(w) {
  for(const key of ['rocks','trees','bushes','buildings','crates','pickups','ponds','stations']) w.map[key]=[];
  w.vehicles=[];w.structures=[];w.buildSolids();
}
empty(match.world);
for(const [i,p] of match.players.entries()) { p.dropT=0;p.x=8000+i*100;p.y=8000; }
far.x=15000;far.y=15000;
const clients=[];
function client(player, look, rejoin=false) {
  const C=loadWarz(['config','util','map','world','items','controls']), received=[],sent=[];
  let clock=0, callbacks;
  const conn={open:true,bufferedAmount:0,close(){this.open=false;},
    sendJson(m){receive(m);},sendText(text){receive(JSON.parse(text));}};
  function receive(m){received.push(m);if(callbacks)callbacks.onMessage(m);}
  C.Locker={get:()=>look};
  C.MatchNet={
    send(m){sent.push(m);match.onMessage(conn,JSON.stringify(m));},
    connect(id,ticket,handlers){callbacks=handlers;match.claim(ticket,conn);},close(){conn.open=false;}
  };
  const sandbox={Warz:C,performance:{now:()=>clock*1000}};sandbox.window=sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../js/online.js',import.meta.url),'utf8'),sandbox);
  C.Online.join(match.id,match.slots.find(s=>s.player===player).ticket,rejoin);
  const state=C.Online.state();empty(state.world);
  const result={C,conn,received,sent,state,advance(){clock+=STEP;state.world.update(STEP);},last(){return received.filter(m=>m.t==='snap').at(-1);}};
  clients.push(result);return result;
}
const lookA=W.Cosmetics.normalize({color:'#f10a42',face:'evil',emotes:['cooked','rose','fire','cry','gg','hi','bye','haha','laugh']});
const lookB=W.Cosmetics.normalize({color:'#33bb88',face:'smile'});
const a=client(alice,lookA),b=client(bob,lookB),f=client(far,W.Cosmetics.DEFAULT);
function tick(n=1){for(let i=0;i<n;i++){clients.forEach(c=>c.advance());match.tick();}}
try {
  tick();
  t.check(alice.color===lookA.color && alice.face==='evil' && alice.emotes[0]==='cooked','match-start automatically sends validated Locker choices to authority');
  t.check(b.state.world.playerById(alice.id).color===lookA.color && b.state.world.playerById(alice.id).face==='evil','other client receives chosen colour and face');
  t.check(a.state.me.color===lookA.color && a.state.me.emotes[1]==='rose','owner receives authoritative look and equipped slot order');
  t.equal(alice.team,bob.team,'different circle colours do not change the actual team');
  t.check(f.state.world.playerById(alice.id).hidden,'far observer remains outside player interest');
  t.check(a.sent.some(m=>m.t==='cosmetics') && !a.sent.some(m=>m.t==='in'),'look submission uses no combat input commands');
  const damageBefore=alice.stats.damage,ammoBefore=alice.weapons[0].ammo;
  t.check(a.C.Online.emote(0),'client sends equipped first emote');
  tick();
  t.equal(alice.emote.id,'cooked','server resolves the slot rather than trusting arbitrary text');
  t.equal(b.state.world.playerById(alice.id).emote.id,'cooked','near teammate sees the same emote');
  const global=f.last().e.find(e=>e.t==='emote');
  t.check(global && global.em==='cooked' && !('x'in global) && !('y'in global),'everyone receives the fixed emote without leaking sender coordinates');
  t.check(f.state.world.playerById(alice.id).hidden,'global emote does not reveal a hidden body');
  t.check(alice.stats.damage===damageBefore && alice.weapons[0].ammo===ammoBefore,'emoting does not shoot or spend ammo');
  const accepted=alice.emote.until;
  for(const slot of [-1,9,'0',.5]) match.onMessage(a.conn,JSON.stringify({t:'emote',slot,id:'arbitrary chat'}));
  match.onMessage(a.conn,JSON.stringify({t:'emote',slot:1}));
  t.equal(alice.emote.until,accepted,'invalid slots and cooldown spam cannot emit or prolong a bubble');
  t.check(!a.C.Online.emote(1),'client also prevents immediate repeated emote requests');
  tick(10);
  // A rejoin starts its local world clock at0; remaining TTL must not be mistaken for absolute server time.
  const re=client(alice,lookA,true);tick();
  const active=re.state.me.emote;
  t.check(active && active.id==='cooked' && active.until-re.state.world.time>2 && active.until-re.state.world.time<3,'rejoin restores active bubble using remaining lifetime');
  t.check(re.state.me.color===lookA.color && re.state.me.face==='evil','rejoin preserves selected circle and face');
  t.check(re.state.me.emotes.join()===lookA.emotes.join(),'rejoin preserves all nine equipped slots');
  const beforeLook=alice.color;
  match.onMessage(re.conn,JSON.stringify({t:'cosmetics',value:{color:'#000000',face:'angry'}}));
  t.equal(alice.color,beforeLook,'cosmetics cannot be spammed during a live connection');
  tick(21);
  t.check(re.C.Online.emote(1),'next slot activates after the server cooldown');tick();
  t.equal(b.state.world.playerById(alice.id).emote.id,'rose','second slot uses its own equipped emote');
  // Skip the actual event under backpressure, then recover bubble and appearance from current state.
  b.conn.bufferedAmount=100*1024;tick(30);
  re.C.Online.emote(2);tick();b.conn.bufferedAmount=0;tick();
  t.equal(b.state.world.playerById(alice.id).emote.id,'fire','visible active bubble repairs after an event was skipped');
  const changed=W.Cosmetics.normalize({...lookA,color:'#e2a103',face:'cry'});
  b.conn.bufferedAmount=100*1024;const re2=client(alice,changed,true);tick();
  b.conn.bufferedAmount=0;tick();
  t.check(b.state.world.playerById(alice.id).color===changed.color && b.state.world.playerById(alice.id).face==='cry','appearance revision repairs after a slow-link frame was skipped');
  tick(61);
  t.check(!re2.state.me.emote && !b.state.world.playerById(alice.id).emote,'expired bubbles clear on both clients without history');
  const beforeInvalid=match.world.events.length;
  alice.downed=true;match.onMessage(re2.conn,JSON.stringify({t:'emote',slot:0}));alice.downed=false;
  alice.alive=false;match.onMessage(re2.conn,JSON.stringify({t:'emote',slot:0}));alice.alive=true;
  t.equal(match.world.events.length,beforeInvalid,'dead and downed senders cannot broadcast');
  const input={down:()=>false,hit:k=>['KeyQ','KeyE','KeyR','Mouse1'].includes(k),lift:()=>false,wheel:1,mouse:{x:0,y:0}};
  re2.C.Online.latch(input);re2.C.Online.pressInteract();re2.C.Online.clearActions();
  t.check(!re2.state.latch.fp && !re2.state.latch.dp && !re2.state.latch.r && !re2.state.latch.ip && !re2.state.latch.cy,'opening an emote UI can cancel queued combat/interact/drop actions');
  t.check(re2.received.every(m=>m.t!=='chat'),'emotes create no chat protocol or history');
}finally{match.destroy();}
t.done();
