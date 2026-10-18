// Layout A, "The pitch" (the default): a guild-leader landing page that reads top to bottom as an argument.
// Hero line, what it does in six blocks, what it works with and what happens to your data side by side, what it
// costs, which worlds, what is not built yet, then the one ask. Text-led; the page is the pitch, not a demo.
import {
  BetaTag, BlockGrid, ComingList, CostBody, CtaBand, DataBody, Footer, Hero, Panel, SectionHead, VariantSwitch,
  WorksWithBody, WorldsBody, type Ctx,
} from './Parts';
import { BLOCKS_LEAD, BLOCKS_TITLE, COST, DATA, WORKS_WITH, WORLDS } from '@/lib/raidmimicLanding';

export default function PitchLayout({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mx-auto max-w-5xl pb-12">
      <VariantSwitch ctx={ctx} current="a" />
      <BetaTag ctx={ctx} />
      <Hero ctx={ctx} />

      <section className="mt-10" aria-label={BLOCKS_TITLE}>
        <SectionHead id="what" title={BLOCKS_TITLE} lead={BLOCKS_LEAD} />
        <BlockGrid />
      </section>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <Panel id="works-with" title={WORKS_WITH.title}><WorksWithBody /></Panel>
        <Panel id="data" title={DATA.title}><DataBody /></Panel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Panel id="cost" title={COST.title}><CostBody /></Panel>
        <Panel id="worlds" title={WORLDS.title}><WorldsBody /></Panel>
      </div>

      <div className="mt-10"><ComingList /></div>
      <div className="mt-4"><CtaBand ctx={ctx} /></div>

      <Footer />
    </div>
  );
}
