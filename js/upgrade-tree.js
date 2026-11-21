/* warz.io: upgrade station panel. Browse three class levels without crowding the tree. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, C = W.CONFIG, CLASSES = W.CLASSES, WEAPONS = W.WEAPONS, Rules = W.Rules, Icons = W.Icons, L = W.TREE_LAYOUT;
  var panel = null, opts = {}, ctx = null, selected = 'soldier', previewBranch = 'sniper', previewLevel = 2, levelThreeBranch = 'sniper2', drawnBranch = '', refreshT = 0, closeTimer = null, built = false;
  var BOX_W = 1000, BOX_H = 600;
  var shopping = false, pending = false, shopClass = '';

  function $(id) { return document.getElementById(id); }
  function pct(p) { return 'left:' + (p.x / BOX_W * 100).toFixed(2) + '%;top:' + (p.y / BOX_H * 100).toFixed(2) + '%'; }
  function soonById(id) { return W.TREE_SOON.filter(function (s) { return s.id === id; })[0] || null; }

  // A pipe from a parent node to a child: straight up, or up to a shared bus, across, then up.
  function pipePath(a, b) {
    if (Math.abs(a.x - b.x) < 1) return 'M' + a.x + ' ' + a.y + ' L' + b.x + ' ' + b.y;
    var busY = (a.y + b.y) / 2, r = Math.min(26, Math.abs(a.x - b.x) / 2), dir = b.x > a.x ? 1 : -1;
    return 'M' + a.x + ' ' + a.y + ' L' + a.x + ' ' + (busY + r) + ' Q' + a.x + ' ' + busY + ' ' + (a.x + dir * r) + ' ' + busY +
      ' L' + (b.x - dir * r) + ' ' + busY + ' Q' + b.x + ' ' + busY + ' ' + b.x + ' ' + (busY - r) + ' L' + b.x + ' ' + b.y;
  }
  function pipeHtml(a, b, id, soon) {
    var d = pipePath(a, b);
    return '<g class="ut-pipe' + (soon ? ' is-soon' : '') + '" data-pipe="' + id + '"><path class="ut-pipe-outline" d="' + d + '"/><path class="ut-pipe-fill" d="' + d + '"/></g>';
  }
  function nodeHtml(id) {
    var cls = CLASSES[id];
    return '<button type="button" class="ut-node" id="ut-node-' + id + '" data-node="' + id + '" style="--c:' + cls.color + ';' + pct(L[id]) + '">' +
      Icons.classIcon(id, { className: 'ut-node-art' }) +
      '<span class="ut-node-badge" id="ut-node-badge-' + id + '" aria-hidden="true"></span>' +
      '<span class="ut-node-name">' + cls.name + '<small id="ut-node-sub-' + id + '"></small></span></button>';
  }
  function soonHtml(s) {
    return '<button type="button" class="ut-node is-soon" id="ut-node-' + s.id + '" data-node="' + s.id + '" style="--c:#9aa7bd;' + pct(s) + '">' +
      Icons.LOCK + '<span class="ut-node-name">' + s.name + '<small>Coming soon · 40 tokens</small></span></button>';
  }

  function branchChoices(branch) {
    return Rules.childClasses(branch);
  }
  function priceLabel(p, cost) { return cost + ' tokens' + (p.classTokens > 0 ? ' or 1 class key' : ''); }
  function refreshBranch(p) {
    var levelThree = previewLevel === 3, branch = levelThree ? levelThreeBranch : previewBranch;
    var choices = branchChoices(branch), pipes = '', key = previewLevel + ':' + branch;
    if (levelThree) choices = W.TREE_SOON.filter(function (s) { return s.parent === branch; }).map(function (s) { return s.id; }).concat(choices);
    $('ut-branch-label').textContent = CLASSES[branch].name + ' upgrades · choose one · ' + priceLabel(p, levelThree ? 40 : Rules.upgradeCostFor(choices[0]));
    $('ut-level3').textContent = 'Level 3 · ' + priceLabel(p, 40);
    $('ut-level2').setAttribute('aria-pressed', String(!levelThree));
    $('ut-level3').setAttribute('aria-pressed', String(levelThree));
    $('ut-parent-wrap').hidden = !levelThree;
    $('ut-parent').value = levelThreeBranch;
    if (drawnBranch === key) return;
    drawnBranch = key;
    panel.classList.toggle('ut-level-three', levelThree);
    W.CLASS_ORDER.forEach(function (id) {
      var node = $('ut-node-' + id), cls = CLASSES[id], position = L[id];
      node.hidden = levelThree ? id !== branch && choices.indexOf(id) < 0 : cls.tier >= 3 || cls.tier === 2 && choices.indexOf(id) < 0;
      node.style.left = position.x / BOX_W * 100 + '%'; node.style.top = position.y / BOX_H * 100 + '%';
    });
    W.TREE_SOON.forEach(function (s) { $('ut-node-' + s.id).hidden = choices.indexOf(s.id) < 0; });
    if (levelThree) {
      var parent = $('ut-node-' + branch); parent.style.left = '50%'; parent.style.top = '66.67%';
    } else {
      W.CLASS_ORDER.forEach(function (id) { if (CLASSES[id].tier === 1) pipes += pipeHtml(L[CLASSES[id].parent], L[id], id, false); });
    }
    choices.forEach(function (id, i) {
      var position = levelThree ? { x: (i + 0.5) * BOX_W / choices.length, y: 110 } : { x: 110 + i * 195, y: 78 }, node = $('ut-node-' + id), planned = !!soonById(id);
      node.hidden = false;
      node.style.left = position.x / BOX_W * 100 + '%'; node.style.top = position.y / BOX_H * 100 + '%';
      pipes += pipeHtml(levelThree ? { x: 500, y: 400 } : L[branch], position, id, planned);
    });
    $('ut-branch-pipes').innerHTML = pipes;
  }

  function build() {
    panel = $('upgrade-panel');
    var nodes = '';
    W.CLASS_ORDER.forEach(function (id) { nodes += nodeHtml(id); });
    W.TREE_SOON.forEach(function (s) { nodes += soonHtml(s); });
    panel.innerHTML =
      '<header class="ut-header">' +
        '<div class="ut-title-wrap"><span class="ut-station-chip" id="ut-station-name">UPGRADE STATION</span><h2 id="ut-title" class="ut-title">Class Tree</h2></div>' +
        '<div class="ut-header-chips">' +
          '<span class="ut-hchip ut-hchip-token" title="Tokens">' + Icons.TOKEN + '<b id="ut-wallet-tokens">0</b></span>' +
          '<span class="ut-hchip" id="ut-class-token-chip" title="Class keys" hidden>' + Icons.CLASS_TOKEN + '<b id="ut-class-tokens">0</b></span>' +
          '<span class="ut-hchip ut-hchip-key" title="Station keys">' + Icons.KEY + '<b id="ut-wallet-keys">0</b></span>' +
          '<span class="ut-hchip is-ready" id="ut-station-state">STATION READY</span>' +
        '</div>' +
        '<button type="button" id="ut-close" class="ut-close" aria-label="Close upgrade station">×</button>' +
      '</header>' +
      '<div class="ut-layout">' +
        '<aside class="ut-card ut-loadout" aria-label="Your loadout">' +
          '<header><h3>Your loadout</h3><span class="ut-chip" id="ut-current-chip"></span></header>' +
          '<div class="ut-slots" id="ut-slots"></div>' +
          '<div class="ut-bars">' +
            '<div class="ut-bar hp"><i id="ut-hp-fill"></i><span id="ut-hp"></span></div>' +
            '<div class="ut-bar armor"><i id="ut-armor-fill"></i><span id="ut-armor"></span></div>' +
          '</div>' +
          '<dl class="ut-wallet"><div><dt>' + Icons.TOKEN + 'Tokens</dt><dd id="ut-tokens"></dd></div><div><dt>' + Icons.KEY + 'Station keys</dt><dd id="ut-keys"></dd></div></dl>' +
        '</aside>' +
        '<div class="ut-tree-wrap" role="region" aria-label="Class upgrade paths">' +
          '<nav class="ut-level-nav" aria-label="Upgrade station"><button type="button" id="ut-level2" aria-pressed="true">Levels 1–2</button><button type="button" id="ut-level3" aria-pressed="false">Level 3 · 40 tokens</button><button type="button" id="ut-shop-tab" aria-pressed="false">Class shop</button></nav>' +
          '<section id="ut-shop" class="ut-shop ut-card" hidden><h3 id="ut-shop-title"></h3><div id="ut-offers"></div></section><div id="ut-branches">' +
          '<label class="ut-parent-wrap" id="ut-parent-wrap" hidden>Upgrading from <select id="ut-parent">' + W.CLASS_ORDER.filter(function (id) { return CLASSES[id].tier === 2; }).map(function (id) { return '<option value="' + id + '">' + CLASSES[id].name + '</option>'; }).join('') + '</select></label>' +
          '<p class="ut-branch-label" id="ut-branch-label"></p><div class="ut-tree-scroll"><div class="ut-tree">' +
          '<svg class="ut-pipes" viewBox="0 0 ' + BOX_W + ' ' + BOX_H + '" aria-hidden="true"><g id="ut-branch-pipes"></g></svg>' +
          '<div id="ut-nodes" role="group" aria-label="Classes">' + nodes + '</div>' +
        '</div></div></div></div>' +
        '<article class="ut-card ut-detail" id="ut-detail">' +
          '<header class="ut-detail-head"><span class="ut-detail-icon" id="ut-portrait"></span>' +
            '<div><h3 id="ut-detail-title"></h3><span class="ut-state" id="ut-detail-state"></span></div></header>' +
          '<div class="ut-detail-body">' +
            '<p id="ut-detail-desc"></p>' +
            '<ul class="ut-stats" id="ut-stats"></ul>' +
            '<button type="button" id="ut-action" class="btn btn-play ut-action"></button>' +
            '<button type="button" id="ut-class-key-action" class="btn ut-action is-key" hidden>Use 1 class key</button>' +
            '<p class="ut-apply-note" id="ut-apply-note"></p>' +
          '</div>' +
        '</article>' +
      '</div>' +
      '<footer class="ut-footer"><p class="ut-hint">Choose a class to preview its upgrades · Lvl 1: ' + Rules.upgradeCostFor('sniper') + ' tokens · Lvl 2: ' + Rules.upgradeCostFor('sniper2') + ' tokens · Lvl 3: 40 tokens · Station recharge: ' +
        U.formatTime(C.stationCooldown) + ' · ' + W.Controls.primary('interact') + ' or Esc closes</p><p id="ut-status" role="status" aria-live="polite"></p></footer>';

    $('ut-close').addEventListener('click', close);
    $('ut-action').addEventListener('click', function () { act('tokens'); });
    $('ut-class-key-action').addEventListener('click', function () { act('classKey'); });
    $('ut-level2').addEventListener('click', function () { shopping = false; previewLevel = 2; selected = previewBranch; refresh(); });
    $('ut-level3').addEventListener('click', function () { shopping = false; previewLevel = 3; selected = 'engineer'; refresh(); });
    $('ut-shop-tab').addEventListener('click', function () { shopping = true; $('ut-status').textContent = ''; refresh(); });
    $('ut-offers').addEventListener('click', function (e) {
      var button = e.target.closest('[data-supply]');
      if (button && !button.disabled) buy(button.getAttribute('data-supply'));
    });
    $('ut-parent').addEventListener('change', function () { levelThreeBranch = this.value; selected = 'engineer'; refresh(); });
    Array.prototype.forEach.call(panel.querySelectorAll('.ut-node'), function (btn) {
      btn.addEventListener('click', function () { select(btn.getAttribute('data-node')); });
    });
    window.addEventListener('keydown', onKey, true);
    built = true;
  }

  function onKey(e) {
    if (!isOpen()) return;
    var interact = W.Controls.bindings('interact');
    if (e.code === 'Escape' || e.code === interact[0] || e.code === interact[1]) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.code === 'Tab') {
      var controls = Array.prototype.filter.call(panel.querySelectorAll('button, select'), function (b) { return !b.disabled && b.getClientRects().length; });
      if (!controls.length) return;
      var first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    var dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code];
    if (!dir || !document.activeElement || !document.activeElement.classList.contains('ut-node')) return;
    e.preventDefault();
    e.stopPropagation();
    var from = document.activeElement.getBoundingClientRect(), best = null, bestScore = Infinity;
    Array.prototype.forEach.call(panel.querySelectorAll('.ut-node'), function (btn) {
      if (btn === document.activeElement || btn.hidden || !btn.getClientRects().length) return;
      var r = btn.getBoundingClientRect();
      var dx = (r.left + r.width / 2) - (from.left + from.width / 2), dy = (r.top + r.height / 2) - (from.top + from.height / 2);
      var forward = dx * dir[0] + dy * dir[1];
      if (forward <= 1) return;
      var score = Math.hypot(dx, dy) + Math.abs(dx * dir[1] - dy * dir[0]) * 2;
      if (score < bestScore) { bestScore = score; best = btn; }
    });
    if (best) { select(best.getAttribute('data-node')); best.focus(); }
  }

  function isOpen() { return !!panel && !panel.hidden; }

  function open(context) {
    if (!built) build();
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    ctx = context;
    shopping = false; pending = false; shopClass = '';
    var kids = Rules.childClasses(ctx.player.classId);
    var cls = CLASSES[ctx.player.classId];
    selected = kids.length ? kids[0] : ctx.player.classId;
    previewLevel = cls.tier >= 2 ? 3 : 2;
    if (cls.tier === 1) previewBranch = cls.id;
    else if (cls.tier === 2) { levelThreeBranch = cls.id; previewBranch = ctx.player.upgradeFrom || cls.parent; }
    else if (cls.tier === 3) {
      levelThreeBranch = ctx.player.upgradeFrom || cls.parent;
      var ancestors = ctx.player.upgradePath || [];
      previewBranch = ancestors.filter(function (id) { return CLASSES[id] && CLASSES[id].tier === 1; })[0] || CLASSES[levelThreeBranch].parent;
    } else { previewBranch = 'sniper'; levelThreeBranch = 'sniper2'; }
    $('ut-status').textContent = '';
    panel.hidden = false;
    document.body.classList.add('tree-open');
    refresh();
    var node = $('ut-node-' + selected);
    if (node) node.focus();
  }

  function close() {
    if (!panel || panel.hidden) return;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    panel.hidden = true;
    document.body.classList.remove('tree-open');
    ctx = null;
    if (opts.onClose) opts.onClose();
  }

  function select(id) {
    selected = id;
    if (CLASSES[id] && CLASSES[id].tier === 1) { previewBranch = id; previewLevel = 2; }
    if (CLASSES[id] && CLASSES[id].tier === 2) { levelThreeBranch = id; previewLevel = 3; }
    $('ut-status').textContent = '';
    refresh();
  }

  function weaponRow(label, id) {
    return '<li><strong>' + label + '</strong><span>' + Icons.weaponIcon(id, 'ut-stat-icon') + '<b>' + WEAPONS[id].name + '</b> · ' + Rules.weaponLine(id) + '</span></li>';
  }

  var supplyReasons = { full: 'Hotbar full', max: 'Fully upgraded', far: 'Move closer to the station', dead: 'Unavailable', unavailable: 'Unavailable' };
  function refreshShop(p, offers) {
    if (shopClass !== p.classId) {
      shopClass = p.classId;
      $('ut-shop-title').textContent = CLASSES[p.classId].name + ' supplies';
      $('ut-offers').innerHTML = offers.map(function (offer) {
        var icon = offer.id === 'fireupgrade' ? Icons.weaponIcon('flamethrower') : offer.id === 'gascylinder' ? Icons.weaponIcon(offer.id) : Icons.itemIcon(offer.id);
        return '<article class="ut-offer"><span class="ut-offer-art">' + icon + '</span><div><h4>' + (offer.amount > 1 ? offer.amount + ' ' : '') + offer.name + '</h4><p>' + offer.detail + '</p>' +
          '<small id="ut-stock-' + offer.id + '"></small></div><button type="button" id="ut-buy-' + offer.id + '" data-supply="' + offer.id + '"></button></article>';
      }).join('');
    }
    offers.forEach(function (offer) {
      var check = ctx.world.checkStationSupply(p, ctx.station, offer), btn = $('ut-buy-' + offer.id);
      var price = offer.cost + (offer.cost === 1 ? ' token' : ' tokens');
      btn.disabled = !check.ok || pending;
      btn.textContent = check.ok ? 'Buy · ' + price : supplyReasons[check.reason] || 'Need ' + price;
      $('ut-stock-' + offer.id).textContent = offer.id === 'fireupgrade' ? (p.pyroFireUpgrades || 0) + ' / 2 upgrades' :
        'Carrying ' + (offer.id === 'grenade' ? p.grenades : offer.id === 'gascylinder' ? p.gasCylinders : ctx.world.countItem(p, offer.id));
    });
  }

  function refresh() {
    if (!ctx) return;
    var p = ctx.player, st = ctx.station, current = CLASSES[p.classId], cooling = st.cooldown > 0;
    $('ut-station-name').textContent = 'UPGRADE STATION ' + st.number;
    var state = $('ut-station-state');
    state.textContent = cooling ? 'RECHARGING · ' + U.formatTime(st.cooldown) : 'STATION READY';
    state.className = 'ut-hchip ' + (cooling ? 'is-cooling' : 'is-ready');
    $('ut-wallet-tokens').textContent = String(p.tokens);
    $('ut-class-token-chip').hidden = !p.classTokens;
    $('ut-class-tokens').textContent = String(p.classTokens || 0);
    $('ut-wallet-keys').textContent = String(p.keys);

    // Left: loadout
    var chip = $('ut-current-chip');
    chip.textContent = current.name + ' · LVL ' + current.tier;
    chip.style.setProperty('--c', current.color);
    $('ut-slots').innerHTML = p.weapons.map(function (w) {
      return '<div class="ut-slot" title="' + WEAPONS[w.id].name + '">' + Icons.weaponIcon(w.id, 'ut-slot-art') + '<span>' + WEAPONS[w.id].name + '</span></div>';
    }).join('');
    $('ut-hp-fill').style.width = (U.clamp(p.hp / p.maxHp, 0, 1) * 100).toFixed(1) + '%';
    $('ut-hp').textContent = Math.ceil(p.hp) + ' / ' + p.maxHp + ' HP';
    $('ut-armor-fill').style.width = Math.min(100, p.armor) + '%';
    $('ut-armor').textContent = Math.ceil(p.armor) + ' Armor';
    $('ut-tokens').textContent = String(p.tokens);
    $('ut-keys').textContent = String(p.keys);

    var offers = Rules.stationOffers(p.classId);
    if (!offers.length) shopping = false;
    panel.classList.toggle('ut-shopping', shopping);
    $('ut-shop-tab').hidden = !offers.length;
    $('ut-shop-tab').setAttribute('aria-pressed', String(shopping));
    $('ut-shop').hidden = !shopping;
    $('ut-branches').hidden = shopping;
    $('ut-detail').hidden = shopping;
    $('ut-title').textContent = shopping ? 'Class Shop' : 'Class Tree';
    if (shopping) {
      state.textContent = 'SHOP OPEN';
      state.className = 'ut-hchip is-ready';
      $('ut-level2').setAttribute('aria-pressed', 'false');
      $('ut-level3').setAttribute('aria-pressed', 'false');
      refreshShop(p, offers);
      return;
    }

    // Center: only the choices on the branch being previewed.
    refreshBranch(p);
    W.CLASS_ORDER.forEach(function (id) {
      var rel = Rules.relation(p, id), node = $('ut-node-' + id), sub = $('ut-node-sub-' + id), badge = $('ut-node-badge-' + id), cost = Rules.upgradeCostFor(id);
      node.className = 'ut-node is-' + rel + (id === selected ? ' is-selected' : '');
      node.setAttribute('aria-pressed', String(id === selected));
      sub.textContent = rel === 'current' ? 'Current class' : rel === 'owned' ? 'Unlocked' : rel === 'available' ? 'LVL ' + CLASSES[id].tier + ' · ' + priceLabel(p, cost) : 'Locked';
      badge.innerHTML = rel === 'available' ? Icons.TOKEN + cost : rel === 'current' ? 'YOU' : rel === 'owned' ? '✓' : Icons.LOCK;
      node.setAttribute('aria-label', CLASSES[id].name + ', level ' + CLASSES[id].tier + ', ' + sub.textContent);
      var pipe = panel.querySelector('[data-pipe="' + id + '"]');
      if (pipe) {
        pipe.setAttribute('class', 'ut-pipe' + (rel === 'current' || rel === 'owned' ? ' is-lit' : rel === 'available' ? ' is-available' : rel === 'branch' ? ' is-dim' : ''));
        pipe.style.setProperty('--pipe', CLASSES[id].color);
      }
    });
    W.TREE_SOON.forEach(function (s) {
      var node = $('ut-node-' + s.id);
      node.className = 'ut-node is-soon' + (s.id === selected ? ' is-selected' : '');
      node.setAttribute('aria-pressed', String(s.id === selected));
      node.setAttribute('aria-label', s.name + ', level 3, coming soon, requires ' + CLASSES[s.parent].name + ', 40 tokens');
    });

    // Right: detail card
    var detail = $('ut-detail'), action = $('ut-action'), note = $('ut-apply-note'), soon = soonById(selected);
    var keyAction = $('ut-class-key-action');
    keyAction.hidden = true;
    action.classList.remove('is-key');
    if (soon) {
      var planned = W.CLASS_PLANNED[soon.id] || soon;
      detail.style.setProperty('--c', '#9aa7bd');
      $('ut-portrait').innerHTML = Icons.LOCK;
      $('ut-detail-title').textContent = planned.name;
      $('ut-detail-state').textContent = 'COMING SOON · LVL 3';
      $('ut-detail-desc').textContent = planned.description;
      $('ut-stats').innerHTML = '<li><strong>Requires</strong><span>' + CLASSES[planned.parent].name + '</span></li><li><strong>Cost</strong><span>40 tokens when released</span></li>';
      action.textContent = 'Coming soon';
      action.disabled = true;
      note.textContent = '';
      return;
    }
    var cls = CLASSES[selected], rel = Rules.relation(p, selected), cost = Rules.upgradeCostFor(selected), parents = Rules.classParents(selected);
    var required = parents.length > 1 ? (cls.tier === 3 ? 'any level-two class' : 'a level-one class') : cls.parent ? CLASSES[cls.parent].name : 'Soldier';
    detail.style.setProperty('--c', cls.color);
    $('ut-portrait').innerHTML = Icons.classIcon(selected, { className: 'ut-portrait-art' });
    $('ut-detail-title').textContent = cls.name;
    $('ut-detail-state').textContent = rel === 'current' ? 'CURRENT CLASS · LVL ' + cls.tier
      : rel === 'owned' ? 'UNLOCKED · LVL ' + cls.tier
      : rel === 'available' ? 'LVL ' + cls.tier + ' · ' + priceLabel(p, cost).toUpperCase()
      : rel === 'locked' && (parents.length > 1 || Rules.relation(p, cls.parent) !== 'branch') ? 'REQUIRES ' + required.toUpperCase() : 'LOCKED · OTHER BRANCH';
    $('ut-detail-desc').textContent = cls.description;
    var rows = '<li><strong>HP</strong><span><b>' + cls.hp + '</b>' + (cls.hp !== current.hp && rel === 'available' ? ' (' + (cls.hp - current.hp) + ' from now)' : '') + '</span></li>' +
      '<li><strong>Armor</strong><span><b>' + cls.armor + '</b></span></li>';
    if (cls.speed && cls.speed !== 1) rows += '<li><strong>Speed</strong><span><b>' + Math.round(cls.speed * 100) + '%</b> of normal movement speed</span></li>';
    if (cls.id === 'shotgunner3') rows += '<li><strong>Protection</strong><span><b>25%</b> less incoming damage</span></li><li><strong>Damage</strong><span><b>+10%</b> with all weapons and gear</span></li>';
    if (cls.id === 'pyromancer' || cls.id === 'pyromaniac') rows += '<li><strong>Terrain</strong><span>Deal 80% less weapon damage in tundra and tundra forest, and 5% more in desert. Savannah uses normal damage.</span></li>';
    if (cls.id === 'magicmedic') rows += '<li><strong>Revive</strong><span>Revive teammates to full health without consuming a medkit.</span></li><li><strong>Hotbar</strong><span>Three class tools in slots 1–3 and seven item slots (4–10).</span></li>';
    if (cls.id === 'pyromaniac') rows += '<li><strong>Protection</strong><span><b>50%</b> less incoming damage</span></li><li><strong>Firegun</strong><span>Use gear to spend <b>50 tokens</b> and transform the dual revolvers into one fireball gun.</span></li>';
    if (cls.id === 'armorcrew') rows += '<li><strong>Protection</strong><span><b>10%</b> less incoming damage</span></li>' +
      '<li><strong>Artillery</strong><span><b>' + (W.ARTILLERY.fireInterval - W.ARMOR_CREW.artilleryIntervalReduction) + 's</b> between shells, <b>25%</b> faster shell travel and <b>10%</b> faster SP artillery driving.</span></li>' +
      '<li><strong>Repair</strong><span><b>100 HP</b> · Humvee: ' + W.ARMOR_CREW.repairSecondsPer100.humvee + 's · Tank: ' + W.ARMOR_CREW.repairSecondsPer100.tank + 's · Artillery: ' + W.ARMOR_CREW.repairSecondsPer100.artillery + 's. Toggle ' + W.Controls.bindings('gear').map(function (code) { return W.Controls.label(code); }).join(' / ') + ' near a damaged vehicle. Repairing reveals you to nearby enemies.</span></li>';
    cls.loadout.forEach(function (id, i) {
      var kind = WEAPONS[id].kind;
      rows += weaponRow(i === 0 ? 'Main' : (kind === 'gun' ? 'Side' : 'Gear'), id);
    });
    $('ut-stats').innerHTML = rows;

    if (rel === 'available') {
      var payment = { from: p.classId, to: selected, tokens: p.tokens, classTokens: p.classTokens, keys: p.keys, stationCooldown: st.cooldown, payment: 'tokens' };
      var check = Rules.upgradeCheck(payment);
      if (check.ok) {
        action.disabled = pending;
        action.textContent = (check.useKey ? 'Use station key + upgrade' : 'Upgrade to ' + cls.name) + ' · ' + cost + ' tokens';
        if (check.useKey) action.classList.add('is-key');
      } else {
        action.disabled = true;
        action.textContent = check.reason === 'tokens' ? 'Need ' + cost + ' tokens · you have ' + p.tokens
          : 'Station recharging · ' + U.formatTime(st.cooldown);
      }
      if (p.classTokens > 0) {
        payment.payment = 'classKey';
        var keyCheck = Rules.upgradeCheck(payment);
        keyAction.hidden = false; keyAction.disabled = pending || !keyCheck.ok;
        keyAction.textContent = cooling ? 'Use 1 class key + 1 station key' : 'Upgrade with 1 class key';
      }
      note.textContent = 'Your weapons refill and your HP carries over (capped at the new max). ' +
        'This station then recharges for ' + U.formatTime(C.stationCooldown) + '.' +
        (cooling ? ' A station key skips the recharge and is used up.' : '');
    } else {
      action.disabled = true;
      action.textContent = rel === 'current' ? 'Your current class' : rel === 'owned' ? 'Already unlocked'
        : rel === 'locked' && (parents.length > 1 || Rules.relation(p, cls.parent) !== 'branch') ? 'Choose ' + required + ' first' : 'Locked · you chose ' + current.name;
      note.textContent = rel === 'branch' ? 'You can choose one class at each level per match. Start a new match to try another branch.'
        : rel === 'current' && p.classTokens > 0 && Rules.childClasses(cls.id).length ? 'Choose your next class and pay with tokens or a class key.'
        : rel === 'current' && Rules.childClasses(cls.id).length ? 'Collect ' + Rules.nextUpgradeCost(cls.id) + ' tokens, then choose the next upgrade on your branch.'
        : rel === 'current' && cls.tier >= 3 ? 'You have reached the final upgrade on this class branch.'
        : rel === 'current' ? 'Collect ' + Rules.nextUpgradeCost(cls.id) + ' tokens, then pick a Lvl 1 class here.' : '';
    }
  }

  function stationResult(result, complete) {
    var opened = ctx;
    function finish(r) {
      if (ctx !== opened) return;
      pending = false;
      complete(r || { ok: false, reason: 'offline' });
      refresh();
    }
    if (!result || typeof result.then !== 'function') { finish(result); return; }
    pending = true;
    refresh();
    $('ut-status').textContent = 'Waiting for station…';
    result.then(finish, function () { finish({ ok: false, reason: 'offline' }); });
  }

  function act(payment) {
    var button = $(payment === 'tokens' ? 'ut-action' : 'ut-class-key-action'), id = selected;
    if (!ctx || pending || !opts.onUpgrade || button.disabled || button.hidden || !CLASSES[id]) return;
    stationResult(opts.onUpgrade(id, ctx, payment), function (r) {
      if (r.ok) {
        $('ut-status').textContent = 'Upgraded to ' + CLASSES[id].name + '!' + (r.usedClassToken ? ' Class key redeemed.' : '') + (r.usedKey ? ' Station key used.' : '');
        closeTimer = setTimeout(close, 900);
      } else {
        $('ut-status').textContent = r.reason === 'tokens' ? 'You need ' + Rules.upgradeCostFor(id) + ' tokens.' : r.reason === 'cooldown' ? 'This station is recharging.'
          : r.reason === 'classKey' ? 'You need a class key.' : supplyReasons[r.reason] || 'Upgrade unavailable.';
      }
    });
  }

  function showPurchase(offer) {
    W.Audio.play('purchase');
    if (!shopping) return;
    var button = $('ut-buy-' + offer.id);
    if (!button) return;
    var art = button.closest('.ut-offer').querySelector('.ut-offer-art');
    var previous = art.querySelector('.ut-purchase-burst');
    if (previous) previous.remove();
    var burst = document.createElement('span');
    burst.className = 'ut-purchase-burst';
    burst.setAttribute('aria-hidden', 'true');
    burst.dataset.count = '+' + offer.amount;
    art.appendChild(burst);
    setTimeout(function () { burst.remove(); }, 700);
  }

  function buy(id) {
    if (!ctx || pending || !opts.onBuy) return;
    var offer = Rules.stationOffers(ctx.player.classId).find(function (entry) { return entry.id === id; });
    if (!offer) return;
    stationResult(opts.onBuy(id, ctx), function (r) {
      if (r.ok) showPurchase(offer);
      $('ut-status').textContent = r.ok ? 'Purchased ' + (offer.amount > 1 ? offer.amount + ' ' : '') + offer.name + '.' :
        supplyReasons[r.reason] || (r.reason === 'tokens' ? 'Insufficient tokens.' : 'Purchase unavailable.');
    });
  }

  function tick(dt) {
    if (!isOpen() || !ctx) return;
    if (!ctx.player.alive) { close(); return; }
    refreshT -= dt;
    if (refreshT <= 0) { refreshT = 0.25; refresh(); }
  }

  W.UpgradeTree = {
    init: function (o) { opts = o || {}; if (!built) build(); },
    open: open, close: close, isOpen: isOpen, tick: tick, refresh: refresh,
    selected: function () { return selected; }
  };
}());
