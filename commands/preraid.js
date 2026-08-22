// commands/preraid.js — the officer-chat pre-raid checklist.
//
// Hitya 2026-08-21: "let's build an admin-facing officer-chat pre-raid
// checklist, active mimics, class shortages below our average, lockouts, other
// pertinent details."
//
// Every section is something an officer can ACT on in the next hour. Anything
// true-but-unfixable-before-the-pull belongs on a web page instead.
//
// Supersedes the standalone lockout post — that briefing is section 4 here, so
// the automatic pre-raid post sends this and not both.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { buildPreRaidChecklist } = require('../utils/preRaidChecklist');
const { getOfficerChannelId, setOfficerChannelId } = require('../utils/officerChannel');

const MIMIC_ACTIVE_DAYS = 7;           // uploaded at all in the last week
const CLASS_AVG_NIGHTS  = 6;           // how far back "our average" looks

async function gather(client) {
  delete require.cache[require.resolve('../data/bosses.json')];
  const bosses = require('../data/bosses.json');
  const { findBossFromName } = require('./parse');
  const { loadTonightsTargets } = require('../utils/raidhelper');
  const supabase = require('../utils/supabase');
  const { getBossState } = require('../utils/state');
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const now = Date.now();

  const planned = await loadTonightsTargets(client, bosses, findBossFromName).catch(() => null);
  const targetIds = (planned && Array.isArray(planned.bossIds)) ? planned.bossIds : [];

  // ── signups (tonight's RaidHelper event) ──────────────────────────────────
  const evRows = await supabase.select('rh_events',
    `guild_id=eq.${encodeURIComponent(guildId)}&order=start_time.desc&limit=10&select=id,title,start_time,description`)
    .catch(() => null);
  const soon = (Array.isArray(evRows) ? evRows : [])
    .filter(e => e.start_time && Math.abs(new Date(e.start_time).getTime() - now) < 18 * 3600_000)
    .sort((a, b) => Math.abs(new Date(a.start_time) - now) - Math.abs(new Date(b.start_time) - now))[0] || null;

  let signupRows = [];
  if (soon) {
    signupRows = await supabase.selectAllPaged('rh_signups',
      `event_id=eq.${encodeURIComponent(soon.id)}&select=discord_id,user_name,status,class_name`,
      'signup_id').catch(() => null) || [];
  }
  const isGoing = s => !/absen|declin|bench|tentat/i.test(String(s || ''));
  const going = signupRows.filter(r => isGoing(r.status));
  const signups = {
    going:     going.length,
    tentative: signupRows.filter(r => /tentat/i.test(String(r.status || ''))).length,
    absent:    signupRows.filter(r => /absen|declin/i.test(String(r.status || ''))).length,
    bench:     signupRows.filter(r => /bench/i.test(String(r.status || ''))).length,
  };

  const tonightByClass = new Map();
  for (const r of going) {
    const c = (r.class_name || '').trim();
    if (!c) continue;
    tonightByClass.set(c, (tonightByClass.get(c) || 0) + 1);
  }

  // ── our own average, from raid_roster (what actually showed up) ───────────
  const since = new Date(now - CLASS_AVG_NIGHTS * 8 * 24 * 3600_000).toISOString();
  const rosterRows = await supabase.selectAllPaged('raid_roster',
    `guild_id=eq.${encodeURIComponent(guildId)}&captured_at=gte.${encodeURIComponent(since)}` +
    `&select=name,class,captured_at`, 'name').catch(() => null) || [];
  // Bucket by raid NIGHT (ET date), then average the per-night class counts.
  const perNight = new Map();
  for (const r of rosterRows) {
    if (!r.class || !r.captured_at) continue;
    const night = new Date(r.captured_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (!perNight.has(night)) perNight.set(night, new Map());
    const m = perNight.get(night);
    const key = `${r.class}|${String(r.name).toLowerCase()}`;
    m.set(key, 1);
  }
  const nightCount = perNight.size || 0;
  const avgByClass = new Map();
  if (nightCount > 0) {
    const totals = new Map();
    for (const m of perNight.values()) {
      const seen = new Map();
      for (const k of m.keys()) {
        const cls = k.split('|')[0];
        seen.set(cls, (seen.get(cls) || 0) + 1);
      }
      for (const [cls, n] of seen) totals.set(cls, (totals.get(cls) || 0) + n);
    }
    for (const [cls, n] of totals) avgByClass.set(cls, n / nightCount);
  }
  const typicalHeadcount = nightCount > 0
    ? [...perNight.values()].reduce((s, m) => s + m.size, 0) / nightCount : 0;

  // ── Mimic coverage, counted in PLAYERS (CLAUDE.md adoption rule) ──────────
  const upSince = new Date(now - MIMIC_ACTIVE_DAYS * 24 * 3600_000).toISOString();
  const upRows = await supabase.selectAllPaged('agent_upload_stats',
    `guild_id=eq.${encodeURIComponent(guildId)}&last_uploaded_at=gte.${encodeURIComponent(upSince)}` +
    `&select=uploaded_by_discord_id`, 'uploaded_by_discord_id').catch(() => null) || [];
  const activeIds = new Set(upRows.map(r => r.uploaded_by_discord_id).filter(Boolean));
  const seenPlayer = new Set();
  const signedUpPlayers = [];
  for (const r of going) {
    const id = r.discord_id || null;
    const key = id || `name:${r.user_name}`;
    if (seenPlayer.has(key)) continue;
    seenPlayer.add(key);
    signedUpPlayers.push({
      discordId: id,
      name: r.user_name || id || '?',
      // No discord id = we can't tell; don't accuse them of not running Mimic.
      mimicActive: id ? activeIds.has(id) : true,
    });
  }

  // ── targets: are they actually up? ───────────────────────────────────────
  const targets = targetIds.map(id => {
    const b = bosses.find(x => x.id === id);
    const st = getBossState(id);
    const upNow = !st || !Number.isFinite(st.nextSpawn) || st.nextSpawn <= now;
    return { bossId: id, name: (b && b.name) || id, zone: (b && b.zone) || 'Unknown zone',
             upNow, spawnsAtMs: st && st.nextSpawn };
  });

  // ── lockouts ─────────────────────────────────────────────────────────────
  const lockRows = await supabase.selectAllPaged('character_lockouts',
    `guild_id=eq.${encodeURIComponent(guildId)}&expires_at=gt.${encodeURIComponent(new Date(now).toISOString())}` +
    `&select=character,boss_key,expires_at,ours`, 'character').catch(() => null) || [];
  const charRows = await supabase.selectAllPaged('characters',
    `guild_id=eq.${encodeURIComponent(guildId)}&select=name,main_name`, 'name').catch(() => null) || [];
  const kindByName = new Map();
  for (const c of charRows) {
    if (!c || !c.name) continue;
    kindByName.set(String(c.name).toLowerCase(),
      (!c.main_name || String(c.main_name).toLowerCase() === String(c.name).toLowerCase()) ? 'main' : 'alt');
  }

  return {
    planned, nightCount, event: soon, signupRows,
    tonightByClass,
    checklist: buildPreRaidChecklist({
      signups, tonightByClass, avgByClass, typicalHeadcount, signedUpPlayers, targets,
      lockoutInput: {
        targetBossIds: targetIds, bosses, lockouts: lockRows,
        kindOf: n => kindByName.get(String(n || '').toLowerCase()) || 'unknown',
        // `targets` above already resolved up/down off the board — reuse it so
        // the checklist can't disagree with its own Targets section.
        isTargetUp: id => {
          const t = targets.find(x => x.bossId === id);
          return t ? t.upNow : undefined;
        },
      },
      nowMs: now,
    }),
  };
}

function renderEmbed({ planned, nightCount, checklist: c }) {
  const e = new EmbedBuilder()
    .setColor(c.ok ? 0x1a7f37 : 0xf0883e)
    .setTitle('📋 Pre-raid checklist')
    .setTimestamp();

  e.setDescription([
    planned?.eventTitle ? `**${planned.eventTitle}**` : null,
    c.ok ? '✅ Nothing needs attention.' : `⚠️ ${c.flags.join(' · ')}`,
  ].filter(Boolean).join('\n'));

  e.addFields({
    name: '👥 Signups',
    value: `**${c.signups.going}** going · ${c.signups.tentative} tentative · ${c.signups.absent} out` +
           (c.signups.bench ? ` · ${c.signups.bench} bench` : ''),
    inline: false,
  });

  e.addFields({
    name: '⚖️ Class coverage vs our average',
    value: c.shortages.length === 0
      ? (nightCount ? `No class is below our ${nightCount}-night average.` : 'No history to compare against yet.')
      : c.shortages.map(s => `**${s.cls}** — ${s.have} tonight vs ~${s.avg} typical (**−${s.gap}**)`).join('\n').slice(0, 1024),
    inline: false,
  });

  e.addFields({
    name: '🖥 Mimic coverage',
    value: c.mimic.players === 0
      ? 'No signups to check.'
      : `**${c.mimic.active}/${c.mimic.players}** signed-up players have uploaded in the last ${MIMIC_ACTIVE_DAYS} days.` +
        (c.mimic.missing.length
          ? `\nNot seen: ${c.mimic.missing.slice(0, 25).join(', ')}${c.mimic.missing.length > 25 ? ` +${c.mimic.missing.length - 25}` : ''}`
          : ''),
    inline: false,
  });

  const lk = c.lockouts;
  e.addFields({
    name: '🔒 Lockouts on tonight\'s targets',
    value: ((lk.actionable === 0
      ? 'Nobody on our roster is blocked from a target that\'s up.'
      : (`**${lk.actionable}** blocked${lk.mains ? ` (${lk.mains} main${lk.mains === 1 ? '' : 's'})` : ''} — ` +
         'a lockout stops them **fighting** it, and teleports them out on engage.\n' +
         lk.zones.map(z => `**${z.zone}** — ` +
           z.bosses.map(b => `${b.bossName}: ${b.chars.map(ch => ch.kind === 'main' ? `**${ch.name}**` : ch.name).join(', ')}`).join(' · ')
         ).join('\n')))
      // Lockouts we derived from parses of raids our people joined carry the
      // other guild's roster too. Counted, never listed.
      + (lk.onDownTargets ? `\n_(+${lk.onDownTargets} locked to targets still on cooldown — expected after our own kill)_` : '')
      + (lk.outsiders ? `\n_(+${lk.outsiders} on characters outside our roster)_` : '')
      ).slice(0, 1024),
    inline: false,
  });

  const ts = c.targetStatus;
  e.addFields({
    name: '⏳ Targets',
    value: (ts.up.length ? `Up: ${ts.up.join(', ')}\n` : '') +
           (ts.down.length
             ? `Not up: ${ts.down.map(d => `${d.name}${d.minsAway != null ? ` (${d.minsAway}m)` : ''}`).join(', ')}`
             : (ts.up.length ? '' : 'No targets found on the planner event.')),
    inline: false,
  });

  if (planned?.eventUrl) e.addFields({ name: 'Planner', value: planned.eventUrl, inline: false });
  return e;
}

async function postPreRaidChecklist(client) {
  const supabase = require('../utils/supabase');
  const chId = await getOfficerChannelId(supabase);
  if (!chId) {
    return { ok: false, reason: 'no officer channel configured — run `/preraid here:true` in the officer channel once' };
  }
  const data = await gather(client);
  const ch = await client.channels.fetch(chId).catch(() => null);
  if (!ch) return { ok: false, reason: 'officer channel not reachable' };
  await ch.send({ embeds: [renderEmbed(data)] });
  return { ok: true };
}

// ── Midday member-facing post ─────────────────────────────────────────────
// Hitya 2026-08-21: "post the raid info midday to our channel." Re-surfaces the
// header block the officers already typed into the signup post (muster point,
// lead, window, loot, ticks) plus who's signed and which classes are still
// wanted. Deliberately NOT the officer checklist: no Mimic coverage, no
// lockout names.
function renderRaidInfoEmbed({ planned, event, checklist, tonightByClass }) {
  const { parseRaidHeader, wantedClasses } = require('../utils/raidInfoPost');
  const hdr = parseRaidHeader(event?.description || '');
  const e = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(event?.title ? `🗡️ ${event.title}` : '🗡️ Tonight\'s raid')
    .setTimestamp();

  const when = event?.start_time ? new Date(event.start_time).getTime() : null;
  const lines = [];
  if (when) lines.push(`**Starts** <t:${Math.floor(when / 1000)}:t> (<t:${Math.floor(when / 1000)}:R>)`);
  for (const f of hdr.fields) lines.push(`**${f.label}** — ${f.value}`);
  if (lines.length) e.setDescription(lines.join('\n').slice(0, 4000));

  const classLine = [...tonightByClass.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c, n]) => `${c} ${n}`).join(' · ');
  e.addFields({
    name: `👥 Signed up — ${checklist.signups.going}`,
    value: (classLine || 'nobody yet') +
           (checklist.signups.tentative ? `\n_${checklist.signups.tentative} tentative_` : ''),
    inline: false,
  });

  const want = wantedClasses(checklist.shortages);
  if (want.length) {
    e.addFields({
      name: '🙋 Still want',
      value: want.join(' · ') + '\n_(vs a typical night — alts welcome if the rules allow)_',
      inline: false,
    });
  }
  for (const n of hdr.notes.slice(0, 2)) {
    e.addFields({ name: '📌 Note', value: n.slice(0, 1024), inline: false });
  }
  if (planned?.eventUrl) e.addFields({ name: 'Sign up', value: planned.eventUrl, inline: false });
  return e;
}

