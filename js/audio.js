/* warz.io: small synthesized sound effects (Web Audio). Nothing plays until the player presses Play. */
(function () {
  'use strict';
  var W = window.Warz;
  var ctx = null, master = null, noiseBuf = null, muted = false, last = {};

  function unlock() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function env(gain, t, attack, dur, vol) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function noise(t, dur, type, f0, f1, q, vol) {
    var src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = noiseBuf;
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    if (f1) filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(gain, t, 0.003, dur, vol);
    src.connect(filter); filter.connect(gain); gain.connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
  function tone(t, type, f0, f1, dur, vol, attack) {
    var osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(gain, t, attack || 0.004, dur, vol);
    osc.connect(gain); gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  var SOUNDS = {
    hammer: function (t, v) { noise(t, 0.1, 'bandpass', 600, 1800, 0.8, 0.2 * v); tone(t + 0.06, 'triangle', 280, 85, 0.11, 0.28 * v); noise(t + 0.06, 0.06, 'highpass', 2600, 0, 0.7, 0.12 * v); },
    repair: function (t, v) { noise(t, 0.16, 'highpass', 3600, 1800, 0.6, 0.16 * v); tone(t, 'triangle', 880, 660, 0.08, 0.06 * v); },
    ar: function (t, v) { noise(t, 0.09, 'bandpass', 2400, 900, 0.8, 0.55 * v); tone(t, 'square', 160, 70, 0.05, 0.06 * v); },
    pistol: function (t, v) { noise(t, 0.07, 'bandpass', 3200, 1400, 0.9, 0.45 * v); tone(t, 'triangle', 300, 120, 0.05, 0.08 * v); },
    sniper: function (t, v) { noise(t, 0.45, 'lowpass', 2600, 300, 0.7, 0.8 * v); tone(t, 'sine', 140, 40, 0.3, 0.5 * v); noise(t + 0.05, 0.6, 'bandpass', 900, 300, 0.5, 0.15 * v); },
    shotgun: function (t, v) { noise(t, 0.3, 'lowpass', 1800, 250, 0.6, 0.85 * v); tone(t, 'sine', 120, 45, 0.2, 0.45 * v); },
    deagle: function (t, v) { noise(t, 0.2, 'bandpass', 1700, 500, 0.7, 0.7 * v); tone(t, 'sine', 180, 60, 0.15, 0.35 * v); },
    flamethrower: function (t, v) { noise(t, 0.19, 'bandpass', 600, 1800, 0.5, 0.45 * v); tone(t, 'sine', 120, 65, 0.14, 0.12 * v); },
    launcher: function (t, v) { tone(t, 'sine', 240, 80, 0.16, 0.5 * v); noise(t, 0.12, 'lowpass', 900, 200, 0.6, 0.35 * v); },
    explosion: function (t, v) { noise(t, 0.9, 'lowpass', 1400, 120, 0.6, 0.95 * v); tone(t, 'sine', 90, 28, 0.6, 0.7 * v); },
    throw: function (t, v) { noise(t, 0.18, 'bandpass', 700, 2200, 1.4, 0.18 * v); },
    reload: function (t, v) { noise(t, 0.03, 'highpass', 3000, 0, 0.7, 0.25 * v); noise(t + 0.13, 0.03, 'highpass', 2200, 0, 0.7, 0.25 * v); },
    reloaded: function (t, v) { noise(t, 0.04, 'highpass', 2600, 0, 0.7, 0.3 * v); tone(t, 'square', 900, 0, 0.03, 0.04 * v); },
    token: function (t, v) { tone(t, 'sine', 990, 0, 0.08, 0.22 * v); tone(t + 0.07, 'sine', 1480, 0, 0.12, 0.2 * v); },
    key: function (t, v) { tone(t, 'triangle', 660, 0, 0.1, 0.22 * v); tone(t + 0.08, 'triangle', 880, 0, 0.1, 0.22 * v); tone(t + 0.16, 'triangle', 1320, 0, 0.18, 0.22 * v); },
    upgrade: function (t, v) {
      [523, 659, 784, 1047].forEach(function (f, i) { tone(t + i * 0.09, 'triangle', f, 0, 0.28, 0.25 * v); tone(t + i * 0.09, 'square', f * 2, 0, 0.12, 0.03 * v); });
      noise(t, 0.6, 'highpass', 4000, 9000, 0.5, 0.06 * v);
    },
    heal: function (t, v) { tone(t, 'sine', 420, 840, 0.4, 0.25 * v, 0.05); tone(t + 0.12, 'sine', 630, 1260, 0.35, 0.15 * v, 0.05); },
    hit: function (t, v) { tone(t, 'sine', 1300, 900, 0.04, 0.16 * v); },
    hurt: function (t, v) { tone(t, 'sine', 220, 90, 0.12, 0.35 * v); noise(t, 0.06, 'lowpass', 800, 0, 0.6, 0.2 * v); },
    crate: function (t, v) { noise(t, 0.22, 'bandpass', 600, 250, 1.2, 0.5 * v); tone(t, 'triangle', 160, 70, 0.12, 0.2 * v); },
    deny: function (t, v) { tone(t, 'square', 150, 0, 0.14, 0.12 * v); },
    land: function (t, v) { tone(t, 'sine', 110, 40, 0.25, 0.5 * v); noise(t, 0.3, 'lowpass', 700, 150, 0.6, 0.35 * v); },
    switch: function (t, v) { noise(t, 0.04, 'highpass', 1800, 0, 0.7, 0.15 * v); },
    click: function (t, v) { tone(t, 'triangle', 700, 500, 0.05, 0.12 * v); },
    death: function (t, v) { tone(t, 'sawtooth', 300, 60, 0.7, 0.25 * v); noise(t, 0.5, 'lowpass', 900, 100, 0.6, 0.4 * v); },
    storm: function (t, v) { tone(t, 'sawtooth', 110, 90, 1.2, 0.12 * v, 0.2); tone(t, 'sawtooth', 165, 130, 1.2, 0.08 * v, 0.2); },
    // Items
    turret: function (t, v) { noise(t, 0.08, 'bandpass', 2000, 800, 0.8, 0.5 * v); tone(t, 'square', 200, 90, 0.05, 0.07 * v); },
    sentry: function (t, v) { noise(t, 0.05, 'bandpass', 3600, 1800, 1, 0.35 * v); tone(t, 'triangle', 420, 200, 0.04, 0.06 * v); },
    drink: function (t, v) { tone(t, 'sine', 300, 600, 0.12, 0.18 * v, 0.02); tone(t + 0.13, 'sine', 380, 760, 0.12, 0.14 * v, 0.02); },
    place: function (t, v) { tone(t, 'sine', 140, 60, 0.2, 0.45 * v); noise(t, 0.15, 'lowpass', 600, 150, 0.7, 0.3 * v); },
    strike: function (t, v) { tone(t, 'sawtooth', 200, 900, 0.5, 0.12 * v, 0.1); },
    zap: function (t, v) { noise(t, 0.25, 'highpass', 2500, 0, 0.6, 0.8 * v); tone(t, 'square', 1200, 100, 0.2, 0.25 * v); },
    meteor: function (t, v) { noise(t, 1.2, 'lowpass', 900, 60, 0.6, v); tone(t, 'sine', 70, 20, 0.9, 0.8 * v); },
    tele: function (t, v) { tone(t, 'sine', 300, 1400, 0.35, 0.25 * v, 0.05); noise(t, 0.3, 'bandpass', 1500, 4000, 1, 0.15 * v); },
    item: function (t, v) { tone(t, 'triangle', 740, 0, 0.08, 0.2 * v); tone(t + 0.08, 'triangle', 1110, 0, 0.14, 0.2 * v); },
    flash: function (t, v) { tone(t, 'sine', 2200, 1800, 0.9, 0.3 * v, 0.01); noise(t, 0.2, 'highpass', 3000, 0, 0.5, 0.4 * v); },
    freeze: function (t, v) { noise(t, 0.8, 'highpass', 1500, 4000, 0.4, 0.3 * v); tone(t, 'sine', 900, 1800, 0.5, 0.1 * v, 0.1); },
    fire: function (t, v) { noise(t, 0.7, 'bandpass', 600, 1800, 0.5, 0.5 * v); tone(t, 'sine', 120, 50, 0.3, 0.3 * v); },
    blackhole: function (t, v) { tone(t, 'sawtooth', 400, 40, 0.8, 0.3 * v, 0.05); noise(t, 0.6, 'lowpass', 1200, 100, 0.6, 0.4 * v); },
    drone: function (t, v) { tone(t, 'square', 180, 260, 0.6, 0.08 * v, 0.1); tone(t, 'square', 183, 266, 0.6, 0.08 * v, 0.1); },
    mount: function (t, v) { noise(t, 0.06, 'highpass', 2000, 0, 0.7, 0.3 * v); tone(t + 0.07, 'square', 300, 0, 0.06, 0.08 * v); }
  };

  // Upgraded weapons emit their own IDs; keep their firing sounds in the same
  // weapon family instead of silently dropping those events.
  SOUNDS.shotgun2 = SOUNDS.shotgun;
  SOUNDS.sniper2 = SOUNDS.sniper;
  SOUNDS.revolver = SOUNDS.deagle;
  SOUNDS.minigun = SOUNDS.ar;
  SOUNDS.commandpistol = SOUNDS.pistol;
  SOUNDS.shieldpistol = SOUNDS.pistol;
  SOUNDS.launcher2 = SOUNDS.launcher;
  SOUNDS.rpg = function (t, v) { SOUNDS.launcher(t, v); noise(t + 0.03, 0.24, 'highpass', 800, 260, 0.8, 0.3 * v); };
  SOUNDS.tankmg = SOUNDS.turret;
  SOUNDS.melee = SOUNDS.hammer;
  SOUNDS.engineerhammer = SOUNDS.hammer;

  function play(name, vol) {
    if (!ctx || muted || !SOUNDS[name] || ctx.state !== 'running') return;
    var now = ctx.currentTime;
    if (last[name] && now - last[name] < 0.03) return;
    last[name] = now;
    var v = vol === undefined ? 1 : vol;
    if (v < 0.02) return;
    SOUNDS[name](now + 0.005, v);
  }

  function setMuted(v) {
    muted = !!v;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  W.Audio = {
    unlock: unlock,
    play: play,
    setMuted: setMuted,
    toggleMute: function () { return setMuted(!muted); },
    isMuted: function () { return muted; }
  };
}());
