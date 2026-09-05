import { useMemo, useState } from 'react';
import { useRecipeList } from '../hooks/useRecipes';
import type { RecipeSummary } from '../data/recipe';
import { effectiveTags, tagKey } from '../lib/tags';
import Heart from './Heart';
import { FAVORITES_ENABLED } from '../lib/flags';
import { shareRecipe } from '../lib/share';
import ShareIcon from './ShareIcon';
import HeartHealthyIcon from './HeartHealthyIcon';

const CAT_LIMIT = 16; // categories shown in the sidebar before "show all"

function RecipeCard({ r, onFav }: { r: RecipeSummary; onFav: (slug: string) => void }) {
  const tags = effectiveTags(r.tags, r.eyebrow);
  const [copied, setCopied] = useState(false);

  // Share without leaving the list. Stop the click from following the card link.
  const onShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const result = await shareRecipe(r.slug, r.title, r.tagline);
    if (result === 'copied') {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <a className="rcard" href={`#/r/${r.slug}`}>
      <button
        type="button"
        className={'rcard-share' + (FAVORITES_ENABLED ? '' : ' solo') + (copied ? ' copied' : '')}
        aria-label="Share this recipe"
        title={copied ? 'Link copied' : 'Share'}
        onClick={onShare}
      >
        {copied ? '✓' : <ShareIcon size={17} />}
      </button>
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
      {r.heartHealthy ? (
        <div className="rcard-hh" title="Heart-healthy — meets Mediterranean / AHA guidelines">
          <HeartHealthyIcon /> Heart-healthy
        </div>
      ) : null}
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
  const [showHeart, setShowHeart] = useState(false);
  const [showAllCats, setShowAllCats] = useState(false);
  const [backfill, setBackfill] = useState({ running: false, done: 0, total: 0, msg: '' });

  const favCount = useMemo(() => recipes.filter((r) => r.favorite).length, [recipes]);
  const heartCount = useMemo(() => recipes.filter((r) => r.heartHealthy === true).length, [recipes]);
  // Recipes missing a nutrition estimate, a cost estimate, or a heart-healthy
  // check — one tap analyzes the whole library. (The nutrition endpoint also
  // does the heart-healthy assessment, so a recipe missing only the heart check
  // is handled by calling /api/nutrition.)
  const missing = useMemo(
    () => recipes.filter((r) => !r.hasNutrition || !r.hasCost || r.heartHealthy == null),
    [recipes],
  );

  // Fill in nutrition, cost, and the heart-healthy verdict for every recipe
  // that's missing any, one after another with a live count. Stops early if it
  // can't be saved (columns not there yet), and refreshes when done.
  const backfillEstimates = async () => {
    const todo = missing.map((r) => ({
      slug: r.slug,
      // The nutrition endpoint estimates nutrition AND assesses heart-healthy,
      // so call it when either is missing.
      needNutrition: !r.hasNutrition || r.heartHealthy == null,
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
        ? 'Estimates could not be saved — run the database update (nutrition + cost + heart columns) first.'
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
      if (showHeart && r.heartHealthy !== true) return false;
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
  }, [recipes, query, activeTag, showFavs, showHeart]);

  // Favorites, heart-healthy, and a category are mutually exclusive filters —
  // picking one clears the others so the active header stays unambiguous.
  const pickAll = () => {
    setActiveTag(null);
    setShowFavs(false);
    setShowHeart(false);
  };
  const pickFavs = () => {
    setActiveTag(null);
    setShowHeart(false);
    setShowFavs(true);
  };
  const pickHeart = () => {
    setActiveTag(null);
    setShowFavs(false);
    setShowHeart(true);
  };
  const pickCat = (key: string) => {
    setShowFavs(false);
    setShowHeart(false);
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
        {(categories.length > 0 || favCount > 0 || heartCount > 0) && (
          <aside className="index-sidebar">
            <h2>Browse</h2>
            <button
              className="cat"
              aria-pressed={!showFavs && !showHeart && activeTag === null}
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
            {heartCount > 0 && (
              <button className="cat cat-heart" aria-pressed={showHeart} onClick={pickHeart}>
                <span>♥ Heart-healthy</span>
                <span className="count">{heartCount}</span>
              </button>
            )}
            {shownCats.map((c) => (
              <button
                key={c.key}
                className="cat"
                aria-pressed={!showFavs && !showHeart && activeTag === c.key}
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
                  Analyzing recipes (nutrition, cost, heart-healthy)… {backfill.done}/{backfill.total}
                </span>
              ) : backfill.msg ? (
                <span className="nb-msg">{backfill.msg}</span>
              ) : (
                <>
                  <span>
                    {missing.length} recipe{missing.length === 1 ? '' : 's'} not fully analyzed (nutrition,
                    cost, heart-healthy).
                  </span>{' '}
                  <button className="linkish" onClick={backfillEstimates}>
                    Analyze all
                  </button>
                </>
              )}
            </div>
          )}

          {(activeLabel || showFavs || showHeart) && (
            <p className="index-active">
              {showFavs ? (
                <>
                  {visible.length} <b>♥ favorites</b>
                </>
              ) : showHeart ? (
                <>
                  {visible.length} <b>♥ heart-healthy</b>
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
