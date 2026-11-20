// SPILL runes (shown in game as lenses): the run modifiers the Keeper sells
// between floors. Pure data and rules, no DOM, so the odds and the stacking
// caps are checked headless (test/runes.js) as well as used by game.js.
//
// Five tiers. Rarity is strength: a common nudges one move, a legendary is
// worth a hand of commons in one slot. Nothing replaces a base move: every
// rune scales a move you still have to use (pour, throw/slam, freeze, F tap
// or hammer, Q bolt, parry), and the caps below hold however you stack them.
(function (root) {
  'use strict';

  // cost: the least it sells for; share: the part of your purse it asks for;
  // one: only one rune of this tier fits a run
  const TIERS = {
    common:    { name: 'Common',    cost: 35,  share: 0.12, col: '#d9cbb3', pips: 1 },
    uncommon:  { name: 'Uncommon',  cost: 55,  share: 0.16, col: '#9fd18b', pips: 2 },
    rare:      { name: 'Rare',      cost: 80,  share: 0.2,  col: '#8fc3e0', pips: 3 },
    epic:      { name: 'Epic',      cost: 150, share: 0.32, col: '#c59cf0', pips: 4, one: true },
    legendary: { name: 'Legendary', cost: 220, share: 0.42, col: '#f2cf7c', pips: 5, one: true },
  };
  const ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

  // art: which portrait in lensart.js (defaults to the id)
  const RUNES = [
    // ---- common: one move, a little ----
    { id: 'wide', rarity: 'common', name: 'Wide Will', desc: 'Your pull reaches further', mods: { reach: 1.3 } },
    { id: 'breath', rarity: 'common', name: 'Long Breath', desc: 'Your throws fly further', mods: { sling: 1.15 } },
    { id: 'damp', rarity: 'common', name: 'Damp Grain', desc: 'You climb faster', mods: { climb: 1.3 } },
    { id: 'quick', rarity: 'common', name: 'Quick Hands', desc: 'Your bursts rest for less time', mods: { fRest: 0.7 } },
    { id: 'steady', rarity: 'common', name: 'Steady Bolt', desc: 'Your bolt wobbles less and flies further', mods: { qSteady: true } },
    { id: 'keen', rarity: 'common', name: 'Keen Grit', desc: 'Your bursts cut a little deeper', mods: { dmgF: 1.15 } },
    { id: 'cold', rarity: 'common', name: 'Cold Patience', desc: 'Your freeze holds half a second longer', art: 'wet', mods: { freezeFree: 0.5 } },
    { id: 'still', rarity: 'common', name: 'Still Pulse', desc: 'A parry forgives a late tap', art: 'feather', mods: { parryWin: 3 } },
    // ---- uncommon: one move, clearly, or a small rule ----
    { id: 'pull', rarity: 'uncommon', name: 'Gravity of Others', desc: 'Still sand joins you from much further away', mods: { absorb: 4 } },
    { id: 'glass', rarity: 'uncommon', name: 'Glass Memory', desc: 'Grains lost to spikes leave glass to stand on', mods: { spikeGlass: true } },
    { id: 'debt', rarity: 'uncommon', name: 'Hourglass Debt', desc: '+150 now and every floor, but grains slip away', cost: 0, mods: { debt: 1 } },
    { id: 'frost', rarity: 'uncommon', name: 'Thin Frost', desc: 'Freeze needs a shorter breath between holds', mods: { freezeCost: 0.75 } },
    { id: 'lead', rarity: 'uncommon', name: 'Lead Heart', desc: 'Your slams land harder', art: 'stone', mods: { dmgSlam: 1.25 } },
    // ---- rare: a move changes shape ----
    { id: 'wind', rarity: 'rare', name: 'Second Wind', desc: 'One more throw before you must land', mods: { airThrows: 1 } },
    { id: 'anvil', rarity: 'rare', name: 'Anvil Heart', desc: 'Your hammer is ready a third sooner', mods: { hammerCool: 0.65 } },
    { id: 'crown', rarity: 'rare', name: 'Splinter Crown', desc: 'One more shard forms when you hold Q', mods: { shards: 1 } },
    { id: 'needle', rarity: 'rare', name: 'Long Needle', desc: 'Your bolts and shards strike harder', mods: { dmgQ: 1.25 } },
    { id: 'fall', rarity: 'rare', name: 'Falling Weight', desc: 'Slower throws still slam, and hit harder', mods: { slamV: 0.9, dmgSlam: 1.1 } },
    // ---- epic: bends a rule (one per run) ----
    { id: 'undertow', rarity: 'epic', name: 'Undertow', desc: 'Half the grains taken by spikes fall back in', mods: { undertow: true } },
    { id: 'starborn', rarity: 'epic', name: 'Starborn', desc: 'Your falling stars charge twice as fast', mods: { superRate: 2 } },
    { id: 'hungry', rarity: 'epic', name: 'Hungry Sand', desc: 'Every creature you break gives back 6 grains', mods: { killGrains: 6 } },
    { id: 'vow', rarity: 'epic', name: 'Winter Vow', desc: 'Your freeze holds longer and needs less breath', mods: { freezeFree: 0.75, freezeCost: 0.8 } },
    // ---- legendary: a whole hand in one slot (one per run) ----
    { id: 'heart', rarity: 'legendary', name: 'Heart of the Glass', desc: 'Everything you do is a little stronger', art: 'eternal',
      mods: { dmgF: 1.25, dmgHammer: 1.25, dmgQ: 1.25, dmgSlam: 1.25, fRest: 0.8, reach: 1.15, sling: 1.08, freezeCost: 0.85, freezeFree: 0.3, parryWin: 2 } },
    { id: 'tide', rarity: 'legendary', name: 'Tidebreaker', desc: 'You are the wave: slams come easy and land like a hammer',
      mods: { dmgSlam: 1.3, slamV: 0.9, airThrows: 1, sling: 1.12, hammerCool: 0.8 } },
    { id: 'winter', rarity: 'legendary', name: 'Last Winter', desc: 'Your freeze holds long and comes back fast, and a parry comes easy',
      mods: { freezeFree: 1, freezeCost: 0.75, parryWin: 4, dmgHammer: 1.2 } },
  ];

  // However you stack them, a move gets this much better and no more. A
  // legendary alone sits near these; a stack of commons can reach them but
  // spends five or six slots doing it.
  const CAPS = {
    reach: [1, 1.6], sling: [1, 1.3], climb: [1, 1.6], fRest: [0.7, 1], hammerCool: [0.6, 1],
    dmgF: [1, 1.3], dmgHammer: [1, 1.4], dmgQ: [1, 1.4], dmgSlam: [1, 1.5], freezeCost: [0.75, 1], slamV: [0.88, 1],
    freezeFree: [0, 1], parryWin: [0, 6], airThrows: [0, 2], shards: [0, 2], superRate: [1, 2], killGrains: [0, 8],
  };
  const ADD = new Set(['airThrows', 'shards', 'killGrains', 'brittle', 'freezeFree', 'parryWin']);
  // the mods of every rune you carry, as one set for the sim
  function combine(list) {
    const m = {};
    for (const mods of list) for (const k in mods) {
      const v = mods[k];
      if (typeof v !== 'number') m[k] = v;
      else if (ADD.has(k)) m[k] = (m[k] || 0) + v;
      else if (k === 'debt') m[k] = 1;
      else m[k] = (m[k] || 1) * v;
    }
    for (const k in CAPS) if (typeof m[k] === 'number') m[k] = Math.max(CAPS[k][0], Math.min(CAPS[k][1], m[k]));
    return m;
  }

  // The odds of one card's tier. `luck` is what the save remembers: shrines
  // visited in all, and shrines since a legendary was last on offer. The
  // better tiers grow slowly with shrines visited (the long journey), and a
  // dry spell past PITY shrines makes a legendary steadily likelier, so one
  // always turns up, but never early.
  const PITY = 72, PITY_STEP = 0.006;
  function odds(luck, floor) {
    const s = (luck && luck.shrines) || 0, dry = (luck && luck.dry) || 0;
    const deep = 1 + 0.12 * Math.max(0, Math.min(3, floor || 1) - 1);       // the deeper floor's shrine is a little kinder
    let leg = Math.min(0.005, 0.0011 + 0.000014 * s) + Math.max(0, dry - PITY) * PITY_STEP;
    const epic = Math.min(0.04, 0.009 + 0.0001 * s) * deep;
    const rare = Math.min(0.18, 0.08 + 0.0006 * s) * deep;
    const unc = 0.26;
    leg = Math.min(0.5, leg);
    return { legendary: leg, epic, rare, uncommon: unc, common: Math.max(0, 1 - leg - epic - rare - unc) };
  }
  function pickTier(rand, o) {
    let r = rand();
    for (const t of ['legendary', 'epic', 'rare', 'uncommon']) { if (r < o[t]) return t; r -= o[t]; }
    return 'common';
  }
  // one card: a tier by the odds, then a rune of it that `ok` allows; if none,
  // the next tier down (and failing that, any allowed rune)
  function rollRune(rand, luck, floor, ok) {
    const want = pickTier(rand, odds(luck, floor));
    for (let t = ORDER.indexOf(want); t >= 0; t--) {
      const pool = RUNES.filter((r) => r.rarity === ORDER[t] && ok(r));
      if (pool.length) return pool[Math.floor(rand() * pool.length)];
    }
    const any = RUNES.filter(ok);
    return any.length ? any[Math.floor(rand() * any.length)] : null;
  }
  // after a shrine's cards are dealt: count the visit, and end a dry spell
  function markShrine(luck, offers) {
    luck.shrines = (luck.shrines || 0) + 1;
    luck.dry = offers.some((r) => r && r.rarity === 'legendary') ? 0 : (luck.dry || 0) + 1;
    return luck;
  }

  // the exact numbers, for the info views
  function describe(m) {
    const parts = [];
    const pct = (v) => (v >= 1 ? '+' : '') + Math.round((v - 1) * 100) + '%';
    if (m.dmgF && m.dmgF === m.dmgHammer && m.dmgF === m.dmgQ && m.dmgF === m.dmgSlam) parts.push('all damage ' + pct(m.dmgF));
    else {
      if (m.dmgF) parts.push('burst damage ' + pct(m.dmgF));
      if (m.dmgHammer) parts.push('hammer damage ' + pct(m.dmgHammer));
      if (m.dmgQ) parts.push('bolt damage ' + pct(m.dmgQ));
      if (m.dmgSlam) parts.push('slam damage ' + pct(m.dmgSlam));
    }
    if (m.slamV) parts.push('slams from ' + pct(m.slamV) + ' slower throws');
    if (m.reach) parts.push('pull reach ' + pct(m.reach));
    if (m.sling) parts.push('throw power ' + pct(m.sling));
    if (m.climb) parts.push('climb speed ' + pct(m.climb));
    if (m.fRest) parts.push('burst rest ' + pct(m.fRest));
    if (m.qSteady) parts.push('bolt wobble -60%, range +25%');
    if (m.airThrows) parts.push('+' + m.airThrows + ' air throw');
    if (m.hammerCool) parts.push('hammer cooldown ' + pct(m.hammerCool));
    if (m.shards) parts.push('+' + m.shards + ' shard');
    if (m.absorb) parts.push('wakes still sand 4 cells away');
    if (m.spikeGlass) parts.push('spike deaths leave glass');
    if (m.undertow) parts.push('half of spike deaths return');
    if (m.superRate) parts.push('star charge x' + m.superRate);
    if (m.killGrains) parts.push('+' + m.killGrains + ' grains per creature');
    if (m.debt) parts.push('+150 a floor, 1 grain lost every 3s');
    if (m.freezeFree) parts.push('freeze hold +' + m.freezeFree + 's');
    if (m.freezeCost) parts.push('freeze cooldown ' + pct(m.freezeCost));
    if (m.parryWin) parts.push('parry window +' + Math.round(m.parryWin * 1000 / 60) + 'ms');
    return parts;
  }

  const api = { TIERS, ORDER, RUNES, CAPS, combine, odds, pickTier, rollRune, markShrine, describe, PITY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillRunes = api;
})(typeof window !== 'undefined' ? window : globalThis);
