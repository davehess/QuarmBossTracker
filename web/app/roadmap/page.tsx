// Public roadmap — no sign-in required, so anyone in the guild (or curious
// applicant) can see what shipped and what's next without going to GitHub.
// Content lives in web/lib/roadmapData.ts; the technical mirror (file paths,
// version numbers) lives in docs/roadmap.md for anyone who does want the
// GitHub-level detail.

import RoadmapFeatureCard from '@/components/RoadmapFeatureCard';
import { retroSummary, retroItems, recentFeatures, nearTermItems } from '@/lib/roadmapData';

export const dynamic = 'force-static';

export const metadata = {
  title: 'Roadmap — Wolf Pack EQ',
  description: 'What shipped recently and what\'s next for the Wolf Pack tracker + Mimic.',
};

const HIT_STYLES: Record<string, string> = {
  shipped:  'bg-green/20 text-green border-green/40',
  reworked: 'bg-blue/20 text-blue border-blue/40',
  open:     'bg-orange/20 text-orange border-orange/40',
};
const HIT_LABELS: Record<string, string> = {
  shipped:  'Shipped',
  reworked: 'Solved differently',
  open:     'Still open',
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

      <section className="space-y-4">
        <h2 className="text-lg text-orange">Did we hit the last roadmap?</h2>
        <div className="bg-panel border border-border rounded-lg p-5 space-y-2">
          <p className="text-text font-semibold">{retroSummary.headline}</p>
          <p className="text-sm text-dim">{retroSummary.blurb}</p>
        </div>
        <ul className="space-y-2">
          {retroItems.map((item) => (
            <li
              key={item.title}
              className="flex items-start gap-3 bg-panel/60 border border-border/60 rounded-lg p-3"
            >
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono mt-0.5 shrink-0 ${HIT_STYLES[item.hit]}`}>
                {HIT_LABELS[item.hit]}
              </span>
              <div className="min-w-0">
                <div className="text-sm text-text font-semibold">{item.title}</div>
                <div className="text-xs text-dim mt-0.5">{item.note}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg text-orange">Recently shipped</h2>
        <p className="text-sm text-dim">
          The most recent batch of fixes and features, newest ideas at the bottom of this
          list feeding straight into what's next below.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recentFeatures.map((f) => (
            <RoadmapFeatureCard key={f.key} feature={f} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg text-orange">What's next</h2>
        <p className="text-sm text-dim">
          The near-term queue — some of these are scoped and about to start, others are
          still being figured out. Tags below reflect how close each one is.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {nearTermItems.map((f) => (
            <RoadmapFeatureCard key={f.key} feature={f} />
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
