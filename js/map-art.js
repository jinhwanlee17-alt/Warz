/* warz.io: island map drawing shared by the HUD minimap and the full-screen map (M). */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, C = W.CONFIG;

  function dropLabels(g, drops, k, px, fontSize, dpr) {
    var center = px / 2, gap = 4 * dpr;
    function place(compact) {
      return drops.map(function (d) {
        var text = (compact ? '' : 'Drop ') + d.label, width = g.measureText(text).width;
        var x = d.x * k, y = d.y * k, dx = center - x, dy = center - y, distance = Math.max(1, Math.abs(dx), Math.abs(dy));
        return { text: text, width: width, dx: dx / distance, dy: dy / distance,
          x: U.clamp(x + dx / distance * (width / 2 + 10 * dpr), width / 2 + gap, px - width / 2 - gap),
          y: U.clamp(y + dy / distance * (fontSize * 0.7 + 10 * dpr), fontSize / 2 + gap, px - fontSize / 2 - gap) };
      });
    }
    function overlaps(a, b) { return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap && Math.abs(a.y - b.y) < fontSize + gap; }
    var labels = place(false);
    if (labels.some(function (a, i) { return labels.slice(0, i).some(function (b) { return overlaps(a, b); }); })) labels = place(true);
    labels.forEach(function (label, i) {
      // Tiny full-map viewports retain readable numbers by staggering crowded corner labels inward.
      for (var attempt = 0; attempt < 4 && labels.slice(0, i).some(function (other) { return overlaps(label, other); }); attempt++) {
        label.x = U.clamp(label.x + label.dx * (fontSize + gap), label.width / 2 + gap, px - label.width / 2 - gap);
        label.y = U.clamp(label.y + label.dy * (fontSize + gap), fontSize / 2 + gap, px - fontSize / 2 - gap);
      }
    });
    return labels;
  }

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
      var dropFont = Math.round(labelPx * 0.85);
      g.font = 'bold ' + dropFont + 'px Trebuchet MS, sans-serif';
      g.fillStyle = '#ffe9a8';
      g.textBaseline = 'middle';
      dropLabels(g, map.drops, k, px, dropFont, dpr).forEach(function (label) {
        g.strokeText(label.text, label.x, label.y);
        g.fillText(label.text, label.x, label.y);
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

  function legendaryMarker(g, crate, k, px, big, dpr) {
    var size = (big ? 8 : 5) * dpr, edge = 2 * dpr, pad = size + edge + dpr;
    var x = U.clamp(crate.x * k, pad, px - pad), y = U.clamp(crate.y * k, pad, px - pad);
    g.save(); g.globalAlpha = 1;
    // Gold planks, dark frame, crossed braces and a pale lock read as a crate even on the minimap.
    g.fillStyle = '#33260f'; g.fillRect(x - size - edge, y - size - edge, (size + edge) * 2, (size + edge) * 2);
    g.fillStyle = '#ffd44f'; g.fillRect(x - size, y - size, size * 2, size * 2);
    g.strokeStyle = '#9b6716'; g.lineWidth = 1.5 * dpr;
    g.strokeRect(x - size + dpr, y - size + dpr, size * 2 - dpr * 2, size * 2 - dpr * 2);
    g.beginPath(); g.moveTo(x - size + dpr, y - size + dpr); g.lineTo(x + size - dpr, y + size - dpr);
    g.moveTo(x + size - dpr, y - size + dpr); g.lineTo(x - size + dpr, y + size - dpr); g.stroke();
    g.fillStyle = '#fff1ae'; g.fillRect(x - 1.5 * dpr, y - 2 * dpr, 3 * dpr, 4 * dpr);
    g.restore();
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
      // Empty vehicles can be found on the map. Occupied enemies do not become free radar contacts.
      (world.vehicles || []).forEach(function (v) {
        if (v.hidden || v.wreck) return;
        var ids = Object.keys(v.seats || {}).map(function (seat) { return v.seats[seat]; }).filter(Boolean);
        if (ids.length && !ids.some(function (id) { var rider = world.playerById(id); return rider && rider.team === p.team; })) return;
        var tank = v.type === 'tank', carSize = (big ? (tank ? 7.5 : 6) : (tank ? 3.5 : 2.5)) * dpr;
        g.save(); g.translate(v.x * k, v.y * k); g.rotate(v.angle);
        g.fillStyle = ids.length ? '#8fe6ed' : tank ? '#a9bd78' : v.armed ? '#ffd477' : '#d8e9af'; g.strokeStyle = '#263329'; g.lineWidth = 1.5 * dpr;
        g.fillRect(-carSize, -carSize * 0.65, carSize * 2, carSize * 1.3); g.strokeRect(-carSize, -carSize * 0.65, carSize * 2, carSize * 1.3);
        if (tank) {
          g.strokeStyle = '#263329'; g.lineWidth = 2 * dpr; g.beginPath();
          g.moveTo(-carSize, -carSize * 0.65); g.lineTo(carSize, -carSize * 0.65); g.moveTo(-carSize, carSize * 0.65); g.lineTo(carSize, carSize * 0.65); g.stroke();
        }
        if (tank || v.armed) { g.strokeStyle = '#263329'; g.beginPath(); g.moveTo(0, 0); g.lineTo(carSize * (tank ? 1.9 : 1.5), 0); g.stroke(); }
        g.restore();
      });
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
        var youFont = Math.round(13 * dpr), labelPad = 3 * dpr, labelY = y - s * 2.8;
        g.save();
        g.font = 'bold ' + youFont + 'px Trebuchet MS, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 3 * dpr;
        g.strokeStyle = 'rgba(20,30,20,0.8)';
        g.fillStyle = '#ffffff';
        // Coastal spawns may touch the top edge: put their label below the arrow instead.
        if (labelY - youFont / 2 < labelPad) labelY = y + s * 2.8;
        labelY = U.clamp(labelY, youFont / 2 + labelPad, px - youFont / 2 - labelPad);
        var labelHalf = g.measureText('You').width / 2;
        var labelX = U.clamp(x, labelHalf + labelPad, px - labelHalf - labelPad);
        g.strokeText('You', labelX, labelY);
        g.fillText('You', labelX, labelY);
        g.restore();
      }
    }
    // This belongs to the live overlay: damage and reconnect state remove it immediately, without rebuilding terrain.
    (world.map.crates || []).forEach(function (crate) {
      if (world.remote && p && p.hidden) return; // Rejoin sync precedes the first authoritative player snapshot.
      if (crate.tier === 'legendary' && crate.alive && crate.hp > 0) legendaryMarker(g, crate, k, px, big, dpr);
    });
  }

  W.MapArt = { base: base, overlay: overlay };
}());
