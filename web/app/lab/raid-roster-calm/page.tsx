import LabFrame from '@/components/lab/LabFrame';
import AlertFirst from '@/components/lab/raid-roster-calm/AlertFirst';
import GroupTiles from '@/components/lab/raid-roster-calm/GroupTiles';
import JobTabs from '@/components/lab/raid-roster-calm/JobTabs';
import { labVariant } from '@/lib/lab/registry';
import { draft } from '@/lib/lab/drafts/raid-roster-calm';
import { calmRaid, troubledRaid } from '@/lib/lab/fixtures/raid-roster-calm';

export const metadata = {
  title: '[draft] Raid HQ, calm roster',
  description: 'Three ways to calm the raid roster so a curse or a dry healer is the loudest thing on screen, shown with made-up data.',
};

export default function Page({ searchParams }: { searchParams?: { v?: string; bare?: string; state?: string } }) {
  const current = labVariant(searchParams?.v, draft);
  const view = searchParams?.state === 'calm' ? calmRaid : troubledRaid;
  return (
    <LabFrame draft={draft} current={current} bare={searchParams?.bare === '1'}>
      {searchParams?.bare === '1' ? null : <p className="mb-3 text-sm text-text">
        Raid state:{' '}
        <a href={`/lab/raid-roster-calm?v=${current}`} className="text-blue hover:underline">problems</a>{' · '}
        <a href={`/lab/raid-roster-calm?v=${current}&state=calm`} className="text-blue hover:underline">all healthy</a>
      </p>}
      {current === 'a' ? <AlertFirst view={view} /> : current === 'b' ? <GroupTiles view={view} /> : <JobTabs view={view} />}
    </LabFrame>
  );
}
