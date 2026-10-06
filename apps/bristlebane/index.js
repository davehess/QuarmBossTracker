// apps/bristlebane/index.js — Bristlebane, Wolf Pack's raid-voice bot. Its own Discord application and
// its own container (Coolify on the home server); it is NOT part of the main bot and shares nothing with
// it but one HTTP call.
//
// It asks the main bot "is a raid live?" (GET /api/agent/raid-live), joins the raid voice channel while the
// answer is yes, announces itself, and records each member who has OPTED IN to their own file. Nobody else is
// recorded: members opt in, out, and delete their recordings with /bristlebane. The join/leave rule, consent
// store, file format, deletion and every text it posts live in lib.js (unit-tested); this file is the glue
// between them and the Discord gateway / voice connection, and is deliberately small.
//
// Phase 1: join, leave, announce, record the opted-in, consent commands. No speech yet.

'use strict';

const lib = require('./lib');

// What the slash command answers. Every reply is ephemeral (only the member who ran it sees it).
const REPLY = {
  optedIn: (recording) => '✅ You are opted in. Bristlebane records your voice in the raid channel while a raid is live and you are in it. '
    + 'Stop any time: `/bristlebane optout` (also deletes tonight\'s recording of you) or `/bristlebane forget` (deletes everything).'
    + (recording ? '' : ' Recording is switched off on this deployment right now, so nothing is being recorded yet.'),
  alreadyIn: 'You were already opted in. `/bristlebane status` shows where things stand.',
  optedOut: ({ files, knownNight, saved }) => '✅ You are opted out: Bristlebane has stopped recording you'
    + (knownNight ? ` and deleted ${files} file${files === 1 ? '' : 's'} of you from tonight.` : '. I could not tell which night is tonight, so only a session in progress was cleaned up — `/bristlebane forget` removes everything.')
    + (saved ? '' : '\n⚠ I could not save that to the consent list, so it may not survive a restart — tell an officer.'),
  forgetPrompt: () => 'This permanently deletes **every** recording of you, from every night, and opts you out. It cannot be undone.',
  forgotten: ({ files, sessions }, saved) => `🗑 Done. You are opted out, and ${files} recording file${files === 1 ? '' : 's'} of you were deleted from ${sessions} session record${sessions === 1 ? '' : 's'}.`
    + (saved ? '' : '\n⚠ I could not save the opt-out to the consent list, so it may not survive a restart — tell an officer.'),
  cancelled: 'Cancelled — nothing was deleted.',
  notYours: 'That button is not yours.',
  saveFailed: '⚠ I could not save that, so nothing changed. Try again in a moment, or tell an officer.',
  failed: '⚠ Something went wrong. Try again, or tell an officer.',
};

