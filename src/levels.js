// Chambers. Each builds terrain, background and lights onto a Sim.
(function (root) {
  'use strict';
  const WALL = 1, GLASS = 4, EXIT = 6, SLICK = 8, CHAIN = 30, LANTERN = 31;
  const SKY = 1, VOID = 2, FRAME = 3;

  // Hanging lantern: the chain is terrain decor; the lantern itself is a
  // hand-drawn animated prop (see PROPS in game.js), lit by its own flame.
  function lantern(s, x, y, top) {
    for (let yy = top; yy < y; yy++) s.set(x, yy, CHAIN);
    s.props.push({ kind: 'lantern', x: x - 3, y });
    s.light(x, y + 7, 1.0, 0.6, 0.26, 165, 1);
  }
  // Arched window with a stone frame, a centre mullion and a transom bar.
  // A window built like a real one: a ring of voussoir stones around the
  // arch, jambs down the sides, a projecting sill, mullion and transom. The
  // individual stones are laid out in stones.js from this record.
  function window_(s, x, y, w, h) {
    s.bgArch(x - 7, y - 7, w + 14, h + 9, FRAME);
    s.bgArch(x, y, w, h, SKY);
    const mid = x + Math.floor(w / 2);
    s.bgRect(mid - 1, y, 3, h, FRAME);
    s.bgRect(x, y + Math.floor(h * 0.55), w, 3, FRAME);
    s.bgRect(x - 10, y + h, w + 20, 5, FRAME); // sill
    (s.windows || (s.windows = [])).push({ x, y, w, h });
  }

  function count(s, x0, x1, y0, y1) {
    let n = 0;
    for (let i = 0; i < s.N; i++) if (s.state[i] === 1 && s.px[i] >= x0 && s.px[i] < x1 && s.py[i] >= y0 && s.py[i] < y1) n++;
    return n;
  }

  const chambers = [
    {
      id: 'cistern',
      numeral: 'I',
      name: 'The Cistern',
      w: 720, h: 405,
      count: 800,
      par: [200, 450, 650],
      spawn: {
        x: 44, y: 76, w: 74, h: 74,
        filter: (x, y) => (x - 80) ** 2 + (y - 112) ** 2 < 36 * 36,
      },
      camStart: { x: 120, y: 130 },
      memory: { x: 472, y: 172 },   // on the risky ledge over the dark, beside the sleeper's heap
      music: [
        'spill', 'first_light', 'uncounted_hours', 'silt_and_stars', 'sleepers_hand',
        'cistern', 'underwater_windows', 'drifting_stair', 'reflections_aster', 'the_deep_well',
        'keeper', 'lantern_distance', 'the_toll', 'empty_cloak', 'a_kind_shadow',
        'still_hours', 'borrowed_afternoon', 'wound_clock', 'paper_memories', 'last_lullaby',
        'moonlight_glass',
      ],
      // The Keeper speaks when the sand reaches each idea for the first time.
      keeper: [
        { id: 'wake', when: (s) => s.frame > 100, lines: [
          '...still moving? Then someone below is still dreaming.',
        ] },
        { id: 'wall', after: ['wake'], when: (s) => count(s, 200, 300, 200, 252) > 300, lines: [
          'Polished stone. Whoever built this did not want to be followed.',
        ] },
        { id: 'gap', after: ['wall'], when: (s) => count(s, 310, 440, 180, 252) > 150, lines: [
          'Below is the dark. What falls there is not lost... it is taken.',
          'Gather close before you leap. What you leave behind stays behind.',
        ] },
        { id: 'tower', after: ['gap'], when: (s) => count(s, 490, 612, 160, 252) > 120, lines: [
          'Rough stone remembers hands.',
        ] },
        { id: 'memory', when: (s) => s.memory && s.memory.found, lines: [
          'A memory, kept in glass. Someone\'s hours, not yours. I will hold it for you.',
        ] },
        { id: 'still', when: (s) => s.absorbed > 0, lines: [
          'Someone else\'s hours. Still, because no one was steering them.',
          'Touch them and they are yours. Carry them home.',
        ] },
        { id: 'enough', when: (s) => s.enough, lines: [
          'Enough to go on. Bring the rest if you can.',
        ] },
        { id: 'home', after: ['enough'], when: (s) => s.exited >= 200, lines: [
          'The funnel takes you down. Go, sleeper. I will find you there.',
        ] },
      ],
      fogY: 330,       // the back wall fades into the far depths around here
      floorY: 250,
      camFloor: 280,   // grains below this are falling into the pit; ignore
      camBottom: 305,  // never show below this row
      build(s) {
        // Background: old brick everywhere, two arched windows, a deep pit.
        window_(s, 326, 40, 84, 150);
        window_(s, 556, 44, 40, 72);
        s.bgRect(24, 272, 672, 112, VOID);

        // Shell of the chamber
        s.rect(0, 0, 720, 20, WALL);
        s.rect(0, 0, 24, 405, WALL);
        s.rect(696, 0, 24, 405, WALL);
        s.rect(0, 384, 720, 21, WALL);

        // Spawn shelf with a corbel under it
        s.rect(24, 150, 150, 18, WALL);
        s.rect(24, 168, 46, 22, WALL);
        s.rect(24, 190, 22, 16, WALL);

        // The cracked hourglass bulb the sand escapes from
        for (let a = 0; a < 360; a += 0.5) {
          const r = a * Math.PI / 180;
          if (a > 340 || a < 75) continue; // the crack, low right
          for (const rr of [38, 39]) {
            const x = Math.round(80 + Math.cos(r) * rr), y = Math.round(112 + Math.sin(r) * rr);
            if (y < 150) s.set(x, y, GLASS);
          }
        }

        // Middle floor with a polished marble wall: too smooth to climb
        s.rect(150, 250, 280, 20, WALL);
        s.rect(150, 270, 30, 14, WALL);
        s.rect(400, 270, 30, 14, WALL);
        s.rect(300, 205, 10, 45, SLICK);
        s.rect(298, 203, 14, 3, SLICK);

        // Landing shelf across the gap, then the climbable tower
        s.rect(490, 250, 120, 20, WALL);
        s.rect(490, 270, 26, 14, WALL);
        s.rect(610, 160, 86, 224, WALL);

        // Exit: a glowing funnel set into the tower top
        s.rect(648, 160, 36, 6, EXIT);
        s.rect(652, 166, 28, 4, EXIT);
        s.rect(657, 170, 18, 4, EXIT);

        // Someone else's time: one heap on the path, one on a ledge over the dark
        s.stillPile(362, 250, 16, 6);
        s.rect(432, 176, 46, 6, WALL);
        s.stillPile(455, 176, 18, 9);

        // Spikes along the cistern floor
        s.spikes(24, 374, 672, 10);

        // Age the masonry, protecting surfaces the sand has to use
        s.erode(0.035, [
          [24, 150, 150, 3], [150, 250, 280, 3], [490, 250, 120, 3],
          [610, 160, 86, 3], [607, 160, 6, 92], [0, 384, 720, 2], [432, 176, 46, 3],
        ]);

        // Lights: moonlight through the windows, warm lanterns, the exit
        s.light(368, 110, 0.5, 0.66, 1.0, 460, 0);
        s.light(576, 78, 0.45, 0.58, 0.95, 230, 0);
        lantern(s, 248, 178, 20);
        lantern(s, 552, 192, 20);
        s.light(666, 156, 1.0, 0.78, 0.38, 170, 0.3);
        s.lights[s.lights.length - 1].exit = true;
      },
    },
    {
      id: 'stair',
      numeral: 'II',
      name: 'The Iron Stair',
      w: 640, h: 420,
      count: 600,              // only used if you start here directly
      parFrac: [0.35, 0.6, 0.82],
      spawn: { x: 40, y: 26, w: 100, h: 54 },
      camStart: { x: 120, y: 90 },
      memory: { x: 31, y: 76 },     // tucked in the far corner of the landing shelf
      music: [
        'iron_stair', 'below', 'drowned_streets', 'low_tide_time', 'archive_below', 'old_current',
        'keeper', 'lantern_distance', 'the_toll', 'empty_cloak', 'a_kind_shadow',
        'spill', 'first_light', 'uncounted_hours', 'silt_and_stars', 'sleepers_hand',
        'still_hours', 'borrowed_afternoon', 'wound_clock', 'paper_memories', 'last_lullaby',
        'moonlight_glass', 'great_glass',
      ],
      fogY: 340,
      floorY: 200,
      camFloor: 320,
      camBottom: 300,
      keeper: [
        { id: 'enter', when: (s) => s.frame > 80, lines: [
          (s) => `You carried ${s.total} grains down with you.`,
          'Whatever you lose from here, the sleeper loses too.',
        ] },
        { id: 'grate', after: ['enter'], when: (s) => count(s, 240, 300, 150, 200) > 150, lines: [
          'Iron teeth. Sand slips between them...',
          '...unless it never touches them.',
        ] },
        { id: 'pillar', after: ['grate'], when: (s) => count(s, 404, 470, 150, 200) > 100, lines: [
          'Someone fell asleep up there. Climb, and wake them.',
        ] },
        { id: 'memory', when: (s) => s.memory && s.memory.found, lines: [
          'Another memory. They gather where no one looks.',
        ] },
        { id: 'still', when: (s) => s.absorbed > 0, lines: [
          'More hours. Heavier to carry. Worth it.',
        ] },
        { id: 'enough', when: (s) => s.enough, lines: [
          'Enough. Save the rest, or leave it.',
        ] },
        { id: 'out', after: ['pillar'], when: (s) => s.exited > 50, lines: [
          'Down again. The Great Glass is far below.',
        ] },
      ],
      build(s) {
        window_(s, 300, 40, 44, 80);
        s.bgRect(24, 214, 592, 186, VOID);

        s.rect(0, 0, 640, 20, WALL);
        s.rect(0, 0, 24, 420, WALL);
        s.rect(616, 0, 24, 420, WALL);
        s.rect(0, 404, 640, 16, WALL);

        // the broken ceiling you fell through: a ragged hole in the stone
        for (let x = 52; x < 128; x++) {
          const d = Math.abs(x - 90) / 38;
          const depth = Math.round(20 * (1 - d * d) + ((x * 7) % 3));
          s.rect(x, 20 - depth, 1, depth, 0);
        }
        s.bgRect(52, 0, 76, 20, 2);

        // landing shelf and a broken stair down to the right
        s.rect(24, 80, 140, 134, WALL);
        s.rect(164, 110, 40, 104, WALL);
        s.rect(204, 140, 40, 74, WALL);
        s.rect(244, 170, 40, 44, WALL);

        // the grate: iron teeth with one-pixel gaps
        for (let x = 284; x < 404; x++) if (x % 2 === 0) s.rect(x, 200, 1, 3, WALL);
        s.rect(284, 203, 120, 1, 0);

        // far shelf, a tall pillar with a sleeper's heap on top, then the drop
        s.rect(404, 200, 120, 14, WALL);
        s.rect(468, 120, 20, 80, WALL);
        s.stillPile(478, 120, 9, 6);
        s.rect(524, 262, 92, 142, WALL);
        s.rect(524, 255, 4, 7, WALL); // a curb so sand on the ledge does not spill back into the pit
        s.rect(556, 262, 44, 5, EXIT);
        s.rect(562, 267, 32, 4, EXIT);

        s.spikes(24, 394, 592, 10);

        s.erode(0.03, [[24, 80, 140, 3], [164, 110, 120, 3], [404, 200, 120, 3], [465, 120, 26, 82], [524, 262, 92, 3], [524, 255, 4, 7], [244, 170, 40, 40]]);

        s.light(322, 80, 0.5, 0.66, 1.0, 320, 0);
        lantern(s, 190, 60, 20);
        lantern(s, 430, 150, 20);
        s.light(578, 258, 1.0, 0.78, 0.38, 150, 0.3);
        s.lights[s.lights.length - 1].exit = true;
      },
    },
  ];

  // The scene behind the title menu: an ambient stretch of the tower, no
  // centrepiece. Real masonry, three arched windows, lanterns, moonlight,
  // and one thin trickle of sand from a crack in the ceiling off to one side.
  const titleScene = {
    id: 'title', numeral: '', name: '', w: 760, h: 270, count: 0, par: [1, 2, 3],
    spawn: { x: 0, y: 0, w: 1, h: 1 },
    camStart: { x: 380, y: 140 }, camFloor: 999, camBottom: 999, fogY: 0, floorY: 232, keeper: [], music: ['spill'],
    build(s) {
      s.rect(0, 0, 760, 18, WALL);
      s.rect(0, 0, 18, 270, WALL);
      s.rect(742, 0, 18, 270, WALL);
      s.rect(0, 232, 760, 38, WALL);
      // a low step running along the floor, broken in places
      s.rect(18, 222, 210, 10, WALL);
      s.rect(300, 226, 170, 6, WALL);
      s.rect(560, 220, 182, 12, WALL);
      window_(s, 120, 46, 66, 128);
      window_(s, 347, 52, 66, 120);
      window_(s, 574, 46, 66, 128);
      s.erode(0.04, [[0, 232, 760, 2]]);
      s.light(153, 100, 0.5, 0.66, 1.0, 260, 0);
      s.light(380, 104, 0.5, 0.66, 1.0, 260, 0);
      s.light(607, 100, 0.5, 0.66, 1.0, 260, 0);
      lantern(s, 262, 112, 18);
      lantern(s, 498, 112, 18);
      // the Keeper, resting on the step under the middle window, his lantern held low
      s.props.push({ kind: 'sleeper', x: 334, y: 179 });          // 60 wide, 47 tall: his hood at the window's foot
      s.props.push({ kind: 'smallGlass', x: 396, y: 204 });       // the cracked hourglass he watches
      s.light(385, 211, 1.0, 0.62, 0.3, 120, 1);               // his lantern
    },
  };

  const api = { chambers, titleScene, helpers: { window_, lantern, count } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillLevels = api;
})(typeof window !== 'undefined' ? window : globalThis);
