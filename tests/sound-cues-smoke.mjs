import fs from 'node:fs';
import vm from 'node:vm';
import { loadWarz, ROOT, suite } from './harness.mjs';
const W = loadWarz(['config', 'sound-cues']);
const t = suite('directional sounds'), S = W.SoundCues, p = { id: 1, x: 5000, y: 5000, r: 24 }, world = { players: [] };
const remote = { id: 2, x: 5300, y: 5400, alive: true };
const shot = (x, y, id = 2) => ({ type: 'shot', player: { id, x, y }, x, y });
const sounds = [];
W.Audio = { play: (id, volume) => sounds.push({ id, volume }) };
t.equal(S.range(), W.ITEMS.snowbomb.radius * 7, 'audible radius spans seven snowbomb radii');
t.equal(S.volume(p, p.x, p.y), 1, 'sound at the listener is full volume');
t.equal(S.volume(p, p.x + S.range(), p.y), 0, 'sound ends at the radius');
t.equal(S.volume(p, p.x + S.range() + 1, p.y), 0, 'no volume outside the radius');
t.equal(S.volume(p, NaN, p.y), 0, 'invalid source cannot produce a spatial sound');

S.process(world, p, [shot(remote.x, remote.y)]);
let cues = S.snapshot(p);
t.equal(cues.length, 1, 'a remote gunshot produces one bearing');
t.equal(cues[0].label, 'Gunfire', 'bearing identifies the action');
t.near(cues[0].rotation, 143.130102, .00001, 'arrow points at the exact non-cardinal direction');
t.near(cues[0].distance, 500, .00001, 'distance uses both map axes');
const firstColour = cues[0].colour;
S.process(world, p, [shot(remote.x + 20, remote.y + 30), shot(remote.x + 25, remote.y + 35)]);
t.equal(S.snapshot(p).length, 1, 'automatic fire from one source updates one cue');
t.equal(S.snapshot(p)[0].x, remote.x + 25, 'burst deduplication retains the latest source location');
const moved = { ...p, x: remote.x + 25, y: remote.y + 235 };
t.near(S.snapshot(moved)[0].rotation, 0, .00001, 'bearing follows the listener as they move past a source');
t.check(S.snapshot(moved)[0].colour !== firstColour, 'proximity colour follows listener movement');
S.update(world, p, 1.3);
t.check(S.snapshot(p)[0].opacity > 0 && S.snapshot(p)[0].opacity < 1, 'old cue fades smoothly before expiry');
S.update(world, p, .6);
t.equal(S.snapshot(p).length, 0, 'old sounds disappear without further events');

S.clear();
S.process(world, p, [shot(p.x, p.y, p.id), shot(p.x + S.range(), p.y), shot(p.x + S.range() + 100, p.y)]);
t.equal(S.snapshot(p).length, 0, 'self sounds and sounds at or beyond the boundary produce no arrows');
const half = S.range() / 2;
S.process(world, p, [shot(p.x + half, p.y)]);
const halfColour = S.snapshot(p)[0].colour;
t.equal(halfColour, 'rgb(163,114,163)', 'middle distance blends red and blue rather than selecting a discrete colour');
t.check(S.colour(half - 10) !== halfColour && S.colour(half + 10) !== halfColour, 'small distance changes make small colour changes');
t.equal(S.colour(0), 'rgb(255,78,70)', 'nearest end of the scale is red');
t.equal(S.colour(S.range()), 'rgb(70,150,255)', 'farthest end of the scale is blue');

S.clear();
S.process(world, p, Array.from({ length: 20 }, (_, i) => shot(p.x + 50 + i * 100, p.y + 40, i + 2)));
t.equal(S.snapshot(p).length, 6, 'busy battles keep at most six readable arrows');
S.update({ players: [] }, p, .1);
t.equal(S.snapshot(p).length, 0, 'entering a different match drops old sound cues');

S.clear(); sounds.length = 0;
S.process(world, p, [{ type: 'sound', kind: 'repair', x: p.x + 1000, y: p.y, source: 5, sound: 'repair' }]);
t.equal(S.snapshot(p)[0].label, 'Repairing', 'lightweight server sound packet produces a labelled bearing');
t.check(sounds.length === 1 && sounds[0].id === 'repair' && sounds[0].volume > 0, 'far visible-range sound packets play attenuated audio');
S.process(world, p, [{ type: 'sound', kind: 'repair', x: p.x + 1000, y: p.y, source: 5, sound: 'repair' }]);
t.equal(sounds.length, 1, 'repeated continuous sound packets are throttled');
S.process(world, p, [{ type: 'sound', kind: 'heal', x: p.x + S.range() + 1, y: p.y, source: 6, sound: 'heal' }]);
t.equal(sounds.length, 1, 'out-of-range network sound packets remain silent');

