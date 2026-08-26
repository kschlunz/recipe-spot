// Format a recipe's ingredients as plain text for copying to the clipboard —
// handy for pasting into Notes, a text, or a grocery app.

import type { Ingredient, Recipe } from '../data/recipe';
import { frac, metricRound } from './recipeGrid';

// "¼ cup", "2 cans", "300 g" — US amounts as fractions, metric rounded.
function qtyText(g: Ingredient): string {
  const pick = g.us || g.metric;
  if (!pick || !pick.q) return '';
  const isUS = pick === g.us;
  const q = isUS ? frac(pick.q) : String(metricRound(pick.q));
  return `${q} ${pick.u || ''}`.trim();
}

// A titled, bulleted ingredient list:
//   The Stew — ingredients
//
//   - ¼ cup olive oil (plus more for drizzling)
//   - 1 large yellow onion (chopped)
export function ingredientsToText(recipe: Recipe): string {
  const lines = (recipe.ingredients ?? []).map((g) => {
    const qty = qtyText(g);
    const note = g.note ? ` (${g.note})` : '';
    return `- ${[qty, g.name].filter(Boolean).join(' ')}${note}`;
  });
  return [`${recipe.title} — ingredients`, '', ...lines].join('\n');
}
