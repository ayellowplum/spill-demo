// SPILL simulation: terrain grid + player grains that carry velocity.
// Pure logic, no DOM, so it runs (and is tested) in Node too.
(function (root) {
  'use strict';

  // Terrain materials (src/materials.js: the ids and the property tables P). Values < 30 that collide block grains; values >= 30 are decoration.
  const MAT = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) ? require('./materials.js') : root.SpillMaterials;
  const T = MAT.IDS, P = MAT.P;
  const F = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports) ? require('./fixtures.js') : root.SpillFixtures;
  const hash2 = F.hash2;
  // Background layer behind the play plane.
  const BG = { WALL: 0, SKY: 1, VOID: 2, FRAME: 3 };

  const GRAV = 0.3;
  const MAX_V = 8;
  const CLIMB_SPEED = 3.5;
  const REACH1 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const REACH4 = [];                       // Gravity of Others: still sand wakes from 4 cells away
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if ((dx || dy) && dx * dx + dy * dy <= 16) REACH4.push([dx, dy]);
  const FREEZE_R = 28;      // freeze reaches this far from the cursor
  // Freeze's price: a short free touch, then glass at a rate that grows with
  // how much sand is held frozen (a long wall costs far more than a plug).
  // Freeze (E) is free: its limits are time. It holds at most 5 s, then needs
  // a breath before the next. Freezing again and again soon after each thaw
  // (spamming it) lengthens that breath and shortens the hold, a little at a time.
  const FREEZE_MAX = 300;     // frames: a freeze thaws by itself after 5 s held (a rune can add seconds: mod.freezeFree)
  const FREEZE_COOL = 45;     // frames after a thaw before the next freeze can start (a rune can scale it: mod.freezeCost)
  // Parry: a tap of E (or Space) as a blow lands turns it aside. Only the
  // press counts, never holding. A press that parries nothing leaves you open
  // for a moment (no mashing through an attack); a clean parry clears that.
  const FREEZE_WAVE0 = 20, FREEZE_WAVE = 5;   // the frost starts this wide at your heart and races out this many cells a frame
  const PARRY_LOCK = 48;                // frames after a missed press before another can parry (the 10-frame window + ~0.6 s)
  const FREEZE_SPAM_GAP = 120;          // a freeze started within 2 s of the last thaw counts as a repeat
  const FREEZE_SPAM_COOL = 20, FREEZE_SPAM_HOLD = 30, FREEZE_SPAM_MAX = 4;   // per repeat: +1/3 s breath, -1/2 s hold; at most 4 repeats count
  const SLAM_V = 4.6;       // a thrown clump this fast (cells/frame, any direction) that strikes something slams
  // Hit stop: an impact on a creature holds the whole sim a moment (on top of
  // the game's own 2-3 frame hold). Very short at first, a frame longer for
  // each hit of an unbroken combo up to a cap; a kill holds a little longer
  // and ends the run-up.
  const STOP_STEP = 1, STOP_CAP = 5;   // extra frames per combo hit, and the most it builds to (~85 ms extra)
  const STOP_KILL = 3;                 // a kill: this much past the combo's hold
  const STOP_DMG = 4;                  // heavy blows hold longer: up to this many frames for damage past 2 (taps stay constant)
  // Q's tap bolt weaves a little left and right of its line (harder to land),
  // and hits harder the further it has flown before it strikes
  const Q_WEAVE = 8, Q_WEAVE_W = 0.14;   // the bolt swings this many cells either side of its line (a visible S), period ~45 frames
  const Q_WEAVE_EASE = 16, Q_WEAVE_NEAR = 70;   // the swing grows over the first 16 frames and dies away over the last 70 cells before the mark
  const LOCK_R = 18;   // cells from a creature (or from the eye's edge) within which the cursor locks it (was 30: placing the cursor roughly was enough)
  const Q_PULL_EYE = 0.04, Q_CONE_W = 22, Q_PULL = 0.001, Q_PULL_MIN = 30, Q_PULL_MAX = 170;   // light aim assist: a creature within 22 cells of its line pulls it a little, most at mid range, none far or near, never a snap
  const Q_RANGE = 90;                  // every this many cells flown: +1 damage on the hit, up to +2
  // F held: the hammer gathers strength for this long (frames) before it is full
  const HAMMER_FULL = 60;
  const HAMMER_HOLD_MAX = 150;   // frames a hammer may be held before it crumbles with no smash (was a bare 150)
  const HAMMER_WARN = 20;         // frames before that: a 'hammerWarn' event so the art and audio can say so
  // F's tap burst: a wide fan close in, not a long poke
  const BURST_ARC = 0.9;               // half-angle of the fan (radians, ~103 deg across)
  const BURST_REACH = 24;               // how far past the body's edge it strikes
  const BURST_PAD_A = 0.2, BURST_PAD_R = 3;   // the hit reaches a little past the drawn arc's ends and rim: anything inside the drawn fan is hit
  const BURST_SCALE = 1.25;             // the whole fan radius (body edge + reach) is scaled by this
  // A tap pressed in the last few frames of a breath is kept and fires the moment the breath ends (cooldowns tick in sim
  // time, so hit stop eats real time and a tap on the beat used to vanish; the rig measured 2 of 5 spammed taps lost to it)
  const TAP_BUFFER = 9;
  const TAP_RELOAD_F = 50, TAP_RELOAD_Q = 150;       // frames per charge back (F has 5 charges, Q has 3)
  // Held Q's shards leave in a fan that is only as wide as the mark: at close range a fixed 37-degree wedge
  // buried 3.7 of 5 in the floor and walls; now the five land across SHARD_SPREAD_W cells at the mark
  const SHARD_SPREAD = 0.32, SHARD_SPREAD_MIN = 0.03, SHARD_SPREAD_W = 9;
  // The Super: build-up, then a long rain of straight-falling stars (no steering), in waves
  const SUPER_RAIN_AT = 150, SUPER_RAIN = 450, SUPER_WAVES = 6;   // rain starts at frame 150 and lasts 7 s
  const SUPER_DRIZZLE = 0.9, SUPER_PULSE = 4;                  // stars per frame between waves, and extra at the middle of a wave
  const SUPER_EYE_GAP = 30;      // frames between the curtain stars on the open eye
  const SUPER_STAR_R = 11, SUPER_STAR_DMG = 3;
  const RUNE_KIND = { blade: 'dmgF', burst: 'dmgF', hammer: 'dmgHammer', shock: 'dmgHammer', lash: 'dmgQ', shard: 'dmgQ', slam: 'dmgSlam' };   // which rune scales which blow
  // SLAM is the control tool: little damage, a lot of poise (it staggers anything, a Warden in two), a high pop so F/Q/hammer can follow.
  // It is never gated, recovered or penalised for chaining (chains are meant to be hard to set up).
  const EVENT_SLOW_PARRY = 14, EVENT_SLOW_LINK = 9, EVENT_SLOW_SLAM = 12, EVENT_SLOW_CAP = 40;   // sim frames (see stepEventSlow)
  const Q_HIT = 3;               // a Q bolt is the heaviest single hit of the pokes (3 / 6 / 9 by range flown): it is hard to land and slow to reload (150 frames per charge)
  const SPACE_WINDOW = 100, SPACE_COOL = 120, SPACE_REFUND = 30;   // REAL frames: a 1.7 s slow, then 2 s before the next; a parry or a link refunds 0.5 s of the cooldown (playtest: 50/100 useless; 100/60 let you chain it into a near-permanent slow)
  const SPACE_RATE = 0.2;   // how fast the sim runs while Space's window is on (was 0.35): game.js reads sim.spaceRate
  const HOLD_SAND_DRAG = 0.9, HOLD_SAND_GRAV = 0.25;   // held F/Q: free sand falls at about a tenth of normal speed (terminal ~0.75 cells a frame instead of ~8)
  const HOLD_FREEZE_MAX = 150;   // frames of held F/Q that stop the world (the hammer crumbles at 150 held frames anyway)
  const SLAM_REPEAT = [1, 1, 1], SLAM_REPEAT_WINDOW = 360;
  const SLAM_N = 25;        // ...if it carries at least this many grains
  const GRACE = 60 * 30;    // 30 s to bring the rest home once you have enough
  const SEL_R = 115;       // launch gathers sand within this radius of the press
  const AIM_LEN = 70;
  const AIR_MIN_PULL = 0.15;           // the least pull that counts as a throw from the air
  const AIR_HANG = 26;                 // sim frames a right-click in the air holds the sand (and slows time) before it drops
  // the blade's three cuts: a down-sweep, an up-sweep, and a longer thrust
  const SWINGS = [
    { sweep: 2.4, reach: 18, dur: 13, act: [2, 8], dmg: 1, poise: 1 },
    { sweep: 2.4, reach: 18, dur: 13, act: [2, 8], dmg: 1, poise: 1 },
    { sweep: 0.7, reach: 34, dur: 17, act: [4, 10], dmg: 2, poise: 3 },
  ];      // drag distance for full power
  const LAUNCH_MIN = 2.4, LAUNCH_RANGE = 5.2;
  const POUR_R0 = 120, POUR_R1 = 190; // pour pull: full inside R0, fades to 0 at R1

  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  class Sim {
    // count: grains you enter with (carried from the last chamber).
    // opts.flip: build the room mirrored left-right (roguelike variety).
    // opts.mods: lens modifiers for this run (see LENSES in game.js).
    constructor(level, seed, count, opts) {
      opts = opts || {};
      this.mod = Object.assign({ climb: 1, sling: 1, reach: 1, absorb: 1, spikeGlass: false, freezeFree: 0, debt: 0, grav: 1, undertow: false,
        fRest: 1, qSteady: false, airThrows: 0, hammerCool: 1, shards: 0, superRate: 1, killGrains: 0, brittle: 0, throwCool: 1,
        dmgF: 1, dmgHammer: 1, dmgQ: 1, dmgSlam: 1, freezeCost: 1, slamV: 1, parryWin: 0, eventSlow: false, noSpace: false, holdFreeze: true, holdFreezeSand: false, holdSandSlow: true }, opts.mods || {});   // runes.js
      this.toll = opts.toll || 0;
      this.respawn = []; this.pending = 0;
      this.flipped = !!opts.flip;
      const W = this.W = level.w, H = this.H = level.h;
      this.level = level;
      this.rand = makeRng(seed || 12345);
      this.g = new Uint8Array(W * H);
      this.bg = new Uint8Array(W * H);
      this.pid = new Int16Array(W * H).fill(-1);
      this.lights = [];
      this.props = [];   // hand-drawn decorative sprites placed by the level
      this.windows = []; // window surrounds, laid out stone by stone by the renderer
      this.ambient = []; // small animated life: moths, drips, trickles, spiders
      this.terrainVersion = 1;
      level.build(F.terrain(this));                       // rooms build through the fixtures API (src/fixtures.js), not through methods of the sim
      if (this.flipped) this.mirrorX();
      // wear and life placed by rule (decoration only, never solid)
      const D = (typeof window !== 'undefined' && window.SpillDetail) || (typeof require !== 'undefined' ? require('./detail.js') : null);
      if (D) D.decorate(this);

      // Still sand painted by the level becomes extra capacity: when your
      // grains touch it, it wakes and joins you.
      let still = 0;
      for (let i = 0; i < W * H; i++) if (this.g[i] === T.STILL) still++;
      this.stillLeft = still;
      const start = count != null ? count : level.count;
      const N = start + still + (level.reserve || 0);   // reserve: still sand a level may add later
      this.cap = N;
      this.px = new Int16Array(N);
      this.py = new Int16Array(N);
      this.vx = new Float32Array(N);
      this.vy = new Float32Array(N);
      this.fx = new Float32Array(N);
      this.fy = new Float32Array(N);
      this.state = new Uint8Array(N); // 0 gone, 1 free, 2 hardened, 3 exited
      this.tint = new Uint8Array(N);
      this.order = new Int16Array(N);
      this.key = new Float32Array(N);
      this.sel = new Uint8Array(N);
      this.climbing = new Uint8Array(N);
      this.strikeT = new Uint8Array(N);   // frames left in a strike: flying straight, able to hit
      this.strikeOf = new Uint16Array(N); // which strike a grain belongs to (one hit per strike)
      this.strikeN = 0; this.strikeCool = 0;
      this.thrownOf = new Uint16Array(N);  // which throw a grain was launched in
      this.waveOf = new Uint8Array(N);     // grains surging out in a wave (they stay yours)
      this.returnT = new Uint8Array(N);    // and then fly back to you, like a whip drawn back
      this.iceOf = new Uint8Array(N);      // grains held in a sand icicle (which shard, 1..5)
      this.superOf = new Uint8Array(N);    // grains in the super (the falling stars)
      this.superCharge = 0;
      this.hsel = new Uint8Array(N);       // grains gathered into the hammer
      this.hfall = new Uint8Array(N);      // grains of a hammer coming down
      this.shocks = [];                    // shockwaves running along the ground
      this.throwN = 0; this.throwNow = null; this.slams = [];
      this.combo = { n: 0, t: 0, fam: 0 };
      // sim.stats: real usage, per attack kind: uses, hits (blows that landed), damage (hp taken), grains (nominal sand each use costs), plus
      // stats.slow {frames}: game.js adds 1 per real frame the Space slow (or air hang) is on; stats.frames counts sim frames
      this.spaceRate = SPACE_RATE;
      this.stats = { frames: 0, slow: { frames: 0 } };
      for (const k of ['f', 'q', 'shards', 'hammer', 'slam', 'super']) this.stats[k] = { uses: 0, hits: 0, damage: 0, grains: 0 };
      this.hammerFull = HAMMER_FULL;      // frames of F held for a full hammer (for the charge meter)
      // openings in the room's edge that lead to other rooms (world mode)
      this.exits = level.exits || [];
      this.passed = this.exits.map(() => 0);
      this.foes = [];
      this.hits = [];          // attack shapes live this frame: { kind, shape, x, y, r, r0, a0, a1, dmg, poise, id, dir }
      this.body = { x: 0, y: 0, n: 0, r: 4 };
      this.swing = null; this.hammer = null; this.bladeCool = 0; this.parryAt = -999; this.hitN = 0;

      this.frame = 0;
      this.lost = 0; this.fused = 0; this.exited = 0;
      this.prevCharge = false; this.charging = false; this.airHang = AIR_HANG;
      this.anchorX = 0; this.anchorY = 0; this.aimPower = 0; this.aimDx = 1; this.aimDy = 0;
      this.selCount = 0; this.ballCount = 0; this.cohesionT = 0; this.bx = 0; this.by = 0;
      this.prevHarden = false; this.frozen = 0; this.freezeT = 0;
      this.enoughAt = -1;
      this.lastExit = -1;
      this.lastInput = 0;
      this.moving = 0; this.speed = 0; this.collisionEnergy = 0;
      this.cx = 0; this.cy = 0;
      this.events = [];
      // centre of the exit funnel(s), so the camera can treat it as important
      let ex = 0, ey = 0, en = 0, eTop = 1e9, eBot = -1;
      for (let i = 0; i < W * H; i++) if (P.exit[this.g[i]] === 1) {
        const yy = (i / W) | 0; ex += i % W; ey += yy; en++; if (yy < eTop) eTop = yy; if (yy > eBot) eBot = yy;
      }
      this.exitAt = en ? { x: ex / en, y: ey / en, top: eTop, bottom: eBot } : null;
      this.N = start;
      this.absorbed = 0;
      this.hadStill = still > 0;
      // a hidden memory: a shard of glass somewhere off the main path
      this.memory = level.memory ? { x: this.flipped ? W - 1 - level.memory.x : level.memory.x, y: level.memory.y, found: false } : null;
      // star thresholds: absolute, or a share of what you entered with
      // In the descent a room asks a fixed toll, whatever you bring: a thin
      // run can fail outright. Elsewhere, a share of what you entered with.
      this.par = this.toll ? [this.toll, Math.round(this.toll * 1.4), Math.round(this.toll * 1.8)]
        : level.parFrac ? level.parFrac.map((f) => Math.round(f * start)) : level.par;
      const sp = level.spawn;
      this.spawnRect = this.flipped ? { x: W - sp.x - sp.w, y: sp.y, w: sp.w, h: sp.h, filter: sp.filter && ((x, y) => sp.filter(W - 1 - x, y)) } : sp;
      this.spawn(this.spawnRect);
      if (level.mechs) {
        const MX = (typeof window !== 'undefined' && window.SpillMechs) || (typeof require !== 'undefined' ? require('./mechs.js') : null);
        if (MX) { this.Mechs = MX; MX.install(this, level.mechs, level.mechSaved); }
      }
      if (level.foes) {
        const FO = (typeof window !== 'undefined' && window.SpillFoes) || (typeof require !== 'undefined' ? require('./foes.js') : null);
        if (FO) { this.Foes = FO; this.foes = level.foes.map((f) => FO.make(f, W, this.flipped)); }
      }
    }

    // Mirror everything the level built, left to right.
    mirrorX() {
      const { W, H, g, bg } = this;
      for (let y = 0; y < H; y++) {
        const o = y * W;
        for (let x = 0; x < W / 2; x++) {
          const a = o + x, b = o + W - 1 - x;
          let t = g[a]; g[a] = g[b]; g[b] = t;
          t = bg[a]; bg[a] = bg[b]; bg[b] = t;
        }
      }
      for (const L of this.lights) L.x = W - 1 - L.x;
      for (const p of this.props) p.x = W - 7 - p.x;            // props are 7 wide
      for (const w of this.windows) w.x = W - w.x - w.w;
    }

    // ---------- level building helpers ----------
    inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
    set(x, y, t) { if (this.inb(x, y)) this.g[y * this.W + x] = t; }
    bgRect(x, y, w, h, t) {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++)
        if (this.inb(xx, yy)) this.bg[yy * this.W + xx] = t;
    }
    // Arched opening: rectangle with a semicircle on top.
    bgArch(x, y, w, h, t) {
      const r = w / 2, cx = x + r;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (yy < y + r && (xx + 0.5 - cx) ** 2 + (yy + 0.5 - (y + r)) ** 2 > r * r) continue;
        if (this.inb(xx, yy)) this.bg[yy * this.W + xx] = t;
      }
    }
    light(x, y, r, g, b, radius, flicker) {
      this.lights.push({ x, y, r, g, b, radius, flicker: flicker || 0 });
    }

    spawn(sp) {
      let placed = 0;
      const W = this.W;
      for (let y = sp.y + sp.h - 1; y >= sp.y && placed < this.N; y--) {
        for (let x = sp.x; x < sp.x + sp.w && placed < this.N; x++) {
          const i = y * W + x;
          if (this.blocks(i) || this.pid[i] >= 0) continue;
          if (sp.filter && !sp.filter(x, y)) continue;
          this.px[placed] = x; this.py[placed] = y;
          this.state[placed] = 1;
          this.tint[placed] = (this.rand() * 4) | 0;
          this.pid[i] = placed;
          placed++;
        }
      }
      this.N = placed;
      this.total = placed;
      this.alive = placed;
    }

    // ---------- physics ----------
    blocks(i) {
      return P.collide[this.g[i]] === 1;
    }
    solid(x, y) {
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return true;
      const i = y * this.W + x;
      return this.blocks(i) || this.pid[i] >= 0;
    }
    terrainSolid(x, y) {
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return true;
      return this.blocks(y * this.W + x);
    }
    climbable(x, y) {
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
      return P.climb[this.g[y * this.W + x]] === 1;
    }

    // Is there a climbable face beside this cell? (This was wallRoughness() > 0: a 0..3 roughness whose only use was this truth test.)
    climbSide(x, y, dir) {
      return this.climbable(x + dir, y);
    }

    // Blocked while moving: terrain bounces a little, another grain shares
    // momentum inelastically, so piles settle instead of flowing forever.
    bump(i, dx, dy) {
      const x = this.px[i] + dx, y = this.py[i] + dy;
      if (this.terrainSolid(x, y)) {
        if (dx) this.vx[i] *= -P.bounce[x >= 0 && y >= 0 && x < this.W && y < this.H ? this.g[y * this.W + x] : 0];     // (off the grid counts as plain terrain) else this.vy[i] = 0;
        return;
      }
      const j = this.pid[y * this.W + x];
      if (j < 0) return;
      if (dx) { const a = (this.vx[i] + this.vx[j]) * 0.5; this.vx[i] = a; this.vx[j] = a; }
      else { const a = (this.vy[i] + this.vy[j]) * 0.5; this.vy[i] = a; this.vy[j] = a; }
    }

    // which exit (if any) a point beyond the room's edge falls in
    exitIndexAt(x, y) {
      for (let k = 0; k < this.exits.length; k++) {
        const e = this.exits[k];
        if (e.side === 'right' && x >= this.W && y >= e.a && y < e.b) return k;
        if (e.side === 'left' && x < 0 && y >= e.a && y < e.b) return k;
        if (e.side === 'down' && y >= this.H && x >= e.a && x < e.b) return k;
        if (e.side === 'up' && y < 0 && x >= e.a && x < e.b) return k;
      }
      return -1;
    }

    step1(i, dx, dy) {
      const W = this.W;
      const x = this.px[i] + dx, y = this.py[i] + dy;
      if (this.exits.length && (x < 0 || y < 0 || x >= W || y >= this.H)) {
        const k = this.exitIndexAt(x, y);
        const G = this.level.entryGrace;
        if (k >= 0 && !(G && G.k === k && this.frame < G.until)) {   // the way you came in stays shut a moment
          // through an opening: this grain has gone on to the next room
          this.pid[this.py[i] * W + this.px[i]] = -1;
          this.state[i] = 6; this.alive--; this.passed[k]++;
          this.strikeT[i] = 0;
          return true;
        }
      }
      if (this.solid(x, y)) return false;
      const o = this.py[i] * W + this.px[i], n = y * W + x;
      this.pid[o] = -1;
      this.px[i] = x; this.py[i] = y;
      const t = this.g[n];
      if (P.kill[t] === 1) {
        if (this.mod.spikeGlass && this.g[o] === 0) { this.g[o] = T.GLASS; this.terrainVersion++; }
        this.events.push({ type: 'kill', x, y });
        if (this.mod.undertow && (i & 1)) { this.state[i] = 5; this.alive--; this.pending++; this.respawn.push({ i, at: this.frame + 90 }); }
        else { this.state[i] = 0; this.lost++; this.alive--; }
        return true;
      }
      if (P.exit[t] === 1) {
        this.state[i] = 3; this.exited++; this.alive--;
        this.lastExit = this.frame;
        this.events.push({ type: 'exit', x, y });
        return true;
      }
      this.pid[n] = i;
      return true;
    }

    // FREEZE: holding the freeze key (E) turns the sand near the cursor to
    // stone. It stays solid while held (you build a platform, plug, wedge or
    // shield from yourself); the rest of you stays loose. Letting go frees it.
    // Freeze: press near your sand and it locks around the grains nearest the
    // cursor (rough aim is fine); keep holding and the frost spreads grain to
    // grain through touching sand, catching anything that falls into it.
    // It costs nothing. It thaws by itself after five seconds and needs a
    // breath before it can start again; spamming it stretches the breath.
    // It is also a shield: frozen sand braces against what hits it. (The
    // parry is the press itself, see tryParry: it works even when the freeze
    // is cooling down.)
    // Not aimed: it takes all of you. The frost starts at the heart of your
    // body (not the cursor) and sweeps outward as a visible wave until every
    // grain is caught, including sand of yours lying apart from the body.
    startFreeze() {
      const b = this.body, c = b.n ? b : (this.cx != null ? { x: this.cx, y: this.cy } : null);
      if (this.freezeCool > 0) { this.freezeSeed = null; this.frozen = 0; this.events.push({ type: 'noFreeze', x: c ? c.x : 0, y: c ? c.y : 0 }); return; }
      let best = -1, bd = Infinity;
      if (c) for (let i = 0; i < this.N; i++) {
        if (this.state[i] !== 1) continue;
        const d = Math.hypot(this.px[i] - c.x, this.py[i] - c.y);
        if (d < bd) { bd = d; best = i; }
      }
      this.frozen = 0; this.freezeT = 0;
      if (best < 0) { this.freezeSeed = null; return; }
      const sx = this.px[best], sy = this.py[best];
      this.freezeSeed = { x: sx, y: sy }; this.freezeReach = FREEZE_WAVE0;     // the wave's edge, for drawing
      let n = 0;
      for (let i = 0; i < this.N; i++) {
        if (this.state[i] !== 1 || (this.hammer && this.hsel[i]) || Math.hypot(this.px[i] - sx, this.py[i] - sy) > FREEZE_WAVE0) continue;          // the hammer's head is not ice
        this.state[i] = 2; this.vx[i] = 0; this.vy[i] = 0; this.fx[i] = 0; this.fy[i] = 0; this.strikeT[i] = 0; n++;
      }
      // (the rest of you is caught by the wave in holdFreeze, a few frames later)
      this.frozen = n;
      this.freezeBarrier = n;
      this.swing = null; this.hammerFall = null; this.burst = null; this.icicles = null; this.charging = false;      // (a hammer being held stays: Freeze is live during a hold, COMBAT_DESIGN 2.2)
      if (n) {
        // a repeat soon after the last thaw counts toward spamming; a long rest clears it
        const gap = this.frame - (this.thawFrame == null ? -1e9 : this.thawFrame);
        this.freezeSpam = gap < FREEZE_SPAM_GAP ? Math.min(FREEZE_SPAM_MAX, (this.freezeSpam || 0) + 1) : Math.max(0, (this.freezeSpam || 0) - Math.floor(gap / FREEZE_SPAM_GAP));
        this.freezeMax = FREEZE_MAX - FREEZE_SPAM_HOLD * this.freezeSpam + Math.round((this.mod.freezeFree || 0) * 60);
        this.events.push({ type: 'harden', x: sx, y: sy, n, spam: this.freezeSpam });
      }
    }
    // the parry press: opens the parry window now, unless a missed press is still locking it out
    tryParry() {
      if (this.frame < (this.parryLock || 0)) return false;
      this.parryAt = this.frame; this.parryLock = this.frame + PARRY_LOCK;
      return true;
    }
    holdFreeze() {
      if (!this.freezeSeed) return;
      this.freezeT++;
      // the wave races outward; every grain of yours it passes freezes (and any that falls into it later)
      const reach = this.freezeReach = FREEZE_WAVE0 + this.freezeT * FREEZE_WAVE, { x: sx, y: sy } = this.freezeSeed;
      for (let i = 0; i < this.N; i++) {
        if (this.state[i] !== 1 || this.strikeT[i] || (this.hammer && this.hsel[i])) continue;
        const dx = this.px[i] - sx, dy = this.py[i] - sy;
        if (dx * dx + dy * dy > reach * reach) continue;
        this.state[i] = 2; this.vx[i] = 0; this.vy[i] = 0; this.fx[i] = 0; this.fy[i] = 0; this.frozen++;
        this.freezeBarrier = (this.freezeBarrier || 0) + 1;                 // each grain caught makes the shield that much stronger
      }
      if (!this.frozen) return;
      if (this.freezeT >= (this.freezeMax || FREEZE_MAX)) this.endFreeze();   // held too long: it lets go by itself
    }
    breakFreezeBarrier() {
      if (!this.freezeSeed || this.freezeBarrier > 0) return;
      const { x, y } = this.freezeSeed;
      this.shatter(x, y);
      this.freezeSeed = null;
      this.frozen = 0;
      this.freezeT = 0;
    }
    // runes that strengthen a move scale its blows this frame; fractions round
    // up by chance (a +15% on a 1-damage tap is a 2 now and then), so the
    // average is exact and nothing is ever weaker than it was
    // ---- EVENT SLOW (prototype, off unless mod.eventSlow; mod.noSpace additionally tells game.js to ignore the hold-to-slow) ----
    // Time slows (game.js runs the sim at 0.35 while sim.slowNow) for a short earned window, from EVENTS, never from a held key:
    //   a parry that turns an attack aside: +14 sim frames; a link between different attacks: +9; a slam that lands: +12;
    //   an airborne right-click aim keeps its own free hang (AIR_HANG, as today).
    // The window is a budget (cap 40 sim frames = ~1.1 s real at 0.35) that only drains while slowNow. Fields for game.js:
    //   sim.slowNow (bool: run at sim.slowRate), sim.slowRate (0.35), sim.slowBudget (sim frames left), sim.mod.noSpace (bool).
    stepEventSlow() {
      if (!this.mod.eventSlow) { this.slowNow = false; return; }
      let add = 0;
      for (let k = Math.min(this.eventScan || 0, this.events.length); k < this.events.length; k++) {
        const e = this.events[k];
        if (e.type === 'parry') add += EVENT_SLOW_PARRY; else if (e.type === 'link') add += EVENT_SLOW_LINK; else if (e.type === 'slam') add += EVENT_SLOW_SLAM;
      }
      this.eventScan = this.events.length;
      this.slowRate = SPACE_RATE;
      this.slowBudget = Math.min(EVENT_SLOW_CAP, (this.slowBudget || 0) + add);
      this.slowNow = this.slowBudget > 0;
      if (this.slowNow) { this.slowBudget--; this.stats.slow.sim = (this.stats.slow.sim || 0) + 1; }
    }
    // ---- SPACE as a tap: a free slow window of fixed length, then a cooldown (replaces hold-to-slow when game.js uses it) ----
    // game.js: on Space keydown call sim.spacePress() (it also does the parry press, as tryParry did); once per REAL frame call
    // sim.spaceTick(); slow the sim (x0.35) while sim.spaceSlowNow is true. Never holdable, no grain cost.
    // UI (top right, beside the shortened ice bar): sim.spaceBar() -> { state: 'ready'|'slow'|'cool', frac: 0..1 } where frac is the
    // share of the window left while slowed and the share of the cooldown recovered while cooling.
    spacePress() {
      if (this.tryParry) this.tryParry();
      const S = this.space || (this.space = { win: 0, cool: 0 });
      if (S.win > 0 || S.cool > 0) return false;
      S.win = SPACE_WINDOW; this.stats.slow.taps = (this.stats.slow.taps || 0) + 1;
      return true;
    }
    spaceTick() {
      const S = this.space || (this.space = { win: 0, cool: 0 });
      this.spaceSlowNow = S.win > 0;                              // this real frame is slowed if any window is left
      if (S.win > 0) { S.win--; this.stats.slow.frames++; if (S.win === 0) S.cool = SPACE_COOL; }
      else if (S.cool > 0) S.cool--;
    }
    spaceBar() {
      const S = this.space || { win: 0, cool: 0 };
      return S.win > 0 ? { state: 'slow', frac: S.win / SPACE_WINDOW } : S.cool > 0 ? { state: 'cool', frac: 1 - S.cool / SPACE_COOL } : { state: 'ready', frac: 1 };
    }
    // SAND REFUND (soul-on-hit): a blow that lands earns credit, and credit pays an attack's grain cost instead of losing the grain.
    // F burst +2, Q bolt +2, shard +2 per landed hit (credit lasts 90 frames, at most 8). A miss earns nothing and costs sand as before.
    sandCredit(n) {
      // grains this attack already lost in the last 40 frames come straight back; any credit left pays for grains still to burn
      const L = this.lostRecent = (this.lostRecent || []).filter((f) => this.frame - f < 40);
      while (n > 0 && L.length && this.body.n) { L.shift(); n--; if (this.reviveGrain(Math.round(this.body.x), Math.round(this.body.y - this.body.r))) { if (this.stats) this.stats.refunded = (this.stats.refunded || 0) + 1; } }
      if (n > 0) { if (this.frame - (this.creditAt || -999) > 90) this.credit = 0; this.credit = Math.min(8, (this.credit || 0) + n); this.creditAt = this.frame; }
    }
    payAttackGrain() {   // true if this grain is really lost
      if (this.frame - (this.creditAt || -999) > 90) this.credit = 0;
      if (this.credit > 0) { this.credit--; if (this.stats) this.stats.refunded = (this.stats.refunded || 0) + 1; return false; }
      (this.lostRecent || (this.lostRecent = [])).push(this.frame);
      return true;
    }
    // count one use (and its nominal grain cost) of an attack kind
    use(k, grains) { const S = this.stats[k]; S.uses++; S.grains += grains || 0; }
    runeDamage() {
      const M = this.mod;
      if (M.dmgF === 1 && M.dmgHammer === 1 && M.dmgQ === 1 && M.dmgSlam === 1) return;
      for (const h of this.hits) {
        if (h.runed) continue;
        h.runed = true;
        const m = RUNE_KIND[h.kind] ? M[RUNE_KIND[h.kind]] : 1;
        if (m && m !== 1 && h.dmg > 0) h.dmg = Math.floor(h.dmg * m + this.rand());
      }
    }
    endFreeze() {
      for (let i = 0; i < this.N; i++) if (this.state[i] === 2) this.state[i] = 1;
      if (this.frozen) {
        this.events.push({ type: 'thaw', auto: this.freezeT >= (this.freezeMax || FREEZE_MAX) });
        this.freezeCool = Math.round((FREEZE_COOL + FREEZE_SPAM_COOL * (this.freezeSpam || 0)) * (this.mod.freezeCost == null ? 1 : this.mod.freezeCost));
        this.freezeCoolMax = this.freezeCool;
        this.thawFrame = this.frame;
      }
      this.frozen = 0; this.freezeSeed = null;
      this.freezeBarrier = 0;
    }

    // Process grains furthest along the shared motion first, so a moving
    // clump does not block itself.
    sortOrder(dx, dy) {
      const { order, key, px, py, N } = this;
      let m = 0;
      for (let i = 0; i < N; i++) {
        if (this.state[i] !== 1) continue;
        order[m] = i; key[i] = -(px[i] * dx + py[i] * dy) + this.rand() * 0.5;
        m++;
      }
      const sub = order.subarray(0, m);
      sub.sort((a, b) => key[a] - key[b]);
      return m;
    }

    // inp: { x, y, pour, repel, charge, harden } in world cells.
    // charge = right button held. Press gathers the sand near the cursor into
    // Carry a grain along its fractional motion, stopping at anything solid.
    moveFrac(i) {
      const { fx, fy } = this;
      let guard = 20;
      while (guard-- > 0 && this.state[i] === 1 && (Math.abs(fx[i]) >= 1 || Math.abs(fy[i]) >= 1)) {
        const sx = Math.abs(fx[i]) >= 1 ? Math.sign(fx[i]) : 0, sy = Math.abs(fy[i]) >= 1 ? Math.sign(fy[i]) : 0;
        if (this.step1(i, sx, sy)) { fx[i] -= sx; fy[i] -= sy; }
        else if (this.swapThrough(i, sx, sy)) { fx[i] -= sx; fy[i] -= sy; }
        else if (this.frozenAt(this.px[i] + sx, this.py[i] + sy)) { this.shatter(this.px[i] + sx, this.py[i] + sy); this.strikeT[i] = 0; this.burn(i, 'hit'); break; }
        else if (sx && sy && this.step1(i, sx, 0)) { fx[i] -= sx; fy[i] = 0; this.vy[i] = 0; }
        else if (sx && sy && this.step1(i, 0, sy)) { fy[i] -= sy; fx[i] = 0; this.vx[i] = 0; }
        else { this.strikeT[i] = 0; fx[i] = 0; fy[i] = 0; this.burn(i, 'hit'); }
      }
    }
    // ---- melee: sand that becomes a blade, or a hammer ----
    // The main body of the spill (its thickest patch), which melee comes from.
    updateBody() {
      if (this.frame % 2 && this.body.n) return;
      const B = 24, counts = new Map();
      for (let i = 0; i < this.N; i++) if (this.state[i] === 1 || this.state[i] === 2) {
        const k = ((this.px[i] / B) | 0) * 4096 + ((this.py[i] / B) | 0); counts.set(k, (counts.get(k) || 0) + 1);
      }
      // the patch you mean: a good size, and nearest your cursor (melee comes
      // from the sand under your hand, not from wherever the biggest pile is)
      let best = -1, bn = 0;
      const cx = this.aimX == null ? null : this.aimX / B, cy = this.aimY == null ? null : this.aimY / B;
      for (const [k, v] of counts) {
        let a = v; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) a += counts.get(k + dx * 4096 + dy) || 0;
        if (a < 12) continue;
        const score = cx == null ? a : a / (1 + Math.hypot(((k / 4096) | 0) + 0.5 - cx, (k % 4096) + 0.5 - cy) * 0.9);
        if (score > bn) { bn = score; best = k; }
      }
      if (best < 0) { this.body.n = 0; return; }
      const bx = (best / 4096) | 0, by = best % 4096;
      let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < this.N; i++) if (this.state[i] === 1 || this.state[i] === 2) {
        const qx = (this.px[i] / B) | 0, qy = (this.py[i] / B) | 0;
        if (Math.abs(qx - bx) <= 1 && Math.abs(qy - by) <= 1) { n++; sx += this.px[i]; sy += this.py[i]; }
      }
      this.body.n = n; this.body.x = sx / n; this.body.y = sy / n;
      this.body.r = Math.max(5, Math.min(22, Math.sqrt(n / Math.PI) * 0.85));
    }
    melee(inp) {
      if (this.bladeCool > 0) this.bladeCool--;
      if (this.fBuf > 0) {                                    // a tap kept from the breath
        this.fBuf--;
        if (this.bladeCool === 0 && !this.hammer && this.body.n > 20 && this.tapReady('f') && this.afford('f')) { this.fBuf = 0; this.wave(inp, false); this.tapSpend('f'); this.use('f', 2); }
      }
      const press = inp.blade && !this.prevBlade, release = !inp.blade && this.prevBlade;
      this.prevBlade = !!inp.blade;
      if (press) this.bladeDown = this.frame;
      // a tap (released quickly) is a cut; holding instead charges the hammer
      if (release && !this.hammer && this.bladeDown >= 0 && this.frame - this.bladeDown < 14 && this.body.n > 20) {
        if (this.bladeCool === 0 && this.tapReady('f') && this.afford('f')) { this.wave(inp, false); this.tapSpend('f'); this.fBuf = 0; this.use('f', 2); }   // F: a short, wide burst
        else if (!this.afford('f')) this.events.push({ type: 'noAfford', key: 'f' });
        else if (this.bladeCool <= TAP_BUFFER && this.tapReady('f')) this.fBuf = TAP_BUFFER;
      }
      if (release) this.bladeDown = -1;
      // hold: the sand gathers into a hammer
      if (this.hammerCool > 0) this.hammerCool--;
      if (inp.blade && this.bladeDown >= 0 && this.frame - this.bladeDown >= 14 && !this.hammer && this.body.n > 40 && !(this.hammerCool > 0) && this.tapReady('f') && this.afford('hammer')) {
        // your own grains lift out of the body and gather into a hammer's head
        const b = this.body, list = [];
        for (let i = 0; i < this.N; i++) if (this.state[i] === 1 && Math.hypot(this.px[i] - b.x, this.py[i] - b.y) < b.r * 2) list.push([Math.hypot(this.px[i] - b.x, this.py[i] - b.y), i]);
        list.sort((p, q) => p[0] - q[0]);
        this.hsel.fill(0);
        const take = Math.min(120, Math.floor(b.n * 0.45));
        for (let k = 0; k < Math.min(take, list.length); k++) this.hsel[list[k][1]] = 1;
        this.hammer = { t: 0, dir: Math.sign(inp.x - this.body.x) || 1, px: b.x, py: b.y - b.r - 22 };
        this.events.push({ type: 'hammerCharge', x: this.body.x, y: this.body.y });
      }
      if (this.hammer) {
        const H0 = this.hammer;
        if (inp.blade) { H0.t = Math.min(HAMMER_FULL, H0.t + 1); H0.held = (H0.held || 0) + 1; H0.dir = Math.sign(inp.x - this.body.x) || H0.dir; }
        // where the head gathers: above you, leaning toward the side you face, rising as it grows
        H0.px += ((this.body.x + H0.dir * 10) - H0.px) * 0.2; H0.py += ((this.body.y - this.body.r - 22 - Math.min(1, H0.t / 50) * 10) - H0.py) * 0.2;
        if (H0.held === HAMMER_HOLD_MAX - HAMMER_WARN) this.events.push({ type: 'hammerWarn', x: H0.px, y: H0.py, left: HAMMER_WARN, power: Math.min(1, H0.t / HAMMER_FULL) });   // it is about to crumble: release now to smash
        if (H0.held > HAMMER_HOLD_MAX) { this.hammer = null; this.hsel.fill(0); this.bladeDown = -1; this.events.push({ type: 'hammerFade', reason: 'cap', x: H0.px, y: H0.py, grains: 0 }); }   // held too long: it crumbles; its grains were never taken from the body (only flagged), so they rejoin it and none are lost
        if (release && this.hammer) this.smash();
      }
      const sw = this.swing;
      if (sw) {
        sw.t++;
        const S0 = SWINGS[sw.stage], k = Math.min(1, Math.max(0, (sw.t - S0.act[0]) / (S0.act[1] - S0.act[0])));
        sw.cur = sw.a0 + (sw.a1 - sw.a0) * k;
        if (sw.t >= S0.act[0] && sw.t <= S0.act[1]) {
          const lo = Math.min(sw.a0, sw.cur), hi = Math.max(sw.a0, sw.cur);
          this.hits.push({ kind: 'blade', shape: 'arc', x: this.body.x, y: this.body.y, r0: this.body.r - 2, r: this.body.r + S0.reach, a0: lo - 0.2, a1: hi + 0.2, dmg: S0.dmg, poise: S0.poise, id: sw.id, dir: Math.sign(Math.cos(sw.a)) || 1, stage: sw.stage });
        }
        if (sw.t >= S0.dur) {
          if (sw.queued && sw.stage < 2) this.startSwing(sw.stage + 1, inp);
          else { this.swing = null; this.bladeCool = sw.stage === 2 ? 22 : 8; }
        }
      }
    }
    startSwing(stage, inp) {
      const S0 = SWINGS[stage], a = Math.atan2(inp.y - this.body.y, inp.x - this.body.x);
      const side = Math.cos(a) >= 0 ? 1 : -1, half = S0.sweep / 2 * (stage === 1 ? -1 : 1) * side;
      this.swing = { stage, t: 0, a, a0: a - half, a1: a + half, cur: a - half, id: ++this.hitN, queued: false, reach: S0.reach, act: S0.act, dur: S0.dur };
      this.events.push({ type: 'swing', stage, x: this.body.x, y: this.body.y, a });
    }
    cancelAttack() {
      if (this.hammer) {
        this.events.push({ type: 'hammerFade', reason: 'cancel', x: this.hammer.px, y: this.hammer.py, grains: 0 });      // Escape: a deliberate cancel, now announced
        this.hammer = null;
        this.hsel.fill(0);
        this.bladeDown = -1;
        return true;
      }
      if (this.icicles && !this.icicles.fire) {
        for (const group of this.icicles.groups) {
          for (const i of group) if (this.state[i] === 5) (this.reform || (this.reform = [])).push({ i, at: this.frame + 1 });
        }
        this.icicles = null;
        this.qDown = -1;
        return true;
      }
      return false;
    }
    cancelSuper() {
      if (!this.superNow) return false;
      for (let i = 0; i < this.N; i++) {
        if (!this.superOf[i]) continue;
        this.superOf[i] = 0;
        this.strikeT[i] = 0;
        if (this.state[i] === 5) (this.reform || (this.reform = [])).push({ i, at: this.frame + 1 });
      }
      this.superNow = null;
      this.superCharge = 0;
      return true;
    }
    smash() {
      // the head comes down: its grains are hurled at the ground in front
      const H0 = this.hammer; this.hammer = null;
      const power = Math.min(1, H0.t / HAMMER_FULL);                     // the longer F was held, the harder it falls
      let n = 0;
      for (let i = 0; i < this.N; i++) if (this.hsel[i]) {
        this.hsel[i] = 0;
        if (this.state[i] !== 1) continue;
        this.vx[i] = H0.dir * (1.2 + power * 1.0) + (this.px[i] - H0.px) * 0.03; this.vy[i] = -1.2;   // it rises a touch first
        this.hfall[i] = 1; n++;
      }
      if (!n) { this.hfall.fill(0); this.hammerFall = null; this.events.push({ type: 'hammerFade', reason: 'empty', x: H0.px, y: H0.py, grains: 0 }); return; }      // nothing left to swing: announced, not silent
      this.hammerFall = { t: 0, power, dir: H0.dir, n, id: ++this.hitN };
      this.bladeCool = 24;
      this.events.push({ type: 'hammerSwing', x: H0.px, y: H0.py, power });
    }
    // the hammer's grains reach the ground: the blow, and shockwaves both ways
    trackHammer() {
      const F0 = this.hammerFall;
      if (F0) {
        F0.t++;
        // then it comes down, faster every frame
        if (F0.t > 3) for (let i = 0; i < this.N; i++) if (this.hfall[i] && this.state[i] === 1) this.vy[i] = Math.min(9, this.vy[i] + 1.1 + F0.power * 0.5);
        // the blow lands the moment the head's leading grains strike the ground
        let n = 0, sx = 0, hit = 0, hx2 = 0, hy2 = 0;
        for (let i = 0; i < this.N; i++) if (this.hfall[i] && this.state[i] === 1) {
          n++; sx += this.px[i];
          // landed: on stone, or stopped dead on sand (a pile is ground too)
          if (this.terrainSolid(this.px[i], this.py[i] + 1) || (F0.t > 3 && this.vy[i] > 0 && this.solid(this.px[i], this.py[i] + 1) && !(this.pid[(this.py[i] + 1) * this.W + this.px[i]] >= 0 && this.hfall[this.pid[(this.py[i] + 1) * this.W + this.px[i]]]))) { hit++; hx2 += this.px[i]; hy2 = Math.max(hy2, this.py[i]); }
        }
        if (n && (hit >= Math.max(3, n * 0.08) || F0.t > 50)) {
          const x = hit ? hx2 / hit : sx / n; let y = Math.round(hit ? hy2 : this.body.y);
          while (y < this.H - 1 && !this.terrainSolid(Math.round(x), y + 1)) y++;
          const r = 16 + F0.power * 18;
          this.hits.push({ kind: 'hammer', shape: 'circle', x, y, r, dmg: 2 + Math.round(F0.power * 6), poise: 3 + Math.round(F0.power * 7), id: F0.id, dir: F0.dir, power: F0.power });
          for (const d of [-1, 1]) this.shocks.push({ x, y, d, t: 0, life: 26 + Math.round(F0.power * 22), id: ++this.hitN });
          this.hammerCool = this.hammerCoolMax = Math.round(300 * this.mod.hammerCool);
          this.events.push({ type: 'hammer', x, y, r, power: F0.power }); this.use('hammer', 5);
          // the head shatters on the blow: a share of it is spent for good (the hammer's cost)
          let cost = 5;
          for (let i = 0; i < this.N && cost > 0; i++) if (this.hfall[i] && this.state[i] === 1) {
            this.events.push({ type: 'grainPop', x: this.px[i], y: this.py[i], how: 'hit', a: -Math.PI / 2 });
            this.pid[this.py[i] * this.W + this.px[i]] = -1; this.state[i] = 0; this.alive--; this.lost++; cost--;
          }
          this.hfall.fill(0); this.hammerFall = null;
        } else if (!n) { this.hfall.fill(0); this.hammerFall = null; }
      }
      for (const w of this.shocks) {
        w.t++;
        // 3.4 cells a frame, one cell at a time, so a thin wall or a thin ice shield cannot be stepped over; stone and frozen sand stop it
        const hard = (x, y) => this.terrainSolid(x, y) || this.frozenAt(x, y);
        let y = Math.round(w.y), run = 3.4;
        while (run > 0) {
          const st = Math.min(1, run); run -= st;
          const nx = w.x + w.d * st; let ny = y;
          for (let k = 0; k < 6 && hard(Math.round(nx), ny); k++) ny--;                       // ride up small steps
          for (let k = 0; k < 6 && !hard(Math.round(nx), ny + 1); k++) ny++;                  // and down them
          if (hard(Math.round(nx), ny)) { w.t = w.life; break; }                              // a wall stops it (the blow stays on this side)
          w.x = nx; y = ny;
        }
        w.y = y;
        this.hits.push({ kind: 'shock', shape: 'circle', x: w.x, y: w.y - 3, r: 7, dmg: 2, poise: 3, id: w.id, dir: w.d });
      }
      this.shocks = this.shocks.filter((w) => w.t < w.life);
    }
    // ---- the super: every grain you are flies up out of sight, then falls
    // as rain across the whole view and past its edges; then it gathers back to you.
    // You give up control while it happens.
    // The stars are NOT grains in the world: each is a straight-falling point (no steering at all)
    // that lands, strikes, and is gone, so a landing star can never leave a blocker behind.
    //   0-70     your grains lift a little off the ground, tremble, and start to glow
    //   70-130   they rise, slowly then faster, and leave the top of the screen
    //   130-150  nothing: the sky is empty
    //   150-570  the rain: SUPER_WAVES waves of dense rain over a thinner drizzle (7 s)
    //   to ~610  the last stars land, the grains gather home
    // Events (for visuals): superStart {x,y,area:{x0,y0,x1,y1},rainStart,rainEnd,waves,reach:{x0,x1}}, superUp, superRise, superGone,
    //   superFall (rain begins), superWave {n,t,x0,x1,wind,count}, superStar {id,x,y,vx,vy,wave,eye} at spawn,
    //   superStarLand {id,x,y,hit:'foe'|'boss'|'glance'|'ground'|'sand'|'miss',wave} (+ the old 'star' {x,y} on a ground/sand landing), superEnd.
    startSuper(area) {
      if (this.superCharge < 1 || this.superNow) return false;
      this.superCharge = 0; this.use('super', 0);
      const hasArea = area && isFinite(area.x0) && isFinite(area.x1) && area.x1 > area.x0;
      const wide = hasArea ? { x0: area.x0, x1: area.x1, y0: area.y0 != null ? area.y0 : this.body.y - 135, y1: (area.y0 != null ? area.y0 : this.body.y - 135) + 270 }
        : { x0: this.body.x - 240, x1: this.body.x + 240, y0: this.body.y - 135, y1: this.body.y + 135 };
      wide.vy0 = wide.y0;
      const reachPad = (wide.x1 - wide.x0) * 0.25;
      const reach = { x0: Math.max(1, wide.x0 - reachPad), x1: Math.min(this.W - 2, wide.x1 + reachPad) };
      const safe = [];
      const x0 = Math.max(1, Math.floor(wide.x0)), x1 = Math.min(this.W - 2, Math.ceil(wide.x1));
      for (let x = x0; x <= x1; x++) for (let y = 1; y < this.H - 1; y++) {
        const c = y * this.W + x, below = (y + 1) * this.W + x;
        if (this.blocks(c) || this.pid[c] >= 0 || P.noRest[this.g[c]] === 1) continue;
        if (P.noRest[this.g[below]] === 1) continue;
        if (this.blocks(below)) { safe.push({ x, y }); break; }
      }
      this.superNow = { t: 0, area: wide, reach, safe, bx: this.body.x, by: this.body.y, aloft: [], next: 0, rainStart: SUPER_RAIN_AT, rainEnd: SUPER_RAIN_AT + SUPER_RAIN, stars: [], land: [], starN: 0, curtain: 0, wave: -1, waveNow: null, starsLanded: 0 };
      for (let i = 0; i < this.N; i++) if (this.state[i] === 1) { this.superOf[i] = 1; this.strikeT[i] = 0; }
      this.events.push({ type: 'superUp', x: this.body.x, y: this.body.y });
      this.events.push({ type: 'superStart', x: this.body.x, y: this.body.y, area: { x0: wide.x0, y0: wide.y0, x1: wide.x1, y1: wide.y1 }, reach, rainStart: SUPER_RAIN_AT, rainEnd: SUPER_RAIN_AT + SUPER_RAIN, waves: SUPER_WAVES });
      return true;
    }
    stepSuper() {
      const S0 = this.superNow; if (!S0) return;
      S0.t++;
      const A0 = S0.area, W = this.W, t = S0.t;
      if (t <= 130) {
        for (let i = 0; i < this.N; i++) {
          if (!this.superOf[i] || this.state[i] !== 1) continue;
          if (t < 70) {
            // lift and tremble: gravity is cancelled, a small rise, a shiver that grows
            const sh = 0.15 + t / 70 * 0.5;
            this.vy[i] = Math.max(-0.8, this.vy[i] * 0.6 - 0.32 - (this.rand() < 0.02 ? 0.6 : 0));
            this.vx[i] = this.vx[i] * 0.5 + (this.rand() - 0.5) * sh;
          } else {
            // the rise: slow at first, then pulling away
            const k = (t - 70) / 60;
            this.vy[i] = Math.max(-9, this.vy[i] - 0.1 - k * 0.5);
            this.vx[i] *= 0.92;
            this.strikeT[i] = 2;                                             // passes through things as it goes
          }
          // gone over the top of the view: held aloft, out of the world
          if (this.py[i] < A0.vy0 - 4 || (t === 130)) {
            this.pid[this.py[i] * W + this.px[i]] = -1; this.state[i] = 5; this.alive--; this.pending++; this.strikeT[i] = 0; S0.aloft.push(i);
          }
        }
        if (t === 70) this.events.push({ type: 'superRise' });
        if (t === 130) this.events.push({ type: 'superGone' });
      }
      // ---- the rain ----
      const RS = S0.rainStart, RE = S0.rainEnd;
      if (t === RS) this.events.push({ type: 'superFall' });
      if (t >= RS && t < RE) {
        const u = t - RS, waveLen = SUPER_RAIN / SUPER_WAVES, w = Math.floor(u / waveLen), ph = (u % waveLen) / waveLen;
        if (w !== S0.wave) {
          // each wave: a band that sweeps across the view and a wind that leans the whole wave one way (everything in it falls parallel)
          S0.wave = w;
          const span = S0.reach.x1 - S0.reach.x0, cx = S0.reach.x0 + span * (((w * 0.381966 + 0.13) % 1) * 0.8 + 0.1), wd = span * (0.3 + this.rand() * 0.2);
          S0.waveNow = { n: w, cx, wd, wind: (this.rand() - 0.5) * 1.6 + (w % 2 ? 0.3 : -0.3), count: 0, drift: (this.rand() - 0.5) * 0.4 };
          this.events.push({ type: 'superWave', n: w, t, x0: Math.max(S0.reach.x0, cx - wd / 2), x1: Math.min(S0.reach.x1, cx + wd / 2), wind: S0.waveNow.wind, count: 0 });
        }
        const WV = S0.waveNow;
        // dense in the middle of each wave, thin between (the drizzle never stops)
        const pulse = Math.pow(Math.sin(Math.PI * ph), 2);
        const rate = SUPER_DRIZZLE + SUPER_PULSE * pulse;
        let take = Math.floor(rate + this.rand());
        const bossT = this.level && this.level.superTargets ? this.level.superTargets(this) : [];
        // the curtain over the open eye: exactly bossT.stars stars, evenly spaced through the rain, straight down inside the eye's rect
        const curtain = [];
        if (bossT.length && S0.curtain < bossT[0].stars && t >= (S0.nextCurtain || RS + 10) && !(this.boss && this.boss.guard)) { curtain.push(bossT[0]); S0.nextCurtain = t + SUPER_EYE_GAP; }   // evenly spaced, held back only while the eye's guard is up (a guarded eye would only glance)
        while (take-- > 0 || curtain.length) {
          let x, eye = false, windy = true;
          if (curtain.length) { const g = curtain.pop(); x = g.x + (this.rand() - 0.5) * (g.w - 8); eye = true; windy = false; S0.curtain++; }
          else {
            const r = this.rand();
            if (r < 0.1 + 0.45 * pulse) x = WV.cx + (this.rand() + this.rand() - 1) * WV.wd * 0.5;                              // the wave's band
            else x = S0.reach.x0 + this.rand() * (S0.reach.x1 - S0.reach.x0);                                                    // anywhere in the view and past it
            if (bossT.length && Math.abs(x - bossT[0].x) < bossT[0].w / 2 + 12) continue;                                        // the eye is hit only by its own curtain: the total stays bounded
          }
          x = Math.max(1, Math.min(W - 2, x));
          let y = Math.max(1, A0.y0 - 6 - this.rand() * 40);
          while (y < this.H - 2 && (this.blocks(y * W + Math.round(x)) || this.pid[y * W + Math.round(x)] >= 0)) y++;       // a ceiling is no gate: the rain starts below it
          if (y >= this.H - 2) continue;
          const vx = windy ? WV.wind + (this.rand() - 0.5) * 0.25 : 0, vy = 3.5 + this.rand() * 2.5;
          if (!eye && bossT.length) {                                        // a drizzle star never drifts onto the open eye: only the curtain lands there
            const g = bossT[0]; let px = x, py = y, pv = vy, bad = false;
            for (let k = 0; k < 120 && py < g.y + 8; k++) { pv = Math.min(10, pv + 0.22); py += pv; px += vx; if (py > g.y - 8 && Math.abs(px - g.x) < g.w / 2 + 6) { bad = true; break; } }
            if (bad) continue;
          }
          const id = ++S0.starN;
          S0.stars.push({ id, x, y, sx: x, sy: y, vx, vy, wave: w, eye });
          WV.count++;
          this.events.push({ type: 'superStar', id, x, y, vx, vy, wave: w, eye });
        }
      }
      // every star falls straight (gravity only) until it meets something
      const EYH = this.level && this.level.eyeHit && this.boss ? this.level.eyeHit : null;
      for (let k = S0.stars.length - 1; k >= 0; k--) {
        const q = S0.stars[k];
        q.vy = Math.min(10, q.vy + 0.22);
        const n = Math.ceil(q.vy / 1.5), dx = q.vx / n, dy = q.vy / n;
        let hit = null, on = null;
        for (let s2 = 0; s2 < n && !hit; s2++) {
          q.x += dx; q.y += dy;
          const cx = Math.round(q.x), cy = Math.round(q.y);
          if (cy >= this.H - 1 || cx < 1 || cx >= W - 1) { hit = 'miss'; break; }
          if (cy < 1) continue;
          if (EYH) { const eh = EYH.call(this.level, this, q.x, q.y); if (eh) { hit = eh === 'open' ? 'boss' : 'glance'; on = eh; break; } }
          for (const f of this.foes || []) {
            if (f.dead || f.hp <= 0) continue;
            const big = f.tier === 'warden';
            if (Math.abs(q.x - f.x) <= (big ? 13 : 11) && Math.abs(q.y - (f.y - (big ? 15 : 5))) <= (big ? 16 : 6)) { hit = 'foe'; on = f; break; }
          }
          if (hit) break;
          const c = cy * W + cx;
          if (this.blocks(c)) { hit = 'ground'; break; }
          if (this.pid[c] >= 0) { hit = 'sand'; break; }
        }
        if (hit) {
          S0.stars.splice(k, 1); S0.starsLanded++;
          const lx = Math.round(q.x), ly = Math.round(q.y);
          this.events.push({ type: 'superStarLand', id: q.id, x: lx, y: ly, hit, wave: q.wave });
          if (hit === 'ground' || hit === 'sand') { if ((q.id & 3) === 0) this.events.push({ type: 'star', x: lx, y: ly }); }
          if ((hit === 'boss' || hit === 'glance') && this.level && this.level.starWound) this.level.starWound(this, q.x, q.y, on);
          if (hit !== 'miss' && hit !== 'sand' && hit !== 'glance') S0.land.push({ x: q.x, y: hit === 'foe' ? on.y - (on.tier === 'warden' ? 15 : 5) : q.y, id: q.id, dir: Math.sign(q.vx) || 1 });
        }
      }
      if (t >= RE && !S0.stars.length) {
        // it is over: the grains gather back to you (to a safe place if the pile is gone)
        for (const i of S0.aloft) if (this.state[i] === 5) (this.reform || (this.reform = [])).push({ i, at: this.frame + 1 + ((this.rand() * 30) | 0) });
        for (let i = 0; i < this.N; i++) if (this.superOf[i]) {
          this.superOf[i] = 0; this.waveOf[i] = 0; this.strikeT[i] = 0;
          if (this.state[i] === 1) {
            this.state[i] = 5; this.alive--; this.pending++;
            (this.reform || (this.reform = [])).push({ i, at: this.frame + 1 });
          }
        }
        // with nothing left of you in the world, the grains gather where you stood (the nearest safe floor), not at the cursor
        let hb = null, hd = 1e9;
        for (const c of S0.safe) { const d = Math.hypot(c.x - S0.bx, c.y - S0.by); if (d < hd) { hd = d; hb = c; } }
        this.reformHome = hb ? { x: hb.x, y: hb.y - 5 } : { x: S0.bx, y: S0.by };
        this.superNow = null;
        this.events.push({ type: 'superEnd', stars: S0.starN });
      }
    }
    // the stars that landed this frame strike (called after the frame's hit list is reset)
    flushSuperHits() {
      const S0 = this.superNow; if (!S0 || !S0.land.length) return;
      for (const L of S0.land) this.hits.push({ kind: 'star', shape: 'circle', x: L.x, y: L.y, r: SUPER_STAR_R, dmg: SUPER_STAR_DMG, poise: 3, id: 'S' + L.id, sid: 'S' + L.id, dir: L.dir });
      S0.land.length = 0;
    }
    // ---- icicles: shards of sand that form around you while Q is held ----
    growIcicles() {
      const I = this.icicles || (this.icicles = { groups: [], t: 0, fire: null });
      if (I.fire) return;
      I.t++;
      if (I.groups.length >= 5 + this.mod.shards || I.t % 7 !== 1 || !this.afford('shard')) return;
      const b = this.body, list = [];
      for (let i = 0; i < this.N; i++) if (this.state[i] === 1 && !this.iceOf[i] && !this.hsel[i] && Math.hypot(this.px[i] - b.x, this.py[i] - b.y) < b.r * 1.8) list.push([Math.hypot(this.px[i] - b.x, this.py[i] - b.y), i]);
      list.sort((p, q) => p[0] - q[0]);
      const g = [];
      for (let k = 0; k < Math.min(8, list.length); k++) { this.iceOf[list[k][1]] = I.groups.length + 1; g.push(list[k][1]); }
      if (g.length < 3) { for (const i of g) this.iceOf[i] = 0; return; }
      // the grains leave the pile and become the shard (held, out of the world, until it flies)
      const from = g.map((i) => [this.px[i], this.py[i], this.tint[i]]);
      for (const i of g) { this.iceOf[i] = 0; this.pid[this.py[i] * this.W + this.px[i]] = -1; this.state[i] = 5; this.alive--; this.pending++; }
      g.born = this.frame;
      // each shard its own: a long spike, a curved fang or a rough chunk, small to large
      g.kind = ['spike', 'fang', 'chunk'][(this.rand() * 3) | 0]; g.size = 0.8 + this.rand() * 0.7;
      I.groups.push(g);
      this.events.push({ type: 'icicleForm', x: b.x, y: b.y, n: I.groups.length, k: I.groups.length - 1, from });
    }
    // each shard's place: fanned in an arc above you
    icicleSlot(k) {
      const b = this.body, a = -Math.PI / 2 + (k - 2) * 0.55;
      return { x: b.x + Math.cos(a) * (b.r + 12), y: b.y + Math.sin(a) * (b.r + 12) };
    }
    fireIcicles(inp) {
      this.icicles.fire = { t: 0, k: 0, tx: inp.x, ty: inp.y };
      this.use('shards', 5 * this.icicles.groups.length);
      this.strikeCool = 50; this.iceCool = 250;
    }
    stepIcicles(inp) {
      const I = this.icicles; if (!I) return;
      if (I.fire) {
        I.fire.tx = inp.x; I.fire.ty = inp.y;
        if (I.fire.t++ >= 4 && I.fire.t % 3 === 0 && I.fire.k < I.groups.length) {     // a held breath, then the volley
          const g = I.groups[I.fire.k++], id = ++this.strikeN & 0xffff || 1;
          const sl = this.icicleSlot(I.fire.k - 1), cx = sl.x, cy = sl.y;
          // fanned out around the aim, each a little different; they curve back toward the mark as they fly
          const dist = Math.hypot(I.fire.tx - cx, I.fire.ty - cy), step = Math.max(SHARD_SPREAD_MIN, Math.min(SHARD_SPREAD, SHARD_SPREAD_W / Math.max(20, dist)));   // the fan is as wide as the mark, not a fixed wedge
          const a = Math.atan2(I.fire.ty - cy, I.fire.tx - cx) + ((I.fire.k - 1) - (I.groups.length - 1) / 2) * step + (this.rand() - 0.5) * Math.min(0.22, step * 0.7);
          const carried = g.filter((i) => this.state[i] === 5);
          this.launchBolt('shard', cx, cy, a, carried, 'I' + id, g);
          this.events.push({ type: 'icicleFire', x: cx, y: cy, a });
        }
        if (I.fire.k >= I.groups.length) this.icicles = null;
      }
    }
    // F tapped: a wave of your own sand surges out from the side of the body
    // that faces the cursor, a long way, striking what it passes; the grains
    // stay yours wherever they come to rest
    attackMound(inp, long) {
      const b = this.body, B = 24, bins = new Map();
      const reach = long ? 900 : (b.r + BURST_REACH) * BURST_SCALE;
      for (let i = 0; i < this.N; i++) if (this.state[i] === 1 && !this.strikeT[i] && !this.hsel[i] && !this.iceOf[i]) {
        const bx = (this.px[i] / B) | 0, by = (this.py[i] / B) | 0;
        const key = bx * 4096 + by, bin = bins.get(key) || { bx, by, n: 0, sx: 0, sy: 0 };
        bin.n++; bin.sx += this.px[i]; bin.sy += this.py[i]; bins.set(key, bin);
      }
      let best = null, bestMiss = Infinity, bestBlocked = Infinity, bestDistance = Infinity;
      for (const bin of bins.values()) {
        if (bin.n < 8 || Math.hypot(bin.sx / bin.n - b.x, bin.sy / bin.n - b.y) > 115) continue;
        const x = bin.sx / bin.n, y = bin.sy / bin.n, dx = inp.x - x, dy = inp.y - y, distance = Math.hypot(dx, dy);
        const miss = Math.max(0, distance - reach);
        let blocked = 0;
        for (let t = 0.1; t < 1; t += 0.1) if (this.terrainSolid(Math.round(x + dx * t), Math.round(y + dy * t))) blocked++;
        if (miss < bestMiss || (miss === bestMiss && (blocked < bestBlocked || (blocked === bestBlocked && distance < bestDistance)))) {
          best = { x, y, r: Math.max(5, Math.min(22, Math.sqrt(bin.n / Math.PI) * 0.85)), bx: bin.bx, by: bin.by };
          bestMiss = miss; bestBlocked = blocked; bestDistance = distance;
        }
      }
      return best;
    }
    wave(inp, long) {
      const mound = this.attackMound(inp, long), b = mound || this.body;
      if (b.n < 20 && !mound) return;
      const a = Math.atan2(inp.y - b.y, inp.x - b.x), dx = Math.cos(a), dy = Math.sin(a);
      const cand = [];
      for (let i = 0; i < this.N; i++) {
        if (this.state[i] !== 1 || this.strikeT[i]) continue;
        const rx = this.px[i] - b.x, ry = this.py[i] - b.y;
        if (mound ? Math.abs(((this.px[i] / 24) | 0) - mound.bx) > 1 || Math.abs(((this.py[i] / 24) | 0) - mound.by) > 1 : rx * rx + ry * ry > b.r * b.r * 5) continue;
        cand.push([rx * dx + ry * dy, i]);
      }
      cand.sort((p, q) => q[0] - p[0]);                                     // the front of the body goes first
      // Q: a narrow, fast surge that carries a long way; F: a short, wide burst
      const id = ++this.strikeN & 0xffff || 1, take = Math.min(long ? 30 : 26, cand.length);
      this.atkCost = (this.atkCost || 0) + Math.min(2, take);
      for (let k = 0; k < take; k++) {
        const i = cand[k][1], spread = (this.rand() - 0.5) * (long ? 0.28 : BURST_ARC * 2), sp = ((long ? 6.4 : 5.2) + this.rand() * 1.4) * (long ? 1.6 : 1.2), aa = a + spread;
        this.vx[i] = Math.cos(aa) * sp; this.vy[i] = Math.sin(aa) * sp; this.fx[i] = 0; this.fy[i] = 0;
        if (long) continue;
        this.strikeT[i] = 2 + Math.floor(this.rand() * 2); this.strikeOf[i] = id; this.waveOf[i] = 1;   // a short flight: the fan stays close
      }
      if (!long) { this.bladeCool = 20; this.burst = { t: 7, a, id: 'W' + id }; }
      // Q: the grains gather into one bolt that flies far, curving a little toward what you marked
      else {
        const carried = [];
        for (let k = 0; k < take; k++) { const i = cand[k][1]; this.strikeT[i] = 0; this.waveOf[i] = 0; carried.push(i); }
        this.atkCost -= Math.min(2, take);                                     // the bolt keeps its own cost
        let gx = b.x + dx * (b.r + 12), gy = b.y + dy * (b.r + 12);
        if (this.terrainSolid(Math.round(gx), Math.round(gy))) { gx = b.x + dx * b.r; gy = b.y + dy * b.r; }
        this.events.push({ type: 'qGather', x: gx, y: gy, from: carried.map((i) => [this.px[i], this.py[i], this.tint[i]]) });
        this.launchBolt('q', gx, gy, a, carried, 'Q' + id);
        this.bolts[this.bolts.length - 1].wait = 7;
      }
      this.events.push({ type: 'wave', x: b.x, y: b.y, a, n: take, long });
    }
    // F's burst: a real arc of force in front of you for a few frames (fast grains alone skip past things)
    // Q's bolts: travel in small steps so nothing is skipped; burst on a wall or a creature
    stepBolts() {
      const B0 = this.burst, b = this.body;
      if (B0 && b.n) {
        this.hits.push({ kind: 'burst', shape: 'arc', x: b.x, y: b.y, r0: 0, r: (b.r + BURST_REACH) * BURST_SCALE + BURST_PAD_R, a0: B0.a - BURST_ARC - BURST_PAD_A, a1: B0.a + BURST_ARC + BURST_PAD_A, dmg: 3, poise: 2, id: B0.id, dir: Math.sign(Math.cos(B0.a)) || 1 });
        if (--B0.t <= 0) this.burst = null;
      }
      this.stepProjectiles();
    }
    // can you pay for it? every ability keeps a reserve of you that it will not spend
    afford(kind) { const need = { f: 20, q: 30, hammer: 45, shard: 20, slow: 20 }[kind]; return (this.alive || 0) >= need; }
    tapLimit(k) { return k === 'f' ? 5 : 3; }                                     // F has five charges; Q has three
    // A charge comes back every TAP_RELOAD frames from the first one spent, so a spaced rhythm never runs dry and an emptied
    // set needs only ONE charge back (it used to refill nothing until empty, then lock for 150 frames until all were back).
    // The rates keep the old budget: F ~1.2 taps a second, Q ~0.8.
    tapReloadMax(k) { return Math.max(1, Math.round((k === 'f' ? TAP_RELOAD_F * this.mod.fRest : TAP_RELOAD_Q))); }
    tapReady(k) { const c = this.taps && this.taps[k]; return !c || c.ammo > 0; }
    tapSpend(k) {
      const c = this.taps[k]; c.ammo--; c.last = this.frame;
      if (!c.reloading) { c.reload = this.tapReloadMax(k); c.reloading = true; }
    }
    // what the cursor marks: the living creature nearest it, if it is close enough
    pickTarget(inp) {
      // sim.lockOn: what the cursor would lock onto right now (for the lock-on icon; Q's aim assist and the shard volley use the same radius):
      //   { kind: 'creature'|'warden'|'eye', x, y (the centre to draw on), r (draw radius), near: 0..1 (1 = cursor dead centre), held: shards are held }
      let best = null, bd = LOCK_R, bk = null;
      for (const f of this.foes) {
        if (f.dead) continue;
        const d = Math.hypot(f.x - inp.x, (f.y - 6) - inp.y);
        if (d < bd) { bd = d; best = f; bk = f.tier === 'warden' ? 'warden' : 'creature'; }
      }
      const E = this.level && this.level.eyeTarget ? this.level.eyeTarget(this) : null;       // the Sieve's open eye is lockable too
      if (E) {
        const d = Math.hypot(E.x - inp.x, E.y - inp.y), reach = LOCK_R + E.r;
        if (d < reach && (!best || d - E.r < bd)) {
          const L = this.eyeLock || (this.eyeLock = { kind: 'eye', tier: 'eye', eye: true, dead: false, hp: 1 });
          L.x = E.x; L.y = E.y + 6; best = L; bk = 'eye'; bd = Math.max(0, d - E.r);           // (y + 6: the shards and the reticle both aim at y - 6)
        }
      }
      const holding = this.icicles && this.icicles.groups.length && !this.icicles.fire;
      this.lockOn = best ? { kind: bk, x: best.x, y: best.y - 6, r: bk === 'warden' ? 20 : bk === 'eye' ? E.r + 4 : 12, near: Math.max(0, 1 - bd / LOCK_R), held: !!holding } : null;
      if (!holding) { if (!(this.icicles && this.icicles.fire)) this.aimTarget = null; return; }
      this.aimTarget = best;
    }
    // a carried attack: its grains ride inside it, out of the world, and come home after it bursts
    launchBolt(kind, x, y, a, grains, id, g) {
      for (const i of grains) {
        if (this.state[i] !== 1) continue;
        this.pid[this.py[i] * this.W + this.px[i]] = -1; this.state[i] = 5; this.alive--; this.pending++;
      }
      const shard = kind === 'shard';
      (this.bolts || (this.bolts = [])).push({ kind, x, y, a, v: shard ? 9 : 7.5, t: 0, life: shard ? 120 : 115, id, grains, target: this.aimTarget || null,
        wander: shard ? (this.rand() - 0.5) * 0.03 : 0, trail: [], cost: shard ? 5 : 2, skind: g && g.kind, size: g ? g.size : 1 });
      if (!shard) {
        const q = this.bolts[this.bolts.length - 1]; q.target = null;                                     // a tap bolt is not guided: it weaves on its own
        if (this.mod.qSteady) { q.steady = true; q.life = Math.round(q.life * 1.25); q.wander *= 0.3; }
        // it leaves angled off your line to one side (either, by chance) and swings across it and back
        q.lat = { sgn: this.rand() < 0.5 ? -1 : 1, amp: Q_WEAVE * (q.steady ? 0.3 : 1) };
        q.bx = q.x; q.by = q.y; q.dist = 0; q.tx = this.aimX; q.ty = this.aimY;
      }
    }
    stepProjectiles() {
      const L = this.bolts; if (!L || !L.length) return;
      for (let k = L.length - 1; k >= 0; k--) {
        const q = L[k];
        if (q.wait > 0) { if (--q.wait === 0) this.events.push({ type: 'boltLaunch', x: q.x, y: q.y, a: q.a }); continue; }   // still gathering its grains
        q.t++;
        const shard = q.kind === 'shard';
        // steering: a gentle turn toward the marked target (it can still miss), and away from walls ahead
        const turn = shard ? 0.015 : 0.05;
        let want = null;
        if (q.target && !q.target.dead && q.t > 3) want = Math.atan2((q.target.y - 6) - q.y, q.target.x - q.x);
        const ahead = (ang, d) => this.terrainSolid(Math.round(q.x + Math.cos(ang) * d), Math.round(q.y + Math.sin(ang) * d));
        if (ahead(q.a, 12) && q.t > 2) {
          const l = !ahead(q.a - 0.6, 12), r = !ahead(q.a + 0.6, 12);
          if (l || r) want = q.a + (l && (!r || (want != null && Math.sin(want - q.a) < 0)) ? -0.9 : 0.9);
        }
        if (want != null) { let d = want - q.a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; q.a += Math.max(-turn, Math.min(turn, d)); }
        else q.a += q.wander * 0.4 + (shard ? Math.sin(q.t * 0.17 + k * 1.7) * (q.steady ? 0.008 : 0.022) : 0);
        if (q.lat && q.t > 6) {                                          // aim assist: a gentle pull toward the creature nearest its line
          let bf = null, bd = Q_CONE_W;
          const cands = (this.foes || []).filter((f) => !f.dead && f.hp > 0).map((f) => ({ x: f.x, y: f.y - 5, eye: false }));
          const EYE = this.level && this.level.eyeTarget ? this.level.eyeTarget(this) : null;       // the Sieve's open eye is a lock target too (centre of the eye)
          if (EYE) cands.push({ x: EYE.x, y: EYE.y, eye: true, r: EYE.r });
          for (const f of cands) {
            const dx = f.x - q.bx, dy = f.y - q.by, d = Math.hypot(dx, dy);
            if (d < Q_PULL_MIN || d > Q_PULL_MAX) continue;
            let df = Math.atan2(dy, dx) - q.a; while (df > Math.PI) df -= Math.PI * 2; while (df < -Math.PI) df += Math.PI * 2;
            const lat = Math.abs(Math.sin(df)) * d - (f.eye ? f.r : 0);
            if (Math.abs(df) < 1 && lat < bd) { bd = lat; bf = { df, d, eye: f.eye }; }
          }
          if (bf) {
            const bell = Math.sin(Math.PI * Math.min(1, Math.max(0, (bf.d - Q_PULL_MIN) / (Q_PULL_MAX - Q_PULL_MIN))));       // strongest at mid range, none very near or very far
            const pull = bf.eye ? Q_PULL_EYE : Q_PULL;                   // a still eye is pulled on harder than a walking creature (it cannot dodge, and sits behind stone)
            q.a += Math.max(-pull, Math.min(pull, bf.df * 0.12)) * (bf.eye ? Math.max(bell, 0.5) : bell);
          }
        }
        const sp = q.v * (q.t < 4 ? 1.35 : 1) * (q.t > q.life - 20 ? Math.max(0.3, (q.life - q.t) / 20) : 1);
        let boom = null;
        for (let s2 = 0; s2 < sp && !boom; s2 += 1.5) {
          const st = Math.min(1.5, sp - s2);
          if (q.lat) {                                                 // the line advances; the bolt rides a smooth S either side of it
            q.bx += Math.cos(q.a) * st; q.by += Math.sin(q.a) * st; q.dist = (q.dist || 0) + st;
            const tt = q.t - 1 + (s2 + st) / sp, rem = q.tx == null ? 1e9 : Math.max(0, Math.hypot(q.tx - q.bx, q.ty - q.by));
            const env = Math.min(1, tt / Q_WEAVE_EASE) * (q.tx == null ? 1 : Math.max(0.12, Math.min(1, rem / Q_WEAVE_NEAR)));
            const off = q.lat.sgn * q.lat.amp * env * Math.sin(Q_WEAVE_W * tt);
            let fo = 1;                                                // the swing never drives it into the floor or a wall: it flattens against them
            for (let g = 0; g < 4; g++) { q.x = q.bx - Math.sin(q.a) * off * fo; q.y = q.by + Math.cos(q.a) * off * fo; if (!this.terrainSolid(Math.round(q.x), Math.round(q.y))) break; fo *= 0.4; if (g === 3) { q.x = q.bx; q.y = q.by; } }
          } else { q.x += Math.cos(q.a) * st; q.y += Math.sin(q.a) * st; q.dist = (q.dist || 0) + st; }
          if (this.terrainSolid(Math.round(q.x), Math.round(q.y))) {
            boom = 'wall';
            // a bolt that bursts on the pedestal or lip right beside an open eye has hit the eye (they sit on stone: a direct line from below clips its corner)
            const E = this.level && this.level.eyeNear ? this.level.eyeNear(this, q.x, q.y) : null;
            if (E) { q.x = E.x; q.y = E.y; boom = 'foe'; }
          }
          else if (this.boss && this.boss.open >= 0 && globalThis.SpillBoss) { const e = globalThis.SpillBoss.EYES[this.boss.open]; if (Math.abs(q.x - (e.x + e.w / 2)) < e.w / 2 + 1 && Math.abs(q.y - (e.y - 6)) < 8) { boom = 'foe'; q.x = e.x + e.w / 2; q.y = e.y - 6; } }   // (it bursts ON the eye: the hit is read from the eye's centre)
          else for (const f of this.foes) {
            if (f.dead) continue;
            const big = f.tier === 'warden';
            if (Math.abs(f.x - q.x) < (shard ? 6 : 6) + (big ? 8 : 0) && Math.abs((f.y - 5) - q.y) < (shard ? 6 : 6) + (big ? 12 : 0)) { boom = 'foe'; break; }
          }
        }
        q.trail.unshift({ x: q.x, y: q.y }); if (q.trail.length > 16) q.trail.pop();
        const sz = q.size || 1;
        const far = shard ? 0 : Math.min(2, Math.floor((q.dist || 0) / Q_RANGE));                     // a long shot that lands hits harder
        this.hits.push({ kind: shard ? 'shard' : 'lash', shape: 'circle', x: q.x, y: q.y, r: shard ? 4 + sz * 2 : 5, dmg: shard ? Math.round(0.5 + sz * 0.7) : Q_HIT * (1 + far), poise: shard ? 2 : 1 + far, id: q.id, dir: Math.sign(Math.cos(q.a)) || 1, far });
        if (boom || q.t >= q.life) {
          if (boom) this.hits.push({ kind: shard ? 'shard' : 'lash', shape: 'circle', x: q.x, y: q.y, r: shard ? 8 + sz * 5 : 9, dmg: shard ? (sz > 1.15 ? 1 : 0) : 1, poise: 2, id: q.id + 'X', dir: Math.sign(Math.cos(q.a)) || 1 });
          this.events.push({ type: 'boltBoom', x: q.x, y: q.y, a: q.a, on: boom || 'air', kind: q.kind });
          // its grains: a few are spent for good, the rest come home
          let cost = q.cost;
          for (const i of q.grains) {
            if (this.state[i] !== 5) continue;
            if (cost > 0 && (cost--, this.payAttackGrain())) { this.state[i] = 0; this.pending--; this.lost++; }
            else (this.reform || (this.reform = [])).push({ i, at: this.frame + 24 + Math.floor(this.rand() * 34) });
            this.events.push({ type: 'grainPop', x: q.x + (this.rand() - 0.5) * 6, y: q.y + (this.rand() - 0.5) * 6, how: boom ? 'hit' : 'air', shard, a: q.a, quiet: true });
          }
          L.splice(k, 1);
        }
      }
    }
    // ---- the second attack, and what happens when attacks meet ----
    // A thrown clump that strikes something hard is a Slam: a shock that
    // stuns whatever is near where it hits. It is the throw's own momentum
    // that counts, from any side: down onto the floor, sideways into a wall
    // or a creature, up into a ceiling. Needs enough sand moving fast enough.
    slamFrom(T0, x, y, n, speed, dx, dy) {
      // strength: how hard it hit, or how hard it was thrown (a long arc sheds speed in flight)
      const impactSpeed = Math.max(speed, T0.max * 0.75);
      const k = Math.min(1, Math.max(0, (impactSpeed - SLAM_V) / 3) * 0.6 + Math.min(1, n / 250) * 0.4);
      // repeats close together pay less; a slam also starts the cooldown and the recovery
      this.slamLog = (this.slamLog || []).filter((f) => this.frame - f < SLAM_REPEAT_WINDOW);
      const repeat = SLAM_REPEAT[Math.min(SLAM_REPEAT.length - 1, this.slamLog.length)];
      this.slamLog.push(this.frame); this.use('slam', 0);
      const slam = { x, y, n, r: 24 + 32 * k, power: k, id: 60000 + T0.id, dx, dy, repeat };
      // the clump brushing a creature a moment before it lands is the same impact:
      // that touch's stun must not turn this slam into a 'bury' (the bonus for
      // slamming something already knocked senseless by another blow); and the slam
      // replaces that touch's point of damage rather than adding to it
      for (const f of this.foes || []) if (!f.dead && f.hits && f.hits.has('B' + T0.id) && !f.hits.has('B' + T0.id + 'r') && Math.hypot(f.x - x, f.y - y) < slam.r + 20) {
        f.stun = 0; f.hp = Math.min(f.maxHp, f.hp + 1); f.hits.add('B' + T0.id + 'r');
      }
      this.slams.push(slam);
      this.hits.push({ kind: 'slam', shape: 'circle', x, y, r: slam.r, dmg: Math.max(1, Math.round((1 + k * 2) * repeat)), poise: 8 + Math.round(k * 8), id: slam.id, dir: Math.abs(dx) > 0.35 ? Math.sign(dx) : 0 });
      this.events.push(Object.assign({ type: 'slam' }, slam));
    }
    trackThrow() {
      const T0 = this.throwNow;
      if (!T0 || T0.done) return;
      const W = this.W, H = this.H;
      // the way the clump was heading last frame: only those sides can be struck
      const ux = T0.ux || 0, uy = T0.uy || 0;
      const ix = ux > 0.35 ? 1 : ux < -0.35 ? -1 : 0, iy = uy > 0.35 ? 1 : uy < -0.35 ? -1 : 0;
      // stone, frozen sand, or sand of yours lying still that is not part of this
      // same throw. Your own sand still in the air (what an air throw shed, the
      // rest of the last jump) is not something to strike: rising or falling
      // through it is not an impact.
      const other = (x, y) => {
        if (this.terrainSolid(x, y)) return true;
        const j = this.pid[y * W + x];
        if (j < 0 || this.thrownOf[j] === T0.id) return false;
        if (this.state[j] !== 1) return true;                                  // frozen: as hard as stone
        if (Math.abs(this.vx[j]) + Math.abs(this.vy[j]) >= 0.8) return false;
        // still, and part of a pile: an unbroken column of sand down to solid ground
        // (sand hanging at the top of its own arc is still for a moment too)
        for (let yy = y + 1; yy < y + 90; yy++) {
          if (this.terrainSolid(x, yy)) return true;
          const q = this.pid[yy * W + x];
          if (q < 0 || this.thrownOf[q] === T0.id) return false;
        }
        return false;
      };
      const foes = this.foes || [];
      let n = 0, sx = 0, sy = 0, sp = 0, svx = 0, svy = 0, ground = 0, hit = 0, hx = 0, hy = 0;
      for (let i = 0; i < this.N; i++) if (this.thrownOf[i] === T0.id && this.state[i] === 1) {
        const x = this.px[i], y = this.py[i];
        n++; sx += x; sy += y; sp += Math.abs(this.vx[i]) + Math.abs(this.vy[i]); svx += this.vx[i]; svy += this.vy[i];
        if (y + 1 >= H || other(x, y + 1)) ground++;
        // the leading grains stopped dead by what they ran into: the moment of contact
        let struck = (ix && other(x + ix, y)) || (iy && other(x, y + iy));
        if (!struck) for (const f of foes) {
          if (f.dead) continue;
          const z = f.kind === 'warden' ? [12, 16, 15] : f.kind === 'gnat' ? [4, 4, 1] : [11, 6, 5];
          if (Math.abs(x - f.x) <= z[0] && Math.abs(y - (f.y - z[2])) <= z[1]) { struck = true; break; }
        }
        if (struck) { hit++; hx += x; hy += y; }
      }
      if (!n) { T0.done = true; return; }
      if (!T0.f) { T0.x0 = sx / n; T0.y0 = sy / n; }
      T0.f++;
      const avg = sp / n, mvx = svx / n, mvy = svy / n, v = Math.hypot(mvx, mvy);
      const before = T0.v || 0;                                              // speed the frame before (contact has already slowed this one)
      T0.max = Math.max(T0.max, avg);
      T0.x = sx / n; T0.y = sy / n; T0.n = n; T0.v = v;
      T0.peakV = Math.max(T0.peakV || 0, v);
      if (v > 0.5) { T0.ux = mvx / v; T0.uy = mvy / v; }
      if (ground < n * 0.5 || Math.hypot(T0.x - T0.x0, T0.y - T0.y0) > 8) T0.air = true;   // it really flew
      const speed = Math.max(before, v);
      // a slam goes off the instant the clump strikes, not once it has stopped sliding
      // a slam needs the throw's own momentum: an impact against the way it was thrown (a high jump falling back down onto the floor) is just a landing
      const withThrow = ((T0.dx || 0) * ux + (T0.dy || 0) * uy) > 0;
      if (T0.fromAir && T0.air && withThrow && speed >= SLAM_V * this.mod.slamV && n >= SLAM_N && hit >= Math.max(3, Math.min(8, n * 0.04))) {   // a wall meets only the clump's leading face, so a big clump needs no more than 8 grains touching
        T0.done = true;
        this.slamFrom(T0, hx / hit, hy / hit, n, speed, ux, uy);
        return;
      }
      if (avg > T0.max * 0.6) T0.impactSpd = v;
      if ((T0.f > 4 && T0.max > 2.6 && avg < T0.max * 0.35) || T0.f > 120) {
        T0.done = true;
        // a throw that stopped without a clean strike (it ploughed into soft
        // sand, say): still a slam if it was fast and heavy enough
        const vi = T0.impactSpd || 0;
        if (this.debugSlam) this.events.push({ type: 'slamDbg', v: vi, n });
        // (it must be pressed against something: a throw that just ran out of speed at the top of its rise is no impact)
        if (n >= SLAM_N && withThrow && vi >= SLAM_V * this.mod.slamV && T0.fromAir && T0.air && T0.f < 60 && (hit >= 3 || (uy > 0.35 && ground >= n * 0.3))) this.slamFrom(T0, T0.x, T0.y, n, vi, ux, uy);   // never a late slam: it lands on contact or not at all
      }
    }
    // a grain that has left you settles where it lies, as still sand
    settleAsStill(i) {
      // it is no longer yours, but it is still sand: it falls and slides like
      // sand until it comes to rest, and only then lies still (someone else's time)
      const c = this.py[i] * this.W + this.px[i];
      this.pid[c] = -1; this.state[i] = 0; this.alive--; this.thrownAway = (this.thrownAway || 0) + 1;
      this.stillLeft++;
      (this.loose || (this.loose = [])).push({ x: this.px[i], y: this.py[i], vx: this.vx[i] * 0.35, vy: Math.max(0, this.vy[i] * 0.35), rest: 0, tint: this.tint[i] });
    }
    safeReformCell(x, y) {
      if (!this.inb(x, y)) return false;
      const c = y * this.W + x;
      if (this.blocks(c) || this.pid[c] >= 0 || P.noRest[this.g[c]] === 1) return false;
      for (let yy = y + 1; yy < Math.min(this.H, y + 24); yy++) {
        const below = yy * this.W + x;
        if (P.noRest[this.g[below]] === 1) return false;
        if (this.blocks(below) || this.pid[below] >= 0) return true;
      }
      return false;
    }
    // spent attack grains come back: they reappear on your pile with a faint glint
    stepReform() {
      const L = this.reform; if (!L || !L.length) return;
      const W = this.W, b = this.body;
      const home = !b.n && this.reformHome;
      const cx = b.n ? b.x : home ? home.x : (this.cx || 0), cy = b.n ? b.y : home ? home.y : (this.cy || 0), r = Math.max(6, b.n ? b.r : 8);
      let budget = 4;                                   // a few a frame: a trickle, not a pop
      for (let k = 0; k < L.length && budget > 0; k++) {
        if (L[k].at > this.frame) continue;
        const i = L[k].i;
        let n = -1, x = 0, y = 0;
        for (let t = 0; t < 40; t++) {
          const a = this.rand() * Math.PI * 2, d = r * (0.5 + this.rand() * 0.6);
          x = Math.round(cx + Math.cos(a) * d); y = Math.round(cy - Math.abs(Math.sin(a)) * d);
          if (!this.safeReformCell(x, y)) continue;
          const c = y * W + x;
          n = c; break;
        }
        if (n < 0) continue;
        this.state[i] = 1; this.pid[n] = i; this.px[i] = x; this.py[i] = y; this.vx[i] = 0; this.vy[i] = 0.3; this.fx[i] = 0; this.fy[i] = 0;
        this.alive++; this.pending--; L.splice(k--, 1); budget--;
        this.events.push({ type: 'reform', x, y });
      }
    }
    stepLoose() {
      const L = this.loose; if (!L || !L.length) return;
      const W = this.W, free = (x, y) => this.inb(x, y) && !this.blocks(y * W + x) && this.pid[y * W + x] < 0 && P.exit[this.g[y * W + x]] !== 1;
      let changed = false;
      for (let k = L.length - 1; k >= 0; k--) {
        const d = L[k];
        d.vy = Math.min(5, d.vy + GRAV); d.vx *= 0.9;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(d.vx), Math.abs(d.vy))));
        let moved = false;
        for (let st = 0; st < steps; st++) {
          const nx = Math.round(d.x + d.vx / steps), ny = Math.round(d.y + d.vy / steps);
          if ((nx !== d.x || ny !== d.y) && free(nx, ny)) { d.x = nx; d.y = ny; moved = true; continue; }
          if (free(d.x, d.y + 1)) { d.y++; moved = true; continue; }
          d.vx = 0; d.vy = 0;
          const side = this.rand() < 0.5 ? -1 : 1;                    // sand slides off a slope
          if (free(d.x + side, d.y + 1)) { d.x += side; d.y++; moved = true; }
          else if (free(d.x - side, d.y + 1)) { d.x -= side; d.y++; moved = true; }
          break;
        }
        if (moved) { d.rest = 0; continue; }
        if (++d.rest < 3) continue;
        // at rest: it lies still here (or the nearest open cell above, if something took its place)
        let y = d.y;
        while (y > 1 && !(this.g[y * W + d.x] === 0 && this.pid[y * W + d.x] < 0)) y--;
        if (this.g[y * W + d.x] === 0) { this.g[y * W + d.x] = T.STILL; changed = true; } else this.stillLeft--;
        L.splice(k, 1);
      }
      if (changed) this.terrainVersion++;
    }
    // a grain given back (a gnat swatted while carrying one)
    reviveGrain(x, y) {
      let i = -1;
      for (let k = 0; k < this.N; k++) if (this.state[k] === 0) { i = k; break; }
      if (i < 0 && this.N < this.cap) { i = this.N++; this.tint[i] = (this.rand() * 4) | 0; this.sel[i] = 0; this.state[i] = 0; }   // a new grain, if there is room for one
      if (i < 0) return false;
      for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= this.W || yy >= this.H) continue;
        const c = yy * this.W + xx;
        if (this.blocks(c) || this.pid[c] >= 0) continue;
        this.px[i] = xx; this.py[i] = yy; this.vx[i] = 0; this.vy[i] = 0; this.fx[i] = 0; this.fy[i] = 0; this.strikeT[i] = 0;
        this.state[i] = 1; this.pid[c] = i; this.alive++; this.lost = Math.max(0, this.lost - 1);
        return true;
      }
      return false;
    }
    // time slowed past its free window costs a grain now and then
    spendGrain() {
      for (let i = this.N - 1; i >= 0; i--) if (this.state[i] === 1) { this.killAt(this.py[i] * this.W + this.px[i]); return true; }
      return false;
    }
    // a lash grain at the end of its flight crumbles to nothing
    burn(i, how) {
      if (this.state[i] !== 1) return;
      if (this.superOf[i]) {
        if (this.superOf[i] === 1 && this.superNow && this.superNow.t > 250) { this.superOf[i] = 2; this.hits.push({ kind: 'star', shape: 'circle', x: this.px[i], y: this.py[i], r: 9, dmg: 3, poise: 4, id: 'S' + (this.frame >> 2), sid: i + ':' + this.frame, dir: 1 }); }   // each star bursts where it lands
        this.strikeT[i] = 0; this.vx[i] *= 0.2; this.vy[i] *= 0.2; return;
      }   // and then waits to gather back
      if (this.waveOf[i]) {
        // an attack's grain spends itself: it bursts on whatever it struck (or
        // fades out in the air), then reforms at your pile a moment later.
        // Each attack keeps a few for good (its cost); the rest come home.
        const shard = this.waveOf[i] === 2;
        this.waveOf[i] = 0; this.strikeT[i] = 0;
        const b = this.body, near = b.n && Math.hypot(this.px[i] - b.x, this.py[i] - b.y) < b.r * 1.3;
        if (near && how !== 'foe') {
          this.atkCost = Math.max(0, (this.atkCost || 0) - 1);
          this.vx[i] *= 0.3; this.vy[i] *= 0.3; return;
        }   // it never left you, so do not carry its reserved cost into a later attack
        if (shard && how !== 'air') this.hits.push({ kind: 'lash', shape: 'circle', x: this.px[i], y: this.py[i], r: 9, dmg: 1, poise: 2, id: 'I' + this.strikeOf[i], dir: Math.sign(this.vx[i]) || 1 });
        this.events.push({ type: 'grainPop', x: this.px[i], y: this.py[i], how: how || 'air', shard, a: Math.atan2(this.vy[i], this.vx[i]) });
        this.pid[this.py[i] * this.W + this.px[i]] = -1; this.alive--;
        if (this.atkCost > 0) { this.atkCost--; if (this.payAttackGrain()) { this.state[i] = 0; this.lost = (this.lost || 0) + 1; } else { this.state[i] = 5; this.pending++; (this.reform || (this.reform = [])).push({ i, at: this.frame + 26 + Math.floor(this.rand() * 34) }); } }
        else { this.state[i] = 5; this.pending++; (this.reform || (this.reform = [])).push({ i, at: this.frame + 26 + Math.floor(this.rand() * 34) }); }
        return;
      }
      this.strikeT[i] = 0;
      this.pid[this.py[i] * this.W + this.px[i]] = -1;
      this.state[i] = 7; this.alive--; this.spent = (this.spent || 0) + 1;
      if ((i & 3) === 0) this.events.push({ type: 'dust', x: this.px[i], y: this.py[i] });
    }
    // is most of the thrown clump still off the ground?
    clumpAirborne(T0) {
      let n = 0, air = 0;
      for (let i = 0; i < this.N; i++) if (this.thrownOf[i] === T0.id && this.state[i] === 1) { n++; if (!this.solid(this.px[i], this.py[i] + 1)) air++; }
      return n > 0 && air > n * 0.6;
    }
    // the dive: the thrown clump stops drifting and drops like a stone
    dive(T0) {
      T0.dive = true;
      for (let i = 0; i < this.N; i++) if (this.thrownOf[i] === T0.id && this.state[i] === 1) {
        this.vx[i] *= 0.25; this.vy[i] = Math.max(this.vy[i], 0) + 6.5;
      }
      T0.max = Math.max(T0.max, 6.5);
      this.events.push({ type: 'dive', x: T0.x, y: T0.y });
    }
    frozenAt(x, y) {
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
      const j = this.pid[y * this.W + x];
      return j >= 0 && this.state[j] === 2;
    }
    // is there frozen sand strictly between two points? (ice stops an attack: what lies behind it is shielded)
    iceBetween(x0, y0, x1, y1) {
      const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
      for (let k = 1; k < n; k++) {
        const x = Math.round(x0 + dx * k / n), y = Math.round(y0 + dy * k / n);
        if ((x === Math.round(x1) && y === Math.round(y1)) || (x === Math.round(x0) && y === Math.round(y0))) continue;
        if (this.frozenAt(x, y)) return true;
      }
      return false;
    }
    // Lash into your own frozen sand and it bursts: every frozen grain nearby
    // flies outward as a shard that can hit, like a mine you set yourself.
    shatter(x, y) {
      const id = ++this.strikeN & 0xffff || 1;
      let n = 0;
      for (let i = 0; i < this.N; i++) {
        if (this.state[i] !== 2) continue;
        const dx = this.px[i] - x, dy = this.py[i] - y, d = Math.hypot(dx, dy);
        if (d > 18) continue;
        const a = d > 0.5 ? Math.atan2(dy, dx) : this.rand() * Math.PI * 2, sp = 5.5 + this.rand() * 1.5;
        this.state[i] = 1; this.vx[i] = Math.cos(a) * sp; this.vy[i] = Math.sin(a) * sp - 0.8;
        this.fx[i] = 0; this.fy[i] = 0; this.strikeT[i] = 14; this.strikeOf[i] = id; n++;
      }
      if (this.frozen) this.frozen = Math.max(0, this.frozen - n);
      if (this.freezeSeed) {
        this.freezeBarrier = Math.max(0, (this.freezeBarrier || 0) - n);
        if (this.freezeBarrier === 0) {
          for (let i = 0; i < this.N; i++) if (this.state[i] === 2) this.state[i] = 1;
          this.freezeSeed = null;
          this.frozen = 0;
          this.freezeT = 0;
        }
      }
      if (n) this.events.push({ type: 'shatter', x, y, n });
    }
    // Hits chain into a combo if they land close together in time. From the
    // third hit on, whatever was struck sheds a little still sand: skill pays.
    comboHit(x, y, kind) {
      this.combo.n = this.combo.t > 0 ? this.combo.n + 1 : 1;
      this.combo.t = 110;
      // several grains striking in one frame are one impact; a parry counts in the combo
      // but builds no hit stop of its own (the game already holds on a parry)
      if (kind !== 'parry' && kind !== 'star' && this.stopFrame !== this.frame) { this.stopFrame = this.frame; this.stopRun = (this.stopRun || 0) + 1; }
      const n = this.combo.n;
      this.events.push({ type: 'combo', n, x, y, kind });
      if (false) {                                          // combos no longer drop sand: skill earns position, not grains
        let gy = Math.round(y);
        while (gy < this.H - 1 && !this.terrainSolid(Math.round(x), gy + 1)) gy++;
        let before = 0; for (let i = 0; i < this.g.length; i += 1) if (this.g[i] === T.STILL) before++;
        F.stillPile(this, Math.round(x), gy + 1, 2 + Math.min(6, n), 1 + Math.min(4, n >> 1));
        let after = 0; for (let i = 0; i < this.g.length; i += 1) if (this.g[i] === T.STILL) after++;
        this.stillLeft += after - before; this.hadStill = true; this.terrainVersion++;
      }
      return n;
    }
    // A striking grain shoulders past a resting one (they trade places).
    swapThrough(i, dx, dy) {
      const W = this.W, x = this.px[i] + dx, y = this.py[i] + dy;
      if (this.terrainSolid(x, y)) return false;
      const c = y * W + x, j = this.pid[c];
      if (j < 0) return false;
      const o = this.py[i] * W + this.px[i];
      this.px[j] = this.px[i]; this.py[j] = this.py[i]; this.pid[o] = j;
      this.px[i] = x; this.py[i] = y; this.pid[c] = i;
      return true;
    }
    // A grain struck where it stands (a boss's teeth rising under it).
    killAt(c) {
      const i = this.pid[c];
      if (i < 0 || (this.state[i] !== 1 && this.state[i] !== 2)) return;
      if (this.state[i] === 2) {
        this.freezeBarrier = Math.max(0, (this.freezeBarrier || 0) - 1);
        if (this.freezeBarrier === 0) this.breakFreezeBarrier();
      }
      this.pid[c] = -1;
      this.events.push({ type: 'kill', x: c % this.W, y: (c / this.W) | 0 });
      if (this.mod.undertow) { this.state[i] = 5; this.alive--; this.pending++; this.respawn.push({ i, at: this.frame + 90 }); }
      else { this.state[i] = 0; this.lost++; this.alive--; }
    }
    // Undertow: grains taken by spikes fall back in through the crack above.
    returnGrains() {
      const sp = this.spawnRect, W = this.W;
      while (this.respawn.length && this.respawn[0].at <= this.frame) {
        const { i } = this.respawn[0];
        let placed = false;
        for (let tries = 0; tries < 40 && !placed; tries++) {
          const x = sp.x + Math.floor(this.rand() * sp.w), y = sp.y + Math.floor(this.rand() * 6);
          const c = y * W + x;
          if (this.blocks(c) || this.pid[c] >= 0) continue;
          this.px[i] = x; this.py[i] = y; this.vx[i] = 0; this.vy[i] = 0.5; this.fx[i] = 0; this.fy[i] = 0;
          this.state[i] = 1; this.pid[c] = i; this.alive++; this.pending--; placed = true;
        }
        if (!placed) break;
        this.respawn.shift();
      }
    }

    step(inp) {
      // hit stop: the sim holds still; buttons pressed meanwhile are kept so a quick tap is not lost
      if (this.hitStop > 0) {
        this.hitStop--;
        const L = this.stopLatch || (this.stopLatch = {});
        for (const k of ['pour', 'repel', 'charge', 'harden', 'blade', 'strike']) if (inp[k]) L[k] = true;
        return;
      }
      if (this.stopLatch) {
        inp = Object.assign({}, inp);
        for (const k in this.stopLatch) inp[k] = true;
        this.stopLatch = null;
      }
      const { px, py, vx, vy, fx, fy, state, N, sel } = this;
      this.frame++; this.stats.frames++;
      this.climbing.fill(0);
      this.collisionEnergy = 0;
      this.slams.length = 0;
      // the world's own clock (creatures, hazards, machines); slowed nearly to a stop while you hold an attack
      // Holding F (the hammer) or Q (shards) FULLY stops the world: creatures, hazards, mechanisms, the boss's eyes, teeth, lids and
      // stones all wait while your own sand moves at full speed, so the aim is free of the clock. It is bounded: the hammer crumbles
      // after 150 held frames and a held volley stops freezing after HOLD_FREEZE_MAX, and both then cost sand and a long cooldown.
      const holding = !!(this.hammer || (this.icicles && !this.icicles.fire && this.icicles.groups.length));
      this.holdT = holding ? (this.holdT || 0) + 1 : 0;
      this.worldHeld = this.mod.holdFreeze !== false && holding && this.holdT <= HOLD_FREEZE_MAX;
      this.sandHeld = !!(this.worldHeld && this.mod.holdFreezeSand);       // (see the grain loop)
      this.sandSlow = !!(this.worldHeld && this.mod.holdSandSlow && !this.sandHeld);
      if (!this.worldHeld) this.clock = (this.clock || 0) + 1;     // the fight's own clock: link windows and the combo timer do not run while the world is held
      if (this.worldHeld) { this.worldTick = false; }
      else {
        this.worldAcc = (this.worldAcc || 0) + (this.worldRate == null ? 1 : this.worldRate);
        this.worldTick = this.worldAcc >= 1; if (this.worldTick) this.worldAcc -= 1;
      }
      this.pickTarget(inp);
      if (this.combo.t > 0 && !this.worldHeld && --this.combo.t === 0) { this.combo.n = 0; this.combo.fam = 0; this.stopRun = 0; }
      if (this.level.update && this.worldTick && !this.boss) this.level.update(this);
      if (this.Mechs && this.worldTick) this.Mechs.step(this);
      if (this.respawn.length) this.returnGrains();

      if (this.freezeCool > 0 && !this.freezeSeed) this.freezeCool--;
      if (inp.harden && !this.prevHarden) { this.tryParry(); this.startFreeze(); }
      else if (inp.harden) this.holdFreeze();
      else if (this.prevHarden) this.endFreeze();
      this.prevHarden = !!inp.harden;
      if (this.freezeSeed) {
        inp = Object.assign({}, inp, { pour: false, charge: false, blade: this.hammer ? inp.blade : false, strike: false });     // a held hammer keeps its F (else the freeze would read as a release and smash)
        for (let i = 0; i < N; i++) if (this.state[i] === 1) { this.vx[i] = 0; this.vy[i] = 0; this.fx[i] = 0; this.fy[i] = 0; }
      }
      if (this.enoughAt < 0 && this.exited >= this.par[0]) this.enoughAt = this.frame;

      if (inp.pour || inp.charge || inp.harden) this.lastInput = this.frame;
      const charging = !!inp.charge;
      if (charging && !this.prevCharge) {
        this.anchorX = inp.x; this.anchorY = inp.y; this.chargeT = 0;
        let m = 0;
        for (let i = 0; i < N; i++) {
          sel[i] = state[i] === 1 && Math.hypot(px[i] - inp.x, py[i] - inp.y) < SEL_R && this.sight(inp.x, inp.y, px[i], py[i]) ? 1 : 0;
          m += sel[i];
        }
        this.selCount = m;
        this.cohesionT = 0;
        // was the sand standing when you pressed? (gathering lifts it, so judge now)
        // Judge by the bottom of each column of the clump: is it resting on terrain, or on sand
        // that is not part of this clump? (Grains stacked on each other inside a clump in the
        // air are not ground, or a ball in mid-air would count as standing and hang forever.)
        const low = new Map(), colN = new Map();
        let wall = 0;
        for (let i = 0; i < N; i++) if (sel[i]) {
          colN.set(px[i], (colN.get(px[i]) || 0) + 1);
          if (!(low.get(px[i]) >= py[i])) low.set(px[i], py[i]);
          if (this.climbSide(px[i], py[i], -1) || this.climbSide(px[i], py[i], 1)) wall++;
        }
        let gr = 0, grN = 0;
        for (const [x, y] of low) {
          const j = this.pid[(y + 1) * this.W + x];
          // a loose grain under the clump is ground only if it is resting there; a stray that is
          // falling or drifting along with the clump (shed grains, leftovers) is not
          const restingBelow = j >= 0 && !sel[j] && Math.abs(vx[j]) + Math.abs(vy[j]) < 0.8;
          if (this.terrainSolid(x, y + 1) || restingBelow || y + 1 >= this.H) { gr++; grN += colN.get(x) || 0; }
        }
        // by GRAINS, not columns: a clump you are holding in the air is not "standing" because a few leftover grains of it
        // (shed by the last jump) lie on the floor within reach of the press. That was a missed slam after a jump.
        this.pressGrounded = m > 0 && (grN >= m * 0.5 || wall >= m * 0.3);
      }

      let n = 0, sx = 0, sy = 0, svx = 0, svy = 0, bn = 0, bsx = 0, bsy = 0;
      for (let i = 0; i < N; i++) if (state[i] === 1) {
        n++; sx += px[i]; sy += py[i]; svx += vx[i]; svy += vy[i];
        if (sel[i]) { bn++; bsx += px[i]; bsy += py[i]; }
      }
      this.free = n;
      this.cx = n ? sx / n : inp.x; this.cy = n ? sy / n : inp.y;
      const bx = bn ? bsx / bn : this.cx, by = bn ? bsy / bn : this.cy;
      this.bx = bx; this.by = by; this.ballCount = bn;
      const R = Math.sqrt(bn / Math.PI) * 0.8 + 2;

      if (charging) {
        this.chargeT = (this.chargeT || 0) + 1;
        // inp.stick = the pull vector from a virtual stick (the pointer's movement since the press); without it, the anchor minus the cursor
        const dx = inp.stick ? inp.stick.x : this.anchorX - inp.x, dy = inp.stick ? inp.stick.y : this.anchorY - inp.y, d = Math.hypot(dx, dy);
        this.aimPower = Math.min(1, d / (this.aimLen || AIM_LEN));
        if (d > 0.001) { this.aimDx = dx / d; this.aimDy = dy / d; }
      }
      let launch = false, lp = 0, ldx = 0, ldy = 0;
      if (!charging && this.prevCharge) {
        // standing sand can always throw; sand in the air gets one throw,
        // then it has to land before it can throw again
        const bodyGrounded = this.body.n > 0 && this.terrainSolid(Math.round(this.body.x), Math.round(this.body.y + this.body.r + 2));
        const onGround = !!this.pressGrounded;   // judged when you PRESSED: sand held in the air that lands while you aim is still an air throw (it used to turn into a floor throw and lose the slam)
        const maxAir = 3 + this.mod.airThrows;
        if (onGround && !(this.throwCool > 0)) this.airThrows = maxAir;   // up to three throws before you must land (a lens can add one)
        if (this.airThrows == null) this.airThrows = maxAir;
        // A throw from standing sand needs its short breath to have passed. A press inside that
        // breath (sand still leaving the floor, or just landed) is a chained jump, never a
        // refusal: it spends one of the air throws like any second jump. Airborne throws can
        // chain so a second jump is responsive, but need a real pull (a light flick under
        // AIR_MIN_PULL is ignored silently and keeps the jump).
        const cooled = !(this.throwCool > 0);
        const groundThrow = onGround && cooled;
        const canThrow = groundThrow || (this.airThrows > 0 && this.aimPower >= AIR_MIN_PULL);
        if (this.aimPower >= AIR_MIN_PULL && bn > 0 && !canThrow) this.events.push({ type: 'noThrow', x: bx, y: by });
        let airJump = 0;
        let horizontalAir = false;
        if (this.aimPower > 0.12 && bn > 0 && canThrow) {
          if (!groundThrow) {
            this.airThrows--;
            airJump = maxAir - this.airThrows;
            // every throw from the air holds less of you together: the rest falls away (still yours)
            horizontalAir = Math.abs(this.aimDx) > 0.45 && Math.abs(this.aimDy) < 0.6;
            const keepLevels = horizontalAir ? [0.92, 0.85, 0.75, 0.55] : [0.88, 0.8, 0.72, 0.5];   // (vertical keeps more of you on the 3rd+ throws: playtest, the third jump had no height left)
            const keep = keepLevels[Math.max(0, Math.min(3, maxAir - 1 - this.airThrows))];
            let shed = 0, sxs = 0, sys = 0;
            for (let i = 0; i < N; i++) if (sel[i] && this.rand() > keep) { sel[i] = 0; shed++; sxs += px[i]; sys += py[i]; }
            if (shed) this.events.push({ type: 'shed', x: sxs / shed, y: sys / shed, n: shed });
          }
          this.throwCool = groundThrow ? Math.round(35 * this.mod.throwCool) : onGround ? this.throwCool : 0;   // a chained throw from standing sand keeps the breath running (no spamming the floor)
          const laterHorizontalScale = airJump === 3 ? 0.82 : Math.max(0.12, 0.58 * Math.pow(0.78, airJump - 4));
          const chainScale = horizontalAir
            ? (airJump === 1 ? 0.65 : airJump === 2 ? 0.9 : laterHorizontalScale)
            : (airJump === 1 ? 0.9 : airJump === 2 ? 0.9 : airJump >= 3 ? 0.8 : 1);
          launch = true; lp = (LAUNCH_MIN + LAUNCH_RANGE * this.aimPower) * this.mod.sling * chainScale; ldx = this.aimDx; ldy = this.aimDy;
          const tid = this.throwN = (this.throwN % 30000) + 1;
          for (let i = 0; i < N; i++) if (sel[i]) this.thrownOf[i] = tid;
          this.throwNow = { id: tid, f: 0, max: 0, done: false, power: this.aimPower, air: !onGround, fromAir: !onGround, dy: ldy, dx: ldx };
          this.cohesionT = 14;
          this.events.push({ type: 'launch', x: bx, y: by, power: this.aimPower });
        } else sel.fill(0);
        this.aimPower = 0;
      }
      this.prevCharge = charging;
      this.charging = charging;
      if (this.cohesionT > 0 && --this.cohesionT === 0) sel.fill(0);

      const pouring = !!inp.pour;
      const repelling = pouring && !!inp.repel;
      this.pouring = pouring;
      // Strike: the grains nearest the cursor lash out at it in a straight,
      // fast line. Costs nothing, but there is a breath between strikes.
      if (this.strikeCool > 0) this.strikeCool--;
      // F and Q reload one spent charge at a time, even when some charges remain.
      const T0 = this.taps || (this.taps = {
        f: { ammo: this.tapLimit('f'), reload: 0, reloading: false, last: -999 },
        q: { ammo: this.tapLimit('q'), reload: 0, reloading: false, last: -999 },
      });
      for (const k of ['f', 'q']) {
        const c = T0[k];
        if (c.reloading && c.reload > 0 && --c.reload === 0) {
          c.ammo++;
          if (c.ammo < this.tapLimit(k)) c.reload = this.tapReloadMax(k);
          else c.reloading = false;
        }
      }
      if (this.throwCool > 0) this.throwCool--;
      // Q: the lash (ranged, costs sand)
      // Q: a tap sends the long wave; holding forms sand icicles around you,
      // one by one, and letting go fires them in a quick volley at the cursor
      if (this.qBuf > 0) {                                    // a tap kept from the breath
        this.qBuf--;
        if (this.strikeCool === 0 && !this.icicles && this.tapReady('q') && this.afford('q')) { this.qBuf = 0; this.wave(inp, true); this.strikeCool = 40; this.tapSpend('q'); this.use('q', 2); }
      }
      const qPress = inp.strike && !this.prevStrike, qRelease = !inp.strike && this.prevStrike;
      this.prevStrike = !!inp.strike;
      if (qPress) this.qDown = this.frame;
      if (this.iceCool > 0) this.iceCool--;
      if (inp.strike && this.qDown >= 0 && this.frame - this.qDown >= 10 && this.strikeCool === 0 && !(this.iceCool > 0) && this.tapReady('q')) this.growIcicles();
      if (qRelease) {
        if (this.icicles && this.icicles.groups.length) this.fireIcicles(inp);
        else if (this.qDown >= 0 && this.frame - this.qDown < 12 && this.strikeCool === 0 && this.tapReady('q') && this.afford('q')) { this.wave(inp, true); this.strikeCool = 40; this.tapSpend('q'); this.qBuf = 0; this.use('q', 2); }
        else if (qRelease && this.qDown >= 0 && this.frame - this.qDown < 12 && this.strikeCool > 0 && this.strikeCool <= TAP_BUFFER && this.tapReady('q') && this.afford('q') && !(this.icicles && this.icicles.groups.length)) this.qBuf = TAP_BUFFER;
        else if (qRelease && !this.afford('q') && !(this.icicles && this.icicles.groups.length)) this.events.push({ type: 'noAfford', key: 'q' });
        this.qDown = -1;
      }
      this.stepIcicles(inp);
      this.stepSuper();
      this.stepLoose();
      this.stepReform();
      // F: the blade (tap, chain up to three) and the hammer (hold, release);
      // F while a throw is in the air dives it into a Slam instead
      this.hits.length = 0;
      this.aimX = inp.x; this.aimY = inp.y;
      this.updateBody();
      this.melee(inp);
      this.stepBolts();
      this.flushSuperHits();

      let odx = 0, ody = 1;
      if (launch) { odx = ldx; ody = ldy; }
      else if (n) {
        const mvx = svx / n, mvy = svy / n, m = Math.hypot(mvx, mvy);
        if (m > 0.4) { odx = mvx / m; ody = mvy / m; }
      }
      const count = this.sortOrder(odx, ody);

      let moving = 0, speed = 0;
      for (let k = 0; k < count; k++) {
        const i = this.order[k];
        if (state[i] !== 1) continue;
        const x = px[i], y = py[i];
        const below = this.solid(x, y + 1);
        const tl = this.climbSide(x, y, -1), tr = this.climbSide(x, y, 1);
        const touching = tl || tr;
        const gathering = charging && sel[i] === 1;
        const hamG = this.hammer && this.hsel[i];
        // HELD F/Q with mods.holdFreezeSand (OFF by default: the user wants your sand to keep falling while you aim): your free sand hangs where it is (zero velocity) while the world is held: a true pause like the Super.
        // Grains that are part of the held attack (the hammer's head, the shards, anything flying) still move. Released at once on letting go.
        if (this.sandHeld && !this.hsel[i] && !this.hfall[i] && !this.iceOf[i] && !(this.strikeT[i] > 0)) { vx[i] = 0; vy[i] = 0; this.fx[i] = 0; this.fy[i] = 0; continue; }
        // HELD F/Q: your own free sand falls in SLOW MOTION (mods.holdSandSlow, on by default): it keeps falling, just slowly, so you can aim in the air
        const slowFall = this.sandSlow && !this.hsel[i] && !this.hfall[i] && !this.iceOf[i] && !(this.strikeT[i] > 0);
        if (slowFall) { vx[i] *= HOLD_SAND_DRAG; vy[i] *= HOLD_SAND_DRAG; }
        let ax = 0, ay = GRAV * this.mod.grav * (slowFall ? HOLD_SAND_GRAV : 1);
        if (this.strikeT[i] > 0) {
          // a striking grain flies straight: no gravity, no pull, no drag
          if (this.waveOf[i] && !this.superOf[i]) { vx[i] *= 0.93; vy[i] *= 0.93; }      // a burst out, then losing its force
          if (this.superOf[i]) vy[i] = Math.min(9, vy[i] + 0.35);                          // falling stars gather speed
          fx[i] += vx[i]; fy[i] += vy[i];
          this.moveFrac(i);
          if (this.state[i] === 1 && (this.strikeT[i] === 0 || --this.strikeT[i] === 0)) this.burn(i, 'air');
          moving++; speed += Math.abs(vx[i]) + Math.abs(vy[i]);
          continue;
        }

        if (launch && sel[i]) {
          // Each grain gets its own speed and a little outward spread, so the
          // clump stretches into a natural plume instead of flying as a block.
          const k = 0.88 + this.rand() * 0.24;
          vx[i] = ldx * lp * k + (x - bx) * 0.025 + (this.rand() - 0.5) * 0.5;
          vy[i] = ldy * lp * k + (y - by) * 0.025 + (this.rand() - 0.5) * 0.5;
          fx[i] = this.rand() - 0.5; fy[i] = this.rand() - 0.5;
        }
        // Velocity of whatever this grain rests on (terrain = 0), for friction.
        const bj = y + 1 < this.H ? this.pid[(y + 1) * this.W + x] : -1;
        const supVx = bj >= 0 ? vx[bj] : 0;

        let pourW = 0;
        if (pouring && !gathering) {
          const d = Math.hypot(inp.x - x, inp.y - y);
          const r0 = POUR_R0 * this.mod.reach, r1 = POUR_R1 * this.mod.reach;
          pourW = d < r0 ? 1 : d < r1 ? (r1 - d) / (r1 - r0) : 0;
        }

        if (this.iceOf[i] && this.icicles && !this.icicles.fire) {
          // held in a shard: drawn tight to its place above you, quivering a little
          const sl = this.icicleSlot(this.iceOf[i] - 1), dx = sl.x - x, dy = sl.y - y, d = Math.hypot(dx, dy) || 1;
          ay = 0; if (d > 1) { const f = Math.min(1.2, 0.1 * d + 0.1); ax += dx / d * f; ay += dy / d * f; }
          vx[i] *= 0.75; vy[i] *= 0.75;
        } else if (this.iceOf[i] && !this.icicles) this.iceOf[i] = 0;
        if (this.returnT[i] > 0 && !hamG && !gathering) {
          // a wave's grains drawing back to the body after the blow
          this.returnT[i]--;
          const dx = this.body.x - x, dy = this.body.y - y, d = Math.hypot(dx, dy) || 1;
          if (d < this.body.r + 3) this.returnT[i] = 0;
          else { ay = GRAV * 0.2; const f = Math.min(0.7, 0.04 * d + 0.12); ax += dx / d * f; ay += dy / d * f; vx[i] *= 0.9; vy[i] *= 0.9; }
        }
        if (hamG) {
          // lifting out of the body into the hammer's head
          const H0 = this.hammer, dx = H0.px - x, dy = H0.py - y, d = Math.hypot(dx, dy) || 1;
          ay = 0;
          if (d > 2) { const f = Math.min(1.1, 0.07 * d + 0.12); ax += dx / d * f; ay += dy / d * f; }
          vx[i] *= 0.8; vy[i] *= 0.8;
        } else if (gathering) {
          // The sand half-lifts itself while it gathers into a ball. In the
          // air that is a brief slow-down (time to aim a combo), then it
          // falls while you aim; it never hangs there.
          const hang = this.pressGrounded ? 1 : Math.max(0, 1 - this.chargeT / AIR_HANG);   // in the air: a short hang, then it drops however long you hold
          ay = GRAV * (0.15 + 0.85 * (1 - hang));
          const dx = bx - x, dy = by - y, d = Math.hypot(dx, dy) || 1;
          if (d > R) {
            const f = Math.min(0.9, 0.07 * (d - R) + 0.1);
            ax += dx / d * f; ay += dy / d * f;
          }
          if (hang > 0) { vx[i] *= 0.88; vy[i] *= 0.88; }
        } else if (pourW > 0) {
          const dx = inp.x - x, dy = inp.y - y, d = Math.hypot(dx, dy) || 1;
          const ux = (repelling ? -dx : dx) / d, uy = (repelling ? -dy : dy) / d;
          const air = !below && !touching;
          // Pull eases off as sand arrives under the cursor, so it settles
          // into a natural cone instead of being heaped into a mound.
          const near = Math.min(1, Math.abs(dx) / 14);
          if (d > 2) ax += ux * (air ? 0.1 : 0.5) * pourW * near * (0.8 + 0.1 * this.tint[i] + this.rand() * 0.2);
          // Climb when the cursor is above, or past the wall on its far side.
          const over = (tr && ux > 0.2 && dy < 12) || (tl && ux < -0.2 && dy < 12);
          const pilePush = below || vy[i] < -0.5;
          const nearWall = this.climbable(x - 1, y) || this.climbable(x + 1, y)
            || this.climbable(x - 2, y) || this.climbable(x + 2, y)
            || this.climbable(x - 3, y) || this.climbable(x + 3, y);
          const pileFace = this.solid(x - 1, y + 1) || this.solid(x + 1, y + 1);
          if (!repelling && (touching || (nearWall && pilePush && pileFace)) && pilePush && (uy < -0.25 || over)) {
            this.climbing[i] = 1;
            // The pile feeds the wall gradually: supported grains ease into
            // the climb, while unsupported grains take the full wall speed.
            const feed = below ? 0.62 : 1;
            vy[i] = -CLIMB_SPEED * this.mod.climb * feed;
            ay = 0;
            if (!touching) {
              const wallDir = this.climbable(x - 2, y) || this.climbable(x - 3, y) ? -1
                : this.climbable(x + 2, y) || this.climbable(x + 3, y) ? 1 : 0;
              if (wallDir && this.step1(i, wallDir, 0)) {
                vx[i] = 0;
              } else {
                ax += wallDir * 0.35;
              }
            }
            vx[i] *= 0.9; // retain lateral spread while the stream follows the wall
          } else if (!below && pourW > 0.15) {
            // Mantle: hanging beside the top corner of a wall, step onto it.
            if (ux > -0.3 && this.climbable(x + 1, y + 1) && !this.solid(x + 1, y)) { this.step1(i, 1, 0); vy[i] = 0; continue; }
            if (ux < 0.3 && this.climbable(x - 1, y + 1) && !this.solid(x - 1, y)) { this.step1(i, -1, 0); vy[i] = 0; continue; }
          }
          if (below && vy[i] >= -0.5) vx[i] = supVx + (vx[i] - supVx) * 0.97;
        } else if (below && vy[i] >= -0.5) {
          // Friction is relative to the support, so a flying clump keeps its
          // momentum, and nothing drags on sand that is leaving the ground.
          vx[i] = supVx + (vx[i] - supVx) * 0.6;
        }
        if (this.cohesionT > 0 && sel[i] && !gathering) {
          // Freshly launched sand holds together for a moment.
          const dx = bx - x, dy = by - y, d = Math.hypot(dx, dy) || 1;
          if (d > R * 1.4) { const f = Math.min(0.2, 0.015 * (d - R * 1.4)); ax += dx / d * f; ay += dy / d * f; }
        }

        vx[i] += ax; vy[i] += ay;
        if (!below) { const dr = 1 - 0.003 * (this.tint[i] + 1); vx[i] *= dr; vy[i] *= dr; } // fine grains drift
        if (vx[i] > MAX_V) vx[i] = MAX_V; else if (vx[i] < -MAX_V) vx[i] = -MAX_V;
        if (vy[i] > MAX_V) vy[i] = MAX_V; else if (vy[i] < -MAX_V) vy[i] = -MAX_V;
        if (pourW > 0 && !launch) {
          if (vx[i] > 3) vx[i] = 3; else if (vx[i] < -3) vx[i] = -3;
        }
        const sp = Math.abs(vx[i]) + Math.abs(vy[i]);
        if (sp > 0.8) moving++;
        speed += sp;

        // horizontal
        fx[i] += vx[i];
        while (fx[i] >= 1 && state[i] === 1) {
          if (this.step1(i, 1, 0)) fx[i] -= 1;
          else if ((gathering || (pourW > 0 && (repelling ? px[i] - inp.x : inp.x - px[i]) > 14)) && this.step1(i, 1, -1)) fx[i] -= 1;
          else if (gathering && this.step1(i, 1, 1)) fx[i] -= 1;
          else { this.bump(i, 1, 0); fx[i] = 0; }
        }
        while (fx[i] <= -1 && state[i] === 1) {
          if (this.step1(i, -1, 0)) fx[i] += 1;
          else if ((gathering || (pourW > 0 && (repelling ? inp.x - px[i] : px[i] - inp.x) > 14)) && this.step1(i, -1, -1)) fx[i] += 1;
          else if (gathering && this.step1(i, -1, 1)) fx[i] += 1;
          else { this.bump(i, -1, 0); fx[i] = 0; }
        }
        // vertical
        fy[i] += vy[i];
        while (fy[i] >= 1 && state[i] === 1) {
          if (this.step1(i, 0, 1)) { fy[i] -= 1; continue; }
          // a few coarse grains grip where they land instead of sliding, so a
          // pile's flank is rough and stepped like real sand, never a ruled 45°
          const grips = (i % 13 === 0 || (i % 7 === 0 && this.tint[i] === 3)) && vy[i] < 1.6 && Math.abs(vx[i]) < 0.6;
          if (!gathering && !grips) {
            const d = this.rand() < 0.5 ? -1 : 1;
            if (this.step1(i, d, 1) || this.step1(i, -d, 1)) { fy[i] -= 1; continue; }
          }
          if (this.terrainSolid(px[i], py[i] + 1)) {
            if (vy[i] > 0.4 || Math.abs(vx[i]) > 0.4) this.collisionEnergy += Math.min(1, Math.max(0, vy[i]) * 0.25 + Math.abs(vx[i]) * 0.08);
            if (vy[i] > 4) this.events.push({ type: 'impact', x: px[i], y: py[i], v: vy[i] });
            if (vy[i] > 2.5) vx[i] *= 0.45; // sand lands with a thud, not a skid
            vy[i] = vy[i] > 2.5 ? -vy[i] * 0.15 : 0;
          } else this.bump(i, 0, 1);
          fy[i] = 0;
        }
        while (fy[i] <= -1 && state[i] === 1) {
          if (this.step1(i, 0, -1)) fy[i] += 1;
          else {
            const leftWall = this.climbSide(px[i], py[i], -1);
            const rightWall = this.climbSide(px[i], py[i], 1);
            const side = leftWall && !rightWall ? 1 : rightWall && !leftWall ? -1 : (this.rand() < 0.5 ? -1 : 1);
            if (this.climbing[i] && (this.step1(i, side, -1) || this.step1(i, -side, -1))) fy[i] += 1;
            else { if (this.terrainSolid(px[i], py[i] - 1)) vy[i] = 0; else this.bump(i, 0, -1); fy[i] = 0; }
          }
        }
      }
      this.moving = moving;
      this.speed = n ? speed / n : 0;
      if (this.stillLeft > 0) this.absorb();
      this.trackThrow();
      this.trackHammer();
      this.runeDamage();
      if (this.Mechs && this.Mechs.react) this.Mechs.react(this);   // mechanisms see this frame's blows and slams (mechs.js)
      // Boss damage must be resolved after trackThrow creates this frame's slam.
      if (this.boss && this.level.update && this.worldTick) this.level.update(this);
      if (this.foes.length && this.Foes) {
        const e0 = this.events.length, hp0 = this.foes.map((f) => f.dead ? 0 : f.hp);
        if (this.worldTick) this.Foes.step(this); else this.Foes.hitsOnly && this.Foes.hitsOnly(this);
        // a parry is a hit of the combo too; and a clean parry lets you parry again at once
        for (let k = e0; k < this.events.length; k++) if (this.events[k].type === 'parry') {
          const e = this.events[k]; this.parryLock = 0;
          // one combo step per half second of parrying, so a run of shockwaves turned aside does not flood the counter
          if (this.frame - (this.parryComboAt == null ? -1e9 : this.parryComboAt) >= 30) { this.parryComboAt = this.frame; this.comboHit(e.x, e.y, 'parry'); }
          break;
        }
        // hit stop: grows with the combo, and with how hard this blow landed; a kill holds a little longer
        if (this.stopFrame === this.frame) {
          let dmg = 0; this.foes.forEach((f, j) => { if (hp0[j] > 0) dmg = Math.max(dmg, hp0[j] - f.hp); });
          let stop = Math.min(STOP_CAP, ((this.stopRun || 1) - 1) * STOP_STEP) + Math.min(STOP_DMG, Math.max(0, Math.round((dmg - 2) * 0.8)));
          for (let k = e0; k < this.events.length; k++) if (this.events[k].type === 'foeDie') { stop += STOP_KILL; this.stopRun = 0; break; }   // and the run-up starts over
          this.hitStop = Math.max(this.hitStop || 0, stop);
        }
      }
      this.stepEventSlow();
      { const S = this.space;                                  // skill refunds the cooldown: a parry that works, or a link between attacks
        for (let k = Math.min(this.spaceScan || 0, this.events.length); k < this.events.length; k++) { const e = this.events[k]; if (S && S.cool > 0 && (e.type === 'parry' || e.type === 'link')) S.cool = Math.max(0, S.cool - SPACE_REFUND); }
        this.spaceScan = this.events.length; }
      // Hourglass Debt: a grain slips away every three seconds
      if ((this.mod.debt && this.frame % 180 === 0) || (this.mod.brittle && this.frame % 300 === 150)) {   // debt, or a brittle lens: a grain slips away
        for (let k = this.N - 1; k >= 0; k--) if (this.state[k] === 1) {
          this.pid[this.py[k] * this.W + this.px[k]] = -1; this.state[k] = 0; this.lost++; this.alive--; break;
        }
      }
      if (this.memory && !this.memory.found && this.frame % 4 === 0) {
        const m = this.memory;
        for (let i = 0; i < this.N; i++) {
          if (this.state[i] !== 1) continue;
          if (Math.abs(this.px[i] - m.x) <= 3 && Math.abs(this.py[i] - m.y) <= 4) { m.found = true; this.events.push({ type: 'memory', x: m.x, y: m.y }); break; }
        }
      }
    }

    // Still sand touching your sand wakes up and becomes yours. Newly woken
    // grains wake their neighbours next frame, so it spreads like a ripple.
    absorb() {
      const { W, g } = this;
      const end = this.N;
      let woke = 0;
      for (let i = 0; i < end; i++) {
        if (this.state[i] !== 1 || this.strikeT[i]) continue;               // sand flying in an attack wakes nothing
        const x = this.px[i], y = this.py[i];
        for (const [dx, dy] of this.mod.absorb > 1 ? REACH4 : REACH1) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= this.H) continue;
          const c = yy * W + xx;
          if (g[c] !== T.STILL) continue;
          let k = -1;
          if (this.N < this.cap) k = this.N++;
          else { for (let j = 0; j < this.N; j++) if (this.state[j] === 0) { k = j; break; } }          // out of new slots: a grain you lost for good makes room
          if (k < 0) continue;
          g[c] = 0;
          this.px[k] = xx; this.py[k] = yy; this.vx[k] = 0; this.vy[k] = 0; this.fx[k] = 0; this.fy[k] = 0;
          this.state[k] = 1; this.tint[k] = (this.rand() * 4) | 0; this.sel[k] = 0;
          this.pid[c] = k;
          this.alive++; this.total++; this.absorbed++; this.stillLeft--; woke++;
        }
      }
      if (woke) { this.terrainVersion++; this.events.push({ type: 'absorb', n: woke }); }
    }

    // Clear line through terrain (grains do not block).
    sight(x0, y0, x1, y1) {
      const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      const n = Math.ceil(d);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        if (this.terrainSolid(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t))) return false;
      }
      return true;
    }

    // Line of effect for a blow (burst, blade, hammer, shock, slam) from (x0,y0) to a target point: stone AND frozen sand block it, so what
    // stands behind a wall or an ice shield is not hit. Your own frozen sand right around the origin (the body the blow comes from) does not.
    // The one shared test for creatures (foes.js), mechanisms (mechs.js blowsOn) and the Sieve (boss.js).
    lineOfEffect(x0, y0, x1, y1) {
      if (!this.sight(x0, y0, x1, y1)) return false;
      const b = this.body, own = b && b.n && Math.hypot(x0 - b.x, y0 - b.y) <= b.r + 6 ? b.r + 4 : 0;
      const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
      for (let k = 1; k < n; k++) {
        const x = Math.round(x0 + dx * k / n), y = Math.round(y0 + dy * k / n);
        if (this.frozenAt(x, y) && !(own && Math.hypot(x - x0, y - y0) <= own)) return false;
      }
      return true;
    }

    // Where a launch released right now would fly (for the aim preview).
    predictArc(maxSteps) {
      const pts = [];
      if (!this.charging || this.aimPower <= 0.12 || this.ballCount === 0) return pts;
      const lp = (LAUNCH_MIN + LAUNCH_RANGE * this.aimPower) * this.mod.sling;
      let x = this.bx, y = this.by, vx = this.aimDx * lp, vy = this.aimDy * lp;
      for (let k = 0; k < maxSteps; k++) {
        vy += GRAV * this.mod.grav; x += vx; y += vy;
        if (this.terrainSolid(Math.round(x), Math.round(y))) break;
        pts.push(x, y);
      }
      return pts;
    }

    // You never need every grain: once the minimum is home, the chamber ends
    // a few seconds after the last grain goes in, or when you choose to.
    done() {
      if (this.level.done) return this.level.done(this) || (this.alive === 0 && this.pending === 0);
      const par0 = this.par[0];
      if (this.alive === 0 && this.pending === 0) return true;
      if (this.exited < par0) return false;
      // Once enough is home the funnel glows; you end the chamber by
      // touching it, whenever you are ready. Nothing is on a timer.
      return this.finishing;
    }
    finish() { if (this.exited >= this.par[0]) this.finishing = true; }
    get enough() { return this.exited >= this.par[0]; }
    // 1 -> 0 over the grace period after enough is home
    get graceLeft() { return this.enoughAt < 0 ? 1 : Math.max(0, 1 - (this.frame - this.enoughAt) / GRACE); }
    // Out of reach of the toll: nothing left moving, or not even counting
    // the still sand you might still wake.
    failed() {
      if (this.level.failed) return this.level.failed(this);
      if (this.alive === 0 && this.pending === 0) return this.exited < this.par[0];
      return this.exited + this.alive + this.pending + (this.stillLeft || 0) < this.par[0];
    }
  }

  const api = { Sim, T, BG, hash2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
