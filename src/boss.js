// The Sieve: the creature at the bottom of every descent.
//
// You beat it by hurting it. Three eyes are set into the arena (on a pillar,
// on a hanging plate, on a far plinth); it opens one at a time to look for
// you, and a Strike that lands in an open eye wounds it. Ten wounds and
// it breaks. While it looks, it hunts:
//   - Teeth rise from the stretch of floor under most of your sand. Dust
//     shivers there first. Move, or freeze: frozen sand braces.
//   - Stones drop from the grate onto where you are (it leads you a little).
//     A crack opens and a shadow marks the spot first.
//   - When it is badly hurt, a blade sweeps the whole floor. Only sand up on
//     a ledge, or in the air, is safe; jump it with the slingshot.
// It turns faster and sheds still sand as it weakens, and an eye that shuts
// while you are standing on it bites. You need sand to fight: let it whittle
// you below forty-five grains and the fight is lost.
(function (root) {
  'use strict';
  const L = (typeof module !== 'undefined' && module.exports) ? require('./levels.js') : root.SpillLevels;
  const { lantern } = L.helpers;
  const WALL = 1, SPIKE = 5, STILL = 9;
  const FX = () => ((typeof module !== 'undefined' && module.exports) ? require('./fixtures.js') : root.SpillFixtures);   // terrain primitives (heaps of still sand at runtime)
  const SKY = 1, FRAME = 3;
  const CX = 240, CY = 132, RING = 96;
  const HP = 24;                       // a real fight: several openings, not two lucky hits (28 -> 24: playtest said a bit too strong for a level-1 boss)

  const EYES = [
    { x: 151, y: 190, w: 28 },     // on the left pillar
    { x: 228, y: 196, w: 28 },     // on the hanging plate
    { x: 371, y: 222, w: 28 },     // on the far plinth
  ];
  // floor stretches that can grow teeth (never under a pedestal)
  const SECTIONS = [[20, 78], [82, 140], [186, 242], [246, 302], [306, 356], [414, 462]];
  const OPEN = [330, 260, 210], REST = [110, 90, 70], GUARD = 70, WEIGHT = 7;
  const SLAM_WOUND = 1;   // a slam on the open eye: little damage; it cracks the guard and keeps the eye open longer (a window for the others)
  const SLAM_OPEN = 90;   // frames a slam on the eye adds to its open window
  const GUARD_CRACK = 3;   // blows on a raised guard that crack it (a burst counts 2; a hammer or slam breaks it outright)
  const STAR_WOUND = 1, STARS_ON_EYE = 9;   // the Super sends exactly this many stars down onto the open eye: 9 wounds of 24 hp = 37.5% of the bar (under the half-way phase line, so a cast can cross at most one phase boundary)   // the Super: at most this many wounds per cast, one per this many frames (stars fall over the guard)
  const WARN = 100, BITE = 100, BITE_EVERY = [340, 270, 210];
  const STONE_EVERY = [250, 190, 170], STONE_WARN = [72, 60, 50];
  const SWEEP_EVERY = 460, SWEEP_WARN = 80, SWEEP_SPEED = 2.4;

  const LID_WARN = 60, LID_HOLD = 70;   // a shut eye: warned for 1 s (its lamp flares amber), then teeth for 70 frames, then gone
  function clearLids(s) {
    for (const e2 of EYES) lid(s, e2, false);
    if (s.boss) s.boss.lids = [];
  }
  // An eye shutting: once it is angry, it shuts on teeth.
  function lid(s, e, on, teeth) {
    for (let x = e.x; x < e.x + e.w; x++) for (let y = e.y - 3; y < e.y; y++) {
      const c = y * s.W + x;
      if (on) {
        if (s.g[c] !== 0) continue;
        if (teeth) { s.killAt(c); s.g[c] = SPIKE; }
      } else if (s.g[c] === SPIKE) s.g[c] = 0;
    }
    s.terrainVersion++;
  }

  // The great sieve behind everything: a ring of stone and a turning grate
  // you can see the night through. Redrawn as it turns.
  function grate(s, angle) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    for (let y = CY - RING; y <= CY + RING; y++) for (let x = CX - RING; x <= CX + RING; x++) {
      const dx = x - CX, dy = y - CY, r = Math.hypot(dx, dy);
      if (r > RING || x < 16 || x >= 464 || y < 16 || y >= 250) continue;
      const c = y * s.W + x;
      if (r > RING - 9) { s.bg[c] = FRAME; continue; }
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      const m = (a) => ((a % 13) + 13) % 13;
      s.bg[c] = (m(u) < 3 || m(v) < 3 || r < 10) ? FRAME : SKY;
    }
  }

  // where most of the sand is (sampled), and how it is drifting
  function crowd(s) {
    let best = -1, bn = -1;
    for (let k = 0; k < 20; k++) {
      const i = Math.floor(s.rand() * s.N);
      if (s.state[i] !== 1) continue;
      let n = 0;
      for (let j = (k & 7); j < s.N; j += 8) if (s.state[j] === 1 && Math.abs(s.px[j] - s.px[i]) < 18 && Math.abs(s.py[j] - s.py[i]) < 18) n++;
      if (n > bn) { bn = n; best = i; }
    }
    return best >= 0 ? { x: s.px[best], y: s.py[best], vx: s.vx[best] } : null;
  }
  // the first thing below a point: terrain or a grain
  function surfaceBelow(s, x, y) {
    for (let yy = y; yy < s.H - 1; yy++) { const c = yy * s.W + x; if (s.blocks(c) || s.pid[c] >= 0) return yy; }
    return s.H - 1;
  }
  // A blow centred on (x,y): loose sand in reach is killed unless frozen sand lies between it and the blow; the
  // outermost frozen grains in reach are chipped instead (each costs the barrier 1) and use up the blow's `max`.
  // `evenFrozen` is no longer used: nothing turns ice back into loose sand to kill it.
  function killNear(s, x, y, r, max) {
    const cand = [];
    for (let yy = Math.round(y - r); yy <= y + r; yy++) for (let xx = Math.round(x - r); xx <= x + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= s.W || yy >= s.H || Math.hypot(xx - x, yy - y) > r) continue;
      const c = yy * s.W + xx, i = s.pid[c];
      if (i < 0 || (s.state[i] !== 1 && s.state[i] !== 2)) continue;
      cand.push([Math.hypot(xx - x, yy - y), c, xx, yy]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const q of cand) q.push(s.iceBetween(x, y, q[2], q[3]));          // who is behind ice is decided before the blow breaks any
    let n = 0;
    for (const [, c, , , shielded] of cand) {
      if (n >= max) break;
      if (s.pid[c] < 0 || shielded) continue;
      s.killAt(c); n++;
    }
    return n;
  }
  const TEETH_ICE = 14;          // the most ice one bite of teeth can chip
  function setTeeth(s, sec, on) {
    const [x0, x1] = SECTIONS[sec], W = s.W;
    let chips = 0;
    for (let x = x0; x < x1; x++) {
      const p = Math.abs(((x - x0) % 6) - 2.5) / 2.5, th = Math.max(1, Math.round(5 * (1 - p * 0.85)));
      // the teeth rise from the floor: the first ice in a column stops them (they chip it) and nothing above it is touched
      for (let y = 249; y >= 250 - th; y--) {
        const c = y * W + x;
        if (on) {
          if (s.g[c] !== 0) continue;
          const i = s.pid[c];
          if (i >= 0 && s.state[i] === 2) { if (chips < TEETH_ICE) { s.killAt(c); chips++; } break; }
          s.killAt(c); s.g[c] = SPIKE;
        } else if (s.g[c] === SPIKE) s.g[c] = 0;
      }
    }
    s.terrainVersion++;
  }
  // PHASE LINES: no single blow or cast may carry the Sieve across more than one phase line (75% and 50% of its hp), like the stagger /
  // phase-change walls of most action-game bosses: the Super and a lucky slam cannot skip the first half.
  function clampWound(s, B, amt) {
    // PHASE WALL: for 60 frames after it enters a new phase it takes nothing (it is reeling: the wound is a glance), and one blow or cast
    // can never carry it across more than one phase line (75%, 50%).
    if (s.frame < (B.wallUntil || 0)) { s.events.push({ type: 'bossGlance', x: CX, y: CY, wall: true }); return B.hp; }
    const line = B.hp > HP * 0.75 ? HP * 0.75 : B.hp > HP * 0.5 && !B.half ? HP * 0.5 : 0;
    return Math.max(line, B.hp - amt);
  }
  // Phase changes are entered the moment a wound crosses the line (from update() AND from every wound site), so a run of blows
  // cannot outrun the Sieve's reaction.
  function enterPhases(s, B) {
    if (!B.half && B.hp <= HP / 2) {
      B.half = true; B.roarT = 130;
      for (const b of B.bites) setTeeth(s, b.sec, false);
      B.bites = []; B.stones = []; B.sweep = null;
      clearLids(s); B.open = -1;
      s.events.push({ type: 'bossHalf', x: CX, y: CY });
    }
    const phase = B.half ? 2 : B.hp > HP * 0.75 ? 0 : 1;
    if (phase > B.phase) {
      B.phase = phase; B.wallUntil = s.frame + 60;
      s.events.push({ type: 'bossPhase', phase });
      const sec = SECTIONS[[1, 4, 2][B.shed++ % 3]];
      const before = countStill(s);
      FX().stillPile(s, Math.round((sec[0] + sec[1]) / 2), 250, 9, 5);                        // a modest pile at each phase change
      s.stillLeft += countStill(s) - before; s.hadStill = true; s.terrainVersion++;

      if (phase === 2) B.sweepT = 200;
    }

  }
  function countStill(s) { let n = 0; for (let i = 0; i < s.g.length; i++) if (s.g[i] === STILL) n++; return n; }
  // The Sieve sheds still sand: in a big pile at each phase change and a smaller one on every wound once it is angry, so the second
  // half visibly pours. Bounded: never more than STILL_CAP cells standing at once, never on top of your crowd, a few sections only.
  const STILL_CAP = 1500;
  function shedPile(s, halfW, h, avoid) {
    if (countStill(s) > STILL_CAP) return 0;
    const c = avoid ? crowd(s) : null;
    const order = [0, 1, 2, 3, 4, 5].sort(() => s.rand() - 0.5);
    for (const k of order) {
      const sec = SECTIONS[k], cx = Math.round((sec[0] + sec[1]) / 2);
      if (c && Math.abs(c.x - cx) < halfW + 14 && c.y > 200) continue;                  // not on your head
      const before = countStill(s);
      FX().stillPile(s, cx + ((s.rand() * 14) | 0) - 7, 250, halfW, h);
      const n = countStill(s) - before;
      s.stillLeft += n; s.hadStill = true; s.terrainVersion++;
      return n;
    }
    return 0;
  }
  // When it dies it pours out everything it held: a huge pile of still sand under its heart (left clear around x 240, where the portal rises).
  function bossDrop(s) {
    const before = countStill(s);
    for (const [cx, hw, h] of [[200, 28, 14], [280, 28, 14], [150, 18, 9], [330, 18, 9], [120, 12, 6], [360, 12, 6]]) FX().stillPile(s, cx, 250, hw, h);
    s.stillLeft += countStill(s) - before; s.hadStill = true; s.terrainVersion++;
    s.events.push({ type: 'bossDrop', x0: 112, x1: 368, y: 250, cells: countStill(s) - before });
  }
  function shedOnWound(s, B) { if (B.phase >= 1) B.shedCells = (B.shedCells || 0) + shedPile(s, 2 + B.phase, 2, true); }

  // for the Keeper: a calm moment in the fight (held for `hold` frames), and
  // whether a danger has shown itself yet
  function quiet(s, hold) {
    const B = s.boss;
    const calm = !!B && B.hp > 0 && B.open < 0 && !B.bites.length && !B.stones.length && !B.sweep;
    B && (B.calmT = calm ? (B.calmT || 0) + 1 : 0);
    return calm && B.calmT > hold && s.frame > 70;
  }
  function seen(s, k, now) { const B = s.boss; if (!B) return false; B.seen = B.seen || {}; if (now) B.seen[k] = true; return !!B.seen[k]; }
  const sieve = {
    id: 'sieve', name: 'The Sieve', boss: true,
    w: 480, h: 270, count: 600, reserve: 2400, par: [99999, 99999, 99999],   // (reserve: room for every still cell the Sieve can shed, STILL_CAP 1500 + the death drop, to be picked up)
    spawn: { x: 30, y: 20, w: 80, h: 58 }, camStart: { x: 120, y: 120 },
    camFloor: 246, camBottom: 270, fogY: 0, floorY: 250,
    keeper: [
      // The Keeper never talks over a fight in full swing: the intro is said at
      // the last shrine (game.js), or failing that in the first quiet gap
      // between eyes; each warning waits for a quiet gap after its danger has
      // been seen once. (Quiet: no eye open, no teeth, stones or sweep.)
      { id: 'sieve', when: (s) => s.boss && s.boss.last >= 0 && quiet(s, 20), lines: ['The Sieve. It takes from everyone who falls this far.', 'When an eye opens, strike it with {F}. Hurt it enough and it breaks.'] },
      { id: 'teeth', after: ['sieve'], when: (s) => seen(s, 'bite', s.boss && s.boss.bites.some((b) => b.t > 30)) && quiet(s, 30), lines: ['When the floor shivers, move. If you cannot, hold still and freeze.'] },
      { id: 'stone', after: ['sieve'], when: (s) => seen(s, 'stone', s.boss && s.boss.stones.length > 0) && quiet(s, 30), lines: ['A shadow on the ground means something is falling there.'] },
      { id: 'sweep', after: ['sieve'], when: (s) => seen(s, 'sweep', s.boss && s.boss.sweep && s.boss.sweep.t > 10) && quiet(s, 30), lines: ['Get off the floor. Climb, or throw yourself over it.'] },
    ],
    music: ['the_toll'],
    // you win by breaking it; you lose when there is too little of you to fight
    // where the Super's stars should find it: the open eye
    // A star landing in an eye: deterministic, one wound per star, no cap and no rate limit (the sim only sends a bounded
    // curtain over the eye, so the total is bounded by how many stars are sent: STARS_ON_EYE).
    // Open eye with its guard up, or a shut eye: nothing happens but a glance (art shows a deflect).
    starWound(s, x, y, kind) {
      const B = s.boss;
      if (!B || B.hp <= 0) return;
      if (kind !== 'open' || B.guard) { s.events.push({ type: 'bossGlance', x, y, star: true }); return; }
      const e = EYES[B.open];
      B.hp = clampWound(s, B, STAR_WOUND); enterPhases(s, B); B.hitsThisOpen++; B.flinch = 12; shedOnWound(s, B);
      if (s.stats) { s.stats.super.hits++; s.stats.super.damage += STAR_WOUND; }
      s.events.push({ type: 'bossHit', x, y, hp: B.hp, heavy: false, star: true }); s.comboHit(x, y, 'star');
      if (B.hp <= 0) { for (const b2 of B.bites) setTeeth(s, b2.sec, false); B.bites = []; B.stones = []; B.sweep = null; B.fx = []; clearLids(s); bossDrop(s); s.events.push({ type: 'bossDown' }); }
    },
    // which eye is at a point: 'open', 'shut', or null
    eyeHit(s, x, y) {
      const B = s.boss; if (!B) return null;
      for (let k = 0; k < EYES.length; k++) { const e = EYES[k]; if (Math.abs(x - (e.x + e.w / 2)) < e.w / 2 && Math.abs(y - (e.y - 6)) < 6) return k === B.open && B.hp > 0 ? 'open' : 'shut'; }
      return null;
    },
    // the open eye's centre if (x, y) is within `pad` of it (a bolt that bursts on the stone right beside the eye)
    eyeNear(s, x, y, pad) {
      const B = s.boss; if (!B || B.hp <= 0 || B.open < 0) return null;
      const e = EYES[B.open], ex = e.x + e.w / 2, ey = e.y - 6;
      return Math.abs(x - ex) < e.w / 2 + (pad || 14) && Math.abs(y - ey) < 16 ? { x: ex, y: ey } : null;
    },
    // lock target for Q's aim assist: the open eye's centre and a radius (its half width): the cone is measured from the eye's edge
    eyeTarget(s) { const B = s.boss; if (!B || B.hp <= 0 || B.open < 0) return null; const e = EYES[B.open]; return { x: e.x + e.w / 2, y: e.y - 6, r: e.w / 2 - 2 }; },
    eyeRect(s) { const B = s.boss; return B && B.hp > 0 && B.open >= 0 ? EYES[B.open] : null; },
    superTargets(s) { const B = s.boss; if (!B || B.hp <= 0 || B.open < 0) return []; const e = EYES[B.open]; return [{ x: e.x + e.w / 2, y: e.y - 6, spread: 10, w: e.w, stars: STARS_ON_EYE }]; },
    done: (s) => s.boss && s.boss.hp <= 0 && s.boss.downT > 90,
    failed: (s) => s.alive + s.pending < 45 && !(s.boss && s.boss.hp <= 0),
    build(s) {
      s.rect(0, 0, 480, 16, WALL); s.rect(0, 0, 16, 270, WALL); s.rect(464, 0, 16, 270, WALL); s.rect(0, 250, 480, 20, WALL);
      for (let x = 40; x < 104; x++) {
        const d = Math.abs(x - 72) / 32, depth = Math.round(16 * (1 - d * d) + ((x * 7) % 3));
        s.rect(x, 16 - depth, 1, depth, 0);
      }
      s.light(72, 22, 0.42, 0.52, 0.78, 190, 0);
      grate(s, 0);
      s.rect(16, 80, 104, 10, WALL); s.rect(16, 90, 30, 8, WALL); s.rect(16, 98, 18, 8, WALL);   // landing and corbel
      s.rect(150, 190, 30, 60, WALL);                       // left pillar
      s.rect(222, 196, 40, 10, WALL);                       // hanging plate on two chains
      for (let y = 16; y < 196; y++) { s.set(226, y, 30); s.set(257, y, 30); }
      s.rect(360, 222, 50, 28, WALL);                       // far plinth
      lantern(s, 104, 150, 90);
      lantern(s, 436, 130, 16);
      // low braziers along the floor, so the teeth and the blade are never hidden in the dark
      s.light(212, 240, 0.9, 0.55, 0.3, 90, 0.4); s.light(330, 240, 0.9, 0.55, 0.3, 90, 0.4); s.light(440, 240, 0.9, 0.55, 0.3, 80, 0.4);
      s.erode(0.03, [[16, 80, 104, 3], [147, 186, 40, 64], [218, 192, 48, 16], [356, 218, 58, 32], [0, 246, 480, 6]]);
      // a cold light in each eye, lit only while it is open
      s.eyeLights = EYES.map((e) => { s.light(e.x + e.w / 2, e.y - 4, 0.55, 0.85, 1.0, 120, 0.2); return s.lights[s.lights.length - 1]; });
      for (const Lm of s.eyeLights) { Lm.base = [Lm.r, Lm.g, Lm.b]; Lm.r = Lm.g = Lm.b = 0.02; }
      s.boss = { hp: HP, phase: 0, open: -1, openT: 60 * 4, last: -1, hitsThisOpen: 0, flinch: 0, hitBy: 0,
        biteT: 260, bites: [], stoneT: 200, stones: [], sweep: null, lids: [], sweepT: SWEEP_EVERY, angle: 0, fx: [], shed: 0, downT: 0, lookX: 120, lookY: 120 };
    },
    update(s) {
      const B = s.boss;
      if (!B) return;
      if (B.hp <= 0) { B.downT++; return; }
      const c = crowd(s);
      if (c) { B.lookX += (c.x - B.lookX) * 0.1; B.lookY += (c.y - B.lookY) * 0.1; }

      // --- wounds: a strike landing in an open eye
      // It is guarded for a moment after it opens (the pupil a slit), and only
      // a strike with weight behind it (enough grains landing) wounds it.
      B.guard = B.open >= 0 && OPEN[B.phase] - B.openT < GUARD && !B.guardBroken;
      // the Super: its stars rain on the open eye and wound it straight through the guard, a
      // limited number per cast. The eye is held open while they fall (it cannot shut on a barrage).
      const SU = s.superNow;
      if (SU && SU.t >= 20 && SU.t <= SU.rainEnd + 20) {
        if (B.open < 0) B.openT = Math.min(B.openT, 1);
        else { B.openT = Math.max(B.openT, 40); if (B.guard) B.openT = Math.min(B.openT, OPEN[B.phase] - GUARD - 1); }   // the cast outlasts the eye's guard (the world is held still, so its clock would never run it down)
      }
      // (the stars wound through starWound, called by the sim the moment one lands: update() only runs on world ticks, and the world is held still during the Super)
      // melee on an open eye: a blade cut wounds it (once its guard is down);
      // a hammer cracks the guard or wounds twice over
      if (B.open >= 0) for (const h of s.hits) {
        if (B.open < 0) break;                                       // a wound just carried it into its next phase and shut its eyes
        const e = EYES[B.open], ex = e.x + e.w / 2, ey = e.y - 6;
        // every real attack can wound an open eye: bursts, bolts and shards a little; the hammer and stars a lot
        // (a Q bolt wounds more the further it flew, a hammer the longer F was held, a shard by its size; a slam is 4 below)
        const DMG = { blade: () => 1, burst: () => 2, lash: () => Math.min(2, 1 + (h.far || 0)), shard: () => Math.max(0, Math.min(2, h.dmg || 0)),
          hammer: () => 3 + Math.round(Math.min(1, h.power == null ? 0.5 : h.power) * 2), shock: () => 1 };   // stars are handled with the Super below
        if (!(h.kind in DMG)) continue;
        if (h.kind === 'shard' && !(h.dmg > 0)) continue;                    // a small shard's burst is a shove, not a wound
        if ((B.hitIds || (B.hitIds = new Set())).has(h.id)) continue;
        if (typeof h.id === 'string' && h.id.endsWith('X') && B.hitIds && B.hitIds.has(h.id.slice(0, -1))) continue;   // a bolt's burst is the same blow as the bolt: one wound, not two
        const inR = h.shape === 'circle' ? Math.hypot(ex - h.x, ey - h.y) <= h.r + 8 : (() => { const d = Math.hypot(ex - h.x, ey - h.y); if (d < h.r0 - 6 || d > h.r + 8) return false; let a = Math.atan2(ey - h.y, ex - h.x); const mid = (h.a0 + h.a1) / 2; while (a < mid - Math.PI) a += Math.PI * 2; while (a > mid + Math.PI) a -= Math.PI * 2; return a >= h.a0 - 0.3 && a <= h.a1 + 0.3; })();
        if (!inR) continue;
        if ((h.kind === 'burst' || h.kind === 'blade' || h.kind === 'hammer' || h.kind === 'shock') && s.lineOfEffect && !s.lineOfEffect(h.x, h.y, ex, ey)) continue;   // stone or ice between the blow and the eye stops it
        B.hitIds.add(h.id); if (B.hitIds.size > 60) B.hitIds = new Set([...B.hitIds].slice(-30));
        if (B.guard && h.kind === 'hammer') { B.guardBroken = true; B.guard = false; s.events.push({ type: 'guardBreak', x: ex, y: ey }); s.comboHit(ex, ey, 'break'); continue; }
        if (B.guard) {                                              // the guard is worn down by every blow that lands on it: nothing is silent
          B.crack = (B.crack || 0) + (h.kind === 'burst' ? 2 : 1);
          if (B.crack >= GUARD_CRACK) { B.guardBroken = true; B.guard = false; B.flinch = 10; s.events.push({ type: 'guardBreak', x: ex, y: ey }); s.comboHit(ex, ey, 'break'); }
          else s.events.push({ type: 'bossGlance', x: ex, y: ey, crack: B.crack, of: GUARD_CRACK });
          continue;
        }
        const wound = DMG[h.kind]();
        if (s.sandCredit && (h.kind === 'burst' || h.kind === 'lash' || h.kind === 'shard')) s.sandCredit(2);
        { const key = { burst: 'f', blade: 'f', lash: 'q', shard: 'shards', hammer: 'hammer', shock: 'hammer' }[h.kind]; if (key && s.stats) { s.stats[key].hits++; s.stats[key].damage += wound; } }
        B.hp = clampWound(s, B, wound); enterPhases(s, B); B.hitsThisOpen++; B.flinch = 18; shedOnWound(s, B);
        s.events.push({ type: 'bossHit', x: ex, y: ey, hp: B.hp, heavy: wound >= 2 }); s.comboHit(ex, ey, h.kind);
        // too many blows and it slams the eye shut early (more allowed once its guard is cracked)
        if (B.hitsThisOpen >= (B.guardBroken ? 5 : 3)) B.openT = Math.min(B.openT, 14);
        if (B.hp <= 0) { for (const b2 of B.bites) setTeeth(s, b2.sec, false); B.bites = []; B.stones = []; B.sweep = null; B.fx = []; clearLids(s); bossDrop(s); s.events.push({ type: 'bossDown' }); return; }
      }
      // a slam that lands on an open eye: it cracks the guard, or if the eye
      // is already bare, wounds it twice over
      if (B.open >= 0) for (const sl of s.slams) {
        if (B.open < 0) break;
        const e = EYES[B.open];
        const ex = e.x + e.w / 2;
        // a circle, not a column: a slam on the floor far below the eye does not reach it (a full slam reaches 0.7 r + half the eye)
        if (Math.hypot(sl.x - ex, (sl.y == null ? e.y - 6 : sl.y) - (e.y - 6)) > sl.r * 0.7 + e.w / 2 - 2) continue;
        if (B.guard) { B.openT = Math.min(OPEN[B.phase], B.openT + SLAM_OPEN); B.guardBroken = true; B.guard = false; B.flinch = 10; s.events.push({ type: 'guardBreak', x: e.x + e.w / 2, y: e.y - 6 }); s.comboHit(e.x + e.w / 2, e.y - 6, 'break'); }
        else {
          B.hp = clampWound(s, B, SLAM_WOUND); enterPhases(s, B); B.hitsThisOpen++; B.flinch = 22; shedOnWound(s, B); if (s.stats) { s.stats.slam.hits++; s.stats.slam.damage += SLAM_WOUND; }
          if (B.hitsThisOpen >= (B.guardBroken ? 5 : 3)) B.openT = Math.min(B.openT, 14);       // like every other blow: too many and the eye slams shut
          else B.openT = Math.min(OPEN[B.phase], B.openT + SLAM_OPEN);                            // otherwise it holds the eye open longer
          s.events.push({ type: 'bossHit', x: e.x + e.w / 2, y: e.y - 6, hp: B.hp, heavy: true }); s.comboHit(e.x + e.w / 2, e.y - 6, 'crush');
          if (B.hp <= 0) { for (const b of B.bites) setTeeth(s, b.sec, false); B.bites = []; B.stones = []; B.sweep = null; B.fx = []; clearLids(s); bossDrop(s); s.events.push({ type: 'bossDown' }); return; }
        }
      }
      if (B.open >= 0) {
        const e = EYES[B.open];
        for (let i = 0; i < s.N; i++) {
          if (!s.strikeT[i] || s.state[i] !== 1 || s.superOf[i] || s.strikeOf[i] === B.hitBy) continue;   // (the Super's stars wound through the Super block above)
          if (s.px[i] >= e.x && s.px[i] < e.x + e.w && s.py[i] >= e.y - 12 && s.py[i] <= e.y + 2) {
            s.strikeT[i] = 0; s.vx[i] *= -0.3; s.vy[i] = -1;                 // the grain spends itself on the eye
            if (B.guard) { if (B.glance !== s.strikeOf[i]) { B.glance = s.strikeOf[i]; s.events.push({ type: 'bossGlance', x: e.x + e.w / 2, y: e.y - 6 }); } continue; }
            const id = s.strikeOf[i];
            if (B.weightOf !== id) { B.weightOf = id; B.weight = 0; }
            if (++B.weight < WEIGHT) continue;
            B.hitBy = id; B.hp--; B.hitsThisOpen++; B.flinch = 18;
            s.events.push({ type: 'bossHit', x: e.x + e.w / 2, y: e.y - 6, hp: B.hp });
            s.comboHit(e.x + e.w / 2, e.y - 6, 'lash');
            if (B.hp <= 0) {
              // it breaks: every hazard falls silent
              for (const b of B.bites) setTeeth(s, b.sec, false);
              B.bites = []; B.stones = []; B.sweep = null; B.fx = [];
              clearLids(s);
              bossDrop(s); s.events.push({ type: 'bossDown' });
              return;
            }
            if (B.hitsThisOpen >= (B.phase === 0 || B.guardBroken ? 2 : 1) + (B.guardBroken ? 1 : 0)) B.openT = Math.min(B.openT, 12);   // it flinches shut (later, if you cracked its guard)
            break;
          }
        }
      }
      if (B.flinch > 0) B.flinch--;

      // --- the half-life: at half its health it stops, every eye flares, the
      // grate spins hard, and it comes back in its final form
      enterPhases(s, B);
      if (B.roarT > 0) {
        B.roarT--; B.angle += 0.05;
        if (s.frame % 2 === 0) { grate(s, B.angle); s.terrainVersion++; }
        s.eyeLights.forEach((Lm) => { const f = 1.2 + Math.sin(s.frame * 0.4) * 0.5; Lm.r = Lm.base[0] * f; Lm.g = Lm.base[1] * f; Lm.b = Lm.base[2] * f; });
        B.fx = [];
        if (B.roarT === 0) { B.openT = 30; B.sweepT = 120; }
        return;
      }
      // --- phases by wounds: faster, angrier, and it sheds still sand

      // --- the turning grate
      B.angle += [0.004, 0.007, 0.011][B.phase];
      if (s.frame % 4 === 0) { grate(s, B.angle); s.terrainVersion++; }

      // --- eyes: one open at a time, with a breath between
      if (--B.openT <= 0) {
        if (B.open >= 0) {
          // an angry eye you did not wound shuts on teeth, but never without warning: its lamp flares
          // amber for a second, then the teeth rise where everyone can see them, and they are gone again
          if (B.phase >= 1 && B.hitsThisOpen === 0) {
            const e = EYES[B.open];
            B.lids.push({ eye: B.open, t: 0 });
            s.events.push({ type: 'lidWarn', eye: B.open, x0: e.x, x1: e.x + e.w, y: e.y });
          }
          B.last = B.open; B.open = -1; B.openT = REST[B.phase];
        } else {
          // it opens the eye farthest from your sand half the time: make you travel
          let next;
          if (c && s.rand() < 0.5) {
            let far = -1, fd = -1;
            EYES.forEach((e, k) => { const d = Math.abs(e.x + e.w / 2 - c.x); if (k !== B.last && d > fd) { fd = d; far = k; } });
            next = far;
          } else { do { next = Math.floor(s.rand() * 3); } while (next === B.last); }
          clearLids(s);                                   // the eye that left leaves nothing behind
          B.open = next; B.hitsThisOpen = 0; B.guardBroken = false; B.crack = 0;
          B.openT = OPEN[B.phase];
          s.events.push({ type: 'bossOpen', eye: next });
        }
      }
      s.eyeLights.forEach((Lm, k) => {
        const on = k === B.open, closing = on && B.openT < 60 && Math.floor(B.openT / 6) % 2 === 0;
        const L = B.lids.find((q) => q.eye === k);
        if (L) {                                                 // a shut eye with teeth coming: an amber flare, then a steady glow on the teeth
          const f = L.t < LID_WARN ? (Math.floor(L.t / 5) % 2 === 0 ? 1.9 : 0.35) : 1.3;
          Lm.r = 1.0 * f; Lm.g = 0.5 * f; Lm.b = 0.12 * f; return;
        }
        const f = on ? (closing ? 0.3 : B.flinch ? 1.8 : 1) : 0.02;
        Lm.r = Lm.base[0] * f; Lm.g = Lm.base[1] * f; Lm.b = Lm.base[2] * f;
      });

      B.fx = [];
      // --- shut eyes: warn, teeth, gone
      for (const L of B.lids) {
        const e = EYES[L.eye]; L.t++;
        if (L.t === LID_WARN) { lid(s, e, true, true); s.events.push({ type: 'teethUp', x0: e.x, x1: e.x + e.w, y: e.y }); }
        else if (L.t === LID_WARN + LID_HOLD) { lid(s, e, false); s.events.push({ type: 'teethDown', x0: e.x, x1: e.x + e.w, y: e.y }); L.done = true; }
      }
      B.lids = B.lids.filter((L) => !L.done);
      // --- teeth under the crowd
      if (--B.biteT <= 0) {
        const busy = (i) => B.bites.some((b) => b.sec === i);
        let target = -1;
        if (c && c.y > 225 && s.rand() < 0.5) SECTIONS.forEach(([x0, x1], i) => { if (c.x >= x0 - 6 && c.x <= x1 + 6 && !busy(i)) target = i; });
        if (target < 0) { const free = SECTIONS.map((_, i) => i).filter((i) => !busy(i)); target = free[Math.floor(s.rand() * free.length)]; }
        if (target >= 0) B.bites.push({ sec: target, t: 0 });
        if (B.phase === 2) { const free = SECTIONS.map((_, i) => i).filter((i) => !busy(i) && i !== target); if (free.length) B.bites.push({ sec: free[Math.floor(s.rand() * free.length)], t: 0 }); }
        B.biteT = BITE_EVERY[B.phase];
      }
      for (const b of B.bites) {
        b.t++;
        const [x0, x1] = SECTIONS[b.sec];
        if (b.t < WARN) { /* the warning is the flashing "!" drawn by the game, not marks on the floor */ }
        else if (b.t === WARN) { setTeeth(s, b.sec, true); s.events.push({ type: 'teethUp', x0, x1, y: 250 }); }
        else if (b.t === WARN + BITE) { setTeeth(s, b.sec, false); s.events.push({ type: 'teethDown', x0, x1, y: 250 }); }
      }
      B.bites = B.bites.filter((b) => b.t < WARN + BITE);

      // --- stones dropped where you are going
      if (--B.stoneT <= 0 && c) {
        const x = Math.max(24, Math.min(456, Math.round(c.x + c.vx * 18)));
        B.stones.push({ x, y: 17, vy: 0, t: 0, warn: STONE_WARN[B.phase] });
        if (B.half && (B.rain = ((B.rain || 0) + 1) % 3) === 0) for (const off of [-38, 38]) B.stones.push({ x: Math.max(24, Math.min(456, x + off)), y: 17, vy: 0, t: -16, warn: STONE_WARN[B.phase] + 14, small: true });   // in its final form, smaller stones fall either side, every other time
        B.stoneT = STONE_EVERY[B.phase] + Math.floor(s.rand() * 40);
        s.events.push({ type: 'stoneWarn', x });
      }
      for (const st of B.stones) {
        st.t++;
        if (st.t <= st.warn) { st.shadow = surfaceBelow(s, st.x, 18); continue; }
        st.vy = Math.min(7, st.vy + 0.32);
        const ny = st.y + st.vy;
        const hitAt = surfaceBelow(s, st.x, Math.round(st.y));
        if (hitAt <= ny + 2) {
          st.done = true;
          const n = killNear(s, st.x, hitAt, st.small ? 5 : 7, st.small ? 12 : 28);
          s.events.push({ type: 'impact', x: st.x, y: hitAt, v: 8 }); s.events.push({ type: 'stoneHit', x: st.x, y: hitAt, n });
        } else st.y = ny;
      }
      B.stones = B.stones.filter((st) => !st.done);

      // --- the sweep, once it is badly hurt
      if (B.phase === 2 && !B.sweep && --B.sweepT <= 0) {
        const fromLeft = c ? c.x > 240 : s.rand() < 0.5;
        B.sweep = { t: 0, dir: fromLeft ? 1 : -1, x: fromLeft ? 18 : 462 };
        s.events.push({ type: 'sweepWarn', dir: B.sweep.dir });
      }
      if (B.sweep) {
        const w = B.sweep; w.t++;
        if (w.t < SWEEP_WARN) { /* warned by the game's "!" */ }
        else {
          w.x += w.dir * SWEEP_SPEED;
          // the blade runs along the floor; the pedestals stand above it. Ice stops it: it grinds on the ice (one grain a frame)
          // until it is through, and nothing behind the ice is touched
          let iceAhead = null;
          for (let dx = 0; dx <= 4 && !iceAhead; dx++) { const x = Math.round(w.x) + w.dir * dx; for (let y = 243; y < 250; y++) if (x > 15 && x < 465 && s.frozenAt(x, y)) { iceAhead = [x, y]; break; } }
          if (iceAhead) { w.x -= w.dir * SWEEP_SPEED; s.killAt(iceAhead[1] * s.W + iceAhead[0]); }
          for (let dx = -3; dx <= 3; dx++) {
            const x = Math.round(w.x) + dx;
            if (iceAhead && (x - Math.round(w.x)) * w.dir >= (iceAhead[0] - Math.round(w.x)) * w.dir) continue;      // that side of the ice is shielded
            for (let y = 243; y < 250; y++) { const cc = y * s.W + x; if (x > 15 && x < 465 && s.pid[cc] >= 0 && s.state[s.pid[cc]] === 1) s.killAt(cc); }
          }
          if (w.x < 14 || w.x > 466) { B.sweep = null; B.sweepT = SWEEP_EVERY; }
        }
      }
    },
  };

  const api = { sieve, EYES, SECTIONS, HP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillBoss = api;
})(typeof window !== 'undefined' ? window : globalThis);
