// raidmimic.com/demo: the demo guild's home, a raid night at a glance, with a card into every other demo page. No database
// and no session: the only request read is the host, for the links (DemoShell.tsx). Every name and number is invented
// (web/lib/demoGuild.ts).
import type { Metadata } from 'next';
import { CHARS, EVENTS, LAST_RAID, TARGETS, TONIGHT, reportFor, targetByKey } from '@/lib/demoGuild';
import DemoShell, { PANEL, demoBase } from './_parts/DemoShell';

export const metadata: Metadata = {
  title: { absolute: '[beta] Demo guild' },
  description: 'A click-through demo of a Raid Mimic guild: the next raid night, flags progress, flag events and who needs what. Invented guild, nothing is real.',
  robots: { index: false, follow: false },
};

const GLANCE_GATES = ['hohb', 'tactics', 'torment', 'solro'];

export default function DemoHomePage() {
  const BASE = demoBase();
  const ev = EVENTS.find(e => e.id === TONIGHT.eventId)!;
  const target = targetByKey(ev.target)!;
  const progress = GLANCE_GATES.map(g => {
    const done = CHARS.filter(c => reportFor(c, g, 'planning').verdict.tone === 'done').length;
    const name = reportFor(CHARS[0], g, 'planning').name;
    return { key: g, name, done };
  });
  const waiting = CHARS.filter(c => c.reported);
  const links = [
    { href: `${BASE}/flags`, title: 'Flags', body: 'Every raider against one gate, piece by piece.' },
    { href: `${BASE}/capture`, title: 'Record for others', body: 'A leader records flags for a raider; the owner confirms.' },
    { href: `${BASE}/events`, title: 'Events · option A', body: 'Post an event, see who needs it.' },
    { href: `${BASE}/events/needs`, title: 'Needs board · option B', body: 'The board ranks what is missing and drives the schedule.' },
    { href: `${BASE}/raid`, title: 'Tonight', body: 'Signed raiders against the flags the pull needs.' },
  ];

  return (
    <DemoShell active="home" title="Raid night at a glance"
      lead="What a guild leader sees when they open Raid Mimic: the next night, how far the guild has come, and who needs what. Click anything.">
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          <section aria-labelledby="next-title" className={`${PANEL} flex flex-col gap-1.5`}>
            <h2 id="next-title" className="m-0 text-[11px] uppercase tracking-wide text-dim">Next event</h2>
            <p className="m-0 text-base text-[#f2ede1]">{target.label}</p>
            <p className="m-0 text-xs text-text">{ev.day} {ev.time} <span className="text-dim">· posted by {ev.by}</span></p>
            <p className="m-0 text-xs text-dim">{ev.signed.length} of {CHARS.length} raiders signed</p>
            <a href={`${BASE}/raid`} className="mt-auto pt-1 text-xs text-blue hover:underline">Who is ready to pull →</a>
          </section>

          <section aria-labelledby="prog-title" className={`${PANEL} flex flex-col gap-1.5 md:col-span-1`}>
            <h2 id="prog-title" className="m-0 text-[11px] uppercase tracking-wide text-dim">Flags progress</h2>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {progress.map(p => (
                <li key={p.key} className="text-xs">
                  <div className="flex justify-between gap-2"><span className="truncate text-text">{p.name}</span><span className="shrink-0 text-dim">{p.done} of {CHARS.length}</span></div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-bg"><div className="h-full bg-green/70" style={{ width: `${(p.done / CHARS.length) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
            <a href={`${BASE}/flags`} className="mt-auto pt-1 text-xs text-blue hover:underline">The whole table →</a>
          </section>

          <section aria-labelledby="wait-title" className={`${PANEL} flex flex-col gap-1.5`}>
            <h2 id="wait-title" className="m-0 text-[11px] uppercase tracking-wide text-dim">Waiting for an owner</h2>
            <p className="m-0 text-base text-[#f2ede1]">{waiting.reduce((n, c) => n + (c.reported?.flags.length ?? 0), 0)} reported flags</p>
            <p className="m-0 text-xs text-dim">for {waiting.map(c => c.name).join(' and ')}, recorded by a raid leader. Shown ✅ <span className="text-gold">reported</span> until each owner confirms.</p>
            <a href={`${BASE}/capture`} className="mt-auto pt-1 text-xs text-blue hover:underline">How that works →</a>
          </section>
        </div>

        <section aria-labelledby="last-title" className={`${PANEL} flex flex-col gap-2`}>
          <h2 id="last-title" className="m-0 text-sm text-gold font-semibold">Last raid · {LAST_RAID.when}</h2>
          <div className="overflow-x-auto -mx-3 px-3">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="text-left text-dim">
                  <th scope="col" className="py-1 pr-3 font-normal">Fight</th>
                  <th scope="col" className="py-1 pr-3 font-normal">Time</th>
                  <th scope="col" className="py-1 pr-3 font-normal">Raid damage</th>
                  <th scope="col" className="py-1 pr-3 font-normal">Top damage</th>
                  <th scope="col" className="py-1 font-normal">Top healer</th>
                </tr>
              </thead>
              <tbody>
                {LAST_RAID.fights.map(f => (
                  <tr key={f.boss} className="border-t border-border">
                    <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-normal text-text">{f.boss}</th>
                    <td className="py-1.5 pr-3 text-text">{f.time}</td>
                    <td className="py-1.5 pr-3 text-gold">{f.damage}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-text">{f.top} <span className="text-dim">{f.topDps}</span></td>
                    <td className="py-1.5 text-text">{f.heals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="more-title" className="flex flex-col gap-2">
          <h2 id="more-title" className="m-0 text-sm text-gold font-semibold">Coordinating flag events: two ways to do it</h2>
          <p className="m-0 max-w-[66ch] text-xs leading-5 text-dim">
            Raid leaders post some events already, but scheduling goes one by one. These two boards answer &quot;when, and who needs it&quot;
            from different ends. Look at both and pick one.
          </p>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {links.map(l => (
              <li key={l.href}>
                <a href={l.href} className={`${PANEL} block h-full no-underline hover:border-blue`}>
                  <span className="block text-sm text-[#f2ede1]">{l.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-dim">{l.body}</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[11px] text-dim">{TARGETS.length} flag targets · {EVENTS.length} events posted this week · {CHARS.length} raiders</p>
        </section>
      </div>
    </DemoShell>
  );
}
