// The pieces the raidmimic.com landing page is assembled from. Every sentence comes from web/lib/raidmimicLanding.ts;
// this file only decides how a block LOOKS. Server components, no client JS: the tour's small print is <details>.
//
// Colour is semantic, as everywhere (frontend-design): gold is the one action, green is "live today", purple is
// "in alpha", and a dashed orange chip is "coming" so a promise is never dressed up as a feature.
import NewPageTag from '@/components/NewPageTag';
import {
  COMING, COMING_TITLE, COST, CTA, DATA, FAN_PROJECT_LINE, HERO, PRIVACY_URL, REPO_URL, RIGHTS_NOTICE,
  SELFHOST_NOTE_URL, STATUS_LABEL, WORKS_WITH, WORLDS, EQMIMIC_ORIGIN,
  type Status,
} from '@/lib/raidmimicLanding';

/** Links that differ between the raidmimic host and the Wolf Pack hosts (where /feedback is a different page). */
export interface Ctx {
  onHost: boolean;      // served on a raidmimic host (bare shell, no query string, no Wolf Pack header)
  interest: string;     // the Register-interest address
  setup: string;        // the set-up guide: /setup on a raidmimic host, /raidmimic/setup on the Wolf Pack hosts
}

const BTN = 'inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold no-underline transition-colors motion-reduce:transition-none';
export const PRIMARY_BTN = `${BTN} border-gold bg-gold text-[#1a1206] hover:bg-[#e0a92c] hover:no-underline`;
const EXT = { target: '_blank', rel: 'noreferrer' } as const;

const CHIP: Record<Status, string> = {
  live: 'border-green/60 text-green',
  alpha: 'border-purple/60 text-purple',
  coming: 'border-dashed border-orange/80 text-orange',
};

