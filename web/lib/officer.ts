// Server-side officer check. Reads the OFFICER_ROLE_NAMES env var (comma
// separated; defaults to "Officer,Pack Leader") and compares against the
// signed-in user's role_names cached in wolfpack_members.role_names.
//
// The cache is populated by the bot's syncWolfpackMembers (every 6h) AND
// refreshed in auth/callback at sign-in time — so a freshly-promoted
// officer who signs out and back in gets access immediately.

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from './supabase-server';

function _officerNames() {
  return (process.env.OFFICER_ROLE_NAMES || 'Officer,Pack Leader')
    .split(',').map(s => s.trim()).filter(Boolean);
}

// Module-level singleton — the old code built a fresh client (and connection
// state) on EVERY isOfficer call (efficiency review 2026-07-07, MEDIUM).
let _adminClient: SupabaseClient | null = null;
function _admin(): SupabaseClient | null {
  if (_adminClient) return _adminClient;
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!SR || !URL) return null;
  _adminClient = createClient(URL, SR, { auth: { persistSession: false } });
  return _adminClient;
}

// cache() = React per-request memo across the whole server-component tree:
// the root layout AND any page/component checking the same userId in one
// navigation share a single wolfpack_members query, with zero call-site
// changes.
export const isOfficer = cache(async (userId: string | null | undefined): Promise<boolean> => {
  if (!userId) return false;
  const admin = _admin();
  if (!admin) return false;
  try {
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
});

// The officer gate for an /admin page: call it FIRST in the page, before it
// loads anything. The /admin layout's own check is not enough on its own —
// Next renders a page without waiting on its layout, so a page that relies on
// the layout alone can still load (and send) its data. Returns the user's id.
export async function requireOfficer(): Promise<string> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/admin');
  if (!(await isOfficer(user.id))) redirect('/?error=admin_required');
  return user.id;
}
