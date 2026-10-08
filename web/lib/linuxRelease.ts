// Finds the newest Linux / Steam Deck build of Mimic (#156) in the release list.
//
// Linux builds are cut rarely while Windows betas are cut many times a day, so
// the newest Linux release can sit far down the list. The route used to read
// only the newest 30 releases; on 2026-09-25 the only Linux build was ~97th, and
// /mimic/linux quietly fell back to the generic releases page. So: walk the
// list a page at a time (100 per page) and stop at the first page that has one.

export type Asset = { name: string; browser_download_url: string };
export type Release = {
  tag_name: string;
  html_url: string;
  draft: boolean;
  published_at: string | null;
  assets: Asset[];
};

export const APPIMAGE_RX = /wolf-pack-mimic-.*\.appimage$/i;
export const PER_PAGE = 100;
export const MAX_PAGES = 5;

// `fetchPage(n)` returns page n (1-based) of the release list, or null on an
// error. Returns the newest non-draft release carrying an AppImage, or null.
export async function findLinuxRelease(
  fetchPage: (page: number) => Promise<Release[] | null>,
  maxPages: number = MAX_PAGES,
): Promise<Release | null> {
  for (let page = 1; page <= maxPages; page++) {
    const releases = await fetchPage(page);
    if (!releases || releases.length === 0) return null;
    const hits = releases.filter(r => !r.draft && r.assets.some(a => APPIMAGE_RX.test(a.name)));
    if (hits.length) {
      return hits.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))[0];
    }
    if (releases.length < PER_PAGE) return null;   // last page
  }
  return null;
}
