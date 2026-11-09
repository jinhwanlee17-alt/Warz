/* warz.io: island map drawing shared by the HUD minimap and the full-screen map (M). */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, C = W.CONFIG;

  // Static terrain at `px` pixels square: ocean, sand, grass, trees, ponds, buildings, drop stations, town names.
  function base(map, px, opts) {
    opts = opts || {};
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    var g = canvas.getContext('2d'), S = map.size || C.worldSize, k = px / S, R = C.cornerRadius, big = !!opts.big;
    g.fillStyle = '#2f7fc2';
    g.fillRect(0, 0, px, px);
    g.save();
    g.scale(k, k);
    g.fillStyle = '#ecd9a0';
    g.beginPath();
    g.moveTo(R, 0); g.arcTo(S, 0, S, S, R); g.arcTo(S, S, 0, S, R); g.arcTo(0, S, 0, 0, R); g.arcTo(0, 0, S, 0, R);
    g.closePath(); g.fill();
    g.fillStyle = '#76b75a';
    g.beginPath();
    g.moveTo(map.coast[0], map.coast[1]);
    for (var i = 2; i < map.coast.length; i += 2) g.lineTo(map.coast[i], map.coast[i + 1]);
    g.closePath(); g.fill();
    if (big) {
      g.strokeStyle = 'rgba(28,64,20,0.08)';
      g.lineWidth = 6;
      g.beginPath();
      for (var gx = 0; gx <= S; gx += 800) { g.moveTo(gx, 0); g.lineTo(gx, S); g.moveTo(0, gx); g.lineTo(S, gx); }
      g.stroke();
    }
    g.fillStyle = '#3f8f3b';
    map.trees.forEach(function (t) { g.beginPath(); g.arc(t.x, t.y, t.r * 0.8, 0, U.TAU); g.fill(); });
    g.fillStyle = '#4aa3dc';
    map.ponds.forEach(function (p) { g.beginPath(); g.arc(p.x, p.y, p.r, 0, U.TAU); g.fill(); });
    map.buildings.forEach(function (b) {
      g.fillStyle = b.roof;
      g.fillRect(b.x, b.y, b.w, b.h);
      if (big) { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 8; g.strokeRect(b.x, b.y, b.w, b.h); }
    });
    g.strokeStyle = '#f2c230';
    g.lineWidth = big ? 40 : 34;
    map.drops.forEach(function (d) { g.beginPath(); g.arc(d.x, d.y, d.r, 0, U.TAU); g.stroke(); });
    g.restore();
    var labelPx = opts.labelPx || 9, dpr = opts.dpr || 1;
    g.font = 'bold ' + Math.round(labelPx) + 'px Trebuchet MS, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 3 * dpr;
    g.strokeStyle = 'rgba(20,30,20,0.7)';
    g.fillStyle = '#ffffff';
    map.towns.forEach(function (t) {
      g.strokeText(t.name, t.x * k, t.y * k - 4 * dpr);
      g.fillText(t.name, t.x * k, t.y * k - 4 * dpr);
    });
    if (big) {
      g.font = 'bold ' + Math.round(labelPx * 0.85) + 'px Trebuchet MS, sans-serif';
      g.fillStyle = '#ffe9a8';
      map.drops.forEach(function (d) {
        g.strokeText('Drop ' + d.label, d.x * k, d.y * k + labelPx * 0.35);
        g.fillText('Drop ' + d.label, d.x * k, d.y * k + labelPx * 0.35);
      });
    }
    return canvas;
  }

  // Every player uses the same directional arrow. Colour carries team identity,
  // and the dark outline keeps it readable against terrain and the storm.
  function playerArrow(g, player, k, px, size, color, dpr) {
    var pad = size * 1.6 + dpr * 2;
    var x = U.clamp(player.x * k, pad, px - pad), y = U.clamp(player.y * k, pad, px - pad);
    g.save();
    g.globalAlpha = 1;
    g.translate(x, y);
    g.rotate(Number.isFinite(player.angle) ? player.angle : 0);
    g.beginPath();
    g.moveTo(size * 1.5, 0); g.lineTo(-size, -size); g.lineTo(-size * 0.4, 0); g.lineTo(-size, size); g.closePath();
    g.fillStyle = color; g.fill();
    g.lineWidth = 2 * dpr; g.strokeStyle = '#15243a'; g.stroke();
    g.restore();
    return { x: x, y: y };
  }

  // Live layer: upgrade stations, storm circles, team structures and directional player markers.
  function overlay(g, world, p, px, opts) {
    opts = opts || {};
    var S = world.map.size || C.worldSize, k = px / S, dpr = opts.dpr || 1, big = !!opts.big, st = world.map.stations, i;
    // Demolition changes rock terrain during a match, so rocks belong to the
    // live map layer rather than the cached terrain image.
    if (big) {
      g.fillStyle = '#8f969e';
      world.map.rocks.forEach(function (r) {
        if (r.alive === false) return;
        g.beginPath(); g.arc(r.x * k, r.y * k, r.r * k, 0, U.TAU); g.fill();
      });
    }
    var dot = (big ? 4 : 1.5) * dpr;
    for (i = 0; i < st.length; i++) {
      var ready = st[i].cooldown <= 0;
      if (big) {
        g.beginPath(); g.arc(st[i].x * k, st[i].y * k, dot + 1.5 * dpr, 0, U.TAU);
        g.fillStyle = '#161c28'; g.fill();
      }
      g.fillStyle = ready ? '#5ee7ff' : '#ff7a8f';
      if (big) { g.beginPath(); g.arc(st[i].x * k, st[i].y * k, dot, 0, U.TAU); g.fill(); }
      else g.fillRect(st[i].x * k - dot, st[i].y * k - dot, dot * 2, dot * 2);
    }
    var storm = world.storm;
    if (storm) {
      g.beginPath();
      g.rect(0, 0, px, px);
      g.arc(storm.x * k, storm.y * k, Math.max(0.5, storm.r * k), 0, U.TAU, true);
      g.fillStyle = 'rgba(118,48,196,0.42)';
      g.fill('evenodd');
      g.strokeStyle = '#d7a6ff';
      g.lineWidth = (big ? 3 : 1.5) * dpr;
      g.beginPath(); g.arc(storm.x * k, storm.y * k, Math.max(0.5, storm.r * k), 0, U.TAU); g.stroke();
      if (storm.next && storm.state !== 'final') {
        g.setLineDash([4 * dpr, 3 * dpr]);
        g.strokeStyle = '#ffffff';
        g.beginPath(); g.arc(storm.next.x * k, storm.next.y * k, Math.max(1, storm.next.r * k), 0, U.TAU); g.stroke();
        g.setLineDash([]);
      }
    }
    if (p) {
      var md = (big ? 5 : 3.5) * dpr, arrowSize = (big ? 8 : 5.5) * dpr;
      world.structures.forEach(function (st) {
        if (!st.alive || st.team !== p.team || st.kind === 'rock') return;
        g.fillStyle = st.kind === 'teleporter' ? '#7fe9ff' : '#8cff6a';
        g.fillRect(st.x * k - md * 0.7, st.y * k - md * 0.7, md * 1.4, md * 1.4);
      });
      // Reveals stay visible for the entire active effect; no pulse or camera
      // bounds can make these full-island map markers blink away.
      world.revealedEnemies(p).forEach(function (o) {
        playerArrow(g, o, k, px, arrowSize, '#ff454f', dpr);
      });
      // Team coordinates are replicated across the whole island, including
      // allies outside the camera and downed allies. Their arrows stay blue.
      world.teammates(p).forEach(function (o) {
        if (o.alive) playerArrow(g, o, k, px, arrowSize, '#4fa3ff', dpr);
      });
    }
    if (p) {
      var s = (big ? 8 : 5.5) * dpr, self = playerArrow(g, p, k, px, s, '#ffffff', dpr), x = self.x, y = self.y;
      if (big) {
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.lineWidth = 2 * dpr;
        g.beginPath(); g.arc(x, y, s * 2.2, 0, U.TAU); g.stroke();
      }
      if (big) {
        g.font = 'bold ' + Math.round(13 * dpr) + 'px Trebuchet MS, sans-serif';
        g.textAlign = 'center';
        g.lineWidth = 3 * dpr;
        g.strokeStyle = 'rgba(20,30,20,0.8)';
        g.fillStyle = '#ffffff';
        g.strokeText('You', x, y - s * 2.8);
        g.fillText('You', x, y - s * 2.8);
      }
    }
  }

  W.MapArt = { base: base, overlay: overlay };
}());
