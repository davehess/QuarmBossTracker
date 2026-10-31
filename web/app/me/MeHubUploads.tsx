'use client';

// The hub's file-upload spot: the classic /me character header's inventory, keys and spellbook uploads, with a picker
// for which of the member's characters they are for. The three widgets are the classic ones, unchanged; each calls its
// own server action, which checks that the signed-in member owns the character (or is an officer).
//
// A character whose inventory sync the member switched off gets no widgets here: that switch is the member saying the
// site should not hold that character's inventory, and an upload would put one there. The switch is under "Your
// account" and the classic card.

import { useState } from 'react';
import InventoryUpload from './InventoryUpload';
import KeysUpload from './KeysUpload';
import SpellbookUpload from './SpellbookUpload';

export default function MeHubUploads({ chars, initial }: { chars: { name: string; excludeInventory: boolean }[]; initial: string }) {
  const [name, setName] = useState(chars.some(c => c.name === initial) ? initial : chars[0].name);
  const picked = chars.find(c => c.name === name) ?? chars[0];
  return (
    <div className="space-y-2">
      {chars.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-dim">
          For
          <select
            value={picked.name}
            onChange={e => setName(e.target.value)}
            className="min-h-[36px] rounded border border-border bg-bg px-2 text-xs text-text"
          >
            {chars.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </label>
      )}
      {picked.excludeInventory ? (
        <p className="text-xs text-dim">
          Inventory sync is switched off for {picked.name}, so there is nothing to upload for it. Turn it back on under
          &quot;Your account&quot; to upload.
        </p>
      ) : (
        <div key={picked.name} className="flex flex-wrap items-start gap-2">
          <InventoryUpload character={picked.name} />
          <KeysUpload character={picked.name} />
          <SpellbookUpload character={picked.name} />
        </div>
      )}
    </div>
  );
}
