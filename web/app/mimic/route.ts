// /mimic — stable redirect to whatever the latest Wolf Pack Mimic beta is.
//
// Queries GitHub's releases API for the most recent tag matching `mimic-v*`
// and 302s to its release page. This means every internal link, banner, and
// "share with a guinea pig" copy can point at wolfpack.quest/mimic forever
// — no hardcoded version that goes stale at the next beta bump.
//
// Query params:
//   ?direct=1 — instead of the release page, redirect straight to the .exe
//               asset. Use this for one-click install buttons.
//
// Caching: revalidate every 5 min. The GitHub releases endpoint is rate-
// limited to 60 req/h unauthenticated, but with revalidate=300 we burn at
// most 12 requests per hour even under load.

import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

const REPO_RELEASES = 'https://api.github.com/repos/davehess/QuarmBossTracker/releases?per_page=20';

type Asset    = { name: string; browser_download_url: string };
type Release  = {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  assets: Asset[];
};

// Fallback URL if the GitHub API call fails — points at the repo's releases
// page filtered to Mimic tags so the user lands somewhere useful regardless.
const FALLBACK = 'https://github.com/davehess/QuarmBossTracker/releases?q=mimic-&expanded=true';

export async function GET(req: NextRequest) {
  const direct = req.nextUrl.searchParams.get('direct') === '1';

  let target = FALLBACK;
  try {
    const res = await fetch(REPO_RELEASES, {
      headers: { 'Accept': 'application/vnd.github+json' },
      next: { revalidate },
    });
    if (res.ok) {
      const releases = (await res.json()) as Release[];
      const mimicReleases = releases
        .filter(r => !r.draft && r.tag_name.startsWith('mimic-v'))
        .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));

      const latest = mimicReleases[0];
      if (latest) {
        if (direct) {
          // Prefer the Windows installer; fall back to release page if not
          // attached yet (build still running).
          const exe = latest.assets.find(a => /\.exe$/i.test(a.name));
          target = exe ? exe.browser_download_url : latest.html_url;
        } else {
          target = latest.html_url;
        }
      }
    }
  } catch {
    // Use FALLBACK
  }

  return NextResponse.redirect(target, { status: 302 });
}
