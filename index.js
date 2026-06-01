// index.js — Quarm Raid Timer Bot

require('dotenv').config();

const {
  Client, GatewayIntentBits, Collection, Events, REST, Routes, MessageFlags,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

// Auto-derive the canonical agent version from the agent's own package.json
// so deploys don't need a manual LATEST_AGENT_VERSION env var bump. The env
// var still wins when set (canary rollouts / pinning an older version).
let _cachedAgentVersion = null;
function _currentAgentVersion() {
  if (process.env.LATEST_AGENT_VERSION) return process.env.LATEST_AGENT_VERSION;
  if (_cachedAgentVersion) return _cachedAgentVersion;
  try {
    _cachedAgentVersion = require('./packages/wolfpack-logsync/package.json').version || null;
  } catch { _cachedAgentVersion = null; }
  return _cachedAgentVersion;
}

// Update manifest for the self-updating supervisor (see experiments/mimic-agent
// + docs/MIMIC_AGENT.md). The agent is a single file shipped in the bot's own
// image, so we can publish a stable SHA-256 of exactly what `main` holds and a
// raw URL to fetch it. The supervisor verifies the hash before swapping, so a
// CDN hiccup or truncated download never replaces a working agent.
//
// AGENT_RAW_URL defaults to the raw file on the default branch; override via env
// if the repo/branch differs. Hash is computed once and cached (file is
// immutable within a deploy).
let _cachedAgentSha = undefined;
function _currentAgentSha256() {
  if (_cachedAgentSha !== undefined) return _cachedAgentSha;
  try {
    const crypto = require('crypto');
    const fs = require('fs');
    const buf = fs.readFileSync(require('path').join(__dirname, 'packages/wolfpack-logsync/index.js'));
    _cachedAgentSha = crypto.createHash('sha256').update(buf).digest('hex');
  } catch { _cachedAgentSha = null; }
  return _cachedAgentSha;
}
function _agentManifest() {
  return {
    latest_agent_version: _currentAgentVersion(),
    // Raw single-file URL. Override AGENT_RAW_URL if the default branch/repo moves.
    url: process.env.AGENT_RAW_URL ||
      'https://raw.githubusercontent.com/davehess/QuarmBossTracker/main/packages/wolfpack-logsync/index.js',
    sha256: _currentAgentSha256(),
  };
}

const {
  getAllState, recordKill, clearKill,
  getZoneCard, setZoneCard, clearZoneCard,
  getDailyKills, resetDailyKills,
  getAnnounceMessageIds, removeAnnounceMessageId, clearAnnounceMessageIds,
  getSpawnAlertMessageId, setSpawnAlertMessageId, clearSpawnAlertMessageId, getAllSpawnAlertMessageIds,
  getDailySummaryMessageId, setDailySummaryMessageId,
  getAnnounce, removeAnnounce, getAnnounceByThreadId,
  updateAnnounceTargets, updateAnnounceEasterEgg, getAllAnnounces,
  getAllPvpKills, clearPvpKill, getQuake, saveQuake, clearQuake,
  addPvpAlertHowler,
  hasSeenWelcome, markWelcomeSeen,
  getRaidSession, clearRaidSession, accumulateSessionDamage,
  clearRaidNight,
  getAgentTestCard, setAgentTestCard, clearAgentTestCards,
  getAgentSessionCardId, setAgentSessionCardId, clearAgentSessionCardId,
  getAgentSessionCardChannelId, setAgentSessionCardChannelId,
  getLastAnnouncedAgentVersion, setLastAnnouncedAgentVersion,
  recordAgentUpload, clearAgentActivity,
  getPetOwners, addPetOwners, clearPetOwners,
  mergeWhoData, applyKnownZekTips,
  clearAllPendingLoot,
  getAllLiveKills, clearLiveKill,
  setLiveKillTimerUnknown, setPvpKillTimerUnknown,
  getHateBoardMessageId, setHateBoardMessageId,
} = require('./utils/state');
const { getDefaultTz, msUntilMidnightInTz } = require('./utils/timezone');
const {
  buildZoneKillCard, buildSpawnAlertEmbed, buildSpawnedEmbed,
  buildDailySummaryEmbed,
} = require('./utils/embeds');
const {
  postKillUpdate, postOrUpdateExpansionBoard,
} = require('./utils/killops');
const { hasAllowedRole, allowedRolesList, hasOfficerRole, officerRolesList } = require('./utils/roles');
const { EXPANSION_ORDER, getThreadId, getBossExpansion, isPopLocked } = require('./utils/config');
const { discordAbsoluteTime, discordRelativeTime } = require('./utils/timer');

function getBosses() {
  delete require.cache[require.resolve('./data/bosses.json')];
  return require('./data/bosses.json');
}

// ── Client ─────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });

// ── Load commands ──────────────────────────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js')).forEach((file) => {
  try {
    const cmd = require(path.join(commandsPath, file));
    if (cmd.data && cmd.execute) {
      client.commands.set(cmd.data.name, cmd);
      console.log(`Loaded: /${cmd.data.name}`);
    } else {
      console.warn(`Skipped ${file} — missing data or execute`);
    }
  } catch (err) {
    console.error(`Failed to load ${file}:`, err.message);
  }
});

// ── Ready ──────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ ${readyClient.user.tag} | ${getBosses().length} bosses`);
  await registerCommands();
  startSpawnChecker(readyClient);
  scheduleMidnightSummary(readyClient);
  const { startWolfpackMembersSync } = require('./utils/wolfpackMembers');
  startWolfpackMembersSync(readyClient);
  startOpenDkpSync();
  startRaidHelperSync();
  runStartupSequence(readyClient).catch(err => console.error('[startup] Error:', err?.message));

  // Seed the bot_boards Supabase mirror once on startup so wolfpack.quest
  // /boards has data immediately (otherwise it'd be empty until the next
  // kill triggers postKillUpdate).
  try {
    const { mirrorBoardsToSupabase } = require('./utils/killops');
    mirrorBoardsToSupabase(getBosses())
      .then(() => console.log('[startup] bot_boards mirrored to supabase'))
      .catch(err => console.warn('[startup] bot_boards mirror failed:', err?.message));
  } catch (err) {
    console.warn('[startup] bot_boards mirror skipped:', err?.message);
  }

  // Agent release announcement — when the current agent version differs
  // from the last one we announced, post a brief note to TIMER_CHANNEL_ID
  // (#raid-mobs) so users know to update. Fires at most once per (bot,
  // agent) version pair. Skipped silently when no channel is configured
  // or the version hasn't moved since the last successful announce.
  setTimeout(() => {
    try { announceAgentReleaseIfNew(readyClient).catch(err => console.warn('[release-announce] failed:', err?.message)); }
    catch (err) { console.warn('[release-announce] init failed:', err?.message); }
  }, 30_000);

  // Apply community-tipped Zek affiliations from data/known_zek.json.
  // Conditional merge — anyone already tagged with a non-Zek guild stays
  // as-is. Idempotent, so re-running on every boot is safe. Mirrored to
  // Supabase who_observations so /whois and the web UI see them too,
  // not just the local state.whoData on Railway disk.
  try {
    delete require.cache[require.resolve('./data/known_zek.json')];
    const knownZek = require('./data/known_zek.json');
    const tips     = Array.isArray(knownZek?.tips) ? knownZek.tips : [];
    const result   = applyKnownZekTips(tips);
    if (result.applied || result.skipped) {
      console.log(`[zek-tips] applied=${result.applied} skipped=${result.skipped}` +
        (result.examples.applied.length ? ` first-applied=[${result.examples.applied.join(', ')}]` : '') +
        (result.examples.skipped.length ? ` first-skipped=[${result.examples.skipped.join(', ')}]` : ''));
    }
    // Mirror the same tips into Supabase who_observations. We only mirror
    // tips that survived the conditional merge — i.e., names where the
    // bot will now treat them as Zek. Otherwise we'd be writing
    // mis-attributing rows.
    try {
      const supabase = require('./utils/supabase');
      if (supabase.isEnabled() && tips.length > 0) {
        const { getWhoEntry } = require('./utils/state');
        const nowIso = new Date().toISOString();
        const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
        const rows = tips
          .map(t => {
            if (!t?.name) return null;
            const live = getWhoEntry(t.name);
            // Only emit a row when the merged entry is in fact a Zek
            // tag — the conditional merge above might have skipped this
            // name due to an existing non-Zek guild.
            if (!live || !live.is_zek) return null;
            return {
              guild_id:    guildId,
              character:   t.name,
              level:       live.level || null,
              race:        live.race  || null,
              class:       live.class || null,
              guild_name:  'Zek',
              anonymous:   false,
              gm:          false,
              observed_at: nowIso,
              uploaded_by: 'zek-tips',
            };
          })
          .filter(Boolean);
        if (rows.length > 0) {
          supabase.upsert('who_observations', rows, 'guild_id,character,observed_minute,uploaded_by')
            .catch(err => console.warn('[zek-tips] supabase mirror failed:', err?.message));
        }
      }
    } catch (err) {
      console.warn('[zek-tips] supabase wrap failed:', err?.message);
    }
  } catch (err) {
    console.warn('[zek-tips] failed:', err?.message);
  }
});

// Per-member agent release DMs.
//
// Previous design (pre-v2.5.41) posted a single message to a release-announce
// channel on every agent version bump — which triggered Discord push
// notifications for every member of every release, the noise the user
// specifically asked us to fix.
//
// New design: only opted-in members (i.e. anyone who has interacted with
// /onboarding at least once) get a DM, and only if their
// last_seen_agent_version is below the current release. The DM shows
// the diff bullets across versions (newest at top), a [Download latest]
// link button, and a [Don't ping me on revisions] dismiss.
//
// Dedup is two-layered:
//   * bot_announcements row keyed (kind=agent_release, key=<version>) is
//     claimed at the START of the fanout — so a Railway restart mid-fanout
//     skips re-running it entirely.
//   * Per-member, setLastSeenAgentVersion is called on every successful DM.
//     If the fanout dies halfway, members who already received don't get
//     re-DMed on the next deploy.
async function announceAgentReleaseIfNew(discordClient) {
  const version = _currentAgentVersion();
  if (!version) return;
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const supabase = require('./utils/supabase');

  // Master dedup — claim this version's fanout. If Supabase is up and the
  // key already exists, somebody else already did the work; bail.
  try {
    if (supabase.isEnabled()) {
      const prior = await supabase.select(
        'bot_announcements',
        `guild_id=eq.${guildId}&kind=eq.agent_release&key=eq.${encodeURIComponent(version)}&select=announced_at&limit=1`,
      );
      if (Array.isArray(prior) && prior.length > 0) return;
    }
  } catch (err) {
    console.warn('[release-announce] supabase prior-check failed:', err?.message);
  }
  if (getLastAnnouncedAgentVersion() === version) return;

  // Build the cross-version bullets bag — every version from
  // (member's last_seen_agent_version, current] needs to be available so each
  // recipient sees only their own diff. We send the entire file's versions[]
  // and let the embed builder filter per-recipient.
  let allBullets = {};
  try {
    delete require.cache[require.resolve('./data/agent_release_notes.json')];
    const notes = require('./data/agent_release_notes.json');
    if (notes?.versions && typeof notes.versions === 'object') allBullets = notes.versions;
  } catch { /* missing — fine; we'll DM a bare "version is out" line */ }

  const {
    listMembersBehindAgentVersion, setLastSeenAgentVersion,
    sliceAgentBulletsAfter,
    buildAgentReleaseEmbed, buildAgentReleaseComponents,
  } = require('./utils/onboarding');

  const candidates = listMembersBehindAgentVersion(version);
  if (candidates.length === 0) {
    // Nobody opted in yet, or everyone is current. Still set the master
    // marker so we don't keep re-checking on every restart.
    setLastAnnouncedAgentVersion(version);
    return;
  }

  let delivered = 0, skipped = 0, failed = 0;
  for (const { discordId, lastSeenAgentVersion } of candidates) {
    // Per-recipient bullet slice: everything strictly between their
    // last_seen and current. Cleaner than blasting the full history,
    // and uses semver compare (lex would put 2.4.10 below 2.4.9).
    const sliced = sliceAgentBulletsAfter(allBullets, lastSeenAgentVersion);

    try {
      const user = await discordClient.users.fetch(discordId).catch(() => null);
      if (!user) { skipped++; continue; }
      await user.send({
        embeds:     [buildAgentReleaseEmbed(version, lastSeenAgentVersion, sliced)],
        components: buildAgentReleaseComponents(version),
      });
      setLastSeenAgentVersion(discordId, version);
      delivered++;
    } catch (err) {
      // DMs disabled for that user, or rate-limited — leave their watermark
      // alone so they get caught up on a future release.
      failed++;
    }
    // Light throttle to be polite to Discord's DM rate limits. discord.js
    // also auto-retries 429s; this just keeps us under the radar for the
    // common case.
    await new Promise(r => setTimeout(r, 1200));
  }

  // Mark the version's fanout complete (durable + state.json fallback).
  try {
    if (supabase.isEnabled()) {
      await supabase.upsert('bot_announcements', [{
        guild_id:     guildId,
        kind:         'agent_release',
        key:          version,
        channel_id:   null,                 // no channel any more
        message_id:   null,
        announced_at: new Date().toISOString(),
      }], 'guild_id,kind,key').catch(err => console.warn('[release-announce] supabase write failed:', err?.message));
    }
  } catch (err) {
    console.warn('[release-announce] supabase persist wrap failed:', err?.message);
  }
  setLastAnnouncedAgentVersion(version);
  console.log(`[release-announce] agent v${version} DM fanout: ${delivered} delivered, ${skipped} skipped (no user), ${failed} failed`);
}

// OpenDKP mirror: first run 45s after boot (after the wolfpack-members sync
// kicks off so we don't double up on Cognito auth), then every 6h. We don't
// block on completion — the helper does its own per-call error logging.
// 30 min so /parses attendee counts catch up during a live raid (officers
// run /tick mid-raid; the bot's Supabase mirror needs to pull those rows
// quickly enough for the web "Tonight" panel to be useful). Was 6h, which
// hid in-progress raid attendance until well after the raid ended.
const OPENDKP_SYNC_INTERVAL_MS = 30 * 60 * 1000;
function startOpenDkpSync() {
  // Sync uses bearer auth exclusively now (post-v2.5.11) — characters,
  // raids list, raid detail, and auctions all live under /clients/{name}/*
  // which only needs Cognito ID token. OPENDKP_CLIENT_ID is no longer
  // consulted by the sync.
  const hasUsername = !!(process.env.OPENDKP_USERNAME || process.env.OPENDKP_EMAIL);
  const hasPassword = !!process.env.OPENDKP_PASSWORD;
  const hasCognito  = !!process.env.OPENDKP_COGNITO_CLIENT_ID;
  if (!hasUsername || !hasPassword || !hasCognito) {
    console.log('[opendkp-sync] skipped — missing Cognito creds:',
      'USERNAME/EMAIL=' + (hasUsername ? 'set' : 'MISSING'),
      'PASSWORD=' + (hasPassword ? 'set' : 'MISSING'),
      'COGNITO_CLIENT_ID=' + (hasCognito ? 'set' : 'MISSING'));
    return;
  }
  const { runSync } = require('./utils/openDkpSync');
  setTimeout(() => {
    runSync().then(r => console.log('[opendkp-sync] initial:', JSON.stringify(r)))
             .catch(err => console.warn('[opendkp-sync] initial failed:', err?.message));
  }, 45_000);
  setInterval(() => {
    runSync().then(r => console.log('[opendkp-sync] interval:', JSON.stringify(r)))
             .catch(err => console.warn('[opendkp-sync] interval failed:', err?.message));
  }, OPENDKP_SYNC_INTERVAL_MS);
}

// Raid-Helper sync — pulls upcoming + recent events and per-event signups
// every 30 min so /admin/signups has fresh data. Disabled when RH_API_KEY
// or RH_SERVER_ID isn't set.
function startRaidHelperSync() {
  const rh = require('./utils/raidhelperApi');
  if (!rh.isEnabled()) {
    console.log('[raidhelper-api] skipped — RH_API_KEY and/or RH_SERVER_ID unset');
    return;
  }
  setTimeout(() => {
    rh.syncRecent().then(r => console.log('[raidhelper-api] initial:', JSON.stringify(r)))
                   .catch(err => console.warn('[raidhelper-api] initial failed:', err?.message));
  }, 60_000);
  setInterval(() => {
    rh.syncRecent().then(r => console.log('[raidhelper-api] interval:', JSON.stringify(r)))
                   .catch(err => console.warn('[raidhelper-api] interval failed:', err?.message));
  }, 30 * 60_000);
}

async function runStartupSequence(readyClient) {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const { loadOnboardingData, postOrUpdateInstructions } = require('./utils/onboarding');
  const { loadParsesFromDiscord }    = require('./commands/parse');
  const { loadRosterFromDiscord }    = require('./utils/roster');
  const { runAutoRestore }           = require('./commands/restore');
  const { runBoard }                 = require('./commands/board');
  const { runCleanup }               = require('./commands/cleanup');
  const { loadHateStateFromDiscord } = require('./utils/hateBoard');

  await loadOnboardingData(readyClient).catch(err => console.warn('[startup] loadOnboardingData:', err?.message));
  await postOrUpdateInstructions(readyClient).catch(err => console.warn('[startup] postOrUpdateInstructions:', err?.message));
  await loadParsesFromDiscord(readyClient).catch(err => console.warn('[startup] loadParsesFromDiscord:', err?.message));
  await loadRosterFromDiscord(readyClient).catch(err => console.warn('[startup] loadRosterFromDiscord:', err?.message));
  await loadHateStateFromDiscord(readyClient).catch(err => console.warn('[startup] loadHateStateFromDiscord:', err?.message));
  await runAutoRestore(readyClient).catch(err => console.warn('[startup] runAutoRestore:', err?.message));
  await delay(60_000);
  await runBoard(readyClient).catch(err => console.warn('[startup] runBoard:', err?.message));
  await delay(60_000);
  await runCleanup(readyClient).catch(err => console.warn('[startup] runCleanup:', err?.message));
}

async function registerCommands() {
  const guildId = process.env.DISCORD_GUILD_ID, clientId = process.env.DISCORD_CLIENT_ID;
  if (!guildId || !clientId) { console.warn('⚠️ Missing DISCORD_GUILD_ID or DISCORD_CLIENT_ID'); return; }
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    const data = [...client.commands.values()].map((c) => c.data.toJSON());
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: data });
    console.log(`✅ Registered ${data.length} commands`);
  } catch (err) { console.error('❌ Command registration failed:', err?.message); }
}

// ── Interactions ───────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd?.autocomplete) { try { await cmd.autocomplete(interaction); } catch (e) { console.error(e); } }
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'parseConfirm') {
    const { handleParseConfirm } = require('./commands/parse');
    await handleParseConfirm(interaction).catch(console.error);
    return;
  }
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('kill:'))               { await handleBoardButton(interaction); return; }
    if (interaction.customId.startsWith('loot_rm:'))            { await handleLootRemove(interaction); return; }
    if (interaction.customId === 'loot_post')                   { await handleLootPost(interaction); return; }
    if (interaction.customId === 'loot_cancel')                 { await handleLootCancel(interaction); return; }
    if (interaction.customId.startsWith('confirm_kill_announce:')) { await handleConfirmKillAnnounce(interaction); return; }
    if (interaction.customId === 'cancel_kill_confirm')          { await interaction.update({ content: '↩️ Cancelled.', components: [] }); return; }
    if (interaction.customId === 'cancel_announce')             { await handleCancelAnnounce(interaction); return; }
    if (interaction.customId.startsWith('cancel_event_thread:')){ await handleCancelEventThread(interaction); return; }
    if (interaction.customId.startsWith('remove_target:'))      { await handleRemoveTargetButton(interaction); return; }
    if (interaction.customId.startsWith('add_zone_bosses:'))    { await handleAddZoneBosses(interaction); return; }
    if (interaction.customId === 'pvprole_toggle')              { await handlePvpRoleToggle(interaction, false); return; }
    if (interaction.customId === 'pvprole_toggle_silent')       { await handlePvpRoleToggle(interaction, true); return; }
    if (interaction.customId.startsWith('pvpalert_howl:'))      { await handlePvpAlertHowl(interaction); return; }
    if (interaction.customId.startsWith('pvp_spawn_alert:'))    { await handlePvpSpawnAlert(interaction); return; }
    if (interaction.customId === 'fb_recv')                      { await handleFeedbackRecv(interaction); return; }
    if (interaction.customId === 'fb_impl')                      { await handleFeedbackClose(interaction, true); return; }
    if (interaction.customId === 'fb_nope')                      { await handleFeedbackClose(interaction, false); return; }
    if (interaction.customId === 'onb_pvp')                      { await handleOnbPvp(interaction); return; }
    if (interaction.customId === 'onb_organizer')               { await handleOnbOrganizer(interaction); return; }
    if (interaction.customId === 'onb_attend')                  { await handleOnbAttend(interaction); return; }
    if (interaction.customId === 'onb_deeps')                   { await handleOnbDeeps(interaction); return; }
    if (interaction.customId.startsWith('onb_ignore:'))         { await handleOnbIgnore(interaction); return; }
    if (interaction.customId.startsWith('onb_show_full:'))      { await handleOnbShowFull(interaction); return; }
    if (interaction.customId === 'onb_show_again')              { await handleOnbShowAgain(interaction); return; }
    if (interaction.customId.startsWith('mark_avail:'))           { await handleMarkAvail(interaction); return; }
    if (interaction.customId.startsWith('pvp_window_spawned:')) { await handlePvpWindowSpawned(interaction); return; }
    if (interaction.customId.startsWith('hate_kill:'))          { await handleHateKillButton(interaction); return; }
    if (interaction.customId.startsWith('hate_confirm_unkill:')){ await handleHateConfirmUnkill(interaction); return; }
    if (interaction.customId.startsWith('hate_unknown:'))       { await handleHateUnknownButton(interaction); return; }
    if (interaction.customId.startsWith('suggest_host:'))        { await handleSuggestHost(interaction); return; }
    if (interaction.customId.startsWith('suggest_nohost:'))     { await handleSuggestNoHost(interaction); return; }
    if (interaction.customId.startsWith('suggest_confirm:'))    { await handleSuggestConfirm(interaction); return; }
    if (interaction.customId.startsWith('suggest_cancel_host:')){ await handleSuggestCancelHost(interaction); return; }
    if (interaction.customId.startsWith('parse_breakdown:')) {
      const { handleParseBreakdown } = require('./commands/parse');
      await handleParseBreakdown(interaction).catch(console.error);
      return;
    }
    if (interaction.customId.startsWith('who_family:'))         { await handleWhoFamily(interaction); return; }
    if (interaction.customId.startsWith('audit_undo:'))         { await handleAuditUndo(interaction); return; }
    if (interaction.customId.startsWith('sll_confirm:'))        { const { handleSllConfirm } = require('./commands/sll'); await handleSllConfirm(interaction); return; }
    if (interaction.customId === 'sll_cancel')                  { const { handleSllCancel }  = require('./commands/sll'); await handleSllCancel(interaction);  return; }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
    await maybeShowWelcome(interaction);
  } catch (err) {
    console.error(`/${interaction.commandName} error:`, err);
    try {
      const msg = { flags: MessageFlags.Ephemeral, content: '❌ An error occurred.' };
      interaction.replied || interaction.deferred
        ? await interaction.followUp(msg)
        : await interaction.reply(msg);
    } catch {} // Swallow — interaction token may have expired (10062)
  }
});

