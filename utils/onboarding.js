// utils/onboarding.js — Per-member onboarding state, DB-backed (2026-05-30+).
// State lives in public.member_onboarding_state ((guild_id, discord_id) PK).
// In-memory cache mirrors the table so existing sync callers (isOptedOut etc.)
// don't have to await. Writes go to cache + DB via write-through.
//
// Previous design stored salted-SHA256 hashes in a hidden embed inside
// ONBOARDING_THREAD_ID — that was the privacy mitigation when state lived in a
// Discord channel. Now that we have service-role-only RLS, plain discord_id is
// fine (we already store it in characters.discord_id and wolfpack_members.discord_id).
// On startup, if the DB table is empty but a legacy thread embed exists, we
// preserve the old per-user "opted-out at version" for that user (under their
// plain discord_id) so nothing is lost in the cutover.
const crypto        = require('crypto');
const { EmbedBuilder } = require('discord.js');

const REGISTRY_TITLE     = '📋 Onboarding Opt-Out Registry';
const INSTRUCTIONS_TITLE = '📖 Wolf Pack Raid Tracker — Quick Start';

// In-memory cache: discord_id → { last_seen_version, opted_out }
// Mirrors member_onboarding_state. Sync getters read from here; setters
// write here AND fire-and-forget the upsert to the DB.
let _state              = {};
let _instructionsMsgId  = null;
let _supabaseEnabled    = false;

