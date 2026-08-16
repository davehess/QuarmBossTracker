// /guide — the Wolf Pack Raid Guide index (#81, phase 0).
//
// Design: docs/DESIGN-81-raid-guide.md. Every boss on the board gets a page,
// whether or not anyone has written a word about it — the page renders whatever
// blocks it has data for. This index doubles as the AUTHORING WORKLIST: sorted
// so the bosses we kill most that nobody has written about float to the top.
//
// Read-only, member-gated, additive. No new tables in phase 0.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { fmtDuration } from '@/lib/format';
import { median } from '@/lib/raidGuide';

export const dynamic = 'force-dynamic';

const EXPANSION_ORDER = ['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP'] as const;
const EXPANSION_META: Record<string, { label: string; accent: string }> = {
  Classic: { label: '⚔️ Classic EverQuest', accent: 'border-orange/60' },
  Kunark:  { label: '🦎 Ruins of Kunark',   accent: 'border-green/60'  },
  Velious: { label: '❄️ Scars of Velious',  accent: 'border-blue/60'   },
  Luclin:  { label: '🌙 Shadows of Luclin', accent: 'border-purple/60' },
  PoP:     { label: '🔥 Planes of Power',   accent: 'border-red/60'    },
};

// PoP is locked until 2026-10-01 (utils/config.js isPopLocked) — locked bosses
// list, but generate nothing. Mirrors the boards' posture.
const POP_UNLOCK_MS = Date.parse('2026-10-01T00:00:00Z');

type BoardRow = {
  boss_id: string; name: string | null; zone: string | null;
  expansion: string | null; emoji: string | null;
};
type LocalRow = { npc_id: number; internal_id: string; strat_notes: string | null };
type EncRow   = { npc_id: number; duration_sec: number | null; total_damage: number | null; ended_at: string | null; classification: string | null };

type GuideIndexRow = {
  bossId: string; name: string; zone: string | null; emoji: string | null;
  expansion: string; npcId: number | null;
  kills: number; medianDurationSec: number | null; hasNotes: boolean; locked: boolean;
};

async function load(): Promise<{ rows: GuideIndexRow[]; error: string | null }> {
  try {
    const sb = supabaseAdmin();
    const popLocked = Date.now() < POP_UNLOCK_MS;

    const [boardRes, localRes, encRes] = await Promise.all([
      sb.from('bot_boards').select('boss_id, name, zone, expansion, emoji'),
      sb.from('bosses_local').select('npc_id, internal_id, strat_notes'),
      sb.from('encounters')
        .select('npc_id, duration_sec, total_damage, ended_at, classification')
        .gt('total_damage', 0)
        .limit(20000),
    ]);
    if (boardRes.error) return { rows: [], error: boardRes.error.message };

    const boards = (boardRes.data ?? []) as BoardRow[];
    const locals = (localRes.data ?? []) as LocalRow[];
    const encs   = (encRes.data ?? []) as EncRow[];

    const localByInternal = new Map(locals.map(l => [l.internal_id, l]));
    const byNpc = new Map<number, EncRow[]>();
    for (const e of encs) {
      if (e.npc_id == null || e.classification || e.ended_at == null) continue;
      const arr = byNpc.get(e.npc_id) || [];
      arr.push(e);
      byNpc.set(e.npc_id, arr);
    }

    const rows: GuideIndexRow[] = boards.map((b) => {
      const local = localByInternal.get(b.boss_id) || null;
      const expansion = b.expansion || 'Classic';
      const locked = popLocked && expansion === 'PoP';
      const fights = (!locked && local) ? (byNpc.get(local.npc_id) ?? []) : [];
      // Index-level floor: half the median damage. The per-boss page uses the
      // stronger catalog-HP floor (see raidGuide.bucketEncounters).
      const medDmg = median(fights.map(f => f.total_damage)) ?? 0;
      const complete = fights.filter(f => (f.total_damage || 0) >= medDmg * 0.5);
      return {
        bossId: b.boss_id,
        name: b.name || b.boss_id,
        zone: b.zone,
        emoji: b.emoji,
        expansion,
        npcId: local?.npc_id ?? null,
        kills: complete.length,
        medianDurationSec: median(complete.map(f => f.duration_sec)),
        hasNotes: !!(local?.strat_notes && local.strat_notes.trim()),
        locked,
      };
    });

    return { rows, error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function GuideIndex() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/guide');

  const { rows, error } = await load();
  if (error) {
    return (
      <div className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
        Failed to load the guide index: {error}
      </div>
    );
  }

  const withHistory = rows.filter(r => r.kills > 0).length;
  const written     = rows.filter(r => r.hasNotes).length;

  // Authoring worklist: most-killed first, unwritten before written.
  const sortRows = (a: GuideIndexRow, b: GuideIndexRow) =>
    Number(a.hasNotes) - Number(b.hasNotes) || b.kills - a.kills || a.name.localeCompare(b.name);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl text-gold">📖 Raid Guide</h1>
        <p className="text-sm text-dim mt-1">
          One page per boss, written by our own raids. {withHistory} of {rows.length} bosses have
          recorded fights; {written} carry an officer&apos;s notes.
        </p>
        <p className="text-xs text-dim mt-1">
          Numbers come from confirmed kills in our own parses — nothing here is copied from a wiki.
          Design notes: <span className="font-mono">docs/DESIGN-81-raid-guide.md</span>.
        </p>
        <p className="text-xs mt-1">
          <Link href="/raid/plan" className="text-blue hover:underline">🗂 Fight cards</Link>
          <span className="text-dim"> — the pre-raid checklist: comp, kit, tactics, and callouts resolved live per fight.</span>
        </p>
      </div>

      {EXPANSION_ORDER.map((exp) => {
        const section = rows.filter(r => r.expansion === exp).sort(sortRows);
        if (section.length === 0) return null;
        const meta = EXPANSION_META[exp];
        return (
          <section key={exp} className={`bg-panel border ${meta.accent} rounded-lg p-4`}>
            <h2 className="text-sm text-gold mb-3">{meta.label}
              <span className="text-dim text-xs ml-2">· {section.length}</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[34rem]">
                <thead className="text-dim text-left">
                  <tr className="border-b border-border">
                    <th className="py-1 pr-2">Boss</th>
                    <th className="py-1 pr-2 hidden sm:table-cell">Zone</th>
                    <th className="py-1 pr-2 text-right">Kills</th>
                    <th className="py-1 pr-2 text-right">Median</th>
                    <th className="py-1 pr-2 text-center">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {section.map((r) => (
                    <tr key={r.bossId} className={`border-b border-border/30 hover:bg-[#1a212c] ${r.locked ? 'opacity-50' : ''}`}>
                      <td className="py-1 pr-2 text-text">
                        <Link href={`/guide/${encodeURIComponent(r.bossId)}`} className="hover:text-blue hover:underline">
                          {r.emoji ? `${r.emoji} ` : ''}{r.name}
                        </Link>
                        {r.locked && <span className="text-dim ml-1" title="PoP is locked until 2026-10-01">🔒</span>}
                      </td>
                      <td className="py-1 pr-2 text-dim hidden sm:table-cell">{r.zone || '—'}</td>
                      <td className="py-1 pr-2 text-right text-dim tabular-nums">{r.kills || '—'}</td>
                      <td className="py-1 pr-2 text-right text-dim tabular-nums">
                        {r.medianDurationSec != null ? fmtDuration(r.medianDurationSec) : '—'}
                      </td>
                      <td className="py-1 pr-2 text-center">{r.hasNotes ? '✍' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
