// The /who directory moved to a top-level, member-readable page (/who) with
// officer-only inline editing. Keep this path as a redirect so the old officer
// route + any bookmarks still land in the right place.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminWhoRedirect() {
  redirect('/who');
}
