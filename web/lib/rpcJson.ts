// One jsonb answer from a Postgres function, for the admin pages that used to count a 1,000-row read.
//
// PostgREST silently caps a response at 1,000 rows, and that applies to a set-returning function
// exactly as it does to a table. A function that returns ONE jsonb value is a scalar, not a set, so
// the cap never touches it. The functions in 20261004140400_cap_safe_admin.sql are written that way;
// this is the one place they are called, so the failure rule is stated once.
//
// A failed call reads as `fallback` and is logged: the queue banner sits on every admin page and a
// read that fails must not take the page with it (the reads this replaces never threw either; they
// handed back `data ?? []`). Takes the client as an argument so a test can run it against a fake.

import type { SupabaseClient } from '@supabase/supabase-js';

export async function rpcJson<T>(
  sb: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  fallback: T,
): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`[admin] ${fn} failed: ${error.message}`);
    return fallback;
  }
  return (data ?? fallback) as T;
}
