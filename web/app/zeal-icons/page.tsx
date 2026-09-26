// /zeal-icons: the Zeal tag icons, and the guild picture files we host (DECISIONS-2026-09-21 §38–§39).
//
// Deliberately PUBLIC: it is for other guilds, who have no account here. It reads no user and no
// database, and takes no uploads (logos come in through Discord); that is what the 2026-09-26 audit
// cleared for a public page.
//
// Two layouts are on offer on beta until the guild lead picks one (CLAUDE.md, UI options):
//   A (no ?v=): one catalogue page, every guild with anchors (#eur);
//   B (?v=b):   a short guild index; each guild has its own page at /zeal-icons/<code>.
import Link from 'next/link';
import type { Metadata } from 'next';
import { GUILDS, markSrc } from '@/lib/zealIcons';
import {
  GetYours, GuildKeys, H1, H2, LayoutSwitch, Lead, Mark, NumbersAndPaws, PictureDownloads, InstallSteps,
  StatusNote, SymbolsGrid,
} from './parts';

export const metadata: Metadata = {
  title: 'Zeal tag icons',
  description: 'Guild banners and icons for Zeal /tag, with the keys to type and picture files to download.',
};

export default async function ZealIconsPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  return v === 'b' ? <GuildIndex /> : <Catalogue />;
}

function Catalogue() {
  const withPictures = GUILDS.filter(g => g.pictures?.length);
  return (
    <div className="mx-auto max-w-5xl py-2">
      <LayoutSwitch current="a" />
      <h1 className={H1}>Zeal tag icons</h1>
      <Lead />
      <StatusNote />

      <section id="guilds" className="mt-10">
        <h2 className={H2}>Your guild</h2>
        <p className="mt-1 text-sm text-dim">A banner with your guild&rsquo;s code, and an icon. {GUILDS.length} guilds so far.</p>
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {GUILDS.map(g => (
            <li key={g.code} id={g.code.toLowerCase()}
                className="flex scroll-mt-20 items-center gap-3 rounded-md border border-border bg-panel p-2 target:border-[#d29922]">
              <Mark src={markSrc.banner(g.code)} alt={`${g.name} banner`} size={56} />
              <Mark src={markSrc.guild(g.code)} alt={`${g.name} icon`} size={56} />
              <div className="min-w-0 space-y-1.5">
                <div className="text-sm leading-tight text-[#f2ede1]">{g.name}</div>
                <GuildKeys guild={g} />
                {g.pictures?.length ? (
                  <a href="#pictures" className="text-xs text-[#d29922] hover:underline">Picture file ↓</a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section id="pictures" className="mt-10 scroll-mt-20">
        <h2 className={H2}>Pictures to download</h2>
        <p className="mt-1 text-sm text-dim">
          A guild&rsquo;s own logo, shown in place of its built-in icon for players who have the file.
        </p>
        <div className="mt-4 space-y-4">
          {withPictures.map(g => (
            <div key={g.code} className="rounded-md border border-border bg-panel p-3">
              <div className="mb-3 text-sm text-[#f2ede1]">{g.name} <span className="font-mono text-dim">^I{g.code}^</span></div>
              <PictureDownloads guild={g} />
            </div>
          ))}
          <InstallSteps />
        </div>
      </section>

      <section id="symbols" className="mt-10">
        <h2 className={H2}>Symbols</h2>
        <div className="mt-4"><SymbolsGrid /></div>
      </section>

      <section id="numbers" className="mt-10">
        <h2 className={H2}>Numbers and paws</h2>
        <div className="mt-4"><NumbersAndPaws /></div>
      </section>

      <section id="yours" className="mt-10 mb-6">
        <h2 className={H2}>Get your guild&rsquo;s icon</h2>
        <div className="mt-3"><GetYours /></div>
      </section>
    </div>
  );
}

function GuildIndex() {
  return (
    <div className="mx-auto max-w-4xl py-2">
      <LayoutSwitch current="b" />
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
