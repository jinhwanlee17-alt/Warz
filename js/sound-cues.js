/* Nearby sounds: exact screen bearings and a continuous distance colour scale. */
(function () {
  'use strict';
  var W = window.Warz, LIMIT = 6, LIFE = 1.8;
  var active = [], clock = 0, currentWorld = null, serial = 0, audioAt = {}, dom = null;
  var LABELS = { shot: 'Gunfire', gunfire: 'Gunfire', flame: 'Flames', explosion: 'Explosion', heal: 'Healing', healing: 'Healing',
    build: 'Building', building: 'Building', repair: 'Repairing', repairing: 'Repairing', throw: 'Grenade', grenade: 'Grenade',
    sentry: 'Sentry fire', artillery: 'Artillery', launch: 'Launcher', strike: 'Strike', reload: 'Reloading', consume: 'Supplies' };
  function range() { return (W.ITEMS && W.ITEMS.snowbomb ? W.ITEMS.snowbomb.radius : 750) * 7; }
  function validPoint(x, y) { return Number.isFinite(x) && Number.isFinite(y); }
  function distance(p, x, y) { return p && validPoint(x, y) ? Math.hypot(x - p.x, y - p.y) : Infinity; }
  function volume(p, x, y) { return Math.max(0, 1 - distance(p, x, y) / range()); }
  function colour(d) {
    var far = Math.max(0, Math.min(1, d / range()));
    return 'rgb(' + Math.round(255 - 185 * far) + ',' + Math.round(78 + 72 * far) + ',' + Math.round(70 + 185 * far) + ')';
  }
  function reset(world) { active = []; clock = 0; audioAt = {}; currentWorld = world || null; }
  function ensureWorld(world) { if (world !== currentWorld) reset(world); }
  function sourceId(p) { return p && typeof p === 'object' ? p.id : p || 0; }
  function add(p, kind, x, y, source, sound) {
    var d = distance(p, x, y);
    if (!(d < range())) return;
    var label = LABELS[kind] || kind, key = label + ':' + (sourceId(source) || Math.round(x / 90) + ',' + Math.round(y / 90));
    if (sound && W.Audio && (!audioAt[key] || clock >= audioAt[key])) {
      audioAt[key] = clock + 0.6;
      W.Audio.play(sound, volume(p, x, y) * 0.4);
    }
    // A sound at your own feet has no meaningful directional bearing.
    if (d < Math.max(8, (p && p.r || 0) * 0.5)) return;
    var cue = active.find(function (c) { return c.key === key; });
    if (!cue) {
      cue = { id: ++serial, key: key, label: label, x: x, y: y, seen: clock };
      active.push(cue);
    }
    cue.x = x; cue.y = y; cue.seen = clock;
    if (active.length > LIMIT) {
      active.sort(function (a, b) { return b.seen - a.seen || distance(p, a.x, a.y) - distance(p, b.x, b.y); });
      active.length = LIMIT;
    }
  }
  function position(e, fallback) {
    return validPoint(e.x, e.y) ? e : fallback && validPoint(fallback.x, fallback.y) ? fallback : null;
  }
  function process(world, p, events) {
    if (!world || !p) return;
    ensureWorld(world);
    (events || []).forEach(function (e) {
      var at, kind, owner = e.player || e.owner || e.source, sound = null;
      switch (e.type) {
        // The server uses this lightweight form for audible actions outside the visible scene.
        case 'sound': kind = e.kind || 'Sound'; at = position(e); sound = e.sound || null; break;
        case 'shot': case 'vehicle-shot': kind = 'shot'; at = position(e, e.player); break;
        case 'flame': kind = 'flame'; at = position(e, e.player); break;
        case 'melee': kind = 'Melee'; at = position(e, e.player); break;
        case 'sentry-shot': case 'sentry-projectiles': kind = 'sentry'; at = position(e, e.struct); owner = e.struct && ('s' + e.struct.id); break;
        case 'launch': case 'rpg-shot': kind = 'launch'; at = position(e, e.player); break;
        case 'artillery-shell':
          if (e.op === 'spawn') {
            kind = 'artillery'; owner = e.shell && e.shell.owner;
            at = position(e, e.shell && { x: e.shell.startX, y: e.shell.startY }); sound = 'launcher';
          }
          break;
        case 'artillery-shot': case 'artillery-launch': kind = 'artillery'; at = position(e, e.shell || e.vehicle); break;
        case 'tank-shell': if (e.op === 'spawn') { kind = 'artillery'; at = position(e, e.shell); owner = e.shell && e.shell.owner; } break;
        case 'explosion': case 'rpg-impact': case 'artillery-impact': kind = 'explosion'; at = position(e); owner = 0; break;
        case 'throw': kind = 'throw'; at = position(e, e.player); sound = e.player !== p ? 'throw' : null; break;
        case 'reload': kind = 'reload'; at = position(e, e.player); sound = e.player !== p ? 'reload' : null; break;
        case 'heal':
          kind = 'heal'; owner = e.by || e.player;
          at = position(e, e.by && e.by.medicStaff && e.by.medicStaff.placed ? e.by.medicStaff : e.by || e.player);
          if (e.player !== p) sound = 'heal';
          break;
        case 'repair': if (e.active) { kind = 'repair'; at = position(e, e.player || e.vehicle); sound = e.player !== p ? 'repair' : null; } break;
        case 'vehicle':
          if (e.op === 'repair') { kind = 'repair'; at = position(e, e.vehicle); }
          else if (e.op === 'wreck') { kind = 'explosion'; at = position(e, e.vehicle); owner = 0; }
          break;
        case 'struct':
          if (e.op === 'add' || e.op === 'upgrade') { kind = 'build'; at = position(e, e.struct); }
          else if (e.op === 'repair') { kind = 'repair'; at = position(e, e.struct); sound = 'repair'; }
          else if (e.op === 'gone' && e.reason !== 'recovered') { kind = 'Debris'; at = position(e, e.struct); }
          owner = e.struct && ('s' + e.struct.id); break;
        case 'strike': case 'strike-hit': kind = 'strike'; at = position(e, e.strike); owner = e.strike && e.strike.owner; break;
        case 'burst': kind = e.item === 'snowbomb' ? 'Snow' : e.item === 'firenade' ? 'Flames' : 'Grenade'; at = position(e); owner = 0; break;
        case 'zone': kind = e.zone && e.zone.kind === 'fire' ? 'Flames' : e.zone && e.zone.kind === 'snow' ? 'Snow' : 'Smoke'; at = position(e, e.zone); break;
        case 'item-used':
          if (W.ITEMS[e.item] && W.ITEMS[e.item].kind === 'consume') { kind = 'consume'; at = position(e, e.player); sound = e.player !== p ? 'drink' : null; }
          break;
        case 'buff': if (e.effect === 'regen') { kind = 'heal'; at = position(e, e.player); } break;
      }
      if (kind && at) add(p, kind, at.x, at.y, owner, sound);
    });
  }
  function continuous(world, p) {
    (world.players || []).forEach(function (o) {
      if (!o.alive || o.downed || o.hidden || o === p) return;
      if (o.sentryBuild) add(p, 'build', o.sentryBuild.x, o.sentryBuild.y, o.id, 'repair');
      if (o.sentryWork) add(p, o.sentryWork.kind === 'repair' ? 'repair' : 'build', o.x, o.y, o.id, 'repair');
      if (o.repairVehicle) add(p, 'repair', o.x, o.y, o.id, 'repair');
      if (o.regen > 0) add(p, 'heal', o.x, o.y, o.id, 'heal');
    });
  }
  function snapshot(p) {
    return active.filter(function (c) { return clock - c.seen < LIFE && distance(p, c.x, c.y) < range(); }).map(function (c) {
      var d = distance(p, c.x, c.y), angle = Math.atan2(c.y - p.y, c.x - p.x);
      return { id: c.id, label: c.label, x: c.x, y: c.y, distance: d, angle: angle, rotation: angle * 180 / Math.PI + 90,
        colour: colour(d), opacity: Math.min(1, (LIFE - (clock - c.seen)) / 0.7) };
    }).sort(function (a, b) { return a.distance - b.distance; });
  }
  function elements() {
    if (typeof document === 'undefined') return null;
    var root = document.getElementById('sound-cues'), list = document.getElementById('sound-cues-list');
    if (!root || !list) return null;
    if (!dom || dom.root !== root) dom = { root: root, list: list, nodes: {} };
    return dom;
  }
  function render(p) {
    var d = elements(); if (!d) return;
    var cues = p ? snapshot(p) : [], keep = {};
    d.root.hidden = !cues.length;
    cues.forEach(function (c) {
      var entry = d.nodes[c.id];
      if (!entry) {
        var row = document.createElement('div'), arrow = document.createElement('i'), label = document.createElement('span');
        row.className = 'sound-cue'; arrow.className = 'sound-cue-arrow'; arrow.setAttribute('aria-hidden', 'true');
        label.className = 'sound-cue-label'; row.appendChild(arrow); row.appendChild(label); d.list.appendChild(row);
        entry = d.nodes[c.id] = { row: row, arrow: arrow, label: label };
      }
      keep[c.id] = true; entry.label.textContent = c.label; entry.row.style.color = c.colour;
      entry.row.style.opacity = c.opacity.toFixed(2); entry.arrow.style.transform = 'rotate(' + c.rotation.toFixed(2) + 'deg)';
      entry.row.dataset.bearing = c.rotation.toFixed(2);
    });
    Object.keys(d.nodes).forEach(function (id) { if (!keep[id]) { d.nodes[id].row.remove(); delete d.nodes[id]; } });
  }
  function update(world, p, dt) {
    if (!world || !p) { reset(); render(null); return; }
    ensureWorld(world); clock += Math.max(0, Number.isFinite(dt) ? dt : 0);
    active = active.filter(function (c) { return clock - c.seen < LIFE; });
    continuous(world, p); render(p);
  }
  W.SoundCues = { range: range, volume: volume, process: process, update: update,
    clear: function () { reset(); render(null); }, snapshot: snapshot, colour: colour };
}());
