import { noise3 } from './sky-island-shape.js';

// What the island's model builders share (src/island-flora-models.js, -trees.js, -ruins.js): the palette (linear, dark: the plants are mostly black forms and
// the glow does the talking, as on the oasis), a few colour helpers and a smooth noise.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const lc = (r, g, b) => [r, g, b];
export const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const tint = (c, d) => [c[0] + d[0], c[1] + d[1], c[2] + d[2]];
export const glow = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export const MOSS = lc(0.026, 0.085, 0.055);
export const MOSS_LIGHT = lc(0.058, 0.165, 0.100);
export const FERN = lc(0.016, 0.066, 0.046);
export const FERN_LIGHT = lc(0.030, 0.105, 0.070);
export const LEAF = lc(0.012, 0.050, 0.040);
export const LEAF_LIGHT = lc(0.026, 0.085, 0.066);
export const BARK = lc(0.040, 0.066, 0.072);
export const BARK_DARK = lc(0.022, 0.040, 0.046);
export const BARK_PALE = lc(0.075, 0.100, 0.105);
export const WOOD_CUT = lc(0.190, 0.160, 0.120);
export const BLEACHED = lc(0.150, 0.138, 0.120);
export const BLEACHED_DARK = lc(0.075, 0.070, 0.064);
export const BONE = lc(0.300, 0.282, 0.250);
export const BONE_DARK = lc(0.130, 0.122, 0.108);
export const STALK = lc(0.020, 0.062, 0.058);
export const PETAL = lc(0.200, 0.290, 0.340);
export const CAP = lc(0.030, 0.040, 0.062);
export const STEM = lc(0.070, 0.090, 0.100);
export const STONE = lc(0.052, 0.058, 0.066);
export const STONE_LIGHT = lc(0.095, 0.104, 0.112);
export const ROOT = lc(0.034, 0.052, 0.060);

export const noise1 = (x, y = 0) => noise3(x, y, 17.3);
