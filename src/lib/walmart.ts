// Walmart hand-off for the shopping list.
//
// Walmart has no public API that lets an app fill someone's cart from plain
// ingredient names. What works without any account or key is a search link per
// item: on a phone it opens the Walmart app (or walmart.com) on that search, set
// to whatever store/pickup the shopper already has selected.
//
// Walmart does document a cart-prefill link, but it takes Walmart item IDs
// rather than names. So the household saves a "pick" per ingredient (the
// product they actually buy, pasted once as a Walmart link), and everything
// with a pick goes to the cart in one tap via walmartCartUrl below.

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
// comma-separated, one of each here (package counts don't follow from recipe
// amounts — adjust in the cart). If any item can't be added, Walmart shows an
// error and lands on its home page.
export function walmartCartUrl(itemIds: string[]): string {
  const list = [...new Set(itemIds.filter((id) => /^\d+$/.test(id)))].map((id) => `${id}_1`).join(',');
  return `https://www.walmart.com/sc/cart/addToCart?items=${list}`;
}

// The key a saved pick is stored under: the cleaned name, so "yellow onion" and
// "yellow onion, finely chopped" share one pick across recipes.
export function walmartKey(name: string): string {
  return (walmartQuery(name) || name.trim()).toLowerCase();
}

export function walmartProductUrl(itemId: string): string {
  return `https://www.walmart.com/ip/${encodeURIComponent(itemId)}`;
}
