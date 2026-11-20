// INTENT (migration step 5, plan section 2.9): the one struct the sim will consume, per player per frame. This is a WRAPPER: it converts today's `inp`
// (what game.js, the bots and the tests hand to Sim.step) to an Intent and back, exactly, so nothing has to change yet.
//   Intent = { cursor:{x,y}, aim:{dx,dy,power}|null, stick:{x,y}|null, buttons:{pour,repel,charge,freeze,blade,strike}, pressed:[names], released:[names] }
// `aim` is the virtual-stick aim (inp.stick, bug 3) as a unit direction and a power 0..1 against aimLen; null when the aim is the old anchor-minus-cursor form.
// `stick` keeps the raw pull so the round trip is exact. freeze = inp.harden. Space (sim.spacePress()) and Super (sim.startSuper()) are method calls, not
// inp keys; they are not part of this wrapper yet.
(function (root) {
  const KEYS = [['pour', 'pour'], ['repel', 'repel'], ['charge', 'charge'], ['freeze', 'harden'], ['blade', 'blade'], ['strike', 'strike']];   // [intent button, inp key]
  const NAMES = KEYS.map((k) => k[0]);
  function fromInp(inp, prev, aimLen) {
    const buttons = {}; for (const [b, k] of KEYS) buttons[b] = !!inp[k];
    const pressed = [], released = [];
    if (prev) for (const b of NAMES) { if (buttons[b] && !prev.buttons[b]) pressed.push(b); else if (!buttons[b] && prev.buttons[b]) released.push(b); }
    else for (const b of NAMES) if (buttons[b]) pressed.push(b);
    let aim = null, stick = null;
    if (inp.stick) {
      stick = { x: inp.stick.x, y: inp.stick.y }; const d = Math.hypot(stick.x, stick.y), L = aimLen || 70;
      aim = { dx: d > 0.001 ? stick.x / d : 0, dy: d > 0.001 ? stick.y / d : 0, power: Math.min(1, d / L) };
    }
    return { cursor: { x: inp.x, y: inp.y }, aim, stick, buttons, pressed, released };
  }
  // back to the object the sim reads. Only the keys the sim reads are written (x, y, the six buttons, stick when present).
  function toInp(intent) {
    const inp = { x: intent.cursor.x, y: intent.cursor.y, pour: false, charge: false, harden: false, blade: false, strike: false };
    for (const [b, k] of KEYS) inp[k] = !!intent.buttons[b];
    if (intent.stick) inp.stick = { x: intent.stick.x, y: intent.stick.y };
    return inp;
  }
  const api = { fromInp, toInp, BUTTONS: NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SpillIntent = api;
})(typeof window !== 'undefined' ? window : globalThis);
