// "Your data": the signed-in member's own download and their own account deletion (the guild lead, 2026-11-01:
// the privacy page said "there is no self-serve download or delete; you ask an officer", before payments go live).
//
// ONE rule runs through both halves: the identity comes from the SESSION and from nowhere else. A request never
// carries a Discord id, a user id or a character name; resolveSelf() reads them off the signed-in user, and every
// query below is keyed on those values. A new table goes in the lists here, and the migration
// 20261101140000_member_self_delete.sql is the other half (test/self-serve-data.test.js holds the two together).
//
// Pure and import-light on purpose (relative imports only, the client is passed in): the root vitest suite imports
// this file and runs it against a fake client.

import { selectAll } from './selectAll';
import { discordIdOf } from './lockout';
import { GUILD_TAG } from './guild';

type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any; storage?: any; auth?: any };

export type Ids = { userId: string; discordId: string };

export const EXPORT_ROW_CAP = 5000;               // newest rows per table (the guild's raid records, the long logs)
export const EXPORT_CHARACTER_CAP = 25000;        // a character's inventory runs past 8,000 rows; their uploads get room
export const EXPORT_COOLDOWN_MIN = 10;            // one download per person per this many minutes
export const DELETE_WORD = 'DELETE';
export const SHOT_BUCKET = 'feedback-screenshots';

/** The typed confirm. Exact word, upper case, surrounding spaces forgiven. */
export const isDeleteConfirmed = (typed: unknown): boolean => typeof typed === 'string' && typed.trim() === DELETE_WORD;

// ─── Who is asking ────────────────────────────────────────────────────────────────────────────────────────────

export type SelfResult = { ok: true; ids: Ids } | { ok: false; reason: 'no_discord' | 'mismatch' };

/**
 * The person behind a session: their login id and the Discord id on it. Refuses when the members table already
 * ties this login to a DIFFERENT Discord id, because a delete keyed on the wrong id is the one mistake this feature
 * cannot make.
 */
export async function resolveSelf(db: Db, user: { id?: string; app_metadata?: unknown; user_metadata?: unknown } | null | undefined): Promise<SelfResult> {
  const discordId = discordIdOf(user);
  const userId = user?.id;
  if (!userId || !discordId || !/^\d{5,25}$/.test(discordId)) return { ok: false, reason: 'no_discord' };
  const { data } = await db.from('wolfpack_members').select('discord_id').eq('user_id', userId).maybeSingle();
  if (data?.discord_id && String(data.discord_id) !== discordId) return { ok: false, reason: 'mismatch' };
  return { ok: true, ids: { userId, discordId } };
}

// ─── What is in the download ──────────────────────────────────────────────────────────────────────────────────

// How a row is recognised as the person's:
//   discord  the column equals their Discord id          user    the column equals their login id
//   player   the column is their hub player id           name    the column is one of their characters (any case)
type Clause = { col: string; kind: 'discord' | 'user' | 'player' | 'name' };
type Order = { col: string; desc?: boolean };
// group: personal = their own data; character = private uploads reached through their characters;
//        guild = the guild's raid records, only the rows that are theirs.
export type TableSpec = {
  table: string;
  group: 'personal' | 'character' | 'guild';
  select: string;            // an explicit column list: a column that is not named here is never read
  clauses: Clause[];
  order: Order[];            // newest first, ending on a unique column so paging cannot repeat or skip rows
};

const d = (col: string): Clause => ({ col, kind: 'discord' });
const u = (col: string): Clause => ({ col, kind: 'user' });
const nm = (col: string): Clause => ({ col, kind: 'name' });
const by = (col: string, desc = false): Order => ({ col, desc });

