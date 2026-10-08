'use client';

// A YouTube player that costs nothing until pressed: the poster is our own image, and the embed (and
// YouTube's scripts) load only on the click. With no id yet, the poster says so and cannot be pressed.
import { useState } from 'react';

export default function LiteYouTube({ id, title, poster }: { id: string | null; title: string; poster: string }) {
  const [playing, setPlaying] = useState(false);
  if (id && playing) {
    return (
      <iframe
        className="aspect-video w-full rounded border border-border bg-black"
        src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!id}
      onClick={() => setPlaying(true)}
      aria-label={id ? `Play ${title}` : `${title}: not on YouTube yet`}
      className="group relative block aspect-video w-full overflow-hidden rounded border border-border bg-black enabled:cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={poster} alt="" className="h-full w-full object-cover transition-opacity group-enabled:group-hover:opacity-90" />
      {id ? (
        <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-2xl text-text ring-2 ring-gold group-hover:bg-black/85">
          ▶
        </span>
      ) : (
        <span className="absolute bottom-3 left-3 rounded bg-black/75 px-2 py-1 text-xs text-dim">On YouTube soon</span>
      )}
    </button>
  );
}
