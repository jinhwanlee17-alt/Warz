/* warz.io: the inventory screen (default key Tab).
   Shows the three item slots with details. Clicking a slot holds that item; "Use now" uses food, kits and potions on
   the spot. The match keeps running while it is open. */
(function () {
  'use strict';
  var W = window.Warz, ITEMS = W.ITEMS, Icons = W.Icons, Controls = W.Controls, Rules = W.Rules;
  var el, grid, detail, hint, open = false, opts = {}, lastKey = '', focus = -1, lastPlayer = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function init(o) {
    opts = o || {};
    el = $('inventory-screen');
    grid = $('inv-grid');
    detail = $('inv-detail');
    hint = $('inv-hint');
    grid.addEventListener('click', function (e) {
      var slot = e.target.closest('[data-slot]');
      if (!slot) return;
      var i = Number(slot.getAttribute('data-slot'));
      focus = i;
      if (lastPlayer && lastPlayer.items[i] && opts.onSelect) opts.onSelect(i);
      lastKey = '';
    });
    detail.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-use') && opts.onUse) opts.onUse(Number(b.getAttribute('data-use')));
      else if (b.hasAttribute('data-hold') && opts.onSelect) opts.onSelect(Number(b.getAttribute('data-hold')));
    });
    $('inv-close').addEventListener('click', hide);
    refreshHint();
  }
  function refreshHint() {
    if (hint) hint.innerHTML = '<kbd>' + esc(Controls.primary('inventory')) + '</kbd> or <kbd>Esc</kbd> closes · the match keeps running';
  }
  function show() {
    if (open) return;
    open = true;
    el.hidden = false;
    lastKey = '';
    document.body.classList.add('inventory-open');
  }
  function hide() {
    if (!open) return;
    open = false;
    el.hidden = true;
    document.body.classList.remove('inventory-open');
    if (opts.onClose) opts.onClose();
  }
  function toggle() { if (open) hide(); else show(); }

  function howTo(it) {
    var key = esc(Controls.primary('interact'));
    switch (it.kind) {
      case 'consume': return 'Hold it and click anywhere to use it, or press Use now.';
      case 'throw': return 'Aim in a direction. Tap for a short throw, or hold for 0.75 seconds for maximum range, then release.';
      case 'place': return 'Hold it and click a free spot near you to place it.' + (it.struct === 'turret' ? ' Then stand next to it and press ' + key + ' to mount it.' : it.struct === 'teleporter' ? ' Place both pads to link them.' : '');
      case 'hold': return 'Hold it to raise the shield. Switch back to a weapon to lower it.';
      case 'target': return 'Hold it and click on the target.';
      default: return 'Hold it and click to switch it on.';
    }
  }

  function draw(world, p) {
    if (!open || !p) return;
    lastPlayer = p;
    if (focus < 0 && p.held >= 0) focus = p.held;
    var key = p.items.map(function (s) { return s ? s.id + ':' + s.n : '-'; }).join(',') + '|' + p.held + '|' + focus;
    if (key === lastKey) return;
    lastKey = key;
    grid.innerHTML = p.items.map(function (s, i) {
      var it = s ? ITEMS[s.id] : null;
      return '<button type="button" class="inv-slot' + (it ? ' has-item tier-' + it.tier : '') + (p.held === i ? ' is-held' : '') + (focus === i ? ' is-focus' : '') + '" data-slot="' + i + '">' +
        '<span class="inv-key">' + esc(Controls.primary('item' + (i + 1))) + '</span>' +
        (it ? Icons.itemIcon(s.id, 'inv-icon') + '<b>' + esc(it.name) + '</b><small>' + (s.n > 1 ? '×' + s.n + ' · ' : '') + W.TIERS[it.tier].name + '</small>' : '<small class="inv-empty">Empty</small>') +
        '</button>';
    }).join('');
    var s = focus >= 0 ? p.items[focus] : null, it = s ? ITEMS[s.id] : null;
    if (!it) {
      detail.innerHTML = '<p class="modal-note">Break crates to find items, then stand near one and press ' + esc(Controls.primary('interact')) + ' to pick it up. Rarer crates (blue, purple, pink and gold) hold rarer items. ' +
        'Press a slot key or click a slot to hold an item, then click in the world to use it.</p>';
      return;
    }
    var canUse = it.kind === 'consume' || it.kind === 'use';
    detail.innerHTML = '<div class="inv-detail-head">' + Icons.itemIcon(s.id, 'inv-detail-icon') +
      '<div><b>' + esc(it.name) + '</b><span class="tier-tag tier-' + it.tier + '">' + W.TIERS[it.tier].name + '</span></div></div>' +
      '<p class="inv-blurb">' + esc(it.blurb) + '</p><p class="inv-stats">' + esc(Rules.itemLine(s.id)) + ' · you have ' + s.n + '</p>' +
      '<div class="modal-actions compact">' + (canUse ? '<button type="button" class="mini mini-go" data-use="' + focus + '">Use now</button>' : '') +
      '<button type="button" class="mini" data-hold="' + focus + '">' + (p.held === focus ? 'Put away' : 'Hold (' + esc(Controls.primary('item' + (focus + 1))) + ')') + '</button></div>' +
      '<p class="modal-note">' + howTo(it) + '</p><p class="modal-note">To drop the whole stack, hold it, close the inventory, and press <kbd>' + esc(Controls.primary('drop')) + '</kbd>.</p>';
  }

  W.Inventory = { init: init, show: show, hide: hide, toggle: toggle, draw: draw, refreshHint: refreshHint, isOpen: function () { return open; } };
}());
