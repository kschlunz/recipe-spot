// Sharing a recipe. The app is hash-routed and has no login wall, so a link to
// #/r/<slug> opens straight to the recipe for anyone who has it — sharing is
// just handing over that URL. On phones we use the native share sheet; elsewhere
// (and as a fallback) we copy the link to the clipboard.

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'error';

// Absolute URL to a recipe, built from wherever the app is running.
export function recipeUrl(slug: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/r/${encodeURIComponent(slug)}`;
}

// Best-effort clipboard copy: the async Clipboard API when available (secure
// contexts), else a hidden-textarea + execCommand fallback for older Safari.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Share a recipe: native share sheet if the browser supports it, otherwise copy
// the link. Returns what actually happened so the UI can give feedback.
export async function shareRecipe(slug: string, title: string, tagline?: string): Promise<ShareResult> {
  const url = recipeUrl(slug);
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, text: tagline ? `${title} — ${tagline}` : title, url });
      return 'shared';
    } catch (e) {
      // The user dismissing the sheet throws AbortError — not a real failure,
      // and we don't want to then copy behind their back.
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      // Any other share failure: fall back to copying the link.
    }
  }
  return (await copyToClipboard(url)) ? 'copied' : 'error';
}
