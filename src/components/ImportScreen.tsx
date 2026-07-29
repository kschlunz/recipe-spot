import { useState } from 'react';
import RecipeView from './RecipeView';
import { buildGrid } from '../lib/recipeGrid';
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

  const runImport = async () => {
    if (!url.trim() && !text.trim()) {
      setError('Paste a URL or some recipe text first.');
      return;
    }
    setImporting(true);
    setError(null);
    setStatus('Reading the recipe…');
    setDraft(null);
    try {
      const res = await fetch('/api/import-recipe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(url.trim() ? { url: url.trim() } : { text: text.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDraft(json.recipe);
      setSource(json.source ?? null);
      setExtractedFrom(json.extractedFrom ?? '');
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
            <h1>Import a recipe</h1>
            <p>
              Paste a recipe URL and it's pulled and structured automatically. No clean link
              (a cookbook, an index card, a paywalled page)? Paste the text instead.
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

            <div className="import-divider">— or —</div>

            <label htmlFor="imp-text">Paste recipe text</label>
            <textarea
              id="imp-text"
              spellCheck={false}
              placeholder="Ingredients and instructions, however you have them…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />

            <div className="import-actions">
              <button className="go" onClick={runImport} disabled={importing}>
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
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
