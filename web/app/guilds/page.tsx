// /guilds: "Your guilds" (the guild lead, 2026-10-31, DECISIONS §492: "when someone goes to RaidMimic.com it should be
// more about their signing in than anything, and grouped by guild"). Where raidmimic.com sends a player after sign-in.
//
// New page, so it goes live with the [beta] tag. Signed-in players only, and a player only ever sees their OWN rows:
// every read below is keyed on the signed-in Discord id or the player id taken from it. Served on raidmimic.com
// (the middleware lets /guilds through, web/lib/raidmimicHost.ts) and on wolfpack.quest.
//
// One card per guild the player is in: Wolf Pack when their Discord id is a Wolf Pack member, plus one per
// hub_memberships row (the registry, web/lib/hubRegistry.ts). Under them, three cards: join with an invite code,
// "Find my guilds" (an optional SECOND Discord consent, only on a raidmimic host: openSignIn.ts), and start a guild
// (a link to /guilds/new). Each hub card opens /guilds/<slug>.
// The hub_* tables may not exist on a database the registry has not been applied to; every hub read fails soft to
// "no guilds there", so the Wolf Pack card and the page itself still render.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { discordIdOf } from '@/lib/lockout';
import { GUILD_TAG } from '@/lib/guild';
import { loadHubGuilds, loadWolfPack, type HubCard } from '@/lib/hubGuildsLoad';
import { builtinGuildSite, redirectTarget, sitePage, siteLabel, wantsToStay, type GuildRef } from '@/lib/guildSites';
import { isRaidmimicHost } from '@/lib/raidmimicHost';
import { closedMatchesFor } from '@/lib/hubRegistry';
import { EQMIMIC_ORIGIN } from '@/lib/raidmimicLanding';
import NewPageTag from '@/components/NewPageTag';
import SignInButton from '@/components/SignInButton';
import JoinForm from './JoinForm';
import YourData from '@/app/me/data/YourData';
import HostFrame from '@/components/RaidmimicFrame';

export const metadata: Metadata = {
  title: '[beta] Your guilds',
  description: 'The guilds you are in on Raid Mimic, with a way to join one by invite code, find the ones you already belong to, or start your own.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', officer: 'Officer', member: 'Member', guest: 'Guest' };

// What "Find my guilds" reports back, by a closed vocabulary: nothing from the query string is echoed.
// `listed`: a guild card is already on the page (Wolf Pack's, which this search does not cover), so "none" must say "no other".
function findNote(find: string | undefined, found: string | undefined, closedCount: number, listed = false): { text: string; good: boolean } | null {
  if (find === 'ok') {
    const n = Math.max(0, Math.min(99, parseInt(found ?? '0', 10) || 0));
    if (n > 0) return { text: `Found ${n} guild${n === 1 ? '' : 's'} you are in. They are listed above.`, good: true };
    return closedCount > 0
      ? { text: 'None of your Discord servers is open to join without a code. The ones that are guilds here are listed above.', good: false }
      : { text: listed ? 'No other guilds of yours have opted into Raid Mimic yet.' : 'None of your guilds have opted into Raid Mimic yet.', good: false };
  }
  if (!find) return null;
  const why: Record<string, string> = {
    refused: 'Discord did not share your server list. Press the button again and allow it.',
    no_token: 'Discord did not send what we needed. Press the button again.',
    discord_error: 'Discord could not be reached just now. Try again in a minute.',
    error: 'Could not look up guilds just now. Try again in a minute.',
  };
  return { text: why[find] ?? why.error, good: false };
}

// The Discord matches that need an invite code, named by "Find my guilds" in the redirect (openSignIn.ts) and NEVER stored.
// The query is only a list of slugs: each is shape-checked, at most ten are read, and a name is shown only for a guild that
// really exists, is not suspended and is not open_join (an open one would have been joined, not listed). One already in
// the player's own list is dropped.
const loadClosedMatches = (raw: string | undefined, mine: HubCard[]) =>
  closedMatchesFor(raw, mine.map(m => m.guild_id), async (slugs) => {
    const { data } = await supabaseAdmin().from('hub_guilds').select('guild_id, display_name')
      .in('guild_id', slugs).eq('open_join', false).is('suspended_at', null);
    return (data ?? []) as { guild_id: string; display_name: string }[];
  });

const CARD = 'rounded-lg border border-border bg-panel p-4';
const PILL = 'rounded border border-border px-2 py-0.5 text-xs text-dim';
const LINK = 'inline-flex min-h-11 items-center text-sm';

