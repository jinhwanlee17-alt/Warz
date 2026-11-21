// Real upgrade rules and modal callbacks: stale choices must not strand a dismissed offer.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
const t = suite('Sentry choice recovery');

function fixture() {
  const W = loadWarz(), document = { activeElement: null };
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.style = { setProperty() {} }; this.hidden = false; }
    appendChild(e) { e.parent = this; this.children.push(e); }
    setAttribute() {}
    addEventListener() {}
    focus() { document.activeElement = this; }
    blur() { document.activeElement = null; }
    contains(e) { return e === this || this.children.some(child => child.contains(e)); }
    querySelector(sel) {
      if (sel === 'button') return this.querySelectorAll('button')[0];
      if (sel === '.modal-close') return this.closeButton;
      if (sel === '.sentry-upgrade-options') return this.grid;
      if (sel === '.sentry-upgrade-cost') return this.cost;
      if (sel === '.modal-note') return this.note;
    }
    querySelectorAll(sel) { return this.children.flatMap(child => [...(child.tag === sel ? [child] : []), ...child.querySelectorAll(sel)]); }
    set innerHTML(value) {
      this.closeButton = new Element('button'); this.grid = new Element('div');
      this.cost = new Element('p'); this.note = new Element('p');
      this.appendChild(this.closeButton); this.appendChild(this.cost); this.appendChild(this.grid); this.appendChild(this.note);
    }
    set textContent(value) { this.children = []; this.text = value; }
  }
  document.createElement = tag => new Element(tag); document.body = new Element('body');
  const sandbox = { Warz: W, document }; sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(new URL('../js/sentry-upgrade-ui.js', import.meta.url), 'utf8'), sandbox);
  const map = { seed: 15, size: W.CONFIG.worldSize, rocks: [], trees: [], bushes: [], buildings: [], crates: [], pickups: [], ponds: [], stations: [], towns: [], drops: [], vehicles: [], nextPickupId: 1 };
  const world = new W.World({ map, storm: false }), p = world.addPlayer({ classId: 'engineer', x: 5000, y: 5000, team: 1 });
  p.slot = 2; p.tokens = 30;
  const s = world.addStruct({ kind: 'sentry', item: 'sentry3', x: 5100, y: 5000, r: 22,
    hp: W.ITEMS.sentry3.hp, maxHp: W.ITEMS.sentry3.hp, owner: p.id, team: p.team });
  const match = { player: p, world }, result = { accepted: null, closes: 0 };
  W.SentryUpgradeUI.init({ onChoose(variant, nonce) { result.accepted = world.chooseSentryUpgrade(p, variant, nonce); }, onClose() { result.closes++; } });
  const ui = W.SentryUpgradeUI, root = document.body.children[0];
  function frame(fire = false) { world.updateEngineerWork(p, { fire }, .05); ui.tick(match); }
  frame(true);
  return { W, world, p, s, ui, root, match, frame, result };
}

