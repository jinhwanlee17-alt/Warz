// Rebindable controls: defaults, labels, conflicts, reserved keys and persistence.
import { loadWarz, suite, MemoryStorage } from './harness.mjs';

const storage = new MemoryStorage();
const W = loadWarz(['config', 'controls'], { storage });
const t = suite('controls');
const Controls = W.Controls;

t.equal(Controls.bindings('fire').join(), 'Mouse1,', 'left click shoots');
t.equal(Controls.bindings('scope')[0], 'Mouse3', 'right click scopes');
t.equal(Controls.bindings('map')[0], 'KeyM', 'M opens the map');
t.equal(Controls.bindings('gear').join(), 'KeyF,KeyG', 'F and G use gear');
t.equal(Controls.bindings('interact')[0], 'KeyE', 'E opens stations');
t.equal(Controls.bindings('drop')[0], 'KeyQ', 'Q drops the held item stack');
t.equal(Controls.bindings('inventory')[0], 'Tab', 'Tab opens inventory');
t.equal(Controls.bindings('emotes')[0], 'KeyB', 'B opens the emote picker');
t.check(Controls.bindings('swap').every((key) => key === null), 'weapon swap no longer shares Q');
t.equal(Controls.bindings('up').join(), 'KeyW,ArrowUp', 'W and the up arrow move up');
t.check(!Controls.bindings('mute')[0] && !Controls.bindings('mute')[1], 'mute has no key by default');
t.equal(Controls.ACTIONS.filter((a) => a.group === 'Hotbar').length, 6, 'six configurable hotbar slots include Engineer extra item slot');
t.equal(['weapon1', 'weapon2', 'item1', 'item2', 'item3'].map((a) => Controls.primary(a)).join(','), '1,2,3,4,5', 'the five visible slots use consecutive keys');
t.check(!Controls.ACTIONS.some((a) => /^item(?:[4-9]|10)$/.test(a.id)), 'no hidden mini-hotbar bindings remain');

t.equal(Controls.label('KeyW'), 'W', 'label for a letter');
t.equal(Controls.label('Digit1'), '1', 'label for a digit');
t.equal(Controls.label('Mouse3'), 'Right click', 'label for the right mouse button');
t.equal(Controls.label('ArrowUp'), '↑', 'label for an arrow');
t.equal(Controls.label(null), '—', 'label for an empty slot');
t.equal(Controls.primary('fire'), 'Left click', 'primary label');

const fakeInput = (down, hit) => ({ down: (c) => c === down, hit: (c) => c === hit });
const ordinary = { classId: 'soldier', weapons: [{}, {}] }, engineer = { classId: 'engineer', weapons: [{}, {}, {}] };
t.equal(Controls.itemOrder(ordinary).join(), '0,1,2', 'ordinary classes keep their item order');
t.equal(Controls.itemOrder(engineer).join(), '1,2,0', 'Engineer moves only the original third hotbar slot to the end');
t.equal(Controls.weaponSlotHit(fakeInput(null, 'Digit3'), ordinary), null, 'ordinary slot three is not a weapon');
t.equal(Controls.itemSlotHit(fakeInput(null, 'Digit3'), ordinary), 0, 'ordinary slot three selects item zero');
t.equal(Controls.weaponSlotHit(fakeInput(null, 'Digit3'), engineer), 2, 'Engineer slot three selects the third class weapon');
t.equal(Controls.itemSlotHit(fakeInput(null, 'Digit3'), engineer), null, 'Engineer slot three cannot select an item too');
t.equal(Controls.itemSlotHit(fakeInput(null, 'Digit6'), engineer), 0, 'Engineer slot six selects the retained first item');
t.equal(Controls.itemSlotHit(fakeInput(null, 'Digit6'), ordinary), null, 'slot six does nothing for other classes');
t.equal([0, 1, 2].map(i => Controls.primary(Controls.weaponAction(engineer, i))).join(), '1,2,3', 'Engineer weapon labels follow physical controls');
t.equal(Controls.itemOrder(engineer).map(i => Controls.primary(Controls.itemAction(engineer, i))).join(), '4,5,6', 'Engineer item labels match physical display order');
t.check(Controls.hotbarChanged(fakeInput(null, 'Digit6'), engineer), 'moving to the sixth slot cancels a charged projectile');
t.equal(Controls.weaponSlotHit(fakeInput(null, 'Digit3'), { ...engineer, vehicle: 1 }), null, 'vehicle passengers cannot select the third class weapon');
const magicMedic = { classId: 'magicmedic', weapons: [{}, {}, {}] };
t.equal(Controls.weaponSlotHit(fakeInput(null, 'Digit3'), magicMedic), 2, 'Magic Medic slot three selects the permanent medkit');
t.equal(Controls.itemSlotHit(fakeInput(null, 'Digit3'), magicMedic), null, 'Magic Medic medkit does not also select an inventory item');
t.equal(Controls.itemSlotHit(fakeInput(null, 'Digit6'), magicMedic), 0, 'Magic Medic keeps the original slot-three item in slot six');
t.equal(Controls.itemOrder(magicMedic).map(i => Controls.primary(Controls.itemAction(magicMedic, i))).join(), '4,5,6', 'Magic Medic inventory labels match the six-slot order');
t.check(Controls.down(fakeInput('ArrowUp'), 'up'), 'secondary binding counts as held');
t.check(Controls.hit(fakeInput(null, 'KeyF'), 'gear'), 'primary binding counts as pressed');
t.check(!Controls.down(fakeInput('KeyX'), 'up'), 'unbound key does nothing');

