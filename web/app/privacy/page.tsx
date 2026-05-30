// Wolf Pack — public privacy statement. Linked from the global footer and
// (when the onboarding wiring lands) from the welcome DM. The canonical text
// lives in docs/PRIVACY.md; this page mirrors it so a guildmate can read it
// without leaving wolfpack.quest. Keep the two in sync — short enough that
// duplicating the prose beats setting up MD-to-JSX rendering.

import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata = {
  title: 'Privacy — Wolf Pack EQ',
  description: 'Plain-words privacy statement for the Wolf Pack tracker and parser.',
};

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl mx-auto space-y-6 leading-relaxed">
      <header className="border-b border-border pb-4">
        <h1 className="text-2xl text-gold">🐺 Wolf Pack — Privacy, in plain words</h1>
        <p className="text-xs text-dim mt-1">
          Last updated: 2026-05-30 · Questions? <code>#feedback</code> or{' '}
          <Link href="/me" className="text-blue hover:underline">/me</Link>{' '}for what we have on you.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg text-orange">The spirit</h2>
        <p>
          This stuff exists to make raids easier to run when things get hectic — and to
          carry some of the load for the officers who prep at all hours. It is{' '}
          <strong className="text-text">not</strong> here to grade anyone. We don't track
          who caused a wipe, and we never will. Parses are for coordination and a little
          friendly fun. Healers, tanks, DPS: a rough night is just a rough night. It's a
          game. Nobody here is "not doing enough."
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg text-orange">Your data stays yours</h2>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            Your raw EverQuest logs and game files{' '}
            <strong className="text-text">stay on your device and your network.</strong>{' '}
            The tool reads them locally.
          </li>
          <li>
            Only what you opt into is ever synced — and only over an{' '}
            <strong className="text-text">authenticated</strong> connection tied to your
            Discord login.
          </li>
          <li>
            We <strong className="text-text">never</strong> upload officer chat, tells, or
            private channels. They're filtered out on your own machine before anything
            leaves it.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg text-orange">You're in control</h2>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            Pick which characters take part. Exclude any character from stats, or from
            inventory cataloguing, at any time — even one that's in another guild.{' '}
            <Link href="/me" className="text-blue hover:underline">Toggle on /me →</Link>
          </li>
          <li>Turn logging off and uploading stops. No agent running = nothing collected.</li>
          <li>
            See everything we have on you, anytime, on{' '}
            <Link href="/me" className="text-blue hover:underline">/me</Link>. Ask an
            officer to remove it and we will.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg text-orange">Who sees what</h2>
        <ul className="space-y-2">
          <li className="flex items-start gap-3">
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-purple/20 text-purple border-purple/40 font-mono mt-1">
              PRIVATE
            </span>
            <span>
              Only you. Your detailed stats, your inventory, your tells. Gated to your
              Discord login; never named anywhere else.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-blue/20 text-blue border-blue/40 font-mono mt-1">
              ANON
            </span>
            <span>
              Guild-wide totals with <strong className="text-text">no names</strong>{' '}
              (e.g. "the Pack summoned 4,000 stacks of food").
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-green/20 text-green border-green/40 font-mono mt-1">
              GUILD
            </span>
            <span>Shared with signed-in members (parses, DKP, attendance, kill timers).</span>
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg text-orange">What we keep, and why</h2>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Combat parses — coordination and friendly competition.</li>
          <li>Attendance (ticks) — fair DKP.</li>
          <li>Guild/raid chat timeline — our shared history.</li>
          <li>
            <code>/who</code> sightings — keeping the roster straight.
          </li>
          <li>
            Your stats only count from{' '}
            <strong className="text-text">when you joined us</strong> — we don't reach
            back before your first guild day. (PvP kills are public server events,
            counted from the start.)
          </li>
        </ul>
      </section>

      <section className="bg-panel border border-border rounded-lg p-5">
        <p className="text-text">
          <strong>That's it.</strong> No selling, no ads, no leaderboards of who whispered
          whom. Just tools to help the Pack run smoother on a crazy night.
        </p>
      </section>
    </article>
  );
}
