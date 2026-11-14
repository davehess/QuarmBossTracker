import LabFrame from '@/components/lab/LabFrame';
import { labVariant } from '@/lib/lab/registry';
import { draft } from '@/lib/lab/drafts/boards-next-up';
import { LAB_EXPANSIONS, LAB_LABELS, LAB_NOW, LAB_ROWS } from '@/lib/lab/fixtures/boards-next-up';
import { toNextUpBosses } from '@/lib/boardsNextUpView';
import NextUpList from '@/components/lab/boards-next-up/NextUpList';
import WatchList from '@/components/lab/boards-next-up/WatchList';
import BossTable from '@/components/lab/boards-next-up/BossTable';
import FoldedSections from '@/components/lab/boards-next-up/FoldedSections';

export const metadata = { title: '[draft] Spawn boards', description: 'Three designs for the spawn boards page, shown with made-up boss timers.' };

export default function Page({ searchParams }: { searchParams?: { v?: string; bare?: string } }) {
  const current = labVariant(searchParams?.v, draft);
  const bosses = toNextUpBosses(LAB_ROWS);
  return (
    <LabFrame draft={draft} current={current} bare={searchParams?.bare === '1'}>
      {current === 'a' && (
        <NextUpList bosses={bosses} nowMs={LAB_NOW}>
          <FoldedSections bosses={bosses} order={LAB_EXPANSIONS} labels={LAB_LABELS} nowMs={LAB_NOW} />
        </NextUpList>
      )}
      {current === 'b' && <WatchList bosses={bosses} nowMs={LAB_NOW} />}
      {current === 'c' && <BossTable bosses={bosses} nowMs={LAB_NOW} />}
    </LabFrame>
  );
}
