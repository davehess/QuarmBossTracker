// wolfpack.quest/terms: the same terms as raidmimic.com/terms (the guild lead's pre-launch checklist, 2026-11-01; the address
// used to 404). The page itself lives in web/app/raidmimic/terms/page.tsx; this file only makes it a real route here. It is a
// wrapper function, not a bare re-export, so the page-metadata walk (test/page-metadata.test.js) sees a generateMetadata.
import Page, { generateMetadata as termsMetadata } from '../raidmimic/terms/page';

export function generateMetadata() {
  return termsMetadata();
}

export default Page;
