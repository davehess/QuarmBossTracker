// Who cannot enter tonight's raid targets: the pure mapping from the raid plan's data to the rows the "blockers
// strip" draws, and the text the Copy button puts on the clipboard for EverQuest chat. No database here: the page
// (or the design lab's fixture) hands in the plan, the flag catalog, the raiders and a has(name, key) answer.

export type PlanIn = { id: string; zoneName: string; needs: string[]; how?: string; expect?: string };
export type FlagIn = { key: string; short?: string | null; label?: string | null };
export type BlockedRaider = { name: string; missing: string[] };
export type ZoneBlockers = { id: string; zone: string; blocked: BlockedRaider[]; how: string; expect: string };
export type BlockersView = { zones: ZoneBlockers[]; raiders: number; blockedPeople: number };

/** A flag's name in a few words: its short name, else its label, else the bare key (never null or blank). */
export const flagName = (f: FlagIn | undefined, key: string): string => {
  const s = f?.short?.trim() || f?.label?.trim();
  return s || key;
};

/** One row per target zone: the raiders who lack a flag that zone needs, with what each lacks. Alphabetical, so a row never reshuffles. */
export function mapBlockers(
  plan: PlanIn[], flags: FlagIn[], raiders: { name: string }[], has: (name: string, key: string) => boolean,
): BlockersView {
  const byKey = new Map(flags.map((f) => [f.key, f]));
  const people = new Set<string>();
  const zones = plan.map((s) => {
    const blocked: BlockedRaider[] = [];
    for (const r of raiders) {
      const missing = s.needs.filter((k) => !has(r.name, k)).map((k) => flagName(byKey.get(k), k));
      if (missing.length) { blocked.push({ name: r.name, missing }); people.add(r.name); }
    }
    blocked.sort((a, b) => a.name.localeCompare(b.name));
    return { id: s.id, zone: s.zoneName, blocked, how: s.how ?? '', expect: s.expect ?? '' };
  });
  return { zones, raiders: raiders.length, blockedPeople: people.size };
}

/**
 * The names to paste into EverQuest chat: names only, ", " between, no trailing separator, in the order given
 * (duplicates dropped). Over `max` characters (one chat line is about 250) it keeps as many names as fit and ends
 * with "+N more".
 */
export function buildCopyText(names: string[], max = 250): string {
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const full = list.join(', ');
  if (full.length <= max) return full;
  for (let k = list.length - 1; k >= 0; k--) {
    const rem = list.length - k;
    const s = (k ? list.slice(0, k).join(', ') + ', ' : '') + `+${rem} more`;
    if (s.length <= max) return s;
  }
  return `+${list.length} more`;
}
