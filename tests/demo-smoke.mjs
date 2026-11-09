// The main-menu background: simulated soldiers must actually fight, upgrade and respawn without errors.
import { loadWarz, suite } from './harness.mjs';

const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'demo']);
const t = suite('demo');

const demo = W.Demo.create(99);
t.equal(demo.world.players.length, 14, 'fourteen simulated soldiers behind the menu');
t.check(demo.world.players.every((p) => p.bot && p.name), 'all of them are named background soldiers');
t.check(demo.followId !== null, 'camera follows someone');

// create() warms up the simulation before attaching the event observer.
let damage = 0, shots = 0, deaths = demo.world.players.filter((p) => !p.alive).length, upgrades = 0, respawns = 0;
demo.onEvent = (e) => {
  if (e.type === 'damage' && e.source) damage += e.amount;
  if (e.type === 'shot' || e.type === 'launch') shots++;
  if (e.type === 'death') deaths++;
  if (e.type === 'upgrade') upgrades++;
};
for (let i = 0; i < 60 * 90; i++) {
  const dead = demo.world.players.filter((p) => !p.alive);
  W.Demo.update(demo, 1 / 60);
  respawns += dead.filter((p) => p.alive).length;
}
t.check(shots > 200, 'soldiers shoot (' + shots + ' shots in 90 s)');
t.check(damage > 500, 'soldiers hit each other (' + Math.round(damage) + ' damage)');
t.check(deaths >= 2, 'eliminations happen (' + deaths + ')');
t.check(respawns >= 1 && respawns <= deaths, 'eliminated soldiers respawn (' + respawns + ' of ' + deaths + ')');

// A plain soldier standing at a ready station takes the upgrade within a couple of seconds.
const bot = demo.world.players.find((p) => p.alive) ;
const station = demo.world.map.stations.find((s) => s.cooldown <= 0);
demo.world.setClass(bot, 'soldier', false);
bot.x = station.x + 60; bot.y = station.y; bot.vx = 0; bot.vy = 0;
demo.world.collide(bot);
bot.controller = () => ({ mx: 0, my: 0, aimX: bot.x + 100, aimY: bot.y });
const before = upgrades;
for (let i = 0; i < 60 * 3; i++) W.Demo.update(demo, 1 / 60);
t.check(upgrades > before && W.CLASSES[bot.classId].tier === 1, 'a soldier at a ready station upgrades (' + upgrades + ' total)');

const cam = demo.cam;
t.check(Number.isFinite(cam.x) && Number.isFinite(cam.y) && W.U.insideIsland(cam.x, cam.y, 0, W.CONFIG.worldSize, W.CONFIG.cornerRadius), 'camera stays on the island');
t.check(demo.world.particles.length <= 900 && demo.world.texts.length <= 80, 'effect lists stay bounded');

t.done();
