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
  getActivePvpNightUserIds,
  recordPvpKill, setPvpKillThreadMessageId,
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
const { getDefaultTz, msUntilMidnightInTz, isPvpQuietHours } = require('./utils/timezone');

// During PvP quiet hours, automated @PVP pings go to the opt-in list only
// (see commands/pvpnightpings.js). Returns the user-mention string for everyone
// currently entitled to overnight pings, or '' if nobody opted in (full mute).
function pvpQuietMention() {
  try {
    const ids = getActivePvpNightUserIds();
    return ids.length ? ids.map(id => `<@${id}>`).join(' ') : '';
  } catch { return ''; }
}
const {
  buildZoneKillCard, buildSpawnAlertEmbed, buildSpawnedEmbed,
  buildDailySummaryEmbed,
} = require('./utils/embeds');
const {
  postKillUpdate, postOrUpdateExpansionBoard,
} = require('./utils/killops');
const { hasAllowedRole, allowedRolesList, hasOfficerRole, officerRolesList } = require('./utils/roles');
const mimicLink = require('./utils/mimicLink');
const { EXPANSION_ORDER, getThreadId, getBossExpansion, isPopLocked } = require('./utils/config');
const { discordAbsoluteTime, discordRelativeTime } = require('./utils/timer');

function getBosses() {
  delete require.cache[require.resolve('./data/bosses.json')];
  return require('./data/bosses.json');
}

// ── Client ─────────────────────────────────────────────────────────────────
// GuildVoiceStates is required for @discordjs/voice — without it the
// voiceAdapterCreator never receives VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE
// from Discord and joinVoiceChannel hangs in "Connecting" forever. Symptom
// was /voicetest queueing fine but the bot never appearing in the channel.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates] });

