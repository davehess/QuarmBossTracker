// raidmimic.com/setup: how to set Mimic up for yourself, for someone who is NOT in a guild (the guild lead,
// 2026-10-21: "make a page on raidmimic.com for how to set up themselves"). Served at raidmimic.com/setup (the
// middleware rewrites /setup here and every other path to the landing page) and, for preview, at
// wolfpack.quest/raidmimic/setup and b.wolfpack.quest/raidmimic/setup. Public, no sign-in, marked [beta]: a NEW
// page ships live with the tag (CLAUDE.md, DECISIONS §135).
//
// Same look and same bare shell as the landing page (web/app/raidmimic/page.tsx). Every sentence lives in
// web/lib/raidmimicSetup.ts; this file only decides how a block LOOKS. Server component, no client JS.
// Not indexable yet, like the landing page.
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import NewPageTag from '@/components/NewPageTag';
import { isRaidmimicHost } from '@/lib/raidmimicHost';
import { EQMIMIC_FEEDBACK_PATH, EQMIMIC_ORIGIN, interestUrl, RIGHTS_NOTICE } from '@/lib/raidmimicLanding';
import {
  BETA_NOTE, CREDIT, HERO, LANDING_PATH_ON_HOST, LANDING_PATH_ON_WOLFPACK, PRIVACY_URL, RELEASES_URL, REQUIREMENTS,
  STEPS, STILL_STUCK, TROUBLESHOOTING, type Step,
} from '@/lib/raidmimicSetup';
import { REPO_URL } from '@/lib/eqmimicLanding';
import { PRIMARY_BTN } from '../_landing/Parts';

const TITLE = '[beta] Set up Raid Mimic';
const DESCRIPTION =
  'A step-by-step guide to setting up Mimic on your own PC for EverQuest on Project Quarm, with no guild needed: what you need, what works on your own, and how to join a raid.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'raidmimic', type: 'website' },
  twitter: { card: 'summary' },
};

const EXT = { target: '_blank', rel: 'noreferrer' } as const;
const NOTE = 'mt-3 border-l-2 border-orange/60 pl-3 text-xs leading-5 text-dim';

function StepCard({ n, step, guildHref, guildExternal }: { n: number; step: Step; guildHref: string; guildExternal: boolean }) {
  const href = step.link?.href || guildHref;
  const external = step.link?.href ? /^https?:/.test(step.link.href) : guildExternal;
  return (
    <li id={step.id} className="scroll-mt-4 rounded-md border border-border bg-panel p-4 sm:p-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/70 text-base text-gold">{n}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl leading-tight text-[#f2ede1]"><span className="sr-only">Step {n}: </span>{step.title}</h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-[#f2ede1]">{step.lead}</p>
          <ul className="m-0 mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-text marker:text-dim">
            {step.items.map(i => <li key={i} className="max-w-[66ch]">{i}</li>)}
          </ul>
          {step.link && (
            <p className="mt-3">
              <a href={href} {...(external ? EXT : {})} className={step.id === 'download' ? PRIMARY_BTN : 'inline-flex min-h-11 items-center text-sm'}>
                {step.link.label}{step.id === 'download' ? '' : ' →'}
              </a>
            </p>
          )}
          {step.note && <p className={NOTE}>{step.note}</p>}
        </div>
      </div>
    </li>
  );
}

export default function RaidmimicSetupPage() {
  // On a raidmimic host the landing page is `/` and the form lives on eqmimic.quest; on the Wolf Pack hosts the
  // landing page is /raidmimic and its Register-interest button reaches the form by its real path.
  const onHost = isRaidmimicHost(headers().get('host'));
  const landing = onHost ? LANDING_PATH_ON_HOST : LANDING_PATH_ON_WOLFPACK;
  const interest = onHost ? interestUrl(`${EQMIMIC_ORIGIN}/feedback`) : interestUrl(EQMIMIC_FEEDBACK_PATH);

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <NewPageTag note={BETA_NOTE} href={onHost ? interest : '/feedback'} />

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-gold">{HERO.kicker}</p>
        <h1 className="mt-1 text-3xl leading-tight text-[#f2ede1] sm:text-4xl">{HERO.name}</h1>
        <p className="mt-3 max-w-[60ch] text-base leading-7 text-[#f2ede1]">{HERO.line}</p>
        <p className="mt-2 max-w-[60ch] text-sm leading-6 text-text">{HERO.fine}</p>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          <a href={RELEASES_URL} {...EXT} className={PRIMARY_BTN}>Download Mimic</a>
          <a href={landing} className="inline-flex min-h-11 items-center text-sm">What is Raid Mimic? →</a>
        </p>
      </header>

      <section aria-label={REQUIREMENTS.title} className="mb-6 rounded-md border border-border bg-bg p-4">
        <h2 className="text-base text-[#f2ede1]">{REQUIREMENTS.title}</h2>
        <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-text marker:text-dim">
          {REQUIREMENTS.items.map(i => <li key={i}>{i}</li>)}
        </ul>
      </section>

      <nav aria-label="Steps" className="mb-6">
        <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-xs text-text no-underline hover:border-gold/70 hover:no-underline">
                <span aria-hidden className="text-gold">{i + 1}</span>{s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <ol className="m-0 list-none space-y-4 p-0">
        {STEPS.map((s, i) => <StepCard key={s.id} n={i + 1} step={s} guildHref={landing} guildExternal={false} />)}
      </ol>

      <section id="troubleshooting" aria-label={TROUBLESHOOTING.title} className="mt-10 scroll-mt-4">
        <h2 className="text-xl text-[#f2ede1]">{TROUBLESHOOTING.title}</h2>
        <ul className="m-0 mt-3 list-none space-y-3 p-0">
          {TROUBLESHOOTING.list.map(f => (
            <li key={f.id} id={f.id} className="scroll-mt-4 rounded-md border border-border bg-panel p-4">
              <h3 className="text-base leading-snug text-[#f2ede1]">{f.problem}</h3>
              <p className="mt-2 max-w-[66ch] text-sm leading-6 text-text">{f.fix}</p>
              {f.note && <p className={NOTE}>{f.note}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={STILL_STUCK.title} className="mt-8 rounded-md border border-gold/70 bg-panel p-4 sm:p-5">
        <h2 className="text-lg text-[#f2ede1]">{STILL_STUCK.title}</h2>
        <p className="mt-2 max-w-[62ch] text-sm leading-6 text-text">{STILL_STUCK.body}</p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href={interest} {...(onHost ? EXT : {})} className="inline-flex min-h-11 items-center">Tell us what went wrong</a>
          <a href={RELEASES_URL} {...EXT} className="inline-flex min-h-11 items-center">Releases</a>
        </p>
      </section>

      <footer className="mt-12 border-t border-border pt-4">
        <aside role="note" aria-label="Rights notice" className="mb-4 rounded-md border border-gold/70 bg-panel p-4">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-gold">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-gold" />
            Fan site notice
          </div>
          <p className="text-sm leading-6 text-text">{RIGHTS_NOTICE}</p>
          <p className="mt-2 text-sm leading-6 text-text">{CREDIT}</p>
        </aside>
        <p className="text-xs leading-6 text-dim">
          <a href={REPO_URL} {...EXT}>Source code</a> <span aria-hidden>&middot;</span>{' '}
          <a href={PRIVACY_URL} {...EXT}>Privacy</a> <span aria-hidden>&middot;</span>{' '}
          <a href={landing}>Raid Mimic</a> <span aria-hidden>&middot;</span>{' '}
          Licensed AGPL-3.0-or-later.
        </p>
      </footer>
    </div>
  );
}
