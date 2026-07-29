import RecipeView from './RecipeView';
import { useRecipe } from '../hooks/useRecipes';
import { STEW } from '../data/recipe';

export default function RecipePage({ slug }: { slug: string }) {
  const { recipe, loading, error } = useRecipe(slug);

  // The Stew is the flagship example — fall back to the bundled copy if the
  // table hasn't been seeded yet, so /r/the-stew always renders.
  const shown = recipe ?? (slug === 'the-stew' ? STEW : null);

  return (
    <div className="wrap">
      <a className="backlink" href="#/">
        ← All recipes
      </a>
      {loading && !shown ? (
        <p className="loading">Loading recipe…</p>
      ) : shown ? (
        <RecipeView recipe={shown} />
      ) : (
        <div className="empty">{error ? `Couldn't load that recipe: ${error}` : 'Recipe not found.'}</div>
      )}
    </div>
  );
}
