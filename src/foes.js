// Things that live in the Tower and want your sand, in tiers:
//
//  bugs     small, single-purpose, die in a hit or two.
//           Mite   walks the floors, hunts sand and eats it a grain at a time.
//           Diver  hangs high; its eyes kindle, it leads you, then swoops
//                  through your sand. Parry the swoop and it tumbles.
//           Gnat   a swarm: each darts in, steals one grain and flies home
//                  with it. Swat a gnat that is carrying and the grain drops.
//  wardens  big, several attacks, a health bar. You can pass them by or put
//           them down. Every attack winds up (and shows where it will land),
//           strikes, and leaves an opening to punish.
//           Hourglass Warden  a glass-and-iron sentinel with a halberd:
//                  cleave, lunge and stamp.
//
// Health and poise: hits take health; enough hits close together break a
// creature's poise and it staggers (open, taking more). A parry (tapping
// freeze just as an attack lands) cancels the attack and staggers outright.
(function (root) {
  'use strict';
  const GRAV = 0.22, PARRY = 10;
  const STATS = {
    mite: { hp: 11, poise: 3, tier: 'bug', knockback: 1, stun: 1 },
    diver: { hp: 8, poise: 3, tier: 'bug', knockback: 1.15, stun: 0.9 },
    gnat: { hp: 2, poise: 1, tier: 'bug', knockback: 1.35, stun: 0.8 },
    dummy: { hp: 9999, poise: 3, tier: 'bug', knockback: 1, stun: 1 },
    warden: { hp: 60, poise: 16, tier: 'warden', knockback: 0.35, stun: 0.35 },
  };

  function make(spec, W, flipped) {
    const x = flipped ? W - 1 - spec.x : spec.x, st = STATS[spec.kind];
    return {
      kind: spec.kind, tier: st.tier, x, y: spec.y, vx: 0, vy: 0, dir: flipped ? -1 : 1, stun: 0, t: Math.floor(spec.delay || 0),
      mode: spec.kind === 'diver' ? 'hover' : spec.kind === 'gnat' ? 'swarm' : spec.kind === 'warden' ? 'idle' : 'walk',
      home: { x, y: spec.y }, tx: 0, ty: 0, eaten: 0, hit: 0, hits: new Set(), every: spec.every || 230,
      hp: Math.round(st.hp * (spec.hpMul || 1)), maxHp: Math.round(st.hp * (spec.hpMul || 1)), poise: st.poise, maxPoise: st.poise, knockback: st.knockback, stunRes: st.stun, hurtT: 0, dead: false, carry: 0, phase: Math.random() * 6.28,
      area: spec.area || null, cool: 60, atk: null, tele: null,
    };
  }

  const foeSolid = (s, x, y) => s.terrainSolid(x, y) || s.frozenAt(x, y);
  const walkable = (s, x, y) => foeSolid(s, x, y) && s.g[y * s.W + x] !== 5;
  const size = (f) => f.kind === 'warden' ? { hw: 11, hh: 15, cy: 15 } : f.kind === 'diver' ? { hw: 11, hh: 5, cy: 5 } : f.kind === 'gnat' ? { hw: 3, hh: 3, cy: 1 } : { hw: 10, hh: 5, cy: 5 };

  // ---- damage ----
  // F's jab: a small shove and a short pop, so the next tap still reaches (the tap reaches ~31 cells)
  const F_PUSH = 0.4, F_LIFT = 3.0, F_COMBO_PUSH = 0.35;
  const SHARD_PUSH = 0.5, SHARD_LIFT = 1.0;
  const LINK_WINDOW = 30;     // frames: a follow-up of a different kind within this lands as a link
  const STAGGER_IMMUNE = 120;   // frames after a stagger ends during which poise damage does nothing
  const F_FOLLOW = 1.45;     // a burst reaches this much further after a creature that is still reeling from the last one (so spamming F keeps landing)
  function damage(s, f, dmg, poise, dir, kind, power, far, soft) {
    if (f.dead) return;
    const staggered = f.mode === 'stagger';
    // ---- hidden links between different attacks (never shown in the UI) ----
    // Families: F (burst, blade, the burst's own grains), Q (bolt, shards), H (hammer, its shockwave), S (slam).
    // A blow of a DIFFERENT family within LINK_WINDOW frames (0.5 s) of the last blow on the same creature is a link: +1 damage,
    // +2 when it is a heavy finisher (hammer or slam). The same family three times running pays 20% less. And the more
    // different families are in the current combo, the more everything hits for (+12% per extra family, up to +36%).
    const fam = kind === 'burst' || kind === 'blade' || (soft && (kind === 'lash' || kind === 'juggle')) ? 'F' : kind === 'lash' || kind === 'shard' || kind === 'juggle' ? 'Q' : kind === 'hammer' || kind === 'shock' ? 'H' : kind === 'slam' || kind === 'bury' ? 'S' : null;
    f.linkStun = 0;
    if (fam) {
      const now = s.clock != null ? s.clock : s.frame, gap = now - (f.lastFamAt == null ? -999 : f.lastFamAt);
      if (f.lastFam && f.lastFam !== fam && gap <= LINK_WINDOW) {
        dmg += fam === 'H' || fam === 'S' ? 2 : 1;
        s.events.push({ type: 'link', x: f.x, y: f.y - 8, from: f.lastFam, to: fam, gap });
        f.famRun = 1;
      } else if (f.lastFam === fam && gap <= 45 && kind !== 'shard' && !soft) {
        f.famRun = (f.famRun || 1) + 1;
        if (f.famRun >= 3) dmg *= 0.8;
      } else if (f.lastFam !== fam) f.famRun = 1;
      f.lastFam = fam; f.lastFamAt = now;
      const bit = { F: 1, Q: 2, H: 4, S: 8 }[fam];
      s.combo.fam = ((s.combo.t > 0 ? s.combo.fam : 0) | 0) | bit;
      const variety = [1, 2, 4, 8].reduce((a, b) => a + ((s.combo.fam & b) ? 1 : 0), 0);
      dmg *= 1 + 0.12 * (variety - 1);
      if (variety > 1) f.linkStun = LINK_WINDOW + 6;
    }
    // the Warden's guard: a raised glass shield turns blade and lash from the
    // front; only a hammer or a slam breaks it (and breaking it staggers)
    if (f.mode === 'guard' && kind !== 'star') {   // stars fall from above, over any shield
      const front = Math.sign(dir) === -f.dir || dir === 0;
      if (kind === 'hammer' || kind === 'slam' || kind === 'bury') { s.events.push({ type: 'guardBreak', x: f.x, y: f.y - 15 }); stagger(s, f, 110); return; }
      if (front) { s.events.push({ type: 'block', x: f.x + f.dir * 10, y: f.y - 15 }); return; }
    }
    if (f.kind === 'warden') {
      f.recent = (f.recent || []).filter((t) => s.frame - t < 70); f.recent.push(s.frame);
      // three hits close together and it raises its guard (if it is not mid-attack)
      if (kind !== 'star' && f.recent.length >= 3 && (f.mode === 'idle' || f.mode === 'walk' || f.mode === 'recover')) { f.mode = 'guard'; f.t = 0; f.recent = []; s.events.push({ type: 'guardUp', x: f.x, y: f.y - 15 }); }
    }
    // a critical blow: rarer for small taps, likelier for a slam, a hit from behind, or a hit while it reels
    const behind = Math.sign(dir) === f.dir && f.tier === 'warden';
    const critP = (kind === 'slam' || kind === 'bury' ? 0.3 : kind === 'shard' || kind === 'hammer' ? 0.2 : 0.1) + (kind === 'slam' || kind === 'bury' ? Math.min(0.2, (power || 0) * 0.2) : 0) + (staggered || f.stun > 0 ? 0.15 : 0) + (behind ? 0.2 : 0) + Math.min(0.15, (s.combo.n || 0) * 0.015);
    const crit = s.rand() < critP;
    if (crit) { dmg *= 2; s.events.push({ type: 'crit', x: f.x, y: f.y - size(f).cy, dmg }); }
    if (s.sandCredit) { if (kind === 'burst') s.sandCredit(2); else if (kind === 'shard') s.sandCredit(2); else if (kind === 'lash' && !soft) s.sandCredit(2); }
    const hpBefore = f.hp;
    f.hp -= staggered ? dmg * 1.5 : dmg;
    { const key = fam === 'F' ? 'f' : fam === 'Q' ? (kind === 'shard' ? 'shards' : 'q') : fam === 'H' ? 'hammer' : fam === 'S' ? 'slam' : kind === 'star' ? 'super' : null;
      if (key && s.stats) { s.stats[key].hits++; if (hpBefore > f.hp) s.stats[key].damage += hpBefore - f.hp; } }
    // after a stagger it resists being staggered again for a while (no slam-lock): poise damage is ignored then
    if (s.frame >= (f.noStaggerUntil || 0)) f.poise -= poise;
    f.hurtT = 10;
    const heavy = kind === 'slam' || kind === 'bury' || kind === 'hammer';
    const slamPower = kind === 'slam' || kind === 'bury' ? Math.min(1, power || 0) : 0;
    const isSlam = kind === 'slam' || kind === 'bury';
    const push = f.tier === 'warden' ? 0.8 : isSlam ? 1.3 + slamPower * 0.6 : heavy ? 2.2 + slamPower * 1.4 : kind === 'burst' ? 1.5 : 1.1;   // a slam pops them UP, not away: the next blow still reaches
    f.vx = dir * push * f.knockback;
    if (f.tier !== 'warden') {
      const lift = isSlam ? 3.6 + slamPower * 1.4 : heavy ? 2.8 + slamPower * 1.6 : kind === 'lash' || kind === 'blade' ? 2.2 : 1.2;
      f.vy = Math.min(f.vy, -lift * f.knockback);
    }
    // the F burst knocks bugs up and away, so you can follow them into the air
    // (the burst's own flung grains count as the same blow: one soft shove, not a second one that doubles it)
    const volley = kind === 'shard' && f.tier !== 'warden';        // a volley of shards: each one shoves lightly so the next still finds it
    const jab = ((kind === 'burst' || soft) && f.tier !== 'warden') || volley;
    if (volley) { f.vx = dir * SHARD_PUSH * f.knockback; f.vy = Math.min(f.vy, -SHARD_LIFT * f.knockback); }
    else if (jab) { f.vx = dir * F_PUSH * f.knockback; f.vy = Math.min(f.vy, (f.stun > 0 || !foeSolid(s, Math.round(f.x), Math.round(f.y) + 1) ? -F_LIFT + 0.4 : -F_LIFT) * f.knockback); }
    if (f.carry && f.kind === 'gnat') { s.reviveGrain(Math.round(f.x), Math.round(f.y)); f.carry = 0; }
    s.events.push({ type: 'stun', x: f.x, y: f.y - size(f).cy, kind, dir, tier: f.tier, hp: f.hp, far: far || 0 });
    const cn = s.comboHit(f.x, f.y - size(f).cy, kind);
    if (f.tier !== 'warden') {
      const comboForce = Math.min(3.2, Math.max(0, cn - 1) * 0.65);
      f.vx += dir * comboForce * (jab ? F_COMBO_PUSH : 1) * f.knockback;
      if (!volley) f.vy = Math.min(f.vy, (-1.2 - comboForce * 0.9 * (jab ? F_COMBO_PUSH : 1)) * f.knockback);
    }
    if (f.kind === 'dummy') { f.best = Math.max(f.best || 0, cn); if (!f.measure) f.hp = 9999; }   // (test/damage.js sets f.measure to read real damage)
    if (f.hp <= 0) { f.dead = true; s.superCharge = Math.min(1, (s.superCharge || 0) + (f.tier === 'warden' ? 0.25 : 0.05) * (s.mod.superRate || 1));
      // a hungry lens: what it ate comes back to you
      for (let g = 0; g < (s.mod.killGrains || 0); g++) s.reviveGrain(Math.round(f.x + (g % 3) - 1), Math.round(f.y - 4 - (g / 3 | 0)));
      s.events.push({ type: 'foeDie', x: f.x, y: f.y - size(f).cy, kind: f.kind, tier: f.tier }); return; }
    const committed = f.mode === 'windup' && f.t > 12 || f.mode === 'active';     // once it commits, it does not flinch
    // stun depends on the creature: a bug is knocked senseless by any real hit;
    // a big creature only staggers once its poise is broken
    if (f.poise <= 0 && !committed) stagger(s, f, f.tier === 'warden' ? 100 : 90);
    else f.stun = Math.max(f.stun, f.tier === 'warden' ? 0 : Math.round(Math.max(26, f.linkStun || 0) * f.stunRes));       // a short reel; wardens shrug off single hits
  }
  function stagger(s, f, frames) {
    f.mode = 'stagger'; f.stun = frames; f.poise = f.maxPoise; f.atk = null; f.tele = null; f.t = 0;
    f.noStaggerUntil = s.frame + frames + STAGGER_IMMUNE;
    s.events.push({ type: 'stagger', x: f.x, y: f.y - size(f).cy, tier: f.tier });
  }

  // What hits a creature this frame: lash grains, a fast thrown clump, or a
  // melee shape (blade arc, hammer, slam).
  function inShape(h, x, y) {
    if (h.shape === 'circle') return Math.hypot(x - h.x, y - h.y) <= h.r;
    const d = Math.hypot(x - h.x, y - h.y);
    if (d < h.r0 || d > h.r) return false;
    let a = Math.atan2(y - h.y, x - h.x);
    const mid = (h.a0 + h.a1) / 2;
    while (a < mid - Math.PI) a += Math.PI * 2; while (a > mid + Math.PI) a -= Math.PI * 2;
    return a >= h.a0 && a <= h.a1;
  }
  function takeHits(s, f) {
    const z = size(f), cy = f.y - z.cy;
    for (const h of s.hits) {
      if (f.hits.has(h.id)) continue;
      const melee = h.kind === 'blade' || h.kind === 'burst' || h.kind === 'hammer' || h.kind === 'shock' || h.kind === 'slam';
      const closeMelee = melee && s.body && Math.hypot(f.x - s.body.x, cy - s.body.y) <= (s.body.r || 0) + 8;
      if (melee && !closeMelee && !s.lineOfEffect(h.x, h.y, f.x, cy)) continue;
      // test the creature's centre and its four edges
      const pts = [[f.x, cy], [f.x - z.hw, cy], [f.x + z.hw, cy], [f.x, cy - z.hh], [f.x, cy + z.hh]];
      const shape = h.kind === 'burst' && f.stun > 0 && f.tier !== 'warden' ? Object.assign({}, h, { r: h.r * F_FOLLOW }) : h;
      if (!pts.some(([x, y]) => inShape(shape, x, y))) continue;
      f.hits.add(h.id);
      damage(s, f, h.dmg, h.poise, h.dir || Math.sign(f.x - h.x) || 1, h.kind === 'slam' ? (f.stun > 0 ? 'bury' : 'slam') : h.kind, h.power, h.far);
    }
    const T0 = s.throwNow;
    for (let i = 0; i < s.N; i++) {
      if (s.state[i] !== 1 && s.state[i] !== 2) continue;
      const lash = s.strikeT[i] > 0;
      const floorThrow = T0 && !T0.fromAir && T0.dy > 0.35;
      const thrown = !lash && !floorThrow && T0 && !T0.done && s.thrownOf[i] === T0.id && Math.abs(s.vx[i]) + Math.abs(s.vy[i]) > 3;
      const falling = !lash && !floorThrow && !thrown && s.vy[i] > 3.2;                    // sand dropping hard onto it is a blow too
      const body = thrown || falling;
      if (!lash && !body) continue;
      if (Math.abs(s.px[i] - f.x) > z.hw || Math.abs(s.py[i] - cy) > z.hh) continue;
      const id = lash ? 'L' + s.strikeOf[i] : thrown ? 'B' + T0.id : 'F' + Math.floor(s.frame / 30);
      if (f.hits.has(id)) continue;
      f.hits.add(id);
      if (lash && !(s.superOf && s.superOf[i])) s.burn(i, 'foe');  // the grain bursts on the blow (and will reform at your pile)
      const inAir = !foeSolid(s, Math.round(f.x), Math.round(f.y) + 1);
      // only a real attack wounds; sand that just tumbles into a creature
      // knocks it about (and wears its poise) but never kills it by accident
      if (lash) damage(s, f, s.superOf && s.superOf[i] ? 2 : 1, s.superOf && s.superOf[i] ? 3 : 1, Math.sign(s.vx[i]) || 1, s.superOf && s.superOf[i] ? 'star' : inAir && f.stun > 0 ? 'juggle' : 'lash', 0, 0, !(s.superOf && s.superOf[i]));   // (only F's burst flings grains as lashes: Q's bolt carries its grains)
      else if (thrown) damage(s, f, 1, 1, Math.sign(s.vx[i]) || 1, 'body');          // a throw you aimed into it: a real blow (bugs are knocked senseless)
      else { f.poise -= 0.5; f.vx = (Math.sign(s.vx[i]) || 1) * 0.8; if (f.tier !== 'warden') f.vy = Math.min(f.vy, -0.8); f.hurtT = 4; }
    }
    if (f.hits.size > 40) f.hits = new Set([...f.hits].slice(-20));
  }

  // ---- shared helpers ----
  // What a creature may take or hunt. Frozen grains (state 2) are food by design: they are the
  // freeze barrier's hit points. A grain that is still loose is never touched while a freeze is
  // active: the wave takes a few frames to reach all of you, and you cannot move to save them.
  const takeable = (s, i) => s.state[i] === 2 || (s.state[i] === 1 && !s.freezeSeed);
  // What mites, gnats and divers may hunt and eat: loose sand only. Frozen sand is a wall to them (they
  // cannot eat it); only the heavy attacks that use cutSand chip the ice.
  const edible = (s, i) => s.state[i] === 1 && !s.freezeSeed;
  function nearestGrain(s, x, y, range) {
    let best = -1, bd = range;
    for (let i = (s.frame & 3); i < s.N; i += 4) {
      if (!edible(s, i)) continue;
      const d = Math.hypot(s.px[i] - x, s.py[i] - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function densest(s) {
    let best = -1, bn = -1;
    for (let k = 0; k < 24; k++) {
      const i = Math.floor(s.rand() * s.N);
      if (!edible(s, i)) continue;
      let n = 0;
      for (let j = (k & 7); j < s.N; j += 8) if (edible(s, j) && Math.abs(s.px[j] - s.px[i]) < 14 && Math.abs(s.py[j] - s.py[i]) < 14) n++;
      if (n > bn) { bn = n; best = i; }
    }
    return best;
  }
  function eatAround(s, x, y, r, max) {
    let n = 0;
    for (let yy = Math.round(y - r); yy <= y + r && n < max; yy++) for (let xx = Math.round(x - r); xx <= x + r && n < max; xx++) {
      if (xx < 0 || yy < 0 || xx >= s.W || yy >= s.H) continue;
      const c = yy * s.W + xx, i = s.pid[c];
      if (i >= 0 && edible(s, i) && !s.strikeT[i]) { s.killAt(c); n++; }
    }
    return n;
  }
  // Grains inside an attack shape are taken, nearest the attacker first. Frozen sand is a SHIELD: ice stops the blow
  // (it is chipped, one barrier point per grain, and counts against the attack's `max`), and anything lying behind
  // ice, seen from where the blow starts, is not touched at all.
  function cutSand(s, shape, max, ox, oy) {
    if (ox == null) { ox = shape.x; oy = shape.y; }
    const x0 = Math.max(0, Math.floor(shape.x - shape.r)), x1 = Math.min(s.W - 1, Math.ceil(shape.x + shape.r));
    const y0 = Math.max(0, Math.floor(shape.y - shape.r)), y1 = Math.min(s.H - 1, Math.ceil(shape.y + shape.r));
    const cand = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = y * s.W + x, i = s.pid[c];
      if (i < 0 || !takeable(s, i) || !inShape(shape, x, y)) continue;
      cand.push([(x - ox) * (x - ox) + (y - oy) * (y - oy), c, x, y]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const q of cand) q.push(s.iceBetween(ox, oy, q[2], q[3]));        // who is behind ice is decided before the blow breaks any
    let n = 0;
    for (const [, c, , , shielded] of cand) {
      if (n >= max) break;
      if (s.pid[c] < 0 || shielded) continue;
      s.killAt(c); n++;
    }
    return n;
  }
  const parried = (s) => s.frame - s.parryAt <= PARRY + ((s.mod && s.mod.parryWin) || 0);   // a rune can widen it
  const bodyIn = (s, shape) => s.body.n > 0 && (inShape(shape, s.body.x, s.body.y) || Math.hypot(s.body.x - shape.x, s.body.y - shape.y) < (shape.r || 0) + s.body.r * 0.6);

  function fall(s, f) {
    f.vy = Math.min(4, f.vy + GRAV);
    const ny = f.y + f.vy;
    if (f.vy > 0 && foeSolid(s, Math.round(f.x), Math.round(ny) + 1)) {
      const impact = f.vy;
      f.y = Math.round(ny);
      // never an unbounded climb: a creature knocked up into a ceiling or out of the room used to
      // spin here forever (the room's edge counts as solid), freezing the whole game
      for (let g = 0; g < 80 && foeSolid(s, Math.round(f.x), Math.round(f.y)); g++) f.y--;
      if (foeSolid(s, Math.round(f.x), Math.round(f.y))) { f.x = f.home.x; f.y = f.home.y; f.vx = f.vy = 0; f.stun = Math.max(f.stun, 20); }   // buried: back to where it came from
      if (f.kind !== 'dummy') {
        const threshold = f.tier === 'warden' ? 3.5 : 2.8;
        const fallDamage = Math.floor(Math.max(0, impact - threshold) * (f.tier === 'warden' ? 1.5 : 2.5));
        if (fallDamage > 0) {
          f.hp -= fallDamage;
          f.poise -= Math.max(1, fallDamage * 0.5);
          f.hurtT = Math.max(f.hurtT, 8);
          f.stun = Math.max(f.stun, Math.round(12 * f.stunRes));
          s.events.push({ type: 'fallDamage', x: f.x, y: f.y - size(f).cy, dmg: fallDamage, impact });
          if (f.hp <= 0) {
            f.dead = true;
            f.deadT = 0;
            s.events.push({ type: 'foeDie', x: f.x, y: f.y - size(f).cy, kind: f.kind, tier: f.tier });
          }
        }
      }
      f.vy = f.stun > 0 && impact > 1.2 ? -Math.min(4.5, impact * 0.55 * f.knockback) : 0;
      f.vx *= 0.92;
      return true;
    }
    if (f.vy < 0 && foeSolid(s, Math.round(f.x), Math.round(ny) - 2 * size(f).cy - 1)) { f.vy = 0; return false; }   // it hits its head on a ceiling instead of passing through it
    f.y = ny;
    const nx = f.x + f.vx;
    if (!foeSolid(s, Math.round(nx), Math.round(f.y) - 2)) f.x = nx; else f.vx = 0;
    f.vx *= 0.92;
    return false;
  }
  function groundAt(s, x, y) {
    for (let dy = -3; dy <= 3; dy++) { const yy = y + dy; if (!foeSolid(s, x, yy) && foeSolid(s, x, yy + 1)) return yy; }
    return null;
  }
  // walk along the ground (slopes up to three cells, never off a drop or onto spikes)
  function walk(s, f, speed) {
    const x = Math.round(f.x), y = Math.round(f.y), ahead = x + f.dir * (f.kind === 'warden' ? 12 : 3);
    let ny = null;
    for (let dy = -3; dy <= 3; dy++) {
      const yy = y + dy;
      if (!foeSolid(s, ahead, yy) && !foeSolid(s, ahead, yy - 1) && !foeSolid(s, ahead, yy - 2) && walkable(s, ahead, yy + 1)) { ny = yy; break; }
    }
    if (ny === null) return false;
    f.x += f.dir * speed;
    const gy = groundAt(s, Math.round(f.x), y); if (gy !== null) f.y = gy;
    return true;
  }

  // ---- bugs ----
  function stepMite(s, f) {
    const grounded = foeSolid(s, Math.round(f.x), Math.round(f.y) + 1);
    if (!grounded || f.vy < 0) { fall(s, f); return; }
    if (f.stun > 0) { f.vx = 0; return; }
    if (f.mode === 'stagger') f.mode = 'walk';
    const g = nearestGrain(s, f.x, f.y - 2, 95);
    let speed = 0.33;
    f.mode = 'walk';
    if (g >= 0 && Math.abs(s.py[g] - f.y) < 34) {
      f.mode = 'hunt'; speed = 0.8;
      const dx = s.px[g] - f.x;
      if (Math.abs(dx) > 2) f.dir = Math.sign(dx);
      if (Math.hypot(s.px[g] - f.x, s.py[g] - (f.y - 2)) < 6) {
        f.mode = 'eat'; speed = 0.1;
        if (!f.pre) { f.pre = s.frame; s.events.push({ type: 'foeWarn', kind: 'mite', x: f.x, y: f.y }); }      // it rears first: a readable warning before the first bite
        if (s.frame - f.pre >= MITE_PRE && s.frame % 5 === 0 && eatAround(s, f.x + f.dir * 3, f.y - 2, 4, 1)) { f.eaten++; if (f.eaten % 6 === 1) s.events.push({ type: 'bite', x: f.x, y: f.y }); }
      }
    }
    if (f.mode !== 'eat') f.pre = 0;
    if (!walk(s, f, speed) && f.mode === 'walk') f.dir = -f.dir;
  }

  const DIVER_AIM = 56, DIVER_LOCK = 32;   // frames: the line is drawn for 56 and stops tracking 32 before the dive (budget: >= 30 locked)
  const MITE_PRE = 30, GNAT_LOCK = 24;    // a mite stops and rears for 30 frames before its first bite; a gnat locks on for 24 before it darts
  function stepDiver(s, f) {
    if (f.stun > 0) { fall(s, f); if (f.stun === 1) { f.mode = 'return'; f.t = 0; } return; }
    f.t++;
    if (f.mode === 'hover' || f.mode === 'return' || f.mode === 'stagger') {
      if (f.mode === 'stagger') f.mode = 'return';
      const hx = f.home.x + Math.sin(f.t * 0.02) * 18, hy = f.home.y + Math.sin(f.t * 0.033) * 5;
      const dx = hx - f.x, dy = hy - f.y, d = Math.hypot(dx, dy);
      const sp = f.mode === 'return' ? 1.4 : 0.6;
      if (d > 1) {
        const nx = f.x + dx / d * Math.min(sp, d), ny = f.y + dy / d * Math.min(sp, d);
        if (!foeSolid(s, Math.round(nx), Math.round(ny))) { f.x = nx; f.y = ny; }
      }
      if (f.mode === 'return' && d < 4) { f.mode = 'hover'; f.t = 0; }
      if (dx) f.dir = Math.sign(dx);
      if (f.mode === 'hover' && f.t > f.every) {
        const g = densest(s);
        if (g >= 0 && Math.hypot(s.px[g] - f.x, s.py[g] - f.y) < 260) {
          f.mode = 'aim'; f.t = 0; f.tx = s.px[g]; f.ty = s.py[g];
          s.events.push({ type: 'foeWarn', x: f.x, y: f.y });
        } else f.t = f.every - 60;
      }
    } else if (f.mode === 'aim') {
      if (f.t < DIVER_AIM - DIVER_LOCK) { const g = densest(s); if (g >= 0) { f.tx += (s.px[g] + s.vx[g] * 10 - f.tx) * 0.2; f.ty += (s.py[g] - f.ty) * 0.2; } }
      f.dir = Math.sign(f.tx - f.x) || f.dir;
      const nx = f.x + Math.sin(f.t * 0.9) * 0.3;
      if (!foeSolid(s, Math.round(nx), Math.round(f.y))) f.x = nx;
      f.tele = { kind: 'line', x: f.x, y: f.y, tx: f.tx, ty: f.ty, k: f.t / DIVER_AIM };     // where it will go
      if (f.t >= DIVER_AIM) {
        const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy) || 1;
        f.vx = dx / d * 4.4; f.vy = dy / d * 4.4; f.mode = 'dive'; f.t = 0; f.tele = null;
        f.left = d + 18; f.took = 0;
        s.events.push({ type: 'foeDive', x: f.x, y: f.y });
      }
    } else if (f.mode === 'dive') {
      // a parry as it arrives: it glances off and tumbles
      if (s.body.n && Math.hypot(f.x - s.body.x, f.y - s.body.y) < s.body.r + 8 && parried(s)) {
        s.events.push({ type: 'parry', x: f.x, y: f.y }); f.vx = -f.vx * 0.5; f.vy = -2; stagger(s, f, 120); return;
      }
      const nx = f.x + f.vx, ny = f.y + f.vy;
      f.left -= 4.4;
      if (foeSolid(s, Math.round(nx), Math.round(ny)) || f.left <= 0) { f.mode = 'return'; f.t = 0; f.vx = f.vy = 0; return; }
      f.x = nx; f.y = ny;
      if (f.took < 22) f.took += eatAround(s, f.x, f.y - 1, 2, 22 - f.took);
    }
  }

  // a gnat: hovers in a loose swarm; when your sand comes near, darts in,
  // takes one grain, and flies home with it
  function stepGnat(s, f) {
    if (f.stun > 0) { fall(s, f); return; }
    f.t++;
    const wob = (k) => Math.sin(f.t * 0.11 + f.phase * k) * 6;
    if (f.mode === 'swarm' || f.mode === 'stagger') {
      f.mode = 'swarm';
      const hx = f.home.x + wob(1) + Math.sin(f.t * 0.03 + f.phase) * 14, hy = f.home.y + wob(2);
      const nx = f.x + (hx - f.x) * 0.08, ny = f.y + (hy - f.y) * 0.08;
      if (!foeSolid(s, Math.round(nx), Math.round(ny))) { f.x = nx; f.y = ny; }
      if (f.t > 50 + (f.phase * 20 | 0) && !f.carry) {
        const g = nearestGrain(s, f.x, f.y, 90);
        if (g >= 0) { f.mode = 'lock'; f.tx = s.px[g]; f.ty = s.py[g]; f.t = 0; s.events.push({ type: 'foeWarn', kind: 'gnat', x: f.x, y: f.y, tx: f.tx, ty: f.ty }); }
      }
    } else if (f.mode === 'lock') {                      // it hangs and trembles, locked on, before the dart
      f.x += Math.sin(f.t * 1.3) * 0.4; f.tele = { kind: 'line', x: f.x, y: f.y, tx: f.tx, ty: f.ty, k: f.t / GNAT_LOCK };
      if (f.t >= GNAT_LOCK) { f.mode = 'dart'; f.t = 0; f.tele = null; }
    } else if (f.mode === 'dart') {
      const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
      const nx = f.x + dx / (d || 1) * Math.min(3.2, d), ny = f.y + dy / (d || 1) * Math.min(3.2, d);
      if (!foeSolid(s, Math.round(nx), Math.round(ny))) { f.x = nx; f.y = ny; } f.dir = Math.sign(dx) || f.dir;
      if (d < 3 || f.t > 60) {
        if (eatAround(s, f.x, f.y, 2, 1)) { f.carry = 1; s.events.push({ type: 'bite', x: f.x, y: f.y }); }
        f.mode = 'flee'; f.t = 0;
      }
    } else if (f.mode === 'flee') {
      const dx = f.home.x - f.x, dy = f.home.y - f.y, d = Math.hypot(dx, dy);
      const nx = f.x + dx / (d || 1) * Math.min(1.8, d), ny = f.y + dy / (d || 1) * Math.min(1.8, d) + Math.sin(f.t * 0.5) * 0.6;
      if (!foeSolid(s, Math.round(nx), Math.round(ny))) { f.x = nx; f.y = ny; }
      if (d < 4) { f.mode = 'swarm'; f.t = 0; f.carry = 0; }        // what it carried is gone
    }
  }

  // ---- the Hourglass Warden ----
  const WARDEN = {
    cleave: { windup: 38, active: 8, recover: 34 },
    lunge: { windup: 36, active: 22, recover: 46 },   // warning budget: >= 30 frames for a normal attack (test/telegraphs.js)
    stamp: { windup: 44, active: 70, recover: 40 },
  };
  function stepWarden(s, f) {
    const grounded = foeSolid(s, Math.round(f.x), Math.round(f.y) + 1);
    if (!grounded) { fall(s, f); return; }
    if (f.mode === 'stagger') { if (--f.stun <= 0) { f.mode = 'idle'; f.cool = 30; } return; }
    if (f.mode === 'guard') { f.t++; if (f.t > 60) { f.mode = 'idle'; f.cool = 10; } return; }
    const b = s.body, near = b.n > 20, dx = near ? b.x - f.x : 0, dist = Math.abs(dx), cy = f.y - 15;
    if (f.mode === 'idle' || f.mode === 'walk') {
      if (!near || Math.abs(b.y - cy) > 90 || (f.area && (b.x < f.area[0] || b.x > f.area[1]))) {
        f.mode = 'idle'; f.dir = Math.sign(f.home.x - f.x) || f.dir;
        if (Math.abs(f.home.x - f.x) > 4) walk(s, f, 0.5);
        return;
      }
      f.dir = Math.sign(dx) || f.dir;
      if (--f.cool > 0) { if (dist > 40) { f.mode = 'walk'; walk(s, f, 0.7); } return; }
      // choose: close, a cleave (or a stamp); mid range, a lunge or a stamp
      const r = s.rand();
      const pick = dist < 56 ? (r < 0.7 ? 'cleave' : 'stamp') : dist < 170 ? (r < 0.55 ? 'lunge' : 'stamp') : null;
      if (!pick) { f.mode = 'walk'; walk(s, f, 0.7); return; }
      f.mode = 'windup'; f.atkName = pick; f.t = 0;
      s.events.push({ type: 'wardenWindup', x: f.x, y: cy, atk: pick });
      return;
    }
    const A = WARDEN[f.atkName];
    f.t++;
    if (f.mode === 'windup') {
      // the warning: where it will land, drawn while it winds up
      if (f.atkName === 'cleave') f.tele = { shape: 'arc', x: f.x + f.dir * 4, y: cy, r0: 4, r: 48, a0: f.dir > 0 ? -1.3 : Math.PI - 1.0, a1: f.dir > 0 ? 1.0 : Math.PI + 1.3, k: f.t / A.windup };
      if (f.atkName === 'lunge') { f.lx = b.n ? b.x : f.x + f.dir * 100; f.tele = { shape: 'band', x: f.x, y: cy, tx: Math.max(f.x - 130, Math.min(f.x + 130, f.lx)), k: f.t / A.windup }; }
      if (f.atkName === 'stamp') f.tele = { shape: 'ground', x: f.x, y: f.y, k: f.t / A.windup };
      if (f.t >= A.windup) { f.mode = 'active'; f.t = 0; f.tele = null; f.took = 0; s.events.push({ type: 'wardenStrike', x: f.x, y: cy, atk: f.atkName }); }
      return;
    }
    if (f.mode === 'active') {
      let shape = null;
      if (f.atkName === 'cleave') shape = { shape: 'arc', x: f.x + f.dir * 4, y: cy, r0: 4, r: 48, a0: f.dir > 0 ? -1.3 : Math.PI - 1.0, a1: f.dir > 0 ? 1.0 : Math.PI + 1.3 };
      if (f.atkName === 'lunge') {
        const goal = Math.max(f.x - 130, Math.min(f.x + 130, f.lx));
        if (Math.abs(goal - f.x) > 2 && walk(s, f, 4.2)) {} else f.t = A.active;
        shape = { shape: 'circle', x: f.x + f.dir * 8, y: cy, r: 15 };
      }
      if (f.atkName === 'stamp') {
        if (f.t === 1) { f.waves = [{ x: f.x, d: -1 }, { x: f.x, d: 1 }]; s.events.push({ type: 'stamp', x: f.x, y: f.y }); }
        for (const w of f.waves) w.x += w.d * 3.2;
      }
      // a parry the moment it lands: the attack breaks and it staggers
      if (shape && bodyIn(s, shape) && parried(s)) { s.events.push({ type: 'parry', x: (f.x + s.body.x) / 2, y: cy }); stagger(s, f, 130); return; }
      const cap = f.atkName === 'cleave' ? 25 : 20;                  // a hit costs you a mouthful, not everything
      if (shape && f.took < cap) f.took += cutSand(s, shape, cap - f.took, f.x, cy);
      if (f.atkName === 'stamp') for (const w of f.waves) {
        if (w.ice) continue;
        const g = { shape: 'circle', x: w.x, y: f.y - 3, r: 6 };
        if (parried(s) && bodyIn(s, g)) { w.d = 0; s.events.push({ type: 'parry', x: w.x, y: f.y - 3 }); continue; }
        // the wave runs along the floor and is stopped dead by ice: it chips one grain and is spent
        if (s.frozenAt(Math.round(w.x + w.d * 3), Math.round(f.y - 2)) || s.frozenAt(Math.round(w.x + w.d * 3), Math.round(f.y - 5))) {
          for (const yy of [f.y - 2, f.y - 5]) { const c = Math.round(yy) * s.W + Math.round(w.x + w.d * 3); const j = s.pid[c]; if (j >= 0 && s.state[j] === 2) { s.killAt(c); f.took++; break; } }
          w.d = 0; w.ice = true; s.events.push({ type: 'iceBlock', x: w.x, y: f.y - 3 }); continue;
        }
        if (f.took < 15) f.took += cutSand(s, g, 2, w.x - w.d * 4, f.y - 3);
      }
      if (f.t >= A.active) { f.mode = 'recover'; f.t = 0; f.waves = null; }
      return;
    }
    if (f.mode === 'recover' && f.t >= A.recover) { f.mode = 'idle'; f.cool = 40 + Math.floor(s.rand() * 40); }
  }

  const api = {
    make, STATS, damage, LINK_WINDOW,
    // the world's clock is held (you are aiming a charged attack): creatures stand frozen, but still take blows
    hitsOnly(s) { for (const f of s.foes) if (!f.dead) takeHits(s, f); },
    step(s) {
      for (const f of s.foes) {
        if (f.dead) continue;
        takeHits(s, f);
        if (f.dead) continue;
        if (f.hurtT > 0) f.hurtT--;
        if (f.stun > 0 && f.kind !== 'warden' && --f.stun === 0) { if (f.mode === 'stagger') f.mode = f.kind === 'diver' ? 'return' : 'walk'; s.events.push({ type: 'wake', x: f.x, y: f.y }); }
        if (s.frame % 60 === 0 && f.poise < f.maxPoise) f.poise++;              // poise returns if you let up
        if (f.kind === 'mite') stepMite(s, f);
        else if (f.kind === 'gnat') stepGnat(s, f);
        else if (f.kind === 'warden') stepWarden(s, f);
        else if (f.kind === 'dummy') { if (!foeSolid(s, Math.round(f.x), Math.round(f.y) + 1) || f.vy < 0) fall(s, f); else { f.vx = 0; f.x += (f.home.x - f.x) * 0.05; } }
        else stepDiver(s, f);
      }
      // the dead linger a moment for their death animation, then are gone
      for (const f of s.foes) if (f.dead) f.deadT = (f.deadT || 0) + 1;
      if (s.foes.some((f) => f.dead && f.deadT > 2)) s.foes = s.foes.filter((f) => !f.dead || f.deadT <= 2);
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillFoes = api;
})(typeof window !== 'undefined' ? window : globalThis);
