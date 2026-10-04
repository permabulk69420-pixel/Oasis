import * as THREE from 'three';

// The night sky beyond the stars: a moon with a face and a phase, the Milky Way, and the odd shooting star.
// All of it is a few lines of the sky shader (no textures, no extra draw calls), added after tone mapping
// like the rest of the night's light, and it fades with the sun. The stars themselves are in day-night.js
// and are scattered thicker along the same band, so the two line up.

// The band of the Milky Way is a great circle. N is its normal; A and B span the plane. It touches the
// horizon to the north-east, rises toward the zenith and comes down again behind the player's start view;
// the brightest part (the "core") sits about 34 degrees up on the other side.
const normal = new THREE.Vector3(0.80, 0.20, 0.55).normalize();
const axisA = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize();
const axisB = new THREE.Vector3().crossVectors(normal, axisA);
const CORE_ANGLE = -0.6;
const core = axisA.clone().multiplyScalar(Math.cos(CORE_ANGLE)).addScaledVector(axisB, Math.sin(CORE_ANGLE)).normalize();

export const MILKY_WAY = Object.freeze({
  normal,
  axisA,
  axisB,
  core,
  sigma: 0.16, // the band's width: sine of the angle from its centre line (about 9 degrees)
  // Far from the centre line the band is skipped (no texture reads). Where it stops it has to have faded to exactly zero:
  // it used to stop at 0.02 of its peak, a step of a few levels of brightness that showed as a hard outline against the
  // dark sky, and very plainly in a headset. So this much is taken off the whole profile (see bandFalloff), which leaves
  // the look alone and brings the edge down to nothing.
  cut: 0.004,
});

// The band's brightness across its width, from the plain bell curve (1 on the centre line) to 0 at the cut. The same
// arithmetic is in the sky shader below.
export function bandFalloff(bell, cut = MILKY_WAY.cut) {
  return Math.max(0, (bell - cut) / (1 - cut));
}

// A point on the sky at galactic longitude `lon` and latitude `lat` (radians), as a unit vector.
export function milkyWayPoint(lon, lat, target = new THREE.Vector3()) {
  const along = axisA.clone().multiplyScalar(Math.cos(lon)).addScaledVector(axisB, Math.sin(lon));
  return target.copy(along).multiplyScalar(Math.cos(lat)).addScaledVector(normal, Math.sin(lat)).normalize();
}

export const MOON = Object.freeze({
  radius: 0.030, // radians: about 3.4 degrees across, bigger than the real one so it reads in VR
});

const vec3 = v => `vec3(${v.x.toFixed(6)}, ${v.y.toFixed(6)}, ${v.z.toFixed(6)})`;

