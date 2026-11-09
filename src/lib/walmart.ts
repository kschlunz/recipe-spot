// Walmart links for the shopping list.
//
// Walmart has no public API that lets an app fill someone's cart from plain
// ingredient names. What works without any account or key is a search link per
// item: on a phone it opens the Walmart app (or walmart.com) on that search, set
// to whatever store/pickup the shopper already has selected.

import { storeName } from './pickup';

export function walmartSearchUrl(name: string): string {
  return `https://www.walmart.com/search?q=${encodeURIComponent(storeName(name) || name.trim())}`;
}
