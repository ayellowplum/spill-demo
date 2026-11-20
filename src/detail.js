// Wear and life placed by rules that read the level. The rule decides
// *where*; every single piece is then made individually, so no two are the
// same (nothing in nature repeats): each ivy strand has its own colour,
// leafiness and wander, each cobweb its own threads and breaks, each banner
// its own length, tear, fade and sigil, and so on.
// All of it is decoration: drawn, never solid, never in the sand's way.
(function (root) {
  'use strict';
  const WALL = 1, CHAIN = 30, RUBBLE = 32, IVY = 33, WEB = 34, DRIFT = 35, ROOT = 36,
    IVY_YOUNG = 37, IVY_DEAD = 38, RUBBLE_DARK = 39;

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  function decorate(sim) {
    const { W, H, g } = sim;
    const R = rng(W * 7 + H * 13 + 99);
    const between = (a, b) => a + R() * (b - a);
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const empty = (x, y) => x >= 0 && y >= 0 && x < W && y < H && g[y * W + x] === 0;
    const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || g[y * W + x] === WALL;
    const put = (x, y, t) => { if (empty(x, y)) g[y * W + x] = t; };

    // An ivy strand with its own character: colour, how leafy, how far it
    // wanders, whether it hangs (dir 1) or climbs (dir -1).
    function strand(x, y, len, dir) {
      const mat = R() < 0.62 ? IVY : R() < 0.6 ? IVY_YOUNG : IVY_DEAD;
      const leafy = between(0.12, 0.55), wander = between(0.05, 0.28), cluster = R() < 0.4;
      let side = R() < 0.5 ? -1 : 1;
      for (let k = 0; k < len; k++) {
        const yy = y + k * dir;
        if (!empty(x, yy)) break;
        put(x, yy, mat);
        if (R() < leafy) {
          put(x + side, yy, mat);
          if (cluster && R() < 0.5) { put(x + side * 2, yy, mat); put(x + side, yy - dir, mat); }
          side = R() < 0.7 ? -side : side;
        }
        if (R() < wander) x += R() < 0.5 ? -1 : 1;
        if (dir > 0 && k > len * 0.6 && R() < 0.08) break;            // hanging strands thin out
      }
    }

    // 1. ivy under some window sills: a few strands of differing lengths
    for (const w of sim.windows || []) {
      if (R() < 0.3) continue;
      const sillY = w.y + w.h + 5, n = 1 + Math.floor(R() * 4);
      for (let k = 0; k < n; k++) strand(Math.round(w.x - 8 + R() * (w.w + 16)), sillY, Math.floor(between(5, 36)), 1);
    }
    // 1b. climbing ivy beside some windows, uneven in height and density
    for (const w of sim.windows || []) {
      if (R() < 0.5) continue;
      const side = R() < 0.5 ? w.x - Math.floor(between(6, 14)) : w.x + w.w + Math.floor(between(6, 14));
      const baseY = Math.min(H - 2, w.y + w.h + Math.floor(between(25, 70)));
      const strands = 2 + Math.floor(R() * 7);
      for (let k = 0; k < strands; k++) strand(side + Math.floor((R() - 0.5) * 14), baseY - Math.floor(R() * 10), Math.floor(between(12, w.h * 0.9)), -1);
    }
    // 2. ivy from the undersides of ledges, rarely
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (g[(y - 1) * W + x] !== WALL || !empty(x, y)) continue;
      if (R() < 0.009) strand(x, y, Math.floor(between(4, 26)), 1);
    }
    // 3. rubble: little heaps of different sizes against walls, a stray stone elsewhere
    for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++) {
      if (!empty(x, y) || !wall(x, y + 1)) continue;
      const nearWall = wall(x - 1, y) || wall(x + 1, y) || wall(x - 3, y) || wall(x + 3, y);
      if (R() > (nearWall ? 0.2 : 0.012)) continue;
      const size = nearWall ? Math.floor(between(1, 6)) : 1;
      for (let k = 0; k < size; k++) {
        const dx = Math.floor((R() - 0.3) * size), dy = R() < 0.3 && k > 1 ? -1 : 0;
        put(x + dx, y + dy, R() < 0.35 ? RUBBLE_DARK : RUBBLE);
      }
    }
    // 4. cobwebs in some high inside corners: each its own size, threads and breaks
    for (let y = 1; y < H * 0.6; y++) for (let x = 1; x < W - 1; x++) {
      if (!empty(x, y) || !wall(x, y - 1)) continue;
      const leftCorner = wall(x - 1, y), rightCorner = wall(x + 1, y);
      if (!(leftCorner || rightCorner) || R() > 0.14) continue;
      const dir = leftCorner ? 1 : -1, size = Math.floor(between(4, 14));
      if (size > 7 && R() < 0.45) sim.ambient.push({ kind: 'spider', x, y, dir, size, speed: between(0.08, 0.25), phase: R() * 6.28 });
      const angles = [0, 0.35, 0.8, 1.2, 1.5708].filter(() => R() < 0.7);
      const tear = between(0, 0.3);
      for (const a of angles) for (let k = 0; k < size; k++) {
        if (R() < tear * (k / size)) break;                            // threads snap toward the ends
        put(x + Math.round(Math.cos(a) * k) * dir, y + Math.round(Math.sin(a) * k), WEB);
      }
      const arcs = 1 + Math.floor(R() * 3);
      for (let j = 1; j <= arcs; j++) {
        const r = Math.round(size * j / (arcs + 1) + between(-1, 1));
        for (let s = 0; s < 12; s++) {
          if (R() < 0.18) continue;                                    // gaps in the spiral
          const a = s / 11 * 1.5708;
          put(x + Math.round(Math.cos(a) * r) * dir, y + Math.round(Math.sin(a) * r), WEB);
        }
      }
    }
    // 5. old sand pooled in some inside corners: each drift its own slope and length
    for (let y = 2; y < H - 1; y++) for (let x = 2; x < W - 2; x++) {
      if (!empty(x, y) || !wall(x, y + 1)) continue;
      const dir = wall(x - 1, y) ? 1 : wall(x + 1, y) ? -1 : 0;
      if (!dir || R() > 0.25) continue;
      const len = Math.floor(between(3, 16)), slope = between(0.3, 0.85), curve = between(0.6, 1.4);
      for (let k = 0; k < len; k++) {
        const hgt = Math.max(1, Math.round(Math.pow((len - k) / len, curve) * len * slope));
        for (let j = 0; j < hgt; j++) put(x + dir * k, y - j, R() < 0.06 ? RUBBLE_DARK : DRIFT);
      }
    }
    // 6. roots through the ceiling, rare, each with its own thickness and branching
    for (let x = 4; x < W - 4; x++) {
      let y = 1;
      while (y < H && wall(x, y)) y++;
      if (y > 40 || y >= H || R() > 0.022) continue;
      const thick = R() < 0.3, branchy = between(0.02, 0.12);
      const grow = (sx, sy, len, depth) => {
        let cx = sx;
        for (let k = 0; k < len; k++) {
          if (!empty(cx, sy + k)) return;
          put(cx, sy + k, ROOT);
          if (thick && k < len * 0.4) put(cx + 1, sy + k, ROOT);
          if (R() < 0.25) cx += R() < 0.5 ? -1 : 1;
          if (depth < 2 && R() < branchy) grow(cx + (R() < 0.5 ? -1 : 1), sy + k, Math.floor(len * between(0.3, 0.7)), depth + 1);
        }
      };
      grow(x, y, Math.floor(between(4, 24)), 0);
    }
    // 7. broken chains, irregularly spaced, some with a link hanging askew
    for (let x = 30 + Math.floor(R() * 40); x < W - 30; x += Math.floor(between(45, 140))) {
      let y = 1;
      while (y < H && wall(x, y)) y++;
      if (y > 40 || R() < 0.45) continue;
      const len = Math.floor(between(5, 34));
      let cx = x;
      for (let k = 0; k < len; k++) {
        if (!empty(cx, y + k)) break;
        put(cx, y + k, CHAIN);
        if (k === len - 1 && R() < 0.5) put(cx + (R() < 0.5 ? -1 : 1), y + k + 1, CHAIN);   // the last link twisted aside
      }
    }
    // 8. banners of the Keepers, each made individually
    for (let x = 50 + Math.floor(R() * 40); x < W - 60; x += Math.floor(between(90, 220))) {
      let y = 1;
      while (y < H && wall(x, y)) y++;
      if (y > 40 || R() < 0.3) continue;
      const near = (sim.windows || []).some((w) => x > w.x - 30 && x < w.x + w.w + 30);
      if (!near) sim.props.push({ kind: 'banner', x: x - 5, y: y + Math.floor(between(2, 8)), rows: makeBanner(R), phase: R() * 6.28, amp: between(0.5, 1.6) });
    }
    // 9. ambient life, animated in game.js. Each one its own timing.
    //    Moths circling some lanterns:
    for (const p of sim.props) if (p.kind === 'lantern') {
      const n = Math.floor(R() * 3);
      for (let k = 0; k < n; k++) sim.ambient.push({ kind: 'moth', cx: p.x + 3, cy: p.y + 8, rx: between(5, 14), ry: between(3, 9), speed: between(0.7, 1.8), phase: R() * 6.28 });
    }
    //    Water dripping from a few places in the ceiling, each on its own beat:
    const floorBelow = (x, y) => { let yy = y; while (yy < H - 1 && empty(x, yy + 1)) yy++; return yy; };
    for (let k = 0, tries = 0; k < 2 + Math.floor(R() * 3) && tries < 200; tries++) {
      const x = 20 + Math.floor(R() * (W - 40));
      if ((sim.windows || []).some((w) => x > w.x - 14 && x < w.x + w.w + 14)) continue;   // never in front of a window
      let y = 1; while (y < H && wall(x, y)) y++;
      if (y > 60 || y >= H - 2) continue;
      const y1 = floorBelow(x, y);
      if (y1 - y < 30) continue;
      sim.ambient.push({ kind: 'drip', x, y0: y, y1, period: between(3.5, 9), offset: R() * 9 });
      k++;
    }
    sim.terrainVersion++;
  }

  // One banner, its own: width, length, cloth (red, faded, or ash blue),
  // sigil (hourglass, sun, or worn away) and a torn hem that is never the same.
  // Characters are sprite palette slots (see SPRITE_PAL in renderer.js).
  function makeBanner(R) {
    const w = 8 + Math.floor(R() * 4), len = 12 + Math.floor(R() * 10);
    const cloth = [['e', 'f'], ['g', 'h'], ['i', 'j']][R() < 0.55 ? 0 : R() < 0.6 ? 1 : 2];
    const sigil = R() < 0.5 ? 'hourglass' : R() < 0.55 ? 'sun' : 'none';
    const rows = ['1'.repeat(w + 2)];
    const tearStart = len - 2 - Math.floor(R() * 5);
    for (let r = 0; r < len; r++) {
      let row = '.';
      for (let c = 0; c < w; c++) {
        let ch = c === 0 ? cloth[1] : cloth[0];
        if (r >= tearStart && R() < (r - tearStart + 1) / (len - tearStart + 1) * 0.8) ch = '.';   // the torn hem
        if (R() < 0.015) ch = '.';                                                                  // a moth hole
        row += ch;
      }
      rows.push(row + '.');
    }
    // the sigil, placed at a slightly different height on each
    const cy = 3 + Math.floor(R() * 3), cx = 1 + Math.floor(w / 2);
    const set = (x, y) => { const r = rows[y + 1]; if (r && r[x] !== '.' && r[x] !== undefined) rows[y + 1] = r.slice(0, x) + '3' + r.slice(x + 1); };
    if (sigil === 'hourglass') {
      for (let k = -2; k <= 2; k++) { set(cx + k, cy); set(cx + k, cy + 6); }
      set(cx - 1, cy + 1); set(cx + 1, cy + 1); set(cx, cy + 2); set(cx, cy + 3); set(cx, cy + 4); set(cx - 1, cy + 5); set(cx + 1, cy + 5);
    } else if (sigil === 'sun') {
      for (const [dx, dy] of [[0, 0], [-1, 1], [1, 1], [-2, 2], [2, 2], [-1, 3], [1, 3], [0, 4], [0, 2]]) set(cx + dx, cy + dy);
    }
    return rows;
  }

  const api = { decorate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillDetail = api;
})(typeof window !== 'undefined' ? window : globalThis);
