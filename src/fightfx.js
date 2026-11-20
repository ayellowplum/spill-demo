// Fight camera and screen effects: what the lens does when blows land.
// Everything here is read by renderer.js's composite pass (opts.cine) and by
// game.js's view (kx, ky). Nothing is drawn as a shape: the picture itself is
// pushed, bent and held, so the player's sand and every telegraph stay on top.
//   kick     the camera is knocked along the blow's direction and springs back
//   punch    a short push in toward the impact, eased out
//   shock    the image bends outward in one travelling front from a heavy impact
//   fringe   a few frames of split colour on the heaviest hits
//   impact   one or two frames of a two-tone negative, kept for kills and the biggest moments
//   tension  while a Warden winds up, the world drains a little colour and the frame closes in
(function (root) {
  'use strict';
  const MAXW = 3;
  class Fight {
    constructor() { this.clear(); }
    clear() {
      this.kx = 0; this.ky = 0; this.vx = 0; this.vy = 0;
      this.punch = 0; this.punchV = 0; this.pc = { x: 0, y: 0 };
      this.waves = []; this.fringe = 0; this.impact = 0; this.impactHold = 0;
      this.tension = 0; this.tensionT = 0; this.last = null;
    }
    // knock the camera along (dx, dy) by s world pixels
    knock(dx, dy, s) { const l = Math.hypot(dx, dy) || 1; this.vx += dx / l * s * 0.55; this.vy += dy / l * s * 0.55; }
    push(x, y, a) { if (a >= this.punch) { this.pc = { x, y }; this.punchV = Math.max(this.punchV, a); } }
    shock(x, y, s, speed, r0) { this.waves.push({ x, y, r: r0 || 2, s, v: speed || 3.2, life: 1 }); if (this.waves.length > MAXW) this.waves.shift(); }   // (a negative speed from a wide r0 draws the wave back in)
    hold(n, a) { this.impactHold = Math.max(this.impactHold, n); this.impact = Math.max(this.impact, a); }
    event(e) {
      switch (e.type) {
        case 'stun': {
          const heavy = e.kind === 'bury' || e.kind === 'spike', mid = e.kind === 'juggle' || e.kind === 'slam';
          this.knock(e.dir || 1, heavy ? 0.4 : 0.15, heavy ? 3.2 : mid ? 2 : 1.2);
          if (heavy || mid) this.push(e.x, e.y, heavy ? 0.035 : 0.018);
          if (heavy) this.fringe = Math.max(this.fringe, 0.55);
          if (e.far >= 2) { this.push(e.x, e.y, 0.03); this.fringe = Math.max(this.fringe, 0.5); this.shock(e.x, e.y, 0.9, 3.6); }   // a long shot lands
          else if (e.far >= 1) this.push(e.x, e.y, 0.016);
          break;
        }
        case 'fallDamage':                                  // a hard landing: the floor jolts the frame down
          this.knock(0, 1, 1.4 + Math.min(4, e.dmg || 0) * 0.6); if ((e.dmg || 0) >= 4) this.push(e.x, e.y, 0.018); break;
        case 'crit':
          this.push(e.x, e.y, 0.045); this.fringe = Math.max(this.fringe, 0.8); this.shock(e.x, e.y, 1.2, 3.6); break;
        case 'slam': {
          const p = e.power || 0, dx = e.dx || 0, dy = e.dy == null ? 1 : e.dy;
          this.knock(dx, dy, 1.6 + p * 3.4);
          if (p > 0.35) { this.shock(e.x, e.y, 0.8 + p * 1.4, 3 + p * 1.5); this.push(e.x, e.y, 0.012 + p * 0.03); }
          break;
        }
        case 'hammer': {
          const p = e.power || 0;
          this.knock(0, 1, 3 + p * 5); this.shock(e.x, e.y, 1.3 + p * 1.6, 3.4 + p * 1.6); this.push(e.x, e.y - 6, 0.03 + p * 0.045);
          this.fringe = Math.max(this.fringe, 0.4 + p * 0.5);
          if (p > 0.9) this.hold(2, 0.85);                   // a full charge: the frame is cut to three tones for an instant
          break;
        }
        case 'boltBoom':
          if (e.on !== 'air') { this.knock(Math.cos(e.a), Math.sin(e.a), 1.6); this.shock(e.x, e.y, 0.7, 3); }
          break;
        case 'foeDie':
          if (e.tier === 'warden') { this.hold(3, 0.9); this.push(e.x, e.y, 0.07); this.shock(e.x, e.y, 2.4, 4.2); this.fringe = 1; this.knock(0, 1, 6); this.tension = 0; this.tensionT = 0; }
          else { this.push(e.x, e.y, 0.02); this.knock(0, 1, 1.5); }
          break;
        case 'bossHit':
          this.push(e.x, e.y, e.heavy ? 0.04 : 0.02); this.knock(0, -1, e.heavy ? 3 : 1.6);
          if (e.heavy) { this.hold(2, 0.7); this.shock(e.x, e.y, 1.4, 3.6); this.fringe = Math.max(this.fringe, 0.7); }
          break;
        case 'parry':                                      // frequent now: a cold push and a shock, no impact frame
          this.push(e.x, e.y, 0.04); this.shock(e.x, e.y, 1.3, 3.8); this.fringe = Math.max(this.fringe, 0.45); break;
        case 'harden':
          this.push(e.x, e.y, 0.012); this.fringe = Math.max(this.fringe, 0.2); break;
        case 'guardBreak':
          this.push(e.x, e.y, 0.03); this.fringe = Math.max(this.fringe, 0.5); this.knock(0, 1, 2); break;
        case 'wardenWindup':
          this.tensionT = 45; this.pc0 = { x: e.x, y: e.y }; break;
        case 'wardenStrike':
          this.tensionT = 0; this.knock(0, 1, 1.4); break;
        case 'stamp':
          this.knock(0, 1, 4); this.shock(e.x, e.y, 1.6, 3.4); this.fringe = Math.max(this.fringe, 0.35); break;
        case 'teethUp':
          this.knock(0, -1, 2.4); this.shock((e.x0 + e.x1) / 2, e.y, 1, 3.2); break;
        case 'stoneHit':
          this.knock(0, 1, 2.6); this.shock(e.x, e.y, 1, 3.2); break;
      }
    }
    // advance to time t (seconds) in fixed 60 Hz steps; runs on rendered frames, so the
    // camera keeps breathing through hit stop
    frame(t) {
      const dt = this.lt == null ? 1 / 60 : Math.max(0, Math.min(0.1, t - this.lt));
      this.lt = t; this.acc = (this.acc || 0) + dt;
      const n = Math.min(6, Math.floor(this.acc * 60)); this.acc -= n / 60;
      for (let k = 0; k < n; k++) {
        // a stiff, well-damped spring: one quick swing out, back with a small overshoot
        this.vx += -this.kx * 0.32; this.vy += -this.ky * 0.32;
        this.vx *= 0.62; this.vy *= 0.62;
        this.kx += this.vx; this.ky += this.vy;
        // the punch rises in two frames and eases out over about a third of a second
        if (this.punchV > 0) { this.punch += (this.punchV - this.punch) * 0.6; if (this.punch >= this.punchV * 0.95) this.punchV = 0; }
        else this.punch *= 0.86;
        for (const w of this.waves) { w.r += w.v; w.v *= 0.985; w.life -= 0.028; }
        this.waves = this.waves.filter((w) => w.life > 0 && w.r > 1);
        this.fringe *= 0.8;
        if (this.impactHold > 0) this.impactHold--; else this.impact *= 0.35;
        if (this.tensionT > 0) { this.tensionT--; this.tension += (1 - this.tension) * 0.08; } else this.tension *= 0.85;
      }
      if (Math.abs(this.kx) < 0.01) this.kx = 0;
      if (Math.abs(this.ky) < 0.01) this.ky = 0;
    }
    // what the composite pass needs
    cine() {
      const w = new Float32Array(MAXW * 4);
      this.waves.forEach((v, k) => w.set([v.x, v.y, v.r, v.s * v.life], k * 4));
      return { punch: this.punch, px: this.pc.x, py: this.pc.y, waves: w, nw: this.waves.length, fringe: this.fringe, impact: this.impact > 0.05 ? this.impact : 0, tension: this.tension };
    }
  }
  root.SpillFight = Fight;
  if (typeof module !== 'undefined' && module.exports) module.exports = Fight;
})(typeof window !== 'undefined' ? window : globalThis);
