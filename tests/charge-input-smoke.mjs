// Physical hold duration survives frame boundaries, remapping, quick taps and cancellation.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'util', 'map', 'world', 'items', 'class-combat', 'controls']), t = suite('charged input');
let now = 0;
const events = {}, canvasEvents = {};
const sandbox = { Warz: W, performance: { now: () => now }, innerWidth: 1200, innerHeight: 800,
  addEventListener: (type, fn) => { events[type] = fn; } };
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/input.js', import.meta.url), 'utf8'), sandbox);
const input = new W.Input({ addEventListener: (type, fn) => { canvasEvents[type] = fn; } });
const C = W.Controls, tracker = C.createChargeTracker();
const sample = (id = 'launcher', enabled = true, action = 'fire') => tracker.sample(input, action, id, enabled);
const down = () => canvasEvents.mousedown({ button: 0 });
const up = () => events.mouseup({ button: 0 });

down(); t.check(sample().held && !sample().released, 'holding starts a preview without releasing a shot');
input.endFrame(); now = 375;
t.near(sample().seconds, 0.375, 1e-9, 'half charge uses actual elapsed input time');
now = 750; up();
const full = sample();
t.check(full.released && !full.held && full.seconds === 0.75, 'release after 0.75 seconds carries a full charge');
input.endFrame(); t.check(!sample().released && sample().seconds === 0, 'release is consumed once');

now = 1000; down(); now = 1020; up();
const tap = sample();
t.check(tap.released && tap.seconds === 0.02, 'a complete quick tap between rendered frames retains its short duration');
input.endFrame();
now = 1100; down(); sample(); input.endFrame(); now = 3100;
t.equal(sample().seconds, 0.75, 'holding longer than 0.75 seconds cannot exceed full charge');
sample('launcher', false); now = 3200; up();
t.check(!sample().released, 'opening an overlay cancels a charged shot');
input.endFrame();
now = 3300; down(); sample(); input.endFrame(); now = 3700;
t.check(!sample('grenade').held, 'changing projectile cannot inherit an existing charge');
up(); t.check(!sample('grenade').released, 'switching weapons while held does not accidentally throw on release');
input.endFrame();
now = 3800; down(); sample(); input.endFrame(); now = 4600; events.blur();
t.check(!sample().released && input.heldSeconds('Mouse1') === 0, 'losing focus cancels charge without firing');

C.rebind('fire', 0, 'KeyT'); now = 5000;
events.keydown({ code: 'KeyT', repeat: false }); sample(); input.endFrame();
now = 5400; events.keydown({ code: 'KeyT', repeat: true });
t.near(sample().seconds, 0.4, 1e-9, 'a remapped keyboard trigger charges and key repeat does not restart it');
now = 5750; events.keyup({ code: 'KeyT' });
t.equal(sample().seconds, 0.75, 'remapped release retains full charge');
input.endFrame(); now = 6000;
events.keydown({ code: 'KeyG', repeat: false }); sample('grenade', true, 'gear'); input.endFrame();
now = 6300; events.keyup({ code: 'KeyG' });
const gear = sample('grenade', true, 'gear');
t.check(gear.released && gear.seconds === 0.3, 'secondary gear binding charges a hand grenade independently');
// The frame latch must preserve release duration until the next 20 Hz network step.
const sent = [];
W.MatchNet = { send: message => sent.push(message) };
vm.runInNewContext(fs.readFileSync(new URL('../js/online.js', import.meta.url), 'utf8'), sandbox);
const online = W.Online.start({ seed: 22, teamSize: 1, you: 1, time: 0, players: [{ id: 1, name: 'Charge', team: 1 }] });
online.world.setClass(online.me, 'grenadier', true); online.me.dropT = 0;
const renderer = { screenToWorld: () => ({ x: online.me.x + 1000, y: online.me.y }) };
input.release(); tracker.reset(); now = 7000;
events.keydown({ code: 'KeyT', repeat: false });
W.Online.latch(input, { fire: sample(), gear: {} });
W.Online.step(input, renderer, false, false);
t.check(!sent.at(-1).f && !sent.at(-1).fp, 'online launcher does not fire while held');
input.endFrame(); now = 7750; events.keyup({ code: 'KeyT' });
W.Online.latch(input, { fire: sample(), gear: {} });
input.endFrame(); now = 7760;
W.Online.latch(input, { fire: sample(), gear: {} });
W.Online.step(input, renderer, false, false);
t.check(sent.at(-1).fp && sent.at(-1).ch === 0.75, 'full charge survives the wait between release and the next network tick');
W.Online.step(input, renderer, false, false);
t.check(!sent.at(-1).fp && sent.at(-1).ch === 0, 'online release and charge are sent only once');

