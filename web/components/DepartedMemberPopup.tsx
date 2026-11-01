'use client';
// Officer-only pop-up: members who left or were removed from the Discord and still have a way in (the guild lead,
// 2026-11-01). Rendered by DepartedMemberNotice, which has already checked the viewer is an officer. Each person
// can be locked out in one click (lockMember with a fixed reason); "Dismiss" hides the current departures in this
// browser only (localStorage, per departure, so a NEW departure shows again).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { lockMember } from '@/app/admin/access/actions';
import type { Departed } from '@/lib/departedMembers';

const KEY = 'wp_departed_dismissed';
const REASON = 'Left or removed from the Discord';
// Per person, not per stamp: the member sync re-stamps refreshed_at every 6 hours, so a time-keyed dismissal would reappear.
const stamp = (d: Departed) => d.discordId;

function readDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}

export default function DepartedMemberPopup({ items }: { items: Departed[] }) {
  const [hidden, setHidden] = useState<string[] | null>(null);   // null until mounted: no flash, no hydration mismatch
  useEffect(() => { setHidden(readDismissed()); }, []);
  if (hidden === null) return null;
  const shown = items.filter(d => !hidden.includes(stamp(d)));
  if (!shown.length) return null;

  const dismiss = () => {
    const next = Array.from(new Set([...hidden, ...items.map(stamp)])).slice(-200);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window: hides until reload */ }
    setHidden(next);
  };

  return (
    <div role="alert" className="fixed inset-x-4 bottom-4 z-50 ml-auto max-w-md rounded-lg border border-red/60 bg-panel p-4 shadow-xl sm:left-auto">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm font-semibold text-red">
          {shown.length} member{shown.length === 1 ? '' : 's'} left the Discord and still {shown.length === 1 ? 'has' : 'have'} access
        </p>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="px-1 text-dim hover:text-text">✕</button>
      </div>
      <ul className="mt-3 space-y-2">
        {shown.map(d => (
          <li key={d.discordId} className="flex items-center gap-3 border-t border-border/40 pt-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-text">{d.name}</span>
              <span className="block text-xs text-dim">
                not in the Discord · {[d.hasLogin && 'website login', d.liveMimic && 'live Mimic'].filter(Boolean).join(' + ')}
              </span>
            </span>
            <form action={lockMember}>
              <input type="hidden" name="discord_id" value={d.discordId} />
              <input type="hidden" name="reason" value={REASON} />
              <button type="submit" className="rounded bg-red/80 px-3 py-1.5 text-xs text-white hover:bg-red">Lock out</button>
            </form>
          </li>
        ))}
      </ul>
      <Link href="/admin/access" className="mt-3 inline-block text-xs text-blue hover:underline">Review on Access page →</Link>
    </div>
  );
}
