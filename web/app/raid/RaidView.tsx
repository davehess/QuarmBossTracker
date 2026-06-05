'use client';

// RaidView — Stage-1 mockup of the /raid hub (docs/raid-hub-roadmap.md).
//
// Real data sources (LIVE today):
//   • raid_roster: groups, leaders, levels
//   • character_live_state: buffs, zone, target HP%
//   • web/lib/buffs.ts: categorization + HP slots + role targets
//
// Preview-only bits (visible but stubbed, labeled "preview"):
//   • Buffer mode queue (needs cast-attribution timers — roadmap stage 3)
//   • Raid-leader Discord auto-link (needs /ari ↔ characters.discord_id join)
//   • Mass-buff cooldown + Feral Avatar queue (roadmap stage 3)
//   • DKP auction winner highlight (roadmap stage 4)

import { useMemo, useState } from 'react';
import {
  CATEGORY_LABELS, ROLE_TARGETS, ROLE_LABELS, HP_SLOTS, HP_SLOT_LABELS,
  shortBuffName, fmtBuffRemaining, buffTimeTone,
  type BuffCategory, type Role, type HpSlotState,
} from '@/lib/buffs';

// Tone for a buff's live time-left — crit (refresh now) → low → ok.
const TIME_TONE_CLASS: Record<string, string> = {
  crit: 'text-red-400', low: 'text-orange', ok: 'text-dim', none: 'text-dim',
};

export type RaidRow = {
  name: string;
  className: string | null;
  role: Role;
  raidGroup: number | null;
  level: number | null;
  rank: string | null;           // '2' raid leader, '1' group leader
  inRaid: boolean;
  noAgent: boolean;              // not running Mimic → unknown buff state
  zone: string | null;
  updatedAt: string | null;
  buffCount: number;
  byCategory: Record<string, string[]>;
  other: string[];
  hpSlots: HpSlotState;
  tier: 'green' | 'yellow' | 'orange' | 'red' | 'unknown';
  buffs: { name: string; ticks: number | null }[];
  isMe: boolean;                 // the signed-in user's character
};

const TIER_STYLE: Record<RaidRow['tier'], { bg: string; bar: string; label: string }> = {
  green:   { bg: 'bg-[#0f2a1a]/60', bar: 'bg-green',      label: 'fully buffed' },
  yellow:  { bg: 'bg-[#2a2410]/60', bar: 'bg-[#d4a72c]',  label: 'minor gaps' },
  orange:  { bg: 'bg-[#2a1f10]/70', bar: 'bg-orange',     label: 'expiring soon' },
  red:     { bg: 'bg-[#2a1010]/70', bar: 'bg-red-500',    label: 'critical missing' },
  unknown: { bg: 'bg-[#11151c]/60', bar: 'bg-dim',        label: 'no Mimic — unknown' },
};

// Class → which buff categories that class provides. Drives the "I'm buffing
// as <class>" filter. First pass; tunable in lib/buffs.ts later.
const CLASS_PROVIDES: Record<string, BuffCategory[]> = {
  cleric:    ['hp', 'regen', 'resists'],
  druid:     ['hp', 'regen', 'runSpeed', 'ds', 'resists'],
  shaman:    ['hp', 'attack', 'haste', 'regen', 'resists'],
  enchanter: ['mana', 'manaRegen', 'haste', 'resists'],
  bard:      ['haste', 'runSpeed', 'attack', 'manaRegen', 'ds'],
  paladin:   ['hp', 'resists'],
  ranger:    ['regen', 'ds'],
  beastlord: ['attack', 'regen'],
  magician:  ['ds'],
  wizard:    ['hp'],
};

function ago(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  return h + 'h ago';
}

// The classes we offer in Buffer-mode. Order matters — used by the chip strip.
const BUFFER_CLASSES = ['Cleric', 'Druid', 'Shaman', 'Enchanter', 'Bard'] as const;
type BufferClass = typeof BUFFER_CLASSES[number];

