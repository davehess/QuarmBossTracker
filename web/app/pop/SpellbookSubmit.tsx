'use client';

// Submit a spellbook from the PoP page (the guild lead, 2026-08-20: "Allow people to
// submit their spellbook as well on that page to add them to that").
//
// Reuses the /me uploader and its server action verbatim — same parse, same
// ownership gate — with a character picker in front, since the PoP page is not
// scoped to one character the way /me/<char> is.
//
// The picker takes EVERY character the viewer owns, grouped (the guild lead, 2026-10-03: "put any
// unknown characters into a minimized area"): the listed ones are the main options, the rest sit in
// optgroups under them. An upload is how an unknown character gets a level, so the lists the page
// filters must never decide who can be uploaded for. The row shrinks (min-w-0 / max-w-full) because it
// sits in a flex-wrap header: at phone width a select that will not shrink pushes the whole page sideways.

import { useState } from 'react';
import SpellbookUpload from '../me/SpellbookUpload';

export default function SpellbookSubmit({ listed, unknown, hidden }: { listed: string[]; unknown: string[]; hidden: string[] }) {
  const [who, setWho] = useState<string>(listed[0] ?? unknown[0] ?? hidden[0] ?? '');
  if (listed.length + unknown.length + hidden.length === 0) {
    return (
      <p className="text-xs text-dim">
        No characters linked to your account yet — an officer sets that on /admin/links.
      </p>
    );
  }
  const opts = (names: string[]) => names.map(c => <option key={c} value={c}>{c}</option>);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs min-w-0 max-w-full">
      <span className="text-dim">Submit a spellbook for</span>
      <select
        value={who}
        onChange={e => setWho(e.target.value)}
        className="bg-bg border border-border rounded px-2 py-1 text-text min-w-0 max-w-full"
      >
        {opts(listed)}
        {unknown.length > 0 && <optgroup label="No known level">{opts(unknown)}</optgroup>}
        {hidden.length > 0 && <optgroup label="Hidden (traders, under 46, hidden by you)">{opts(hidden)}</optgroup>}
      </select>
      {who && <SpellbookUpload key={who} character={who} />}
    </div>
  );
}