// Voice gateway diagnostic. discord.js emits `[VOICE]` debug lines whenever
// Discord pushes VOICE_STATE_UPDATE or VOICE_SERVER_UPDATE for our bot.
// When a join fails at the `signalling → ?` step (state never advances
// past signalling), the truth lives in whether Discord ever sent these
// events back. If we see VOICE_STATE_UPDATE+VOICE_SERVER_UPDATE but the
// connection still didn't advance, it's an @discordjs/voice / adapter
// bug. If we see NEITHER, Discord rejected the join (perms on the
// channel, channel full, bot already routed elsewhere, etc).
client.on('debug', msg => {
  if (msg && msg.includes('[VOICE]')) console.log('[discord.js voice]', msg);
});
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (newState.member?.user?.id !== client.user?.id) return;   // only OUR voice state
  console.log(`[voice-state-update] bot moved: channel=${oldState.channelId} → ${newState.channelId} (session=${newState.sessionId})`);
});

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

  // One-shot backfill: mirror every in-memory state.pvpKills entry into
  // public.pvp_boss_kills so the web /pvp board reflects the bot's live
  // timers on first deploy after this lands. Idempotent via dedup_key — the
  // upsert collapses any duplicate run. Bosses with timer_unknown are
  // skipped (no useful spawn window to publish).
  try {
    const { getAllPvpKills } = require('./utils/state');
    const supabase = require('./utils/supabase');
    if (supabase.isEnabled()) {
      const bosses = getBosses();
      const byId = new Map(bosses.map(b => [b.id, b]));
      const live = getAllPvpKills() || {};
      let mirrored = 0;
      for (const [key, entry] of Object.entries(live)) {
        if (!entry || entry.timerUnknown || !entry.killedAt || !entry.timerHours) continue;
        const meta = byId.get(entry.bossId || key);
        await supabase.mirrorPvpBossKill({
          boss_id:     entry.bossId || key,
          boss_name:   entry.name,
          zone:        meta?.zone || null,
          timer_hours: entry.timerHours,
          killed_at:   new Date(entry.killedAt).toISOString(),
          recorded_by: typeof entry.killedBy === 'string' && /^\d{17,20}$/.test(entry.killedBy) ? entry.killedBy : null,
          source:      'backfill',
        }).catch(() => {});
        mirrored++;
      }
      if (mirrored > 0) console.log(`[pvp-board] mirrored ${mirrored} live boss timers to Supabase`);
    }
  } catch (err) {
    console.warn('[pvp-board] startup backfill failed:', err?.message);
  }

  // Safety-net board reconcile from Supabase encounters every 6h. Cheap when
  // nothing drifted (it only writes/refreshes when it finds kills not yet
  // reflected in state), so steady-state this is a no-op; it self-heals the
  // board after a missed update or volume loss between deploys.
  setInterval(() => {
    try {
      const { reconcileKillsFromSupabase } = require('./utils/reconcileKills');
      reconcileKillsFromSupabase({ client: readyClient })
        .then(r => { if (r.ok && r.recoverList.length) console.log(`[reconcile] recovered ${r.recoverList.length} timer(s) from ${r.scanned} encounter(s)`); })
        .catch(err => console.warn('[reconcile] interval failed:', err?.message));
    } catch (err) { console.warn('[reconcile] interval init failed:', err?.message); }
  }, 6 * 60 * 60 * 1000);

  // who_overrides → state.whoData. Officers curate class + Zek on the web
  // (/admin/who) and via /markzek; pull those overrides in at startup and
  // refresh every 30 min so a web-set flag flows into /whois + PvP auto-zek
  // without a redeploy. Override-wins is enforced in mergeWhoData.
  const _loadWhoOverrides = () => {
    try {
      const sb = require('./utils/supabase');
      if (!sb.isEnabled()) return;
      const { applyWhoOverrides } = require('./utils/state');
      sb.getWhoOverrides()
        .then(rows => { const n = applyWhoOverrides(rows); if (n) console.log(`[who] applied ${n} override(s) from who_overrides`); })
        .catch(err => console.warn('[who] override load failed:', err?.message));
    } catch (err) { console.warn('[who] override load init failed:', err?.message); }
  };
  setTimeout(_loadWhoOverrides, 8_000);
  setInterval(_loadWhoOverrides, 30 * 60 * 1000);

  // Web-feedback relay: submissions from wolfpack.quest/feedback land in the
  // `feedback` table with discord_msg_id NULL. Post each into the #feedback
  // thread (same as the /feedback command) and stamp the id/link so it isn't
  // re-posted. Initial run after a short delay, then every 45s.
  setTimeout(() => relayWebFeedback(readyClient).catch(() => {}), 12_000);
  setInterval(() => relayWebFeedback(readyClient).catch(() => {}), 45_000);

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

  // Reconcile spawn timers from Supabase `encounters` — the authoritative kill
  // record — so the board reflects real kills (parses/agent uploads) instead of
  // showing everything "Available now" after a volume wipe. Upgrade-only: it
  // never downgrades a fresher state row, so it complements the Discord-sourced
  // runAutoRestore above. Runs after runBoard so the cards exist to update.
  try {
    const { reconcileKillsFromSupabase } = require('./utils/reconcileKills');
    const r = await reconcileKillsFromSupabase({ client: readyClient });
    if (r.ok) console.log(`[startup] reconcile: recovered ${r.recoverList.length} timer(s) from ${r.scanned} encounter(s) scanned`);
    else      console.log(`[startup] reconcile skipped: ${r.reason}`);
  } catch (err) { console.warn('[startup] reconcile failed:', err?.message); }

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
    if (interaction.customId === 'pvpnight_tonight')            { const { handleNightTonight } = require('./commands/pvpnightpings'); await handleNightTonight(interaction); return; }
    if (interaction.customId === 'pvpnight_always')             { const { handleNightAlways }  = require('./commands/pvpnightpings'); await handleNightAlways(interaction);  return; }
    if (interaction.customId === 'pvpnight_remove')             { const { handleNightRemove }  = require('./commands/pvpnightpings'); await handleNightRemove(interaction);  return; }
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
    if (interaction.customId === 'token_mint')                  { const { handleTokenMint }   = require('./commands/token'); await handleTokenMint(interaction);   return; }
    if (interaction.customId.startsWith('token_revoke:'))        { const { handleTokenRevoke } = require('./commands/token'); await handleTokenRevoke(interaction); return; }
    if (interaction.customId === 'parsehelp_guide')             { const { handleParseHelpGuide } = require('./commands/parsehelp'); await handleParseHelpGuide(interaction); return; }
    if (interaction.customId.startsWith('parsehelp_step:'))      { const { handleParseHelpStep }  = require('./commands/parsehelp'); await handleParseHelpStep(interaction);  return; }
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
// Source of truth is the MESSAGE itself, not state.json. The previous version
// read the howler list from `pvpAlerts[messageId].howlers` in state, which got
// wiped on every redeploy / state restore — so a fresh howl on a still-live
// message would render with just the new clicker (the prior howlers vanished
// from the rebuilt line). The Discord message already records every prior
// howler in its content (as `<@id>` mentions on the howl line), so parse that
// and append. Stateless, redeploy-proof, and the message is always correct.
const HOWL_LINE_RX = /howls? back!/;
async function handlePvpAlertHowl(interaction) {
  const origMsg = interaction.message;
  // Parse existing howler IDs from the message — they live as <@id> mentions
  // on the howl line ("X howls back!" / "X and Y howl back!" / Oxford-comma).
  const existingLine = (origMsg.content || '').split('\n').find(l => HOWL_LINE_RX.test(l)) || '';
  const existingIds  = [...existingLine.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
  // Append the clicker if they're not already in the list.
  const userId  = interaction.user.id;
  const howlers = existingIds.includes(userId) ? existingIds : [...existingIds, userId];

  // Rebuild the Oxford-comma howl line from the merged set.
  const mentions = howlers.map(id => `<@${id}>`);
  let howlLine;
  if (mentions.length === 1)      howlLine = `${mentions[0]} howls back!`;
  else if (mentions.length === 2) howlLine = `${mentions[0]} and ${mentions[1]} howl back!`;
  else                            howlLine = `${mentions.slice(0, -1).join(', ')}, and ${mentions[mentions.length - 1]} howl back!`;

  const baseContent = (origMsg.content || '').split('\n').filter(l => !HOWL_LINE_RX.test(l)).join('\n');
  try {
    // Don't ping the mentioned howlers again on every edit — only the original
    // @PVP role ping in the base content matters; their names here are just
    // the running tally.
    await origMsg.edit({
      content:         `${baseContent}\n${howlLine}`,
      components:      origMsg.components,
      allowedMentions: { parse: [] },
    });
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
          // Quiet hours (default 1am–8am): instead of pinging the whole role,
          // ping only the overnight opt-in list (empty = silent). Manual rallies
          // are unaffected. See commands/pvpnightpings.js.
          const mention     = isPvpQuietHours()
            ? pvpQuietMention()
            : (pvpRole ? `<@&${pvpRole.id}>` : '');
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
        // Quiet hours: ping only the overnight opt-in list (empty = silent).
        const mention     = isPvpQuietHours()
          ? pvpQuietMention()
          : (pvpRole ? `<@&${pvpRole.id}>` : '');
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
// Window is 60s (was 5s): agents flush their chat buffers on independent 5s
// timers and network/queue latency can space two perspectives of the same
// line many seconds apart, so a 5s window let dupes through. 60s is still far
// shorter than anyone re-typing the exact same /gu line, so genuine repeats
// aren't suppressed.
const CHAT_DEDUP_WINDOW_MS = 60_000;
const _chatDedup = new Map(); // key: "channel|speaker|normtext" → timestamp
// Relay-only dedup. The same in-game line captured by two different uploaders
// can arrive with DIFFERENT speaker attribution (self "You say to your guild"
// vs third-person "Canopy tells the guild", or a multi-log mis-attribution) —
// so the speaker-keyed dedup above sees two distinct keys and double-posts to
// Discord. This text-only window collapses the relay POST regardless of who it
// was attributed to. It deliberately does NOT gate the Supabase mirror, which
// keeps every per-speaker perspective for CH-chain / attribution analysis.
// Agents flush chat ~every 5s, so 12s absorbs cross-agent arrival jitter while
// still letting a genuinely distinct later repeat through.
const CHAT_RELAY_DEDUP_WINDOW_MS = 12_000;
const _chatRelayDedup = new Map(); // key: "channel|normtext" → timestamp
// Trigger-broadcast dedup: every raider's agent fires the same trigger (e.g. a
// boss rampage), so collapse by guild|key within a short window — one Discord
// post per event. The key is the trigger's own dedup key ("rampage:<target>").
const TRIGGER_DEDUP_WINDOW_MS = 10_000;
const _triggerDedup = new Map();   // key: "guild|key" → timestamp
// Light per-uploader rate cap so a misbehaving agent can't flood the channel
// with DISTINCT messages (the dedup above only collapses identical keys).
const TRIGGER_RATE_WINDOW_MS = 60_000;
const TRIGGER_RATE_MAX       = 30;  // posts per uploader per window
const _triggerRate = new Map();    // discordId → [timestamps]

// ── Cross-Mimic trigger relay (fan-out) ─────────────────────────────────────
// When one raider's Mimic detects a guild trigger but ANOTHER raider's log
// missed it (zoning, partial log capture, player-targeted line like a
// debuff that lands on you only), the second Mimic doesn't fire. The
// relay closes that gap: detecting Mimic POSTs to /api/agent/trigger-relay,
// bot stores in this ring buffer, every other Mimic polls
// /api/agent/recent-fires every ~1.5s and runs the same actions locally
// (overlay + TTS + visible timer row) as if it had detected the trigger
// itself. Cross-agent dedup is by (trigger name + captures) inside an 8s
// window so duplicates don't echo. Buffer caps at 200 entries and prunes
// older than 60s. In-memory only — a bot restart loses the in-flight
// queue, which is fine because the source-of-truth is still each
// Mimic's own log tail.
const TRIGGER_RELAY_TTL_MS         = 60_000;
const TRIGGER_RELAY_MAX_ENTRIES    = 200;
const TRIGGER_RELAY_DEDUP_WINDOW_MS = 8_000;
const _triggerRelay = {
  nextId:  1,
  entries: [],   // { id, name, key, captures, actions, timer_duration_sec, fired_at_ms, posted_at_ms, uploaded_by }
};
setInterval(() => {
  const cutoff = Date.now() - TRIGGER_RELAY_TTL_MS;
  _triggerRelay.entries = _triggerRelay.entries.filter(e => e.posted_at_ms >= cutoff);
}, 15_000);

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _chatDedup)      if (v < now - CHAT_DEDUP_WINDOW_MS)       _chatDedup.delete(k);
  for (const [k, v] of _chatRelayDedup) if (v < now - CHAT_RELAY_DEDUP_WINDOW_MS) _chatRelayDedup.delete(k);
  for (const [k, v] of _triggerDedup)   if (v < now - TRIGGER_DEDUP_WINDOW_MS)    _triggerDedup.delete(k);
  for (const [k, arr] of _triggerRate) {
    const kept = arr.filter(t => now - t < TRIGGER_RATE_WINDOW_MS);
    if (kept.length) _triggerRate.set(k, kept); else _triggerRate.delete(k);
  }
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

// Fire-and-forget — bump a per-(character, endpoint) COUNTER in
// agent_upload_stats so the /admin/agents board (and /me upload panel) can show
// who is uploading what, when, on what version, and error counts. This replaced
// the old row-per-upload `agent_uploads` log, which grew ~30k rows/day and was
// the fastest path to the Supabase free-tier cap. The RPC upserts + increments
// in one call. Best-effort: failures are warned and swallowed so the upload
// response is never blocked on the metadata write. (payloadBytes is no longer
// stored — the counter doesn't track per-upload bytes.)
function _trackUpload({ endpoint, character, agentVersion, ok = true, statusCode = 200, errorMessage = null, payloadBytes = null, agentState = null, uploadedBy = null }) {
  void payloadBytes;
  try {
    const supabase = require('./utils/supabase');
    if (!supabase.isEnabled()) return;
    supabase.rpc('bump_agent_upload_stat', {
      p_guild:       process.env.SUPABASE_GUILD_ID || 'wolfpack',
      p_character:   character || null,
      p_endpoint:    endpoint,
      p_version:     agentVersion || null,
      p_ok:          !!ok,
      p_status:      statusCode,
      p_error:       errorMessage,
      p_agent_state: agentState,
      p_uploaded_by: uploadedBy || null,
    }).catch(err => console.warn('[agent-uploads] stat bump failed:', err?.message));
  } catch (err) {
    console.warn('[agent-uploads] track failed:', err?.message);
  }
}

async function _handleAgentChat(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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

    // Dedup: same speaker + text = multiple parsers saw the same line.
    // CRITICAL: normalize the text in the key. EQ shows the SPEAKER their own
    // /gu line lowercase-as-typed ("man both of you guys lol") but broadcasts
    // an auto-capitalized version to every BYSTANDER ("Man both of you guys
    // lol"). With multiple agents running, both casings arrive and a raw-text
    // key fails to dedup → the message double-posts. Lowercasing + collapsing
    // whitespace in the KEY (display text keeps original casing) closes it.
    const normText = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
    const key = `${channel}|${speaker.toLowerCase()}|${normText}`;
    if (_chatDedup.has(key)) continue;
    _chatDedup.set(key, Date.now());

    // Relay-only dedup keyed on text alone (ignores speaker) — see the
    // _chatRelayDedup comment. If another uploader already relayed this exact
    // line within the window, still record the Supabase perspective below but
    // skip the duplicate Discord post.
    const relayKey      = `${channel}|${normText}`;
    const alreadyRelayed = _chatRelayDedup.has(relayKey);
    _chatRelayDedup.set(relayKey, Date.now());

    // Stage for chat_messages upsert. Same shape as historical_chat path so
    // the table has one canonical row format regardless of ingestion route.
    supabaseChatRows.push({
      guild_id:    process.env.SUPABASE_GUILD_ID || 'wolfpack',
      ts:          msgTs || new Date().toISOString(),
      channel,
      speaker,
      text:        String(text).slice(0, 2000),
      who:         uploadedWho || null,
      uploaded_by: identity.discord_id,
    });

    // Class/level tag: try server-side whoData first, fall back to what the agent sent.
    // Only render the tag when we actually have level/race/class content —
    // otherwise an empty whoEntry produced a bare " []" after the name
    // (the bug behind "Wabumkin []: no :(").
    const { getWhoEntry } = require('./utils/state');
    const whoEntry = getWhoEntry(speaker) || uploadedWho || null;
    const whoBits  = whoEntry ? [whoEntry.level, whoEntry.race, whoEntry.class].filter(Boolean) : [];
    const whoTag   = whoBits.length ? ` [${whoBits.join(' ')}]` : '';

    // Another uploader already relayed this exact line to Discord within the
    // window — corpus row was recorded above; skip the duplicate post.
    if (alreadyRelayed) continue;

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
        // Passive loot detection — scan each chat row for EQ item-link IDs (the
        // 7-digit zero-padded form). For any IDs found, look up the most recent
        // boss kill within a ~15min window and cross-reference against the
        // mob's published drop table; matches get recorded in loot_observations.
        // This is the workhorse that the rarely-used /loot command was supposed
        // to populate — passive + officer-agnostic + auto-validated by the drop
        // table. Fire-and-forget so it never blocks the chat relay.
        for (const row of supabaseChatRows) {
          _maybeRecordChatLoot(row, identity.discord_id).catch(err =>
            console.warn('[chat-loot] detect failed:', err?.message));
        }
      }
    } catch (err) {
      console.warn('[chat-relay] supabase mirror failed:', err?.message);
    }
  }

  _trackUpload({ endpoint: 'chat', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
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

// Dedup cache: when multiple LIVE parsers (different machines) see the same
// Druzzil Ro broadcast, each uploads it independently within ~1-2s of each
// other. We collapse those to one Discord post + one ledger row.
//
// Key = normalized text + a coarse 15-second time bucket. The bucket is what
// keeps DISTINCT kills apart: two observers of ONE kill land in the same
// bucket (deduped), but the same killer killing the same victim in the same
// zone on a DIFFERENT day is many buckets away (kept). This is the fix for
// the regression where a pure text-only key collapsed a backfill's worth of
// identical-text historical kills into one row (Malthur's "1 kill" bug).
//
// CRITICAL: backfill uploads skip this entirely (see _isPvpDupe). A backfill
// replays months of kills in one batch — wall-clock Date.now() bucketing is
// meaningless for them, and the pvp_kills DB dedup_key (which includes the
// kill's real second-granular timestamp) already guarantees idempotency.
const _recentPvpBroadcasts = new Map();
const PVP_DEDUP_BUCKET_MS = 15_000;
function _pvpNorm(b) {
  return String(b?.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function _pvpBucket(b) {
  const tms = b?.ts ? new Date(b.ts).getTime() : Date.now();
  return Math.floor(tms / PVP_DEDUP_BUCKET_MS);
}
function _isPvpDupe(b) {
  // Backfill is idempotent via the DB dedup_key (real timestamp). Never let
  // the in-memory wall-clock dedup collapse distinct historical kills.
  if (b?.backfill) return false;
  const now = Date.now();
  for (const [k, exp] of _recentPvpBroadcasts) {
    if (exp < now) _recentPvpBroadcasts.delete(k);
  }
  const norm = _pvpNorm(b);
  if (!norm) return false;
  const bucket = _pvpBucket(b);
  // Check the current bucket AND its neighbors so two observers whose
  // timestamps straddle a 15s boundary still collapse to one.
  for (const nb of [bucket - 1, bucket, bucket + 1]) {
    if (_recentPvpBroadcasts.has(`${nb}|${norm}`)) return true;
  }
  _recentPvpBroadcasts.set(`${bucket}|${norm}`, now + 5 * 60_000);
  return false;
}

// Note: earlier versions had a rate-limited "@PVP fyi-ping" on non-WP
// deaths plus a raid-window suppressor. Per Dant's feedback ("don't like
// getting a ping every kill"), all non-WP-involvement events now post
// silently as plain death notices. Pings are reserved for Wolf Pack kills
// + Wolf Pack deaths only.

async function _handleAgentPvp(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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
  // Fun-counter rows emitted alongside the kill ledger — currently just Lord
  // of Ire kills by Wolf Pack members. Upserted to fun_events at the end so a
  // failure here can never lose a PvP post or ledger row.
  const funEventRows = [];
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
    const zone = b?.zone || null;
    for (const side of ['victim', 'killer']) {
      const name  = b?.[side];
      const guild = b?.[`${side}Guild`];
      // Drop empty + NPC killers. A null/empty guild is OK — some broadcasts
      // genuinely lack it; we still want the name + zone observation.
      if (!name) continue;
      if (side === 'killer' && b?.killer_is_npc) continue;
      if (guild === WP_GUILD_NAME) continue;     // WP members already in roster
      harvestedRows.push({
        name,
        guild: guild || null,
        zone,
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
          zone:        w.zone,
          observed_at: new Date(w.observedAt).toISOString(),
          uploaded_by: 'pvp-relay',
        }));
        supabase.upsert('who_observations', rows, 'guild_id,character,observed_minute,uploaded_by')
          .then(() => supabase.rpc('flag_zek_proximity_recent', {
            p_guild_id: process.env.SUPABASE_GUILD_ID || 'wolfpack',
          }).catch(err => console.warn('[pvp-relay] zek proximity rescan failed:', err?.message)))
          .catch(err => console.warn('[pvp-relay] who-obs upsert failed:', err?.message));
      }
    } catch (err) {
      console.warn('[pvp-relay] supabase mirror failed:', err?.message);
    }
  }

  for (const b of broadcasts) {
    if (_isPvpDupe(b)) { deduped++; continue; }
    const { killType, victim, victimGuild, killer, killerGuild, zone, text } = b || {};
    // Defense-in-depth (for agents pre-dating the agent-side guard): a guild
    // PvE INSTANCE kill ("...in <Zone> (Instanced)!") is not a PvP-server boss
    // kill. It arrives via the /bosskill path as a normal instance timer — so
    // skip it here entirely (no PvP ping, no ±20% PvP timer, no ledger row).
    if (/\(Instanced\)/i.test(zone || '') || /\(Instanced\)/i.test(text || '')) { deduped++; continue; }
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
          uploaded_by_discord_id: identity.discord_id,
        });
      }

      // Quiet hours (default 1am–8am): keep posting the kill/death cards, but
      // ping only the overnight opt-in list instead of the whole @PVP role so
      // live-server skirmishes don't wake the pack. Resolves to the opt-in
      // mentions (trailing space) or '' when nobody opted in.
      const pvpQuiet = isPvpQuietHours();
      const _qm = pvpQuiet ? pvpQuietMention() : '';
      const _pvpQuietPing = _qm ? _qm + ' ' : '';
      let content;
      if (isWpKill) {
        // Celebrate — Wolf Pack got a PvP kill. Ping @PVP so the pack joins the
        // howl. The previous "no ping on our kills" rule (Dant, 2026-06-01) is
        // reversed: Wolf Pack PvP kills are the rallying moment, not the
        // afk-able ones. Deaths still ping for backup; other-guild / NPC kills
        // remain informational with no mention.
        const pvpRole = ch.guild?.roles.cache.find(r => r.name === pvpRoleName);
        const mention = pvpQuiet ? _pvpQuietPing : (pvpRole ? `<@&${pvpRole.id}> ` : '');
        content = `${mention}⚔️ **${killer}** of <${killerGuild}> killed **${victim}** of <${victimGuild}> in ${zone}! AWROOOO!`;
      } else if (isWpDeath) {
        // Request backup — Wolf Pack member was killed
        const pvpRole = ch.guild?.roles.cache.find(r => r.name === pvpRoleName);
        const mention = pvpQuiet ? _pvpQuietPing : (pvpRole ? `<@&${pvpRole.id}> ` : '');
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

      // Auto-record PvP boss respawn timer when the broadcast names a known
      // boss from data/bosses.json. PvP boss respawns are server-wide — they
      // tick whether Wolf Pack made the kill or another guild did — so we
      // record on ANY guild's boss kill. Detected as: killType='pvp' with no
      // victimGuild (PVP_BOSS_KILL_ACTIVE_RX shape: "X of <G> has killed Boss
      // [in Zone]!"). Auto-records call recordPvpKill with the broadcast
      // timestamp so the ±20% window is anchored to when the kill actually
      // happened, not when the relay landed.
      if (killType === 'pvp' && !victimGuild && victim) {
        try {
          delete require.cache[require.resolve('./data/bosses.json')];
          const bosses = require('./data/bosses.json');
          const needle = String(victim).trim().toLowerCase();
          const candidates = bosses.filter(b =>
            b.name.toLowerCase() === needle ||
            (b.nicknames || []).some(n => String(n).toLowerCase() === needle)
          );
          if (candidates.length === 1) {
            const boss = candidates[0];
            const existing = getAllPvpKills()[boss.id];
            // Don't overwrite a fresh active timer — only auto-record when there
            // is no existing entry or the previous one's window has expired.
            const alreadyActive = existing
              && !existing.timerUnknown
              && existing.nextSpawnLatest > Date.now();
            if (!alreadyActive) {
              const killedAtMs = b?.ts ? new Date(b.ts).getTime() : Date.now();
              const killedByLabel = `auto:${killer || '?'}${killerGuild ? '/' + killerGuild : ''}`;
              recordPvpKill(boss.name, boss.timerHours, killedByLabel, boss.id, false, killedAtMs);
              // Mirror to Supabase so wolfpack.quest/pvp can render the timer
              // board. Failure here is non-fatal — state.json is the source of
              // truth for the bot's own /timers, /pvphate, etc.
              require('./utils/supabase').mirrorPvpBossKill({
                boss_id:         boss.id,
                boss_name:       boss.name,
                zone:            boss.zone || null,
                timer_hours:     boss.timerHours,
                killed_at:       new Date(killedAtMs).toISOString(),
                killed_by:       killer || null,
                killed_by_guild: killerGuild || null,
                source:          'auto_broadcast',
                raw_text:        text,
              }).catch(() => {});
              content += `\n_⏱️ Auto-tracked — respawns in ~${boss.timerHours}h (±20%) · see /timers_`;

              // Post a richer card to PVP_KILLS_THREAD_ID mirroring /pvpkill.
              const killsThreadId = process.env.PVP_KILLS_THREAD_ID;
              if (killsThreadId) {
                try {
                  const { EmbedBuilder } = require('discord.js');
                  const entry = getAllPvpKills()[boss.id];
                  const embed = new EmbedBuilder()
                    .setColor(0xcc0000)
                    .setTitle(`🗡️ PVP Kill — ${boss.name}`)
                    .setDescription('Auto-recorded from PvP server broadcast.')
                    .addFields(
                      { name: 'Zone',       value: boss.zone, inline: true },
                      { name: 'Killed by',  value: `${killer || '?'}${killerGuild ? ' of <' + killerGuild + '>' : ''}`, inline: true },
                      { name: 'Base Timer', value: `${boss.timerHours}h (±20%)`, inline: true },
                      { name: '⏰ Earliest Spawn',
                        value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`,
                        inline: false },
                      { name: '⏳ Latest Spawn',
                        value: `${discordAbsoluteTime(entry.nextSpawnLatest)} (${discordRelativeTime(entry.nextSpawnLatest)}) — guaranteed by this time`,
                        inline: false },
                    )
                    .setTimestamp();
                  const thread = await client.channels.fetch(killsThreadId);
                  const msg = await thread.send({ embeds: [embed] });
                  setPvpKillThreadMessageId(boss.id, msg.id);
                } catch (err) {
                  console.warn('[pvp-auto] could not post kill card:', err?.message);
                }
              }
            }
          } else if (candidates.length > 1) {
            console.warn(`[pvp-auto] ambiguous boss match for "${victim}" (${candidates.length} candidates in bosses.json) — skipping auto-record. Use /pvpkill to disambiguate.`);
          }
        } catch (err) {
          console.warn('[pvp-auto] boss-kill auto-record failed:', err?.message);
        }
      }

      // Lord of Ire fun counter — when a Wolf Pack member kills "Lord of Ire"
      // (the Plane of Hate instance boss), emit a fun_events row so /fun and
      // /me can show a per-killer scoreboard. Detected from the broadcast's
      // victim+killer fields so it survives any text-format variation; we
      // dedupe at the table via (guild_id, event_type, caster, event_ts).
      if (
        killerGuild === WP_GUILD_NAME
        && killer
        && typeof victim === 'string'
        && /^\s*lord\s+of\s+ire\s*$/i.test(victim)
      ) {
        funEventRows.push({
          guild_id:   process.env.SUPABASE_GUILD_ID || 'wolfpack',
          event_ts:   b?.ts || new Date().toISOString(),
          event_type: 'lord_of_ire_killed',
          caster:     killer,
          target:     'Lord of Ire',
          raw_text:   (text || '').slice(0, 300),
          uploaded_by_discord_id: identity.discord_id,
        });
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

  // Persist any fun-event counters (Lord of Ire kills, etc.). Dedup'd on
  // (guild_id, event_type, caster, event_ts) so replays from multiple agents
  // collapse to one row.
  if (funEventRows.length > 0) {
    try {
      const supabase = require('./utils/supabase');
      if (supabase.isEnabled()) {
        await supabase.upsert('fun_events', funEventRows, 'guild_id,event_type,caster,event_ts')
          .catch(err => console.warn('[pvp-relay] fun_events upsert failed:', err?.message));
      }
    } catch (err) {
      console.warn('[pvp-relay] fun_events persist wrap failed:', err?.message);
    }
  }

  _trackUpload({ endpoint: 'pvp', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, posted, deduped, kills_recorded: pvpKillRows.length }));
}

// POST /api/agent/pvp_assists — receive correlated assist events from the
// agent. Agent has already computed the (assister, victim, killer, gap)
// tuple from its own outbound damage window vs. a PvP death broadcast. Bot
// validates the assister is on the WP roster, builds a dedup_key, and
// upserts to public.pvp_assists. No Discord post — assists are a stat-only
// signal (no rally moment to celebrate, no @PVP ping).
async function _handleAgentPvpAssists(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 256 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const assists = Array.isArray(payload?.assists) ? payload.assists : [];
  if (assists.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, stored: 0 }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, stored: 0, note: 'supabase disabled' }));
  }
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';

  // Pull the roster once to validate assisters. An unrecognised assister
  // means we received an assist event for a non-WP character — silently
  // drop it. (Defense-in-depth: the bot's auth token already gates upload
  // access, but the upload could plausibly carry junk if the agent is
  // misconfigured or a test rig pointed at production.)
  const rosterRows = await supabase.select(
    'characters',
    `select=name&guild_id=eq.${encodeURIComponent(guildId)}&limit=10000`,
  ).catch(() => []);
  const rosterLower = new Set(
    (Array.isArray(rosterRows) ? rosterRows : []).map(r => String(r.name || '').toLowerCase())
  );

  // Catalog-aware killer_is_npc classifier. The agent's broadcast-format
  // signal (killType='pvp' vs 'npc') is the first guess, but EQ's local
  // "X has been slain by Y!" line — used by backfill mining — doesn't
  // distinguish, so we fall back to the eqemu_npc_types catalog: if the
  // killer name appears in the NPC catalog, mark NPC. Quarm name
  // collisions where a player picks an NPC's name do exist; we accept that
  // false-positive risk (rare in practice) for the much larger benefit of
  // catching named NPCs like "Bizzznawa" the agent might otherwise emit
  // as a player kill.
  //
  // eqemu_npc_types.zone_short is NULL across our sync today (weekly sync
  // pulls npc_types but not spawn data), so the lookup is zone-agnostic
  // for now. When spawn data lands we can tighten to (name, zone_short).
  // Names use underscores for spaces in the catalog ("a_pyre_golem"); we
  // normalize before lookup. Cache per request so a batch with the same
  // killer doesn't hammer Supabase.
  const npcCache = new Map();
  async function _killerIsNpc(killerName, agentSaidNpc) {
    if (!killerName) return false;
    const k = killerName.trim();
    if (!k) return false;
    const cacheKey = k.toLowerCase();
    if (npcCache.has(cacheKey)) {
      const cached = npcCache.get(cacheKey);
      return cached || agentSaidNpc;
    }
    const normalized = k.replace(/\s+/g, '_');
    let found = false;
    try {
      const rows = await supabase.select(
        'eqemu_npc_types',
        `name=ilike.${encodeURIComponent(normalized)}&select=id&limit=1`,
      );
      found = Array.isArray(rows) && rows.length > 0;
    } catch (e) { void e; }
    npcCache.set(cacheKey, found);
    // OR-logic: catalog match wins; otherwise trust the agent's broadcast
    // format. Never flips a yes → no (a player who shares no NPC's name
    // shouldn't be retagged as player when the broadcast clearly said NPC).
    return found || agentSaidNpc;
  }

  const rows = [];
  let dropped = 0;
  for (const a of assists) {
    const assister = String(a?.assister || '').trim();
    const victim   = String(a?.victim   || '').trim();
    const killedAtRaw = a?.killed_at ? new Date(a.killed_at) : null;
    if (!assister || !victim || !killedAtRaw || isNaN(killedAtRaw.getTime())) { dropped++; continue; }
    if (!rosterLower.has(assister.toLowerCase())) { dropped++; continue; }
    const killedAt = killedAtRaw.toISOString();
    const secondIso = killedAt.slice(0, 19);
    const killerName = a?.killer ? String(a.killer).slice(0, 64) : null;
    const killerIsNpc = await _killerIsNpc(killerName, !!a?.killer_is_npc);
    rows.push({
      guild_id:       guildId,
      assister,
      assister_guild: 'Wolf Pack',
      victim:         victim.slice(0, 64),
      victim_guild:   a?.victim_guild ? String(a.victim_guild).slice(0, 64) : null,
      killer:         killerName,
      killer_is_npc:  killerIsNpc,
      zone:           a?.zone ? String(a.zone).slice(0, 128) : null,
      killed_at:      killedAt,
      source:         a?.source === 'log_backfill' ? 'log_backfill' : 'live_agent',
      raw_text:       a?.raw_text ? String(a.raw_text).slice(0, 500) : null,
      dedup_key:      `${guildId}|${assister.toLowerCase()}|${victim.toLowerCase()}|${secondIso}`,
      uploaded_by_discord_id: identity.discord_id,
    });
  }
  if (rows.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, stored: 0, dropped }));
  }
  const written = await supabase.upsert('pvp_assists', rows, 'dedup_key')
    .catch(err => { console.warn('[pvp-assists] upsert failed:', err?.message); return null; });
  const stored = Array.isArray(written) ? written.length : 0;

  // Harvest assist rows into who_observations — same pattern as the main PvP
  // relay above. The killer + victim are usually already covered by the kill
  // broadcast, but the ASSISTER is uniquely visible here. Assisters are
  // already roster-validated above so all are WP; we still record them so
  // their zone shows in /who (and so we have a row regardless of whether the
  // separate kill broadcast made it through).
  try {
    const whoRows = [];
    for (const r of rows) {
      whoRows.push({
        guild_id:    r.guild_id,
        character:   r.assister,
        level:       null,
        race:        null,
        class:       null,
        guild_name:  r.assister_guild || null,
        anonymous:   false,
        gm:          false,
        zone:        r.zone || null,
        observed_at: r.killed_at,
        uploaded_by: 'pvp-assist',
      });
      // The victim's also a free observation if not WP (i.e. has a real guild).
      if (r.victim && r.victim_guild && r.victim_guild !== 'Wolf Pack') {
        whoRows.push({
          guild_id:    r.guild_id,
          character:   r.victim,
          level:       null,
          race:        null,
          class:       null,
          guild_name:  r.victim_guild || null,
          anonymous:   false,
          gm:          false,
          zone:        r.zone || null,
          observed_at: r.killed_at,
          uploaded_by: 'pvp-assist',
        });
      }
    }
    if (whoRows.length > 0) {
      await supabase.upsert('who_observations', whoRows, 'guild_id,character,observed_minute,uploaded_by')
        .catch(err => console.warn('[pvp-assists] who_observations upsert failed:', err?.message));
      // Same Zek-proximity rescan as the pvp-relay path — unguilded assisters
      // / victims who happened to be in zone with a Zek-guilded character
      // within ±3 min get flagged as inferred Zek.
      await supabase.rpc('flag_zek_proximity_recent', {
        p_guild_id: process.env.SUPABASE_GUILD_ID || 'wolfpack',
      }).catch(err => console.warn('[pvp-assists] zek proximity rescan failed:', err?.message));
    }
  } catch (e) { console.warn('[pvp-assists] who harvest failed:', e?.message); }

  // Discord post — group by (victim, killed-at-second) so multiple assisters
  // on the same kill bundle into one message. Skip kills we've recently
  // posted (10-min in-memory dedup) so an agent retry doesn't double-post.
  // Goes to PVP_THREAD_ID / PVP_CHANNEL_ID like the kill broadcast.
  try {
    const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
    if (pvpTargetId && rows.length > 0) {
      const groups = new Map();   // (victim|second) → { victim, victimGuild, zone, killer, killerIsNpc, killedAt, assisters[] }
      for (const r of rows) {
        const k = (r.victim.toLowerCase()) + '|' + r.killed_at.slice(0, 19);
        let g = groups.get(k);
        if (!g) {
          g = {
            victim: r.victim, victimGuild: r.victim_guild,
            zone: r.zone, killer: r.killer, killerIsNpc: !!r.killer_is_npc,
            killedAt: r.killed_at, assisters: [],
          };
          groups.set(k, g);
        }
        if (!g.assisters.includes(r.assister)) g.assisters.push(r.assister);
      }
      const ch = await client.channels.fetch(pvpTargetId).catch(() => null);
      if (ch) {
        for (const g of groups.values()) {
          if (g.assisters.length === 0) continue;
          const dedupKey = (g.victim.toLowerCase()) + '|' + g.killedAt.slice(0, 19);
          if (_recentPvpAssistPost(dedupKey)) continue;
          // "🪶 Assist on Bob of <Tranquility> in nro — Carol, Hopeya, Hitya (3)
          //   killed by Adiwen". Zone + killed-by lines included when known.
          const victimLine = g.victim + (g.victimGuild ? ` of <${g.victimGuild}>` : '');
          const zoneLine   = g.zone ? ` in ${g.zone}` : '';
          const killerLine = g.killer
            ? `\n> killed by **${g.killer}**${g.killerIsNpc ? ' _(NPC)_' : ''}`
            : '';
          const assistersFmt = g.assisters.map(a => `**${a}**`).join(', ');
          const content = `🪶 Assist on ${victimLine}${zoneLine} — ${assistersFmt} _(${g.assisters.length})_${killerLine}`;
          await ch.send({ content, allowedMentions: { parse: [] } }).catch(err => {
            console.warn('[pvp-assists] post failed:', err?.message);
          });
        }
      }
    }
  } catch (e) { console.warn('[pvp-assists] post wrap failed:', e?.message); }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, stored, dropped }));
}
// 10-min in-memory ring for assist-group dedup. Keys are
// "victimLower|killedAtSecondIso" so an agent retry / a same-second double
// upload doesn't double-post. Bounded at 500 entries to cap memory.
const _recentPvpAssistPosts = new Map();   // key → expiresAt
function _recentPvpAssistPost(key) {
  const now = Date.now();
  for (const [k, ex] of _recentPvpAssistPosts) if (ex <= now) _recentPvpAssistPosts.delete(k);
  if (_recentPvpAssistPosts.has(key)) return true;
  if (_recentPvpAssistPosts.size > 500) {
    const oldest = _recentPvpAssistPosts.keys().next().value;
    if (oldest) _recentPvpAssistPosts.delete(oldest);
  }
  _recentPvpAssistPosts.set(key, now + 10 * 60 * 1000);
  return false;
}

// ── Druzzil Ro boss-kill auto-timer ───────────────────────────────────────
// Receives instance kill announcements from the agent.  For each:
//   1. Match boss name against bosses.json (by name or nickname)
//   2. Record kill + trigger full postKillUpdate refresh
//   3. Post human-readable confirmation to RAID_CHAT_CHANNEL_ID with next-spawn time
async function _handleAgentBossKill(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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

  _trackUpload({ endpoint: 'bosskill', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
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
// ── Server-view panels for the local dashboard (increment 2f) ──────────────
// The local agent dashboard panels show LOCAL (this-session) data. Members
// can click 🌐 server on a panel to see the SERVER-AGGREGATED view of the
// same scope. The agent calls GET /api/agent/server-panel/<key> with
// ?character=<You>; we return a small JSON shape the dashboard can render.
//
// Currently supported keys (additive — unknown keys 404 cleanly):
//   - "damage"  → recent 30d per-character encounter totals + DPS, ranked
//   - "pvp"     → caller's PvP record summary (kills, unique victims, deaths)
//   - "parses"  → caller's last 10 encounters (boss, ts, dps, total)
// Threat is intentionally NOT here — it's a live-only stat with no server
// counterpart (see CONTINUATION_QUEUE: increment 2f notes).
async function _handleAgentServerPanel(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/'); // ['', 'api', 'agent', 'server-panel', '<key>']
  const key = (parts[4] || '').toLowerCase();
  const character = (url.searchParams.get('character') || '').trim();
  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'supabase disabled' }));
  }
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    if (key === 'damage') {
      // Top characters by 30d total damage (recent_encounters via
      // encounter_players → encounters). Keep response small; dashboard
      // overlays rank+total+dps onto its existing "Damage" panel layout.
      const rows = await supabase.select(
        'encounter_players',
        `select=character_name,total_damage,dps,encounters!inner(started_at)` +
        `&encounters.started_at=gte.${since30d}` +
        `&order=total_damage.desc&limit=200`
      );
      // Aggregate by character (multiple encounter rows per char)
      const byChar = new Map();
      for (const r of (rows || [])) {
        const k = r.character_name;
        if (!k) continue;
        const cur = byChar.get(k) || { character: k, totalDamage: 0, encounters: 0, peakDps: 0 };
        cur.totalDamage += r.total_damage || 0;
        cur.encounters  += 1;
        if ((r.dps || 0) > cur.peakDps) cur.peakDps = r.dps || 0;
        byChar.set(k, cur);
      }
      const list = [...byChar.values()].sort((a, b) => b.totalDamage - a.totalDamage).slice(0, 25);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ key, scope: 'last 30d', updated_at: new Date().toISOString(), rows: list }));
    }
    if (key === 'pvp') {
      if (!character) { res.writeHead(400); return res.end(JSON.stringify({ error: 'character required' })); }
      const [killsRows, deathRows] = await Promise.all([
        supabase.select('pvp_kills', `select=victim,killed_at&guild_id=eq.${encodeURIComponent(guildId)}&killer=ilike.${encodeURIComponent(character)}&order=killed_at.desc&limit=500`),
        supabase.select('pvp_kills', `select=killer,killed_at&guild_id=eq.${encodeURIComponent(guildId)}&victim=ilike.${encodeURIComponent(character)}&order=killed_at.desc&limit=500`),
      ]);
      const kills = killsRows || [];
      const deaths = deathRows || [];
      const uniqueVictims = new Set(kills.map(k => (k.victim || '').toLowerCase())).size;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        key, character, scope: 'lifetime',
        updated_at: new Date().toISOString(),
        total_kills: kills.length, unique_victims: uniqueVictims,
        total_deaths: deaths.length,
        recent_kills:  kills.slice(0, 10),
        recent_deaths: deaths.slice(0, 10),
      }));
    }
    if (key === 'parses') {
      if (!character) { res.writeHead(400); return res.end(JSON.stringify({ error: 'character required' })); }
      const rows = await supabase.select(
        'encounter_players',
        `select=character_name,total_damage,dps,duration_sec,encounters!inner(id,started_at,eqemu_npc_types(name))` +
        `&character_name=ilike.${encodeURIComponent(character)}` +
        `&order=encounters(started_at).desc&limit=20`
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        key, character, scope: 'last 20 encounters',
        updated_at: new Date().toISOString(),
        rows: (rows || []).map(r => ({
          encounter_id: r.encounters?.id,
          boss: r.encounters?.eqemu_npc_types?.name || null,
          started_at: r.encounters?.started_at,
          total_damage: r.total_damage,
          dps: r.dps,
          duration_sec: r.duration_sec,
        })),
      }));
    }
    if (key === 'loot') {
      // Engaged-mob loot — the drop table for the boss the agent is currently
      // fighting. Caller passes ?boss=<name>; tolerate "_" vs " " variants
      // since EQEmu npc_types names use underscores.
      const bossRaw = (url.searchParams.get('boss') || '').trim();
      if (!bossRaw) { res.writeHead(400); return res.end(JSON.stringify({ error: 'boss required' })); }
      const variants = [bossRaw, bossRaw.replace(/ /g, '_'), bossRaw.replace(/_/g, ' ')];
      let rows = [];
      for (const v of variants) {
        const r = await supabase.select(
          'eqemu_npc_drops',
          `select=npc_id,npc_name,item_id,item_name,effective_chance,lore_flag` +
          `&npc_name=ilike.${encodeURIComponent(v)}&order=effective_chance.desc&limit=80`
        );
        if (r && r.length) { rows = r; break; }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        key, boss: bossRaw, scope: 'drop table',
        updated_at: new Date().toISOString(),
        rows: (rows || []).slice(0, 40),
      }));
    }
    if (key === 'threat') {
      if (!character) { res.writeHead(400); return res.end(JSON.stringify({ error: 'character required' })); }
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      // Pull recent snapshots for any encounter where this character appears
      // in per_player. PostgREST JSONB existence: per_player=cs.{character}
      // (contains) is the cheap test.
      const rows = await supabase.select(
        'encounter_threat_snapshots',
        `select=boss_name,snapshot_at,per_player,total` +
        `&guild_id=eq.${encodeURIComponent(guildId)}` +
        `&snapshot_at=gte.${since}` +
        `&per_player=cs.${encodeURIComponent(JSON.stringify({ [character]: {} }))}` +
        `&order=snapshot_at.desc&limit=2000`
      );
      // Rank the character within each snapshot; aggregate.
      let topCount = 0, top3Count = 0;
      const recent = [];
      for (const r of (rows || [])) {
        const entries = Object.entries(r.per_player || {}).map(([n, v]) => [n, (v.swing||0)+(v.proc||0)+(v.spell||0)+(v.heal||0)]).sort((a,b)=>b[1]-a[1]);
        const idx = entries.findIndex(e => (e[0]||'').toLowerCase() === character.toLowerCase());
        if (idx === 0) topCount++;
        if (idx >= 0 && idx < 3) top3Count++;
        if (recent.length < 10) recent.push({ boss: r.boss_name, snapshot_at: r.snapshot_at, rank: idx + 1, of: entries.length });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        key, character, scope: 'last 30d',
        updated_at: new Date().toISOString(),
        snapshots: (rows || []).length,
        times_topped_threat: topCount,
        times_top3:          top3Count,
        recent,
      }));
    }
    if (key === 'bids') {
      // Previous bids for a list of items (comma-separated item_ids). Returns
      // winning bid + runners-up + which character won. Used by the dashboard
      // alongside the Loot panel for the boss the agent is currently fighting.
      const itemsRaw = (url.searchParams.get('items') || '').trim();
      if (!itemsRaw) { res.writeHead(400); return res.end(JSON.stringify({ error: 'items required (comma-separated item_ids)' })); }
      const ids = itemsRaw.split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0).slice(0, 60);
      if (ids.length === 0) { res.writeHead(400); return res.end(JSON.stringify({ error: 'no valid item_ids' })); }
      const rows = await supabase.select(
        'loot_drops',
        `select=item_id,winner_character,dkp_spent,runner_up_bids,awarded_at,eqemu_items!inner(name)` +
        `&item_id=in.(${ids.join(',')})&order=awarded_at.desc&limit=300`
      );
      // Group by item_id; return last 5 awards each.
      const byItem = new Map();
      for (const r of (rows || [])) {
        const k = r.item_id;
        if (!byItem.has(k)) byItem.set(k, []);
        if (byItem.get(k).length < 5) byItem.get(k).push({
          item_name:  r.eqemu_items?.name || null,
          winner:     r.winner_character,
          dkp_spent:  r.dkp_spent,
          awarded_at: r.awarded_at,
          runners:    Array.isArray(r.runner_up_bids) ? r.runner_up_bids.slice(0, 5) : null,
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        key, scope: 'last 5 awards per item',
        updated_at: new Date().toISOString(),
        items: Array.from(byItem.entries()).map(([id, awards]) => ({ item_id: id, awards })),
      }));
    }
    if (key === 'auctions') {
      // Live OpenDKP auctions — what's currently up for bid. Used by the
      // in-game Bidding overlay (Mimic) + the dashboard "💸 Live Bidding"
      // panel. We also enrich with the caller's matching wishlist entries
      // so the overlay can show "you wishlisted this for X DKP" inline.
      const opendkp = require('./utils/opendkp');
      try {
        const auctions = await opendkp.getAuctions().catch(() => ({}));
        const list = Array.isArray(auctions?.Items) ? auctions.Items
                    : Array.isArray(auctions) ? auctions
                    : [];
        // Wishlist enrichment for the caller (optional ?character=).
        let wishById = new Map();
        if (character) {
          // wishlists.bid_amount_enc is encrypted with WISHLIST_BID_KEY; we
          // only return the item_id + priority so the OVERLAY can flag
          // "you wishlisted this." Bid value stays private — only viewable
          // on /me/wishlist.
          // wishlists has no guild_id column (single-guild deployment) — the
          // PostgREST 400 from filtering on a missing column floods the logs.
          // Drop the guild_id clause; character_name is unique enough here.
          void guildId;
          const wlRows = await supabase.select(
            'wishlists',
            `select=item_id,priority` +
            `&character_name=ilike.${encodeURIComponent(character)}`
          );
          for (const r of (wlRows || [])) wishById.set(r.item_id, { priority: r.priority });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          key, character,
          updated_at: new Date().toISOString(),
          auctions: list.map(a => ({
            auction_id: a.AuctionId || a.SessionId || a.Id,
            item_id:    a.ItemId || a.Item?.Id,
            item_name:  a.ItemName || a.Item?.Name,
            top_bid:    a.TopBid || a.HighestBid || null,
            ends_at:    a.EndTime || a.EndsAt || null,
            wishlisted: !!wishById.get(a.ItemId || a.Item?.Id),
          })),
        }));
      } catch (err) {
        console.warn('[server-panel:auctions] failed:', err?.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'opendkp fetch failed' }));
      }
    }
    if (key === 'my-bids') {
      // The caller's currently-active bids across all open auctions. OpenDKP
      // doesn't expose a "list my bids" endpoint, so we walk the auctions
      // list and pull each auction's Bids[] (getAuction returns them) and
      // filter to entries whose CharacterId belongs to the caller's
      // characters. Returns one row per (auction, item) the caller has bid on.
      if (!character) { res.writeHead(400); return res.end(JSON.stringify({ error: 'character required' })); }
      const opendkp = require('./utils/opendkp');
      try {
        const chars = await opendkp.getCharacters().catch(() => []);
        const myCharIds = new Set(
          (Array.isArray(chars) ? chars : (chars?.Items || []))
            .filter(c => (c.Name || '').toLowerCase() === character.toLowerCase() || (c.ParentName || '').toLowerCase() === character.toLowerCase())
            .map(c => c.Id || c.CharacterId)
        );
        const auctions = await opendkp.getAuctions().catch(() => ({}));
        const list = Array.isArray(auctions?.Items) ? auctions.Items
                    : Array.isArray(auctions) ? auctions
                    : [];
        const mine = [];
        for (const a of list) {
          const aid = a.AuctionId || a.SessionId || a.Id;
          if (!aid) continue;
          // getAuction returns Bids[]; cap concurrent fetches to keep this cheap.
          let full;
          try { full = await opendkp.getAuction(aid); } catch { continue; }
          const bids = (full && (full.Bids || full.bids)) || [];
          for (const b of bids) {
            if (myCharIds.has(b.CharacterId)) {
              mine.push({
                auction_id: aid,
                item_id:    a.ItemId || a.Item?.Id,
                item_name:  a.ItemName || a.Item?.Name,
                bid_id:     b.Id || b.BidId,
                value:      b.Value,
                rank:       b.Rank,
                priority:   b.Priority,
                character:  b.CharacterName || character,
              });
            }
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          key, character, scope: 'currently-open auctions',
          updated_at: new Date().toISOString(),
          bids: mine,
        }));
      } catch (err) {
        console.warn('[server-panel:my-bids] failed:', err?.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'opendkp fetch failed' }));
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unknown panel key', key }));
  } catch (err) {
    console.warn('[server-panel] query failed:', err?.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'query failed' }));
  }
}

// Receive a threat snapshot from a running agent (uploader's view of the
// currentEncounterThreat.perPlayer map). One row per (guild, uploader,
// boss, snapshot_at); the unique constraint dedups re-uploads.
async function _handleAgentThreatSnapshot(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 256 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }
  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) { res.writeHead(200); return res.end(JSON.stringify({ ok: true, written: 0, note: 'supabase disabled' })); }
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const row = {
    guild_id:    guildId,
    encounter_id: payload?.encounter_id || null,
    boss_name:   payload?.boss_name || null,
    started_at:  payload?.started_at || null,
    snapshot_at: payload?.snapshot_at || new Date().toISOString(),
    uploader:    payload?.uploader || payload?.character || null,
    per_player:  payload?.per_player || {},
    total:       Number.isFinite(payload?.total) ? payload.total : null,
  };
  if (!row.uploader || !row.per_player || Object.keys(row.per_player).length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, written: 0, note: 'empty' }));
  }
  await supabase.upsert('encounter_threat_snapshots', [row], 'guild_id,uploader,boss_name,snapshot_at')
    .catch(err => console.warn('[threat-snap] upsert failed:', err?.message));
  _trackUpload({ endpoint: 'threat_snapshot', character: row.uploader, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, written: 1 }));
}

// POST /api/agent/place-bid
// Body: { character: "Hitya", auction_id: 993920, value: 50, priority?: 1 }
// ── UI Studio — encrypted snapshots of a player's EQ ini files ─────────────
// Mimic POSTs a JSON bundle of UI / chat / hotkey / bandolier / socials
// files. Bot encrypts with WISHLIST_BID_KEY before storing — even DB admins
// can't read the raw .ini contents at rest. GET endpoints decrypt on the
// way out for the same authenticated owner.
//
// Ownership: derived from the named character's discord_id. The character
// MUST be linked to a Discord user (characters.discord_id is non-null);
// otherwise the upload is rejected. Lists / downloads are scoped to that
// discord_id so one user can't read another's snapshots.

async function _handleAgentUiLayoutUpload(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  let body = '';
  await new Promise((resolve) => {
    req.on('data', (chunk) => {
      body += chunk;
      // UI bundles can include hundreds of small ini files; 8MB is a comfortable
      // ceiling. (Hitya's full set was ~600KB pre-encryption.)
      if (body.length > 8 * 1024 * 1024) { req.destroy(); resolve(); }
    });
    req.on('end',   resolve);
    req.on('error', resolve);
  });
  let payload;
  try { payload = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid json' }));
  }
  const character     = String(payload?.character || '').trim();
  const serverShort   = (payload?.server_short || null) && String(payload.server_short).trim();
  const label         = (payload?.label || null) && String(payload.label).trim().slice(0, 80);
  const sourceWidth   = Number.isFinite(payload?.source_width)  ? payload.source_width  : null;
  const sourceHeight  = Number.isFinite(payload?.source_height) ? payload.source_height : null;
  const files         = (payload?.files && typeof payload.files === 'object') ? payload.files : null;
  const agentVersion  = (payload?.agent_version || null) && String(payload.agent_version).slice(0, 32);
  if (!character || !files) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'character + files required' }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'supabase disabled' }));
  }

  // Resolve owner via character → discord_id. Family root counts too: an
  // alt's UI snapshot belongs to the main's Discord owner.
  const charRows = await supabase.select(
    'characters',
    `name=ilike.${encodeURIComponent(character)}&select=name,main_name,discord_id&guild_id=eq.wolfpack&limit=1`,
  ).catch(() => []);
  const charRow = Array.isArray(charRows) ? charRows[0] : null;
  let ownerDiscord = charRow?.discord_id || null;
  if (!ownerDiscord && charRow?.main_name) {
    const rootRows = await supabase.select(
      'characters',
      `name=ilike.${encodeURIComponent(charRow.main_name)}&select=discord_id&guild_id=eq.wolfpack&limit=1`,
    ).catch(() => []);
    ownerDiscord = Array.isArray(rootRows) && rootRows[0]?.discord_id || null;
  }

  // Unlinked toon: instead of rejecting (which loses the backup), attribute it
  // to the UPLOADER (we know who they are from their per-user session token),
  // hold the snapshot as pending_link, and file an officer approval request to
  // add this toon to the uploader's family. The held snapshot merges in (flag
  // cleared) on approval.
  let pendingLink = false;
  if (!ownerDiscord) {
    ownerDiscord = identity.discord_id;
    pendingLink  = true;
    // File / refresh the link request (idempotent via the partial-unique
    // pending index). Best-effort — the snapshot still stores either way.
    try {
      const existing = await supabase.select(
        'character_link_requests',
        `requester_discord_id=eq.${encodeURIComponent(identity.discord_id)}` +
        `&character_name=ilike.${encodeURIComponent(character)}` +
        `&status=eq.pending&select=id&limit=1`,
      ).catch(() => []);
      if (!Array.isArray(existing) || existing.length === 0) {
        await supabase.insert('character_link_requests', [{
          guild_id:             process.env.SUPABASE_GUILD_ID || 'wolfpack',
          character_name:       character,
          requester_discord_id: identity.discord_id,
          requester_name:       identity.display_name || null,
          source:               'ui_layout',
        }]).catch(err => console.warn('[ui_layout] link-request insert failed:', err?.message));
      }
    } catch (err) {
      console.warn('[ui_layout] link-request check failed:', err?.message);
    }
  }

  const { encryptBlob, isEncryptionEnabled } = require('./utils/bidCrypto');
  if (!isEncryptionEnabled()) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'WISHLIST_BID_KEY not configured on the bot — UI Studio cannot encrypt' }));
  }
  const plaintext = JSON.stringify({ files });
  const enc       = encryptBlob(plaintext);
  if (!enc) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'encryption failed' }));
  }
  const row = {
    owner_discord_id:    ownerDiscord,
    character_name:      character,
    server_short:        serverShort,
    label,
    source_width:        sourceWidth,
    source_height:       sourceHeight,
    payload_enc:         enc,
    payload_bytes_plain: Buffer.byteLength(plaintext, 'utf8'),
    file_count:          Object.keys(files).length,
    agent_version:       agentVersion,
    pending_link:        pendingLink,
  };
  const written = await supabase.insert('ui_snapshots', [row]).catch(err => {
    console.error('[ui_layout] insert failed:', err?.message || err);
    return null;
  });
  if (!Array.isArray(written) || written.length === 0) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'insert failed' }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, id: written[0].id, pending_link: pendingLink }));
}

async function _handleAgentUiLayoutList(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  // ?character=<name>  required — we always scope listing to one character
  // since that drives the picker UI. The character determines the owner.
  const url = new URL(req.url, 'http://x');
  const character = (url.searchParams.get('character') || '').trim();
  if (!character) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'character query required' }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) { res.writeHead(503).end(); return; }

  // Resolve owner (same logic as upload).
  const charRows = await supabase.select(
    'characters',
    `name=ilike.${encodeURIComponent(character)}&select=name,main_name,discord_id&guild_id=eq.wolfpack&limit=1`,
  ).catch(() => []);
  const charRow = Array.isArray(charRows) ? charRows[0] : null;
  let ownerDiscord = charRow?.discord_id || null;
  if (!ownerDiscord && charRow?.main_name) {
    const rootRows = await supabase.select(
      'characters',
      `name=ilike.${encodeURIComponent(charRow.main_name)}&select=discord_id&guild_id=eq.wolfpack&limit=1`,
    ).catch(() => []);
    ownerDiscord = Array.isArray(rootRows) && rootRows[0]?.discord_id || null;
  }
  if (!ownerDiscord) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ snapshots: [] }));
  }
  const rows = await supabase.select(
    'ui_snapshots',
    `owner_discord_id=eq.${encodeURIComponent(ownerDiscord)}&select=id,character_name,server_short,label,source_width,source_height,payload_bytes_plain,file_count,agent_version,created_at&order=created_at.desc&limit=50`,
  ).catch(() => []);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ snapshots: Array.isArray(rows) ? rows : [] }));
}

async function _handleAgentUiLayoutDownload(req, res, snapshotId) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  // The download URL is /api/agent/ui_layout/<id>?character=<name>. We
  // re-verify ownership via the character — even with the snapshot id the
  // request must come from someone who can prove they own the matching char.
  const url = new URL(req.url, 'http://x');
  const character = (url.searchParams.get('character') || '').trim();
  if (!character || !/^[0-9a-f-]{36}$/i.test(snapshotId)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'character query + valid id required' }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) { res.writeHead(503).end(); return; }

  const charRows = await supabase.select(
    'characters',
    `name=ilike.${encodeURIComponent(character)}&select=name,main_name,discord_id&guild_id=eq.wolfpack&limit=1`,
  ).catch(() => []);
  const charRow = Array.isArray(charRows) ? charRows[0] : null;
  let ownerDiscord = charRow?.discord_id || null;
  if (!ownerDiscord && charRow?.main_name) {
    const rootRows = await supabase.select(
      'characters',
      `name=ilike.${encodeURIComponent(charRow.main_name)}&select=discord_id&guild_id=eq.wolfpack&limit=1`,
    ).catch(() => []);
    ownerDiscord = Array.isArray(rootRows) && rootRows[0]?.discord_id || null;
  }
  if (!ownerDiscord) { res.writeHead(403).end(); return; }

  const rows = await supabase.select(
    'ui_snapshots',
    `id=eq.${snapshotId}&owner_discord_id=eq.${encodeURIComponent(ownerDiscord)}&select=id,character_name,server_short,label,source_width,source_height,payload_enc,file_count&limit=1`,
  ).catch(() => []);
  const snap = Array.isArray(rows) ? rows[0] : null;
  if (!snap) { res.writeHead(404).end(); return; }

  const { decryptBlob } = require('./utils/bidCrypto');
  const plaintext = decryptBlob(snap.payload_enc);
  if (!plaintext) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'decryption failed' }));
  }
  let parsed;
  try { parsed = JSON.parse(plaintext); }
  catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'snapshot payload malformed' }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({
    id: snap.id,
    character_name: snap.character_name,
    server_short: snap.server_short,
    label: snap.label,
    source_width: snap.source_width,
    source_height: snap.source_height,
    file_count: snap.file_count,
    files: parsed.files || {},
  }));
}

// Looks up CharacterId + Rank from OpenDKP roster and forwards as a bid.
// Returns the OpenDKP response (or a 4xx if the input is bad).
async function _handleAgentPlaceBid(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 16 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const character  = String(payload?.character || '').trim();
  const auctionId  = payload?.auction_id;
  const value      = Number(payload?.value);
  const priority   = Number.isFinite(payload?.priority) ? Number(payload.priority) : 1;
  if (!character || !auctionId || !Number.isFinite(value) || value <= 0) {
    res.writeHead(400);
    return res.end(JSON.stringify({ error: 'character, auction_id, and positive value are required' }));
  }

  const opendkp = require('./utils/opendkp');
  try {
    const chars = await opendkp.getCharacters().catch(() => []);
    const list  = Array.isArray(chars) ? chars : (chars?.Items || []);
    const me    = list.find(c => (c.Name || '').toLowerCase() === character.toLowerCase());
    if (!me) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: `character not found in roster: ${character}` }));
    }
    const characterId = me.Id || me.CharacterId;
    const rank        = me.Rank || me.RankName || 'Member';
    const out = await opendkp.submitBid(auctionId, {
      CharacterId: characterId,
      SessionId:   auctionId,
      Rank:        rank,
      Priority:    priority,
      Value:       value,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, bid: out }));
  } catch (err) {
    console.warn('[place-bid] failed:', err?.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'opendkp bid failed', detail: err?.message }));
  }
}

async function _handleAgentFunEvent(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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
      uploaded_by_discord_id: identity.discord_id,
    }));
  if (rows.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, written: 0 }));
  }
  const written = await supabase.upsert('fun_events', rows, 'guild_id,event_type,caster,event_ts')
    .catch(err => { console.warn('[fun-event] upsert failed:', err?.message); return null; });
  _trackUpload({ endpoint: 'fun_event', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, written: Array.isArray(written) ? written.length : 0 }));
}

// POST /api/agent/faction
//
// Per-character faction tracking, COMPACT design (migration 20260610150000).
// Two event kinds ride one payload from the agent's self-only log lines:
//   {kind:'hit', character, faction, direction ±1, capped, ts}
//     — "Your faction standing with X got better/worse." Aggregated here
//       into ONE additive rollup row per (character, faction) via the
//       bump_faction_standing RPC: counters add, at-cap timestamps pin the
//       absolute min/max position, first/last hit track recency. No
//       per-event rows — the table's size ceiling is characters × factions.
//   {kind:'con',  character, mob, standing, rank, ts}
//     — a /consider standing TRANSITION. Only NON-hostile standings matter
//       (an engaged mob cons scowls/threateningly regardless of faction, so
//       those are combat noise — and the agent already drops them); we keep
//       the LATEST standing per (character, mob), overwritten in place.
async function _handleAgentFaction(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 512 * 1024) { res.writeHead(413); return res.end(); }
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

  // Hits → one aggregate per (character, faction). A 1,500-event backfill
  // chunk collapses to a handful of RPC rows.
  const agg = new Map();   // charLower|factionLower → rollup row
  // Cons → latest per (character, mob); a single upsert payload must not
  // contain the same key twice (Postgres rejects double-update in one
  // statement), so collapse here too.
  const latestCon = new Map();

  for (const e of events) {
    if (!e || !e.character || !e.ts) continue;
    const ts = new Date(e.ts);
    if (isNaN(ts.getTime())) continue;
    const iso = ts.toISOString();
    if (e.kind === 'hit' && e.faction) {
      const character = String(e.character).slice(0, 64);
      const faction   = String(e.faction).slice(0, 96);
      const key = character.toLowerCase() + '|' + faction.toLowerCase();
      let a = agg.get(key);
      if (!a) {
        a = { guild_id: guildId, character, faction, better: 0, worse: 0,
              capped_max_at: null, capped_min_at: null,
              first_hit_at: iso, last_hit_at: iso, last_direction: null };
        agg.set(key, a);
      }
      const dir = e.direction > 0 ? 1 : -1;
      if (dir > 0) a.better++; else a.worse++;
      if (e.capped && dir > 0 && (!a.capped_max_at || iso > a.capped_max_at)) a.capped_max_at = iso;
      if (e.capped && dir < 0 && (!a.capped_min_at || iso > a.capped_min_at)) a.capped_min_at = iso;
      if (iso < a.first_hit_at) a.first_hit_at = iso;
      if (iso >= a.last_hit_at) { a.last_hit_at = iso; a.last_direction = dir; }
    } else if (e.kind === 'con' && e.mob && e.standing) {
      // Defense in depth — the agent drops hostile cons (rank ≤ 1) before
      // upload, but never trust the wire.
      const rank = Number.isFinite(e.rank) ? Math.trunc(e.rank) : null;
      if (rank != null && rank <= 1) continue;
      const character = String(e.character).slice(0, 64);
      const mob       = String(e.mob).slice(0, 64);
      const key = character.toLowerCase() + '|' + mob.toLowerCase();
      const prev = latestCon.get(key);
      if (!prev || iso > prev.event_ts) {
        latestCon.set(key, {
          guild_id: guildId, character, mob,
          standing: String(e.standing).slice(0, 24),
          rank, event_ts: iso,
        });
      }
    }
  }

  let written = 0;
  if (agg.size) {
    const r = await supabase.rpc('bump_faction_standing', { p_rows: Array.from(agg.values()) })
      .catch(err => { console.warn('[faction] standing bump failed:', err?.message); return null; });
    if (Number.isFinite(r)) written += r;
  }
  if (latestCon.size) {
    const r = await supabase.upsert('faction_cons', Array.from(latestCon.values()), 'guild_id,character,mob')
      .catch(err => { console.warn('[faction] cons upsert failed:', err?.message); return null; });
    if (Array.isArray(r)) written += r.length;
  }
  _trackUpload({ endpoint: 'faction', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, written }));
}

// POST /api/agent/pop_flags
//
// PoP flag grants (pre-built for the 2026-10-01 unlock; table
// 20260610180000). The grant line never names the flag, so the agent sends
// context -- {character, ts, zone, boss} -- and we resolve flag_key from the
// DRAFT catalog below. Unrecognized combos store as 'unmapped' with zone +
// boss preserved: launch-week catalog fixes are a map edit + one UPDATE.
// KEEP IN SYNC with web/lib/popFlags.ts (zones/tiers live there). Verify
// against wiki.takp.info + takp.info/flag-check before launch -- both were
// network-blocked from the dev sandbox when this was written.
const POP_FLAG_BY_BOSS = {
  'grummus':                'cod_access',        // PoDisease -> Crypt of Decay
  'aerin`dar':              'hoh_access',        // PoValor -> Halls of Honor
  "aerin'dar":              'hoh_access',
  'terris thule':           'tactics_access',    // Lair of Terris -> Drunder
  'manaetic behemoth':      'mb_dead',           // PoInnovation
  'saryrn':                 'saryrn_dead',       // PoTorment
  'bertoxxulous':           'bert_dead',         // Crypt of Decay
  'mithaniel marr':         'marr_dead',         // Temple of Marr
  'rallos zek':             'earth_access',      // Tactics -> PoEarth
  'agnarr the storm lord':  'agnarr_dead',       // Bastion of Thunder
  'solusek ro':             'fire_access',       // SolRo Tower -> Doomfire
  'fennin ro':              'fennin_dead',       // Doomfire
  'coirnav':                'coirnav_dead',      // Reef of Coirnav
  'the rathe council':      'rathe_dead',        // PoEarth
  'xegony':                 'xegony_dead',       // PoAir
  'quarm':                  'time_complete',     // Plane of Time
};
async function _handleAgentPopFlags(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
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
  const supabase = require('./utils/supabase');
  if (events.length === 0 || !supabase.isEnabled()) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, written: 0 }));
  }
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const rows = [];
  const seen = new Set();
  for (const e of events) {
    if (!e || !e.character || !e.ts) continue;
    const ts = new Date(e.ts);
    if (isNaN(ts.getTime())) continue;
    const bossLower = e.boss ? String(e.boss).toLowerCase() : '';
    const flagKey = POP_FLAG_BY_BOSS[bossLower] || 'unmapped';
    const key = `${String(e.character).toLowerCase()}|${flagKey}|${ts.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      guild_id:  guildId,
      character: String(e.character).slice(0, 64),
      flag_key:  flagKey,
      zone:      e.zone ? String(e.zone).slice(0, 64) : null,
      boss:      e.boss ? String(e.boss).slice(0, 64) : null,
      source:    'event',
      earned_at: ts.toISOString(),
    });
  }
  let written = 0;
  if (rows.length) {
    const r = await supabase.upsert('pop_flags', rows, 'guild_id,character,flag_key,earned_at')
      .catch(err => { console.warn('[pop-flags] upsert failed:', err?.message); return null; });
    if (Array.isArray(r)) written = r.length;
  }
  _trackUpload({ endpoint: 'pop_flags', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, written }));
}

// POST /api/agent/quarmy
//
// Quarmy export ingest (docs/DESIGN-quarmy-gear.md, table 20260610210000).
// The agent parses <Name>Quarmy.txt locally and ships equipped slots +
// general-bag items + AA ranks + profile facts. Bank/SharedBank/coin rows
// were dropped at the agent BEFORE upload (they never leave the machine);
// this handler strips them again as defense in depth and refuses to write
// anything for a character whose owner set exclude_inventory on /me.
// Latest-state overwrite: each upload replaces the character's rows.
const _QUARMY_BANNED_SLOT_RX = /^(bank|sharedbank)|coin/i;
async function _handleAgentQuarmy(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const character = typeof payload?.character === 'string' ? payload.character.trim().slice(0, 64) : '';
  if (!/^[A-Za-z]{2,}$/.test(character)) {
    res.writeHead(400); return res.end(JSON.stringify({ error: 'bad character' }));
  }
  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, written: 0, note: 'supabase disabled' }));
  }
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';

  // Owner opt-out is enforced server-side too — a stale agent that missed the
  // prefs poll cannot write an excluded character's gear.
  const charRows = await supabase
    .select('characters', `select=name,exclude_inventory,quarmy_checksum&guild_id=eq.${encodeURIComponent(guildId)}&name=ilike.${encodeURIComponent(character)}&limit=1`)
    .catch(() => null);
  const charRow = Array.isArray(charRows) ? charRows[0] : null;
  if (charRow && charRow.exclude_inventory) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, skipped: 'opted_out' }));
  }
  const checksum = payload.checksum != null ? String(payload.checksum).slice(0, 32) : null;
  if (checksum && charRow && charRow.quarmy_checksum === checksum) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, skipped: 'unchanged' }));
  }

  const cleanItem = (e, loc) => {
    if (!e || typeof e.slot !== 'string' || _QUARMY_BANNED_SLOT_RX.test(e.slot)) return null;
    const itemId = parseInt(e.item_id, 10);
    if (!Number.isFinite(itemId) || itemId <= 0 || !e.item_name) return null;
    return {
      guild_id: guildId, character, loc,
      slot: e.slot.slice(0, 32),
      item_id: itemId,
      item_name: String(e.item_name).slice(0, 96),
      count: Math.max(1, parseInt(e.count, 10) || 1),
      updated_at: new Date().toISOString(),
    };
  };
  const gearRows = [];
  for (const e of Array.isArray(payload.equipped) ? payload.equipped : []) {
    const r = cleanItem(e, 'equipped'); if (r) gearRows.push(r);
  }
  for (const e of Array.isArray(payload.bags) ? payload.bags : []) {
    const r = cleanItem(e, 'bag'); if (r) gearRows.push(r);
  }
  const aaRows = [];
  for (const a of Array.isArray(payload.aas) ? payload.aas : []) {
    const idx = parseInt(a?.index, 10), rank = parseInt(a?.rank, 10);
    if (!Number.isFinite(idx) || !Number.isFinite(rank) || rank <= 0) continue;
    aaRows.push({ guild_id: guildId, character, aa_index: idx, rank, updated_at: new Date().toISOString() });
  }

  // Replace wholesale — delete-then-insert handles unequipped slots, emptied
  // bag slots, and AA respecs that an upsert would leave behind as ghosts.
  const charQ = `guild_id=eq.${encodeURIComponent(guildId)}&character=eq.${encodeURIComponent(character)}`;
  await supabase.del('character_gear', charQ).catch(() => {});
  await supabase.del('character_aas', charQ).catch(() => {});
  let written = 0;
  if (gearRows.length) {
    const r = await supabase.insert('character_gear', gearRows)
      .catch(err => { console.warn('[quarmy] gear insert failed:', err?.message); return null; });
    if (Array.isArray(r)) written += r.length;
  }
  if (aaRows.length) {
    const r = await supabase.insert('character_aas', aaRows)
      .catch(err => { console.warn('[quarmy] aa insert failed:', err?.message); return null; });
    if (Array.isArray(r)) written += r.length;
  }

  // Profile facts — only update an EXISTING characters row (rows are created
  // by the roster/link flows; gear ingest shouldn't invent membership).
  // deity_id finally pins the faction page's deity-shifted base estimates.
  if (charRow) {
    const patch = { quarmy_synced_at: new Date().toISOString() };
    if (checksum) patch.quarmy_checksum = checksum;
    const deity = parseInt(payload.deity_id, 10);
    if (Number.isFinite(deity) && deity > 0) patch.deity_id = deity;
    await supabase
      .update('characters', `guild_id=eq.${encodeURIComponent(guildId)}&name=eq.${encodeURIComponent(charRow.name)}`, patch)
      .catch(err => console.warn('[quarmy] characters update failed:', err?.message));
  }

  _trackUpload({ endpoint: 'quarmy', character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, written }));
}

// POST /api/agent/buff_casts
//
// Observed buff landings on other players (see migration 20260605120000). The
// agent reverse-matches a spell's cast_on_other message in the log and reports
// { target, spell_id, spell_name, landing_text, dur_ticks, dur_formula, cast_at,
//   observer }. Every nearby agent sees the same landing, so we upsert with a
// dedup key that collapses N observers of one cast into one row.
async function _handleAgentBuffCasts(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 256 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const casts = Array.isArray(payload?.casts) ? payload.casts : [];
  if (casts.length === 0) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, written: 0 }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, written: 0, note: 'supabase disabled' }));
  }

  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  // Resolved (spell_id) and ambiguous (spell_id = 0) casts dedup on different
  // partial unique indexes, so upsert them in two passes with the matching
  // on_conflict target — mixing them in one call would violate one index.
  const resolved = [];
  const ambiguous = [];
  for (const c of casts) {
    if (!c || !c.target || !c.cast_at) continue;
    const sid = Number.isFinite(c.spell_id) ? Math.trunc(c.spell_id) : 0;
    const row = {
      guild_id:     guildId,
      target:       String(c.target).slice(0, 64),
      spell_id:     sid,
      spell_name:   c.spell_name ? String(c.spell_name).slice(0, 128) : null,
      landing_text: c.landing_text ? String(c.landing_text).slice(0, 256) : null,
      dur_ticks:    Number.isFinite(c.dur_ticks) ? Math.trunc(c.dur_ticks) : null,
      dur_formula:  Number.isFinite(c.dur_formula) ? Math.trunc(c.dur_formula) : null,
      cast_at:      new Date(c.cast_at).toISOString(),
      observer:     c.observer ? String(c.observer).slice(0, 64) : null,
      is_charm_spell: !!c.is_charm_spell,
      uploaded_by_discord_id: identity.discord_id,
    };
    (sid !== 0 ? resolved : ambiguous).push(row);
  }

  let written = 0;
  if (resolved.length) {
    const r = await supabase.upsert('buff_casts', resolved, 'guild_id,target,spell_id,cast_at')
      .catch(err => { console.warn('[buff-casts] resolved upsert failed:', err?.message); return null; });
    if (Array.isArray(r)) written += r.length;
  }
  if (ambiguous.length) {
    const r = await supabase.upsert('buff_casts', ambiguous, 'guild_id,target,landing_text,cast_at')
      .catch(err => { console.warn('[buff-casts] ambiguous upsert failed:', err?.message); return null; });
    if (Array.isArray(r)) written += r.length;
  }
  _trackUpload({ endpoint: 'buff_cast', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, written }));
}

async function _handleAgentHistoricalChat(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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
      uploaded_by: identity.discord_id,
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
          uploaded_by: identity.discord_id,
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

  _trackUpload({ endpoint: 'historical_chat', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, stored: lines.length }));
}

async function _handleAgentLockout(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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

  _trackUpload({ endpoint: 'lockout', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });
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
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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

// GET /api/agent/spell-catalog
//
// Returns the EQ spell catalog from `eqemu_spells` so the agent can:
//   (a) turn a logged spell NAME into a PQDI link (/spell/<id>) on its
//       dashboard cards (resisted spells, inbound spell damage), and
//   (b) infer which spell landed from an effect-text line in the log by
//       matching cast_on_you / cast_on_other / spell_fades messages.
//
// Cached on the bot side for 1h — the catalog only changes after the weekly
// sync run. Response is compact JSON (~250-500KB for ~3.9k spells).
// Response shape:
//   { version, fetched_at, count, entries: [{ id, name, you, other, fades }, ...] }
// Bot-side cache for /api/agent/spell-catalog. The catalog is built from
// eqemu_spells, which is only touched by the weekly sync, so a 1h TTL is
// generous enough that a fresh sync becomes visible within an hour without
// pounding Supabase on every agent restart.
let _spellCatalogCache = null;       // { fetchedAt: ms, body: string, etag: string }
const _SPELL_CATALOG_TTL_MS = 60 * 60 * 1000;
async function _handleAgentSpellCatalog(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  const fresh = _spellCatalogCache && (Date.now() - _spellCatalogCache.fetchedAt) < _SPELL_CATALOG_TTL_MS;
  if (!fresh) {
    try {
      // BUG FIX: previously this code used supabase.from('...').select(...).range(...)
      // — that's the @supabase/supabase-js SDK API, but ./utils/supabase is a
      // hand-rolled REST helper that exposes select(table, queryString). Every
      // request to /api/agent/spell-catalog has been throwing
      // "supabase.from is not a function" since this endpoint shipped, which
      // is exactly the 500 the agent logs as "[spell-catalog] HTTP 500".
      // Switched to the REST helper's actual signature.
      const supabase = require('./utils/supabase');
      const entries = [];
      let from = 0;
      const PAGE = 1000;
      const SELECT = 'select=id,name,cast_on_you,cast_on_other,spell_fades,buffduration,buffdurationformula,cast_time,good_effect';
      while (true) {
        // PostgREST paging via Range header is wrapped by Supabase's REST API
        // as offset/limit query params. We pass them as `&offset=X&limit=Y`
        // which the supabase utility forwards verbatim.
        const data = await supabase.select('eqemu_spells',
          `${SELECT}&order=id.asc&offset=${from}&limit=${PAGE}`);
        if (!Array.isArray(data) || data.length === 0) break;
        for (const r of data) {
          entries.push({
            id: r.id, name: r.name, you: r.cast_on_you, other: r.cast_on_other, fades: r.spell_fades,
            dur: r.buffduration, durf: r.buffdurationformula,
            cast_ms: r.cast_time,
            // 1 = beneficial (buff), 0 = detrimental (debuff); null until the
            // eqemu sync populates good_effect. Lets overlays color buff/debuff.
            good: (r.good_effect == null ? null : (Number(r.good_effect) ? 1 : 0)),
          });
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      const body = JSON.stringify({
        version: 4,   // v4 adds `good` (beneficial flag) per entry
        fetched_at: new Date().toISOString(),
        count: entries.length,
        entries,
      });
      // Lightweight ETag = sha1 of the JSON body. Lets the agent skip the parse
      // on a 304 if its cached copy is current.
      const etag = '"' + require('crypto').createHash('sha1').update(body).digest('hex') + '"';
      _spellCatalogCache = { fetchedAt: Date.now(), body, etag };
    } catch (err) {
      console.error('[spell-catalog] fetch failed:', err && err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'fetch failed', message: String(err && err.message || err) }));
    }
  }

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === _spellCatalogCache.etag) {
    res.writeHead(304, { 'ETag': _spellCatalogCache.etag, 'Cache-Control': 'max-age=3600' });
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'ETag': _spellCatalogCache.etag,
    'Cache-Control': 'max-age=3600',
  });
  return res.end(_spellCatalogCache.body);
}

// GET /api/agent/item-clickies
//
// Returns the click-effect catalog for every item that has one. Lets the
// Mimic melody overlay show the right cast time when a player triggers an
// item (Robe of the Spring → 12s Skin like Nature, not the spell's bare
// 5s). Shape: { version, fetched_at, count, entries: [{ name, casttime,
// clickeffect, clicktype, clicklevel }] }. Cached aggressively because the
// item catalog is huge but virtually static.
//
// Defensively handles the case where the migration adding casttime /
// clickeffect / clicktype columns hasn't applied yet — returns an empty
// catalog instead of 500ing so the agent can still operate.
let _itemClickyCache    = null;
const _ITEM_CLICKY_TTL_MS = 6 * 60 * 60 * 1000;
async function _handleAgentItemClickies(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  const fresh = _itemClickyCache && (Date.now() - _itemClickyCache.fetchedAt) < _ITEM_CLICKY_TTL_MS;
  if (!fresh) {
    const entries = [];
    try {
      const supabase = require('./utils/supabase');
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const data = await supabase.select('eqemu_items',
          `select=id,name,casttime,clickeffect,clicktype,clicklevel&clickeffect=not.is.null&order=id.asc&offset=${from}&limit=${PAGE}`);
        if (!Array.isArray(data) || data.length === 0) break;
        for (const r of data) {
          entries.push({
            id: r.id, name: r.name,
            casttime: r.casttime, clickeffect: r.clickeffect,
            clicktype: r.clicktype, clicklevel: r.clicklevel,
          });
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
    } catch (err) {
      // Column missing (migration not applied yet) or other transient
      // failure — keep the bot alive and return an empty catalog so the
      // agent gracefully falls back to spell-based cast times.
      console.warn('[item-clickies] fetch failed (returning empty):', err && err.message);
    }
    const body = JSON.stringify({
      version: 1,
      fetched_at: new Date().toISOString(),
      count: entries.length,
      entries,
    });
    const etag = '"' + require('crypto').createHash('sha1').update(body).digest('hex') + '"';
    _itemClickyCache = { fetchedAt: Date.now(), body, etag };
  }
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === _itemClickyCache.etag) {
    res.writeHead(304, { 'ETag': _itemClickyCache.etag, 'Cache-Control': 'max-age=21600' });
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'ETag': _itemClickyCache.etag,
    'Cache-Control': 'max-age=21600',
  });
  return res.end(_itemClickyCache.body);
}

// GET /api/agent/mob-info?name=<npc>
//
// Target-mob lookup for Mimic's Mob Info overlay. Resolves the agent's current
// Zeal target name to its eqemu_npc_types row and returns the combat-relevant
// stats (HP, AC, the five resists, melee range, decoded special attacks). NPC
// catalog names use underscores ("Aten_Ha_Ra"); the Zeal target name may use
// spaces or backticks, so we normalize both to underscores for the match.
const _MOB_SPECIAL_LABELS = {
  1:'Summon', 2:'Enrage', 3:'Rampage', 4:'Area Rampage', 5:'Flurry',
  6:'Triple Attack', 7:'Quad Attack', 9:'Bane', 10:'Magical', 11:'Ranged',
  12:'Unslowable', 13:'Unmezzable', 14:'Uncharmable', 15:'Unstunnable',
  16:'Unsnareable', 17:'Unfearable', 18:'Undispellable', 19:'Immune Melee',
  20:'Immune Magic', 21:'Immune Fleeing', 23:'Immune Non-Magical',
  27:'Immune Feign Death', 28:'Immune Taunt', 31:'Immune Pacify',
};
const _MOB_CLASS_NAMES = {
  1:'Warrior', 2:'Cleric', 3:'Paladin', 4:'Ranger', 5:'Shadow Knight', 6:'Druid',
  7:'Monk', 8:'Bard', 9:'Rogue', 10:'Shaman', 11:'Necromancer', 12:'Wizard',
  13:'Magician', 14:'Enchanter', 15:'Beastlord', 16:'Berserker',
};
function _decodeMobSpecials(special_abilities, npcspecialattks) {
  const out = [];
  if (special_abilities) {
    for (const part of String(special_abilities).split('^')) {
      const bits = part.split(',');
      const id = parseInt(bits[0], 10);
      if (!Number.isFinite(id)) continue;
      if (bits[1] != null && String(bits[1]).trim() === '0') continue;   // disabled
      const label = _MOB_SPECIAL_LABELS[id];
      if (label && !out.includes(label)) out.push(label);
    }
  } else if (npcspecialattks) {
    const FLAG = { E:'Enrage', F:'Flurry', R:'Rampage', r:'Area Rampage', S:'Summon',
      T:'Triple Attack', Q:'Quad Attack', b:'Bane', m:'Magical', a:'Ranged' };
    for (const ch of String(npcspecialattks)) if (FLAG[ch] && !out.includes(FLAG[ch])) out.push(FLAG[ch]);
  }
  return out;
}
function _normMobName(n) {
  // Strip the "'s corpse" suffix BEFORE normalizing punctuation so a target
  // like "Vyzh`dra the Exiled's corpse" still resolves to the live NPC row
  // in eqemu_npc_types (otherwise the underscore-collapsed form ends in
  // "_s_corpse" and never matches). Lets the Mob Info overlay keep showing
  // stats + loot for a freshly-killed mob you're looting from.
  return String(n || '').trim().toLowerCase()
    .replace(/'s\s+corpse$/, '')
    .replace(/[\s`'’]+/g, '_').replace(/^#/, '');
}
const _mobInfoCache = new Map();   // normName → { at, row|null }
const _MOB_INFO_TTL_MS = 6 * 60 * 60 * 1000;   // static catalog data — cache hard
// ── Chat → loot detection ───────────────────────────────────────────────────
// EQ item links in chat carry their 7-digit zero-padded item ID inline. We
// scan every relayed chat row for those IDs, find the most-recent boss kill
// (if there is one within the window), and cross-reference each ID against
// the mob's published drop table (eqemu_npc_drops). Matches get logged in
// loot_observations with source='chat_extracted'. The cross-reference IS the
// false-positive filter — random 7-digit numbers that happen to appear in
// chat won't be in any expected drop table, so they're silently ignored.
//
// Caches:
//   _recentKillCache  → last kill per guild, refreshed every 30s. Avoids
//                       hammering the encounters table on every chat line.
//   _npcDropsCache    → expected item_id set per (guild, npc_id), 6h.
const CHAT_LOOT_WINDOW_MS = 15 * 60 * 1000;          // a kill within 15 min counts
const _recentKillCache = new Map();                  // guildId → { at, kill }
const _RECENT_KILL_TTL_MS = 30 * 1000;
async function _recentKillFor(guildId) {
  const cached = _recentKillCache.get(guildId);
  if (cached && (Date.now() - cached.at) < _RECENT_KILL_TTL_MS) return cached.kill;
  const supabase = require('./utils/supabase');
  let kill = null;
  try {
    const rows = await supabase.select('encounters',
      `guild_id=eq.${encodeURIComponent(guildId)}&npc_id=not.is.null&select=npc_id,started_at,ended_at&order=ended_at.desc.nullslast&limit=1`);
    const r = Array.isArray(rows) && rows[0];
    if (r) kill = { npc_id: r.npc_id, ended_at: r.ended_at || r.started_at };
  } catch (err) { console.warn('[chat-loot] recent-kill fetch failed:', err?.message); }
  _recentKillCache.set(guildId, { at: Date.now(), kill });
  return kill;
}

const _npcDropsCache = new Map();                    // `${guild}:${npc_id}` → { at, items: Map<itemId, name> }
const _NPC_DROPS_TTL_MS = 6 * 60 * 60 * 1000;
async function _dropsForNpc(guildId, npcId) {
  const key = `${guildId}:${npcId}`;
  const cached = _npcDropsCache.get(key);
  if (cached && (Date.now() - cached.at) < _NPC_DROPS_TTL_MS) return cached.items;
  const supabase = require('./utils/supabase');
  const items = new Map();
  try {
    const rows = await supabase.select('eqemu_npc_drops',
      `npc_id=eq.${npcId}&select=item_id,item_name&limit=200`);
    if (Array.isArray(rows)) for (const r of rows) items.set(r.item_id, r.item_name);
  } catch (err) { console.warn('[chat-loot] drops fetch failed:', err?.message); }
  _npcDropsCache.set(key, { at: Date.now(), items });
  return items;
}

// Pulls 7-digit IDs from a chat text body. We use negative digit-lookbehind +
// lookahead instead of \b — \b at the end fails when the next char is a
// letter (the standard EQ item-link format "1234567ItemName" runs 7→I, both
// word chars, so \b doesn't fire). (?<!\d)\d{7}(?!\d) catches 7-digit IDs in
// any text context but won't match within a longer numeric run (10-digit
// Discord snowflakes etc.). The drop-table filter downstream eliminates the
// remaining false positives (any 7-digit number that isn't an actual item ID
// won't be in any mob's loot table).
function _extractItemIds(text) {
  if (!text || typeof text !== 'string') return [];
  const out = new Set();
  const rx = /(?<!\d)(\d{7})(?!\d)/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const id = parseInt(m[1], 10);
    if (id > 0) out.add(id);
  }
  return [...out];
}

async function _maybeRecordChatLoot(chatRow, uploadedByDiscordId) {
  const text = chatRow?.text;
  const ids = _extractItemIds(text);
  if (ids.length === 0) return;
  const guildId = chatRow.guild_id;
  const msgTs   = chatRow.ts ? Date.parse(chatRow.ts) : Date.now();
  const kill = await _recentKillFor(guildId);
  if (!kill || !kill.npc_id) return;
  // Only count loot posted within 15 min of the kill — older chat is ambient
  // mentions, not a fresh loot announcement.
  const killTs = kill.ended_at ? Date.parse(kill.ended_at) : 0;
  if (!killTs || (msgTs - killTs) > CHAT_LOOT_WINDOW_MS || (msgTs - killTs) < -60_000) return;
  const expected = await _dropsForNpc(guildId, kill.npc_id);
  if (!expected || expected.size === 0) return;
  // Look up the npc_name for the npc_name_lower key — same path mob-info uses.
  const supabase = require('./utils/supabase');
  let npcName = null;
  try {
    const nrows = await supabase.select('eqemu_npc_types', `id=eq.${kill.npc_id}&select=name&limit=1`);
    if (Array.isArray(nrows) && nrows[0]) npcName = nrows[0].name;
  } catch (err) { void err; }
  if (!npcName) return;
  const npcLower = String(npcName).toLowerCase().replace(/_/g, ' ').trim();
  // Build observation rows for the matched IDs only — the drop-table filter is
  // what makes this safe to run on every chat message.
  const rows = [];
  for (const id of ids) {
    const name = expected.get(id);
    if (!name) continue;
    rows.push({
      guild_id:             guildId,
      npc_name_lower:       npcLower,
      npc_id:               kill.npc_id,
      item_id:              id,
      item_name:            name,
      posted_at:            new Date(msgTs).toISOString(),
      posted_by_discord_id: uploadedByDiscordId || null,
      source:               'chat_extracted',
    });
  }
  if (rows.length === 0) return;
  await supabase.insert('loot_observations', rows)
    .catch(err => console.warn('[chat-loot] insert failed:', err?.message));
}

// GET /api/agent/target-casts?name=<npc|player> → active casts on that target,
// from the cross-client casting relay (_castingByTarget). Each entry counts down
// its remaining cast time. Bearer-auth like the other agent endpoints.
async function _handleAgentTargetCasts(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  let name = '';
  try { name = new URL(req.url, 'http://x').searchParams.get('name') || ''; } catch { /* */ }
  const tk = String(name).trim().toLowerCase();
  const now = Date.now();
  _pruneCasts(now);
  const mp = tk ? _castingByTarget.get(tk) : null;
  const casts = [];
  if (mp) {
    for (const c of mp.values()) {
      casts.push({
        caster:         c.caster,
        spell:          c.spell,
        ends_at_ms:     c.started_at_ms + c.cast_secs * 1000,   // overlay counts down to this
        remaining_secs: Math.max(0, Math.round((c.started_at_ms + c.cast_secs * 1000 - now) / 1000)),
        cast_secs:      c.cast_secs,
      });
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ casts }));
}

// Curse counter map for the debuff queue's "high-counter first" sort. Higher
// counter = more cure casts needed to remove = higher priority. Numbers come
// from spell descriptions on PQDI / EQ-Resource. Unknown curses get 0 so they
// still appear in the queue (since the keyword matched) but sink below known
// high-counter ones. Single source of truth for the bot side; the agent's
// raidBuffs.js only categorizes membership, not severity.
const _CURSE_COUNTERS = [
  // [keyword (lowercase), counter count]
  ['gravel rain', 12],
  ['sand storm',   9], ['sandstorm', 9],
  ['plague',       7],
  ['pestilence',   7],
  ["innoruuk's curse", 5], ['curse of innoruuk', 5],
  ['venom of',     4], ['envenomed', 4],
  ['splurt',       4],
  ['curse of',     3],   // generic catch-all — lower than named entries
  ['word of',      1],
];
function _CURSE_COUNTERS_FOR(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return 0;
  for (const [k, c] of _CURSE_COUNTERS) if (n.includes(k)) return c;
  return 0;
}

// GET /api/agent/target-buffs?name=<target>
// Returns recent active buff_casts on a given target so OTHER Mimic users
// can see them on their own Mob Info overlay. Primary use: charm spells
// (Allure / Beguile / Charm) which have cast_on_other = NULL in eqemu_spells
// — without this relay, only the caster's Mimic ever sees the charm timer.
// Filtered to entries not yet past their catalog duration. Each row carries
// `owner` (the caster — observer field on the original landing) so Mob Info
// can render "Allure (Hopeya)".
async function _handleAgentTargetBuffs(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  let name = '';
  try { name = new URL(req.url, 'http://x').searchParams.get('name') || ''; } catch { /* */ }
  if (!name) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ buffs: [] }));
  }
  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ buffs: [], note: 'supabase disabled' }));
  }
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  // 3h window covers the longest reasonable charm/buff lifetime; per-row
  // filter below drops anything past its catalog duration.
  const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  try {
    const rows = await supabase.select('buff_casts',
      `guild_id=eq.${encodeURIComponent(guildId)}&target=ilike.${encodeURIComponent(name)}` +
      `&cast_at=gte.${encodeURIComponent(since)}` +
      `&select=spell_name,dur_ticks,cast_at,observer,is_charm_spell&order=cast_at.desc&limit=50`);
    const now = Date.now();
    // Dedup by spell_name — most recent cast wins (a recast overwrites the
    // previous landing's timer).
    const bySpell = new Map();
    for (const r of (rows || [])) {
      if (!r || !r.spell_name) continue;
      const castMs  = Date.parse(r.cast_at) || 0;
      if (!castMs) continue;
      const durSecs = (Number(r.dur_ticks) || 0) * 6;
      if (durSecs > 0 && (now - castMs) > durSecs * 1000) continue;     // expired
      const k = String(r.spell_name).toLowerCase();
      const prev = bySpell.get(k);
      if (!prev || castMs > prev.castMs) bySpell.set(k, { row: r, castMs, durSecs });
    }
    const buffs = [];
    for (const v of bySpell.values()) {
      const rem = v.durSecs > 0 ? v.durSecs - (now - v.castMs) / 1000 : null;
      buffs.push({
        name:           v.row.spell_name,
        remaining_secs: rem != null ? Math.max(0, Math.round(rem)) : null,
        total_secs:     v.durSecs > 0 ? Math.round(v.durSecs) : null,
        observed_at_ms: v.castMs,
        // is_charm_spell forces good=0 (debuff section) on the receiver
        // even when catalog good_effect says otherwise.
        good:           v.row.is_charm_spell ? 0 : null,
        owner:          v.row.observer || null,
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ buffs }));
  } catch (err) {
    console.error('[target-buffs] fetch failed:', err && err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'fetch failed' }));
  }
}

// Who has the Mass Group Buff AA trained — Quarmy AA index 35 (eqemu_altadv_vars
// eqmacid). Source is the members' own Quarmy exports via /api/agent/quarmy, so
// it only knows characters whose owners run the gear sync; absence ≠ untrained.
// Refreshed every 10 min (AA purchases are rare).
const _MGB_AA_INDEX = 35;
let _mgbCache = { at: 0, names: new Set() };
async function _mgbTrainedSet(supabase, guildId) {
  if (Date.now() - _mgbCache.at < 10 * 60 * 1000) return _mgbCache.names;
  try {
    const rows = await supabase.select('character_aas',
      `guild_id=eq.${encodeURIComponent(guildId)}&aa_index=eq.${_MGB_AA_INDEX}&rank=gte.1&select=character`);
    _mgbCache = { at: Date.now(), names: new Set((rows || []).map(r => String(r.character || '').toLowerCase()).filter(Boolean)) };
  } catch (e) {
    console.warn('[raid-buff-queue] MGB AA fetch failed:', e && e.message);
    _mgbCache.at = Date.now();   // don't hammer on failure
  }
  return _mgbCache.names;
}

// Website-style per-raider buff breakdown (mirrors /raid's detail panel) so
// the dashboard Raid card can render the same sections instead of a flat chip
// list. Entries are {n: name, s: remaining seconds | null}. Songs are placed
// in `songs` AND credited to resist schools (a Psalm covers its school).
function _buffDetailFor(rb, buffs) {
  const names = (buffs || []).map(b => b && b.name).filter(Boolean);
  const hpSlots = rb.analyzeHpSlots(names);
  const slotted = new Set([hpSlots.A, hpSlots.B, hpSlots.C].filter(Boolean).map(n => String(n).toLowerCase()));
  const cats = {}; const resists = {}; const ds = []; const songs = []; const other = [];
  for (const b of (buffs || [])) {
    if (!b || !b.name) continue;
    const name = String(b.name);
    const secs = (typeof b.ticks === 'number' && b.ticks > 0 && b.ticks < 6000) ? Math.round(b.ticks * 6) : null;
    const entry = { n: name.slice(0, 60), s: secs };
    const isSong = rb.isSongBuff(name, typeof b.song === 'boolean' ? b.song : undefined);
    const rTypes = rb.resistTypesFor(name);
    for (const t of rTypes) (resists[t] = resists[t] || []).push(entry);
    if (isSong) { songs.push(entry); continue; }
    if (rTypes.length) continue;
    const cat = rb.categorizeBuff(name);
    if (cat === 'ds') { ds.push(entry); continue; }
    if (cat === 'hp' && slotted.has(name.toLowerCase())) continue;   // shown on its HP slot row
    if (cat) { (cats[cat] = cats[cat] || []).push(entry); }
    else other.push(entry);
    // Secondary credits (VoG→attack, POTG/POTC→manaRegen) so the detail rows
    // match the queue's "not missing" logic.
    for (const sec of rb.secondaryCategoriesFor(name)) {
      if (sec !== cat) (cats[sec] = cats[sec] || []).push(entry);
    }
  }
  return {
    hp: { A: hpSlots.A || null, B: hpSlots.B || null, C: hpSlots.C || null },
    cats, resists, ds, songs, other,
  };
}

// GET /api/agent/raid-buff-queue?class=<class>&character=<self>
// Powers the Mimic buff-queue overlay. Returns two lists:
//   buff_queue   — raiders missing buffs the buffer's class can provide,
//                  sorted severity-first (red → orange → yellow)
//   debuff_queue — raiders carrying a known curse (Gravel Rain etc.) plus
//                  a `casting` field per row: who is currently casting on
//                  that raider (from the cross-client casting relay), so a
//                  second cleric doesn't double-up Cure Disease etc.
// Same auth + small payload as /api/agent/target-casts.
async function _handleAgentRaidBuffQueue(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  let bufferClass = '';
  let bufferCharacter = '';
  try {
    const u = new URL(req.url, 'http://x');
    bufferClass     = (u.searchParams.get('class')     || '').trim();
    bufferCharacter = (u.searchParams.get('character') || '').trim();
  } catch { /* */ }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ buff_queue: [], debuff_queue: [], note: 'supabase disabled' }));
  }
  const rb = require('./utils/raidBuffs');

  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const ROSTER_FRESH_MS = 15 * 60 * 1000;
  const rosterSince = new Date(Date.now() - ROSTER_FRESH_MS).toISOString();

  try {
    // Buff_casts window — 3h covers Aegolism/POTG/SoW/etc. extended-duration
    // groups buffs without dragging in long-stale observations. We filter
    // further per-row by spell duration + post-death cutoff below.
    const buffCastsSince = new Date(Date.now() - 3 * 3600 * 1000).toISOString();

    const [liveRows, rosterRows, charRows, buffCastRows] = await Promise.all([
      supabase.select('character_live_state',
        `guild_id=eq.${encodeURIComponent(guildId)}&select=character,buffs,buff_count,zone_name,self_hp_pct,updated_at`),
      supabase.select('raid_roster',
        `guild_id=eq.${encodeURIComponent(guildId)}&captured_at=gte.${encodeURIComponent(rosterSince)}&select=name,class,group_num,rank,level,hp_pct,uploaded_by_discord_id,captured_at`),
      supabase.select('characters',
        `guild_id=eq.${encodeURIComponent(guildId)}&class=not.is.null&select=name,class`),
      supabase.select('buff_casts',
        `guild_id=eq.${encodeURIComponent(guildId)}&cast_at=gte.${encodeURIComponent(buffCastsSince)}` +
        `&select=target,spell_name,dur_ticks,cast_at&order=cast_at.desc&limit=3000`),
    ]);

    // class lookup: OpenDKP roster wins, fall back to Zeal raid roster.
    const classByName = new Map();
    for (const c of (charRows || [])) if (c && c.name && c.class) classByName.set(c.name.toLowerCase(), c.class);
    // Per-uploader snapshots → cluster into distinct raids (two raids can
    // run at once; snapshots sharing any member are the same raid). The
    // queue scopes to the BUFFER'S raid: their own agent is the requester,
    // so identity.discord_id's snapshot pins it; fall back to the cluster
    // containing bufferCharacter, then to everything (no roster signal).
    const snapsByUploader = new Map();
    for (const r of (rosterRows || [])) {
      if (!r || !r.name || rb.isCorpse(r.name)) continue;
      const up = String(r.uploaded_by_discord_id || '');
      if (!snapsByUploader.has(up)) snapsByUploader.set(up, []);
      snapsByUploader.get(up).push(r);
    }
    const uploaders = [...snapsByUploader.keys()];
    const clusterOf = new Map(uploaders.map((u, i) => [u, i]));
    const find = (u) => { let r = clusterOf.get(u); return r; };
    // Union snapshots sharing a member.
    const byMember = new Map();   // member(lower) → first uploader seen
    for (const [up, rows] of snapsByUploader) {
      for (const r of rows) {
        const m = r.name.toLowerCase();
        if (!byMember.has(m)) { byMember.set(m, up); continue; }
        const other = byMember.get(m);
        const a = find(up), b = find(other);
        if (a !== b) for (const [u2, c] of clusterOf) if (c === a) clusterOf.set(u2, b);
      }
    }
    let scopedUploaders = null;
    if (identity.discord_id && snapsByUploader.has(identity.discord_id)) {
      const c = find(identity.discord_id);
      scopedUploaders = uploaders.filter(u => find(u) === c);
    } else if (bufferCharacter) {
      const owner = byMember.get(bufferCharacter.toLowerCase());
      if (owner != null) {
        const c = find(owner);
        scopedUploaders = uploaders.filter(u => find(u) === c);
      }
    }
    const rosterByName = new Map();
    const hpByName = new Map();   // member → freshest row that actually has hp_pct
    for (const [up, rows] of snapsByUploader) {
      if (scopedUploaders && !scopedUploaders.includes(up)) continue;
      for (const r of rows) {
        const k = r.name.toLowerCase();
        const prev = rosterByName.get(k);
        if (!prev || String(r.captured_at || '') > String(prev.captured_at || '')) rosterByName.set(k, r);
        if (r.hp_pct != null) {
          const ph = hpByName.get(k);
          if (!ph || String(r.captured_at || '') > String(ph.captured_at || '')) hpByName.set(k, r);
        }
      }
    }
    // Backfill: an uploader whose Zeal gauges miss a member writes hp_pct
    // null; without this, "freshest row wins" flickered HP on/off as the
    // two Mimics alternated heartbeats.
    for (const [k, r] of rosterByName) {
      if (r.hp_pct == null && hpByName.has(k)) r.hp_pct = hpByName.get(k).hp_pct;
    }
    const classFor = (n) => classByName.get(String(n).toLowerCase()) || (rosterByName.get(String(n).toLowerCase()) || {}).class || null;

    // Same "online" pulse as /raid's auto-hide: a live-state row whose last
    // Mimic heartbeat is older than 15 minutes is someone who logged off —
    // their stale buff array must not put them on tonight's queue.
    const liveByName = new Map();
    const liveCutoffMs = Date.now() - ROSTER_FRESH_MS;
    for (const r of (liveRows || [])) {
      if (!r || !r.character || rb.isCorpse(r.character)) continue;
      const at = r.updated_at ? (Date.parse(r.updated_at) || 0) : 0;
      if (at < liveCutoffMs) continue;
      liveByName.set(r.character.toLowerCase(), r);
    }

    // Observed buff landings → per-target buff inference for raiders NOT
    // running Mimic. Filters out anything (a) past its catalog duration and
    // (b) cast BEFORE the target's most recent death (dying strips buffs).
    // Multiple casts of the same spell → most recent wins. Same spell name
    // shape as character_live_state.buffs ({name, ticks}) so the rest of the
    // queue logic doesn't care whether the buffs are live or inferred.
    const inferredBuffsByName = new Map();   // nameLower → [{ name, ticks }]
    {
      const now = Date.now();
      // (target, spellNameLower) → latest cast row, after filtering. Spell
      // duration is dur_ticks * 6 seconds — the no-focus catalog floor.
      const byKey = new Map();
      for (const c of (buffCastRows || [])) {
        if (!c || !c.target || !c.spell_name) continue;
        const targetKey = String(c.target).toLowerCase();
        const castMs    = Date.parse(c.cast_at) || 0;
        if (!castMs) continue;
        const lastDeath = _lastRaiderDeath.get(targetKey) || 0;
        if (castMs < lastDeath) continue;   // dying stripped this buff
        const durSecs   = (Number(c.dur_ticks) || 0) * 6;
        if (durSecs > 0 && (now - castMs) > durSecs * 1000) continue;   // expired
        const k = targetKey + '|' + String(c.spell_name).toLowerCase();
        const prev = byKey.get(k);
        if (!prev || castMs > prev.castMs) byKey.set(k, { name: c.spell_name, ticks: c.dur_ticks, castMs, target: c.target });
      }
      for (const v of byKey.values()) {
        const remSecs = (Number(v.ticks) || 0) * 6 - (now - v.castMs) / 1000;
        const remTicks = remSecs > 0 ? Math.ceil(remSecs / 6) : 0;
        if (remTicks <= 0) continue;
        const k = String(v.target).toLowerCase();
        if (!inferredBuffsByName.has(k)) inferredBuffsByName.set(k, []);
        // castMs rides along so live-row merging can tell "landed AFTER the
        // target's last Zeal flush" from stale history.
        inferredBuffsByName.get(k).push({ name: v.name, ticks: remTicks, castMs: v.castMs });
      }
    }

    // Live buffs + NEWER observed landings, merged. Live state used to win
    // outright — but it only flushes when the TARGET's Mimic sees a change,
    // so a fresh Feral Avatar the CASTER's agent observed (buff_casts lands
    // within ~5s) was ignored until the target's row caught up, and the
    // burst queue kept listing an already-buffed raider. Any observed cast
    // newer than the live row's updated_at joins the set.
    function buffsFor(live, inferred) {
      const liveBuffs = (live && Array.isArray(live.buffs)) ? live.buffs : null;
      if (!liveBuffs) return inferred || [];
      const liveAt = live.updated_at ? Date.parse(live.updated_at) || 0 : 0;
      const merged = liveBuffs.slice();
      const have = new Set(liveBuffs.map(b => b && b.name ? String(b.name).toLowerCase() : ''));
      for (const inf of (inferred || [])) {
        if (!inf || !inf.name) continue;
        if ((inf.castMs || 0) <= liveAt) continue;
        const nl = String(inf.name).toLowerCase();
        if (have.has(nl)) continue;
        merged.push({ name: inf.name, ticks: inf.ticks });
        have.add(nl);
      }
      return merged;
    }

    // Build a row per in-raid raider (live state OR roster). Categorize buffs,
    // figure HP slots, decide if they have a curse.
    //
    // ── GROUP fallback ──────────────────────────────────────────────────────
    // When no raid roster is active (the user is in a group, not a raid), the
    // raid_roster table is empty. Fall back to "everyone with fresh live state
    // OR an inferred-buff record" so a Cleric in a 6-person group still sees
    // their groupmates on the queue.
    const provides = rb.classProvides(bufferClass);
    const buffQueue = [];
    const debuffQueue = [];

    // Only include characters who are demonstrably ONLINE right now:
    //   • In the current raid_roster window (Zeal type-5 snapshot, 15min fresh)
    //   • OR streaming live state within the same 15-min window (groupMode)
    // Pure buff_casts inference is dropped — those are buffs WE'VE seen on
    // someone over the last 3h, which is not the same as "they're online".
    // When a raid roster IS active, candidates are the roster — a fresh live
    // streamer who isn't in the buffer's raid doesn't belong on its queue.
    // groupMode (no raid roster) falls back to "anyone with fresh live state"
    // so a group of Mimic users sees each other without needing a /raid.
    const groupMode = rosterByName.size === 0;
    const allKeys = groupMode
      ? new Set([...liveByName.keys()])
      : new Set([...rosterByName.keys()]);
    // Buffer's current zone — drives same-zone-first sort. Fall back to
    // "no zone" when we don't know who's asking; the sort degrades to
    // just-by-tier in that case.
    const bufferKey = bufferCharacter.toLowerCase();
    const bufferZone = (() => {
      const lv = bufferKey ? liveByName.get(bufferKey) : null;
      if (lv && lv.zone_name) return String(lv.zone_name);
      return null;
    })();
    const seen = new Set();

    for (const k of allKeys) {
      if (seen.has(k)) continue;
      seen.add(k);
      const live = liveByName.get(k);
      const rr   = rosterByName.get(k);
      const inferred = inferredBuffsByName.get(k) || null;
      const name = (rr && rr.name) || (live && live.character) || k;
      const cls  = classFor(name);
      const role = rb.classToRole(cls);
      // Live buffs merged with NEWER observed landings (see buffsFor) — this
      // is the buff set we categorize from. `isInferred` flags rows whose
      // buffs came ONLY from buff_casts (no Mimic on that player) so the
      // overlay can render a "🔍 inferred" badge.
      const buffs = buffsFor(live, inferred);
      const isInferred = !live && (inferred && inferred.length > 0);
      // noAgent now means "we have NO signal at all" — neither live state nor
      // an inferred buff landing. Skip buff-queue analysis for these (we don't
      // know their gaps), but they're still candidates for the debuff/burst
      // path if we get curses or damage from them later.
      const noAgent = !live && !isInferred;

      // Avatar / Celestial Tranquility / SK Touch of Hate Recourse detection
      // is now BURST-only — on a "Haste missing" row the 🪶 chip read as
      // "Avatar is providing the haste", which is wrong (Ancient: Feral
      // Avatar has no haste component). The chip's real signal is "skip
      // this raider for Feral Avatar / Savagery; they already have it",
      // which only applies to the burst queue.

      // Same-zone-as-buffer flag — drives "near you first" sort. Falls back
      // to false (treated equal) when we don't know the buffer's zone.
      const rowZone   = live && live.zone_name ? String(live.zone_name) : null;
      const sameZone  = !!(bufferZone && rowZone && bufferZone === rowZone);

      // Curses → debuff queue. Each curse line carries the buffer's casting
      // status from _castingByTarget so a second cure caster sees "Carol
      // already casting Remove Curse on Bob, 2s". Counter count (how many
      // RC ticks until cured) drives the "tippy-top" sort: high-counter
      // curses outrank low-counter ones within the debuff section.
      const curses = [];
      let maxCounters = 0;
      for (const b of buffs) if (b && b.name && rb.isCurseBuff(b.name)) {
        const cnt = _CURSE_COUNTERS_FOR(b.name);
        if (cnt > maxCounters) maxCounters = cnt;
        curses.push({
          name: b.name,
          counters: cnt || null,
          remaining_secs: (typeof b.ticks === 'number' && b.ticks > 0 && b.ticks < 6000) ? Math.round(b.ticks * 6) : null,
        });
      }
      if (curses.length > 0) {
        // Within a single raider's curses list, also surface highest-counter
        // first so the UI's right-side chip row reads worst → least.
        curses.sort((a, b) => (b.counters || 0) - (a.counters || 0));
        debuffQueue.push({
          name, class: cls, role, group: rr ? rr.group_num : null,
          curses,
          max_counters:          maxCounters,
          same_zone:             sameZone,
          inferred: isInferred,
          casting: _castingOnTarget(name),
        });
      }

      // Skip buff-queue analysis when (a) no buffer class is specified,
      // (b) we have no signal at all (no Mimic + no buff_casts), or (c) we
      // can't categorize their role.
      if (provides.length === 0 || noAgent) continue;
      const expected = rb.ROLE_TARGETS[role] || [];
      const byCategory = {};
      for (const b of buffs) if (b && b.name) {
        const cat = rb.categorizeBuff(b.name);
        if (cat) (byCategory[cat] = byCategory[cat] || []).push(b.name);
        // Secondary credits — VoG/Bihli carry ATK; POTG/POTC carry mana
        // regen (a POTG caster isn't "missing Mana Regen" to an enchanter).
        for (const sec of rb.secondaryCategoriesFor(b.name)) {
          if (sec !== cat && !(byCategory[sec] = byCategory[sec] || []).includes(b.name)) byCategory[sec].push(b.name);
        }
      }
      const missing = provides.filter(cat => expected.includes(cat) && !(byCategory[cat] || []).length);
      const hpSlots = rb.analyzeHpSlots(buffs.map(b => b && b.name).filter(Boolean));
      // Only nag the buffer about HP slots THEIR class can actually fill —
      // a Cleric provides slots A+B but not C (Khura/Brell/Arch are Shaman/
      // Wizard lines), so listing C in their queue is a false ask.
      const fillsSlots = rb.classHpSlots(bufferClass);
      const missingHp = provides.includes('hp') ? fillsSlots.filter(s => !hpSlots[s]) : [];

      // Upgrade chains the buffer's class can improve: present-but-lower-
      // link spells (Daring vs Aegolism, Kragg vs Khura, Journeyman vs
      // Spirit of Bih`Li). Surfaced as "Focus line ↑" chips so the queue
      // nudges a recast even when the slot itself reads filled.
      const buffNames = buffs.map(b => b && b.name).filter(Boolean);
      const upgrades = [];
      for (const ch of rb.UPGRADE_CHAINS) {
        if (ch.classes && !ch.classes.includes(bufferClass.toLowerCase())) continue;
        if (ch.roles && !ch.roles.includes(role)) continue;
        const pos = rb.chainPosition(ch.chain, buffNames);
        if (pos >= 0 && pos < ch.chain.length - 1) upgrades.push(ch.label);
      }
      if (missing.length === 0 && missingHp.length === 0 && upgrades.length === 0) continue;

      // Severity tier — same intent as /raid: any HP gap or caster/priest no
      // mana/regen → orange; missing category → yellow; only an upgrade
      // available (no real gap) → light-green "upgradable".
      const totalBuffs = buffs.filter(b => b && b.name).length;
      let tier;
      if (totalBuffs === 0) tier = 'red';
      else if (missingHp.length > 0) tier = 'orange';
      else if ((role === 'caster' || role === 'priest') && (missing.includes('mana') || missing.includes('manaRegen'))) tier = 'orange';
      else if (missing.length > 0) tier = 'yellow';
      else tier = 'upgradable';

      // POTG/POTC fills HP slot A *instead of* group Aegolism — clerics
      // should single-target the Symbol instead of group-casting Aego over
      // someone's druid buff. Surface what fills slot A so the overlay can
      // annotate.
      const slotA = hpSlots.A ? String(hpSlots.A) : null;
      const hasPotg = !!(slotA && /protection of the (glades|cabbage)/i.test(slotA));
      buffQueue.push({
        name, class: cls, role, group: rr ? rr.group_num : null,
        tier,
        hp_a: slotA,
        skip_group_aego: hasPotg,
        missing: missing.map(c => rb.CATEGORY_LABELS[c]).concat(missingHp.map(s => 'HP ' + s)),
        upgrades,
        // Tank HP gap = priority cue for the buff queue's sort. A naked
        // warrior needs Symbol before a naked wizard does.
        needs_tank_hp:         (role === 'tank' && missingHp.length > 0),
        same_zone:             sameZone,
        inferred: isInferred,
        casting: _castingOnTarget(name),
      });
    }

    // Buff queue sort:
    //   1. same zone as the buffer first (closer = actionable now)
    //   2. tank HP gaps next (tanks need HP before DPS does)
    //   3. severity tier (red → orange → yellow)
    //   4. group → name as final tie-breakers
    const sev = { red: 0, orange: 1, yellow: 2 };
    buffQueue.sort((a, b) =>
      (Number(!!b.same_zone) - Number(!!a.same_zone))
      || (Number(!!b.needs_tank_hp) - Number(!!a.needs_tank_hp))
      || (sev[a.tier] - sev[b.tier])
      || ((a.group || 99) - (b.group || 99))
      || a.name.localeCompare(b.name));
    // Debuff queue sort:
    //   1. same zone (you can actually cure them)
    //   2. highest curse-counter count (Gravel Rain = 12 outranks 1-counter)
    //   3. group → name
    debuffQueue.sort((a, b) =>
      (Number(!!b.same_zone) - Number(!!a.same_zone))
      || ((b.max_counters || 0) - (a.max_counters || 0))
      || ((a.group || 99) - (b.group || 99))
      || a.name.localeCompare(b.name));

    // Single-target burst-buff queues — Shaman Feral Avatar + Beastlord
    // Savagery. Both go on the highest-damage melee/tank, then on cooldown the
    // shaman/BL recasts on the next-highest. Queue is melee + tank role,
    // ordered by tonight's damage descending, with raiders already carrying
    // the buff omitted. We only build the queue that matches bufferClass so the
    // payload stays small.
    const burstSpec =
      bufferClass.toLowerCase() === 'shaman'    ? { key: 'feral_queue',    label: 'Feral Avatar',
          carriesRx: /feral avatar|^avatar\b/i } :
      bufferClass.toLowerCase() === 'beastlord' ? { key: 'savagery_queue', label: 'Savagery',
          carriesRx: /savagery|blood boils/i } : null;
    let burstQueue = [];
    if (burstSpec) {
      // Tonight's per-character damage from encounter_players ⨯ encounters
      // (filter to the last 6h — covers a 4h raid + warmup without needing a
      // raid_nights lookup). PostgREST inner-resource query with select on
      // both, then sum in JS.
      const sinceIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const dmgByName = new Map();
      try {
        const dmg = await supabase.select('encounter_players',
          `encounters.guild_id=eq.${encodeURIComponent(guildId)}&encounters.started_at=gte.${encodeURIComponent(sinceIso)}` +
          `&select=character_name,total_damage,encounters!inner(guild_id,started_at)&limit=5000`);
        for (const r of (dmg || [])) {
          const nm = r && r.character_name;
          const td = r && Number(r.total_damage);
          if (!nm || !Number.isFinite(td) || td <= 0) continue;
          dmgByName.set(nm.toLowerCase(), (dmgByName.get(nm.toLowerCase()) || 0) + td);
        }
      } catch (e) {
        console.warn('[raid-buff-queue] damage fetch failed:', e && e.message);
      }
      // Candidates: every in-raid (or in-group) tank/melee. Buffs taken from
      // live state when available, else inferred from buff_casts (so a
      // non-Mimic raider's Avatar / Hate Recourse is still visible). Skip
      // those already carrying the burst buff. Family fold-up of damage isn't
      // done here on purpose — the buff lands on the active character.
      for (const k of allKeys) {
        const live = liveByName.get(k);
        const rr   = rosterByName.get(k);
        const inferred = inferredBuffsByName.get(k) || null;
        const name = (rr && rr.name) || (live && live.character) || k;
        const cls  = classFor(name);
        const role = rb.classToRole(cls);
        if (role !== 'tank' && role !== 'melee') continue;
        const buffs = buffsFor(live, inferred);
        const isInferred = !live && (inferred && inferred.length > 0);
        const alreadyBuffed = buffs.some(b => b && b.name && burstSpec.carriesRx.test(b.name));
        if (alreadyBuffed) continue;
        const damage = dmgByName.get(name.toLowerCase()) || 0;
        // Avatar / Celestial Tranquility / SK Touch-of-Hate-Recourse chips on
        // burst rows — see the per-row block above for the rationale.
        const avatarBuff = buffs.find(b => b && b.name && /\b(feral avatar|primal avatar|avatar)\b/i.test(b.name));
        const celestial  = buffs.find(b => b && b.name && /celestial tranquility/i.test(b.name));
        const skRecourse = (cls && /shadow ?knight|^sk$/i.test(cls))
                           ? buffs.find(b => b && b.name && /t\.?\s*of hate recourse|touch of hate recourse/i.test(b.name))
                           : null;
        burstQueue.push({
          name, class: cls, group: rr ? rr.group_num : null,
          damage,
          inferred:              isInferred,
          avatar_buff:           avatarBuff ? avatarBuff.name : null,
          celestial_tranquility: !!celestial,
          sk_recourse:           skRecourse ? skRecourse.name : null,
          casting: _castingOnTarget(name),
        });
      }
      // Highest damage first; raiders with no damage signal yet sink (they may
      // be new arrivals, but a buffer shouldn't rank them above proven DPS).
      burstQueue.sort((a, b) => (b.damage || 0) - (a.damage || 0) || a.name.localeCompare(b.name));
      // Not everyone gets the burst buff — cap at 3 targets per provider of
      // the buffer's class in this raid (1 shaman → top 3, 2 shamans → top 6).
      // Slightly tighter than the original ~4: in practice each shaman cycles
      // ~2-3 targets between Feral Avatar cooldowns, so the longer queue was
      // showing names that would never actually get the buff.
      let providers = 0;
      for (const [k2] of rosterByName) {
        const c2 = classFor((rosterByName.get(k2) || {}).name || k2);
        if (c2 && String(c2).toLowerCase() === bufferClass.toLowerCase()) providers++;
      }
      burstQueue = burstQueue.slice(0, Math.min(15, Math.max(3, providers * 3)));
    }

    // Compact live-roster view for the dashboard's Raid card — the buffer's
    // raid only (same scoping as the queue). HP rides the Zeal group-gauge
    // broadcasts captured in raid_roster; buffs/zone from live state; tier
    // mirrors /raid's severity intent.
    const mgbTrained = await _mgbTrainedSet(supabase, guildId);
    const rosterOut = [];
    for (const [k, rr] of rosterByName) {
      const live = liveByName.get(k);
      const inferred = inferredBuffsByName.get(k) || null;
      const buffs = buffsFor(live, inferred);
      const cls  = classFor(rr.name) || rr.class || null;
      const role = rb.classToRole(cls);
      const hpSlots = rb.analyzeHpSlots(buffs.map(b => b && b.name).filter(Boolean));
      const missingHp = rb.HP_SLOTS.filter(sl => !hpSlots[sl]).length;
      const noSignal = !live && !(inferred && inferred.length);
      let tier = 'unknown';
      if (!noSignal) {
        const totalBuffs = buffs.filter(b => b && b.name).length;
        if (totalBuffs === 0) tier = 'red';
        else if (missingHp > 0) tier = 'orange';
        else {
          const byCat2 = {};
          for (const b of buffs) if (b && b.name) {
            const c2 = rb.categorizeBuff(b.name);
            if (c2) (byCat2[c2] = byCat2[c2] || []).push(b.name);
          }
          const exp2 = rb.ROLE_TARGETS[role] || [];
          tier = exp2.some(c2 => !(byCat2[c2] || []).length) ? 'yellow' : 'green';
        }
      }
      // Trimmed buff list for the dashboard's click-to-expand raider detail.
      const buffsOut = buffs
        .filter(b => b && b.name)
        .slice(0, 30)
        .map(b => ({ n: String(b.name).slice(0, 60), t: (typeof b.ticks === 'number') ? b.ticks : null }));
      rosterOut.push({
        buffs:      buffsOut,
        detail:     noSignal ? null : _buffDetailFor(rb, buffs),
        hp_missing: missingHp,
        name:       rr.name,
        class:      cls,
        group:      rr.group_num != null ? rr.group_num : null,
        rank:       rr.rank || null,
        level:      rr.level != null ? rr.level : null,
        hp_pct:     rr.hp_pct != null ? rr.hp_pct : (live && live.self_hp_pct != null ? live.self_hp_pct : null),
        buff_count: buffs.filter(b => b && b.name).length,
        mimic:      !!live,
        inferred:   !live && !!(inferred && inferred.length),
        mgb:        mgbTrained.has(k) || undefined,
        zone:       live && live.zone_name ? String(live.zone_name) : null,
        tier,
      });
    }
    rosterOut.sort((a, b) => ((a.group != null ? a.group : 99) - (b.group != null ? b.group : 99)) || a.name.localeCompare(b.name));

    const out = {
      buff_queue:   buffQueue.slice(0, 40),
      debuff_queue: debuffQueue.slice(0, 40),
      roster:       rosterOut.slice(0, 80),
      // group_mode is true when no raid_roster is fresh — the overlay shows
      // a slightly different header ("group" instead of "raid") and the
      // empty-state hint mentions groups.
      group_mode:   groupMode,
    };
    if (burstSpec) { out[burstSpec.key] = burstQueue; out.burst_label = burstSpec.label; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(out));
  } catch (err) {
    console.warn('[raid-buff-queue] failed:', err && err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'internal error' }));
  }
}
// Casting status on a single target, for the queue rows (compact — first 2
// in-flight casts, sorted soonest-finishing). Returns [] when nobody's casting.
// Drops casts whose remaining time has hit 0 — the previous 3s grace window
// surfaced "Aegolism 0s · Call of Sky 0s" rows that read as broken (the cast
// was actually already done; the buff lands on the next live-state flush).
function _castingOnTarget(name) {
  const tk = String(name || '').trim().toLowerCase();
  if (!tk) return [];
  const mp = _castingByTarget.get(tk);
  if (!mp) return [];
  const now = Date.now();
  const out = [];
  for (const c of mp.values()) {
    // Override the agent-supplied cast_secs with the bot's catalog ONLY when
    // the agent shipped the 4s stub default (older catalog cache without
    // cast_ms). Trust any non-stub value — that includes focus-haste-
    // adjusted casts (e.g. Utoh with Enhancement Haste III casts Focus of
    // Spirit in 8.4s instead of 12s; the agent already knows that, and the
    // bot must not clobber it back to the raw catalog 12.
    const isStubDefault = Math.abs((Number(c.cast_secs) || 0) - 4) < 0.05;
    const catSecs = _catalogCastSecs(c.spell);
    const effSecs = (isStubDefault && catSecs > 0) ? catSecs : c.cast_secs;
    const endsAt = c.started_at_ms + effSecs * 1000;
    const rem = Math.round((endsAt - now) / 1000);
    if (rem <= 0) continue;
    out.push({ caster: c.caster, spell: c.spell, remaining_secs: rem, ends_at_ms: endsAt });
  }
  out.sort((a, b) => a.remaining_secs - b.remaining_secs);
  return out.slice(0, 2);
}

// Bot-side catalog cache for "real" cast time in seconds, keyed by lowercase
// spell name. Populated lazily on first lookup from eqemu_spells. Refreshed
// once an hour; weekly sync keeps the catalog stable.
let _catalogCastSecsByName = null;   // Map<nameLower, secs>
let _catalogCastSecsAt = 0;
const _CATALOG_CAST_TTL_MS = 60 * 60 * 1000;
function _catalogCastSecs(name) {
  if (!name) return 0;
  if (!_catalogCastSecsByName || (Date.now() - _catalogCastSecsAt) > _CATALOG_CAST_TTL_MS) {
    _refreshCatalogCastSecs();
    if (!_catalogCastSecsByName) return 0;
  }
  return _catalogCastSecsByName.get(String(name).toLowerCase()) || 0;
}
function _refreshCatalogCastSecs() {
  const supabase = require('./utils/supabase');
  // fire-and-forget refresh; subsequent callers use whatever's loaded
  supabase.select('eqemu_spells', 'select=name,cast_time&order=id.asc&limit=10000')
    .then(rows => {
      const m = new Map();
      for (const r of rows || []) {
        if (!r || !r.name) continue;
        const ms = Number(r.cast_time) || 0;
        if (ms > 0) m.set(String(r.name).toLowerCase(), Math.round(ms / 100) / 10);
      }
      _catalogCastSecsByName = m;
      _catalogCastSecsAt = Date.now();
    })
    .catch(e => console.warn('[catalog cast secs] refresh failed:', e && e.message));
  // Mark touched so we don't refire on a tight error loop.
  _catalogCastSecsAt = _catalogCastSecsAt || Date.now();
}

async function _handleAgentMobInfo(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  let name = '';
  try { name = new URL(req.url, 'http://x').searchParams.get('name') || ''; } catch { /* */ }
  const norm = _normMobName(name);
  if (!norm) { res.writeHead(400); return res.end(JSON.stringify({ error: 'name required' })); }

  const cached = _mobInfoCache.get(norm);
  if (cached && (Date.now() - cached.at) < _MOB_INFO_TTL_MS) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, mob: cached.row }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) { res.writeHead(200); return res.end(JSON.stringify({ ok: true, mob: null })); }
  let mob = null;
  try {
    // Case-insensitive exact match on the normalized (underscored) name.
    // Try both the plain and #-prefixed forms. Quarm tags instanced/flagged
    // raid NPCs with a leading "#" in eqemu_npc_types (e.g. "#Arbiter_Korazhk",
    // "#The_Final_Arbiter") — the agent + bot both strip the # during target-
    // name normalization, so a straight ilike on the no-# form would never
    // match those rows. PostgREST OR matches either case in a single round trip.
    const encPlain  = encodeURIComponent(norm);
    const encHashed = encodeURIComponent('#' + norm);
    const rows = await supabase.select('eqemu_npc_types',
      `or=(name.ilike.${encPlain},name.ilike.${encHashed})&select=id,name,class,level,maxlevel,hp,ac,mr,fr,cr,pr,dr,mindmg,maxdmg,npcspecialattks,special_abilities,raid_target,bodytype,npc_spells_id,see_invis,see_invis_undead,see_hide,see_improved_hide&limit=1`);
    const r = Array.isArray(rows) && rows[0];
    if (r) {
      // Drop table from eqemu_npc_drops view (per-item effective_chance — the
      // real published drop rate accounting for table_probability + lootdrop
      // chance + multiplier). De-duped by item_id; the highest effective_chance
      // wins when the same item is in multiple lootdrops on the same NPC. Lore
      // flag carried through so the overlay can label LORE items.
      let loot = [];
      try {
        const lrows = await supabase.select('eqemu_npc_drops',
          `npc_id=eq.${r.id}&select=item_id,item_name,effective_chance,drop_chance,lore_flag&order=effective_chance.desc.nullslast&limit=80`);
        if (Array.isArray(lrows) && lrows.length) {
          const byItem = new Map();
          for (const it of lrows) {
            if (!it || !it.item_id) continue;
            const prev = byItem.get(it.item_id);
            if (!prev || (it.effective_chance || 0) > (prev.effective_chance || 0)) byItem.set(it.item_id, it);
          }
          loot = [...byItem.values()].map(it => ({
            id:    it.item_id,
            name:  it.item_name,
            pct:   it.effective_chance != null ? Number(it.effective_chance) : null,
            raw_pct: it.drop_chance     != null ? Number(it.drop_chance)     : null,
            lore:  !!it.lore_flag,
            seen:  0,
          }));
          loot.sort((a, b) => (b.pct || 0) - (a.pct || 0));
          // Layer in Wolf Pack's TOTAL won-count per item from OpenDKP records.
          // Counts every loot_observations row across all opendkp* sources
          // (confident, ambiguous, unknown) by item_id — not by (npc,item) —
          // because most ambiguous/unknown rows don't carry a confident npc_id
          // anyway. Per-mob attribution is approximated through the published
          // drop table: if this item is on this mob's drop list, we surface
          // its total win-count alongside; how trustworthy that count is to
          // THIS specific mob is conveyed by the uniqueness indicator (single-
          // source vs many) so the user can tell "Crown of Rile 50× — and it
          // only drops from Lord Nagafen" from "Diamond 50× — but Diamond
          // drops from 1300 NPCs."
          try {
            const guildId  = process.env.SUPABASE_GUILD_ID || 'wolfpack';
            const itemIds  = loot.map(it => it.id);
            if (itemIds.length > 0) {
              // a) Total Wolf Pack win counts per item across all OpenDKP sources.
              const obs = await supabase.select('loot_observations',
                `guild_id=eq.${encodeURIComponent(guildId)}&source=in.(opendkp,opendkp_ambiguous,opendkp_unknown)&item_id=in.(${itemIds.join(',')})&select=item_id&limit=50000`);
              if (Array.isArray(obs)) {
                const cnt = new Map();
                for (const row of obs) cnt.set(row.item_id, (cnt.get(row.item_id) || 0) + 1);
                for (const it of loot) { const n = cnt.get(it.id); if (n) it.seen = n; }
              }
              // b) Per-item "how many NPCs drop this" → exposes uniqueness so
              //    the overlay can ⭐ items unique to THIS mob and dim items
              //    that drop from many places (gems, spells, cloth pieces).
              const cands = await supabase.select('eqemu_npc_drops',
                `item_id=in.(${itemIds.join(',')})&select=item_id,npc_id&limit=50000`);
              if (Array.isArray(cands)) {
                const distinct = new Map();
                for (const row of cands) {
                  if (!distinct.has(row.item_id)) distinct.set(row.item_id, new Set());
                  distinct.get(row.item_id).add(row.npc_id);
                }
                for (const it of loot) {
                  const n = distinct.get(it.id);
                  it.candidate_npcs = n ? n.size : 0;
                  it.unique_to_mob  = (n && n.size === 1);
                }
              }
            }
          } catch (err) { console.warn('[mob-info] observed-count fetch failed:', err?.message); }
        }
      } catch (err) { console.warn('[mob-info] loot fetch failed:', err?.message); }

      // Zone resolution chain (eqemu_npc_types.zone_short is NULL across the
      // catalog — the weekly sync doesn't pull spawn data):
      //   1. bosses_local — our curated raid-boss table, 109/112 covered.
      //      Authoritative for tracked bosses.
      //   2. encounters   — our own kill history, 88/90 distinct NPCs covered.
      //      Authoritative for "anything Wolf Pack has actually fought."
      // For mobs we haven't tracked OR killed (new scripted instances like
      // a fresh #Arbiter_Korazhk before its first kill), zone stays null —
      // which renders as no zone line at all on the overlay (more honest
      // than guessing).
      let zoneShort = null;
      try {
        const blRows = await supabase.select('bosses_local',
          `npc_id=eq.${r.id}&select=zone_short&limit=1`);
        const bl = Array.isArray(blRows) && blRows[0];
        if (bl?.zone_short) {
          zoneShort = bl.zone_short;
        } else {
          const encRows = await supabase.select('encounters',
            `npc_id=eq.${r.id}&zone_short=not.is.null&select=zone_short&order=ended_at.desc.nullslast&limit=1`);
          if (Array.isArray(encRows) && encRows[0]?.zone_short) zoneShort = encRows[0].zone_short;
        }
      } catch (err) { console.warn('[mob-info] zone fetch failed:', err?.message); }
      let zoneLong = null;
      if (zoneShort) {
        try {
          const zRows = await supabase.select('eqemu_zone',
            `short_name=eq.${encodeURIComponent(zoneShort)}&select=long_name&limit=1`);
          if (Array.isArray(zRows) && zRows[0]?.long_name) zoneLong = zRows[0].long_name;
        } catch (err) { console.warn('[mob-info] zone long_name resolve failed:', err?.message); }
      }

      // Spell list — EQEmu's npc_spells table supports INHERITANCE via the
      // `parent_list` column. The leaf list might be empty while its parent
      // (or grandparent) carries the actual spell entries. We walk up the
      // chain so a list like 1354 ("akheva Xi_Xaui") with parent_list=5
      // surfaces list 5's entries.
      //
      // Cap the walk at 4 hops (depth>4 across the prod catalog is unheard
      // of) so a malformed cycle can't pin a request. Resolve all candidate
      // list IDs first, then a single entries query that covers them all.
      // Once entries are in hand, join eqemu_spells (catalog) to add the
      // human-readable name + mana + cast time per spell.
      let spells = [];
      if (r.npc_spells_id && r.npc_spells_id > 0) {
        try {
          const listIds = [r.npc_spells_id];
          let cursor = r.npc_spells_id;
          for (let hop = 0; hop < 4 && cursor; hop++) {
            const parentRows = await supabase.select('eqemu_npc_spells',
              `id=eq.${cursor}&select=parent_list&limit=1`);
            const p = Array.isArray(parentRows) && parentRows[0] && parentRows[0].parent_list;
            if (!p || p === 0 || listIds.includes(p)) break;
            listIds.push(p);
            cursor = p;
          }
          const entries = await supabase.select('eqemu_npc_spells_entries',
            `npc_spells_id=in.(${listIds.join(',')})&select=spellid,manacost,recast_delay,priority,minlevel,maxlevel,type,min_hp,max_hp,npc_spells_id&order=priority.desc&limit=80`);
          if (Array.isArray(entries) && entries.length > 0) {
            // Dedup by spellid — a leaf list can override the same spell from
            // a parent. The leaf's row wins (we visited the leaf first, so
            // its entries come first in `entries`).
            const seen = new Set();
            const dedup = [];
            for (const e of entries) {
              if (seen.has(e.spellid)) continue;
              seen.add(e.spellid); dedup.push(e);
            }
            // Filter to spells the mob can ACTUALLY cast at its level — entries
          // with minlevel > mob.level (haven't grown into it) or maxlevel <
          // mob.level (outgrown it; 0 = no upper bound) are excluded so the
          // overlay matches PQDI's "Can cast these spells" list instead of the
          // entire class spellbook.
          const mobLvl = Number(r.level) || 0;
          const inWindow = dedup.filter(e => {
            const lo = Number(e.minlevel) || 0;
            const hi = Number(e.maxlevel) || 0;
            if (mobLvl <= 0) return true;
            if (lo > 0 && mobLvl < lo) return false;
            if (hi > 0 && mobLvl > hi) return false;
            return true;
          });
          const ids = inWindow.map(e => e.spellid).filter(Boolean);
            if (ids.length > 0) {
              const catRows = await supabase.select('eqemu_spells',
                `id=in.(${ids.join(',')})&select=id,name,mana,cast_time,resist_type,resist_diff,good_effect&limit=80`);
              const cat = new Map((Array.isArray(catRows) ? catRows : []).map(s => [s.id, s]));
              // npc_spells_entries.manacost = -1 means "use the spell's catalog
              // mana cost"; same convention for recast_delay (-1 = spell default).
              // Without this, the overlay rendered every spell at -1 because the
              // entry's manacost happens to be -1 in the EQEmu data.
              const _resolveNum = (entryVal, catVal) => {
                if (entryVal != null && Number(entryVal) >= 0) return entryVal;
                if (catVal   != null && Number(catVal)   >= 0) return catVal;
                return null;
              };
              spells = inWindow.slice(0, 40).map(e => {
                const c = cat.get(e.spellid) || {};
                return {
                  id:           e.spellid,
                  name:         c.name || ('Spell #' + e.spellid),
                  mana:         _resolveNum(e.manacost, c.mana),
                  cast_ms:      _resolveNum(c.cast_time, null),
                  recast_ms:    _resolveNum(e.recast_delay, null),
                  // Resist family — 0/null = unresistable; resist_diff < 0 means
                  // "lure" (harder to resist by that amount). Negative values
                  // are rendered as "-200 lure"; positive as a plain modifier.
                  resist_type:  c.resist_type ?? null,
                  resist_diff:  c.resist_diff ?? null,
                  // 1 = beneficial (buff) / 0 = detrimental (offensive).
                  // Drives the offensive vs buff split in the Mob Info Spells
                  // tab — buffs render without the (always 'Unresist.') resist
                  // column. Null when the catalog isn't enriched yet.
                  good:         (c.good_effect == null ? null : (Number(c.good_effect) ? 1 : 0)),
                  priority:     e.priority ?? null,
                  type:         e.type ?? null,
                  minlevel:     e.minlevel ?? null,
                  maxlevel:     e.maxlevel ?? null,
                  hp_window: (e.min_hp != null || e.max_hp != null)
                    ? { min: e.min_hp ?? null, max: e.max_hp ?? null }
                    : null,
                };
              });
            }
          }
        } catch (err) { console.warn('[mob-info] spells fetch failed:', err?.message); }
      }

      mob = {
        name:    String(r.name || name).replace(/_/g, ' '),
        class:   _MOB_CLASS_NAMES[r.class] || null,
        level:    r.level ?? null,
        maxlevel: (r.maxlevel != null && r.maxlevel !== r.level) ? r.maxlevel : null,
        hp:      r.hp ?? null,
        ac:      r.ac ?? null,
        zone:    zoneLong,
        zone_short: zoneShort,
        resists: { mr: r.mr ?? null, fr: r.fr ?? null, cr: r.cr ?? null, pr: r.pr ?? null, dr: r.dr ?? null },
        mindmg:  r.mindmg ?? null,
        maxdmg:  r.maxdmg ?? null,
        raid_target: !!r.raid_target,
        // Sight flags — drive Mob Info chips so the player can tell whether
        // a regular invis OR invis vs undead will hide them from this NPC.
        // see_hide / see_improved_hide piped through for rogues too. EQEmu
        // stores these as 0/1 ints; cast to boolean for a clean JSON payload.
        see_invis:           !!r.see_invis,
        see_invis_undead:    !!r.see_invis_undead,
        see_hide:            !!r.see_hide,
        see_improved_hide:   !!r.see_improved_hide,
        specials: _decodeMobSpecials(r.special_abilities, r.npcspecialattks),
        spells,
        loot,
      };
    }
  } catch (err) {
    console.warn('[mob-info] lookup failed:', err?.message);
  }
  _mobInfoCache.set(norm, { at: Date.now(), row: mob });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, mob }));
}

