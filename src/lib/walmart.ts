// Walmart hand-off for the shopping list.
//
// Walmart has no public API that lets an app fill someone's cart from plain
// ingredient names. What works without any account or key is a search link per
// item: on a phone it opens the Walmart app (or walmart.com) on that search, set
// to whatever store/pickup the shopper already has selected.
//
// Walmart does document a cart-prefill link, but it takes Walmart item IDs
// rather than names — see walmartCartUrl below. Nothing calls it yet; it's here
// for when items carry a matched Walmart product.

// Prep and usage notes that trail an ingredient name after a comma. They only
// muddy a product search, so those segments are dropped.
const PREP_RE =
  /^(finely|thinly|roughly|coarsely|lightly|freshly|very|well|shucked|chopped|diced|minced|sliced|peeled|drained|rinsed|divided|softened|melted|halved|quartered|cubed|trimmed|grated|shredded|crushed|torn|beaten|zested|juiced|seeded|cored|stemmed|pitted|smashed|cooked|thawed|packed|optional|cut|patted|at room|room temp|to taste|to serve|for |plus |or more|as needed)/i;

// "ears of corn, shucked" → "ears of corn"; "basil leaves (for butter)" →
// "basil leaves"; "boneless, skinless chicken thighs" keeps both halves, since
// that comma is part of the name rather than a prep note.
export function walmartQuery(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .split(',')
    .map((part) => part.trim())
    .filter((part, i) => part && (i === 0 || !PREP_RE.test(part)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function walmartSearchUrl(name: string): string {
  return `https://www.walmart.com/search?q=${encodeURIComponent(walmartQuery(name) || name.trim())}`;
}

// Walmart's documented add-to-cart link: items are "<itemId>_<quantity>",
// comma-separated. If any item can't be added, Walmart shows an error and
// lands on its home page, so only pass IDs known to be good.
export function walmartCartUrl(items: { itemId: string; quantity?: number }[]): string {
  const list = items
    .filter((it) => /^\d+$/.test(it.itemId))
    .map((it) => `${it.itemId}_${Math.max(1, Math.round(it.quantity ?? 1))}`)
    .join(',');
  return `https://www.walmart.com/sc/cart/addToCart?items=${list}`;
}
