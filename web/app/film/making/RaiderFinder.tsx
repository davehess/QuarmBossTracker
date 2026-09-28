'use client';

// /film/making?v=b — find your raider: every card in the set, a filter by name or class, and one raider's
// whole journey (how the song says the name, where each take sings it, every picture and take) on a click.
import { useMemo, useState } from 'react';
import MediaGrid from '@/components/MediaGrid';
import { clock, type FilmRaider, type MediaItem } from '@/lib/guildMedia';

export type FinderRaider = FilmRaider & { thumbUrl: string | null };

export default function RaiderFinder({ raiders, youtube, takes }: {
  raiders: FinderRaider[];
  youtube: Record<string, string | null>;
  takes: { key: string; title: string }[];
}) {
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [media, setMedia] = useState<Record<string, MediaItem[] | 'loading' | 'failed'>>({});

  const classes = useMemo(() => Array.from(new Set(raiders.map((r) => r.cls))).sort(), [raiders]);
  const shown = raiders.filter((r) => (!cls || r.cls === cls) && (!q || r.name.toLowerCase().includes(q.trim().toLowerCase())));
  const cur = raiders.find((r) => r.name === pick) || null;

  const choose = async (name: string) => {
    setPick(name);
    if (media[name] && media[name] !== 'failed') return;
    setMedia((m) => ({ ...m, [name]: 'loading' }));
    try {
      const r = await fetch(`/api/media?collection=aten-ha-ra&character=${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error(String(r.status));
      const items = ((await r.json()) as { items: MediaItem[] }).items;
      setMedia((m) => ({ ...m, [name]: items }));
    } catch {
      setMedia((m) => ({ ...m, [name]: 'failed' }));
    }
  };

  const got = cur ? media[cur.name] : undefined;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a raider"
          className="w-48 rounded border border-border bg-bg px-2 py-1.5 text-sm text-text placeholder:text-dim focus:border-blue focus:outline-none"
        />
        {['', ...classes].map((c) => (
          <button key={c || 'all'} type="button" onClick={() => setCls(c)}
            className={`rounded border px-2 py-1 text-xs ${cls === c ? 'border-accent bg-accent/20 text-text' : 'border-border text-dim hover:text-text'}`}>
            {c || 'All'}
          </button>
        ))}
      </div>

      {cur && (
        <section className="grid gap-3 rounded-lg border border-border bg-panel p-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl text-gold">{cur.name}</h2>
            <span className="text-sm text-dim">{cur.race} {cur.cls}</span>
            <a href={`/character/${encodeURIComponent(cur.name)}`} className="text-sm text-blue hover:underline">character page</a>
            <button type="button" onClick={() => setPick(null)} className="ml-auto text-sm text-dim hover:text-text">close</button>
          </div>
          {cur.say ? (
            <p className="text-sm">
              Sung as <span className="text-gold">{cur.say}</span>
              {takes.map((t) => {
                const at = (cur as unknown as Record<string, { t: number } | null>)[t.key];
                if (!at) return null;
                const id = youtube[t.key];
                return (
                  <span key={t.key} className="text-dim">
                    {' · '}
                    {id
                      ? <a href={`https://www.youtube.com/watch?v=${id}&t=${Math.floor(at.t)}s`} target="_blank" rel="noreferrer" className="text-blue hover:underline">{clock(at.t)} in {t.title}</a>
                      : <>{clock(at.t)} in {t.title}</>}
                  </span>
                );
              })}
            </p>
          ) : (
            <p className="text-sm text-dim">Drawn for the film, but not in the final cut.</p>
          )}
          {got === 'loading' && <p className="text-sm text-dim">Loading…</p>}
          {got === 'failed' && <p className="text-sm text-red">That did not load. Pick the raider again.</p>}
          {Array.isArray(got) && <MediaGrid key={cur.name} initial={got} total={got.length} big />}
        </section>
      )}

      <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(132px,1fr))]">
        {shown.map((r) => (
          <li key={r.name}>
            <button type="button" onClick={() => choose(r.name)}
              className={`group grid w-full gap-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${pick === r.name ? 'opacity-100' : ''}`}>
              <span className={`relative block aspect-video overflow-hidden rounded border bg-black ${pick === r.name ? 'border-gold' : 'border-border'}`}>
                {r.thumbUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumbUrl} alt="" loading="lazy" className={`h-full w-full object-cover ${r.inFilm ? '' : 'opacity-60'}`} />
                )}
              </span>
              <span className="truncate text-sm text-text group-hover:text-gold">{r.name}</span>
              <span className="truncate text-xs text-dim">{r.say || `${r.cls} · not in the cut`}</span>
            </button>
          </li>
        ))}
      </ul>
      {!shown.length && <p className="text-sm text-dim">Nobody by that name in the film.</p>}
    </div>
  );
}
