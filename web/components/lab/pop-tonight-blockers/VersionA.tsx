import BlockersStrip, { FlagFold } from './BlockersStrip';
import FlagTable, { type FlagTableData } from './FlagTable';
import type { BlockersView } from '@/lib/popTonightBlockersView';

// A: the answer first. One row per target zone, names missing a preflag in red, the full table folded below.
export default function VersionA({ view, table }: { view: BlockersView; table: FlagTableData }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BlockersStrip view={view} />
      <FlagFold count={table.rows.length}><FlagTable data={table} /></FlagFold>
    </div>
  );
}
