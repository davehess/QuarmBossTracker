'use client';
// The night panel's editor: A LIST OF DETECTED SEGMENTS TO CONFIRM. The page reads the night and
// proposes where it changed: quiet gaps in the recording, the roster turning over, our fights switching to another
// guild's (lib/nightSlices.ts detectSegments). Each segment arrives with a guessed kind and what it holds (kills, wipes,
// another guild's fights, deaths). The officer fixes what is wrong (the kind, a name, the boundary between two segments,
// merge two, split one) and confirms, which saves them. Nothing is drawn by hand. Once saved, the list is the saved
// spans; "Detect again" throws the edits away and guesses afresh.
// A member sees the saved segments, read-only; the guesses are an officer's working copy and are not shown.
import { useMemo, useState, type MutableRefObject } from 'react';
import Link from 'next/link';
import {
  KIND_LABEL, MAX_LABEL, SLICE_KINDS, detectSegments, isKind, mergeSegments, moveBoundary, spanStats, splitSegment,
  type NightCtx, type Segment, type Slice,
} from '@/lib/nightSlices';
import { MINUTE_MS } from '@/lib/raidReplay';
import { groupLabel, raidsIn, type RaidGroup } from '@/lib/sessionGroups';
import NightStrip, { type StripSlice } from './NightStrip';
import ShareControls from './ShareControls';
import { KIND_DOT, chip, chipIdle, chipOn, etDay, etMin, field, fmtSpan, plural, windowHref } from './nightStyle';
import type { NightSave } from './NightPanel';

const asSegments = (saved: readonly Slice[]): Segment[] => saved.map(s => ({ fromMs: s.fromMs, toMs: s.toMs, kind: s.kind, label: s.label, why: 'saved' }));

