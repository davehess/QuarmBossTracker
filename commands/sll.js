// commands/sll.js — Import timers from EverQuest #showlootlockouts output.
//
// Usage: /sll <paste>
//
// Paste the output of the EQ command "#showlootlockouts" (or /sll in-game).
// The bot extracts each lockout entry, matches it against bosses.json by zone
// name or boss name, and sets nextSpawn = now + timeRemaining for every match.
//
// WHY THIS IS ACCURATE:
//   On Project Quarm, your raid lockout timer equals the boss respawn timer
//   exactly. The remaining time on your lockout IS the remaining time until
//   the boss is available again in a new instance.
//
// HOW TO GET THE PASTE:
//   1. In EQ, type:  #showlootlockouts   (or /sll if you have that alias)
//   2. Your chat shows one line per active lockout with time remaining
//   3. Copy-paste those lines into the Discord /sll command
//
// EXAMPLE INPUT (any of these formats work):
//   Vex Thal - 2 Days, 14 Hours, 22 Minutes, 5 Seconds Remaining
//   [Mon May 26 21:00:00 2026] Ssraeshza Temple - 1 Day, 2 Hours, 14 Minutes Remaining
//   You have a lockout for the instance of Acrylia Caverns - 3 Days 6 Hours
//   Aten Ha Ra: 2d14h22m
//
// MATCHING LOGIC:
//   Each line is matched against boss names, boss nicknames, AND zone names
//   in bosses.json. If a zone has multiple bosses, ALL of them get updated
//   (since one instance lockout covers all bosses in that zone).
//
// OFFICER ONLY — changes live spawn timers.

'use strict';

const { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { parseTimeString, discordRelativeTime, discordAbsoluteTime } = require('../utils/timer');
const { getBossState, overrideTimer, recordKill } = require('../utils/state');
const { postKillUpdate } = require('../utils/killops');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

// ── Line parser ──────────────────────────────────────────────────────────────
// Strips EQ log timestamps and normalises whitespace.
// Returns { label, timeStr } or null.
function parseLockoutLine(raw) {
  // Strip [Day Mon DD HH:MM:SS YYYY] prefix
  const stripped = raw.replace(/^\[.*?\]\s*/, '').trim();
  if (!stripped) return null;

  // Common EQ lockout prefixes to strip
  const cleaned = stripped
    .replace(/^You have a lockout (?:for )?(?:on )?(?:the instance of )?/i, '')
    .replace(/^Loot Lockout:\s*/i, '')
    .trim();

  // Split on common delimiters between name and time:
  //   "Vex Thal - 2 Days..."
  //   "Vex Thal: 2 Days..."
  //   "Vex Thal (2 Days...)"
  const delimMatch = cleaned.match(/^(.+?)\s*[-:(]\s*(.+)$/);
  if (!delimMatch) return null;

  let label   = delimMatch[1].replace(/\)$/, '').trim();
  let timeStr = delimMatch[2].replace(/\)$/, '').trim();

  // Swap if label looks like a time string (unlikely but safe)
  if (!parseTimeString(timeStr) && parseTimeString(label)) {
    [label, timeStr] = [timeStr, label];
  }

  const ms = parseTimeString(timeStr);
  if (!ms) return null;

  return { label: label.toLowerCase(), timeStr, remainingMs: ms };
}

// ── Boss matching ─────────────────────────────────────────────────────────────
// Returns all bosses whose name, nicknames, OR zone matches the label.
function matchBosses(label, bosses) {
  const lc = label.toLowerCase().trim();
  return bosses.filter(b => {
    if (b.name.toLowerCase() === lc)                                return true;
    if ((b.nicknames || []).some(n => n.toLowerCase() === lc))      return true;
    if (b.zone.toLowerCase() === lc)                                return true;
    // Partial zone match — e.g. "ssraeshza temple" matches "Ssraeshza Temple - Sanctum"
    if (b.zone.toLowerCase().startsWith(lc))                        return true;
    if (lc.startsWith(b.zone.toLowerCase()))                        return true;
    // Partial boss name match (generous — the SLL output might abbreviate)
    if (b.name.toLowerCase().includes(lc) || lc.includes(b.name.toLowerCase())) return true;
    return false;
  });
}

