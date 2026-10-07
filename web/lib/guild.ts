// The guild kit's single source for "which guild is this site for".
//
// Resolution order, everywhere in this file: environment variable -> built-in fallback. The fallbacks are
// Wolf Pack's own values, so a deployment that sets nothing (or sets today's variables) behaves exactly as
// the site did before this module existed. Another guild sets the NEXT_PUBLIC_* names below.
//
// SAFE IN A CLIENT BUNDLE, on purpose (listableChars.ts is imported by a client component): no next/headers,
// no service key, no side effects. Every NEXT_PUBLIC_* read is a STATIC `process.env.NEXT_PUBLIC_X`
// expression, because Next inlines those only when the name is written out; a computed `process.env[k]`
// would be undefined in the browser. The server-only names (SUPABASE_GUILD_ID, ALLOWED_ROLE_NAMES,
// OFFICER_ROLE_NAMES) resolve to undefined on the client and fall through to the default, so a value that
// must agree between server and browser belongs in the NEXT_PUBLIC_ name.
//
// ⚠ SUPABASE_GUILD_ID (the bot's name for the tag) is a SERVER-ONLY alias. web/next.config.js copies it into
// NEXT_PUBLIC_GUILD_TAG at build time when that is unset, so both bundles agree; do not rely on the alias
// alone, and keep NEXT_PUBLIC_GUILD_TAG equal to the bot's SUPABASE_GUILD_ID.

const clean = (v: string | undefined): string | undefined => (v ?? '').trim() || undefined;

// ── Identity ────────────────────────────────────────────────────────────────

// The `guild_id` every guild table is keyed on. A tag, not a display name; changing it on a populated
// database orphans every row.
export const GUILD_TAG: string =
  clean(process.env.NEXT_PUBLIC_GUILD_TAG) ?? clean(process.env.SUPABASE_GUILD_ID) ?? 'wolfpack';

export const GUILD_NAME: string = clean(process.env.NEXT_PUBLIC_GUILD_NAME) ?? 'Wolf Pack';
export const GUILD_SHORT: string = clean(process.env.NEXT_PUBLIC_GUILD_SHORT) ?? 'WP';

// The guild's name as the GAME spells it. Use this for DATA comparisons (pvp_kills.killer_guild, the /who
// guild column), never GUILD_NAME: display copy can be reworded, the in-game guild name cannot.
export const GUILD_INGAME_NAME: string = clean(process.env.NEXT_PUBLIC_GUILD_INGAME_NAME) ?? GUILD_NAME;

export const SITE_NAME: string = clean(process.env.NEXT_PUBLIC_SITE_NAME) ?? 'WolfPack.quest';

// ── Site address ────────────────────────────────────────────────────────────

// Set at BUILD time from the branch (next.config.js), so this is a constant in the bundle.
export const IS_BETA: boolean = process.env.NEXT_PUBLIC_IS_BETA === '1';

export const PROD_SITE_URL: string = 'https://wolfpack.quest';
export const BETA_SITE_URL: string = clean(process.env.NEXT_PUBLIC_BETA_SITE_URL) ?? 'https://b.wolfpack.quest';

// Same rule app/layout.tsx has always used: an explicit NEXT_PUBLIC_SITE_URL wins, else the beta mirror on a
// beta build and production otherwise.
export const SITE_URL: string =
  clean(process.env.NEXT_PUBLIC_SITE_URL) ?? (IS_BETA ? BETA_SITE_URL : PROD_SITE_URL);

// An absolute address on this site: siteUrl('/me') -> https://<site>/me. No argument gives the bare origin.
export function siteUrl(path = ''): string {
  const base = SITE_URL.replace(/\/+$/, '');
  if (!path) return base;
  return base + (path.startsWith('/') ? path : '/' + path);
}

// ── Password sign-in ────────────────────────────────────────────────────────

