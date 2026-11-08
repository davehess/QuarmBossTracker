// The /admin landing in the sidebar preview (DECISIONS §493): the same groups as the sidebar, as cards, so the two cannot
// disagree. The danger group comes last behind the red barrier. Loads nothing (the strip above it, in the layout, carries
// the live numbers), which keeps this page one of the two officer pages that need no gate of their own.
import Link from 'next/link';
import { NAV_GROUPS, groupLinks, linkLabel, linkTitle, type NavGroup, type NavLink } from '@/lib/adminNav';
import { ADMIN_BLURBS } from './adminBlurbs';

function LinkCard({ l, danger }: { l: NavLink; danger?: boolean }) {
  const external = !l.href.startsWith('/admin');
  const body = (
    <>
      <span className={`block text-sm ${danger ? 'text-red' : 'text-orange'}`}>{linkLabel(l)}</span>
      {linkTitle(l) !== linkLabel(l) && <span className="block text-[11px] text-dim">{linkTitle(l)}</span>}
      <span className="mt-1 block text-xs text-dim leading-5">{ADMIN_BLURBS[l.href] ?? ''}</span>
    </>
  );
  const cls = `block rounded-lg border p-3 no-underline transition-colors ${danger ? 'border-red/50 bg-bg hover:border-red' : 'border-border bg-panel hover:border-blue'}`;
  if (l.soon) return <div className={`${cls} opacity-50`}>{body}<span className="text-[10px] text-dim">soon</span></div>;
  return external
    ? <a href={l.href} className={cls}>{body}</a>
    : <Link href={l.href} className={cls}>{body}</Link>;
}

function GroupCards({ g }: { g: NavGroup }) {
  const danger = g.id === 'danger';
  return (
    <section
      aria-labelledby={`admin-cards-${g.id}`}
      className={danger ? 'rounded-lg border-2 border-red/70 bg-red/5 p-4' : ''}
    >
      <h2 id={`admin-cards-${g.id}`} className={`text-base ${danger ? 'text-red' : 'text-gold'}`}>
        {danger ? '⚠ ' : ''}{g.title}
      </h2>
      <p className="text-xs text-dim mb-3">{g.blurb}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {groupLinks(g).map(l => <LinkCard key={l.href} l={l} danger={danger} />)}
      </div>
    </section>
  );
}

export default function AdminCards() {
  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-5">
        <h1 className="text-xl text-gold">🛡️ Officer tools</h1>
        <p className="text-sm text-dim mt-1 leading-6">
          The pages are grouped by when a raid night needs them, most used first. The destructive moves sit last, behind a red
          barrier, and ask you to type a phrase before they act.
        </p>
      </section>
      {NAV_GROUPS.map(g => <GroupCards key={g.id} g={g} />)}
    </div>
  );
}
