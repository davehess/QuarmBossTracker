'use client';

// Per-user TZ picker. Writes a cookie (wp_tz) the server reads via
// next/headers; the picker also stores the same value in localStorage so
// 'auto' can resolve to the browser's real zone immediately.
//
// 'auto' is the recommended default ("from this device") — when the cookie
// resolves to 'auto' server-side, it falls back to America/New_York (EST/EDT),
// which is what most of the guild is on. Members elsewhere flip once and
// every page renders in their wall clock thereafter.

import { useEffect, useState } from 'react';
import { TZ_CHOICES, TZ_COOKIE } from '@/lib/timezone-shared';
import { ClockFace } from './HeaderIcons';

// "make the time a clock and the 3 character abbreviation for the time zone"
// (Hitya, 2026-08-28). A <select> can only display its own option text, so the
// native control stays — it is still the focusable, labelled, OS-rendered
// picker — and is laid transparent over the clock+abbreviation that replaces
// its face. Nothing about choosing a zone changes; only what it reads as.
function abbreviate(zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch { return ''; }
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  // 1 year, root path, lax so it survives auth redirects.
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

export default function TimezonePicker() {
  const [tz, setTz]           = useState<string>('America/New_York');
  const [browserTz, setBrowserTz] = useState<string>('');

  useEffect(() => {
    const stored = getCookie(TZ_COOKIE) || 'auto';
    setTz(stored);
    try { setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* */ }
  }, []);

  const onChange = (next: string) => {
    setTz(next);
    // For 'auto' on the client we also write the resolved browser TZ so the
    // server (which can't read window) renders in the user's actual zone.
    const cookieValue = next === 'auto' && browserTz ? browserTz : next;
    setCookie(TZ_COOKIE, cookieValue);
    // Server-rendered pages need a refresh to pick up the new cookie.
    if (typeof window !== 'undefined') window.location.reload();
  };

  // Zones only resolve on the client, and `new Date()` differs between a server
  // render and a client one across a DST edge — so the abbreviation is rendered
  // only once mounted, and the server and first client render agree on the
  // placeholder.
  const zone = tz === 'auto' ? (browserTz || 'America/New_York') : tz;
  const abbr = browserTz || tz !== 'America/New_York' ? abbreviate(zone) : '';

  return (
    <label
      className="relative inline-flex items-center gap-1 rounded border border-border bg-panel
                 px-2 py-1 text-[11px] text-text transition-colors hover:bg-[#21262d]"
      title="Timezone for all displayed times. Defaults to Eastern (most of the pack). 'Auto' picks up your device's zone."
    >
      <ClockFace className="text-dim" />
      <span className="font-mono tabular-nums">{abbr || '\u00b7\u00b7\u00b7'}</span>
      {/* The real control, kept native and kept focusable — laid over the face
          above rather than replaced by it, so the OS picker, the keyboard and
          the accessible name all still work. */}
      <select
        aria-label="Timezone for all displayed times"
        value={tz}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {TZ_CHOICES.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
    </label>
  );
}
