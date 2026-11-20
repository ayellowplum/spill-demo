// Masonry, laid stone by stone instead of stamped from a repeating grid.
//
// Every wall cell is given the id of the stone it belongs to, plus that
// stone's tone. The renderer draws mortar only where neighbouring cells
// belong to different stones, lights each stone's top-left edge and shades
// its underside. Layout rules follow how real walls are built:
//   - walls: courses of varying height, stones of varying width, joints
//     staggered so no two vertical joints line up course to course
//   - back wall: larger ashlar blocks, laid the same way
//   - windows: wedge-shaped voussoirs fanned around the arch with a larger
//     keystone at the crown, jambs of alternating long and short blocks,
//     a long sill stone, cut-stone mullion and transom
(function (root) {
  'use strict';
  const WALL = 1, BG_WALL = 0, BG_FRAME = 3;

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  function layout(sim) {
    const W = sim.W, H = sim.H, g = sim.g, bg = sim.bg;
    const id = new Int32Array(W * H);
    const tone = new Uint8Array(65536);
    let next = 1;
    const R = rng(7919 + W * 31 + H);
    const newStone = () => { const k = next++; tone[k & 65535] = (R() * 255) | 0; return k; };

    // Lay stones course by course over every cell matching `want`.
    function coursed(want, minH, maxH, minW, maxW) {
      let y = 0, course = 0;
      while (y < H) {
        const ch = minH + Math.floor(R() * (maxH - minH + 1));
        const offset = (course % 2) * Math.floor((minW + maxW) / 4);
        let x = 0;
        while (x < W) {
          // find a run of matching cells in this course's first row
          if (!want(x, y)) { x++; continue; }
          let w = minW + Math.floor(R() * (maxW - minW + 1));
          if (x === 0 || !want(x - 1, y)) w = Math.max(minW, w - offset % w);   // stagger from the run start
          const k = newStone();
          for (let yy = y; yy < Math.min(H, y + ch); yy++)
            for (let xx = x; xx < Math.min(W, x + w); xx++)
              if (want(xx, yy) && !id[yy * W + xx]) id[yy * W + xx] = k;
          x += w;
        }
        // cells in the lower rows of this course that the first row missed
        for (let yy = y + 1; yy < Math.min(H, y + ch); yy++) {
          let xx = 0;
          while (xx < W) {
            if (!want(xx, yy) || id[yy * W + xx]) { xx++; continue; }
            const w = minW + Math.floor(R() * (maxW - minW + 1)), k = newStone();
            for (let y2 = yy; y2 < Math.min(H, y + ch); y2++)
              for (let x2 = xx; x2 < Math.min(W, xx + w); x2++)
                if (want(x2, y2) && !id[y2 * W + x2]) id[y2 * W + x2] = k;
            xx += w;
          }
        }
        y += ch; course++;
      }
    }

    // 1. walls the sand touches: smaller stones, 4-6 tall, 5-13 wide
    coursed((x, y) => g[y * W + x] === WALL, 4, 6, 5, 13);

    // 2. window surrounds, stone by stone
    const winId = new Int32Array(W * H);
    for (const win of sim.windows || []) {
      const r = win.w / 2, cx = win.x + r, cy = win.y + r;       // arch centre and springline
      const nV = 11;                                              // voussoirs across the arch
      const vous = [], jambL = [], jambR = [];
      for (let k = 0; k < nV; k++) vous.push(newStone());
      tone[vous[(nV - 1) / 2] & 65535] = 255;                     // the keystone catches the light
      for (let k = 0; k < 40; k++) { jambL.push(newStone()); jambR.push(newStone()); }
      const sill = [newStone(), newStone()];
      for (let y = win.y - 8; y < win.y + win.h + 7; y++) for (let x = win.x - 11; x < win.x + win.w + 11; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (bg[i] !== BG_FRAME) continue;
        if (y >= win.y + win.h) {                                 // sill: two long stones
          winId[i] = sill[x < cx ? 0 : 1];
        } else if (y < cy && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) >= r - 0.5) {
          // arch ring: fan of wedges; the middle one (keystone) is wider
          const ang = Math.atan2(cy - (y + 0.5), x + 0.5 - cx);  // 0 at right, PI at left
          let k = Math.floor((ang / Math.PI) * nV);
          k = Math.max(0, Math.min(nV - 1, k));
          const mid = (nV - 1) / 2;
          if (Math.abs(k - mid) <= 1) k = Math.round(mid);        // keystone spans three slots
          winId[i] = vous[k];
        } else if (x < win.x || x >= win.x + win.w) {
          // jambs: alternating long (8) and short (5) blocks, offset left/right
          const left = x < cx, dy = y - cy;
          let acc = 0, k = 0;
          while (acc + (k % 2 === (left ? 0 : 1) ? 8 : 5) <= dy) { acc += (k % 2 === (left ? 0 : 1) ? 8 : 5); k++; }
          winId[i] = (left ? jambL : jambR)[Math.min(39, k)];
        } else {
          // mullion and transom inside the opening: cut stone in short lengths
          const k = Math.floor((x + y * 3) / 9);
          winId[i] = 1000000 + win.x * 997 + k;
          tone[winId[i] & 65535] = 150;
        }
      }
    }

    // 3. the back wall: larger ashlar blocks, but not uniform. A few patches
    //    were repaired long ago in small bricks; a few stones have fallen out.
    const patch = new Uint8Array(W * H);
    const nPatch = Math.max(2, Math.round(W * H / 26000));
    for (let k = 0; k < nPatch; k++) {
      const pw = 24 + Math.floor(R() * 40), ph = 18 + Math.floor(R() * 30);
      const px0 = Math.floor(R() * (W - pw)), py0 = Math.floor(R() * (H - ph));
      for (let y = py0; y < py0 + ph; y++) for (let x = px0; x < px0 + pw; x++) {
        // ragged edges, not a rectangle
        const edge = Math.min(x - px0, px0 + pw - 1 - x, y - py0, py0 + ph - 1 - y);
        if (edge > 2 || R() < 0.5) patch[y * W + x] = 1;
      }
    }
    coursed((x, y) => bg[y * W + x] === BG_WALL && patch[y * W + x] === 1, 3, 3, 6, 8);
    coursed((x, y) => bg[y * W + x] === BG_WALL, 6, 14, 10, 28);
    const missing = new Uint8Array(65536);
    for (let k = 1; k < next; k++) if (R() < 0.03) missing[k & 65535] = 1;

    // pack: R,G = stone id (16 bits), B = tone, A = 255 when a stone is present
    const out = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const k = g[i] === WALL ? id[i] : winId[i] || (bg[i] === BG_WALL ? id[i] : 0);
      const kk = k & 65535;
      out[i * 4] = kk & 255; out[i * 4 + 1] = kk >> 8; out[i * 4 + 2] = tone[kk];
      // A: 255 stone, 200 repair brick, 150 a stone that has fallen out
      const isBack = g[i] !== WALL && !winId[i] && bg[i] === BG_WALL;
      out[i * 4 + 3] = !k ? 0 : isBack && patch[i] ? 200 : isBack && missing[kk] ? 150 : 255;
    }
    return out;
  }

  root.SpillStones = { layout };
})(window);