// ── Board button handler ────────────────────────────────────────────────────
async function handleBoardButton(interaction) {
  const bossId = interaction.customId.replace('kill:', '');
  const bosses = getBosses();
  const boss   = bosses.find((b) => b.id === bossId);

  // Synchronous checks first — still within the 3-second window
  if (!boss)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });
  if (isPopLocked(boss))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '🔒 PoP bosses are not available until October 1, 2026.' });
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  // If the kill button is on an /announce message, require an ephemeral confirmation
  // before recording the kill — prevents accidental clicks on event announcements.
  // Detect announce messages by the presence of the cancel_announce button — reliable
  // even after a redeploy that clears state.json's announceMessageIds list.
  const isAnnounceMsg = interaction.message.components?.some(row =>
    row.components?.some(c => c.customId === 'cancel_announce')
  );
  if (isAnnounceMsg) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const killState = getAllState();
    const existing  = killState[bossId];
    const isKilled  = existing && existing.nextSpawn > Date.now();
    const label     = isKilled ? `↩️ Confirm: Clear kill for ${boss.name}` : `☠️ Confirm kill: ${boss.name}`;
    const style     = isKilled ? ButtonStyle.Secondary : ButtonStyle.Danger;
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: isKilled
        ? `⚠️ **${boss.name}** is currently on cooldown. Confirm you want to clear the kill record?`
        : `⚠️ Record a kill for **${boss.name}**? This will start the respawn timer.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_kill_announce:${bossId}`).setLabel(label).setStyle(style),
        new ButtonBuilder().setCustomId('cancel_kill_confirm').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      )],
    });
  }

  // Defer immediately so Discord doesn't time out while we do async work
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const killState  = getAllState();
  const existing   = killState[bossId];
  const now        = Date.now();
  const expansion  = getBossExpansion(boss);
  const threadId   = getThreadId(expansion);

  if (existing && existing.nextSpawn > now) {
    // Unkill
    const prevState = { ...existing };
    clearKill(bossId);
    const newState    = getAllState();
    const stillKilled = bosses.filter((b) => b.zone === boss.zone && newState[b.id] && newState[b.id].nextSpawn > now);
    const zoneCard    = getZoneCard(boss.zone);
    if (zoneCard) {
      try {
        const ch = await interaction.client.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
        if (stillKilled.length > 0) {
          const killedInZone = stillKilled.map((b) => ({ boss: b, entry: newState[b.id], killedBy: newState[b.id].killedBy }));
          const m = await ch.messages.fetch(zoneCard.messageId);
          await m.edit({ embeds: [buildZoneKillCard(boss.zone, killedInZone)] });
        } else {
          const m = await ch.messages.fetch(zoneCard.messageId); await m.delete(); clearZoneCard(boss.zone);
        }
      } catch { clearZoneCard(boss.zone); }
    }
    await interaction.editReply(`↩️ Kill record cleared for **${boss.name}**.`);
    const { postAuditEntry } = require('./utils/audit');
    postAuditEntry(interaction.client, {
      action: 'unkill_board', userId: interaction.user.id, userName: interaction.user.username,
      bossId, bossName: boss.name, prevState, newNextSpawn: null, msgLink: null,
      source: `board button — ${interaction.customId}`,
    }).catch(() => {});
  } else {
    // Kill
    recordKill(bossId, boss.timerHours, interaction.user.id);
    const newState     = getAllState();
    const zoneBosses   = bosses.filter((b) => b.zone === boss.zone);
    const killedInZone = zoneBosses.filter((b) => newState[b.id] && newState[b.id].nextSpawn > now)
      .map((b) => ({ boss: b, entry: newState[b.id], killedBy: newState[b.id].killedBy }));
    const embed    = buildZoneKillCard(boss.zone, killedInZone);
    const zoneCard = getZoneCard(boss.zone);

    if (zoneCard) {
      try {
        const ch = await interaction.client.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
        const m  = await ch.messages.fetch(zoneCard.messageId);
        await m.edit({ embeds: [embed] });
      } catch {
        if (threadId) { const t = await interaction.client.channels.fetch(threadId); const s = await t.send({ embeds: [embed] }); setZoneCard(boss.zone, s.id, threadId); }
      }
    } else if (threadId) {
      const t = await interaction.client.channels.fetch(threadId);
      const s = await t.send({ embeds: [embed] });
      setZoneCard(boss.zone, s.id, threadId);
    }
    await interaction.editReply(`✅ **${boss.name}** kill recorded.`);
    const { postAuditEntry } = require('./utils/audit');
    postAuditEntry(interaction.client, {
      action: 'kill_board', userId: interaction.user.id, userName: interaction.user.username,
      bossId, bossName: boss.name, prevState: null, newNextSpawn: null, msgLink: null,
      source: `board button — ${interaction.customId}`,
    }).catch(() => {});
  }
  await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId).catch(console.warn);
}

// ── /loot button handlers ──────────────────────────────────────────────────
// /loot posts an embed with one ✖ button per item + Post + Cancel.  These
// handlers mutate state.pendingLoot[messageId] and re-render the message in
// place via interaction.update().  See utils/loot.js buildLootComponents and
// commands/loot.js execute() for how the batch is initialised.

async function handleLootRemove(interaction) {
  if (!hasAllowedRole(interaction.member)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
  }
  const gameItemId = interaction.customId.replace('loot_rm:', '');
  const msgId      = interaction.message.id;
  const { removePendingLootItem } = require('./utils/state');
  const updated = removePendingLootItem(msgId, gameItemId);
  if (!updated) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ This loot batch has expired (state lost). Run `/loot` again.' });
  }
  // Rebuild embed + components against the trimmed item list
  const { buildLootAnnounceEmbed, buildLootComponents } = require('./utils/loot');
  const embed = buildLootAnnounceEmbed(updated.items, updated.bossName, updated.bidMinutes);
  if (updated.activeRaidName) {
    embed.addFields({
      name:  'Linked raid',
      value: `**${updated.activeRaidName}** · #${updated.activeRaidId}`,
      inline: false,
    });
  }
  await interaction.update({ embeds: [embed], components: buildLootComponents(updated.items) });
}

async function handleLootPost(interaction) {
  if (!hasAllowedRole(interaction.member)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
  }
  const msgId = interaction.message.id;
  const { getPendingLoot, clearPendingLoot } = require('./utils/state');
  const entry = getPendingLoot(msgId);
  if (!entry) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ This loot batch has expired (state lost). Run `/loot` again.' });
  }
  if (!entry.items?.length) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ All items removed — nothing to post.' });
  }

  await interaction.deferUpdate();

  try {
    const { createAuctions } = require('./utils/opendkp');
    const auctions = entry.items.map(item => ({
      BidType:        'Open',
      ItemQuantity:   item.quantity || 1,
      Duration:       entry.bidMinutes,
      Bids:           [],
      Item:           { Name: item.name, GameItemId: item.gameItemId },
      AllowDeletes:   true,
      Auctioneer:     '',
      AutoAdjustBids: 0,
      MaximumBid:     100000,
      MinimumBid:     1,
      ItemId:         item.gameItemId,
    }));
    const result = await createAuctions(auctions);

    // Rebuild the embed in "posted" green state, strip components
    const { buildLootAnnounceEmbed } = require('./utils/loot');
    const { EmbedBuilder } = require('discord.js');
    const posted = buildLootAnnounceEmbed(entry.items, entry.bossName, entry.bidMinutes);
    posted.setColor(0x57f287);
    if (entry.activeRaidName) {
      posted.addFields({
        name: 'Linked raid',
        value: `**${entry.activeRaidName}** · #${entry.activeRaidId}`,
        inline: false,
      });
    }
    posted.setFooter({ text: `✅ Posted ${entry.items.length} auction(s) — bidding open ${entry.bidMinutes}m on OpenDKP` });
    await interaction.editReply({ embeds: [posted], components: [] });
    clearPendingLoot(msgId);

    // Invalidate cached drop history so next /loot recomputes rarity flags
    try { require('./utils/loot').invalidateDropHistory(); } catch {}
  } catch (err) {
    console.error('[loot] createAuctions failed:', err);
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: `❌ Failed to post auctions to OpenDKP: ${err?.message || err}\nFix the issue and click Post again — items still queued.`,
    });
  }
}

async function handleLootCancel(interaction) {
  if (!hasAllowedRole(interaction.member)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
  }
  const msgId = interaction.message.id;
  const { clearPendingLoot } = require('./utils/state');
  clearPendingLoot(msgId);

  const { EmbedBuilder } = require('discord.js');
  const orig = interaction.message.embeds[0];
  if (orig) {
    const cancelled = EmbedBuilder.from(orig).setColor(0x808080).setFooter({ text: `🚫 Cancelled by ${interaction.user.username} — no auctions posted` });
    await interaction.update({ embeds: [cancelled], components: [] });
  } else {
    await interaction.update({ content: '🚫 Cancelled.', embeds: [], components: [] });
  }
}

// ── Confirm kill from /announce message ────────────────────────────────────
// Fires after user confirms the ephemeral prompt shown by handleBoardButton
// when the kill button was on an /announce message.
async function handleConfirmKillAnnounce(interaction) {
  const bossId = interaction.customId.replace('confirm_kill_announce:', '');
  const bosses = getBosses();
  const boss   = bosses.find((b) => b.id === bossId);

  if (!boss)
    return interaction.update({ content: '❌ Unknown boss.', components: [] });
  if (!hasAllowedRole(interaction.member))
    return interaction.update({ content: `❌ You need one of these roles: ${allowedRolesList()}`, components: [] });

  await interaction.deferUpdate();

  const killState  = getAllState();
  const existing   = killState[bossId];
  const now        = Date.now();
  const expansion  = getBossExpansion(boss);
  const threadId   = getThreadId(expansion);

  const { postAuditEntry } = require('./utils/audit');

  if (existing && existing.nextSpawn > now) {
    // Unkill
    const prevState = { ...existing };
    clearKill(bossId);
    const newState    = getAllState();
    const stillKilled = bosses.filter((b) => b.zone === boss.zone && newState[b.id] && newState[b.id].nextSpawn > now);
    const zoneCard    = getZoneCard(boss.zone);
    if (zoneCard) {
      try {
        const ch = await interaction.client.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
        if (stillKilled.length > 0) {
          const killedInZone = stillKilled.map((b) => ({ boss: b, entry: newState[b.id], killedBy: newState[b.id].killedBy }));
          const m = await ch.messages.fetch(zoneCard.messageId);
          await m.edit({ embeds: [buildZoneKillCard(boss.zone, killedInZone)] });
        } else {
          const m = await ch.messages.fetch(zoneCard.messageId); await m.delete(); clearZoneCard(boss.zone);
        }
      } catch { clearZoneCard(boss.zone); }
    }
    await interaction.editReply({ content: `↩️ Kill record cleared for **${boss.name}**.`, components: [] });
    postAuditEntry(interaction.client, {
      action: 'unkill_board', userId: interaction.user.id, userName: interaction.user.username,
      bossId, bossName: boss.name, prevState, newNextSpawn: null, msgLink: null,
      source: `announce confirm button`,
    }).catch(() => {});
  } else {
    // Kill
    recordKill(bossId, boss.timerHours, interaction.user.id);
    const newState     = getAllState();
    const zoneBosses   = bosses.filter((b) => b.zone === boss.zone);
    const killedInZone = zoneBosses.filter((b) => newState[b.id] && newState[b.id].nextSpawn > now)
      .map((b) => ({ boss: b, entry: newState[b.id], killedBy: newState[b.id].killedBy }));
    const embed    = buildZoneKillCard(boss.zone, killedInZone);
    const zoneCard = getZoneCard(boss.zone);
    if (zoneCard) {
      try {
        const ch = await interaction.client.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
        const m  = await ch.messages.fetch(zoneCard.messageId);
        await m.edit({ embeds: [embed] });
      } catch {
        if (threadId) { const t = await interaction.client.channels.fetch(threadId); const s = await t.send({ embeds: [embed] }); setZoneCard(boss.zone, s.id, threadId); }
      }
    } else if (threadId) {
      const t = await interaction.client.channels.fetch(threadId);
      const s = await t.send({ embeds: [embed] });
      setZoneCard(boss.zone, s.id, threadId);
    }
    await interaction.editReply({ content: `✅ **${boss.name}** kill recorded.`, components: [] });
    postAuditEntry(interaction.client, {
      action: 'kill_board', userId: interaction.user.id, userName: interaction.user.username,
      bossId, bossName: boss.name, prevState: null, newNextSpawn: null, msgLink: null,
      source: `announce confirm button`,
    }).catch(() => {});
  }
  await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId).catch(console.warn);
}

// ── Audit undo button ──────────────────────────────────────────────────────
async function handleAuditUndo(interaction) {
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Only officers can undo audit actions. Roles required: ${officerRolesList()}` });

  const entryId = interaction.customId.replace('audit_undo:', '');
  const { getAuditEntry, markAuditEntryUndone, restoreBossState } = require('./utils/state');
  const { removeUndoButton } = require('./utils/audit');

  const entry = getAuditEntry(entryId);
  if (!entry) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Audit entry not found.' });
  if (entry.undone) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ This action has already been undone.' });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const killActions   = ['kill', 'kill_board'];
  const unkillActions = ['unkill', 'unkill_board'];

  if (killActions.includes(entry.action)) {
    clearKill(entry.bossId);
  } else if (unkillActions.includes(entry.action) || entry.action === 'updatetimer') {
    if (entry.prevState) restoreBossState(entry.bossId, entry.prevState);
  }

  markAuditEntryUndone(entryId);
  await removeUndoButton(interaction.client, entry.auditMsgId);
  await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, entry.bossId).catch(console.warn);
  await interaction.editReply(`✅ Undone: **${entry.bossName}** ${entry.action} (originally by <@${entry.userId}>)`);
}

// ── Cancel announce button ─────────────────────────────────────────────────
async function handleCancelAnnounce(interaction) {
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Only officers can cancel events. Roles required: ${officerRolesList()}` });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  const origMsg         = interaction.message;
  try {
    if (historyThreadId) {
      const thread = await interaction.client.channels.fetch(historyThreadId);
      await thread.send({ content: `📋 **Cancelled announcement** (by <@${interaction.user.id}>)`, embeds: origMsg.embeds });
    }
    await origMsg.delete();
    removeAnnounceMessageId(origMsg.id);
    await interaction.editReply('✅ Announcement cancelled and archived.');
  } catch (err) {
    await interaction.editReply('❌ Could not archive.');
  }
}

// ── Feedback button handlers ──────────────────────────────────────────────
const { EmbedBuilder: _EB2, ActionRowBuilder: _ARB2, ButtonBuilder: _BB2, ButtonStyle: _BS2 } = require('discord.js');

function _feedbackAckRow() {
  return new _ARB2().addComponents(
    new _BB2().setCustomId('fb_impl').setLabel('✅ Implemented').setStyle(_BS2.Success),
    new _BB2().setCustomId('fb_nope').setLabel('❌ Not Implementing').setStyle(_BS2.Danger),
  );
}

async function handleFeedbackRecv(interaction) {
  const { hasOfficerRole, officerRolesList: orl } = require('./utils/roles');
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Officers only. Roles required: ${orl()}` });

  await interaction.deferUpdate();
  const msg   = interaction.message;
  const embed = msg.embeds[0];
  if (!embed) return;

  // Extract submitter user ID from footer (stored as "uid:<id>")
  const footerText = embed.footer?.text || '';
  const uidMatch   = footerText.match(/uid:(\d+)/);
  const userId     = uidMatch?.[1];

  // DM the submitter
  if (userId) {
    try {
      const user = await interaction.client.users.fetch(userId);
      await user.send(`📬 Your feedback (**${embed.title?.replace('📬 Feedback — ', '') || 'General'}**) has been received by leadership. Thank you!`);
    } catch { /* DMs may be closed */ }
  }

  const reviewer = interaction.member?.displayName || interaction.user.username;
  const updated  = _EB2.from(embed)
    .setFields(...(embed.fields || []).filter(f => f.name !== 'Status'), { name: 'Status', value: `📬 Acknowledged by ${reviewer}`, inline: false });

  await msg.edit({ embeds: [updated], components: [_feedbackAckRow()] });
}

async function handleFeedbackClose(interaction, implemented) {
  const { hasOfficerRole, officerRolesList: orl } = require('./utils/roles');
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Officers only. Roles required: ${orl()}` });

  await interaction.deferUpdate();
  const msg    = interaction.message;
  const embed  = msg.embeds[0];
  if (!embed) return;

  const reviewer = interaction.member?.displayName || interaction.user.username;
  const statusVal = implemented
    ? `✅ Implemented by ${reviewer}`
    : `❌ Not implementing (${reviewer})`;

  const updated = _EB2.from(embed)
    .setFields(...(embed.fields || []).filter(f => f.name !== 'Status'), { name: 'Status', value: statusVal, inline: false });

  await msg.edit({ embeds: [updated], components: [] });
}

// ── Cancel event from announce thread button ───────────────────────────────
async function handleCancelEventThread(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  const announceMessageId = interaction.customId.replace('cancel_event_thread:', '');
  const announce          = getAnnounce(announceMessageId);
  if (!announce)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find the announce record for this event.' });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Delete Discord event
  if (announce.eventId) {
    try {
      const event = await interaction.guild.scheduledEvents.fetch(announce.eventId);
      await event.delete();
    } catch (err) { console.warn('cancel_event_thread: could not delete event:', err?.message); }
  }

  // Check for meaningful conversation in the thread (more than bot messages)
  const thread = interaction.channel;
  let hasConversation = false;
  try {
    const msgs = await thread.messages.fetch({ limit: 50 });
    hasConversation = msgs.some(m => !m.author.bot);
  } catch { /* assume no conversation */ }

  // Archive or delete the thread
  try {
    if (hasConversation) {
      await thread.setArchived(true, 'Raid event cancelled');
    } else {
      await thread.delete('Raid event cancelled — no conversation');
    }
  } catch (err) { console.warn('cancel_event_thread: could not close thread:', err?.message); }

  // Update the original announce message to show cancelled
  try {
    const ch  = await interaction.client.channels.fetch(announce.channelId);
    const msg = await ch.messages.fetch(announceMessageId);
    const { EmbedBuilder } = require('discord.js');
    const updated = EmbedBuilder.from(msg.embeds[0])
      .setTitle(`~~${msg.embeds[0].title}~~ ❌ CANCELLED`)
      .setColor(0x555555);
    await msg.edit({ embeds: [updated], components: [] });
  } catch (err) { console.warn('cancel_event_thread: could not update announce msg:', err?.message); }

  // Archive to historic kills thread
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  if (historyThreadId) {
    try {
      const histThread = await interaction.client.channels.fetch(historyThreadId);
      await histThread.send({ content: `📋 **Cancelled raid event** (by <@${interaction.user.id}>)` });
    } catch { /* non-critical */ }
  }

  removeAnnounce(announceMessageId);
  removeAnnounceMessageId(announceMessageId);

  if (!hasConversation) {
    // Thread was deleted — can't editReply into a deleted thread
    return;
  }
  await interaction.editReply('✅ Event cancelled and thread archived.');
}

// ── Remove-target button from thread control panel ─────────────────────────
async function handleRemoveTargetButton(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  const targetId = interaction.customId.replace('remove_target:', '');
  const announce = getAnnounceByThreadId(interaction.channel.id);
  if (!announce)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find announce data for this thread.' });

  // Delegate to the removetarget command logic by faking the interaction
  // (reuse the state + easter egg logic via direct state calls)
  const {
    buildControlPanelEmbed, buildTargetButtons, buildKillRows, buildCancelRow, EASTER_EGG_CHAIN,
  } = require('./commands/announce');
  const bosses = getBosses();

  let targets = [...(announce.targets || [])].filter(t => t !== targetId);
  updateAnnounceTargets(announce.messageId, targets);

  let extra = '';
  const hasRealTargets = targets.some(t => !t.startsWith('_'));
  if (!hasRealTargets) {
    const level   = announce.easterEggLevel || 0;
    const nextEgg = EASTER_EGG_CHAIN[level];
    if (nextEgg) {
      targets = targets.filter(t => EASTER_EGG_CHAIN.findIndex(e => e.id === t) === -1);
      targets.push(nextEgg.id);
      updateAnnounceTargets(announce.messageId, targets);
      updateAnnounceEasterEgg(announce.messageId, level + 1);
      if (nextEgg.quote) await interaction.channel.send({ content: `> ${nextEgg.quote}` });
      if (announce.eventId) {
        try {
          const ev = await interaction.guild.scheduledEvents.fetch(announce.eventId);
          await ev.edit({ name: `Pack Takedown: ${nextEgg.name}` });
        } catch { /* non-critical */ }
      }
      extra = ` Added **${nextEgg.name}**. 😈`;
    }
  }

  // Refresh the control panel in this message
  try {
    const freshAnnounce  = { ...getAnnounce(announce.messageId), messageId: announce.messageId };
    const cpEmbed        = buildControlPanelEmbed(freshAnnounce.targets, bosses, freshAnnounce.zone, freshAnnounce.plannedTimeStr);
    const killRows       = buildKillRows(freshAnnounce.targets, bosses);
    const targetRows     = buildTargetButtons(freshAnnounce.targets, bosses);
    const cancelRow      = buildCancelRow(announce.messageId);
    await interaction.message.edit({ embeds: [cpEmbed], components: [...killRows.slice(0, 2), ...targetRows.slice(0, 2), cancelRow] });
  } catch (err) { console.warn('remove_target button: could not refresh panel:', err?.message); }

  await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Target removed.${extra}` });
}

// ── Add all zone bosses button ─────────────────────────────────────────────
async function handleAddZoneBosses(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  const announceMessageId = interaction.customId.replace('add_zone_bosses:', '');
  const announce          = getAnnounce(announceMessageId);
  if (!announce)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find announce record.' });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const bosses    = getBosses();
  const zone      = announce.zone;
  const existing  = new Set(announce.targets || []);
  const newBosses = bosses.filter(b => b.zone === zone && !existing.has(b.id) && !isPopLocked(b));

  if (!newBosses.length)
    return interaction.editReply('ℹ️ All bosses in this zone are already targets.');

  const { fetchUrl, scrapePqdiDetails, buildControlPanelEmbed, buildTargetButtons, buildKillRows, buildCancelRow } = require('./commands/announce');
  const { EmbedBuilder } = require('discord.js');
  const thread = interaction.channel;

  for (const b of newBosses) {
    if (b.pqdiUrl) {
      try {
        const html    = await fetchUrl(b.pqdiUrl);
        const details = scrapePqdiDetails(html);
        const embed   = new EmbedBuilder()
          .setColor(0xf5a623)
          .setTitle(`${b.emoji || '⚔️'} ${b.name}`)
          .setURL(b.pqdiUrl)
          .setDescription(`**Zone:** ${b.zone}\n[Full PQDI listing](${b.pqdiUrl})`)
          .setTimestamp();
        if (details.length) embed.addFields(details.slice(0, 25));
        await thread.send({ embeds: [embed] });
      } catch {
        await thread.send({ content: `PQDI info unavailable — [View on PQDI](${b.pqdiUrl})` }).catch(() => {});
      }
    }
  }

  const allTargets = [...existing, ...newBosses.map(b => b.id)];
  updateAnnounceTargets(announceMessageId, allTargets);

  // Rename thread to zone name
  try { await thread.edit({ name: `${zone} — ${announce.plannedTimeStr}` }); } catch { /* non-critical */ }

  // Rename Discord scheduled event to zone
  if (announce.eventId) {
    try {
      const ev = await interaction.guild.scheduledEvents.fetch(announce.eventId);
      await ev.edit({ name: `Pack Takedown: ${zone}` });
    } catch { /* non-critical */ }
  }

  // Update announce message title in event-chat
  try {
    const ch  = await interaction.client.channels.fetch(announce.channelId);
    const msg = await ch.messages.fetch(announceMessageId);
    if (msg?.embeds?.[0]) {
      const updated = EmbedBuilder.from(msg.embeds[0]).setTitle(`📣 Pack Takedown: ${zone}`);
      await msg.edit({ embeds: [updated] });
    }
  } catch { /* non-critical */ }

  // Refresh control panel — drop the zone button now that it's been used
  const freshAnnounce = { ...getAnnounce(announceMessageId), messageId: announceMessageId };
  const cpEmbed       = buildControlPanelEmbed(freshAnnounce.targets, bosses, zone, freshAnnounce.plannedTimeStr);
  const killRows      = buildKillRows(freshAnnounce.targets, bosses);
  const targetRows    = buildTargetButtons(freshAnnounce.targets, bosses);
  const cancelRow     = buildCancelRow(announceMessageId);
  try {
    await interaction.message.edit({ embeds: [cpEmbed], components: [...killRows.slice(0, 2), ...targetRows.slice(0, 2), cancelRow] });
  } catch { /* non-critical */ }

  await interaction.editReply(`✅ Added **${newBosses.length}** boss(es) from **${zone}**. Thread and event renamed.`);
}

// ── Welcome card ──────────────────────────────────────────────────────────
async function maybeShowWelcome(interaction) {
  if (hasSeenWelcome(interaction.user.id)) return;
  markWelcomeSeen(interaction.user.id);
  try {
    const pkg = require('./package.json');
    const { buildWelcomeEmbed, buildWelcomeComponents } = require('./utils/onboarding');
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      embeds: [buildWelcomeEmbed()],
      components: buildWelcomeComponents(pkg.version),
    });
  } catch { /* non-critical — don't let a failed welcome break anything */ }
}

async function handleWelcomePvp(interaction) {
  const { getPvpRole, getPvpRoleName, buildAnnouncementEmbed, buildRoleRow } = require('./commands/pvprole');
  const pvpRole = await getPvpRole(interaction.guild);
  if (!pvpRole) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ No role named **${getPvpRoleName()}** found — ask an admin to create it.` });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const hasRole = interaction.member.roles.cache.has(pvpRole.id);
  if (!hasRole) {
    await interaction.member.roles.add(pvpRole);
    const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
    const ch = pvpTargetId ? await interaction.client.channels.fetch(pvpTargetId).catch(() => null) : null;
    await (ch || interaction.channel).send({
      content: `<@&${pvpRole.id}>`,
      embeds: [buildAnnouncementEmbed(interaction.member)],
      components: [buildRoleRow()],
    });
  }
  await interaction.editReply(`🐺 AWROOOOOO! You${hasRole ? ' already have' : ' now have'} the **${pvpRole.name}** role. The pack awaits.`);
}

