import { useEffect, useMemo, useState } from 'react';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';

type LogEntry = { id: string; slug: string; title: string; cookedOn: string; day: string | null };

// Parse a YYYY-MM-DD as a *local* date (not UTC) so the day never slips.
function parseLocal(iso: string): Date | null {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDateHeading(iso: string): string {
  const dt = parseLocal(iso);
  if (!dt) return iso;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - dt.getTime()) / 86400000);
  const base = `${WEEKDAYS[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
  if (diff === 0) return `Today · ${base}`;
  if (diff === 1) return `Yesterday · ${base}`;
  return base;
}

export default function CookedScreen() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cook-log');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setLog(Array.isArray(json.log) ? json.log : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);
  useRefreshOnFocus(() => load(true));

  const remove = async (id: string) => {
    setLog((l) => l.filter((e) => e.id !== id)); // optimistic
    await fetch(`/api/cook-log?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  };

  // Group by date (already sorted newest-first by the API).
  const groups = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    for (const e of log) {
      const arr = map.get(e.cookedOn) ?? [];
      arr.push(e);
      map.set(e.cookedOn, arr);
    }
    return [...map.entries()];
  }, [log]);

  // How many times each recipe has been cooked — the "most cooked" summary.
  const topCooked = useMemo(() => {
    const count = new Map<string, { title: string; slug: string; n: number }>();
    for (const e of log) {
      const cur = count.get(e.slug);
      if (cur) cur.n += 1;
      else count.set(e.slug, { title: e.title, slug: e.slug, n: 1 });
    }
    return [...count.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  }, [log]);

  const distinct = topCooked.length;

  return (
    <div className="wrap">
      <a className="backlink" href="#/plan">
        ← This Week
      </a>

      <div className="index-head">
        <h1>Cooked log</h1>
        {log.length > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: "'Space Mono', monospace",
              fontSize: 12,
              color: 'var(--ink-soft)',
              letterSpacing: '0.06em',
            }}
          >
            {log.length} meal{log.length === 1 ? '' : 's'} · {distinct} recipe{distinct === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <p className="cooked-intro">
        A running list of what you've actually cooked — checked off from This Week. Separate from
        favorites, and it sticks around after the week is cleared.
      </p>

      {error && <p className="status-line err">{error}</p>}

      {loading ? (
        <p className="loading">Loading…</p>
      ) : log.length === 0 ? (
        <div className="empty">
          Nothing logged yet. On{' '}
          <a href="#/plan" style={{ color: 'var(--turmeric)' }}>
            This Week
          </a>
          , tap <b>Cooked?</b> on a dish once you've made it.
        </div>
      ) : (
        <>
          {topCooked.length > 1 && topCooked[0].n > 1 && (
            <div className="cooked-top">
              <span className="cooked-top-label">Most cooked</span>
              {topCooked
                .filter((t) => t.n > 1)
                .map((t) => (
                  <a key={t.slug} href={`#/r/${t.slug}`} className="cooked-chip">
                    {t.title} <b>×{t.n}</b>
                  </a>
                ))}
            </div>
          )}

          <div className="cooked-groups">
            {groups.map(([date, entries]) => (
              <div key={date} className="cooked-group">
                <div className="cooked-date">{fmtDateHeading(date)}</div>
                {entries.map((e) => (
                  <div key={e.id} className="cooked-row">
                    <a className="cooked-title" href={`#/r/${e.slug}`}>
                      {e.title}
                    </a>
                    <button
                      className="cooked-remove"
                      onClick={() => remove(e.id)}
                      aria-label={`Remove ${e.title} from the log`}
                      title="Remove from the log"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
