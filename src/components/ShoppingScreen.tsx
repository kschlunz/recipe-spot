import { useCallback, useEffect, useMemo, useState } from 'react';
import { frac } from '../lib/recipeGrid';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import { useStaples } from '../hooks/useStaples';
import { pickupLines, storeKey, storeName } from '../lib/pickup';
import { walmartSearchUrl } from '../lib/walmart';

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
  // How many lines the last "Copy for pickup" put on the clipboard (0 = idle).
  const [pickupCopied, setPickupCopied] = useState(0);
  const [walmart, setWalmart] = useState(readWalmart);
  // Pantry staples: things the household always has, left off the list. While
  // "setting staples", tapping a row marks it a staple instead of ticking it.
  const {
    staples,
    needsSetup: staplesNeedSetup,
    error: stapleError,
    reload: reloadStaples,
    add: addStaple,
    remove: removeStaple,
  } = useStaples();
  const [settingStaples, setSettingStaples] = useState(false);

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
    reloadStaples();
  });

  const allItems = useMemo(() => [...items, ...spices, ...noteItems], [items, spices, noteItems]);
  const stapleKeys = useMemo(() => new Set(staples.map((s) => s.key)), [staples]);
  const isStaple = useCallback((it: Item) => stapleKeys.has(storeKey(it.name)), [stapleKeys]);
  // What actually needs buying: everything planned, minus the staples.
  const toBuy = useMemo(() => allItems.filter((it) => !isStaple(it)), [allItems, isStaple]);
  const skipped = allItems.length - toBuy.length;
  const remaining = useMemo(() => toBuy.filter((it) => !checked.has(keyOf(it))).length, [toBuy, checked]);

  // Toggle optimistically, then persist to the shared list. On failure, reload
  // so we don't drift from what the other phone sees.
  const toggle = (it: Item) => {
    const k = keyOf(it);
    const willCheck = !checked.has(k);
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

  const uncheckAll = () => {
    setChecked(new Set());
    fetch('/api/shopping-checks?all=1', { method: 'DELETE' }).then((r) => {
      if (!r.ok) load(true);
    }).catch(() => load(true));
  };

  const copyList = () => {
    const text = toBuy
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

  // The unticked items in store terms, for pasting into a grocery pickup app.
  const copyForPickup = () => {
    const lines = pickupLines(toBuy.filter((it) => !checked.has(keyOf(it))));
    if (lines.length === 0) return;
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => {
        setPickupCopied(lines.length);
        setTimeout(() => setPickupCopied(0), 2400);
      },
      () => {},
    );
  };

  const toggleStaple = (it: Item) => {
    if (staplesNeedSetup) return;
    const sk = storeKey(it.name);
    if (stapleKeys.has(sk)) removeStaple(sk);
    else addStaple(sk, storeName(it.name) || it.name.trim());
  };

  // Staples are left out of every section, except while setting them — then
  // every row shows, so any of them can be marked or unmarked.
  const shown = (list: Item[]) => (settingStaples ? list : list.filter((it) => !isStaple(it)));

  const renderItem = (it: Item) => {
    const k = keyOf(it);
    const m = measured(it);
    const staple = settingStaples && isStaple(it);
    const on = settingStaples ? staple : checked.has(k);
    const rowClass = settingStaples ? (staple ? ' staple' : '') : on ? ' off' : '';
    return (
      <li
        key={k}
        className={'shop-item' + rowClass}
        onClick={() => (settingStaples ? toggleStaple(it) : toggle(it))}
      >
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
        {staple && <span className="shop-staple-badge">always have</span>}
        {walmart && !on && !settingStaples && (
          <a
            className="shop-walmart"
            href={walmartSearchUrl(it.name)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Find ${it.name} at Walmart`}
          >
            Walmart ↗
          </a>
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
            <button onClick={copyForPickup} disabled={remaining === 0}>
              {pickupCopied ? `Copied ${pickupCopied} item${pickupCopied === 1 ? '' : 's'} ✓` : 'Copy for pickup'}
            </button>
            <button onClick={toggleWalmart} aria-pressed={walmart}>
              {walmart ? 'Hide Walmart' : 'Shop Walmart'}
            </button>
            <button onClick={() => setSettingStaples((v) => !v)} aria-pressed={settingStaples}>
              {settingStaples ? 'Done' : 'Set staples'}
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
            make them tickable. <b>Copy for pickup</b> copies what's left as a plain list for a grocery
            app — one item per line, no prep notes — to paste into Walmart's Sparky or Instacart and
            build a pickup order.
          </p>
          {settingStaples && (
            <div className="shop-tip shop-staple-tip">
              <p>
                <b>Setting staples:</b> tap the things you always have at home — salt, oil, the spices in
                your cupboard. They're left off this list and future ones, for both of you. Tap{' '}
                <b>Done</b> when you're finished.
              </p>
              {staplesNeedSetup && (
                <p className="trip-setup">
                  <b>One-time setup needed.</b> In Supabase → SQL Editor, run the{' '}
                  <code>pantry_staples</code> block from <code>supabase-schema.sql</code>, then reload this
                  page. Until then, staples can't be saved.
                </p>
              )}
            </div>
          )}
          {stapleError && <p className="status-line err">{stapleError}</p>}
          {walmart && !settingStaples && (
            <p className="shop-tip">
              <b>Walmart pickup:</b> tap <b>Walmart ↗</b> on an item to open it in Walmart, add the one
              you want to your cart, then come back and tick it off. When the list is clear, check out in
              Walmart and pick your pickup time.
            </p>
          )}
          {toBuy.length === 0 && !settingStaples && (
            <p className="shop-section-hint">Everything on this week's list is a staple you already have.</p>
          )}
          {shown(items).length > 0 && <ul className="shop-list">{shown(items).map(renderItem)}</ul>}

          {shown(spices).length > 0 && (
            <>
              <h2 className="shop-section">Spices &amp; seasonings</h2>
              <p className="shop-section-hint">
                You probably have these — tick off what's already in the cupboard, or use{' '}
                <b>Set staples</b> to leave the ones you always have off the list for good.
              </p>
              <ul className="shop-list">{shown(spices).map(renderItem)}</ul>
            </>
          )}

          {shown(noteItems).length > 0 && (
            <>
              <h2 className="shop-section">Your notes</h2>
              <p className="shop-section-hint">Groceries pulled from what you jotted on each day.</p>
              <ul className="shop-list">{shown(noteItems).map(renderItem)}</ul>
            </>
          )}

          {staples.length > 0 && (
            <>
              <h2 className="shop-section">Staples you always have</h2>
              <p className="shop-section-hint">
                {skipped > 0
                  ? `${skipped} item${skipped === 1 ? '' : 's'} left off this week's list. `
                  : 'None of these are on this week\'s list. '}
                Tap × to start buying one again.
              </p>
              <div className="fridge-chips">
                {staples.map((s) => (
                  <span key={s.key} className="fridge-chip">
                    {s.name}
                    <button onClick={() => removeStaple(s.key)} aria-label={`Stop treating ${s.name} as a staple`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
