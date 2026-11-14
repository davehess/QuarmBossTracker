import Link from 'next/link';
import { buildCopyText, type BlockersView, type ZoneBlockers } from '@/lib/popTonightBlockersView';
import CopyButton from './CopyButton';

export const Chip = ({ b }: { b: { name: string; missing: string[] } }) => (
  <li className="max-w-full rounded border border-red/50 bg-red/10 px-2 py-1 text-sm leading-snug">
    <b className="text-red">{b.name}</b>
    <span className="text-text"> {b.missing.join(' + ')}</span>
  </li>
);

export const AllSet = () => <span className="text-sm font-semibold text-green">All set</span>;

/** Headline: the answer, biggest thing on the screen. */
export function Headline({ view }: { view: BlockersView }) {
  const n = view.blockedPeople;
  return n === 0
    ? <p className="text-xl font-semibold text-green">Everyone has every preflag for tonight</p>
    : <p className="text-xl font-semibold text-red">{n} of {view.raiders} are missing a preflag for tonight</p>;
}

function Row({ z }: { z: ZoneBlockers }) {
  const names = z.blocked.map((b) => b.name);
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="flex items-start gap-x-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text">{z.zone}</h3>
          {z.blocked.length === 0
            ? <AllSet />
            : <span className="text-sm font-semibold text-red">{z.blocked.length} missing</span>}
        </div>
        {z.blocked.length > 0 && <span className="shrink-0"><CopyButton text={buildCopyText(names)} /></span>}
      </div>
      {z.blocked.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">{z.blocked.map((b) => <Chip key={b.name} b={b} />)}</ul>
      )}
    </div>
  );
}

/** One row per target zone: names missing a preflag in red with what each lacks, a copy button, or a green All set. */
export default function BlockersStrip({ view, meHref = '/pop/raid/me', headline = true }: { view: BlockersView; meHref?: string; headline?: boolean }) {
  return (
    <section aria-label="Who is missing a preflag for tonight's targets" className="space-y-2">
      {headline && <Headline view={view} />}
      {view.zones.map((z) => <Row key={z.id} z={z} />)}
      <p className="text-sm"><Link href={meHref} className="inline-flex min-h-[40px] items-center text-blue hover:underline">Your flags for tonight</Link></p>
    </section>
  );
}

/** A folded block with its count in the fold line; the full raider-by-flag list lives inside. */
export function FlagFold({ on = true, count, children }: { on?: boolean; count: number; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <details className="mt-4 rounded-lg border border-border bg-panel">
      <summary className="cursor-pointer px-3 py-2 text-sm text-blue">Every raider by flag ({count} raiders)</summary>
      {children}
    </details>
  );
}