async function handleWelcomeOrganizer(interaction) {
  const roleList = (process.env.ALLOWED_ROLE_NAMES || '').split(',').map(r => `**${r.trim()}**`).filter(Boolean).join(', ');
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: [
      `📣 **Raid organizer — here's what to know:**`,
      `Use \`/announce\` to schedule a takedown with a thread, Discord event, and role pings.`,
      `Use \`/addtarget\`, \`/adjusttime\`, and \`/adjustdate\` inside the raid thread to update the plan.`,
      `Kill tracking (board buttons + \`/kill\`) requires one of these roles: ${roleList || 'check with an officer'}.`,
      `Run \`/raidbosshelp\` for the full command reference.`,
    ].join('\n'),
  });
}

async function handleWelcomeAttendee(interaction) {
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `🎯 You're all set! Keep an eye on Discord events and announcements in raid channels. When you're ready to track kills or join PVP, just run this command again or use \`/pvprole\` anytime.`,
  });
}

// ── PVP role toggle button ─────────────────────────────────────────────────
async function handlePvpRoleToggle(interaction, silent) {
  const { buildAnnouncementEmbed, buildRoleRow, getPvpRole, getPvpRoleName } = require('./commands/pvprole');
  const member  = interaction.member;
  const pvpRole = await getPvpRole(interaction.guild);

  if (!pvpRole)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Could not find a role named **${getPvpRoleName()}**.` });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const hasRole = member.roles.cache.has(pvpRole.id);
  if (hasRole) {
    await member.roles.remove(pvpRole);
    await interaction.editReply(`↩️ Your **${pvpRole.name}** role has been removed. You can rejoin anytime.`);
  } else {
    await member.roles.add(pvpRole);
    if (!silent) {
      const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
      const ch = pvpTargetId
        ? await interaction.client.channels.fetch(pvpTargetId).catch(() => null)
        : null;
      await (ch || interaction.channel).send({
        content: `<@&${pvpRole.id}>`,
        embeds: [buildAnnouncementEmbed(member)],
        components: [buildRoleRow()],
      });
    }
    await interaction.editReply(`✅ You now have the **${pvpRole.name}** role! ${silent ? '(quietly added)' : 'AWROOOOOO!'}`);
  }
}

// ── PVP alert howl button ──────────────────────────────────────────────────
async function handlePvpAlertHowl(interaction) {
  const messageId = interaction.customId.replace('pvpalert_howl:', '');
  const howlers   = addPvpAlertHowler(messageId, interaction.user.id);

  // Build Oxford comma mention list
  const mentions = howlers.map(id => `<@${id}>`);
  let howlLine;
  if (mentions.length === 1) {
    howlLine = `${mentions[0]} howls back!`;
  } else if (mentions.length === 2) {
    howlLine = `${mentions[0]} and ${mentions[1]} howl back!`;
  } else {
    howlLine = `${mentions.slice(0, -1).join(', ')}, and ${mentions[mentions.length - 1]} howl back!`;
  }

  // Replace/append howlers line without touching the original alert content
  const origMsg     = interaction.message;
  const baseContent = origMsg.content.split('\n').filter(l => !l.includes('howls back!')).join('\n');
  try {
    await origMsg.edit({ content: `${baseContent}\n${howlLine}`, components: origMsg.components });
  } catch (err) { console.warn('pvpalert_howl: could not edit message:', err?.message); }

  await interaction.reply({ flags: MessageFlags.Ephemeral, content: '🐺 AWROOOOOO!' });
}

// ── PVP spawn alert button ─────────────────────────────────────────────────
async function handlePvpSpawnAlert(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const bossId = interaction.customId.replace('pvp_spawn_alert:', '');
  delete require.cache[require.resolve('./data/bosses.json')];
  const bosses = require('./data/bosses.json');
  const boss   = bosses.find(b => b.id === bossId);

  const name = boss?.name || bossId;
  const zone = boss?.zone || 'Unknown Zone';

  const pvpRoleName = process.env.PVP_ROLE || 'PVP';
  const pvpRole     = interaction.guild.roles.cache.find(r => r.name === pvpRoleName);
  const mention     = pvpRole ? `<@&${pvpRole.id}> ` : '';

  const { buildHowlRow } = require('./commands/pvpalert');
  const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  const ch = pvpTargetId
    ? await interaction.client.channels.fetch(pvpTargetId).catch(() => interaction.channel)
    : interaction.channel;

  const content = `${mention}🟢 **${name}** (${zone}) has spawned — who's going?`;
  const sent = await ch.send({ content });
  await sent.edit({ content, components: [buildHowlRow(sent.id)] });

  await interaction.editReply(`✅ PVP alert posted for **${name}**!`);
}

// ── Mark mob available (timer-unknown kills) ───────────────────────────────────
async function handleMarkAvail(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  // customId: mark_avail:live:<key>  or  mark_avail:pvp:<key>
  const [, type, ...rest] = interaction.customId.split(':');
  const key = rest.join(':');

  const { refreshHateBoard } = require('./utils/hateBoard');

  if (type === 'live') {
    const { clearLiveKill } = require('./utils/state');
    clearLiveKill(key);
  } else if (type === 'pvp') {
    clearPvpKill(key);
  }

  const { EmbedBuilder: EB } = require('discord.js');
  const availEmbed = new EB()
    .setColor(0x57f287)
    .setTitle('✅ Mob is Available')
    .setDescription(`Marked available by <@${interaction.user.id}>. Use the appropriate kill command to start a new timer.`)
    .setTimestamp();

  await interaction.update({ embeds: [availEmbed], components: [] });
  refreshHateBoard(interaction.client, type).catch(err => console.warn('[mark_avail] refreshHateBoard:', err?.message));
}

// ── PVP spawn window "Mob Spawned" button ─────────────────────────────────────
// customId: pvp_window_spawned:<key>
// Fired from the spawn-window-opens-soon alert. Clears the kill, deletes the
// kill card, refreshes the hate board, and edits the alert message in place.
async function handlePvpWindowSpawned(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  const key   = interaction.customId.replace('pvp_window_spawned:', '');
  const kills = getAllPvpKills();
  const entry = kills[key];

  if (!entry) {
    // Already cleared — just remove the button so nobody clicks it again
    const { EmbedBuilder: EB } = require('discord.js');
    return interaction.update({
      embeds: [new EB().setColor(0x57f287).setTitle('🟢 Already cleared').setDescription('This timer was already removed.').setTimestamp()],
      components: [],
    });
  }

  // Delete kill card from kills thread
  const killsThreadId = process.env.PVP_KILLS_THREAD_ID;
  if (killsThreadId && entry.threadMessageId) {
    try {
      const thread = await interaction.client.channels.fetch(killsThreadId);
      const msg    = await thread.messages.fetch(entry.threadMessageId);
      await msg.delete();
    } catch { /* already gone */ }
  }

  clearPvpKill(key);

  const { refreshHateBoard } = require('./utils/hateBoard');
  refreshHateBoard(interaction.client, 'pvp').catch(err => console.warn('[pvp_window_spawned] refreshHateBoard:', err?.message));

  const { EmbedBuilder: EB } = require('discord.js');
  await interaction.update({
    embeds: [new EB()
      .setColor(0x57f287)
      .setTitle(`🟢 Mob Spawned — ${entry.name}`)
      .setDescription(`Confirmed by <@${interaction.user.id}>. Timer cleared — use \`/pvphatekill\` after engaging.`)
      .setTimestamp(),
    ],
    components: [],
  });
}

// ── Hate board kill button ────────────────────────────────────────────────────
// customId: hate_kill:<type>:<n>   type = live | pvp, n = 1-12
// Clicking an available spot kills it. Clicking an on-cooldown spot shows a
// confirmation instead of immediately unkilling (prevents stale-cache accidents).
async function handleHateKillButton(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  const parts = interaction.customId.split(':'); // ['hate_kill', type, n]
  const type  = parts[1];
  const n     = parseInt(parts[2], 10);

  const { HATE_SPOTS } = require('./data/hate-spots');
  const { recordLiveKill, recordPvpKill } = require('./utils/state');
  const { refreshHateBoard } = require('./utils/hateBoard');
  const { EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');

  const spot = HATE_SPOTS[n];
  if (!spot)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Unknown spot #${n}.` });

  const HATE_TIMER_HOURS = 72;
  const keyPrefix = type === 'live' ? 'hate_' : 'hate_pvp_';
  const key = keyPrefix + n;
  const kills = type === 'live' ? getAllLiveKills() : getAllPvpKills();
  const existing = kills[key];
  const now = Date.now();

  if (existing && (existing.timerUnknown || (existing.nextSpawn && existing.nextSpawn > now))) {
    // Spot is on cooldown — show confirmation instead of silently unkilling.
    // This prevents accidental unkills when Discord shows a user a stale board.
    const statusLine = existing.timerUnknown
      ? 'timer unknown — check manually'
      : `spawns ${discordRelativeTime(existing.nextSpawn)}`;
    const confirmRow = new ARB().addComponents(
      new BB()
        .setCustomId(`hate_confirm_unkill:${type}:${n}`)
        .setLabel(`✅ Confirm: Mark #${n} Available`)
        .setStyle(BS.Danger)
    );
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `⚠️ **${spot.label}** is currently on cooldown (${statusLine}).\nIf this mob has re-spawned, click below to mark it available.`,
      components: [confirmRow],
    });
  }

  // Kill — defer first since refreshHateBoard is async
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const spotName = `Hate Mini — ${spot.label}`;
  if (type === 'live') {
    recordLiveKill(key, spotName, HATE_TIMER_HOURS, interaction.user.id, false);
  } else {
    recordPvpKill(spotName, HATE_TIMER_HOURS, interaction.user.id, key, false);
  }
  await refreshHateBoard(interaction.client, type);

  const entry = type === 'live' ? getAllLiveKills()[key] : getAllPvpKills()[key];
  let desc;
  if (type === 'live') {
    desc = `Next spawn: ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`;
  } else {
    desc = `Earliest: ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})\nLatest: ${discordAbsoluteTime(entry.nextSpawnLatest)} (${discordRelativeTime(entry.nextSpawnLatest)})`;
  }

  const killEmbed = new EB()
    .setColor(type === 'live' ? 0x9b59b6 : 0xcc0000)
    .setTitle(`☠️ Kill recorded — ${spot.label}`)
    .setDescription(desc)
    .setTimestamp();

  const unknownRow = new ARB().addComponents(
    new BB()
      .setCustomId(`hate_unknown:${type}:${n}`)
      .setLabel('❓ Timer Unknown')
      .setStyle(BS.Secondary)
  );

  await interaction.editReply({ embeds: [killEmbed], components: [unknownRow] });
}

// ── Hate board confirm unkill ──────────────────────────────────────────────────
// customId: hate_confirm_unkill:<type>:<n>
async function handleHateConfirmUnkill(interaction) {
  const parts = interaction.customId.split(':');
  const type  = parts[1];
  const n     = parseInt(parts[2], 10);

  const { HATE_SPOTS } = require('./data/hate-spots');
  const { refreshHateBoard } = require('./utils/hateBoard');
  const { EmbedBuilder: EB } = require('discord.js');

  const spot = HATE_SPOTS[n];
  const keyPrefix = type === 'live' ? 'hate_' : 'hate_pvp_';
  const key = keyPrefix + n;

  if (type === 'live') clearLiveKill(key);
  else clearPvpKill(key);

  await refreshHateBoard(interaction.client, type);

  const doneEmbed = new EB()
    .setColor(0x57f287)
    .setTitle(`✅ Available — ${spot?.label || `Spot #${n}`}`)
    .setDescription(`Marked available by <@${interaction.user.id}>. The board has been updated.`)
    .setTimestamp();

  await interaction.update({ embeds: [doneEmbed], components: [] });
}

// ── Hate board "Timer Unknown" button ─────────────────────────────────────────
// customId: hate_unknown:<type>:<n>
async function handleHateUnknownButton(interaction) {
  const parts = interaction.customId.split(':');
  const type  = parts[1];
  const n     = parseInt(parts[2], 10);

  const { HATE_SPOTS } = require('./data/hate-spots');
  const { refreshHateBoard } = require('./utils/hateBoard');
  const { EmbedBuilder: EB } = require('discord.js');

  const spot = HATE_SPOTS[n];
  const keyPrefix = type === 'live' ? 'hate_' : 'hate_pvp_';
  const key = keyPrefix + n;

  if (type === 'live') setLiveKillTimerUnknown(key);
  else setPvpKillTimerUnknown(key);

  await refreshHateBoard(interaction.client, type);

  const doneEmbed = new EB()
    .setColor(0x808080)
    .setTitle(`❓ Timer Unknown — ${spot?.label || `Spot #${n}`}`)
    .setDescription('Marked as killed with unknown timer. The board shows ❓ for this spot.\nClick the board button again to clear it when the mob is available.')
    .setTimestamp();

  await interaction.update({ embeds: [doneEmbed], components: [] });
}

// ── Suggest button handlers ───────────────────────────────────────────────────
// Flow: "I'll host it" → ephemeral confirmation → "Confirm" → claim + ping requester

async function handleSuggestHost(interaction) {
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Only officers can respond to event requests.` });

  const requesterId = interaction.customId.split(':')[1];
  const original    = interaction.message;
  const oldEmbed    = original.embeds[0];
  if (!oldEmbed) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find the original request.' });

  const fields    = oldEmbed.fields || [];
  const bossField = fields.find(f => f.name === 'Boss / Zone');
  const timeField = fields.find(f => f.name === 'Wanted time');
  const reqField  = fields.find(f => f.name === 'Requested by');

  const { EmbedBuilder: EB, ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');

  const confirmEmbed = new EB()
    .setColor(0xFEE75C)
    .setTitle('⚠️ Confirm — Announce this event?')
    .setDescription(
      `You're about to claim this request and notify the requester.\n\n` +
      `**Boss / Zone:** ${bossField?.value || 'Unknown'}\n` +
      `**Wanted time:** ${timeField?.value || 'Unknown'}\n` +
      `**Suggested by:** ${reqField?.value || `<@${requesterId}>`}`
    )
    .setFooter({ text: 'This will mark the request as claimed. Run /announce to post the full event.' });

  const row = new AR().addComponents(
    new BB()
      .setCustomId(`suggest_confirm:${requesterId}:${original.id}`)
      .setLabel("Yes, I'll host it")
      .setStyle(BS.Success),
    new BB()
      .setCustomId(`suggest_cancel_host:${requesterId}`)
      .setLabel('Cancel')
      .setStyle(BS.Secondary),
  );

  await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [confirmEmbed], components: [row] });
}

async function handleSuggestConfirm(interaction) {
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Only officers can confirm event requests.` });

  const parts       = interaction.customId.split(':');
  const requesterId = parts[1];
  const origMsgId   = parts[2];

  const { EmbedBuilder: EB, ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');

  try {
    const origMsg  = await interaction.channel.messages.fetch(origMsgId);
    const oldEmbed = origMsg.embeds[0];
    if (origMsg && oldEmbed) {
      const updated = new EB(oldEmbed.data)
        .setColor(0x57F287)
        .setTitle('✅ Event Request — Claimed')
        .setFooter({ text: `Claimed by ${interaction.member.displayName || interaction.user.username}` });
      const disabled = new AR().addComponents(
        new BB().setCustomId('suggest_host_done').setLabel("I'll host it").setStyle(BS.Success).setDisabled(true),
        new BB().setCustomId('suggest_nohost_done').setLabel('No hosts available').setStyle(BS.Danger).setDisabled(true),
      );
      await origMsg.edit({ embeds: [updated], components: [disabled] });
    }
  } catch {}

  try {
    await interaction.channel.send({
      content: `<@${requesterId}> — <@${interaction.user.id}> will host your event! Keep an eye out for an \`/announce\`.`,
    });
  } catch {}

  await interaction.update({ embeds: [], components: [], content: '✅ Claimed! Remember to run `/announce` to post the full event.' });
}

async function handleSuggestCancelHost(interaction) {
  await interaction.update({ embeds: [], components: [], content: '↩️ Cancelled — no changes made.' });
}

async function handleSuggestNoHost(interaction) {
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Only officers can respond to event requests.` });

  const requesterId = interaction.customId.split(':')[1];
  const original    = interaction.message;
  const oldEmbed    = original.embeds[0];
  if (!oldEmbed) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find the original request.' });

  const { EmbedBuilder: EB, ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
  const updated = new EB(oldEmbed.data)
    .setColor(0xED4245)
    .setTitle('❌ Event Request — No Hosts Available')
    .setFooter({ text: `Closed by ${interaction.member.displayName || interaction.user.username}` });

  const disabled = new AR().addComponents(
    new BB().setCustomId('suggest_host_done').setLabel("I'll host it").setStyle(BS.Success).setDisabled(true),
    new BB().setCustomId('suggest_nohost_done').setLabel('No hosts available').setStyle(BS.Danger).setDisabled(true),
  );

  await interaction.update({ embeds: [updated], components: [disabled] });

  try {
    await interaction.channel.send({
      content: `<@${requesterId}> — Unfortunately no officers are available to host your event right now. Try again later or post in the forum!`,
    });
  } catch {}
}

// ── Onboarding button handlers ────────────────────────────────────────────────
async function handleOnbPvp(interaction) {
  const { buildAnnouncementEmbed, buildRoleRow, getPvpRole, getPvpRoleName } = require('./commands/pvprole');
  try {
    const roleName = getPvpRoleName();
    const guild    = interaction.guild || await interaction.client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const role     = await getPvpRole(guild);
    const member   = await guild.members.fetch(interaction.user.id);
    if (role) {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Removed **@${roleName}** from your roles.` });
      } else {
        await member.roles.add(role);
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Added **@${roleName}** to your roles! You'll be pinged for PVP alerts and quake events.` });
      }
    } else {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Could not find the **@${roleName}** role. Ask an officer to set it up.` });
    }
  } catch (err) {
    console.warn('onb_pvp:', err?.message);
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not update your role.' }).catch(() => {});
  }
}

async function handleOnbOrganizer(interaction) {
  const { buildOrganizerEmbed } = require('./utils/onboarding');
  await interaction.reply({ embeds: [buildOrganizerEmbed()], flags: MessageFlags.Ephemeral });
}

async function handleOnbDeeps(interaction) {
  const { buildParseOverviewEmbed } = require('./utils/onboarding');
  await interaction.reply({ embeds: [buildParseOverviewEmbed()], flags: MessageFlags.Ephemeral });
}

async function handleOnbAttend(interaction) {
  const { buildAttendeeEmbed } = require('./utils/onboarding');
  await interaction.reply({ embeds: [buildAttendeeEmbed()], flags: MessageFlags.Ephemeral });
}

async function handleOnbIgnore(interaction) {
  const version = interaction.customId.replace('onb_ignore:', '');
  const { setOptedOut } = require('./utils/onboarding');
  setOptedOut(interaction.user.id, version);
  await interaction.reply({
    flags:   MessageFlags.Ephemeral,
    content: `🔕 Got it — no more revision pings. Run \`/onboarding\` any time to see what's new or get the full welcome again.`,
  });
}

async function handleOnbShowAgain(interaction) {
  const pkg = require('./package.json');
  const { removeOptOut, buildWelcomeEmbed, buildWelcomeComponents } = require('./utils/onboarding');
  removeOptOut(interaction.user.id);
  await interaction.reply({
    embeds:     [buildWelcomeEmbed()],
    components: buildWelcomeComponents(pkg.version),
    flags:      MessageFlags.Ephemeral,
  });
}

async function handleOnbShowFull(interaction) {
  const version = interaction.customId.replace('onb_show_full:', '');
  const { buildWelcomeEmbed, buildWelcomeComponents } = require('./utils/onboarding');
  await interaction.reply({
    embeds:     [buildWelcomeEmbed()],
    components: buildWelcomeComponents(version),
    flags:      MessageFlags.Ephemeral,
  });
}

