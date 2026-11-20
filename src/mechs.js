// Mechanisms: the places where the world asks you to spend yourself.
// These are the castle's building blocks; maps are made by placing them.
//
//   plate      a stone plate; a door stays open only while enough weight
//              rests on it (your grains, a crate, a creature). Some latch.
//   lift       a basin and a platform: the more sand you pour into the
//              basin, the higher the platform rises, carrying what is on it.
//   lamp       a dead brazier. Grains you feed it are gone for good; once it
//              has enough it lights, and a hidden wall crumbles open.
//   pendulum   a blade on a chain, swinging on a rhythm. Timing, not force.
//   crumble    old glass that holds you for a moment after you land on it
//              (or a creature walks on it), then breaks, and slowly grows
//              back. A slam onto it breaks it at once.
//   tide, vent, spikeWall, bell   (see each below)
//
//   -- the castle set --
//   gate       an iron gate opened by a signal; with `hold` it starts to
//              close again on its own. Frozen sand braces any closing iron.
//   crackWall  cracked masonry that only a slam into its named face breaks
//              (or a Warden's lunge, if you lure it in).
//   crate      a loose block: falls, rests on sand, is shoved by blows,
//              weighs on plates, and crushes creatures it lands on.
//   crusher    a heavy block that warns, drops and crushes; a frozen pillar
//              under it jams it for as long as the freeze holds.
//   target     a hanging mark only a long Q shot (or a reflected dart, or a
//              diving Diver) can light.
//   lever      a switch any blow flips (a Warden's cleave too); can spring back.
//   belt       a conveyor floor carrying sand, creatures and crates.
//   wind       a steady current: carries throws over gaps, lifts in updrafts,
//              bends bolts, pushes small creatures.
//   brazier    a fire that eats sand; a frozen plug or a slam smothers it.
//              Gnats are drawn to it and burn.
//   phase      blocks (light bridges) solid only while their signal is on.
//   relay      signal logic: delay, pulse, NOT, and ordered switch chains.
//   ring       a thrown clump passing through refills your air throws;
//              a Q bolt through it gains a range band.
//   dart       a wall trap firing on a beat; frozen sand shields, a freeze
//              started as it lands parries it back along its line.
//   mover      a moving platform: loops, rides when weighed, or follows a signal.
//
// Signals: any mechanism with an `id` sets s.signals[id] (on/off). Anything
// with `when` (an id or a list; `logic: 'any'`, default all) listens to them.
//
// Every mechanism keeps a small state the world remembers when you leave
// (a latched door stays open, a lit lamp stays lit, a broken wall stays broken).
//
// Specs are given in unflipped room coordinates (only spikeWall supports a
// mirrored room so far).
(function (root) {
  'use strict';
  const WALL = 1, GLASS = 4, SLICK = 8, SPIKE = 5, RUBBLE = 32;   // gates are iron: smooth, unclimbable
  const PARRY = 10;                                              // frames: same window the creatures use
  const PLAYER_BLOWS = ['blade', 'burst', 'lash', 'hammer', 'shock', 'slam', 'shard', 'star'];

  function make(spec) { return Object.assign({ open: 0, lit: false, off: 0, t: 0, fed: 0, state: 'whole', latched: false }, spec); }

  // grains resting in a rectangle (frozen sand weighs just as much)
  function countIn(s, x, y, w, h) {
    let n = 0;
    for (let i = 0; i < s.N; i++) if ((s.state[i] === 1 || s.state[i] === 2) && s.px[i] >= x && s.px[i] < x + w && s.py[i] >= y && s.py[i] < y + h) n++;
    return n;
  }
  function frozenIn(s, x, y, w, h) {
    let n = 0;
    for (let i = 0; i < s.N; i++) if (s.state[i] === 2 && s.px[i] >= x && s.px[i] < x + w && s.py[i] >= y && s.py[i] < y + h) n++;
    return n;
  }

  // ---- signals ----
  function sig(s, id) { return !!(s.signals && s.signals[id]); }
  function emit(s, id, on) {
    if (id == null) return;
    const S = s.signals || (s.signals = {});
    if (!!S[id] !== !!on) { S[id] = !!on; s.events.push({ type: 'signal', id, on: !!on }); }
  }
  function wants(s, m) {
    if (m.when == null) return true;
    const L = Array.isArray(m.when) ? m.when : [m.when];
    const v = m.logic === 'any' ? L.some((id) => sig(s, id)) : L.every((id) => sig(s, id));
    return m.invert ? !v : v;
  }

  // ---- creatures, as boxes ----
  function foeBox(f) {
    const z = f.kind === 'warden' ? [11, 15, 15] : f.kind === 'diver' ? [11, 5, 5] : f.kind === 'gnat' ? [3, 3, 1] : [10, 5, 5];
    return { x0: f.x - z[0], x1: f.x + z[0], y0: f.y - z[2] - z[1], y1: f.y - z[2] + z[1], cy: f.y - z[2] };
  }
  function foesIn(s, x, y, w, h) {
    const out = [];
    for (const f of s.foes || []) {
      if (f.dead) continue;
      const b = foeBox(f);
      if (b.x1 >= x && b.x0 < x + w && b.y1 >= y && b.y0 < y + h) out.push(f);
    }
    return out;
  }
  // a blow the world deals to a creature: queued, and dealt through the same
  // hit list the player's blows use (so stun, poise, combo and hit stop apply)
  function envHit(s, m, f, kind, dmg, poise) {
    m.hitN = (m.hitN || 0) + 1;
    (s.mechHits || (s.mechHits = [])).push({ kind, shape: 'circle', x: f.x, y: foeBox(f).cy, r: 3, dmg, poise, id: 'M' + m.k + '.' + m.hitN, dir: Math.sign(f.x - (m.x + (m.w || 0) / 2)) || 1, env: true, foe: f });
  }

  // ---- hit shapes (same geometry as foes.js) ----
  function inShape(h, x, y) {
    if (h.shape === 'circle') return Math.hypot(x - h.x, y - h.y) <= h.r;
    const d = Math.hypot(x - h.x, y - h.y);
    if (d < h.r0 || d > h.r) return false;
    let a = Math.atan2(y - h.y, x - h.x);
    const mid = (h.a0 + h.a1) / 2;
    while (a < mid - Math.PI) a += Math.PI * 2; while (a > mid + Math.PI) a -= Math.PI * 2;
    return a >= h.a0 && a <= h.a1;
  }
  // does a hit shape touch a box (sampled: corners, edge midpoints, centre)?
  function touches(h, x, y, w, h2) {
    if (h.shape === 'circle') {
      const cx = Math.max(x, Math.min(x + w, h.x)), cy = Math.max(y, Math.min(y + h2, h.y));
      return Math.hypot(cx - h.x, cy - h.y) <= h.r;
    }
    for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) if (inShape(h, x + w * a / 4, y + h2 * b / 4)) return true;
    return false;
  }
  // this frame's new blows on a box, each counted once per mechanism
  const MELEE_KINDS = { blade: 1, burst: 1, hammer: 1, shock: 1, slam: 1 };      // the blows that need a line of effect (same list as foes.js takeHits)
  function blowsOn(s, m, x, y, w, h, kinds) {
    const seen = m.seen || (m.seen = new Set()), out = [];
    for (const hit of s.hits) {
      if (seen.has(hit.id) || (kinds && !kinds.includes(hit.kind))) continue;
      if (!touches(hit, x, y, w, h)) continue;
      if (MELEE_KINDS[hit.kind] && s.lineOfEffect && !s.lineOfEffect(hit.x, hit.y, Math.max(x, Math.min(x + w, hit.x)), Math.max(y, Math.min(y + h, hit.y)))) continue;      // a wall or ice between the blow and the mechanism stops it (aimed at the nearest point of its box: the mechanism's own body is solid)
      seen.add(hit.id); out.push(hit);
    }
    if (seen.size > 80) m.seen = new Set([...seen].slice(-40));
    return out;
  }
  const parried = (s) => s.frame - s.parryAt <= PARRY + ((s.mod && s.mod.parryWin) || 0);

  // ---- moving grains and blocks ----
  function moveGrain(s, i, x, y) { const W = s.W; s.pid[s.py[i] * W + s.px[i]] = -1; s.px[i] = x; s.py[i] = y; s.pid[y * W + x] = i; }
  const freeCell = (s, x, y) => s.inb(x, y) && !s.blocks(y * s.W + x) && s.g[y * s.W + x] !== SPIKE && s.pid[y * s.W + x] < 0;
  const actorSolid = (s, x, y) => s.terrainSolid(x, y) || s.frozenAt(x, y);

  // A portcullis: rises a row at a time into its frame, and drops back a row
  // at a time. Sand in its way is shoved aside (or crushed if there is
  // nowhere to go), so it always closes, unless something braces it: frozen
  // sand or a creature in the row it is closing onto holds it there.
  function shove(s, c) {
    const i = s.pid[c]; if (i < 0) return;
    const W = s.W, x0 = c % W, y = (c / W) | 0;
    for (let d = 1; d < 14; d++) for (const x of [x0 - d, x0 + d]) {
      if (x < 0 || x >= W) continue;
      const n = y * W + x;
      if (!s.blocks(n) && s.pid[n] < 0) { s.pid[c] = -1; s.pid[n] = i; s.px[i] = x; s.vx[i] = 0; return; }
    }
    s.killAt(c);
  }
  function bracedRow(s, x, y, w) {
    const W = s.W;
    for (let xx = x; xx < x + w; xx++) { const j = s.pid[y * W + xx]; if (j >= 0 && s.state[j] === 2) return 'frozen'; }
    if (foesIn(s, x, y, w, 1).length) return 'foe';
    return null;
  }
  function slideDoor(s, d, want) {
    const W = s.W;
    if (want > d.openRows) {
      const y = d.y + d.h - 1 - d.openRows;           // the bottom row lifts away
      for (let x = d.x; x < d.x + d.w; x++) if (s.g[y * W + x] === SLICK || s.g[y * W + x] === WALL) s.g[y * W + x] = 0;
      d.openRows++; s.terrainVersion++; d.braced = null;
    } else if (want < d.openRows) {
      const y = d.y + d.h - d.openRows;
      const b = bracedRow(s, d.x, y, d.w);
      if (b) {
        if (!d.braced) s.events.push({ type: 'braced', x: d.x + d.w / 2, y, by: b });
        d.braced = b; return;
      }
      d.braced = null;
      for (let x = d.x; x < d.x + d.w; x++) { const c = y * W + x; if (s.pid[c] >= 0) shove(s, c); }
      for (let x = d.x; x < d.x + d.w; x++) s.g[y * W + x] = SLICK;
      d.openRows--; s.terrainVersion++;
    }
  }
  function runDoor(s, d, want, rate) {
    if (!d.openRows) d.openRows = 0;
    if (s.frame % (rate || 3) === 0 && want !== d.openRows) {
      const was = d.openRows;
      slideDoor(s, d, want);
      if (was === 0 && d.openRows > 0) s.events.push({ type: 'door', open: true, x: d.x, y: d.y });
      if (was > 0 && d.openRows === 0) s.events.push({ type: 'door', open: false, x: d.x, y: d.y });
    }
  }

  // Move a solid block one cell along an axis. What is in its way:
  //   stone or spikes stop it ('wall'); frozen sand braces it ('braced');
  //   a creature calls o.foe(f) (true: it was dealt with, go on; else 'foe');
  //   loose sand is lifted (moving up), pushed along (sideways), and moving
  //   down is crushed (o.crush) or shoved aside.
  // Sand and creatures riding on top move with it (o.carry).
  function moveBlock(s, b, dx, dy, o) {
    o = o || {};
    const W = s.W, mat = b.mat || WALL;
    const lx = dx > 0 ? b.x + b.w : dx < 0 ? b.x - 1 : b.x, ly = dy > 0 ? b.y + b.h : dy < 0 ? b.y - 1 : b.y;
    const lw = dx ? 1 : b.w, lh = dx ? b.h : 1;
    for (let y = ly; y < ly + lh; y++) for (let x = lx; x < lx + lw; x++) {
      if (!s.inb(x, y)) return 'wall';
      const c = y * W + x;
      if (s.blocks(c) || s.g[c] === SPIKE) return 'wall';
      const j = s.pid[c]; if (j >= 0 && s.state[j] === 2) return 'braced';
    }
    const fs = dy < 0 ? [] : foesIn(s, lx, ly, lw, lh);           // moving up, creatures on top just ride
    for (const f of fs) if (!(o.foe && o.foe(f))) return 'foe';
    // loose sand in the leading face
    if (dy < 0) {
      for (let x = lx; x < lx + lw; x++) {                   // check every column first
        let y = ly; while (y >= 0 && s.pid[y * W + x] >= 0) { if (s.state[s.pid[y * W + x]] === 2) return 'braced'; y--; }
        if (y < 0 || s.blocks(y * W + x) || s.g[y * W + x] === SPIKE) return 'blocked';
      }
      for (let x = lx; x < lx + lw; x++) {
        let y = ly; while (s.pid[y * W + x] >= 0) y--;
        for (let yy = y + 1; yy <= ly; yy++) moveGrain(s, s.pid[yy * W + x], x, yy - 1);
      }
    } else if (dy > 0) {
      for (let x = lx; x < lx + lw; x++) { const c = ly * W + x; if (s.pid[c] >= 0) { if (o.crush) s.killAt(c); else shove(s, c); } }
    } else {
      for (let y = ly; y < ly + lh; y++) {
        let x = lx; while (s.inb(x, y) && s.pid[y * W + x] >= 0) { if (s.state[s.pid[y * W + x]] === 2) return 'braced'; x += dx; }
        if (x !== lx && !freeCell(s, x, y)) { if (!o.crush) return 'blocked'; }
      }
      for (let y = ly; y < ly + lh; y++) {
        let x = lx; while (s.inb(x, y) && s.pid[y * W + x] >= 0) x += dx;
        if (x === lx) continue;
        if (!freeCell(s, x, y)) { s.killAt(y * W + lx); continue; }
        for (let xx = x - dx; xx !== lx - dx; xx -= dx) moveGrain(s, s.pid[y * W + xx], xx + dx, y);
      }
    }
    // riders: sand stacked on top, and creatures standing on it, go along sideways
    if (dx && o.carry !== false) {
      for (let x = dx > 0 ? b.x + b.w - 1 : b.x; x >= b.x && x < b.x + b.w; x -= dx) {
        for (let y = b.y - 1; y >= 0; y--) {
          const j = s.pid[y * W + x]; if (j < 0) break;
          if (s.state[j] === 1 && freeCell(s, x + dx, y)) moveGrain(s, j, x + dx, y);
        }
      }
    }
    if (o.carry !== false) for (const f of s.foes || []) {
      if (f.dead || f.x < b.x - 2 || f.x > b.x + b.w + 1 || Math.abs(f.y - (b.y - 1)) > 1.5) continue;
      if (dx && !actorSolid(s, Math.round(f.x + dx * 3), Math.round(f.y) - 2)) f.x += dx;
      if (dy) f.y += dy;
    }
    // the stone itself
    if (dx) {
      const xt = dx > 0 ? b.x : b.x + b.w - 1;
      for (let y = b.y; y < b.y + b.h; y++) { s.g[y * W + xt] = 0; s.g[y * W + lx] = mat; }
    } else {
      const yt = dy > 0 ? b.y : b.y + b.h - 1;
      for (let x = b.x; x < b.x + b.w; x++) { s.g[yt * W + x] = 0; s.g[ly * W + x] = mat; }
    }
    b.x += dx; b.y += dy; s.terrainVersion++;
    return 'ok';
  }
  function fillRect(s, r, t) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (s.inb(x, y) && s.pid[y * s.W + x] < 0) s.g[y * s.W + x] = t;
    s.terrainVersion++;
  }
  function clearRect(s, r, t) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (s.inb(x, y) && (t == null || s.g[y * s.W + x] === t)) s.g[y * s.W + x] = 0;
    s.terrainVersion++;
  }

  // Raise a platform by one cell, lifting any sand stacked on it.
  function liftUp(s, p) {
    const W = s.W, top = p.y - p.off;
    for (let x = p.x; x < p.x + p.w; x++) {            // check every column first
      let y = top - 1;
      while (y >= 0 && s.pid[y * W + x] >= 0) y--;
      if (y < 0 || s.blocks(y * W + x)) return false;
    }
    for (let x = p.x; x < p.x + p.w; x++) {
      let y = top - 1;
      while (s.pid[y * W + x] >= 0) y--;
      for (let yy = y + 1; yy < top; yy++) {           // shift the stack up by one
        const i = s.pid[yy * W + x];
        s.pid[(yy - 1) * W + x] = i; s.py[i] = yy - 1;
      }
      s.pid[(top - 1) * W + x] = -1;
      s.g[(top - 1) * W + x] = WALL;
      s.g[(top + p.h - 1) * W + x] = 0;
    }
    p.off++; s.terrainVersion++;
    return true;
  }
  function liftDown(s, p) {
    const W = s.W, top = p.y - p.off;
    for (let x = p.x; x < p.x + p.w; x++) { const c = (top + p.h) * W + x; if (s.g[c] !== 0 || s.pid[c] >= 0) return false; }
    for (let x = p.x; x < p.x + p.w; x++) { s.g[top * W + x] = 0; s.g[(top + p.h) * W + x] = WALL; }
    p.off--; s.terrainVersion++;
    return true;
  }

  // what a creature weighs on a plate (fliers weigh nothing)
  const FOE_WEIGHT = { mite: 20, warden: 150, dummy: 40 };

  const step = {
    plate(s, m) {
      m.weight = countIn(s, m.x, m.y - 14, m.w, 14);
      // a crate resting on it, or a creature standing on it, weighs too
      for (const c of s.mechs) if (c.kind === 'crate' && c.y + c.h === m.y && c.x < m.x + m.w && c.x + c.w > m.x) m.weight += c.weight || 60;
      for (const f of s.foes || []) if (!f.dead && FOE_WEIGHT[f.kind] && f.x >= m.x - 2 && f.x < m.x + m.w + 2 && Math.abs(f.y - (m.y - 1)) <= 2) m.weight += FOE_WEIGHT[f.kind];
      const pressed = m.weight >= m.need;
      m.pressed = pressed;
      if (pressed && m.latch) m.latched = true;
      emit(s, m.id, pressed || m.latched);
      if (m.door) runDoor(s, m.door, (pressed || m.latched) ? m.door.h : 0, 3);
    },
    // An iron gate that answers a signal. With `hold`, once its signal goes
    // off it stays open that long, then closes a row at a time (`rate` frames
    // a row): brace it with frozen sand to keep it from shutting.
    gate(s, m) {
      const on = wants(s, m);
      if (on) { m.openT = m.hold || 0; if (m.latch) m.latched = true; }
      else if (m.openT > 0) m.openT--;
      m.on = on || m.openT > 0 || m.latched;
      runDoor(s, m.door, m.on ? m.door.h : 0, m.on ? 2 : (m.rate || 3));
      m.closing = !m.on && m.door.openRows > 0;
      emit(s, m.id, m.door.openRows === m.door.h);
    },
    lift(s, m) {
      m.weight = countIn(s, m.basin.x, m.basin.y, m.basin.w, m.basin.h);
      const target = Math.min(m.rise, Math.floor(m.weight * m.per));
      if (target > m.plat.off) { if (s.frame % 2 === 0) liftUp(s, m.plat); }
      else if (target < m.plat.off) liftDown(s, m.plat);     // it sinks as soon as the weight comes off
    },
    lamp(s, m) {
      if (m.lit) { emit(s, m.id, true); return; }
      // grains that fall into the bowl are burnt: spent, gone for good
      for (let i = 0; i < s.N; i++) {
        if (s.state[i] !== 1) continue;
        if (Math.abs(s.px[i] - m.x) <= 4 && s.py[i] >= m.y - 3 && s.py[i] <= m.y) {
          s.pid[s.py[i] * s.W + s.px[i]] = -1; s.state[i] = 7; s.alive--; s.spent = (s.spent || 0) + 1; m.fed++;
          if (m.fed % 6 === 0) s.events.push({ type: 'feed', x: m.x, y: m.y });
        }
      }
      if (m.fed >= m.need) light(s, m, true);
    },
    pendulum(s, m) {
      const a = m.amp * Math.sin((s.frame / m.period) * Math.PI * 2 + (m.phase || 0));
      m.bx = m.px + Math.sin(a) * m.len; m.by = m.py + Math.cos(a) * m.len;
      for (let yy = Math.round(m.by - 4); yy <= m.by + 4; yy++) for (let xx = Math.round(m.bx - 4); xx <= m.bx + 4; xx++) {
        if (xx < 0 || yy < 0 || xx >= s.W || yy >= s.H || Math.hypot(xx - m.bx, yy - m.by) > 4) continue;
        const c = yy * s.W + xx;
        if (s.pid[c] >= 0 && s.state[s.pid[c]] === 1) s.killAt(c);
      }
    },
    // The tide: water that breathes up and down. Sand under water floats up
    // and rides the surface, so a rising tide carries you to high ledges and
    // a low one lays the floor bare.
    tide(s, m) {
      const k = 0.5 - 0.5 * Math.cos((s.frame / m.period) * Math.PI * 2 + (m.phase || 0));
      m.level = m.low - (m.low - m.high) * k;
      m.rising = Math.sin((s.frame / m.period) * Math.PI * 2 + (m.phase || 0)) > 0;
      const lv = m.level;
      for (let i = 0; i < s.N; i++) {
        if (s.state[i] !== 1 || s.px[i] < m.x || s.px[i] >= m.x + m.w) continue;
        const depth = s.py[i] - lv;
        if (depth < -1) continue;
        if (depth > 1) { s.vy[i] = s.vy[i] * 0.86 - 0.42; s.vx[i] = s.vx[i] * 0.9 + (m.current || 0) * 0.05; }   // float up
        else { s.vy[i] = Math.min(s.vy[i], m.rising ? -0.35 : 0.05); s.vx[i] *= 0.92; }                         // ride the surface
      }
    },
    // A vent in the Tower's stone that breathes: it draws in (and eats what
    // reaches its mouth), holds, then breathes out hard along its jet.
    vent(s, m) {
      const T = m.inhale + m.hold + m.exhale + m.rest, t = (s.frame + (m.phase || 0)) % T;
      m.mode = t < m.inhale ? 'in' : t < m.inhale + m.hold ? 'hold' : t < m.inhale + m.hold + m.exhale ? 'out' : 'rest';
      if (m.mode !== m.lastMode) { if (m.mode === 'out') s.events.push({ type: 'ventOut', x: m.x, y: m.y }); if (m.mode === 'in') s.events.push({ type: 'ventIn', x: m.x, y: m.y }); m.lastMode = m.mode; }
      if (m.mode !== 'in' && m.mode !== 'out') return;
      const dx = m.dir[0], dy = m.dir[1];
      for (let i = 0; i < s.N; i++) {
        if (s.state[i] !== 1) continue;
        const rx = s.px[i] - m.x, ry = s.py[i] - m.y;
        const along = rx * dx + ry * dy, across = Math.abs(rx * dy - ry * dx);
        if (along < 0 || along > m.len || across > m.width * (0.6 + along / m.len * 0.6)) continue;
        if (m.mode === 'out') {
          const f = 1.1 * (1 - along / m.len * 0.6);
          s.vx[i] += dx * f; s.vy[i] += dy * f - (dy === 0 ? 0.33 + (s.vy[i] > 0 ? s.vy[i] * 0.2 : 0) : 0);   // a sideways jet carries sand level
          if (Math.abs(s.vx[i]) > 6) s.vx[i] = Math.sign(s.vx[i]) * 6; if (Math.abs(s.vy[i]) > 6) s.vy[i] = Math.sign(s.vy[i]) * 6;
        } else {
          const f = 0.32 * (1 - along / m.len);
          s.vx[i] -= dx * f + (rx * dy * dy) * 0.004; s.vy[i] -= dy * f + (ry * dx * dx) * 0.004;
          if (m.eat && along < 7 && across < 10 && (s.frame & 1)) s.killAt(s.py[i] * s.W + s.px[i]);   // its mouth swallows what it draws in
        }
      }
    },
    // Wall spikes that breathe: a row of iron teeth set in sockets along a wall. They hide
    // (in), a warning shows for the last ~0.7 s, they snap out in 3 frames, hold, and draw
    // back in 4. Teeth are 1-2 cells long in a saw pattern, never a flat strip.
    spikeWall(s, m) {
      if (!m.ready) { if (s.flipped) { m.x = s.W - 1 - m.x; m.side = -m.side; } m.ready = true; m.ext = 0; }
      const T = m.in + m.out, tt = (s.frame + (m.phase || 0)) % T;
      let want;
      if (tt < m.in) want = 0;
      else if (tt < m.in + 3) want = (tt - m.in + 1) / 3;
      else if (tt < T - 4) want = 1;
      else want = (T - tt - 1) / 4;
      m.warnLeft = tt < m.in && m.in - tt <= 42 ? m.in - tt : 0;
      if (want === m.ext) return;
      if (want > m.ext && m.ext === 0) s.events.push({ type: 'spikesOut', x: m.x, y: (m.y0 + m.y1) / 2 });
      m.ext = want;
      const W = s.W;
      for (let y = m.y0; y < m.y1; y++) {
        const ph = (y - m.y0) % 4, tooth = ph === 1 ? m.len : ph === 3 ? 0 : 1;   // a tip, two shoulders, a gap
        const reach = Math.round(tooth * want);
        for (let d = 0; d < m.len; d++) {
          const x = m.x + d * m.side, c = y * W + x;
          if (d < reach) { if (s.g[c] === 0 || s.g[c] === SPIKE) { if (s.pid[c] >= 0) s.killAt(c); s.g[c] = SPIKE; } }
          else if (s.g[c] === SPIKE) s.g[c] = 0;
        }
      }
      s.terrainVersion++;
    },
    // A bell: it swings harder and harder (the warning), then tolls, and every
    // grain resting on its ledges is thrown loose.
    bell(s, m) {
      const t = (s.frame + (m.phase || 0)) % m.period;
      m.swing = t > m.period - 70 ? (t - (m.period - 70)) / 70 : Math.max(0, (m.swing || 0) - 0.02);
      if (t === 0 && s.frame > 0) {
        s.events.push({ type: 'toll', x: m.x, y: m.y });
        for (let i = 0; i < s.N; i++) {
          if (s.state[i] !== 1) continue;
          for (const L of m.ledges) if (s.px[i] >= L.x && s.px[i] < L.x + L.w && s.py[i] >= L.y - 16 && s.py[i] < L.y) {
            const out = s.px[i] < L.x + L.w / 2 ? -1 : 1;
            s.vy[i] = -2.6 - s.rand() * 1.4; s.vx[i] = out * (1.8 + s.rand() * 1.8) + (L.push || 0); break;   // flung outward, off the edges
          }
        }
      }
    },
    crumble(s, m) {
      const W = s.W;
      if (m.state === 'whole') {
        let by = null;
        for (let x = m.x; x < m.x + m.w; x++) if (s.pid[(m.y - 1) * W + x] >= 0) { by = 'sand'; break; }
        // a creature walking onto it starts it too (a heavy one, sooner)
        if (!by) for (const f of s.foes || []) if (!f.dead && FOE_WEIGHT[f.kind] && f.x >= m.x - 2 && f.x < m.x + m.w + 2 && Math.abs(f.y - (m.y - 1)) <= 2) { by = f.kind; break; }
        if (by) { m.state = 'shaking'; m.t = by === 'warden' ? 30 : 0; s.events.push({ type: 'creak', x: m.x + m.w / 2, y: m.y, by }); }
      } else if (m.state === 'shaking' && ++m.t > 40) {
        breakGlass(s, m);
      } else if (m.state === 'broken' && ++m.t > 240) {
        let clear = true;
        for (let x = m.x; x < m.x + m.w && clear; x++) for (let y = m.y; y < m.y + 2; y++) if (s.pid[y * W + x] >= 0) clear = false;
        if (clear && foesIn(s, m.x, m.y, m.w, 2).length) clear = false;
        if (clear) { for (let x = m.x; x < m.x + m.w; x++) for (let y = m.y; y < m.y + 2; y++) if (s.g[y * W + x] === 0) s.g[y * W + x] = GLASS; m.state = 'whole'; s.terrainVersion++; }
      }
    },

    // ---------------- the castle set ----------------

    // Cracked masonry. Only a slam striking its named face breaks it (a throw
    // into its left face travels right, and so on; 'any' takes any side).
    // `hp` slams; `power` is the least slam strength that counts. A Warden
    // lunging into it breaks it too: lure one in.
    crackWall(s, m) { if (!m.ready) { m.ready = true; m.hpMax = m.hp = m.hp || 1; if (!m.broken) fillRect(s, m, WALL); else clearRect(s, m, WALL); } emit(s, m.id, !!m.broken); },

    // A loose block of stone. It falls, rests on stone or on a heap of sand,
    // slides when struck from the side, and drops hard onto creatures.
    crate(s, m) {
      if (!m.ready) { m.ready = true; m.w = m.w || 10; m.h = m.h || 10; m.vx = 0; m.vy = 0; m.fx = 0; m.fy = 0; m.mat = WALL; fillRect(s, m, WALL); }
      const W = s.W;
      // support: stone under any column, or sand under a third of them
      let stone = 0, sand = 0;
      for (let x = m.x; x < m.x + m.w; x++) { const c = (m.y + m.h) * W + x; if (!s.inb(x, m.y + m.h) || s.blocks(c)) stone++; else if (s.pid[c] >= 0) sand++; }
      const held = stone > 0 || sand >= m.w / 3;
      if (!held) {
        m.vy = Math.min(6, m.vy + 0.3); m.fy += m.vy;
        while (m.fy >= 1) {
          m.fy -= 1;
          const r = moveBlock(s, m, 0, 1, { foe: (f) => {
            if (m.vy > 1.5) { envHit(s, m, f, 'crush', 3 + Math.round(m.vy * 1.5), 6); s.events.push({ type: 'crateCrush', x: f.x, y: f.y }); }
            f.x = f.x < m.x + m.w / 2 ? m.x - foeBox(f).x1 + f.x - 1 : m.x + m.w + (f.x - foeBox(f).x0) + 1;   // knocked out from under it
            return true;
          } });
          if (r !== 'ok') { if (m.vy > 2) s.events.push({ type: 'crateLand', x: m.x + m.w / 2, y: m.y + m.h, v: m.vy }); m.vy = 0; m.fy = 0; break; }
        }
      } else { if (m.vy > 2) s.events.push({ type: 'crateLand', x: m.x + m.w / 2, y: m.y + m.h, v: m.vy }); m.vy = 0; m.fy = 0; }
      if (Math.abs(m.vx) > 0.05) {
        m.fx += m.vx;
        while (Math.abs(m.fx) >= 1) {
          const d = Math.sign(m.fx); m.fx -= d;
          const r = moveBlock(s, m, d, 0, { foe: (f) => {
            if (Math.abs(m.vx) > 1.2) { envHit(s, m, f, 'crush', 2 + Math.round(Math.abs(m.vx)), 4); s.events.push({ type: 'crateCrush', x: f.x, y: f.y }); }
            f.x += d * 3; f.vx = d * 1.5;
            return Math.abs(m.vx) > 1.2;               // a slow crate stops against a creature
          } });
          if (r !== 'ok') { m.vx = 0; m.fx = 0; if (r === 'wall') s.events.push({ type: 'crateBump', x: m.x + (d > 0 ? m.w : 0), y: m.y + m.h / 2 }); break; }
        }
        if (held) m.vx *= 0.86;                        // it grinds to a stop on the floor
        else m.vx *= 0.99;
      }
    },

    // A crusher: waits at the top, shakes for its last ~0.7 s (the warning),
    // drops fast, crushes loose sand and creatures under it, rests, rises.
    // Frozen sand under it jams it: it hangs there until the freeze lets go.
    crusher(s, m) {
      if (!m.ready) { m.ready = true; m.mat = SLICK; m.y0 = m.y; m.st = 'top'; m.t = 0; m.v = 0; fillRect(s, m, SLICK); }
      if (m.when != null && !wants(s, m) && m.st === 'top') { m.t = 0; m.warnLeft = 0; return; }
      const warn = m.warn || 42;
      m.t++;
      if (m.st === 'top') {
        const up = m.up || 120;
        m.warnLeft = m.t > up - warn ? up - m.t : 0;
        if (m.t >= up) { m.st = 'fall'; m.t = 0; m.v = 0; s.events.push({ type: 'crusherDrop', x: m.x + m.w / 2, y: m.y + m.h }); }
      } else if (m.st === 'fall' || m.st === 'jam') {
        if (m.st === 'jam') {
          if (frozenIn(s, m.x, m.y + m.h, m.w, 1)) return;
          m.st = 'fall'; m.v = 1; s.events.push({ type: 'unjam', x: m.x + m.w / 2, y: m.y + m.h });
        }
        m.v = Math.min(m.speed || 5, m.v + 0.6);
        for (let k = 0; k < Math.round(m.v); k++) {
          if (m.y - m.y0 >= (m.drop || 60)) { m.st = 'bottom'; m.t = 0; break; }
          const r = moveBlock(s, m, 0, 1, { crush: true, foe: (f) => {
            envHit(s, m, f, 'crush', m.dmg || 12, 10); s.events.push({ type: 'crushFoe', x: f.x, y: f.y });
            const b = foeBox(f);
            f.x = f.x < m.x + m.w / 2 ? m.x - (b.x1 - f.x) - 1 : m.x + m.w + (f.x - b.x0) + 1;
            return true;
          } });
          if (r === 'braced') { m.st = 'jam'; s.events.push({ type: 'jam', x: m.x + m.w / 2, y: m.y + m.h }); break; }
          if (r !== 'ok') { m.st = 'bottom'; m.t = 0; s.events.push({ type: 'crush', x: m.x + m.w / 2, y: m.y + m.h }); break; }
        }
      } else if (m.st === 'bottom') {
        if (m.t >= (m.down || 40)) { m.st = 'rise'; m.t = 0; }
      } else if (m.st === 'rise') {
        if (m.t % (m.riseRate || 2) === 0) {
          if (m.y <= m.y0) { m.st = 'top'; m.t = 0; }
          else moveBlock(s, m, 0, -1, {});
        }
      }
    },

    // A target hanging in the air (no stone: shots fly through it). It lights
    // when a Q bolt that has flown at least `far` range bands (90 cells each)
    // passes through it; a closer shot only glances. A reflected dart, an
    // icicle shard (if far is 0), or a Diver diving through it light it too.
    // `reset`: frames it stays lit (0: for good).
    target(s, m) {
      if (m.on && m.reset && --m.t <= 0) { m.on = false; s.events.push({ type: 'targetOff', x: m.x, y: m.y }); }
      emit(s, m.id, !!m.on);
    },

    // A lever: any blow flips it (a Warden's swing as well). `timer`: frames
    // until it springs back (0: it stays).
    lever(s, m) {
      if (m.cool > 0) m.cool--;
      if (m.on && m.timer && --m.t <= 0) { m.on = false; s.events.push({ type: 'lever', on: false, x: m.x, y: m.y }); }
      // a Warden swinging at you near it catches it with the halberd
      for (const f of s.foes || []) if (!f.dead && f.kind === 'warden' && f.mode === 'active' && (f.atkName === 'cleave' || f.atkName === 'lunge')) {
        const cy = f.y - 15;
        const sh = f.atkName === 'cleave' ? { shape: 'arc', x: f.x + f.dir * 4, y: cy, r0: 4, r: 48, a0: f.dir > 0 ? -1.3 : Math.PI - 1.0, a1: f.dir > 0 ? 1.0 : Math.PI + 1.3 } : { shape: 'circle', x: f.x + f.dir * 8, y: cy, r: 15 };
        if (touches(sh, m.x - (m.r || 5), m.y - (m.r || 5), (m.r || 5) * 2, (m.r || 5) * 2)) flipLever(s, m, 'warden');
      }
      emit(s, m.id, !!m.on);
    },

    // A conveyor floor: whatever rests on it is carried along, `v` cells a
    // frame (sign is the way). Frozen sand on it holds fast (and holds back
    // what is behind it). `when`: runs only on that signal; `flip`: a signal
    // that turns it the other way.
    belt(s, m) {
      if (!m.ready) { m.ready = true; m.h = m.h || 3; fillRect(s, m, SLICK); m.acc = 0; }
      const run = m.when == null || wants(s, m);
      m.running = run;
      if (!run) return;
      const v = m.flip != null && sig(s, m.flip) ? -m.v : m.v;
      m.dirNow = Math.sign(v);
      m.acc += Math.abs(v);
      const W = s.W, d = Math.sign(v);
      while (m.acc >= 1) {
        m.acc -= 1;
        // stacks on the belt move one cell, the leading end first
        for (let x = d > 0 ? m.x + m.w - 1 : m.x; x >= m.x && x < m.x + m.w; x -= d) {
          for (let y = m.y - 1; y >= 0; y--) {
            const j = s.pid[y * W + x]; if (j < 0) break;
            if (s.state[j] !== 1) break;                       // frozen: an anchor; what is above it stays too
            if (freeCell(s, x + d, y)) moveGrain(s, j, x + d, y);
            else break;
          }
        }
        for (const f of s.foes || []) if (!f.dead && FOE_WEIGHT[f.kind] && f.x >= m.x && f.x < m.x + m.w && Math.abs(f.y - (m.y - 1)) <= 1.5 && !actorSolid(s, Math.round(f.x + d * 4), Math.round(f.y) - 2)) f.x += d;
        for (const c of s.mechs) if (c.kind === 'crate' && c.ready && c.y + c.h === m.y && c.x + c.w > m.x && c.x < m.x + m.w) moveBlock(s, c, d, 0, {});
      }
    },

    // A steady current in a box. `dir` [dx, dy], `force` per frame (gravity
    // is 0.3, so an updraft needs more than that to lift). Sand in the air
    // feels it fully, sand on the ground a little. It bends Q bolts toward
    // its flow and pushes small creatures. `when`: blows only on that signal.
    wind(s, m) {
      m.on = wants(s, m);
      if (!m.on) return;
      const dx = m.dir[0], dy = m.dir[1], F = m.force == null ? 0.22 : m.force, cap = m.max || 7;
      for (let i = 0; i < s.N; i++) {
        if (s.state[i] !== 1 || s.px[i] < m.x || s.px[i] >= m.x + m.w || s.py[i] < m.y || s.py[i] >= m.y + m.h) continue;
        const k = s.solid(s.px[i], s.py[i] + 1) ? 0.4 : 1;
        // it pushes up to its own speed `max`, and never brakes what already moves faster with it
        if (dx && s.vx[i] * dx < cap) s.vx[i] = dx * Math.min(cap, s.vx[i] * dx + F * k);
        if (dy && s.vy[i] * dy < cap) s.vy[i] = dy * Math.min(cap, s.vy[i] * dy + F * (dy < 0 ? 1 : k));   // rising air lifts from the floor up
      }
      const wa = Math.atan2(dy, dx);
      for (const q of s.bolts || []) {
        if (q.wait > 0 || q.x < m.x || q.x >= m.x + m.w || q.y < m.y || q.y >= m.y + m.h) continue;
        let d = wa - q.a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        q.a += Math.sign(d) * Math.min(Math.abs(d), F * 0.1);
      }
      for (const f of s.foes || []) {
        if (f.dead || f.x < m.x || f.x >= m.x + m.w || f.y < m.y || f.y >= m.y + m.h + 2) continue;
        if (f.kind === 'gnat' || f.kind === 'diver') {
          const nx = f.x + dx * F * 6, ny = f.y + dy * F * 6;
          if (!actorSolid(s, Math.round(nx), Math.round(ny))) { f.x = nx; f.y = ny; }
        } else if (f.kind === 'mite' && dx && !actorSolid(s, Math.round(f.x + dx * 4), Math.round(f.y) - 2) && actorSolid(s, Math.round(f.x + dx * 4), Math.round(f.y) + 1)) f.x += dx * F * 1.5;
      }
    },

    // A brazier: a fire that eats loose sand that reaches its flame. Pack
    // frozen sand into the bowl (or slam a heap down onto it) and it goes
    // out; it relights `out` frames later once the bowl is clear. Its light
    // can hold a light bridge (its `id` is on while it burns). Gnats are
    // drawn to it, and anything in the flame is burned.
    brazier(s, m) {
      const r = m.r || 6, bx = m.x - r, by = m.y - r * 2, bw = r * 2 + 1, bh = r * 2 + 1;
      if (!m.ready) { m.ready = true; m.lit = m.lit !== false; m.outT = 0; s.light(m.x, m.y - r, 1.0, 0.55, 0.22, m.lightR || 110, 0.5); m.L = s.lights[s.lights.length - 1]; }
      if (m.lit) {
        let eaten = 0;
        for (let i = 0; i < s.N && eaten < (m.eat || 3); i++) {
          if (s.state[i] !== 1 || s.px[i] < bx || s.px[i] >= bx + bw || s.py[i] < by || s.py[i] >= by + bh) continue;
          s.killAt(s.py[i] * s.W + s.px[i]); eaten++; m.ate = (m.ate || 0) + 1;
          if (m.ate % 5 === 0) s.events.push({ type: 'burn', x: m.x, y: m.y });
        }
        if (frozenIn(s, bx, by, bw, bh) >= (m.need || 10)) smother(s, m, 'frozen');
        for (const f of s.foes || []) {
          if (f.dead) continue;
          const d = Math.hypot(f.x - m.x, foeBox(f).cy - (m.y - r));
          if (f.kind === 'gnat' && d < (m.lure || 70) && f.mode !== 'flee' && f.home) { const hx = m.x - f.home.x, hy = m.y - r - f.home.y, hd = Math.hypot(hx, hy) || 1; f.home.x += hx / hd * Math.min(0.3, hd); f.home.y += hy / hd * Math.min(0.3, hd); }   // a moth to the flame: its hover drifts into the fire
          if (foesIn(s, bx, by, bw, bh).includes(f) && !(f.burnT > s.frame)) { f.burnT = s.frame + 20; envHit(s, m, f, 'burn', 2, 2); }
        }
      } else {
        if (m.outT > 0) m.outT--;
        else if (countIn(s, bx, by, bw, bh) < (m.need || 10) / 2) { m.lit = true; s.events.push({ type: 'relight', x: m.x, y: m.y }); }
      }
      if (m.L) m.L.radius = m.lit ? (m.lightR || 110) : 0;
      emit(s, m.id, m.lit);
    },

    // Blocks that stand only while their signal is on (`invert`: only while
    // it is off): light bridges held by a lamp or brazier, switch blocks.
    // Sand inside when they form is pushed up out of them; they wait for a
    // creature to step clear before they form.
    phase(s, m) {
      const on = wants(s, m), mat = m.mat || GLASS, W = s.W;
      if (on === m.solid) return;
      if (on) {
        for (const r of m.rects) if (foesIn(s, r[0], r[1], r[2], r[3]).length) return;
        for (const r of m.rects) for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) {
          const c = y * W + x, j = s.pid[c];
          if (j >= 0) { let yy = r[1] - 1; while (yy >= 0 && !freeCell(s, x, yy)) yy--; if (yy >= 0 && yy > r[1] - 24) moveGrain(s, j, x, yy); else s.killAt(c); }
          if (s.g[c] === 0) s.g[c] = mat;
        }
        s.events.push({ type: 'phaseIn', x: m.rects[0][0], y: m.rects[0][1] });
      } else {
        for (const r of m.rects) for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) if (s.g[y * W + x] === mat) s.g[y * W + x] = 0;
        s.events.push({ type: 'phaseOut', x: m.rects[0][0], y: m.rects[0][1] });
      }
      m.solid = on; s.terrainVersion++;
    },

    // Signal logic. Its output (`id`) follows its input (`when`/`logic`/
    // `invert`) after `delay` frames; with `pulse`, a rising input gives an
    // output that lasts that long. `seq`: a list of ids that must turn on in
    // that order (a wrong one starts it over); then it stays on.
    relay(s, m) {
      if (m.seq) {
        const last = m.prev || (m.prev = {});
        for (const id of m.seq) {
          const now = sig(s, id), rose = now && !last[id]; last[id] = now;
          if (!rose || m.done) continue;
          m.idx = m.idx || 0;
          if (id === m.seq[m.idx]) { m.idx++; s.events.push({ type: 'seqStep', id, k: m.idx, of: m.seq.length }); }
          else { m.idx = id === m.seq[0] ? 1 : 0; s.events.push({ type: 'seqWrong', id }); }
          if (m.idx >= m.seq.length) m.done = true;
        }
        emit(s, m.id, !!m.done); return;
      }
      const inp = wants(s, m), rose = inp && !m.last; m.last = inp;
      const Q = m.q || (m.q = []);
      if (m.pulse) { if (rose) Q.push({ at: s.frame + (m.delay || 0), v: true }, { at: s.frame + (m.delay || 0) + m.pulse, v: false }); }
      else if (inp !== m.want) { m.want = inp; Q.push({ at: s.frame + (m.delay || 0), v: inp }); }
      while (Q.length && Q[0].at <= s.frame) m.out = Q.shift().v;
      emit(s, m.id, !!m.out);
    },

    ring(s, m) { if (!m.ready && --m.t <= 0) { m.ready = true; s.events.push({ type: 'ringReady', x: m.x, y: m.y }); } },

    // A dart trap in a wall: every `period` frames (with a ~0.7 s warning) it
    // fires a dart along `dir`. A dart bites through loose sand (up to `bite`
    // grains), stops on frozen sand, and hurts creatures. Freeze just as it
    // lands and it is parried: it flies back the way it came, harder, and can
    // hit creatures, targets and levers on the way.
    dart(s, m) {
      if (m.ready == null) { m.ready = true; m.darts = []; }
      const T = m.period || 150, tt = (s.frame + (m.phase || 0)) % T, warn = m.warn || 42;
      m.warnLeft = T - tt <= warn ? T - tt : 0;
      if (tt === 0 && s.frame > 0 && (m.when == null || wants(s, m))) {
        m.darts.push({ x: m.x + m.dir[0] * 2, y: m.y + m.dir[1] * 2, dx: m.dir[0], dy: m.dir[1], v: m.speed || 4, bit: 0, back: false, id: 0, life: m.len || 400 });
        s.events.push({ type: 'dartFire', x: m.x, y: m.y });
      }
      const W = s.W;
      for (const d of m.darts) {
        for (let k = 0; k < d.v && !d.gone; k++) {
          d.x += d.dx; d.y += d.dy; d.life--;
          const x = Math.round(d.x), y = Math.round(d.y);
          if (!s.inb(x, y) || s.blocks(y * W + x) || d.life <= 0) { d.gone = true; s.events.push({ type: 'dartBreak', x, y }); break; }
          const j = s.pid[y * W + x];
          if (j < 0) continue;
          if (s.state[j] === 2) {
            if (!d.back && parried(s)) {
              d.back = true; d.dx = -d.dx; d.dy = -d.dy; d.v = (m.speed || 4) * 1.5; d.life = m.len || 400; d.hitId = null;
              s.events.push({ type: 'parry', x, y, what: 'dart' });
            } else { d.gone = true; s.events.push({ type: 'dartBlock', x, y }); }
            break;
          }
          if (!d.back) { s.killAt(y * W + x); if (++d.bit >= (m.bite || 6)) { d.gone = true; break; } }
        }
      }
      m.darts = m.darts.filter((d) => !d.gone);
    },

    // A moving platform of stone along one straight path (`to`: [dx, dy] from
    // where it starts). `mode`: 'loop' (back and forth, waiting `wait` at
    // each end), 'ride' (sets off when `need` grains rest on it, goes back
    // when they are gone), 'signal' (out while `when` is on). It carries what
    // rides it; frozen sand in its way braces it.
    mover(s, m) {
      if (!m.ready) {
        m.ready = true; m.mat = m.mat || WALL; m.x0 = m.x; m.y0 = m.y; m.L = Math.abs(m.to[0]) + Math.abs(m.to[1]);
        m.ux = Math.sign(m.to[0]); m.uy = Math.sign(m.to[1]); m.pos = 0; m.goal = 0; m.t = 0; m.acc = 0; fillRect(s, m, m.mat);
      }
      const mode = m.mode || 'loop';
      if (mode === 'loop') { if (m.pos === m.goal && ++m.t >= (m.wait || 60)) { m.goal = m.goal ? 0 : m.L; m.t = 0; } }
      else if (mode === 'ride') { m.weight = countIn(s, m.x, m.y - 14, m.w, 14); m.goal = m.weight >= (m.need || 20) ? m.L : (m.weight === 0 && ++m.t > (m.wait || 40) ? 0 : m.goal); if (m.weight) m.t = 0; }
      else m.goal = wants(s, m) ? m.L : 0;
      if (m.pos === m.goal) { m.moving = 0; return; }
      const dir = m.goal > m.pos ? 1 : -1;
      m.acc += dir > 0 ? (m.speed || 0.5) : (m.back || m.speed || 0.5);
      while (m.acc >= 1 && m.pos !== m.goal) {
        m.acc -= 1;
        const r = moveBlock(s, m, m.ux * dir, m.uy * dir, { foe: (f) => { if (m.uy * dir < 0) return false; f.x += m.ux * dir * 2; return !!m.ux; } });
        if (r !== 'ok') { if (m.stuck !== r) s.events.push({ type: 'moverStop', x: m.x, y: m.y, by: r }); m.stuck = r; m.acc = 0; break; }
        m.stuck = null; m.pos += dir; m.moving = dir;
      }
    },
  };

  // ---- what each mechanism sees of this frame's blows (runs every frame,
  // after the player's attacks are placed, before creatures take them) ----
  const react = {
    crackWall(s, m) {
      if (m.broken) return;
      const pad = 6, face = m.face || 'any';
      const ok = (dx, dy) => face === 'any' || (face === 'left' && dx > 0.35) || (face === 'right' && dx < -0.35) || (face === 'top' && dy > 0.35) || (face === 'bottom' && dy < -0.35);
      for (const sl of s.slams) {
        if (sl.x < m.x - pad || sl.x > m.x + m.w + pad || sl.y < m.y - pad || sl.y > m.y + m.h + pad) continue;
        if (!ok(sl.dx, sl.dy)) { s.events.push({ type: 'crackHold', x: sl.x, y: sl.y, face, why: 'side' }); continue; }
        if (sl.power < (m.power || 0)) { s.events.push({ type: 'crackHold', x: sl.x, y: sl.y, face, why: 'weak' }); continue; }
        if (--m.hp <= 0) breakWall(s, m, 'slam'); else s.events.push({ type: 'crack', x: sl.x, y: sl.y, left: m.hp });
        if (m.broken) return;
      }
      if (m.hammer && (face === 'top' || face === 'any')) for (const h of blowsOn(s, m, m.x, m.y, m.w, m.h, ['hammer'])) if (h.dmg >= 4) { breakWall(s, m, 'hammer'); return; }
      // a Warden's lunge that ran into it
      if (m.warden !== false) for (const f of s.foes || []) {
        if (f.dead || f.kind !== 'warden' || f.atkName !== 'lunge' || !(f.mode === 'active' || (f.mode === 'recover' && f.t <= 1))) continue;
        const ax = f.dir > 0 ? f.x + 1 : f.x - 15;
        if (ax + 14 >= m.x && ax <= m.x + m.w && f.y - 30 <= m.y + m.h && f.y >= m.y && ((face === 'left' && f.dir > 0) || (face === 'right' && f.dir < 0) || face === 'any')) { breakWall(s, m, 'warden'); f.stun = 0; return; }
      }
    },
    crate(s, m) {
      if (!m.ready) return;
      for (const sl of s.slams) {
        // a side slam whose blast reaches it, travelling toward it
        const gx = Math.max(m.x, Math.min(m.x + m.w, sl.x)) - sl.x, gy = Math.max(m.y, Math.min(m.y + m.h, sl.y)) - sl.y;
        if (Math.abs(sl.dx) <= 0.35 || Math.hypot(gx, gy) > Math.max(8, sl.r * 0.6) || (gx && Math.sign(gx) !== Math.sign(sl.dx))) continue; m.vx = Math.sign(sl.dx) * (2.2 + sl.power * 2.5); s.events.push({ type: 'crateShove', x: m.x + m.w / 2, y: m.y + m.h / 2 });
      }
      for (const h of blowsOn(s, m, m.x, m.y, m.w, m.h, ['burst', 'hammer', 'shock', 'lash', 'blade'])) {
        const push = { burst: 1.6, hammer: 2.6, shock: 1.4, lash: 0.9, blade: 0.8 }[h.kind];
        const d = h.dir || Math.sign(m.x + m.w / 2 - h.x) || 1;
        if (Math.abs(m.vx) < push) m.vx = d * push;
        s.events.push({ type: 'crateShove', x: m.x + m.w / 2, y: m.y + m.h / 2 });
      }
    },
    target(s, m) {
      if (m.on) return;
      const r = m.r || 5, kinds = m.kinds || ['lash', 'shard', 'dart', 'dive'];
      for (const h of blowsOn(s, m, m.x - r, m.y - r, r * 2, r * 2, kinds)) {
        if (h.kind === 'dart' && !h.back) continue;
        if (h.kind === 'shard' && m.far) continue;
        if (h.kind === 'lash' && (h.far || 0) < (m.far || 0)) { s.events.push({ type: 'targetGlance', x: m.x, y: m.y, far: h.far || 0, need: m.far }); continue; }
        lightTarget(s, m, h.kind); return;
      }
      if (kinds.includes('dive')) for (const f of s.foes || []) if (!f.dead && f.kind === 'diver' && f.mode === 'dive' && Math.hypot(f.x - m.x, f.y - 5 - m.y) < r + 8) { lightTarget(s, m, 'dive'); return; }
    },
    lever(s, m) {
      const r = m.r || 5;
      for (const h of blowsOn(s, m, m.x - r, m.y - r, r * 2, r * 2, m.kinds || PLAYER_BLOWS.concat(['dart', 'crush']))) { if (h.kind === 'dart' && !h.back) continue; flipLever(s, m, h.kind); break; }
    },
    brazier(s, m) {
      if (!m.lit) return;
      const r = m.r || 6;
      for (const sl of s.slams) if (sl.dy > 0.35 && Math.abs(sl.x - m.x) < r + 8 && sl.y > m.y - r * 3 && sl.y < m.y + 4) { smother(s, m, 'slam'); return; }
    },
    ring(s, m) {
      const r = m.r || 10, T0 = s.throwNow;
      if (m.ready && T0 && !T0.done && T0.air && T0.n >= 25 && Math.hypot(T0.x - m.x, T0.y - m.y) < r) {
        s.airThrows = 3 + ((s.mod && s.mod.airThrows) || 0); s.throwCool = 0;
        m.ready = false; m.t = m.recharge || 180; s.events.push({ type: 'ringRefresh', x: m.x, y: m.y });
      }
      for (const q of s.bolts || []) if (q.kind === 'q' && !q.wait && Math.hypot(q.x - m.x, q.y - m.y) < r && !(q.rings || (q.rings = [])).includes(m.k)) {
        q.rings.push(m.k); q.dist = (q.dist || 0) + 90; s.events.push({ type: 'ringBolt', x: m.x, y: m.y });
      }
    },
    dart(s, m) {
      for (const d of m.darts || []) {
        d.hitId = d.hitId || ('D' + m.k + '.' + (m.hitN = (m.hitN || 0) + 1));
        s.hits.push({ kind: 'dart', shape: 'circle', x: d.x, y: d.y, r: Math.max(4, d.v), dmg: d.back ? 5 : 3, poise: d.back ? 6 : 3, id: d.hitId, dir: Math.sign(d.dx) || 1, back: d.back, env: true });
      }
    },
  };

  function breakGlass(s, m) {
    const W = s.W;
    for (let x = m.x; x < m.x + m.w; x++) for (let y = m.y; y < m.y + 2; y++) if (s.g[y * W + x] === GLASS) s.g[y * W + x] = 0;
    m.state = 'broken'; m.t = 0; s.terrainVersion++; s.events.push({ type: 'shatterGlass', x: m.x + m.w / 2, y: m.y });
  }
  react.crumble = function (s, m) {
    if (m.state === 'broken') return;
    for (const sl of s.slams) if (sl.dy > 0.35 && sl.x >= m.x - 4 && sl.x < m.x + m.w + 4 && Math.abs(sl.y - m.y) < 10) { breakGlass(s, m); return; }
    for (const h of blowsOn(s, m, m.x, m.y, m.w, 2, ['hammer'])) { breakGlass(s, m); return; }
  };
  function breakWall(s, m, by) {
    m.broken = true;
    clearRect(s, m, WALL);
    for (let x = m.x; x < m.x + m.w; x++) { let y = m.y + m.h - 1; if (s.inb(x, y) && s.g[y * s.W + x] === 0 && ((x * 7) % 3 === 0)) s.g[y * s.W + x] = RUBBLE; }   // a little rubble left lying
    s.events.push({ type: 'wallBreak', x: m.x + m.w / 2, y: m.y + m.h / 2, by });
    emit(s, m.id, true);
  }
  function lightTarget(s, m, by) {
    m.on = true; m.t = m.reset || 0;
    s.events.push({ type: 'targetHit', x: m.x, y: m.y, by });
    emit(s, m.id, true);
  }
  function flipLever(s, m, by) {
    if (m.cool > 0) return;
    m.on = !m.on || !!m.timer; m.t = m.timer || 0; m.cool = 24;
    s.events.push({ type: 'lever', on: m.on, x: m.x, y: m.y, by });
    emit(s, m.id, m.on);
  }
  function smother(s, m, by) {
    m.lit = false; m.outT = m.out || 360;
    s.events.push({ type: 'smother', x: m.x, y: m.y, by });
    emit(s, m.id, false);
  }

  function light(s, m, fresh) {
    m.lit = true;
    s.light(m.x, m.y - 6, 1.0, 0.62, 0.28, 150, 0.6);
    if (m.reveal) {
      const r = m.reveal;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (s.g[y * s.W + x] === WALL) s.g[y * s.W + x] = 0;
      s.terrainVersion++;
    }
    if (fresh) s.events.push({ type: 'lampLit', x: m.x, y: m.y });
    emit(s, m.id, true);
  }

  // ---- drawing hooks: plain shapes for whoever draws the world ----
  // marks(s): [{ kind, shape: 'rect'|'circle'|'line', x, y, w, h, r, x2, y2, on, k, dir, face, state }]
  //   (stone that moves is real terrain already; these say what it IS)
  // warnings(s): [{ id, x, y, left, size, ox }] in the same form as game.js's warnings()
  function marks(s) {
    const out = [];
    for (const m of s.mechs || []) {
      const R = (x, y, w, h, o) => out.push(Object.assign({ kind: m.kind, shape: 'rect', x, y, w, h }, o));
      const C = (x, y, r, o) => out.push(Object.assign({ kind: m.kind, shape: 'circle', x, y, r }, o));
      switch (m.kind) {
        case 'gate': R(m.door.x, m.door.y, m.door.w, m.door.h, { on: m.on, k: (m.door.openRows || 0) / m.door.h, state: m.door.braced ? 'braced' : m.closing ? 'closing' : '' }); break;
        case 'crackWall': if (!m.broken) R(m.x, m.y, m.w, m.h, { face: m.face || 'any', k: m.hp / (m.hpMax || 1) }); break;
        case 'crate': R(m.x, m.y, m.w, m.h, { k: Math.min(1, Math.abs(m.vx || 0) / 4) }); break;
        case 'crusher': R(m.x, m.y, m.w, m.h, { state: m.st, k: m.warnLeft ? 1 - m.warnLeft / (m.warn || 42) : 0 }); break;
        case 'target': C(m.x, m.y, m.r || 5, { on: !!m.on, k: m.far || 0 }); break;
        case 'lever': C(m.x, m.y, m.r || 5, { on: !!m.on, k: m.timer && m.on ? m.t / m.timer : 0 }); break;
        case 'belt': R(m.x, m.y, m.w, m.h || 3, { on: !!m.running, dir: m.dirNow || Math.sign(m.v) }); break;
        case 'wind': R(m.x, m.y, m.w, m.h, { on: !!m.on, dir: m.dir, k: m.force == null ? 0.22 : m.force }); break;
        case 'brazier': C(m.x, m.y - (m.r || 6), m.r || 6, { on: !!m.lit, k: m.lit ? 1 : (m.outT || 0) / (m.out || 360) }); break;
        case 'phase': for (const r of m.rects) R(r[0], r[1], r[2], r[3], { on: !!m.solid }); break;
        case 'ring': C(m.x, m.y, m.r || 10, { on: !!m.ready || m.ready == null }); break;
        case 'dart': out.push({ kind: 'dart', shape: 'line', x: m.x, y: m.y, x2: m.x + m.dir[0] * 4, y2: m.y + m.dir[1] * 4, k: m.warnLeft ? 1 - m.warnLeft / (m.warn || 42) : 0 });
          for (const d of m.darts || []) out.push({ kind: 'dartShot', shape: 'line', x: d.x, y: d.y, x2: d.x - d.dx * 4, y2: d.y - d.dy * 4, on: d.back }); break;
        case 'mover': R(m.x, m.y, m.w, m.h, { state: m.stuck || (m.moving ? 'moving' : ''), x2: m.x0 + m.to[0], y2: m.y0 + m.to[1] }); break;
        case 'plate': R(m.x, m.y - 2, m.w, 2, { on: !!m.pressed || m.latched }); break;
      }
    }
    return out;
  }
  function warnings(s) {
    const out = [];
    for (const m of s.mechs || []) {
      if (m.kind === 'crusher' && m.warnLeft > 0) out.push({ id: 'crush' + m.k, x: m.x + m.w / 2, y: m.y0 + m.h + (m.drop || 60) - 2, left: m.warnLeft, size: Math.min(1, m.w / 40) });
      if (m.kind === 'dart' && m.warnLeft > 0) out.push({ id: 'dart' + m.k, x: m.x + m.dir[0] * 6, y: m.y - 2, left: m.warnLeft, size: 0.35, ox: m.dir[0] || 0 });
    }
    return out;
  }

  const api = {
    make, marks, warnings, moveBlock,
    install(s, specs, saved) {
      s.signals = {}; s.mechHits = [];
      s.mechs = (specs || []).map((sp, k) => {
        const m = make(JSON.parse(JSON.stringify(sp)));
        m.k = k;
        if (m.plat) m.plat.off = 0;
        const sv = saved && saved[k];
        if (sv) {
          if (sv.latched) { m.latched = true; }
          if (sv.lit) { m.fed = m.need; light(s, m, false); }
          if (sv.broken) m.broken = true;
          if (sv.on) { m.on = true; m.done = true; }
        }
        if (m.kind === 'gate') {
          m.door.openRows = 0; fillRect(s, m.door, SLICK);
          if (m.latched) { clearRect(s, m.door, SLICK); m.door.openRows = m.door.h; }
        }
        return m;
      });
    },
    step(s) { for (const m of s.mechs || []) step[m.kind](s, m); },
    react(s) {
      if (s.mechHits && s.mechHits.length) { for (const h of s.mechHits) { if (h.foe) { h.x = h.foe.x; h.y = foeBox(h.foe).cy; delete h.foe; } s.hits.push(h); } s.mechHits.length = 0; }   // a blow follows the creature it was meant for (it may have been knocked aside)
      for (const m of s.mechs || []) if (react[m.kind]) react[m.kind](s, m);
    },
    save(s) { return (s.mechs || []).map((m) => ({ latched: m.latched, lit: m.kind === 'lamp' && m.lit, broken: !!m.broken, on: (m.kind === 'target' && m.on && !m.reset) || (m.kind === 'relay' && m.done) })); },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillMechs = api;
})(typeof window !== 'undefined' ? window : globalThis);
