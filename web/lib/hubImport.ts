// "My characters" on raidmimic.com, step 1 (DECISIONS §545): a signed-in player uploads the `<Name>-PoPFlags.txt` files
// Zeal writes on /camp, and the flags in them are stored against that player in hub_characters / hub_flags (person
// tables, no guild_id: supabase/migrations/20261102210000_hub_sync.sql). Nothing here touches a Wolf Pack table except
// one READ of `characters`, for the claim rule.
//
// Pure except through `ImportDeps`: every outside thing is passed in, so the cap, the claim rule and the file reader
// are tested without a database (test/hub-characters-import.test.js).
//
// The file is the agent's `parsePopFlagsFile` (packages/wolfpack-logsync/index.js), ported: header lines
// `Character<TAB>name` and `Timestamp<TAB>YYYY-MM-DD_HH-MM-SS`, a `---`, then the server's #popflags reply. The reply is
// read by web/lib/popFlagsPaste.ts, which test/pop-flags-live-parity.test.js holds equal to the agent's line table.
// Rows are the steps plus what each implies (STAGE_IMPLIES), exactly as the Wolf Pack paste save and hubSync write them.

import { parsePopFlags } from './popFlagsPaste';
import { STAGE_IMPLIES } from './popRecital';
import { decideClaim, type Holder } from './hubClaim';

/** Characters one player may hold by default. One constant: the request was "up to 8 by default, a setting". */
export const MAX_CHARACTERS_PER_PLAYER = 8;
export const MAX_FILE_BYTES = 128 * 1024;    // the agent's POPFLAGS_FILE_MAX_BYTES (Zeal keeps at most 400 lines)
export const MAX_FILES_PER_UPLOAD = 16;
/** Letters only, 3-24: the agent's NAME_RX / hubSync NAME_RX and hub_characters' own length check. */
export const NAME_RX = /^[A-Za-z]{3,24}$/;
export const SOURCE = 'popflags_file';
const FUTURE_SLACK_MS = 24 * 3600_000;
const FILE_TS_RX = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/;

export type ParsedExport = { character: string; atMs: number; lines: string[] };

/** The text of one export, or null when it is not one (no header, no `---`, a name or Timestamp that does not read).
 *  The Timestamp is read as UTC: the server cannot know the player's zone, and it only orders re-uploads. */
export function parseExportFile(text: string): ParsedExport | null {
  const rows = String(text || '').split(/\r?\n/);
  let character: string | null = null;
  let atMs: number | null = null;
  let i = 0;
  for (; i < rows.length && i < 8; i++) {
    if (rows[i] === '---') break;
    const tab = rows[i].indexOf('\t');
    if (tab < 0) return null;
    const key = rows[i].slice(0, tab);
    const val = rows[i].slice(tab + 1).trim();
    if (key === 'Character') character = val;
    else if (key === 'Timestamp') {
      const m = FILE_TS_RX.exec(val);
      if (m) {
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
        if (d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && d.getUTCHours() === +m[4]) atMs = d.getTime();
      }
    }
  }
  if (rows[i] !== '---' || !character || !NAME_RX.test(character) || atMs === null) return null;
  return { character, atMs, lines: rows.slice(i + 1).filter(l => l.trim()) };
}

export type FlagRow = { character: string; name_lc: string; flag_key: string; stage: string; source: string; earned_at: string };

/** One export → the flags it proves (steps, then what each implies), earned at the file's time but never later than now.
 *  `recognised` is how many reply lines read as #popflags output: 0 means this is some other text under a PoPFlags header. */
export function flagRowsFromExport(p: ParsedExport, nowMs: number): { rows: FlagRow[]; recognised: number } {
  const parsed = parsePopFlags(p.lines.join('\n'));
  const earnedAt = new Date(Math.min(p.atMs, nowMs)).toISOString();
  const rows: FlagRow[] = [];
  const seen = new Set<string>();
  const push = (flag_key: string, stage: string) => {
    if (seen.has(flag_key)) return;
    seen.add(flag_key);
    rows.push({ character: p.character, name_lc: p.character.toLowerCase(), flag_key, stage, source: SOURCE, earned_at: earnedAt });
  };
  for (const s of parsed.flags) {
    push(s, s);
    for (const k of STAGE_IMPLIES[s] ?? []) push(k, s);
  }
  return { rows, recognised: parsed.used.length };
}

// ── The import ───────────────────────────────────────────────────────────────

export type UploadFile = { name: string; text: string; size: number };
export type CharOutcome = { character: string; status: 'saved' | 'contested' | 'refused'; flags: number; reason?: string };
export type FileProblem = { file: string; message: string };
export type ImportResult = { ok: true; characters: CharOutcome[]; problems: FileProblem[] } | { ok: false; error: string };

