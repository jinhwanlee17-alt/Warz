/* Engineer's six available Sentry IV specializations. */
(function () {
  'use strict';
  var W = window.Warz, root, grid, callbacks = {}, showing = '', dismissed = '', shownNonce;
  function key(choice) { return choice ? choice.struct + ':' + (choice.nonce || 0) + ':' + choice.options.join(',') : ''; }
  function init(opts) {
    callbacks = opts || {};
    if (root) return;
    root = document.createElement('section'); root.id = 'sentry-upgrade'; root.className = 'modal'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'sentry-upgrade-title');
    root.innerHTML = '<div class="modal-card sentry-upgrade-card"><button type="button" class="modal-close" aria-label="Cancel sentry upgrade">&times;</button><p class="eyebrow">Engineer</p><h2 id="sentry-upgrade-title">Choose Sentry IV</h2><p class="sentry-upgrade-cost"></p><div class="sentry-upgrade-options"></div><p class="modal-note"></p></div>';
    document.body.appendChild(root); grid = root.querySelector('.sentry-upgrade-options');
    root.querySelector('.modal-close').onclick = function () { select(null); };
    root.addEventListener('keydown', function (e) {
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); select(null); }
      if (e.key === 'Tab') {
        e.stopPropagation();
        var buttons = Array.prototype.slice.call(root.querySelectorAll('button')), first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
  function isOpen() { return !!root && !root.hidden; }
  function close() {
    if (!isOpen()) return;
    dismissed = showing; showing = ''; root.hidden = true;
    if (root.contains(document.activeElement)) document.activeElement.blur();
    if (callbacks.onClose) callbacks.onClose();
  }
  function select(variant) { var nonce = shownNonce; close(); if (callbacks.onChoose) callbacks.onChoose(variant, nonce); }
  function tick(match) {
    var p = match && !match.ended && match.player, choice = p && p.alive && !p.downed && p.sentryChoice, id = key(choice);
    if (!id) { dismissed = ''; close(); dismissed = ''; return; }
    if (id === showing || id === dismissed || !root) return;
    shownNonce = choice.nonce;
    root.querySelector('.sentry-upgrade-cost').textContent = choice.instant ? '1 Engineer II’s Hammer · instant upgrade' : W.ENGINEER.finalCost + ' tokens · ' + W.ENGINEER.finalSeconds + ' seconds to build';
    root.querySelector('.modal-note').textContent = choice.instant ? 'Choose a weapon to use your hammer and upgrade this sentry immediately.' : 'Choose a weapon, then hold your hammer on the sentry to build. Tokens are spent when the upgrade finishes.';
    grid.textContent = '';
    choice.options.forEach(function (variant) {
      var def = W.SENTRY_IV[variant]; if (!def) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'sentry-upgrade-option'; b.dataset.sentryVariant = variant;
      var title = document.createElement('strong'); title.textContent = def.name; b.appendChild(title);
      var hp = document.createElement('span'); hp.className = 'sentry-upgrade-hp'; hp.textContent = def.hp + ' HP'; b.appendChild(hp);
      var desc = document.createElement('span'); desc.textContent = def.blurb; b.appendChild(desc);
      b.style.setProperty('--sentry-color', def.color); b.onclick = function () { select(variant); }; grid.appendChild(b);
    });
    showing = id; root.hidden = false; var first = grid.querySelector('button'); if (first) first.focus();
  }
  W.SentryUpgradeUI = { init: init, tick: tick, close: close, isOpen: isOpen };
}());
