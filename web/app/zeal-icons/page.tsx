// /zeal-icons: the Zeal tag icons, and the guild picture files we host (DECISIONS-2026-09-21 §38–§39).
//
// Deliberately PUBLIC: it is for other guilds, who have no account here. It reads no user and no
// database, and takes no uploads (logos come in through Discord); that is what the 2026-09-26 audit
// cleared for a public page.
//
// Live since 2026-10-03 with the [beta] tag (a new page goes live first, DECISIONS §135). The guild
// lead picked the guild index on 2026-10-19 (§383): a short list of guilds, and each guild has its own
// page at /zeal-icons/<code>. The one-catalogue layout and its switch are gone.
import Link from 'next/link';
import type { Metadata } from 'next';
import { GUILDS, markSrc } from '@/lib/zealIcons';
import NewPageTag from '@/components/NewPageTag';
import {
  GetYours, H1, H2, Lead, Mark, NumbersAndPaws, StatusNote, SymbolsGrid,
} from './parts';

export const metadata: Metadata = {
  title: '[beta] Zeal tag icons',
  description: 'Guild banners and icons for Zeal /tag, with the keys to type and picture files to download.',
};

export default function ZealIconsPage() {
  return (
    <div className="mx-auto max-w-4xl py-2">
      <NewPageTag />
      <h1 className={H1}>Zeal tag icons</h1>
      <Lead />
      <StatusNote />

      <section className="mt-10">
        <h2 className={H2}>Find your guild</h2>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {GUILDS.map(g => (
            <li key={g.code}>
              <Link href={`/zeal-icons/${g.code.toLowerCase()}`}
                    className="flex items-center gap-2 rounded-md border border-border bg-panel p-2 no-underline transition-colors hover:border-[#d29922] focus-visible:border-[#d29922] focus-visible:outline-none">
                <Mark src={markSrc.guild(g.code)} alt="" size={40} />
                <span className="min-w-0">
                  <span className="block text-sm leading-tight text-[#f2ede1]">{g.name}</span>
                  <span className="block font-mono text-[11px] text-dim">
                    {g.code}{g.pictures?.length ? ' · picture' : ''}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <details className="mt-10 rounded-md border border-border bg-panel p-3">
        <summary className="cursor-pointer text-[#f2ede1]">Symbols, numbers and paws</summary>
        <div className="mt-4 space-y-8">
          <SymbolsGrid />
          <NumbersAndPaws />
        </div>
      </details>

      <section className="mt-10 mb-6">
        <h2 className={H2}>Get your guild&rsquo;s icon</h2>
        <div className="mt-3"><GetYours /></div>
      </section>
    </div>
  );
}
