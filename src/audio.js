// Procedural, soft audio. Everything goes through a gentle reverb and a
// limiter; nothing is a raw square wave or constant hiss.
(function (root) {
  'use strict';
  let ctx = null, master = null, wet = null, dry = null, musicIn = null;
  // volumes 0..1, remembered between sessions
  const vol = { music: 0.8, sound: 0.8 };
  try { Object.assign(vol, JSON.parse(localStorage.getItem('spill.vol') || '{}')); } catch (e) { /* defaults */ }
  let sandGain = null, sandFilt = null, muted = false, pourGain = null, pourFilt = null, lastTick = 0, collisionHiss = 0;
  const PENTA = [0, 2, 4, 7, 9]; // major pentatonic steps

  function noiseBuffer(sec, brown) {
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  function impulse(sec, decay) {
    const len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -14; lim.ratio.value = 6; lim.attack.value = 0.005; lim.release.value = 0.25;
    master = ctx.createGain(); master.gain.value = 0.8;
    master.connect(lim); lim.connect(ctx.destination);
    musicIn = ctx.createGain(); musicIn.gain.value = vol.music; musicIn.connect(lim);
    master.gain.value = 0.8 * vol.sound;
    const verb = ctx.createConvolver(); verb.buffer = impulse(3.2, 3);
    wet = ctx.createGain(); wet.gain.value = 0.35;
    dry = ctx.createGain(); dry.gain.value = 1;
    verb.connect(wet); wet.connect(master); dry.connect(master);
    root.__verb = verb;
    loadVoice();

    // Sand: brown noise, low-passed, swells when grains strike and settle.
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(4, true); src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
    sandFilt = ctx.createBiquadFilter(); sandFilt.type = 'lowpass'; sandFilt.frequency.value = 700; sandFilt.Q.value = 0.3;
    sandGain = ctx.createGain(); sandGain.gain.value = 0;
    src.connect(hp); hp.connect(sandFilt); sandFilt.connect(sandGain); sandGain.connect(dry); sandGain.connect(verb);
    src.start();
    // Pouring: a brighter, finer hiss on top while you draw the sand, like a
    // handful running between fingers
    const ps = ctx.createBufferSource(); ps.buffer = noiseBuffer(3, false); ps.loop = true;
    pourFilt = ctx.createBiquadFilter(); pourFilt.type = 'bandpass'; pourFilt.frequency.value = 2400; pourFilt.Q.value = 0.9;
    pourGain = ctx.createGain(); pourGain.gain.value = 0;
    ps.connect(pourFilt); pourFilt.connect(pourGain); pourGain.connect(dry); pourGain.connect(verb);
    ps.start();

    // Room tone: a very low, slow-breathing drone and distant wind.
    const drone = ctx.createGain(); drone.gain.value = 0.0;
    drone.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 4);
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 260;
    for (const f of [55, 82.4, 110.3]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = f === 55 ? 0.6 : 0.25;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.07;
      const lg = ctx.createGain(); lg.gain.value = 0.15;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      o.connect(g); g.connect(dlp); o.start();
    }
    dlp.connect(drone); drone.connect(dry); drone.connect(verb);
    const wind = ctx.createBufferSource(); wind.buffer = noiseBuffer(6, true); wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0.025;
    const wl = ctx.createOscillator(); wl.frequency.value = 0.07;
    const wlg = ctx.createGain(); wlg.gain.value = 0.018;
    wl.connect(wlg); wlg.connect(wg.gain); wl.start();
    wind.connect(wf); wf.connect(wg); wg.connect(verb); wind.start();
  }

  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  // A soft bell: sine + quiet octave partial, mostly into the reverb.
  function bell(freq, vol, dur) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    for (const [mult, v] of [[1, 1], [2.01, 0.25], [3.0, 0.08]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mult;
      const g = ctx.createGain(); env(g, t, 0.006, vol * v, dur / mult);
      o.connect(g); g.connect(dry); g.connect(root.__verb);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }
  function thump(freq, vol, dur) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + dur);
    const g = ctx.createGain(); env(g, t, 0.004, vol, dur);
    o.connect(g); g.connect(dry); o.start(t); o.stop(t + dur + 0.05);
  }
  function whoosh(vol, dur, f0, f1) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(1, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); env(g, t, dur * 0.3, vol, dur * 0.7);
    s.connect(f); f.connect(g); g.connect(dry); g.connect(root.__verb);
    s.start(t); s.stop(t + dur + 0.05);
  }

  let lastStar = 0, starRun = 0;
  let lastChime = 0, chimeStep = 0, lastLost = 0, lastVoice = 0, voiceStep = 0, lastWind = 0;
  // Wind chimes: a few thin metal tubes knocking together. Each tube is a
  // bell with inharmonic overtones (like real tubes), struck at slightly
  // different moments, so no two chimes sound alike. Rate-limited so it
  // stays special: a gift for good moments, never wallpaper.
  function tube(freq, vol, dur, at) {
    const t = ctx.currentTime + at;
    for (const [mult, v] of [[1, 1], [2.76, 0.32], [5.40, 0.12], [8.93, 0.05]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mult * (1 + (Math.random() - 0.5) * 0.003);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol * v, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / Math.sqrt(mult));
      o.connect(g); g.connect(dry); g.connect(root.__verb);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }
  function windChime(strength) {
    if (!ctx || muted) return false;
    const now = ctx.currentTime;
    if (now - lastWind < 2.6) return false;
    lastWind = now;
    const base = 783.99;                                  // G5, tubes tuned to the pentatonic above it
    const n = 2 + Math.round(Math.random() * (1 + strength * 2));
    let at = 0;
    for (let k = 0; k < n; k++) {
      const step = PENTA[Math.floor(Math.random() * 5)] + 12 * Math.floor(Math.random() * 2);
      tube(base * Math.pow(2, step / 12), 0.018 + 0.012 * strength * Math.random(), 2.6 + Math.random() * 1.6, at);
      at += 0.07 + Math.random() * 0.22;
    }
    return true;
  }
  const voiceBank = [];
  function loadVoice() {
    for (let i = 0; i < 20; i++) {
      fetch(`assets/voice/k${i}.m4a`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b))
        .then((buf) => voiceBank.push(buf)).catch(() => { /* voice is optional */ });
    }
  }
  const api = {
    start,
    context: () => ctx,
    muted: () => muted,
    output: () => musicIn,
    volume: (k) => vol[k],
    setVolume(k, v) {
      vol[k] = Math.max(0, Math.min(1, v));
      try { localStorage.setItem('spill.vol', JSON.stringify(vol)); } catch (e) { /* not saved */ }
      if (!ctx) return;
      if (k === 'music') musicIn.gain.setTargetAtTime(vol.music, ctx.currentTime, 0.05);
      else master.gain.setTargetAtTime(muted ? 0 : 0.8 * vol.sound, ctx.currentTime, 0.05);
    },
    ready: () => !!ctx && ctx.state === 'running',
    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8 * vol.sound, ctx.currentTime, 0.05);
      if (musicIn) musicIn.gain.setTargetAtTime(muted ? 0 : vol.music, ctx.currentTime, 0.05);
    },
    update(sim) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const collision = Math.min(1, (sim.collisionEnergy || 0) / 6);
      collisionHiss = Math.max(collision, collisionHiss * 0.84);
      // the hiss follows collisions, not travel: moving grains are quiet until
      // they strike a surface, then the sound trails off as they settle.
      const gust = 0.7 + 0.3 * Math.sin(t * 0.7) * Math.sin(t * 0.31 + 1.3);
      sandGain.gain.setTargetAtTime(muted ? 0 : Math.pow(collisionHiss, 1.25) * 0.11 * gust, t, collision > 0.05 ? 0.04 : 0.18);
      sandFilt.frequency.setTargetAtTime(380 + 1200 * collisionHiss, t, 0.15);
      // while you pour: the fine hiss swells with the flow, and now and then a
      // tiny tick of grains settling, so drawing the sand feels physical
      const pouring = sim.pouring ? Math.min(1, sim.moving / 140) : 0;
      if (pourGain) {
        pourGain.gain.setTargetAtTime(muted ? 0 : pouring * 0.05, t, pouring ? 0.06 : 0.2);
        pourFilt.frequency.setTargetAtTime(1800 + 1600 * Math.min(1, sim.speed / 2.5), t, 0.1);
        if (pouring > 0.2 && t - lastTick > 0.05 + Math.random() * 0.12) { lastTick = t; thump(900 + Math.random() * 1400, 0.006 + pouring * 0.008, 0.03); }
      }
    },
    exitChime(n) {
      if (!ctx) return;
      const t = ctx.currentTime;
      if (t - lastChime < 0.09) return;
      lastChime = t;
      // climbs the pentatonic scale as more sand gets home
      const deg = Math.min(14, Math.floor(n / 45));
      const step = PENTA[(deg + chimeStep++ % 2) % 5] + 12 * Math.floor((deg + 0) / 5);
      bell(392 * Math.pow(2, step / 12), 0.045, 1.6);
    },
    lost() {
      if (!ctx) return;
      const t = ctx.currentTime;
      if (t - lastLost < 0.25) return;
      lastLost = t;
      thump(90, 0.05, 0.12);
    },
    impact(v) { thump(70 + 30 * v, 0.12 * v + 0.03, 0.18); },
    launch(p) { whoosh(0.12 + 0.12 * p, 0.55, 300, 1400); thump(60, 0.18 * p + 0.05, 0.25); },
    harden() { bell(587.3, 0.05, 2.4); bell(880, 0.03, 2.0); },
    chime(strength) { return windChime(strength == null ? 0.5 : strength); },
    toll() { bell(110, 0.07, 6); bell(220.6, 0.03, 4); thump(48, 0.12, 0.6); },
    breathe(out) { whoosh(out ? 0.09 : 0.05, out ? 1.2 : 2.2, out ? 200 : 900, out ? 900 : 180); },
    // combat: a quick lash, a solid hit, a stun's ring, a glance off guard
    strike() { whoosh(0.07, 0.7, 900, 3200); },
    hit(big) { thump(55, big ? 0.32 : 0.2, 0.3); bell(big ? 196 : 294, big ? 0.06 : 0.04, big ? 1.8 : 1.1); },
    stun() { bell(659.3, 0.04, 1.4); bell(987.8, 0.025, 1.0); },
    glance() { bell(1318.5, 0.02, 0.4); thump(140, 0.04, 0.06); },
    // a star of the Super wounds the Sieve's open eye (art pass). Each hit within a second and a
    // half of the last climbs one step up a pentatonic ladder, so a run of hits rises rather than
    // just getting louder. strong=0: a clear glass note and a small knock; strong=1: the note with
    // its octave below, a heavier knock and a short bright crack of air.
    starHit(strong) {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      starRun = t - lastStar < 1.5 ? starRun + 1 : 0; lastStar = t;
      const ladder = [1046.5, 1174.7, 1318.5, 1568.0, 1760.0, 2093.0], f = ladder[Math.min(ladder.length - 1, starRun)];
      if (!strong) { bell(f, 0.035, 0.7); thump(110, 0.07, 0.08); return; }
      bell(f, 0.055, 1.1); bell(f / 2, 0.04, 1.6); thump(72, 0.24, 0.22); whoosh(0.04, 0.18, 3200, 900);
    },
    warn() { bell(220, 0.03, 0.9); },

    // The Keeper's voice: babble, not words (think Jimbo in Balatro).
    // Short recorded mumbles from assets/voice, chosen by letter so the same
    // word always mumbles the same way, with a little pitch drift.
    // pitch (optional, art pass): a speaker of its own, e.g. a boss's slow deep babble (0.55)
    voice(ch, wordStart, pitch) {
      if (!ctx || muted || !voiceBank.length) return;
      const t = ctx.currentTime, slow = pitch && pitch < 1 ? 1 / pitch : 1;
      if (t - lastVoice < (wordStart ? 0.09 : 0.14) * slow) return;
      lastVoice = t;
      const code = ch.charCodeAt(0);
      const buf = voiceBank[(code * 7 + voiceStep++) % voiceBank.length];
      const src = ctx.createBufferSource(); src.buffer = buf;
      src.playbackRate.value = (0.9 + ((code * 13) % 9) / 90) * (pitch || 1);
      const g = ctx.createGain(); g.gain.value = pitch && pitch < 1 ? 1.1 : 0.95;
      src.connect(g); g.connect(dry); g.connect(root.__verb);
      src.start(t);
      if (root.SpillMusic) root.SpillMusic.duck();
    },
    complete(st) {
      const notes = [0, 4, 7, 12].slice(0, 1 + st);
      notes.forEach((n, k) => setTimeout(() => bell(293.7 * Math.pow(2, n / 12), 0.06, 3.0), k * 220));
    },
  };
  root.SpillAudio = api;
})(window);