async function handleWhoFamily(interaction) {
  const name = interaction.customId.replace('who_family:', '');
  const { buildWhoallEmbed } = require('./commands/whoall');
  const embed = buildWhoallEmbed(name);
  if (!embed) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Could not find family for **${name}**.` });
  }
  return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
}

// ── New member onboarding ─────────────────────────────────────────────────────
client.on(Events.GuildMemberAdd, async (member) => {
  const pkg = require('./package.json');
  const {
    isOptedOut, getLastSeenVersion, setLastSeenVersion, changesSince,
    buildWelcomeEmbed, buildWelcomeComponents,
    buildChangesEmbed, buildChangesComponents,
  } = require('./utils/onboarding');

  const userId  = member.user.id;
  const version = pkg.version;

  // Opted out (hit "Don't ping me on revisions") → no unsolicited DM. They can
  // still run /onboarding any time to see the diff or the full welcome.
  if (isOptedOut(userId)) return;

  const lastSeen = getLastSeenVersion(userId);
  const isReturning = !!lastSeen && lastSeen !== version;

  // Diff-only DM for returning members; full welcome for first-timers.
  const payload = isReturning
    ? { embeds: [buildChangesEmbed(version, lastSeen, changesSince(lastSeen))],
        components: buildChangesComponents(version) }
    : { embeds: [buildWelcomeEmbed()], components: buildWelcomeComponents(version) };

  setLastSeenVersion(userId, version);

  try {
    await member.send(payload);
  } catch {
    // DMs disabled — fall back to the onboarding thread with a mention.
    const threadId = process.env.ONBOARDING_THREAD_ID;
    if (!threadId) return;
    try {
      const thread = await member.client.channels.fetch(threadId);
      await thread.send({
        content: `👋 Welcome, ${member}! Here's ${isReturning ? 'what\'s new' : 'how to get started'}:`,
        ...payload,
      });
    } catch (err) {
      console.warn('[onboarding] GuildMemberAdd fallback failed:', err?.message);
    }
  }
});

// ── Forum suggestion listener ─────────────────────────────────────────────────
// When a new post is created in the event-suggestions forum channel, reply with
// a summary of what was detected (boss, time, date) and how to use /suggest.
client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
  if (!newlyCreated) return;
  const forumChannelId = process.env.FORUM_CHANNEL_ID || '1242116105326166057';
  if (thread.parentId !== forumChannelId) return;

  await new Promise(r => setTimeout(r, 1500));

  let starterContent = '';
  try {
    const starter = await thread.fetchStarterMessage();
    starterContent = starter?.content || '';
  } catch {}

  const { parseSuggestion } = require('./utils/suggestParser');
  const bosses = getBosses();
  const combined = `${thread.name} ${starterContent}`;
  const { matchedBosses, matchedZones, time, dateLabel } = parseSuggestion(combined, bosses);

  const { EmbedBuilder: EB } = require('discord.js');

  const detectedLines = [];
  if (matchedBosses.length) {
    const names = matchedBosses.slice(0, 5).map(b => `${b.emoji || '⚔️'} **${b.name}** (${b.zone})`);
    if (matchedBosses.length > 5) names.push(`…and ${matchedBosses.length - 5} more`);
    detectedLines.push(`🎯 **Boss/Zone:** ${names.join(', ')}`);
  } else if (matchedZones.length) {
    detectedLines.push(`📍 **Zone:** ${matchedZones.join(', ')}`);
  }
  if (time || dateLabel) {
    detectedLines.push(`🕐 **When:** ${[dateLabel, time].filter(Boolean).join(' ')}`);
  }

  const embed = new EB()
    .setColor(0x5865F2)
    .setTitle('📣 Want officers to host this?')
    .setDescription(
      detectedLines.length
        ? `I think I detected:\n${detectedLines.join('\n')}\n\nIf that looks right, use **\`/suggest\`** to send a formal request to officers!`
        : `Use **\`/suggest\`** to send a formal request to the officers — they'll be notified and can claim your event.`
    )
    .addFields({
      name: 'How to request',
      value: '1. Run `/suggest` in any channel\n2. Pick the boss from the list\n3. Enter when you want to do it\n4. Officers will see it and respond',
      inline: false,
    })
    .setFooter({ text: 'Officers can click \'I\'ll host it\' to claim your request' });

  try {
    await thread.send({ embeds: [embed] });
  } catch (err) {
    console.warn('[forum] Could not reply to new forum thread:', err?.message);
  }
});

// ── Spawn checker ──────────────────────────────────────────────────────────
const alertedSoon = new Set(), alertedSpawned = new Set();
const pvpAlertedSoon = new Set(), pvpAlertedSpawned = new Set();
const pvpAlertedWindow = new Set();      // entries whose "soon" alert has been edited to "possibly spawned"
const pvpAlertMessages = new Map();      // key → Discord message object, for in-place edits
const liveAlertedSoon = new Set(), liveAlertedSpawned = new Set();
const PVP_SOON_MS  = 30 * 60 * 1000;
const SOON_WARN_MS = 30 * 60 * 1000;

function startSpawnChecker(readyClient) {
  const channelId = process.env.TIMER_CHANNEL_ID;
  if (!channelId) { console.warn('⚠️ TIMER_CHANNEL_ID not set'); return; }

  setInterval(async () => {
    try {
      const bosses        = getBosses();
      const histThreadId  = process.env.HISTORIC_KILLS_THREAD_ID;
      const historyThread = histThreadId ? await readyClient.channels.fetch(histThreadId).catch(() => null) : null;
      const state = getAllState(), now = Date.now();

      for (const boss of bosses) {
        const entry = state[boss.id];
        if (!entry) continue;
        const remaining = entry.nextSpawn - now;
        const expansion = getBossExpansion(boss);
        const threadId  = getThreadId(expansion);

        // ── Boss has spawned ───────────────────────────────────────────────
        if (remaining <= 0 && !alertedSpawned.has(boss.id)) {
          alertedSpawned.add(boss.id);
          alertedSoon.delete(boss.id);

          // Archive zone card
          await archiveZoneCardEntry(readyClient, boss, bosses, state, historyThread);

          // Update the "soon" alert message in place to "spawned", or post new spawned msg
          const alertMsgId = getSpawnAlertMessageId(boss.id);
          const target     = threadId ? await readyClient.channels.fetch(threadId).catch(async () => await readyClient.channels.fetch(channelId)) : await readyClient.channels.fetch(channelId);
          const spawnedEmbed = buildSpawnedEmbed(boss);
          if (alertMsgId) {
            try {
              const alertMsg = await target.messages.fetch(alertMsgId);
              await alertMsg.edit({ embeds: [spawnedEmbed] });
            } catch {
              await target.send({ embeds: [spawnedEmbed] });
            }
            clearSpawnAlertMessageId(boss.id);
          } else {
            await target.send({ embeds: [spawnedEmbed] });
          }

          clearKill(boss.id);
          await postKillUpdate(readyClient, channelId, boss.id).catch(console.warn);
          console.log(`🟢 Spawned: ${boss.name}`);
          continue;
        }

        // Reset alert tracking when timer resets (new kill recorded)
        if (remaining > 30 * 60 * 1000) { alertedSpawned.delete(boss.id); alertedSoon.delete(boss.id); }

        // ── 30 min warning ─────────────────────────────────────────────────
        if (remaining > 0 && remaining <= 30 * 60 * 1000 && !alertedSoon.has(boss.id)) {
          alertedSoon.add(boss.id);
          const target = threadId ? await readyClient.channels.fetch(threadId).catch(async () => await readyClient.channels.fetch(channelId)) : await readyClient.channels.fetch(channelId);
          const sent = await target.send({ embeds: [buildSpawnAlertEmbed(boss)] });
          setSpawnAlertMessageId(boss.id, sent.id);
          console.log(`⚠️ 30min warning: ${boss.name}`);
        }
      }
      await checkQuakeAlert(readyClient).catch(console.warn);
      await checkPvpSpawns(readyClient, now).catch(console.warn);
      await checkLiveSpawns(readyClient, now).catch(console.warn);
    } catch (err) { console.error('Spawn checker error:', err); }
  }, 5 * 60 * 1000);
  console.log('Spawn checker started');
}

async function archiveZoneCardEntry(readyClient, spawnedBoss, bosses, state, historyThread) {
  const zoneCard = getZoneCard(spawnedBoss.zone);
  if (!zoneCard) return;
  try {
    const ch      = await readyClient.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
    const cardMsg = await ch.messages.fetch(zoneCard.messageId);
    if (historyThread) {
      const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: getDefaultTz() });
      await historyThread.send({ content: `📦 **${spawnedBoss.name}** (${spawnedBoss.zone}) respawned at ${ts}`, embeds: cardMsg.embeds });
    }
    const now          = Date.now();
    const stillOnTimer = bosses.filter((b) => b.zone === spawnedBoss.zone && b.id !== spawnedBoss.id && state[b.id] && state[b.id].nextSpawn > now + 5000);
    if (stillOnTimer.length > 0) {
      const killedInZone = stillOnTimer.map((b) => ({ boss: b, entry: state[b.id], killedBy: state[b.id].killedBy }));
      await cardMsg.edit({ embeds: [buildZoneKillCard(spawnedBoss.zone, killedInZone)] });
    } else {
      await cardMsg.delete(); clearZoneCard(spawnedBoss.zone);
    }
  } catch (err) { console.warn(`archiveZoneCardEntry (${spawnedBoss.name}):`, err?.message); }
}