// ── Changelog — focus + difference bullets, per minor/patch release ──────────
// Add a new entry every release. Keep each line short — these surface as the
// "what's new since you last looked" diff on /onboarding and the rejoin DM.
// changesSince() uses semver-aware compare, so two-digit minor/patch (e.g.
// "2.5.39") sorts correctly above "2.5.9".
const CHANGELOGS = {
  '2.7.8': [
    '**PvP boss timer board on wolfpack.quest/pvp** — every PvP-server boss kill (auto-detected from Druzzil broadcasts or recorded via `/pvpkill`) now mirrors into Supabase with a ±20% spawn window. The new "PvP Boss Timers" section sorts by soonest spawn first; rows whose window has already opened drop to the bottom as "camp now". Existing in-memory timers are backfilled on first deploy after this lands.',
  ],
  '2.7.7': [
    '**Auto-`/pvpkill` from PvP server broadcasts** — when Druzzil announces "X of <Guild> has killed Boss in Zone!" and the victim matches a boss in `data/bosses.json`, the bot auto-starts the respawn timer (±20% window) and posts a kill card to `PVP_KILLS_THREAD_ID`. Fires regardless of which guild made the kill — server-wide respawns tick the same for everyone.',
  ],
  '2.7.6': [
    '**PvP howl edits in place again** — second & later howlers were appending new "X and Y howl back!" lines instead of replacing the existing one (the filter only caught the singular "howls back!" form).',
  ],
  '2.7.5': [
    '**PvP kills now ping `@PVP`** — Wolf Pack PvP kills are the rallying moment, not the scroll-past ones. Deaths still ping for backup; other-guild / NPC kills remain silent.',
  ],
  '2.7.4': [
    '**Tells now actually persist** — the upsert was silently rejected by a partial unique index, so DMs fired but `/me/tells` stayed at 0. Index rebuilt; tells store again.',
    '**Tells DM now shows the conversation** — incoming + outgoing are grouped by counterparty in chronological order, so the DM reads as the back-and-forth instead of just the last incoming line.',
  ],
  '2.7.3': [
    '**Tells fix** — the `/me` toggle now actually saves for alts (was silently rejected when the alt had no linked Discord ID), and the bot stores incoming tells against the family root when an alt is unlinked — so `/me/tells` and Discord DM relay both reach you.',
  ],
  '2.7.0': [
    '**UI Studio (Mimic)** — back up your EQ window layout, hotkeys, chat tabs, bandolier, socials, and `eqclient.ini` to wolfpack.quest. Restore on any computer in one click. Files are encrypted before they leave your machine.',
    '**Multi-folder EQ picker (Mimic)** — scans for `eqgame.exe` in 14 common locations, lets you pick multiple installs, Browse to add more, with a "Where did we look?" disclosure.',
    '**Smoother overlay drag (Mimic)** — replaced the buggy Chromium drag with a small ✥ handle and 1:1 cursor tracking. First-run token gate; in-log NPC-hail character inference catches renamed log files automatically.',
  ],
  '1.0.0': [
    '`/kill <boss>` — log a kill and start the respawn timer',
    '`/timers [zone] [filter]` — view all spawn timers by zone or status',
    '`/announce` — schedule a raid with a thread and Discord event',
  ],
  '1.0.1': [
    '`/onboarding` — show the welcome message again, or toggle your opt-out preference',
  ],
  '1.1.0': [
    '`/rosterimport <file>` — import the OpenDKP roster JSON export (Officers only)',
    '`/who <name>` — look up a character\'s class and main/alt status (ephemeral)',
    '`/whoall <name>` — view a character\'s full family tree (main + alts) (ephemeral)',
  ],
  '2.5.39': [
    'Agent v2.4.26 starts collecting per-ability rollups — verb totals + self-attack counter become available on `/me` for new raids',
  ],
  '2.5.40': [
    'Onboarding moved to the database with diff-only revision pings — `/onboarding` now shows only what\'s new since you last looked, with a [Show full welcome] button for everything else',
    'Parser download link now points to the GitHub release directly (the old subdomain hit a TLS error)',
  ],
  '2.5.41': [
    'Parser release announcements moved to opt-in DMs — only members who\'ve used `/onboarding` get pinged, and only with the diff since their last seen version. The blasting channel post is gone.',
  ],
  '2.5.42': [
    'Self-serve opt-out: every character on `wolfpack.quest /me` has Stats/Inventory toggles you control. Flipping Stats=EXCLUDED stops the agent from uploading for that character within ~10 minutes, and hides their stats from the page.',
  ],
  '2.5.43': [
    'New officer command: `/recoverkills [since] [dry_run]` rebuilds boss timers from Supabase encounters when the boards have drifted (volume wipe, missed updates, the recent re-run-as-backfill bug). Dry-run first to preview.',
  ],
  '2.5.44': [
    'Privacy statement is live at **wolfpack.quest/privacy** — what we keep, what stays local, who sees what, and how to opt out per character. Linked from the footer and the welcome message.',
  ],
  '2.5.45': [
    'Inbound /tell relay (opt-in, default off): flip `Tells: ON` on **wolfpack.quest/me** for a character and the agent forwards its tells to **/me/tells** + Discord DMs when you\'re away. Only you ever see them.',
  ],
  '2.5.46': [
    'Tell notifications now come two ways, each toggleable: per-character `DM: ON/off` for Discord pings, and device-local 🔔 browser notifications (with optional sound) on **/me/tells** — they fire live the moment a tell lands while you\'re looking elsewhere.',
  ],
  '2.6.2': [
    'PvP fyi-pings: when a non-Wolf-Pack character dies in a PvP-zone broadcast (even to an NPC), the bot now gives the `@PVP` role a heads-up ping. Rate-limited to once per 10 min so flurries don\'t spam. Wolf-Pack-death backup pings and our-kill celebration posts unchanged.',
  ],
  '2.6.3': [
    'PvP fyi-pings now silent during raid hours (Sun/Wed/Thu 8:30–11:30 PM Eastern) — raiders aren\'t getting paged about an Old Guk NPC kill against a random Mayhem player mid-pull. Wolf-Pack-death backup pings are unchanged and still fire any time.',
  ],
  '2.6.4': [
    'Parse-card extras (data starts collecting now; display lights up after the next agent push): boss self-heal totals (Lady Vox CH and the like) will show as `27.1k (+10k healed)` on kill cards, and Feral Avatar / Savagery receives will give per-fight `FE×3 SAV×2` badges next to player names plus a totals strip on the `/fun` page.',
  ],
  '2.6.5': [
    'OpenDKP sync now runs every 30 min (was 6h) so the **/parses Tonight** panel reflects in-progress raid attendance as ticks come in. Web also adds pattern-based pet detection so wizard familiars and similar pets stop inflating the "Unknown" bucket on the Damage-by-class chart.',
  ],
  '2.6.6': [
    'Charm sessions: every charm landing (Mistmoore glyphed familiars, etc.) now starts a tracked session — pet name + owner + total damage + duration. Dire Charm casts flag the next landing as a DC session. The `/fun` page gets a new "Longest Dire Charm" card for bragging rights.',
  ],
  '2.6.7': [
    '`@PVP` pings now ONLY fire when Wolf Pack is actually involved (our kill or our death). Non-WP deaths in PvP-zone broadcasts post as plain death notices with no role mention, raid hours or not. Also fixed: a Wolf Pack member killing an NPC (e.g. "Adiwen killed Lord of Ire of <null>") no longer triggers the AWROOOO PvP-celebration path — NPC victims with no real guild post as informational notices.',
  ],
  '2.6.8': [
    'Squashed double-posting: when one Mimic install tails a main + alts, server/guild broadcasts (guild chat, PvP kills) were captured once per log and posted twice. Now deduped at the source + by normalized text on the bot. Also fixed the stray `[]` after some chat names (empty class tag) and the GMT-instead-of-local timestamps on the chat history page.',
  ],
  '2.6.9': [
    'Fixed a PvP-leaderboard undercount: backfilling your full log collapsed every repeat kill of the same player into one (the text-only dedup from 2.6.8 was too aggressive on historical replays). PvP dedup now buckets by time so distinct kills are kept and only true live duplicates collapse.',
  ],
  '2.6.10': [
    'Local dashboard panels (Damage, Recent Parses, PvP) get a `🛰 local | 🌐 server` header toggle — click 🌐 to swap to the wolfpack.quest aggregates (last 30 days / lifetime) right in place. Selection persists per panel.',
  ],
  '2.6.13': [
    'New **💸 Live Bidding** panel on the local dashboard (and as an overlay). Shows OpenDKP auctions in real time with a one-click bid input, marks items already on your wishlist with a ★, and lists your currently-placed bids underneath so you can keep track when you spread DKP across multiple items.',
  ],
  '2.6.15': [
    'Boards now rebuild spawn timers from Supabase (the parse/kill record) automatically on startup and every 6h — so after a redeploy or volume reset the cooldowns repopulate themselves instead of showing everything "Available now." `/recoverkills` still does it on demand.',
  ],
  '2.6.16': [
    'Parses are now scoped to the fight you were actually in. Before, a nearby raider meleeing a *different* mob could show up as a phantom contributor on your kill (e.g. a solo named kill listing 4 extra names). Damage now only counts toward an encounter if it landed on a target the uploader engaged.',
  ],
};

