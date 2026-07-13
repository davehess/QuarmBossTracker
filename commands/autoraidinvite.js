// commands/autoraidinvite.js — Store and display the current auto-raid invite info.
// Officers/pack leaders: /autoraidinvite <character> [password]  — set ARI
// Everyone:              /autoraidinvite (no args) — view current ARI character
//                        only (ephemeral). The invite credential is officer-only
//                        and never echoed back to members; ping an officer in
//                        game if you need it.
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
    // Members see the character only. Officers also see the credential —
    // they need it to coordinate, and the role gate already controls who
    // can read it.
    if (!character && !password) {
      const ari = getAri();
      if (!ari) {
        return interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: '📭 No auto-raid invite is currently set. Officers can set one with `/autoraidinvite <character>`.',
        });
      }
      const isOfficer = hasOfficerRole(interaction.member);
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎟️ Auto-Raid Invite')
        .addFields(
          { name: 'Character', value: `\`${ari.character}\``, inline: true },
        )
        .setDescription(isOfficer
          ? `/who **${ari.character}** to find them in game.`
          : `Ping an officer in game for an invite — they'll get you in.`)
        .setFooter({ text: ari.auto ? '🎯 auto-detected from the in-game raid window' : `Set by ${ari.setByName || 'an officer'}` })
        .setTimestamp(ari.setAt || null);
      if (isOfficer && ari.password) {
        embed.addFields({ name: 'Credential', value: `\`${ari.password}\``, inline: true });
      }
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
