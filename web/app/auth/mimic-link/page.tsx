// /auth/mimic-link — the human side of the Mimic device-code flow.
//
// Mimic shows a 6-character code and opens this page in the user's browser.
// We require a signed-in Discord account (the existing OAuth flow) and ask the
// user to confirm the code. On confirm, we stamp the matching row in
// mimic_link_codes with the user's auth.uid() + discord_id; Mimic polls the
// bot and exchanges that for a long-lived session_token.
//
// Why server actions: keeps the secret (service_role) on the server, no client
// JS needed, and ties the action to the signed-in user via supabaseServer().
//
// On a raidmimic host (the guild lead, 2026-10-31, DECISIONS §499) the same address finishes a link for a guild on Raid
// Mimic instead: the open sign-in, no Wolf Pack role gate, and the code is claimed only by an active member of the guild
// the code was started for (web/lib/mimicLinkHub.ts). The Wolf Pack flow below is untouched.

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase-server';
import { requireMember } from '@/lib/member';
import { supabaseAdmin } from '@/lib/supabase';
import { isRaidmimicHost } from '@/lib/raidmimicHost';
import { profileOf } from '@/lib/hubRegistry';
import { GUILDS_STAY_PATH, builtinGuildSite, sitePage } from '@/lib/guildSites';
import { LINK_CODE_RX, checkHubLink, claimHubCode, cleanLinkCode, hubLinkDb, type LinkRefusal } from '@/lib/mimicLinkHub';

export const metadata = {
  title: 'Link Mimic',
  description: 'Link the Mimic desktop app to your Discord account with the six-character code it shows.',
};

export const dynamic = 'force-dynamic';

// The code in the address is never typed into the form for anyone: the person types what Mimic shows. When the address
// does carry a code, the page shows when that request started and which Mimic made it, and the form carries it as
// `expect_code`; a typed code that differs is refused, so a link built around someone else's code cannot be confirmed
// by a person who is looking at their own Mimic's code.
const CODE_SHAPE = /^[A-Z0-9]{4,12}$/;
function cleanCode(v: unknown): string {
  return String(v || '').trim().toUpperCase().replace(/[\s\-_]/g, '');
}

// Link requests live 10 minutes (the bot sets expires_at = start + 10 min), so the start is derived from expires_at.
const LINK_TTL_MS = 10 * 60 * 1000;
async function requestContext(code: string): Promise<{ started: string; version: string | null } | null> {
  if (!CODE_SHAPE.test(code)) return null;
  const { data } = await supabaseAdmin()
    .from('mimic_link_codes')
    .select('expires_at,agent_version')
    .eq('user_code', code)
    .limit(1);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || !row.expires_at) return null;
  const mins = Math.max(0, Math.round((Date.now() - (new Date(row.expires_at).getTime() - LINK_TTL_MS)) / 60000));
  return {
    started: mins < 1 ? 'less than a minute ago' : `${mins} minute${mins === 1 ? '' : 's'} ago`,
    version: row.agent_version ? String(row.agent_version).slice(0, 32) : null,
  };
}

function RequestContext({ ctx }: { ctx: { started: string; version: string | null } | null }) {
  if (!ctx) return null;
  return (
    <p className="text-xs text-dim text-center">
      This link request started {ctx.started}{ctx.version ? ` from Mimic ${ctx.version}` : ''}. Type the code Mimic is
      showing; if you did not just start this, close the page.
    </p>
  );
}

