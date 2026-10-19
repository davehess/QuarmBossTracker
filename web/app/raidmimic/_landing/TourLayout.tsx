// The raidmimic layout, "The tour" (the guild lead's pick, 2026-10-19): screens first. Four product moments, each a drawn picture beside one plain
// sentence, alternating sides down the page, then the four facts (works with, your data, cost,
// worlds) folded into one-line accordions so the pictures stay the page and the small print stays one tap away.
// Every word comes from web/lib/raidmimicLanding.ts.
import { ILLUSTRATIVE_NOTE, MOMENTS, COST, DATA, WORKS_WITH, WORLDS } from '@/lib/raidmimicLanding';
import {
  BetaTag, ComingList, CostBody, CtaBand, DataBody, Footer, Hero, StatusChip,
  WorksWithBody, WorldsBody, type Ctx,
} from './Parts';
import { Figure } from './Figures';
import type { ReactNode } from 'react';

function Fold({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <details id={id} className="scroll-mt-4 rounded-md border border-border bg-panel px-4">
      <summary className="flex min-h-11 cursor-pointer items-center text-base text-[#f2ede1]">{title}</summary>
      <div className="pb-4 pt-1">{children}</div>
    </details>
  );
}

export default function TourLayout({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mx-auto max-w-5xl pb-12">
      <BetaTag ctx={ctx} />
      <Hero ctx={ctx} compact />

      <section aria-label="Four moments" className="space-y-10">
        {MOMENTS.map((m, i) => (
          <article key={m.id} id={`moment-${m.id}`} className="grid scroll-mt-4 items-center gap-5 md:grid-cols-2 md:gap-8">
            <div className={i % 2 === 1 ? 'md:order-2' : ''}><Figure k={m.figure} /></div>
            <div>
              <div className="mb-2"><StatusChip status={m.status} /></div>
              <h2 className="text-xl text-[#f2ede1]">{m.title}</h2>
              <p className="mt-2 max-w-[44ch] text-sm leading-6 text-text">{m.line}</p>
            </div>
          </article>
        ))}
        <p className="text-xs text-dim">{ILLUSTRATIVE_NOTE}</p>
      </section>

      <section aria-label="The small print" className="mt-12 space-y-2">
        <Fold id="works-with" title={WORKS_WITH.title}><WorksWithBody /></Fold>
        <Fold id="data" title={DATA.title}><DataBody /></Fold>
        <Fold id="cost" title={COST.title}><CostBody /></Fold>
        <Fold id="worlds" title={WORLDS.title}><WorldsBody /></Fold>
      </section>

      <div className="mt-10"><ComingList /></div>
      <div className="mt-4"><CtaBand ctx={ctx} /></div>

      <Footer />
    </div>
  );
}
