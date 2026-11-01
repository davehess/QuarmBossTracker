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
