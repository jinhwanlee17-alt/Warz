// What the level-three classes need beyond a gun to fight with (their guns are in bot-combat.mjs's tables, the Magic
// Medic's kit is in bot-items.mjs): an Engineer builds and upgrades sentries when things are quiet, a Shield Operator
// turns its explosive shield toward a blast it cannot outrun, and anyone left holding a tool goes back to a gun.
import { Bot, TAU } from './bot.mjs';
import { BANDS } from './bot-combat.mjs';

Object.assign(Bot.prototype, {
  slotOfWeapon(id) { return this.p.weapons.findIndex((w) => w.id === id); },

  // ---------------------------------------------------------------- Engineer
  // Quiet, safe, and fewer than two sentries of our own standing: time to build one (ten seconds with the wrench).
  pickBuild() {
    const p = this.p, now = this.now;
    if (p.classId !== 'engineer') return false;
    if (this.build) { if (this.mode === 'build') return true; this.build = null; }       // (interrupted: start over later)
    if (now < this.buildAt || this.target || now - this.hurtAt < 5 || now - this.lastEnemyAt < 4 || this.storm.soon || this.evade || !this.inSafe(p.x, p.y, 150)) return false;
    let mine = 0;
    for (const s of this.world.structures) if (s.alive && s.kind === 'sentry' && s.owner === p.id) mine++;
    if (mine >= 2) { this.buildAt = now + 30; return false; }
    const a = this.vrng.range(0, TAU), spot = this.structSpot('sentry', Math.cos(a), Math.sin(a));
    if (!spot) { this.buildAt = now + 10; return false; }
    this.build = { phase: 'build', spot, until: now + 45, began: 0, heldAt: 0, tries: 0, sentry: null };
    return true;
  },
  doBuild() {
    const B = this.build, p = this.p, now = this.now, out = this.out, E = this.W.ENGINEER;
    const done = (wait) => { this.build = null; this.buildAt = now + wait; this.redecide = true; };
    if (!B || p.classId !== 'engineer' || now > B.until) return done(20);
    this.still = true; this.freeze = true;
    if (B.phase === 'build') {
      const wrench = this.slotOfWeapon('wrench');
      if (wrench < 0) return done(60);
      if (p.slot !== wrench) { if (now >= this.swapAt) { out.slot = wrench; this.swapAt = now + 0.4; } return; }
      this.clickAt = B.spot; out.fire = true;                       // hold the button: the wrench does the rest
      if (!B.heldAt) B.heldAt = now;
      if (p.sentryBuild) { B.began = now; return; }
      if (B.began) {
        // The bar filled (or something broke it off): is there a sentry of ours where we were building?
        const s = this.world.structures.find((x) => x.alive && x.kind === 'sentry' && x.owner === p.id && Math.hypot(x.x - B.spot.x, x.y - B.spot.y) < 60);
        if (!s) return done(15);
        B.sentry = s; B.phase = 'upgrade'; B.until = now + 20;
      } else if (now - B.heldAt > 0.6) {
        // Refused (no room there): try another spot, a few times.
        const a = this.vrng.range(0, TAU), spot = ++B.tries <= 3 ? this.structSpot('sentry', Math.cos(a), Math.sin(a)) : null;
        if (!spot) return done(20);
        B.spot = spot; B.heldAt = 0;
      }
      return;
    }
    // With tokens to spare, hammer it up a level (eight tokens and eight seconds each, as far as Sentry III).
    const s = B.sentry, hammer = this.slotOfWeapon('engineerhammer');
    if (!s || !s.alive || hammer < 0 || s.item === 'sentry3' || p.tokens < E.upgradeCost || this.dist(s) - s.r > E.reach) return done(this.vrng.range(45, 90));
    if (p.slot !== hammer) { if (now >= this.swapAt) { out.slot = hammer; this.swapAt = now + 0.4; } return; }
    this.clickAt = { x: s.x, y: s.y }; out.fire = true;
  },

  // ---------------------------------------------------------------- everyone
  // Runs after the mode's own work each tick.
  classPlay() {
    const p = this.p, now = this.now, out = this.out;
    if (this.act || p.held >= 0 || this.mode === 'build') return;
    if (p.classId === 'shieldoperator') {
      // A grenade or shell it will not get clear of: the red shield stops those from the front.
      const ev = this.evade, shield = this.slotOfWeapon('explosiveshield'), h = ev && ev.h;
      if (shield >= 0 && h && (h.kind === 'grenade' || h.kind === 'blast' || h.kind === 'flashbang') && h.eta < 1.1 && (ev.cant || h.eta < 0.5)) {
        if (p.slot !== shield) out.slot = shield;
        this.shoot = null; this.look = { x: h.x, y: h.y };
        this.shieldUntil = now + 0.35;
        return;
      }
    }
    // Left holding a tool (a wrench, a staff, the red shield) with no use for it: back to a gun.
    if (now < (this.shieldUntil || 0) || BANDS[p.weapons[p.slot].id] || now < this.swapAt || out.slot !== null) return;
    for (let i = 0; i < p.weapons.length; i++) if (BANDS[p.weapons[i].id]) { out.slot = i; this.swapAt = now + 0.6; return; }
  }
});
