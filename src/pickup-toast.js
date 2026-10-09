// The little "+3 Wood" notes the watch shows when you gather something. Pure bookkeeping, so it can be tested without a canvas:
// gains of the same thing that arrive close together merge into one line (felling a tree and picking up its logs reads "+2 Wood",
// not two notes), a few lines can show at once, and each holds for a moment then fades.
export const TOAST = Object.freeze({
  mergeWindow: 1.6, // seconds since the last gain of the same thing in which a new one adds to it
  hold: 2.0, // seconds a line stays fully visible after its last gain
  fade: 0.5, // seconds it then takes to fade out
  maxLines: 2,
});

export function createPickupToasts(config = TOAST) {
  let lines = []; // newest last: { label, amount, age }

  function add(label, amount = 1) {
    if (!label || !(amount > 0)) return;
    const same = lines.find(line => line.label === label && line.age < config.mergeWindow);
    if (same) { same.amount += amount; same.age = 0; return; }
    lines.push({ label, amount, age: 0 });
    if (lines.length > config.maxLines) lines.shift();
  }

  function update(dt) {
    for (const line of lines) line.age += dt;
    lines = lines.filter(line => line.age < config.hold + config.fade);
  }

  const alpha = line => (line.age <= config.hold ? 1 : Math.max(0, 1 - (line.age - config.hold) / config.fade));

  return {
    add,
    update,
    active: () => lines.length > 0,
    // what to draw: oldest first, with how opaque each is
    visible: () => lines.map(line => ({ text: `+${line.amount} ${line.label}`, alpha: alpha(line) })),
    // changes whenever what is drawn would change, so the watch redraws only then
    signature: () => lines.map(line => `${line.label}${line.amount}${Math.round(alpha(line) * 8)}`).join('|'),
    clear() { lines = []; },
  };
}
