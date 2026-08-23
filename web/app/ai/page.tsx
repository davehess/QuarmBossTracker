// /ai — how this platform is built and maintained by AI sessions.
//
// Hitya 2026-08-23: "publish all of this detail to wolfpack.quest/ai … human
// and agent readable … any agentic workflow could review that page and
// understand our methodology … without GitHub access, but if the agent has
// GitHub access it could see the full picture and set up its own workflow to
// match."
//
// So it is written for three readers at once:
//   1. a person — the page below;
//   2. an agent with no repo access — /ai.txt (plain markdown) and /ai.json,
//      linked in <head> as alternates and stated in the first section so a
//      crawler that only reads text still finds them;
//   3. an agent WITH repo access — every rule links to the file it lives in and
//      every milestone to its commit, so the page is an index into the repo
//      rather than a copy of it.
//
// Deliberately public and un-gated, like /platform: it describes method, never
// member data. All content comes from lib/aiMethodology.ts — never write
// methodology prose into this file, or the JSON and text views will drift.
import type { Metadata } from 'next';
import Link from 'next/link';
import AiMethodology from '@/components/AiMethodology';
import AiWorkflowTree from '@/components/AiWorkflowTree';
import {
  MILESTONES, PRINCIPLES, WORKFLOW, GATES, METHOD_NOTES, MEASURED,
  TIMELINE, REPO_URL, fileUrl,
} from '@/lib/aiMethodology';

export const metadata: Metadata = {
  title: 'How we build this with AI — wolfpack.quest',
  description:
    'The working method behind a four-component guild platform built almost entirely by AI sessions: the rules, the incident behind each one, the verification gate, and a timeline you can scrub.',
  alternates: {
    canonical: 'https://wolfpack.quest/ai',
    types: {
      'text/markdown': 'https://wolfpack.quest/ai.txt',
      'application/json': 'https://wolfpack.quest/ai.json',
    },
  },
};

const SOURCE_DOCS = [
  ['CLAUDE.md', 'Architecture, release routing, scope boundaries. Outranks the README where they disagree.'],
  ['docs/GEMINI-SPARK-HELPER.md', 'Working guide for an agentic session with repo and shell access.'],
  ['docs/AI-CONTRIBUTOR-BRIEF.md', 'Self-contained brief for a chat assistant with no repo access.'],
  ['docs/HOW-ITS-BUILT.md', 'Feature → file and surface index. Read before concluding something does not exist.'],
  ['docs/STATUS.md', 'The ledger: done, queued, abandoned, and what needs a machine we do not have.'],
  ['docs/PRIVACY.md', 'What leaves a player’s machine, and what never does.'],
] as const;

