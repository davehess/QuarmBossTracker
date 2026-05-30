// Officer tool: class-by-class raid attendance roster.
//
// Replicates the two-sheet view the guild leader maintains by hand:
//
//   Sheet A — class summary:
//     | Target (60-man) | Current (≥50% RA 30d) | Class | Delta | Note |
//     The roster math: count characters whose 30-day attendance rate is
//     ≥50%, group by class, compare to the 60-man target. Delta tells
//     officers where to recruit.
//
//   Sheet B — class grid:
//     One column per class. Each character whose 30-day rate is ≥50%
//     listed under their class column. Color-coded:
//       🟡 yellow — new attendee (first tick within the last 60 days)
//       🟣 magenta — downturn (was a regular but recent rate dropped)
//       (white) — steady regular
//
// Reality signal is opendkp_ticks (374 raids × 4 ticks of canonical
// attendance). Ticks are aggregated to the raid level — being in any of a
// raid's ticks counts as "attended that raid". The denominator is the
// count of raids in the window, so attendance rate = raids_attended /
// raids_held.
//
// Targets are hard-coded from the leader's spreadsheet but exposed for
// future tuning. Edit DEFAULT_TARGETS or override via the ?targets= query
// (Bard=8&Cleric=8&... — useful for testing different raid sizes).

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { getDemoMode, maybeFake } from '@/lib/obfuscate';

export const dynamic = 'force-dynamic';

// Order matters — controls the column order on the grid and the row
// order on the summary. Final "Flex" row is a placeholder for the
// open-class slot (we never count anyone toward it).
const CLASS_ORDER: string[] = [
  'Bard', 'Beastlord', 'Cleric', 'Druid', 'Enchanter', 'Magician', 'Monk',
  'Necromancer', 'Paladin', 'Ranger', 'Rogue', 'Shadow Knight', 'Shaman',
  'Warrior', 'Wizard',
];
const FLEX_CLASS = 'Flex';

// 60-man raid target counts (from the leader's spreadsheet). Adjust here
// or via ?targets= query param for what-if analysis.
const DEFAULT_TARGETS: Record<string, number> = {
  'Bard': 8, 'Beastlord': 3, 'Cleric': 8, 'Druid': 3, 'Enchanter': 4,
  'Magician': 2, 'Monk': 3, 'Necromancer': 3, 'Paladin': 2, 'Ranger': 3,
  'Rogue': 4, 'Shadow Knight': 3, 'Shaman': 3, 'Warrior': 4, 'Wizard': 4,
  'Flex': 3,
};

// Default attendance rate threshold for being on the active roster. 50%
// matches the spreadsheet ("if above 50% RA 30Days").
const DEFAULT_THRESHOLD = 0.50;

type CharRow = {
  name: string;
  class: string | null;
  main_name: string | null;
  active: boolean;
};

type Raid = { raid_id: number; ts: string };
type Tick = { raid_id: number; tick_id: number; attendees: string[] };

type AttRow = {
  name: string;
  className: string;
  rate30: number;
  ratePrior: number;        // days 30-90, used for downturn detection
  firstSeen: string | null; // ISO of earliest tick we have
  attended30: number;
  attendedPrior: number;
};

function parseTargets(raw: string | undefined): Record<string, number> {
  if (!raw) return DEFAULT_TARGETS;
  const out: Record<string, number> = { ...DEFAULT_TARGETS };
  for (const pair of raw.split(',')) {
    const m = pair.split('=');
    if (m.length !== 2) continue;
    const key = m[0].trim();
    const n = parseInt(m[1], 10);
    if (key && !Number.isNaN(n)) out[key] = n;
  }
  return out;
}

async function loadData() {
  const admin = supabaseAdmin();
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const since60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: chars }, { data: raids90 }] = await Promise.all([
    admin
      .from('characters')
      .select('name, class, main_name, active')
      .eq('guild_id', 'wolfpack'),
    admin
      .from('opendkp_raids')
      .select('raid_id, ts')
      .gte('ts', since90)
      .order('ts', { ascending: false }),
  ]);

  const raids = (raids90 ?? []) as Raid[];
  if (raids.length === 0) return { chars: (chars ?? []) as CharRow[], raids: [], ticks: [], since30, since60, since90 };

  const raidIds = raids.map(r => r.raid_id);
  // PostgREST IN() takes paginated chunks; 374 ids is small enough to fit.
  const { data: ticks } = await admin
    .from('opendkp_ticks')
    .select('raid_id, tick_id, attendees')
    .in('raid_id', raidIds);

  // We also want the earliest tick per character to detect "new attendees"
  // — to check first_seen we need attendance data older than 60 days.
  // Pull a wider window of raids (last 365 days) for the first-seen check
  // only.
  const { data: raids365 } = await admin
    .from('opendkp_raids')
    .select('raid_id, ts')
    .gte('ts', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());
  const oldRaidIds = (raids365 ?? []).filter((r: Raid) => !raidIds.includes(r.raid_id)).map((r: Raid) => r.raid_id);
  let oldTicks: Tick[] = [];
  if (oldRaidIds.length > 0) {
    const { data } = await admin
      .from('opendkp_ticks')
      .select('raid_id, attendees')
      .in('raid_id', oldRaidIds);
    oldTicks = (data ?? []) as Tick[];
  }

  return {
    chars: (chars ?? []) as CharRow[],
    raids,
    raids365: (raids365 ?? []) as Raid[],
    ticks: (ticks ?? []) as Tick[],
    oldTicks,
    since30, since60, since90,
  };
}

