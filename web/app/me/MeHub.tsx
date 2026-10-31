// The /me?v=b hub (the guild lead, 2026-10-31: "we have so many things in this platform, too much to know about" ...
// "main page should be everything about the main, then account and links to all of their stuff"; DECISIONS §481), then
// "it needs to load immediately then fill in".
//
// Three sections, in this order: your main, your account, all your stuff. This component awaits NOTHING. The headings,
// the tour pointer, the account links and the directory of non-character pages are static and paint at once; each
// data-backed block (MeHubBlocks.tsx) is its own async component behind its own <Suspense> with a skeleton of the
// same height, so a slow read holds only its own block. page.tsx renders this before it loads anything else, which is
// also why the hub reads only what the classic page reads (lib/meHubLoad.ts) and never its page-wide loaders.
//
// Not on the hub, on purpose: the attendance heatmap, The Scrap, the per-character cards and the mule/claim uploads.
// They are all on the classic view, one link away, until the guild lead says which of them move.
import { Suspense } from 'react';
import Link from 'next/link';
import { HUB_GROUPS, CHARACTER_PAGES, hubEntry } from '@/lib/meHub';
import HubTourButton from './HubTourButton';
import {
  Skeleton, SLOT, MainIdentity, MainFreshness, MainRecord, AccountMimic, AccountDiscord, AccountCharacters, DirectoryCharacters,
} from './MeHubBlocks';

const section = 'rounded-lg border border-border bg-panel p-4 sm:p-6';
const h2 = 'mb-3 text-xl text-gold';

function Entry({ href }: { href: string }) {
  const e = hubEntry(href);
  return (
    <li>
      <Link href={e.href} className="block h-full rounded border border-border bg-bg p-3 hover:border-blue/60">
        <span className="text-sm text-blue">{e.title}</span>
        {e.beta && <span className="ml-2 rounded border border-orange/50 px-1 text-[10px] text-orange">beta</span>}
        <span className="mt-1 block text-xs text-dim">{e.description}</span>
      </Link>
    </li>
  );
}

export default function MeHub({ userId }: { userId: string }) {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl text-text">Your Wolf Pack</h1>
          <p className="text-sm text-dim">Your main first, then your account, then everything that is yours.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-dim">New here?</span>
          <HubTourButton />
        </div>
      </header>

      <section aria-labelledby="hub-main" className={section}>
        <h2 id="hub-main" className={h2}>Your main</h2>
        <Suspense fallback={<Skeleton h={SLOT.identity} />}><MainIdentity userId={userId} /></Suspense>
        <Suspense fallback={<Skeleton h={SLOT.fresh} />}><MainFreshness userId={userId} /></Suspense>
        <div className="mt-4">
          <Suspense fallback={<Skeleton h={SLOT.record} />}><MainRecord userId={userId} /></Suspense>
        </div>
      </section>

      <section aria-labelledby="hub-account" className={section}>
        <h2 id="hub-account" className={h2}>Your account</h2>
        <div className="space-y-4">
          <Suspense fallback={<Skeleton h={SLOT.discord} />}><AccountDiscord userId={userId} /></Suspense>
          <div>
            <Suspense fallback={<Skeleton h={SLOT.mimic} />}><AccountMimic userId={userId} /></Suspense>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <Link href="/mimic" className="py-1 text-blue hover:underline">Download Mimic</Link>
              <Link href="/auth/mimic-link" className="py-1 text-blue hover:underline">Link Mimic to your account</Link>
              <a href="http://localhost:7779" target="_blank" rel="noreferrer" className="py-1 text-blue hover:underline">Your local dashboard ↗</a>
            </p>
          </div>
          <Suspense fallback={<Skeleton h={SLOT.alts} />}><AccountCharacters userId={userId} /></Suspense>
          <ul className="grid gap-2 sm:grid-cols-2">
            {['/me/accounts', '/me/voice', '/me/tells', '/me/ui'].map(h => <Entry key={h} href={h} />)}
          </ul>
        </div>
      </section>

      <section aria-labelledby="hub-stuff" className={section}>
        <h2 id="hub-stuff" className={h2}>All your stuff</h2>
        <div className="space-y-6">
          <div>
            <h3 className="mb-1 text-xs text-orange">Characters</h3>
            <p className="mb-2 text-xs text-dim">
              {CHARACTER_PAGES.map(p => `${p.label}: ${p.blurb}`).join(' ')}
            </p>
            <Suspense fallback={<Skeleton h={SLOT.chars} />}><DirectoryCharacters userId={userId} /></Suspense>
          </div>
          {HUB_GROUPS.map(g => (
            <div key={g.title}>
              <h3 className="mb-2 text-xs text-orange">{g.title}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">{g.hrefs.map(h => <Entry key={h} href={h} />)}</ul>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-dim">
        This is a preview layout. <Link href="/me" className="text-blue hover:underline">The classic view →</Link> still has
        attendance, The Scrap, every character&apos;s full card and the bank-mule uploads.
      </p>
    </div>
  );
}
