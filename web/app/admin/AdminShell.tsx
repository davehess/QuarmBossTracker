// The admin frame for the sidebar preview (?v=b, kept by the admin_shell cookie; the guild lead, 2026-10-31, DECISIONS
// §493 pick A). Three groups ordered by when a raid night needs them, a red Danger zone pinned to the bottom, and a
// context strip of smart links at the top of every pane. Same shape as the /pop sidebar (app/pop/PopShell.tsx): a sticky
// panel beside the page from lg up; below lg the same panel is a collapsible bar stuck under the site header.
//
// The panel is rendered twice (the bar and the column) and CSS shows one: it holds only links and text, so there is
// nothing to keep in step and no script decides which one a visitor gets. The only script in here is ActiveLink's
// highlight, because a layout is not re-rendered between sibling pages. The numbers arrive as `facts` (already read and
// cached, lib/adminShellFacts.ts), so this component reads nothing and renders statically from a fixture.
import type { ReactNode } from 'react';
import { NAV_GROUPS, linkLabel, linkTitle, type CountKey, type NavGroup, type NavLink } from '@/lib/adminNav';
import type { AdminFacts } from '@/lib/adminShellFacts';
import ActiveLink from './ActiveLink';
import AdminStrip from './AdminStrip';

/** The text beside a line's first link, or null when the number could not be read (the line then shows no number). */
export function countText(key: CountKey, facts: AdminFacts): { text: string; hot: boolean } | null {
  if (key === 'lockouts') return facts.lockedOut == null ? null : { text: String(facts.lockedOut), hot: facts.lockedOut > 0 };
  if (key === 'agents') return facts.agents == null ? null : { text: `${facts.agents.up}/${facts.agents.total}`, hot: false };
  return facts.newFeedback == null ? null : { text: `${facts.newFeedback} new`, hot: facts.newFeedback > 0 };
}

const LINK = 'rounded px-2 py-1.5 text-sm text-text no-underline hover:bg-bg hover:text-blue';
const LINK_ON = 'bg-accent/25 text-text border-l-2 border-blue pl-1.5';

function Line({ links, count, sub, facts, danger }: { links: NavLink[]; count?: CountKey; sub?: NavLink[]; facts: AdminFacts; danger?: boolean }) {
  const n = count ? countText(count, facts) : null;
  const cls = danger ? 'rounded px-2 py-1.5 text-sm text-red no-underline hover:bg-red/10' : LINK;
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-1">
        {links.map((l, i) => (
          // The dot trails the link before it (and stays with it when the line wraps), never leads the next line.
          <span key={l.href} className="inline-flex items-center whitespace-nowrap">
            <ActiveLink href={l.href} exact={l.exact} soon={l.soon} title={linkTitle(l)} className={links.length > 1 ? cls.replace('px-2', 'px-1.5') : cls} activeClassName={LINK_ON}>
              {linkLabel(l)}
            </ActiveLink>
            {i < links.length - 1 && <span aria-hidden className="text-dim">·</span>}
          </span>
        ))}
        {n && <span className={`ml-1 text-[11px] ${n.hot ? 'text-orange' : 'text-dim'}`}>{n.text}</span>}
      </div>
      {sub && sub.length > 0 && (
        <ul className="ml-4 border-l border-border pl-1">
          {sub.map(s => (
            <li key={s.href}>
              <ActiveLink href={s.href} exact={s.exact} soon={s.soon} title={linkTitle(s)} className={`${LINK} text-xs text-dim`} activeClassName={LINK_ON}>
                {linkLabel(s)}
              </ActiveLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Group({ g, facts }: { g: NavGroup; facts: AdminFacts }) {
  return (
    <section aria-labelledby={`admin-nav-${g.id}`} className="mb-3">
      <h2 id={`admin-nav-${g.id}`} className="px-2 mb-1 text-[11px] font-normal uppercase tracking-wider text-dim">{g.title}</h2>
      <ul>{g.lines.map(l => <Line key={l.links[0].href} {...l} facts={facts} />)}</ul>
      {g.elsewhere && (
        <p className="px-2 mt-1 text-[11px] text-dim leading-5">
          Elsewhere:{' '}
          {g.elsewhere.map((e, i) => (
            <span key={e.href}>{i > 0 && ' · '}<a href={e.href} className="text-dim hover:text-blue">{linkLabel(e)}</a></span>
          ))}
        </p>
      )}
    </section>
  );
}

function DangerZone({ g, facts }: { g: NavGroup; facts: AdminFacts }) {
  return (
    <section aria-labelledby="admin-nav-danger" className="rounded-lg border-2 border-red/70 bg-red/5 p-2">
      <h2 id="admin-nav-danger" className="px-2 mb-1 text-[11px] font-normal uppercase tracking-wider text-red">{g.title}</h2>
      <ul>{g.lines.map(l => <Line key={l.links[0].href} {...l} facts={facts} danger />)}</ul>
    </section>
  );
}

function Panel({ facts }: { facts: AdminFacts }) {
  const danger = NAV_GROUPS.find(g => g.id === 'danger')!;
  return (
    <div className="flex flex-col min-h-0 lg:max-h-[calc(100vh-7rem)]">
      <nav aria-label="Admin pages" className="lg:overflow-y-auto lg:flex-1 min-h-0">
        {NAV_GROUPS.filter(g => g.id !== 'danger').map(g => <Group key={g.id} g={g} facts={facts} />)}
        <p className="px-2 mb-2 text-[11px] text-dim">
          {/* A plain link on purpose: a hard load re-reads the cookie that ?v=a clears. */}
          <a href="/admin?v=a" className="text-dim hover:text-blue">Back to the old layout</a>
        </p>
      </nav>
      <div className="shrink-0 pt-2"><DangerZone g={danger} facts={facts} /></div>
    </div>
  );
}

export default function AdminShell({ facts, children }: { facts: AdminFacts; children: ReactNode }) {
  return (
    <div data-admin-shell="b" className="flex flex-col gap-4 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-6 lg:items-start">
      <details className="lg:hidden sticky top-20 z-20 bg-panel border border-border rounded-lg shadow-lg shadow-black/40">
        <summary className="cursor-pointer select-none px-3 py-2.5 text-xs text-text">☰ Admin menu <span className="text-dim">· pages by when you need them</span></summary>
        <div className="px-2 pb-3 pt-3 max-h-[70vh] overflow-y-auto border-t border-border/60"><Panel facts={facts} /></div>
      </details>
      <aside aria-label="Admin sections" className="hidden lg:block lg:sticky lg:top-20 bg-panel border border-border rounded-lg p-2">
        <Panel facts={facts} />
      </aside>
      <div className="space-y-4 min-w-0">
        <AdminStrip facts={facts} />
        {children}
      </div>
    </div>
  );
}
