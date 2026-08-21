'use client';

// Submit a spellbook from the PoP page (Hitya 2026-08-20: "Allow people to
// submit their spellbook as well on that page to add them to that").
//
// Reuses the /me uploader and its server action verbatim — same parse, same
// ownership gate — with a character picker in front, since the PoP page is not
// scoped to one character the way /me/<char> is.

import { useState } from 'react';
import SpellbookUpload from '../me/SpellbookUpload';

export default function SpellbookSubmit({ characters }: { characters: string[] }) {
  const [who, setWho] = useState<string>(characters[0] ?? '');
  if (characters.length === 0) {
    return (
      <p className="text-xs text-dim">
        No characters linked to your account yet — an officer sets that on /admin/links.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-dim">Submit a spellbook for</span>
      <select
        value={who}
        onChange={e => setWho(e.target.value)}
        className="bg-bg border border-border rounded px-2 py-1 text-text"
      >
        {characters.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      {who && <SpellbookUpload key={who} character={who} />}
    </div>
  );
}