// ── PVP spawn checker ──────────────────────────────────────────────────────
async function checkPvpSpawns(readyClient, now) {
  const kills         = getAllPvpKills();
  const killsThreadId = process.env.PVP_KILLS_THREAD_ID;
  const pvpAlertId    = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;

  for (const [key, entry] of Object.entries(kills)) {
    if (entry.timerUnknown) continue;

    const earliest  = entry.nextSpawn;
    const latest    = entry.nextSpawnLatest || (earliest * 1.5); // fallback for old entries
    const toEarliest = earliest - now;

    // Reset soon-alert if still well before the window
    if (toEarliest > PVP_SOON_MS) {
      pvpAlertedSoon.delete(key);
      pvpAlertedSpawned.delete(key);
      pvpAlertedWindow.delete(key);
      pvpAlertMessages.delete(key);
      continue;
    }

    // ── Spawning soon (30 min before earliest) ──────────────────────────────
    if (!pvpAlertedSoon.has(key)) {
      pvpAlertedSoon.add(key);
      // Suppress stale alerts: if the earliest window opened more than 10 min ago
      // (e.g. bot was offline / just redeployed), skip the notification silently.
      const stale = earliest < now - 10 * 60 * 1000;
      if (!stale && pvpAlertId) {
        try {
          const pvpRoleName = process.env.PVP_ROLE || 'PVP';
          const guild       = readyClient.guilds.cache.first();
          const pvpRole     = guild?.roles.cache.find(r => r.name === pvpRoleName);
          const mention     = pvpRole ? `<@&${pvpRole.id}>` : '';
          const ch          = await readyClient.channels.fetch(pvpAlertId);
          const { EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
          const sent = await ch.send({
            content: `${mention}⚠️ **${entry.name}** spawn window opens soon!`,
            embeds: [new EB()
              .setColor(0xffa500)
              .setTitle(`⚠️ PVP Spawn Window — ${entry.name}`)
              .addFields(
                { name: '⏰ Earliest',  value: `${discordAbsoluteTime(earliest)} (${discordRelativeTime(earliest)})`, inline: true },
                { name: '⏳ Latest',    value: `${discordAbsoluteTime(latest)} (${discordRelativeTime(latest)})`,     inline: true },
              )
              .setFooter({ text: 'The mob can spawn any time in this window.' })
              .setTimestamp(),
            ],
            components: [new ARB().addComponents(
              new BB()
                .setCustomId(`pvp_window_spawned:${key}`)
                .setLabel('✅ Mob Spawned')
                .setStyle(BS.Success)
            )],
          });
          pvpAlertMessages.set(key, sent);
        } catch (err) { console.warn('[pvp] Could not post soon alert:', err?.message); }
      }
    }

    // ── Earliest passed — edit alert to "possibly spawned" ───────────────────
    if (now >= earliest && !pvpAlertedWindow.has(key)) {
      pvpAlertedWindow.add(key);
      const alertMsg = pvpAlertMessages.get(key);
      if (alertMsg) {
        try {
          const { EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
          await alertMsg.edit({
            content: `🎯 **${entry.name}** may have spawned — check the zone!`,
            embeds: [new EB()
              .setColor(0xffd700)
              .setTitle(`🎯 PVP Possibly Spawned — ${entry.name}`)
              .addFields(
                { name: '⏰ Window Opened', value: `${discordAbsoluteTime(earliest)} (${discordRelativeTime(earliest)})`, inline: true },
                { name: '⏳ Guaranteed By', value: `${discordAbsoluteTime(latest)} (${discordRelativeTime(latest)})`,     inline: true },
              )
              .setFooter({ text: 'Mob may be up — check the zone!' })
              .setTimestamp(),
            ],
            components: [new ARB().addComponents(
              new BB()
                .setCustomId(`pvp_window_spawned:${key}`)
                .setLabel('✅ Mob Spawned')
                .setStyle(BS.Success)
            )],
          });
        } catch (err) { console.warn('[pvp] Could not edit possibly-spawned alert:', err?.message); }
      }
    }

    // ── Spawn window fully open (latest time reached) — auto-clear ──────────
    if (now < latest) continue;
    if (pvpAlertedSpawned.has(key)) continue;
    pvpAlertedSpawned.add(key);

    // Delete kill card from kills thread
    if (killsThreadId && entry.threadMessageId) {
      try {
        const thread = await readyClient.channels.fetch(killsThreadId);
        const msg    = await thread.messages.fetch(entry.threadMessageId);
        await msg.delete();
      } catch { /* already gone */ }
    }

    // Final "definitely spawned" alert — suppress if latest passed long ago (stale post-redeploy)
    const spawnedLongAgo = latest < now - 15 * 60 * 1000;
    if (!spawnedLongAgo && pvpAlertId) {
      try {
        const pvpRoleName = process.env.PVP_ROLE || 'PVP';
        const guild       = readyClient.guilds.cache.first();
        const pvpRole     = guild?.roles.cache.find(r => r.name === pvpRoleName);
        const mention     = pvpRole ? `<@&${pvpRole.id}>` : '';
        const ch          = await readyClient.channels.fetch(pvpAlertId);
        const { EmbedBuilder: EB } = require('discord.js');
        await ch.send({
          content: `${mention}🟢 **${entry.name}** spawn window has fully opened — mob is up!`,
          embeds: [new EB()
            .setColor(0x57f287)
            .setTitle(`🟢 PVP Mob Up — ${entry.name}`)
            .setDescription('Maximum spawn time reached. The mob is definitely available.\nUse `/pvpkill` to start a new timer after you engage.')
            .setTimestamp(),
          ],
        });
      } catch (err) { console.warn('[pvp] Could not post spawned alert:', err?.message); }
    }

    clearPvpKill(key);
    console.log(`🟢 PVP Spawn window closed: ${entry.name}`);
  }
}

// ── Live kill spawn checker ─────────────────────────────────────────────────
async function checkLiveSpawns(readyClient, now) {
  const kills     = getAllLiveKills();
  const channelId = process.env.LIVE_CHANNEL_ID;

  for (const [key, entry] of Object.entries(kills)) {
    if (entry.timerUnknown) continue;

    const toSpawn = entry.nextSpawn - now;

    if (toSpawn > SOON_WARN_MS) {
      liveAlertedSoon.delete(key);
      liveAlertedSpawned.delete(key);
      continue;
    }

    // ── Spawning soon ────────────────────────────────────────────────────────
    if (!liveAlertedSoon.has(key)) {
      liveAlertedSoon.add(key);
      if (channelId) {
        try {
          const { EmbedBuilder: EB } = require('discord.js');
          const ch = await readyClient.channels.fetch(channelId);
          await ch.send({
            content: `⚠️ **${entry.name}** is spawning soon!`,
            embeds: [new EB()
              .setColor(0xffa500)
              .setTitle(`⚠️ Spawning Soon — ${entry.name}`)
              .addFields({ name: 'Spawns', value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`, inline: false })
              .setTimestamp(),
            ],
          });
        } catch (err) { console.warn('[live] soon alert failed:', err?.message); }
      }
    }

    if (toSpawn > 0) continue;
    if (liveAlertedSpawned.has(key)) continue;
    liveAlertedSpawned.add(key);

    // Delete kill card
    if (channelId && entry.channelMessageId) {
      try {
        const ch  = await readyClient.channels.fetch(channelId);
        const msg = await ch.messages.fetch(entry.channelMessageId);
        await msg.delete();
      } catch { /* already gone */ }
    }

    // Spawned alert
    if (channelId) {
      try {
        const { EmbedBuilder: EB } = require('discord.js');
        const ch = await readyClient.channels.fetch(channelId);
        await ch.send({
          content: `🟢 **${entry.name}** has spawned!`,
          embeds: [new EB()
            .setColor(0x57f287)
            .setTitle(`🟢 Spawned — ${entry.name}`)
            .setDescription('Use `/livekill` or `/livehatekill` to start a new timer after the next kill.')
            .setTimestamp(),
          ],
        });
      } catch (err) { console.warn('[live] spawned alert failed:', err?.message); }
    }

    clearLiveKill(key);
    console.log(`🟢 Live spawn: ${entry.name}`);
  }
}

// ── Midnight tasks ─────────────────────────────────────────────────────────
function scheduleMidnightSummary(readyClient) {
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  const channelId       = process.env.TIMER_CHANNEL_ID;
  if (!historyThreadId) { console.warn('⚠️ HISTORIC_KILLS_THREAD_ID not set'); return; }

  function msUntilMidnightEST() {
    return msUntilMidnightInTz(getDefaultTz());
  }

  async function runMidnightTasks() {
    console.log('🕛 Midnight tasks running...');
    try {
      const historyThread = await readyClient.channels.fetch(historyThreadId).catch(() => null);
      const channel       = channelId ? await readyClient.channels.fetch(channelId).catch(() => null) : null;
      if (!historyThread) { console.warn('Cannot fetch historic kills thread'); return; }

      const bosses     = getBosses();
      const killState  = getAllState();
      // Deduplicate daily kills — keep first occurrence of each boss per day
      const seenBosses = new Set();
      const dailyKills = getDailyKills().filter(e => {
        if (seenBosses.has(e.bossId)) return false;
        seenBosses.add(e.bossId);
        return true;
      });
      const now          = Date.now();
      const availableNow = bosses.filter((b) => { const e = killState[b.id]; return !e || e.nextSpawn <= now; });

      // Format date for "Killed <Date>" header
      const dateStr = new Date().toLocaleDateString('en-US', { timeZone: getDefaultTz(), month: 'long', day: 'numeric', year: 'numeric' });
      const summaryEmbed = buildDailySummaryEmbed(dailyKills, availableNow, bosses, dateStr);

      // Update the fixed daily summary slot in main channel (edit in place)
      if (channel) {
        const dailySummaryId = getDailySummaryMessageId();
        if (dailySummaryId) {
          try { const m = await channel.messages.fetch(dailySummaryId); await m.edit({ embeds: [summaryEmbed] }); }
          catch { await channel.send({ embeds: [summaryEmbed] }); }
        } else {
          const m = await channel.send({ embeds: [summaryEmbed] });
          setDailySummaryMessageId(m.id);
        }
      }

      // Archive to historic kills thread
      await historyThread.send({ embeds: [summaryEmbed] });

      // Archive all /announce messages
      if (channel) {
        for (const msgId of getAnnounceMessageIds()) {
          try {
            const msg = await channel.messages.fetch(msgId);
            await historyThread.send({ content: `📋 **Archived announcement**`, embeds: msg.embeds, components: [] });
            await msg.delete();
          } catch (err) { console.warn(`Could not archive announce ${msgId}:`, err?.message); }
        }
      }

      // Delete all spawn alert messages (they get stale at midnight)
      for (const { bossId, messageId } of getAllSpawnAlertMessageIds()) {
        const boss     = bosses.find((b) => b.id === bossId);
        const expansion = boss ? getBossExpansion(boss) : null;
        const threadId  = expansion ? getThreadId(expansion) : null;
        try {
          const targetId = threadId || channelId;
          if (targetId) {
            const ch  = await readyClient.channels.fetch(targetId);
            const msg = await ch.messages.fetch(messageId);
            await msg.delete();
          }
        } catch {}
        clearSpawnAlertMessageId(bossId);
      }

      resetDailyKills();
      clearAnnounceMessageIds();
      clearRaidNight();
      // Clear agent test thread tracking — fresh state for the new night
      clearAgentTestCards();
      _liveCards.clear();
      clearAgentSessionCardId();
      clearAgentActivity();
      clearPetOwners();
      clearAllPendingLoot();

      // ── Archive passed announce threads ─────────────────────────────────
      await archivePassedAnnounceThreads(readyClient);

      // ── PVP midnight post ────────────────────────────────────────────────
      await postPvpMidnightSummary(readyClient);

      // ── Archive raid night parse thread ──────────────────────────────────
      await archiveRaidSession(readyClient);

      // ── Consolidate nightly parses ───────────────────────────────────────
      await consolidateNightlyParses(readyClient).catch(console.error);

      // ── Compact Supabase contributions (null out raw_parse blobs > 7 days) ─
      // encounter_players already holds the merged per-player totals permanently.
      // The contributions.raw_parse JSONB blobs are only needed for debugging
      // recent encounters; after 7 days they're just storage cost with no query value.
      // combat_events is intentionally not written to (schema exists for future use).
      try {
        const supabase = require('./utils/supabase');
        if (supabase.isEnabled()) {
          const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const result = await supabase.update(
            'contributions',
            `created_at=lt.${encodeURIComponent(cutoff)}&raw_parse=not.is.null`,
            { raw_parse: null },
          );
          console.log('[midnight] compacted contributions.raw_parse older than 7 days');
        }
      } catch (err) {
        console.warn('[midnight] contribution compaction skipped:', err?.message);
      }

      console.log('✅ Midnight tasks complete');
    } catch (err) { console.error('Midnight task error:', err); }
    setTimeout(runMidnightTasks, msUntilMidnightEST());
  }

  const delay = msUntilMidnightEST();
  console.log(`🕛 Midnight scheduled in ${Math.round(delay / 1000 / 60)} min`);
  setTimeout(runMidnightTasks, delay);
}

// ── Archive passed announce threads at midnight ────────────────────────────
async function archivePassedAnnounceThreads(readyClient) {
  const archiveChannelId = process.env.ARCHIVE_CHANNEL_ID;
  const announces        = getAllAnnounces();
  const now              = Date.now();

  for (const [msgId, data] of Object.entries(announces)) {
    if (!data.plannedTimeMs || data.plannedTimeMs > now) continue; // not yet passed

    // Post summary to Archive channel if configured
    if (archiveChannelId) {
      try {
        const { EmbedBuilder } = require('discord.js');
        const archiveCh = await readyClient.channels.fetch(archiveChannelId);
        const targetNames = (data.targets || [])
          .filter(t => !t.startsWith('_'))
          .map(tid => {
            delete require.cache[require.resolve('./data/bosses.json')];
            const b = require('./data/bosses.json').find(b => b.id === tid);
            return b ? `${b.emoji || '⚔️'} ${b.name}` : tid;
          });

        const embed = new EmbedBuilder()
          .setColor(0x555555)
          .setTitle(`📦 Archived Raid Event — ${data.zone || 'Unknown'}`)
          .addFields(
            { name: 'Planned Time', value: data.plannedTimeStr || 'Unknown', inline: true },
            { name: 'Organizer',    value: data.organizer ? `<@${data.organizer}>` : 'Unknown', inline: true },
            { name: 'Targets',      value: targetNames.length ? targetNames.join(', ') : 'None', inline: false },
          )
          .setTimestamp();
        await archiveCh.send({ embeds: [embed] });
      } catch (err) { console.warn(`archivePassedAnnounceThreads: could not post to archive channel:`, err?.message); }
    }

    // Archive/delete the announce thread
    if (data.threadId) {
      try {
        const thread = await readyClient.channels.fetch(data.threadId);
        if (thread && !thread.archived) {
          await thread.setArchived(true, 'Raid event passed midnight');
        }
      } catch (err) { console.warn(`archivePassedAnnounceThreads: could not archive thread ${data.threadId}:`, err?.message); }
    }

    // Remove from active announces
    removeAnnounce(msgId);
    removeAnnounceMessageId(msgId);
  }
}

// ── Archive raid night parse thread at midnight ───────────────────────────────
async function archiveRaidSession(readyClient) {
  const session = getRaidSession();
  if (!session) return;

  const archiveChannelId = process.env.RAID_MOBS_ARCHIVE_CHANNEL_ID;
  try {
    const thread = await readyClient.channels.fetch(session.threadId).catch(() => null);
    if (thread) {
      await thread.send({ content: `📦 **Archived** — ${session.label}. Parses saved to history.` }).catch(() => {});
      await thread.setArchived(true, 'Raid night ended at midnight').catch(() => {});
    }

    if (archiveChannelId) {
      const archiveCh = await readyClient.channels.fetch(archiveChannelId).catch(() => null);
      if (archiveCh && thread) {
        await archiveCh.send({
          content: `📋 **${session.label}** parse thread archived → <#${session.threadId}>`,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[raidnight] archiveRaidSession error:', err?.message);
  }

  clearRaidSession();
}

// ── PVP midnight summary ────────────────────────────────────────────────────
async function postPvpMidnightSummary(readyClient) {
  const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  if (!pvpTargetId) return;
  try {
    const kills     = getAllPvpKills();
    const now       = Date.now();
    const in24h     = now + 24 * 3600000;
    const spawning  = Object.values(kills).filter(e => e.nextSpawn > now && e.nextSpawn <= in24h);
    if (spawning.length === 0) return; // nothing to post

    const { EmbedBuilder } = require('discord.js');
    const { discordAbsoluteTime, discordRelativeTime } = require('./utils/timer');
    const lines = spawning
      .sort((a, b) => a.nextSpawn - b.nextSpawn)
      .map(e => `• **${e.name}** — ${discordAbsoluteTime(e.nextSpawn)} (${discordRelativeTime(e.nextSpawn)})`);

    const embed = new EmbedBuilder()
      .setColor(0xcc0000)
      .setTitle('🗡️ PVP Mobs Spawning Today')
      .setDescription(lines.join('\n'))
      .setTimestamp();

    const ch = await readyClient.channels.fetch(pvpTargetId);
    await ch.send({ embeds: [embed] });
  } catch (err) { console.warn('PVP midnight summary error:', err?.message); }
}

// ── Quake alert checker (runs inside spawn checker interval) ───────────────
async function checkQuakeAlert(readyClient) {
  const quake = getQuake();
  if (!quake || quake.alertPosted) return;

  const remaining = quake.scheduledTime - Date.now();
  if (remaining > 60 * 60 * 1000) return; // more than 1h away — wait
  if (remaining <= 0) { clearQuake(); return; } // already passed

  // Post 1-hour warning
  const { EmbedBuilder } = require('discord.js');
  const { discordAbsoluteTime, discordRelativeTime } = require('./utils/timer');
  const { formatInDefaultTz } = require('./utils/timezone');

  const embed = new EmbedBuilder()
    .setColor(0xff4500)
    .setTitle('⚠️ Quake in ~1 Hour — PVP Mobs Reset Soon!')
    .setDescription(
      `An EverQuest quake is approaching.\nAll PVP mob respawn timers will reset ${discordRelativeTime(quake.scheduledTime)}.`
    )
    .addFields({ name: 'Quake Time', value: `${discordAbsoluteTime(quake.scheduledTime)} (${discordRelativeTime(quake.scheduledTime)})`, inline: false })
    .setTimestamp();

  const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  const pvpRoleName = process.env.PVP_ROLE || 'PVP';

  try {
    const guild   = readyClient.guilds.cache.first();
    const roleObj = guild?.roles.cache.find(r => r.name === pvpRoleName);
    const mention = roleObj ? `<@&${roleObj.id}>` : null;

    if (pvpTargetId) {
      const ch = await readyClient.channels.fetch(pvpTargetId);
      const m  = await ch.send({ content: mention || undefined, embeds: [embed] });
      saveQuake({ ...quake, alertPosted: true, alertMessageId: m.id });
    }
  } catch (err) { console.warn('Quake alert error:', err?.message); }
}

// ── Nightly parse consolidation ────────────────────────────────────────────────
async function consolidateNightlyParses(client) {
  const { loadParses, saveParses, logParseToDiscord } = require('./commands/parse');
  const { groupKillsBySession, mergeKillGroup }        = require('./commands/parsestats');

  const allParses = loadParses();
  const now       = Date.now();
  const since24h  = now - 24 * 60 * 60 * 1000;

  let consolidated = false;

  for (const [bossId, kills] of Object.entries(allParses)) {
    // Only look at kills from the last 24 hours
    const recent = kills.filter(k => k.timestamp >= since24h);
    if (recent.length === 0) continue;

    // Group by 10-minute session windows
    const groups = groupKillsBySession(recent, 10 * 60 * 1000);

    const newKills = [...kills.filter(k => k.timestamp < since24h)]; // keep older kills untouched

    for (const group of groups) {
      if (group.length <= 1) {
        // Single submission — keep as-is
        newKills.push(...group);
        continue;
      }

      // Multiple submissions in same session window — merge them
      const merged = mergeKillGroup(group);

      // Delete individual Discord log messages for entries in this group
      const logThreadId = process.env.PARSES_LOG_THREAD_ID;
      if (logThreadId) {
        const logThread = await client.channels.fetch(logThreadId).catch(() => null);
        if (logThread) {
          for (const entry of group) {
            if (entry.discordMsgId) {
              try {
                const msg = await logThread.messages.fetch(entry.discordMsgId);
                await msg.delete();
              } catch {}
            }
          }
        }
      }

      // Use one of the existing entries as the base for the merged parse entry
      const canonical = group.reduce((best, k) => k.totalDamage > best.totalDamage ? k : best, group[0]);
      const mergedEntry = {
        timestamp:       merged.timestamp,
        submittedBy:     canonical.submittedBy || null,
        submittedByName: canonical.submittedByName || 'consolidated',
        duration:        merged.duration,
        totalDamage:     merged.totalDamage,
        totalDps:        merged.duration > 0 ? Math.round(merged.totalDamage / merged.duration) : 0,
        players:         merged.players,
        discordMsgId:    null, // will be set after logging
      };

      // Post ONE consolidated log entry
      const msg = await logParseToDiscord(client, bossId, mergedEntry).catch(() => null);
      if (msg?.id) mergedEntry.discordMsgId = msg.id;

      newKills.push(mergedEntry);
      consolidated = true;
    }

    allParses[bossId] = newKills;
  }

  if (consolidated) {
    saveParses(allParses);
    console.log('[consolidate] Nightly parse consolidation complete');
  } else {
    console.log('[consolidate] No parse groups to consolidate');
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────
// Health check (Railway proxy needs an HTTP listener) + endpoints for the
// wolfpack-logsync local agent.
const http = require('http');

// ── Guild/raid chat relay dedup cache ─────────────────────────────────────────
// Multiple parsers watching the same raid will all see the same chat lines.
// Keep a 5-second fingerprint cache so each unique message posts to Discord once.
const _chatDedup = new Map(); // key: "channel|speaker|text" → timestamp
setInterval(() => {
  const cutoff = Date.now() - 5000;
  for (const [k, v] of _chatDedup) if (v < cutoff) _chatDedup.delete(k);
}, 10_000);

// ── Era boundaries for chat thread routing ─────────────────────────────────
// Each chat message is routed to the era thread matching its timestamp.
// Set <CHANNEL>_CHAT_<ERA>_THREAD_ID env vars to enable era threading;
// any unset thread falls back to the main GUILD_CHAT_CHANNEL_ID / RAID_CHAT_CHANNEL_ID.
//
// Era starts (Quarm progression):
//   Classic        — Oct 1, 2023
//   Kunark         — Jul 1, 2024
//   Velious        — Apr 1, 2025
//   Luclin         — Oct 1, 2025
//   Planes of Power — Oct 1, 2026
const ERA_BOUNDARIES = [
  // Descending order — first match wins
  { thresholdMs: Date.UTC(2026, 9, 1), era: 'PoP',     key: 'POP'     },
  { thresholdMs: Date.UTC(2025, 9, 1), era: 'Luclin',  key: 'LUCLIN'  },
  { thresholdMs: Date.UTC(2025, 3, 1), era: 'Velious', key: 'VELIOUS' },
  { thresholdMs: Date.UTC(2024, 6, 1), era: 'Kunark',  key: 'KUNARK'  },
  { thresholdMs: 0,                    era: 'Classic', key: 'CLASSIC' },
];

function getEraForTimestamp(ts) {
  const ms = ts instanceof Date ? ts.getTime()
            : typeof ts === 'string' ? Date.parse(ts)
            : typeof ts === 'number' ? ts
            : NaN;
  if (!ms || isNaN(ms)) return ERA_BOUNDARIES[0];
  for (const b of ERA_BOUNDARIES) {
    if (ms >= b.thresholdMs) return b;
  }
  return ERA_BOUNDARIES[ERA_BOUNDARIES.length - 1];
}

function getChatThreadId(channel, eraKey) {
  // channel: 'guild' | 'raid' | 'pvp'
  // eraKey:  'CLASSIC' | 'KUNARK' | 'VELIOUS' | 'LUCLIN' | 'POP'
  const envName = `${channel.toUpperCase()}_CHAT_${eraKey}_THREAD_ID`;
  return process.env[envName] || null;
}

// "Current era" = whatever era we're in right now (based on system clock).
// Messages from the current era go to the main channel, NOT the era thread.
// When the next era starts, old current-era content stops posting to main and
// starts routing to its reserved thread automatically.
function getCurrentEra() {
  return getEraForTimestamp(Date.now());
}

// Fire-and-forget — log every agent upload to Supabase agent_uploads so the
// /admin/agents board (and /me upload panel) can show who is uploading what,
// when, on what version. Best-effort: failures are warned and swallowed so
// the upload response is never blocked on the metadata insert.
function _trackUpload({ endpoint, character, agentVersion, ok = true, statusCode = 200, errorMessage = null, payloadBytes = null, agentState = null }) {
  try {
    const supabase = require('./utils/supabase');
    if (!supabase.isEnabled()) return;
    supabase.insert('agent_uploads', [{
      guild_id:      process.env.SUPABASE_GUILD_ID || 'wolfpack',
      character:     character || null,
      agent_version: agentVersion || null,
      endpoint,
      payload_bytes: payloadBytes,
      ok,
      status_code:   statusCode,
      error_message: errorMessage,
      agent_state:   agentState,
    }]).catch(err => console.warn('[agent-uploads] insert failed:', err?.message));
  } catch (err) {
    console.warn('[agent-uploads] track failed:', err?.message);
  }
}

async function _handleAgentChat(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'chat relay disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 256 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'payload too large' }));
    }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid JSON' }));
  }

  const messages = payload?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, posted: 0 }));
  }

  const guildChId = process.env.GUILD_CHAT_CHANNEL_ID;
  const raidChId  = process.env.RAID_CHAT_CHANNEL_ID;
  let posted = 0;
  // Mirror every relayed chat line into chat_messages so the historical
  // record builds up live, not just via the agent's --since backfill.
  // Same dedup as the Discord-side path (speaker + text + 5s window) but
  // also backed by the chat_messages_dedup unique index for safety.
  const supabaseChatRows = [];

  // Sanitize chat text before posting to Discord:
  //   - Strip @everyone / @here — would ping the entire server/channel
  //   - Strip all @mentions (<@id>, <@!id>, <#id>, <@&id>) — role/user/channel pings
  //   - Strip backticks — prevents code-block injection that can swallow subsequent lines
  //   - Truncate to 400 chars — EQ chat is typically <100 chars; 400 is generous
  function sanitizeChatText(raw) {
    return String(raw || '')
      .replace(/@(everyone|here)\b/gi, '[@$1]')        // neutralise mass pings
      .replace(/<@[!&]?\d+>/g, '[mention]')             // neutralise user/role pings
      .replace(/<#\d+>/g, '[channel]')                  // neutralise channel links
      .replace(/`/g, 'ˋ')                          // replace backtick with modifier letter grave
      .replace(/\\/g, '\\\\')                           // escape stray backslashes
      .slice(0, 400)
      .trim();
  }

  // EQ item link → PQDI markdown link. Handles both the raw \x12-delimited form
  // and the Discord-stripped form (where 0x12 control chars were eaten upstream,
  // leaving "0022194A Lucid Shard" — 7 hex chars then an item-cased name).
  //
  // The 7-char Quarm blob is <1 version><5 hex item ID><1 flag>. We slice past
  // the version byte if it looks like 0/1, otherwise we read from offset 0.
  const EQ_ITEM_LINK_RX     = /\x12([0-9A-Fa-f]{5,})\x12([^\x12]+)\x12/g;
  const EQ_STRIPPED_LINK_RX = /\b([0-9A-F]{7})((?:A |An |The )?[A-Z][a-z`'\-]+(?: (?:[a-z]{1,3} )*[A-Z][a-z`'\-]+){0,6})\b/g;
  function _itemIdFromBlob(blob) {
    const startIdx = (blob[0] === '0' || blob[0] === '1') && blob.length >= 6 ? 1 : 0;
    const id = parseInt(blob.slice(startIdx, startIdx + 5), 16);
    return (Number.isFinite(id) && id > 0 && id <= 999999) ? id : null;
  }
  function linkifyEqItems(text) {
    if (!text) return text;
    let out = text;
    if (out.indexOf('\x12') !== -1) {
      out = out.replace(EQ_ITEM_LINK_RX, (_, blob, name) => {
        if (/[\[\]()]/.test(name)) return name;
        const id = _itemIdFromBlob(blob);
        // Bare URL in angle brackets — Discord auto-linkifies and `<>` suppresses
        // the embed preview, more obvious to click than masked-link syntax.
        return id ? `${name} <https://www.pqdi.cc/item/${id}>` : name;
      }).replace(/\x12/g, '');
    }
    out = out.replace(EQ_STRIPPED_LINK_RX, (match, blob, name) => {
      if (/[\[\]()]/.test(name)) return match;
      const id = _itemIdFromBlob(blob);
      return id ? `${name} <https://www.pqdi.cc/item/${id}>` : match;
    });
    // Final fallback: some EQ clients write item names to the log WITHOUT the
    // hex-blob metadata at all. Match recognized item names against the PQDI
    // name → id snapshot so they still get linkified.
    try {
      const itemNameDb = require('./utils/itemNameDb');
      if (itemNameDb.size() > 0) out = itemNameDb.linkifyByName(out);
    } catch { /* db missing — silently skip */ }
    return out;
  }

  for (const msg of messages) {
    const { channel, speaker, text, ts: msgTs, who: uploadedWho } = msg || {};
    if (!channel || !speaker || !text) continue;

    // Era-aware routing:
    //   - Messages from the CURRENT era go to the main channel (in order)
    //   - Messages from PAST eras go to that era's reserved thread
    // When a new era starts, today's "current" becomes yesterday's past and its
    // content automatically routes to the matching era thread.
    const era       = getEraForTimestamp(msgTs);
    const current   = getCurrentEra();
    const fallback  = channel === 'guild' ? guildChId : channel === 'raid' ? raidChId : null;
    const channelId = era.key === current.key
      ? fallback                                          // current era → main channel
      : (getChatThreadId(channel, era.key) || fallback);  // past era → thread (or main if unset)
    if (!channelId) continue; // channel not configured — silently skip

    // Dedup: same speaker + text within 5s = multiple parsers saw same line
    const key = `${channel}|${speaker.toLowerCase()}|${text}`;
    if (_chatDedup.has(key)) continue;
    _chatDedup.set(key, Date.now());

    // Stage for chat_messages upsert. Same shape as historical_chat path so
    // the table has one canonical row format regardless of ingestion route.
    supabaseChatRows.push({
      guild_id:    process.env.SUPABASE_GUILD_ID || 'wolfpack',
      ts:          msgTs || new Date().toISOString(),
      channel,
      speaker,
      text:        String(text).slice(0, 2000),
      who:         uploadedWho || null,
      uploaded_by: payload?.uploaded_by || null,
    });

    // Class/level tag: try server-side whoData first, fall back to what the agent sent
    const { getWhoEntry } = require('./utils/state');
    const whoEntry = getWhoEntry(speaker) || uploadedWho || null;
    const whoTag   = whoEntry
      ? ` [${[whoEntry.level, whoEntry.race, whoEntry.class].filter(Boolean).join(' ')}]`
      : '';

    try {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch) continue;
      // Format matches Quarm's #ingame-general style:  "**Name** [60 Race Class]: message"
      // Both speaker name and text are sanitized — no @pings, no code-block injection.
      const safeSpeaker = sanitizeChatText(speaker).replace(/\*/g, '');  // strip bold markers from name
      // Sanitize FIRST (strips control chars, pings) then linkify items.
      // Order matters: if we linkified first the sanitizer's backslash-doubling
      // could break our markdown URLs (URLs have no backslashes so this is just
      // belt-and-suspenders).
      const safeText    = linkifyEqItems(sanitizeChatText(text));
      await ch.send(`**${safeSpeaker}**${whoTag}: ${safeText}`);
      posted++;
    } catch (err) {
      console.warn(`[chat-relay] failed to post to ${channel}:`, err?.message);
    }
  }

  // Best-effort Supabase mirror — fail-open if disabled or upsert errors.
  if (supabaseChatRows.length > 0) {
    try {
      const supabase = require('./utils/supabase');
      if (supabase.isEnabled()) {
        await supabase.upsert('chat_messages', supabaseChatRows, 'guild_id,ts,channel,speaker,text')
          .catch(err => console.warn('[chat-relay] supabase upsert failed:', err?.message));
      }
    } catch (err) {
      console.warn('[chat-relay] supabase mirror failed:', err?.message);
    }
  }

  _trackUpload({ endpoint: 'chat', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, posted }));
}

// ── PVP broadcast relay ────────────────────────────────────────────────────
// Receives PVP Druzzil Ro broadcasts from the agent and routes them to
// PVP_CHANNEL_ID (or PVP_THREAD_ID).  Kill-type logic:
//   pvp + killerGuild === Wolf Pack → celebratory post with Howl button
//   pvp + victimGuild === Wolf Pack → backup alert with @PVP role ping
//   npc (or other)                 → plain death notice
const WP_GUILD_NAME = process.env.PVP_GUILD_NAME || 'Wolf Pack';

// Dedup cache: when multiple parsers see the same Druzzil Ro broadcast,
// each uploads it independently. Key on second-granular timestamp + text
// so we only post each unique broadcast once. 5-min TTL is plenty since
// real duplicate kills of the same player by the same mob in the same
// zone never happen within 5 min.
const _recentPvpBroadcasts = new Map();
function _pvpDedupKey(b) {
  const sec = b?.ts ? new Date(b.ts).toISOString().slice(0, 19) : '';
  return `${sec}|${b?.text || ''}`;
}
function _isPvpDupe(b) {
  const now = Date.now();
  for (const [k, exp] of _recentPvpBroadcasts) {
    if (exp < now) _recentPvpBroadcasts.delete(k);
  }
  const key = _pvpDedupKey(b);
  if (_recentPvpBroadcasts.has(key)) return true;
  _recentPvpBroadcasts.set(key, now + 5 * 60_000);
  return false;
}

// Note: earlier versions had a rate-limited "@PVP fyi-ping" on non-WP
// deaths plus a raid-window suppressor. Per Dant's feedback ("don't like
// getting a ping every kill"), all non-WP-involvement events now post
// silently as plain death notices. Pings are reserved for Wolf Pack kills
// + Wolf Pack deaths only.

async function _handleAgentPvp(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'pvp relay disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const broadcasts = Array.isArray(payload?.broadcasts) ? payload.broadcasts : [];
  if (broadcasts.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, posted: 0 }));
  }

  const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  if (!pvpTargetId) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, posted: 0, note: 'PVP_CHANNEL_ID unset' }));
  }

  const { buildHowlRow } = require('./commands/pvpalert');
  const pvpRoleName = process.env.PVP_ROLE || 'PVP';

  let posted = 0, deduped = 0;
  // PvP kill ledger rows accumulated this request, upserted to pvp_kills
  // after the post loop. Only player-vs-player kills where Wolf Pack is
  // involved on either side are recorded (our kills + our deaths); Zek-vs-
  // other-guild noise is not. Pet attribution: if the killer is a known pet
  // (state petOwners map), credit the owner and flag via_pet.
  const pvpKillRows = [];
  const _petOwners = (() => { try { return getPetOwners() || {}; } catch { return {}; } })();
  // Roster harvest from the broadcast bodies. Every PvP kill names two
  // characters and their guilds; that's free who-data we wouldn't otherwise
  // see (Zek members never run /who for us). Build whoData rows for any
  // non-WP names + guilds, merge into state.whoData (mergeWhoData auto-flags
  // anyone whose guild is literally "Zek"), and mirror to Supabase
  // who_observations so /whois and the web app pick them up.
  const harvestedRows = [];
  for (const b of broadcasts) {
    const nowIso = b?.ts || new Date().toISOString();
    for (const side of ['victim', 'killer']) {
      const name  = b?.[side];
      const guild = b?.[`${side}Guild`];
      if (!name || !guild) continue;
      if (guild === WP_GUILD_NAME) continue;     // skip our own members
      harvestedRows.push({
        name,
        guild,
        observedAt: nowIso,
        // class/level/race left null — PvP broadcasts don't carry them.
      });
    }
  }
  if (harvestedRows.length > 0) {
    try { mergeWhoData(harvestedRows); } catch {}
    try {
      const supabase = require('./utils/supabase');
      if (supabase.isEnabled()) {
        const rows = harvestedRows.map(w => ({
          guild_id:    process.env.SUPABASE_GUILD_ID || 'wolfpack',
          character:   w.name,
          level:       null,
          race:        null,
          class:       null,
          guild_name:  w.guild,
          anonymous:   false,
          gm:          false,
          observed_at: new Date(w.observedAt).toISOString(),
          uploaded_by: 'pvp-relay',
        }));
        supabase.upsert('who_observations', rows, 'guild_id,character,observed_minute,uploaded_by')
          .catch(err => console.warn('[pvp-relay] who-obs upsert failed:', err?.message));
      }
    } catch (err) {
      console.warn('[pvp-relay] supabase mirror failed:', err?.message);
    }
  }

  for (const b of broadcasts) {
    if (_isPvpDupe(b)) { deduped++; continue; }
    const { killType, victim, victimGuild, killer, killerGuild, zone, text } = b || {};
    try {
      const ch = await client.channels.fetch(pvpTargetId).catch(() => null);
      if (!ch) continue;

      // True PvP requires BOTH sides to have a real player guild. Druzzil Ro
      // broadcasts NPC kills with empty/null/<null> victim guilds — those
      // should never trigger AWROOOO celebrations or backup-requested pings
      // even when a Wolf Pack member is the killer (e.g. "Adiwen killed
      // Lord of Ire of <null>"). The plain death-notice fallback handles
      // them as informational posts.
      const _hasRealGuild = (g) => typeof g === 'string' && g.length > 0 && g.toLowerCase() !== 'null' && g !== '<>' && g.toLowerCase() !== '<null>';
      const isWpKill   = killType === 'pvp' && killerGuild === WP_GUILD_NAME && _hasRealGuild(victimGuild);
      const isWpDeath  = killType === 'pvp' && victimGuild === WP_GUILD_NAME && _hasRealGuild(killerGuild);

      // Record the kill to the PvP ledger (player-vs-player, WP involved).
      if (killType === 'pvp' && (isWpKill || isWpDeath) && killer && victim) {
        const owners = _petOwners[String(killer).toLowerCase()];
        const viaPet = Array.isArray(owners) && owners.length > 0;
        const creditedKiller = viaPet ? owners[0] : killer;
        const killedAt = b?.ts ? new Date(b.ts) : new Date();
        const secondIso = killedAt.toISOString().slice(0, 19);
        const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
        pvpKillRows.push({
          guild_id:     guildId,
          killer:       creditedKiller,
          killer_guild: killerGuild || null,
          victim,
          victim_guild: victimGuild || null,
          zone:         zone || null,
          via_pet:      viaPet,
          pet_name:     viaPet ? killer : null,
          killed_at:    killedAt.toISOString(),
          source:       b?.backfill ? 'log_backfill' : 'pvp_channel',
          raw_text:     (text || '').slice(0, 300),
          dedup_key:    `${guildId}|${String(creditedKiller).toLowerCase()}|${String(victim).toLowerCase()}|${secondIso}`,
        });
      }

      let content;
      if (isWpKill) {
        // Celebrate — Wolf Pack got a PvP kill
        content = `⚔️ **${killer}** of <${killerGuild}> killed **${victim}** of <${victimGuild}> in ${zone}! AWROOOO!`;
      } else if (isWpDeath) {
        // Request backup — Wolf Pack member was killed
        const pvpRole = ch.guild?.roles.cache.find(r => r.name === pvpRoleName);
        const mention = pvpRole ? `<@&${pvpRole.id}> ` : '';
        content = `${mention}💀 **${victim}** of <${victimGuild}> was killed by **${killer}** of <${killerGuild}> in ${zone}! Backup requested!`;
      } else {
        // NPC kill or other-guild kill — informational only, NO @PVP
        // mention regardless of raid window or cooldown. Pings are
        // reserved for events where Wolf Pack is actually involved
        // (our kill or our death); anything else is just a death notice
        // people can scroll past. ("Hmm don't like getting a ping every
        // kill" — Dant, 2026-06-01)
        content = `☠️ ${text}`;
      }

      const sent = await ch.send({ content });

      // Attach Howl button only when Wolf Pack is involved (either side).
      // PvP kills between two non-WP guilds are visible to us via /pvp
      // channel chatter but there's nothing to celebrate or rally to.
      if (isWpKill || isWpDeath) {
        await sent.edit({ content, components: [buildHowlRow(sent.id)] });
      }
      posted++;
    } catch (err) {
      console.warn('[pvp-relay] failed to post:', err?.message);
    }
  }

  // Persist the PvP kill ledger. Idempotent via dedup_key so multi-parser
  // uploads of the same broadcast collapse to one row.
  if (pvpKillRows.length > 0) {
    try {
      const supabase = require('./utils/supabase');
      if (supabase.isEnabled()) {
        await supabase.upsert('pvp_kills', pvpKillRows, 'dedup_key')
          .catch(err => console.warn('[pvp-relay] pvp_kills upsert failed:', err?.message));
      }
    } catch (err) {
      console.warn('[pvp-relay] pvp_kills persist wrap failed:', err?.message);
    }
  }

  _trackUpload({ endpoint: 'pvp', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, posted, deduped, kills_recorded: pvpKillRows.length }));
}

