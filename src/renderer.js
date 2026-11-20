// WebGL2 renderer: every world cell is one art pixel, lit per pixel.
// Passes: scene+lighting (HDR, view-sized) -> bloom (half/quarter) -> composite to screen.
(function (root) {
  'use strict';

  const MAXL = 16;   // (was 10: the boss hall has its eye lamps, lanterns, floor grates, wall braziers and high windows)
  const ZOOM_MIN = 0.62, ZOOM_MAX = 1.34;   // boss arenas are framed whole, so the target allows a wide view
  // Sprite palette for hand-drawn props: r, g, b (sRGB 0..1), glow strength.
  const SPRITE_PAL = new Float32Array([
    0, 0, 0, 0,
    0.11, 0.10, 0.12, 0,     // 1 iron dark
    0.24, 0.22, 0.25, 0,     // 2 iron
    0.58, 0.42, 0.20, 0,     // 3 brass
    0.86, 0.68, 0.36, 0.15,  // 4 brass highlight
    0.95, 0.62, 0.30, 0.55,  // 5 warm glass
    1.00, 0.45, 0.12, 2.6,   // 6 flame edge
    1.00, 0.74, 0.30, 3.6,   // 7 flame
    1.00, 0.95, 0.80, 5.0,   // 8 flame core
    0.17, 0.16, 0.18, 0,     // 9 chain
    0.86, 0.66, 0.38, 0,     // a sand
    0.93, 0.76, 0.48, 0,     // b sand light
    0.76, 0.55, 0.31, 0,     // c sand dark
    0.98, 0.86, 0.62, 0.35,  // d falling stream, catching the light
    0.34, 0.11, 0.10, 0,     // e banner cloth, red
    0.46, 0.18, 0.14, 0,     // f banner cloth, red, lit fold
    0.36, 0.25, 0.22, 0,     // g faded cloth
    0.45, 0.33, 0.28, 0,     // h faded cloth, lit fold
    0.18, 0.21, 0.28, 0,     // i ash-blue cloth
    0.25, 0.29, 0.37, 0,     // j ash-blue cloth, lit fold
    0.30, 0.26, 0.22, 0.05,  // k moth
    0.36, 0.42, 0.50, 0,     // l water drop: dim, no glow
    0.07, 0.06, 0.07, 0,     // m spider
    0.70, 0.86, 0.92, 0.9,   // n memory glass, glowing
    0.40, 0.55, 0.62, 0.3,   // o memory glass, edge
    0.08, 0.06, 0.13, 0.10,  // p cloak, deepest (a faint self-light so creatures read in the dark)
    0.15, 0.11, 0.24, 0.16,  // q cloak
    0.24, 0.19, 0.36, 0.22,  // r cloak, lit fold
    0.48, 0.43, 0.58, 0.30,  // s cloak trim, moonlit rim
    0.72, 0.45, 0.22, 0,     // t warm rim from the lantern
    0.03, 0.02, 0.05, 0,     // u the face, a void
    0, 0, 0, 0,
    0.22, 0.66, 0.74, 0.55,  // w the Sieve's eye: its iris, teal (art pass)
    0.80, 0.77, 0.70, 0.06,  // x the Sieve's eye: the white of it (bone, a little warm)
    0.80, 0.20, 0.12, 0.7,   // y the Sieve's eye, angry: its iris, red
    0.30, 0.05, 0.06, 0.1,   // z the Sieve's eye, angry: a vein
  ]);
  const TARGET_ROWS = 250; // roughly how many world rows fit on screen

  const VS = `#version 300 es
  in vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const COMMON = `#version 300 es
  precision highp float;
  precision highp int;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = h21(i), b = h21(i + vec2(1, 0)), c = h21(i + vec2(0, 1)), d = h21(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
  `;

  // ---------- scene + lighting ----------
  const FS_SCENE = COMMON + `
  uniform sampler2D uCells;
  uniform sampler2D uOcc;   // half-res, linearly filtered light occlusion
  uniform sampler2D uStone; // stone ids + tones laid out by stones.js
  uniform vec4 uWin[4];     // windows: x, y, w, h (for sill stains)
  uniform int uNWin;
  uniform float uWinS[4];   // glazing style per window
  uniform float uFloorY;    // main floor row, for damp
  uniform vec2 uWorld, uOrigin, uView, uSkyOff;
  uniform float uTime, uExitPulse, uEnough, uFogY, uProg, uHover, uFrost, uDeco;
  uniform int uFrostK;         // frozen sand: crystal pattern of this freeze (0-4)
  uniform vec4 uFrostW;        // frost seed x, y, wave reach, shield worn 0..1
  uniform vec4 uCrack[4];      // star cracks where the ice was struck: x, y, length, seed
  uniform vec3 uRing;          // the boss arena's great ring: centre and radius (0 = none)
  uniform float uRingA;        // and the grate's turn
  uniform vec2 uExitY;        // funnel top and bottom rows
  uniform float uExitX;       // funnel centre column
  uniform vec2 uCamC;          // camera centre in world cells (for parallax)
  uniform vec4 uPal[36];       // sprite palette: rgb + emissive strength (32-35: the Sieve's eye)
  uniform vec4 uFx[80];        // energy effects: 5 ramps of 16 hue-shifted shades
  uniform int uNL;
  uniform vec4 uL[${MAXL}];
  uniform vec3 uLC[${MAXL}];
  uniform vec3 uAmb;
  out vec4 outColor;

  vec4 cellAt(ivec2 p) {
    if (p.x < 0 || p.y < 0 || p.x >= int(uWorld.x) || p.y >= int(uWorld.y)) return vec4(1.0 / 255.0, 0.0, 0.0, 1.0);
    return texelFetch(uCells, p, 0);
  }
  float occ(ivec2 p) { return cellAt(p).a; }
  // Smooth occlusion for shadows: half resolution + bilinear = soft, steady edges.
  float occS(vec2 wpos) { return texture(uOcc, wpos / uWorld).r; }
  float so(ivec2 p) { return cellAt(p).a > 0.5 ? 1.0 : 0.0; }

  // Masonry from the stone layout: each stone has its own tone; mortar only
  // between two stones (never on an open face); a lit edge inside the top
  // and left of each stone, a shaded underside and right side.
  float sid(ivec2 p) {
    if (p.x < 0 || p.y < 0 || p.x >= int(uWorld.x) || p.y >= int(uWorld.y)) return -1.0;
    vec4 s = texelFetch(uStone, p, 0);
    return s.a > 0.5 ? floor(s.r * 255.0 + 0.5) + floor(s.g * 255.0 + 0.5) * 256.0 : -1.0;
  }
  // ---- frozen sand patterns (fight-FX session): a facet id per cell for each crystal kind ----
  vec2 frostId(ivec2 p, int k) {
    // art pass: the lattice is bent by a slow noise and shifted per freeze (by where it began), so
    // no two freezes and no two stretches of one freeze lay the same grid
    vec2 q = vec2(p) + floor(fract(uFrostW.xy * 0.137) * 23.0);
    q += floor((vec2(vnoise(q * 0.09 + 3.7), vnoise(q * 0.09 + 11.3)) - 0.5) * 6.0);
    if (k == 1) {                                  // ice bricks: rows 5 high, each row's blocks their own width
      float row = floor(q.y / 5.0), w = 7.0 + floor(h21(vec2(row, 3.0)) * 6.0), off = floor(h21(vec2(row, 7.0)) * w);
      return vec2(floor((q.x + off) / w), row);
    }
    if (k == 2) {                                  // shards radiating from where the frost began, broken at uneven radii
      vec2 d = q - uFrostW.xy; float r = length(d), a = atan(d.y, d.x);
      float jag = (vnoise(vec2(r * 0.22, 4.0)) - 0.5) * 0.55;
      float sec = mod(floor((a + jag) / 6.2832 * 11.0 + 5.5), 11.0);
      float rb = floor((r + h21(vec2(sec, 1.0)) * 9.0) / (7.0 + h21(vec2(sec, 2.0)) * 7.0));
      return vec2(sec, rb);
    }
    if (k == 3) {                                  // crystals: the nearest of jittered seeds on an 8-cell grid
      vec2 c0 = floor(q / 8.0), best = c0; float bd = 1e9;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = c0 + vec2(float(i), float(j)), s = (c + vec2(h21(c + 3.1), h21(c + 8.7)) * 0.9 + 0.05) * 8.0;
        vec2 e = q - s; float dd = e.x * e.x + e.y * e.y * 1.3;
        if (dd < bd) { bd = dd; best = c; }
      }
      return best;
    }
    if (k == 4) {                                  // herringbone: slats 4 wide, leaning opposite ways in 8-cell columns
      float col = floor(q.x / 8.0), dir = mod(col, 2.0) < 1.0 ? 1.0 : -1.0;
      return vec2(col, floor((q.y + dir * q.x) / 4.0));
    }
    vec2 fq = vec2(q.x + q.y * 0.5, q.y - q.x * 0.5);   // lozenge facets
    return floor(fq / 7.0);
  }
  // a star crack where the ice was struck: c = (x, y, length, seed). Returns 2 inside the
  // crushed point, 1 on a crack leg, 0 elsewhere. Legs are jagged, of uneven length, and the
  // longer ones fork once.
  float frostCrack(vec2 q, vec4 c) {
    if (c.z <= 0.0) return 0.0;
    vec2 d = q - c.xy; float r = length(d);
    if (r > c.z + 1.0) return 0.0;
    if (r < 1.5 + c.z * 0.06) return 2.0;
    float a = atan(d.y, d.x);
    for (int i = 0; i < 6; i++) {
      float fi = float(i), len = c.z * (0.45 + 0.55 * h21(vec2(c.w, fi)));
      if (r > len) continue;
      float ak = (fi + h21(vec2(c.w + 2.0, fi)) * 0.7) / 6.0 * 6.2832 + c.w;
      float jag = (vnoise(vec2(r * 0.4, c.w + fi * 7.0)) - 0.5) * 0.9 / max(1.0, r * 0.12);
      float da = abs(mod(a - ak - jag + 3.1416, 6.2832) - 3.1416);
      if (da * r < 0.6) return 1.0;
      float fork = len * 0.55;                                  // a branch splits off past the middle
      if (len > 7.0 && r > fork) { float db = abs(mod(a - ak - 0.45 * (h21(vec2(c.w, fi + 9.0)) < 0.5 ? 1.0 : -1.0) + 3.1416, 6.2832) - 3.1416); if (abs(db * r - (r - fork) * 0.42) < 0.6) return 1.0; }
    }
    return 0.0;
  }
  vec3 masonry(ivec2 ip, vec3 base, float contrast) {
    float me = sid(ip);
    if (me < 0.0) return base;
    vec4 st = texelFetch(uStone, ip, 0);
    float tone = st.b;
    if (st.a < 0.7 && st.a > 0.5) {                                            // a fallen-out stone: a dark recess
      float up = sid(ip + ivec2(0, -1)), dn = sid(ip + ivec2(0, 2));
      if (dn != me) return base * 0.7;                                         // lit lower lip of the hole
      return base * (up != me ? 0.35 : 0.45);
    }
    if (st.a < 0.85 && st.a > 0.7) base = mix(base, lin(vec3(0.33, 0.22, 0.20)), 0.3);   // old brick repair
    vec3 c = base * (0.82 + contrast * tone);
    float u = sid(ip + ivec2(0, -1)), l = sid(ip + ivec2(-1, 0));
    float d = sid(ip + ivec2(0, 1)), r = sid(ip + ivec2(1, 0));
    if ((u >= 0.0 && u != me) || (l >= 0.0 && l != me)) return base * 0.3;     // mortar joint
    float u2 = sid(ip + ivec2(0, -2)), l2 = sid(ip + ivec2(-2, 0));
    if ((u2 >= 0.0 && u2 != me) || (l2 >= 0.0 && l2 != me)) c *= 1.12;          // lit arris
    if ((d >= 0.0 && d != me) || (r >= 0.0 && r != me)) c *= 0.82;              // shaded underside
    if (h21(vec2(ip)) > 0.965) c *= 0.88;                                       // a few chips
    // a crack running through some stones
    if (h21(vec2(me, 11.0)) > 0.85 && abs(mod(float(ip.x) + float(ip.y) * 2.0 + me, 13.0) - 6.0) < 0.5) c *= 0.55;
    return c;
  }
  // Carved stone (art pass, a boss hall: uDeco): every ledge is dressed instead of a bare block.
  // Its top is a capstone course (a lit lip, a paler course with its own joints, a dark groove
  // under it, a brass stud now and then); its underside a moulded lip with dentils; its sides lit
  // on the left and shadowed on the right; free-standing piers are fluted. Shapes are untouched.
  bool isSt(ivec2 p) { int m2 = int(cellAt(p).r * 255.0 + 0.5); return m2 == 1; }
  vec3 carved(ivec2 ip, vec3 c, out float glint) {
    glint = 0.0;
    int up = 9, dn = 9;
    for (int k = 1; k <= 4; k++) { if (!isSt(ip + ivec2(0, -k))) { up = k; break; } }
    for (int k = 1; k <= 4; k++) { if (!isSt(ip + ivec2(0, k))) { dn = k; break; } }
    bool airL = !isSt(ip + ivec2(-1, 0)), airR = !isSt(ip + ivec2(1, 0));
    float x = float(ip.x);
    if (up == 1) {                                                              // the lit lip
      c = c * 1.38 + lin(vec3(0.03, 0.02, 0.01));
      if (mod(x, 11.0) == 5.0) { c = lin(vec3(0.80, 0.62, 0.30)); glint = 0.35; }   // a brass stud
      return c;
    }
    if (up == 2) return mod(x + 3.0, 7.0) == 0.0 ? c * 0.45 : c * 1.16;         // the capstone course, its own joints
    if (up == 3) return c * 0.42;                                               // the groove under it
    if (dn == 1) return mod(floor(x / 2.0), 2.0) == 0.0 ? c * 0.5 : c * 0.95;  // dentils on the underside
    if (dn == 2) return c * 0.55;                                               // the moulding's shadow
    if (airL) return c * 1.22;                                                  // the lit left arris
    if (airR) return c * 0.62;                                                  // the right side in shade
    // fluting on a free-standing pier (air within 10 cells on both sides)
    bool freeL = false, freeR = false;
    for (int k = 2; k <= 10; k += 2) { if (!freeL && !isSt(ip + ivec2(-k, 0))) freeL = true; if (!freeR && !isSt(ip + ivec2(k, 0))) freeR = true; }
    if (freeL && freeR && up > 4 && dn > 3) { float f = mod(x, 5.0); if (f == 0.0) return c * 0.6; if (f == 1.0) return c * 1.12; }
    return c;
  }
  // Moss on the tops of stones open to the air, in uneven clumps.
  vec3 mossy(ivec2 ip, vec3 c) {
    if (so(ip + ivec2(0, -1)) > 0.5 && so(ip + ivec2(0, -2)) > 0.5) return c;  // not near a top surface
    float me = sid(ip);
    float clump = h21(vec2(floor(float(ip.x) / 3.0), me + 5.0));
    if (clump < 0.45) return c;
    int depth = so(ip + ivec2(0, -1)) < 0.5 ? 0 : 1;
    float thick = 1.0 + floor(clump * 2.6);
    if (float(depth) >= thick) return c;
    vec3 moss = h21(vec2(ip)) > 0.5 ? lin(vec3(0.21, 0.27, 0.16)) : lin(vec3(0.15, 0.21, 0.12));
    if (depth == 0 && h21(vec2(ip) + 3.0) > 0.75) moss = lin(vec3(0.27, 0.33, 0.19));   // lit tips
    return moss;
  }

  // Foreground masonry: offset bricks with chipped mortar and grit.
  vec3 brick(vec2 p, vec3 base) {
    float row = floor(p.y / 5.0);
    float off = mod(row, 2.0) * 5.0 + floor(h21(vec2(row, 7.0)) * 4.0);
    float col = floor((p.x + off) / 10.0);
    vec2 l = vec2(mod(p.x + off, 10.0), mod(p.y, 5.0));
    float mortar = (l.x < 1.0 || l.y < 1.0) ? 1.0 : 0.0;
    float bv = h21(vec2(col, row));
    vec3 c = base * (0.82 + 0.3 * floor(bv * 3.0) / 3.0);      // 3 flat brick tones
    float grit = h21(floor(p));
    if (grit > 0.93) c *= 0.82; else if (grit < 0.04) c *= 1.12; // a few chips, no noise
    if (l.y < 2.0 && l.y >= 1.0) c *= 1.08;                      // lit top course of each brick
    return mix(c, base * 0.42, mortar);
  }
  // Back wall architecture: pilasters and a string course (no niches: they
  // competed with the real windows), on a plane that drifts with parallax.
  vec3 backWall(vec2 p);
  vec3 backArch(vec2 wp) {
    vec2 p = wp + (uCamC - wp) * 0.0 + uCamC * -0.12; // back plane moves at 0.88x
    vec3 c = backWall(p);
    float bay = 112.0;
    float bx = mod(p.x, bay);
    float bayId = floor(p.x / bay);
    // pilaster: a lighter stone column with a bevel, every bay
    if (bx < 12.0) {
      vec3 st = lin(vec3(0.27, 0.25, 0.32)) * (0.9 + 0.15 * h21(vec2(floor(p.y / 6.0), bayId)));
      if (bx < 2.0) st *= 1.25; else if (bx > 10.0) st *= 0.6;
      if (mod(p.y, 6.0) < 1.0) st *= 0.75;
      c = st;
    }
    // string course: a projecting ledge every 240 rows with its shadow below
    float sc = mod(p.y, 240.0);
    if (sc < 4.0) c = lin(vec3(0.30, 0.28, 0.34)) * (sc < 1.0 ? 1.3 : 1.0);
    else if (sc < 9.0) c *= 0.55 + 0.09 * (sc - 4.0);
    return c;
  }
  // Far depth seen down into the pits: dark arches and galleries at 0.6x,
  // with a few distant lantern glows deeper still.
  vec3 farDepth(vec2 wp) {
    // A distant arcade seen down in the depths: smaller bricks (distance),
    // columns, round arches with a railing, and lamps far inside. Cooled by
    // the air between, not crushed to black.
    vec2 p = wp + uCamC * -0.4;
    vec3 air = lin(vec3(0.13, 0.13, 0.20));
    vec3 c = backWall(p * 1.7) * 0.75;                  // far masonry, finer
    float bay = 64.0, bx = mod(p.x, bay), by = mod(p.y, 128.0);
    float bayId = floor(p.x / bay) + 31.0 * floor(p.y / 128.0);
    // columns with a lit edge
    if (bx < 8.0) {
      c = lin(vec3(0.20, 0.19, 0.25)) * (0.85 + 0.2 * h21(vec2(floor(p.y / 4.0), bayId)));
      if (bx < 1.5) c *= 1.35; else if (bx > 6.5) c *= 0.6;
    } else {
      // round-arched opening between the columns
      float cx = 36.0, hw = 22.0, top = 28.0, bot = 112.0;
      float dx = abs(bx - cx);
      float archY = top + hw - sqrt(max(0.0, hw * hw - dx * dx));
      if (dx < hw && by > archY && by < bot) {
        c = lin(vec3(0.075, 0.07, 0.11));                // the space beyond
        if (by - archY < 2.0 || dx > hw - 2.0) c = lin(vec3(0.24, 0.22, 0.29)); // arch rim
        if (by > 92.0 && by < 94.0) c = lin(vec3(0.18, 0.17, 0.22));            // railing
        if (by > 94.0 && mod(bx, 6.0) < 1.0) c = lin(vec3(0.15, 0.14, 0.19));    // balusters
        // a lamp somewhere inside some arches
        if (h21(vec2(bayId, 5.0)) > 0.6) {
          vec2 g = vec2(bx - cx, by - 70.0);
          c += lin(vec3(1.0, 0.62, 0.28)) * (0.55 * exp(-dot(g, g) * 0.035) + 0.12 * exp(-dot(g, g) * 0.004));
          if (abs(g.x) < 1.0 && abs(g.y) < 2.0) c = lin(vec3(1.0, 0.8, 0.45));
        }
      }
    }
    // a string course between storeys
    if (by < 3.0) c = lin(vec3(0.22, 0.21, 0.27));
    // far off, someone carries a lantern slowly along a gallery
    vec2 carrier = vec2(mod(uTime * 2.6, 1600.0) - 300.0, 198.0 + sin(uTime * 2.4) * 0.8);
    vec2 cg = p - carrier;
    c += lin(vec3(1.0, 0.62, 0.3)) * (0.5 * exp(-dot(cg, cg) * 0.05) + 0.07 * exp(-dot(cg, cg) * 0.003));
    return mix(c, air, 0.35);
  }
  // Back wall: bigger, darker blocks with water stains running down.
  vec3 backWall(vec2 p) {
    float row = floor(p.y / 9.0);
    float off = mod(row, 2.0) * 9.0;
    float col = floor((p.x + off) / 18.0);
    vec2 l = vec2(mod(p.x + off, 18.0), mod(p.y, 9.0));
    float mortar = (l.x < 1.0 || l.y < 1.0) ? 1.0 : 0.0;
    vec3 base = lin(vec3(0.22, 0.20, 0.27));
    vec3 c = base * (0.88 + 0.24 * floor(h21(vec2(col, row)) * 3.0) / 3.0);
    if (h21(floor(p)) > 0.95) c *= 0.85;
    if (l.y < 2.0 && l.y >= 1.0) c *= 1.06;
    return mix(c, base * 0.55, mortar * 0.8);
  }
  // Night sky, drawn like hand-placed pixel art: hard colour bands,
  // two-tone clouds, a crisp moon. No soft gradients or glow.
  vec3 sky(vec2 wp) {
    vec2 p = floor(wp + uSkyOff);
    float t = clamp((p.y - 30.0) / 170.0, 0.0, 1.0);
    float band = floor(t * 5.0) / 4.0;
    vec3 c = mix(lin(vec3(0.05, 0.065, 0.14)), lin(vec3(0.16, 0.21, 0.29)), band);
    // stars: single pixels, a few blink
    float s = h21(p);
    if (s > 0.994 && t < 0.7) c = lin(vec3(0.75, 0.78, 0.9)) * (s > 0.9985 && fract(uTime * 0.3 + s * 7.0) < 0.15 ? 0.4 : 1.0);
    // moon: hard disc, darker maria, a one-band halo ring
    vec2 mp = floor(vec2(372.0, 76.0) + uSkyOff * 0.8);
    vec2 dm = p - mp;
    float md = length(dm);
    if (md < 11.5 && md >= 8.5) c = mix(c, lin(vec3(0.30, 0.35, 0.48)), 0.35);
    if (md < 8.5) {
      c = lin(vec3(0.86, 0.87, 0.80));
      if (h21(floor((p - mp) / 2.0) + 3.0) > 0.72) c = lin(vec3(0.68, 0.70, 0.66));
      if (dm.x + dm.y > 7.0) c *= 0.82; // shaded lower-right edge
    }
    // clouds: two flat tones, slow drift, they pass in front of the moon
    vec2 cp = vec2(floor((p.x + uTime * 2.0) / 2.0) * 2.0, p.y);
    float cl = vnoise(vec2(cp.x * 0.03, cp.y * 0.11)) * vnoise(vec2(cp.x * 0.011 + 7.0, cp.y * 0.05));
    if (cl > 0.36) c = lin(vec3(0.17, 0.19, 0.27));
    if (cl > 0.45) c = lin(vec3(0.26, 0.28, 0.36));
    // ruined towers and hills, two depths, hard edges
    float hill = floor(158.0 + 16.0 * vnoise(vec2(p.x * 0.02, 1.0)) + 8.0 * vnoise(vec2(p.x * 0.09, 3.0)));
    float tid = floor(p.x / 6.0);
    float tw = step(0.84, h21(vec2(tid, 2.0)));
    float twH = hill - floor(tw * (22.0 + 34.0 * h21(vec2(tid, 9.0))));
    if (p.y > twH) c = lin(vec3(0.07, 0.085, 0.14));
    float near = floor(176.0 + 10.0 * vnoise(vec2(p.x * 0.05 + 40.0, 5.0)));
    if (p.y > near) c = lin(vec3(0.035, 0.04, 0.07));
    return c;
  }
  ${root.SpillCastleGLSL || 'vec3 winSky(vec2 wp) { return sky(wp); } vec4 arcade(vec2 wp, out float a, out float b) { a = 0.0; b = 0.0; return vec4(0.0); } vec3 nave(vec2 wp, float a, float b) { return vec3(0.0); } vec3 windowShafts(vec2 wp) { return vec3(0.0); } vec4 foreground(vec2 wp, bool s) { return vec4(0.0); } vec4 funnelCollar(ivec2 p) { return vec4(-1.0); } vec4 funnelFinial(vec2 p) { return vec4(-1.0); } bool inRing(vec2 p) { return false; } vec3 abyss(vec2 p) { return vec3(0.0); } vec3 sieveFrame(ivec2 p) { return vec3(0.0); }'}

  void main() {
    vec2 fc = floor(gl_FragCoord.xy);
    vec2 wp = uOrigin + vec2(fc.x, uView.y - 1.0 - fc.y);
    ivec2 ip = ivec2(wp);
    vec4 c = cellAt(ip);
    int m = int(c.r * 255.0 + 0.5);
    int bgt = int(c.g * 255.0 + 0.5);
    float gb = c.b * 255.0;
    bool solid = c.a > 0.5;

    vec3 alb = vec3(0.0);
    vec3 emi = vec3(0.0);
    float rough = 1.0;
    bool isSky = false, isBack = false, isFar = false;

    if (m == 0 || m >= 30) {
      if (bgt == 1) {
        isSky = true; emi = inRing(wp) ? abyss(wp) : winSky(wp);
        // Depth: the window is set into a thick wall. Next to the stone frame
        // we see the reveal: lit on the left, in shadow on the right, a dark
        // soffit under the arch; the glass sits back inside it.
        int dl = 0, dr = 0, du = 0;
        for (int k = 1; k <= 3; k++) {
          if (dl == 0 && int(cellAt(ip + ivec2(-k, 0)).g * 255.0 + 0.5) == 3) dl = k;
          if (dr == 0 && int(cellAt(ip + ivec2(k, 0)).g * 255.0 + 0.5) == 3) dr = k;
          if (du == 0 && int(cellAt(ip + ivec2(0, -k)).g * 255.0 + 0.5) == 3) du = k;
        }
        if (du > 0 && du <= 2) { alb = lin(vec3(0.20, 0.18, 0.23)) * (0.8 + 0.1 * float(du)); isSky = false; isBack = true; }
        else if (dl > 0 && dl <= 3) { alb = lin(vec3(0.44, 0.41, 0.46)) * (1.05 - 0.12 * float(dl)) * (0.92 + 0.1 * h21(floor(wp / vec2(1.0, 4.0)))); isSky = false; isBack = true; }
        else if (dr > 0 && dr <= 3) { alb = lin(vec3(0.25, 0.23, 0.28)) * (0.75 + 0.06 * float(dr)) * (0.92 + 0.1 * h21(floor(wp / vec2(1.0, 4.0)))); isSky = false; isBack = true; }
        // leaded glass: a diamond lattice, a few old panes tinted
        // each window has its own glazing: 0 leaded diamonds, 1 plain panes,
        // 2 diamonds with many panes broken out
        if (!isSky) { } else {
        float style = 0.0;
        for (int k = 0; k < 4; k++) { if (k >= uNWin) break; vec4 wn = uWin[k]; if (wp.x >= wn.x && wp.x < wn.x + wn.z && wp.y >= wn.y && wp.y < wn.y + wn.w) style = uWinS[k]; }
        if (style < 0.5 || style > 1.5) {
          float a1 = mod(wp.x + wp.y, 10.0), a2 = mod(wp.x - wp.y + 1000.0, 10.0);
          vec2 pane = vec2(floor((wp.x + wp.y) / 10.0), floor((wp.x - wp.y + 1000.0) / 10.0));
          float ph = h21(pane);
          bool broken = ph < (style > 1.5 ? 0.45 : 0.06);
          if (!broken && ph > 0.8) emi *= vec3(1.08, 1.02, 0.86);
          if (broken) emi *= 1.15;
          else if (a1 < 1.0 || a2 < 1.0) emi = mix(emi, lin(vec3(0.07, 0.07, 0.09)), 0.75);
        } else {
          if (mod(wp.y, 16.0) < 1.0) emi = mix(emi, lin(vec3(0.07, 0.07, 0.09)), 0.7);  // plain panes: glazing bars
          if (h21(vec2(floor(wp.x / 12.0), floor(wp.y / 16.0))) > 0.7) emi *= vec3(1.05, 1.03, 0.92);
        }
        }
      }
      else if (bgt == 3) { alb = inRing(wp) ? sieveFrame(ip) : masonry(ip, lin(vec3(0.40, 0.37, 0.42)), 0.55); isBack = true; }
      else {
        // the castle's arcade in the back wall: architecture, or an opening onto the nave beyond
        float aYa, aYb;
        vec4 arc = bgt == 0 ? arcade(wp, aYa, aYb) : vec4(0.0);
        alb = masonry(ip, lin(vec3(0.22, 0.20, 0.27)), 0.26); isBack = true;
        if (arc.a > 1.5) { emi = nave(wp, aYb, aYa); alb = lin(vec3(0.05, 0.05, 0.07)); isFar = true; }
        else if (arc.a > 0.5) alb = arc.rgb;
        if (!isFar) {
        // old plaster still clinging to a few stones: it covers most of the
        // stone but crumbles away at its edges, pixel by pixel
        float me = sid(ip);
        if (me >= 0.0 && arc.a < 0.5 && h21(vec2(me, 41.0)) > 0.9) {
          bool edge = sid(ip + ivec2(0, -1)) != me || sid(ip + ivec2(-1, 0)) != me || sid(ip + ivec2(0, 1)) != me || sid(ip + ivec2(1, 0)) != me
                   || sid(ip + ivec2(0, -2)) != me || sid(ip + ivec2(2, 0)) != me;
          if (!edge || h21(wp) > 0.55) {
            alb = mix(alb, lin(vec3(0.27, 0.25, 0.28)), 0.7) * (0.96 + 0.06 * h21(floor(wp / 2.0)));
            if (h21(wp + 3.0) > 0.97) alb *= 0.8;
          }
        }
        // damp creeping up from the floor, uneven top edge, a little green
        float dampTop = uFloorY - 26.0 - 14.0 * vnoise(vec2(wp.x * 0.05, 3.0)) - 4.0 * h21(vec2(floor(wp.x / 3.0), 1.0));
        if (uFloorY > 0.0 && wp.y > dampTop) alb *= mix(vec3(1.0), vec3(0.62, 0.7, 0.62), clamp((wp.y - dampTop) / 18.0, 0.0, 1.0));
        // years of rain: dark streaks running down from each window sill
        for (int k = 0; k < 4; k++) {
          if (k >= uNWin) break;
          vec4 wn = uWin[k];
          float sillB = wn.y + wn.w + 5.0;
          if (wp.x >= wn.x - 9.0 && wp.x < wn.x + wn.z + 9.0 && wp.y >= sillB) {
            float col = floor(wp.x / 2.0);
            float len = 8.0 + 46.0 * h21(vec2(col, 21.0));
            if (h21(vec2(col, 9.0)) > 0.42 && wp.y < sillB + len) alb *= mix(0.78, 0.96, (wp.y - sillB) / len);
          }
        }
        }
      }
      if (m == 30) { alb = lin(vec3(0.16, 0.15, 0.17)) * (mod(wp.y, 2.0) < 1.0 ? 1.0 : 0.55); isBack = false; isSky = false; }
      if (m == 31) {
        float f = 0.85 + 0.15 * sin(uTime * 13.0 + wp.x) * sin(uTime * 7.3);
        emi = lin(vec3(1.0, 0.72, 0.36)) * 3.2 * f; alb = vec3(0.0); isBack = false; isSky = false;
      }
      if (m == 40) { alb = lin(vec3(0.85, 0.72, 0.52)); isBack = false; isSky = false; }
      if (m == 32 || m == 39) { alb = lin(m == 32 ? vec3(0.30, 0.28, 0.32) : vec3(0.21, 0.20, 0.24)) * (0.8 + 0.35 * h21(wp)); isBack = false; isSky = false; } // rubble
      if (m == 33 || m == 37 || m == 38) {                                                                              // ivy: deep, young, dead
        vec3 a = m == 33 ? vec3(0.15, 0.22, 0.13) : m == 37 ? vec3(0.22, 0.27, 0.14) : vec3(0.24, 0.19, 0.13);
        alb = lin(a) * (0.8 + 0.35 * h21(wp));
        alb *= 0.93 + 0.1 * sin(uTime * 1.1 + wp.y * 0.35 + wp.x * 0.8);   // leaves stirring in the draft
        isBack = false; isSky = false;
      }
      if (m == 34) { alb = mix(alb, lin(vec3(0.55, 0.55, 0.6)), 0.3); }                                                  // cobweb strand
      if (m == 35) { alb = lin(vec3(0.44, 0.38, 0.30)) * (0.85 + 0.25 * h21(wp)); isBack = false; isSky = false; }      // old pooled sand, dull
      if (m == 36) { alb = h21(wp) > 0.6 ? lin(vec3(0.24, 0.17, 0.12)) : lin(vec3(0.17, 0.12, 0.09)); isBack = false; isSky = false; } // roots
    } else if (m == 1) {
      alb = mossy(ip, masonry(ip, lin(vec3(0.50, 0.44, 0.42)), 0.34));
      if (uDeco > 0.5) { float gl2; alb = carved(ip, alb, gl2); emi += alb * gl2 + alb * 0.16; }   // a boss hall: dressed stone, its faces faintly lit so the carving reads (not dark boxes)
      { vec4 fc2 = funnelCollar(ip); if (fc2.a >= 0.0) { alb = fc2.rgb; emi = fc2.rgb * fc2.a; rough = 0.4; } }   // the funnel's bronze collar
    } else if (m == 8) {
      float vein = smoothstep(0.55, 0.6, vnoise(wp * vec2(0.15, 0.35) + vec2(vnoise(wp * 0.05) * 4.0)));
      alb = mix(lin(vec3(0.78, 0.84, 0.86)), lin(vec3(0.52, 0.60, 0.66)), vein);
      rough = 0.3;
    } else if (m == 4) {
      alb = lin(vec3(0.55, 0.80, 0.85)) * (0.8 + 0.3 * h21(wp));
      emi = lin(vec3(0.25, 0.45, 0.55)) * 0.25;
      rough = 0.2;
    } else if (m == 5) {
      // old iron spikes, shaded as little cones in flat hand-picked steps:
      // across each row of a tooth the tone steps from a warm lit side and a
      // bright ridge, through mid iron, into a stepped shadow side; the base
      // darkens where it meets the floor, the point is pale worn metal. A low
      // steady glow keeps them readable in the dark. Only tall teeth keep a
      // faint violet in their deepest shadow.
      int dl = 0, dr = 0;                                    // cells of iron to the left / right in this row
      for (int k = 1; k <= 6; k++) { if (int(cellAt(ip + ivec2(-k, 0)).r * 255.0 + 0.5) != 5) break; dl++; }
      for (int k = 1; k <= 6; k++) { if (int(cellAt(ip + ivec2(k, 0)).r * 255.0 + 0.5) != 5) break; dr++; }
      int up = 0, dn = 0;                                    // iron above / below in this column
      for (int k = 1; k <= 9; k++) { if (int(cellAt(ip + ivec2(0, -k)).r * 255.0 + 0.5) != 5) break; up++; }
      for (int k = 1; k <= 9; k++) { if (int(cellAt(ip + ivec2(0, k)).r * 255.0 + 0.5) != 5) break; dn++; }
      bool sUL = int(cellAt(ip + ivec2(-1, -1)).r * 255.0 + 0.5) == 5;
      bool sUR = int(cellAt(ip + ivec2(1, -1)).r * 255.0 + 0.5) == 5;
      bool peak = up == 0 && !sUL && !sUR;                   // the very point of a tooth
      bool tall = up + dn + 1 >= 7;
      // where this pixel sits across the tooth: 0 = left edge, 1 = right edge
      float t = (float(dl) + 0.5) / float(dl + dr + 1);
      vec3 sb;
      if (dr == 0)       sb = tall ? vec3(0.13, 0.11, 0.19) : vec3(0.11, 0.13, 0.17);  // core shadow edge
      else if (dl == 0)  sb = vec3(0.60, 0.50, 0.39);                                  // warm lit edge
      else if (dl == 1 && t < 0.5) sb = vec3(0.74, 0.68, 0.58);                        // bright ridge
      else if (t < 0.5)  sb = vec3(0.44, 0.45, 0.48);                                  // lit iron
      else if (t < 0.75) sb = vec3(0.30, 0.33, 0.39);                                  // mid iron
      else               sb = tall ? vec3(0.21, 0.20, 0.28) : vec3(0.20, 0.22, 0.28);  // turning into shadow
      if (up == 0 && dr > 0) sb = mix(sb, vec3(0.80, 0.77, 0.70), 0.5);                // top edges catch light
      if (peak) sb = vec3(0.90, 0.87, 0.80);                                           // pale worn point
      if (dn == 0) sb *= 0.70;                                                         // stepped shade at the base
      else if (dn == 1) sb *= 0.85;
      float sp = h21(wp * vec2(1.7, 2.3));
      if (sp > 0.95 && !peak && dr > 0) sb = mix(sb, vec3(0.45, 0.30, 0.22), 0.6);     // a rare fleck of old rust
      sb *= 0.93 + 0.05 * floor(sp * 3.0);                   // stepped speckle: 0.93 / 0.98 / 1.03
      alb = lin(sb);
      emi = alb * (peak ? 0.40 : 0.18);
      // a faint warm glint that visits each tooth now and then, on or off
      float tooth = h21(vec2(floor(wp.x / 8.0), 3.0));
      float gl = step(0.93, sin(uTime * 0.7 + tooth * 6.283));
      if (peak) emi += lin(vec3(0.95, 0.78, 0.52)) * 0.25 * gl;
      rough = 0.35;
    } else if (m == 6) {
      // its rim: wherever the funnel meets anything else, a worn bronze lip, lit at the mouth
      // and on the left, shadowed on the right and underneath, so it never floats unframed
      bool eU = int(cellAt(ip + ivec2(0, -1)).r * 255.0 + 0.5) != 6, eD = int(cellAt(ip + ivec2(0, 1)).r * 255.0 + 0.5) != 6;
      bool eL = int(cellAt(ip + ivec2(-1, 0)).r * 255.0 + 0.5) != 6, eR = int(cellAt(ip + ivec2(1, 0)).r * 255.0 + 0.5) != 6;
      bool rim = eU || eD || eL || eR;
      float flow = sin(uTime * 4.0 - wp.y * 0.9 + sin(wp.x * 0.4) * 2.0);
      // The funnel is a pool of light that fills from the bottom up as you
      // save sand. Its surface ripples (harder when a grain lands), light
      // shimmers and glints drift upward inside, and a bright edge of foam
      // runs along the surface. Above the line: dark amber glass.
      float span = max(1.0, uExitY.y - uExitY.x + 1.0);
      // the surface sloshes gently in two waves; a grain landing makes it slap harder for a moment
      float wave = sin(wp.x * 0.55 + uTime * 1.8) * (0.45 + uExitPulse * 1.8)
                 + sin(wp.x * 0.21 - uTime * 1.1) * 0.55;
      float level = uExitY.y + 1.0 - uProg * span + (uEnough > 0.5 ? -99.0 : wave);
      float depthIn = wp.y - level;                       // how far below the surface
      if (depthIn >= 0.0) {
        float breathe = uEnough * (0.5 + 0.5 * sin(uTime * 1.6));
        float shimmer = 0.5 + 0.5 * sin(wp.y * 0.9 + uTime * 3.4 + sin(wp.x * 0.35 + uTime * 1.3) * 2.0);
        float glint = step(0.965, h21(vec2(wp.x, floor(wp.y + uTime * 7.0))));   // rising sparks
        vec3 gold = lin(vec3(1.0, 0.72, 0.34));
        emi = gold * (1.05 + 0.35 * shimmer + uExitPulse * 1.2 + breathe * 0.5 + uHover * 0.9);
        emi += lin(vec3(1.0, 0.9, 0.7)) * glint * 0.9;
        if (uEnough > 0.5) {
          // lit: a full gold with a three-armed swirl turning through it in three stepped
          // tones, and every couple of seconds a bright wave pushes OUT from the middle to the
          // rim (outward, so it reads as power leaving it, never sucking in). No bright core.
          vec2 c = vec2(uExitX, (uExitY.x + uExitY.y) * 0.5);
          vec2 q = floor(wp) + 0.5 - c;
          float r = length(vec2(q.x, q.y * 1.6));
          float ang = atan(q.y * 1.6, q.x);
          float spiral = sin(ang * 3.0 + r * 0.35 - uTime * 0.8);
          float lv = floor((0.5 + 0.5 * spiral) * 3.0) / 3.0;                 // three steps
          float wr = fract(uTime * 0.42) * 22.0;                               // the wave's radius, outward
          float wave2 = step(abs(r - wr), 1.3) * (1.0 - wr / 22.0);
          emi = gold * (0.95 + 0.5 * lv + breathe * 0.3 + wave2 * 0.9);
          if (wave2 > 0.0 && h21(floor(wp) + floor(uTime * 6.0)) > 0.7) emi = lin(vec3(1.0, 0.95, 0.8)) * (1.6 + wave2);   // the wave's crest sparkles
          emi += lin(vec3(1.0, 0.9, 0.7)) * glint * 0.35;
        }
        if (uEnough < 0.5 && depthIn < 3.0) emi *= 1.18;                         // a brighter band just under the surface
        if (uEnough < 0.5 && depthIn < 1.0) {
          emi = lin(vec3(1.0, 0.92, 0.72)) * (1.6 + uExitPulse);                 // the bright surface edge
          if (h21(vec2(floor(wp.x + uTime * 2.0), 7.0)) > 0.82) emi *= 1.3;        // flecks of foam
        }
      } else {
        alb = lin(vec3(0.42, 0.28, 0.12));
        emi = lin(vec3(0.55, 0.32, 0.1)) * (0.14 + 0.06 * sin(uTime * 1.2 + wp.x * 0.2)); // unlit glass, faint
        // a grain landing throws a few droplets up off the surface
        if (uExitPulse > 0.05 && depthIn > -4.0 && h21(vec2(floor(wp.x), floor(uTime * 9.0) + floor(-depthIn))) > 0.94 - uExitPulse * 0.1)
          emi = lin(vec3(1.0, 0.85, 0.55)) * 1.4;
      }
      if (rim) {
        vec3 rc = eU ? vec3(0.78, 0.56, 0.30) : eL ? vec3(0.56, 0.36, 0.18) : eR ? vec3(0.30, 0.19, 0.10) : vec3(0.24, 0.15, 0.08);
        if (h21(floor(wp) * 1.7) > 0.86) rc *= 0.82;                                     // worn in places
        alb = lin(rc); emi = lin(rc) * 0.08;
        // lit: the lip catches the light inside and glows with it, brightening as each wave reaches it
        if (uEnough > 0.5) emi = lin(vec3(1.0, 0.7, 0.32)) * (0.55 + 0.45 * smoothstep(0.75, 1.0, fract(uTime * 0.42)) + (eU ? 0.25 : 0.0));
      }
    } else if (m == 9) {
      // still sand: someone else's time. Real grains in three cold tones,
      // a lighter crust where the surface catches light, and now and then a
      // single grain glints, slowly, as if remembering.
      float gr = h21(wp);
      vec3 st = gr < 0.45 ? vec3(0.50, 0.51, 0.56) : gr < 0.8 ? vec3(0.44, 0.45, 0.51) : vec3(0.58, 0.58, 0.62);
      if (cellAt(ip + ivec2(0, -1)).a < 0.5) st *= 1.12;
      alb = lin(st);
      float gl = h21(wp + 17.0);
      if (gl > 0.992) emi = lin(vec3(0.75, 0.8, 0.95)) * 0.5 * max(0.0, sin(uTime * 0.8 + gl * 60.0));
    } else if (m == 20 || m == 21) {
      int tint = int(gb) / 64;
      float spd = mod(gb, 64.0) / 10.0;
      vec3 sand = tint == 0 ? vec3(0.86, 0.66, 0.38) : tint == 1 ? vec3(0.93, 0.76, 0.48) : tint == 2 ? vec3(0.78, 0.56, 0.31) : vec3(0.96, 0.84, 0.60);
      alb = lin(sand);
      if (spd > 2.5) emi += lin(vec3(1.0, 0.85, 0.6)) * 0.12 * (spd - 2.5);
      if (m == 21) {
        // frozen: the sand held in ice (fight-FX session). Each freeze grows its own crystal
        // pattern (uFrostK): lozenge facets, ice bricks in rows of uneven blocks, shards radiating
        // from where the frost began, irregular crystals, herringbone slats. Facets take three cold
        // tones lit from the upper left; some carry a striation or a trapped grain; the seams are
        // exactly one pixel (where a facet meets the next). The wave's edge burns white as it passes.
        // Cracks: along the seams as the hold runs out or the shield is worn (uFrostW.w), and star
        // cracks with jagged, branching legs where it was struck (uCrack).
        // Art pass: the frost takes the sand grain by grain. uFrostW.z is how far the crystal has
        // crept from the seed (it creeps ~1 cell a frame, slower than the sim's catch); each grain
        // locks at its own moment (distance plus its own delay), so the edge is a scatter of single
        // grains turning, never a front. A grain that has not turned yet is sand gone still and a
        // little cold; as it turns it takes a pale frost tint for a few frames, then settles into
        // the facet it belongs to. No sweeping glint, no glow: a faint cold rim on the lit edges.
        vec2 q = vec2(ip);
        float lockAt = length(q - uFrostW.xy) + h21(q + 31.0) * 9.0 + h21(q * 0.5 + 7.0) * 3.0;
        float age = uFrostW.z < 0.0 ? 99.0 : uFrostW.z - lockAt;
        vec2 fid = frostId(ip, uFrostK), fidR = frostId(ip + ivec2(1, 0), uFrostK), fidD = frostId(ip + ivec2(0, 1), uFrostK);
        bool seam = fid != fidR || fid != fidD;
        float fh = h21(fid + 17.0 + float(uFrostK) * 13.0), fh2 = h21(fid + 61.0);
        vec3 tone = fh < 0.34 ? vec3(0.44, 0.55, 0.68) : fh < 0.72 ? vec3(0.32, 0.41, 0.57) : vec3(0.22, 0.27, 0.43);   // kept dark: your own warm light falls on it
        vec3 ice = mix(sand * vec3(0.62, 0.70, 0.86), tone, 0.74);                                     // the grain shows through its frost
        if (!seam && fh2 > 0.8 && mod(q.x - q.y + floor(fh2 * 7.0), 5.0) < 1.0) ice = mix(ice, vec3(0.56, 0.68, 0.80), 0.35);   // a striation
        if (seam) ice = mix(ice, vec3(0.58, 0.70, 0.82), 0.5);
        bool rimU = int(cellAt(ip + ivec2(0, -1)).r * 255.0 + 0.5) != 21, rimL = int(cellAt(ip + ivec2(-1, 0)).r * 255.0 + 0.5) != 21;
        bool rimD = int(cellAt(ip + ivec2(0, 1)).r * 255.0 + 0.5) != 21, rimR = int(cellAt(ip + ivec2(1, 0)).r * 255.0 + 0.5) != 21;
        if (rimU || rimL) ice = vec3(0.68, 0.80, 0.90);
        else if (rimD || rimR) ice = mix(ice, vec3(0.22, 0.27, 0.42), 0.6);
        float stress = max((uFrost - 0.5) * 1.6, uFrostW.w * 1.15);
        bool crack = seam && stress > 0.0 && h21(fid * 1.7 + (fid != fidR ? 3.0 : 9.0)) < stress;
        float hitC = 0.0;
        for (int k = 0; k < 4; k++) { float c = frostCrack(q, uCrack[k]); hitC = max(hitC, c); }
        if (hitC > 1.5) { ice = vec3(0.86, 0.94, 1.0); crack = false; }                                 // crushed white at the point of the blow
        else if (hitC > 0.5) crack = true;
        if (crack) ice = vec3(0.12, 0.13, 0.22);
        // a facet now and then holds a single still glint pixel, breathing slowly (never a sweep)
        float gl = (!seam && h21(q + 91.0) > 0.994) ? 0.5 + 0.5 * sin(uTime * 1.3 + h21(q) * 40.0) : 0.0;
        alb = lin(ice);
        emi = lin(vec3(0.45, 0.66, 0.82)) * (0.03 + ((rimU || rimL) ? 0.1 : 0.0) + gl * 0.25);
        if (hitC > 1.5) emi = lin(vec3(0.75, 0.9, 1.0)) * 0.45;
        if (crack) emi = vec3(0.0);
        if (age < 0.0) {                                   // locked, not yet turned: still sand, a touch cold
          alb = lin(mix(sand, vec3(0.62, 0.74, 0.88), 0.42)); emi = lin(vec3(0.5, 0.7, 0.9)) * 0.04;   // tinted from the first frame (the press must read at once)
        } else if (age < 4.0 && !crack) {                  // turning: a short sharp pale pulse, cooling into its facet
          float k = 1.0 - age / 4.0;
          alb = mix(alb, lin(vec3(0.84, 0.93, 1.0)), k * 0.8); emi += lin(vec3(0.6, 0.82, 1.0)) * k * 0.22;
        }
        if (uFrost > 0.85 && (rimU || rimL)) emi *= 0.6 + 0.4 * step(0.5, fract(uTime * 2.5));   // about to give: the rim winks, slowly
        rough = 0.85;                                   // flat facets: no broad sheen washing them out
      }
    }

    if (m == 0) { vec4 ff2 = funnelFinial(wp); if (ff2.a >= 0.0) { alb = ff2.rgb; emi = ff2.rgb * ff2.a; isBack = false; isSky = false; isFar = false; } }   // its finials
    // Hand-drawn props (lamps etc.): palette colour, some entries glow.
    if (m == 50) {
      vec4 pc = uPal[int(gb + 0.5)];
      alb = lin(pc.rgb); emi = lin(pc.rgb) * pc.a; isBack = false; isSky = false;
    }
    if (m == 51) {
      vec4 pc = uFx[int(gb + 0.5)];
      alb = lin(pc.rgb); emi = lin(pc.rgb) * pc.a; isBack = false; isSky = false;
    }

    // 2.5D: every wall has thickness receding up and to the right. An empty
    // pixel shows the top face or right face of the block in front of it.
    int face = 0; float fk = 0.0; int fm = 0;
    if (!solid && (m == 0 || m == 30) ) {
      for (int k = 1; k <= 2; k++) {
        ivec2 q = ip + ivec2(-k, k);
        vec4 cq = cellAt(q);
        int mq = int(cq.r * 255.0 + 0.5);
        if (cq.a > 0.5 && (mq == 1 || mq == 8)) {
          face = cellAt(q + ivec2(0, -1)).a < 0.5 ? 1 : 2;
          fk = float(k); fm = mq; break;
        }
      }
    }
    if (face > 0) {
      vec2 q = wp + vec2(-fk, fk);
      vec3 base = fm == 8 ? lin(vec3(0.70, 0.76, 0.80)) : fm == 9 ? lin(vec3(0.46, 0.47, 0.52)) : fm == 4 ? lin(vec3(0.5, 0.7, 0.75)) : lin(vec3(0.46, 0.40, 0.38));
      if (face == 1) {
        // top face: worn flagstones running back, a dusty lip at the front
        float seam = step(mod(q.x + floor(fk) * 3.0, 9.0), 0.9);
        alb = base * (0.95 + 0.15 * h21(floor(q / vec2(3.0, 1.0)))) * (1.0 - 0.25 * seam);
        if (fk < 1.5) alb = mix(alb, lin(vec3(0.72, 0.62, 0.50)), 0.4);
      } else {
        alb = masonry(ivec2(q), base, 0.3) * 0.42; // side face in shadow
      }
      alb *= 0.92;
      isBack = false; isSky = false;
    }

    // Surface normal from the solid mask, so edges read as bevelled.
    vec3 n = vec3(0.0, 0.0, 1.0);
    float depth = 0.0;
    if (solid) {
      float l1 = so(ip + ivec2(-1, 0)), r1 = so(ip + ivec2(1, 0)), u1 = so(ip + ivec2(0, -1)), d1 = so(ip + ivec2(0, 1));
      float l2 = so(ip + ivec2(-2, 0)), r2 = so(ip + ivec2(2, 0)), u2 = so(ip + ivec2(0, -2)), d2 = so(ip + ivec2(0, 2));
      vec2 g = vec2((l1 + l2 * 0.5) - (r1 + r2 * 0.5), (u1 + u2 * 0.5) - (d1 + d2 * 0.5));
      n = normalize(vec3(g, 1.1));
      depth = 0.0;
      for (int k = 0; k < 8; k++) {
        float a = float(k) * 0.785398;
        depth += so(ip + ivec2(round(vec2(cos(a), sin(a)) * 4.0)));
      }
      depth /= 8.0;
    }
    // Ambient occlusion around solids (contact shadows on the back wall).
    float ao = 1.0;
    if (!solid) {
      float s = 0.0;
      for (int k = 0; k < 8; k++) {
        float a = float(k) * 0.785398 + 0.39;
        s += occS(wp + 0.5 + vec2(cos(a), sin(a)) * 2.5);
        s += occS(wp + 0.5 + vec2(cos(a), sin(a)) * 6.0) * 0.6;
      }
      ao = 1.0 - clamp(s / 12.8, 0.0, 1.0) * 0.75;
    }

    vec3 amb = uAmb * ao * (solid ? (1.0 - depth * 0.45) : 1.0);
    vec3 lightSum = amb;
    vec3 spec = vec3(0.0);
    for (int k = 0; k < ${MAXL}; k++) {
      if (k >= uNL) break;
      vec2 lp = uL[k].xy;
      float rad = uL[k].z;
      vec2 d = lp - (wp + 0.5);
      float dist = length(d);
      if (dist > rad) continue;
      float att = 1.0 - dist / rad; att *= att;
      vec2 dir = d / max(dist, 0.001);
      // March toward the light through the occupancy grid.
      float steps = min(dist / 1.5, 40.0);
      float stepLen = dist / max(steps, 1.0);
      float skip = solid ? 3.0 : 1.0;
      float T = 1.0;
      for (float t = 1.0; t < 40.0; t += 1.0) {
        if (t >= steps) break;
        float s = t * stepLen;
        if (s < skip) continue;
        T *= 1.0 - occS(wp + 0.5 + dir * s) * 0.42;
        if (T < 0.03) break;
      }
      T = smoothstep(0.0, 1.0, T);
      float lam;
      if (solid) {
        vec3 L = normalize(vec3(dir, 0.55));
        lam = max(0.0, dot(n, L)) * 1.25 + 0.05;
        vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
        spec += uLC[k] * att * T * pow(max(0.0, dot(n, H)), mix(8.0, 40.0, 1.0 - rough)) * (1.0 - rough) * 0.6;
      } else lam = isBack ? 0.38 : face == 1 ? 0.9 : face == 2 ? 0.45 : 1.0;
      lightSum += uLC[k] * att * T * lam;
    }

    // Dust settles on upward faces: a pale lip on every ledge.
    if (solid && (m == 1 || m == 8) && n.y < -0.45 && so(ip + ivec2(0, -1)) < 0.5) alb = mix(alb, lin(vec3(0.72, 0.62, 0.50)), 0.55);
    // Deep inside walls the stone falls into shadow, so masses read as solid.
    if (solid && m != 20 && m != 21) alb *= 1.0 - depth * 0.3;
    // Light falls off in bands with a 4x4 ordered dither, like hand-pixeled
    // lighting, instead of a smooth photographic gradient.
    {
      ivec2 bp = ip & 3;
      int bi = bp.x + bp.y * 4;
      float bay = float(int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5)[bi]) / 16.0 - 0.5;
      vec3 Lq = lightSum * 5.0;
      lightSum = floor(Lq + 0.5 + bay * 0.45) / 5.0;
    }
    vec3 col = isSky ? emi : alb * lightSum + emi + spec;
    vec3 direct = max(lightSum - amb, 0.0);

    if (!solid && !isSky) {
      // A light haze in the air, kept faint so shafts stay calm.
      col += direct * 0.03;
      col += windowShafts(wp);                       // moonlight falling in from the windows
    }
    // Sparkle on lit, moving sand.
    if (m == 20 && h21(wp + floor(uTime * 6.0)) > 0.996) col += direct * 0.5;

    // Deep inside thick walls the stone settles into a quiet dark tone.
    if (solid && m != 20 && m != 21) {
      float deep = 0.0;
      for (int k = 0; k < 6; k++) { float a = float(k) * 1.047; deep += occS(wp + vec2(cos(a), sin(a)) * 11.0); }
      deep /= 6.0;
      col = mix(col, lin(vec3(0.05, 0.045, 0.07)), smoothstep(0.85, 1.0, deep) * 0.3);
    }
    // Going down, the back wall gives way gradually to the far depths of the
    // tower (galleries, distant lamps): no hard edge, a dithered descent.
    if (isBack && uFogY > 0.0) {
      ivec2 bq = ip & 3;
      float bay2 = float(int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5)[bq.x + bq.y * 4]) / 16.0;
      float td = smoothstep(uFogY - 110.0, uFogY + 20.0, wp.y);
      td = floor(td * 6.0 + bay2) / 6.0;
      col = mix(col, farDepth(wp) * (0.35 + 0.65 * ao), clamp(td, 0.0, 0.9));
    }
    // A thin, faint haze just above the spikes so the pit has depth;
    // the spikes stay readable through it.
    if (uFogY > 0.0) {
      float fd = smoothstep(uFogY - 16.0, uFogY, wp.y);
      float fn = vnoise(vec2(wp.x * 0.03 + uTime * 0.1, wp.y * 0.1));
      col = mix(col, lin(vec3(0.11, 0.10, 0.15)) + direct * 0.1, fd * 0.14 * (0.6 + 0.4 * fn));
    }
    // the near plane: chains over the air, silhouettes over the floor's stone; never over
    // your sand, creatures, energy or anything that warns
    if (m != 20 && m != 21 && m != 50 && m != 51 && m != 9 && m != 6) {
      vec4 fg = foreground(wp, solid && m == 1);
      if (fg.a > 0.5) col = fg.rgb;
    }

    outColor = vec4(col, 1.0);
  }`;

  // ---------- bloom ----------
  const FS_BRIGHT = COMMON + `
  uniform sampler2D uSrc; uniform vec2 uTexel;
  out vec4 outColor;
  void main() {
    vec2 uv = gl_FragCoord.xy * uTexel;
    vec3 c = texture(uSrc, uv).rgb;
    float l = max(c.r, max(c.g, c.b));
    outColor = vec4(c * smoothstep(0.7, 1.6, l), 1.0);
  }`;
  const FS_BLUR = COMMON + `
  uniform sampler2D uSrc; uniform vec2 uTexel; uniform vec2 uDir;
  out vec4 outColor;
  void main() {
    vec2 uv = gl_FragCoord.xy * uTexel;
    vec3 c = texture(uSrc, uv).rgb * 0.227;
    c += texture(uSrc, uv + uDir * uTexel * 1.385).rgb * 0.316;
    c += texture(uSrc, uv - uDir * uTexel * 1.385).rgb * 0.316;
    c += texture(uSrc, uv + uDir * uTexel * 3.231).rgb * 0.070;
    c += texture(uSrc, uv - uDir * uTexel * 3.231).rgb * 0.070;
    outColor = vec4(c, 1.0);
  }`;

  // ---------- composite ----------
  const FS_COMP = COMMON + `
  uniform sampler2D uHdr, uBloomA, uBloomB;
  uniform vec2 uView, uFrac, uScreen;
  uniform float uScale, uTime, uFade, uFlash;
  // fight lens (fightfx.js): world origin of the view, punch-in, shock fronts, colour split, impact frame, tension
  uniform vec2 uOrg, uPC;
  uniform float uPunch, uFringe, uImpact, uTension;
  uniform vec4 uWave[3];
  uniform int uNW;
  out vec4 outColor;
  vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  // Sharp-bilinear: crisp pixels that stay stable at fractional zoom.
  vec3 fetch(vec2 t) {
    vec2 tt = vec2(t.x, uView.y - t.y);
    vec2 i = floor(tt - 0.5), f = fract(tt - 0.5);
    f = clamp((f - 0.5) * uScale + 0.5, 0.0, 1.0);
    return texture(uHdr, (i + 0.5 + f) / uView).rgb;
  }
  void main() {
    vec2 sTop = vec2(gl_FragCoord.x, uScreen.y - gl_FragCoord.y);
    vec2 t = vec2(1.0) + uFrac + sTop / uScale; // texel in view (top-left origin)
    vec2 ndc = (gl_FragCoord.xy / uScreen) * 2.0 - 1.0;
    float r = length(ndc * vec2(uScreen.x / uScreen.y, 1.0)) / 1.6;
    // the lens: a punch-in toward the impact, and shock fronts that bend the picture outward as they pass
    vec2 w = uOrg + t;
    if (uPunch > 0.0005) w = uPC + (w - uPC) / (1.0 + uPunch);
    float shockLit = 0.0;
    for (int k = 0; k < 3; k++) {
      if (k >= uNW) break;
      vec4 sw = uWave[k];
      vec2 v = w - sw.xy; float d = length(v * vec2(1.0, 1.25));
      float band = 1.0 - abs(d - sw.z) / 8.0;
      if (band > 0.0 && d > 0.5) { float a = sw.w * band * band; w -= v / max(d, 0.5) * a * 2.4; shockLit += a; }
    }
    t = w - uOrg;
    vec3 c = fetch(t);
    if (uFringe > 0.02) {                                      // split colour, outward from the impact
      vec2 fd = normalize(w - uPC + vec2(0.001)) * uFringe * 0.75;
      c.r = fetch(t + fd).r; c.b = fetch(t - fd).b;
    }
    c *= 1.0 + min(shockLit, 1.5) * 0.12;
    vec2 buv = vec2(t.x / uView.x, 1.0 - t.y / uView.y);
    c += texture(uBloomA, buv).rgb * 0.1 + texture(uBloomB, buv).rgb * 0.05;
    c *= 1.15;
    c = aces(c);
    // grade: cool shadows, warm highlights
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= mix(vec3(0.86, 0.95, 1.12), vec3(1.06, 1.0, 0.9), smoothstep(0.05, 0.6, l));
    c = mix(vec3(l), c, 1.08);
    // Gentle vignette with a barely-there slow shimmer at the frame.
    vec2 sp = gl_FragCoord.xy / uScreen;
    float sh = vnoise(sp * vec2(4.0, 3.0) + vec2(uTime * 0.03, -uTime * 0.02));
    c *= 1.0 - 0.24 * smoothstep(0.6, 1.25, r + (sh - 0.5) * 0.08);
    c = pow(max(c, 0.0), vec3(1.0 / 2.2));
    // Matte finish: lifted blacks, softened highlights, a touch less colour,
    // and grain on the art-pixel grid (changes slowly, like film, not static).
    c = mix(vec3(0.045, 0.04, 0.055), vec3(0.93, 0.91, 0.87), c);
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(lum), c, 0.88);
    vec2 gp = floor((gl_FragCoord.xy) / max(1.0, floor(uScale * 0.5)));
    float grain = h21(gp + floor(uTime * 12.0) * 17.0) - 0.5;
    c += grain * 0.045 * (0.6 + 0.4 * (1.0 - lum));
    // a Warden winding up: colour drains a little and the frame closes in, so the telegraph is what you look at
    if (uTension > 0.01) {
      float tl = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(tl) * vec3(0.95, 0.95, 1.05), 0.28 * uTension);
      c *= 1.0 - 0.22 * uTension * smoothstep(0.35, 1.05, r);
    }
    // impact frame: for an instant the picture is cut to three hard tones
    if (uImpact > 0.0) {
      float il = dot(c, vec3(0.299, 0.587, 0.114));
      // three tones, not a negative: shadow drops to ink, mid tones to a deep wine, light to bone
      vec3 two = il > 0.42 ? vec3(0.98, 0.93, 0.82) : il > 0.16 ? vec3(0.36, 0.10, 0.16) : vec3(0.025, 0.018, 0.04);
      c = mix(c, two, uImpact);
    }
    c = mix(c, vec3(1.0, 0.95, 0.85), uFlash * 0.4);   // a lift, never a white-out (art pass: flashes read as glow)
    c *= 1.0 - uFade;
    outColor = vec4(c, 1.0);
  }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
    return s;
  }
  function program(gl, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    if (u.uCrack) u.uCrack = gl.getUniformLocation(p, 'uCrack[0]');
    return { p, u };
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 is not available');
      this.hdr = !!gl.getExtension('EXT_color_buffer_float');
      gl.getExtension('OES_texture_float_linear');
      this.pScene = program(gl, FS_SCENE);
      this.pBright = program(gl, FS_BRIGHT);
      this.pBlur = program(gl, FS_BLUR);
      this.pComp = program(gl, FS_COMP);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.cellsTex = null;
      this.scale = 4;
      this.zoom = 1;
      this.dust = [];
      this.fx = root.SpillVFX ? new root.SpillVFX.FX() : null;
    }

    target(w, h, linear) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const f = linear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb, w, h };
    }

    resize(cssW, cssH, dpr) {
      const gl = this.gl;
      const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
      this.canvas.width = W; this.canvas.height = H;
      this.screenW = W; this.screenH = H;
      this.scale = Math.max(2, Math.round(H / TARGET_ROWS));
      // render target covers the widest zoom-out; zoom in shows less of it
      this.viewW = Math.ceil(W / (this.scale * ZOOM_MIN)) + 3;
      this.viewH = Math.ceil(H / (this.scale * ZOOM_MIN)) + 3;
      for (const t of [this.tHdr, this.tHalf, this.tQa, this.tQb, this.tEa, this.tEb]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      this.tHdr = this.target(this.viewW, this.viewH, true);
      const hw = Math.max(1, this.viewW >> 1), hh = Math.max(1, this.viewH >> 1);
      const qw = Math.max(1, this.viewW >> 2), qh = Math.max(1, this.viewH >> 2);
      const ew = Math.max(1, this.viewW >> 3), eh = Math.max(1, this.viewH >> 3);
      this.tHalf = this.target(hw, hh, true);
      this.tQa = this.target(qw, qh, true); this.tQb = this.target(qw, qh, true);
      this.tEa = this.target(ew, eh, true); this.tEb = this.target(ew, eh, true);
    }

    // Visible world size in cells (without the 1-cell margin).
    // world pixels on screen right now, and screen pixels per world pixel
    get effScale() { return this.scale * this.zoom; }
    get viewCells() { return { w: this.screenW / this.effScale, h: this.screenH / this.effScale }; }

    setWorld(sim) {
      const gl = this.gl;
      this.W = sim.W; this.H = sim.H;
      if (this.cellsTex) gl.deleteTexture(this.cellsTex);
      this.cellsTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.cellsTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sim.W, sim.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (this.stoneTex) gl.deleteTexture(this.stoneTex);
      this.stoneTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.stoneTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sim.W, sim.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, window.SpillStones.layout(sim));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.base = new Uint8Array(sim.W * sim.H * 4);
      this.ow = Math.ceil(sim.W / 2); this.oh = Math.ceil(sim.H / 2);
      this.occFull = new Uint8Array(sim.W * sim.H);
      this.occHalf = new Uint8Array(this.ow * this.oh);
      if (this.occTex) gl.deleteTexture(this.occTex);
      this.occTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.occTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.ow, this.oh, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.cells = new Uint8Array(sim.W * sim.H * 4);
      this.baseVersion = -1;
      this.dust.length = 0;
    }

    buildBase(sim) {
      const { g, bg } = sim, b = this.base;
      for (let i = 0, n = sim.W * sim.H; i < n; i++) {
        const t = g[i], o = i * 4;
        b[o] = t; b[o + 1] = bg[i]; b[o + 2] = 0;
        b[o + 3] = (t === 1 || t === 8 || t === 5 || t === 9) ? 255 : t === 4 ? 90 : 0;
      }
      this.baseVersion = sim.terrainVersion;
    }

    // Small visual-only particles (impact dust), stepped here.
    // A spray of sand from a hit: bright grains burst outward (white-hot for
    // the first moments, then sand-coloured), arc under gravity and fade.
    spray(x, y, n, speed, a0, a1) {
      this.sprays = this.sprays || [];
      for (let k = 0; k < n; k++) {
        if (this.sprays.length > 700) this.sprays.shift();
        const a = a0 + Math.random() * (a1 - a0), v = speed * (0.35 + Math.random() * 0.75);
        this.sprays.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 18 + Math.random() * 26, t: 0 });
      }
    }
    // a grain leaving the pile for an attack: it leaps up off the heap in a short arc
    // and is drawn into where the attack forms (target may move: pass a function)
    stream(x, y, target, dur, delay, tint) { (this.streams || (this.streams = [])).push({ x0: x, y0: y, target, dur, delay, tint: tint | 0, t: 0, bulge: 6 + Math.random() * 8, side: (Math.random() - 0.5) * 6 }); if (this.streams.length > 400) this.streams.shift(); }
    stepStreams() { const L = this.streams; if (!L) return; for (let k = L.length - 1; k >= 0; k--) { L[k].t++; if (L[k].t >= L[k].delay + L[k].dur) L.splice(k, 1); } }
    puff(x, y, n, vx, vy) {
      for (let k = 0; k < n; k++) {
        if (this.dust.length > 400) this.dust.shift();
        this.dust.push({ x, y, vx: vx + (Math.random() - 0.5) * 1.6, vy: vy - Math.random() * 1.2, life: 20 + Math.random() * 25 });
      }
    }

    draw(sim, cam, time, opts) {
      const gl = this.gl, W = sim.W, H = sim.H;
      if (this.baseVersion !== sim.terrainVersion) this.buildBase(sim);
      const cells = this.cells;
      cells.set(this.base);
      const of = this.occFull;
      for (let i = 0, n = W * H; i < n; i++) of[i] = this.base[i * 4 + 3];
      const { px, py, state, tint, vx, vy, climbing, N } = sim;
      for (let i = 0; i < N; i++) {
        const s = state[i];
        if (s !== 1 && s !== 2) continue;
        const sp = Math.min(63, ((Math.abs(vx[i]) + Math.abs(vy[i])) * 10) | 0);
        const paint = (x, y, side) => {
          if (x < 0 || y < 0 || x >= W || y >= H || sim.terrainSolid(x, y)) return;
          const o = (y * W + x) * 4;
          if (side && cells[o] !== 0) return;
          cells[o] = s === 1 ? 20 : 21;
          cells[o + 2] = tint[i] * 64 + sp;
          cells[o + 3] = 255;
          if (sp < 10) of[y * W + x] = 150;
        };
        paint(px[i], py[i], false);
        if (s === 1 && climbing && climbing[i]) {
          // Keep the visual widening broken up: painting both sides of most
          // grains turns the climb into a perfectly rectangular strip.
          const pattern = (Math.imul(i, 1103515245) + Math.imul(px[i], 374761393) + Math.imul(py[i], 668265263)) >>> 0;
          const side = pattern % 100;
          const supported = sim.solid(px[i], py[i] + 1);
          if (supported) {
            if (side < 72) paint(px[i] - 1, py[i], true);
            if (side > 28) paint(px[i] + 1, py[i], true);
            if (side < 24) paint(px[i] - 2, py[i], true);
            else if (side > 76) paint(px[i] + 2, py[i], true);
          } else if (side < 30) paint(px[i] - 1, py[i], true);
          else if (side < 60) paint(px[i] + 1, py[i], true);
        }
      }
      // a Q bolt carries its own grains: drawn as a comet of sand along its path
      for (const q of sim.bolts || []) {
        if (q.kind !== 'q' || !q.trail.length) continue;
        const n = q.grains.length, tl = Math.min(q.trail.length, 9);
        for (let k = 0; k < n; k++) {
          const f = k / n, p = q.trail[Math.min(tl - 1, Math.floor(f * f * tl))];
          const h = Math.sin(k * 91.7 + sim.frame * 0.9) * 43758.5, j = (h - Math.floor(h) - 0.5) * (1 + f * 4);
          const x = Math.round(p.x - Math.sin(q.a) * j), y = Math.round(p.y + Math.cos(q.a) * j);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const o = (y * W + x) * 4; if (cells[o] === 1 || cells[o] === 8) continue;
          cells[o] = 20; cells[o + 2] = (tint[q.grains[k]] || 0) * 64 + Math.round(60 - f * 30); cells[o + 3] = 255;
        }
      }
      for (const st of this.streams || []) {
        if (st.t < st.delay) {                                                 // waiting its turn: still a grain on the heap, glinting
          const o = (Math.round(st.y0) * W + Math.round(st.x0)) * 4;
          if (o >= 0 && o < cells.length && cells[o] !== 1) { cells[o] = 20; cells[o + 2] = st.tint * 64 + 30; cells[o + 3] = 255; }
          continue;
        }
        const T = st.target(), u0 = (st.t - st.delay) / st.dur;
        for (const [du, sp] of [[0, 48], [-0.12, 22], [-0.24, 10]]) {          // the grain and a short tail behind it
          const u = Math.max(0, Math.min(1, u0 + du)); if (du && u0 + du < 0) continue;
          const e = u * u * (3 - 2 * u);                                           // leaps off slowly, arrives fast
          const mx = (st.x0 + T.x) / 2 + st.side, my = Math.min(st.y0, T.y) - st.bulge;
          const x = Math.round((1 - e) * (1 - e) * st.x0 + 2 * (1 - e) * e * mx + e * e * T.x), y = Math.round((1 - e) * (1 - e) * st.y0 + 2 * (1 - e) * e * my + e * e * T.y);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const o = (y * W + x) * 4; if (cells[o] === 1 || cells[o] === 8) continue;
          cells[o] = 20; cells[o + 2] = (du ? 2 : st.tint) * 64 + sp; cells[o + 3] = 255;
        }
      }
      // sand that is no longer yours, still falling to where it will lie
      for (const d of sim.loose || []) {
        if (d.x < 0 || d.y < 0 || d.x >= W || d.y >= H) continue;
        const o = (d.y * W + d.x) * 4; cells[o] = 9; cells[o + 3] = 255;
      }
      for (let k = this.dust.length - 1; k >= 0; k--) {
        const d = this.dust[k];
        d.vy += 0.08; d.vx *= 0.96; d.x += d.vx; d.y += d.vy; d.life--;
        const x = d.x | 0, y = d.y | 0;
        if (d.life <= 0 || x < 0 || y < 0 || x >= W || y >= H || sim.g[y * W + x] === 1) { this.dust.splice(k, 1); continue; }
        const o = (y * W + x) * 4;
        if (cells[o] === 0) cells[o] = 40;
      }
      for (let k = (this.sprays || []).length - 1; k >= 0; k--) {
        const d = this.sprays[k];
        d.vy += 0.16; d.vx *= 0.97; d.x += d.vx; d.y += d.vy; d.life--; d.t++;
        const x = d.x | 0, y = d.y | 0;
        if (d.life <= 0 || x < 0 || y < 0 || x >= W || y >= H || sim.g[y * W + x] === 1) { this.sprays.splice(k, 1); continue; }
        const o = (y * W + x) * 4;
        if (cells[o] === 0 || cells[o] >= 30) { cells[o] = 50; cells[o + 2] = parseInt(d.t < 4 ? '8' : d.t < 10 ? 'd' : d.life > 10 ? 'b' : 'c', 36); cells[o + 3] = 0; }
      }
      // props: palette sprites written over empty/decor cells
      for (const sp of opts.sprites || []) {
        for (let r = 0; r < sp.rows.length; r++) for (let c = 0; c < sp.rows[r].length; c++) {
          const ch = sp.rows[r][c];
          if (ch === '.') continue;
          const x = sp.x + c, y = sp.y + r;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const o = (y * W + x) * 4;
          // creatures (over) stand in front of sand, but never inside stone
          // creatures (over) stand in front of sand but never inside stone; iron
          // (onIron) paints a gate's smooth cells with its own drawing
          if (!sp.top && (sp.onIron ? cells[o] !== 8 : sp.over ? (cells[o] === 1 || cells[o] === 8) : (cells[o] !== 0 && cells[o] < 30))) continue;   // (top: an object that is itself the solid cell under it, e.g. a climbable chain, paints over it)
          cells[o] = 50; cells[o + 2] = parseInt(ch, 36); cells[o + 3] = 0;
        }
      }
      if (this.fx) this.fx.render(cells, W, H);   // energy over everything but stone
      gl.bindTexture(gl.TEXTURE_2D, this.cellsTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, cells);
      const oh = this.occHalf, ow = this.ow;
      for (let y = 0; y < this.oh; y++) for (let x = 0; x < ow; x++) {
        const x0 = x * 2, y0 = y * 2, x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
        oh[y * ow + x] = (of[y0 * W + x0] + of[y0 * W + x1] + of[y1 * W + x0] + of[y1 * W + x1]) >> 2;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.occTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ow, this.oh, gl.RED, gl.UNSIGNED_BYTE, oh);

      // camera: cam.x, cam.y = world position of the screen's top-left
      const ox = Math.floor(cam.x) - 1, oy = Math.floor(cam.y) - 1;
      const fx = cam.x - Math.floor(cam.x), fy = cam.y - Math.floor(cam.y);

      // pick the lights that matter for this view
      const vw = this.viewW, vh = this.viewH;
      const cxv = ox + vw / 2, cyv = oy + vh / 2;
      const lights = sim.lights.filter((L) => {
        return L.x + L.radius > ox && L.x - L.radius < ox + vw && L.y + L.radius > oy && L.y - L.radius < oy + vh;
      }).sort((a, b) => Math.hypot(a.x - cxv, a.y - cyv) - Math.hypot(b.x - cxv, b.y - cyv)).slice(0, MAXL);
      const Lp = new Float32Array(MAXL * 4), Lc = new Float32Array(MAXL * 3);
      lights.forEach((L, k) => {
        let f = 1;
        if (L.flicker) f = 1 - L.flicker * (0.03 + 0.03 * Math.sin(time * 5 + k * 3) * Math.sin(time * 3.1 + k));
        if (L.exit) f *= (0.35 + 0.65 * (opts.progress == null ? 1 : opts.progress)) + opts.exitPulse * 1.5 + (opts.enough ? 0.6 : 0);
        Lp[k * 4] = L.x; Lp[k * 4 + 1] = L.y; Lp[k * 4 + 2] = L.radius; Lp[k * 4 + 3] = 0;
        const I = 2.4;
        Lc[k * 3] = L.r * I * f; Lc[k * 3 + 1] = L.g * I * f; Lc[k * 3 + 2] = L.b * I * f;
      });

      gl.bindVertexArray(this.vao);
      // 1. scene
      let P = this.pScene;
      gl.useProgram(P.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tHdr.fb);
      gl.viewport(0, 0, vw, vh);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cellsTex);
      gl.uniform1i(P.u.uCells, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.occTex);
      gl.uniform1i(P.u.uOcc, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.stoneTex);
      gl.uniform1i(P.u.uStone, 2);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(P.u.uWorld, W, H);
      gl.uniform2f(P.u.uOrigin, ox, oy);
      gl.uniform2f(P.u.uView, vw, vh);
      // whole pixels only, so stars and clouds don't shimmer as the camera eases
      gl.uniform2f(P.u.uSkyOff, Math.round((cam.x - 200) * -0.25), Math.round((cam.y - 100) * -0.15));
      gl.uniform1f(P.u.uTime, time);
      gl.uniform1f(P.u.uExitPulse, opts.exitPulse || 0);
      gl.uniform1f(P.u.uEnough, opts.enough ? 1 : 0);
      gl.uniform1f(P.u.uProg, opts.progress == null ? 1 : opts.progress);
      gl.uniform1f(P.u.uHover, opts.hover ? 1 : 0);
      if (P.u.uRing) { const ring = sim.boss && sim.level && sim.level.id === 'sieve'; gl.uniform3f(P.u.uRing, ring ? 240 : 0, ring ? 132 : 0, ring ? 96 : 0); gl.uniform1f(P.u.uRingA, ring ? sim.boss.angle || 0 : 0); }
      if (P.u.uDeco) gl.uniform1f(P.u.uDeco, opts.deco ? 1 : 0);
      if (P.u.uFrost) gl.uniform1f(P.u.uFrost, sim.frozen ? Math.min(1, (sim.freezeT || 0) / (sim.freezeMax || 300)) : 0);
      { const F = opts.frost; if (P.u.uFrostK) gl.uniform1i(P.u.uFrostK, F ? F.kind : 0); if (P.u.uFrostW) gl.uniform4f(P.u.uFrostW, F ? F.x : 0, F ? F.y : 0, F ? F.reach : 0, F ? F.worn : 0); if (P.u.uCrack) gl.uniform4fv(P.u.uCrack, F ? F.cracks : new Float32Array(16)); }   // frozen sand (fightanim.js)
      gl.uniform2f(P.u.uExitY, sim.exitAt ? sim.exitAt.top : 0, sim.exitAt ? sim.exitAt.bottom : 0);
      if (P.u.uExitX) gl.uniform1f(P.u.uExitX, sim.exitAt ? sim.exitAt.x : 0);
      gl.uniform1f(P.u.uFogY, sim.level.fogY || 0);
      const wins = new Float32Array(16); (sim.windows || []).slice(0, 4).forEach((w, k) => wins.set([w.x, w.y, w.w, w.h], k * 4));
      gl.uniform4fv(P.u.uWin, wins); gl.uniform1i(P.u.uNWin, Math.min(4, (sim.windows || []).length));
      gl.uniform1fv(P.u.uWinS, new Float32Array([0, 1, 2, 0].map((v, k) => (k + (sim.W % 3)) % 3)));
      gl.uniform1f(P.u.uFloorY, sim.level.floorY || 0);
      gl.uniform2f(P.u.uCamC, cam.x + this.screenW / this.effScale / 2, cam.y + this.screenH / this.effScale / 2);
      gl.uniform4fv(P.u.uPal, SPRITE_PAL);
      if (P.u.uFx && root.SpillVFX) gl.uniform4fv(P.u.uFx, root.SpillVFX.FX_PAL);
      gl.uniform1i(P.u.uNL, lights.length);
      gl.uniform4fv(P.u.uL, Lp);
      gl.uniform3fv(P.u.uLC, Lc);
      gl.uniform3f(P.u.uAmb, 0.045, 0.048, 0.08);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2. bloom: bright pass to half, blur at quarter and eighth
      const blurTo = (src, dst, dx, dy) => {
        gl.useProgram(this.pBlur.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(this.pBlur.u.uSrc, 0);
        gl.uniform2f(this.pBlur.u.uTexel, 1 / dst.w, 1 / dst.h);
        gl.uniform2f(this.pBlur.u.uDir, dx, dy);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      P = this.pBright;
      gl.useProgram(P.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tHalf.fb); gl.viewport(0, 0, this.tHalf.w, this.tHalf.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tHdr.tex);
      gl.uniform1i(P.u.uSrc, 0);
      gl.uniform2f(P.u.uTexel, 1 / this.tHalf.w, 1 / this.tHalf.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      blurTo(this.tHalf, this.tQa, 1, 0); blurTo(this.tQa, this.tQb, 0, 1);
      blurTo(this.tQb, this.tEa, 1, 0); blurTo(this.tEa, this.tEb, 0, 1);
      blurTo(this.tEb, this.tEa, 1.5, 0); blurTo(this.tEa, this.tEb, 0, 1.5);

      // 3. composite to screen
      P = this.pComp;
      gl.useProgram(P.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.screenW, this.screenH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tHdr.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tQb.tex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tEb.tex);
      gl.uniform1i(P.u.uHdr, 0); gl.uniform1i(P.u.uBloomA, 1); gl.uniform1i(P.u.uBloomB, 2);
      gl.uniform2f(P.u.uView, vw, vh);
      gl.uniform2f(P.u.uFrac, fx, fy);
      gl.uniform2f(P.u.uScreen, this.screenW, this.screenH);
      gl.uniform1f(P.u.uScale, this.effScale);
      gl.uniform1f(P.u.uTime, time);
      gl.uniform1f(P.u.uFade, opts.fade || 0);
      gl.uniform1f(P.u.uFlash, opts.flash || 0);
      const cn = opts.cine || {};
      gl.uniform2f(P.u.uOrg, ox, oy);
      gl.uniform2f(P.u.uPC, cn.px || 0, cn.py || 0);
      gl.uniform1f(P.u.uPunch, cn.punch || 0);
      gl.uniform1f(P.u.uFringe, cn.fringe || 0);
      gl.uniform1f(P.u.uImpact, cn.impact || 0);
      gl.uniform1f(P.u.uTension, cn.tension || 0);
      gl.uniform1i(P.u.uNW, cn.nw || 0);
      gl.uniform4fv(P.u.uWave, cn.waves || new Float32Array(12));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  root.SpillRenderer = Renderer;
})(window);
