// Typed confirms for the officer pages' irreversible and fleet-wide moves (the guild lead, 2026-10-31, DECISIONS §493:
// "all of the catastrophic or destructive moves down the bottom in red barriers"). The officer types a phrase and the
// SERVER compares it: the page only shows the phrase, so a hand-built POST with the wrong one (or none) is refused too.
//
// One rule everywhere: the phrase is trimmed and then compared exactly (case and spacing as shown). Clearing a
// mitigation never asks for one: the console's rule (web/app/admin/console/actions.ts) is that taking a lever back
// must always be easier than pulling it.
//
// Pure on purpose (no server imports), so the page, the actions and test/admin-shell.test.js share one definition.

/** `flag_agent_kill` → the existing console phrase; `flag_shed_<kind>` → `SHED <kind>`; the version floor → `FLOOR`. */
export const PAUSE_FLEET_PHRASE = 'PAUSE FLEET';
export const FLOOR_PHRASE = 'FLOOR';
export const MERGE_PHRASE = 'MERGE';

export const AGENT_KILL_KEY = 'flag_agent_kill';
export const VERSION_FLOOR_KEY = 'min_agent_ver_num';
const SHED_PREFIX = 'flag_shed_';

/** The data streams the bot can be told to 200-ack and drop (the bot's `_SHED_NEVER` in index.js keeps the durable ones off this list). */
export const SHED_KINDS = [
  'live_state', 'raid_roster', 'casting', 'threat_snapshot', 'buff_casts', 'pvp', 'pvp_assists',
  'fun_event', 'trigger_relay', 'ui_layout', 'tells',
] as const;

/** Every flag the Danger pane on /admin/overlays sets: the fleet pause and one shed per stream. The version floor is a
 *  number, not a flag, so it is not in this list. */
export const DANGER_FLAG_KEYS: readonly string[] = [AGENT_KILL_KEY, ...SHED_KINDS.map(k => SHED_PREFIX + k)];

/** The phrase a danger-pane control asks for, or null when the key is not one of them. */
export function dangerPhrase(key: string): string | null {
  if (key === AGENT_KILL_KEY) return PAUSE_FLEET_PHRASE;
  if (key === VERSION_FLOOR_KEY) return FLOOR_PHRASE;
  if (DANGER_FLAG_KEYS.includes(key)) return `SHED ${key.slice(SHED_PREFIX.length)}`;
  return null;
}

/** True when what was typed is the phrase. An empty phrase never matches (a missing name must not confirm a delete). */
export function typedConfirmOk(typed: unknown, expected: string | null | undefined): boolean {
  const want = String(expected ?? '').trim();
  return want.length > 0 && String(typed ?? '').trim() === want;
}

/** An HTML `pattern` that accepts exactly this phrase (every regex syntax character escaped; `-` is NOT, because a
 *  browser compiles the pattern in unicode mode, where `\-` outside a class is an error and the pattern is dropped).
 *  The browser then refuses a wrong phrase before the form is sent, with no script; the server check is the real gate. */
export function phrasePattern(phrase: string): string {
  return phrase.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

/** The boss name an encounter row shows, and the phrase that deletes it: the catalog name without `_` and a leading
 *  `#`, or `npc <id>` when the id never resolved (the page's own label). */
export function encounterPhrase(npcName: string | null | undefined, npcId: number | string | null | undefined): string {
  const name = String(npcName ?? '').replace(/_/g, ' ').replace(/^#/, '').trim();
  return name || `npc ${npcId ?? '?'}`;
}
