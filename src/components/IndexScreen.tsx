import { useMemo, useState } from 'react';
import { useRecipeList } from '../hooks/useRecipes';
import type { RecipeSummary } from '../data/recipe';
import { effectiveTags, tagKey } from '../lib/tags';
import Heart from './Heart';
import { FAVORITES_ENABLED } from '../lib/flags';

const CAT_LIMIT = 16; // categories shown in the sidebar before "show all"

function RecipeCard({ r, onFav }: { r: RecipeSummary; onFav: (slug: string) => void }) {
  const tags = effectiveTags(r.tags, r.eyebrow);
  return (
    <a className="rcard" href={`#/r/${r.slug}`}>
      {FAVORITES_ENABLED && <Heart on={!!r.favorite} onClick={() => onFav(r.slug)} className="rcard-heart" />}
      {r.eyebrow && <p className="eyebrow">{r.eyebrow}</p>}
      <h3>{r.title}</h3>
      {r.tagline && <p className="deck">{r.tagline}</p>}
      {tags.length > 0 && (
        <div className="cardtags">
          {tags.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
      <div className="rcard-meta">
        {r.calories ? <span className="rcard-cal">≈ {r.calories.toLocaleString()} cal / serving</span> : null}
        {r.cookedCount ? (
          <span className="rcard-made" title="Times you've cooked this">
            🍳 Made {r.cookedCount}×
          </span>
        ) : null}
      </div>
    </a>
  );
}

export default function IndexScreen() {
  const { recipes, loading, error, refresh, toggleFavorite } = useRecipeList();
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null); // stores a tag key
  const [showFavs, setShowFavs] = useState(false);
  const [showAllCats, setShowAllCats] = useState(false);
  const [backfill, setBackfill] = useState({ running: false, done: 0, total: 0, msg: '' });

  const favCount = useMemo(() => recipes.filter((r) => r.favorite).length, [recipes]);
  // Recipes missing a nutrition estimate, a cost estimate, or both — one tap
  // prices and nutrition-labels the whole library.
  const missing = useMemo(
    () => recipes.filter((r) => !r.hasNutrition || !r.hasCost),
    [recipes],
  );

  // Fill in nutrition and/or cost for every recipe that's missing either, one
  // recipe after another with a live count. Stops early if an estimate can't be
  // saved (the column isn't there yet), and refreshes so the bar hides when done.
  const backfillEstimates = async () => {
    const todo = missing.map((r) => ({
      slug: r.slug,
      needNutrition: !r.hasNutrition,
      needCost: !r.hasCost,
    }));
    if (todo.length === 0 || backfill.running) return;
    setBackfill({ running: true, done: 0, total: todo.length, msg: '' });
    let done = 0;
    let unsaved = false;
    for (const t of todo) {
      if (t.needNutrition) {
        try {
          const res = await fetch('/api/nutrition', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slug: t.slug }),
          });
          const j = await res.json().catch(() => ({}));
          if (res.ok && j.saved === false) unsaved = true;
        } catch {
          /* skip this one, keep going */
        }
      }
      if (t.needCost) {
        try {
          const res = await fetch('/api/cost', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slug: t.slug }),
          });
          const j = await res.json().catch(() => ({}));
          if (res.ok && j.saved === false) unsaved = true;
        } catch {
          /* skip this one, keep going */
        }
      }
      if (unsaved) break;
      done += 1;
      setBackfill((b) => ({ ...b, done }));
    }
    await refresh(true);
    setBackfill((b) => ({
      ...b,
      running: false,
      msg: unsaved
        ? 'Estimates could not be saved — run the database update (nutrition + cost columns) first.'
        : '',
    }));
  };

  // Categories = tags shared by 3+ recipes, merged by normalized key and ranked
  // by how many recipes use them. Keeps the browse list meaningful, not a wall.
  const categories = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    recipes.forEach((r) => {
      const seen = new Set<string>();
      effectiveTags(r.tags, r.eyebrow).forEach((t) => {
        const key = tagKey(t);
        if (!key || seen.has(key)) return; // count each recipe once per tag
        seen.add(key);
        const cur = map.get(key);
        if (cur) cur.count++;
        else map.set(key, { label: t.toLowerCase(), count: 1 });
      });
    });
    return [...map.entries()]
      .filter(([, v]) => v.count >= 3)
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [recipes]);

  const shownCats = showAllCats ? categories : categories.slice(0, CAT_LIMIT);
  const activeLabel = activeTag ? categories.find((c) => c.key === activeTag)?.label ?? activeTag : null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (showFavs && !r.favorite) return false;
      const tags = effectiveTags(r.tags, r.eyebrow);
      if (activeTag && !tags.some((t) => tagKey(t) === activeTag)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.eyebrow ?? '').toLowerCase().includes(q) ||
        (r.tagline ?? '').toLowerCase().includes(q) ||
        tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [recipes, query, activeTag, showFavs]);

  // Favorites and a category are mutually exclusive filters — picking one clears
  // the other so the active header stays unambiguous.
  const pickAll = () => {
    setActiveTag(null);
    setShowFavs(false);
  };
  const pickFavs = () => {
    setActiveTag(null);
    setShowFavs(true);
  };
  const pickCat = (key: string) => {
    setShowFavs(false);
    setActiveTag(activeTag === key ? null : key);
  };

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

      <div className="index-layout">
        {(categories.length > 0 || favCount > 0) && (
          <aside className="index-sidebar">
            <h2>Browse</h2>
            <button
              className="cat"
              aria-pressed={!showFavs && activeTag === null}
              onClick={pickAll}
            >
              <span>All recipes</span>
              <span className="count">{recipes.length}</span>
            </button>
            {FAVORITES_ENABLED && favCount > 0 && (
              <button className="cat cat-fav" aria-pressed={showFavs} onClick={pickFavs}>
                <span>♥ Favorites</span>
                <span className="count">{favCount}</span>
              </button>
            )}
            {shownCats.map((c) => (
              <button
                key={c.key}
                className="cat"
                aria-pressed={!showFavs && activeTag === c.key}
                onClick={() => pickCat(c.key)}
              >
                <span>{c.label}</span>
                <span className="count">{c.count}</span>
              </button>
            ))}
            {categories.length > CAT_LIMIT && (
              <button className="cat cat-more" onClick={() => setShowAllCats((v) => !v)}>
                {showAllCats ? 'show less' : `+${categories.length - CAT_LIMIT} more`}
              </button>
            )}
          </aside>
        )}

        <div className="index-main">
          {(missing.length > 0 || backfill.msg) && (
            <div className="nutri-backfill">
              {backfill.running ? (
                <span>
                  Estimating nutrition &amp; cost… {backfill.done}/{backfill.total}
                </span>
              ) : backfill.msg ? (
                <span className="nb-msg">{backfill.msg}</span>
              ) : (
                <>
                  <span>
                    {missing.length} recipe{missing.length === 1 ? '' : 's'} missing nutrition or cost
                    estimates.
                  </span>{' '}
                  <button className="linkish" onClick={backfillEstimates}>
                    Estimate all
                  </button>
                </>
              )}
            </div>
          )}

          {(activeLabel || showFavs) && (
            <p className="index-active">
              {showFavs ? (
                <>
                  {visible.length} <b>♥ favorites</b>
                </>
              ) : (
                <>
                  {visible.length} in <b>{activeLabel}</b>
                </>
              )}{' '}
              ·{' '}
              <button className="linkish" onClick={pickAll}>
                clear
              </button>
            </p>
          )}

          {loading ? (
            <p className="loading">Loading recipes…</p>
          ) : error ? (
            <p className="status-line err">{error}</p>
          ) : visible.length === 0 ? (
            <div className="empty">
              {recipes.length === 0 ? (
                <>
                  No recipes yet.{' '}
                  <a href="#/new" style={{ color: 'var(--turmeric)' }}>
                    Add your first one →
                  </a>
                </>
              ) : (
                'Nothing matches.'
              )}
            </div>
          ) : (
            <div className="card-grid">
              {visible.map((r) => (
                <RecipeCard key={r.slug} r={r} onFav={toggleFavorite} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
