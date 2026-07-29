import { useMemo, useState } from 'react';
import { useRecipeList } from '../hooks/useRecipes';
import type { RecipeSummary } from '../data/recipe';
import { effectiveTags, tagKey } from '../lib/tags';

const TAG_LIMIT = 14; // how many filter chips to show before "show all"

function RecipeCard({ r }: { r: RecipeSummary }) {
  const tags = effectiveTags(r.tags, r.eyebrow);
  return (
    <a className="rcard" href={`#/r/${r.slug}`}>
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
    </a>
  );
}

export default function IndexScreen() {
  const { recipes, loading, error } = useRecipeList();
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null); // stores a tag key
  const [showAllTags, setShowAllTags] = useState(false);

  // Only tags shared by 2+ recipes make the filter — merged by normalized key,
  // ranked by how many recipes use them. One-off eyebrow fragments drop out.
  const tagStats = useMemo(() => {
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
      .filter(([, v]) => v.count >= 2)
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [recipes]);

  const shownTags = showAllTags ? tagStats : tagStats.slice(0, TAG_LIMIT);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
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

      {tagStats.length > 0 && (
        <div className="tagrow">
          <button className="tag" aria-pressed={activeTag === null} onClick={() => setActiveTag(null)}>
            all
          </button>
          {shownTags.map((t) => (
            <button
              key={t.key}
              className="tag"
              aria-pressed={activeTag === t.key}
              onClick={() => setActiveTag(activeTag === t.key ? null : t.key)}
            >
              {t.label}
            </button>
          ))}
          {tagStats.length > TAG_LIMIT && (
            <button className="tag tag-more" onClick={() => setShowAllTags((v) => !v)}>
              {showAllTags ? 'less ▲' : `+${tagStats.length - TAG_LIMIT} more`}
            </button>
          )}
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