async function authorizeCode(formData: FormData) {
  'use server';
  // This is Wolf Pack's gated claim. A raidmimic host has its own (authorizeHubCode): a signed-in player there has no
  // wolfpack_members row, and must not be able to post here to stamp a Wolf Pack code with a Discord id of their own.
  if (isRaidmimicHost(headers().get('host'))) redirect('/auth/mimic-link?error=wrong_site');
  // Normalize: strip spaces / dashes the user may have added.
  const userCode = cleanCode(formData.get('user_code'));
  if (!userCode || userCode.length < 4) {
    redirect('/auth/mimic-link?error=invalid_code');
  }
  const expect = cleanCode(formData.get('expect_code'));
  if (expect && expect !== userCode) redirect('/auth/mimic-link?error=code_mismatch');

  // Caller must be signed in via Discord OAuth.
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) {
    redirect(`/auth/signin?next=${encodeURIComponent('/auth/mimic-link?code=' + userCode)}`);
  }
  await requireMember(user!.id);

  const admin = supabaseAdmin();
  // Look up the discord_id from wolfpack_members (cached at sign-in by the
  // auth callback). user.user_metadata.provider_id is the same value but
  // wolfpack_members is the canonical store.
  const { data: member } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user!.id)
    .maybeSingle();
  const discordId = member?.discord_id || (user!.user_metadata as Record<string, string> | null)?.provider_id || null;
  if (!discordId) {
    redirect('/auth/mimic-link?error=no_discord_id');
  }

  // Look up the link code — must exist, not be expired, and not already
  // authorized (idempotent enough; a duplicate Confirm is a no-op).
  const { data: rows } = await admin
    .from('mimic_link_codes')
    .select('user_code,expires_at,authorized_at')
    .eq('user_code', userCode)
    .limit(1);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    redirect('/auth/mimic-link?error=unknown_code');
  }
  if (new Date(row!.expires_at).getTime() < Date.now()) {
    redirect('/auth/mimic-link?error=expired');
  }
  if (row!.authorized_at) {
    // Already linked — friendly success page, idempotent.
    redirect('/auth/mimic-link?ok=already');
  }

  const { error: updErr } = await admin
    .from('mimic_link_codes')
    .update({
      authorized_at:         new Date().toISOString(),
      authorized_user_id:    user!.id,
      authorized_discord_id: discordId,
    })
    .eq('user_code', userCode);
  if (updErr) {
    redirect('/auth/mimic-link?error=update_failed');
  }
  redirect('/auth/mimic-link?ok=1');
}

// Friendly labels for the redirect status codes the server action sets.
const ERROR_LABELS: Record<string, string> = {
  invalid_code:   'That code doesn\'t look right — paste the 6 characters Mimic is showing.',
  unknown_code:   'No matching code. Did it already expire (10 minute window) or get mistyped?',
  expired:        'That code expired. In Mimic, click "Sign in to Wolf Pack" again to get a fresh one.',
  update_failed:  'Couldn\'t save the link (database error). Try again in a moment.',
  no_discord_id:  'Your Wolf Pack member record is missing a Discord ID — sign out and back in, then retry.',
  wrong_site:     'That form belongs to wolfpack.quest. Open the link Mimic gave you instead.',
  code_mismatch:  'That is not the code this page was opened for. Type the code your Mimic is showing, or start again from Mimic.',
};
const OK_LABELS: Record<string, string> = {
  '1':       '✓ Linked. Return to Mimic — it\'ll pick up the link within a couple of seconds.',
  'already': '✓ Already linked. Return to Mimic — it should already be signed in.',
};

