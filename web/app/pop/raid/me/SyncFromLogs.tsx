'use client';

// "Sync from my logs": ask the member's own Mimic to re-read recent EverQuest logs for PoP flag lines.
//
//   <SyncFromLogs character="Aldenmar" onDone={() => router.refresh()} />
//
// Files the request through requestLogRescan (./rescanActions.ts), then shows the row's status. The status is read
// by the browser itself with the member's own session (RLS lets a member read their own rows), so a poll costs the
// site nothing: one small select every 20 seconds, only while a request is open, paused while the tab is hidden,
// and given up after 15 minutes (web/lib/popRescan.ts has the numbers and the wording).

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { POLL_MS, POLL_GIVE_UP_MS, DEFAULT_DAYS, relevantRow, rescanView, shouldPoll, type RescanRow } from '@/lib/popRescan';
import { requestLogRescan } from './rescanActions';

export type SyncFromLogsProps = {
  /** The character picked on the page; the request is for this one unless "all my characters" is ticked. */
  character: string | null;
  /** How many days back Mimic reads (default 14). */
  days?: number;
  /** Called once when a request that was open turns done, so the page can refresh its step lists. */
  onDone?: (found: number) => void;
};

const COLUMNS = 'id,status,character,days,requested_at,taken_at,done_at,found';

export default function SyncFromLogs({ character, days = DEFAULT_DAYS, onDone }: SyncFromLogsProps) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [row, setRow] = useState<RescanRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allMine, setAllMine] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [filing, startFile] = useTransition();
  const startedAt = useRef(Date.now());
  const wasOpen = useRef(false);

  const fetchLatest = useCallback(async () => {
    try {
      // Row level security already limits this to the signed-in member's own rows.
      const { data, error: err } = await sb.from('pop_rescan_requests').select(COLUMNS)
        .order('requested_at', { ascending: false }).limit(1);
      if (err) return;
      setRow(relevantRow((data ?? []) as RescanRow[], Date.now()));
    } catch { /* offline: try again on the next tick */ }
  }, [sb]);

  // One read on arrival, so a request filed earlier shows its state.
  useEffect(() => { void fetchLatest(); }, [fetchLatest]);

  // Light polling: only while a request is open, never while the tab is hidden, and not past 15 minutes.
  const open = shouldPoll(row, startedAt.current, Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      if (Date.now() - startedAt.current >= POLL_GIVE_UP_MS) { setGaveUp(true); clearInterval(id); return; }
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchLatest();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [open, fetchLatest]);

  // Tell the page once, when an open request turns done.
  useEffect(() => {
    const isOpen = row?.status === 'pending' || row?.status === 'taken';
    if (wasOpen.current && row?.status === 'done') onDone?.(row.found ?? 0);
    wasOpen.current = isOpen;
  }, [row, onDone]);

  function ask() {
    setError(null);
    startFile(async () => {
      const res = await requestLogRescan(allMine ? null : character, days);
      if (!res.ok) { setError(res.error); return; }
      startedAt.current = Date.now();
      setGaveUp(false);
      await fetchLatest();
    });
  }

  const view = rescanView(row, gaveUp);
  const busy = filing || view.kind === 'waiting' || view.kind === 'reading';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={ask} disabled={busy || (!character && !allMine)}
              title={`Ask your Mimic to re-read the last ${days} days of your logs for flag lines`}
              className="rounded border border-gold px-3 py-1.5 text-sm text-gold hover:bg-gold/10 disabled:opacity-50 disabled:cursor-default">
        {filing ? 'Asking…' : 'Sync from my logs'}
      </button>
      <label className="flex items-center gap-1.5 text-xs text-dim">
        <input type="checkbox" checked={allMine} onChange={e => setAllMine(e.target.checked)} />
        all my characters
      </label>
      {view.kind !== 'idle' && (
        <span role="status" aria-live="polite"
              className={`text-xs ${view.kind === 'done' ? 'text-green' : view.kind === 'failed' ? 'text-red' : 'text-dim'}`}>
          {view.text}
        </span>
      )}
      {error && <span role="status" className="text-xs text-red">{error}</span>}
    </div>
  );
}
