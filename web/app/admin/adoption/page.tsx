// /admin/adoption — the product-health page (Hitya 2026-08-18: "if you were a
// product manager justifying our product and showing new user acquisition or
// new raider adoption (those are varied) and what other stats would you
// present to your execs?").
//
// Everything counts PLAYERS (distinct discord ids), never characters — the
// standing rule. Three funnels, kept separate on purpose:
//   conversion  — existing raiders who start contributing;
//   new-raider  — joined the guild and adopted during onboarding (joined_at
//                 within 60 days of first upload);
//   coverage    — how corroborated each raid night's fights are.
// The math lives in web/lib/adoption.ts (pure, test/adoption.test.js); reads
// come off two tiny views (adoption_uploader_days, encounter_upload_counts)
// so this page never drags the contributions table through PostgREST.
//
// The page also says what it CANNOT measure yet (sessions/hours, the
// install→first-upload funnel, per-overlay feature usage) — a metrics page
// that hides its blind spots reads as coverage, same trap as an enabled
// trigger.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import {
  weeklyActive, activations, activationsByMonth, retention,
  corroborationByNight, versionSpread, conversionTargets, displayName,
  type UploaderDay, type MemberRow, type EncounterCountRow, type StatRow,
  type CharLink,
} from '@/lib/adoption';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Adoption — Admin' };

