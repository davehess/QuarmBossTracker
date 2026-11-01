// The pieces the raidmimic.com page shares with the set-up guide: the gold button, the Register-interest band and the footer.
// Every sentence comes from web/lib/raidmimicLanding.ts; this file only decides how a block LOOKS. Server components, no client JS.
// (The rest of the old "Pick your path" page's pieces, the small-print accordions, the captures gallery and the status chips,
// went with that page when the story stage became the default.)
import { CTA, FAN_PROJECT_LINE, PRIVACY_URL, REPO_URL, RIGHTS_NOTICE, EQMIMIC_ORIGIN } from '@/lib/raidmimicLanding';

/** Links that differ between the raidmimic host and the Wolf Pack hosts (where /feedback is a different page). */
export interface Ctx {
  onHost: boolean;      // served on a raidmimic host (bare shell, no query string, no Wolf Pack header)
  interest: string;     // the Register-interest address
  setup: string;        // the set-up guide: /setup on a raidmimic host, /raidmimic/setup on the Wolf Pack hosts
}

const BTN = 'inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold no-underline transition-colors motion-reduce:transition-none';
export const PRIMARY_BTN = `${BTN} border-gold bg-gold text-[#1a1206] hover:bg-[#e0a92c] hover:no-underline`;
export const EXT = { target: '_blank', rel: 'noreferrer' } as const;

export function InterestButton({ ctx, className = PRIMARY_BTN }: { ctx: Ctx; className?: string }) {
  return <a href={ctx.interest} className={className} {...(ctx.onHost ? EXT : {})}>{CTA.button}</a>;
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
