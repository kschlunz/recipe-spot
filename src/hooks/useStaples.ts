import { useCallback, useEffect, useState } from 'react';

// A pantry staple: something the household always has, so the shopping list
// leaves it off. `key` is the item's cleaned, lowercased name.
export type Staple = { key: string; name: string };

// The household's staples, shared like the shopping checkmarks. Adds and
// removes are optimistic; on a failed save the list reloads from the server
// so the screen never claims something that didn't stick.
export function useStaples() {
  const [staples, setStaples] = useState<Staple[]>([]);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/shopping-staples');
      if (!r.ok) return;
      const j = await r.json();
      setStaples(Array.isArray(j.staples) ? j.staples : []);
      setNeedsSetup(!!j.needsSetup);
    } catch {
      /* keep what we have — the shopping list works without staples */
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const settle = useCallback(
    async (req: Promise<Response>) => {
      try {
        const r = await req;
        if (r.ok) return setError(null);
        const j = await r.json().catch(() => ({}));
        if (j.needsSetup) setNeedsSetup(true);
        setError(j.error || `Couldn't save that (HTTP ${r.status}).`);
      } catch (e) {
        setError((e as Error).message);
      }
      reload();
    },
    [reload],
  );

  const add = useCallback(
    (key: string, name: string) => {
      setStaples((prev) => (prev.some((s) => s.key === key) ? prev : [...prev, { key, name }]));
      settle(
        fetch('/api/shopping-staples', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, name }),
        }),
      );
    },
    [settle],
  );

  const remove = useCallback(
    (key: string) => {
      setStaples((prev) => prev.filter((s) => s.key !== key));
      settle(fetch(`/api/shopping-staples?key=${encodeURIComponent(key)}`, { method: 'DELETE' }));
    },
    [settle],
  );

  return { staples, needsSetup, error, reload, add, remove };
}
