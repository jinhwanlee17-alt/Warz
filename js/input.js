/* warz.io: raw keyboard and mouse state keyed by code ("KeyW", "Mouse1" = left, "Mouse2" = middle, "Mouse3" = right).
   Edge presses are kept until the game loop calls endFrame(). Actions map onto codes in controls.js. */
(function () {
  'use strict';
  var W = window.Warz;
  var GAME_KEYS = { Space: 1, Tab: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };

  function typing(e) {
    var t = e.target, tag = t && t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(t && t.isContentEditable);
  }

  function Input(canvas) {
    var self = this;
    this.keys = {};
    this.pressed = {};
    this.released = {};
    this.heldAt = {};
    this.releasedAfter = {};
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.wheel = 0;
    this.capture = false;
    this.suppressed = {};

    window.addEventListener('keydown', function (e) {
      if (typing(e)) return;
      if (self.suppressed[e.code]) { if (self.capture) e.preventDefault(); return; }
      if (!self.keys[e.code]) { self.pressed[e.code] = true; self.heldAt[e.code] = performance.now(); }
      self.keys[e.code] = true;
      if (self.capture && GAME_KEYS[e.code]) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { delete self.suppressed[e.code]; self.releaseKey(e.code); });
    window.addEventListener('blur', function () { self.suppressed = {}; self.release(); });
    canvas.addEventListener('mousedown', function (e) {
      var code = 'Mouse' + (e.button + 1);
      if (self.suppressed[code]) return;
      if (!self.keys[code]) self.heldAt[code] = performance.now();
      self.keys[code] = true;
      self.pressed[code] = true;
    });
    window.addEventListener('mouseup', function (e) { var code = 'Mouse' + (e.button + 1); delete self.suppressed[code]; self.releaseKey(code); });
    window.addEventListener('mousemove', function (e) { self.mouse.x = e.clientX; self.mouse.y = e.clientY; });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('wheel', function (e) {
      if (!self.capture) return;
      e.preventDefault();
      if (e.deltaY) self.wheel += e.deltaY > 0 ? 1 : -1;
    }, { passive: false });
  }

  Input.prototype.down = function (code) { return !!(code && this.keys[code]); };
  Input.prototype.hit = function (code) { return !!(code && this.pressed[code]); };
  Input.prototype.lift = function (code) { return !!(code && this.released[code]); };
  Input.prototype.releaseKey = function (code) {
    if (this.keys[code]) {
      this.released[code] = true;
      this.releasedAfter[code] = Math.max(0, (performance.now() - this.heldAt[code]) / 1000);
    }
    this.keys[code] = false;
    delete this.heldAt[code];
  };
  Input.prototype.heldSeconds = function (code) {
    if (!code) return 0;
    return this.keys[code] ? Math.max(0, (performance.now() - this.heldAt[code]) / 1000) : this.releasedAfter[code] || 0;
  };
  Input.prototype.endFrame = function () { this.pressed = {}; this.released = {}; this.releasedAfter = {}; this.wheel = 0; };
  Input.prototype.release = function () { this.keys = {}; this.pressed = {}; this.released = {}; this.heldAt = {}; this.releasedAfter = {}; };
  // Consume only a panel shortcut. Movement bindings retain their held state and duration.
  Input.prototype.consume = function (code, keepDown) {
    if (!code) return;
    delete this.pressed[code]; delete this.released[code]; delete this.releasedAfter[code];
    if (keepDown) return;
    if (this.keys[code]) this.suppressed[code] = true;
    this.keys[code] = false;
    delete this.heldAt[code];
  };
  // Modal selection keys stay consumed until physical release, including keyboard auto-repeat.
  Input.prototype.suppressHeld = function () {
    for (var code in this.keys) if (this.keys[code]) this.suppressed[code] = true;
    this.release(); this.wheel = 0;
  };

  W.Input = Input;
}());
