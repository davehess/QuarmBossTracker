'use client';

// Per-character self-serve toggles for exclude_from_stats / exclude_inventory.
// Sits in the section header on /me; flipping a toggle fires the server action
// which verifies ownership, writes characters.<flag>, and revalidates the page.
//
// Disabled state during the action so a rapid double-click can't fire twice.
// The visible "OFF/ON" word reads more clearly than just a checkbox.

import { useTransition, useState } from 'react';
import { setCharacterExclusion } from './actions';

type Flag = 'exclude_from_stats' | 'exclude_inventory';

export default function ExclusionToggles({
  character,
  excludeFromStats,
  excludeInventory,
}: {
  character: string;
  excludeFromStats: boolean;
  excludeInventory: boolean;
}) {
  const [stats, setStats]         = useState(excludeFromStats);
  const [inventory, setInventory] = useState(excludeInventory);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const flip = (flag: Flag, next: boolean, setLocal: (b: boolean) => void) => {
    setErr(null);
    const previous = flag === 'exclude_from_stats' ? stats : inventory;
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
      <div className="flex items-center gap-2">
        <Toggle
          label="Stats"
          on={stats}
          disabled={pending}
          tooltip="Exclude from stats: agent stops uploading for this character, and stats are hidden from /me. Privacy is one-way — turn it back on any time."
          onChange={(next) => flip('exclude_from_stats', next, setStats)}
        />
        <Toggle
          label="Inventory"
          on={inventory}
          disabled={pending}
          tooltip="Exclude inventory: don't catalog this character's bank/inventory. Currently the agent has no inventory upload path, so this is a forward-looking flag the agent will honor when Mimic's inventory feature lands."
          onChange={(next) => flip('exclude_inventory', next, setInventory)}
        />
      </div>
      {err && <div className="text-red-400">{err}</div>}
    </div>
  );
}

function Toggle({
  label, on, disabled, onChange, tooltip,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  tooltip?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={tooltip}
      onClick={() => onChange(!on)}
      className={`px-2 py-0.5 rounded border font-mono cursor-help disabled:opacity-50 ${
        on
          ? 'bg-orange/20 text-orange border-orange/40'
          : 'bg-bg text-dim border-border hover:text-text'
      }`}
    >
      {label}: {on ? 'EXCLUDED' : 'on'}
    </button>
  );
}
