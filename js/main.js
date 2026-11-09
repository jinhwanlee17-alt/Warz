/* warz.io: app flow. Menu -> (online: matchmaking -> match socket -> mirrored world | offline: practice world)
   -> results. Local controls, sounds and screen effects live here too. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, C = W.CONFIG, CLASSES = W.CLASSES, WEAPONS = W.WEAPONS, Controls = W.Controls, Net = W.Net, Online = W.Online, Account = W.Account;
  var params = new URLSearchParams(window.location.search);
  var canvas, renderer, input, demo, match = null, state = 'menu', last = 0, shake = 0, pauseOpen = false, toastTimer = null, denyAt = {}, acc = 0;
  var ITEMS = W.ITEMS, pending = { held: null, interact: false, use: false }, invHintShown = false;
  var SAMPLE_KIT = ['bandage', 'firenade', 'turret'];

  function $(id) { return document.getElementById(id); }
  function play(name, vol) { W.Audio.play(name, vol); }
  function setScreen(name) {
    state = name;
    document.body.setAttribute('data-screen', name);
    input.capture = name === 'play';
  }
  function blurActive() { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      toastTimer = setTimeout(function () { t.hidden = true; }, 300);
    }, 2600);
  }
  function modeById(id) { return W.MODES.filter(function (m) { return m.id === id; })[0] || W.MODES[0]; }

  // ---------------------------------------------------------------- practice (offline, solo, local simulation)
  function startPractice() {
    W.Audio.unlock();
    closeOverlays(true);
    Online.stop();
    var seed = params.get('seed') ? (Number(params.get('seed')) >>> 0) : ((Math.random() * 2147483647) | 0);
    var map = W.MapGen.generate(seed), world = new W.World({ map: map });
    var drop = map.drops[world.rng.int(0, map.drops.length - 1)];
    var a = world.rng.range(0, U.TAU), off = world.rng.range(0, 40);
    var player = world.addPlayer({
      name: Account.name(), x: drop.x + Math.cos(a) * off, y: drop.y + Math.sin(a) * off,
      color: '#2f9bff', outline: '#1c6cbd', isLocal: true, drop: true, angle: -Math.PI / 2
    });
    player.controller = localController;
    match = { online: false, world: world, player: player, cam: { x: player.x, y: player.y, zoom: 0.45 }, drop: drop.label, seed: seed,
      setup: { mode: W.MODES[0] }, label: 'Practice · offline', deathShown: false, deathT: 0, cause: null, result: null, ended: false };
    beginMatchUi(world, player, match.label);
    W.Hud.banner('Dropping in', 'Practice · Drop Station ' + drop.label + ' · grab ' + W.Rules.nextUpgradeCost(player.classId) + ' tokens, then find an Upgrade Station', 2.2);
  }

  // ---------------------------------------------------------------- online
  function startOnline(st) {
    W.Audio.unlock();
    closeOverlays(true);
    var info = st.info, mode = modeById(info.mode);
    match = { online: true, id: info.id, world: st.world, player: st.me, cam: st.cam, drop: info.drop, seed: info.seed,
      setup: { mode: mode, teamSize: info.teamSize }, label: mode.name, cause: null, spectating: false, placement: null, result: null, ended: false };
    acc = 0;
    beginMatchUi(st.world, st.me, mode.name);
    document.body.classList.add('online-match');
    if (!info.rejoin) W.Hud.banner('Dropping in', 'Drop Station ' + info.drop + ' · ' + mode.name + ' · ' + info.players.length + ' players', 2.4);
    else W.Hud.feed('Reconnected to your match.', 'info');
  }
  function beginMatchUi(world, player, label) {
    shake = 0;
    input.release();
    W.Hud.reset(world, player, label);
    W.Hud.show(true);
    setScreen('play');
    blurActive();
  }
  function endMatchUi() {
    match = null;
    document.body.classList.remove('online-match');
    W.Hud.show(false);
    W.MapScreen.hide();
    W.Inventory.hide();
    setScreen('menu');
    blurActive();
    $('play-btn').focus();
  }
  function leaveMatch() {
    closeOverlays(true);
    if (match && match.online) { Online.leave(); Account.leftMatch(); }
    Online.stop();
    endMatchUi();
  }
  function closeOverlays(silent) {
    W.UpgradeTree.close();
    W.Menu.closeAll(silent);
    W.MapScreen.hide();
    W.Inventory.hide();
    pauseOpen = false;
    $('pause-menu').hidden = true;
    $('death-screen').hidden = true;
  }

  function togglePause(force) {
    pauseOpen = force === undefined ? !pauseOpen : force;
    $('pause-menu').hidden = !pauseOpen;
    $('test-status').textContent = '';
    if (match) $('pause-mode').textContent = 'Mode: ' + match.label + ' · island seed ' + match.seed + (match.online ? ' · ping ' + W.MatchNet.latency() + ' ms' : '');
    syncSoundButtons();
    input.release();
    if (pauseOpen) $('resume-btn').focus(); else blurActive();
  }

  // ---------------------------------------------------------------- results
  function causeText(m, kind) {
    if (kind === 'end' && m.won) return 'Last team standing!';
    if (m.cause === 'storm') return 'The storm caught you.';
    if (m.cause === 'left') return 'You left the island.';
    if (m.cause === 'bleedout') return 'You bled out before your team could revive you.';
    if (m.cause === 'wiped') return 'Your whole team went down.';
    if (m.cause === 'test') return 'Knocked out by a test tool.';
    if (m.by) return 'Eliminated by ' + m.by + '.';
    return kind === 'end' ? 'The match is over.' : 'You were eliminated.';
  }
  function showResult(kind, m) {
    if (!match) return;
    match.result = m;
    W.MapScreen.hide();
    W.UpgradeTree.close();
    W.Menu.closeAll(true);
    pauseOpen = false;
    $('pause-menu').hidden = true;
    setScreen('dead');
    var won = kind === 'end' && m.won, s = m.stats || {}, teams = match.online && match.setup.teamSize > 1;
    $('death-eyebrow').textContent = kind === 'end' ? 'Match over' : 'You are out';
    $('death-title').textContent = won ? 'Victory!' : kind === 'end' ? 'Match over' : 'Eliminated';
    $('death-title').className = won ? 'is-win' : '';
    $('death-place').textContent = m.placement ? '#' + m.placement + ' of ' + m.of + (m.of === 1 ? ' team' : ' teams') + ' · ' + m.players + ' players' : (match.online ? '' : 'Practice match');
    $('death-cause').textContent = causeText(m, kind);
    var rows = [
      ['Survived', U.formatTime(s.survived || 0)],
      ['Mode', match.label],
      ['Class', CLASSES[s.classId || match.player.classId].name],
      ['Eliminations', s.kills || 0]
    ];
    if (teams) rows.push(['Knocks', s.knocks || 0], ['Revives', s.revives || 0]);
    rows.push(['Damage dealt', Math.round(s.damage || 0)], ['Tokens collected', s.tokens || 0], ['Upgrades', s.upgrades || 0], ['Crates broken', s.crates || 0]);
    $('death-stats').innerHTML = rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join('');
    var others = match.world.players.some(function (p) { return p.alive && p !== match.player; });
    $('spectate-btn').hidden = !(kind === 'eliminated' && match.online && !match.ended && others);
    $('death-screen').hidden = false;
    $('again-btn').focus();
  }
  function practiceResult() {
    var p = match.player, s = p.stats;
    showResult('eliminated', { placement: null, cause: match.cause, stats: { survived: match.world.time, classId: p.classId, kills: s.kills, damage: s.damage, tokens: s.tokens, upgrades: s.upgrades, crates: s.crates } });
  }

  // ---------------------------------------------------------------- controls
  function blockedNow() { return state !== 'play' || pauseOpen || W.UpgradeTree.isOpen() || W.Menu.anyOpen(); }

  function localController(p) {
    var aim = renderer.screenToWorld(match.cam, input.mouse.x, input.mouse.y);
    if (blockedNow()) return { mx: 0, my: 0, aimX: aim.x, aimY: aim.y };
    var mapOpen = W.MapScreen.isOpen() || W.Inventory.isOpen();
    var projectile = match.world.aimedProjectile(p);
    var mx = (Controls.down(input, 'right') ? 1 : 0) - (Controls.down(input, 'left') ? 1 : 0);
    var my = (Controls.down(input, 'down') ? 1 : 0) - (Controls.down(input, 'up') ? 1 : 0);
    var slot = Controls.hit(input, 'weapon1') ? 0 : Controls.hit(input, 'weapon2') ? 1 : null;
    var intent = {
      mx: mx, my: my, aimX: aim.x, aimY: aim.y,
      fire: !mapOpen && !projectile && Controls.down(input, 'fire'), firePressed: (!mapOpen && (projectile ? Controls.lift(input, 'fire') : Controls.hit(input, 'fire'))) || pending.use,
      scope: Controls.down(input, 'scope'),
      reload: Controls.hit(input, 'reload'), slot: slot, cycle: input.wheel, swap: Controls.hit(input, 'swap'),
      utility: !mapOpen && (p.weapons.some(function (w) { return w.id === 'grenade'; }) ? Controls.lift(input, 'gear') : Controls.hit(input, 'gear')),
      held: pending.held, interactPressed: pending.interact, dropPressed: !mapOpen && Controls.hit(input, 'drop')
    };
    pending.held = null; pending.interact = false; pending.use = false;
    return intent;
  }
  // Hotbar and interact presses go to the local simulation, or to the server during an online match.
  function selectHotbar(i) { if (!match) return; if (match.online) Online.selectItem(i); else pending.held = i; }
  function useHotbar(i) {
    if (!match) return;
    var already = match.player.held === i;
    if (match.online) Online.useItem(already ? null : i);
    else { if (!already) pending.held = i; pending.use = true; }
  }
  function sendInteract() { if (match.online) Online.pressInteract(); else pending.interact = true; }

  function setMuted(v) {
    W.Audio.setMuted(v);
    Controls.setMuted(v);
    syncSoundButtons();
    W.Menu.syncSound();
  }
  function syncSoundButtons() { $('mute-btn').textContent = Controls.muted() ? 'Sound: off' : 'Sound: on'; }

  function downedTeammateNear(p, world) {
    if (!world.teams || !p.alive || p.downed) return null;
    return world.teammates(p).filter(function (o) { return o.alive && o.downed && Math.hypot(o.x - p.x, o.y - p.y) <= 70 + p.r; })[0] || null;
  }

  function handleKeys() {
    if (W.Menu.anyOpen() || W.Menu.capturing()) return;
    if (Controls.hit(input, 'mute')) {
      setMuted(!Controls.muted());
      if (match) W.Hud.feed(Controls.muted() ? 'Sound off' : 'Sound on', 'muted');
    }
    if (state !== 'play') return;
    if (input.hit('Escape')) {
      if (W.MapScreen.isOpen()) W.MapScreen.hide();
      else if (W.Inventory.isOpen()) W.Inventory.hide();
      else if (!W.UpgradeTree.isOpen()) togglePause();
    }
    if (pauseOpen || W.UpgradeTree.isOpen()) return;
    if (Controls.hit(input, 'inventory') && match.player.alive && !match.player.downed) { W.MapScreen.hide(); W.Inventory.toggle(); play('click'); }
    if (Controls.hit(input, 'map')) { W.Inventory.hide(); W.MapScreen.toggle(); }
    if (W.MapScreen.isOpen()) return;
    var p = match.player, i;
    for (i = 1; i <= C.hotbarSize; i++) if (Controls.hit(input, 'item' + i)) selectHotbar(i - 1);
    if (W.Inventory.isOpen()) return;
    // E: dismount > revive (held) > loose item > turret mount > upgrade station.
    if (Controls.hit(input, 'interact') && p.alive && !p.downed && p.dropT <= 0) {
      if (p.mount) sendInteract();
      else if (downedTeammateNear(p, match.world)) return; // holding the key revives; the server handles it
      else if (match.world.nearestItemPickup(p) || match.world.nearestRecoverableRock(p) || match.world.nearestMountable(p)) sendInteract();
      else if (p.nearStation) {
        W.UpgradeTree.open({ world: match.world, player: p, station: p.nearStation });
        input.release();
        play('click');
      }
    }
  }

  function doUpgrade(classId, ctx) {
    if (match && match.online) return Online.requestUpgrade(classId).then(function (r) { if (!r.ok) play('deny'); return r; });
    var result = ctx.world.upgrade(ctx.player, ctx.station, classId);
    if (!result.ok) play('deny');
    return result;
  }

  // ---------------------------------------------------------------- events -> sound, HUD, shake
  function denyMessage(e) {
    var now = performance.now();
    if (denyAt[e.reason] && now - denyAt[e.reason] < 900) return;
    denyAt[e.reason] = now;
    play('deny');
    var text = {
      medkit: 'Medkit recharging · ' + Math.ceil(e.value || 0) + 's left',
      command: 'Command radar recharging · ' + Math.ceil(e.value || 0) + 's left',
      fullhp: 'Already at full health.',
      nogrenades: 'Out of grenades.',
      nogear: 'Soldiers have no gear. Medics (medkit) and Grenadiers (grenades) use ' + Controls.primary('gear') + '.',
      full: 'Your item slots are full. Select an item and press ' + Controls.primary('drop') + ' to drop its stack' + (e.item && ITEMS[e.item] ? ' and make room for the ' + ITEMS[e.item].name : '') + '.',
      blocked: 'No room to place that there. Try a clear spot closer to you.',
      notarget: 'Click on an enemy within reach to call it down.',
      emptyslot: 'That hotbar slot is empty.',
      noitem: 'Select an item in slots 3–5, then press ' + Controls.primary('drop') + ' to drop it. Class weapons stay with you.'
    }[e.reason];
    if (text) W.Hud.feed(text, 'muted');
  }
  function spatial(x, y) {
    var p = match.player, d = Math.hypot(x - p.x, y - p.y);
    return U.clamp(1 - d / 1500, 0, 1);
  }
  function nameOf(p) { return p ? (p.isLocal ? 'You' : p.name) : null; }
  function itemSound(id) {
    var it = ITEMS[id];
    if (!it) return 'click';
    if (it.kind === 'consume') return 'drink';
    if (it.kind === 'throw') return 'throw';
    if (it.kind === 'place') return 'place';
    if (it.kind === 'target') return 'strike';
    return 'drone';
  }
  function burstSound(id) {
    return { flashbang: 'flash', blackhole: 'blackhole', firenade: 'fire', snowbomb: 'freeze', smoke: 'throw', poison: 'throw' }[id] || null;
  }
  function buffText(e) {
    var it = e.item && ITEMS[e.item], name = it ? it.name : e.effect, secs = e.duration ? ' for ' + Math.round(e.duration) + ' s' : '';
    switch (e.effect) {
      case 'mystery': return 'Mystery Potion: ' + (e.mystery === 'nothing' ? 'nothing happened (you were already full).' : e.mystery === 'poison' ? 'poison! Find cover.' : ITEMS[e.mystery].name.replace(' Potion', '').toLowerCase() + secs + '.');
      case 'poison': return e.by && e.by !== match.player ? 'Poisoned by ' + e.by.name + ': 10 damage per second and slowed' + secs + '.' : 'Poisoned: 10 damage per second and slowed' + secs + '.';
      case 'regen': return 'First Aid Kit: healing 100 HP over 15 s.';
      case 'shieldo': return 'Shieldo Shieldo: immune for 1 s, then half damage for 5 s.';
      case 'drone': return 'Drone up: every enemy shows on your map and screen edges for 1 minute.';
      case 'radar': return 'Radar on: nearby enemies ping for 30 s.';
      case 'invisible': return 'You are invisible to enemies for 30 s. Shooting still gives you away.';
      case 'power': return name + ': +15% damage, +15% speed, 15% less damage taken' + secs + (it && it.deathImmune ? ', and 10 s of death immunity' : '') + '.';
      default: return name + secs + '.';
    }
  }

  function handleEvents(events) {
    var p = match.player;
    for (var i = 0; i < events.length; i++) {
      var e = events[i], mine = e.player === p;
      switch (e.type) {
        case 'shot': play(e.weapon, mine ? 0.75 : spatial(e.player.x, e.player.y) * 0.7); break;
        case 'launch': play('launcher', mine ? 0.8 : spatial(e.player.x, e.player.y)); break;
        case 'shell-land': play('throw', spatial(e.x, e.y) * 0.6); break;
        case 'throw': if (mine) play('throw'); break;
        case 'reload': if (mine) play('reload'); break;
        case 'reloaded': if (mine) play('reloaded'); break;
        case 'switch': if (mine) play('switch', 0.6); break;
        case 'explosion': {
          var d = Math.hypot(e.x - p.x, e.y - p.y), heavy = e.power >= 80;
          play('explosion', spatial(e.x, e.y) * (heavy ? 1 : 0.75));
          shake = Math.max(shake, U.clamp(1 - d / 750, 0, 1) * (heavy ? 0.9 : 0.55));
          break;
        }
        case 'damage':
          if (e.target === p) { play('hurt', e.cause === 'storm' ? 0.5 : 1); W.Hud.hurt(); if (e.cause !== 'storm') shake = Math.max(shake, 0.3); }
          else if (e.source === p) play('hit', 0.7);
          break;
        case 'crate': if (e.source === p) play('crate'); break;
        case 'legendary-crate-broken':
          W.Hud.banner('Legendary crate opened!', (e.player ? e.player.name : 'Someone') + ' broke the center crate · all four legendary items dropped', 5, '#ffd23f');
          W.Hud.feed('The legendary crate at the center has been broken.', 'key'); play('crate'); break;
        case 'command':
          if (e.team === p.team) { W.Hud.banner('Command boost', '+25% damage, speed and fire rate for 15 seconds', 3, '#75cfff'); play('upgrade'); }
          break;
        case 'pickup':
          if (!mine) break;
          play(e.what === 'token' ? 'token' : e.what === 'item' ? 'item' : 'key');
          var nextCost = W.Rules.nextUpgradeCost(p.classId);
          if (e.what === 'token' && nextCost > 0 && e.total >= nextCost && e.total - e.amount < nextCost) {
            W.Hud.banner('Upgrade ready', 'Find an Upgrade Station (glowing blue hexagon) and press ' + Controls.primary('interact'), 2.8, '#ffd23f');
          }
          if (e.what === 'key') W.Hud.feed('Station key found: it skips one station recharge.', 'key');
          if (e.what === 'armor') W.Hud.feed('Armor plate: +' + C.armorPlate + ' armor (' + Math.round(e.total) + '/' + C.armorMax + '). Armor soaks up damage before your HP.', 'key');
          if (e.what === 'item' && e.item && ITEMS[e.item]) {
            W.Hud.feed('Found ' + e.amount + '× ' + ITEMS[e.item].name + ' (' + W.TIERS[ITEMS[e.item].tier].name + ').', 'key');
            if (!invHintShown) { invHintShown = true; W.Hud.banner('New item', 'Press ' + Controls.primary('inventory') + ' for inventory, its hotbar key to hold it, or ' + Controls.primary('drop') + ' to drop the held stack', 3, W.TIERS[ITEMS[e.item].tier].color); }
          }
          break;
        case 'item-used': if (mine) play(itemSound(e.item)); break;
        case 'item-dropped':
          if (mine && ITEMS[e.item]) { play('switch', 0.6); W.Hud.feed('Dropped ' + e.amount + '× ' + ITEMS[e.item].name + '. Press ' + Controls.primary('interact') + ' nearby to pick it up.', 'muted'); }
          break;
        case 'burst': {
          var bs = burstSound(e.item), bd = Math.hypot(e.x - p.x, e.y - p.y);
          if (bs) play(bs, spatial(e.x, e.y));
          if (e.item === 'blackhole' || e.item === 'firenade' || e.item === 'snowbomb') shake = Math.max(shake, U.clamp(1 - bd / 800, 0, 1) * 0.5);
          break;
        }
        case 'flashed': if (mine) { play('flash'); W.Hud.hurt(); } break;
        case 'buff':
          if (mine) { play(e.effect === 'poison' ? 'hurt' : e.effect === 'drone' || e.effect === 'radar' ? 'drone' : 'drink'); W.Hud.feed(buffText(e), e.effect === 'poison' ? 'kill' : 'heal'); }
          else if (e.effect === 'drone' && e.player && e.player.team === p.team) W.Hud.feed(e.player.name + ' launched a drone: enemies show on your map for 1 minute.', 'key');
          break;
        case 'zone': play(e.zone.kind === 'snow' ? 'freeze' : e.zone.kind === 'fire' ? 'fire' : 'throw', spatial(e.zone.x, e.zone.y)); break;
        case 'struct':
          if (!e.struct) break;
          if (e.op === 'add') play('place', spatial(e.struct.x, e.struct.y));
          else if (e.op === 'gone') {
            if (e.reason === 'recovered') { if (e.source === p || e.source === p.id) W.Hud.feed('Rock returned to your hotbar.', 'info'); else if (e.struct.owner === p.id) W.Hud.feed('Your teammate picked up your rock.', 'info'); }
            else { play('crate', spatial(e.struct.x, e.struct.y)); if (e.struct.owner === p.id) W.Hud.feed('Your ' + ITEMS[e.struct.item].name + ' was destroyed.', 'muted'); }
          }
          break;
        case 'strike': {
          var sd = Math.hypot(e.strike.x - p.x, e.strike.y - p.y);
          play('strike', Math.max(0.3, spatial(e.strike.x, e.strike.y)));
          if (sd < (e.strike.radius || 150) + 120 && (e.strike.kind === 'airstrike' || e.strike.owner !== p.id)) W.Hud.feed(e.strike.kind === 'airstrike' ? 'Airstrike incoming! Five seconds to move!' : e.strike.kind === 'meteor' ? 'Meteor incoming! Move!' : 'Lightning is about to strike you!', 'kill');
          break;
        }
        case 'strike-hit': {
          var hd = Math.hypot(e.strike.x - p.x, e.strike.y - p.y), meteor = e.strike.kind === 'meteor' || e.strike.kind === 'airstrike';
          play(meteor ? 'meteor' : 'zap', spatial(e.strike.x, e.strike.y) * (meteor ? 1 : 0.8));
          shake = Math.max(shake, U.clamp(1 - hd / 1000, 0, 1) * (meteor ? 1 : 0.5));
          break;
        }
        case 'mounted': if (mine) { play('mount'); W.Hud.feed('On the turret: click to fire, ' + Controls.primary('interact') + ' to get off. Damage hits you, not the turret.', 'info'); } break;
        case 'dismounted': if (mine) play('switch', 0.6); break;
        case 'teleport': play('tele', mine ? 0.9 : spatial(e.x, e.y)); if (mine) shake = Math.max(shake, 0.3); break;
        case 'pulled': if (mine) { play('blackhole'); shake = Math.max(shake, 0.6); } break;
        case 'saved':
          if (mine) { play('upgrade'); W.Hud.banner('Death immunity!', 'Power Potion II saved you at 30 HP. The potion has worn off.', 3, '#ffd23f'); }
          else W.Hud.feed(e.player.name + ' cheated death with a Power Potion II.', 'key');
          break;
        case 'blocked': if (mine) play('hit', 0.5); break;
        case 'sentry-shot': play('sentry', spatial(e.x, e.y) * 0.6); break;
        case 'heal':
          if (mine) { play('heal'); W.Hud.feed((e.by && e.by !== p ? e.by.name + ' healed you' : e.item && ITEMS[e.item] ? ITEMS[e.item].name : 'Medkit') + ': +' + Math.round(e.amount) + ' HP.', 'heal'); }
          else if (e.by === p) W.Hud.feed('You healed ' + e.player.name + ' for ' + Math.round(e.amount) + ' HP.', 'heal');
          break;
        case 'deny': if (mine) denyMessage(e); break;
        case 'upgrade':
          if (!mine) break;
          play('upgrade');
          W.Hud.banner('You are now a ' + CLASSES[e.classId].name, CLASSES[e.classId].loadout.map(function (id) { return WEAPONS[id].name; }).join(' + '), 3, CLASSES[e.classId].color);
          W.Hud.feed('Upgraded to ' + CLASSES[e.classId].name + (e.usedKey ? ' using a station key' : '') + '. Station ' + e.station.number + ' recharges for ' + U.formatTime(C.stationCooldown) + '.', 'upgrade');
          if (e.classId === 'sniper') W.Hud.feed('Sniper tip: hold ' + Controls.primary('scope') + ' to scope out for a wider view.', 'info');
          break;
        case 'land':
          if (!mine) break;
          play('land');
          shake = Math.max(shake, 0.5);
          W.Hud.feed('Landed at Drop Station ' + match.drop + '. Press ' + Controls.primary('map') + ' for the map.', 'info');
          break;
        case 'storm':
          if (e.state === 'shrinking') { play('storm'); W.Hud.banner('The storm is closing in', 'Get inside the white circle', 2.8, '#d7a6ff'); }
          else if (e.state === 'waiting' && e.phase > 0) W.Hud.feed('The storm paused. It moves again in ' + U.formatTime(e.timeLeft) + '.', 'storm');
          else if (e.state === 'final') W.Hud.feed('Final storm: the safe zone is gone.', 'storm');
          break;
        case 'downed':
          if (mine) { play('death'); W.Hud.banner('You are down!', 'Crawl to your team · they can revive you', 3, '#ff8a7a'); }
          else W.Hud.feed((e.source ? nameOf(e.source) + ' knocked down ' : 'Knocked down: ') + e.player.name, e.player.team === p.team ? 'storm' : 'kill');
          break;
        case 'revived':
          if (mine) { play('upgrade'); W.Hud.banner('Back on your feet', (e.by ? e.by.name + ' revived you' : 'Revived'), 2.4, '#63ff9e'); }
          else W.Hud.feed((e.by ? nameOf(e.by) + ' revived ' : 'Revived: ') + e.player.name, 'heal');
          break;
        case 'death':
          if (e.victim === p) { play('death'); match.cause = e.cause; }
          else if (e.cause === 'storm') W.Hud.feed(e.victim.name + ' got caught in the storm', 'kill');
          else if (e.cause === 'left') W.Hud.feed(e.victim.name + ' left the island', 'muted');
          else if (e.cause === 'bleedout' || e.cause === 'wiped') W.Hud.feed(e.victim.name + ' is out', 'kill');
          else W.Hud.feed((e.killer ? nameOf(e.killer) + ' eliminated ' : 'Eliminated: ') + e.victim.name, e.killer === p ? 'upgrade' : 'kill');
          break;
      }
    }
  }

  // Scoping (hold right click with the Sniper Rifle) widens the view; nothing else changes the zoom.
  function updateCamera(dt) {
    var cam = match.cam, focus = match.online ? Online.focus() : match.player, p = match.player;
    var def = WEAPONS[p.weapons[p.slot].id], target = focus === p && p.scoping && def.zoom ? 1 / def.zoom : 1;
    if (focus === p && p.dropT > 0) cam.zoom = 0.45 + (1 - 0.45) * U.easeInOut(1 - p.dropT / C.dropDuration);
    else cam.zoom += (target - cam.zoom) * Math.min(1, dt * 6);
    if (focus && (focus.alive || focus === p)) { cam.x = focus.x + (focus.ox || 0); cam.y = focus.y + (focus.oy || 0); }
  }

  function hudExtra() {
    if (!match.online) return {};
    var st = Online.state(), focus = Online.focus();
    return {
      online: true, alive: st ? st.alive : undefined, total: match.world.players.length, ping: W.MatchNet.latency(),
      spectating: focus && focus !== match.player ? focus.name : null, placement: match.placement
    };
  }

  function aimingTrajectory() {
    if (!match || blockedNow() || W.MapScreen.isOpen() || W.Inventory.isOpen()) return null;
    var p = match.player, gearAim = Controls.down(input, 'gear') && p.weapons.some(function (w) { return w.id === 'grenade'; });
    var id = gearAim ? 'grenade' : Controls.down(input, 'fire') ? match.world.aimedProjectile(p) : null;
    if (!id || !p.alive || p.downed || p.dropT > 0) return null;
    return match.world.throwSolution(p, renderer.screenToWorld(match.cam, input.mouse.x, input.mouse.y), id);
  }

  function frame(now) {
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      if (state === 'menu' || !match) {
        W.Demo.update(demo, dt);
        renderer.render(demo.world, demo.cam, { names: true });
        handleKeys();
      } else if (!match.online) {
        handleKeys();
        match.world.update(dt);
        var events = match.world.events;
        match.world.events = [];
        handleEvents(events);
        updateCamera(dt);
        shake = Math.max(0, shake - dt * 2.6);
        renderer.render(match.world, match.cam, { viewer: match.player, shake: shake, trajectory: aimingTrajectory() });
        W.Hud.update(match.world, match.player, dt, {});
        W.MapScreen.draw(match.world, match.player);
        W.Inventory.draw(match.world, match.player);
        W.UpgradeTree.tick(dt);
        if (!match.player.alive && !match.deathShown) {
          match.deathT += dt;
          if (match.deathT > 1.3) { match.deathShown = true; practiceResult(); }
        }
      } else {
        handleKeys();
        Online.latch(input);
        acc += dt;
        var blocked = blockedNow(), mapOpen = W.MapScreen.isOpen() || W.Inventory.isOpen(), steps = 0;
        while (acc >= Online.STEP && steps++ < 5) { Online.step(input, renderer, blocked, mapOpen); acc -= Online.STEP; }
        if (acc >= Online.STEP) acc = 0;
        match.world.update(dt);
        var ev = match.world.events;
        match.world.events = [];
        handleEvents(ev);
        Online.interpolate();
        Online.frame(dt, acc / Online.STEP);
        updateCamera(dt);
        shake = Math.max(0, shake - dt * 2.6);
        renderer.render(match.world, match.cam, { viewer: match.player, shake: shake, names: true, trajectory: aimingTrajectory() });
        W.Hud.update(match.world, match.player, dt, hudExtra());
        W.MapScreen.draw(match.world, match.player);
        W.Inventory.draw(match.world, match.player);
        W.UpgradeTree.tick(dt);
      }
    } finally {
      input.endFrame();
      requestAnimationFrame(frame);
    }
  }

  // ---------------------------------------------------------------- boot
  function bindUi() {
    $('play-btn').addEventListener('click', function () { W.Audio.unlock(); W.Menu.openModePicker(); });
    $('settings-btn').addEventListener('click', function () { W.Audio.unlock(); W.Menu.openSettings('controls'); });
    $('friends-btn').addEventListener('click', function () { W.Menu.openFriends(); });
    $('account-chip').addEventListener('click', function () { W.Menu.openSettings(Net.online() ? 'account' : 'online'); });
    $('net-chip').addEventListener('click', function () { W.Menu.openSettings('online'); });
    $('resume-btn').addEventListener('click', function () { togglePause(false); });
    $('pause-settings-btn').addEventListener('click', function () { W.Menu.openSettings('controls'); });
    $('pause-map-btn').addEventListener('click', function () { togglePause(false); W.MapScreen.show(); });
    $('leave-btn').addEventListener('click', leaveMatch);
    $('again-btn').addEventListener('click', function () {
      var online = match && match.online;
      leaveMatch();
      if (online) W.Menu.openModePicker(); else startPractice();
    });
    $('menu-btn').addEventListener('click', leaveMatch);
    $('spectate-btn').addEventListener('click', function () { $('death-screen').hidden = true; setScreen('play'); blurActive(); });
    $('mute-btn').addEventListener('click', function () { setMuted(!Controls.muted()); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-test]'), function (btn) {
      btn.addEventListener('click', function () {
        if (!match || match.online || !match.player.alive) return;
        var p = match.player, world = match.world, msg;
        switch (btn.getAttribute('data-test')) {
          case 'tokens': p.tokens += C.upgradeCost; msg = '+' + C.upgradeCost + ' tokens (you have ' + p.tokens + ').'; break;
          case 'key': p.keys += 1; msg = '+1 station key (you have ' + p.keys + ').'; break;
          case 'hurt':
            if (p.hp <= 1) { msg = 'Already at 1 HP.'; break; }
            world.damagePlayer(p, Math.min(30, Math.ceil(p.hp) - 1), null, 'test');
            msg = 'Took damage: ' + Math.ceil(p.hp) + ' HP left.';
            break;
          case 'reset': world.setClass(p, 'soldier', false); msg = 'Back to Soldier. Upgrade again at any ready station.'; break;
          case 'items':
            SAMPLE_KIT.forEach(function (id) { world.addItem(p, id, ITEMS[id].found); });
            msg = 'Hotbar filled. Press ' + Controls.primary('inventory') + ' in the match to open your inventory.';
            break;
          case 'armor': p.armor = Math.min(C.armorMax, p.armor + C.armorPlate); msg = 'Armor: ' + p.armor + '/' + C.armorMax + '.'; break;
        }
        $('test-status').textContent = msg;
      });
    });
  }

  function bindNetwork() {
    Online.init({
      onStart: startOnline,
      onEliminated: function (m) { if (!match || !match.online) return; match.placement = m.placement; match.cause = m.cause; showResult('eliminated', m); },
      onSpectating: function () { if (!match || !match.online) return; match.spectating = true; W.Hud.banner('You are out', 'Spectating your team', 2.6, '#ff8a7a'); },
      onEnd: function (m) { if (!match || !match.online) return; match.ended = true; if (m.placement) match.placement = m.placement; showResult('end', m); },
      onClosed: function (code, reason, pending) {
        if (pending) { toast(code === 4404 ? 'That match is already over.' : code === 4401 ? 'The match did not accept the ticket.' : 'Could not join the match (' + (reason || code) + ').'); return; }
        if (match && match.online && !match.result) { toast('Connection to the match was lost.'); leaveMatch(); }
      }
    });
    Net.on('match-ticket', function (m) { if (match && match.online) return; Online.join(m.id, m.ticket, false); });
    Account.onChange(function (what, data) {
      if (what === 'rejoin' && data && !match && !Online.joining()) Online.join(data.id, data.ticket, true);
    });
    Net.on('notice', function (m) { if (match) W.Hud.feed(m.text, m.kind === 'friend' ? 'key' : 'muted'); else toast(m.text); });
    Net.on('lobby-error', function (m) { toast(m.reason === 'inmatch' ? 'Finish or leave your current match first.' : 'Matchmaking: ' + m.reason); });
    Net.on('party-error', function (m) { toast(m.reason === 'notinvited' ? 'That invite expired.' : m.reason === 'full' ? 'That team is full.' : 'Team: ' + m.reason); });
    Net.on('net-closed', function (m) { if (match && match.online && m.wasOnline) W.Hud.feed('Hub connection lost. Reconnecting…', 'muted'); });
    Net.connect({ hello: Account.hello, url: params.get('server') || undefined });
  }

  function boot() {
    canvas = $('game');
    renderer = new W.Renderer(canvas);
    renderer.resize();
    input = new W.Input(canvas);
    window.addEventListener('resize', function () { renderer.resize(); });
    W.Hud.init();
    W.MapScreen.init();
    W.UpgradeTree.init({ onUpgrade: doUpgrade, onClose: function () { input.release(); blurActive(); } });
    W.Inventory.init({ onSelect: selectHotbar, onUse: useHotbar, onClose: function () { input.release(); blurActive(); } });
    W.Menu.init({
      onPractice: startPractice,
      inMatch: function () { return !!match; },
      inMenu: function () { return state === 'menu'; },
      onClose: function () { input.release(); if (state === 'play' && !pauseOpen) blurActive(); },
      onBindingsChanged: function () { W.Hud.refreshHints(); W.MapScreen.refreshHint(); W.Inventory.refreshHint(); },
      onMuteChanged: setMuted,
      onAccountChanged: function () { W.Menu.syncChips(); }
    });
    setMuted(Controls.muted());
    demo = W.Demo.create(params.get('demoSeed') ? Number(params.get('demoSeed')) : 0);
    bindUi();
    bindNetwork();
    setScreen('menu');
    W.App.ready = true;
    requestAnimationFrame(function (t) { last = t; frame(t); });
  }

  // Hooks used by the QA scripts and handy from the browser console.
  W.App = { ready: false, startMatch: startPractice, startPractice: startPractice, leaveMatch: leaveMatch, state: function () { return state; } };
  W.debug = {
    match: function () { return match; },
    demo: function () { return demo; },
    player: function () { return match && match.player; },
    renderer: function () { return renderer; },
    online: function () { return Online.state(); },
    controls: Controls,
    giveTokens: function (n) { match.player.tokens += n; },
    giveKeys: function (n) { match.player.keys += n; },
    giveItem: function (id, n) { return match.world.addItem(match.player, id, n || (ITEMS[id] ? ITEMS[id].found : 1)); },
    selectHotbar: selectHotbar, useHotbar: useHotbar, interact: sendInteract,
    teleport: function (x, y) { var p = match.player; p.x = x; p.y = y; p.vx = 0; p.vy = 0; match.world.collide(p); match.cam.x = p.x; match.cam.y = p.y; },
    stationNear: function () {
      var p = match.player, list = match.world.map.stations.slice().sort(function (a, b) {
        return Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y);
      });
      return list[0];
    },
    skipTime: function (s) { match.world.time += s; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
}());
