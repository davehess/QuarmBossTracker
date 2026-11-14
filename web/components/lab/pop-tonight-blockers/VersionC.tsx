import { buildCopyText, type BlockersView } from '@/lib/popTonightBlockersView';
import { Chip, AllSet, Headline } from './BlockersStrip';
import CopyButton from './CopyButton';

// C: a card per target zone. Who is blocked, how to get there, what to expect, all in one place.
export default function VersionC({ view }: { view: BlockersView }) {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Headline view={view} />
      {view.zones.map((z, i) => (
        <article key={z.id} className="rounded-lg border border-border bg-panel p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="text-sm font-semibold text-text">{i + 1}. {z.zone}</h3>
            {z.blocked.length === 0 ? <AllSet /> : (
              <>
                <span className="text-sm font-semibold text-red">{z.blocked.length} blocked</span>
                <span className="ml-auto"><CopyButton text={buildCopyText(z.blocked.map((b) => b.name))} /></span>
              </>
            )}
          </div>
          {z.blocked.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{z.blocked.map((b) => <Chip key={b.name} b={b} />)}</ul>}
          <dl className="mt-3 space-y-1 border-t border-border/60 pt-2 text-sm text-text">
            <div><dt className="inline font-semibold">Get there </dt><dd className="inline">{z.how}</dd></div>
            <div><dt className="inline font-semibold">Expect </dt><dd className="inline">{z.expect}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}