export function StatusChip({ status }: { status: Status }) {
  return (
    <span data-status={status} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] leading-4 tracking-wide ${CHIP[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────────────────────────────
// `NewPageTag` heads the page (CLAUDE.md: a new page ships live, marked [beta]). Its feedback link is /feedback,
// which on a raidmimic host is not a page, so there it points at the Register-interest form instead.
export function BetaTag({ ctx }: { ctx: Ctx }) {
  return <NewPageTag note="New page, a first draft, still being shaped." href={ctx.onHost ? ctx.interest : '/feedback'} />;
}

export function InterestButton({ ctx, className = PRIMARY_BTN }: { ctx: Ctx; className?: string }) {
  return <a href={ctx.interest} className={className} {...(ctx.onHost ? EXT : {})}>{CTA.button}</a>;
}

export function Hero({ ctx, compact = false }: { ctx: Ctx; compact?: boolean }) {
  return (
    <header className="mb-8">
      <p className="text-xs uppercase tracking-widest text-gold">{HERO.kicker}</p>
      <h1 className={`mt-1 leading-tight text-[#f2ede1] ${compact ? 'text-3xl' : 'text-4xl sm:text-5xl'}`}>{HERO.name}</h1>
      <p className={`mt-3 max-w-[60ch] leading-7 text-[#f2ede1] ${compact ? 'text-base' : 'text-lg sm:text-xl sm:leading-8'}`}>{HERO.line}</p>
      <p className="mt-3 max-w-[66ch] text-sm leading-6 text-text">{HERO.honest}</p>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <InterestButton ctx={ctx} />
        <a href={ctx.setup} className="inline-flex min-h-11 items-center text-sm">Set it up yourself →</a>
        <a href="#coming" className="inline-flex min-h-11 items-center text-sm">{COMING_TITLE}</a>
      </div>
      <p className="mt-4 max-w-[66ch] text-xs leading-5 text-dim">
        {HERO.playerLine}{' '}
        <a href={EQMIMIC_ORIGIN} {...EXT}>eqmimic.quest</a>
      </p>
    </header>
  );
}

// ─── Works with / data / cost / worlds (each: the full body) ──────────
export function WorksWithBody() {
  return (
    <>
      <p className="text-sm leading-6 text-text">{WORKS_WITH.lead}</p>
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
        {WORKS_WITH.tools.map(t => <li key={t} className="rounded border border-border bg-bg px-2.5 py-1 text-xs text-[#f2ede1]">{t}</li>)}
      </ul>
      <p className="mt-3 text-sm leading-6 text-text">{WORKS_WITH.extra}</p>
      <p className="mt-2 text-xs leading-5 text-dim">{WORKS_WITH.rights}</p>
    </>
  );
}

export function DataBody() {
  return (
    <>
      <p className="text-sm leading-6 text-text">{DATA.lead}</p>
      <ul className="m-0 mt-3 list-none space-y-3 p-0">
        {DATA.points.map(p => (
          <li key={p.head} className="text-sm leading-6">
            <b className="font-semibold text-[#f2ede1]">{p.head}.</b> <span className="text-text">{p.body}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-5 text-orange">{DATA.aside}</p>
      <p className="mt-2 text-sm"><a href={PRIVACY_URL} {...EXT} className="inline-flex min-h-11 items-center">{DATA.link}</a></p>
    </>
  );
}

export function CostBody() {
  return (
    <>
      <p className="text-sm leading-6 text-text">{COST.lead}</p>
      <ul className="m-0 mt-3 list-none space-y-3 p-0">
        {COST.points.map((p, i) => (
          <li key={p.head} className="text-sm leading-6">
            <b className="font-semibold text-[#f2ede1]">{p.head}.</b> <span className="text-text">{p.body}</span>{' '}
            {i === COST.points.length - 1 && <StatusChip status={COST.trialStatus} />}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm leading-6 text-[#f2ede1]">{COST.scale}</p>
      <p className="mt-2 text-xs leading-5 text-dim">
        {COST.notTurnkey}{' '}
        <a href={SELFHOST_NOTE_URL} {...EXT}>{COST.notTurnkeyLink}</a>.
      </p>
    </>
  );
}

export function WorldsBody() {
  return (
    <>
      <p className="text-sm leading-6 text-text">{WORLDS.lead}</p>
      <ul className="m-0 mt-3 list-none space-y-2 p-0">
        {WORLDS.list.map(w => (
          <li key={w.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-bg px-3 py-2">
            <span className="text-sm text-[#f2ede1]">{w.name}</span>
            <StatusChip status={w.status} />
            <span className="text-xs text-dim">{w.note}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-5 text-dim">{WORLDS.rights}</p>
    </>
  );
}

// ─── The inventory of promises ──────────────────────────────────────────────────────────────────────
export function ComingList() {
  return (
    <section id="coming" aria-label={COMING_TITLE} className="scroll-mt-4 rounded-md border border-dashed border-orange/70 p-4 sm:p-5">
      <h2 className="text-lg text-orange">{COMING_TITLE}</h2>
      <ul className="m-0 mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-text">
        {COMING.map(c => <li key={c}>{c}</li>)}
      </ul>
    </section>
  );
}

// ─── Register interest ──────────────────────────────────────────────────────────────────────────────
export function CtaBand({ ctx }: { ctx: Ctx }) {
  return (
    <section id="interest" className="scroll-mt-4 rounded-md border border-gold/70 bg-panel p-5 sm:p-6">
      <h2 className="text-xl text-[#f2ede1]">{CTA.title}</h2>
      <p className="mt-2 max-w-[62ch] text-sm leading-6 text-text">{CTA.body}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <InterestButton ctx={ctx} />
        <span className="text-xs text-dim">{CTA.note}</span>
      </div>
    </section>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────────────────────────────
export function Footer() {
  return (
    <footer className="mt-12 border-t border-border pt-4">
      <aside role="note" aria-label="Rights notice" className="mb-4 rounded-md border border-gold/70 bg-panel p-4">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-gold">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-gold" />
          Fan site notice
        </div>
        <p className="text-sm leading-6 text-text">{RIGHTS_NOTICE}</p>
        <p className="mt-2 text-sm leading-6 text-text">{FAN_PROJECT_LINE}</p>
      </aside>
      <p className="text-xs leading-6 text-dim">
        <a href={REPO_URL} {...EXT}>Source code</a> <span aria-hidden>&middot;</span>{' '}
        <a href={PRIVACY_URL} {...EXT}>Privacy</a> <span aria-hidden>&middot;</span>{' '}
        <a href={EQMIMIC_ORIGIN} {...EXT}>The free player tool</a> <span aria-hidden>&middot;</span>{' '}
        Licensed AGPL-3.0-or-later.
      </p>
    </footer>
  );
}
