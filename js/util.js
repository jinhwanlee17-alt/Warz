/* warz.io: math, seeded randomness, geometry tests and a spatial hash. No DOM access. */
(function () {
  'use strict';
  var W = window.Warz = window.Warz || {};
  var U = W.U = {};
  var hashCount = 0;

  U.TAU = Math.PI * 2;
  U.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.dist = function (ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); };
  U.easeOut = function (t) { return 1 - (1 - t) * (1 - t); };
  U.easeInOut = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  U.angleDiff = function (a, b) {
    var d = (b - a) % U.TAU;
    if (d > Math.PI) d -= U.TAU;
    if (d < -Math.PI) d += U.TAU;
    return d;
  };

  // mulberry32: small, fast and deterministic, so a seed always rebuilds the same map.
  U.rng = function (seed) {
    var s = (seed >>> 0) || 1;
    function next() {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      range: function (a, b) { return a + (b - a) * next(); },
      int: function (a, b) { return a + Math.floor(next() * (b - a + 1)); },
      pick: function (list) { return list[Math.floor(next() * list.length)]; },
      chance: function (p) { return next() < p; },
      shuffle: function (list) {
        var out = list.slice();
        for (var i = out.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1)), tmp = out[i];
          out[i] = out[j]; out[j] = tmp;
        }
        return out;
      }
    };
  };

  // First contact of segment (x1,y1)->(x2,y2) with a circle, as t in [0,1], or -1. Starting inside returns 0.
  U.segCircle = function (x1, y1, x2, y2, cx, cy, r) {
    var dx = x2 - x1, dy = y2 - y1, fx = x1 - cx, fy = y1 - cy;
    var c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;
    var a = dx * dx + dy * dy;
    if (a === 0) return -1;
    var b = 2 * (fx * dx + fy * dy), disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    var t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : -1;
  };

  // Liang-Barsky clip of a segment against an axis-aligned rectangle. Starting inside returns 0.
  U.segRect = function (x1, y1, x2, y2, rx, ry, rw, rh) {
    var dx = x2 - x1, dy = y2 - y1, t0 = 0, t1 = 1;
    var p = [-dx, dx, -dy, dy], q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return -1;
      } else {
        var t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return -1; if (t > t0) t0 = t; }
        else { if (t < t0) return -1; if (t < t1) t1 = t; }
      }
    }
    return t0;
  };

  // Vector that pushes a circle out of a rectangle, or null when they do not overlap.
  U.circleRectPush = function (cx, cy, r, rx, ry, rw, rh) {
    var nx = U.clamp(cx, rx, rx + rw), ny = U.clamp(cy, ry, ry + rh);
    var dx = cx - nx, dy = cy - ny, d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return null;
    if (d2 > 1e-6) {
      var d = Math.sqrt(d2), k = (r - d) / d;
      return { x: dx * k, y: dy * k };
    }
    var left = cx - rx, right = rx + rw - cx, top = cy - ry, bottom = ry + rh - cy;
    var m = Math.min(left, right, top, bottom);
    if (m === left) return { x: -(left + r), y: 0 };
    if (m === right) return { x: right + r, y: 0 };
    if (m === top) return { x: 0, y: -(top + r) };
    return { x: 0, y: bottom + r };
  };

  // Rounded-square island: is (x,y) at least `margin` inside the coastline?
  U.insideIsland = function (x, y, margin, size, corner) {
    if (x < margin || y < margin || x > size - margin || y > size - margin) return false;
    var inCornerX = x < corner || x > size - corner, inCornerY = y < corner || y > size - corner;
    if (inCornerX && inCornerY) {
      var cx = x < corner ? corner : size - corner, cy = y < corner ? corner : size - corner;
      return Math.hypot(x - cx, y - cy) <= corner - margin;
    }
    return true;
  };

  // Keep a circle on the island (players cannot walk into the ocean).
  U.clampToIsland = function (o, r, size, corner) {
    o.x = U.clamp(o.x, r, size - r);
    o.y = U.clamp(o.y, r, size - r);
    var inCornerX = o.x < corner || o.x > size - corner, inCornerY = o.y < corner || o.y > size - corner;
    if (inCornerX && inCornerY) {
      var cx = o.x < corner ? corner : size - corner, cy = o.y < corner ? corner : size - corner;
      var dx = o.x - cx, dy = o.y - cy, d = Math.hypot(dx, dy), max = corner - r;
      if (d > max && d > 0) { o.x = cx + dx / d * max; o.y = cy + dy / d * max; }
    }
  };

  U.formatTime = function (seconds) {
    var s = Math.max(0, Math.ceil(seconds));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  };

  U.shade = function (hex, amount) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var target = amount < 0 ? 0 : 255, p = Math.abs(amount);
    r = Math.round((target - r) * p + r); g = Math.round((target - g) * p + g); b = Math.round((target - b) * p + b);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  };
  U.rgba = function (hex, alpha) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  };

  // Uniform grid for broad-phase queries. Objects are stored in every cell their box touches.
  function SpatialHash(cell) {
    this.cell = cell;
    this.cells = new Map();
    this.stamp = 0;
    this.mark = '_sh' + (hashCount++);
  }
  SpatialHash.prototype.key = function (cx, cy) { return (cx + 64) * 4096 + (cy + 64); };
  SpatialHash.prototype.insert = function (obj, x0, y0, x1, y1) {
    var c = this.cell;
    for (var cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
      for (var cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) {
        var k = this.key(cx, cy), list = this.cells.get(k);
        if (!list) { list = []; this.cells.set(k, list); }
        list.push(obj);
      }
    }
  };
  SpatialHash.prototype.query = function (x0, y0, x1, y1, fn) {
    var c = this.cell, stamp = ++this.stamp, mark = this.mark;
    for (var cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
      for (var cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) {
        var list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (o[mark] === stamp) continue;
          o[mark] = stamp;
          fn(o);
        }
      }
    }
  };
  U.SpatialHash = SpatialHash;
}());
