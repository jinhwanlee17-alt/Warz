// A surface Snowbomb reaches the trench floor on the server and client, including after reconnect.
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';

const t = suite('Snowbomb online');
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls', 'online']);
const match = new Match({ W: ServerW, id: 'snowbomb-duration', seed: 47, mode: 'solo', teamSize: 1,
  clock: false, emptyTimeout: Infinity, teams: [{ members: [{ name: 'Thrower' }] }, { members: [{ name: 'Target' }] }] });
const world = match.world, [p, target] = match.players;
function tick(w, seconds) {
  for (let left = seconds; left > 1e-8; left -= .05) { const dt = Math.min(.05, left); w.time += dt; w.updateZones(dt); }
}
try {
  world.storm = null;
  const trench = world.map.trenches.find(run => run.biome === 'normal');
  const wall = ServerW.Trenches.wall(trench, trench.x, trench.y);
  Object.assign(p, { x: wall.x + 80 * wall.nx, y: wall.y + 80 * wall.ny, dropT: 0 });
  Object.assign(target, { x: trench.x, y: trench.y, dropT: 0, trenchId: trench.id, trenchDepth: 1, trenchPhase: 'inside' });
  for (const player of world.players) player.hp = player.maxHp = 10000;
  let client = W.Online.start(match.startMessage(target, true));
  W.Online.applySync(match.syncMessage());
  t.check(!world.blastTrenchAt(p.x, p.y) && client.me.trenchId === trench.id, 'the Snowbomb lands above ground while the client is on the trench floor');
  world.itemBurst('snowbomb', p.x, p.y, p.id);
  const zone = world.zones.find(z => z.kind === 'snow');
  const packet = match.encodeEvent(world.events.find(e => e.type === 'zone')).msg;
  W.Online.applyEvent(packet);
  let replica = client.world.zoneById(zone.id);
  t.equal(zone.dur, 20, 'real Snowbomb burst creates a twenty-second server zone');
  t.check(packet.dur === 20 && packet.tl === 20, 'zone broadcast carries the full twenty-second lifetime');
  t.check(replica.dur === 20 && replica.t === 20, 'browser event decoder preserves the lifetime');
  const hp = client.me.hp;
  tick(world, 10.1); tick(client.world, 10.1);
  t.check(world.zoneById(zone.id) && client.world.zoneById(zone.id), 'server and browser both retain snow after ten seconds');
  t.check(target.inSnow && client.me.inSnow, 'the server and client both apply the surface snow slow to the sheltered player');
  t.check(target.hp < 10000 && target.hp === p.hp, 'the authority deals equal cold damage on the trench floor and the surface');
  t.equal(client.me.hp, hp, 'browser mirror does not author cold damage');
  t.near(zone.t, 9.9, .001, 'server countdown tracks remaining time rather than restarting');
  client = W.Online.start(match.startMessage(target, true));
  W.Online.applySync(match.syncMessage());
  replica = client.world.zoneById(zone.id);
  t.check(replica.dur === 20 && Math.abs(replica.t - 9.9) < .001, 'rejoining restores the original duration and remaining time');
  tick(world, 9.8); tick(client.world, 9.8);
  t.check(world.zoneById(zone.id) && client.world.zoneById(zone.id), 'snow lasts until just before twenty seconds on both worlds');
  t.check(client.me.trenchId === trench.id && client.me.inSnow, 'reconnect reapplies the active surface blizzard on the trench floor');
  W.Online.applySnapshot({ time: world.time, you: match.encodeYou(target), p: [], e: [], alive: 2, teams: 2 });
  t.equal(client.me.hp, target.hp, 'the trenched player receives authoritative cold damage in the next snapshot');
  tick(world, .2); tick(client.world, .2);
  t.check(!world.zoneById(zone.id) && !client.world.zoneById(zone.id), 'both worlds remove the zone at twenty seconds');
  t.check(!target.inSnow && !client.me.inSnow, 'expiry removes slow on authority and browser');
} finally { match.destroy(); }
t.done();
