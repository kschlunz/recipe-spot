import { useCallback, useEffect, useState } from 'react';
import type { Recipe, RecipeSummary } from '../data/recipe';
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

  return { recipes, loading, error, refresh };
}

// Fetch a single recipe by slug from /api/recipes?slug=.
export function useRecipe(slug: string) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
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
    load(() => on);
    return () => {
      on = false;
    };
  }, [load]);

  const refresh = useCallback(() => load(() => true), [load]);

  return { recipe, tags, photoUrl, sourceUrl, loading, error, refresh };
}
