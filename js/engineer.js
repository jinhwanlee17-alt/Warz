/* Engineer hammer: repair friendly sentries and build paid upgrades authoritatively. */
(function () {
  'use strict';
  var W = window.Warz, World = W.World, E = W.ENGINEER, U = W.U;
  var baseUpdate = World.prototype.updateClassCombat, baseTrigger = World.prototype.trigger;
  World.prototype.engineerReady = function (p, instant) {
    if (!p || p.classId !== 'engineer' || !p.alive || p.downed || p.mount || p.vehicle || p.dropT > 0) return false;
    return instant ? this.heldItem(p) === W.ITEMS.engineerhammer2 : p.held < 0 && p.weapons[p.slot].id === 'engineerhammer';
  };
  World.prototype.engineerCanReach = function (p, s, instant) {
    return this.engineerReady(p, instant) && s && s.alive && s.kind === 'sentry' && s.team === p.team &&
      Math.hypot(p.x - s.x, p.y - s.y) - s.r <= E.reach && this.lineClear(p.x, p.y, s.x, s.y, s);
  };
  World.prototype.engineerTarget = function (p, instant) {
    var self = this, best = null, distance = Infinity;
    this.structures.forEach(function (s) {
      var d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < distance && self.engineerCanReach(p, s, instant) && Math.abs(U.angleDiff(p.angle, Math.atan2(s.y - p.y, s.x - p.x))) <= 0.8) { best = s; distance = d; }
    });
    return best;
  };
  World.prototype.engineerCanChooseSentry = function (p, s, instant) {
    return this.engineerCanReach(p, s, instant) && s.item === 'sentry3' && (instant || (s.hp >= s.maxHp && p.tokens >= E.finalCost));
  };
  function nextSentryTier(s) {
    return s.item === 'sentry' ? 'sentry2' : s.item === 'sentry2' ? 'sentry3' : null;
  }
  function offerSentryVariants(p, s, instant) {
    if (p.sentryChoice && p.sentryChoice.struct === s.id && !!p.sentryChoice.instant === instant) return;
    p.sentryChoiceVersion = (p.sentryChoiceVersion || 0) + 1;
    p.sentryChoice = { struct: s.id, options: Object.keys(W.SENTRY_IV), nonce: p.sentryChoiceVersion };
    if (instant) p.sentryChoice.instant = true;
  }
  function finishUpgrade(world, p, s, next) {
    s.item = next; s.maxHp = W.ITEMS[next].hp; s.hp = s.maxHp; s.cooldown = 0;
    p.sentryWork = null; p.sentryChoice = null; p.sentrySelection = null;
    world.emit({ type: 'struct', op: 'upgrade', struct: s, source: p.id });
  }
  World.prototype.useInstantSentryHammer = function (p) {
    if (this.remote) return false;
    var s = this.engineerTarget(p, true);
    if (!s || (!nextSentryTier(s) && s.item !== 'sentry3')) {
      this.emit({ type: 'deny', player: p, reason: p.classId === 'engineer' ? 'sentrytarget' : 'engineeronly' });
      return false;
    }
    if (s.item === 'sentry3') {
      offerSentryVariants(p, s, true);
      return false; // The choice commits the upgrade and consumes the hammer.
    }
    finishUpgrade(this, p, s, nextSentryTier(s));
    return true;
  };
  World.prototype.chooseSentryUpgrade = function (p, variant, nonce) {
    if (this.remote) return false;
    var choice = p.sentryChoice, s = choice && this.structById(choice.struct);
    if (nonce !== undefined && (!choice || choice.nonce !== nonce)) return false;
    if (variant === null) { p.sentryChoice = null; p.sentrySelection = null; return true; }
    if (!choice || choice.options.indexOf(variant) < 0 || !W.SENTRY_IV[variant]) return false;
    // A valid offer can become stale between drawing the menu and receiving the
    // selection. Clear it so retrying gets a new identity, even on a slow link.
    if (!this.engineerCanChooseSentry(p, s, choice.instant)) { p.sentryChoice = null; p.sentrySelection = null; return false; }
    if (choice.instant) {
      finishUpgrade(this, p, s, W.SENTRY_IV[variant].item);
      return this.finishItemUse(p, p.held, 'engineerhammer2');
    }
    p.sentrySelection = { struct: s.id, variant: variant }; p.sentryChoice = null;
    return true;
  };
  World.prototype.updateEngineerWork = function (p, intent, dt) {
    if (this.remote) return;
    var changing = intent.cycle || intent.swap || intent.interactPressed || intent.dropPressed ||
      (intent.slot !== null && intent.slot !== undefined && intent.slot !== p.slot) || (intent.held !== null && intent.held !== undefined && intent.held >= 0);
    if (p.sentryChoice && p.sentryChoice.instant) {
      if (changing || !this.engineerCanChooseSentry(p, this.structById(p.sentryChoice.struct), true)) p.sentryChoice = null;
      return;
    }
    if (!this.engineerReady(p) || changing) { p.sentryWork = null; p.sentryChoice = null; p.sentrySelection = null; return; }
    if (p.sentryChoice && !this.engineerCanChooseSentry(p, this.structById(p.sentryChoice.struct))) {
      p.sentryChoice = null; p.sentrySelection = null;
    }
    var locked = p.sentrySelection;
    if (locked && !this.engineerCanReach(p, this.structById(locked.struct))) { p.sentryChoice = null; p.sentrySelection = null; }
    if (!(intent.fire || intent.firePressed)) { p.sentryWork = null; return; }
    var s = this.engineerTarget(p);
    if (!s) { p.sentryWork = null; return; }
    if (s.hp < s.maxHp - 0.000001) {
      p.sentryChoice = null;
      var repair = p.sentryWork && p.sentryWork.kind === 'repair' && p.sentryWork.struct === s.id ? p.sentryWork : { struct: s.id, kind: 'repair', elapsed: 0, total: 0, cost: 0 };
      var amount = Math.min(s.maxHp - s.hp, E.repairRate * dt);
      s.hp += amount; repair.elapsed += dt; p.sentryWork = repair;
      if (repair.elapsed >= 0.2 - 1e-8 || s.hp >= s.maxHp) { repair.elapsed = 0; this.emit({ type: 'struct', op: 'repair', struct: s }); }
      p.meleeSwing = 0.12; p.meleeAngle = p.angle;
      return;
    }
    var next = nextSentryTier(s);
    var cost = E.upgradeCost, seconds = E.upgradeSeconds, variant = null;
    if (s.item === 'sentry3') {
      cost = E.finalCost; seconds = E.finalSeconds;
      var selected = p.sentrySelection && p.sentrySelection.struct === s.id && W.SENTRY_IV[p.sentrySelection.variant];
      if (!selected) {
        p.sentryWork = null;
        if (p.tokens < cost) { if (intent.firePressed) this.emit({ type: 'deny', player: p, reason: 'tokens', value: cost - p.tokens }); return; }
        offerSentryVariants(p, s, false);
        return;
      }
      next = selected.item; variant = p.sentrySelection.variant;
    }
    if (!next || p.tokens < cost) {
      p.sentryWork = null;
      if (next && intent.firePressed) this.emit({ type: 'deny', player: p, reason: 'tokens', value: cost - p.tokens });
      return;
    }
    var work = p.sentryWork;
    if (!work || work.kind !== 'upgrade' || work.struct !== s.id || work.next !== next) work = { struct: s.id, kind: 'upgrade', next: next, variant: variant, elapsed: 0, total: seconds, cost: cost };
    p.sentryWork = work; work.elapsed += dt; p.meleeSwing = 0.12; p.meleeAngle = p.angle;
    if (work.elapsed + 1e-8 < seconds) return;
    p.tokens -= cost;
    finishUpgrade(this, p, s, next);
  };
  World.prototype.updateClassCombat = function (p, intent, dt) {
    baseUpdate.call(this, p, intent, dt); this.updateEngineerWork(p, intent, dt);
  };
  World.prototype.trigger = function (p, intent) {
    if (this.engineerReady(p) && this.engineerTarget(p)) return true;
    return baseTrigger.call(this, p, intent);
  };
  ['setClass', 'downPlayer', 'killPlayer', 'enterVehicle', 'mountTurret'].forEach(function (name) {
    var base = World.prototype[name];
    World.prototype[name] = function (p) { p.sentryWork = null; p.sentryChoice = null; p.sentrySelection = null; return base.apply(this, arguments); };
  });
}());
