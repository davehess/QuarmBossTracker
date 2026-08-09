// /admin/anomalies — officer review of two raid data-quality problems:
//
//  1. FOREIGN RAIDS — a Wolf Pack member pugging ANOTHER guild's raid uploads
//     the fight via their agent, so it lands on our parses even though almost
//     no one in it is a Pack member (Hitya 2026-06-29: "Ikibob attended a
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
  guildShare, isReviewForeign, startedInRaidWindow, OFFHOURS_MIN_PLAYERS,
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

// ── Off-hours queue loader ──────────────────────────────────────────────────
// Separate from load() on purpose: the officer asked for ALL of them, not the
// 21-day review window, so this runs over the platform's life. Two cheap
// queries instead of one fat one — the encounter list carries no players (that
// join is what makes the main query heavy), and players are fetched only for
// the handful that actually fall outside the window.
const OFFHOURS_SINCE = '2026-04-01T00:00:00Z';
const OFFHOURS_MAX = 150;

type OffEnc = {
  id: string; started_at: string; classification: string | null;
  npc_id: number | null; eqemu_npc_types: { name: string } | null;
};

async function loadOffHours() {
  const sb = supabaseAdmin();
  const { data: all } = await sb.from('encounters')
    .select('id, started_at, classification, npc_id, eqemu_npc_types ( name )')
    .gt('total_damage', 0)
    .gte('started_at', OFFHOURS_SINCE)
    .order('started_at', { ascending: false })
    .limit(4000);
  const encs = (all as unknown as OffEnc[]) ?? [];

  // Which mobs do we kill ON raid nights? A boss with a raid-night history that
  // turns up at 09:00 Saturday is the pug case; a boss the guild also clears
  // off-night with six people is not. Counted across every kill we have.
  const inWindowByNpc = new Map<number, number>();
  for (const e of encs) {
    if (e.npc_id == null || !startedInRaidWindow(e.started_at)) continue;
    inWindowByNpc.set(e.npc_id, (inWindowByNpc.get(e.npc_id) ?? 0) + 1);
  }

  const outside = encs.filter(e => !startedInRaidWindow(e.started_at));
  const ids = outside.slice(0, OFFHOURS_MAX * 3).map(e => e.id);
  const players = new Map<string, EncPlayer[]>();
  // Chunked: a very long `in` list is what turns a fast query into a timeout.
  for (let i = 0; i < ids.length; i += 60) {
    const { data } = await sb.from('encounter_players')
      .select('encounter_id, character_name, total_damage')
      .in('encounter_id', ids.slice(i, i + 60));
    for (const r of (data ?? []) as { encounter_id: string; character_name: string; total_damage: number }[]) {
      const arr = players.get(r.encounter_id) ?? [];
      arr.push({ character_name: r.character_name, total_damage: r.total_damage });
      players.set(r.encounter_id, arr);
    }
  }
  return { outside, players, inWindowByNpc };
}

export default async function AnomaliesPage() {
  const { encs, chars } = await load();
  const off = await loadOffHours();
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

  // ── Off-hours kills of raid-night mobs ─────────────────────────────────────
  // Ranked, not filtered: roster share decides suspicion, and "we kill this on
  // raid nights" raises it. The Va`Dyn at 83% roster sorts to the bottom; a
  // 40%-roster Vex Thal boss at 09:00 sorts to the top.
  const offHours = off.outside
    .map(e => {
      const share = guildShare(off.players.get(e.id) ?? [], roster);
      const raidNightKills = e.npc_id == null ? 0 : (off.inWindowByNpc.get(e.npc_id) ?? 0);
      return { e, share, raidNightKills, isRaidMob: raidNightKills >= 2 };
    })
    .filter(x => x.share.players >= OFFHOURS_MIN_PLAYERS)
    .sort((a, b) => {
      // Unreviewed first — a marked row is done, keep it as an audit trail.
      const ac = a.e.classification ? 1 : 0, bc = b.e.classification ? 1 : 0;
      if (ac !== bc) return ac - bc;
      const ar = a.isRaidMob ? 0 : 1, br = b.isRaidMob ? 0 : 1;
      if (ar !== br) return ar - br;
      if (a.share.memberFrac !== b.share.memberFrac) return a.share.memberFrac - b.share.memberFrac;
      return +new Date(b.e.started_at) - +new Date(a.e.started_at);
    })
    .slice(0, OFFHOURS_MAX);
  const offPending = offHours.filter(x => !x.e.classification).length;

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

      {/* Off-hours kills of raid-night mobs */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h3 className="text-sm text-orange uppercase tracking-wide mb-1">
          Outside the raid window · {offPending} to review
          {offHours.length > offPending && (
            <span className="text-dim normal-case tracking-normal"> · {offHours.length - offPending} already marked</span>
          )}
        </h3>
        <p className="text-xs text-dim leading-5 mb-3">
          Every {OFFHOURS_MIN_PLAYERS}+ player kill since April that started outside
          Sun/Wed/Thu 19:30–00:30 ET. <b className="text-orange">Raid-night mob</b> means the
          guild also kills it during raids — those at a low roster share are the pug case and
          sort first. Off-night clears like The Va`Dyn run 80–100% roster and sort last;
          they are listed for completeness, not because they are suspect.
          Nothing here is auto-hidden — this queue is the decision.
        </p>
        {offHours.length === 0 ? (
          <p className="text-xs text-dim italic">Nothing outside the raid window.</p>
        ) : (
          <div className="space-y-2">
            {offHours.map(({ e, share, raidNightKills, isRaidMob }) => (
              <div key={e.id} className={`border rounded p-2.5 text-xs ${e.classification ? 'border-border/30 opacity-60' : 'border-border/60'}`}>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <a href={`/parses/${e.id}`} className="text-gold hover:text-blue truncate">
                    {cleanBossName(e.eqemu_npc_types?.name)}
                  </a>
                  <span className="text-dim whitespace-nowrap">
                    {dayLabel(dayKey(e.started_at, tz), tz)} · {fmtTime(e.started_at, tz)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className={share.memberFrac < 0.6 ? 'text-red' : share.memberFrac < 0.8 ? 'text-orange' : 'text-dim'}>
                    {share.members}/{share.players} on roster ({pct(share.memberFrac)})
                  </span>
                  {isRaidMob && (
                    <span className="px-1 py-px rounded border border-orange/40 bg-orange/10 text-orange text-[9px] uppercase"
                          title={`Killed ${raidNightKills}× inside the raid window`}>
                      raid-night mob ×{raidNightKills}
                    </span>
                  )}
                  {e.classification && (
                    <span className="px-1 py-px rounded border border-purple/40 bg-purple/20 text-purple text-[9px] uppercase">
                      {e.classification === 'foreign' ? 'marked non-guild' : e.classification}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <form action={classifyEncounter}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="classification" value="foreign" />
                    <input type="hidden" name="reason" value="Outside the raid window — officer review" />
                    <button type="submit" disabled={e.classification === 'foreign'}
                      className="px-2 py-0.5 rounded text-[10px] border border-purple/50 text-purple disabled:opacity-100 disabled:font-semibold opacity-70 hover:opacity-100">
                      Mark Non-Guild
                    </button>
                  </form>
                  {e.classification && (
                    <form action={clearClassification}>
                      <input type="hidden" name="id" value={e.id} />
                      <button type="submit" className="px-2 py-0.5 rounded text-[10px] border border-border text-dim opacity-70 hover:opacity-100">
                        Clear — it was ours
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
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
