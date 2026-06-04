// commands/parsehelp.js — How to set up the Wolf Pack Mimic Parser.
//
// Mimic-only (the classic CLI agent is intentionally left out here — it muddied
// the message for new members). The reply is deliberately simple: the download
// link + a 3-step summary, plus a "Step-by-step guide" button that opens an
// ephemeral, paged walkthrough (Next/Back) with the detailed directions for
// anyone who wants them. Per-step screenshots slot into STEP_IMAGES when ready.
//
// Shared with /postparsehelp (officer command that posts the same simple
// message + buttons publicly so anyone can tap through their own walkthrough).
'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

const MIMIC_URL = 'https://wolfpack.quest/mimic';

// ── Simple top-level message ────────────────────────────────────────────────
function buildParseHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle('🐺 Set up the Wolf Pack Mimic Parser')
    .setDescription([
      'Mimic uploads your parses to the guild boards and gives you a DPS overlay, trigger TTS, charm tracker, and more. It bundles everything — **no separate Node install, no admin prompt.**',
      '',
      '**1.**  Download below and run it (SmartScreen → *More info → Run anyway*).',
      '**2.**  First run: **Sign in with Discord** — no token to paste.',
      '**3.**  Pick your **EverQuest folder**, then **`/log on`** in‑game.',
      '',
      'Want the detailed walkthrough? Tap **📖 Step‑by‑step guide** below.',
    ].join('\n'))
    .setFooter({ text: 'Wolf Pack EQ (Quarm) • auto-updates once installed' });
}

// Buttons under the top message: open the guide + a direct download link.
function buildParseHelpComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('parsehelp_guide').setLabel('📖 Step-by-step guide').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setURL(MIMIC_URL).setLabel('📥 Download Mimic Parser').setStyle(ButtonStyle.Link),
    ),
  ];
}

// ── Paged walkthrough ───────────────────────────────────────────────────────
// Each step is one ephemeral page. Detailed directions live here so the top
// message stays simple. STEP_IMAGES[i] (a hosted PNG URL) renders as the page
// image once we have the obfuscated screenshots.
const STEP_IMAGES = {};   // { 0: 'https://…/step1.png', … } — filled in later

const STEPS = [
  {
    title: 'Step 1 of 4 · Download & install',
    body: [
      'Tap **📥 Download Mimic Parser** (or go to wolfpack.quest/mimic) to grab the installer.',
      '',
      '• Windows SmartScreen will warn (not code-signed yet) → **More info → Run anyway**.',
      '• It installs **only for you** — no admin / UAC. Just click **Install** (or change the folder if you like).',
      '• Leave **Run Wolf Pack Mimic** ticked at the end and click **Finish**.',
    ].join('\n'),
  },
  {
    title: 'Step 2 of 4 · Sign in with Discord',
    body: [
      'On first launch you’ll see **Step 1 · Sign in with Discord** — click it.',
      '',
      '• Your browser opens Discord → click **Authorize**.',
      '• This links Mimic to **your** account and sets up your upload automatically — **no token to copy or paste**.',
      '• If a 6-character code is shown, paste it on the page it opens; if you’re already signed in to wolfpack.quest it fills in for you.',
    ].join('\n'),
  },
  {
    title: 'Step 3 of 4 · Your EverQuest folder',
    body: [
      '**Step 2 · Your EverQuest folder** — Mimic scans for it automatically.',
      '',
      '• Tick the detected folder, or click **📁 Browse for your EverQuest folder…** if it lives somewhere unusual.',
      '• Click **Save folder**.',
      '',
      '_(This is your **EverQuest** folder — not where Mimic itself installed.)_',
    ].join('\n'),
  },
  {
    title: 'Step 4 of 4 · Turn on logging & launch',
    body: [
      'Two last things and you’re done:',
      '',
      '• In EverQuest, type **`/log on`** (or set `Logging=on` in `eqclient.ini`) so Mimic can read your fights.',
      '• Click **Open dashboard**. You’re now uploading. ✅',
      '',
      'You also get: DPS HUD · trigger alerts (TTS) + timers · charm tracker · Buffs & Zone · private /tells · UI Studio (back up your EQ layout). Turn overlays on any time from the tray.',
    ].join('\n'),
  },
];

function buildStepReply(idx) {
  const i = Math.max(0, Math.min(idx, STEPS.length - 1));
  const step = STEPS[i];
  const embed = new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle('🐺 ' + step.title)
    .setDescription(step.body)
    .setFooter({ text: `Wolf Pack EQ (Quarm) • step ${i + 1} of ${STEPS.length}` });
  if (STEP_IMAGES[i]) embed.setImage(STEP_IMAGES[i]);

  const nav = new ActionRowBuilder();
  if (i > 0) nav.addComponents(new ButtonBuilder().setCustomId(`parsehelp_step:${i - 1}`).setLabel('◀ Back').setStyle(ButtonStyle.Secondary));
  if (i < STEPS.length - 1) nav.addComponents(new ButtonBuilder().setCustomId(`parsehelp_step:${i + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary));
  nav.addComponents(new ButtonBuilder().setURL(MIMIC_URL).setLabel('📥 Download').setStyle(ButtonStyle.Link));

  return { embeds: [embed], components: [nav] };
}

// ── Button handlers (wired from index.js) ───────────────────────────────────
// Opening the guide replies with a fresh ephemeral page so it works from both
// the ephemeral /parsehelp and the public /postparsehelp message. Navigation
// edits that ephemeral page in place.
async function handleParseHelpGuide(interaction) {
  return interaction.reply({ flags: MessageFlags.Ephemeral, ...buildStepReply(0) });
}
async function handleParseHelpStep(interaction) {
  const idx = parseInt(interaction.customId.split(':')[1], 10) || 0;
  return interaction.update(buildStepReply(idx));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsehelp')
    .setDescription('How to set up the Wolf Pack Mimic Parser (ephemeral)'),

  async execute(interaction) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildParseHelpEmbed()],
      components: buildParseHelpComponents(),
    });
  },

  buildParseHelpEmbed,
  buildParseHelpComponents,
  handleParseHelpGuide,
  handleParseHelpStep,
};
