/* Artillery uses the island map, with a movable view only inside fire control. */
(function () {
  'use strict';
  var W = window.Warz, U = W.U, Controls = W.Controls, MAX_ZOOM = 8, START_ZOOM = 3;
  var panel, canvas, context, status, targetLabel, fireButton, zoomLabel, terrain, terrainContext;
  var baseMap, terrainKey = '', currentWorld, currentPlayer;
  var opened = false, queuedMode = null, queuedFire = false, lastVehicle = 0;
  var center = { x: 0, y: 0 }, target = null, zoom = START_ZOOM, scale = 1, size = 1, width = 1, height = 1, dpr = 1;
  function vehicle(world, player) { return player && player.vehicle && world && world.vehicleById(player.vehicle); }
  function valid(world, player) { var v = vehicle(world, player); return v && v.type === 'artillery' && !v.wreck && player.alive && !player.downed && player.vehicleSeat === 'driver'; }
  function mapSize() { return currentWorld && currentWorld.map.size || W.CONFIG.worldSize; }
  function clampCenter() {
    var S = mapSize(), halfW = width / (2 * scale), halfH = height / (2 * scale);
    center.x = halfW >= S / 2 ? S / 2 : U.clamp(center.x, halfW, S - halfW);
    center.y = halfH >= S / 2 ? S / 2 : U.clamp(center.y, halfH, S - halfH);
  }
  function metrics() {
    var nextWidth = Math.max(1, window.innerWidth), nextHeight = Math.max(1, window.innerHeight);
    var nextDpr = Math.min(2, window.devicePixelRatio || 1), pxW = Math.round(nextWidth * nextDpr), pxH = Math.round(nextHeight * nextDpr);
    if (nextWidth !== width || nextHeight !== height || nextDpr !== dpr || canvas.width !== pxW || canvas.height !== pxH) {
      width = nextWidth; height = nextHeight; size = Math.min(width, height); dpr = nextDpr;
      canvas.width = terrain.width = pxW; canvas.height = terrain.height = pxH;
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; terrainKey = '';
    }
    scale = size / mapSize() * zoom; clampCenter();
  }
  function screenToWorld(x, y) {
    var rect = canvas.getBoundingClientRect(), left = rect.left + canvas.clientLeft, top = rect.top + canvas.clientTop;
    return { x: center.x + (x - left - width / 2) / scale, y: center.y + (y - top - height / 2) / scale };
  }
  function worldToScreen(x, y) {
    var rect = canvas.getBoundingClientRect();
    return { x: rect.left + canvas.clientLeft + width / 2 + (x - center.x) * scale,
      y: rect.top + canvas.clientTop + height / 2 + (y - center.y) * scale };
  }
  function ensure() {
    if (panel) return;
    panel = document.createElement('section'); panel.id = 'artillery-screen'; panel.hidden = true;
    panel.setAttribute('aria-label', 'Artillery island map');
    panel.innerHTML = '<canvas id="artillery-map" aria-label="Island map: click to select an artillery target"></canvas>' +
      '<div class="artillery-map-bar"><span class="artillery-map-name">Island map <small>Artillery</small></span>' +
      '<span id="artillery-zoom">1×</span><button type="button" id="artillery-close" aria-label="Return to driving">Esc<span class="artillery-close-label"> · Drive</span></button></div>' +
      '<div class="artillery-controls"><span class="artillery-map-hint">Scroll to zoom · WASD pan · click target</span>' +
      '<div class="artillery-fire-row"><div><b id="artillery-status">Setting up</b><span id="artillery-target">Select a target</span></div>' +
      '<button type="button" id="artillery-fire" disabled>Enter · Fire</button></div></div>';
    document.body.appendChild(panel); canvas = document.getElementById('artillery-map'); context = canvas.getContext('2d');
    terrain = document.createElement('canvas'); terrainContext = terrain.getContext('2d');
    status = document.getElementById('artillery-status'); targetLabel = document.getElementById('artillery-target');
    fireButton = document.getElementById('artillery-fire'); zoomLabel = document.getElementById('artillery-zoom');
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !opened) return;
      e.preventDefault(); var at = screenToWorld(e.clientX, e.clientY), S = mapSize();
      target = { x: U.clamp(at.x, 0, S), y: U.clamp(at.y, 0, S) };
    });
    canvas.addEventListener('wheel', function (e) {
      if (!opened || !e.deltaY) return;
      e.preventDefault(); e.stopPropagation(); metrics();
      var before = screenToWorld(e.clientX, e.clientY);
      var delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size : 1);
      zoom = U.clamp(zoom * Math.exp(-delta * .0015), 1, MAX_ZOOM); scale = size / mapSize() * zoom;
      var after = screenToWorld(e.clientX, e.clientY);
      center.x += before.x - after.x; center.y += before.y - after.y; clampCenter(); draw();
    }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.getElementById('artillery-close').addEventListener('click', close); fireButton.addEventListener('click', requestFire);
  }
  function ready() {
    var v = vehicle(currentWorld, currentPlayer);
    return v && valid(currentWorld, currentPlayer) && v.stationaryT >= W.ARTILLERY.stationarySeconds - .001 && !(v.artilleryCooldown > .001);
  }
  function requestFire() { if (opened && target && ready()) queuedFire = true; }
  function close() { if (opened) queuedMode = 0; opened = false; queuedFire = false; if (panel) panel.hidden = true; }
  function clear() { close(); queuedMode = null; target = null; currentWorld = currentPlayer = null; lastVehicle = 0; }
  function open(world, player) {
    if (!valid(world, player)) return false;
    ensure(); currentWorld = world; currentPlayer = player;
    W.MapScreen.hide(); W.Inventory.hide(); W.EmotePicker.close();
    var occupied = vehicle(world, player);
    var closeButton = document.getElementById('artillery-close');
    closeButton.setAttribute('aria-label', occupied.fixed ? 'Close targeting map' : 'Return to driving');
    closeButton.querySelector('.artillery-close-label').textContent = occupied.fixed ? ' · Close' : ' · Drive';
    panel.querySelector('.artillery-map-name small').textContent = occupied.fixed ? 'Ground artillery' : 'SP Artillery';
    zoom = START_ZOOM; center.x = occupied.x; center.y = occupied.y; target = null;
    queuedMode = 1; queuedFire = false; opened = true; panel.hidden = false; terrainKey = '';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    draw(); return true;
  }
  function consume(input, action) { Controls.bindings(action).forEach(function (code) { if (code) input.consume(code); }); }
  function tick(world, player, input, dt, blocked) {
    currentWorld = world; currentPlayer = player;
    if (!valid(world, player)) { if (opened) close(); lastVehicle = 0; return; }
    if (blocked) { if (opened) close(); return; }
    if (lastVehicle !== player.vehicle) { lastVehicle = player.vehicle; if (player.vehicleWeapon === 1) open(world, player); }
    if (Controls.hit(input, 'weapon1')) { close(); consume(input, 'weapon1'); }
    else if (Controls.hit(input, 'weapon2')) { if (!opened) open(world, player); consume(input, 'weapon2'); }
    if (!opened) return;
    if (input.hit('Escape')) { input.consume('Escape'); close(); return; }
    if (Controls.hit(input, 'interact')) { close(); return; }
    if (input.hit('Enter') || input.hit('NumpadEnter')) { requestFire(); input.consume('Enter'); input.consume('NumpadEnter'); }
    var mx = (Controls.down(input, 'right') ? 1 : 0) - (Controls.down(input, 'left') ? 1 : 0);
    var my = (Controls.down(input, 'down') ? 1 : 0) - (Controls.down(input, 'up') ? 1 : 0), len = Math.hypot(mx, my);
    if (len > 0) { var step = dt * mapSize() / zoom * .5; center.x += mx / len * step; center.y += my / len * step; clampCenter(); }
    draw();
  }
  function terrainImage(pxW, pxH, mapPx, view) {
    if (baseMap !== currentWorld.map) { baseMap = currentWorld.map; terrainKey = ''; }
    var key = [pxW, pxH, zoom, center.x, center.y, baseMap.foliageVersion || 0].join('|');
    if (terrainKey === key) return terrain;
    terrainKey = key;
    terrainContext.setTransform(1, 0, 0, 1, 0, 0); terrainContext.clearRect(0, 0, pxW, pxH);
    terrainContext.fillStyle = '#2f7fc2'; terrainContext.fillRect(0, 0, pxW, pxH);
    var k = mapPx / mapSize();
    terrainContext.setTransform(zoom, 0, 0, zoom, pxW / 2 - center.x * k * zoom, pxH / 2 - center.y * k * zoom);
    W.MapArt.paintBase(terrainContext, baseMap, mapPx, { big: true, labelPx: 13 * dpr / zoom, dpr: dpr / zoom, view: view });
    return terrain;
  }
  function draw() {
    if (!opened) return;
    metrics(); var pxW = canvas.width, pxH = canvas.height, mapPx = Math.min(pxW, pxH), S = mapSize();
    var halfW = width / (2 * scale), halfH = height / (2 * scale);
    var view = { x0: center.x - halfW, x1: center.x + halfW, y0: center.y - halfH, y1: center.y + halfH };
    var g = context; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, pxW, pxH);
    g.drawImage(terrainImage(pxW, pxH, mapPx, view), 0, 0);
    var k = mapPx / S;
    g.setTransform(zoom, 0, 0, zoom, pxW / 2 - center.x * k * zoom, pxH / 2 - center.y * k * zoom);
    W.MapArt.overlay(g, currentWorld, currentPlayer, mapPx, { big: true, dpr: dpr / zoom, allVehicles: true, tinyPlayers: true, view: view });
    g.setTransform(pxW / width, 0, 0, pxH / height, 0, 0);
    if (target) {
      var x = width / 2 + (target.x - center.x) * scale, y = height / 2 + (target.y - center.y) * scale;
      g.fillStyle = 'rgba(255,69,79,.16)'; g.strokeStyle = '#ff454f'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, W.ARTILLERY.blastRadius * scale, 0, U.TAU); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    var v = vehicle(currentWorld, currentPlayer), setup = Math.max(0, W.ARTILLERY.stationarySeconds - (v.stationaryT || 0));
    var cooldown = Math.max(0, v.artilleryCooldown || 0);
    status.textContent = setup > .001 ? 'Setting up · ' + setup.toFixed(1) + 's' : cooldown > .001 ? 'Reloading · ' + cooldown.toFixed(1) + 's' : 'Ready';
    status.className = ready() ? 'is-ready' : '';
    targetLabel.textContent = target ? 'Target ' + Math.round(target.x) + ', ' + Math.round(target.y) : 'Click a target on the map';
    fireButton.disabled = !target || !ready(); zoomLabel.textContent = Number(zoom.toFixed(1)) + '×';
  }
  function intent(p) {
    if (!valid(currentWorld, p)) return null;
    if (!opened && queuedMode === null) return null;
    var result = { mode: opened ? 1 : queuedMode, target: target ? { x: target.x, y: target.y } : null, fire: !!queuedFire };
    queuedMode = null; queuedFire = false; return result;
  }
  W.ArtilleryUI = { tick: tick, intent: intent, open: open, close: close, clear: clear,
    isOpen: function () { return opened; }, draw: draw, screenToWorld: screenToWorld, worldToScreen: worldToScreen,
    view: function () { return { zoom: zoom, centerX: center.x, centerY: center.y, scale: scale, size: size, width: width, height: height,
      target: target ? { x: target.x, y: target.y } : null }; } };
}());
