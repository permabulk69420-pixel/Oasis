import * as THREE from 'three';

// The night sky beyond the stars: a moon with a face and a phase, the Milky Way, the odd shooting star, and the great ringed planet this
// moon circles. All of it is a few lines of the sky shader (no textures, no extra draw calls), added after tone mapping
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

// The planet this moon circles. The moon always shows it the same face, so it hangs in one place in the sky for ever: it does not rise or set
// with the sun. It stands to the right of where you first look (the pond), a good way up, and well away from the sun's and the moon's paths
// (which are in sun-path.js). It is lit by the sun, so it goes through phases, from a thin crescent to nearly half, as the day turns.
export const PLANET = Object.freeze({
  azimuth: THREE.MathUtils.degToRad(-28), // the angle of its direction in the x-z plane
  elevation: THREE.MathUtils.degToRad(21),
  radius: 0.085, // radians: the disc is about 10 degrees across, three moons, and the rings reach twice as far out again
  ringInner: 1.22, // the rings, in planet radii from its centre
  ringOuter: 2.28,
  tilt: THREE.MathUtils.degToRad(69), // the angle between its spin axis (the rings' normal) and your line of sight: 90 would show the rings edge on
  roll: THREE.MathUtils.degToRad(22), // how far the axis leans over on the sky, towards the right
});

// Its frame: dir towards it, right and up across the sky, and the spin axis written in that frame (x right, y up, z towards you).
const planetDir = new THREE.Vector3(
  Math.cos(PLANET.elevation) * Math.cos(PLANET.azimuth), Math.sin(PLANET.elevation), Math.cos(PLANET.elevation) * Math.sin(PLANET.azimuth),
).normalize();
const planetRight = new THREE.Vector3().crossVectors(planetDir, new THREE.Vector3(0, 1, 0)).normalize();
const planetUp = new THREE.Vector3().crossVectors(planetRight, planetDir).normalize();
const planetAxis = new THREE.Vector3(
  Math.sin(PLANET.tilt) * Math.sin(PLANET.roll), Math.sin(PLANET.tilt) * Math.cos(PLANET.roll), Math.cos(PLANET.tilt),
).normalize();
export const PLANET_FRAME = Object.freeze({
  dir: planetDir,
  right: planetRight,
  up: planetUp,
  axis: planetAxis,
  bound: Math.cos(Math.min(PLANET.ringOuter * PLANET.radius * 1.12, 0.6)), // cosine of the angle that holds the whole system
});

