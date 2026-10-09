// Layout B, the ledger. Sells local mode first: two columns, "On your PC (free, no account)" against
// "Needs a guild server", so a newcomer sees what they get for nothing before anything about a guild.
// Then the highlights, privacy as a strip, an FAQ accordion, the walk-through, and hive mind last.
// DECISIONS §209.
import type { ReactNode } from 'react';
import {
  BetaBadge, Faq, GuideLink, Hero, Hive, Highlights, LandingFooter, LocalModeBox, PiecesCompact,
  PrivacyStrip, RightsNotice, ScopeBadge, SectionHead, SetupSteps, Troubleshooting, type Ctx,
} from './Parts';
import { HIVE, LOCAL_MODE, OVERLAYS, PIECES } from '@/lib/eqmimicLanding';

function Column({ title, sub, tone, children }: { title: string; sub: string; tone: 'green' | 'blue'; children: ReactNode }) {
  return (
    <div className={`rounded-md border bg-panel p-4 ${tone === 'green' ? 'border-green/50' : 'border-blue/50'}`}>
      <h3 className={`text-base ${tone === 'green' ? 'text-green' : 'text-blue'}`}>{title}</h3>
      <p className="mt-0.5 text-xs text-dim">{sub}</p>
      {children}
    </div>
  );
}

export default function LayoutB({ ctx }: { ctx: Ctx }) {
  const local = OVERLAYS.filter(o => o.scope === 'local');
  const guild = OVERLAYS.filter(o => o.scope === 'guild');
  const guildPiece = PIECES.find(p => p.guildOnly);
  return (
    <div className="mx-auto max-w-5xl pb-16">
      <BetaBadge ctx={ctx} layout="b" />
      <Hero ctx={ctx} compact />
      <RightsNotice />

      <section className="mt-10">
        <SectionHead id="ledger" title="What you get, and what it needs"
          lead="Everything on the left runs on your own PC, free, with no account. The right column is what changes when a guild runs the server side." />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Column title="On your PC (free, no account)" sub="Download, run local-only, done" tone="green">
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {local.map(o => (
                <li key={o.name} className="flex items-start gap-3 text-sm leading-5">
                  <ScopeBadge scope="local" />
                  <span className="min-w-0"><span className="text-[#f2ede1]">{o.name}</span>
                    <span className="block text-xs text-dim">{o.purpose}{o.note ? ` (${o.note})` : ''}</span></span>
                </li>
              ))}
            </ul>
            <ul className="m-0 mt-4 list-disc space-y-1 border-t border-border pt-3 pl-5 text-xs leading-5 text-text">
              {LOCAL_MODE.points.filter(p => !p.startsWith('Guild-only')).map(p => <li key={p}>{p}</li>)}
            </ul>
          </Column>
          <Column title="Needs a guild server" sub="Only once your guild runs one and you sign in" tone="blue">
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {guild.map(o => (
                <li key={o.name} className="flex items-start gap-3 text-sm leading-5">
                  <ScopeBadge scope="guild" />
                  <span className="min-w-0"><span className="text-[#f2ede1]">{o.name}</span>
                    <span className="block text-xs text-dim">{o.purpose}{o.note ? ` (${o.note})` : ''}</span></span>
                </li>
              ))}
            </ul>
            {guildPiece && <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-text">{guildPiece.body}</p>}
            <p className="mt-3 text-xs leading-5 text-dim">In local mode these show &ldquo;needs your raid&rsquo;s Mimics&rdquo; or stay empty. <a href="#hive">How a guild runs one</a>.</p>
          </Column>
        </div>
      </section>

      <section className="mt-12">
        <SectionHead id="overlays" title="See it" />
        <div className="mt-4"><Highlights /></div>
      </section>

      <section className="mt-12">
        <SectionHead id="privacy" title="Privacy, in five lines" />
        <PrivacyStrip />
      </section>

      <section className="mt-12">
        <SectionHead id="faq" title="Questions people ask first" />
        <Faq />
      </section>

      <section className="mt-12">
        <SectionHead id="pieces" title="How it works"
          lead="Five parts, in the order a signal travels. Tap one to open it." />
        <PiecesCompact />
      </section>

      <section className="mt-12">
        <SectionHead id="setup" title="Set it up yourself, standalone" lead="Six steps, no account." />
        <SetupSteps />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <LocalModeBox />
          <Troubleshooting />
        </div>
        <GuideLink />
      </section>

      <section className="mt-14">
        <SectionHead id="hive" title={HIVE.title} />
        <Hive ctx={ctx} />
      </section>

      <LandingFooter ctx={ctx} />
    </div>
  );
}