export default async function MimicLinkPage({
  searchParams,
}: {
  searchParams: { code?: string; error?: string; ok?: string };
}) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const prefilled = cleanCode(searchParams.code);   // shown as context only, never put into the form
  if (isRaidmimicHost(headers().get('host'))) return <HubLinkPage user={user} searchParams={searchParams} />;
  if (!user) {
    const next = '/auth/mimic-link' + (searchParams.code ? `?code=${encodeURIComponent(searchParams.code)}` : '');
    // A guest raider from another guild must not be sent into Discord sign-in: it walks them into joining the Wolf Pack
    // Discord and a link that needs a role they will never have (the guild lead, 2026-10-30). With a code in hand they
    // get a choice instead; the guest half shows the code to send to the officer, who approves it on /admin/links.
    if (!/^[A-Z0-9]{4,12}$/.test(prefilled)) redirect(`/auth/signin?next=${encodeURIComponent(next)}`);
    return (
      <div className="max-w-lg mx-auto mt-10 space-y-6">
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold mb-2">Wolf Pack member?</h2>
          <p className="text-sm text-dim mb-4">Sign in with Discord to link this Mimic to your account.</p>
          <Link href={`/auth/signin?next=${encodeURIComponent(next)}`}
            className="inline-block bg-blue text-white rounded px-4 py-2 text-sm font-bold hover:bg-blue/90">
            Sign in with Discord
          </Link>
        </section>
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold mb-2">Raiding with Wolf Pack as a guest?</h2>
          <p className="text-sm text-dim mb-4">
            You do not need to sign in or join our Discord. Send this code to the Wolf Pack officer who invited you:
          </p>
          <div className="font-mono text-3xl tracking-[0.3em] text-center text-text bg-bg border border-border rounded px-3 py-3 mb-4 select-all">
            {prefilled}
          </div>
          <p className="text-sm text-dim">
            Keep Mimic open. When they approve it, Mimic links by itself within a few seconds, and your fight parses join the
            raid&apos;s. The code lasts 10 minutes: if it runs out, press Sign in again in Mimic for a new one.
          </p>
        </section>
      </div>
    );
  }

  const errorMsg  = searchParams.error ? (ERROR_LABELS[searchParams.error] || `Error: ${searchParams.error}`) : null;
  const okMsg     = searchParams.ok    ? (OK_LABELS[searchParams.ok]       || OK_LABELS['1'])              : null;
  const ctx       = !okMsg ? await requestContext(prefilled) : null;

  return (
    <div className="max-w-lg mx-auto mt-10 space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-2">Link Mimic to your Discord account</h2>
        <p className="text-sm text-dim mb-5">
          Paste the 6-character code from Mimic (Settings → Sign in to Wolf Pack)
          to link this install to your Discord account. The link persists across
          Mimic upgrades and unlocks cross-machine sync + officer tools.
        </p>

        {okMsg && (
          <div className="bg-[#1a4731] border border-green text-green text-sm rounded p-3 mb-4">
            {okMsg}
          </div>
        )}
        {errorMsg && (
          <div className="bg-[#3a1a1a] border border-red text-red text-sm rounded p-3 mb-4">
            {errorMsg}
          </div>
        )}

        {!okMsg && (
          <form action={authorizeCode} className="space-y-4">
            {ctx && <input type="hidden" name="expect_code" value={prefilled} />}
            <label className="block">
              <span className="block text-xs uppercase tracking-widest text-dim mb-1">Code from Mimic</span>
              <input
                type="text"
                name="user_code"
                placeholder="ABCD23"
                maxLength={12}
                autoComplete="off"
                autoCapitalize="characters"
                autoFocus
                className="w-full bg-bg border border-border rounded px-3 py-2 text-text font-mono text-2xl tracking-[0.3em] text-center uppercase focus:border-blue outline-none"
              />
            </label>
            <RequestContext ctx={ctx} />
            <button
              type="submit"
              className="w-full bg-blue text-white border-0 rounded px-4 py-2 text-sm font-bold cursor-pointer hover:bg-blue/90"
            >
              Confirm — link this Mimic install
            </button>
            <p className="text-xs text-dim text-center">
              Signed in as <span className="text-text">{user!.email || user!.user_metadata?.full_name || 'your Discord account'}</span>.
              <br />
              Wrong account? <Link href="/auth/signout" className="text-blue hover:underline">Sign out</Link> first.
            </p>
          </form>
        )}
      </section>
    </div>
  );
}

