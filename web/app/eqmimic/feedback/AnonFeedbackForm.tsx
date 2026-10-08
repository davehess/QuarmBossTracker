'use client';

import { useEffect, useState } from 'react';
import { submitAnonFeedback } from './actions';

const CATS: { value: 'bug' | 'idea'; label: string; hint: string }[] = [
  { value: 'bug',  label: 'Bug',  hint: 'What happened, and what you expected.' },
  { value: 'idea', label: 'Idea', hint: 'What you would like it to do.' },
];

// Mimic opens this page with the report already filled in, in the URL FRAGMENT:
//   #cat=bug&text=…&v=2.7.10&p=win32
// The fragment is read here, in the browser, and is never sent to a server. That is why it is a
// fragment and not a query string: a query string lands in the host's request logs before any
// cleaning could run. The fields stay editable, so the person sees exactly what will be sent.
function readFragment(): { cat?: 'bug' | 'idea'; text?: string; v?: string; p?: string } | null {
  try {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return null;
    const p = new URLSearchParams(hash);
    const cat = p.get('cat');
    return {
      cat: cat === 'bug' || cat === 'idea' ? cat : undefined,
      text: p.get('text') ?? undefined,
      v: p.get('v') ?? undefined,
      p: p.get('p') ?? undefined,
    };
  } catch { return null; }
}

export default function AnonFeedbackForm() {
  const [category, setCategory] = useState<'bug' | 'idea'>('bug');
  const [message, setMessage]   = useState('');
  const [contact, setContact]   = useState('');
  const [website, setWebsite]   = useState(''); // honeypot
  const [fromMimic, setFromMimic] = useState(false);
  const [version, setVersion]   = useState('');
  const [platform, setPlatform] = useState('');
  const [state, setState]       = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [err, setErr]           = useState('');
  const [ref, setRef]           = useState<number | null>(null);

  useEffect(() => {
    const f = readFragment();
    if (!f) return;
    setFromMimic(true);
    if (f.cat) setCategory(f.cat);
    if (f.text) setMessage(f.text.slice(0, 4000));
    if (f.v) setVersion(f.v);
    if (f.p) setPlatform(f.p);
    // Take the report out of the address bar so it is not left in history or a shared screenshot.
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* fine */ }
  }, []);

  const hint = CATS.find(c => c.value === category)?.hint || '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) { setErr('Please write something first.'); setState('error'); return; }
    setState('sending'); setErr('');
    try {
      const r = await submitAnonFeedback({
        category, message, contact, website,
        client: fromMimic ? 'mimic' : 'web',
        appVersion: version, platform,
      });
      if (r.ok) { setRef(r.ref ?? null); setState('done'); setMessage(''); setContact(''); }
      else { setErr(r.error || 'Something went wrong.'); setState('error'); }
    } catch {
      setErr('Could not send. Please try again in a bit.'); setState('error');
    }
  };

  if (state === 'done') {
    return (
      <div className="bg-panel border border-green/40 rounded-lg p-6 text-center space-y-3" role="status">
        <div className="text-green font-semibold">
          {ref != null ? <>Thanks — your reference is AFB-{ref}</> : <>Thanks — got it</>}
        </div>
        <div className="text-sm text-dim">It has been saved. You can close this tab.</div>
        <button type="button" onClick={() => { setState('idle'); setRef(null); }} className="text-blue hover:underline text-sm">
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-panel border border-border rounded-lg p-5 space-y-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What kind of feedback">
        {CATS.map(c => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={category === c.value}
            onClick={() => setCategory(c.value)}
            className={[
              'px-3 py-1.5 rounded border text-sm',
              category === c.value ? 'border-blue bg-[#1f6feb33] text-blue' : 'border-border bg-bg text-text hover:border-blue',
            ].join(' ')}
          >
            {c.label}
          </button>
        ))}
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-dim">Your message</span>
        <textarea
          value={message}
          onChange={e => { setMessage(e.target.value); if (state === 'error') setState('idle'); }}
          placeholder={hint}
          rows={7}
          maxLength={4000}
          className="w-full bg-bg border border-border rounded p-3 text-sm text-text focus:outline-none focus:border-blue resize-y"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-dim">Discord name (optional, only if you want a reply)</span>
        <input
          type="text"
          value={contact}
          onChange={e => setContact(e.target.value)}
          maxLength={60}
          autoComplete="off"
          placeholder="yourname"
          className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-blue"
        />
      </label>

      {(version || platform) && (
        <div className="text-[11px] text-dim">
          Sent with this report: Mimic {version || 'unknown version'}{platform ? ` on ${platform}` : ''}.
        </div>
      )}

      {/* Honeypot. Off-screen and out of the tab order, so a person never reaches it; a bot that fills
          every field gives itself away. The server answers it with a normal thank-you and stores nothing. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Leave this empty
          <input type="text" name="company_website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
        </label>
      </div>

      {state === 'error' && <div className="text-sm text-red" role="alert">{err}</div>}

      <button
        type="submit"
        disabled={state === 'sending'}
        className="px-4 py-2 rounded border border-blue bg-[#1f6feb] text-white text-sm disabled:opacity-60"
      >
        {state === 'sending' ? 'Sending…' : 'Send feedback'}
      </button>
    </form>
  );
}
