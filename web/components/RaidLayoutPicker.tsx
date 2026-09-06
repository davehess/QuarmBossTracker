'use client';
// RaidLayoutPicker — the Strips / Blocks switch on /me and /raidhistory.
//
// Writes the wp_raid_layout cookie (a year, SameSite=Lax, same attributes as
// the timezone picker) and re-renders the page from the server, dropping any
// `?layout=` from the address so the cookie is what the page reads next.
// No local state: the server is the source of truth for which layout is on,
// and `current` comes from it.

import { useRouter } from 'next/navigation';
import { RAID_LAYOUTS, RAID_LAYOUT_COOKIE, type RaidLayout } from '@/lib/raidLayout';

export default function RaidLayoutPicker({ current }: { current: RaidLayout }) {
  const router = useRouter();
  const choose = (v: RaidLayout) => {
    if (v === current) return;
    document.cookie = `${RAID_LAYOUT_COOKIE}=${v}; path=/; max-age=31536000; SameSite=Lax`;
    const url = new URL(window.location.href);
    url.searchParams.delete('layout');
    router.replace(url.pathname + url.search);
    router.refresh();
  };
  return (
    <div role="group" aria-label="Attendance layout" className="inline-flex rounded border border-border overflow-hidden text-[11px]">
      {RAID_LAYOUTS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          aria-pressed={key === current}
          onClick={() => choose(key)}
          className={`px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue ${
            key === current ? 'bg-accent text-white' : 'bg-panel text-dim hover:text-text hover:bg-[#21262d]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
