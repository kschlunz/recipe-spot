import { useEffect, useMemo, useState } from 'react';
import { DAYS, useMealPlan, type Day, type PlanEntry, type PlanRecipe } from '../hooks/useMealPlan';
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

// A free-text note for a day ("Kate grills chicken", "leftovers", "eat out").
// Saves on blur, only when the text actually changed.
function DayNote({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  return (
    <textarea
      className="day-note"
      rows={2}
      placeholder="Note — leftovers, eat out, who's cooking…"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() !== value.trim()) onSave(text.trim());
      }}
    />
  );
}

// One planned dish within a day: link, servings stepper, remove.
function DayRecipe({
  recipe,
  onServings,
  onRemove,
}: {
  recipe: PlanRecipe;
  onServings: (servings: number) => void;
  onRemove: () => void;
}) {
  const serves = recipe.servings ?? recipe.serves ?? 4;
  return (
    <div className="day-recipe">
      <a className="day-recipe-link" href={`#/r/${recipe.slug}`}>
        {recipe.eyebrow && <span className="eyebrow">{recipe.eyebrow}</span>}
        <b>{recipe.title}</b>
      </a>
      <div className="day-recipe-controls">
        <div className="day-serves">
          <span>Serves</span>
          <button className="step" aria-label="Fewer servings" onClick={() => onServings(Math.max(1, serves - 1))}>
            −
          </button>
          <b>{serves}</b>
          <button className="step" aria-label="More servings" onClick={() => onServings(serves + 1)}>
            +
          </button>
        </div>
        <button className="day-remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

export default function PlanScreen() {
  const { plan, loading, error, addRecipe, removeRecipe, setNote, setServings, clear } = useMealPlan();
  const [picking, setPicking] = useState<Day | null>(null);

  const filled = DAYS.filter((d) => plan[d.key].recipes.length > 0 || plan[d.key].note.trim()).length;
  const pickingLabel = picking ? DAYS.find((d) => d.key === picking)!.label : '';

  return (
    <div className="wrap">
      <div className="index-head">
        <h1>This Week</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <a href="#/shopping" className="go" style={{ padding: '6px 13px', textDecoration: 'none' }}>
            🛒 Shopping list
          </a>
          <button
            onClick={() => {
              if (filled > 0 && window.confirm('Clear all recipes and notes from this week?')) clear();
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
          const { recipes, note } = plan[d.key];
          const has = recipes.length > 0 || note.trim().length > 0;
          return (
            <div key={d.key} className={'day-card' + (has ? ' has' : '')}>
              <div className="day-label">{d.label}</div>

              {recipes.map((r) => (
                <DayRecipe
                  key={r.id}
                  recipe={r}
                  onServings={(s) => setServings(d.key, r.id, s)}
                  onRemove={() => removeRecipe(d.key, r.id)}
                />
              ))}

              {recipes.length === 0 && !note.trim() ? (
                // Empty day: a full-width invitation.
                <button className="day-add" onClick={() => setPicking(d.key)} disabled={loading}>
                  + Add recipe
                </button>
              ) : (
                // Already has something: a quiet link to stack on another dish.
                <button className="day-addlink" onClick={() => setPicking(d.key)} disabled={loading}>
                  {recipes.length > 0 ? '+ add another' : '+ add a recipe'}
                </button>
              )}

              <DayNote value={note} onSave={(v) => setNote(d.key, v)} />
            </div>
          );
        })}
      </div>

      {picking && (
        <RecipePicker
          dayLabel={pickingLabel}
          onClose={() => setPicking(null)}
          onPick={(entry) => {
            addRecipe(picking, entry);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
