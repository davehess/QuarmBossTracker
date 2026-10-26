'use client';

// "Paste your #popflags" for the member's own character. Drop-in: it needs only the member's character names.
//
//   <PopFlagsPaste characters={['Aldenmar', 'Brackwyn']} defaultCharacter="Aldenmar" onSaved={() => router.refresh()} />
//
// The paste is read in the browser (web/lib/popFlagsPaste.ts), so nothing leaves the page until "Read and save",
// and that sends only the recognised lines to savePopFlagsPaste (./popflagsActions.ts), which reads them again and
// checks the character is on the signed-in member's account. The member sees what was found, by step label, before
// they save and again after.

import { useDeferredValue, useMemo, useState, useTransition } from 'react';
import { SECTIONS, parsePopFlags } from '@/lib/popFlagsPaste';
import { savePopFlagsPaste } from './popflagsActions';

export type PopFlagsPasteProps = {
  /** The signed-in member's own character names (the picker offers exactly these). */
  characters: string[];
  /** Preselected character, if the page knows which one the member is looking at. */
  defaultCharacter?: string | null;
  /** When the page already has a character picker, pass its value here: the picker below is hidden and this one is used. */
  character?: string | null;
  /** Called after a save that wrote something, so the page can refresh its own data. */
  onSaved?: (r: { character: string; written: number; already: number }) => void;
};

export default function PopFlagsPaste({ characters, defaultCharacter = null, character: picked, onSaved }: PopFlagsPasteProps) {
  const [text, setText] = useState('');
  const [own, setCharacter] = useState<string>(
    defaultCharacter && characters.includes(defaultCharacter) ? defaultCharacter : (characters[0] ?? ''));
  const controlled = picked !== undefined;
  const character = controlled ? (picked ?? '') : own;
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, startSave] = useTransition();

  const deferred = useDeferredValue(text);
  const parsed = useMemo(() => (deferred.trim() ? parsePopFlags(deferred) : null), [deferred]);

  const byZone = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of parsed?.found ?? []) m.set(f.zone, [...(m.get(f.zone) ?? []), f.label]);
    return [...m.entries()];
  }, [parsed]);
  const missingSections = parsed ? SECTIONS.filter(s => !parsed.sections.includes(s.title)) : [];

  function save() {
    if (!character || !parsed || parsed.flags.length === 0) return;
    const lines = parsed.used;
    startSave(async () => {
      const res = await savePopFlagsPaste(character, lines);
      if (!res.ok) { setStatus({ ok: false, msg: res.error }); return; }
      setStatus({
        ok: true,
        msg: res.written > 0
          ? `Saved ${res.written} flag${res.written === 1 ? '' : 's'} for ${character}${res.already ? ` (${res.already} were already saved)` : ''}.`
          : `Nothing new: all ${res.already} are already saved for ${character}.`,
      });
      if (res.written > 0) onSaved?.({ character, written: res.written, already: res.already });
    });
  }

  return (
    <section className="bg-panel border border-border rounded-lg p-3 flex flex-col gap-3 text-sm" aria-label="Paste your #popflags">
      <div>
        <h3 className="font-semibold text-text">Paste your #popflags</h3>
        <p className="text-xs text-dim mt-1">
          In game, run <code className="font-mono text-text">#popflags</code> and then{' '}
          <code className="font-mono text-text">#popflags 1</code>, <code className="font-mono text-text">#popflags 2</code>,{' '}
          <code className="font-mono text-text">#popflags 3</code>, <code className="font-mono text-text">#popflags 4</code> and{' '}
          <code className="font-mono text-text">#popflags 5</code>. Copy the lines from your chat window or your EQ log (with or
          without the time at the front) and paste them all here. Read in your browser; nothing is kept unless you save.
        </p>
      </div>

      {!controlled && (
        <label className="flex flex-wrap items-center gap-2 text-xs text-dim">
          <span>Character</span>
          <select value={character} onChange={e => { setCharacter(e.target.value); setStatus(null); }}
                  className="bg-bg border border-border rounded px-2 py-1 text-text">
            {characters.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="sr-only">What #popflags printed</span>
        <textarea value={text} onChange={e => { setText(e.target.value); setStatus(null); }} rows={8} maxLength={60000}
                  placeholder="[Mon Oct 26 21:10:01 2026] === Planes of Power Progression ==="
                  className="w-full bg-bg border border-border rounded p-2 text-text font-mono text-xs focus:outline focus:outline-2 focus:outline-blue" />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save}
                disabled={!character || saving || !parsed || parsed.flags.length === 0}
                className="px-3 py-1.5 rounded border border-green text-green hover:bg-green/10 disabled:opacity-40 disabled:cursor-default">
          {saving ? 'Saving…' : 'Read and save'}
        </button>
        <span className="text-xs text-dim">
          {controlled ? `Saves for ${character || 'the character you picked'}.` : 'Saves for the character picked above.'} Your own characters only.
        </span>
      </div>
      {status && <p role="status" className={`text-xs ${status.ok ? 'text-green' : 'text-red'}`}>{status.msg}</p>}

      {parsed && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {parsed.flags.length === 0 ? (
            <p className="text-orange text-xs">
              No #popflags line we can read in that ({parsed.lines} line{parsed.lines === 1 ? '' : 's'}). Run the command in game and copy
              what it prints.
            </p>
          ) : (
            <>
              <p className="text-xs text-dim">
                Read {parsed.lines} line{parsed.lines === 1 ? '' : 's'}: <b className="text-text">{parsed.flags.length}</b> step
                {parsed.flags.length === 1 ? '' : 's'} found.
              </p>
              <ul className="flex flex-col gap-1 text-xs">
                {byZone.map(([zone, labels]) => (
                  <li key={zone}>
                    <span className="text-text">{zone}</span>
                    <span className="text-dim">: {labels.join('; ')}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {missingSections.length > 0 && (
            <p className="text-xs text-dim">
              Not in your paste yet: {missingSections.map(s => `${s.command} (${s.tier})`).join(', ')}. Run those too for the full picture.
            </p>
          )}

          {parsed.unproven.length > 0 && (
            <p className="text-xs text-orange">
              {parsed.unproven.length} &ldquo;Complete&rdquo; line{parsed.unproven.length === 1 ? '' : 's'} not counted: the server also
              prints Complete for anyone holding the Plane of Time flag, and your paste does not say whether you do. Include{' '}
              <code className="font-mono">#popflags</code> or <code className="font-mono">#popflags 5</code> to settle it.
            </p>
          )}

          {parsed.noKey.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-dim">Read but not tracked here ({parsed.noKey.length})</summary>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-dim break-words">
                {parsed.noKey.map(l => <li key={l}>{l}</li>)}
              </ul>
            </details>
          )}

          {parsed.unknown.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-dim">Lines we did not recognise ({parsed.unknown.length})</summary>
              <p className="text-dim mt-1">
                Anything here might be new wording from a server update:{' '}
                <a href="/feedback" className="text-blue hover:underline">tell us on feedback</a> and paste it.
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-dim break-words">
                {parsed.unknown.map(l => <li key={l}>{l}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
