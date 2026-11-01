// The frame the three Raid Mimic legal pages share: the [beta] tag, the title and date, the sections, and the footer with
// the fan-site notice and the four small-print links. Server components, no client JS. The sentences are in the pages;
// this file only decides how a block LOOKS (the same look as the set-up guide: web/app/raidmimic/setup/page.tsx).
// Colours are theme tokens and `white`, not hex literals: test/theme-tokens.test.js only lets stray hex shrink.
import type { ReactNode } from 'react';
import NewPageTag from '@/components/NewPageTag';
import LegalLinks from '@/components/LegalLinks';
import { CONTACT_HREF, LEGAL_UPDATED, TERMS_VERSION, legalPaths } from '@/lib/legal';
import { RIGHTS_NOTICE } from '@/lib/raidmimicLanding';

export const B = ({ children }: { children: ReactNode }) => <strong className="text-white">{children}</strong>;

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 space-y-3 text-sm leading-6 text-text">
      <h2 className="text-xl leading-tight text-white">{title}</h2>
      {children}
    </section>
  );
}

export function Bullets({ children }: { children: ReactNode }) {
  return <ul className="m-0 list-disc space-y-1.5 pl-5 marker:text-dim">{children}</ul>;
}

/** Stacked rows (a name and what it is), for the lists a phone would squeeze out of a table. */
export function Rows({ rows }: { rows: { head: ReactNode; body: ReactNode }[] }) {
  return (
    <div className="divide-y divide-border rounded-md border border-border bg-panel">
      {rows.map((r, i) => (
        <div key={i} className="px-4 py-2.5 sm:grid sm:grid-cols-[13rem_1fr] sm:gap-4">
          <div className="text-white">{r.head}</div>
          <div>{r.body}</div>
        </div>
      ))}
    </div>
  );
}

export const LEGAL_LINK = 'text-blue underline';

export function LegalShell({ onHost, title, lead, showVersion = false, children }: {
  onHost: boolean; title: string; lead: string; showVersion?: boolean; children: ReactNode;
}) {
  const p = legalPaths(onHost);
  return (
    <div className="mx-auto max-w-3xl pb-12">
      <NewPageTag note="New page, still being shaped." href={onHost ? CONTACT_HREF : '/feedback'} />
      <header className="border-b border-border pb-4">
        <p className="text-xs uppercase tracking-widest text-gold">Raid Mimic</p>
        <h1 className="mt-1 text-3xl leading-tight text-white">{title}</h1>
        <p className="mt-3 max-w-[62ch] text-base leading-7 text-white">{lead}</p>
        <p className="mt-2 text-xs text-dim">
          Last updated {LEGAL_UPDATED}{showVersion ? ` · version ${TERMS_VERSION}` : ''}
        </p>
      </header>
      {children}
      <footer className="mt-12 border-t border-border pt-4">
        <aside role="note" aria-label="Rights notice" className="mb-4 rounded-md border border-gold/70 bg-panel p-4">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-gold">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-gold" />
            Fan site notice
          </div>
          <p className="text-sm leading-6 text-text">{RIGHTS_NOTICE}</p>
        </aside>
        <p className="text-xs leading-6 text-dim">
          <a href={p.home}>Raid Mimic</a> <span aria-hidden>&middot;</span>{' '}
          <LegalLinks onHost={onHost} />
        </p>
      </footer>
    </div>
  );
}
