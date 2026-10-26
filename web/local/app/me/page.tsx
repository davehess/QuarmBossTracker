import Link from 'next/link';

// /local/me/ — the local site's "/me", the door the website's own nav has (FB-98, a member, 2026-10-26: "NEED /ME to
// go to the me section that matches with the website. I couldn't easily find where to turn on or off characters
// having their inventories synced or hidden"). The website's /me is a signed-in page of per-character cards; this
// static page cannot be that (no session, nothing here may need a server), so it does the two jobs a "/me" door
// has here: list the pages that exist on THIS PC, in the website's /me order, and say where the per-character
// inventory switches live and link straight to them (wolfpack.quest/me#my-characters, an anchor on the website's
// "My Characters" section). The wording matches the callout on that section (web/app/me/page.tsx).

export const metadata = {
  title: '/me · On this PC',
  description: 'Your own pages, as on wolfpack.quest/me: inventory, fights and replay from this PC, and where to turn a character\'s inventory sync or hiding on and off.',
};

const SITE_CHARACTERS = 'https://wolfpack.quest/me#my-characters';

const PAGES: { href: string; icon: string; name: string; site: string; blurb: string }[] = [
  { href: '/inventory/', icon: '🎒', name: 'Inventory', site: '/me/inventory', blurb: 'Every item across your characters, from the inventory files on this PC.' },
  { href: '/parses/',    icon: '📈', name: 'My parses',  site: '/me/parses',    blurb: 'Your own fights as this PC recorded them.' },
  { href: '/replay/',    icon: '🎬', name: 'My replay',  site: '',              blurb: 'Where you and your raid stood, from the recording Mimic keeps here.' },
];

export default function LocalMePage() {
  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold mb-1"><span aria-hidden>👤 </span>/me</h2>
        <p className="text-sm text-dim leading-6">
          The same door as <span className="text-text">/me</span> on wolfpack.quest. These pages are built from this PC&apos;s
          own files, so nothing on them leaves it.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PAGES.map(p => (
            <Link key={p.href} href={p.href}
              className="block bg-bg border border-border rounded p-3 no-underline hover:border-blue">
              <div className="text-text text-sm"><span aria-hidden>{p.icon} </span>{p.name}</div>
              <div className="text-dim text-xs mt-1 leading-5">{p.blurb}</div>
              {p.site && <div className="text-dim/70 text-[10px] mt-2">website: {p.site}</div>}
            </Link>
          ))}
        </div>
      </section>

      <section id="characters" className="bg-panel border border-blue/40 rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1"><span aria-hidden>⚙ </span>Inventory sync and hiding, per character</h2>
        <p className="text-sm text-dim leading-6">
          Which characters upload their inventory, who can open it, and which are hidden from the lists are set on
          the website, one character at a time. On{' '}
          <span className="text-text">wolfpack.quest/me</span>, look for the small buttons in the top-right of each
          character&apos;s card:
        </p>
        <ul className="mt-3 text-sm text-dim leading-6 list-disc pl-5 space-y-1">
          <li><span className="text-text">Inventory sync: on / EXCLUDED</span>: whether Mimic uploads that character&apos;s inventory.</li>
          <li><span className="text-text">Inventory page: private / PUBLIC</span>: who can open it.</li>
          <li><span className="text-text">Hide from lists</span>: keeps it out of lists and charts; it still counts in your account inventory. Hidden characters wait in a collapsed &quot;Hidden by you&quot; group, where the button reads Unhide.</li>
        </ul>
        <div className="mt-4">
          <a href={SITE_CHARACTERS} target="_blank" rel="noreferrer"
            className="inline-block px-3 py-1.5 rounded border border-blue text-blue text-sm no-underline hover:bg-blue/10">
            Open my characters on wolfpack.quest ↗
          </a>
        </div>
        <p className="text-xs text-dim leading-5 mt-4">
          Prefer to stay in Mimic? The dashboard&apos;s <span className="text-text">🐺 Me</span> card has{' '}
          <span className="text-text">👁 How each character shows</span> (Main / alt, Inventory only, Hide completely), the same
          switches in one pick. The <span className="text-text">Inventory</span> page on this PC lists whatever inventory files
          are on disk; these switches decide what is shared and shown on the website.
        </p>
      </section>
    </div>
  );
}
