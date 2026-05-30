'use client';

// Per-character self-serve toggles for exclude_from_stats / exclude_inventory
// (both opt-OUT, default participates) and tell_relay (opt-IN, default off).
//
// Sits in the section header on /me; flipping a toggle fires the server
// action which verifies ownership, writes characters.<flag>, and revalidates
// the page. Disabled during the action so a rapid double-click can't fire
// twice. Semantics differ per flag — exclusion toggles read "EXCLUDED"/"on";
// the tell-relay toggle reads "ON"/"off" because the meaning is reversed.

import { useTransition, useState } from 'react';
import { setCharacterExclusion } from './actions';

type Flag = 'exclude_from_stats' | 'exclude_inventory' | 'tell_relay';

export default function ExclusionToggles({
  character,
  excludeFromStats,
  excludeInventory,
  tellRelay,
}: {
  character: string;
  excludeFromStats: boolean;
  excludeInventory: boolean;
  tellRelay: boolean;
}) {
  const [stats, setStats]         = useState(excludeFromStats);
  const [inventory, setInventory] = useState(excludeInventory);
  const [tells, setTells]         = useState(tellRelay);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const flip = (
    flag: Flag,
    next: boolean,
    setLocal: (b: boolean) => void,
    previous: boolean,
  ) => {
    setErr(null);
    setLocal(next);                    // optimistic
    startTransition(async () => {
      const res = await setCharacterExclusion(character, flag, next);
      if (!res.ok) {
        setLocal(previous);            // revert on failure
        setErr(res.error ?? 'failed');
      }
    });
  };

  return (
    <div className="flex flex-col gap-1 text-[10px]">
      <div className="flex items-center gap-2 flex-wrap">
        <Toggle
          on={stats}
          disabled={pending}
          tooltip="Exclude from stats: agent stops uploading for this character, and stats are hidden from /me. Privacy is one-way — turn it back on any time."
          onLabel="Stats: EXCLUDED"
          offLabel="Stats: on"
          variant="warn-when-on"
          onChange={(next) => flip('exclude_from_stats', next, setStats, stats)}
        />
        <Toggle
          on={inventory}
          disabled={pending}
          tooltip="Exclude inventory: don't catalog this character's bank/inventory. The agent has no inventory upload path yet, so this is a forward-looking flag the agent will honor when Mimic's inventory feature lands."
          onLabel="Inventory: EXCLUDED"
          offLabel="Inventory: on"
          variant="warn-when-on"
          onChange={(next) => flip('exclude_inventory', next, setInventory, inventory)}
        />
        <Toggle
          on={tells}
          disabled={pending}
          tooltip="Tells relay: opt in to forward this character's incoming /tell messages to your /me/tells page + Discord DMs. Default off — your tells stay private until you turn this on. Outgoing tells you send are also stored so /me/tells shows both sides of the conversation. Only you ever see them."
          onLabel="Tells: ON"
          offLabel="Tells: off"
          variant="positive-when-on"
          onChange={(next) => flip('tell_relay', next, setTells, tells)}
        />
      </div>
      {err && <div className="text-red-400">{err}</div>}
    </div>
  );
}

function Toggle({
  on, disabled, onChange, tooltip, onLabel, offLabel, variant,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  tooltip?: string;
  onLabel:  string;
  offLabel: string;
  // Visual signal differs per semantic: an EXCLUDED flag in the "on" position
  // is a privacy ratchet (orange/warning); a tell-relay "ON" is a positive
  // affirmative action (green).
  variant: 'warn-when-on' | 'positive-when-on';
}) {
  const onClass = variant === 'warn-when-on'
    ? 'bg-orange/20 text-orange border-orange/40'
    : 'bg-green/20  text-green  border-green/40';
  return (
    <button
      type="button"
      disabled={disabled}
      title={tooltip}
      onClick={() => onChange(!on)}
      className={`px-2 py-0.5 rounded border font-mono cursor-help disabled:opacity-50 ${
        on ? onClass : 'bg-bg text-dim border-border hover:text-text'
      }`}
    >
      {on ? onLabel : offLabel}
    </button>
  );
}
