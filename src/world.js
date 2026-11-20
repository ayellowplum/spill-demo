// The Tower of Hours as one connected place. Rooms join through openings
// in their edges; your sand flows from one into the next, and whatever you
// leave behind stays where you left it.
//
// Each room: size, a position on the map (in cells, so rooms line up), its
// exits ({side, a, b, to}), and optionally a shrine (the Keeper, a
// checkpoint), mechanisms, creatures and still sand.
(function (root) {
  'use strict';
  const L = (typeof module !== 'undefined' && module.exports) ? require('./levels.js') : root.SpillLevels;
  const { window_, lantern } = L.helpers;
  const WALL = 1, GLASS = 4, SLICK = 8;
  const VOID = 2;

  // the four walls, with gaps cut wherever an exit is
  function shell(s, W, H, exits, t) {
    t = t || 16;
    const floor = 30;                                    // every room's floor top sits 30 cells above its bottom
    s.rect(0, 0, W, t, WALL); s.rect(0, H - floor, W, floor, WALL);
    s.rect(0, 0, t, H, WALL); s.rect(W - t, 0, t, H, WALL);
    for (const e of exits) {
      if (e.side === 'left') s.rect(0, e.a, t, e.b - e.a, 0);
      if (e.side === 'right') s.rect(W - t, e.a, t, e.b - e.a, 0);
      if (e.side === 'up') s.rect(e.a, 0, e.b - e.a, t, 0);
      if (e.side === 'down') s.rect(e.a, H - floor, e.b - e.a, floor, 0);
    }
  }

  const rooms = {
    // ---------------------------------------------------------------- hub
    hub: {
      id: 'hub', name: 'The Lantern Landing', w: 640, h: 360, map: { x: 0, y: 0 },
      spawn: { x: 40, y: 24, w: 70, h: 40 }, camStart: { x: 200, y: 200 }, camFloor: 999, camBottom: 999, fogY: 0, floorY: 330,
      count: 500, reserve: 1400, par: [99999, 99999, 99999], keeper: [],
      music: ['keeper', 'still_hours', 'lantern_distance'],
      shrine: { x: 132, y: 330 },
      exits: [
        { side: 'right', a: 262, b: 330, to: 'hall' },
        { side: 'down', a: 40, b: 72, to: 'dream' },         // the Dream Well, tucked under the landing
      ],
      build(s) {
        shell(s, 640, 360, this.exits);
        // the ceiling crack you first fall in through
        for (let x = 36; x < 112; x++) { const d = Math.abs(x - 74) / 38, depth = Math.round(16 * (1 - d * d) + ((x * 7) % 3)); s.rect(x, 16 - depth, 1, depth, 0); }
        s.light(74, 22, 0.42, 0.52, 0.78, 200, 0);
        window_(s, 420, 60, 70, 130);
        // a landing for the falling sand, and steps down to the shrine floor
        s.rect(16, 120, 120, 12, WALL); s.rect(16, 132, 40, 10, WALL);
        // the Dream Well: a stone ring around a hole in the floor, out of the
        // way under the landing; you only go in if you mean to
        s.rect(16, 306, 24, 24, WALL); s.rect(72, 306, 14, 24, WALL);
        s.rect(16, 302, 28, 5, WALL); s.rect(68, 302, 20, 5, WALL);
        s.bgRect(40, 296, 32, 40, VOID);
        s.light(56, 340, 0.45, 0.6, 1.0, 110, 0.5);
        // more light for a room this size: the window's glow and a low brazier
        s.light(455, 200, 0.5, 0.62, 0.95, 220, 0);
        s.light(560, 316, 0.95, 0.58, 0.3, 110, 0.4);
        // the sealed grate down to the Drowned Cistern (opens in time)
        for (let x = 470; x < 560; x += 3) s.rect(x, 326, 2, 4, WALL);
        s.stillPile(230, 330, 18, 8);
        lantern(s, 132, 270, 16);
        s.erode(0.03, [[16, 120, 120, 3], [0, 326, 640, 6], [16, 298, 74, 32]]);
      },
    },

    // -------------------------------------------------------- proving hall
    // Every mechanism and creature in one long room: for learning, and for
    // tuning how it all feels without building throwaway levels.
    hall: {
      id: 'hall', name: 'The Proving Hall', w: 1040, h: 360, map: { x: 640, y: 0 },
      spawn: { x: 20, y: 270, w: 40, h: 56 }, camStart: { x: 160, y: 240 }, camFloor: 999, camBottom: 999, fogY: 0, floorY: 330,
      count: 500, reserve: 1400, par: [99999, 99999, 99999], keeper: [],
      music: ['wound_clock', 'archive_below', 'the_toll'],
      exits: [{ side: 'left', a: 262, b: 330, to: 'hub' }, { side: 'down', a: 1000, b: 1024, to: 'cistern' }],
      foes: [
        { kind: 'mite', x: 930, y: 329 }, { kind: 'mite', x: 975, y: 329 },
        { kind: 'diver', x: 960, y: 110, every: 280 },
        { kind: 'dummy', x: 944, y: 329 },
      ],
      mechs: [
        // weight: hold this plate down and the door to the vault opens
        { kind: 'plate', x: 330, y: 330, w: 40, need: 90, door: { x: 420, y: 256, w: 8, h: 74 } },
        // basin and lift: pour in, the platform rises to the lamp ledge
        { kind: 'lift', basin: { x: 520, y: 296, w: 40, h: 34 }, plat: { x: 580, y: 326, w: 40, h: 4 }, rise: 70, per: 1.0 },
        // the lamp: feed it, and the wall beside it gives way
        { kind: 'lamp', x: 660, y: 255, need: 30, reveal: { x: 700, y: 200, w: 16, h: 56 } },
        // a blade over the spike pit: cross between swings
        { kind: 'pendulum', px: 780, py: 150, len: 120, amp: 0.85, period: 150 },
        // old glass over the second pit: it holds you for a moment
        { kind: 'crumble', x: 836, y: 300, w: 56 },
      ],
      memory: { x: 708, y: 250 },
      lamp: { x: 492, y: 330 },          // a checkpoint lamp past the gate: touch it to wake here
      build(s) {
        shell(s, 1040, 360, this.exits);
        window_(s, 120, 50, 56, 110); window_(s, 600, 50, 56, 110);
        lantern(s, 90, 200, 16); lantern(s, 470, 190, 16); lantern(s, 960, 200, 16);
        // a rough pillar to climb, with a little still sand on top
        s.rect(170, 230, 30, 100, WALL); s.stillPile(185, 230, 12, 5);
        // a slick wall: you cannot climb it, you throw yourself over
        s.rect(280, 262, 12, 68, SLICK); s.rect(277, 259, 18, 4, SLICK);
        // the plate is a brass plate set into the floor (drawn, not a step);
        // the vault lies behind an iron portcullis hung in a stone frame
        s.rect(406, 226, 36, 24, WALL); s.rect(406, 250, 14, 6, WALL); s.rect(428, 250, 14, 6, WALL);
        s.rect(420, 256, 8, 74, SLICK);
        s.stillPile(470, 330, 22, 9);
        // the basin (a stone tub) and the lift shaft beside it
        s.rect(514, 290, 6, 40, WALL); s.rect(560, 290, 6, 40, WALL);
        s.rect(580, 326, 40, 4, WALL);                                        // the platform at rest
        s.rect(620, 256, 90, 10, WALL);                                       // the lamp ledge
        s.rect(652, 250, 4, 6, WALL); s.rect(664, 250, 4, 6, WALL);           // the brazier bowl
        s.rect(700, 190, 20, 66, WALL);                                       // the wall that hides the alcove
        s.rect(720, 190, 10, 76, WALL);
        // spike pit under the pendulum
        s.rect(730, 330, 96, 14, 0); s.spikes(730, 334, 96, 10);
        s.rect(826, 300, 10, 30, WALL);
        // second pit, bridged by old glass
        s.rect(836, 330, 56, 14, 0); s.spikes(836, 334, 56, 10);
        s.rect(836, 300, 56, 2, GLASS);
        s.rect(892, 300, 10, 30, WALL);
        // the way on: a shaft at the hall's end, dropping into the Cistern
        s.rect(990, 318, 10, 12, WALL); s.bgRect(1000, 300, 24, 60, VOID);
        // a light at every station, so each lesson can be read
        for (const [x, y, r, g, b, rad] of [[240, 300, 0.9, 0.6, 0.32, 120], [350, 296, 0.9, 0.6, 0.32, 110], [470, 290, 0.6, 0.7, 1.0, 120],
          [540, 280, 0.9, 0.6, 0.32, 110], [640, 230, 0.9, 0.6, 0.32, 120], [780, 260, 0.6, 0.7, 1.0, 140], [864, 270, 0.6, 0.7, 1.0, 110], [990, 290, 0.9, 0.6, 0.32, 130]]) s.light(x, y, r, g, b, rad, 0.2);
        s.erode(0.02, [[0, 326, 1040, 6], [170, 230, 30, 100], [620, 256, 90, 3], [406, 226, 36, 30]]);
      },
    },
  };

  // ------------------------------------------------------- the Cistern
  // A tall flooded shaft under the Proving Hall. The water breathes with a
  // slow tide; a vent in the east wall breathes too; a bell hangs over the
  // broken stair. Two ways to the high west ledge: ride the tide, or time
  // the vent.
  rooms.cistern = {
    id: 'cistern', name: 'The Drowned Cistern', w: 760, h: 880, map: { x: 1264, y: 360 },
    spawn: { x: 360, y: 20, w: 60, h: 60 }, camStart: { x: 400, y: 120 }, camFloor: 999, camBottom: 999, fogY: 0, floorY: 850,
    count: 500, reserve: 1600, par: [99999, 99999, 99999], keeper: [],
    music: ['drowned_streets', 'underwater_windows', 'low_tide_time'],
    shrine: { x: 600, y: 200 },
    exits: [{ side: 'up', a: 380, b: 404, to: 'hall' }],
    foes: [{ kind: 'mite', x: 300, y: 849 }, { kind: 'gnat', x: 440, y: 420 }, { kind: 'gnat', x: 452, y: 414 }, { kind: 'gnat', x: 446, y: 426 }],
    mechs: [
      { kind: 'tide', x: 16, w: 728, low: 822, high: 492, period: 1500 },
      { kind: 'vent', x: 743, y: 470, dir: [-1, 0], len: 520, width: 16, inhale: 170, hold: 50, exhale: 150, rest: 120, eat: true },
      { kind: 'bell', x: 190, y: 64, period: 360, ledges: [{ x: 200, y: 140, w: 80, push: -0.6 }, { x: 100, y: 190, w: 80, push: -0.6 }] },
      { kind: 'lamp', x: 120, y: 493, need: 24, reveal: { x: 16, y: 430, w: 22, h: 63 } },
    ],
    memory: { x: 26, y: 488 },
    build(s) {
      shell(s, 760, 880, this.exits);
      window_(s, 320, 150, 60, 110); window_(s, 520, 560, 48, 90);
      // arrival landing, and the broken stair down the west side
      s.rect(300, 90, 200, 14, WALL); s.rect(330, 104, 40, 8, WALL);
      s.rect(200, 140, 80, 10, WALL); s.rect(100, 190, 80, 10, WALL); s.rect(16, 240, 74, 12, WALL);
      for (let y = 16; y < 58; y++) s.set(190, y, 30);                       // the bell's chain
      // the shrine dais on the east, with a slot that drops to the vent ledge
      s.rect(560, 200, 80, 14, WALL); s.rect(664, 200, 80, 14, WALL); s.rect(560, 214, 24, 10, WALL);
      s.rect(600, 480, 144, 12, WALL);                                       // the vent ledge
      // the high west ledge (just above the high tide), and the walled alcove behind its lamp
      s.rect(16, 494, 150, 10, WALL); s.rect(16, 504, 40, 12, WALL);
      s.rect(16, 430, 22, 64, WALL);
      s.rect(114, 487, 4, 7, WALL); s.rect(124, 487, 4, 7, WALL);            // the lamp's bowl
      // the floor, bared at low tide: still sand, a spike pit, worn flags
      s.rect(16, 840, 90, 10, 0); s.spikes(16, 840, 90, 10);
      s.stillPile(250, 850, 20, 8); s.stillPile(610, 850, 26, 10); s.stillPile(130, 494, 10, 4);
      s.rect(106, 836, 8, 14, WALL);
      lantern(s, 600, 150, 16); lantern(s, 380, 380, 16);
      s.light(190, 70, 0.9, 0.62, 0.32, 140, 0.3);                            // the bell catches lamplight
      s.light(730, 470, 0.5, 0.75, 1.0, 120, 0.2);                            // a cold breath from the vent
      s.light(380, 700, 0.35, 0.55, 0.85, 260, 0.1);                          // light under the water
      s.light(80, 470, 0.9, 0.62, 0.32, 110, 0.2);
      s.erode(0.02, [[300, 90, 200, 3], [200, 140, 80, 3], [100, 190, 80, 3], [16, 240, 74, 3], [560, 200, 184, 3], [600, 480, 144, 3], [16, 494, 150, 3], [0, 846, 760, 6]]);
    },
  };

  const api = { rooms, start: 'hub' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpillWorld = api;
})(typeof window !== 'undefined' ? window : globalThis);
