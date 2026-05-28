// Raid parse history — server component. Reads encounters via service_role
// so the page is consistent regardless of the viewer's RLS scope. Encounter
// data is not sensitive within the guild; sealed bids etc. live elsewhere.
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type NpcRef         = { id: number; name: string; zone_short: string | null };
type PlayerRow      = { character_name: string; total_damage: number; dps: number; rank: number | null };
type EncounterRow = {
  id: string;
  started_at: string;
  duration_sec: number | null;
  total_damage: number;
  total_dps: number;
  zone_short: string | null;
  eqemu_npc_types: NpcRef | null;
  encounter_players: PlayerRow[];
};
type ZoneRow = { short_name: string; long_name: string; expansion: number | null };

const ROW_LIMIT = 250;

async function loadRecentParses(): Promise<{
  rows: EncounterRow[];
  zones: Map<string, ZoneRow>;
  error: string | null;
}> {
  try {
    const sb = supabaseAdmin();

    // Encounters with any merged damage at all. 0-damage rows show up when the
    // boss kill broadcast lands before any contribution is ingested (or when
    // the contribution merge errors silently). The user asked us to hide them.
    const { data: encs, error: encErr } = await sb
      .from('encounters')
      .select(`
        id, started_at, duration_sec, total_damage, total_dps, zone_short,
        eqemu_npc_types ( id, name, zone_short ),
        encounter_players ( character_name, total_damage, dps, rank )
      `)
      .gt('total_damage', 0)
      .order('started_at', { ascending: false })
      .limit(ROW_LIMIT);
    if (encErr) return { rows: [], zones: new Map(), error: encErr.message };

    // Zone catalog for pretty long_name display ("Ssra Temple" vs "ssratemple").
    const { data: zoneRows } = await sb
      .from('eqemu_zone')
      .select('short_name, long_name, expansion');
    const zones = new Map<string, ZoneRow>(
      (zoneRows ?? []).map((z: ZoneRow) => [z.short_name, z]),
    );

    return { rows: (encs as unknown as EncounterRow[]) ?? [], zones, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rows: [], zones: new Map(), error: msg };
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtDmg(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(sec: number | null) {
  if (sec == null) return '—';
  if (sec < 60)    return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// Day bucket used for grouping cards into raid-night sections. Uses the
// viewer's locale rather than America/New_York — close enough until we
// surface a tz toggle.
function dayKey(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD, locale-stable
}

function dayLabel(key: string) {
  const today    = new Date();
  const todayKey = today.toLocaleDateString('en-CA');
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toLocaleDateString('en-CA');

  if (key === todayKey)     return 'Tonight';
  if (key === yesterdayKey) return 'Yesterday';
  return new Date(key + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function resolveZone(enc: EncounterRow, zones: Map<string, ZoneRow>) {
  const short = enc.zone_short || enc.eqemu_npc_types?.zone_short || null;
  const long  = short ? zones.get(short)?.long_name : null;
  return { short, long: long || short || 'Unknown zone' };
}

// ── Grouping ──────────────────────────────────────────────────────────────────
//
// Two-level: dayKey → zoneKey → encounters[]. Insertion order is preserved
// because `loadRecentParses` already ordered by started_at desc.

type ZoneBucket = { label: string; encounters: EncounterRow[] };
type DayBucket  = { label: string; zones: Map<string, ZoneBucket> };

function bucket(rows: EncounterRow[], zones: Map<string, ZoneRow>) {
  const days = new Map<string, DayBucket>();
  for (const enc of rows) {
    const dKey = dayKey(enc.started_at);
    if (!days.has(dKey)) days.set(dKey, { label: dayLabel(dKey), zones: new Map() });
    const day = days.get(dKey)!;
    const { short, long } = resolveZone(enc, zones);
    const zKey = short || '__unknown__';
    if (!day.zones.has(zKey)) day.zones.set(zKey, { label: long, encounters: [] });
    day.zones.get(zKey)!.encounters.push(enc);
  }
  return days;
}

// ── UI ────────────────────────────────────────────────────────────────────────

export default async function ParsesPage() {
  const { rows, zones, error } = await loadRecentParses();
  const days = bucket(rows, zones);

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📊 Boss Kills</h2>
        <p className="text-sm text-dim">
          Last {ROW_LIMIT} merged encounters, grouped by raid night and zone.
          Damage shown is the max-per-player merge across all parser uploads
          for the same kill. Send <code>/parse</code> in Discord or run the
          local agent to add more data — old kills will refresh automatically
          when new contributions come in.
        </p>
      </section>

      {error && (
        <section className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
          Error: {error}
        </section>
      )}

      {!error && rows.length === 0 && (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No encounters with damage recorded yet. Run <code>/parse</code> in Discord
          after a kill, or make sure the wolfpack-logsync agent is running.
        </section>
      )}

      {[...days.entries()].map(([dKey, day]) => (
        <section key={dKey} className="space-y-4">
          <h3 className="text-lg text-blue border-b border-border pb-1">
            {day.label} <span className="text-dim text-xs">— {dKey}</span>
          </h3>

          {[...day.zones.entries()].map(([zKey, zone]) => (
            <div key={zKey} className="space-y-2">
              <h4 className="text-sm text-orange flex items-center gap-2">
                <span aria-hidden>📍</span>
                <span>{zone.label}</span>
                <span className="text-dim text-xs">
                  · {zone.encounters.length} kill{zone.encounters.length === 1 ? '' : 's'}
                </span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {zone.encounters.map((enc) => (
                  <KillCard key={enc.id} enc={enc} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function KillCard({ enc }: { enc: EncounterRow }) {
  const bossName = enc.eqemu_npc_types?.name ?? 'Unknown boss';
  const players  = [...(enc.encounter_players ?? [])]
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const top5     = players.slice(0, 5);
  const extra    = players.length - top5.length;

  return (
    <div className="bg-panel border border-border rounded-lg p-3 hover:border-blue transition-colors">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="text-gold text-sm font-medium truncate" title={bossName}>
          {bossName}
        </div>
        <div className="text-dim text-xs whitespace-nowrap">
          {fmtTime(enc.started_at)}
        </div>
      </div>

      <div className="text-xs text-dim mb-2 flex gap-3">
        <span>{fmtDuration(enc.duration_sec)}</span>
        <span className="text-text">{fmtDmg(enc.total_damage)}</span>
        <span>{enc.total_dps ? `${fmtDmg(enc.total_dps)}/s` : '—'}</span>
        <span className="ml-auto">
          {players.length} player{players.length === 1 ? '' : 's'}
        </span>
      </div>

      {top5.length > 0 ? (
        <ol className="text-xs space-y-0.5">
          {top5.map((p, i) => (
            <li key={p.character_name} className="flex justify-between gap-2">
              <span className="truncate">
                <span className="text-dim mr-1">{i + 1}.</span>
                <span className="text-text">{p.character_name}</span>
              </span>
              <span className="text-dim whitespace-nowrap">
                {fmtDmg(p.total_damage)}
                {p.dps ? <span className="opacity-50"> · {fmtDmg(p.dps)}/s</span> : null}
              </span>
            </li>
          ))}
          {extra > 0 && (
            <li className="text-dim italic">+{extra} more</li>
          )}
        </ol>
      ) : (
        <div className="text-xs text-dim italic">no contributions yet</div>
      )}
    </div>
  );
}
