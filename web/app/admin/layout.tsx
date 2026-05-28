// Gate every /admin/* route behind: (a) signed-in session, (b) officer role.
// Non-officer signed-in users get bounced to / with a marker so we can
// optionally surface a "you're not an officer" message later.
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/admin');
  const ok = await isOfficer(user.id);
  if (!ok) redirect('/?error=admin_required');
  return <>{children}</>;
}
