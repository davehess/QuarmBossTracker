'use client';

// One archify artifact, embedded.
//
// ⚠ An <iframe>, not inlined markup, and that is the point of the format. Each
// artifact is ~700KB of self-contained HTML carrying its own SVG, viewer, theme
// and interaction JS. Inlining one would drag all of that into the page bundle
// and its scripts into our global scope; four would be unusable. The iframe also
// keeps the artifact byte-identical to what `archify deliver` validated, so the
// thing on screen is the thing that passed the checks.
//
// ⚠ `?theme=dark` is appended, NOT `&embed=1`. embed strips the viewer chrome
// for a clean picture, which also strips the guided views, the legend and the
// cards — i.e. the interactivity that is the whole reason to render through
// archify instead of exporting a PNG. Dark alone matches the site ground and
// keeps all of it.
//
// loading="lazy" so only the diagram someone scrolls to is ever fetched.
import { useState } from 'react';

export default function Diagram({
  src, title, height = 620,
}: { src: string; title: string; height?: number }) {
  const [ready, setReady] = useState(false);
  return (
    <div className="relative bg-bg border border-border rounded-lg overflow-hidden">
      {!ready && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs text-dim animate-pulse"
          aria-hidden
        >
          Drawing {title}…
        </div>
      )}
      <iframe
        src={`${src}?theme=dark`}
        title={title}
        loading="lazy"
        onLoad={() => setReady(true)}
        className="w-full block"
        style={{ height, border: 0 }}
      />
    </div>
  );
}