export default async function AdminAdoptionPage() {
  const admin = supabaseAdmin();

  const [dayRows, encRows, memberRows, statRows, charRows] = await Promise.all([
    selectAll<UploaderDay>((from, to) => admin
      .from('adoption_uploader_days')
      .select('discord_id, day, uploads')
      .order('day').order('discord_id')
      .range(from, to)),
    selectAll<EncounterCountRow>((from, to) => admin
      .from('encounter_upload_counts')
      .select('encounter_id, started_at, classification, uploaders')
      .gte('started_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order('started_at').order('encounter_id')
      .range(from, to)),
    selectAll<MemberRow>((from, to) => admin
      .from('wolfpack_members')
      .select('discord_id, nickname, global_name, joined_at')
      .order('discord_id')
      .range(from, to)),
    selectAll<StatRow>((from, to) => admin
      .from('agent_upload_stats')
      .select('uploaded_by_discord_id, agent_version, last_uploaded_at')
      .order('character').order('endpoint')
      .range(from, to)),
    selectAll<CharLink>((from, to) => admin
      .from('characters')
      .select('name, main_name, discord_id')
      .eq('guild_id', 'wolfpack')
      .order('name')
      .range(from, to)),
  ]);

  // Tick attendees, last 30 days — the coverage denominator + target list.
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: raidRows } = await admin
    .from('opendkp_raids').select('raid_id, ts').gte('ts', since30).limit(1000);
  let attendees: string[] = [];
  if (raidRows?.length) {
    const ticks = await selectAll<{ raid_id: number; attendees: string[] }>((from, to) => admin
      .from('opendkp_ticks')
      .select('raid_id, attendees')
      .in('raid_id', raidRows.map(r => r.raid_id))
      .order('raid_id')
      .range(from, to));
    attendees = [...new Set(ticks.flatMap(t => Array.isArray(t.attendees) ? t.attendees : []))];
  }

  const members = new Map(memberRows.map(m => [m.discord_id, m]));
  const weeks = weeklyActive(dayRows, 12);
  const acts = activations(dayRows, members);
  const months = activationsByMonth(acts).slice(-6);
  const ret = retention(dayRows);
  const nights = corroborationByNight(encRows, 6);
  const spread = versionSpread(statRows).slice(0, 6);
  const uploaderIds = new Set(acts.map(a => a.discordId));
  const { targets, unlinked } = conversionTargets(attendees, charRows, uploaderIds);

  const wau = weeks.filter(w => !w.partial).slice(-1)[0]?.players ?? 0;
  const maxWeek = Math.max(1, ...weeks.map(w => w.players));
  const recentActs = acts.slice(-5).reverse();

  const name = (id: string) => displayName(members.get(id), id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl text-gold">📈 Adoption</h1>
        <p className="text-sm text-dim mt-1 max-w-3xl">
          Product health in <b className="text-text">players</b> (distinct Discord accounts — never characters).
          Three separate funnels: existing raiders converting, new raiders adopting during onboarding,
          and how corroborated each raid night&apos;s data actually is.
        </p>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Weekly active contributors', value: String(wau), sub: 'last full week' },
          { label: '4-week retention', value: ret.pct === null ? '—' : `${ret.pct}%`, sub: `${ret.retained} of ${ret.eligible} still active` },
          { label: 'Activated all-time', value: String(acts.length), sub: 'players who ever uploaded' },
          { label: 'Raided, never uploaded', value: String(targets.length), sub: 'last 30d — the conversion list' },
        ].map(t => (
          <div key={t.label} className="bg-panel border border-border rounded-lg p-4">
            <div className="text-2xl text-text font-semibold">{t.value}</div>
            <div className="text-xs text-dim mt-1">{t.label}</div>
            <div className="text-[10px] text-dim/70">{t.sub}</div>
          </div>
        ))}
      </div>

      {/* Weekly actives */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-sm text-blue mb-3">Weekly active contributors <span className="text-dim text-xs">· 12 weeks · current week is partial, not a decline</span></h2>
        <div className="flex items-end gap-1 h-28">
          {weeks.map(w => (
            <div key={w.weekStart} className="flex-1 flex flex-col items-center gap-1" title={`Week of ${w.weekStart}: ${w.players} player${w.players === 1 ? '' : 's'}${w.partial ? ' (partial week)' : ''}`}>
              <span className="text-[10px] text-dim">{w.players || ''}</span>
              <div
                className={`w-full rounded-t ${w.partial ? 'bg-blue/40 border border-dashed border-blue/60' : 'bg-blue'}`}
                style={{ height: `${Math.max(3, (w.players / maxWeek) * 88)}px` }}
              />
              <span className="text-[9px] text-dim rotate-0">{w.weekStart.slice(5)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Activations by month, split by funnel */}
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-blue mb-2">New activations <span className="text-dim text-xs">· first-ever upload · new raider = joined ≤60d before it</span></h2>
          <table className="w-full text-xs">
            <thead className="text-dim text-left"><tr className="border-b border-border">
              <th className="py-1">Month</th><th className="py-1 text-right">Total</th>
              <th className="py-1 text-right">New raiders</th><th className="py-1 text-right">Converted vets</th>
            </tr></thead>
            <tbody>
              {months.map(m => (
                <tr key={m.month} className="border-b border-border/30">
                  <td className="py-1 text-text">{m.month}</td>
                  <td className="py-1 text-right text-text">{m.total}</td>
                  <td className="py-1 text-right text-green">{m.new_raider}</td>
                  <td className="py-1 text-right text-blue">{m.converted}{m.unknown ? <span className="text-dim"> +{m.unknown}?</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[11px] text-dim mt-2">
            Latest: {recentActs.length ? recentActs.map(a => name(a.discordId)).join(', ') : '—'}
          </div>
        </section>

        {/* Raid-night corroboration */}
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-blue mb-2">Raid-night corroboration <span className="text-dim text-xs">· raid-window fights only — off-night solo grinding excluded</span></h2>
          <table className="w-full text-xs">
            <thead className="text-dim text-left"><tr className="border-b border-border">
              <th className="py-1">Night</th><th className="py-1 text-right">Fights</th>
              <th className="py-1 text-right">Avg uploaders</th><th className="py-1 text-right">≥3 uploads</th>
            </tr></thead>
            <tbody>
              {nights.map(n => (
                <tr key={n.night} className="border-b border-border/30">
                  <td className="py-1 text-text">{n.night}</td>
                  <td className="py-1 text-right text-text">{n.fights}</td>
                  <td className="py-1 text-right text-text">{n.avgUploaders}</td>
                  <td className="py-1 text-right"><span className={n.pct3plus >= 60 ? 'text-green' : 'text-orange'}>{n.pct3plus}%</span></td>
                </tr>
              ))}
              {nights.length === 0 && <tr><td colSpan={4} className="py-2 text-dim italic">No raid-window fights in the last 30 days.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* Version spread */}
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-blue mb-2">Fleet version <span className="text-dim text-xs">· each player at their latest upload&apos;s version</span></h2>
          <ul className="text-xs space-y-1">
            {spread.map(v => (
              <li key={v.version} className="flex justify-between">
                <span className="text-text">v{v.version}</span>
                <span className="text-dim">{v.players} player{v.players === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Conversion targets + churn */}
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-blue mb-2">The work list</h2>
          <div className="text-xs space-y-2">
            <div>
              <span className="text-[10px] text-dim uppercase tracking-wide">Raided last 30d, never uploaded ({targets.length})</span>
              <div className="text-text mt-0.5">{targets.length ? targets.map(name).join(', ') : 'Nobody — full conversion 🎉'}</div>
            </div>
            {ret.churned.length > 0 && (
              <div>
                <span className="text-[10px] text-dim uppercase tracking-wide">Went quiet (used to upload, nothing in 14d)</span>
                <div className="text-text mt-0.5">{ret.churned.map(name).join(', ')}</div>
              </div>
            )}
            {unlinked.length > 0 && (
              <div>
                <span className="text-[10px] text-dim uppercase tracking-wide">Attendees with no Discord link — invisible to these numbers</span>
                <div className="text-dim mt-0.5">{unlinked.slice(0, 20).join(', ')}{unlinked.length > 20 ? ` …+${unlinked.length - 20}` : ''} · link on <Link href="/admin/links" className="text-blue hover:underline">/admin/links</Link></div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Blind spots — deliberately visible */}
      <section className="bg-panel border border-border/60 rounded-lg p-4">
        <h2 className="text-sm text-orange mb-2">What this page cannot see yet</h2>
        <ul className="text-xs text-dim list-disc ml-4 space-y-1">
          <li><b className="text-text">Hours &amp; sessions</b> — heartbeats aren&apos;t persisted as a time series (a deliberate storage decision), so stickiness and in-raid hours are unmeasurable until a small per-day session roll-up lands.</li>
          <li><b className="text-text">The install funnel</b> — we see the first upload, never the install, so onboarding drop-off is invisible without a first-boot ping (privacy call: guild lead&apos;s).</li>
          <li><b className="text-text">Feature usage</b> — which overlays each player actually runs (CH chain, buff queue, rolls) is unobserved; trigger fires are the only per-feature signal today.</li>
        </ul>
      </section>
    </div>
  );
}
