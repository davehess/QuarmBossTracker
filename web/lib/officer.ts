// Server-side officer check. Reads the OFFICER_ROLE_NAMES env var (comma
// separated; defaults to "Officer,Pack Leader") and compares against the
// signed-in user's role_names cached in wolfpack_members.role_names.
//
// The cache is populated by the bot's syncWolfpackMembers (every 6h) AND
// refreshed in auth/callback at sign-in time — so a freshly-promoted
// officer who signs out and back in gets access immediately.

import { createClient } from '@supabase/supabase-js';

function _officerNames() {
  return (process.env.OFFICER_ROLE_NAMES || 'Officer,Pack Leader')
    .split(',').map(s => s.trim()).filter(Boolean);
}

export async function isOfficer(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!SR || !URL) return false;
  try {
    const admin = createClient(URL, SR, { auth: { persistSession: false } });
    const { data } = await admin
      .from('wolfpack_members')
      .select('role_names')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return false;
    const names: string[] = Array.isArray(data.role_names) ? data.role_names : [];
    const allow = new Set(_officerNames());
    return names.some(n => allow.has(n));
  } catch {
    return false;
  }
}
