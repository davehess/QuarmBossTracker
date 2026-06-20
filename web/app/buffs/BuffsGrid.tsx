'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  CATEGORY_LABELS, ROLE_TARGETS, ROLE_LABELS,
  HP_SLOTS, HP_SLOT_LABELS, HP_SLOT_PROVIDER,
  shortBuffName, fmtBuffRemaining, buffTimeTone,
  type BuffCategory, type Role, type HpSlotState,
} from '@/lib/buffs';
import BuffLagButton from '@/components/BuffLagButton';

export type BuffRow = {
  name: string;
  className: string | null;
  role: Role;
  zone: string | null;
  updatedAt: string | null;
  buffCount: number;
  byCategory: Record<string, string[]>;
  other: string[];
  // Which of the three HP buff slots (A/B/C) are filled, and with what.
  hpSlots: HpSlotState;
  // name(lower) → remaining ticks (1 tick = 6s) for time-left display.
  buffTicks?: Record<string, number | null>;
  // Live raid group (1–8) from the Zeal raid roster; null = not in the raid.
  raidGroup?: number | null;
  inRaid?: boolean;
  // In the raid roster but no live buff data (not running the agent) → buffs
  // are unknown rather than missing.
  noAgent?: boolean;
  // Live charm/summoned pet snapshot (Zeal). Null for non-pet classes / no pet.
  pet?: {
    name: string;
    hpPct: number | null;
    buffs: { name: string; remaining_secs: number | null; total_secs: number | null; good: number | null }[];
  } | null;
};

// Pet HP% color — same thresholds as the overlays (green > 50 / amber > 20 / red).
function petHpClass(p: number): string {
  if (p > 50) return 'text-green';
  if (p > 20) return 'text-orange';
  return 'text-red-400';
}

const STALE_MS = 30 * 60 * 1000;

// Tone for a buff's remaining time — crit (refresh now) → low → ok. "unknown"
// renders the "?" chip dimmer + italic so a buffer can tell at a glance "we
// don't know how long this lasts" vs. a real countdown.
const TIME_TONE_CLASS: Record<string, string> = {
  crit:    'text-red-400',
  low:     'text-orange',
  ok:      'text-dim',
  none:    'text-dim',
  unknown: 'text-dim italic',
};

// One buff: guild-shorthand name + its live time-left badge (toned so a buffer
// sees who needs a top-off). updatedAt elapsed-adjusts the tick count.
function BuffChip({ name, ticks, updatedAt }: { name: string; ticks: number | null | undefined; updatedAt: string | null }) {
  const at = updatedAt ? new Date(updatedAt).getTime() : null;
  const t = fmtBuffRemaining(ticks, at);
  const tone = buffTimeTone(ticks, at);
  const titleSuffix = tone === 'unknown' ? ' · duration unknown' : t ? ` · ${t} left` : '';
  return (
    <span title={name + titleSuffix}>
      <span className="text-green">{shortBuffName(name)}</span>
      {t && <span className={['ml-1 tabular-nums', TIME_TONE_CLASS[tone]].join(' ')}>{t}</span>}
    </span>
  );
}

// Copy "/target <name>" so a raider can paste straight into EQ. Zeal's pipe is
// read-only (data flows OUT of EQ; there's no documented inbound slash-command
// surface), so clipboard is the right primitive. Brief ✓ feedback on success.
function CopyTargetButton({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    const text = '/target ' + name;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Older browsers / iframes without clipboard perms — fall back to a
      // hidden textarea + execCommand so the button never silently fails.
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true); setTimeout(() => setCopied(false), 1200);
      } catch { /* nothing more we can do */ }
    }
  };
  return (
    <button
      onClick={onClick}
      title={'Copy "/target ' + name + '" to clipboard'}
      aria-label={'Copy /target ' + name}
      className="ml-1 inline-flex items-center justify-center w-5 h-5 text-[11px] rounded border border-border/60 text-dim hover:text-blue hover:border-blue align-middle"
    >
      {copied ? <span className="text-green">✓</span> : <span>📋</span>}
    </button>
  );
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

