import { useCallback, useEffect, useRef, useState } from 'react';

// Screen Wake Lock: keep the phone from dimming/locking while a recipe is open
// and you're cooking. Supported on iOS 16.4+ Safari and Chrome. The OS releases
// the lock whenever the page is hidden (you switch apps), so we re-acquire it on
// return as long as the user still wants it on.
export function useWakeLock() {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [active, setActive] = useState(false); // the user's intent
  const lockRef = useRef<any>(null);

  const request = useCallback(async () => {
    if (!supported) return;
    try {
      const sentinel = await (navigator as any).wakeLock.request('screen');
      // A system release (tab hidden) clears the sentinel; intent stays on so we
      // can re-acquire on return.
      sentinel.addEventListener('release', () => {
        lockRef.current = null;
      });
      lockRef.current = sentinel;
      setActive(true);
    } catch {
      // Denied or not allowed right now (e.g. low-power mode) — leave it off.
      setActive(false);
    }
  }, [supported]);

  const release = useCallback(async () => {
    setActive(false);
    const cur = lockRef.current;
    lockRef.current = null;
    try {
      await cur?.release();
    } catch {
      /* already gone */
    }
  }, []);

  const toggle = useCallback(() => {
    if (active) release();
    else request();
  }, [active, release, request]);

  // Re-acquire when the page becomes visible again, if the user left it on.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && active && !lockRef.current) request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [active, request]);

  // Release on unmount (leaving the recipe).
  useEffect(
    () => () => {
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    },
    [],
  );

  return { supported, active, toggle };
}
