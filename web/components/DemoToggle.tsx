// Toggle the demo / obfuscation cookie. Server-action form posts to itself
// with the desired new state. Rendered in the header next to AuthBadge so
// it's one click away on every page.
//
// When on, the site swaps real character names for class-appropriate
// fictional ones (Legolas for Rangers, Gandalf for Wizards, Bruce Lee for
// Monks, etc.) — see web/lib/obfuscate.ts for the pools and mapping logic.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

export default function DemoToggle() {
  const mode = cookies().get('demo_mode')?.value === '1' ? 'on' : 'off';

  async function toggle() {
    'use server';
    const cur = cookies().get('demo_mode')?.value === '1';
    cookies().set('demo_mode', cur ? '0' : '1', {
      // 1-year max age — survives Vercel revalidations + Discord OAuth
      // redirects. HttpOnly off because we want the server to see it on
      // every request without needing JS.
      maxAge: 365 * 24 * 60 * 60,
      path: '/',
      sameSite: 'lax',
    });
    revalidatePath('/');
  }

  return (
    <form action={toggle}>
      <button
        type="submit"
        title={mode === 'on'
          ? 'Demo mode: ON — character names replaced with fictional ones. Click to turn off.'
          : 'Demo mode: OFF — real character names showing. Click to obfuscate for screenshots.'}
        className={[
          'px-2 py-1.5 rounded border text-xs whitespace-nowrap transition-colors',
          mode === 'on'
            ? 'border-purple bg-[#8957e533] text-purple'
            : 'border-border bg-panel text-dim hover:text-text hover:border-blue',
        ].join(' ')}
      >
        🎭 {mode === 'on' ? 'Demo' : 'Demo'}
      </button>
    </form>
  );
}
