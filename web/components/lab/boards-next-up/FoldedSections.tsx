// Lab stand-in for the real per-expansion sections (they tick on the real clock, which would disagree with the
// draft's fixed "now"). On the real page, version A keeps the real ExpansionSection components here instead.
import type { NextUpBoss } from '@/lib/boardsNextUpView';
import { isUp } from '@/lib/boardsNextUpView';

export default function FoldedSections({ bosses, order, labels, nowMs }: { bosses: NextUpBoss[]; order: readonly string[]; labels: Record<string, string>; nowMs: number }) {
  return (
    <>
      {order.map((e) => {
        const list = bosses.filter((b) => b.expansion === e);
        if (!list.length) return null;
        const up = list.filter((b) => isUp(b, nowMs)).length;
        return (
          <section key={e} className="bg-panel border border-border rounded-lg p-4">
            <div className="flex items-center justify-between gap-3 text-base font-semibold text-text">
              <span><span aria-hidden className="mr-2 text-xs text-dim">▶</span>{labels[e] ?? e}</span>
              <span className="text-xs font-normal text-text"><span className={up > 0 ? 'text-green' : 'text-text'}>{up}</span> of {list.length} available</span>
            </div>
          </section>
        );
      })}
    </>
  );
}
