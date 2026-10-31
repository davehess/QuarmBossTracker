// Whether this admin request is in the sidebar preview: the admin_shell cookie that middleware sets from `?v=b` and
// clears on `?v=a` (lib/adminShell.ts). The layout and the landing both ask, so the answer lives in one place.
import { cookies } from 'next/headers';
import { ADMIN_SHELL_COOKIE } from '@/lib/adminShell';

export function shellOn(): boolean {
  return cookies().get(ADMIN_SHELL_COOKIE)?.value === 'b';
}
