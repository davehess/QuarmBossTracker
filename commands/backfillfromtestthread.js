// commands/backfillfromtestthread.js — Backfill historic parse cards from the
// AUTOPARSE_TEST_THREAD_ID into Supabase by reverse-parsing the rendered
// Discord embeds. Officers only. Idempotent (find_or_create_encounter dedups
// by ±30 min window).

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const supabase = require('../utils/supabase');
const { findBossFromName } = require('./parse');

function getBosses() {
  const p = require.resolve('../data/bosses.json');
  delete require.cache[p];
  return require('../data/bosses.json');
}

// Parse a number like "157,870", "1.6K", "2.43M" into an integer.
function unfmt(s) {
  if (s == null) return 0;
  s = String(s).replace(/[, ]/g, '');
  const m = s.match(/^([\d.]+)([KM])?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (m[2] === 'M') return Math.round(n * 1_000_000);
  if (m[2] === 'K') return Math.round(n * 1_000);
  return Math.round(n);
}

// Reverse-parse a buildParseEmbed output.
// Returns { bossName, duration, totalDamage, totalDps, players } or null.
function parseCardEmbed(embed) {
  if (!embed?.title || !embed.title.startsWith('📊')) return null;

  // Title: "📊 [emoji] BossName  ·  HH:MM:SS AM/PM"
  // Strip leading "📊", any boss emoji glyph, trailing " · time"
  let title = embed.title.replace(/^📊\s*/, '');
  // Split off the trailing " · time" segment if present
  const dotIdx = title.lastIndexOf(' · ');
  if (dotIdx !== -1) title = title.slice(0, dotIdx);
  // Drop a leading emoji (any char that's not a letter/number/space/apostrophe/backtick)
  title = title.replace(/^[^\w'`]+\s*/, '').trim();
  const bossName = title;
  if (!bossName) return null;

  // Description: "Fight: 96s · 157,870 dmg · 1,644/s raid DPS  🎯 raid night"
  const desc = embed.description || '';
  const m = desc.match(/Fight:\s*\*?\*?(\d+)s\*?\*?\s*·\s*([\d.,KM]+)\s*dmg\s*·\s*([\d.,KM]+)\/s/i);
  if (!m) return null;
  const duration    = parseInt(m[1], 10);
  const totalDamage = unfmt(m[2]);
  const totalDps    = unfmt(m[3]);

  // DPS Rankings field — code block with " 1. Name  Damage  DPS/s  Times"
  const field = (embed.fields || []).find(f => /DPS Rankings/i.test(f.name));
  if (!field) return null;
  const players = [];
  const lines = field.value.split('\n');
  for (const line of lines) {
    const lm = line.match(/^\s*(\d+)\.\s+(.+?)\s+([\d.,KM]+)\s+([\d.,KM]+)\/s\s+(\d+)s\s*$/);
    if (!lm) continue;
    const rank   = parseInt(lm[1], 10);
    let   name   = lm[2].trim();
    const hasPets = / \+P$/.test(name);
    if (hasPets) name = name.replace(/ \+P$/, '').trim();
    players.push({
      name,
      damage:       unfmt(lm[3]),
      dps:          unfmt(lm[4]),
      duration:     parseInt(lm[5], 10),
      hasPets,
      rank,
    });
  }
  if (players.length === 0) return null;

  return { bossName, duration, totalDamage, totalDps, players };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backfillfromtestthread')
    .setDescription('Pull historical parse cards from the auto-parse test thread into Supabase (officers only)')
    .addIntegerOption(o => o.setName('messages')
      .setDescription('Max messages to scan (default 1000, max 5000)').setRequired(false))
    .addBooleanOption(o => o.setName('dryrun')
      .setDescription('Parse + match without writing').setRequired(false)),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Only officers can run backfill. Required roles: ${officerRolesList()}`,
      });
    }
    if (!supabase.isEnabled()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Supabase is not configured on this deploy.',
      });
    }
    const threadId = process.env.AUTOPARSE_TEST_THREAD_ID;
    if (!threadId) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ AUTOPARSE_TEST_THREAD_ID is not set.',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const maxMessages = Math.min(5000, interaction.options.getInteger('messages') ?? 1000);
    const dryRun      = interaction.options.getBoolean('dryrun') ?? false;

    const thread = await interaction.client.channels.fetch(threadId).catch(() => null);
    if (!thread) return interaction.editReply('❌ Could not fetch the test thread.');

    // Page through messages newest → oldest
    const allMsgs = [];
    let lastId   = null;
    let lastUpd  = Date.now();
    while (allMsgs.length < maxMessages) {
      const opts = { limit: 100 };
      if (lastId) opts.before = lastId;
      const batch = await thread.messages.fetch(opts).catch(() => null);
      if (!batch || batch.size === 0) break;
      allMsgs.push(...batch.values());
      lastId = batch.last().id;
      if (Date.now() - lastUpd > 6000) {
        lastUpd = Date.now();
        try { await interaction.editReply(`⏳ Fetched ${allMsgs.length} messages…`); } catch {}
      }
    }

    const bosses = getBosses();
    const parsed = [];
    let unparseable = 0;
    for (const m of allMsgs) {
      const e = m.embeds[0];
      if (!e) continue;
      const card = parseCardEmbed(e);
      if (!card) { if (e.title?.startsWith('📊')) unparseable++; continue; }
      const boss = findBossFromName(card.bossName, bosses);
      parsed.push({ msgId: m.id, ts: m.createdTimestamp, card, boss });
    }

    const matched   = parsed.filter(p => p.boss);
    const unmatched = parsed.filter(p => !p.boss);
    const unmatchedNames = [...new Set(unmatched.map(p => p.card.bossName))];

    if (dryRun) {
      const lines = [
        `🧪 Dry run — scanned ${allMsgs.length} messages, found ${parsed.length} parse cards.`,
        `• ${matched.length} matched to a known boss (would push).`,
        unmatched.length > 0
          ? `• ${unmatched.length} no boss match (${unmatchedNames.slice(0, 8).join(', ')}${unmatchedNames.length > 8 ? '…' : ''})`
          : null,
        unparseable > 0 ? `• ${unparseable} embeds had unexpected shape (skipped)` : null,
      ].filter(Boolean);
      return interaction.editReply(lines.join('\n'));
    }

    // Push to Supabase
    let pushed = 0, errors = 0, missingBoss = 0;
    const missingBossIds = new Set();
    lastUpd = Date.now();
    // Push oldest-first so progress is chronological
    matched.sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < matched.length; i++) {
      const { ts, card, boss } = matched[i];
      try {
        const result = await supabase.recordParse({
          bossInternalId:       boss.id,
          parsed: {
            bossName:    card.bossName,
            duration:    card.duration,
            totalDamage: card.totalDamage,
            totalDps:    card.totalDps,
            players:     card.players,
          },
          timestampMs:           ts,
          contributorDiscordId:  null,
          contributorCharacter:  null,
          source:                'test_thread_backfill',
        });
        if (result?.encounterId) pushed++;
        else { missingBoss++; missingBossIds.add(boss.id); }
      } catch (err) {
        errors++;
        console.warn(`[testbackfill] ${boss.id}@${ts} failed:`, err?.message);
      }
      if (Date.now() - lastUpd > 8000) {
        lastUpd = Date.now();
        try { await interaction.editReply(`⏳ Pushing… ${i + 1}/${matched.length} (${pushed} ok, ${missingBoss} skipped, ${errors} errors).`); } catch {}
      }
    }

    const lines = [
      `✅ Test-thread backfill complete.`,
      `• Scanned ${allMsgs.length} messages, parsed ${parsed.length} cards.`,
      `• Pushed ${pushed}/${matched.length} matched cards to Supabase.`,
      unmatched.length > 0
        ? `• ${unmatched.length} unmatched boss names: ${unmatchedNames.slice(0, 6).join(', ')}${unmatchedNames.length > 6 ? '…' : ''}`
        : null,
      missingBoss > 0
        ? `• ${missingBoss} bosses not in bosses_local: ${[...missingBossIds].slice(0, 6).join(', ')}${missingBossIds.size > 6 ? '…' : ''}`
        : null,
      errors > 0 ? `• ${errors} errors (see logs)` : null,
      unparseable > 0 ? `• ${unparseable} embeds had unexpected shape (skipped)` : null,
    ].filter(Boolean);
    return interaction.editReply(lines.join('\n'));
  },
};
