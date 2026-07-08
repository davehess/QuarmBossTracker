// Public link-preview document — what Discord/Slack/Twitter crawlers see.
//
// Every member page redirects unauthenticated requests to sign-in, so
// crawlers could never read a page's real <meta> tags: every shared link
// unfurled with the site-wide description. The middleware rewrites known
// preview-bot user-agents here with ?path=<original>, and we emit ONLY the
// OG/twitter tags for that path (web/lib/pageMeta.ts) — no data, no auth.
//
// NOTE: Discord caches unfurls per-URL for a while — re-shares of an
// already-posted link may show the old card until their cache expires.

import { NextRequest } from 'next/server';
import { metaForPath, SITE_NAME } from '@/lib/pageMeta';

export const dynamic = 'force-dynamic';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path') || '/';
  const { title, description } = metaForPath(path);
  const fullTitle = title === SITE_NAME ? title : `${title} — ${SITE_NAME}`;
  const url = `https://wolfpack.quest${path}`;
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${escHtml(fullTitle)}</title>
<meta name="description" content="${escHtml(description)}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escHtml(fullTitle)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:url" content="${escHtml(url)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escHtml(fullTitle)}">
<meta name="twitter:description" content="${escHtml(description)}">
</head><body>${escHtml(fullTitle)} — ${escHtml(description)}</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