// ── raidmimic hosts: finish a link for a guild on Raid Mimic (§499) ──────────────────────────────────────────────
const HUB_ERROR_LABELS: Record<LinkRefusal | 'invalid_code' | 'no_discord_id' | 'update_failed' | 'wrong_site' | 'code_mismatch', string> = {
  invalid_code:   'That code doesn\'t look right — paste the 6 characters Mimic is showing.',
  unknown_code:   'No matching code. Did it already expire (10 minute window) or get mistyped?',
  expired:        'That code expired. In Mimic, press Sign in again to get a fresh one.',
  wolfpack_code:  'That code is for Wolf Pack, which signs in on its own site.',
  unknown_guild:  'That code names a guild that is not on Raid Mimic any more. Pick a guild in Mimic and try again.',
  suspended:      'That guild is not active right now, so Mimic cannot be linked to it.',
  join_first:     'Join the guild first, then come back to this page.',
  no_account:     'Your Raid Mimic account was not found — sign out and back in, then retry.',
  update_failed:  'Couldn\'t save the link (database error). Try again in a moment.',
  no_discord_id:  'Your account is missing a Discord ID — sign out and back in, then retry.',
  error:         'Couldn\'t check that code just now. Try again in a moment.',
  // The Wolf Pack form's error redirect lands here on a raidmimic host. No address in the words: the guild's site is configuration.
  wrong_site:     'That form belongs to your guild’s own site. Open the link Mimic gave you instead.',
  code_mismatch:  'That is not the code this page was opened for. Type the code your Mimic is showing, or start again from Mimic.',
};
const HUB_OK_LABELS: Record<string, string> = {
  '1':       '✓ Linked. Return to Mimic — it\'ll pick up the link within a couple of seconds.',
  'already': '✓ Already linked. Return to Mimic — it should already be signed in.',
};

function discordIdOf(user: User): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return String(meta.provider_id ?? meta.sub ?? '');
}

