// robots.txt for the raidmimic hosts (the guild lead, 2026-10-23: search engines on). The middleware rewrites
// raidmimic.com/robots.txt here; wolfpack.quest keeps its own app/robots.ts. Crawlers may read the pages and the
// files they load; the sitemap names the pages on the one canonical host.
// b.raidmimic.com (2026-11-01) is the beta mirror and is never indexed: it disallows everything and names no sitemap.
import { RAIDMIMIC_ORIGIN, isRaidmimicBetaHost } from '../../../lib/raidmimicHost';

// `request` is optional so a bare GET() (the unit test) still means the canonical hosts.
// The request is required: `next build` rejects an optional first argument on a route handler (beta build, 2026-11-01).
export function GET(request: Request) {
  const beta = isRaidmimicBetaHost(request.headers.get('host'));
  const body = beta
    ? ['User-agent: *', 'Disallow: /', ''].join('\n')
    : ['User-agent: *', 'Allow: /', '', `Sitemap: ${RAIDMIMIC_ORIGIN}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
