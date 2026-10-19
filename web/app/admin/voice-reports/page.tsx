// /admin/voice-reports: officers review the "that was said wrong" reports raiders send from Mimic (the guild lead,
// 2026-10-19: "B for voice"). Raiders capture and suggest in Mimic; this page is the review half: hear the line again,
// then mark it fixed or dismiss it. The phrase-respelling table that acts on a report comes in a later slice.
// New page, so it ships live with the [beta] tag (DECISIONS §135).
import Link from 'next/link';
import { requireOfficer } from '@/lib/officer';
import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';
import NewPageTag from '@/components/NewPageTag';
import VoiceReportList, { type VoiceReportRow } from './VoiceReportList';

export const metadata = {
  title: '[beta] Voice reports · Admin',
  description: 'Lines Mimic said wrong, reported by raiders. Hear them again, then mark them fixed or dismiss them.',
};

export const dynamic = 'force-dynamic';

const COLS = 'id, created_at, trigger_name, trigger_id, spoken, original, suggested_say, note, engine, voice, rate, pitch, agent_version, character';

// The table arrives with a migration that is pasted by hand, so "not there yet" is a normal state, not an error.
const isMissingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || /does not exist|schema cache/i.test(e.message ?? ''));

export default async function AdminVoiceReportsPage() {
  // Gate first: the /admin layout does not stop a page from loading its data on its own.
  await requireOfficer();

  const { data, error } = await supabaseAdmin()
    .from('voice_reports')
    .select(COLS)
    .eq('guild_id', GUILD_TAG)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(300);
  const missing = isMissingTable(error);
  const rows = (data ?? []) as VoiceReportRow[];

  return (
    <div className="space-y-4">
      <NewPageTag note="Review the lines Mimic said wrong." />
      <section className="rounded-lg border border-border bg-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-3 text-2xl text-gold">
              <span aria-hidden>🗣️</span>
              <span>Voice reports</span>
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-dim">
              Raiders report a callout that Mimic said wrong and can suggest a better spelling. Newest first. ▶ speaks the
              suggestion (or the original line) with your <b>browser&apos;s</b> voice at the stored rate and pitch. Mimic
              uses Kokoro, Piper or the Windows voice, so it will not sound exactly the same.
            </p>
          </div>
          <Link href="/admin" className="whitespace-nowrap text-sm text-blue hover:underline">← Officer tools</Link>
        </div>
      </section>
      {missing ? (
        <p role="note" className="rounded border border-orange/50 bg-orange/10 p-4 text-sm text-orange">
          Not set up yet: the <code>voice_reports</code> table does not exist. Paste{' '}
          <code>supabase/migrations/20261019150000_voice_reports.sql</code> into the Supabase SQL Editor and reload.
          Until then Mimic&apos;s reports are turned away.
        </p>
      ) : error ? (
        <p role="alert" className="rounded border border-border bg-panel p-4 text-sm text-orange">Could not load the reports. Reload to try again.</p>
      ) : (
        <VoiceReportList initial={rows} />
      )}
    </div>
  );
}
