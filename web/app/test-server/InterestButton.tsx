'use client';

// Per-topic interest toggle on the /test-server planning page.
// Optimistic UI: click flips state immediately; failure rolls back.
// Optional "notes" textarea expands on hover/click for "how I can help."

import { useState, useTransition } from 'react';
import { toggleInterest } from './actions';

export type InterestRow = {
  user_id:     string;
  name:        string;         // display name resolved server-side
  notes:       string | null;
};

export default function InterestButton({
  topic,
  label,
  myInterest,
  others,
}: {
  topic:      string;
  label:      string;
  myInterest: { yes: boolean; notes: string | null };
  others:     InterestRow[];   // does NOT include the current user
}) {
  const [yes,   setYes]   = useState<boolean>(myInterest.yes);
  const [notes, setNotes] = useState<string>(myInterest.notes ?? '');
  const [expanded, setExpanded] = useState<boolean>(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const totalCount = others.length + (yes ? 1 : 0);

  function onToggle() {
    const prev = { yes, notes };
    // Optimistic flip.
    const nextYes = !yes;
    setYes(nextYes);
    setErr(null);
    startTransition(async () => {
      const res = await toggleInterest(topic, nextYes ? notes : null);
      if (!res.ok) {
        setYes(prev.yes);
        setNotes(prev.notes);
        setErr(res.error ?? 'failed');
      }
    });
  }

  function onSaveNotes() {
    const trimmed = notes.trim();
    setErr(null);
    startTransition(async () => {
      const res = await toggleInterest(topic, trimmed || null);
      if (!res.ok) setErr(res.error ?? 'failed');
      else if (!yes && trimmed) setYes(true);
    });
  }

  return (
    <div className="bg-bg/30 border border-border/60 rounded-md p-2.5 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          className={[
            'px-2.5 py-1 rounded border text-xs transition-colors whitespace-nowrap',
            yes
              ? 'border-green text-green bg-green/15 hover:bg-green/25'
              : 'border-border text-dim bg-bg/40 hover:border-blue hover:text-blue',
            pending ? 'opacity-60 cursor-wait' : 'cursor-pointer',
          ].join(' ')}
          title={yes ? 'Click to remove your interest' : 'Click to mark yourself interested'}
        >
          {yes ? '✓ Interested' : '＋ I’m interested'}
        </button>
        <span className="text-text/80">{label}</span>
        <span className="ml-auto text-dim text-[10px]">
          {totalCount === 0 ? 'no one yet' : `${totalCount} interested`}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="text-dim text-[10px] hover:text-blue"
        >
          {expanded ? 'collapse ▴' : 'details ▾'}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-start gap-2">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional — what you can contribute, e.g. 'I've compiled EQEmu before' or 'I have a 100Mbps fiber line'"
              className="flex-1 min-h-[3rem] bg-bg border border-border rounded px-2 py-1 text-xs"
              maxLength={500}
              disabled={pending}
            />
            <button
              type="button"
              onClick={onSaveNotes}
              disabled={pending || notes.trim() === (myInterest.notes ?? '')}
              className="self-stretch px-2 py-1 rounded border border-blue text-blue text-xs hover:bg-[#1f6feb22] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              Save notes
            </button>
          </div>
          {others.length > 0 && (
            <ul className="text-[10px] text-dim space-y-0.5 pl-2">
              {others.map(o => (
                <li key={o.user_id}>
                  <span className="text-text">{o.name}</span>
                  {o.notes ? <span className="text-dim/80"> — {o.notes}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {err && <div className="text-red text-[10px]">⚠ {err}</div>}
        </div>
      )}
    </div>
  );
}