// NEVER selected, by design: mimic_sessions.session_token and the link codes (the keys to a running install),
// gallery_masterpieces.edit_key_hash, gallery_reports.ip_hash, the encrypted payloads (ui_snapshots.payload_enc,
// personal_trigger_sync.payload_enc: sealed with a server key, no use to the person), wishlists' sealed bids,
// officers' names and notes on a report.
export const SELF_TABLES: TableSpec[] = [
  // ── personal ──
  { table: 'characters', group: 'personal', clauses: [d('discord_id')], order: [by('guild_id'), by('name')],
    select: 'guild_id, name, race, class, rank, main_name, opendkp_id, discord_id, quarmy_url, active, updated_at, exclude_from_stats, exclude_inventory, tell_relay, tell_dm, show_inventory_publicly, show_quests_publicly, hidden_from_lists, registered_via_web_at' },
  { table: 'wolfpack_members', group: 'personal', clauses: [d('discord_id')], order: [by('discord_id')],
    select: 'discord_id, guild_id, nickname, global_name, avatar_url, roles, role_names, is_member, joined_at, refreshed_at, merged_into_discord_id, tells_dm_paused_until' },
  { table: 'tells', group: 'personal', clauses: [d('owner_discord_id')], order: [by('ts', true), by('id')],
    select: 'id, owner_character, direction, other_name, text, raw_text, ts, source, created_at' },
  { table: 'mimic_sessions', group: 'personal', clauses: [d('discord_id'), u('user_id')], order: [by('created_at', true), by('id')],
    select: 'id, created_at, last_used_at, revoked_at, machine_label, agent_version, linked_via, linked_by_discord_id, guild_id, expires_at, scope, guest_label' },
  { table: 'mimic_link_codes', group: 'personal', clauses: [d('authorized_discord_id'), u('authorized_user_id')], order: [by('created_at', true), by('user_code')],
    select: 'created_at, expires_at, authorized_at, agent_version, authorized_via, authorized_by_discord_id, guild_id, hub' },
  { table: 'member_onboarding_state', group: 'personal', clauses: [d('discord_id')], order: [by('guild_id')],
    select: 'guild_id, discord_id, last_seen_version, opted_out, updated_at, last_seen_agent_version' },
  { table: 'agent_clock_offsets', group: 'personal', clauses: [d('discord_id')], order: [by('guild_id'), by('method')],
    select: 'guild_id, discord_id, method, offset_ms, samples, spread_ms, last_sample_at, updated_at' },
  { table: 'buff_lag_reports', group: 'personal', clauses: [d('discord_id')], order: [by('reported_at', true), by('id')],
    select: 'id, reported_at, guild_id, source, discord_id, character, client_settings, user_agent' },
  { table: 'feedback', group: 'personal', clauses: [d('submitter_discord_id')], order: [by('submitted_at', true), by('id')],
    select: 'id, ref, guild_id, submitted_at, submitter_name, category, message, status, log_excerpt, log_meta, client, client_version, platform, screenshot_paths' },
  { table: 'feedback_replies', group: 'personal', clauses: [d('author_discord_id')], order: [by('created_at', true), by('id')],
    select: 'id, feedback_id, guild_id, body, created_at' },
  { table: 'roadmap_votes', group: 'personal', clauses: [u('user_id')], order: [by('created_at', true), by('item_key')],
    select: 'item_key, created_at' },
  { table: 'overlay_design_feedback', group: 'personal', clauses: [u('user_id')], order: [by('created_at', true), by('id')],
    select: 'id, overlay, author, choice, body, created_at' },
  { table: 'overlay_design_votes', group: 'personal', clauses: [u('user_id')], order: [by('overlay')],
    select: 'overlay, choice, voter_name, updated_at' },
  { table: 'page_views', group: 'personal', clauses: [u('user_id')], order: [by('viewed_at', true), by('id')],
    select: 'id, guild_id, path, route, referrer, user_agent, viewed_at' },
  { table: 'test_server_comments', group: 'personal', clauses: [u('user_id')], order: [by('created_at', true), by('id')],
    select: 'id, body, created_at, deleted_at' },
  { table: 'test_server_interests', group: 'personal', clauses: [u('user_id')], order: [by('created_at', true), by('id')],
    select: 'id, topic, notes, created_at' },
  { table: 'ui_snapshots', group: 'personal', clauses: [d('owner_discord_id')], order: [by('created_at', true), by('id')],
    select: 'id, guild_id, character_name, server_short, label, source_width, source_height, payload_bytes_plain, file_count, agent_version, created_at, pending_link, machine_name' },
  { table: 'ui_pending_edits', group: 'personal', clauses: [d('owner_discord_id')], order: [by('created_at', true), by('id')],
    select: 'id, guild_id, character, target_file, edits, note, status, error, created_at, applied_at' },
  { table: 'ui_socials_index', group: 'personal', clauses: [d('owner_discord_id')], order: [by('updated_at', true), by('character'), by('page'), by('button')],
    select: 'guild_id, character, page, button, name, color, lines, source_file, snapshot_id, updated_at' },
  { table: 'personal_trigger_sync', group: 'personal', clauses: [d('owner_discord_id')], order: [by('created_at', true), by('id')],
    select: 'id, guild_id, trigger_count, rule_count, machine_name, agent_version, created_at' },
  { table: 'trigger_timing_feedback', group: 'personal', clauses: [d('voter_discord_id')], order: [by('voted_at', true), by('id')],
    select: 'id, guild_id, trigger_id, trigger_name, direction, fired_at, voted_at, voter_character, note' },
  { table: 'game_accounts', group: 'personal', clauses: [d('owner_discord_id')], order: [by('created_at', true), by('id')],
    select: 'id, guild_id, slot, label, created_at' },
  { table: 'crash_reports', group: 'personal', clauses: [d('uploaded_by_discord_id')], order: [by('crashed_at', true), by('id')],
    select: 'id, guild_id, character, crashed_at, zip_name, exception_code, exception_module, exception_address, zeal_version, zone_id, ui_skin, raw_reason, system, agent_version, created_at, exception_string, game_state, crash_subsystem, crash_headline' },
  { table: 'pop_rescan_requests', group: 'personal', clauses: [d('discord_id')], order: [by('requested_at', true), by('id')],
    select: 'id, guild_id, character, days, status, requested_at, taken_at, done_at, found' },
  { table: 'character_link_requests', group: 'personal', clauses: [d('requester_discord_id')], order: [by('created_at', true), by('id')],
    select: 'id, guild_id, character_name, requester_name, source, status, resolved_at, note, created_at' },
  { table: 'gallery_masterpieces', group: 'personal', clauses: [d('author_discord_id')], order: [by('created_at', true), by('id')],
    select: 'id, guild_id, title, blurb, classes, min_level, modes, byline, submitter_kind, visibility, status, featured, adoptions_count, latest_version, created_at, updated_at' },
  { table: 'gallery_reports', group: 'personal', clauses: [d('reporter_discord_id')], order: [by('created_at', true), by('id')],
    select: 'id, guild_id, masterpiece_id, reason, created_at' },
  { table: 'voice_reports', group: 'personal', clauses: [d('reporter_discord_id')], order: [by('created_at', true), by('id')],
    select: 'id, guild_id, character, spoken, original, engine, voice, rate, pitch, agent_version, trigger_id, trigger_name, suggested_say, note, status, created_at' },
  { table: 'hub_players', group: 'personal', clauses: [d('discord_id')], order: [by('player_id')],
    select: 'player_id, display_name, created_at, last_seen_at, deleted_at, avatar_url' },
  { table: 'hub_memberships', group: 'personal', clauses: [{ col: 'player_id', kind: 'player' }], order: [by('guild_id')],
    select: 'guild_id, player_id, role, joined_at, left_at, anon_label' },
  { table: 'hub_player_activity', group: 'personal', clauses: [{ col: 'player_id', kind: 'player' }], order: [by('day', true), by('guild_id')],
    select: 'guild_id, player_id, day, streams' },

  // ── private uploads reached through their characters ──
  { table: 'character_live_state', group: 'character', clauses: [nm('character')], order: [by('character')],
    select: 'guild_id, character, zone_id, zone_name, buff_count, buffs, self_hp_pct, uploaded_by, updated_at' },
  { table: 'character_inventory', group: 'character', clauses: [nm('character_name')], order: [by('character_name'), by('slot_label'), by('id')],
    select: 'character_name, slot_label, item_id, item_name, quantity, charges, observed_at' },
  { table: 'character_spellbook', group: 'character', clauses: [nm('character_name')], order: [by('character_name'), by('spell_id'), by('id')],
    select: 'character_name, spell_id, spell_name, spell_level, observed_at' },
  { table: 'character_keys', group: 'character', clauses: [nm('character_name')], order: [by('character_name'), by('key_name'), by('id')],
    select: 'character_name, key_name, item_id, observed_at' },
  { table: 'character_quest_prefs', group: 'character', clauses: [nm('character_name')], order: [by('character_name'), by('quest_id'), by('id')],
    select: 'character_name, quest_id, display_order, hidden, dismissed, updated_at' },
  { table: 'character_active_turnins', group: 'character', clauses: [nm('character_name')], order: [by('character_name'), by('turnin_id'), by('id')],
    select: 'character_name, turnin_id, status, created_at' },
  { table: 'character_worn_sets', group: 'character', clauses: [nm('character_name')], order: [by('character_name'), by('last_seen', true), by('id')],
    select: 'character_name, source, slots, first_seen, last_seen, times_seen' },
  { table: 'character_accounts', group: 'character', clauses: [nm('character_name')], order: [by('character_name'), by('valid_from'), by('id')],
    select: 'character_name, account_id, valid_from, valid_to, source, created_at' },

  // ── the guild's raid records: only the rows that are theirs, newest first, capped ──
  { table: 'contributions', group: 'guild', clauses: [d('contributor_discord_id'), d('uploaded_by_discord_id')], order: [by('created_at', true), by('id')],
    select: 'id, guild_id, encounter_id, contributor_character, source, total_damage, player_count, duration_sec, created_at, agent_version, has_ability_detail' },
  { table: 'encounter_players', group: 'guild', clauses: [nm('character_name')], order: [by('encounter_id', true), by('character_name')],
    select: 'guild_id, encounter_id, character_name, total_damage, dps, duration_sec, has_pets, rank' },
  { table: 'encounter_combat_rollup', group: 'guild', clauses: [nm('character_name')], order: [by('created_at', true), by('id')],
    select: 'id, guild_id, encounter_id, character_name, agent_version, total_hits, total_damage, self_attack_count, created_at' },
  { table: 'encounters', group: 'guild', clauses: [d('uploaded_by_discord_id')], order: [by('started_at', true), by('id')],
    select: 'id, guild_id, npc_id, started_at, ended_at, duration_sec, zone_short, total_damage, total_dps, is_wipe, created_at' },
  { table: 'looted_items', group: 'guild', clauses: [nm('looter_character')], order: [by('looted_at', true), by('id')],
    select: 'id, guild_id, looter_character, item_name, zone, looted_at, source, from_own_pet' },
  { table: 'opendkp_loot', group: 'guild', clauses: [nm('character_name')], order: [by('fetched_at', true), by('id')],
    select: 'id, guild_id, raid_id, item_name, character_name, dkp, notes, fetched_at' },
  { table: 'rh_signups', group: 'guild', clauses: [d('discord_id')], order: [by('signed_at', true), by('event_id'), by('signup_id')],
    select: 'guild_id, event_id, signup_id, user_name, status, role, class_name, spec_name, signed_at' },
  { table: 'wishlists', group: 'guild', clauses: [nm('character_name')], order: [by('added_at', true), by('character_name'), by('item_id')],
    select: 'guild_id, character_name, item_id, priority, note, source, source_url, added_at' },
  { table: 'pop_guide_ticks', group: 'guild', clauses: [nm('character_name')], order: [by('ticked_at', true), by('character_name'), by('item_key')],
    select: 'guild_id, character_name, item_key, ticked_at, ticked_by' },
  { table: 'chat_messages', group: 'guild', clauses: [nm('speaker')], order: [by('ts', true), by('id')],
    select: 'id, guild_id, ts, channel, speaker, text, created_at' },
  { table: 'xp_events', group: 'guild', clauses: [nm('character')], order: [by('at', true), by('id')],
    select: 'id, guild_id, character, at, kind, level, level_after, zone_name, mob, potion, race, class, agent_version' },
  { table: 'fun_events', group: 'guild', clauses: [d('uploaded_by_discord_id')], order: [by('event_ts', true), by('id')],
    select: 'id, guild_id, event_ts, event_type, caster, target, encounter_id, created_at' },
  { table: 'pvp_kills', group: 'guild', clauses: [nm('killer'), nm('victim')], order: [by('killed_at', true), by('id')],
    select: 'id, guild_id, killer, killer_guild, victim, victim_guild, zone, via_pet, pet_name, killed_at, source' },
  { table: 'pvp_deaths', group: 'guild', clauses: [nm('victim'), nm('killer')], order: [by('died_at', true), by('id')],
    select: 'id, guild_id, victim, victim_guild, killer, killer_guild, killer_is_npc, pet_name, zone, died_at, source' },
  { table: 'pvp_assists', group: 'guild', clauses: [nm('assister')], order: [by('killed_at', true), by('id')],
    select: 'id, guild_id, assister, assister_guild, victim, victim_guild, killer, killer_is_npc, zone, killed_at, source' },
  { table: 'agent_upload_stats', group: 'guild', clauses: [d('uploaded_by_discord_id')], order: [by('guild_id'), by('character'), by('endpoint')],
    select: 'guild_id, character, endpoint, upload_count, error_count, first_uploaded_at, last_uploaded_at, agent_version, zeal_version' },
];

