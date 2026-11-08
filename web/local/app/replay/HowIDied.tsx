'use client';

// How I died. The 30 seconds before each of your deaths, built on this PC from your own log and the position recorder
// (GET /api/local/deaths, /api/local/deaths/<id>). Nothing is uploaded. Zeal reports only YOUR position and your
// TARGET's, so the plot cannot show where the other attackers stood, and says so.
import { useCallback, useEffect, useMemo, useState } from 'react';

const API = '/api/local/deaths';
const WINDOW_S = 30;

type Top = { name: string; total: number };
type Row = { id: string; at: number; character: string; zone: string | null; killer: string | null; total: number; top: Top[] };
type Hit = { t: number; attacker: string | null; amount: number; kind: string; verb?: string };
type Attacker = { name: string; total: number; hits: number; max: number; kinds: string[]; first_t: number; last_t: number };
type Frame = { t: number; x: number; y: number; z: number; h: number | null; hp: number | null; target: { name: string; x: number; y: number; z: number } | null };
type Story = Omit<Row, 'id'> & { target: string | null; hits: Hit[]; attackers: Attacker[]; frames: Frame[] };

const when = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const PALETTE = ['#e0603c', '#d9a441', '#5aa0d8', '#8fbf6a', '#b07ad8', '#7a8a99'];
const dist = (f: Frame) => (f.target ? Math.round(Math.hypot(f.x - f.target.x, f.y - f.target.y, f.z - f.target.z)) : null);

