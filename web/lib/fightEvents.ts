// Fight event-log assembly (docs/DESIGN-fight-timeline.md, 2026-08-16 §2 —
// Hitya's second-round review of /parses/d951b081): pure so the folding and
// filtering are testable, because every failure here renders as a plausible
// list. The three measured problems on that card:
//   • 67 of 126 events were stamped BEFORE the encounter's started_at (the
//     same-name trash merge attaches a neighboring pull's events), and the
//     old formatter clamped negatives to 0:00 — a wall of "0:00 RAMPAGE" rows;
//   • the Too Far / Can Not See personal-range family showed up as callouts
//     ("the too far/can't see callouts shouldn't be shown");
//   • "(copy)" trigger duplicates printed the same fire twice, and
//     alternating rampage targets defeated consecutive-run folding.

export type FightEventIn = {
  atMs: number;
  kind: 'death' | 'raid_event' | 'fire';
  label: string;
  detail?: string | null;
  subtype?: string | null;
};

export type FightEventRow = {
  t: number;          // epoch ms of first occurrence
  tLast: number;      // epoch ms of last occurrence folded into this row
  count: number;
  kind: FightEventIn['kind'];
  label: string;
  detail: string | null;
  subtype: string | null;
};

// The noisy personal-range triggers (the standing "Noisy eqlogparser
// triggers" set): they fire on YOUR positioning, not the raid's fight, and a
// shared timeline that lists them reads as raid events. Matched on the
// normalized label so "(copy)" clones fall in too.
const NOISE_RX = /^(?:too far|can ?not see|can not hit from here|out of range|range)$/i;

/** Strip any number of trailing " (copy)" suffixes — duplicated triggers
 *  otherwise print the same fire as two distinct rows forever. */
export function normalizeLabel(label: string): string {
  let l = String(label || '').trim();
  while (/\s*\(copy\)$/i.test(l)) l = l.replace(/\s*\(copy\)$/i, '').trim();
  return l;
}

export function isNoiseCallout(label: string): boolean {
  return NOISE_RX.test(normalizeLabel(label));
}

/**
 * Windowed fold: a row absorbs a later event with the same (kind, label,
 * detail) when the gap since that row's LAST occurrence is within windowMs —
 * even when other labels interleave. Consecutive-only folding fell apart the
 * moment two rampage targets alternated ("→ Moash / → Timberowl / → Moash…"),
 * which is exactly what trash waves produce. Each distinct target keeps its
 * own row, so the handover story survives; the spam does not.
 */
export function foldEvents(rows: FightEventIn[], windowMs = 45_000): FightEventRow[] {
  const sorted = [...rows].filter(r => Number.isFinite(r.atMs)).sort((a, b) => a.atMs - b.atMs);
  const out: FightEventRow[] = [];
  const open = new Map<string, FightEventRow>();
  for (const r of sorted) {
    const label = normalizeLabel(r.label);
    const key = `${r.kind}|${label}|${r.detail || ''}`;
    const prev = open.get(key);
    if (prev && r.atMs - prev.tLast <= windowMs) {
      prev.count += 1;
      prev.tLast = r.atMs;
    } else {
      const row: FightEventRow = {
        t: r.atMs, tLast: r.atMs, count: 1,
        kind: r.kind, label, detail: r.detail ?? null, subtype: r.subtype ?? null,
      };
      out.push(row);
      open.set(key, row);
    }
  }
  return out;   // already in first-occurrence order
}

export type EventLog = {
  main: FightEventRow[];
  /** Events stamped before the recorded pull (same-name trash merges attach a
   *  neighboring pull's events) — folded separately, shown collapsed with
   *  negative offsets rather than clamped onto 0:00. */
  early: FightEventRow[];
  noiseHidden: number;
};

export function buildEventLog(
  events: FightEventIn[],
  startMs: number,
  { windowMs = 45_000, preStartSlackMs = 5_000 }: { windowMs?: number; preStartSlackMs?: number } = {},
): EventLog {
  const kept: FightEventIn[] = [];
  let noiseHidden = 0;
  for (const e of events) {
    if (!Number.isFinite(e.atMs)) continue;
    if (e.kind === 'fire' && isNoiseCallout(e.label)) { noiseHidden++; continue; }
    kept.push(e);
  }
  const cutoff = startMs - preStartSlackMs;
  const early = kept.filter(e => e.atMs < cutoff);
  const main = kept.filter(e => e.atMs >= cutoff);
  return { main: foldEvents(main, windowMs), early: foldEvents(early, windowMs), noiseHidden };
}

/** mm:ss offset from the fight start; negative offsets keep their sign
 *  ("−1:23") instead of lying as 0:00. */
export function offsetLabel(atMs: number, startMs: number): string {
  const sec = Math.round((atMs - startMs) / 1000);
  const abs = Math.abs(sec);
  const s = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
  return sec < 0 ? `−${s}` : s;
}
