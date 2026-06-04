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

      <section className="space-y-3 bg-panel border border-green/40 rounded-lg p-5">
        <h2 className="text-lg text-green">Is it a keylogger? Is it a virus?</h2>
        <p>
          Short answer: <strong className="text-text">no — and you don't have to take our
          word for it.</strong> The cautious instinct is healthy, so here's exactly what it
          is and how to prove it to yourself.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong className="text-text">It reads EverQuest's log file — not your keyboard.</strong>{' '}
            When you turn on logging (<code>/log on</code>), EverQuest writes everything to a
            text file. Mimic just <em>reads that file</em>. It does{' '}
            <strong className="text-text">not</strong> record keystrokes, watch your screen,
            or see your browser, passwords, or anything outside EverQuest. A keylogger hooks
            your whole keyboard — Mimic literally only opens EQ's own log.
          </li>
          <li>
            <strong className="text-text">It's an ordinary app, not a virus.</strong> No admin
            rights, no drivers, no Windows services, no changes to system files or startup. It
            installs to your own user folder and uninstalls cleanly. It can't touch other
            programs or your operating system.
          </li>
          <li>
            <strong className="text-text">It's 100% open source.</strong> Every line is public —{' '}
            <a href="https://github.com/davehess/QuarmBossTracker" target="_blank" rel="noreferrer" className="text-blue hover:underline">read it on GitHub</a>.
            People who write keyloggers don't publish their code. Have any techy friend look;
            what you see is what it does.
          </li>
        </ul>
        <p className="text-sm">Don't trust us — <strong className="text-text">verify</strong>:</p>
        <ul className="list-disc pl-6 space-y-2 text-sm">
          <li>
            Scan the installer on <a href="https://www.virustotal.com" target="_blank" rel="noreferrer" className="text-blue hover:underline">VirusTotal</a>.
            (Heads up: an unsigned installer can trip one or two over-cautious heuristics —
            that's the "not code-signed yet" thing below, not a real virus.)
          </li>
          <li>
            Open Task Manager / Resource Monitor — it's one app, talking to one server (our
            guild's bot) plus GitHub for updates. Nothing else.
          </li>
          <li>
            The local dashboard shows you <strong className="text-text">exactly</strong> what
            it uploads, live. The pending-upload file on your disk is plain readable text.
          </li>
        </ul>
        <p className="text-sm text-dim">
          And that scary <strong className="text-text">"unknown publisher"</strong> popup?
          That's paperwork, not danger — Windows warns about any app that hasn't paid for a
          code-signing certificate yet. It says nothing about safety, and we're sorting the
          signing out.
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