// Semver-aware ascending compare. "2.5.9" < "2.5.10" the right way (regular
// string compare would put "2.5.10" before "2.5.9" because '1' < '9').
function _semverCompare(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── Internal: write-through to Supabase ───────────────────────────────────────
function _guildId() {
  return process.env.DISCORD_GUILD_ID || 'wolfpack-quarm';
}

function _upsertRow(discordId) {
  if (!_supabaseEnabled) return;
  const row = _state[discordId];
  if (!row) return;
  const supabase = require('./supabase');
  supabase.upsert('member_onboarding_state', [{
    guild_id:                _guildId(),
    discord_id:              discordId,
    last_seen_version:       row.last_seen_version       || null,
    last_seen_agent_version: row.last_seen_agent_version || null,
    opted_out:               !!row.opted_out,
    updated_at:              new Date().toISOString(),
  }], 'guild_id,discord_id').catch(err =>
    console.warn('[onboarding] upsert failed:', err?.message));
}

// ── State accessors (sync via cache; writes fire-and-forget to DB) ───────────
function _ensureRow(discordId) {
  if (!_state[discordId]) {
    _state[discordId] = { last_seen_version: null, last_seen_agent_version: null, opted_out: false };
  }
  return _state[discordId];
}

function isOptedOut(userId) {
  return !!_state[userId]?.opted_out;
}

function getOptedOutVersion(userId) {
  // Pre-refactor name kept for compatibility. Semantically this is now
  // "the version they were on when they opted out" — which == last_seen_version
  // at the moment they hit the dismiss button.
  return _state[userId]?.opted_out ? (_state[userId].last_seen_version || null) : null;
}

function setOptedOut(userId, version) {
  const row = _ensureRow(userId);
  row.opted_out         = true;
  row.last_seen_version = version || row.last_seen_version || null;
  _upsertRow(userId);
}

function removeOptOut(userId) {
  if (!_state[userId]) return;
  _state[userId].opted_out = false;
  _upsertRow(userId);
}

function getLastSeenVersion(userId) {
  return _state[userId]?.last_seen_version || null;
}

function setLastSeenVersion(userId, version) {
  const row = _ensureRow(userId);
  if (row.last_seen_version === version) return;
  row.last_seen_version = version;
  _upsertRow(userId);
}

function getLastSeenAgentVersion(userId) {
  return _state[userId]?.last_seen_agent_version || null;
}

function setLastSeenAgentVersion(userId, version) {
  const row = _ensureRow(userId);
  if (row.last_seen_agent_version === version) return;
  row.last_seen_agent_version = version;
  _upsertRow(userId);
}

// Return every member who has opted in (any row exists, not opted out) and
// whose last_seen_agent_version is behind the supplied version. Used by the
// agent-release DM fanout.
function listMembersBehindAgentVersion(currentVersion) {
  const out = [];
  for (const [discordId, row] of Object.entries(_state)) {
    if (row?.opted_out) continue;
    const seen = row?.last_seen_agent_version || null;
    if (!seen || _semverCompare(seen, currentVersion) < 0) {
      out.push({ discordId, lastSeenAgentVersion: seen });
    }
  }
  return out;
}

// Slice an agent-release bullets bag down to the versions strictly between
// (lastSeen, current]. Uses the same semver compare as changesSince so
// 2.4.10 sorts above 2.4.9 correctly.
function sliceAgentBulletsAfter(allBullets, lastSeenAgentVersion) {
  const out = {};
  for (const [v, bullets] of Object.entries(allBullets || {})) {
    if (!Array.isArray(bullets) || !bullets.length) continue;
    if (!lastSeenAgentVersion || _semverCompare(v, lastSeenAgentVersion) > 0) out[v] = bullets;
  }
  return out;
}

// ── Changelog helper ──────────────────────────────────────────────────────────
// Returns an array of new feature strings for versions strictly greater than
// sinceVersion. When sinceVersion is falsy, returns every entry.
function changesSince(sinceVersion) {
  const versions = Object.keys(CHANGELOGS).sort(_semverCompare);
  const out = [];
  for (const v of versions) {
    if (!sinceVersion || _semverCompare(v, sinceVersion) > 0) {
      for (const l of CHANGELOGS[v]) out.push(`**${v}** ${l}`);
    }
  }
  return out;
}

// ── Persistence — load from Supabase ─────────────────────────────────────────
async function loadOnboardingData(client) {
  // 1) Try Supabase first (canonical store).
  try {
    const supabase = require('./supabase');
    if (supabase.isEnabled()) {
      _supabaseEnabled = true;
      const rows = await supabase.select(
        'member_onboarding_state',
        `guild_id=eq.${encodeURIComponent(_guildId())}&select=discord_id,last_seen_version,last_seen_agent_version,opted_out`
      );
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (!r?.discord_id) continue;
          _state[r.discord_id] = {
            last_seen_version:       r.last_seen_version       || null,
            last_seen_agent_version: r.last_seen_agent_version || null,
            opted_out:               !!r.opted_out,
          };
        }
        console.log(`[onboarding] Loaded ${rows.length} member state row(s) from Supabase`);
      }
    }
  } catch (err) {
    console.warn('[onboarding] Supabase load failed:', err?.message);
  }

  // 2) Locate the instructions message in the onboarding thread so
  // postOrUpdateInstructions edits in place instead of posting fresh.
  const threadId = process.env.ONBOARDING_THREAD_ID;
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);
    const msgs   = await thread.messages.fetch({ limit: 100 });
    for (const msg of msgs.values()) {
      if (msg.author.id !== client.user.id) continue;
      if (msg.embeds[0]?.title === INSTRUCTIONS_TITLE) {
        _instructionsMsgId = msg.id;
        break;
      }
    }
  } catch (err) {
    console.warn('[onboarding] Could not load instructions msg id:', err?.message);
  }
}

