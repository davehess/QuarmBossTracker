// /admin/readiness — officer roll-up of Raid Kit readiness (raid rule 12).
//
// The member-facing version is the 🎒 card on /character/[name]/gear; this is
// the whole-roster view: one row per raider (membership predicate = the roster
// ranks the attendance page uses), MR floor + the utility checklist, computed
// with the SAME pure lib (web/lib/raidKit.ts) so the two surfaces never drift.
//
// "Helping not watching": MR is the only hard red, and only when a gear snapshot
// exists — a raider with no export reads "no snapshot", never a fail. Utilities
// are covered / not-detected (amber), never red, because a source can sit in the
// privacy-stripped bank or an un-uploaded spellbook. exclude_from_stats /
// exclude_inventory raiders show their name but no derived numbers.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import {
  computeRaidKit, MR_FLOOR, UTILITY_KEYS, UTILITY_LABEL, type RaidKitResult,
} from '@/lib/raidKit';

export const dynamic = 'force-dynamic';

// Membership predicate — the raid-roster ranks /admin/attendance counts (Raid
// Alts are DKP-tracker placeholders, not people in a slot).
const ROSTER_RANKS = new Set(['Raid Pack', 'Officer', 'Pack Leader', 'Recruit']);

type CharRow = {
  name: string; class: string | null; rank: string | null;
  exclude_from_stats: boolean | null; exclude_inventory: boolean | null;
};
type GearRow = { character: string; loc: string; slot: string; item_id: number; item_name: string };
type ItemRow = { id: number; mr: number | null; clickeffect: number | null; worneffect: number | null };

type Row = {
  name: string;
  className: string | null;
  optedOut: null | 'stats' | 'inventory';
  kit: RaidKitResult | null;
};

async function load(): Promise<Row[]> {
  const sb = supabaseAdmin();
  const { data: charRows } = await sb
    .from('characters')
    .select('name, class, rank, exclude_from_stats, exclude_inventory')
    .eq('guild_id', 'wolfpack');
  const roster = ((charRows ?? []) as CharRow[])
    .filter(c => c.rank != null && ROSTER_RANKS.has(c.rank));
  const names = roster.map(c => c.name);
  if (names.length === 0) return [];

  // Only the raiders whose data we may actually read.
  const computable = roster.filter(c => !c.exclude_from_stats && !c.exclude_inventory);
  const computeNames = computable.map(c => c.name);

  // Gear (equipped + bag) for the computable raiders, keyed by lowercased name.
  const gearByChar = new Map<string, GearRow[]>();
  const items: Record<number, ItemRow> = {};
  const spellNames: Record<number, string> = {};
  const scribedByChar = new Map<string, string[]>();

  if (computeNames.length > 0) {
    const { data: gearRows } = await sb
      .from('character_gear')
      .select('character, loc, slot, item_id, item_name')
      .in('character', computeNames)
      .in('loc', ['equipped', 'bag'])
      .limit(20000);
    for (const g of (gearRows ?? []) as GearRow[]) {
      const k = g.character.toLowerCase();
      (gearByChar.get(k) ?? gearByChar.set(k, []).get(k)!).push(g);
    }

    const itemIds = [...new Set(((gearRows ?? []) as GearRow[]).map(g => g.item_id))];
    if (itemIds.length) {
      const { data: itemRows } = await sb
        .from('eqemu_items')
        .select('id, mr, clickeffect, worneffect')
        .in('id', itemIds);
      for (const it of (itemRows ?? []) as ItemRow[]) items[it.id] = it;
      const spellIds = [...new Set(
        Object.values(items).flatMap(it =>
          [it.clickeffect, it.worneffect].filter((x): x is number => typeof x === 'number' && x > 0)),
      )];
      if (spellIds.length) {
        const { data: spellRows } = await sb
          .from('eqemu_spells').select('id, name').in('id', spellIds);
        for (const s of (spellRows ?? []) as { id: number; name: string }[]) spellNames[s.id] = s.name;
      }
    }

    const { data: bookRows } = await sb
      .from('character_spellbook')
      .select('character_name, spell_name')
      .eq('guild_id', 'wolfpack')
      .in('character_name', computeNames)
      .limit(50000);
    for (const b of (bookRows ?? []) as { character_name: string; spell_name: string | null }[]) {
      if (!b.spell_name) continue;
      const k = b.character_name.toLowerCase();
      (scribedByChar.get(k) ?? scribedByChar.set(k, []).get(k)!).push(b.spell_name);
    }
  }

  return roster.map(c => {
    if (c.exclude_from_stats) return { name: c.name, className: c.class, optedOut: 'stats' as const, kit: null };
    if (c.exclude_inventory) return { name: c.name, className: c.class, optedOut: 'inventory' as const, kit: null };
    const gear = gearByChar.get(c.name.toLowerCase()) ?? [];
    const equipped = gear.filter(g => g.loc === 'equipped');
    const bagged = gear.filter(g => g.loc === 'bag');
    const kit = computeRaidKit({
      className: c.class,
      hasSnapshot: equipped.length > 0,
      equipped: equipped.map(g => ({ slot: g.slot, item_id: g.item_id, item_name: g.item_name })),
      bagged: bagged.map(g => ({ item_id: g.item_id, item_name: g.item_name })),
      items,
      spellNames,
      scribedSpells: scribedByChar.get(c.name.toLowerCase()) ?? [],
    });
    return { name: c.name, className: c.class, optedOut: null, kit };
  });
}

