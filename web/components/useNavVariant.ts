'use client';
import { useEffect, useState } from 'react';
import { cookieFor, resolveVariant, type NavVariant } from '../lib/navVariant';

// Beta-only nav preview switch. NEXT_PUBLIC_IS_BETA is a build-time constant, so production
// never leaves null. Read in an effect so no page is made dynamic.
export function useNavVariant(): NavVariant | null {
  const [v, setV] = useState<NavVariant | null>(null);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_IS_BETA !== '1') return;
    let cookie = '';
    try { cookie = document.cookie; } catch { /* cookies blocked */ }
    const next = resolveVariant(true, window.location.search, cookie);
    if (new URLSearchParams(window.location.search).get('nav') !== null) {
      try { document.cookie = cookieFor(next); } catch { /* cookies blocked */ }
    }
    setV(next);
  }, []);
  return v;
}
