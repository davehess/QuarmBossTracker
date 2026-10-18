// /robots.txt. Crawlers are asked to stay out of the public share links (a leaked link must not be scraped or
// indexed; the guild lead, 2026-10-17) and out of the API. Everything else stays open, as it was with no file.
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: ['/share/', '/api/'] }] };
}
