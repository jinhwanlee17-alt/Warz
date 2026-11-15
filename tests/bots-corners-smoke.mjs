// Compact house corners must be rounded before skipping their route waypoint.
import { suite } from './harness.mjs';
import { arena, W } from './bots-harness.mjs';
const t=suite('Bot settlement navigation');
const building={id:0,x:10000,y:10000,w:260,h:200,doors:['left'],doorways:[{side:'left',x:10000,y:10060,w:18,h:86}],walls:[
  {x:10000,y:10000,w:260,h:18},{x:10242,y:10018,w:18,h:164},
  {x:10000,y:10182,w:260,h:18},{x:10000,y:10018,w:18,h:42},{x:10000,y:10146,w:18,h:36}
]};
const a=arena({seed:7,extra:{buildings:[building]}}), b=a.bot(10300,10030,{skill:.7});
const goal={x:9758,y:9815,tol:14}, corner={x:10302,y:10007}, next={x:10238,y:9943};
b.now=0;
b.route={gx:goal.x,gy:goal.y,pts:[corner,next,goal],i:0,partial:false,at:0,cut:Infinity,blocked:0};
t.check(!b.nav.segmentClear(b.p.x,b.p.y,next.x,next.y),'cutting directly toward the next waypoint crosses the house corner');
const direction=b.follow(goal);
t.check(direction&&b.nav.segmentClear(b.p.x,b.p.y,b.p.x+direction.x*40,b.p.y+direction.y*40),'bot follows a clear first step rather than cutting early through the wall');
t.equal(b.route.i,0,'corner clearance waypoint stays active until the next leg is actually reachable');
b.decide=()=>{};b.sense=()=>{};b.scanHazards=()=>{};b.runItems=()=>{};
b.runMode=()=>{b.moveGoal=goal;};
const reached=a.until(()=>Math.hypot(b.p.x-goal.x,b.p.y-goal.y)<60,6);
t.check(reached>=0,'actual movement rounds the compact house and reaches the destination');
t.equal(a.dir.errors,0,'following the clearance route does not throw');
{
  const c=arena({seed:7,extra:{buildings:[building]}}),bot=c.bot(10290,10050,{skill:.7});
  bot.now=0;bot.moveGoal={x:10290,y:10400,tol:14};bot.pauseUntil=-1;
  const hazard={id:'guard',x:10460,y:10100,r:175,eta:0,kind:'sentry',d:Math.hypot(170,50)};
  bot.hazards=[hazard];
  bot.steer();
  const len=Math.hypot(bot.out.mx,bot.out.my);
  t.check(len>0&&bot.nav.segmentClear(bot.p.x,bot.p.y,bot.p.x+bot.out.mx/len*64,bot.p.y+bot.out.my/len*64),
    'sliding along a guard range rim chooses a clear side instead of steering into a house wall');
}
{
  const c = arena(), bot = c.bot(15641.2, 40273.3, { skill: .7 });
  for (const y of [41057.72, 39457.72]) {
    const guard = c.world.addStruct({ kind: 'sentry', item: 'sentry2', x: 15826.01, y, r: 30,
      owner: 0, team: null, hp: W.ITEMS.sentry2.hp, maxHp: W.ITEMS.sentry2.hp, neutral: true });
    bot.heed.set('t' + guard.id, { at: -1, heed: true });
  }
  bot.scanHazards();
  t.check(bot.hazards.length === 2 && bot.avoid.every(zone => zone.hard && bot.hazards.some(h => h.x === zone.x && h.y === zone.y && h.r === zone.r)),
    'route planning and steering use the same permanent guard safety radius');
  bot.decide = () => {}; bot.sense = () => {}; bot.runItems = () => {};
  bot.runMode = () => { bot.moveGoal = { x: 16676, y: 40707, tol: 24 }; };
  const reached = c.until(() => Math.hypot(bot.p.x - 16676, bot.p.y - 40707) < 60, 12);
  t.check(reached >= 0 && bot.p.hp === bot.p.maxHp, 'bot crosses the safe gap between two town guards without oscillating or entering firing range');
  const zone = { x: 10000, y: 10000, r: 200, hard: true };
  t.check(!bot.nav.segmentClear(10180, 10000, 10140, 10000, { avoid: [zone] }) &&
    bot.nav.segmentClear(10180, 10000, 10250, 10000, { avoid: [zone] }),
    'a bot already inside a guard margin can leave but cannot plan a deeper shortcut');
  bot.nav.budget = 99;
  const boundary = { x: 40829.44, y: 33147.26, r: 780, hard: true }, goal = { x: 40810.07, y: 32367.25 };
  const path = bot.nav.findPath(41587.28, 32769.22, goal.x, goal.y, { avoid: [boundary], maxNodes: 6000 });
  t.check(path && !path.partial && Math.hypot(path.points.at(-1).x - goal.x, path.points.at(-1).y - goal.y) < 1e-6,
    'a safe exact destination remains reachable when its coarse grid cell overlaps a guard margin');
}
{
  const house = { id: 0, x: 8449.47, y: 40132.45, w: 260, h: 220, walls: [
    { x: 8449.47, y: 40132.45, w: 260, h: 18 }, { x: 8691.47, y: 40150.45, w: 18, h: 184 },
    { x: 8449.47, y: 40334.45, w: 260, h: 18 }
  ] };
  const c = arena({ extra: { buildings: [house] } }), bot = c.bot(8757.82, 40184.93);
  for (const y of [39392.45, 40992.45]) {
    const guard = c.world.addStruct({ kind: 'sentry', item: 'sentry2', x: 8929.47, y, r: 30,
      owner: 0, team: null, hp: W.ITEMS.sentry2.hp, maxHp: W.ITEMS.sentry2.hp, neutral: true });
    bot.heed.set('t' + guard.id, { at: -1, heed: true });
  }
  c.world.addStruct({ kind: 'sentry', item: 'sentry2', x: 8835.85, y: 40204.32, r: 20,
    owner: bot.p.id, team: bot.p.team, hp: W.ITEMS.sentry2.hp, maxHp: W.ITEMS.sentry2.hp });
  bot.scanHazards(); bot.nav.budget = 99;
  const goal = { x: 9157.82, y: 40184.93, tol: 24 };
  const blocked = bot.nav.findPath(bot.p.x, bot.p.y, goal.x, goal.y, { avoid: bot.avoid, maxNodes: 6000 });
  t.check(!blocked || blocked.partial, 'a deployed sentry can close the extra guard caution margin beside a house');
  bot.decide = () => {}; bot.sense = () => {}; bot.runItems = () => {};
  bot.runMode = () => { bot.moveGoal = goal; };
  const reached = c.until(() => Math.hypot(bot.p.x - goal.x, bot.p.y - goal.y) < 60, 12);
  t.check(reached >= 0 && bot.p.hp === bot.p.maxHp && bot.guardMarginUntil > 0,
    'stuck recovery uses the safe gap outside actual guard range without taking damage');
}
{
  const c = arena(), bot = c.bot(9000, 9000);
  bot.now = 1; bot.pauseUntil = 0; bot.mode = 'loot';
  bot.loot = { key: 'unreachable-crate' }; bot.moveGoal = { x: 9500, y: 9000 };
  bot.follow = () => null;
  bot.stuck = { x: bot.p.x, y: bot.p.y, at: 0, n: 4 };
  bot.steer();
  t.check(bot.loot === null && bot.badLoot.has('unreachable-crate'), 'failed pathfinding abandons an unreachable errand instead of treating it as intentional idling');
  bot.loot = { key: 'arrived' }; bot.moveGoal = { x: bot.p.x, y: bot.p.y };
  bot.unstick = null;
  bot.stuck = { x: bot.p.x, y: bot.p.y, at: 0, n: 4 };
  bot.steer();
  t.check(bot.loot !== null && !bot.badLoot.has('arrived'), 'arriving at a movement goal does not trigger failed-route recovery');
}

{
  const c = arena(), bot = c.bot(16000, 10000);
  c.world.storm = { x: 10000, y: 10000, r: 10000, next: { x: 10000, y: 10000, r: 5000 },
    phase: 0, state: 'shrinking', timeLeft: 200, dps: 1 };
  bot.updateStorm();
  t.check(!bot.storm.must, 'a distant closure does not force a bot to abandon its current errand');
  bot.mode = 'storm'; bot.updateStorm();
  t.check(bot.storm.must, 'a bot already travelling to safety keeps that route when a corner changes its estimated travel time');
  bot.p.x = 14000; bot.updateStorm();
  t.check(!bot.storm.must && !bot.storm.soon, 'entering the next safe circle releases the storm travel commitment');
}

t.done();