function Timeline({ s }: { s: Story }) {
  const names = s.attackers.slice(0, 5).map(a => a.name);
  const bins = useMemo(() => {
    const out = Array.from({ length: WINDOW_S }, () => new Map<string, number>());
    for (const h of s.hits) {
      const i = Math.min(WINDOW_S - 1, Math.max(0, Math.floor((h.t - (s.at - WINDOW_S * 1000)) / 1000)));
      const k = h.attacker && names.includes(h.attacker) ? h.attacker : 'others';
      out[i].set(k, (out[i].get(k) ?? 0) + h.amount);
    }
    return out;
  }, [s, names]);
  const keys = [...names, 'others'];
  const peak = Math.max(1, ...bins.map(b => [...b.values()].reduce((a, v) => a + v, 0)));
  const W = 600, H = 150, bw = W / WINDOW_S;
  const hp = s.frames.filter(f => f.hp != null);
  const pts = hp.map(f => `${(((f.t - (s.at - WINDOW_S * 1000)) / 1000) / WINDOW_S * W).toFixed(1)},${(H - (Number(f.hp) / 100) * H).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" role="img" aria-label="Damage taken per second by attacker, with your health line">
        {bins.map((b, i) => {
          let y = H;
          return keys.map((k, ki) => {
            const v = b.get(k) ?? 0;
            if (!v) return null;
            const h = (v / peak) * (H - 10);
            y -= h;
            return <rect key={`${i}-${k}`} x={i * bw + 1} y={y} width={bw - 2} height={h} fill={PALETTE[ki % PALETTE.length]} opacity={0.9} />;
          });
        })}
        {pts && <polyline points={pts} fill="none" stroke="#ffffff" strokeWidth={2} strokeDasharray="4 2" />}
        <line x1={W - 1} x2={W - 1} y1={0} y2={H} stroke="#e0603c" strokeWidth={2} />
        <text x={W - 6} y={12} textAnchor="end" fontSize={11} fill="#e0603c">killing blow</text>
        <text x={0} y={H + 12} fontSize={10} fill="#8a8f98">−30 s</text>
        <text x={W} y={H + 12} textAnchor="end" fontSize={10} fill="#8a8f98">death</text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dim">
        {keys.map((k, i) => <span key={k}><span aria-hidden style={{ color: PALETTE[i % PALETTE.length] }}>■ </span>{k}</span>)}
        <span><span aria-hidden>┅ </span>your health{hp.length ? '' : ' (not recorded)'}</span>
        <span>tallest bar: {peak} damage in one second</span>
      </div>
    </div>
  );
}

function Plot({ s }: { s: Story }) {
  const pts: { x: number; y: number }[] = [];
  for (const f of s.frames) { pts.push(f); if (f.target) pts.push(f.target); }
  if (!pts.length) return <p className="text-sm text-dim">No positions were recorded for these 30 seconds (Zeal was not connected).</p>;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = Math.max(40, x1 - x0, y1 - y0), S = 280, pad = 14;
  const px = (x: number) => pad + ((x - x0) / span) * (S - 2 * pad);
  const py = (y: number) => S - pad - ((y - y0) / span) * (S - 2 * pad);   // north up
  const line = s.frames.map(f => `${px(f.x).toFixed(1)},${py(f.y).toFixed(1)}`).join(' ');
  const last = s.frames[s.frames.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[320px] rounded border border-border bg-bg" role="img" aria-label="Your path over the last 30 seconds">
        <polyline points={line} fill="none" stroke="#d9a441" strokeWidth={1.5} />
        {s.frames.map((f, i) => f.target && <line key={`l${i}`} x1={px(f.x)} y1={py(f.y)} x2={px(f.target.x)} y2={py(f.target.y)} stroke="#e0603c" strokeOpacity={0.25} />)}
        {s.frames.map((f, i) => f.target && <circle key={`t${i}`} cx={px(f.target.x)} cy={py(f.target.y)} r={3} fill="#e0603c" />)}
        {s.frames.map((f, i) => <circle key={`m${i}`} cx={px(f.x)} cy={py(f.y)} r={i === s.frames.length - 1 ? 5 : 2.5} fill={i === s.frames.length - 1 ? '#ffffff' : '#d9a441'} />)}
        {last && <text x={px(last.x) + 7} y={py(last.y) - 6} fontSize={10} fill="#ffffff">you, at death</text>}
      </svg>
      <div className="mt-1 text-[11px] text-dim">
        <span style={{ color: '#d9a441' }}>● </span>you, one dot per recorded frame · <span style={{ color: '#e0603c' }}>● </span>your target{s.target ? ` (${s.target})` : ''}
      </div>
      <p className="mt-2 text-xs text-orange">
        Where the other attackers stood is NOT known: Zeal reports only your own position and your target&apos;s. A mob that hit you may have been
        well away from this plot.
      </p>
      <div className="mt-2 text-xs text-dim">
        <div className="text-text mb-1">Distance to your target, frame by frame</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {s.frames.map((f, i) => (
            <span key={i}>{Math.round((f.t - s.at) / 1000)}s: <b className="text-text">{dist(f) ?? '–'}</b></span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HowIDied() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [story, setStory] = useState<{ id: string; s: Story } | null>(null);

  const load = useCallback(() => {
    fetch(`${API}?limit=50`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`the agent answered ${r.status}`))))
      .then((j: { deaths?: Row[] }) => { setRows(Array.isArray(j.deaths) ? j.deaths : []); setErr(null); })
      .catch((e: Error) => setErr(e.message || 'could not reach the agent'));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);
  const id = pick ?? rows?.[0]?.id ?? null;
  useEffect(() => {
    if (!id) { setStory(null); return; }
    let live = true;
    fetch(`${API}/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`the agent answered ${r.status}`))))
      .then((j: Story) => { if (live) setStory({ id, s: j }); })
      .catch((e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [id]);

  return (
    <section className="bg-panel border border-border rounded-lg p-4 sm:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <h2 className="text-xl text-gold"><span aria-hidden>💀 </span>How I died</h2>
        <button type="button" onClick={load} className="ml-auto text-[11px] px-2 py-0.5 rounded border border-border text-dim hover:text-text">Reload</button>
      </div>
      {err && <p className="text-sm text-orange">Could not read your deaths: {err}. Is Mimic running?</p>}
      {!err && rows && rows.length === 0 && <p className="text-sm text-dim">No deaths recorded yet. The next time you die with Mimic running, the last 30 seconds appear here.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-border border border-border rounded max-h-56 overflow-auto">
          {rows.map(r => (
            <li key={r.id}>
              <button type="button" onClick={() => setPick(r.id)}
                className={`w-full text-left px-3 py-2 text-xs ${r.id === id ? 'bg-bg text-text' : 'text-dim hover:text-text'}`}>
                <span className="text-text">{when.format(r.at)}</span> · {r.zone ?? 'unknown zone'} · killed by <b>{r.killer ?? 'unknown'}</b>
                <span className="block">{r.top.map(t => `${t.name} ${t.total}`).join(' · ') || 'no damage recorded'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {story && story.id === id && (
        <div className="space-y-5">
          <div>
            <h3 className="text-sm text-text mb-1">The 30 seconds before you died</h3>
            <Timeline s={story.s} />
          </div>
          <div>
            <h3 className="text-sm text-text mb-1">Who hit you</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-dim text-left"><tr><th className="pr-3">Attacker</th><th className="pr-3">Total</th><th className="pr-3">Hits</th><th className="pr-3">Biggest</th><th>Kinds</th></tr></thead>
                <tbody>
                  {story.s.attackers.map(a => (
                    <tr key={a.name} className="border-t border-border">
                      <td className="pr-3 py-1 text-text">{a.name}</td><td className="pr-3">{a.total}</td><td className="pr-3">{a.hits}</td>
                      <td className="pr-3">{a.max}</td><td className="text-dim">{a.kinds.join(', ')}</td>
                    </tr>
                  ))}
                  {story.s.attackers.length === 0 && <tr><td colSpan={5} className="py-1 text-dim">No damage lines were seen in those 30 seconds.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="text-sm text-text mb-1">Where you were</h3>
            <Plot s={story.s} />
          </div>
        </div>
      )}
      <p className="text-xs text-dim">
        Recorded on this PC only, from your own log and Zeal: damage lines that named you, and your position every 3 seconds. Not recorded: where any
        attacker other than your target stood, hits that never printed in your log, and anything from other players. Kept 90 days.
      </p>
    </section>
  );
}
