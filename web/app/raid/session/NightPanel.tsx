'use client';
// The night panel of the members' session review: slicing a night into what it was, with the night's named fights and
// mass deaths beside it. An officer says which part was the raid proper by confirming a list of segments the page
// detected (SegmentsEditor; the guild lead picked this over drawing spans by hand, 2026-10-23). What is confirmed is
// saved through lib/nightSlices.ts and PUT /api/raid/slices.
import { useCallback, useMemo, useState, type MutableRefObject } from 'react';
import { useRouter } from 'next/navigation';
import type { Span } from '@/lib/raidReplay';
import type { FightMark, MassDeath, NightCtx, Slice, SliceKind } from '@/lib/nightSlices';
import NightFights from './NightFights';
import SegmentsEditor from './SegmentsEditor';

export type NightPanelData = {
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
  return (
    <section className="mt-5" aria-label="The night, sliced">
      <h2 className="mb-2 text-lg text-gold">The night, sliced</h2>
      <div className="rounded-md border border-border bg-panel p-3">
        <SegmentsEditor key={sig} fromMs={data.fromMs} toMs={data.toMs} spans={data.spans} breaks={data.breaks} ctx={ctx} saved={inside}
          canEdit={data.canEdit} save={save} go={go} playheadRef={playheadRef} />
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
