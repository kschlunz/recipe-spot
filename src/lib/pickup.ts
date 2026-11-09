// The shopping list in store terms, for handing to a grocery pickup app
// (Walmart's Sparky, Instacart's "Paste items", …): one plain item per line,
// with no prep notes or recipe names, duplicates merged, and only amounts a
// store can act on.

import { frac } from './recipeGrid';

// Prep and usage notes that trail an ingredient name after a comma. They mean
// nothing to a store, so those segments are dropped.
const PREP_RE =
  /^(finely|thinly|roughly|coarsely|lightly|freshly|very|well|shucked|chopped|diced|minced|sliced|peeled|drained|rinsed|divided|softened|melted|halved|quartered|cubed|trimmed|grated|shredded|crushed|torn|beaten|zested|juiced|seeded|cored|stemmed|pitted|smashed|cooked|thawed|packed|optional|cut|patted|at room|room temp|to taste|to serve|for |plus |or more|as needed)/i;

// "ears of corn, shucked" → "ears of corn"; "basil leaves (for butter)" →
// "basil leaves"; "boneless, skinless chicken thighs" keeps both halves, since
// that comma is part of the name rather than a prep note.
export function storeName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .split(',')
    .map((part) => part.trim())
    .filter((part, i) => part && (i === 0 || !PREP_RE.test(part)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Amount = { q: number; u: string };
export type PickupItem = { name: string; amounts: Amount[] };

// Kitchen measures: "3/4 cup basil" or "1 tsp cumin" says nothing about what to
// put in a cart, so these amounts are left off and the item goes by name alone.
const KITCHEN_UNIT =
  /^(c|cups?|tbsps?|tbs|tablespoons?|tsps?|teaspoons?|ml|milliliters?|l|liters?|litres?|fl\.? ?oz|fluid ounces?|pinch(es)?|dash(es)?|splash(es)?|drizzle|handfuls?)$/;
// Weights are kept as measured ("1 1/2 lb"). Everything else is a count
// ("4 ears", "2 cans", "1 large") and is rounded up, since half an onion
// isn't for sale.
const WEIGHT_UNIT = /^(lbs?|pounds?|oz|ounces?|g|grams?|kg|kilograms?)$/;

const unitKey = (u: string) => u.trim().toLowerCase().replace(/\.$/, '');

// One line per distinct item, in list order: "4 ears of corn", "2 cans
// chickpeas", "basil leaves". Rows whose cleaned names match ("yellow onion"
// and "yellow onion, finely chopped") become one line with their amounts added.
export function pickupLines(items: PickupItem[]): string[] {
  const groups = new Map<string, { name: string; units: Map<string, Amount> }>();
  for (const it of items) {
    const name = storeName(it.name) || it.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let grp = groups.get(key);
    if (!grp) {
      grp = { name, units: new Map() };
      groups.set(key, grp);
    }
    for (const a of it.amounts) {
      const uk = unitKey(a.u ?? '');
      if (!(a.q > 0) || KITCHEN_UNIT.test(uk)) continue;
      const have = grp.units.get(uk);
      if (have) have.q += a.q;
      else grp.units.set(uk, { q: a.q, u: (a.u ?? '').trim() });
    }
  }

  return [...groups.values()].map(({ name, units }) => {
    const amount = [...units.entries()]
      .map(([uk, a]) => {
        const q = WEIGHT_UNIT.test(uk) ? frac(a.q) : String(Math.ceil(a.q - 1e-6));
        // "4 ears" + "ears of corn" → "4 ears of corn", not "4 ears ears of corn".
        const repeats = uk && name.toLowerCase().startsWith(uk);
        return a.u && !repeats ? `${q} ${a.u}` : q;
      })
      .join(' + ');
    return amount ? `${amount} ${name}` : name;
  });
}
