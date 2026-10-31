// Server-side loaders for <UploadFreshness>: one select of the timestamp columns on characters, and, only for a kind
// whose character row carries no stamp yet, the newest row of its snapshot table.
//
// The stamp select is its OWN read on purpose, not extra columns on each page's character select: until migration
// 20261031120000 is applied a missing column makes PostgREST answer an error, and on a page that notFound()s on an
// empty character read that would turn the whole page into a 404. Read on its own, a miss only costs the line its
// fresh values (it falls back to the row timestamps).

import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';
import { latestIso, type UploadStamps } from '@/lib/uploadFreshness';

export type UploadKind = 'gear' | 'inventory' | 'spells';

type StampRow = {
  quarmy_checked_at: string | null; quarmy_synced_at: string | null;
  inventory_checked_at: string | null; inventory_synced_at: string | null;
  spellbook_checked_at: string | null; spellbook_synced_at: string | null;
};

export async function loadUploadStampRow(name: string): Promise<StampRow | null> {
  const { data } = await supabaseAdmin()
    .from('characters')
    .select('quarmy_checked_at, quarmy_synced_at, inventory_checked_at, inventory_synced_at, spellbook_checked_at, spellbook_synced_at')
    .eq('guild_id', GUILD_TAG)
    .ilike('name', name)
    .limit(1);
  return ((data && data[0]) as StampRow | undefined) ?? null;
}

/** Newest observed_at of a character's snapshot rows, or null when it has none. */
export async function newestSnapshotAt(table: 'character_inventory' | 'character_spellbook', name: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from(table)
    .select('observed_at')
    .eq('guild_id', GUILD_TAG)
    .ilike('character_name', name)
    .order('observed_at', { ascending: false })
    .limit(1);
  return (data && data[0] && (data[0] as { observed_at: string | null }).observed_at) || null;
}

/** The stamps for one kind. `rowAt` is the newest row timestamp, looked up only when the character row has no stamp. */
export async function uploadStampsFor(
  kind: UploadKind, name: string, row: StampRow | null, gearRowAt?: string | null,
): Promise<UploadStamps> {
  if (kind === 'gear') {
    return { checkedAt: row?.quarmy_checked_at, syncedAt: row?.quarmy_synced_at, rowAt: gearRowAt ?? null };
  }
  const checkedAt = kind === 'inventory' ? row?.inventory_checked_at : row?.spellbook_checked_at;
  const syncedAt  = kind === 'inventory' ? row?.inventory_synced_at  : row?.spellbook_synced_at;
  const rowAt = latestIso(checkedAt, syncedAt)
    ? null
    : await newestSnapshotAt(kind === 'inventory' ? 'character_inventory' : 'character_spellbook', name);
  return { checkedAt, syncedAt, rowAt };
}
