// SPILL interactive decorations (boss room, first set): banners, braziers, chains.
// Spec: PLAN_STORY_WORLD.md 11b. Each object answers sand one clear way, with at most two states,
// within a second of contact; none sits in the Sieve's attack lanes (the floor's bite sections and
// sweep, the eyes' platforms) and none can hurt you. No text.
//
// What it reads from the sim (read only): the grain-at-cell grid (sim.pid: -1 or a grain's index)
// and each grain's velocity (sim.vx / sim.vy). What it writes: only terrain cells that make an object
// physical where the spec asks for it (a torn banner's heap and the chains are climbable; a brazier's
// bowl can hold sand), always into empty cells with no grain in them, bumping sim.terrainVersion.
// Everything else is drawing (sprites with `top`, so cloth and iron paint over those cells) and
// one warm light per lit brazier.
(function (root) {
  'use strict';
  const WALL = 1;

  // ---------- art (hand-drawn; palette chars as in the renderer: 1 iron dark, 2 iron, 3 brass,
  // 4 brass lit, 6/7/8 flame, 9 chain, e/f red cloth, g/h faded cloth, u void) ----------
  const HEAP = [                       // a fallen banner, crumpled on the ledge: folds, the brass eye showing in one
    '....effe.....',
    '..eeffeefe...',
    '.efe343eeffe.',
    'effeeeeefeefe',
    'eeeeeeeeeeeee',
  ];
  const STUB = ['.f.f.e.f.f.e.', '..e...f...e..'];   // what is left on the rail once it has torn
  const BOWL = [                       // a wall brazier: an iron bowl with a brass lip on a bracket into the wall
    '3.........3',
    '23.......32',
    '.2222222222',
    '..1222221..',
    '....121....',
    '....1.1....',
    '...1...1...',
  ];
  const BOWL_SOLID = [                 // which of the bowl's cells hold sand (its rim and floor): sand can fill it
    'X.........X',
    'XX.......XX',
    '.XXXXXXXXX.',
  ];
  const LINK = ['.4.', '3.3', '3.3', '.3.', '121', '121'];   // a chain: a brass ring seen face-on (lit at its top), then an iron link edge-on with dark sides, repeating
  const LOOSE = ['1222221', '12.2.21', '1222221'];     // a cracked stone at a chain's anchor, ready to fall
  const HOLE = ['1uuuuu1', '.1uuu1.'];

  function create(sim, deps) {
    const W = sim.W, H = sim.H;
    const D = deps || {};
    const vfx = () => (D.fx ? D.fx() : null);
    const snd = D.audio || {};
    const shake = D.shake || (() => {});
    const groundBelow = (x, y) => { for (let yy = y; yy < H; yy++) if (sim.terrainSolid(x, yy)) return yy - 1; return H - 1; };
    const quiet = D.quiet || (() => false);   // the room's opening pour, a death, a regather, a cutscene: objects do not count that sand
    const grainAt = (x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? sim.pid[y * W + x] : -1;
    const speed = (i) => Math.hypot(sim.vx[i] || 0, sim.vy[i] || 0);
    const placeCell = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const k = y * W + x; if (sim.g[k] !== 0 || sim.pid[k] >= 0) return false; sim.g[k] = WALL; return true; };
    const clearCell = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const k = y * W + x; if (sim.g[k] === WALL) sim.g[k] = 0; };
    let dirty = false;
    // Movement is read from occupancy, not from grain velocity (a grain resting on a pile can keep a
    // stale speed): a cell that holds a grain now but did not last frame is sand arriving; a cell that
    // held one both frames is sand lying there.
    const prevOcc = new Map();
    function region(key, x0, y0, x1, y1) {
      const w = x1 - x0 + 1, h = y1 - y0 + 1, prev = prevOcc.get(key), now = new Uint8Array(w * h);
      let n = 0, fresh = 0, steady = 0, vx = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = grainAt(x, y); if (i < 0) continue;
        const k = (y - y0) * w + (x - x0); now[k] = 1; n++;
        if (prev && prev.length === now.length && prev[k]) steady++; else { fresh++; vx += sim.vx[i] || 0; }
      }
      prevOcc.set(key, now);
      return { n, fresh, steady, vx };
    }

    // ---------- BANNERS ----------
    // Contact rule: grains arriving in the cloth's rectangle this frame (cells newly filled) are its load. Any load dips it at
    // once (the cloth sags under the landing and swings away from it). Load builds a tear meter that
    // drains when the cloth is clear; past the line it tears at the rail, falls, and lies on the
    // ledge as a heap of cloth you can climb. States: hanging / torn.
    const banners = (D.banners || []).map((b) => ({ ...b, dip: 0, swing: 0, sv: 0, meter: 0, torn: false, fallT: -1, heapY: 0, heapCells: [] }));
    // the heap rests on whatever is under it (stone or sand); as sand slips from under it, it settles down
    const restBelow = (x, y) => { for (let yy = y; yy < H; yy++) for (let dx = -5; dx <= 5; dx++) if (sim.terrainSolid(x + dx, yy) || grainAt(x + dx, yy) >= 0) return yy - 1; return H - 1; };
    function layHeap(b) {
      for (const [x, y] of b.heapCells) clearCell(x, y);
      b.heapCells = [];
      HEAP.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '.') return; const x = b.x - 6 + c, y = b.heapY - HEAP.length + 1 + r; if (placeCell(x, y)) b.heapCells.push([x, y]); }));
      dirty = true;
    }
    function settleHeap(b) {
      if ((b.settleT = (b.settleT || 0) + 1) % 4) return;
      const own = new Set(b.heapCells.map(([x, y]) => x + ',' + y));
      for (let c = 0; c < 13; c++) { const x = b.x - 6 + c, y = b.heapY + 1; if (own.has(x + ',' + y)) continue; if (sim.terrainSolid(x, y) || grainAt(x, y) >= 0) return; }   // something still holds it up
      b.heapY++; layHeap(b);
    }
    function stepBanner(b, t) {
      if (b.torn) {
        if (b.fallT >= 0) {
          b.fallT++;
          if (b.fallT === b.fallDur) {
            // it lands: the heap is laid (only into empty, grain-free cells), dust, a soft thump
            b.heapY = restBelow(b.x, b.top + b.len); layHeap(b);
            dirty = true;
            const F = vfx(); if (F) for (let k = 0; k < 7; k++) { const a = -Math.PI * (0.15 + 0.7 * k / 6); F.spark(b.x, b.heapY - 2, Math.cos(a) * 1.2, Math.sin(a) * 0.9, 'dust', 18, { l0: 3, g: 0.08, len: 0.4 }); }
            if (snd.impact) snd.impact(0.3); shake(1.5);
            b.fallT = -1;
          }
        }
        else settleHeap(b);
        return;
      }
      let load = 0, side = 0;
      { const R0 = region('b' + b.x, b.x - 8, b.top, b.x + 8, b.top + b.len); if (!quiet()) { load = R0.fresh; side = R0.vx; } }   // only sand arriving on the cloth, never a pile resting under its hem
      b.dip += (Math.min(6, 1.5 + load * 0.6) * (load ? 1 : 0) - b.dip) * (load ? 0.6 : 0.08);   // sags at once under even a light landing, rises slowly
      b.sv += (load ? side * 0.004 : 0) - b.swing * 0.02; b.sv *= 0.94; b.swing = Math.max(-5, Math.min(5, b.swing + b.sv));   // the landing pushes it, it swings back
      b.meter = load ? b.meter + load : Math.max(0, b.meter - 4);
      if (b.meter > b.tearAt) {
        b.torn = true; b.fallT = 0; b.heapY = restBelow(b.x, b.top + b.len); b.fallDur = Math.max(8, Math.round(Math.sqrt(2 * (b.heapY - b.top - 6) / 0.35)));
        if (snd.glance) snd.glance(); if (snd.breathe) snd.breathe(true);
        const F = vfx(); if (F) for (let k = 0; k < 5; k++) F.spark(b.x - 5 + k * 2.5, b.top + 2, (k - 2) * 0.3, -0.4, 'dust', 14, { l0: 3, g: 0.1, len: 0.4 });
      }
    }
    function bannerSprites(b, t) {
      const out = [];
      if (!b.torn) {
        const ph = Math.sin(t * (0.5 + b.amp * 0.2) + b.ph) * b.amp + b.swing;
        let yAdd = 0;
        b.rows.forEach((row, r) => {
          const sh = r > 8 ? Math.round(ph * (r - 8) / 14) : 0;
          const want = Math.round(b.dip * Math.max(0, (r - 10) / (b.rows.length - 10)) ** 2);   // the lower cloth sags under the load
          while (yAdd < want) { out.push({ x: b.x - 6 + sh, y: b.top - 2 + r + yAdd, rows: [row], top: true }); yAdd++; }   // (stretched rows repeat: no gaps)
          out.push({ x: b.x - 6 + sh, y: b.top - 2 + r + yAdd, rows: [row], top: true });
        });
        return out;
      }
      out.push({ x: b.x - 6, y: b.top - 2, rows: b.rows.slice(0, 2), top: true }, { x: b.x - 6, y: b.top, rows: STUB, top: true });
      if (b.fallT >= 0) {
        // falling: the cloth drops, crumpling as it goes (rows fold away), a little turn in the air
        const u = b.fallT / b.fallDur, y = b.top + 2 + (b.heapY - b.top - 6) * u * u, keep = Math.max(4, Math.round((b.rows.length - 2) * (1 - 0.8 * u)));
        const body = b.rows.slice(2), step = body.length / keep;
        for (let k = 0; k < keep; k++) out.push({ x: b.x - 6 + Math.round(Math.sin(u * 3 + k * 0.3) * 1.5), y: Math.round(y) + k, rows: [body[Math.floor(k * step)]], top: true });
      } else out.push({ x: b.x - 6, y: b.heapY - HEAP.length + 1, rows: HEAP, top: true });
      return out;
    }

    // ---------- BRAZIERS ----------
    // Contact rules: (gutter) three or more grains arriving in the flame's box in one frame (a flow
    // through it): the flame bends away from the flow, shrinks and sputters, and its light dims for
    // ~0.7 s. (snuff) five or more grains lying still in the bowl: it goes out with a curl of smoke and
    // its light dies. It rekindles on its own once the bowl has been empty for 4 s. States: lit / out.
    // The bowl's rim and floor are solid (sand can fill it); sand reaches it by climbing the wall.
    const braziers = (D.braziers || []).map((B0) => ({ ...B0, lit: true, gutter: 0, gdir: 0, outT: 0, clearT: 0, relight: 0, smoke: 0 }));
    for (const B0 of braziers) BOWL_SOLID.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'X' && placeCell(B0.x - 5 + c, B0.y + r)) dirty = true; }));
    function stepBrazier(B0, t) {
      const Fl = region('f' + B0.x, B0.x - 4, B0.y - 9, B0.x + 4, B0.y - 1), Bw = region('w' + B0.x, B0.x - 4, B0.y, B0.x + 4, B0.y + 1);
      const fast = Fl.fresh, flow = Fl.vx, rest = Bw.steady;                       // a flow: grains arriving through the flame; a spill: grains lying in the bowl
      if (B0.lit) {
        if (fast >= 3) { if (B0.gutter < 20 && snd.glance) snd.glance(); B0.gutter = 42; B0.gdir = Math.sign(flow) || B0.gdir || 1; }
        if (B0.gutter > 0) B0.gutter--;
        if (rest >= 5) {
          B0.lit = false; B0.smoke = 120; B0.clearT = 0;
          if (snd.breathe) snd.breathe(false);
          const F = vfx(); if (F) for (let k = 0; k < 3; k++) F.smoke(B0.x - 2 + k * 2, B0.y - 3, 1.6, 40, { vy: -0.25, vx: (k - 1) * 0.1 });
        }
        if (B0.relight > 0) B0.relight--;
      } else {
        if (B0.smoke > 0) B0.smoke--;
        B0.clearT = rest ? 0 : B0.clearT + 1;
        if (B0.clearT > 240) { B0.lit = true; B0.relight = 24; B0.gutter = 0; if (snd.chime) snd.chime(0.2); }
      }
    }
    function brazierSprites(B0, t) {
      const out = [{ x: B0.x - 5, y: B0.y, rows: BOWL, top: true }];
      if (!B0.lit) {
        // out: a dark coal or two, and a thin smoke curl that thins away
        out.push({ x: B0.x - 2, y: B0.y - 1, rows: ['.1.21'], top: true });
        if (B0.smoke > 0) for (let k = 0; k < 7; k++) { if ((k + (t * 6 | 0)) % 3 === 0 && B0.smoke < 60) continue; const yy = B0.y - 2 - k * 2, xx = B0.x + Math.round(Math.sin(t * 2 + k * 0.9) * (1 + k * 0.3)); out.push({ x: xx, y: yy, rows: ['l'] }); }
        return out;
      }
      // lit: tongues of flame, each on its own clock; guttering bends them away from the flow, low and ragged
      const g = B0.gutter / 42, grow = B0.relight > 0 ? 1 - B0.relight / 24 : 1;
      for (let k = 0; k < 9; k++) {
        const mid = 1 - Math.abs(k - 4) / 5;
        let h = 1 + Math.round((2 + 5 * mid) * (0.7 + 0.3 * Math.sin(t * (6 + k * 1.3 + B0.s) + k * 2.1 + B0.s)) * grow);
        if (g > 0) h = Math.max(1, Math.round(h * (0.35 + 0.25 * Math.sin(t * 30 + k))));   // sputtering low
        for (let q = 0; q < h; q++) { const lean = g > 0 ? Math.round(-B0.gdir * q * 0.7 * g) : 0; out.push({ x: B0.x - 4 + k + lean, y: B0.y - 1 - q, rows: [q === 0 ? '8' : q < h - 2 ? '7' : '6'] }); }
      }
      return out;
    }

    // ---------- CHAINS ----------
    // Contact rules: the chain is solid and climbable (sand climbs it like a wall). Load = grains
    // touching it (in the cells either side). A load sets it swinging, pushed by which side carries more
    // and how they move; it swings on as a pendulum and settles when it is clear. A hard swing (the
    // bottom carried 3 cells out) strains its anchor: after a few, the cracked stone above the anchor
    // falls (a harmless drop: dust and rubble on the floor). States: still / swinging.
    const chains = (D.chains || []).map((C) => ({ ...C, a: 0, av: 0, cells: [], strain: 0, maxA: Math.asin(Math.min(1, (C.reach || 3) / ((C.bottom - C.top) * 0.9))), stone: C.stone ? { state: 'set', y: C.top - 3, vy: 0 } : null }));   // reach: how far its foot may swing (kept out of the stones' lanes)
    for (const C of chains) for (let y = C.top; y <= C.bottom; y++) { const k = y * W + C.x; if (sim.g[k] === 30) sim.g[k] = 0; }   // its old painted links give way to the live chain
    const chainX = (C, y, a) => C.x + Math.round(Math.sin(a) * (y - C.top) * 0.9);
    function layChain(C) {
      const want = [];
      for (let y = C.top; y <= C.bottom; y++) want.push([chainX(C, y, C.a), y]);
      const same = want.length === C.cells.length && want.every(([x, y], k) => C.cells[k] && C.cells[k][0] === x);
      if (same) return;
      for (const [x, y] of C.cells) clearCell(x, y);
      C.cells = [];
      for (const [x, y] of want) if (placeCell(x, y)) C.cells.push([x, y]); else C.cells.push([x, y, 'skip']);
      dirty = true;
    }
    for (const C of chains) layChain(C);
    function stepChain(C, t) {
      let load = 0, push = 0;
      for (const [x, y] of C.cells) for (const dx of [-1, 1]) { const i = grainAt(x + dx, y); if (i >= 0) { load++; push += -dx * 0.6 + (sim.vx[i] || 0) * 0.5; } }
      if (load) C.av += (push * 0.0009 + Math.sign(push || 1) * Math.min(load, 20) * 0.00025);
      C.av += -Math.sin(C.a) * 0.0065; C.av *= load ? 0.985 : 0.992;           // a pendulum, a little heavier while laden
      C.a = C.a + C.av; if (Math.abs(C.a) > C.maxA) { C.a = Math.sign(C.a) * C.maxA; C.av *= -0.5; }   // it never swings past its reach (bounces softly off it)
      const amp = Math.abs(Math.sin(C.a) * (C.bottom - C.top) * 0.9);
      if (amp >= (C.reach || 3) - 0.6 && C.stone && C.stone.state === 'set') { C.strain++; if (C.strain % 30 === 1) { const F = vfx(); if (F) F.spark(C.x, C.top - 2, 0, 0.4, 'dust', 16, { l0: 4, g: 0.15, len: 0.3 }); } }
      if (C.stone && C.stone.state === 'set' && C.strain > 90) { C.stone.state = 'fall'; if (snd.glance) snd.glance(); shake(1); }
      if (C.stone && C.stone.state === 'fall') {
        C.stone.vy += 0.3; C.stone.y += C.stone.vy;
        const floor = groundBelow(C.sx, C.bottom + 2);
        if (C.stone.y + 3 >= floor) {
          C.stone.state = 'down';
          const F = vfx(); if (F) for (let k = 0; k < 8; k++) { const a = -Math.PI * (0.1 + 0.8 * k / 7); F.spark(C.sx, floor - 1, Math.cos(a) * 1.6, Math.sin(a) * 1.4, 'dust', 20, { l0: 2, g: 0.2, len: 0.8 }); }
          for (let dx = -2; dx <= 2; dx++) { const k = floor * W + C.sx + dx; if (sim.g[k] === 0 && sim.pid[k] < 0) sim.g[k] = 32; }   // a little rubble (decor: never solid)
          dirty = true; if (snd.impact) snd.impact(0.45); shake(2);
        }
      }
      layChain(C);
    }
    function chainSprites(C, t) {
      const out = [];
      out.push(C.bracket ? { x: C.x - 1, y: C.top - 2, rows: ['.1222', '23443'], top: true } : { x: C.x - 2, y: C.top - 1, rows: ['34443'], top: true });   // its brass anchor (or an iron bracket out of the wall)
      for (let y = C.top; y <= C.bottom; y++) out.push({ x: chainX(C, y, C.a) - 1, y, rows: [LINK[(y - C.top) % LINK.length]], top: true });
      out.push({ x: chainX(C, C.bottom, C.a) - 1, y: C.bottom + 1, rows: ['2.2', '.2.'], top: true });   // a hook at its end
      if (C.stone) {
        if (C.stone.state === 'set') out.push({ x: C.sx - 3, y: C.top - 4 + (C.strain > 60 && (t * 20 | 0) % 2 ? 1 : 0), rows: LOOSE, top: true });
        else {
          out.push({ x: C.sx - 3, y: C.top - 4, rows: HOLE, top: true });                // where it came from
          if (C.stone.state === 'fall') out.push({ x: C.sx - 3, y: Math.round(C.stone.y), rows: LOOSE, top: true });
        }
      }
      return out;
    }

    // ---------- GEARS ----------
    // Contact rule: sand LYING on the gear's upper teeth (cells filled two frames running, within a
    // cell of the rim's top half) is its load. It turns slowly on its own; load slows it in proportion,
    // and 12 grains or more jam it dead. A jam held a second or longer, once the sand slips off, breaks
    // free: the gear lurches round fast and its rod throws the trapdoor in the gallery floor above,
    // opening a shaft you can climb from under the gallery up onto it (once; it stays open).
    // States: turning / jammed. The gear's teeth are solid (sand packs on them).
    const gears = (D.gears || []).map((G0) => ({ ...G0, a: 0, v: 0, jamT: 0, freed: false, lurch: 0, cells: [], open: false }));
    const gearTooth = (G0, k, a) => { const th = a + (k / G0.teeth) * Math.PI * 2; return [G0.x + Math.cos(th) * (G0.r - 0.5), G0.y + Math.sin(th) * (G0.r - 0.5), th]; };
    function layGear(G0) {
      const want = [];
      for (let th = 0; th < Math.PI * 2; th += 0.12) { const x = Math.round(G0.x + Math.cos(th) * (G0.r - 2)), y = Math.round(G0.y + Math.sin(th) * (G0.r - 2)); want.push([x, y]); }   // the rim
      for (let k = 0; k < G0.teeth; k++) { const [x, y] = gearTooth(G0, k, G0.a); want.push([Math.round(x), Math.round(y)]); }               // the teeth, where they are now
      const key = want.map(([x, y]) => x + ',' + y).sort().join(' ');
      if (key === G0.key) return;
      for (const [x, y] of G0.cells) clearCell(x, y);
      G0.cells = []; for (const [x, y] of want) if (placeCell(x, y)) G0.cells.push([x, y]);
      G0.key = key; dirty = true;
    }
    for (const G0 of gears) layGear(G0);
    function stepGear(G0, t) {
      const Rg = region('g' + G0.x + ',' + G0.y, G0.x - G0.r - 1, G0.y - G0.r - 2, G0.x + G0.r + 1, G0.y);   // its upper half and a cell over the teeth
      const load = Rg.steady;
      const base = 0.012;
      if (G0.lurch > 0) { G0.lurch--; G0.v = 0.09 * (G0.lurch / 24) + base; }
      else G0.v = load >= 12 ? 0 : base * Math.max(0, 1 - load / 12);
      if (G0.v === 0) G0.jamT++;
      else {
        if (G0.jamT >= 60 && !G0.freed && load < 4) {                                // it breaks free
          G0.freed = true; G0.lurch = 24; G0.open = true;
          if (snd.impact) snd.impact(0.5); if (snd.chime) snd.chime(0.35); shake(2);
          const T0 = G0.trap;
          for (let y = T0.y0; y <= T0.y1; y++) for (let x = T0.x0; x <= T0.x1; x++) { const k = y * W + x; if (sim.g[k] === WALL) sim.g[k] = 0; }
          dirty = true;
          const F = vfx(); if (F) for (let k = 0; k < 8; k++) F.spark(T0.x0 + (k % 5), T0.y0 + 1, (Math.random() - 0.5) * 1.2, 0.6 + Math.random(), 'dust', 18, { l0: 2, g: 0.2, len: 0.8 });
        }
        G0.jamT = 0;
      }
      if (G0.v === 0 && G0.jamT === 1 && snd.glance) snd.glance();                    // the jam: a dull catch
      G0.a += G0.v;
      layGear(G0);
    }
    function gearSprites(G0, t) {
      const out = [], cells = new Map(), put = (x, y, ch) => cells.set(Math.round(x) + ',' + Math.round(y), ch);
      // a brass wheel: rim lit on the upper left, dark lower right; spokes; a hub; the teeth turning
      for (let th = 0; th < Math.PI * 2; th += 0.06) { const x = G0.x + Math.cos(th) * (G0.r - 2), y = G0.y + Math.sin(th) * (G0.r - 2); put(x, y, Math.cos(th - 3.9) > 0.3 ? '4' : Math.cos(th - 3.9) < -0.4 ? '1' : '3'); }
      for (let k = 0; k < 4; k++) { const th = G0.a * 1 + k * Math.PI / 2; for (let r = 2; r < G0.r - 2; r++) put(G0.x + Math.cos(th) * r, G0.y + Math.sin(th) * r, k % 2 ? '2' : '3'); }
      for (let k = 0; k < G0.teeth; k++) { const [x, y, th] = gearTooth(G0, k, G0.a); put(x, y, Math.cos(th - 3.9) > 0 ? '4' : '2'); put(G0.x + Math.cos(th) * (G0.r + 0.6), G0.y + Math.sin(th) * (G0.r + 0.6), '1'); }
      put(G0.x, G0.y, '1'); put(G0.x - 1, G0.y, '4'); put(G0.x, G0.y - 1, '4'); put(G0.x + 1, G0.y, '2'); put(G0.x, G0.y + 1, '2');
      for (const [k, ch] of cells) { const [x, y] = k.split(',').map(Number); out.push({ x, y, rows: [ch], top: true }); }
      // its rod, up the wall to the trapdoor (it jerks when the gear lurches)
      const T0 = G0.trap, rx = G0.x + 1, jerk = G0.lurch > 0 ? (G0.lurch % 2) : 0;
      for (let y = T0.y1 + 1; y < G0.y - G0.r; y++) out.push({ x: rx, y: y - jerk, rows: [(y % 5 === 0) ? '3' : '2'] });
      // the trapdoor: an iron-bound lid flush in the gallery floor, or hanging open into the shaft
      const wdt = T0.x1 - T0.x0 + 1;
      if (!G0.open) out.push({ x: T0.x0, y: T0.y0, rows: ['3' + '4'.repeat(wdt - 2) + '3', '1' + '2'.repeat(wdt - 2) + '1'], top: true });
      else { out.push({ x: T0.x0 - 1, y: T0.y0, rows: ['13', '12', '12', '12', '1.'], top: true }); for (let y = T0.y0; y <= T0.y1; y += 4) out.push({ x: T0.x1 + 1, y, rows: ['1'], top: true }); }
      return out;
    }

    // ---------- STATUES ----------
    // Contact rule: a HARD strike within reach of it (a hammer blow whose circle reaches it, a Q bolt
    // bursting within 8 cells, or a clump of sand slamming into it faster than 5 cells a frame) cracks it
    // open at once: the face falls away in chunks and a shard of memory glass shows inside, breathing
    // light. Sand touching the shard takes it (the same chime, flash and music cue as a room's memory;
    // it is not the room's counted memory, so it changes no score). States: whole / cracked.
    // It is solid (it stands on the gallery; bolts burst on it).
    const STATUE = [                    // a robed watcher of the Sieve, its eye worked on its breast; 9 x 19
      '...121...', '..12l21..', '..1lsl1..', '..1l2l1..', '...121...', '..12l21..', '.12llll21', '.1ll3ll21', '12l343l21', '12ll3ll21',
      '12llll221', '12llll221', '.12lll21.', '.12lll21.', '.12lll21.', '12llll221', '12lll2221', '133333331', '122222221',
    ];
    const STATUE_OPEN = [               // cracked: the face fallen away, a cavity with the shard breathing in it
      '...121...', '..12l21..', '..1lsl1..', '..1l2l1..', '...121...', '..12.21..', '.12...21.', '.1..u..1.', '12.unu.21', '12.nxn.21',
      '12.unu.21', '12..u..21', '.12...21.', '.12l.l21.', '.12lll21.', '12llll221', '12lll2221', '133333331', '122222221',
    ];
    // its stone: pale and warm so it reads against the dark wall (h lit, g shade, x the lit face, 1 outline, brass eye)
    const STONE = (r) => r.replace(/l/g, 'h').replace(/2/g, 'g').replace(/s/g, 'x');
    for (let i = 0; i < STATUE.length; i++) { STATUE[i] = STONE(STATUE[i]); STATUE_OPEN[i] = STONE(STATUE_OPEN[i]); }
    const statues = (D.statues || []).map((S0) => ({ ...S0, open: false, taken: false, cells: [], fall: [] }));
    // it is laid once its spot is clear of sand (the room's opening pour may be lying there)
    function layStatue(S0) {
      const top = S0.y - STATUE.length + 1;
      for (let r = 0; r < STATUE.length; r++) for (let c = 0; c < 9; c++) if (STATUE[r][c] !== '.' && grainAt(S0.x - 4 + c, top + r) >= 0) return false;
      STATUE.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.' && placeCell(S0.x - 4 + c, top + r)) S0.cells.push([S0.x - 4 + c, top + r]); }));
      S0.laid = true; dirty = true; return true;
    }
    for (const S0 of statues) layStatue(S0);
    function crackStatue(S0) {
      if (S0.open) return;
      S0.open = true; if (snd.impact) snd.impact(0.6); if (snd.glance) snd.glance(); shake(2.5);
      const top = S0.y - STATUE.length + 1;
      STATUE.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.' && STATUE_OPEN[r][c] === '.') { const x = S0.x - 4 + c, y = top + r; clearCell(x, y); S0.fall.push({ x, y, vx: (c - 4) * 0.25 + (Math.random() - 0.5) * 0.6, vy: -0.8 - Math.random(), ch, t: 0 }); } }));
      S0.cells = S0.cells.filter(([x, y]) => sim.g[y * W + x] === WALL);
      dirty = true;
      const F = vfx(); if (F) for (let k = 0; k < 6; k++) F.spark(S0.x, top + 9, (Math.random() - 0.5) * 2, -Math.random() * 1.5, 'dust', 22, { l0: 2, g: 0.15, len: 0.6 });
    }
    function stepStatue(S0, t) {
      if (!S0.laid) { layStatue(S0); return; }
      for (const d of S0.fall) { if (d.rest) continue; d.vy += 0.25; d.x += d.vx; d.y += d.vy; d.t++; if (sim.terrainSolid(Math.round(d.x), Math.round(d.y) + 1) || d.t > 80) d.rest = true; }
      if (S0.open && !S0.taken) {
        const top = S0.y - STATUE.length + 1, sx = S0.x, sy = top + 9;
        for (let y = sy - 3; y <= sy + 3; y++) for (let x = sx - 3; x <= sx + 3; x++) if (grainAt(x, y) >= 0) { S0.taken = true; if (D.onMemory) D.onMemory(sx, sy); break; }
      }
    }
    function statueSprites(S0, t) {
      const top = S0.y - STATUE.length + 1, out = [];
      let rows = S0.open ? STATUE_OPEN : STATUE;
      if (S0.open && !S0.taken && Math.sin(t * 1.6) < -0.3) rows = rows.map((r) => r.replace(/x(?=n)/g, 'n'));   // the shard breathes
      if (S0.taken) rows = rows.map((r, i) => (i >= 7 && i <= 11 ? r.replace(/[nxo]/g, 'u') : r));   // taken: the cavity is empty
      out.push({ x: S0.x - 4, y: top, rows, top: true });
      for (const d of S0.fall) out.push({ x: Math.round(d.x), y: Math.round(d.y), rows: [d.ch === '4' || d.ch === '3' ? '2' : d.ch], top: true });
      return out;
    }

    return {
      sim,
      step(t) {
        for (const b of banners) stepBanner(b, t);
        for (const B0 of braziers) stepBrazier(B0, t);
        for (const C of chains) stepChain(C, t);
        for (const G0 of gears) stepGear(G0, t);
        for (const S0 of statues) stepStatue(S0, t);
        if (dirty) { sim.terrainVersion++; dirty = false; }
      },
      sprites(t) {
        const out = [];
        for (const b of banners) out.push(...bannerSprites(b, t));
        for (const C of chains) out.push(...chainSprites(C, t));
        for (const B0 of braziers) out.push(...brazierSprites(B0, t));
        for (const G0 of gears) out.push(...gearSprites(G0, t));
        for (const S0 of statues) out.push(...statueSprites(S0, t));
        return out;
      },
      // one warm light per lit brazier; it dims while guttering, comes up as it rekindles
      lights(t) {
        const out = [];
        for (const B0 of braziers) {
          if (!B0.lit) continue;
          const k = (B0.gutter > 0 ? 0.4 : 1) * (B0.relight > 0 ? 1 - B0.relight / 24 : 1);
          out.push({ x: B0.x, y: B0.y - 6, r: 1.0 * k, g: 0.62 * k, b: 0.3 * k, radius: 90, flicker: 1 });
        }
        for (const S0 of statues) if (S0.open && !S0.taken) out.push({ x: S0.x, y: S0.y - 9, r: 0.45, g: 0.7, b: 0.9, radius: 34, flicker: 0.5 });   // the exposed shard glows a little
        return out;
      },
      state() { return { banners: banners.map((b) => ({ x: b.x, dip: +b.dip.toFixed(2), meter: b.meter, torn: b.torn, heap: b.heapCells.length })), braziers: braziers.map((B0) => ({ x: B0.x, lit: B0.lit, gutter: B0.gutter })), chains: chains.map((C) => ({ x: C.x, a: +C.a.toFixed(3), stone: C.stone && C.stone.state })), gears: gears.map((G0) => ({ x: G0.x, v: +G0.v.toFixed(4), jamT: G0.jamT, open: G0.open })), statues: statues.map((S0) => ({ x: S0.x, open: S0.open, taken: S0.taken })) }; },
      // the sim's events, passed in by game.js as they are read: a hard strike near a statue cracks it
      event(e) {
        for (const S0 of statues) {
          if (S0.open || !S0.laid) continue;
          const sx = S0.x, sy = S0.y - 9, d = Math.hypot(e.x - sx, e.y - sy);
          if ((e.type === 'hammer' && d < (e.r || 10) + 6) || (e.type === 'boltBoom' && d < 12) || (e.type === 'impact' && e.v > 5 && d < 8)) crackStatue(S0);
        }
      },
    };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillInteractive = api;
})(typeof window !== 'undefined' ? window : globalThis);
