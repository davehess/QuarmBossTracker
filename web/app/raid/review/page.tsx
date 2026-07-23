// /raid/review — the morning-after Raid Night Review index (#80).
//
// The guild's ask: "review at 9am, not 11:30pm." One page you open the morning
// after and see, per night, what happened — this is the landing list of recent
// raid nights (newest first); each links to /raid/review/[date] for the full
// one-night breakdown. Member-gated like /parses (the WHOLE raid reviews it, not
// just officers): a signed-in Supabase session means the user passed the guild +
// role checks at sign-in.
//
// Read-only v1: single bounded window, no mutations. Nights are the Eastern
// raid-day buckets that /parses already uses, so the two pages agree on which
// kill belongs to which night (and the loot join keys on the same ET date).

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { dayKey, dayLabel, fmtDmg, cleanBossName } from '@/lib/format';
import { guildShare, isAutoForeign } from '@/lib/anomalies';
import { resolveWindow } from '@/lib/timeWindow';
import WindowPicker from '@/components/WindowPicker';

export const dynamic = 'force-dynamic';

type PlayerRow = { character_name: string; total_damage: number };
type EncRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
  total_damage: number;
  zone_short: string | null;
  classification: string | null;
  eqemu_npc_types: { name: string; zone_short: string | null } | null;
  encounter_players: PlayerRow[];
};
type ZoneRow = { short_name: string; long_name: string };

type NightRow = {
  date: string;
  kills: number;
  wipes: number;
  totalDamage: number;
  zones: string[];
  bosses: string[];
  lootCount: number;
  lootDkp: number;
};

const ROW_LIMIT = 400;

