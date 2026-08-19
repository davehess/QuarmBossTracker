// web/lib/adoption.ts — pure transforms behind /admin/adoption (the PM funnel,
// Hitya 2026-08-18: "if you were a product manager justifying our product…").
//
// Everything counts PLAYERS (distinct discord ids), never characters — the
// standing rule (2026-08-16: "character counts mean almost nothing"). No
// React/Next imports; the root vitest suite real-imports it.
//
// Three funnels, deliberately separate:
//   conversion  — an existing raider starts contributing;
//   new-raider  — someone joins the guild and adopts during onboarding
//                 (joined_at within NEW_RAIDER_WINDOW_DAYS of first upload);
//   coverage    — of the fights on a raid night, how corroborated is each.

export type UploaderDay = { discord_id: string; day: string; uploads: number };
export type MemberRow = { discord_id: string; nickname: string | null; global_name: string | null; joined_at: string | null };
export type EncounterCountRow = { encounter_id: string; started_at: string; classification: string | null; uploaders: number };

const DAY_MS = 86_400_000;
export const NEW_RAIDER_WINDOW_DAYS = 60;

export function displayName(m: MemberRow | undefined, discordId: string): string {
  return m?.nickname || m?.global_name || `…${discordId.slice(-4)}`;
}

// ── Weekly active contributors ───────────────────────────────────────────────
// ISO-ish weeks anchored on Monday UTC — consistent buckets matter more than
// the anchor choice. The CURRENT week is flagged partial so a mid-week read
// never gets presented as a decline.
export function weeklyActive(rows: UploaderDay[], weeks = 12, now = Date.now()) {
  const weekOf = (ms: number) => {
    const d = new Date(ms);
    const dow = (d.getUTCDay() + 6) % 7;             // Mon=0
    return Date.parse(new Date(ms).toISOString().slice(0, 10)) - dow * DAY_MS;
  };
  const thisWeek = weekOf(now);
  const start = thisWeek - (weeks - 1) * 7 * DAY_MS;
  const byWeek = new Map<number, Set<string>>();
  for (const r of rows) {
    const t = Date.parse(r.day);
    if (!Number.isFinite(t) || t < start) continue;
    const w = weekOf(t);
    let s = byWeek.get(w);
    if (!s) { s = new Set(); byWeek.set(w, s); }
    s.add(r.discord_id);
  }
  const out = [];
  for (let w = start; w <= thisWeek; w += 7 * DAY_MS) {
    out.push({ weekStart: new Date(w).toISOString().slice(0, 10), players: byWeek.get(w)?.size ?? 0, partial: w === thisWeek });
  }
  return out;
}

// ── Activations (first-ever upload per player) ───────────────────────────────
export function firstUploadByPlayer(rows: UploaderDay[]): Map<string, number> {
  const firsts = new Map<string, number>();
  for (const r of rows) {
    const t = Date.parse(r.day);
    if (!Number.isFinite(t)) continue;
    const prev = firsts.get(r.discord_id);
    if (prev === undefined || t < prev) firsts.set(r.discord_id, t);
  }
  return firsts;
}

export type Activation = {
  discordId: string; firstMs: number;
  kind: 'new_raider' | 'converted' | 'unknown';
};

export function activations(rows: UploaderDay[], members: Map<string, MemberRow>): Activation[] {
  const out: Activation[] = [];
  for (const [discordId, firstMs] of firstUploadByPlayer(rows)) {
    const joined = members.get(discordId)?.joined_at;
    const joinedMs = joined ? Date.parse(joined) : NaN;
    let kind: Activation['kind'] = 'unknown';
    if (Number.isFinite(joinedMs)) {
      kind = (firstMs - joinedMs) <= NEW_RAIDER_WINDOW_DAYS * DAY_MS ? 'new_raider' : 'converted';
    }
    out.push({ discordId, firstMs, kind });
  }
  return out.sort((a, b) => a.firstMs - b.firstMs);
}

export function activationsByMonth(acts: Activation[]) {
  const byMonth = new Map<string, { total: number; new_raider: number; converted: number; unknown: number }>();
  for (const a of acts) {
    const mo = new Date(a.firstMs).toISOString().slice(0, 7);
    let e = byMonth.get(mo);
    if (!e) { e = { total: 0, new_raider: 0, converted: 0, unknown: 0 }; byMonth.set(mo, e); }
    e.total++; e[a.kind]++;
  }
  return [...byMonth.entries()].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
}

