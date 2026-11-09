import { useCallback, useEffect, useState } from 'react';

// A saved Walmart product for an ingredient (see src/lib/walmart.ts).
export type WalmartPick = { itemId: string; label: string };

// Saved picks, shared across the household like the checkmarks. Only loaded
// while Walmart mode is on. `save` and `forget` resolve to an error message, or
// null on success.
export function useWalmartPicks(enabled: boolean) {
  const [picks, setPicks] = useState<Record<string, WalmartPick>>({});
  const [needsSetup, setNeedsSetup] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/shopping-picks');
      if (!r.ok) return;
      const j = await r.json();
      setPicks(j.picks ?? {});
      setNeedsSetup(!!j.needsSetup);
    } catch {
      /* keep what we have — picks are a convenience, the list still works */
    }
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  const save = useCallback(async (key: string, link: string): Promise<string | null> => {
    try {
      const r = await fetch('/api/shopping-picks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, link }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.needsSetup) setNeedsSetup(true);
        return j.error || `Couldn't save (HTTP ${r.status}).`;
      }
      setPicks((prev) => ({ ...prev, [key]: { itemId: j.itemId, label: j.label ?? '' } }));
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, []);

  const forget = useCallback(async (key: string): Promise<string | null> => {
    try {
      const r = await fetch(`/api/shopping-picks?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!r.ok) return (await r.json().catch(() => ({}))).error || `Couldn't remove (HTTP ${r.status}).`;
      setPicks((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, []);

  return { picks, needsSetup, reload, save, forget };
}
