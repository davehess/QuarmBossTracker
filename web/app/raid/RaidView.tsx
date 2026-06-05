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

import { Fragment, useMemo, useState } from 'react';
import {
  CATEGORY_LABELS, ROLE_TARGETS, ROLE_LABELS, HP_SLOTS, HP_SLOT_LABELS,
  type BuffCategory, type Role, type HpSlotState,
} from '@/lib/buffs';

export type RaidRow = {
  name: string;
  className: string | null;
  role: Role;
  raidGroup: number | null;
  level: number | null;
  rank: string | null;           // '2' raid leader, '1' group leader
  inRaid: boolean;
  noAgent: boolean;
  zone: string | null;
  updatedAt: string | null;
  buffCount: number;
  byCategory: Record<string, string[]>;
  other: string[];
  hpSlots: HpSlotState;
  tier: 'green' | 'yellow' | 'orange' | 'red' | 'unknown';
  buffs: { name: string; ticks: number | null }[];
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

export default function RaidView({
  rows, raidSize, mimicCovered, leaderName, leaderClass, groupLeaders,
}: {
  rows: RaidRow[];
  raidSize: number;
  mimicCovered: number;
  leaderName: string | null;
  leaderClass: string | null;
  groupLeaders: Record<number, string>;
}) {
  const [bufferClass, setBufferClass] = useState<string>('');     // '' = no filter
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl text-gold">⚔️ Raid</h1>
          <p className="text-sm text-dim mt-1">
            Live operational view — built from the Zeal raid roster + every Mimic that's running.
            {' '}
            <span className="text-orange text-xs">[mockup — stage 1 of <code>docs/raid-hub-roadmap.md</code>]</span>
          </p>
        </div>
        <a href="/buffs" className="text-xs text-blue hover:underline">← classic /buffs view</a>
      </div>

      {/* Top-line stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Stat label="In raid"        value={String(raidSize)}                          color="text-text" />
        <Stat label="Mimic coverage" value={`${mimicCovered} / ${raidSize}`}           color={mimicCovered === raidSize ? 'text-green' : 'text-orange'} />
        <Stat label="Raid leader"    value={leaderName ?? '—'}                         color={leaderName ? 'text-gold' : 'text-dim'} sub={leaderClass || undefined} />
        <Stat label="Groups"         value={String(Object.keys(groupLeaders).length || groups.filter(g => g[0].startsWith('Group ')).length)} color="text-text" />
      </div>

      {/* Raid leader → Discord callout (preview — needs /ari + discord_id join) */}
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

      {/* Buffer mode selector */}
      <div className="bg-panel border border-border rounded-lg p-3">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-dim mr-1">I&apos;m buffing as:</span>
          {(['', 'Cleric', 'Druid', 'Shaman', 'Enchanter', 'Bard'] as const).map(c => (
            <button
              key={c || 'none'}
              onClick={() => setBufferClass(c)}
              className={[
                'px-2 py-0.5 rounded border text-xs transition-colors',
                bufferClass === c
                  ? 'bg-accent border-accent text-white'
                  : 'bg-bg border-border text-dim hover:text-text',
              ].join(' ')}
            >
              {c || 'off'}
            </button>
          ))}
          {bufferClass && (
            <span className="text-[10px] uppercase tracking-widest text-orange border border-orange/40 rounded px-1.5 py-0.5 ml-auto">
              preview · needs real cast timers
            </span>
          )}
        </div>
        {bufferClass && bufferQueue.length > 0 && (
          <ul className="mt-3 text-xs space-y-1.5">
            {bufferQueue.map(({ row, missing }) => (
              <li key={row.name} className="flex items-center gap-2 border-b border-border/40 pb-1">
                <span className={['inline-block w-1.5 h-4 rounded-sm', TIER_STYLE[row.tier].bar].join(' ')} />
                <button
                  onClick={() => setSelectedName(row.name)}
                  className="text-text hover:text-blue underline-offset-2 hover:underline"
                >
                  {row.name}
                </button>
                <span className="text-dim text-[11px]">{row.className} · Grp {row.raidGroup ?? '?'}</span>
                <span className="text-dim ml-auto">
                  {missing.map(c => CATEGORY_LABELS[c]).join(' · ') || 'HP slot missing'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {bufferClass && bufferQueue.length === 0 && (
          <div className="text-xs text-dim mt-2">
            No gaps for a {bufferClass} to fill right now — everyone in raid running Mimic is covered. (Untracked raiders still need eyes.)
          </div>
        )}
      </div>

      {/* The raid grid + side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-3">
          {groups.length === 0 ? (
            <div className="bg-panel border border-border rounded-lg p-6 text-center text-dim text-sm">
              No raid roster flowing yet. Start any Mimic in raid and the live view fills in within seconds.
            </div>
          ) : groups.map(([label, grpRows]) => {
            const isRaidGroup = label.startsWith('Group ');
            const grpNum = isRaidGroup ? parseInt(label.replace('Group ', ''), 10) : null;
            const leader = grpNum != null ? groupLeaders[grpNum] : null;
            return (
              <section key={label} className="bg-panel border border-border rounded-lg overflow-hidden">
                <header className="px-3 py-2 bg-bg/60 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <span className="text-gold">{isRaidGroup ? '👥' : '🛋️'} {label}</span>
                    <span className="text-dim text-xs"> · {grpRows.length} {grpRows.length === 1 ? 'char' : 'chars'}</span>
                    {leader && <span className="text-dim text-xs"> · 🎯 {leader}</span>}
                    {!isRaidGroup && <span className="text-dim/70 text-xs"> · parked / not in current raid</span>}
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
                        className={['flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-[#1a212c] transition-colors', style.bg].join(' ')}
                        onClick={() => setSelectedName(r.name)}
                      >
                        <span className={['inline-block w-1 h-5 rounded-sm shrink-0', style.bar].join(' ')} />
                        <span className="text-text font-medium min-w-0 truncate">
                          {isLeader && <span title="Raid leader" className="text-gold">👑 </span>}
                          {isGrpLead && <span title="Group leader" className="text-blue">⭐ </span>}
                          {r.name}
                        </span>
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

function Stat({ label, value, sub, color = 'text-text' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-bg border border-border rounded p-2.5">
      <div className={['text-lg leading-tight', color].join(' ')}>{value}</div>
      <div className="text-dim text-[10px] uppercase tracking-widest">{label}</div>
      {sub && <div className="text-dim text-[10px] mt-0.5">{sub}</div>}
    </div>
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
                      ? <span className="text-green truncate">{filled}</span>
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
                      ? <span className="text-green truncate" title={names.join(', ')}>{names[0]}{names.length > 1 ? ' +' + (names.length - 1) : ''}</span>
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