export default async function GuildsPage({ searchParams }: { searchParams: { find?: string; found?: string; closed?: string; stay?: string } }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/guilds');
  const discordId = discordIdOf(user);
  const onHost = isRaidmimicHost(headers().get('host'));

  const [wolf, hub] = discordId ? await Promise.all([loadWolfPack(discordId), loadHubGuilds(discordId)]) : [null, [] as HubCard[]];

  // The built-in guild's site comes from configuration (web/lib/guildSites.ts), a hosted guild's from its row.
  const wolfSite = builtinGuildSite();
  // Redirect by default (the guild lead, 2026-11-02): on raidmimic.com a player whose only guild has a website and the
  // redirect on goes straight to it. `?stay=1` (the bar's "Your guilds", the "back" links) and the Find-my-guilds answer
  // keep them here. On the Wolf Pack hosts the page is shown as it always was.
  if (onHost) {
    const mine: GuildRef[] = [
      ...(wolf ? [{ guildId: GUILD_TAG, url: wolfSite.url, redirect: wolfSite.redirect }] : []),
      ...hub.map(g => ({ guildId: g.guild_id, url: g.site, redirect: g.redirect })),
    ];
    const to = redirectTarget(mine, wantsToStay(searchParams));
    if (to) redirect(to);
  }
  const closed = searchParams.find === 'ok' ? await loadClosedMatches(searchParams.closed, hub) : [];
  const note = findNote(searchParams.find, searchParams.found, closed.length, !!wolf || hub.length > 0);

  return (
    <HostFrame onHost={onHost}>
    <div className="mx-auto max-w-3xl px-1 py-2 pb-12">
      <NewPageTag note="New page: the guilds you are in, and how to join or start one." href={onHost ? `${EQMIMIC_ORIGIN}/feedback` : '/feedback'} />
      <h1 className="text-2xl text-gold">Your guilds</h1>
      <p className="mt-1 text-sm text-dim">
        Signed in with Discord. Only you can see this page.{' '}
        <a href={onHost ? '#your-data' : '/me#your-data'} className="whitespace-nowrap text-blue hover:underline">Your data →</a>
      </p>

      <section aria-label="Your guilds" className="mt-4 space-y-3">
        {wolf && (
          <article className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg text-[#f2ede1]">{wolf.name}</h2>
              <span className={PILL}>Member</span>
            </div>
            {/* Same shape as the other guild cards (the guild lead, 2026-11-02: "This looks like it's hard-tied to wolfpack
                here"). It opens on its own site, which is configuration (builtinGuildSite), never typed into this page:
                Wolf Pack has a hub_guilds row since 2026-11-12, but /guilds/<its slug> is its officers' settings page, not a member page. */}
            <p className="mt-1 text-sm text-dim">
              {wolf.characters} character{wolf.characters === 1 ? '' : 's'} on file{wolfSite.url ? ` · its own site, ${siteLabel(wolfSite.url)}` : ''}
            </p>
            {wolfSite.url && <p className="mt-2"><a href={sitePage(wolfSite.url)!} className={LINK}>Open the guild&rsquo;s site &rarr;</a></p>}
          </article>
        )}
        {hub.map(g => (
          <article key={g.guild_id} className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg text-[#f2ede1]">{g.name}</h2>
              <span className={PILL}>{ROLE_LABEL[g.role] ?? 'Member'}</span>
            </div>
            {g.joined_at && <p className="mt-1 text-sm text-dim">Joined {g.joined_at.slice(0, 10)}</p>}
            <p className="mt-2 flex flex-wrap gap-x-5">
              <a href={`/guilds/${g.guild_id}`} className={LINK}>Open the guild &rarr;</a>
              {g.site && <a href={g.site} className={LINK}>Open {g.name}&rsquo;s site &rarr;</a>}
            </p>
          </article>
        ))}
        {closed.length > 0 && (
          <div className={CARD} aria-label="Guilds you're in on Discord">
            <h2 className="text-base text-[#f2ede1]">Guilds you&rsquo;re in on Discord</h2>
            <p className="mt-1 text-xs leading-5 text-dim">
              These need an invite code, so you were not added. Ask an officer for an invite code, then enter it under &ldquo;Join a guild&rdquo;.
            </p>
            <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-sm text-text marker:text-dim">
              {closed.map(g => <li key={g.guild_id}>{g.name}</li>)}
            </ul>
          </div>
        )}
        {!wolf && hub.length === 0 && closed.length === 0 && (
          <p className={`${CARD} text-sm text-dim`}>
            You are not in a guild on Raid Mimic yet. Join one with an invite code below, or find the ones you already belong to.
          </p>
        )}
      </section>

      <section aria-label="Add a guild" className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className={CARD}>
          <h2 className="text-base text-[#f2ede1]">Join a guild</h2>
          <p className="mt-1 text-xs leading-5 text-dim">Your guild&rsquo;s officer gives you a six-character code.</p>
          <JoinForm />
        </div>

        <div className={CARD}>
          <h2 className="text-base text-[#f2ede1]">Find my guilds</h2>
          {onHost ? (
            <>
              <p className="mt-1 text-xs leading-5 text-dim">
                Asks Discord once for the list of servers you are in, adds you to the ones that are guilds here, and
                keeps nothing else. Optional: an invite code works without it.
              </p>
              <div className="mt-3"><SignInButton next="/guilds" flow="guilds" label="Find my guilds" /></div>
            </>
          ) : (
            <p className="mt-1 text-xs leading-5 text-dim">
              Finding your guilds from your Discord servers is on <a href="https://raidmimic.com/guilds" className="underline">raidmimic.com/guilds</a>.
            </p>
          )}
          {note && <p role="status" className={`mt-3 text-xs ${note.good ? 'text-green' : 'text-dim'}`}>{note.text}</p>}
        </div>

        <div className={CARD}>
          <h2 className="text-base text-[#f2ede1]">Start a guild</h2>
          <p className="mt-1 text-xs leading-5 text-dim">Name it, pick its address, and invite your raiders with codes. You become its owner.</p>
          <p className="mt-2"><a href="/guilds/new" className={LINK}>Start a guild →</a></p>
        </div>
      </section>

      {/* /me is not served on raidmimic hosts, so the section lives here, with its own download route under /guilds. */}
      {onHost && <div className="mt-6"><YourData exportHref="/guilds/data/export" /></div>}
    </div>
    </HostFrame>
  );
}