// Said in the file itself, so nobody reads the download as "everything".
export const NOT_INCLUDED: { table: string; why: string }[] = [
  { table: 'encounter_events, roll_sets, buff_casts, raid_trigger_fires, who_observations, charm_sessions, target_observations, raid_night_appearance, encounter_threat_rank',
    why: 'Per-fight and per-minute streams recorded by every raider\'s agent. They name other players, so they are not exported here; an officer can pull the rows for your characters on request.' },
  { table: 'audit_log, officer notes, loot awards, guild settings',
    why: 'The guild\'s own record of what officers did. It is not your data.' },
  { table: 'ui_snapshots and personal_trigger_sync contents',
    why: 'Stored sealed with a server key. The list of your backups is included; the sealed bodies are not.' },
  { table: 'Mimic sign-in keys, link codes, edit keys, address hashes',
    why: 'Secrets. They are never put in a download.' },
];

// The tables a delete removes or clears (all of them but the guild group), and the guild records it must never touch.
// The migration is checked against these lists by test/self-serve-data.test.js.
export const PERSONAL_TABLES = SELF_TABLES.filter(t => t.group !== 'guild').map(t => t.table);
export const GUILD_RECORD_TABLES = SELF_TABLES.filter(t => t.group === 'guild').map(t => t.table);
// What the delete unlinks from the Discord id (rows stay). Must equal the VALUES list in member_self_unlink_batch.
export const UNLINK_TARGETS = [
  'contributions.contributor_discord_id', 'contributions.uploaded_by_discord_id', 'encounters.uploaded_by_discord_id',
  'encounter_events.uploaded_by_discord_id', 'buff_casts.uploaded_by_discord_id', 'looted_items.uploaded_by_discord_id',
  'fun_events.uploaded_by_discord_id', 'roll_sets.uploaded_by_discord_id', 'pvp_kills.uploaded_by_discord_id',
  'pvp_deaths.uploaded_by_discord_id', 'pvp_assists.uploaded_by_discord_id', 'agent_upload_stats.uploaded_by_discord_id',
  'chat_messages.uploaded_by', 'xp_events.uploaded_by', 'raid_trigger_fires.uploaded_by', 'rh_signups.discord_id',
];
export const UNLINK_BATCH = 20000;