// GET /api/agent/who-lookup?names=a,b,c
//
// De-anonymizes /who rows for Mimic's /who overlay. The overlay only asks for
// names that showed up ANONYMOUS in the live /who; we answer from THREE sources,
// in priority order:
//   1. state.whoData      — the merged who history (last non-anon class/level/
//                           guild we ever saw + the sticky Zek flag)
//   2. OpenDKP roster     — for guild members whose only /who rows are anon
//                           (Quarm's anon-by-default raiders); class lives here
//   3. supabase characters — secondary backstop / pulled if roster misses
// All in-memory after the first lookup, so it's cheap to call per /who.
async function _handleAgentWhoLookup(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  const { getWhoEntry } = require('./utils/state');
  let getRosterChar = null;
  try { getRosterChar = require('./utils/roster').getCharacter; } catch { /* roster optional */ }

  let namesParam = '';
  try { namesParam = new URL(req.url, 'http://x').searchParams.get('names') || ''; } catch { /* */ }
  const names = namesParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 80);

  // Pass 1: state.whoData + roster (both in-memory). Note any name still missing
  // a class so pass 2 can backfill from supabase characters.
  const results = {};
  const needSupabase = [];
  for (const nm of names) {
    const key = nm.toLowerCase();
    const w = (() => { try { return getWhoEntry(nm); } catch { return null; } })();
    const r = getRosterChar ? getRosterChar(nm) : null;
    // Skip names we have NOTHING on — overlay treats absent as "no history."
    if (!w && !r) continue;
    results[key] = {
      class:      (w && w.class)   || (r && r.class)   || null,
      level:      (w && w.level)   || null,                            // roster has no level
      guild:      (w && w.guild)   || null,
      guild_rank: (w && w.guildRank) || null,
      is_zek:     !!(w && w.is_zek),
      last_seen:  (w && w.lastSeen) || null,
      source:     (w && w.class) ? 'who' : (r && r.class) ? 'roster' : 'who',
    };
    if (!results[key].class) needSupabase.push(nm);
  }

  // Pass 2: backfill missing-class names from supabase characters (one batched
  // query, only when needed). Best-effort — if supabase is off or errors,
  // we just return what we have from passes 1.
  if (needSupabase.length) {
    try {
      const supabase = require('./utils/supabase');
      if (supabase.isEnabled()) {
        const inList = needSupabase.map(n => `"${n.replace(/"/g, '')}"`).join(',');
        const rows = await supabase.select('characters',
          `name=in.(${encodeURIComponent(inList)})&select=name,class&limit=80`);
        if (Array.isArray(rows)) {
          for (const row of rows) {
            const key = String(row.name || '').toLowerCase();
            if (results[key] && !results[key].class && row.class) {
              results[key].class  = row.class;
              results[key].source = 'characters';
            }
          }
        }
      }
    } catch (err) { console.warn('[who-lookup] characters backfill failed:', err?.message); }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, results }));
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
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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

