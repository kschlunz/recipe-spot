import { useState, type FormEvent } from 'react';
import type { WalmartPick } from '../hooks/useWalmartPicks';

// The inline form under a shopping-list row for saving (or changing, or
// forgetting) which Walmart product the household buys for that ingredient.
// `onSave` / `onForget` resolve to an error message, or null on success.
export default function WalmartPickEditor({
  name,
  pick,
  onSave,
  onForget,
  onClose,
}: {
  name: string;
  pick?: WalmartPick;
  onSave: (link: string) => Promise<string | null>;
  onForget: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setErr(null);
    const problem = await action();
    setBusy(false);
    if (problem) setErr(problem);
    else onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (link.trim()) run(() => onSave(link));
  };

  return (
    <form className="shop-pick-form" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      <label className="shop-pick-label" htmlFor="shop-pick-link">
        {pick ? 'Change the Walmart pick for ' : 'Walmart pick for '}
        <b>{name}</b> — in Walmart, open the product you buy, copy its link, and paste it here.
      </label>
      <div className="shop-pick-row">
        <input
          id="shop-pick-link"
          className="shop-pick-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          placeholder="https://www.walmart.com/ip/…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button type="submit" className="go" disabled={busy || !link.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {pick && (
          <button type="button" disabled={busy} onClick={() => run(onForget)}>
            Forget pick
          </button>
        )}
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
      {err && <p className="status-line err">{err}</p>}
    </form>
  );
}
