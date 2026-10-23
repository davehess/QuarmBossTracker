'use client';
// Variant A of the night panel (?v=slices): LABELLED SPANS ON THE TIMELINE. The officer drags across the top row of the
// night strip to mark a span, then names it and says what it was (raid, event, another guild's raid, downtime). Every
// span is a window of its own: Open shows just that span, Share… makes a public link for exactly it. The time that
// is not a raid stays on the strip, set aside (dashed, grey), and out of the way of the ones that are.
// A member sees the spans an officer saved, read-only.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  KIND_LABEL, MAX_LABEL, SLICE_KINDS, fitNew, moveEdge, spanStats, type NightCtx, type Slice, type SliceKind,
} from '@/lib/nightSlices';
import { MINUTE_MS } from '@/lib/raidReplay';
import NightStrip, { type StripSlice } from './NightStrip';
import ShareControls from './ShareControls';
import { KIND_DOT, chip, chipIdle, chipOn, etDay, etMin, field, fmtSpan, newSliceId, plural, windowHref } from './nightStyle';
import type { NightSave } from './NightPanel';

export default function SlicesEditor({ fromMs, toMs, spans, ctx, saved, canEdit, save, go }: {
  fromMs: number; toMs: number; spans: { from: number; to: number }[]; ctx: NightCtx;
  saved: Slice[]; canEdit: boolean; save: NightSave; go: (ms: number | null) => void;
}) {
  const win = useMemo(() => ({ fromMs, toMs }), [fromMs, toMs]);
  const [draft, setDraft] = useState<Slice[]>(() => saved.map(s => ({ ...s })));
  const [sel, setSel] = useState<string | null>(null);
  const sorted = useMemo(() => draft.slice().sort((a, b) => a.fromMs - b.fromMs), [draft]);
  const selIdx = sorted.findIndex(s => s.id === sel);
  const selected = selIdx >= 0 ? sorted[selIdx] : null;
  const savedKey = (s: Slice) => `${s.id}|${s.fromMs}|${s.toMs}|${s.kind}|${s.label}`;
  const savedSet = useMemo(() => new Set(saved.map(savedKey)), [saved]);
  // Open / Share… need only the span's WINDOW to be saved (a rename can wait).
  const winKey = (s: Slice) => `${s.id}|${s.fromMs}|${s.toMs}`;
  const savedWin = useMemo(() => new Set(saved.map(winKey)), [saved]);
  const dirty = sorted.length !== saved.length || sorted.some(s => !savedSet.has(savedKey(s)));
  const [note, setNote] = useState<string | null>(null);

  const create = (a: number, b: number) => {
    const fit = fitNew(sorted, win, a, b);
    if (!fit) { setNote('That span starts inside one that is already marked, or is under a minute. Drag across free time.'); return; }
    setNote(null);
    const s: Slice = { id: newSliceId(), fromMs: fit.fromMs, toMs: fit.toMs, kind: 'raid', label: '' };
    setDraft(d => [...d, s]);
    setSel(s.id);
  };
  const patch = (id: string, p: Partial<Slice>) => setDraft(d => d.map(s => (s.id === id ? { ...s, ...p } : s)));
  const nudge = (edge: 'from' | 'to', min: number) => {
    if (selIdx < 0) return;
    const next = moveEdge(sorted, selIdx, edge, min * MINUTE_MS, win);
    setDraft(next);
  };
  const remove = (id: string) => { setDraft(d => d.filter(s => s.id !== id)); setSel(null); };

  const strip: StripSlice[] = sorted.map(s => ({ ...s, draft: !savedSet.has(savedKey(s)) }));
  return (
    <div>
      <p className="mb-2 text-xs text-dim">
        {canEdit
          ? 'Drag across the top row to mark a span, then say what it was. Tap a span to rename it or move its ends. Nothing is kept until you save.'
          : 'The spans an officer marked on this night. Open one to review it on its own.'}
      </p>
      <NightStrip fromMs={fromMs} toMs={toMs} spans={spans} fights={ctx.fights} mass={ctx.mass} slices={strip}
        selectedId={sel} onSelect={id => setSel(s => (s === id ? null : id))} onCreate={canEdit ? create : undefined}
        onSeek={ms => go(ms)} drawRule={canEdit ? 'Drag here to mark a span.' : 'Nothing has been marked on this night.'} />
      {note && <p role="status" className="mt-2 text-xs text-gold">{note}</p>}

      {canEdit && selected && (
        <div className="mt-3 rounded-md border border-border bg-panel p-3 text-sm" role="group" aria-label="Edit the selected span">
          <div className="flex flex-wrap items-center gap-1.5">
            {SLICE_KINDS.map(k => (
              <button key={k} type="button" aria-pressed={selected.kind === k} onClick={() => patch(selected.id, { kind: k as SliceKind })}
                className={`${chip} ${selected.kind === k ? chipOn : chipIdle}`}>{KIND_LABEL[k]}</button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-dim" htmlFor={`label-${selected.id}`}>Name</label>
            <input id={`label-${selected.id}`} className={`${field} min-w-[12rem] flex-1`} value={selected.label} maxLength={MAX_LABEL}
              placeholder={KIND_LABEL[selected.kind]} onChange={e => patch(selected.id, { label: e.target.value })} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-dim">Start {etMin.format(selected.fromMs)}</span>
            {[-5, -1, 1, 5].map(m => (
              <button key={`f${m}`} type="button" onClick={() => nudge('from', m)} className={`${chip} ${chipIdle} tabular-nums`}
                aria-label={`Start ${m < 0 ? 'earlier' : 'later'} by ${Math.abs(m)} ${Math.abs(m) === 1 ? 'minute' : 'minutes'}`}>{m > 0 ? `+${m}` : `−${-m}`}</button>
            ))}
            <span className="ml-3 text-xs text-dim">End {etMin.format(selected.toMs)}</span>
            {[-5, -1, 1, 5].map(m => (
              <button key={`t${m}`} type="button" onClick={() => nudge('to', m)} className={`${chip} ${chipIdle} tabular-nums`}
                aria-label={`End ${m < 0 ? 'earlier' : 'later'} by ${Math.abs(m)} ${Math.abs(m) === 1 ? 'minute' : 'minutes'}`}>{m > 0 ? `+${m}` : `−${-m}`}</button>
            ))}
            <button type="button" onClick={() => remove(selected.id)} className={`${chip} ${chipIdle} ml-auto text-red`}>Delete span</button>
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {sorted.map(s => {
            const st = spanStats(s, ctx);
            const clean = savedWin.has(winKey(s));
            const open = <Link href={windowHref(s.fromMs, s.toMs, 'slices')} className={`${chip} ${chipIdle}`}>Open</Link>;
            return (
              <li key={s.id} className={`rounded-md border bg-panel px-3 py-2 text-sm ${sel === s.id ? 'border-accent' : 'border-border'} ${s.kind === 'downtime' ? 'opacity-75' : ''}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${KIND_DOT[s.kind]}`} />
                  <button type="button" onClick={() => setSel(v => (v === s.id ? null : s.id))} className="text-left text-text hover:underline">
                    {s.label || KIND_LABEL[s.kind]}
                  </button>
                  <span className="text-xs text-dim">{KIND_LABEL[s.kind]}</span>
                  <span className="text-xs tabular-nums">{etDay.format(s.fromMs)}, {etMin.format(s.fromMs)} – {etMin.format(s.toMs)} <span className="text-dim">· {fmtSpan(s.toMs - s.fromMs)}</span></span>
                  <span className="text-xs text-dim">
                    {[st.kills && plural(st.kills, 'kill'), st.wipes && plural(st.wipes, 'wipe'), st.otherGuild && `${plural(st.otherGuild, 'fight')} by another guild`, st.deaths && plural(st.deaths, 'death')].filter(Boolean).join(' · ') || 'no named fights'}
                  </span>
                </div>
                <div className="mt-1.5">
                  {!clean
                    ? <span className="text-xs text-dim">Save to open or share this span.</span>
                    : canEdit && (s.kind === 'raid' || s.kind === 'event')
                      ? <ShareControls key={`${s.fromMs}|${s.toMs}`} fromIso={new Date(s.fromMs).toISOString()} toIso={new Date(s.toMs).toISOString()}
                          defaultTitle={`${s.label || KIND_LABEL[s.kind]}, ${etDay.format(s.fromMs)}`} lead={open} />
                      : open}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={!dirty || save.busy} onClick={() => save.run(fromMs, toMs, sorted)} className={`${chip} ${dirty ? chipOn : chipIdle}`}>
            {save.busy ? 'Saving…' : dirty ? `Save ${plural(sorted.length, 'span')}` : 'Saved'}
          </button>
          {dirty && <button type="button" onClick={() => { setDraft(saved.map(s => ({ ...s }))); setSel(null); }} className={`${chip} ${chipIdle}`}>Revert</button>}
          {save.msg && <span role="status" className={`text-xs ${save.ok ? 'text-green' : 'text-red'}`}>{save.msg}</span>}
        </div>
      )}
    </div>
  );
}
