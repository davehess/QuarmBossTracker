'use client';

import { useState } from 'react';
import { maskAccount } from '@/lib/maskAccount';

// A game-account name shown as ab***89 until clicked. Per-button state, not persisted.
export default function MaskedAccount({ name }: { name: string }) {
  const [shown, setShown] = useState(false);
  const tip = shown ? 'Hide account name' : 'Show account name';
  return (
    <button
      type="button"
      onClick={() => setShown(s => !s)}
      aria-pressed={shown}
      aria-label={tip}
      title={tip}
      className="inline-block text-left font-mono cursor-pointer underline decoration-dotted underline-offset-2 hover:text-gold"
      style={{ minWidth: `${Array.from(name).length}ch` }}
    >
      {shown ? name : maskAccount(name)}
    </button>
  );
}
