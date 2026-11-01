// Server gate for the departed-member pop-up: renders nothing unless the viewer is an officer AND someone who left
// the Discord still has access. Used on the homepage and /admin. Officer check is the same helper the admin layout uses.
// With no userId it looks the viewer up itself, so the /admin landing page (which by rule reads no data:
// test/admin-pages-officer-gate.test.js) can drop it in without a session read of its own.
import { isOfficer } from '@/lib/officer';
import { loadDeparted } from '@/lib/departedMembersLoad';
import { supabaseServer } from '@/lib/supabase-server';
import DepartedMemberPopup from './DepartedMemberPopup';

export default async function DepartedMemberNotice({ userId }: { userId?: string | null }) {
  const uid = userId !== undefined ? userId : (await supabaseServer().auth.getUser()).data.user?.id;
  if (!(await isOfficer(uid))) return null;
  const items = await loadDeparted();
  return items.length ? <DepartedMemberPopup items={items} /> : null;
}
