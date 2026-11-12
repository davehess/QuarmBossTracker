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
import { EQMIMIC_ORIGIN } from '@/lib/raidmimicLanding';
import { pageMetadata } from '@/lib/pageMetaData';
import { isOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';
import { readGuildSettingsRow, nextRaidLine } from '@/lib/guildSettingsLoad';
import { guildAccess, activeInvites, canManageInvites, ROLE_LABEL, type InviteListRow } from '@/lib/hubGuilds';
import NewPageTag from '@/components/NewPageTag';
import { GUILDS_STAY_PATH, cleanSiteUrl, siteLabel } from '@/lib/guildSites';
import { NewInviteButton, RevokeButton } from './InviteControls';
import SiteSettings from './SiteSettings';
import HostFrame from '@/components/RaidmimicFrame';

// The card and the tab say the same words: "Guild", never the guild's name (web/lib/pageMeta.ts).
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  return { ...(await pageMetadata(`/guilds/${encodeURIComponent(params.slug)}`)), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

type GuildRow = { guild_id: string; display_name: string; plan: string; open_join: boolean | null; discord_guild_id: string | null; suspended_at: string | null; website_url: string | null; redirect_members: boolean | null };

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
    const { data: g } = await admin.from('hub_guilds').select('guild_id, display_name, plan, open_join, discord_guild_id, suspended_at, website_url, redirect_members').eq('guild_id', slug).maybeSingle();
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

  let access = guildAccess(guild, membership);
  // The built-in guild has no invites and no hub membership to speak of: its site officers (the people /admin lets in) run it
  // here. They get the setup card and the settings link, not the invite and website forms, whose actions need a registry role.
  let viaSite = false;
  if (guild && !guild.suspended_at && slug === GUILD_TAG && !(access.kind === 'member' && canManageInvites(access.role)) && (await isOfficer(user.id))) {
    access = { kind: 'member', role: 'officer' };
    viaSite = true;
  }
  if (access.kind === 'hidden' || !guild) notFound();

  const feedbackHref = onHost ? `${EQMIMIC_ORIGIN}/feedback` : '/feedback';

  if (access.kind === 'visitor') {
    return (
      <HostFrame onHost={onHost}>
      <div className="mx-auto max-w-3xl px-1 py-2 pb-12">
        <NewPageTag note="New page: a guild's own page." href={feedbackHref} />
        <h1 className="text-2xl text-gold">{guild.display_name}</h1>
        <p className={`${CARD} mt-4 text-sm text-dim`}>
          You are not a member of this guild. Ask an officer for an invite code, then enter it under &ldquo;Join a guild&rdquo; on Your guilds.
        </p>
        <p className="mt-4"><a href={GUILDS_STAY_PATH} className="inline-flex min-h-11 items-center text-sm">&larr; Your guilds</a></p>
      </div>
      </HostFrame>
    );
  }

  const { count: memberCount } = await admin.from('hub_memberships').select('player_id', { count: 'exact', head: true }).eq('guild_id', slug).is('left_at', null);

  // Only an owner or officer reads the invites.
  let invites: InviteListRow[] = [];
  let anyInvite = false;
  const configure = canManageInvites(access.role);   // owners and officers; a site officer of the built-in guild counts
  const manage = configure && !viaSite;              // invites and the website form need a registry role
  const stored = await readGuildSettingsRow(slug);
  const raidLine = stored?.saved && stored.settings.schedule.days.length > 0 ? nextRaidLine(stored.settings.schedule, Date.now()) : null;
  const site = cleanSiteUrl(guild.website_url);
  if (manage) {
    const { data } = await admin.from('hub_invites').select('code, uses, max_uses, expires_at').eq('guild_id', slug);
    anyInvite = (data ?? []).length > 0;
    invites = activeInvites((data ?? []) as InviteListRow[]);
  }

  return (
    <HostFrame onHost={onHost}>
    <div className="mx-auto max-w-3xl px-1 py-2 pb-12">
      <NewPageTag note="New page: a guild's own page." href={feedbackHref} />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl text-gold">{guild.display_name}</h1>
        <span className={PILL}>{ROLE_LABEL[access.role] ?? 'Member'}</span>
      </div>

      <section aria-label="About this guild" className={`${CARD} mt-4`}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-dim">Plan</dt><dd className="text-text">{PLAN_LABEL[guild.plan] ?? guild.plan}</dd></div>
          {slug !== GUILD_TAG && <div><dt className="text-xs text-dim">Members</dt><dd className="text-text">{memberCount ?? 0}</dd></div>}
          {raidLine && <div><dt className="text-xs text-dim">Next raid</dt><dd className="text-text">{raidLine}</dd></div>}
          <div><dt className="text-xs text-dim">Your role</dt><dd className="text-text">{ROLE_LABEL[access.role] ?? 'Member'}</dd></div>
          {guild.discord_guild_id && (
            <div><dt className="text-xs text-dim">Discord server id</dt><dd className="font-mono text-text">{guild.discord_guild_id}</dd></div>
          )}
        </dl>
      </section>

      {configure && (() => {
        const rowSaved = !!stored?.saved && !!stored.updatedBy;
        const r = stored?.settings.roles;
        const steps: { done: boolean; label: string; href: string; cta: string }[] = [
          { done: !!guild.discord_guild_id, label: 'Discord server linked', href: feedbackHref, cta: 'Not linked: tell us and we will add it' },
          { done: rowSaved, label: 'Raid schedule saved', href: `/guilds/${slug}/settings#schedule`, cta: 'Set the schedule' },
          { done: rowSaved && !!r && (r.leader.length > 0 || r.officer.length > 0), label: 'Roles mapped', href: `/guilds/${slug}/settings#roles`, cta: 'Map your roles' },
          { done: rowSaved, label: 'DKP chosen', href: `/guilds/${slug}/settings#dkp`, cta: 'Choose DKP' },
          { done: rowSaved, label: 'Guest rule chosen', href: `/guilds/${slug}/settings#guests`, cta: 'Choose the guest rule' },
          ...(viaSite ? [] : [{ done: anyInvite, label: 'First invite made', href: '#invites', cta: 'Make an invite code' }]),
          { done: false, label: 'Mimic installed', href: onHost ? '/setup' : '/mimic', cta: 'Get Mimic' },
        ];
        return (
          <section aria-label="Set up your guild" className={`${CARD} mt-4`}>
            <h2 className="text-base text-text">Set up your guild</h2>
            <ol className="m-0 mt-2 list-none space-y-1 p-0">
              {steps.map(st => (
                <li key={st.label} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className={`${PILL} ${st.done ? 'text-green' : ''}`}>{st.done ? 'Done' : 'To do'}</span>
                  <span className="text-text">{st.label}</span>
                  {!st.done && <a href={st.href} className="inline-flex min-h-11 items-center text-sm">{st.cta} &rarr;</a>}
                </li>
              ))}
            </ol>
            <p className="mt-2"><a href={`/guilds/${slug}/settings`} className="inline-flex min-h-11 items-center text-sm">Open guild settings &rarr;</a></p>
          </section>
        );
      })()}

      {/* The guild's own website (the guild lead, 2026-11-02, "redirect by default"). Anyone in the guild sees the link;
          only an owner or officer sees the form, and the server action checks the role again. */}
      <section aria-label="Website" className={`${CARD} mt-4`}>
        <h2 className="text-base text-[#f2ede1]">Website</h2>
        {site && <p className="mt-1 text-sm"><a href={site} className="inline-flex min-h-11 items-center">Open {guild.display_name}&rsquo;s site ({siteLabel(site)}) &rarr;</a></p>}
        {manage ? (
          <>
            <p className="mt-1 text-xs leading-5 text-dim">
              Where your guild lives online. With the box ticked, a member who signs in on Raid Mimic goes straight there; they can
              still reach this page from &ldquo;Your guilds&rdquo;.
            </p>
            <SiteSettings slug={slug} url={site} redirectMembers={guild.redirect_members !== false} />
          </>
        ) : (
          !site && <p className="mt-1 text-sm text-dim">This guild has not set a website.</p>
        )}
      </section>

      {slug !== GUILD_TAG && (
        <section id="invites" aria-label="Invites" className={`${CARD} mt-4`}>
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
      )}

      <p className="mt-4"><a href={GUILDS_STAY_PATH} className="inline-flex min-h-11 items-center text-sm">&larr; Your guilds</a></p>
    </div>
    </HostFrame>
  );
}