// POST /api/agent/live-state
//
// Snapshot of what each watched character is currently carrying + where, from
// the Mimic/agent Zeal stream. Powers wolfpack.quest/me's "current buffs + last
// seen zone" view. The agent only sends on change (zone / buff-set / first
// sight), so this is low-traffic. Upsert by (guild_id, character) — latest
// wins. Body:
//   { agent_version, uploaded_by, states: [
//       { character, zone_id, zone_name, self_hp_pct, buffs:[{name,ticks}],
//         buff_count }, ... ] }
async function _handleAgentLiveState(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  let body = '';
  await new Promise((resolve) => {
    req.on('data', (chunk) => {
      body += chunk;
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

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: 0, note: 'supabase disabled' }));
  }

  const guildId    = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const uploadedBy  = payload?.uploaded_by ? String(payload.uploaded_by).slice(0, 64) : null;
  const states      = Array.isArray(payload?.states) ? payload.states : [];
  const nowIso      = new Date().toISOString();
  const rows = [];
  const swaps = [];   // {character, swapped_to} — targeted UPDATEs, not upserts
  for (const st of states) {
    const character = String(st?.character || '').trim();
    if (!character || character.length > 64) continue;
    // Character-swap record (agent v3.1.13+): the same EQ client logged a
    // different character in, so this one is gone. Stamp swapped_to WITHOUT
    // touching the rest of the row (buffs etc. stay as the last-known
    // snapshot) — /raid moves them to "Not in raid (swapped to X)".
    if (st?.swapped_to && typeof st.swapped_to === 'string') {
      swaps.push({ character, swapped_to: st.swapped_to.trim().slice(0, 64) });
      continue;
    }
    // Sanitize buffs → compact [{name, ticks, song}] and cap so a misbehaving
    // agent can't store a huge blob. EQ tops out ~30 buff/song slots. `song`
    // (agent v3.1.12+) = the short-duration song window (Zeal ids 135-140, 6
    // slots) vs the 15-slot buff window — /raid renders songs separately.
    let buffs = Array.isArray(st?.buffs) ? st.buffs : [];
    buffs = buffs.slice(0, 60).map(b => ({
      name:  String(b?.name || '').slice(0, 80),
      ticks: (b && typeof b.ticks === 'number') ? b.ticks : null,
      // Only persist the flag when the agent SENT one — pre-3.1.12 agents
      // don't tag songs, and coercing their absence to false would read as
      // an authoritative "not a song" downstream (web falls back to a name
      // heuristic when the flag is missing).
      ...(b && typeof b.song === 'boolean' ? { song: b.song } : {}),
    })).filter(b => b.name);
    const zoneId    = Number.isFinite(Number(st?.zone_id)) ? Math.trunc(Number(st.zone_id)) : null;
    const selfHp    = (st?.self_hp_pct != null && Number.isFinite(Number(st.self_hp_pct))) ? Number(st.self_hp_pct) : null;
    // Pet snapshot (charm or summoned) — name + HP% + the buffs we've timed on
    // it. Same sanitize/caps as the owner's buffs.
    const petName   = st?.pet_name ? String(st.pet_name).slice(0, 80) : null;
    const petHp     = (st?.pet_hp_pct != null && Number.isFinite(Number(st.pet_hp_pct))) ? Number(st.pet_hp_pct) : null;
    let petBuffs    = Array.isArray(st?.pet_buffs) ? st.pet_buffs : null;
    if (petBuffs) {
      petBuffs = petBuffs.slice(0, 40).map(b => ({
        name:           String(b?.name || '').slice(0, 80),
        remaining_secs: (b && typeof b.remaining_secs === 'number') ? b.remaining_secs : null,
        total_secs:     (b && typeof b.total_secs === 'number') ? b.total_secs : null,
        good:           (b && (b.good === 0 || b.good === 1)) ? b.good : null,
      })).filter(b => b.name);
      if (petBuffs.length === 0) petBuffs = null;
    }
    rows.push({
      guild_id:    guildId,
      character,
      zone_id:     zoneId,
      zone_name:   st?.zone_name ? String(st.zone_name).slice(0, 80) : null,
      self_hp_pct: selfHp,
      buffs,
      buff_count:  Number.isFinite(Number(st?.buff_count)) ? Math.trunc(Number(st.buff_count)) : buffs.length,
      pet_name:    petName,
      pet_hp_pct:  petHp,
      pet_buffs:   petBuffs,
      uploaded_by: uploadedBy,
      // A fresh snapshot supersedes any earlier swap stamp — they're back.
      swapped_to:  null,
      swapped_at:  null,
      updated_at:  nowIso,
    });
  }
  if (rows.length === 0 && swaps.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: 0 }));
  }
  try {
    if (rows.length) await supabase.upsert('character_live_state', rows, 'guild_id,character');
    for (const s of swaps) {
      await supabase.update('character_live_state',
        `guild_id=eq.${encodeURIComponent(guildId)}&character=eq.${encodeURIComponent(s.character)}`,
        { swapped_to: s.swapped_to, swapped_at: nowIso, updated_at: nowIso })
        .catch(() => {});
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: rows.length + swaps.length }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'upsert failed', detail: err && err.message ? err.message : String(err) }));
  }
}

