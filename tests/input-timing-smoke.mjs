// Delayed network bursts must not permanently queue old movement behind new controls.
import { suite } from './harness.mjs';
import { Warz as W } from '../server/core/sim.mjs';
import { Match } from '../server/core/match.mjs';

const t = suite('input timing');
function game() {
  const m = new Match({ W, id: 'timing', mode: 'solo', teamSize: 1, seed: 31, clock: false,
    emptyTimeout: Infinity, teams: [{ members: [{ name: 'One' }] }, { members: [{ name: 'Two' }] }] });
  const p = m.players[0];
  p.dropT = 0;
  return { m, p };
}
const packet = (s, over = {}) => ({ s, mx: 0, my: 0, a: 0, d: 400, ...over });

// Ordinary packets arriving once per tick retain exactly the same physics as direct controls.
{
  const a = game(), b = game();
  let direction = { mx: 0, my: 0 };
  b.p.controller = () => ({ ...direction, aimX: b.p.x + 400, aimY: b.p.y });
  let same = true;
  for (let i = 1; i <= 120; i++) {
    direction = i <= 40 ? { mx: 1, my: 0 } : i <= 80 ? { mx: 0, my: -1 } : { mx: 0, my: 0 };
    a.m.handleInput(a.p, packet(i, direction));
    a.m.tick(); b.m.tick();
    same = same && a.p.x === b.p.x && a.p.y === b.p.y && a.p.vx === b.p.vx && a.p.vy === b.p.vy;
  }
  t.check(same, 'regular 20 Hz input keeps movement identical to direct controls on every tick');
  t.equal(a.m.world.time, b.m.world.time, 'input processing does not add or skip simulation time');
  t.equal(a.p.net.ack, 120, 'regular input acknowledges the frame just simulated');
  a.m.destroy(); b.m.destroy();
}

// Six delayed input frames arrive at once, ending with a release. The release should take effect on
// the next world tick, not after five more ticks of stale movement (250 ms of added delay).
{
  const a = game(), b = game();
  for (let i = 1; i <= 20; i++) {
    a.m.handleInput(a.p, packet(i, { mx: 1 }));
    b.m.handleInput(b.p, packet(i, { mx: 1 }));
    a.m.tick(); b.m.tick();
  }
  for (let i = 21; i <= 25; i++) a.m.handleInput(a.p, packet(i, { mx: 1, f: true, sc: true, iv: true }));
  a.m.handleInput(a.p, packet(26));
  b.m.handleInput(b.p, packet(26));
  a.m.tick(); b.m.tick();
  t.check(a.p.x === b.p.x && a.p.vx === b.p.vx, 'a delayed movement release takes effect on the very next tick');
  t.equal(a.p.net.ack, 26, 'acknowledgement catches up to the newest delayed input');
  const held = a.m.pullInput(a.p);
  t.check(held.mx === 0 && !held.fire && !held.scope && !held.iv, 'released movement, fire, scope and interact stay released between packets');
  let current = true;
  for (let i = 27; i <= 46; i++) {
    const controls = { mx: i % 2 ? -1 : 1, my: 0 };
    a.m.handleInput(a.p, packet(i, controls)); b.m.handleInput(b.p, packet(i, controls));
    a.m.tick(); b.m.tick();
    current = current && a.p.x === b.p.x && a.p.vx === b.p.vx && a.p.net.ack === i;
  }
  t.check(current, 'subsequent direction changes stay current instead of retaining the burst delay');
  a.m.destroy(); b.m.destroy();
}

// Transient actions in older packets survive coalescing, but are applied only once. Latest explicit
// selections win; a null selection means no new selection rather than erasing an earlier click.
{
  const { m, p } = game();
  m.handleInput(p, packet(1, { fp: true, r: true, sl: 0, ht: 0, cy: -1 }));
  m.handleInput(p, packet(2, { sw: true, u: true, ip: true, dp: true, sl: 1, ht: 2, cy: -2 }));
  m.handleInput(p, packet(3, { mx: -1, my: 1, a: Math.PI / 2, d: 700, f: true, sc: true, iv: true }));
  const now = m.pullInput(p);
  t.check(now.mx === -1 && now.my === 1 && now.fire && now.scope && now.iv, 'the newest movement and held controls win');
  t.near(now.aimX, p.x, 0.0001, 'aim uses the newest angle');
  t.near(now.aimY, p.y + 700, 0.0001, 'aim uses the newest distance');
  t.check(now.firePressed && now.reload && now.swap && now.utility && now.interactPressed && now.dropPressed, 'all one-shot button actions survive a delayed burst');
  t.check(now.slot === 1 && now.held === 2, 'latest explicit weapon and hotbar selections survive later empty packets');
  t.equal((p.slot + now.cycle + p.weapons.length * 4) % p.weapons.length,
    ((p.slot - 3) % p.weapons.length + p.weapons.length) % p.weapons.length, 'wheel steps retain their combined selection');
  const repeat = m.pullInput(p);
  t.check(!repeat.firePressed && !repeat.reload && !repeat.swap && !repeat.utility && !repeat.interactPressed && !repeat.dropPressed,
    'one-shot actions are not replayed when the next packet is late');
  t.check(repeat.slot === null && repeat.held === null && repeat.cycle === 0, 'selections and wheel steps are not replayed');

  for (let i = 4; i <= 30; i++) m.handleInput(p, packet(i, { cy: -3, fp: i === 4, ht: i === 4 ? 1 : null }));
  const flood = m.pullInput(p), slot = (p.slot + flood.cycle + p.weapons.length * 4) % p.weapons.length;
  t.check(flood.firePressed && flood.held === 1 && p.net.ack === 30, 'queue bounding also preserves presses and selections from a longer burst');
  t.check(slot >= 0 && slot < p.weapons.length && flood.cycle !== 0, 'a large wheel burst selects a valid weapon and still clears a held item');
  m.destroy();
}
// A coalesced release retains its own charge when a newer movement-only packet arrives.
{
  const { m, p } = game();
  m.handleInput(p, packet(1, { fp: true, ch: 0.75, u: true, uch: 0.375 }));
  m.handleInput(p, packet(2, { ch: 0, uch: 0 }));
  const shot = m.pullInput(p);
  t.check(shot.firePressed && shot.charge === 0.75 && shot.utility && shot.utilityCharge === 0.375,
    'network catch-up preserves each released projectile charge');
  const held = m.pullInput(p);
  t.check(!held.firePressed && !held.utility && held.charge === 0 && held.utilityCharge === 0,
    'released charge cannot repeat on later server ticks');
  m.handleInput(p, packet(3, { fp: true, ch: 99, u: true, uch: -1 }));
  const bounded = m.pullInput(p);
  t.check(bounded.charge === 0.75 && bounded.utilityCharge === 0, 'server bounds incoming charge to the allowed duration');
  m.handleInput(p, packet(4, { fp: true, ch: NaN, u: true, uch: '0.75' }));
  const invalid = m.pullInput(p);
  t.check(invalid.charge === 0 && invalid.utilityCharge === 0, 'malformed charge values become short throws');
  m.destroy();
}
t.done();
