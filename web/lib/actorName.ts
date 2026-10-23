// The name an officer action is stored and shown under: the Discord name, never the account's email address (the
// guild lead, 2026-10-23, on a parse page that read "marked by <email>": "Needs to remove email from this and instead
// do username"). Members read these labels, so an address is never one of them.
import type { User } from '@supabase/supabase-js';

export function actorName(user: Pick<User, 'user_metadata'> | null | undefined): string {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name, meta.preferred_username, meta.user_name]
    .find(v => typeof v === 'string' && v.trim() && !v.includes('@'));
  return name ? String(name).trim() : 'an officer';
}

/** A stored label as it may be shown: an address or a raw account id (rows written before actorName) reads "an officer". */
export function shownActor(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (stored.includes('@') || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored)) return 'an officer';
  return stored;
}