// POST /api/agent/quake — the agent parsed the in-game "The next earthquake will
// begin in…" line and computed the absolute next-quake time. We dedup across
// agents, mirror to Supabase (pvp_quake) for the web banner, and post/edit a
// single countdown message in the PvP channel. Payload:
//   { quake: { next_quake_at: ISO, detected_at: ISO, source_text } }
let _lastServerQuakeAt = null;
async function _handleAgentQuake(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  const chunks = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > 16 * 1024) { res.writeHead(413); return res.end(); } chunks.push(chunk); }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const q = payload && payload.quake;
  const nextAtMs = q && q.next_quake_at ? Date.parse(q.next_quake_at) : NaN;
  if (!Number.isFinite(nextAtMs)) { res.writeHead(400); return res.end(JSON.stringify({ error: 'bad next_quake_at' })); }
  // Ignore stale reports (a backfill/old log replaying a past earthquake).
  if (nextAtMs < Date.now() - 60 * 1000) { res.writeHead(200); return res.end(JSON.stringify({ ok: true, stale: true })); }

  const state = require('./utils/state');
  const prev  = state.getServerQuake();
  const nextAtIso = new Date(nextAtMs).toISOString();
  // Dedup across agents/lines: same next-quake within 2 min (clock skew) → no-op.
  const near = (a, b) => a && b && Math.abs(a - b) < 2 * 60 * 1000;
  if (near(_lastServerQuakeAt, nextAtMs) || (prev && prev.next_quake_at && near(Date.parse(prev.next_quake_at), nextAtMs))) {
    _lastServerQuakeAt = nextAtMs;
    res.writeHead(200); return res.end(JSON.stringify({ ok: true, deduped: true }));
  }
  _lastServerQuakeAt = nextAtMs;

  // Mirror to Supabase for the web /pvp banner.
  try {
    const supabase = require('./utils/supabase');
    if (supabase.isEnabled()) {
      await supabase.upsert('pvp_quake', [{
        guild_id:      process.env.SUPABASE_GUILD_ID || 'wolfpack',
        next_quake_at: nextAtIso,
        detected_at:   q.detected_at || new Date().toISOString(),
        source_text:   q.source_text ? String(q.source_text).slice(0, 200) : null,
        updated_at:    new Date().toISOString(),
      }], 'guild_id').catch(e => console.warn('[quake] supabase upsert:', e?.message));
    }
  } catch (e) { console.warn('[quake] supabase mirror failed:', e?.message); }

  // Post/edit the single "next earthquake" countdown message in the PvP channel.
  let messageId = (prev && prev.messageId) || null;
  try {
    const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
    if (pvpTargetId) {
      const ch = await client.channels.fetch(pvpTargetId).catch(() => null);
      if (ch) {
        const epoch = Math.floor(nextAtMs / 1000);
        const content = `🌋 **Next earthquake (PvP repop):** <t:${epoch}:R> · <t:${epoch}:F>`;
        let edited = false;
        if (messageId) {
          const msg = await ch.messages.fetch(messageId).catch(() => null);
          if (msg) { await msg.edit({ content, allowedMentions: { parse: [] } }).catch(() => {}); edited = true; }
        }
        if (!edited) {
          const sent = await ch.send({ content, allowedMentions: { parse: [] } }).catch(() => null);
          if (sent) messageId = sent.id;
        }
      }
    }
  } catch (e) { console.warn('[quake] discord post failed:', e?.message); }

  state.saveServerQuake({ next_quake_at: nextAtIso, detected_at: q.detected_at || null, source_text: q.source_text || null, messageId });
  res.writeHead(200); return res.end(JSON.stringify({ ok: true, next_quake_at: nextAtIso }));
}

