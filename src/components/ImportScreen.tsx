import { useRef, useState } from 'react';
import RecipeView from './RecipeView';
import { buildGrid } from '../lib/recipeGrid';
import { fileToResizedBase64 } from '../lib/image';
import type { Recipe } from '../data/recipe';

// The import flow: paste a URL or text → Claude structures it → preview in the
// grid → optionally edit the JSON → save. The preview-before-save step is the
// point: eyeball "when does the garlic actually go in" before it becomes your
// reference copy.
export default function ImportScreen() {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Recipe | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [extractedFrom, setExtractedFrom] = useState('');
  const [tags, setTags] = useState('');

  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonErr, setJsonErr] = useState('');

  const [saving, setSaving] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const sendImport = async (body: Record<string, unknown>, statusMsg: string) => {
    setImporting(true);
    setError(null);
    setStatus(statusMsg);
    setDraft(null);
    try {
      const res = await fetch('/api/import-recipe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Read as text first — a timed-out or crashed function returns an empty
      // or HTML body that res.json() would choke on ("Unexpected end of JSON").
      const raw = await res.text();
      let json: { recipe?: Recipe; source?: string | null; extractedFrom?: string; tags?: string[]; error?: string } =
        {};
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch {
        json = {};
      }
      if (!res.ok || !json.recipe) {
        throw new Error(
          json.error ||
            `Import failed (HTTP ${res.status}). If the site is paywalled or blocking bots, paste the recipe text instead.`,
        );
      }
      setDraft(json.recipe);
      setSource(json.source ?? null);
      setExtractedFrom(json.extractedFrom ?? '');
      if (Array.isArray(json.tags) && json.tags.length) setTags(json.tags.join(', '));
      setJsonText(JSON.stringify(json.recipe, null, 2));
      setJsonErr('');
      setStatus(null);
    } catch (e) {
      setError((e as Error).message);
      setStatus(null);
    } finally {
      setImporting(false);
    }
  };

  const runImport = () => {
    if (!url.trim() && !text.trim()) {
      setError('Paste a URL or some recipe text first.');
      return;
    }
    sendImport(url.trim() ? { url: url.trim() } : { text: text.trim() }, 'Reading the recipe…');
  };

  const importPhoto = async (file: File) => {
    setError(null);
    setStatus('Reading the photo…');
    setImporting(true);
    try {
      const { base64, mediaType } = await fileToResizedBase64(file);
      await sendImport({ image: base64, imageMediaType: mediaType }, 'Reading the photo…');
    } catch (e) {
      setError((e as Error).message);
      setStatus(null);
      setImporting(false);
    } finally {
      if (photoRef.current) photoRef.current.value = '';
    }
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText) as Recipe;
      buildGrid(parsed); // validate before committing
      setDraft(parsed);
      setJsonErr('');
    } catch (e) {
      setJsonErr((e as Error).message);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recipe: draft,
          source_url: source,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      window.location.hash = `#/r/${json.slug}`;
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="wrap">
      <a className="backlink" href="#/">
        ← All recipes
      </a>

      {!draft && (
        <>
          <div className="import-head">
            <h1>Add a recipe</h1>
            <p>
              Paste a recipe URL and it's pulled and structured automatically. Or write your own —
              type it out, or paste a cookbook page or an Instagram/TikTok caption. Claude sorts
              whatever you give it into the grid.
            </p>
          </div>

          <div className="import-form">
            <label htmlFor="imp-url">Recipe URL</label>
            <input
              id="imp-url"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="import-hint">
              Instagram &amp; TikTok links are best-effort — they usually keep the recipe in the video,
              so if it doesn't work, copy the caption and paste it below.
            </p>

            <div className="import-divider">— or —</div>

            <label htmlFor="imp-text">Write it or paste it</label>
            <textarea
              id="imp-text"
              spellCheck={false}
              placeholder="Type your own recipe, or paste a caption / cookbook page — ingredients and steps, however you have them…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />

            <div className="import-actions">
              <button className="go" onClick={runImport} disabled={importing}>
                {importing ? 'Importing…' : 'Import'}
              </button>
              <button type="button" onClick={() => photoRef.current?.click()} disabled={importing}>
                📷 Photo / screenshot
              </button>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importPhoto(f);
                }}
              />
            </div>
            <p className="import-hint">
              Upload a photo or screenshot — a cookbook page, a handwritten card, or a screenshot of an
              Instagram/TikTok caption. Claude reads the recipe right off the image, so you skip the
              copy-paste.
            </p>
            {status && <p className="status-line">{status}</p>}
            {error && <p className="status-line err">{error}</p>}
          </div>
        </>
      )}

      {draft && (
        <>
          <div className="preview-banner">
            <span className="src">Preview · {extractedFrom}</span>
            <span className="spacer" />
            <button
              onClick={() => {
                setJsonText(JSON.stringify(draft, null, 2));
                setJsonErr('');
                setJsonOpen(!jsonOpen);
              }}
            >
              {jsonOpen ? 'Close JSON' : 'Edit JSON'}
            </button>
            <button
              onClick={() => {
                setDraft(null);
                setJsonOpen(false);
              }}
            >
              Discard
            </button>
          </div>

          <div className="import-form" style={{ margin: '0 0 22px' }}>
            <label htmlFor="imp-tags">Tags (comma separated)</label>
            <input
              id="imp-tags"
              type="text"
              placeholder="weeknight, vegetarian, soup"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <div className="import-actions">
              <button className="go" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save recipe'}
              </button>
            </div>
            {error && <p className="status-line err">{error}</p>}
          </div>

          {jsonOpen && (
            <div className="json-panel">
              <p className="json-hint">
                Edit the recipe in the shared schema and apply it. Ingredients are leaves; each step
                lists its inputs (ingredient ids or earlier step ids). The grid is computed from that
                tree — the preview below updates when you apply.
              </p>
              <textarea
                spellCheck={false}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
              {jsonErr && <p className="json-err">{jsonErr}</p>}
              <button className="go" onClick={applyJson}>
                Apply changes
              </button>
            </div>
          )}

          <RecipeView recipe={draft} />
        </>
      )}
    </div>
  );
}
