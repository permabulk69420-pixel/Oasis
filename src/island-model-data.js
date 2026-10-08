// Points on each giant tree's limbs where a vine curtain may hang, in the model's own metres (src/island-jungle-layout.js layoutTreeVines reads them before any
// file has loaded). They belong to the tree models in public/models/island/jungle{A,B,C}_lod*.glb: when a tree is remade, its points are updated here with it
// (its Blender script prints them).
export const VINE_ANCHORS = Object.freeze({
  jungleA: Object.freeze([[4.188, 15.279, 1.291], [6.229, 17.696, 3.041], [-2.108, 16.297, 1.812], [-3.906, 18.046, 2.546], [1.971, 19.207, -2.107], [2.993, 21.465, -3.721], [1.691, 21.1, 2.397], [1.898, 23.137, 3.693], [-0.802, 22.034, -0.292], [-1.722, 23.814, -0.872], [2.574, 24.351, -0.267], [3.655, 26.365, -0.802]]),
  jungleB: Object.freeze([[3.604, 19.054, 2.06], [5.576, 22.223, 3.82], [-3.517, 19.957, 1.954], [-5.888, 22.045, 2.802], [1.554, 21.917, -2.458], [2.565, 24.111, -4.314], [0.053, 24.198, 2.844], [0.158, 26.695, 4.537], [-2.524, 26.761, -1.482], [-3.6, 29.363, -2.435], [1.403, 28.713, -0.14], [2.649, 31.198, -0.433], [-2.326, 30.154, 1.937], [-3.381, 32.448, 2.801]]),
  jungleC: Object.freeze([[3.525, 12.617, 1.78], [5.234, 14.675, 2.743], [-1.041, 14.646, 1.423], [-2.262, 16.435, 2.501], [2.119, 16.199, -1.534], [2.497, 18.003, -2.967], [2.258, 17.831, 2.273], [2.463, 19.562, 3.284], [0.648, 18.853, 0.655], [-0.218, 20.149, 0.305]]),
});
