'use client';

// The Compare tab: pick a recorded night (the same nights /raid/routes lists for the zone) and lay what that night actually
// did over the plan. The map gets the night's centre path and its named kills in the order they died; this panel gets the
// table: planned order against actual order, planned drawn length against the actual path, the time of each leg, which
// planned kills the night never made and which kills the plan never had.
//
// The night comes from GET /api/raid/routes (member-gated, the one /raid/routes uses): ?zones=1 lists the visits, and
// ?zone=<z>&nights=<visit key> answers for ONE night, whose route is exactly that night's kills and walk.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ZoneAnswer, ZoneListing, VisitInfo } from '@/lib/raidRoutesLoad';
import { comparePlan, type Actual, type Comparison } from '@/lib/routePlanner/compare';
import { fewestByNpc, fewestLine, type FewestKill } from '@/lib/routePlanner/fewest';
import { allPins } from '@/lib/routePlanner/plan';
import type { Plan, ZoneData } from '@/lib/routePlanner/types';

/** The night laid over the plan: its centre path and its named kills in the order they died (the 2D map draws it in white, and so does the 3D view). */
export type CompareNight = { label: string; path: [number, number][]; stops: { n: number; name: string; x: number; y: number }[] };
type Overlay = CompareNight | null;

const fmtU = (n: number) => Math.round(n).toLocaleString('en-US') + ' u';
const fmtT = (s: number) => (s < 90 ? Math.round(s) + ' s' : Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's');
const day = (v: VisitInfo) => `${v.night_key} · ${v.minutes} min · ${v.peak} raiders`;

