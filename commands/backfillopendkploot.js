// commands/backfillopendkploot.js — Officer: pull recent OpenDKP raid awards
// and record them in loot_observations as the canonical "we got this drop"
// signal. Chat-extracted observations are the live workhorse (every item
// linked in raid chat that matches the recent mob's drop table); this command
// fills in the OFFICIAL record from OpenDKP, with the winner attached.
//
// Attribution: OpenDKP records what item was awarded but not which NPC dropped
// it. We resolve the NPC by querying eqemu_npc_drops — if exactly ONE NPC in
// the catalog drops this item, that's the source (confident). If multiple NPCs
// drop it (a tradeable rare, etc.), we skip — ambiguous attribution would skew
// the per-mob counts on the Mob Info Loot tab.
//
// Idempotent: inserts are de-duped by (guild_id, npc_id, item_id, posted_at)
// at the application layer before insert, so a re-run only adds new awards.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole } = require('../utils/roles');
const { getRaids, getRaid } = require('../utils/opendkp');

const DEFAULT_DAYS = 30;
const PER_RAID_DELAY_MS = 80;          // ~12 fetches/sec — friendly to OpenDKP, fast enough to walk thousands
const DISCORD_DEFER_DEADLINE_MS = 14 * 60 * 1000;   // leave a minute of slack vs Discord's 15-min ceiling
const PROGRESS_EVERY = 25;             // edit the reply with running progress every N raids

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backfillopendkploot')
    .setDescription('Officer: backfill loot observations from recent OpenDKP raid awards (official drop record).')
    .addIntegerOption(opt =>
      opt.setName('days')
        .setDescription(`How many days back to walk (0 = ALL history, default ${DEFAULT_DAYS}, max 3650)`)
        .setMinValue(0).setMaxValue(3650)
    )
    .addBooleanOption(opt =>
      opt.setName('dry_run')
        .setDescription('Preview what would be inserted without writing to the DB.')
    ),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({ content: '⛔ Officer-only command.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const days   = interaction.options.getInteger('days') ?? DEFAULT_DAYS;
    const dryRun = !!interaction.options.getBoolean('dry_run');
    const supabase = require('../utils/supabase');
    if (!supabase.isEnabled()) {
      return interaction.editReply('Supabase is disabled — can\'t backfill.');
    }

    // 1. List OpenDKP raids in the window. getRaids() returns the index — no
    //    Items[] per raid here, just metadata. We page through and pick the
    //    raids inside our window before fetching the full record for each.
    let raids;
    try { raids = await getRaids(); }
    catch (err) {
      return interaction.editReply('OpenDKP raid list failed: ' + (err?.message || err));
    }
    if (!Array.isArray(raids) || raids.length === 0) {
      return interaction.editReply('OpenDKP returned no raids.');
    }
    // days=0 means "everything"; otherwise apply the cutoff. inWindow newest-
    // first so progress updates surface the recent stuff first (officers can
    // tell whether the walk is actually finding anything quickly).
    const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
    const inWindow = raids
      .filter(r => r && r.Timestamp && Date.parse(r.Timestamp) >= cutoff)
      .sort((a, b) => Date.parse(b.Timestamp) - Date.parse(a.Timestamp));
    if (inWindow.length === 0) {
      return interaction.editReply(days > 0
        ? `No OpenDKP raids in the last ${days} day(s).`
        : 'OpenDKP returned no raids at all.');
    }
    const windowLabel = days > 0 ? `last ${days} day(s)` : `ALL history (${inWindow.length} raid${inWindow.length===1?'':'s'})`;

    // 2. Walk each raid, pull Items[]. Per-raid getRaid is the only path that
    //    returns the awarded list; getRaids() is just the index. Throttle so
    //    we don't hammer OpenDKP; bail with partial results if we approach
    //    Discord's 15-min deferReply ceiling. Progress edits every 25 raids
    //    surface that the loop is alive on long histories.
    const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
    const startedAt = Date.now();
    const awarded = [];
    let raidsScanned = 0;
    let timedOut = false;
    const sleep = ms => new Promise(res => setTimeout(res, ms));
    for (const r of inWindow) {
      if (Date.now() - startedAt > DISCORD_DEFER_DEADLINE_MS) { timedOut = true; break; }
      try {
        const full = await getRaid(r.RaidId);
        raidsScanned++;
        const items = Array.isArray(full?.Items) ? full.Items : [];
        for (const it of items) {
          const itemId = Number(it?.ItemId ?? it?.GameItemId);
          if (!Number.isFinite(itemId) || itemId <= 0) continue;
          awarded.push({
            item_id:   itemId,
            item_name: it.ItemName || null,
            character: it.CharacterName || null,
            dkp:       Number(it.Dkp) || 0,
            raid_id:   r.RaidId,
            raid_ts:   r.Timestamp,
          });
        }
      } catch (err) {
        console.warn('[backfillopendkploot] getRaid', r.RaidId, 'failed:', err?.message);
      }
      if (raidsScanned % PROGRESS_EVERY === 0 && raidsScanned > 0) {
        try {
          await interaction.editReply(
            `⏳ Walking OpenDKP raids… ${raidsScanned} / ${inWindow.length} scanned, ${awarded.length} award(s) collected.`
          );
        } catch (e) { void e; }   // Discord edits are best-effort
      }
      if (PER_RAID_DELAY_MS > 0) await sleep(PER_RAID_DELAY_MS);
    }
    if (awarded.length === 0) {
      const tail = timedOut ? ' (hit the 14-min deferral deadline — run again to continue)' : '';
      return interaction.editReply(`Scanned ${raidsScanned} / ${inWindow.length} raid(s) — no awarded items found${tail}.`);
    }

    // 3. NPC attribution from eqemu_npc_drops. For each distinct item_id, pull
    //    the list of NPCs that drop it. Confident attribution iff exactly one
    //    NPC drops it; otherwise skip (ambiguous). We could later refine by
    //    cross-checking against THIS raid's kills, but the unique-drop case
    //    covers most raid loot.
    const distinctIds = [...new Set(awarded.map(a => a.item_id))];
    const dropOwnerByItem = new Map();   // item_id → { npc_id, npc_name } | null
    // PostgREST `in.()` filter — chunk to avoid URL-length blowups.
    for (let i = 0; i < distinctIds.length; i += 100) {
      const chunk = distinctIds.slice(i, i + 100);
      const inList = chunk.join(',');
      try {
        const rows = await supabase.select('eqemu_npc_drops',
          `item_id=in.(${inList})&select=item_id,npc_id,npc_name&limit=20000`);
        if (!Array.isArray(rows)) continue;
        const byItem = new Map();
        for (const row of rows) {
          if (!byItem.has(row.item_id)) byItem.set(row.item_id, new Set());
          byItem.get(row.item_id).add(row.npc_id + '::' + row.npc_name);
        }
        for (const [id, set] of byItem) {
          if (set.size === 1) {
            const [pair] = [...set];
            const [npcIdStr, npcName] = pair.split('::');
            dropOwnerByItem.set(id, { npc_id: parseInt(npcIdStr, 10), npc_name: npcName });
          } else {
            dropOwnerByItem.set(id, null);   // ambiguous
          }
        }
      } catch (err) {
        console.warn('[backfillopendkploot] drops lookup failed:', err?.message);
      }
    }

    // 4. Build insert rows. Confident attributions go in as source='opendkp'.
    //    Ambiguous + unknown items now persist too (with marker source values
    //    and npc_id=null) so we can SEE what's being skipped instead of losing
    //    it — spells + old gear that nobody bids on for years end up here, and
    //    we want a record we can query. They don't pollute the "× won" count
    //    on the Loot tab because that filter is source=opendkp only.
    const rows = [];
    let ambiguousSkipped = 0;
    let unknownSkipped   = 0;
    for (const a of awarded) {
      const owner = dropOwnerByItem.get(a.item_id);
      const baseRow = {
        guild_id:             guildId,
        item_id:               a.item_id,
        item_name:             a.item_name,
        posted_at:             a.raid_ts || new Date().toISOString(),
        posted_by_discord_id:  'opendkp:raid' + a.raid_id,
        raid_id:               a.raid_id,
        winner_character:      a.character || null,
        dkp_amount:            Number.isFinite(a.dkp) ? a.dkp : null,
      };
      if (owner) {
        rows.push({
          ...baseRow,
          npc_name_lower:  String(owner.npc_name).toLowerCase().replace(/_/g, ' ').trim(),
          npc_id:          owner.npc_id,
          source:          'opendkp',
        });
      } else if (dropOwnerByItem.has(a.item_id)) {
        // Multiple candidate NPCs in eqemu_npc_drops — persist for later
        // refinement (encounter-context attribution, expansion filtering, etc.).
        rows.push({ ...baseRow, npc_name_lower: '(ambiguous)', npc_id: null, source: 'opendkp_ambiguous' });
        ambiguousSkipped++;
      } else {
        // Item ID not in eqemu_npc_drops at all — spells (drop tables differ),
        // tradeskill items, quest rewards, anything our weekly EQEmu sync
        // missed. Persist so we can categorize and decide where to look next.
        rows.push({ ...baseRow, npc_name_lower: '(unknown)', npc_id: null, source: 'opendkp_unknown' });
        unknownSkipped++;
      }
    }

    if (rows.length === 0) {
      return interaction.editReply(
        `Scanned ${raidsScanned} raid(s), ${awarded.length} item award(s) found, but none mapped to a single NPC ` +
        `(ambiguous: ${ambiguousSkipped}, unknown: ${unknownSkipped}).`
      );
    }
    if (dryRun) {
      const preview = rows.slice(0, 10).map(r => `${r.item_name} → ${r.npc_name_lower}`).join('\n');
      return interaction.editReply(
        `**Dry run** · ${raidsScanned} raid(s) · ${rows.length} confident insert(s) ready ` +
        `(${ambiguousSkipped} ambiguous, ${unknownSkipped} unknown).\n\nFirst few:\n` +
        preview
      );
    }

    // 5. Idempotent insert. Dedup key = (source, raid_id, item_id, winner,
    //    dkp). raid_id + winner + dkp identify an OpenDKP award uniquely (the
    //    same item awarded twice in a raid has different winners or DKP, or
    //    we'd want both rows anyway). Old broken key was (source, npc_id,
    //    item_id, posted_at_string) which collapsed legit multi-drops AND
    //    failed across JS-vs-Postgres timestamp formats — we now compare
    //    posted_at via Date.parse() so format drift can't bite again.
    let alreadyPresent = 0;
    try {
      const minTs = rows.reduce((m, r) => {
        const t = Date.parse(r.posted_at) || 0;
        return (!m || t < m) ? t : m;
      }, null);
      if (minTs) {
        const minIso = new Date(minTs).toISOString();
        const existing = await supabase.select('loot_observations',
          `guild_id=eq.${encodeURIComponent(guildId)}&source=in.(opendkp,opendkp_ambiguous,opendkp_unknown)&posted_at=gte.${encodeURIComponent(minIso)}&select=raid_id,item_id,winner_character,dkp_amount,source&limit=40000`);
        if (Array.isArray(existing)) {
          const keyOf = r => `${r.source}|${r.raid_id ?? 'null'}|${r.item_id}|${r.winner_character ?? ''}|${r.dkp_amount ?? ''}`;
          const seen = new Set(existing.map(keyOf));
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i--) {
            if (seen.has(keyOf(rows[i]))) rows.splice(i, 1);
          }
          alreadyPresent = before - rows.length;
        }
      }
    } catch (err) {
      console.warn('[backfillopendkploot] dedup pre-check failed:', err?.message);
    }

    let inserted = 0;
    if (rows.length > 0) {
      const result = await supabase.insert('loot_observations', rows)
        .catch(err => { console.warn('[backfillopendkploot] insert failed:', err?.message); return null; });
      inserted = Array.isArray(result) ? result.length : rows.length;
    }

    const embed = new EmbedBuilder()
      .setTitle('🧾 OpenDKP loot backfill' + (timedOut ? ' (partial)' : ''))
      .setColor(timedOut ? 0xd29922 : 0x1f6feb)
      .addFields(
        { name: 'Raids scanned',         value: `${raidsScanned} / ${inWindow.length}`,           inline: true },
        { name: 'Awards found',          value: String(awarded.length),                          inline: true },
        { name: 'Inserted (this run)',   value: String(inserted),                                inline: true },
        { name: 'Already present',       value: String(alreadyPresent),                          inline: true },
        { name: 'Ambiguous · stored',    value: `${ambiguousSkipped} (source=opendkp_ambiguous)`, inline: true },
        { name: 'Unknown · stored',      value: `${unknownSkipped} (source=opendkp_unknown)`,    inline: true },
      )
      .setFooter({ text: `Window: ${windowLabel} · source='opendkp'` + (timedOut ? ' · re-run to continue from where this stopped' : '') });
    return interaction.editReply({ embeds: [embed] });
  },
};
