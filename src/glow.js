import * as THREE from 'three';

// How bright a glowing detail (a trim, a bead) should be set so that it looks the same by day and by night whatever the
// tone-mapping exposure is: the night exposure is tiny, so the emissive strength is divided by it (the same trick the
// campfire's embers use). `glow` is the brightness it should look: { day, night }. Returns the emissiveIntensity.
export function exposureGlow(exposure, { day, night }) {
  const daylight = THREE.MathUtils.smoothstep(exposure, 0.07, 0.5);
  const displayed = night + (day - night) * daylight;
  return displayed / Math.max(exposure, 0.02);
}
