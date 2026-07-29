import { useCallback, useEffect, useState } from 'react';

export const DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
] as const;

export type Day = (typeof DAYS)[number]['key'];

export type PlanEntry = { slug: string; title: string; eyebrow?: string; tagline?: string; serves?: number };
export type DayPlan = { recipe: PlanEntry | null; note: string; servings: number | null };
export type Plan = Record<Day, DayPlan>;

const emptyDay = (): DayPlan => ({ recipe: null, note: '', servings: null });
const emptyPlan = (): Plan => ({
  mon: emptyDay(),
  tue: emptyDay(),
  wed: emptyDay(),
  thu: emptyDay(),
  fri: emptyDay(),
  sat: emptyDay(),
  sun: emptyDay(),
});

export function useMealPlan() {
  const [plan, setPlan] = useState<Plan>(emptyPlan);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/meal-plan');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const json = await res.json();
      setPlan({ ...emptyPlan(), ...(json.plan ?? {}) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/meal-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not update the plan.');
      refresh();
    }
  };

  const assignRecipe = useCallback(async (day: Day, entry: PlanEntry) => {
    // reset servings to the new recipe's own default
    setPlan((p) => ({ ...p, [day]: { ...p[day], recipe: entry, servings: null } }));
    await post({ day, recipe_slug: entry.slug, servings: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeRecipe = useCallback(async (day: Day) => {
    setPlan((p) => ({ ...p, [day]: { ...p[day], recipe: null, servings: null } }));
    await post({ day, recipe_slug: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setServings = useCallback(async (day: Day, servings: number) => {
    setPlan((p) => ({ ...p, [day]: { ...p[day], servings } }));
    await post({ day, servings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setNote = useCallback(async (day: Day, note: string) => {
    setPlan((p) => ({ ...p, [day]: { ...p[day], note } }));
    await post({ day, note });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearDay = useCallback(async (day: Day) => {
    setPlan((p) => ({ ...p, [day]: emptyDay() }));
    await fetch(`/api/meal-plan?day=${day}`, { method: 'DELETE' });
  }, []);

  const clear = useCallback(async () => {
    setPlan(emptyPlan());
    await fetch('/api/meal-plan?all=1', { method: 'DELETE' });
  }, []);

  return { plan, loading, error, refresh, assignRecipe, removeRecipe, setNote, setServings, clearDay, clear };
}
