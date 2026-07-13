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

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import BuffLagButton from '@/components/BuffLagButton';
import {
  CATEGORY_LABELS, ROLE_TARGETS, ROLE_LABELS, HP_SLOTS, HP_SLOT_LABELS,
  RESIST_TYPES, RESIST_LABELS, UPGRADE_CHAINS, chainPosition, hasteRank,
  shortBuffName, fmtBuffRemaining, buffTimeTone, isCurseBuff,
  type BuffCategory, type Role, type HpSlotState, type ResistType,
} from '@/lib/buffs';

// Tone for a buff's live time-left — crit (refresh now) → low → ok. "unknown"
// renders the "?" chip dimmer + italic so it reads differently from a real
// countdown (Zeal couldn't capture a duration — usually a clickie/song).
const TIME_TONE_CLASS: Record<string, string> = {
  crit: 'text-red-400', low: 'text-orange', ok: 'text-dim', none: 'text-dim',
  unknown: 'text-dim italic',
};

export type RaidRow = {
  name: string;
  className: string | null;
  role: Role;
  raidGroup: number | null;
  raidIdx: number | null;        // which concurrent raid (0-based, biggest first)
  level: number | null;
  rank: string | null;           // '2' raid leader, '1' group leader
  inRaid: boolean;
  swappedTo: string | null;      // this client logged another character in
  noAgent: boolean;              // not running Mimic → unknown buff state
  zone: string | null;
  updatedAt: string | null;
  hpPct: number | null;          // live HP%: roster broadcast (any Mimic groupmate) or self-state HP
  manaPct: number | null;        // self-reported mana% (only when this raider runs Mimic; casters)
  buffCount: number;
  byCategory: Record<string, string[]>;
  // Rich per-category entries — { name, value, isSong }. A song like
  // McVaxius' Rousing Rondo contributes to haste / attack / ds with its
  // catalog magnitude so the detail panel can show "♪ song: Rondo +20%"
  // under each row it actually affects.
  categoryEntries: Record<string, { name: string; value: number | null; isSong: boolean }[]>;
  other: string[];
  // Per-school coverage, decoded from the spell catalog (SPA 46-50). value =
  // the resist amount; stacking = rides a non-colliding slot (White/Green
  // Petals) so it ADDS to the primary instead of competing for it.
  resists: Record<ResistType, { name: string; value: number | null; stacking: boolean; isSong?: boolean }[]>;
  songs: { name: string; ticks: number | null }[];  // bard songs currently landed
  hasDI: boolean;                // Divine Intervention on the buff bar
  chaCovered: boolean;           // any buff granting +CHA (DI's save rolls vs CHA)
  hpSlots: HpSlotState;
  tier: 'green' | 'upgradable' | 'yellow' | 'orange' | 'red' | 'unknown';
  buffs: { name: string; ticks: number | null }[];
  pet: PetState | null;          // live charm/summoned pet snapshot (Zeal)
  isMe: boolean;                 // the signed-in user's character
  hasMgb?: boolean;              // Mass Group Buff AA trained (from Quarmy export)
  isInferred?: boolean;          // buffs from observed casts (no Mimic), not Zeal-authoritative
};

export type PetState = {
  name: string;
  hpPct: number | null;
  buffs: { name: string; remaining_secs: number | null; total_secs: number | null; good: number | null }[];
};

const TIER_STYLE: Record<RaidRow['tier'], { bg: string; bar: string; label: string }> = {
  green:      { bg: 'bg-[#0f2a1a]/60', bar: 'bg-green',      label: 'fully buffed' },
  // Light green — everything covered, but at least one buff has a stronger
  // cast available (Aego when Ancient Aego exists, FoS vs Khura's, …).
  upgradable: { bg: 'bg-[#13301f]/50', bar: 'bg-[#7ee787]',  label: 'covered — upgradable' },
  yellow:     { bg: 'bg-[#2a2410]/60', bar: 'bg-[#d4a72c]',  label: 'minor gaps' },
  orange:     { bg: 'bg-[#2a1f10]/70', bar: 'bg-orange',     label: 'expiring soon' },
  red:        { bg: 'bg-[#2a1010]/70', bar: 'bg-red-500',    label: 'critical missing' },
  unknown:    { bg: 'bg-[#11151c]/60', bar: 'bg-dim',        label: 'no Mimic — unknown' },
};

// HP bar + HP% text coloring — green > 50% / amber > 20% / red ≤ 20%. Same
// thresholds as the charm + pet overlays so the visual signal is consistent.
function hpBarClass(p: number): string {
  if (p > 50) return 'bg-green';
  if (p > 20) return 'bg-orange';
  return 'bg-red-500';
}
function hpTextClass(p: number): string {
  if (p > 50) return 'text-green';
  if (p > 20) return 'text-orange';
  return 'text-red-400';
}

// Class → which buff categories that class provides. Drives the "I'm buffing
// as <class>" filter. First pass; tunable in lib/buffs.ts later.
const CLASS_PROVIDES: Record<string, BuffCategory[]> = {
  cleric:    ['hp', 'regen', 'resists'],
  druid:     ['hp', 'regen', 'runSpeed', 'ds', 'resists'],
  shaman:    ['hp', 'attack', 'haste', 'regen', 'resists'],
  enchanter: ['mana', 'manaRegen', 'haste', 'resists'],
  // Bard 'attack' dropped — group ATK comes from the epic Dance of the Blade
  // proc, which fires from normal melee anyhow. Bard buffs are group-ranged
  // (GroupV2, 100 range), so the queue scopes to their own group below.
  bard:      ['haste', 'runSpeed', 'manaRegen', 'ds'],
  paladin:   ['hp', 'resists'],
  ranger:    ['regen', 'ds'],
  beastlord: ['attack', 'regen'],
  magician:  ['ds'],
  wizard:    ['hp'],
};

