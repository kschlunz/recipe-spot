import { useCallback, useEffect, useState } from 'react';
import { useRefreshOnFocus } from './useRefreshOnFocus';

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

// A recipe picked from the library, before it's placed on a day.
export type PlanEntry = { slug: string; title: string; eyebrow?: string; tagline?: string; serves?: number };
// A recipe placed on a day: a PlanEntry plus its meal_plan_recipes row id and
// its per-dish target servings.
export type PlanRecipe = PlanEntry & { id: string; servings: number | null; calories?: number | null };
export type DayPlan = { recipes: PlanRecipe[]; note: string };
export type Plan = Record<Day, DayPlan>;

const emptyDay = (): DayPlan => ({ recipes: [], note: '' });
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

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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
  useRefreshOnFocus(() => refresh(true));

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/meal-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not update the plan.');
      refresh();
      return null;
    }
    return res.json().catch(() => ({}));
  };

  const addRecipe = useCallback(async (day: Day, entry: PlanEntry) => {
    const tempId = `temp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const optimistic: PlanRecipe = { ...entry, id: tempId, servings: null };
    setPlan((p) => ({ ...p, [day]: { ...p[day], recipes: [...p[day].recipes, optimistic] } }));
    const j = await post({ day, add: entry.slug });
    if (j?.id) {
      // Swap the temp id for the real one so later edits target the right row.
      setPlan((p) => ({
        ...p,
        [day]: { ...p[day], recipes: p[day].recipes.map((r) => (r.id === tempId ? { ...r, id: j.id } : r)) },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeRecipe = useCallback(async (day: Day, itemId: string) => {
    setPlan((p) => ({ ...p, [day]: { ...p[day], recipes: p[day].recipes.filter((r) => r.id !== itemId) } }));
    if (itemId.startsWith('temp-')) return; // still being created; nothing to delete yet
    await fetch(`/api/meal-plan?item=${encodeURIComponent(itemId)}`, { method: 'DELETE' });
  }, []);

  const setServings = useCallback(async (day: Day, itemId: string, servings: number) => {
    setPlan((p) => ({
      ...p,
      [day]: { ...p[day], recipes: p[day].recipes.map((r) => (r.id === itemId ? { ...r, servings } : r)) },
    }));
    if (itemId.startsWith('temp-')) return;
    await post({ item_id: itemId, servings });
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

  return { plan, loading, error, refresh, addRecipe, removeRecipe, setNote, setServings, clearDay, clear };
}
