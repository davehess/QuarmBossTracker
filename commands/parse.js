// commands/parse.js — Submit an EQLogParser DPS parse for a boss fight.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const PARSES_FILE = path.join(__dirname, '../data/parses.json');

function loadParses() {
  if (!fs.existsSync(PARSES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PARSES_FILE, 'utf8')); }
  catch { return {}; }
}

function saveParses(data) {
  const tmp = PARSES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, PARSES_FILE);
}

// Parses EQLogParser "Send to EQ" format:
// "High Priest of Ssraeshza in 42s, 53.12K Damage @1.26K, 1. Statlander +Pets = 4.59K@148 in 31s | ..."
function parseEQLog(str) {
  const headerMatch = str.match(/^(.+?)\s+in\s+(\d+)s,\s*([\d.]+)K\s+Damage\s+@([\d.]+)K/);
  if (!headerMatch) return null;

  const bossName    = headerMatch[1].trim();
  const duration    = parseInt(headerMatch[2]);
  const totalDamage = Math.round(parseFloat(headerMatch[3]) * 1000);
  const totalDps    = Math.round(parseFloat(headerMatch[4]) * 1000);

  const playerRx = /(\d+)\.\s+(.+?)\s+=\s+([\d.]+)K@(\d+)\s+in\s+(\d+)s/g;
  const players  = [];
  let m;
  while ((m = playerRx.exec(str)) !== null) {
    const raw    = m[2].trim();
    const hasPets = raw.includes('+Pets');
    const name   = raw.replace(/\s*\+Pets/g, '').trim();
    players.push({
      rank: parseInt(m[1]), name, hasPets,
      damage:   Math.round(parseFloat(m[3]) * 1000),
      dps:      parseInt(m[4]),
      duration: parseInt(m[5]),
    });
  }

  if (players.length === 0) return null;
  return { bossName, duration, totalDamage, totalDps, players };
}

function fmt(n) { return n.toLocaleString('en-US'); }

function buildParseEmbed(bossName, parsed, bossEmoji) {
  const rows = parsed.players.slice(0, 15).map((p) => {
    const rank  = String(p.rank).padStart(2);
    const name  = (p.name + (p.hasPets ? ' +P' : '')).padEnd(20);
    const dmg   = fmt(p.damage).padStart(7);
    const dps   = (p.dps + '/s').padStart(7);
    const dur   = (p.duration + 's').padStart(4);
    return `${rank}. ${name} ${dmg}  ${dps}  ${dur}`;
  });

  const hdr     = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Damage'.padStart(7)}  ${'DPS'.padStart(7)}  Time`;
  const divider = '─'.repeat(hdr.length);
  const table   = [hdr, divider, ...rows].join('\n');

  const title = ['📊', bossEmoji, bossName].filter(Boolean).join(' ');
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(title)
    .setDescription(`Fight: **${parsed.duration}s** · ${fmt(parsed.totalDamage)} dmg · ${fmt(parsed.totalDps)} DPS`)
    .addFields({ name: 'DPS Rankings', value: '```\n' + table + '\n```', inline: false })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parse')
    .setDescription('Submit an EQLogParser DPS parse for a boss fight.')
    .addStringOption(opt =>
      opt.setName('boss').setDescription('Boss that was killed').setRequired(true).setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('data')
        .setDescription('Paste the EQLogParser "Send to EQ" output')
        .setRequired(true)
        .setMaxLength(6000)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const matches = bosses
      .filter(b =>
        b.name.toLowerCase().includes(focused) ||
        (b.nicknames || []).some(n => n.toLowerCase().includes(focused))
      )
      .slice(0, 25)
      .map(b => ({ name: b.name, value: b.id }));
    await interaction.respond(matches);
  },

  async execute(interaction) {
    const bossId  = interaction.options.getString('boss');
    const rawData = interaction.options.getString('data');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const boss   = bosses.find(b => b.id === bossId);

    const parsed = parseEQLog(rawData);
    if (!parsed) {
      return interaction.editReply('❌ Could not parse that input. Paste the EQLogParser "Send to EQ" output directly (e.g. "Boss Name in 42s, 53.12K Damage @1.26K, 1. Player = 4.59K@148 in 31s | ...")');
    }

    // Persist this parse
    const parses = loadParses();
    if (!parses[bossId]) parses[bossId] = [];
    parses[bossId].push({
      timestamp:        Date.now(),
      submittedBy:      interaction.user.id,
      submittedByName:  interaction.member?.displayName || interaction.user.username,
      duration:         parsed.duration,
      totalDamage:      parsed.totalDamage,
      totalDps:         parsed.totalDps,
      players:          parsed.players,
    });
    saveParses(parses);

    const bossName = boss?.name || parsed.bossName;
    const embed    = buildParseEmbed(bossName, parsed, boss?.emoji);
    await interaction.editReply({ embeds: [embed] });
  },

  // Exported for use by future /parsestats command
  parseEQLog,
  loadParses,
};