function computeAttendance(args: {
  chars: CharRow[];
  raids: Raid[];
  ticks: Tick[];
  oldTicks: Tick[];
  raids365: Raid[];
  since30: string;
  since60: string;
}) {
  const { chars, raids, ticks, oldTicks, raids365, since30, since60 } = args;

  // raid_id → ts so we can decide which window a raid belongs to
  const raidTs = new Map<number, string>();
  for (const r of raids) raidTs.set(r.raid_id, r.ts);
  for (const r of raids365) if (!raidTs.has(r.raid_id)) raidTs.set(r.raid_id, r.ts);

  // raids in each window
  const raids30 = raids.filter(r => r.ts >= since30).length;
  const raidsPrior = raids.filter(r => r.ts >= since60 && r.ts < since30).length;

  // character (lower) → set of raid_ids they attended, plus first-seen ts
  const attended90 = new Map<string, Set<number>>();
  const attendedPrior = new Map<string, Set<number>>();
  const firstSeen = new Map<string, string>();   // lower → ISO

  for (const t of ticks) {
    const ts = raidTs.get(t.raid_id);
    if (!ts) continue;
    for (const name of (t.attendees || [])) {
      const k = (name || '').toLowerCase();
      if (!k) continue;
      let set90 = attended90.get(k);
      if (!set90) { set90 = new Set(); attended90.set(k, set90); }
      set90.add(t.raid_id);

      if (ts >= since60 && ts < since30) {
        let setPrior = attendedPrior.get(k);
        if (!setPrior) { setPrior = new Set(); attendedPrior.set(k, setPrior); }
        setPrior.add(t.raid_id);
      }

      const prev = firstSeen.get(k);
      if (!prev || ts < prev) firstSeen.set(k, ts);
    }
  }
  // first-seen check uses oldTicks for the lookback past 90 days
  for (const t of oldTicks) {
    const ts = raidTs.get(t.raid_id);
    if (!ts) continue;
    for (const name of (t.attendees || [])) {
      const k = (name || '').toLowerCase();
      if (!k) continue;
      const prev = firstSeen.get(k);
      if (!prev || ts < prev) firstSeen.set(k, ts);
    }
  }

  // Roll up per character on roster
  const byClass = new Map<string, AttRow[]>();
  for (const c of chars) {
    if (!c.active) continue;
    const k = c.name.toLowerCase();
    const set90 = attended90.get(k) || new Set<number>();
    const attended30 = [...set90].filter(rid => {
      const ts = raidTs.get(rid);
      return ts && ts >= since30;
    }).length;
    const setPrior = attendedPrior.get(k) || new Set<number>();
    const attendedPriorN = setPrior.size;

    const rate30   = raids30      > 0 ? attended30      / raids30      : 0;
    const ratePrior = raidsPrior  > 0 ? attendedPriorN  / raidsPrior   : 0;
    const cls = (c.class || 'UNKNOWN');
    if (cls === 'UNKNOWN') continue;

    const row: AttRow = {
      name: c.name,
      className: cls,
      rate30, ratePrior,
      attended30, attendedPrior: attendedPriorN,
      firstSeen: firstSeen.get(k) || null,
    };
    const list = byClass.get(cls) || [];
    list.push(row);
    byClass.set(cls, list);
  }

  // Sort each class column by 30d rate desc, then name
  for (const list of byClass.values()) {
    list.sort((a, b) => (b.rate30 - a.rate30) || a.name.localeCompare(b.name));
  }

  return { byClass, raids30, raidsPrior };
}

