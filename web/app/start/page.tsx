// /start — the click-by-click install walkthrough.
//
// Hitya, 2026-08-28: "Run with us." on the landing page links here, and it
// wants "a click by click on what to do to get installed, setup buttons
// mentioned and deep linked to."
//
// ⚠ NOTHING HERE IS INVENTED. Every step, and every button name in bold, is
// copied from the surface it describes:
//   · steps 1-4            → commands/parsehelp.js STEPS (the Discord
//                            walkthrough, which is the guide of record)
//   · "🔧 Set up EQ for me" → apps/mimic/settings.html, with the exact keys it
//                            writes and the "close EverQuest first" warning
//   · the three failures    → CLAUDE.md's Mimic field-issue log, all n=1 reports
//                            with distinct log signatures
// If any of those change, this page is downstream of them and must follow.
// Deliberately PUBLIC: someone deciding whether to join has to be able to read
// it before they have an account (docs/DESIGN-onboarding-overhaul.md §Surface 2).
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Getting started',
  description: 'Install Wolf Pack miMIC and start uploading, step by step.',
};

const DOWNLOADS = [
  { href: '/mimic?direct=1', label: 'Download miMIC', note: 'Windows · stable', primary: true },
  { href: '/mimic/beta?direct=1', label: 'Beta', note: 'fixes land here first' },
  { href: '/mimic/linux?direct=1', label: 'Linux / Steam Deck', note: 'experimental' },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <b className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[0.9em] text-[#f2ede1]">
      {children}
    </b>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="relative border-l border-border/70 pb-8 pl-8 last:pb-0">
      <span className="absolute -left-[15px] top-0 flex h-[30px] w-[30px] items-center justify-center
                       rounded-full border border-[#d29922]/60 bg-bg font-mono text-sm text-[#d29922]">
        {n}
      </span>
      <h2 className="font-[family-name:var(--font-display)] text-xl text-[#f2ede1]">{title}</h2>
      <div className="mt-2 space-y-2 text-[0.95rem] leading-7 text-text">{children}</div>
    </li>
  );
}

export default function StartPage() {
  return (
    <div className="mx-auto max-w-[68ch] py-2">
      <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.9rem,6vw,3rem)] leading-tight text-[#f2ede1]">
        Run with us.
      </h1>
      <p className="font-[family-name:var(--font-prose)] mt-3 text-[1.05rem] leading-7 text-text">
        Everything below takes about five minutes, once. After that miMIC runs in the
        background on raid nights and you never think about it again.
      </p>

      <ol className="mt-10 list-none">
        <Step n={1} title="Download miMIC">
          <div className="flex flex-wrap gap-2 py-1">
            {DOWNLOADS.map(d => (
              <a key={d.href} href={d.href} target="_blank" rel="noreferrer"
                 className={`inline-flex flex-col rounded-md border px-4 py-2 no-underline transition-colors ${
                   d.primary
                     ? 'border-[#d29922] bg-[#d29922] text-[#1a1206] hover:bg-[#e0a92c]'
                     : 'border-border bg-panel text-text hover:border-[#d29922]'}`}>
                <span className="text-sm font-semibold">{d.label}</span>
                <span className={`text-[11px] ${d.primary ? 'text-[#1a1206]/70' : 'text-dim'}`}>{d.note}</span>
              </a>
            ))}
          </div>
          <p>
            <b className="text-[#f2ede1]">Your browser will flag it. That is expected.</b> We are not
            code-signed yet, so Windows calls the installer &ldquo;not commonly downloaded&rdquo;. It is
            not a virus.
          </p>
          <ul className="ml-5 list-disc space-y-1 marker:text-dim">
            <li><b className="text-[#f2ede1]">Edge:</b> open Downloads (<Kbd>Ctrl</Kbd>+<Kbd>J</Kbd>) → hover the file → <Kbd>⋯</Kbd> → <Kbd>Keep</Kbd> → <i>Show more</i> → <Kbd>Keep anyway</Kbd>.</li>
            <li><b className="text-[#f2ede1]">Chrome:</b> downloads bar → <Kbd>⋯</Kbd> → <Kbd>Keep</Kbd>.</li>
            <li>Running it: SmartScreen → <Kbd>More info</Kbd> → <Kbd>Run anyway</Kbd>.</li>
            <li>It installs <b className="text-[#f2ede1]">only for you</b> — no admin prompt. Click <Kbd>Install</Kbd>.</li>
            <li>Leave <Kbd>Run Wolf Pack Mimic</Kbd> ticked and click <Kbd>Finish</Kbd>.</li>
          </ul>
        </Step>

        <Step n={2} title="Sign in with Discord">
          <p>
            On first launch miMIC shows <Kbd>Step 1 · Sign in with Discord</Kbd>. Click it; your
            browser opens Discord, and you click <Kbd>Authorize</Kbd>.
          </p>
          <p>
            That links miMIC to your account and sets up your uploads on its own —{' '}
            <b className="text-[#f2ede1]">there is no token to copy or paste.</b> If it shows a
            six-character code, paste it on the page that opens; if you are already signed in here
            it fills itself in.
          </p>
        </Step>

        <Step n={3} title="Point it at EverQuest">
          <p>
            <Kbd>Step 2 · Your EverQuest folder</Kbd> — miMIC scans for it. Tick the folder it
            found, or click <Kbd>📁 Browse for your EverQuest folder…</Kbd> if yours lives somewhere
            unusual, then <Kbd>Save folder</Kbd>.
          </p>
          <p className="text-dim">
            This is your <i>EverQuest</i> folder — not the folder miMIC installed into.
          </p>
        </Step>

        <Step n={4} title="Let it set EverQuest up for you">
          <p>
            In miMIC open <Kbd>Settings</Kbd> and click <Kbd>🔧 Set up EQ for me</Kbd>. It writes{' '}
            <Kbd>Log=TRUE</Kbd> to <code className="text-dim">eqclient.ini</code> and the{' '}
            <Kbd>ExportOnCamp</Kbd> / <Kbd>PipeDelay</Kbd> / <Kbd>PipeVerbose</Kbd> keys to{' '}
            <code className="text-dim">zeal.ini</code> — the settings that make logging and live
            raid data flow.
          </p>
          <p>
            <b className="text-[#f2ede1]">Close EverQuest first.</b> The game rewrites{' '}
            <code className="text-dim">eqclient.ini</code> when it exits, so it will undo the change
            otherwise. Already in game? Type <Kbd>/log on</Kbd> to log this session; the Zeal
            settings take effect next launch.
          </p>
        </Step>

        <Step n={5} title="Open the dashboard">
          <p>
            Click <Kbd>Open dashboard</Kbd>. You are now uploading — that is the whole setup.
          </p>
          <p>
            You also get the DPS meter, trigger callouts with speech, timers, the charm and pet
            trackers, buff and zone tracking, private tells, and UI Studio to back up your EQ
            layout. Turn any overlay on from the tray icon or the dashboard&rsquo;s Overlays tab.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/me" className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm no-underline text-text transition-colors hover:border-[#d29922]">Your record →</Link>
            <Link href="/parses" className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm no-underline text-text transition-colors hover:border-[#d29922]">Raid parses →</Link>
            <Link href="/raid" className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm no-underline text-text transition-colors hover:border-[#d29922]">Raid HQ →</Link>
          </div>
        </Step>
      </ol>

      {/* Every entry below is a real report with a distinct log signature. Three
          different causes look identical from the outside — "Zeal isn't working"
          — which is why each one names its own symptom. */}
      <section className="mt-4 rounded-lg border border-border bg-panel p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg text-[#f2ede1]">If something is off</h2>
        <dl className="mt-3 space-y-3 text-[0.95rem] leading-7">
          <div>
            <dt className="text-[#f2ede1]">Live raid data never arrives, and the log repeats <code className="text-dim">EPERM</code></dt>
            <dd className="text-text">
              Right-click <code className="text-dim">eqgame.exe</code> → Properties → Compatibility, and
              untick <b className="text-[#f2ede1]">Run this program in compatibility mode for</b>. A
              popular crash-reduction checklist recommends XP mode, and it blocks the Zeal
              connection outright. Check this one first.
            </dd>
          </div>
          <div>
            <dt className="text-[#f2ede1]">miMIC cannot find Zeal at all</dt>
            <dd className="text-text">
              Reinstall miMIC <b className="text-[#f2ede1]">outside</b> your EverQuest folder.
              Installing it inside the game folder can shadow the files Zeal needs.
            </dd>
          </div>
          <div>
            <dt className="text-[#f2ede1]">It connects, then drops immediately</dt>
            <dd className="text-text">
              Check whether EverQuest is running as administrator while miMIC is not, or the other
              way round. They need to match. That checkbox sits on the same Compatibility tab as the
              one above, so check them separately.
            </dd>
          </div>
          <div>
            <dt className="text-[#f2ede1]">Nothing above fits</dt>
            <dd className="text-text">
              Tell us on <Link href="/feedback" className="text-[#d29922] no-underline hover:underline">the feedback page</Link> or
              in Discord. Include what the dashboard says — that is usually enough to name it.
            </dd>
          </div>
        </dl>
      </section>

      <p className="mt-6 text-sm leading-6 text-dim">
        miMIC filters at the byte level before anything is parsed: officer chat, tells, group chat
        and custom channels never leave your machine.{' '}
        <Link href="/privacy" className="text-[#d29922] no-underline hover:underline">What we collect →</Link>
        {' · '}
        <Link href="/platform" className="text-[#d29922] no-underline hover:underline">The whole platform →</Link>
      </p>
    </div>
  );
}
