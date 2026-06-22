'use client';

// Class + guild breakdown summary on /who. Counts are computed server-side
// against the FULL loaded catalog (post-pagination), so the numbers are
// honest even if the table's client-side filters are narrowing the view.
// Collapsible — defaults open since this is the question the user came to
// the page to answer; closing it just hides the cards to reclaim space.
//
// Layout: two columns side-by-side on desktop, stacked on mobile. Each
// bucket is a clickable row that nudges the WhoTable's filter via a
// hash-anchored search — clicking "Druid · 76" updates the URL to
// /who#class=Druid which the table reads on mount (future work; today
// the row just labels for officer eyeballing).

import { useState } from 'react';

type Bucket = { label: string; count: number };

function Section({
  title, total, items, colorAccent, maxItems,
}: {
  title:        string;
  total:        number;
  items:        Bucket[];
  colorAccent:  string;
  maxItems:     number;
}) {
  const [showAll, setShowAll] = useState(false);
  const view = showAll ? items : items.slice(0, maxItems);
  const hidden = items.length - view.length;
  const maxCount = items[0]?.count || 1;
  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-sm text-gold font-semibold">{title}</h3>
        <span className="text-dim text-xs">
          {items.length} distinct · {total.toLocaleString()} characters
        </span>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-dim italic">Nothing observed yet.</div>
      ) : (
        <ul className="text-xs space-y-0.5">
          {view.map(b => {
            const pct = Math.max(2, Math.round((b.count / maxCount) * 100));
            return (
              <li key={b.label} className="grid grid-cols-[1fr_auto] items-center gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-text truncate" title={b.label}>{b.label}</span>
                  <span className="flex-1 h-1.5 bg-bg/60 rounded overflow-hidden border border-border/40">
                    <span
                      className={`block h-full ${colorAccent}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </span>
                <span className="text-dim tabular-nums whitespace-nowrap">{b.count.toLocaleString()}</span>
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs text-blue hover:underline"
        >
          show all {items.length}
        </button>
      )}
      {showAll && items.length > maxItems && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-2 ml-3 text-xs text-dim hover:text-blue hover:underline"
        >
          collapse
        </button>
      )}
    </section>
  );
}

export default function WhoBreakdown({
  classBreakdown,
  guildBreakdown,
  filtered = false,
}: {
  classBreakdown: Bucket[];
  guildBreakdown: Bucket[];
  // When true the counts reflect the table's active filters (not the whole
  // catalog) — label it so the numbers aren't misread as catalog totals.
  filtered?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const classTotal = classBreakdown.reduce((acc, b) => acc + b.count, 0);
  const guildTotal = guildBreakdown.reduce((acc, b) => acc + b.count, 0);

  return (
    <section className="bg-panel border border-border rounded-lg p-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold text-gold">📊 {filtered ? 'Breakdown of current filter' : 'Catalog breakdown'}</h2>
        <span className="text-dim text-xs">
          {classBreakdown.length} classes · {guildBreakdown.length} guilds (excl. Wolf Pack)
        </span>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="ml-auto text-xs text-blue hover:underline"
        >
          {open ? 'hide' : 'show'}
        </button>
      </div>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Section
            title="By class (observed or overridden)"
            total={classTotal}
            items={classBreakdown}
            colorAccent="bg-green/60"
            maxItems={16}     // 16 base classes — show all by default
          />
          <Section
            title="By guild (non–Wolf Pack)"
            total={guildTotal}
            items={guildBreakdown}
            colorAccent="bg-blue/60"
            maxItems={15}     // top-15; user can expand for the long tail
          />
        </div>
      )}
    </section>
  );
}
