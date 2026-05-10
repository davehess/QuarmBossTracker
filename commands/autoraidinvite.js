// commands/autoraidinvite.js — Store and display the current auto-raid invite info.
// Officers/pack leaders: /autoraidinvite <character> [password]  — set ARI
//                        password defaults to ARI_DEFAULT_PASSWORD env var if omitted
// Everyone:              /autoraidinvite (no args) — view current ARI (ephemeral)
// To clear:              use /ariclear

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { getAri, setAri, clearAri } = require('../utils/state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoraidinvite')
    .setDescription('View or set the current auto-raid invite character and password')
    .addStringOption(opt =>
      opt.setName('character')
        .setDescription('Character name to /who for an invite')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('password')
        .setDescription('ARI password (defaults to server default if omitted)')
        .setRequired(false)),

  async execute(interaction) {
    const character = interaction.options.getString('character')?.trim() || null;
    const password  = interaction.options.getString('password')?.trim()  || null;

    // ── View mode (no args) ─────────────────────────────────────────────────
    if (!character && !password) {
      const ari = getAri();
      if (!ari) {
        return interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: '📭 No auto-raid invite is currently set. Officers can set one with `/autoraidinvite <character>`.',
        });
      }
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎟️ Auto-Raid Invite')
        .addFields(
          { name: 'Character', value: `\`${ari.character}\``, inline: true },
          { name: 'Password',  value: `\`${ari.password}\``,  inline: true },
        )
        .setDescription(`/who **${ari.character}** and send a tell with the password to get an auto-invite.`)
        .setFooter({ text: `Set by ${ari.setByName || 'an officer'}` })
        .setTimestamp(ari.setAt || null);
      return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
    }

    // ── Write mode (requires officer) ──────────────────────────────────────
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Only officers can set the ARI. Required roles: ${officerRolesList()}`,
      });
    }

    if (!character) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ `character` is required to set an ARI. Use `/ariclear` to clear it.',
      });
    }

    // Use provided password, then env var default, then error
    const resolvedPassword = password || process.env.ARI_DEFAULT_PASSWORD || null;
    if (!resolvedPassword) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ No password provided and `ARI_DEFAULT_PASSWORD` is not set. Provide a password or ask an admin to set the env var.',
      });
    }

    setAri({
      character,
      password:  resolvedPassword,
      setBy:     interaction.user.id,
      setByName: interaction.member.displayName || interaction.user.username,
      setAt:     Date.now(),
    });

    const usedDefault = !password && process.env.ARI_DEFAULT_PASSWORD;
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('🎟️ Auto-Raid Invite Updated')
      .addFields(
        { name: 'Character', value: `\`${character}\``, inline: true },
        { name: 'Password',  value: `\`${resolvedPassword}\`${usedDefault ? ' *(default)*' : ''}`, inline: true },
      )
      .setDescription(`Members can now use \`/autoraidinvite\` (or \`/ari\`) to see who to send a tell to for an auto-invite.`)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
