// /mimic/linux — redirect to the latest Linux / SteamOS (Steam Deck) build of
// Wolf Pack Mimic (#156).
//
// Counterpart to /mimic (Windows stable) and /mimic/beta (Windows beta). The
// Linux AppImage is published by build-mimic-linux.yml to its own `linux`
// update channel as prereleases tagged v2.1.1-linux.<N>. We find the newest
// release carrying a `*linux*.AppImage` asset and redirect to it. If none has
// been cut yet, falls through to the releases page so the link is never dead.
// The search walks back through the list page by page (lib/linuxRelease.ts),
// because Windows betas bury a Linux build fast.
//
// Query params + caching: same as /mimic — ?direct=1 jumps straight to the
// .AppImage instead of the release page.

import { NextResponse, type NextRequest } from 'next/server';
import { APPIMAGE_RX, PER_PAGE, findLinuxRelease, type Release } from '@/lib/linuxRelease';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

const REPO_RELEASES = 'https://api.github.com/repos/davehess/QuarmBossTracker/releases';
const FALLBACK = 'https://github.com/davehess/QuarmBossTracker/releases';

async function fetchPage(page: number): Promise<Release[] | null> {
  try {
    const res = await fetch(`${REPO_RELEASES}?per_page=${PER_PAGE}&page=${page}`, {
      headers: { 'Accept': 'application/vnd.github+json' },
      next: { revalidate },
    });
    return res.ok ? ((await res.json()) as Release[]) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const direct = req.nextUrl.searchParams.get('direct') === '1';

  let target = FALLBACK;
  const latest = await findLinuxRelease(fetchPage);
  if (latest) {
    if (direct) {
      const app = latest.assets.find(a => APPIMAGE_RX.test(a.name));
      target = app ? app.browser_download_url : latest.html_url;
    } else {
      target = latest.html_url;
    }
  }

  return NextResponse.redirect(target, { status: 302 });
}
