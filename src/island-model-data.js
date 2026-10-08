// Points on each giant tree's limbs where a vine curtain may hang, in the model's own metres (src/island-jungle-layout.js layoutTreeVines reads them before any
// file has loaded). They belong to the tree models in public/models/island/jungle{A,B,C}_lod*.glb: when a tree is remade, its points are updated here with it
// (its Blender script prints them).
export const VINE_ANCHORS = Object.freeze({
  jungleA: Object.freeze([[3.176, 18.566, 0.427], [4.201, 21.601, -1.208], [5.489, 24.32, -1.344], [-1.913, 20.439, -2.22], [-3.696, 23.701, -2.039], [-4.308, 26.845, -3.475], [0.134, 21.657, 3.264], [1.693, 24.701, 4.128], [0.181, 27.113, 5.279], [2.163, 21.509, -2.644], [2.343, 24.101, -4.095], [2.695, 26.335, -4.629]]),
  jungleB: Object.freeze([[3.604, 19.054, 2.06], [5.576, 22.223, 3.82], [-3.517, 19.957, 1.954], [-5.888, 22.045, 2.802], [1.554, 21.917, -2.458], [2.565, 24.111, -4.314], [0.053, 24.198, 2.844], [0.158, 26.695, 4.537], [-2.524, 26.761, -1.482], [-3.6, 29.363, -2.435], [1.403, 28.713, -0.14], [2.649, 31.198, -0.433], [-2.326, 30.154, 1.937], [-3.381, 32.448, 2.801]]),
  jungleC: Object.freeze([[3.525, 12.617, 1.78], [5.234, 14.675, 2.743], [-1.041, 14.646, 1.423], [-2.262, 16.435, 2.501], [2.119, 16.199, -1.534], [2.497, 18.003, -2.967], [2.258, 17.831, 2.273], [2.463, 19.562, 3.284], [0.648, 18.853, 0.655], [-0.218, 20.149, 0.305]]),
});
