/* Nine equipped emotes. Selection is handled before gameplay keys in main.js. */
(function () {
  'use strict';
  var W = window.Warz, root, grid, hint, callbacks = {}, current = [];
  var keys = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO'];
  function init(opts) {
    callbacks = opts || {};
    if (root) return;
    root = document.createElement('section'); root.id = 'emote-picker'; root.hidden = true;
    root.className = 'emote-picker'; root.setAttribute('role', 'region'); root.setAttribute('aria-labelledby', 'emote-title');
    root.innerHTML = '<div class="emote-card"><header><h2 id="emote-title">Emotes</h2><button type="button" class="modal-close" aria-label="Close emotes">&times;</button></header><div class="emote-grid"></div><p class="emote-hint"></p></div>';
    document.body.appendChild(root); grid = root.querySelector('.emote-grid'); hint = root.querySelector('.emote-hint');
    root.querySelector('.modal-close').onclick = close;
    grid.addEventListener('click', function (e) { var b = e.target.closest('[data-emote-slot]'); if (b) select(Number(b.dataset.emoteSlot)); });
  }
  function isOpen() { return !!root && !root.hidden; }
  function show(equipped) {
    if (!root) return;
    current = W.Cosmetics.normalize({ emotes: equipped }).emotes;
    grid.textContent = '';
    current.forEach(function (id, i) {
      var emote = W.Cosmetics.EMOTES.find(function (e) { return e.id === id; }), b = document.createElement('button');
      b.type = 'button'; b.className = 'emote-choice'; b.dataset.emoteSlot = String(i);
      b.setAttribute('aria-label', 'Slot ' + (i + 1) + ', ' + keys[i].slice(3) + ': ' + emote.label);
      b.title = keys[i].slice(3) + ': ' + emote.label;
      var key = document.createElement('kbd'); key.textContent = keys[i].slice(3); b.appendChild(key);
      var glyph = document.createElement('span'); glyph.className = 'emote-glyph' + (['gg', 'hi', 'bye', 'haha', 'cooked'].indexOf(id) >= 0 ? ' is-text' : ''); glyph.textContent = emote.glyph; glyph.setAttribute('aria-hidden', 'true'); b.appendChild(glyph);
      grid.appendChild(b);
    });
    var closeKey = W.Controls.bindings('emotes').find(function (code) { return code && keys.indexOf(code) < 0; });
    hint.textContent = (closeKey ? W.Controls.label(closeKey) + ' / ' : '') + 'Esc closes';
    root.hidden = false; document.body.classList.add('emotes-open');
    if (callbacks.onOpen) callbacks.onOpen();
  }
  function close() {
    if (!isOpen()) return;
    root.hidden = true; document.body.classList.remove('emotes-open');
    if (root.contains(document.activeElement)) document.activeElement.blur();
    if (callbacks.onClose) callbacks.onClose();
  }
  function select(slot) {
    if (!isOpen() || slot < 0 || slot >= current.length) return;
    close();
    if (callbacks.onSelect) callbacks.onSelect(slot);
  }
  function handleKeys(input) {
    if (!isOpen()) return false;
    if (input.hit('Escape')) { input.consume('Escape'); close(); return true; }
    var selected = -1;
    for (var i = 0; i < keys.length; i++) if (input.hit(keys[i])) {
      if (selected < 0) selected = i;
      consumeKey(input, keys[i]);
    }
    if (selected >= 0) { select(selected); return true; }
    if (W.Controls.hit(input, 'emotes')) { consumeOpener(input); close(); return true; }
    return false;
  }
  function consumeKey(input, code) {
    var moving = ['up', 'down', 'left', 'right', 'sprint'].some(function (action) { return W.Controls.bindings(action).indexOf(code) >= 0; });
    input.consume(code, moving);
  }
  function consumeOpener(input) { W.Controls.bindings('emotes').forEach(function (code) { if (input.hit(code)) consumeKey(input, code); }); }
  W.EmotePicker = { init: init, show: show, close: close, isOpen: isOpen, handleKeys: handleKeys, consumeOpener: consumeOpener, select: select, keys: keys.slice() };
}());
