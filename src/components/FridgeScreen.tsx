import { useEffect, useMemo, useState } from 'react';

type Match = {
  slug: string;
  title: string;
  eyebrow?: string;
  tagline?: string;
  photoUrl?: string | null;
  uses: string[];
  missing: string[];
};

const STORE_KEY = 'fridge-have';

// "In the Fridge": list what you have on hand and get your saved recipes ranked
// by what you can mostly make now vs. still need to buy.
export default function FridgeScreen() {
  const [have, setHave] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(have));
    } catch {
      /* ignore */
    }
  }, [have]);

  const addFrom = (text: string) => {
    const parts = text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setHave((prev) => {
      const seen = new Set(prev.map((h) => h.toLowerCase()));
      const next = [...prev];
      for (const p of parts) {
        if (!seen.has(p.toLowerCase())) {
          next.push(p);
          seen.add(p.toLowerCase());
        }
      }
      return next;
    });
    setInput('');
  };

  const removeChip = (h: string) => setHave((prev) => prev.filter((x) => x !== h));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addFrom(input);
    } else if (e.key === 'Backspace' && !input && have.length) {
      setHave((prev) => prev.slice(0, -1));
    }
  };

  const find = async () => {
    // fold any pending typed text into the list first
    const pending = input.trim();
    const list = pending
      ? [...have, ...pending.split(',').map((s) => s.trim()).filter((s) => s && !have.some((h) => h.toLowerCase() === s.toLowerCase()))]
      : have;
    if (pending) {
      addFrom(pending);
    }
    if (list.length === 0) {
      setError('Add a few things you have first.');
      return;
    }
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const res = await fetch('/api/cook-from', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ have: list }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMatches(json.matches ?? []);
    } catch (e) {
      setError((e as Error).message);
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  const canSearch = have.length > 0 || input.trim().length > 0;
  const heading = useMemo(() => (matches.length ? `You can mostly make these` : ''), [matches]);

  return (
    <div className="wrap">
      <div className="index-head">
        <h1>In the Fridge</h1>
      </div>

      <p className="fridge-intro">
        List what you've got on hand and I'll rank your recipes by what you can make now — with what
        you'd still need to grab. Great for using up produce before it turns.
      </p>

      <div className="fridge-box">
        <div className="fridge-chips">
          {have.map((h) => (
            <span key={h} className="fridge-chip">
              {h}
              <button aria-label={`Remove ${h}`} onClick={() => removeChip(h)}>
                ×
              </button>
            </span>
          ))}
          <input
            className="fridge-input"
            placeholder={have.length ? 'add another…' : 'e.g. zucchini, chicken thighs, lemon…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => input.trim() && addFrom(input)}
          />
        </div>
        <div className="fridge-actions">
          <button className="go" onClick={find} disabled={loading || !canSearch}>
            {loading ? 'Looking…' : 'Find recipes'}
          </button>
          {have.length > 0 && (
            <button onClick={() => setHave([])} disabled={loading}>
              Clear
            </button>
          )}
        </div>
        <p className="fridge-hint">Type an ingredient and press Enter (or comma) to add it.</p>
      </div>

      {error && <p className="status-line err">{error}</p>}

      {loading ? (
        <p className="loading">Matching your recipes…</p>
      ) : searched && matches.length === 0 && !error ? (
        <div className="empty">
          Nothing close in your library yet. Try fewer or more common items, or{' '}
          <a href="#/new" style={{ color: 'var(--turmeric)' }}>
            add more recipes →
          </a>
        </div>
      ) : matches.length > 0 ? (
        <>
          {heading && <h2 className="fridge-h">{heading}</h2>}
          <div className="fridge-list">
            {matches.map((m) => (
              <a key={m.slug} className="fridge-card" href={`#/r/${m.slug}`}>
                <div className="fridge-card-main">
                  {m.eyebrow && <p className="eyebrow">{m.eyebrow}</p>}
                  <h3>{m.title}</h3>
                  {m.uses.length > 0 && (
                    <p className="fridge-uses">
                      <b>Uses:</b> {m.uses.join(', ')}
                    </p>
                  )}
                  {m.missing.length > 0 ? (
                    <p className="fridge-missing">
                      <b>Still need:</b> {m.missing.join(', ')}
                    </p>
                  ) : (
                    <p className="fridge-ready">✓ You have everything you need</p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