// ── No-op for compat — DB is canonical now ───────────────────────────────────
// Existing call sites still invoke this after they mutate state. The actual
// write happens inline via _upsertRow() in the setters; this is a stub so we
// don't have to touch every caller.
async function saveOnboardingData(/* client */) { /* no-op */ }

// ── Public instructions embed (visible to the whole channel) ─────────────────
function buildInstructionsEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(INSTRUCTIONS_TITLE)
    .setDescription(
      'Everything you need to run with the pack. Run `/onboarding` at any time to see the full welcome message again.'
    )
    .addFields(
      {
        name: '⚔️ Kill Tracking',
        value: [
          '`/kill <boss>` — Log a kill and start the respawn timer',
          '`/unkill <boss>` — Remove a false kill record',
          '`/updatetimer <boss> <time>` — Override the respawn timer (e.g. `"3d4h30m"`)',
          '`/timers [zone] [filter]` — View all spawn timers by zone or status',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📣 Raid Announcements',
        value: [
          '`/announce time:<when> [boss/zone]` — Create a raid thread + Discord event',
          '`/addtarget` / `/removetarget` — Manage event targets in the announce thread',
          '`/adjusttime` / `/adjustdate` — Update the event time or date',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🛠️ Admin / Setup',
        value: [
          '`/board` — Post or refresh all boards and cooldown cards',
          '`/cleanup` — Remove duplicate/stale messages',
          '`/restore <links...>` — Rebuild kill state from cooldowns or summary messages',
          '`/addboss <pqdi_url>` / `/removeboss <boss>` — Manage the boss list',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📖 Help',
        value: '`/raidbosshelp` — Full command reference (ephemeral)\n`/onboarding` — Show the welcome message again or toggle opt-out',
        inline: false,
      },
    )
    .setFooter({ text: 'Timer data sourced from PQDI.cc • Wolf Pack EQ (Quarm)' });
}

async function postOrUpdateInstructions(client) {
  const threadId = process.env.ONBOARDING_THREAD_ID;
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);
    const embed  = buildInstructionsEmbed();

    if (_instructionsMsgId) {
      try {
        const msg = await thread.messages.fetch(_instructionsMsgId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {}
    }
    const msg          = await thread.send({ embeds: [embed] });
    _instructionsMsgId = msg.id;
    await saveOnboardingData(client);
  } catch (err) {
    console.warn('[onboarding] Could not post/update instructions:', err?.message);
  }
}

// ── Welcome message builders ──────────────────────────────────────────────────
function buildWelcomeEmbed() {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🏹 Welcome to the Wolf Pack Raid Tracker!')
    .setDescription(
      'This bot keeps the pack coordinated across three pillars. ' +
      'Hit a button below to tell us how you\'d like to run with the pack.'
    )
    .addFields(
      {
        name: '⚔️ Accountability',
        value:
          'When you kill a boss, click its button on the board. That logs the kill and starts the ' +
          'respawn countdown — accurate tracking means the whole pack knows when to be ready.',
        inline: false,
      },
      {
        name: '⏱️ Timing',
        value:
          'The board and the **Spawning in the Next 24 Hours** card show exactly when each boss is ' +
          'back up. Never miss a window because no one wrote it down.',
        inline: false,
      },
      {
        name: '📣 Coordination',
        value:
          'Use `/announce` to schedule a group takedown — it creates a thread, a Discord event, and ' +
          'rallies the pack.\nRun `/raidbosshelp` for a full command reference.',
        inline: false,
      },
      {
        name: '🔒 Your data, your call',
        value:
          'Your raw logs stay on your machine — only what you opt into syncs. Read the privacy ' +
          'statement and toggle per-character exclusions any time at ' +
          '**https://wolfpack.quest/privacy** and **https://wolfpack.quest/me**.',
        inline: false,
      },
    );
}

function buildOrganizerEmbed() {
  const { getAllowedRoles } = require('./roles');
  const roles = getAllowedRoles().map(r => `**${r}**`).join(', ');
  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🗡️ Raid organizer — here\'s what to know:')
    .addFields(
      {
        name: 'Scheduling',
        value: [
          'Use `/announce` to schedule a takedown with a thread, Discord event, and role ping.',
          'Use `/addtarget`, `/adjusttime`, and `/adjustdate` inside the raid thread to update details.',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Kill Tracking',
        value:
          `Board buttons and \`/kill\` require one of these roles: ${roles}.\n` +
          'Run `/raidbosshelp` for a full command reference.',
        inline: false,
      },
    )
    .setFooter({ text: 'You can get this message again at any time with /onboarding' });
}

function buildAttendeeEmbed() {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('👀 Just here to attend?')
    .setDescription(
      'Keep an eye on Discord events and announcements in raid channels. ' +
      'When you\'re ready to start tracking kills, run `/onboarding` again or use `/raidbosshelp` anytime.'
    )
    .setFooter({ text: 'You can get this message again at any time with /onboarding' });
}

// Direct GitHub-release download URL. The `parser.wolfpack.quest` CNAME-to-
// GitHub can't terminate TLS, so always link the release artifact directly.
const PARSER_DOWNLOAD_URL =
  'https://github.com/davehess/QuarmBossTracker/releases/latest/download/WolfPackParser.zip';

// ── Onboarding action rows ────────────────────────────────────────────────────
function buildParseOverviewEmbed() {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🐺 Wolf Pack Parser — Setup')
    .setDescription('The Wolf Pack Parser runs in the background and keeps your timers in sync.')
    .addFields(
      {
        name: '📥 Download',
        value:
          `[**Download WolfPackParser.zip**](${PARSER_DOWNLOAD_URL}) — unzip anywhere on your drive.\n` +
          'Double-click **`RUN-FIRST-for-Node.js.bat`** once, then **`Parser.bat`** each session.\n' +
          'Full setup walkthrough: `/parsehelp`',
        inline: false,
      },
    )
    .setFooter({ text: 'Run /raidbosshelp for the full command reference' });
}

// Compact "what's new since you last saw this" embed. Used on /onboarding and
// the GuildMemberAdd DM whenever last_seen_version < current. The full welcome
// is accessible via the [Show full welcome] button next to it.
function buildChangesEmbed(currentVersion, lastSeenVersion, changes) {
  const since = lastSeenVersion ? `since v${lastSeenVersion}` : 'since you were last here';
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📦 What's new ${since}`)
    .setDescription(
      changes.length
        ? changes.map(c => `• ${c}`).join('\n')
        : '_Nothing new since you were last here._'
    )
    .setFooter({ text: `Current: v${currentVersion} • Run /raidbosshelp for the full command reference` });
}

function buildChangesComponents(version) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`onb_show_full:${version}`)
        .setLabel('Show full welcome')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📖'),
      new ButtonBuilder()
        .setCustomId(`onb_ignore:${version}`)
        .setLabel('Don\'t ping me on revisions')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔕'),
    ),
  ];
}

