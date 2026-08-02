// commands/raidreview.js — [#80] post (or refresh) a night's Raid Night Review.
//
// The review posts itself ~45 min after midnight (utils/raidReview.js, armed by
// the midnight chain). This command exists for the three cases the timer can't
// cover:
//   • a late upload landed and the writeup should be refreshed — a re-run EDITS
//     the same message, it never posts a second one;
//   • an officer wants to look at an older night;
//   • `preview:true` — build the review and show it to the officer ONLY, so it
//     can be eyeballed before the guild sees it.
//
// Design + content decisions: docs/DESIGN-80-raid-night-review.md

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const raidReview = require('../utils/raidReview');
const { getDefaultTz, localToUTC } = require('../utils/timezone');

// Accept YYYY-MM-DD or M/D/YYYY, both in the guild timezone. Returns a ms
// timestamp INSIDE that night (midday), which nightWindowFor resolves back to
// the right night key. Null when unparseable.
function parseDateArg(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let y, m, d;
  let mm = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else {
    mm = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
    if (!mm) return null;
    m = +mm[1]; d = +mm[2]; y = +mm[3];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // 21:00 local on that date — comfortably inside the night that STARTED then.
  return localToUTC(y, m, d, 21, 0, getDefaultTz()).getTime();
}

const REASONS = {
  'supabase-disabled': 'Supabase is not configured on this bot, so there is nothing to build a review from.',
  'no-kills':          'No confirmed kills are recorded for that night — nothing to review.',
  'below-min-kills':   'That night is below the minimum kill count for a review (`RAID_REVIEW_MIN_KILLS`).',
  'no-thread':         'Built the review, but could not resolve that night\'s Discord thread to post it in.',
  'event-night':       'That night resolves to an off-night **event** thread, which gets its roll-loot card instead of a review.',
  'error':             'Something went wrong building the review — check the bot logs.',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raidreview')
    .setDescription('Post or refresh the Raid Night Review for a night (officers).')
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Night to review — YYYY-MM-DD or M/D/YYYY. Defaults to the most recent finished night.')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('preview')
        .setDescription('Show it to me only — do not post it to the raid thread.')
        .setRequired(false)),

  async execute(interaction) {
    if (!interaction.member || !hasOfficerRole(interaction.member)) {
      return interaction.reply({
        content: `⛔ This command is for ${officerRolesList()}.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const dateArg = interaction.options.getString('date');
    const preview = interaction.options.getBoolean('preview') === true;

    let atMs;
    if (dateArg) {
      atMs = parseDateArg(dateArg);
      if (!atMs) {
        return interaction.editReply('❌ Could not read that date. Use `YYYY-MM-DD` or `M/D/YYYY` (e.g. `2026-07-30`).');
      }
    } else {
      const win = raidReview.mostRecentReviewableNight(Date.now(), { horizonHours: 0 });
      if (!win) return interaction.editReply('❌ Could not work out which night to review — pass a `date`.');
      atMs = win.fromMs + 3_600_000;
    }

    const res = await raidReview.postRaidNightReview(interaction.client, { atMs, dryRun: preview });

    if (!res.ok) {
      const why = REASONS[res.reason] || `Could not post the review (\`${res.reason}\`).`;
      // A dry-run that produced embeds is still worth showing even if posting
      // would have been refused.
      if (res.embeds?.length) {
        return interaction.editReply({ content: `⚠️ ${why}\n\nHere is what it would have said:`, embeds: res.embeds });
      }
      return interaction.editReply(`⚠️ ${why}`);
    }

    if (preview) {
      return interaction.editReply({
        content: `👁️ Preview for **${res.window.label}** — nobody else can see this. Run without \`preview\` to post it.`,
        embeds: res.embeds,
      });
    }

    const guildId = process.env.DISCORD_GUILD_ID;
    const link = (guildId && res.threadId && res.messageId)
      ? ` — [jump](<https://discord.com/channels/${guildId}/${res.threadId}/${res.messageId}>)`
      : '';
    const verb = res.reason === 'edited' ? 'Refreshed' : 'Posted';
    return interaction.editReply(`📓 ${verb} the Raid Night Review for **${res.window.label}**${link}`);
  },
};