async function postMiddayRaidInfo(client) {
  const chId = process.env.RAID_CHAT_CHANNEL_ID || process.env.TIMER_CHANNEL_ID;
  if (!chId) return { ok: false, reason: 'no raid channel configured' };
  const data = await gather(client);
  if (!data.event && !data.planned) return { ok: false, reason: 'no raid event found for today' };
  const ch = await client.channels.fetch(chId).catch(() => null);
  if (!ch) return { ok: false, reason: 'raid channel not reachable' };
  await ch.send({ embeds: [renderRaidInfoEmbed(data)] });
  return { ok: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('preraid')
    .setDescription('Post the pre-raid checklist (signups, classes, Mimic, lockouts, targets) to officer chat.')
    .addBooleanOption(opt => opt.setName('here')
      .setDescription('Post in THIS channel and remember it for the automatic pre-raid posts')
      .setRequired(false)),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral,
        content: `❌ Officers only. Roles: ${officerRolesList()}` });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // `here:true` is how the officer channel gets wired WITHOUT an env var and
    // a redeploy — the id lands in bot_kv, which survives deploys.
    if (interaction.options.getBoolean('here')) {
      const supabase = require('../utils/supabase');
      const saved = await setOfficerChannelId(supabase, interaction.channelId, interaction.user?.id);
      if (!saved.ok) return interaction.editReply(`❌ Could not remember this channel: ${saved.error}`);
      const data = await gather(interaction.client).catch(err => ({ error: err?.message }));
      if (data.error) return interaction.editReply(`✅ Officer channel set to <#${interaction.channelId}>, but the checklist failed: ${data.error}`);
      await interaction.channel.send({ embeds: [renderEmbed(data)] });
      return interaction.editReply(`✅ Posted here, and the automatic pre-raid checklist will use <#${interaction.channelId}> from now on.`);
    }

    const res = await postPreRaidChecklist(interaction.client).catch(err => ({ ok: false, reason: err?.message }));
    return interaction.editReply(res.ok ? '✅ Posted the pre-raid checklist to officer chat.' : `❌ ${res.reason || 'failed'}`);
  },

  gather, renderEmbed, postPreRaidChecklist,
  renderRaidInfoEmbed, postMiddayRaidInfo,
};