S.clear(); sounds.length = 0;
const builder = { ...remote, sentryBuild: { x: 5350, y: 5400 } }, repairer = { id: 3, x: 4800, y: 5100, alive: true, repairVehicle: 1 };
const working = { players: [builder, repairer] };
S.update(working, p, .1);
t.equal(S.snapshot(p).map(c => c.label).sort().join(), 'Building,Repairing', 'continuous construction and vehicle repair produce cues before completion');
t.equal(sounds.length, 2, 'quiet ongoing work has spatial audio');
S.update(working, p, .1);
t.equal(sounds.length, 2, 'continuous work does not play a sound every frame');
builder.hidden = true; repairer.alive = false; S.update(working, p, 2);
t.equal(S.snapshot(p).length, 0, 'stale hidden players and stopped work do not leak ongoing location');

S.clear(); sounds.length = 0;
S.process(world, p, [
  { type: 'heal', player: remote, by: remote, item: 'magicmedkit' },
  { type: 'throw', player: { id: 3, x: 4900, y: 5400 } },
  { type: 'struct', op: 'repair', struct: { id: 7, x: 5200, y: 4800 } }
]);
t.equal(S.snapshot(p).map(c => c.label).sort().join(), 'Grenade,Healing,Repairing', 'healing, grenades and structure repair are detectable');
t.check(sounds.some(s => s.id === 'heal') && sounds.some(s => s.id === 'throw') && sounds.some(s => s.id === 'repair'), 'remote healing, throwing and sentry repair have audible feedback');
S.clear(); sounds.length = 0;
S.process(world, p, [{ type: 'artillery-shell', op: 'spawn', shell: { owner: 2, startX: 5600, startY: 5200 } }]);
t.check(S.snapshot(p)[0].label === 'Artillery' && sounds.length === 1 && sounds[0].id === 'launcher', 'artillery launch creates a precise cue and audible firing sound');
S.process(world, p, [{ type: 'artillery-shell', op: 'impact', x: 5500, y: 5100 }]);
t.equal(sounds.length, 1, 'shell impact waits for the normal explosion event instead of double-playing');
S.clear(); sounds.length = 0;
S.process(world, p, [{ type: 'artillery-shell', op: 'spawn', player: p, x: p.x, y: p.y, shell: { owner: p.id } }]);
t.check(sounds.length === 1 && S.snapshot(p).length === 0, 'own artillery still sounds at the listener without a meaningless self arrow');

// Exercise the actual DOM renderer without a browser or Web Audio dependency.
function element(tag) {
  return { tag, children: [], style: {}, dataset: {}, hidden: false, textContent: '',
    setAttribute() {}, appendChild(child) { this.children.push(child); child.parent = this; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); } };
}
const root = element('aside'), list = element('div');
const document = { getElementById: id => id === 'sound-cues' ? root : id === 'sound-cues-list' ? list : null, createElement: element };
const sandbox = { Warz: { ITEMS: W.ITEMS, Audio: W.Audio }, document }; sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(ROOT + '/js/sound-cues.js', 'utf8'), sandbox);
const domS = sandbox.Warz.SoundCues;
domS.process(world, p, [shot(5300, 5400)]); domS.update(world, p, 0);
t.check(!root.hidden && list.children.length === 1, 'new cue displays a compact DOM row');
t.equal(list.children[0].children[1].textContent, 'Gunfire', 'DOM uses action text rather than interpreting markup');
t.equal(list.children[0].children[0].style.transform, 'rotate(143.13deg)', 'DOM arrow uses a precise bearing');
t.check(list.children[0].style.color.startsWith('rgb('), 'DOM arrow and text share the computed proximity colour');
domS.update(world, p, 2);
t.check(root.hidden && list.children.length === 0, 'empty widget hides and removes expired rows');
domS.process(world, p, [shot(5300, 5400)]); domS.update(world, p, 0); domS.clear();
t.check(root.hidden && list.children.length === 0, 'leaving a match clears its DOM cues');
t.done();