t.equal(Controls.rebind('reload', 0, 'KeyT').length, 0, 'rebinding to a free key frees nothing');
t.equal(Controls.bindings('reload')[0], 'KeyT', 'reload is now T');
const freed = Controls.rebind('map', 0, 'KeyT');
t.equal(freed.join(), 'reload', 'binding T to the map takes it away from reload');
t.equal(Controls.bindings('reload')[0], null, 'reload lost T');
t.equal(Controls.bindings('map')[0], 'KeyT', 'map has T');
Controls.rebind('reload', 1, 'Escape');
t.equal(Controls.bindings('reload')[1], null, 'Escape cannot be bound');
Controls.rebind('reload', 0, null);
t.equal(Controls.bindings('reload')[0], null, 'a binding can be cleared');

const saved = JSON.parse(storage.getItem('warz.settings.v1'));
t.equal(saved.bindings.map[0], 'KeyT', 'bindings are saved to storage');
Controls.setMuted(true);
t.check(JSON.parse(storage.getItem('warz.settings.v1')).muted === true, 'mute preference is saved');
const again = loadWarz(['config', 'controls'], { storage }).Controls;
t.equal(again.bindings('map')[0], 'KeyT', 'a fresh load restores saved bindings');
t.check(again.muted(), 'a fresh load restores the mute preference');
again.reset();
t.equal(again.bindings('map')[0], 'KeyM', 'reset restores the defaults');
t.equal(again.bindings('reload')[0], 'KeyR', 'reset restores reload too');

storage.setItem('warz.settings.v1', '{not json');
const broken = loadWarz(['config', 'controls'], { storage }).Controls;
t.equal(broken.bindings('fire')[0], 'Mouse1', 'corrupt settings fall back to defaults');

storage.setItem('warz.settings.v1', JSON.stringify({ bindings: { weapon1: ['KeyZ', null], item1: ['KeyX', null], item3: ['KeyC', null], item10: ['Equal', null] }, muted: true }));
const legacy = loadWarz(['config', 'controls'], { storage }).Controls;
t.check(legacy.primary('weapon1') === 'Z' && legacy.primary('item1') === 'X' && legacy.primary('item3') === 'C', 'existing custom weapon and retained item bindings survive the five-slot update');
t.check(!Object.hasOwn(legacy.all(), 'item10') && legacy.muted(), 'obsolete slot bindings are ignored without resetting other settings');

storage.setItem('warz.settings.v1', JSON.stringify({ bindings: { swap: ['KeyQ', null], reload: ['KeyT', null], map: ['KeyN', null] }, muted: true }));
const migrated = loadWarz(['config', 'controls'], { storage }).Controls;
t.check(migrated.primary('drop') === 'Q' && migrated.bindings('swap').every((key) => key === null), 'old default Q swap migrates to drop without triggering both');
t.check(migrated.primary('reload') === 'T' && migrated.primary('map') === 'N' && migrated.muted(), 'migration retains other controls and sound settings');
t.check(JSON.parse(storage.getItem('warz.settings.v1')).bindings.drop[0] === 'KeyQ', 'new action bindings are saved after migration');
migrated.rebind('drop', 0, 'KeyJ');
const customDrop = loadWarz(['config', 'controls'], { storage }).Controls;
t.equal(customDrop.primary('drop'), 'J', 'a chosen drop binding survives later loads');

storage.setItem('warz.settings.v1', JSON.stringify({ bindings: { swap: ['KeyV', 'KeyQ'], reload: ['KeyQ', 'KeyT'], map: ['Tab', null] } }));
const customLegacy = loadWarz(['config', 'controls'], { storage }).Controls;
t.check(customLegacy.primary('drop') === 'Q' && customLegacy.bindings('swap').join() === 'KeyV,' && customLegacy.bindings('reload').join() === ',KeyT', 'legacy Q assignments move to drop while preserving each action\'s other key');
t.check(customLegacy.primary('map') === 'Tab' && customLegacy.primary('inventory') === 'I', 'inventory uses free I when a custom control already owns Tab');

storage.setItem('warz.settings.v1', JSON.stringify({ bindings: { drop: ['KeyJ', null], inventory: ['KeyB', null], swap: ['KeyQ', null] } }));
const current = loadWarz(['config', 'controls'], { storage }).Controls;
t.check(current.primary('drop') === 'J' && current.primary('inventory') === 'B' && current.primary('swap') === 'Q', 'saves already defining the new actions keep their explicit choices');
t.check(current.bindings('emotes').every(key => key === null), 'adding emotes does not steal a saved B binding');

storage.setItem('warz.settings.v1', JSON.stringify({ bindings: { reload: ['Digit6', null] } }));
const sixConflict = loadWarz(['config', 'controls'], { storage }).Controls;
t.check(sixConflict.bindings('slot6').every(key => key === null) && sixConflict.primary('reload') === '6', 'sixth hotbar migration preserves an existing custom Digit6 binding');
sixConflict.rebind('slot6', 0, 'KeyJ');
t.equal(sixConflict.itemSlotHit(fakeInput(null, 'KeyJ'), engineer), 0, 'Engineer item zero follows a rebound sixth-slot action');
t.equal(sixConflict.primary(sixConflict.itemAction(engineer, 0)), 'J', 'Engineer HUD label follows the rebound action');

t.done();