{
  const a = fixture(), { p, s, ui, frame } = a, old = p.sentryChoice;
  t.check(ui.isOpen() && old.nonce > 0, 'first authoritative offer opens its menu with an identity');
  t.equal(a.root.grid.children.map(b => b.dataset.sentryVariant).join(), 'bullets,grenades,rockets,snowballs,fireballs,cannons', 'modal renders all six specialization buttons in stable order');
  s.hp -= 1; frame();
  t.check(!p.sentryChoice && !ui.isOpen(), 'damage invalidates an open choice even while the menu suppresses firing');
  s.hp = s.maxHp; frame(true);
  t.check(ui.isOpen() && p.sentryChoice.nonce > old.nonce, 'repairing the sentry permits a fresh visible offer');
  t.equal(p.sentryChoice.options.join(), old.options.join(), 'fresh offer identity preserves all six specialization options');
  a.root.grid.children[5].onclick();
  t.check(a.result.accepted && p.sentrySelection?.variant === 'cannons' && !p.sentryChoice && !ui.isOpen(), 'freshly displayed last Cannon option can still be accepted');
}
{
  const a = fixture(), { p, s, ui, frame, root } = a, old = p.sentryChoice;
  // The target changes after the menu frame but before the user click is handled.
  s.hp -= 1; root.grid.children[0].onclick();
  t.check(a.result.accepted === false && !p.sentryChoice && !p.sentrySelection && !ui.isOpen(), 'stale but offered click is rejected and clears its pending offer');
  // Another Engineer repairs it before this client sees an empty choice frame.
  s.hp = s.maxHp; frame(true);
  t.check(ui.isOpen() && p.sentryChoice.nonce > old.nonce, 'replacement offer opens even when no empty-choice frame was rendered');
  root.grid.children[0].onclick();
  t.check(a.result.accepted && !!p.sentrySelection, 'rejected click cannot permanently prevent a later valid selection');
}
{
  const a = fixture(), { p, ui, frame, root } = a, first = p.sentryChoice;
  root.closeButton.onclick();
  t.check(!ui.isOpen() && !p.sentryChoice && !p.sentrySelection, 'cancel closes the menu and removes pending server work');
  frame(true);
  t.check(ui.isOpen() && p.sentryChoice.nonce > first.nonce, 'immediately renewed offer can reopen after cancel');
  const offered = p.sentryChoice;
  t.equal(a.world.chooseSentryUpgrade(p, 'invalid-sentry'), false, 'unknown specialization remains invalid');
  t.check(p.sentryChoice === offered && ui.isOpen(), 'forged specialization cannot dismiss or replace a valid offer');
}
for (const reason of ['range', 'tokens', 'tier', 'destroyed', 'class', 'vehicle', 'downed', 'death']) {
  const a = fixture(), { p, s, world, ui, frame } = a;
  if (reason === 'range') p.x -= 400;
  if (reason === 'tokens') p.tokens = 29;
  if (reason === 'tier') s.item = 'sentry2';
  if (reason === 'destroyed') world.destroyStruct(s, null);
  if (reason === 'class') world.setClass(p, 'soldier', true);
  if (reason === 'vehicle') p.vehicle = 99;
  if (reason === 'downed') p.downed = true;
  if (reason === 'death') world.killPlayer(p, null, 'test');
  frame();
  t.check(!p.sentryChoice && !p.sentrySelection && !ui.isOpen(), reason + ': invalid offer closes while no fire input is present');
}
{
  const a = fixture(), old = a.p.sentryChoice.nonce;
  a.world.setClass(a.p, 'soldier', true); a.ui.tick(a.match);
  a.world.setClass(a.p, 'engineer', true); a.p.slot = 2; a.p.tokens = 30; a.frame(true);
  t.check(a.p.sentryChoice.nonce > old && a.ui.isOpen(), 'offer identities remain monotonic across class changes');
}
{
  const { p, s, world, root, frame, ui, result } = fixture();
  root.closeButton.onclick(); p.tokens = 0; world.addItem(p, 'engineerhammer2', 1); world.selectItem(p, 1);
  world.useHeld(p, { firePressed: true }); frame();
  t.check(ui.isOpen() && root.cost.text.includes('instant') && p.items[1]?.n === 1, 'instant variant picker shows the prepaid cost and keeps the hammer pending');
  const nonce = p.sentryChoice.nonce;
  root.closeButton.onclick(); world.useHeld(p, { firePressed: true }); frame();
  t.check(ui.isOpen() && !world.chooseSentryUpgrade(p, 'bullets', nonce), 'a canceled offer cannot spend a replacement hammer choice');
  s.hp--; frame();
  t.check(ui.isOpen() && p.sentryChoice?.instant && p.items[1]?.n === 1, 'a damaged sentry keeps its instant choice and the hammer remains pending');
  p.x -= 500; frame();
  t.check(!ui.isOpen() && !p.sentryChoice && p.items[1]?.n === 1, 'leaving the sentry cancels the instant choice without consuming the hammer');
  p.x += 500; world.useHeld(p, { firePressed: true }); frame();
  root.grid.children[5].onclick();
  t.check(result.accepted && s.item === 'sentry4cannons' && s.hp === s.maxHp && !p.items[1] && !p.sentryWork, 'the instant choice upgrades a damaged sentry to its full-health specialization');
}
t.done();
