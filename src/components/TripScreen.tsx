import { useEffect, useMemo, useState } from 'react';
import { TRIP_DAYS, useTrip, type TripMeal } from '../hooks/useTrip';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The date of a given day slot, when a trip start date is set. Parsed as local
// so it never slips a day.
function dayDate(startDate: string | null, index: number): string | null {
  if (!startDate) return null;
  const [y, m, d] = startDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d + index);
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
}

// One meal on a day: what's for the meal + who's got it. Both save on blur.
function MealRow({
  meal,
  onSave,
  onRemove,
}: {
  meal: TripMeal;
  onSave: (patch: Partial<{ meal: string; who: string }>) => void;
  onRemove: () => void;
}) {
  const [what, setWhat] = useState(meal.meal);
  const [who, setWho] = useState(meal.who);
  useEffect(() => setWhat(meal.meal), [meal.meal]);
  useEffect(() => setWho(meal.who), [meal.who]);
  return (
    <div className="trip-meal">
      <input
        className="trip-meal-what"
        placeholder="Meal — tacos, cookout, eat out…"
        value={what}
        onChange={(e) => setWhat(e.target.value)}
        onBlur={() => what !== meal.meal && onSave({ meal: what })}
      />
      <div className="trip-meal-who-row">
        <span className="trip-who-label">who</span>
        <input
          className="trip-meal-who"
          placeholder="Mom, Dad, everyone…"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          onBlur={() => who !== meal.who && onSave({ who })}
        />
        <button className="trip-meal-remove" onClick={onRemove} aria-label="Remove meal" title="Remove">
          ×
        </button>
      </div>
    </div>
  );
}

// A free-text field that saves on blur only when it actually changed.
function BlurInput({
  value,
  onSave,
  className,
  placeholder,
  type = 'text',
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
  type?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={className}
      type={type}
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
    />
  );
}

export default function TripScreen() {
  const { info, meals, loading, error, needsSetup, saveInfo, addMeal, updateMeal, removeMeal, clearMeals } =
    useTrip();
  const [notes, setNotes] = useState(info.notes);
  useEffect(() => setNotes(info.notes), [info.notes]);

  const mealsByDay = useMemo(() => {
    const by: TripMeal[][] = TRIP_DAYS.map(() => []);
    for (const m of meals) if (m.dayIndex >= 0 && m.dayIndex < by.length) by[m.dayIndex].push(m);
    return by;
  }, [meals]);

  const totalMeals = meals.length;

  return (
    <div className="wrap">
      <div className="index-head">
        <div>
          <BlurInput
            className="trip-title"
            placeholder="Beach Trip"
            value={info.title}
            onSave={(v) => saveInfo({ title: v })}
          />
          <div className="trip-subhead">
            <label>
              Starts{' '}
              <BlurInput
                className="trip-date"
                type="date"
                value={info.startDate ?? ''}
                onSave={(v) => saveInfo({ startDate: v || null })}
              />
            </label>
            <span className="trip-count">
              {totalMeals} meal{totalMeals === 1 ? '' : 's'} planned
            </span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => {
              if (totalMeals > 0 && window.confirm('Clear all meals from the trip?')) clearMeals();
            }}
            disabled={totalMeals === 0}
          >
            Clear meals
          </button>
        </div>
      </div>

      {error && <p className="status-line err">{error}</p>}

      {needsSetup && (
        <div className="trip-setup">
          <b>One-time setup needed.</b> The trip planner needs its database tables. In Supabase → SQL
          Editor, run the <code>trip_info</code> and <code>trip_meals</code> block from{' '}
          <code>supabase-schema.sql</code>, then reload this page. Until then, meals won’t save.
        </div>
      )}

      <div className="trip-notes-card">
        <label className="trip-notes-label" htmlFor="trip-notes">
          📝 Trip notes
        </label>
        <textarea
          id="trip-notes"
          className="trip-notes"
          rows={4}
          placeholder="Grocery run Saturday, house has a big grill, Sarah brings the cooler, beach day Wednesday…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== info.notes && saveInfo({ notes })}
        />
      </div>

      <div className="trip-grid">
        {TRIP_DAYS.map((label, i) => {
          const date = dayDate(info.startDate, i);
          const dayMeals = mealsByDay[i];
          return (
            <div key={i} className={'day-card trip-day' + (dayMeals.length ? ' has' : '')}>
              <div className="day-label">
                {label}
                {date && <span className="trip-day-date"> · {date}</span>}
              </div>

              {dayMeals.map((m) => (
                <MealRow
                  key={m.id}
                  meal={m}
                  onSave={(patch) => updateMeal(m.id, patch)}
                  onRemove={() => removeMeal(m.id)}
                />
              ))}

              <button className="day-addlink" onClick={() => addMeal(i)} disabled={loading}>
                + add a meal
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