// ── Druzzil Ro boss-kill auto-timer ───────────────────────────────────────
// Receives instance kill announcements from the agent.  For each:
//   1. Match boss name against bosses.json (by name or nickname)
//   2. Record kill + trigger full postKillUpdate refresh
//   3. Post human-readable confirmation to RAID_CHAT_CHANNEL_ID with next-spawn time
async function _handleAgentBossKill(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'boss-kill relay disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const kills = Array.isArray(payload?.kills) ? payload.kills : [];
  if (kills.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, set: 0 }));
  }

  const { recordKill } = require('./utils/state');
  const { postKillUpdate } = require('./utils/killops');
  const { discordRelativeTime } = require('./utils/timer');
  const channelId  = process.env.TIMER_CHANNEL_ID;
  const raidChId   = process.env.RAID_CHAT_CHANNEL_ID;

  let set = 0;
  for (const kill of kills) {
    const { character, guild, boss: bossName, zone, ts } = kill || {};
    if (!bossName) continue;

    delete require.cache[require.resolve('./data/bosses.json')];
    const bosses = require('./data/bosses.json');
    const nameLower = bossName.toLowerCase();
    const boss = bosses.find(b =>
      b.name.toLowerCase() === nameLower ||
      (b.nicknames || []).some(n => n.toLowerCase() === nameLower)
    );

    const killedAt = ts ? Date.parse(ts) : Date.now();

    if (boss) {
      // Record kill and refresh all tracker cards
      recordKill(boss.id, boss.timerHours, character, killedAt);
      const nextSpawn = killedAt + boss.timerHours * 3600000;
      if (channelId) {
        postKillUpdate(client, channelId, boss.id).catch(e =>
          console.warn('[bosskill] postKillUpdate error:', e?.message));
      }
      // Announce in raid channel with next-spawn time
      if (raidChId) {
        try {
          const ch = await client.channels.fetch(raidChId).catch(() => null);
          if (ch) {
            await ch.send(
              `⚔️ **${character}** of <${guild}> killed **${boss.name}** in ${zone} — ` +
              `next spawn ${discordRelativeTime(nextSpawn)} ✅`
            );
          }
        } catch (err) { console.warn('[bosskill] raid-channel post error:', err?.message); }
      }
      set++;
    } else {
      // Boss not in database — still post to raid channel as FYI
      if (raidChId) {
        try {
          const ch = await client.channels.fetch(raidChId).catch(() => null);
          if (ch) {
            await ch.send(
              `⚔️ **${character}** of <${guild}> killed **${bossName}** in ${zone} ` +
              `*(not in timer database — use \`/addboss\` to add it)*`
            );
          }
        } catch (err) { console.warn('[bosskill] raid-channel post error:', err?.message); }
      }
    }
  }

  _trackUpload({ endpoint: 'bosskill', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, set }));
}

// ── /sll lockout relay ─────────────────────────────────────────────────────
// Receives parsed /sll output from the agent.  RULE: "Available" entries are
// silently ignored — they mean THIS character has no lockout, but the guild
// ── Historical chat ingestion ─────────────────────────────────────────────
// Receives batches of guild/raid chat lines from the agent's [O] backfill flow.
// Store-only: writes to data/historical_chat.jsonl (append-only) and best-effort
// inserts into the Supabase chat_messages table. Does NOT relay to Discord —
// that's the job of the live /api/agent/chat endpoint.
//
// The JSONL store is the canonical record; Supabase is for SQL queries.
const HISTORICAL_CHAT_PATH = require('path').join(__dirname, 'data', 'historical_chat.jsonl');

// ── Fun-events ingestion ────────────────────────────────────────────────────
// Receives tagged "just for fun" occurrences (Peopleslayer LD counter,
// future CoH/DI/Aegolism/Rune) and upserts into the fun_events Supabase
// table. The table's unique constraint on (guild_id, event_type, caster,
// event_ts) makes backfill replays idempotent — re-running the same opt-in
// log just hits on-conflict-do-nothing and ends up with no double-count.
async function _handleAgentFunEvent(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'fun-events disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 256 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const events = Array.isArray(payload?.events) ? payload.events : [];
  if (events.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, written: 0 }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, written: 0, note: 'supabase disabled' }));
  }

  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const rows = events
    .filter(e => e && e.type && e.ts)
    .map(e => ({
      guild_id:    guildId,
      event_ts:    new Date(e.ts).toISOString(),
      event_type:  String(e.type),
      caster:      e.caster || null,
      target:      e.target || null,
      reagent_qty: Number.isFinite(e.reagent_qty) ? e.reagent_qty : 1,
      raw_text:    e.raw_text || null,
    }));
  if (rows.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, written: 0 }));
  }
  const written = await supabase.upsert('fun_events', rows, 'guild_id,event_type,caster,event_ts')
    .catch(err => { console.warn('[fun-event] upsert failed:', err?.message); return null; });
  _trackUpload({ endpoint: 'fun_event', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, written: Array.isArray(written) ? written.length : 0 }));
}

async function _handleAgentHistoricalChat(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'historical chat disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 4 * 1024 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (messages.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, stored: 0 }));
  }

  // Append to JSONL — best-effort, fail open
  const fsmod = require('fs');
  const lines = messages
    .filter(m => m && m.channel && m.speaker && m.text && m.ts)
    .map(m => JSON.stringify({
      ts:       m.ts,
      channel:  m.channel,
      speaker:  m.speaker,
      text:     m.text,
      who:      m.who || null,
      uploaded_by: m.uploadedBy || null,
    }));

  if (lines.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, stored: 0 }));
  }

  try {
    fsmod.appendFileSync(HISTORICAL_CHAT_PATH, lines.join('\n') + '\n', 'utf8');
  } catch (err) {
    console.warn('[historical-chat] JSONL append failed:', err?.message);
  }

  // Best-effort Supabase mirror
  try {
    const supabase = require('./utils/supabase');
    if (supabase.isEnabled()) {
      const rows = lines.map((_, i) => {
        const m = messages.filter(x => x && x.channel && x.speaker && x.text && x.ts)[i];
        return {
          ts:          m.ts,
          channel:     m.channel,
          speaker:     m.speaker,
          text:        m.text.slice(0, 2000),
          who:         m.who || null,
          uploaded_by: m.uploadedBy || null,
          guild_id:    process.env.SUPABASE_GUILD_ID || 'wolfpack',
        };
      });
      // upsert with on_conflict so re-runs of the same backfill don't double-count.
      // The chat_messages table needs a UNIQUE (guild_id, ts, channel, speaker, text) index.
      await supabase.upsert('chat_messages', rows, 'guild_id,ts,channel,speaker,text')
        .catch(err => console.warn('[historical-chat] supabase upsert failed:', err?.message));
    }
  } catch (err) {
    console.warn('[historical-chat] supabase mirror failed:', err?.message);
  }

  _trackUpload({ endpoint: 'historical_chat', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, stored: lines.length }));
}

async function _handleAgentLockout(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'lockout relay disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  // entries: [{ bossName, remainingMs, character }]
  // "Available" entries are filtered out at the agent before sending — only
  // active lockouts arrive here.
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  if (entries.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, set: 0 }));
  }

  const { recordKill, getBossState, overrideTimer } = require('./utils/state');
  const { postKillUpdate } = require('./utils/killops');
  const channelId = process.env.TIMER_CHANNEL_ID;

  let set = 0;
  for (const entry of entries) {
    const { bossName, remainingMs, character } = entry || {};
    if (!bossName || typeof remainingMs !== 'number') continue;

    delete require.cache[require.resolve('./data/bosses.json')];
    const bosses    = require('./data/bosses.json');
    const nameLower = bossName.toLowerCase();
    const boss      = bosses.find(b =>
      b.name.toLowerCase() === nameLower ||
      (b.nicknames || []).some(n => n.toLowerCase() === nameLower)
    );
    if (!boss) continue;

    const nextSpawn   = Date.now() + remainingMs;
    const existing    = getBossState(boss.id);

    if (existing) {
      // Guild timer already running — only refine it if the lockout suggests
      // the real spawn is LATER (i.e., our timer might be too early).
      // Never move it earlier from a single character's lockout.
      if (nextSpawn > existing.nextSpawn) {
        overrideTimer(boss.id, nextSpawn);
        if (channelId) postKillUpdate(client, channelId, boss.id).catch(() => {});
        set++;
      }
      // If nextSpawn ≤ existing.nextSpawn: guild timer is already correct or
      // more conservative — leave it alone.
    } else {
      // No guild timer at all — back-calculate a synthetic kill time and record it.
      const killedAt = nextSpawn - boss.timerHours * 3600000;
      recordKill(boss.id, boss.timerHours, character, killedAt);
      if (channelId) postKillUpdate(client, channelId, boss.id).catch(() => {});
      set++;
    }
  }

  _trackUpload({ endpoint: 'lockout', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, set }));
}

// In-memory card cache: mirrors agentTestCards in state.json but updated
// immediately (before the async Discord send completes), so concurrent uploads
// for the same boss find the in-progress card and merge rather than racing to
// each post a fresh card.
const _liveCards = new Map();

// GET /api/agent/incomplete-encounters?characters=Hitya,Statlander[&limit=20]
//
// Returns the list of encounters flagged data_incomplete that include any of
// the queried characters in encounter_players. Sorted newest-first. The agent
// dashboard uses the first entry's boss name for the banner copy and the
// total count for the "and N more" tail.
//
// Multiple characters per call so an agent with several builders (one EQ
// account running multiple toons) gets all relevant encounters in one round
// trip. Case-insensitive match.
async function _handleAgentIncomplete(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'agent endpoints disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const url   = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const raw   = url.searchParams.get('characters') || url.searchParams.get('character') || '';
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20));

  const characters = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (characters.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ incomplete: [], total: 0 }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ incomplete: [], total: 0, note: 'supabase disabled' }));
  }

  // Find encounter_player rows for the queried characters (case-insensitive)
  // joined to encounters where data_incomplete=true. PostgREST doesn't have
  // a built-in case-insensitive IN, so we pass an `in.(...)` with all the
  // case variants we expect — practically the names from EQ are canonical
  // and stable, so a plain `in.()` is enough.
  const inList = '(' + characters.map(c => `"${c.replace(/"/g, '')}"`).join(',') + ')';
  // Sort by data_incomplete_at desc so the agent's "MOST RECENT REQUESTED"
  // banner shows the most-recently-flagged kill, not the most-recently-killed
  // one.
  const rows = await supabase.select(
    'encounter_players',
    'select=character_name,encounter_id,encounters!inner(id,started_at,data_incomplete,data_incomplete_reason,data_incomplete_at,eqemu_npc_types(name))' +
    `&character_name=in.${encodeURIComponent(inList)}` +
    '&encounters.data_incomplete=eq.true' +
    `&order=encounters(data_incomplete_at).desc&limit=${limit * characters.length}`,
  );

  if (!Array.isArray(rows)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ incomplete: [], total: 0 }));
  }

  // Dedup by encounter_id (one character might match multiple encounters and
  // multiple characters might match the same encounter).
  const seen = new Map();
  for (const r of rows) {
    const e = r.encounters;
    if (!e || !e.data_incomplete) continue;
    const id = e.id;
    if (seen.has(id)) {
      seen.get(id).characters.push(r.character_name);
      continue;
    }
    seen.set(id, {
      encounter_id: id,
      started_at:   e.started_at,
      boss_name:    e.eqemu_npc_types?.name || null,
      reason:       e.data_incomplete_reason || null,
      flagged_at:   e.data_incomplete_at || null,
      characters:   [r.character_name],
    });
  }

  const list = [...seen.values()]
    .sort((a, b) =>
      new Date(b.flagged_at || b.started_at).getTime() -
      new Date(a.flagged_at || a.started_at).getTime()
    )
    .slice(0, limit);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    incomplete: list,
    total: seen.size,
    queried_characters: characters,
  }));
}

// ── Backfill requests ──────────────────────────────────────────────────────
// Officer-filed via /admin/encounters → agent polls here per character to
// pick up its pending rows. Lifecycle: pending → acked (agent claimed it,
// processing) → completed (with summary) or errored (with message). Agent
// user can also dismiss the request from the dashboard.
//
// GET  /api/agent/backfill-requests?character=X[,Y]  — list pending for char(s)
// GET /api/agent/character-prefs?characters=Hitya,Canopy
//
// Returns the per-character data-handling preferences the owner has set on
// `characters` (exclude_from_stats, exclude_inventory). The agent polls this
// every ~10 min for the chars it's tailing, caches the result, and gates
// outbound uploads on exclude_from_stats — when true, the agent simply
// doesn't upload encounters / chat / etc. for that character.
//
// exclude_inventory is returned but not yet acted on (no inventory upload
// path exists yet — slated for the Mimic timeline); surfacing it now lets the
// agent display the setting and refuse to send when the path lands.
async function _handleAgentCharacterPrefs(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'agent endpoints disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const raw = url.searchParams.get('characters') || url.searchParams.get('character') || '';
  const characters = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (characters.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ prefs: {} }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ prefs: {}, note: 'supabase disabled' }));
  }

  // PostgREST in.() is case-sensitive. The agent uploads canonical EQ names,
  // which match characters.name as stored — a plain in() handles 99% of cases.
  // We also accept a comma list to make the round-trip cheap.
  const inList = '(' + characters.map(c => `"${c.replace(/"/g, '')}"`).join(',') + ')';
  const rows = await supabase.select(
    'characters',
    `name=in.${encodeURIComponent(inList)}&select=name,exclude_from_stats,exclude_inventory,tell_relay&guild_id=eq.wolfpack`,
  ).catch(() => []);

  const prefs = {};
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r?.name) continue;
    prefs[r.name] = {
      exclude_from_stats: !!r.exclude_from_stats,
      exclude_inventory:  !!r.exclude_inventory,
      tell_relay:         !!r.tell_relay,
    };
  }
  // Any character not in characters table → default (participate). Agents key
  // on lowercased character so include both forms for case-insensitive lookup.
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ prefs }));
}

// POST /api/agent/tells
//
// Inbound /tell relay (opt-in). Body:
//   { agent_version, character, tells: [
//       { direction: 'incoming'|'outgoing', other: 'Player', text: '...',
//         ts: 'ISO', dedup_key: 'sha1...', raw_text: '...' },
//       ...
//   ] }
//
// Defense-in-depth: even though the agent gates uploads on characters.tell_relay,
// the bot ALSO re-checks the flag here and rejects with 403 if the character
// hasn't opted in. The agent's prefs cache could be stale; the DB is truth.
//
// DM relay: when accepted, each incoming tell triggers a Discord DM to the
// linked Discord user (characters.discord_id → wolfpack_members → discord
// user). Outgoing tells are stored but NOT DMed (the user is already at their
// keyboard, that would be noise). DM failures are non-fatal.
async function _handleAgentTells(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'agent endpoints disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  let body = '';
  await new Promise((resolve) => {
    req.on('data', (chunk) => {
      body += chunk;
      // Modest cap — tells are tiny but a misbehaving agent shouldn't ddos us.
      if (body.length > 256 * 1024) { req.destroy(); resolve(); }
    });
    req.on('end',   resolve);
    req.on('error', resolve);
  });
  let payload;
  try { payload = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid json' }));
  }
  const character = String(payload?.character || '').trim();
  const tells     = Array.isArray(payload?.tells) ? payload.tells : [];
  if (!character || tells.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: 0 }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: 0, note: 'supabase disabled' }));
  }

  // Hard gate: character must be opted in. Also need discord_id to attribute
  // ownership. Missing either → silently drop (do not write).
  const charRows = await supabase.select(
    'characters',
    `name=ilike.${encodeURIComponent(character)}&select=name,discord_id,tell_relay,tell_dm&guild_id=eq.wolfpack&limit=1`,
  ).catch(() => []);
  const charRow = Array.isArray(charRows) ? charRows[0] : null;
  if (!charRow?.tell_relay) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'tell_relay not enabled for this character' }));
  }
  if (!charRow.discord_id) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'character has no linked discord_id' }));
  }

  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const rows = [];
  for (const t of tells) {
    const direction = t?.direction === 'outgoing' ? 'outgoing' : 'incoming';
    const other     = String(t?.other || '').trim();
    const text      = String(t?.text  || '').trim();
    const tsRaw     = t?.ts ? new Date(t.ts) : new Date();
    const ts        = isNaN(tsRaw.getTime()) ? new Date() : tsRaw;
    if (!other || !text) continue;
    rows.push({
      guild_id:         guildId,
      owner_character:  charRow.name,
      owner_discord_id: charRow.discord_id,
      direction,
      other_name:       other.slice(0, 64),
      text:             text.slice(0, 2000),
      ts:               ts.toISOString(),
      source:           t?.source || 'live_agent',
      raw_text:         t?.raw_text ? String(t.raw_text).slice(0, 2000) : null,
      dedup_key:        t?.dedup_key ? String(t.dedup_key).slice(0, 80) : null,
    });
  }
  if (rows.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: 0 }));
  }
  // Upsert on the partial unique (guild, owner_character, dedup_key). Rows
  // without dedup_key insert fresh every call — agents should always populate
  // it but we don't reject if they don't.
  const withKey    = rows.filter(r => r.dedup_key);
  const withoutKey = rows.filter(r => !r.dedup_key);
  let stored = 0;
  if (withKey.length) {
    const u = await supabase.upsert('tells', withKey, 'guild_id,owner_character,dedup_key').catch(err => {
      console.warn('[tells] upsert failed:', err?.message); return null;
    });
    if (Array.isArray(u)) stored += u.length;
  }
  if (withoutKey.length) {
    const i = await supabase.insert('tells', withoutKey).catch(err => {
      console.warn('[tells] insert failed:', err?.message); return null;
    });
    if (Array.isArray(i)) stored += i.length;
  }

  // Fire-and-forget DM relay for incoming tells — only when the per-character
  // Discord-DM toggle is on. tell_dm defaults true, so opting into tell_relay
  // gives DMs out of the box; flipping tell_dm off keeps the row + browser
  // notification but silences the Discord ping. Browser notifications ride
  // Supabase Realtime on the row insert, independent of this DM path.
  const incoming = rows.filter(r => r.direction === 'incoming');
  if (incoming.length > 0 && charRow.tell_dm !== false) {
    _relayTellsToDM(charRow.discord_id, charRow.name, incoming).catch(err =>
      console.warn('[tells] DM relay failed:', err?.message));
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, stored }));
}