// Normalize an arbitrary class string to one of our Buffer-mode classes (or
// null if it's not a class that buffs). Used to auto-pick the signed-in user's
// class as the default Buffer-mode focus.
function asBufferClass(s: string | null | undefined): BufferClass | '' {
  if (!s) return '';
  const n = s.trim().toLowerCase();
  for (const c of BUFFER_CLASSES) if (c.toLowerCase() === n) return c;
  return '';
}

export default function RaidView({
  rows, raidSize, mimicCovered, leaderName, leaderClass, groupLeaders, myClass,
}: {
  rows: RaidRow[];
  raidSize: number;
  mimicCovered: number;
  leaderName: string | null;
  leaderClass: string | null;
  groupLeaders: Record<number, string>;
  myClass: string | null;
}) {
  // Default Buffer-mode class = the signed-in user's own class as detected in
  // the raid roster. Override is always available; some folks swap to help
  // cover a shortage and the chip strip lets them flip.
  const [bufferClass, setBufferClass] = useState<BufferClass | ''>(() => asBufferClass(myClass));
  const [selectedName, setSelectedName] = useState<string | null>(null);

  // Group by raid group. Parked alts → "Not in raid" bucket sorted last.
  const groups = useMemo(() => {
    const m = new Map<string, RaidRow[]>();
    const keyFor = (r: RaidRow) =>
      r.raidGroup != null ? `Group ${r.raidGroup}` : 'Not in raid';
    for (const r of rows) {
      const k = keyFor(r);
      const arr = m.get(k);
      if (arr) arr.push(r); else m.set(k, [r]);
    }
    return [...m.entries()].sort((a, b) => {
      const an = a[0] === 'Not in raid', bn = b[0] === 'Not in raid';
      if (an !== bn) return an ? 1 : -1;
      const ai = parseInt(a[0].replace('Group ', ''), 10);
      const bi = parseInt(b[0].replace('Group ', ''), 10);
      if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
      return a[0].localeCompare(b[0]);
    });
  }, [rows]);

  const selected = selectedName ? rows.find(r => r.name === selectedName) ?? null : null;

  // Buffer-mode queue: rows missing a buff this class provides. Sorted by tier
  // severity (red → orange → yellow). PREVIEW — needs real timers to be useful.
  const bufferQueue = useMemo(() => {
    if (!bufferClass) return [];
    const provides = CLASS_PROVIDES[bufferClass.toLowerCase()] || [];
    if (provides.length === 0) return [];
    const severity = { red: 0, orange: 1, yellow: 2, green: 3, unknown: 4 } as const;
    const out: { row: RaidRow; missing: BuffCategory[] }[] = [];
    for (const r of rows) {
      if (!r.inRaid || r.noAgent) continue;
      const expected = ROLE_TARGETS[r.role] || [];
      const missing = provides.filter(cat => expected.includes(cat) && !(r.byCategory[cat]?.length));
      // HP slots are special — clerics/druids/shaman provide them, missing
      // counts even if the role-target categories all check out.
      const providesHp = provides.includes('hp');
      const missingHp = providesHp ? HP_SLOTS.filter(s => !r.hpSlots[s]) : [];
      if (missing.length > 0 || missingHp.length > 0) out.push({ row: r, missing });
    }
    out.sort((a, b) => severity[a.row.tier] - severity[b.row.tier]);
    return out.slice(0, 30);
  }, [bufferClass, rows]);

  // Class counts — for the sidebar AND for the buffer-mode auto-detection of
  // useful classes. Only count in-raid characters.
  const classCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.inRaid) continue;
      const k = r.className || 'Unknown';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const focused = bufferClass !== '';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl text-gold">⚔️ Raid</h1>
          <p className="text-sm text-dim mt-1">
            Live operational view — built from the Zeal raid roster + every Mimic that&apos;s running.
            {' '}
            <span className="text-orange text-xs">[mockup — stage 1 of <code>docs/raid-hub-roadmap.md</code>]</span>
          </p>
        </div>
        <a href="/buffs" className="text-xs text-blue hover:underline">← classic /buffs view</a>
      </div>

      {/* Coverage unlocks first — the "more Mimics = more capabilities" pitch.
          Front-and-center so it's the first thing a guildie sees. */}
      <CoverageUnlocks raidSize={raidSize} mimicCovered={mimicCovered} />

      {/* Raid leader callout */}
      {leaderName && (
        <div className="bg-panel border border-border rounded-lg p-3 text-xs flex items-center justify-between gap-3 flex-wrap">
          <div>
            👑 <span className="text-gold">{leaderName}</span> is leading the raid.
            {leaderClass && <span className="text-dim"> · {leaderClass}</span>}
            <span className="text-dim">{' '}· when <code>/ari</code> is set, we&apos;ll auto-DM the password to clickers from here.</span>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-orange border border-orange/40 rounded px-1.5 py-0.5">preview</span>
        </div>
      )}

      {/* Buffer mode — when OFF, show the class picker. When ON, show ONLY the
          picked class as a single elevated chip with the queue underneath, so
          the buffer can focus without the other classes' noise. */}
      <BufferModeBar
        bufferClass={bufferClass}
        myClass={myClass}
        onPick={(c) => setBufferClass(c)}
        bufferQueueLen={bufferQueue.length}
      />
      {focused && (
        <BufferQueue
          bufferClass={bufferClass as BufferClass}
          queue={bufferQueue}
          onSelect={(n) => setSelectedName(n)}
        />
      )}

      {/* The raid grid + sidebars */}
      <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr_320px] gap-4">
        {/* Class-count panel — at-a-glance "what classes do we have tonight". */}
        <ClassCountPanel counts={classCounts} raidSize={raidSize} />

        <div className="space-y-3">
          {groups.length === 0 ? (
            <div className="bg-panel border border-border rounded-lg p-6 text-center text-dim text-sm">
              No raid roster flowing yet. Start any Mimic in raid and the live view fills in within seconds.
            </div>
          ) : groups.map(([label, grpRows]) => {
            const isRaidGroup = label.startsWith('Group ');
            const grpNum = isRaidGroup ? parseInt(label.replace('Group ', ''), 10) : null;
            const leader = grpNum != null ? groupLeaders[grpNum] : null;
            // Does this group have at least one Mimic? Drives the group header
            // chip — clarifies "do we have HP signals from this group at all?"
            const mimicInGroup = grpRows.some(r => !r.noAgent);
            return (
              <section key={label} className="bg-panel border border-border rounded-lg overflow-hidden">
                <header className="px-3 py-2 bg-bg/60 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-gold">{isRaidGroup ? '👥' : '🛋️'} {label}</span>
                    <span className="text-dim text-xs">{grpRows.length} {grpRows.length === 1 ? 'char' : 'chars'}</span>
                    {leader && <span className="text-dim text-xs">· 🎯 {leader}</span>}
                    {isRaidGroup && (
                      mimicInGroup
                        ? <span title="At least one Mimic in this group → HP signals available" className="text-[9px] uppercase tracking-widest text-green border border-green/40 rounded px-1.5 py-0.5">🐺 mimic</span>
                        : <span title="No Mimic in this group — HP signals unavailable" className="text-[9px] uppercase tracking-widest text-dim border border-dim/40 rounded px-1.5 py-0.5">no mimic</span>
                    )}
                    {!isRaidGroup && <span className="text-dim/70 text-xs">parked / not in current raid</span>}
                  </div>
                  <TierLegend rows={grpRows} />
                </header>
                <ul className="divide-y divide-border/40">
                  {grpRows.map(r => {
                    const style = TIER_STYLE[r.tier];
                    const isLeader = r.rank === '2';
                    const isGrpLead = r.rank === '1';
                    return (
                      <li
                        key={r.name}
                        className={['flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-[#1a212c] transition-colors', style.bg, r.isMe ? 'ring-1 ring-blue/60' : ''].join(' ')}
                        onClick={() => setSelectedName(r.name)}
                      >
                        <span className={['inline-block w-1 h-5 rounded-sm shrink-0', style.bar].join(' ')} />
                        <span className="text-text font-medium min-w-0 truncate">
                          {isLeader && <span title="Raid leader" className="text-gold">👑 </span>}
                          {isGrpLead && <span title="Group leader" className="text-blue">⭐ </span>}
                          {r.name}
                          {r.isMe && <span title="That&apos;s you" className="text-blue ml-1">·</span>}
                        </span>
                        {!r.noAgent && (
                          <span
                            title="Running Mimic — buffs + HP signals flowing"
                            className="text-[9px] leading-none px-1 py-0.5 rounded bg-blue/15 text-blue border border-blue/30 shrink-0"
                          >
                            🐺
                          </span>
                        )}
                        <span className="text-dim text-[10px] shrink-0">
                          {r.className || 'Unknown'} · {ROLE_LABELS[r.role]}
                        </span>
                        {r.noAgent
                          ? <span className="text-dim italic text-[10px] ml-auto">no Mimic</span>
                          : (
                              <>
                                <span className="text-dim text-[10px] ml-auto">{r.buffCount} buffs</span>
                                <span className="text-dim text-[10px] w-16 text-right">{ago(r.updatedAt)}</span>
                              </>
                            )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {/* Soon-but-not-yet feature teasers, all data-driven from what we
              already have or know how to add. Visible so we keep momentum. */}
          <ComingSoon />
        </div>

        {/* Side panel — character detail (real buffs/HP-slots/zone). */}
        <aside className="bg-panel border border-border rounded-lg p-3 text-xs sticky top-2 self-start max-h-[80vh] overflow-y-auto">
          {!selected ? (
            <div className="text-dim text-center py-10">
              Click a raider to see their full buff state, missing slots, and a one-tap <code>/target</code> copy.
            </div>
          ) : (
            <CharacterDetail row={selected} onClose={() => setSelectedName(null)} />
          )}
        </aside>
      </div>
    </div>
  );
}

// Compact "I'm buffing as <class>" picker. When a class is picked we elevate
// it to a single chip with an X to clear, so the buffer can focus on their
// queue without the other classes' buttons crowding the view.
function BufferModeBar({
  bufferClass, myClass, onPick, bufferQueueLen,
}: {
  bufferClass: BufferClass | '';
  myClass: string | null;
  onPick: (c: BufferClass | '') => void;
  bufferQueueLen: number;
}) {
  if (bufferClass !== '') {
    return (
      <div className="bg-panel border border-accent/60 rounded-lg p-3 text-xs flex items-center gap-2 flex-wrap">
        <span className="text-dim">Buffing as</span>
        <span className="text-base text-white bg-accent border border-accent rounded px-2 py-0.5 font-medium">
          {bufferClass}
        </span>
        <span className="text-dim">·</span>
        <span className="text-text">{bufferQueueLen} {bufferQueueLen === 1 ? 'raider' : 'raiders'} on your queue</span>
        <button
          onClick={() => onPick('')}
          className="ml-auto text-dim hover:text-text text-xs border border-border rounded px-2 py-0.5"
          title="Back to all classes"
        >
          ✕ exit
        </button>
        <span className="text-[10px] uppercase tracking-widest text-orange border border-orange/40 rounded px-1.5 py-0.5">
          preview · needs real cast timers
        </span>
      </div>
    );
  }
  return (
    <div className="bg-panel border border-border rounded-lg p-3 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-dim mr-1">I&apos;m buffing as:</span>
        {BUFFER_CLASSES.map(c => {
          const isMy = myClass && c.toLowerCase() === myClass.toLowerCase();
          return (
            <button
              key={c}
              onClick={() => onPick(c)}
              className={[
                'px-2 py-0.5 rounded border text-xs transition-colors',
                isMy
                  ? 'bg-accent/10 border-accent text-accent hover:bg-accent/20'
                  : 'bg-bg border-border text-dim hover:text-text',
              ].join(' ')}
              title={isMy ? 'Your class' : undefined}
            >
              {c}{isMy ? ' (you)' : ''}
            </button>
          );
        })}
        <span className="text-dim ml-auto text-[10px]">
          Defaults to your class · override to cover a shortage
        </span>
      </div>
    </div>
  );
}

// The focused buffer queue — only shown when a class is picked.
function BufferQueue({
  bufferClass, queue, onSelect,
}: {
  bufferClass: BufferClass;
  queue: { row: RaidRow; missing: BuffCategory[] }[];
  onSelect: (name: string) => void;
}) {
  if (queue.length === 0) {
    return (
      <div className="bg-panel border border-border rounded-lg p-3 text-xs text-dim">
        No gaps for a {bufferClass} to fill right now — every Mimic-running raider is covered. Untracked raiders still need eyes.
      </div>
    );
  }
  return (
    <div className="bg-panel border border-border rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-widest text-dim mb-2">Buff queue · severity-first</div>
      <ul className="text-xs space-y-1.5">
        {queue.map(({ row, missing }) => (
          <li key={row.name} className="flex items-center gap-2 border-b border-border/40 pb-1.5 last:border-0">
            <span className={['inline-block w-1.5 h-5 rounded-sm', TIER_STYLE[row.tier].bar].join(' ')} />
            <button
              onClick={() => onSelect(row.name)}
              className="text-text hover:text-blue underline-offset-2 hover:underline"
            >
              {row.name}
            </button>
            {!row.noAgent && (
              <span className="text-[9px] leading-none px-1 py-0.5 rounded bg-blue/15 text-blue border border-blue/30">🐺</span>
            )}
            <span className="text-dim text-[11px]">{row.className} · Grp {row.raidGroup ?? '?'}</span>
            <span className="text-dim ml-auto text-[11px]">
              {missing.map(c => CATEGORY_LABELS[c]).join(' · ') || 'HP slot missing'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Class-count sidebar — "what do we have in raid tonight, at a glance".
function ClassCountPanel({ counts, raidSize }: { counts: [string, number][]; raidSize: number }) {
  return (
    <aside className="bg-panel border border-border rounded-lg p-3 text-xs self-start sticky top-2">
      <div className="text-[10px] uppercase tracking-widest text-dim mb-2">Classes in raid</div>
      {counts.length === 0 ? (
        <div className="text-dim italic">No roster yet.</div>
      ) : (
        <ul className="space-y-0.5">
          {counts.map(([cls, n]) => (
            <li key={cls} className="flex justify-between text-text">
              <span className="truncate">{cls}</span>
              <span className="text-dim tabular-nums">×{n}</span>
            </li>
          ))}
          <li className="flex justify-between text-dim border-t border-border/40 mt-1 pt-1">
            <span>Total</span>
            <span className="tabular-nums">{raidSize}</span>
          </li>
        </ul>
      )}
    </aside>
  );
}

function TierLegend({ rows }: { rows: RaidRow[] }) {
  const counts = rows.reduce<Record<RaidRow['tier'], number>>(
    (acc, r) => { acc[r.tier]++; return acc; },
    { green: 0, yellow: 0, orange: 0, red: 0, unknown: 0 },
  );
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {(['green','yellow','orange','red','unknown'] as const).map(t =>
        counts[t] > 0
          ? <span key={t} className={['inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/60'].join(' ')}>
              <span className={['inline-block w-2 h-2 rounded-sm', TIER_STYLE[t].bar].join(' ')} />
              <span className="text-dim">{counts[t]}</span>
            </span>
          : null
      )}
    </div>
  );
}

function CharacterDetail({ row, onClose }: { row: RaidRow; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const target = '/target ' + row.name;
  const copy = async () => {
    try { await navigator.clipboard.writeText(target); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  };
  const tierStyle = TIER_STYLE[row.tier];
  const expected = ROLE_TARGETS[row.role] || [];

  // name(lower) → remaining ticks, from the row's own live buff list.
  const atMs = row.updatedAt ? new Date(row.updatedAt).getTime() : null;
  const ticksFor = (name: string): number | null =>
    row.buffs.find(b => b?.name && b.name.toLowerCase() === name.toLowerCase())?.ticks ?? null;
  // One buff: guild shorthand + toned time-left.
  const BuffChip = ({ name }: { name: string }) => {
    const t = fmtBuffRemaining(ticksFor(name), atMs);
    const tone = buffTimeTone(ticksFor(name), atMs);
    return (
      <span className="truncate" title={name + (t ? ` · ${t} left` : '')}>
        <span className="text-green">{shortBuffName(name)}</span>
        {t && <span className={['ml-1 tabular-nums', TIME_TONE_CLASS[tone]].join(' ')}>{t}</span>}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-text text-base font-medium truncate">
            {row.rank === '2' && '👑 '}
            {row.rank === '1' && '⭐ '}
            {row.name}
          </div>
          <div className="text-dim text-[11px]">
            {row.className || 'Unknown'} · {ROLE_LABELS[row.role]}
            {row.level != null && <> · L{row.level}</>}
            {row.raidGroup != null && <> · Group {row.raidGroup}</>}
          </div>
        </div>
        <button onClick={onClose} className="text-dim hover:text-text text-base leading-none">✕</button>
      </div>

      <div className={['flex items-center gap-2 rounded px-2 py-1.5 text-[11px]', tierStyle.bg].join(' ')}>
        <span className={['inline-block w-2 h-2 rounded-sm', tierStyle.bar].join(' ')} />
        <span className="text-text">{tierStyle.label}</span>
      </div>

      <button onClick={copy} className="w-full px-2 py-1.5 rounded border border-border hover:border-blue text-blue text-xs">
        {copied ? '✓ copied' : '📋 copy ' + target}
      </button>

      {row.noAgent ? (
        <div className="text-dim text-[11px] italic border border-border/40 rounded p-2">
          Not running Mimic — we don&apos;t know their buff state.
          {' '}Encourage them to install Mimic; even one more raider in this group unlocks accurate buffing for everyone in it.
        </div>
      ) : (
        <>
          {row.zone && (
            <div className="text-[11px]">
              <span className="text-dim">Zone:</span> <span className="text-text">{row.zone}</span>
              {row.updatedAt && <span className="text-dim"> · {ago(row.updatedAt)}</span>}
            </div>
          )}

          {/* HP slots */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-dim mb-1">HP slots</div>
            <ul className="space-y-1">
              {HP_SLOTS.map(slot => {
                const filled = row.hpSlots[slot];
                return (
                  <li key={slot} className="flex items-center gap-2 text-[11px]">
                    <span className="text-dim w-28 shrink-0">{HP_SLOT_LABELS[slot]}</span>
                    {filled
                      ? <BuffChip name={filled} />
                      : <span className="text-red-400">— missing</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Categories — only those expected for the role, with the missing
              ones flagged. */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-dim mb-1">Buff categories</div>
            <ul className="space-y-1">
              {(['regen','mana','manaRegen','haste','runSpeed','attack','ds','resists'] as BuffCategory[]).map(cat => {
                const names = row.byCategory[cat] || [];
                const present = names.length > 0;
                const exp = expected.includes(cat);
                if (!exp && !present) return null;
                return (
                  <li key={cat} className="flex items-center gap-2 text-[11px]">
                    <span className="text-dim w-20 shrink-0">{CATEGORY_LABELS[cat]}</span>
                    {present
                      ? <span className="flex items-center gap-1 min-w-0" title={names.join(', ')}>
                          <BuffChip name={names[0]} />
                          {names.length > 1 ? <span className="text-green shrink-0">+{names.length - 1}</span> : null}
                        </span>
                      : <span className="text-red-400">— missing</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          {row.other.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-dim mb-1">Other ({row.other.length})</div>
              <div className="text-[11px] text-dim leading-5">{row.other.join(' · ')}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// CoverageUnlocks — the live "what more Mimic coverage unlocks for the raid"
// widget. Each capability declares its requirement: a flat % of raiders on
// Mimic, or a per-group presence ("at least one Mimic in every group"), or a
// role gate (the raid leader specifically needs to be on Mimic for certain
// loops to close). The widget compares current coverage against each gate and
// shows it as unlocked / partial / locked — screenshot the page on a slow
// night and the pitch writes itself.
function CoverageUnlocks({ raidSize, mimicCovered }: { raidSize: number; mimicCovered: number }) {
  const pct = raidSize > 0 ? Math.round((mimicCovered / raidSize) * 100) : 0;
  type Cap = {
    icon: string;
    name: string;
    blurb: string;
    minPct: number;
  };
  const caps: Cap[] = [
    { icon: '🛡️', name: 'Personal buff visibility', blurb: 'Everyone running Mimic sees their own buffs, HP slots, and missing gaps — no tells needed.', minPct: 1 },
    { icon: '👀', name: 'Crystal-clear buffing duties', blurb: 'Buffers see who needs what, ordered by severity. No more "anyone need C2?" chat spam.', minPct: 25 },
    { icon: '🔊', name: 'Cross-raid trigger redundancy', blurb: 'If one log misses the rampage / AoE / curse line, another catches it — one bot callout, no spam.', minPct: 40 },
    { icon: '❤️', name: 'Live HP heat-map', blurb: 'Group HP is exposed via Zeal — a Mimic in each group means a live HP picture of the whole raid.', minPct: 50 },
    { icon: '⏱️', name: 'Mass-buff cooldown board', blurb: 'See exactly when every cleric MGB Aego / shaman MGB Avatar comes off cooldown. No more guessing.', minPct: 50 },
    { icon: '🐺', name: 'Smart Feral Avatar queue', blurb: 'Beastlord targeting prioritized by recent damage, with worn-attack-capped melee automatically skipped.', minPct: 60 },
    { icon: '⛓️', name: 'CH chain integrity tracking', blurb: 'Live cleric rotation: who is up, who is late, gap alerts before the tank eats it.', minPct: 70 },
    { icon: '📋', name: 'One-tap loot loop', blurb: 'Auction wins highlight on /raid + add-as-looter goes straight to OpenDKP from the raid leader\'s screen.', minPct: 80 },
    { icon: '✨', name: 'Full raid intel', blurb: 'Everyone visible. Every buff. Every cooldown. Every death timer. Every mob targeted. Nothing missed.', minPct: 100 },
  ];

  const dramatic = pct < 100; // hide the headline pitch once we've hit it

  return (
    <section className="bg-gradient-to-br from-[#0d1117] to-[#161b22] border border-border rounded-lg p-4">
      {dramatic && (
        <div className="text-sm text-text leading-6 italic mb-3">
          <span className="text-gold">Imagine</span> a world where your buffs were
          always accounted for and your buffing duties were crystal clear without
          extra tells.{' '}
          <span className="text-dim not-italic">Each raider on Mimic unlocks more of it for the whole pack.</span>
        </div>
      )}

      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div>
          <div className="text-xs uppercase tracking-widest text-dim">Mimic coverage</div>
          <div className="text-2xl text-text">{mimicCovered}<span className="text-dim text-sm"> / {raidSize || '?'}</span>
            {' '}<span className={['text-sm', pct >= 80 ? 'text-green' : pct >= 50 ? 'text-[#d4a72c]' : pct >= 25 ? 'text-orange' : 'text-red-400'].join(' ')}>({pct}%)</span>
          </div>
        </div>
        <div className="text-[11px] text-dim text-right max-w-[20rem]">
          Mimic is free and silent. Install from{' '}
          <a href="/mimic" target="_blank" rel="noreferrer" className="text-blue hover:underline">wolfpack.quest/mimic</a>.
          Settings + token persist across upgrades.
        </div>
      </div>

      {/* Big coverage bar */}
      <div className="h-2 bg-bg rounded-full overflow-hidden mb-3">
        <div
          className={['h-full transition-all', pct >= 80 ? 'bg-green' : pct >= 50 ? 'bg-[#d4a72c]' : pct >= 25 ? 'bg-orange' : 'bg-red-500'].join(' ')}
          style={{ width: pct + '%' }}
        />
      </div>

      {/* Capability ladder */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {caps.map(c => {
          const unlocked = pct >= c.minPct;
          return (
            <li
              key={c.name}
              className={[
                'flex items-start gap-2 text-[11px] rounded px-2 py-1.5 border',
                unlocked ? 'border-green/40 bg-[#0f2a1a]/40' : 'border-border bg-bg/40 opacity-70',
              ].join(' ')}
              title={unlocked ? 'Unlocked' : `Unlocks at ${c.minPct}% coverage`}
            >
              <span className="text-base leading-none mt-0.5">{unlocked ? c.icon : '🔒'}</span>
              <div className="min-w-0">
                <div className={unlocked ? 'text-green' : 'text-text'}>
                  {c.name}
                  <span className="text-dim text-[10px] font-normal ml-1">
                    {unlocked ? '✓ unlocked' : `· at ${c.minPct}%`}
                  </span>
                </div>
                <div className="text-dim leading-snug">{c.blurb}</div>
              </div>
            </li>
          );
        })}
      </ul>

      {pct < 100 && raidSize > 0 && (
        <div className="text-[11px] text-dim mt-3 leading-5">
          <span className="text-text">{raidSize - mimicCovered}</span> raider{raidSize - mimicCovered === 1 ? '' : 's'} not on Mimic.
          {' '}
          {(() => {
            const next = caps.find(c => pct < c.minPct);
            if (!next) return 'Add one more and we hit 100%.';
            const need = Math.max(1, Math.ceil((next.minPct * raidSize) / 100) - mimicCovered);
            return `Add ${need} more and we unlock ${next.name.toLowerCase()}.`;
          })()}
        </div>
      )}
    </section>
  );
}

function ComingSoon() {
  return (
    <section className="bg-panel border border-dashed border-border/60 rounded-lg p-3 text-[11px] text-dim">
      <div className="text-orange text-xs mb-1">🛠️ wiring next (preview)</div>
      <ul className="list-disc list-inside leading-6 space-y-0.5">
        <li><b>Real buff timers</b> — once we track the cast → countdown bars per buff, the &quot;expiring soon&quot; tier becomes precise (instead of inferring from low-tick remaining).</li>
        <li><b>Mass-buff cooldowns</b> — surface &quot;Aego MGB ready: Cordina · 2m · 12m · …&quot; so the raid lead can stagger casts.</li>
        <li><b>Feral Avatar queue</b> — sorted by recent damage, with worn-attack-capped players skipped automatically (needs Quarmy AA + worn-item parser, in flight).</li>
        <li><b>RaidHelper diff</b> — who signed up vs. who&apos;s actually here; which class slots are short.</li>
        <li><b>DKP loop</b> — auction winner highlights on their row + a one-tap &quot;Add as looter&quot; that posts to OpenDKP.</li>
        <li><b>Group regrouping</b> — &quot;Move Hopeya/Melting/Hitya into Grp 4 so Bardtholemu can MGB all three in one cast.&quot;</li>
      </ul>
      <div className="mt-2 text-dim/70">Full plan: <code>docs/raid-hub-roadmap.md</code></div>
    </section>
  );
}