export default function BuffsGrid({ rows, categories }: { rows: BuffRow[]; categories: BuffCategory[] }) {
  // Distinct classes present, for the filter chips.
  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.className || 'Unknown');
    return [...set].sort();
  }, [rows]);

  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(new Set(classes));
  const [onlyGaps, setOnlyGaps]   = useState(false);
  const [hideStale, setHideStale] = useState(false);

  const toggleClass = (c: string) => {
    setSelectedClasses(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const now = Date.now();
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (!selectedClasses.has(r.className || 'Unknown')) return false;
      if (hideStale && r.updatedAt && (now - new Date(r.updatedAt).getTime()) > STALE_MS) return false;
      if (onlyGaps) {
        // noAgent rows have unknown buffs, not known gaps — keep them out of
        // the gaps-only view rather than flagging every one as missing.
        if (r.noAgent) return false;
        const target = ROLE_TARGETS[r.role] || [];
        const catGap = target.some(cat => !(r.byCategory[cat]?.length));
        const hpGap = HP_SLOTS.some(slot => !r.hpSlots[slot]);
        if (!catGap && !hpGap) return false;
      }
      return true;
    });
  }, [rows, selectedClasses, onlyGaps, hideStale, now]);

  // Group by the LIVE RAID GROUP (1–8) from the Zeal raid roster — the real
  // raid structure, so a buffer can sweep "Group 3" and see exactly who's
  // missing what. Characters not in the current raid (parked alts running the
  // agent) fall into a "Not in raid" bucket sorted last. Falls back gracefully
  // when no roster is flowing yet: everyone lands in "Not in raid" by zone-less
  // headcount.
  const groups = useMemo(() => {
    const m = new Map<string, BuffRow[]>();
    const keyFor = (r: BuffRow) =>
      (r.raidGroup != null) ? `Group ${r.raidGroup}` : 'Not in raid';
    for (const r of filtered) {
      const k = keyFor(r);
      const arr = m.get(k);
      if (arr) arr.push(r); else m.set(k, [r]);
    }
    return [...m.entries()].sort((a, b) => {
      const an = a[0] === 'Not in raid', bn = b[0] === 'Not in raid';
      if (an !== bn) return an ? 1 : -1;                 // "Not in raid" last
      // Group 1, 2, … in numeric order.
      const ai = parseInt(a[0].replace('Group ', ''), 10);
      const bi = parseInt(b[0].replace('Group ', ''), 10);
      if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered]);

  // Character + 3 HP slots + category columns + Other + Synced.
  const colSpan = HP_SLOTS.length + categories.length + 3;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl text-gold">🧪 Buffs</h1>
          <p className="text-sm text-dim mt-1">
            Who&apos;s carrying what, right now — so buffers can see the gaps at a glance.
          </p>
        </div>
        <BuffLagButton source="web_buffs" />
      </div>

      {/* Accuracy caveat — load-bearing. There is NO way to read another
          player's buffs from their own client; the only data we have is what
          each agent uploads about its OWN character via Zeal. So this page is
          accurate exactly to the extent that each raider runs Mimic / the
          agent — for everyone else we're inferring from indirect signals
          (their last /who, their last appearance) and that's it. */}
      <div className="bg-[#3a1010] border-2 border-[#a3260a] text-[#fca5a5] rounded-lg p-3 text-sm">
        <div className="font-bold text-red-300 mb-1">⚠️ Read this before trusting any of these rows</div>
        We <b>cannot read another player&apos;s buffs from your log</b> — there is no way to.
        Every row here is sourced from the <b>character&apos;s own</b> Mimic / agent upload (via Zeal).
        For raiders <b>not running the agent</b>, we can only infer so much from indirect signals,
        and a blank cell means &quot;we don&apos;t know,&quot; <i>not</i> &quot;definitely missing.&quot;
        <br /><br />
        <b>Want an accurate accounting for your own characters?</b> Install Mimic
        (<a href="https://wolfpack.quest/mimic" className="text-blue underline">wolfpack.quest/mimic</a>) or
        run the local agent — their buffs + zone will sync within seconds. Open <code>localhost:7779</code> for your live view.
      </div>

      {/* Filters */}
      <div className="bg-panel border border-border rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-dim mr-1">Classes:</span>
          {classes.map(c => {
            const on = selectedClasses.has(c);
            return (
              <button
                key={c}
                onClick={() => toggleClass(c)}
                className={[
                  'px-2 py-0.5 rounded border text-xs transition-colors',
                  on ? 'bg-accent border-accent text-white' : 'bg-bg border-border text-dim hover:text-text',
                ].join(' ')}
              >
                {c}
              </button>
            );
          })}
          <button onClick={() => setSelectedClasses(new Set(classes))} className="text-[11px] text-blue hover:underline ml-1">all</button>
          <button onClick={() => setSelectedClasses(new Set())} className="text-[11px] text-blue hover:underline">none</button>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={onlyGaps} onChange={e => setOnlyGaps(e.target.checked)} />
            <span className="text-text">Only show characters with missing buffs</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={hideStale} onChange={e => setHideStale(e.target.checked)} />
            <span className="text-text">Hide logged-off (synced &gt;30m ago)</span>
          </label>
          <span className="text-dim ml-auto">{filtered.length} shown</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-panel border border-border rounded-lg p-6 text-center text-dim text-sm">
          {rows.length === 0
            ? 'No live buff data yet. Have raiders run Mimic / the agent with Zeal enabled — buffs sync automatically.'
            : 'No characters match the current filters.'}
        </div>
      ) : (
        <div className="bg-panel border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-dim border-b border-border">
                <th className="text-left p-2 sticky left-0 bg-panel">Character</th>
                {HP_SLOTS.map(slot => (
                  <th key={slot} className="p-2 text-center whitespace-nowrap border-l border-border/40" title={HP_SLOT_PROVIDER[slot]}>
                    {HP_SLOT_LABELS[slot]}
                  </th>
                ))}
                {categories.map(cat => (
                  <th key={cat} className="p-2 text-center whitespace-nowrap">{CATEGORY_LABELS[cat]}</th>
                ))}
                <th className="p-2 text-center">Other</th>
                <th className="p-2 text-right whitespace-nowrap">Synced</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([groupLabel, groupRows]) => {
                const isRaidGroup = groupLabel.startsWith('Group ');
                return (
                <Fragment key={groupLabel}>
                  <tr className="bg-bg/60">
                    <td colSpan={colSpan} className="px-2 py-1.5 text-[11px]">
                      <span className="text-gold">{isRaidGroup ? '👥' : '🛋️'} {groupLabel}</span>
                      <span className="text-dim"> · {groupRows.length} {groupRows.length === 1 ? 'character' : 'characters'}</span>
                      {!isRaidGroup && <span className="text-dim/70"> · parked / not in the raid window</span>}
                    </td>
                  </tr>
                  {groupRows.map(r => {
                    const target = ROLE_TARGETS[r.role] || [];
                    const stale = r.updatedAt ? (now - new Date(r.updatedAt).getTime()) > STALE_MS : true;
                    return (
                      <tr key={r.name} className={['border-b border-border/40', (stale && !r.noAgent) ? 'opacity-50' : ''].join(' ')}>
                        <td className="p-2 sticky left-0 bg-panel">
                          <div className="text-text flex items-center">
                            <span>{r.name}</span>
                            <CopyTargetButton name={r.name} />
                          </div>
                          <div className="text-dim text-[10px]">
                            {[r.className || 'Unknown', ROLE_LABELS[r.role]].join(' · ')}
                          </div>
                          {r.pet && (
                            <div className="text-[10px] mt-0.5 flex items-center gap-1" title={r.pet.buffs.map(b => b.name).join(', ')}>
                              <span className="text-orange shrink-0">🐾</span>
                              <span className="text-text/80 truncate max-w-[8rem]" title={r.pet.name}>{r.pet.name}</span>
                              {r.pet.hpPct != null && (
                                <span className={[petHpClass(r.pet.hpPct), 'tabular-nums shrink-0'].join(' ')}>{Math.round(r.pet.hpPct)}%</span>
                              )}
                              {r.pet.buffs.length > 0 && (
                                <span className="text-dim shrink-0">· {r.pet.buffs.length} buff{r.pet.buffs.length === 1 ? '' : 's'}</span>
                              )}
                            </div>
                          )}
                        </td>
                        {r.noAgent ? (
                          <td colSpan={HP_SLOTS.length + categories.length + 1} className="p-2 text-center text-dim/60 italic text-[11px]">
                            in the raid but not running the agent — buffs unknown
                          </td>
                        ) : (
                          <>
                            {HP_SLOTS.map(slot => {
                              const filled = r.hpSlots[slot];
                              return (
                                <td key={slot} className="p-2 text-center border-l border-border/40">
                                  {filled ? (
                                    <BuffChip name={filled} ticks={r.buffTicks?.[filled.toLowerCase()]} updatedAt={r.updatedAt} />
                                  ) : (
                                    <span className="text-red-400" title={'Missing — ' + HP_SLOT_PROVIDER[slot]}>— missing</span>
                                  )}
                                </td>
                              );
                            })}
                            {categories.map(cat => {
                              const names = r.byCategory[cat];
                              const present = (names?.length || 0) > 0;
                              const expected = target.includes(cat);
                              return (
                                <td key={cat} className="p-2 text-center">
                                  {present ? (
                                    <span title={names!.join(', ')}>
                                      <BuffChip name={names![0]} ticks={r.buffTicks?.[names![0].toLowerCase()]} updatedAt={r.updatedAt} />
                                      {names!.length > 1 ? <span className="text-green"> +{names!.length - 1}</span> : null}
                                    </span>
                                  ) : expected ? (
                                    <span className="text-red-400" title="Expected for this role — missing">— missing</span>
                                  ) : (
                                    <span className="text-dim/40">·</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="p-2 text-center" title={r.other.join(', ')}>
                              {r.other.length > 0 ? <span className="text-dim">{r.other.length}</span> : <span className="text-dim/40">·</span>}
                            </td>
                          </>
                        )}
                        <td className="p-2 text-right text-dim whitespace-nowrap">{r.noAgent ? '—' : ago(r.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-dim">
        The first three columns are the <b>HP buff slots</b> every raider wants filled —
        <b> POTG/Aego</b>, <b>Symbol</b>, and <b>Khura/Brell</b> (hover a header for who provides it).
        Aegolism fills both POTG and Symbol at once. Cells show the
        <span className="text-green"> buff&apos;s guild shorthand</span> (hover for the full name) plus its
        <span className="text-dim"> time left</span> from the raider&apos;s own Zeal feed —
        <span className="text-orange"> orange ≤6m</span> / <span className="text-red-400">red ≤2m</span> flags who needs a top-off soon ·
        <span className="text-red-400"> — missing</span> = expected but absent ·
        <span className="text-dim"> ·</span> not expected for the role ·
        grouped by live <b>raid group</b> (from the Zeal raid roster) ·
        click 📋 next to a name to copy <code>/target &lt;name&gt;</code> for pasting in EQ.
        The <b>Other</b> column counts buffs we couldn&apos;t categorize yet —
        hover it and send the names to an officer so we can map them. Target profiles per role are a
        starting point (<code>lib/buffs.ts</code>) and easy to tune.
      </p>
    </div>
  );
}
