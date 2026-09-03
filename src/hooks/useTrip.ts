import { useCallback, useEffect, useState } from 'react';
import { useRefreshOnFocus } from './useRefreshOnFocus';

// 8 day slots so a Saturday-to-Saturday trip fits (both Saturdays).
export const TRIP_DAYS = [
  'Saturday',
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type TripMeal = { id: string; dayIndex: number; meal: string; who: string };
export type TripInfo = { title: string; startDate: string | null; notes: string };

export function useTrip() {
  const [info, setInfoState] = useState<TripInfo>({ title: '', startDate: null, notes: '' });
  const [meals, setMeals] = useState<TripMeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trip');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const json = await res.json();
      setInfoState(json.info ?? { title: '', startDate: null, notes: '' });
      setMeals(Array.isArray(json.meals) ? json.meals : []);
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
    const res = await fetch('/api/trip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || 'Could not update the trip.');
      return null;
    }
    return res.json().catch(() => ({}));
  };

  // Update any subset of the trip info (title / startDate / notes). Optimistic.
  const saveInfo = useCallback(
    async (patch: Partial<{ title: string; startDate: string | null; notes: string }>) => {
      setInfoState((cur) => ({ ...cur, ...patch }));
      const body: Record<string, unknown> = {};
      if ('title' in patch) body.title = patch.title;
      if ('notes' in patch) body.notes = patch.notes;
      if ('startDate' in patch) body.start_date = patch.startDate ?? '';
      await post(body);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );

  const addMeal = useCallback(async (dayIndex: number) => {
    const tempId = `temp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    setMeals((m) => [...m, { id: tempId, dayIndex, meal: '', who: '' }]);
    const j = await post({ day_index: dayIndex, meal: '', who: '' });
    if (j?.id) setMeals((m) => m.map((x) => (x.id === tempId ? { ...x, id: j.id } : x)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateMeal = useCallback(async (id: string, patch: Partial<{ meal: string; who: string }>) => {
    setMeals((m) => m.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (id.startsWith('temp-')) return; // still being created; it saved empty, edit lands on refresh
    await post({ meal_id: id, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeMeal = useCallback(async (id: string) => {
    setMeals((m) => m.filter((x) => x.id !== id));
    if (id.startsWith('temp-')) return;
    await fetch(`/api/trip?meal=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }, []);

  const clearMeals = useCallback(async () => {
    setMeals([]);
    await fetch('/api/trip?all=1', { method: 'DELETE' });
  }, []);

  return { info, meals, loading, error, refresh, saveInfo, addMeal, updateMeal, removeMeal, clearMeals };
}
