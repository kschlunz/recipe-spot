import { useMemo, useState } from 'react';
import { DAYS, useMealPlan, type Day, type PlanEntry } from '../hooks/useMealPlan';
import { useRecipeList } from '../hooks/useRecipes';

function RecipePicker({
  dayLabel,
  onPick,
  onClose,
}: {
  dayLabel: string;
  onPick: (entry: PlanEntry) => void;
  onClose: () => void;
}) {
  const { recipes, loading } = useRecipeList();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter(
      (r) => r.title.toLowerCase().includes(q) || (r.tagline ?? '').toLowerCase().includes(q),
    );
  }, [recipes, query]);

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="picker-title">Add to {dayLabel}</span>
          <button onClick={onClose}>Close</button>
        </div>
        <input
          className="picker-search"
          type="search"
          autoFocus
          placeholder="Search your recipes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="picker-list">
          {loading ? (
            <p className="loading">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="empty">
              {recipes.length === 0 ? 'No saved recipes yet — import one first.' : 'No matches.'}
            </p>
          ) : (
            visible.map((r) => (
              <button
                key={r.slug}
                className="picker-item"
                onClick={() => onPick({ slug: r.slug, title: r.title, eyebrow: r.eyebrow, tagline: r.tagline })}
              >
                <b>{r.title}</b>
                {r.eyebrow && <span>{r.eyebrow}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function PlanScreen() {
  const { plan, loading, error, assign, remove, clear } = useMealPlan();
  const [picking, setPicking] = useState<Day | null>(null);

  const filled = DAYS.filter((d) => plan[d.key]).length;
  const pickingLabel = picking ? DAYS.find((d) => d.key === picking)!.label : '';

  return (
    <div className="wrap">
      <div className="index-head">
        <h1>This Week</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 12,
              color: 'var(--ink-soft)',
              letterSpacing: '0.06em',
            }}
          >
            {filled}/7 planned
          </span>
          <button
            onClick={() => {
              if (filled > 0 && window.confirm('Clear all recipes from this week?')) clear();
            }}
            disabled={filled === 0}
          >
            Clear week
          </button>
        </div>
      </div>

      {error && <p className="status-line err">{error}</p>}

      <div className="week-grid">
        {DAYS.map((d) => {
          const entry = plan[d.key];
          return (
            <div key={d.key} className={'day-card' + (entry ? ' has' : '')}>
              <div className="day-label">{d.label}</div>
              {entry ? (
                <div className="day-recipe">
                  <a className="day-recipe-link" href={`#/r/${entry.slug}`}>
                    {entry.eyebrow && <span className="eyebrow">{entry.eyebrow}</span>}
                    <b>{entry.title}</b>
                  </a>
                  <div className="day-actions">
                    <button onClick={() => setPicking(d.key)}>Change</button>
                    <button onClick={() => remove(d.key)}>Remove</button>
                  </div>
                </div>
              ) : (
                <button className="day-add" onClick={() => setPicking(d.key)} disabled={loading}>
                  + Add recipe
                </button>
              )}
            </div>
          );
        })}
      </div>

      {picking && (
        <RecipePicker
          dayLabel={pickingLabel}
          onClose={() => setPicking(null)}
          onPick={(entry) => {
            assign(picking, entry);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
