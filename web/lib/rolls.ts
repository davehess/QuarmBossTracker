// web/lib/rolls.ts — #91 roll-night review helpers (pure, unit-tested).
//
// Off-night NBG loot rolls are captured as roll_sets (grouped /random sets, one
// row per uploader who saw them) and the winner's/looter's own "You have looted"
// lines as looted_items. This module merges the multi-uploader roll rows, ranks
// winners the same way the agent does (first-roll-per-player, highest wins), and
// links a looted item back to its roll session by a TOLERANT item match inside a
// time window — because a roll session names its item loosely (the loot-link
// convention) while a looted line gives the exact display name, and because all
// loot is no-drop so the LOOTER often isn't the roll winner (re-rolls / passes).
//
// No React/Next imports here on purpose: the root vitest suite real-imports it.

export type RollEntry = { name: string; value: number; at?: string | null; reroll?: boolean };
export type RollSetRow = {
  roll_from: number;
  roll_to: number;
  item: string | null;
  qty: number | null;
  zone: string | null;
  rolls: RollEntry[] | null;
  started_at: string;
  last_at: string | null;
  uploaded_by_discord_id?: string | null;
};
export type LootedRow = {
  looter_character: string;
  item_name: string;
  zone: string | null;
  looted_at: string;
};
export type Winner = { name: string; value: number };
export type RollSession = {
  from: number;
  to: number;
  item: string | null;
  qty: number | null;
  zone: string | null;
  startMs: number;
  lastMs: number;
  rollers: number;
  winners: Winner[];
  rolls: { name: string; value: number; atMs: number; reroll: boolean }[];
};
export type LootMatch = { looter: string; at: string };

const SET_GAP_MS = 10 * 60 * 1000;
const STOPWORDS = new Set(['of', 'the', 'a', 'an']);

