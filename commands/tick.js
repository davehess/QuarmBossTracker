// commands/tick.js — Submit a DKP raid tick to OpenDKP from a RaidTick*.txt file.
//
// /tick <slot> <file>
//   slot  1–4   → regular tick in tonight's raid (max 4 per night)
//         bonus → separate raid entry (first-time kill bonus)
//         ot    → separate raid entry (overtime)
//
// Business rules:
//   • 1-hour overwrite window: re-submitting the same slot within 1 hour replaces it.
//   • Slots must be submitted in order (can't do slot 3 before slot 2).
//   • Bonus/overtime create separate OpenDKP raid entries — no slot limit.
//   • Bot finds tonight's raid in OpenDKP by date (skips bonus/OT entries).
//     If none exists, creates one on first tick.

const https   = require('https');
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList }  = require('../utils/roles');
const { getRaidNight, saveRaidNight }        = require('../utils/state');
const { getRaids, getRaid, createRaid, updateRaid } = require('../utils/opendkp');
const { getDefaultTz }                       = require('../utils/timezone');

const MAX_REGULAR_TICKS = 4;
const OVERWRITE_MS      = 60 * 60 * 1000; // 1 hour

// Raid names containing these words are bonus/OT entries — excluded from "find tonight's raid"
const SKIP_KEYWORDS = ['bonus', 'overtime', 'over time', 'first time kill', 'first kill', 'ftk'];
function isSpecialRaid(name) { return SKIP_KEYWORDS.some(k => name.toLowerCase().includes(k)); }

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'QuarmRaidBot/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Parse the tab-separated RaidTick file.
// Returns { players: string[], isoTimestamp: string, points: number }
function parseTickFile(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const players = [];
  let rawTs  = null;
  let points = 1;

  for (const line of lines.slice(1)) {       // skip header
    const cols = line.split('\t');
    if (cols.length < 5) continue;
    const [name, , , ts, pts] = cols;
    if (!rawTs && ts) rawTs = ts;             // "2026-04-23_21-19-53"
    const p = parseInt(pts, 10);
    if (!isNaN(p)) points = p;
    if (name.trim()) players.push(name.trim());
  }

  if (!players.length) return null;

  // "2026-04-23_21-19-53" → "2026-04-23T21:19:53"
  const isoTimestamp = rawTs
    ? rawTs.replace(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3:$4')
    : new Date().toISOString().slice(0, 19);

  return { players, isoTimestamp, points };
}

function todayStr(tz) {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz }); // "2026-05-02"
}

function raidDateStr(timestamp, tz) {
  return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: tz });
}

