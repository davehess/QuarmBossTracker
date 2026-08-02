// commands/backfillscan.js — [#f3] outcome-driven backfill requests.
//
// Scan a raid night for fights where the parse is demonstrably wrong, and
// propose the two or three people whose log would settle it.
//
// PREVIEW BY DEFAULT. Nothing is filed unless an officer passes `apply:true` —
// see docs/DESIGN-outcome-backfill.md §"Why officer-triggered". There is no
// timer, no midnight-chain hook and no DM: filed requests surface in the
// target's own agent dashboard on their next poll, the same pull-based way
// officer-filed requests have always worked.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const backfillScan = require('../utils/backfillScan');
const raidReview = require('../utils/raidReview');
const { getDefaultTz, localToUTC } = require('../utils/timezone');

// Same date parsing as /raidreview — YYYY-MM-DD or M/D/YYYY in guild time.
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
  return localToUTC(y, m, d, 21, 0, getDefaultTz()).getTime();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backfillscan')
    .setDescription('Find fights with bad parse data and propose who to ask for logs (officers).')
    .addStringOption(opt =>
      opt.setName('date')
        .setDescription('Night to scan — YYYY-MM-DD or M/D/YYYY. Defaults to the most recent finished night.')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('apply')
        .setDescription('Actually file the proposed backfill requests. Default: preview only.')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('expire')
        .setDescription('Also retire open requests past the 45-day log horizon.')
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
    const apply   = interaction.options.getBoolean('apply') === true;
    const expire  = interaction.options.getBoolean('expire') === true;

    let atMs;
    if (dateArg) {
      atMs = parseDateArg(dateArg);
      if (!atMs) return interaction.editReply('❌ Could not read that date. Use `YYYY-MM-DD` or `M/D/YYYY`.');
    } else {
      const win = raidReview.mostRecentReviewableNight(Date.now(), { horizonHours: 0 });
      if (!win) return interaction.editReply('❌ Could not work out which night to scan — pass a `date`.');
      atMs = win.fromMs + 3_600_000;
    }

    // Same rollover-to-rollover night window the Raid Night Review uses, so a
    // scan and a review always cover exactly the same set of fights.
    const win = raidReview.nightWindowFor(atMs);
    const scan = await backfillScan.scanWindow({ fromMs: win.fromMs, toMs: win.toMs });

    if (scan.reason === 'supabase-disabled') {
      return interaction.editReply('❌ Supabase is not configured on this bot — nothing to scan.');
    }
    if (scan.reason === 'error') {
      return interaction.editReply(`❌ Scan failed: ${scan.error || 'unknown error'}`);
    }

    let applied = false;
    let expired = 0;
    if (apply && scan.proposals.length) {
      // Attribute the ask to the officer who ran it — the agent dashboard shows
      // `requested_by_name` verbatim next to the reason.
      const byName = interaction.member?.nickname
        || interaction.user?.globalName
        || interaction.user?.username
        || null;
      const rows = scan.proposals.map(r => ({
        ...r,
        requested_by_name: byName,
        requested_by_discord_id: interaction.user?.id || null,
      }));
      const res = await backfillScan.applyProposals(rows);
      applied = !!res.ok;
    }
    if (expire && scan.expirable.length) {
      const res = await backfillScan.expireStale(scan.expirable);
      expired = res.expired || 0;
    }

    const embeds = backfillScan.renderScanEmbeds({
      ...scan,
      applied,
      expired: expired > 0,
    });
    embeds[0].setTitle(`🔎 Backfill scan — ${win.label}`);
    return interaction.editReply({ embeds });
  },
};
