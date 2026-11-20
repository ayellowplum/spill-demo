// Music director. Tracks are rendered from scores (music/tracks.py ->
// FluidSynth/MS Basic -> assets/music/*.m4a). Like Minecraft, music arrives after
// stretches of silence so it feels like a gift, not wallpaper.
(function (root) {
  'use strict';
  const A = root.SpillAudio;
  const cache = {};
  const cacheOrder = [];
  let cur = null;          // { name, src, gain }
  let nextAt = 0;          // audio-clock time the next track may start
  let moods = [];
  let lastPlayed = null;
  let recent = [];
  let moodGeneration = 0;
  let duckUntil = 0;
  let bus = null;
  let sieve = null;        // synchronized calm/full stems for the future arena

  function ctx() { return A.context && A.context(); }

  // Only load once audio exists; a failed load is not cached, so it retries.
  function load(name) {
    if (!ctx()) return Promise.resolve(null);
    if (!cache[name]) {
      cacheOrder.push(name);
      while (cacheOrder.length > 2) delete cache[cacheOrder.shift()];
      cache[name] = fetch(`assets/music/${name}.m4a`).then((r) => { if (!r.ok) throw new Error('music missing'); return r.arrayBuffer(); }).then((b) => ctx().decodeAudioData(b))
        .catch(() => { delete cache[name]; const at=cacheOrder.indexOf(name); if (at>=0) cacheOrder.splice(at,1); return null; });
    }
    return cache[name];
  }

  function stop(fade) {
    if (!cur) return;
    const c = ctx(), t = c.currentTime, g = cur.gain.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.0001, t + fade);
    const s = cur.src; setTimeout(() => { try { s.stop(); } catch (e) { /* already stopped */ } }, fade * 1000 + 100);
    cur = null;
  }

  function play(name, opts = {}) {
    const c = ctx();
    if (!c) return;
    if (!bus) { bus = c.createGain(); bus.gain.value = 0.5; bus.connect(A.output()); }
    const generation = moodGeneration;
    load(name).then((buf) => {
      if (!buf) { nextAt = c.currentTime + 10; return; }
      if (!opts.cue && generation !== moodGeneration) return;
      if (cur) stop(opts.crossfade || 8);
      const src = c.createBufferSource(); src.buffer = buf;
      const gain = c.createGain(); gain.gain.value = 0.0001;
      src.connect(gain); gain.connect(bus);
      const t = c.currentTime;
      gain.gain.linearRampToValueAtTime(opts.level || 1, t + (opts.fadeIn || 7));
      src.start(t);
      const me = { name, src, gain };
      cur = me; lastPlayed = name;
      if (!opts.cue) { recent.push(name); recent = recent.slice(-8); }
      src.onended = () => {
        if (cur === me) {
          cur = null;
          // after a track ends, leave a real silence before the next one
          nextAt = c.currentTime + 40 + Math.random() * 70;
        }
      };
    });
  }

  const api = {
    // The Sieve uses two equal-length stems that start on the same audio clock.
    // intensity is 0..1; the arena can call this as its wheel phases change.
    async startSieve(intensity = 0) {
      const c = ctx(); if (!c) return;
      if (!bus) { bus = c.createGain(); bus.gain.value = 0.5; bus.connect(A.output()); }
      const buffers = await Promise.all([load('sieve_calm'), load('sieve_full')]);
      if (!buffers[0] || !buffers[1]) return;
      stop(2);
      if (sieve) api.stopSieve();
      const t = c.currentTime + 0.05;
      const stems = buffers.map((buf, i) => {
        const src = c.createBufferSource(), gain = c.createGain();
        src.buffer = buf; gain.gain.value = 0.0001;
        src.connect(gain); gain.connect(bus); src.start(t);
        gain.gain.linearRampToValueAtTime(i ? Math.max(0.0001, intensity) : Math.max(0.0001, 1-intensity), t+2);
        return { src, gain };
      });
      sieve = stems;
      nextAt = Infinity;
      stems[0].src.onended = () => { if (sieve === stems) { sieve = null; nextAt = c.currentTime + 40 + Math.random()*70; } };
    },
    setSieveIntensity(intensity) {
      const c = ctx(); if (!c || !sieve) return;
      const x = Math.max(0, Math.min(1, intensity));
      sieve.forEach((stem, i) => {
        const g = stem.gain.gain, t = c.currentTime;
        g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(Math.max(0.0001, i ? x : 1-x), t+2);
      });
    },
    stopSieve() {
      const c = ctx(); if (!c || !sieve) return;
      const stems = sieve; sieve = null;
      stems.forEach(({src, gain}) => {
        const t = c.currentTime, g = gain.gain;
        g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(0.0001, t+2);
        setTimeout(() => { try { src.stop(); } catch (e) { /* ended */ } }, 2100);
      });
      nextAt = c.currentTime + 40 + Math.random()*70;
    },
    // Called when a chamber starts: its moods, and a first track fairly soon.
    setMoods(list, firstDelay) {
      moods = list || [];
      moodGeneration++;
      const c = ctx();
      if (c) nextAt = Math.min(nextAt || Infinity, c.currentTime + (firstDelay || 10));
      else nextAt = -(firstDelay || 10); // resolved once audio starts
      // Only warm a few buffers; a long catalog should not occupy all memory.
      moods.slice(0, 2).forEach(load);
      if (c && cur && !moods.includes(cur.name) && cur.name !== 'turned_glass' && moods.length) {
        const next = moods[Math.floor(Math.random() * moods.length)];
        play(next, { crossfade: 8, fadeIn: 8 });
        nextAt = Infinity;
      }
    },
    // A specific cue (still sand, completion), interrupting gently.
    cue(name) { if (ctx()) play(name, { crossfade: 2.5, fadeIn: 2, cue: true }); },
    // Keep music under the Keeper while he talks.
    duck() { const c = ctx(); if (c) duckUntil = c.currentTime + 0.7; },
    update() {
      const c = ctx();
      if (!c || c.state !== 'running') return;
      if (!bus) {
        bus = c.createGain(); bus.gain.value = 0.5;
        bus.connect(A.output());
      }
      if (nextAt < 0) nextAt = c.currentTime - nextAt;
      const t = c.currentTime;
      bus.gain.setTargetAtTime(t < duckUntil ? 0.22 : 0.5, t, 0.25);
      if (!cur && !sieve && moods.length && t >= nextAt) {
        const pool = moods.filter((m) => !recent.includes(m));
        play((pool.length ? pool : moods)[Math.floor(Math.random() * (pool.length || moods.length))]);
        nextAt = Infinity; // set again when this track ends
      }
    },
    get playing() { return cur && cur.name; },
  };
  root.SpillMusic = api;
})(window);
