// The frame every demo page shares: the "[beta] Demo" bar, the guild name, one nav, and the two ways out (back to Raid
// Mimic, and the interest form). A server component with no state and no data: the guild lead's 2026-11-02 rule is
// "without killing the resources". On a raidmimic host the middleware rewrites /demo/... before any session work and the
// root layout gives the bare shell without a session or database read (web/app/layout.tsx), so a view costs one render
// and nothing else. It is NOT `force-static`: a static page cannot see the host, so the root layout would bake the Wolf
// Pack header into it.
//
// Links follow the host: raidmimic.com/demo/... there (the short form, rewritten by raidmimicLandingTarget), and
// /raidmimic/demo/... on the wolfpack.quest hosts, where /demo does not exist. The two exits are absolute raidmimic.com
// addresses, because the interest form is only served at the root of the raidmimic hosts.
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { DEMO_BAR, GUILD } from '@/lib/demoGuild';
import { isRaidmimicHost, RAIDMIMIC_DEMO_PATH } from '@/lib/raidmimicHost';
import HostFrame from '@/components/RaidmimicFrame';

export const RAIDMIMIC_HOME = 'https://raidmimic.com';
export const RAIDMIMIC_REGISTER = 'https://raidmimic.com/register';

const onRaidmimic = (): boolean => isRaidmimicHost(headers().get('host'));

/** Where the demo's links start: /demo on a raidmimic host, /raidmimic/demo anywhere else. */
export function demoBase(): string {
  return onRaidmimic() ? '/demo' : RAIDMIMIC_DEMO_PATH;
}

export type DemoPage = 'home' | 'flags' | 'capture' | 'events' | 'needs' | 'raid';

const NAV: { id: DemoPage; label: string; path: string; tag?: string }[] = [
  { id: 'home', label: 'Guild home', path: '' },
  { id: 'flags', label: 'Flags', path: '/flags' },
  { id: 'capture', label: 'Record for others', path: '/capture' },
  { id: 'events', label: 'Events', path: '/events', tag: 'A' },
  { id: 'needs', label: 'Needs board', path: '/events/needs', tag: 'B' },
  { id: 'raid', label: 'Tonight', path: '/raid' },
];

export const PANEL = 'bg-panel border border-border rounded-lg p-3 min-w-0';
export const BTN = 'inline-flex min-h-9 items-center rounded border border-accent bg-accent/20 px-3 text-xs text-text';
export const BTN_QUIET = 'inline-flex min-h-9 items-center rounded border border-border px-3 text-xs text-dim';

/** A button that looks like the real one and does nothing: no handler, no form, so nothing is sent or saved. */
export function DemoButton({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return <button type="button" aria-disabled="true" title="Demo: nothing happens" className={`${quiet ? BTN_QUIET : BTN} cursor-default`}>{children}</button>;
}

export default function DemoShell({ active, title, lead, children }: { active: DemoPage; title: string; lead: string; children: ReactNode }) {
  const base = demoBase();
  return (
    <HostFrame onHost={onRaidmimic()} width="max-w-5xl">
    <div className="mx-auto max-w-5xl pb-12">
      <div role="note" className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-orange/50 bg-orange/10 px-3 py-1.5 text-xs text-orange">
        <b className="tracking-wider">{DEMO_BAR}</b>
        <span className="ml-auto flex flex-wrap gap-x-3">
          <a href={RAIDMIMIC_HOME} className="underline hover:text-text">raidmimic.com</a>
          <a href={RAIDMIMIC_REGISTER} className="underline hover:text-text">Get this for your guild</a>
        </span>
      </div>

      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-xs uppercase tracking-widest text-gold">Raid Mimic</p>
        <p className="text-sm text-dim">{GUILD.name} <span aria-hidden>·</span> {GUILD.game} <span aria-hidden>·</span> {GUILD.nights}</p>
      </header>

      <nav aria-label="Demo pages" className="mb-5 flex flex-wrap gap-1.5 text-xs">
        {NAV.map(n => (
          <a key={n.id} href={`${base}${n.path}`} aria-current={n.id === active ? 'page' : undefined}
             className={n.id === active
               ? 'inline-flex min-h-9 items-center gap-1.5 rounded border border-accent bg-accent/20 px-3 text-text'
               : 'inline-flex min-h-9 items-center gap-1.5 rounded border border-border px-3 text-dim hover:border-blue hover:text-text'}>
            {n.label}
            {n.tag && <span className="rounded border border-gold/60 px-1 text-[10px] text-gold" title={`Option ${n.tag}`}>{n.tag}</span>}
          </a>
        ))}
      </nav>

      <h1 className="text-2xl leading-tight text-[#f2ede1]">{title}</h1>
      <p className="mt-1 mb-5 max-w-[66ch] text-sm leading-6 text-dim">{lead}</p>

      {children}

      <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-xs text-dim">
        <span>Every raider, guild and number on these pages is invented. Nothing is saved, sent or read from a real guild.</span>
        <a href={RAIDMIMIC_REGISTER} className="ml-auto inline-flex min-h-9 items-center rounded border border-accent bg-accent/20 px-3 text-text no-underline hover:border-blue">Get this for your guild</a>
      </div>
    </div>
    </HostFrame>
  );
}
