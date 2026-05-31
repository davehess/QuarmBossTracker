// Server-only TZ entrypoint. Re-exports the client-safe constants + formatters
// from ./timezone-shared so existing server pages keep their single import
// path, and adds userTz() which reads the wp_tz cookie via next/headers.
//
// Importing this file from a client component will fail the build (next/headers
// is server-only) — that's intentional. Client components should import from
// ./timezone-shared instead.

import { cookies } from 'next/headers';
import { DEFAULT_TZ, TZ_COOKIE } from './timezone-shared';

export * from './timezone-shared';

// Server-side read of the user's chosen zone. `auto` resolves to default on
// the server (the client picker re-renders with the real browser zone via
// LocalTs) — server stays EST until the picker writes a concrete IANA zone.
export async function userTz(): Promise<string> {
  try {
    const c = await cookies();
    const v = c.get(TZ_COOKIE)?.value;
    if (!v || v === 'auto') return DEFAULT_TZ;
    // Cheap validity check — IANA zones are passed verbatim to Intl.
    if (!/^[A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+)+$|^UTC$/.test(v)) return DEFAULT_TZ;
    return v;
  } catch { return DEFAULT_TZ; }
}
