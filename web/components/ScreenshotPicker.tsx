'use client';

// Attach screenshots to feedback or a roadmap suggestion (the guild lead, 2026-09-26: "feedback and
// suggestion needs to be able to take screenshots..top priority"). Pick files or paste (Ctrl+V)
// anywhere inside the wrapped area; each image is shrunk to 1600 px on its long edge and re-encoded
// as JPEG in the browser, so three fit in one request. The server re-checks every byte
// (lib/feedbackShots.ts) — this is for size, not trust.

import { useCallback, useRef, type ReactNode, type ClipboardEvent } from 'react';

export const SHOT_MAX = 3;
const MAX_EDGE = 1600;

async function shrink(file: Blob): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ScreenshotPicker({
  value, onChange, children, compact = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  children?: ReactNode;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const add = useCallback(async (files: Blob[]) => {
    const room = SHOT_MAX - value.length;
    if (room <= 0) return;
    const shrunk = (await Promise.all(files.slice(0, room).map(shrink))).filter((s): s is string => !!s);
    if (shrunk.length) onChange([...value, ...shrunk]);
  }, [value, onChange]);

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); void add(files); }
  };

  return (
    <div onPaste={onPaste} className="space-y-2">
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={value.length >= SHOT_MAX}
          className={`${compact ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'} rounded border border-border bg-bg text-dim hover:text-text hover:border-blue disabled:opacity-50`}
        >
          📷 Add screenshot
        </button>
        <span className="text-[11px] text-dim">or paste one here (Ctrl+V) · up to {SHOT_MAX}</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => { void add(Array.from(e.target.files || [])); e.target.value = ''; }}
        />
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((src, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL preview, nothing to optimise */}
              <img src={src} alt={`Screenshot ${i + 1}`} className="h-20 w-auto max-w-[180px] object-cover rounded border border-border" />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={`Remove screenshot ${i + 1}`}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-bg border border-border text-[11px] text-dim hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
