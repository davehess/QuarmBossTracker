// Two small pieces both story variants draw, kept apart from StoryParts so the client stage (ChaptersStage) can import them
// without pulling in the pricing, the download address and the page's other words.
import type { Feature } from '@/lib/raidmimicStory';

/** A feature's picture. A plain <img>: a file that is not on disk yet is a 404 on a preview, never a failed build. */
export function FeaturePicture({ f, className = '' }: { f: Feature; className?: string }) {
  return (
    <img src={f.img} alt={f.alt} loading="lazy" decoding="async"
      className={`block aspect-[16/10] w-full rounded-md border border-border bg-panel object-cover ${className}`} />
  );
}

/** A dashed orange chip: the page's one way of drawing a promise (Parts.tsx StatusChip 'coming'). */
export function ComingChip({ children }: { children: string }) {
  return <span className="inline-flex items-center rounded border border-dashed border-orange/80 px-1.5 py-0.5 text-[11px] leading-4 tracking-wide text-orange">{children}</span>;
}
