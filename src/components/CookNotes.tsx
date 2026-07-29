import { useState } from 'react';
import { useCookNotes } from '../hooks/useCookNotes';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CookNotes({ slug }: { slug: string }) {
  const { notes, loading, error, add, remove } = useCookNotes(slug, true);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    await add(draft);
    setDraft('');
    setSaving(false);
  };

  return (
    <section className="cooklog">
      <h2>Cook notes</h2>

      <div className="cooklog-add">
        <textarea
          rows={2}
          placeholder="How did it go? Tweaks, timing, what you'd change next time…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="go" onClick={submit} disabled={saving || !draft.trim()}>
          {saving ? 'Saving…' : 'Add note'}
        </button>
      </div>

      {error && <p className="status-line err">{error}</p>}

      {loading ? (
        <p className="loading">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="cooklog-empty">No cook notes yet. Jot one down after you make this.</p>
      ) : (
        <ul className="cooklog-list">
          {notes.map((n) => (
            <li key={n.id} className="cooklog-item">
              <div className="cooklog-meta">
                <span className="cooklog-date">{fmtDate(n.created_at)}</span>
                <button className="cooklog-del" onClick={() => remove(n.id)} aria-label="Delete note">
                  ×
                </button>
              </div>
              <p className="cooklog-body">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
