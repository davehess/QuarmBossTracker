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
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';
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
  rank: string | null;
};

// Ranks that count as "on the raid roster" — what the class summary should
// count. Excludes Raid Alt (placeholder DKP-tracker characters like
// Ferdinand / Canopy / Bardtholemu that aren't real people in the slot).
const ROSTER_RANKS = new Set(['Raid Pack', 'Officer', 'Pack Leader', 'Recruit']);

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

// Read the active raid_targets row set from Supabase. Falls back to the
// hard-coded defaults if the table isn't seeded (first-deploy / disabled
// supabase). The page can be overridden by ?targets=... for what-if
// analysis without writing to the table.
async function loadTargetsFromDb(raidSize: string): Promise<Record<string, number>> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('raid_targets')
    .select('class, target')
    .eq('guild_id', 'wolfpack')
    .eq('raid_size', raidSize);
  if (!data || data.length === 0) return { ...DEFAULT_TARGETS };
  const out: Record<string, number> = {};
  for (const r of data as { class: string; target: number }[]) {
    out[r.class] = r.target;
  }
  return out;
}

// #92 — family-aware 60d / 90d / lifetime RA% + tick counts, read straight from
// the member_attendance_metrics view (SQL does the family rollup + windows the
// per-character JS above deliberately doesn't). This supplements the 30d grid:
// the grid answers "who's active right now"; this table answers the rules'
// seating/tiebreak questions (60/90/lifetime).
type MetricRow = {
  main_name: string;
  main_class: string | null;
  main_rank: string | null;
  att_ticks_60d: number | string; ticks_60d: number | string; ra_60d: number | string | null;
  att_ticks_90d: number | string; ticks_90d: number | string; ra_90d: number | string | null;
  att_ticks_lifetime: number | string; ticks_lifetime: number | string; ra_lifetime: number | string | null;
  raids_att_lifetime: number | string;
};

async function loadFamilyMetrics(): Promise<MetricRow[]> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('member_attendance_metrics')
    .select('main_name, main_class, main_rank, att_ticks_60d, ticks_60d, ra_60d, att_ticks_90d, ticks_90d, ra_90d, att_ticks_lifetime, ticks_lifetime, ra_lifetime, raids_att_lifetime')
    .not('main_class', 'is', null)
    .order('ra_90d', { ascending: false, nullsFirst: false });
  const rows = (data ?? []) as MetricRow[];
  // Only real roster ranks — mirrors the class-summary filter (Raid Alts are
  // DKP-tracker placeholders, not people in a slot).
  return rows.filter(r => r.main_rank != null && ROSTER_RANKS.has(r.main_rank));
}

async function actionAssertOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  return user;
}

// Server action: upsert every target for the active raid_size from the
// form. Each input is named `target_<ClassName>`. Officer-only.
async function saveTargets(formData: FormData) {
  'use server';
  const u = await actionAssertOfficer();
  if (!u) redirect('/?error=admin_required');
  const raidSize = String(formData.get('raid_size') || '60-man').slice(0, 40);
  const actor = u!.email || u!.id;
  const rows: { guild_id: string; raid_size: string; class: string; target: number; updated_by: string }[] = [];
  for (const cls of [...CLASS_ORDER, FLEX_CLASS]) {
    const raw = formData.get(`target_${cls}`);
    if (raw == null) continue;
    const n = Math.max(0, Math.min(99, parseInt(String(raw), 10) || 0));
    rows.push({ guild_id: 'wolfpack', raid_size: raidSize, class: cls, target: n, updated_by: actor });
  }
  if (rows.length === 0) return;
  const admin = supabaseAdmin();
  await admin.from('raid_targets').upsert(rows, { onConflict: 'guild_id,raid_size,class' });
  revalidatePath('/admin/attendance');
}