// ─── Building the download ────────────────────────────────────────────────────────────────────────────────────

// A name is letters only (that is all an EverQuest name is), so it can sit inside a PostgREST filter safely.
const cleanName = (n: unknown): string => String(n ?? '').replace(/[^A-Za-z]/g, '');

type Chars = { guild: string; names: string[] }[];

/** The person's characters, grouped by guild: only those whose characters.discord_id IS their Discord id. */
export async function loadOwnCharacters(db: Db, ids: Ids): Promise<Chars> {
  const { data, error } = await db.from('characters').select('guild_id, name').eq('discord_id', ids.discordId);
  if (error) throw new Error(`characters: ${error.message ?? 'read failed'}`);
  const by = new Map<string, Set<string>>();
  for (const r of (data ?? []) as { guild_id: string; name: string }[]) {
    const n = cleanName(r.name);
    if (!n) continue;
    if (!by.has(r.guild_id)) by.set(r.guild_id, new Set());
    by.get(r.guild_id)!.add(n);
  }
  return [...by].map(([guild, s]) => ({ guild, names: [...s].sort() }));
}

/** The filter pieces for one query. Values are the session's own ids, a hub player id read from their own row, or cleaned names. */
export function filterParts(spec: TableSpec, ids: Ids, playerIds: string[], names: string[]): string[] {
  const parts: string[] = [];
  for (const c of spec.clauses) {
    if (c.kind === 'discord') parts.push(`${c.col}.eq.${ids.discordId}`);
    else if (c.kind === 'user') parts.push(`${c.col}.eq.${ids.userId}`);
    else if (c.kind === 'player') { if (playerIds.length) parts.push(`${c.col}.in.(${playerIds.join(',')})`); }
    else for (const n of names) parts.push(`${c.col}.ilike.${n}`);
  }
  return parts;
}

