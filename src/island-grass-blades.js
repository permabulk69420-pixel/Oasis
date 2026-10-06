import * as THREE from 'three';

// The island's own grass blade patch (the owner, 6 Oct: the grass "looks trash": lime, rigid, every blade the same). The oasis keeps its blade patch (oasis-grass-ring.js, the look he
// accepted there); the island gets this one: the same number of blades and the same triangle count, but blades of three kinds (short wide ground cover, ordinary, tall and
// drooping), tapering to a true point, arching over at the tip, and a colour that runs dark at the root to lighter at the tip (a vertex colour, multiplied by the instance's
// tint), so a patch has a body and the tips are not all lit the same lime.
export const ISLAND_RICH_BLADES = 12;
export const ISLAND_LITE_BLADES = 6;
export const ISLAND_RICH_TRIANGLES = ISLAND_RICH_BLADES * 4;     // two ribbon segments per blade
export const ISLAND_LITE_TRIANGLES = ISLAND_LITE_BLADES * 2;     // one ribbon segment per blade

// The vertex colour along a blade (multiplies the patch tint): root, then tip.
export const BLADE_ROOT = Object.freeze([0.42, 0.52, 0.47]);
export const BLADE_TIP = Object.freeze([0.95, 1.0, 0.90]);

const lerp = (a, b, t) => a + (b - a) * t;
const fract = v => v - Math.floor(v);
// A fixed number 0..1 for a blade and a purpose (no Math.random: the same patch every run).
const hash = (blade, purpose) => fract(Math.sin(blade * 12.9898 + purpose * 78.233) * 43758.5453);

export function createIslandPatchGeometry(bladeCount, segments, rich) {
  const positions = [], colours = [], indices = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  let vertexIndex = 0;
  for (let blade = 0; blade < bladeCount; blade++) {
    const r = purpose => hash(blade + (rich ? 0 : 101), purpose);
    const radialT = Math.sqrt((blade + 0.45) / bladeCount);
    const angle = blade * golden + r(1) * 0.6;
    const rootRadius = radialT * (rich ? 0.46 : 0.43);
    const rootX = Math.cos(angle) * rootRadius, rootZ = Math.sin(angle) * rootRadius;

    // three kinds of blade: short and wide (the cover under the rest), ordinary, and tall and drooping
    const kind = r(2);
    let height, half, droop;
    if (kind < 0.25) { height = lerp(0.15, 0.26, r(3)); half = lerp(0.030, 0.040, r(4)); droop = lerp(0.05, 0.15, r(5)); }
    else if (kind < 0.75) { height = lerp(0.28, 0.44, r(3)); half = lerp(0.022, 0.030, r(4)); droop = lerp(0.10, 0.25, r(5)); }
    else { height = lerp(0.46, 0.58, r(3)); half = lerp(0.017, 0.024, r(4)); droop = lerp(0.18, 0.40, r(5)); }
    height *= 1.2;                                          // (the arch below takes a tenth to two fifths off the tip, so this keeps the grass as tall as the oasis's)
    if (!rich) { height *= 0.92; half *= 1.15; }          // the far patch has fewer blades, so each is a little wider
    const lean = lerp(0.04, 0.20, r(6)) * (0.6 + height);   // metres the tip leans sideways
    const leanAngle = angle + (r(7) - 0.5) * 1.4;
    const dirX = Math.cos(leanAngle), dirZ = Math.sin(leanAngle);
    const tone = 0.86 + 0.28 * r(8);                        // this blade a little lighter or darker than its neighbours

    for (let segment = 0; segment <= segments; segment++) {
      const t = segment / segments;
      const curve = Math.pow(t, 1.8);
      const cx = rootX + dirX * lean * curve, cz = rootZ + dirZ * lean * curve;
      const y = height * (t - droop * t * t);               // the tip arches over (droop at most 0.4, so y still rises all the way)
      const taper = 1 - 0.97 * Math.pow(t, 1.2);            // to a point
      const wx = -dirZ * half * taper, wz = dirX * half * taper;
      positions.push(cx - wx, y, cz - wz, cx + wx, y, cz + wz);
      const g = Math.pow(t, 0.8);
      for (let side = 0; side < 2; side++) {
        colours.push(
          lerp(BLADE_ROOT[0], BLADE_TIP[0], g) * tone,
          lerp(BLADE_ROOT[1], BLADE_TIP[1], g) * tone,
          lerp(BLADE_ROOT[2], BLADE_TIP[2], g) * tone,
        );
      }
    }
    for (let segment = 0; segment < segments; segment++) {
      const a = vertexIndex + segment * 2, c = a + 2;
      indices.push(a, a + 1, c, a + 1, c + 1, c);
    }
    vertexIndex += (segments + 1) * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
