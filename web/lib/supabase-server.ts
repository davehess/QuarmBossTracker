// Server-side Supabase client with cookie-based session handling, for use
// inside Server Components, Route Handlers, and Server Actions. Pairs with
// the browser client in lib/supabase-browser.ts and the session-refresh
// middleware at web/middleware.ts.
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function supabaseServer() {
  const cookieStore = cookies();
  // The server key, never the browser's public key (2026-10-29 security finding): until then
  // NEXT_PUBLIC_SUPABASE_ANON_KEY held the service key on Vercel, so every signed-out server read ran
  // as service_role and the browser bundle shipped it. Keeping the server on the service key keeps
  // those reads exactly as they were; a signed-in request still runs as the member (their JWT).
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // Server Components cannot set cookies; the middleware handles
          // session refresh. We swallow the throw so RSC reads still work.
          try { cookieStore.set({ name, value, ...options }); } catch {}
        },
        remove(name: string, options: CookieOptions) {
          try { cookieStore.set({ name, value: '', ...options }); } catch {}
        },
      },
    },
  );
}
