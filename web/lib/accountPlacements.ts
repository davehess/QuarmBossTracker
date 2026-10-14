// Which EverQuest GAME ACCOUNT each character is on, as /me/inventory reads it (the guild lead,
// 2026-10-13). One game account holds up to 8 characters, a forum account up
// to 10 game accounts, and `#charactertransfer` moves a character between
// them — so a placement has a validity window and only the OPEN row
// (valid_to is null) is current. The owner fills these in on /me/accounts
// (web/lib/gameAccounts.ts writes them).
//
// Tables (service-role only, RLS with no policies): `game_accounts` and
// `character_accounts`. Every failure here resolves to "no placements" — the page
// then falls back to inferring accounts from the shared banks. Fail open.

import type { AccountPlacement } from './sharedBank';

// Structural client type: just enough of supabase-js's query builder, so the
// loader can be tested with a plain fake.
type Q = PromiseLike<{ data: unknown[] | null; error: unknown }> & {
  select: (cols: string) => Q;
  eq: (col: string, val: unknown) => Q;
  in: (col: string, vals: unknown[]) => Q;
  is: (col: string, val: null) => Q;
};
export type PlacementClient = { from: (table: string) => unknown };

type CharAcctRow = { character_name: string; account_id: string };
type AcctRow = { id: string; slot: number | null; label: string | null };

export async function loadAccountPlacements(
  admin: PlacementClient, guildId: string, charNames: string[],
): Promise<AccountPlacement[]> {
  if (charNames.length === 0) return [];
  try {
    const from = (t: string) => admin.from(t) as Q;
    const ca = await from('character_accounts')
      .select('character_name, account_id')
      .eq('guild_id', guildId)
      .in('character_name', charNames)
      .is('valid_to', null);
    if (ca.error || !ca.data) return [];
    const open = ca.data as CharAcctRow[];
    if (open.length === 0) return [];

    const ids = [...new Set(open.map(r => r.account_id))];
    const ga = await from('game_accounts')
      .select('id, slot, label')
      .eq('guild_id', guildId)
      .in('id', ids);
    // A failed account lookup still leaves the placement itself usable — the
    // label just falls back to "Account".
    const meta = new Map<string, AcctRow>(
      ((!ga.error && ga.data ? ga.data : []) as AcctRow[]).map(a => [a.id, a]));

    return open.map(r => ({
      character: r.character_name,
      accountId: r.account_id,
      slot: meta.get(r.account_id)?.slot ?? null,
      label: meta.get(r.account_id)?.label ?? null,
    }));
  } catch {
    return [];
  }
}
