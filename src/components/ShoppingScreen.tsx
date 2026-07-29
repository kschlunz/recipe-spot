import { useEffect, useMemo, useState } from 'react';
import { frac } from '../lib/recipeGrid';

type Amount = { q: number; u: string };
type Item = {
  name: string;
  note: string;
  amounts: Amount[];
  toTaste: boolean;
  sources: string[];
};

const keyOf = (it: Item) => it.name.toLowerCase();
const measured = (it: Item) =>
  it.amounts
    .map((a) => `${frac(a.q)} ${a.u}`.trim())
    .filter(Boolean)
    .join(' + ');

// A plain-text line for copy/paste ("2 cans chickpeas — drained").
const lineOf = (it: Item) => {
  const m = measured(it);
  const head = (m ? m + ' ' : '') + it.name + (!m && it.toTaste ? ' (to taste)' : '');
  return head + (it.note ? ` — ${it.note}` : '');
};

export default function ShoppingScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [noteItems, setNoteItems] = useState<Item[]>([]);
  const [recipes, setRecipes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/shopping')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!alive) return;
        setItems(json.items ?? []);
        setNoteItems(json.noteItems ?? []);
        setRecipes(json.recipes ?? []);
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const allItems = useMemo(() => [...items, ...noteItems], [items, noteItems]);
  const remaining = useMemo(
    () => allItems.filter((it) => !checked.has(keyOf(it))).length,
    [allItems, checked],
  );

  const toggle = (it: Item) => {
    const k = keyOf(it);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const copyList = () => {
    const text = allItems
      .filter((it) => !checked.has(keyOf(it)))
      .map(lineOf)
      .join('\n');
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {},
    );
  };

  const renderItem = (it: Item) => {
    const k = keyOf(it);
    const on = checked.has(k);
    const m = measured(it);
    return (
      <li key={k} className={'shop-item' + (on ? ' off' : '')} onClick={() => toggle(it)}>
        <span className={'shop-check' + (on ? ' on' : '')} aria-hidden>
          {on ? '✓' : ''}
        </span>
        <span className="shop-body">
          <span className="shop-name">
            {m && <span className="q">{m} </span>}
            {it.name}
            {!m && it.toTaste && <span className="note"> (to taste)</span>}
            {it.note && <span className="note"> — {it.note}</span>}
          </span>
          {it.sources.length > 0 && <span className="shop-src">{it.sources.join(' · ')}</span>}
        </span>
      </li>
    );
  };

  return (
    <div className="wrap">
      <a className="backlink" href="#/plan">
        ← This Week
      </a>

      <div className="index-head">
        <h1>Shopping list</h1>
        {allItems.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span
              style={{
                fontFamily: "'Space Mono', monospace",
                fontSize: 12,
                color: 'var(--ink-soft)',
                letterSpacing: '0.06em',
              }}
            >
              {remaining} to buy
            </span>
            <button onClick={copyList}>{copied ? 'Copied ✓' : 'Copy list'}</button>
          </div>
        )}
      </div>

      {recipes.length > 0 && <p className="shop-from">From this week: {recipes.join(' · ')}</p>}

      {loading ? (
        <p className="loading">Building your list…</p>
      ) : error ? (
        <p className="status-line err">{error}</p>
      ) : allItems.length === 0 ? (
        <div className="empty">
          Nothing planned with a recipe yet.{' '}
          <a href="#/plan" style={{ color: 'var(--turmeric)' }}>
            Plan your week →
          </a>
        </div>
      ) : (
        <>
          <p className="shop-tip">
            Rolled up from your planned recipes and any day notes (like "grill chicken and veggies") —
            "leftovers" and "eat out" are skipped. Tick off what you already have; <b>Copy list</b> copies
            only what's left. Pasting into Apple Notes? Paste, then select all and tap the checklist button
            to make them tickable.
          </p>
          {items.length > 0 && <ul className="shop-list">{items.map(renderItem)}</ul>}

          {noteItems.length > 0 && (
            <>
              <h2 className="shop-section">Your notes</h2>
              <p className="shop-section-hint">Groceries pulled from what you jotted on each day.</p>
              <ul className="shop-list">{noteItems.map(renderItem)}</ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
