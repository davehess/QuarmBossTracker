'use client';

// The search box on /me/wishlist: type part of an item's name, see up to twenty items, add one to a character's
// wishlist. Each hit carries the same control the item page uses (components/WishlistControls.tsx), collapsed to
// one button until it is pressed. The search itself only reads the catalog (actions.ts); every write goes through
// the three actions the control already calls.
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ItemIcon } from '@/components/ItemIcon';
import WishlistControls from '@/components/WishlistControls';
import { decodeSlots } from '@/lib/itemDecode';
import { SEARCH_MAX } from '@/lib/wishlistSearch';
import type { WishState } from '@/lib/wishlistPick';
import { searchItems, type FoundItem } from './actions';

type Found = { run: number; term: string; items: FoundItem[]; states: Record<number, Record<string, WishState>> };

export default function WishlistSearch(p: { characters: string[]; defaultCharacter: string | null; enabled: boolean }) {
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const asked = term;
    const n = run + 1;
    setRun(n);
    start(async () => {
      const r = await searchItems(asked);
      if (!r.ok) { setError(r.error); return; }
      setFound({ run: n, term: asked.trim(), items: r.items, states: r.states });
    });
  };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2" role="search">
        <div>
          <label htmlFor="wl-search" className="block text-[11px] text-dim mb-0.5">Find an item by name</label>
          <input
            id="wl-search" type="search" autoComplete="off" maxLength={SEARCH_MAX} value={term}
            onChange={e => setTerm(e.target.value)} placeholder="Cloak of Flames"
            className="bg-bg border border-border rounded px-2 py-1.5 sm:py-1 text-text text-sm w-64 max-w-full"
          />
        </div>
        <button type="submit" disabled={pending} className="px-3 py-2 sm:py-1 text-sm rounded border border-border bg-bg text-blue hover:underline disabled:opacity-50">
          {pending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p role="alert" className="text-xs text-red">{error}</p>}

      {found && (
        found.items.length === 0 ? (
          <p className="text-sm text-dim">No item name has &ldquo;{found.term}&rdquo; in it.</p>
        ) : (
          <div>
            <p className="text-[11px] text-dim mb-1">
              {found.items.length} shown, names starting with &ldquo;{found.term}&rdquo; first. Narrow the name if yours is not here.
            </p>
            <ul className="divide-y divide-border/60 rounded border border-border bg-bg">
              {found.items.map(it => (
                <li key={`${found.run}-${it.id}`} className="p-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <ItemIcon icon={it.icon} size={20} className="shrink-0" />
                    <Link href={`/db/item/${it.id}`} className="text-blue hover:underline text-sm">{it.name}</Link>
                    <span className="text-[11px] text-dim">{decodeSlots(it.slots)} · #{it.id}</span>
                  </div>
                  <WishlistControls
                    compact itemId={it.id} itemName={it.name} enabled={p.enabled}
                    characters={p.characters} defaultCharacter={p.defaultCharacter}
                    states={found.states[it.id] ?? {}}
                  />
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}
