// Spill's type family, drawn pixel by pixel for this game.
//
//  BODY    dialogue and small text. Full upper and lower case with real
//          ascenders/descenders, digits and punctuation. Cream letterforms
//          with a warm lower shade and a crisp ink outline.
//  TITLE   chamber names, the Keeper's name plate, anything important.
//          The capitals with serifs on every straight stem, coloured as
//          engraved brass: lit top edges, banded gold, dark outline, shadow.
//          Drawn at 2x pixel size where it needs to be big.
//  NUM     the HUD and results. Sand-coloured digits with a bright crest,
//          tabular so numbers never jitter as they change.
(function (root) {
  'use strict';

  const CELL = 10; // body glyph cell: row 0 spare, caps rows 1-7, descenders 8-9

  // [top row, ...rows]
  const G = {
    A: [1, '..#..', '.#.#.', '#...#', '#...#', '#####', '#...#', '#...#'],
    B: [1, '####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: [1, '.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    D: [1, '###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
    E: [1, '#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: [1, '#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: [1, '.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    H: [1, '#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: [1, '###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
    J: [1, '..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    K: [1, '#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: [1, '#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: [1, '#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    N: [1, '#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
    O: [1, '.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: [1, '####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: [1, '.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    R: [1, '####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: [1, '.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.'],
    T: [1, '#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: [1, '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: [1, '#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
    W: [1, '#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: [1, '#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: [1, '#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    Z: [1, '#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],

    a: [3, '.###.', '....#', '.####', '#...#', '.####'],
    b: [1, '#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
    c: [3, '.###', '#...', '#...', '#...', '.###'],
    d: [1, '....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
    e: [3, '.###.', '#...#', '#####', '#....', '.###.'],
    f: [1, '..##', '.#..', '####', '.#..', '.#..', '.#..', '.#..'],
    g: [3, '.####', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
    h: [1, '#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'],
    i: [1, '#', '.', '#', '#', '#', '#', '#'],
    j: [1, '..#', '...', '..#', '..#', '..#', '..#', '..#', '#.#', '.#.'],
    k: [1, '#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'],
    l: [1, '#.', '#.', '#.', '#.', '#.', '#.', '.#'],
    m: [3, '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
    n: [3, '####.', '#...#', '#...#', '#...#', '#...#'],
    o: [3, '.###.', '#...#', '#...#', '#...#', '.###.'],
    p: [3, '####.', '#...#', '#...#', '#...#', '####.', '#....', '#....'],
    q: [3, '.####', '#...#', '#...#', '#...#', '.####', '....#', '....#'],
    r: [3, '#.##', '##..', '#...', '#...', '#...'],
    s: [3, '.###', '#...', '.##.', '...#', '###.'],
    t: [1, '.#..', '.#..', '####', '.#..', '.#..', '.#..', '..##'],
    u: [3, '#...#', '#...#', '#...#', '#...#', '.####'],
    v: [3, '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
    w: [3, '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
    x: [3, '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
    y: [3, '#...#', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
    z: [3, '#####', '...#.', '..#..', '.#...', '#####'],

    0: [1, '.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    1: [1, '..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    2: [1, '.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    3: [1, '.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
    4: [1, '...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    5: [1, '#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    6: [1, '.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
    7: [1, '#####', '....#', '...#.', '..#..', '..#..', '.#...', '.#...'],
    8: [1, '.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    9: [1, '.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],

    '.': [7, '#'],
    ',': [6, '.#', '.#', '#.'],
    '!': [1, '#', '#', '#', '#', '#', '.', '#'],
    '?': [1, '.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
    '%': [1, '##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##'],
    "'": [1, '#', '#'],
    '"': [1, '#.#', '#.#'],
    '-': [4, '###'],
    ':': [3, '#', '.', '.', '.', '#'],
    ';': [3, '.#', '..', '..', '..', '.#', '#.'],
    '(': [1, '.#', '#.', '#.', '#.', '#.', '#.', '.#'],
    ')': [1, '#.', '.#', '.#', '.#', '.#', '.#', '#.'],
    '/': [1, '....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
    '+': [3, '..#..', '..#..', '#####', '..#..', '..#..'],
    '·': [4, '#'],
    ' ': [1, '...'],
  };

  // ---------- masks ----------
  function bodyMask(ch) {
    const g = G[ch] || G[ch.toUpperCase()] || G['?'];
    const top = g[0], rows = g.slice(1), w = rows[0].length;
    const m = { w, h: CELL, d: new Uint8Array(w * CELL) };
    rows.forEach((r, i) => { for (let x = 0; x < w; x++) if (r[x] === '#') m.d[(top + i) * w + x] = 1; });
    return m;
  }
  // EPX / Scale2x: doubles a mask while rounding diagonals, so the big
  // letters look drawn rather than blown up.
  function epx(m) {
    const W = m.w, H = m.h, o = { w: W * 2, h: H * 2, d: new Uint8Array(W * H * 4) };
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : m.d[y * W + x]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
      let e1 = P, e2 = P, e3 = P, e4 = P;
      if (C === A && C !== D && A !== B) e1 = A;
      if (A === B && A !== C && B !== D) e2 = B;
      if (D === C && D !== B && C !== A) e3 = C;
      if (B === D && B !== A && D !== C) e4 = D;
      const X = x * 2, Y = y * 2, OW = o.w;
      o.d[Y * OW + X] = e1; o.d[Y * OW + X + 1] = e2; o.d[(Y + 1) * OW + X] = e3; o.d[(Y + 1) * OW + X + 1] = e4;
    }
    return o;
  }

  // ---------- styles: colour a mask into a small canvas (1 unit = 1 pixel) ----------
  // Soft: for menus. No ink outline (that read as arcade); just the letter
  // in warm cream with a faint shadow one pixel down.
  // Hand-inked: between the old retro brass (too loud) and flat pixels (too
  // sharp). Warm, slightly dim colour; each pixel a touch lighter or darker
  // like ink on paper; outer corners softened, inside corners lightly
  // filled; a warm brown shadow instead of black. Still crisp pixels.
  function inked(colour) {
    const base = parseInt(colour.slice(1), 16), R0 = base >> 16, G0 = (base >> 8) & 255, B0 = base & 255;
    return (m) => {
      const P = 1, W = m.w + 3, H = m.h + 3;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      const at = (x, y) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 0 : m.d[y * m.w + x]);
      const hash = (x, y) => { let h = (x * 374761393 + y * 668265263 + m.w * 2246822519) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
      c.fillStyle = 'rgba(24,12,4,0.42)';
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (at(x, y)) c.fillRect(x + P, y + P + 1, 1, 1);
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        if (at(x, y)) {
          const k = 0.92 + hash(x, y) * 0.14;                          // ink variation
          const u = at(x, y - 1), d = at(x, y + 1), l = at(x - 1, y), r = at(x + 1, y);
          const corner = (!u && !l) || (!u && !r) || (!d && !l) || (!d && !r);
          const lone = !u && !d && !l && !r;
          const a = lone ? 1 : corner && (u + d + l + r) <= 1 ? 0.62 : 1; // soften stroke tips
          c.fillStyle = `rgba(${Math.min(255, R0 * k) | 0},${Math.min(255, G0 * k) | 0},${Math.min(255, B0 * k) | 0},${a})`;
          c.fillRect(x + P, y + P, 1, 1);
        } else {
          // fill inside corners faintly, so diagonals feel drawn, not stepped
          const u = at(x, y - 1), d = at(x, y + 1), l = at(x - 1, y), r = at(x + 1, y);
          if ((u && l && at(x - 1, y - 1)) || (u && r && at(x + 1, y - 1)) || (d && l && at(x - 1, y + 1)) || (d && r && at(x + 1, y + 1))) {
            c.fillStyle = `rgba(${R0},${G0},${B0},0.22)`;
            c.fillRect(x + P, y + P, 1, 1);
          }
        }
      }
      return { cv, P, w: m.w };
    };
  }
  const soft = inked('#e4d8be');

  const STYLES = {
    soft,
    cream: soft,
    sand: inked('#dcb978'),
    body(m) {
      return paint(m, 1, (x, y, on, up, dn) => {
        if (!on) return null;
        return dn ? '#c8b493' : '#ece0c4';            // warm lower edge on every stroke end
      }, '#0c0912');
    },
    title(m) {
      // banded brass: light gold top, gold middle, bronze base; lit top edges
      return paint(m, 1, (x, y, on, up) => {
        if (!on) return null;
        if (!up) return '#fff0c0';
        if (y <= 3) return '#f2cf7c';
        if (y <= 5) return '#d2a24a';
        return '#a0722e';
      }, '#140c06', '#000000');
    },
    num(m) {
      // dithered sand, bright crest, darker base
      return paint(m, 1, (x, y, on, up, dn) => {
        if (!on) return null;
        if (!up) return '#fbe2a2';
        if (!dn) return '#b07a32';
        return '#e3b062';
      }, '#120c08', '#000000');
    },
  };
  // paint(mask, pad, colourFn, outline, shadow): outline is 8-neighbour ink;
  // optional 1-pixel drop shadow down-right.
  function paint(m, pad, fn, outline, shadow) {
    const P = pad + 1, W = m.w + P * 2, H = m.h + P * 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const at = (x, y) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 0 : m.d[y * m.w + x]);
    if (shadow) {
      c.fillStyle = shadow; c.globalAlpha = 0.55;
      for (let y = -1; y <= m.h; y++) for (let x = -1; x <= m.w; x++) {
        let near = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near |= at(x + dx, y + dy);
        if (near) c.fillRect(x + P + 1, y + P + 1, 1, 1);
      }
      c.globalAlpha = 1;
    }
    if (outline) {
      c.fillStyle = outline;
      for (let y = -1; y <= m.h; y++) for (let x = -1; x <= m.w; x++) {
        if (at(x, y)) continue;
        let near = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near |= at(x + dx, y + dy);
        if (near) c.fillRect(x + P, y + P, 1, 1);
      }
    }
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const col = fn(x, y, at(x, y), at(x, y - 1), at(x, y + 1));
      if (!col) continue;
      c.fillStyle = col; c.fillRect(x + P, y + P, 1, 1);
    }
    return { cv, P, w: m.w };
  }

  // Display serifs: widen the glyph by one pixel each side, then put a foot
  // on every stem end (top and bottom of vertical strokes).
  function serifMask(ch) {
    const b = bodyMask(ch.toUpperCase());
    const w = b.w + 2, m = { w, h: b.h, d: new Uint8Array(w * b.h) };
    const at = (x, y) => (x < 0 || y < 0 || x >= b.w || y >= b.h ? 0 : b.d[y * b.w + x]);
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (at(x, y)) m.d[y * w + x + 1] = 1;
    if (ch === ' ') return m;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      if (!at(x, y)) continue;
      // only on straight stems at least 3 pixels tall, never on curves
      const stemTop = !at(x, y - 1) && at(x, y + 1) && at(x, y + 2) && !at(x - 1, y) && !at(x + 1, y) && !at(x - 1, y + 1) && !at(x + 1, y + 1);
      const stemBot = !at(x, y + 1) && at(x, y - 1) && at(x, y - 2) && !at(x - 1, y) && !at(x + 1, y) && !at(x - 1, y - 1) && !at(x + 1, y - 1);
      if (stemTop || stemBot) { m.d[y * w + x] = 1; m.d[y * w + x + 2] = 1; }
    }
    return m;
  }

  const FONTS = {
    body: { mask: bodyMask, gap: 1, space: 3, style: 'cream', h: CELL },
    soft: { mask: bodyMask, gap: 1, space: 3, style: 'soft', h: CELL },
    wide: { mask: bodyMask, gap: 3, space: 6, style: 'soft', h: CELL },   // tracked, for headings
    // crisp, hand-placed pixels only: no smoothing filters (they read as AI-made)
    // tracked capitals (no added serifs: they read oddly at this size)
    title: { mask: bodyMask, gap: 2, space: 5, style: 'cream', h: CELL },
    num: { mask: (ch) => bodyMask(ch), gap: 1, space: 3, style: 'sand', h: CELL, tabular: 5 },
  };
  const cache = new Map();
  function glyph(font, ch) {
    const key = font + '|' + ch;
    let g = cache.get(key);
    if (!g) { const F = FONTS[font]; g = STYLES[F.style](F.mask(ch)); cache.set(key, g); cache.set(key, g); }
    return g;
  }
  function advance(font, ch) {
    const F = FONTS[font];
    if (ch === ' ') return F.space;
    if (F.tabular && /[0-9]/.test(ch)) return F.tabular + F.gap;
    return glyph(font, ch).w + F.gap;
  }

  const api = {
    // width in font pixels
    measure(text, font) { let w = 0; for (const ch of text) w += advance(font, ch); return w - FONTS[font].gap; },
    height(font) { return FONTS[font].h; },
    advance,
    // draw a single character at pixel size p; returns its advance in screen px
    drawChar(ctx, ch, x, y, font, p) {
      const a = advance(font, ch);
      if (ch !== ' ') {
        const g = glyph(font, ch);
        const ox = FONTS[font].tabular && /[0-9]/.test(ch) ? Math.floor((FONTS[font].tabular - g.w) / 2) : 0;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(g.cv, Math.round(x + (ox - g.P) * p), Math.round(y - g.P * p), g.cv.width * p, g.cv.height * p);
      }
      return a * p;
    },
    draw(ctx, text, x, y, font, p, align) {
      if (align === 'center') x -= (api.measure(text, font) * p) / 2;
      else if (align === 'right') x -= api.measure(text, font) * p;
      for (const ch of text) x += api.drawChar(ctx, ch, x, y, font, p);
    },
  };
  root.SpillFonts = api;
})(window);
