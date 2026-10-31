// The admin sidebar preview (the guild lead, 2026-10-31, DECISIONS §493). `/admin?v=b` turns it on and it STAYS on for
// every admin page after that, because a layout cannot read a query string: middleware sees `?v=` on the way in, sets a
// cookie, and the admin layout reads the cookie. `?v=a` clears it. With neither, the cookie is the whole answer and a
// browser that never saw `?v=` gets exactly the admin pages production has.
//
// Pure (no server imports) so the Edge middleware and test/admin-shell.test.js share one decision.

export const ADMIN_SHELL_COOKIE = 'admin_shell';

/** A month: long enough to survive a week of not opening /admin, short enough that the preview does not outlive the pick. */
export const ADMIN_SHELL_MAX_AGE = 60 * 60 * 24 * 30;

export type ShellCookieAction = 'set' | 'clear' | 'keep';

/** What a request to an admin page means: is the sidebar on for THIS request, and what the response does to the cookie.
 *  `v` is the raw `?v=` value; `cookie` is the `admin_shell` cookie as sent. */
export function adminShellChoice(v: string | null | undefined, cookie: string | undefined): { on: boolean; action: ShellCookieAction } {
  if (v === 'b') return { on: true, action: 'set' };
  if (v === 'a') return { on: false, action: 'clear' };
  return { on: cookie === 'b', action: 'keep' };
}

export const isAdminPath = (pathname: string): boolean => pathname === '/admin' || pathname.startsWith('/admin/');

/** The path of an href, without its `#anchor` or `?query`. */
export const hrefPath = (href: string): string => href.split('#')[0].split('?')[0];

/** Whether `pathname` is on this link's page (the sidebar's highlight; a client component runs it on every navigation
 *  because an App Router layout is NOT re-rendered between sibling pages). Anchored links (the danger zone) are
 *  shortcuts INTO a page, never "the current page"; a `soon` link goes nowhere; `exact` is for a page whose own
 *  sub-page sits beside it in the list; the admin root is current only at the root. */
export function isCurrent(pathname: string, l: { href: string; exact?: boolean; soon?: boolean }): boolean {
  if (l.href.includes('#') || l.soon) return false;
  const p = hrefPath(l.href);
  if (pathname === p) return true;
  if (l.exact || p === '/admin') return false;
  return pathname.startsWith(p + '/');
}
