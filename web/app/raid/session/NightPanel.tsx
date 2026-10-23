'use client';
// The night panel of the members' session review: slicing a night into what it was, with the night's named fights and
// mass deaths beside it. Behind ?v=slices and ?v=segments (two ways to do the same slicing, picked by the guild lead);
// without either the page is as it was. The fights and deaths (NightFights) are the same in both. What differs is how an
// officer says which part was the raid proper:
//   slices    draw labelled spans on the night's timeline (SlicesEditor)
//   segments  confirm a list of segments the page detected (SegmentsEditor)
// Both write the same thing (lib/nightSlices.ts, PUT /api/raid/slices), so what one saves the other shows.
import { useCallback, useMemo, useState, type MutableRefObject } from 'react';
import { useRouter } from 'next/navigation';
import type { Span } from '@/lib/raidReplay';
import type { FightMark, MassDeath, NightCtx, Slice, SliceKind } from '@/lib/nightSlices';
import NightFights from './NightFights';
import SlicesEditor from './SlicesEditor';
import SegmentsEditor from './SegmentsEditor';

export type NightPanelData = {
  variant: 'slices' | 'segments';
  fromMs: number; toMs: number;
  spans: Span[];
  fights: FightMark[]; deaths: number[]; mass: MassDeath[];
  /** Saved slices that overlap the window. */
  slices: Slice[];
  /** Roster turnover instants, for the segments' guess. */
  breaks: number[];
  /** An officer. */
  canEdit: boolean;
};

export type NightSave = {
  busy: boolean; msg: string | null; ok: boolean;
  run: (fromMs: number, toMs: number, slices: { id?: string; fromMs: number; toMs: number; kind: SliceKind; label: string }[]) => void;
};

function useSave(): NightSave {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: true });
  const run = useCallback<NightSave['run']>((fromMs, toMs, slices) => {
    setState({ busy: true, msg: null, ok: true });
    fetch('/api/raid/slices', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), slices }),
    })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'could not save');
        setState({ busy: false, msg: 'Saved.', ok: true });
        router.refresh();
      })
      .catch((e: unknown) => setState({ busy: false, msg: e instanceof Error ? e.message : 'could not save', ok: false }));
  }, [router]);
  return { ...state, run };
}

export default function NightPanel({ data, go, playheadRef }: {
  data: NightPanelData; go: (ms: number | null) => void; playheadRef: MutableRefObject<number | null>;
}) {
  const save = useSave();
  const ctx = useMemo<NightCtx>(() => ({ fights: data.fights, deaths: data.deaths, mass: data.mass }), [data.fights, data.deaths, data.mass]);
  // Only the spans that lie inside this window can be changed from it (the server refuses to touch one that crosses an edge).
  const inside = useMemo(() => data.slices.filter(s => s.fromMs >= data.fromMs && s.toMs <= data.toMs), [data.slices, data.fromMs, data.toMs]);
  const sig = useMemo(() => inside.map(s => `${s.id}.${s.fromMs}.${s.toMs}.${s.kind}.${s.label}`).join('~'), [inside]);
  const crossing = data.slices.length - inside.length;
  const label = data.variant === 'slices' ? 'Slices' : 'Segments';
  return (
    <section className="mt-5" aria-label="The night, sliced">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg text-gold">The night, sliced</h2>
        <span className="rounded border border-border px-1.5 py-0.5 text-[11px] uppercase tracking-wider text-dim">preview · {label}</span>
      </div>
      <div className="rounded-md border border-border bg-panel p-3">
        {data.variant === 'slices'
          ? <SlicesEditor key={sig} fromMs={data.fromMs} toMs={data.toMs} spans={data.spans} ctx={ctx} saved={inside} canEdit={data.canEdit} save={save} go={go} />
          : <SegmentsEditor key={sig} fromMs={data.fromMs} toMs={data.toMs} spans={data.spans} breaks={data.breaks} ctx={ctx} saved={inside}
              canEdit={data.canEdit} save={save} go={go} playheadRef={playheadRef} />}
        {crossing > 0 && (
          <p className="mt-2 text-xs text-gold">
            {crossing === 1 ? 'One saved span reaches' : `${crossing} saved spans reach`} past this window&apos;s edge and cannot be changed from here. Open its own window to change it.
          </p>
        )}
      </div>
      <h3 className="mb-1.5 mt-4 text-xs uppercase tracking-wider text-dim">Named fights and mass deaths</h3>
      <NightFights ctx={ctx} fromMs={data.fromMs} toMs={data.toMs} go={go} />
    </section>
  );
}
