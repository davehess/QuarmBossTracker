// /guilds/<slug>: one guild's own page for its members (the guild lead, 2026-10-31, DECISIONS §492; wizard step 3).
// New page, so it goes live with the [beta] tag. Signed-in players only.
//
// Who sees what is web/lib/hubGuilds.ts guildAccess: a member sees the guild; a non-member of an open_join guild sees only
// its name; a missing, suspended or closed-and-not-yours guild is a 404, so the page never confirms a closed guild exists.
// An owner or officer also gets the Invites section. The invite query runs ONLY for them: a member's request never reads
// hub_invites at all. The buttons are InviteControls.tsx and the checks that matter are repeated in actions.ts.
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { discordIdOf } from '@/lib/lockout';
import { isRaidmimicHost } from '@/lib/raidmimicHost';
import { GUILD_SLUG_RX } from '@/lib/hubRegistry';
import { EQMIMIC_ORIGIN, interestUrl } from '@/lib/raidmimicLanding';
import { pageMetadata } from '@/lib/pageMetaData';
import { guildAccess, activeInvites, canManageInvites, ROLE_LABEL, type InviteListRow } from '@/lib/hubGuilds';
import NewPageTag from '@/components/NewPageTag';
import { NewInviteButton, RevokeButton } from './InviteControls';

// The card and the tab say the same words: "Guild", never the guild's name (web/lib/pageMeta.ts).
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  return { ...(await pageMetadata(`/guilds/${encodeURIComponent(params.slug)}`)), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

type GuildRow = { guild_id: string; display_name: string; plan: string; open_join: boolean | null; discord_guild_id: string | null; suspended_at: string | null };

const PLAN_LABEL: Record<string, string> = { commons: 'Commons (free)', managed: 'Managed', self_hosted: 'Self-hosted' };
const CARD = 'rounded-lg border border-border bg-panel p-4';
const PILL = 'rounded border border-border px-2 py-0.5 text-xs text-dim';

const when = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

export default async function GuildPage({ params }: { params: { slug: string } }) {
  const slug = params.slug;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=${encodeURIComponent(`/guilds/${slug}`)}`);
  if (!GUILD_SLUG_RX.test(slug)) notFound();
  const discordId = discordIdOf(user);
  const onHost = isRaidmimicHost(headers().get('host'));

  const admin = supabaseAdmin();
  let guild: GuildRow | null = null;
  let membership: { role: string; left_at: string | null } | null = null;
  try {
    const { data: g } = await admin.from('hub_guilds').select('guild_id, display_name, plan, open_join, discord_guild_id, suspended_at').eq('guild_id', slug).maybeSingle();
    guild = (g as GuildRow | null) ?? null;
    if (guild && discordId) {
      const { data: player } = await admin.from('hub_players').select('player_id').eq('discord_id', discordId).is('deleted_at', null).maybeSingle();
      if (player) {
        const { data: m } = await admin.from('hub_memberships').select('role, left_at').eq('guild_id', slug).eq('player_id', player.player_id).maybeSingle();
        membership = m ?? null;
      }
    }
  } catch {
    guild = null;   // the registry is not applied here: there is no such guild to show
  }

  const access = guildAccess(guild, membership);
  if (access.kind === 'hidden' || !guild) notFound();

  const feedbackHref = onHost ? interestUrl(`${EQMIMIC_ORIGIN}/feedback`) : '/feedback';

  if (access.kind === 'visitor') {
    return (
      <div className="mx-auto max-w-3xl px-1 py-2 pb-12">
        <NewPageTag note="New page: a guild's own page." href={feedbackHref} />
        <h1 className="text-2xl text-gold">{guild.display_name}</h1>
        <p className={`${CARD} mt-4 text-sm text-dim`}>
          You are not a member of this guild. Ask an officer for an invite code, then enter it under &ldquo;Join a guild&rdquo; on Your guilds.
        </p>
        <p className="mt-4"><a href="/guilds" className="inline-flex min-h-11 items-center text-sm">&larr; Your guilds</a></p>
      </div>
    );
  }

  const { count: memberCount } = await admin.from('hub_memberships').select('player_id', { count: 'exact', head: true }).eq('guild_id', slug).is('left_at', null);

  // Only an owner or officer reads the invites.
  let invites: InviteListRow[] = [];
  const manage = canManageInvites(access.role);
  if (manage) {
    const { data } = await admin.from('hub_invites').select('code, uses, max_uses, expires_at').eq('guild_id', slug);
    invites = activeInvites((data ?? []) as InviteListRow[]);
  }

  return (
    <div className="mx-auto max-w-3xl px-1 py-2 pb-12">
      <NewPageTag note="New page: a guild's own page." href={feedbackHref} />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl text-gold">{guild.display_name}</h1>
        <span className={PILL}>{ROLE_LABEL[access.role] ?? 'Member'}</span>
      </div>

      <section aria-label="About this guild" className={`${CARD} mt-4`}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-dim">Plan</dt><dd className="text-text">{PLAN_LABEL[guild.plan] ?? guild.plan}</dd></div>
          <div><dt className="text-xs text-dim">Members</dt><dd className="text-text">{memberCount ?? 0}</dd></div>
          <div><dt className="text-xs text-dim">Your role</dt><dd className="text-text">{ROLE_LABEL[access.role] ?? 'Member'}</dd></div>
          {guild.discord_guild_id && (
            <div><dt className="text-xs text-dim">Discord server id</dt><dd className="font-mono text-text">{guild.discord_guild_id}</dd></div>
          )}
        </dl>
      </section>

      <section aria-label="Invites" className={`${CARD} mt-4`}>
        <h2 className="text-base text-[#f2ede1]">Invites</h2>
        {manage ? (
          <>
            <p className="mt-1 text-xs leading-5 text-dim">
              Hand a code to a raider; they enter it under &ldquo;Join a guild&rdquo; on Your guilds. A code works for 25 people and for 7 days.
            </p>
            {invites.length > 0 ? (
              <ul className="m-0 mt-3 list-none space-y-2 p-0">
                {invites.map(inv => (
                  <li key={inv.code} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-mono text-base tracking-widest text-text">{inv.code}</span>
                    <span className="text-xs text-dim">{inv.uses} of {inv.max_uses} used</span>
                    <span className="text-xs text-dim">expires {when(inv.expires_at)}</span>
                    <RevokeButton slug={slug} code={inv.code} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-dim">No live codes.</p>
            )}
            <div className="mt-3"><NewInviteButton slug={slug} /></div>
          </>
        ) : (
          <p className="mt-1 text-sm text-dim">Ask an officer for an invite code.</p>
        )}
      </section>

      <p className="mt-4"><a href="/guilds" className="inline-flex min-h-11 items-center text-sm">&larr; Your guilds</a></p>
    </div>
  );
}
