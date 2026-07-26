// /mimic/linux — redirect to the latest Linux / SteamOS (Steam Deck) build of
// Wolf Pack Mimic (#156).
//
// Counterpart to /mimic (Windows stable) and /mimic/beta (Windows beta). The
// Linux AppImage is published by build-mimic-linux.yml to its own `linux`
// update channel as prereleases tagged v2.1.1-linux.<N>. We find the newest
// release carrying a `*linux*.AppImage` asset and redirect to it. If none has
// been cut yet, falls through to the releases page so the link is never dead.
//
// Query params + caching: same as /mimic — ?direct=1 jumps straight to the
// .AppImage instead of the release page.

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

const APPIMAGE_RX = /wolf-pack-mimic-.*\.appimage$/i;
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
      const latest = releases
        .filter(r => !r.draft && r.assets.some(a => APPIMAGE_RX.test(a.name)))
        .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))[0];
      if (latest) {
        if (direct) {
          const app = latest.assets.find(a => APPIMAGE_RX.test(a.name));
          target = app ? app.browser_download_url : latest.html_url;
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
