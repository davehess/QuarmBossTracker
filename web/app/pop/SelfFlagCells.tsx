'use client';

// The cells on /pop that a member can tick for their OWN characters (the guild lead, 2026-10-03: "check
// off their own flags for their own characters outside of using mimic or relying on someone else with
// mimic to do it"). page.tsx renders every table on the server and drops these in only for characters the
// viewer owns; everyone else's cells stay plain marks.
//
// The provider holds the viewer's ticks, because one flag sits in several gates (the Justice flag opens
// Valor AND Storms) and a tick must show in every cell and in the row's count at once. It follows the
// optimistic pattern of the admin lists: flip the state, call the server action in a transition, put it
// back and say why if the save fails. A cell whose every flag Mimic, /who or loot proved is a plain mark, not a
// button: there is nothing of the owner's word to add (web/lib/popGateCell.ts holds that rule, apart from
// popSelfFlags.ts so the browser does not load the guide catalog).

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import { gateState, SELF_TICK_TITLE, type FlagProof, type GateState } from '@/lib/popGateCell';
import { setFlagTicks } from './guide/actions';
import GateMark from './GateMark';

type Ctx = {
  self: (character: string) => ReadonlySet<string>;
  toggle: (character: string, action: 'tick' | 'untick', flags: string[]) => void;
};
const SelfFlags = createContext<Ctx | null>(null);
const NONE: ReadonlySet<string> = new Set();

// `initial`: lower-cased character name → the flags its owner has ticked (only the viewer's own rows).
export function SelfFlagsProvider({ initial, children }: { initial: Record<string, string[]>; children: ReactNode }) {
  const [selfBy, setSelfBy] = useState<Record<string, Set<string>>>(
    () => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, new Set(v)])));
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const apply = (character: string, flags: string[], on: boolean) => setSelfBy(prev => {
    const k = character.toLowerCase();
    const s = new Set(prev[k] ?? []);
    for (const f of flags) { if (on) s.add(f); else s.delete(f); }
    return { ...prev, [k]: s };
  });

  const ctx: Ctx = {
    self: character => selfBy[character.toLowerCase()] ?? NONE,
    toggle(character, action, flags) {
      const on = action === 'tick';
      apply(character, flags, on);
      setError(null);
      start(async () => {
        const res = await setFlagTicks(character, flags, on);
        if (!res.ok) { apply(character, flags, !on); setError(`Could not save ${character}: ${res.error ?? 'unknown error'}`); }
      });
    },
  };

  return (
    <SelfFlags.Provider value={ctx}>
      {error && <p className="text-xs text-red mb-2" role="alert">{error}</p>}
      {children}
    </SelfFlags.Provider>
  );
}

type GateProps = {
  character: string;
  zone: string;                              // the zone's full name, for the label
  requires: { key: string; label: string }[];
  proof: Record<string, FlagProof>;          // the required flags Mimic, /who or loot proved
  proofTitle: string;                        // where /who saw them or they looted, '' when neither did
};

const markOf = (g: GateState) => (g.access && g.mark !== 'none' ? g.mark : null);

export function OwnedGateCell({ character, zone, requires, proof, proofTitle }: GateProps) {
  const ctx = useContext(SelfFlags);
  const g = gateState(requires.map(r => r.key), proof, ctx?.self(character) ?? NONE);
  const names = (keys: string[]) => keys.map(k => requires.find(r => r.key === k)?.label ?? k).join(', ');
  const mark = markOf(g);

  // Everything proven (or no provider): a mark to read, nothing to press.
  if (!ctx || !g.toggle) {
    return mark ? <GateMark kind={mark} title={proofTitle || undefined} /> : <span className="text-dim">—</span>;
  }
  const t = g.toggle;
  const held = [g.selfFlags.length > 0 ? `${SELF_TICK_TITLE}: ${names(g.selfFlags)}.` : '', proofTitle].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      onClick={() => ctx.toggle(character, t.action, t.flags)}
      aria-pressed={g.access}
      aria-label={`${character}, ${zone} gate (${names(requires.map(r => r.key))}): held on your own word`}
      title={g.access ? `${held} Tap to untick.` : `Missing ${names(g.open)}. Tap to tick it as held, on your own word.`}
      className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded border border-dashed border-border px-1 hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue"
    >
      {mark ? <GateMark kind={mark} /> : <span className="text-dim">—</span>}
    </button>
  );
}

// The row's "Flags" number, live: the flags Mimic and /who hold plus whatever the owner has ticked now.
export function OwnedFlagCount({ character, proven }: { character: string; proven: string[] }) {
  const ctx = useContext(SelfFlags);
  return <>{new Set([...proven, ...(ctx?.self(character) ?? NONE)]).size}</>;
}
