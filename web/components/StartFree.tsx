// The "Free to start" block at the top of the raidmimic.com onboarding pages (preview on beta, web/lib/raidmimicStartFree.ts).
// ?v=b: one short card, readable at a glance. ?v=c: a two-column table of what is free and what a plan will pay for, with
// the reason each costs money. A server component; the words live in the lib file.
import { FREE_ROWS, PAID_ROWS, START_FREE as W, type StartFreeVariant } from '@/lib/raidmimicStartFree';
import { GUILD_PRICE, priceLabel } from '@/lib/raidmimicStory';

function Chip() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-green/60 px-2.5 py-0.5 text-xs uppercase tracking-widest text-green">
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-green" />{W.chip}
    </span>
  );
}

function Rows({ rows }: { rows: readonly { what: string; why: string }[] }) {
  return (
    <ul className="m-0 mt-2 list-none space-y-2 p-0">
      {rows.map(r => (
        <li key={r.what} className="text-sm leading-6">
          <span className="block text-text">{r.what}</span>
          <span className="block text-xs leading-5 text-dim">{r.why}</span>
        </li>
      ))}
    </ul>
  );
}

export default function StartFree({ variant, pricingHref }: { variant: StartFreeVariant; pricingHref: string }) {
  if (variant === 'b') {
    return (
      <section aria-label={W.chip} className="mb-6 rounded-md border border-green/50 bg-panel p-4">
        <Chip />
        <p className="mt-2 max-w-[62ch] text-base leading-7 text-text">{W.lead}</p>
        <p className="mt-1 max-w-[62ch] text-sm leading-6 text-text">{W.free}</p>
        <p className="mt-1 max-w-[62ch] text-sm leading-6 text-dim">{W.planned} <strong className="font-semibold text-text">{W.promise}</strong></p>
        <p className="mt-2"><a href={pricingHref} className="inline-flex min-h-11 items-center text-sm">{W.more} →</a></p>
      </section>
    );
  }
  return (
    <section aria-label={W.tableTitle} className="mb-6 rounded-md border border-border bg-panel p-4 sm:p-5">
      <Chip />
      <h2 className="mt-2 text-lg leading-tight text-gold">{W.tableTitle}</h2>
      <p className="mt-1 max-w-[62ch] text-sm leading-6 text-text">{W.tableLead}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-green/50 bg-bg p-3">
          <h3 className="m-0 text-sm text-green">Free · $0</h3>
          <Rows rows={FREE_ROWS} />
        </div>
        <div className="rounded-md border border-blue/50 bg-bg p-3">
          <h3 className="m-0 text-sm text-blue">Pro · Guild · {priceLabel(GUILD_PRICE)} <span className="text-dim">(planned)</span></h3>
          <Rows rows={PAID_ROWS} />
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-text"><strong className="font-semibold">{W.promise}</strong> <span className="text-dim">{W.individual}</span></p>
      <p className="mt-1"><a href={pricingHref} className="inline-flex min-h-11 items-center text-sm">{W.more} →</a></p>
    </section>
  );
}
