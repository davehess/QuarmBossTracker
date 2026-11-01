'use client';

// "Prepare my data" (the guild lead, 2026-11-01, on a phone: the old download showed no size and stopped partway,
// leaving a file that was not valid JSON). Nothing is saved until the whole file is in hand: the page fetches the
// manifest, then each section, builds the file in the browser, shows how big it is, and only then offers Save.
// The fetching and the file's shape live in lib/selfDataPrepare.ts; this is the buttons and the words.

import { useEffect, useRef, useState } from 'react';
import { prepareExport, formatBytes } from '@/lib/selfDataPrepare';

type Ready = { url: string; bytes: number; sections: number; failed: string[]; filename: string };

export default function PrepareData({ exportHref }: { exportHref: string }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const dropUrl = () => { if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; } };
  useEffect(() => dropUrl, []);

  async function prepare() {
    dropUrl();
    setBusy(true); setReady(null); setError(null); setProgress(null);
    try {
      const done = await prepareExport(
        (u) => fetch(u, { credentials: 'same-origin' }),
        `${exportHref}/manifest`,
        (s) => `${exportHref}/part?s=${encodeURIComponent(s)}`,
        (d, t) => setProgress({ done: d, total: t }),
      );
      const blob = new Blob(done.pieces, { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setReady({ url, bytes: blob.size, sections: done.sections, failed: done.failed, filename: done.filename });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not prepare your data just now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div>
      {!busy && !ready && (
        <button type="button" onClick={prepare} className="inline-flex min-h-11 items-center rounded border border-blue/50 px-4 text-sm text-blue hover:bg-blue/10">
          Prepare my data
        </button>
      )}

      {busy && (
        <div role="status" aria-live="polite">
          <p className="text-sm text-text">
            {progress ? `Preparing… ${progress.done} of ${progress.total} sections` : 'Preparing…'}
          </p>
          <div role="progressbar" aria-label="Preparing your data" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
            className="mt-2 h-2 w-full overflow-hidden rounded bg-border">
            <div className="h-full bg-blue" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-dim">Keep this page open. Nothing downloads until it is all ready.</p>
        </div>
      )}

      {ready && (
        <div role="status" aria-live="polite" className="rounded border border-green/40 p-3">
          <p className="text-sm text-text">Ready · {formatBytes(ready.bytes)} · {ready.sections} sections</p>
          {ready.failed.length > 0 && (
            <p className="mt-2 text-xs leading-5 text-dim">
              {ready.failed.length === 1 ? 'One section' : `${ready.failed.length} sections`} could not be read just now and
              say so inside the file: {ready.failed.join(', ')}.
            </p>
          )}
          <p className="mt-3">
            <a href={ready.url} download={ready.filename} className="inline-flex min-h-11 items-center rounded border border-blue/50 px-4 text-sm text-blue hover:bg-blue/10">
              Save file
            </a>
          </p>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-red">{error}</p>}
    </div>
  );
}
