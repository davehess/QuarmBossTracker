// Per-request memoized auth lookup. auth.getUser() is a NETWORK call to
// Supabase, and it used to run independently in the root layout AND each page
// on every navigation (middleware keeps its own — it refreshes the cookie).
// React's cache() collapses every getSessionUser() caller in one render pass
// to a single call. New pages should prefer this over calling
// supabaseServer().auth.getUser() directly; existing pages dedupe as they
// migrate. (Efficiency review 2026-07-07, MEDIUM.)
import { cache } from 'react';
import { supabaseServer } from '@/lib/supabase-server';

export const getSessionUser = cache(async () => {
  const { data: { user } } = await supabaseServer().auth.getUser();
  return user;
});
