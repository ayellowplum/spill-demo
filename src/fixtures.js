// FIXTURES: the terrain-building primitives (rect, circle, spikes, erode, stillPile), moved out of Sim (migration step 5b, MATERIAL_MODEL 4.1).
// A room's build(s) receives terrain(sim): a view of the sim that also offers these primitives, so every existing room builder and test fixture keeps
// working unchanged and nothing else can build terrain from primitives. Runtime code that needs a heap of still sand calls stillPile(sim, ...).
// The code of each primitive is the code that used to be a Sim method, verbatim (`this` is the sim). Rooms become authored data in later steps; then this file
// is only for tests.
(function (root) {
  'use strict';
  const MAT = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) ? require('./materials.js') : root.SpillMaterials;
  const T = MAT.IDS;
  function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }


  const M = {
    rect(x, y, w, h, t) {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, t);
    },
    circle(cx, cy, r, t) {
      for (let yy = Math.floor(cy - r); yy <= cy + r; yy++)
        for (let xx = Math.floor(cx - r); xx <= cx + r; xx++)
          if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) this.set(xx, yy, t);
    },
    // Triangular teeth, points up, base on row y+h-1.
    spikes(x, y, w, h) {
      const period = 8;
      for (let xx = x; xx < x + w; xx++) {
        const p = Math.abs(((xx - x) % period) - (period - 1) / 2) / ((period - 1) / 2); // 0 at tip, 1 at edge
        const th = Math.max(1, Math.round(h * (1 - p * 0.85)));
        for (let yy = y + h - th; yy < y + h; yy++) this.set(xx, yy, T.SPIKE);
      }
    },
    // A heap of still sand (someone else's time): a cone resting on y+h.
    // A heap of still sand (someone else's time), shaped like real settled
    // sand: a rounded crown, slopes that sag outward, a spread-out foot, a
    // slightly lopsided lean, and an uneven surface. Never a clean triangle.
    stillPile(cx, baseY, halfW, h) {
      const lean = ((cx * 37 + baseY * 11) % 7 - 3) * 0.6;
      for (let x = cx - halfW - 2; x <= cx + halfW + 2; x++) {
        const t = Math.min(1, Math.abs(x - cx - lean) / (halfW + 1));
        const profile = Math.pow(1 - t * t, 1.4);                    // rounded top, sagging sides
        const bump = (((x * 73856093) ^ (baseY * 19349663)) >>> 0) % 3 === 0 ? 1 : 0;
        const height = Math.max(t < 1 ? 1 : 0, Math.round(h * profile + (t < 0.8 ? bump : 0)));
        for (let y = baseY - height; y < baseY; y++) if (this.inb(x, y) && this.g[y * this.W + x] === 0) this.g[y * this.W + x] = T.STILL;
      }
    },
    // Chip away exposed brick edges so masonry reads as old and broken.
    // `keep` rects are protected (gameplay-critical surfaces).
    erode(amount, keep) {
      const { W, H, g } = this;
      const kill = [];
      const kept = (x, y) => keep && keep.some((k) => x >= k[0] && y >= k[1] && x < k[0] + k[2] && y < k[1] + k[3]);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (g[i] !== T.WALL) continue;
        const open = (g[i - 1] === 0) + (g[i + 1] === 0) + (g[i - W] === 0) + (g[i + W] === 0);
        if (!open || kept(x, y)) continue;
        // chunky: decide per 2x2 block so chips are not single noisy pixels
        if (hash2(x >> 1, y >> 1) < amount * open) kill.push(i);
      }
      for (const i of kill) g[i] = 0;
    },
  };
  // terrain(sim): what level.build receives. The five primitives run on the real sim; every other read, call and assignment is forwarded to it.
  function terrain(sim) {
    const own = {}; for (const k of Object.keys(M)) own[k] = (...a) => M[k].apply(sim, a);
    return new Proxy(sim, {
      get: (t, k) => (Object.prototype.hasOwnProperty.call(own, k) ? own[k] : t[k]),
      set: (t, k, v) => { t[k] = v; return true; },
    });
  }
  const api = { terrain, hash2 };
  for (const k of Object.keys(M)) api[k] = (sim, ...a) => M[k].apply(sim, a);       // F.rect(sim, x, y, w, h, t), F.stillPile(sim, cx, baseY, halfW, h), ...
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SpillFixtures = api;
})(typeof window !== 'undefined' ? window : globalThis);
