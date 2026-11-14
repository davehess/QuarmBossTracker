import Link from 'next/link';
import type { LabDraft, LabVariant } from '@/lib/lab/registry';

// The strip above every design-lab draft: which draft this is, the versions to switch between, which one is
// recommended, and where the real page is. Server component, no JS: the versions are plain links (?v=a|b|c).
// ?bare=1 hides the strip so a screenshot shows only the design.
export default function LabFrame({
  draft, current, bare, children,
}: { draft: LabDraft; current: LabVariant['key']; bare?: boolean; children: React.ReactNode }) {
  if (bare) return <>{children}</>;
  const cur = draft.variants.find((v) => v.key === current);
  return (
    <>
      <div role="note" className="mb-4 rounded-md border border-orange/50 bg-orange/10 px-3 py-2 font-mono text-xs">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <b className="tracking-wider text-orange">[draft]</b>
          <span className="text-text">{draft.title}</span>
          <span className="text-dim">made-up data · nothing here is live</span>
          <Link href="/lab" className="ml-auto text-blue hover:underline">all drafts</Link>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {draft.variants.map((v) => (
            <Link
              key={v.key}
              href={`/lab/${draft.slug}?v=${v.key}`}
              aria-current={v.key === current ? 'page' : undefined}
              className={`rounded border px-2 py-1 ${v.key === current ? 'border-accent bg-accent/20 text-text' : 'border-border text-dim hover:text-text'}`}
            >
              <b>{v.key.toUpperCase()}</b> {v.name}
              {v.key === draft.rec ? <span className="ml-1 text-green">· recommended</span> : null}
            </Link>
          ))}
        </div>
        {cur ? <div className="mt-2 text-dim">{cur.diff}</div> : null}
        <div className="mt-1 text-dim">
          {draft.live ? <>Today: <Link href={draft.live} className="text-blue hover:underline">{draft.live}</Link></> : null}
          {/* A plain link, so it is a full page load: a staged switch that is read when the page first loads (the top
              bar's ?hdr=) would not see a query that arrived by an in-site navigation. */}
          {draft.staged ? <>{draft.live ? ' · ' : ''}With real data: <a href={draft.staged} className="text-blue hover:underline">{draft.staged}</a></> : null}
        </div>
      </div>
      {children}
    </>
  );
}
