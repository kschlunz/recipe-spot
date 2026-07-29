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

export type PlanEntry = { slug: string; title: string; eyebrow?: string; tagline?: string };
export type Plan = Record<Day, PlanEntry | null>;

const EMPTY: Plan = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

export function useMealPlan() {
  const [plan, setPlan] = useState<Plan>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/meal-plan');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const json = await res.json();
      setPlan({ ...EMPTY, ...(json.plan ?? {}) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const assign = useCallback(
    async (day: Day, entry: PlanEntry) => {
      // optimistic
      setPlan((p) => ({ ...p, [day]: entry }));
      const res = await fetch('/api/meal-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day, recipe_slug: entry.slug }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || 'Could not update the plan.');
        refresh();
      }
    },
    [refresh],
  );

  const remove = useCallback(async (day: Day) => {
    setPlan((p) => ({ ...p, [day]: null }));
    await fetch(`/api/meal-plan?day=${day}`, { method: 'DELETE' });
  }, []);

  const clear = useCallback(async () => {
    setPlan(EMPTY);
    await fetch('/api/meal-plan?all=1', { method: 'DELETE' });
  }, []);

  return { plan, loading, error, refresh, assign, remove, clear };
}
