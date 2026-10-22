'use client';

// The Versions tab: the saved copies of this plan, newest first. View puts a copy on the map read-only (the map says so and
// offers the way back); Restore (officers) makes it the plan everybody sees, after keeping what it replaces as a version.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VersionRow } from '@/lib/routePlanner/store';
import type { Plan } from '@/lib/routePlanner/types';
import { getRouteVersion, listRouteVersions, restoreRouteVersion, type RestoreResult } from './actions';

const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function VersionsPanel(props: {
  zone: string; planId: string; officer: boolean; tick: number; previewing: boolean;
  onView: (plan: Plan, text: string) => void;
  onRestored: (r: Extract<RestoreResult, { ok: true }>) => void;
  onError: (m: string) => void;
}) {
  const { zone, planId, officer, tick, onView, onRestored, onError } = props;
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [arm, setArm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errRef = useRef(onError);        // the parent's handler changes every render; the list must not reload because of it
  errRef.current = onError;

  const load = useCallback(async () => {
    const r = await listRouteVersions(zone, planId);
    if (r.ok) setRows(r.versions); else errRef.current(r.error);
  }, [zone, planId]);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { if (!props.previewing) setViewing(null); }, [props.previewing]);

  const view = async (v: VersionRow) => {
    setBusy(true);
    const r = await getRouteVersion(zone, planId, v.saved_at);
    setBusy(false);
    if (!r.ok) return onError(r.error);
    setViewing(v.saved_at);
    onView(r.plan, `Viewing the version saved ${when(v.saved_at)}${v.label ? ' (' + v.label + ')' : ''}. Read only.`);
  };
  const restore = async (v: VersionRow) => {
    setBusy(true);
    const r = await restoreRouteVersion(zone, planId, v.saved_at);
    setBusy(false); setArm(null);
    if (!r.ok) return onError(r.error);
    setRows(r.versions);
    onRestored(r);
  };

  if (rows === null) return <div className="card muted small">Loading the saved versions...</div>;
  if (!rows.length) {
    return (
      <div className="card muted small">
        No saved versions yet. {officer ? <>Press <b>Save version</b> to keep a copy, and one is kept by itself every ten minutes you edit.</> : 'An officer keeps them as the plan is worked on.'}
      </div>
    );
  }
  return (
    <div>
      <div className="small muted" style={{ marginBottom: 4 }}>
        {rows.length} saved (the newest 30 are kept). Viewing one does not change the plan.
      </div>
      {rows.map(v => (
        <div key={v.saved_at} className={'ver' + (viewing === v.saved_at ? ' on' : '')}>
          <span className="nm">
            <b>{when(v.saved_at)}</b>
            <div className="small muted">
              {v.label ? <>{v.label} &middot; </> : null}{v.pins} pin{v.pins === 1 ? '' : 's'}
              {v.optional ? `, ${v.optional} optional` : ''}{v.splits ? `, ${v.splits} split${v.splits === 1 ? '' : 's'}` : ''}
            </div>
          </span>
          <button type="button" className="sm" disabled={busy} onClick={() => view(v)}>View</button>
          {officer && (arm === v.saved_at
            ? <button type="button" className="sm danger" disabled={busy} onClick={() => restore(v)}>Really restore</button>
            : <button type="button" className="sm" disabled={busy} onClick={() => setArm(v.saved_at)}>Restore</button>)}
        </div>
      ))}
    </div>
  );
}