export default function SegmentsEditor({ fromMs, toMs, spans, breaks, ctx, saved, groups, groupsParent, canEdit, save, go, playheadRef }: {
  fromMs: number; toMs: number; spans: { from: number; to: number }[]; breaks: number[]; ctx: NightCtx;
  saved: Slice[]; groups: RaidGroup[]; groupsParent: { fromMs: number; toMs: number }; canEdit: boolean; save: NightSave; go: (ms: number | null) => void;
  playheadRef: MutableRefObject<number | null>;
}) {
  const detect = () => detectSegments({ fromMs, toMs }, spans, breaks, ctx);
  const [rows, setRows] = useState<Segment[]>(() => (saved.length ? asSegments(saved) : canEdit ? detect() : []));
  const [mode, setMode] = useState<'saved' | 'suggested'>(saved.length ? 'saved' : 'suggested');
  const savedKey = useMemo(() => new Set(saved.map(s => `${s.fromMs}|${s.toMs}|${s.kind}|${s.label}`)), [saved]);
  const savedWin = useMemo(() => new Set(saved.map(s => `${s.fromMs}|${s.toMs}`)), [saved]);
  const dirty = mode === 'suggested' ? rows.length > 0 : rows.length !== saved.length || rows.some(r => !savedKey.has(`${r.fromMs}|${r.toMs}|${r.kind}|${r.label}`));

  const edit = (next: Segment[]) => setRows(next);
  const patch = (i: number, p: Partial<Segment>) => setRows(r => r.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const splitAtPlayhead = (i: number) => {
    const s = rows[i];
    const t = playheadRef.current;
    edit(splitSegment(rows, i, t != null && t > s.fromMs && t < s.toMs ? t : (s.fromMs + s.toMs) / 2, ctx));
  };

  const strip: StripSlice[] = rows.map((r, i) => ({ id: String(i), fromMs: r.fromMs, toMs: r.toMs, kind: r.kind, label: r.label, draft: mode === 'suggested' || !savedWin.has(`${r.fromMs}|${r.toMs}`) }));

  return (
    <div>
      <p className="mb-2 text-xs text-dim">
        {canEdit
          ? (mode === 'suggested'
            ? 'Suggested from the recording: gaps, the roster changing, and our fights switching to another guild’s. Fix what is wrong, then confirm. Nothing is kept until you do.'
            : 'The segments saved for this night. Change them and save again, or detect afresh.')
          : 'The segments an officer confirmed for this night. Open one to review it on its own.'}
      </p>
      <NightStrip fromMs={fromMs} toMs={toMs} spans={spans} fights={ctx.fights} mass={ctx.mass} slices={strip} onSeek={ms => go(ms)} groups={groups}
        drawRule={canEdit ? 'Nothing was recorded in this window to divide.' : 'No segments have been confirmed for this night.'} />

      {rows.length > 0 && (
        <ol className="mt-3 space-y-0">
          {rows.map((r, i) => {
            const st = spanStats(r, ctx);
            const next = rows[i + 1];
            const touches = !!next && next.fromMs === r.toMs;
            const clean = savedWin.has(`${r.fromMs}|${r.toMs}`) && mode === 'saved';
            const open = <Link href={windowHref(r.fromMs, r.toMs)} className={`${chip} ${chipIdle}`}>Open</Link>;
            return (
              <li key={`${r.fromMs}|${r.toMs}`}>
                <div className={`rounded-md border border-border bg-panel p-3 text-sm ${r.kind === 'downtime' ? 'opacity-80' : ''}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${KIND_DOT[r.kind]}`} />
                    <span className="text-xs text-dim">{i + 1}</span>
                    <span className="tabular-nums">{etDay.format(r.fromMs)}, {etMin.format(r.fromMs)} – {etMin.format(r.toMs)}</span>
                    <span className="text-xs text-dim">{fmtSpan(r.toMs - r.fromMs)}</span>
                    {r.why && r.why !== 'saved' && <span className="text-xs text-dim">· starts {r.why}</span>}
                  </div>
                  <p className="mt-1 text-xs text-dim">
                    {[st.kills && plural(st.kills, 'kill'), st.wipes && plural(st.wipes, 'wipe'), st.otherGuild && `${plural(st.otherGuild, 'fight')} by another guild`,
                      st.deaths && plural(st.deaths, 'death'), st.mass && plural(st.mass, 'mass-death moment')].filter(Boolean).join(' · ') || 'no named fights'}
                  </p>
                  {raidsIn(groups, r).length > 1 && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-dim">
                      <span>{raidsIn(groups, r).length} raids at once:</span>
                      {raidsIn(groups, r).map(g => (
                        <Link key={g.id} href={windowHref(r.fromMs, r.toMs, g.id, groupsParent)} className={`${chip} ${chipIdle}`}>Open {groupLabel(g)}</Link>
                      ))}
                    </p>
                  )}
                  {canEdit ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select aria-label={`Kind of segment ${i + 1}`} className={field} value={r.kind}
                        onChange={e => { if (isKind(e.target.value)) patch(i, { kind: e.target.value }); }}>
                        {SLICE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                      </select>
                      <input aria-label={`Name of segment ${i + 1}`} className={`${field} min-w-[10rem] flex-1`} value={r.label} maxLength={MAX_LABEL}
                        placeholder={KIND_LABEL[r.kind]} onChange={e => patch(i, { label: e.target.value })} />
                      <button type="button" className={`${chip} ${chipIdle}`} onClick={() => splitAtPlayhead(i)}
                        title="Cut this segment at the replay's playhead (the middle when the playhead is elsewhere)">Split at playhead</button>
                      {next && <button type="button" className={`${chip} ${chipIdle}`} onClick={() => edit(mergeSegments(rows, i, ctx))}>Merge with next</button>}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-text">{r.label || KIND_LABEL[r.kind]} <span className="text-xs text-dim">· {KIND_LABEL[r.kind]}</span></p>
                  )}
                  {clean && (
                    <div className="mt-2">
                      {canEdit && (r.kind === 'raid' || r.kind === 'event')
                        ? <ShareControls key={`${r.fromMs}|${r.toMs}`} fromIso={new Date(r.fromMs).toISOString()} toIso={new Date(r.toMs).toISOString()}
                            defaultTitle={`${r.label || KIND_LABEL[r.kind]}, ${etDay.format(r.fromMs)}`} lead={open} />
                        : open}
                    </div>
                  )}
                </div>
                {next && (
                  touches && canEdit ? (
                    <div className="flex flex-wrap items-center gap-1.5 py-1.5 pl-3 text-xs text-dim" role="group" aria-label={`Boundary between segments ${i + 1} and ${i + 2}`}>
                      <span>Boundary at {etMin.format(r.toMs)}</span>
                      {[-5, -1, 1, 5].map(m => (
                        <button key={m} type="button" onClick={() => edit(moveBoundary(rows, i, m * MINUTE_MS))} className={`${chip} ${chipIdle} tabular-nums`}
                          aria-label={`Move the boundary ${m < 0 ? 'earlier' : 'later'} by ${Math.abs(m)} ${Math.abs(m) === 1 ? 'minute' : 'minutes'}`}>{m > 0 ? `+${m}` : `−${-m}`}</button>
                      ))}
                    </div>
                  ) : (
                    <p className="py-1.5 pl-3 text-xs text-dim">{touches ? '' : `${fmtSpan(next.fromMs - r.toMs)} not in a segment`}</p>
                  )
                )}
              </li>
            );
          })}
        </ol>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={rows.length === 0 || (!dirty && mode === 'saved') || save.busy}
            onClick={() => save.run(fromMs, toMs, rows.map(r => ({ id: '', fromMs: r.fromMs, toMs: r.toMs, kind: r.kind, label: r.label })))}
            className={`${chip} ${dirty || mode === 'suggested' ? chipOn : chipIdle}`}>
            {save.busy ? 'Saving…' : mode === 'suggested' ? `Confirm ${plural(rows.length, 'segment')}` : dirty ? `Save ${plural(rows.length, 'segment')}` : 'Saved'}
          </button>
          <button type="button" className={`${chip} ${chipIdle}`} onClick={() => { setRows(detect()); setMode('suggested'); }}>Detect again</button>
          {mode === 'saved' && dirty && <button type="button" className={`${chip} ${chipIdle}`} onClick={() => setRows(asSegments(saved))}>Revert</button>}
          {save.msg && <span role="status" className={`text-xs ${save.ok ? 'text-green' : 'text-red'}`}>{save.msg}</span>}
        </div>
      )}
    </div>
  );
}
