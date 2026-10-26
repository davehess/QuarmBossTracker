'use client';

// The paste area of /pop/raid/me: pick a character, then paste what the Flag Seer says (the existing
// SeerPaste box, unchanged apart from opening at once and telling us when it saved) or, soon, the output
// of #popflags. Two slots are left on purpose and are NOT wired:
//   - the "#popflags output" tab: its format is being researched, and its parser will be added after. Nothing
//     here guesses at the in-game text;
//   - "Sync from my logs": the way to read the flags straight from the player's logs is being researched.
// A save refreshes the page so the step lists above show what was just saved.

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import SeerPaste from '@/app/pop/guide/SeerPaste';

type Tab = 'seer' | 'popflags';

export default function MeTools({ chars, initial }: { chars: { name: string; cls: string | null }[]; initial: string | null }) {
  const router = useRouter();
  const [character, setCharacter] = useState<string | null>(initial ?? chars[0]?.name ?? null);
  const [tab, setTab] = useState<Tab>('seer');
  // SeerPaste reports what the paste shows (not saved) through this; the step lists here read saved flags only.
  const ignore = useCallback(() => {}, []);
  const refresh = useCallback(() => router.refresh(), [router]);

  const tabCls = (on: boolean) =>
    `px-3 py-1.5 text-sm border-b-2 ${on ? 'border-gold text-gold' : 'border-transparent text-dim hover:text-text'}`;

  return (
    <section id="seer-paste" className="mt-6 scroll-mt-4 rounded-lg border border-border bg-panel p-3">
      <h2 className="text-sm font-semibold text-text">Fix my flags</h2>
      <p className="mt-1 text-xs text-dim">
        Paste what the Flag Seer says and the steps above catch up. Nothing leaves your browser until you save.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-dim">
          For
          <select value={character ?? ''} onChange={e => setCharacter(e.target.value || null)}
                  className="rounded border border-border bg-bg px-2 py-1 text-sm text-text focus:outline focus:outline-2 focus:outline-blue">
            {chars.map(c => <option key={c.name} value={c.name}>{c.name}{c.cls ? ` (${c.cls})` : ''}</option>)}
          </select>
        </label>
        <button type="button" disabled title="Coming next: read your flags straight from your logs"
                className="rounded border border-border px-3 py-1.5 text-sm text-dim opacity-50 cursor-default">
          Sync from my logs
          <span className="ml-1.5 text-[10px] uppercase tracking-wide">coming next</span>
        </button>
      </div>

      <div role="tablist" aria-label="Where your flags come from" className="mt-3 flex gap-1 border-b border-border">
        <button type="button" role="tab" id="tab-seer" aria-selected={tab === 'seer'} aria-controls="panel-seer"
                onClick={() => setTab('seer')} className={tabCls(tab === 'seer')}>Seer paste</button>
        <button type="button" role="tab" id="tab-popflags" aria-selected={tab === 'popflags'} aria-controls="panel-popflags"
                onClick={() => setTab('popflags')} className={tabCls(tab === 'popflags')}>
          #popflags output <span className="ml-1 text-[10px] uppercase tracking-wide text-orange">soon</span>
        </button>
      </div>

      {tab === 'seer' ? (
        <div role="tabpanel" id="panel-seer" aria-labelledby="tab-seer" className="mt-3">
          <SeerPaste character={character} onResult={ignore} onSaved={refresh} defaultOpen />
        </div>
      ) : (
        <div role="tabpanel" id="panel-popflags" aria-labelledby="tab-popflags" className="mt-3" data-slot="popflags-output">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-dim">#popflags output</span>
            <textarea disabled rows={6} placeholder="Not wired yet. This box will read the #popflags output once we know its format."
                      className="w-full rounded border border-border bg-bg p-2 font-mono text-xs text-text opacity-50" />
          </label>
          <button type="button" disabled title="Coming next"
                  className="mt-2 rounded border border-gold px-3 py-1.5 text-sm text-gold opacity-40 cursor-default">
            Check my flags
          </button>
          <p className="mt-2 text-xs text-dim">Coming next. For now, use the Seer paste tab.</p>
        </div>
      )}
    </section>
  );
}
