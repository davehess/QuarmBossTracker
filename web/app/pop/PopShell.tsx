// The frame for the /pop sidebar previews (?v=b left, ?v=c right; the guild lead, 2026-10-21). With no variant it
// is a fragment and the page is exactly what production has. With one it is a two-column grid from the lg
// breakpoint up: a sticky panel beside the page body. Below lg the same panel is a collapsible bar stuck to the
// top of the screen (below the site header, which is itself sticky: top-20 clears it and the beta banner), so a phone gets no sideways scroll and no lost width.
//
// The panel is rendered twice (the bar and the column) and CSS shows one: it holds only links and text, so
// there is nothing to keep in step, and no script decides which one a visitor gets.

import type { ReactNode } from 'react';
import type { SideVariant } from '@/lib/popSidebar';

export default function PopShell({ side, summary, panel, label, children }: {
  side: SideVariant | null; summary: ReactNode; panel: ReactNode; label: string; children: ReactNode;
}) {
  if (!side) return <>{children}</>;
  const right = side === 'c';
  return (
    <div data-pop-side={side}
         className={`flex flex-col gap-4 lg:grid lg:gap-6 lg:items-start ${right ? 'lg:grid-cols-[minmax(0,1fr)_17rem]' : 'lg:grid-cols-[13.5rem_minmax(0,1fr)]'}`}>
      <details className="lg:hidden sticky top-20 z-20 bg-panel border border-border rounded-lg shadow-lg shadow-black/40">
        <summary className="cursor-pointer select-none px-3 py-2.5 text-xs text-text">{summary}</summary>
        <div className="px-3 pb-3 pt-3 max-h-[70vh] overflow-y-auto border-t border-border/60">{panel}</div>
      </details>
      <aside aria-label={label}
             className={`hidden lg:block lg:sticky lg:top-20 bg-panel border border-border rounded-lg p-3 max-h-[calc(100vh-6rem)] overflow-y-auto ${right ? 'lg:col-start-2 lg:row-start-1' : ''}`}>
        {panel}
      </aside>
      <div className={`space-y-6 min-w-0 ${right ? 'lg:col-start-1 lg:row-start-1' : ''}`}>{children}</div>
    </div>
  );
}
