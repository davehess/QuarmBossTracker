'use server';
// Records an explicit window-chip pick (fire-and-forget from WindowPicker).
// Default renders are NOT recorded — the counter answers "which windows do
// people actually reach for", so rarely-picked ones can be retired.
// Read: select page, win, sum(count) from ui_window_usage group by 1,2;

import { supabaseAdmin } from '@/lib/supabase';

export async function recordWindowUse(page: string, win: string): Promise<void> {
  try {
    await supabaseAdmin().rpc('bump_ui_window', { p_page: String(page).slice(0, 40), p_win: String(win).slice(0, 16) });
  } catch { /* telemetry only — never block navigation */ }
}
