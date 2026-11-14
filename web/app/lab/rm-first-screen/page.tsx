import LabFrame from '@/components/lab/LabFrame';
import RmFirstScreen from '@/components/lab/rm-first-screen';
import { labVariant } from '@/lib/lab/registry';
import { draft } from '@/lib/lab/drafts/rm-first-screen';
import { COPY, MEDIA, type HeroLinks } from '@/lib/lab/fixtures/rm-first-screen';
import { DOWNLOAD_URL } from '@/lib/raidmimicPlayer';

export const metadata = { title: '[draft] Raid Mimic first screen', description: 'Three versions of the first screen of the Raid Mimic product page, shown with its real captures. Nothing here is live.' };

const LINKS: HeroLinks = { download: DOWNLOAD_URL, demo: '/raidmimic/demo', setup: '/raidmimic/setup', register: '/raidmimic/register' };

export default function Page({ searchParams }: { searchParams?: { v?: string; bare?: string } }) {
  const current = labVariant(searchParams?.v, draft);
  return (
    <LabFrame draft={draft} current={current} bare={searchParams?.bare === '1'}>
      <RmFirstScreen which={current} copy={COPY} links={LINKS} media={MEDIA} />
    </LabFrame>
  );
}
