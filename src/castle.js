// The castle around the play space, drawn per pixel in the scene shader.
// Three planes behind the room and one in front of it:
//   A  the room's own back wall (moves with the world): an arcade of pointed
//      arches on engaged columns, a string course with a corbel frieze, a
//      balustrade in each opening, the wall's thickness shown in the reveals;
//   B  the nave beyond the arcade (0.7x): a far wall with stained-glass
//      lancets and open arches, nearer columns with ribbed vaults, banners,
//      a few candles, moonlight falling in stepped shafts, fog on its floor;
//   C  outside (0.2x): banded night sky, a crisp moon, stratus, two depths of
//      castle skyline with lit windows, the distant Great Glass spire, fog;
//   F  a foreground plane (1.3x) of dark masonry and hanging chains at the
//      room's edges, drawn only over stone and empty air, never over sand,
//      creatures, energy or telegraphs.
// Every shape is built from whole pixels with hard edges, stepped tones and
// an ordered dither; no soft gradients, no glow sprites.
// The string is pasted into renderer.js's scene shader just before main().
(function (root) {
  'use strict';
  root.SpillCastleGLSL = `
  // ---------- shared helpers ----------
  float bay4(vec2 p) {
    ivec2 b = ivec2(mod(floor(p), 4.0));
    return float(int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5)[b.x + b.y * 4]) / 16.0;
  }
  vec3 L3(float r, float g, float b) { return lin(vec3(r, g, b)); }
  // pointed (two-centred) arch: height of the curve above the spring line at |dx|
  float archH(float adx, float w, float R) { float u = adx + R - w; return sqrt(max(0.0, R * R - u * u)); }
  // 0 outside, 1 inside a pointed opening with jambs down to yb
  bool inPointed(vec2 p, float cx, float ys, float yb, float w, float R) {
    float adx = abs(p.x - cx);
    if (adx >= w || p.y >= yb) return false;
    if (p.y >= ys) return true;
    return ys - p.y < archH(adx, w, R);
  }
  // a stepped value: n flat tones with a dithered edge between them
  float stepd(float v, float n, vec2 p) { return floor(v * n + bay4(p) * 0.9) / n; }

  // ---------- C: outside ----------
  // e: pixel position in the exterior plane (rows counted down from the top
  // of the opening), hz: horizon row, nearX: the same column one layer nearer.
  vec3 exterior(vec2 e, float hz, float nearX) {
    e = floor(e);
    float t = clamp(e.y / hz, 0.0, 1.0);
    // sky: six hand-picked bands, dithered for a row or two where they meet
    float b = clamp(floor(t * 6.0 + (bay4(e) - 0.5) * 0.6), 0.0, 5.0);
    vec3 c = b < 1.0 ? L3(0.045, 0.048, 0.115) : b < 2.0 ? L3(0.065, 0.068, 0.155) : b < 3.0 ? L3(0.090, 0.090, 0.195)
           : b < 4.0 ? L3(0.120, 0.125, 0.225) : b < 5.0 ? L3(0.155, 0.180, 0.260) : L3(0.205, 0.245, 0.290);
    // stars, single pixels, high up; a few breathe
    float s = h21(e + 31.0);
    if (s > 0.9935 && t < 0.62) c = L3(0.72, 0.75, 0.86) * (s > 0.9985 ? 0.55 + 0.45 * step(0.5, fract(uTime * 0.21 + s * 40.0)) : 0.8);
    // the moon, crisp, gibbous, its shadow side still faintly there
    vec2 mc = vec2(floor(e.x / 900.0) * 900.0 + 380.0, floor(hz * 0.30));
    vec2 dm = e - mc;
    float md = length(dm + 0.5);
    // stratus streaks, two tones, the lit upper lip of each, brighter by the moon
    float cl = vnoise(vec2(e.x * 0.010 + uTime * 0.012, e.y * 0.16)) * vnoise(vec2(e.x * 0.031 - uTime * 0.02 + 9.0, e.y * 0.07));
    float clU = vnoise(vec2(e.x * 0.010 + uTime * 0.012, (e.y - 1.0) * 0.16)) * vnoise(vec2(e.x * 0.031 - uTime * 0.02 + 9.0, (e.y - 1.0) * 0.07));
    bool moonLayer = md < 7.5;
    if (moonLayer) {
      c = L3(0.86, 0.87, 0.80);
      if (h21(floor((e - mc) / 2.0) + 3.0) > 0.70) c = L3(0.69, 0.71, 0.67);       // maria
      if (dot(dm, vec2(0.8, 0.6)) > 3.2) c = L3(0.33, 0.35, 0.45);                    // the dark limb
      else if (dot(dm, vec2(0.8, 0.6)) > 2.2) c = L3(0.58, 0.60, 0.62);               // terminator step
    }
    if (cl > 0.30 && t < 0.92) {
      float nearMoon = 1.0 - clamp((md - 8.0) / 34.0, 0.0, 1.0);
      c = mix(L3(0.105, 0.11, 0.19), L3(0.16, 0.17, 0.25), step(0.38, cl));
      if (clU <= 0.30) c = mix(L3(0.25, 0.26, 0.34), L3(0.62, 0.64, 0.66), stepd(nearMoon, 3.0, e));   // lit lip
      else if (nearMoon > 0.0) c = mix(c, L3(0.30, 0.31, 0.38), stepd(nearMoon * 0.6, 3.0, e));
    }
    // far skyline: curtain walls, towers with cone roofs and needles, lit windows
    float x2 = e.x;
    float bid = floor(x2 / 13.0), lx = x2 - bid * 13.0;
    float rr = h21(vec2(bid, 3.0));
    float top2 = hz - 7.0 - floor(4.0 * h21(vec2(bid, 7.0)));
    bool tower = rr > 0.6;
    float bodyTop = hz - 16.0 - floor(26.0 * h21(vec2(bid, 5.0)));
    bool sil2 = false, win2 = false;
    if (tower && lx >= 3.0 && lx < 10.0) {
      if (e.y >= bodyTop) { sil2 = true; if (mod(lx, 2.0) < 1.0 && mod(e.y, 4.0) < 2.0 && h21(vec2(x2, floor(e.y / 4.0))) > 0.86) win2 = true; }
      float rh = 9.0, k = (bodyTop - e.y) / rh;                                          // cone roof
      if (k >= 0.0 && k < 1.0 && abs(lx - 6.5) < 4.5 * (1.0 - k)) sil2 = true;
      if (rr > 0.86 && lx == 6.0 && e.y < bodyTop - rh && e.y > bodyTop - rh - 6.0) sil2 = true;   // needle
    }
    if (e.y >= top2 + (mod(x2, 4.0) < 2.0 ? 0.0 : 1.0)) sil2 = true;                      // walls with merlons
    // the Great Glass: one slim spire far off, a teal crystal at its tip, a thin pillar of light rising
    float gx = x2 - (floor(x2 / 1300.0) * 1300.0 + 610.0);
    float gTop = hz - 78.0;
    float gw = 1.0 + floor(max(0.0, e.y - gTop) / 18.0);
    if (abs(gx) < gw && e.y > gTop) sil2 = true;
    bool crystal = abs(gx) + abs(e.y - (gTop - 4.0)) * 0.55 < 2.6;
    if (sil2) {
      c = L3(0.135, 0.155, 0.215);
      if (win2) c = L3(0.95, 0.62, 0.30) * (0.55 + 0.45 * step(0.25, fract(uTime * 0.017 + h21(vec2(x2, e.y)) * 7.0)));
    }
    if (crystal) c = L3(0.55, 0.98, 0.88) * (1.5 + 0.5 * step(0.0, sin(uTime * 0.9)));
    else if (abs(gx) < 1.0 && e.y < gTop - 6.0 && e.y > gTop - 70.0) {
      float up = (gTop - 6.0 - e.y) / 64.0;
      if (bay4(e) > up * 1.2) c = mix(c, L3(0.40, 0.80, 0.74), 0.45 * (1.0 - stepd(up, 4.0, e)));
    }
    // haze where the far skyline meets the near one
    if (e.y > hz - 6.0 && !crystal) c = mix(c, L3(0.20, 0.235, 0.28), 0.35 * clamp((e.y - hz + 6.0) / 6.0, 0.0, 1.0));
    // near skyline: a ridge with round towers, crenellated rings and a bridge on arches
    float x1 = floor(nearX);
    float rid = hz + 3.0 + floor(3.0 * vnoise(vec2(x1 * 0.04, 2.0)));
    float tb = floor(x1 / 46.0), tl = x1 - tb * 46.0;
    float tr = h21(vec2(tb, 11.0));
    bool sil1 = e.y >= rid;
    float tTop = hz - 26.0 - floor(30.0 * h21(vec2(tb, 13.0)));
    bool inTower = tr > 0.45 && tl >= 14.0 && tl < 30.0;
    if (inTower && e.y >= tTop) sil1 = true;
    if (inTower && e.y >= tTop - 2.0 && e.y < tTop && mod(tl, 4.0) < 2.0) sil1 = true;      // its crenellated ring
    if (tr > 0.75 && tl >= 15.0 && tl < 29.0) {                                            // some carry a tall cone
      float k = (tTop - 2.0 - e.y) / 16.0;
      if (k >= 0.0 && k < 1.0 && abs(tl - 21.5) < 8.0 * (1.0 - k)) sil1 = true;
    }
    if (!inTower && e.y >= hz - 15.0 && e.y < hz - 12.0) sil1 = true;                      // the bridge deck
    if (!inTower && e.y >= hz - 12.0 && mod(tl, 11.0) < 3.0) sil1 = true;                  // its piers
    if (sil1) {
      c = L3(0.070, 0.075, 0.125);
      // moonlight catches the left edges of the near forms, one pixel
      float xl = x1 - 1.0, tlL = xl - floor(xl / 46.0) * 46.0;
      bool leftOpen = tl == 14.0 && inTower && e.y >= tTop;
      if (leftOpen || (e.y == rid && h21(vec2(x1, 4.0)) > 0.4)) c = L3(0.17, 0.20, 0.27);
      if (inTower && e.y > tTop + 4.0 && mod(tl, 5.0) == 2.0 && mod(e.y, 7.0) < 2.0 && h21(vec2(tb, floor(e.y / 7.0))) > 0.7)
        c = L3(0.92, 0.58, 0.26) * 0.7;                                                     // a lit arrow slit
    }
    // ground fog drifting along the foot of it all
    float fz = e.y - hz;
    if (fz > -2.0) {
      float fn = vnoise(vec2(e.x * 0.05 + uTime * 0.25, 1.0)) * 4.0;
      if (fz < fn + 3.0) c = mix(c, L3(0.17, 0.20, 0.25), 0.55 * (bay4(e) > 0.35 ? 1.0 : 0.7));
    }
    return c;
  }

  // ---------- B: the nave beyond the arcade ----------
  // wp world pixel, yb: row of the arcade opening's bottom, ya: its apex
  vec3 nave(vec2 wp, float yb, float ya) {
    float nx = floor(wp.x - uCamC.x * 0.30);                                  // far wall plane
    float ny = floor(wp.y - yb + (uCamC.y - (yb - 70.0)) * 0.06);              // rows above the nave floor are negative
    vec2 q = vec2(nx, ny);
    // far wall: fine coursed masonry, dark violet, brighter toward the haze below
    float row = floor(ny / 7.0), off = mod(row, 2.0) * 7.0;
    vec2 l = vec2(mod(nx + off, 14.0), mod(ny, 7.0));
    float tone = 0.86 + 0.2 * floor(h21(vec2(floor((nx + off) / 14.0), row)) * 3.0) / 3.0;
    vec3 c = L3(0.105, 0.10, 0.155) * tone;
    if (l.x < 1.0 || l.y < 1.0) c *= 0.8;
    else if (l.y < 2.0) c *= 1.05;
    // the hall's height falls into darkness; its floor sits in pale haze
    float haze = clamp((ny + 150.0) / 150.0, 0.0, 1.0);
    c *= 0.6 + 0.6 * stepd(haze, 4.0, q);
    c = mix(c, L3(0.18, 0.19, 0.27), stepd(clamp((ny + 80.0) / 80.0, 0.0, 1.0), 4.0, q) * 0.6);
    // bays of the far wall: stained glass or an open arch to the night
    float NB = 124.0;
    float bi = floor((nx + 40.0) / NB), bx = nx + 40.0 - bi * NB - NB * 0.5;
    bool open = h21(vec2(bi, 19.0)) > 0.5;
    float w = open ? 17.0 : 9.0, R = w * 1.5;
    float ys = -112.0, yB = open ? -14.0 : -40.0;
    vec3 shaftCol = open ? L3(0.62, 0.78, 0.84) : L3(0.55, 0.62, 0.82);
    vec2 wq = vec2(bx, ny);
    bool inWin = inPointed(wq, 0.0, ys, yB, w, R);
    bool inFrame = !inWin && inPointed(wq, 0.0, ys, yB + 3.0, w + 3.0, R + 3.0);
    if (inFrame) c = L3(0.15, 0.145, 0.21) * (bx < 0.0 ? 1.15 : 0.7);
    if (inWin) {
      if (open) {
        float top = ys - archH(0.0, w, R);
        vec2 e = vec2(floor(wp.x - uCamC.x * 0.8), ny - top + 6.0);
        c = exterior(e, (yB - top) * 0.78, wp.x - uCamC.x * 0.66);
        c = mix(c, L3(0.17, 0.19, 0.26), 0.22);                                 // seen through the hall's air
      } else {
        // stained glass: lead cames, a mullion, saddle bars; panes in a few muted hues
        // lozenge quarries in lead, a few hues kept close together, moonlight strongest at the head
        float a1 = mod(bx + ny + 200.0, 6.0), a2 = mod(bx - ny + 200.0, 6.0);
        vec2 pn = floor(vec2((bx + ny + 200.0) / 6.0, (bx - ny + 200.0) / 6.0));
        float ph = h21(pn + bi * 7.0);
        vec3 g = ph < 0.45 ? L3(0.15, 0.34, 0.38) : ph < 0.72 ? L3(0.17, 0.19, 0.38) : ph < 0.93 ? L3(0.27, 0.21, 0.40) : L3(0.58, 0.41, 0.20);
        g *= 0.75 + 0.55 * clamp((-ny - 50.0) / 70.0, 0.0, 1.0);
        if (h21(pn + 91.0 + bi) > 0.9) g = L3(0.05, 0.05, 0.08);               // a pane gone dark
        bool lead = a1 < 1.0 || a2 < 1.0 || abs(bx) < 1.0;
        c = lead ? L3(0.04, 0.035, 0.06) : g;
      }
    }
    // shafts of moonlight from each opening, falling down and to the right in three stepped strengths
    {
      float s = 0.42, top = ys - 20.0;
      float x0 = bx - (ny - top) * s;
      float d = (ny - top) / 150.0;
      if (!inWin && !inFrame && ny > top && abs(x0) < w - 1.0 && d < 1.0) {
        float k = stepd(1.0 - d, 3.0, q) * (0.75 + 0.25 * sin(uTime * 0.35 + bi));
        if (!open && abs(x0) < 1.5) k *= 0.5;                                    // the mullion's shadow inside the beam
        c += shaftCol * 0.085 * k;
        if (h21(floor(q + vec2(-uTime * 2.0, uTime * 3.0))) > 0.996) c += shaftCol * 0.25 * k;   // dust turning in it
      }
    }
    // nearer columns (a slightly different depth), ribbed vaults between them, banners, candles
    float cx2 = floor(wp.x - uCamC.x * 0.26);
    float CB = 74.0;
    float ci = floor((cx2 + 30.0) / CB), cl = cx2 + 30.0 - ci * CB - CB * 0.5;
    float capY = -132.0;
    if (abs(cl) < 8.0 && ny > capY) {
      float u = cl + 8.0;                                                        // 0..16 across the shaft
      float sh = u < 3.0 ? 1.25 : u < 9.0 ? 1.0 : u < 13.0 ? 0.8 : 0.65;
      c = L3(0.045, 0.042, 0.07) * sh;
      if (u < 1.0) c = L3(0.19, 0.21, 0.29);                                     // moonlit rim
      if (mod(ny, 18.0) < 1.0) c *= 0.75;                                        // drum joints
    }
    if (abs(cl) < 11.0 && ny <= capY && ny > capY - 6.0) c = L3(0.12, 0.11, 0.17) * (ny > capY - 2.0 ? 0.7 : abs(cl) < 10.0 && cl < -7.0 ? 1.4 : 1.0);   // capital
    if (abs(cl) < 10.0 && ny > -8.0) c = L3(0.11, 0.10, 0.16) * (ny < -6.0 ? 1.3 : 0.85);   // base
    // a vault rib springing from each capital toward the next
    {
      float hb = CB * 0.5, ax = abs(cl);
      float rise = sqrt(max(0.0, hb * hb - (hb - ax) * (hb - ax))) * 0.55;
      float ry = capY - 6.0 - rise;
      if (ax > 9.0 && abs(ny - ry) < 1.5) c = L3(0.15, 0.14, 0.21) * (ny < ry ? 1.25 : 0.7);
    }
    // a banner on some columns: hung below the capital, swaying a little, tattered at the foot
    if (h21(vec2(ci, 23.0)) > 0.42) {
      float len = 44.0 + floor(26.0 * h21(vec2(ci, 29.0)));
      float vy = ny - (capY + 8.0);
      float sway = sin(uTime * 0.55 + ci * 1.7) * vy / len * 1.6 + sin(uTime * 1.3 + vy * 0.15) * 0.4;
      float u = cl - floor(sway + 0.5);
      float cut = abs(u) * 0.9 + (h21(vec2(floor(u), ci)) > 0.75 ? 4.0 : 0.0);  // a V-cut foot, a few torn strips shorter
      if (vy >= 0.0 && abs(u) < 6.0 && vy < len - cut) {
        bool red = h21(vec2(ci, 31.0)) > 0.4;
        vec3 cloth = red ? L3(0.30, 0.085, 0.10) : L3(0.08, 0.20, 0.22);
        float fold = mod(u + 6.0, 4.0);
        cloth *= fold < 1.0 ? 1.3 : fold < 2.0 ? 1.0 : fold < 3.0 ? 0.82 : 0.9;
        if (vy < 2.0) cloth = L3(0.22, 0.18, 0.12);                               // the rod
        // the Tower's mark: an hourglass in old gold thread
        float hv = vy - 14.0, hu = abs(u);
        if (hv >= 0.0 && hv < 15.0 && (hv < 1.0 || hv > 13.0 ? hu < 3.5 : abs(hu - abs(hv - 7.0) * 0.42) < 0.6)) cloth = L3(0.62, 0.48, 0.24);
        if (h21(vec2(floor(u), floor(vy)) + ci) > 0.985) cloth = c;              // moth holes show what is behind
        c = cloth;
      }
    }
    // candles in iron sconces on a few columns: a two-tone flame, a stepped pool of warm light
    if (h21(vec2(ci, 41.0)) > 0.4) {
      vec2 cp = vec2(cl - 10.0, ny + 64.0);
      float fl = floor(fract(uTime * 7.0 + ci) * 3.0);
      if (cp.x >= -1.0 && cp.x <= 1.0 && cp.y >= 0.0 && cp.y < 2.0) c = L3(0.12, 0.10, 0.10);   // sconce
      if (cp.x == 0.0 && cp.y >= -3.0 && cp.y < 0.0) c = cp.y > -2.0 ? L3(1.0, 0.82, 0.48) * 3.0 : L3(1.0, 0.55, 0.20) * (fl > 0.5 ? 2.2 : 1.4);
      float r = length(cp + vec2(0.0, 2.0));
      if (r < 15.0 && r > 1.5) c *= 1.0 + 0.9 * stepd(1.0 - r / 15.0, 3.0, q) * (0.9 + 0.1 * fl);
    }
    // the nave floor, and fog lying on it in drifting stepped banks
    if (ny > -2.0) c = L3(0.10, 0.095, 0.15) * (mod(nx, 16.0) < 1.0 ? 0.7 : 1.0);
    float fn = vnoise(vec2(nx * 0.035 + uTime * 0.18, 4.0)) * 22.0 + vnoise(vec2(nx * 0.11 - uTime * 0.3, 7.0)) * 6.0;
    float fd = ny + fn + 8.0;
    if (fd > 0.0) c = mix(c, L3(0.19, 0.21, 0.29), (fd > 10.0 ? 0.62 : fd > 4.0 ? 0.42 : 0.24) * (bay4(q) > 0.15 ? 1.0 : 0.6));
    // a few pale motes drifting up through the hall, slow, far apart
    vec2 mq = vec2(nx + sin(uTime * 0.4 + floor(nx / 40.0)) * 3.0, ny + uTime * 4.0);
    if (h21(floor(mq / vec2(40.0, 60.0))) > 0.7 && length(mod(mq, vec2(40.0, 60.0)) - vec2(20.0, 30.0)) < 0.8) c = L3(0.55, 0.92, 0.84) * 0.9;
    // distance: everything here sits back in the cool air of the hall
    return mix(c, L3(0.12, 0.13, 0.20), 0.18);
  }

  // ---------- A: the arcade in the room's back wall ----------
  // Returns mode in .a: 0 plain wall, 1 architecture (albedo in .rgb), 2 an opening (B shows through).
  // ya/yb out: the opening's apex and bottom rows (for B).
  float arcFloor() { return uFloorY > 0.0 ? uFloorY : uWorld.y - 20.0; }
  bool nearWindow(float x0, float x1, float y0, float y1) {
    for (int k = 0; k < 4; k++) {
      if (k >= uNWin) break;
      vec4 wn = uWin[k];
      if (x1 > wn.x - 14.0 && x0 < wn.x + wn.z + 14.0 && y1 > wn.y - 14.0 && y0 < wn.y + wn.w + 10.0) return true;
    }
    if (uRing.z > 0.0 && x1 > uRing.x - uRing.z - 10.0 && x0 < uRing.x + uRing.z + 10.0) return true;   // the Sieve's ring
    return false;
  }
  vec4 arcade(vec2 wp, out float oYa, out float oYb) {
    oYa = 0.0; oYb = 0.0;
    vec2 p = floor(wp);
    float BW = 112.0;
    float span = uWorld.x - 32.0;
    float x0 = 16.0 + mod(span, BW) * 0.5;
    float bi = floor((p.x - x0) / BW), lx = p.x - x0 - bi * BW;
    float ow = 24.0, R = 34.0;                  // opening half width, arch radius
    float cxo = BW * 0.5;
    float ybase = arcFloor() - 14.0;
    vec3 stone = L3(0.31, 0.29, 0.36);
    for (int n = 0; n < 4; n++) {
      float big = n == 0 ? 1.0 : 0.0;
      float yb = ybase - float(n) * 176.0;                   // each storey's sill
      float hgt = n == 0 ? 146.0 : 96.0;
      float ya = yb - hgt;                                   // apex
      if (ya < 22.0) break;
      float w = n == 0 ? ow : 16.0, Rr = n == 0 ? R : 23.0;
      float ys = ya + archH(0.0, w, Rr);
      if (p.y > yb + 16.0 || p.y < ya - 26.0) continue;
      bool blind = nearWindow(x0 + bi * BW + cxo - w, x0 + bi * BW + cxo + w, ya, yb) || bi < 0.0 || x0 + bi * BW + BW > uWorld.x - 8.0;
      // the string course under the next storey and its corbel frieze
      float sc = ya - 20.0;
      if (p.y >= sc && p.y < sc + 4.0) return vec4(stone * (p.y < sc + 1.0 ? 1.3 : 1.0), 1.0);
      if (p.y >= sc + 4.0 && p.y < sc + 10.0) {
        float fx = mod(p.x, 10.0), fy = p.y - sc - 4.0;
        bool arcPix = abs(length(vec2(fx - 5.0, fy - 1.0)) - 4.0) < 0.8 && fy > 0.0;
        if (fx < 1.5 && fy < 6.0) return vec4(stone * 0.9, 1.0);                     // corbel
        if (arcPix) return vec4(stone * 0.85, 1.0);
        if (fy < 2.0) return vec4(L3(0.10, 0.09, 0.13), 1.0);                          // the course's shadow
      }
      // engaged column at the bay boundary: base, shaft, capital
      float cl = lx < BW * 0.5 ? lx : lx - BW;                 // distance from the nearest boundary
      float colTop = ys - 2.0;
      if (abs(cl) < 10.0 && p.y >= colTop - 6.0 && p.y < yb + 16.0) {
        float u = cl + 7.0;
        if (p.y < colTop) {                                    // capital: abacus over a stepped bell
          float bell = colTop - p.y;
          if (bell > 4.0 && abs(cl) < 10.0) return vec4(stone * (bell > 5.0 ? 1.25 : 0.8), 1.0);
          if (abs(cl) < 6.0 + bell) return vec4(stone * (cl < 0.0 ? 1.1 : 0.78), 1.0);
        } else if (p.y >= yb + 6.0) {                          // base: torus and plinth
          if (abs(cl) < 10.0) return vec4(stone * (p.y < yb + 7.0 ? 1.25 : p.y < yb + 9.0 ? 1.0 : 0.82), 1.0);
        } else if (abs(cl) < 7.0) {
          float sh = u < 1.0 ? 0.62 : u < 2.0 ? 1.18 : u < 4.0 ? 1.08 : u < 8.0 ? 0.95 : u < 11.0 ? 0.82 : 0.66;
          vec3 cs = stone * 0.92 * sh;
          if (mod(p.y - colTop, 16.0) < 1.0) cs *= 0.7;        // drum joints
          if (h21(p * 0.7) > 0.97) cs *= 0.85;
          return vec4(cs, 1.0);
        }
      }
      if (blind) {
        // a blind arch: the same outline, recessed a few pixels, no opening
        bool inB = inPointed(p, x0 + bi * BW + cxo, ys, yb, w, Rr);
        bool ringB = !inB && inPointed(p, x0 + bi * BW + cxo, ys, yb, w + 4.0, Rr + 4.0);
        if (ringB) return vec4(stone * 0.95, 1.0);
        if (inB) { bool edgeL = !inPointed(p - vec2(2.0, 0.0), x0 + bi * BW + cxo, ys, yb, w, Rr); return vec4(L3(0.20, 0.185, 0.25) * (edgeL ? 0.6 : 0.85), 1.0); }
        continue;
      }
      float cx = x0 + bi * BW + cxo;
      bool inO = inPointed(p, cx, ys, yb, w, Rr);
      bool ring = !inO && inPointed(p, cx, ys, yb, w + 5.0, Rr + 5.0) && p.y < ys + 2.0;
      bool jamb = !inO && abs(p.x - cx) < w + 3.0 && p.y >= ys && p.y < yb;
      if (ring) {
        // voussoirs: radial joints, a taller keystone at the apex
        float side = p.x < cx ? -1.0 : 1.0;
        vec2 cc = vec2(cx - side * (Rr - w), ys);
        float ang = atan(ys - p.y, (p.x - cc.x) * -side);
        float j = fract(ang * 5.5);
        vec3 v = stone * (1.0 + 0.12 * floor(h21(vec2(floor(ang * 5.5), side + bi)) * 3.0) / 3.0);
        if (abs(p.x - cx) < 3.0) v = stone * 1.18;                                    // keystone
        else if (j < 0.09) v = stone * 0.4;
        float rr2 = length(p - cc);
        if (rr2 > Rr + 4.0) v *= 1.12;                                                // lit outer edge
        return vec4(v, 1.0);
      }
      if (jamb) return vec4(stone * (p.x < cx ? 1.08 : 0.86) * (mod(p.y, 12.0) < 1.0 ? 0.6 : 1.0), 1.0);
      if (inO) {
        // the wall's thickness: lit reveal on the left, shaded on the right, a dark soffit under the arch
        bool rl = !inPointed(p - vec2(3.0, 0.0), cx, ys, yb, w, Rr);
        bool rr3 = !inPointed(p + vec2(3.0, 0.0), cx, ys, yb, w, Rr);
        bool ru = !inPointed(p - vec2(0.0, 3.0), cx, ys, yb, w, Rr);
        if (ru && !rl && !rr3) return vec4(L3(0.13, 0.12, 0.17), 1.0);
        if (rl) return vec4(L3(0.36, 0.33, 0.40) * (0.92 + 0.08 * h21(floor(p / vec2(1.0, 5.0)))), 1.0);
        if (rr3) return vec4(L3(0.17, 0.16, 0.21), 1.0);
        // a balustrade across the foot of the opening: rail, vase-shaped balusters
        float by = yb - p.y;
        if (big > 0.5 && by < 18.0) {
          if (by >= 14.0) return vec4(stone * (by >= 17.0 ? 1.3 : 1.0), 1.0);
          float bxl = mod(p.x - cx + 100.0, 7.0) - 3.0;
          float prof = by < 2.0 ? 2.5 : by < 5.0 ? 1.5 : by < 9.0 ? 2.5 - abs(by - 7.0) * 0.4 : 1.2;
          if (abs(bxl) < prof) return vec4(stone * (bxl < 0.0 ? 1.08 : 0.72), 1.0);
          if (by < 2.0) return vec4(stone * 0.9, 1.0);
        }
        oYa = ya; oYb = yb;
        return vec4(0.0, 0.0, 0.0, 2.0);
      }
    }
    return vec4(0.0);
  }

  // ---------- windows: the exterior seen through the room's real windows ----------
  vec3 winSky(vec2 wp) {
    for (int k = 0; k < 4; k++) {
      if (k >= uNWin) break;
      vec4 wn = uWin[k];
      if (wp.x >= wn.x - 2.0 && wp.x < wn.x + wn.z + 2.0 && wp.y >= wn.y - 40.0 && wp.y < wn.y + wn.w + 2.0) {
        vec2 e = vec2(floor(wp.x - uCamC.x * 0.8), floor(wp.y - wn.y + 30.0 + (wn.y - uCamC.y) * 0.05));
        return exterior(e, wn.w * 0.80 + 30.0, wp.x - uCamC.x * 0.66);
      }
    }
    vec2 e = floor(wp + uSkyOff);
    return exterior(e, 160.0, wp.x - uCamC.x * 0.66);
  }

  // ---------- light falling into the room from its real windows ----------
  // stepped shafts down and to the right, broken by the mullion, stopped by stone
  vec3 windowShafts(vec2 wp) {
    vec3 add = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      if (k >= uNWin) break;
      vec4 wn = uWin[k];
      float top = wn.y + wn.w * 0.35;
      if (wp.y <= top) continue;
      float s = 0.42;
      float x0 = wp.x - (wp.y - top) * s;
      if (x0 < wn.x + 2.0 || x0 > wn.x + wn.z - 2.0) continue;
      float d = (wp.y - top) / 210.0;
      if (d >= 1.0) continue;
      // blocked by stone between here and the window (a few soft samples)
      float T = 1.0;
      for (int j = 1; j <= 5; j++) {
        float f = float(j) / 6.0;
        vec2 sp = vec2(x0, top) + (wp - vec2(x0, top)) * f;
        T *= 1.0 - occS(sp) * 0.8;
      }
      float mid = wn.x + floor(wn.z * 0.5);
      float k2 = stepd((1.0 - d) * T, 3.0, wp);
      if (abs(x0 - mid) < 1.5) k2 *= 0.4;
      float edge = min(x0 - wn.x - 2.0, wn.x + wn.z - 2.0 - x0);
      if (edge < 3.0 && bay4(wp) > edge / 3.0) k2 *= 0.5;                      // a dithered edge, never a ruled line
      add += L3(0.55, 0.68, 0.85) * 0.03 * k2 * (0.85 + 0.15 * sin(uTime * 0.3 + float(k)));
      if (h21(floor(wp + vec2(-uTime * 1.5, uTime * 2.5))) > 0.997) add += L3(0.7, 0.8, 0.9) * 0.18 * k2;   // motes
    }
    return add;
  }


  // ---------- the funnel's collar: cast bronze set into the stone ----------
  // Lit from the upper left. Around the glass, outward: a dark groove where the glass sits,
  // a polished lip, an engraved band (a chevron cut every few pixels), a dark outer edge.
  // The collar's top face catches the light; two small cast finials stand on the floor at its ends.
  bool isExit(ivec2 q) { return int(cellAt(q).r * 255.0 + 0.5) == 6; }
  bool nearFunnel(vec2 wp) { return uExitY.y > 0.0 && abs(wp.x - uExitX) < 28.0 && wp.y > uExitY.x - 8.0 && wp.y < uExitY.y + 7.0; }
  // .a < 0: not part of it; else the emissive strength. rgb: linear albedo
  vec4 funnelCollar(ivec2 ip) {
    vec2 wp = vec2(ip);
    if (!nearFunnel(wp)) return vec4(-1.0);
    int d = 0; ivec2 to = ivec2(0);
    for (int k = 1; k <= 4; k++) {
      ivec2 dirs[8] = ivec2[8](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1), ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1));
      for (int j = 0; j < 8; j++) if (d == 0 && isExit(ip + dirs[j] * k)) { d = k; to = dirs[j]; }
      if (d > 0) break;
    }
    if (d == 0) return vec4(-1.0);
    bool topFace = cellAt(ip + ivec2(0, -1)).a < 0.5;                  // open to the air above
    bool lit = to.x < 0 || (to.x == 0 && to.y < 0);                    // slopes facing up or left catch the light
    float glow = uEnough > 0.5 ? 1.0 : 0.0;
    vec3 c; float e = 0.03;
    if (topFace) { c = d <= 2 ? vec3(0.98, 0.84, 0.56) : vec3(0.80, 0.62, 0.36); e = 0.08 + glow * 0.5; }
    else if (d == 1) c = vec3(0.10, 0.06, 0.035);
    else if (d == 2) { c = lit ? vec3(0.90, 0.68, 0.36) : vec3(0.50, 0.31, 0.14); e = 0.05 + glow * (lit ? 0.6 : 0.3); }
    else if (d == 3) {
      c = lit ? vec3(0.64, 0.44, 0.21) : vec3(0.33, 0.20, 0.10);
      float along = to.y != 0 && to.x == 0 ? wp.x : wp.y;                // follow the band
      if (mod(along + (to.x + to.y > 0 ? 0.0 : 2.0), 5.0) < 1.0) c *= 0.55;   // engraved notch
    } else c = vec3(0.19, 0.12, 0.075);
    return vec4(lin(c), e);
  }
  vec4 funnelFinial(vec2 wp) {
    if (!nearFunnel(wp) || wp.y >= uExitY.x || wp.y < uExitY.x - 7.0) return vec4(-1.0);
    float xl = floor(uExitX - 17.5);
    float h = uExitY.x - wp.y;                                          // 1 = just above the floor
    for (int s = 0; s < 2; s++) {
      float cx = s == 0 ? xl - 3.0 : xl + 38.0;
      float dx = wp.x - cx;
      float hw = h <= 1.0 ? 2.0 : h <= 3.0 ? 1.0 : h <= 5.0 ? 1.0 : 0.0;   // plinth, stem, knop, tip
      if (h > 6.0 || abs(dx) > hw) continue;
      vec3 c = dx < 0.0 ? vec3(0.92, 0.72, 0.42) : dx > 0.0 ? vec3(0.42, 0.26, 0.12) : vec3(0.70, 0.50, 0.26);
      if (h == 2.0 && abs(dx) <= 1.0) c *= 0.6;                          // the neck under the knop
      float e = 0.04;
      if (h >= 6.0) { c = vec3(1.0, 0.86, 0.55); e = uEnough > 0.5 ? 1.8 + 0.6 * step(0.5, fract(uTime * 0.8)) : 0.25; }   // the tip
      return vec4(lin(c), e);
    }
    return vec4(-1.0);
  }


  // ---------- the Sieve (boss arena): the great ring, its grate, and what lies under it ----------
  // uRing: centre x, y, outer radius (0 = no ring in this room); uRingA: the grate's turn.
  int bgAt(ivec2 q) { return int(cellAt(q).g * 255.0 + 0.5); }
  bool inRing(vec2 wp) { return uRing.z > 0.0 && length(wp - uRing.xy) < uRing.z + 1.0; }
  // Under the grate: the bottom of the Tower. Spiral arms of falling grains turn with the grate
  // and run inward to a faint gold-teal light; no rings, no glow sprite.
  vec3 abyss(vec2 wp) {
    vec2 d = floor(wp) + 0.5 - uRing.xy;
    float r = length(d), a = atan(d.y, d.x);
    float arm = fract((a + uRingA * 0.8) / 6.2832 * 3.0 + log(r + 2.0) * 1.35 - uTime * 0.04);
    float k = arm < 0.18 ? 2.0 : arm < 0.42 ? 1.0 : 0.0;                      // three stepped tones across each arm
    float depth = 1.0 - clamp(r / uRing.z, 0.0, 1.0);
    vec3 c = k > 1.5 ? lin(vec3(0.15, 0.19, 0.26)) : k > 0.5 ? lin(vec3(0.09, 0.11, 0.17)) : lin(vec3(0.04, 0.04, 0.08));
    c += lin(vec3(0.20, 0.30, 0.30)) * stepd(depth * depth, 4.0, wp) * 0.25;   // deeper in, the far light rises (stepped)
    // grains streaming inward along the arms
    float lane = floor((a + uRingA * 0.8 + log(r + 2.0) * 2.83) * 18.0);
    float g = h21(vec2(lane, floor(r * 0.5 + uTime * 9.0)));
    if (g > (k > 1.5 ? 0.9 : 0.975) && k > 0.5) c = lin(vec3(0.86, 0.66, 0.38)) * (0.35 + 0.9 * depth);
    return c;
  }
  // The ring and its grate, drawn on the frame cells: dressed stone voussoirs shaded as a torus
  // (lit from the upper left), a bronze inner band cut with small glyphs, iron bars with a lit
  // and a shaded edge, a domed bronze hub.
  vec3 sieveFrame(ivec2 ip) {
    vec2 wp = vec2(ip);
    vec2 d = wp + 0.5 - uRing.xy;
    float r = length(d);
    vec2 n = d / max(r, 0.001);
    float R = uRing.z;
    vec2 Ld = normalize(vec2(-0.7, -0.75));
    if (r > R - 9.0) {
      float t = (r - (R - 9.0)) / 9.0;                                     // 0 inner .. 1 outer
      float a = atan(d.y, d.x);
      if (t < 0.24) {                                                       // the bronze band and its glyphs
        vec3 c = vec3(0.52, 0.37, 0.18) * (0.85 + 0.35 * max(0.0, dot(-n, Ld)));
        float cell = floor((a + 3.1416) * R / 7.0), u = fract((a + 3.1416) * R / 7.0) * 7.0;
        float gsel = h21(vec2(cell, 3.0));
        bool cut = (u > 2.0 && u < 3.0) || (gsel > 0.5 && u > 3.0 && u < 5.0 && t > 0.1) || (gsel > 0.8 && u > 4.0 && u < 5.0);
        if (cut) c *= 0.45;
        return lin(c);
      }
      float face = dot(n, Ld) * (t - 0.6) * 2.4;                            // torus: outer half faces out, inner half faces in
      float tone = face > 0.35 ? 1.45 : face > 0.05 ? 1.12 : face > -0.3 ? 0.8 : 0.5;
      vec3 c = vec3(0.36, 0.34, 0.40) * tone * (0.92 + 0.12 * floor(h21(vec2(floor(a * 9.0), 7.0)) * 3.0) / 3.0);
      if (fract((a + 3.1416) * 9.0 / 6.2832 * 4.0) < 0.09) c *= 0.35;        // radial joints between the voussoirs
      if (t > 0.92) c *= 0.55;                                              // its outer arris in shadow
      return lin(c);
    }
    if (r < 10.0) {                                                         // the hub: a bronze dome
      float lam = dot(n, Ld) * (r / 10.0);
      vec3 c = vec3(0.50, 0.35, 0.17) * (lam > 0.4 ? 1.5 : lam > 0.0 ? 1.15 : lam > -0.45 ? 0.85 : 0.6);
      if (r > 8.8) c *= 0.55;
      if (abs(length(d - Ld * 3.0)) < 1.2) c = vec3(0.95, 0.80, 0.52);       // its highlight
      return lin(c);
    }
    // a grate bar: iron, lit where it meets the opening above or to the left, shaded below and right
    bool openU = bgAt(ip + ivec2(0, -1)) == 1, openL = bgAt(ip + ivec2(-1, 0)) == 1;
    bool openD = bgAt(ip + ivec2(0, 1)) == 1, openR = bgAt(ip + ivec2(1, 0)) == 1;
    vec3 c = vec3(0.23, 0.22, 0.27);
    if (openU || openL) c = vec3(0.50, 0.48, 0.55);
    else if (openD || openR) c = vec3(0.10, 0.095, 0.13);
    if (!openU && !openL && !openD && !openR && h21(wp) > 0.93) c = vec3(0.36, 0.22, 0.14);   // a fleck of rust inside the bar
    return lin(c);
  }

  // ---------- F: foreground framing ----------
  // a dark, near plane that slides faster than the room; returns alpha in .a
  // overStone: this pixel is the room's own stone below the floor line, the only
  // place the near silhouettes may cover; chains may hang over the air.
  vec4 foreground(vec2 wp, bool overStone) {
    vec2 f = floor(wp + (wp - uCamC) * 0.3);
    vec4 o = vec4(0.0);
    // along the foot of the frame: broken column stubs, a run of balustrade, rubble
    if (overStone && wp.y > arcFloor() - 2.0) {
      float base = arcFloor() + 46.0;
      float sid2 = floor(f.x / 90.0), sx = f.x - sid2 * 90.0;
      float r = h21(vec2(sid2, 51.0));
      float hgt = 4.0 + floor(4.0 * vnoise(vec2(f.x * 0.09, 3.0)));                     // rubble
      if (r > 0.55 && sx > 20.0 && sx < 34.0) hgt = 14.0 + floor(10.0 * h21(vec2(sid2, 53.0))) - (sx > 31.0 ? 2.0 : 0.0);   // a column stub, its top broken
      else if (r < 0.3 && sx > 40.0 && sx < 80.0) hgt = mod(sx, 6.0) < 3.0 ? 9.0 : 11.0;  // balustrade fragment
      float topY = base - hgt;
      if (f.y >= topY) {
        vec3 c = L3(0.03, 0.026, 0.045);
        if (f.y < topY + 1.0) c = L3(0.12, 0.12, 0.17);                                 // a cold rim along its top
        o = vec4(c, 1.0);
      }
    }
    // chains hanging from the ceiling at a few places, swinging a hair
    float cid = floor(f.x / 150.0), cx = cid * 150.0 + 40.0 + floor(50.0 * h21(vec2(cid, 3.0)));
    float clen = 30.0 + floor(60.0 * h21(vec2(cid, 7.0)));
    float sw = sin(uTime * 0.7 + cid) * f.y / 90.0;
    float dx = f.x - cx - floor(sw);
    if (h21(vec2(cid, 5.0)) > 0.45 && f.y < clen && abs(dx) < 1.5) {
      bool link = mod(f.y, 4.0) < 2.0 ? abs(dx) < 1.5 && abs(dx) > 0.4 : abs(dx) < 0.6;
      if (link) o = vec4(dx < 0.0 ? L3(0.16, 0.16, 0.21) : L3(0.05, 0.045, 0.07), 1.0);
      if (f.y > clen - 4.0 && abs(dx) < 2.5) o = vec4(L3(0.07, 0.06, 0.09), 1.0);   // a hook at the end
    }
    return o;
  }
  `;
})(window);
