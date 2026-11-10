// commands/opendkplevels.js — Officer-only: raise OpenDKP character levels to the
// level last seen in our /who directory. Preview first, apply on a button press.
// Levels only go up; lower /who levels are reported and never written.
const {
  SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const opendkp = require('../utils/opendkp');
const supabase = require('../utils/supabase');
const { planLevelUpdates, buildUpdateRecord, agoText } = require('../utils/opendkpLevels');

const WRITE_GAP_MS = 450;     // sequential writes, gently
const PREVIEW_LINES = 20;
const PICK_TIMEOUT_MS = 120_000;

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _line = (e) => `${e.name} ${e.from} → ${e.to} (seen ${agoText(e.seenAt)})`;

// Latest non-null /who level per lowercase name, via the same lookup Mob Info uses.
async function fetchSeenLevels(names) {
  const seen = new Map();
  const keys = [...new Set(names.map(n => String(n).toLowerCase().replace(/"/g, '')))];
  for (let i = 0; i < keys.length; i += 80) {
    const rows = await supabase.rpc('who_directory_lookup', { p_keys: keys.slice(i, i + 80) });
    if (!Array.isArray(rows)) throw new Error('who directory read failed');
    for (const r of rows) {
      if (r.level != null) seen.set(String(r.character_key).toLowerCase(), { level: r.level, seenAt: r.last_seen });
    }
  }
  return seen;
}

async function buildPlan() {
  const { _fetchAllCharacters } = require('../utils/openDkpSync');
  const { chars } = await _fetchAllCharacters();
  const seen = await fetchSeenLevels(chars.filter(c => c && c.Name).map(c => c.Name));
  const byId = new Map(chars.filter(c => Number.isFinite(c?.CharacterId)).map(c => [c.CharacterId, c]));
  return { plan: planLevelUpdates(chars, seen), byId };
}

function previewText(plan) {
  const out = [`**OpenDKP levels from /who** — ${plan.raise.length} to raise`
    + `, ${plan.lower.length} lower in /who (not changed), ${plan.same} already right`
    + `, ${plan.unseen} not seen, ${plan.skipped.stale} seen too long ago`
    + (plan.skipped.incomplete ? `, ${plan.skipped.incomplete} skipped (OpenDKP record incomplete, fix by hand)` : '') + '.'];
  if (plan.raise.length) {
    out.push('```', ...plan.raise.slice(0, PREVIEW_LINES).map(_line));
    if (plan.raise.length > PREVIEW_LINES) out.push(`…and ${plan.raise.length - PREVIEW_LINES} more`);
    out.push('```');
  }
  return out.join('\n');
}

async function applyPlan(plan, byId, officer) {
  const res = { applied: 0, failed: 0, skipped: 0, stopped: null };
  for (const e of plan.raise) {
    if (opendkp.opendkpHalted()) { res.stopped = 'OPENDKP_HALT is on'; break; }
    const row = byId.get(e.characterId);
    if (!row) { res.skipped++; continue; }
    try {
      await opendkp.updateCharacter(e.characterId, buildUpdateRecord(row, e.to));
      res.applied++;
      supabase.insert('audit_log', [{
        guild_id: supabase.guildId(),
        action: 'opendkp_level_update',
        actor_discord_id: officer.id,
        actor_name: officer.username || null,
        // No Undo button: the audit framework's revert is boss-state only. Old level is recorded here.
        payload: { characterId: e.characterId, name: e.name, from: e.from, to: e.to, seenAt: e.seenAt },
      }]).catch(() => null);
    } catch (err) {
      const msg = String(err?.message || err);
      res.failed++;
      if (err?.localRefusal && /halt/i.test(msg)) { res.stopped = 'OPENDKP_HALT is on'; break; }
      if (/HTTP 40[13]\b/.test(msg)) { res.stopped = `OpenDKP refused the sign-in (${msg.slice(0, 40)})`; break; }
    }
    await _sleep(WRITE_GAP_MS);
  }
  return res;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('opendkplevels')
    .setDescription('Preview and apply OpenDKP level updates from levels seen in /who (officers only)'),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Only officers can update OpenDKP levels. Required roles: ${officerRolesList()}`,
      });
    }
    if (opendkp.opendkpHalted()) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '⏸️ OpenDKP traffic is halted (OPENDKP_HALT). Nothing to do.' });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let planned;
    try { planned = await buildPlan(); }
    catch (err) { return interaction.editReply(`❌ Could not build the plan: ${err?.message || err}`); }
    if (!planned.plan.raise.length) return interaction.editReply(previewText(planned.plan) + '\nNothing to apply.');

    const id = interaction.id;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`odkplv_apply:${id}`).setLabel(`Apply ${planned.plan.raise.length} changes`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`odkplv_cancel:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    const msg = await interaction.editReply({ content: previewText(planned.plan), components: [row] });

    let pick;
    try {
      pick = await msg.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id && i.customId.endsWith(`:${id}`),
        time: PICK_TIMEOUT_MS,
      });
    } catch { return interaction.editReply({ content: 'Timed out, nothing changed.', components: [] }); }

    if (pick.customId.startsWith('odkplv_cancel:')) {
      return pick.update({ content: 'Cancelled, nothing changed.', components: [] });
    }
    await pick.update({ content: 'Re-reading the roster and applying…', components: [] });

    // Re-fetch so nothing stale is written.
    let fresh;
    try { fresh = await buildPlan(); }
    catch (err) { return interaction.editReply(`❌ Could not re-read the roster: ${err?.message || err}`); }
    const r = await applyPlan(fresh.plan, fresh.byId, interaction.user);
    return interaction.editReply([
      `✅ Applied **${r.applied}**, failed ${r.failed}, skipped ${r.skipped}.`,
      r.stopped ? `⛔ Stopped early: ${r.stopped}.` : '',
      `Lower in /who, left alone: ${fresh.plan.lower.length}. Each change is in the audit log with its old level.`,
    ].filter(Boolean).join('\n'));
  },
  _internals: { applyPlan, previewText },
};
