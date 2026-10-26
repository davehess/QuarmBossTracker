// Facts about the characters on THIS PC that the local inventory page (web/local, "On this PC") acts on, as pure
// functions so they are tested (test/local-accounts.test.js) and the page only wires them to buttons.
// The agent supplies the raw times (inventory file write time, first and last line of the character's EQ log);
// every decision lives here. Nothing in this file reads a file or the clock: `nowMs` is passed in.

export type CharacterFacts = {
  name: string;
  /** When the character's <Name>-Inventory.txt was last written (ISO), or null when unknown. */
  observed_at: string | null;
  /** The first and last timestamped line of the character's own EQ log (ISO), or null when there is no log. */
  log_first_at?: string | null;
  log_last_at?: string | null;
};

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * ONE-OFF characters (the guild lead, 2026-10-26: "some characters are made for a single thing and then never
 * used or seen again"): a character whose WHOLE log spans under a day and which has not been seen for 30+ days.
 * Both halves are needed. A short log alone describes a new character; silence alone describes any alt that
 * is parked. Together they describe "made, used once, abandoned". A character with no log on this PC is never
 * called one-off (no evidence either way), and neither is one with a log we could not read the ends of.
 * The log is the evidence, not the inventory file's date: a mule that has been played for more than a day in
 * total is never one-off, however long ago that was.
 */
export const ONE_OFF_MAX_SPAN_MS = DAY_MS;
export const ONE_OFF_IDLE_MS = 30 * DAY_MS;

/**
 * STALE snapshots: the character's log shows activity AFTER its inventory file was last written, so the file
 * does not describe what the character holds now. `#charactertransfer` is the sharp case (it linkdeads the
 * character, and the new account's bank only reaches the file the next time they log in), but a /quit that
 * never finished, a lost connection, a freeze on zoning, or simply playing after the last /outputfile all read
 * the same way, so one rule covers them: no new log strings, only two times compared.
 * The grace covers the export's own echo: running `/outputfile inventory` prints to the log a moment after the
 * file is written, and the two clocks (log line seconds, file mtime) are not the same clock.
 */
export const STALE_GRACE_MS = 2 * 60_000;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Made, used for under a day, then not seen for 30+ days. */
export function isOneOff(f: CharacterFacts, nowMs: number): boolean {
  const first = ms(f.log_first_at), last = ms(f.log_last_at);
  if (first === null || last === null || last < first) return false;
  return last - first < ONE_OFF_MAX_SPAN_MS && nowMs - last >= ONE_OFF_IDLE_MS;
}

/** The log shows play after the inventory file's last write (beyond the grace). False when either time is unknown. */
export function isSnapshotStale(f: CharacterFacts): boolean {
  const wrote = ms(f.observed_at), last = ms(f.log_last_at);
  if (wrote === null || last === null) return false;
  return last - wrote > STALE_GRACE_MS;
}

export type CharacterVerdicts = {
  /** Lowercased names, for matching against rows. */
  oneOff: Set<string>;
  stale: Set<string>;
};

export function classifyCharacters(chars: CharacterFacts[], nowMs: number): CharacterVerdicts {
  const oneOff = new Set<string>(), stale = new Set<string>();
  for (const c of chars) {
    const k = c.name.toLowerCase();
    if (isOneOff(c, nowMs)) oneOff.add(k);
    if (isSnapshotStale(c)) stale.add(k);
  }
  return { oneOff, stale };
}

/**
 * Take the named characters out of the aggregation: their own equipped / bag / bank rows go. Their
 * shared-bank rows stay, because the shared bank belongs to the game account, which other characters use too.
 */
export function dropCharacters<T extends { character_name: string; slot_label: string }>(rows: T[], hide: ReadonlySet<string>): T[] {
  if (hide.size === 0) return rows;
  return rows.filter(r => !hide.has(r.character_name.toLowerCase()) || /^SharedBank/i.test(r.slot_label));
}
