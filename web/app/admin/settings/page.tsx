// /admin/settings: the officers' way to the guild's own settings (raid schedule, roles, jobs, DKP, guests, links).
// The page itself is /guilds/<this guild>/settings, the same one every hosted guild's officers get (the guild lead,
// 2026-11-12, DECISIONS §569); this route exists so the admin sidebar has a real address for it. Officer-gated like
// every /admin page, then a redirect.
import { redirect } from 'next/navigation';
import { requireOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';

export const metadata = {
  title: '[beta] Guild settings · Admin',
  description: 'The guild’s raid schedule, roles, jobs, DKP, guest rule and links.',
};

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  await requireOfficer();
  redirect(`/guilds/${GUILD_TAG}/settings`);
}
