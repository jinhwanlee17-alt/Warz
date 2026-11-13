// The real Snowbomb burst, server zone packet, reconnect sync and browser mirror
// agree on the new lifetime without authoring cold damage on the client.
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
  for (const player of world.players) { player.x = 5000; player.y = 5000; player.dropT = 0; player.hp = player.maxHp = 10000; }
  let client = W.Online.start(match.startMessage(p, true));
  client.me.x = 5000; client.me.y = 5000; client.me.dropT = 0;
  world.itemBurst('snowbomb', 5000, 5000, p.id);
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
  t.check(target.inSnow && client.me.inSnow, 'snow slow remains active on authority and browser');
  t.check(target.hp < 10000, 'authority still deals cold damage after the grace period');
  t.equal(client.me.hp, hp, 'browser mirror does not author cold damage');
  t.near(zone.t, 9.9, .001, 'server countdown tracks remaining time rather than restarting');
  client = W.Online.start(match.startMessage(p, true));
  W.Online.applySync(match.syncMessage());
  replica = client.world.zoneById(zone.id);
  t.check(replica.dur === 20 && Math.abs(replica.t - 9.9) < .001, 'rejoining restores the original duration and remaining time');
  tick(world, 9.8); tick(client.world, 9.8);
  t.check(world.zoneById(zone.id) && client.world.zoneById(zone.id), 'snow lasts until just before twenty seconds on both worlds');
  tick(world, .2); tick(client.world, .2);
  t.check(!world.zoneById(zone.id) && !client.world.zoneById(zone.id), 'both worlds remove the zone at twenty seconds');
  t.check(!target.inSnow && !client.me.inSnow, 'expiry removes slow on authority and browser');
} finally { match.destroy(); }
t.done();
