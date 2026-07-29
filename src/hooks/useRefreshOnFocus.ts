import { useEffect, useRef } from 'react';

// Re-run `fn` when the user returns to the app — tab regains focus or the page
// becomes visible again (e.g. reopening the home-screen app). This is how a
// household member's changes show up without a manual reload. Kept silent by
// callers (no loading spinner) so returning to the app doesn't blank the screen.
export function useRefreshOnFocus(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== 'hidden') ref.current();
    };
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, []);
}