// Cross-client casting relay. Each Mimic raider's agent reports its OWN
// in-progress casts (spell + current target + cast time); we keep a short-lived
// per-target index so anyone targeting that mob can see "who is casting what on
// it" via GET /api/agent/target-casts. Bystanders can't be named (EQ logs only
// "Soandso begins to cast a spell" with no spell/target), so coverage scales
// with how many raiders run Mimic. Payload:
//   { casts: [{ caster, spell, target, started_at: ISO, cast_secs }] }
const _castingByTarget = new Map();   // targetLower → Map<casterLower, {caster,spell,target,started_at_ms,cast_secs,received_at}>

// Per-raider death timeline — used by the buff-queue inference to discard
// observed buff_casts that landed BEFORE the raider's most recent death (which
// would have stripped the buff). Updated from every encounter upload's
// deaths[] array. In-memory only; restart-fresh is acceptable because
// buff_casts themselves expire on their catalog duration.
const _lastRaiderDeath = new Map();   // nameLower → epoch ms of last death
function _noteRaiderDeaths(deaths) {
  if (!Array.isArray(deaths)) return;
  for (const d of deaths) {
    if (!d || !d.name) continue;
    const ts = Date.parse(d.ts) || Date.now();
    const k = String(d.name).toLowerCase();
    if (ts > (_lastRaiderDeath.get(k) || 0)) _lastRaiderDeath.set(k, ts);
  }
  // Bound memory: cap at 500 most-recently-touched names.
  if (_lastRaiderDeath.size > 500) {
    const oldest = _lastRaiderDeath.keys().next().value;
    if (oldest) _lastRaiderDeath.delete(oldest);
  }
}
function _pruneCasts(now) {
  for (const [tk, mp] of _castingByTarget) {
    for (const [ck, c] of mp) {
      // Keep until the cast should have finished + a 3s grace; hard cap 30s.
      const done = c.started_at_ms + (c.cast_secs || 6) * 1000 + 3000;
      if (now > done || (now - c.received_at) > 30000) mp.delete(ck);
    }
    if (mp.size === 0) _castingByTarget.delete(tk);
  }
}
async function _handleAgentCasting(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  const chunks = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > 32 * 1024) { res.writeHead(413); return res.end(); } chunks.push(chunk); }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const casts = Array.isArray(payload?.casts) ? payload.casts : [];
  const now = Date.now();
  let stored = 0;
  for (const c of casts) {
    const caster = String(c?.caster || '').trim();
    const spell  = String(c?.spell  || '').trim();
    const target = String(c?.target || '').trim();
    if (!caster || !spell || !target) continue;
    const startedMs = c.started_at ? Date.parse(c.started_at) : now;
    const castSecs  = Number.isFinite(Number(c.cast_secs)) ? Math.max(0, Math.min(60, Number(c.cast_secs))) : 6;
    const tk = target.toLowerCase();
    let mp = _castingByTarget.get(tk);
    if (!mp) { mp = new Map(); _castingByTarget.set(tk, mp); }
    mp.set(caster.toLowerCase(), {
      caster, spell, target,
      started_at_ms: Number.isFinite(startedMs) ? startedMs : now,
      cast_secs: castSecs, received_at: now,
    });
    stored++;
  }
  // Bound memory: cap the number of tracked targets.
  if (_castingByTarget.size > 300) {
    const oldest = _castingByTarget.keys().next().value;
    if (oldest) _castingByTarget.delete(oldest);
  }
  _pruneCasts(now);
  res.writeHead(200); return res.end(JSON.stringify({ ok: true, stored }));
}

