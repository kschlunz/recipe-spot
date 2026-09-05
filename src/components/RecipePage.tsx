import { useEffect, useRef, useState } from 'react';
import RecipeView from './RecipeView';
import CookNotes from './CookNotes';
import { useRecipe } from '../hooks/useRecipes';
import { useWakeLock } from '../hooks/useWakeLock';
import Heart from './Heart';
import { FAVORITES_ENABLED } from '../lib/flags';
import { buildGrid } from '../lib/recipeGrid';
import { effectiveTags } from '../lib/tags';
import { fileToResizedBase64, imageFromClipboard } from '../lib/image';
import { shareRecipe, copyText } from '../lib/share';
import { ingredientsToText } from '../lib/ingredients';
import ShareIcon from './ShareIcon';
import HeartHealthyIcon from './HeartHealthyIcon';
import { STEW, type Recipe } from '../data/recipe';
import { DAYS, type Day } from '../hooks/useMealPlan';

// Show the source as a clean domain ("nytimes.com") when we can parse it,
// falling back to the raw string otherwise.
function prettyUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Format a YYYY-MM-DD (local) as "Aug 21" for the "Made N×" line.
function fmtMade(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}`;
}

function AddToWeek({ slug }: { slug: string }) {
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (day: Day, label: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/meal-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day, add: slug }),
      });
      if (!res.ok) throw new Error();
      setAdded(label);
    } catch {
      setAdded('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="addweek">
      <span className="addweek-label">Add to week</span>
      <div className="addweek-days">
        {DAYS.map((d) => (
          <button
            key={d.key}
            className="addweek-day"
            disabled={busy}
            onClick={() => add(d.key, d.label)}
            title={`Add to ${d.label}`}
          >
            {d.label.slice(0, 3)}
          </button>
        ))}
      </div>
      {added === 'error' ? (
        <span className="addweek-note err">Couldn't add — is the plan set up?</span>
      ) : added ? (
        <span className="addweek-note">
          Added to {added} · <a href="#/plan">view week →</a>
        </span>
      ) : null}
    </div>
  );
}

function EditPanel({
  slug,
  recipe,
  tags,
  onSaved,
  onClose,
}: {
  slug: string;
  recipe: Recipe;
  tags: string[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [json, setJson] = useState(() => JSON.stringify(recipe, null, 2));
  const [tagStr, setTagStr] = useState(tags.join(', '));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    let parsed: Recipe;
    try {
      parsed = JSON.parse(json) as Recipe;
      buildGrid(parsed); // validate the tree lays out before saving
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/recipes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          recipe: parsed,
          tags: tagStr
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="json-panel">
      <p className="json-hint">
        Edit the recipe. Ingredients are leaves; each step lists its inputs (ingredient ids or earlier
        step ids). To fix a separately-made component (a sauce, glaze, topping), make its step's inputs
        only that component's ingredients, and merge it into a later step. Changes are validated before
        saving.
      </p>
      <label className="edit-label">Tags (comma separated)</label>
      <input className="edit-tags" type="text" value={tagStr} onChange={(e) => setTagStr(e.target.value)} />
      <textarea spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} />
      {err && <p className="json-err">{err}</p>}
      <div className="import-actions">
        <button className="go" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default function RecipePage({ slug }: { slug: string }) {
  const {
    recipe,
    tags,
    photoUrl,
    sourceUrl,
    favorite,
    nutrition,
    setNutrition,
    cost,
    setCost,
    cookedCount,
    lastCookedOn,
    heartHealthy,
    heartReason,
    loading,
    error,
    refresh,
    toggleFavorite,
  } = useRecipe(slug);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nutriBusy, setNutriBusy] = useState(false);
  const [costBusy, setCostBusy] = useState(false);
  const [actionErr, setActionErr] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [ingCopied, setIngCopied] = useState(false);

  const calcCost = async () => {
    setCostBusy(true);
    setActionErr('');
    setInfoMsg('');
    try {
      const res = await fetch('/api/cost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !(j.cost > 0)) throw new Error(j.error || `HTTP ${res.status}`);
      setCost(j.cost);
      if (j.saved === false) {
        setInfoMsg('Estimated — run the database update (cost column) to save it for good.');
      }
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setCostBusy(false);
    }
  };
  const photoRef = useRef<HTMLInputElement>(null);
  const wake = useWakeLock();

  const calcNutrition = async () => {
    setNutriBusy(true);
    setActionErr('');
    setInfoMsg('');
    try {
      const res = await fetch('/api/nutrition', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.nutrition) throw new Error(j.error || `HTTP ${res.status}`);
      // Show it right away from the response…
      setNutrition(j.nutrition);
      // …and if it couldn't be saved (nutrition column not added yet), say so.
      if (j.saved === false) {
        setInfoMsg('Estimated — run the database update (nutrition column) to save it for good.');
      }
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setNutriBusy(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    setBusy(true);
    setActionErr('');
    try {
      const { base64, mediaType } = await fileToResizedBase64(file, 1400, 0.82);
      const res = await fetch('/api/recipe-photo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, image: base64, mediaType }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      refresh();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
      if (photoRef.current) photoRef.current.value = '';
    }
  };

  const removePhoto = async () => {
    if (!window.confirm('Remove this photo?')) return;
    setBusy(true);
    setActionErr('');
    try {
      const res = await fetch(`/api/recipe-photo?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      refresh();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The Stew is the flagship example — fall back to the bundled copy if the
  // table hasn't been seeded yet, so /r/the-stew always renders.
  const shown = recipe ?? (slug === 'the-stew' ? STEW : null);
  const editable = recipe !== null; // only DB-backed recipes can be edited

  // Share this recipe: native share sheet on phones, copy-link fallback
  // elsewhere. Feedback clears itself after a couple of seconds.
  const share = async () => {
    if (!shown) return;
    const result = await shareRecipe(slug, shown.title, shown.tagline);
    if (result === 'shared' || result === 'cancelled') {
      setShareMsg('');
      return;
    }
    setShareMsg(result === 'copied' ? '✓ Link copied to clipboard' : 'Could not copy the link.');
    window.setTimeout(() => setShareMsg(''), 2500);
  };

  // Copy this recipe's ingredient list to the clipboard. We already have the
  // full recipe here, so no fetch needed.
  const copyIngredients = async () => {
    if (!shown) return;
    const ok = await copyText(ingredientsToText(shown));
    if (ok) {
      setIngCopied(true);
      window.setTimeout(() => setIngCopied(false), 1800);
    } else {
      setActionErr('Could not copy the ingredients.');
    }
  };

  // Paste an image anywhere on the page to set the dish photo.
  const uploadRef = useRef(uploadPhoto);
  uploadRef.current = uploadPhoto;
  useEffect(() => {
    if (!editable) return;
    const onPaste = (e: ClipboardEvent) => {
      const f = imageFromClipboard(e);
      if (f) {
        e.preventDefault();
        uploadRef.current(f);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [editable]);

  const duplicate = async () => {
    if (!recipe) return;
    setBusy(true);
    setActionErr('');
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipe: { ...recipe, title: `${recipe.title} (copy)` }, tags }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.slug) throw new Error(j.error || `HTTP ${res.status}`);
      window.location.hash = `#/r/${j.slug}`;
    } catch (e) {
      setActionErr((e as Error).message);
      setBusy(false);
    }
  };

  const del = async () => {
    if (!window.confirm('Delete this recipe? It will be removed from your library and any day it is planned on.'))
      return;
    setBusy(true);
    setActionErr('');
    try {
      const res = await fetch(`/api/recipes?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      window.location.hash = '#/';
    } catch (e) {
      setActionErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <a className="backlink" href="#/">
        ← All recipes
      </a>
      {loading && !shown ? (
        <p className="loading">Loading recipe…</p>
      ) : shown ? (
        <>
          <AddToWeek slug={slug} />

          <div className="rp-meta">
            <div className="rtags">
              {effectiveTags(tags, shown.eyebrow).map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div className="rp-actions">
                {FAVORITES_ENABLED && editable && <Heart on={favorite} onClick={toggleFavorite} className="rp-heart" />}
                {wake.supported && (
                  <button
                    className={'cookmode' + (wake.active ? ' on' : '')}
                    onClick={wake.toggle}
                    title="Keep the screen from dimming or locking while you cook"
                  >
                    {wake.active ? '🔆 Screen staying on' : '🌙 Keep screen on'}
                  </button>
                )}
                <button onClick={share} title="Share this recipe" className="rp-share">
                  <ShareIcon size={15} /> Share
                </button>
                <button onClick={copyIngredients} title="Copy the ingredient list to the clipboard">
                  {ingCopied ? '✓ Ingredients copied' : '📋 Copy ingredients'}
                </button>
                <button onClick={() => window.print()}>Print</button>
                {editable && (
                  <button
                    onClick={calcCost}
                    disabled={costBusy}
                    title={cost == null ? undefined : 'Refresh the grocery-cost estimate'}
                  >
                    {costBusy ? 'Pricing…' : cost == null ? 'Estimate cost' : '↻ Re-estimate cost'}
                  </button>
                )}
                {editable && !nutrition && (
                  <button onClick={calcNutrition} disabled={nutriBusy}>
                    {nutriBusy ? 'Estimating…' : 'Calculate nutrition'}
                  </button>
                )}
                {editable && (
                  <>
                    <button className="rp-edit" onClick={() => setEditing((v) => !v)}>
                      {editing ? 'Close editor' : 'Edit recipe'}
                    </button>
                    <button
                      onClick={() => photoRef.current?.click()}
                      disabled={busy}
                      title="Pick a file — or paste an image anywhere on this page"
                    >
                      {busy ? 'Uploading…' : photoUrl ? 'Change photo' : 'Add photo'}
                    </button>
                    {photoUrl && (
                      <button onClick={removePhoto} disabled={busy}>
                        Remove photo
                      </button>
                    )}
                    <button onClick={duplicate} disabled={busy}>
                      Duplicate
                    </button>
                    <button className="danger" onClick={del} disabled={busy}>
                      Delete
                    </button>
                    <input
                      ref={photoRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadPhoto(f);
                      }}
                    />
                  </>
                )}
            </div>
          </div>
          {heartHealthy && (
            <p className="rp-hh" title="Meets Mediterranean / AHA heart-healthy guidelines">
              <HeartHealthyIcon size={16} /> Heart-healthy
              {heartReason ? <span className="rp-hh-why"> · {heartReason}</span> : null}
            </p>
          )}
          {cookedCount > 0 && (
            <p className="rp-made" title="From your cooking log">
              🍳 Made {cookedCount}×{lastCookedOn ? ` · last on ${fmtMade(lastCookedOn)}` : ''}
            </p>
          )}
          {actionErr && <p className="status-line err">{actionErr}</p>}
          {infoMsg && <p className="status-line">{infoMsg}</p>}
          {shareMsg && <p className="status-line ok">{shareMsg}</p>}
          {editable && !photoUrl && (
            <button
              type="button"
              className="photo-drop"
              onClick={() => photoRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f && f.type.startsWith('image/')) uploadPhoto(f);
              }}
              disabled={busy}
            >
              <span className="pd-title">{busy ? 'Uploading…' : '📷 Add a dish photo'}</span>
              <span className="pd-sub">Click to choose · drop an image here · or paste (⌘/Ctrl-V)</span>
            </button>
          )}

          {photoUrl && (
            <div className="recipe-photo">
              <img src={photoUrl} alt={recipe?.title ?? 'Recipe photo'} />
            </div>
          )}

          {editing && recipe && (
            <EditPanel
              slug={slug}
              recipe={recipe}
              tags={tags}
              onSaved={refresh}
              onClose={() => setEditing(false)}
            />
          )}

          <RecipeView recipe={shown} nutrition={nutrition} cost={cost} />
          {sourceUrl && (
            <p className="recipe-source">
              Source:{' '}
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                {prettyUrl(sourceUrl)}
              </a>
            </p>
          )}
          {editable && <CookNotes slug={slug} />}
        </>
      ) : (
        <div className="empty">{error ? `Couldn't load that recipe: ${error}` : 'Recipe not found.'}</div>
      )}
    </div>
  );
}
