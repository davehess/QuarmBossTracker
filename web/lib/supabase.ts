// Server-side Supabase client for the Next.js app. Uses the anon key by
// default — same one the bot uses for read-only queries. Service role key
// is only loaded when explicitly requested for admin endpoints.
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!URL || !ANON) {
  // We log instead of throwing so dev mode without env vars still serves
  // the landing page — pages that hit the DB will fail explicitly.
  // eslint-disable-next-line no-console
  console.warn('[supabase] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing.');
}

// Browser/server-shared anon client. For per-user auth contexts use
// @supabase/ssr's createServerClient when we wire OAuth in.
export const supabase = createClient(URL, ANON, {
  auth: { persistSession: false },
});

// Helper for admin queries (rare). Only call from server components.
export function supabaseAdmin() {
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SR) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(URL, SR, { auth: { persistSession: false } });
}