// Agent-release DM body. Sent to opted-in members whose
// last_seen_agent_version < current. Bullets come from
// data/agent_release_notes.json — one bucket per agent version.
function buildAgentReleaseEmbed(currentAgentVersion, lastSeenAgentVersion, bulletsByVersion) {
  const since = lastSeenAgentVersion ? `since v${lastSeenAgentVersion}` : '';
  const versionsAsc = Object.keys(bulletsByVersion).sort(_semverCompare);
  const lines = [];
  for (const v of versionsAsc) {
    const bullets = bulletsByVersion[v] || [];
    if (!bullets.length) continue;
    lines.push(`**v${v}**`);
    for (const b of bullets) lines.push(`• ${b}`);
    lines.push('');
  }
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`📦 Wolf Pack Parser — what's new ${since}`.trim())
    .setDescription(
      lines.length
        ? lines.join('\n').trim()
        : `Parser is now at **v${currentAgentVersion}**. Re-launch **Parser.bat** to update.`
    )
    .setFooter({ text: `Now at v${currentAgentVersion} • Re-launch Parser.bat to update — or click ↻ Check for update at http://localhost:7777` });
}

function buildAgentReleaseComponents(agentVersion) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setURL(PARSER_DOWNLOAD_URL)
        .setLabel('Download latest')
        .setStyle(ButtonStyle.Link)
        .setEmoji('📥'),
      // Reuses the existing dismiss handler — version tag is the AGENT
      // version, which the handler treats as a string token; setOptedOut
      // stores it on row.last_seen_version. That's a slight semantic blur
      // (we're stashing an agent version in a bot-version field), but it's
      // fine: the only thing opted_out gates is the GuildMemberAdd DM.
      new ButtonBuilder()
        .setCustomId(`onb_ignore:${agentVersion}`)
        .setLabel('Don\'t ping me on revisions')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔕'),
    ),
  ];
}

