// Falling (the owner, 5 Oct: walk off the island and you should fall, and he is fine with it hurting; no death, health floors at 10 in survival.js).
// The numbers are mine. `gravity` matches the jump's. Landing slower than `safeSpeed` (a drop of about 3 m) costs nothing.
export const FALL = Object.freeze({ gravity: 12, startDrop: 0.6, safeSpeed: 9, damagePerMetrePerSecond: 2.5, maxDamage: 90 });

export function createFall() { return { active: false, speed: 0 }; }

// One step. `y` is the height of your feet's ground base, `ground` what is under you. Returns the new y and, on the step you land,
// writes `landed` (the speed you hit at, 0 otherwise) onto the state. While not falling it returns null so the caller can ease as usual.
export function stepFall(fall, y, ground, dt) {
  fall.landed = 0;
  if (!fall.active) {
    if (y - ground <= FALL.startDrop) return null;
    fall.active = true; fall.speed = 0;
  }
  fall.speed += FALL.gravity * dt;
  const next = y - fall.speed * dt;
  if (next > ground) return next;
  fall.landed = fall.speed; fall.active = false; fall.speed = 0;
  return ground;
}

export function fallDamage(speed) {
  return speed <= FALL.safeSpeed ? 0 : Math.min(FALL.maxDamage, (speed - FALL.safeSpeed) * FALL.damagePerMetrePerSecond);
}
