// /feedback/FB-<n>: a member's own report, and a place to answer it.
//
// The guild lead, 2026-10-08, picked this over the alternatives: the bot's "your report moved" DM used to
// link to the report's card in the Discord #feedback thread, which only officers can open, and "reply on the
// card" was impossible for the person who filed it. This page is that link now. New route, so it goes live
// with the [beta] tag (DECISIONS §135).
//
// Who sees what: the submitter (their Discord id, taken from the session through wolfpack_members, equals the
// row's) and officers. Anyone else gets the same plain line whether the number exists or not, and nothing of
// the report. It shows the member's own words, the status in plain words, the history the bot kept, and the
// reply thread. No log excerpts, screenshots, officer notes or other people's names. Replies are posted by
// the server action (actions.ts) and relayed to the Discord card by the bot.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import NewPageTag from '@/components/NewPageTag';
import { historyOf, parseRefParam, statusWords, replyErrorText, REPLY_MAX } from '@/lib/feedbackReport';
import { loadViewer, openReport } from './access';
import { postReply } from './actions';

export const metadata: Metadata = {
  title: '[beta] My report',
  description: 'See where your bug report or idea stands, and answer it.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type ReplyRow = { id: string; author_discord_id: string; body: string; created_at: string };

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtStamp = (iso: string) => new Date(iso).toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
}) + ' UTC';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <NewPageTag note="Your own report and its replies." />
      {children}
    </div>
  );
}

export default async function MyReportPage({
  params,
  searchParams,
}: {
  params: { ref: string };
  searchParams: { err?: string; sent?: string };
}) {
  const ref = parseRefParam(params.ref);
  if (!ref) {
    return (
      <Shell>
        <p className="text-sm text-dim">That is not a report number. They look like FB-12.</p>
      </Shell>
    );
  }
  const here = `/feedback/FB-${ref}`;

  const viewer = await loadViewer();
  if (!viewer) redirect(`/auth/signin?next=${encodeURIComponent(here)}`);

  const report = await openReport(viewer, ref);
  if (!report) {
    return (
      <Shell>
        <section className="bg-panel border border-border rounded-lg p-6">
          <h1 className="text-lg text-gold mb-1">This report is not yours</h1>
          <p className="text-sm text-dim">
            Reports can only be opened by the person who filed them, and by officers. If you filed it
            from Mimic or Discord, sign in with the same Discord account.
          </p>
        </section>
      </Shell>
    );
  }

  const asOfficer = viewer.officer && viewer.discordId !== report.submitter_discord_id;
  const { data: replyData } = await supabaseAdmin()
    .from('feedback_replies')
    .select('id, author_discord_id, body, created_at')
    .eq('feedback_id', report.id)
    .order('created_at', { ascending: true })
    .limit(100);
  const replies = (replyData ?? []) as ReplyRow[];
  const errText = replyErrorText(searchParams.err);
  const status = statusWords(report.status);
  const history = historyOf(report.notes);
  const kind = report.category === 'bug' ? 'Bug' : report.category === 'idea' ? 'Idea' : 'Report';
  // The form hides the web form's own prefix; it is how we tell where the report came from, not part of it.
  const message = report.message.replace(/^\[from wolfpack\.quest\]\s*/, '');

  const whoWrote = (id: string): string => {
    const theirs = !!report.submitter_discord_id && id === report.submitter_discord_id;
    if (asOfficer) return theirs ? 'The submitter' : 'An officer';
    return theirs ? 'You' : 'An officer';
  };

  return (
    <Shell>
      <section className="bg-panel border border-border rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap text-xs text-dim">
          <span className="font-bold text-text">FB-{report.ref}</span>
          <span>· {kind}</span>
          <span>· sent {fmtDay(report.submitted_at)}</span>
          {asOfficer && <span className="text-orange">· viewing as an officer</span>}
        </div>
        <div className="text-sm text-text whitespace-pre-wrap break-words">{message}</div>
      </section>

      <section className="bg-panel border border-border rounded-lg p-5 space-y-2">
        <h2 className="text-sm text-gold">Where it stands</h2>
        <div className="text-sm text-text">{status.icon} <b>{status.label}</b></div>
        <p className="text-sm text-dim">{status.detail}</p>
        {history.length > 0 && (
          <ul className="text-xs text-dim space-y-1 border-t border-border pt-2 mt-2">
            {history.map((h, i) => (
              <li key={i}>
                <span className="text-text">{fmtDay(h.date)}</span> {h.label}
                {h.changed && <span> — {h.changed}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="replies" className="bg-panel border border-border rounded-lg p-5 space-y-3">
        <h2 className="text-sm text-gold">Replies</h2>
        {replies.length === 0 ? (
          <p className="text-sm text-dim">No replies yet.</p>
        ) : (
          <ul className="space-y-3">
            {replies.map(r => (
              <li key={r.id} className="border-l-2 border-border pl-3">
                <div className="text-[11px] text-dim">
                  <span className="text-text">{whoWrote(r.author_discord_id)}</span> · {fmtStamp(r.created_at)}
                </div>
                <div className="text-sm text-text whitespace-pre-wrap break-words">{r.body}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="reply" className="bg-panel border border-border rounded-lg p-5">
        <form action={postReply} className="space-y-2">
          <input type="hidden" name="ref" value={String(report.ref)} />
          <label htmlFor="reply-body" className="block text-sm text-text">
            {asOfficer ? 'Reply on this report' : 'Not fixed for you, or more to add?'}
          </label>
          <textarea
            id="reply-body"
            name="body"
            rows={4}
            required
            minLength={2}
            maxLength={REPLY_MAX}
            placeholder="What happened, and what you expected."
            className="w-full bg-bg border border-border rounded p-3 text-sm text-text focus:outline-none focus:border-blue resize-y"
          />
          {errText && <p className="text-red text-xs">{errText}</p>}
          {searchParams.sent === '1' && !errText && (
            <p className="text-green text-xs">Sent. The officers see it in Discord within about ten minutes.</p>
          )}
          <button type="submit" className="px-3 py-1.5 rounded border border-blue bg-[#1f6feb] text-white text-sm">
            Send reply
          </button>
        </form>
        <p className="text-[11px] text-dim mt-3">
          <Link href="/feedback" className="text-blue hover:underline">File a new report</Link> if this is a different problem.
        </p>
      </section>
    </Shell>
  );
}
