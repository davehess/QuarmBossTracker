// Server-side Supabase client for the Next.js app. It reads with the server key
// (SUPABASE_SERVICE_ROLE_KEY, never NEXT_PUBLIC_*): until 2026-10-29 the public
// "anon" variable held the service key on Vercel, so these reads have always run
// as service_role, and the browser bundle shipped that key. A non-NEXT_PUBLIC
// variable is never inlined into a client bundle, so importing this from a
// client component cannot leak it.
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!URL || !ANON) {
  // We log instead of throwing so dev mode without env vars still serves
  // the landing page — pages that hit the DB will fail explicitly.
  // eslint-disable-next-line no-console
  console.log('[supabase] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.');
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
