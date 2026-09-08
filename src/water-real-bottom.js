// Quest-friendly oasis water: keep the existing animated reflection shader, but let the
// actual terrain render through it instead of painting an opaque fake bottom in the water.
// This gives the shoreline a real sandy substrate without screen-space refraction.
export function installRealBottomWater(material, onError = console.warn) {
  if (!material?.isShaderMaterial || material.userData.realBottomWaterInstalled) return true;

  const bottomMarker = `vec3 bottom = vec3(0.42, 0.355, 0.22);
        float caustic = sin(p.x * 4.0 + wx * 0.75 + uTime * 0.5) * sin(p.y * 3.8 + wz * 0.8 - uTime * 0.4);
        bottom *= 1.0 + caustic * 0.045 * attenuation * environmentDay;
        vec3 transmission = mix(bottom, vec3(0.085, 0.235, 0.20), 1.0 - exp(-vDepth * 1.2));
        transmission *= mix(0.055, 1.0, environmentDay);`;

  const shoreMarker = `float shore = smoothstep(0.008, 0.09, vDepth);
        vec3 shoreColor = mix(vec3(0.010, 0.009, 0.007), vec3(0.32, 0.255, 0.15), environmentDay);
        color = mix(shoreColor, color, shore);`;

  const outputMarker = 'gl_FragColor = vec4(color, 1.0);';
  const shader = material.fragmentShader;
  if (!shader.includes(bottomMarker) || !shader.includes(shoreMarker) || !shader.includes(outputMarker)) {
    onError('[Oasis water] Could not install real-bottom water: shader markers changed.');
    return false;
  }

  material.fragmentShader = shader
    .replace(
      bottomMarker,
      `// The terrain itself is now the visible bottom. This colour is only the water's
        // absorption/tint layer, so shallow water stays almost clear and deeper water
        // gradually picks up the oasis green-blue colour.
        float depthAmount = 1.0 - exp(-max(vDepth, 0.0) * 0.95);
        vec3 shallowTint = vec3(0.19, 0.27, 0.22);
        vec3 deepTint = vec3(0.045, 0.19, 0.18);
        vec3 transmission = mix(shallowTint, deepTint, depthAmount);
        transmission *= mix(0.07, 1.0, environmentDay);

        // Keep a tiny moving brightness variation in the water layer itself. The real sand
        // remains visible below, so this reads as surface light rather than a painted floor.
        float caustic = sin(p.x * 4.0 + wx * 0.75 + uTime * 0.5)
          * sin(p.y * 3.8 + wz * 0.8 - uTime * 0.4);
        transmission += vec3(0.045, 0.055, 0.035)
          * caustic * attenuation * environmentDay * (1.0 - depthAmount) * 0.55;`
    )
    .replace(
      shoreMarker,
      `// Keep the physical shoreline fixed. The underlying wet terrain provides the bank;
        // only fade the water overlay smoothly into it so there is no hard polygon edge.
        float shore = smoothstep(0.008, 0.085, vDepth);
        color *= 0.88 + 0.12 * shore;`
    )
    .replace(
      outputMarker,
      `// Transparent water lets the already-rendered terrain become the real visible bottom.
        // Fresnel increases opacity at grazing angles while shallow edge-on water is nearly clear.
        float depthAlpha = 1.0 - exp(-max(vDepth, 0.0) * 0.90);
        float edgeFade = smoothstep(0.008, 0.10, vDepth);
        float waterAlpha = (0.075 + depthAlpha * 0.46 + fresnel * 0.30) * edgeFade;
        gl_FragColor = vec4(color, clamp(waterAlpha, 0.0, 0.80));`
    );

  material.transparent = true;
  material.depthWrite = false;
  material.userData.realBottomWaterInstalled = true;
  material.needsUpdate = true;
  return true;
}
