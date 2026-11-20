// Fight animations: what the blows look like in the world, beside fightfx.js (which
// moves the lens). Everything is drawn on the world's pixel grid from hand-made
// pieces (vfx.js STAMPS, impacts.js sprites) or from the creatures' own pixels.
//   knockback   a struck creature shivers along the blow, leaves two afterimages while it
//               flies, and skids dust when it lands still moving
//   fall        a hard landing: a white crack along the floor, dust curling out both ways
//   crit        a four-point star that hollows and throws its spikes off as needles
//   slam        the burst turns to face whatever was struck: floor, wall or ceiling
//   hammer      a column of light out of the ground and two seams that glow along the floor
//   Q bolt      an arrowhead flicks off its nose each time it has flown far enough to hit
//               harder; a long shot's hit punches a lance through the target
//   F burst     the fan is drawn on the live hit arc, so what you see is what strikes
//   death       the creature comes apart into its own pixels, which bounce and settle
// Game.js wires it: FA.event(e) per sim event, FA.step(sim) per world tick,
// FA.note(f, rows, x, y) per drawn creature (returns a shake offset), FA.sprites().
(function (root) {
  'use strict';
  const HIT_MEMO = 16;
  // a sprite's outline: the drawn pixels that touch empty space
  function outline(rows) {
    const h = rows.length, w = rows[0].length, at = (r, c) => r >= 0 && r < h && c >= 0 && c < w && rows[r][c] !== '.';
    return rows.map((row, r) => [...row].map((ch, c) => (ch !== '.' && (!at(r - 1, c) || !at(r + 1, c) || !at(r, c - 1) || !at(r, c + 1))) ? 'x' : '.').join(''));
  }          // frames after a hit during which a creature counts as knocked

  class FightAnim {
    // ctx: { fx() -> vfx FX, anim(name, x, y, flip, rot), ground(x, y), solid(x, y), hold(n), shake(n), light(x, y, rad, warm, life) }
    constructor(ctx) { this.ctx = ctx; this.clear(); FightAnim.live = this; }
    clear() { this.f = 0; this.debris = []; this.ghosts = []; this.lastGhost = new WeakMap(); this.hitAt = new Map(); this.last = new Map(); this.fanE = null; this.fanId = null; this.sim = null; this.frostS = { seed: null, kind: 0, max: 0, cracks: [] }; }

    foeNear(x, y, dead) {
      let best = null, bd = 6;
      for (const f of (this.sim && this.sim.foes) || []) {
        if (!!f.dead !== !!dead) continue;
        const L = this.last.get(f), cx = f.x, cy = L ? L.y + L.rows.length / 2 : f.y - 5;
        const d = Math.min(Math.hypot(f.x - x, f.y - y), Math.hypot(cx - x, cy - y));
        if (d < bd) { bd = d; best = f; }
      }
      return best;
    }

    event(e, sim) {
      this.sim = sim;
      const C = this.ctx, FX = C.fx();
      if (!FX) return;
      switch (e.type) {
        case 'stun': {
          const f = this.foeNear(e.x, e.y, false) || this.foeNear(e.x, e.y, true);
          if (f) this.hitAt.set(f, { f: this.f, dir: e.dir || 1 });
          const far = e.far | 0;
          if (far >= 1) {
            // a long shot: a needle of light through the target, along the line it came in on
            FX.stamp(e.x, e.y, 'lance', 'sun', { flip: (e.dir || 1) < 0, cool: 1 });
            if (far >= 2) { FX.stamp(e.x, e.y, 'lance', 'sun', { rot: 1, cool: 2 }); C.hold(3); C.light(e.x, e.y, 80, true, 7); }
          }
          break;
        }
        case 'crit':
          FX.stamp(e.x, e.y, 'crit', 'sun', { cool: 2 });
          break;
        case 'fallDamage': {
          const f = this.foeNear(e.x, e.y, false) || this.foeNear(e.x, e.y, true);
          const gx = f ? f.x : e.x, gy = f ? C.ground(f.x, f.y - 1) : C.ground(e.x, e.y);
          const big = (e.dmg || 0) >= 4;
          C.anim('thud', gx, gy, false, 0);
          for (let k = 0; k < (big ? 6 : 3); k++) {
            const side = k & 1 ? 1 : -1, v = 1 + Math.random() * 1.6;
            FX.spark(gx + side * 3, gy - 1, side * v, -0.8 - Math.random() * 1.2, 'dust', 16 + Math.random() * 10, { l0: 1, g: 0.22, len: 1.2 });
          }
          if (big) FX.stamp(gx, gy - 2, 'crit', 'dust', { cool: 3 });
          C.hold(big ? 4 : 2); C.shake(big ? 3 : 1.5);
          break;
        }
        case 'slam': {
          // the burst faces away from what was struck: up off a floor, sideways off a wall, down off a ceiling
          const dx = e.dx || 0, dy = e.dy == null ? 1 : e.dy;
          let rot, x = e.x, y = e.y;
          if (Math.abs(dy) >= Math.abs(dx)) rot = dy > 0 ? 0 : 2; else rot = dx > 0 ? 3 : 1;
          if (rot === 0) y = C.ground(x, y);
          else {
            const sx = rot === 3 ? 1 : rot === 1 ? -1 : 0, sy = rot === 2 ? -1 : 0;
            for (let k = 0; k < 10 && !C.solid(Math.round(x + sx), Math.round(y + sy)); k++) { x += sx; y += sy; }
          }
          C.anim('slam', x, y, false, rot);
          // the reach of the slam, exactly: one torn front that settles on the hit circle's edge
          // (only the open side: the half facing away from what was struck)
          if (e.r) FX.ring(x, y, e.r * 0.55, e.r, 'sun', 11, { thick: 2.5, l0: 2, sq: 1, under: true, half: true, rot: rot * Math.PI / 2 });
          break;
        }
        case 'hammer': {
          const p = Math.min(1, e.power || 0), gy = C.ground(e.x, e.y - 2);
          FX.stamp(e.x, gy, 'pillar', 'sun', { cool: 2 });
          if (p > 0.9) FX.stamp(e.x, gy, 'pillar', 'sun', { cool: 4, delay: 3 });          // a full charge rings twice
          for (const side of [-1, 1]) {
            const pts = [], len = Math.round(e.r || 16 + p * 18);              // the seam runs exactly as far as the blow's hit circle
            let y = gy;
            for (let i = 1; i <= len; i++) {
              const x = Math.round(e.x + side * i);
              let ny = null;
              for (let d = -4; d <= 4; d++) if (!C.solid(x, y + d) && C.solid(x, y + d + 1)) { ny = y + d; break; }
              if (ny == null) break;
              y = ny;
              const h = Math.sin(i * 12.9898 + side * 78.233) * 43758.5453 % 1;
              pts.push({ x, y, fork: Math.abs(h) > 0.82 ? side : 0, spark: Math.abs(h) < 0.12 });
            }
            if (pts.length) FX.fissure(pts, 'sun', 40 + Math.round(p * 20));
          }
          break;
        }
        case 'kill': {
          // a frozen grain taken: the shield is struck there. Star cracks gather where the blows land
          if (!sim.freezeSeed) break;
          let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (sim.frozenAt(e.x + dx, e.y + dy)) { near = true; break; }
          if (!near) break;
          this.crack(e.x, e.y, 2.5);
          if ((this.f + e.x) % 3 === 0) FX.spark(e.x, e.y, (Math.random() - 0.5) * 2, -0.8 - Math.random(), 'frost', 12 + Math.random() * 6, { l0: 1, g: 0.2, len: 0.8 });
          break;
        }
        case 'shatter': {
          if (sim.freezeSeed) { this.crack(e.x, e.y, 6); break; }
          // the shield gives way entirely: a cold star, and splinters of ice thrown off all round
          FX.stamp(e.x, e.y, 'crit', 'frost', { cool: 2 });
          for (let k = 0; k < 12; k++) { const b = (k / 12) * Math.PI * 2 + Math.random() * 0.4, v = 2 + Math.random() * 2.5; FX.spark(e.x, e.y, Math.cos(b) * v, Math.sin(b) * v - 0.6, 'frost', 14 + Math.random() * 10, { l0: 0, g: 0.16, len: 1.6 }); }
          C.light(e.x, e.y, 70, false, 8);
          break;
        }
        case 'foeDie': {
          const f = this.foeNear(e.x, e.y, true), L = f && this.last.get(f);
          if (L) this.shatter(L, f, e.tier === 'warden');
          break;
        }
      }
    }

    // a blow on the ice: a new star crack, or a longer one where cracks already are
    crack(x, y, grow) {
      const L = this.frostS.cracks;
      const c = L.find((c) => Math.hypot(c.x - x, c.y - y) < 7);
      if (c) { c.to = Math.min(18, c.to + grow); return; }
      L.push({ x, y, len: 0, to: 4 + grow, seed: Math.random() * 6.2832 });
      if (L.length > 4) L.shift();
    }
    // what the renderer needs to draw this freeze (null when nothing is frozen)
    frost(sim) {
      const S = this.frostS, seed = sim.freezeSeed;
      if (!seed) { S.seed = null; S.cracks.length = 0; return null; }
      if (S.seed !== seed) {                                                    // a new freeze grows a new crystal
        S.seed = seed; S.max = 0; S.cracks.length = 0;
        let k = Math.floor(Math.random() * 5); if (k === S.kind) k = (k + 1 + Math.floor(Math.random() * 4)) % 5; S.kind = k;
      }
      S.max = Math.max(S.max, sim.freezeBarrier || 0);
      const worn = S.max ? Math.max(0, 1 - (sim.freezeBarrier || 0) / S.max) : 0;
      const cracks = new Float32Array(16);
      S.cracks.forEach((c, i) => cracks.set([c.x, c.y, c.len, c.seed], i * 4));
      return { kind: S.kind, x: seed.x, y: seed.y, reach: (() => { const t = sim.freezeT || 0; return 6 + 18 * Math.min(1, t / 5) + t * 2.2; })(), worn, cracks };   // the crystal's creep from the seed, grain by grain (renderer)
    }

    // a creature breaks into the pixels it was drawn with: flung from the middle and up,
    // white for the first frames, then their own colours, bouncing and settling, then gone
    shatter(L, f, big) {
      const rows = L.rows, h = rows.length, w = rows[0].length, cx = L.x + w / 2, cy = L.y + h / 2;
      let n = 0; for (const r of rows) for (const ch of r) if (ch !== '.') n++;
      const stride = Math.max(1, Math.ceil(n / (big ? 260 : 120)));
      const hit = this.hitAt.get(f), push = hit ? hit.dir : 0;
      let k = 0;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const ch = rows[r][c];
        if (ch === '.' || (k++ % stride)) continue;
        const x = L.x + c, y = L.y + r, rx = x - cx, ry = y - cy;
        this.debris.push({ x, y, vx: rx * (big ? 0.12 : 0.2) + push * (0.5 + Math.random() * 0.9) + (Math.random() - 0.5) * 0.8,
          vy: ry * 0.1 - (big ? 1.2 : 1.6) - Math.random() * (big ? 2.2 : 1.6), ch, t: 0, life: 50 + Math.random() * 45, rest: false });
      }
      if (this.debris.length > 900) this.debris.splice(0, this.debris.length - 900);
    }

    // called for every creature as it is drawn; returns how far to shiver it this frame
    note(f, rows, x, y) {
      this.last.set(f, { rows, x, y });
      const hit = this.hitAt.get(f);
      if (this.slowTrail && (!hit || this.f - hit.f > HIT_MEMO)) {
        // time slowed (game.js sets slowTrail): anything moving leaves a faint afterimage every few
        // cells, so the slowed motion reads (outline only; they fade in 5 world ticks)
        const sp2 = Math.abs(f.vx || 0) + Math.abs(f.vy || 0), g0 = this.lastGhost.get(f);
        if (sp2 > 0.5 && (!g0 || Math.abs(g0.x - x) + Math.abs(g0.y - y) >= 4)) { const g = { f, rows: outline(rows), x, y, age: 0, slow: true }; this.ghosts.push(g); this.lastGhost.set(f, g); }
        return 0;
      }
      if (!hit || this.f - hit.f > HIT_MEMO) return 0;
      const sp = Math.abs(f.vx || 0) + Math.abs(f.vy || 0);
      if (sp > 2.2 && f.tier !== 'warden') {
        const g0 = this.ghosts.find((g) => g.f === f && g.age === 0) || this.lastGhost.get(f);
        if (!g0 || Math.abs(g0.x - x) + Math.abs(g0.y - y) >= 3) { const g = { f, rows: outline(rows), x, y, age: 0 }; this.ghosts.push(g); this.lastGhost.set(f, g); }
      }
      return f.hurtT > 4 ? ((f.hurtT & 1) ? hit.dir : 0) : 0;            // a one-pixel shiver along the blow
    }

    step(sim) {
      this.sim = sim; this.f++;
      const C = this.ctx, FX = C.fx();
      if (!FX) return;
      // Q bolt: rank up as it flies (every 90 cells, +1 on the hit, up to +2)
      for (const q of sim.bolts || []) {
        if (q.kind === 'shard' || q.wait > 0) continue;
        const rank = Math.min(2, Math.floor((q.dist || 0) / 90));
        if (rank > (q._rank | 0)) {
          q._rank = rank;
          const v = q.v * 1.5;                                                   // thrown ahead of the nose, so the bolt chases it
          for (let j = 0; j < rank; j++) FX.stampDir(q.x + Math.cos(q.a) * (6 + j * 4), q.y + Math.sin(q.a) * (6 + j * 4), 'chev', q.a, 'sun', { vx: Math.cos(q.a) * v, vy: Math.sin(q.a) * v, drag: 0.8 });
          C.light(q.x, q.y, 40 + rank * 14, true, 4);
        }
        if (rank > 0) FX.core(q.x, q.y, 2 + rank * 0.6, 'sun', 2);               // a ranked bolt burns bigger
      }
      // F burst: keep the fan on the live arc while it strikes
      let burst = null;
      for (const h of sim.hits || []) if (h.kind === 'burst') { burst = h; break; }
      if (burst) {
        if (this.fanId !== burst.id || !this.fanE || FX.list.indexOf(this.fanE) < 0) { this.fanId = burst.id; this.fanE = FX.fan(burst.x, burst.y, burst.r, burst.a0, burst.a1, 'sun', 20); }
        Object.assign(this.fanE, { x: burst.x, y: burst.y, r: burst.r, a0: burst.a0, a1: burst.a1 });
        if (this.fanE.t > 4) this.fanE.t = 4;                                    // it holds the overshoot as long as it can still hit, then settles
      }
      // knocked creatures skid when they land still moving
      for (const [f, hit] of this.hitAt) {
        if (f.dead || this.f - hit.f > 40) { if (this.f - hit.f > 40) this.hitAt.delete(f); continue; }
        if (Math.abs(f.vx || 0) > 0.7 && C.solid(Math.round(f.x), Math.round(f.y) + 1) && (this.f & 1)) {
          FX.spark(f.x - Math.sign(f.vx) * 3, f.y, -Math.sign(f.vx) * (0.4 + Math.random() * 0.6), -0.5 - Math.random() * 0.7, 'dust', 12 + Math.random() * 8, { l0: 1, g: 0.18, len: 0.8 });
        }
      }
      for (const c of this.frostS.cracks) c.len += (c.to - c.len) * 0.35;      // cracks race out from the blow
      for (const g of this.ghosts) g.age++;
      this.ghosts = this.ghosts.filter((g) => g.age < 5);
      // debris: falls, bounces off the ground, slides to a stop
      for (const d of this.debris) {
        d.t++;
        if (d.rest) continue;
        d.vy = Math.min(4, d.vy + 0.18); d.vx *= 0.985;
        const nx = d.x + d.vx, ny = d.y + d.vy;
        if (C.solid(Math.round(nx), Math.round(ny))) {
          if (!C.solid(Math.round(nx), Math.round(d.y))) { d.x = nx; d.vy = -d.vy * 0.32; d.vx *= 0.6; if (Math.abs(d.vy) < 0.45) { d.vy = 0; if (Math.abs(d.vx) < 0.15) d.rest = true; } }
          else { d.vx = -d.vx * 0.4; }
        } else { d.x = nx; d.y = ny; }
      }
      this.debris = this.debris.filter((d) => d.t < d.life);
      for (const f of this.last.keys()) if (!sim.foes.includes(f)) this.last.delete(f);
    }

    // afterimages and debris (painted only on empty cells: sand and creatures read first)
    sprites() {
      const out = [];
      for (const g of this.ghosts) {
        // the silhouette's edge only, warm then dull, and broken up as it fades
        const L = this.last.get(g.f);
        if (L && Math.abs(L.x - g.x) + Math.abs(L.y - g.y) < 4) continue;      // still on top of the creature: not a trail yet
        const ch = g.slow ? (g.age < 2 ? 's' : 'l') : g.age < 2 ? 't' : 'c';      // slowed-time trails are cold, blow trails warm
        const rows = g.rows.map((r, ri) => [...r].map((c, ci) => (c === '.' || (g.age >= 2 && ((ri + ci + g.age) & 1)) || (g.age >= 4 && ((ri + ci) % 3))) ? '.' : ch).join(''));
        out.push({ x: g.x, y: g.y, rows });
      }
      for (const d of this.debris) {
        const left = d.life - d.t;
        if (left < 10 && (d.t & 1)) continue;                                   // it flickers out
        out.push({ x: Math.round(d.x), y: Math.round(d.y), rows: [d.t < 3 ? '8' : d.t < 9 ? 'd' : left < 18 ? 'c' : d.ch] });     // white, then lit sand, then its own colour
      }
      return out;
    }
  }
  root.SpillFightAnim = FightAnim;
  if (typeof module !== 'undefined' && module.exports) module.exports = FightAnim;
})(typeof window !== 'undefined' ? window : globalThis);