// DM the owner with the freshly-relayed tells. Batched into one message so a
// rapid volley of tells doesn't fan out as a wall of pings.
async function _relayTellsToDM(discordUserId, ownerCharacter, tellRows) {
  try {
    const user = await client.users.fetch(discordUserId).catch(() => null);
    if (!user) return;
    const lines = tellRows.slice(0, 10).map(t =>
      `**${t.other_name}** → _${ownerCharacter}_: ${t.text}`
    );
    if (tellRows.length > 10) lines.push(`_…and ${tellRows.length - 10} more — see /me/tells._`);
    const header = tellRows.length === 1
      ? '📬 You got a tell while you were away:'
      : `📬 You got ${tellRows.length} tells while you were away:`;
    await user.send({
      content: header + '\n' + lines.join('\n') +
        '\n\nMute via the **Tells: ON** toggle on https://wolfpack.quest/me.',
      allowedMentions: { parse: [] },
    }).catch(() => {});
    // Best-effort: stamp dm_relayed_at on the rows we just DMed. Failures here
    // don't block — the tells are already stored.
    const supabase = require('./utils/supabase');
    if (supabase.isEnabled()) {
      const keys = tellRows.map(r => r.dedup_key).filter(Boolean);
      if (keys.length) {
        const inList = '(' + keys.map(k => `"${k.replace(/"/g, '')}"`).join(',') + ')';
        await supabase.update(
          'tells',
          `owner_character=ilike.${encodeURIComponent(ownerCharacter)}&dedup_key=in.${encodeURIComponent(inList)}`,
          { dm_relayed_at: new Date().toISOString() },
        ).catch(() => {});
      }
    }
  } catch { /* non-fatal */ }
}

// POST /api/agent/backfill-requests/:id/:action      — ack | dismiss | complete | error
//   POST body: { reason?, summary?, error_message? } (optional, by action)
async function _handleAgentBackfillRequests(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'backfill-requests disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ requests: [], note: 'supabase disabled' }));
  }
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';

  // GET → list
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const raw = url.searchParams.get('character') || url.searchParams.get('characters') || '';
    const chars = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (chars.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ requests: [] }));
    }
    const inList = '(' + chars.map(c => `"${c.replace(/"/g, '')}"`).join(',') + ')';
    const rows = await supabase.select(
      'agent_backfill_requests',
      `guild_id=eq.${encodeURIComponent(guildId)}&character=in.${encodeURIComponent(inList)}&status=in.(pending,acked,running)&order=requested_at.desc&limit=50`,
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ requests: rows || [] }));
  }

  // POST /:id/:action
  if (req.method === 'POST') {
    // Path: /api/agent/backfill-requests/{id}/{action}
    const parts = req.url.split('?')[0].split('/').filter(Boolean);
    // ['api','agent','backfill-requests','<id>','<action>']
    const id     = parts[3];
    const action = parts[4];
    if (!id || !action) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'expected /api/agent/backfill-requests/{id}/{action}' }));
    }

    const chunks = []; let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 32 * 1024) { res.writeHead(413); return res.end(); }
      chunks.push(chunk);
    }
    let body = {};
    if (total > 0) {
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }
    }

    const nowIso = new Date().toISOString();
    let patch;
    if (action === 'ack')       patch = { status: 'acked',     acked_at:     nowIso };
    else if (action === 'running')   patch = { status: 'running' };
    else if (action === 'dismiss')   patch = { status: 'dismissed', dismissed_at: nowIso, dismissed_reason: body.reason || null };
    else if (action === 'complete')  patch = { status: 'completed', completed_at: nowIso, completed_summary: body.summary || null };
    else if (action === 'error')     patch = { status: 'errored',   error_message: body.error_message || 'unknown error' };
    else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `unknown action "${action}"` }));
    }

    await supabase.update('agent_backfill_requests', `id=eq.${encodeURIComponent(id)}`, patch);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, id, action }));
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ error: 'method not allowed' }));
}

// ── Guild triggers ─────────────────────────────────────────────────────────
// Agents poll this every 10 min for the enabled trigger set. We return a
// version hash so agents can short-circuit on no-change (HTTP 304 would
// be cleaner but the agent isn't set up to handle ETag yet).
async function _handleAgentGuildTriggers(req, res) {
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'guild-triggers disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ triggers: [], note: 'supabase disabled' }));
  }
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';

  // Filter optional: ?category=rampage  ?classes=Warrior,Paladin
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const category = url.searchParams.get('category');
  const classesRaw = url.searchParams.get('classes') || '';
  const classes = classesRaw.split(',').map(s => s.trim()).filter(Boolean);

  let q = `guild_id=eq.${encodeURIComponent(guildId)}&enabled=eq.true&order=category.asc,name.asc`;
  if (category) q += `&category=eq.${encodeURIComponent(category)}`;
  const rows = await supabase.select('guild_triggers', q);

  // Server-side class targeting filter — applies_to_classes is text[]; we
  // include triggers where the column is null/empty OR overlaps the
  // agent's class set. PostgREST handles overlap via &overlap but we
  // filter in JS to keep the query simple.
  const filtered = (rows || []).filter(t => {
    const arr = Array.isArray(t.applies_to_classes) ? t.applies_to_classes : [];
    if (arr.length === 0) return true;
    if (classes.length === 0) return true;
    return classes.some(c => arr.includes(c));
  });

  // Version hash so the agent can detect no-change quickly. Use the max
  // updated_at across the filtered set — cheap, sufficient for our cadence.
  const version = filtered.length
    ? filtered.map(t => t.updated_at || '').sort().pop()
    : '0';

  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  return res.end(JSON.stringify({ version, triggers: filtered }));
}

