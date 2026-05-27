// commands/chatstats.js — Report the size + shape of the historical chat store.
//
// Reads data/historical_chat.jsonl (append-only file populated by /api/agent/historical_chat)
// and produces a quick officer-facing breakdown:
//   total lines · file size · date range · per-era counts · top-10 days
//
// Cheap to run — streams the file line-by-line so it works on multi-GB stores.
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

const STORE_PATH = path.join(__dirname, '..', 'data', 'historical_chat.jsonl');

const ERA_BOUNDARIES = [
  { thresholdMs: Date.UTC(2026, 9, 1), name: 'PoP'     },
  { thresholdMs: Date.UTC(2025, 9, 1), name: 'Luclin'  },
  { thresholdMs: Date.UTC(2025, 3, 1), name: 'Velious' },
  { thresholdMs: Date.UTC(2024, 6, 1), name: 'Kunark'  },
  { thresholdMs: 0,                    name: 'Classic' },
];

function eraOf(ms) {
  for (const b of ERA_BOUNDARIES) if (ms >= b.thresholdMs) return b.name;
  return 'Classic';
}

async function readStats() {
  if (!fs.existsSync(STORE_PATH)) {
    return { exists: false };
  }
  const stat = fs.statSync(STORE_PATH);
  const byEra     = { Classic: 0, Kunark: 0, Velious: 0, Luclin: 0, PoP: 0 };
  const byChannel = { guild: 0, raid: 0 };
  const bySpeaker = new Map();
  const byDay     = new Map();   // 'YYYY-MM-DD' → count
  let total = 0, malformed = 0;
  let minTs = Infinity, maxTs = -Infinity;

  // Stream-read line by line so we don't load the whole file
  const stream = fs.createReadStream(STORE_PATH, { encoding: 'utf8', highWaterMark: 1 << 18 });
  let buf = '';
  for await (const chunk of stream) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let row;
      try { row = JSON.parse(line); } catch { malformed++; continue; }
      total++;
      const ms = row.ts ? Date.parse(row.ts) : NaN;
      if (Number.isFinite(ms)) {
        if (ms < minTs) minTs = ms;
        if (ms > maxTs) maxTs = ms;
        byEra[eraOf(ms)] = (byEra[eraOf(ms)] || 0) + 1;
        const d = new Date(ms);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        byDay.set(key, (byDay.get(key) || 0) + 1);
      }
      if (row.channel) byChannel[row.channel] = (byChannel[row.channel] || 0) + 1;
      if (row.speaker) bySpeaker.set(row.speaker, (bySpeaker.get(row.speaker) || 0) + 1);
    }
  }
  if (buf.trim()) {
    try { JSON.parse(buf); total++; } catch { malformed++; }
  }

  return {
    exists: true,
    sizeBytes: stat.size,
    total,
    malformed,
    minTs: Number.isFinite(minTs) ? minTs : null,
    maxTs: Number.isFinite(maxTs) ? maxTs : null,
    byEra,
    byChannel,
    topSpeakers: [...bySpeaker.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    topDays:     [...byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    daySpread:   byDay.size,
  };
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(2)}MB`;
  return `${(n / 1073741824).toFixed(2)}GB`;
}

function fmtNum(n) { return n.toLocaleString('en-US'); }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chatstats')
    .setDescription('Show size + breakdown of the historical chat store')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const s = await readStats();
    if (!s.exists) {
      return interaction.editReply('📭 No historical chat collected yet. Use the agent\'s `[O]` opt-in screen and select log files to backfill.');
    }

    const lines = [];
    lines.push(`📊 **Historical chat store** — \`${STORE_PATH.split('/').pop()}\``);
    lines.push(`**Total:** ${fmtNum(s.total)} lines · **Size:** ${fmtBytes(s.sizeBytes)} · **Unique days:** ${s.daySpread}`);
    if (s.malformed) lines.push(`⚠️ ${s.malformed} malformed lines (skipped)`);
    if (s.minTs && s.maxTs) {
      lines.push(`**Range:** ${new Date(s.minTs).toISOString().slice(0, 10)} → ${new Date(s.maxTs).toISOString().slice(0, 10)}`);
    }
    lines.push('');
    lines.push('**By era:**');
    for (const era of ['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP']) {
      lines.push(`  ${era.padEnd(8)} ${fmtNum(s.byEra[era] || 0)}`);
    }
    lines.push('');
    lines.push(`**By channel:** guild=${fmtNum(s.byChannel.guild || 0)} · raid=${fmtNum(s.byChannel.raid || 0)}`);
    if (s.topSpeakers.length > 0) {
      lines.push('');
      lines.push('**Top speakers:**');
      for (const [name, n] of s.topSpeakers.slice(0, 8)) lines.push(`  ${name.padEnd(16)} ${fmtNum(n)}`);
    }
    if (s.topDays.length > 0) {
      lines.push('');
      lines.push('**Busiest days:**');
      for (const [day, n] of s.topDays.slice(0, 5)) lines.push(`  ${day}  ${fmtNum(n)}`);
    }

    await interaction.editReply('```\n' + lines.join('\n').slice(0, 1900) + '\n```');
  },
};