async function loadData() {
  const admin = supabaseAdmin();
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const since60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: chars }, { data: raids90 }] = await Promise.all([
    admin
      .from('characters')
      .select('name, class, main_name, active, rank')
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

  // raid_id → ts so we can decide which window a tick belongs to
  const raidTs = new Map<number, string>();
  for (const r of raids) raidTs.set(r.raid_id, r.ts);
  for (const r of raids365) if (!raidTs.has(r.raid_id)) raidTs.set(r.raid_id, r.ts);

  // OpenDKP computes RA per TICK, not per raid (its "30 Day (52/52)" is 52
  // ticks). We match that exactly: rate = attended ticks / total ticks in
  // window. CRITICAL: only count ticks that actually have attendees — empty-
  // attendee ticks are sync gaps (detail fetched mid-raid before attendance
  // was finalized) and counting them in the denominator credits nobody,
  // which is what tanked everyone's RA below OpenDKP's numbers (Rorschach
  // read 64% vs OpenDKP's 100%). The bot's _raidNeedsDetail re-fetch backfills
  // those empties over the next sync cycles; until then we simply don't
  // penalize anyone for ticks we failed to capture.
  const validTicks = ticks.filter(t => Array.isArray(t.attendees) && t.attendees.length > 0);

  // tick denominators per window
  let ticks30 = 0, ticksPrior = 0;
  for (const t of validTicks) {
    const ts = raidTs.get(t.raid_id);
    if (!ts) continue;
    if (ts >= since30) ticks30++;
    else if (ts >= since60) ticksPrior++;
  }

  // character (lower) → attended-tick counts per window, plus first-seen ts
  const attended30 = new Map<string, number>();
  const attendedPrior = new Map<string, number>();
  const firstSeen = new Map<string, string>();   // lower → ISO

  for (const t of validTicks) {
    const ts = raidTs.get(t.raid_id);
    if (!ts) continue;
    const in30    = ts >= since30;
    const inPrior = ts >= since60 && ts < since30;
    for (const name of (t.attendees || [])) {
      const k = (name || '').toLowerCase();
      if (!k) continue;
      if (in30)    attended30.set(k, (attended30.get(k) || 0) + 1);
      else if (inPrior) attendedPrior.set(k, (attendedPrior.get(k) || 0) + 1);
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
  // Include EVERY on-roster character (Raid Pack / Officer / Pack Leader /
  // Recruit) — even those with zero attendance — so the grid shows the
  // full roster, not just the regulars. Raid Alts are skipped because
  // they're DKP-tracker placeholders, not real players in a slot.
  const byClass = new Map<string, AttRow[]>();
  for (const c of chars) {
    if (!c.active) continue;
    if (!c.rank || !ROSTER_RANKS.has(c.rank)) continue;
    const cls = (c.class || 'UNKNOWN');
    if (cls === 'UNKNOWN') continue;
    const k = c.name.toLowerCase();
    const a30 = attended30.get(k) || 0;
    const aPrior = attendedPrior.get(k) || 0;
    const rate30   = ticks30     > 0 ? a30    / ticks30     : 0;
    const ratePrior = ticksPrior > 0 ? aPrior / ticksPrior  : 0;

    const row: AttRow = {
      name: c.name,
      className: cls,
      rate30, ratePrior,
      attended30: a30, attendedPrior: aPrior,
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

  // raids30/raidsPrior kept as field names for callers, but now carry TICK
  // counts (the real RA denominator).
  return { byClass, raids30: ticks30, raidsPrior: ticksPrior };
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

// The view's RA% columns are SQL numeric → PostgREST returns them as strings;
// coerce defensively (accepts number, string, or null).
function raNum(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function raPct(v: number | string | null): string {
  const n = raNum(v);
  return n == null ? '—' : `${Math.round(n * 100)}%`;
}
function raColor(v: number | string | null, threshold: number): string {
  const n = raNum(v);
  if (n == null) return 'text-dim';
  if (n >= threshold) return 'text-green';
  if (n >= threshold * 0.7) return 'text-text';
  return 'text-orange';
}

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ targets?: string; threshold?: string }>;
}) {
  const p = await searchParams;
  const raidSize = '60-man';
  // DB targets are the source of truth; ?targets= URL param overrides for
  // what-if analysis without writing. Saved defaults persist across reloads.
  const dbTargets = await loadTargetsFromDb(raidSize);
  const targets = p.targets ? parseTargets(p.targets) : dbTargets;
  const isOverriding = !!p.targets;
  const threshold = p.threshold ? Math.max(0, Math.min(1, parseFloat(p.threshold))) : DEFAULT_THRESHOLD;
  const demoMode = getDemoMode();

  // Officer check for showing the edit form
  const { data: { user } } = await supabaseServer().auth.getUser();
  const editable = user ? await isOfficer(user.id) : false;

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

  // #92 family-aware 60/90/lifetime RA% (from the SQL view).
  const familyMetrics = await loadFamilyMetrics();

  // Roster-by-class headcount — pulled from characters.rank (Raid Pack /
  // Officer / Pack Leader / Recruit), NOT from attendance. Attendance
  // belongs to the cohort sections below; the class summary answers
  // "do we have enough of each class on the team to fill a 60-man raid".
  // Raid Alt rank chars are placeholders — excluded.
  const rosterByClass = new Map<string, number>();
  for (const c of data.chars) {
    if (!c.active || !c.class || c.class === 'UNKNOWN') continue;
    if (!c.rank || !ROSTER_RANKS.has(c.rank)) continue;
    rosterByClass.set(c.class, (rosterByClass.get(c.class) || 0) + 1);
  }

  // Build summary: target vs roster count. Delta = current - target so
  // negative means "down N from ideal" — matches the leader's spreadsheet
  // convention.
  const summaryRows: { cls: string; target: number; current: number; delta: number }[] = [];
  let totalTarget = 0, totalCurrent = 0;
  for (const cls of CLASS_ORDER) {
    const current = rosterByClass.get(cls) || 0;
    const target = targets[cls] ?? 0;
    totalTarget += target;
    totalCurrent += current;
    summaryRows.push({ cls, target, current, delta: current - target });
  }
  const flexTarget = targets[FLEX_CLASS] ?? 0;
  totalTarget += flexTarget;
  summaryRows.push({ cls: FLEX_CLASS, target: flexTarget, current: 0, delta: 0 - flexTarget });

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
          <b>Class summary</b> compares the 60-man target against the
          current roster headcount per class. Headcount is pulled from
          <code className="ml-1">characters.rank</code> (Raid Pack / Officer
          / Pack Leader / Recruit — Raid Alts are excluded as DKP-tracker
          placeholders). <b>Delta = current − target</b>: negative means
          down N from ideal, positive means surplus.{' '}
          <b>Attendance grid</b> below shows every roster character with
          their last-30d attendance rate over{' '}
          {data.raids.filter(r => r.ts >= data.since30).length} raids; the
          {pct(threshold)} threshold drives the new / downturn highlights.
          Targets are tunable via{' '}
          <code>?targets=Bard=8,Cleric=8,...</code>.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Target (60-man)" value={totalTarget} />
          <Stat label="Current roster"  value={totalCurrent} color="text-text" />
          <Stat label="Delta" value={totalCurrent - totalTarget} color={(totalCurrent - totalTarget) < 0 ? 'text-orange' : 'text-green'} />
          <Stat label="🆕 New attendees" value={newAttendees.length} color="text-yellow-400" />
        </div>
      </section>

      {/* Class summary */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <span>Class summary — {raidSize} target vs current roster headcount (Raid Pack / Officer / Pack Leader / Recruit)</span>
          {isOverriding && (
            <span className="text-blue text-[10px]">
              ⚠️ Showing URL override targets, not saved values.
              <Link href="/admin/attendance" className="ml-1 underline">Reset</Link>
            </span>
          )}
        </h3>
        <form action={saveTargets}>
          <input type="hidden" name="raid_size" value={raidSize} />
          <table className="w-full text-xs">
            <thead className="text-dim">
              <tr className="border-b border-border">
                <th className="text-right px-3 py-2 font-normal">{raidSize}</th>
                <th className="text-right px-3 py-2 font-normal">Current</th>
                <th className="text-left  px-3 py-2 font-normal">Class</th>
                <th className="text-right px-3 py-2 font-normal">Delta</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(row => (
                <tr key={row.cls} className="border-b border-border/40 hover:bg-[#1a212c]">
                  <td className="px-2 py-1 text-right">
                    {editable && !isOverriding ? (
                      <input
                        type="number"
                        name={`target_${row.cls}`}
                        defaultValue={row.target}
                        min={0}
                        max={99}
                        className="w-14 bg-bg border border-border rounded px-1 py-0.5 text-right text-text"
                      />
                    ) : (
                      <span className="text-text">{row.target}</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right ${row.current >= row.target ? 'text-green' : 'text-text'}`}>{row.current}</td>
                  <td className="px-3 py-2 text-text">{row.cls}</td>
                  <td className={`px-3 py-2 text-right ${row.delta < 0 ? 'text-orange' : row.delta > 0 ? 'text-green' : 'text-dim'}`}>
                    {row.delta > 0 ? `+${row.delta}` : row.delta}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-border">
                <td className="px-3 py-2 text-right text-text font-bold">{totalTarget}</td>
                <td className="px-3 py-2 text-right text-text font-bold">{totalCurrent}</td>
                <td className="px-3 py-2 text-dim">Total</td>
                <td className={`px-3 py-2 text-right font-bold ${(totalCurrent - totalTarget) < 0 ? 'text-orange' : 'text-green'}`}>
                  {(totalCurrent - totalTarget) > 0 ? `+${totalCurrent - totalTarget}` : (totalCurrent - totalTarget)}
                </td>
              </tr>
            </tbody>
          </table>
          {editable && !isOverriding && (
            <div className="px-4 py-3 border-t border-border flex items-center gap-2 text-xs">
              <button type="submit" className="px-3 py-1 rounded border border-blue bg-[#1f6feb] text-white">
                Save targets
              </button>
              <span className="text-dim">Persists for everyone. Total updates on save.</span>
            </div>
          )}
          {!editable && (
            <div className="px-4 py-2 text-[10px] text-dim border-t border-border">
              Targets are officer-editable.
            </div>
          )}
        </form>
      </section>

      {/* #92 Family-aware attendance metrics — 60d / 90d / lifetime RA% + tick
          counts, rolled up main+alts. This is the number the rules half of the
          queue (seating priority, tiebreaks, review cards) reads. */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <span>Family RA% — 60d / 90d / lifetime (main + alts rolled up)</span>
          <span className="text-[10px] text-dim">
            tick-based · {familyMetrics[0]?.ticks_90d ?? 0} ticks held (90d) · source for #80 review cards
          </span>
        </h3>
        <div className="px-4 py-2 text-[10px] text-dim">
          RA% is tick-based (matches OpenDKP&apos;s &quot;30 Day (52/52)&quot;).
          Attendance counts once per family — a main and its alts collapse into
          one row (<code>member_attendance_metrics</code> view). Sorted by 90d RA%.
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-dim">
              <tr className="border-b border-border">
                <th className="text-left  px-3 py-2 font-normal">Main</th>
                <th className="text-left  px-3 py-2 font-normal">Class</th>
                <th className="text-right px-3 py-2 font-normal">60d RA%</th>
                <th className="text-right px-3 py-2 font-normal">90d RA%</th>
                <th className="text-right px-3 py-2 font-normal">Lifetime RA%</th>
                <th className="text-right px-3 py-2 font-normal">Ticks (life)</th>
              </tr>
            </thead>
            <tbody>
              {familyMetrics.map(m => (
                <tr key={m.main_name} className="border-b border-border/40 hover:bg-[#1a212c]">
                  <td className="px-3 py-1">
                    <Link href={`/character/${encodeURIComponent(m.main_name)}`} className="text-text hover:underline">
                      {maybeFake(demoMode, m.main_name, m.main_class || '')}
                    </Link>
                  </td>
                  <td className="px-3 py-1 text-dim">{m.main_class}</td>
                  <td className={`px-3 py-1 text-right ${raColor(m.ra_60d, threshold)}`} title={`${m.att_ticks_60d}/${m.ticks_60d} ticks`}>
                    {raPct(m.ra_60d)}
                  </td>
                  <td className={`px-3 py-1 text-right ${raColor(m.ra_90d, threshold)}`} title={`${m.att_ticks_90d}/${m.ticks_90d} ticks`}>
                    {raPct(m.ra_90d)}
                  </td>
                  <td className={`px-3 py-1 text-right ${raColor(m.ra_lifetime, threshold)}`} title={`${m.att_ticks_lifetime}/${m.ticks_lifetime} ticks`}>
                    {raPct(m.ra_lifetime)}
                  </td>
                  <td className="px-3 py-1 text-right text-dim">{Number(m.att_ticks_lifetime).toLocaleString()}</td>
                </tr>
              ))}
              {familyMetrics.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-3 text-dim">No family metrics yet — the view needs OpenDKP ticks + characters mapped.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Class roster grid — color-coded per spreadsheet conventions */}
      <section className="bg-panel border border-border rounded-lg">
        <h3 className="text-sm text-orange px-4 py-3 border-b border-border">
          Active roster by class
        </h3>
        <div className="px-4 py-3 text-[10px] text-dim flex flex-wrap gap-3">
          <span><span className="inline-block w-3 h-3 align-middle mr-1" style={{background:'#3f3f24'}}/> 🆕 new (first tick ≤ 60d ago)</span>
          <span><span className="inline-block w-3 h-3 align-middle mr-1" style={{background:'#4a1f3f'}}/> 📉 downturn (baseline ≥ {pct(threshold)}, recent &lt; {pct(threshold * 0.7)})</span>
          <span><span className="inline-block w-3 h-3 align-middle mr-1 bg-bg border border-border"/> ≥ {pct(threshold)} regular</span>
          <span><span className="inline-block w-3 h-3 align-middle mr-1" style={{background:'#2a2a2a'}}/> &lt; {pct(threshold)} (faded — on roster but inactive)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead className="text-dim">
              <tr className="border-b border-border">
                {CLASS_ORDER.map(cls => (
                  <th key={cls} className="text-left px-2 py-2 font-normal align-bottom min-w-[110px]">
                    {cls}
                    <div className="text-[10px] text-dim">
                      {(byClass.get(cls) || []).length} on roster
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Render every on-roster character (no attendance gate).
                  Sorted by rate30 desc inside computeAttendance so the
                  regulars surface first per column. */}
              {(() => {
                const cols = CLASS_ORDER.map(cls => (byClass.get(cls) || []));
                const maxLen = Math.max(0, ...cols.map(c => c.length));
                const rowsOut: React.ReactNode[] = [];
                for (let i = 0; i < maxLen; i++) {
                  rowsOut.push(
                    <tr key={i}>
                      {cols.map((list, j) => {
                        const r = list[i];
                        if (!r) return <td key={j} className="px-2 py-1" />;
                        const c = classify(r, threshold, data.since60);
                        const inactive = r.rate30 < threshold;
                        let bg = '';
                        if (c.isDownturn) bg = '#4a1f3f';
                        else if (c.isNew && c.isRegular) bg = '#3f3f24';
                        else if (inactive) bg = '#2a2a2a';
                        const title = `${pct(r.rate30)} last 30d · ${pct(r.ratePrior)} prior 30d · first seen ${r.firstSeen ? r.firstSeen.slice(0, 10) : 'unknown'}`;
                        return (
                          <td key={j} className="px-2 py-1" style={bg ? { background: bg } : undefined} title={title}>
                            <Link href={`/character/${encodeURIComponent(r.name)}`} className={`hover:underline ${inactive && !c.isDownturn ? 'text-dim' : 'text-text'}`}>
                              {maybeFake(demoMode, r.name, r.className)}
                            </Link>
                            <div className={`text-[10px] ${inactive ? 'text-dim' : 'text-text'}`}>{pct(r.rate30)}</div>
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
