/* Shared, resolution-independent face art for the Locker and the top-down player heads. */
(function () {
  'use strict';
  var W = window.Warz, TAU = Math.PI * 2;
  var FACES = { smile: true, sad: true, angry: true, evil: true, laugh: true, cry: true };

  function ink(color) {
    var n = /^#[0-9a-f]{6}$/i.test(color || '') ? parseInt(color.slice(1), 16) : 0x2f9bff;
    return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 105 ? '#fffaf0' : '#182437';
  }
  function face(ctx, id, r, color) {
    if (!FACES[id] || !(r > 0) || !Number.isFinite(r)) return false;
    ctx.save(); ctx.scale(r, r);
    var line = ink(color);
    ctx.fillStyle = line; ctx.strokeStyle = line;
    ctx.lineWidth = 0.105; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    function dot(x, y, size) { ctx.beginPath(); ctx.arc(x, y, size || 0.09, 0, TAU); ctx.fill(); }
    function curve(x1, y1, cx, cy, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke(); }
    function brow(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    if (id === 'laugh') {
      curve(-0.5, -0.16, -0.32, -0.46, -0.14, -0.16);
      curve(0.14, -0.16, 0.32, -0.46, 0.5, -0.16);
      ctx.beginPath(); ctx.moveTo(-0.4, 0.13); ctx.quadraticCurveTo(0, 0.25, 0.4, 0.13);
      ctx.bezierCurveTo(0.39, 0.71, -0.39, 0.71, -0.4, 0.13); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ef7e8b'; ctx.beginPath(); ctx.ellipse(0, 0.45, 0.22, 0.1, 0, 0, TAU); ctx.fill();
    } else if (id === 'cry') {
      curve(-0.5, -0.32, -0.29, -0.47, -0.13, -0.34);
      curve(0.13, -0.34, 0.29, -0.47, 0.5, -0.32);
      curve(-0.49, -0.13, -0.31, -0.05, -0.14, -0.13);
      curve(0.14, -0.13, 0.31, -0.05, 0.49, -0.13);
      ctx.fillStyle = '#8ce3ff'; ctx.strokeStyle = '#1b83b7'; ctx.lineWidth = 0.04;
      for (var side = -1; side <= 1; side += 2) {
        var x = side * 0.34;
        ctx.beginPath(); ctx.moveTo(x, -0.07); ctx.bezierCurveTo(x + 0.17, 0.17, x + 0.12, 0.43, x, 0.43);
        ctx.bezierCurveTo(x - 0.12, 0.43, x - 0.17, 0.17, x, -0.07); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = line; ctx.beginPath(); ctx.ellipse(0, 0.4, 0.14, 0.19, 0, 0, TAU); ctx.fill();
    } else {
      dot(-0.31, -0.18); dot(0.31, -0.18);
      if (id === 'smile') curve(-0.41, 0.12, 0, 0.65, 0.41, 0.12);
      if (id === 'sad') {
        brow(-0.49, -0.37, -0.18, -0.48); brow(0.18, -0.48, 0.49, -0.37);
        curve(-0.34, 0.45, 0, 0.1, 0.34, 0.45);
      }
      if (id === 'angry' || id === 'evil') {
        brow(-0.51, -0.45, -0.14, -0.28); brow(0.14, -0.28, 0.51, -0.45);
        if (id === 'angry') curve(-0.32, 0.43, 0, 0.16, 0.32, 0.43);
        else {
          ctx.beginPath(); ctx.moveTo(-0.45, 0.09); ctx.quadraticCurveTo(0, 0.4, 0.45, 0.09);
          ctx.quadraticCurveTo(0, 0.82, -0.45, 0.09); ctx.closePath(); ctx.fill();
          ctx.fillStyle = color || '#2f9bff';
          for (var tooth = -1; tooth <= 1; tooth += 2) {
            var tx = tooth * 0.23;
            ctx.beginPath(); ctx.moveTo(tx - 0.065, 0.24); ctx.lineTo(tx + 0.065, 0.24); ctx.lineTo(tx, 0.4); ctx.closePath(); ctx.fill();
          }
        }
      }
    }
    ctx.restore(); return true;
  }
  W.CosmeticArt = { face: face, ink: ink };
})();
