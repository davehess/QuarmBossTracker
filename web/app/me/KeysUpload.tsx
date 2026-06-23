'use client';

// Per-character /keys upload. Same UX as InventoryUpload — pick the EQ log
// or paste the lines from /keys; server action parses + replaces the
// snapshot. The bot's quest tracker uses this to know which keys are
// already in the keyring.

import { useRef, useState, useTransition } from 'react';
import { uploadKeys } from './keys-actions';

export default function KeysUpload({ character }: { character: string }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: 'idle' | 'done' | 'err'; msg?: string }>({ kind: 'idle' });
  const [open, setOpen] = useState(false);

  function submitText(text: string) {
    if (!text.trim()) { setStatus({ kind: 'err', msg: 'empty file' }); return; }
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const res = await uploadKeys(character, text);
      if (res.ok) setStatus({ kind: 'done', msg: `Parsed ${res.count} keys.` });
      else setStatus({ kind: 'err', msg: res.error ?? 'upload failed' });
    });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => submitText(String(reader.result || ''));
    reader.onerror = () => setStatus({ kind: 'err', msg: 'could not read file' });
    reader.readAsText(f);
  }

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="px-2 py-1 rounded border border-border text-dim hover:border-blue hover:text-blue"
        title="Upload your /keys output so the quest tracker knows which keys you already have"
      >
        🗝 {open ? 'Close' : 'Upload keys'}
      </button>
      {open && (
        <div className="mt-2 bg-bg/40 border border-border/60 rounded p-2.5 space-y-2 max-w-md">
          <p className="text-[11px] text-dim leading-5">
            In EQ, run <code className="text-text">/keys</code> — the keyring lines
            land in <code className="text-text">eqlog_{character}_pq.proj.txt</code>.
            Pick the log here (the parser strips timestamps and drops chatter),
            or paste the lines directly.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            onChange={onFile}
            disabled={pending}
            className="block w-full text-[11px] text-dim file:mr-2 file:px-2 file:py-1 file:rounded file:border file:border-blue file:bg-[#1f6feb22] file:text-blue file:text-xs"
          />
          <details className="text-[10px] text-dim">
            <summary className="cursor-pointer hover:text-blue">…or paste the /keys lines</summary>
            <PasteBox onSubmit={submitText} pending={pending} />
          </details>
          {status.kind === 'done' && <div className="text-green text-[11px]">✓ {status.msg}</div>}
          {status.kind === 'err'  && <div className="text-red text-[11px]">⚠ {status.msg}</div>}
          {pending && <div className="text-dim text-[11px]">parsing…</div>}
        </div>
      )}
    </div>
  );
}

function PasteBox({ onSubmit, pending }: { onSubmit: (t: string) => void; pending: boolean }) {
  const [text, setText] = useState('');
  return (
    <div className="mt-1 space-y-1">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste the /keys output here (timestamps optional)…"
        className="w-full min-h-[5rem] bg-bg border border-border rounded px-2 py-1 text-[11px] font-mono"
        disabled={pending}
      />
      <button
        type="button"
        onClick={() => onSubmit(text)}
        disabled={pending || !text.trim()}
        className="px-2 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs disabled:opacity-40"
      >
        Upload pasted text
      </button>
    </div>
  );
}
