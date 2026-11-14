import LabFrame from '@/components/lab/LabFrame';
import { labVariant } from '@/lib/lab/registry';
import { draft } from '@/lib/lab/drafts/pop-tonight-blockers';
import { popBlockersFixture } from '@/lib/lab/fixtures/pop-tonight-blockers';
import VersionA from '@/components/lab/pop-tonight-blockers/VersionA';
import VersionB from '@/components/lab/pop-tonight-blockers/VersionB';
import VersionC from '@/components/lab/pop-tonight-blockers/VersionC';

export const metadata = {
  title: '[draft] Raid night blockers',
  description: 'Three designs for showing who cannot enter tonight\'s Planes of Power targets, with made-up data.',
};

export default function Page({ searchParams }: { searchParams?: { v?: string; bare?: string; state?: string } }) {
  const current = labVariant(searchParams?.v, draft);
  const { view, table, mine } = popBlockersFixture(searchParams?.state === 'clear' ? 'clear' : 'full');
  return (
    <LabFrame draft={draft} current={current} bare={searchParams?.bare === '1'}>
      {current === 'a' && <VersionA view={view} table={table} />}
      {current === 'b' && <VersionB view={view} mine={mine} />}
      {current === 'c' && <VersionC view={view} />}
    </LabFrame>
  );
}
