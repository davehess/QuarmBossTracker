'use client';

import { useState } from 'react';
import { submitFeedback } from './actions';

const CATS: { value: string; label: string; hint: string }[] = [
  { value: 'bug',    label: '🐞 Bug / something broke', hint: "What happened, and what you expected." },
  { value: 'idea',   label: '💡 Idea / feature request', hint: "What you'd love it to do." },
  { value: 'praise', label: '🐺 Praise / it helped',     hint: "Tell us what's working!" },
  { value: 'other',  label: '💬 Other',                  hint: "Anything else." },
];

export default function FeedbackForm({ signedInAs }: { signedInAs: string | null }) {
  const [category, setCategory] = useState('bug');
  const [message, setMessage]   = useState('');
  const [state, setState]       = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [err, setErr]           = useState('');

  const hint = CATS.find(c => c.value === category)?.hint || '';

  const submit = async () => {
    if (!message.trim()) { setErr('Please write something first.'); setState('error'); return; }
    setState('sending'); setErr('');
    const r = await submitFeedback({ category, message });
    if (r.ok) { setState('done'); setMessage(''); }
    else { setErr(r.error || 'Something went wrong.'); setState('error'); }
  };

  if (state === 'done') {
    return (
      <div className="bg-panel border border-green/40 rounded-lg p-6 text-center space-y-3">
        <div className="text-2xl">🐺</div>
        <div className="text-green font-semibold">Got it — thank you!</div>
        <div className="text-sm text-dim">It lands straight in our triage list. We read every one.</div>
        <button onClick={() => setState('idle')} className="text-blue hover:underline text-sm">Send another</button>
      </div>
    );
  }

  return (
    <div className="bg-panel border border-border rounded-lg p-5 space-y-4">
      <div className="flex flex-wrap gap-2">
        {CATS.map(c => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={[
              'px-3 py-1.5 rounded border text-sm transition-colors',
              category === c.value ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-dim hover:text-text',
            ].join(' ')}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div>
        <textarea
          value={message}
          onChange={e => { setMessage(e.target.value); if (state === 'error') setState('idle'); }}
          placeholder={hint}
          rows={6}
          maxLength={4000}
          className="w-full bg-bg border border-border rounded p-3 text-sm text-text focus:outline-none focus:border-blue resize-y"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] text-dim">{hint}</span>
          <span className="text-[11px] text-dim">{message.length}/4000</span>
        </div>
      </div>

      {state === 'error' && <div className="text-red-400 text-sm">{err}</div>}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-dim">
          {signedInAs
            ? <>Submitting as <span className="text-text">{signedInAs}</span> so we can follow up.</>
            : 'Submitting anonymously — sign in if you\'d like us to be able to reply.'}
        </span>
        <button
          onClick={submit}
          disabled={state === 'sending'}
          className="px-4 py-1.5 rounded bg-blue text-white text-sm hover:bg-[#3a8bff] disabled:opacity-50"
        >
          {state === 'sending' ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
    </div>
  );
}
