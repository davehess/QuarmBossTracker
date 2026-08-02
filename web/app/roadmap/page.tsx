// Public roadmap — no sign-in required, so anyone in the guild (or curious
// applicant) can see what shipped and what's next without going to GitHub.
// Content lives in web/lib/roadmapData.ts; the technical mirror (file paths,
// version numbers) lives in docs/roadmap.md for anyone who does want the
// GitHub-level detail.

import SprintBoard from '@/components/SprintBoard';
import { releases, queueItems, sprintMeta, type QueueItem } from '@/lib/roadmapData';

export const dynamic = 'force-static';

export const metadata = {
  title: 'Roadmap — Wolf Pack EQ',
  description: 'What shipped recently and what\'s next for the Wolf Pack tracker + Mimic.',
};

// Effort tiers for the What's-next queue — ordered quick → complex on the
// page, per Hitya 2026-08-02.
const EFFORT_ORDER = ['quick', 'medium', 'large'] as const;
const EFFORT_LABELS: Record<QueueItem['effort'], string> = {
  quick:  '⚡ Quick wins',
  medium: '🔨 Medium builds',
  large:  '⛰️ Big rocks',
};
const EFFORT_BLURBS: Record<QueueItem['effort'], string> = {
  quick:  'Small, contained changes — each is an evening, not a project.',
  medium: 'Real features with a design behind them — a focused week each.',
  large:  'The shape-of-the-platform work — multi-week, staged, worth it.',
};
// Component chips reuse the platform-map palette so "what does this touch"
// reads the same here as on /platform.
const COMPONENT_STYLES: Record<string, string> = {
  Bot:      'bg-blue/15 text-blue border-blue/40',
  Web:      'bg-green/15 text-green border-green/40',
  Agent:    'bg-orange/15 text-orange border-orange/40',
  Mimic:    'bg-purple/15 text-purple border-purple/40',
  Database: 'bg-gold/15 text-gold border-gold/40',
  Upstream: 'bg-red/15 text-red border-red/40',
};

export default function RoadmapPage() {
  return (
    <article className="max-w-4xl mx-auto space-y-10 leading-relaxed">
      <header className="border-b border-border pb-4">
        <h1 className="text-2xl text-gold">🗺️ Wolf Pack roadmap</h1>
        <p className="text-sm text-dim mt-1">
          What we said we'd build, what actually shipped, and what's coming next — the
          plain-language version. Nothing here requires a GitHub login to read.
        </p>
      </header>

      <section className="space-y-6">
        <h2 className="text-lg text-orange">What&apos;s next — quick to complex</h2>
        <p className="text-sm text-dim">
          The open queue, straight from the design docs — smallest first. The chips
          say which parts of the platform each one touches; a note underneath carries
          the one fact worth knowing (design ready, blocked on something, parked).
        </p>
        {EFFORT_ORDER.map((tier) => (
          <div key={tier} className="space-y-3">
            <div>
              <h3 className="text-base text-text font-semibold">{EFFORT_LABELS[tier]}</h3>
              <p className="text-xs text-dim">{EFFORT_BLURBS[tier]}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {queueItems.filter((q) => q.effort === tier).map((q) => (
                <article key={q.key} className="bg-panel border border-border rounded-lg p-4 space-y-2">
                  <header className="flex flex-wrap items-center gap-1.5">
                    <h4 className="text-sm text-gold font-semibold mr-auto">{q.title}</h4>
                    {q.components.map((c) => (
                      <span key={c} className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${COMPONENT_STYLES[c] || 'bg-panel text-dim border-border'}`}>
                        {c}
                      </span>
                    ))}
                  </header>
                  <p className="text-xs text-dim leading-5">{q.summary}</p>
                  {q.status && (
                    <p className="text-[11px] text-blue italic">{q.status}</p>
                  )}
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg text-orange">The July sprint, by the numbers</h2>
        <p className="text-sm text-dim">
          Four days ({sprintMeta.window}), every numbered item below shipped and verified.
          Sort by phase, complexity, or number — the colored dots say which part of the{' '}
          <a href="/platform" className="text-blue hover:underline">platform</a> each change
          focused on (same colors as the platform map). {sprintMeta.versions}.
        </p>
        <SprintBoard />
        <div className="bg-panel border border-border rounded-lg p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-red">What the new safety gates already caught</div>
          {sprintMeta.lintFinds.map((f, i) => (
            <p key={i} className="text-xs text-dim leading-5">{f}</p>
          ))}
        </div>
        <div className="bg-panel border border-border rounded-lg p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-green">On beta? Here&apos;s what to watch for (and report in #feedback)</div>
          <ul className="space-y-1 list-disc list-inside">
            {sprintMeta.watchList.map((w, i) => (
              <li key={i} className="text-xs text-dim leading-5">{w}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg text-orange">Recently shipped</h2>
        <p className="text-sm text-dim">
          The release log — newest first. Each release lists the headline features in plain
          language, with the bug fixes tucked at the bottom.
        </p>
        <div className="space-y-4">
          {releases.map((r) => (
            <article key={r.key} className="bg-panel border border-border rounded-lg p-5 space-y-3">
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-base text-text font-semibold">{r.title}</h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-green/15 text-green border-green/40">
                  {r.version}
                </span>
                {r.channel === 'beta' && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-orange/15 text-orange border-orange/40">beta</span>
                )}
                <span className="text-[10px] text-dim ml-auto">{r.date}</span>
              </header>
              <p className="text-sm text-dim italic">{r.headline}</p>
              <ul className="space-y-1.5">
                {r.features.map((f) => (
                  <li key={f.name} className="text-sm text-text leading-6">
                    <span className="text-gold font-semibold">{f.name}</span>
                    <span className="text-dim"> — {f.blurb}</span>
                  </li>
                ))}
              </ul>
              {r.fixes.length > 0 && (
                <div className="pt-2 border-t border-border/60">
                  <div className="text-[11px] uppercase tracking-wide text-blue mb-1">Bug fixes</div>
                  <ul className="space-y-1 list-disc list-inside">
                    {r.fixes.map((fix, i) => (
                      <li key={i} className="text-xs text-dim leading-5">{fix}</li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="bg-panel border border-border rounded-lg p-5">
        <p className="text-sm text-text">
          Want the developer-level detail — exact file paths, version numbers, open
          design questions? It's all public on{' '}
          <a
            href="https://github.com/davehess/QuarmBossTracker/blob/main/docs/roadmap.md"
            target="_blank"
            rel="noreferrer"
            className="text-blue hover:underline"
          >
            GitHub
          </a>
          . Ideas or feedback of your own?{' '}
          <a href="/feedback" className="text-blue hover:underline">Drop it here</a>.
        </p>
      </section>
    </article>
  );
}
