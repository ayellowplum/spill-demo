// The shop's materials, painted one piece at a time: no tiles, no flat bands.
//
// Every piece (a button, the sign, the backpack panel) is painted once at its
// exact size into its own little pixel canvas, then placed on screen at the
// UI's pixel size. Each is seeded, so it looks the same every frame, but no
// two pieces share a pattern:
//   wood   - planks whose grain flows and bends, seven hue-shifted tones,
//            knots with rings, nail holes, scratches, a lit top and a worn lip
//   brass  - seven tones, dents along the edge, wear on the high spots,
//            patina flecks, rivets shaded from the top left
//   leather- pores, wandering creases with a lit edge, worn patches, and hand
//            stitching whose stitches are never quite the same length
// Edges waver: a pixel in or out here and there, chipped corners, never ruled.
(function (root) {
  'use strict';

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const RAMP = {
    wood: ['#140b05', '#22130a', '#331d0f', '#452815', '#59341b', '#704323', '#8a572e', '#a66e3c'],
    woodLit: ['#1c1008', '#2e1a0c', '#422612', '#583419', '#704321', '#8a552b', '#a76c37', '#c4884a'],
    woodDull: ['#110c08', '#1a140f', '#251c15', '#30251c', '#3c2f24', '#4a3a2d', '#584737', '#685442'],
    brass: ['#1e1306', '#3e280c', '#634214', '#8c5f20', '#b5822f', '#d8a74c', '#efc97a', '#fff0c4'],
    brassDull: ['#16120c', '#2a2218', '#3e3324', '#544630', '#6a5a3e', '#80704e', '#968660', '#b0a07a'],
    leather: ['#0e0805', '#1a0f09', '#28170d', '#372013', '#472a18', '#58361f', '#6b4428', '#7f5433'],
  };
  const PATINA = ['#2f5446', '#467060', '#6a9480'];

  // ---- small deterministic noise ----
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  class Paint {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.cv = document.createElement('canvas'); this.cv.width = w; this.cv.height = h;
      this.g = this.cv.getContext('2d'); this.img = this.g.createImageData(w, h); this.d = this.img.data;
      this.mask = new Uint8Array(w * h);           // 0 outside, 1 inside
    }
    set(x, y, col) { if (x < 0 || y < 0 || x >= this.w || y >= this.h || !col) return; const c = hex(col), o = (y * this.w + x) * 4; this.d[o] = c[0]; this.d[o + 1] = c[1]; this.d[o + 2] = c[2]; this.d[o + 3] = 255; }
    in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.mask[y * this.w + x] === 1; }
    done() { this.g.putImageData(this.img, 0, 0); return this.cv; }
  }
  // a board's outline: rounded, chipped corners and a wavering edge (a pixel in, here and there)
  function outline(P, seed, rad) {
    const r = rng(seed), W = P.w, H = P.h;
    const top = [], bot = [], lef = [], rig = [];
    for (let x = 0; x < W; x++) { top.push(0); bot.push(0); }
    for (let y = 0; y < H; y++) { lef.push(0); rig.push(0); }
    const chip = [0, 1, 2, 3].map(() => rad);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (y < top[x] || y >= H - bot[x] || x < lef[y] || x >= W - rig[y]) continue;
      // the four corners, each cut a little differently
      const cs = [[x, y, chip[0]], [W - 1 - x, y, chip[1]], [x, H - 1 - y, chip[2]], [W - 1 - x, H - 1 - y, chip[3]]];
      if (cs.some(([a, b, c]) => a + b < c)) continue;
      P.mask[y * W + x] = 1;
    }
  }
  const edgeDist = (P, x, y, max) => { for (let k = 1; k <= max; k++) if (!P.in(x - k, y) || !P.in(x + k, y) || !P.in(x, y - k) || !P.in(x, y + k)) return k; return max + 1; };

  // Pixel-art materials, in the game's own manner: three or four tones, hard
  // edges, and small placed clusters, never smooth shading.
  // wood: planks; each has a lit top row, a dark seam under it, and short grain dashes
  function paintWood(P, seed, ramp, x0, y0, x1, y1, plankH) {
    const r = rng(seed * 7 + 3), base = ramp[4], dash = ramp[3], lit = ramp[6], seamC = ramp[1];
    const seams = []; let sy = y0 + plankH; while (sy < y1 - 2) { seams.push(sy); sy += plankH + (r() < 0.3 ? 1 : 0); }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (P.in(x, y)) P.set(x, y, base);
    let top = y0;
    for (let k = 0; k <= seams.length; k++) {
      const bot = k < seams.length ? seams[k] : y1;
      for (let x = x0; x < x1; x++) if (P.in(x, top)) P.set(x, top, lit);                           // the lit top of the plank
      if (k < seams.length) for (let x = x0; x < x1; x++) if (P.in(x, bot)) P.set(x, bot, seamC);   // the seam
      // grain: a few short dashes, each placed, none touching
      for (let gy = top + 2; gy < bot - 0; gy += 2) {
        let gx = x0 + 1 + Math.floor(r() * 5);
        while (gx < x1 - 2) { const len = 2 + Math.floor(r() * 3); for (let q = 0; q < len; q++) if (P.in(gx + q, gy)) P.set(gx + q, gy, dash); gx += len + 3 + Math.floor(r() * 6); }
      }
      // a knot now and then: two dark pixels with a lit one above
      if (r() < 0.35 && bot - top > 3) { const kx = x0 + 3 + Math.floor(r() * Math.max(1, x1 - x0 - 6)), ky = top + 2; if (P.in(kx, ky)) { P.set(kx, ky + 1, seamC); P.set(kx + 1, ky + 1, seamC); P.set(kx, ky, lit); } }
      top = bot + 1;
    }
  }
  // brass on the outer band: one dark outline, then lit top, mid sides, dark bottom
  function paintBrassRim(P, seed, ramp, thick) {
    for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
      if (!P.in(x, y)) continue;
      const e = edgeDist(P, x, y, thick + 1); if (e > thick) continue;
      if (e === 1) { P.set(x, y, ramp[0]); continue; }                                   // the outline
      const up = !P.in(x, y - e), dn = !P.in(x, y + e), lf = !P.in(x - e, y);
      P.set(x, y, up ? ramp[6] : dn ? ramp[2] : lf ? ramp[5] : ramp[4]);
    }
  }
  function rivet(P, x, y, ramp) { P.set(x, y, ramp[7]); P.set(x + 1, y, ramp[5]); P.set(x, y + 1, ramp[4]); P.set(x + 1, y + 1, ramp[2]); }
  // leather: one tone, a few pores, a darker rolled edge, and a stitched line
  function paintLeather(P, seed, ramp, inset) {
    const r = rng(seed * 13 + 1);
    for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
      if (!P.in(x, y)) continue;
      const e = edgeDist(P, x, y, 3);
      P.set(x, y, e <= 2 ? ramp[1] : hash2(x, y, seed) > 0.985 ? ramp[2] : ramp[3]);
    }
    // stitches: two on, two off, all the way round, just inside the edge
    const thread = ramp[6];
    const along = []; for (let x = inset; x < P.w - inset; x++) along.push([x, inset]); for (let y = inset; y < P.h - inset; y++) along.push([P.w - 1 - inset, y]);
    for (let x = P.w - 1 - inset; x >= inset; x--) along.push([x, P.h - 1 - inset]); for (let y = P.h - 1 - inset; y >= inset; y--) along.push([inset, y]);
    along.forEach(([x, y], k) => { if (P.in(x, y) && k % 4 < 2) P.set(x, y, thread); });
  }
  // an ornate brass corner for the backpack: a curl with a gem of patina
  const CORNER = [
    'oooooooooo', 'oBBBBBBbbo', 'oBbbbbddo.', 'oBbnbdoo..', 'oBbbdo....', 'oBbdo.....', 'oBdo..pP..', 'obdo..Pp..', 'obo.......', 'oo........',
  ];
  function corner(P, x, y, flipX, flipY, ramp) {
    const m = { o: ramp[0], B: ramp[6], b: ramp[4], d: ramp[2], n: ramp[7], p: PATINA[1], P: PATINA[2] };
    CORNER.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === '.') return; P.set(flipX ? x - rx : x + rx, flipY ? y - ry : y + ry, m[ch]); }));
  }

  // ---- the pieces ----
  const cache = new Map();
  function cached(key, make) { if (!cache.has(key)) { cache.set(key, make()); if (cache.size > 80) cache.delete(cache.keys().next().value); } return cache.get(key); }
  function buttonCanvas(w, h, state, seed) {
    return cached('b' + w + 'x' + h + state + seed, () => {
      const P = new Paint(w, h); outline(P, seed, 2);
      paintWood(P, seed, state === 'hot' ? RAMP.woodLit : state === 'dull' ? RAMP.woodDull : RAMP.wood, 2, 2, w - 2, h - 2, h);   // one plank: no seam cutting the label in two
      paintBrassRim(P, seed, state === 'dull' ? RAMP.brassDull : RAMP.brass, 2);
      const br = state === 'dull' ? RAMP.brassDull : RAMP.brass;
      rivet(P, 2, 2, br); rivet(P, w - 4, 2, br); rivet(P, 2, h - 5, br); rivet(P, w - 4, h - 5, br);
      return P.done();
    });
  }
  function signCanvas(w, h, seed) {
    return cached('s' + w + 'x' + h + seed, () => {
      const P = new Paint(w, h); outline(P, seed, 3);
      paintWood(P, seed, RAMP.wood, 3, 3, w - 3, h - 3, 6);
      paintBrassRim(P, seed, RAMP.brass, 3);
      // brass straps over each end, riveted
      for (const sx of [5, w - 8]) for (let y = 1; y < h - 1; y++) for (let x = sx; x < sx + 3; x++) if (P.in(x, y)) P.set(x, y, RAMP.brass[x === sx ? 6 : x === sx + 2 ? 2 : 4 + (hash2(x, y, seed) > 0.8 ? 1 : 0)]);
      for (const sx of [5, w - 8]) { rivet(P, sx, 4, RAMP.brass); rivet(P, sx, h - 7, RAMP.brass); }
      return P.done();
    });
  }
  function panelCanvas(w, h, seed) {
    return cached('p' + w + 'x' + h + seed, () => {
      const P = new Paint(w, h); outline(P, seed, 3);
      paintLeather(P, seed, RAMP.leather, 5);
      paintBrassRim(P, seed, RAMP.brass, 2);
      corner(P, 0, 0, false, false, RAMP.brass); corner(P, w - 1, 0, true, false, RAMP.brass);
      corner(P, 0, h - 1, false, true, RAMP.brass); corner(P, w - 1, h - 1, true, true, RAMP.brass);
      return P.done();
    });
  }
  // a twisted rope: three strands winding round each other, frayed a little
  function ropeCanvas(len, seed) {
    return cached('r' + len + seed, () => {
      const P = new Paint(4, len); P.mask.fill(1);
      const r = rng(seed), tones = ['#3a2a18', '#5e4528', '#86663e', '#a8865a'];
      for (let y = 0; y < len; y++) for (let x = 0; x < 4; x++) {
        const twist = (y + x * 1.5) % 4, t = twist < 1 ? 3 : twist < 2.2 ? 2 : twist < 3.2 ? 1 : 0;
        P.set(x, y, tones[x === 0 ? Math.min(3, t + 1) : x === 3 ? Math.max(0, t - 1) : t]);
      }
      for (let k = 0; k < len / 6; k++) P.set(r() < 0.5 ? -1 : 4, Math.floor(r() * len), tones[1]);
      return P.done();
    });
  }
  const put = (ctx, cv, x, y, p) => { ctx.imageSmoothingEnabled = false; ctx.drawImage(cv, Math.round(x), Math.round(y), cv.width * p, cv.height * p); };
  // The castle frame: the one frame for every text box. Solid colours only (no translucency,
  // no bevel, no glow): an ink field and a single light line. Its character is in the cut:
  // chamfered corners like a dressed stone block, a small pointed-arch crest in the top edge
  // of wider boxes, and two corbel stubs under the lower corners.
  const FRAME_TOKENS = {
    field: '#100d16',                 // the box itself
    line: '#c8bca2',                  // the one light frame line (bone)
    hot: '#e8c77e',                   // the same line when it is the one you are on
    cool: '#8fb4cc',                  // the same line for lessons, so they read apart from the story
  };
  function castleFrame(ctx, x, y, w, h, p, o) {
    o = o || {};
    x = Math.round(x / p) * p; y = Math.round(y / p) * p; w = Math.round(w / p) * p; h = Math.round(h / p) * p;
    const line = FRAME_TOKENS[o.tone || 'line'] || FRAME_TOKENS.line;
    const W = w / p, H = h / p, c = 2;                                       // chamfer, in art pixels
    const px = (ax, ay) => ctx.fillRect(x + ax * p, y + ay * p, p, p);
    // the field, with its corners cut off
    ctx.fillStyle = FRAME_TOKENS.field;
    ctx.fillRect(x + c * p, y, w - 2 * c * p, h);
    ctx.fillRect(x, y + c * p, w, h - 2 * c * p);
    ctx.fillRect(x + p, y + p, w - 2 * p, h - 2 * p);
    // the line: four runs and the stepped chamfers
    ctx.fillStyle = line;
    ctx.fillRect(x + (c + 1) * p, y, w - 2 * (c + 1) * p, p);
    ctx.fillRect(x + (c + 1) * p, y + h - p, w - 2 * (c + 1) * p, p);
    ctx.fillRect(x, y + (c + 1) * p, p, h - 2 * (c + 1) * p);
    ctx.fillRect(x + w - p, y + (c + 1) * p, p, h - 2 * (c + 1) * p);
    for (let k = 0; k <= c; k++) { px(c - k, k); px(W - 1 - c + k, k); px(c - k, H - 1 - k); px(W - 1 - c + k, H - 1 - k); }
    // a pointed-arch crest rising out of the top edge (wide boxes only)
    if (W >= 60 && !o.plain) {
      const m = Math.floor(W / 2);
      ctx.fillStyle = FRAME_TOKENS.field; ctx.fillRect(x + (m - 2) * p, y - 2 * p, 5 * p, 2 * p); ctx.fillRect(x + (m - 1) * p, y - 3 * p, 3 * p, p);
      ctx.fillStyle = line;
      [[-3, 0], [-2, -1], [-2, -2], [-1, -3], [0, -4], [1, -3], [2, -2], [2, -1], [3, 0]].forEach(([dx, dy]) => px(m + dx, dy));
      ctx.fillStyle = FRAME_TOKENS.field; ctx.fillRect(x + (m - 2) * p, y, 5 * p, p);       // the arch opens the top line
      ctx.fillStyle = line; px(m, -1);                                                      // a keystone point inside it
    }
    // corbel stubs under the lower corners
    if (!o.plain && H >= 12) { ctx.fillStyle = line; ctx.fillRect(x + (c + 2) * p, y + h, 2 * p, p); ctx.fillRect(x + w - (c + 4) * p, y + h, 2 * p, p); }
  }
  const api = {
    FRAME_TOKENS,
    castleFrame,
    // w, h are in screen px; the piece is painted at w/p x h/p art pixels
    button(ctx, x, y, w, h, p, state, seed) { put(ctx, buttonCanvas(Math.round(w / p), Math.round(h / p), state || 'normal', seed || 1), x, y, p); },
    sign(ctx, x, y, w, h, p) {
      const rope = ropeCanvas(26, 3);
      for (const rx of [x + 9 * p, x + w - 13 * p]) put(ctx, rope, rx, y - 24 * p, p);
      put(ctx, signCanvas(Math.round(w / p), Math.round(h / p), 7), x, y, p);
    },
    panel(ctx, x, y, w, h, p) { put(ctx, panelCanvas(Math.round(w / p), Math.round(h / p), 5), x, y, p); },
    pointer(ctx, x, y, p) {
      const rows = ['ooooooo', 'oBBBbdo', '.obbdo.', '..odo..', '...o...'], m = { o: RAMP.brass[0], B: RAMP.brass[6], b: RAMP.brass[4], d: RAMP.brass[2] };
      rows.forEach((r, ry) => [...r].forEach((ch, rx) => { if (ch === '.') return; ctx.fillStyle = m[ch]; ctx.fillRect(x - 3 * p + rx * p, y + ry * p, p, p); }));
    },
    twinkle(ctx, x, y, p, frame) {
      const F = [['..B..'], ['.bBb.'], ['bBnBb'], ['.dbd.']][frame % 4], m = { B: RAMP.brass[6], b: RAMP.brass[4], d: RAMP.brass[2], n: RAMP.brass[7] };
      const rows = frame % 4 === 2 ? ['..b..', '..B..', 'bBnBb', '..B..', '..b..'] : frame % 4 === 1 ? ['.....', '..b..', '.bBb.', '..b..', '.....'] : frame % 4 === 0 ? ['.....', '.....', '..B..', '.....', '.....'] : ['.....', '..d..', '.dbd.', '..d..', '.....'];
      rows.forEach((r, ry) => [...r].forEach((ch, rx) => { if (ch === '.') return; ctx.fillStyle = m[ch]; ctx.fillRect(x - 2 * p + rx * p, y - 2 * p + ry * p, p, p); }));
    },
  };
  root.SpillUIArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
