// A character's gallery: their pictures and clips from guild media (web/lib/guildMedia.ts), kept long-term
// (the guild lead, 2026-09-28). Renders nothing for a character with no media. The best few large (their
// clip, their action still, their first picture); everything else behind "All".
import Link from 'next/link';
import MediaGrid from '@/components/MediaGrid';
import { clock, inGalleryOrder, isCharacterName } from '@/lib/guildMedia';
import { loadFilmMaking, loadMedia } from '@/lib/guildMediaLoad';

const HIGHLIGHT = ['clip', 'action-still', 'first-still'];

export default async function CharacterGallery({ name }: { name: string }) {
  if (!isCharacterName(name)) return null;
  const [{ items }, fm] = await Promise.all([loadMedia({ character: name }, { limit: 200 }), loadFilmMaking()]);
  if (!items.length) return null;
  const raider = fm?.raiders.find((r) => r.name.toLowerCase() === name.toLowerCase()) || null;

  // The highlights: the first of each highlight section, preferring what made the film.
  const highlights = HIGHLIGHT.flatMap((s) => {
    const g = items.filter((i) => i.section === s);
    const pick = g.find((i) => i.used) || g[0];
    return pick ? [pick] : [];
  });
  const rest = inGalleryOrder(items.filter((i) => !highlights.includes(i)));

  return (
    <section className="grid gap-3 rounded-lg border border-border bg-panel p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-lg text-gold">Gallery</h3>
        <span className="text-xs tabular-nums text-dim">{items.length}</span>
        <Link href={`/film/making?raider=${encodeURIComponent(name)}`} className="ml-auto text-sm text-blue hover:underline">how the film was made</Link>
      </div>
      {raider?.say && (
        <p className="text-sm text-dim">
          In the Aten Ha Ra film, sung as <span className="text-gold">{raider.say}</span>
          {raider.regular && <> at <span className="tabular-nums text-text">{clock(raider.regular.t)}</span></>}
          {raider.remix && <> (<span className="tabular-nums text-text">{clock(raider.remix.t)}</span> in the remix)</>}.{' '}
          <Link href="/film" className="text-blue hover:underline">Watch</Link>
        </p>
      )}
      <MediaGrid initial={highlights} total={highlights.length} big />
      {rest.length > 0 && (
        <details className="grid gap-2">
          <summary className="cursor-pointer text-sm text-dim hover:text-text">All {items.length}: every try and take</summary>
          <div className="mt-2"><MediaGrid initial={rest} total={rest.length} /></div>
        </details>
      )}
    </section>
  );
}
