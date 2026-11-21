// Exercise every configured firing sound through Web Audio, including upgraded IDs.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT, loadWarz, suite } from './harness.mjs';
const t = suite('weapon audio');
const sources = [], ramps = [];
const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime(value) { ramps.push(value); } });
function node(source = false) {
  const n = { gain: param(), frequency: param(), Q: param(), threshold: param(), ratio: param(),
    connect() {}, start(time) { n.started = true; n.startAt = time; }, stop(time) { n.stopAt = time; } };
  if (source) sources.push(n);
  return n;
}
let context;
class AudioContext {
  constructor() { context = this; this.currentTime = 1; this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
  createDynamicsCompressor() { return node(); }
  createGain() { return node(); }
  createBuffer() { return { getChannelData: () => new Float32Array(this.sampleRate) }; }
  createBufferSource() { return node(true); }
  createOscillator() { return node(true); }
  createBiquadFilter() { return node(); }
}
const sandbox = { AudioContext, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ['config', 'audio']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file + '.js'), 'utf8'), sandbox);
const W = sandbox.Warz;
W.Audio.play('purchase');
t.equal(sources.length, 0, 'purchase feedback waits for audio unlock');
W.Audio.unlock();
for (const weapon of Object.values(W.WEAPONS).filter(w => ['gun', 'flame', 'launcher', 'rocket', 'turret', 'melee', 'firegun'].includes(w.kind))) {
  context.currentTime += 1;
  const before = sources.length, gains = ramps.length;
  W.Audio.play(weapon.id, 0.75);
  const created = sources.slice(before);
  t.check(created.length > 0 && created.every(n => n.started && Number.isFinite(n.stopAt)), weapon.name + ' starts and stops actual audio sources');
  t.check(ramps.slice(gains).some(v => v > 0.01), weapon.name + ' has a nonzero audio envelope');
}
for (const name of ['melee', 'repair', 'gas', 'minePing']) {
  context.currentTime += 1;
  const count = sources.length;
  W.Audio.play(name, .5);
  t.check(sources.slice(count).length > 0 && sources.slice(count).every(n => n.started && Number.isFinite(n.stopAt)), name + ' feedback has bounded Web Audio sources');
}
let before = sources.length;
context.currentTime += 1;
const firstRamp = ramps.length;
W.Audio.play('purchase');
const chime = sources.slice(before);
t.check(chime.length > 0 && chime.every(n => n.started && n.stopAt > n.startAt && n.stopAt < context.currentTime + 0.35) &&
  chime.some(n => n.startAt > chime[0].startAt), 'purchase plays a short chime with staggered onsets');
const fullPeak = Math.max(...ramps.slice(firstRamp));
const nextRamp = ramps.length;
context.currentTime += 0.1;
W.Audio.play('purchase', 0.5);
t.check(fullPeak > 0.02 && Math.abs(Math.max(...ramps.slice(nextRamp)) - fullPeak / 2) < 0.001,
  'a second purchase during the first chime plays at the requested volume');
before = sources.length;
W.Audio.setMuted(true); context.currentTime += 1; W.Audio.play('shotgun2');
t.equal(sources.length, before, 'mute still suppresses upgraded firing sounds');
W.Audio.play('purchase');
t.equal(sources.length, before, 'mute suppresses purchase feedback');
W.Audio.setMuted(false); context.currentTime += 1;
W.Audio.play('minigun'); before = sources.length; context.currentTime += 0.05; W.Audio.play('minigun');
t.check(sources.length > before, 'minigun sound keeps up with its 20 rounds per second');

const client = loadWarz(['config', 'util', 'map', 'world', 'items', 'class-combat', 'online']);
const state = client.Online.start({ seed: 22, teamSize: 1, you: 1, time: 0, players: [
  { id: 1, name: 'Local', team: 1 }, { id: 2, name: 'Remote', team: 2 }
] });
for (const id of [1, 2]) {
  state.world.events = [];
  client.Online.applyEvent({ t: 'flame', id, x: 3000, y: 3000, a: 0, r: 300 });
  t.check(state.world.events.some(e => e.type === 'flame' && e.player.id === id), (id === 1 ? 'local' : 'remote') + ' online flamethrower produces the app audio event');
}
t.done();
