import { useEffect, useRef, useState } from 'react';
import RecipeView from './RecipeView';
import { buildGrid } from '../lib/recipeGrid';
import { fileToResizedBase64, imageFromClipboard } from '../lib/image';
import type { Nutrition, Recipe } from '../data/recipe';

// Bookmarklet for paywalled/bot-blocked sites (NYT Cooking, etc.): run it on the
// recipe page in your logged-in browser and it copies the page's schema.org
// Recipe JSON (ingredients, steps, image, nutrition) to the clipboard. Paste
// that into the box below and the importer lifts everything out of it.
const BOOKMARKLET =
  `javascript:(function(){function f(n){if(!n)return null;if(Array.isArray(n)){for(var i=0;i<n.length;i++){var r=f(n[i]);if(r)return r}return null}if(typeof n==='object'){var t=n['@type'];if(t&&(t==='Recipe'||Array.isArray(t)&&t.indexOf('Recipe')>-1))return n;if(n['@graph'])return f(n['@graph'])}return null}var s=document.querySelectorAll('script[type="application/ld+json"]'),r=null;for(var i=0;i<s.length&&!r;i++){try{r=f(JSON.parse(s[i].textContent))}catch(e){}}if(!r){alert('Recipe Spot: no recipe data found on this page.');return}var t=JSON.stringify(r);if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){alert('Recipe copied! In Recipe Spot: Add a recipe, paste into the box, then Import.')},function(){window.prompt('Copy this, then paste into Recipe Spot:',t)})}else{window.prompt('Copy this, then paste into Recipe Spot:',t)}})();`;

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
  const [sourceNutrition, setSourceNutrition] = useState<Nutrition | null>(null);
  const [sourcePhoto, setSourcePhoto] = useState<string | null>(null);

  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonErr, setJsonErr] = useState('');

  const [saving, setSaving] = useState(false);
  const [bmkCopied, setBmkCopied] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const blmRef = useRef<HTMLAnchorElement>(null);

  // Set the javascript: href directly so React doesn't sanitize it away; the
  // link is for dragging to the bookmarks bar, not clicking here.
  useEffect(() => {
    blmRef.current?.setAttribute('href', BOOKMARKLET);
  }, []);

  const copyBookmarklet = () => {
    navigator.clipboard.writeText(BOOKMARKLET).then(
      () => {
        setBmkCopied(true);
        setTimeout(() => setBmkCopied(false), 1600);
      },
      () => {},
    );
  };

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
      let json: {
        recipe?: Recipe;
        source?: string | null;
        extractedFrom?: string;
        tags?: string[];
        nutrition?: Nutrition | null;
        photo?: string | null;
        error?: string;
      } = {};
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
      setSourceNutrition(json.nutrition ?? null);
      setSourcePhoto(json.photo ?? null);
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

  // Paste an image (a screenshot of a recipe or caption) to import it, while on
  // the input screen.
  const importPhotoRef = useRef(importPhoto);
  importPhotoRef.current = importPhoto;
  useEffect(() => {
    if (draft) return;
    const onPaste = (e: ClipboardEvent) => {
      const f = imageFromClipboard(e);
      if (f) {
        e.preventDefault();
        importPhotoRef.current(f);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [draft]);

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
          nutrition: sourceNutrition, // use the source's own numbers when present
          photo_url: sourcePhoto, // and the source's photo, if the page had one
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // Estimate grocery cost in the background (fire-and-forget).
      fetch('/api/cost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: json.slug }),
      }).catch(() => {});
      // Always run the nutrition endpoint and WAIT: it estimates nutrition when
      // the source didn't provide any (keeping the source's own numbers if it
      // did) AND assesses whether the recipe is heart-healthy — so the recipe
      // opens already labeled instead of showing a "Calculate" button.
      setStatus(sourceNutrition ? 'Checking heart-healthy…' : 'Estimating nutrition & heart-healthy…');
      await fetch('/api/nutrition', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: json.slug }),
      }).catch(() => {});
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
              Instagram/TikTok caption. You can also just <b>paste an image</b> (⌘/Ctrl-V) right here.
              Claude reads the recipe off the image, so you skip the copy-paste.
            </p>
            {status && <p className="status-line">{status}</p>}
            {error && <p className="status-line err">{error}</p>}
          </div>

          <details className="bookmarklet-box">
            <summary>Importing from NYT Cooking or another paywalled site?</summary>
            <p>
              Those sites block our reader, so grab the recipe straight from your own logged-in browser —
              photo and nutrition come along too.
            </p>
            <ol>
              <li>
                Drag this to your bookmarks bar:{' '}
                {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
                <a ref={blmRef} className="bmk-link" onClick={(e) => e.preventDefault()}>
                  📌 Recipe Spot Grab
                </a>
              </li>
              <li>On the recipe page, click that bookmark — it copies the recipe.</li>
              <li>Come back here, paste into the box above, and hit Import.</li>
            </ol>
            <div className="import-actions">
              <button type="button" onClick={copyBookmarklet}>
                {bmkCopied ? 'Copied ✓' : 'Copy bookmarklet code'}
              </button>
            </div>
            <p className="import-hint">
              On a phone (no bookmarks bar)? Tap <b>Copy bookmarklet code</b>, make a new bookmark, and
              paste it in as the address.
            </p>
          </details>
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