async function authorizeHubCode(formData: FormData) {
  'use server';
  const userCode = cleanLinkCode(formData.get('user_code'));
  if (!LINK_CODE_RX.test(userCode)) redirect('/auth/mimic-link?error=invalid_code');
  const expect = cleanLinkCode(formData.get('expect_code'));
  if (expect && expect !== userCode) redirect('/auth/mimic-link?error=code_mismatch');

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=${encodeURIComponent('/auth/mimic-link?code=' + userCode)}`);
  const discordId = discordIdOf(user!);
  if (!discordId) redirect(`/auth/mimic-link?code=${userCode}&error=no_discord_id`);

  const res = await claimHubCode(hubLinkDb(supabaseAdmin()), { userCode, userId: user!.id, discordId });
  if (!res.ok) redirect(`/auth/mimic-link?code=${userCode}&error=${res.reason}`);
  redirect(`/auth/mimic-link?ok=${res.already ? 'already' : '1'}`);
}

async function HubLinkPage({
  user,
  searchParams,
}: {
  user: User | null;
  searchParams: { code?: string; error?: string; ok?: string };
}) {
  const prefilled = cleanLinkCode(searchParams.code);
  const codeOk = LINK_CODE_RX.test(prefilled);
  if (!user) redirect(`/auth/signin?next=${encodeURIComponent('/auth/mimic-link' + (codeOk ? `?code=${prefilled}` : ''))}`);

  const okMsg = searchParams.ok ? (HUB_OK_LABELS[searchParams.ok] || HUB_OK_LABELS['1']) : null;
  const discordId = discordIdOf(user!);
  // What claiming this code would do, read before the button so a player not in the guild is told first.
  const check = !okMsg && codeOk && discordId
    ? await checkHubLink(hubLinkDb(supabaseAdmin()), { userCode: prefilled, discordId })
    : null;
  const refusal = check && check.state === 'refused' ? check : null;
  const queryError = searchParams.error ? (HUB_ERROR_LABELS[searchParams.error as keyof typeof HUB_ERROR_LABELS] || `Error: ${searchParams.error}`) : null;
  // A refusal the page read itself wins over the one the action redirected with (they are normally the same one).
  const errorMsg = refusal ? HUB_ERROR_LABELS[refusal.reason] : queryError;
  const guildName = check && check.state !== 'refused' ? check.guildName : refusal?.guildName;
  // Some refusals end the page (nothing to type again); the rest leave the form up so a mistyped code can be retried.
  const ended = !!refusal && (refusal.reason === 'join_first' || refusal.reason === 'wolfpack_code' || refusal.reason === 'suspended' || refusal.reason === 'unknown_guild');
  const successMsg = okMsg || (check?.state === 'already' ? HUB_OK_LABELS['already'] : null);
  const name = profileOf(user).displayName || 'your Discord account';
  const ctx = !successMsg && codeOk ? await requestContext(prefilled) : null;
  // A Wolf Pack code finishes on the built-in guild's own site, which is configuration (web/lib/guildSites.ts).
  const builtinLink = sitePage(builtinGuildSite().url, `/auth/mimic-link?code=${prefilled}`);

  return (
    <div className="max-w-lg mx-auto mt-10 space-y-6">
      {successMsg && (
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold mb-3">{guildName ? `Mimic linked to ${guildName}` : 'Mimic linked'}</h2>
          <div className="bg-[#1a4731] border border-green text-green text-sm rounded p-3">{successMsg}</div>
        </section>
      )}

      {refusal?.reason === 'join_first' && (
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold mb-2">Join {guildName} first</h2>
          <p className="text-sm text-dim mb-4">
            This Mimic is asking to link to {guildName}, and your account is not a member yet. Join with an invite code from
            the guild, then come back: the code from Mimic lasts 10 minutes.
          </p>
          <div className="flex gap-3">
            <Link href={GUILDS_STAY_PATH} className="inline-block bg-blue text-white rounded px-4 py-2 text-sm font-bold hover:bg-blue/90">
              Go to my guilds
            </Link>
            <Link href={`/auth/mimic-link?code=${prefilled}`} className="inline-block border border-border text-text rounded px-4 py-2 text-sm hover:bg-bg">
              I joined — check again
            </Link>
          </div>
        </section>
      )}

      {refusal?.reason === 'wolfpack_code' && (
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold mb-2">That code is for Wolf Pack</h2>
          <p className="text-sm text-dim mb-4">Wolf Pack members link Mimic on their guild’s own site.</p>
          {builtinLink && (
            <a href={builtinLink} className="text-blue hover:underline text-sm">
              Open it on your guild’s site
            </a>
          )}
        </section>
      )}

      {ended && refusal && (refusal.reason === 'suspended' || refusal.reason === 'unknown_guild') && (
        <section className="bg-panel border border-border rounded-lg p-6">
          <div className="bg-[#3a1a1a] border border-red text-red text-sm rounded p-3">{errorMsg}</div>
        </section>
      )}

      {!successMsg && !ended && (
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-xl text-gold mb-2">{guildName ? `Link Mimic to ${guildName}` : 'Link Mimic to your guild'}</h2>
          <p className="text-sm text-dim mb-5">
            Paste the 6-character code Mimic is showing to link this install to your Raid Mimic account.
          </p>

          {errorMsg && (
            <div className="bg-[#3a1a1a] border border-red text-red text-sm rounded p-3 mb-4">{errorMsg}</div>
          )}

          <form action={authorizeHubCode} className="space-y-4">
            {ctx && <input type="hidden" name="expect_code" value={prefilled} />}
            <label className="block">
              <span className="block text-xs uppercase tracking-widest text-dim mb-1">Code from Mimic</span>
              <input
                type="text"
                name="user_code"
                placeholder="ABCD23"
                maxLength={12}
                autoComplete="off"
                autoCapitalize="characters"
                autoFocus
                className="w-full bg-bg border border-border rounded px-3 py-2 text-text font-mono text-2xl tracking-[0.3em] text-center uppercase focus:border-blue outline-none"
              />
            </label>
            <RequestContext ctx={ctx} />
            <button
              type="submit"
              className="w-full bg-blue text-white border-0 rounded px-4 py-2 text-sm font-bold cursor-pointer hover:bg-blue/90"
            >
              {guildName ? `Confirm — link this Mimic to ${guildName}` : 'Confirm — link this Mimic install'}
            </button>
            <p className="text-xs text-dim text-center">
              Signed in as <span className="text-text">{name}</span>.
              <br />
              Wrong account? <Link href="/auth/signout" className="text-blue hover:underline">Sign out</Link> first.
            </p>
          </form>
        </section>
      )}
    </div>
  );
}
