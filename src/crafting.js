import { getInventoryCount, exchangeInventoryItems } from './inventory.js';

export const ITEMS = Object.freeze({
  stick: { name: 'Stick', category: 'RESOURCE', description: 'Gather loose sticks around the oasis.' },
  stone: { name: 'Stone', category: 'RESOURCE', description: 'Gather loose stones around the oasis.' },
  wood: { name: 'Wood', category: 'RESOURCE', description: 'Logs split from a felled alien tree.' },
  fibre: { name: 'Fibre', category: 'RESOURCE', description: 'Tough strands cut from a spire plant, for future recipes.' },
  crystal: { name: 'Crystal', category: 'RESOURCE', description: 'A glowing shard broken from a crystal cluster out in the dunes. Its use is still a mystery.' },
  axe: { name: 'Stone axe', category: 'TOOL', description: 'Fells trees for wood and sticks. Put it on a hip to carry it.', equippable: true },
  torch: { name: 'Torch', category: 'TOOL', description: 'Light it with B (right hand) or X (left). Put it on a hip to carry it.', equippable: true },
  spear: { name: 'Stone-tipped spear', category: 'TOOL', description: 'A straight shaft, a stone point and a tassel of feathers. Put it on a hip to carry it.', equippable: true },
  pickaxe: { name: 'Stone pickaxe', category: 'TOOL', description: 'Breaks sandstone and crystal in the dunes. Swing it at a rock. Put it on a hip to carry it.', equippable: true },
  glider: { name: 'Glider', category: 'TOOL', description: 'A hang glider. Raise both hands above your head and squeeze both grips to open it, then step off a height. Lower a hand to turn, move your hands forward to dive, back to float. Let go to fold it away.' },
  campfire: { name: 'Campfire', category: 'STRUCTURE', description: 'A ring of stones around a stack of logs. Place it on the ground, then touch a lit torch to the logs to light it.', placeable: true },
});

// Use resources that can already be collected. Fibre and crystal have no recipe yet.
export const RECIPES = Object.freeze([
  Object.freeze({ id: 'axe', name: 'Stone axe', description: 'Lash a stone head to a wooden handle.', ingredients: Object.freeze({ stick: 3, stone: 2 }), output: 'axe' }),
  Object.freeze({ id: 'torch', name: 'Torch', description: 'Bundle dry sticks with a striking stone.', ingredients: Object.freeze({ stick: 2, stone: 1 }), output: 'torch' }),
  Object.freeze({ id: 'spear', name: 'Stone-tipped spear', description: 'Lash a stone point to a long, straight shaft.', ingredients: Object.freeze({ stick: 3, stone: 1 }), output: 'spear' }),
  Object.freeze({ id: 'pickaxe', name: 'Stone pickaxe', description: 'Lash a pointed stone across a stout haft.', ingredients: Object.freeze({ stick: 3, stone: 3 }), output: 'pickaxe' }),
  Object.freeze({ id: 'campfire', name: 'Campfire', description: 'Stack sticks for kindling and ring them with stones. Light it with a torch.', ingredients: Object.freeze({ stick: 6, stone: 5 }), output: 'campfire' }),
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
