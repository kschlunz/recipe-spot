import { useState } from 'react';
import RecipeView from './RecipeView';
import { useRecipe } from '../hooks/useRecipes';
import { STEW } from '../data/recipe';
import { DAYS, type Day } from '../hooks/useMealPlan';

function AddToWeek({ slug }: { slug: string }) {
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (day: Day, label: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/meal-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day, recipe_slug: slug }),
      });
      if (!res.ok) throw new Error();
      setAdded(label);
    } catch {
      setAdded('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="addweek">
      <span className="addweek-label">Add to week</span>
      <div className="addweek-days">
        {DAYS.map((d) => (
          <button
            key={d.key}
            className="addweek-day"
            disabled={busy}
            onClick={() => add(d.key, d.label)}
            title={`Add to ${d.label}`}
          >
            {d.label.slice(0, 3)}
          </button>
        ))}
      </div>
      {added === 'error' ? (
        <span className="addweek-note err">Couldn't add — is the plan set up?</span>
      ) : added ? (
        <span className="addweek-note">
          Added to {added} · <a href="#/plan">view week →</a>
        </span>
      ) : null}
    </div>
  );
}

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
        <>
          <AddToWeek slug={slug} />
          <RecipeView recipe={shown} />
        </>
      ) : (
        <div className="empty">{error ? `Couldn't load that recipe: ${error}` : 'Recipe not found.'}</div>
      )}
    </div>
  );
}
