// Gate every /admin/* route behind: (a) signed-in session, (b) officer role.
// Non-officer signed-in users get bounced to / with a marker so we can
// optionally surface a "you're not an officer" message later.
//
// Also renders the AdminQueueBanner at the top of every admin page so the
// review queue (chat speakers missing OpenDKP / anon-only names / etc) is
// always one click away.
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import AdminQueueBanner from './AdminQueueBanner';

// Every officer page stays out of search results (the guild lead, 2026-10-10: every page gets its own title and
// summary; the officer pages get theirs and keep this). Set once here so a new admin page cannot forget it.
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/admin');
  const ok = await isOfficer(user.id);
  if (!ok) redirect('/?error=admin_required');
  return (
    <>
      <AdminQueueBanner />
      {children}
    </>
  );
}
