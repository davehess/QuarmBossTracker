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
// (a stub: the setup guide has the plan, there is no form yet).
// The hub_* tables may not exist on a database the registry has not been applied to; every hub read fails soft to
// "no guilds there", so the Wolf Pack card and the page itself still render.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { discordIdOf } from '@/lib/lockout';
import { GUILD_NAME, GUILD_TAG, PROD_SITE_URL } from '@/lib/guild';
import { isRaidmimicHost } from '@/lib/raidmimicHost';
import { closedMatchesFor } from '@/lib/hubRegistry';
import { EQMIMIC_ORIGIN, interestUrl } from '@/lib/raidmimicLanding';
import NewPageTag from '@/components/NewPageTag';
import SignInButton from '@/components/SignInButton';
import JoinForm from './JoinForm';

export const metadata: Metadata = {
  title: '[beta] Your guilds',
  description: 'The guilds you are in on Raid Mimic, with a way to join one by invite code, find the ones you already belong to, or start your own.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type HubCard = { guild_id: string; name: string; role: string; joined_at: string | null };
type WolfCard = { name: string; characters: number };

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', officer: 'Officer', member: 'Member', guest: 'Guest' };

// What "Find my guilds" reports back, by a closed vocabulary: nothing from the query string is echoed.
function findNote(find: string | undefined, found: string | undefined, closedCount: number): { text: string; good: boolean } | null {
  if (find === 'ok') {
    const n = Math.max(0, Math.min(99, parseInt(found ?? '0', 10) || 0));
    if (n > 0) return { text: `Found ${n} guild${n === 1 ? '' : 's'} you are in. They are listed above.`, good: true };
    return closedCount > 0
      ? { text: 'None of your Discord servers is open to join without a code. The ones that are guilds here are listed above.', good: false }
      : { text: 'None of your Discord servers is a guild on Raid Mimic yet. An invite code works without this.', good: false };
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

async function loadWolfPack(discordId: string): Promise<WolfCard | null> {
  try {
    const admin = supabaseAdmin();
    const { data: member } = await admin.from('wolfpack_members').select('discord_id, is_member').eq('discord_id', discordId).maybeSingle();
    if (!member?.is_member) return null;
    const { count } = await admin.from('characters').select('name', { count: 'exact', head: true })
      .eq('guild_id', GUILD_TAG).eq('discord_id', discordId);
    return { name: GUILD_NAME, characters: count ?? 0 };
  } catch {
    return null;
  }
}

async function loadHubGuilds(discordId: string): Promise<HubCard[]> {
  try {
    const admin = supabaseAdmin();
    const { data: player } = await admin.from('hub_players').select('player_id').eq('discord_id', discordId).is('deleted_at', null).maybeSingle();
    if (!player) return [];
    const { data: mine, error } = await admin.from('hub_memberships').select('guild_id, role, joined_at').eq('player_id', player.player_id).is('left_at', null);
    if (error || !mine?.length) return [];
    const { data: guilds } = await admin.from('hub_guilds').select('guild_id, display_name').in('guild_id', mine.map(m => m.guild_id)).is('suspended_at', null);
    const names = new Map((guilds ?? []).map(g => [g.guild_id as string, g.display_name as string]));
    return mine
      .filter(m => names.has(m.guild_id))
      .map(m => ({ guild_id: m.guild_id, name: names.get(m.guild_id)!, role: m.role, joined_at: m.joined_at ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
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

export default async function GuildsPage({ searchParams }: { searchParams: { find?: string; found?: string; closed?: string } }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/guilds');
  const discordId = discordIdOf(user);
  const onHost = isRaidmimicHost(headers().get('host'));

  const [wolf, hub] = discordId ? await Promise.all([loadWolfPack(discordId), loadHubGuilds(discordId)]) : [null, [] as HubCard[]];
  const closed = searchParams.find === 'ok' ? await loadClosedMatches(searchParams.closed, hub) : [];
  const note = findNote(searchParams.find, searchParams.found, closed.length);
  const startHref = onHost ? '/setup#guild' : '/raidmimic/setup#guild';

  return (
    <div className="mx-auto max-w-3xl px-1 py-2 pb-12">
      <NewPageTag note="New page: the guilds you are in, and how to join or start one." href={onHost ? interestUrl(`${EQMIMIC_ORIGIN}/feedback`) : '/feedback'} />
      <h1 className="text-2xl text-gold">Your guilds</h1>
      <p className="mt-1 text-sm text-dim">Signed in with Discord. Only you can see this page.</p>

      <section aria-label="Your guilds" className="mt-4 space-y-3">
        {wolf && (
          <article className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg text-[#f2ede1]">{wolf.name}</h2>
              <span className={PILL}>Member</span>
            </div>
            <p className="mt-1 text-sm text-dim">{wolf.characters} character{wolf.characters === 1 ? '' : 's'} on file</p>
            <p className="mt-2 flex flex-wrap gap-x-5">
              <a href={`${PROD_SITE_URL}/me`} className={LINK}>Open my page →</a>
              <a href={`${PROD_SITE_URL}/auth/mimic-link`} className={LINK}>Link Mimic →</a>
            </p>
          </article>
        )}
        {hub.map(g => (
          <article key={g.guild_id} className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg text-[#f2ede1]">{g.name}</h2>
              <span className={PILL}>{ROLE_LABEL[g.role] ?? 'Member'}</span>
            </div>
            {g.joined_at && <p className="mt-1 text-sm text-dim">Joined {g.joined_at.slice(0, 10)}</p>}
            <p className="mt-2 text-xs text-dim">This guild&rsquo;s own page is coming soon.</p>
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
          <p className="mt-1 text-xs leading-5 text-dim">Coming soon. Starting a guild here is not open yet.</p>
          <p className="mt-2"><a href={startHref} className={LINK}>How guilds will work →</a></p>
        </div>
      </section>
    </div>
  );
}
