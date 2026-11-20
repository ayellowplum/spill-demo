// The prelude. Not the story: a few slow, quiet pictures that raise questions.
//   1. Night sea under the moon. The view sinks below the surface.
//   2. Down past drowned towers, through shafts of light, sand drifting.
//   3. The bottom: a vast hourglass, cracked, a faint glow breathing in the crack.
//   4. Dark. A small lantern, far off, swinging, coming closer. A hood, barely lit.
//   5. A heap of still sand in the lamplight. One grain wakes. Then more.
//
// How it stays smooth: every static picture is drawn once into its own pixel
// canvas (a layer). Each frame the layers are placed on screen with
// screen-pixel precision (a layer pixel is k screen pixels, but it can move one
// screen pixel at a time), so slow camera moves glide instead of stepping.
// Moving things (light, motes, the lamp) are drawn the same way.
(function (root) {
  'use strict';
  const VW = 256, VH = 144;                              // the view, in art pixels
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const ease = (u) => u * u * (3 - 2 * u), clamp01 = (u) => Math.max(0, Math.min(1, u));
  function hash(n) { n = (n << 13) ^ n; return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 2147483647; }
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  // a pixel canvas you can paint into, with dithering helpers
  class Px {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.cv = document.createElement('canvas'); this.cv.width = w; this.cv.height = h;
      this.g = this.cv.getContext('2d'); this.img = this.g.createImageData(w, h); this.d = this.img.data;
    }
    px(x, y, h, a) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h || !h) return; const c = rgb(h), o = (y * this.w + x) * 4; this.d[o] = c[0]; this.d[o + 1] = c[1]; this.d[o + 2] = c[2]; this.d[o + 3] = a == null ? 255 : a; }
    dpx(x, y, a, b, u) { this.px(x, y, BAYER[((y | 0) & 3) * 4 + ((x | 0) & 3)] / 16 < u ? b : a); }
    grad(y0, y1, cols, x0, x1) {
      x0 = x0 || 0; x1 = x1 == null ? this.w : x1;
      for (let y = Math.max(0, y0 | 0); y < Math.min(this.h, y1); y++) {
        const u = (y - y0) / Math.max(1, y1 - y0) * (cols.length - 1), i = Math.min(cols.length - 2, Math.floor(u));
        for (let x = x0; x < x1; x++) this.dpx(x, y, cols[i], cols[i + 1], u - i);
      }
    }
    done() { this.g.putImageData(this.img, 0, 0); return this; }
  }

  // ---- the static pictures (built once) ----
  function buildSurface() {
    // a tall picture: night sky above, the sea's surface at y=118, the water below, darkening
    const P = new Px(VW, 430);
    P.grad(0, 118, ['#04050c', '#070a18', '#0c1428', '#16203a', '#22304c']);
    for (let k = 0; k < 90; k++) { const x = hash(k * 13) * VW, y = hash(k * 29) * 100; P.px(x, y, hash(k * 3) > 0.85 ? '#e8ecff' : hash(k * 5) > 0.5 ? '#7a88aa' : '#4a5676'); }
    // the moon, with a soft dithered halo
    for (let y = 0; y < 70; y++) for (let x = 150; x < 230; x++) {
      const d = Math.hypot(x - 190, y - 36);
      if (d < 11) P.px(x, y, hash(x * 7 + y * 3) > 0.85 ? '#bcb8a4' : d > 9 ? '#d4d0bc' : '#efe9d4');
      else if (d < 30) P.dpx(x, y, null, d < 18 ? '#3a4664' : '#283452', (30 - d) / 22);
    }
    // the tips of drowned spires, far off, breaking the surface
    for (const [x0, w, h] of [[20, 6, 14], [40, 3, 22], [64, 8, 10], [100, 4, 30], [118, 10, 12], [210, 5, 18], [232, 7, 9]]) {
      for (let y = 118 - h; y < 118; y++) {
        const taper = Math.max(1, Math.round(w * (1 - (118 - y) / h * 0.7))), l = x0 + Math.floor((w - taper) / 2);
        for (let x = l; x < l + taper; x++) P.px(x, y, x === l + taper - 1 ? '#3a4664' : '#0a0e18');
      }
    }
    // under the surface: dark teal into black
    P.grad(118, 430, ['#0e2a3a', '#0c2232', '#091a28', '#06121e', '#040a12', '#020408']);
    return P.done();
  }
  function buildTowers(seed, w, h, dark, rim, density) {
    // a layer of sunken buildings for the descent: tall silhouettes, broken tops,
    // dead windows, weed hanging from ledges, cold light catching their upper edges
    const P = new Px(w, h);
    let x = -10;
    while (x < w) {
      const bw = 18 + Math.floor(hash(seed + x * 7) * 34), top = Math.floor(hash(seed * 3 + x) * h * 0.22), gap = 6 + Math.floor(hash(seed + x * 13) * 30 / density);
      for (let yy = top; yy < h; yy++) for (let xx = x; xx < x + bw; xx++) {
        const edge = yy < top + 2 + (hash(xx * 5 + seed) > 0.6 ? 1 : 0);
        const side = xx === x || xx === x + bw - 1, lit = xx - x < 3, band = ((xx - x) % 7 === 0);
        P.px(xx, yy, edge ? rim : side ? '#05080c' : lit ? rim : band ? '#030609' : dark);
      }
      for (let wy = top + 6; wy < h - 4; wy += 9) for (let wx = x + 4; wx < x + bw - 4; wx += 6) if (hash(wx * 3 + wy * 11 + seed) > 0.35) { P.px(wx, wy, '#020406'); P.px(wx, wy + 1, '#020406'); P.px(wx + 1, wy, '#020406'); P.px(wx + 1, wy + 1, '#020406'); }
      for (let k = 0; k < 3; k++) { const wx = x + 2 + Math.floor(hash(seed + x + k * 17) * (bw - 4)), len = 6 + Math.floor(hash(x * 3 + k) * 18); for (let j = 0; j < len; j++) P.px(wx + Math.round(Math.sin(j * 0.5 + k) * 1.2), top + 2 + j, j % 3 ? '#0e2a22' : '#163a2c'); }
      x += bw + gap;
    }
    return P.done();
  }
  function buildGlass() {
    // the Great Glass at the bottom of the sea: huge, dark, cold rims, half buried in sand, cracked
    const P = new Px(220, 260);
    const cx = 110;
    for (let y = 0; y < 230; y++) {
      const v = (y - 112) / 108, half = Math.abs(v) < 0.07 ? 5 : 92 * Math.pow(Math.sin(Math.min(1, (Math.abs(v) - 0.07) / 0.93) * Math.PI), 0.65) + 5;
      for (let x = Math.floor(cx - half); x <= cx + half; x++) {
        const s = (x - cx) / Math.max(1, half);
        const edge = Math.abs(x - cx) > half - 2;
        P.px(x, y, edge ? (s < 0 ? '#3e6878' : '#16303c') : s < -0.6 && s > -0.8 ? '#10222c' : '#060c12');
      }
    }
    for (const by of [0, 226]) for (let x = 6; x < 214; x++) for (let k = 0; k < 6; k++) P.px(x, by + k, k === 0 ? '#5a5038' : k < 3 ? '#3a3020' : '#16120a');
    for (let x = 0; x < 220; x++) { const hgt = 30 + Math.sin(x * 0.04) * 6 + Math.sin(x * 0.13) * 2; for (let y = Math.floor(260 - hgt); y < 260; y++) P.px(x, y, y < 262 - hgt ? '#2a2418' : hash(x * 7 + y) > 0.8 ? '#1e1a12' : '#16120c'); }
    let x = cx, y = 112;
    for (let k = 0; k < 70; k++) { x += (hash(k * 31) - 0.5) * 3; y -= 1.2; P.px(x, y, '#020306'); P.px(x + 1, y, '#2a4a56'); if (hash(k * 7) > 0.85) for (let j = 0; j < 8; j++) P.px(x + j * (hash(k) > 0.5 ? 1 : -1), y + j * 0.6, '#020306'); }
    return P.done();
  }
  function buildHeap() {
    const P = new Px(VW, VH);
    P.grad(0, VH, ['#000000', '#030206', '#06040a']);
    for (let x = 30; x < 226; x++) {
      const d = (x - 128) / 98, hgt = Math.round((1 - d * d) * 30 + Math.sin(x * 0.3) * 1.2);
      for (let y = 0; y < hgt; y++) { const g = hash(x * 13 + y * 7); P.px(x, 126 - y, g > 0.82 ? '#4a3a24' : g > 0.45 ? '#3a2c1a' : '#2a2014'); }
    }
    for (let x = 0; x < VW; x++) for (let y = 126; y < VH; y++) P.px(x, y, hash(x + y * 5) > 0.8 ? '#16100a' : '#0e0a06');
    return P.done();
  }
  // the hood, seen only where the lamp touches it
  const HOOD = [
    '......kkkk......', '....kkhhhhkk....', '...khhhkkkhhk...', '..khhkk....khk..', '..khk.......kk..', '.khk..........k.', '.khk..........k.',
    'khhk..........kk', 'khk............k', 'khk............k', 'khhk..........kk', 'khhhk........kk.', 'khhhhkk....kkhk.', 'khhhhhhkkkkhhhk.', 'khhhhhhhhhhhhhhk',
  ];

  class Cutscene {
    constructor(hooks) {
      this.hooks = hooks || {};
      this.t = 0; this.shot = 0; this.st = 0; this.done = false; this.motes = []; this.camX = 0; this.camY = 0;
      this.shots = [
        { id: 'surface', dur: 480, line: '' },
        { id: 'descent', dur: 620, line: 'Long ago, a city sold its hours.' },
        { id: 'glass', dur: 500, line: 'Then the sea came to collect.' },
        { id: 'lamp', dur: 440, line: '' },
        { id: 'wake', dur: 470, line: '' },
      ];
      if (typeof document !== 'undefined') {
        this.L = { surface: buildSurface(), far: buildTowers(11, 360, 900, '#0e2632', '#1e4252', 0.6), mid: buildTowers(23, 380, 900, '#0a1c28', '#2a5464', 0.9), near: buildTowers(37, 420, 900, '#050e16', '#3a6a7a', 1.3), glass: buildGlass(), heap: buildHeap() };
        this.hood = new Px(30, 46);
        const inside = (x, y) => {
          if (Math.hypot(x - 13, y - 8) < 7.5 - (y < 4 ? (4 - y) * 0.3 : 0)) return true;            // the hood
          if (y >= 8 && y < 46) { const half = 6 + (y - 8) * 0.24 + Math.sin(y * 0.5) * 0.5; if (Math.abs(x - 13) < half) return true; }   // the cloak, widening, hem ragged
          if (y >= 16 && y <= 19 && x >= 13 && x <= 27) return true;                                   // the arm reaching out to the lamp
          return false;
        };
        for (let y = 0; y < 46; y++) for (let x = 0; x < 30; x++) {
          if (!inside(x, y) || (y > 42 && hash(x * 7) > 0.6)) continue;
          const rimR = !inside(x + 1, y) || !inside(x + 1, y - 1), rimT = !inside(x, y - 1);
          const face = Math.hypot(x - 14, y - 9) < 4;                                                   // the hood's opening: nothing inside
          this.hood.px(x, y, face ? '#000000' : rimR ? '#b0763c' : rimT && x > 12 ? '#6a4630' : (x + y) % 5 === 0 ? '#120e18' : '#0a080e');
        }
        this.hood.done();
        this.fadeCv = new Px(VW, VH);
      }
    }
    get cur() { return this.shots[this.shot]; }
    step() {
      if (this.done) return;
      this.t++; this.st++;
      if (this.st === 1 && this.hooks.onShot) this.hooks.onShot(this.cur.id);
      for (let k = this.motes.length - 1; k >= 0; k--) { const m = this.motes[k]; m.x += m.vx; m.y += m.vy; m.vx += (m.ax || 0); m.vy += (m.ay || 0); if (--m.life <= 0) this.motes.splice(k, 1); }
      if (this.st >= this.cur.dur) { this.shot++; this.st = 0; this.motes.length = 0; if (this.shot >= this.shots.length) { this.done = true; this.shot = this.shots.length - 1; this.st = this.cur.dur - 1; } }
    }
    skip() { this.done = true; }

    // ---- drawing on the screen: X0, Y0 the view's top-left in screen px, k screen px per art px ----
    draw(ctx, X0, Y0, k) {
      this.ctx = ctx; this.X0 = X0; this.Y0 = Y0; this.k = k;
      ctx.save();
      ctx.beginPath(); ctx.rect(X0, Y0, VW * k, VH * k); ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#000'; ctx.fillRect(X0, Y0, VW * k, VH * k);
      const s = this.cur, t = this.st, u = t / s.dur;
      this['shot_' + s.id](t, u);
      // motes (sand, bubbles, embers), each placed to the screen pixel
      for (const m of this.motes) {
        ctx.globalAlpha = Math.min(1, m.life / 30) * (m.alpha || 1); ctx.fillStyle = m.col;
        const z = Math.max(1, Math.round(k * (m.size || 1)));
        ctx.fillRect(Math.round(X0 + m.x * k), Math.round(Y0 + m.y * k), z, z);
      }
      ctx.globalAlpha = 1;
      // a dithered fade at the joins, and a vignette, both in art pixels
      const fin = Math.min(1, t / 40), fout = Math.min(1, (s.dur - t) / 40), f = Math.min(fin, fout);
      const F = this.fadeCv; F.d.fill(0);
      for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
        const e = Math.min(x, VW - 1 - x, y * 1.7, (VH - 1 - y) * 1.7), b = BAYER[(y & 3) * 4 + (x & 3)] / 16;
        if (b >= f || (e < 22 && b >= e / 22)) F.d[(y * VW + x) * 4 + 3] = 255;
      }
      F.done();
      ctx.drawImage(F.cv, X0, Y0, VW * k, VH * k);
      ctx.restore();
    }
    // place a layer: (lx, ly) is where the layer's top-left sits in view space (art px, fractional ok)
    layer(cv, lx, ly) { const k = this.k; this.ctx.drawImage(cv, Math.round(this.X0 + lx * k), Math.round(this.Y0 + ly * k), cv.width * k, cv.height * k); }
    rect(x, y, w, h, col, a) { const k = this.k; this.ctx.globalAlpha = a == null ? 1 : a; this.ctx.fillStyle = col; this.ctx.fillRect(Math.round(this.X0 + x * k), Math.round(this.Y0 + y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))); this.ctx.globalAlpha = 1; }
    // soft light: stacked translucent discs drawn in art-pixel rows, so its edge stays stepped
    light(cx, cy, r, col, a) {
      for (let ring = 12; ring >= 1; ring--) {
        const rr = r * Math.pow(ring / 12, 0.8);
        this.ctx.globalAlpha = a * 0.09; this.ctx.fillStyle = col;
        for (let y = -rr; y <= rr; y += 1) { const w = Math.round(Math.sqrt(Math.max(0, rr * rr - y * y))); this.ctx.fillRect(Math.round(this.X0 + (cx - w) * this.k), Math.round(this.Y0 + (cy + y) * this.k), Math.round(w * 2 * this.k), Math.ceil(this.k)); }
      }
      this.ctx.globalAlpha = 1;
    }
    mote(m) { this.motes.push(m); if (this.motes.length > 500) this.motes.shift(); }

    shot_surface(t, u) {
      // the view sinks slowly from the sky to below the waterline
      const cy = ease(clamp01((u - 0.2) / 0.8)) * 150;
      this.layer(this.L.surface.cv, 0, -cy);
      const sy = 118 - cy;
      for (let x = 0; x < VW; x++) {
        const w = Math.sin(x * 0.09 + this.t * 0.025) + Math.sin(x * 0.031 - this.t * 0.017) * 1.3, y = sy + w * 0.8;
        this.rect(x, y, 1, 1, w > 1.1 ? '#a8c8d8' : '#3e6478', w > 1.1 ? 0.9 : 0.7);
        if (Math.abs(x - 190 + Math.sin(this.t * 0.02) * 2) < 7 - (w > 0 ? 2 : 0) && hash(x * 5 + (this.t >> 2)) > 0.4) this.rect(x, y + 1 + (hash(x) * 3 | 0), 1, 1, '#e8e4cc', 0.8);
      }
      if (sy < VH) {
        for (let r = 0; r < 4; r++) {
          const rx = 170 + r * 22 + Math.sin(this.t * 0.01 + r) * 6;
          for (let y = Math.max(0, Math.floor(sy) + 2); y < VH; y++) { const d = (y - sy) / 140; this.rect(rx - d * 30, y, 6 + d * 10, 1, '#6a9ab0', 0.06 * (1 - d)); }
        }
        if (this.t % 3 === 0) this.mote({ x: Math.random() * VW, y: VH + 2, vx: (Math.random() - 0.5) * 0.05, vy: -0.25 - Math.random() * 0.3, life: 260, col: '#5a8a9c', alpha: 0.6 });
      }
    }
    shot_descent(t, u) {
      // sinking: three layers of drowned towers rise past at different speeds; light shafts sway
      const cy = t * 0.55;
      this.ctx.fillStyle = '#04101a'; this.ctx.fillRect(this.X0, this.Y0, VW * this.k, VH * this.k);
      for (let y = 0; y < VH; y += 2) this.rect(0, y, VW, 2, '#000000', Math.min(0.7, 0.05 + (y / VH) * 0.25 + u * 0.3));
      this.layer(this.L.far.cv, -40 + Math.sin(this.t * 0.002) * 4, 120 - cy * 0.35);
      for (let r = 0; r < 5; r++) {
        const rx = 40 + r * 48 + Math.sin(this.t * 0.008 + r * 1.7) * 10;
        for (let y = 0; y < VH; y++) { const d = y / VH; this.rect(rx - d * 26 + r, y, 5 + d * 12, 1, '#7ab0c4', 0.05 * (1 - d) * (1 - u * 0.7)); }
      }
      this.layer(this.L.mid.cv, -70, 150 - cy * 0.6);
      this.layer(this.L.near.cv, -110 + Math.sin(this.t * 0.003) * 3, 200 - cy * 1.0);
      if (this.t % 6 === 0) this.mote({ x: Math.random() * VW, y: -2, vx: (Math.random() - 0.5) * 0.08, vy: 0.12 + Math.random() * 0.15, life: 400, col: Math.random() > 0.6 ? '#c8a060' : '#7a6a4a', alpha: 0.6 });
      if (this.t % 9 === 0) this.mote({ x: Math.random() * VW, y: VH + 2, vx: 0, vy: -0.5 - Math.random() * 0.4, life: 300, col: '#4a7a8c', alpha: 0.5 });
    }
    shot_glass(t, u) {
      // the bottom: the Glass looms; the view drifts slowly down its side; a glow breathes in the crack
      const cy = (1 - ease(u)) * 70, cx = Math.sin(u * 1.2) * 8;
      this.ctx.fillStyle = '#020508'; this.ctx.fillRect(this.X0, this.Y0, VW * this.k, VH * this.k);
      const gx = 18 - cx, gy = -60 + cy;
      const breathe = 0.5 + 0.5 * Math.sin(this.t * 0.03);
      this.light(gx + 110, gy + 70, 70, '#2a6a7a', 0.25 + breathe * 0.25);
      this.layer(this.L.glass.cv, gx, gy);
      for (let k = 0; k < 70; k += 2) { const x = gx + 110 + (hash(k * 31) - 0.5) * 6 * Math.min(1, k / 10), y = gy + 112 - k * 1.2; this.rect(x, y, 1, 1, '#ffe0a0', (0.3 + breathe * 0.7) * (1 - k / 90)); }
      this.light(gx + 110, gy + 90, 18, '#ffd890', 0.3 * breathe);
      if (this.t % 3 === 0) this.mote({ x: Math.random() * VW, y: Math.random() * VH, vx: (Math.random() - 0.5) * 0.03, vy: (Math.random() - 0.5) * 0.03, life: 240, col: '#8a7450', alpha: 0.5 });
    }
    shot_lamp(t, u) {
      // the dark; a lamp far off, swinging as someone walks; it comes closer and stops
      const app = ease(clamp01(u * 1.25)), swing = Math.sin(this.t * 0.06) * (1 - app * 0.7) * 6;
      const lx = 200 - app * 92 + swing, ly = 58 + app * 22 + Math.abs(Math.sin(this.t * 0.06)) * 2 * (1 - app);
      const r = 16 + app * 60, flick = 0.85 + 0.15 * Math.sin(this.t * 0.41) * Math.sin(this.t * 0.13);
      for (let x = 0; x < VW; x++) { const d = Math.abs(x - lx) / r; if (d < 1.4) this.rect(x, 120, 1, 1, '#3a2c1c', (1.4 - d) / 1.4 * flick); }
      this.light(lx, ly, r, '#d89040', 0.5 * flick);
      if (app > 0.4) { this.ctx.globalAlpha = clamp01((app - 0.4) / 0.4) * flick; this.layer(this.hood.cv, lx - 28, Math.min(ly - 17 + app * 11, 120 - 46)); this.ctx.globalAlpha = 1; }
      this.rect(lx - 1, ly - 4, 3, 1, '#2a2018'); this.rect(lx - 2, ly - 3, 1, 5, '#3a2c1c'); this.rect(lx + 2, ly - 3, 1, 5, '#3a2c1c'); this.rect(lx - 1, ly + 2, 3, 1, '#2a2018');
      this.rect(lx, ly - 2, 1, 3, flick > 0.9 ? '#fff2c8' : '#ffc864');
      this.rect(lx - 1, ly - 1, 1, 2, '#f08a3a', 0.8); this.rect(lx + 1, ly - 1, 1, 2, '#f08a3a', 0.8);
      if (this.t % 7 === 0) this.mote({ x: lx, y: ly - 2, vx: (Math.random() - 0.5) * 0.1, vy: -0.15 - Math.random() * 0.1, life: 90, col: '#ffb060', alpha: 0.8 });
      if (u > 0.82) { const lower = ease((u - 0.82) / 0.18) * 14; this.light(lx - 10, 116, 20 + lower, '#d89040', 0.25); }
    }
    shot_wake(t, u) {
      // a heap of still sand, lamplit from the left; one grain glints, the heap shivers, grains rise
      this.layer(this.L.heap.cv, 0, 0);
      const flick = 0.85 + 0.15 * Math.sin(this.t * 0.41) * Math.sin(this.t * 0.13);
      this.light(70, 90, 90, '#d89040', 0.35 * flick);
      if (t > 60) {
        const beat = (t - 60) % 70, pulse = beat < 10 ? 1 - beat / 10 : 0;
        this.light(128, 98, 6 + pulse * 10, '#ffe0a0', 0.4 + pulse * 0.5);
        this.rect(128, 97 - (t > 200 && t % 12 < 2 ? 1 : 0), 1, 1, '#fff2c8');
      }
      if (t > 200 && this.t % 2 === 0) {
        const n = Math.min(4, (t - 200) / 50);
        for (let k = 0; k < n; k++) { const x = 60 + Math.random() * 136, d = (x - 128) / 98; this.mote({ x, y: 126 - (1 - d * d) * 28, vx: (128 - x) * 0.002, vy: -0.15 - Math.random() * 0.25, ay: -0.002, life: 200, col: Math.random() > 0.5 ? '#ffe0a0' : '#e2a84a' }); }
      }
    }
  }
  root.SpillCutscene = { Cutscene, W: VW, H: VH };
})(typeof window !== 'undefined' ? window : globalThis);
