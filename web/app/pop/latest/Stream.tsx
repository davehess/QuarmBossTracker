// The stream: A's verbose rows (the guild lead, 2026-10-14), one row per MOMENT. Characters that earned the same
// steps together are one row with their names A-Z. Server component; every fold is a native <details>.

import Link from 'next/link';
import { agoText, stepLabel, verifiedBadge } from '@/lib/popLatestFlags';
import { NAMES_SHOWN, STREAM_ROWS, stepPlace, type Cluster, type Needer } from '@/lib/popLatestView';
import ExpandList from './ExpandList';

const BADGE_CLS: Record<string, string> = {
  event: 'border-green/60 text-green',
  recital: 'border-blue/60 text-blue',
};
const STEPS_SHOWN = 3;

const charHref = (name: string) => `/character/${encodeURIComponent(name)}`;
const nameItem = (name: string, key = name) => ({ key, node: <Link href={charHref(name)} className="hover:underline">{name}</Link> });

function Row({ c, now, needs }: { c: Cluster; now: number; needs: Needer[] | undefined }) {
  const badge = verifiedBadge(c.source);
  const steps = c.steps.map(s => {
    const place = stepPlace(s.key);
    return {
      key: s.key,
      node: (
        <span title={place?.name}>
          <span className="text-text">{s.label}</span>
          {place && <span className="text-[11px] text-dim"> ({place.short})</span>}
        </span>
      ),
    };
  });
  const span = c.at - c.earliest;
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <span className="min-w-0 text-dim"><ExpandList items={steps} limit={STEPS_SHOWN} noun=" steps" sep=" · " /></span>
        <span className="ml-auto flex items-baseline gap-2 whitespace-nowrap">
          <span className="text-[11px] text-dim"
                title={span > 60_000 ? `${new Date(c.earliest).toISOString()} to ${new Date(c.at).toISOString()}` : new Date(c.at).toISOString()}>
            {agoText(now, c.at)}
          </span>
          {c.catchUp && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-dim"
                  title="This character's first recital on file: it restates flags it earned earlier, so the time is when the Seer was heard, not when they were earned">
              first recital
            </span>
          )}
          {badge && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${BADGE_CLS[c.source] ?? ''}`} title={badge.title}>
              ✓ {badge.label}
            </span>
          )}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-dim">
        <b className="text-text">{c.characters.length}</b> {c.characters.length === 1 ? 'raider' : 'raiders'}:{' '}
        <ExpandList items={c.characters.map(w => nameItem(w.name))} limit={NAMES_SHOWN} />
      </div>
      {needs !== undefined && (
        needs.length > 0 ? (
          <details className="mt-0.5 text-xs">
            <summary className="cursor-pointer text-orange hover:underline">{needs.length} in the raid still need{needs.length === 1 ? 's' : ''} this</summary>
            <div className="mt-0.5 text-dim">
              {needs.map((n, i) => (
                <span key={n.name}>
                  {i > 0 && ', '}
                  <Link href={charHref(n.name)} className="hover:underline">{n.name}</Link>
                  {n.missing.length < c.steps.length && (
                    <span className="text-[11px]" title={`Missing: ${n.missing.map(stepLabel).join(' · ')}`}> (missing {n.missing.length} of {c.steps.length})</span>
                  )}
                </span>
              ))}
            </div>
          </details>
        ) : (
          <div className="mt-0.5 text-[11px] text-green">✓ everyone in the raid has this</div>
        )
      )}
    </li>
  );
}

export default function Stream({ clusters, needs, now }: { clusters: Cluster[]; needs: Map<string, Needer[]>; now: number }) {
  const first = clusters.slice(0, STREAM_ROWS);
  const later = clusters.slice(STREAM_ROWS);
  const row = (c: Cluster) => <Row key={c.id} c={c} now={now} needs={needs.get(c.id)} />;
  return (
    <ul className="divide-y divide-border/50">
      {first.map(row)}
      {later.length > 0 && (
        <li className="py-2">
          <details>
            <summary className="cursor-pointer text-xs text-blue hover:underline">{later.length} earlier moments</summary>
            <ul className="mt-1 divide-y divide-border/50">{later.map(row)}</ul>
          </details>
        </li>
      )}
    </ul>
  );
}