export type TableOut = { row_count: number; capped: boolean; cap: number; rows: unknown[] } | { error: string };

async function readTable(db: Db, spec: TableSpec, ids: Ids, playerIds: string[], chars: Chars): Promise<TableOut> {
  const cap = spec.group === 'character' ? EXPORT_CHARACTER_CAP : EXPORT_ROW_CAP;
  const usesNames = spec.clauses.some(c => c.kind === 'name');
  // A spec that names characters runs once per guild the person has characters in (so a same-named character in
  // another guild is never picked up); everything else runs once.
  const runs: { guild: string | null; names: string[] }[] = usesNames && chars.length ? chars.map(c => ({ guild: c.guild, names: c.names })) : [{ guild: null, names: [] }];
  const rows: unknown[] = [];
  let capped = false;
  for (const run of runs) {
    const parts = filterParts(spec, ids, playerIds, run.names);
    if (!parts.length) continue;
    const got = await selectAll<unknown>((from, to) => {
      let q = db.from(spec.table).select(spec.select).or(parts.join(','));
      if (run.guild) q = q.eq('guild_id', run.guild);
      for (const o of spec.order) q = q.order(o.col, { ascending: !o.desc });
      return q.range(from, to);
    }, { hardCap: cap + 1, onTruncate: () => {} });
    rows.push(...got);
  }
  if (rows.length > cap) { capped = true; rows.length = cap; }
  return { row_count: rows.length, capped, cap, rows };
}

