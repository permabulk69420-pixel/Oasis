// The model was painted with one colour per vertex, and the stem and leaf textures were added on top later, so the two multiplied
// (about 0.1 x the texture) and the plant came out near black. The texture now sets the brightness and the vertex colours only
// keep their variation (green to rust, dark joints): each channel is divided by its average over the material, then pulled
// part of the way back to 1. Values are limited so no vertex is brighter than the texture by more than VERTEX_TINT.max.
export const VERTEX_TINT = Object.freeze({ variation: 0.85, max: 1.9 });
export const MATERIAL_BOOST = Object.freeze({ 'Mature olive stems': 1.5, 'Green to rust leaf tissue': 1.35 });

// Pure: returns a new Float32Array of the same shape with each channel averaging about 1 (see VERTEX_TINT).
export function normaliseVertexColours(array, itemSize, tint = VERTEX_TINT) {
  const count = array.length / itemSize;
  const mean = new Array(itemSize).fill(0);
  for (let i = 0; i < array.length; i++) mean[i % itemSize] += array[i];
  for (let c = 0; c < itemSize; c++) mean[c] /= count || 1;
  const out = new Float32Array(array.length);
  for (let i = 0; i < array.length; i++) {
    const c = i % itemSize;
    if (c === 3 && itemSize === 4) { out[i] = array[i]; continue; }
    const ratio = mean[c] > 1e-6 ? array[i] / mean[c] : 1;
    out[i] = Math.min(tint.max, 1 + (ratio - 1) * tint.variation);
  }
  return out;
}
