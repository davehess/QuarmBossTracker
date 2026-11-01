// sitemap.xml for the raidmimic hosts: the landing page, the set-up guide, the interest form and the three legal pages, at
// their canonical addresses on raidmimic.com. The middleware rewrites raidmimic.com/sitemap.xml here. Nothing else on these
// hosts is a page.
import { RAIDMIMIC_ORIGIN } from '../../../lib/raidmimicHost';

const PAGES = ['/', '/setup', '/register', '/privacy', '/terms', '/refunds'];

export function GET() {
  const urls = PAGES.map(p => `  <url><loc>${RAIDMIMIC_ORIGIN}${p}</loc></url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
