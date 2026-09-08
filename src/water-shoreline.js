// Lightweight shoreline animation layered onto the existing Oasis water shader.
// This changes only the shallow edge: no extra geometry, particles, textures or physics.
export function installDynamicWaterShoreline(material, onError = console.warn) {
  if (!material?.isShaderMaterial || material.userData.dynamicShorelineInstalled) return true;

  const discardMarker = 'if (vDepth <= 0.008) discard;';
  const attenuationMarker = 'float attenuation = (1.0 - smoothstep(25.0, 120.0, distance)) * smoothstep(0.0, 0.25, vDepth);';
  const transmissionMarker = 'vec3 transmission = mix(bottom, vec3(0.085, 0.235, 0.20), 1.0 - exp(-vDepth * 1.2));';
  const shoreMarker = `float shore = smoothstep(0.008, 0.09, vDepth);
        vec3 shoreColor = mix(vec3(0.010, 0.009, 0.007), vec3(0.32, 0.255, 0.15), environmentDay);
        color = mix(shoreColor, color, shore);`;

  const shader = material.fragmentShader;
  if (!shader.includes(discardMarker) || !shader.includes(shoreMarker)) {
    onError('[Oasis water] Could not install dynamic shoreline: shader markers changed.');
    return false;
  }

  material.fragmentShader = shader
    .replace(
      discardMarker,
      `// Two broad, crossing ripples make different parts of the bank advance/recede at
        // slightly different times. The influence vanishes quickly in deeper water.
        float shoreWaveA = sin(vWorld.x * 0.31 + vWorld.z * 0.19 - uTime * 0.86);
        float shoreWaveB = sin(vWorld.x * -0.17 + vWorld.z * 0.37 + uTime * 0.63 + 1.7);
        float shoreInfluence = 1.0 - smoothstep(0.015, 0.24, max(vDepth, 0.0));
        float shoreOffset = (shoreWaveA * 0.65 + shoreWaveB * 0.35) * 0.024 * shoreInfluence;
        float dynamicDepth = vDepth + shoreOffset;
        if (dynamicDepth <= 0.006) discard;`
    )
    .replace(
      attenuationMarker,
      'float attenuation = (1.0 - smoothstep(25.0, 120.0, distance)) * smoothstep(0.0, 0.25, max(dynamicDepth, 0.0));'
    )
    .replace(
      transmissionMarker,
      'vec3 transmission = mix(bottom, vec3(0.085, 0.235, 0.20), 1.0 - exp(-max(dynamicDepth, 0.0) * 1.2));'
    )
    .replace(
      shoreMarker,
      `float shore = smoothstep(0.006, 0.105, dynamicDepth);
        vec3 shoreColor = mix(vec3(0.010, 0.009, 0.007), vec3(0.32, 0.255, 0.15), environmentDay);
        color = mix(shoreColor, color, shore);

        // A narrow moving sheen follows the lapping edge. Keep it subtle so this reads as
        // wet shallow water rather than ocean foam, and fade it almost entirely at night.
        float lapBand = 1.0 - smoothstep(0.0, 0.017, abs(dynamicDepth - 0.030));
        lapBand *= 1.0 - smoothstep(0.09, 0.20, max(vDepth, 0.0));
        float lapVariation = 0.72 + 0.28 * sin(vWorld.x * 0.47 - vWorld.z * 0.39 + uTime * 1.28);
        vec3 lapTint = mix(vec3(0.006, 0.007, 0.008), vec3(0.34, 0.30, 0.22), environmentDay);
        color += lapTint * lapBand * lapVariation * (0.035 + 0.11 * environmentDay);`
    );

  material.userData.dynamicShorelineInstalled = true;
  material.needsUpdate = true;
  return true;
}