// ── Retention ────────────────────────────────────────────────────────────────
// "Eligible" = activated at least `matureDays` ago (young players can't churn
// yet); "retained" = uploaded inside the last `activeDays`.
export function retention(rows: UploaderDay[], now = Date.now(), matureDays = 28, activeDays = 14) {
  const firsts = firstUploadByPlayer(rows);
  const lastByPlayer = new Map<string, number>();
  for (const r of rows) {
    const t = Date.parse(r.day);
    const prev = lastByPlayer.get(r.discord_id) ?? -Infinity;
    if (t > prev) lastByPlayer.set(r.discord_id, t);
  }
  let eligible = 0, retained = 0;
  const churned: string[] = [];
  for (const [id, firstMs] of firsts) {
    if (now - firstMs < matureDays * DAY_MS) continue;
    eligible++;
    if ((lastByPlayer.get(id) ?? 0) >= now - activeDays * DAY_MS) retained++;
    else churned.push(id);
  }
  return { eligible, retained, pct: eligible ? Math.round((retained / eligible) * 100) : null, churned };
}

// ── Raid-night corroboration ─────────────────────────────────────────────────
// ONLY raid-window fights count — Mon/Tue solo grinding at 1.1 uploaders per
// "fight" is not a coverage signal (measured 2026-08-18 building this). A
// fight belongs to a raid night when its ET start, shifted back 6h so the
// after-midnight spill stays with its night, lands on Sun/Wed/Thu.
const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit',
});
export function raidNightKey(startedAtIso: string): string | null {
  const t = Date.parse(startedAtIso);
  if (!Number.isFinite(t)) return null;
  const parts = ET_FMT.formatToParts(new Date(t - 6 * 3_600_000))
    .reduce((a, p) => { a[p.type] = p.value; return a; }, {} as Record<string, string>);
  if (!['Sun', 'Wed', 'Thu'].includes(parts.weekday)) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function corroborationByNight(rows: EncounterCountRow[], nights = 6) {
  const byNight = new Map<string, { fights: number; uploaderSum: number; threePlus: number }>();
  for (const r of rows) {
    if (r.classification) continue;               // wipes/test/foreign excluded
    const key = raidNightKey(r.started_at);
    if (!key) continue;
    let e = byNight.get(key);
    if (!e) { e = { fights: 0, uploaderSum: 0, threePlus: 0 }; byNight.set(key, e); }
    e.fights++;
    e.uploaderSum += r.uploaders;
    if (r.uploaders >= 3) e.threePlus++;
  }
  return [...byNight.entries()]
    .map(([night, v]) => ({
      night, fights: v.fights,
      avgUploaders: v.fights ? Math.round((v.uploaderSum / v.fights) * 10) / 10 : 0,
      pct3plus: v.fights ? Math.round((v.threePlus / v.fights) * 100) : 0,
    }))
    .sort((a, b) => b.night.localeCompare(a.night))
    .slice(0, nights);
}

// ── Version spread (players at their latest-upload version) ──────────────────
export type StatRow = { uploaded_by_discord_id: string | null; agent_version: string | null; last_uploaded_at: string };

export function versionSpread(rows: StatRow[]) {
  const latest = new Map<string, { version: string; at: number }>();
  for (const r of rows) {
    if (!r.uploaded_by_discord_id || !r.agent_version) continue;
    const t = Date.parse(r.last_uploaded_at) || 0;
    const prev = latest.get(r.uploaded_by_discord_id);
    if (!prev || t > prev.at) latest.set(r.uploaded_by_discord_id, { version: r.agent_version, at: t });
  }
  const byVersion = new Map<string, number>();
  for (const { version } of latest.values()) byVersion.set(version, (byVersion.get(version) ?? 0) + 1);
  return [...byVersion.entries()]
    .map(([version, players]) => ({ version, players }))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

// ── Conversion targets — raided recently, never uploaded ─────────────────────
// The actionable list for "more contributors": fold tick attendees (characters)
// to players via characters.discord_id (walking one main_name hop), subtract
// everyone who has ever uploaded. Characters with no discord link are listed
// by name so an officer can chase the link on /admin/links.
export type CharLink = { name: string; main_name: string | null; discord_id: string | null };

export function conversionTargets(
  attendeeNames: string[],
  chars: CharLink[],
  uploaderIds: Set<string>,
) {
  const byLower = new Map(chars.map(c => [c.name.toLowerCase(), c]));
  const players = new Set<string>();
  const unlinked = new Set<string>();
  for (const raw of attendeeNames) {
    const c = byLower.get(String(raw).toLowerCase());
    if (!c) { unlinked.add(String(raw)); continue; }
    const root = c.main_name ? byLower.get(c.main_name.toLowerCase()) ?? c : c;
    const id = root.discord_id || c.discord_id;
    if (id) players.add(id); else unlinked.add(c.name);
  }
  const targets = [...players].filter(id => !uploaderIds.has(id));
  return { targets, unlinked: [...unlinked].sort() };
}
