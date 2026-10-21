// /buffs layout previews — ?v=b (group cards) and ?v=c (buff lines), both on beta until the guild lead
// picks one (CLAUDE.md "UI gets OPTIONS"). A SERVER component: no hooks, no client JS, no polling — the
// page renders it once per request like the rest of /buffs. All the rules live in lib/buffGroups.ts
// (pure, under test); this file only lays the result out.
//
// The guild lead, 2026-10-04: "we should be grouping people for buffs on /buffs". A group buff only
// lands on the caster's own group, so every call-out names a caster IN THAT GROUP, or says there is none.
// Read on a phone between pulls: cards stack, names wrap, nothing scrolls sideways.

import Link from 'next/link';
import BuffLagButton from '@/components/BuffLagButton';
import {
  LINE_LABELS, buildLineView, calloutLines, casterGroups, noCasterText,
  type GroupCard, type LineGap, type RaidSection,
} from '@/lib/buffGroups';

export type BuffLayout = 'b' | 'c';

const LAYOUTS: { v: BuffLayout | null; label: string }[] = [
  { v: null, label: 'Classic grid' },
  { v: 'b', label: 'b · Group cards' },
  { v: 'c', label: 'c · Buff lines' },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function BuffGroupsView({ layout, sections }: { layout: BuffLayout; sections: RaidSection[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl text-gold">🧪 Buffs</h1>
          <p className="text-sm text-dim mt-1">
            {layout === 'b'
              ? 'Group by group — who is short on what, and who in that group can cast it.'
              : 'Line by line — which buffs the raid is short on, and which groups need them.'}
          </p>
        </div>
        <BuffLagButton source="web_buffs" />
      </div>

      <nav aria-label="Buffs layout" className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-dim mr-1">Layout preview:</span>
        {LAYOUTS.map(l => {
          const on = l.v === layout;
          return (
            <Link
              key={l.label}
              href={l.v ? `/buffs?v=${l.v}` : '/buffs'}
              aria-current={on ? 'page' : undefined}
              className={[
                'px-2 py-0.5 rounded border no-underline transition-colors',
                on ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-dim hover:text-text',
              ].join(' ')}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      {/* The classic page's caveat, shortened but with its claim intact: nobody's buffs can be read
          from another player's log, so a raider without the agent is UNKNOWN here, never "missing". */}
      <div className="bg-[#3a1010] border border-[#a3260a] text-[#fca5a5] rounded-lg p-3 text-xs leading-snug">
        <b className="text-red">Read this before trusting a row.</b> Every buff list here is that character&apos;s
        own Mimic / agent upload (via Zeal). Raiders not running it show as <i>unknown</i>, not missing.
        Raid members only — the roster as of the last 15 minutes.
      </div>

      <p className="text-[11px] text-dim leading-snug">
        A group buff only lands on the <b className="text-text">caster&apos;s own group</b>, so a call-out only ever names
        a caster in the same group — never one from another. <i>Missing</i> is the classic grid&apos;s rule: a buff the
        role is expected to carry (tank/melee: haste, attack; caster/priest: mana regen; everyone: resists and
        the three HP slots) with nothing on them.
      </p>

      {sections.length === 0 ? (
        <div className="bg-panel border border-border rounded-lg p-6 text-center text-dim text-sm">
          No one in a live raid roster right now. It fills while raiders run Mimic in a raid and ages out after 15 minutes.
        </div>
      ) : (
        sections.map(s => (
          <div key={s.key ?? s.label ?? 'raid'} className="space-y-3">
            {s.label && <h2 className="text-sm text-blue break-words">{s.label}</h2>}
            {layout === 'b' ? <GroupCards section={s} /> : <BuffLines section={s} />}
          </div>
        ))
      )}
    </div>
  );
}

// ── ?v=b — one card per raid group ───────────────────────────────────────────

function GroupCards({ section }: { section: RaidSection }) {
  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      {section.groups.map(card => <GroupCardView key={card.group ?? 'ungrouped'} card={card} />)}
    </div>
  );
}

function GroupCardView({ card }: { card: GroupCard }) {
  const grouped = card.group !== null;
  const callouts = calloutLines(card);
  const allUnknown = card.unknown === card.members.length;
  return (
    <section className="min-w-0 bg-panel border border-border rounded-lg overflow-hidden">
      <header className="flex items-baseline gap-2 flex-wrap px-3 py-2 border-b border-border">
        <h3 className="text-sm text-gold">{grouped ? `👥 Group ${card.group}` : '🛋️ Ungrouped'}</h3>
        <span className="text-[11px] text-dim">{plural(card.members.length, 'member', 'members')}</span>
        {allUnknown ? (
          <span className="ml-auto text-[11px] text-dim">buffs unknown</span>
        ) : card.lines.length > 0 ? (
          <span className="ml-auto text-[11px] text-orange">{plural(card.lines.length, 'line short', 'lines short')}</span>
        ) : (
          <span className="ml-auto text-[11px] text-green">nothing missing</span>
        )}
      </header>

      <ul className="divide-y divide-border/40">
        {card.members.map(m => (
          <li key={m.name} className={['px-3 py-1.5', m.stale && !m.noAgent ? 'opacity-60' : ''].join(' ')}>
            <div className="flex items-baseline gap-x-2 flex-wrap">
              <span className="text-xs text-text break-all">{m.name}</span>
              <span className="text-[10px] text-dim">{m.className}</span>
              {m.stale && !m.noAgent && <span className="text-[10px] text-dim italic">stale</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {m.noAgent ? (
                <span className="text-[10px] text-dim italic">not running the agent — buffs unknown</span>
              ) : m.missing.length === 0 ? (
                <span className="text-[10px] text-green">✓ nothing missing</span>
              ) : (
                m.missing.map(k => (
                  <span key={k} className="px-1.5 py-0.5 rounded border border-red/50 text-red text-[10px]">{LINE_LABELS[k]}</span>
                ))
              )}
            </div>
          </li>
        ))}
      </ul>

      {callouts.length > 0 && (
        <div className="px-3 py-2 border-t border-border bg-bg/40 space-y-1.5">
          {callouts.map(l => <Callout key={l.key} gap={l} />)}
        </div>
      )}
      {!grouped && card.lines.length > 0 && (
        <p className="px-3 py-2 border-t border-border bg-bg/40 text-[11px] text-dim leading-snug">
          Ungrouped raiders are not a group — a group buff reaches only its caster&apos;s group. Single-target them, or put them in a group.
        </p>
      )}
    </section>
  );
}

// "4 of 6 missing Haste — Corvale (Enchanter) in this group: Vallon's Quickening", or the no-caster note.
function Callout({ gap }: { gap: LineGap }) {
  const casters = casterGroups(gap.casters);
  return (
    <p className="text-[11px] leading-snug border-l-2 border-orange pl-2">
      <span className="text-orange">{gap.missing.length} of {gap.expected} missing {gap.label}</span>
      <span className="text-dim"> — </span>
      {casters.length > 0 ? (
        casters.map((c, i) => (
          <span key={c.cls + c.spell}>
            {i > 0 && <span className="text-dim"> · </span>}
            <span className="text-green">{c.names.join(', ')}</span>
            <span className="text-dim"> ({c.cls}) in this group: </span>
            <span className="text-text">{c.spell}</span>
          </span>
        ))
      ) : (
        <span className="text-dim italic">{noCasterText(gap.casterClasses)}</span>
      )}
    </p>
  );
}

// ── ?v=c — one section per buff line, most missing first ─────────────────────

function BuffLines({ section }: { section: RaidSection }) {
  const { lines, covered, untracked } = buildLineView(section);
  return (
    <div className="space-y-3">
      {lines.length === 0 && (
        <div className="bg-panel border border-border rounded-lg p-4 text-center text-green text-sm">
          Nothing missing anywhere that we can see.
        </div>
      )}
      {lines.map(l => (
        <section key={l.key} className="min-w-0 bg-panel border border-border rounded-lg overflow-hidden">
          <header className="flex items-baseline gap-2 flex-wrap px-3 py-2 border-b border-border">
            <h3 className="text-sm text-gold">{l.label}</h3>
            <span className="text-[11px] text-orange">{l.total} missing</span>
            {l.rows.length > 0 && (
              <span className="ml-auto text-[11px] text-dim">{plural(l.rows.length, 'group', 'groups')} need it</span>
            )}
          </header>
          <ul className="divide-y divide-border/40">
            {l.rows.map(r => {
              const casters = casterGroups(r.casters);
              return (
                <li key={r.group} className="px-3 py-1.5 text-[11px] leading-snug">
                  <span className="text-gold">G{r.group}</span>
                  <span className="text-dim"> · </span>
                  <span className="text-orange">{r.missing.length} missing:</span>{' '}
                  <span className="text-text break-words">{r.missing.join(', ')}</span>
                  <span className="text-dim"> · </span>
                  {casters.length > 0 ? (
                    <>
                      <span className="text-dim">cast: </span>
                      {casters.map((c, i) => (
                        <span key={c.cls + c.spell}>
                          {i > 0 && <span className="text-dim"> · </span>}
                          <span className="text-green">{c.names.join(', ')}</span>
                          <span className="text-dim"> — </span>
                          <span className="text-text">{c.spell}</span>
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="text-dim italic">{noCasterText(r.casterClasses)}</span>
                  )}
                </li>
              );
            })}
            {l.stragglers.length > 0 && (
              <li className="px-3 py-1.5 text-[11px] leading-snug">
                <span className="text-dim">single: </span>
                {l.stragglers.map((s, i) => (
                  <span key={s.name}>
                    {i > 0 && <span className="text-dim">, </span>}
                    <span className="text-text break-words">{s.name}</span>
                    <span className="text-dim"> ({s.group === null ? 'no group' : `G${s.group}`})</span>
                  </span>
                ))}
              </li>
            )}
          </ul>
        </section>
      ))}
      {covered.length > 0 && (
        <p className="text-[11px] text-dim leading-snug">
          Nothing missing: <span className="text-green">{covered.map(k => LINE_LABELS[k]).join(', ')}</span>.
        </p>
      )}
      {untracked.length > 0 && (
        <p className="text-[11px] text-dim leading-snug">
          Not tracked as a gap (no role is expected to carry it): {untracked.map(k => LINE_LABELS[k]).join(', ')}.
        </p>
      )}
    </div>
  );
}
