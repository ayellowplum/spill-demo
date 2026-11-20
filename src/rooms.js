// The room pool for the roguelike descent. Every room is hand-built around
// one idea; a floor draws a few of them, each possibly mirrored, so runs
// differ while every room stays designed and fair. Rooms are compact
// (480x270) and all share: a ragged crack in the ceiling you fall through, a
// funnel, a hidden memory, a window, lamp light and some still sand.
(function (root) {
  'use strict';
  const L = (typeof module !== 'undefined' && module.exports) ? require('./levels.js') : root.SpillLevels;
  const { window_, lantern } = L.helpers;
  const WALL = 1, EXIT = 6, SLICK = 8, SPIKE = 5;

  function shell(s, hole) {
    s.rect(0, 0, 480, 16, WALL);
    s.rect(0, 0, 16, 270, WALL);
    s.rect(464, 0, 16, 270, WALL);
    s.rect(0, 250, 480, 20, WALL);
    // the crack you fall in through
    for (let x = hole[0]; x < hole[1]; x++) {
      const d = Math.abs(x - (hole[0] + hole[1]) / 2) / ((hole[1] - hole[0]) / 2);
      const depth = Math.round(16 * (1 - d * d) + ((x * 7) % 3));
      s.rect(x, 16 - depth, 1, depth, 0);
    }
    // cool light spilling down through the crack onto the landing
    s.light(Math.round((hole[0] + hole[1]) / 2), 22, 0.42, 0.52, 0.78, 190, 0);
  }
  function funnel(s, x, y) {        // a funnel set into a floor whose top is at y
    s.rect(x, y, 36, 5, EXIT);
    s.rect(x + 5, y + 5, 26, 4, EXIT);
  }

  // A stepped corbel under a ledge, stones narrowing downward.
  function corbel(s, x, y, w, dir) {
    for (let k = 0; k < 3; k++) {
      const ww = Math.round(w * (1 - k * 0.3)), x0 = dir > 0 ? x : x + w - ww;
      s.rect(x0, y + k * 8, ww, 8, WALL);
    }
  }
  // Floors are never perfectly level: worn flags, a sunken run, a raised
  // slab. Each room passes its own seed so no two floors share a profile.
  function floorWear(s, x0, x1, seed, skip) {
    let x = x0, k = seed;
    while (x < x1) {
      k = (k * 1103515245 + 12345) & 0x7fffffff;
      const w = 10 + (k % 26), d = ((k >> 8) % 5) - 2;
      const xe = Math.min(x1, x + w);
      if (!(skip && xe > skip[0] && x < skip[1])) {
        if (d > 0) s.rect(x, 250 - d, xe - x, d, WALL);
        else if (d < 0) for (let xx = x; xx < xe; xx++) s.set(xx, 250, 0);
      }
      x = xe;
    }
  }

  const base = {
    w: 480, h: 270, count: 600, reserve: 140, parFrac: [0.3, 0.55, 0.8],
    camFloor: 246, camBottom: 270, fogY: 0, floorY: 250, keeper: [],
  };
  const room = (o) => Object.assign({}, base, o);

  const rooms = [
    room({
      id: 'spikefield', foes: [{ kind: 'mite', x: 372, y: 249 }], name: 'The Teeth',
      spawn: { x: 30, y: 20, w: 80, h: 51 }, camStart: { x: 90, y: 120 },
      memory: { x: 20, y: 246 },
      music: ['drowned_streets', 'low_tide_time', 'old_current'],
      build(s) {
        shell(s, [40, 104]);
        window_(s, 262, 40, 50, 92);
        s.rect(16, 72, 120, 12, WALL);               // the ledge you land on
        corbel(s, 16, 84, 40, 1);
        lantern(s, 104, 140, 84);                    // hung from the ledge's underside
        s.rect(236, 250, 110, 14, 0);                // a sunken pit lined with teeth
        s.rect(230, 244, 6, 6, WALL); s.rect(346, 244, 8, 6, WALL);   // its lips
        s.spikes(236, 254, 110, 10);
        floorWear(s, 16, 230, 31); floorWear(s, 354, 464, 77, [396, 440]);
        funnel(s, 400, 250);
        lantern(s, 340, 132, 16);
        s.erode(0.03, [[16, 72, 120, 3], [0, 244, 480, 8]]);
        s.light(287, 90, 0.5, 0.66, 1.0, 220, 0);
        s.light(418, 246, 1.0, 0.78, 0.38, 120, 0.3); s.lights[s.lights.length - 1].exit = true;
      },
    }),
    room({
      id: 'chimney', foes: [{ kind: 'diver', x: 320, y: 50, delay: 0, every: 260 }], name: 'The Chimney',
      spawn: { x: 30, y: 20, w: 76, h: 51 }, camStart: { x: 120, y: 130 },
      memory: { x: 448, y: 246 },
      music: ['drifting_stair', 'underwater_windows', 'the_deep_well'],
      build(s) {
        shell(s, [40, 100]);
        window_(s, 332, 40, 50, 92);
        s.rect(16, 72, 100, 12, WALL);
        corbel(s, 16, 84, 34, 1);
        lantern(s, 92, 150, 84);
        s.rect(200, 110, 56, 140, WALL);             // the tower: rough stone, climbable
        s.rect(188, 196, 12, 54, WALL); s.rect(176, 226, 12, 24, WALL);   // its fallen footing
        floorWear(s, 16, 176, 5); floorWear(s, 256, 464, 61);
        funnel(s, 210, 110);
        s.stillPile(372, 250, 30, 13);               // a hoard beyond the tower, if you go over
        lantern(s, 160, 120, 16);
        s.erode(0.03, [[16, 72, 100, 3], [200, 110, 56, 3], [197, 110, 6, 140], [253, 110, 6, 140], [0, 250, 480, 2]]);
        s.light(357, 90, 0.5, 0.66, 1.0, 230, 0);
        s.light(228, 106, 1.0, 0.78, 0.38, 120, 0.3); s.lights[s.lights.length - 1].exit = true;
      },
    }),
    room({
      id: 'grate', foes: [{ kind: 'diver', x: 300, y: 56, every: 250 }], name: 'The Grate',
      spawn: { x: 30, y: 20, w: 90, h: 80 }, camStart: { x: 120, y: 140 },
      memory: { x: 20, y: 186 },
      music: ['wound_clock', 'the_toll', 'archive_below'],
      build(s) {
        shell(s, [44, 110]);
        window_(s, 196, 30, 56, 96);
        s.rect(16, 190, 150, 60, WALL);              // the near side
        s.rect(276, 190, 188, 60, WALL);             // the far side
        for (let x = 166; x < 276; x++) if (x % 2 === 0) s.rect(x, 190, 1, 3, WALL);   // iron teeth
        s.spikes(166, 240, 110, 10);
        funnel(s, 416, 190);
        lantern(s, 330, 120, 16);
        s.erode(0.03, [[16, 190, 150, 3], [276, 190, 188, 3]]);
        s.light(224, 80, 0.5, 0.66, 1.0, 220, 0);
        s.light(434, 186, 1.0, 0.78, 0.38, 120, 0.3); s.lights[s.lights.length - 1].exit = true;
      },
    }),
    room({
      id: 'smooth', foes: [{ kind: 'mite', x: 282, y: 249 }], name: 'Smooth Steps',
      spawn: { x: 30, y: 20, w: 80, h: 90 }, camStart: { x: 120, y: 160 },
      memory: { x: 452, y: 246 },
      music: ['reflections_aster', 'lantern_distance', 'silt_and_stars'],
      build(s) {
        shell(s, [40, 104]);
        window_(s, 214, 40, 56, 100);
        s.rect(166, 192, 12, 58, SLICK); s.rect(163, 189, 18, 4, SLICK);
        s.rect(306, 190, 12, 60, SLICK); s.rect(303, 187, 18, 4, SLICK);
        s.stillPile(242, 250, 12, 5);                // a small reward between the walls, for the first throw
        floorWear(s, 16, 160, 12); floorWear(s, 180, 300, 45); floorWear(s, 320, 464, 9, [388, 432]);
        funnel(s, 392, 250);
        lantern(s, 120, 140, 16);
        s.erode(0.03, [[0, 244, 480, 8]]);
        s.light(242, 90, 0.5, 0.66, 1.0, 230, 0);
        s.light(410, 246, 1.0, 0.78, 0.38, 120, 0.3); s.lights[s.lights.length - 1].exit = true;
      },
    }),
    room({
      id: 'hoard', foes: [{ kind: 'mite', x: 440, y: 119 }], name: 'The Hoard',
      spawn: { x: 30, y: 20, w: 80, h: 90 }, camStart: { x: 140, y: 160 },
      memory: { x: 452, y: 116 },
      music: ['still_hours', 'paper_memories', 'borrowed_afternoon'],
      build(s) {
        shell(s, [40, 104]);
        window_(s, 60, 46, 56, 100);
        s.rect(280, 120, 20, 130, WALL);             // a rough pillar up to the shelf
        s.rect(300, 120, 164, 10, WALL);             // the shelf with the hoard
        s.stillPile(388, 120, 42, 18);
        floorWear(s, 16, 280, 23, [176, 220]);
        corbel(s, 300, 130, 30, 1);
        funnel(s, 180, 250);                         // the way on is easy; greed is optional
        lantern(s, 388, 66, 16);
        s.erode(0.03, [[277, 120, 26, 130], [300, 120, 164, 3], [0, 250, 480, 2]]);
        s.light(88, 96, 0.5, 0.66, 1.0, 220, 0);
        s.light(198, 246, 1.0, 0.78, 0.38, 120, 0.3); s.lights[s.lights.length - 1].exit = true;
      },
    }),
    room({
      id: 'shaft', foes: [{ kind: 'diver', x: 380, y: 60, every: 240 }], name: 'The Shaft',
      // the shaft's teeth come and go: out ~1.6 s, in ~2.2 s, the two walls out of step
      mechs: [
        { kind: 'spikeWall', x: 220, side: 1, y0: 130, y1: 192, len: 2, in: 132, out: 96, phase: 0 },
        { kind: 'spikeWall', x: 261, side: -1, y0: 130, y1: 192, len: 2, in: 132, out: 96, phase: 60 },
      ],
      spawn: { x: 30, y: 20, w: 90, h: 51 }, camStart: { x: 150, y: 130 },
      memory: { x: 452, y: 246 },
      music: ['below', 'the_deep_well', 'a_kind_shadow'],
      build(s) {
        shell(s, [40, 110]);
        window_(s, 330, 40, 60, 110);
        s.rect(16, 72, 224, 12, WALL);               // the ledge ends over the middle of the shaft
        s.rect(214, 92, 6, 158, WALL); s.rect(262, 92, 6, 158, WALL);
        s.rect(222, 250, 38, 5, EXIT); s.rect(227, 255, 28, 4, EXIT);
        corbel(s, 210, 84, 30, -1);
        lantern(s, 120, 150, 84);
        floorWear(s, 16, 214, 88); floorWear(s, 268, 464, 19);
        lantern(s, 300, 150, 16);
        s.erode(0.03, [[16, 72, 224, 3], [211, 92, 60, 158], [0, 250, 480, 2]]);
        s.light(360, 90, 0.5, 0.66, 1.0, 230, 0);
        s.light(240, 246, 1.0, 0.78, 0.38, 110, 0.3); s.lights[s.lights.length - 1].exit = true;
      },
    }),
  ];

  const api = { rooms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillRooms = api;
})(typeof window !== 'undefined' ? window : globalThis);