async function loadNights(sinceIso: string | null): Promise<{ nights: NightRow[]; error: string | null }> {
  try {
    const sb = supabaseAdmin();

    let encQuery = sb
      .from('encounters')
      .select(`
        id, started_at, ended_at, duration_sec, total_damage, zone_short, classification,
        eqemu_npc_types ( name, zone_short ),
        encounter_players ( character_name, total_damage )
      `)
      .gt('total_damage', 0)
      .order('started_at', { ascending: false })
      .limit(ROW_LIMIT);
    if (sinceIso) encQuery = encQuery.gte('started_at', sinceIso);
    const { data: encs, error: encErr } = await encQuery;
    if (encErr) return { nights: [], error: encErr.message };

    const { data: rosterRows } = await sb
      .from('characters')
      .select('name')
      .eq('guild_id', 'wolfpack');
    const roster = new Set<string>(
      (rosterRows ?? []).map((r: { name: string }) => (r.name || '').toLowerCase()).filter(Boolean),
    );

    const { data: zoneRows } = await sb
      .from('eqemu_zone')
      .select('short_name, long_name');
    const zones = new Map<string, ZoneRow>((zoneRows ?? []).map((z: ZoneRow) => [z.short_name, z]));

    // Per-night loot rollup from OpenDKP (keyed on the same ET raid_date).
    const since10 = (sinceIso ?? '1970-01-01').slice(0, 10);
    let lootQuery = sb
      .from('opendkp_loot_recent')
      .select('raid_date, dkp');
    if (sinceIso) lootQuery = lootQuery.gte('raid_date', since10);
    const { data: lootRows } = await lootQuery;
    const lootByDate = new Map<string, { count: number; dkp: number }>();
    for (const l of (lootRows ?? []) as { raid_date: string; dkp: number }[]) {
      const e = lootByDate.get(l.raid_date) || { count: 0, dkp: 0 };
      e.count += 1;
      e.dkp += l.dkp || 0;
      lootByDate.set(l.raid_date, e);
    }

    // Bucket encounters into Eastern raid-day nights, dropping foreign raids
    // (a guildie pugging another guild) exactly like /parses does.
    const byNight = new Map<string, {
      kills: number; wipes: number; totalDamage: number;
      zones: Set<string>; bosses: Map<string, number>;
    }>();
    for (const enc of (encs as unknown as EncRow[]) ?? []) {
      if (enc.classification === 'foreign') continue;
      if (enc.classification == null && isAutoForeign(guildShare(enc.encounter_players ?? [], roster))) continue;
      const k = dayKey(enc.started_at);
      let night = byNight.get(k);
      if (!night) { night = { kills: 0, wipes: 0, totalDamage: 0, zones: new Set(), bosses: new Map() }; byNight.set(k, night); }
      const isKill = !enc.classification && enc.ended_at != null;
      if (isKill) {
        night.kills += 1;
        night.totalDamage += enc.total_damage || 0;
        const boss = cleanBossName(enc.eqemu_npc_types?.name);
        night.bosses.set(boss, (night.bosses.get(boss) || 0) + 1);
      } else if (enc.classification === 'wipe' || enc.ended_at == null) {
        night.wipes += 1;
      }
      const short = enc.zone_short || enc.eqemu_npc_types?.zone_short || null;
      if (short) night.zones.add(zones.get(short)?.long_name || short);
    }

    const nights: NightRow[] = [...byNight.entries()]
      .map(([date, n]) => {
        const loot = lootByDate.get(date);
        return {
          date,
          kills: n.kills,
          wipes: n.wipes,
          totalDamage: n.totalDamage,
          zones: [...n.zones],
          bosses: [...n.bosses.keys()],
          lootCount: loot?.count ?? 0,
          lootDkp: loot?.dkp ?? 0,
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    return { nights, error: null };
  } catch (err: unknown) {
    return { nights: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function RaidReviewIndex(
  { searchParams }: { searchParams: Promise<{ w?: string }> },
) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/raid/review');

  const { w: wParam } = await searchParams;
  const w = resolveWindow(wParam, '60d');
  const { nights, error } = await loadNights(w.sinceIso);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl text-gold">📓 Raid Night Review</h1>
          <p className="text-sm text-dim mt-1">
            The morning-after read: pick a night to see the kills, deaths, slows, callouts, and loot —
            without scrolling Discord.
          </p>
        </div>
        <Link href="/raid" className="text-xs text-blue hover:underline">← live Raid view</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-dim">Recent raid nights</span>
          <WindowPicker page="raidreview" current={w.key} options={['30d', '60d', '90d', 'life']} />
        </div>
      </section>

      {error && (
        <section className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
          Error: {error}
        </section>
      )}

      {!error && nights.length === 0 && (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No raid nights with recorded kills in this window. Widen the window, or make sure the
          wolfpack-logsync agent is running on raid night so encounters get uploaded.
        </section>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {nights.map((n) => (
          <Link
            key={n.date}
            href={`/raid/review/${n.date}`}
            className="block bg-panel border border-border rounded-lg p-4 no-underline hover:border-blue hover:bg-[#1a212c] transition-colors"
          >
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <span className="text-gold text-sm font-medium">{dayLabel(n.date)}</span>
              <span className="text-dim text-xs">{n.date}</span>
            </div>
            <div className="text-xs text-dim flex flex-wrap gap-x-3 gap-y-1 mb-2">
              <span className="text-text">{n.kills} kill{n.kills === 1 ? '' : 's'}</span>
              {n.wipes > 0 && <span className="text-orange">{n.wipes} wipe/engage</span>}
              <span>{fmtDmg(n.totalDamage)}</span>
              {n.lootCount > 0 && <span className="text-gold">{n.lootCount} loot · {n.lootDkp} DKP</span>}
            </div>
            {n.zones.length > 0 && (
              <div className="text-[11px] text-orange truncate" title={n.zones.join(', ')}>
                📍 {n.zones.slice(0, 3).join(' · ')}{n.zones.length > 3 ? ` +${n.zones.length - 3}` : ''}
              </div>
            )}
            {n.bosses.length > 0 && (
              <div className="text-[11px] text-dim mt-1 line-clamp-2" title={n.bosses.join(', ')}>
                {n.bosses.slice(0, 6).join(', ')}{n.bosses.length > 6 ? `, +${n.bosses.length - 6} more` : ''}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
