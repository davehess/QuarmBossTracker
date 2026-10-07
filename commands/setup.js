// commands/setup.js — /setup discord status | provision | export
//
// The in-Discord face of utils/discordProvisioner.js (guild kit slice 3). Three
// things a new guild's owner needs and today does by hand:
//   status     read-only: where every id came from (env, file, adopted, created),
//              which are dead, what the bot may not do, what is still missing,
//              the steps only a human can take, and whether the roles exist
//   provision  find or create the layout. DRY RUN BY DEFAULT: it says what it
//              would do and changes nothing until dry_run is false
//   export     two ephemeral files: guild/discord.json and an env block, so the
//              ids survive a rebuilt deployment
//
// Gate: Discord hides the command from anyone without Manage Server
// (setDefaultMemberPermissions), and at run time it also admits the officer
// role — a brand-new guild has no officer role yet, so Manage Server must be
// enough on its own. Every reply is ephemeral.
//
// A virgin guild cannot reach this command on its own first boot:
// registerCommands returns without DISCORD_GUILD_ID / DISCORD_CLIENT_ID. The
// first-boot path there is auto mode (GUILD_PROVISION unset, which also derives
// both ids) or scripts/provision-discord.js; the command is for every boot after.

const {
  SlashCommandBuilder, MessageFlags, PermissionFlagsBits, AttachmentBuilder,
} = require('discord.js');
const prov = require('../utils/discordProvisioner');
const { hasOfficerRole } = require('../utils/roles');

const EPHEMERAL = MessageFlags.Ephemeral;
const REFUSED = '❌ This is for server managers (Manage Server) and officers.';

function allowed(interaction) {
  try {
    if (interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return true;
  } catch { /* fall through to the role check */ }
  try {
    return !!(interaction.member && interaction.member.roles && hasOfficerRole(interaction.member));
  } catch { return false; }
}

const list = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

function baseOpts(interaction) {
  return { client: interaction.client, env: process.env, supabase: require('../utils/supabase'), log: () => {} };
}

// A reply that does not fit in 2,000 characters goes out as a file instead of
// being silently cut off.
// `tail` is the one line that must not be missed (dry run or applied); it stays
// in the message when the body moves to the file.
async function sendText(interaction, text, tail = '') {
  if ((text + tail).length <= 1900) return interaction.editReply({ content: text + tail });
  const file = new AttachmentBuilder(Buffer.from(text + tail, 'utf8'), { name: 'setup-report.txt' });
  return interaction.editReply({ content: `The report is long, so it is attached.${tail}`, files: [file] });
}

async function runStatus(interaction) {
  const st = await prov.inspectLayout(baseOpts(interaction));
  return sendText(interaction, prov.formatStatus(st));
}

async function runProvision(interaction) {
  const dry = interaction.options.getBoolean('dry_run');
  const dryRun = dry == null ? true : !!dry;
  const only = list(interaction.options.getString('only'));
  const groups = list(interaction.options.getString('optional')).map(s => s.toLowerCase());
  const report = await prov.provisionLayout({
    ...baseOpts(interaction),
    mode: 'create', dryRun,
    only: only.length ? new Set(only) : undefined,
    optional: groups.length ? new Set(groups) : undefined,
    createChannels: !!interaction.options.getBoolean('create_channels'),
    repair: !!interaction.options.getBoolean('repair'),
  });
  const tail = dryRun
    ? '\nThis was a dry run: nothing was changed. Run it again with dry_run:false to apply.'
    : '\nApplied. Run /setup discord export to keep a copy of the ids.';
  return sendText(interaction, prov.formatReport(report), tail);
}

async function runExport(interaction) {
  const { expanded, values } = await prov.collectExportValues(baseOpts(interaction));
  const out = prov.buildExport(expanded, values);
  const files = [
    new AttachmentBuilder(Buffer.from(out.jsonText, 'utf8'), { name: 'discord.json' }),
    new AttachmentBuilder(Buffer.from(out.envText, 'utf8'), { name: 'discord.env' }),
  ];
  return interaction.editReply({
    content: 'Two files. Commit `discord.json` as `guild/discord.json` (ids are not secrets), or paste the `discord.env` lines into your host. Nothing secret is in either.',
    files,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set up the guild Discord layout (server managers and officers)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup(g => g
      .setName('discord')
      .setDescription('Channels, threads and cards. New guild? First boot is auto mode or the CLI')
      .addSubcommand(s => s.setName('status').setDescription('Show what is wired, what is dead, what is missing (read-only)'))
      .addSubcommand(s => s.setName('provision').setDescription('Find or create the layout (dry run unless dry_run is false)')
        .addBooleanOption(o => o.setName('dry_run').setDescription('Only say what would happen (default: yes)'))
        .addStringOption(o => o.setName('only').setDescription('Only these env keys, comma-separated (e.g. HISTORIC_KILLS_THREAD_ID)'))
        .addBooleanOption(o => o.setName('create_channels').setDescription('Allow creating channels, not just threads and cards'))
        .addStringOption(o => o.setName('optional').setDescription('Optional groups: pvp, voice, loot, rules, announce, hate, live, deathroll, mimic'))
        .addBooleanOption(o => o.setName('repair').setDescription('Replace a dead env or file id with a found or created one')))
      .addSubcommand(s => s.setName('export').setDescription('Get guild/discord.json and an env block (two private files)'))),

  async execute(interaction) {
    if (!allowed(interaction)) return interaction.reply({ flags: EPHEMERAL, content: REFUSED });
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    if (group !== 'discord' || !['status', 'provision', 'export'].includes(sub)) {
      return interaction.reply({ flags: EPHEMERAL, content: '❌ Use /setup discord status, provision or export.' });
    }
    await interaction.deferReply({ flags: EPHEMERAL });
    try {
      if (sub === 'status') return await runStatus(interaction);
      if (sub === 'provision') return await runProvision(interaction);
      return await runExport(interaction);
    } catch (err) {
      return interaction.editReply({ content: `❌ ${sub} failed: ${err && err.message ? err.message : err}` });
    }
  },

  // exposed for tests
  _allowed: allowed,
};
