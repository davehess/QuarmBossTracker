// /admin/anomalies — officer review of two raid data-quality problems:
//
//  1. FOREIGN RAIDS — a Wolf Pack member pugging ANOTHER guild's raid uploads
//     the fight via their agent, so it lands on our parses even though almost
//     no one in it is a Pack member (Uilnayar 2026-06-29: "Ikibob attended a
//     morning Kael raid with a different guild and it all showed up").
//     Encounters with <1/3 roster members (10+ raid) are already auto-hidden
//     from /parses; this page surfaces the whole majority-non-member band so an
//     officer can Mark Non-Guild (permanent) or Clear (it really was ours).
//
//  2. DOUBLE-BOXING — one person's two characters BOTH dealing damage in the
//     same fight (both actively swinging, not one parked). Surfaced for review;
//     not auto-actioned.
//
// Auth + officer gate handled by /admin/layout.tsx.
import { supabaseAdmin } from '@/lib/supabase';
import { userTz } from '@/lib/timezone';
import { fmtTime, dayKey, dayLabel, fmtDmg, cleanBossName } from '@/lib/format';
import { classifyEncounter, clearClassification } from '@/app/parses/actions';
import {
  guildShare, isReviewForeign,
  REVIEW_FOREIGN_MAX_MEMBER_FRAC, AUTO_FOREIGN_MAX_MEMBER_FRAC, AUTO_FOREIGN_MIN_PLAYERS,
  type EncPlayer,
} from '@/lib/anomalies';

export const dynamic = 'force-dynamic';

type Enc = {
  id: string;
  started_at: string;
  classification: string | null;
  total_damage: number;
  eqemu_npc_types: { name: string } | null;
  encounter_players: { character_name: string; total_damage: number }[];
};
type CharRow = { name: string; discord_id: string | null; main_name: string | null };

const LOOKBACK_DAYS = 21;
const ROW_LIMIT = 500;

// Family key for boxing: discord_id wins (the strongest "same person" signal),
// else the main-name chain, else the name itself. Lowercased.
function buildFamilyKey(chars: CharRow[]): Map<string, string> {
  const keyOf = new Map<string, string>();
  for (const c of chars) {
    if (!c.name) continue;
    const ln = c.name.toLowerCase();
    const key = c.discord_id ? `d:${c.discord_id}` : (c.main_name ? `m:${c.main_name.toLowerCase()}` : `n:${ln}`);
    keyOf.set(ln, key);
  }
  return keyOf;
}

async function load() {
  const sb = supabaseAdmin();
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString();
  const [{ data: encs }, { data: chars }] = await Promise.all([
    sb.from('encounters')
      .select(`id, started_at, classification, total_damage,
               eqemu_npc_types ( name ),
               encounter_players ( character_name, total_damage )`)
      .gt('total_damage', 0)
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: false })
      .limit(ROW_LIMIT),
    sb.from('characters').select('name, discord_id, main_name').eq('guild_id', 'wolfpack'),
  ]);
  return {
    encs: (encs as unknown as Enc[]) ?? [],
    chars: (chars as CharRow[]) ?? [],
  };
}

