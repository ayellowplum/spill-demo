// The Keeper: a hooded figure who speaks from the side of the screen.
// Hand-drawn pixel bust (from a ChatGPT reference), animated in code,
// with a mumbling voice and a pixel-font text bar.
(function (root) {
  'use strict';

  // Bust: hood, face void, shoulders and the lantern held low.
  // T trim, I indigo, D deep shade, V violet fold, K void, C cream, M iron, Y amber, O ember
  // Portrait (built with tools/keeper_art.py from a ChatGPT reference):
  // hood with a peak falling back, void face, lantern rim light, brass clasp.
  const BUST = [
    '....................................',
    '.....................dddddd.........',
    '...................ovdiiiddddd......',
    '.................o.ovddiiidddd......',
    '.............ovdddddddddiiidddd.....',
    '...........ovivviiidddddiiiidddd....',
    '..........ovvvvvvvviiddddididddd....',
    '.........ovvvvvvvvvviididdddiddd....',
    '.........ovvviiiiivvviiddddidddd....',
    '........ovvvigglllivvvidddidddd.....',
    '........ovvigKKKKKlivvvididddd......',
    '.......ovvvgKKKKKKKlivviidddd.......',
    '.......ovvgKKKKKKKKKdvvidddd........',
    '.......ovvgKKKKKKKKKdvvviddd........',
    '.......ovvgKKKKKKKKKdivviddd........',
    '......yllgKKKKKKKKKKdivviddid.......',
    '.......ylgKKKwKKKwKKdivviddd........',
    '.......ylvgKKKKKKKKKdvvviddd........',
    '.......ylvgKKKKKKKKKdvvviddd........',
    '.......yllgKKKKKKKKKdvvviddd........',
    '........ylvgKKKKKKKdvvvvidd.........',
    '........yllvgKKKKKdvvlviddd.........',
    '........ylllvggdllllllviddd.........',
    '.......yllllllvvvllllviidid.........',
    '......ylillllllllllvlvidivvd........',
    '......mmillllllllllvviiivvvd........',
    '...mMMmmvlllllllllvvbBiivvvid.......',
    '...oyovvvllllviivvllBbiivvvvd.......',
    '...mmmlvvllllvvivlllviiivvvvid......',
    '..myllmvvlllllvivvllviiiivvvid......',
    '.mMMMMMmvvllllviivlllviiivvvidd.....',
    '.mbBBBbmvvllllvvivlllviiivvvvid.....',
    '.mfmfmfmvvlllllvivvllviiiivvvidd....',
    '.mfmFmfmvvvllllviivllvvidivvvidd....',
    'ymFmFmFmvvvllllviivlllvidivvviddd...',
    'ymfmFmfmlvvvlllviivvllvidiivvvidd...',
    'ymbBBBbmlvvvllllviivllviddivvviddd..',
    'ylmMMMmllvvvllllviivvlvvidivvviddd..',
    'ylvvvllllvvvvlllviiivllviddivvidddd.',
    'ylvvvllllvvivlllviiivllviddivvviddd.',
  ];
  const HEAD_ROWS = 24; // rows that move when he breathes or nods
  const EYE_ROW = 16;
  const PAL = {
    K: '#07050c', d: '#1a1330', i: '#2c2148', v: '#43356a', l: '#62538c', g: '#8a7fa3',
    o: '#c4682a', y: '#f2aa4a', w: '#f6e7b0', b: '#7a5a22', B: '#c99a3e', m: '#28242a',
    M: '#5a5254', f: '#ff9632', F: '#ffecb4',
  };
  const UI = {
    edge: '#06040a', trim: '#8a7fa3', rivet: '#c99a3e', rivetHi: '#f2d48a', bevelHi: '#2a2140',
    bevelLo: '#0a0710', bgTop: 'rgba(18,14,29,0.92)', bgBot: 'rgba(14,11,23,0.92)', text: '#e9dcc0',
    plate: '#1a1428',
  };

  // 3x5 pixel font (M, N, W wider). Lowercase is drawn as uppercase.
  const FONT = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
    D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
    G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
    J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
    P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
    S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
    V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
    Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
    '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'], '2': ['###', '..#', '###', '#..', '###'],
    '3': ['###', '..#', '.##', '..#', '###'], '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '###', '..#', '###'],
    '6': ['###', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'], '8': ['###', '#.#', '###', '#.#', '###'],
    '9': ['###', '#.#', '###', '..#', '###'],
    '.': ['.', '.', '.', '.', '#'], ',': ['.', '.', '.', '#', '#'], "'": ['#', '#', '.', '.', '.'],
    '?': ['##.', '..#', '.#.', '...', '.#.'], '!': ['#', '#', '#', '.', '#'], '-': ['...', '...', '###', '...', '...'],
    ' ': ['..', '..', '..', '..', '..'],
  };
  // Inline input icons, so the Keeper can teach without UI hint text. Keycaps are
  // built from the pixel font: dark outline, lit top and left, a shadowed right
  // side and a deep lower lip, the letter pressed in dark. Mice: a body shaded
  // the same way, the button to use glowing.
  // k outline, h light, f face, s shade, l letter, X the part to press (pulses)
  function keycap(label) {
    const glyphs = [...label].map((c) => FONT[c] || FONT[' ']);
    const lw = glyphs.reduce((w, g) => w + g[0].length + 1, -1), w = Math.max(9, lw + 6), rows = [];
    for (let r = 0; r < 10; r++) {
      let row = '';
      for (let c = 0; c < w; c++) {
        const edgeX = c === 0 || c === w - 1, edgeY = r === 0 || r === 9;
        if ((edgeX && (r === 0 || r === 9)) ) { row += '.'; continue; }
        if (edgeX || edgeY) { row += 'k'; continue; }
        if (r >= 7) { row += 's'; continue; }                                  // the key's deep lower lip
        if (c === w - 2) { row += 's'; continue; }
        if (r === 1 || c === 1) { row += 'h'; continue; }
        row += 'f';
      }
      rows.push(row);
    }
    let x = Math.floor((w - lw) / 2);
    for (const g of glyphs) {
      for (let r = 0; r < 5; r++) for (let c = 0; c < g[0].length; c++) if (g[r][c] === '#') { const R = rows[r + 1]; rows[r + 1] = R.slice(0, x + c) + 'l' + R.slice(x + c + 1); }
      x += g[0].length + 1;
    }
    return rows;
  }
  const MOUSE = (btn) => {
    const b = ['..kkkkk..', '.kLLkRRk.', 'kLLLkRRRk', 'kLLLkRRRk', 'kkkkkkkkk', 'khffffffk', 'khffffssk', 'khffffssk', 'kffffsssk', '.kffsssk.', '..kkkkk..'];
    return b.map((r) => r.replace(/L/g, btn === 'L' ? 'X' : 'f').replace(/R/g, btn === 'R' ? 'X' : 'f'));
  };
  const ICONS = {
    L: MOUSE('L'), R: MOUSE('R'),
    SPACE: keycap('SPACE'), ENTER: keycap('ENTER'),
    F: keycap('F'), Q: keycap('Q'), X: keycap('X'), W: keycap('W'), A: keycap('A'), S: keycap('S'), D: keycap('D'), M: MOUSE('M'),
  };

  // Split a line into tokens: plain characters or {ICON} tokens.
  function tokens(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') { const j = text.indexOf('}', i); out.push({ icon: text.slice(i + 1, j) }); i = j; }
      else out.push({ ch: text[i] });
    }
    return out;
  }
  const tokW = (t) => t.icon ? ICONS[t.icon][0].length + 2 : root.SpillFonts.advance('body', t.ch);
  const ICON_COL = { k: '#120e18', h: '#fbf2de', f: '#d9cbb3', s: '#8d8070', l: '#2a2018', '#': '#d9cbb3' };

  class Keeper {
    constructor(audio) {
      this.audio = audio;
      this.beats = [];
      this.done = new Set();
      this.queue = [];
      this.line = null;   // { toks, shown, hold }
      this.show = 0;      // 0..1 slide-in
      this.talkT = 0;
      this.blinkT = 3;
      this.seed = 1;
      // the game sets canSpeak(sim): true only at a safe moment (shop, result, room entry before the
      // player acts). Story lines wait for it; tutor lines (tutor: true) never do.
      this.canSpeak = null;
      this.nextBtn = null; // the skip arrow's hitbox, valid only while a line is drawn
    }
    setBeats(beats) { this.beats = beats || []; this.done.clear(); this.queue.length = 0; this.line = null; this.nextBtn = null; }
    // true while a story (non-tutor) line is showing: the game holds the sim still
    get holdsSim() { return !!this.line && !this.line.tutor; }
    safeFor(sim, item) {
      const tutor = !!(item && typeof item === 'object' && item.tutor);
      return tutor || !this.canSpeak || this.canSpeak(sim);
    }
    // Called every sim step.
    update(sim, dt) {
      for (const b of this.beats) {
        if (this.done.has(b.id) || this.queue.length || this.line) continue;
        if (b.after && !b.after.every((id) => this.done.has(id))) continue;
        if (!this.safeFor(sim, null)) continue;                       // story beats only at a safe moment
        if (b.when(sim)) { this.done.add(b.id); this.queue.push(...b.lines); }
      }
      // a story line that missed its safe moment is dropped, so it can never block a lesson
      if (this.queue.length) this.queue = this.queue.filter((q) => this.safeFor(sim, q));
      // wait (briefly) for the player's first click so his voice is heard
      const audioReady = !this.audio.ready || this.audio.ready() || sim.frame > 900;
      if (!this.line && this.queue.length && audioReady) {
        const next = this.queue.shift();
        const obj = next && typeof next === 'object' ? next : { text: next };
        this.line = { toks: tokens(typeof obj.text === 'function' ? obj.text(sim) : obj.text), shown: 0, hold: 0, tutor: !!obj.tutor, until: obj.until };
      }
      const active = !!this.line;
      this.show += ((active ? 1 : 0) - this.show) * 0.12;
      if (this.line) {
        const L = this.line;
        if (L.shown < L.toks.length) {
          L.shown += 0.55; // characters per step (~33/s)
          const t = L.toks[Math.floor(L.shown) - 1];
          if (t && t.ch && /[A-Za-z]/.test(t.ch)) {
            const idx = Math.floor(L.shown) - 1, prev = L.toks[idx - 1];
            const wordStart = !prev || prev.ch === ' ';
            if (wordStart || idx % 3 === 0) { this.audio.voice(t.ch, wordStart); this.talkT = 0.16; }
          }
        } else if (L.until ? L.until() : (L.hold += dt) > 2.4 + L.toks.length * 0.03) this.line = null;
      }
      this.talkT = Math.max(0, this.talkT - dt);
      this.blinkT -= dt;
      if (this.blinkT < -0.12) this.blinkT = 2.5 + Math.random() * 3;
    }
    // Dismiss the line on screen, whatever its state (typing, held, or waiting on a tutor `until`).
    skip() {
      if (!this.line) return false;
      this.line = null;
      this.nextBtn = null;
      return true;
    }

    // ---------- drawing (2D HUD canvas, pixel grid) ----------
    blit(hx, rows, x, y, p, map) {
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
        const col = map(rows[r][c], r, c);
        if (!col) continue;
        hx.fillStyle = col; hx.fillRect(x + c * p, y + r * p, p, p);
      }
    }
    // The castle frame (uiart.js): solid ink, one light line, chamfered corners, an arch crest.
    panel(hx, x, y, w, h, p, o) {
      if (root.SpillUIArt && root.SpillUIArt.castleFrame) { root.SpillUIArt.castleFrame(hx, x, y, w, h, p, o); return; }
      hx.fillStyle = '#100d16'; hx.fillRect(x, y, w, h);
      hx.fillStyle = '#c8bca2'; hx.fillRect(x, y, w, p); hx.fillRect(x, y + h - p, w, p); hx.fillRect(x, y, p, h); hx.fillRect(x + w - p, y, p, h);
    }
    text(hx, str, x, y, p, col) {
      for (const ch of str) {
        const g = FONT[ch] || FONT[' '];
        this.blit(hx, g, x, y, p, (c) => (c === '#' ? col : null));
        x += (g[0].length + 1) * p;
      }
    }
    draw(hx, W, H, s, t) {
      if (this.show < 0.02) { this.nextBtn = null; return; }   // no hitbox left over from an old line
      const a = this.show;
      const p = s;                                  // UI pixel = world pixel
      const pp = Math.max(2, Math.round(s * 1.5));  // portrait pixel size
      const bw = BUST[0].length * pp, bh = BUST.length * pp;
      const margin = 6 * p;
      // the portrait window shows the bust from the chest up
      const winW = bw + 4 * p, winH = Math.round(bh * 0.86 / p) * p + 4 * p;
      const slide = Math.round(((1 - a) * -(winW + margin * 2)) / p) * p;
      const wx = margin + slide, wy = H - winH - margin;
      hx.globalAlpha = Math.min(1, a * 1.4);

      // ---- portrait window ----
      this.panel(hx, wx, wy, winW, winH, p, { plain: true });
      hx.save();
      hx.beginPath(); hx.rect(wx + 2 * p, wy + 2 * p, winW - 4 * p, winH - 4 * p); hx.clip();
      const bx = wx + 2 * p, by = wy + 2 * p + Math.round(4 * pp / p) * p;
      const breathe = Math.sin(t * 1.6) > 0.55 ? pp : 0;
      const nod = this.talkT > 0.08 ? pp : 0;
      const blink = this.blinkT < 0;
      const talking = this.talkT > 0;
      const flick = 0.8 + 0.2 * Math.sin(t * 17) * Math.sin(t * 5.3);
      const warm = (hex, k) => {
        const n = parseInt(hex.slice(1), 16);
        const r = Math.min(255, ((n >> 16) & 255) * k) | 0, g = Math.min(255, ((n >> 8) & 255) * k) | 0, b = Math.min(255, (n & 255) * k) | 0;
        return `rgb(${r},${g},${b})`;
      };
      const map = (rowOff) => (ch, r) => {
        if (ch === '.') return null;
        if (ch === 'w' && r + rowOff === EYE_ROW) return blink ? PAL.K : talking ? '#fffbe6' : PAL.w;
        if (ch === 'f' || ch === 'F' || ch === 'o' || ch === 'y') return warm(PAL[ch], flick + (ch === 'F' ? 0.1 : 0));
        return PAL[ch];
      };
      this.blit(hx, BUST.slice(HEAD_ROWS), bx, by + HEAD_ROWS * pp, pp, map(HEAD_ROWS));
      this.blit(hx, BUST.slice(0, HEAD_ROWS), bx, by + Math.max(breathe, nod), pp, map(0));
      hx.restore();

      // ---- name plate ----
      const name = 'The Keeper', tp = p;
      const nameW = root.SpillFonts.measure(name, 'title') * tp + 8 * p;
      const tx = wx + winW + 4 * p;
      const plateH = 13 * p;
      this.panel(hx, tx, wy - plateH + 7 * p, nameW, plateH, p, { plain: true });
      root.SpillFonts.draw(hx, name, tx + 4 * p, wy - plateH + 7 * p + 2 * p, 'title', tp);

      // ---- text panel ----
      if (this.line) {
        const maxW = Math.min(W - tx - margin, 160 * p);
        const ty = wy + 10 * p, th = winH - 10 * p;
        this.panel(hx, tx, ty, maxW, th, p, { tone: this.line.tutor ? 'cool' : 'line' });
        const lines = this.wrap(this.line.toks, Math.floor(maxW / p) - 22);
        let shown = this.line.shown;
        // a lesson is spoken in a cooler colour than the story, so you can tell which is which
        const tutor = this.line.tutor;
        let tg = hx, ox = 0, oy = 0;
        if (tutor) {
          const cv = this.tcv || (this.tcv = document.createElement('canvas'));
          if (cv.width < maxW || cv.height < th) { cv.width = maxW; cv.height = th; }
          tg = cv.getContext('2d'); tg.clearRect(0, 0, cv.width, cv.height); tg.globalCompositeOperation = 'source-over'; tg.globalAlpha = 1;
          ox = tx; oy = ty;
        }
        const icons = [];
        const pulse = Math.floor(t * 3) % 2 === 0;
        lines.forEach((ln, li) => {
          let x = tx + 7 * p;
          const y = ty + (6 + li * 12) * p;
          for (const tk of ln) {
            if (shown <= 0) return;
            tg.globalAlpha = Math.min(1, a * 1.4) * Math.min(1, shown); // newest letter fades in
            shown -= 1;
            if (tk.icon) {
              const ic = ICONS[tk.icon];
              const press = (tk.icon === 'SPACE' || tk.icon === 'ENTER') && pulse ? p : 0;
              const drawIc = () => this.blit(hx, ic, x0i, y0i, p, (ch) => ICON_COL[ch] || (ch === 'X' ? (pulse ? '#ffcf5a' : '#b0802e') : null));
              const x0i = x, y0i = y + (9 - ic.length) * p + press;
              if (tutor) icons.push(drawIc); else drawIc();
              x += tokW(tk) * p;
            } else x += root.SpillFonts.drawChar(tg, tk.ch, x - ox, y - oy, 'body', p);
          }
        });
        if (tutor) {
          // paint the letters blue but keep the icons their own colours: tint only cream text pixels
          const d = tg.getImageData(0, 0, maxW, th), px = d.data;
          for (let i = 0; i < px.length; i += 4) if (px[i + 3]) { const k = px[i] / 255; px[i] = Math.round(112 * k + 14); px[i + 1] = Math.round(190 * k + 12); px[i + 2] = Math.round(238 * k + 10); }
          tg.putImageData(d, 0, 0);
          hx.drawImage(this.tcv, 0, 0, maxW, th, tx, ty, maxW, th);
          for (const f of icons) f();
        }
        hx.globalAlpha = Math.min(1, a * 1.4);
        // a small "next" button: finishes the line if it is still typing,
        // otherwise moves on. Click it, or press Enter.
        const bw = 18 * p, bh = 14 * p, bx = tx + maxW - bw - 3 * p, by = ty + th - bh - 3 * p;
        this.nextBtn = { x: bx, y: by, w: bw, h: bh };
        const hov = this.mouse && this.mouse.x >= bx && this.mouse.x <= bx + bw && this.mouse.y >= by && this.mouse.y <= by + bh;
        const done = this.line.shown >= this.line.toks.length;
        hx.fillStyle = hov ? '#f2d48a' : done ? '#e4d8be' : 'rgba(228,216,190,0.55)';
        for (const [dx, dy] of [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]]) hx.fillRect(bx + (4 + dx) * p, by + (2 + dy) * p, p, p);
      } else this.nextBtn = null;
      hx.globalAlpha = 1;
    }
    wrap(toks, maxCols) {
      const lines = [[]]; let w = 0; let word = []; let ww = 0;
      const flush = () => {
        if (w + ww > maxCols && lines[lines.length - 1].length) { lines.push([]); w = 0; }
        lines[lines.length - 1].push(...word); w += ww; word = []; ww = 0;
      };
      for (const t of toks) {
        word.push(t); ww += tokW(t);
        if (t.ch === ' ') flush();
      }
      flush();
      return lines;
    }
  }

  root.SpillKeeper = Keeper;
})(window);
