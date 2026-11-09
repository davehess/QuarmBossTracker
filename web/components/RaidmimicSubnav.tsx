'use client';
// The second row of the raidmimic.com bar: the pages of the section you are in, centred under the five top links.
// The only client piece of HostBar (it needs the path); renders nothing outside a section with 2+ pages.
import { usePathname } from 'next/navigation';
import { RAIDMIMIC_SECTIONS, pageIsCurrent, sectionOfPath } from '@/lib/raidmimicNav';

const TOP_LINK = 'inline-flex min-h-11 items-center rounded px-2 text-sm hover:bg-panel hover:no-underline';

/** The five top links; the section you are in is gold (`aria-current="true"`), the rest dim. */
export function RaidmimicTopLinks() {
  const current = sectionOfPath(usePathname() || '/');
  return (
    <div className="mx-auto flex w-max items-center gap-1">
      {RAIDMIMIC_SECTIONS.map(s => {
        const on = current?.key === s.key;
        return <a key={s.key} href={s.href} aria-current={on ? 'true' : undefined}
          className={`${TOP_LINK} ${on ? 'text-gold' : 'text-dim hover:text-text'}`}>{s.label}</a>;
      })}
    </div>
  );
}

export default function RaidmimicSubnav() {
  const path = usePathname() || '/';
  const section = sectionOfPath(path);
  if (!section || section.pages.length < 2) return null;
  return (
    <nav aria-label={`${section.label} pages`} className="flex flex-wrap justify-center gap-x-1 pb-2">
      {section.pages.map(p => {
        const on = pageIsCurrent(section, p, path);
        return (
          <a key={p.href} href={p.href} aria-current={on ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded px-2 text-sm hover:bg-panel hover:no-underline ${on ? 'text-gold' : 'text-dim hover:text-text'}`}>
            {p.label}
          </a>
        );
      })}
    </nav>
  );
}