export default async function AnomaliesPage() {
  const { encs, chars } = await load();
  const tz = await userTz();
  const roster = new Set<string>(chars.map(c => (c.name || '').toLowerCase()).filter(Boolean));
  const familyKey = buildFamilyKey(chars);
  const familyDisplay = new Map<string, string>();
  for (const c of chars) {
    const ln = (c.name || '').toLowerCase();
    const k = familyKey.get(ln);
    if (k && !familyDisplay.has(k)) familyDisplay.set(k, c.main_name || c.name);
  }

  // ── Foreign raids ──────────────────────────────────────────────────────────
  const foreign = encs
    .map(e => ({ e, share: guildShare((e.encounter_players ?? []) as EncPlayer[], roster) }))
    .filter(({ e, share }) => e.classification === 'foreign' || isReviewForeign(share))
    .slice(0, 100);

  // ── Double-boxing — a family with 2+ characters both dealing damage ─────────
  type BoxHit = { e: Enc; family: string; chars: { name: string; dmg: number }[] };
  const boxing: BoxHit[] = [];
  for (const e of encs) {
    const byFam = new Map<string, { name: string; dmg: number }[]>();
    for (const p of (e.encounter_players ?? [])) {
      const ln = (p.character_name || '').toLowerCase();
      const k = familyKey.get(ln);
      if (!k) continue;                       // not a known guild character
      if (!(p.total_damage > 0)) continue;    // only ACTIVE (swinging) chars
      const arr = byFam.get(k) ?? [];
      arr.push({ name: p.character_name, dmg: p.total_damage });
      byFam.set(k, arr);
    }
    for (const [k, arr] of byFam) {
      if (arr.length >= 2) {
        boxing.push({ e, family: familyDisplay.get(k) || arr[0].name, chars: arr.sort((a, b) => b.dmg - a.dmg) });
      }
    }
  }
  boxing.sort((a, b) => +new Date(b.e.started_at) - +new Date(a.e.started_at));
  const boxingTop = boxing.slice(0, 80);

  const pct = (f: number) => `${Math.round(f * 100)}%`;

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-xl text-gold mb-2">🚩 Anomalies</h2>
        <p className="text-sm text-dim leading-6">
          Raid data-quality review. <b className="text-purple">Foreign raids</b> — a Pack member
          pugging another guild whose agent uploaded the fight — are auto-hidden from{' '}
          <code>/parses</code> when fewer than {pct(AUTO_FOREIGN_MAX_MEMBER_FRAC)} of a{' '}
          {AUTO_FOREIGN_MIN_PLAYERS}+ raid are on the roster. Everything in the majority-non-member
          band (&lt;{pct(REVIEW_FOREIGN_MAX_MEMBER_FRAC)} members) is listed below to confirm or clear.
        </p>
      </section>

      {/* Foreign raids */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-purple uppercase tracking-wide mb-3">
          Likely non-guild raids · {foreign.length}
        </h3>
        {foreign.length === 0 ? (
          <p className="text-xs text-dim italic">No majority-non-member raids in the last {LOOKBACK_DAYS} days.</p>
        ) : (
          <div className="space-y-2">
            {foreign.map(({ e, share }) => {
              const autoHidden = e.classification == null
                && share.players >= AUTO_FOREIGN_MIN_PLAYERS
                && share.memberFrac < AUTO_FOREIGN_MAX_MEMBER_FRAC;
              return (
                <div key={e.id} className="border border-border/60 rounded p-2.5 text-xs">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <a href={`/parses/${e.id}`} className="text-gold hover:text-blue truncate">
                      {cleanBossName(e.eqemu_npc_types?.name)}
                    </a>
                    <span className="text-dim whitespace-nowrap">
                      {dayLabel(dayKey(e.started_at, tz), tz)} · {fmtTime(e.started_at, tz)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className={share.memberFrac < AUTO_FOREIGN_MAX_MEMBER_FRAC ? 'text-red' : 'text-orange'}>
                      {share.members}/{share.players} on roster ({pct(share.memberFrac)})
                    </span>
                    {e.classification === 'foreign' && (
                      <span className="px-1 py-px rounded border border-purple/40 bg-purple/20 text-purple text-[9px] uppercase">marked non-guild</span>
                    )}
                    {autoHidden && (
                      <span className="px-1 py-px rounded border border-dim/40 bg-dim/10 text-dim text-[9px] uppercase" title="Below the auto-hide bar — already hidden from /parses">auto-hidden</span>
                    )}
                  </div>
                  {share.nonMembers.length > 0 && (
                    <div className="text-dim mb-1.5">
                      <span className="text-text">not on roster:</span>{' '}
                      {share.nonMembers.slice(0, 12).join(', ')}{share.nonMembers.length > 12 ? ` +${share.nonMembers.length - 12}` : ''}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <form action={classifyEncounter}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="classification" value="foreign" />
                      <button type="submit" disabled={e.classification === 'foreign'}
                        className="px-2 py-0.5 rounded text-[10px] border border-purple/50 text-purple disabled:opacity-100 disabled:font-semibold opacity-70 hover:opacity-100">
                        Mark Non-Guild
                      </button>
                    </form>
                    {e.classification && (
                      <form action={clearClassification}>
                        <input type="hidden" name="id" value={e.id} />
                        <button type="submit" title="It really was a Wolf Pack raid — clear the flag and show on /parses"
                          className="px-2 py-0.5 rounded text-[10px] border border-border text-text hover:bg-bg">
                          It&apos;s ours — clear
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Double-boxing */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-blue uppercase tracking-wide mb-1">
          Possible double-boxing · {boxingTop.length}
        </h3>
        <p className="text-[11px] text-dim mb-3">
          One person&apos;s characters BOTH dealing damage in the same fight (both swinging, not one
          parked). Often legit two-boxing — surfaced for awareness, not auto-actioned.
        </p>
        {boxingTop.length === 0 ? (
          <p className="text-xs text-dim italic">No two-character-active fights in the last {LOOKBACK_DAYS} days.</p>
        ) : (
          <div className="space-y-1.5">
            {boxingTop.map(({ e, family, chars: cs }, i) => (
              <div key={`${e.id}-${i}`} className="border border-border/50 rounded px-2.5 py-1.5 text-xs flex items-baseline justify-between gap-2">
                <span className="min-w-0">
                  <span className="text-text font-medium">{family}</span>
                  <span className="text-dim"> · </span>
                  {cs.map((c, j) => (
                    <span key={c.name}>
                      {j > 0 && <span className="text-dim"> + </span>}
                      <span className="text-blue">{c.name}</span>
                      <span className="text-dim"> {fmtDmg(c.dmg)}</span>
                    </span>
                  ))}
                </span>
                <a href={`/parses/${e.id}`} className="text-dim hover:text-blue whitespace-nowrap shrink-0">
                  {cleanBossName(e.eqemu_npc_types?.name)} · {fmtTime(e.started_at, tz)}
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
