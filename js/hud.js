/* warz.io: in-match HUD (DOM) plus the minimap canvas. Writes to the DOM only when a value changes. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, C = W.CONFIG, WEAPONS = W.WEAPONS, CLASSES = W.CLASSES, Icons = W.Icons, Controls = W.Controls;
  var el = {}, cache = {}, mini = null, bannerTimer = 0, lastClass = null, lastWeaponsKey = '', modeLabel = 'Solo', teamKey = '', buffKey = '';
  var ITEMS = W.ITEMS;
  var BUFF_LABELS = {
    command: 'Command boost · +25% damage, speed, fire rate',
    energy: 'Energy bar · +15% speed', speed: 'Speed potion · +15%', strength: 'Strength · +10% dmg', shield: 'Shield · −15% dmg taken', poison: 'Poisoned · −10 HP/s, slowed',
    invisible: 'Invisible', power: 'Power potion', immune: 'Immune', reduce: 'Shieldo · −50% dmg taken', deathImmune: 'Death immunity', radar: 'Radar',
    regen: 'First aid · healing', drone: 'Drone · enemies on the map', snow: 'In a blizzard · slowed', mount: 'On a turret'
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function set(key, node, prop, value) {
    if (!node || cache[key] === value) return;
    cache[key] = value;
    if (prop === 'text') node.textContent = value;
    else if (prop === 'html') node.innerHTML = value;
    else if (prop === 'width') node.style.width = value;
    else if (prop === 'hidden') node.hidden = value;
    else if (prop === 'class') node.className = value;
  }

  function init() {
    ['hud', 'hud-tokens', 'hud-token-count', 'hud-token-pips', 'hud-key-count', 'hud-upgrade-ready', 'hud-storm', 'hud-storm-text',
      'hud-lobby', 'hud-feed', 'minimap', 'hud-class-icon', 'hud-class-name', 'hud-class-tier', 'hud-hp-fill', 'hud-hp-text',
      'hud-armor-fill', 'hud-armor-text', 'hud-stamina', 'hud-stamina-fill', 'hud-stamina-text', 'hud-prompt', 'hud-ammo', 'hud-ammo-max', 'hud-ammo-label', 'hud-reload',
      'hud-reload-fill', 'hud-slots', 'hud-banner', 'vignette', 'hud-token-icon', 'hud-key-icon', 'hud-keys', 'hud-team', 'hud-spectate',
      'hud-buffs', 'flash'].forEach(function (id) {
      el[id] = $(id);
    });
    el['hud-token-icon'].innerHTML = Icons.TOKEN;
    el['hud-key-icon'].innerHTML = Icons.KEY;
    refreshHints();
  }

  // Key hints follow the player's bindings.
  function refreshHints() {
    var k = function (a) { return '<kbd>' + esc(Controls.primary(a)) + '</kbd>'; };
    el['hud-keys'].innerHTML =
      '<span>' + k('interact') + ' pick up / station / revive / mount</span><span>' + k('weapon1') + '…' + k('item3') + ' hotbar · click to use</span>' +
      '<span>' + k('drop') + ' drop held item</span><span>' + k('inventory') + ' inventory</span><span>' + k('sprint') + ' sprint</span>' +
      '<span>' + k('map') + ' map · ' + k('reload') + ' reload</span>' +
      '<span>' + k('weapon1') + k('weapon2') + ' / wheel switch weapons</span><span><kbd>Esc</kbd> menu</span>';
    lastWeaponsKey = '';
    delete cache.prompt;
  }

  // Three item cards join the two class weapon/gear cards in one five-slot row.
  function buildHotbar(p) {
    var html = '';
    for (var i = 0; i < p.items.length; i++) {
      var s = p.items[i], it = s ? ITEMS[s.id] : null;
      html += '<div class="slot item-slot' + (p.held === i ? ' selected' : '') + (it ? ' has-item tier-' + it.tier : ' empty') + '" data-slot="' + i + '" title="' +
        (it ? esc(it.name) + ' (' + W.TIERS[it.tier].name + ') · ' + esc(it.blurb) : 'Empty slot') + '">' +
        '<span class="slot-key">' + esc(Controls.primary('item' + (i + 1))) + '</span>' +
        (it ? Icons.itemIcon(s.id, 'slot-icon item-slot-icon') + '<span class="slot-name">' + esc(it.name) + '</span><span class="slot-state">×' + s.n + '</span>' :
          '<span class="slot-empty-art" aria-hidden="true">+</span><span class="slot-name">Empty</span><span class="slot-state">Item</span>') + '</div>';
    }
    return html;
  }

  // Active potion effects and states as small pills.
  function updateBuffs(world, p) {
    var parts = [], i, k;
    if (p.commandBuff > 0) parts.push('command:' + Math.ceil(p.commandBuff));
    for (i = 0; i < W.FX_KEYS.length; i++) { k = W.FX_KEYS[i]; if (k !== 'flash' && p.fx[k] > 0) parts.push(k + ':' + Math.ceil(p.fx[k])); }
    if (p.regen > 0) parts.push('regen:' + Math.ceil(p.regen) + ' HP');
    if ((world.reveal[p.team] || 0) > 0) parts.push('drone:' + Math.ceil(world.reveal[p.team]));
    if (p.inSnow && p.alive) parts.push('snow:');
    if (p.mount) parts.push('mount:');
    var key = parts.join('|');
    if (key === buffKey) return;
    buffKey = key;
    el['hud-buffs'].innerHTML = parts.map(function (s) {
      var kv = s.split(':');
      return '<span class="buff buff-' + kv[0] + '">' + BUFF_LABELS[kv[0]] + (kv[1] ? ' <b>' + esc(kv[1]) + (/HP/.test(kv[1]) ? '' : 's') + '</b>' : '') + '</span>';
    }).join('');
  }

  function show(on) { el.hud.hidden = !on; }

  function reset(world, player, label) {
    cache = {};
    lastClass = null;
    lastWeaponsKey = '';
    buffKey = '';
    teamKey = '';
    el['hud-buffs'].innerHTML = '';
    el.flash.style.opacity = 0;
    modeLabel = label || 'Solo';
    el['hud-feed'].innerHTML = '';
    el['hud-banner'].hidden = true;
    el['hud-team'].innerHTML = '';
    el['hud-team'].hidden = true;
    el['hud-spectate'].hidden = true;
    buildMinimap(world.map);
    update(world, player, 0, {});
  }

  function buildSlots(p) {
    var html = '', gearKey = esc(Controls.primary('gear'));
    p.weapons.forEach(function (w, i) {
      var def = WEAPONS[w.id], gear = def.kind === 'throwable' || def.kind === 'medkit' || def.kind === 'ability';
      html += '<div class="slot" id="hud-slot-' + i + '" data-kind="' + def.kind + '">' +
        '<span class="slot-key">' + esc(Controls.primary('weapon' + (i + 1))) + (gear ? '<em>' + gearKey + '</em>' : '') + '</span>' +
        Icons.weaponIcon(w.id, 'slot-icon') +
        '<span class="slot-name">' + def.name + '</span>' +
        '<span class="slot-state" id="hud-slot-state-' + i + '"></span>' +
        '<i class="slot-cooldown" id="hud-slot-cd-' + i + '"></i></div>';
    });
    el['hud-slots'].innerHTML = html + buildHotbar(p);
  }

  function slotState(p, w) {
    var def = WEAPONS[w.id];
    if (def.kind === 'throwable') return '×' + p.grenades;
    if (def.kind === 'medkit') return p.medkitCd > 0 ? Math.ceil(p.medkitCd) + 's' : 'Ready';
    if (def.kind === 'ability') return p.commandCd > 0 ? Math.ceil(p.commandCd) + 's' : 'Ready';
    if (w.reloading) return 'Reloading';
    return w.ammo + '/' + def.mag;
  }

  // Teammates panel: name, HP, state. Only in team modes.
  function updateTeam(world, p) {
    if (!world.teams) { set('teamh', el['hud-team'], 'hidden', true); return; }
    var mates = world.teammates(p), key = mates.map(function (o) {
      return o.id + ':' + Math.ceil(o.hp) + ':' + (o.alive ? (o.downed ? 'd' + Math.ceil(o.downT) : 'a') : 'x') + ':' + o.classId;
    }).join('|');
    set('teamh', el['hud-team'], 'hidden', mates.length === 0);
    if (key === teamKey) return;
    teamKey = key;
    el['hud-team'].innerHTML = mates.map(function (o) {
      var k = U.clamp(o.hp / o.maxHp, 0, 1), state = !o.alive ? 'Eliminated' : o.downed ? 'Downed · ' + Math.ceil(o.downT) + 's' : CLASSES[o.classId].name;
      return '<div class="mate' + (!o.alive ? ' is-dead' : o.downed ? ' is-downed' : '') + '">' +
        '<span class="mate-icon">' + Icons.classIcon(o.classId, { color: o.color }) + '</span>' +
        '<div class="mate-body"><b>' + esc(o.name) + '</b><small>' + state + '</small>' +
        '<div class="mate-bar"><i style="width:' + (o.alive ? (k * 100).toFixed(0) : 0) + '%"></i></div></div></div>';
    }).join('');
  }

  function nearestDowned(world, p) {
    var best = null, bd = 70 + p.r;
    world.teammates(p).forEach(function (o) {
      if (!o.alive || !o.downed) return;
      var d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d <= bd) { bd = d; best = o; }
    });
    return best;
  }

  function update(world, p, dt, extra) {
    if (!p) return;
    extra = extra || {};
    var cls = CLASSES[p.classId], i, key = esc(Controls.primary('interact'));
    set('tokens', el['hud-token-count'], 'text', String(p.tokens));
    var upgradeCost = W.Rules.nextUpgradeCost(p.classId), pips = '', have = Math.min(upgradeCost, p.tokens);
    for (i = 0; i < upgradeCost; i++) pips += '<i class="' + (i < have ? 'on' : '') + '"></i>';
    set('pips', el['hud-token-pips'], 'html', pips);
    set('pipsh', el['hud-token-pips'], 'hidden', upgradeCost === 0);
    set('keys', el['hud-key-count'], 'text', String(p.keys));
    var canUpgrade = W.Rules.childClasses(p.classId).length > 0;
    set('ready', el['hud-upgrade-ready'], 'hidden', !(canUpgrade && p.tokens >= upgradeCost && p.alive && !p.downed));

    var storm = world.storm, stormText = 'No storm', stormClass = 'pill';
    if (storm) {
      if (storm.state === 'waiting') stormText = (storm.phase === 0 ? 'Storm forms in ' : 'Storm moves in ') + U.formatTime(storm.timeLeft);
      else if (storm.state === 'shrinking') { stormText = 'Storm closing · ' + U.formatTime(storm.timeLeft); stormClass = 'pill pill-alert'; }
      else { stormText = 'Final storm'; stormClass = 'pill pill-alert'; }
      if (p.inStorm && p.alive) { stormText = 'In the storm! −' + storm.dps + ' HP/s'; stormClass = 'pill pill-danger'; }
    }
    set('storm', el['hud-storm-text'], 'text', stormText);
    set('stormc', el['hud-storm'], 'class', stormClass);
    var alive = extra.alive !== undefined ? extra.alive : world.players.filter(function (o) { return o.alive; }).length;
    var total = extra.total !== undefined ? extra.total : world.players.length;
    var lobbyText = '<b>' + alive + '</b> alive · ' + total + (extra.online ? ' players' : '/' + C.lobbySize + ' in lobby') + ' · ' + esc(modeLabel);
    if (extra.online && extra.ping !== undefined) lobbyText += ' · ' + extra.ping + ' ms';
    set('lobby', el['hud-lobby'], 'html', lobbyText);

    var spec = extra.spectating ? 'Spectating ' + esc(extra.spectating) + (extra.placement ? ' · you placed #' + extra.placement : '') : '';
    set('spec', el['hud-spectate'], 'html', spec);
    set('spech', el['hud-spectate'], 'hidden', !spec);

    if (lastClass !== p.classId) {
      lastClass = p.classId;
      el['hud-class-icon'].innerHTML = Icons.classIcon(p.classId);
      el['hud-class-name'].textContent = cls.name;
      el['hud-class-tier'].textContent = 'LVL ' + cls.tier;
      el.hud.style.setProperty('--class-color', cls.color);
    }
    var hpk = U.clamp(p.hp / p.maxHp, 0, 1);
    set('hpw', el['hud-hp-fill'], 'width', (hpk * 100).toFixed(1) + '%');
    set('hpc', el['hud-hp-fill'], 'class', p.downed ? 'low' : hpk > 0.5 ? '' : hpk > 0.25 ? 'mid' : 'low');
    set('hpt', el['hud-hp-text'], 'text', p.downed ? 'DOWNED · ' + U.formatTime(p.downT) + ' to bleed out' : Math.ceil(p.hp) + ' / ' + p.maxHp + ' HP');
    set('arw', el['hud-armor-fill'], 'width', (p.armor > 0 ? Math.min(100, p.armor) : 0) + '%');
    set('art', el['hud-armor-text'], 'text', Math.ceil(p.armor) + ' Armor');
    var stamina = U.clamp(Number.isFinite(p.stamina) ? p.stamina : 100, 0, 100);
    set('stw', el['hud-stamina-fill'], 'width', stamina.toFixed(2) + '%');
    set('stt', el['hud-stamina-text'], 'text', Math.round(stamina) + ' / 100 Stamina' + (p.sprintExhausted ? ' · Recovering' : ''));
    set('stc', el['hud-stamina-fill'], 'class', p.sprintExhausted ? 'exhausted' : '');
    set('sttitle', el['hud-stamina'], 'title', p.sprintExhausted ? 'Exhausted: refill to 100 stamina before sprinting again.' : 'Hold ' + Controls.primary('sprint') + ' while moving to sprint.');
    updateTeam(world, p);

    var wkey = p.weapons.map(function (w) { return w.id; }).join(',') + '|' +
      p.items.map(function (s) { return s ? s.id + ':' + s.n : '-'; }).join(',') + '|' + p.held;
    if (wkey !== lastWeaponsKey) { lastWeaponsKey = wkey; buildSlots(p); ['ss0', 'ss1', 'sc0', 'sc1', 'sl0', 'sl1'].forEach(function (k) { delete cache[k]; }); }
    p.weapons.forEach(function (w, idx) {
      set('ss' + idx, $('hud-slot-state-' + idx), 'text', slotState(p, w));
      var def = WEAPONS[w.id], cd = 0;
      if (def.kind === 'medkit') cd = p.medkitCd / def.cooldown;
      else if (def.kind === 'ability') cd = p.commandCd / def.cooldown;
      else if (w.reloading) cd = w.reloadT / def.reload;
      set('sc' + idx, $('hud-slot-cd-' + idx), 'width', (cd * 100).toFixed(1) + '%');
      var classes = 'slot' + (p.held < 0 && idx === p.slot ? ' selected' : '') +
        ((def.kind === 'throwable' && p.grenades <= 0) || (def.kind === 'medkit' && p.medkitCd > 0) ? ' spent' : '');
      set('sl' + idx, $('hud-slot-' + idx), 'class', classes);
    });
    updateBuffs(world, p);
    el.flash.style.opacity = p.fx.flash > 0 ? Math.min(1, p.fx.flash / ITEMS.flashbang.flash * 1.3).toFixed(2) : 0;

    var cur = p.weapons[p.slot], cdef = WEAPONS[cur.id], big, max, label, heldIt = p.held >= 0 && p.items[p.held] ? ITEMS[p.items[p.held].id] : null;
    if (p.downed) { big = '—'; max = ''; label = 'no weapons while down'; }
    else if (p.mount) { big = '∞'; max = ''; label = 'turret · click to fire · ' + Controls.primary('interact') + ' to get off'; }
    else if (heldIt) { big = String(p.items[p.held].n); max = ''; label = heldIt.name + (heldIt.kind === 'hold' ? ' · raised' : heldIt.kind === 'target' ? ' · click a target' : ' · click to use'); }
    else if (cdef.kind === 'throwable') { big = String(p.grenades); max = ''; label = 'grenades'; }
    else if (cdef.kind === 'medkit') { big = p.medkitCd > 0 ? Math.ceil(p.medkitCd) + 's' : 'Ready'; max = ''; label = 'medkit'; }
    else if (cdef.kind === 'ability') { big = p.commandCd > 0 ? Math.ceil(p.commandCd) + 's' : 'Ready'; max = ''; label = 'Aim, then click · radar + team boost + airstrike'; }
    else { big = String(cur.ammo); max = '/ ' + cdef.mag; label = cdef.zoom ? (p.scoping ? 'scoped' : 'hold ' + Controls.primary('scope') + ' to scope') : '∞ ammo'; }
    if (!heldIt && cdef.windup && p.minigunSpin > 0 && p.minigunSpin < cdef.windup) label = 'Spinning up · ' + Math.round(p.minigunSpin / cdef.windup * 100) + '%';
    if (world.aimedProjectile(p)) label = 'Hold 0.75 s for range · release to throw';
    set('ammo', el['hud-ammo'], 'text', big);
    set('ammomax', el['hud-ammo-max'], 'text', max);
    set('ammolabel', el['hud-ammo-label'], 'text', label);
    set('reloading', el['hud-reload'], 'hidden', !cur.reloading || p.downed);
    if (cur.reloading) set('reloadw', el['hud-reload-fill'], 'width', ((1 - cur.reloadT / cdef.reload) * 100).toFixed(1) + '%');

    var prompt = '', downed = p.alive && !p.downed && p.dropT <= 0 ? nearestDowned(world, p) : null;
    var mountable = p.alive && !p.downed && !p.mount && p.dropT <= 0 ? world.nearestMountable(p) : null;
    var pickup = p.alive && !p.downed && !p.mount && p.dropT <= 0 ? world.nearestItemPickup(p) : null;
    var recoverable = p.alive && !p.downed && !p.mount && p.dropT <= 0 ? world.nearestRecoverableRock(p) : null;
    var dropKey = '<kbd>' + esc(Controls.primary('drop')) + '</kbd>';
    if (p.alive && p.downed) prompt = 'You are down. Crawl to your team: they can revive you by holding <kbd>' + key + '</kbd> next to you.';
    else if (p.alive && p.mount) prompt = '<kbd>' + key + '</kbd> Get off the turret · click to fire';
    else if (downed) prompt = '<kbd>' + key + '</kbd> Hold to revive ' + esc(downed.name) + (downed.revive > 0 ? ' · ' + Math.round(downed.revive * 100) + '%' : '') + (p.classId === 'medic' ? ' · medic speed' : '');
    else if (pickup) prompt = '<kbd>' + key + '</kbd> Pick up ' + esc(ITEMS[pickup.item].name) + (pickup.amount > 1 ? ' ×' + pickup.amount : '') +
      (world.canTake(p, pickup.item) ? '' : ' · full · ' + dropKey + ' drop held item');
    else if (recoverable) prompt = '<kbd>' + key + '</kbd> Pick up team rock' + (world.canTake(p, 'rock') ? '' : ' · full · ' + dropKey + ' drop held item');
    else if (mountable) prompt = '<kbd>' + key + '</kbd> Mount the ' + esc(ITEMS[mountable.item].name);
    else if (p.alive && p.fullNoteT > 0) prompt = 'Items full · select an item and ' + dropKey + ' drop its stack';
    else if (p.alive && p.dropT <= 0 && p.nearStation) {
      var st = p.nearStation;
      if (!canUpgrade) prompt = '<kbd>' + key + '</kbd> Upgrade Station · maximum class level';
      else if (st.cooldown > 0) prompt = '<kbd>' + key + '</kbd> Upgrade Station recharging · ' + U.formatTime(st.cooldown) + (p.keys > 0 ? ' · you have a station key' : '');
      else if (p.tokens >= upgradeCost) prompt = '<kbd>' + key + '</kbd> Open Upgrade Station · upgrade ready!';
      else prompt = '<kbd>' + key + '</kbd> Open Upgrade Station · ' + p.tokens + '/' + upgradeCost + ' tokens';
    }
    set('prompt', el['hud-prompt'], 'html', prompt);
    set('prompth', el['hud-prompt'], 'hidden', !prompt);

    var vig = p.alive && p.downed ? 'low' : p.alive && p.inStorm ? 'storm' : p.alive && hpk <= 0.3 ? 'low' : '';
    set('vig', el.vignette, 'class', vig);

    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) el['hud-banner'].classList.remove('show');
    }
    drawMinimap(world, p);
  }

  function feed(text, kind) {
    var li = document.createElement('li');
    li.className = 'feed-' + (kind || 'info');
    li.textContent = text;
    el['hud-feed'].insertBefore(li, el['hud-feed'].firstChild);
    while (el['hud-feed'].children.length > 6) el['hud-feed'].removeChild(el['hud-feed'].lastChild);
    setTimeout(function () { li.classList.add('fade'); }, 5200);
    setTimeout(function () { if (li.parentNode) li.parentNode.removeChild(li); }, 6000);
  }

  function banner(title, sub, seconds, color) {
    var b = el['hud-banner'];
    b.innerHTML = '<b>' + title + '</b>' + (sub ? '<span>' + sub + '</span>' : '');
    b.style.setProperty('--banner-color', color || '#ffffff');
    b.hidden = false;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    bannerTimer = seconds || 2.4;
  }

  function hurt() {
    el.vignette.classList.remove('hit');
    void el.vignette.offsetWidth;
    el.vignette.classList.add('hit');
  }

  function buildMinimap(map) {
    var canvas = el.minimap, dpr = Math.min(window.devicePixelRatio || 1, 2), size = canvas.clientWidth || 190;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    mini = { base: W.MapArt.base(map, canvas.width, { labelPx: 9 * dpr, dpr: dpr }), dpr: dpr, map: map, cssSize: size };
  }

  function drawMinimap(world, p) {
    if (!mini || mini.map !== world.map || mini.cssSize !== (el.minimap.clientWidth || 190) || mini.dpr !== Math.min(window.devicePixelRatio || 1, 2)) buildMinimap(world.map);
    var canvas = el.minimap, g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(mini.base, 0, 0);
    W.MapArt.overlay(g, world, p, canvas.width, { dpr: mini.dpr });
  }

  W.Hud = { init: init, show: show, reset: reset, update: update, feed: feed, banner: banner, hurt: hurt, refreshHints: refreshHints };
}());
