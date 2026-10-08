// Who is looking at /feedback/<ref>, and may they. Shared by the page and the reply action so both ask the
// same question the same way: the signed-in session, mapped to a Discord id through wolfpack_members (the id
// comes from the session, never from the URL or the form), and the officer role check /admin uses.
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { canOpenReport } from '@/lib/feedbackReport';

export type Viewer = { userId: string; discordId: string | null; officer: boolean };

export type ReportRow = {
  id: string;
  ref: number;
  submitted_at: string;
  submitter_discord_id: string | null;
  category: string | null;
  message: string;
  status: string;
  notes: string | null;
};

export async function loadViewer(): Promise<Viewer | null> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  const { data: pack } = await supabaseAdmin()
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user.id)
    .maybeSingle();
  return {
    userId: user.id,
    discordId: (pack?.discord_id as string | undefined) ?? null,
    officer: await isOfficer(user.id),
  };
}

export async function loadReport(ref: number): Promise<ReportRow | null> {
  const { data } = await supabaseAdmin()
    .from('feedback')
    .select('id, ref, submitted_at, submitter_discord_id, category, message, status, notes')
    .eq('ref', ref)
    .maybeSingle();
  return (data as ReportRow | null) ?? null;
}

// The report, only if this viewer may open it. null for "no such report" and "not yours" alike, so the
// answer never tells a stranger which numbers exist.
export async function openReport(viewer: Viewer, ref: number): Promise<ReportRow | null> {
  const report = await loadReport(ref);
  if (!report) return null;
  return canOpenReport(viewer.discordId, report.submitter_discord_id, viewer.officer) ? report : null;
}
