// Seeded defenses, team-neutral interaction, and reconnect recovery over real codecs.
import { loadWarz, suite } from './harness.mjs';
import { Warz as ServerW } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';
const t = suite('Settlement online');
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'controls', 'online']);
const match = new Match({ W: ServerW, id: 'settlement-replication', seed: 4, mode: 'duo', teamSize: 2,
  clock: false, emptyTimeout: Infinity, teams: [{ members: [{ name: 'Visitor' }] }, { members: [{ name: 'OtherVisitor' }] }] });
const world = match.world, [p, other] = match.players;
const message = event => match.encodeEvent(event).msg;
try {
  world.storm = null;
  let client = W.Online.start(match.startMessage(p, true));
  t.check(world.structures.length > 0 && client.world.structures.length === world.structures.length, 'browser reconstructs every seeded defense from the shared map');
  t.check(world.structures.every(s => {
    const mirror = client.world.structById(s.id);
    return mirror && mirror.item === s.item && mirror.neutral && mirror.seeded && mirror.team === null && mirror.hp === s.hp && mirror.settlement === s.settlement;
  }), 'seeded structure identities, tiers, HP and neutral ownership agree');
  const vehicles = world.vehicles.filter(v => v.settlement !== null);
  t.equal(vehicles.length, 2, 'duo match contains one extra town Humvee per town');
  t.check(vehicles.every(v => client.world.vehicleById(v.id)?.armed), 'browser also marks the town Humvees armed');

  const guard = world.structures.find(s => s.kind === 'sentry');
  world.events = [];
  world.damageStruct(guard, 10, p.id, guard.x, guard.y, 'ar');
  const hpPacket = message(world.events.find(e => e.type === 'struct' && e.op === 'hp'));
  t.check(hpPacket.nt && hpPacket.seeded && hpPacket.tm === null, 'guard damage packets preserve neutral allegiance and seed metadata');
  W.Online.applyEvent(hpPacket);
  t.equal(client.world.structById(guard.id).hp, guard.hp, 'live damage updates an existing seeded defense');

  p.x = p.y = 24000; p.dropT = 0;
  world.events = [];
  world.damageStruct(guard, 10000, p.id, guard.x, guard.y, 'ar');
  const gone = match.encodeEvent(world.events.find(e => e.type === 'struct' && e.op === 'gone'));
  t.check(gone.global && Math.hypot(p.x - guard.x, p.y - guard.y) > 3000, 'distant destroyed guard state is broadcast globally');
  W.Online.applyEvent(gone.msg);
  t.equal(client.world.structById(guard.id), null, 'live destruction removes the browser defense');

  client = W.Online.start(match.startMessage(p, true));
  t.check(!!client.world.structById(guard.id), 'fresh seed reconstruction begins before authoritative sync');
  W.Online.applySync(match.syncMessage());
  t.equal(client.world.structById(guard.id), null, 'reconnect full sync removes a distant destroyed seeded guard');
  const partial = world.structures.find(s => s.kind === 'sentry');
  world.damageStruct(partial, 10, p.id, partial.x, partial.y, 'ar');
  W.Online.applySync(match.syncMessage());
  t.equal(client.world.structById(partial.id).hp, partial.hp, 'full sync also restores partially damaged existing seed structures');

  const turret = world.structures.find(s => s.kind === 'turret' && s.item === 'turret3');
  p.x = turret.x + 80; p.y = turret.y; p.dropT = 0;
  world.events = [];
  t.check(world.mountTurret(p, turret), 'visitor can mount the neutral town Turret III');
  W.Online.applyEvent(message(world.events.find(e => e.type === 'struct' && e.op === 'mount')));
  t.check(client.me.mount === turret.id && client.world.structById(turret.id).mounted === p.id, 'mount events attach the rider without changing neutral ownership');
  t.check(client.world.structById(turret.id).neutral && client.world.structById(turret.id).team === null, 'mounted turret remains a neutral asset');
  world.events = [];
  world.damageStruct(turret, 10000, other.id, turret.x, turret.y, 'ar');
  W.Online.applyEvent(message(world.events.find(e => e.type === 'struct' && e.op === 'gone')));
  t.check(!world.structById(turret.id) && !client.world.structById(turret.id) && p.mount === 0 && client.me.mount === 0,
    'another team can destroy the ridden neutral turret on both authority and browser');

  p.net.conn = { open: true, bufferedAmount: 0, close() {}, sendText(raw) { W.Online.applySnapshot(JSON.parse(raw)); } };
  function flush() { match.sendSnapshots(world.events.splice(0)); }
  p.armor = 0;
  for (const [item, hp] of [['turret', 100], ['turret2', 500], ['turret3', 2500]]) {
    const riderHP = p.hp;
    p.x = turret.x + 75; p.y = turret.y;
    t.check(world.placeItem(p, ServerW.ITEMS[item], { aimX: turret.x, aimY: turret.y }), item + ' can be placed and mounted');
    const id = p.mount, chassis = world.structById(id);
    flush();
    t.check(client.me.mount === id && client.world.structById(id).hp === hp, item + ' replicates its full chassis HP and rider');
    world.damagePlayer(p, 25, other.id, 'ar');
    flush();
    t.check(chassis.hp === hp - 25 && p.hp === riderHP && client.world.structById(id).hp === hp - 25 && client.me.hp === riderHP,
      item + ' takes the incoming hit on server and client');

    client = W.Online.start(match.startMessage(p, true));
    W.Online.applySync(match.syncMessage());
    t.check(client.me.mount === id && client.world.structById(id).mounted === p.id && client.world.structById(id).hp === hp - 25,
      item + ' restores both the mount and its remaining protection on reconnect');
    world.damageStruct(chassis, hp + 100, other.id, chassis.x, chassis.y, 'ar');
    flush();
    t.check(!world.structById(id) && !client.world.structById(id) && !p.mount && !client.me.mount && p.hp === riderHP && client.me.hp === riderHP,
      item + ' absorbs the breaking hit and dismounts the rider on both peers');
    world.damagePlayer(p, 10, other.id, 'ar');
    flush();
    t.check(p.hp === riderHP - 10 && client.me.hp === p.hp, item + ' leaves the rider exposed to the next hit');
  }

  const bonus = world.map.crates.find(c => c.legendaryDrops === 1);
  t.check(!!bonus && bonus.id !== world.map.legendaryCrateId, 'thirty-house town has a bonus distinct from the center Legendary');
  const before = world.map.nextPickupId;
  world.events = [];
  world.damageCrate(bonus, bonus.hp, p.id, bonus.x, bonus.y);
  const loot = world.map.pickups.filter(pk => pk.id >= before && pk.type === 'item');
  t.check(loot.length === 1 && ServerW.ITEMS[loot[0].item].tier === 'legendary', 'authoritative town reward drops one Legendary item');
  W.Online.applySync(match.syncMessage());
  t.check(!client.world.map.crates[bonus.id].alive && client.world.map.pickups.some(pk => pk.id === loot[0].id && pk.item === loot[0].item),
    'reconnect sync preserves the opened town reward and its single item');

  const beforeRebuild = world.structures.map(s => s.id).join();
  world.buildSolids();
  t.equal(world.structures.map(s => s.id).join(), beforeRebuild, 'rebuilding terrain does not respawn destroyed seeded defenses');
} finally { match.destroy(); }
t.done();
