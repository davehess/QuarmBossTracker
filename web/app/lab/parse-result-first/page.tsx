import LabFrame from '@/components/lab/LabFrame';
import VersionA from '@/components/lab/parse-result-first/VersionA';
import VersionB from '@/components/lab/parse-result-first/VersionB';
import VersionC from '@/components/lab/parse-result-first/VersionC';
import { labVariant } from '@/lib/lab/registry';
import { draft } from '@/lib/lab/drafts/parse-result-first';
import { fixtureKill, fixtureWipe } from '@/lib/lab/fixtures/parse-result-first';
import type { ViewRole } from '@/lib/parseResultFirstView';

export const metadata = { title: '[draft] Parse breakdown', description: 'Three versions of the fight breakdown page, shown with made-up data.' };

export default function Page({ searchParams }: { searchParams?: { v?: string; bare?: string; state?: string; role?: string } }) {
  const current = labVariant(searchParams?.v, draft);
  const role: ViewRole = searchParams?.role === 'tank' || searchParams?.role === 'heal' ? searchParams.role : 'damage';
  const view = searchParams?.state === 'wipe' ? fixtureWipe(role) : fixtureKill(role);
  return (
    <LabFrame draft={draft} current={current} bare={searchParams?.bare === '1'}>
      {current === 'a' ? <VersionA v={view} /> : current === 'b' ? <VersionB v={view} /> : <VersionC v={view} />}
    </LabFrame>
  );
}
