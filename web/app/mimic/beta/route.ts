// /mimic/beta — redirect to the latest BETA-channel Wolf Pack Mimic release.
//
// Counterpart to /mimic (which serves stable). Filters to releases marked
// `prerelease: true` on GitHub — that flag is set by the release-mimic.yml
// workflow when the tag carries a `-beta.N` suffix. If no beta has been cut
// yet (cold start, or all betas have graduated to stable and gotten
// retroactively un-flagged), falls through to the stable build so users get
// SOMETHING instead of a dead end.
//
// Pair this URL with the stable /mimic link in the website's download
// section so testers can grab the beta deliberately without seeing it
// dropped on every public link.
//
// Query params + caching: same as /mimic.

import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

const REPO_RELEASES = 'https://api.github.com/repos/davehess/QuarmBossTracker/releases?per_page=30';

type Asset    = { name: string; browser_download_url: string };
type Release  = {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  assets: Asset[];
};

const FALLBACK = 'https://github.com/davehess/QuarmBossTracker/releases';

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
      const allMimicReleases = releases
        .filter(r => !r.draft && r.assets.some(a => /^wolf-pack-mimic-setup-.*\.exe$/i.test(a.name)))
        .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));

      // Prefer the latest prerelease; if none, fall through to the latest
      // stable so this link is never broken.
      const betaRelease   = allMimicReleases.find(r => r.prerelease) || null;
      const stableRelease = allMimicReleases.find(r => !r.prerelease) || null;
      const latest = betaRelease || stableRelease;
      if (latest) {
        if (direct) {
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