// Mounted fire must bypass projectile charging for both launcher tiers and grenades.
for (const [cls, slot] of [['grenadier', 0], ['grenadier2', 0], ['grenadier', 1]]) {
  input.release(); tracker.reset();
  online.world.setClass(online.me, cls, true); online.me.slot = slot; online.me.mount = 99;
  const label = cls + ' slot ' + slot;
  const mountedSample = () => sample(online.world.aimedProjectile(online.me), !online.me.mount);
  t.equal(online.world.aimedProjectile(online.me), null, label + ': mounted player has no aimed projectile');
  now += 1000; events.keydown({ code: 'KeyT', repeat: false });
  W.Online.latch(input, { fire: mountedSample(), gear: {} });
  W.Online.step(input, renderer, false, false);
  t.check(sent.at(-1).f && sent.at(-1).fp && sent.at(-1).ch === 0, label + ': turret fires immediately without charging');
  input.endFrame(); now += 800;
  W.Online.latch(input, { fire: mountedSample(), gear: {} });
  W.Online.step(input, renderer, false, false);
  t.check(sent.at(-1).f && !sent.at(-1).fp && sent.at(-1).ch === 0, label + ': holding sends sustained turret fire');
  // Getting off while the trigger is held must not inherit the turret hold as a charge.
  online.me.mount = 0; input.endFrame();
  const resumed = mountedSample();
  t.check(!resumed.held && !resumed.released, label + ': dismounting does not begin a charged shot from held turret fire');
  now += 100; events.keyup({ code: 'KeyT' });
  W.Online.latch(input, { fire: mountedSample(), gear: {} });
  W.Online.step(input, renderer, false, false);
  t.check(!sent.at(-1).f && !sent.at(-1).fp, label + ': releasing after dismount does not fire the carried projectile');
  input.endFrame(); now += 100; events.keydown({ code: 'KeyT', repeat: false });
  mountedSample(); input.endFrame(); now += 750; events.keyup({ code: 'KeyT' });
  W.Online.latch(input, { fire: mountedSample(), gear: {} });
  W.Online.step(input, renderer, false, false);
  t.check(sent.at(-1).fp && sent.at(-1).ch === 0.75, label + ': a fresh press charges normally after dismount');
}

// A mount snapshot can arrive between the frame latch and the next network step.
function mountSnapshot(mount) {
  const p = online.me;
  W.Online.applySnapshot({ time: online.serverTime + 0.05, p: [], e: [], alive: 1, teams: 1,
    you: { x: p.x, y: p.y, vx: 0, vy: 0, ack: online.seq, alive: true, drop: 0, down: false, downT: 0, rev: 0,
      team: p.team, cls: W.CLASS_ORDER.indexOf(p.classId), hp: p.hp, mhp: p.maxHp, ar: p.armor, tok: 0, keys: 0,
      slot: p.slot, ammo: p.weapons.map(w => w.ammo), rel: [0, 0], gren: p.grenades, med: 0, sc: false, near: -1, mnt: mount } });
}
input.release(); tracker.reset();
online.world.setClass(online.me, 'grenadier', true); online.me.mount = 99;
now += 1000; events.keydown({ code: 'KeyT', repeat: false });
W.Online.latch(input, { fire: sample(null, false), gear: {} });
t.check(online.latch.fp, 'a turret click is queued before the network step');
input.endFrame(); mountSnapshot(0);
W.Online.step(input, renderer, false, false);
t.check(!sent.at(-1).f && !sent.at(-1).fp && sent.at(-1).ch === 0, 'a dismount snapshot cannot turn the queued turret click into a launcher shot');

input.release(); tracker.reset(); now += 100;
events.keydown({ code: 'KeyT', repeat: false }); sample(); input.endFrame(); now += 750; events.keyup({ code: 'KeyT' });
W.Online.latch(input, { fire: sample(), gear: { released: true, seconds: 0.5 } });
W.Online.useItem();
t.check(online.latch.fp && online.latch.ch === 0.75 && online.latch.u && online.latch.use, 'projectile and item actions can be queued before a mount snapshot');
mountSnapshot(99);
t.check(!online.latch.fp && online.latch.ch === 0 && !online.latch.u && online.latch.uch === 0 && !online.latch.use,
  'mounting cancels pending personal weapon, grenade and item-use actions');
W.Online.step(input, renderer, false, false);
t.check(!sent.at(-1).f && !sent.at(-1).fp && !sent.at(-1).u, 'cancelled actions do not leak into a turret fire packet');
t.done();
