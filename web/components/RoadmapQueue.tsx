// RoadmapQueue — the interactive What's-next section on /roadmap.
// Renders the open queue (quick → complex by default), lets signed-in members
// ▲ vote items up and re-sort by votes, and — for items blocked on something
// a member can supply (a log line, a raid-night observation) — collects the
// submission right on the card. Submissions ride the existing feedback
// pipeline, so they land in the Discord #feedback thread automatically.
// The page shell stays static; votes hydrate client-side via server actions.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { getRoadmapVotes, toggleRoadmapVote, submitRoadmapEvidence } from '@/app/roadmap/actions';
import type { QueueItem } from '@/lib/roadmapData';

const EFFORT_ORDER = ['quick', 'medium', 'large'] as const;
const EFFORT_LABELS: Record<QueueItem['effort'], string> = {
  quick:  '⚡ Quick wins',
  medium: '🔨 Medium builds',
  large:  '⛰️ Big rocks',
};
const EFFORT_BLURBS: Record<QueueItem['effort'], string> = {
  quick:  'Small, contained changes — each is an evening, not a project.',
  medium: 'Real features with a design behind them — a focused week each.',
  large:  'The shape-of-the-platform work — multi-week, staged, worth it.',
};
const EFFORT_CHIP: Record<QueueItem['effort'], string> = {
  quick: '⚡ quick', medium: '🔨 medium', large: '⛰️ big',
};
// Component chips reuse the platform-map palette so "what does this touch"
// reads the same here as on /platform.
const COMPONENT_STYLES: Record<string, string> = {
  Bot:      'bg-blue/15 text-blue border-blue/40',
  Web:      'bg-green/15 text-green border-green/40',
  Agent:    'bg-orange/15 text-orange border-orange/40',
  Mimic:    'bg-purple/15 text-purple border-purple/40',
  Database: 'bg-gold/15 text-gold border-gold/40',
  Upstream: 'bg-red/15 text-red border-red/40',
};

type SortMode = 'effort' | 'votes';

