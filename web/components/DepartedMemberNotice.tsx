// Server gate for the departed-member pop-up: renders nothing unless the viewer is an officer AND someone who left
// the Discord still has access. Used on the homepage and /admin. Officer check is the same helper the admin layout uses.
import { isOfficer } from '@/lib/officer';
import { loadDeparted } from '@/lib/departedMembersLoad';
import DepartedMemberPopup from './DepartedMemberPopup';

export default async function DepartedMemberNotice({ userId }: { userId: string | null | undefined }) {
  if (!(await isOfficer(userId))) return null;
  const items = await loadDeparted();
  return items.length ? <DepartedMemberPopup items={items} /> : null;
}
