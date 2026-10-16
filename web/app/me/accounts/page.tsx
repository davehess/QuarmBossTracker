// /me/accounts: which of your characters sit on which EverQuest game account (the guild lead, 2026-10-13).
//
// Why: the shared bank belongs to the game account, so /me/inventory has to know who shares one before it can
// count a shared stack once. For now you tell us by dragging characters between account cards; reading it
// from the login name and guessing from shared-bank contents come later. New page, so it ships live with the
// [beta] tag (DECISIONS §135).
//
// PRIVATE: the signed-in person's own household only. The owner id comes from the session (auth user ->
// wolfpack_members), never from the URL, and the characters are exactly what ownedCharacters returns.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { loadGameAccounts, ownerDiscordId, MAX_ACCOUNTS, MAX_PER_ACCOUNT } from '@/lib/gameAccounts';
import NewPageTag from '@/components/NewPageTag';
import AccountBoard from './AccountBoard';

export const metadata: Metadata = {
  title: '[beta] Game accounts',
  description: 'Which of your characters are on which EverQuest game account. Private to you.',
};

export const dynamic = 'force-dynamic';

export default async function GameAccountsPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/me/accounts');

  const admin = supabaseAdmin();
  const owner = await ownerDiscordId(admin, user.id);
  const owned = owner ? (await ownedCharacters(user.id)).map(c => ({ name: c.name, class: c.class })) : [];
  const state = owner ? await loadGameAccounts(admin, owner, owned) : null;

  return (
    <div className="space-y-4">
      <NewPageTag note="Drag characters onto the account they log in under." />
      <section className="rounded-lg border border-border bg-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-3 text-2xl text-gold">
              <span aria-hidden>🗂</span>
              <span>Game accounts</span>
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-dim">
              One forum account holds up to {MAX_ACCOUNTS} game accounts, and a game account holds up to {MAX_PER_ACCOUNT} characters.
              The shared bank belongs to the game account, so knowing who shares one lets us count its items once.
              Drag a character onto its account, or use <span className="text-text">Move</span> on a phone.
              Click an account&apos;s name to give it your own. Private to you.
            </p>
          </div>
          <Link href="/me" className="whitespace-nowrap text-sm text-blue hover:underline">← My stats</Link>
        </div>
      </section>

      {!state ? (
        <div className="rounded border border-orange/40 bg-panel p-4 text-sm text-orange">
          Your Discord account is not linked to a guild member yet, so there are no characters to place.
        </div>
      ) : owned.length === 0 ? (
        <div className="rounded border border-orange/40 bg-panel p-4 text-sm text-orange">
          No characters are linked to your Discord account yet.
        </div>
      ) : (
        <AccountBoard initial={state} />
      )}
    </div>
  );
}
