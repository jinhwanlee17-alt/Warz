'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createServer } = require('./serve.js');
const { openBrowser } = require('./qa-browser.cjs');

async function main() {
  const deployedUrl = process.env.WARZ_QA_URL;
  const server = deployedUrl ? null : createServer();
  if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(deployedUrl || 'http://127.0.0.1:' + server.address().port + '/');
  url.searchParams.set('seed', '112'); url.searchParams.set('qa', 'level3-menu');
  const outDir = path.resolve(__dirname, deployedUrl ? '../output/qa-live-level3-menu' : '../output/qa-level3-menu'), report = [];
  const check = (ok, message) => { assert.ok(ok, message); report.push(message); console.log('ok  ' + message); };
  let b;
  try {
    b = await openBrowser({ outDir, width: 1440, height: 1000 });
    const evaluate = (fn, ...args) => b.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');
    const click = async selector => {
      const p = await evaluate(s => { const el = document.querySelector(s); el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await b.cmd('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    };
    await b.cmd('Page.navigate', { url: url.href });
    await b.waitFor('window.Warz?.App?.ready');
    check(await evaluate(() => Warz.CLASS_ORDER.filter(id => Warz.CLASSES[id].tier === 3).length === 7 && Object.keys(Warz.CLASS_PLANNED).length === 4), 'class browser offers seven released upgrades and four future branches');
    if (deployedUrl) check(await evaluate(() => new Set([...document.scripts].filter(s => s.src.includes('/js/')).map(s => new URL(s.src).searchParams.get('v'))).size === 1 && ['engineer', 'shieldoperator', 'rocketeer', 'shotgunner3', 'magicmedic', 'pyromaniac', 'gastroop'].every(id => Warz.CLASSES[id])), 'published game includes all seven released level-three classes with one asset version');
    await evaluate(() => {
      Warz.App.startPractice();
      const m = Warz.debug.match(), w = m.world, p = m.player;
      window.qaStation = { ...w.map.stations[0], id: 0, x: 5060, y: 5000, cooldown: 0 };
      ['rocks', 'trees', 'bushes', 'buildings', 'crates', 'pickups', 'ponds', 'drops'].forEach(k => w.map[k] = []);
      w.solids = new Warz.U.SpatialHash(256); w.structures = []; w.vehicles = []; w.players = [p]; w.storm = null;
      w.map.stations = [qaStation]; p.x = 5000; p.y = 5000; p.dropT = 0; p.vx = p.vy = 0;
    });
    check(await evaluate(() => !Warz.debug.match().online && !Warz.debug.match().world.remote), 'all upgrade checks run only in browser-local Practice');
    const fixture = async (id, tokens = 40) => evaluate((id, tokens) => {
      const m = Warz.debug.match(), w = m.world, p = m.player;
      Warz.UpgradeTree.close(); w.setClass(p, id, true); p.alive = true; p.downed = false; p.dropT = 0;
      p.x = 5000; p.y = 5000; p.vx = p.vy = 0; p.tokens = tokens; p.keys = 0; qaStation.cooldown = 0;
      Warz.UpgradeTree.open({ world: w, player: p, station: qaStation });
    }, id, tokens);
    const branches = await b.evaluate('Object.keys(Warz.CLASS_PLANNED).map(id=>[id,Warz.CLASS_PLANNED[id].parent])');
    for (const [planned, parent] of branches) {
      await fixture(parent);
      check(await evaluate((planned, parent) => {
        const shown = [...document.querySelectorAll('.ut-node')].filter(el => !el.hidden).map(el => el.dataset.node).sort();
        return shown.join() === [planned, parent, 'engineer', 'shieldoperator', 'gastroop'].sort().join() && document.getElementById('ut-level3').getAttribute('aria-pressed') === 'true' && document.getElementById('ut-parent').value === parent;
      }, planned, parent), parent + ' opens its own level-three branch with exactly four upgrade choices');
      await click('#ut-node-' + planned);
      check(await evaluate(parent => document.getElementById('ut-action').disabled && document.getElementById('ut-action').textContent === 'Coming soon' && document.getElementById('ut-stats').textContent.includes(Warz.CLASSES[parent].name) && document.getElementById('ut-stats').textContent.includes('40 tokens'), parent), planned + ' shows its required predecessor, price and locked state');
      for (const available of ['engineer', 'shieldoperator', 'gastroop']) {
        await click('#ut-node-' + available);
        check(await evaluate(available => !document.getElementById('ut-action').disabled && document.getElementById('ut-action').textContent.includes('40 tokens') && document.getElementById('ut-detail-title').textContent === Warz.CLASSES[available].name, available), available + ' is purchasable from ' + parent);
      }
    }
    await fixture('sniper2', 39);
    check(await evaluate(() => document.getElementById('ut-action').disabled && document.getElementById('ut-action').textContent.includes('Need 40 tokens')), '39 tokens cannot buy a level-three class');
    await fixture('sniper2');
    await b.sleep(250); await b.shot('engineer-upgrade-desktop.png');
    await click('#ut-action');
    await b.waitFor('Warz.debug.player().classId === "engineer"');
    check(await evaluate(() => Warz.debug.player().tokens === 0 && Warz.debug.player().weapons[0].id === 'wrench'), 'real station action buys Engineer for exactly 40 tokens');
    await b.waitFor('!Warz.UpgradeTree.isOpen()');
    await fixture('grenadier2');
    check(await evaluate(() => {
      const shown = [...document.querySelectorAll('.ut-node')].filter(el => !el.hidden).map(el => el.dataset.node).sort();
      return shown.join() === ['grenadier2', 'engineer', 'shieldoperator', 'rocketeer', 'gastroop'].sort().join();
    }), 'Grenadier II opens its released Rocketeer branch alongside the shared upgrades');
    await click('#ut-node-rocketeer');
    check(await evaluate(() => !document.getElementById('ut-action').disabled && document.getElementById('ut-stats').textContent.includes('65') && document.getElementById('ut-stats').textContent.includes('RPG') && document.getElementById('ut-action').textContent.includes('40 tokens')), 'Rocketeer preview shows 65 HP, RPG and the 40-token upgrade');
    await b.shot('rocketeer-upgrade-desktop.png');
    await click('#ut-action'); await b.waitFor('Warz.debug.player().classId === "rocketeer"');
    check(await evaluate(() => Warz.debug.player().tokens === 0 && Warz.debug.player().hp === 65 && Warz.debug.player().maxHp === 65 && Warz.debug.player().weapons.map(w => w.id).join() === 'rpg,pistol'), 'real station action buys Rocketeer with 65 HP and RPG plus Basic Pistol');
    await b.waitFor('!Warz.UpgradeTree.isOpen()');
    await fixture('commander');
    check(await evaluate(() => document.getElementById('ut-node-rocketeer').hidden), 'Rocketeer is not offered from another level-two branch');
    for (const [id, parent, hp] of [['shotgunner3', 'shotgunner2', 175], ['magicmedic', 'medic2', 300], ['pyromaniac', 'pyromancer', 150]]) {
      await fixture(parent);
      check(await evaluate((id, parent) => {
        const shown = [...document.querySelectorAll('.ut-node')].filter(el => !el.hidden).map(el => el.dataset.node).sort();
        return shown.join() === [parent, 'engineer', 'shieldoperator', 'gastroop', id].sort().join();
      }, id, parent), parent + ' displays its released class alongside the three shared upgrades');
      await click('#ut-node-' + id);
      check(await evaluate((id, hp) => !document.getElementById('ut-action').disabled && document.getElementById('ut-stats').textContent.includes(String(hp)) && document.getElementById('ut-action').textContent.includes('40 tokens') && !/penetrat|tank.*defen/i.test(document.getElementById('ut-detail').textContent), id, hp), id + ' preview has the correct health, 40-token price and public equipment details');
      await b.shot(id + '-upgrade-desktop.png');
      await click('#ut-action'); await b.waitFor('Warz.debug.player().classId === ' + JSON.stringify(id));
      check(await evaluate(id => {
        const p = Warz.debug.player();
        return p.tokens === 0 && p.maxHp === Warz.CLASSES[id].hp && p.weapons.map(w => w.id).join() === Warz.CLASSES[id].loadout.join();
      }, id), id + ' can be purchased through the real station action');
      await b.waitFor('!Warz.UpgradeTree.isOpen()');
    }
    await fixture('armorcrew');
    await click('#ut-node-shieldoperator'); await click('#ut-action');
    await b.waitFor('Warz.debug.player().classId === "shieldoperator"');
    check(await evaluate(() => Warz.debug.player().tokens === 0 && Warz.debug.player().weapons.map(w => w.id).join() === 'shieldpistol,explosiveshield'), 'real station action buys both Shield Operator slots for exactly 40 tokens');
    await b.waitFor('!Warz.UpgradeTree.isOpen()');
    await fixture('shieldoperator');
    check(await evaluate(() => document.getElementById('ut-detail-state').textContent.includes('CURRENT CLASS') && document.getElementById('ut-action').disabled), 'a level-three player sees the current class and cannot buy sideways');
    await fixture('soldier', 99);
    await click('#ut-level3');
    check(await evaluate(() => document.getElementById('ut-action').disabled && document.getElementById('ut-action').textContent.includes('level-two')), 'Soldier cannot skip the first two class levels');
    await click('#ut-level2'); await click('#ut-node-medic');
    check(await evaluate(() => document.getElementById('ut-node-soldier').hidden === false && document.getElementById('ut-node-engineer').hidden && document.getElementById('ut-action').textContent.includes('8 tokens')), 'Levels 1–2 tab preserves ordinary first-class upgrades');
    await fixture('medic', 15); await click('#ut-node-commander');
    check(await evaluate(() => document.getElementById('ut-level3').getAttribute('aria-pressed') === 'true' && document.getElementById('ut-detail-title').textContent === 'Commander' && !document.getElementById('ut-action').disabled && document.getElementById('ut-action').textContent.includes('15 tokens')), 'selecting a level-two class previews its next branch while retaining its 15-token action');
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await b.cmd('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false });
      await fixture('armorcrew');
      await evaluate(() => { const el = document.getElementById('ut-parent'); el.value = 'grenadier2'; el.dispatchEvent(new Event('change', { bubbles: true })); });
      check(await evaluate(() => !document.getElementById('ut-node-rocketeer').hidden && !document.getElementById('ut-node-engineer').hidden && !document.getElementById('ut-node-shieldoperator').hidden), size.width + 'px source selector browses the released Rocketeer branch');
      await click('#ut-node-rocketeer');
      check(await evaluate(() => document.getElementById('ut-action').disabled && document.getElementById('ut-stats').textContent.includes('RPG')), size.width + 'px can inspect Rocketeer but Armor Crew cannot buy it');
      await b.shot('rocketeer-upgrade-' + size.width + 'x' + size.height + '.png');
      await click('#ut-node-shieldoperator');
      check(await evaluate(() => document.getElementById('ut-detail-title').textContent === 'Shield Operator' && document.getElementById('ut-action').getBoundingClientRect().width < innerWidth), size.width + 'px Shield Operator detail and action fit the viewport');
      check(await evaluate(() => { const r = document.getElementById('ut-level3').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), size.width + 'px level navigation stays in view when the tree scrolls horizontally');
      await b.sleep(250); await b.shot('shield-operator-' + size.width + 'x' + size.height + '.png');
      await click('#ut-level2');
      check(await evaluate(() => document.getElementById('ut-level2').getAttribute('aria-pressed') === 'true' && !document.getElementById('ut-node-soldier').hidden), size.width + 'px can navigate back to earlier levels');
    }
    await b.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await fixture('grenadier2');
    await click('#ut-node-gastroop'); await click('#ut-action');
    await b.waitFor('Warz.debug.player().classId === "gastroop" && !Warz.UpgradeTree.isOpen()');
    check(await evaluate(() => Warz.debug.player().weapons.map(w => w.id).join() === 'boltrifle,heavydeagle,gasgrenade,gascylinder'), 'station equips the four Gas Troop slots in order');
    await fixture('gastroop', 1);
    await click('#ut-shop-tab'); await click('#ut-buy-gascylinder');
    check(await evaluate(() => Warz.debug.player().tokens === 0 && Warz.debug.player().gasCylinders === 4 && document.querySelector('#ut-buy-gascylinder').disabled), 'shop adds one cylinder to slot 4 and updates affordability');
    await fixture('medic', 3); await click('#ut-shop-tab');
    await b.shot('medic-class-shop.png');
    await evaluate(() => {
      const audio = Warz.Audio, play = audio.play;
      const state = window.qaPurchase = { sounds: 0, wasMuted: audio.isMuted(), play };
      audio.setMuted(false); audio.unlock();
      audio.play = function (name, volume) {
        if (name === 'purchase') state.sounds++;
        return play(name, volume);
      };
    });
    await click('#ut-buy-bandage');
    check(await evaluate(() => {
      const card = document.querySelector('#ut-buy-bandage').closest('.ut-offer');
      qaPurchase.firstBurst = card.querySelector('.ut-purchase-burst');
      return qaPurchase.firstBurst?.getAttribute('aria-hidden') === 'true' && qaPurchase.firstBurst.dataset.count === '+3' &&
        card.getAnimations({ subtree: true }).length > 0 && qaPurchase.sounds === 1;
    }), 'a successful bundle purchase animates its quantity and requests one purchase sound');
    await click('#ut-buy-bandage');
    check(await evaluate(() => {
      const bursts = document.querySelector('#ut-buy-bandage').closest('.ut-offer').querySelectorAll('.ut-purchase-burst');
      return bursts.length === 1 && bursts[0] !== qaPurchase.firstBurst && qaPurchase.sounds === 2;
    }), 'buying the same item again restarts its burst and requests one more sound');
    await b.sleep(110); await b.shot('shop-purchase-feedback.png');
    await b.waitFor('!document.querySelector(".ut-purchase-burst")');
    await b.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await click('#ut-buy-firstaid');
    check(await evaluate(() => {
      const art = document.querySelector('#ut-buy-firstaid').closest('.ut-offer').querySelector('.ut-offer-art');
      return art.querySelector('.ut-purchase-burst')?.dataset.count === '+1' && !art.getAnimations({ subtree: true }).length &&
        document.querySelector('#ut-status').textContent.includes('Purchased') && qaPurchase.sounds === 3;
    }), 'reduced motion preserves confirmation and sound without moving the item');
    await b.cmd('Emulation.setEmulatedMedia', { features: [] });
    check(await evaluate(() => { const m = Warz.debug.match(); return m.player.tokens === 0 && m.world.countItem(m.player, 'bandage') === 6 && m.world.countItem(m.player, 'firstaid') === 1; }), 'repeated Medic shop purchases reach the hotbar');
    await b.waitFor('!document.querySelector(".ut-purchase-burst")');
    await evaluate(() => {
      const { world, player } = Warz.debug.match();
      player.tokens = 1; Warz.UpgradeTree.refresh();
      world.buyStationSupply = () => new Promise(resolve => { qaPurchase.reply = resolve; });
    });
    await click('#ut-buy-bandage');
    check(await evaluate(() => document.querySelector('#ut-buy-bandage').disabled && !document.querySelector('.ut-purchase-burst') && qaPurchase.sounds === 3), 'waiting for station confirmation gives no success feedback');
    await evaluate(() => { delete Warz.debug.match().world.buyStationSupply; qaPurchase.reply({ ok: false, reason: 'full' }); });
    check(await evaluate(() => document.querySelector('#ut-status').textContent === 'Hotbar full' && !document.querySelector('.ut-purchase-burst') && qaPurchase.sounds === 3), 'a denied purchase explains the failure and leaves success feedback silent');
    await evaluate(() => { Warz.Audio.play = qaPurchase.play; Warz.Audio.setMuted(qaPurchase.wasMuted); });
    await fixture('rocketeer', 7); await click('#ut-shop-tab');
    await evaluate(() => Warz.debug.player().items.fill(null));
    await click('#ut-buy-vehiclemine'); await click('#ut-buy-smoke');
    check(await evaluate(() => { const { player, world } = Warz.debug.match(); return player.tokens === 0 && world.countItem(player, 'vehiclemine') === 10 && world.countItem(player, 'smoke') === 5; }), 'Rocketeer can buy the ten-mine pack and five smoke grenades for seven tokens');
    await fixture('engineer', 23); await click('#ut-shop-tab');
    await evaluate(() => Warz.debug.player().items.fill(null));
    await click('#ut-buy-sentry3'); await click('#ut-buy-engineerhammer2');
    check(await evaluate(() => { const { player, world } = Warz.debug.match(); return player.tokens === 0 && world.countItem(player, 'sentry3') === 1 && world.countItem(player, 'engineerhammer2') === 1; }), 'Engineer can buy a Sentry III and one instant hammer use for 23 tokens');
    await fixture('commander', 10); await click('#ut-shop-tab');
    await evaluate(() => Warz.debug.player().items.fill(null));
    await click('#ut-buy-strikegun');
    check(await evaluate(() => { const { player, world } = Warz.debug.match(); return player.tokens === 0 && world.countItem(player, 'strikegun') === 1; }), 'Commander can buy a loaded Strike Gun for ten tokens');
    await fixture('shotgunner');
    check(await evaluate(() => document.querySelector('#ut-shop-tab').hidden), 'Shotgunner has no class shop');
    await click('#ut-close');
    await b.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await b.waitFor('!document.getElementById("pause-menu").hidden');
    await b.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await click('[data-test="class-key"]');
    check(await evaluate(() => Warz.debug.player().classTokens === 1), 'offline practice grants a class key from the pause menu');
    await click('#resume-btn'); await fixture('soldier', 8); await click('#ut-node-sniper');
    check(await evaluate(() => !document.querySelector('#ut-action').disabled && !document.querySelector('#ut-class-key-action').hidden), 'station presents both payment methods');
    await click('#ut-action'); await b.waitFor('!Warz.UpgradeTree.isOpen()');
    check(await evaluate(() => Warz.debug.player().classTokens === 1 && Warz.debug.player().tokens === 0), 'token payment saves the class key');
    await fixture('sniper', 0); await click('#ut-node-sniper2'); await click('#ut-class-key-action');
    check(await evaluate(() => Warz.debug.player().classId === 'sniper2' && !Warz.debug.player().classTokens), 'class-key payment works with no ordinary tokens');
    check(b.errors.length === 0, 'upgrade menu produces no browser exceptions');
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ url: url.href, deployed: !!deployedUrl, checks: report, errors: b.errors }, null, 2));
    console.log('Level-three menu browser QA: all ' + report.length + ' checks passed');
  } finally { if (b) await b.close(); if (server) await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
