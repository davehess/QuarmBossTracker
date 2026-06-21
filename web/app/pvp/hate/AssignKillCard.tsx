'use client';

// One auto-broadcast hate-kill card with the spot-picker. Per the user spec
// 2026-06-21: the card lists which spots were ALREADY known down at the
// moment of this kill, and directs the user to check the OTHER spots first.
// Once they find one empty in-game, they click that spot here and the kill
// row picks up its timer.
//
// Optimistic UX: the click immediately collapses the card to "assigned to
// spot N — saving…" so the form can't be re-submitted while the server
// action is in flight. revalidatePath('/pvp/hate') refreshes the page once
// the action returns.

import { useState, useTransition } from 'react';
import { assignSpot, clearSpot } from './actions';

type SpotMeta = { num: number; label: string; desc: string };

export default function AssignKillCard({
  killId,
  killer,
  killerGuild,
  boss,
  zone,
  killedAt,
  instanced,
  knownDownSpots,
  candidateSpots,
  allSpots,
}: {
  killId:           number;
  killer:           string | null;
  killerGuild:      string | null;
  boss:             string | null;
  zone:             string | null;
  killedAt:         string;
  instanced:        boolean;
  knownDownSpots:   SpotMeta[];
  candidateSpots:   SpotMeta[];
  allSpots:         SpotMeta[];
}) {
  const [busy, startTransition] = useTransition();
  const [assigned, setAssigned] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const guildTag = killerGuild ? `<${killerGuild}>` : '(no guild)';
  const killedAtMs = Date.parse(killedAt);
  const minutesAgo = Math.max(0, Math.round((Date.now() - killedAtMs) / 60000));
  const agoLabel = minutesAgo < 60
    ? `${minutesAgo}m ago`
    : minutesAgo < 24 * 60
      ? `${Math.round(minutesAgo / 60)}h ago`
      : `${Math.round(minutesAgo / 60 / 24)}d ago`;

  function assign(spotNum: number) {
    setError(null);
    setAssigned(spotNum);
    startTransition(async () => {
      const res = await assignSpot(killId, spotNum);
      if (!res.ok) {
        setAssigned(null);
        setError(res.error || 'assignment failed');
      }
    });
  }
  function skip() {
    setError(null);
    setSkipped(true);
    startTransition(async () => {
      const res = await clearSpot(killId);
      if (!res.ok) {
        setSkipped(false);
        setError(res.error || 'skip failed');
      }
    });
  }

  if (assigned !== null) {
    const meta = allSpots.find(s => s.num === assigned);
    return (
      <div className="rounded border border-emerald-700 bg-emerald-900/20 p-3 text-emerald-100">
        ✅ Assigned to spot <strong>#{assigned}</strong> {meta && `— ${meta.label.replace(/^Spot \d+ — /, '')}`} · timer started.
      </div>
    );
  }
  if (skipped) {
    return (
      <div className="rounded border border-zinc-700 bg-zinc-900/40 p-3 text-zinc-400">
        ⏭️ Skipped — won't affect timer math.
      </div>
    );
  }

  const renderSpots = showAll ? allSpots : candidateSpots;

  return (
    <div id={`kill-${killId}`} className="rounded border border-zinc-700 bg-zinc-900/40 p-3 text-zinc-100 scroll-mt-20">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className={instanced ? 'text-violet-300' : 'text-amber-300'}>
          {instanced ? '🏛️ Instanced' : '🌍 Open-world'}
        </span>
        <span className="font-semibold">{killer ?? 'Unknown'}</span>
        <span className="text-zinc-400">of {guildTag}</span>
        <span className="text-zinc-400">killed</span>
        <span className="font-semibold">{boss ?? '?'}</span>
        <span className="text-zinc-500">in {zone ?? 'Plane of Hate'}</span>
        <span className="ml-auto text-zinc-500 text-xs">{agoLabel}</span>
      </div>

      {knownDownSpots.length > 0 ? (
        <div className="mt-3 rounded border border-zinc-800 bg-black/20 p-2 text-xs text-zinc-400">
          <div className="text-zinc-500">At kill time, we already had these spots down (so this kill was probably somewhere else):</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {knownDownSpots.map(s => (
              <span key={s.num} className="rounded bg-zinc-800 px-2 py-0.5">
                #{s.num} {s.label.replace(/^Spot \d+ — /, '')}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded border border-zinc-800 bg-black/20 p-2 text-xs text-zinc-500">
          No spots were known down at kill time — any of the 10 spots is a candidate.
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1.5 text-xs text-zinc-400">
          {candidateSpots.length > 0 && !showAll
            ? 'Check these spots first; click the one you find empty:'
            : 'Click the spot you find empty:'}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {renderSpots.map(s => (
            <button
              key={s.num}
              type="button"
              disabled={busy}
              onClick={() => assign(s.num)}
              className="rounded border border-amber-700/60 bg-amber-900/30 px-2 py-1 text-xs text-amber-100 hover:bg-amber-800/40 disabled:opacity-50"
              title={s.desc}
            >
              #{s.num} {s.label.replace(/^Spot \d+ — /, '')}
            </button>
          ))}
          {!showAll && candidateSpots.length < allSpots.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700/40"
            >
              show all 10
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={skip}
            className="rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700/40 disabled:opacity-50"
          >
            ⏭️ Skip
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-rose-400">⚠ {error}</div>}
    </div>
  );
}