// Which resist SCHOOLS each class can cover — drives per-school gaps in the
// buffer queue ("Resist Magic missing on Dafeet") instead of the generic
// resists bucket, which any one resist buff satisfied.
const CLASS_PROVIDES_RESISTS: Record<string, ResistType[]> = {
  enchanter: ['MR'],
  cleric:    ['MR', 'PR', 'DR'],
  druid:     ['FR', 'CR'],
  shaman:    ['CR', 'PR', 'DR'],
  paladin:   ['DR'],
  bard:      ['MR', 'FR', 'CR', 'PR', 'DR'],   // psalms cover every school
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

// The classes we offer in Buffer-mode. ALL classes are pickable so anyone can
// flip to "buffing as" their own (or whatever they're covering); support
// classes lead the strip since they're the common case. Classes with no group
// buffs simply produce an empty buff queue.
const BUFFER_CLASSES = [
  'Cleric', 'Druid', 'Shaman', 'Enchanter', 'Bard',
  'Paladin', 'Ranger', 'Beastlord', 'Magician',
  'Necromancer', 'Wizard', 'Shadow Knight', 'Warrior', 'Monk', 'Rogue',
] as const;
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

// Twitch Queue priority tier — who to feed mana first when several are low.
// Wizards + Enchanters (0), then Clerics (1), then everyone else (2).
function twitchTier(className: string | null): number {
  const c = (className || '').trim().toLowerCase();
  if (c === 'wizard' || c === 'enchanter') return 0;
  if (c === 'cleric') return 1;
  return 2;
}

// Mana bar colour by fullness — mirrors the Command Center overlay's cue.
function manaFillClass(pct: number): string {
  if (pct <= 20) return 'bg-red-500';
  if (pct <= 45) return 'bg-amber-500';
  return 'bg-blue';
}

export default function RaidView({
  rows, raidLabels, myClass, dsValues, ari, rosterMissing = false,
}: {
  rows: RaidRow[];
  raidLabels: string[];
  myClass: string | null;
  dsValues: Record<string, number>;
  // Auto-Raid-Invite registry (officer-set via Discord /ari, mirrored to
  // ari_state). null = not configured. Password intentionally not included.
  ari: { character: string; setByName: string | null; setAt: string | null } | null;
  // No Zeal type-5 raid snapshot from ANY uploader, yet we do have live-state
  // characters — the roster grid can't group anyone, so surface WHY instead of
  // a bare "No roster yet" (Uilnayar 2026-07-05: "lost Peopleslayer off the
  // raids tab and Bstie isn't here").
  rosterMissing?: boolean;
}) {
  // Default Buffer-mode class = the signed-in user's own class as detected in
  // the raid roster. Override is always available; some folks swap to help
  // cover a shortage and the chip strip lets them flip.
  const [bufferClass, setBufferClass] = useState<BufferClass | ''>(() => asBufferClass(myClass));
  const [selectedName, setSelectedName] = useState<string | null>(null);
  // Concurrent raids → one tab each (Raid 1 = biggest). Defaults to the raid
  // containing the signed-in user's character.
  const [activeRaid, setActiveRaid] = useState<number>(() => {
    const mine = rows.find(r => r.isMe && r.raidIdx != null);
    return mine?.raidIdx ?? 0;
  });
  const multiRaid = raidLabels.length > 1;
  // Rows visible under the active tab: the tab's raid + everything parked.
  const tabRows = useMemo(
    () => (multiRaid ? rows.filter(r => !r.inRaid || r.raidIdx === activeRaid || r.raidIdx == null) : rows),
    [rows, activeRaid, multiRaid],
  );
  // Headline counters for the ACTIVE raid (previously page-computed globals,
  // which is exactly how two concurrent raids blended together).
  const inRaidRows   = useMemo(() => tabRows.filter(r => r.inRaid), [tabRows]);
  const raidSize     = inRaidRows.length;
  const mimicCovered = inRaidRows.filter(r => !r.noAgent).length;
  const leaderRow    = inRaidRows.find(r => r.rank === '2') ?? null;
  const leaderName   = leaderRow?.name ?? null;
  const leaderClass  = leaderRow?.className ?? null;
  const groupLeaders = useMemo(() => {
    const m: Record<number, string> = {};
    for (const r of inRaidRows) {
      if (r.rank === '1' && r.raidGroup != null && m[r.raidGroup] == null) m[r.raidGroup] = r.name;
    }
    return m;
  }, [inRaidRows]);
  // Parking-lot threshold: characters unseen for >5 min get moved to the
  // "Not seen / offline" group (Uilnayar 2026-06-22 — "Not in raid implies
  // they're still online"). 5 min lines up with Mimic's live-state heartbeat
  // cadence; anything older than that is almost always logged out, not
  // just sitting in the parking lot. Default still hides stale rows from
  // the group; toggle brings them back in case an officer needs to audit.
  const [showStale, setShowStale] = useState(false);

  // Live page: re-runs the server component every 15s so freshly-cast buffs
  // show without a manual reload. router.refresh() preserves client state
  // (selected raider, buffer class, view) — only the data props re-render.
  // Paused while the tab is hidden.
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 15_000);
    return () => clearInterval(t);
  }, [router]);

  // Raiders currently afflicted by anything isCurseBuff() recognizes. Empty
  // until a Mimic-running raider's buff list includes a known curse name.
  // Counted separately so the tab can show a live badge ("Cursed · 3").
  const cursedRows = useMemo(() => {
    const out: { row: RaidRow; curses: { name: string; ticks: number | null }[] }[] = [];
    for (const r of tabRows) {
      const curses = (r.buffs || []).filter(b => isCurseBuff(b && b.name));
      if (curses.length > 0) out.push({ row: r, curses });
    }
    return out.sort((a, b) => a.row.name.localeCompare(b.row.name));
  }, [tabRows]);

  // Group by raid group. Parked alts → "Not seen / offline" bucket sorted
  // last. Stale parked characters (no live-state update in >5 min — logged
  // off, NOT just parked in raid) are hidden by default; staleHidden
  // carries the count for the toggle.
  const STALE_MS = 5 * 60 * 1000;
  // Swapped characters are exempt — "(swapped to X)" is the information.
  const isStale = (r: RaidRow) =>
    !r.inRaid && !r.swappedTo
    && (!r.updatedAt || (Date.now() - new Date(r.updatedAt).getTime()) > STALE_MS);
  const staleHidden = useMemo(() => tabRows.filter(isStale).length, [tabRows]); // eslint-disable-line react-hooks/exhaustive-deps
  const PARKED_GROUP_LABEL = 'Not seen / offline';
  const groups = useMemo(() => {
    const m = new Map<string, RaidRow[]>();
    const keyFor = (r: RaidRow) =>
      r.raidGroup != null ? `Group ${r.raidGroup}` : PARKED_GROUP_LABEL;
    for (const r of tabRows) {
      if (!showStale && isStale(r)) continue;
      const k = keyFor(r);
      const arr = m.get(k);
      if (arr) arr.push(r); else m.set(k, [r]);
    }
    return [...m.entries()].sort((a, b) => {
      const an = a[0] === PARKED_GROUP_LABEL, bn = b[0] === PARKED_GROUP_LABEL;
      if (an !== bn) return an ? 1 : -1;
      const ai = parseInt(a[0].replace('Group ', ''), 10);
      const bi = parseInt(b[0].replace('Group ', ''), 10);
      if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
      return a[0].localeCompare(b[0]);
    });
  }, [tabRows, showStale]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = selectedName ? rows.find(r => r.name === selectedName) ?? null : null;   // any raid — detail follows the click

  // Buffer-mode queue: rows missing a buff this class provides. Sorted by tier
  // severity (red → orange → yellow). PREVIEW — needs real timers to be useful.
  const bufferQueue = useMemo(() => {
    if (!bufferClass) return [];
    const cls = bufferClass.toLowerCase();
    const provides = CLASS_PROVIDES[cls] || [];
    const providesResists = CLASS_PROVIDES_RESISTS[cls] || [];
    if (provides.length === 0 && providesResists.length === 0) return [];
    const severity = { red: 0, orange: 1, yellow: 2, upgradable: 3, green: 4, unknown: 5 } as const;
    const out: { row: RaidRow; missing: BuffCategory[]; missingResists: ResistType[]; upgrades: string[]; diNeedsCha: boolean }[] = [];
    for (const r of tabRows) {
      if (!r.inRaid || r.noAgent) continue;
      const expected = ROLE_TARGETS[r.role] || [];
      const buffNames = r.buffs.map(b => b?.name).filter(Boolean) as string[];
      // Generic categories minus resists — those get per-school treatment so
      // "has Circle of Seasons" doesn't hide a missing Group Resist Magic.
      let missing = provides.filter(cat => cat !== 'resists' && expected.includes(cat) && !(r.byCategory[cat]?.length));
      const missingResists = providesResists.filter(t => !(r.resists[t]?.length));
      // HP slots are special — clerics/druids/shaman provide them, missing
      // counts even if the role-target categories all check out.
      const providesHp = provides.includes('hp');
      const missingHp = providesHp ? HP_SLOTS.filter(s => !r.hpSlots[s]) : [];
      // Upgrade chains (yellow): the category is "covered" but a better cast
      // exists in this class's book — Aego → Ancient Aego, FoS → Khura's,
      // JBoots → Bihli (melee/tank gets the ATK).
      const upgrades: string[] = [];
      for (const ch of UPGRADE_CHAINS) {
        if (!ch.classes.includes(cls)) continue;
        if (ch.roles && !ch.roles.includes(r.role)) continue;
        const pos = chainPosition(ch.chain, buffNames);
        if (pos >= 0 && pos < ch.chain.length - 1) upgrades.push(ch.label + ' ↑');
      }
      // Haste nuance (enchanter VoG, rank 7): a known LOWER haste = upgrade;
      // an UNKNOWN haste (item click) may be higher and would block VoG, so
      // flag it for a human look instead of asserting. EQ won't override a
      // higher-percentage haste — the raider must click theirs off first.
      if (cls === 'enchanter' && (r.byCategory.haste?.length ?? 0) > 0 && missing.indexOf('haste') === -1) {
        const best = Math.max(...(r.byCategory.haste || []).map(hasteRank));
        if (best > 0 && best < 7) upgrades.push('Haste ↑ VoG');
        else if (best === 0) upgrades.push('Haste? (item haste may block VoG)');
      }
      // DI's death save rolls against CHA — a tank carrying DI with no CHA
      // buff is a real gap for the classes that can fix it.
      const diNeedsCha = (cls === 'enchanter' || cls === 'shaman') && r.hasDI && !r.chaCovered;
      if (missing.length > 0 || missingHp.length > 0 || missingResists.length > 0 || upgrades.length > 0 || diNeedsCha) {
        out.push({ row: r, missing, missingResists, upgrades, diNeedsCha });
      }
    }
    // Severity by tier, but pure-upgrade rows (nothing missing) sink below
    // anything with a real gap.
    out.sort((a, b) => {
      const aGap = (a.missing.length + a.missingResists.length + (a.diNeedsCha ? 1 : 0)) > 0 ? 0 : 1;
      const bGap = (b.missing.length + b.missingResists.length + (b.diNeedsCha ? 1 : 0)) > 0 ? 0 : 1;
      if (aGap !== bGap) return aGap - bGap;
      return severity[a.row.tier] - severity[b.row.tier];
    });
    return out.slice(0, 30);
  }, [bufferClass, tabRows]);

  // Class counts — for the sidebar AND for the buffer-mode auto-detection of
  // useful classes. Only count in-raid characters.
  const classCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of tabRows) {
      if (!r.inRaid) continue;
      const k = r.className || 'Unknown';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [tabRows]);

  // Mana list — everyone in raid with a live self-mana reading (they run Mimic
  // and have a mana pool), highest first: a glance at "who still has gas".
  const manaList = useMemo(() =>
    tabRows.filter(r => r.inRaid && typeof r.manaPct === 'number')
           .sort((a, b) => (b.manaPct! - a.manaPct!) || a.name.localeCompare(b.name)),
    [tabRows]);
  // Twitch Queue — who to feed mana next: lowest mana up top, with Wizards +
  // Enchanters prioritized, then Clerics, then everyone else (Uilnayar
  // 2026-07-09). Same source list, re-sorted by twitch priority.
  const twitchQueue = useMemo(() =>
    manaList.slice().sort((a, b) =>
      twitchTier(a.className) - twitchTier(b.className)
      || (a.manaPct! - b.manaPct!)
      || a.name.localeCompare(b.name)),
    [manaList]);

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
        <div className="flex items-center gap-3 flex-wrap">
          <BuffLagButton source="web_raid" />
          <a href="/buffs" className="text-xs text-blue hover:underline">← classic /buffs view</a>
        </div>
      </div>

      {/* Zeal raid data missing — the grouped grid needs a type-5 "Raid"
          snapshot from at least one Mimic in the raid. When none is flowing
          (Raid output off in Zeal, or grouped-but-not-raided) everyone falls
          into "Not in raid" and it looks like people vanished. Say so. */}
      {rosterMissing && (
        <div className="bg-panel border border-orange/50 rounded-lg p-3 text-xs text-dim leading-relaxed">
          <span className="text-orange font-semibold">⚠ No Zeal raid roster is flowing.</span>{' '}
          The grouped view needs the <b className="text-text">Raid</b> data type from at least one raider&apos;s
          Mimic. If people you expect are missing here (but their <b className="text-text">/who</b> or buffs still
          show), it&apos;s almost always this. Two things to check on a raider whose Mimic is up:
          {' '}(1) they&apos;re in an actual <b className="text-text">raid</b>, not just a group; and
          {' '}(2) <b className="text-text">Raid</b> output is enabled in Zeal — the Mimic <b className="text-text">Zeal health</b> overlay
          flags it as <span className="text-orange">&ldquo;Optional types missing: Raid&rdquo;</span> when it&apos;s off.
          {' '}Anyone with live state still appears below under <b className="text-text">Not in raid</b>.
        </div>
      )}

      {/* Concurrent raids — one tab each. Only rendered when Zeal snapshots
          cluster into MORE than one raid (two crews running at once). */}
      {multiRaid && (
        <div className="flex items-center gap-2 flex-wrap">
          {raidLabels.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setActiveRaid(i)}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${activeRaid === i ? 'bg-[#1f6feb33] text-blue border-blue' : 'bg-panel text-dim border-border hover:border-blue'}`}
            >⚔️ {label}</button>
          ))}
        </div>
      )}

      {/* Coverage unlocks first — the "more Mimics = more capabilities" pitch.
          Front-and-center so it's the first thing a guildie sees. */}
      <CoverageUnlocks raidSize={raidSize} mimicCovered={mimicCovered} />

      {/* Raid leader + auto-raid-invite status. Leader comes from the Zeal
          raid roster (rank '2'); ARI from the officer-set Discord /ari
          registry (ari_state mirror). Three states:
            • ARI on the leader  → green "ON"
            • ARI on someone else → blue, named (common when a box leads)
            • not configured      → orange nudge with the command to run */}
      {(leaderName || ari) && (
        <div className="bg-panel border border-border rounded-lg p-3 text-xs flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {leaderName ? (
              <span>
                👑 <span className="text-gold">{leaderName}</span> is leading the raid.
                {leaderClass && <span className="text-dim"> · {leaderClass}</span>}
              </span>
            ) : (
              <span className="text-dim">👑 No raid leader detected yet (waiting on a Zeal roster snapshot).</span>
            )}
            {ari ? (
              leaderName && ari.character.toLowerCase() === leaderName.toLowerCase() ? (
                <span className="text-green border border-green/40 bg-green/10 rounded px-1.5 py-0.5"
                      title={`Auto-raid-invite configured${ari.setByName ? ' by ' + ari.setByName : ''}${ari.setAt ? ' · ' + new Date(ari.setAt).toLocaleString() : ''}. Send a tell to ${ari.character} for an invite — password is in Discord (/ari).`}>
                  /autoraidinvite ON
                </span>
              ) : (
                <span className="text-blue border border-blue/40 bg-blue/10 rounded px-1.5 py-0.5"
                      title={`Auto-raid-invite configured${ari.setByName ? ' by ' + ari.setByName : ''}${ari.setAt ? ' · ' + new Date(ari.setAt).toLocaleString() : ''}. Password is in Discord (/ari).`}>
                  ARI via <span className="font-semibold">{ari.character}</span>
                </span>
              )
            ) : (
              <span className="text-orange border border-orange/40 bg-orange/10 rounded px-1.5 py-0.5"
                    title="No auto-raid-invite registered. An officer can run /ari <character> <password> in Discord so members know whom to tell for an invite.">
                /autoraidinvite not set
              </span>
            )}
          </div>
          <span className="text-[10px] text-dim">tell {ari ? ari.character : 'the leader'} for an invite · password via Discord <code>/ari</code></span>
        </div>
      )}

      {/* Roster/Cursed tab boxes removed (2026-07-09) — the roster is the only
          view now, and cursed raiders surface in the debuff queue at the top.
          The cursed data (cursedRows) still feeds that queue below. */}
      <>
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
        <BufferQueues
          bufferClass={bufferClass as BufferClass}
          buffQueue={bufferQueue}
          debuffQueue={cursedRows}
          onSelect={(n) => setSelectedName(n)}
        />
      )}

      {/* The raid grid + sidebars */}
      <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr_320px] gap-4">
        {/* Left column — class counts, then the mana list + Twitch Queue. */}
        <div className="space-y-4">
          <ClassCountPanel counts={classCounts} raidSize={raidSize} />
          <ManaPanel rows={manaList} onSelect={(n) => setSelectedName(n)} />
          <TwitchQueuePanel rows={twitchQueue} onSelect={(n) => setSelectedName(n)} />
        </div>

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
                    {!isRaidGroup && <span className="text-dim/70 text-xs">no live signal in the last 5 minutes — likely offline</span>}
                    {!isRaidGroup && staleHidden > 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowStale(s => !s); }}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-border text-dim hover:text-text hover:border-blue"
                        title="Parked characters with no live data in the last 5 minutes are hidden by default — they're almost always logged off, not idling in raid."
                      >
                        {showStale ? `hide ${staleHidden} unseen >5m` : `show ${staleHidden} unseen >5m`}
                      </button>
                    )}
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
                        className={['relative px-3 py-1.5 text-xs cursor-pointer hover:bg-[#1a212c] transition-colors', style.bg, r.isMe ? 'ring-1 ring-blue/60' : ''].join(' ')}
                        onClick={() => setSelectedName(r.name)}
                      >
                        <div className="flex items-center gap-2">
                        <span className={['inline-block w-1 h-5 rounded-sm shrink-0', style.bar].join(' ')} />
                        <span className="text-text font-medium min-w-0 truncate">
                          {isLeader && <span title="Raid leader" className="text-gold">👑 </span>}
                          {isGrpLead && <span title="Group leader" className="text-blue">⭐ </span>}
                          {r.name}
                          {r.hasMgb && <span title="Mass Group Buff AA trained — Quarmy export" className="text-purple ml-1 text-[10px]">MGB</span>}
                          {r.isMe && <span title="That&apos;s you" className="text-blue ml-1">·</span>}
                          {r.swappedTo && (
                            <span className="text-dim font-normal ml-1.5" title={`This client logged ${r.swappedTo} in — ${r.name} is no longer playing`}>
                              (swapped to <span className="text-blue">{r.swappedTo}</span>)
                            </span>
                          )}
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
                        {r.hpPct != null && (
                          <span
                            className={['text-[10px] tabular-nums shrink-0', hpTextClass(r.hpPct)].join(' ')}
                            title={`HP ${Math.round(r.hpPct)}% — last group-pipe sample`}
                          >
                            {Math.round(r.hpPct)}%
                          </span>
                        )}
                        {r.noAgent
                          ? <span className="text-dim italic text-[10px] ml-auto">no Mimic</span>
                          : r.isInferred
                          ? <span className="text-blue italic text-[10px] ml-auto" title="Buffs inferred from observed casts a groupmate's Mimic witnessed — not Zeal-authoritative">inferred</span>
                          : (
                              <>
                                <span className="text-dim text-[10px] ml-auto">{r.buffCount} buffs</span>
                                <span className="text-dim text-[10px] w-16 text-right">{ago(r.updatedAt)}</span>
                              </>
                            )}
                        </div>
                        {r.pet && <PetLine pet={r.pet} />}
                        {r.hpPct != null && (
                          // 2px HP strip absolutely positioned at row bottom — doesn't
                          // affect row height. Green > 50% → amber > 20% → red. Null
                          // (no broadcaster yet) renders no strip at all.
                          <span
                            aria-hidden
                            className={['absolute left-0 bottom-0 h-[2px]', hpBarClass(r.hpPct)].join(' ')}
                            style={{ width: `${Math.max(0, Math.min(100, r.hpPct))}%` }}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {/* When every parked character is stale, the parking-lot section
              vanishes — keep the toggle reachable. */}
          {staleHidden > 0 && !groups.some(([l]) => l === PARKED_GROUP_LABEL) && (
            <section className="bg-panel border border-border/60 rounded-lg px-3 py-2 text-xs text-dim flex items-center justify-between">
              <span>🛋️ {staleHidden} character{staleHidden === 1 ? '' : 's'} unseen for &gt;5m (likely offline)</span>
              <button
                type="button"
                onClick={() => setShowStale(true)}
                className="px-1.5 py-0.5 rounded border border-border hover:text-text hover:border-blue"
              >show</button>
            </section>
          )}

          {/* Soon-but-not-yet feature teasers, all data-driven from what we
              already have or know how to add. Visible so we keep momentum. */}
          <ComingSoon />
        </div>

        {/* Side panel — character detail (real buffs/HP-slots/zone). Sticky on
            wide layouts so it tracks the viewport: click a raider near the
            bottom of a long roster and the detail stays in view instead of
            rendering way up at the column top. Own max-height + internal scroll
            so a tall detail (many buffs) is still fully reachable while pinned.
            Mobile (single column) stacks normally — no sticky. */}
        <aside className="bg-panel border border-border rounded-lg p-3 text-xs self-start lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          {!selected ? (
            <div className="text-dim text-center py-10">
              Click a raider to see their full buff state, missing slots, and a one-tap <code>/target</code> copy.
            </div>
          ) : (
            <CharacterDetail row={selected} dsValues={dsValues} onClose={() => setSelectedName(null)} />
          )}
        </aside>
      </div>
      </>
    </div>
  );
}

// ── Cursed panel ─────────────────────────────────────────────────────────────
// One-row-per-raider list of everyone with a known curse-type debuff in their
// buff window. Cure caster scans this on Vyzh`dra pulls (Gravel Rain) or any
// other curse mechanic; the longest-running curse goes red so the next cure
// is unambiguous. Empty state when nobody's afflicted is the happy path —
// shows the watched-curse list so the user knows what's being looked for.
function CursedPanel({ rows, onSelect }: {
  rows: { row: RaidRow; curses: { name: string; ticks: number | null }[] }[];
  onSelect: (name: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <section className="bg-panel border border-border rounded-lg p-6 text-center text-dim text-sm">
        <div className="text-2xl mb-2">✨</div>
        <div>No active curses across the raid.</div>
        <div className="text-[11px] text-dim mt-2">
          Tracks Gravel Rain, Curse of X, Venom of X, Splurt, Plague, and a handful of others. Send the buff-window name of any curse we&apos;re missing and we&apos;ll add it.
        </div>
      </section>
    );
  }
  return (
    <section className="bg-panel border border-border rounded-lg overflow-hidden">
      <header className="px-3 py-2 border-b border-border bg-[#1a1010]/40 flex items-baseline justify-between">
        <span className="text-sm text-red-300">🩸 Cursed ({rows.length})</span>
        <span className="text-[10px] text-dim">Live from Mimic buff windows · click a name for details</span>
      </header>
      <ul className="divide-y divide-border/40">
        {rows.map(({ row, curses }) => (
          <li
            key={row.name}
            className="px-3 py-2 hover:bg-[#1a1010]/40 cursor-pointer"
            onClick={() => onSelect(row.name)}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-text font-medium truncate">{row.name}</span>
                {row.className && <span className="text-[10px] text-dim">{row.className}</span>}
                {row.raidGroup != null && <span className="text-[10px] text-dim">G{row.raidGroup}</span>}
              </div>
              <span className="text-[10px] text-dim">{row.zone || '—'}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {curses.map((c, i) => {
                const tone = buffTimeTone(c.ticks);
                const remain = fmtBuffRemaining(c.ticks);
                return (
                  <span
                    key={c.name + ':' + i}
                    className={`text-[11px] px-1.5 py-0.5 rounded border ${tone === 'crit' ? 'bg-red-500/20 text-red-200 border-red-400/60' : tone === 'low' ? 'bg-orange/20 text-orange border-orange/50' : 'bg-[#2a1010]/50 text-red-300 border-red-400/30'}`}
                    title={`${c.name} · ${remain}`}
                  >
                    {shortBuffName(c.name)} <span className={`ml-1 text-[9px] ${TIME_TONE_CLASS[tone] || 'text-dim'}`}>{remain}</span>
                  </span>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
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

// The focused buffer work — two columns when a class is picked: BUFFS to apply
// (raiders missing a buff this class provides) on the left, DEBUFFS to cure
// (raiders carrying a known curse/debuff) on the right. A support caster's two
// jobs side by side: top up the missing buffs, clear the incoming debuffs.
function BufferQueues({
  bufferClass, buffQueue, debuffQueue, onSelect,
}: {
  bufferClass: BufferClass;
  buffQueue: { row: RaidRow; missing: BuffCategory[]; missingResists: ResistType[]; upgrades: string[]; diNeedsCha: boolean }[];
  debuffQueue: { row: RaidRow; curses: { name: string; ticks: number | null }[] }[];
  onSelect: (name: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Buff queue */}
      <div className="bg-panel border border-border rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-widest text-dim mb-2 flex items-center gap-1.5">
          <span className="text-green">🛡️ Buff queue</span>
          <span className="text-dim/70">· severity-first</span>
          {buffQueue.length > 0 && <span className="ml-auto text-dim normal-case tracking-normal">{buffQueue.length}</span>}
        </div>
        {buffQueue.length === 0 ? (
          <div className="text-xs text-dim">
            No gaps for a {bufferClass} to fill right now — every Mimic-running raider is covered. Untracked raiders still need eyes.
          </div>
        ) : (
          <ul className="text-xs space-y-1.5">
            {buffQueue.map(({ row, missing, missingResists, upgrades, diNeedsCha }) => (
              <li key={row.name} className="flex items-center gap-2 border-b border-border/40 pb-1.5 last:border-0">
                <span className={['inline-block w-1.5 h-5 rounded-sm shrink-0', TIER_STYLE[row.tier].bar].join(' ')} />
                <button
                  onClick={() => onSelect(row.name)}
                  className="text-text hover:text-blue underline-offset-2 hover:underline"
                >
                  {row.name}
                </button>
                {!row.noAgent && (
                  <span className="text-[9px] leading-none px-1 py-0.5 rounded bg-blue/15 text-blue border border-blue/30 shrink-0">🐺</span>
                )}
                <span className="text-dim text-[11px]">{row.className} · Grp {row.raidGroup ?? '?'}</span>
                <span className="ml-auto text-[11px] text-right">
                  <span className="text-dim">
                    {[
                      ...missing.map(c => CATEGORY_LABELS[c]),
                      ...missingResists.map(t => 'Resist ' + RESIST_LABELS[t]),
                      ...(diNeedsCha ? ['DI w/o CHA'] : []),
                    ].join(' · ') || (upgrades.length === 0 ? 'HP slot missing' : '')}
                  </span>
                  {upgrades.length > 0 && (
                    <span className="text-[#7ee787]" title="Covered but upgradable — light green means a better cast is available, not a gap. Yellow stays 'buffed but missing something non-critical'.">
                      {(missing.length + missingResists.length) > 0 ? ' · ' : ''}{upgrades.join(' · ')}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Debuff / cure queue */}
      <div className="bg-panel border border-border rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-widest text-dim mb-2 flex items-center gap-1.5">
          <span className="text-red-300">🩸 Debuff queue</span>
          <span className="text-dim/70">· cures needed</span>
          {debuffQueue.length > 0 && <span className="ml-auto text-dim normal-case tracking-normal">{debuffQueue.length}</span>}
        </div>
        {debuffQueue.length === 0 ? (
          <div className="text-xs text-dim">
            No active curses/debuffs across the raid. Curse-cure casters: this lights up the moment a Mimic raider reports one.
          </div>
        ) : (
          <ul className="text-xs space-y-1.5">
            {debuffQueue.map(({ row, curses }) => (
              <li key={row.name} className="flex items-center gap-2 border-b border-border/40 pb-1.5 last:border-0">
                <button
                  onClick={() => onSelect(row.name)}
                  className="text-text hover:text-red-300 underline-offset-2 hover:underline shrink-0"
                >
                  {row.name}
                </button>
                <span className="text-dim text-[11px] shrink-0">Grp {row.raidGroup ?? '?'}</span>
                <span className="ml-auto flex flex-wrap gap-1 justify-end">
                  {curses.map((c, i) => {
                    const tone = buffTimeTone(c.ticks);
                    const remain = fmtBuffRemaining(c.ticks);
                    return (
                      <span
                        key={c.name + ':' + i}
                        className={`text-[10px] px-1 py-0.5 rounded border ${tone === 'crit' ? 'bg-red-500/20 text-red-200 border-red-400/60' : tone === 'low' ? 'bg-orange/20 text-orange border-orange/50' : 'bg-[#2a1010]/50 text-red-300 border-red-400/30'}`}
                        title={`${c.name} · ${remain}`}
                      >
                        {shortBuffName(c.name)}
                        {remain && <span className={`ml-1 ${TIME_TONE_CLASS[tone] || 'text-dim'}`}>{remain}</span>}
                      </span>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Class-count sidebar — "what do we have in raid tonight, at a glance".
function ClassCountPanel({ counts, raidSize }: { counts: [string, number][]; raidSize: number }) {
  return (
    <aside className="bg-panel border border-border rounded-lg p-3 text-xs self-start">
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

// One compact mana row — name, class, a bar + %. Click opens the detail panel.
function ManaRow({ row, onSelect, rank }: { row: RaidRow; onSelect: (n: string) => void; rank?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(row.manaPct ?? 0)));
  return (
    <li
      className="flex items-center gap-1.5 cursor-pointer hover:bg-[#161b22] rounded px-1 -mx-1 py-0.5"
      onClick={() => onSelect(row.name)}
      title={`${row.name}${row.className ? ' · ' + row.className : ''} · ${pct}% mana`}
    >
      {rank != null && <span className="text-[9px] text-dim tabular-nums w-3.5 shrink-0">{rank}</span>}
      <span className="truncate text-text flex-1 min-w-0">{row.name}</span>
      <span className="h-2 w-10 rounded-sm bg-[#222] overflow-hidden shrink-0 border border-border/40">
        <span className={`block h-full ${manaFillClass(pct)}`} style={{ width: pct + '%' }} />
      </span>
      <span className="text-dim tabular-nums w-8 text-right shrink-0">{pct}%</span>
    </li>
  );
}

// Everyone's mana, highest first — "who still has gas".
function ManaPanel({ rows, onSelect }: { rows: RaidRow[]; onSelect: (n: string) => void }) {
  return (
    <aside className="bg-panel border border-border rounded-lg p-3 text-xs self-start">
      <div className="text-[10px] uppercase tracking-widest text-dim mb-2">Mana</div>
      {rows.length === 0 ? (
        <div className="text-dim italic">No mana data yet — fills from Mimic casters (Zeal pipe) and “% mana” macros called in /rs or /gu.</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map(r => <ManaRow key={r.name} row={r} onSelect={onSelect} />)}
        </ul>
      )}
    </aside>
  );
}

// Twitch Queue — who to feed mana next: lowest mana up top, Wizards +
// Enchanters prioritized, then Clerics, then the rest.
function TwitchQueuePanel({ rows, onSelect }: { rows: RaidRow[]; onSelect: (n: string) => void }) {
  return (
    <aside className="bg-panel border border-border rounded-lg p-3 text-xs self-start">
      <div className="text-[10px] uppercase tracking-widest text-dim mb-2">⚡ Twitch queue</div>
      {rows.length === 0 ? (
        <div className="text-dim italic">No mana data yet — the queue builds from the same reports as the Mana list.</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r, i) => <ManaRow key={r.name} row={r} onSelect={onSelect} rank={i + 1} />)}
        </ul>
      )}
    </aside>
  );
}

function TierLegend({ rows }: { rows: RaidRow[] }) {
  const counts = rows.reduce<Record<RaidRow['tier'], number>>(
    (acc, r) => { acc[r.tier]++; return acc; },
    { green: 0, upgradable: 0, yellow: 0, orange: 0, red: 0, unknown: 0 },
  );
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {(['green','upgradable','yellow','orange','red','unknown'] as const).map(t =>
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

// M:SS from a remaining-seconds count (pet buffs carry seconds, not ticks).
function fmtPetSecs(s: number | null): string {
  if (s == null) return '';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

// Compact pet stats line shown under a pet owner: name + HP% + buff chips
// (green buff / red debuff, with time-left). Drives "pet stats lines" on /raid.
function PetLine({ pet }: { pet: PetState }) {
  return (
    <div className="flex items-center gap-1.5 pl-3 mt-0.5 text-[10px] text-dim">
      <span className="text-orange shrink-0">🐾</span>
      <span className="text-text/90 truncate max-w-[10rem] shrink-0" title={pet.name}>{pet.name}</span>
      {pet.hpPct != null && (
        <span className={[hpTextClass(pet.hpPct), 'tabular-nums shrink-0'].join(' ')}>{Math.round(pet.hpPct)}%</span>
      )}
      {pet.buffs.length === 0 ? (
        <span className="text-dim/60 italic">no tracked buffs</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {pet.buffs.slice(0, 8).map((b, i) => {
            const col = b.good === 0 ? 'text-red-400 border-red-400/40' : 'text-green border-green/30';
            const rem = b.remaining_secs != null ? fmtPetSecs(b.remaining_secs) : '';
            return (
              <span key={b.name + ':' + i} className={`px-1 rounded border ${col}`} title={b.name + (rem ? ' · ' + rem + ' left' : '')}>
                {shortBuffName(b.name)}{rem && <span className="ml-1 opacity-80 tabular-nums">{rem}</span>}
              </span>
            );
          })}
        </span>
      )}
    </div>
  );
}

function CharacterDetail({ row, dsValues, onClose }: { row: RaidRow; dsValues: Record<string, number>; onClose: () => void }) {
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
    const titleSuffix = tone === 'unknown' ? ' · duration unknown' : t ? ` · ${t} left` : '';
    return (
      <span className="truncate" title={name + titleSuffix}>
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
          {row.isInferred && (
            <div className="text-blue text-[11px] italic border border-blue/30 bg-blue/5 rounded p-2">
              Not running Mimic — these buffs are inferred from observed casts a groupmate&apos;s Mimic witnessed.
              Group V2 buffs that landed on a Mimic raider in this group are credited to {row.name} too.
              Timers are accurate; anything cast outside the group&apos;s Mimic coverage stays invisible.
            </div>
          )}
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
              ones flagged. Resists get their own per-school section below.
              Songs that contribute via SPA effects (Rondo → haste+attack+DS,
              Psalm of Warmth → CR+DS+AC, …) appear as sub-lines under each
              category they actually touch, with their catalog magnitude. */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-dim mb-1">Buff categories</div>
            <ul className="space-y-1">
              {(['regen','mana','manaRegen','haste','runSpeed','attack','levitate'] as BuffCategory[]).map(cat => {
                const entries = row.categoryEntries?.[cat] || [];
                const names = row.byCategory[cat] || [];
                const primaries = entries.filter(e => !e.isSong);
                const songs     = entries.filter(e => e.isSong);
                const present = names.length > 0;
                const exp = expected.includes(cat);
                if (!exp && !present) return null;
                const isHasteLike = cat === 'haste';
                const fmtVal = (v: number | null) => v != null
                  ? '+' + v + (isHasteLike ? '%' : '')
                  : '';
                return (
                  <li key={cat} className="text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="text-dim w-20 shrink-0">{CATEGORY_LABELS[cat]}</span>
                      {present
                        ? primaries.length > 0
                          ? <span className="flex items-center gap-1 min-w-0" title={names.join(', ')}>
                              <BuffChip name={primaries[0].name} />
                              {primaries[0].value != null && <span className="text-green tabular-nums shrink-0">{fmtVal(primaries[0].value)}</span>}
                              {primaries.length > 1 ? <span className="text-green shrink-0">+{primaries.length - 1}</span> : null}
                            </span>
                          : <span className="text-dim italic">song only ↓</span>
                        : <span className="text-red-400">— missing</span>}
                    </div>
                    {songs.map((e, i) => (
                      <div key={'song:' + e.name + ':' + i} className="flex items-center gap-2 pl-20 ml-2 text-[10px]">
                        <span className="text-purple" title="Bard song — stacks on top of the slot-1 primary buff">♪ song:</span>
                        <BuffChip name={e.name} />
                        {e.value != null && <span className="text-green tabular-nums">{fmtVal(e.value)}</span>}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Resists — all five schools, with the resist amount decoded from
              the spell catalog. Stacking buffs (White/Green Petals — they
              ride a non-colliding slot) render on their own line under the
              primary, since they ADD instead of competing. */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-dim mb-1">
              Resists ({RESIST_TYPES.filter(t => row.resists[t]?.length).length}/5)
            </div>
            <ul className="space-y-1">
              {RESIST_TYPES.map(t => {
                const entries = row.resists[t] || [];
                // Bard songs land in the SONG window (separate from buffs)
                // and stack with everything; pull them out so each gets its
                // own line under the primary buff. White/Green Petals etc.
                // (catalog "stacking" entries) stay on their own line too.
                const songs    = entries.filter(e => e.isSong);
                const stackers = entries.filter(e => !e.isSong && e.stacking);
                const primaries = entries.filter(e => !e.isSong && !e.stacking);
                const total = entries.reduce((s, e) => s + (e.value ?? 0), 0);
                return (
                  <li key={t} className="text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="text-dim w-20 shrink-0">{RESIST_LABELS[t]}</span>
                      {entries.length === 0
                        ? <span className="text-red-400">— missing</span>
                        : primaries.length > 0
                          ? <span className="flex items-center gap-1 min-w-0" title={primaries.map(e => `${e.name}${e.value != null ? ' +' + e.value : ''}`).join(', ')}>
                              <BuffChip name={primaries[0].name} />
                              {primaries[0].value != null && <span className="text-green tabular-nums shrink-0">+{primaries[0].value}</span>}
                              {primaries.length > 1 ? <span className="text-dim shrink-0">+{primaries.length - 1} more</span> : null}
                            </span>
                          : <span className="text-dim italic">{songs.length > 0 ? 'song only ↓' : 'stacking only ↓'}</span>}
                      {total > 0 && (primaries.length + stackers.length + songs.length) > 1 && (
                        <span className="text-green text-[10px] tabular-nums ml-auto shrink-0" title="Sum of all listed resist buffs for this school">Σ {total}</span>
                      )}
                    </div>
                    {songs.map((e, i) => (
                      <div key={'song:' + e.name + ':' + i} className="flex items-center gap-2 pl-20 ml-2 text-[10px]">
                        <span className="text-purple" title="Bard song — lands in the song window (stacks with everything)">♪ song:</span>
                        <BuffChip name={e.name} />
                        {e.value != null && <span className="text-green tabular-nums">+{e.value}</span>}
                      </div>
                    ))}
                    {stackers.map((e, i) => (
                      <div key={e.name + ':' + i} className="flex items-center gap-2 pl-20 ml-2 text-[10px]">
                        <span className="text-dim">stacks:</span>
                        <BuffChip name={e.name} />
                        {e.value != null && <span className="text-green tabular-nums">+{e.value}</span>}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Divine Intervention save rolls against CHARISMA — a tank with DI
              but no CHA buff is leaving the save to base stats. Enchanter /
              shaman queues flag this too. */}
          {row.hasDI && !row.chaCovered && (
            <div className="text-[11px] rounded border border-orange/50 bg-orange/10 px-2 py-1.5">
              ⚠ <span className="text-orange">Divine Intervention without a CHA buff</span>
              <span className="text-dim"> — the death save rolls vs Charisma. Enchanter/Shaman: land a CHA buff.</span>
            </div>
          )}

          {/* Damage shields — every DS stacks, so list EACH slot with its
              magnitude (SPA 59 decoded from the spell catalog) + the total. */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-dim mb-1">
              Damage shields
              {(row.byCategory.ds?.length ?? 0) > 0 && (() => {
                const total = (row.byCategory.ds || []).reduce((s, n) => s + (dsValues[n] ?? 0), 0);
                return total > 0 ? <span className="text-green normal-case tracking-normal"> · {total} total</span> : null;
              })()}
            </div>
            {(row.byCategory.ds?.length ?? 0) === 0 ? (
              expected.includes('ds')
                ? <div className="text-[11px] text-red-400">— missing</div>
                : <div className="text-[11px] text-dim italic">none</div>
            ) : (
              <ul className="space-y-1">
                {(row.byCategory.ds || []).map((n, i) => (
                  <li key={n + ':' + i} className="flex items-center gap-2 text-[11px]">
                    <BuffChip name={n} />
                    <span className="text-green tabular-nums ml-auto" title="Catalog damage-shield value (highest rank sharing this name)">
                      {dsValues[n] != null ? `+${dsValues[n]}` : '+?'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Bard songs currently landed (Zeal's 6-slot song window; name
              heuristic for raiders on a pre-3.1.12 agent). */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-dim mb-1">
              Songs ({Math.min(row.songs.length, 6)}/6)
            </div>
            {row.songs.length === 0 ? (
              <div className="text-[11px] text-dim italic">no songs landed</div>
            ) : (
              <ul className="space-y-1">
                {row.songs.slice(0, 6).map((s, i) => (
                  <li key={s.name + ':' + i} className="text-[11px]">
                    <BuffChip name={s.name} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {row.other.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-dim mb-1">Other ({row.other.length})</div>
              <div className="text-[11px] text-dim leading-5">{row.other.join(' · ')}</div>
            </div>
          )}

          {row.pet && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-dim mb-1 flex items-center gap-1">
                <span className="text-orange">🐾 Pet</span>
                <span className="text-text normal-case tracking-normal">{row.pet.name}</span>
                {row.pet.hpPct != null && (
                  <span className={[hpTextClass(row.pet.hpPct), 'tabular-nums normal-case tracking-normal'].join(' ')}>
                    {Math.round(row.pet.hpPct)}%
                  </span>
                )}
              </div>
              {row.pet.buffs.length === 0 ? (
                <div className="text-[11px] text-dim italic">No tracked pet buffs. /pet health + a Mimic-running buffer nearby fills this in.</div>
              ) : (
                <ul className="space-y-1">
                  {row.pet.buffs.map((b, i) => {
                    const rem = b.remaining_secs != null ? fmtPetSecs(b.remaining_secs) : '';
                    return (
                      <li key={b.name + ':' + i} className="flex items-center gap-2 text-[11px]">
                        <span className={b.good === 0 ? 'text-red-400' : 'text-green'}>{shortBuffName(b.name)}</span>
                        {rem && <span className="text-dim tabular-nums ml-auto">{rem}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
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
  // Collapsed by default once we've passed the 50% mark — the pitch ladder has
  // diminishing real-time value when most of the raid is already on Mimic, and
  // the header card stays useful at a glance.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const v = window.localStorage.getItem('wp:raid:coverage:collapsed');
    if (v === '1') return true;
    if (v === '0') return false;
    return pct >= 50;
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('wp:raid:coverage:collapsed', collapsed ? '1' : '0');
    }
  }, [collapsed]);
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
      {dramatic && !collapsed && (
        <div className="text-sm text-text leading-6 italic mb-3">
          <span className="text-gold">Imagine</span> a world where your buffs were
          always accounted for and your buffing duties were crystal clear without
          extra tells.{' '}
          <span className="text-dim not-italic">Each raider on Mimic unlocks more of it for the whole pack.</span>
        </div>
      )}

      <div className="flex items-baseline justify-between gap-2 mb-2">
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          aria-expanded={!collapsed}
          className="flex items-baseline gap-2 text-left hover:opacity-90"
          title={collapsed ? 'Expand Mimic coverage' : 'Collapse Mimic coverage'}
        >
          <span className="text-dim text-xs leading-none" aria-hidden>{collapsed ? '▸' : '▾'}</span>
          <div>
            <div className="text-xs uppercase tracking-widest text-dim">Mimic coverage</div>
            <div className="text-2xl text-text">{mimicCovered}<span className="text-dim text-sm"> / {raidSize || '?'}</span>
              {' '}<span className={['text-sm', pct >= 80 ? 'text-green' : pct >= 50 ? 'text-[#d4a72c]' : pct >= 25 ? 'text-orange' : 'text-red-400'].join(' ')}>({pct}%)</span>
            </div>
          </div>
        </button>
        {!collapsed && (
          <div className="text-[11px] text-dim text-right max-w-[20rem]">
            Mimic is free and silent. Install from{' '}
            <a href="/mimic" target="_blank" rel="noreferrer" className="text-blue hover:underline">wolfpack.quest/mimic</a>.
            Settings + token persist across upgrades.
          </div>
        )}
      </div>

      {/* Big coverage bar — kept visible even when collapsed; it's the headline number. */}
      <div className={['h-2 bg-bg rounded-full overflow-hidden', collapsed ? '' : 'mb-3'].join(' ')}>
        <div
          className={['h-full transition-all', pct >= 80 ? 'bg-green' : pct >= 50 ? 'bg-[#d4a72c]' : pct >= 25 ? 'bg-orange' : 'bg-red-500'].join(' ')}
          style={{ width: pct + '%' }}
        />
      </div>

      {collapsed ? null : (<>

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
      </>)}
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
