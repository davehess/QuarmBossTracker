// /boards — mirrors the Discord raid-mobs board state. Each expansion gets
// a section listing every boss with countdown to next spawn or an
// "Available now" badge. Data comes from `bot_boards` which the bot
// upserts in postKillUpdate (and seeds on startup).
//
// Auth: signed-in Wolf Pack members only — same gate as the rest of the
// site. The board state isn't sensitive (PQDI publishes the same window
// ranges) but we keep it behind the existing OAuth wall for consistency.

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { userTz, fmtAbs } from '@/lib/timezone';
import ExpansionSection from './ExpansionSection';

export const dynamic = 'force-dynamic';

type BoardRow = {
  boss_id:     string;
  name:        string | null;
  zone:        string | null;
  expansion:   string | null;
  timer_hours: number | null;
  emoji:       string | null;
  pqdi_url:    string | null;
  killed_at:   string | null;
  next_spawn:  string | null;
  killed_by:   string | null;
  updated_at:  string;
};

const EXPANSION_ORDER = ['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP'] as const;
const EXPANSION_META: Record<string, { label: string; accent: string }> = {
  Classic: { label: '⚔️ Classic EverQuest', accent: 'border-orange/60' },
  Kunark:  { label: '🦎 Ruins of Kunark',   accent: 'border-green/60'  },
  Velious: { label: '❄️ Scars of Velious',  accent: 'border-blue/60'   },
  Luclin:  { label: '🌙 Shadows of Luclin', accent: 'border-purple/60' },
  PoP:     { label: '🔥 Planes of Power',   accent: 'border-red/60'    },
};

async function loadBoards(): Promise<{ rows: BoardRow[]; updatedAt: string | null; error: string | null }> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from('bot_boards')
      .select('boss_id, name, zone, expansion, timer_hours, emoji, pqdi_url, killed_at, next_spawn, killed_by, updated_at')
      .order('expansion', { ascending: true })
      .order('zone',      { ascending: true })
      .order('name',      { ascending: true });
    if (error) return { rows: [], updatedAt: null, error: error.message };
    const rows = (data ?? []) as BoardRow[];
    const updatedAt = rows.reduce<string | null>(
      (max, r) => (max && r.updated_at <= max) ? max : r.updated_at, null,
    );
    return { rows, updatedAt, error: null };
  } catch (err) {
    return { rows: [], updatedAt: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function BoardsPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/boards');

  const { rows, updatedAt, error } = await loadBoards();
  const tz = await userTz();
  if (error) {
    return (
      <div className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
        Failed to load boards: {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="bg-panel border border-border rounded-lg p-4 text-dim text-sm">
        No board data yet. The bot mirrors the board state to Supabase on
        every kill update and once on startup — if this stays empty after
        the next deploy, something on the bot side isn't writing.
      </div>
    );
  }

  // Group by expansion → zone
  const byExpansion = new Map<string, BoardRow[]>();
  for (const r of rows) {
    const k = r.expansion || 'Unknown';
    if (!byExpansion.has(k)) byExpansion.set(k, []);
    byExpansion.get(k)!.push(r);
  }

  const totalAvailable = rows.filter(r => !r.next_spawn || new Date(r.next_spawn).getTime() <= Date.now()).length;

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-2xl text-gold flex items-center gap-3">
            <span aria-hidden>📋</span>
            <span>Boards</span>
          </h2>
          <div className="text-xs text-dim">
            <span className="text-green">{totalAvailable}</span> available now
            {updatedAt && (
              <span className="ml-3">snapshot: {fmtAbs(updatedAt, tz)}</span>
            )}
          </div>
        </div>
        <p className="text-sm text-dim mt-2">
          Live mirror of the Discord raid-mobs board. Countdowns tick
          client-side; the underlying timestamps come from the bot every
          time it processes a kill.
        </p>
      </section>

      {EXPANSION_ORDER.map(expansion => {
        const bosses = byExpansion.get(expansion);
        if (!bosses || bosses.length === 0) return null;
        const meta = EXPANSION_META[expansion];
        const byZone = new Map<string, BoardRow[]>();
        for (const b of bosses) {
          const z = b.zone || 'Unknown zone';
          if (!byZone.has(z)) byZone.set(z, []);
          byZone.get(z)!.push(b);
        }
        const zones = [...byZone.entries()].map(([zone, list]) => ({ zone, bosses: list }));
        return (
          <ExpansionSection
            key={expansion}
            expansion={expansion}
            label={meta.label}
            accentClass={meta.accent}
            zones={zones}
          />
        );
      })}
    </div>
  );
}