// ⚠ FROZEN. Every password account is stored as <username>@<this domain> in Supabase Auth, so this string is
// the account key of every existing password user. NEVER derive it from SITE_URL, GUILD_TAG or anything else
// that can change: a renamed site or a second guild's domain would make every existing login unfindable
// (and claim would mint duplicates). The only legitimate override is a NEW deployment's own value, set
// before its first password account exists. The domain is never mailed to; it is only a key.
export const LOGIN_EMAIL_DOMAIN: string = clean(process.env.NEXT_PUBLIC_LOGIN_DOMAIN) ?? 'login.wolfpack.quest';

// ── Source repository ───────────────────────────────────────────────────────

const DEFAULT_REPO = { owner: 'davehess', name: 'QuarmBossTracker' };

// NEXT_PUBLIC_GITHUB_REPO is 'owner/name'; anything else falls back to the default.
function parseRepo(v: string | undefined): { owner: string; name: string } {
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(v ?? '');
  return m ? { owner: m[1], name: m[2] } : DEFAULT_REPO;
}

export const REPO: { owner: string; name: string } = parseRepo(clean(process.env.NEXT_PUBLIC_GITHUB_REPO));
export const REPO_URL: string = `https://github.com/${REPO.owner}/${REPO.name}`;
export const REPO_RELEASES_URL: string = `${REPO_URL}/releases`;
// The REST list; callers append their own query (`?per_page=20`).
export const REPO_RELEASES_API: string = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/releases`;

// ── OpenDKP ─────────────────────────────────────────────────────────────────

// NEXT_PUBLIC_OPENDKP_BASE is a full origin; NEXT_PUBLIC_OPENDKP_CLIENT is just the client name
// (<client>.opendkp.com). No trailing slash, so callers append `/#/characters/<id>`.
function opendkpBase(): string {
  const base = clean(process.env.NEXT_PUBLIC_OPENDKP_BASE);
  if (base) return base.replace(/\/+$/, '');
  const client = clean(process.env.NEXT_PUBLIC_OPENDKP_CLIENT);
  return client ? `https://${client}.opendkp.com` : 'https://wolfpack.opendkp.com';
}
export const OPENDKP_BASE: string = opendkpBase();

// ── Raid schedule ───────────────────────────────────────────────────────────

export const RAID_TZ: string = clean(process.env.NEXT_PUBLIC_RAID_TZ) ?? 'America/New_York';

// ── Role gates (server-only, read PER REQUEST) ──────────────────────────────

// Discord role NAMES allowed to sign in. An empty or unset ALLOWED_ROLE_NAMES means the role gate is OFF
// (guild membership alone still applies), so this returns [] and callers treat [] as "no gate".
export function memberRoles(): string[] {
  return (process.env.ALLOWED_ROLE_NAMES || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

// Discord role NAMES that make an officer. The default is today's and is deliberately unchanged: the
// production value of OFFICER_ROLE_NAMES is unverified, so this must keep answering as officer.ts did.
export function officerRoles(): string[] {
  return (process.env.OFFICER_ROLE_NAMES || 'Officer,Pack Leader')
    .split(',').map(s => s.trim()).filter(Boolean);
}

// ── Ranks and roles ─────────────────────────────────────────────────────────

// OpenDKP RANKS (characters.rank / the roster), best first. Mirrors eras.ts RANK_PRIORITY.
export const RANKS = {
  priority: [
    'Officer', 'Pack Leader', 'Raid Pack', 'Raid Recruit',
    'Recruit', 'Member', 'Inactive', 'Raid Alt',
  ],
  raider: ['Pack Leader', 'Officer', 'Raid Pack', 'Recruit'],
  raidAlt: ['Raid Alt'],
  nonRaid: ['Non-raid Alt', 'Trader'],
  trader: 'Trader',
  newMain: 'Recruit',
} as const;

// Discord ROLES (wolfpack_members.role_names): a separate vocabulary from the OpenDKP ranks above. The two
// overlap in spelling ('Officer', 'Raid Pack') but name different systems; never test one against the other.
export const ROLES = {
  active: ['Raid Pack', 'Officer', 'Raid Recruit', 'Pack Member', 'Pack Leader'],
} as const;

// Minimum character level for a raid-roster count: a raid alt, and the Planes of Power era.
export const RAID_LEVEL_FLOOR = { raidAlt: 46, pop: 60 } as const;