function buildWelcomeComponents(version) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const roleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('onb_pvp').setLabel('Count me in for PVP').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('onb_organizer').setLabel('I want to help organize').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('onb_deeps').setLabel('Set up the parser').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('onb_attend').setLabel('Just here to attend').setStyle(ButtonStyle.Secondary),
  );
  const optRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`onb_ignore:${version}`)
      .setLabel('Don\'t show me this again')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔕'),
  );
  return [roleRow, optRow];
}

function buildShowAgainComponents() {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('onb_show_again')
        .setLabel('Show me onboarding again')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔔'),
    ),
  ];
}

module.exports = {
  isOptedOut,
  getOptedOutVersion,
  setOptedOut,
  removeOptOut,
  getLastSeenVersion,
  setLastSeenVersion,
  getLastSeenAgentVersion,
  setLastSeenAgentVersion,
  listMembersBehindAgentVersion,
  sliceAgentBulletsAfter,
  changesSince,
  loadOnboardingData,
  saveOnboardingData,
  postOrUpdateInstructions,
  buildWelcomeEmbed,
  buildOrganizerEmbed,
  buildAttendeeEmbed,
  buildParseOverviewEmbed,
  buildWelcomeComponents,
  buildShowAgainComponents,
  buildChangesEmbed,
  buildChangesComponents,
  buildAgentReleaseEmbed,
  buildAgentReleaseComponents,
  buildInstructionsEmbed,
  PARSER_DOWNLOAD_URL,
  REGISTRY_TITLE,
  INSTRUCTIONS_TITLE,
};