// The download is prepared in the BROWSER, one section at a time (the guild lead, 2026-11-01: the single streamed file
// showed no size and stopped partway, leaving invalid JSON): the manifest route returns exportHeader() + the section
// list, the part route returns exportSection() for one name, and lib/selfDataPrepare.ts stitches them into the file.

/** The section names, in file order. The part route's allow-list: a name is looked up here, never used in a filter. */
export const EXPORT_SECTIONS: string[] = SELF_TABLES.map(t => t.table);

/** The spec for an allow-listed section name, or null. Exact match only; anything else (a number, an injected string) is null. */
export function findSection(name: unknown): TableSpec | null {
  return typeof name === 'string' ? SELF_TABLES.find(t => t.table === name) ?? null : null;
}

/** Everything in the file that is not a section: when it was taken, what it is, the caps, and what it leaves out. */
export function exportHeader(now: Date = new Date()) {
  return {
    exported_at: now.toISOString(),
    about: 'Everything the Wolf Pack / Raid Mimic site holds that is yours, as it stood when you pressed Prepare. Your own data is complete. The guild\'s raid records are only the rows that are yours, newest first, capped per table (see each table\'s "capped"). Anything a table cannot show is listed under "not_included".',
    row_cap: EXPORT_ROW_CAP,
    character_row_cap: EXPORT_CHARACTER_CAP,
    not_included: NOT_INCLUDED,
  };
}