// ── Main execute ─────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('sll')
    .setDescription('Import spawn timers from #showlootlockouts — paste your EQ lockout output')
    .addStringOption(opt =>
      opt.setName('paste')
        .setDescription('Paste the output of #showlootlockouts from EQ chat (one lockout per line)')
        .setRequired(true)
        .setMaxLength(4000)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    const paste  = interaction.options.getString('paste');
    const bosses = getBosses();
    const now    = Date.now();

    // ── Parse every line ──────────────────────────────────────────────────────
    const lines  = paste.split(/\n/).map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(parseLockoutLine).filter(Boolean);

    if (parsed.length === 0) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content:
          '❌ Couldn\'t parse any lockout entries from that paste.\n\n' +
          '**Expected formats (any of these work):**\n' +
          '```\n' +
          'Vex Thal - 2 Days, 14 Hours, 22 Minutes Remaining\n' +
          'Ssraeshza Temple - 1 Day, 2 Hours Remaining\n' +
          'Acrylia Caverns - 3d6h\n' +
          '[Mon May 26 21:00:00 2026] Aten Ha Ra - 2 Days 14 Hours\n' +
          '```\n' +
          'Make sure each line has a name followed by ` - `, `:`, or `(` and then a time.',
      });
    }

    // ── Match each entry to bosses ────────────────────────────────────────────
    const updates   = []; // { boss, nextSpawn, remainingMs, label }
    const unmatched = []; // { label, timeStr } — couldn't find a boss

    for (const entry of parsed) {
      const matched = matchBosses(entry.label, bosses);
      if (matched.length === 0) {
        unmatched.push(entry);
      } else {
        const nextSpawn = now + entry.remainingMs;
        for (const boss of matched) {
          // Avoid duplicates if two entries matched the same boss
          if (!updates.find(u => u.boss.id === boss.id)) {
            updates.push({ boss, nextSpawn, remainingMs: entry.remainingMs, label: entry.label });
          }
        }
      }
    }

    if (updates.length === 0) {
      const unmatchedList = unmatched.map(u => `• **${u.label}** — ${u.timeStr}`).join('\n');
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content:
          `❌ Found ${parsed.length} lockout entry/entries but none matched any boss or zone in our tracker.\n\n` +
          `**Unmatched entries:**\n${unmatchedList}\n\n` +
          `Check that the boss/zone names match what's in \`/timers\`. ` +
          `Use \`/updatetimer\` to set individual timers manually.`,
      });
    }

    // ── Build preview embed ───────────────────────────────────────────────────
    const matchLines = updates.map(u => {
      const existing = getBossState(u.boss.id);
      const wasKnown = existing?.killedAt ? '🔄' : '🆕';
      return `${wasKnown} **${u.boss.name}** → ${discordAbsoluteTime(u.nextSpawn)} (${discordRelativeTime(u.nextSpawn)})`;
    });

    const unmatchedNote = unmatched.length > 0
      ? `\n\n⚠️ **${unmatched.length} unmatched** (no boss/zone found):\n${unmatched.map(u => `• ${u.label}`).join('\n')}`
      : '';

    const embed = new EmbedBuilder()
      .setColor(0xf0b132)
      .setTitle('⏱️ Lockout Import Preview')
      .setDescription(
        `Found **${updates.length}** boss timer${updates.length === 1 ? '' : 's'} to update from **${parsed.length}** lockout line${parsed.length === 1 ? '' : 's'}.\n\n` +
        matchLines.join('\n') +
        unmatchedNote
      )
      .setFooter({ text: '🆕 = no prior kill recorded  🔄 = overwriting existing timer' });

    // One-click confirm button
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sll_confirm:${interaction.id}`)
        .setLabel(`✅ Apply ${updates.length} timer${updates.length === 1 ? '' : 's'}`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('sll_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    // Store updates keyed by interaction id for the button handler
    _pendingSll.set(interaction.id, { updates, userId: interaction.user.id, ts: Date.now() });

    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed], components: [row] });
  },
};

// ── Pending SLL confirmations (expire after 2 min) ───────────────────────────
const _pendingSll = new Map();
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const [k, v] of _pendingSll.entries()) {
    if (v.ts < cutoff) _pendingSll.delete(k);
  }
}, 30_000);

// ── Button handler (called from index.js) ────────────────────────────────────
async function handleSllConfirm(interaction) {
  const interactionId = interaction.customId.split(':')[1];
  const pending       = _pendingSll.get(interactionId);

  if (!pending || pending.userId !== interaction.user.id) {
    return interaction.update({ content: '❌ Session expired or wrong user. Run `/sll` again.', embeds: [], components: [] });
  }

  _pendingSll.delete(interactionId);
  const { updates } = pending;
  const now = Date.now();

  // Apply all timers
  const applied = [];
  for (const { boss, nextSpawn, remainingMs } of updates) {
    const existing = getBossState(boss.id);
    if (existing?.killedAt) {
      // Boss already has a kill — just override the nextSpawn
      overrideTimer(boss.id, nextSpawn);
    } else {
      // No kill recorded — back-calculate kill time from timer length and remaining
      const killTime  = nextSpawn - boss.timerHours * 3600 * 1000;
      const killedAt  = killTime > 0 ? killTime : now - (boss.timerHours * 3600 * 1000 - remainingMs);
      recordKill(boss.id, boss.timerHours, interaction.user.id, killedAt);
    }
    applied.push(boss.id);
  }

  // Refresh all boards (parallel, non-blocking)
  const refreshBatch = [...new Set(applied)];
  for (const bossId of refreshBatch) {
    postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId).catch(() => {});
  }

  const lines = updates.map(u =>
    `✅ **${u.boss.name}** — spawns ${discordRelativeTime(u.nextSpawn)}`
  );

  return interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`⏱️ ${applied.length} Timer${applied.length === 1 ? '' : 's'} Applied`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Boards and cards updated. Run /timers to verify.' }),
    ],
    components: [],
  });
}

async function handleSllCancel(interaction) {
  return interaction.update({ content: '❌ Cancelled — no timers changed.', embeds: [], components: [] });
}

module.exports.handleSllConfirm = handleSllConfirm;
module.exports.handleSllCancel  = handleSllCancel;
module.exports._pendingSll      = _pendingSll;