export default async function AdminReadinessPage() {
  const rows = await load();

  // Sort: MR failures first (actionable), then met-with-snapshot, then
  // opted-out, then no-snapshot last (nothing to act on yet).
  const rank = (r: Row): number => {
    if (r.optedOut) return 3;
    if (!r.kit?.hasSnapshot) return 4;
    return r.kit.mr.met ? 2 : 0;
  };
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const withSnapshot = rows.filter(r => r.kit?.hasSnapshot).length;
  const belowFloor = rows.filter(r => r.kit?.hasSnapshot && !r.kit.mr.met).length;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1 flex items-center gap-2">
          🎒 Raid Kit readiness
          <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-blue/20 border border-blue/60 text-blue uppercase">Rule 12</span>
        </h2>
        <p className="text-sm text-dim leading-6">
          Every roster raider&apos;s <b>{MR_FLOOR} magic-resist floor</b> and utility kit
          (Enduring Breath / Levitate / self-invis / self-port, plus the Necro coffin),
          from the same Quarmy gear snapshot the <Link href="/admin/rules" className="text-blue hover:underline">rulebook</Link> rule 12
          asks for. MR is summed from <b>worn gear only</b> and is the one hard check —
          shown red only when a raider HAS a snapshot and falls short. A blank utility means
          <b> the source isn&apos;t visible</b> (bank items are stripped before upload, class
          self-buffs need a spellbook upload) — never a red fail. Raiders with no export
          simply read &quot;no snapshot&quot;.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          <Stat label="Roster raiders" value={rows.length} />
          <Stat label="Have a snapshot" value={withSnapshot} color="text-blue" />
          <Stat label="Below MR floor" value={belowFloor} color={belowFloor > 0 ? 'text-red' : 'text-green'} />
          <Stat label="No snapshot yet" value={rows.length - withSnapshot - rows.filter(r => r.optedOut).length} color="text-dim" />
        </div>
      </section>

      <section className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-dim uppercase">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-normal">Raider</th>
                <th className="text-left px-3 py-2 font-normal">Class</th>
                <th className="text-right px-3 py-2 font-normal">MR</th>
                {UTILITY_KEYS.map(k => (
                  <th key={k} className="text-center px-2 py-2 font-normal" title={UTILITY_LABEL[k]}>{shortUtil(k)}</th>
                ))}
                <th className="text-center px-2 py-2 font-normal" title="Necromancer Summon-corpse coffin">Coffin</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.name} className="border-b border-border/40 hover:bg-[#1a212c]">
                  <td className="px-3 py-1.5">
                    <Link href={`/character/${encodeURIComponent(r.name)}/gear`} className="text-blue hover:underline">{r.name}</Link>
                  </td>
                  <td className="px-3 py-1.5 text-dim">{r.className || '—'}</td>
                  {r.optedOut ? (
                    <td colSpan={1 + UTILITY_KEYS.length + 1} className="px-3 py-1.5 text-dim italic">
                      opted out of {r.optedOut === 'stats' ? 'stats' : 'inventory tracking'} — not shown
                    </td>
                  ) : !r.kit?.hasSnapshot ? (
                    <td colSpan={1 + UTILITY_KEYS.length + 1} className="px-3 py-1.5 text-dim">
                      no gear snapshot — needs a Quarmy export
                    </td>
                  ) : (
                    <>
                      <td className={`px-3 py-1.5 text-right font-mono ${r.kit.mr.met ? 'text-green' : 'text-red font-semibold'}`}>
                        {r.kit.mr.value}{!r.kit.mr.met && <span className="text-[10px]"> /{r.kit.mr.floor}</span>}
                      </td>
                      {UTILITY_KEYS.map(k => {
                        const u = r.kit!.utilities[k];
                        return (
                          <td key={k} className="px-2 py-1.5 text-center" title={u.covered ? (u.source ?? '') : 'not detected'}>
                            {u.covered ? <span className="text-green">✓</span> : <span className="text-orange">○</span>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-center" title={r.kit.coffin.applicable ? (r.kit.coffin.covered ? (r.kit.coffin.source ?? '') : 'not in visible bags') : 'n/a'}>
                        {!r.kit.coffin.applicable ? <span className="text-dim">—</span>
                          : r.kit.coffin.covered ? <span className="text-green">✓</span>
                          : <span className="text-orange">○</span>}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-[11px] text-dim leading-5">
        <span className="text-green">✓</span> covered · <span className="text-orange">○</span> not detected (source not visible — not a fail).
        Hover a cell for the source item / spell. Utility detection deliberately under-claims — it credits a
        class-innate self-buff only for the certain cases and otherwise needs a real item effect or a scribed
        spell, so a false &quot;covered&quot; never hides a gap.
      </p>
    </div>
  );
}

function shortUtil(k: string): string {
  return ({ eb: 'EB', lev: 'Lev', invis: 'Invis', port: 'Port' } as Record<string, string>)[k] ?? k;
}

function Stat({ label, value, color = 'text-text' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-2 sm:p-3">
      <div className={`text-lg sm:text-2xl ${color}`}>{value.toLocaleString()}</div>
      <div className="text-dim text-[10px] sm:text-xs">{label}</div>
    </div>
  );
}