// One response from a non-streamed function is capped (4.5 MB on Vercel). A section past this many bytes is cut to
// its newest rows and says so, rather than failing the whole preparation.
export const PART_MAX_BYTES = 4_000_000;

/**
 * One section of the download: the rows of ONE allow-listed table that are the session's own. A table that cannot be
 * read says so in the section (`error`) instead of leaving a silent gap. The caller has already resolved `spec` with
 * findSection(); `ids` is what resolveSelf() read off the session.
 */
export async function exportSection(db: Db, spec: TableSpec, ids: Ids): Promise<{ group: TableSpec['group'] } & TableOut> {
  try {
    let chars: Chars = [];
    if (spec.clauses.some(c => c.kind === 'name')) chars = await loadOwnCharacters(db, ids);
    let playerIds: string[] = [];
    if (spec.clauses.some(c => c.kind === 'player')) {
      try {
        const { data } = await db.from('hub_players').select('player_id').eq('discord_id', ids.discordId);
        playerIds = ((data ?? []) as { player_id: string }[]).map(r => r.player_id).filter(Boolean);
      } catch { /* hub tables may not exist on this database */ }
    }
    return { group: spec.group, ...(await readTable(db, spec, ids, playerIds, chars)) };
  } catch {
    return { group: spec.group, error: 'This table could not be read just now. Prepare again in a few minutes.' };
  }
}

/** The part as a response body: JSON text, trimmed to PART_MAX_BYTES by dropping the oldest rows (and flagged as capped). */
export function sectionBody(out: { group: string } & TableOut, maxBytes: number = PART_MAX_BYTES): string {
  let text = JSON.stringify(out);
  if ('error' in out || text.length <= maxBytes / 4) return text;   // length counts characters; bytes are at most 4x, so a short text is safe
  const size = (s: string) => new TextEncoder().encode(s).length;
  if (size(text) <= maxBytes) return text;
  const rows = out.rows.slice();
  const note = 'This section was too large for one response, so only the newest rows are here.';
  while (rows.length > 1 && size(text) > maxBytes) {
    rows.length = Math.floor(rows.length * 0.8);
    text = JSON.stringify({ ...out, row_count: rows.length, capped: true, note, rows });
  }
  return text;
}

// ─── One download per person per 10 minutes ───────────────────────────────────────────────────────────────────

export const exportKey = (userId: string): string => `data_export:${userId}`;

/**
 * Claims the person's download slot in bot_kv (guild_id + key is the primary key). The update only matches a marker
 * older than the cooldown and the insert only succeeds when there is none, so two requests at once cannot both pass.
 */
/** How long after a Prepare (the manifest's claim) the person's section reads are served. */
export const PREPARE_WINDOW_MIN = 15;

/**
 * True when this person pressed Prepare within PREPARE_WINDOW_MIN: the part route serves sections only then, so the
 * one-prepare-per-10-minutes limit cannot be skipped by calling parts directly. Read-only; fails closed.
 */
export async function prepareIsOpen(db: Db, userId: string, now: number = Date.now()): Promise<boolean> {
  const { data, error } = await db.from('bot_kv').select('updated_at').eq('guild_id', GUILD_TAG).eq('key', exportKey(userId)).maybeSingle();
  if (error || !data?.updated_at) return false;
  const since = now - Date.parse(data.updated_at);
  return since >= 0 && since <= PREPARE_WINDOW_MIN * 60_000;
}

export async function claimExport(db: Db, userId: string, now: number = Date.now()): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const key = exportKey(userId);
  const at = new Date(now).toISOString();
  const cutoff = new Date(now - EXPORT_COOLDOWN_MIN * 60_000).toISOString();
  const upd = await db.from('bot_kv').update({ value: { at }, updated_at: at })
    .eq('guild_id', GUILD_TAG).eq('key', key).lt('updated_at', cutoff).select('key');
  if (upd.error) throw new Error(`rate limit: ${upd.error.message ?? 'update failed'}`);
  if (upd.data?.length) return { ok: true };
  const ins = await db.from('bot_kv').insert({ guild_id: GUILD_TAG, key, value: { at }, updated_at: at });
  if (!ins.error) return { ok: true };
  if (ins.error.code !== '23505') throw new Error(`rate limit: ${ins.error.message ?? 'insert failed'}`);
  const { data } = await db.from('bot_kv').select('updated_at').eq('guild_id', GUILD_TAG).eq('key', key).maybeSingle();
  const since = data?.updated_at ? now - Date.parse(data.updated_at) : 0;
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((EXPORT_COOLDOWN_MIN * 60_000 - since) / 1000)) };
}

