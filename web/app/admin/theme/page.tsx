// /admin/theme: officers set the guild's colours, font, logo and Discord embed colour, with a live preview beside
// the form (the guild lead, 2026-10-31: theming "should be a part of our designer"; docs/DESIGN-theming.md
// section 5). New page, so it ships live with the [beta] tag (DECISIONS §135).
//
// The theme is applied as --wp-* variables on <html> by the root layout. Until the site's token layer reaches
// main those variables are inert, so a saved theme shows here (in the preview) and in the bot's embeds first.
import Link from 'next/link';
import { requireOfficer } from '@/lib/officer';
import { readGuildTheme, DEFAULT_THEME } from '@/lib/guildTheme';
import NewPageTag from '@/components/NewPageTag';
import ThemeEditor from './ThemeEditor';

export const metadata = {
  title: '[beta] Guild theme · Admin',
  description: 'Set the guild’s colours, font, logo and Discord embed colour, with a live preview.',
};

export const dynamic = 'force-dynamic';

export default async function AdminThemePage() {
  // Gate first: the /admin layout does not stop a page from loading its data on its own.
  await requireOfficer();

  // The editor reads the table itself (not the 60 s copy the layout uses) so an officer sees their own save.
  const saved = await readGuildTheme();

  return (
    <div className="space-y-4">
      <NewPageTag note="Pick the guild's colours; the preview updates as you type." />
      <section className="rounded-lg border border-border bg-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-3 text-2xl text-gold">
              <span aria-hidden>🎨</span>
              <span>Guild theme</span>
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-dim">
              The colours, font and logo the site wears for this guild, and the colour of Discord cards that have no
              meaning of their own. Green, red, gold and orange stay fixed everywhere: they tell a raider what
              happened, so a guild cannot repaint them. The site picks a saved theme up within a minute; the bot within
              a minute too.
            </p>
          </div>
          <Link href="/admin" className="whitespace-nowrap text-sm text-blue hover:underline">← Officer tools</Link>
        </div>
      </section>
      {saved === null && (
        <p role="alert" className="rounded border border-red/50 bg-red/10 p-3 text-sm text-red">
          The saved theme could not be read just now, so the form shows today&apos;s values. Saving still works.
        </p>
      )}
      <ThemeEditor initial={saved ?? DEFAULT_THEME} />
    </div>
  );
}