export default function ComparePanel(props: {
  zone: ZoneData; plan: Plan | null; skipOptional: boolean; fewest: FewestKill[];
  onOverlay: (o: Overlay) => void;
}) {
  const { zone, plan, skipOptional } = props;
  const [visits, setVisits] = useState<VisitInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [actual, setActual] = useState<Actual | null>(null);
  const [loading, setLoading] = useState(false);
  const overlayRef = useRef(props.onOverlay);
  overlayRef.current = props.onOverlay;

  // the nights of this zone
  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/raid/routes?zones=1', { signal: ac.signal })
      .then(async res => {
        if (!res.ok) return setErr('The recorded nights could not be loaded.');
        const list = ((await res.json()) as { zones: ZoneListing[] }).zones;
        setVisits(list.find(z => z.zone === zone.zone)?.visits ?? []);
      })
      .catch(() => { if (!ac.signal.aborted) setErr('The recorded nights could not be loaded.'); });
    return () => ac.abort();
  }, [zone.zone]);

  // the chosen night
  useEffect(() => {
    if (!pick || !visits) { setActual(null); overlayRef.current(null); return; }
    const v = visits.find(x => x.key === pick);
    const ac = new AbortController();
    setLoading(true); setErr(null);
    fetch(`/api/raid/routes?zone=${encodeURIComponent(zone.zone)}&nights=${encodeURIComponent(pick)}`, { signal: ac.signal })
      .then(async res => {
        if (!res.ok) return setErr('That night could not be loaded.');
        const a = (await res.json()) as ZoneAnswer;
        const stops = a.route.stops;
        const act: Actual = {
          label: v ? v.night_key : pick,
          stops,
          legs: a.route.legs.map(l => ({ from: l.from, to: l.to, medianS: l.medianS, pts: l.pts })),
          path: a.nights.find(n => n.key === pick)?.path ?? [],
        };
        setActual(act);
        overlayRef.current({
          label: act.label,
          path: act.path,
          stops: stops.flatMap(s => (s.x != null && s.y != null ? [{ n: s.n, name: s.name, x: s.x, y: s.y }] : [])),
        });
      })
      .catch(() => { if (!ac.signal.aborted) setErr('That night could not be loaded.'); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [pick, visits, zone.zone]);

  // the overlay comes off the map when the tab goes away
  useEffect(() => () => overlayRef.current(null), []);

  const cmp: Comparison | null = useMemo(() => (plan && actual ? comparePlan(plan, skipOptional, actual, zone.links) : null), [plan, actual, skipOptional, zone.links]);
  const fewest = useMemo(() => fewestByNpc(props.fewest), [props.fewest]);
  const npcOf = useMemo(() => new Map((plan ? allPins(plan) : []).map(p => [p.label, p.npc] as const)), [plan]);

  if (err && !visits) return <div className="card muted small">{err}</div>;
  if (!visits) return <div className="card muted small">Loading the recorded nights...</div>;
  if (!visits.length) {
    return <div className="card muted small">No raid night is recorded in {zone.name} yet, so there is nothing to compare the plan to. Once one is, it is listed here.</div>;
  }

  return (
    <div className="cmp">
      <div className="small muted" style={{ marginBottom: 6 }}>
        Lay a recorded night over the plan: its path and its kills, in the order they died, appear on the map in white.
      </div>
      <select value={pick} onChange={e => setPick(e.target.value)} aria-label="Recorded night" style={{ width: '100%' }}>
        <option value="">Pick a night to compare...</option>
        {visits.map(v => <option key={v.key} value={v.key}>{day(v)}</option>)}
      </select>
      {loading && <div className="small muted" style={{ marginTop: 6 }}>Loading that night...</div>}
      {err && visits && <div className="small" style={{ marginTop: 6, color: 'var(--red)' }}>{err}</div>}
      {!pick && <div className="small muted" style={{ marginTop: 6 }}>Pick a night to see planned against actual.</div>}

      {cmp && (
        <>
          <div className="card" style={{ marginTop: 8 }}>
            <h3>Order</h3>
            <div className="small"><b>Actual:</b> {cmp.actualOrder.length ? cmp.actualOrder.map(a => a.name).join(' → ') : 'no named kill recorded'}</div>
            <div className="small" style={{ marginTop: 4 }}>
              <b>Planned:</b> {cmp.plannedOrder.length ? cmp.plannedOrder.map(p => `${p.pin} ${p.name}`).join(' → ') : 'no boss pins in the plan'}
            </div>
          </div>

          <table className="cmp-table">
            <thead><tr><th>Kill</th><th>Plan pin</th></tr></thead>
            <tbody>
              {cmp.actualOrder.map(a => (
                <tr key={a.n}><td>{a.n}. {a.name}</td><td>{a.pin ? '#' + a.pin : <span style={{ color: 'var(--orange)' }}>not in the plan</span>}</td></tr>
              ))}
              {cmp.plannedOrder.filter(p => p.killed === null).map(p => (
                <tr key={'nv' + p.pin}><td className="muted">{p.name}</td><td><span style={{ color: p.optional ? 'var(--muted)' : 'var(--orange)' }}>#{p.pin} {p.optional ? 'optional, not visited' : 'never visited'}</span></td></tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ margin: '10px 0 4px', fontSize: 13 }}>Leg by leg</h3>
          {cmp.legs.length === 0 && <div className="small muted">The plan has no legs yet.</div>}
          <table className="cmp-table">
            <thead><tr><th>Leg</th><th>Kills</th><th>Drawn</th><th>Actual</th><th>Time</th></tr></thead>
            <tbody>
              {cmp.legs.map(l => {
                const f = l.leg.b.npc !== undefined ? fewest.get(l.leg.b.npc) : undefined;
                return (
                  <tr key={l.leg.k} className={l.leg.optLeg ? 'opt' : ''}>
                    <td title={`${l.leg.a.label} to ${l.leg.b.label}`}>
                      {l.from}&rarr;{l.to}
                      {l.leg.branch && <span style={{ color: l.leg.branch.branch.color }}> {l.leg.branch.branch.label}</span>}
                      {f && <div className="fewest">{fewestLine(f, 3)}</div>}
                    </td>
                    <td>{l.actualOrder ? `${l.actualOrder[0]}→${l.actualOrder[1]}` : '—'}{l.status === 'reversed' && <div style={{ color: 'var(--orange)' }}>other way</div>}{l.status === 'one end not in the night' && <div className="muted">not walked</div>}{l.status === 'walked' && l.between > 0 && <div className="muted">{l.between} kill{l.between === 1 ? '' : 's'} between</div>}</td>
                    <td>{fmtU(l.plannedU)}</td>
                    <td>{l.actualU != null ? fmtU(l.actualU) : '—'}</td>
                    <td>{l.actualS != null ? fmtT(l.actualS) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="small muted" style={{ marginTop: 6 }}>
            Kills: the number each of the two ends died in on the night. Actual: the path walked between those two kills; Time is how long that took. The zone-in and the Projections are not kills, so a leg ending at one has nothing to measure.
          </div>
          {cmp.notInPlan.length > 0 && (
            <div className="small" style={{ marginTop: 6 }}>
              <b>Killed but not in the plan:</b> {cmp.notInPlan.map(k => `${k.n}. ${k.name}`).join(', ')}
            </div>
          )}
          {cmp.neverVisited.length > 0 && (
            <div className="small" style={{ marginTop: 4 }}>
              <b>In the plan, never visited:</b> {cmp.neverVisited.map(k => `#${k.pin} ${k.name}${k.optional ? ' (optional)' : ''}`).join(', ')}
            </div>
          )}
          {/* the smallest group that has killed what the plan names */}
          {[...npcOf.entries()].some(([, n]) => n !== undefined && fewest.has(n)) && (
            <div className="small" style={{ marginTop: 6 }}>
              {[...npcOf.entries()].flatMap(([label, n]) => (n !== undefined && fewest.has(n) ? [`${label}: ${fewestLine(fewest.get(n) as FewestKill)}`] : [])).map(t => <div key={t} className="fewest">{t}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