function classify(r: AttRow, threshold: number, since60Iso: string) {
  // Categorical: regular / new / downturn / inactive
  const isRegular  = r.rate30 >= threshold;
  const isNew      = r.firstSeen != null && r.firstSeen >= since60Iso;
  // Downturn: was active before (priorRate above the threshold) and 30d
  // rate is significantly below the threshold. Use 0.7 * threshold so a
  // small dip from 60% → 40% doesn't flag; 60% → 25% does.
  const isDownturn = r.ratePrior >= threshold && r.rate30 < threshold * 0.7;
  return { isRegular, isNew, isDownturn };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ targets?: string; threshold?: string }>;
}) {
  const p = await searchParams;
  const targets = parseTargets(p.targets);
  const threshold = p.threshold ? Math.max(0, Math.min(1, parseFloat(p.threshold))) : DEFAULT_THRESHOLD;
  const demoMode = getDemoMode();

  const data = await loadData();
  if (data.raids.length === 0) {
    return (
      <div className="space-y-4">
        <div className="text-sm"><Link href="/admin" className="text-blue hover:underline">← back to admin</Link></div>
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No OpenDKP raid data in the last 90 days. Run the OpenDKP sync first
          (it kicks 45 s after bot start, then every interval).
        </section>
      </div>
    );
  }

  const { byClass, raids30, raidsPrior } = computeAttendance({
    chars: data.chars, raids: data.raids, ticks: data.ticks,
    oldTicks: data.oldTicks!, raids365: data.raids365!,
    since30: data.since30, since60: data.since60,
  });

  // Build summary: count regulars per class (above threshold)
  const summaryRows: { cls: string; target: number; current: number; delta: number }[] = [];
  let totalTarget = 0, totalCurrent = 0;
  for (const cls of CLASS_ORDER) {
    const list = byClass.get(cls) || [];
    const current = list.filter(r => r.rate30 >= threshold).length;
    const target = targets[cls] ?? 0;
    totalTarget += target;
    totalCurrent += current;
    summaryRows.push({ cls, target, current, delta: target - current });
  }
  const flexTarget = targets[FLEX_CLASS] ?? 0;
  totalTarget += flexTarget;
  summaryRows.push({ cls: FLEX_CLASS, target: flexTarget, current: 0, delta: flexTarget });

  // Stats
  const newAttendees: AttRow[] = [];
  const downturns: AttRow[]   = [];
  for (const list of byClass.values()) {
    for (const r of list) {
      const c = classify(r, threshold, data.since60);
      if (c.isRegular && c.isNew)    newAttendees.push(r);
      if (c.isRegular && c.isDownturn) downturns.push(r);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📊 Raid attendance roster</h2>
        <p className="text-sm text-dim leading-6">
          Reproduces the class-coverage view from the leader&apos;s
          spreadsheet, computed from <code>opendkp_ticks</code> over the
          last 90 days. Threshold for &quot;active roster&quot; is{' '}
          {pct(threshold)} attendance rate in the last 30 days (
          {data.raids.filter(r => r.ts >= data.since30).length} raids in
          window; {raidsPrior} in the prior 30-day window for baseline).
          Targets per class come from the spreadsheet&apos;s 60-man column.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Target" value={totalTarget} />
          <Stat label="Current regulars" value={totalCurrent} color="text-text" />
          <Stat label="Delta" value={totalTarget - totalCurrent} color={(totalTarget - totalCurrent) > 0 ? 'text-orange' : 'text-green'} />
          <Stat label="🆕 New attendees" value={newAttendees.length} color="text-yellow-400" />
        </div>
      </section>

      {/* Class summary */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          Class summary — current roster if above {pct(threshold)} RA / 30 days
        </h3>
        <table className="w-full text-xs">
          <thead className="text-dim">
            <tr className="border-b border-border">
              <th className="text-right px-3 py-2 font-normal">60-man</th>
              <th className="text-right px-3 py-2 font-normal">Current</th>
              <th className="text-left  px-3 py-2 font-normal">Class</th>
              <th className="text-right px-3 py-2 font-normal">Delta</th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map(row => (
              <tr key={row.cls} className="border-b border-border/40 hover:bg-[#1a212c]">
                <td className="px-3 py-2 text-right text-text">{row.target}</td>
                <td className={`px-3 py-2 text-right ${row.current >= row.target ? 'text-green' : 'text-text'}`}>{row.current}</td>
                <td className="px-3 py-2 text-text">{row.cls}</td>
                <td className={`px-3 py-2 text-right ${row.delta > 0 ? 'text-orange' : row.delta < 0 ? 'text-green' : 'text-dim'}`}>
                  {row.delta > 0 ? `+${row.delta}` : row.delta}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-border">
              <td className="px-3 py-2 text-right text-text font-bold">{totalTarget}</td>
              <td className="px-3 py-2 text-right text-text font-bold">{totalCurrent}</td>
              <td className="px-3 py-2 text-dim">Total</td>
              <td className={`px-3 py-2 text-right font-bold ${(totalTarget - totalCurrent) > 0 ? 'text-orange' : 'text-green'}`}>
                {(totalTarget - totalCurrent) > 0 ? `+${totalTarget - totalCurrent}` : (totalTarget - totalCurrent)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Class roster grid — color-coded per spreadsheet conventions */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          Active roster by class
        </h3>
        <div className="px-4 py-3 text-[10px] text-dim flex flex-wrap gap-3">
          <span><span className="inline-block w-3 h-3 align-middle mr-1" style={{background:'#3f3f24'}}/> 🆕 new (first tick ≤ 60d ago)</span>
          <span><span className="inline-block w-3 h-3 align-middle mr-1" style={{background:'#4a1f3f'}}/> 📉 downturn (baseline ≥ {pct(threshold)}, recent &lt; {pct(threshold * 0.7)})</span>
          <span><span className="inline-block w-3 h-3 align-middle mr-1 bg-bg border border-border"/> steady</span>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead className="text-dim">
              <tr className="border-b border-border">
                {CLASS_ORDER.map(cls => (
                  <th key={cls} className="text-left px-2 py-2 font-normal align-bottom min-w-[110px]">
                    {cls}
                    <div className="text-[10px] text-dim">
                      {(byClass.get(cls) || []).filter(r => r.rate30 >= threshold).length}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Render rows up to the max class roster size so columns align */}
              {(() => {
                const cols = CLASS_ORDER.map(cls => (byClass.get(cls) || []).filter(r => r.rate30 >= threshold));
                const maxLen = Math.max(0, ...cols.map(c => c.length));
                const rowsOut: React.ReactNode[] = [];
                for (let i = 0; i < maxLen; i++) {
                  rowsOut.push(
                    <tr key={i}>
                      {cols.map((list, j) => {
                        const r = list[i];
                        if (!r) return <td key={j} className="px-2 py-1" />;
                        const c = classify(r, threshold, data.since60);
                        const bg = c.isDownturn ? '#4a1f3f' : c.isNew ? '#3f3f24' : '';
                        const title = `${pct(r.rate30)} last 30d · ${pct(r.ratePrior)} prior 30d · first seen ${r.firstSeen ? r.firstSeen.slice(0, 10) : 'unknown'}`;
                        return (
                          <td key={j} className="px-2 py-1" style={bg ? { background: bg } : undefined} title={title}>
                            <Link href={`/character/${encodeURIComponent(r.name)}`} className="hover:underline text-text">
                              {maybeFake(demoMode, r.name, r.className)}
                            </Link>
                            <div className="text-[10px] text-dim">{pct(r.rate30)}</div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                }
                return rowsOut;
              })()}
            </tbody>
          </table>
        </div>
      </section>

      {/* Standalone cohorts for officer attention */}
      {newAttendees.length > 0 && (
        <section className="bg-panel border border-border rounded-lg">
          <h3 className="text-sm text-yellow-400 px-4 py-3 border-b border-border">
            🆕 New regulars (first tick in last 60 days) — {newAttendees.length}
          </h3>
          <ul className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
            {newAttendees.sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || '')).map(r => (
              <li key={r.name} className="bg-bg border border-border rounded px-2 py-1">
                <Link href={`/character/${encodeURIComponent(r.name)}`} className="text-text hover:underline">{maybeFake(demoMode, r.name, r.className)}</Link>
                <div className="text-dim text-[10px]">{r.className} · {pct(r.rate30)} · first seen {r.firstSeen?.slice(0, 10)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {downturns.length > 0 && (
        <section className="bg-panel border border-border rounded-lg">
          <h3 className="text-sm text-purple px-4 py-3 border-b border-border">
            📉 Downturn (baseline ≥ {pct(threshold)} but recent dropped) — {downturns.length}
          </h3>
          <ul className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
            {downturns.sort((a, b) => (b.ratePrior - b.rate30) - (a.ratePrior - a.rate30)).map(r => (
              <li key={r.name} className="bg-bg border border-border rounded px-2 py-1">
                <Link href={`/character/${encodeURIComponent(r.name)}`} className="text-text hover:underline">{maybeFake(demoMode, r.name, r.className)}</Link>
                <div className="text-dim text-[10px]">
                  {r.className} · {pct(r.ratePrior)} → <span className="text-red-400">{pct(r.rate30)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, color = 'text-text' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className={`text-2xl ${color}`}>{value.toLocaleString()}</div>
      <div className="text-dim text-xs">{label}</div>
    </div>
  );
}
