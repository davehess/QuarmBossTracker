'use client';

// The route planner page's client half: the plan bar (which plan, planned raiders against the target), the map engine
// (engine.ts, the ported single-file planner) and the three things that sit beside it: the host bar (save a version, send
// to the in-game map, import), the Versions tab and the Compare tab (both portalled into the engine's side panel).
//
// SAVING. The engine calls onChange on every edit; the plan is saved ~1 s later through the server action (which re-checks
// the officer gate). Every 10 s, while the page is visible and nothing is waiting to save, a cheap poll asks whether the
// zone's row moved on; a newer plan from another officer is adopted (newest wins, as the artifact was). A viewer who is not
// an officer never saves, only polls.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { FewestKill } from '@/lib/routePlanner/fewest';
import { fewestByNpc } from '@/lib/routePlanner/fewest';
import type { ChecklistStep } from '@/lib/routePlanner/build';
import { plannedHeadcount } from '@/lib/routePlanner/plan';
import type { PlanSummary } from '@/lib/routePlanner/store';
import type { Mob, Plan, ZoneData } from '@/lib/routePlanner/types';
import type { Routed } from '@/lib/routePlanner/navroute';
import { sanitize } from '@/lib/routePlanner/plan';
import {
  createRoutePlan, deleteRoutePlan, importSeedPlan, pollRoutePlan, publishRoutePlan, saveRoutePlan, updateRoutePlanMeta,
  type PlanDocOut,
} from './actions';
import { mountPlanner } from './engine';
import VersionsPanel from './VersionsPanel';
import ComparePanel from './ComparePanel';
import './planner.css';

type Api = ReturnType<typeof mountPlanner>;

// The 3D previews (?v=b stacked floors, ?v=c true 3D) are loaded only when the 3D button is pressed, so the 2D page
// never downloads three.js.
const Plan3D = dynamic(() => import('./Plan3D'), { ssr: false, loading: () => <div className="p3-note">Loading the 3D view…</div> });

export type RoutePlannerProps = {
  zone: ZoneData;
  planId: string;
  plans: PlanSummary[];
  doc: PlanDocOut | null;
  rowStamp: string | null;
  officer: boolean;
  extraMobs: Mob[];
  onPlanNpcs: number[];
  checklist: ChecklistStep[];
  cardNote: string;
  seed: { label: string; pins: number } | null;
  fewest: FewestKill[];
  /** The preview asked for with ?v= ('b' stacked floors, 'c' true 3D, 'leg' the One leg mode alone); null on the page everyone sees. */
  variant?: 'b' | 'c' | 'leg' | null;
};