// Does the planet (its disc, or the thick of its rings) hide a star in direction `dir` (a unit vector)? The stars use this to leave the
// planet's patch of sky empty, so none shine through it. The same geometry is in the shader: the planet is drawn as if seen from far away.
export function planetCovers(dir) {
  const f = PLANET_FRAME;
  if (dir.dot(f.dir) < f.bound) return false;
  const x = dir.dot(f.right) / PLANET.radius;
  const y = dir.dot(f.up) / PLANET.radius;
  const r2 = x * x + y * y;
  if (r2 < 1.1) return true;
  const z = -(f.axis.x * x + f.axis.y * y) / f.axis.z; // where the line of sight crosses the rings' plane
  const rho = Math.sqrt(r2 + z * z);
  return rho > PLANET.ringInner && rho < PLANET.ringOuter;
}

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
  const vec3 PL_DIR = ${vec3(PLANET_FRAME.dir)};
  const vec3 PL_RIGHT = ${vec3(PLANET_FRAME.right)};
  const vec3 PL_UP = ${vec3(PLANET_FRAME.up)};
  const vec3 PL_AXIS = ${vec3(PLANET_FRAME.axis)};
  const float PL_RADIUS = ${PLANET.radius.toFixed(4)};
  const float PL_RING_IN = ${PLANET.ringInner.toFixed(4)};
  const float PL_RING_OUT = ${PLANET.ringOuter.toFixed(4)};
  const float PL_BOUND = ${PLANET_FRAME.bound.toFixed(6)};

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

  // How solid the rings are, rho planet radii from its centre (0 outside them): a faint inner ring, a bright wide one, a dark gap, a
  // thinner outer ring, and a hair-thin gap near the edge, with fine ringlets that are too slow to shimmer.
  float ringDensity(float rho) {
    float t = (rho - PL_RING_IN) / (PL_RING_OUT - PL_RING_IN);
    if (t <= 0.0 || t >= 1.0) return 0.0;
    float edge = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.93, 1.0, t));
    float d = mix(0.16, 0.94, smoothstep(0.17, 0.30, t));
    d *= 1.0 - 0.94 * smoothstep(0.58, 0.63, t) * (1.0 - smoothstep(0.69, 0.74, t));
    d *= mix(1.0, 0.72, smoothstep(0.72, 0.78, t));
    d *= 1.0 - 0.80 * smoothstep(0.88, 0.91, t) * (1.0 - smoothstep(0.925, 0.96, t));
    d *= 0.93 + 0.07 * sin(t * 37.0 + 0.8);
    return d * edge;
  }

  // The ringed planet this moon circles: a banded teal gas giant with cream rings, lit by the sun so it has phases, the rings
  // throwing their shadow on it and it throwing its on them. Drawn as seen from far off (flat, no perspective). Returns premultiplied
  // colour and coverage to lay over the finished sky: by night all of it, the dark side as a dim disc against the stars; by day
  // only the sunlit part and the rings, pale, as if seen through the blue.
  vec4 planetLight(vec3 ray, float daylight) {
    if (dot(ray, PL_DIR) < PL_BOUND) return vec4(0.0);
    vec2 p = vec2(dot(ray, PL_RIGHT), dot(ray, PL_UP)) / PL_RADIUS;
    float r2 = dot(p, p);
    vec3 L = vec3(dot(uSun, PL_RIGHT), dot(uSun, PL_UP), -dot(uSun, PL_DIR)); // the sun, in the planet's frame
    vec3 N = PL_AXIS;

    // the rings: where this line of sight crosses their plane
    float zr = -(N.x * p.x + N.y * p.y) / N.z;
    float rho = sqrt(r2 + zr * zr);
    float density = ringDensity(rho);
    vec3 ringPoint = vec3(p, zr);
    float underSun = dot(L, N);
    float sunSide = smoothstep(-0.3, 0.3, underSun * N.z);           // the face you see is the lit one
    float grazing = 0.30 + 0.70 * smoothstep(0.0, 0.5, abs(underSun)); // lit edge on, they are faint
    float along = dot(ringPoint, L);
    float clear = along < 0.0 ? smoothstep(0.93, 1.03, sqrt(max(dot(ringPoint, ringPoint) - along * along, 0.0))) : 1.0; // the planet's shadow
    float across = clamp((rho - PL_RING_IN) / (PL_RING_OUT - PL_RING_IN), 0.0, 1.0);
    vec3 ringTint = mix(vec3(0.95, 0.86, 0.68), vec3(0.76, 0.84, 0.82), smoothstep(0.35, 0.9, across));
    vec3 ringColour = ringTint * (0.30 + 0.70 * sunSide) * grazing * (0.05 + 0.95 * clear);

    // the planet itself
    float radial = sqrt(r2);
    float cover = 1.0 - smoothstep(0.985, 1.0, radial);
    vec3 bodyColour = vec3(0.0);
    float lit = 0.0;
    float zs = sqrt(max(1.0 - r2, 0.0));
    if (cover > 0.0) {
      vec3 n = vec3(p, zs);
      lit = smoothstep(-0.05, 0.30, dot(n, L));
      float lat = dot(n, N);
      vec3 t1 = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
      vec3 t2 = cross(N, t1);
      float lon = atan(dot(n, t2), dot(n, t1)) * 0.3183099;            // -1 to 1 round the planet: two whole texture repeats, so no seam
      vec2 uv = vec2(lon + uCloudTime * 0.0006, lat * 0.5);
      float warp = (texture2D(uCloudMap, uv * vec2(1.0, 1.7)).r - 0.5) * 0.9 + (texture2D(uCloudMap, uv * vec2(2.0, 3.1) + 0.3).g - 0.5) * 0.35;
      float b1 = 0.5 + 0.5 * sin(lat * 17.0 + warp * 4.0 + 0.6);
      float b2 = 0.5 + 0.5 * sin(lat * 7.0 - warp * 3.0 + 2.2);
      vec3 col = mix(vec3(0.16, 0.42, 0.50), vec3(0.50, 0.78, 0.74), b1);
      col = mix(col, vec3(0.86, 0.80, 0.62), smoothstep(0.58, 0.92, b2) * 0.55);
      col = mix(col, vec3(0.62, 0.40, 0.30), smoothstep(0.86, 1.0, 0.5 + 0.5 * sin(lat * 29.0 + warp * 6.0)) * 0.30);
      col = mix(col, vec3(0.12, 0.26, 0.34), smoothstep(0.72, 0.97, abs(lat)) * 0.65);
      // the rings' shadow: follow the sun's ray from this point out to the rings' plane
      float ringShadow = 0.0;
      if (abs(underSun) > 0.04) {
        float s = -dot(n, N) / underSun;
        if (s > 0.0) ringShadow = ringDensity(length(n + L * s));
      }
      float limb = 0.55 + 0.45 * pow(zs, 0.4);
      float rim = pow(1.0 - zs, 3.0);
      bodyColour = col * limb * (0.02 + 0.98 * lit * (1.0 - 0.8 * ringShadow)) + vec3(0.25, 0.55, 0.58) * rim * (0.45 * lit + 0.06);
    }

    float gain = mix(0.30, 0.85, daylight);
    float bodyAlpha = cover * mix(1.0, 0.62 * smoothstep(0.03, 0.30, lit), daylight);
    float ringAlpha = density * mix(1.0, 0.55, daylight);
    vec3 bodyRGB = bodyColour * gain;
    vec3 ringRGB = ringColour * gain;
    bool ringInFront = zr > zs;                                         // the near half of the rings crosses in front of the planet
    float alpha = ringInFront ? ringAlpha + (1.0 - ringAlpha) * bodyAlpha : bodyAlpha + (1.0 - bodyAlpha) * ringAlpha;
    vec3 premultiplied = ringInFront ? ringRGB * ringAlpha + (1.0 - ringAlpha) * bodyRGB * bodyAlpha
                                     : bodyRGB * bodyAlpha + (1.0 - bodyAlpha) * ringRGB * ringAlpha;
    return vec4(premultiplied, alpha);
  }
`;
