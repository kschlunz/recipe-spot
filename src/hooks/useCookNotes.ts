import { useCallback, useEffect, useState } from 'react';

export type CookNote = { id: string; body: string; created_at: string };

export function useCookNotes(slug: string, enabled: boolean) {
  const [notes, setNotes] = useState<CookNote[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cook-notes?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const json = await res.json();
      setNotes(json.notes ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!text) return;
      const res = await fetch('/api/cook-notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, body: text }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || 'Could not save the note.');
        return;
      }
      const json = await res.json();
      if (json.note) setNotes((n) => [json.note, ...n]);
    },
    [slug],
  );

  const remove = useCallback(async (id: string) => {
    setNotes((n) => n.filter((x) => x.id !== id));
    await fetch(`/api/cook-notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }, []);

  return { notes, loading, error, add, remove };
}
