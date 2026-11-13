// /guilds/<slug>/settings: a guild's raid schedule, roles, jobs, DKP, guest rule and links, edited by its officers (the guild
// lead, 2026-11-12, Decision Desk). New page, so it goes live with the [beta] tag (DECISIONS §135).
//
// Who sees it is web/lib/guildSettingsAccess.ts: the owner or an officer of the guild, or a site officer for the built-in
// guild. Everyone else gets a 404, so the page never confirms a closed guild exists. The server action checks again.
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isRaidmimicHost } from '@/lib/raidmimicHost';
import { GUILD_SLUG_RX } from '@/lib/hubRegistry';
import { GUILD_TAG } from '@/lib/guild';
import { EQMIMIC_ORIGIN } from '@/lib/raidmimicLanding';
import { pageMetadata } from '@/lib/pageMetaData';
import { settingsActor } from '@/lib/guildSettingsAccess';
import { readGuildSettingsRow, DEFAULT_SETTINGS } from '@/lib/guildSettingsLoad';
import NewPageTag from '@/components/NewPageTag';
import HostFrame from '@/components/RaidmimicFrame';
import SettingsForm from './SettingsForm';

// The card and the tab say the same words: "Guild settings", never the guild's name (web/lib/pageMeta.ts).
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  return { ...(await pageMetadata(`/guilds/${encodeURIComponent(params.slug)}/settings`)), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

export default async function GuildSettingsPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=${encodeURIComponent(`/guilds/${slug}/settings`)}`);
  if (!GUILD_SLUG_RX.test(slug)) notFound();
  const actor = await settingsActor(slug);
  if (!actor) notFound();

  const onHost = isRaidmimicHost(headers().get('host'));
  const feedbackHref = onHost ? `${EQMIMIC_ORIGIN}/feedback` : '/feedback';
  const { data: g } = await supabaseAdmin().from('hub_guilds').select('display_name').eq('guild_id', slug).maybeSingle();
  // Read the table itself (not the 60 s copy) so an officer sees their own save at once.
  const stored = await readGuildSettingsRow(slug);

  return (
    <HostFrame onHost={onHost}>
    <div className="mx-auto max-w-3xl px-1 py-2 pb-12">
      <NewPageTag note="New page: a guild’s settings." href={feedbackHref} />
      <h1 className="text-2xl text-gold">Guild settings</h1>
      <p className="mt-1 text-sm text-dim">{g?.display_name ?? slug}</p>
      <p className="mt-3 rounded-lg border border-border bg-panel p-4 text-sm leading-6 text-dim">
        {slug === GUILD_TAG ? (
          <>
            The <b className="text-text">raid schedule</b> here is live: the bot uses it for raid nights and attendance ticks, and a change takes
            up to 10 minutes to apply. The reminders posted before a raid still use the built-in times. Ranks, jobs, DKP and the guest rule
            are <b className="text-text">saved</b> but not used yet.
          </>
        ) : (
          <>
            This first version <b className="text-text">saves</b> these settings and shows the next raid. Nothing else reads them yet for a
            guild hosted here; each part is switched on as it is built.
          </>
        )}
      </p>
      {stored === null && (
        <p role="alert" className="mt-4 rounded border border-red/50 bg-red/10 p-3 text-sm text-red">
          The saved settings could not be read just now, so the form shows the starting values. Saving still works.
        </p>
      )}
      <SettingsForm slug={slug} initial={stored?.settings ?? DEFAULT_SETTINGS} />
      <p className="mt-4"><a href={`/guilds/${slug}`} className="inline-flex min-h-11 items-center text-sm">&larr; Back to the guild</a></p>
    </div>
    </HostFrame>
  );
}