export default function RoadmapQueue({ items }: { items: QueueItem[] }) {
  const [sort, setSort]         = useState<SortMode>('effort');
  const [counts, setCounts]     = useState<Record<string, number>>({});
  const [mine, setMine]         = useState<Set<string>>(new Set());
  const [signedIn, setSignedIn] = useState(false);
  const [voteErr, setVoteErr]   = useState<string | null>(null);
  const [busyKey, setBusyKey]   = useState<string | null>(null);

  useEffect(() => {
    getRoadmapVotes()
      .then((v) => { setCounts(v.counts); setMine(new Set(v.mine)); setSignedIn(v.signedIn); })
      .catch(() => { /* static page still reads fine without vote data */ });
  }, []);

  const vote = async (key: string) => {
    setVoteErr(null);
    setBusyKey(key);
    try {
      const r = await toggleRoadmapVote(key);
      if (!r.ok) { setVoteErr(r.error || 'Could not vote.'); return; }
      setCounts((c) => ({ ...c, [key]: r.count ?? 0 }));
      setMine((m) => {
        const n = new Set(m);
        if (r.voted) n.add(key); else n.delete(key);
        return n;
      });
    } catch {
      setVoteErr('Could not vote — try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const byVotes = useMemo(
    () => [...items].sort((a, b) => (counts[b.key] || 0) - (counts[a.key] || 0)),
    [items, counts],
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg text-orange mr-auto">What&apos;s next — quick to complex</h2>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-dim mr-1">Sort:</span>
          {(['effort', 'votes'] as SortMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSort(m)}
              className={`px-2.5 py-1 rounded border transition-colors ${sort === m
                ? 'bg-accent border-accent text-white'
                : 'bg-panel border-border text-dim hover:text-text'}`}
            >
              {m === 'effort' ? 'Effort' : '▲ Votes'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-dim">
        The open queue, straight from the design docs — smallest first. Every item has
        its tracking number, the chips say which parts of the platform it touches, and
        the ▲ is yours: vote for what you want built next. Items blocked on something a
        member can supply have a box right on the card — paste the log line, we build
        the thing.
        {!signedIn && ' (Sign in with Discord to vote or submit.)'}
      </p>
      {voteErr && <p className="text-xs text-red">{voteErr}</p>}

      {sort === 'effort' ? (
        EFFORT_ORDER.map((tier) => (
          <div key={tier} className="space-y-3">
            <div>
              <h3 className="text-base text-text font-semibold">{EFFORT_LABELS[tier]}</h3>
              <p className="text-xs text-dim">{EFFORT_BLURBS[tier]}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.filter((q) => q.effort === tier).map((q) => (
                <QueueCard key={q.key} item={q} count={counts[q.key] || 0} voted={mine.has(q.key)}
                  busy={busyKey === q.key} signedIn={signedIn} onVote={() => vote(q.key)} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {byVotes.map((q) => (
            <QueueCard key={q.key} item={q} count={counts[q.key] || 0} voted={mine.has(q.key)}
              busy={busyKey === q.key} signedIn={signedIn} onVote={() => vote(q.key)} showEffort />
          ))}
        </div>
      )}
    </section>
  );
}

function QueueCard({ item, count, voted, busy, signedIn, onVote, showEffort }: {
  item: QueueItem;
  count: number;
  voted: boolean;
  busy: boolean;
  signedIn: boolean;
  onVote: () => void;
  showEffort?: boolean;
}) {
  const [open, setOpen]       = useState(false);
  const [text, setText]       = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState<string | null>(null);

  const submit = async () => {
    setSending(true);
    setResult(null);
    try {
      const r = await submitRoadmapEvidence({ itemKey: item.key, content: text });
      if (r.ok) { setResult('✓ Sent to the officers — thank you!'); setText(''); }
      else setResult(r.error || 'Could not send.');
    } catch {
      setResult('Could not send — try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <article className="bg-panel border border-border rounded-lg p-4 space-y-2">
      <header className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-bg/60 text-dim border-border">{item.num}</span>
        <h4 className="text-sm text-gold font-semibold mr-auto">{item.title}</h4>
        <button
          type="button"
          onClick={onVote}
          disabled={busy}
          title={signedIn ? (voted ? 'Remove your vote' : 'Vote this up') : 'Sign in with Discord to vote'}
          className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${voted
            ? 'bg-accent/25 border-accent text-white'
            : 'bg-bg/60 border-border text-dim hover:text-text hover:border-blue'}`}
        >
          ▲ {count}
        </button>
      </header>
      <div className="flex flex-wrap gap-1.5">
        {showEffort && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border font-mono bg-panel text-dim border-border">{EFFORT_CHIP[item.effort]}</span>
        )}
        {item.components.map((c) => (
          <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${COMPONENT_STYLES[c] || 'bg-panel text-dim border-border'}`}>
            {c}
          </span>
        ))}
      </div>
      <p className="text-xs text-dim leading-5">{item.summary}</p>
      {item.status && <p className="text-[11px] text-blue italic">{item.status}</p>}
      {item.needs && (
        <div className="border border-gold/40 bg-gold/10 rounded p-2">
          <p className="text-[11px] text-gold">🙏 We need: {item.needs}</p>
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-[11px] text-dim hover:text-blue underline"
        >
          {open ? 'Close' : item.needs ? '📎 I have it — submit here' : '📎 Have something for this? Submit it'}
        </button>
        {open && (
          <div className="mt-2 space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder={item.needs
                ? 'Paste it verbatim — timestamps and all.'
                : 'Log lines, observations, screenshots-worth-of-text — whatever helps.'}
              className="w-full bg-bg border border-border rounded p-2 text-xs text-text placeholder:text-dim/60"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={sending || !text.trim()}
                className="px-3 py-1 rounded bg-accent text-white text-xs disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send to the officers'}
              </button>
              {result && <span className="text-[11px] text-dim">{result}</span>}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