async function _handleAgentUpload(req, res) {
  // Auth: shared-secret bearer token. WOLFPACK_AGENT_TOKEN must be set.
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'agent uploads disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  // Read body (cap at 10MB for safety; encounters are typically <1MB)
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 10 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'payload too large' }));
    }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid JSON' }));
  }

  // Shape: { agent_version, character, encounter: { started_at, ended_at, boss_name, events: [...] } }
  // Optional payload.backfill === true → the agent is replaying old logs via
  // the opt-in import flow. We still persist to Supabase (that's the whole
  // point of backfill), but skip every live-side-effect: no parse card in
  // AUTOPARSE_TEST_THREAD, no session damage accumulation, no auto-kill /
  // timer reset. Otherwise importing weeks of old combat would spam Discord
  // and stomp every active boss timer.
  const { character, encounter } = payload || {};
  const isBackfill = payload?.backfill === true;
  if (!encounter || !Array.isArray(encounter.events)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'missing encounter.events' }));
  }

  // ── Process /who data FIRST (before noise filter) ─────────────────────────
  // who-only uploads have no events and no boss_name — they'd otherwise be
  // rejected by the noise filter below. Merge into state.whoData so /whois
  // sees the new entries even when no combat happened recently.
  const uploadedWhoData = encounter.who_data;
  if (Array.isArray(uploadedWhoData) && uploadedWhoData.length > 0) {
    try { mergeWhoData(uploadedWhoData); } catch {}

    // Mirror to Supabase who_observations for long-term SQL access. The
    // agent re-uploads its full whoData on every encounter — the per-minute
    // dedup index (lower(character), date_trunc('minute', observed_at),
    // uploaded_by) collapses repeats so this is cheap. Fail-open.
    try {
      const supabase = require('./utils/supabase');
      if (supabase.isEnabled()) {
        const rows = uploadedWhoData
          .filter(w => w && w.name)
          .map(w => ({
            guild_id:    process.env.SUPABASE_GUILD_ID || 'wolfpack',
            character:   w.name,
            level:       Number.isFinite(w.level) ? w.level : null,
            race:        w.race  || null,
            class:       w.class || null,
            guild_name:  w.guild || null,
            anonymous:   !!w.anonymous,
            gm:          !!w.gm,
            observed_at: w.observedAt ? new Date(w.observedAt).toISOString() : new Date().toISOString(),
            uploaded_by: character || '',
          }));
        if (rows.length > 0) {
          supabase.upsert('who_observations', rows, 'guild_id,character,observed_minute,uploaded_by')
            .catch(err => console.warn('[who-obs] supabase upsert failed:', err?.message));
        }
      }
    } catch (err) {
      console.warn('[who-obs] supabase mirror failed:', err?.message);
    }
  }

  // Server-side noise guard (agent already filters these, but defend in depth).
  // "YOU" means the player was identified as the primary target — received damage, no real mob.
  // null/empty boss_name with few events = background noise or all-heal encounter.
  // Exception: who-only uploads (empty events + non-empty who_data) are valid;
  // we've already merged the whoData above, so just exit cleanly.
  const bossNameRaw = (encounter.boss_name || '').trim();
  const hasWhoOnly  = (encounter.events.length === 0) && Array.isArray(uploadedWhoData) && uploadedWhoData.length > 0;
  if (hasWhoOnly) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, who_merged: uploadedWhoData.length }));
  }
  if (/^you$/i.test(bossNameRaw) || (!bossNameRaw && encounter.events.length < 20)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, skipped: 'noise encounter' }));
  }

  console.log(`[agent] upload from ${character || '?'}: ${encounter.events.length} events, ` +
              `boss=${encounter.boss_name || '?'}, started=${encounter.started_at}`);

  // Record per-character upload activity for /parseagents
  try { recordAgentUpload(character, encounter.boss_name, encounter.events.length); } catch {}

  // ── Compute damage totals once (used by both parses.json and Supabase paths) ──
  // Filter out noise before aggregating:
  //   - "Eye of PLAYERNAME" — wizard/mage scout pets that attack your target (not player DPS)
  //   - Cannibalize self-hits — shaman HP→mana conversion logged as self-damage
  //   - NPC-vs-NPC damage — e.g. "A Netherbian Drone hits A Netherbian Drone" (identified
  //     by multi-word attacker name that isn't a known player pet via pet_leaders map)
  //
  // IMPORTANT: events from the uploading character's OWN perspective (melee, spells,
  // DoTs, archery) are parsed by the agent as attacker=null ("self / first person").
  // We re-attribute those to `character` so their damage isn't silently dropped.
  //
  // Pet leader attribution: the agent captures "PetName says, 'My leader is Owner.'"
  // and uploads them as encounter.pet_leaders = { petname: "Owner" }.
  //
  // We merge any new declarations into the SERVER-PERSISTENT pet-owner map so
  // that one parser catching the declaration helps ALL parsers attribute pet
  // damage correctly going forward — even across encounters and across uploads
  // from different characters. The persistent map is cleared at midnight.
  const uploadedPetLeaders = encounter.pet_leaders || {};
  try { addPetOwners(uploadedPetLeaders); } catch {}
  // Normalise petLeaders to { petNameLower: [owner, …] } so every lookup returns an array.
  // Build by starting from state (already-normalised arrays via addPetOwners) then layering
  // in the upload's string values. Never spread the two maps together — that would overwrite
  // state arrays with the upload string, silently dropping previously-accumulated owners.
  const petLeaders = {};  // petNameLower → [owner, …]
  for (const [pet, val] of Object.entries(getPetOwners())) {
    const owners = Array.isArray(val) ? [...val] : (val ? [val] : []);
    if (owners.length) petLeaders[pet.toLowerCase()] = owners;
  }
  for (const [pet, owner] of Object.entries(uploadedPetLeaders)) {
    if (!pet || !owner) continue;
    const key = pet.toLowerCase();
    if (!petLeaders[key]) petLeaders[key] = [];
    if (!petLeaders[key].includes(owner)) petLeaders[key].push(owner);
  }

  // (who_data merge already happened above, before the noise filter.)
  // playerTotals: name → { direct, pet }
  // direct = damage the player dealt themselves; pet = share of pet damage attributed to them.
  // Pet damage is divided equally across all /pet-leader owners of that pet name.
  const playerTotals = new Map();
  const _addDmg = (name, amount, isPet) => {
    if (!playerTotals.has(name)) playerTotals.set(name, { direct: 0, pet: 0 });
    const e = playerTotals.get(name);
    if (isPet) e.pet += amount; else e.direct += amount;
  };
  for (const ev of encounter.events) {
    if (ev.type !== 'damage') continue;
    const rawAttacker = ev.attacker;
    // Skip received-damage events. When rawAttacker=null AND defender=null (or defender="you"),
    // the event is "You were hit by non-melee for N" — i.e. INCOMING damage, not outgoing.
    // Without this guard, every incoming hit would be attributed to the character as outgoing
    // DPS because rawAttacker=null gets rewritten to character below.
    if (rawAttacker === null && !ev.defender) continue;
    // Re-attribute first-person (null) events to the uploading character
    const attacker = rawAttacker ?? character ?? null;
    if (!attacker) continue;
    if (/^Eye of /i.test(attacker)) continue;                                                    // skip Eye of X wizard/mage scout pets
    if (ev.ability && /cannibali[sz]e/i.test(ev.ability) && rawAttacker === null) continue;     // skip self-cannibalizes (canni: first-person + ability name)
    const amount = ev.amount || 0;
    const owners = petLeaders[attacker.toLowerCase()];
    if (owners) {
      // Known pet — divide its damage equally among all declared owners.
      // Filter out any NPC owner names (have spaces) just in case.
      const validOwners = owners.filter(o => !/\s/.test(o));
      if (validOwners.length > 0) {
        const share = amount / validOwners.length;
        for (const owner of validOwners) _addDmg(owner, share, true);
      }
      // If no valid owners, treat as unattributed noise (same as unknown pet).
    } else {
      // Direct player damage — skip if multi-word (NPC attacker noise).
      if (/\s/.test(attacker)) continue;
      _addDmg(attacker, amount, false);
    }
  }
  const startedMs = encounter.started_at ? new Date(encounter.started_at).getTime() : Date.now();
  const endedMs   = encounter.ended_at   ? new Date(encounter.ended_at).getTime()   : startedMs;
  // Prefer active_duration_s (gap-trimmed, excludes charm-phase inactivity) when
  // the agent sends it. Fall back to naive wall-clock range for older agent versions.
  const duration  = encounter.active_duration_s != null
    ? Math.max(1, Math.round(encounter.active_duration_s))
    : Math.max(0, Math.round((endedMs - startedMs) / 1000));
  const players = [...playerTotals.entries()]
    .map(([name, { direct, pet }]) => {
      const totalDmg = Math.round(direct + pet);
      return {
        name,
        damage:       totalDmg,
        directDamage: Math.round(direct),
        petDamage:    Math.round(pet),
        hasPets:      pet > 0,
        duration,
        dps:          duration > 0 ? Math.round(totalDmg / duration) : 0,
      };
    })
    .sort((a, b) => b.damage - a.damage)
    .map((p, i) => ({ ...p, rank: i + 1 }));
  const totalDamage = players.reduce((s, p) => s + p.damage, 0);
  const totalDps    = duration > 0 ? Math.round(totalDamage / duration) : 0;

  // ── Raid window tag ────────────────────────────────────────────────────────
  // True when the encounter's start time falls within the official Wolf Pack EQ
  // raid windows (Sun/Wed/Thu 8:30–11:30 pm Eastern). Stored with parse entries
  // so /parsestats and future /guildreport can scope "official raid stats" vs
  // casual group runs.
  const { isInRaidWindow } = require('./utils/timezone');
  const isRaidWindow = isInRaidWindow(startedMs);

  // ── Healer and defender aggregation ───────────────────────────────────────
  // The agent uploads per-encounter healer totals ({ name, healed, ticks, targets })
  // and defender tanking stats ({ name, hits, damageTaken, ripostedFor, … }).
  // Extract them here so we can merge across parsers and feed to the parse card.
  const uploadedHealers   = Array.isArray(encounter.healers)   ? encounter.healers   : [];
  const uploadedDefenders = Array.isArray(encounter.defenders) ? encounter.defenders : [];
  const uploadedDeaths    = Array.isArray(encounter.deaths)    ? encounter.deaths    : [];
  const uploadedHealGaps  = encounter.heal_gaps || null;

  // ── Accumulate into active /raidnight session (all encounters, not just bosses) ──
  // sessionDamage lives inside raidSession in state.json — clears at midnight with the session.
  // Skip during backfill so importing old fights doesn't pollute tonight's session totals.
  if (players.length > 0 && !isBackfill) {
    try { accumulateSessionDamage(players, duration); } catch (e) { /* non-fatal */ }
  }

  // ── Post human-readable parse card to AUTOPARSE_TEST_THREAD_ID ─────────────────
  // Shows every encounter as it arrives — boss and trash — so officers can verify
  // data quality in real-time without touching the live raid boards.
  //
  // Edit-in-place dedup: if the same mob is uploaded within 10 minutes (multiple
  // parsers watching the same fight), we MERGE the player data (max damage per
  // player wins) and EDIT the existing Discord message rather than posting a new one.
  // The footer shows "N parsers merged · Name1, Name2" so dedup convergence is visible.
  //
  // Also posts/edits a session leaderboard card showing all-night running totals.
  const testThreadId = process.env.AUTOPARSE_TEST_THREAD_ID;
  if (testThreadId && players.length > 0 && !isBackfill) {
    try {
      const testThread = await client.channels.fetch(testThreadId).catch(() => null);
      if (testThread) {
        const { buildParseEmbed } = require('./commands/parse');
        const { EmbedBuilder: _TEB } = require('discord.js');

        const mobName    = encounter.boss_name || '? (unidentified mob)';
        const stagingTag = process.env.STAGING_MODE === 'true' ? ' *(staging)*' : '';
        // Key by slugified mob name so the same mob from multiple parsers shares a card
        const bossKey    = (encounter.boss_name || 'unknown').toLowerCase().replace(/\W+/g, '_');

        // ── Mob card — edit in place only for the SAME KILL ─────────────────
        // Detection rule: two encounters are the "same kill" if their time
        // ranges [started_at, ended_at] OVERLAP. This works whether or not
        // the parser saw the death event:
        //   - In-range parser flushes at death → range ends at death timestamp
        //   - Out-of-range parser misses the death line → range ends at
        //     last-damage + 60s idle, possibly much earlier — but it still
        //     overlaps the in-range parser's range because both started
        //     during the same fight
        //   - Two SEPARATE kills of the same mob have disjoint ranges (the
        //     mob has to respawn between them, which always takes time)
        //
        // Strict-less-than on one boundary so back-to-back instant respawns
        // at the exact same timestamp are treated as separate kills.
        //
        // Earlier attempt that only compared ended_at proximity broke for
        // the out-of-range case — Utoh's encounter ended via idle flush
        // ~minutes before Syrl's in-range parser saw the death event, so
        // their ended_at gap exceeded any reasonable tolerance window.
        // Cache-first lookup: _liveCards is updated immediately (before the async
        // Discord send resolves), so concurrent uploads for the same boss find
        // the in-progress card rather than each racing to post a fresh one.
        const existing  = _liveCards.get(bossKey) || getAgentTestCard(bossKey);
        const exStart   = existing?.encounterStartedAt || 0;
        const exEnd     = existing?.encounterEndedAt   || 0;
        // Named mobs (no "a "/"an " prefix) are unique — only one can exist in a zone
        // at a time, so any upload within 10 min of the prior card is the same kill.
        // Trash mobs ("a Shissar Guard") keep the tight 60s window so back-to-back
        // pulls still accumulate on the same card.
        const isNamedMob   = !/^an?\s/i.test(mobName);
        const seqWindowMs  = isNamedMob ? 10 * 60_000 : 60_000;
        // Two encounters are the "same kill" if their time ranges OVERLAP (concurrent parsers)
        // OR they are sequential kills of the same mob within the window.
        const overlaps    = existing && exStart > 0 && exEnd > 0
                            && (startedMs < exEnd) && (endedMs > exStart);
        const sequential  = existing && exStart > 0 && exEnd > 0
                            && startedMs >= exEnd
                            && (startedMs - exEnd) < seqWindowMs;
        const withinWindow = overlaps || sequential;

        let mergedPlayers, mergedHealers, mergedDefenders, mergedDeaths, mergedHealGaps, perspectives, newDuration, newTotalDamage, newTotalDps;

        if (withinWindow) {
          // Two distinct merge semantics:
          //   - Concurrent parsers (overlap): two views of the SAME fight → MAX damage per
          //     player wins (each parser may have missed some events, the higher count is
          //     more complete). Duration: take the longest observed window.
          //   - Sequential kills (back-to-back, gap < 60s): SEPARATE fights of the same mob
          //     → SUM damage per player (kill 1 + kill 2 = total) AND sum durations. This
          //     makes 54 Shadel Bandit pulls aggregate into one accurate card instead of
          //     each new pull overwriting the prior one because its single-fight damage
          //     happened to be higher.
          const isSequentialOnly = sequential && !overlaps;
          const merged = new Map(existing.players.map(p => [p.name.toLowerCase(), { ...p }]));
          for (const p of players) {
            const k   = p.name.toLowerCase();
            const cur = merged.get(k);
            if (isSequentialOnly && cur) {
              merged.set(k, {
                ...cur,
                damage:       (cur.damage       || 0) + (p.damage       || 0),
                directDamage: (cur.directDamage || 0) + (p.directDamage || 0),
                petDamage:    (cur.petDamage    || 0) + (p.petDamage    || 0),
                hasPets:      cur.hasPets || p.hasPets,
              });
            } else if (!cur || p.damage > cur.damage) {
              merged.set(k, { ...p });
            }
          }
          newDuration = isSequentialOnly
            ? (existing.duration || 0) + duration
            : Math.max(existing.duration, duration);
          // Recalculate DPS for all merged players against the longest known fight duration
          mergedPlayers  = [...merged.values()]
            .sort((a, b) => b.damage - a.damage)
            .map((p, i) => ({
              ...p,
              dps:  newDuration > 0 ? Math.round(p.damage / newDuration) : 0,
              rank: i + 1,
            }));
          perspectives   = [...new Set([...existing.perspectives, character].filter(Boolean))];
          newTotalDamage = mergedPlayers.reduce((s, p) => s + p.damage, 0);
          newTotalDps    = newDuration > 0 ? Math.round(newTotalDamage / newDuration) : 0;

          // ── Merge healers ──────────────────────────────────────────────────
          // MAX-per-healer across contributors. On Quarm the bystander
          // third-person heal line (with healer name + amount) doesn't show,
          // so in practice only the healer themselves uploads heal events for
          // their own outgoing heals — SUM and MAX both produce the same
          // result. MAX is the defensive choice for future cases (raid-spam
          // toggle changes, HoT ticks visible to multiple parsers): two
          // contributors both seeing the same healer's outgoing 1234 collapse
          // to 1234 instead of inflating to 2468. Targets union across
          // contributors so a healer who hits both Tank A and Tank B from
          // different perspectives still gets credit for both.
          {
            const hMap = new Map((existing.healers || []).map(h => [h.name.toLowerCase(), { ...h, targets: [...(h.targets || [])] }]));
            for (const h of uploadedHealers) {
              const k = (h.name || '').toLowerCase();
              const cur = hMap.get(k);
              if (cur) {
                hMap.set(k, {
                  ...cur,
                  healed:  Math.max(cur.healed || 0, h.healed || 0),
                  ticks:   Math.max(cur.ticks  || 0, h.ticks  || 0),
                  targets: [...new Set([...cur.targets, ...(h.targets || [])])],
                });
              } else {
                hMap.set(k, { ...h, targets: [...(h.targets || [])] });
              }
            }
            mergedHealers = [...hMap.values()].sort((a, b) => b.healed - a.healed);
          }

          // ── Merge defenders ────────────────────────────────────────────────
          // For riposte tracking: SUM ripostedFor across parsers (different
          // parsers may see different riposte events, especially multi-perspective
          // on a long fight). Also SUM hits and damageTaken.
          {
            const dMap = new Map((existing.defenders || []).map(d => [d.name.toLowerCase(), { ...d }]));
            for (const d of uploadedDefenders) {
              const k = (d.name || '').toLowerCase();
              const cur = dMap.get(k);
              if (cur) {
                // Sum numeric fields — each perspective catches different events
                const sumFields = ['hits','damageTaken','misses','dodges','parries','ripostes','blocks','invulns','ripostedFor'];
                const merged2 = { ...cur };
                for (const f of sumFields) merged2[f] = (cur[f] || 0) + (d[f] || 0);
                dMap.set(k, merged2);
              } else {
                dMap.set(k, { ...d });
              }
            }
            mergedDefenders = [...dMap.values()].sort((a, b) => b.damageTaken - a.damageTaken);
          }

          // ── Merge deaths ─────────────────────────────────────────────────
          // Aggregate by player name: SUM death counts across parsers, OR the
          // riposteDeath flag (any parser seeing the riposte is sufficient).
          {
            const dMap2 = new Map((existing.deaths || []).map(d => [d.name.toLowerCase(), { ...d }]));
            for (const d of uploadedDeaths) {
              const k = (d.name || '').toLowerCase();
              const cur = dMap2.get(k);
              if (cur) {
                dMap2.set(k, {
                  ...cur,
                  count:        (cur.count || 1) + 1,
                  riposteDeath: cur.riposteDeath || !!d.riposteDeath,
                  class:        cur.class || d.class || null,
                });
              } else {
                dMap2.set(k, { ...d, count: 1 });
              }
            }
            mergedDeaths = [...dMap2.values()].sort((a, b) => (b.count || 1) - (a.count || 1));
          }
          // Heal gaps: keep the most severe (highest count, or highest maxGapMs as tiebreak)
          mergedHealGaps = uploadedHealGaps && (
            !existing.healGaps ||
            uploadedHealGaps.count > (existing.healGaps?.count || 0) ||
            (uploadedHealGaps.count === (existing.healGaps?.count || 0) && uploadedHealGaps.maxGapMs > (existing.healGaps?.maxGapMs || 0))
          ) ? uploadedHealGaps : (existing.healGaps || null);
        } else {
          mergedPlayers   = players;
          mergedHealers   = [...uploadedHealers];
          mergedDefenders = [...uploadedDefenders];
          mergedDeaths    = uploadedDeaths.map(d => ({ ...d, count: 1 }));
          mergedHealGaps  = uploadedHealGaps;
          perspectives    = character ? [character] : [];
          newDuration     = duration;
          newTotalDamage  = totalDamage;
          newTotalDps     = totalDps;
        }

        const perspCount = perspectives.length;
        const perspLabel = perspCount <= 1 ? '1 parser' : `${perspCount} parsers merged`;
        const perspNames = perspectives.join(', ') || '?';

        const parsed = { duration: newDuration, totalDamage: newTotalDamage, totalDps: newTotalDps, players: mergedPlayers };
        const card   = buildParseEmbed(mobName, parsed, '🤖', {
          healers:      mergedHealers.length   > 0 ? mergedHealers   : undefined,
          defenders:    mergedDefenders.length > 0 ? mergedDefenders : undefined,
          deaths:       mergedDeaths?.length   > 0 ? mergedDeaths    : undefined,
          healGaps:     mergedHealGaps || undefined,
          isRaidWindow,
        });

        // Append the fight's start time to the title so back-to-back kills of
        // the same mob ("a Shissar Revenant", "a Shissar Revenant") are
        // distinguishable at a glance. Use the EARLIEST observed start on a
        // merged card so it represents when the fight actually began, not
        // when this particular perspective joined.
        const displayStartMs = withinWindow ? Math.min(exStart, startedMs) : startedMs;
        const startTimeStr   = new Date(displayStartMs).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
          timeZone: getDefaultTz(),
        });
        const origTitle = card.data.title || mobName;
        card.setTitle(`${origTitle}  ·  ${startTimeStr}`);

        card.setFooter({ text: `${perspLabel}${stagingTag} · ${perspNames} · ${encounter.events.length} events (latest)` });

        // ── Cross-contamination detection ────────────────────────────────────
        // If we're posting a NEW (non-merged) card and there was a prior
        // same-name card that ended very close to when this one started,
        // we're almost certainly inside a multi-mob situation where the
        // EQ log couldn't distinguish the two creatures. Flag both cards
        // so officers know the per-card totals are approximate.
        const CONTAMINATION_WINDOW_MS = 60 * 1000;
        const exMsgId       = existing?.messageId || null;
        const gapToPriorMs  = exEnd > 0 ? (startedMs - exEnd) : Infinity;
        const isContaminated = !withinWindow && exMsgId && exEnd > 0
          && gapToPriorMs < CONTAMINATION_WINDOW_MS
          && gapToPriorMs >= -10_000;  // tolerate small clock skew

        if (isContaminated) {
          const gapSec = Math.max(1, Math.round(gapToPriorMs / 1000));
          const warning = `\n\n⚠️ *Another \`${mobName}\` was killed ~${gapSec}s before this one. EQ logs can't tell same-named mobs apart, so a slice of damage may have cross-attributed between the two cards.*`;
          card.setDescription((card.data.description || '') + warning);
        }

        // Shared card state object (avoids duplication in the 3 setAgentTestCard paths)
        const _cardState = (msgId, ts, sAt, eAt) => ({
          messageId:          msgId,
          timestamp:          ts,
          encounterStartedAt: sAt,
          encounterEndedAt:   eAt,
          perspectives,
          players:    mergedPlayers,
          duration:   newDuration,
          totalDamage: newTotalDamage,
          // Persist healer, defender, death, and heal-gap aggregates so future
          // parsers merging into this card start with the accumulated data.
          healers:    mergedHealers.length   > 0 ? mergedHealers   : [],
          defenders:  mergedDefenders.length > 0 ? mergedDefenders : [],
          deaths:     mergedDeaths?.length   > 0 ? mergedDeaths    : [],
          healGaps:   mergedHealGaps || null,
        });

        // Stamp _liveCards immediately (before the awaited Discord send) so any
        // concurrent upload for the same boss finds the in-progress card.
        const _saveCard = (state) => {
          _liveCards.set(bossKey, state);
          setAgentTestCard(bossKey, state);
        };

        if (withinWindow && existing.messageId && existing.messageId !== 'pending') {
          // Reserve the slot before the async send to prevent races
          const mergedState = _cardState(
            existing.messageId,
            existing.timestamp,
            Math.min(exStart, startedMs),
            Math.max(exEnd, endedMs),
          );
          _liveCards.set(bossKey, mergedState);
          try {
            const existingMsg = await testThread.messages.fetch(existing.messageId);
            await existingMsg.edit({ embeds: [card] });
            _saveCard(mergedState);
          } catch {
            // Message gone — post fresh card
            const sent = await testThread.send({ embeds: [card] });
            _saveCard(_cardState(sent.id, Date.now(), startedMs, endedMs));
          }
        } else {
          // Reserve the slot before the async send
          _liveCards.set(bossKey, _cardState('pending', Date.now(), startedMs, endedMs));
          const sent = await testThread.send({ embeds: [card] });
          _saveCard(_cardState(sent.id, Date.now(), startedMs, endedMs));
        }

        // ── If contaminated, also retroactively warn on the prior card ────
        // The new card got the warning at build time above. The prior card was
        // posted before this kill existed, so we have to fetch and edit it.
        // Idempotent: skip if our SENTINEL is already in the description.
        if (isContaminated && exMsgId) {
          const SENTINEL = `Another \`${mobName}\``;
          try {
            const prevMsg   = await testThread.messages.fetch(exMsgId);
            const prevEmbed = prevMsg.embeds[0];
            if (prevEmbed) {
              const prevJson = (typeof prevEmbed.toJSON === 'function') ? prevEmbed.toJSON() : prevEmbed.data;
              const prevDesc = prevJson?.description || '';
              if (!prevDesc.includes(SENTINEL)) {
                const gapSec  = Math.max(1, Math.round(gapToPriorMs / 1000));
                const warning = `\n\n⚠️ *Another \`${mobName}\` was killed ~${gapSec}s after this one. EQ logs can't tell same-named mobs apart, so a slice of damage may have cross-attributed between the two cards.*`;
                const updated = _TEB.from(prevEmbed);
                updated.setDescription(prevDesc + warning);
                await prevMsg.edit({ embeds: [updated] });
              }
            }
          } catch {
            // Non-critical — the new card still carries its own warning
          }
        }

      }
    } catch (err) {
      console.warn('[agent] test thread post failed:', err?.message);
    }
  }

  // ── Session leaderboard card — edited in place after every encounter ─
  // Lives outside the AUTOPARSE_TEST_THREAD guard so it still posts when
  // no test thread is configured. Routing priority:
  //   1. Active /raidnight thread  — officers see it inline with kills
  //   2. RAID_CHAT_CHANNEL_ID      — visible to the whole raid
  //   3. AUTOPARSE_TEST_THREAD_ID  — original fallback (officers' QA queue)
  //
  // The cached message ID is only safe to edit when its channel still
  // matches the current target. When the target changes between two
  // upload events (e.g. /raidnight thread opens mid-raid), the stale ID
  // would 404 against the wrong channel — post fresh and overwrite.
  if (!isBackfill && players.length > 0) {
    try {
      const session    = getRaidSession();
      const sessionDmg = session?.sessionDamage || {};
      const allNight   = Object.values(sessionDmg).sort((a, b) => b.damage - a.damage).slice(0, 15);

      if (allNight.length > 0) {
        let sessionTargetChannel = null;
        if (session?.threadId) {
          sessionTargetChannel = await client.channels.fetch(session.threadId).catch(() => null);
        }
        if (!sessionTargetChannel && process.env.RAID_CHAT_CHANNEL_ID) {
          sessionTargetChannel = await client.channels.fetch(process.env.RAID_CHAT_CHANNEL_ID).catch(() => null);
        }
        if (!sessionTargetChannel && process.env.AUTOPARSE_TEST_THREAD_ID) {
          sessionTargetChannel = await client.channels.fetch(process.env.AUTOPARSE_TEST_THREAD_ID).catch(() => null);
        }

        if (sessionTargetChannel) {
          const maxDmg = allNight[0]?.damage || 1;
          const rows = allNight.map((p, i) => {
            const avgDps = p.duration > 0 ? Math.round(p.damage / p.duration) : 0;
            const barLen = Math.round((p.damage / maxDmg) * 8);
            const bar    = '█'.repeat(Math.max(0, barLen)) + '░'.repeat(Math.max(0, 8 - barLen));
            const dmgStr = p.damage >= 1_000_000
              ? `${(p.damage / 1_000_000).toFixed(2)}M`
              : `${(p.damage / 1000).toFixed(1)}k`;
            return `\`${String(i + 1).padStart(2)}\` ${bar} **${p.name}** — ${dmgStr} · ${avgDps}/s avg · ${p.encounters} enc`;
          });

          const sessionLabel = session?.label || 'Active Session';
          const { EmbedBuilder: _SEB } = require('discord.js');
          const sessionCard = new _SEB()
            .setColor(0x5865F2)
            .setTitle(`📊 All-Night Leaderboard — ${sessionLabel}`)
            .setDescription(rows.join('\n'))
            .setFooter({ text: 'Session totals · all encounters including trash · edits in place' })
            .setTimestamp();

          const sessionCardId     = getAgentSessionCardId();
          const sessionCardChanId = getAgentSessionCardChannelId();
          const channelMatches    = sessionCardId && sessionCardChanId === sessionTargetChannel.id;

          if (channelMatches) {
            try {
              const sessionMsg = await sessionTargetChannel.messages.fetch(sessionCardId);
              await sessionMsg.edit({ embeds: [sessionCard] });
            } catch {
              const sent = await sessionTargetChannel.send({ embeds: [sessionCard] });
              setAgentSessionCardId(sent.id);
              setAgentSessionCardChannelId(sessionTargetChannel.id);
            }
          } else {
            const sent = await sessionTargetChannel.send({ embeds: [sessionCard] });
            setAgentSessionCardId(sent.id);
            setAgentSessionCardChannelId(sessionTargetChannel.id);
          }
        }
      }
    } catch (err) {
      console.warn('[agent] session leaderboard post failed:', err?.message);
    }
  }

  // ── Match boss against bosses.json, then mirror /parse instance behavior:
  //    write to parses.json, record the kill, update the board ─────────────────
  // Backfill skips this entire block — replaying old kills would reset every
  // active boss timer to whenever the old fight happened, and the parses.json
  // mirror would balloon with weeks of history (Supabase is the durable store
  // for backfilled data; parses.json is just the live mirror).
  let matchedBoss = null;
  try {
    if (encounter.boss_name && !isBackfill) {
      const { findBossFromName, loadParses, saveParses, logParseToDiscord } = require('./commands/parse');
      matchedBoss = findBossFromName(encounter.boss_name, getBosses());

      if (matchedBoss) {
        const parseEntry = {
          timestamp:       startedMs,
          submittedBy:     `agent:${character || 'unknown'}`,
          submittedByName: character || 'Agent',
          duration,
          totalDamage,
          totalDps,
          players,
          parseType:       'instance',
          source:          'wolfpack_agent',
          // Tag whether this encounter fell inside an official raid window.
          // Enables /parsestats raid_only:true filtering and future /guildreport.
          is_raid_window:  isRaidWindow,
          discordMsgId:    null,
        };

        // Append to parses.json so /parsestats sees the upload
        const parses = loadParses();
        if (!parses[matchedBoss.id]) parses[matchedBoss.id] = [];
        parses[matchedBoss.id].push(parseEntry);
        saveParses(parses);

        // Persist to Discord thread for survival across restarts
        logParseToDiscord(client, matchedBoss.id, parseEntry).then(msg => {
          if (msg?.id) {
            const p2 = loadParses();
            if (p2[matchedBoss.id]) {
              const idx = p2[matchedBoss.id].findIndex(e =>
                e.timestamp === parseEntry.timestamp && e.submittedBy === parseEntry.submittedBy);
              if (idx !== -1) { p2[matchedBoss.id][idx].discordMsgId = msg.id; saveParses(p2); }
            }
          }
        }).catch(err => console.warn('[agent] Discord log failed:', err?.message));

        // If a /raidnight session is open, also drop the parse card into that
        // thread so officers see boss kills surface alongside manual /parse
        // submissions instead of having to flip to PARSES_LOG_THREAD_ID.
        // The same dedup (per-boss bossCards map) edits the card in place when
        // multiple parsers cover the same kill.
        try {
          const { getRaidSession } = require('./utils/state');
          if (getRaidSession()) {
            const { appendParseToSession } = require('./commands/raidnight');
            const parsed = { players, totalDamage, totalDps, duration };
            appendParseToSession(client, matchedBoss.id, parsed, matchedBoss.name, matchedBoss.emoji)
              .catch(err => console.warn('[agent] raid-thread append failed:', err?.message));
          }
        } catch (err) {
          console.warn('[agent] raid-thread append wrapper failed:', err?.message);
        }

        // Auto-record kill if boss isn't already on cooldown
        const { getBossState, recordKill } = require('./utils/state');
        const { postKillUpdate } = require('./utils/killops');
        const bossState = getBossState(matchedBoss.id);
        const now = Date.now();
        if (!bossState || !bossState.killedAt || bossState.nextSpawn <= now) {
          recordKill(matchedBoss.id, matchedBoss.timerHours, null);
          postKillUpdate(client, process.env.TIMER_CHANNEL_ID, matchedBoss.id).catch(console.warn);
          console.log(`[agent] auto-killed ${matchedBoss.name} from ${character || '?'} agent upload`);
        } else {
          console.log(`[agent] ${matchedBoss.name} already on cooldown — parse recorded, no timer change`);
        }
      } else {
        console.log(`[agent] no bosses.json match for "${encounter.boss_name}" — parse not stored locally`);
      }
    }
  } catch (err) {
    console.warn('[agent] local parse write failed:', err?.message);
  }

  // ── Best-effort Supabase write. Falls through silently if Supabase isn't set up ──
  try {
    const supabase = require('./utils/supabase');
    if (supabase.isEnabled() && encounter.boss_name) {
      const rawParse = {
        bossName:   encounter.boss_name,
        duration,
        totalDamage,
        totalDps,
        players,
        eventCount: encounter.events.length,
        // Boss self-heal accumulated by the agent's EncounterBuilder. Surfaced
        // on parse cards as "27.1k (+10k healed)" for Complete-Healing bosses.
        // Undefined for older agents (<2.5.3) so it gracefully no-ops.
        npcHealedTotal: encounter.npc_healed_total || undefined,
      };

      // Prefer the bossId from bosses.json match; fall back to slugified name lookup
      const slug = (encounter.boss_name || '').toLowerCase().replace(/\W+/g, '_');
      const bossInternalId = matchedBoss?.id || slug;
      const localMatches = await supabase.select(
        'bosses_local',
        `internal_id=eq.${encodeURIComponent(bossInternalId)}&select=internal_id&limit=1`
      );
      if (Array.isArray(localMatches) && localMatches.length) {
        const recParseResult = await supabase.recordParse({
          bossInternalId,
          parsed: rawParse,
          timestampMs: startedMs,
          contributorDiscordId: null,
          contributorCharacter: character || null,
          source: 'local_agent_v1',
          agentVersion: payload?.agent_version || null,
          rollupByChar: encounter.rollup?.by_char || null,
          npcHealedTotal: encounter.npc_healed_total || 0,
        }).catch(err => { console.warn('[agent] recordParse failed:', err?.message); return null; });

        // Persist charm sessions for this encounter. Upsert dedup'd by
        // (guild_id, pet_name, owner, started_at) so re-uploads from
        // backfill don't duplicate rows.
        if (recParseResult?.encounterId && Array.isArray(encounter.charm_sessions) && encounter.charm_sessions.length > 0) {
          const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
          const charmRows = encounter.charm_sessions.map(s => ({
            guild_id:      guildId,
            pet_name:      s.pet,
            owner:         s.owner,
            started_at:    new Date(s.started_at).toISOString(),
            ended_at:      s.ended_at ? new Date(s.ended_at).toISOString() : null,
            duration_sec:  s.duration_sec || null,
            total_damage:  s.total_damage || 0,
            is_dire_charm: !!s.is_dire_charm,
            encounter_id:  recParseResult.encounterId,
            end_reason:    s.end_reason || null,
            uploaded_by:   character || null,
          }));
          try {
            await supabase.upsert('charm_sessions', charmRows, 'guild_id,pet_name,owner,started_at');
          } catch (err) {
            console.warn('[agent] charm_sessions upsert failed:', err?.message);
          }
        }
      } else {
        console.log(`[agent] no bosses_local match for "${bossInternalId}" — encounter not persisted to Supabase`);
      }
    }
  } catch (err) {
    console.warn('[agent] supabase write failed:', err?.message);
  }

  // Characters the bot wants extra coverage on (comma-separated env var).
  // Agents highlight these in blue on the [O] historical opt-in screen.
  const requestedChars = (process.env.REQUESTED_AGENT_CHARACTERS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  _trackUpload({
    endpoint:      'encounter',
    character:     payload?.character,
    agentVersion:  payload?.agent_version,
    payloadBytes:  total,
    agentState:    payload?.agent_state || null,
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    events_received:       encounter.events.length,
    matched_boss:          matchedBoss?.id || null,
    // Advertise the current expected agent version so agents can show an update prompt.
    // Set LATEST_AGENT_VERSION env var when deploying a new agent build.
    latest_agent_version:  _currentAgentVersion(),
    requested_characters:  requestedChars,
  }));
}

http.createServer(async (req, res) => {
  // Agent upload endpoint
  // Auto-derive the current agent version from the agent's package.json so we
  // don't have to bump a LATEST_AGENT_VERSION env var every release. The env
  // var still takes precedence if set (e.g. for canary rollouts).
  // Cached on first call since the file doesn't change between deploys.
  // (Defined at module scope below.)

  // Lightweight version probe — agents poll this every ~10 minutes to learn
  // about new releases without needing to upload an encounter first.
  if (req.method === 'GET' && req.url === '/api/agent/latest-version') {
    // Now returns the full update manifest { latest_agent_version, url, sha256 }
    // for the self-updating supervisor. Older agents read only
    // latest_agent_version and ignore the extra fields, so this is additive.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(_agentManifest()));
  }

  // Officer-filed backfill requests — agent polls per character, picks up
  // pending rows, acks/completes/errors/dismisses. Filed via /admin/encounters.
  if (req.url.startsWith('/api/agent/backfill-requests')) {
    try { return await _handleAgentBackfillRequests(req, res); }
    catch (err) {
      console.error('[backfill-requests] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // Guild triggers — officer-tuned raid callouts. Agents poll this every
  // ~10 min for the enabled trigger set, merge with personal triggers
  // from local disk, evaluate against the live log tail. Filed via
  // /admin/triggers.
  if (req.method === 'GET' && req.url.startsWith('/api/agent/guild-triggers')) {
    try { return await _handleAgentGuildTriggers(req, res); }
    catch (err) {
      console.error('[guild-triggers] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // Incomplete-encounter list — agent polls this per logged-in character to
  // decide whether to show the "we need your logs" banner. Returns the set
  // of encounters flagged data_incomplete that the queried character was in.
  // Bearer-auth gated like the other agent endpoints.
  if (req.method === 'GET' && req.url.startsWith('/api/agent/incomplete-encounters')) {
    try { return await _handleAgentIncomplete(req, res); }
    catch (err) {
      console.error('[incomplete] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/agent/character-prefs')) {
    try { return await _handleAgentCharacterPrefs(req, res); }
    catch (err) {
      console.error('[character-prefs] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/tells') {
    try { return await _handleAgentTells(req, res); }
    catch (err) {
      console.error('[tells] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/encounter') {
    try { return await _handleAgentUpload(req, res); }
    catch (err) {
      console.error('[agent] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // Guild/raid chat relay endpoint — forwards in-game chat to Discord channels
  if (req.method === 'POST' && req.url === '/api/agent/chat') {
    try { return await _handleAgentChat(req, res); }
    catch (err) {
      console.error('[chat-relay] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // PVP broadcast relay — posts PvP kills/deaths to PVP_CHANNEL_ID
  if (req.method === 'POST' && req.url === '/api/agent/pvp') {
    try { return await _handleAgentPvp(req, res); }
    catch (err) {
      console.error('[pvp-relay] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // Druzzil Ro boss-kill relay — auto-sets spawn timers from instance kill announcements
  if (req.method === 'POST' && req.url === '/api/agent/bosskill') {
    try { return await _handleAgentBossKill(req, res); }
    catch (err) {
      console.error('[bosskill] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // /sll lockout relay — sets timers from active personal lockouts (never clears on "Available")
  if (req.method === 'POST' && req.url === '/api/agent/lockout') {
    try { return await _handleAgentLockout(req, res); }
    catch (err) {
      console.error('[lockout] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // Historical chat ingestion — backfill writes to data/historical_chat.jsonl + Supabase
  if (req.method === 'POST' && req.url === '/api/agent/historical_chat') {
    try { return await _handleAgentHistoricalChat(req, res); }
    catch (err) {
      console.error('[historical-chat] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // Fun-events ingestion — Peopleslayer LD counter, future CoH/DI/Aegolism/Rune.
  // Each event upserts into the fun_events table; the unique constraint on
  // (guild_id, event_type, caster, event_ts) silently dedups replays.
  if (req.method === 'POST' && req.url === '/api/agent/fun_event') {
    try { return await _handleAgentFunEvent(req, res); }
    catch (err) {
      console.error('[fun-event] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // Default: health check
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
})
  .listen(process.env.PORT || 3000, () =>
    console.log(`[health] HTTP check + agent endpoint on :${process.env.PORT || 3000}`)
  );

client.login(process.env.DISCORD_TOKEN);