export type ImportDeps = {
  playerId: string;
  discordId: string;
  now: () => number;
  /** name_lc of every character this player already holds. null = could not read. */
  heldNames: () => Promise<string[] | null>;
  /** Of these names (lower case), the Discord id Wolf Pack's characters table links each to. */
  wolfpackOwners: (lcs: string[]) => Promise<Map<string, string> | null>;
  /** Every hub_characters row for these names, all players. */
  holders: (lcs: string[]) => Promise<Map<string, Holder[]> | null>;
  insertCharacters: (rows: { player_id: string; name: string; name_lc: string; proof: string }[]) => Promise<string | null>;
  touchCharacters: (playerId: string, lcs: string[]) => Promise<string | null>;
  /** Every holder of these names whose proof is 'claimed' becomes 'contested'. */
  flipContested: (lcs: string[]) => Promise<string | null>;
  insertFlags: (rows: (FlagRow & { player_id: string })[]) => Promise<string | null>;
};

const unavailable: ImportResult = { ok: false, error: 'Could not save just now. Try again in a minute.' };

export async function importExports(files: UploadFile[], deps: ImportDeps): Promise<ImportResult> {
  const problems: FileProblem[] = [];
  if (files.length === 0) return { ok: false, error: 'Choose one or more PoPFlags files first.' };
  if (files.length > MAX_FILES_PER_UPLOAD) return { ok: false, error: `Up to ${MAX_FILES_PER_UPLOAD} files at a time.` };

  // 1. read the files; one per character (the later Timestamp wins when a character is uploaded twice in one go)
  const nowMs = deps.now();
  const byChar = new Map<string, { parsed: ParsedExport; rows: FlagRow[] }>();
  for (const f of files) {
    const label = f.name.slice(0, 80);
    if (f.size > MAX_FILE_BYTES) { problems.push({ file: label, message: 'Larger than 128 KB, so it is not a PoPFlags export.' }); continue; }
    const parsed = parseExportFile(f.text);
    if (!parsed) { problems.push({ file: label, message: 'Not a PoPFlags export (it needs the Character and Timestamp lines, then ---).' }); continue; }
    if (parsed.atMs > nowMs + FUTURE_SLACK_MS) { problems.push({ file: label, message: 'Its Timestamp is in the future.' }); continue; }
    const { rows, recognised } = flagRowsFromExport(parsed, nowMs);
    if (recognised === 0) { problems.push({ file: label, message: 'No #popflags lines in it.' }); continue; }
    const lc = parsed.character.toLowerCase();
    const prev = byChar.get(lc);
    if (!prev || parsed.atMs >= prev.parsed.atMs) byChar.set(lc, { parsed, rows });
  }
  if (byChar.size === 0) return { ok: true, characters: [], problems };

  // 2. the cap: names this player already holds do not count again; new ones fill what is left, the rest are refused
  const held = await deps.heldNames();
  if (!held) return unavailable;
  const heldSet = new Set(held);
  let slots = Math.max(0, MAX_CHARACTERS_PER_PLAYER - heldSet.size);
  const outcomes: CharOutcome[] = [];
  const candidates: string[] = [];
  for (const [lc, v] of byChar) {
    if (heldSet.has(lc)) { candidates.push(lc); continue; }
    if (slots > 0) { slots--; candidates.push(lc); continue; }
    outcomes.push({ character: v.parsed.character, status: 'refused', flags: 0,
      reason: `You already have ${MAX_CHARACTERS_PER_PLAYER} characters, the most one player can load.` });
  }

  // 3. the claim rule, per name
  if (candidates.length) {
    const owners = await deps.wolfpackOwners(candidates);
    const holders = await deps.holders(candidates);
    if (!owners || !holders) return unavailable;
    const live: string[] = [];
    const contested = new Set<string>();
    for (const lc of candidates) {
      const v = decideClaim({ playerId: deps.playerId, discordId: deps.discordId, wolfpackDiscordId: owners.get(lc), holders: holders.get(lc) });
      const name = byChar.get(lc)!.parsed.character;
      if (v.verdict === 'refused') {
        outcomes.push({ character: name, status: 'refused', flags: 0, reason: v.reason === 'wolfpack_linked'
          ? 'That name is linked to another Discord account in Wolf Pack.' : 'Another player has already proven that name.' });
        continue;
      }
      live.push(lc);
      if (v.verdict === 'contested') contested.add(lc);
    }

    // 4. write: the character rows, then everyone's contested flip, then the flags
    if (live.length) {
      const fresh = live.filter(lc => !heldSet.has(lc));
      const mine = live.filter(lc => heldSet.has(lc));
      if (fresh.length) {
        const err = await deps.insertCharacters(fresh.map(lc => ({
          player_id: deps.playerId, name: byChar.get(lc)!.parsed.character, name_lc: lc,
          proof: contested.has(lc) ? 'contested' : 'claimed',
        })));
        if (err) return unavailable;
      }
      if (mine.length && await deps.touchCharacters(deps.playerId, mine)) return unavailable;
      if (contested.size && await deps.flipContested([...contested])) return unavailable;
      const rows = live.flatMap(lc => byChar.get(lc)!.rows.map(r => ({ player_id: deps.playerId, ...r })));
      if (rows.length && await deps.insertFlags(rows)) return unavailable;
      for (const lc of live) {
        outcomes.push({ character: byChar.get(lc)!.parsed.character, status: contested.has(lc) ? 'contested' : 'saved', flags: byChar.get(lc)!.rows.length });
      }
    }
  }
  return { ok: true, characters: outcomes, problems };
}
