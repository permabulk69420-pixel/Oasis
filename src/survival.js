// Light survival stats: enough to feel progress, nowhere near a grind.
//
// Food and water drain slowly over real time, stamina drains while sprinting and comes back when
// you stop, and health slides down only if you let food or water hit zero. There is no death yet:
// health bottoms out at a low floor. Numbers are per second and live in one table so they are easy
// to tune. Module-level state, like inventory.js, so the menu and the world share one source.

export const STAT_MAX = 100;

export const SURVIVAL_RATES = Object.freeze({
  foodPerSecond: STAT_MAX / (35 * 60), // about 35 minutes from full to empty
  waterPerSecond: STAT_MAX / (22 * 60), // about 22 minutes
  waterRefillPerSecond: 30, // standing in the pond
  staminaSprintPerSecond: 5, // about 20 seconds of sprinting
  staminaRegenPerSecond: 12,
  staminaRegenDelay: 1.0, // seconds after sprinting stops before it comes back
  staminaMinToSprint: 15, // once exhausted, wait until this much has recovered
  starvingHealthPerSecond: 0.35, // food or water at zero
  healthRegenPerSecond: 0.45, // both food and water comfortably above the threshold
  healthRegenMinFoodWater: 35,
  healthFloor: 10, // no death for now
});

const stats = { health: STAT_MAX, stamina: STAT_MAX, food: STAT_MAX, water: STAT_MAX };
let exhausted = false;
let sinceSprint = Infinity;

const clampStat = value => Math.max(0, Math.min(STAT_MAX, value));

export function resetSurvival() {
  stats.health = stats.stamina = stats.food = stats.water = STAT_MAX;
  exhausted = false;
  sinceSprint = Infinity;
}

// Something hurts the player. Health never goes below the floor (there is no death yet). Returns the health left.
export function damagePlayer(amount) {
  const value = Number(amount);
  if (!(value > 0)) return stats.health;
  stats.health = Math.max(Math.min(stats.health, SURVIVAL_RATES.healthFloor), stats.health - value);
  return stats.health;
}

// Snapshot so callers cannot mutate the live stats.
export function getSurvivalStats() {
  return { ...stats };
}

export function canSprint() {
  return !exhausted && stats.stamina > 0;
}

export function restoreFood(amount) {
  const value = Number(amount);
  if (!(value > 0)) return stats.food;
  stats.food = clampStat(stats.food + value);
  return stats.food;
}

export function restoreWater(amount) {
  const value = Number(amount);
  if (!(value > 0)) return stats.water;
  stats.water = clampStat(stats.water + value);
  return stats.water;
}

// sprinting: true only while actually moving fast. inWater: feet in the pond.
export function updateSurvival(dt, { sprinting = false, inWater = false } = {}) {
  const step = Math.max(0, Math.min(Number(dt) || 0, 1));
  if (step === 0) return getSurvivalStats();
  const r = SURVIVAL_RATES;

  stats.food = clampStat(stats.food - r.foodPerSecond * step);
  stats.water = clampStat(stats.water - r.waterPerSecond * step);
  if (inWater) stats.water = clampStat(stats.water + r.waterRefillPerSecond * step);

  if (sprinting && canSprint()) {
    stats.stamina = clampStat(stats.stamina - r.staminaSprintPerSecond * step);
    sinceSprint = 0;
    if (stats.stamina <= 0) exhausted = true;
  } else {
    sinceSprint += step;
    if (sinceSprint >= r.staminaRegenDelay) {
      stats.stamina = clampStat(stats.stamina + r.staminaRegenPerSecond * step);
    }
  }
  if (exhausted && stats.stamina >= r.staminaMinToSprint) exhausted = false;

  if (stats.food <= 0 || stats.water <= 0) {
    stats.health = Math.max(r.healthFloor, stats.health - r.starvingHealthPerSecond * step);
  } else if (stats.food >= r.healthRegenMinFoodWater && stats.water >= r.healthRegenMinFoodWater) {
    stats.health = clampStat(stats.health + r.healthRegenPerSecond * step);
  }
  return getSurvivalStats();
}
