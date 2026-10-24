// robots.txt for the raidmimic hosts (the guild lead, 2026-10-23: search engines on). The middleware rewrites
// raidmimic.com/robots.txt here; wolfpack.quest keeps its own app/robots.ts. Crawlers may read the two pages and the
// files they load; the sitemap names the two pages on the one canonical host.
import { RAIDMIMIC_ORIGIN } from '../../../lib/raidmimicHost';

export function GET() {
  const body = ['User-agent: *', 'Allow: /', '', `Sitemap: ${RAIDMIMIC_ORIGIN}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
