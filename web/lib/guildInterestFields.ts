// The fixed vocabulary and limits of the "Register your guild" form (raidmimic.com/register). Constants only, so the
// browser's form can import them without pulling the server-side cleaner (lib/anonFeedbackClean.ts) into its bundle.
export const GUILD_NAME_MAX = 60;
export const SERVER_MAX = 40;
export const HEARD_MAX = 200;
export const RAIDERS_MIN = 6;
export const RAIDERS_MAX = 72;
/** Submissions one network address may make an hour. Small on purpose: this is a lead form, not a chat. */
export const INTEREST_PER_HOUR = 3;

export const NIGHTS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const GAMES = ['quarm', 'eq-live', 'other'] as const;
export const DKP_TOOLS = ['opendkp', 'eqdkp', 'other', 'none'] as const;

// Where the guild raids from, as a raid-planning zone rather than an IANA list — EQ guilds say "8pm ET", not
// "America/New_York". 'other' keeps the form honest for the rest of the world without a 400-entry dropdown.
export const TIMEZONES = ['et', 'ct', 'mt', 'pt', 'gmt-uk', 'eu-central', 'oceania', 'other'] as const;

// Half-hour wall-clock steps for the raid window. A closed list, not free text, so the validator can match
// instead of parse; the end list is the same values (an end before the start just means it runs past midnight).
export const RAID_TIMES: readonly string[] = Array.from({ length: 48 }, (_, i) =>
  `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

// How loot is awarded — the modes seen across real guilds (docs/DESIGN-loot-systems.md §2), form-sized.
export const BID_MODES = [
  'dkp-open', 'dkp-sealed', 'dkp-timer', 'epgp', 'rolls', 'council', 'picks', 'other', 'none',
] as const;
