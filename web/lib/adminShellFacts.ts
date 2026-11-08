// The admin shell's numbers, cached. Each read in lib/adminShellReads.ts is wrapped on its own in a 60-second cache
// (Next's data cache, shared across requests), so a page that renders the sidebar AND the strip, and an officer
// clicking through ten pages in a minute, cost one read of each table a minute: not one per click. SERVER ONLY.
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';
import {
  readAgents, readLockedOut, readNewFeedback, readTonight,
  type Tonight,
} from '@/lib/adminShellReads';

export const FACTS_REVALIDATE_S = 60;

const tonight  = unstable_cache(async () => readTonight(supabaseAdmin(), GUILD_TAG),    ['admin-shell-tonight'],  { revalidate: FACTS_REVALIDATE_S });
const lockedOut = unstable_cache(async () => readLockedOut(supabaseAdmin(), GUILD_TAG), ['admin-shell-lockouts'], { revalidate: FACTS_REVALIDATE_S });
const agents   = unstable_cache(async () => readAgents(supabaseAdmin()),                ['admin-shell-agents'],   { revalidate: FACTS_REVALIDATE_S });
const feedback = unstable_cache(async () => readNewFeedback(supabaseAdmin()),           ['admin-shell-feedback'], { revalidate: FACTS_REVALIDATE_S });

export type AdminFacts = {
  tonight: Tonight | null;
  lockedOut: number | null;
  agents: { up: number; total: number } | null;
  newFeedback: number | null;
};

export async function loadAdminFacts(): Promise<AdminFacts> {
  const [t, l, a, f] = await Promise.all([tonight(), lockedOut(), agents(), feedback()]);
  return { tonight: t, lockedOut: l, agents: a, newFeedback: f };
}
