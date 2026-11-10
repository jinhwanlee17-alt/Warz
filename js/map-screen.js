/* warz.io: the full island map (default key M). The match keeps running while it is open. */
(function () {
  'use strict';
  var W = window.Warz;
  var el, canvas, base = null, baseMap = null, open = false;

  function $(id) { return document.getElementById(id); }
  function size() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var css = Math.max(1, Math.min(window.innerWidth - 32, window.innerHeight - 37));
    return { css: css, px: Math.round(css * dpr), dpr: dpr };
  }
  function init() {
    el = $('map-screen');
    canvas = $('bigmap');
    refreshHint();
  }
  function refreshHint() {
    if (!el) return;
    el.setAttribute('aria-label', 'Island map. Press ' + W.Controls.primary('map') + ' or Escape to close. The match keeps running.');
  }
  function show() {
    if (open) return;
    open = true;
    el.hidden = false;
    document.body.classList.add('map-open');
  }
  function hide() {
    if (!open) return;
    open = false;
    el.hidden = true;
    document.body.classList.remove('map-open');
  }
  function toggle() { if (open) hide(); else show(); }
  function draw(world, player) {
    if (!open) return;
    var s = size();
    if (canvas.width !== s.px) {
      canvas.width = canvas.height = s.px;
      canvas.style.width = canvas.style.height = s.css + 'px';
      base = null;
    }
    if (!base || baseMap !== world.map) {
      base = W.MapArt.base(world.map, s.px, { big: true, labelPx: 13 * s.dpr, dpr: s.dpr });
      baseMap = world.map;
    }
    var g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(base, 0, 0);
    W.MapArt.overlay(g, world, player, s.px, { dpr: s.dpr, big: true });
  }

  W.MapScreen = { init: init, show: show, hide: hide, toggle: toggle, draw: draw, refreshHint: refreshHint, isOpen: function () { return open; } };
}());
