'use client';

// The paste area of /pop/raid/me: pick a character, then paste what the Flag Seer says (the existing
// SeerPaste box, unchanged apart from opening at once and telling us when it saved) or the output of #popflags
// (PopFlagsPaste, read off the server's own command: web/lib/popFlagsPaste.ts). "Sync from my logs" asks the
// member's own Mimic to re-read their recent logs (SyncFromLogs; web/lib/popRescan.ts).
// A save, or a finished sync, refreshes the page so the step lists above show what was just saved.

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import SeerPaste from '@/app/pop/guide/SeerPaste';
import PopFlagsPaste from './PopFlagsPaste';
import SyncFromLogs from './SyncFromLogs';

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
        <SyncFromLogs character={character} onDone={refresh} />
      </div>

      <div role="tablist" aria-label="Where your flags come from" className="mt-3 flex gap-1 border-b border-border">
        <button type="button" role="tab" id="tab-seer" aria-selected={tab === 'seer'} aria-controls="panel-seer"
                onClick={() => setTab('seer')} className={tabCls(tab === 'seer')}>Seer paste</button>
        <button type="button" role="tab" id="tab-popflags" aria-selected={tab === 'popflags'} aria-controls="panel-popflags"
                onClick={() => setTab('popflags')} className={tabCls(tab === 'popflags')}>
          #popflags output
        </button>
      </div>

      {tab === 'seer' ? (
        <div role="tabpanel" id="panel-seer" aria-labelledby="tab-seer" className="mt-3">
          <SeerPaste character={character} onResult={ignore} onSaved={refresh} defaultOpen />
        </div>
      ) : (
        <div role="tabpanel" id="panel-popflags" aria-labelledby="tab-popflags" className="mt-3" data-slot="popflags-output">
          <PopFlagsPaste characters={chars.map(c => c.name)} character={character} onSaved={refresh} />
        </div>
      )}
    </section>
  );
}
