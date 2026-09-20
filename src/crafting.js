import { getInventoryCount, exchangeInventoryItems } from './inventory.js';

export const ITEMS = Object.freeze({
  stick: { name: 'Stick', category: 'RESOURCE', description: 'Gather loose sticks around the oasis.' },
  stone: { name: 'Stone', category: 'RESOURCE', description: 'Gather loose stones around the oasis.' },
  fibre: { name: 'Fibre', category: 'RESOURCE', description: 'Plant fibres for future recipes.' },
  axe: { name: 'Stone axe', category: 'TOOL', description: 'Point here and hold grip for 3 seconds to equip in that hand.' },
  torch: { name: 'Torch', category: 'TOOL', description: 'Hold grip here for 3 seconds to equip. B toggles its flame in either hand.' },
});

// Use resources that can already be collected. Fibre gathering is not implemented yet.
export const RECIPES = Object.freeze([
  Object.freeze({ id: 'axe', name: 'Stone axe', description: 'Lash a stone head to a wooden handle.', ingredients: Object.freeze({ stick: 3, stone: 2 }), output: 'axe' }),
  Object.freeze({ id: 'torch', name: 'Torch', description: 'Bundle dry sticks with a striking stone.', ingredients: Object.freeze({ stick: 2, stone: 1 }), output: 'torch' }),
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
