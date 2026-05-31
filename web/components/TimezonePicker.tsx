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

  return (
    <label className="inline-flex items-center gap-1.5 text-[11px] text-dim" title="Timezone for all displayed times. Defaults to Eastern (most of the pack). 'Auto' picks up your device's zone.">
      <span aria-hidden>🕒</span>
      <select
        value={tz}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg border border-border rounded px-1 py-0.5 text-text font-mono text-[10px] cursor-pointer hover:border-dim/80"
      >
        {TZ_CHOICES.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
    </label>
  );
}
