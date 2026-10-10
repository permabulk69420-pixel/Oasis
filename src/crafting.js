import { getInventoryCount, exchangeInventoryItems } from './inventory.js';
import { BUILDING_PIECES } from './building-kit.js';

export const ITEMS = Object.freeze({
  stone: { name: 'Stone', category: 'RESOURCE', description: 'Gather loose stones around the oasis.' },
  wood: { name: 'Wood', category: 'RESOURCE', description: 'Chopped from alien trees, or picked up as dead wood around the oasis.' },
  fibre: { name: 'Fibre', category: 'RESOURCE', description: 'Tough strands pulled from the ferns round the oasis, or cut from a spire plant. Used to bind buildings together.' },
  crystal: { name: 'Crystal', category: 'RESOURCE', description: 'A glowing shard broken from a crystal cluster out in the dunes. Its use is still a mystery.' },
  axe: { name: 'Stone axe', category: 'TOOL', description: 'Fells trees for wood and sticks. Put it on a hip to carry it.', equippable: true },
  torch: { name: 'Torch', category: 'TOOL', description: 'Light it with B (right hand) or X (left). Put it on a hip to carry it.', equippable: true },
  spear: { name: 'Stone-tipped spear', category: 'TOOL', description: 'A straight shaft, a stone point and a tassel of feathers. Put it on a hip to carry it.', equippable: true },
  pickaxe: { name: 'Stone pickaxe', category: 'TOOL', description: 'Breaks sandstone and crystal in the dunes. Swing it at a rock. Put it on a hip to carry it.', equippable: true },
  bow: { name: 'Bow', category: 'TOOL', description: 'Grip to hold. Reach over your free shoulder and grip for an arrow. Touch it to the string, pull back, then let go to shoot. The quiver appears with the bow; arrows are unlimited for now. Put the bow on a hip to carry it.', equippable: true },
  glider: { name: 'Glider', category: 'TOOL', description: 'A hang glider. Raise both hands above your head and squeeze both grips to open it, then step off a height. Lower a hand to turn, move your hands forward to dive, back to float. Let go to fold it away.' },
  campfire: { name: 'Campfire', category: 'STRUCTURE', description: 'A ring of stones around a stack of logs. Place it on the ground, then touch a lit torch to the logs to light it.', placeable: true },
  ...Object.fromEntries(Object.entries(BUILDING_PIECES).map(([type, part]) => [type, { name: part.name, category: 'STRUCTURE', description: part.description, placeable: true }])),
});

// Use resources that can already be collected.
export const RECIPES = Object.freeze([
  Object.freeze({ id: 'axe', name: 'Stone axe', description: 'Lash a stone head to a wooden handle.', ingredients: Object.freeze({ wood: 3, stone: 2 }), output: 'axe' }),
  Object.freeze({ id: 'torch', name: 'Torch', description: 'Bundle dry wood with a striking stone.', ingredients: Object.freeze({ wood: 2, stone: 1 }), output: 'torch' }),
  Object.freeze({ id: 'spear', name: 'Stone-tipped spear', description: 'Lash a stone point to a long, straight shaft.', ingredients: Object.freeze({ wood: 3, stone: 1 }), output: 'spear' }),
  Object.freeze({ id: 'pickaxe', name: 'Stone pickaxe', description: 'Lash a pointed stone across a stout haft.', ingredients: Object.freeze({ wood: 3, stone: 3 }), output: 'pickaxe' }),
  Object.freeze({ id: 'campfire', name: 'Campfire', description: 'Stack wood for kindling and ring them with stones. Light it with a torch.', ingredients: Object.freeze({ wood: 6, stone: 5 }), output: 'campfire' }),
  ...Object.entries(BUILDING_PIECES).map(([id, part]) => Object.freeze({ id, name: part.name, description: part.description, ingredients: part.ingredients, output: id })),
]);

export function getRecipeStatus(id) {
  const recipe = RECIPES.find(item => item.id === id);
  if (!recipe) return null;
  const ingredients = Object.entries(recipe.ingredients).map(([type, required]) => ({
    type, required, owned: getInventoryCount(type),
  }));
  return { recipe, ingredients, canCraft: ingredients.every(item => item.owned >= item.required) };
}

export function craftItem(id) {
  const status = getRecipeStatus(id);
  if (!status?.canCraft) return false;
  return exchangeInventoryItems(status.recipe.ingredients, { [status.recipe.output]: 1 });
}
