// utils/onboarding.js — Opt-out registry for the member onboarding welcome message.
// User IDs are never stored in plaintext; only a salted SHA-256 hash is kept.
// The registry and the public instructions embed both live in ONBOARDING_THREAD_ID.
const crypto        = require('crypto');
const { EmbedBuilder } = require('discord.js');

const REGISTRY_TITLE     = '📋 Onboarding Opt-Out Registry';
const INSTRUCTIONS_TITLE = '📖 Wolf Pack Raid Tracker — Quick Start';

// In-memory state loaded on startup
let _optOuts            = {};   // { sha256hash -> "1.0.0" (version opted-out at) }
let _registryMsgId      = null;
let _instructionsMsgId  = null;

// ── Changelog — new commands/features per version ─────────────────────────────
const CHANGELOGS = {
  '1.0.0': [
    '`/parse <data>` — submit an EQLogParser DPS parse after a kill (auto-detects boss)',
    '`/parseboss <boss> <data>` — submit a parse with explicit boss selection',
    '`/parsestats <boss>` — DPS scoreboard and raid metrics for a boss across all kills',
    '`/parseaoe <data>` — submit an AoE parse (combines within a 5-minute window)',
    '`/parsenight [public]` — full-night DPS summary across every kill tonight',
    '`/raidnight` — open tonight\'s raid parse thread with a live rolling scoreboard',
  ],
  '1.0.1': [
    '`/onboarding` — show the welcome message again, or toggle your opt-out preference',
  ],
};

// ── Hashing ───────────────────────────────────────────────────────────────────
function _salt() {
  return process.env.DISCORD_GUILD_ID || 'wolfpack-quarm';
}

function hashUser(userId) {
  return crypto.createHash('sha256').update(userId + _salt()).digest('hex');
}

// ── Opt-out accessors ─────────────────────────────────────────────────────────
function isOptedOut(userId) {
  return hashUser(userId) in _optOuts;
}

function getOptedOutVersion(userId) {
  return _optOuts[hashUser(userId)] || null;
}

function setOptedOut(userId, version) {
  _optOuts[hashUser(userId)] = version;
}

function removeOptOut(userId) {
  delete _optOuts[hashUser(userId)];
}

// ── Changelog helper ──────────────────────────────────────────────────────────
// Returns an array of new feature strings for versions > sinceVersion.
function changesSince(sinceVersion) {
  const versions = Object.keys(CHANGELOGS).sort();
  const changes  = [];
  let   counting = false;
  for (const v of versions) {
    if (counting) changes.push(...CHANGELOGS[v].map(l => `**${v}** ${l}`));
    if (v === sinceVersion) counting = true;
  }
  return changes;
}

// ── Persistence — load from Discord ──────────────────────────────────────────
async function loadOnboardingData(client) {
  const threadId = process.env.ONBOARDING_THREAD_ID;
  if (!threadId) {
    console.warn('[onboarding] ONBOARDING_THREAD_ID not set — opt-out tracking disabled');
    return;
  }
  try {
    const thread = await client.channels.fetch(threadId);
    const msgs   = await thread.messages.fetch({ limit: 100 });
    for (const msg of msgs.values()) {
      if (msg.author.id !== client.user.id) continue;
      if (msg.embeds[0]?.title === REGISTRY_TITLE) {
        _registryMsgId = msg.id;
        try {
          const data = JSON.parse(msg.embeds[0].description);
          _optOuts           = data.optOuts           || {};
          _instructionsMsgId = data.instructionsMsgId || null;
        } catch {}
        break;
      }
    }
    console.log(`[onboarding] Loaded ${Object.keys(_optOuts).length} opt-out entries`);
  } catch (err) {
    console.warn('[onboarding] Could not load opt-out data:', err?.message);
  }
}

// ── Persistence — save to Discord ─────────────────────────────────────────────
async function saveOnboardingData(client) {
  const threadId = process.env.ONBOARDING_THREAD_ID;
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);
    const embed  = new EmbedBuilder()
      .setTitle(REGISTRY_TITLE)
      .setColor(0x2b2d31)
      .setDescription(JSON.stringify({ optOuts: _optOuts, instructionsMsgId: _instructionsMsgId }))
      .setTimestamp()
      .setFooter({ text: `${Object.keys(_optOuts).length} opted-out • salted SHA-256 hashes only — no user IDs stored` });

    if (_registryMsgId) {
      try {
        const msg = await thread.messages.fetch(_registryMsgId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {}
    }
    const msg      = await thread.send({ embeds: [embed] });
    _registryMsgId = msg.id;
  } catch (err) {
    console.warn('[onboarding] Could not save opt-out data:', err?.message);
  }
}

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
        name: '📊 Parse Tracking',
        value: [
          '`/parse <data>` — Submit an EQLogParser DPS parse (boss auto-detected)',
          '`/parseboss <boss> <data>` — Submit a parse with explicit boss',
          '`/parsestats <boss>` — DPS scoreboard for a boss across all kills',
          '`/parseaoe <data>` — AoE parse combining within a 5-minute window',
          '`/parsenight [public]` — Full-night DPS summary across all tonight\'s kills',
          '`/raidnight` — Open tonight\'s raid parse thread with live scoreboard',
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
      {
        name: '📊 Parse Tracking',
        value: [
          'After each kill, paste your EQLogParser output into `/parse` — the boss is auto-detected.',
          'Use `/parsestats <boss>` for the DPS scoreboard, `/parsenight` for a full-night summary.',
        ].join('\n'),
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

// ── Onboarding action rows ────────────────────────────────────────────────────
function buildWelcomeComponents(version) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const roleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('onb_pvp').setLabel('Count me in for PVP').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('onb_organizer').setLabel('I want to help organize').setStyle(ButtonStyle.Primary),
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
  hashUser,
  isOptedOut,
  getOptedOutVersion,
  setOptedOut,
  removeOptOut,
  changesSince,
  loadOnboardingData,
  saveOnboardingData,
  postOrUpdateInstructions,
  buildWelcomeEmbed,
  buildOrganizerEmbed,
  buildAttendeeEmbed,
  buildWelcomeComponents,
  buildShowAgainComponents,
  buildInstructionsEmbed,
  REGISTRY_TITLE,
  INSTRUCTIONS_TITLE,
};
