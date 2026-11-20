(function () {
  'use strict';
  const { Sim } = window.SpillSim;
  const { chambers } = window.SpillLevels;
  const { rooms } = window.SpillRooms;
  const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]));
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  // The descent: after the two prologue chambers, every run goes down three
  // floors of three rooms drawn from the pool (each maybe mirrored). Your sand
  // carries room to room; between floors the Keeper offers a lens. Rooms scale
  // what they ask of you to what you bring, so a thin run is harder, not over.
  const FLOORS = 3, ROOMS_PER_FLOOR = 3;
  // Runes (lenses) come in five tiers, bought with the sand you carry, so every
  // grain you lose is something you cannot buy. The list, odds and stacking
  // caps live in runes.js. Commons stack; any other rune is taken once; an
  // epic or a legendary bends the rules and only one of each fits a run.
  const RUNES = window.SpillRunes;
  const RARITY = RUNES.TIERS;
  const LENSES = RUNES.RUNES;
  // A lens's state of repair decides how long it lasts, not how strong it is.
  // Whole: it lasts. Cracked: it holds for a few rooms, then breaks. Badly
  // chipped: it breaks sooner, and the damage costs you something while it holds.
  const QUALITY = [
    { name: 'Badly chipped', price: 0.55, cracks: 2, chips: true, life: 3 },
    { name: 'Cracked', price: 0.8, cracks: 1, life: 6 },
    { name: 'Whole', price: 1, cracks: 0, life: Infinity },
  ];
  // what a chipped lens costs you while you carry it
  const DEBUFFS = {
    heavy: { name: 'Heavy', desc: 'you fall a little harder', mods: { grav: 1.08 } },
    dim: { name: 'Dim', desc: 'your pull reaches less far', mods: { reach: 0.85 } },
    brittle: { name: 'Brittle', desc: 'a grain slips away every 5 seconds', mods: { brittle: 1 } },
    stiff: { name: 'Stiff', desc: 'a longer breath between throws', mods: { throwCool: 1.25 } },
  };
  const qOf = (q) => QUALITY[Math.max(0, Math.min(2, q == null ? 2 : q))];
  // prices follow your purse: a lens always costs a real share of what you carry
  const lensCost = (l) => {
    if (l.cost === 0) return 0;
    const carried = (purse() || {}).carried || 0;
    return Math.round(Math.max(RARITY[l.rarity].cost, carried * RARITY[l.rarity].share) * qOf(l.q).price);
  };
  const MAX_LENSES = 6;
  const heldList = (d) => (d ? d.lenses : []).map((h) => typeof h === 'string' ? { id: h, q: 2 } : h).filter((h) => lensById[h.id]);   // old lenses that no longer exist are dropped
  const holds = (d, id) => heldList(d).some((h) => h.id === id);
  function rollQuality(floor) {
    const r = Math.random(), w = [[0.45, 0.38, 0.17], [0.32, 0.42, 0.26], [0.2, 0.42, 0.38], [0.1, 0.36, 0.54]][Math.min(3, floor)];
    let acc = 0; for (let q = 0; q < 3; q++) { acc += w[q]; if (r < acc) return q; }
    return 2;
  }
  // a lens's effect for the sim: its own (rarity sets the strength), plus its debuff if it has one
  function scaledMods(l, q, debuff) {
    const m = Object.assign({}, l.mods);
    debuff = null;                                          // (flaws were removed: a crack only shortens a lens's life)
    if (debuff && DEBUFFS[debuff]) for (const k in DEBUFFS[debuff].mods) m[k] = k in m && typeof m[k] === 'number' ? m[k] * DEBUFFS[debuff].mods[k] : DEBUFFS[debuff].mods[k];
    return m;
  }
  // the exact numbers, for the info view
  function effectText(l, q, debuff, life) {
    const parts = RUNES.describe(l.mods);
    const Q = qOf(q), lf = life != null ? life : Q.life;
    parts.push(lf === Infinity || lf == null ? 'lasts' : 'breaks in ' + lf + ' room' + (lf === 1 ? '' : 's'));
    if (debuff && DEBUFFS[debuff]) parts.push(DEBUFFS[debuff].name.toLowerCase() + ': ' + DEBUFFS[debuff].desc);
    return parts.join(', ');
  }
  // carried lenses wear: each room passed takes a little from every cracked one; at nothing it breaks
  function wearLenses() {
    const d = purse(); if (!d || !d.lenses) return;
    const broken = [];
    d.lenses = d.lenses.filter((h) => {
      if (typeof h !== 'object' || h.q >= 2) return true;
      h.life = (h.life == null ? qOf(h.q).life : h.life) - 1;
      if (h.life <= 0) { broken.push(lensById[h.id] ? lensById[h.id].name : 'A lens'); return false; }
      return true;
    });
    if (broken.length) { fx.lensBroke = { names: broken, t: 0 }; A.glance(); A.hit(false); }
  }
  // a room's toll by floor, and the Sieve's
  const TOLLS = [100, 140, 180], BOSS_TOLL = 220;
  const lensById = Object.fromEntries(LENSES.map((l) => [l.id, l]));
  function newDescent(carried) {
    const floors = [];
    for (let f = 0; f < FLOORS; f++) {
      const pool = rooms.map((r) => r.id);
      const pick = [];
      for (let k = 0; k < ROOMS_PER_FLOOR; k++) pick.push([pool.splice(Math.floor(Math.random() * pool.length), 1)[0], Math.random() < 0.5]);
      floors.push(pick);
    }
    return { floor: 0, room: 0, floors, lenses: [], carried: Math.max(60, carried | 0), turned: false };
  }
  // ---------- the Tower as one connected place ----------
  const WORLD = window.SpillWorld, STILL = 9, REST_SAND = 250, LEAVE_GRACE = 15;
  function newWorld(carried) {
    return { room: WORLD.start, from: null, atShrine: false, carried: Math.max(REST_SAND, carried | 0), enterCarried: 0,
      rooms: {}, checkpoint: WORLD.start, heap: null, lenses: [], floor: 1, seen: {} };
  }
  const inWorld = () => screen === 'game' && run.world && !run.descent;
  // where your sand comes in: through the opening that leads back where you
  // came from, or beside the Keeper when you rest or wake
  function entrySpawn(def, from, atShrine) {
    if (atShrine && def.shrine) return { x: def.shrine.x - 24, y: def.shrine.y - 46, w: 48, h: 42 };
    if (atShrine && def.lamp) return { x: def.lamp.x - 20, y: def.lamp.y - 40, w: 40, h: 34 };          // a checkpoint lamp you lit
    const e = from && def.exits.find((x) => x.to === from);
    if (!e) return def.spawn;
    // a little inside the room, so arriving sand does not spill straight back
    if (e.side === 'left') return { x: 24, y: e.a, w: 32, h: e.b - e.a };
    if (e.side === 'right') return { x: def.w - 56, y: e.a, w: 32, h: e.b - e.a };
    if (e.side === 'up') return { x: e.a, y: 20, w: e.b - e.a, h: 24 };
    return { x: e.a, y: def.h - 60, w: e.b - e.a, h: 24 };
  }
  // a room as you left it: its still sand (what you absorbed is gone, what
  // you left behind is there) and its mechanisms (latched doors, lit lamps)
  function worldLevel() {
    const w = run.world, def = WORLD.rooms[w.room], mem = w.rooms[w.room] || {};
    return Object.assign({}, def, {
      spawn: entrySpawn(def, w.from, w.atShrine),
      entryGrace: w.from && !w.atShrine ? { k: def.exits.findIndex((x) => x.to === w.from), until: 150 } : null,
      mechSaved: mem.mechs,
      keeper: worldBeats(def),
      build(s) {
        def.build.call(def, s);
        if (mem.still) {
          for (let i = 0; i < s.g.length; i++) if (s.g[i] === STILL) s.g[i] = 0;
          for (const c of mem.still) if (s.g[c] === 0) s.g[c] = STILL;
        }
        if (def.shrine) s.props.push({ kind: 'keeper', x: def.shrine.x - 4, y: def.shrine.y - 17 });
      },
      done: () => false,
      failed: (s) => s.alive + s.pending < 12 && s.passed.every((p) => p === 0),
    });
  }
  function rememberRoom() {
    const w = run.world, still = [];
    for (let i = 0; i < sim.g.length; i++) if (sim.g[i] === STILL) still.push(i);
    w.rooms[w.room] = Object.assign(w.rooms[w.room] || {}, { still, mechs: sim.Mechs ? sim.Mechs.save(sim) : null, visited: true });
  }
  // half your sand through an opening and you go on; grains near the
  // opening come with you; the rest stays where it is, as still sand
  function leaveRoom(k) {
    const w = run.world, e = sim.exits[k];
    let carried = sim.passed[k];
    const near = (x, y) => e.side === 'left' ? x < 48 && y >= e.a - 30 && y < e.b + 10 : e.side === 'right' ? x >= sim.W - 48 && y >= e.a - 30 && y < e.b + 10
      : e.side === 'down' ? y >= sim.H - 48 && x >= e.a - 24 && x < e.b + 24 : y < 48 && x >= e.a - 24 && x < e.b + 24;
    // The body is everything chained to the exit-side grains (the old 'near' box is the seed) through gaps of up to LINK cells:
    // a strung-out or thrown body comes whole; a pile that lies apart from it stays where it is (docs/remake/BUG1_DESIGN_NOTE.md)
    const LINK = 6, B = new Map(), keyOf = (x, y) => Math.floor(x / LINK) * 100000 + Math.floor(y / LINK), inBody = new Uint8Array(sim.N), queue = [];
    for (let i = 0; i < sim.N; i++) {
      if (sim.state[i] !== 1 && sim.state[i] !== 2) continue;
      const kk = keyOf(sim.px[i], sim.py[i]); let a = B.get(kk); if (!a) B.set(kk, a = []); a.push(i);
      if (near(sim.px[i], sim.py[i])) { inBody[i] = 1; queue.push(i); }
    }
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h], bx = Math.floor(sim.px[i] / LINK), by = Math.floor(sim.py[i] / LINK);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const a = B.get((bx + dx) * 100000 + by + dy); if (!a) continue;
        for (const j of a) if (!inBody[j]) { inBody[j] = 1; queue.push(j); }
        B.delete((bx + dx) * 100000 + by + dy);                              // a bucket is joined once, all of it
      }
    }
    for (let i = 0; i < sim.N; i++) {
      if (sim.state[i] !== 1 && sim.state[i] !== 2) continue;
      const c = sim.py[i] * sim.W + sim.px[i];
      sim.pid[c] = -1;
      if (inBody[i]) { carried++; sim.state[i] = 6; }
      else { if (sim.g[c] === 0) sim.g[c] = STILL; sim.state[i] = 0; }      // left behind, waiting
    }
    rememberRoom();
    if (e.to === 'dream') {
      w.carried = 0; run.descent = newDescent(carried); saveRun(); restart(true); return;
    }
    w.from = w.room; w.room = e.to; w.atShrine = false; w.carried = carried; w.rested = false;   // one rest per visit
    run.super = Math.min(1, (run.super || 0) + 0.12 * (descentMods().superRate || 1)); wearLenses();                               // passing on charges the super
    saveRun(); restart(true);
  }
  // Death in the Tower: you wake beside the last Keeper you rested with,
  // and what you carried into that room lies where you fell. Fall again
  // before you reach it, and it is gone.
  function worldDeath() {
    const w = run.world;
    if (w.heap) {                                         // the old heap, never recovered, is lost
      const m = w.rooms[w.heap.room];
      if (m && m.still) { const gone = new Set(w.heap.cells); m.still = m.still.filter((c) => !gone.has(c)); }
    }
    const n = Math.max(30, w.enterCarried), x = Math.round(fx.lastCx || sim.W / 2);
    let gy = Math.round(fx.lastCy || sim.H / 2); while (gy < sim.H - 1 && !sim.terrainSolid(x, gy + 1)) gy++;
    const before = new Set(); for (let i = 0; i < sim.g.length; i++) if (sim.g[i] === STILL) before.add(i);
    const hw = Math.max(6, Math.round(Math.sqrt(n) * 1.1)), hh = Math.max(3, Math.round(Math.sqrt(n) * 0.5));
    window.SpillFixtures.stillPile(sim, x, gy + 1, hw, hh);
    const cells = []; for (let i = 0; i < sim.g.length; i++) if (sim.g[i] === STILL && !before.has(i)) cells.push(i);
    rememberRoom();
    w.heap = { room: w.room, cells, n: cells.length };
    w.room = w.checkpoint; w.from = null; w.atShrine = true; w.carried = REST_SAND; w.died = true; w.rested = true;
    M.cue('run_lost'); saveRun(); restart(true);
  }
  function currentLevel() {
    if (screen === 'title') return window.SpillLevels.titleScene;
    if (inWorld()) return worldLevel();
    const d = run.descent;
    if (d && d.floor >= FLOORS) return window.SpillBoss.sieve;    // the bottom
    return d ? roomById[d.floors[d.floor][d.room][0]] : chambers[level];
  }
  function descentMods() {
    return RUNES.combine(heldList(run.descent || run.world).map((h) => scaledMods(lensById[h.id], h.q, h.debuff)));   // stacked, then capped
  }
  const A = window.SpillAudio;
  const M = window.SpillMusic;

  const glCanvas = document.getElementById('gl');
  const hud = document.getElementById('hud');
  const hx = hud.getContext('2d');
  const R = new window.SpillRenderer(glCanvas);
  const FF = window.SpillFight ? new window.SpillFight() : null;   // fight camera and lens (fightfx.js)
  const FA = window.SpillFightAnim ? new window.SpillFightAnim({ fx: () => R.fx, anim, ground: (x, y) => groundBelow(x, y), solid: (x, y) => sim.terrainSolid(x, y),
    hold: (n) => { fx.hitstop = Math.max(fx.hitstop, n); }, shake: (n) => { cam.shake = Math.max(cam.shake, n); }, light: (x, y, r, w, l) => flashLight(x, y, r, w, l) }) : null;   // fight animations (fightanim.js)
  const keeper = new window.SpillKeeper(A);
  // Story lines (not tutor lessons) only speak at safe moments: in the shop, on a result
  // screen, or on entering a room before the player has acted. Never mid-fight.
  keeper.canSpeak = () => {
    if (shrine.on || fx.result) return true;
    // the Sieve's fight: the Keeper says nothing during it (its own voice, or the shop and the fall, carry the story)
    if (currentLevel().boss) return false;
    return screen === 'game' && !!sim && !pause.on && !fx.acted;
  };

  let sim, seedN = 1;
  // The run: which chamber you are in and how much sand you entered it with.
  // Sand you save is the sand you carry; this survives closing the game.
  // Three save slots ("glasses"). The title screen picks one; everything you
  // carry between chambers is written to it.
  let slot = 1;
  let run = { level: 0, entry: null, best: {} };
  const slotKey = (n) => 'spill.slot' + n;
  function readSlot(n) {
    try {
      const d = JSON.parse(localStorage.getItem(slotKey(n)) || 'null');
      if (!d) return null;
      // post-prologue saves have a level past the chambers array; that is valid
      if (d.prologueDone || d.world || d.descent) return d;
      return chambers[d.level] ? d : null;
    } catch (e) { return null; }
  }
  // the click-the-funnel hint is a tutorial: once you've gone through one funnel it never shows again
  let funnelTaught = false; try { funnelTaught = localStorage.getItem('spill.funnelTaught') === '1'; } catch (e) { /* storage blocked */ }
  const saveRun = () => { run.updated = Date.now(); try { localStorage.setItem(slotKey(slot), JSON.stringify(run)); } catch (e) { /* storage blocked */ } };
  let level = 0;
  let screen = 'title';
  const title = { sel: 0, confirmT: 0, cards: [] };

  const cam = { x: 0, y: 0, shake: 0 };
  const mouse = { sx: -1, sy: -1, inside: false };
  const inp = { x: 0, y: 0, pour: false, repel: false, charge: false, harden: false, strike: false, blade: false };
  const fx = { exitPulse: 0, flash: 0, fade: 1, introT: 0, result: null, resultT: 0, progShown: 0, hitstop: 0, anims: [], whiteT: new Map(), pops: [] };
  const tut = { poured: 0, launched: false, hardened: false, ev: {} };
  let dpr = 1;
  let firstMusic = true;
  const dbg = window.__spill = {};
  // a grain count for the eye: whole, never negative, thousands grouped (1,250); never capped or clipped
  const grains = (n) => String(Math.max(0, Math.floor(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');


  function restart(firstTime) {
    const L = currentLevel(), d = screen === 'game' && run.descent;
    if (d) sim = new Sim(L, seedN++, d.carried, { flip: L.boss ? false : d.floors[d.floor][d.room][1], mods: descentMods(), toll: L.boss ? 0 : TOLLS[d.floor] });
    else if (inWorld()) { sim = new Sim(L, seedN++, run.world.carried, { mods: descentMods() }); run.world.enterCarried = run.world.carried; }
    else sim = new Sim(L, seedN++, level === 0 || screen !== 'game' ? null : run.entry);
    sim.superCharge = run.super || 0;
    R.setWorld(sim);
    if (firstTime) {
      keeper.setBeats(screen === 'game' ? beatsFor(L) : []);
      if (screen === 'game' && L.boss) { M.startSieve(0); M.setMoods([], 999); }
      else { M.stopSieve(); if (screen === 'game') { M.setMoods(L.music, firstMusic ? 8 : 25); firstMusic = false; } else M.setMoods(['spill'], 4); }
    }
    // a new room (or respawn) starts with nothing held: a key or button still down from before
    // does nothing until it is released and pressed again, and its key-up still clears it
    releaseHeld();
    fx.acted = false; fx.leaveT = 0;
    fx.tollT = 0; fx.spareLow = false;
    fx.anims = []; fx.combo = null; if (R.fx) R.fx.clear(); if (FF) FF.clear(); if (FA) FA.clear(); fx.hitstop = 0; fx.whiteT.clear(); fx.eyeWhite = 0; fx.pops = [];
    fx.cut = null; fx.bv = null; fx.bvSaid = {}; fx.letter = 0; fx.halfAge = 0; fx.dying = null; fx.regather = null; fx.bossPortal = null;
    fx.result = null; fx.resultT = 0; fx.exitPulse = 0; fx.stillCue = false; fx.keeperCue = false; fx.flip = 0; fx.progShown = 0; fx.lastBand = null; fx.snapT = 0;
    fx.fade = firstTime ? 1 : 0.85;
    if (firstTime) fx.introT = 0;
    fx.introOff = false;
    if (firstTime && inWorld()) { const w = run.world; fx.introOff = !!w.seen[w.room]; w.seen[w.room] = true; if (!fx.introOff) A.chime(0.4); }
    const vc = R.viewCells;
    cam.x = clampCam(L.camStart.x - vc.w / 2, sim.W, vc.w);
    cam.y = clampCam(L.camStart.y - vc.h / 2, sim.H, vc.h);
  }

  // The Keeper in the Tower: a few words the first time each matters.
  function worldBeats(def) {
    const w = run.world, taught = run.taught || (run.taught = {}), out = [];
    if (w.died) { w.died = false; out.push({ id: 'woke', when: (s) => s.frame > 50, lines: ['You left yourself back there. Go and get it, before you fall again.'] }); }
    if (def.id === 'hub' && !taught.landing) out.push({ id: 'landing', when: (s) => s.frame > 60 && (taught.landing = true), lines: ['This is the Landing. My lamp stays lit here.', 'Rest by me when you are tired. If you fall, you will wake here.'] });
    if (def.id === 'hall' && !taught.hall) out.push({ id: 'hall', when: (s) => s.frame > 60 && (taught.hall = true), lines: ['The Proving Hall. My master built it for apprentices.', 'Every trick of this Tower is waiting in it.'] });
    if (!taught.strike) out.push({ id: 'strike', when: (s) => s.foes.some((f) => f.kind !== 'dummy' && s.frame > 80 && Math.hypot(f.x - s.cx, f.y - s.cy) < 160) && (taught.strike = true), lines: ['Something down here eats sand.', 'It will not stop. Neither should you.'] });
    if (!taught.leftBehind) out.push({ id: 'left', when: (s) => s.passed.some((p) => p > 0) && (taught.leftBehind = true), lines: ['Not every grain has to come with you. What you leave stays where it is.'] });
    return out;
  }

  // The Keeper's words for a room: chambers bring their own; the descent
  // has a few of its own moments.
  function beatsFor(L) {
    const d = run.descent;
    if (L.boss && d && d.sieveTold) return L.keeper.map((b) => b.id === 'sieve' ? Object.assign({}, b, { when: () => true, lines: [] }) : b);   // already said at the last shrine
    if (!d || L.boss) return L.keeper;
    const first = !run.descents && d.floor === 0 && d.room === 0;
    const out = [];
    if (first) out.push({ id: 'below', when: (s) => s.frame > 90, lines: ['Below here the halls will not hold still.', 'Each time you come down, they will be laid out differently.'] });
    // things the Keeper teaches once, the first time they matter
    const taught = run.taught || (run.taught = {});
    if (!taught.strike) out.push({ id: 'strike', when: (s) => s.foes.some((f) => s.frame > 80 && Math.hypot(f.x - s.cx, f.y - s.cy) < 160) && (taught.strike = true), lines: ['Something down here eats sand.', 'It will not stop. Neither should you.'] });
    if (!taught.leave) out.push({ id: 'leave', when: (s) => s.enough && (taught.leave = true), lines: ['The toll is paid. Whatever is still out there can stay behind.', 'Not every grain has to come with you. Choose what is worth the risk.'] });
    if (d.turned && d.retryRoom === d.floor * 10 + d.room) out.push({ id: 'turned', when: (s) => s.frame > 60, lines: ['I turned the glass for you. Only once.'] });
    return out;
  }

  // After a result: carry what you saved down into the next chamber.
  function advance() {
    const saved = fx.result.saved;
    run.super = Math.min(1, (run.super || 0) + 0.12 * (descentMods().superRate || 1)); wearLenses();
    const d = run.descent;
    if (d) {
      d.carried = saved;
      if (d.floor >= FLOORS) { endDescent(true); return; }        // the Sieve is broken
      d.room++;
      if (d.room >= ROOMS_PER_FLOOR) {
        d.room = 0; d.floor++;
        saveRun(); openShrine(); return;                            // the last shrine leads to the Sieve
      }
      saveRun(); restart(true); return;
    }
    if (chambers[level + 1]) {
      level++;
      run.level = level; run.entry = saved; saveRun();
      restart(true);
    } else {
      // the prologue is over: you come down into the Tower itself
      run.prologueDone = true;
      run.world = newWorld(saved);
      saveRun(); restart(true);
    }
  }
  // A failed room: the Keeper turns the glass once per descent (you go again
  // with half the sand you came in with); the second time, the descent ends.
  function failRoom() {
    const d = run.descent;
    if (inWorld()) { worldDeath(); return; }
    if (!d) { M.cue('run_lost'); restart(false); return; }
    if (!d.turned) {
      d.turned = true; d.retryRoom = d.floor * 10 + d.room;
      d.carried = Math.max(60, Math.ceil(d.carried / 2));
      saveRun(); M.cue('turned_glass'); restart(true); fx.flash = 0.25;
    } else endDescent(false);
  }
  // Whatever was banked stays in the Great Glass; a finished descent banks
  // everything it carried out.
  function endDescent(won) {
    const d = run.descent;
    if (won) { run.banked = (run.banked || 0) + d.carried; run.descents = (run.descents || 0) + 1; M.cue('great_glass'); }
    else { run.falls = (run.falls || 0) + 1; M.cue('run_lost'); }
    run.descent = null; run.lastEnd = { won, carried: d.carried }; M.stopSieve();
    if (!run.world) run.world = newWorld(0);
    // you wake from the dream beside the Keeper at the Landing
    const w = run.world;
    w.room = w.checkpoint; w.from = null; w.atShrine = true; w.carried = Math.max(REST_SAND, won ? d.carried : 0); w.rested = true;
    saveRun(); restart(true);
  }

  // ---------- the Keeper's shrine, between floors ----------
  // Three lenses to choose from, or take sand instead: a refill, or banking
  // half of what you carry into the Great Glass where no fall can touch it.
  const shrine = { on: false, offer: [], sel: 0, boxes: [], t: 0, reroll: 20, banked: false, info: false, infoBox: null, focus: 0 };
  // A lens you already carry, bought again, is not a second copy: it mends yours one step
  // (badly chipped -> cracked -> whole), whatever state the new one is in. Only a whole
  // common can be taken again as a second copy (commons stack).
  const upgradeIdx = (d, id) => { let best = -1; heldList(d).forEach((h, k) => { if (h.id === id && h.q < 2 && (best < 0 || h.q < heldList(d)[best].q)) best = k; }); return best; };
  function rollLens(d) {
    const heldOne = new Set(heldList(d).filter((h) => RARITY[lensById[h.id].rarity].one).map((h) => lensById[h.id].rarity));
    const taken = new Set(shrine.offer.filter(Boolean).map((l) => l.id));
    const ok = (l) => !taken.has(l.id) && (l.rarity === 'common' || !holds(d, l.id) || upgradeIdx(d, l.id) >= 0) && !(RARITY[l.rarity].one && heldOne.has(l.rarity) && !holds(d, l.id));
    // the odds grow slowly over the whole journey, and a long dry spell brings a legendary (runes.js)
    const l = RUNES.rollRune(Math.random, runeLuck(), d.floor || 1, ok);
    if (!l) return null;
    const q = RARITY[l.rarity].one ? 2 : rollQuality(d.floor);
    return Object.assign({}, l, { q, life: qOf(q).life, debuff: null });
  }
  const purse = () => run.descent || run.world;
  const runeLuck = () => run.runeLuck || (run.runeLuck = { shrines: 0, dry: 0 });   // kept with the save, across runs
  function openShrine() {
    const d = purse();
    if (run.descent && holds(d, 'debt')) d.carried += 150;
    shrine.offer = [];
    for (let k = 0; k < 3; k++) shrine.offer.push(rollLens(d));
    RUNES.markShrine(runeLuck(), shrine.offer);
    shrine.on = true; shrine.sel = 0; shrine.focus = 0; shrine.t = 0; shrine.reroll = 25; shrine.picked = -1; shrine.sellPending = null;
    inp.pour = inp.charge = inp.harden = false;
    const toSieve = run.descent && d.floor >= FLOORS;          // the last shrine: tell them about the Sieve here, not in the fight
    if (toSieve) d.sieveTold = true;
    keeper.setBeats([{ id: 'shrine', when: () => true, lines: toSieve ? ['The Sieve waits below. It takes from everyone who falls this far.', 'When an eye opens, strike it with {F}. Hurt it enough and it breaks.']
      : [!run.descent ? 'Rest. Mend what you carry, or buy what you need. It all costs sand.' : d.floor === 1 ? 'Rest a moment. Everything here costs sand.' : 'Deeper still. Spend wisely; the toll grows.'] }]);
    M.cue('keeper');
  }
  // The shrine offers three lenses: buy any number you can afford. Your own
  // lenses live in a backpack (bottom right); open it to sell or mend one.
  function shrineItems() {
    const d = purse(), held = heldList(d), full = held.length >= MAX_LENSES;
    const L = shrine.offer[shrine.focus];
    const items = shrine.offer.map((l, k) => ({ lens: l, slot: k, can: () => !!l, act: () => { shrine.focus = k; } }));
    const bought = !L;     // this slot was already purchased
    const cost = L ? lensCost(L) : 0, up = L ? upgradeIdx(d, L.id) : -1, blocked = full && up < 0;
    items.push({ buy: true, label: bought ? 'Sold' : up >= 0 ? 'Upgrade yours' : blocked ? 'Backpack full' : 'Buy', price: bought || blocked ? null : cost,
      can: () => !bought && !!L && !blocked && d.carried >= cost,
      act: () => {
        if (bought || !L || blocked || d.carried < cost) { A.glance(); return; }
        d.carried -= cost;
        if (up >= 0) { const nq = Math.min(2, heldList(d)[up].q + 1); d.lenses[up] = { id: L.id, q: nq, life: nq >= 2 ? null : qOf(nq).life, debuff: null }; }
        else d.lenses.push({ id: L.id, q: L.q, life: L.life === Infinity ? null : L.life, debuff: null });
        if (L.id === 'debt') d.carried += 150;
        shrine.offer[shrine.focus] = null;
        const next = shrine.offer.findIndex((offer) => !!offer);
        shrine.focus = next >= 0 ? next : 0;
        shrine.sel = shrine.focus;
        A.chime(0.6); saveRun();
      } });
    items.push({ small: true, label: 'Reroll ' + shrine.reroll, can: () => d.carried >= shrine.reroll,
      act: () => { if (d.carried < shrine.reroll) return; d.carried -= shrine.reroll; shrine.reroll = Math.round(shrine.reroll * 1.7 / 5) * 5; shrine.offer = [];   /* each reroll this visit costs more: 25, 45, 75, 130, 220, 375 */ for (let k = 0; k < 3; k++) shrine.offer.push(rollLens(d)); if (shrine.offer.some((o) => o && o.rarity === 'legendary')) runeLuck().dry = 0; shrine.focus = 0; } });
    items.push({ small: true, label: run.descent ? 'Go deeper' : 'Leave', can: () => true, act: () => closeShrine() });
    return items;
  }
  function closeShrine() {
    shrine.on = false;
    if (inWorld()) { const w = run.world; w.carried = Math.max(REST_SAND, w.carried); w.atShrine = true; w.from = null; }
    saveRun(); restart(true);
  }
  // resting at a Keeper in the Tower: the checkpoint, the shop, a top-up
  // a lamp catching: a warm burst, sparks rising, a short held light
  function lampFlare(x, y) {
    if (R.fx) { R.fx.core(x, y, 4, 'sun', 5); R.fx.ring(x, y, 2, 16, 'sun', 14, { thick: 2, l0: 1 }); for (let k = 0; k < 10; k++) R.fx.ember(x + (Math.random() - 0.5) * 6, y, (Math.random() - 0.5) * 0.5, -0.4 - Math.random() * 0.6, 'sun', 40 + Math.random() * 30); }
    flashLight(x, y, 120, true, 16); cam.shake = Math.max(cam.shake, 1);
  }
  function restAtShrine() {
    const w = run.world;
    w.checkpoint = w.room; w.carried = sim.alive + sim.pending;
    rememberRoom();
    A.chime(0.7);
    openShrine();
  }

  function clampCam(v, size, view) {
    if (view >= size) return (size - view) / 2;
    return Math.max(0, Math.min(size - view, v));
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    R.resize(w, h, dpr);
    hud.width = Math.round(w * dpr); hud.height = Math.round(h * dpr);
    hud.style.width = w + 'px'; hud.style.height = h + 'px';
    glCanvas.style.width = w + 'px'; glCanvas.style.height = h + 'px';
  }
  window.addEventListener('resize', resize);

  // ---------- input ----------
  function toWorld() {
    inp.x = cam.x + (mouse.sx * dpr) / R.effScale;
    inp.y = cam.y + (mouse.sy * dpr) / R.effScale;
  }
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  // Where the pointer is. Past the window edge the browser stops reporting clientX/Y at the
  // edge, so while aiming there the position is carried on by the movement deltas, up to a
  // margin beyond the window: the aim keeps following the hand instead of freezing at the edge.
  const PTR_MARGIN = 0.6;
  // The aim as a virtual stick (docs/remake/BUG3_DESIGN_NOTE.md): while a right-button aim is held, the pointer's MOVEMENT since the press, in world cells,
  // is accumulated here (x, y = anchor minus cursor, the way the sim reads an aim) and handed to the sim as inp.stick. It does not depend on where
  // the pointer is on screen, on the window edge, or on the camera. A press near a screen edge also asks for pointer lock so the hand can keep moving.
  const aimStick = { x: 0, y: 0 };
  function aimStickMove(e) {
    if (!inp.charge || !(e.movementX || e.movementY)) return;
    const k = dpr / R.effScale, lim = (sim && sim.aimLen ? sim.aimLen : 32) * 1.5;
    aimStick.x -= e.movementX * k; aimStick.y -= e.movementY * k;
    const d = Math.hypot(aimStick.x, aimStick.y); if (d > lim) { aimStick.x *= lim / d; aimStick.y *= lim / d; }          // over-pulling never needs unwinding
  }
  function aimStickBegin() {
    aimStick.x = 0; aimStick.y = 0;
    try {
      const pad = ((sim && sim.aimLen) || 32) * R.effScale / dpr + 12, W = window.innerWidth, H = window.innerHeight;     // CSS px of a full pull, plus a little
      if ((mouse.sx < pad || mouse.sy < pad || mouse.sx > W - pad || mouse.sy > H - pad) && glCanvas.requestPointerLock && !document.pointerLockElement) { const p = glCanvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); }
    } catch (e2) { /* lock not available: the stick still follows the pointer's movement */ }
  }
  function movePointer(e) {
    aimStickMove(e);
    const W = window.innerWidth, H = window.innerHeight;
    const atEdge = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= W - 1 || e.clientY >= H - 1;
    if (atEdge && mouse.sx >= 0 && (e.movementX || e.movementY)) {
      mouse.sx = Math.max(-W * PTR_MARGIN, Math.min(W * (1 + PTR_MARGIN), mouse.sx + e.movementX));
      mouse.sy = Math.max(-H * PTR_MARGIN, Math.min(H * (1 + PTR_MARGIN), mouse.sy + e.movementY));
    } else { mouse.sx = e.clientX; mouse.sy = e.clientY; }
  }
  // The buttons as the pointer reports them now: a button that is up but still counted as held
  // (its pointerup was lost, e.g. released outside the window) is let go on the next move.
  function syncButtons(buttons) {
    if (!(buttons & 1) && (inp.pour || inp.repel)) { inp.pour = false; inp.repel = false; }
    if (!(buttons & 2) && inp.charge) inp.charge = false;
  }
  window.addEventListener('pointermove', (e) => {
    movePointer(e); mouse.inside = true; pause.mouseMoved = true; syncButtons(e.buttons);
  });
  // The pointer leaves the window with no button down: the game's own cursor steps aside. With a
  // button held (an aim, a drag) it stays tracked, so nothing is cut off at the edge.
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget && !e.buttons) mouse.inside = false; });
  // the Keeper's skip arrow comes first: nothing else (the backpack, the pause button) may cover it
  function keeperSkipClick(px, py) {
    const nb = keeper.nextBtn;
    if (!keeper.line || !nb || pause.on || screen !== 'game') return false;
    if (px < nb.x || px > nb.x + nb.w || py < nb.y || py > nb.y + nb.h) return false;
    keeper.skip(); return true;
  }
  window.addEventListener('pointerdown', (e) => {
    A.start();
    try { if (e.target && e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId); } catch (e2) { /* not capturable */ }   // a drag let go outside the window still ends
    mouse.inside = true; mouse.sx = e.clientX; mouse.sy = e.clientY;
    if (keeperSkipClick(e.clientX * dpr, e.clientY * dpr)) return;
    if (screen === 'game' && !pause.on && bagClick(e.clientX * dpr, e.clientY * dpr)) return;   // the backpack row and its popup
    if (screen === 'cutscene') { if (opening.cut) opening.typed = opening.cut.cur.line.length; return; }
    if (screen === 'title') { titleClick(e.clientX * dpr, e.clientY * dpr); return; }
    if (shrine.on) {
      const px = e.clientX * dpr, py = e.clientY * dpr;
      const ib = shrine.infoBox;
      if (ib && px >= ib.x && px <= ib.x + ib.w && py >= ib.y && py <= ib.y + ib.h) { shrine.info = !shrine.info; return; }
      if (shrine.t > 30) { const its = shrineItems(); for (let i = shrine.boxes.length - 1; i >= 0; i--) { const b = shrine.boxes[i]; if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { its[i].act(); break; } } }   // the topmost thing under the cursor
      return;
    }
    if (pause.on && (pause.book || pause.controls)) { pause.book = false; pause.controls = false; return; }
    if (pause.on) { if (pause.hover >= 0) { pause.sel = pause.hover; choose(pause.hover, e.clientX * dpr); } return; }
    const px = e.clientX * dpr, py = e.clientY * dpr;
    if (px >= pauseBtn.x && px <= pauseBtn.x + pauseBtn.w && py >= pauseBtn.y && py <= pauseBtn.y + pauseBtn.h) { openPause(); return; }
    // touching the glowing funnel, once enough is home, moves you on
    if (e.button === 0 && sim.enough && sim.exitAt && !fx.result) {
      toWorld();
      if (Math.hypot(inp.x - sim.exitAt.x, inp.y - sim.exitAt.y) < 26) { sim.finish(); if (!funnelTaught) { funnelTaught = true; try { localStorage.setItem('spill.funnelTaught', '1'); } catch (e2) { /* storage blocked */ } } return; }
    }
    if (fx.result && fx.resultT > 40) { advance(); return; }
    if (e.button === 2) { inp.charge = true; aimStickBegin(); } else if (e.button === 0) { inp.pour = true; inp.repel = !!e.shiftKey; } else if (e.button === 1) { inp.strike = true; e.preventDefault(); }
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 2) inp.charge = false; else if (e.button === 0) { inp.pour = false; inp.repel = false; } else if (e.button === 1) inp.strike = false;
  });
  // Nothing held: used on every respawn or new room. Key-ups still clear anything pressed after it.
  function releaseHeld() {
    inp.pour = inp.repel = inp.charge = inp.harden = inp.strike = inp.blade = false;
    fx.slowHeld = false; hold.on = false; hold.t = 0;
  }
  // alt-tab: the keys and the left button let go. A held right-button aim is not cancelled here
  // (a stray blur must not spoil it); its pointerup, or the next move with it up, ends it.
  window.addEventListener('blur', () => {
    inp.pour = inp.repel = inp.harden = inp.strike = inp.blade = false;
    fx.slowHeld = false; hold.on = false;
    if (fx.lookKeys) for (const k in fx.lookKeys) fx.lookKeys[k] = false;
  });
  // a hidden page: everything lets go, the right button too
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    releaseHeld(); inp.charge = false;
    if (fx.lookKeys) for (const k in fx.lookKeys) fx.lookKeys[k] = false;
  });
  window.addEventListener('keydown', (e) => {
    A.start();
    if (devKey(e)) return;                                   // the dev console takes the keyboard while it is open
    // Shift changes the left button live: pressed while the sand is already being drawn, it repels
    if (e.key === 'Shift' && inp.pour) inp.repel = true;
    if (e.repeat) return;
    if (screen === 'cutscene') { if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); opening.skipT = 1; } return; }
    if (screen === 'game' && e.code === 'KeyB' && !pause.on && !shrine.on) { bag.open = !bag.open; bag.sel = 0; bag.sellPending = null; return; }
    // with the backpack open, left and right turn its pages (and Escape closes it) instead of looking around
    if (screen === 'game' && bag.open && !pause.on && !shrine.on) {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); bagTurn(e.code === 'ArrowLeft' ? -1 : 1); return; }
      if (e.code === 'Escape') { bag.open = false; return; }
    }
    if (screen === 'title') {
      const n = titleItems().length;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') title.sel = (title.sel + 1) % n;
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') title.sel = (title.sel + n - 1) % n;
      else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); titleItems()[title.sel].act(); }
      return;
    }
    if (shrine.on) {
      // E, Enter or Space skips the Keeper's line while one is showing; with no line up, Enter and Space keep their job (buy)
      if ((e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') && keeper.skip()) { e.preventDefault(); return; }
      // left and right look along the lenses; Enter buys the one you are looking at; B opens your backpack
      const its = shrineItems(), offers = shrine.offer.length;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { shrine.focus = (shrine.focus + 1) % offers; shrine.sel = shrine.focus; }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { shrine.focus = (shrine.focus + offers - 1) % offers; shrine.sel = shrine.focus; }
      else if ((e.code === 'Enter' || e.code === 'Space') && shrine.t > 30) { e.preventDefault(); const it = its[shrine.sel]; if (!it || it.lens) its.find((b) => b.buy).act(); else it.act(); }
      else if (e.code === 'KeyI') shrine.info = !shrine.info;
      return;
    }
    if (pause.on && (pause.book || pause.controls)) { if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') { pause.book = false; pause.controls = false; } return; }
    if (e.code === 'Escape') {
      if (sim && sim.cancelSuper && sim.cancelSuper()) return;
      if (sim && sim.cancelAttack && sim.cancelAttack()) return;
      if (pause.on) pause.on = false; else openPause(); return;
    }
    if (pause.on) {
      const it = MENU[pause.sel];
      if (e.code === 'ArrowDown' || e.code === 'KeyS') pause.sel = (pause.sel + 1) % MENU.length;
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') pause.sel = (pause.sel + MENU.length - 1) % MENU.length;
      else if ((e.code === 'ArrowLeft' || e.code === 'KeyA') && it.kind === 'slider') A.setVolume(it.key, A.volume(it.key) - 0.1);
      else if ((e.code === 'ArrowRight' || e.code === 'KeyD') && it.kind === 'slider') A.setVolume(it.key, A.volume(it.key) + 0.1);
      else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); choose(pause.sel); }
      return;
    }
    const LOOK = { KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd' };
    if (LOOK[e.code]) { tut.ev.look = true; (fx.lookKeys || (fx.lookKeys = {}))[LOOK[e.code]] = true; e.preventDefault(); }
    if (e.repeat && (e.code === 'Space' || e.code === 'KeyF' || e.code === 'KeyQ')) { if (e.code === 'Space') e.preventDefault(); return; }   // a key held through a respawn stays let go until pressed again
    if (e.code === 'Space') { e.preventDefault(); A.start(); tut.ev.slow = true; if (sim && sim.spacePress) { if (sim.spacePress()) { fx.slowPressF = fx.realF || 0; slowBegin(); } else fx.slowRefuseF = fx.realF || 0; } }   // a tap slows time for a moment (and is a parry press); refused while slowed or recovering
    else if (e.code === 'KeyF') inp.blade = true;            // the blade (tap) and the hammer (hold)
    else if (e.code === 'KeyQ') inp.strike = true;           // the lash
    else if (e.code === 'KeyR') { A.start(); if (fx.result) advance(); else { hold.on = true; hold.t = 0; hold.run = e.shiftKey; } }
    else if (e.code === 'KeyM') A.toggleMute();
    else if (e.code === 'KeyX' && sim && !sim.superNow) { const vc = R.viewCells; if (sim.startSuper({ x0: cam.x, x1: cam.x + vc.w, y0: cam.y })) run.super = 0; }
    else if (e.code === 'KeyE') { if (e.repeat ? !inp.harden : (bossVoiceSkip() || keeper.skip())) return; inp.harden = true; }   // E: skips the Keeper's line if one is showing, else hold to freeze
    else if (e.code === 'Enter') { if (!bossVoiceSkip() && !keeper.skip() && sim.enough) sim.finish(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') inp.repel = false;                // let go of Shift while drawing: back to pulling, at once
    if (screen === 'cutscene') { opening.skipT = 0; return; }
    if (e.code === 'Space') fx.slowHeld = false;
    const LOOK2 = { KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd' };
    if (LOOK2[e.code] && fx.lookKeys) fx.lookKeys[LOOK2[e.code]] = false;
    if (e.code === 'KeyF') inp.blade = false;
    if (e.code === 'KeyQ') inp.strike = false;
    if (e.code === 'KeyE') inp.harden = false;
    if (e.code === 'KeyR') hold.on = false;
    if (e.key === 'Shift') hold.run = false;
  });
  // Hold R to turn the hourglass and restart the chamber; hold Shift+R
  // longer to start the whole run again. A tap does nothing, so no accidents.
  const hold = { on: false, t: 0, run: false };

  // Esc or the top-right button: the pause menu.
  const pause = { on: false, sel: 0, hover: -1, boxes: [], mouseMoved: false };
  const pauseBtn = { x: 0, y: 0, w: 0, h: 0 };
  const MENU = [
    { kind: 'btn', label: 'Resume', act: () => { pause.on = false; } },
    { kind: 'btn', label: 'Lenses', act: () => { pause.book = true; } },
    { kind: 'btn', label: 'Controls', act: () => { pause.controls = true; } },
    { kind: 'btn', label: 'Restart', act: () => { pause.on = false; retryRoom(); } },
    { kind: 'btn', label: 'Save and exit', act: () => { pause.on = false; saveRun(); screen = 'title'; level = 0; restart(true); } },
    { kind: 'slider', label: 'Music', key: 'music' },
    { kind: 'slider', label: 'Sound', key: 'sound' },
  ];
  // Restarting a room in the descent is the Keeper's one turn of the glass;
  // in the prologue it is free.
  function retryRoom() {
    const d = run.descent;
    if (!d) { restart(false); return; }
    if (d.turned) return;           // nothing left to turn; play it out
    failRoom();
  }
  function openPause() { pause.on = true; pause.sel = 0; pause.mouseMoved = false; inp.pour = inp.charge = inp.harden = false; }
  function choose(i, mx) {
    const it = MENU[i];
    if (it.kind === 'btn') it.act();
    else if (mx != null && it.track) A.setVolume(it.key, Math.ceil((mx - it.track.x) / it.track.w * 10) / 10);
  }
  function updateHold(dt) {
    if (!hold.on) { hold.t = Math.max(0, hold.t - dt * 3); return; }
    hold.t += dt;
    const need = hold.run ? 1.6 : 0.6;
    if (hold.t >= need) {
      hold.on = false; hold.t = 0;
      if (hold.run) { if (run.descent) endDescent(false); else { run = Object.assign(run, { level: 0, entry: null }); level = 0; saveRun(); restart(true); } }
      else retryRoom();
    }
  }

  // ---------- camera ----------
  function updateCamera() {
    const vc = R.viewCells, L = currentLevel();
    if (dbg.camLock) { cam.x = dbg.camLock.x - vc.w / 2; cam.y = dbg.camLock.y - vc.h / 2; return; }   // test hook: hold the view on a point (recordings)
    if (sim.superNow || fx.superView) {
      // the super holds the view it was cast in (the whole screen rains), leaning in on you through
      // the lift, pulling back past the edges for the rain, easing home after
      const base = { w: R.screenW / R.scale, h: R.screenH / R.scale }, SU = sim.superNow, A0 = SU && SU.area;
      const V = fx.superView || { cx: A0 ? (A0.x0 + A0.x1) / 2 : cam.x + vc.w / 2, cy: A0 ? (A0.y0 + A0.y1) / 2 : cam.y + vc.h / 2, z: R.zoom };
      const t = SU ? superT(SU) : 9999, mul = !SU || currentLevel().boss ? 1 : t < SUPER_LIFT ? 1 + 0.05 * (t / SUPER_LIFT) : t < SUPER_GONE ? 1.05 - 0.13 * Math.min(1, (t - SUPER_LIFT) / 40) : 0.92;
      R.zoom += (V.z * mul - R.zoom) * (SU ? 0.05 : 0.08);
      const vw = base.w / R.zoom, vh = base.h / R.zoom, lean = SU && t < SUPER_LIFT ? 0.25 * t / SUPER_LIFT : 0, bx2 = fx.bodyX != null ? fx.bodyX : V.cx, by2 = fx.bodyY != null ? fx.bodyY : V.cy;
      const tx = clampCam(V.cx + (bx2 - V.cx) * lean - vw / 2, sim.W, vw), ty = clampCam(V.cy + (by2 - V.cy) * lean - vh / 2, sim.H, vh);
      cam.x += (tx - cam.x) * 0.12; cam.y += (ty - cam.y) * 0.12;
      if (SU || Math.abs(R.zoom - V.z) > 0.01) return;
      fx.superView = null;
    }
    if (L.boss) {
      // a boss arena is framed whole and held still: you need to see every eye
      const base = { w: R.screenW / R.scale, h: R.screenH / R.scale };
      const zt = Math.max(0.62, Math.min(1.1, base.w / (sim.W + 6), base.h / (sim.H + 4)));
      R.zoom += (zt - R.zoom) * 0.05;
      const tx = sim.W / 2 - base.w / R.zoom / 2, ty = sim.H / 2 - base.h / R.zoom / 2;
      const dx = (tx - cam.x) * 0.08, dy = (ty - cam.y) * 0.08;
      cam.x += dx; cam.y += dy;
      if (sim.charging) { sim.anchorX += dx; sim.anchorY += dy; }
      return;
    }
    // The camera keeps the sand inside a comfortable inner region rather
    // than centring it: it only moves when the sand (or something important)
    // nears the edge of that region. Grains falling away are ignored.
    // Follow the main body of your sand, not every straggler: find the
    // thickest patch (coarse buckets) and frame the grains around it.
    const B = 28, counts = new Map();
    let best = -1, bestN = 0;
    for (let i = 0; i < sim.N; i++) {
      if ((sim.state[i] !== 1 && sim.state[i] !== 2) || sim.py[i] > L.camFloor) continue;
      const k = ((sim.px[i] / B) | 0) * 4096 + ((sim.py[i] / B) | 0), v = (counts.get(k) || 0) + 1;
      counts.set(k, v);
    }
    for (const [k, v] of counts) {
      let around = v;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) around += counts.get(k + dx * 4096 + dy) || 0;
      if (around > bestN) { bestN = around; best = k; }
    }
    const bx0 = ((best / 4096) | 0) - 2, by0 = (best % 4096) - 2;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, n = 0;
    fx.bodyX = null;
    let sbx = 0, sby = 0;
    for (let i = 0; i < sim.N; i++) {
      if ((sim.state[i] !== 1 && sim.state[i] !== 2) || sim.vy[i] > 2.5 || sim.py[i] > L.camFloor) continue;
      const qx = (sim.px[i] / B) | 0, qy = (sim.py[i] / B) | 0;
      if (best >= 0 && (qx < bx0 || qx > bx0 + 4 || qy < by0 || qy > by0 + 4)) continue;    // a straggler: ignored
      const px = sim.px[i], py = sim.py[i]; n++; sbx += px; sby += py;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    if (n) { fx.bodyX = sbx / n; fx.bodyY = sby / n; }
    let poi = null;
    if (sim.exitAt && n) {
      const d = Math.hypot(sim.exitAt.x - (x0 + x1) / 2, sim.exitAt.y - (y0 + y1) / 2);
      if (sim.enough || d < 220) poi = sim.exitAt;
    }
    if (poi) { x0 = Math.min(x0, poi.x - 12); x1 = Math.max(x1, poi.x + 12); y0 = Math.min(y0, poi.y - 16); y1 = Math.max(y1, poi.y + 8); }
    // Aiming: the camera eases so the gathered sand sits mid-screen, leaving
    // room to pull back even from the floor. The press point rides with the
    // camera, so the aim never drifts while the view moves; zoom holds still.
    if (sim.charging) {
      const gy = sim.by - vc.h * 0.5, gx = sim.bx - vc.w * 0.5;
      const ty = clampCam(Math.min(gy, Math.min(sim.H, L.camBottom) - vc.h), sim.H, vc.h), tx = clampCam(gx, sim.W, vc.w);   // never past the world's edge
      const dx = (tx - cam.x) * 0.08, dy = (ty - cam.y) * 0.08;
      cam.x += dx; cam.y += dy; sim.anchorX += dx; sim.anchorY += dy;
      return;
    }
    // while pouring, the place you are leading the sand counts too
    if (mouse.inside && inp.pour && n) {
      x0 = Math.min(x0, inp.x); x1 = Math.max(x1, inp.x); y0 = Math.min(y0, inp.y); y1 = Math.max(y1, inp.y);
    }
    let gx = cam.x, gy = cam.y;
    if (n) {
      const mx = vc.w * 0.24, myTop = vc.h * 0.3, myBot = vc.h * 0.2;   // more room above than below
      if (x1 - x0 > vc.w - 2 * mx) gx = (x0 + x1) / 2 - vc.w / 2;
      else if (x0 < gx + mx) gx = x0 - mx; else if (x1 > gx + vc.w - mx) gx = x1 - vc.w + mx;
      if (y1 - y0 > vc.h - myTop - myBot) gy = (y0 + y1) / 2 - vc.h / 2;
      else if (y0 < gy + myTop) gy = y0 - myTop; else if (y1 > gy + vc.h - myBot) gy = y1 - vc.h + myBot;
    }
    // a manual look (WASD / arrows): push the view, and it eases back after
    const lk = fx.look || (fx.look = { x: 0, y: 0 }), held = fx.lookKeys || {};
    const want = { x: (held.r ? 1 : 0) - (held.l ? 1 : 0), y: (held.d ? 1 : 0) - (held.u ? 1 : 0) };
    lk.x += ((want.x * vc.w * 0.38) - lk.x) * (want.x ? 0.06 : 0.04);
    lk.y += ((want.y * vc.h * 0.38) - lk.y) * (want.y ? 0.06 : 0.04);
    gx += lk.x; gy += lk.y;
    gx = clampCam(gx, sim.W, vc.w);
    gy = clampCam(gy, sim.H, vc.h);
    const maxY = Math.min(sim.H, L.camBottom) - vc.h;
    if (vc.h < sim.H) gy = Math.min(gy, Math.max(0, maxY));
    cam.x += (gx - cam.x) * 0.045;
    cam.y += (gy - cam.y) * 0.045;

    // Zoom frames the sand itself, never the cursor: in close when you are
    // gathered, out when you spread or line up a slingshot. Slow and smooth.
    const base = { w: R.screenW / R.scale, h: R.screenH / R.scale };
    // (it used to close in to 1.3x when gathered; that hid too much of the room)
    let zt = 1.0;
    if (x1 > x0) zt = Math.min(1.04, base.w / (x1 - x0 + 280), base.h / (y1 - y0 + 190));
    zt = Math.max(0.8, Math.min(1.04, zt));
    const zPrev = R.zoom;
    R.zoom += (zt - R.zoom) * 0.015;
    // keep the screen centre fixed while zooming so it feels like a lens
    const cxw = cam.x + base.w / zPrev / 2, cyw = cam.y + base.h / zPrev / 2;
    cam.x = cxw - base.w / R.zoom / 2; cam.y = cyw - base.h / R.zoom / 2;
  }

  // ---------- events -> feel ----------
  // A shock ring in world space: expands and fades, drawn as hard pixels.
  // A hand-drawn impact animation placed in the world (see impacts.js).
  // a flash of light where something hits, gone in a few frames
  function flashLight(x, y, rad, warm, life) { (fx.lightFx || (fx.lightFx = [])).push({ x, y, rad, warm, life, t: 0 }); }
  // flying attacks leave energy behind them: wave grains a warm smear, stars a pink one
  // ---------- THE SUPER (art pass, remade) ----------
  // The sim runs it (sim.js stepSuper: no steering, ~7 s of rain over the whole view and past it, in
  // waves); everything here is how it looks and sounds. All sim names go through this adapter, so a
  // renamed event or field is a one-line change.
  const SUPER_EVENT = { superStart: 'start', superUp: 'up', superRise: 'rise', superGone: 'gone', superFall: 'fall', superWave: 'wave', superStar: 'spawn', superStarLand: 'land', superEnd: 'end', star: 'oldStar' };
  const superT = (SU) => SU.t, superRain = (SU) => ({ a: SU.rainStart || 150, b: SU.rainEnd || 570 }), superStars = (SU) => SU.stars || [];
  const SUPER_LIFT = 70, SUPER_GONE = 130;
  // Its beats:
  //   cast    the colour starts to go; a breath in; the camera leans in on you
  //   lift    your grains lift and tremble; low rings go out along the ground; light is drawn in
  //   rise    the grains streak up out of the top of the view; the camera pulls back to frame
  //           the whole room and past it; a rising breath
  //   gone    nothing. Then, one by one, points of light wake along the top of the sky
  //   rain    a bell, and the stars fall across everything you can see, in waves that lean with
  //           their wind: near stars long and heavy-headed, far ones short and faint. Each landing
  //           is a small hand-drawn splash of light and a few shards, gone in 8 frames
  //   end     one held frame, a ring and a shock through the picture from you, a bell; the colour
  //           comes back over a second and the camera eases home
  function superEvent(k, e) {
    const bx = fx.bodyX != null ? fx.bodyX : sim.cx, by = fx.bodyY != null ? fx.bodyY : sim.cy, vc = R.viewCells;
    switch (k) {
      case 'start': fx.superView = { cx: cam.x + vc.w / 2, cy: cam.y + vc.h / 2, z: R.zoom }; fx.superDim = fx.superDim || 0; fx.skyGlints = null; break;
      case 'up': A.breathe(false); A.chime(0.35); flashLight(bx, by, 70, true, 40); break;
      case 'rise': A.breathe(true); A.launch(0.9); cam.shake = Math.max(cam.shake, 2); break;
      case 'gone': break;                                                        // silence
      case 'fall': A.toll(); fx.skyGlints = null; break;
      case 'wave': if (e.n > 0) { A.launch(0.3); cam.shake = Math.max(cam.shake, 1.3); } break;
      case 'land': {
        if (e.hit === 'miss' || e.hit === 'boss' || e.hit === 'foe') break;    // the eye and creatures answer with their own events
        const onScreen = e.x > cam.x - 4 && e.x < cam.x + vc.w + 4 && e.y > cam.y - 4 && e.y < cam.y + vc.h + 4;
        if (!onScreen) break;
        if ((fx.starBudget = (fx.starBudget || 0) - 1) >= 0) {
          R.fx.stamp(e.x, e.y, 'starland', 'star', { cool: 1 });
          if ((e.id & 1) === 0) R.fx.ring(e.x, e.y, 1, 6 + (e.id % 4), 'star', 9, { thick: 1, sq: 0.3, l0: 2 });
        }
        for (let j = 0; j < 2; j++) { const b = -Math.PI / 2 + (j ? 0.9 : -0.9) + (Math.random() - 0.5) * 0.5, v = 1.2 + Math.random() * 1.4; R.fx.spark(e.x, e.y - 1, Math.cos(b) * v, Math.sin(b) * v, 'star', 7, { l0: 1, g: 0.28, len: 0.4 }); }
        if (sim.frame - (fx.starSnd || 0) >= 5) { fx.starSnd = sim.frame; A.glance(); }
        if ((e.id % 9) === 0) flashLight(e.x, e.y, 34, true, 4);
        break;
      }
      case 'end': {
        A.toll(); A.chime(1);
        fx.hitstop = Math.max(fx.hitstop, 5); cam.shake = Math.max(cam.shake, 3);
        R.fx.stamp(bx, by - 2, 'crit', 'star', { cool: 2 });
        R.fx.ring(bx, by, 3, 34, 'star', 16, { thick: 1.4, sq: 0.5, l0: 0 });
        R.fx.ring(bx, by + 1, 2, 48, 'star', 20, { thick: 1, sq: 0.25, l0: 2, delay: 4, half: true });
        if (FF && FF.shock) FF.shock(bx, by, 2.4, 4.2);
        flashLight(bx, by, 100, true, 18);
        fx.superEndT = 0;
        break;
      }
    }
  }
  function superStage(SU) {
    if (!SU) {
      fx.superDim = Math.max(0, (fx.superDim || 0) - 0.012); fx.superTen = Math.max(0, (fx.superTen || 0) - 0.015);
      if (fx.superEndT != null && ++fx.superEndT > 70) { fx.superEndT = null; fx.superView = null; }
      return;
    }
    const t = superT(SU), RN = superRain(SU), bx = fx.bodyX != null ? fx.bodyX : SU.bx, by = fx.bodyY != null ? fx.bodyY : SU.by, vc = R.viewCells;
    // the grade: dimmed and drained enough that the stars are the brightest thing, never mud
    const aim = t < SUPER_LIFT ? 0.06 + t / SUPER_LIFT * 0.12 : t < SUPER_GONE ? 0.18 + (t - SUPER_LIFT) / 60 * 0.08 : t < RN.a ? 0.3 : 0.2;
    fx.superDim = (fx.superDim || 0) + (aim - (fx.superDim || 0)) * 0.07;
    fx.superTen = (fx.superTen || 0) + ((t < RN.a ? Math.min(0.32, t / 160) : 0.22) - (fx.superTen || 0)) * 0.06;   // a little drained, never grey
    if (t < SUPER_LIFT) {
      cam.shake = Math.max(cam.shake, t / SUPER_LIFT * 0.8);
      if (t % 22 === 4) R.fx.ring(bx, by + 2, 3, 22 + t * 0.3, 'star', 24, { thick: 1.4, sq: 0.26, l0: 3 });
      if (t % 3 === 0) R.fx.gather(bx, by - 2, 16, 'star', 1);
      if (t === 40) A.harden();
    } else if (t < SUPER_GONE) {
      cam.shake = Math.max(cam.shake, 0.8 + (t - SUPER_LIFT) / 60 * 1.2);
      let n = 0;
      for (let i = (sim.frame * 7) % 4; i < sim.N && n < 40; i += 4) {
        if (!sim.superOf[i] || sim.state[i] !== 1) continue;
        n++; R.fx.streak(sim.px[i], sim.py[i], 0, -1, 2 + Math.min(8, -sim.vy[i] * 1.2), 'star', (i & 3) ? 3 : 1, (i % 9) ? 1 : 2);
      }
    } else if (t < RN.a) {
      // the sky wakes: points of light along the top of the view, one by one, twinkling
      if (!fx.skyGlints) { fx.skyGlints = []; for (let k = 0; k < 30; k++) fx.skyGlints.push({ x: cam.x + 6 + Math.random() * (vc.w - 12), y: cam.y + 3 + Math.random() * 16, at: SUPER_GONE + 2 + Math.random() * (RN.a - SUPER_GONE - 6), big: Math.random() < 0.25 }); }
      for (const g of fx.skyGlints) {
        if (t < g.at) continue;
        const age = t - g.at, lv = age < 2 ? 0 : 2 + ((Math.floor(age / 3) + (g.x | 0)) % 3);
        R.fx.streak(g.x, g.y, 0, 1, g.big ? 1 : 0, 'star', lv);
        if (g.big && age < 10) R.fx.streak(g.x + 1, g.y, -1, 0, 2, 'star', lv + 1);
      }
      if (t === SUPER_GONE + 8 || t === SUPER_GONE + 14) A.glance();
    }
    // the rain: every star a solid streak along its fall; three depths
    for (const q of superStars(SU)) {
      const sp = Math.hypot(q.vx, q.vy) || 1, h = Math.imul(q.id | 0, 2654435761) >>> 0, d = h % 100;
      const len = d < 50 ? 4 + sp * 0.7 : d < 88 ? 7 + sp * 1.1 : 11 + sp * 1.4;
      R.fx.streak(q.x, q.y, q.vx / sp, q.vy / sp, Math.min(22, len), 'star', d < 50 ? 4 : d < 88 ? 1 : 0, d < 88 ? 1 : 2);
    }
    fx.starBudget = 4;                                                          // landings drawn in full per tick (the rest: shards)
  }
  function energyTrails() {
    if (!sim) return;
    const SU = sim.superNow;
    superStage(SU);
    for (const q of sim.bolts || []) {
      if (q.kind === 'shard') {
        // a shard of frozen sand: the crystal itself, a cold streak behind, a ring as it breaks the air
        R.fx.icicle(q.x, q.y, q.a, 7, q.skind, q.size);
        R.fx.spark(q.x - Math.cos(q.a) * 9, q.y - Math.sin(q.a) * 9, -Math.cos(q.a) * 1.5 + (Math.random() - 0.5) * 0.6, -Math.sin(q.a) * 1.5 + (Math.random() - 0.5) * 0.6, 'sand', 12, { g: 0.05, l0: 2 });
        if (q.t === 2) R.fx.ring(q.x, q.y, 2, 9, 'sun', 8, { thick: 2, sq: 0.45, rot: q.a + Math.PI / 2, l0: 3 });
      } else if (q.wait > 0) {
        R.fx.core(q.x, q.y, 1 + (7 - q.wait) * 0.45, 'sun', 2);              // the gathering point swells as the grains arrive
      } else {
        // the bolt: the comet of sand is drawn by the renderer; here only a small warm head and a few sparks
        R.fx.core(q.x, q.y, 2, 'sun', 2);
        if (q.t % 2 === 0) R.fx.spark(q.x - Math.cos(q.a) * 4, q.y - Math.sin(q.a) * 4, -Math.cos(q.a) * (0.8 + Math.random()) + (Math.random() - 0.5) * 0.5, -Math.sin(q.a) * (0.8 + Math.random()) + (Math.random() - 0.5) * 0.5, 'sun', 9, { g: 0.02, l0: 2 });
      }
    }
    // the funnel: only a few embers rising slowly off its surface (the funnel itself does the rest)
    const EX = sim.exitAt;
    if (EX && screen === 'game') {
      const en = sim.enough ? 1 : 0, cx = EX.x, cy = (EX.top != null ? EX.top : EX.y) + 2;
      if (en && sim.frame % 13 === 0) R.fx.spark(cx + (Math.random() - 0.5) * 10, cy, 0, -0.2, 'sun', 26, { g: -0.004, drag: 0.98, l0: 5, len: 0.2 });
    }
    const BS = sim.boss;
    if (BS && BS.hp > 0) {
      for (const st of BS.stones || []) if (st.t > st.warn) {
        if (sim.frame % 2 === 0) R.fx.spark(st.x + (Math.random() - 0.5) * 4, st.y - 4, (Math.random() - 0.5) * 0.3, -0.5, 'dust', 14, { g: 0, l0: 2 });
        if (sim.frame % 3 === 0) R.fx.smoke(st.x, st.y - 6, 1.5, 16, { vy: -0.2, l0: 4 });
      }
      const w = BS.sweep;
      if (w && w.t >= 30) { R.fx.crescent(w.x, 246, w.dir > 0 ? 0 : Math.PI, 9, 'sun', 3, { thick: 4, arc: 1.4 }); if (sim.frame % 2 === 0) R.fx.spark(w.x - w.dir * 3, 246, -w.dir * (1 + Math.random() * 2), -1 - Math.random() * 1.5, 'sun', 12, { l0: 1, g: 0.18 }); }
    }
    // the hammer's shockwaves: a hot crest running along the ground, kicking up sparks, so they read on any floor
    for (const w of sim.shocks || []) {
      const k = 1 - w.t / w.life;
      R.fx.core(w.x, w.y - 3, 1.4 + k * 1.6, 'sun', 2);
      if (sim.frame % 2 === 0) R.fx.spark(w.x - w.d * 2, w.y - 2, -w.d * (0.4 + Math.random() * 0.6), -1.2 - Math.random() * 1.6 * k, 'sun', 10 + Math.random() * 8, { l0: 2, g: 0.2 });
      if (sim.frame % 5 === 0) R.fx.ring(w.x, w.y - 1, 1, 6 + k * 4, 'sun', 7, { thick: 2, sq: 0.35, l0: 3 });
    }
    const H0 = sim.hammer;
    if (H0) {
      // the hammer's head forming: energy drawn into it, a core that swells with the charge
      const pw = Math.min(1, H0.t / (sim.hammerFull || 50));
      if (sim.frame % 3 === 0) R.fx.gather(H0.px, H0.py, 16 + pw * 14, 'sun', 2);
      if (sim.frame % 2 === 0) R.fx.core(H0.px, H0.py, 2 + pw * 4, 'sun', 3);
      if (pw >= 1 && sim.frame % 10 === 0) R.fx.ring(H0.px, H0.py, 3, 14, 'sun', 9, { thick: 2 });
    }
    const I0 = sim.icicles;
    if (I0 && I0.groups.length) {
      // the shards hang in a fan above you, each growing as it forms, every one pointed at the cursor
      for (let k = I0.fire ? I0.fire.k : 0; k < I0.groups.length; k++) {
        const p0 = sim.icicleSlot(k), g = I0.groups[k], grow = Math.max(0, Math.min(1, (sim.frame - (g.born || 0) - 6) / 10));
        const a = Math.atan2(inp.y - p0.y, inp.x - p0.x), bob = Math.sin(sim.frame * 0.05 + k) * 0.6;
        if (grow > 0) R.fx.icicle(p0.x, p0.y + bob, a, 1.5 + 5.5 * grow, g.kind, g.size);
        
      }
    }
    if (sim.frame & 1) return;
    let n = 0;
    for (let i = (sim.frame * 7) % 5; i < sim.N && n < 14; i += 5) {
      if (sim.state[i] !== 1 || !sim.strikeT[i]) continue;
      const v = Math.abs(sim.vx[i]) + Math.abs(sim.vy[i]); if (v < 2.5) continue;
      n++;
      if (sim.superOf[i]) R.fx.trail(sim.px[i], sim.py[i], sim.vx[i], sim.vy[i]);
      else if (sim.waveOf[i]) R.fx.spark(sim.px[i], sim.py[i], sim.vx[i] * 0.15, sim.vy[i] * 0.15, sim.waveOf[i] === 2 ? 'sand' : 'sun', sim.waveOf[i] === 2 ? 10 : 6, { g: 0, l0: sim.waveOf[i] === 2 ? 1 : 4 });
    }
  }
  function anim(name, x, y, flip, rot) { fx.anims.push({ name, x: Math.round(x), y: Math.round(y), flip: !!flip, rot: rot | 0, t: 0 }); if (fx.anims.length > 40) fx.anims.shift(); }
  let lastImpactSound = 0;
  const VF = () => R.fx || { blast() {}, hit() {}, muzzle() {}, quake() {}, gather() {}, trail() {}, ring() {}, rays() {} };
  const popBudget = { f: -1, hit: 0, air: 0, ref: 0, shardAt: [] };
  function handleEvents(t) {
    if (popBudget.f !== sim.frame) { popBudget.f = sim.frame; popBudget.hit = 0; popBudget.air = 0; popBudget.ref = 0; }
    for (const e of sim.events) {
      if (IA && IA.sim === sim) IA.event(e);                                      // the hall's statues listen for hard strikes
      if (FF) FF.event(e);
      if (FA) FA.event(e, sim);
      if (e.type === 'wave') tut.ev[e.long ? 'qtap' : 'ftap'] = true;
      else if (e.type === 'slam' || e.type === 'hammer' || e.type === 'icicleFire' || e.type === 'superUp') tut.ev[e.type] = true;
      if (e.type === 'impact') {
        if (t - lastImpactSound > 0.12) { lastImpactSound = t; A.impact(Math.min(1, e.v / 8)); cam.shake = Math.max(cam.shake, 0.6); }
      } else if (e.type === 'exit') {
        fx.exitPulse = Math.min(1, fx.exitPulse + 0.06);
        A.exitChime(sim.exited);
      } else if (e.type === 'kill') {
        A.lost();
      } else if (e.type === 'launch') {
        A.launch(e.power); cam.shake = Math.max(cam.shake, 1.5 * e.power); tut.launched = true; fx.snapT = 0.2;
      } else if (e.type === 'memory') {
        A.chime(1);
        fx.flash = 0.18; M.cue('still_hours');
      } else if (e.type === 'absorb') {
        if (!fx.stillCue) { fx.stillCue = true; M.cue('still_sand_woken'); }
      } else if (e.type === 'strike') {
        A.strike();                         // the release: sound only, never an impact on yourself
      } else if (e.type === 'stun' && e.kind === 'star') {
        // a star on a creature: a held frame, a small star of light on it, a few shards (many land in a row)
        fx.hitstop = Math.max(fx.hitstop, 1); if (sim.frame - (fx.starStun || 0) > 3) { fx.starStun = sim.frame; A.stun(); }
        const last = fx.starOn || (fx.starOn = new WeakMap()), fo = sim.foes.find((f) => Math.hypot(f.x - e.x, f.y - e.y) < 14);
        if (!fo || sim.frame - (last.get(fo) || -99) > 6) { R.fx.stamp(e.x, e.y - 2, 'crit', 'star', { cool: 3 }); if (fo) last.set(fo, sim.frame); }   // one star of light per creature per 6 frames: the rain never whites it out
        for (let k = 0; k < 3; k++) { const b = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 1.4 + Math.random() * 1.6; R.fx.spark(e.x, e.y - 2, Math.cos(b) * v, Math.sin(b) * v, 'star', 8, { l0: 1, g: 0.25, len: 0.5 }); }
        for (const f of sim.foes) if (Math.hypot(f.x - e.x, f.y - e.y) < 2) fx.whiteT.set(f, 2);
      } else if (e.type === 'stun') {
        // impact frame: the world holds still, the creature flashes white, a ring spreads.
        // the heavier the move, the longer the hold and the bigger the ring
        const heavy = e.kind === 'bury' || e.kind === 'spike', mid = e.kind === 'juggle' || e.kind === 'slam';
        fx.hitstop = Math.max(fx.hitstop, heavy ? 7 : mid ? 4 : 2); A.stun(); A.hit(heavy); cam.shake = Math.max(cam.shake, heavy ? 4 : 1.5);
        if (heavy) anim('slam', e.x, e.y, false);
        anim('lash', e.x, e.y - 5, e.dir < 0);
        // the hit bursts into a spray of sand, thrown away from the blow, and the air flashes
        const d0 = e.dir < 0 ? Math.PI : 0;
        R.spray(e.x, e.y, heavy ? 20 : 10, heavy ? 4.2 : 3.2, d0 - 1.1, d0 + 0.5);
        VF().hit(e.x, e.y, e.dir < 0 ? Math.PI : 0, heavy || mid, e.kind === 'star' ? 'star' : 'sun');
        if (e.kind === 'burst') {
          // the F burst lands: chunky shards of packed sand thrown on along the blow, and a tapering ring (more as a chain builds)
          const cb = fx.combo ? Math.min(3, fx.combo.n - 1) : 0, d1 = e.dir < 0 ? Math.PI : 0;
          for (let k = 0; k < 3 + cb; k++) { const b = d1 + (Math.random() - 0.5) * 1.4, v = 2.2 + Math.random() * 2.2; R.fx.spark(e.x, e.y, Math.cos(b) * v, Math.sin(b) * v - 0.8, 'sand', 12 + Math.random() * 6, { l0: 0, g: 0.24, len: 1.6 }); }
          R.fx.ring(e.x, e.y, 2, 12 + cb * 3, 'sun', 14, { thick: 3 + cb * 0.5, sq: 0.75, l0: 1 });
        }
        flashLight(e.x, e.y, heavy ? 90 : 55, true, heavy ? 9 : 6);
        for (const f of sim.foes) if (Math.hypot(f.x - e.x, f.y - e.y) < 2) fx.whiteT.set(f, 6);
      } else if (e.type === 'bossDrop') {
        for (let x = e.x0; x < e.x1; x += 16) R.fx.smoke(x + Math.random() * 8, e.y - 2, 2, 30, { vy: -0.2, delay: Math.random() * 10 });   // the hours it held, settling on the floor
      } else if (e.type === 'bossHit' && e.star) {
        // a star wounds the open eye. Two styles under test (dev console: starhit calm|strong):
        //   calm    a held frame, a star of light, one ring, six shards, the eye flinches, the bar flashes;
        //           a glass note that climbs with each hit in a run
        //   strong  a longer hold, a second star, a ring and a shock through the picture, a wider throw of
        //           chunky shards, a jolt and a little light on the room; the note with a heavier knock
        const strong = fx.starHitStyle === 'strong';
        sieveAct('hurt'); eyeFlinch(e.x); A.starHit(strong ? 1 : 0); fx.eyeWhite = strong ? 2 : 1;                   // the eye itself flinches white (no blob sprite over it: the star must read)
        fx.hitstop = Math.max(fx.hitstop, strong ? 5 : 3); cam.shake = Math.max(cam.shake, strong ? 4.5 : 2.5);
        R.fx.stamp(e.x, e.y - 4, 'crit', 'star', { cool: 2 });                     // just above the glass, so the star reads against the stone, not on the white eye
        R.fx.ring(e.x, e.y, 2, strong ? 24 : 16, 'star', strong ? 15 : 12, { thick: strong ? 2.6 : 2, l0: strong ? 0 : 1 });
        const nS = strong ? 10 : 6;
        for (let k = 0; k < nS; k++) { const b = (k / nS) * Math.PI * 2 + Math.random() * 0.5, v = (strong ? 2.4 : 1.8) + Math.random() * 2; R.fx.spark(e.x, e.y, Math.cos(b) * v, Math.sin(b) * v - 0.6, k & 1 ? 'star' : 'sand', 10 + Math.random() * 5, { l0: 0, g: 0.2, len: strong ? 1.4 : 0.8 }); }
        if (strong) {
          R.fx.stamp(e.x, e.y - 4, 'crit', 'star', { cool: 3, delay: 4, rot: 0 });
          R.fx.ring(e.x, e.y, 1, 30, 'star', 9, { thick: 1.2, l0: 1, delay: 3 });   // short-lived: gone before it cools to violet
          if (FF && FF.shock) FF.shock(e.x, e.y, 1.0, 3.4);
          fx.flash = Math.max(fx.flash, 0.12);
        }
        flashLight(e.x, e.y, strong ? 90 : 60, true, strong ? 9 : 6);
      } else if (e.type === 'bossGlance' && e.star) {
        // turned aside by a shut eye or its guard: a glance, no wound-style burst
        if (sim.frame - (fx.glanceSnd || 0) > 3) { fx.glanceSnd = sim.frame; A.glance(); }
        for (let k = 0; k < 2; k++) R.fx.spark(e.x + (Math.random() - 0.5) * 6, e.y - 2, (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random()), -1 - Math.random(), 'dust', 9, { l0: 0, g: 0.25, len: 0.7 });
      } else if (e.type === 'bossHit') {
        sieveAct('hurt'); eyeFlinch(e.x);
        fx.hitstop = Math.max(fx.hitstop, e.heavy ? 9 : 6); A.hit(true); cam.shake = Math.max(cam.shake, e.heavy ? 6 : 4); fx.flash = Math.max(fx.flash, e.heavy ? 0.25 : 0.15);
        anim('eye', e.x, e.y, false); fx.eyeWhite = 7; VF().hit(e.x, e.y, -Math.PI / 2, true);
      } else if (e.type === 'slam') {
        // the clump lands like a hammer: a low ring along the ground and a held frame
        cam.shake = Math.max(cam.shake, 2.5 + Math.min(3, e.n / 120));          // the ground shakes; no freeze unless it hits something
        // slams come from any side: the sand bursts back off whatever it struck (up off a floor, sideways off a wall, down off a ceiling)
        const sDown = e.dy == null || e.dy > 0.5, sy = sDown ? groundBelow(e.x, e.y) : e.y, sa = sDown ? -Math.PI / 2 : Math.atan2(-(e.dy || 0), -(e.dx || 0));
        A.impact(1);                                                   // the burst sprite, turned to face off what was struck: fightanim.js
        R.spray(e.x, sy - (sDown ? 2 : 0), 20 + Math.round((e.power || 0) * 30), 3.6 + (e.power || 0) * 2, sa - 1.37, sa + 1.37);
        if (sDown) VF().quake(e.x, sy, 0.5 + (e.power || 0) * 0.6); else VF().blast(e.x, e.y, 0.5 + (e.power || 0) * 0.5, 'sun', sa);
        flashLight(e.x, e.y, 90, true, 8);
      } else if (e.type === 'toll') {
        A.toll(); cam.shake = Math.max(cam.shake, 2.5);
      } else if (e.type === 'ventOut') {
        A.breathe(true);
      } else if (e.type === 'ventIn') {
        A.breathe(false);
      } else if (e.type === 'wave') {
        A.launch(e.long ? 0.8 : 0.5); A.strike(); cam.shake = Math.max(cam.shake, e.long ? 2 : 1.4);
        if (!e.long && VF().punch) VF().punch(e.x, e.y, e.a, sim.body.r || 8);          // a short punch of air; the fan on the real hit arc is fightanim.js (Q waits for its grains)
        if (!e.long) { fx.hitstop = Math.max(fx.hitstop, 2); flashLight(e.x, e.y, 60, true, 5); }
      } else if (e.type === 'teethUp') {
        // the floor bites: stone teeth burst up through a cloud of dust, sparks thrown off their tips
        A.impact(0.9); cam.shake = Math.max(cam.shake, 3);
        for (let x = e.x0; x < e.x1; x += 10) { R.fx.rays(x, e.y - 3, 2, 10 + Math.random() * 8, 'sun', 3, { dir: -Math.PI / 2, spread: 0.6 }); R.fx.smoke(x, e.y - 4, 2.5, 26, { vy: -0.3, vx: (Math.random() - 0.5) * 0.4, delay: 2 }); }
        R.fx.ring((e.x0 + e.x1) / 2, e.y - 1, 2, (e.x1 - e.x0) / 2 + 10, 'sun', 12, { thick: 3, sq: 0.25 });
        flashLight((e.x0 + e.x1) / 2, e.y - 6, 90, true, 7);
      } else if (e.type === 'teethDown') {
        for (let x = e.x0; x < e.x1; x += 14) R.fx.smoke(x, e.y - 3, 2, 22, { vy: -0.15 });
      } else if (e.type === 'lidWarn') {
        sieveAct('lid', { eye: e.eye }); cam.shake = Math.max(cam.shake, 1.5);   // the eye slams shut on its teeth
      } else if (e.type === 'bossOpen') {
        sieveAct('open');
        const E0 = window.SpillBoss.EYES[e.eye]; if (E0) { R.fx.ring(E0.x + E0.w / 2, E0.y - 6, 2, 22, 'frost', 14, { thick: 3 }); R.fx.rays(E0.x + E0.w / 2, E0.y - 6, 6, 18, 'frost', 4); }
        A.exitChime(1); cam.shake = Math.max(cam.shake, 1.2);
      } else if (e.type === 'noAfford') {
        if (!fx.poorT || sim.frame - fx.poorT > 20) { fx.poorT = sim.frame; A.glance(); }   // too little of you to spend on that
      } else if (e.type === 'shed') {
        R.puff(e.x, e.y, Math.min(14, 3 + e.n / 10), 0, 0.3);                 // the part that could not hold on, falling away
      } else if (e.type === 'grainPop') {
        // an attack's grain spends itself: it bursts where it struck, or frays apart in the air
        const ramp = e.shard ? 'sand' : 'sun';
        if (e.how !== 'air') {
          if (popBudget.hit++ < 7) {
            R.fx.core(e.x, e.y, 1.6, ramp, 2);
            for (let k = 0; k < 2; k++) { const b = e.a + Math.PI + (Math.random() - 0.5) * 2.2, v = 1.2 + Math.random() * 2; R.fx.spark(e.x, e.y, Math.cos(b) * v, Math.sin(b) * v - 0.5, ramp, 8 + Math.random() * 8, { l0: 1 }); }
          }
          if (e.shard && !e.quiet) {
            // a shard landing is a small frost blast of its own (one per shard, not per grain)
            popBudget.shardAt = popBudget.shardAt.filter((q) => sim.frame - q.f < 8);
            if (!popBudget.shardAt.some((q) => Math.hypot(q.x - e.x, q.y - e.y) < 14)) {
              popBudget.shardAt.push({ x: e.x, y: e.y, f: sim.frame });
              VF().blast(e.x, e.y, 0.38, 'sun', e.a + Math.PI); A.impact(0.6); cam.shake = Math.max(cam.shake, 2); fx.hitstop = Math.max(fx.hitstop, 2);
              flashLight(e.x, e.y, 60, true, 6);
            }
          }
        } else if (popBudget.air++ < 9) {
          // frays: two motes drift apart and cool through the ramp, an ember lingers
          for (let k = 0; k < 2; k++) { const b = Math.random() * Math.PI * 2; R.fx.spark(e.x, e.y, Math.cos(b) * 0.7, Math.sin(b) * 0.7 - 0.2, ramp, 10 + Math.random() * 8, { g: 0, drag: 0.9, l0: 4, len: 0.6 }); }
          if (Math.random() < 0.4) R.fx.ember(e.x, e.y, (Math.random() - 0.5) * 0.4, -0.25, ramp, 24);
        }
      } else if (e.type === 'reform') {
        // home again: a faint glint drawn into the pile
        if (popBudget.ref++ < 3) R.fx.gather(e.x, e.y, 5, 'sun', 1);
      } else if (e.type === 'crit') {
        // a critical blow: the world holds longer, a white star bursts, and the word is stamped where it landed
        fx.hitstop = Math.max(fx.hitstop, 7); cam.shake = Math.max(cam.shake, 4); fx.flash = Math.max(fx.flash, 0.12); A.hit(true); A.chime(0.7);
        // the star itself is drawn by fightanim.js
        { const near = fx.pops.find((q) => q.crit && q.t < 40 && Math.hypot(q.x - e.x, q.y - e.y + 12) < 28); if (near) near.t = Math.min(near.t, 6); else fx.pops.push({ x: e.x, y: e.y - 12, crit: true, t: 0 }); }   // a volley of crits is one word, not a stack
      } else if (e.type === 'boltBoom') {
        // the bolt bursts: a held frame, a blast, a ring along the ground if it hit low
        const big = e.on !== 'air';
        A.impact(big ? 1 : 0.6); A.hit(big); cam.shake = Math.max(cam.shake, big ? 3.5 : 1.5); if (big) fx.hitstop = Math.max(fx.hitstop, 3);
        const sh = e.kind === 'shard';
        if (sh && big) {
          // the shard shatters: crystal splinters thrown back off what it struck, a cold flash, frost dust
          for (let k = 0; k < 7; k++) { const b = e.a + Math.PI + (Math.random() - 0.5) * 2.6, v = 1.8 + Math.random() * 3.2; R.fx.spark(e.x, e.y, Math.cos(b) * v, Math.sin(b) * v - 1, 'sand', 14 + Math.random() * 12, { l0: 1, len: 1.8, g: 0.22 }); }
          VF().ring(e.x, e.y, 1, 13, 'sun', 11, { thick: 3, l0: 2 });
          for (let k = 0; k < 4; k++) R.fx.smoke(e.x + (Math.random() - 0.5) * 8, e.y + (Math.random() - 0.5) * 4, 2 + Math.random() * 1.5, 26 + Math.random() * 14, { vx: (Math.random() - 0.5) * 0.4, vy: -0.25 });
          fx.hitstop = Math.max(fx.hitstop, 3);
        }
        VF().blast(e.x, e.y, (big ? 0.7 : 0.4) * (sh ? 0.6 : 1), 'sun', e.on === 'wall' ? e.a + Math.PI : null);
        if (big && !sh && sim.terrainSolid(Math.round(e.x), Math.round(e.y) + 4)) VF().quake(e.x, groundBelow(e.x, e.y), 0.3);
        R.spray(e.x, e.y, big ? 16 : 8, 3.5, e.a + Math.PI - 1.2, e.a + Math.PI + 1.2);
        flashLight(e.x, e.y, big ? 80 : 50, true, big ? 8 : 5);
      } else if (e.type === 'icicleForm') {
        A.glance();
        // the shard's grains leap off the heap, one after another, and pack into the spike
        if (e.from) { const k = e.k; e.from.forEach(([x, y, tn], j) => R.stream(x, y, () => sim.icicleSlot(k), 9 + Math.random() * 4, j * 0.8, tn)); }
      } else if (e.type === 'boltLaunch') {
        VF().muzzle(e.x, e.y, e.a, 0.6); A.launch(0.6); cam.shake = Math.max(cam.shake, 1.2);
      } else if (e.type === 'qGather') {
        // Q: the grains rush out of the heap into one point before the bolt flies
        const gx = e.x, gy = e.y; e.from.forEach(([x, y, tn], j) => R.stream(x, y, () => ({ x: gx, y: gy }), 5 + Math.random() * 2, Math.random() * 1.5, tn));
      } else if (e.type === 'icicleFire') {
        A.strike(); flashLight(e.x, e.y, 40, false, 4); VF().rays(e.x, e.y, 2, 7, 'sun', 2, { dir: e.a || 0, spread: 0.5 });
      } else if (SUPER_EVENT[e.type]) {
        superEvent(SUPER_EVENT[e.type], e);
      } else if (e.type === 'hammerSwing') {
        A.launch(1); VF().blast(e.x, e.y, 0.6); flashLight(e.x, e.y, 70, true, 6);
      } else if (e.type === 'hammerCharge') {
        A.breathe(false); if (e.x != null) VF().gather(e.x, e.y, 22, 'sun', 8);
      } else if (e.type === 'hammer') {
        A.impact(1); A.hit(true); A.toll(); anim('slam', e.x, e.y, false); cam.shake = Math.max(cam.shake, 4 + e.power * 4); fx.hitstop = Math.max(fx.hitstop, 3 + Math.round(e.power * 4));
        R.spray(e.x, e.y - 2, 30 + Math.round(e.power * 30), 4 + e.power * 2.5, -Math.PI + 0.15, -0.15);   // the ground throws up a fan of sand
        VF().quake(e.x, e.y, 0.8 + e.power * 0.7); VF().blast(e.x, e.y - 6, 0.4 + e.power * 0.3);
        flashLight(e.x, e.y - 6, 110 + e.power * 60, true, 11);
      } else if (e.type === 'parry') {
        // a PARRY reads unlike a freeze or a missed press: the world holds, a white star with a crisp ring
        // snaps out where the blow was turned, and a short X of ice splinters cracks off it
        A.glance(); A.chime(0.8); A.hit(true); fx.hitstop = Math.max(fx.hitstop, 10); fx.flash = Math.max(fx.flash, 0.25); cam.shake = Math.max(cam.shake, 3);
        R.fx.stamp(e.x, e.y, 'crit', 'frost', { cool: 1 });
        R.fx.ring(e.x, e.y, 2, 20, 'frost', 11, { thick: 1.6, l0: 0 });
        for (const a of [-2.36, -0.79, 0.79, 2.36]) for (let k = 0; k < 2; k++) { const v = 2.2 + k * 1.4; R.fx.spark(e.x + Math.cos(a) * 3, e.y + Math.sin(a) * 3, Math.cos(a) * v, Math.sin(a) * v, 'frost', 9 + k * 3, { l0: 0, g: 0.05, drag: 0.82, len: 1.4 }); }
        if (FF && FF.shock) FF.shock(e.x, e.y, 0.9, 3.4);
        flashLight(e.x, e.y, 70, false, 8);
      } else if (e.type === 'block') {
        A.glance(); anim('guard', e.x, e.y, false); cam.shake = Math.max(cam.shake, 1);
      } else if (e.type === 'guardUp') {
        A.glance();
      } else if (e.type === 'stagger') {
        A.hit(true); fx.hitstop = Math.max(fx.hitstop, e.tier === 'warden' ? 6 : 3);
      } else if (e.type === 'foeDie') {
        A.hit(e.tier === 'warden'); VF().blast(e.x, e.y, e.tier === 'warden' ? 1.8 : 0.45);   // the body comes apart in fightanim.js
        if (e.tier === 'warden') { anim('shatter', e.x, e.y, false); anim('slam', e.x, e.y + 15, false); A.chime(1); fx.hitstop = 14; cam.shake = 6; }
      } else if (e.type === 'wardenWindup') {
        A.warn();
      } else if (e.type === 'wardenStrike') {
        A.launch(0.8); cam.shake = Math.max(cam.shake, 1.5);
      } else if (e.type === 'stamp') {
        A.impact(1); cam.shake = Math.max(cam.shake, 4);
      } else if (e.type === 'dive') {
        A.launch(0.9); cam.shake = Math.max(cam.shake, 1);
      } else if (e.type === 'noThrow') {
        A.glance();                                          // too high to push off: land first
      } else if (e.type === 'shatter') {
        A.glance(); A.hit(false); cam.shake = Math.max(cam.shake, 2);
        anim('shatter', e.x, e.y, false);
      } else if (e.type === 'guardBreak') {
        A.glance(); A.hit(true); A.chime(0.6); fx.hitstop = Math.max(fx.hitstop, 5); fx.eyeWhite = 5; cam.shake = Math.max(cam.shake, 3);
        anim('guard', e.x, e.y, false); VF().blast(e.x, e.y, 0.7, 'frost');
      } else if (e.type === 'combo') {
        if (e.n >= 2) { fx.combo = { n: e.n, bump: 8, fade: 0 }; A.exitChime(40 * Math.min(12, e.n)); }
        if (e.n >= 4) A.chime(Math.min(1, e.n / 8));
      } else if (e.type === 'door') {
        A.impact(0.5); if (e.open) A.chime(0.5);
      } else if (e.type === 'lampLit') {
        A.chime(0.9); fx.flash = Math.max(fx.flash, 0.12);
      } else if (e.type === 'feed') {
        A.exitChime(30);
      } else if (e.type === 'creak') {
        A.glance();
      } else if (e.type === 'shatterGlass') {
        A.glance(); A.impact(0.4);
      } else if (e.type === 'bossGlance') {
        A.glance(); anim('dust', e.x, e.y, false);
      } else if (e.type === 'stoneWarn' || e.type === 'foeWarn' || e.type === 'sweepWarn') {
        A.warn();
        if (e.type === 'stoneWarn' && sim.boss) sieveAct('stone', { a: -Math.PI / 2, x: e.x });
        if (e.type === 'sweepWarn' && sim.boss) sieveAct('sweep', { dir: e.dir || 1 });
      } else if (e.type === 'foeDive') {
        A.launch(0.6);
      } else if (e.type === 'stoneHit') {
        anim('slam', e.x, e.y, false); VF().quake(e.x, e.y, 0.75, 'dust'); VF().blast(e.x, e.y - 4, 0.5); cam.shake = Math.max(cam.shake, 4); fx.hitstop = Math.max(fx.hitstop, 2);
        for (let k = 0; k < 8; k++) { const b = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 2 + Math.random() * 3; R.fx.spark(e.x, e.y - 3, Math.cos(b) * v, Math.sin(b) * v, 'dust', 18, { l0: 2, g: 0.25, len: 1.5 }); }   // rubble
      } else if (e.type === 'dust') {
        anim('dust', e.x, e.y, false);
      } else if (e.type === 'bite') {
        A.lost();
      } else if (e.type === 'bossHalf') {
        A.toll(); A.hit(true); fx.hitstop = Math.max(fx.hitstop, 12); fx.flash = 0.4; cam.shake = 8; M.setSieveIntensity(1); if (e.x != null) VF().blast(e.x, e.y, 1.6);
        startCut('half');                                                        // the anger: a cutscene of its own
      } else if (e.type === 'bossPhase') {
        M.setSieveIntensity(e.phase / 2); cam.shake = Math.max(cam.shake, 4); fx.flash = 0.2; fx.hitstop = 8;
      } else if (e.type === 'bossDown') {
        // the killing blow: the music stops, one toll, a long held impact frame; the death plays as a cutscene
        M.stopSieve(); A.toll(); cam.shake = 6; fx.flash = 0.3; fx.hitstop = 18;
        if (FF && FF.hold) FF.hold(14, 0.9);
        startCut('down');
      } else if (e.type === 'harden') {
        A.harden(); fx.flash = 0.12; tut.hardened = true;
        R.fx.core(e.x, e.y, 3.5, 'frost', 2); R.fx.ring(e.x, e.y, 2, 10, 'frost', 7, { thick: 1, l0: 1 });   // the press answers on its very frame
        // ice locks in: a few crystal spikes snap outward and cold glints scatter
        VF().rays(e.x, e.y, 5, 9 + Math.min(8, (e.n || 0) / 20), 'frost', 4); flashLight(e.x, e.y, 60, false, 6);
        for (let k = 0; k < 6; k++) { const b = Math.random() * Math.PI * 2, v = 0.8 + Math.random() * 1.4; R.fx.spark(e.x, e.y, Math.cos(b) * v, Math.sin(b) * v, 'frost', 10 + Math.random() * 8, { l0: 1, g: 0, drag: 0.88 }); }
      } else if (e.type === 'noFreeze') {
        // pressed while the freeze is still recovering: a small dull tick, so the press is seen to count
        R.fx.ring(e.x, e.y, 1, 6, 'frost', 6, { thick: 1, l0: 6 }); if (sim.frame - (fx.noFrzSnd || 0) > 20) { fx.noFrzSnd = sim.frame; A.glance(); }
      } else if (e.type === 'thaw') {
        // the ice lets go: chips of it fall away from the body and melt into the dark
        const tx = fx.bodyX != null ? fx.bodyX : sim.cx, ty = fx.bodyY != null ? fx.bodyY : sim.cy;
        for (let k = 0; k < 9; k++) R.fx.spark(tx + (Math.random() - 0.5) * 18, ty - 4 + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 1.2, -0.6 - Math.random(), 'frost', 18 + Math.random() * 10, { l0: 2, g: 0.18, len: 0.8 });
      }
    }
    sim.events.length = 0;
  }

  // ---------- props: hand-drawn animated sprites (palette indices, see renderer) ----------
  const LANTERN_TOP = ['...3...', '..3.3..', '...3...', '.12221.', '1344431'];
  const LANTERN_BOT = ['1344431', '.12221.', '..1.1..', '...1...'];
  const LANTERN_FLAME = [
    ['1556551', '1567651', '1578751', '1567651', '1555551'],
    ['1565551', '1576651', '1578751', '1567651', '1555551'],
    ['1556551', '1566751', '1578751', '1567651', '1555551'],
    ['1555551', '1567651', '1578751', '1577651', '1555551'],
  ];
  // A banner of the Keepers: an iron rod, worn red cloth with an hourglass
  // sigil, a tattered hem. It sways a little, more at the bottom.
  const BANNER = [
    '1111111111',
    '.ffeeeeee.',
    '.feeeeeee.',
    '.feeeeeee.',
    '.fe33333e.',
    '.fee333ee.',
    '.feee3eee.',
    '.fee3e3ee.',
    '.fe3eee3e.',
    '.fe33333e.',
    '.feeeeeee.',
    '.feeeeeee.',
    '.fee.eeee.',
    '.feeeee.e.',
    '.fe.eeee..',
    '..e.ee.e..',
    '....e.....',
  ];
  // The Keeper resting on the step, crouched low with his hood bowed and his lantern held
  // down by his knee. Traced at full size from a reference the user made: one even outline,
  // flat planes of cloak, moonlight on his back and hood, the lantern's warmth on his front.
  // He breathes slowly, his hood and back rising a pixel; the flame flickers.
  const KEEPER_SLEEP = [
    '......................................pppppppp..............',
    '......................................pppppppp..............',
    '.................................pppppsrrrrrrspp............',
    '.................................pppssrrrrrrrrssp...........',
    '...............................pppprrrrrrrrrrrrrpp..........',
    '...............................pprrrrrrrrrrrrrrrrrpp........',
    '..........................pppppsrrrrrrrrrrrrrrrrrppp........',
    '..........................pppssrrrrrrrrrqrrrrrrrrrrspp......',
    '........................ppppprrrrrrrrrrqqqrrrrrrrrrrpp......',
    '........................ppppqrrrrrrppppqqqqrrrrrrrrrqppp....',
    '........................ppppqrrrrpppppppqqqrrrrrrrrrptup....',
    '........................ppppppppppppppppqqqrrrrrrrrrtttpp...',
    '.........................pppp...ppppppppqqqqrrrrrruuuuttp...',
    '..........................pp.....ppppppqqqqqrrrrrpuuuuttp...',
    '.................................pppppqqqqqqrrrruuuuuuttp...',
    '...............................ppppppqqqqqqqrruuuuuuuuttp...',
    '...............................ppppppqqqqqqqrpuuuuuuuutpp...',
    '...........................ppppsppppppqqqqqruuuuuuuuuutpp...',
    '..........................pppssrrpppppqqqqqruuuuuuuuuutpp...',
    '..........................psrrrrqqqpppqqqqqpuuuuuuuuuptup...',
    '.......................pppsrrrrrqqqqpppqqqqpuuuuuupppppp....',
    '......................prssrrrrqqqqqqqpqpqqttuuuuup..........',
    '.....................pprrrrrrqqqqqqqqqqppqtppppppp..........',
    '.....................psrrrrrqqqqqqqqqqqqppqttpppppp.........',
    '...................ppsrrrrrqqqqqqpppqqqqpqppttpqqtpp........',
    '...................psrrrrrqqqqqpppppqqqqqqppptppqqt.........',
    '...................psrrrrqqqqqqppppqqqqqqqppppttpp222.......',
    '..................psrrrrqqqqqppppppqqqqqqqqpppppp2...2......',
    '..................psrrrrqqqqqppppppqqqqqqqttpppppp222.......',
    '..................psrrrqqqqqpppppppqqqqqqqqqpppp2222222.....',
    '..................psrrrpqqqqpppppppppqqqqqttpppp3444443.....',
    '................ppsrrrppppppppppqqqqqpqqqqqqttpq3997993.....',
    '................ppqqrppppppppppqqqqqqpppqqqqttpq3978793.....',
    '..............ppsqqqqpppppppppqqqqqqqqqpppqqpptp3988893.....',
    '..............pppqqqpppppppppqqqqqqqqqqpppqppptp3978793.....',
    '.............pppqqqqpppppppppqqqpqqqqqqrtpppqqtt3997993.....',
    '.............ppprqqqppppppppppppppqqqqqqtpppqqqq3444443.....',
    '...........ppprrrqqpppppppppppppppqqqqqttpqpqqqq2222222.....',
    '.......ppppprrrrrqpppppppppppppppppqqqqqtpqqqqttp22222......',
    '......pppprprrrrqppppppppppppppppppqqqttpppqqqqqpp..........',
    '......ppprrrrrqqppppppppppppppppppppqqtppppqqqqqtt..........',
    '...ppppprrrrqppppppppppppppppppppppqqqppppppqqqqtp..........',
    '...pppqqrrrppppppppppppppppppppppppqqtpppppppqqqttpppppppp..',
    'ppppppqppppppppppppppppppppppppppppqqtptppppppqqqqttpp......',
    'pppppppppppppppppppppppppppppppppppqptptpppppppppppppp......',
    '.pppppqppppppppppppppppppppppppppppppppppppppppppppppppp....',
    '..ppppppppppppppppppppppppp..ppppppppppppppppppppppppppp....',
  ];
  // What he is looking at: a small cracked hourglass on the step, sand spilled from the crack
  const SMALL_GLASS = [
    '.44444444444444....',
    '3343333333333333...',
    '.22222222222222....',
    '.3o..........23....',
    '.3o..........23....',
    '.3.o.n......2.3....',
    '.3.o.n......o.3....',
    '.3.o.n......o.3....',
    '.3..o......2..3....',
    '.3...oaaaa2...3....',
    '.3....oaa2....3....',
    '.3....o..2.n..3....',
    '.3...o....n...3....',
    '.3..o......n..3....',
    '.3.o..bbbbn.2.3....',
    '.3.o.bacacb.2.3....',
    '.3.obacaaacb2.3....',
    '.3oaaaaaacaca23....',
    '.3oaaacaaaaaa23....',
    '.44444444444444.b..',
    '3343333333333333ac.',
    '.22222222222222.aab',
  ];
  function glassSprites(p, t) {
    const out = [{ x: p.x, y: p.y, rows: SMALL_GLASS }];
    // a grain running through the neck now and then, and one slipping out of the crack
    if ((t % 1.3) < 0.65) out.push({ x: p.x + 7 + ((t % 2.6) < 1.3 ? 1 : 0), y: p.y + 10 + Math.floor((t % 1.3) * 6), rows: ['d'] });
    const tt = t % 3.1;
    if (tt < 0.6) out.push({ x: p.x + 13 + Math.round(tt * 5), y: p.y + 13 + Math.round(tt * tt * 16), rows: ['a'] });
    return out;
  }
  const KEEPER_SLEEP_FL = KEEPER_SLEEP.map((r) => r.replace(/8/g, '7'));
  function sleeperSprites(p, t) {
    const breath = (Math.sin(t * 1.25 + 1.0) + 1) / 2 > 0.62, fl = Math.sin(t * 9) + Math.sin(t * 13.7) > 0.9;
    const rows = fl ? KEEPER_SLEEP_FL : KEEPER_SLEEP;
    if (!breath) return [{ x: p.x, y: p.y, rows }];
    // breathing in: the hood and back rise a pixel (the row below stretches to meet them)
    return [{ x: p.x, y: p.y + 12, rows: rows.slice(12) }, { x: p.x, y: p.y - 1, rows: rows.slice(0, 13) }];
  }

  // Small ambient life, each on its own timing; quiet, never the focus.
  function ambientSprites(t) {
    const out = [];
    // the hidden memory: a small shard of glass, breathing light
    if (sim.memory && !sim.memory.found) {
      const m = sim.memory, on = Math.sin(t * 1.4) > -0.2;
      out.push({ x: m.x - 1, y: m.y - 4, rows: ['.o.', on ? 'ono' : 'o.o', 'ono', on ? '.n.' : '.o.', '.o.'] });
    }
    for (const a of sim.ambient || []) {
      if (a.kind === 'moth') {
        const x = a.cx + Math.cos(t * a.speed + a.phase) * a.rx + Math.sin(t * 6.3 + a.phase * 3) * 1.6;
        const y = a.cy + Math.sin(t * a.speed * 1.37 + a.phase) * a.ry + Math.cos(t * 5.1 + a.phase) * 1.2;
        out.push({ x: Math.round(x) - 1, y: Math.round(y), rows: [Math.floor(t * 14 + a.phase * 5) % 2 ? 'k.k' : '.k.'] });
      } else if (a.kind === 'drip') {
        const tt = (t + a.offset) % a.period, fall = Math.sqrt(2 * (a.y1 - a.y0) / 220);
        const hang = a.period - fall - 0.25;
        if (tt < hang) { if (tt > hang - 1.2) out.push({ x: a.x, y: a.y0, rows: ['l'] }); }        // a bead gathering
        else if (tt < hang + fall) { const u = tt - hang; out.push({ x: a.x, y: Math.round(a.y0 + 110 * u * u), rows: ['l'] }); }
        else out.push({ x: a.x - 1, y: a.y1, rows: ['l.l'] });                                     // the splash
      } else if (a.kind === 'spider') {
        // creeps along a thread, pausing; never fast
        const step = Math.floor(t * a.speed * 4 + a.phase), frac = Math.min(1, ((t * a.speed * 4 + a.phase) % 1) * 3);
        const pos = ((Math.sin(step * 1.7) + 1) / 2 * (1 - frac) + (Math.sin((step + 1) * 1.7) + 1) / 2 * frac) * a.size * 0.75;
        out.push({ x: a.x + Math.round(a.dir * pos) - 1, y: a.y + Math.round(pos) - 1, rows: ['m.m', '.m.', 'm.m'] });
      }
    }
    return out;
  }

  // ---------- creatures and the Sieve, drawn as palette sprites ----------
  // pale bone shells and one warm eye, so they read against dark stone
  // a sand-eating beetle: pale segmented shell, one warm eye, mandibles,
  // six legs that step; and a hunting bat-thing with wingbeats
  // the Mite: a sand-eating tick the size of a fist. A domed, segmented shell
  // (deep violet into a moonlit rim), a pale belly line, a hooked head with one
  // ember eye and warm mandibles; legs scuttle in two frames
  const MITE_BODY = [
    '......pppppppp......',
    '....ppqqrrrrqqpp....',
    '...pqqrsssssrrqqp...',
    '..pqrrssrrrrrrqqqp..',
    '..pqrrrrprrrrqqqpqp.',
    '.pqqrrrpqqrrqqqpqqmm',
    '.pqqqqpqqqqqqqpqqm7m',
    '.mpppppppppppppmmm8t',
    '..mkkkkkkkkkkkkmmmth',
  ];
  const MITE_LEGS = [['..1..9..1...9..1..9.', '.1..9..1...9..1..9..'], ['...9..1...9..1..9..1', '..9..1...9..1..9..1.']];
  const MITE = [MITE_BODY.concat(MITE_LEGS[0]), MITE_BODY.concat(MITE_LEGS[1])];
  const MITE_EAT = MITE_BODY.slice(0, 6).concat(['.pqqqqpqqqqqqqpqqm7m', '.mpppppppppppppmmmm8', '..mkkkkkkkkkkkkmmtth', '..1..9..1...9..1.tht', '.1..9..1...9..1..9..']);
  // the Diver: a cave bat of sand-dark leather. Ribbed wings (moonlit bones,
  // violet membrane shading darker toward the trailing edge), a small furred
  // body, one ember eye; two wingbeats and a hunched aim pose with the eye white-hot
  const DIVER = [[
    's.....................s',
    'ss...................ss',
    'srs.................srs',
    '.rrss.............ssrr.',
    '.qrrrss...ppp...ssrrrq.',
    '..qqrrrsspqrqpssrrrqq..',
    '...qq.qrrpr7rprrq.qq...',
    '........pmrmrmp........',
    '.........pmmmp.........',
    '..........m.m..........',
  ], [
    '.......................',
    '.......................',
    '..........ppp..........',
    '.......sspqrqpss.......',
    '..ssrrrrrpr7rprrrrrss..',
    '.srrqqqrrpmrmpqrrqqqrs.',
    'srqq..qqrpmmmprqq..qqrs',
    'sq.......pmmmp.......qs',
    's.........m.m.........s',
    '.......................',
  ]];
  const DIVER_AIM = DIVER[0].map((r) => r.replace('r7r', '787'));
  const flipRows = (rows) => rows.map((r) => [...r].reverse().join(''));
  const whiten = (rows) => rows.map((r) => r.replace(/[^.]/g, '8'));
  // ---------- the slingshot, drawn on the world's own pixel grid ----------
  // A strand of sand from the back of the ball to a little pouch. The strand
  // is the strength meter: five segments light from the ball outward, and the
  // whole strand runs hot amber at full power. The path ahead is a fine
  // ribbon of sand with bright stretches flowing along it, ending at a
  // pulsing mark over a shadow where you will land.
  const LAND = [['..d...d..', '.d.....d.', '....b....', '.d.....d.', '..d...d..'], ['.d.....d.', 'd.......d', '....d....', 'd.......d', '.d.....d.']];
  const POUCH = ['.ccc.', 'cbbbc', 'cbdbc', 'cbbbc', '.ccc.'], POUCH_FULL = ['.ccc.', 'c777c', 'c787c', 'c777c', '.ccc.'];
  function strand(out, x0, y0, x1, y1, lit, full, t) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
    const sx = Math.round(nx / nl), sy = Math.round(ny / nl) || 1;      // the shadowed side
    let last = '';
    for (let k = 0; k <= n; k++) {
      const f = k / n, x = Math.round(x0 + (x1 - x0) * f), y = Math.round(y0 + (y1 - y0) * f);
      const key = x + ',' + y; if (key === last) continue; last = key;
      const segLit = f <= lit + 0.001;
      const core = full ? (Math.floor(t * 10 + k * 0.3) % 5 === 0 ? '8' : '7') : segLit ? 'd' : 'b';
      out.push({ x, y, rows: [core], over: true });
      out.push({ x: x + sx, y: y + sy, rows: ['c'], over: true });
    }
  }
  function aimSprites(t) {
    const out = [];
    if (sim.charging && sim.ballCount > 0 && sim.aimPower > 0.05) {
      const pw = sim.aimPower, ballR = Math.sqrt(Math.max(1, sim.ballCount) / Math.PI) * 0.8 + 2, full = pw >= 0.999;
      const sx0 = sim.bx - sim.aimDx * ballR, sy0 = sim.by - sim.aimDy * ballR;
      const len = pw * sim.aimLen * 1.4, ex = sx0 - sim.aimDx * len, ey = sy0 - sim.aimDy * len;
      strand(out, sx0, sy0, ex, ey, Math.floor(pw * 5) / 5, full, t);
      out.push({ x: Math.round(ex) - 2, y: Math.round(ey) - 2, rows: full ? POUCH_FULL : POUCH, over: true });
      fx.lastBand = { sx0, sy0, x: ex, y: ey, level, full };
      if (pw > 0.12) {
        // the path as one continuous ribbon of sand, with bright stretches
        // flowing along it (the way the throw will go), fading toward the end
        const pts = sim.predictArc(90), n = pts.length / 2, cells = [];
        let px0 = Math.round(sim.bx), py0 = Math.round(sim.by);
        for (let k = 0; k < n; k++) {
          const x1 = Math.round(pts[k * 2]), y1 = Math.round(pts[k * 2 + 1]);
          const m = Math.max(Math.abs(x1 - px0), Math.abs(y1 - py0));
          for (let j = 1; j <= m; j++) cells.push([Math.round(px0 + (x1 - px0) * j / m), Math.round(py0 + (y1 - py0) * j / m)]);
          px0 = x1; py0 = y1;
        }
        const skip = Math.round(ballR) + 2, flow = t * 40;
        for (let k = skip; k < cells.length; k++) {
          const f = k / cells.length, ph = ((k - flow) % 14 + 14) % 14;
          const ch = ph < 4 ? (f < 0.75 ? 'd' : 'b') : (f < 0.6 ? 'e' : f < 0.85 ? 'f' : null);
          if (ch) out.push({ x: cells[k][0], y: cells[k][1], rows: [ch] });
        }
        if (n > 1) {
          const lx = Math.round(pts[n * 2 - 2]), ly = Math.round(pts[n * 2 - 1]);
          const L0 = LAND[Math.floor(t * 4) % 2];
          out.push({ x: lx - 4, y: ly - 2, rows: L0, over: true });
          const gy = groundBelow(lx, ly);
          if (gy - ly < 40) out.push({ x: lx - 3, y: gy, rows: ['ccccccc'], over: true });
        }
      }
    } else if (fx.snapT > 0 && fx.lastBand && fx.lastBand.level === level) {
      // released: the strand snaps back into the ball
      const b = fx.lastBand, k = fx.snapT / 0.2;
      strand(out, b.sx0, b.sy0, b.sx0 + (b.x - b.sx0) * k * k, b.sy0 + (b.y - b.sy0) * k * k, 1, false, t);
    }
    return out;
  }
  // ---------- mechanisms, drawn ----------
  // The plate: a brass plate set into the floor, an hourglass engraved on it.
  // Sand covers it; held down, it sinks a pixel and the engraving glows.
  // The gate: an iron portcullis, bars and straps with a spiked bottom
  // edge, rising into its stone frame as it opens.
  function plateRows(w, lit) {
    const top = [], mid = [];
    for (let x = 0; x < w; x++) {
      const c = x - Math.floor(w / 2), rune = Math.abs(c) <= 3 && (Math.abs(c) === 3 || c === 0 || Math.abs(c) === 1);
      top.push(x === 0 || x === w - 1 ? '3' : '4');
      mid.push(x === 0 || x === w - 1 ? '3' : rune ? (lit ? '7' : '3') : '4');
    }
    return [top.join(''), mid.join('')];
  }
  function gateRows(w, h) {
    const rows = [];
    for (let r = 0; r < h; r++) {
      let row = '';
      for (let c = 0; c < w; c++) {
        const bar = c % 3 === 1, strap = r % 12 === 5 || r % 12 === 6, edge = r >= h - 3;
        if (edge) row += (r === h - 1 ? (c % 3 === 1 ? '2' : '.') : bar || r === h - 3 ? '2' : '.');      // spikes at the bottom
        else if (strap) row += r % 12 === 5 ? 's' : '1';
        else row += bar ? (c % 6 === 1 ? 's' : '2') : '1';
      }
      rows.push(row);
    }
    return rows;
  }
  // the bell: bronze, hand-drawn, swinging harder as the toll comes
  const BELL = [
    '....222....',
    '...23332...',
    '..2344432..',
    '..2344432..',
    '.234444432.',
    '.234444432.',
    '23444444432',
    '22222222222',
    '.....3.....',
  ];
  function mechSprites(t) {
    const out = [];
    for (const m of sim.mechs || []) {
      if (m.kind === 'bell') {
        const sw = Math.round(Math.sin(t * 9) * 2.5 * (m.swing || 0));
        out.push({ x: m.x - 5 + sw, y: m.y - 6, rows: BELL });
      }
      if (m.kind === 'vent' && (m.mode === 'in' || m.mode === 'out')) {
        // dust carried along the breath: streaks flowing out, or drawn in
        const n = m.mode === 'out' ? 14 : 9, flow = m.mode === 'out' ? 1 : -1;
        for (let k = 0; k < n; k++) {
          const ph = ((t * (m.mode === 'out' ? 3.2 : 1.6) * flow + k / n) % 1 + 1) % 1, along = ph * m.len * 0.9;
          const off = Math.sin(k * 2.3 + t * 3) * m.width * (0.4 + ph * 0.5);
          const x = Math.round(m.x + m.dir[0] * along - m.dir[1] * off), y = Math.round(m.y + m.dir[1] * along + m.dir[0] * off);
          const streak = m.mode === 'out' ? (Math.abs(m.dir[0]) ? ['ddb'] : ['d', 'd', 'b']) : ['c'];
          out.push({ x, y, rows: streak });
        }
      }
      if (m.kind === 'spikeWall' && m.ready) {
        // the teeth's base: an iron rail set into the wall face, a dark socket under every tooth,
        // a brass rivet now and then, and its back edge ragged where the stone was cut for it
        const rows = [], face = m.side > 0 ? 1 : 0, back = 1 - face;
        for (let y = m.y0 - 1; y <= m.y1; y++) {
          const ph = (y - m.y0) % 4, hsh = ((y * 73856093) >>> 0) % 7, r = ['.', '.'];
          r[face] = y < m.y0 || y >= m.y1 ? '2' : ph === 1 ? '1' : ph === 3 ? '9' : '2';
          r[back] = (y - m.y0) % 16 === 6 ? '3' : hsh === 0 ? '.' : '9';
          rows.push(r.join(''));
        }
        out.push({ x: m.x - (m.side > 0 ? 2 : -1), y: m.y0 - 1, rows });
      }
      if (m.kind === 'plate') {
        const rows = plateRows(m.w, m.pressed);
        out.push({ x: m.x, y: m.y - 2 + (m.pressed ? 1 : 0), rows });
        const d = m.door, shown = d.h - (d.openRows || 0);
        if (shown > 0) out.push({ x: d.x, y: d.y, rows: gateRows(d.w, d.h).slice(d.h - shown), onIron: true });
      }
    }
    return out;
  }
  function animSprites() {
    const out = [];
    for (const a of fx.anims) {
      const f = window.SpillImpacts.frameOf(a.name, a.t, a.flip, a.rot);
      if (f) out.push({ x: a.x - f.ax, y: a.y - f.ay, rows: f.rows, over: true });
    }
    return out;
  }
  // where the ground is under a point (for anchoring ground impacts)
  function groundBelow(x, y) {
    let gy = Math.round(y);
    while (gy < sim.H - 1 && !sim.terrainSolid(Math.round(x), gy + 1)) gy++;
    return gy;
  }
  const GNAT = [['.b.', 'b.b'], ['b.b', '.b.']];
  const WARDEN_FRAME = { idle: (t) => (Math.floor(t * 1.6) % 2 ? 'idle1' : 'idle0'), walk: (t) => (Math.floor(t * 5) % 2 ? 'walk1' : 'walk0'),
    windup: { cleave: 'cleaveUp', lunge: 'lungeLow', stamp: 'stampUp' }, active: { cleave: 'cleave', lunge: 'lunge', stamp: 'stamp' } };
  function foeSprites(t) {
    const out = [];
    for (const f of sim.foes) {
      if (f.dead) continue;
      let rows, ax, ay;
      if (f.kind === 'warden') {
        const A = window.SpillWardenArt;
        let name = f.mode === 'stagger' ? 'stagger' : f.mode === 'guard' ? 'guard' : f.mode === 'windup' ? WARDEN_FRAME.windup[f.atkName]
          : f.mode === 'active' ? WARDEN_FRAME.active[f.atkName] : f.mode === 'recover' ? (f.t < 14 ? WARDEN_FRAME.active[f.atkName] : 'idle0')
          : f.mode === 'walk' ? WARDEN_FRAME.walk(t) : WARDEN_FRAME.idle(t);
        rows = A.frames[name]; ax = A.fx; ay = A.fy;
        if (f.mode === 'windup' && f.t > 0 && Math.floor(f.t / 3) % 2) rows = rows.map((r) => r.replace(/7/g, '8'));   // the eye flares before it strikes
      } else if (f.kind === 'gnat') {
        rows = GNAT[Math.floor(t * 14 + f.phase) % 2];
        if (f.carry) rows = rows.concat(['.d.']);
      } else if (f.kind === 'mite' || f.kind === 'dummy') rows = f.mode === 'eat' ? MITE_EAT : MITE[Math.floor(t * (f.mode === 'hunt' ? 10 : 5)) % 2];
      else rows = f.mode === 'aim' ? (Math.floor(f.t / 4) % 2 ? DIVER_AIM : DIVER[0]) : DIVER[Math.floor(t * 8) % 2];
      if (f.kind !== 'warden' && f.stun > 0) rows = rows.slice().reverse();         // knocked over
      if (f.dir < 0) { rows = flipRows(rows); if (ax != null) ax = rows[0].length - 1 - ax; }
      if (f.hurtT > 6 || fx.whiteT.has(f)) rows = whiten(rows);                    // the impact frame
      const w = rows[0].length;
      const x = ax != null ? Math.round(f.x - ax) : Math.round(f.x - w / 2), y = ay != null ? Math.round(f.y - ay) : Math.round(f.y - rows.length + 1);
      out.push({ x: x + (FA ? FA.note(f, rows, x, y) : 0), y, rows, over: true });
      if (f.mode === 'stagger' || (f.kind !== 'warden' && f.stun > 0)) {          // dizzy: motes circling its head
        const d = window.SpillImpacts.frameOf('dizzy', Math.floor(t * 60), false), top = f.kind === 'warden' ? 44 : 15;
        out.push({ x: Math.round(f.x) - d.ax, y: Math.round(f.y - top) - d.ay, rows: d.rows, over: true });
      }
      if (f.kind === 'warden' && f.mode === 'active' && f.atkName === 'stamp' && f.waves) for (const wv of f.waves) if (wv.d) {
        out.push({ x: Math.round(wv.x) - 3, y: Math.round(f.y) - 4, rows: Math.floor(t * 20) % 2 ? ['..d....', '.dbd.d.', 'dbabdbd', 'ccccccc'] : ['....d..', '.d.dbd.', 'dbdbabd', 'ccccccc'], over: true });
      }
    }
    return out;
  }
  // the hammer's shockwaves: a crest of sand thrown up, running along the ground
  const SHOCK = [['...d...', '..dbd..', '.dbabd.', 'dbaaabd', 'ccccccc'], ['..d.d..', '.dbdbd.', 'dbaaabd', 'baaaaab', 'ccccccc'], ['.......', '.d...d.', 'dbd.dbd', 'baabaab', 'ccccccc']];
  function meleeSprites(t) {
    const out = [];
    // the super's falling stars: each trails a short streak of fading sand
    if (sim.superNow) for (let i = 0; i < sim.N; i += 2) {
      if (!sim.superOf[i] || sim.state[i] !== 1 || !sim.strikeT[i]) continue;
      const vx = sim.vx[i], vy = sim.vy[i], v = Math.hypot(vx, vy) || 1;
      for (let k = 1; k <= 4; k++) out.push({ x: Math.round(sim.px[i] - vx / v * k * 1.6), y: Math.round(sim.py[i] - vy / v * k * 1.6), rows: [k === 1 ? '8' : k === 2 ? 'd' : k === 3 ? 'b' : 'c'], over: true });
    }
    for (const w of sim.shocks || []) {
      const rows = SHOCK[Math.min(2, Math.floor(w.t / Math.max(1, w.life / 3)))];
      out.push({ x: Math.round(w.x) - 3, y: Math.round(w.y) - 4, rows: w.d < 0 ? flipRows(rows) : rows, over: true });
    }
    return out;
  }
  // an eye of the Sieve: a stone slit when shut; when open, a pale iris whose
  // pupil follows your sand (a slit while it is guarded)
  // The Sieve's eyes (art pass): glass set in an iron socket. Shut, a heavy lid with a seam of
  // light; open, an almond of glass that is darker at its rim and lit at its heart, with a slit
  // pupil while its guard is up (it is watching) that opens round when it can be hurt, and one
  // glint. After the half-life the glass burns red-hot. 15 wide, centred on the eye's plate.
  const EYE_OPEN = [
    '.....11111.....',
    '...112222211...',
    '..12sooooos21..',
    '.12oonnnnnoo21.',
    '12sonnnnnnnos21',
    '.12oonnnnnoo21.',
    '..12sooooos21..',
    '...112222211...',
    '.....11111.....',
  ];
  const EYE_SHUT = ['....1111111....', '..11222222211..', '.12rrrrrrrrr21.', '..11222222211..', '....1111111....'];
  const EYE_HOT = { o: 'e', n: '5', r: '6', s: 'f' };
  function eyeRows(open, guard, look, white, hot) {
    if (hot && !white) return eyeRows(open, guard, look, false, false).map((r) => r.replace(/[onrs]/g, (c) => EYE_HOT[c]));
    if (!open) return EYE_SHUT;
    const pc = Math.max(5, Math.min(9, Math.round(7 + look * 2)));            // the pupil follows your sand
    const out = EYE_OPEN.map((r, y) => [...r].map((ch, x) => {
      if (ch !== 'n' && ch !== 'o') return ch;
      if (guard) { if (x === pc && y >= 2 && y <= 6) return 'u'; }              // a slit: on guard
      else if ((y === 4 && Math.abs(x - pc) <= 1) || ((y === 3 || y === 5) && x === pc)) return 'u';   // round: open to a blow
      if (y === 3 && x === pc + (guard ? 1 : 2)) return 's';                     // the glint
      return ch;
    }).join(''));
    return white ? whiten(out) : out;
  }
  // a falling stone: a broken lump of the ceiling, its own shape every time (from where it fell),
  // dark-edged, lit on its upper left, turning a quarter as it falls
  const ROCKS = new Map();
  function rockRows(seed, small) {
    const key = seed * 2 + (small ? 1 : 0);
    if (ROCKS.has(key)) return ROCKS.get(key);
    const R0 = small ? 2.2 : 3.4, n = small ? 5 : 8, h = (k) => { const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
    const rad = Array.from({ length: 8 }, (_, k) => R0 * (0.75 + 0.45 * h(k)));
    const rows = [];
    for (let y = 0; y < n; y++) {
      let row = '';
      for (let x = 0; x < n; x++) {
        const dx = x - (n - 1) / 2, dy = y - (n - 1) / 2, a = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) * 8, i0 = Math.floor(a) % 8, f = a - Math.floor(a);
        const r = rad[i0] * (1 - f) + rad[(i0 + 1) % 8] * f, d = Math.hypot(dx, dy);
        row += d > r ? '.' : d > r - 1 ? '1' : (dx + dy < -1.5 ? 'h' : dx + dy > 2 ? '9' : '2');
      }
      rows.push(row);
    }
    ROCKS.set(key, rows);
    return rows;
  }
  function turnRows(rows, k) {
    let r = rows;
    for (let i = 0; i < (k & 3); i++) r = r[0].split('').map((_, c) => r.map((row) => row[c]).reverse().join(''));
    return r;
  }
  // The half-life breaks the Sieve's ring (art pass): cracks open from a handful of points and
  // creep across the stone over a few seconds, each a jagged walk of its own (no two alike), a
  // void line with a dull red heat deep in it and a lit lip on its upper side. They are laid out
  // once per fight and revealed by age, so they spread, never pop.
  const SIEVE_C = { x: 240, y: 132, r: 96 };
  function sieveCrackPaths() {
    if (fx.sieveCracks && fx.sieveCracks.sim === sim) return fx.sieveCracks;
    const paths = [], rnd = (() => { let a = 0x9e3779b9 ^ (seedN * 2654435761); return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return ((a >>> 0) % 10000) / 10000; }; })();
    // cracks run across the ring's band, outer edge inward, jagged, in loose clusters; a few
    // run on into the turning grate's rim; some fork sideways once
    const starts = 9 + Math.floor(rnd() * 4);
    for (let k = 0; k < starts; k++) {
      let a = (k / starts) * Math.PI * 2 + (rnd() - 0.5) * 0.5, r = SIEVE_C.r - 1;
      const pts = [], len = 7 + Math.floor(rnd() * 6) + (rnd() < 0.3 ? 5 : 0);
      for (let i = 0; i < len; i++) {
        const x = Math.round(SIEVE_C.x + Math.cos(a) * r), y = Math.round(SIEVE_C.y + Math.sin(a) * r);
        if (!pts.length || pts[pts.length - 1].x !== x || pts[pts.length - 1].y !== y) pts.push({ x, y });
        r -= 1; a += (rnd() - 0.5) * 0.035 + (rnd() < 0.2 ? (rnd() < 0.5 ? -1 : 1) * 0.02 : 0);
        if (i === 3 && rnd() < 0.5) {                                          // a fork, running along the band a little
          let ba = a, br = r; const bp = [], side = rnd() < 0.5 ? -1 : 1;
          for (let j = 0; j < 4 + Math.floor(rnd() * 4); j++) { ba += side * 0.012; br -= rnd() < 0.4 ? 1 : 0; const bx = Math.round(SIEVE_C.x + Math.cos(ba) * br), by = Math.round(SIEVE_C.y + Math.sin(ba) * br); if (!bp.length || bp[bp.length - 1].x !== bx || bp[bp.length - 1].y !== by) bp.push({ x: bx, y: by }); }
          paths.push({ pts: bp, delay: 30 + k * 9 });
        }
      }
      paths.push({ pts, delay: k * 9 + Math.floor(rnd() * 12) });
    }
    return (fx.sieveCracks = { sim, paths });
  }
  function sieveCracks() {
    const age = fx.halfAge || 0, out = [];
    for (const P of sieveCrackPaths().paths) {
      const n = Math.min(P.pts.length, Math.max(0, Math.floor((age - P.delay) * 0.2)));
      for (let i = 0; i < n; i++) {
        const q = P.pts[i], fresh = n - i <= 2 && n < P.pts.length;
        out.push({ x: q.x, y: q.y, rows: [fresh ? 's' : i === 2 ? 'e' : 'u'], over: true });                          // a void line, hot deep in its throat
        if (i < 3) out.push({ x: q.x + 1, y: q.y, rows: ['u'], over: true });                                             // wider where it broke
        if (q.y > SIEVE_C.y) out.push({ x: q.x - 1, y: q.y, rows: ['s'], over: true }); else out.push({ x: q.x, y: q.y + 1, rows: ['s'], over: true });   // its lit lip, the side the moon catches
      }
    }
    return out;
  }
  // ---------- distant machinery (art pass, a first trial: one gear, one pendulum, the Proving Hall) ----------
  // The Tower's works, glimpsed behind the walls: drawn only in the two darkest iron tones, a
  // shade off the wall behind them, painted only on open background (never on anything you stand
  // on), placed high in open wall well above any path, and slow (the gear turns once in about two
  // minutes, the pendulum swings once in seven seconds) so they never ask to be looked at or read
  // as a hazard. Each is drawn on its own: the gear's teeth, spokes and hub are its own shape.
  const MACHINES = {
    hall: [
      { kind: 'gear', x: 300, y: 185, r: 21, teeth: 16, spokes: 6, hub: 5, speed: 0.05 },
      { kind: 'pendulum', x: 560, top: 150, len: 58, bob: 6, swing: 0.16, period: 7.2 },
    ],
    // the Sieve's hall: the works that turn it, glimpsed in the top corners, well above the fight
    sieve: [
      { kind: 'gear', x: 412, y: 54, r: 24, teeth: 18, spokes: 6, hub: 5, speed: 0.035 },
      { kind: 'gear', x: 377, y: 34, r: 12, teeth: 9, spokes: 4, hub: 3, speed: -0.07 },        // meshing with it, turning the other way
      { kind: 'gear', x: 136, y: 44, r: 17, teeth: 13, spokes: 5, hub: 4, speed: -0.022 },
      { kind: 'chain', x: 160, top: 16, len: 46, end: 'hook', seed: 2 },
      { kind: 'chain', x: 350, top: 16, len: 58, end: 'ring', seed: 5 },
      { kind: 'chain', x: 452, top: 16, len: 104, end: 'broken', seed: 9 },
    ],
  };
  function machineSprites(t) {
    if (screen !== 'game' || dbg.noMach) return [];                                   // (dbg.noMach: test hook, to time the frame without them)
    const Lv = currentLevel(), list = Lv.boss ? MACHINES[Lv.id] : inWorld() ? MACHINES[run.world && run.world.room] : null; if (!list) return [];
    const out = [];
    for (const M0 of list) {
      if (M0.kind === 'gear') {
        const a0 = t * M0.speed, R2 = M0.r + 3;
        for (let dy = -R2; dy <= R2; dy++) for (let dx = -R2; dx <= R2; dx++) {
          const d = Math.hypot(dx, dy); if (d > R2 + 0.2) continue;
          const a = Math.atan2(dy, dx) - a0, ta = ((a / (Math.PI * 2) * M0.teeth) % 1 + 1) % 1;
          let ch = null;
          if (d > M0.r) { if (ta < 0.45) ch = d > M0.r + 2 ? '9' : '1'; }                  // the teeth (square, a shade lighter at their tips)
          else if (d > M0.r - 3.2) ch = d > M0.r - 1.2 ? '9' : '1';                         // the rim: a heavy band with a lit outer edge
          else if (d <= M0.hub) ch = d <= 1.5 ? '9' : '1';                                  // the hub and its axle
          else { const sa = ((a / (Math.PI * 2) * M0.spokes) % 1 + 1) % 1; if (Math.abs(sa - 0.5) * (Math.PI * 2 / M0.spokes) * d < 1.3) ch = '1'; }   // the spokes
          if (ch === '1' && dx + dy < -M0.r * 0.9 && d > M0.r - 2.2) ch = '9';              // the faintest catch of light on the upper-left rim
          if (ch) out.push({ x: Math.round(M0.x + dx), y: Math.round(M0.y + dy), rows: [ch] });
        }
      } else if (M0.kind === 'chain') {
        // a chain from the vault: links alternating face-on and edge-on, each chain its own length and
        // its own end, barely swaying (its lowest links move a pixel at most, slowly)
        const sway = Math.sin(t * 0.6 + M0.seed) * 1.2;
        for (let k = 0; k < M0.len; k++) {
          const f = k / M0.len, x = Math.round(M0.x + sway * f * f), y = M0.top + k, link = Math.floor(k / 3) % 2;
          if (link === 0) { if (k % 3 !== 1) out.push({ x, y, rows: ['1'] }); else out.push({ x: x - 1, y, rows: ['1.1'] }); }   // a face-on link, open in the middle
          else out.push({ x, y, rows: [k % 3 === 1 ? '9' : '1'] });                                                             // an edge-on link
        }
        const ex = Math.round(M0.x + sway), ey = M0.top + M0.len;
        if (M0.end === 'hook') out.push({ x: ex - 1, y: ey, rows: ['.1.', '.1.', '1.1', '11.'] });
        else if (M0.end === 'ring') out.push({ x: ex - 2, y: ey, rows: ['.111.', '1...1', '1...1', '.111.'] });
        else out.push({ x: ex, y: ey, rows: ['1', '.', '9'] });                   // broken: a last link hanging loose
      } else if (M0.kind === 'pendulum') {
        let ceil = M0.top; while (ceil > 1 && !sim.terrainSolid(M0.x, ceil - 1)) ceil--;
        const ang = Math.sin(t * Math.PI * 2 / M0.period) * M0.swing, ex = M0.x + Math.sin(ang) * M0.len, ey = M0.top + Math.cos(ang) * M0.len;
        for (let y = ceil; y < M0.top; y++) out.push({ x: M0.x, y, rows: ['1'] });         // its hanger
        const n = Math.ceil(M0.len);
        for (let k = 0; k <= n; k++) { const f = k / n; out.push({ x: Math.round(M0.x + (ex - M0.x) * f), y: Math.round(M0.top + (ey - M0.top) * f), rows: ['1'] }); }
        for (let dy = -M0.bob; dy <= M0.bob; dy++) for (let dx = -M0.bob; dx <= M0.bob; dx++) {   // the bob: a disc with a darker ring
          const d = Math.hypot(dx, dy); if (d > M0.bob + 0.2) continue;
          out.push({ x: Math.round(ex + dx), y: Math.round(ey + dy), rows: [d > M0.bob - 1.2 ? '9' : '1'] });
        }
      }
    }
    return out;
  }
  // The Sieve's rim: a hard one-pixel line just outside its ring, dark, with a short band of light
  // that steps round it (a few pixels at a time, every few frames); after the half-life the band
  // burns red and moves quicker. No blur, no halo.
  function sieveRimSprites() { return []; }                                       // (the glyph band, chain and heartbeat round the grate were taken off: the eye is the boss, and its ring is round the eye: see eyeAnimSprites)

  // the glyphs of its ring, each drawn by hand on a 5x5 grid (no two alike)
  // the glyphs of the eye's ring: a carved alphabet after the runic letters, 5 x 7, one-pixel strokes and true diagonals,
  // each drawn by hand (runes with unwelcome modern meanings left out)
  const SIEVE_GLYPHS = [
    ['.#.#.',  '.##..',  '.#.#.',  '.##..',  '.#...',  '.#...',  '.#...'],
    ['.###.',  '.#..#',  '.#..#',  '.#..#',  '.#..#',  '.#..#',  '.#..#'],
    ['.#...',  '.##..',  '.#.#.',  '.#..#',  '.#.#.',  '.##..',  '.#...'],
    ['.##..',  '.#.#.',  '.#.#.',  '.##..',  '.#.#.',  '.#..#',  '.#..#'],
    ['.....',  '...#.',  '..#..',  '.#...',  '..#..',  '...#.',  '.....'],
    ['.....',  '#...#',  '.#.#.',  '..#..',  '.#.#.',  '#...#',  '.....'],
    ['.##..',  '.#.#.',  '.##..',  '.#...',  '.#...',  '.#...',  '.#...'],
    ['#...#',  '#...#',  '##..#',  '#.#.#',  '#..##',  '#...#',  '#...#'],
    ['..#..',  '..#..',  '.##..',  '..#..',  '..##.',  '..#..',  '..#..'],
    ['.....',  '.#...',  '#.#..',  '.#.#.',  '..#.#',  '...#.',  '.....'],
    ['..##.',  '..#..',  '..#..',  '..#..',  '..#..',  '..#..',  '.##..'],
    ['#.#..',  '##...',  '#....',  '#....',  '#....',  '##...',  '#.#..'],
    ['.##..',  '.#.#.',  '.##..',  '.#.#.',  '.#..#',  '.#.#.',  '.##..'],
    ['#...#',  '##.##',  '#.#.#',  '#...#',  '#...#',  '#...#',  '#...#'],
    ['##...',  '#.#..',  '#..#.',  '#....',  '#....',  '#....',  '#....'],
  ];


  // The Sieve's body language (art pass): what it does is shown by its ring, its eyes and its
  // heart, since the stone itself cannot move. Idle: the ring breathes and turns, the open eye
  // blinks now and then. Before a stone falls, the top of the ring leans out and burns; before the
  // floor bites, the side over the bite does; before the blade sweeps, the ring winds back, then is
  // flung round. Wounded: the glyphs scatter and settle. An eye opening flashes the whole ring.
  function sieveAct(kind, o) { fx.sieveAct = Object.assign({ kind, t: 0 }, o || {}); }
  function eyeFlinch(x) { const E = window.SpillBoss.EYES; let best = 0, bd = 1e9; E.forEach((e, k) => { const d = Math.abs(e.x + 14 - x); if (d < bd) { bd = d; best = k; } }); const st = eyeState(best); st.flinch = 8; st.fdir = x < E[best].x + 14 ? 1 : -1; }
  function sieveAnimStep() {
    eyeAnimStep();
    const B = sim.boss; if (!B) return;
    if (fx.sieveAct) { fx.sieveAct.t++; if (fx.sieveAct.t > 90) fx.sieveAct = null; }
    const A0 = fx.sieveAct, base = (B.half ? 0.0045 : 0.0022) * (B.hp > 0 ? 1 : 0);
    let v = base;
    if (A0 && A0.kind === 'sweep') v = A0.t < 34 ? -0.012 : A0.t < 60 ? 0.05 * (1 - (A0.t - 34) / 26) + base : base;   // wound back, then flung round
    fx.ringA = (fx.ringA || 0) + v * (A0 && A0.dir ? A0.dir : 1);
    fx.chainA = (fx.chainA || 0) + v * 2.2;
    // a new bite on the floor: the ring leans toward it
    const nb = (B.bites || []).length;
    if (nb > (fx.biteN || 0)) { const b2 = B.bites[nb - 1], sec = window.SpillBoss.SECTIONS[b2.sec]; sieveAct('bite', { a: Math.PI / 2, bx: (sec[0] + sec[1]) / 2 }); }
    fx.biteN = nb;
  }

  // ---------- THE EYE (art pass): the boss itself, animated ----------
  // Each eye is drawn fresh every frame from its own state, not picked from a few fixed pictures:
  //   idle     it hovers a pixel up and down; its gaze darts between points in quick snaps (saccades)
  //            and holds; it blinks now and then; its iris pulses
  //   shut     its lid twitches; now and then it cracks open a slit and peeks round, then shuts
  //   opening  the lid rolls open over a few frames (and shut again the same way), the pupil wide
  //   attack   before a stone falls it glares up, pupil a slit, squinting and trembling; before the
  //            floor bites it stares down at the spot; before the blade sweeps it tracks the blade;
  //            before its own shut-eye teeth it slams shut with a shake
  //   hurt     it flinches half-shut and recoils a pixel away from the blow
  //   anger    (after the half-life) veins creep through its glass and its iris burns red
  //   its ring a small ring of hand-drawn glyphs opens round the open eye and turns, burning on the
  //            side an attack comes from
  function eyeState(k) { const E0 = fx.eyes || (fx.eyes = []); return E0[k] || (E0[k] = { lid: 0, px: 0, py: 0, jx: 0, jy: 0, sacc: 20 + k * 17, blink: 90 + k * 41, blinkHold: 0, peek: 320 + k * 150, peekT: 0, flinch: 0, fdir: 0, step: 0 }); }
  function eyeAnimStep() {
    const B = sim.boss; if (!B) return;
    const E = window.SpillBoss.EYES, A0 = fx.sieveAct, aT = A0 ? A0.t : 99;
    E.forEach((e, k) => {
      const st = eyeState(k), cx = e.x + 14, cy = e.y - 6;
      const wantOpen = (k === B.open || (fx.cut && k < (fx.cut.eyes || 0))) && B.hp > 0;
      let lidT = wantOpen ? 4 : 0;
      if (wantOpen) { if (--st.blink < 0) { st.blinkHold = 4; st.blink = 150 + Math.random() * 140; } if (st.blinkHold > 0) { st.blinkHold--; lidT = 0; } }
      else if (B.hp > 0) { if (--st.peek < 0) { st.peekT = 56; st.peek = 380 + Math.random() * 320; } if (st.peekT > 0) { st.peekT--; lidT = 1; } }
      const windup = A0 && (A0.kind === 'stone' || A0.kind === 'bite' || A0.kind === 'sweep') && aT < 50;
      if (wantOpen && windup) lidT = Math.min(lidT, 2.5);
      if (A0 && A0.kind === 'lid' && A0.eye === k && aT < 16) lidT = 0;                          // slams shut
      if (st.flinch > 0) { st.flinch--; lidT = Math.min(lidT, 1); }
      const sp = lidT < st.lid ? (A0 && A0.kind === 'lid' ? 1.5 : 0.8) : 0.5;                   // opens over ~8 frames, shuts faster
      st.lid += Math.max(-sp, Math.min(sp, lidT - st.lid));
      // where it looks: at your sand, with darting saccades, or at what it is about to do
      let tx = Math.max(-3, Math.min(3, (B.lookX - cx) / 30)), ty = Math.max(-1, Math.min(1, (B.lookY - cy) / 30));
      if (--st.sacc < 0) { st.sacc = 24 + Math.random() * 70; st.jx = Math.round((Math.random() - 0.5) * 3); st.jy = Math.round((Math.random() - 0.5) * 2); }
      tx += st.jx; ty += st.jy;
      if (windup && A0.kind === 'stone') { tx = A0.x != null ? Math.max(-3, Math.min(3, (A0.x - cx) / 30)) : 0; ty = -1; }
      if (windup && A0.kind === 'bite') { tx = Math.max(-3, Math.min(3, (A0.bx - cx) / 30)); ty = 1; }
      if (B.sweep) { tx = Math.max(-3, Math.min(3, (B.sweep.x - cx) / 30)); ty = 1; }
      if (st.peekT > 0) { tx = Math.round(Math.sin(st.peekT * 0.25) * 3); ty = 0; }
      tx = Math.max(-3, Math.min(3, Math.round(tx))); ty = Math.max(-1, Math.min(1, Math.round(ty)));
      if (st.px !== tx) st.px += Math.sign(tx - st.px);                                            // a snap: a pixel a frame
      if (st.py !== ty) st.py += Math.sign(ty - st.py);
      st.shake = windup && Math.floor(aT / 2) % 2 ? 1 : (st.flinch > 0 ? st.fdir : 0) * (st.flinch % 2);
      st.wide = wantOpen && st.lid < 3.9 && lidT === 4 ? 1 : 0;                                   // the pupil wide as it opens
    });
    wingStep(B);
  }
  // THE WINGS' CLOCK: one sprout per fight. It runs while the open eye is open and angry and pauses
  // (never rewinds) when it shuts; once the wings are out they stay out, and a newly opened eye takes
  // them up with a quick white flash instead of growing them again.
  function wingStep(B) {
    if (!B.half || B.hp <= 0) { if (!B.half) { fx.wingT = 0; fx.wingDone = false; fx.wingShow = false; } return; }
    const oe = B.open >= 0 ? eyeState(B.open) : null, showing = !!(oe && oe.lid / 4 > 0.6);
    if (!fx.wingDone) { if (showing) { fx.wingT = (fx.wingT || 0) + 1; wingFx(fx.wingT, B.open); if (fx.wingT >= 110) fx.wingDone = true; } }
    else if (showing && !fx.wingShow) { fx.wingFlash = 6; A.chime(0.25); }
    fx.wingShow = showing;
    if (fx.wingFlash > 0) fx.wingFlash--;
  }
  // the sprout's flare, struck once per beat: a burst of light at the roots, a shock as each row of
  // blades shoots out, then the downbeat: the wings flash white, a ring bursts from each wingtip, the room shakes
  function wingFx(T, k) {
    const e = window.SpillBoss.EYES[k]; if (!e) return;
    const ex = e.x + 14, ey = e.y - 9;
    const roots = [[ex - 21, ey - 3, -1], [ex + 21, ey - 3, 1]];
    if (T === 2) { for (const [x, y] of roots) { R.fx.ring(x, y, 1, 12, 'sun', 14, { thick: 1.4, l0: 1 }); R.fx.stamp(x, y, 'crit', 'sun', { cool: 3 }); } flashLight(ex, ey, 70, true, 16); A.chime(0.5); A.impact(0.35); cam.shake = Math.max(cam.shake, 2); }
    if (T === 12) for (const [x, y, sd] of roots) for (let j = 0; j < 5; j++) { const a = -Math.PI / 2 + sd * (0.3 + j * 0.28), v = 2.4 + j * 0.2; R.fx.spark(x, y, Math.cos(a) * v, Math.sin(a) * v, 'sun', 12, { l0: 1, g: 0, len: 1.4, drag: 0.86 }); }
    if (T === 16 || T === 25 || T === 34) { A.impact(0.25 + (T === 16 ? 0.2 : 0)); A.breathe(true); cam.shake = Math.max(cam.shake, T === 16 ? 3 : 1.6); if (T === 16) flashLight(ex, ey - 16, 90, true, 12); }
    if (T === 62) {
      fx.wingFlash = 7; cam.shake = Math.max(cam.shake, 6); A.impact(0.8); A.chime(0.9); fx.flash = Math.max(fx.flash || 0, 0.12);
      for (const [x, y, sd] of roots) { const tx = x + sd * 42, ty = y - 30; R.fx.ring(tx, ty, 2, 18, 'sun', 18, { thick: 1.6, l0: 1 }); R.fx.ring(x + sd * 16, y - 14, 4, 34, 'sun', 22, { thick: 1.2, l0: 2, half: true }); }
      flashLight(ex, ey - 20, 150, true, 26);
    }
  }
  const VEIN = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
  // The eye, 23 x 13, drawn each frame from its state: an almond in an iron socket; a heavy iron
  // upper lid with a brass edge and rivets, a lower lid; the white of the eye (bone), shaded under the
  // upper lid and into its corners; a big iris (a dark rim, a teal body with radial streaks), a round
  // black pupil (a slit while it is on guard), one glint. Angry: bloodshot from the corners, a red iris.
  const EYE_W = 10, EYE_H = 5;                                                  // 21 x 11 (a touch smaller than it was)
  function eyeRowsLive(k, st, B, t, white) {
    const hot = !!B.half, open = st.lid * 1.45, rows = [];
    const ix = st.px * 1.6, iy = st.py * 1.2, slit = B.guard && k === B.open, pr = st.wide ? 2.4 : 1.7;
    for (let dy = -EYE_H; dy <= EYE_H; dy++) {
      const w = Math.round(EYE_W * Math.sqrt(Math.max(0, 1 - (dy / (EYE_H + 0.6)) ** 2)));
      let row = '';
      for (let dx = -EYE_W; dx <= EYE_W; dx++) {
        if (Math.abs(dx) > w) { row += '.'; continue; }
        if (Math.abs(dx) === w || Math.abs(dy) === EYE_H) { row += '1'; continue; }           // the socket
        if (open < 0.6) {
          // SHUT: a closed lid, not a plate: the lash line dips like a sleeping eye, lashes hang from it,
          // a crease runs above it; the lid is lit on top, the lower lid in shade (the seam burns red when angry)
          const f = dx / EYE_W, seamY = Math.round(1 - 2.2 * f * f), creaseY = Math.round(-3 + 1.6 * f * f);
          let c2;
          if (dy === seamY) c2 = hot ? '6' : '1';
          else if (dy === seamY + 1 && Math.abs(dx) < w - 2 && (dx + 30) % 3 === 0) c2 = '1';     // a lash
          else if (dy === creaseY && Math.abs(dx) < w - 3) c2 = '9';                               // the crease of the lid
          else if (dy < seamY) c2 = dy <= creaseY - 1 ? (dy === -EYE_H + 1 ? '9' : '2') : (dy === seamY - 1 ? 's' : '2');   // the lid, its lip catching the light
          else c2 = '9';                                                                           // the lower lid, in shade
          row += c2; continue;
        }
        const inOpen = Math.abs(dy) < open && Math.abs(dx) < w - (Math.abs(dy) > open - 1.2 ? 2 : 0);
        if (!inOpen) {
          // the lids: the upper one iron with a brass edge (rivets along it), the lower plain iron
          const upper = dy < 0, edge = Math.abs(Math.abs(dy) - open) < 1.0 || (open < 0.6 && Math.abs(dy) <= 0);
          if (open < 0.6 && dy === 0) { row += hot ? '6' : '4'; continue; }                     // shut: the brass seam
          row += upper ? (edge ? (dx % 4 === 0 ? '3' : '4') : (dx + dy) % 5 === 0 ? '9' : '2') : (edge ? '1' : '2');
          continue;
        }
        const d = Math.hypot(dx - ix, (dy - iy) * 1.15), a = Math.atan2(dy - iy, dx - ix);
        let ch;
        if (slit ? (Math.abs(dx - ix) < 0.6 && Math.abs(dy - iy) <= 2.6) : d <= pr) ch = 'u';      // the pupil
        else if (d <= 3.0) ch = Math.floor((a / Math.PI + 1) * 5) % 2 === 0 ? 'w' : 'o';           // the iris, streaked
        else if (d <= 3.9) ch = 'q';                                                               // its dark rim
        else ch = (dy <= -open + 1.6 || Math.abs(dx) >= w - 3) ? 'l' : 'x';                         // the white, shaded under the lid and in the corners
        if (Math.abs(dx - (ix - 1.4)) < 0.6 && Math.abs(dy - (iy - 1.4)) < 0.6 && ch !== 'u') ch = 'n';   // the glint
        if (hot) {
          if (ch === 'w') ch = 'y'; else if (ch === 'o' || ch === 'q') ch = 'e';
          else if ((ch === 'x' || ch === 'l') && (VEIN(dx + k * 9, dy) < 0.12 + 0.18 * (Math.abs(dx) / EYE_W) ** 2)) ch = 'z';   // bloodshot from the corners
        }
        if (Math.floor(t * 2.5 + k) % 6 === 0 && ch === 'w') ch = 'n';                           // the iris catches the light now and then
        row += ch;
      }
      rows.push(row);
    }
    return white ? whiten(rows) : rows;
  }
  // ITS WINGS (art pass; stage two only): a war-god's wings of light. Not feathers: BLADES of light,
  // each a long tapered edge with a white-hot core and a red rim, set in rows like a wing's feathers so
  // the wing reads full: a bright leading edge sweeps up from beside the eye to the wrist; the long
  // blades fan up from the wrist; a row of mid blades hangs off the arm, out and down; a row of short
  // covert blades lies over their roots, and a few small ones over those. The grate shows through the
  // gaps between blades. A flash runs out along the blades now and then, one after another.
  // SPROUT: a spark at the root splits; the leading edge draws itself up to the wrist; then the blades
  // shoot out row by row (long ones first), each overshooting and settling; the wing shakes out once.
  // Then it breathes (the whole wing lifts and settles, the long blades a little more).
  const eob = (x) => { x = Math.max(0, Math.min(1, x)); const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };   // ease out, overshooting
  const WING_ARM = { cx: 6, cy: -19, wx: 22, wy: -21 };                          // the leading edge: root (0,0) bowed up through (cx,cy) and out to the wrist
  const WING_BLADES = [                                                           // back to front: u along the arm, angle (deg), length, half-width, row
    { u: 1.0, a: -40, L: 22, w: 1.9, r: 0 }, { u: 1.0, a: -32, L: 28, w: 2.0, r: 0 }, { u: 1.0, a: -24, L: 31, w: 2.1, r: 0 },   // the long blades: near-parallel, a pointed tip
    { u: 0.99, a: -16, L: 29, w: 2.1, r: 0 }, { u: 0.97, a: -8, L: 25, w: 2.1, r: 0 },
    { u: 0.88, a: 2, L: 22, w: 2.1, r: 1 }, { u: 0.76, a: 12, L: 21, w: 2.1, r: 1 }, { u: 0.63, a: 22, L: 20, w: 2.0, r: 1 },  // the arm's blades, hanging out and down
    { u: 0.50, a: 32, L: 18, w: 2.0, r: 1 }, { u: 0.37, a: 42, L: 16, w: 1.9, r: 1 }, { u: 0.24, a: 52, L: 13, w: 1.8, r: 1 }, { u: 0.12, a: 62, L: 10, w: 1.7, r: 1 },
    { u: 0.92, a: -14, L: 12, w: 1.8, r: 2 }, { u: 0.80, a: -2, L: 12, w: 1.8, r: 2 }, { u: 0.67, a: 10, L: 11, w: 1.8, r: 2 },  // coverts over their roots
    { u: 0.53, a: 20, L: 10, w: 1.7, r: 2 }, { u: 0.39, a: 30, L: 9, w: 1.7, r: 2 }, { u: 0.25, a: 40, L: 7, w: 1.6, r: 2 },
    { u: 0.85, a: -10, L: 6, w: 1.5, r: 3 }, { u: 0.66, a: 6, L: 6, w: 1.5, r: 3 }, { u: 0.47, a: 18, L: 5, w: 1.4, r: 3 }, { u: 0.28, a: 30, L: 5, w: 1.4, r: 3 },
  ];
  const WING_SC = 0.82;
  function eyeWings(cx, cy, T, t, flash) {
    const out = [];
    const shake = T > 56 && T < 140 ? 18 * Math.sin((T - 56) * Math.PI / 22) * Math.exp(-(T - 56) / 24) : 0;   // the downbeat: a great stroke down, back up, settling
    const SC = WING_SC * (1 + 0.07 * (flash || 0) / 7) * (T < 62 ? 1 : 1);
    const armP = eob((T - 8) / 14);
    for (const side of [-1, 1]) {
      const cells = new Map(), put = (x, y, ch) => cells.set(Math.round(x) + ',' + Math.round(y), ch);
      const rx = 21, ry = -3;                                                    // the root, beside the rune ring (never inside it)
      if (T < 16) {                                                              // the spark: a point of light that swells, then splits
        const r = Math.min(2, T / 4), ray = Math.min(6, T * 0.6);               // a point of light, and a four-pointed star of rays round it
        for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (Math.abs(x) + Math.abs(y) <= r) put(rx + x, ry + y, Math.abs(x) + Math.abs(y) < 1 ? 'x' : 'y');
        for (let k = 3; k <= ray; k++) { const ch = k > ray - 1.5 ? 'f' : 'x'; put(rx + k, ry, ch); put(rx - k, ry, ch); put(rx, ry + k, ch); put(rx, ry - k, ch); }
      }
      const lift = (Math.sin(t * 1.15) * 3 + shake) * Math.PI / 180, cL = Math.cos(lift), sL = Math.sin(lift);
      const P = (x, y) => [rx + (x * cL - y * sL) * SC, ry + (x * sL + y * cL) * SC];   // wing space to eye space (the whole wing lifts on the breath)
      const arm = (u) => { const a1 = (1 - u) * (1 - u), b1 = 2 * (1 - u) * u, c1 = u * u; return [b1 * WING_ARM.cx + c1 * WING_ARM.wx, b1 * WING_ARM.cy + c1 * WING_ARM.wy]; };
      const flashI = Math.floor(t * 9) % 40;                                     // which blade the running flash is on
      WING_BLADES.forEach((B2, i) => {
        if (B2.u > armP + 0.02) return;                                          // the arm has not reached its root yet
        const start = 16 + B2.r * 9 + (B2.r === 0 ? (4 - i) * 2 : i % 6 * 2), g = eob((T - start) / 12);
        if (g <= 0) return;
        const extra = B2.r === 0 ? Math.sin(t * 1.15 - 0.6) * 3 : 0;
        const ang = (B2.a - 35 * (1 - Math.min(1, g)) + extra) * Math.PI / 180, L = B2.L * g, dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
        const [ox, oy] = arm(B2.u), hot = flashI === i;
        for (let sv = 0; sv <= L; sv += 0.4) {
          const f = sv / L, hw = B2.w * (f < 0.12 ? 0.6 + 3.3 * f : Math.pow(1 - (f - 0.12) / 0.88, 0.7));
          for (let o = -hw; o <= hw; o += 0.4) {
            const [x, y] = P(ox + dx * sv + nx * o, oy + dy * sv + ny * o);
            const m = Math.abs(o) / Math.max(0.5, hw);
            put(x, y, flash ? (m < 0.8 ? 'x' : 'y') : (m < (hot ? 0.6 : 0.34)) && f < 0.92 ? 'x' : m < 0.75 ? 'y' : 'f');   // white core, red blade, darker rim
          }
        }
      });
      // the leading edge, drawn last: a bright bar of light from the root to the wrist
      for (let u = 0; u <= armP; u += 0.02) { const [ax, ay] = arm(u), [x, y] = P(ax, ay); put(x, y, 'x'); const [x2, y2] = P(ax - 0.7, ay + 0.7); put(x2, y2, 'y'); }
      if (!cells.size) continue;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const k of cells.keys()) { const [x, y] = k.split(',').map(Number); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const rows = [];
      for (let y = y0; y <= y1; y++) { let r = ''; for (let x = x0; x <= x1; x++) r += cells.get(x + ',' + y) || '.'; rows.push(side > 0 ? r : [...r].reverse().join('')); }
      out.push({ x: side > 0 ? cx + x0 : cx - x1, y: cy + y0, rows, over: true });
    }
    return out;
  }
  // ITS RUNE RING: small tablets, each a rune (3 x 5, drawn by hand) set in a bevelled brass frame:
  // lit on its top and left, dark on its bottom and right, a drop shadow under it; the rune itself
  // glows, its top pixels brighter. Eight of them turn round the open eye.
  const RUNE3 = [
    ['#.#', '##.', '#.#', '#..', '#..'], ['##.', '#.#', '#.#', '#.#', '#.#'], ['#..', '##.', '#.#', '##.', '#..'],
    ['##.', '#.#', '##.', '#.#', '#.#'], ['..#', '.#.', '#..', '.#.', '..#'], ['#.#', '#.#', '.#.', '#.#', '#.#'],
    ['.#.', '##.', '.#.', '.##', '.#.'], ['#.#', '###', '#.#', '#.#', '#.#'], ['##.', '#.#', '#..', '#..', '#..'],
    ['##.', '#.#', '##.', '#.#', '##.'], ['#.#', '##.', '#..', '##.', '#.#'], ['.#.', '#.#', '.#.', '#.#', '.#.'],
  ];
  function runeTablet(gl, hot, lit) {
    const rows = ['.333.'];                                                    // a brass frame, lit on top and left, dark iron below and right
    for (let r = 0; r < 5; r++) {
      let row = r === 0 ? '4' : '3';
      for (let c = 0; c < 3; c++) {
        const on = gl[r][c] === '#', up = r > 0 && gl[r - 1][c] === '#';
        row += on ? (hot ? (lit ? 'x' : 'y') : (lit ? 'n' : up ? 'o' : 'n')) : 'u';
      }
      rows.push(row + '2');
    }
    rows.push('.222.');
    return rows;
  }
  function eyeAnimSprites(t) {
    const B = sim.boss; if (!B) return [];
    const out = [], E = window.SpillBoss.EYES, A0 = fx.sieveAct, aT = A0 ? A0.t : 99;
    E.forEach((e, k) => {
      const st = eyeState(k), cx = e.x + 14, cy = e.y - 6, bob = Math.round(Math.sin(t * 1.3 + k * 2.1) * 0.7);
      const rows = eyeRowsLive(k, st, B, t, k === B.open && fx.eyeWhite > 0);
      const open = st.lid / 4;
      if (k === B.open && B.half && (fx.wingT || 0) > 0 && st.lid / 4 > 0.3) out.push(...eyeWings(cx + (st.shake || 0), cy - 2 + bob, fx.wingDone ? 200 : fx.wingT, t, fx.wingFlash || 0));   // behind the eye
      out.push({ x: cx - EYE_W + (st.shake || 0), y: e.y - 2 * EYE_H - 2 + bob, rows, over: true });
      if (open < 0.3) return;
      // the rune ring: small bevelled tablets turning round it, opening out with the lid
      const n = 8, rx = 11 + 5 * open, ry = 8 + 3 * open, spin = t * (B.half ? 0.5 : 0.3) * (k & 1 ? -1 : 1);
      for (let g = 0; g < n; g++) {
        const a = spin + g / n * Math.PI * 2;
        let burn = false;
        if (A0 && A0.a != null && aT < 50) { const da = Math.abs(((a - A0.a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI); burn = da < 0.9 && Math.floor(aT / 3) % 2 === 0; }
        const gl = RUNE3[(g * 5 + k * 3) % RUNE3.length], tab = runeTablet(gl, !!B.half, burn || g === Math.floor(t * 3) % n);
        const gx = Math.round(cx + Math.cos(a) * rx) - 2, gy = Math.round(cy - 2 + bob + Math.sin(a) * ry) - 3;
        out.push({ x: gx + 1, y: gy + 1, rows: tab.map((r) => r.replace(/[^.]/g, '1')), over: true });   // its shadow
        out.push({ x: gx, y: gy, rows: tab, over: true });
      }
    });
    return out;
  }

  // ---------- the Sieve's hall, dressed (art pass) ----------
  // Long war-banners of the Tower hang from the vault either side of the grate (each its own
  // length, its own tears, the Sieve's eye worked in brass on it, stirring in the draft), and iron
  // braziers stand on the floor where the hall's low fires burn (each flame its own flicker).
  // Painted only on open cells: nothing here can be stood on or blocks your sand.
  function hallBanner(len, tear, seed) {
    const rows = ['1111111111111', '.1.1.1.1.1.1.'];
    for (let y = 0; y < len; y++) {
      const edge = (k) => ((seed * 7 + y * 13 + k * 5) % 11) < 2;
      let r = '';
      for (let x = 0; x < 13; x++) {
        if (x === 0 || x === 12) { r += '.'; continue; }
        const torn = y > len - tear && ((x * 3 + y * 5 + seed) % 7 < (y - (len - tear)) * 0.9);
        if (torn) { r += '.'; continue; }
        const em = y >= 6 && y <= 14 && (() => { const dx = x - 6, dy = y - 10; const ring = Math.abs(Math.hypot(dx, dy * 1.2) - 3.6) < 0.7, pupil = Math.abs(dx) <= 0 && Math.abs(dy) <= 1; return ring || pupil; })();
        r += em ? (y < 10 ? '4' : '3') : x === 1 || (x === 11 && edge(1)) ? 'f' : y === 3 || y === len - tear - 1 ? 'f' : 'e';
      }
      rows.push(r);
    }
    return rows;
  }
  function bossHallSprites(t) {
    const L = currentLevel(); if (!L.boss || L.id !== 'sieve' || screen !== 'game') return [];
    const arch = window.SpillHallArt ? window.SpillHallArt.sprites(t) : [];          // the hall's stone dressed as a castle (src/hallart.js)
    return arch.concat(IA && IA.sim === sim ? IA.sprites(t) : []);                  // the banners, braziers and chains are live (src/interactive.js)
  }
  // ---------- the hall's interactive layer (src/interactive.js; spec PLAN_STORY_WORLD.md 11b) ----------
  // Placed out of every attack lane: the banners hang over the high left ledge (a torn one lies there);
  // the braziers sit in niches in the side walls; the chains hang against the side walls (the right one
  // from a bracket below the HUD's corner, so it is never hidden), where the
  // Sieve's stones (x 24..456) never fall, and swing no further than 3 cells.
  let IA = null;
  function interactiveStep(t) {
    const L = currentLevel();
    if (!(L.boss && L.id === 'sieve' && screen === 'game' && window.SpillInteractive)) { IA = null; return; }
    if (!IA || IA.sim !== sim) IA = window.SpillInteractive.create(sim, {
      fx: () => R.fx, audio: A, shake: (v) => { cam.shake = Math.max(cam.shake, v); },
      quiet: () => sim.frame < 240 || !!fx.dying || !!fx.regather || !!fx.cut,
      banners: [{ x: 40, top: 18, len: 44, amp: 0.8, ph: 0.4, tearAt: 220, rows: hallBanner(44, 9, 3) }, { x: 96, top: 18, len: 52, amp: 1.0, ph: 2.1, tearAt: 260, rows: hallBanner(52, 12, 8) }],
      braziers: [{ x: 18, y: 172, s: 1 }, { x: 462, y: 172, s: 2 }],
      chains: [{ x: 20, top: 16, bottom: 68, reach: 3, stone: true, sx: 20 }, { x: 460, top: 70, bottom: 140, reach: 3, stone: true, sx: 460, bracket: true }],
      // HELD until the interactive direction is confirmed (gears and statues are new content): the code is in
      // src/interactive.js; to turn them on, pass:
      //   gears: [{ x: 20, y: 124, r: 8, teeth: 10, trap: { x0: 36, x1: 40, y0: 80, y1: 97 } }], statues: [{ x: 114, y: 79 }],
      onMemory: (x, y) => { A.chime(1); fx.flash = Math.max(fx.flash || 0, 0.18); M.cue('still_hours'); R.fx.stamp(x, y, 'crit', 'frost', { cool: 3 }); },   // as a room's memory sounds and shows (not counted: no score changes)
    });
    IA.step(t);
  }

  // ---------- the way out of the Sieve's room (art pass) ----------
  // When the Sieve is dead the fight does not end on a screen: its heart opens into a round gateway
  // framed by the dead grate (a rim of stone blocks with a brass band, two slow dashed rings of
  // light turning in its mouth, a pulsing core, grains drawn round into it). Throw some of your
  // sand up into it to go on.
  const GATE_R = 13;                                                             // the mouth's radius; the rim is 3 more
  function openBossPortal() {
    fx.bossPortal = { x: SIEVE_C.x, y: SIEVE_C.y, t: 0 };
    A.toll(); A.chime(1); cam.shake = Math.max(cam.shake, 3);
    R.fx.ring(SIEVE_C.x, SIEVE_C.y, 3, 40, 'frost', 20, { thick: 1.8, l0: 1 });
    if (FF && FF.shock) FF.shock(SIEVE_C.x, SIEVE_C.y, 1.2, 3.6);
  }
  function bossExitOpen() {
    const L = currentLevel(); if (!L.boss) return true;
    const P = fx.bossPortal; if (!P) return false;
    return P.entered;
  }
  function bossPortalStep() {
    const P = fx.bossPortal; if (!P) return;
    P.t++;
    if (P.entered || P.t < 40) return;
    let n = 0;                                                                   // your grains inside its mouth
    const floorY = groundBelow(P.x, 240);
    for (let i = 0; i < sim.N && n < 6; i++) if (sim.state[i] === 1 && (Math.hypot(sim.px[i] - P.x, sim.py[i] - P.y) <= GATE_R + 6 || (P.t > 70 && Math.abs(sim.px[i] - P.x) <= 5 && sim.py[i] > P.y && sim.py[i] <= floorY))) n++;   // its mouth, or anywhere in the shaft of light it lets down to the floor (tested: a throw from the landing only passes ~23 cells from the heart)
    if (n >= 3) { P.entered = true; A.chime(1); A.toll(); fx.flash = Math.max(fx.flash, 0.3); R.fx.ring(P.x, P.y, 3, 48, 'frost', 22, { thick: 2, l0: 1 }); R.fx.stamp(P.x, P.y, 'crit', 'frost', { cool: 2 }); }
  }
  function bossPortalSprites(t) {
    const P = fx.bossPortal; if (!P) return [];
    const out = [], open = Math.min(1, P.t / 40), e = open * open * (3 - 2 * open), R0 = GATE_R * e, cx = P.x, cy = P.y;
    if (R0 < 1) return out;
    // the rim: three courses of stone blocks (mortar between, offset), a brass band on the inner
    // course, moonlit on its upper left, shadowed lower right; the mouth inside it dark
    const Rr = R0 + 3;
    for (let dy = -Math.ceil(Rr); dy <= Math.ceil(Rr); dy++) for (let dx = -Math.ceil(Rr); dx <= Math.ceil(Rr); dx++) {
      const d = Math.hypot(dx, dy); if (d > Rr + 0.3) continue;
      if (d <= R0) { out.push({ x: cx + dx, y: cy + dy, rows: ['u'], over: true }); continue; }
      const a = Math.atan2(dy, dx), course = Math.floor(d - R0), block = Math.floor((a + Math.PI) / (Math.PI * 2) * (course === 0 ? 20 : course === 1 ? 24 : 28) + course * 0.5);
      const seam = Math.abs(((a + Math.PI) / (Math.PI * 2) * (course === 0 ? 20 : course === 1 ? 24 : 28) + course * 0.5) - block) < 0.12;
      const lit = Math.cos(a + Math.PI * 0.75);                                   // light from the upper left
      const ch = course === 0 ? (seam ? '3' : '4') : seam ? '9' : course === 2 && lit > 0.55 ? 's' : lit < -0.5 ? '1' : '2';
      out.push({ x: cx + dx, y: cy + dy, rows: [ch], over: true });
    }
    if (P.t < 30) return out;
    // the mouth: two slow dashed rings of light, a pulsing core, grains drawn round into it
    const RINGS = [[R0 * 0.82, 0.45, 'o', 10], [R0 * 0.48, -0.8, 'n', 9]];
    for (const [rr, sp, ch, per] of RINGS) {
      const n = Math.round(rr * 6.4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * sp, dash = (i + Math.floor(t * sp * 3)) % per;
        if (dash >= per - 3) continue;
        out.push({ x: Math.round(cx + Math.cos(a) * rr), y: Math.round(cy + Math.sin(a) * rr), rows: [ch], over: true });
      }
    }
    const pulse = Math.sin(t * 2.2) > 0.2;
    out.push({ x: cx, y: cy, rows: [pulse ? '8' : 'n'], over: true }, { x: cx + 1, y: cy, rows: ['n'], over: true }, { x: cx - 1, y: cy, rows: ['n'], over: true }, { x: cx, y: cy - 1, rows: ['n'], over: true }, { x: cx, y: cy + 1, rows: ['n'], over: true });
    // the shaft it lets down to the floor once open: two thin strands of light running up it, and
    // grains rising inside it (behind the hanging plate and anything else in its way)
    if (P.t > 50) {
      const floorY = groundBelow(cx, 240), top = cy + Math.round(R0) + 3, bot = Math.min(floorY, top + Math.round((P.t - 50) * 4));
      for (let y = top; y <= bot; y++) {
        const run = (y + Math.floor(t * 18)) % 9, run2 = (y + Math.floor(t * 11) + 4) % 13;
        if (run < 5) out.push({ x: cx - 3, y, rows: [run < 2 ? 'n' : 'o'] });
        if (run2 < 6) out.push({ x: cx + 3, y, rows: [run2 < 2 ? 'n' : 'o'] });
        if (((y * 7 + Math.floor(t * 30)) % 23) === 0) out.push({ x: cx + ((y >> 1) % 3) - 1, y, rows: ['d'] });
      }
      if (bot >= floorY) for (let k = -5; k <= 5; k++) if ((k + Math.floor(t * 6)) % 3 !== 0) out.push({ x: cx + k, y: floorY, rows: [Math.abs(k) < 3 ? 'n' : 'o'] });   // where it meets the floor
    }
    for (let g = 0; g < 5; g++) {
      const ph = (t * 0.25 + g / 5) % 1, a = g * 1.26 + ph * 4.5 + t * 0.3, r2 = (R0 + 6) * (1 - ph);
      out.push({ x: Math.round(cx + Math.cos(a) * r2), y: Math.round(cy + Math.sin(a) * r2), rows: [ph > 0.75 ? 'd' : g & 1 ? 'a' : 'b'], over: true });
    }
    return out;
  }
  // its light on the room, while it stands (pushed with the frame's other lights)
  function bossPortalLight() { const P = fx.bossPortal; if (!P || P.t < 20) return null; const k = Math.min(1, (P.t - 20) / 30); return { x: P.x, y: P.y, r: 0.45 * k, g: 0.75 * k, b: 0.85 * k, radius: 90, flicker: 0 }; }

  // ---------- death and waking (art pass) ----------
  // Death is not a screen. When you are lost, what is left of you loses its hold: the grains let go
  // one by one, from the top of the pile down, drop, and sink into the floor (a quiet breath, no
  // flash). Then you wake where you wake, and the body is put back together from single grains
  // that rise out of the floor around the spot and gather into it, in under half a second. The
  // world runs while they gather (move, and you simply have your body at once); keys held through
  // it stay let go until pressed again (releaseHeld, and key repeats are ignored).
  const DIE_T = 46, GATHER_T = 28;
  function startDying() {
    if (fx.dying) return;
    const live = [];
    for (let i = 0; i < sim.N; i++) if (sim.state[i] === 1 || sim.state[i] === 2) live.push(i);
    live.sort((a, b) => sim.py[a] - sim.py[b] || (sim.px[a] - sim.px[b]));
    const grains = live.map((i, k) => ({ x: sim.px[i], y: sim.py[i], i, tint: sim.tint[i], at: Math.floor((k / Math.max(1, live.length)) * DIE_T * 0.6 + Math.random() * 6), vx: 0, vy: 0, gone: false, sink: 0 }));
    if (!grains.length && fx.lastCx != null) for (let k = 0; k < 18; k++) grains.push({ x: Math.round(fx.lastCx + (Math.random() - 0.5) * 8), y: Math.round(fx.lastCy - Math.random() * 5), i: -1, tint: k & 3, at: k * 1.5, vx: 0, vy: 0, gone: false, sink: 0 });
    fx.dying = { t: 0, grains };
    A.breathe(false); fx.hitstop = 0; inp.pour = inp.charge = inp.harden = inp.blade = inp.strike = false;
  }
  function dyingStep() {
    const D = fx.dying; D.t++;
    for (const g of D.grains) {
      if (g.gone || D.t < g.at) continue;
      if (g.i >= 0 && sim.state[g.i]) { sim.state[g.i] = 0; sim.pid[sim.py[g.i] * sim.W + sim.px[g.i]] = -1; }    // the real grain lets go
      if (g.sink > 0) { if (++g.sink > 6) g.gone = true; continue; }
      g.vy = Math.min(3, g.vy + 0.22); g.vx *= 0.9;
      if (!g.vx && Math.random() < 0.3) g.vx = (Math.random() - 0.5) * 0.4;
      const ny = g.y + g.vy, nx = g.x + g.vx;
      if (sim.terrainSolid(Math.round(nx), Math.round(ny) + 1) || ny >= sim.H - 2) { g.y = Math.round(ny); g.x = Math.round(nx); g.sink = 1; if (Math.random() < 0.08) R.fx.smoke(g.x, g.y, 1.2, 14, { vy: -0.1 }); }
      else { g.x = nx; g.y = ny; }
    }
    if (D.t === Math.round(DIE_T * 0.5)) A.breathe(true);
    if (D.t >= DIE_T) {
      fx.dying = null;
      failRoom();
      fx.fade = Math.min(fx.fade, 0.35);                                          // no black screen: you see yourself come back
      fx.regather = { t: 0, from: new Map() };
    }
  }
  // where each grain of the new body rises from: the floor near it, a little to either side
  function regatherStep() {
    const G = fx.regather; G.t++;
    // a room hands you your grains over several frames (its spawn): each is taken up as it appears
    let fresh = 0;
    for (let i = 0; i < sim.N; i++) {
      if (sim.state[i] !== 1 || G.from.has(i)) continue;
      // it is drawn in from a little way off (the dust of you, settling back together)
      const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 18;
      G.from.set(i, { dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.6 + 4, at: G.t + Math.random() * 14 }); fresh++;
    }
    if (fresh) G.last = G.t;
    if (G.t === 2) A.breathe(false);
    const quiet = G.last != null && G.t - G.last > 14;
    if (quiet && !G.rang) { G.rang = true; A.chime(0.25); }
    if ((quiet && G.t - G.last > 24) || G.t > 120 || inp.pour || inp.charge || inp.blade || inp.strike || inp.harden) fx.regather = null;   // done, or you moved: whole at once
  }
  // grains still on their way are hidden from the world draw (restored right after it)
  function regatherMask() {
    const G = fx.regather; if (!G || G.t < 1) return null;
    const out = [];
    for (const [i, f] of G.from) { if (sim.state[i] !== 1) continue; const u = (G.t - f.at) / 9; if (u < 1) { out.push([i, 1]); sim.state[i] = 0; } }
    return out.length ? out : null;
  }
  const SAND_CH = ['a', 'b', 'c', 'b'];
  function deathSprites() {
    const out = [];
    const D = fx.dying;
    if (D) for (const g of D.grains) {
      if (g.gone || D.t < g.at) continue;                                        // not let go yet: still drawn as the real grain
      out.push({ x: Math.round(g.x), y: Math.round(g.y) + (g.sink > 3 ? 1 : 0), rows: [g.sink > 3 ? 'c' : SAND_CH[g.tint & 3]], over: true });
    }
    const G = fx.regather;
    if (G && G.t >= 1) for (const [i, f] of G.from) {
      if (sim.state[i] !== 1) continue;
      const u = (G.t - f.at) / 9; if (u >= 1) continue;
      if (u < 0) continue;
      const e = u * u * (3 - 2 * u), x = sim.px[i] + f.dx * (1 - e), y = sim.py[i] + f.dy * (1 - e) - Math.sin(u * Math.PI) * 3;
      out.push({ x: Math.round(x), y: Math.round(y), rows: [u > 0.8 ? 'b' : 'a'], over: true });
    }
    return out;
  }

  // ---------- boss voices and cutscenes (art pass) ----------
  // Every boss can speak, like the Keeper but in its own register: a line at the start of the fight,
  // one at its turn (the half-life, played as a cutscene: letterbox, the camera pushed in, the world
  // held still while it talks), and one as it falls. A new boss only adds an entry here.
  // The text is a subtitle on the lower letterbox bar (its name in ember, the line in bone), and
  // the voice is a low grinding mumble of its own, not the Keeper's.
  const BOSS_VOICE = {
    sieve: {
      name: 'The Sieve', col: '#d0654f', focus: { x: 240, y: 132 },
      start: ['Everything that falls reaches me in the end.'],
      half: ['You think you are whole?', 'I will keep every grain.'],
      down: ['...all those hours...  let them fall through.'],
    },
  };
  function bossVoiceDef() { const L = currentLevel(); return L && L.boss ? BOSS_VOICE[L.id] : null; }
  function bossSay(when) {
    const V = bossVoiceDef(); if (!V || !V[when] || (fx.bvSaid || (fx.bvSaid = {}))[when]) return;
    fx.bvSaid[when] = true;
    fx.bv = { name: V.name, col: V.col, lines: V[when].slice(), li: 0, shown: 0, hold: 0, when };
  }
  function bossVoiceSkip() {
    const b = fx.bv; if (!b) return false;
    const len = b.lines[b.li].length;
    if (b.shown < len) b.shown = len; else { b.li++; b.shown = 0; b.hold = 0; if (b.li >= b.lines.length) fx.bv = null; }
    return true;
  }
  // its voice: gibberish like the Keeper's (the same recorded babble), but slowed and deep, with a
  // soft stone grind under each word
  function bossVoiceSound(ch, wordStart) {
    A.voice(ch, wordStart, 0.55);
    if (!wordStart) return;
    const ctx = A.context && A.context(); if (!ctx || (A.muted && A.muted())) return;
    const t0 = ctx.currentTime, code = ch.charCodeAt(0), o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(46 + (code % 7) * 4, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.22);
    f.type = 'lowpass'; f.frequency.value = 320; f.Q.value = 3;
    const v = 0.03 * (A.volume ? A.volume('sound') : 1);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
    o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.28);
  }
  function bossVoiceStep() {
    const b = fx.bv; if (!b) return;
    const line = b.lines[b.li];
    if (b.shown < line.length) {
      const prev = Math.floor(b.shown); b.shown += 0.6;
      const ch = line[Math.floor(b.shown) - 1];
      if (Math.floor(b.shown) !== prev && ch && /[A-Za-z]/.test(ch)) bossVoiceSound(ch, prev === 0 || line[prev - 1] === ' ');
    } else if ((b.hold += 1) > 40 + line.length * 0.9) { b.li++; b.shown = 0; b.hold = 0; if (b.li >= b.lines.length) fx.bv = null; }
  }
  // the opening line: once the fight has settled (and before anything has happened), a short cut
  function bossVoiceCue() {
    const V = bossVoiceDef(); if (!V || !sim.boss || (fx.bvSaid && fx.bvSaid.start)) return;
    if (sim.frame === 200 && !fx.cut) startCut('start');            // as the room's title has faded
  }
  function startCut(kind) {
    fx.cut = { kind, t: 0, hold: true, rel: -1, eyes: 0 };
    if (kind === 'half') { A.toll(); fx.halfAge = Math.max(fx.halfAge || 0, 1); if (FF && FF.hold) FF.hold(9, 0.85); }   // the blow lands on a held three-tone frame
    if (kind === 'start') fx.cut.dim = 0.72;
    if (kind === 'down') { fx.cut.dark = 0; fx.halfAge = Math.max(fx.halfAge || 0, 1); }
  }
  // one of its eyes wakes (the intro) or snaps open in anger: a held beat of its own
  function cutEye(k, angry) {
    const e2 = window.SpillBoss.EYES[k]; if (!e2) return;
    const ex = e2.x + 14, ey = e2.y - 6;
    fx.cut.eyes = k + 1;
    R.fx.ring(ex, ey, 2, angry ? 18 : 12, angry ? 'sun' : 'frost', angry ? 14 : 18, { thick: angry ? 2.2 : 1.4, l0: angry ? 1 : 3 });
    if (angry) { R.fx.stamp(ex, ey, 'crit', 'sun', { cool: 3 }); A.impact(0.7); cam.shake = Math.max(cam.shake, 3); if (FF && FF.knock) FF.knock(0, 1, 1.6); }
    else { A.chime(0.3); A.glance(); }
    flashLight(ex, ey, angry ? 70 : 50, true, angry ? 18 : 30);
  }
  // the cutscene's own clock (runs while the world is held, and on through the roar)
  function cutStep() {
    const c = fx.cut; if (!c) return;
    c.t++;
    const V = bossVoiceDef(), F0 = V ? V.focus : { x: sim.W / 2, y: sim.H / 2 };
    fx.letter = Math.min(1, (fx.letter || 0) + 0.06);
    if (c.kind === 'start') {
      // THE SIEVE WAKES. The room is dark and still, the camera low on the floor. It rises to the
      // grate while dust sifts from the ring and a low rumble builds; the three eyes open one by one,
      // each with a held beat and its lamp; it speaks; then its name is stamped on the bar with a
      // toll and the bars open on the fight.
      if (c.hold) {
        cam.shake = Math.max(cam.shake, Math.min(1.2, c.t / 70));
        if (c.t % 6 === 0 && c.t < 110) { const a = -Math.PI * (0.15 + Math.random() * 0.7), x = SIEVE_C.x + Math.cos(a) * (SIEVE_C.r - 4), y = SIEVE_C.y + Math.sin(a) * (SIEVE_C.r - 4); R.fx.spark(x, y, (Math.random() - 0.5) * 0.3, 0.2, 'dust', 26, { l0: 4, g: 0.12, len: 0.5 }); }
        if (c.t === 8) A.breathe(false);
        if (c.t === 50 || c.t === 66 || c.t === 82) { cutEye((c.t - 50) / 16, false); c.dim = Math.max(0, c.dim - 0.22); }
        if (c.t === 100) bossSay('start');
        if (c.t > 104 && !fx.bv && c.card == null) { c.card = c.t; A.toll(); cam.shake = Math.max(cam.shake, 3); c.dim = 0; }
        if (c.card != null && c.t - c.card > 70) { c.hold = false; c.rel = c.t; }
      } else if (c.t - c.rel > 24) fx.cut = null;
      return;
    }
    if (c.kind === 'down') {
      // THE SIEVE DIES. The world is held. The colour drains and the camera pushes in on the grate;
      // its eyes go out one at a time (each flickers, cracks, and goes dark with a falling bell);
      // the cracks race all the way round the ring and stone rains from them while a rumble builds;
      // it speaks its last, slowly; then its heart bursts and all the hours it took pour out of the
      // grate as a flood of sand, two shocks, the great bell, a light; silence; the colour comes
      // back and the bars open on the result.
      if (c.hold) {
        fx.halfAge = (fx.halfAge || 0) + (c.t < 120 ? 4 : 1);
        fx.superTen = Math.max(fx.superTen || 0, Math.min(0.6, c.t / 60));      // the colour drains (shared with the super's grade)
        if (c.t < 150) cam.shake = Math.max(cam.shake, 0.6 + c.t / 110);
        if (c.t === 30 || c.t === 50 || c.t === 70) {
          const k = 2 - (c.t - 30) / 20, e2 = window.SpillBoss.EYES[k];
          c.dark = (c.dark || 0) + 1; c.lastDark = c.t;
          if (e2) { const ex = e2.x + 14, ey = e2.y - 6; R.fx.stamp(ex, ey, 'crit', 'frost', { cool: 4 }); for (let j = 0; j < 6; j++) { const b = (j / 6) * Math.PI * 2, v = 1.4 + Math.random(); R.fx.spark(ex, ey, Math.cos(b) * v, Math.sin(b) * v - 0.5, 'frost', 12, { l0: 1, g: 0.2, len: 0.7 }); } }
          A.glance(); A.impact(0.4);
        }
        if (c.t >= 60 && c.t < 140 && c.t % 3 === 0) {
          const P = sieveCrackPaths().paths, path = P[(c.t / 3 | 0) % P.length], q = path.pts[Math.floor(Math.random() * path.pts.length)];
          if (q) { R.fx.spark(q.x, q.y, (Math.random() - 0.5) * 0.8, 0.3, 'dust', 34, { l0: 1, g: 0.22, len: 1.4 }); if (c.t % 9 === 0) R.fx.smoke(q.x, q.y + 2, 1.8, 30, { vy: 0.2 }); }
        }
        if (c.t % 24 === 0 && c.t > 60 && c.t < 150) A.impact(0.35);
        if (c.t === 84) bossSay('down');
        if (c.t > 92 && !fx.bv && c.burst == null) {
          c.burst = c.t;
          // the heart bursts: every hour it took pours out of the grate
          A.toll(); A.chime(1); M.cue('great_glass');
          if (FF && FF.shock) { FF.shock(F0.x, F0.y, 2.8, 4.6); FF.shock(F0.x, F0.y, 1.6, 3.2); }
          if (FF && FF.hold) FF.hold(5, 0.7);
          R.fx.stamp(F0.x, F0.y, 'crit', 'sun', { cool: 2 });
          R.fx.ring(F0.x, F0.y, 6, 110, 'sun', 28, { thick: 2.5, l0: 1 });
          for (let j = 0; j < 4; j++) R.spray(F0.x, F0.y, 60, 4.5 + j, -Math.PI * 0.95, -Math.PI * 0.05);   // up and out over the rim
          R.spray(F0.x, F0.y + 10, 80, 3.5, Math.PI * 0.15, Math.PI * 0.85);                                  // and down through the bars
          cam.shake = 9; fx.flash = Math.max(fx.flash, 0.4); flashLight(F0.x, F0.y, 140, true, 40);
        }
        if (c.burst != null && c.t - c.burst < 64 && (c.t - c.burst) % 2 === 0) {
          // the flood: sand spills from all along the lower grate and over its rim, thinning as it runs out
          const u = (c.t - c.burst) / 64, n = Math.round(26 * (1 - u) + 4);
          for (let j = 0; j < 3; j++) {
            const a = Math.PI * (0.12 + Math.random() * 0.76), r = SIEVE_C.r * (0.35 + Math.random() * 0.6);
            R.spray(SIEVE_C.x + Math.cos(a) * r, SIEVE_C.y + Math.sin(a) * r, n, 1.6 + Math.random() * 1.4, Math.PI * 0.35, Math.PI * 0.65);
          }
          if ((c.t - c.burst) % 12 === 0) { cam.shake = Math.max(cam.shake, 2.5 * (1 - u)); A.impact(0.3 * (1 - u)); }
        }
        // the hours return: the poured sand streams back up off the floor into the heart
        if (c.burst != null && c.t - c.burst >= 56 && c.t - c.burst < 110 && (c.t - c.burst) % 2 === 0) {
          const H0 = { x: SIEVE_C.x, y: SIEVE_C.y };
          for (let j = 0; j < 4; j++) R.stream(SIEVE_C.x + (Math.random() - 0.5) * 170, 246 - Math.random() * 6, () => H0, 20 + Math.random() * 14, Math.random() * 6, (j + c.t) & 3);
          if ((c.t - c.burst) % 10 === 0) A.glance();
        }
        // the heart, full again, flares; then it opens into the way out
        if (c.burst != null && c.t - c.burst === 128) { A.chime(0.8); R.fx.stamp(SIEVE_C.x, SIEVE_C.y, 'crit', 'sun', { cool: 2 }); flashLight(SIEVE_C.x, SIEVE_C.y, 90, true, 20); }
        if (c.burst != null && c.t - c.burst === 140) openBossPortal();
        if (c.burst != null && c.t - c.burst > 190) { c.hold = false; c.rel = c.t; }
      } else {
        fx.superTen = Math.max(0, (fx.superTen || 0) - 0.02);
        if (c.t - c.rel > 30) fx.cut = null;
      }
      return;
    }
    // THE ANGER. 0: the blow lands on a held three-tone frame and the world stops. A red cast
    // pulses with a slow heartbeat; the camera creeps in with a hand-held sway; the eyes snap open
    // red one after another, each a beat of its own; the cracks race across the ring and chunks of
    // stone break off them; dust pours. It speaks, its words shaking. Released: two great shocks out
    // of its heart and a quake along the whole floor, the grate tears round (the sim's roar), and
    // the bars slide away as the fight comes back angrier.
    if (c.hold) {
      fx.halfAge = (fx.halfAge || 0) + (c.t < 70 ? 3 : 1);
      cam.shake = Math.max(cam.shake, Math.min(2.2, c.t / 40));
      if (c.t % 30 === 12) { c.beat = c.t; A.impact(0.45); }                       // the heartbeat
      if (c.t % 5 === 0 && c.t < 160) {
        const P = sieveCrackPaths().paths, path = P[(c.t / 5 | 0) % P.length], q = path.pts[Math.min(path.pts.length - 1, 2 + (c.t % 4))];
        if (q) {
          R.fx.smoke(q.x, q.y + 1, 1.8, 26, { vy: 0.15, vx: (Math.random() - 0.5) * 0.4 });
          if (c.t % 10 === 0) R.fx.spark(q.x, q.y + 1, (Math.random() - 0.5) * 0.8, 0.4, 'dust', 30, { l0: 1, g: 0.22, len: 1.4 });   // a chunk of stone breaks off
          else R.fx.spark(q.x, q.y + 1, (Math.random() - 0.5) * 0.6, 0.3, 'sand', 12, { l0: 5, g: 0.2, len: 0.5 });
        }
      }
      if (c.t === 14) { A.impact(0.6); flashLight(F0.x, F0.y, 120, true, 30); }
      if (c.t === 26 || c.t === 38 || c.t === 50) cutEye((c.t - 26) / 12, true);
      if (c.t === 56) A.toll();
      if (c.t === 72) bossSay('half');
      if (c.t > 78 && !fx.bv) {
        c.hold = false; c.rel = c.t;
        A.impact(1); A.toll(); A.hit(true);
        if (FF && FF.shock) { FF.shock(F0.x, F0.y, 2.6, 4.4); FF.shock(F0.x, F0.y, 1.4, 3.0); }
        if (FF && FF.hold) FF.hold(4, 0.6);
        R.fx.ring(F0.x, F0.y, 8, 120, 'sun', 30, { thick: 3, sq: 1, l0: 2 });
        R.fx.ring(F0.x, F0.y, 4, 80, 'sun', 24, { thick: 2, sq: 1, l0: 4, delay: 6 });
        for (const qx of [80, 160, 240, 320, 400]) VF().quake(qx, 249, 0.6, 'dust');   // the whole floor heaves
        cam.shake = 8; fx.flash = Math.max(fx.flash, 0.3); flashLight(F0.x, F0.y, 160, true, 24);
      }
    } else {
      if ((c.t - c.rel) % 9 === 0) cam.shake = Math.max(cam.shake, 2.5);
      if (c.t - c.rel > 125) fx.cut = null;
    }
  }
  // the camera: the intro rises from the floor to the grate; the anger creeps in with a sway
  function cutCamera() {
    const c = fx.cut; if (!c) return;
    const V = bossVoiceDef(), F0 = V ? V.focus : { x: sim.W / 2, y: sim.H / 2 };
    const base = { w: R.screenW / R.scale, h: R.screenH / R.scale };
    const arena = Math.max(0.62, Math.min(1.1, base.w / (sim.W + 6), base.h / (sim.H + 4)));
    const EYE_FY = F0.y + 42;                                                     // between the heart and the eyes: the eye is the boss, so it sits mid-frame, clear of the bars
    let push, fy = c.kind === 'down' ? F0.y + 26 : EYE_FY, sx = 0, sy = 0;
    if (c.kind === 'down') {
      push = c.hold ? 1.25 + 0.4 * Math.min(1, c.t / 110) - (c.burst != null ? 0.35 * Math.min(1, (c.t - c.burst) / 20) : 0) : 1.0;
      if (c.hold && c.burst == null) { sx = Math.sin(c.t * 0.05) * 1.2; sy = Math.sin(c.t * 0.04 + 1) * 0.9; }
    } else if (c.kind === 'half') {
      push = c.hold ? 1.3 + 0.35 * Math.min(1, c.t / 90) : 1.65 - 0.65 * Math.min(1, (c.t - c.rel) / 60);
      if (c.hold) { sx = Math.sin(c.t * 0.07) * 1.6; sy = Math.sin(c.t * 0.053 + 1) * 1.1; }
    } else {
      const rise = Math.min(1, c.t / 80), e = rise * rise * (3 - 2 * rise);
      push = c.hold ? 2.1 - 0.75 * e : 1.35 - 0.35 * Math.min(1, (c.t - c.rel) / 24);   // tight and low on the floor, widening as it rises
      fy = 236 + (EYE_FY - 236) * e;                                             // from the floor up to the eyes
    }
    c.z = c.kind === 'start' && c.t < 3 ? arena * push : (c.z || R.zoom) + (arena * push - (c.z || R.zoom)) * 0.06; R.zoom = c.z;
    const vw = base.w / R.zoom, vh = base.h / R.zoom;
    const tx = clampCam(F0.x - vw / 2, sim.W, vw), ty = clampCam(fy - vh / 2, sim.H, vh);
    cam.x += (tx - cam.x) * 0.1 + sx * 0.1; cam.y += (ty - cam.y) * (c.kind === 'start' && c.t < 3 ? 1 : 0.12) + sy * 0.1;
  }
  // letterbox and the subtitle
  function drawCut(t) {
    if (!fx.cut) fx.letter = Math.max(0, (fx.letter || 0) - 0.05);
    const k = fx.letter || 0; if (k <= 0.01) return;
    const W = hud.width, H = hud.height, p = R.scale, e = k * k * (3 - 2 * k), bar = Math.round(H * 0.11 * e / p) * p, c = fx.cut;
    // the anger's red: a cast that swells on each heartbeat and sinks between
    if (c && c.kind === 'half') {
      const since = c.beat == null ? 99 : c.t - c.beat, beat = Math.exp(-since / 9);
      const a = c.hold ? 0.07 + 0.08 * beat : Math.max(0, 0.07 * (1 - (c.t - c.rel) / 40));
      if (a > 0.005) { hx.fillStyle = `rgba(140,22,18,${a.toFixed(3)})`; hx.fillRect(0, 0, W, H); }
    }
    if (c && c.kind === 'start' && c.dim > 0) { hx.fillStyle = `rgba(4,3,8,${c.dim.toFixed(3)})`; hx.fillRect(0, 0, W, H); }   // the intro begins in the dark
    hx.fillStyle = '#05040a'; hx.fillRect(0, 0, W, bar); hx.fillRect(0, H - bar, W, bar);
    const cx0 = Math.round(W / 2 / p) * p;
    // the name card, stamped on the lower bar as the intro ends
    if (c && c.kind === 'start' && c.card != null && bar >= 10 * p) {
      const ct = c.t - c.card, big = ct < 3 ? 3 : 2, a2 = Math.min(1, ct / 2) * (c.hold ? 1 : Math.max(0, 1 - (c.t - c.rel) / 16));   // stamped in a size large, then set
      hx.globalAlpha = a2;
      const th = F.height('title'), sh = F.height('soft');
      const yT = Math.round((bar - sh * p) / 2 / p) * p, yB = H - bar + Math.max(0, Math.round((bar - th * big * p) / 2 / p) * p);
      tintText('THE BOTTOM', cx0, yT, 'soft', p, 'center', '#8a7a68');                // where you are, on the top bar
      tintText('The Sieve', cx0 + big * p / 2, yB + big * p / 2, 'title', p * big, 'center', 'rgba(10,6,8,0.6)');   // what it is, on the bottom
      tintText('The Sieve', cx0, yB, 'title', p * big, 'center', '#d0654f');
      hx.globalAlpha = 1;
      return;
    }
    const b = fx.bv; if (!b || bar < 10 * p) return;
    const line = b.lines[b.li].slice(0, Math.floor(b.shown));
    const y = H - bar + Math.round((bar - 20 * p) / 2 / p) * p;
    const shake = b.when === 'half' && Math.floor(t * 20) % 3 === 0 ? (Math.floor(t * 37) % 2 ? p : -p) : 0;   // angry words shake
    hx.globalAlpha = e;
    tintText(b.name, cx0 + p, y + p, 'soft', p, 'center', 'rgba(10,6,8,0.6)');
    tintText(b.name, cx0, y, 'soft', p, 'center', b.col);
    tintText(line, cx0 + p + shake, y + 11 * p + p, 'soft', p, 'center', 'rgba(10,6,8,0.6)');
    tintText(line, cx0 + shake, y + 11 * p, 'soft', p, 'center', '#efe2c6');
    hx.globalAlpha = 1;
  }

  // its final form, between the drawn pieces: the ring sheds dust where it is cracked, now and then
  // the whole grate gives a jolt that shakes loose a little stone; the eye lamps burn hot red
  function sieveFinalForm() {
    const B = sim.boss;
    if (!B) { fx.halfAge = 0; return; }
    if (B.hp <= 0 || !B.half) return;                                            // (its cracks stay as they are once it is dead)
    fx.halfAge = (fx.halfAge || 0) + 1;
    const a = fx.halfAge;
    if (a > 30 && a % 47 === 0) {
      const P = sieveCrackPaths().paths, path = P[(a / 47 | 0) % P.length], q = path.pts[Math.floor(path.pts.length * 0.6)] || path.pts[0];
      if (q && q.y > SIEVE_C.y - 60) {
        R.fx.smoke(q.x, q.y + 1, 1.6, 22, { vy: 0.12, vx: (Math.random() - 0.5) * 0.3 });
        for (let k = 0; k < 2; k++) R.fx.spark(q.x, q.y + 1, (Math.random() - 0.5) * 0.8, 0.2, 'sand', 9 + Math.random() * 5, { l0: 6, g: 0.22, len: 0.5 });
      }
    }
    if (a > 60 && a % 173 === 0) { cam.shake = Math.max(cam.shake, 1.6); A.impact(0.25); }
  }
  function bossSprites(t) {
    const B = sim.boss;
    if (!B) return [];
    const out = [], E = window.SpillBoss.EYES;
    if (!(fx.cut && fx.cut.kind === 'down') && B.hp > 0) out.push(...eyeAnimSprites(t));
    else E.forEach((e, k) => {
      const dying = fx.cut && fx.cut.kind === 'down', goneK = dying ? 2 - k < (fx.cut.dark || 0) : B.hp <= 0;   // eyes go out right to left
      const flick = dying && fx.cut.lastDark != null && fx.cut.t - fx.cut.lastDark < 8 && 2 - k === fx.cut.dark - 1 && (fx.cut.t & 1);
      const open = dying ? (!goneK || flick) : (k === B.open || (fx.cut && k < (fx.cut.eyes || 0))) && B.hp > 0;
      let rows = eyeRows(open, B.guard, Math.max(-1, Math.min(1, (B.lookX - (e.x + 14)) / 120)), open && fx.eyeWhite > 0, !!B.half && !goneK);
      if (!open && B.hp > 0 && !dbg.noMach && ((t * 0.23 + k * 0.37) % 1) < 0.035) rows = rows.map((r) => r.replace(/[r6]/g, 's'));   // a shut eye's seam catches the light now and then: it is still awake
      out.push({ x: e.x + 14 - (rows[0].length >> 1), y: e.y - rows.length - 1, rows, over: true });
    });
    for (let k = 0; k < B.fx.length; k += 3) out.push({ x: B.fx[k], y: B.fx[k + 1], rows: [B.fx[k + 2] ? 'n' : 'b'] });
    if (B.half || (fx.cut && fx.cut.kind === 'down') || B.hp <= 0) out.push(...sieveCracks());
    for (const st of B.stones) {
      if (st.t <= st.warn) {
        // a crack opening in the ceiling, and a shadow growing where it will land
        const k = st.t / st.warn, w = 3 + Math.round(k * 8);
        out.push({ x: st.x - 2, y: 16, rows: [Math.floor(t * 12) % 2 ? '2.2.2' : '.2.2.'] });
        if (st.shadow != null) out.push({ x: st.x - Math.floor(w / 2), y: st.shadow - 1, rows: ['u'.repeat(w)] });
      } else { const rk = turnRows(rockRows(st.x | 0, st.small), Math.floor(st.y / 9)), hw = rk.length >> 1; out.push({ x: st.x - hw, y: Math.round(st.y) - rk.length, rows: rk, over: true }); }
    }
    if (B.sweep && B.sweep.t >= 80) {
      const x = Math.round(B.sweep.x);
      out.push({ x: x - 3, y: 243, rows: ['...n...', '..non..', '.nonon.', 'nonnnon', 'ooooooo', 'ooooooo', 'ooooooo'], over: true });
    }
    return out;
  }
  // The Keeper standing at a shrine: hooded, three-quarter, moonlit on one
  // side, lit by the lantern he holds low on the other. Two frames: the
  // flame flickers and the hem stirs.
  const KEEPER_STAND = [
    ['...ssq.....', '..srrqq....', '.srrrrqp...', '.sruuuqp...', '.sruuuqqp..', '.qrruqqqp..', 'sqrrqqqqqp.', 'sqrqqrqqqp.', 'srqqqrqqtp.', 'qrqqqrqtt3.', 'qrqqqqrqp3.', 'qrqqqqrqp3.', 'qrqqqqrp.4.', 'qqrqqqrp434', 'qqrqqqqp474', 'qqrqqqqp434', 'pqqrqqqqp4.'],
    ['...ssq.....', '..srrqq....', '.srrrrqp...', '.sruuuqp...', '.sruuuqqp..', '.qrruqqqp..', 'sqrrqqqqqp.', 'sqrqqrqqqp.', 'srqqqrqqtp.', 'qrqqqrqtt3.', 'qrqqqqrqp3.', 'qrqqqqrqp3.', 'qrqqqqrp.4.', 'qqrqqqrp434', 'qqrqqqqp484', 'qqrqqqqp434', '.pqqrqqqqp.'],
  ];
  // a checkpoint lamp post: an iron post and a caged lantern; cold until your sand touches it
  const LAMP_POST = ['.k1k.', 'k222k', 'k2.2k', 'kFFFk', 'kFHFk', 'kFFFk', 'k222k', '.k1k.', '..1..', '..1..', '..1..', '..1..', '..1..', '..1..', '.k2k.', 'k222k'];
  function lampSprites(t) {
    const def = inWorld() && WORLD.rooms[run.world.room];
    if (!def || !def.lamp) return [];
    const lit = run.world.lamps && run.world.lamps[def.id], fl = Math.sin(t * 9) > 0.3;
    const rows = LAMP_POST.map((r) => r.replace(/F/g, lit ? (fl ? '7' : '6') : '9').replace(/H/g, lit ? '8' : '2').replace(/k/g, '1'));
    return [{ x: def.lamp.x - 2, y: def.lamp.y - rows.length, rows }];
  }
  function propSprites(t) {
    return lampSprites(t).concat(sim.props.flatMap((p) => {
      if (p.kind === 'sleeper') return sleeperSprites(p, t);
      if (p.kind === 'smallGlass') return glassSprites(p, t);
      if (p.kind === 'keeper') {
        // his lantern is dark until your sand has touched him once; then it burns (and flickers)
        const rows = KEEPER_STAND[Math.floor(t * 3.3 + Math.sin(t * 1.7)) % 2 === 0 ? 0 : 1], lit = inWorld() && run.world.keeperLit && run.world.keeperLit[run.world.room];
        return [{ x: p.x, y: p.y, rows: lit ? rows : rows.map((r) => r.replace(/[78]/g, '2').replace(/t/g, 'q')) }];
      }
      if (p.kind === 'banner') {
        const ph = Math.sin(t * (0.6 + p.amp * 0.3) + p.phase) * p.amp;
        const src = p.rows || BANNER, start = Math.floor(src.length * 0.45);
        const rows = src.map((row, r) => {
          const shift = r > start ? Math.round(ph * (r - start) / 8) : 0;
          return shift > 0 ? '.'.repeat(shift) + row.slice(0, row.length - shift) : shift < 0 ? row.slice(-shift) + '.'.repeat(-shift) : row;
        });
        return { x: p.x, y: p.y, rows };
      }
      const f = LANTERN_FLAME[Math.floor(t * 5 + p.x * 0.37) % LANTERN_FLAME.length];
      return { x: p.x, y: p.y, rows: LANTERN_TOP.concat(f, LANTERN_BOT) };
    }));
  }

  // ---------- HUD: hand-made pixel font and icons on the world's pixel grid ----------
  const DIGITS = {
    0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'],
    2: ['###', '..#', '###', '#..', '###'], 3: ['###', '..#', '.##', '..#', '###'],
    4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'],
    6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'],
    8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '###'],
  };
  // Hourglass: '#' frame, 's' sand (only drawn when filled)
  const GLASS = ['#####', '#sss#', '.#s#.', '..#..', '.#.#.', '#sss#', '#####'];
  const COL = { sand: '#e9bb6c', frame: '#c9b9a6', dim: '#5b4f47', shadow: 'rgba(6,4,10,0.6)' };

  function blit(rows, x, y, p, map) {
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      const col = map[rows[r][c]];
      if (!col) continue;
      hx.fillStyle = COL.shadow; hx.fillRect(x + c * p + p, y + r * p + p, p, p);
    }
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      const col = map[rows[r][c]];
      if (!col) continue;
      hx.fillStyle = col; hx.fillRect(x + c * p, y + r * p, p, p);
    }
  }
  // Right-aligned number; returns its left edge.
  function number(n, right, y, p, col) {
    const str = String(n);
    let x = right - (str.length * 4 - 1) * p;
    const left = x;
    for (const ch of str) { blit(DIGITS[ch], x, y, p, { '#': col }); x += 4 * p; }
    return left;
  }
  // The meter: a 9x13 pixel hourglass whose bulbs fill with real proportions.
  const METER = ['#########', '#.......#', '#.......#', '.#.....#.', '..#...#..', '...#.#...', '....#....',
    '...#.#...', '..#...#..', '.#.....#.', '#.......#', '#.......#', '#########'];
  function meter(x, y, p, top, bottom, enough, t) {
    // interior cells of each bulb, listed from the bottom of the bulb upward
    const cellsOf = (r0, r1) => {
      const out = [];
      for (let r = r1; r >= r0; r--) for (let c = 0; c < 9; c++) if (METER[r][c] === '.' && insideRow(r, c)) out.push([r, c]);
      return out;
    };
    const topCells = cellsOf(1, 5), botCells = cellsOf(7, 11);
    const fill = new Set();
    topCells.slice(0, Math.round(top * topCells.length)).forEach(([r, c]) => fill.add(r * 9 + c));
    botCells.slice(0, Math.round(bottom * botCells.length)).forEach(([r, c]) => fill.add(r * 9 + c));
    const frame = enough ? '#e9cf98' : COL.frame;
    for (let r = 0; r < 13; r++) for (let c = 0; c < 9; c++) {
      const ch = METER[r][c];
      let col = null;
      if (ch === '#') col = frame;
      else if (fill.has(r * 9 + c)) col = COL.sand;
      else if (insideRow(r, c)) col = 'rgba(20,16,30,0.55)';
      if (!col) continue;
      hx.fillStyle = COL.shadow; hx.fillRect(x + c * p + p / 2, y + r * p + p / 2, p, p);
      hx.fillStyle = col; hx.fillRect(x + c * p, y + r * p, p, p);
    }
    // a trickle through the neck while sand is going home
    if (fx.exitPulse > 0.05 && Math.floor(t * 12) % 2 === 0) { hx.fillStyle = COL.sand; hx.fillRect(x + 4 * p, y + 6 * p, p, p); }
  }
  function insideRow(r, c) {
    const row = METER[r];
    const l = row.indexOf('#'), rr = row.lastIndexOf('#');
    return c > l && c < rr;
  }
  function hourglass(x, y, p, filled) {
    blit(GLASS, x, y, p, { '#': filled ? COL.frame : COL.dim, s: filled ? COL.sand : null });
  }
  // Draw sprite rows onto the HUD exactly over world cells: each cell's
  // edges are rounded once, so UI pixels line up with the world's pixels.
  const AIM_COL = { d: '#fbe2a2', b: '#e3b062', c: '#6e4524', e: 'rgba(233,187,108,0.5)', f: 'rgba(233,187,108,0.25)', 7: '#ffb347', 8: '#fff3d6' };
  function worldBlit(rows, x0, y0, map) {
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      const col = map[rows[r][c]];
      if (!col) continue;
      const X0 = Math.round(wsx(x0 + c)), X1 = Math.round(wsx(x0 + c + 1)), Y0 = Math.round(wsy(y0 + r)), Y1 = Math.round(wsy(y0 + r + 1));
      hx.fillStyle = col; hx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    }
  }
  const wsx = (x) => (x - cam.x) * R.effScale;
  const wsy = (y) => (y - cam.y) * R.effScale;

  // ---- top-right readout art: hand-drawn icons in four or five shades each ----
  // k outline, d dark, m mid, l light, h highlight
  const HUD_ICONS = {
    hammer: ['...........', '.kkkkkkkkk.', 'kllhhllmmdk', 'klhhlllmmdk', 'kmllllmmddk', '.kddmmdddk.', '..kkkmkkk..', '....kmk....', '....kmk....', '....kdk....', '....kkk....'],
    shard: ['.....k.....', '....khk..k.', '....khk.khk', '.k..klk.klk', 'khk.klk.kmk', 'klk.kmk.kmk', 'kmk.kmk.kdk', 'kmdkkmdkkk.', '.kdkkmdk...', '..kkkddk...', '....kkk....'],
    star: ['.....k.....', '....khk....', '....khk....', 'kkkkhlhkkkk', '.khhlllllk.', '..kmllllk..', '...kmlmk...', '..kmdkdmk..', '..kdk.kdk..', '.kdk...kdk.', '.kk.....kk.'],
    drop: ['.k.', 'khk', 'kmk', '.k.'],
    pile: ['...kk...', '..klhk..', '.klhlmk.', 'kmlmmmdk'],
  };
  const HUD_PAL = {
    sun: { k: '#2a1d14', d: '#8a5a2a', m: '#c98d45', l: '#ecc174', h: '#fff1c8' },
    frost: { k: '#141c2c', d: '#2f5c8f', m: '#4f93c9', l: '#93d2ee', h: '#e6fbff' },
    sand: { k: '#24180e', d: '#8f6535', m: '#cb9a58', l: '#f0cf8e', h: '#fff4d6' },
    star: { k: '#22142c', d: '#7a3f9e', m: '#c45fb5', l: '#f3a0c8', h: '#fff0f3' },
    dim: { k: '#16121c', d: '#2a2430', m: '#342d3a', l: '#3e3644', h: '#4a4250' },
    poor: { k: '#1a0c0c', d: '#3a1614', m: '#5a2420', l: '#6e2e28', h: '#8a3a30' },
  };
  // a small iron plate: chipped corners, lit top edge, shadowed bottom, a few nicks (never a ruled box)
  function hudPlate(x, y, w, h, p, lit) {
    hx.fillStyle = 'rgba(10,8,15,0.82)'; hx.fillRect(x + p, y + p, w - 2 * p, h - 2 * p);
    hx.fillStyle = lit ? '#6a5a44' : '#4a4250';                                         // top and left: lit
    hx.fillRect(x + 2 * p, y, w - 4 * p, p); hx.fillRect(x, y + 2 * p, p, h - 4 * p);
    hx.fillStyle = '#231e29';                                                            // bottom and right: shade
    hx.fillRect(x + 2 * p, y + h - p, w - 4 * p, p); hx.fillRect(x + w - p, y + 2 * p, p, h - 4 * p);
    hx.fillStyle = lit ? '#3e3428' : '#332c39';                                         // chipped corners
    hx.fillRect(x + p, y + p, p, p); hx.fillRect(x + w - 2 * p, y + p, p, p); hx.fillRect(x + p, y + h - 2 * p, p, p); hx.fillRect(x + w - 2 * p, y + h - 2 * p, p, p);
    hx.fillStyle = 'rgba(10,8,15,0.9)';                                                  // nicks in the edge
    hx.fillRect(x + Math.round(w * 0.63 / p) * p, y, p, p); hx.fillRect(x + w - p, y + Math.round(h * 0.7 / p) * p, p, p);
    if (lit) { hx.fillStyle = '#a88d5c'; hx.fillRect(x + 3 * p, y, 2 * p, p); }
  }
  // ---- the Proving Hall course: one station at a time, shown, then ticked off ----
  // dev: 'L' / 'R' mouse buttons, 'drag' (right drag), or a key; mode: 'hold' | 'tap'
  const COURSE = [
    { id: 'lean', say: 'Hold {L} anywhere, and your sand leans and rolls toward it.', x0: 0, x1: 165, title: 'Lean', dev: 'L', mode: 'hold', how: ['Hold the left button somewhere.', 'Your sand leans and rolls to it.'], done: () => tut.poured > 90 },
    { id: 'look', say: 'Hold {W} {A} {S} {D} to look ahead. Let go, and the view comes back.', x0: 0, x1: 165, title: 'Look around', dev: 'WASD', mode: 'hold', how: ['Hold W A S D to look ahead.', 'Let go and the view drifts back.'], done: () => tut.ev.look },
    { id: 'climb', say: 'Rough stone can be climbed. Lean into it with {L} and keep holding.', x0: 140, x1: 255, title: 'Climb', dev: 'L', mode: 'hold', how: ['Lean into rough stone, keep holding.', 'Your sand climbs it.'], done: (s) => { for (let i = 0; i < s.N; i += 3) if (s.state[i] === 1 && s.px[i] >= 168 && s.px[i] <= 202 && s.py[i] < 231) return true; return false; } },
    { id: 'throw', say: 'Smooth walls cannot. Press {R} on your sand, drag back like a sling, and let go.', x0: 230, x1: 320, title: 'Throw yourself', dev: 'drag', mode: 'hold', how: ['Press right button on your sand,', 'drag back like a sling, let go.', 'Smooth walls: throw yourself over.'], done: () => tut.launched },
    { id: 'plate', say: 'Leave a heap of sand resting on the brass plate. Its weight lifts the gate.', x0: 300, x1: 460, title: 'Weigh', dev: 'L', mode: 'hold', how: ['Rest a heap on the brass plate.', 'Its weight lifts the iron gate.'], done: (s) => (s.mechs || []).some((m) => m.kind === 'plate' && (m.open > 0.5 || m.latched)) },
    { id: 'basin', say: 'Pour sand into the stone tub with {L}. The fuller it is, the higher the platform.', x0: 460, x1: 615, title: 'Fill', dev: 'L', mode: 'hold', how: ['Pour sand into the stone tub.', 'Fuller tub, higher platform.'], done: (s) => (s.mechs || []).some((m) => m.kind === 'lift' && m.plat.off >= m.rise * 0.6) },
    { id: 'lamp', say: 'Spend a little sand in the brazier. A lit lamp opens the wall beside it.', x0: 600, x1: 730, title: 'Feed the lamp', dev: 'L', mode: 'hold', how: ['Spend a little sand in the brazier.', 'A lit lamp opens the wall.'], done: (s) => (s.mechs || []).some((m) => m.kind === 'lamp' && m.lit) },
    { id: 'slow', say: 'Hold {SPACE} and the world slows. Cross under the blade between swings.', x0: 720, x1: 905, title: 'Slow time', dev: 'Space', mode: 'hold', how: ['Hold Space: the world slows.', 'Cross under the blade.', 'Short holds are free.'], done: () => tut.ev.slow },
    { id: 'ftap', say: 'Tap {F}: your sand bursts out toward the cursor. Five, then it rests.', x0: 900, x1: 1040, title: 'Burst', dev: 'F', mode: 'tap', how: ['Tap F: a burst at the cursor.', 'Three in a row, then a rest.'], done: () => tut.ev.ftap },
    { id: 'qtap', say: 'Tap {Q}: your grains gather into a bolt that flies far. It wobbles; aim well.', x0: 900, x1: 1040, title: 'Bolt', dev: 'Q', mode: 'tap', how: ['Cursor on a creature: a red mark.', 'Tap Q: a bolt curves toward it.'], done: () => tut.ev.qtap },
    { id: 'slam', say: 'Your strongest blow: throw yourself up with {R}, then throw down hard onto a creature.', x0: 900, x1: 1040, title: 'Slam', dev: 'drag', mode: 'hold', how: ['Your strongest blow: throw up,', 'then throw down hard onto a creature.'], done: () => tut.ev.slam },
    { id: 'hammer', say: 'Hold {F}: a hammer forms and the world nearly stops. Aim, then let go.', x0: 900, x1: 1040, title: 'Hammer', dev: 'F', mode: 'hold', how: ['Hold F: a hammer forms, time stops.', 'Aim, then let go to bring it down.'], done: () => tut.ev.hammer },
    { id: 'shards', say: 'Hold {Q}: shards rise out of your sand. A red mark finds a creature. Let go.', x0: 900, x1: 1040, title: 'Shards', dev: 'Q', mode: 'hold', how: ['Hold Q: shards form above you.', 'Let go: they fly at the mark.'], done: () => tut.ev.icicleFire },
    { id: 'super', say: 'When the star is full, tap {X}. Fallen creatures and passed rooms fill it.', x0: 900, x1: 1040, title: 'Falling stars', dev: 'X', mode: 'tap', how: ['When the star socket is full, tap X.', 'Defeats and rooms fill it.'], done: () => tut.ev.superUp },
  ];
  const courseState = { cur: null, doneAt: 0, doneId: null };
  // the first chamber teaches the basics where they are first needed (the Keeper only tells the story)
  const inBox = (s, x0, x1, y0, y1) => { let n = 0; for (let i = 0; i < s.N; i += 2) if (s.state[i] === 1 && s.px[i] >= x0 && s.px[i] < x1 && s.py[i] >= y0 && s.py[i] < y1) n += 2; return n; };
  const COURSE_CISTERN = [
    { id: 'c_lean', say: 'Hold {L} anywhere, and your sand leans and rolls toward it.', at: (s) => s.frame > 100, title: 'Lean', dev: 'L', mode: 'hold', how: ['Hold the left button somewhere.', 'Your sand leans and rolls to it.'], done: () => tut.poured > 90 },
    { id: 'c_look', say: 'Hold {W} {A} {S} {D} to look ahead. Let go, and the view comes back.', at: (s) => s.frame > 100, title: 'Look around', dev: 'WASD', mode: 'hold', how: ['Hold W A S D to look ahead.', 'Let go and the view drifts back.'], done: () => tut.ev.look },
    { id: 'c_throw', say: 'This wall is smooth. Press {R} on your sand, drag back like a sling, and let go.', at: (s) => inBox(s, 200, 300, 200, 252) > 200, title: 'Throw yourself', dev: 'drag', mode: 'hold', how: ['Press right button on your sand,', 'drag back like a sling, let go.', 'Smooth walls: throw yourself over.'], done: () => tut.launched },
    { id: 'c_gather', say: 'Lean your sand into one heap with {L} before you leap. Strays stay behind.', at: (s) => inBox(s, 310, 440, 180, 252) > 120, title: 'Gather first', dev: 'L', mode: 'hold', how: ['Lean your sand into one heap', 'before you leap. Strays stay behind.'], done: (s) => s.body.n && s.body.x > 470 },
    { id: 'c_climb', say: 'Rough stone can be climbed. Lean into it with {L} and keep holding.', at: (s) => inBox(s, 490, 612, 160, 252) > 100, title: 'Climb', dev: 'L', mode: 'hold', how: ['Lean into rough stone, keep holding.', 'Your sand climbs it.'], done: (s) => inBox(s, 490, 612, 0, 150) > 20 },
    { id: 'c_exit', say: 'When you are ready, click the glowing funnel with {L} to go down.', at: (s) => s.enough, title: 'Go down', dev: 'L', mode: 'tap', how: ['Click the glowing funnel', 'when you are ready to go on.'], done: (s) => s.exited > 0 && fx.result },
  ];
  function courseLesson() {
    if (!sim.body.n || screen !== 'game') return null;
    const key = inWorld() ? (run.world.room === 'hall' ? 'hall' : null) : (currentLevel().id === 'cistern' && !run.descent ? 'cistern' : null);
    if (!key) return null;
    const taught = run.taught || (run.taught = {});
    const done = (taught.course || (taught.course = {}));
    const bx = sim.body.x;
    for (const L of key === 'hall' ? COURSE : COURSE_CISTERN) {
      if (done[L.id]) continue;
      if (L.at ? !L.at(sim) : (bx < L.x0 - 10 || bx > L.x1 + 10)) continue;
      if (L.done(sim)) { done[L.id] = true; courseState.doneId = L.id; courseState.doneAt = performance.now(); A.chime(0.5); continue; }
      return L;
    }
    return null;
  }
  // a keycap (a letter on a little stone key) or a mouse, animated to show tap / hold / drag
  function drawDevice(L, x, y, p, t) {
    const press = L.mode === 'tap' ? (t * 1.4) % 1 < 0.25 : true, held = L.mode === 'hold' ? (t * 0.6) % 1 : 0;
    if (L.dev === 'L' || L.dev === 'R' || L.dev === 'drag') {
      const right = L.dev !== 'L', dx = L.dev === 'drag' ? Math.round(-Math.min(1, ((t * 0.7) % 1) * 1.6) * 6) * p : 0;
      const M = ['..kkkkk..', '.kLLkRRk.', 'kLLLkRRRk', 'kLLLkRRRk', 'kkkkkkkkk', 'kbbbbbbbk', 'kbbbbbbbk', 'kbbbbbbdk', 'kbbbbbbdk', '.kbbbbdk.', '..kkkkk..'];
      M.forEach((r, ry) => [...r].forEach((ch, rx) => {
        if (ch === '.') return;
        const lit = (ch === 'L' && !right) || (ch === 'R' && right);
        hx.fillStyle = ch === 'k' ? '#1a1520' : ch === 'd' ? '#8d8070' : ch === 'b' ? '#d8ccb6' : lit ? (press ? '#ffd27a' : '#8a6a2a') : '#bfb29c';
        hx.fillRect(x + dx + rx * p, y + ry * p, p, p);
      }));
      if (L.dev === 'drag') for (let k = 1; k < 4; k++) { hx.fillStyle = `rgba(255,210,122,${0.5 - k * 0.12})`; hx.fillRect(x + dx + (4 + k * 2) * p, y + 5 * p, p, p); }
      if (L.mode === 'hold' && L.dev !== 'drag') { hx.fillStyle = '#2a2430'; hx.fillRect(x, y + 13 * p, 9 * p, p); hx.fillStyle = '#ffd27a'; hx.fillRect(x, y + 13 * p, Math.round(9 * held) * p, p); }
      return;
    }
    const keys = L.dev === 'WASD' ? [['W', 6, 0], ['A', 0, 7], ['S', 6, 7], ['D', 12, 7]] : [[L.dev, 0, 0]];
    for (const [ch, kx, ky] of keys) {
      const wide = ch === 'Space', w = (wide ? 22 : L.dev === 'WASD' ? 6 : 11) * p, h = (L.dev === 'WASD' ? 6 : 11) * p;
      const X = x + kx * p, Y = y + ky * p + (press && (L.dev !== 'WASD' || Math.floor(t * 2) % 4 === 'WASD'.indexOf(ch)) ? p : 0);
      hx.fillStyle = '#1a1520'; hx.fillRect(X, Y + p, w, h);                    // the key's shadow side
      hx.fillStyle = '#cbbfa8'; hx.fillRect(X, Y, w, h - p);
      hx.fillStyle = '#efe6d2'; hx.fillRect(X + p, Y, w - 2 * p, p);            // lit top edge
      hx.fillStyle = '#8d8070'; hx.fillRect(X + w - p, Y + p, p, h - 2 * p);
      const ls = Math.max(1, Math.round(p * (L.dev === 'WASD' ? 0.45 : 0.6))), lh = F.height('soft') * ls;
      tintText(wide ? 'space' : ch, X + w / 2, Y + Math.round((h - p - lh) / 2), 'soft', ls, 'center', '#2a2018');
    }
    if (L.mode === 'hold' && L.dev !== 'WASD') { const w = (L.dev === 'Space' ? 22 : 11) * p; hx.fillStyle = '#2a2430'; hx.fillRect(x, y + 13 * p, w, p); hx.fillStyle = '#ffd27a'; hx.fillRect(x, y + 13 * p, Math.round(w / p * held) * p, p); }
  }
  function courseTick() {
    const L = courseLesson();
    if (!L || courseState.said === L.id || keeper.line || keeper.queue.length) return;
    courseState.said = L.id;
    keeper.queue.push({ text: L.say, tutor: true, until: () => ((run.taught || {}).course || {})[L.id] || courseLesson() !== L });
  }
  function slatePlate(x, y, w, h, p) {
    hx.fillStyle = 'rgba(14,20,28,0.92)'; hx.fillRect(x + p, y + p, w - 2 * p, h - 2 * p);
    hx.fillStyle = '#6a7e92'; hx.fillRect(x + 2 * p, y, w - 4 * p, p); hx.fillRect(x, y + 2 * p, p, h - 4 * p);
    hx.fillStyle = '#26303c'; hx.fillRect(x + 2 * p, y + h - p, w - 4 * p, p); hx.fillRect(x + w - p, y + 2 * p, p, h - 4 * p);
    hx.fillStyle = '#3e4c5c'; hx.fillRect(x + p, y + p, p, p); hx.fillRect(x + w - 2 * p, y + p, p, p); hx.fillRect(x + p, y + h - 2 * p, p, p); hx.fillRect(x + w - 2 * p, y + h - 2 * p, p, p);
    hx.fillStyle = 'rgba(14,20,28,0.95)'; hx.fillRect(x + Math.round(w * 0.71 / p) * p, y, p, p); hx.fillRect(x, y + Math.round(h * 0.6 / p) * p, p, p);
    // the tab
    const tw = (F.measure('how to', 'soft') + 8) * p;
    hx.fillStyle = '#2c3a4a'; hx.fillRect(x + 6 * p, y - 9 * p, tw, 9 * p); hx.fillStyle = '#6a7e92'; hx.fillRect(x + 6 * p, y - 9 * p, tw, p);
    tintText('how to', x + 10 * p, y - 7 * p, 'soft', p, 'left', '#a8c4dc');
  }
  function drawCourse(t) {
    const L = courseLesson(), W = hud.width, H = hud.height, p = R.scale;
    const since = (performance.now() - courseState.doneAt) / 1000;
    if (!L && !(since < 1.4)) return;
    const dp = p * 3;                                  // the key / mouse drawn large, so it reads at a glance
    const lines = L ? L.how : [], lineH = 9 * p;
    const devW = L ? (L.dev === 'Space' ? 22 : L.dev === 'WASD' ? 18 : L.dev === 'drag' ? 15 : 11) * dp : 9 * p;
    const textW = Math.max(F.measure(L ? L.title : 'learned', 'soft'), ...lines.map((l) => F.measure(l, 'soft'))) * p;
    const pw = Math.min(W - 40 * p, devW + textW + 26 * p), ph = Math.max(14 * dp + 12 * p, (12 + lines.length * 9) * p + 8 * p);
    const x = Math.round((W - pw) / 2 / p) * p, y = Math.round(H * 0.2 / p) * p;
    slatePlate(x, y, pw, L && !(since < 1.0 && courseState.doneId) ? ph : 22 * p, p);
    if (!L || since < 1.0 && courseState.doneId) {
      // just learned: a check and the lesson's name, then the next station
      const C = ['.........k', '........kg', '.......kgk', 'k.....kgk.', 'gk...kgk..', 'kgk.kgk...', '.kgkgk....', '..kgk.....', '...k......'];
      C.forEach((r, ry) => [...r].forEach((ch, rx) => { if (ch === '.') return; hx.fillStyle = ch === 'k' ? '#1a2a14' : '#9fdc6a'; hx.fillRect(x + 7 * p + rx * p, y + 6 * p + ry * p, p, p); }));
      const D = COURSE.find((c) => c.id === courseState.doneId);
      F.draw(hx, (D ? D.title : '') + '  learned', x + 21 * p, y + 7 * p, 'soft', p, 'left');
      return;
    }
    drawDevice(L, x + 8 * p, y + 8 * p, dp, t);
    // what to do with it, in plain letters under the drawing
    const tag = L.mode === 'tap' ? 'tap' : L.dev === 'drag' ? 'drag' : 'hold';
    tintText(tag, x + 8 * p + devW / 2, y + ph - 10 * p, 'soft', p, 'center', '#ffd27a');
    const tx = x + 8 * p + devW + 10 * p;
    tintText(L.title, tx, y + 5 * p, 'soft', p, 'left', '#ffd27a');
    hx.globalAlpha = 0.85;
    lines.forEach((line, k) => F.draw(hx, line, tx, y + 15 * p + k * lineH, 'soft', p, 'left'));
    hx.globalAlpha = 1;
    // how far through the course: one small notch per lesson along the bottom edge
    const done = (run.taught || {}).course || {}, n = COURSE.length;
    for (let k = 0; k < n; k++) { hx.fillStyle = done[COURSE[k].id] ? '#c9a45e' : COURSE[k] === L ? '#efe6d2' : '#3a3240'; hx.fillRect(x + pw - (n - k) * 3 * p - 4 * p, y + ph - 3 * p, 2 * p, p); }
  }
  // text in any colour: draw the font into a scratch canvas, then paint over its pixels
  const tintCv = document.createElement('canvas'), tintCx = tintCv.getContext('2d');
  function tintText(text, x, y, font, p, align, col) {
    const w = Math.ceil((F.measure(text, font) + 4) * p), h = Math.ceil((F.height(font) + 6) * p);
    if (tintCv.width < w || tintCv.height < h) { tintCv.width = Math.max(tintCv.width, w); tintCv.height = Math.max(tintCv.height, h); }
    tintCx.clearRect(0, 0, tintCv.width, tintCv.height);
    tintCx.globalCompositeOperation = 'source-over';
    F.draw(tintCx, text, 2 * p, 3 * p, font, p, 'left');
    tintCx.globalCompositeOperation = 'source-atop'; tintCx.fillStyle = col; tintCx.fillRect(0, 0, w, h);
    const ox = align === 'center' ? -F.measure(text, font) * p / 2 : align === 'right' ? -F.measure(text, font) * p : 0;
    hx.drawImage(tintCv, 0, 0, w, h, Math.round(x + ox - 2 * p), Math.round(y - 3 * p), w, h);
  }
  // the combo: a carved count on the right that bumps with every hit, warms as it climbs,
  // and drains a ragged bar until the chain breaks
  function drawCombo(t, p, rowTop) {
    const C = fx.combo; if (!C) return;
    const live = sim.combo && sim.combo.t > 0 && sim.combo.n === C.n;
    if (!live) { C.fade = (C.fade || 0) + 1; if (C.fade > 40) { fx.combo = null; return; } }
    const W = hud.width, n = C.n, a = live ? 1 : 1 - C.fade / 40;
    const tier = n >= 12 ? ['#ffffff', '#ffd9a0', '#5a2412'] : n >= 8 ? ['#ffe6a8', '#f08a3a', '#4a1a10'] : n >= 4 ? ['#fff0c4', '#e9bb6c', '#3a2414'] : ['#efe6d2', '#c9b597', '#2a2230'];
    const bump = C.bump > 0 ? C.bump-- : 0, sz = Math.round(p * (2 + Math.min(1, n / 12)) * (1 + bump * 0.04));
    const x = W - 22 * p, y = rowTop + Math.round(Math.sin(bump * 1.7) * bump * 0.3) * p;
    hx.globalAlpha = a;
    tintText(String(n), x + Math.round(sz / 2), y + Math.round(sz / 2), 'num', sz, 'right', tier[2]);
    tintText(String(n), x, y, 'num', sz, 'right', bump > 5 ? '#ffffff' : tier[1]);
    hx.globalAlpha = a * 0.7;
    const hy = y + F.height('num') * sz + 3 * p;
    tintText(n === 1 ? 'hit' : 'hits', x, hy, 'soft', p, 'right', tier[1]);
    const left = live ? sim.combo.t / 110 : 0, bw = 30, by = hy + (F.height('soft') + 3) * p;
    for (let k = 0; k < bw; k++) {
      const on = k < bw * left;
      hx.fillStyle = on ? (k > bw * left - 2 ? tier[0] : tier[1]) : 'rgba(42,34,48,0.8)';
      hx.fillRect(x - (bw - k) * p, by, p, on ? p + ((k * 3) % 4 === 0 ? p : 0) : p);
    }
    hx.globalAlpha = 1;
  }
  // ---- the backpack: a row at the bottom of the top-right HUD, and a thin popup under it ----
  const bag = { open: false, sel: -1, t: 0, sellPending: null, btn: null, hits: [] };
  function bagLayout() {
    const p = R.scale, m = 8 * p, rowW = 3 * 15 * p + 2 * 6 * p;
    const rowY = m + 2 * p + 15 * p;                      // where the sockets sit
    return { p, m, rowW, x: W_() - m - rowW, y: rowY + 15 * p + 11 * p, h: 16 * p };
  }
  const W_ = () => hud.width;
  function bagActions(k) {
    // what you can do with a lens from the backpack: sell it for sand, or mend it (between rooms of the world)
    const d = purse(), held = heldList(d), h = held[k]; if (!h || !d) return [];
    const l = Object.assign({}, lensById[h.id], { q: h.q, life: h.life }), refund = Math.round(lensCost(l) * 0.4), out = [];
    out.push({ label: bag.sellPending === k ? 'Sure? ' + refund : 'Sell ' + refund, can: () => true,
      act: () => { if (bag.sellPending !== k) { bag.sellPending = k; return; } d.lenses.splice(k, 1); d.carried += refund; bag.sellPending = null; bag.sel = Math.max(0, Math.min(k, held.length - 2)); A.exitChime(20); saveRun(); } });
    const mc = Math.round(Math.max(40, d.carried * 0.1) * (2 - h.q));
    if (h.q >= 2) out.push({ label: 'Whole', can: () => false, act: () => {} });
    else out.push({ label: 'Mend ' + mc, can: () => d.carried >= mc, act: () => { if (d.carried < mc) return; d.carried -= mc; const nq = h.q + 1; d.lenses[k] = { id: h.id, q: nq, life: nq >= 2 ? null : qOf(nq).life, debuff: null }; bag.sellPending = null; A.chime(0.6); saveRun(); } });
    return out;
  }
  function bagClick(px, py) {
    const inB = (b) => b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
    if (inB(bag.btn)) { bag.open = !bag.open; bag.sel = 0; bag.sellPending = null; A.glance(); return true; }
    if (!bag.open) return false;
    for (const hb of bag.hits) if (inB(hb)) { hb.act(); return true; }
    if (inB(bag.panel)) return true;                                                // a click inside the popup does nothing else
    return false;
  }
  function drawBag(t) {
    if (!sim || screen !== 'game' || pause.on || shrine.on || (fx.letter || 0) >= 0.3) { bag.btn = null; bag.open = false; bag.t = 0; return; }   // not in the shop, nor under a cutscene's letterbox
    const L0 = bagLayout(), p = L0.p, d = purse(), held = heldList(d);
    const mxs = mouse.sx * dpr, mys = mouse.sy * dpr, over = (b) => mouse.inside && mxs >= b.x && mxs <= b.x + b.w && mys >= b.y && mys <= b.y + b.h;
    const say = (txt, x, y, col, align) => { tintText(txt, x + p, y + p, 'soft', p, align || 'left', '#0a0608'); tintText(txt, x, y, 'soft', p, align || 'left', col); };
    const midY = (y0, h0) => Math.round((y0 + h0 / 2 - 4.5 * p) / p) * p;
    // the row: a plate as wide as the sockets, the rucksack and the count centred on it
    bag.btn = { x: L0.x, y: L0.y, w: L0.rowW, h: L0.h };
    const hot = over(bag.btn) || bag.open, label = held.length + '/' + MAX_LENSES, RW = RUCKSACK[0].length, cw = RW * p + 5 * p + F.measure(label, 'soft') * p;
    hx.globalAlpha = 1;
    hudPlate(L0.x, L0.y, L0.rowW, L0.h, p, hot);
    const cx0 = Math.round((L0.x + L0.rowW / 2 - cw / 2) / p) * p;
    drawRucksack(cx0, L0.y + Math.round((L0.h - 12 * p) / 2 / p) * p, p, hot);
    say(label, cx0 + (RW + 5) * p, midY(L0.y, L0.h), hot ? '#ffe2a0' : '#e8dcc4');
    // the popup: right under the row, a fixed height, one lens to a page. What it does, how
    // long it lasts, and what you can do with it; triangles (or the arrow keys) turn the pages.
    bag.t = Math.max(0, Math.min(1, bag.t + (bag.open ? 0.2 : -0.25)));
    bag.hits = []; bag.panel = null;
    if (bag.t <= 0) return;
    const n = held.length, py0Of = () => L0.y + L0.h + 3 * p;
    if (bag.sel < 0 || bag.sel >= n) bag.sel = Math.max(0, Math.min(n - 1, bag.sel));
    const PW = 124 * p, LH = 10 * p, icon = CARD * p, PADX = 6 * p;
    // the layout flows from the top: portrait, description, actions just under it, then the
    // page turner. The description gets as many lines as the wordiest lens you carry, so the
    // popup stays one height while you page through, with no gap under a short one.
    const descW = PW - 2 * PADX, lines = Math.max(1, ...held.map((h) => Math.min(3, wrapText(lensById[h.id].desc || '', descW, 'soft', p).length)));
    const top = py0Of() + 5 * p, descY = top + icon + 3 * p, ay = descY + lines * LH + 6 * p, ny = ay + LH + 5 * p;
    const PH = n ? ny + 7 * p + 5 * p - py0Of() : 22 * p;
    const ease = 1 - Math.pow(1 - bag.t, 3), ph = Math.max(6 * p, Math.round(PH * ease / p) * p);
    const px0 = W_() - L0.m - PW, py0 = py0Of();
    bag.panel = { x: px0, y: py0, w: PW, h: ph };
    hudPlate(px0, py0, PW, ph, p, false);
    hx.save(); hx.beginPath(); hx.rect(px0, py0, PW, ph); hx.clip();
    const button = (label, x, y, col, act, enabled) => {          // plain text that warms on hover
      const w = F.measure(label, 'soft') * p, b2 = { x: x - w / 2 - 3 * p, y: y - 2 * p, w: w + 6 * p, h: LH, act }, hv = enabled && over(b2);
      hx.globalAlpha = enabled ? 1 : 0.35; say(label, x, y, hv ? '#ffe2a0' : col, 'center'); hx.globalAlpha = 1;
      if (enabled) bag.hits.push(b2);
    };
    if (!n) say('Nothing carried yet', px0 + PW / 2, midY(py0, PH), '#8a7f70', 'center');
    else {
      const k = bag.sel, h = held[k], l = lensById[h.id];
      // the lens: portrait, name, rarity and how long it lasts
      lensCard(Object.assign({}, l, { q: h.q }), px0 + PADX, top, p, true, t);
      const tx0 = px0 + PADX + icon + 6 * p, lf = h.q >= 2 ? null : (h.life == null ? qOf(h.q).life : h.life);
      say(l.name, tx0, top + p, '#fff4dc');
      say(lf == null ? 'Whole: lasts' : lf + (lf === 1 ? ' room left' : ' rooms left'), tx0, top + p + LH, lf != null && lf <= 2 ? '#d0805a' : '#7a7064');
      // what it does
      wrapText(l.desc || '', descW, 'soft', p).slice(0, 3).forEach((ln, r) => say(ln, px0 + PADX, descY + r * LH, '#b8ab96'));
      // what you can do with it, side by side
      const acts = bagActions(k);
      acts.forEach((o, ai) => button(o.label, px0 + Math.round(PW * (acts.length === 2 ? [0.27, 0.73][ai] : 0.5) / p) * p, ay, o.label.startsWith('Sure') ? '#e88a6a' : '#e8dcc4', o.act, o.can()));
    }
    // the page turner along the bottom: a stepped triangle either side of "2/5"
    if (!n) { hx.restore(); return; }
    const cxm = px0 + PW / 2, can = n > 1, pg = (bag.sel + 1) + '/' + n, half = Math.round(F.measure(pg, 'soft') * p / 2 / p) * p;
    say(pg, cxm, ny - p, '#8a7f70', 'center');   // a pixel up: centred on the arrows
    for (const dir of [-1, 1]) {
      const tx = cxm + dir * (half + 6 * p),   // 4 clear pixels between the number and each arrow
        b3 = { x: tx - 6 * p, y: ny - 3 * p, w: 12 * p, h: 13 * p, act: () => bagTurn(dir) }, hv = can && over(b3);
      const col = !can ? '#3a3440' : hv ? '#ffe2a0' : '#c9b89a', sh = '#0a0608';
      // rows of 1, 2, 3, 4, 3, 2, 1 pixels: a small arrowhead, pointing out
      [1, 2, 3, 4, 3, 2, 1].forEach((w, r) => {
        const x = dir > 0 ? tx - 2 * p : tx + 2 * p - w * p, y = ny + r * p;
        hx.fillStyle = sh; hx.fillRect(x + p, y + p, w * p, p);
        hx.fillStyle = col; hx.fillRect(x, y, w * p, p);
      });
      if (can) bag.hits.push(b3);
    }
    hx.restore();
  }
  function bagTurn(dir) {
    const n = heldList(purse()).length; if (n < 2) return;
    bag.sel = (bag.sel + dir + n) % n; bag.sellPending = null; A.glance();
  }
  // what is about to strike, and where: [{ id, x, y, left }] in world cells (left = frames to go)
  const WARN_LEAD = 42;                                   // ~0.7 s: well past human reaction time
  // what is about to strike: [{ id, x, y, left, size }]. (x, y) is the world point where it
  // comes out, and the mark stands just above it (or beside it, for things out of a wall: ox
  // says which way is open). size 0..1 is how big the attack is: a bigger blow, a bigger mark.
  function warnings() {
    const out = [];
    for (const m of sim.mechs || []) {
      if (m.kind === 'vent') {
        const T = m.inhale + m.hold + m.exhale + m.rest, tt = (sim.frame + (m.phase || 0)) % T, left = m.inhale + m.hold - tt;
        if (left > 0 && left <= WARN_LEAD) out.push({ id: 'vent' + m.x + ',' + m.y, x: m.x + m.dir[0] * 12, y: m.y - m.width * 0.6, left, size: 0.5 });   // in front of its mouth, above the jet
      } else if (m.kind === 'bell') {
        const tt = (sim.frame + (m.phase || 0)) % m.period, left = m.period - tt;
        if (left <= WARN_LEAD) {
          out.push({ id: 'bell' + m.x, x: m.x, y: m.y - 9, left, size: 0.7 });
          m.ledges.forEach((L, k) => out.push({ id: 'bellL' + m.x + ',' + k, left, zoneOnly: true, zone: { x0: L.x, x1: L.x + L.w, y: L.y } }));   // the ledges it will shake clear
        }
      } else if (m.kind === 'spikeWall' && m.warnLeft > 0) {
        // out in the open air of the shaft, beside the teeth, not in the stone they hide in
        out.push({ id: 'spk' + m.x + ',' + m.y0, x: m.x + m.side * (m.len + 5), y: (m.y0 + m.y1) / 2 + 6, left: m.warnLeft, size: Math.min(1, (m.y1 - m.y0) / 70), ox: m.side });
      }
    }
    const B = sim.boss;
    if (B) {
      const SEC = window.SpillBoss.SECTIONS;
      for (const b of B.bites || []) { const left = 100 - b.t; if (left > 0 && left <= WARN_LEAD) out.push({ id: 'bite' + b.sec, x: (SEC[b.sec][0] + SEC[b.sec][1]) / 2, y: 248, left, size: Math.min(1, (SEC[b.sec][1] - SEC[b.sec][0]) / 60), zone: { x0: SEC[b.sec][0], x1: SEC[b.sec][1], y: 250 } }); }
      // a falling stone: the mark stands where it will land, on its growing shadow
      for (const st of B.stones || []) if (st.t >= 0 && st.t <= st.warn && st.shadow != null) out.push({ id: 'stone' + st.x + ',' + st.warn, x: st.x, y: st.shadow - 2, left: st.warn - st.t + 1, size: st.small ? 0.35 : 0.75, zone: { x0: st.x - (st.small ? 5 : 7), x1: st.x + (st.small ? 5 : 7), y: st.shadow } });
      // a shut eye's teeth (boss.js B.lids: t < 60 is the warning): the mark over the lid, the zone along it
      for (const Ld of B.lids || []) { const e = window.SpillBoss.EYES[Ld.eye]; if (e && Ld.t < 60) out.push({ id: 'lid' + Ld.eye, x: e.x + e.w / 2, y: e.y - 10, left: 60 - Ld.t, size: 0.6, zone: { x0: e.x, x1: e.x + e.w, y: e.y } }); }
      if (B.sweep && B.sweep.t < 80) out.push({ id: 'sweep', x: B.sweep.x + B.sweep.dir * 14, y: 248, left: 80 - B.sweep.t, size: 1, zone: { x0: 16, x1: 464, y: 250 } });
    }
    // creatures: only blows that land on a fixed patch get a mark. Anything that flies at you
    // or follows you (a diver's dive, the Warden's lunge, thrown things) has no mark: you read
    // those from the creature winding up.
    for (const f of sim.foes || []) {
      if (f.dead || !f.tele || f.tier !== 'warden' || (f.atkName !== 'cleave' && f.atkName !== 'stamp')) continue;
      let fy = Math.round(f.y); while (fy < sim.H - 1 && !sim.terrainSolid(Math.round(f.x), fy)) fy++;
      const zone = f.atkName === 'cleave' ? { x0: Math.min(f.x, f.x + f.dir * 48), x1: Math.max(f.x, f.x + f.dir * 48), y: fy } : { x0: f.x - 120, x1: f.x + 120, y: fy };
      out.push({ id: 'foe' + (f.id != null ? f.id : sim.foes.indexOf(f)), x: f.x, y: f.y - 52, left: Math.max(1, ({ cleave: 38, stamp: 44 })[f.atkName] - f.t), size: 1, zone });
    }
    return out;
  }
  // the mark itself: a hand-drawn "!", warm amber with a dark outline (never red)
  const BANG = ['.kkk.', 'kwwyk', 'kwyyk', 'kwyyk', '.kyk.', '.kyk.', '..k..', '.....', '.kkk.', '.kyk.', '.kkk.'];
  const BANG_COL = { k: '#1a0f08', w: '#fff3c8', y: '#f2b24a' };
  // The patch of floor a blow will cover: a reddish outline lying on the floor's top face, as
  // wide as the patch and only a few cells deep, its far edge drawn in a little so it reads as
  // a flat ring seen at a slant. Hand-wobbled: a run of it sits a cell off here and there.
  // It does not flash; it is simply there until the blow comes.
  function drawZone(z, id) {
    const x0 = Math.round(z.x0), x1 = Math.round(z.x1), fy = Math.round(z.y);
    if (x1 - x0 < 4) return;
    const seed = [...String(id)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const wob = (x, row) => { const h = (((x >> 2) * 73856093) ^ (row * 19349663) ^ seed) >>> 0; return h % 9 === 0 ? 1 : 0; };   // a short run nudged a cell, not single specks
    const cells = [];
    const inset = 2;                                                           // how far the far edge draws in
    for (let x = x0 + inset; x <= x1 - inset; x++) cells.push([x, fy - 1 - wob(x, 1)]);   // the far edge, just behind the floor's lip
    for (let x = x0; x <= x1; x++) cells.push([x, fy + 2 + wob(x, 2)]);                   // the near edge, on the floor's face
    for (const [sx, d] of [[x0, 1], [x1, -1]]) {                               // the ends, slanting in toward the far edge
      cells.push([sx, fy + 1], [sx + d, fy], [sx + d * 2, fy - 1]);
    }
    const c1 = Math.round(wsx(0)), cw = Math.max(1, Math.round(wsx(1) - c1)), ch = Math.max(1, Math.round(wsy(1) - wsy(0)));
    for (const [x, y] of cells) {
      const X = Math.round(wsx(x)), Y = Math.round(wsy(y));
      hx.fillStyle = 'rgba(40,10,8,0.55)'; hx.fillRect(X, Y + Math.max(1, ch >> 1), cw, Math.max(1, ch >> 1));   // a dark underside so it reads on bright sand
      hx.fillStyle = 'rgba(214,78,58,0.82)'; hx.fillRect(X, Y, cw, Math.max(1, ch >> 1) + (ch > 2 ? 1 : 0));
    }
  }
  function drawWarnings(t) {
    const seen = fx.warnAge || (fx.warnAge = {}), now = {};
    for (const w of warnings()) {
      const age = (seen[w.id] || 0) + 1; now[w.id] = age;
      if (w.left <= 0) continue;
      if (w.zone) drawZone(w.zone, w.id);
      if (w.zoneOnly) continue;
      // its size: never tiny on screen (at least 3 screen pixels a mark-pixel, however far the
      // view is zoomed out), and bigger for a bigger blow
      const q = Math.max(3, Math.round(R.effScale * (0.85 + 0.75 * (w.size || 0.5))));
      const cw = q / R.effScale;                                               // one mark-pixel in world cells
      // find it clear air: start just above the point, step up (or out from a wall) past any stone
      let ax = w.x, ay = w.y;
      const blocked = (x, y) => { for (let yy = y - 11 * cw; yy <= y; yy += Math.max(1, cw)) for (let xx = x - 2.5 * cw; xx <= x + 2.5 * cw; xx += Math.max(1, cw)) if (sim.terrainSolid(Math.round(xx), Math.round(yy))) return true; return false; };
      for (let k = 0; k < 40 && blocked(ax, ay); k++) { if (w.ox) ax += w.ox; else ay -= 1; }
      // blink: steady at first, then faster and faster as it comes
      const per = w.left > 24 ? 999 : w.left > 12 ? 6 : 3;
      if (per < 999 && Math.floor(w.left / per) % 2 === 1) continue;
      const pop = age === 1 ? -2 : age === 2 ? -1 : 0, bob = Math.round(Math.sin(age * 0.25)) * (age > 3 ? 1 : 0);
      const X = Math.round(wsx(ax) - 2.5 * q), Y = Math.round(wsy(ay) - 11 * q + (pop + bob) * q);   // bottom of the mark on the point
      const squash = age === 1;                                               // the first frame lands a touch wide and short
      BANG.forEach((r, ry) => {
        if (squash && (ry === 2 || ry === 5)) return;
        const yy = Y + (squash ? ry - (ry > 5 ? 2 : ry > 2 ? 1 : 0) + 2 : ry) * q;
        [...r].forEach((ch, rx) => { if (ch === '.') return; hx.fillStyle = BANG_COL[ch]; hx.fillRect(X + rx * q + (squash ? (rx < 2 ? -1 : rx > 2 ? 1 : 0) * Math.round(q / 2) : 0), yy, q, q); });
      });
    }
    fx.warnAge = now;
  }
  // The cursor (art pass): a small brass-and-bone reticle, drawn by hand in pixels, that says what
  // your hand is doing. Every mark is shaded: a lit top-left edge, a body, a shaded bottom-right
  // edge, and a dark rim all round so it reads on bright sand and black stone alike.
  //   idle     four corner brackets round a glinting point; they breathe in and out a pixel
  //   click    the brackets snap in, then ease back (any button)
  //   creature under it (or the bolt's mark): the brackets turn red and close on it, ticks inside
  //   draw     (left held) the brackets pull inward in waves, sand-gold
  //   push     (shift) they push outward in waves
  //   freeze   (E) a six-armed ice crystal, its arms flickering
  //   pouch    (right held) a small round pouch
  //   funnel   (over the full funnel) a bobbing arrow pointing in
  // Drawn last, after the Keeper's frame, so it is never hidden behind him.
  const CUR_PAL = {
    bone: { h: '#fff6e0', b: '#efe2c6', s: '#b9a57e' },
    sand: { h: '#fff1c2', b: '#f2cf86', s: '#c2914a' },
    foe: { h: '#ffc2a8', b: '#e8604a', s: '#9a2e24' },
    ice: { h: '#ffffff', b: '#bfe6f2', s: '#6fa7c2' },
    gold: { h: '#fff1c2', b: '#f2d48a', s: '#b88a3a' },
  };
  const curClick = { t: 99 };
  addEventListener('mousedown', () => { curClick.t = 0; });
  // THE LOCK-ON MARK (art pass), drawn on what Q would aim at (sim.lockOn, from the sim each frame).
  //   a creature or warden: red. Tap preview (Q not held): four small ticks on a ring round it,
  //     turning slowly, faint, firming as the cursor nears it. Locked (shards held): it snaps in from
  //     wide, overshoots a little small, flashes white on the frame it locks, then holds: square corner
  //     brackets, the four ticks pointing in, a small diamond at its heart. A warden gets a second ring.
  //   the eye: gold, its own shape: an almond frame (a lid line above, one below) round the eye, dashed
  //     and drifting while it is only a preview, solid with a tick at each corner and the ends once locked.
  // All in world pixels (one cell = one grain), with a dark rim like the cursor.
  const LOCK_PAL = { foe: { h: '#ffd0b8', b: '#ee5a42', s: '#a3291f' }, eye: { h: '#fff4c8', b: '#f4c95a', s: '#b9822c' }, flash: { h: '#ffffff', b: '#ffffff', s: '#ffe6c8' } };
  const lockSt = { key: null, t: 0, heldT: 99, wasHeld: false };
  function drawCells(cx, cy, q, cells, pal, alpha) {
    if (!cells.length) return;
    const seen = new Set(cells.map(([x, y]) => x + ',' + y));
    hx.globalAlpha = alpha == null ? 1 : alpha;
    hx.fillStyle = 'rgba(10,7,14,0.85)';
    for (const [x, y] of cells) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) if (!seen.has((x + dx) + ',' + (y + dy))) hx.fillRect(Math.round(cx + (x + dx) * q - q / 2), Math.round(cy + (y + dy) * q - q / 2), Math.ceil(q), Math.ceil(q));
    for (const [x, y, k] of cells) { hx.fillStyle = pal[k] || pal.b; hx.fillRect(Math.round(cx + x * q - q / 2), Math.round(cy + y * q - q / 2), Math.ceil(q), Math.ceil(q)); }
    hx.globalAlpha = 1;
  }
  function drawLockOn(t) {
    const L0 = sim.lockOn;
    if (!L0 || !L0.held) { lockSt.key = null; lockSt.wasHeld = false; return; }   // only Q (shards held) locks on: a plain hover shows nothing
    const key = L0.kind + ':' + Math.round(L0.x / 24) + ':' + Math.round(L0.y / 24);
    if (key !== lockSt.key) { lockSt.key = key; lockSt.t = 0; }
    lockSt.t++;
    if (L0.held && !lockSt.wasHeld) { lockSt.heldT = 0; A.glance(); }        // the lock: snap, flash, a click
    lockSt.wasHeld = !!L0.held; lockSt.heldT++;
    const q = R.effScale, cx = wsx(L0.x), cy = wsy(L0.y), near = Math.max(0, Math.min(1, L0.near || 0));
    const held = !!L0.held, ht = lockSt.heldT, cells = [], add = (x, y, k) => cells.push([Math.round(x), Math.round(y), k]);
    // the snap: wide, in past its size, back out to rest (locked); a gentle tighten with nearness (preview)
    let sc = held ? (ht < 7 ? 1.6 - 0.75 * (ht / 7) : ht < 13 ? 0.85 + 0.15 * ((ht - 7) / 6) : 1 - 0.04 * Math.sin(t * 6)) : 1.15 - 0.12 * near;
    const r = L0.r * sc, flash = held && ht < 4;
    if (L0.kind === 'eye') {
      // the almond: two lid arcs, dashed and drifting in preview, solid when locked
      const rx = r, ry = r * 0.55, n = Math.max(24, Math.round(rx * 3)), drift = (t * 0.9) % 1;
      for (let i = 0; i <= n; i++) {
        const u = i / n, a = Math.PI * (0.12 + 0.76 * u);
        if (!held && ((u * 9 + drift) % 1) < 0.45) continue;
        const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
        add(x, -y - 2, a < Math.PI / 2 ? 'h' : 'b'); add(x, y + 2, a < Math.PI / 2 ? 'b' : 's');
      }
      for (const sx of [-1, 1]) { add(sx * (rx + 2), 0, 'h'); add(sx * (rx + 3), 0, 'b'); add(sx * (rx + 2), -1, 'b'); add(sx * (rx + 2), 1, 's'); }   // the corners of the almond: a small barb either end
      if (held) for (const [x, y] of [[0, -ry - 5], [0, ry + 5]]) { add(x, y, 'h'); add(x - 1, y + Math.sign(y), 'b'); add(x + 1, y + Math.sign(y), 's'); }   // ticks at the top and bottom, pointing in
      drawCells(cx, cy, q, cells, flash ? LOCK_PAL.flash : LOCK_PAL.eye, held ? 1 : 0.35 + 0.5 * near);
      return;
    }
    if (!held) {
      // preview: four short dashes orbiting the ring (radial, two cells each), a faint promise of where a tap will bend
      const spin = t * 1.1;
      for (let k = 0; k < 4; k++) { const a = spin + k * Math.PI / 2, ux = Math.cos(a), uy = Math.sin(a); add(ux * r, uy * r, 'h'); add(ux * (r + 1.4), uy * (r + 1.4), 'b'); add(ux * (r + 2.6), uy * (r + 2.6), 's'); }
    } else {
      // locked: just four corner brackets closing round it (a warden's are larger, with longer arms); nothing else
      const d = Math.round(r * 0.85), arm = L0.kind === 'warden' ? 4 : 3;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (let k = 0; k < arm; k++) { add(sx * d, sy * (d - k), sx < 0 && sy < 0 ? 'h' : sy > 0 && sx > 0 ? 's' : 'b'); add(sx * (d - k), sy * d, sx < 0 ? 'h' : 'b'); }
    }
    drawCells(cx, cy, q, cells, flash ? LOCK_PAL.flash : LOCK_PAL.foe, held ? 1 : 0.3 + 0.55 * near);
  }
  function drawCursor(t) {
    if (!mouse.inside || pause.on || screen !== 'game' || !sim) return;
    drawLockOn(t);
    const q = Math.max(2, Math.round(R.effScale * 0.75));
    const overPortal = sim.enough && sim.exitAt && Math.hypot(inp.x - sim.exitAt.x, inp.y - sim.exitAt.y) < 26;
    const cx = Math.round(wsx(inp.x)), cy = Math.round(wsy(inp.y));
    curClick.t++;
    // cells: [x, y, tone] in cell units round the hotspot; tone h (lit) / b (body) / s (shade)
    const draw = (cells, pal, alpha) => {
      const seen = new Set(cells.map(([x, y]) => x + ',' + y));
      hx.globalAlpha = alpha == null ? 1 : alpha;
      hx.fillStyle = 'rgba(10,7,14,0.88)';                                     // the dark rim, one cell all round
      for (const [x, y] of cells) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) if (!seen.has((x + dx) + ',' + (y + dy))) hx.fillRect(cx + (x + dx) * q - (q >> 1), cy + (y + dy) * q - (q >> 1), q, q);
      for (const [x, y, k] of cells) { hx.fillStyle = pal[k] || pal.b; hx.fillRect(cx + x * q - (q >> 1), cy + y * q - (q >> 1), q, q); }
      hx.globalAlpha = 1;
    };
    // four corner brackets at distance d, each arm len long; lit on the upper-left arms, shaded lower-right
    const brackets = (d, len) => {
      const c = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        for (let k = 0; k < len; k++) {
          const tone = (sx < 0 && sy < 0) ? 'h' : (sx > 0 && sy > 0) ? 's' : 'b';
          c.push([sx * d, sy * (d - k), k === 0 ? tone : (sy < 0 ? 'h' : 'b')]);
          if (k) c.push([sx * (d - k), sy * d, sx < 0 ? 'h' : 'b']);
        }
      }
      return c;
    };
    const snap = curClick.t < 10 ? Math.round(2 * Math.exp(-curClick.t / 3)) : 0;   // a click: the brackets snap in, then ease back
    if (overPortal) {
      const bob = Math.round(Math.sin(t * 5) * 1.2);
      const c = [];
      [[-2, -3, 'h'], [-1, -3, 'h'], [0, -3, 'h'], [1, -3, 'b'], [2, -3, 's'], [-1, -2, 'h'], [0, -2, 'b'], [1, -2, 's'], [0, -1, 'b'], [-1, -5, 'b'], [0, -5, 'h'], [1, -5, 'b'], [0, -6, 'h']]
        .forEach(([x, y, k]) => c.push([x, y + bob + 3, k]));
      draw(c, CUR_PAL.gold);
      return;
    }
    if (inp.harden) {                                                          // freeze: a snow crystal, drawn by hand; its arm tips flicker
      const rows = ['h..h..b', '.h.h.b.', '..hhb..', 'hhhhbss', '..bss..', '.b.s.s.', 'b..s..s'], c = [];
      const flick = Math.floor(t * 8) % 4;
      rows.forEach((row, y) => [...row].forEach((k, x) => { if (k === '.') return; const tip = (x === 0 || x === 6 || y === 0 || y === 6); if (tip && ((x + y * 3) % 4) === flick) return; c.push([x - 3, y - 3, k]); }));
      draw(c, CUR_PAL.ice);
      return;
    }
    if (sim.charging && sim.ballCount > 0) {                                   // the pouch: a small round cup
      draw([[-1, -1, 'h'], [0, -1, 'h'], [1, -1, 'b'], [-2, 0, 'h'], [2, 0, 's'], [-1, 1, 'b'], [0, 1, 's'], [1, 1, 's'], [0, 0, 'b']], CUR_PAL.sand);
      return;
    }
    // what is under it: a living creature near the point (or the bolt's mark) turns the reticle hostile
    const foe = sim.lockOn && sim.lockOn.held ? sim.lockOn : null;            // locked on (shards held): the cursor turns red too
    if (inp.pour) {
      const push = !!inp.repel, ph = (t * (push ? 2.6 : 3.2)) % 1, wave = push ? 3 + Math.floor(ph * 3) : 5 - Math.floor(ph * 3);
      const c = brackets(wave, 2);
      c.push([0, 0, 'h']);
      if (!push) for (const [x, y] of [[0, -wave - 2], [0, wave + 2], [-wave - 2, 0], [wave + 2, 0]]) c.push([x, y, 'b']);   // grains coming in from the four sides
      draw(c, CUR_PAL.sand);
      return;
    }
    if (foe) {                                                                 // locked on: the lock mark does the talking; the cursor is just a small red pip
      draw([[0, 0, 'h'], [0, -1, 'b'], [-1, 0, 'b'], [1, 0, 's'], [0, 1, 's']], CUR_PAL.foe);
      return;
    }
    const breathe = Math.sin(t * 2.2) > 0.6 ? 1 : 0, d = 4 + breathe - snap;
    const c = brackets(Math.max(2, d), 3);
    const glint = (t * 0.7) % 1 < 0.08;
    c.push([0, 0, glint ? 'h' : 'b']);
    draw(c, CUR_PAL.bone, 0.95);
  }

  function drawHud(t) {
    const W = hud.width, H = hud.height, s = R.scale, L = currentLevel();
    hx.clearRect(0, 0, W, H);
    // time slowed: a faint blue cast and the frost at the edges, under everything else on the HUD
    { const k = Math.max(fx.slowK || 0, fx.airSlow ? 1 : 0); if (k > 0.01 && !pause.on) { hx.fillStyle = `rgba(110,150,235,${(0.11 * k).toFixed(3)})`; hx.fillRect(0, 0, W, H); if (fx.slowK > 0.01) slowFrame(fx.slowK); } }
    const u = dpr;

    // ---------- the slingshot ----------
    // Press: a faint ring shows how far the gather reaches. Drag: two elastic
    // bands from either side of the ball to a pouch at the cursor, thinning
    // and warming with tension; arc dots spaced by speed; a landing mark.
    // Release: the bands snap back.
    const es = R.effScale, q = Math.max(2, Math.round(es * 0.75));
    const px = (wx, wy, c, sz) => { hx.fillStyle = c; const z = sz || q; hx.fillRect(Math.round(wsx(wx) - z / 2), Math.round(wsy(wy) - z / 2), z, z); };
    if (sim.charging) fx.chargeT = (fx.chargeT || 0) + 1 / 60; else fx.chargeT = 0;
    // the tide: deep water tinted over the world, and a living surface line
    for (const m of sim.mechs || []) if (m.kind === 'tide' && m.level != null) {
      const X0 = Math.round(wsx(m.x)), X1 = Math.round(wsx(m.x + m.w)), Y0 = Math.round(wsy(Math.round(m.level))), Y1 = Math.round(wsy(sim.H));
      if (Y1 > Y0) { hx.fillStyle = 'rgba(40,86,118,0.34)'; hx.fillRect(X0, Y0, X1 - X0, Y1 - Y0); }
      const ly = Math.round(m.level);
      for (let x = m.x; x < m.x + m.w; x++) {
        const w = Math.sin(x * 0.21 + t * 2.1) + Math.sin(x * 0.083 - t * 1.3), dy = w > 1.1 ? -1 : 0;
        if (sim.terrainSolid(x, ly + dy)) continue;
        hx.fillStyle = w > 1.4 ? 'rgba(214,236,246,0.85)' : 'rgba(150,196,220,0.55)';
        const X = Math.round(wsx(x)), XN = Math.round(wsx(x + 1)), Y = Math.round(wsy(ly + dy)), YN = Math.round(wsy(ly + dy + 1));
        hx.fillRect(X, Y, XN - X, YN - Y);
      }
    }
    // ---------- warnings: a small flashing "!" just before something strikes ----------
    // Only for blows whose place is already decided (an environmental hazard on its clock,
    // or a creature's attack that won't follow you). It pops in, bobs a pixel, blinks faster
    // as the moment comes, and is gone the instant it fires. No red zones.
    drawWarnings(t);
    // a health bar over any warden that has been hurt
    for (const f of sim.foes) if (f.tier === 'warden' && !f.dead && f.hp < f.maxHp) {
      const pp = Math.max(1, Math.round(R.effScale * 0.5)), cells = 30, x0 = Math.round(wsx(f.x) - cells * pp / 2), y0 = Math.round(wsy(f.y - 50));
      f.shownHp = f.shownHp == null ? f.hp : f.shownHp + (f.hp - f.shownHp) * 0.08;
      drawBar(x0, y0, cells, f.hp / f.maxHp, f.shownHp / f.maxHp, pp, f.mode === 'stagger' ? ['#8a6a2a', '#d0a85e', '#fff0c4'] : ['#5e1d18', '#9b3a2f', '#d0654f']);
    }
    // frozen sand wears a frost: you can see exactly what is braced
    if (sim.frozen && false) {          // art pass: the shader draws the frost grain by grain; a flat wash over it read as a wipe
      hx.fillStyle = 'rgba(205,236,250,0.55)';
      for (let i = 0; i < sim.N; i++) if (sim.state[i] === 2) {
        const X0 = Math.round(wsx(sim.px[i])), X1 = Math.round(wsx(sim.px[i] + 1)), Y0 = Math.round(wsy(sim.py[i])), Y1 = Math.round(wsy(sim.py[i] + 1));
        hx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
      }
    }
    // the marked target (only while shards are held): four thick square corner brackets, solid red
    // with a dark outline; they snap in once when the mark is taken, then hold still
    if (sim.aimTarget && !sim.aimTarget.dead && !pause.on) {
      const f = sim.aimTarget, big = f.tier === 'warden';
      fx.markT = f === fx.markF ? (fx.markT || 0) + 1 : 0; fx.markF = f;
      const snap = Math.max(0, 1 - fx.markT / 6), half = (big ? 20 : 12) + snap * 6, cx = f.x, cy = f.y - (big ? 18 : 6);
      const qq = Math.max(2, Math.round(R.effScale * 0.6)), arm = 5, th = 2;
      const X0 = Math.round(wsx(cx - half)), X1 = Math.round(wsx(cx + half)), Y0 = Math.round(wsy(cy - half)), Y1 = Math.round(wsy(cy + half));
      for (const [x, y, sx, sy] of [[X0, Y0, 1, 1], [X1, Y0, -1, 1], [X0, Y1, 1, -1], [X1, Y1, -1, -1]]) {
        const L = arm * qq, T = th * qq;
        const hxr = sx > 0 ? x : x - L, vyr = sy > 0 ? y : y - L, hyr = sy > 0 ? y : y - T, vxr = sx > 0 ? x : x - T;
        hx.fillStyle = '#2a0806'; hx.fillRect(hxr - qq / 2, hyr - qq / 2, L + qq, T + qq); hx.fillRect(vxr - qq / 2, vyr - qq / 2, T + qq, L + qq);   // outline
        hx.fillStyle = '#d8402e'; hx.fillRect(hxr, hyr, L, T); hx.fillRect(vxr, vyr, T, L);
        hx.fillStyle = '#ff7a5a'; hx.fillRect(hxr, hyr, L, Math.max(1, qq >> 1)); hx.fillRect(vxr, vyr, Math.max(1, qq >> 1), L);    // lit edge
      }
    }
    // the slingshot's drawing: hand-made marks on the world's pixel grid,
    // in their own colours (not lit by the scene), above everything
    for (const sp of aimSprites(t)) worldBlit(sp.rows, sp.x, sp.y, AIM_COL);
    // Full power is a short pull, about an eighth of the screen, from wherever you press.
    // Fixed when the press begins, so it never shifts mid-aim.
    if (!sim.charging) {
      const base = Math.max(22, Math.min(40, R.viewCells.h * 0.13));
      sim.aimLen = base;                                       // the same full pull wherever you press: the aim is a virtual stick (aimStick), not a screen position
    }
    fx.snapT = Math.max(0, (fx.snapT || 0) - 1 / 60);

    hx.globalAlpha = 1;
    // combo counts pop where the hit landed: a bounce, a rise, a fade
    for (const pp of fx.pops) {
      if (!pp.crit) continue;
      // CRIT, stamped: it slams in large, settles, rises a little and fades; a dark under-print keeps it legible
      // flat colour and a faint one-pixel shadow (art pass): no arcade triple print
      const k = pp.t / 70, stamp = pp.t < 3 ? 1.34 : 1;
      const sz = Math.max(1, Math.round(s * 0.6 * stamp)), X = Math.round(wsx(pp.x)), Y = Math.round(wsy(pp.y - k * 8));
      hx.globalAlpha = Math.min(1, (1 - k) * 2.2);
      tintText('crit', X + sz, Y + sz, 'soft', sz, 'center', 'rgba(26,12,8,0.55)');
      tintText('crit', X, Y, 'soft', sz, 'center', pp.t < 3 ? '#fff4dc' : '#f0c27a');
    }
    hx.globalAlpha = 1;
    // the Sieve's wounds: small diamonds along the top, dimming as it breaks
    if (sim.boss && sim.boss.hp > 0) {
      // a classic boss bar along the top, its name above it (gone once it is dead)
      const p = s, B = sim.boss, n = window.SpillBoss.HP, cells = Math.round(W * 0.42 / p), x0 = Math.round((W - cells * p) / 2 / p) * p, y0 = 18 * p;
      F.draw(hx, 'The Sieve', W / 2, y0 - 11 * p, 'soft', p, 'center');
      fx.bossShown = fx.bossShown == null ? B.hp : fx.bossShown + (B.hp - fx.bossShown) * 0.06;     // the lost part drains after a hit
      drawBar(x0, y0, cells, B.hp / n, fx.bossShown / n, p, fx.eyeWhite > 0 ? ['#ffffff', '#ffffff', '#ffffff'] : ['#5e1d18', '#9b3a2f', '#d0654f']);
    }

    // ---------- the cursor: one small pixel mark per action ----------
    const overPortal = sim.enough && sim.exitAt && mouse.inside && Math.hypot(inp.x - sim.exitAt.x, inp.y - sim.exitAt.y) < 26;
    // Tutorial: the first funnel you fill, a small mouse with its left
    // button pulsing bobs above it until you click it. Once you've passed
    // through a funnel, it never shows again.
    if (sim.enough && sim.exitAt && !fx.result && !funnelTaught && !overPortal) {   // the first funnel only: click it to go on (hidden while your cursor is on it)
      const es = R.effScale, q = Math.max(2, Math.round(es));
      const mx0 = Math.round(wsx(sim.exitAt.x) - 2.5 * q);
      const my0 = Math.round(wsy(sim.exitAt.top) - (14 + Math.round(Math.sin(t * 3) * 1.5)) * q);
      const pulse = Math.floor(t * 2.5) % 2 === 0;
      const MOUSE = ['.###.', '#X#.#', '#X#.#', '#####', '#...#', '#...#', '.###.'];
      MOUSE.forEach((row, r) => [...row].forEach((ch, c) => {
        if (ch === '.') return;
        hx.fillStyle = 'rgba(0,0,0,0.4)'; hx.fillRect(mx0 + c * q, my0 + (r + 1) * q, q, q);
        hx.fillStyle = ch === 'X' ? (pulse ? '#ffd27a' : '#8a6a2a') : '#efe6d2';
        hx.fillRect(mx0 + c * q, my0 + r * q, q, q);
      }));
      // a small arrow pointing down at the funnel
      hx.fillStyle = '#efe6d2';
      for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [1, 1], [2, 1], [3, 1], [2, 2]]) hx.fillRect(mx0 + dx * q, my0 + (9 + dy) * q, q, q);
    }

    // Top right: the pause button, and beside it the sand you have, live.
    const p = s, m = 8 * p, bs = 13 * p;
    const bx = W - m - bs, by = m;
    pauseBtn.x = bx; pauseBtn.y = by; pauseBtn.w = bs; pauseBtn.h = bs;
    const hoverBtn = mouse.inside && mouse.sx * dpr >= bx && mouse.sx * dpr <= bx + bs && mouse.sy * dpr >= by && mouse.sy * dpr <= by + bs;
    hudPlate(bx, by, bs, bs, p, hoverBtn);
    if (hoverBtn) { hx.fillStyle = 'rgba(242,207,124,0.16)'; hx.fillRect(bx + 2 * p, by + 2 * p, bs - 4 * p, bs - 4 * p); }
    hx.fillStyle = hoverBtn ? '#f2cf7c' : '#d9cbb3';
    hx.fillRect(bx + 4 * p, by + 4 * p, 2 * p, 5 * p); hx.fillRect(bx + 7 * p, by + 4 * p, 2 * p, 5 * p);
    // a little sand-pile icon and the four-digit count, centred on the button
    const ny = by + 2 * p;
    const right = bx - 6 * p;
    // In the descent the big number is what is truly yours: your sand minus
    // what you still owe this room. As a room begins, the toll is taken out
    // in front of you: the count ticks down and grains fly into the funnel.
    let shown = sim.alive + sim.pending;
    if (sim.toll) {
      const owe = Math.max(0, sim.toll - sim.exited), spare = shown - owe, ta = fx.tollT || 0;
      const k = Math.max(0, Math.min(1, (ta - 30) / 70)), e = k * k * (3 - 2 * k);
      shown = Math.round(shown - owe * e);
      fx.spareLow = spare < 0;
      if (ta > 30 && ta < 110) {
        const fxp = right - 10 * p, fyp = ny + 14 * p;
        for (let g = 0; g < 9; g++) {
          const u = ((ta - 30) / 80 + g / 9) % 1, gx = right - 8 * p + (fxp - (right - 8 * p)) * u, gy = ny + 3 * p + (fyp - ny - 3 * p) * u - Math.sin(u * Math.PI) * 10 * p;
          hx.fillStyle = g % 3 ? '#e9bb6c' : '#fbe2a2'; hx.fillRect(Math.round(gx), Math.round(gy), p, p);
        }
      }
    }
    const txt = grains(shown);
    if (sim.toll && fx.spareLow) { hx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(t * 3)); }
    {
      // the count sits on its own plate with a little shaded pile beside it
      const rowW = 3 * 15 * p + 2 * 6 * p, need = window.SpillFonts.measure(txt, 'num') * p + 19 * p;   // sand plate + pause = the width of the three sockets
      const plW = Math.max(rowW - bs - 2 * p, need), plX = bx - 2 * p - plW;   // (a big count widens its plate to the left rather than running into the pile)
      hudPlate(plX, by, plW, bs, p, false);
      HUD_ICONS.pile.forEach((r, ry) => [...r].forEach((ch, rx2) => { if (ch === '.') return; hx.fillStyle = HUD_PAL.sun[ch]; hx.fillRect(plX + 4 * p + rx2 * p, by + 5 * p + ry * p, p, p); }));
    }
    window.SpillFonts.draw(hx, txt, right, ny, 'num', p, 'right');
    hx.globalAlpha = 1;

    // what is ready: three iron sockets under the count (hammer F, shards Q,
    // super X), each refilling from the bottom while it cools, and three
    // sand drops for the throws left in the air
    {
      const rowY = ny + 15 * p, sk = 15 * p, gap = 6 * p;
      const rowW = 3 * sk + 2 * gap;
      let xr = W - m;
      const cool = [
        { icon: HUD_ICONS.hammer, pal: HUD_PAL.sun, frac: 1 - (sim.hammerCool || 0) / (sim.hammerCoolMax || 230), tap: 'f', poor: !sim.afford('f') },
        { icon: HUD_ICONS.shard, pal: HUD_PAL.sand, frac: 1 - (sim.iceCool || 0) / 300, tap: 'q', poor: !sim.afford('q') },
        { icon: HUD_ICONS.star, pal: HUD_PAL.star, frac: Math.min(1, run.super || 0), super: true },
      ];
      for (let k = cool.length - 1; k >= 0; k--) {
        const c = cool[k]; xr -= sk;
        hudPlate(xr, rowY, sk, sk, p, c.frac >= 1);
        const ix = xr + 2 * p, iy = rowY + 2 * p, rows = c.icon, n = rows.length;
        const fillRow = n * (1 - Math.max(0, Math.min(1, c.frac)));
        rows.forEach((r, ry) => [...r].forEach((ch, rx2) => {
          if (ch === '.') return;
          const lit = ry >= fillRow;
          hx.fillStyle = c.poor ? HUD_PAL.poor[ch] : lit ? c.pal[ch] : HUD_PAL.dim[ch];
          hx.fillRect(ix + rx2 * p, iy + ry * p, p, p);
        }));
        // the line where it is refilling glows
        if (c.frac > 0 && c.frac < 1) { const fy = iy + Math.floor(fillRow) * p; hx.fillStyle = 'rgba(255,236,190,0.55)'; for (let x = 1; x < 10; x += 1 + ((x * 7) % 3 === 0)) hx.fillRect(ix + x * p, fy, p, p); }
        // ready: a slow glint crosses the icon now and then
        if (c.frac >= 1) { const g = ((t * 0.6 + k * 0.33) % 1.6) * 16 - 3; hx.fillStyle = 'rgba(255,250,235,0.35)'; for (let ry = 0; ry < n; ry++) { const gx = Math.round(g - ry * 0.6); if (gx >= 0 && gx < 11 && rows[ry][gx] !== '.') hx.fillRect(ix + gx * p, iy + ry * p, p, p); } }
        // tap charges: evenly spaced marks set into the socket's bottom rim
        if (c.tap) {
          const T0 = sim.taps && sim.taps[c.tap], lim = c.tap === 'f' ? 5 : 3;
          const ammo = T0 ? T0.ammo : lim, reload = T0 && T0.reloading ? T0.reload : 0;
          const restMax = sim.tapReloadMax(c.tap), span = sk - 4 * p, markW = Math.max(p, Math.floor((span - (lim - 1) * p) / lim));
          for (let j = 0; j < lim; j++) {
            const on = j < ammo, partial = j === ammo && reload > 0;
            const nx = xr + 2 * p + Math.round(j * (span - markW) / Math.max(1, lim - 1)), nyy = rowY + sk - p;
            hx.fillStyle = '#2a2430'; hx.fillRect(nx, nyy, markW, p);
            if (on || partial) {
              const fill = on ? markW : Math.max(1, Math.round(markW * (1 - reload / restMax)));
              hx.fillStyle = c.pal.l; hx.fillRect(nx, nyy, fill, p);
              hx.fillStyle = c.pal.h; hx.fillRect(nx, nyy, Math.min(p, fill), p);
            }
          }
        }
        xr -= gap;
      }
      const freezeMax = sim.freezeMax || 300;
      const freezeFrac = sim.freezeSeed
        ? 1 - Math.min(1, (sim.freezeT || 0) / freezeMax)
        : 1 - Math.min(1, (sim.freezeCool || 0) / (sim.freezeCoolMax || 45));
      // the ice and the time-slow share the row: each half as long as the ice bar was
      const half = Math.floor((Math.round(rowW / p) - 3) / 2);
      drawFreezeBar(W - m - rowW, rowY + 15 * p + 3 * p, half, p, t);
      drawSlowBar(W - m - rowW + (half + 3) * p, rowY + 15 * p + 3 * p, Math.round(rowW / p) - half - 3, p, t);
    }

    // Chamber title, shown briefly as a chamber begins.
    const ia = Math.min(1, fx.introT / 50) * (1 - Math.min(1, Math.max(0, (fx.introT - 190) / 60))) * (1 - (fx.letter || 0));
    if (ia > 0.01 && !fx.introOff) {
      hx.globalAlpha = ia;
      const cy = Math.round(H * 0.18 / p) * p;
      const d = run.descent;
      window.SpillFonts.draw(hx, L.boss ? 'The bottom' : d ? 'Floor ' + ROMAN[d.floor] : inWorld() ? 'The Tower of Hours' : 'Chamber ' + L.numeral, W / 2, cy, 'title', p, 'center');
      window.SpillFonts.draw(hx, L.name, W / 2, cy + 17 * p, 'title', p * 2, 'center');
      hx.globalAlpha = 1;
    }

    drawCombo(t, s, Math.round(hud.height * 0.3));
    if (fx.lensBroke) {
      // a lens wore through: its name, struck, for a few seconds
      const LB = fx.lensBroke; LB.t++;
      if (LB.t > 200) fx.lensBroke = null;
      else { hx.globalAlpha = Math.min(1, (200 - LB.t) / 40); tintText(LB.names.join(', ') + (LB.names.length > 1 ? ' broke' : ' broke'), hud.width / 2, Math.round(hud.height * 0.16), 'soft', s, 'center', '#d0654f'); hx.globalAlpha = 1; }
    }

    // Holding R: a small hourglass turns over at the top of the screen.
    if (hold.t > 0) {
      const need = hold.run ? 1.6 : 0.6, k = Math.min(1, hold.t / need);
      hx.save();
      hx.translate(W / 2, 14 * p);
      hx.rotate(k * Math.PI);
      hx.globalAlpha = Math.min(1, hold.t * 6);
      blit(GLASS, -2.5 * p * 1.5, -3.5 * p * 1.5, Math.round(p * 1.5), { '#': hold.run ? '#e89a7a' : COL.frame, s: COL.sand });
      hx.restore();
    }

    // Result: the number saved, an ornament, and three small hourglasses.
    if (fx.result) {
      const a = Math.min(1, fx.resultT / 40);
      hx.fillStyle = `rgba(8,6,14,${0.5 * a})`;
      hx.fillRect(0, 0, W, H);
      if (a > 0.5) {
        const r = fx.result, ry = Math.round(H * 0.34 / p) * p;
        window.SpillFonts.draw(hx, r.saved >= 1000 ? grains(r.saved) : String(r.saved).padStart(3, '0'), W / 2, ry, 'num', p * 5, 'center');
        for (let k = 0; k < 3; k++) hourglass(Math.round(W / 2 + (k - 1) * 12 * p - 2.5 * p), ry + 52 * p, p, r.found[k]);
      }
    }
  }

  // A plain hairline divider.
  function ornament(cx, y, w, p) {
    hx.fillStyle = 'rgba(239,230,210,0.2)';
    hx.fillRect(Math.round((cx - w / 2) / p) * p, y, Math.round(w / p) * p, p);
  }

  // A health bar drawn like the rest of the game: a worn iron frame with
  // chips in its edges and ornamented end caps, a fill lit along the top and
  // shaded below, and the part just lost draining away pale.
  const BAR_CAP = ['..##', '.#=#', '#==#', '#=o#', '#==#', '.#=#', '..##'];
  function drawThinBar(x, y, cells, frac, p, fill, t, active) {
    const inner = cells - 4, n = Math.max(0, Math.min(inner, Math.round(inner * frac)));
    hx.fillStyle = '#100c0e'; hx.fillRect(x, y + p, cells * p, 1.5 * p);
    for (let k = 2; k < cells - 2; k++) {
      hx.fillStyle = ((k * 37 + 11) % 17) === 0 ? '#2a2420' : '#5a4f45';
      hx.fillRect(x + k * p, y, p, p);
      hx.fillStyle = ((k * 53 + 5) % 19) === 0 ? '#3b332c' : '#2a2420';
      hx.fillRect(x + k * p, y + 2.5 * p, p, p);
    }
    hx.fillStyle = '#5a4f45'; hx.fillRect(x + p, y + p, p, 1.5 * p); hx.fillRect(x + (cells - 2) * p, y + p, p, 1.5 * p);
    hx.fillStyle = '#2a2420'; hx.fillRect(x + p, y + p, p, 1.5 * p); hx.fillRect(x + (cells - 2) * p, y + p, p, 1.5 * p);
    if (n > 0) {
      const breath = Math.floor(t * 0.06);
      const frame = Math.floor(t * 3);
      for (let k = 0; k < n; k++) {
        const seed = (k * 17 + 5) % 11, period = 7 + (seed % 4), pulse = (breath + seed * 3) % period;
        const edge = ((k * 5 + frame + seed) % 7) < 2 ? 0.5 * p : 0;
        hx.fillStyle = pulse < 2 ? fill[2] : fill[1];
        hx.fillRect(x + (2 + k) * p, y + p + edge, p, 1.5 * p - edge);
        if (pulse === 1 && seed % 3 !== 0) {
          hx.fillStyle = 'rgba(183,206,208,0.45)';
          hx.fillRect(x + (2 + k) * p, y + p + edge, p, 0.5 * p);
        }
      }
      for (let k = 0; k < n; k++) {
        const seed = (k * 19 + 7) % 23, pulse = (seed + frame * (3 + (k % 4))) % 23;
        if (pulse < 3) {
          hx.fillStyle = fill[2];
          hx.fillRect(x + (2 + k) * p, y + p, p, p);
        }
      }
      if (active) {
        const crest = Math.floor(t * 0.3) % (n + 6) - 3;
        for (let j = 0; j < 3; j++) {
          const k = crest + j;
          if (k < 0 || k >= n) continue;
          hx.fillStyle = j === 1 ? '#d5e8e5' : '#a9c8c8';
          hx.fillRect(x + (2 + k) * p, y + p, p, p);
          if (j === 0 || j === 2) hx.fillRect(x + (2 + k) * p, y + 2 * p, p, 0.5 * p);
        }
        const spark = (Math.floor(t * 0.18) * 7) % Math.max(1, n);
        hx.fillStyle = '#d5e8e5';
        hx.fillRect(x + (2 + spark) * p, y + 0.5 * p, p, 0.5 * p);
      }
    }
  }
  // The freeze gauge (art pass): the iron frame of the health bars, cut thin, with a small frost
  // crystal at its head. Ready: full, cold and still. Held: the ice drains right to left, a notch
  // in the frame for every second left; in its last second and a half it turns pale and winks,
  // and the crystal cracks. Thawed: it refills dull slate from the left, and when it is ready
  // again a single bright pixel runs once along its top edge, the crystal catches the light and
  // a small glass note sounds.
  const FROST_GLYPH = ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'];
  const FROST_CRACKED = ['..#..', '#...#', '.#.#.', '#.#..', '..#..'];
  function drawFreezeBar(x, y, cells, p, t) {
    const px = (cx, cy, col) => { hx.fillStyle = col; hx.fillRect(x + cx * p, y + cy * p, p, p); };
    const held = !!sim.freezeSeed, max = sim.freezeMax || 300, cool = sim.freezeCool || 0, coolMax = sim.freezeCoolMax || 45;
    const left = held ? Math.max(0, max - (sim.freezeT || 0)) : 0, warn = held && left < 90;
    const ready = !held && cool <= 0;
    if (fx.frzWasCool && ready) { fx.frzReadyT = 0; A.glance(); }                // ready again: the cue, once
    fx.frzWasCool = !held && cool > 0;
    if (fx.frzReadyT != null) fx.frzReadyT++;
    const rt = fx.frzReadyT == null ? 99 : fx.frzReadyT;
    // the crystal
    const blink = warn && Math.floor(t * 2.5) % 2 === 0;
    const gc = ready ? (rt < 10 ? '#e6fbff' : '#93b9c4') : held ? (warn ? (blink ? '#cfe0e4' : '#6c7f86') : '#b7d6de') : '#4a565c';
    (warn ? FROST_CRACKED : FROST_GLYPH).forEach((r, ry) => [...r].forEach((ch, rx) => { if (ch === '#') { px(rx + 1, ry + 1, 'rgba(10,8,10,0.6)'); px(rx, ry, gc); } }));
    // the frame
    const bx = 7, len = cells - bx;
    const chip = (k) => ((k * 37 + 11) % 13) === 0, nick = (k) => ((k * 53 + 5) % 17) === 0;
    for (let k = 0; k < len; k++) {
      px(bx + k, 0, chip(k) ? '#2a2420' : '#5a4f45');
      for (let r = 1; r <= 3; r++) px(bx + k, r, '#100c0e');
      px(bx + k, 4, nick(k) ? '#2a2420' : '#3b332c');
    }
    px(bx - 1, 1, '#3b332c'); px(bx - 1, 2, '#5a4f45'); px(bx - 1, 3, '#3b332c');
    px(bx + len, 1, '#3b332c'); px(bx + len, 2, '#5a4f45'); px(bx + len, 3, '#3b332c');
    // the fill
    const inner = len;
    let n, top, mid, low;
    if (held) { n = Math.ceil(inner * left / max); top = warn ? (blink ? '#e4f1f2' : '#8fa6ab') : '#c3dde2'; mid = warn ? (blink ? '#b7ced0' : '#5e7176') : '#7fa3ad'; low = warn ? '#4a5a5f' : '#4e6a72'; }
    else if (!ready) { n = Math.floor(inner * (1 - cool / coolMax)); top = '#5d7077'; mid = '#3d4a50'; low = '#2c363b'; }
    else { n = inner; top = '#a9c8ce'; mid = '#6f8f98'; low = '#45606a'; }
    for (let k = 0; k < n; k++) { px(bx + k, 1, top); px(bx + k, 2, mid); px(bx + k, 3, low); }
    if (!held && !ready && n > 0 && n < inner) { px(bx + n - 1, 1, '#93a9ae'); px(bx + n - 1, 2, '#6c8187'); }   // the refilling edge
    if (held) for (let sec = 60; sec < left; sec += 60) { const k = Math.round(inner * sec / max); if (k > 0 && k < n) px(bx + k, 4, '#8a7a68'); }   // a notch per second left
    if (ready && rt < 16) { const k = Math.round(rt / 15 * (inner - 1)); px(bx + k, 1, '#ffffff'); if (k > 0) px(bx + k - 1, 1, '#e6fbff'); }    // ready: one bright run along the top
  }
  // THE TIME SLOW (Space tap), in three beats, all counted in real frames:
  //   start  INSTANT on the press frame (no hold, no fade-in): the blue cast and the drain are full,
  //          frost at the screen's edges, a small frost burst at your sand, a lens warp out through the
  //          world, and a breath in
  //   during it is the world that slows, not a decoration on you: the scene's own animation
  //          (flames, banners, water, dust) runs at the slowed rate, moving creatures leave cold
  //          afterimages, a soft tick-tock
  //   end    the cast and frost ease out over the window's last fifth; then the burst plays back in at
  //          your sand as the warp is drawn back in to you, a small punch, a soft glass note
  function slowBegin() {
    const bx = fx.bodyX != null ? fx.bodyX : sim.cx, by = fx.bodyY != null ? fx.bodyY : sim.cy;
    A.breathe(false); A.glance(); fx.slowK = 1;                               // instant: no held beat, the cast and drain are full on the press frame
    fx.slowStartF = fx.realF || 0; fx.tickN = 0;
    slowBurst(bx, by - 2, false);                                                 // the burst (the blue ripple through the whole world is gone)
    if (FF && FF.shock) FF.shock(bx, by, 1.0, 4.4);                              // the warp: a lens wave bends the world out from you
  }
  // THE SLOW'S BURST, the same drawing both ways: out on the press (a frost core, a ring thrown out,
  // eight cold glints flung round), and back in when time is yours again (the glints fly in from all
  // round, the ring closes, it ends in the same core). Small, at your sand, never a blast over the world.
  function slowBurst(x, y, back) {
    if (!back) {
      R.fx.core(x, y, 2.5, 'frost', 2); R.fx.ring(x, y, 2, 12, 'frost', 8, { thick: 1, l0: 1 });
      for (let k = 0; k < 8; k++) { const b = (k / 8) * Math.PI * 2 + 0.2, v = 1 + (k % 2) * 0.5; R.fx.spark(x, y, Math.cos(b) * v, Math.sin(b) * v, 'frost', 11, { l0: 1, g: 0, drag: 0.88 }); }
    } else {
      for (let k = 0; k < 8; k++) { const b = (k / 8) * Math.PI * 2 + 0.2, r0 = 12 + (k % 2) * 2; R.fx.spark(x + Math.cos(b) * r0, y + Math.sin(b) * r0, -Math.cos(b) * r0 / 9, -Math.sin(b) * r0 / 9, 'frost', 9, { l0: 1, g: 0, drag: 1 }); }
      R.fx.ring(x, y, 12, 2, 'frost', 9, { thick: 1, l0: 1 });
      const c = R.fx.core(x, y, 2.5, 'frost', 2); if (c) c.delay = 9;             // ...and it closes on the core it began with
    }
  }
  function slowStep() {
    const on = !!sim.spaceSlowNow, B = sim.spaceBar ? sim.spaceBar() : null;
    const aim = on ? (B && B.state === 'slow' && B.frac < 0.2 ? B.frac / 0.2 : 1) : 0;    // eases out over the window's last 10 frames
    fx.slowK = aim >= (fx.slowK || 0) ? aim : fx.slowK + (aim - fx.slowK) * 0.2;   // on at once, off gently
    if (FA) FA.slowTrail = on;
    if (on) {
      const age = (fx.realF || 0) - (fx.slowStartF || 0);
      // a clock's tick and tock while time is held
      if (age > 0 && age % 16 === 0) { if ((fx.tickN = (fx.tickN || 0) + 1) & 1) A.impact(0.06); else A.glance(); }
    }
    if (fx.slowWasOn && !on) {
      const bx = fx.bodyX != null ? fx.bodyX : sim.cx, by = fx.bodyY != null ? fx.bodyY : sim.cy;
      slowBurst(bx, by - 2, true);                                                  // the return: the start's burst played back in
      if (FF && FF.shock) FF.shock(bx, by, 1.1, -5, 100);                          // and the warp drawn back in to you from the edges of the view

      if (FF && FF.knock) FF.knock(0, 1, 1.2); cam.shake = Math.max(cam.shake, 1.2);
      A.glance(); A.breathe(true);
    }
    fx.slowWasOn = on;
  }
  function slowSprites() { return []; }                                            // (the clock and the sand echo were removed: the slow is the world's, not the character's)
  // a frame of frost at the screen's edges while time is slowed: uneven depth along each edge (a
  // slow noise), scattered grains thinning inward, and a few branching sprigs of frost reaching in,
  // all on the screen's pixel grid. Laid out once per screen size (with its own seed).
  function slowFrame(k) {
    const W = hud.width, H = hud.height, p = R.scale;
    if (!fx.slowFrameCv || fx.slowFrameCv.width !== W || fx.slowFrameCv.height !== H || fx.slowFrameP !== p) {
      const cv = fx.slowFrameCv = document.createElement('canvas'); cv.width = W; cv.height = H; fx.slowFrameP = p;
      const g = cv.getContext('2d'), cols = Math.ceil(W / p), rows = Math.ceil(H / p);
      const hh = (x, y, n) => { let v = Math.sin(x * 12.9898 + y * 78.233 + n * 37.719) * 43758.5453; return v - Math.floor(v); };
      const vn = (t, n) => { const i = Math.floor(t), f = t - i, s2 = f * f * (3 - 2 * f); return hh(i, n, 1) * (1 - s2) + hh(i + 1, n, 1) * s2; };
      const depth = (x, y) => {                                                 // how far the frost reaches in here
        const e = Math.min(x, y, cols - 1 - x, rows - 1 - y), along = e === x || e === cols - 1 - x ? y : x, side = e === x ? 1 : e === y ? 2 : e === cols - 1 - x ? 3 : 4;
        return { e, d: 1.5 + vn(along * 0.07, side) * 5 + vn(along * 0.23, side + 9) * 2 };
      };
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const { e, d } = depth(x, y); if (e > d) continue;
        const t = e / d, n = hh(x, y, 3);
        if (n < 0.85 - t * 0.75) { g.fillStyle = t < 0.3 && n < 0.35 ? 'rgba(206,226,250,0.62)' : 'rgba(150,182,232,0.48)'; g.fillRect(x * p, y * p, p, p); }
      }
      // sprigs: a jagged stem in from the edge, a side branch or two
      g.fillStyle = 'rgba(224,238,255,0.7)';
      const nS = Math.round((cols + rows) / 18);
      for (let k2 = 0; k2 < nS; k2++) {
        const side = k2 % 4, u = hh(k2, 5, 7);
        let x = side === 0 ? 0 : side === 2 ? cols - 1 : Math.round(u * (cols - 1)), y = side === 1 ? 0 : side === 3 ? rows - 1 : Math.round(u * (rows - 1));
        const dx = side === 0 ? 1 : side === 2 ? -1 : 0, dy = side === 1 ? 1 : side === 3 ? -1 : 0, len = 4 + Math.round(hh(k2, 6, 7) * 6);
        for (let i = 0; i < len; i++) {
          g.fillRect(x * p, y * p, p, p);
          if (i > 1 && hh(k2, i, 8) < 0.28) { const bl = 1 + Math.round(hh(k2, i, 9) * 2), sgn = hh(k2, i, 10) < 0.5 ? -1 : 1; for (let b2 = 1; b2 <= bl; b2++) g.fillRect((x + (dy ? sgn * b2 : dx * b2)) * p, (y + (dx ? sgn * b2 : dy * b2)) * p, p, p); }
          x += dx + (dy && hh(k2, i, 11) < 0.25 ? (hh(k2, i, 12) < 0.5 ? -1 : 1) : 0); y += dy + (dx && hh(k2, i, 13) < 0.25 ? (hh(k2, i, 14) < 0.5 ? -1 : 1) : 0);
        }
      }
    }
    hx.globalAlpha = k * 0.7; hx.drawImage(fx.slowFrameCv, 0, 0); hx.globalAlpha = 1;   // present, never loud
  }
  // The time-slow gauge (Space): the same iron frame, a small hourglass at its head. Ready: full,
  // a still pale blue. A tap: the fill flashes and the glass turns over. Slowed: it drains right to
  // left in bright blue while the hourglass's top sand runs out and a grain blinks through the neck.
  // Recovering: it refills dull from the left. Ready again: one bright pixel runs along its top
  // and the glass catches the light. A refused press (slowed or recovering): the bar shakes a
  // pixel either way and a red tick marks where it stands.
  const SLOW_GLYPH = ['#####', '.#s#.', '..#..', '.#s#.', '#####'];
  function drawSlowBar(x, y, cells, p, t) {
    if (!sim.spaceBar) return;
    const B = sim.spaceBar(), slow = B.state === 'slow', ready = B.state === 'ready';
    const since = (f) => f == null ? 99 : (fx.realF || 0) - f;                // real frames since a moment
    const rt = since(fx.slowReadyF), pt = since(fx.slowPressF), ft = since(fx.slowRefuseF);
    const sx = ft < 8 ? (ft & 2 ? p : -p) : 0;
    const px = (cx, cy, col) => { hx.fillStyle = col; hx.fillRect(x + sx + cx * p, y + cy * p, p, p); };
    // the hourglass: frame, and its sand (top in the upper bulb while it runs, bottom otherwise)
    const flip = pt < 6, gc = ready ? (rt < 10 ? '#eaf2ff' : '#9fb4d8') : slow ? '#c9d9f5' : '#4c5466';
    SLOW_GLYPH.forEach((r, ry) => [...(flip ? SLOW_GLYPH[4 - ry] : r)].forEach((ch, rx) => {
      if (ch === '.') return;
      if (ch === '#') { px(rx + 1, ry + 1, 'rgba(10,8,10,0.6)'); px(rx, ry, gc); return; }
      const top = ry < 2, sand = slow ? (top ? B.frac > 0.35 : B.frac < 0.65) : !top;
      if (sand) px(rx, ry, '#e9bb6c');
    }));
    if (slow && Math.floor(t * 8) % 2 === 0) px(2, 2, '#e9bb6c');              // a grain through the neck
    // the frame
    const bx = 7, len = cells - bx;
    const chip = (k) => ((k * 41 + 7) % 13) === 0, nick = (k) => ((k * 59 + 3) % 17) === 0;
    for (let k = 0; k < len; k++) {
      px(bx + k, 0, chip(k) ? '#2a2420' : '#5a4f45');
      for (let r = 1; r <= 3; r++) px(bx + k, r, '#100c0e');
      px(bx + k, 4, nick(k) ? '#2a2420' : '#3b332c');
    }
    for (const ex of [bx - 1, bx + len]) { px(ex, 1, '#3b332c'); px(ex, 2, '#5a4f45'); px(ex, 3, '#3b332c'); }
    // the fill
    let n, top, mid, low;
    if (slow) { n = Math.ceil(len * B.frac); top = '#d6e4ff'; mid = '#7f9ee8'; low = '#4a5fa8'; }
    else if (!ready) { n = Math.floor(len * B.frac); top = '#5a6378'; mid = '#3b4256'; low = '#2a2f3e'; }
    else { n = len; top = '#b9c9ec'; mid = '#7488b8'; low = '#46557e'; }
    if (pt < 3) { top = mid = '#f4f8ff'; low = '#c9d9f5'; }                    // the tap: a flash
    for (let k = 0; k < n; k++) { px(bx + k, 1, top); px(bx + k, 2, mid); px(bx + k, 3, low); }
    if (B.state === 'cool' && n > 0 && n < len) { px(bx + n - 1, 1, '#8b95ad'); px(bx + n - 1, 2, '#6b7590'); }
    if (ready && rt < 16) { const k = Math.round(rt / 15 * (len - 1)); px(bx + k, 1, '#ffffff'); if (k > 0) px(bx + k - 1, 1, '#eaf2ff'); }
    if (ft < 14) { const k = Math.max(0, Math.min(len - 1, n - 1)); px(bx + k, 0, '#d0654f'); px(bx + k, 4, '#d0654f'); }   // refused: a red tick
  }
  function drawBar(x, y, cells, frac, shown, p, fill) {
    const H0 = 7, px = (cx, cy, col) => { hx.fillStyle = col; hx.fillRect(x + cx * p, y + cy * p, p, p); };
    const chip = (k) => ((k * 37 + 11) % 13) === 0, nick = (k) => ((k * 53 + 5) % 17) === 0;
    for (let k = 0; k < cells; k++) {
      px(k, 0, chip(k) ? '#2a2420' : '#5a4f45'); px(k, 1, '#1a1512');
      for (let r = 2; r <= 4; r++) px(k, r, '#100c0e');
      px(k, 5, '#1a1512'); px(k, 6, nick(k) ? '#2a2420' : '#3b332c');
    }
    const fw = Math.round((cells - 2) * Math.max(0, frac)), sw = Math.round((cells - 2) * Math.max(0, Math.min(1, shown)));
    for (let k = 1; k <= sw; k++) for (let r = 2; r <= 4; r++) px(k, r, k <= fw ? (r === 2 ? fill[2] : r === 4 ? fill[0] : fill[1]) : (r === 2 ? '#f3e2bd' : '#cdb88f'));
    for (let k = 1; k <= fw; k += 5) px(k, 3, fill[2] + '66');                       // a little texture in the fill
    const cap = (ox, flip) => BAR_CAP.forEach((r, ry) => [...(flip ? [...r].reverse().join('') : r)].forEach((ch, rx) => { if (ch !== '.') px(ox + rx, ry, ch === '#' ? '#5a4f45' : ch === '=' ? '#8a7a68' : '#d9b26a'); }));
    cap(-3, false); cap(cells - 1, true);
  }

  // ---------- pause menu ----------
  // Quiet and spacious: the game blurs behind a veil, one soft typeface,
  // no boxes. The chosen line brightens and gets a small grain of sand.
  const F = window.SpillFonts;
  function grainMark(x, y, p) {
    for (const [dx, dy, c] of [[1, 0, '#fbe2a2'], [0, 1, '#e3b062'], [1, 1, '#f2cf7c'], [2, 1, '#e3b062'], [1, 2, '#b07a32']]) {
      hx.fillStyle = c; hx.fillRect(x + dx * p, y + dy * p, p, p);
    }
  }
  function rule(cx, y, w, p, a) {
    hx.fillStyle = `rgba(239,230,210,${a})`;
    hx.fillRect(Math.round((cx - w / 2) / p) * p, y, Math.round(w / p) * p, p);
  }
  function drawPause(t) {
    const W = hud.width, H = hud.height, p = R.scale;
    hx.fillStyle = 'rgba(6,4,10,0.5)'; hx.fillRect(0, 0, W, H);
    const rowH = 15 * p, total = MENU.length * rowH;
    const col = Math.round((W / 2 - 46 * p) / p) * p, y0 = Math.round((H - total) / 2 / p) * p;
    const mxs = mouse.sx * dpr, mys = mouse.sy * dpr;
    pause.hover = -1;
    MENU.forEach((it, i) => {
      const ry = y0 + i * rowH;
      pause.boxes[i] = { x: col - 12 * p, y: ry - 3 * p, w: 120 * p, h: rowH - 2 * p };
      const bxx = pause.boxes[i];
      if (mxs >= bxx.x && mxs <= bxx.x + bxx.w && mys >= bxx.y && mys <= bxx.y + bxx.h) { pause.hover = i; if (pause.mouseMoved) pause.sel = i; }
      const on = pause.sel === i;
      hx.globalAlpha = on ? 1 : 0.42;
      F.draw(hx, typeof it.label === 'function' ? it.label() : it.label, col, ry, 'soft', p);
      if (it.kind === 'slider') {
        const v = A.volume(it.key), rx = col + 40 * p, rw = 50 * p, rly = ry + 4 * p;
        it.track = { x: rx, w: rw };
        hx.fillStyle = 'rgba(239,230,210,0.22)'; hx.fillRect(rx, rly, rw, p);
        hx.fillStyle = on ? '#f2cf7c' : '#d6a052'; hx.fillRect(rx, rly - p, Math.round(v * rw / p) * p, 2 * p);
      }
      hx.globalAlpha = 1;
    });
  }

  // The shrine: the game blurred behind, three lenses side by side (icon and
  // name; the chosen one brightens), and two quiet lines beneath.
  // A lens card, drawn like a small portrait: a bevelled frame whose metal
  // and shape say its rarity (dark bronze; polished silver with an inner
  // line; gold with corner ornaments and gems), the lens's own background in
  // stepped light, and its icon in four shades. Damage is drawn into frame
  // and face: a branching crack with a lit edge, or two cracks and broken
  // corners. A sealed card is dimmed and struck through in dull red.
  const CARD = 20;
  const METAL = { common: ['#1d1712', '#4a3b2c', '#7a6449', '#a68d6b'], uncommon: ['#141c14', '#38503a', '#6a8a62', '#a3c294'], rare: ['#161b22', '#3e4a5a', '#76889c', '#a8bacb'],
    epic: ['#1c1424', '#4a3466', '#8a6ab4', '#d4bff0'], legendary: ['#2a1d08', '#7a5a22', '#d0a85e', '#fff0c4'] };
  const GEM = { epic: ['#c46ad8', '#6a2a7a', '#f2c4fa'], legendary: ['#3fb8a8', '#1d6e66', '#9ff0e4'] };
  function lensCard(l, x, y, ip, on, t, mode) {
    const cell = (cx, cy, col) => { hx.fillStyle = col; hx.fillRect(x + cx * ip, y + cy * ip, ip, ip); };
    const N = CARD;
    if (mode === 'empty' || !l) {
      // a bought slot: the empty niche the lens sat in. A cavity pressed into the board (its
      // top and left in shadow, its far edges catching a little light), a worn bronze lip with
      // the bevel turned inward, chipped in a couple of places, the faint pale mark where the
      // lens rested, and a mote or two of dust.
      const B = METAL.common, hsh = (a2, b2) => ((((x / ip) | 0) * 31 + a2 * 73856093) ^ (b2 * 19349663)) >>> 0;
      for (let cy = 2; cy < N - 2; cy++) for (let cx = 2; cx < N - 2; cx++) cell(cx, cy, cy === 2 || cx === 2 ? '#050307' : cy === 3 || cx === 3 ? '#08060b' : '#0d0a10');
      for (let k = 3; k < N - 2; k++) { cell(k, N - 3, '#1a1410'); cell(N - 3, k, '#16110d'); }       // the far inner edges, lit
      for (let k = 0; k < N; k++) {
        cell(k, 0, B[0]); cell(k, N - 1, B[0]); cell(0, k, B[0]); cell(N - 1, k, B[0]);
        if (k >= 1 && k <= N - 2) { cell(k, 1, B[1]); cell(1, k, B[0]); cell(k, N - 2, B[2]); cell(N - 2, k, B[3]); }   // the bevel turned inward
      }
      for (let c2 = 0; c2 < 3; c2++) {                                                     // chips in the lip
        const h0 = hsh(c2, 7), k = 3 + (h0 % (N - 6)), side = (h0 >> 4) % 4;
        const [cx, cy] = side === 0 ? [k, 1] : side === 1 ? [k, N - 2] : side === 2 ? [1, k] : [N - 2, k];
        cell(cx, cy, '#0b0810'); if ((h0 >> 7) % 2) cell(cx + (side < 2 ? 1 : 0), cy + (side < 2 ? 0 : 1), B[0]);
      }
      // where the lens rested: a faint pale rim of cleaner wood, unbroken but for two worn gaps
      const g1 = 5 + hsh(1, 3) % 8, g2 = 5 + hsh(2, 9) % 8;
      for (let k = 5; k < N - 5; k++) {
        if (k !== g1) cell(k, 5, 'rgba(214,196,160,0.13)');
        cell(k, N - 6, 'rgba(214,196,160,0.09)');
        cell(5, k, 'rgba(214,196,160,0.11)');
        if (k !== g2) cell(N - 6, k, 'rgba(214,196,160,0.08)');
      }
      cell(7 + hsh(3, 1) % 6, 8 + hsh(4, 2) % 5, 'rgba(232,214,180,0.30)');            // dust
      cell(10 + hsh(5, 3) % 4, 12 + hsh(6, 4) % 3, 'rgba(232,214,180,0.18)');
      return;
    }
    const art = window.SpillLensArt.L[l.art || l.id] || window.SpillLensArt.L.wide, M = METAL[l.rarity] || METAL.common;
    // background: the lens's colour in stepped light, brightest at the centre
    for (let cy = 3; cy < N - 3; cy++) for (let cx = 3; cx < N - 3; cx++) {
      const d = Math.max(Math.abs(cx - 9.5), Math.abs(cy - 9.5));
      const band = d < 4 ? 2 : d < 5.5 ? ((cx + cy) % 2 ? 2 : 1) : d < 6 ? 1 : d < 6.6 ? ((cx + cy) % 2 ? 1 : 0) : 0;
      cell(cx, cy, art.bg[band]);
    }
    for (const [mx, my] of [[5, 5], [14, 6], [6, 14]]) cell(mx, my, art.hue[3] + '55');       // a few motes
    // the icon
    const IC = { k: '#0b0910', d: art.hue[0], m: art.hue[1], l: art.hue[2], h: art.hue[3], a: '#c99a52', s: '#f0cf8a', w: '#ffffff' };
    art.icon.forEach((r, ry) => [...r].forEach((ch, rx) => { if (ch !== '.') cell(4 + rx, 4 + ry, IC[ch]); }));
    if (!on) { hx.fillStyle = 'rgba(8,6,12,0.25)'; hx.fillRect(x + 3 * ip, y + 3 * ip, (N - 6) * ip, (N - 6) * ip); }
    // the frame: an outer dark line, a bevel lit from the top left, an inner lip
    for (let k = 0; k < N; k++) {
      cell(k, 0, M[0]); cell(k, N - 1, M[0]); cell(0, k, M[0]); cell(N - 1, k, M[0]);
      if (k >= 1 && k <= N - 2) { cell(k, 1, M[3]); cell(1, k, M[2]); cell(k, N - 2, M[1]); cell(N - 2, k, M[1]); }
      if (k >= 2 && k <= N - 3) { cell(k, 2, M[1]); cell(2, k, M[1]); cell(k, N - 3, M[0]); cell(N - 3, k, M[0]); }
    }
    if (l.rarity === 'rare' || l.rarity === 'epic') for (let k = 4; k <= N - 5; k += 1) if (k % 3) { cell(k, 3, M[2] + '88'); cell(3, k, M[2] + '88'); }   // a fine inner line
    if (GEM[l.rarity]) {
      const G = GEM[l.rarity];
      for (const [ox, oy] of [[0, 0], [N - 4, 0], [0, N - 4], [N - 4, N - 4]]) {      // corner ornaments with a gem
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a + b < 6) cell(ox + a, oy + b, (a + b) % 2 ? M[2] : M[3]);
        cell(ox + 1, oy + 1, G[0]); cell(ox + 2, oy + 2, G[1]); cell(ox + 2, oy + 1, G[2]);
      }
      const g = Math.floor(t * 10) % (N * 2);                // a glint travels along the top
      if (g < N - 8) { cell(4 + g, 1, '#ffffff'); cell(5 + g, 1, M[3]); }
      if (l.rarity === 'legendary' && g >= N && g - N < N - 8) { cell(N - 5 - (g - N), N - 2, '#ffffff'); cell(N - 6 - (g - N), N - 2, M[3]); }   // and a second back along the bottom
    }
    // damage: whole is untouched; cracked has fine hairline cracks starting
    // all around the frame, a few reaching into the face; chipped is cracked
    // deeper, with chunks broken out of the frame at several points
    const Q = qOf(l.q);
    let seed = 11; for (const ch of l.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };
    const hair = (sx, sy, dx, dy, len) => {
      let cx = sx, cy = sy;
      for (let k = 0; k < len; k++) {
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) break;
        cell(cx, cy, k < 2 ? '#060408' : '#0d0a10');
        const lx = cx - dy, ly = cy + dx;                                         // a lit edge beside the line
        if (lx >= 0 && ly >= 0 && lx < N && ly < N && (k % 2 === 0)) cell(lx, ly, 'rgba(190,150,104,0.18)');
        cx += dx; cy += dy;
        if (rnd() < 0.45) { if (dx) cy += rnd() < 0.5 ? -1 : 1; else cx += rnd() < 0.5 ? -1 : 1; }
      }
    };
    if (Q.cracks >= 1) {
      const deep = Q.chips ? 2 : 0;
      const spots = Q.chips ? 10 : 7;
      for (let k = 0; k < spots; k++) {                                        // starting points spread around the frame
        const u = (k + rnd() * 0.6) / spots, side = Math.floor(u * 4), along = Math.floor((u * 4 - side) * (N - 4)) + 2;
        const len = 2 + Math.floor(rnd() * 3) + deep + (k % 3 === 0 ? 3 + deep : 0);
        if (side === 0) hair(along, 0, 0, 1, len); else if (side === 1) hair(N - 1, along, -1, 0, len);
        else if (side === 2) hair(N - 1 - along, N - 1, 0, -1, len); else hair(0, N - 1 - along, 1, 0, len);
      }
    }
    if (Q.chips) {                                           // chunks gone from the frame: jagged, the dark inside showing
      const chips = [[0, 0, 4], [N - 1, 3, 3], [N - 1, N - 1, 4], [5, N - 1, 3], [0, 11, 3]];
      for (const [cx0, cy0, size] of chips) {
        for (let a = 0; a < size; a++) for (let b = 0; b < size - a; b++) {
          const cx = cx0 + (cx0 > N / 2 ? -a : a), cy = cy0 + (cy0 > N / 2 ? -b : b);
          if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
          if (a + b === size - 1 && rnd() < 0.4) continue;                       // a ragged break line
          cell(cx, cy, (a + b === size - 1) ? M[3] : '#08060a');
        }
      }
    }
    if (mode === 'sealed') {                                 // dimmed, and struck through in dull red
      hx.fillStyle = 'rgba(14,10,14,0.55)'; hx.fillRect(x, y, N * ip, N * ip);
      for (let k = 3; k < N - 3; k++) {
        for (const [cx, cy] of [[k, k], [N - 1 - k, k]]) { cell(cx, cy, '#7a2e28'); cell(cx + 1, cy, '#4a1a16'); cell(cx, cy - 1 < 0 ? cy : cy - 1, '#9b4038'); }
      }
    }
  }
  const RARITY_NAME = Object.fromEntries(Object.entries(RARITY).map(([k, v]) => [k, v.name]));
  // wrap a line of text to a width, for the shop cards
  function wrapText(text, maxW, font, sz) {
    const words = String(text).split(' '), rows = [''];
    for (const w of words) { const tr = rows[rows.length - 1] ? rows[rows.length - 1] + ' ' + w : w; if (F.measure(tr, font) * sz > maxW && rows[rows.length - 1]) rows.push(w); else rows[rows.length - 1] = tr; }
    return rows;
  }
  // The Keeper's stall: a dark wooden board with brass corners; three wares
  // cards; your lenses in sockets along the bottom; plain plates for the rest.
  function stallBoard(x, y, w, h, p) {
    hx.fillStyle = 'rgba(16,11,9,0.95)'; hx.fillRect(x + p, y + p, w - 2 * p, h - 2 * p);
    for (let yy = y + 10 * p; yy < y + h - 4 * p; yy += 22 * p) { hx.fillStyle = 'rgba(0,0,0,0.35)'; hx.fillRect(x + 2 * p, yy, w - 4 * p, p); hx.fillStyle = 'rgba(120,84,52,0.10)'; hx.fillRect(x + 2 * p, yy + p, w - 4 * p, p); }   // planks
    hx.fillStyle = '#5a4030'; hx.fillRect(x + 3 * p, y, w - 6 * p, p); hx.fillRect(x, y + 3 * p, p, h - 6 * p);
    hx.fillStyle = '#20150e'; hx.fillRect(x + 3 * p, y + h - p, w - 6 * p, p); hx.fillRect(x + w - p, y + 3 * p, p, h - 6 * p);
    for (const [cx, cy] of [[x, y], [x + w - 5 * p, y], [x, y + h - 5 * p], [x + w - 5 * p, y + h - 5 * p]]) {        // brass corner caps
      hx.fillStyle = '#5e3e1c'; hx.fillRect(cx, cy, 5 * p, 5 * p); hx.fillStyle = '#c99a52'; hx.fillRect(cx + p, cy + p, 3 * p, 3 * p); hx.fillStyle = '#f0cf8a'; hx.fillRect(cx + p, cy + p, p, p);
    }
    hx.fillStyle = 'rgba(16,11,9,0.95)'; hx.fillRect(x + Math.round(w * 0.37 / p) * p, y, p, p); hx.fillRect(x + w - p, y + Math.round(h * 0.62 / p) * p, p, p);   // nicks
  }
  // a small satchel, drawn by hand, for the backpack button
  // a rucksack: a carry loop, a flap with a brass buckle, a full body, side straps
  // a slim rucksack, taller than wide: carry loop, a flap with a brass buckle, a front pocket
  const RUCKSACK = ['...kkk...', '..k...k..', '.kkkkkkk.', 'kllhhhllk', 'klhhhhhmk', 'kkkkbkkkk', 'klmmbmmdk', 'klmmmmmdk', 'klkkkkkdk', 'klkhlmkdk', 'kdkmmdkdk', '.kkkkkkk.'];
  const RUCK_COL = { k: '#140e0a', l: '#b88a56', h: '#d8ac74', m: '#8a6238', d: '#5a3e22', b: '#e2b866', s: '#3a2818' };
  function drawRucksack(x, y, p, lit) { RUCKSACK.forEach((r, ry) => [...r].forEach((ch, rx) => { if (ch === '.') return; hx.fillStyle = lit && ch === 'b' ? '#fff0c4' : RUCK_COL[ch]; hx.fillRect(x + rx * p, y + ry * p, p, p); })); }
  // a shop button: dark oak with a brass rim lit from above, rivets at the corners, chipped corners;
  // the main one wears brighter brass, and a hovered one lifts a pixel and warms
  function shopButton(x, y, w, h, p, o) {
    const lift = o.hover && !o.disabled ? -p : 0;
    window.SpillUIArt.button(hx, x, y + lift, w, h, p, o.disabled ? 'dull' : o.hover || o.primary ? 'hot' : 'normal', 1 + (Math.round(x / p) % 97));   // each button its own grain
    return lift;
  }
  // a hand-drawn divider: a thin line that wavers a pixel here and there
  function divider(x, y, w, p, col) { for (let k = 0; k < w; k += p) { const j = Math.sin(k * 0.13 / p) > 0.92 ? p : 0; hx.fillStyle = col; hx.fillRect(x + k, y + j, p, p); } }
  function drawShrine(t) {
    const W = hud.width, H = hud.height, d = purse();
    const p = Math.max(1, Math.min(R.scale, Math.floor(H / 240), Math.floor(W / 320)));   // the same pixel size as the rest of the HUD

    const a = Math.min(1, shrine.t / 30);
    hx.globalAlpha = a;
    hx.fillStyle = 'rgba(6,4,10,0.78)'; hx.fillRect(0, 0, W, H);
    const items = shrineItems(), mxs = mouse.sx * dpr, mys = mouse.sy * dpr;
    const picked = shrine.picked != null && shrine.picked >= 0;
    const CREAM = '#e8dcc4', MUTED = '#8a7f70', GOLD = '#e2b866';
    const SEC = 20 * p, LINE = 11 * p, cx = Math.round(W / 2 / p) * p;
    const ip = p * 3, cardPx = CARD * ip, pitch = cardPx + 36 * p;
    const Lf = shrine.offer[shrine.focus], descRows = Lf ? wrapText(Lf.desc + '.', 220 * p, 'soft', p).length : 1;
    const stackH = (20 * p + 4 * p) + (LINE + SEC) + (cardPx + SEC) + (LINE + LINE + descRows * LINE) + (SEC - LINE) + 12 * p;
    let y = Math.max(10 * p, Math.round((H - stackH) / 2 / p) * p);
    shrine.boxes = [];
    const over = (b) => mouse.inside && mxs >= b.x && mxs <= b.x + b.w && mys >= b.y && mys <= b.y + b.h;
    const textMidY = (boxY, boxH) => Math.round((boxY + boxH / 2 - 4.5 * p) / p) * p;
    hx.globalAlpha = a;
    tintText('Shop', cx + p, y + p, 'soft', p * 2, 'center', '#140b05');
    tintText('Shop', cx, y, 'soft', p * 2, 'center', GOLD);
    y += 20 * p + 4 * p;                                                         // title and sand: one section, a small gap
    const pt = grains(d.carried), ptw = (F.measure(pt, 'soft') + 11) * p;
    HUD_ICONS.pile.forEach((r, ry) => [...r].forEach((ch, rx) => { if (ch === '.') return; hx.fillStyle = HUD_PAL.sun[ch]; hx.fillRect(cx - ptw / 2 + rx * p, y + 3 * p + ry * p, p, p); }));
    tintText(pt, cx - ptw / 2 + 11 * p, y, 'soft', p, 'left', CREAM);
    y += LINE + SEC;
    const cardsY = y, L = shrine.offer[shrine.focus];
    const bought = (k) => picked && shrine.picked === k;
    items.forEach((it, i) => {
      if (!('slot' in it)) return;
      const x = Math.round((cx + (it.slot - 1) * pitch - cardPx / 2) / p) * p, focus = shrine.focus === it.slot;
      const mode = !it.lens ? 'empty' : picked ? (bought(it.slot) ? 'empty' : 'sealed') : null;
      const box = { x: x - 6 * p, y: cardsY - 4 * p, w: cardPx + 12 * p, h: cardPx + 8 * p };
      hx.globalAlpha = a;
      const bob = focus && !mode ? Math.round((-2 + Math.sin(t * 2) * 1.2)) * p : 0;
      lensCard(it.lens, x, cardsY + bob, ip, focus, t, mode);
      if (focus && !mode) window.SpillUIArt.pointer(hx, x + cardPx / 2, cardsY + cardPx + 5 * p + (Math.floor(t * 2) % 2) * p, p);
      if (!focus && mode !== 'empty') { hx.fillStyle = 'rgba(10,8,14,0.62)'; hx.fillRect(x, cardsY, cardPx, cardPx); }
      if (over(box)) { shrine.focus = it.slot; shrine.sel = i; }
      shrine.boxes[i] = box;
    });
    y = cardsY + cardPx + SEC;
    if (L) {
      hx.globalAlpha = a;
      tintText(L.name, cx + p, y + p, 'soft', p, 'center', '#1a120c'); tintText(L.name, cx, y, 'soft', p, 'center', '#fff4dc');
      y += LINE;
      const rar = RARITY_NAME[L.rarity], cond = '(' + qOf(L.q).name.toLowerCase() + ')', sep = ' ';
      const rw = F.measure(rar + sep, 'soft') * p, tw = F.measure(rar + sep + cond, 'soft') * p, x0 = cx - tw / 2;
      tintText(rar, x0, y, 'soft', p, 'left', RARITY[L.rarity].col);
      tintText(cond, x0 + rw, y, 'soft', p, 'left', MUTED);
      shrine.condBox = { x: x0 + rw - 2 * p, y: y - 3 * p, w: tw - rw + 4 * p, h: 13 * p };
      y += LINE;
      for (const row of wrapText(L.desc + '.', 220 * p, 'soft', p)) { tintText(row, cx, y, 'soft', p, 'center', CREAM); y += LINE; }
    }
    y += SEC - LINE;
    const ctrls = items.map((it, i) => [it, i]).filter(([it]) => it.buy || it.small);
    const GAP = 26 * p;
    const labelOf = (it) => it.buy && it.price != null ? it.label + '  ' + it.price : it.label;
    const widths = ctrls.map(([it]) => F.measure(labelOf(it), 'soft') * p);
    let x = Math.round((W - (widths.reduce((m, w) => m + w, 0) + GAP * (ctrls.length - 1))) / 2 / p) * p;
    ctrls.forEach(([it, i], k) => {
      const w = widths[k], box = { x: x - 6 * p, y: y - 4 * p, w: w + 12 * p, h: 18 * p }, ok = it.can();
      const hov = (over(box) || shrine.sel === i) && ok;
      hx.globalAlpha = a * (ok ? 1 : 0.35);
      tintText(labelOf(it), x + p, y + p, 'soft', p, 'left', '#0c0806');
      tintText(labelOf(it), x, y, 'soft', p, 'left', hov ? '#ffe2a0' : it.buy && ok ? GOLD : CREAM);
      if (over(box)) shrine.sel = i;
      shrine.boxes[i] = box;
      x += w + GAP;
    });
    if (L) {
      const fx0 = Math.round((cx + (shrine.focus - 1) * pitch - cardPx / 2) / p) * p;
      if (shrine.condBox && over(shrine.condBox)) {
        const tip = L.q >= 2 ? 'Lasts for good' : L.life + (L.life === 1 ? ' room left' : ' rooms left'), tw2 = (F.measure(tip, 'soft') + 12) * p, th2 = 15 * p;
        const tx2 = Math.round((shrine.condBox.x + shrine.condBox.w / 2 - tw2 / 2) / p) * p, ty2 = shrine.condBox.y + shrine.condBox.h + 2 * p;
        hx.globalAlpha = a; hx.fillStyle = 'rgba(4,3,7,0.92)'; hx.fillRect(tx2, ty2, tw2, th2);
        tintText(tip, tx2 + 6 * p, textMidY(ty2, th2), 'soft', p, 'left', L.q >= 2 ? '#9fdc6a' : CREAM);
      }
    }
    shrine.infoBox = null;
    hx.globalAlpha = 1;
  }

  // Every control, one hand on the keys (left side) and one on the mouse.
  const CONTROLS = [
    ['Left mouse, hold', 'Draw your sand toward the cursor'],
    ['Shift + left mouse', 'Push your sand away from the cursor'],
    ['Right mouse, drag', 'Throw: pull back and let go (three in the air)'],
    ['F, tap', 'Sand burst: a short, wide blow from your body'],
    ['F, hold and let go', 'Hammer: your sand gathers above you, then crashes down'],
    ['Hop, then throw down', 'Slam: land heavy enough and fast enough and the ground shakes'],
    ['Q, tap', 'Sand wave: your sand surges out a long way at the cursor'],
    ['Q, hold and let go', 'Sand icicles form around you; let go to fire them'],
    ['E, hold', 'Freeze your whole body (up to 5 s). Press as a blow lands to parry it'],
    ['Space, hold', 'Slow time (a short slow is free). Tap just before a hit to parry'],
    ['X', 'Super, when its bar is full: your sand falls as shooting stars'],
    ['W A S D', 'Look around'],
    ['Esc', 'Pause'],
    ['M', 'Sound on or off'],
  ];
  function drawControls(t) {
    const W = hud.width, H = hud.height, p = R.scale;
    hx.fillStyle = 'rgba(6,4,10,0.55)'; hx.fillRect(0, 0, W, H);
    const rowH = 13 * p, y0 = Math.round((H - CONTROLS.length * rowH) / 2 / p) * p, xk = Math.round((W / 2 - 10 * p) / p) * p;
    CONTROLS.forEach(([k, d], i) => {
      const y = y0 + i * rowH;
      hx.globalAlpha = 1; F.draw(hx, k, xk, y, 'soft', p, 'right');
      hx.globalAlpha = 0.6; F.draw(hx, d, xk + 14 * p, y, 'soft', p);
    });
    hx.globalAlpha = 1;
  }

  // The lenses you carry, with what each does: opened from the pause menu.
  function drawLensBook(t) {
    const W = hud.width, H = hud.height, p = R.scale, d = purse();
    hx.fillStyle = 'rgba(6,4,10,0.5)'; hx.fillRect(0, 0, W, H);
    const list = heldList(d);
    const rowH = 16 * p, x0 = Math.round((W / 2 - 110 * p) / p) * p, y0 = Math.round((H - Math.max(1, list.length) * rowH) / 2 / p) * p;
    if (!list.length) { hx.globalAlpha = 0.6; F.draw(hx, 'You carry no lenses yet', W / 2, y0, 'soft', p, 'center'); hx.globalAlpha = 1; return; }
    list.forEach((h, k) => {
      const l = Object.assign({}, lensById[h.id], { q: h.q }), y = y0 + k * rowH;
      lensCard(l, x0, y - 4 * p, p, true, t);
      F.draw(hx, l.name, x0 + 20 * p, y - p, 'soft', p);
      hx.globalAlpha = 0.6; F.draw(hx, RARITY_NAME[l.rarity] + ', ' + qOf(h.q).name + '. ' + effectText(l, h.q), x0 + 100 * p, y - p, 'soft', p); hx.globalAlpha = 1;
    });
  }

  // Title scene detail: one thin trickle of sand from a ceiling crack onto a
  // small, settled pile. Drawn by hand, three flat sand tones.
  // The title's slow life: dust turning in the three window beams and a pair of moths at
  // each hanging lantern.
  // Everything slow; nothing asks to be looked at.
  function titleLife(t) {
    const out = [];
    [153, 380, 607].forEach((wx, w) => {
      for (let k = 0; k < 9; k++) {
        const seed = w * 17 + k * 7.3, per = 14 + (seed % 9);
        const u = ((t / per + seed * 0.13) % 1 + 1) % 1;                           // each mote's slow fall through the beam
        const y = 60 + u * 150, x = wx - 22 + ((seed * 11) % 44) + u * 18 + Math.sin(t * 0.4 + seed) * 3;   // the beam slants a little
        if (Math.sin(t * 0.7 + seed * 2.1) < -0.35) continue;                       // they drift in and out of the light
        out.push({ x: Math.round(x), y: Math.round(y), rows: ['b'] });
      }
    });
    for (const [lx, ly] of [[262, 119], [498, 119]]) for (let k = 0; k < 2; k++) {
      const ph = k * 2.7 + lx * 0.01, sp = 0.9 + k * 0.5;
      const x = lx + Math.cos(t * sp + ph) * (9 + k * 4) + Math.sin(t * 6.3 + ph * 3) * 1.4;
      const y = ly + Math.sin(t * sp * 1.37 + ph) * (5 + k * 2) + Math.cos(t * 5.1 + ph) * 1.1;
      out.push({ x: Math.round(x) - 1, y: Math.round(y), rows: [Math.floor(t * 14 + ph * 5) % 2 ? 'k.k' : '.k.'] });
    }
    return out;
  }
  function titleSand(time) {
    const x0 = 680, y0 = 18, w = 31, h = 205, rows = [];
    const tone = (x, y) => { const v = ((x * 73856093) ^ (y * 19349663)) >>> 0; const k = v % 7; return k < 4 ? 'a' : k < 6 ? 'b' : 'c'; };
    const pileTop = 212, cx = 695;
    for (let r = 0; r < h; r++) {
      let row = '';
      const y = y0 + r;
      for (let c = 0; c < w; c++) {
        const x = x0 + c, dx = Math.abs(x - cx);
        let ch = '.';
        // a settled pile, a little flatter than a cone, on the floor step
        if (y >= pileTop + Math.round(dx * 0.62 + (dx > 9 ? (dx - 9) * 0.6 : 0)) && y < 220) ch = tone(x, y);
        // the trickle: a broken one-pixel line, falling
        const sway = (time % 7.3) < 0.6 && y < pileTop - 40 ? Math.round(Math.sin((time % 7.3) * 10) * (pileTop - 40 - y) / 120) : 0;   // a draught bends the stream now and then
        if (x - cx === sway && y < pileTop && (y + Math.floor(time * 30)) % 5 !== 0) ch = 'd';
        if (dx === 1 && y > pileTop - 6 && y < pileTop && (y + Math.floor(time * 12)) % 7 === 0) ch = 'd';  // a little splash
        row += ch;
      }
      rows.push(row);
    }
    return { x: x0, y: y0, rows };
  }

  // ---------- title: Spill, Continue, New game (one save) ----------
  function titleItems() {
    if (window.SPILL_DEMO_TITLE) return window.SPILL_DEMO_TITLE;   // the browser demo replaces the menu (demo-site only)
    const has = !!readSlot(1);
    return has ? [{ label: 'Continue', act: () => loadSlot(1) }, { label: 'New game', act: newGame }]
      : [{ label: 'Begin', act: newGame }];
  }
  function loadSlot(n) {
    slot = n;
    const d = readSlot(n);
    run = d ? Object.assign({ level: 0, entry: null, best: {} }, d) : { level: 0, entry: null, best: {} };
    level = run.level;
    // after the prologue you are always somewhere in the Tower (or dreaming)
    if (run.prologueDone && !run.descent && !run.world) run.world = newWorld(600);
    screen = 'game';
    R.zoom = 1;
    saveRun();
    restart(true);
  }
  function newGame() {
    // starting over asks once if there is a journey to lose
    if (readSlot(1) && !(title.confirmT > 0)) { title.confirmT = 3; return; }
    try { localStorage.removeItem(slotKey(1)); } catch (e) { /* storage blocked */ }
    title.confirmT = 0;
    startOpening();
  }
  // ---- the opening cutscene ----
  const opening = { cut: null, typed: 0, skipT: 0, lastShot: -1, end: 0 };
  function startOpening() {
    // Cutscene disabled — it needs more polish before it ships.
    loadSlot(1);
  }
  function finishOpening() { opening.cut = null; fx.fade = 1; loadSlot(1); }
  function tickOpening() {
    const c = opening.cut; if (!c) return;
    if (opening.skipT > 0) { opening.skipT++; if (opening.skipT > 50) { finishOpening(); return; } }
    if (c.done) { if (++opening.end > 40) finishOpening(); return; }
    c.step();
    if (c.shot !== opening.lastShot) { opening.lastShot = c.shot; opening.typed = 0; }
    const line = c.cur.line, before = Math.floor(opening.typed);
    if (c.st > 30) opening.typed = Math.min(line.length, opening.typed + 0.55);
    const now = Math.floor(opening.typed);
    if (now > before && line[now - 1] && line[now - 1] !== ' ' && now % 2 === 0) A.voice(line[now - 1], line[now - 2] === ' ');
  }
  function drawOpening(t) {
    const c = opening.cut; if (!c) return;
    const W = hud.width, H = hud.height, p = R.scale;
    hx.fillStyle = '#000'; hx.fillRect(0, 0, W, H);
    // the picture, as large as fits between the bars, on whole-pixel steps
    const bar = Math.round(H * 0.13), k = Math.max(1, Math.floor(Math.min(W / 256, (H - bar * 2) / 144)));
    const pw = 256 * k, ph = 144 * k, x = Math.round((W - pw) / 2), y = Math.round((H - ph) / 2);
    hx.imageSmoothingEnabled = false;
    c.draw(hx, x, y, k);
    // the bars, with a ragged inner edge
    const st = Math.max(2, k);
    for (let bx = 0; bx < W; bx += st) {
      const j = ((Math.sin(bx * 12.9898) * 43758.5453) % 1 + 1) % 1;
      hx.fillStyle = '#000'; hx.fillRect(bx, 0, st, y + Math.round(j * st)); hx.fillRect(bx, y + ph - Math.round(j * st), st, H);
    }
    // the line, typed out in the lower bar
    const line = c.cur.line.slice(0, Math.floor(opening.typed));
    if (line) {
      const ts = Math.max(1, Math.round(p * 1.2));
      hx.globalAlpha = Math.min(1, (c.cur.dur - c.st) / 30);
      // wrapped to fit, centred in the lower bar
      const words = line.split(' '), rows = [''], maxW = W * 0.86;
      for (const w of words) { const tryRow = rows[rows.length - 1] ? rows[rows.length - 1] + ' ' + w : w; if (F.measure(tryRow, 'soft') * ts > maxW && rows[rows.length - 1]) rows.push(w); else rows[rows.length - 1] = tryRow; }
      const lh = (F.height('soft') + 3) * ts, y0 = y + ph + Math.round((H - y - ph - rows.length * lh) / 2);
      rows.forEach((r, i) => tintText(r, W / 2, y0 + i * lh, 'soft', ts, 'center', '#e8dcc4'));
      hx.globalAlpha = 1;
    }
    // the title at the end
    if (c.cur.id === 'wake' && c.st > 200) {
      hx.globalAlpha = Math.min(1, (c.st - 200) / 60) * (c.done ? Math.max(0, 1 - opening.end / 40) : 1);
      F.draw(hx, 'Spill', W / 2, y + Math.round(ph * 0.22), 'wide', p * 4, 'center');
      hx.globalAlpha = 1;
    }
    // hold to skip
    hx.globalAlpha = opening.skipT > 0 ? 0.9 : 0.35;
    tintText(opening.skipT > 0 ? 'skipping' : 'hold esc to skip', W - 8 * p, 6 * p, 'soft', p, 'right', '#c9b597');
    if (opening.skipT > 0) { hx.fillStyle = '#e9bb6c'; hx.fillRect(W - 8 * p - Math.round(60 * p * opening.skipT / 50), 16 * p, Math.round(60 * p * opening.skipT / 50), p); }
    hx.globalAlpha = 1;
  }
  function titleClick(x, y) {
    title.cards.forEach((c, i) => { if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) { title.sel = i; titleItems()[i].act(); } });
  }
  function drawTitle(t) {
    const W = hud.width, H = hud.height, p = R.scale;
    title.confirmT = Math.max(0, title.confirmT - 1 / 60);
    hx.fillStyle = 'rgba(6,4,10,0.12)'; hx.fillRect(0, 0, W, H);
    const cx = Math.round(W / 2 / p) * p, ty = Math.round(H * 0.14 / p) * p;
    F.draw(hx, 'Spill', cx, ty, 'wide', p * 4, 'center');
    const items = titleItems();
    if (title.sel >= items.length) title.sel = 0;
    const y0 = ty + 52 * p, rowH = 14 * p;
    const mxs = mouse.sx * dpr, mys = mouse.sy * dpr;
    title.cards = [];
    items.forEach((it, i) => {
      const y = y0 + i * rowH, w = 70 * p;
      const card = { x: cx - w / 2, y: y - 3 * p, w, h: rowH - 2 * p };
      if (mouse.inside && mxs >= card.x && mxs <= card.x + card.w && mys >= card.y && mys <= card.y + card.h) title.sel = i;
      hx.globalAlpha = title.sel === i ? 1 : 0.42;
      const label = it.label === 'New game' && title.confirmT > 0 ? 'Start over? Click again' : it.label;
      F.draw(hx, label, cx, y, 'soft', p, 'center');
      hx.globalAlpha = 1;
      title.cards.push(card);
    });
    // the Great Glass: everything you have ever banked, small and low
    if (run.banked || (readSlot(1) || {}).banked) {
      const banked = Math.max(run.banked || 0, (readSlot(1) || {}).banked || 0);
      const gy = H - 22 * p;
      hx.globalAlpha = 0.7;
      blit(GLASS, cx - 3 * p - Math.round(grains(banked).length * 2 * p) - 4 * p, gy, p, { '#': COL.frame, s: COL.sand });
      F.draw(hx, grains(banked), cx + 4 * p, gy + p, 'num', p, 'center');
      hx.globalAlpha = 1;
    }
  }

  // ---------- loop ----------
  resize();
  restart(true);
  let last = performance.now(), acc = 0;
  const DT = 1000 / 60;

  // The system cursor hides while the game draws its own mark (in play, over
  // the field); menus, the shrine, the map, results and the backpack show it.
  // Set only on change, so the browser (or a Steam wrapper) is not poked every frame.
  let cursorShown = null;
  function syncCursor() {
    const own = screen === 'game' && mouse.inside && !pause.on && !shrine.on && !fx.result && !bag.open && !!sim;
    const want = own ? 'none' : 'default';
    if (want !== cursorShown) { cursorShown = want; document.body.style.cursor = want; }
  }
  function frame(now) {
    if (dbg.freeze) { last = now; requestAnimationFrame(frame); return; }   // test hook: hold the picture still
    const dtR = Math.min(100, now - last);
    acc += dtR; last = now;
    // the world's clock: everything animated in the scene (flames, banners, water, dust) runs at
    // the slowed rate while time is slowed, so the slow is felt in the whole room
    fx.wT = (fx.wT == null ? now / 1000 : fx.wT) + dtR / 1000 * (1 - (1 - (sim && sim.spaceRate ? sim.spaceRate : 0.35)) * (fx.slowK || 0));
    const t = fx.wT;
    try { while (acc >= DT) { tick(t); acc -= DT; } } catch (e) { console.error('tick', e); acc = 0; }
    try { render(t); } catch (e) { console.error('render', e); }
    syncCursor();
    requestAnimationFrame(frame);
  }
  // one fixed step of the game (also driven directly by the test hook)
  function tick(t) {
    {
      if (mouse.inside) toWorld();
      if (dbg.drive) dbg.drive(sim, inp); // test hook: scripted input
      if (pause.on) { M.update(); return; }
      if (shrine.on) { shrine.t++; fx.fade *= 0.88; keeper.update(sim, DT / 1000); A.update(sim); M.update(); return; }
      if (screen === 'cutscene') { if (!opening.cut) { finishOpening(); return; } tickOpening(); A.update(sim); M.update(); return; }
      if (screen === 'title') {
        sim.events.length = 0; A.update(sim); M.update(); fx.fade *= 0.94;
        // still, like a wallpaper, framed close on the sleeping Keeper
        R.zoom = 1.75;
        const vc = R.viewCells;
        cam.x = 372 - vc.w / 2; cam.y = 168 - vc.h / 2;
        return;
      }
      if (screen === 'game' && sim.spaceTick) { sim.spaceTick(); fx.realF = (fx.realF || 0) + 1; if (sim.spaceBar) { const st = sim.spaceBar().state; if (fx.slowWasCool && st === 'ready') fx.slowReadyF = fx.realF; fx.slowWasCool = st === 'cool'; } slowStep(); }   // the time-slow's clock runs in real frames
      if (fx.hitstop > 0) { fx.hitstop--; if (fx.cut) { cutStep(); if (R.fx) R.fx.step(); } return; }   // impact frames: the world holds, and so does each impact's first drawing
      if (fx.dying) { dyingStep(); A.update(sim); M.update(); if (R.fx) R.fx.step(); return; }   // falling apart: the world waits a breath
      if (screen === 'game' && !fx.result) bossVoiceCue();
      if (fx.cut && fx.cut.hold) {                                                 // a boss cutscene: the world waits while it speaks
        cutStep(); eyeAnimStep(); bossVoiceStep(); bossPortalStep(); if (R.stepStreams) R.stepStreams(); A.update(sim); M.update(); updateCamera(); cutCamera();   // (the eye keeps living through the cut: it opens, looks, sprouts its wings)
        if (R.fx) R.fx.step(); for (const L of fx.lightFx || []) L.t++; cam.shake *= 0.9; fx.flash *= 0.85;
        return;
      }
      // the player acting ends the room's "before you act" window for story lines
      if (inp.pour || inp.charge || inp.harden || inp.blade || inp.strike || sim.spaceSlowNow) fx.acted = true;
      // a story line that was already up when the Sieve's fight began is cut, not left to talk through it
      if (keeper.line && !keeper.line.tutor && !fx.result && !shrine.on && currentLevel().boss) keeper.skip();
      // a story line from the Keeper holds the world still while he talks (tutor lessons never do:
      // they wait on the player, so holding for them would deadlock)
      if (!fx.result && keeper.holdsSim && screen === 'game') {
        keeper.update(sim, DT / 1000); A.update(sim); M.update(); updateCamera(); return;
      }
      // Time slow: Space slows the world a lot (your sand still answers you,
      // only slower). A short window is free; holding past it costs a grain
      // now and then. Charging a hammer in the air slows time too, free.
      // holding a charged attack (the hammer, or the shards) all but stops the world:
      // creatures and hazards hang still while your sand moves at full speed, so you can aim
      const holding = !!(sim.hammer || (sim.icicles && sim.icicles.groups.length && !sim.icicles.fire));
      sim.worldRate = holding && screen === 'game' ? 0.20 : 1;
      // the super: everything but your falling stars all but stops (one world tick in ~80),
      // then eases back to full speed over half a second so the world doesn't snap on
      if (sim.superNow) fx.superHold = 1; else if (fx.superHold > 0) fx.superHold = Math.max(0, fx.superHold - 1 / 30);
      if (fx.superHold > 0 && screen === 'game') sim.worldRate = Math.min(sim.worldRate, 0.012 + (1 - 0.012) * (1 - fx.superHold));
      fx.holdStop = holding;
      // a right-click in the air: time slows for a moment while the sand hangs, then both let go
      // (the hang is measured in sim frames, so it ends however long the button stays held)
      fx.airSlow = !!(inp.charge && sim.charging && sim.selCount > 0 && !sim.pressGrounded && (sim.chargeT || 0) < sim.airHang);
      fx.slow = (sim.spaceSlowNow || fx.airSlow) && screen === 'game';
      if (fx.slow) {
        fx.slowAcc = (fx.slowAcc || 0) + (sim.spaceSlowNow && sim.spaceRate ? sim.spaceRate : 0.35);   // Space's slow runs at the sim's rate; the air-aim slow keeps its own
        if (fx.slowAcc < 1) { updateCamera(); return; }
        fx.slowAcc -= 1;
      }
      if (!fx.result) {
        if (sim.superNow) { inp.pour = inp.charge = inp.blade = inp.strike = false; }    // the super plays out; you only watch
        inp.stick = inp.charge ? aimStick : null;                                 // the aim as a pull vector (the sim falls back to anchor minus cursor without it)
        if (!inp.charge && document.pointerLockElement) { try { document.exitPointerLock(); } catch (e2) { /* ignore */ } }
        sim.step(inp);
        if (fx.regather) regatherStep();                                        // counts only while the world runs
        run.super = sim.superCharge;
        if (inp.pour) tut.poured++;
        if (inWorld()) {
          if (sim.alive > 0) { fx.lastCx = sim.cx; fx.lastCy = sim.cy; }
          const k = sim.passed.findIndex((p) => p > 0 && (p >= Math.max(6, 0.35 * (sim.alive + p)) || sim.alive < 8));
          if (k >= 0 && (fx.leaveT = (fx.leaveT || 0) + 1) > LEAVE_GRACE) { leaveRoom(k); return; }     // held a moment so the grains just behind the head finish crossing
          const def = WORLD.rooms[run.world.room];
          if (def.shrine && sim.alive > 0) {
            // the checkpoint: a single grain touching the Keeper (anywhere on him) lights the
            // lantern he holds, and it stays lit: you have passed here, and you will wake here
            // (resting and the shop still ask your sand to reach up and touch the lantern itself)
            const kx0 = def.shrine.x - 4, ky0 = def.shrine.y - 17, lx = def.shrine.x + 5, ly = def.shrine.y - 3;
            const lit = run.world.keeperLit || (run.world.keeperLit = {});
            let body = 0, lamp = 0;
            for (let i = 0; i < sim.N; i++) {
              if (sim.state[i] !== 1) continue;
              if (sim.px[i] >= kx0 - 1 && sim.px[i] <= kx0 + 11 && sim.py[i] >= ky0 - 1 && sim.py[i] <= ky0 + 17) body++;
              if (Math.abs(sim.px[i] - lx) <= 2 && Math.abs(sim.py[i] - ly) <= 3) lamp++;
            }
            if (body && !lit[def.id]) { lit[def.id] = true; run.world.checkpoint = def.id; lampFlare(lx, ly); A.chime(0.8); saveRun(); }
            if (lamp >= 2 && !run.world.rested && sim.frame > 40) { run.world.rested = true; restAtShrine(); return; }
          }
          if (def.lamp && sim.alive > 0) {
            // a checkpoint lamp: touch it with your sand and it lights; you will wake here
            const L0 = def.lamp, lit = run.world.lamps && run.world.lamps[def.id];
            if (!lit) {
              let touch = 0;
              for (let i = 0; i < sim.N; i++) if (sim.state[i] === 1 && Math.abs(sim.px[i] - L0.x) <= 3 && sim.py[i] >= L0.y - 14 && sim.py[i] <= L0.y - 8) touch++;
              if (touch >= 2) { (run.world.lamps || (run.world.lamps = {}))[def.id] = true; run.world.checkpoint = def.id; saveRun(); lampFlare(L0.x, L0.y - 11); A.chime(0.8); }
            }
          }
        }
        if (sim.failed()) { startDying(); return; }
        else if (sim.done() && bossExitOpen()) {
          const L = currentLevel(), prev = run.best[L.id] || 0;
          run.passedOnce = true; saveRun();
          // the hourglasses are discoveries, not grains: passing, waking every
          // sleeper, and finding the chamber's hidden memory
          const found = [true, !sim.hadStill || sim.stillLeft === 0, !sim.memory || sim.memory.found];
          const savedNow = L.boss ? sim.alive : sim.exited;
          fx.result = { saved: savedNow, total: sim.total, found, newBest: savedNow > prev, prev };
          if (sim.exited > prev) { run.best[L.id] = sim.exited; saveRun(); }
          M.cue('turned_glass');
        }
      } else fx.resultT++;
      handleEvents(t);
      sieveFinalForm(); bossPortalStep(); sieveAnimStep(); interactiveStep(sim.frame / 60);
      const keeperWasVisible = !!keeper.line;
      courseTick();
      keeper.update(sim, DT / 1000);
      if (!keeperWasVisible && keeper.line && !fx.keeperCue) { M.cue('keeper_appears'); fx.keeperCue = true; }
      updateHold(DT / 1000);
      A.update(sim);
      M.update();
      updateCamera(); if (fx.cut) { cutStep(); cutCamera(); } bossVoiceStep();
      for (const L of fx.lightFx || []) L.t++; if (fx.lightFx) fx.lightFx = fx.lightFx.filter((L) => L.t < L.life);
      if (R.fx) { R.fx.comboN = fx.combo ? Math.max(0, Math.min(3, fx.combo.n - 1)) : 0; R.fx.step(); energyTrails(); if (FA) FA.step(sim); }
      if (R.stepStreams) R.stepStreams();
      for (const a of fx.anims) a.t++; fx.anims = fx.anims.filter((a) => window.SpillImpacts.frameOf(a.name, a.t, a.flip));
      for (const pp of fx.pops) pp.t++; fx.pops = fx.pops.filter((pp) => pp.t < 70);
      for (const [f, v] of fx.whiteT) { if (v <= 1) fx.whiteT.delete(f); else fx.whiteT.set(f, v - 1); }
      if (fx.eyeWhite > 0) fx.eyeWhite--;
      fx.tollT = (fx.tollT || 0) + 1;
      if (fx.tollT === 40 && sim.toll) A.exitChime(60);
      fx.exitPulse *= 0.94; fx.flash *= 0.85; fx.fade *= 0.88; fx.introT++;
      fx.progShown += (Math.min(1, sim.exited / sim.par[0]) - fx.progShown) * 0.06;
      cam.shake *= 0.85;
    }
  }
  function render(t) {
    const sh = cam.shake;
    const view = { x: cam.x + (Math.random() - 0.5) * sh, y: cam.y + (Math.random() - 0.5) * sh };
    if (FF) { FF.frame(t); view.x += FF.kx; view.y += FF.ky; }   // the camera knocked along each blow, springing back
    const hoverPortal = screen === 'game' && sim.enough && sim.exitAt && mouse.inside && Math.hypot(inp.x - sim.exitAt.x, inp.y - sim.exitAt.y) < 26;
    // your sand carries a faint warm light of its own: it is never lost in shadow
    const glow = screen === 'game' && fx.bodyX != null && sim.alive > 0;
    const portalLight = bossPortalLight(); if (portalLight) sim.lights.push(portalLight);
    const iaLights = IA && IA.sim === sim && screen === 'game' ? IA.lights(t).concat(window.SpillHallArt ? window.SpillHallArt.lights() : []) : []; for (const Lx of iaLights) sim.lights.push(Lx);   // braziers, and the high windows' moonlight
    if (glow) { const fr = sim.frozen ? 0.45 : 1; sim.lights.push({ x: fx.bodyX, y: fx.bodyY - 4, r: 0.95 * fr, g: 0.76 * fr, b: 0.46 + (0.6 - 0.46) * (1 - fr), radius: 64 + Math.min(40, Math.sqrt(sim.alive) * 1.4), flicker: 0 }); }   // frozen sand loses its warmth: the light goes low and cool
    const flashes = (fx.lightFx || []).filter((L) => L.t < L.life).slice(-2);   // calm lighting: at most the two newest flashes light the room (a volley must not white it out)
    for (const L of flashes) { const k = (1 - L.t / L.life) * 0.5; sim.lights.push({ x: L.x, y: L.y, r: (L.warm ? 1.6 : 1.0) * k * 2, g: (L.warm ? 1.2 : 1.3) * k * 2, b: (L.warm ? 0.7 : 1.7) * k * 2, radius: L.rad, flicker: 0 }); }
    const hidden = regatherMask();
    const hotEyes = sim.boss && sim.boss.half && sim.eyeLights ? sim.eyeLights.map((Lm) => [Lm.r, Lm.g, Lm.b]) : null;
    if (hotEyes) sim.eyeLights.forEach((Lm) => { const v = Math.max(Lm.r, Lm.g, Lm.b) * (0.9 + 0.1 * Math.sin(t * 2.3)); Lm.r = v * 1.15; Lm.g = v * 0.38; Lm.b = v * 0.2; });   // final form: the lamps burn red
    const cine = FF && screen === 'game' ? FF.cine() : null;
    if (cine && fx.superTen > 0) cine.tension = Math.max(cine.tension || 0, fx.superTen);                // the super drains the colour
    if (cine && fx.slowK > 0) cine.tension = Math.max(cine.tension || 0, 0.45 * fx.slowK);              // time slowed: the world drains a little
    R.draw(sim, view, t, { deco: !!(screen === 'game' && currentLevel().boss), frost: FA ? FA.frost(sim) : null, cine, exitPulse: fx.exitPulse, flash: fx.flash, fade: Math.max(fx.fade, fx.superDim || 0), enough: sim.enough, progress: fx.progShown, hover: hoverPortal, sprites: propSprites(t).concat(ambientSprites(t), mechSprites(t), bossSprites(t), foeSprites(t), meleeSprites(t), animSprites(), FA ? FA.sprites() : [], deathSprites(), slowSprites(), bossPortalSprites(t), bossHallSprites(t), machineSprites(t), sieveRimSprites(t), screen === 'title' ? [titleSand(t)].concat(titleLife(t)) : []) });
    if (hotEyes) sim.eyeLights.forEach((Lm, i) => { [Lm.r, Lm.g, Lm.b] = hotEyes[i]; });
    if (hidden) for (const [i, st] of hidden) sim.state[i] = st;
    for (let k = 0; k < flashes.length; k++) sim.lights.pop();
    if (glow) sim.lights.pop();
    if (portalLight) sim.lights.pop();
    for (let k = 0; k < iaLights.length; k++) sim.lights.pop();
    if (screen === 'game' && shrine.on) { hx.clearRect(0, 0, hud.width, hud.height); drawShrine(t); keeper.mouse = { x: mouse.sx * dpr, y: mouse.sy * dpr }; keeper.draw(hx, hud.width, hud.height, R.scale, t); }
    else if (screen === 'game' && !pause.on) { if ((fx.letter || 0) < 0.3) drawHud(t); else hx.clearRect(0, 0, hud.width, hud.height); drawCut(t); keeper.mouse = { x: mouse.sx * dpr, y: mouse.sy * dpr }; keeper.draw(hx, hud.width, hud.height, R.scale, t); drawCursor(t); } else hx.clearRect(0, 0, hud.width, hud.height);
    // the pause menu blurs the game; the title only softens its wallpaper a little
    const veil = pause.on || shrine.on ? 'blur(4px) brightness(0.85)' : screen === 'title' ? 'blur(1.5px) brightness(1.05)' : 'none';
    if (glCanvas.style.filter !== veil) glCanvas.style.filter = veil;
    if (pause.on) { if (pause.book) drawLensBook(t); else if (pause.controls) drawControls(t); else drawPause(t); }
    if (screen === 'title') drawTitle(t);
    if (screen === 'cutscene') drawOpening(t);
    drawBag(t);
    drawDev();
    if (sim.superNow && screen === 'game') { hx.fillStyle = 'rgba(8,6,16,0.28)'; hx.fillRect(0, 0, hud.width, hud.height); }   // the world dims while the stars fall
    if (fx.holdStop && screen === 'game' && !pause.on) {
      // the world held still: it dims and cools, and a thin band closes in at top and bottom
      hx.fillStyle = 'rgba(18,14,36,0.30)'; hx.fillRect(0, 0, hud.width, hud.height);
      const bh = Math.round(hud.height * 0.022);
      // ragged inner edge, never a ruled line
      const st = Math.max(3, Math.round(hud.width / 160));
      for (let x = 0; x < hud.width; x += st) {
        const j = ((Math.sin(x * 12.9898) * 43758.5453) % 1 + 1) % 1, j2 = ((Math.sin(x * 78.233) * 12543.21) % 1 + 1) % 1;
        hx.fillStyle = 'rgba(6,5,10,0.88)'; hx.fillRect(x, 0, st, bh + Math.round(j * st * 1.5)); hx.fillRect(x, hud.height - bh - Math.round(j2 * st * 1.5), st, bh + st * 2);
        hx.fillStyle = 'rgba(40,30,62,0.5)'; hx.fillRect(x, bh + Math.round(j * st * 1.5), st, Math.max(1, st >> 1)); hx.fillRect(x, hud.height - bh - Math.round(j2 * st * 1.5) - Math.max(1, st >> 1), st, Math.max(1, st >> 1));
      }
    }
  }
  requestAnimationFrame(frame);
  // test hook (live getter: Object.assign would have copied a stale value)
  Object.defineProperty(dbg, 'sim', { get: () => sim, configurable: true });
  Object.defineProperty(dbg, 'IA', { get: () => IA, configurable: true });
  Object.defineProperty(dbg, 'FF', { get: () => FF, configurable: true });   // the fight camera and lens (tests read its waves)   // the hall's interactive layer (tests read its state)
  dbg.step = (n) => { const t = performance.now() / 1000; for (let k = 0; k < (n || 1); k++) tick(t + k / 60); render(t + n / 60); };
  Object.assign(dbg, { fx, LENSES, inp, cam, R, restart, mouse, keeper, shrine, advance, failRoom, openShrine, newDescent, setScreen: (v) => { screen = v; } });
  Object.defineProperty(dbg, 'screen', { get: () => screen, configurable: true });
  dbg.opening = opening; dbg.startOpening = () => startOpening();
  dbg.bag = bag;
  // ---------- dev console: jump anywhere without playing there ----------
  // Backtick (`) opens a command line at the bottom of the screen. The same commands run
  // from the browser console as spill.go('shaft'), spill.cmd('sand 900'), and so on.
  const dev = { open: false, text: '', msg: '', msgT: 0, hist: [], hi: -1 };
  const DEV_HELP = 'room <id> | dummy | boss | lid [1-3] | halfhp | killboss | world <id> | title | shop | sand <n> | super | starhit calm|strong | lenses | rooms | help';
  function devGoRoom(id) {
    if (!roomById[id]) return 'no room "' + id + '" (rooms: ' + Object.keys(roomById).join(', ') + ')';
    run.descent = newDescent(Math.max(600, (purse() || {}).carried || 0));
    run.descent.floors[0][0] = [id, false];
    shrine.on = false; pause.on = false; screen = 'game'; restart(true);
    return 'room ' + id;
  }
  function devGoWorld(id) {
    const W0 = WORLD.rooms;
    if (!W0[id]) return 'no world room "' + id + '" (world: ' + Object.keys(W0).join(', ') + ')';
    run.descent = null;
    if (!run.world) run.world = newWorld(600);
    const w = run.world; w.room = id; w.from = null; w.atShrine = !!W0[id].shrine; w.rested = true;
    shrine.on = false; pause.on = false; screen = 'game'; restart(true);
    return 'world ' + id;
  }
  function devRun(line) {
    const [c, ...args] = line.trim().split(/\s+/), a = args.join(' ');
    switch ((c || '').toLowerCase()) {
      case 'room': case 'go': return devGoRoom(a);
      case 'dummy': {
        const result = devGoRoom('grate');
        if (result !== 'room grate') return result;
        const d = window.SpillFoes.make({ kind: 'dummy', x: 100, y: 70 }, sim.W, false);
        sim.foes.push(d);
        return 'dummy room';
      }
      case 'boss': case 'sieve': run.descent = newDescent(900); run.descent.floor = FLOORS; shrine.on = false; pause.on = false; screen = 'game'; restart(true); return 'the Sieve';
      case 'lid': {
        // the shut-eye teeth moment, on demand: the Sieve at its angry phase with eye 1 open and unwounded; it shuts in ~2 s
        if (!sim || !sim.boss) devRun('boss');
        const B = sim && sim.boss; if (!B) return 'no boss here';
        B.hp = Math.min(B.hp, Math.round(B.hp * 0.7)); B.phase = Math.max(B.phase, 1);
        B.lids = []; B.bites = []; B.stones = []; B.sweep = null; B.stoneT = 99999; B.biteT = 99999; B.sweepT = 99999;
        B.open = Math.max(0, Math.min(2, parseInt(a, 10) - 1 || 0)); B.hitsThisOpen = 0; B.openT = 120; B.guardBroken = false;
        return 'eye ' + (B.open + 1) + ' is open: do not hit it. It shuts in 2s: amber flare 1s, teeth 1.2s, then gone. Run lid again to repeat';
      }
      case 'halfhp': {
        // the Sieve just under half health; the next real step triggers its half-life roar as usual
        if (!sim || !sim.boss) devRun('boss');
        const B = sim && sim.boss; if (!B) return 'no boss here';
        B.hp = Math.min(B.hp, 13); B.hitsThisOpen = 0;
        return 'Sieve at 13 hp, under half; its half-life comes on the next blow';
      }
      case 'killboss': {
        // the Sieve down: clears its hazards and plays its defeat, like a real last blow
        if (!sim || !sim.boss) devRun('boss');
        const B = sim && sim.boss; if (!B) return 'no boss here';
        B.hp = 0; B.bites = []; B.stones = []; B.sweep = null; B.fx = []; B.lids = [];
        sim.events.push({ type: 'bossDown' });
        return 'the Sieve is down';
      }
      case 'world': case 'tower': return devGoWorld(a || 'hub');
      case 'title': screen = 'title'; restart(true); return 'title';
      case 'shop': if (screen !== 'game' || !purse()) return 'go to a room first'; openShrine(); return 'shop';
      case 'sand': { const n = Math.max(0, parseInt(a, 10) || 0), d = purse(); if (!d) return 'go to a room first'; d.carried = n; restart(true); return 'sand ' + n; }
      case 'super': run.super = 1; if (sim) sim.superCharge = 1; return 'super charged (press X)';
      case 'starhit': fx.starHitStyle = a === 'strong' ? 'strong' : 'calm'; return 'super hits on the eye: ' + fx.starHitStyle;
      case 'lenses': { const d = purse(); if (!d) return 'go to a room first'; d.lenses = LENSES.slice(0, MAX_LENSES).map((l) => ({ id: l.id, q: 1, life: 6 })); restart(true); return MAX_LENSES + ' lenses'; }
      case 'rooms': return 'rooms: ' + Object.keys(roomById).join(', ') + ' | world: ' + Object.keys(WORLD.rooms).join(', ');
      case 'help': case '?': case '': return DEV_HELP;
      default: return 'unknown: ' + c + '  (' + DEV_HELP + ')';
    }
  }
  function devSay(m) { dev.msg = m; dev.msgT = 6; return m; }
  function devKey(e) {
    if (e.code === 'Backquote') { e.preventDefault(); dev.open = !dev.open; dev.text = ''; dev.hi = -1; if (dev.open) devSay(DEV_HELP); return true; }
    if (!dev.open) return false;
    e.preventDefault();
    if (e.key === 'Escape') dev.open = false;
    else if (e.key === 'Enter') { if (dev.text.trim()) { dev.hist.unshift(dev.text); devSay(devRun(dev.text)); } else devSay(DEV_HELP); dev.text = ''; dev.hi = -1; }
    else if (e.key === 'Backspace') dev.text = dev.text.slice(0, -1);
    else if (e.key === 'ArrowUp') { dev.hi = Math.min(dev.hist.length - 1, dev.hi + 1); dev.text = dev.hist[dev.hi] || ''; }
    else if (e.key === 'ArrowDown') { dev.hi = Math.max(-1, dev.hi - 1); dev.text = dev.hi >= 0 ? dev.hist[dev.hi] : ''; }
    else if (e.key.length === 1 && dev.text.length < 60) dev.text += e.key;
    return true;
  }
  function drawDev() {
    dev.msgT = Math.max(0, dev.msgT - 1 / 60);
    if (!dev.open && dev.msgT <= 0) return;
    const p = R.scale, x = 8 * p, H = hud.height;
    if (dev.open) {
      const y = H - 18 * p;
      hx.fillStyle = 'rgba(6,4,10,0.85)'; hx.fillRect(0, y - 3 * p, hud.width, 15 * p);
      tintText('> ' + dev.text + (Math.floor(performance.now() / 400) % 2 ? '_' : ''), x, y, 'soft', p, 'left', '#ffe2a0');
    }
    if (dev.msgT > 0 && dev.msg) {
      const y = H - (dev.open ? 32 : 18) * p;
      hx.globalAlpha = Math.min(1, dev.msgT);
      hx.fillStyle = 'rgba(6,4,10,0.7)'; hx.fillRect(0, y - 3 * p, hud.width, 14 * p);
      tintText(dev.msg, x, y, 'soft', p, 'left', '#c9b89a');
      hx.globalAlpha = 1;
    }
  }
  window.spill = { cmd: (line) => devRun(line), go: (id) => (WORLD.rooms[id] && !roomById[id] ? devGoWorld(id) : devGoRoom(id)), boss: () => devRun('boss'), help: () => DEV_HELP };
  Object.defineProperty(dbg, 'run', { get: () => run, set: (v) => { run = v; }, configurable: true });
})();
