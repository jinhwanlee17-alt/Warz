/* warz.io: rebindable controls. Each action has a primary and a secondary binding (key code or Mouse1/2/3).
   Saved in the browser under warz.settings.v1. No DOM access, so the Node tests can load it. */
(function () {
  'use strict';
  var W = window.Warz;
  var STORE = 'warz.settings.v1';

  var ACTIONS = W.ACTIONS = [
    { id: 'up', name: 'Move up', group: 'Movement' },
    { id: 'down', name: 'Move down', group: 'Movement' },
    { id: 'left', name: 'Move left', group: 'Movement' },
    { id: 'right', name: 'Move right', group: 'Movement' },
    { id: 'sprint', name: 'Sprint (hold)', group: 'Movement' },
    { id: 'fire', name: 'Shoot', group: 'Combat' },
    { id: 'scope', name: 'Scope (Sniper / Rocketeer: hold to zoom out)', group: 'Combat' },
    { id: 'gear', name: 'Use gear (heal / grenade / radar / repair)', group: 'Combat' },
    { id: 'reload', name: 'Reload', group: 'Combat' },
    { id: 'weapon1', name: 'Hotbar slot 1 (weapon)', group: 'Hotbar' },
    { id: 'weapon2', name: 'Hotbar slot 2 (weapon / class gear)', group: 'Hotbar' },
    { id: 'swap', name: 'Swap weapon', group: 'Combat' },
    { id: 'drop', name: 'Drop held item stack', group: 'Combat' },
    { id: 'interact', name: 'Pick up item / station / revive / mount', group: 'World' },
    { id: 'inventory', name: 'Inventory', group: 'World' },
    { id: 'emotes', name: 'Emote picker', group: 'World' },
    { id: 'map', name: 'Island map', group: 'World' },
    { id: 'mute', name: 'Mute sound', group: 'World' },
    { id: 'item1', name: 'Hotbar slot 3 (item / third class tool)', group: 'Hotbar' },
    { id: 'item2', name: 'Hotbar slot 4 (item)', group: 'Hotbar' },
    { id: 'item3', name: 'Hotbar slot 5 (item)', group: 'Hotbar' },
    { id: 'slot6', name: 'Hotbar slot 6 (with three class tools)', group: 'Hotbar' }
  ];
  var DEFAULTS = W.DEFAULT_BINDINGS = {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', null],
    fire: ['Mouse1', null], scope: ['Mouse3', null], gear: ['KeyF', 'KeyG'], reload: ['KeyR', null],
    weapon1: ['Digit1', null], weapon2: ['Digit2', null], swap: [null, null], drop: ['KeyQ', null],
    interact: ['KeyE', null], inventory: ['Tab', null], emotes: ['KeyB', null], map: ['KeyM', null], mute: [null, null],
    item1: ['Digit3', null], item2: ['Digit4', null], item3: ['Digit5', null], slot6: ['Digit6', null]
  };
  var NAMES = {
    Mouse1: 'Left click', Mouse2: 'Middle click', Mouse3: 'Right click', Mouse4: 'Mouse 4', Mouse5: 'Mouse 5',
    Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
    AltLeft: 'L Alt', AltRight: 'R Alt', Tab: 'Tab', Enter: 'Enter', CapsLock: 'Caps Lock',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
    Slash: '/', Backslash: '\\', Backquote: '`'
  };
  var settings = fresh();

  function fresh() { return { bindings: clone(DEFAULTS), muted: false }; }
  function clone(b) {
    var out = {};
    Object.keys(b).forEach(function (k) { out[k] = b[k].slice(); });
    return out;
  }
  function store() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
  function valid(code) { return typeof code === 'string' && /^[A-Za-z0-9]{1,32}$/.test(code) && code !== 'Escape' ? code : null; }

  function load() {
    settings = fresh();
    var s = store();
    if (!s) return settings;
    var migrated = false;
    try {
      var saved = JSON.parse(s.getItem(STORE) || 'null');
      if (saved && saved.bindings) {
        ACTIONS.forEach(function (a) {
          var b = saved.bindings[a.id];
          if (Array.isArray(b)) settings.bindings[a.id] = [valid(b[0]), valid(b[1])];
        });
        // Q now drops the selected item. Migrate legacy assignments once; retain every other key.
        if (!Array.isArray(saved.bindings.drop)) {
          ACTIONS.forEach(function (a) {
            if (a.id !== 'drop') settings.bindings[a.id] = settings.bindings[a.id].map(function (code) { return code === 'KeyQ' ? null : code; });
          });
          settings.bindings.drop = ['KeyQ', null];
          migrated = true;
        }
        if (!Array.isArray(saved.bindings.inventory)) {
          var free = function (code) { return !ACTIONS.some(function (a) { return a.id !== 'inventory' && settings.bindings[a.id].indexOf(code) >= 0; }); };
          settings.bindings.inventory = [free('Tab') ? 'Tab' : free('KeyI') ? 'KeyI' : null, null];
          migrated = true;
        }
        if (!Array.isArray(saved.bindings.sprint)) {
          // Keep custom controls intact when introducing sprint to an older save.
          var sprintFree = function (code) { return !ACTIONS.some(function (a) { return a.id !== 'sprint' && settings.bindings[a.id].indexOf(code) >= 0; }); };
          settings.bindings.sprint = [sprintFree('ShiftLeft') ? 'ShiftLeft' : sprintFree('ShiftRight') ? 'ShiftRight' : null, null];
          migrated = true;
        }
        if (!Array.isArray(saved.bindings.emotes)) {
          var emoteFree = !ACTIONS.some(function (a) { return a.id !== 'emotes' && settings.bindings[a.id].indexOf('KeyB') >= 0; });
          settings.bindings.emotes = [emoteFree ? 'KeyB' : null, null];
          migrated = true;
        }
        if (!Array.isArray(saved.bindings.slot6)) {
          var slotSixFree = !ACTIONS.some(function (a) { return a.id !== 'slot6' && settings.bindings[a.id].indexOf('Digit6') >= 0; });
          settings.bindings.slot6 = [slotSixFree ? 'Digit6' : null, null];
          migrated = true;
        }
      }
      if (saved && typeof saved.muted === 'boolean') settings.muted = saved.muted;
    } catch (e) { /* corrupt settings fall back to defaults */ }
    if (migrated) save();
    return settings;
  }
  function save() {
    var s = store();
    if (!s) return;
    try { s.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* storage full or blocked */ }
  }

  function label(code) {
    if (!code) return '—';
    if (NAMES[code]) return NAMES[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
    return code;
  }
  function bindings(action) { return settings.bindings[action] || [null, null]; }
  function down(input, action) { var b = bindings(action); return input.down(b[0]) || input.down(b[1]); }
  function hit(input, action) { var b = bindings(action); return input.hit(b[0]) || input.hit(b[1]); }
  function lift(input, action) { var b = bindings(action); return !!input.lift && (input.lift(b[0]) || input.lift(b[1])); }
  function primary(action) { var b = bindings(action); return label(b[0] || b[1]); }

  // Item storage never moves: a third class tool displays original item 1 in slot 6.
  function extraWeapon(p) { return !!p && !!p.weapons && p.weapons.length > 2; }
  function itemAction(p, index) { return extraWeapon(p) && index === 0 ? 'slot6' : 'item' + (index + 1); }
  function weaponAction(p, index) { return index === 2 ? 'item1' : 'weapon' + (index + 1); }
  function itemOrder(p) { return extraWeapon(p) ? [1, 2, 0] : [0, 1, 2]; }
  function weaponSlotHit(input, p) {
    if (hit(input, 'weapon1')) return 0;
    if (hit(input, 'weapon2')) return 1;
    return extraWeapon(p) && !p.vehicle && !p.mount && hit(input, 'item1') ? 2 : null;
  }
  function itemSlotHit(input, p) {
    for (var i = 0; i < 3; i++) if (hit(input, itemAction(p, i))) return i;
    return null;
  }
  function hotbarChanged(input, p) { return weaponSlotHit(input, p) !== null || itemSlotHit(input, p) !== null; }

  // A charge belongs to the equipped projectile and is cancelled by menus or a
  // weapon change. Measure physical key hold time, including taps between frames.
  function createChargeTracker() {
    var slots = {};
    return {
      reset: function () { slots = {}; },
      sample: function (input, action, id, enabled) {
        var held = down(input, action), pressed = hit(input, action), old = slots[action];
        if (!enabled || !id) { slots[action] = null; return { id: id, held: false, released: false, seconds: 0 }; }
        if (!old || old.id !== id) old = slots[action] = { id: id, armed: pressed };
        if (pressed) old.armed = true;
        var released = old.armed && !held && lift(input, action), seconds = 0, b = bindings(action);
        if (old.armed && (held || released) && input.heldSeconds) {
          seconds = Math.max(input.heldSeconds(b[0]), input.heldSeconds(b[1]));
          seconds = Math.min(W.CONFIG.projectileChargeTime, Math.max(0, seconds || 0));
        }
        var result = { id: id, held: held && old.armed, released: released, seconds: seconds };
        if (released) old.armed = false;
        return result;
      }
    };
  }

  // Binds `code` to one slot; the same code is removed from every other slot. Returns the actions that lost it.
  function rebind(action, slot, code) {
    if (!settings.bindings[action] || (slot !== 0 && slot !== 1)) return [];
    code = valid(code);
    var freed = [];
    if (code) {
      ACTIONS.forEach(function (a) {
        var b = settings.bindings[a.id];
        for (var i = 0; i < 2; i++) {
          if (b[i] === code && !(a.id === action && i === slot)) { b[i] = null; freed.push(a.id); }
        }
      });
    }
    settings.bindings[action][slot] = code;
    save();
    return freed;
  }
  function reset() { settings.bindings = clone(DEFAULTS); save(); }
  function actionName(id) {
    for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === id) return ACTIONS[i].name;
    return id;
  }

  W.Controls = {
    ACTIONS: ACTIONS, DEFAULTS: DEFAULTS,
    load: load, save: save, reset: reset, rebind: rebind,
    label: label, bindings: bindings, primary: primary, actionName: actionName,
    down: down, hit: hit, lift: lift, createChargeTracker: createChargeTracker,
    itemAction: itemAction, weaponAction: weaponAction, itemOrder: itemOrder,
    weaponSlotHit: weaponSlotHit, itemSlotHit: itemSlotHit, hotbarChanged: hotbarChanged,
    isReserved: function (code) { return code === 'Escape'; },
    setMuted: function (v) { settings.muted = !!v; save(); },
    muted: function () { return settings.muted; },
    all: function () { return settings.bindings; }
  };
  load();
}());
