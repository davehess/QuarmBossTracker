'use client';

// Bring in characters we have never seen — bank mules, alts on a box that
// never raids, anything that exists only as a file on your disk.
//
// Hitya, 2026-08-14: "can you make it so that anyone can upload additional
// inventory files from the /me page and have it bring in their other
// characters/mules?" The per-character 🎒 upload cannot: it is gated on the
// character already being in the roster AND already linked to you, which is
// precisely what a mule is not. Pyxil's bank toons have no logs, no /who
// sighting and no OpenDKP row — the file is the only proof they exist.
//
// So this one is keyed on the FILE, not on a character you pick: drop in as
// many <Name>-Inventory.txt as you like and each one brings its character with
// it. Results are per file, because a batch where two of six belong to someone
// else has to say WHICH two.

import { useRef, useState, useTransition } from 'react';
import { uploadMuleInventories, type MuleResult } from './inventory-actions';

const MAX_FILES = 40;
// An inventory export is a few KB. A megabyte is already something else, and
// reading a huge file into the page just to have the server reject it is the
// slowest possible way to say no.
const MAX_BYTES = 2 * 1024 * 1024;

export default function MuleUpload() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<MuleResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files || []);
    if (list.length === 0) return;
    setError(null);
    setResults(null);

    const tooBig = list.filter(f => f.size > MAX_BYTES).map(f => f.name);
    if (tooBig.length) {
      setError(`too large to be an inventory export: ${tooBig.join(', ')}`);
      return;
    }
    if (list.length > MAX_FILES) {
      setError(`${list.length} files — please do at most ${MAX_FILES} at a time`);
      return;
    }

    Promise.all(list.map(f => f.text().then(text => ({ name: f.name, text }))))
      .then(files => {
        startTransition(async () => {
          const res = await uploadMuleInventories(files);
          if (res.error) setError(res.error);
          setResults(res.results);
          // Let the same files be picked again after a fix, which a file input
          // otherwise refuses (same value = no change event).
          if (fileRef.current) fileRef.current.value = '';
        });
      })
      .catch(() => setError('could not read those files'));
  }

  const okCount = (results ?? []).filter(r => r.ok).length;

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="px-2 py-1 rounded border border-border text-dim hover:border-blue hover:text-blue"
        title="Add mules and alts we have never seen, straight from their inventory files"
      >
        🧳 {open ? 'Close' : 'Add characters from inventory files'}
      </button>

      {open && (
        <div className="mt-2 bg-bg/40 border border-border/60 rounded p-2.5 space-y-2 max-w-xl">
          <p className="text-[11px] text-dim leading-5">
            For bank mules and alts that never raid, so they don&apos;t need Mimic running.
            On each one, log in and run <code className="text-text">/outputfile inventory</code> —
            EQ writes <code className="text-text">&lt;Name&gt;-Inventory.txt</code> into your
            EverQuest folder. Select as many of those files as you like here; each one
            brings its character in and links it to you.
          </p>
          <p className="text-[11px] text-dim leading-5">
            <b className="text-text">The file name is what names the character</b>, so keep it as
            EQ wrote it. Re-upload any time to refresh what a mule is holding.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            multiple
            onChange={onFiles}
            disabled={pending}
            className="block w-full text-[11px] text-dim file:mr-2 file:px-2 file:py-1 file:rounded file:border file:border-blue file:bg-[#1f6feb22] file:text-blue file:text-xs"
          />
          {pending && <div className="text-dim text-[11px]">reading and matching…</div>}
          {error && <div className="text-red text-[11px]">⚠ {error}</div>}

          {results && results.length > 0 && (
            <div className="space-y-1">
              {okCount > 0 && (
                <div className="text-green text-[11px]">
                  ✓ {okCount} character{okCount === 1 ? '' : 's'} updated — they appear in your list below.
                </div>
              )}
              <ul className="space-y-0.5">
                {results.map((r, i) => (
                  <li key={`${r.file}-${i}`} className="text-[11px] leading-5">
                    {r.ok ? (
                      <span className="text-dim">
                        <span className="text-green">✓</span>{' '}
                        <span className="text-text">{r.character}</span>{' '}
                        — {r.count} item{r.count === 1 ? '' : 's'}
                        {r.claimed && <span className="text-blue"> · added to your characters</span>}
                        {r.note && <span className="text-amber-400"> · {r.note}</span>}
                      </span>
                    ) : (
                      <span className="text-dim">
                        <span className="text-red">⚠</span>{' '}
                        <span className="text-text">{r.character || r.file}</span> — {r.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
