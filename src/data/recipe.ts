// The shared recipe schema — a tree the tabular renderer computes rowspans from.
// Ingredients are leaves; each step lists its inputs (ingredient ids and/or
// earlier step ids). See src/lib/recipeGrid.ts for the layout math.

export type Qty = { q: number; u: string };

export type Ingredient = {
  id: string;
  name: string;
  note?: string;
  us?: Qty;
  metric?: Qty;
};

export type Step = {
  id: string;
  verb: string;
  detail: string;
  seconds: number;
  title: string;
  inputs: string[];
};

export type Note = { h: string; p: string };

export type Recipe = {
  title: string;
  eyebrow?: string;
  tagline?: string;
  serves?: number;
  active?: string;
  total?: string;
  vessel?: string;
  prep?: string;
  ingredients: Ingredient[];
  steps: Step[];
  notes?: Note[];
  credit?: string;
};

// A saved recipe row from Supabase (data holds the Recipe above).
export type RecipeRow = {
  slug: string;
  title: string;
  data: Recipe;
  source_url?: string | null;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
};

// A recipe card summary for the index list.
export type RecipeSummary = {
  slug: string;
  title: string;
  eyebrow?: string;
  tagline?: string;
  tags: string[];
  photoUrl?: string | null;
};

/* ------------------------------------------------------------------ */
/* THE STEW — the preloaded example recipe, row one                    */
/* ------------------------------------------------------------------ */
export const STEW: Recipe = {
  title: 'The Stew',
  eyebrow: 'One pot · vegetarian · reheats better than it cooks',
  tagline: 'Spiced chickpeas with coconut, turmeric, and whatever greens you have.',
  serves: 4,
  active: '20 min',
  total: '55 min',
  vessel: 'Dutch oven',
  prep: 'Set a large Dutch oven over medium-high heat',
  ingredients: [
    { id: 'oil', name: 'olive oil', note: 'plus more for drizzling', us: { q: 0.25, u: 'cup' }, metric: { q: 60, u: 'mL' } },
    { id: 'onion', name: 'yellow onion', note: 'chopped', us: { q: 1, u: 'large' }, metric: { q: 300, u: 'g' } },
    { id: 'ginger', name: 'fresh ginger', note: 'finely chopped', us: { q: 1, u: 'Tbs' }, metric: { q: 15, u: 'g' } },
    { id: 'garlic', name: 'garlic', note: 'minced', us: { q: 4, u: 'cloves' }, metric: { q: 12, u: 'g' } },
    { id: 'turmeric', name: 'ground turmeric', us: { q: 1.5, u: 'tsp' }, metric: { q: 5, u: 'g' } },
    { id: 'chili', name: 'crushed red pepper', note: 'optional', us: { q: 0.5, u: 'tsp' }, metric: { q: 1, u: 'g' } },
    { id: 'chickpeas', name: 'chickpeas', note: '15 oz each · drained and rinsed', us: { q: 2, u: 'cans' }, metric: { q: 850, u: 'g' } },
    { id: 'coconut', name: 'full-fat coconut milk', note: '15 oz each', us: { q: 2, u: 'cans' }, metric: { q: 800, u: 'mL' } },
    { id: 'stock', name: 'vegetable stock', us: { q: 2, u: 'cups' }, metric: { q: 480, u: 'mL' } },
    { id: 'salt', name: 'kosher salt', note: 'then taste', us: { q: 1.5, u: 'tsp' }, metric: { q: 9, u: 'g' } },
    { id: 'pepper', name: 'black pepper', us: { q: 0.5, u: 'tsp' }, metric: { q: 1, u: 'g' } },
    { id: 'kale', name: 'kale leaves', note: 'torn · chard or collards work too', us: { q: 2, u: 'cups' }, metric: { q: 100, u: 'g' } },
    { id: 'mint', name: 'mint leaves', note: 'or cilantro', us: { q: 1, u: 'cup' }, metric: { q: 25, u: 'g' } },
    { id: 'serve', name: 'yogurt and pita', note: 'to serve' },
  ],
  steps: [
    { id: 's1', verb: 'cook onion', detail: '5–6 min', seconds: 330, title: 'Soften the onion', inputs: ['oil', 'onion'] },
    { id: 's2', verb: 'toast spices', detail: '2 min · stir often', seconds: 120, title: 'Toast ginger, garlic, turmeric, chili', inputs: ['s1', 'ginger', 'garlic', 'turmeric', 'chili'] },
    { id: 's3', verb: 'fry, then crush', detail: '8–10 min · reserve 1 cup', seconds: 540, title: 'Fry the chickpeas, then crush them', inputs: ['s2', 'chickpeas'] },
    { id: 's4', verb: 'scrape, lid on, simmer', detail: '25–30 min · medium-low', seconds: 1650, title: 'Simmer with the lid on', inputs: ['s3', 'coconut', 'stock', 'salt', 'pepper'] },
    { id: 's5', verb: 'wilt', detail: '5 min', seconds: 300, title: 'Wilt the greens', inputs: ['s4', 'kale'] },
    { id: 's6', verb: 'ladle', detail: 'garnish · serve', seconds: 0, title: 'Garnish and serve', inputs: ['s5', 'mint', 'serve'] },
  ],
  notes: [
    { h: 'Crush the chickpeas', p: 'Press a good third of them against the side of the pot with a wooden spoon. The released starch is the entire thickening mechanism — skip it and you have soup.' },
    { h: 'Season in layers', p: 'Salt at every stage. This version front-loads less, so taste before serving. If you are not using Diamond Crystal, start with a third less.' },
    { h: 'Simmer to your thickness', p: 'It starts soupy and tightens over about half an hour. Pull it early for brothy, push it longer for spoon-standing.' },
    { h: 'Full fat only', p: 'Light coconut milk splits and thins out. Two cans of the real thing is what makes the body.' },
    { h: 'Make ahead', p: 'Cook through the simmer, then stop. Add greens only when you reheat — they go grey and slack if they sit in the pot.' },
    { h: 'Keeping', p: 'Five days in the fridge, two months frozen. Thaw overnight, reheat gently, add a splash of stock to loosen.' },
  ],
  credit: "Adapted from Alison Roman's spiced chickpea stew with coconut and turmeric. Laid out in the tabular style of Michael Chu's Cooking for Engineers.",
};
