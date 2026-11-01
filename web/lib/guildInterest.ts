// The "Register your guild" interest form on raidmimic.com/register (the guild lead, 2026-11-01, option B: "a proper
// interest form, no sign-in"). PURE: no I/O, no logging, no clock. The server action (app/raidmimic/register/actions.ts)
// runs validateInterest() FIRST and stores nothing that has not come out of it.
//
// A stranger types every field, so every free-text field goes through the same cleaner as the anonymous feedback box
// (lib/anonFeedbackClean.ts: links, emails, IPs, keys, user-name paths, HTML and SQL-shaped text come out). The closed
// fields (game, raiders, nights, DKP tool) are matched against fixed lists and anything else is dropped, not stored.
// Nothing in a row is ever treated as an instruction: officers READ it on /admin/interest as plain text.
import { cleanAnonMessage, cleanDiscordContact } from './anonFeedbackClean';

import {
  DKP_TOOLS, GAMES, GUILD_NAME_MAX, HEARD_MAX, NIGHTS, RAIDERS_MAX, RAIDERS_MIN, SERVER_MAX,
} from './guildInterestFields';
export * from './guildInterestFields';

export type InterestInput = {
  guildName?: unknown;
  game?: unknown;
  server?: unknown;
  raiders?: unknown;
  nights?: unknown;
  dkp?: unknown;
  heard?: unknown;
  discord?: unknown;
  // Honeypot: a real person never sees this field, so any value means a bot.
  website?: unknown;
};

export type InterestRow = {
  guild_name: string;
  game: string | null;
  server: string | null;
  raiders: number | null;
  nights: string[];
  dkp: string | null;
  heard: string | null;
  discord_contact: string | null;
};

export type InterestResult = { ok: true; row: InterestRow } | { ok: false; error: string } | { ok: true; bot: true };

// The cleaner insists on a sentence ("at least 10 real characters"), which a guild name is not. Prefix a fixed sentence so
// the rule measures the field, run the whole cleaner, then take the prefix off again.
const PREFIX = 'Answer typed into the interest form: ';

/** One short single-line field, cleaned. '' when nothing real is left (all of it was removed, or it was empty). */
export function cleanShortField(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const flat = raw.replace(/\s+/g, ' ').trim().slice(0, max * 4);
  if (!flat) return '';
  const res = cleanAnonMessage(PREFIX + flat);
  if (res.reject || !res.text.startsWith(PREFIX)) return '';
  const out = res.text.slice(PREFIX.length).replace(/\s+/g, ' ').trim().slice(0, max).trim();
  // Only [removed] markers and punctuation left: nothing the sender typed survived.
  if (out.split('[removed]').join('').replace(/[^\p{L}\p{N}]/gu, '').length < 1) return '';
  return out;
}

export function validateInterest(input: InterestInput | null | undefined): InterestResult {
  if (typeof input?.website === 'string' && input.website.trim() !== '') return { ok: true, bot: true };

  const guild_name = cleanShortField(input?.guildName, GUILD_NAME_MAX);
  if (!guild_name) return { ok: false, error: 'Please tell us your guild name.' };

  const game = (GAMES as readonly unknown[]).includes(input?.game) ? (input!.game as string) : null;
  const server = game === 'other' ? cleanShortField(input?.server, SERVER_MAX) || null : null;

  const rawRaiders = typeof input?.raiders === 'number' ? input.raiders : Number(input?.raiders);
  if (!Number.isInteger(rawRaiders) || rawRaiders < RAIDERS_MIN || rawRaiders > RAIDERS_MAX) {
    return { ok: false, error: `Raiders must be a whole number from ${RAIDERS_MIN} to ${RAIDERS_MAX}.` };
  }

  // A subset of the seven days, in week order, no repeats. Anything else is an error rather than silently dropped:
  // a form that only this page renders has no honest way to send a different value.
  const given = Array.isArray(input?.nights) ? (input!.nights as unknown[]) : [];
  if (given.some(n => !(NIGHTS as readonly unknown[]).includes(n))) return { ok: false, error: 'Those raid nights are not days of the week.' };
  const nights = NIGHTS.filter(n => given.includes(n));

  const dkp = (DKP_TOOLS as readonly unknown[]).includes(input?.dkp) ? (input!.dkp as string) : null;
  const heard = cleanShortField(input?.heard, HEARD_MAX) || null;
  const contact = cleanDiscordContact(input?.discord);

  return {
    ok: true,
    row: { guild_name, game, server, raiders: rawRaiders, nights, dkp, heard, discord_contact: contact.contact },
  };
}
