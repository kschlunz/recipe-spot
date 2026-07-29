import { useMemo, useState } from 'react';
import { useRecipeList } from '../hooks/useRecipes';
import type { RecipeSummary } from '../data/recipe';

function RecipeCard({ r }: { r: RecipeSummary }) {
  return (
    <a className="rcard" href={`#/r/${r.slug}`}>
      {r.eyebrow && <p className="eyebrow">{r.eyebrow}</p>}
      <h3>{r.title}</h3>
      {r.tagline && <p className="deck">{r.tagline}</p>}
      {r.tags.length > 0 && (
        <div className="cardtags">
          {r.tags.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
    </a>
  );
}

export default function IndexScreen() {
  const { recipes, loading, error } = useRecipeList();
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => r.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [recipes]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (activeTag && !r.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.eyebrow ?? '').toLowerCase().includes(q) ||
        (r.tagline ?? '').toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [recipes, query, activeTag]);

  return (
    <div className="wrap">
      <div className="index-head">
        <h1>Recipes</h1>
        <div className="searchbar">
          <input
            type="search"
            placeholder="Search recipes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search recipes"
          />
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="tagrow">
          <button
            className="tag"
            aria-pressed={activeTag === null}
            onClick={() => setActiveTag(null)}
          >
            all
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              className="tag"
              aria-pressed={activeTag === t}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="loading">Loading recipes…</p>
      ) : error ? (
        <p className="status-line err">{error}</p>
      ) : visible.length === 0 ? (
        <div className="empty">
          {recipes.length === 0 ? (
            <>
              No recipes yet. <a href="#/new" style={{ color: 'var(--turmeric)' }}>Import your first one →</a>
            </>
          ) : (
            'Nothing matches that search.'
          )}
        </div>
      ) : (
        <div className="card-grid">
          {visible.map((r) => (
            <RecipeCard key={r.slug} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