// ─── Deleting the account ─────────────────────────────────────────────────────────────────────────────────────

export type DeleteResult =
  | { ok: true; removed: Record<string, number>; unlinked: Record<string, number>; unlinkFailed: string[] }
  | { ok: false; error: 'owns_guild' | 'identity' | 'screenshots' | 'database' | 'account' };

/**
 * The order is the design:
 *  1. screenshots on their feedback (storage, not rows), because the rows are about to go;
 *  2. member_self_delete: ONE transaction that removes their data and unlinks the characters, or does nothing;
 *  3. member_self_unlink_batch per table, in slices: the guild's raid records keep their rows and lose the Discord id.
 *     A table that will not finish is reported (and audited) so an officer can finish it; it does not undo step 2;
 *  4. end the website sign-ins, then delete the login. Last, so a failure anywhere above leaves them able to sign in
 *     and press the button again (every step is safe to repeat).
 * Nothing here takes a request value: `ids` is what resolveSelf() read off the session.
 */
export async function runSelfDelete(db: Db, ids: Ids): Promise<DeleteResult> {
  // 1.
  // (feedback has only ever held this guild's reports; the delete function removes by Discord id alone, so if a
  // second guild ever collects feedback here, widen this to match.)
  const { data: fb, error: fbErr } = await db.from('feedback').select('screenshot_paths')
    .eq('guild_id', GUILD_TAG).eq('submitter_discord_id', ids.discordId);
  if (fbErr) return { ok: false, error: 'database' };
  const paths = ((fb ?? []) as { screenshot_paths: string[] | null }[]).flatMap(r => r.screenshot_paths ?? []).filter(p => typeof p === 'string' && p);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db.storage.from(SHOT_BUCKET).remove(paths.slice(i, i + 100));
    if (error) return { ok: false, error: 'screenshots' };
  }
  // 2.
  const del = await db.rpc('member_self_delete', { p_discord_id: ids.discordId, p_user_id: ids.userId });
  if (del.error) {
    const msg = String(del.error.message ?? '');
    return { ok: false, error: msg.includes('owns_guild') ? 'owns_guild' : msg.includes('identity_mismatch') ? 'identity' : 'database' };
  }
  const removed = (del.data ?? {}) as Record<string, number>;
  // 3.
  const unlinked: Record<string, number> = {};
  const unlinkFailed: string[] = [];
  for (const target of UNLINK_TARGETS) {
    let total = 0;
    try {
      for (let guard = 0; guard < 200; guard++) {
        const r = await db.rpc('member_self_unlink_batch', { p_discord_id: ids.discordId, p_target: target, p_limit: UNLINK_BATCH });
        if (r.error) throw new Error(r.error.message);
        const n = Number(r.data) || 0;
        total += n;
        if (n < UNLINK_BATCH) break;
      }
    } catch { unlinkFailed.push(target); }
    unlinked[target] = total;
  }
  // The second audit row: counts and the names of tables, never the person.
  await db.from('audit_log').insert({
    action: 'account_deleted_records', actor_discord_id: null, actor_name: null, guild_id: GUILD_TAG,
    payload: { self_service: true, unlinked, unlink_failed: unlinkFailed },
  });
  // 4.
  const ended = await db.rpc('end_member_web_sessions', { p_user_id: ids.userId });
  if (ended.error) return { ok: false, error: 'account' };
  const gone = await db.auth.admin.deleteUser(ids.userId);
  if (gone.error) return { ok: false, error: 'account' };
  return { ok: true, removed, unlinked, unlinkFailed };
}
