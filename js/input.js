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
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.wheel = 0;
    this.capture = false;

    window.addEventListener('keydown', function (e) {
      if (typing(e)) return;
      if (!e.repeat) self.pressed[e.code] = true;
      self.keys[e.code] = true;
      if (self.capture && GAME_KEYS[e.code]) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { if (self.keys[e.code]) self.released[e.code] = true; self.keys[e.code] = false; });
    window.addEventListener('blur', function () { self.release(); });
    canvas.addEventListener('mousedown', function (e) {
      var code = 'Mouse' + (e.button + 1);
      self.keys[code] = true;
      self.pressed[code] = true;
    });
    window.addEventListener('mouseup', function (e) { var code = 'Mouse' + (e.button + 1); if (self.keys[code]) self.released[code] = true; self.keys[code] = false; });
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
  Input.prototype.endFrame = function () { this.pressed = {}; this.released = {}; this.wheel = 0; };
  Input.prototype.release = function () { this.keys = {}; this.pressed = {}; this.released = {}; };

  W.Input = Input;
}());
