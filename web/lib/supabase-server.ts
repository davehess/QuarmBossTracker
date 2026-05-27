// Server-side Supabase client with cookie-based session handling, for use
// inside Server Components, Route Handlers, and Server Actions. Pairs with
// the browser client in lib/supabase-browser.ts and the session-refresh
// middleware at web/middleware.ts.
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function supabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
