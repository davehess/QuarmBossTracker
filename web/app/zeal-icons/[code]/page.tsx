// /zeal-icons/<code>: one guild's banner, icon and picture file (layout B, on beta until the guild
// lead picks a layout). A link to hand one guild leader. Public, static, no user and no database.
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GUILDS, guildByCode, markSrc } from '@/lib/zealIcons';
import { Code, GetYours, GuildKeys, H1, H2, InstallSteps, Mark, PictureDownloads, StatusNote } from '../parts';

export const dynamicParams = false;  // Only the guilds we have drawn.

export function generateStaticParams() {
  return GUILDS.map(g => ({ code: g.code.toLowerCase() }));
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const guild = guildByCode((await params).code);
  if (!guild) return {};
  return {
    title: `${guild.name}: Zeal tag icon`,
    description: `${guild.name}'s banner and icon for Zeal /tag: ^B${guild.code}^ and ^I${guild.code}^.`,
  };
}

export default async function GuildIconsPage({ params }: { params: Promise<{ code: string }> }) {
  const guild = guildByCode((await params).code);
  if (!guild) notFound();
  return (
    <div className="mx-auto max-w-3xl py-2">
      <Link href="/zeal-icons?v=b" className="text-sm text-dim no-underline hover:text-text">← All guilds</Link>
      <h1 className={`${H1} mt-3`}>{guild.name}</h1>

      <div className="mt-6 flex flex-wrap items-end justify-center gap-8 rounded-lg bg-[radial-gradient(ellipse_at_50%_120%,#3a4a2e,#141b10)] px-4 py-8">
        <figure className="text-center">
          <Mark src={markSrc.banner(guild.code)} alt={`${guild.name} banner`} size={128} />
          <figcaption className="mt-2 text-xs text-dim">banner</figcaption>
        </figure>
        <figure className="text-center">
          <Mark src={markSrc.guild(guild.code)} alt={`${guild.name} icon`} size={128} />
          <figcaption className="mt-2 text-xs text-dim">icon</figcaption>
        </figure>
        {guild.pictures?.length ? (
          <figure className="text-center">
            <Mark src={markSrc.picture(guild.pictures[0].file)} alt={`${guild.name} picture`} size={128} />
            <figcaption className="mt-2 text-xs text-dim">picture</figcaption>
          </figure>
        ) : null}
      </div>

      <section className="mt-8">
        <h2 className={H2}>Keys</h2>
        <div className="mt-3"><GuildKeys guild={guild} /></div>
        <p className="mt-3 text-sm leading-6 text-text">
          Target a mob, corpse or player and type <Code>/tag rsay ^I{guild.code}^Kill</Code> for your raid,{' '}
          <Code>gsay</Code> for your group, or <Code>local</Code> for only you.
        </p>
      </section>

      <section className="mt-8">
        <h2 className={H2}>Picture file</h2>
        <div className="mt-3 space-y-4">
          {guild.pictures?.length ? (
            <>
              <PictureDownloads guild={guild} preview={false} />
              <InstallSteps />
            </>
          ) : (
            <GetYours />
          )}
        </div>
      </section>

      <StatusNote />
    </div>
  );
}
