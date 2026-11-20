// SPILL: the Sieve's hall, dressed as castle architecture (art pass).
// The room's terrain is plain boxes; this gives each one a role in a castle without changing what is
// solid. Details are carved ONTO the existing stone (sprites with `top`: grooves, bands, straps, a
// few lit edges, most of the stone left showing), and the only things drawn in open air are thin
// trims that hang off stone (corbels, tassels, a capital's lip) or sit flat on the back wall
// (windows, a string course). Nothing here looks like a surface you could stand on and is not.
//   the high left ledge  -> a gallery: a brass-capped cornice on its face, carved corbels under it
//   the left pillar      -> a column: a capital with a lip, fluting, a moulded base
//   the hanging slab     -> an iron-bound slab: straps and rivets, brass shackles at the chains, tassels
//   the right block      -> an altar dais: a cornice, three blind arches carved in its face
//   the back wall        -> tall lancet windows high up (cold moonlight: the room's top was black), a
//                           stone string course, and three fire grates sunk in the floor (the source
//                           of the floor's low lights)
(function (root) {
  'use strict';

  // ---------- pieces, each drawn by hand ----------
  // a lancet window: pointed head, stone frame (2) with a dark outer edge (1), leaded diamond panes
  // (l pane, o lit pane, 1 lead), a stone sill (3 is the lit lip). 11 wide.
  function lancet(h) {
    const rows = [
      '....111....',
      '...12221...',
      '..122l221..',
      '.122lol221.',
      '.12lo1ol21.',
      '12lo1l1ol21',
    ];
    for (let y = 0; y < h - 9; y++) rows.push(y % 4 === 0 ? '12lo1l1ol21' : y % 4 === 1 ? '12o1lol1o21' : y % 4 === 2 ? '121lo1ol121' : '12o1lol1o21');
    rows.push('12222222221', '13333333331', '11111111111');
    return rows;
  }
  const CORBEL = ['1222221', '.12221.', '..121..', '...1...'];          // a stepped stone corbel under the gallery
  const SHACKLE = ['3.3', '434', '.3.'];
  const TASSEL = ['3', '3', '4', '6', '.'];
  const GRATE = ['1313131', '1767671', '.11111.'];                       // a fire grate sunk in the floor, embers glowing through
  const ARCH = [                                                         // a blind arch carved in the altar's face, 11 wide
    '...11111...',
    '..1.....1..',
    '.1.......1.',
    '.1.......1.',
    '.1.......1.',
    '.1.......1.',
    '.1.......1.',
    '.1.......1.',
    '.1.......1.',
    '13333333331',
  ];

  // the shapes of the room's stone (from boss.js build): kept here as data, read only
  const HALL = {
    ledge: { x: 16, y: 80, w: 104, h: 10 },
    pillar: { x: 150, y: 190, w: 30, h: 60 },
    slab: { x: 222, y: 196, w: 40, h: 10, chains: [226, 257] },
    altar: { x: 360, y: 222, w: 50, h: 28 },
    floorY: 250,
    grates: [212, 330, 440],
    windows: [{ x: 68, y: 22, h: 42 }, { x: 370, y: 22, h: 50 }, { x: 406, y: 22, h: 50 }],   // (clear of the lantern's chain at x 436)
    course: [[120, 140], [340, 464]],                                  // the string course runs only where the grate is not
  };

  function sprites(t) {
    const H = HALL, out = [], top = (x, y, rows) => out.push({ x, y, rows, top: true }), air = (x, y, rows) => out.push({ x, y, rows });
    // the back wall: windows and the string course (drawn only on open cells: behind everything)
    for (const W0 of H.windows) air(W0.x - 5, W0.y, lancet(W0.h));
    for (const [x0, x1] of H.course) { air(x0, 76, ['3'.repeat(x1 - x0)]); air(x0, 77, ['1'.repeat(x1 - x0)]); }

    // the gallery: a cornice along its face (a lit brass lip, a dark groove under it), corbels beneath
    const L0 = H.ledge;
    top(L0.x, L0.y + 1, [[...Array(L0.w)].map((_, i) => (i % 8 === 3 ? '4' : '3')).join('')]);
    top(L0.x, L0.y + 2, ['1'.repeat(L0.w)]);
    top(L0.x, L0.y + L0.h - 1, ['2'.repeat(L0.w)]);
    for (const cx of [62, 86, 110]) air(cx - 3, L0.y + L0.h, CORBEL);
    top(L0.x + L0.w - 2, L0.y + 3, ['1', '2', '1', '2', '1']);           // the gallery's end: a quoin line

    // the column: capital (a lip a pixel proud each side), fluting, base
    const P = H.pillar;
    air(P.x - 1, P.y, ['2']); air(P.x + P.w, P.y, ['2']); air(P.x - 1, P.y + 1, ['1']); air(P.x + P.w, P.y + 1, ['1']);
    top(P.x, P.y, ['4' + '3'.repeat(P.w - 2) + '3']);
    top(P.x, P.y + 1, ['1'.repeat(P.w)]);
    top(P.x + 1, P.y + 3, [[...Array(P.w - 2)].map((_, i) => (i % 5 === 2 ? '1' : '.')).join('')]);
    for (let k = 0; k < 3; k++) { const fx = P.x + 7 + k * 8; const rows = []; for (let y = P.y + 5; y < P.y + P.h - 6; y++) rows.push((y + k * 4) % 11 === 0 ? '.' : '2'); top(fx, P.y + 5, rows); }   // fluting: three soft grooves, a chip here and there
    top(P.x, P.y + P.h - 5, ['1'.repeat(P.w)]);
    top(P.x, P.y + P.h - 4, ['3'.repeat(P.w)]);
    air(P.x - 1, P.y + P.h - 3, ['2']); air(P.x + P.w, P.y + P.h - 3, ['2']); air(P.x - 2, P.y + P.h - 2, ['22']); air(P.x + P.w, P.y + P.h - 2, ['22']);   // the base flares to the floor

    // the slab: iron straps with rivets across it, brass shackles where its chains bite, tassels below
    const S = H.slab;
    for (const sx of [S.x + 5, S.x + S.w - 8]) for (let y = S.y; y < S.y + S.h; y++) top(sx, y, [y === S.y + 2 || y === S.y + S.h - 3 ? '232' : '121']);
    top(S.x, S.y, ['3'.repeat(S.w)]); top(S.x, S.y + S.h - 1, ['1'.repeat(S.w)]);
    for (const cx of S.chains) air(cx - 1, S.y - 3, SHACKLE);
    for (const [k, tx] of [[0, S.x + 12], [1, S.x + 20], [2, S.x + 28]].map((a) => a)) { const sway = Math.round(Math.sin(t * 1.3 + k * 1.7) * 0.6); air(tx + sway, S.y + S.h, TASSEL); }

    // the altar: cornice, three blind arches, a base course
    const A = H.altar;
    top(A.x, A.y, [[...Array(A.w)].map((_, i) => (i % 6 === 2 ? '4' : '3')).join('')]);
    top(A.x, A.y + 1, ['1'.repeat(A.w)]);
    for (let k = 0; k < 3; k++) top(A.x + 4 + k * 15, A.y + 7, ARCH);
    top(A.x, A.y + A.h - 2, ['2'.repeat(A.w)]);

    // the floor's fire grates, embers breathing
    for (const gx of H.grates) {
      const ph = Math.sin(t * 2.2 + gx) > 0.3;
      top(gx - 3, H.floorY, ph ? GRATE : [GRATE[0], '1676761', GRATE[2]]);
    }
    return out;
  }

  // the top of the room is lit now: cold moonlight from each high window
  function lights() {
    return HALL.windows.map((W0) => ({ x: W0.x, y: W0.y + W0.h * 0.6, r: 0.38, g: 0.5, b: 0.82, radius: 130, flicker: 0 }));
  }

  const api = { sprites, lights, HALL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillHallArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
