import { useCallback, useEffect, useState } from 'react';
import type { Nutrition, Recipe, RecipeSummary } from '../data/recipe';
import { useRefreshOnFocus } from './useRefreshOnFocus';

// List all recipe card summaries from /api/recipes.
export function useRecipeList() {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/recipes');
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const json = await res.json();
      setRecipes(json.recipes ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useRefreshOnFocus(() => refresh(true));

  // Optimistically flip the heart, then persist. Reload on failure.
  const toggleFavorite = useCallback((slug: string) => {
    let next = false;
    setRecipes((rs) =>
      rs.map((r) => {
        if (r.slug !== slug) return r;
        next = !r.favorite;
        return { ...r, favorite: next };
      }),
    );
    fetch('/api/recipes', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, favorite: next }),
    })
      .then((r) => {
        if (!r.ok) refresh(true);
      })
      .catch(() => refresh(true));
  }, [refresh]);

  return { recipes, loading, error, refresh, toggleFavorite };
}

// Fetch a single recipe by slug from /api/recipes?slug=.
export function useRecipe(slug: string) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [nutrition, setNutrition] = useState<Nutrition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (alive: () => boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/recipes?slug=${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        const json = await res.json();
        if (alive()) {
          setRecipe(json.recipe?.data ?? null);
          setTags(json.recipe?.tags ?? []);
          setPhotoUrl(json.recipe?.photo_url ?? null);
          setSourceUrl(json.recipe?.source_url ?? null);
          setFavorite(!!json.recipe?.favorite);
          setNutrition(json.recipe?.nutrition ?? null);
        }
      } catch (e) {
        if (alive()) setError((e as Error).message);
      } finally {
        if (alive()) setLoading(false);
      }
    },
    [slug],
  );

  useEffect(() => {
    let on = true;
    setRecipe(null);
    setTags([]);
    setPhotoUrl(null);
    setSourceUrl(null);
    setNutrition(null);
    load(() => on);
    return () => {
      on = false;
    };
  }, [load]);

  const refresh = useCallback(() => load(() => true), [load]);

  const toggleFavorite = useCallback(() => {
    const next = !favorite;
    setFavorite(next);
    fetch('/api/recipes', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, favorite: next }),
    }).catch(() => setFavorite(!next));
  }, [favorite, slug]);

  return {
    recipe,
    tags,
    photoUrl,
    sourceUrl,
    favorite,
    nutrition,
    setNutrition,
    loading,
    error,
    refresh,
    toggleFavorite,
  };
}
