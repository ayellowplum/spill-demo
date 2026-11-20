// Energy effects: blasts, shock rings, smears, sparks, embers and smoke.
//
// Studied before drawing (notes in VFX_NOTES.md): an impact reads as a layered
// event, never one shape in one colour. Order, hottest first:
//   1. a white core that holds for the impact frame (and through hitstop),
//   2. spikes of light thrown out for 2-3 frames,
//   3. one or two shock rings that ease out (fast then slow), thin as they
//      grow, and break apart into irregular chunks, not dots,
//   4. streak sparks (a smear: head hot, tail cooler) thrown away from the blow,
//   5. slow embers that flicker as they cool,
//   6. smoke that rises and is eaten away into wisps.
// Every element cools down its own ramp: 16 hand-picked, hue-shifted shades
// per ramp (warm white -> gold -> orange -> rust -> plum -> violet dusk), so
// even a single spark passes through many colours over its life.
//
// Cells are written as material 51 with the palette index ramp*16 + level
// (level 0 the hottest). The renderer looks the colour up in FX_PAL.
(function (root) {
  'use strict';
  const hex = (h, e) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, e];
  // ramp 0 SUN: the sand's own energy (hits, hammer, F)
  // ramp 1 FROST: icicles, parries
  // ramp 2 STAR: the super
  // ramp 3 DUST: smoke and thrown-up dust, barely glowing
  const RAMPS = [
    [['#fffdf3', 6.0], ['#fff5d0', 5.2], ['#ffe8a4', 4.5], ['#ffd67a', 3.9], ['#ffc158', 3.3], ['#fba644', 2.8], ['#f28939', 2.3], ['#e06a32', 1.9],
     ['#c74f30', 1.5], ['#a53b2f', 1.1], ['#812d31', 0.75], ['#612335', 0.48], ['#481d37', 0.28], ['#351934', 0.14], ['#26152a', 0.06], ['#1b1020', 0]],
    [['#fbffff', 5.6], ['#e6fbff', 4.8], ['#c3f0ff', 4.2], ['#9be1f7', 3.6], ['#73cbef', 3.0], ['#55b0e6', 2.5], ['#4391d7', 2.0], ['#3a73c3', 1.6],
     ['#3757a9', 1.25], ['#36418d', 0.9], ['#333071', 0.62], ['#2c2559', 0.4], ['#241d45', 0.22], ['#1c1634', 0.1], ['#151027', 0.04], ['#0e0b1a', 0]],
    [['#fffaf6', 6.0], ['#fff0f3', 5.2], ['#ffd9e5', 4.5], ['#ffbcd6', 3.9], ['#fa9ccd', 3.3], ['#eb7ecc', 2.8], ['#d266cf', 2.3], ['#b155d1', 1.9],
     ['#8e49cb', 1.5], ['#6e40bc', 1.1], ['#5237a2', 0.78], ['#3e2f86', 0.5], ['#2e2768', 0.3], ['#221d4c', 0.15], ['#181536', 0.06], ['#100e22', 0]],
    [['#efdfc2', 0.35], ['#ddc8a8', 0.25], ['#c7b192', 0.16], ['#ae987c', 0.1], ['#968269', 0.06], ['#806f5c', 0.03], ['#6c5f51', 0.01], ['#5a4f47', 0],
     ['#4a423e', 0], ['#3d3636', 0], ['#322d2f', 0], ['#292527', 0], ['#211e21', 0], ['#1a171b', 0], ['#141216', 0], ['#0f0d11', 0]],
    // ramp 4 SAND: packed sand, sunlit top to shadowed underside (the shards are made of this)
    [['#fff4d6', 1.2], ['#fbe6b4', 0.7], ['#f3d496', 0.45], ['#e9c27e', 0.3], ['#dcae69', 0.2], ['#cb9a58', 0.12], ['#b7864a', 0.06], ['#a0723f', 0.03],
     ['#8a6035', 0], ['#734f2c', 0], ['#5e4025', 0], ['#4a331e', 0], ['#392818', 0], ['#2b1e12', 0], ['#1f160d', 0], ['#150f09', 0]],
  ];
  const FX_PAL = new Float32Array(80 * 4);
  // glow is kept low past the core: bloom on top of bright emission washes every shade to cream
  RAMPS.forEach((r, ri) => r.forEach(([h, e], li) => FX_PAL.set(hex(h, ri === 4 ? e : li < 2 ? e * 0.36 : e * 0.28), (ri * 16 + li) * 4)));
  const RAMP = { sun: 0, frost: 1, star: 2, dust: 3, sand: 4 };

  // small deterministic noise, so each element keeps its own ragged shape
  function hash(n) { n = (n << 13) ^ n; return 1 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824; }
  function angNoise(seed, a, oct) {     // smooth noise around a circle, -1..1
    let v = 0, amp = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      const k = 5 + o * 6, x = ((a / (Math.PI * 2)) % 1 + 1) % 1 * k, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
      v += amp * (hash(seed * 97 + o * 1013 + (i % k)) * (1 - s) + hash(seed * 97 + o * 1013 + ((i + 1) % k)) * s);
      tot += amp; amp *= 0.5;
    }
    return v / tot;
  }

  // ---- hand-drawn stamps: each pixel placed by hand, written as ramp levels ----
  // 0 white-hot, 1-3 gold, 4-6 orange, 7-9 rust, a-c plum, d-f dusk; '.' is nothing.
  // Drawn pointing right (or, for 'up' stamps, rising from the bottom row). A stamp is
  // turned in quarter turns and mirrored, never resampled, so every pixel stays the one drawn.
  // An element can also cool as it ages (cool: levels added by the end of its life).
  const vm = (top) => top.concat(top.slice(0, -1).reverse());      // mirror a top half (incl. the middle row) downward
  const STAMPS = {
    // CRIT: a four-point star: long hard spikes on the axes, short glints on the diagonals.
    // It hollows to a diamond, the spikes break off and fly out as needles, and only their tips remain.
    crit: { ax: 7, ay: 7, hold: 2, frames: [
      vm(['.......3.......', '.......1.......', '.......0.......', '.......0.......', '...5...0...5...', '....3.101.3....', '.....10001.....', '310000000000013']),
      vm(['.......6.......', '.......4.......', '.......2.......', '...7...1...7...', '....5..1..5....', '.......0.......', '......0.0......', '6421.0...0.1246']),
      vm(['.......5.......', '.......6.......', '..9....8....9..', '...............', '.......8.......', '......9.9......', '...............', '568.9.....9.865']),
      vm(['.......9.......', '.......b.......', '.b...........b.', '...............', '...............', '...............', '...............', '9b...........b9']),
    ] },
    // CHEVRON: the Q bolt has flown far enough to hit harder: an arrowhead flicks off its nose
    chev: { ax: 3, ay: 3, hold: 2, frames: [
      ['.3.....', '..2....', '...1...', '....0..', '...1...', '..2....', '.3.....'],
      ['.6.....', '..5....', '...4...', '....3..', '...4...', '..5....', '.6.....'],
      ['.9.....', '.......', '.......', '....7..', '.......', '.......', '.9.....'],
    ], diag: [
      ['.......', '.....3.', '.....2.', '.....1.', '.....1.', '.32110.', '.......'],
      ['.......', '.....6.', '.....5.', '.....4.', '.....4.', '.65443.', '.......'],
      ['.......', '.....9.', '.......', '.......', '.......', '.9...7.', '.......'],
    ] },
    // LANCE: a long shot punches clean through: a needle of light from behind, hottest past the target,
    // that splits into two prongs and burns back to its tail
    lance: { ax: 12, ay: 2, hold: 2, frames: [
      ['............3............', '...........515...........', 'cba9876543210000001234567', '...........515...........', '............3............'],
      ['.........................', '...............12345678..', '.....fedcba987654........', '...............12345678..', '.........................'],
      ['.........................', '...................7.9.b.', '........fedcb............', '...................7.9.b.', '.........................'],
    ] },
    // PILLAR: the hammer drives light straight up out of the ground: a column, wide and white at the root,
    // that forks and bends outward as it cools, leaving two wisps and a glowing stump
    pillar: { ax: 4, ay: 19, hold: 2, frames: [
      ['....5....', '....3....', '....2....', '....1....', '...303...', '...404...', '...303...', '...404...', '...303...', '..41014..',
       '..40004..', '..41014..', '..40004..', '.5310135.', '.5300035.', '.6310136.', '653000356', '652000256', '754101457', '865303568'],
      ['...6.6...', '...5.5...', '..5...5..', '...4.4...', '...3.3...', '....2....', '...424...', '...313...', '...424...', '..41314..',
       '..40104..', '..41014..', '.5310135.', '.5300035.', '.6310136.', '653101356', '653000356', '753101357', '865303568', '976545679'],
      ['.........', '.........', '.a.....a.', '..9...9..', '..8...8..', '.8.....8.', '..7...7..', '..6...6..', '...6.6...', '...5.5...',
       '...4.4...', '..54.45..', '..43.34..', '..43334..', '..53335..', '.6533356.', '.6543456.', '765434567', '765444567', '876555678'],
      ['.........', '.........', '.........', '.........', 'c.......c', '.........', '.b.....b.', '.........', '..a...a..', '.........',
       '..9...9..', '.........', '...8.8...', '...8.8...', '..98889..', '..98889..', '.a98889a.', '.a98889a.', 'ba98889ab', 'cba999abc'],
    ] },
    // STARLAND: a falling star meets the ground: a hard point of light, a splash thrown low both
    // ways along the floor, two dying tips, nothing left. Bottom row sits on the ground.
    starland: { ax: 4, ay: 4, hold: 2, frames: [
      ['....2....', '....0....', '..20002..', '.3100013.', '531000135'],
      ['.........', '....4....', '.4..2..4.', '.52.1.25.', '73.....37'],
      ['.........', '.........', '7.......7', '.8.....8.', '9.......9'],
      ['.........', '.........', 'b.......b', '.........', 'c.......c'],
    ] },
  };
  // turn a stamp-local offset (u, v) by k quarter turns clockwise, after an optional mirror
  function turn(u, v, k, flip) { if (flip) u = -u; for (let i = 0; i < (k & 3); i++) { const t = u; u = -v; v = t; } return [u, v]; }
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clampL = (l) => Math.max(0, Math.min(15, Math.round(l)));

  class FX {
    constructor() { this.list = []; this.seed = 1; }
    clear() { this.list.length = 0; }
    add(e) { e.t = 0; e.seed = this.seed++; this.list.push(e); if (this.list.length > 900) this.list.shift(); return e; }

    // ---- primitives ----
    core(x, y, r, ramp, life) { return this.add({ k: 'core', x, y, r: Math.min(7, r * 0.7), ramp: RAMP[ramp] | 0, life: Math.min(life || 5, 4) }); }
    ring(x, y, r0, r1, ramp, life, o) { return this.add(Object.assign({ k: 'ring', x, y, r0, r1, ramp: RAMP[ramp] | 0, life, thick: 4, sq: 1, a0: null, a1: null }, o || {})); }
    rays(x, y, n, len, ramp, life, o) { return this.add(Object.assign({ k: 'rays', x, y, n, len, ramp: RAMP[ramp] | 0, life: life || 4, dir: null, spread: Math.PI * 2 }, o || {})); }
    spark(x, y, vx, vy, ramp, life, o) { return this.add(Object.assign({ k: 'spark', x, y, vx, vy, ramp: RAMP[ramp] | 0, life, g: 0.12, drag: 0.93, l0: 0 }, o || {})); }
    ember(x, y, vx, vy, ramp, life) { return this.add({ k: 'ember', x, y, vx: vx * 1.6, vy: vy * 1.4 - 0.3, ramp: RAMP[ramp] | 0, life: Math.min(life, 14 + (this.seed % 9)) }); }   // a cinder: tossed, then falls and dies (never a mote that hangs)
    smoke(x, y, r, life, o) { return this.add(Object.assign({ k: 'smoke', x, y, r: Math.min(4.5, r * 0.7), life: life * 0.8, vx: 0, vy: -0.25, ramp: 3, l0: 3 }, o || {})); }
    crescent(x, y, a, r, ramp, life, o) { return this.add(Object.assign({ k: 'cres', x, y, a, r, ramp: RAMP[ramp] | 0, life, arc: 1.9, thick: 6 }, o || {})); }
    icicle(x, y, a, len, kind, size) { return this.add({ k: 'icicle', x, y, a, len: len || 7, ramp: 4, life: 1, kind: kind || 'spike', size: size || 1 }); }
    // a hand-drawn ripple (the time slow): a dome of broken strokes, each its own length, weight,
    // offset and wear; some doubled. It eases out (or in, if r1 < r0) and wears away from each
    // stroke's tips until nothing is left, so it never cuts off while still showing
    ripple(x, y, r0, r1, ramp, life, o) { return this.add(Object.assign({ k: 'ripple', x, y, r0, r1, ramp: RAMP[ramp] | 0, life, sq: 0.6 }, o || {})); }
    // a falling streak drawn for one frame: a continuous line, white at the head, cooling to the tail
    streak(x, y, ux, uy, len, ramp, l0, w) { return this.add({ k: 'streak', x, y, ux, uy, len, ramp: RAMP[ramp] | 0, life: 1, l0: l0 || 0, w: w || 1 }); }
    swirl(x, y, r, ramp, life, o) { return this.add(Object.assign({ k: 'swirl', x, y, r, ramp: RAMP[ramp] | 0, life, n: 14 }, o || {})); }

    // a hand-drawn stamp (see STAMPS); rot in quarter turns clockwise, flip mirrors first
    stamp(x, y, name, ramp, o) { const S = STAMPS[name]; return this.add(Object.assign({ k: 'stamp', x, y, name, ramp: RAMP[ramp] | 0, life: S.frames.length * S.hold, rot: 0, flip: false, cool: 0, under: false }, o || {})); }
    // the same, pointing along angle a: the nearest of eight directions, from the straight and diagonal drawings
    stampDir(x, y, name, a, ramp, o) {
      const oct = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8, S = STAMPS[name];
      return this.stamp(x, y, name, ramp, Object.assign({ rot: oct >> 1, diag: !!(oct & 1) && !!S.diag }, o || {}));
    }
    // the F burst's fan, drawn on the live hit arc itself (the caller keeps x, y, r, a0, a1 current)
    fan(x, y, r, a0, a1, ramp, life) { return this.add({ k: 'fan', x, y, r, a0, a1, ramp: RAMP[ramp] | 0, life: life || 20, cb: this.comboN || 0 }); }
    // a glowing seam along the floor: pts are surface cells walking out from the blow
    fissure(pts, ramp, life) { return this.add({ k: 'fissure', x: pts.length ? pts[0].x : 0, y: pts.length ? pts[0].y : 0, pts, ramp: RAMP[ramp] | 0, life: life || 44 }); }

    // ---- composites: each one a full layered event ----
    // a big energy blast: core, spikes, two rings, sparks, embers, smoke
    blast(x, y, size, ramp, dir) {
      ramp = ramp || 'sun'; const s = size;
      this.core(x, y, 3 + s * 4, ramp, 3 + Math.round(s * 2));
      this.rays(x, y, 4 + Math.round(s * 2), 6 + s * 10, ramp, 3 + Math.round(s), dir == null ? null : { dir, spread: 2.2 });
      this.ring(x, y, 2, 10 + s * 22, ramp, 14 + s * 8, { thick: 3 + s * 3 });
      this.ring(x, y, 1, 7 + s * 14, ramp, 10 + s * 6, { thick: 2 + s * 2, l0: 2, delay: 3 + Math.round(s * 2) });
      const n = 6 + Math.round(s * 11);
      for (let i = 0; i < n; i++) {
        const a = dir == null ? Math.random() * Math.PI * 2 : dir + (Math.random() - 0.5) * 2.4, v = (1.5 + Math.random() * 3.5) * (0.7 + s * 0.6);
        this.spark(x, y, Math.cos(a) * v, Math.sin(a) * v, ramp, 12 + Math.random() * 16 + s * 6);
      }
      for (let i = 0; i < 1 + s * 2; i++) this.ember(x + (Math.random() - 0.5) * 8 * s, y + (Math.random() - 0.5) * 6 * s, (Math.random() - 0.5) * 0.8, -0.3 - Math.random() * 0.6, ramp, 30 + Math.random() * 40);
      for (let i = 0; i < 2 + s * 3; i++) this.smoke(x + (Math.random() - 0.5) * 12 * s, y + (Math.random() - 0.5) * 5 * s, 2 + Math.random() * 1.5 + s * 1.2, 30 + Math.random() * 25, { delay: 3 + Math.random() * 5, vx: (Math.random() - 0.5) * 0.4 });
    }
    // a hit on a creature: a smaller blast pushed the way the blow went
    hit(x, y, dir, heavy, ramp) {
      ramp = ramp || 'sun'; const s = heavy ? 1 : 0.45;
      this.core(x, y, heavy ? 6 : 3, ramp, heavy ? 4 : 2);
      this.rays(x, y, heavy ? 7 : 4, heavy ? 22 : 12, ramp, heavy ? 4 : 3, { dir, spread: heavy ? 3.2 : 2.0 });
      this.ring(x, y, 2, heavy ? 20 : 11, ramp, heavy ? 14 : 9, { thick: heavy ? 4 : 2, sq: 0.8 });
      const n = heavy ? 12 : 6;
      for (let i = 0; i < n; i++) {
        const a = dir + (Math.random() - 0.5) * 1.8, v = 2 + Math.random() * (heavy ? 5 : 3);
        this.spark(x, y, Math.cos(a) * v, Math.sin(a) * v - 0.6, ramp, 10 + Math.random() * 12);
      }
      for (let i = 0; i < (heavy ? 2 : 0); i++) this.ember(x, y, Math.cos(dir) * Math.random() + (Math.random() - 0.5), -0.4 - Math.random() * 0.5, ramp, 25 + Math.random() * 30);
      if (heavy) this.smoke(x - Math.cos(dir) * 3, y, 4, 34, { delay: 4 });
    }
    // energy leaving the body: a cone of light, a squashed ring across the line of fire, a crescent
    muzzle(x, y, a, size, ramp) {
      ramp = ramp || 'sun';
      this.core(x, y, 2 + size * 3, ramp, 2 + Math.round(size));
      this.rays(x, y, 3 + Math.round(size * 2), 10 + size * 14, ramp, 3, { dir: a, spread: 0.9 });
      this.ring(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 1, 7 + size * 9, ramp, 10, { thick: 2 + size * 1.5, sq: 0.4, rot: a + Math.PI / 2, delay: 1 });
      this.crescent(x, y, a, 8 + size * 10, ramp, 9 + Math.round(size * 4), { thick: 3 + size * 4 });
      // the blast itself: a crescent of energy that rides out ahead of the sand, slowing as it spends itself
      this.crescent(x, y, a, 10 + size * 9, ramp, 16 + Math.round(size * 5), { thick: 4 + size * 4, v: 6 + size * 3, vdrag: 0.88, arc: 1.5, tail: true });
      this.crescent(x, y, a, 7 + size * 6, ramp, 13 + Math.round(size * 4), { thick: 3 + size * 2, v: 4 + size * 2, vdrag: 0.86, arc: 1.3, delay: 2, l0: 2 });
      for (let i = 0; i < 6 + size * 8; i++) {
        const b = a + (Math.random() - 0.5) * 0.9, v = 3 + Math.random() * 4 * size;
        this.spark(x, y, Math.cos(b) * v, Math.sin(b) * v, ramp, 8 + Math.random() * 10, { g: 0.04 });
      }
    }
    // the F burst leaving the body: a small core and a fan of short sparks that die inside the
    // reach of the blow (the reach itself is drawn on the hit arc: FX.fan)
    punch(x, y, a, r) {
      this.core(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, 2.5, 'sun', 2);
      for (let i = 0; i < 7; i++) {
        const b = a + (i / 6 - 0.5) * 2.0 + (Math.random() - 0.5) * 0.2, v = 3 + Math.random() * 2.5;
        this.spark(x + Math.cos(b) * r * 0.7, y + Math.sin(b) * r * 0.7, Math.cos(b) * v, Math.sin(b) * v, 'sun', 7 + Math.random() * 4, { g: 0, drag: 0.72, l0: 1 });
      }
    }
    // a ground impact: a low dome of force that stops at the floor, two crests that run out
    // along the ground either way, dust thrown up both ways, a blast above
    quake(x, y, size, ramp) {
      ramp = ramp || 'sun';
      this.core(x, y - 2, 4 + size * 5, ramp, 3 + Math.round(size * 2));
      this.ring(x, y - 1, 3, 14 + size * 18, ramp, 12 + size * 5, { thick: 3 + size * 2, sq: 0.7, half: true });
      for (const a of [-0.3, Math.PI + 0.3]) {           // tipped up a little so they skim the floor, not dig in
        this.crescent(x, y - 2, a, 6 + size * 5, ramp, 14 + Math.round(size * 6), { thick: 3 + size * 2, v: 3 + size * 3, vdrag: 0.88, arc: 1.2 });
        this.crescent(x, y - 2, a, 4 + size * 3, ramp, 11 + Math.round(size * 4), { thick: 2 + size, v: 2 + size * 2, vdrag: 0.86, arc: 1.0, l0: 2, delay: 3 });
      }
      this.rays(x, y - 2, 4 + Math.round(size * 2), 9 + size * 12, ramp, 3, { dir: -Math.PI / 2, spread: 2.2 });
      for (let i = 0; i < 10 + size * 12; i++) {
        const side = Math.random() < 0.5 ? -1 : 1, a = -Math.PI / 2 + side * (0.5 + Math.random() * 0.9), v = 2.5 + Math.random() * 4 * (0.6 + size);
        this.spark(x + side * Math.random() * 6, y - 2, Math.cos(a) * v, Math.sin(a) * v, ramp, 14 + Math.random() * 16);
      }
      for (let i = 0; i < 2 + size * 2; i++) {
        const side = i % 2 ? -1 : 1;
        this.smoke(x + side * (4 + Math.random() * 16 * (0.5 + size)), y - 3, 2.5 + Math.random() * 2 + size * 1.2, 36 + Math.random() * 30, { vx: side * (0.3 + Math.random() * 0.5), vy: -0.2 - Math.random() * 0.2, delay: 2 + Math.random() * 4 });
      }
      for (let i = 0; i < 1 + size * 2; i++) this.ember(x + (Math.random() - 0.5) * 30, y - 4, (Math.random() - 0.5) * 0.6, -0.4 - Math.random() * 0.7, ramp, 40 + Math.random() * 40);
    }
    // gathering: energy drawn in toward a point (a charge)
    gather(x, y, r, ramp, n) {
      for (let i = 0; i < (n || 3); i++) {
        const a = Math.random() * Math.PI * 2, d = r * (0.7 + Math.random() * 0.5);
        const e = this.spark(x + Math.cos(a) * d, y + Math.sin(a) * d, 0, 0, ramp, 14, { g: 0, drag: 1, l0: 5, home: { x, y } });
        e.vx = -Math.cos(a) * d / 12 + Math.sin(a) * 0.6; e.vy = -Math.sin(a) * d / 12 - Math.cos(a) * 0.6;
      }
    }
    // a falling star's trail head (the super)
    trail(x, y, vx, vy) { this.spark(x, y, vx * 0.2, vy * 0.2, 'star', 8, { g: 0, l0: 2 + Math.round(Math.random() * 2), len: 1.5 }); }

    step() {
      const L = this.list;
      for (let k = L.length - 1; k >= 0; k--) {
        const e = L[k];
        if (e.delay > 0) { e.delay--; continue; }
        e.t++;
        if (e.k === 'stamp' && (e.vx || e.vy)) { e.x += e.vx; e.y += e.vy; e.vx *= e.drag || 0.8; e.vy *= e.drag || 0.8; }
        if (e.k === 'cres' && e.v) { e.x += Math.cos(e.a) * e.v; e.y += Math.sin(e.a) * e.v; e.v *= e.vdrag || 0.86; }
        if (e.k === 'spark' || e.k === 'ember' || e.k === 'smoke') {
          if (e.home) { e.vx += (e.home.x - e.x) * 0.05; e.vy += (e.home.y - e.y) * 0.05; }
          if (e.k === 'spark') { e.vy += e.g; e.vx *= e.drag; e.vy *= e.drag; }
          if (e.k === 'ember') { e.vy += 0.16; e.vx *= 0.94; }
          if (e.k === 'smoke') { e.vx *= 0.97; e.vy *= 0.985; e.r += 0.05; }
          e.px = e.x; e.py = e.y; e.x += e.vx; e.y += e.vy;
        }
        if (e.t >= e.life) L.splice(k, 1);
      }
    }

    // write this frame's effects into the renderer's cell buffer
    render(cells, W, H, solidAt) {
      const put = (x, y, ramp, lvl, under) => {
        x = Math.round(x); y = Math.round(y);
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const o = (y * W + x) * 4, m = cells[o];
        if (m === 1 || m === 8) return;                               // never inside stone or iron
        if (under && m !== 0 && m !== 51 && (m < 30 || m === 50)) return;   // behind sand and creatures: they read first
        lvl = clampL(lvl);
        if (m === 51 && (cells[o + 2] & 15) <= lvl) return;           // a hotter effect already here
        cells[o] = 51; cells[o + 2] = ramp * 16 + lvl; cells[o + 3] = 0;
      };
      // draw cool things first, hot things last
      const order = { smoke: 0, ember: 1, fissure: 1, ripple: 2, ring: 2, fan: 3, cres: 3, streak: 4, spark: 4, rays: 5, core: 6, stamp: 6, swirl: 4, icicle: 7 };
      const L = this.list.slice().sort((a, b) => order[a.k] - order[b.k]);
      for (const e of L) {
        if (e.delay > 0) continue;
        const p = Math.min(1, e.t / e.life);
        if (e.k === 'stamp') {
          const S = STAMPS[e.name], f = Math.floor(e.t / S.hold), F = (e.diag ? S.diag : S.frames)[Math.min(f, S.frames.length - 1)];
          const cool = (e.cool || 0) * p;
          for (let r = 0; r < F.length; r++) for (let c = 0; c < F[r].length; c++) {
            const ch = F[r][c]; if (ch === '.') continue;
            const [u, v] = turn(c - S.ax, r - S.ay, e.rot, e.flip);
            put(e.x + u, e.y + v, e.ramp, parseInt(ch, 16) + cool, e.under);
          }
          continue;
        }
        if (e.k === 'ripple') {
          if (!e.segs) {
            e.segs = []; const A0 = e.full ? 0 : Math.PI - 0.06, A1 = e.full ? Math.PI * 2 : Math.PI * 2 + 0.06; let a = A0 + (e.full ? Math.abs(hash(e.seed)) : 0), j = 0;
            const end = e.full ? a + Math.PI * 2 - 0.05 : A1;
            while (a < end) {
              const h = (n) => Math.abs(hash(e.seed * 977 + j * 131 + n));
              const len = e.full ? 0.32 + h(1) * 0.45 : 0.16 + h(1) * 0.32, gap = e.full ? 0.015 + h(2) * 0.04 : 0.035 + h(2) * 0.09;   // a full ripple: long strokes, short breaks
              e.segs.push({ a0: a, a1: Math.min(end, a + len), dr: (h(3) - 0.5) * 3.2, th: e.quiet ? 0.8 + h(4) * 0.7 : 1 + h(4) * 1.9, lag: h(5) * 0.12, lv: Math.round(h(6) * 2), dbl: h(7) < (e.quiet ? 0.08 : 0.3), wear: 0.9 + h(8) * 0.3 });
              a += len + gap; j++;
            }
          }
          for (const g of e.segs) {
            const q0 = Math.max(0, Math.min(1, (p - g.lag) / (1 - g.lag))), R = e.r0 + (e.r1 - e.r0) * (e.full ? 1 - Math.pow(1 - q0, 1.6) : easeOut(q0));
            const w0 = e.full ? 0.55 : 0.35, w = Math.max(0, Math.min(1, (p * g.wear - w0) / (1 - w0 - 0.1)));   // worn from the tips: 0 whole, 1 gone
            if (w >= 0.98) continue;
            const span = g.a1 - g.a0, mid = (g.a0 + g.a1) / 2, half = span / 2 * (1 - w);
            const steps = Math.max(4, Math.ceil(half * 2 * R * 1.6));
            for (let i = 0; i <= steps; i++) {
              const f = i / steps, a = mid - half + f * half * 2, tip = Math.sin(f * Math.PI);
              const rr = R + g.dr + 1.1 * angNoise(e.seed, a, 2), th = Math.max(0.6, g.th * (0.35 + 0.65 * tip) * (1 - p * 0.4));
              for (let q = 0; q < th; q += 0.6) put(e.x + Math.cos(a) * (rr - q), e.y + Math.sin(a) * (rr - q) * e.sq, e.ramp, (e.l0 || 0) + g.lv + (q / th) * 3 + p * 5 + (1 - tip) * 2, true);
              if (g.dbl && f > 0.2 && f < 0.8) put(e.x + Math.cos(a) * (rr - th - 2), e.y + Math.sin(a) * (rr - th - 2) * e.sq, e.ramp, (e.l0 || 0) + g.lv + 3 + p * 6, true);
            }
          }
          continue;
        }
        if (e.k === 'streak') {
          // stepped one cell at a time along the line, so it is solid, never dotted
          const n = Math.max(1, Math.round(e.len)), ax = Math.abs(e.ux), ay = Math.abs(e.uy), st = 1 / Math.max(ax, ay, 0.01);
          const px2 = Math.abs(e.uy) > Math.abs(e.ux) ? 1 : 0, py2 = 1 - px2;      // the side a wide streak thickens on
          for (let s2 = 0; s2 <= n * st; s2 += 1) {
            const f = s2 / (n * st); put(e.x - e.ux * s2, e.y - e.uy * s2, e.ramp, e.l0 + f * 10);
            if (e.w > 1 && f < 0.45) put(e.x - e.ux * s2 + px2, e.y - e.uy * s2 + py2, e.ramp, e.l0 + 2 + f * 12);   // a heavier head
          }
          continue;
        }
        if (e.k === 'fan') {
          // The F burst, drawn frame by frame on the live hit arc (art pass), never a fade:
          //   0     anticipation: the sand pulls back: three short strokes behind the body, a thin
          //         leading edge where the blow will land
          //   1-2   the smear: a fat crescent sweeps across the arc (70%, then all of it), white rim,
          //         gold body: the bright held frame (it holds through hit-stop)
          //   3-4   overshoot: the crescent runs a little past the arc's end and out past the rim
          //   5-7   settle: back onto the true reach, thinner, cooling
          //   8-    it breaks into dashes that cool down the 16-shade ramp and are gone
          // A combo thickens it a little (e.cb), so chains build. The settled rim is the real reach.
          const R = e.r, span = e.a1 - e.a0, t = e.t, cb = Math.min(3, e.cb || 0);
          const arc = (r0, w, a0, a1, lv0, lvIn, dash) => {
            const st = Math.max(10, Math.ceil(Math.abs(a1 - a0) * r0 * 1.8));
            for (let i2 = 0; i2 <= st; i2++) {
              const f = i2 / st, a = a0 + (a1 - a0) * f, edge = Math.min(f, 1 - f) * 2;      // 0 at the tips, 1 mid
              if (dash && ((i2 >> 1) % 3 === 0)) continue;
              const ww = w * (0.35 + 0.65 * Math.sqrt(Math.max(0, edge)));                   // needle tips, fat middle
              for (let q = 0; q < ww; q += 0.6) put(e.x + Math.cos(a) * (r0 - q), e.y + Math.sin(a) * (r0 - q), e.ramp, lv0 + (q / Math.max(1, ww)) * lvIn + (1 - edge) * 2, true);
            }
          };
          if (t === 0) {
            const back = (e.a0 + e.a1) / 2 + Math.PI;
            for (let k2 = -1; k2 <= 1; k2++) { const a = back + k2 * 0.45; for (let q = 0; q < 4; q += 0.7) put(e.x + Math.cos(a) * (5 + q), e.y + Math.sin(a) * (5 + q), e.ramp, 3 + q, true); }
            arc(R, 1, e.a0, e.a0 + span * 0.4, 2, 2, false);
          } else if (t <= 2) arc(R, 4 + cb, e.a0, e.a0 + span * (t === 1 ? 0.7 : 1), 0, 4, false);
          else if (t <= 4) arc(R + 1.5, 3 + cb * 0.5, e.a0 + span * 0.1, e.a1 + span * 0.1, 1, 4, false);
          else if (t <= 7) arc(R, 2, e.a0 + span * 0.05, e.a1, 3 + (t - 5), 3, false);
          else arc(R, 1.2, e.a0 + span * 0.1, e.a1 - span * 0.05, 6 + (t - 8) * 0.7, 2, true);
          continue;
        }
        if (e.k === 'fissure') {
          // the seam opens outward from the blow (a few cells a frame), white where it is new,
          // and cools down the ramp to a dull plum line before it goes dark
          const reach = e.t * 3.2, n = e.pts.length;
          for (let i = 0; i < n; i++) {
            if (i > reach) break;
            const pt = e.pts[i], d = i / Math.max(1, n), age = Math.max(0, (e.t - i / 3.2) / e.life);
            put(pt.x, pt.y, e.ramp, 1 + d * 4 + age * 12 + (i > reach - 2 ? -1 : 0), true);
            if (pt.fork) put(pt.x + pt.fork, pt.y - 1, e.ramp, 3 + d * 4 + age * 13, true);
            if (pt.spark && age < 0.35) put(pt.x, pt.y - 1 - Math.round(age * 9), e.ramp, 2 + age * 20, true);
          }
          continue;
        }
        if (e.k === 'core') {
          // the white core: a ragged disc, white at the middle, rimmed with colour, collapsing
          // a four-pointed star (a pinched diamond, points on the axes), not a disc: it reads as a
          // struck point of light, shrinks every frame and cools from the rim in
          const r = e.r * (p < 0.3 ? 1 : 1 - (p - 0.3) / 0.7 * 0.85);
          for (let dy = -Math.ceil(r) - 1; dy <= Math.ceil(r) + 1; dy++) for (let dx = -Math.ceil(r) - 1; dx <= Math.ceil(r) + 1; dx++) {
            const ax = Math.abs(dx), ay = Math.abs(dy), d = Math.sqrt(ax) + Math.sqrt(ay), rr = Math.sqrt(r) * (1 + 0.12 * angNoise(e.seed, Math.atan2(dy, dx), 2));
            if (d > rr) continue;
            put(e.x + dx, e.y + dy, e.ramp, (d / rr) * (3 + p * 6) + p * 5);
          }
        } else if (e.k === 'rays') {
          // spikes of light, irregular lengths, tapering to a point; hot at the root
          const n = e.n;
          for (let i = 0; i < n; i++) {
            const base = e.dir == null ? (i / n) * Math.PI * 2 : e.dir + (i / Math.max(1, n - 1) - 0.5) * e.spread;
            const a = base + hash(e.seed * 31 + i) * 0.35;
            const len = e.len * (0.45 + 0.55 * Math.abs(hash(e.seed * 17 + i))) * (p < 0.5 ? 0.6 + p * 0.8 : 1);
            const w0 = 1.6 + Math.abs(hash(e.seed + i * 7)) * 1.2;
            for (let s = 0; s <= len; s += 0.6) {
              const f = s / len, w = w0 * (1 - f) * (1 - p * 0.6);
              const cx = e.x + Math.cos(a) * s, cy = e.y + Math.sin(a) * s;
              for (let q = -Math.ceil(w); q <= Math.ceil(w); q++) {
                if (Math.abs(q) > w) continue;
                put(cx - Math.sin(a) * q, cy + Math.cos(a) * q, e.ramp, f * 7 + p * 6 + Math.abs(q) * 1.5);
              }
            }
          }
        } else if (e.k === 'ring') {
          // a shock ring: eases out, thins as it grows, breaks into ragged chunks
          const R = e.r0 + (e.r1 - e.r0) * easeOut(p), th = Math.max(0.8, e.thick * (1 - p * 0.75));
          const rot = e.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot), sq = e.sq;
          // Never a closed circle: the front is a few torn crescents of unequal length at
          // irregular angles (thick in the middle, needle tips), flung outward; the full
          // round wave is carried by the lens (fightfx.js), which bends the picture instead.
          const nSeg = 3 + (Math.abs(Math.round(e.seed * 7)) % 3);
          const segs = e.segs || (e.segs = Array.from({ length: nSeg }, (_, j) => {
            const c = (j / nSeg) * Math.PI * 2 + hash(e.seed * 13 + j) * 1.1;
            return { c, half: 0.22 + 0.2 * Math.abs(hash(e.seed * 29 + j)), lag: Math.abs(hash(e.seed * 41 + j)) * 0.12 };
          }));
          const steps = Math.max(24, Math.round(R * 6.5));
          for (let i = 0; i < steps; i++) {
            const a = (i / steps) * Math.PI * 2;
            let segF = -1, lag = 0;
            if (e.whole) segF = 0.35 + 0.1 * Math.sin(a * 3 + e.seed);              // one unbroken front (the time ripple), a slight wobble in its weight
            else for (const s of segs) { let d = Math.abs(((a - s.c) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI); const hw = s.half * (1 - p * 0.45); if (d < hw) { segF = d / hw; lag = s.lag; break; } }
            if (segF < 0) continue;
            if (e.half && Math.sin(a) > -0.08) continue;                          // a dome: nothing below the floor
            const taper = Math.cos(segF * Math.PI * 0.5);                         // full in the middle, a needle at each tip
            const wob = 1 - lag * (1 - p) + (0.05 + 0.08 * sq) * angNoise(e.seed, a, 3), thA = th * (0.25 + 0.95 * taper);
            for (let q = 0; q <= thA; q += 0.7) {
              const rr = R * wob - q, lx = Math.cos(a) * rr, ly = Math.sin(a) * rr * sq;
              const x = e.x + lx * cr - ly * sr, y = e.y + lx * sr + ly * cr;
              // the leading edge is hot; it cools behind and with age
              put(x, y, e.ramp, (e.l0 || 0) + (q / Math.max(1, thA)) * 5 + p * 9, e.under);
            }
          }
        } else if (e.k === 'cres') {
          // a crescent of energy thrown forward: fat in the middle, needle-thin at the tips
          const R = e.r * (0.55 + 0.45 * easeOut(p)), th = e.thick * (1 - p * 0.6);
          for (let i = 0; i <= 40; i++) {
            const f = i / 40 - 0.5, a = e.a + f * e.arc, w = th * Math.cos(f * Math.PI) * (1 + 0.15 * angNoise(e.seed, a, 2));
            for (let q = 0; q <= w; q += 0.6) {
              const rr = R - q;
              put(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr, e.ramp, (e.l0 || 0) + (q / Math.max(1, w)) * 6 + Math.abs(f) * 6 + p * 7);
            }
            // speed lines trailing back from the crescent's face
            if (e.tail && e.v > 1.2 && i % 5 === 2) {
              const tl = e.v * 3.5 * (1 - Math.abs(f) * 1.4);
              for (let q = 0; q < tl; q += 0.7) put(e.x + Math.cos(a) * (R - w) - Math.cos(e.a) * q, e.y + Math.sin(a) * (R - w) - Math.sin(e.a) * q, e.ramp, 3 + (q / tl) * 9 + p * 4);
            }
          }
        } else if (e.k === 'icicle') {
          // a shard of packed sand. Three kinds: a long spike, a curved fang (wide at the
          // base, hooked toward the tip), a rough chunk; each with a dark outline so it
          // reads against anything, a sunlit upper face, a shaded underside and grain
          const ca = Math.cos(e.a), sa = Math.sin(e.a), z = e.size;
          const L0 = e.len * (e.kind === 'chunk' ? 0.7 : e.kind === 'fang' ? 1.0 : 1.25) * z;
          const W0 = (e.kind === 'chunk' ? 3.4 : e.kind === 'fang' ? 2.8 : 1.9) * z;
          const back = e.kind === 'chunk' ? 0.8 : 1.3;
          for (let u = -L0 * back - 1; u <= L0 + 1; u += 0.5) {
            const f = u > 0 ? u / L0 : -u / (L0 * back);
            let w = W0 * (u > 0 ? 1 - f : 1 - f * (e.kind === 'fang' ? 0.4 : 0.9));
            if (e.kind === 'chunk') w *= 0.75 + 0.35 * hash(Math.round(u * 2) * 37 + e.seed);
            const bend = e.kind === 'fang' ? f * f * 2.2 * z * (u > 0 ? 1 : 0) : 0;
            for (let v = -w - 1; v <= w + 1; v += 0.5) {
              const vv = v - bend, edge = Math.abs(vv) > w - 0.5 || u > L0 - 0.5 || u < -L0 * back + 0.5;
              if (Math.abs(vv) > w + 0.6) continue;
              const side = vv / Math.max(0.5, w), tail = u < 0 ? f : 0;
              const gx = Math.round(u * 2), gy = Math.round(v * 2), gr = hash(gx * 131 + gy * 977 + 7) > 0.35 ? 1 : hash(gx * 53 + gy * 311) > 0.6 ? -1 : 0;
              const lvl = edge ? 12 : u > L0 * 0.75 ? 0 : Math.abs(side) < 0.18 ? 1 + tail * 3 : side < 0 ? 3 + tail * 3 : 6 + tail * 3;
              put(e.x + ca * u - sa * v, e.y + sa * u + ca * v, 4, lvl + (edge ? 0 : gr));
            }
          }
        } else if (e.k === 'spark') {
          // a smear: a short streak along its motion, the head hotter than the tail
          const sp = Math.hypot(e.vx, e.vy), len = Math.min(5, 1 + sp * (e.len || 1.2) * 0.8);
          const ux = sp ? e.vx / sp : 0, uy = sp ? e.vy / sp : 0;
          const lv = (e.l0 || 0) + p * 13;
          if (lv > 12) continue;
          for (let s = 0; s <= len; s += 0.7) put(e.x - ux * s, e.y - uy * s, e.ramp, lv + (s / len) * 4);
        } else if (e.k === 'ember') {
          // a mote that flickers as it cools
          const fl = (Math.sin(e.t * 0.9 + e.seed * 3) > 0.2) ? 0 : 3;
          put(e.x, e.y, e.ramp, 4 + p * 10 + fl);
        } else if (e.k === 'smoke') {
          // smoke: three lumps, lit from above and warm underneath where the blast was,
          // shaded with a rim; eaten away from the edges into wisps as it rises
          const lumps = e.lumps || (e.lumps = [0, 1, 2].map((j) => ({ dx: hash(e.seed * 5 + j) * e.r * 0.9, dy: hash(e.seed * 9 + j) * e.r * 0.5 - j * 0.6, r: e.r * (0.55 + 0.35 * Math.abs(hash(e.seed * 13 + j))) })));
          for (const lp of lumps) {
            const r = lp.r * (1 + p * 0.5), cx = e.x + lp.dx, cy = e.y + lp.dy;
            for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
              const a = Math.atan2(dy, dx), d = Math.hypot(dx, dy), rr = r * (1 + 0.28 * angNoise(e.seed + lp.r * 7, a, 2));
              if (d > rr) continue;
              const nz = hash(((Math.round(cx + dx) >> 1) * 73856093) ^ ((Math.round(cy + dy) >> 1) * 19349663) ^ (e.seed * 31)) * 0.5 + 0.5;
              if (nz < (p - 0.05) * 2.1 + (d / rr) * 0.6 - 0.3) continue;
              const v = dy / Math.max(1, rr);                       // -1 top .. 1 bottom
              let lvl = 4.5 + v * 2.5 + (d / rr > 0.75 ? 1.5 : 0) + p * 5;     // taupe dust, never cream pillows
              if (p < 0.3 && v > 0.3) { put(cx + dx, cy + dy, 0, 9 + v * 2 + p * 10); continue; }   // the blast still lights its belly
              put(cx + dx, cy + dy, 3, lvl);
            }
          }
        }
      }
    }
  }
  const api = { FX, FX_PAL, RAMP, STAMPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillVFX = api;
})(typeof window !== 'undefined' ? window : globalThis);
