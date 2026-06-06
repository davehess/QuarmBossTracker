// commands/whoimport.js — Officer-only: paste a /who block from anywhere (PQ
// Discord #intel, a friend's screenshot retype, a recent screenshot OCR, …) and
// ingest it into our /who registry the same way the agent ingests live /who
// rows.
//
// Purpose: the registry is a PVP target-selection board. We can't get a bot
// into the PQ Discord, so this lets officers be the human ingestion conduit
// for any /who data they encounter externally. Same parser, same L50+ filter,
// same merge behavior as the agent path — pasting "L60 Enchanter Foo" into
// here de-anons a name our raiders had only ever seen as [ANONYMOUS] Foo, and
// auto-flags Zek-guild affiliations.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole } = require('../utils/roles');
const { mergeWhoData, getWhoEntry } = require('../utils/state');

// Same row regex the agent uses (post-timestamp parse). Tolerates the timestamp
// being present (real EQ paste) OR missing (someone re-typed just the rows).
// The timestamp pattern matches EQ's exact format ("[Sun Jun 01 12:34:56 2026]")
// so it doesn't accidentally strip the leading "[60 Class]" of an untimestamped
// row.
const TIMESTAMP_RX = /^\[\w{3}\s+\w{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\d{4}\]\s+/;
const WHO_ROW_RX = /^(?:AFK\s+|LFG\s+)?\[\s*(?:(\d+)\s+([^\]\(]+?)(?:\s*\([^)]+\))?|(ANONYMOUS)|(GM))\s*\]\s+(\w+)(?:\s+\(([^)]+)\))?(?:\s+<([^>]+)>)?/i;

function parseWhoBlock(raw) {
  const out = [];
  const seen = new Set();
  for (const rawLine of String(raw || '').split(/\r?\n/)) {
    // Strip any leading EQ-style timestamp ("[Sun Jun 01 ...] ") so the row
    // regex can anchor on the body. Many Discord pastes drop the timestamp.
    const line = rawLine.replace(TIMESTAMP_RX, '').trim();
    if (!line) continue;
    const m = line.match(WHO_ROW_RX);
    if (!m) continue;
    const name = m[5];
    const key = name.toLowerCase();
    if (seen.has(key)) continue;          // first occurrence wins per paste
    seen.add(key);
    out.push({
      name,
      level:     m[1] ? parseInt(m[1], 10) : null,
      class:     m[2] ? m[2].trim() : null,
      anonymous: !!m[3],
      gm:        !!m[4],
      race:      m[6] || null,
      guild:     m[7] || null,
    });
  }
  return out;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whoimport')
    .setDescription('Officer: paste a /who block from elsewhere (PQ Discord, screenshot retype, etc.) into our registry.')
    .addStringOption(opt =>
      opt.setName('data')
        .setDescription('Paste the /who output (newline-separated rows).')
        .setRequired(true)
        .setMaxLength(6000)
    )
    .addStringOption(opt =>
      opt.setName('source')
        .setDescription('Optional label for where the paste came from (e.g. "PQ #intel" or "Discord screenshot").')
        .setMaxLength(60)
    ),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({ content: '⛔ Officer-only command.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const raw   = interaction.options.getString('data') || '';
    const label = (interaction.options.getString('source') || '').trim();
    const rows  = parseWhoBlock(raw);
    if (rows.length === 0) {
      return interaction.editReply('🤷 No /who rows recognized. Paste should look like `[60 Enchanter] Foo (Wood Elf) <Guild>` per line.');
    }

    // Tag each row with our intake timestamp; mergeWhoData honors per-row
    // observedAt (preferred over now()) and is what powers the Zek auto-flag.
    const observedAt = new Date().toISOString();
    for (const r of rows) r.observedAt = observedAt;

    // Stats: parsed, kept (L50+ or anon), skipped (L<50), de-anon'd (we had
    // them as anon and the paste reveals a class), zek-flagged (auto from
    // guild). Anonymous rows are explicitly KEPT — could be a hidden L60 and
    // a future de-anon may fill in their real class.
    let kept = 0, skippedLow = 0, deAnon = 0, zekFlagged = 0, newly = 0;
    const keepRows = [];
    for (const r of rows) {
      if (r.level !== null && r.level !== undefined && r.level < 50) { skippedLow++; continue; }
      const prior = getWhoEntry(r.name);
      if (!prior) newly++;
      else if (prior.anonymous && !prior.class && (r.class || r.guild)) deAnon++;
      if (r.guild && /^(zek|rise of zek)$/i.test(r.guild)) zekFlagged++;
      keepRows.push(r);
      kept++;
    }
    if (keepRows.length === 0) {
      return interaction.editReply(`Parsed ${rows.length} row(s) but all were below L50 — nothing kept.`);
    }

    // Merge into state.whoData (drives /whois + the /who overlay's anon
    // de-anon lookup). mergeWhoData itself auto-flags Zek-guild names.
    mergeWhoData(keepRows);

    // Mirror to Supabase who_observations for durability + /whois SQL access.
    // Tagged with the officer's Discord handle + their optional source label so
    // we can later filter / nuke this source cleanly if it gets weird.
    const uploadedBy = `manual:${interaction.user.username}${label ? `(${label.replace(/[():]/g, '')})` : ''}`;
    let supaWritten = 0;
    try {
      const supabase = require('../utils/supabase');
      if (supabase.isEnabled()) {
        const supaRows = keepRows.map(r => ({
          guild_id:    process.env.SUPABASE_GUILD_ID || 'wolfpack',
          character:   r.name,
          level:       r.level,
          race:        r.race,
          class:       r.class,
          guild_name:  r.guild,
          anonymous:   !!r.anonymous,
          gm:          !!r.gm,
          observed_at: observedAt,
          uploaded_by: uploadedBy,
        }));
        const result = await supabase.upsert(
          'who_observations', supaRows,
          'guild_id,character,observed_minute,uploaded_by',
        ).catch(err => { console.warn('[whoimport] supabase upsert failed:', err?.message); return null; });
        if (Array.isArray(result)) supaWritten = result.length;
      }
    } catch (err) { console.warn('[whoimport] supabase mirror failed:', err?.message); }

    const embed = new EmbedBuilder()
      .setTitle('📥 /who import')
      .setColor(0x1f6feb)
      .addFields(
        { name: 'Parsed',      value: String(rows.length),    inline: true },
        { name: 'Kept (L50+)', value: String(kept),           inline: true },
        { name: 'Skipped <50', value: String(skippedLow),     inline: true },
        { name: 'New names',   value: String(newly),          inline: true },
        { name: 'De-anon’d',   value: String(deAnon),         inline: true },
        { name: 'Zek-flagged', value: String(zekFlagged),     inline: true },
      )
      .setFooter({ text: `${supaWritten} mirrored to who_observations · uploaded_by: ${uploadedBy}` });
    return interaction.editReply({ embeds: [embed] });
  },
};
