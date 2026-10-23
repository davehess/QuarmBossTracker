// The small pieces the two raidmimic layout PREVIEWS (?v=player "Ladder", ?v=paths "Pick your path") share. Every sentence is in
// web/lib/raidmimicPlayer.ts; this file only decides how a block LOOKS. Server components, no client JS.
//
// Colour stays semantic (frontend-design): green = free and working today, blue = needs the guild's own server, gold =
// a choice for you, and the dashed orange "Coming" chip from Parts is the only way a promise is ever drawn.
import type { ReactNode } from 'react';
import { RAIDMIMIC_LANDING_PATH } from '@/lib/raidmimicHost';
import {
  PREVIEW_NOTE, TAG, VARIANTS, VARIANT_LABEL, type Point, type Tone, type Variant,
} from '@/lib/raidmimicPlayer';

export const EXT = { target: '_blank', rel: 'noreferrer' } as const;

const TONE: Record<Tone, string> = {
  free: 'border-green/60 text-green',
  hub: 'border-blue/60 text-blue',
  choice: 'border-gold/70 text-gold',
};

export function Tag({ tone, label }: { tone: Tone; label?: string }) {
  return (
    <span data-tone={tone} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] leading-4 tracking-wide ${TONE[tone]}`}>
      {label ?? TAG[tone]}
    </span>
  );
}

/** A quiet button for the second action on a block; the one gold button on screen stays the primary. */
export const OUTLINE_BTN =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-blue/70 px-4 py-2 text-sm font-semibold text-blue no-underline transition-colors hover:border-blue hover:bg-blue/10 hover:no-underline motion-reduce:transition-none';

/**
 * Where the preview sits among its siblings: today's page and both previews, side by side, so the guild lead can flip
 * between them. Shown on a preview only, never on the default page.
 */
export function PreviewBar({ current }: { current: Variant }) {
  const link = 'inline-flex min-h-11 items-center rounded-md border px-3 text-xs no-underline hover:no-underline';
  return (
    <nav aria-label="Layout preview" className="mb-4 rounded-md border border-border bg-panel px-3 py-2">
      <p className="text-xs leading-5 text-dim">{PREVIEW_NOTE}</p>
      <ul className="m-0 mt-1 flex list-none flex-wrap gap-2 p-0">
        <li><a href={RAIDMIMIC_LANDING_PATH} className={`${link} border-border text-text hover:border-blue`}>Today’s page</a></li>
        {VARIANTS.map(v => (
          <li key={v}>
            <a href={`${RAIDMIMIC_LANDING_PATH}?v=${v}`} aria-current={v === current ? 'page' : undefined}
              className={`${link} ${v === current ? 'border-accent bg-accent text-[#f2ede1]' : 'border-border text-text hover:border-blue'}`}>
              {VARIANT_LABEL[v]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Head-and-sentence list; `cols` puts it in two columns from the small breakpoint up. */
export function Points({ points, cols = false }: { points: Point[]; cols?: boolean }) {
  return (
    <ul className={`m-0 list-none gap-3 p-0 ${cols ? 'grid sm:grid-cols-2' : 'space-y-3'}`}>
      {points.map(p => (
        <li key={p.head} className="rounded-md border border-border bg-panel p-4">
          <h3 className="text-base leading-snug text-[#f2ede1]">{p.head}</h3>
          <p className="mt-1 text-sm leading-6 text-text">{p.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** A promise, drawn like the default page's "What is not built yet": dashed, orange, and the chip says Coming. */
export function ComingCard({ head, body, chip }: { head: string; body: string; chip: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-orange/70 p-4">
      <div className="mb-2">{chip}</div>
      <h3 className="text-base leading-snug text-[#f2ede1]">{head}</h3>
      <p className="mt-1 max-w-[66ch] text-sm leading-6 text-text">{body}</p>
    </div>
  );
}