async function main() {
  let cfg;
  try { cfg = lib.loadConfig(process.env); }
  catch (err) { console.error('[boot]', err.message); process.exit(1); }

  // Required here, not at the top, so a missing install fails with a readable boot error.
  const {
    Client, Events, GatewayIntentBits, MessageFlags, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  } = require('discord.js');
  const voice = require('@discordjs/voice');
  const { joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType } = voice;
  console.log('[voice] dependency report:\n' + voice.generateDependencyReport());

  const store = new lib.ConsentStore(lib.consentPath(cfg.recordingsDir)).load();
  if (store.error) console.warn(`[consent] ${store.error} — recording nobody until it is fixed`);
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  client.on('error', (err) => console.error('[discord] client error:', err.message));
  process.on('unhandledRejection', (err) => console.error('[boot] unhandled rejection:', err));

  let state = lib.initialState();        // the join/leave rule's memory (lib.decide)
  let cur = null;                        // the stay in progress: { connection, channelId, rec, timers, minutes, nick }
  let ending = null;                     // the teardown in flight, if any; a tick waits for it
  let lastNightKey = null;               // the bot's night key from the latest answer: what "tonight" means
  let stopping = false;
  let timer = null;
  let apiWasOk = true;
  let lastReason = '';

  const guild = () => client.guilds.cache.get(cfg.guildId);
  const raidChannel = () => guild()?.channels.cache.get(cfg.raidVoiceChannelId);
  // The people in the raid channel, from the voice states rather than channel.members: that getter only lists
  // members the cache has a member object for, and without the members intent the ones already in the channel
  // when we booted may not have one. Someone we cannot identify counts as a person.
  const humanIds = () => {
    const states = guild()?.voiceStates.cache;
    if (!states) return [];
    return [...states.filter((v) => v.channelId === cfg.raidVoiceChannelId && v.id !== client.user.id
      && !(v.member?.user ?? client.users.cache.get(v.id))?.bot).keys()];
  };
  const optedInHere = () => humanIds().filter((id) => store.has(id)).length;
  // The night folders that are "tonight": the one a session is recording into and the one the bot last named.
  const tonightDirs = () => [...new Set([cur?.rec?.meta.nightKey, lastNightKey].filter(Boolean).map(lib.nightDirName))];

  async function pollApi() {
    try {
      const res = await fetch(`${cfg.apiUrl}/raid-live`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return lib.normalizePoll(await res.json());
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function setNick(nick) {
    try {
      const g = guild();
      const me = g?.members.me ?? await g?.members.fetchMe();
      await me?.setNickname(nick, 'Bristlebane recording notice');
    } catch (err) {
      console.warn(`[nick] could not set "${nick}":`, err.message);
    }
  }

  // "[REC] Bristlebane" only while at least one opted-in member is in the channel, plain "Bristlebane" otherwise.
  // Cheap to call: it sends nothing unless the wanted name changed.
  async function refreshNick() {
    const s = cur;
    if (!s || !s.rec) return;
    const want = lib.desiredNick(true, optedInHere());
    if (s.nick === want) return;
    s.nick = want;
    await setNick(want);
  }

  async function post(text) {
    if (!cfg.raidChatChannelId) return;
    try {
      const ch = await client.channels.fetch(cfg.raidChatChannelId);
      await ch.send({ content: text, allowedMentions: { parse: [] } });
    } catch (err) {
      console.warn('[notice] post failed:', err.message);
    }
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  // Runs inside the speaking event, and everything before subscribe() is synchronous on purpose: the receiver
  // emits 'start' from the packet that began the utterance and delivers that packet to the subscription
  // right after, so a subscription made a tick later misses the first word. It is also how a new opt-in takes
  // effect mid-session: the consent store is checked at every utterance.
  function onSpeakingStart(s, userId) {
    if (cur !== s || s.ending || !s.rec) return;
    const member = guild()?.members.cache.get(userId);
    const user = member?.user ?? client.users.cache.get(userId);
    if (user?.bot) return;                                              // a music bot is not a raider
    if (!lib.shouldRecord(cfg.recordMode, store, userId)) return;       // nothing at all is kept about anyone who has not opted in
    s.rec.event('speaking-start', { userId });
    const receiver = s.connection.receiver;
    if (receiver.subscriptions.has(userId)) return;                     // subscribe() would hand back the same stream: no second listener
    s.rec.addUser(userId, member?.displayName || user?.username || userId);
    if (!member) {   // not cached (no members intent): look the name up once, for session.json only
      guild()?.members.fetch(userId).then((m) => { if (!s.ending && store.has(userId)) s.rec.addUser(userId, m.displayName); }).catch(() => {});
    }
    // Manual end: one stream for the whole stay, so a pause is not a new file. A decrypt failure destroys the
    // stream (the voice library does that on any bad packet); the next utterance subscribes again.
    const stream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
    stream.on('data', (buf) => s.rec.packet(userId, buf));
    stream.on('error', (err) => { s.rec.noteError(userId); console.warn(`[rec] stream error for ${userId}:`, err.message); });
  }

  function startRecording(s) {
    s.connection.receiver.speaking.on('start', (userId) => {
      try { onSpeakingStart(s, userId); } catch (err) { console.warn('[rec] speaking handler failed:', err.message); }
    });
    // session.json each minute, so a crash loses at most a minute of events; the packets are streamed as they arrive.
    s.timers.push(setInterval(() => {
      try { s.rec.writeMeta(); } catch (err) { console.warn('[rec] session.json write failed:', err.message); }
      s.minutes.push(s.rec.rollMinute());
      if (s.minutes.length >= 5) { console.log(lib.formatRecSummary(s.minutes)); s.minutes = []; }
    }, 60_000));
  }

  // Stop one person's live stream and delete what this stay has of them. The stream goes first so nothing more
  // arrives while the file is being removed.
  async function stopAndDropActive(userId) {
    const s = cur;
    if (!s || !s.rec) return;
    s.connection.receiver.subscriptions.get(userId)?.destroy();
    await s.rec.dropUser(userId);
  }

  // ── The /bristlebane command ───────────────────────────────────────────────

  async function cmdOptIn(userId) {
    let changed;
    try { changed = store.optIn(userId); }
    catch (err) { console.warn('[consent] optin failed:', err.message); return REPLY.saveFailed; }
    console.log(`[consent] optin: ${userId}${changed ? '' : ' (already)'}`);
    refreshNick().catch(() => {});
    return changed ? REPLY.optedIn(cfg.recordMode !== 'off') : REPLY.alreadyIn;
  }

  async function cmdOptOut(userId) {
    let saved = true;
    // Out of the store FIRST: the very next utterance must not subscribe them again.
    try { store.optOut(userId); }
    catch (err) { saved = false; console.warn('[consent] optout not saved:', err.message); }
    await stopAndDropActive(userId);
    const nights = tonightDirs();
    const removed = nights.length ? lib.forgetUser(cfg.recordingsDir, userId, { nights }) : { files: 0, sessions: 0, errors: 0 };
    console.log(`[consent] optout: ${userId}, removed ${removed.files} file(s) from ${nights.length} night(s)${removed.errors ? `, ${removed.errors} error(s)` : ''}`);
    refreshNick().catch(() => {});
    return REPLY.optedOut({ files: removed.files, knownNight: nights.length > 0, saved });
  }

  function cmdForget(userId) {
    return {
      content: REPLY.forgetPrompt(),
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(lib.forgetButtonId('yes', userId)).setLabel('Delete everything').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(lib.forgetButtonId('no', userId)).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      )],
    };
  }

  function cmdStatus(userId) {
    const ids = humanIds();
    return lib.statusText({
      optedIn: store.has(userId), recordMode: cfg.recordMode, inChannel: !!(cur && cur.rec),
      channelId: cfg.raidVoiceChannelId, optedInHere: ids.filter((id) => store.has(id)).length, total: ids.length,
    });
  }

  async function onForgetButton(i, b) {
    if (i.user.id !== b.userId) return i.reply({ content: REPLY.notYours, flags: MessageFlags.Ephemeral });
    if (b.action === 'no') return i.update({ content: REPLY.cancelled, components: [] });
    await i.deferUpdate();
    // Forgetting is also opting out (the guild lead, 2026-10-05: no voice from anyone who has not consented):
    // out of the store first, so the next utterance cannot subscribe them again.
    let saved = true;
    try { store.optOut(b.userId); }
    catch (err) { saved = false; console.warn('[consent] forget: optout not saved:', err.message); }
    await stopAndDropActive(b.userId);
    const r = lib.forgetUser(cfg.recordingsDir, b.userId);
    console.log(`[consent] forget: ${b.userId}, removed ${r.files} file(s), ${r.sessions} session record(s)${r.errors ? `, ${r.errors} error(s)` : ''}`);
    refreshNick().catch(() => {});
    return i.editReply({ content: REPLY.forgotten(r, saved), components: [] });
  }

  async function onInteraction(i) {
    if (i.guildId !== cfg.guildId) return;
    if (i.isButton()) {
      const b = lib.parseForgetButton(i.customId);
      if (b) await onForgetButton(i, b);
      return;
    }
    if (!i.isChatInputCommand() || i.commandName !== 'bristlebane') return;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = i.options.getSubcommand();
    const out = sub === 'optin' ? await cmdOptIn(i.user.id)
      : sub === 'optout' ? await cmdOptOut(i.user.id)
      : sub === 'forget' ? cmdForget(i.user.id)
      : cmdStatus(i.user.id);
    await i.editReply(out);
  }

  client.on(Events.InteractionCreate, (i) => {
    onInteraction(i).catch(async (err) => {
      console.warn('[cmd] failed:', err.message);
      try {
        const msg = { content: REPLY.failed, components: [] };
        if (i.deferred || i.replied) await i.editReply(msg); else await i.reply({ ...msg, flags: MessageFlags.Ephemeral });
      } catch { /* the interaction has expired */ }
    });
  });
  // Someone joining or leaving the raid channel can change whether anyone opted in is there.
  client.on(Events.VoiceStateUpdate, (before, after) => {
    if (cur && (before.channelId === cfg.raidVoiceChannelId || after.channelId === cfg.raidVoiceChannelId)) refreshNick().catch(() => {});
  });

  // Guild-scoped, so it appears at once; a bulk overwrite, so running it every boot is idempotent.
  async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(cfg.token);
    await rest.put(Routes.applicationGuildCommands(cfg.appId || client.user.id, cfg.guildId), { body: lib.COMMANDS });
  }

  // ── Joining and leaving ────────────────────────────────────────────────────

  function wireConnection(s) {
    const c = s.connection;
    c.on('error', (err) => console.warn('[voice] connection error:', err.message));
    c.on('stateChange', (o, n) => { if (o.status !== n.status) console.log(`[voice] ${o.status} → ${n.status}`); });
    // Discord shuffling us between voice servers looks like a disconnect that comes straight back; being
    // kicked or the channel being deleted does not. Wait 5 s for the first, tear down on the second so the
    // poller can rejoin.
    c.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(c, VoiceConnectionStatus.Signalling, 5_000),
          entersState(c, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (cur !== s) return;
        console.warn('[voice] disconnected and not coming back — leaving; the poller will rejoin');
        await endSession('disconnected');
      }
    });
    c.on(VoiceConnectionStatus.Destroyed, () => { if (cur === s) endSession('destroyed').catch(() => {}); });
  }

  async function joinRaid(poll, humans) {
    const ch = raidChannel();
    if (!ch || !ch.isVoiceBased()) {
      console.warn(`[live] join skipped: ${cfg.raidVoiceChannelId} is not a voice channel this bot can see`);
      state = lib.initialState();
      return;
    }
    const startMs = Date.now();
    let rec = null;
    if (cfg.recordMode !== 'off') {
      try {
        store.load();   // a hand edit between sessions
        if (store.error) console.warn(`[consent] ${store.error} — recording nobody until it is fixed`);
        rec = new lib.SessionRecorder({
          dir: lib.sessionDir(cfg.recordingsDir, poll.nightKey, startMs), startMs,
          guildId: cfg.guildId, channelId: ch.id, nightKey: poll.nightKey, recordMode: cfg.recordMode,
        });
      } catch (err) {
        console.error('[rec] cannot open the recordings directory — joining WITHOUT recording:', err.message);
      }
    }
    console.log(`[live] join: placed=${poll.placed} humans=${humans}${rec ? ` rec=${cfg.recordMode} opted-in=${optedInHere()}` : ''}`);
    const s = { connection: null, channelId: ch.id, rec, timers: [], minutes: [], ending: false, nick: lib.BASE_NICK };
    // Undeafened whenever recording is on: an opted-in member can speak at any point, and receiving needs an
    // undeafened member. Nothing is decrypted or kept for anyone else (no subscription, no packet is read).
    // Always muted — phase 1 says nothing aloud. DAVE (end-to-end voice encryption) stays at the library
    // default (on): Discord requires it for new channels.
    s.connection = joinVoiceChannel({
      channelId: ch.id, guildId: ch.guild.id, adapterCreator: ch.guild.voiceAdapterCreator,
      selfDeaf: !rec, selfMute: true,
    });
    cur = s;
    wireConnection(s);
    try {
      await entersState(s.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
      console.warn(`[live] join failed: ${err.message} (last state ${s.connection.state.status})`);
      await endSession('join failed');
      return;
    }
    if (cur !== s) return;               // torn down while we waited
    rec?.event('join');
    // Say so before the first packet is kept — the chat notice and, if an opted-in member is here, the [REC]
    // nickname — but wait at most 3 s for Discord to take them: a rate-limited REST call must not cost the
    // first words of the raid.
    const ids = humanIds();
    const notice = lib.joinNotice({
      channelId: ch.id, recording: !!rec, optedIn: ids.filter((id) => store.has(id)).length, total: ids.length,
      screenUrl: cfg.screenUrl,
    });
    const announced = Promise.all([refreshNick(), post(notice)]);
    await Promise.race([announced, new Promise((resolve) => setTimeout(resolve, 3_000))]);
    if (cur !== s) return;
    if (rec) startRecording(s);
    console.log(`[live] in ${ch.id}${rec ? `, recording the opted-in (${cfg.recordMode})` : ''}`);
  }

  // Everything that ends a stay goes through here: stop the timers, flush the files, leave the channel, put
  // the nickname back, and reset the rule's memory so the poller can rejoin. Safe to call twice.
  async function endSession(reason) {
    const s = cur;
    if (!s) return;
    cur = null;
    state = lib.initialState();
    s.ending = true;
    ending = (async () => {
      for (const t of s.timers) clearInterval(t);
      try { await s.rec?.close(reason); } catch (err) { console.warn('[rec] close failed:', err.message); }
      try { s.connection.destroy(); } catch { /* already destroyed */ }
      if (s.rec) await setNick(lib.BASE_NICK);
      console.log(`[live] left (${reason})`);
    })();
    try { await ending; } finally { ending = null; }
  }

  // ── The poll loop ──────────────────────────────────────────────────────────

  async function tick() {
    if (stopping) return;
    try {
      const poll = await pollApi();
      if (poll.ok !== apiWasOk) {
        console.log(poll.ok ? '[live] bot API reachable again' : `[live] bot API unreachable: ${poll.error}`);
        apiWasOk = poll.ok;
      }
      if (poll.ok && poll.nightKey) lastNightKey = poll.nightKey;
      const wait = ending;
      if (wait) await wait;
      if (stopping) return;
      const humans = humanIds().length;
      const d = lib.decide(state, poll, humans, Date.now());
      state = d.state;
      if (d.action === 'join') {
        lastReason = '';
        await joinRaid(poll, humans);
      } else if (d.action === 'leave') {
        lastReason = '';
        console.log(`[live] leave: ${d.reason}`);
        await endSession(d.reason);
      } else {
        // one line per CHANGE, not one per poll
        if (d.reason !== lastReason) { lastReason = d.reason; console.log(`[live] ${cur ? 'in channel' : 'waiting'}: ${d.reason}`); }
        refreshNick().catch(() => {});
      }
    } catch (err) {
      console.error('[live] tick failed:', err);
    }
    if (!stopping) timer = setTimeout(tick, cfg.pollMs);
  }

  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`[boot] ${signal} — shutting down`);
    clearTimeout(timer);
    setTimeout(() => process.exit(1), 8_000).unref();    // the orchestrator's SIGKILL comes after ~10 s
    try {
      const wait = ending;
      if (wait) await wait;
      await endSession('shutdown');
    } catch (err) { console.warn('[boot] shutdown cleanup failed:', err.message); }
    try { await client.destroy(); } catch { /* going down anyway */ }
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  client.once(Events.ClientReady, () => {
    console.log(`[boot] logged in as ${client.user.tag}; record mode ${cfg.recordMode}; polling ${cfg.apiUrl} every ${cfg.pollMs / 1000}s`);
    if (!guild()) console.error(`[boot] guild ${cfg.guildId} not found — is the bot invited to it?`);
    const ch = raidChannel();
    if (!ch || !ch.isVoiceBased()) console.error(`[boot] ${cfg.raidVoiceChannelId} is not a voice channel this bot can see`);
    else console.log(`[boot] raid voice channel: ${ch.name} (${ch.id})`);
    registerCommands()
      .then(() => console.log('[boot] /bristlebane registered for the guild'))
      .catch((err) => console.error('[boot] could not register /bristlebane (was the bot invited with the applications.commands scope?):', err.message));
    // A crash or kill mid-recording never restored the nickname; we are not in a channel yet, so [REC] is stale.
    if (guild()?.members.me?.nickname === lib.REC_NICK) setNick(lib.BASE_NICK);
    tick();
  });
  await client.login(cfg.token);
}

main().catch((err) => { console.error('[boot] fatal:', err); process.exit(1); });
