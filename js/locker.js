/* Personal looks and the nine-slot emote loadout. Everything is optional and saved in this browser. */
(function () {
  'use strict';
  var W = window.Warz, C = W.Cosmetics, STORE = 'warz.locker.v1';
  var root = null, value = null, tab = 'colours', slot = 0, returnFocus = null, wheelBase = null;
  var hsv = { h: 0, s: 0, v: 1 }, saved = true;
  var KEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O'];
  function $(id) { return document.getElementById(id); }
  function esc(text) { return String(text).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { /* a private window can still use the locker */ }
    value = C.normalize(raw); hsv = toHSV(value.color);
  }
  function get() { if (!value) load(); return C.normalize(value); }
  function save() {
    value = C.normalize(value); saved = true;
    try { localStorage.setItem(STORE, JSON.stringify(value)); } catch (e) { saved = false; }
    if ($('locker-save-note')) $('locker-save-note').textContent = saved ? 'Saved automatically on this browser' : 'Applied for this session';
    window.dispatchEvent(new CustomEvent('warz-locker-change', { detail: get() }));
  }
  function rgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
  function hex(channels) { return '#' + channels.map(function (n) { return Math.round(n).toString(16).padStart(2, '0'); }).join(''); }
  function toHSV(color) {
    var a = rgb(color).map(function (n) { return n / 255; }), max = Math.max.apply(null, a), min = Math.min.apply(null, a), d = max - min, h = 0;
    if (d) { if (max === a[0]) h = ((a[1] - a[2]) / d) % 6; else if (max === a[1]) h = (a[2] - a[0]) / d + 2; else h = (a[0] - a[1]) / d + 4; h *= 60; }
    return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
  }
  function fromHSV(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    var a = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return a.map(function (n) { return Math.round((n + m) * 255); });
  }
  function setColor(color, keepHSV) {
    value.color = color.toLowerCase();
    if (!keepHSV) hsv = toHSV(value.color);
    save(); refreshColor(); refreshPreview();
  }
  function emote(id) { return C.EMOTES.find(function (e) { return e.id === id; }); }
  function emoteMarkup(item) {
    return '<span class="locker-emote-glyph' + (/^[A-Za-z]/.test(item.glyph) ? ' is-words' : '') + '" aria-hidden="true">' + esc(item.glyph) + '</span><span class="locker-emote-name">' + esc(item.label) + '</span>';
  }
  function drawPlayer(canvas, face, color, preview) {
    var g = canvas.getContext('2d'), w = canvas.width, h = canvas.height, r = preview ? 51 : 34;
    g.clearRect(0, 0, w, h); g.save(); g.translate(w / 2, h / 2);
    if (preview) { g.fillStyle = 'rgba(0,0,0,.16)'; g.beginPath(); g.ellipse(0, r + 9, r * 1.05, 10, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = color; g.strokeStyle = '#1d2433'; g.lineWidth = preview ? 5 : 3;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = preview ? 4 : 2;
    g.beginPath(); g.arc(0, 0, r - 5, Math.PI * 1.08, Math.PI * 1.7); g.stroke();
    if (W.CosmeticArt) W.CosmeticArt.face(g, face, r, color);
    g.restore();
  }
  function refreshPreview() {
    if (!root) return;
    drawPlayer($('locker-preview'), value.face, value.color, true);
    $('locker-preview-color').textContent = value.color.toUpperCase();
    var face = C.FACES.find(function (f) { return f.id === value.face; });
    $('locker-preview-face').textContent = face ? face.label : 'No face';
    root.querySelectorAll('[data-locker-face]').forEach(function (button) {
      var selected = button.dataset.lockerFace === value.face;
      button.setAttribute('aria-pressed', String(selected));
      drawPlayer(button.querySelector('canvas'), button.dataset.lockerFace, value.color, false);
    });
  }
  function createWheel() {
    wheelBase = document.createElement('canvas'); wheelBase.width = wheelBase.height = 240;
    var g = wheelBase.getContext('2d'), data = g.createImageData(240, 240), r = 111;
    for (var y = 0; y < 240; y++) for (var x = 0; x < 240; x++) {
      var dx = x - 120, dy = y - 120, d = Math.hypot(dx, dy);
      if (d > r) continue;
      var color = fromHSV((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, d / r, 1), i = (y * 240 + x) * 4;
      data.data[i] = color[0]; data.data[i + 1] = color[1]; data.data[i + 2] = color[2]; data.data[i + 3] = 255;
    }
    g.putImageData(data, 0, 0);
  }
  function drawWheel() {
    var canvas = $('locker-wheel'), g = canvas.getContext('2d');
    if (!wheelBase) createWheel();
    g.clearRect(0, 0, 240, 240); g.drawImage(wheelBase, 0, 0);
    g.fillStyle = 'rgba(0,0,0,' + (1 - hsv.v) + ')'; g.beginPath(); g.arc(120, 120, 111, 0, Math.PI * 2); g.fill();
    var x = 120 + Math.cos(hsv.h * Math.PI / 180) * hsv.s * 111, y = 120 + Math.sin(hsv.h * Math.PI / 180) * hsv.s * 111;
    g.lineWidth = 5; g.strokeStyle = '#1d2433'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2.5; g.strokeStyle = '#ffffff'; g.stroke();
    canvas.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    canvas.setAttribute('aria-valuetext', 'Hue ' + Math.round(hsv.h) + ', saturation ' + Math.round(hsv.s * 100) + '%, brightness ' + Math.round(hsv.v * 100) + '%');
  }
  function refreshColor() {
    if (!root) return;
    var a = rgb(value.color);
    ['r', 'g', 'b'].forEach(function (channel, i) { var el = $('locker-rgb-' + channel); if (document.activeElement !== el) el.value = a[i]; el.removeAttribute('aria-invalid'); });
    if (document.activeElement !== $('locker-hex')) $('locker-hex').value = value.color.toUpperCase();
    $('locker-brightness').value = Math.round(hsv.v * 100); $('locker-brightness-value').textContent = Math.round(hsv.v * 100) + '%';
    $('locker-hex').removeAttribute('aria-invalid'); $('locker-colour-error').textContent = '';
    root.querySelectorAll('[data-locker-color]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.lockerColor.toLowerCase() === value.color)); });
    drawWheel();
  }
  function renderEmotes() {
    $('locker-emote-slots').innerHTML = value.emotes.map(function (id, i) {
      return '<button type="button" class="locker-emote-slot" data-locker-slot="' + i + '" aria-pressed="' + (slot === i) + '" aria-label="Edit slot ' + (i + 1) + ', ' + esc(emote(id).label) + ', key ' + KEYS[i] + '"><kbd>' + KEYS[i] + '</kbd>' + emoteMarkup(emote(id)) + '<small>Slot ' + (i + 1) + '</small></button>';
    }).join('');
    $('locker-emote-choices').innerHTML = C.EMOTES.map(function (item) {
      var at = value.emotes.indexOf(item.id), selected = value.emotes[slot] === item.id;
      return '<button type="button" class="locker-emote-choice" data-locker-emote="' + item.id + '" aria-pressed="' + selected + '" aria-label="Equip ' + esc(item.label) + ' in slot ' + (slot + 1) + '">' + emoteMarkup(item) + '<small>' + (at >= 0 ? 'Equipped · ' + KEYS[at] : 'Available') + '</small></button>';
    }).join('');
    $('locker-emote-editing').textContent = 'Editing slot ' + (slot + 1) + ' · ' + KEYS[slot];
  }
  function selectTab(id, focus) {
    tab = id;
    root.querySelectorAll('[data-locker-tab]').forEach(function (button) {
      var active = button.dataset.lockerTab === id; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      if (focus && active) button.focus();
    });
    root.querySelectorAll('[data-locker-panel]').forEach(function (panel) { panel.hidden = panel.dataset.lockerPanel !== id; });
  }
  function init() {
    if (root) return;
    if (!value) load();
    root = document.createElement('section'); root.id = 'locker-dialog'; root.className = 'locker-overlay'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'locker-title');
    root.innerHTML = '<div class="locker-card">' +
      '<header class="locker-header"><div><p class="locker-eyebrow">Make it yours</p><h2 id="locker-title">Locker</h2></div><button type="button" id="locker-close" class="modal-close" aria-label="Close locker">&times;</button></header>' +
      '<div class="locker-layout"><aside class="locker-preview-panel"><div class="locker-preview-stage"><canvas id="locker-preview" width="240" height="210" aria-label="Your circle preview"></canvas><span class="locker-preview-tag">Your look</span></div><div class="locker-preview-details"><strong id="locker-preview-color"></strong><span id="locker-preview-face"></span></div><p class="locker-preview-note">Your look follows you into every match.</p><p id="locker-save-note" class="locker-save-note" role="status">Saved automatically on this browser</p></aside>' +
      '<div class="locker-content"><nav class="locker-tabs" role="tablist" aria-label="Locker categories">' +
      [['colours', 'Colours'], ['face', 'Face'], ['items', 'Items'], ['emotes', 'Emotes']].map(function (pair) { return '<button type="button" role="tab" id="locker-tab-' + pair[0] + '" data-locker-tab="' + pair[0] + '" aria-controls="locker-panel-' + pair[0] + '">' + pair[1] + '</button>'; }).join('') + '</nav>' +
      '<section id="locker-panel-colours" data-locker-panel="colours" class="locker-panel" role="tabpanel" aria-labelledby="locker-tab-colours"><div class="locker-section-heading"><h3>Pick your colour</h3><span>20 ready to wear</span></div><div class="locker-swatches" aria-label="Preset colours">' +
      C.PRESETS.map(function (p) { return '<button type="button" class="locker-swatch" data-locker-color="' + p.color + '" style="--swatch:' + p.color + '" title="' + esc(p.name) + '" aria-label="' + esc(p.name) + '" aria-pressed="false"><span aria-hidden="true"></span></button>'; }).join('') +
      '</div><div class="locker-custom-colour"><div class="locker-wheel-wrap"><canvas id="locker-wheel" width="240" height="240" tabindex="0" role="slider" aria-label="Colour wheel: left and right change hue, up and down change saturation" aria-valuemin="0" aria-valuemax="360" aria-valuenow="0"></canvas><span>Pick any shade</span></div><div class="locker-colour-controls"><h4>Your own colour</h4><label class="locker-brightness-label" for="locker-brightness">Brightness <output id="locker-brightness-value">100%</output></label><input type="range" id="locker-brightness" min="0" max="100" step="1" value="100"><fieldset class="locker-rgb"><legend>RGB</legend>' +
      ['r', 'g', 'b'].map(function (channel) { return '<label>' + channel.toUpperCase() + '<input type="number" id="locker-rgb-' + channel + '" min="0" max="255" step="1" inputmode="numeric" aria-label="' + ({ r: 'Red', g: 'Green', b: 'Blue' })[channel] + ' value, 0 to 255" aria-describedby="locker-colour-error"></label>'; }).join('') +
      '</fieldset><label class="locker-hex-label" for="locker-hex">Hex colour<input type="text" id="locker-hex" maxlength="7" spellcheck="false" autocomplete="off" aria-describedby="locker-colour-error"></label><p id="locker-colour-error" class="locker-colour-error" role="status"></p></div></div></section>' +
      '<section id="locker-panel-face" data-locker-panel="face" class="locker-panel" role="tabpanel" aria-labelledby="locker-tab-face" hidden><div class="locker-section-heading"><h3>Wear an expression</h3></div><p class="locker-panel-note">A face on top of your circle, visible from above.</p><div class="locker-faces">' +
      C.FACES.map(function (face) { return '<button type="button" class="locker-face" data-locker-face="' + face.id + '" aria-pressed="false"><canvas width="104" height="92" aria-hidden="true"></canvas><span>' + esc(face.label) + '</span></button>'; }).join('') + '</div></section>' +
      '<section id="locker-panel-items" data-locker-panel="items" class="locker-panel" role="tabpanel" aria-labelledby="locker-tab-items" hidden><div class="locker-locked"><span class="locker-lock-icon" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M20 27V19a12 12 0 0 1 24 0v8" stroke="currentColor" stroke-width="6"/><rect x="12" y="26" width="40" height="30" rx="7" fill="currentColor"/><path d="M32 38v7" stroke="#1d2433" stroke-width="5" stroke-linecap="round"/></svg></span><h3>More ways to stand out</h3><p>Locker items are locked for now.</p><span class="locker-soon">Coming soon</span></div></section>' +
      '<section id="locker-panel-emotes" data-locker-panel="emotes" class="locker-panel" role="tabpanel" aria-labelledby="locker-tab-emotes" hidden><div class="locker-section-heading"><h3>Your nine emotes</h3><span id="locker-emote-editing"></span></div><p class="locker-panel-note">Choose a slot, then choose an emote. In a match, press <kbd>B</kbd>, then its letter.</p><div id="locker-emote-slots" class="locker-emote-slots" aria-label="Your equipped emote slots"></div><h4 class="locker-emote-collection-label">Emote collection <span>All unlocked</span></h4><div id="locker-emote-choices" class="locker-emote-choices" aria-label="Available emotes"></div><p class="locker-emote-note">Everyone nearby can see your emote. No chat, just expressions.</p></section>' +
      '</div></div></div>';
    document.body.appendChild(root);
    $('locker-close').addEventListener('click', close);
    root.addEventListener('click', function (event) {
      if (event.target === root) { close(); return; }
      var button = event.target.closest('button'); if (!button) return;
      if (button.dataset.lockerTab) selectTab(button.dataset.lockerTab);
      if (button.dataset.lockerColor) setColor(button.dataset.lockerColor, false);
      if (button.dataset.lockerFace) { value.face = button.dataset.lockerFace; save(); refreshPreview(); }
      if (button.dataset.lockerSlot !== undefined) { slot = Number(button.dataset.lockerSlot); renderEmotes(); root.querySelector('[data-locker-slot="' + slot + '"]').focus(); }
      if (button.dataset.lockerEmote) {
        var id = button.dataset.lockerEmote, previous = value.emotes.indexOf(id), old = value.emotes[slot];
        value.emotes[slot] = id; if (previous >= 0 && previous !== slot) value.emotes[previous] = old;
        save(); renderEmotes(); root.querySelector('[data-locker-emote="' + id + '"]').focus();
      }
    });
    root.addEventListener('keydown', function (event) {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      var target = event.target;
      if (target.dataset.lockerTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) >= 0) {
        event.preventDefault(); var tabs = ['colours', 'face', 'items', 'emotes'], i = tabs.indexOf(tab);
        selectTab(tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (i + (event.key === 'ArrowRight' ? 1 : 3)) % 4], true); return;
      }
      if (event.key === 'Tab') {
        var nodes = Array.from(root.querySelectorAll('button, input, [tabindex="0"]')).filter(function (el) { return !el.disabled && el.tabIndex >= 0 && el.getClientRects().length; });
        var at = nodes.indexOf(document.activeElement), next = event.shiftKey ? at - 1 : at + 1;
        if (next < 0 || next >= nodes.length) { event.preventDefault(); nodes[(next + nodes.length) % nodes.length].focus(); }
      }
    });
    document.addEventListener('focusin', function (event) { if (isOpen() && !root.contains(event.target)) $('locker-close').focus(); });
    var wheel = $('locker-wheel');
    function wheelPoint(event) {
      var rect = wheel.getBoundingClientRect(), x = (event.clientX - rect.left) * 240 / rect.width - 120, y = (event.clientY - rect.top) * 240 / rect.height - 120;
      hsv.h = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; hsv.s = Math.min(1, Math.hypot(x, y) / 111);
      setColor(hex(fromHSV(hsv.h, hsv.s, hsv.v)), true);
    }
    wheel.addEventListener('pointerdown', function (event) { if (event.button !== 0) return; event.preventDefault(); wheel.focus(); wheel.setPointerCapture(event.pointerId); wheelPoint(event); });
    wheel.addEventListener('pointermove', function (event) { if (wheel.hasPointerCapture(event.pointerId)) wheelPoint(event); });
    wheel.addEventListener('pointerup', function (event) { if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId); });
    wheel.addEventListener('keydown', function (event) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key) < 0) return;
      event.preventDefault(); var step = event.shiftKey ? 10 : 3;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') hsv.h = (hsv.h + (event.key === 'ArrowLeft' ? -step : step) + 360) % 360;
      else hsv.s = Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowUp' ? step : -step) / 100));
      setColor(hex(fromHSV(hsv.h, hsv.s, hsv.v)), true);
    });
    $('locker-brightness').addEventListener('input', function () { hsv.v = Number(this.value) / 100; setColor(hex(fromHSV(hsv.h, hsv.s, hsv.v)), true); });
    ['r', 'g', 'b'].forEach(function (channel) {
      var input = $('locker-rgb-' + channel);
      input.addEventListener('input', function () {
        var valid = true, channels = ['r', 'g', 'b'].map(function (c) {
          var el = $('locker-rgb-' + c), n = Number(el.value), ok = el.value.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 255;
          el.setAttribute('aria-invalid', String(!ok)); valid = valid && ok; return n;
        });
        if (valid) setColor(hex(channels), false); else $('locker-colour-error').textContent = 'Use whole RGB values from 0 to 255.';
      });
      input.addEventListener('blur', function () { this.value = rgb(value.color)[['r', 'g', 'b'].indexOf(channel)]; refreshColor(); });
    });
    $('locker-hex').addEventListener('input', function () {
      var color = this.value.trim(); if (color.charAt(0) !== '#') color = '#' + color;
      if (/^#[0-9a-f]{6}$/i.test(color)) setColor(color, false);
      else { this.setAttribute('aria-invalid', 'true'); $('locker-colour-error').textContent = 'Use a six-digit hex colour, like #2F9BFF.'; }
    });
    $('locker-hex').addEventListener('blur', function () { this.value = value.color.toUpperCase(); refreshColor(); });
    window.addEventListener('storage', function (event) { if (event.key === STORE && !isOpen()) load(); });
    selectTab(tab); refreshPreview(); refreshColor(); renderEmotes();
  }
  function open() {
    init(); if (isOpen()) return;
    returnFocus = document.activeElement; root.hidden = false; document.body.classList.add('locker-open');
    selectTab(tab); refreshPreview(); refreshColor(); renderEmotes(); $('locker-tab-' + tab).focus();
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true; document.body.classList.remove('locker-open');
    if (returnFocus && returnFocus.isConnected && returnFocus.getClientRects().length) returnFocus.focus();
    returnFocus = null;
  }
  function isOpen() { return !!root && !root.hidden; }
  W.Locker = { init: init, open: open, close: close, isOpen: isOpen, get: get };
})();
