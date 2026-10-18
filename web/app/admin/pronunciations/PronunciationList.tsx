'use client';

// The /admin/pronunciations list: every saved pronunciation as an editable row, plus an "add one" box that
// takes any character name from the roster. Optimistic local state, no router.refresh() (the officer list
// pattern): a row that is cleared drops out, one that is added joins the top, and revalidatePath in the
// actions keeps other sessions fresh.

import { useState } from 'react';
import PronunciationRow from '@/components/PronunciationRow';
import { savePronunciation, clearPronunciation } from './actions';
import type { PronEntry } from '@/lib/pronunciations';

export default function PronunciationList({ initial, names }: { initial: PronEntry[]; names: string[] }) {
  const [entries, setEntries] = useState(initial);
  const [query, setQuery] = useState('');

  const typed = query.trim().toLowerCase();
  const match = typed ? names.find(n => n.toLowerCase() === typed) : undefined;
  const already = match ? entries.some(e => e.name.toLowerCase() === match.toLowerCase()) : false;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-panel p-4">
        <h2 className="mb-2 text-sm text-gold">Set one for any character</h2>
        <input
          list="pron-character-names"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="start typing a character name"
          aria-label="Character name"
          className="w-full max-w-sm rounded border border-border bg-bg px-2 py-1 text-sm text-text placeholder:text-dim"
        />
        <datalist id="pron-character-names">
          {names.map(n => <option key={n} value={n} />)}
        </datalist>
        {typed && !match && <p className="mt-2 text-xs text-dim">No character by that name in the roster yet.</p>}
        {match && already && <p className="mt-2 text-xs text-dim">{match} already has one. Edit it in the list below.</p>}
        {match && !already && (
          <ul className="mt-3">
            <PronunciationRow
              key={match}
              name={match}
              initialSay={null}
              save={savePronunciation}
              clear={clearPronunciation}
              meta={{ setBy: null, updatedAt: null }}
              onChange={(say, at) => {
                if (!say) return;
                setEntries(es => [{ name: match, say, setBy: 'you', updatedAt: at }, ...es.filter(e => e.name !== match)]);
                setQuery('');
              }}
            />
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm text-gold">Saved <span className="text-dim">({entries.length})</span></h2>
        {entries.length === 0 ? (
          <p className="rounded border border-border bg-panel p-4 text-sm text-dim">Nobody has set one yet.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map(e => (
              <PronunciationRow
                key={e.name}
                name={e.name}
                initialSay={e.say}
                save={savePronunciation}
                clear={clearPronunciation}
                meta={{ setBy: e.setBy, updatedAt: e.updatedAt }}
                onChange={say => { if (!say) setEntries(es => es.filter(x => x.name !== e.name)); }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
