'use client';

// A shipped/near-term roadmap feature card. Media (screenshots/clips) is
// optional per feature (see web/lib/roadmapData.ts) — when present, each
// thumbnail opens a focused lightbox on click (CSS scale/fade transition,
// Escape or click-outside to close). Renders a plain text card when a
// feature has no media yet, which is every feature today.

import { useEffect, useState } from 'react';
import type { RoadmapFeature, RoadmapMedia } from '@/lib/roadmapData';

const TAG_STYLES = 'text-[10px] px-1.5 py-0.5 rounded border bg-blue/10 text-blue border-blue/40 font-mono shrink-0';

export default function RoadmapFeatureCard({ feature }: { feature: RoadmapFeature }) {
  const [focused, setFocused] = useState<RoadmapMedia | null>(null);

  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocused(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focused]);

  return (
    <div className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base text-orange leading-tight">{feature.title}</h3>
        {feature.tag && <span className={TAG_STYLES}>{feature.tag}</span>}
      </div>
      <p className="text-sm text-text leading-6">{feature.summary}</p>

      {feature.media && feature.media.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-1">
          {feature.media.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setFocused(m)}
              title={`Focus: ${m.alt}`}
              className="group relative w-28 h-[4.5rem] rounded border border-border overflow-hidden
                         transition-transform duration-200 ease-out hover:scale-105
                         focus:outline-none focus:ring-2 focus:ring-blue"
            >
              {m.type === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.src}
                  alt={m.alt}
                  className="w-full h-full object-cover transition-opacity duration-200 group-hover:opacity-75"
                />
              ) : (
                <video src={m.src} className="w-full h-full object-cover" muted playsInline />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors duration-200">
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-sm">🔍</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {focused && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 animate-wp-fade-in"
          onClick={() => setFocused(null)}
          role="dialog"
          aria-modal="true"
          aria-label={focused.alt}
        >
          <div
            className="max-w-4xl w-full max-h-[85vh] flex flex-col items-center gap-2 animate-wp-zoom-in"
            onClick={(e) => e.stopPropagation()}
          >
            {focused.type === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={focused.src} alt={focused.alt} className="max-w-full max-h-[75vh] object-contain rounded-lg border border-border" />
            ) : (
              <video src={focused.src} className="max-w-full max-h-[75vh] object-contain rounded-lg border border-border" controls autoPlay />
            )}
            <p className="text-xs text-dim">{focused.alt} — click anywhere or press Esc to close</p>
          </div>
        </div>
      )}
    </div>
  );
}