export default function AiPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    name: 'How Wolf Pack builds and maintains its platform with AI sessions',
    url: 'https://wolfpack.quest/ai',
    dateModified: MEASURED.asOf,
    codeRepository: REPO_URL,
    abstract:
      'A working method for AI-assisted development: standing rules with the incident behind each, a verification gate, a task decision tree, and a scrubbable adoption timeline.',
    encoding: [
      { '@type': 'MediaObject', encodingFormat: 'text/markdown', contentUrl: 'https://wolfpack.quest/ai.txt' },
      { '@type': 'MediaObject', encodingFormat: 'application/json', contentUrl: 'https://wolfpack.quest/ai.json' },
    ],
  };

  return (
    <div className="space-y-12 pb-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="pt-2 space-y-4">
        <p className="text-[11px] uppercase tracking-[0.2em] text-dim">Method</p>
        <h1 className="text-3xl md:text-4xl text-gold font-bold tracking-tight leading-tight">
          Every rule here started as something going wrong.
        </h1>
        <p className="max-w-3xl text-sm md:text-base leading-7 text-text">
          Wolf Pack runs a four-component platform — a Discord bot, a website, a log-parsing
          agent on each raider&rsquo;s PC, and a desktop overlay app — built and maintained almost
          entirely by AI coding sessions that <em className="text-blue not-italic">cannot see each other&rsquo;s
          conversations</em>. What holds it together is not a clever prompt. It is a set of
          written rules, each one adopted the day a specific failure made it necessary, and a
          verification gate that runs before anything ships.
        </p>
        <p className="max-w-3xl text-sm md:text-base leading-7 text-dim">
          This page is that method, in full. Scrub the timeline to watch it accumulate.
        </p>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 max-w-3xl">
          {[
            [MEASURED.commits.toLocaleString(), 'commits'],
            [MEASURED.tests.toLocaleString(), 'tests'],
            [String(MEASURED.docs), 'documents'],
            [String(PRINCIPLES.length), 'standing rules'],
          ].map(([n, label]) => (
            <div key={label} className="rounded-lg border border-border bg-panel px-3 py-2.5">
              <dt className="text-xl text-text tabular-nums">{n}</dt>
              <dd className="text-[11px] uppercase tracking-wider text-dim">{label}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-dim">
          Measured {MEASURED.asOf}, first commit {MEASURED.firstCommit}. Numbers here are counted, never estimated.
        </p>
      </section>

      {/* ── For agents ─────────────────────────────────────────────────── */}
      <section
        id="for-agents"
        className="rounded-lg border border-blue/30 bg-blue/[0.04] p-4 md:p-5 space-y-3"
      >
        <h2 className="text-sm uppercase tracking-wider text-blue">If you are an agent reading this</h2>
        <p className="text-sm leading-6 text-text">
          Three levels of access, three ways in. All of them describe the same method.
        </p>
        <ol className="space-y-2 text-sm leading-6">
          <li>
            <span className="text-dim">No repo access —</span>{' '}
            fetch <a href="/ai.txt" className="text-blue hover:underline">/ai.txt</a> (plain markdown,
            the whole method in one document) or{' '}
            <a href="/ai.json" className="text-blue hover:underline">/ai.json</a>{' '}
            (structured: rules, milestones, workflow stages, gates). Everything on this page is in both.
          </li>
          <li>
            <span className="text-dim">Repo access —</span>{' '}
            clone <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-blue hover:underline break-all">{REPO_URL}</a>{' '}
            and read <code className="text-text">CLAUDE.md</code> then{' '}
            <code className="text-text">docs/GEMINI-SPARK-HELPER.md</code>. Those are authoritative; this page is
            an index into them.
          </li>
          <li>
            <span className="text-dim">Setting up your own workflow —</span>{' '}
            the decision tree below is the procedure, and the gate is the part that is not optional.
            Adopt the shape, not the specifics: your project&rsquo;s rules should come from your own
            incidents, not ours.
          </li>
        </ol>
        <p className="text-[12px] leading-6 text-dim">
          One caveat worth carrying: this method suits a repo with two very large single files, a
          small number of readers, and consequences that land on a schedule. Some of it would be
          overhead somewhere else.
        </p>
      </section>

      {/* ── Timeline + rules (interactive) ─────────────────────────────── */}
      <section id="timeline" className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl text-gold">How the method accumulated</h2>
          <p className="max-w-3xl text-sm leading-7 text-dim">
            Every node is a real commit. Drag the slider back and rules un-adopt: the lit rail is the
            method as it stood on that date, and the dimmed cards are rules that had not been learned
            yet. <span className="text-orange/80">Orange is what went wrong</span>,{' '}
            <span className="text-green/80">green is the rule that came out of it</span>,{' '}
            <span className="text-blue">blue is the commit that implemented it</span>.
          </p>
        </div>
        <AiMethodology milestones={TIMELINE} principles={PRINCIPLES} />
      </section>

      {/* ── Workflow tree ──────────────────────────────────────────────── */}
      <section id="workflow" className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl text-gold">One task, start to finish</h2>
          <p className="max-w-3xl text-sm leading-7 text-dim">
            The procedure every session follows, with the branch points drawn as branches. This is
            the part to copy if you are building your own loop.
          </p>
        </div>
        <AiWorkflowTree stages={WORKFLOW} />
      </section>

      {/* ── Gate ───────────────────────────────────────────────────────── */}
      <section id="gate" className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl text-gold">The gate</h2>
          <p className="max-w-3xl text-sm leading-7 text-dim">
            Five checks. Three block CI; two do not, which means the only other place they fail is
            the deploy — so they are run by hand, every time.
          </p>
        </div>
        <div className="space-y-2">
          {GATES.map(g => (
            <div key={g.command} className="rounded-lg border border-border bg-panel px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <code className="text-[13px] text-green">{g.command}</code>
                <span
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    g.inCi
                      ? 'border-green/30 text-green/80 bg-green/5'
                      : 'border-orange/40 text-orange/85 bg-orange/5'
                  }`}
                >
                  {g.inCi ? 'blocks CI' : 'not in CI — run it yourself'}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] leading-6 text-dim">{g.protects}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Notes ──────────────────────────────────────────────────────── */}
      <section id="notes" className="space-y-4">
        <h2 className="text-xl text-gold">How the work is written</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {METHOD_NOTES.map(n => (
            <article key={n.title} className="rounded-lg border border-border bg-panel p-4">
              <h3 className="text-sm text-text">{n.title}</h3>
              <p className="mt-2 text-[13px] leading-6 text-dim">{n.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Source docs ────────────────────────────────────────────────── */}
      <section id="sources" className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl text-gold">The documents themselves</h2>
          <p className="max-w-3xl text-sm leading-7 text-dim">
            This page restates them; it does not replace them. A test asserts that every rule above
            still quotes text that actually appears in the file it cites, so the two cannot drift
            apart silently.
          </p>
        </div>
        <ul className="space-y-2">
          {SOURCE_DOCS.map(([path, what]) => (
            <li key={path} className="rounded-lg border border-border bg-panel px-4 py-3">
              <a
                href={fileUrl(path)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-blue hover:underline break-all"
              >
                {path}
              </a>
              <p className="mt-1 text-[13px] leading-6 text-dim">{what}</p>
            </li>
          ))}
        </ul>
        <p className="text-[13px] leading-6 text-dim">
          More context on what the platform actually is:{' '}
          <Link href="/platform" className="text-blue hover:underline">the platform map</Link>,{' '}
          <Link href="/roadmap" className="text-blue hover:underline">the release log</Link>, and{' '}
          <Link href="/privacy" className="text-blue hover:underline">what we collect</Link>.
        </p>
      </section>

      <p className="text-[11px] text-dim border-t border-border pt-4">
        {MILESTONES.length} milestones · {PRINCIPLES.length} rules · {WORKFLOW.length} workflow stages ·
        machine-readable at <a href="/ai.json" className="text-blue hover:underline">/ai.json</a> and{' '}
        <a href="/ai.txt" className="text-blue hover:underline">/ai.txt</a>
      </p>
    </div>
  );
}
