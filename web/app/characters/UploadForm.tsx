'use client';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { importCharacters } from './actions';
import type { ImportResult } from '@/lib/hubImport';

// The upload box: a file input that takes several .txt files (the browser's own drag-and-drop onto it works too), sent to
// the server action. Everything it shows back is plain text.
export default function UploadForm({ max, held }: { max: number; held: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      setResult(await importCharacters(data));
      if (input.current) input.current.value = '';
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-panel p-4">
      <label htmlFor="popflags-files" className="block text-sm font-medium text-text">Your PoPFlags files</label>
      <p className="mt-1 text-xs text-dim">
        In EverQuest, camp with Zeal's &ldquo;Export data on /camp&rdquo; on. Each character leaves a file called <code>Name-PoPFlags.txt</code> in
        the EverQuest folder. Choose one or several (or drop them on the box). You have {held} of {max} characters.
      </p>
      <input id="popflags-files" ref={input} name="files" type="file" multiple accept=".txt,text/plain"
        className="mt-3 block w-full rounded border border-dashed border-border bg-bg p-3 text-sm text-dim file:mr-3 file:rounded file:border-0 file:bg-blue file:px-3 file:py-1 file:text-sm file:text-white" />
      <button type="submit" disabled={busy}
        className="mt-3 rounded bg-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        {busy ? 'Reading…' : 'Load my characters'}
      </button>

      <div role="status" aria-live="polite">
        {result && !result.ok && <p className="mt-3 text-sm text-red">{result.error}</p>}
        {result && result.ok && (
          <ul className="mt-3 space-y-1 text-sm">
            {result.characters.map(c => (
              <li key={c.character} className={c.status === 'refused' ? 'text-red' : 'text-text'}>
                <b>{c.character}</b>:{' '}
                {c.status === 'saved' && `loaded, ${c.flags} flag${c.flags === 1 ? '' : 's'} read.`}
                {c.status === 'contested' && `loaded, but another player has claimed this name too, so it stays hidden from others until it is settled.`}
                {c.status === 'refused' && (c.reason ?? 'not loaded.')}
              </li>
            ))}
            {result.problems.map((p, i) => <li key={i} className="text-red"><b>{p.file}</b>: {p.message}</li>)}
            {result.characters.length === 0 && result.problems.length === 0 && <li className="text-dim">Nothing to load.</li>}
          </ul>
        )}
      </div>
    </form>
  );
}