// Lowercase, drop a leading article, collapse punctuation to single spaces.
export function normalizeItemName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/^(?:an?|the)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Tolerant equality: exact-normalized, substring containment (loose roll naming
// like "velium battlehammer" ⊂ "primal velium battlehammer"), or ≥2 shared
// significant tokens (stopwords + short tokens filtered) — enough to link
// "Fungus Covered Scale Tunic" ↔ "Fungus Tunic" without matching
// "Ring of the Ancients" ↔ "Sword of the Ancients".
export function itemsMatch(a: string, b: string): boolean {
  const na = normalizeItemName(a);
  const nb = normalizeItemName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  const sig = (n: string) => new Set(n.split(' ').filter(t => t.length >= 3 && !STOPWORDS.has(t)));
  const ta = sig(na);
  const tb = sig(nb);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union > 0 ? shared / union : 0;
  return shared >= 2 || (shared >= 1 && jaccard >= 0.5);
}

function toMs(v: string | null | undefined, fallback: number): number {
  if (!v) return fallback;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : fallback;
}

// Merge multi-uploader roll_sets rows into logical sessions. Groups by range and
// clusters starts within SET_GAP_MS; unions rolls across uploaders (collapsing
// the same name+value seen within 5s); ranks winners by first-roll-per-player.
export function mergeRollSets(rows: RollSetRow[]): RollSession[] {
  type Acc = { from: number; to: number; startMs: number; lastMs: number; item: string | null; qty: number | null; zone: string | null; rolls: { name: string; value: number; atMs: number; reroll: boolean }[] };
  const norm: Acc[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const from = Number(r?.roll_from);
    const to = Number(r?.roll_to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const startMs = toMs(r?.started_at, NaN);
    if (!Number.isFinite(startMs)) continue;
    const rolls = (Array.isArray(r?.rolls) ? r.rolls : [])
      .map(x => ({ name: x?.name != null ? String(x.name) : '', value: Number(x?.value), atMs: toMs(x?.at, startMs), reroll: !!x?.reroll }))
      .filter(x => x.name && Number.isFinite(x.value));
    norm.push({ from, to, startMs, lastMs: toMs(r?.last_at, startMs), item: r?.item ?? null, qty: r?.qty ?? null, zone: r?.zone ?? null, rolls });
  }
  norm.sort((a, b) => (a.from - b.from) || (a.to - b.to) || (a.startMs - b.startMs));
  const merged: Acc[] = [];
  for (const r of norm) {
    const g = merged.find(m => m.from === r.from && m.to === r.to && Math.abs(m.startMs - r.startMs) <= SET_GAP_MS);
    if (g) {
      g.startMs = Math.min(g.startMs, r.startMs);
      g.lastMs = Math.max(g.lastMs, r.lastMs);
      if (!g.item && r.item) g.item = r.item;
      if (!g.qty && r.qty) g.qty = r.qty;
      if (!g.zone && r.zone) g.zone = r.zone;
      for (const roll of r.rolls) {
        const dupe = g.rolls.some(e => e.name.toLowerCase() === roll.name.toLowerCase() && e.value === roll.value && Math.abs(e.atMs - roll.atMs) < 5000);
        if (!dupe) g.rolls.push(roll);
      }
    } else {
      merged.push({ ...r, rolls: r.rolls.slice() });
    }
  }
  const out: RollSession[] = [];
  for (const g of merged) {
    const firstByName = new Map<string, Winner & { atMs: number }>();
    for (const roll of g.rolls) {
      const key = roll.name.toLowerCase();
      const prev = firstByName.get(key);
      if (!prev || roll.atMs < prev.atMs) firstByName.set(key, { name: roll.name, value: roll.value, atMs: roll.atMs });
    }
    const ranked = [...firstByName.values()].sort((a, b) => (b.value - a.value) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const nWinners = Math.max(1, Math.min(g.qty || 1, ranked.length));
    out.push({
      from: g.from, to: g.to, item: g.item, qty: g.qty, zone: g.zone,
      startMs: g.startMs, lastMs: g.lastMs, rollers: firstByName.size,
      winners: ranked.slice(0, nWinners).map(w => ({ name: w.name, value: w.value })),
      rolls: g.rolls.slice().sort((a, b) => b.value - a.value),
    });
  }
  out.sort((a, b) => b.lastMs - a.lastMs);
  return out;
}

// Looted items whose name matches the session's item and whose timestamp falls
// in the window after the roll resolved. Loot follows the roll, so the window is
// [lastMs − preSlackMs, lastMs + windowMs]. Returns matches sorted by time.
export function attributeLoot(session: RollSession, looted: LootedRow[], windowMs = 10 * 60 * 1000, preSlackMs = 2 * 60 * 1000): LootMatch[] {
  if (!session.item) return [];
  const lo = session.lastMs - preSlackMs;
  const hi = session.lastMs + windowMs;
  const hits: { looter: string; at: string; ms: number }[] = [];
  for (const l of Array.isArray(looted) ? looted : []) {
    const ms = Date.parse(l.looted_at);
    if (!Number.isFinite(ms) || ms < lo || ms > hi) continue;
    if (!itemsMatch(session.item, l.item_name)) continue;
    hits.push({ looter: l.looter_character, at: l.looted_at, ms });
  }
  hits.sort((a, b) => a.ms - b.ms);
  // Dedup by looter (a re-read could surface the same looter twice in-window).
  const seen = new Set<string>();
  const out: LootMatch[] = [];
  for (const h of hits) {
    const k = h.looter.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ looter: h.looter, at: h.at });
  }
  return out;
}

// True when a looter is NOT among the roll winners (case-insensitive) — the
// "looted by X" callout only shows when the person who took it differs.
export function looterDiffersFromWinners(looter: string, winners: Winner[]): boolean {
  const l = looter.toLowerCase();
  return !winners.some(w => w.name.toLowerCase() === l);
}

// YYYY-MM-DD calendar-day key for an ISO timestamp in the given IANA tz — used
// to bucket sessions into raid nights.
export function nightKey(iso: string, tz: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce((a, { type, value }) => { a[type] = value; return a; }, {} as Record<string, string>);
  return `${p.year}-${p.month}-${p.day}`;
}
