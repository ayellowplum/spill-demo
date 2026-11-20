// MATERIAL PROPERTY TABLES (migration step 5a, docs/remake/MATERIAL_MODEL.md 4.1). Flat typed lookups indexed by the terrain value in the sim's grid `g`,
// filled with TODAY's materials only, so behaviour is identical: the sim asks P.collide[id] instead of comparing ids. New properties (grip, slip, one-way,
// breakable, sound) get a table here when they are designed; changing a number here changes the game, so only the extraction is frame-exact.
(function (root) {
  'use strict';
  // terrain values. Values >= 30 are decoration: drawn, never collide. STILL (settled sand lives in the grid today) is split out in step 5c.
  const IDS = { EMPTY: 0, WALL: 1, GLASS: 4, SPIKE: 5, EXIT: 6, SLICK: 8, STILL: 9, CHAIN: 30, LANTERN: 31, RUBBLE: 32 };
  const N = 256;
  const P = {
    collide: new Uint8Array(N),         // 1 = grains, bodies and creatures cannot enter (blocks)
    climb: new Uint8Array(N),           // 1 = sand can climb this face (WALL only: gates are SLICK iron)
    bounce: new Float64Array(N).fill(0.2),   // restitution of a grain bumping it sideways: today one global constant, 0.2
    kill: new Uint8Array(N),            // 1 = a grain entering is destroyed (SPIKE)
    exit: new Uint8Array(N),            // 1 = a grain entering leaves the room and is counted (EXIT)
    noRest: new Uint8Array(N),          // 1 = nothing may be placed here or rest against it from above (kill or exit)
  };
  for (const id of [IDS.WALL, IDS.GLASS, IDS.SLICK, IDS.STILL]) P.collide[id] = 1;
  P.climb[IDS.WALL] = 1; P.kill[IDS.SPIKE] = 1; P.exit[IDS.EXIT] = 1;
  for (let i = 0; i < N; i++) P.noRest[i] = P.kill[i] || P.exit[i] ? 1 : 0;
  const api = { IDS, P };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SpillMaterials = api;
})(typeof window !== 'undefined' ? window : globalThis);
