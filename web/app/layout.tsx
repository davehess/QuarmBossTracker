import './globals.css';
import type { Metadata } from 'next';
import { Prata, Faustina } from 'next/font/google';
import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';
import AuthBadge from '@/components/AuthBadge';
import LocalDashboardLink from '@/components/LocalDashboardLink';
import GlobalSearch from '@/components/GlobalSearch';
import GuidedTour, { TourLauncher } from '@/components/GuidedTour';
import BetaBanner from '@/components/BetaBanner';
import BetaLink from '@/components/BetaLink';
import { getSessionUser } from '@/lib/session';
import { isOfficer } from '@/lib/officer';

// b.wolfpack.quest. Set at BUILD time from the branch (see next.config.js), so
// this is a constant in the bundle rather than a per-request check.
const IS_BETA = process.env.NEXT_PUBLIC_IS_BETA === '1';

// The plate voice. Prata is a Didone: the high stroke contrast and flat
// serifs of an engraved specimen plate, which is the world this landing page
// commits to. Faustina carries prose — the mono stays for data, where it is
// measurement rather than costume.
const display = Prata({ subsets: ['latin'], weight: '400', variable: '--font-display', display: 'swap' });
const proseFace = Faustina({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-prose', display: 'swap' });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  || (IS_BETA ? 'https://b.wolfpack.quest' : 'https://wolfpack.quest');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // The beta mirror serves the same pages on a different host, which is
  // textbook duplicate content — left indexable it would compete with
  // wolfpack.quest in search results and could outrank it. Never index it.
  ...(IS_BETA ? { robots: { index: false, follow: false } } : {}),
  title: {
    // Distinguishable in a browser tab when prod and beta are both open.
    default:  IS_BETA ? 'WolfPack.quest (beta)' : 'WolfPack.quest',
    template: IS_BETA ? '%s · WolfPack.quest (beta)' : '%s · WolfPack.quest',
  },
  description: 'Guild-wide build planner, parse history, and loadout library for Project Quarm.',
  openGraph: {
    title:       'WolfPack.quest',
    description: 'Guild-wide build planner, parse history, and loadout library for Project Quarm.',
    url:         SITE_URL,
    siteName:    'WolfPack.quest',
    type:        'website',
  },
  // ⚠ Deliberately NO `icons:` key. This used to say `{ icon: '/favicon.ico' }`
  // pointing at a file that was never committed — every tab rendered the blank
  // default, silently, because a missing favicon does not error anywhere.
  // app/icon.png + app/apple-icon.png (the Mimic mark) are the App Router file
  // convention and Next emits the <link> tags itself; re-adding an `icons` key
  // here would OVERRIDE those files and is how the dangling reference happened.
  //
  // summary_large_image, not summary: links to this site are pasted into
  // Discord all day, and that is the card shape Discord renders as a banner
  // rather than a 64px thumbnail. app/opengraph-image.tsx supplies the picture.
  twitter: { card: 'summary_large_image' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Officer check runs server-side per request so the Admin nav link only
  // appears for officers. Non-officers never see the link in the source.
  // Signed-in users see "Me" — anonymous visitors don't. Both lookups are
  // React cache()'d, so pages sharing this request dedupe instead of
  // re-hitting Supabase (lib/session.ts + lib/officer.ts).
  const user = await getSessionUser();
  const showAdmin = user ? await isOfficer(user.id) : false;
  const showMe    = !!user;

  return (
    <html lang="en" className={`${display.variable} ${proseFace.variable}`}>
      <body className="font-mono">
        {/* Direction contract — audited at the finish review. Kept in the
            emitted markup so it survives the production build and can be
            grepped out of it. */}
        <div
          style={{ display: 'none' }}
          dangerouslySetInnerHTML={{ __html: `<!--
IMPECCABLE DIRECTION CONTRACT · landing · persuade · seed 29c36e6b

THESIS: This guild instruments itself, and the record is the proof. Refuses the
category default for a guild site: a logo, a hero image, and four identical
feature cards.

OWN-WORLD: An engraved natural-history specimen plate, inverted onto the night
ground the audience already reads on. Bone line on #0d1117, one committed gold
accent (#d29922) that belongs to the eyes and to live data and to nothing else.
Prata for the plate voice, Faustina for prose, mono kept only where the content
is measurement. Rules and hairlines, not cards.

STORY: A raider or a prospective member sees a wolf drawn like a specimen, a
pack surfacing behind it, and immediately below, real named bosses with real
timestamps and real damage. They believe the data is live, and they sign in.

FIRST VIEWPORT: Full-bleed wolf plate, alpha centred and already present, ears
unclipped; the headline is centred on her axis with the primary action directly
under it; five pack wolves surface behind on a stagger. The proof below the fold
is the platform map and its counts for a signed-out visitor, and the live kill
ledger for a signed-in member — corrected after the finish review caught the
first draft promising a ledger that a first-time visitor never sees.

FORM: Candidate 5 of the grounded list (engraved specimen plate), assigned by
the roll and pinned by the brief's wolf. Seed 29c36e6b, degraded roll: no
challengers, the roll service is blocked by this environment's egress proxy.

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance
-->` }}
        />
        {/* ⚠ Banner and bar share ONE sticky container. Two independently
            sticky elements at top-0 stack on top of each other; the header also
            has to sit below a banner whose height changes when it is folded. */}
        <div className="sticky top-0 z-50">
          {IS_BETA && <BetaBanner />}
          <SiteHeader
            showMe={showMe}
            showAdmin={showAdmin}
            authBadge={<AuthBadge />}
            tour={showMe ? <TourLauncher /> : null}
            search={showMe ? <GlobalSearch /> : null}
          />
        </div>
        <div className="max-w-7xl mx-auto p-3 sm:p-4">
          <main>{children}</main>
          <footer className="mt-12 text-xs text-dim space-y-1">
            <div>
              Data shared with the Discord bot via Supabase · the Mimic Parser dashboard
              lives at{' '}
              <LocalDashboardLink />{' '}
              for live in-raid stats.
            </div>
            <div>
              <a href="/about" className="text-blue hover:underline">About</a>{' '}
              <span aria-hidden>·</span>{' '}
              <a href="/privacy" className="text-blue hover:underline">Privacy</a>{' '}
              <span aria-hidden>·</span>{' '}
              <a href="/roadmap" className="text-blue hover:underline">Roadmap</a>{' '}
              <span aria-hidden>·</span>{' '}
              {!IS_BETA && <><BetaLink /> <span aria-hidden>·</span>{' '}</>}
              Your logs stay on your device. Toggle exclusions any time on{' '}
              <a href="/me" className="text-blue hover:underline">/me</a>.
            </div>
            {/* IP attribution. EverQuest's own art (item icons, spell gems) and
                its game data are Daybreak's, and this site shows both. Standard
                fan-project practice and what every long-running EQ community
                site carries — state plainly what this is and what it is not.
                Deliberately the quietest thing in the footer: it is a notice,
                not a message to the reader. */}
            <div className="pt-2 text-dim/70">
              EverQuest is a registered trademark of Daybreak Game Company LLC.
              All EverQuest game data and art assets are the property of Daybreak
              Game Company LLC. This is an unofficial, non-commercial fan-made
              companion for Project Quarm, and is neither affiliated with nor
              endorsed by Daybreak Game Company LLC.
            </div>
          </footer>
        </div>
        <GuidedTour signedIn={showMe} />
      </body>
    </html>
  );
}
