// Anonymous feedback form, served at eqmimic.quest (and /eqmimic/feedback here, for testing).
// Neutral on purpose (the guild lead, 2026-10-08): no Wolf Pack name or imagery, no sign-in, and
// middleware.ts sends /feedback on that host here (every other path there gets the landing page). Submissions are cleaned and stored as AFB-<n>
// (see actions.ts + lib/anonFeedbackClean.ts); they never touch the `feedback` table or Discord.

import AnonFeedbackForm from './AnonFeedbackForm';

export const metadata = {
  title: { absolute: 'Mimic — send feedback' },
  description: 'Send a bug report or an idea about Mimic. Anonymous unless you leave a Discord name.',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Mimic — send feedback',
    description: 'Send a bug report or an idea about Mimic.',
    siteName: 'Mimic',
    type: 'website' as const,
  },
  twitter: { card: 'summary' as const },
};

export default function EqmimicFeedbackPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5 py-4">
      <div>
        <h1 className="text-2xl text-text">Mimic — send feedback</h1>
        <p className="text-sm text-dim mt-1 leading-6">
          Tell us what broke or what you would like Mimic to do. This is anonymous: no sign-in, and
          nothing identifies you unless you choose to leave a Discord name below.
        </p>
      </div>
      <AnonFeedbackForm />
      <div className="text-[11px] text-dim leading-5 border-t border-border pt-3">
        Before anything is saved, links and web addresses, email addresses, IP addresses, anything that
        looks like a password or key, file paths that contain a user name, HTML, and code-like text
        (such as database commands) are removed from what you wrote. We also keep a scrambled, one-way
        form of your network address with the report for one day, used only to limit how often one person
        can send; after that it is erased.
      </div>
    </div>
  );
}