// Needs uSun, uCloudMap and uCloudTime (from the atmosphere chunk) in scope. Returns linear light to ADD after
// tone mapping; the caller scales it by how dark it is.
export const NIGHT_SKY_GLSL = /* glsl */`
  const vec3 MW_N = ${vec3(MILKY_WAY.normal)};
  const vec3 MW_A = ${vec3(MILKY_WAY.axisA)};
  const vec3 MW_CORE = ${vec3(MILKY_WAY.core)};
  const float MW_SIGMA = ${MILKY_WAY.sigma.toFixed(4)};
  const float MW_CUT = ${MILKY_WAY.cut.toFixed(4)};
  const float MOON_RADIUS = ${MOON.radius.toFixed(4)};

  // A hash without sin(): sin of a big number is not reliable across GPUs, and this one is the same everywhere.
  float nightHash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

  // The moon sits opposite the sun: a lit sphere showing a waxing gibbous, with dark seas and a soft halo.
  vec3 moonLight(vec3 ray) {
    vec3 m = -uSun;
    float c = dot(ray, m);
    if (c < 0.90) return vec3(0.0);
    vec3 right = normalize(cross(abs(m.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), m));
    vec3 up = cross(m, right);
    vec2 p = vec2(dot(ray, right), dot(ray, up)) / MOON_RADIUS;
    float d = length(p);
    // low in the sky the moon is warm, higher up it is white
    vec3 tint = mix(vec3(1.0, 0.70, 0.52), vec3(0.86, 0.92, 1.0), smoothstep(0.0, 0.33, m.y));
    float wide = smoothstep(0.90, 1.0, c); // reaches zero before the cut-off above, so there is no visible edge
    float halo = pow(max(c, 0.0), 220.0) * 0.55 + wide * wide * wide * 0.05;
    vec3 colour = tint * halo * 0.10;
    if (d < 1.04) {
      float z = sqrt(max(1.0 - d * d, 0.0));
      vec3 n = vec3(p, z);
      float lit = smoothstep(-0.04, 0.16, dot(n, normalize(vec3(0.78, 0.22, 0.58))));
      float seas = texture2D(uCloudMap, p * 0.17 + vec2(0.42, 0.66)).g;
      float craters = texture2D(uCloudMap, p * 0.9 + vec2(0.13, 0.31)).g;
      float surface = 1.0 - 0.34 * smoothstep(0.46, 0.62, seas) - 0.10 * craters;
      float limb = pow(max(z, 0.0), 0.32);
      vec3 disc = vec3(0.70, 0.73, 0.80) * surface * limb * lit;
      disc += vec3(0.012, 0.016, 0.026) * (1.0 - lit) * limb; // earthshine on the dark part
      colour += tint * disc * (1.0 - smoothstep(0.95, 1.04, d));
    }
    return colour;
  }

  // A faint diagonal river of stars with dust lanes, brighter toward its core.
  vec3 milkyWayLight(vec3 ray) {
    float lat = dot(ray, MW_N);
    float band = exp(-lat * lat / (2.0 * MW_SIGMA * MW_SIGMA));
    // fades to exactly zero where the band is skipped, so there is no edge (see MILKY_WAY.cut)
    band = (band - MW_CUT) / (1.0 - MW_CUT);
    if (band <= 0.0 || ray.y < -0.05) return vec3(0.0);
    float a = dot(ray, MW_A);
    float b = dot(ray, cross(MW_N, MW_A));
    vec2 uv = vec2(a * 2.1, b * 2.1 + lat * 3.0);
    float broad = texture2D(uCloudMap, uv * 0.30 + vec2(0.31, 0.77)).r;
    float fine = texture2D(uCloudMap, uv * 1.25 + vec2(0.71, 0.13)).g;
    float structure = clamp(0.80 + 0.9 * (broad - 0.5) + 0.22 * (fine - 0.5), 0.2, 1.5);
    // a dark lane runs down the middle of the band, wandering a little
    float lane = mix(0.62, 1.0, smoothstep(0.0, 0.05, abs(lat + (broad - 0.5) * 0.06)));
    float coreness = pow(max(dot(ray, MW_CORE), 0.0), 3.0);
    vec3 colour = mix(vec3(0.42, 0.53, 0.86), vec3(0.98, 0.78, 0.52), coreness * 0.85);
    float horizon = smoothstep(0.0, 0.22, ray.y);
    return colour * band * structure * lane * (0.40 + 1.1 * coreness) * horizon * 0.050;
  }

  // Now and then a shooting star: a thin bright streak with a fading tail, a second or so long.
  vec3 shootingStarLight(vec3 ray, float time) {
    const float PERIOD = 21.0;
    float cycle = floor(time / PERIOD);
    float s = time - cycle * PERIOD;
    float seed = cycle + 7.0;
    float h1 = nightHash(seed), h2 = nightHash(seed + 17.3), h3 = nightHash(seed * 1.7 + 3.9), h4 = nightHash(seed + 91.1);
    float start = 2.0 + h1 * 12.0;
    float duration = 0.85 + 0.55 * h2;
    float local = (s - start) / duration;
    if (h3 < 0.28 || local <= 0.0 || local >= 1.0) return vec3(0.0); // about seven cycles in ten have one
    float azimuth = h2 * 6.2831853 + h4 * 3.0;
    float elevation = 0.38 + 0.85 * h4;
    vec3 origin = vec3(cos(elevation) * cos(azimuth), sin(elevation), cos(elevation) * sin(azimuth));
    float cp = dot(ray, origin);
    if (cp < 0.5) return vec3(0.0);
    vec3 e1 = normalize(cross(origin, vec3(0.0, 1.0, 0.0)));
    vec3 e2 = cross(origin, e1);
    float angle = 3.14159 + (h1 - 0.5) * 1.4; // mostly heading down and across
    vec3 along = e1 * cos(angle) + e2 * sin(angle);
    vec3 across = cross(origin, along);
    vec2 g = vec2(dot(ray, along), dot(ray, across)) / cp; // flat map of the sky around its start
    float head = 0.62 * local;
    float tail = 0.15 + 0.10 * h2;
    float t = (g.x - (head - tail)) / tail; // 0 at the end of the tail, 1 at the head
    if (t < 0.0 || t > 1.0) return vec3(0.0);
    float width = 0.0030 + 0.0022 * t;
    float line = exp(-(g.y * g.y) / (width * width));
    float fade = sin(local * 3.14159);
    return vec3(0.80, 0.88, 1.0) * line * pow(t, 2.4) * fade * 0.85;
  }
`;