// Ingest the live raid roster from Zeal's type-5 event (decoded agent-side).
// Payload: { uploaded_by, members: [{ name, class, group, level, rank }] }.
// Upsert per (guild, name) with a fresh captured_at — any agent in the raid
// can post (the roster is identical from every member's view), latest wins,
// and members who leave simply stop being refreshed and age out of the read
// window on /buffs. Powers the group-based buff grid.
async function _handleAgentRaidRoster(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  let body = '';
  await new Promise((resolve) => {
    req.on('data', (chunk) => { body += chunk; if (body.length > 256 * 1024) { req.destroy(); resolve(); } });
    req.on('end', resolve); req.on('error', resolve);
  });
  let payload;
  try { payload = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid json' }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: 0, note: 'supabase disabled' }));
  }

  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const nowIso  = new Date().toISOString();
  const members = Array.isArray(payload?.members) ? payload.members : [];
  const rows = [];
  const seen = new Set();
  for (const m of members) {
    const name = String(m?.name || '').trim();
    // Real EQ names are letters only; skip blanks / dupes / junk.
    if (!/^[A-Za-z]{2,30}$/.test(name) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const grp = Number.parseInt(m?.group, 10);
    const lvl = Number.parseInt(m?.level, 10);
    // hp_pct comes from the uploader's Zeal gauges for their own group
    // members. Last-write-wins via the upsert merges contributions from every
    // Mimic raider into a guild-wide HP view (each group's HP comes from the
    // Mimic-running raider in THAT group).
    const hp  = Number.parseFloat(m?.hp_pct);
    rows.push({
      guild_id:               guildId,
      name,
      class:                  m?.class ? String(m.class).slice(0, 20) : null,
      group_num:              Number.isFinite(grp) ? grp : null,
      level:                  Number.isFinite(lvl) ? lvl : null,
      rank:                   m?.rank ? String(m.rank).slice(0, 20) : null,
      hp_pct:                 Number.isFinite(hp) ? Math.max(0, Math.min(100, hp)) : null,
      captured_at:            nowIso,
      uploaded_by_discord_id: identity.discord_id,
    });
  }
  if (rows.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: 0 }));
  }
  try {
    // SNAPSHOT semantics per uploader (pk guild,uploader,name): replace this
    // uploader's whole view so members who left their raid don't linger as
    // phantom rows. Readers cluster overlapping snapshots into distinct
    // raids — two concurrent raids stay separate instead of merging.
    await supabase.del('raid_roster',
      `guild_id=eq.${encodeURIComponent(guildId)}&uploaded_by_discord_id=eq.${encodeURIComponent(identity.discord_id)}`);
    await supabase.upsert('raid_roster', rows, 'guild_id,uploaded_by_discord_id,name');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: rows.length }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'upsert failed', detail: err && err.message ? err.message : String(err) }));
  }
}

// POST /api/agent/trigger
//
// "Pipe my triggers into Discord." An agent posts one or more trigger fires:
//   { agent_version, character, triggers: [
//       { name, message, key, fired_at,
//         mode: 'post' | 'voice',   // default 'post'
//         voice_id: '...'           // optional ElevenLabs override
//       },
//   ] }
//
// Each entry routes by `mode`:
//   • 'post'  — channel.send to TRIGGER_BROADCAST_CHANNEL_ID.
//   • 'voice' — speak via TTS into RAID_VOICE_CHANNEL_ID (so countdowns reach
//               everyone in voice without spamming text). Voice playback is a
//               STUB in this commit: each fire logs "[trigger-voice]" with the
//               full text + uploader, so the chain is verifiable end-to-end
//               before the @discordjs/voice + TTS dependencies ship. The bot
//               STILL applies dedup + rate caps; voice playback wiring slots
//               into _playVoiceTrigger() with no schema changes.
//
// Safety: per-user token (requireAgentAuth) attributes every post; mass-mention
// parsing is disabled so a captured name can't @everyone; identical fires from
// many raiders collapse via the per-key dedup; a per-uploader rate cap stops a
// runaway agent.
const VOICE_DEDUP_WINDOW_MS = 5_000; // tighter than post — countdown ticks
                                      // (30→10→5→0) are seconds apart and
                                      // unique per offset, so 5s lets every
                                      // tick through while still collapsing
                                      // multi-agent duplicates of the SAME tick.
async function _handleAgentTrigger(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  _trackUpload({ endpoint: 'trigger', character: payload?.character, agentVersion: payload?.agent_version, payloadBytes: total, uploadedBy: identity.discord_id });

  const postCh  = process.env.TRIGGER_BROADCAST_CHANNEL_ID;
  const voiceCh = process.env.RAID_VOICE_CHANNEL_ID;
  const triggers  = Array.isArray(payload?.triggers) ? payload.triggers : [];
  if (triggers.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, posted: 0, spoken: 0, note: 'no triggers' }));
  }

  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const now = Date.now();
  let posted = 0, spoken = 0;
  let ch = null;
  for (const ev of triggers) {
    const message = String(ev?.message || '').trim().slice(0, 300);
    if (!message) continue;
    const mode = ev?.mode === 'voice' ? 'voice' : 'post';
    // Per-uploader rate cap (across all keys + modes).
    const rate = _triggerRate.get(identity.discord_id) || [];
    if (rate.filter(t => now - t < TRIGGER_RATE_WINDOW_MS).length >= TRIGGER_RATE_MAX) break;
    // Cross-agent dedup — narrower window for voice so countdown ticks land.
    const dedupKey = guildId + '|' + mode + '|' + String(ev?.key || message).toLowerCase();
    const window   = mode === 'voice' ? VOICE_DEDUP_WINDOW_MS : TRIGGER_DEDUP_WINDOW_MS;
    if (_triggerDedup.has(dedupKey) && now - _triggerDedup.get(dedupKey) < window) continue;
    _triggerDedup.set(dedupKey, now);

    if (mode === 'voice') {
      // Voice playback STUB. Real impl in commit B (adds @discordjs/voice +
      // ffmpeg + TTS engines). Logging the fire here makes the chain
      // verifiable now — set RAID_VOICE_CHANNEL_ID and the bot log shows
      // exactly what would speak, when, from whom.
      if (!voiceCh) {
        // No channel configured — drop silently. Caller still gets an OK.
      } else {
        await _playVoiceTrigger({
          message,
          voiceId:     ev?.voice_id || null,
          channelId:   voiceCh,
          uploadedBy:  identity.discord_id,
          triggerName: ev?.name || null,
        });
        spoken++;
        _triggerRate.set(identity.discord_id, [...rate, now]);
      }
      continue;
    }

    if (!postCh) continue; // post mode but no channel — drop
    try {
      if (!ch) ch = await client.channels.fetch(postCh).catch(() => null);
      if (!ch || typeof ch.send !== 'function') break;
      await ch.send({ content: message, allowedMentions: { parse: [] } });
      posted++;
      _triggerRate.set(identity.discord_id, [...rate, now]);
    } catch (err) {
      console.warn('[trigger] post failed:', err?.message);
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, posted, spoken }));
}

