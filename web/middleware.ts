// Refreshes the Supabase session cookie on every request so Server
// Components and Route Handlers see a fresh user. Without this, OAuth
// callbacks land but the session never propagates to RSC reads.
//
// Also logs page views to page_views (Uilnayar 2026-06-24 — /admin/analytics).
// Fire-and-forget; never awaited, so a slow Supabase write never delays the
// page render. Only logs when there's an authenticated user (anonymous traffic
// + bots are silently dropped).
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

// Routes we never log: API/RSC payloads, auth callbacks, admin pages
// (officers checking dashboards would dominate the data), the analytics page
// itself, and anything that looks like an asset request that slipped past the
// matcher (e.g. .json fetches from client components).
const SKIP_PREFIXES = ['/api/', '/auth/', '/admin/'];
const SKIP_SUFFIXES = ['.json', '.txt', '.xml', '.ico', '.map'];

// Path → route template. Routes with dynamic segments collapse so every
// /character/<name> page aggregates under /character/[name]. We keep the raw
// path on the row too, so the admin page can drill in.
function normalizeRoute(pathname: string): string {
  // /character/<name>/...
  let m = pathname.match(/^\/character\/[^/]+(\/.*)?$/);
  if (m) return '/character/[name]' + (m[1] || '');
  // /parses/<id>
  m = pathname.match(/^\/parses\/[^/]+$/);
  if (m) return '/parses/[id]';
  // /boss/<name>
  m = pathname.match(/^\/boss\/[^/]+$/);
  if (m) return '/boss/[name]';
  return pathname;
}

// Link-preview crawlers (they can't sign in, so they'd only ever see the
// sign-in redirect + the site-wide description). Rewritten to /api/embed-meta
// which serves per-path OG tags (web/lib/pageMeta.ts). Case-insensitive.
const PREVIEW_BOT_RX = /discordbot|slackbot|twitterbot|facebookexternalhit|whatsapp|telegrambot|linkedinbot|skypeuripreview|redditbot|mastodon|pinterestbot/i;

export async function middleware(request: NextRequest) {
  // Per-page link unfurls (Uilnayar 2026-07-08) — serve crawlers the meta
  // document BEFORE any session work; bots carry no cookies anyway.
  if (request.method === 'GET'
      && !request.nextUrl.pathname.startsWith('/api/')
      && PREVIEW_BOT_RX.test(request.headers.get('user-agent') || '')) {
    const url = request.nextUrl.clone();
    url.pathname = '/api/embed-meta';
    url.search = `path=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.rewrite(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Page-view logging — only on real, authenticated GETs to non-skipped paths.
  // Fire-and-forget: never await, so a slow insert can't delay the response.
  // Errors are swallowed so a write failure (e.g. RLS misconfig) can't break
  // navigation.
  if (user && request.method === 'GET') {
    const pathname = request.nextUrl.pathname;
    const skip = SKIP_PREFIXES.some(p => pathname.startsWith(p))
              || SKIP_SUFFIXES.some(s => pathname.endsWith(s))
              || pathname === '/favicon.ico';
    if (!skip) {
      const ua = request.headers.get('user-agent') || null;
      void supabase.from('page_views').insert({
        user_id:    user.id,
        path:       pathname,
        route:      normalizeRoute(pathname),
        referrer:   request.headers.get('referer') || null,
        user_agent: ua ? ua.slice(0, 200) : null,
      }).then(() => undefined, () => undefined);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except Next.js static assets, favicon, and image files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
