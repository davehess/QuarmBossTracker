import Link from 'next/link';
import { LAB_DRAFTS } from '@/lib/lab/registry';

export const metadata = {
  title: 'Design lab',
  description: 'Draft page designs for WolfPack.quest and Raid Mimic, shown with made-up data. Nothing here is live.',
};

// The index of drafts. One row per draft: what is wrong today, the versions, and which one is recommended.
export default function LabIndex() {
  const sites = ['wolfpack.quest', 'raidmimic.com'] as const;
  return (
    <div className="font-mono">
      <h1 className="text-lg text-text">Design lab</h1>
      <p className="mt-1 max-w-3xl text-sm text-dim">
        Drafts with made-up data. Each one has two or three versions; pick on the Decision Desk. Nothing here changes
        the live pages.
      </p>
      {sites.map((site) => {
        const rows = LAB_DRAFTS.filter((d) => d.site === site);
        if (!rows.length) return null;
        return (
          <section key={site} className="mt-6">
            <h2 className="mb-2 text-xs uppercase tracking-wider text-dim">{site}</h2>
            <ul className="divide-y divide-border rounded-md border border-border bg-panel">
              {rows.map((d) => (
                <li key={d.slug} className="px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <Link href={`/lab/${d.slug}`} className="text-blue hover:underline">{d.title}</Link>
                    <span className="text-xs text-dim">{d.problem}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {d.variants.map((v) => (
                      <Link key={v.key} href={`/lab/${d.slug}?v=${v.key}`} className="rounded border border-border px-2 py-0.5 text-dim hover:text-text">
                        <b className="text-text">{v.key.toUpperCase()}</b> {v.name}
                        {v.key === d.rec ? <span className="ml-1 text-green">· recommended</span> : null}
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!LAB_DRAFTS.length ? <p className="mt-6 text-sm text-dim">No drafts yet.</p> : null}
    </div>
  );
}