// Build the ticks array for a PUT/POST payload.
// existingTicks: array from OpenDKP GET (have .TickId, .Description, .Value, .Attendees)
// slotNum: 1–4 | 'bonus' | 'ot'
// description: human label
// players: new attendee list
// overwriteTickId: if set, replace that tickId's attendees
function buildTicksPayload(existingTicks, slotNum, description, value, players, overwriteTickId) {
  // Carry all existing ticks forward with their original attendees
  const result = (existingTicks || []).map(t => ({
    TickId:      t.TickId,
    Description: t.Description,
    Value:       t.Value,
    Attendees:   t.Attendees || [],
  }));

  if (overwriteTickId !== null && overwriteTickId !== undefined) {
    // Replace the matching tick's attendees in place
    const idx = result.findIndex(t => t.TickId === overwriteTickId);
    if (idx !== -1) {
      result[idx] = { TickId: overwriteTickId, Description: description, Value: value, Attendees: players };
    } else {
      result.push({ TickId: null, Description: description, Value: value, Attendees: players });
    }
  } else {
    result.push({ TickId: null, Description: description, Value: value, Attendees: players });
  }

  return result;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tick')
    .setDescription('Submit a DKP raid tick to OpenDKP. (Officers only)')
    .addStringOption(opt =>
      opt.setName('slot')
        .setDescription('Tick slot')
        .setRequired(true)
        .addChoices(
          { name: 'Tick 1',   value: '1' },
          { name: 'Tick 2',   value: '2' },
          { name: 'Tick 3',   value: '3' },
          { name: 'Tick 4',   value: '4' },
          { name: 'Bonus',    value: 'bonus' },
          { name: 'Overtime', value: 'ot' },
        )
    )
    .addAttachmentOption(opt =>
      opt.setName('file')
        .setDescription('RaidTick*.txt exported from the TAKP client')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('description')
        .setDescription('Override tick label, e.g. "End Tick", "Boss Kill — Emp", "Overtime"')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('raid_name')
        .setDescription('Raid name (used only when creating a new raid tonight)')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const slot        = interaction.options.getString('slot');          // '1'–'4', 'bonus', 'ot'
    const attachment  = interaction.options.getAttachment('file');
    const customDesc  = interaction.options.getString('description');
    const customName  = interaction.options.getString('raid_name');
    const isSpecial   = slot === 'bonus' || slot === 'ot';
    const slotNum     = isSpecial ? slot : parseInt(slot, 10);

    const slotLabel = {
      '1': 'Tick 1', '2': 'Tick 2', '3': 'Tick 3', '4': 'Tick 4',
      bonus: 'Bonus Tick', ot: 'Overtime',
    };

    if (!attachment.name?.endsWith('.txt')) {
      return interaction.editReply('❌ Please attach a `RaidTick*.txt` file from the TAKP folder.');
    }

    // Download and parse
    let raw;
    try { raw = await fetchUrl(attachment.url); }
    catch (err) { return interaction.editReply(`❌ Could not download file: ${err?.message}`); }

    const parsed = parseTickFile(raw);
    if (!parsed) return interaction.editReply('❌ Could not parse player list from the file.');

    const { players, isoTimestamp, points } = parsed;
    const description  = customDesc || slotLabel[slot] || `Tick ${slot}`;
    const tz           = getDefaultTz();
    const today        = todayStr(tz);
    const poolId       = parseInt(process.env.OPENDKP_POOL_ID || '5', 10);
    const updatedBy    = interaction.member?.displayName || interaction.user.username;
    const now          = Date.now();

    try {
      // ── Bonus / Overtime — always a separate raid entry ──────────────────────
      if (isSpecial) {
        const name    = customName || `${today} — ${description}`;
        const payload = {
          Name:      name,
          Timestamp: isoTimestamp,
          UpdatedBy: updatedBy,
          Pool:      { IdPool: poolId },
          Ticks:     [{ TickId: null, Description: description, Value: points, Attendees: players }],
          Items:     [],
        };
        const result = await createRaid(payload);
        return interaction.editReply(
          `✅ **${description}** submitted as separate raid entry!\n` +
          `📋 **${name}** (RaidId: ${result.RaidId})\n` +
          `👥 ${players.length} attendees · ${points} DKP each`
        );
      }

      // ── Regular tick (slots 1–4) ─────────────────────────────────────────────
      let night = getRaidNight();
      if (night?.date !== today) night = null;  // new day — reset

      // Slot ordering: can't skip a slot
      if (night) {
        const highestPosted = Math.max(0, ...Object.keys(night.ticks).map(Number));
        if (slotNum > highestPosted + 1) {
          return interaction.editReply(
            `❌ Slot ${slotNum} is out of order — you haven't posted Tick ${highestPosted + 1} yet tonight.`
          );
        }
      } else if (slotNum > 1) {
        return interaction.editReply(`❌ No ticks posted yet tonight — start with Tick 1.`);
      }

      // Check 1-hour overwrite window if this slot was already posted
      let overwriteTickId = null;
      if (night?.ticks?.[slotNum]) {
        const prev = night.ticks[slotNum];
        if (now - prev.postedAt < OVERWRITE_MS) {
          overwriteTickId = prev.tickId;  // overwrite
        } else {
          return interaction.editReply(
            `❌ Tick ${slotNum} was posted more than 1 hour ago — it cannot be overwritten. ` +
            `Contact an officer to edit it directly on OpenDKP.`
          );
        }
      }

      // Check slot limit
      const currentSlots = night ? Object.keys(night.ticks).length : 0;
      if (!overwriteTickId && currentSlots >= MAX_REGULAR_TICKS) {
        return interaction.editReply(
          `❌ All ${MAX_REGULAR_TICKS} regular tick slots are full for tonight.\n` +
          `Use slot **ot** (Overtime) to post an additional tick as a separate raid.`
        );
      }

      // ── Find or create tonight's raid ────────────────────────────────────────
      let raidId   = night?.raidId   || null;
      let raidName = night?.name     || null;

      if (!raidId) {
        // Look for today's raid in OpenDKP
        try {
          const allRaids  = await getRaids();
          const todayRaid = allRaids
            .filter(r => raidDateStr(r.Timestamp, tz) === today && !isSpecialRaid(r.Name))
            .sort((a, b) => b.RaidId - a.RaidId)[0];
          if (todayRaid) { raidId = todayRaid.RaidId; raidName = todayRaid.Name; }
        } catch (err) {
          console.warn('[tick] Could not fetch raids list:', err?.message);
        }
      }

      // ── GET full raid data (for existing ticks + attendees) ──────────────────
      let existingTicks = [];
      if (raidId) {
        try {
          const full    = await getRaid(raidId);
          existingTicks = full.Ticks || [];
          if (!raidName) raidName = full.Name;
        } catch (err) {
          console.warn('[tick] Could not fetch raid detail:', err?.message);
        }
      }

      // ── Build tick payload ───────────────────────────────────────────────────
      const ticksPayload = buildTicksPayload(existingTicks, slotNum, description, points, players, overwriteTickId);

      let result;
      if (!raidId) {
        // Create new raid
        raidName = customName || `${today} Raid`;
        const payload = {
          Name:      raidName,
          Timestamp: isoTimestamp,
          UpdatedBy: updatedBy,
          Pool:      { IdPool: poolId },
          Ticks:     ticksPayload,
          Items:     [],
        };
        result = await createRaid(payload);
        raidId = result.RaidId;
      } else {
        // Update existing raid
        const payload = {
          RaidId:    raidId,
          Name:      raidName,
          Timestamp: isoTimestamp,
          UpdatedBy: updatedBy,
          Pool:      { IdPool: poolId },
          Ticks:     ticksPayload,
          Items:     [],
        };
        result = await updateRaid(payload);
      }

      // ── Resolve new tickId from result ───────────────────────────────────────
      const prevTickIds = new Set(Object.values(night?.ticks || {}).map(t => t.tickId).filter(Boolean));
      const newTickEntry = (result.Ticks || []).find(t => !prevTickIds.has(t.TickId));
      const resolvedTickId = overwriteTickId ?? newTickEntry?.TickId ?? null;

      // ── Persist state ────────────────────────────────────────────────────────
      const updatedNight = {
        date:   today,
        raidId,
        name:   raidName,
        poolId,
        ticks:  { ...(night?.ticks || {}) },
      };
      updatedNight.ticks[slotNum] = { tickId: resolvedTickId, description, postedAt: now, count: players.length };
      saveRaidNight(updatedNight);

      const verb       = overwriteTickId ? '🔄 Overwritten' : '✅ Submitted';
      const slotsUsed  = Object.keys(updatedNight.ticks).filter(k => !isNaN(Number(k))).length;
      const remaining  = MAX_REGULAR_TICKS - slotsUsed;

      return interaction.editReply(
        `${verb} **${description}**!\n` +
        `📋 Raid: **${raidName}** (ID: ${raidId})\n` +
        `👥 ${players.length} attendees · ${points} DKP each\n` +
        (remaining > 0
          ? `🎯 ${remaining} regular tick slot${remaining !== 1 ? 's' : ''} remaining tonight`
          : `🏁 All ${MAX_REGULAR_TICKS} regular ticks submitted`)
      );

    } catch (err) {
      console.error('[tick] Error:', err);
      return interaction.editReply(`❌ OpenDKP error: ${err?.message}`);
    }
  },
};
