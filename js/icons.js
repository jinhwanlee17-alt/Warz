/* warz.io: inline SVG icons for the HUD and the upgrade tree. Class portraits reuse the in-game barrel shapes. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U;

  function barrelSvg(weaponId, cx, cy, r) {
    if (weaponId === 'hammer') return '<g transform="rotate(24 ' + cx + ' ' + cy + ')" stroke="#26333c" stroke-width="3"><rect x="' + (cx + r * 0.4) + '" y="' + (cy - r * 0.12) + '" width="' + r * 1.5 + '" height="' + r * 0.24 + '" rx="2" fill="#b9874c"/><rect x="' + (cx + r * 1.55) + '" y="' + (cy - r * 0.55) + '" width="' + r * 0.6 + '" height="' + r * 1.1 + '" rx="3" fill="#aab9c0"/></g>';
    var b = W.BARRELS[weaponId] || {}, out = '';
    var style = 'fill="#9aa1a9" stroke="#5d646c" stroke-width="3" stroke-linejoin="round"';
    if (b.parts) {
      b.parts.forEach(function (p) {
        out += '<rect x="' + (cx + p.x * r) + '" y="' + (cy - p.h * r / 2) + '" width="' + (p.len * r) + '" height="' + (p.h * r) + '" ' + style + '/>';
      });
    } else if (b.trap) {
      var t = b.trap, x0 = cx + t.x * r, x1 = cx + (t.x + t.len) * r;
      out += '<polygon points="' + x0 + ',' + (cy - t.h0 * r / 2) + ' ' + x1 + ',' + (cy - t.h1 * r / 2) + ' ' + x1 + ',' + (cy + t.h1 * r / 2) + ' ' + x0 + ',' + (cy + t.h0 * r / 2) + '" ' + style + '/>';
    }
    return out;
  }

  function emblemSvg(classId, cx, cy, r) {
    classId = classId.replace(/2$/, '');
    var c = 'rgba(255,255,255,0.92)';
    if (classId === 'pyromancer') return '<path d="M44 42C62 61 52 70 44 69C29 67 34 56 39 52L40 61Z" fill="' + c + '"/>';
    if (classId === 'juggernaut') return '<path d="M34 45H54L52 61L44 69L36 61Z" fill="none" stroke="' + c + '" stroke-width="3"/>';
    if (classId === 'commander') return '<path d="M34 52L44 46L54 52M34 59L44 53L54 59M34 66L44 60L54 66" fill="none" stroke="' + c + '" stroke-width="3"/>';
    if (classId === 'armorcrew') return '<g transform="rotate(-32 ' + cx + ' ' + cy + ')" fill="' + c + '"><rect x="' + (cx - r * 0.1) + '" y="' + cy + '" width="' + r * 0.2 + '" height="' + r * 0.6 + '" rx="1"/><rect x="' + (cx - r * 0.45) + '" y="' + (cy - r * 0.35) + '" width="' + r * 0.9 + '" height="' + r * 0.35 + '" rx="2"/></g>';
    if (classId === 'medic') {
      var a = r * 0.16, b = r * 0.5;
      return '<rect x="' + (cx - a) + '" y="' + (cy - b) + '" width="' + a * 2 + '" height="' + b * 2 + '" fill="' + c + '"/>' +
        '<rect x="' + (cx - b) + '" y="' + (cy - a) + '" width="' + b * 2 + '" height="' + a * 2 + '" fill="' + c + '"/>';
    }
    if (classId === 'sniper') {
      var s = r * 0.58, i = r * 0.18;
      return '<g stroke="' + c + '" stroke-width="' + r * 0.13 + '" fill="none" stroke-linecap="round"><circle cx="' + cx + '" cy="' + cy + '" r="' + r * 0.36 + '"/>' +
        '<path d="M' + (cx - s) + ' ' + cy + 'H' + (cx - i) + 'M' + (cx + i) + ' ' + cy + 'H' + (cx + s) + 'M' + cx + ' ' + (cy - s) + 'V' + (cy - i) + 'M' + cx + ' ' + (cy + i) + 'V' + (cy + s) + '"/></g>';
    }
    if (classId === 'shotgunner') {
      var dots = '';
      for (var k = 0; k < 3; k++) {
        var an = -Math.PI / 2 + k * Math.PI * 2 / 3;
        dots += '<circle cx="' + (cx + Math.cos(an) * r * 0.27) + '" cy="' + (cy + Math.sin(an) * r * 0.27) + '" r="' + r * 0.15 + '" fill="' + c + '"/>';
      }
      return dots;
    }
    if (classId === 'grenadier') {
      return '<circle cx="' + cx + '" cy="' + (cy + r * 0.1) + '" r="' + r * 0.3 + '" fill="' + c + '"/>' +
        '<rect x="' + (cx - r * 0.1) + '" y="' + (cy - r * 0.34) + '" width="' + r * 0.2 + '" height="' + r * 0.18 + '" fill="' + c + '"/>' +
        '<path d="M' + cx + ' ' + (cy - r * 0.34) + 'Q' + (cx + r * 0.25) + ' ' + (cy - r * 0.6) + ' ' + (cx + r * 0.42) + ' ' + (cy - r * 0.42) + '" stroke="' + c + '" stroke-width="' + r * 0.12 + '" fill="none" stroke-linecap="round"/>';
    }
    return '';
  }

  // A class portrait: the class colour on the body, its main weapon, and its emblem.
  function classIcon(classId, opts) {
    opts = opts || {};
    var cls = W.CLASSES[classId], cx = 44, cy = 56, r = 22, color = opts.color || cls.color;
    var weapon = cls.loadout[0];
    return '<svg class="' + (opts.className || 'class-icon') + '" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
      '<g transform="rotate(-32 ' + cx + ' ' + cy + ')">' + barrelSvg(weapon, cx, cy, r) + '</g>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + color + '" stroke="' + U.shade(color, -0.38) + '" stroke-width="4"/>' +
      emblemSvg(classId, cx, cy, r) + '</svg>';
  }

  var WEAPON_ART = {
    hammer: '<g transform="rotate(-28 32 16)"><rect x="9" y="13" width="36" height="7" rx="2" fill="#bc8c53"/><rect x="38" y="3" width="16" height="26" rx="3"/><rect x="40" y="5" width="4" height="22" fill="#b9cbd5"/></g>',
    ar: '<polygon points="2,11 13,13 13,19 2,22"/><rect x="13" y="12" width="34" height="7" rx="1"/><rect x="47" y="13.5" width="15" height="3.5"/>' +
      '<polygon points="26,19 32,19 30,29 24,29"/><polygon points="36,19 41,19 40,26 35,26"/><rect x="20" y="9" width="9" height="3"/>',
    pistol: '<rect x="18" y="9" width="31" height="8" rx="2"/><polygon points="20,17 30,17 28,30 18,30"/><path d="M30 17h6v3a3 3 0 0 1-3 3h-3z"/>',
    sniper: '<polygon points="2,12 15,14 15,20 2,23"/><rect x="15" y="14" width="22" height="6" rx="1"/><rect x="37" y="15.5" width="25" height="3"/>' +
      '<rect x="18" y="7" width="18" height="4.5" rx="2"/><rect x="21" y="11" width="3" height="3"/><rect x="31" y="11" width="3" height="3"/><polygon points="26,20 30,20 29,27 25,27"/>',
    shotgun: '<polygon points="2,12 17,13 17,20 2,23"/><rect x="17" y="13" width="18" height="7" rx="1"/><rect x="35" y="13" width="27" height="4"/>' +
      '<rect x="37" y="18" width="14" height="5" rx="2"/><polygon points="22,20 27,20 26,26 21,26"/>',
    deagle: '<rect x="13" y="7" width="37" height="10" rx="2"/><polygon points="15,17 27,17 25,31 14,31"/><path d="M27 17h7v3a4 4 0 0 1-4 4h-3z"/>',
    launcher: '<rect x="4" y="11" width="13" height="8" rx="2"/><rect x="16" y="7" width="43" height="12" rx="3"/><rect x="55" y="6" width="5" height="14" rx="1"/>' +
      '<circle cx="31" cy="22" r="7"/><polygon points="40,19 46,19 44,27 38,27"/>',
    grenade: '<circle cx="32" cy="20" r="10"/><rect x="28" y="6" width="8" height="5" rx="1"/><path d="M36 8h7v4h-4l-3 2z"/>' +
      '<circle cx="24" cy="9" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>',
    medkit: '<rect x="14" y="7" width="36" height="22" rx="4"/><rect x="27" y="3" width="10" height="5" rx="1.5"/>' +
      '<rect x="29.5" y="11" width="5" height="14" fill="#ff4d63"/><rect x="25" y="15.5" width="14" height="5" fill="#ff4d63"/>'
  };

  WEAPON_ART.shotgun2 = WEAPON_ART.shotgun + '<rect x="35" y="7" width="27" height="3"/><path d="M7 6l2-4 2 4 4 1-3 3 1 4-4-2-4 2 1-4-3-3z" fill="#ffd76c"/>';
  WEAPON_ART.sniper2 = WEAPON_ART.sniper + '<rect x="48" y="13" width="14" height="7" rx="2"/><circle cx="27" cy="9" r="2" fill="#70d9ff"/>';
  WEAPON_ART.launcher2 = WEAPON_ART.launcher + '<rect x="20" y="9" width="3" height="8" fill="#ffbf66"/><rect x="27" y="9" width="3" height="8" fill="#ffbf66"/>';
  WEAPON_ART.medkit2 = WEAPON_ART.medkit + '<path d="M7 12l3 5 5-9M49 23l3 5 6-10" fill="none" stroke="#62e0a6" stroke-width="3"/>';
  WEAPON_ART.revolver = '<rect x="29" y="9" width="30" height="6" rx="2"/><circle cx="28" cy="16" r="8"/><circle cx="28" cy="16" r="3" fill="#172136"/><path d="M18 16h10l-5 15H12zM21 9l-4-5h6l4 5z"/>';
  WEAPON_ART.minigun = '<rect x="5" y="9" width="19" height="16" rx="3"/><path d="M24 8H60V12H24zM24 15H60V19H24zM24 22H60V26H24z"/><rect x="46" y="6" width="5" height="22"/><rect x="12" y="24" width="8" height="7"/>';
  WEAPON_ART.flamethrower = '<rect x="5" y="8" width="13" height="22" rx="5"/><rect x="19" y="12" width="27" height="7" rx="2"/><path d="M23 19h7l-2 11h-7z"/><path d="M47 17C52 10 52 6 51 3C61 9 63 16 58 22C53 26 49 22 47 17Z" fill="#ff9e40"/>';
  WEAPON_ART.commandpistol = '<rect x="15" y="8" width="37" height="9" rx="2"/><path d="M17 17h11l-2 14H15z"/><path d="M34 5l4 3 4-3M34 21l4 3 4-3" fill="none" stroke="#ffd76c" stroke-width="2"/>';
  WEAPON_ART.commandradar = '<circle cx="32" cy="17" r="13" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="32" cy="17" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M32 17L42 7M32 3V6M18 17H21M43 17H46M32 28V31" stroke="#75cfff" stroke-width="2"/><circle cx="26" cy="13" r="2" fill="#ff6464"/>';

  function weaponIcon(id, className) {
    return '<svg class="' + (className || 'weapon-icon') + '" viewBox="0 0 64 32" fill="currentColor" aria-hidden="true" focusable="false">' + WEAPON_ART[id] + '</svg>';
  }

  // Shared by the HUD, inventory, pickups and held items. Every item has a distinct
  // silhouette or a large emblem, so rarity colour is never the only distinction.
  // Keep the 48px art inside a 3px margin; slot keys/counts belong outside the art.
  var OUTLINE = '#172235';
  function art(body) {
    return '<g stroke="' + OUTLINE + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' + body + '</g>';
  }
  function emblem(body) {
    return '<g fill="#f5fcff" stroke="none">' + body + '</g>';
  }
  var CROSS = '<path d="M21 22h6v5h5v6h-5v5h-6v-5h-5v-6h5z"/>';
  function flask(shape, color, mark, cap) {
    return art('<path d="' + shape + '" fill="' + color + '"/>' +
      '<path d="M19 12h10" stroke="#effbff" stroke-opacity=".75"/>' +
      '<rect x="18" y="4" width="12" height="6" rx="2" fill="' + (cap || '#d1dce4') + '"/>') + emblem(mark);
  }
  var ROUND_FLASK = 'M19 10h10v7c7 3 12 8 12 14 0 8-7 13-17 13S7 39 7 31c0-6 5-11 12-14z';
  var ANGLED_FLASK = 'M19 10h10v8l12 18-4 8H11l-4-8 12-18z';
  var TALL_FLASK = 'M19 10h10v8l7 5v17l-4 4H16l-4-4V23l7-5z';
  var ITEM_ART = {
    bandage: art('<g transform="rotate(-30 24 24)"><rect x="4" y="14" width="40" height="20" rx="9" fill="#f5e5c8"/>' +
      '<rect x="17" y="15" width="14" height="18" rx="3" fill="#fffaf0"/><path d="M9 20v1m0 6v1m30-8v1m0 6v1" stroke="#b59974"/></g>'),
    flashbang: art('<path d="M18 12V7h12v5" fill="#b9c4cf"/><rect x="12" y="12" width="24" height="30" rx="5" fill="#e8f4fc"/>' +
      '<path d="M8 11 5 8m35 3 3-3M7 23H4m37 0h3" stroke="#fff2a8"/>') +
      emblem('<path d="m24 16 3 7 7 3-7 3-3 8-3-8-7-3 7-3z" fill="#f2b839"/>'),
    grenade: art('<path d="M18 13V7h12v6" fill="#bcc7cf"/><path d="M30 7h8v11" fill="none"/>' +
      '<path d="M16 14h16l7 11-2 12-7 7H18l-7-7-2-12z" fill="#7ca450"/>' +
      '<path d="M12 25h24m-23 10h22M21 16l-2 26m8-26 2 26" fill="none" stroke="#3d5c2e"/>'),
    smoke: art('<path d="M15 15c-7-3-1-10 5-6-1-7 10-8 12-2 8-2 12 7 5 11" fill="#d9e1ed"/>' +
      '<rect x="13" y="18" width="22" height="26" rx="4" fill="#77869b"/><path d="M13 23h22m-17 7h12m-12 7h12" stroke="#e0e8f1"/>'),
    smoothie: art('<path d="M28 13 33 4h7" fill="none" stroke="#ff688e" stroke-width="4"/>' +
      '<path d="m12 17 4 27h17l4-27" fill="#ff8fb8"/><rect x="10" y="13" width="29" height="6" rx="3" fill="#fff6e8"/>' +
      '<path d="M18 25h13" stroke="#ffd6e5"/>') + emblem('<path d="M25 36c-8-4-7-9-3-9 2 0 3 2 3 2s1-2 3-2c4 0 5 5-3 9z"/>'),
    energybar: art('<path d="m4 13 5 2 4-2 22 0 4 2 5-2v24l-5-2-4 2H13l-4-2-5 2z" fill="#ffd65c"/>' +
      '<path d="M12 15v20m24-20v20" stroke="#b68428"/>') +
      emblem('<path d="m26 17-9 11h7l-2 7 10-12h-7z" fill="#8b4c29"/>'),
    firenade: art('<path d="M18 13V7h11v6m0-6h8v10" fill="#d7e0e8"/>' +
      '<path d="m15 13-4 11v14l6 6h14l6-6V24l-4-11z" fill="#f16a25"/><path d="M13 21h22" stroke="#ffb458"/>') +
      emblem('<path d="M24 23c1 6 8 7 8 13a8 8 0 0 1-16 0c0-4 3-7 5-8 0 4 2 4 2 4 2-3 1-6 1-9z" fill="#fff1a8"/>'),
    shieldo: art('<path d="M17 7h14v7H17z" fill="#b6efff"/><path d="M15 14h18l7 10v14l-6 6H14l-6-6V24z" fill="#27bcd3"/>' +
      '<path d="M15 22h18" stroke="#97f6ff"/>') +
      emblem('<path d="m24 24 10 3v6c0 5-5 8-10 10-5-2-10-5-10-10v-6z" fill="#e2fcff"/><path d="m24 28 5 2v3c0 3-2 5-5 7-3-2-5-4-5-7v-3z" fill="#1693b9"/>'),
    firstaid: art('<path d="M17 14V7h14v7" fill="none" stroke="#d0dae4" stroke-width="4"/>' +
      '<rect x="4" y="14" width="40" height="29" rx="6" fill="#f5fbff"/><path d="M9 19h30" stroke="#cddce4"/>') +
      emblem('<path d="M21 22h6v6h6v6h-6v6h-6v-6h-6v-6h6z" fill="#ef5268"/>'),
    strength: flask(ANGLED_FLASK, '#d45b58', '<path d="M16 34v-8h4v-4h5v4h7v11H20z"/>'),
    speed: flask(TALL_FLASK, '#38bcd1', '<path d="m19 23 8 6-8 6v-5l4-1-4-1zm8 0 8 6-8 6v-5l4-1-4-1z"/>'),
    health: flask(ROUND_FLASK, '#f05b7f', '<path d="M24 39c-15-8-12-18-5-16 3 0 5 4 5 4s2-4 5-4c7-2 10 8-5 16z"/>'),
    shield: flask(ANGLED_FLASK, '#4c8fe8', '<path d="m24 23 9 3v6c0 5-5 8-9 10-4-2-9-5-9-10v-6z"/><path d="M24 27v10" stroke="#3e77c8" stroke-width="2.5"/>'),
    poison: flask(TALL_FLASK, '#78bc45', '<path d="M16 29a8 8 0 0 1 16 0v4l-4 2v5h-8v-5l-4-2z"/><circle cx="21" cy="30" r="2" fill="#314d27"/><circle cx="27" cy="30" r="2" fill="#314d27"/><path d="M23 36h2v5h-2z" fill="#314d27"/>', '#5c4639'),
    mystery: flask(ANGLED_FLASK, '#a97cda', '<path d="M18 28c0-7 12-7 12-1 0 4-6 4-6 8" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="40" r="2"/>'),
    drone: art('<path d="m14 14 20 20m0-20L14 34" stroke="#b6c5d8" stroke-width="5"/>' +
      '<circle cx="11" cy="11" r="7" fill="#38485b"/><circle cx="37" cy="11" r="7" fill="#38485b"/><circle cx="11" cy="37" r="7" fill="#38485b"/><circle cx="37" cy="37" r="7" fill="#38485b"/>' +
      '<path d="M7 11h8m18 0h8M7 37h8m18 0h8" stroke="#d7b5ff"/>' +
      '<rect x="17" y="16" width="14" height="17" rx="4" fill="#a17bd0"/><circle cx="24" cy="26" r="3" fill="#e2f9ff"/>'),
    rock: art('<path d="m4 32 6-17L25 5l16 12 3 19-12 8H13z" fill="#9da9b5"/>' +
      '<path d="m10 15 14 5 1-15m-1 15 8 24m-8-24 17-3M4 32l20-12" fill="none" stroke="#667585"/>'),
    riotshield: art('<path d="m10 5 28 0 4 7v24l-6 8H12l-6-8V12z" fill="#416083"/>' +
      '<rect x="12" y="12" width="24" height="10" rx="2" fill="#a4deed"/><path d="M12 28h24m-18 6h12" stroke="#b1c7dc"/>'),
    blackhole: art('<ellipse cx="24" cy="26" rx="20" ry="9" transform="rotate(-32 24 26)" fill="#9461e3"/>' +
      '<circle cx="24" cy="26" r="12" fill="#1d123b" stroke="#d3a5ff"/><path d="M19 18c8-5 14 4 10 9" fill="none" stroke="#7552a5"/>' +
      '<path d="M21 11V5h7v6" fill="#a9b4ce"/>'),
    snowbomb: art('<path d="M19 11V5h10v6" fill="#e9f9ff"/>' +
      '<path d="m24 11 15 8 0 17-15 9-15-9V19z" fill="#79c6e9"/>') +
      '<g fill="none" stroke="#f3ffff" stroke-width="2.8" stroke-linecap="round"><path d="M24 18v21M15 23l18 11m0-11L15 34M21 20l3 3 3-3m-6 17 3-3 3 3M15 27l4-1 1-4m9 13 1-4 4-1M28 22l1 4 4 1M15 30l4 1 1 4"/></g>',
    overheal: flask(ROUND_FLASK, '#d15dc0', CROSS + '<path d="m17 20 7-7 7 7h-5v2h-4v-2z"/>'),
    invisibility: flask(TALL_FLASK, '#7891b4', '<path d="M14 30c6-10 14-10 20 0-6 10-14 10-20 0z" fill="none" stroke="#f2faff" stroke-width="2.5"/><circle cx="24" cy="30" r="3"/><path d="m15 39 18-18" stroke="#172235" stroke-width="5"/><path d="m15 39 18-18" stroke="#f2faff" stroke-width="2.5"/>', '#8ba6bf'),
    radar: art('<circle cx="24" cy="24" r="20" fill="#193f43" stroke="#75d8ac"/>' +
      '<circle cx="24" cy="24" r="12" fill="none" stroke="#3b7969"/><path d="M24 5v19l14 13M5 24h38M24 24v19" fill="none" stroke="#3b7969"/>' +
      '<path d="M24 24V6a18 18 0 0 1 15 8z" fill="#81e9b0" stroke="none"/><circle cx="14" cy="29" r="3" fill="#aaf8d5"/><circle cx="29" cy="35" r="3" fill="#aaf8d5"/>'),
    teleporter: art('<ellipse cx="24" cy="37" rx="20" ry="7" fill="#375a77" stroke="#82e9ff"/>' +
      '<ellipse cx="24" cy="37" rx="11" ry="3" fill="#162b49" stroke="#47b4f0"/><path d="M13 32V17a11 11 0 0 1 22 0v15" fill="none" stroke="#bba3ff" stroke-width="5"/>') +
      emblem('<path d="m26 15 7 7-7 7v-5H16v-4h10z" fill="#c0f6ff"/>'),
    lightning: art('<path d="M22 4h18L28 20h11L17 44l4-18H9z" fill="#ffe36a" stroke="#8a5d1b"/>' +
      '<path d="M9 8 5 5m3 31-4 3m35-5 4 3" fill="none" stroke="#fff2bd"/>'),
    power: flask(ANGLED_FLASK, '#9b62cf', '<path d="m25 20-9 12h8l-3 10 12-16h-8z" fill="#fff2a8"/>', '#ccaff6'),
    power2: art('<path d="M16 13h16v5l10 16-4 10H10L6 34l10-16z" fill="#e3a332"/>' +
      '<path d="m14 5 6 5 4-6 4 6 6-5-2 10H16z" fill="#fff0a0"/>') +
      emblem('<path d="m24 20 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z"/>'),
    meteor: art('<path d="m13 21 10-14-2 12L42 4l-9 20 10-4-11 17" fill="#ffb63c" stroke="#9e4d23"/>' +
      '<path d="m7 23 10-5 14 7 3 12-9 7-14-2-7-9z" fill="#ba6553"/>' +
      '<path d="m11 28 5-3 5 4-3 5-6-1m13 4 3-4" fill="none" stroke="#6d3d42"/>')
  };

  function rankPips(rank, y, color) {
    var out = '';
    for (var i = 0; i < rank; i++) out += '<rect x="' + (24 - rank * 3 + i * 6) + '" y="' + y + '" width="4" height="3" rx=".7" fill="' + color + '" stroke="none"/>';
    return out;
  }
  function turretArt(rank, color) {
    var barrels = rank === 1 ? '<rect x="27" y="17" width="17" height="7" rx="1" fill="#d8e0e8"/>' :
      '<rect x="27" y="13" width="17" height="6" rx="1" fill="#d8e0e8"/><rect x="27" y="23" width="17" height="6" rx="1" fill="#d8e0e8"/>';
    if (rank === 3) barrels += '<rect x="29" y="18" width="15" height="6" rx="1" fill="#fff0bd"/>';
    return art('<path d="M19 27h10v10H19z" fill="#67778b"/><path d="m8 36 8-5h16l8 5v8H8z" fill="#46566c"/>' +
      '<path d="M9 23v8h9" fill="none" stroke="#c5d4e2" stroke-width="4"/>' + barrels +
      '<path d="m14 12 15-3v20H14l-4-7z" fill="' + color + '"/><path d="M18 17v7" stroke="#f6f7ff"/>' +
      (rank === 3 ? '<path d="m11 10 7-5 11 3" fill="#ffdd89"/>' : '') + rankPips(rank, 39, '#f6f7ff'));
  }
  function sentryArt(rank, color) {
    var barrels = '<rect x="34" y="19" width="10" height="5" rx="1" fill="#a5b8cb"/>';
    if (rank > 1) barrels += '<rect x="4" y="19" width="10" height="5" rx="1" fill="#a5b8cb"/>';
    return art('<path d="m18 33-9 10m21-10 9 10M24 33v11" fill="none" stroke="#a2b5c9" stroke-width="4"/>' +
      '<path d="M19 29h10v7H19z" fill="#354b62"/><path d="M24 12V6" stroke="#a2b5c9"/><circle cx="24" cy="5" r="2" fill="#f6c979"/>' +
      barrels + '<rect x="12" y="12" width="24" height="19" rx="' + (rank === 3 ? 2 : 5) + '" fill="' + color + '"/>' +
      '<rect x="16" y="17" width="16" height="8" rx="3" fill="#253047"/>' +
      (rank === 1 ? '<circle cx="24" cy="21" r="3" fill="#ff7467" stroke="none"/>' :
        '<path d="M19 21h3m4 0h3" stroke="#ff8774" stroke-width="3"/>') +
      (rank === 3 ? '<path d="m12 12 5-4h14l5 4" fill="#ffe4a1"/>' : '') + rankPips(rank, 27, '#f6f7ff'));
  }
  ['turret', 'sentry'].forEach(function (kind) {
    for (var rank = 1; rank <= 3; rank++) {
      var id = kind + (rank === 1 ? '' : rank), color = W.TIERS[W.ITEMS[id].tier].color;
      ITEM_ART[id] = kind === 'turret' ? turretArt(rank, color) : sentryArt(rank, color);
    }
  });
  function itemIcon(id, className) {
    if (!W.ITEMS[id] || !ITEM_ART[id]) return '';
    return '<svg xmlns="http://www.w3.org/2000/svg" class="' + (className || 'item-icon') + '" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' + ITEM_ART[id] + '</svg>';
  }

  // Eagerly decode the same SVGs for canvas rendering. Returning null until an
  // image is ready lets the renderer use its lightweight first-frame fallback.
  var ITEM_IMAGES = Object.create(null);
  function itemImage(id) {
    if (!ITEM_ART[id] || typeof Image === 'undefined') return null;
    if (!ITEM_IMAGES[id]) {
      var img = ITEM_IMAGES[id] = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(itemIcon(id));
    }
    var cached = ITEM_IMAGES[id];
    return cached.complete && cached.naturalWidth > 0 ? cached : null;
  }
  if (typeof Image !== 'undefined') Object.keys(ITEM_ART).forEach(itemImage);

  var TOKEN = '<svg class="token-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13" fill="#ffd23f" stroke="#b8860b" stroke-width="3"/>' +
    '<polygon points="16,7.5 18.2,13.6 24.5,13.8 19.5,17.7 21.3,24 16,20.3 10.7,24 12.5,17.7 7.5,13.8 13.8,13.6" fill="#fff2b0"/></svg>';
  var KEY = '<svg class="key-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 16h14M23 16v5M27 16v4" stroke="#4b2a80" stroke-width="7"/><circle cx="9" cy="16" r="6" stroke="#4b2a80" stroke-width="7"/>' +
    '<path d="M14 16h14M23 16v5M27 16v4" stroke="#c9a2ff" stroke-width="3.5"/><circle cx="9" cy="16" r="6" stroke="#c9a2ff" stroke-width="3.5"/></g></svg>';
  var LOCK = '<svg class="lock-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M10 14v-3a6 6 0 0 1 12 0v3" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<rect x="7" y="14" width="18" height="13" rx="3" fill="currentColor"/></svg>';

  W.Icons = { classIcon: classIcon, weaponIcon: weaponIcon, itemIcon: itemIcon, itemImage: itemImage, TOKEN: TOKEN, KEY: KEY, LOCK: LOCK };
}());
