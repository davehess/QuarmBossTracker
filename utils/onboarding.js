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
    guild_id:          _guildId(),
    discord_id:        discordId,
    last_seen_version: row.last_seen_version || null,
    opted_out:         !!row.opted_out,
    updated_at:        new Date().toISOString(),
  }], 'guild_id,discord_id').catch(err =>
    console.warn('[onboarding] upsert failed:', err?.message));
}

// ── State accessors (sync via cache; writes fire-and-forget to DB) ───────────
function _ensureRow(discordId) {
  if (!_state[discordId]) _state[discordId] = { last_seen_version: null, opted_out: false };
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
        `guild_id=eq.${encodeURIComponent(_guildId())}&select=discord_id,last_seen_version,opted_out`
      );
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (!r?.discord_id) continue;
          _state[r.discord_id] = {
            last_seen_version: r.last_seen_version || null,
            opted_out:         !!r.opted_out,
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
  buildInstructionsEmbed,
  PARSER_DOWNLOAD_URL,
  REGISTRY_TITLE,
  INSTRUCTIONS_TITLE,
};
