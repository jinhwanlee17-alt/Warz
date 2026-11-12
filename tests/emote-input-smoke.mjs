// The small emote panel consumes its own shortcuts, preserving unrelated held gameplay inputs.
import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, suite } from './harness.mjs';
const W = loadWarz(['config', 'controls']), t = suite('emote input');
const events = {}, canvasEvents = {};
const sandbox = { Warz: W, performance, innerWidth: 1200, innerHeight: 800, addEventListener: (type, fn) => { events[type] = fn; } };
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../js/input.js', import.meta.url), 'utf8'), sandbox);
const input = new W.Input({ addEventListener: (type, fn) => { canvasEvents[type] = fn; } }); input.capture = true;
const key = (code, repeat = false) => events.keydown({ code, repeat, preventDefault() {} });
key('KeyA'); key('ShiftLeft'); canvasEvents.mousedown({ button: 0 });
const fireAt = input.heldAt.Mouse1, moveAt = input.heldAt.KeyA;
for (const code of ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyB', 'Escape']) {
  key(code); t.check(input.hit(code) && input.down(code), code + ' is available for a fresh panel shortcut');
  const keepDown = code === 'KeyW', at = input.heldAt[code]; input.wheel = 1;
  input.consume(code, keepDown);
  t.check(!input.hit(code) && !input.lift(code) && input.wheel === 1, code + ' consumes only its own edges without touching wheel or inventing release');
  t.equal(input.down(code), keepDown, code + ' retains a movement hold but suppresses action shortcuts');
  if (keepDown) t.equal(input.heldAt[code], at, 'W selection retains its original hold duration');
  t.check(input.down('KeyA') && input.down('ShiftLeft') && input.down('Mouse1') && input.heldAt.Mouse1 === fireAt && input.heldAt.KeyA === moveAt,
    code + ' leaves existing walking, sprinting and firing intact');
  key(code, true);
  t.check(!input.hit(code) && input.down(code) === keepDown, code + ' auto-repeat cannot repeat an emote or leak a discrete gameplay action');
  events.keyup({ code }); key(code);
  t.check(input.down(code) && input.hit(code), code + ' resumes its normal action after a physical release and new press');
  events.keyup({ code }); input.endFrame();
}
// A charged launcher is still armed through opening, selecting, and closing the panel.
input.release(); canvasEvents.mousedown({ button: 0 });
input.heldAt.Mouse1 = performance.now() - 500;
const charge = W.Controls.createChargeTracker();
let sample = charge.sample(input, 'fire', 'launcher', true);
t.check(sample.held && sample.seconds >= .49, 'launcher charge is initially armed by the real mouse press');
input.endFrame();
for (const code of ['KeyB', 'KeyQ', 'Escape']) {
  key(code); input.consume(code);
  sample = charge.sample(input, 'fire', 'launcher', true);
  t.check(sample.held && !sample.released && sample.seconds >= .49, code + ' does not cancel or release the unrelated launcher charge');
  events.keyup({ code }); input.endFrame();
}
events.mouseup({ button: 0 }); sample = charge.sample(input, 'fire', 'launcher', true);
t.check(sample.released && sample.seconds >= .49, 'the physical mouse release still fires the preserved charged shot');
// Repeated selection edges are suppressed, but focus loss must never strand a control.
key('KeyQ'); input.consume('KeyQ'); events.blur(); key('KeyQ');
t.check(input.hit('KeyQ') && input.down('KeyQ'), 'focus loss clears temporary per-key suppression');
t.done();