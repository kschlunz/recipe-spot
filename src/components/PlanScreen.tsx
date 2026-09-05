import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAYS, useMealPlan, type Day, type PlanEntry, type PlanRecipe } from '../hooks/useMealPlan';
import { useRecipeList } from '../hooks/useRecipes';
import HeartHealthyIcon from './HeartHealthyIcon';

const DAY_KEYS = DAYS.map((d) => d.key) as readonly string[];

// Which day-card sits under a screen point, for touch/mouse drag-and-drop.
function dayUnderPoint(x: number, y: number): Day | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const card = el?.closest('[data-day]') as HTMLElement | null;
  const d = card?.dataset.day;
  return d && DAY_KEYS.includes(d) ? (d as Day) : null;
}

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
                onClick={() =>
                  onPick({
                    slug: r.slug,
                    title: r.title,
                    eyebrow: r.eyebrow,
                    tagline: r.tagline,
                    calories: r.calories,
                  })
                }
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

// Format a YYYY-MM-DD as "Aug 21" for the cooked badge.
function fmtShort(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}`;
}

// One planned dish within a day: cooked check, drag handle, link, servings, remove.
function DayRecipe({
  recipe,
  dragging,
  onDragStart,
  onToggleCooked,
  onServings,
  onRemove,
}: {
  recipe: PlanRecipe;
  dragging: boolean;
  onDragStart: (e: React.PointerEvent) => void;
  onToggleCooked: () => void;
  onServings: (servings: number) => void;
  onRemove: () => void;
}) {
  const serves = recipe.servings ?? recipe.serves ?? 4;
  const cooked = !!recipe.cookedOn;
  return (
    <div className={'day-recipe' + (dragging ? ' dragging' : '') + (cooked ? ' cooked' : '')}>
      <span
        className="drag-grip"
        onPointerDown={onDragStart}
        title="Drag to another day"
        aria-label="Drag to another day"
        role="button"
      >
        ⠿
      </span>
      <a className="day-recipe-link" href={`#/r/${recipe.slug}`}>
        {recipe.eyebrow && <span className="eyebrow">{recipe.eyebrow}</span>}
        <b>{recipe.title}</b>
      </a>
      {recipe.calories ? <div className="day-recipe-cal">≈ {recipe.calories.toLocaleString()} cal</div> : null}
      <button
        className={'cooked-check' + (cooked ? ' on' : '')}
        onClick={onToggleCooked}
        title={cooked ? 'Cooked — tap to un-check' : 'Mark this as cooked'}
      >
        <span className="box">{cooked ? '✓' : ''}</span>
        {cooked ? `Cooked · ${fmtShort(recipe.cookedOn!)}` : 'Cooked?'}
      </button>
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
  const { plan, loading, error, refresh, addRecipe, removeRecipe, moveRecipe, toggleCooked, setNote, setServings, clear } =
    useMealPlan();
  const [picking, setPicking] = useState<Day | null>(null);
  const [filling, setFilling] = useState(false);
  const [fillMsg, setFillMsg] = useState('');
  // "Fill my week" heart-healthy-only preference, remembered per device.
  const [heartOnly, setHeartOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem('fill-heart-only') === '1';
    } catch {
      return false;
    }
  });
  const toggleHeartOnly = () =>
    setHeartOnly((v) => {
      const next = !v;
      try {
        localStorage.setItem('fill-heart-only', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });

  // Drag-and-drop to move a dish to another day. Pointer-based so it works with
  // both a mouse and a finger (native HTML5 DnD doesn't fire on touch).
  const dragRef = useRef<{ itemId: string; fromDay: Day } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<Day | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);

  const onDragMove = useCallback((e: PointerEvent) => {
    setGhost((g) => (g ? { ...g, x: e.clientX, y: e.clientY } : g));
    setOverDay(dayUnderPoint(e.clientX, e.clientY));
  }, []);

  const onDragEnd = useCallback(
    (e: PointerEvent) => {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragEnd);
      window.removeEventListener('pointercancel', onDragEnd);
      const target = dayUnderPoint(e.clientX, e.clientY);
      const drag = dragRef.current;
      if (drag && target && target !== drag.fromDay) moveRecipe(drag.fromDay, target, drag.itemId);
      dragRef.current = null;
      setDragId(null);
      setOverDay(null);
      setGhost(null);
    },
    [onDragMove, moveRecipe],
  );

  const startDrag = useCallback(
    (e: React.PointerEvent, recipe: PlanRecipe, fromDay: Day) => {
      if (!e.isPrimary) return;
      e.preventDefault();
      dragRef.current = { itemId: recipe.id, fromDay };
      setDragId(recipe.id);
      setOverDay(fromDay);
      setGhost({ title: recipe.title, x: e.clientX, y: e.clientY });
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
      window.addEventListener('pointercancel', onDragEnd);
    },
    [onDragMove, onDragEnd],
  );

  const filled = DAYS.filter((d) => plan[d.key].recipes.length > 0 || plan[d.key].note.trim()).length;
  const pickingLabel = picking ? DAYS.find((d) => d.key === picking)!.label : '';

  const dayCalories = (key: Day) => plan[key].recipes.reduce((s, r) => s + (r.calories || 0), 0);
  const weekCalories = DAYS.reduce((s, d) => s + dayCalories(d.key), 0);
  const weekCost = DAYS.reduce((s, d) => s + plan[d.key].recipes.reduce((t, r) => t + (r.cost || 0), 0), 0);

  // A day is "open" for the randomizer only if it has no recipe and no note, so
  // we never overwrite something you've set (a recipe, or "eat out").
  const openDays = DAYS.filter((d) => plan[d.key].recipes.length === 0 && !plan[d.key].note.trim());

  const fillWeek = async () => {
    if (openDays.length === 0) return;
    setFilling(true);
    setFillMsg('');
    try {
      const res = await fetch('/api/plan-suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: openDays.map((d) => d.key), heartHealthyOnly: heartOnly }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const picks: Array<{
        day: Day;
        slug: string;
        title: string;
        eyebrow?: string;
        tagline?: string;
        serves?: number;
        calories?: number | null;
      }> = json.picks ?? [];
      if (picks.length === 0) {
        setFillMsg(json.note || 'Nothing to add — import some recipes first.');
        return;
      }
      for (const p of picks) {
        await addRecipe(p.day, {
          slug: p.slug,
          title: p.title,
          eyebrow: p.eyebrow,
          tagline: p.tagline,
          serves: p.serves,
          calories: p.calories,
        });
      }
      // Re-sync from the server so calories/servings are authoritative.
      refresh(true);
      const overlap: string[] = Array.isArray(json.overlap) ? json.overlap : [];
      const msgs = [];
      if (overlap.length) msgs.push(`♻️ Reused across meals: ${overlap.slice(0, 6).join(', ')}.`);
      if (json.note) msgs.push(json.note);
      setFillMsg(msgs.join(' '));
    } catch (e) {
      setFillMsg((e as Error).message);
    } finally {
      setFilling(false);
    }
  };

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
          {weekCalories > 0 && (
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 12,
                color: 'var(--ink-soft)',
                letterSpacing: '0.06em',
              }}
              title="Sum of per-serving calories across the week (estimated)"
            >
              ≈ {weekCalories.toLocaleString()} cal/wk
            </span>
          )}
          {weekCost > 0 && (
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 12,
                color: 'var(--turmeric)',
                letterSpacing: '0.06em',
              }}
              title="Estimated grocery cost of the week's recipes"
            >
              ≈ ${Math.round(weekCost)}/wk
            </span>
          )}
          <label
            className={'heart-only-toggle' + (heartOnly ? ' on' : '')}
            title="When on, Fill my week only picks recipes labeled heart-healthy"
          >
            <input type="checkbox" checked={heartOnly} onChange={toggleHeartOnly} />
            <HeartHealthyIcon size={14} /> Heart-healthy only
          </label>
          <button
            onClick={fillWeek}
            disabled={filling || openDays.length === 0}
            title={
              openDays.length === 0
                ? 'Every day already has something'
                : heartOnly
                  ? 'Fill the empty days with heart-healthy recipes'
                  : 'Fill the empty days with recipes that share ingredients, to use up produce and cut shopping'
            }
          >
            {filling ? 'Filling…' : '🧺 Fill my week'}
          </button>
          <a href="#/shopping" className="go" style={{ padding: '6px 13px', textDecoration: 'none' }}>
            🛒 Shopping list
          </a>
          <a href="#/cooked" className="go" style={{ padding: '6px 13px', textDecoration: 'none' }}>
            🍳 Cooked log
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
      {fillMsg && <p className="status-line">{fillMsg}</p>}

      <div className="week-grid">
        {DAYS.map((d) => {
          const { recipes, note } = plan[d.key];
          const has = recipes.length > 0 || note.trim().length > 0;
          const isOver = overDay === d.key && dragRef.current?.fromDay !== d.key;
          return (
            <div
              key={d.key}
              data-day={d.key}
              className={'day-card' + (has ? ' has' : '') + (isOver ? ' drop-over' : '')}
            >
              <div className="day-label">{d.label}</div>

              {recipes.map((r) => (
                <DayRecipe
                  key={r.id}
                  recipe={r}
                  dragging={dragId === r.id}
                  onDragStart={(e) => startDrag(e, r, d.key)}
                  onToggleCooked={() => toggleCooked(d.key, r)}
                  onServings={(s) => setServings(d.key, r.id, s)}
                  onRemove={() => removeRecipe(d.key, r.id)}
                />
              ))}

              {recipes.length > 1 && dayCalories(d.key) > 0 && (
                <div className="day-cal" title="Combined per-serving calories for the day (estimated)">
                  Total ≈ {dayCalories(d.key).toLocaleString()} cal
                </div>
              )}

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

      {ghost && (
        <div className="drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
          {ghost.title}
        </div>
      )}
    </div>
  );
}
