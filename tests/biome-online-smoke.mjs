import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
const t = suite('Biome online');
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls', 'online']);
const match = new Match({ W: ServerW, id: 'biome-replication', seed: 57, mode: 'solo', teamSize: 1,
  clock: false, emptyTimeout: Infinity, teams: [{ members: [{ name: 'SnowThrower' }] }, { members: [{ name: 'FrozenEnemy' }] }] });
const world = match.world, [p, target] = match.players;
function tick(seconds) {
  for (let left = seconds; left > 1e-8; left -= .05) { const dt = Math.min(.05, left); world.time += dt; world.updateZones(dt); }
}
function packet(event) { return match.encodeEvent(event).msg; }
try {
  world.storm = null;
  let client = W.Online.start(match.startMessage(p, true));
  for (const kind of ['cacti']) {
    const plant = world.map[kind][0];
    t.check(!!plant && client.world.map[kind][0].hp === plant.maxHp, kind + ': seeded server and browser start with matching foliage health');
    world.events = [];
    world.damageFoliage(plant, 20, p.id, 'ar');
    W.Online.applyEvent(packet(world.events.find(e => e.type === 'foliage')));
    t.equal(client.world.map[kind][0].hp, plant.maxHp - 20, kind + ': damage event carries authoritative remaining HP');
    world.events = [];
    world.damageFoliage(plant, 999, p.id, 'grenade');
    W.Online.applyEvent(packet(world.events.find(e => e.type === 'foliage')));
    t.check(!client.world.map[kind][0].alive && client.world.map[kind][0].hp === 0, kind + ': destruction event removes client foliage');
  }
  t.equal(client.world.map.foliageVersion, 1, 'cactus destruction invalidates cached map artwork on the client');
  W.Online.applyEvent({ t: 'foliage', k: 'trees', id: 0, hp: 0 });
  t.check(client.world.map.trees[0].alive && client.world.map.trees[0].hp === undefined, 'old tree damage events cannot restore canopy health or remove cover');
  client = W.Online.start(match.startMessage(p, true));
  W.Online.applySync(match.syncMessage());
  t.check(client.world.map.trees[0].alive && client.world.map.trees[0].hp === undefined && !client.world.map.cacti[0].alive, 'reconnect keeps leafy cover without health and restores destroyed cacti');
  world.damageFoliage(world.map.cacti[1], 10, p.id, 'ar');
  const sync = match.syncMessage();
  t.check(sync.foliage.every(row => row[0] === 'cacti'), 'server sync excludes non-damageable leafy cover');
  sync.foliage.push(['trees', 0, 0]);
  W.Online.applySync(sync);
  t.equal(client.world.map.cacti[1].hp, 40, 'full sync restores partially damaged cacti');
  t.check(client.world.map.trees[0].alive && client.world.map.trees[0].hp === undefined, 'legacy reconnect data cannot reintroduce tree health');

  for (const [ids, slow, duration, frozen] of [[['tundra'], .625, 20, true], [['desert'], .25, 10, false], [['desert', 'grassland'], .25, 10, false]]) {
    const label = ids.join('+');
    world.map.biomes = ids.map(id => ({ id, x: 0, y: 0, w: world.map.size, h: world.map.size }));
    world.zones = []; world.events = []; client.world.zones = [];
    for (const player of world.players) {
      world.clearItemState(player); player.x = player.y = 5000; player.dropT = 0; player.hp = player.maxHp = 1000;
    }
    client.me.x = client.me.y = 5000; client.me.dropT = 0;
    world.itemBurst('snowbomb', 5000, 5000, p.id);
    const zone = world.zones[0], event = packet(world.events.find(e => e.type === 'zone'));
    W.Online.applyEvent(event);
    let replica = client.world.zoneById(zone.id);
    t.check(replica.slow === slow && replica.dur === duration && replica.freezeAfter === (frozen ? 5 : 0), label + ': live zone event preserves climate behavior');
    const hp = client.me.hp;
    client.world.updateZones(.05);
    t.near(client.world.speedMul(client.me), 1 - slow, 1e-8, label + ': client prediction uses biome slow');
    t.equal(client.me.hp, hp, label + ': client never authors snow damage');
    tick(5.1);
    W.Online.applySnapshot({ time: world.time, you: match.encodeYou(p), p: [match.encodePlayer(target)], e: [], alive: 2, teams: 2 });
    t.equal(client.me.snowFrozen, frozen, label + ': authoritative freeze state reaches the local player');
    t.equal(client.world.playerById(target.id).snowFrozen, frozen, label + ': authoritative freeze state reaches other players');
    if (frozen) t.equal(client.world.speedMul(client.me), 0, 'snapshot freeze blocks client movement prediction');
    client = W.Online.start(match.startMessage(p, true));
    W.Online.applySync(match.syncMessage());
    replica = client.world.zoneById(zone.id);
    t.check(replica.slow === slow && replica.dur === duration && Math.abs(replica.t - (duration - 5.1)) < .001,
      label + ': reconnect keeps climate and remaining lifetime');
    tick(duration);
    W.Online.applySnapshot({ time: world.time, you: match.encodeYou(p), p: [match.encodePlayer(target)], e: [], alive: 2, teams: 2 });
    t.check(!client.me.snowFrozen && !client.me.inSnow, label + ': expiry snapshot clears frozen movement');
  }
} finally { match.destroy(); }
t.done();
