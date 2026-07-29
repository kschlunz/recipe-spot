import { useRef, useState } from 'react';
import RecipeView from './RecipeView';
import CookNotes from './CookNotes';
import { useRecipe } from '../hooks/useRecipes';
import { buildGrid } from '../lib/recipeGrid';
import { effectiveTags } from '../lib/tags';
import { fileToResizedBase64 } from '../lib/image';
import { STEW, type Recipe } from '../data/recipe';
import { DAYS, type Day } from '../hooks/useMealPlan';

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
  const { recipe, tags, photoUrl, loading, error, refresh } = useRecipe(slug);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);

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
                <button onClick={() => window.print()}>Print</button>
                {editable && (
                  <>
                    <button className="rp-edit" onClick={() => setEditing((v) => !v)}>
                      {editing ? 'Close editor' : 'Edit recipe'}
                    </button>
                    <button onClick={() => photoRef.current?.click()} disabled={busy}>
                      {photoUrl ? 'Change photo' : 'Add photo'}
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
          {actionErr && <p className="status-line err">{actionErr}</p>}

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

          <RecipeView recipe={shown} />
          {editable && <CookNotes slug={slug} />}
        </>
      ) : (
        <div className="empty">{error ? `Couldn't load that recipe: ${error}` : 'Recipe not found.'}</div>
      )}
    </div>
  );
}
