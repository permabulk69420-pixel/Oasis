// Testing aid (Kane, 5 Oct: the world is too big to test on foot): click both thumbsticks together in VR (T on a keyboard) to toggle
// ultra-fast movement, `multiplier` times your usual speed (walk or sprint). Each stick click alone keeps its old job (left: sprint
// toggle, right: crouch toggle), a hair late (`chordMs`) so a click of both at once can be told apart from two single clicks.
export const TURBO = Object.freeze({ multiplier: 10, chordMs: 130 });

export function createTurboChord({ chordMs = TURBO.chordMs } = {}) {
  const side = { l: { down: false, at: 0, pending: false }, r: { down: false, at: 0, pending: false } };
  let fired = false;
  // left, right: whether each thumbstick is down; now: milliseconds. Returns what to pass on as the two clicks, and whether turbo toggles now.
  function apply(left, right, now) {
    const raw = { l: Boolean(left), r: Boolean(right) };
    for (const key of ['l', 'r']) {
      if (raw[key] && !side[key].down) { side[key].at = now; side[key].pending = true; }
      side[key].down = raw[key];
    }
    if (!side.l.down && !side.r.down) fired = false;
    let toggled = false;
    if (side.l.down && side.r.down && !fired && Math.abs(side.l.at - side.r.at) <= chordMs) {
      fired = true; toggled = true; side.l.pending = side.r.pending = false;
    }
    const out = {};
    for (const key of ['l', 'r']) {
      const s = side[key];
      if (fired) out[key] = false;
      else if (s.pending && !s.down) { s.pending = false; out[key] = true; } // a short tap: one frame, after the wait
      else if (s.pending && now - s.at >= chordMs) { s.pending = false; out[key] = s.down; } // held long enough to be on its own
      else if (s.pending) out[key] = false; // waiting to see if the other stick follows
      else out[key] = s.down;
    }
    return { sprint: out.l, crouch: out.r, toggled };
  }
  return { apply };
}
