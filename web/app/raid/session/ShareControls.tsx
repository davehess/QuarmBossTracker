'use client';
// The officer's "Share…" panel on the session review: make a public link for THIS window, see the links that
// already cover it, revoke one. Rendered only for officers (the page checks), and the routes check again
// (/api/raid/shares). A link's address is shown ONCE, here, when it is made: the server keeps only a hash.
import { useCallback, useEffect, useState } from 'react';

type ShareView = {
  id: string; title: string; from_at: string; to_at: string; created_at: string; expires_at: string;
  revoked_at: string | null; view_count: number; status: 'ok' | 'expired' | 'revoked';
};
type Made = { url: string; canonical: string };

const chip = 'rounded border px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue';
const chipIdle = 'border-border bg-panel text-text hover:bg-[#21262d]';
const chipOn = 'border-accent bg-accent text-white';
const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });

export default function ShareControls({ fromIso, toIso, defaultTitle }: { fromIso: string; toIso: string; defaultTitle: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [copied, setCopied] = useState(false);
  const [shares, setShares] = useState<ShareView[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/raid/shares?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`);
      if (!res.ok) throw new Error('bad');
      const j = await res.json();
      setShares(Array.isArray(j.shares) ? j.shares : []);
    } catch { setShares([]); setErr('The list of links did not load.'); }
  }, [fromIso, toIso]);
  useEffect(() => { if (open && shares === null) void load(); }, [open, shares, load]);

  const create = async () => {
    setBusy(true); setErr(null); setCopied(false);
    try {
      const res = await fetch('/api/raid/shares', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromIso, to: toIso, title, days }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'failed');
      setMade({ url: j.url, canonical: j.canonical });
      void load();
    } catch (e) {
      setErr(e instanceof Error && e.message ? `Could not make the link: ${e.message}.` : 'Could not make the link.');
    } finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    setErr(null);
    try {
      const res = await fetch(`/api/raid/shares/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('bad');
      setMade(null);
      void load();
    } catch { setErr('Could not revoke that link. Try again.'); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className={`${chip} ${open ? chipOn : chipIdle}`}>
        Share…
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-border bg-panel p-3 text-sm">
          <p className="text-xs text-dim">
            Makes a public link to this window only: the replay, who was there, the kills, the loot and the rolls. Anyone with the
            link can read it without signing in, until it expires or you revoke it. Characters who opted out are left out.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-dim">
              Title (shown at the top of the page)
              <input value={title} maxLength={120} onChange={e => setTitle(e.target.value)}
                className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-text" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-dim">
              Expires after
              <select value={days} onChange={e => setDays(Number(e.target.value))}
                className="rounded border border-border bg-bg px-2 py-1.5 text-sm text-text">
                {[7, 30, 90].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </label>
            <button type="button" disabled={busy} onClick={create} className={`${chip} ${chipOn} disabled:opacity-50`}>
              {busy ? 'Making…' : 'Make the link'}
            </button>
          </div>

          {made && (
            <div className="mt-3 rounded border border-gold/50 bg-gold/10 p-2.5" role="status">
              <p className="text-xs text-gold">Copy it now. This address is shown once and cannot be looked up again.</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input readOnly value={made.canonical} onFocus={e => e.currentTarget.select()} aria-label="Share link"
                  className="min-w-[16rem] flex-1 rounded border border-border bg-bg px-2 py-1.5 font-mono text-xs text-text" />
                <button type="button" onClick={() => copy(made.canonical)} className={`${chip} ${chipIdle}`}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
              {made.url !== made.canonical && (
                <p className="mt-1.5 break-all text-xs text-dim">Until this page is on wolfpack.quest, the same link works here: {made.url}</p>
              )}
            </div>
          )}
          {err && <p className="mt-2 text-xs text-red" role="alert">{err}</p>}

          <h3 className="mb-1 mt-4 text-[11px] uppercase tracking-wider text-dim">Links that cover this window</h3>
          {shares === null ? <p className="text-xs text-dim">Loading…</p>
            : shares.length === 0 ? <p className="text-xs text-dim">None yet.</p>
            : (
              <ul className="space-y-1">
                {shares.map(s => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 py-1.5 text-xs">
                    <span>
                      <span className="text-text">{s.title || 'Untitled'}</span>
                      <span className="text-dim"> · made {day.format(Date.parse(s.created_at))} · {s.view_count} {s.view_count === 1 ? 'view' : 'views'} · </span>
                      <span className={s.status === 'ok' ? 'text-green' : 'text-dim'}>
                        {s.status === 'ok' ? `live until ${day.format(Date.parse(s.expires_at))}` : s.status === 'revoked' ? 'revoked' : 'expired'}
                      </span>
                    </span>
                    {s.status === 'ok' && (
                      <button type="button" onClick={() => revoke(s.id)} className={`${chip} ${chipIdle}`}>Revoke</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}
