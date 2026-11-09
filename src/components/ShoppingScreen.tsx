import { useCallback, useEffect, useMemo, useState } from 'react';
import { frac } from '../lib/recipeGrid';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import { useWalmartPicks } from '../hooks/useWalmartPicks';
import { walmartCartUrl, walmartKey, walmartProductUrl, walmartSearchUrl } from '../lib/walmart';
import WalmartPickEditor from './WalmartPickEditor';

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

// Whether the Walmart links are showing — remembered per device. Storage can be
// unavailable (private mode), so both sides are best-effort.
const WALMART_KEY = 'shop.walmart';
const readWalmart = () => {
  try {
    return localStorage.getItem(WALMART_KEY) === '1';
  } catch {
    return false;
  }
};

export default function ShoppingScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [spices, setSpices] = useState<Item[]>([]);
  const [noteItems, setNoteItems] = useState<Item[]>([]);
  const [recipes, setRecipes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);
  const [walmart, setWalmart] = useState(readWalmart);
  const { picks, needsSetup, reload: reloadPicks, save: savePick, forget: forgetPick } = useWalmartPicks(walmart);
  // The row whose pick form is open, and the rows last sent to a Walmart cart
  // (both by checkmark key).
  const [editing, setEditing] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);

  const toggleWalmart = () => {
    const next = !walmart;
    setWalmart(next);
    try {
      localStorage.setItem(WALMART_KEY, next ? '1' : '0');
    } catch {
      /* not remembered — still works for this visit */
    }
  };

  // Pull the list and the shared checkmarks together. Silent (no spinner) so a
  // focus-refresh doesn't flash "Building your list…" every time you return.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [shopRes, checkRes] = await Promise.all([
        fetch('/api/shopping'),
        fetch('/api/shopping-checks'),
      ]);
      if (!shopRes.ok) throw new Error((await shopRes.json().catch(() => ({}))).error || `HTTP ${shopRes.status}`);
      const json = await shopRes.json();
      setItems(json.items ?? []);
      setSpices(json.spices ?? []);
      setNoteItems(json.noteItems ?? []);
      setRecipes(json.recipes ?? []);
      setError(null);
      if (checkRes.ok) {
        const cj = await checkRes.json().catch(() => ({}));
        if (Array.isArray(cj.checked)) setChecked(new Set(cj.checked));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useRefreshOnFocus(() => {
    load(true);
    if (walmart) reloadPicks();
  });

  const allItems = useMemo(() => [...items, ...spices, ...noteItems], [items, spices, noteItems]);
  const remaining = useMemo(
    () => allItems.filter((it) => !checked.has(keyOf(it))).length,
    [allItems, checked],
  );

  // Unticked items that have a saved Walmart pick — what one tap can send to a
  // cart — and how many unticked items still don't.
  const cartItems = useMemo(
    () => (walmart ? allItems.filter((it) => !checked.has(keyOf(it)) && picks[walmartKey(it.name)]) : []),
    [walmart, allItems, checked, picks],
  );
  // Distinct products: two rows can share a pick ("yellow onion" twice).
  const cartIds = useMemo(
    () => [...new Set(cartItems.map((it) => picks[walmartKey(it.name)].itemId))],
    [cartItems, picks],
  );
  const unpicked = remaining - cartItems.length;
  // Of the rows last sent to the cart, the ones not ticked off yet.
  const sentLeft = useMemo(() => sent.filter((k) => !checked.has(k)), [sent, checked]);

  // Set a checkmark optimistically, then persist to the shared list. On failure,
  // reload so we don't drift from what the other phone sees.
  const setCheck = (k: string, willCheck: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (willCheck) next.add(k);
      else next.delete(k);
      return next;
    });
    const req = willCheck
      ? fetch('/api/shopping-checks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: k }),
        })
      : fetch(`/api/shopping-checks?key=${encodeURIComponent(k)}`, { method: 'DELETE' });
    req.then((r) => {
      if (!r.ok) load(true);
    }).catch(() => load(true));
  };

  const toggle = (it: Item) => {
    const k = keyOf(it);
    setCheck(k, !checked.has(k));
  };

  // After a cart hand-off: tick off everything that was sent.
  const tickSent = () => {
    sentLeft.forEach((k) => setCheck(k, true));
    setSent([]);
  };

  const uncheckAll = () => {
    setChecked(new Set());
    fetch('/api/shopping-checks?all=1', { method: 'DELETE' }).then((r) => {
      if (!r.ok) load(true);
    }).catch(() => load(true));
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
    const pk = walmartKey(it.name);
    const pick = walmart ? picks[pk] : undefined;
    const shopping = walmart && !on;
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
          {shopping && pick && <span className="shop-pick">pick: {pick.label || `item ${pick.itemId}`}</span>}
        </span>
        {shopping && (
          <span className="shop-walmart-col" onClick={(e) => e.stopPropagation()}>
            <a
              className={'shop-walmart' + (pick ? ' picked' : '')}
              href={pick ? walmartProductUrl(pick.itemId) : walmartSearchUrl(it.name)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={pick ? `Open your Walmart pick for ${it.name}` : `Find ${it.name} at Walmart`}
            >
              {pick ? '✓ Walmart ↗' : 'Walmart ↗'}
            </a>
            {!needsSetup && (
              <button
                className="shop-pick-btn"
                aria-expanded={editing === k}
                onClick={() => setEditing(editing === k ? null : k)}
              >
                {pick ? 'change pick' : 'save pick'}
              </button>
            )}
          </span>
        )}
        {shopping && editing === k && (
          <WalmartPickEditor
            name={it.name}
            pick={pick}
            onSave={(link) => savePick(pk, link)}
            onForget={() => forgetPick(pk)}
            onClose={() => setEditing(null)}
          />
        )}
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
          <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
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
            <button onClick={toggleWalmart} aria-pressed={walmart}>
              {walmart ? 'Hide Walmart' : 'Shop Walmart'}
            </button>
            {checked.size > 0 && <button onClick={uncheckAll}>Uncheck all</button>}
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
            "leftovers" and "eat out" are skipped. Tick off what you already have — checkmarks are
            <b> shared</b>, so you both see the same list while shopping. <b>Copy list</b> copies only
            what's left. Pasting into Apple Notes? Paste, then select all and tap the checklist button to
            make them tickable.
          </p>
          {walmart && (
            <div className="shop-tip shop-walmart-panel">
              <p>
                <b>Walmart pickup:</b> tap <b>Walmart ↗</b> on an item to find it in Walmart. To skip the
                search from then on, copy the link of the product you buy and tap <b>save pick</b> — picks
                are <b>shared</b> and remembered for future weeks, and everything with a pick goes to your
                cart in one tap.
              </p>
              {needsSetup && (
                <p className="trip-setup">
                  <b>One-time setup needed to save picks.</b> In Supabase → SQL Editor, run the{' '}
                  <code>walmart_picks</code> block from <code>supabase-schema.sql</code>, then reload this
                  page. The Walmart links work without it.
                </p>
              )}
              {cartItems.length > 0 && (
                <p className="shop-cart-row">
                  <a
                    className="shop-cart-btn"
                    href={walmartCartUrl(cartIds)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setSent(cartItems.map(keyOf))}
                  >
                    Add {cartIds.length} saved pick{cartIds.length === 1 ? '' : 's'} to Walmart cart ↗
                  </a>
                  <span className="shop-cart-note">
                    One of each — adjust amounts in the cart.
                    {unpicked > 0 && ` ${unpicked} more on the list ${unpicked === 1 ? 'has' : 'have'} no pick yet.`}
                  </span>
                </p>
              )}
              {sentLeft.length > 0 && (
                <p className="shop-cart-row">
                  <span>
                    <b>In your cart?</b> If Walmart opened its home page instead, one pick couldn't be added
                    — open the picks one at a time to find it.
                  </span>
                  <button onClick={tickSent}>
                    Tick off {sentLeft.length === 1 ? 'that 1' : `those ${sentLeft.length}`}
                  </button>
                  <button onClick={() => setSent([])}>Not yet</button>
                </p>
              )}
            </div>
          )}
          {items.length > 0 && <ul className="shop-list">{items.map(renderItem)}</ul>}

          {spices.length > 0 && (
            <>
              <h2 className="shop-section">Spices &amp; seasonings</h2>
              <p className="shop-section-hint">You probably have these — tick off what's already in the cupboard.</p>
              <ul className="shop-list">{spices.map(renderItem)}</ul>
            </>
          )}

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