// ── Cross-Mimic trigger relay handlers ────────────────────────────────────
// Each fire is opaque to the bot — it's a {name, key, captures, actions,
// timer_duration_sec, fired_at_ms} bundle that a receiving Mimic runs
// through its own _fireTriggerActions as if locally detected. The bot's
// only jobs are dedup, capping the buffer, and serving polls. Payload
// validation is light because each field is also re-validated on the
// receiving Mimic before action execution.

async function _handleTriggerRelayPost(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 32 * 1024) { res.writeHead(413); return res.end(); }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid JSON' })); }

  const fires = Array.isArray(payload?.fires) ? payload.fires : [];
  if (fires.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, accepted: 0 }));
  }

  // Per-uploader rate cap — re-use the trigger rate limit so a wedged
  // pattern that fires 100/sec doesn't drown the relay buffer.
  const now = Date.now();
  const rate = _triggerRate.get(identity.discord_id) || [];
  if (rate.filter(t => now - t < TRIGGER_RATE_WINDOW_MS).length >= TRIGGER_RATE_MAX) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'rate limited' }));
  }

  let accepted = 0;
  for (const f of fires.slice(0, 10)) {
    const name = String(f?.name || '').slice(0, 120);
    const key  = String(f?.key  || name).slice(0, 200);
    if (!name) continue;
    const firedAt = Number(f?.fired_at_ms) || now;
    // Cross-agent dedup: same key fired within 8s = same logical event,
    // skip storing the duplicate so polling clients don't echo it.
    let duplicate = false;
    for (let i = _triggerRelay.entries.length - 1; i >= 0; i--) {
      const e = _triggerRelay.entries[i];
      if (now - e.posted_at_ms > TRIGGER_RELAY_DEDUP_WINDOW_MS) break;
      if (e.key === key && Math.abs(e.fired_at_ms - firedAt) <= TRIGGER_RELAY_DEDUP_WINDOW_MS) {
        duplicate = true; break;
      }
    }
    if (duplicate) continue;

    const entry = {
      id:                  _triggerRelay.nextId++,
      name,
      key,
      captures:            (f?.captures && typeof f.captures === 'object') ? f.captures : {},
      actions:             Array.isArray(f?.actions) ? f.actions.slice(0, 5) : [],
      timer_duration_sec:  Math.max(0, Math.min(3600, parseInt(f?.timer_duration_sec, 10) || 0)),
      fired_at_ms:         firedAt,
      posted_at_ms:        now,
      uploaded_by:         identity.discord_id,
    };
    _triggerRelay.entries.push(entry);
    accepted++;
  }
  if (_triggerRelay.entries.length > TRIGGER_RELAY_MAX_ENTRIES) {
    _triggerRelay.entries.splice(0, _triggerRelay.entries.length - TRIGGER_RELAY_MAX_ENTRIES);
  }
  if (accepted > 0) _triggerRate.set(identity.discord_id, [...rate, now]);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, accepted, next_id: _triggerRelay.nextId }));
}

async function _handleRecentFiresGet(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;
  const url = new URL(req.url, 'http://x');
  const sinceId = parseInt(url.searchParams.get('since_id') || '0', 10) || 0;

  // Suppress the caller's own fires — they already played locally and
  // would just dedup-loop. Other agents' fires (within the 60s TTL)
  // pass through.
  const fires = _triggerRelay.entries
    .filter(e => e.id > sinceId && e.uploaded_by !== identity.discord_id)
    .map(e => ({
      id:                  e.id,
      name:                e.name,
      key:                 e.key,
      captures:            e.captures,
      actions:             e.actions,
      timer_duration_sec:  e.timer_duration_sec,
      fired_at_ms:         e.fired_at_ms,
    }));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({
    next_id: _triggerRelay.nextId,
    fires,
  }));
}

// Voice playback path. Hands off to utils/voice.js, which queues + speaks
// via @discordjs/voice + Edge TTS. The voice module is fail-soft: missing
// deps / kick from the channel / TTS HTTP errors log once and drop the
// message rather than poisoning the trigger pipeline. The text-post path
// is independent so officers always have a backstop.
async function _playVoiceTrigger({ message, voiceId, channelId, uploadedBy, triggerName }) {
  try {
    const voice = require('./utils/voice');
    const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    if (!guild) {
      console.warn('[trigger-voice] DISCORD_GUILD_ID not in cache — dropping');
      return;
    }
    const ok = await voice.playInVoice({
      guildClient: guild,
      channelId,
      text:        message,
      voiceId,
      triggerName,    // surfaces to the /admin/voice "skip these trigger names" filter
    });
    if (!ok) console.log('[trigger-voice] play returned false for', channelId, '(may be ripcord or skip filter)');
  } catch (err) {
    console.warn('[trigger-voice] handler error:', err?.message);
  }
  void uploadedBy;   // logged upstream via _trackUpload; voice doesn't need it
}

// Relay web-submitted feedback (discord_msg_id IS NULL) into the #feedback
// thread, mirroring the /feedback command's embed + buttons, then stamp the
// row's discord_msg_id/link so it's posted exactly once. Called on an interval
// from ClientReady. Best-effort; transient failures retry next cycle.
async function relayWebFeedback(readyClient) {
  const threadId = process.env.FEEDBACK_THREAD_ID;
  if (!threadId) return;
  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) return;

  let rows;
  try {
    rows = await supabase.select(
      'feedback',
      'discord_msg_id=is.null&order=submitted_at.asc&limit=10&select=id,submitter_name,submitter_discord_id,category,message,submitted_at',
    );
  } catch { return; }
  if (!Array.isArray(rows) || rows.length === 0) return;

  let thread;
  try { thread = await readyClient.channels.fetch(threadId); } catch { return; }
  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

  for (const r of rows) {
    try {
      const cat = r.category || 'general';
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📬 Feedback — ${cat}`)
        .setDescription(String(r.message || '(no message)').slice(0, 4000))
        .addFields({ name: 'Submitted by', value: r.submitter_name || 'web (anonymous)', inline: true })
        .setFooter({ text: r.submitter_discord_id ? `uid:${r.submitter_discord_id} · via web` : 'via wolfpack.quest' })
        .setTimestamp(r.submitted_at ? new Date(r.submitted_at) : new Date());
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fb_recv').setLabel('📬 Acknowledge').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('fb_nope').setLabel('❌ Not Implementing').setStyle(ButtonStyle.Danger),
      );
      const sent    = await thread.send({ embeds: [embed], components: [row] });
      const guildId = sent?.guildId;
      const msgLink = guildId ? `https://discord.com/channels/${guildId}/${threadId}/${sent.id}` : null;
      // Stamp id/link so this row won't be picked up again. If this update
      // fails, the row re-posts next cycle (rare; acceptable for feedback).
      await supabase.update('feedback', `id=eq.${encodeURIComponent(r.id)}`, {
        discord_msg_id: sent.id, discord_msg_link: msgLink,
      });
    } catch (err) {
      console.warn('[feedback-relay] failed for', r.id, err?.message);
    }
  }
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
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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
  const tellsRaw  = Array.isArray(payload?.tells) ? payload.tells : [];
  // Defense-in-depth: drop NPC/system chatter that rides the tell channel — pet
  // command acks ("Attacking <mob> Master.") and Bazaar merchant quotes
  // ("That'll be N platinum for the X"). The current agent already filters these
  // at the source (parseTellLine), but older agents (and the retired beta line)
  // don't, so we re-filter here so no one gets DM-spammed regardless of version.
  const _isNpcTellText = (text) => {
    const t = String(text || '').trim();
    if (!t) return false;
    if (/\bMaster\b[.!,]?\s*$/i.test(t)) return true;
    if (/^attacking\b.+\bmaster\b/i.test(t)) return true;
    if (/^(that['’]?ll be|i['’]?ll give you)\b.*\b(platinum|gold|silver|copper)\b/i.test(t)) return true;
    return false;
  };
  const tells = tellsRaw.filter(t => !(t && t.direction === 'incoming' && _isNpcTellText(t.text)));
  // Per-machine DM pause set from the Mimic tray. When in the future, we still
  // STORE the tells (so /me/tells + the local card stay current) but skip the
  // Discord DM relay — same effect as the per-user snooze, but driven from the
  // desktop client and scoped to this agent process.
  const dmPauseUntil = Number(payload?.dm_pause_until) || 0;
  if (!character || tells.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: 0 }));
  }

  const supabase = require('./utils/supabase');
  if (!supabase.isEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, stored: 0, note: 'supabase disabled' }));
  }

  // Hard gate: character must be opted in. Also need a discord_id to attribute
  // ownership for /me/tells display + DM relay. Missing either → silently drop.
  //
  // Discord ID resolution: prefer the character's own discord_id, fall back to
  // the family root (main_name) when the char row has none. Roster imports
  // routinely leave alts with NULL discord_id even though the main is linked —
  // without this fallback, tells from those alts succeed at upload but land
  // with owner_discord_id=NULL, so /me/tells filters them out and the DM relay
  // has no target. The web /me toggle has the symmetric family-root fallback.
  const charRows = await supabase.select(
    'characters',
    `name=ilike.${encodeURIComponent(character)}&select=name,discord_id,tell_relay,tell_dm,main_name&guild_id=eq.wolfpack&limit=1`,
  ).catch(() => []);
  const charRow = Array.isArray(charRows) ? charRows[0] : null;
  if (!charRow?.tell_relay) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'tell_relay not enabled for this character' }));
  }
  let ownerDiscordId = charRow.discord_id || null;
  if (!ownerDiscordId && charRow.main_name && charRow.main_name !== charRow.name) {
    const rootRows = await supabase.select(
      'characters',
      `name=ilike.${encodeURIComponent(charRow.main_name)}&select=discord_id&guild_id=eq.wolfpack&limit=1`,
    ).catch(() => []);
    const rootRow = Array.isArray(rootRows) ? rootRows[0] : null;
    if (rootRow?.discord_id) ownerDiscordId = rootRow.discord_id;
  }
  if (!ownerDiscordId) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'character has no linked discord_id (and no family root to fall back to)' }));
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
      owner_discord_id: ownerDiscordId,
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
  // DM the whole batch (incoming + outgoing) but ONLY when at least one
  // incoming arrived AND the user hasn't snoozed DM relay. Outgoing-only is
  // the user typing while afk — no DM is expected. Snooze (per-user, stored
  // on wolfpack_members.tells_dm_paused_until) suppresses the DM but the
  // tells still write to the table, so /me/tells stays the source of truth.
  const incomingCount = rows.reduce((n, r) => n + (r.direction === 'incoming' ? 1 : 0), 0);
  let snoozedUntil = null;
  if (incomingCount > 0 && charRow.tell_dm !== false) {
    // The per-machine tray pause is checked first — no DB round-trip, and it's
    // the user actively saying "not now" on the box they're playing on.
    if (dmPauseUntil > Date.now()) {
      snoozedUntil = new Date(dmPauseUntil);
    } else {
      try {
        const memberRows = await supabase.select(
          'wolfpack_members',
          `discord_id=eq.${encodeURIComponent(ownerDiscordId)}&select=tells_dm_paused_until&limit=1`,
        ).catch(() => []);
        const memberRow = Array.isArray(memberRows) ? memberRows[0] : null;
        if (memberRow?.tells_dm_paused_until) {
          const until = new Date(memberRow.tells_dm_paused_until);
          if (!isNaN(until.getTime()) && until.getTime() > Date.now()) snoozedUntil = until;
        }
      } catch { /* non-fatal — fall through to DM */ }
    }
    if (!snoozedUntil) {
      _relayTellsToDM(ownerDiscordId, charRow.name, rows).catch(err =>
        console.warn('[tells] DM relay failed:', err?.message));
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ ok: true, stored, dm_snoozed_until: snoozedUntil ? snoozedUntil.toISOString() : null }));
}

// DM the owner with the freshly-relayed tells. Batched into one message so a
// rapid volley of tells doesn't fan out as a wall of pings. Format matches
// the Mimic dashboard's "Recent Tells" panel — one chronological line per
// tell, "**Other** ← You" for incoming, "You → **Other**" for outgoing.
// No header preamble and no per-message mute footer; the bot's name + 📬
// glyph are the only chrome, and snooze controls live on /me/tells.
async function _relayTellsToDM(discordUserId, ownerCharacter, tellRows) {
  try {
    const user = await client.users.fetch(discordUserId).catch(() => null);
    if (!user) return;

    // Chronological flat list across all conversations — same as the dashboard.
    // Sort up-front so a multi-counterparty batch reads in the order events
    // actually happened.
    const sorted = [...tellRows].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );

    // Cap at 12 lines to keep the DM under Discord's 2000-char limit by a
    // comfortable margin. Overflow tail points to /me/tells.
    const MAX_LINES = 12;
    const lines = [];
    let omitted = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (lines.length >= MAX_LINES) { omitted = sorted.length - i; break; }
      const r = sorted[i];
      const arrow = r.direction === 'outgoing' ? '→' : '←';
      const who   = r.direction === 'outgoing'
        ? `${ownerCharacter} ${arrow} **${r.other_name}**`
        : `**${r.other_name}** ${arrow} ${ownerCharacter}`;
      lines.push(`${who}: ${r.text}`);
    }
    if (omitted > 0) lines.push(`_…and ${omitted} more — wolfpack.quest/me/tells_`);
    if (lines.length === 0) return;
    // Prefix the first line with 📬 — single glyph, no preamble.
    lines[0] = `📬 ${lines[0]}`;

    await user.send({
      content: lines.join('\n'),
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
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return;

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
            guild_rank:  w.guildRank || null,   // from /guildstatus — survives /anon
            anonymous:   !!w.anonymous,
            gm:          !!w.gm,
            zone:        w.zone || null,         // from /who all — short zone name
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
  // Scope the encounter to the fight the UPLOADER was actually in. An agent's
  // log shows every combat line in the uploader's vicinity — including other
  // raiders meleeing DIFFERENT mobs nearby. Without scoping, those bleed into
  // this encounter as phantom contributors (e.g. a solo Royal Scribe Kaavin
  // kill showing 4 extra characters who were each fighting their own mob).
  // validTargets = every NPC the uploader personally damaged, plus the boss.
  // We then only count damage dealt to one of those targets.
  const _bossLower = encounter.boss_name ? String(encounter.boss_name).toLowerCase() : null;
  const validTargets = new Set();
  if (_bossLower) validTargets.add(_bossLower);
  for (const ev of encounter.events) {
    if (ev.type !== 'damage' || !ev.defender) continue;
    // The uploader's own outgoing damage is first-person (attacker === null).
    // Its defender is the mob they're engaging — that's a target of this fight.
    if (ev.attacker === null && !/^you$/i.test(ev.defender)) {
      validTargets.add(String(ev.defender).toLowerCase());
    }
  }

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
    // Fight-scope filter: only count damage dealt to a target the uploader
    // engaged (computed above). Events with a defender outside the set are
    // someone else's separate fight that merely showed up in this log.
    if (ev.defender && validTargets.size > 0 && !validTargets.has(String(ev.defender).toLowerCase())) continue;
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
  // Index per-raider deaths for the buff-queue inference path — when we infer
  // a non-Mimic raider's current buffs from buff_casts, we must discard any
  // cast that happened before their most recent death (dying clears buffs).
  // In-memory only; resets on bot restart, which is fine because buff_casts
  // themselves expire on their catalog duration anyway.
  _noteRaiderDeaths(uploadedDeaths);
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

        // Auto-record kill if (1) the agent confirmed the boss's death line
        // was observed AND (2) the boss isn't already on cooldown.
        // confirmed_kill=false uploads (idle-timeout flushes — pulls and
        // wipes where the boss survived) only record the parse; they must
        // not move timers. Old agents (no flag) treated as unconfirmed:
        // safer to require an explicit /kill than fire a wrong timer.
        const { getBossState, recordKill } = require('./utils/state');
        const { postKillUpdate } = require('./utils/killops');
        const bossState = getBossState(matchedBoss.id);
        const now = Date.now();
        if (encounter.confirmed_kill !== true) {
          console.log(`[agent] ${matchedBoss.name} parse recorded but kill NOT confirmed (no death line observed) — timer unchanged`);
        } else if (!bossState || !bossState.killedAt || bossState.nextSpawn <= now) {
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
          uploadedByDiscordId: identity.discord_id,
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
    uploadedBy:    identity.discord_id,
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
    //
    // ADDITIVELY surface signed-in Mimic identity when the agent forwards the
    // X-Wolfpack-Mimic-Session header. That lets the dashboard show "Signed in
    // as <name>" + officer affordances without a separate round-trip. When the
    // header is absent or unknown, the response is unchanged.
    const manifest = _agentManifest();
    let session = null;
    try { session = await mimicLink.resolveMimicSession(req); } catch (e) { void e; }
    if (session) manifest.mimic_session = session;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(manifest));
  }

  // Mimic Discord device-code login (v1: optional, no writes gated on it yet).
  // Three public endpoints — no agent-token gate, the device_code IS the
  // secret. See utils/mimicLink.js for the flow.
  if (req.method === 'POST' && req.url === '/api/mimic-link/start') {
    try { return await mimicLink.handleStart(req, res); }
    catch (err) { console.error('[mimic-link/start]', err); res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'internal error' })); }
  }
  if (req.method === 'POST' && req.url === '/api/mimic-link/poll') {
    try { return await mimicLink.handlePoll(req, res); }
    catch (err) { console.error('[mimic-link/poll]', err); res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'internal error' })); }
  }
  if (req.method === 'POST' && req.url === '/api/mimic-link/revoke') {
    try { return await mimicLink.handleRevoke(req, res); }
    catch (err) { console.error('[mimic-link/revoke]', err); res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'internal error' })); }
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

  // Cache bust for voice_settings. The /admin/voice page calls this after
  // saving so the ripcord takes effect without waiting out the 30s TTL.
  // Bearer-auth gated (same token as the agent endpoints) — anyone with
  // the token already has full data-plane access, so this is no broader.
  if (req.method === 'POST' && req.url === '/api/admin/voice-settings/refresh') {
    const identity = await mimicLink.requireAgentAuth(req, res);
    if (!identity) return;
    try {
      const vs = require('./utils/voiceSettings');
      vs.invalidate();
      // If the admin just flipped the ripcord (enabled=false), boot the bot
      // out of voice NOW instead of finishing the in-flight queue. Cheap —
      // the next allowed fire reconnects. Re-fetch first so we read what was
      // just saved, not the stale cached value.
      const guildId = process.env.DISCORD_GUILD_ID;
      if (guildId) {
        const fresh = await vs.get(guildId);
        if (!fresh.enabled) {
          try { require('./utils/voice').leaveVoice(guildId, 'admin ripcord'); }
          catch (err) { void err; }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.warn('[voice-settings refresh] error:', err?.message);
      res.writeHead(500);
      return res.end();
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

  if (req.method === 'GET' && req.url.startsWith('/api/agent/mob-info')) {
    try { return await _handleAgentMobInfo(req, res); }
    catch (err) {
      console.error('[mob-info] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // Active casts on a target — the cross-client Casting section for Mob Info.
  if (req.method === 'GET' && req.url.startsWith('/api/agent/target-casts')) {
    try { return await _handleAgentTargetCasts(req, res); }
    catch (err) {
      console.error('[target-casts] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/agent/target-buffs')) {
    try { return await _handleAgentTargetBuffs(req, res); }
    catch (err) {
      console.error('[target-buffs] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/agent/raid-buff-queue')) {
    try { return await _handleAgentRaidBuffQueue(req, res); }
    catch (err) {
      console.error('[raid-buff-queue] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/agent/who-lookup')) {
    try { return await _handleAgentWhoLookup(req, res); }
    catch (err) {
      console.error('[who-lookup] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/agent/spell-catalog')) {
    try { return await _handleAgentSpellCatalog(req, res); }
    catch (err) {
      console.error('[spell-catalog] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'GET' && req.url.startsWith('/api/agent/item-clickies')) {
    try { return await _handleAgentItemClickies(req, res); }
    catch (err) {
      console.error('[item-clickies] handler error:', err);
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

  // Local-dashboard "server view" panels — increment 2f of the customizable
  // dashboard. The agent fetches these and the dashboard renders the result
  // alongside / in place of its live local data so members can flip between
  // "what I'm seeing right now" and "what wolfpack.quest knows about me."
  if (req.method === 'GET' && req.url.startsWith('/api/agent/server-panel/')) {
    try { return await _handleAgentServerPanel(req, res); }
    catch (err) {
      console.error('[server-panel] handler error:', err);
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

  if (req.method === 'POST' && req.url === '/api/agent/live-state') {
    try { return await _handleAgentLiveState(req, res); }
    catch (err) {
      console.error('[live-state] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/raid-roster') {
    try { return await _handleAgentRaidRoster(req, res); }
    catch (err) {
      console.error('[raid-roster] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/trigger') {
    try { return await _handleAgentTrigger(req, res); }
    catch (err) {
      console.error('[trigger] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/quake') {
    try { return await _handleAgentQuake(req, res); }
    catch (err) {
      console.error('[quake] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/casting') {
    try { return await _handleAgentCasting(req, res); }
    catch (err) {
      console.error('[casting] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // Fan-out POST — agent reports a local fire so other Mimics that
  // missed the source line can replay it. Stored in _triggerRelay ring
  // buffer; receivers fetch via GET /api/agent/recent-fires below.
  if (req.method === 'POST' && req.url === '/api/agent/trigger-relay') {
    try { return await _handleTriggerRelayPost(req, res); }
    catch (err) {
      console.error('[trigger-relay] post error:', err);
      res.writeHead(500); return res.end();
    }
  }

  // Fan-out GET — agent polls every ~1.5s. Returns voice/timer fires
  // posted by OTHER agents since the caller's since_id, suppressing the
  // caller's own fires so a relay doesn't echo back to its origin.
  if (req.method === 'GET' && req.url.startsWith('/api/agent/recent-fires')) {
    try { return await _handleRecentFiresGet(req, res); }
    catch (err) {
      console.error('[trigger-relay] get error:', err);
      res.writeHead(500); return res.end();
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
  if (req.method === 'POST' && req.url === '/api/agent/pvp_assists') {
    try { return await _handleAgentPvpAssists(req, res); }
    catch (err) {
      console.error('[pvp-assists] handler error:', err);
      res.writeHead(500); return res.end();
    }
  }
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

  if (req.method === 'POST' && req.url === '/api/agent/buff_casts') {
    try { return await _handleAgentBuffCasts(req, res); }
    catch (err) {
      console.error('[buff-casts] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/faction') {
    try { return await _handleAgentFaction(req, res); }
    catch (err) {
      console.error('[faction] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/pop_flags') {
    try { return await _handleAgentPopFlags(req, res); }
    catch (err) {
      console.error('[pop-flags] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/quarmy') {
    try { return await _handleAgentQuarmy(req, res); }
    catch (err) {
      console.error('[quarmy] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/threat-snapshot') {
    try { return await _handleAgentThreatSnapshot(req, res); }
    catch (err) {
      console.error('[threat-snap] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  if (req.method === 'POST' && req.url === '/api/agent/place-bid') {
    try { return await _handleAgentPlaceBid(req, res); }
    catch (err) {
      console.error('[place-bid] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // UI Studio — encrypted EQ ini-file snapshots for new-machine restore.
  if (req.method === 'POST' && req.url === '/api/agent/ui_layout') {
    try { return await _handleAgentUiLayoutUpload(req, res); }
    catch (err) {
      console.error('[ui_layout upload] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }
  if (req.method === 'GET' && req.url.startsWith('/api/agent/ui_layout?')) {
    try { return await _handleAgentUiLayoutList(req, res); }
    catch (err) {
      console.error('[ui_layout list] handler error:', err);
      res.writeHead(500).end();
      return;
    }
  }
  if (req.method === 'GET' && req.url.startsWith('/api/agent/ui_layout/')) {
    // /api/agent/ui_layout/<uuid>?character=<name>
    const m = req.url.match(/^\/api\/agent\/ui_layout\/([0-9a-f-]{36})(\?|$)/i);
    if (m) {
      try { return await _handleAgentUiLayoutDownload(req, res, m[1]); }
      catch (err) {
        console.error('[ui_layout download] handler error:', err);
        res.writeHead(500).end();
        return;
      }
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
