// Tags for browsing/filtering. New recipes get real tags from the importer,
// stored in their own column. For recipes with none yet, we fall back to the
// eyebrow line ("One pot · vegetarian · reheats better") — split on its
// separators into lightweight tags so the index still fills in.

export function deriveTags(eyebrow?: string): string[] {
  if (!eyebrow) return [];
  return eyebrow
    .split(/[·•|,]/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1 && t.length <= 24);
}

// The tags to show for a recipe: its own if set, otherwise derived from the eyebrow.
export function effectiveTags(tags: string[] | undefined, eyebrow?: string): string[] {
  return tags && tags.length ? tags : deriveTags(eyebrow);
}
