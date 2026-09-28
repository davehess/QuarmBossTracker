'use client';

// A grid of guild media thumbnails with a viewer (web/lib/guildMedia.ts). The page hands in the first few,
// already signed; "Show all" fetches the rest of that section or character from /api/media. The viewer
// plays or shows the file, steps with the arrow keys, saves it, and fetches its prompt only when asked.
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadUrl, oneLabel, type MediaItem } from '@/lib/guildMedia';

type Info = { prompt: string | null; model: string | null; resolution: string | null };

export function caption(it: MediaItem, showCharacter: boolean): string {
  return [showCharacter ? it.character : null, it.title || oneLabel(it.section)].filter(Boolean).join(' · ');
}

export default function MediaGrid({ initial, total, query, showCharacter = false, big = false }: {
  initial: MediaItem[]; total: number; query?: string; showCharacter?: boolean; big?: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [info, setInfo] = useState<Record<number, Info | 'loading' | null>>({});
  const dlg = useRef<HTMLDialogElement>(null);

  const more = async () => {
    if (!query) return;
    setLoading(true); setFailed(false);
    try {
      const r = await fetch(`/api/media?${query}`);
      if (!r.ok) throw new Error(String(r.status));
      setItems(((await r.json()) as { items: MediaItem[] }).items);
    } catch {
      setFailed(true);
    }
    setLoading(false);
  };

  const show = (i: number | null) => {
    setOpen(i);
    if (i === null) dlg.current?.close();
    else if (!dlg.current?.open) dlg.current?.showModal();
  };
  const step = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + items.length) % items.length)), [items.length]);

  const loadInfo = async (id: number) => {
    if (info[id] !== undefined) return;
    setInfo((m) => ({ ...m, [id]: 'loading' }));
    try {
      const r = await fetch(`/api/media?id=${id}`);
      const got = r.ok ? ((await r.json()) as Info) : null;
      setInfo((m) => ({ ...m, [id]: got }));
    } catch {
      setInfo((m) => ({ ...m, [id]: null }));
    }
  };

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    const onClose = () => setOpen(null);
    d.addEventListener('close', onClose);
    return () => d.removeEventListener('close', onClose);
  }, []);

  const cur = open === null ? null : items[open];
  const curInfo = cur ? info[cur.id] : undefined;

  return (
    <div className="grid gap-2">
      <ul className={`grid gap-2 ${big ? '[grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]' : '[grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]'}`}>
        {items.map((it, i) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => show(i)}
              className="group grid w-full gap-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              aria-label={`Open ${caption(it, showCharacter)}`}
            >
              <span className="relative block aspect-video overflow-hidden rounded border border-border bg-black">
                {it.thumbUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover group-hover:opacity-90" />
                )}
                {it.kind === 'video' && (
                  <span aria-hidden className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[11px] text-text">▶</span>
                )}
                {it.used && (
                  <span className="absolute right-1 top-1 rounded bg-black/70 px-1 text-[10px] uppercase tracking-wider text-gold">film</span>
                )}
              </span>
              <span className="truncate text-xs text-dim group-hover:text-text">{caption(it, showCharacter)}</span>
            </button>
          </li>
        ))}
      </ul>
      {query && items.length < total && (
        <button type="button" onClick={more} disabled={loading}
          className="justify-self-start rounded border border-border px-3 py-1.5 text-sm text-blue hover:border-blue disabled:cursor-progress disabled:opacity-60">
          {loading ? 'Loading…' : `Show all ${total}`}
        </button>
      )}
      {failed && <p className="text-xs text-red">That did not load. Try again.</p>}

      <dialog
        ref={dlg}
        onClick={(e) => { if (e.target === dlg.current) show(null); }}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); }}
        className="w-[min(96vw,1100px)] rounded-lg border border-border bg-panel p-0 text-text backdrop:bg-black/80"
      >
        {cur && (
          <div className="grid gap-2 p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{caption(cur, true)}</span>
              <span className="text-xs tabular-nums text-dim">{(open ?? 0) + 1}/{items.length}</span>
              <button type="button" onClick={() => step(-1)} aria-label="Previous" className="rounded border border-border px-2 py-1 text-sm hover:border-blue">←</button>
              <button type="button" onClick={() => step(1)} aria-label="Next" className="rounded border border-border px-2 py-1 text-sm hover:border-blue">→</button>
              <button type="button" onClick={() => show(null)} aria-label="Close" className="rounded border border-border px-2 py-1 text-sm hover:border-red">✕</button>
            </div>
            {cur.url && cur.kind === 'video' && (
              <video key={cur.id} src={cur.url} controls autoPlay playsInline className="max-h-[75vh] w-full rounded bg-black" />
            )}
            {cur.url && cur.kind === 'image' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={cur.id} src={cur.url} alt={caption(cur, true)} className="max-h-[75vh] w-full rounded bg-black object-contain" />
            )}
            <div className="flex flex-wrap items-start gap-3 text-sm">
              {cur.url && <a href={downloadUrl(cur.url, cur.name)} className="text-blue hover:underline">Save</a>}
              <details className="min-w-0 flex-1" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) loadInfo(cur.id); }}>
                <summary className="cursor-pointer text-dim hover:text-text">How it was made</summary>
                {curInfo === 'loading' && <p className="mt-1 text-xs text-dim">Loading…</p>}
                {curInfo === null && <p className="mt-1 text-xs text-dim">No record for this one.</p>}
                {curInfo && curInfo !== 'loading' && (
                  <div className="mt-1 grid gap-1 text-xs">
                    {(curInfo.model || curInfo.resolution) && (
                      <p className="text-dim">{[curInfo.model, curInfo.resolution].filter(Boolean).join(' · ')}</p>
                    )}
                    {curInfo.prompt
                      ? <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-text">{curInfo.prompt}</p>
                      : <p className="text-dim">No prompt kept for this one.</p>}
                  </div>
                )}
              </details>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