const SAVE_DELAY_MS = 1000;
const POLL_MS = 10_000;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function RoutePlanner(props: RoutePlannerProps) {
  const { zone, planId, officer } = props;
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const [nodes, setNodes] = useState<Api['nodes'] | null>(null);
  const [plans, setPlans] = useState(props.plans);
  const [meta, setMeta] = useState({ name: props.doc?.name ?? 'Main night', target: props.doc?.target_headcount ?? null });
  const [livePlan, setLivePlan] = useState<Plan | null>(props.doc?.current ?? null);
  const [hasSaved, setHasSaved] = useState(!!props.doc);
  const [versionsTick, setVersionsTick] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [skipOptional, setSkipOptional] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [view3d, setView3d] = useState(false);
  const [legKey, setLegKey] = useState<string | null>(null);   // the leg the One leg mode is on (null when the mode is off)
  const [routes, setRoutes] = useState<Map<string, Routed>>(() => new Map());   // the walk routes by leg, for the 3D view
  const v3 = props.variant === 'b' || props.variant === 'c' ? props.variant : null;   // the 3D previews; 'leg' has no 3D
  const [confirm, setConfirm] = useState<null | { kind: 'publish'; text: string } | { kind: 'import'; text: string }>(null);

  // saving + polling state: refs, because the engine's callbacks outlive any one render
  const st = useRef({ docStamp: props.doc?.updated_at ?? null as string | null, rowStamp: props.rowStamp, dirty: false, saving: false, again: false, timer: 0 as unknown as ReturnType<typeof setTimeout>, retry: 0 as unknown as ReturnType<typeof setTimeout>, raf: 0 });

  const setStatus = (cls: string, text: string) => apiRef.current?.setStatus(cls, text);
  const note = (m: string) => { setMsg(m); apiRef.current?.toast(m); };

  const flush = useCallback(async (version = false) => {
    const s = st.current, api = apiRef.current;
    if (!api || !officer) return null;
    clearTimeout(s.timer); clearTimeout(s.retry);
    if (s.saving) { s.again = true; return null; }
    s.saving = true;
    const snap = JSON.parse(JSON.stringify(api.getPlan())) as Plan;
    let out: Awaited<ReturnType<typeof saveRoutePlan>> | null = null;
    try {
      out = await saveRoutePlan(zone.zone, planId, snap, { version });
    } catch {
      out = { ok: false, error: 'offline' };
    }
    s.saving = false;
    if (out.ok) {
      s.docStamp = out.updated_at; s.rowStamp = out.updated_at; setHasSaved(true);
      if (out.versioned === 'manual' || out.versioned === 'auto') setVersionsTick(t => t + 1);
      const moved = api.getPlan().updatedAt !== snap.updatedAt;
      if (moved || s.again) { s.again = false; s.timer = setTimeout(() => flush(false), SAVE_DELAY_MS); setStatus('busy', 'Saving…'); }
      else { s.dirty = false; setStatus('ok', 'Saved · ' + timeOf(out.updated_at)); apiRef.current?.setEdited('Saved ' + timeOf(out.updated_at) + '.'); }
    } else {
      setStatus('err', 'Not saved');
      s.retry = setTimeout(() => flush(false), 5000);
    }
    return out;
  }, [officer, zone.zone, planId]);

  // mount the engine
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const s = st.current;
    const api = mountPlanner(root, {
      zone,
      extraMobs: props.extraMobs,
      onPlanNpcs: props.onPlanNpcs,
      checklist: props.checklist,
      cardNote: props.cardNote,
      fewest: fewestByNpc(props.fewest),
      readOnly: !officer,
      initialPlan: props.doc?.current ?? null,
      onChange: (plan: Plan) => {
        if (!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; setLivePlan(JSON.parse(JSON.stringify(plan))); });
        if (!officer) return;
        s.dirty = true;
        setStatus('busy', 'Saving…');
        clearTimeout(s.timer);
        s.timer = setTimeout(() => flush(false), SAVE_DELAY_MS);
      },
      onPreview: (on: boolean) => setPreviewing(on),
      onOptMode: (m: string) => setSkipOptional(m === 'skip'),
      legFocus: !!props.variant,
      onLegFocus: (k: string | null) => setLegKey(k),
      // "Walk route" (any ?v=): the navigation library and the zone's walkable map are fetched when it is first turned on
      navRoute: props.variant ? { load: () => import('@/lib/routePlanner/navLoad').then(m => m.loadNavRouter(zone)) } : undefined,
      onRoutes: (m: Map<string, Routed>) => setRoutes(m),
    });
    apiRef.current = api;
    setNodes(api.nodes);
    setStatus(officer ? 'ok' : 'local', officer ? (props.doc ? 'Saved' : 'Nothing saved yet') : 'Read only · live');
    if (props.doc) api.setEdited('Last saved ' + timeOf(props.doc.updated_at) + '.');
    setSkipOptional(api.getSkipOptional());
    const onHide = () => { if (document.visibilityState === 'hidden' && s.dirty && officer) flush(false); };
    document.addEventListener('visibilitychange', onHide);
    const warn = (e: BeforeUnloadEvent) => { if (s.dirty && officer) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', warn);
      clearTimeout(s.timer); clearTimeout(s.retry); cancelAnimationFrame(s.raf); s.raf = 0;
      api.destroy();
      apiRef.current = null;
      setNodes(null);
    };
    // the page remounts this component (a new key) when the zone or the plan changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the poll: another officer's plan, a renamed plan, a new one
  useEffect(() => {
    const s = st.current;
    const tick = async () => {
      if (document.visibilityState !== 'visible' || s.dirty || s.saving || !apiRef.current) return;
      let r;
      try { r = await pollRoutePlan(zone.zone, planId, s.rowStamp); } catch { return; }
      if (!r.ok || !r.changed || s.dirty || s.saving) return;
      s.rowStamp = r.row_stamp;
      setPlans(r.plans);
      if (!r.doc) { note('This plan was deleted.'); return; }
      setMeta({ name: r.doc.name, target: r.doc.target_headcount });
      if (r.doc.updated_at !== s.docStamp) {
        s.docStamp = r.doc.updated_at;
        apiRef.current?.setPlan(r.doc.current);
        setLivePlan(r.doc.current); setHasSaved(true);
        apiRef.current?.setEdited('Updated by another officer at ' + timeOf(r.doc.updated_at) + '.');
        setVersionsTick(t => t + 1);
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone.zone, planId]);

  const planned = useMemo(() => (livePlan ? plannedHeadcount(livePlan) : null), [livePlan]);

  // ── host bar actions ───────────────────────────────────────────────────────
  const saveVersion = async () => {
    const out = await flush(true);
    if (!out) return;
    if (!out.ok) return note(out.error);
    note(out.versioned === 'same' ? 'That is already the newest saved version.' : 'Version saved.');
    setVersionsTick(t => t + 1);
  };
  const publish = async (overwrite = false) => {
    if (st.current.dirty) await flush(false);
    const r = await publishRoutePlan(zone.zone, planId, { skipOptional, overwrite });
    if (r.ok) { setConfirm(null); return note(`Sent to the in-game map: ${r.stops} stops, ${r.points} points.`); }
    if ('confirm' in r) {
      const when = r.confirm.saved_at ? new Date(r.confirm.saved_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'earlier';
      return setConfirm({ kind: 'publish', text: `The in-game map already has a route for this zone (saved ${when}${r.confirm.stops != null ? ', ' + r.confirm.stops + ' stops' : ''}). Replace it with this plan?` });
    }
    setConfirm(null); note(r.error);
  };
  const importSeed = async (overwrite = false) => {
    const r = await importSeedPlan(zone.zone, { overwrite });
    if (r.ok) {
      st.current.docStamp = r.updated_at; st.current.rowStamp = r.updated_at; st.current.dirty = false; setHasSaved(true);
      apiRef.current?.setPlan(r.current); setLivePlan(r.current); setVersionsTick(t => t + 1); setConfirm(null);
      setStatus('ok', 'Saved · ' + timeOf(r.updated_at));
      return note('Imported. It is also the first saved version.');
    }
    if ('confirm' in r) return setConfirm({ kind: 'import', text: `The main-night plan already has ${r.pins} pins. Replace it with the imported one? (What is there now is kept as a version.)` });
    setConfirm(null); note(r.error);
  };

  // ── plan bar actions ───────────────────────────────────────────────────────
  const [newName, setNewName] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [adding, setAdding] = useState(false);
  const [nameDraft, setNameDraft] = useState(meta.name);
  const [targetDraft, setTargetDraft] = useState(meta.target == null ? '' : String(meta.target));
  const [delArm, setDelArm] = useState(false);
  useEffect(() => { setNameDraft(meta.name); setTargetDraft(meta.target == null ? '' : String(meta.target)); }, [meta.name, meta.target]);

  const href = (id: string) => `/raid/plan/routes?zone=${zone.zone}${id === 'main' ? '' : '&plan=' + id}${props.variant ? '&v=' + props.variant : ''}`;
  const addPlan = async () => {
    if (st.current.dirty) await flush(false);
    const r = await createRoutePlan(zone.zone, newName || 'Off-night plan', copyFrom || null);
    if (!r.ok) return note(r.error);
    router.push(href(r.id));
  };
  const saveMeta = async (patch: { name?: string; target_headcount?: number | null }) => {
    const r = await updateRoutePlanMeta(zone.zone, planId, patch);
    if (!r.ok) return note(r.error);
    st.current.rowStamp = r.row_stamp; setPlans(r.plans);
    const me = r.plans.find(p => p.id === planId);
    if (me) setMeta({ name: me.name, target: me.target_headcount ?? null });
  };
  const removePlan = async () => {
    const r = await deleteRoutePlan(zone.zone, planId);
    if (!r.ok) return note(r.error);
    router.push(href('main'));
  };

  // what the 3D view draws is what the map shows: while a saved version is on the map, that version
  const shown3d = useMemo(() => sanitize(previewing && apiRef.current ? apiRef.current.getPlan() : livePlan), [livePlan, previewing]);

  const isOff = planId !== 'main';
  const target = meta.target;
  const peak = planned?.peak ?? null;

  return (
    <div className="space-y-2">
      {/* the plans of this zone */}
      <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Plans for this zone">
        {plans.map(p => (
          <Link key={p.id} href={href(p.id)} scroll={false}
            className={`rounded-md border px-2 py-1 ${p.id === planId ? 'border-gold bg-gold/10 text-gold' : 'border-border text-dim hover:text-text'}`}>
            {p.night_type === 'off' ? 'Off night: ' : ''}{p.name}
            {p.target_headcount !== undefined && <span className="ml-1 text-dim">({p.planned ?? '?'}/{p.target_headcount})</span>}
          </Link>
        ))}
        {officer && !adding && <button type="button" onClick={() => setAdding(true)} className="rounded-md border border-dashed border-border px-2 py-1 text-dim hover:text-text">+ off-night plan</button>}
      </div>

      {officer && adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-panel p-2 text-xs">
          <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={60} placeholder="Tallon only" aria-label="Name of the new plan"
            className="min-w-[10rem] flex-1 rounded border border-border bg-bg px-2 py-1 text-text" />
          <label className="flex items-center gap-1 text-dim">start from
            <select value={copyFrom} onChange={e => setCopyFrom(e.target.value)} className="rounded border border-border bg-bg px-1 py-1 text-text">
              <option value="">a blank plan</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={addPlan} className="rounded border border-gold/60 px-2 py-1 text-gold hover:bg-bg">Create</button>
          <button type="button" onClick={() => setAdding(false)} className="rounded border border-border px-2 py-1 text-dim hover:text-text">Cancel</button>
        </div>
      )}

      {/* this plan: its name, target and how many raiders it needs */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-dim">{isOff ? 'Off-night plan: how few raiders can do it.' : 'Main-night plan.'}</span>
        {planned && (
          <span className={`rounded border px-2 py-0.5 ${target != null && peak != null ? (peak <= target ? 'border-green/50 text-green' : 'border-red/50 text-red') : 'border-border text-dim'}`}
            title={planned.splits.length ? planned.splits.map(s => `split: ${s.sum ?? '?'}`).join(', ') : undefined}>
            {peak != null ? `Planned: ${peak} raider${peak === 1 ? '' : 's'}` : 'Planned: set the raiders on the route (and on each branch of a split)'}
            {target != null && peak != null && ` · target ${target} · ${peak <= target ? (target - peak === 0 ? 'on target' : `${target - peak} under`) : `${peak - target} over`}`}
            {target != null && peak == null && ` · target ${target}`}
          </span>
        )}
        {officer && isOff && (
          <>
            <label className="flex items-center gap-1 text-dim">name
              <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} onBlur={() => nameDraft.trim() && nameDraft.trim() !== meta.name && saveMeta({ name: nameDraft })}
                maxLength={60} className="w-48 rounded border border-border bg-bg px-2 py-0.5 text-text" />
            </label>
            <label className="flex items-center gap-1 text-dim">target raiders
              <input type="number" min={1} max={200} value={targetDraft} onChange={e => setTargetDraft(e.target.value)}
                onBlur={() => { const v = targetDraft.trim(); const n = v === '' ? null : Number(v); if (n !== meta.target && (n === null || (Number.isInteger(n) && n >= 1))) saveMeta({ target_headcount: n }); }}
                className="w-16 rounded border border-border bg-bg px-2 py-0.5 text-text" />
            </label>
            {!delArm
              ? <button type="button" onClick={() => setDelArm(true)} className="text-red/70 underline decoration-dotted hover:text-red">delete this plan</button>
              : <button type="button" onClick={removePlan} className="rounded border border-red/60 px-2 py-0.5 text-red hover:bg-bg">Really delete it and its versions</button>}
          </>
        )}
        {!officer && target != null && <span className="text-dim">target {target} raiders</span>}
      </div>

      <div ref={rootRef} className={view3d ? 'rp-root rp-3d' : 'rp-root'} />

      {msg && <p className="text-xs text-dim" role="status">{msg}</p>}

      {nodes && createPortal(
        <>
          {officer && (
            <>
              <button type="button" className="sm" onClick={saveVersion} disabled={previewing} title="Keep a copy of the plan as it is now">Save version</button>
              <button type="button" className="sm" onClick={() => publish(false)} disabled={previewing} title="Write this plan where Mimic's map reads its route">Send to in-game map</button>
              {props.seed && !isOff && (!hasSaved || (livePlan && livePlan.pins.length === 0)) && (
                <button type="button" className="sm primary" onClick={() => importSeed(false)} title={props.seed.label}>Import tonight&apos;s planner ({props.seed.pins} pins)</button>
              )}
              {confirm && (
                <div className="card confirm" style={{ width: '100%' }}>
                  <div>{confirm.text}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <button type="button" className="danger" onClick={() => (confirm.kind === 'publish' ? publish(true) : importSeed(true))}>Replace it</button>
                    <button type="button" onClick={() => setConfirm(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </>
          )}
        </>,
        nodes.hostBar,
      )}
      {nodes && v3 && createPortal(
        <div className="grp grp-3d">
          <button type="button" className={view3d ? 'active' : ''} aria-pressed={view3d} onClick={() => setView3d(v => !v)}
            title={view3d ? 'Back to the flat map, where you edit' : (v3 === 'b' ? 'See the floors stacked, with the route climbing between them' : 'See the zone in 3D, with the route at its real heights')}>
            {view3d ? '2D map' : '3D'}
          </button>
        </div>,
        nodes.toolbar,
      )}
      {nodes && v3 && view3d && createPortal(
        <Plan3D zone={zone} extraMobs={props.extraMobs} plan={shown3d} skipOptional={skipOptional} variant={v3} focusLeg={legKey} routes={routes}
          onSelect={id => apiRef.current?.selectPin(id)}
          onFail={() => { setView3d(false); note('This browser could not start 3D, so the flat map stays.'); }} />,
        nodes.mapwrap,
      )}
      {nodes && createPortal(
        <VersionsPanel zone={zone.zone} planId={planId} officer={officer} tick={versionsTick} previewing={previewing}
          onView={(plan, text) => apiRef.current?.previewPlan(plan, text)}
          onRestored={(r) => {
            const s = st.current;
            s.docStamp = r.updated_at; s.rowStamp = r.updated_at; s.dirty = false;
            apiRef.current?.exitPreview(); apiRef.current?.setPlan(r.current); setLivePlan(r.current);
            apiRef.current?.setStatus('ok', 'Saved · ' + timeOf(r.updated_at)); note('Version restored. What it replaced is kept as a version.');
          }}
          onError={note} />,
        nodes.versionsPane,
      )}
      {nodes && createPortal(
        <ComparePanel zone={zone} plan={livePlan} skipOptional={skipOptional} fewest={props.fewest}
          onOverlay={o => apiRef.current?.setActual(o)} />,
        nodes.comparePane,
      )}
    </div>
  );
}
