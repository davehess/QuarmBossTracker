// utils/voice.js — Discord voice playback for trigger TTS.
//
// Replaces the _playVoiceTrigger() stub in index.js. The flow:
//   1. First voice trigger comes in → bot connects to RAID_VOICE_CHANNEL_ID
//      (lazy — no idle connection when nothing is speaking).
//   2. Edge TTS (Microsoft Edge's free read-aloud endpoint, no auth) synthesizes
//      the message → audio stream piped into @discordjs/voice via ffmpeg.
//   3. Messages queue. We never overlap audio — a fast burst (3 triggers in 1s)
//      plays sequentially so they're each intelligible.
//   4. After IDLE_DISCONNECT_MS of silence the bot leaves the channel. The
//      next trigger reconnects. Keeps Discord's voice-presence indicator
//      honest and avoids holding a connection through quiet hours.
//
// Failure mode: any layer (deps missing, voice channel gone, TTS HTTP error,
// ffmpeg not on PATH) logs once and silently drops the message. The text-post
// path (TRIGGER_BROADCAST_CHANNEL_ID) is independent and still works — voice
// is a parallel surface, not a replacement.
//
// Native-deps note: package.json pins libsodium-wrappers (WASM crypto, no
// compile) and opusscript (pure-JS opus, no compile) so this runs on the
// node:20-alpine image without build-tools. ffmpeg is installed via apk in
// the Dockerfile.

'use strict';

const IDLE_DISCONNECT_MS = 5 * 60 * 1000;   // 5 min of silence → leave
const TTS_VOICE_DEFAULT  = 'en-US-AriaNeural';  // Edge TTS US English neural

// Lazy-loaded deps — only required on the first voice trigger. If the install
// is broken (missing native binding, alpine without ffmpeg, etc.) we want the
// bot's other surfaces to keep working; the voice path just no-ops with a
// warning. _loadDeps returns null on failure.
let _deps = undefined;   // undefined = not tried; null = tried and failed; object = loaded
function _loadDeps() {
  if (_deps !== undefined) return _deps;
  try {
    const voice = require('@discordjs/voice');
    const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
    _deps = { voice, MsEdgeTTS, OUTPUT_FORMAT };
    return _deps;
  } catch (err) {
    console.warn('[voice] dependencies not available — voice triggers will drop:', err.message);
    _deps = null;
    return null;
  }
}

// Per-guild voice state. Single guild for now (Wolf Pack), but keyed by
// guildId so a future multi-guild deployment doesn't need a rewrite.
const _state = new Map();   // guildId → { connection, player, queue, idleTimer, channelId }

function _getState(guildId) {
  let s = _state.get(guildId);
  if (!s) {
    s = { connection: null, player: null, queue: [], idleTimer: null, channelId: null, draining: false };
    _state.set(guildId, s);
  }
  return s;
}

// Schedule (or refresh) the idle-disconnect timer. Called every time we
// finish playing audio. Clears any existing timer first — sequencing matters
// because a burst of triggers will keep extending the deadline rather than
// firing the disconnect mid-queue.
function _armIdleTimer(guildId) {
  const s = _getState(guildId);
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  s.idleTimer = setTimeout(() => {
    s.idleTimer = null;
    if (s.queue.length > 0) return;   // someone snuck a message in
    leaveVoice(guildId, 'idle');
  }, IDLE_DISCONNECT_MS);
}

// Ensure we're connected to `channelId` in `guildId`. If we're already in a
// different channel for this guild we tear down and reconnect — channels can
// change between raid and off-night events.
async function _ensureConnected(guildClient, channelId) {
  const deps = _loadDeps();
  if (!deps) return null;
  const { joinVoiceChannel, entersState, VoiceConnectionStatus } = deps.voice;
  const guildId = guildClient.id;
  const s = _getState(guildId);

  // Same channel + healthy connection → reuse.
  if (s.connection && s.channelId === channelId
      && s.connection.state.status !== VoiceConnectionStatus.Destroyed
      && s.connection.state.status !== VoiceConnectionStatus.Disconnected) {
    return s.connection;
  }

  // Channel mismatch → drop the old one before joining the new one.
  if (s.connection && s.channelId !== channelId) {
    try { s.connection.destroy(); } catch { /* already gone */ }
    s.connection = null;
  }

  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator: guildClient.voiceAdapterCreator,
    selfDeaf: true,      // don't pretend to listen — we only speak
    selfMute: false,
  });

  // Wait for the connection to be Ready before we try to subscribe a player.
  // 20s catches startup hiccups (Discord WebSocket lag, region failover);
  // beyond that something's wrong and we drop with a warning.
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (err) {
    console.warn('[voice] join failed for channel', channelId, ':', err.message);
    try { connection.destroy(); } catch { /* already gone */ }
    return null;
  }

  s.connection = connection;
  s.channelId  = channelId;

  // Auto-cleanup on disconnect (other officer kicked the bot, channel deleted,
  // gateway resumed but voice lost). State.connection is cleared so the next
  // play() rejoins from scratch instead of trying to reuse the dead handle.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Try to reconnect once if Discord just shuffled us. If the reconnect
      // races a full disconnect (officer-kick), entersState throws and we
      // tear down for good.
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling,  5_000),
        entersState(connection, VoiceConnectionStatus.Connecting,  5_000),
      ]);
    } catch {
      console.log('[voice] disconnected from channel', s.channelId, '— cleaning up');
      try { connection.destroy(); } catch { /* already gone */ }
      if (s.player) { try { s.player.stop(true); } catch { /* already stopped */ } }
      s.connection = null;
      s.channelId  = null;
      s.player     = null;
    }
  });

  return connection;
}

// Drain the queue one message at a time. Sequential by design — overlapping
// TTS is unintelligible. Sets state.draining so a re-entrant call doesn't
// kick off a parallel drain.
async function _drainQueue(guildClient, guildId) {
  const s = _getState(guildId);
  if (s.draining) return;
  s.draining = true;
  const deps = _loadDeps();
  if (!deps) { s.draining = false; return; }
  const { createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, entersState } = deps.voice;
  const { MsEdgeTTS, OUTPUT_FORMAT } = deps;

  try {
    while (s.queue.length > 0) {
      const job = s.queue.shift();
      const connection = await _ensureConnected(guildClient, job.channelId);
      if (!connection) {
        console.warn('[voice] no connection — dropping', job.text.slice(0, 80));
        continue;
      }

      // Per-message TTS instance — voice (Aria, Guy, Jenny, …) can change
      // per trigger via job.voiceId. The Edge TTS WebSocket connection is
      // cheap to spin up; reusing one across voice changes is fiddly.
      const tts = new MsEdgeTTS();
      try {
        // WebM-Opus is the only Opus container msedge-tts 2.x emits. Discord
        // can read it directly via StreamType.WebmOpus — the .webm Matroska
        // headers carry the codec metadata @discordjs/voice's demuxer needs.
        // 24kHz mono is upsampled internally to Discord's 48kHz stereo.
        // (ffmpeg is the safety net for both this path and any MP3 fallback;
        // installing it in the Dockerfile means we never have to think about
        // which format Edge picked today.)
        const voiceId = job.voiceId || job.defaultVoice || TTS_VOICE_DEFAULT;
        await tts.setMetadata(voiceId, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
        const { audioStream } = tts.toStream(job.text);
        // inlineVolume:true lets us set per-resource gain — required for the
        // /admin/voice volume slider. Costs an opus→PCM→opus pass via
        // prism-media; trivial vs network latency, and only when settings
        // actually request a non-100% volume.
        const wantsGain = job.volumePct != null && job.volumePct !== 100;
        const resource = createAudioResource(audioStream, {
          inputType: StreamType.WebmOpus,
          inlineVolume: wantsGain,
        });
        if (wantsGain && resource.volume && resource.volume.setVolume) {
          // 0..200% → 0.0..2.0 scalar. >2.0 hits clipping fast; raid leaders
          // can twist past safe levels deliberately via the slider, but
          // we don't accept anything wilder than what /admin/voice ships.
          resource.volume.setVolume(Math.max(0, job.volumePct) / 100);
        }

        if (!s.player) {
          s.player = createAudioPlayer();
          s.player.on('error', err => console.warn('[voice] player error:', err.message));
          connection.subscribe(s.player);
        } else {
          // Reusing the player across messages — re-subscribe to make sure
          // we're connected to the CURRENT connection (channel may have
          // changed since the player was created).
          connection.subscribe(s.player);
        }

        s.player.play(resource);
        // Wait for the message to finish before pulling the next one off the
        // queue. 30s ceiling covers reasonable raid call-out lengths; longer
        // messages get truncated upstream (300 chars in /api/agent/trigger).
        await entersState(s.player, AudioPlayerStatus.Idle, 30_000).catch(err => {
          console.warn('[voice] play timed out:', err.message);
        });
      } catch (err) {
        console.warn('[voice] TTS failed for', job.text.slice(0, 60), ':', err.message);
      }
    }
  } finally {
    s.draining = false;
    _armIdleTimer(guildId);
  }
}

// Public entry — replaces the _playVoiceTrigger stub. Returns a promise that
// resolves once the message has been QUEUED (not played); the caller doesn't
// need to wait for playback. Synchronous-feeling so it can sit inside the
// trigger handler's tight loop without serializing fires.
//
// Consults voiceSettings (admin-panel ripcord) BEFORE queueing — a disabled
// setting or a matching skip pattern means we never connect. That keeps the
// voice channel clean during a panic mute, and matters most when the agent
// is firing 30+ /sec on a wedged trigger.
async function playInVoice({ guildClient, channelId, text, voiceId, triggerName }) {
  if (!guildClient || !channelId || !text) return false;
  const deps = _loadDeps();
  if (!deps) return false;

  // Settings gate. Failure to load settings (no Supabase, transient
  // network) falls open to DEFAULTS — better to play than silently swallow.
  let settings;
  try {
    const vs = require('./voiceSettings');
    settings = await vs.get(guildClient.id);
    const { ok, reason } = vs.shouldPlay(settings, { triggerName, message: text });
    if (!ok) {
      console.log('[voice] skip:', reason, '— text:', String(text).slice(0, 80));
      return false;
    }
  } catch (err) {
    console.warn('[voice] settings lookup failed (falling open):', err?.message);
    settings = null;
  }

  const guildId = guildClient.id;
  const s = _getState(guildId);

  // Cancel any pending idle disconnect — we're about to play, so the timer
  // should restart from when this batch finishes, not when the last batch
  // ended.
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }

  s.queue.push({
    channelId,
    text:         String(text).slice(0, 600),
    voiceId:      voiceId || null,
    defaultVoice: settings ? settings.default_voice : null,
    volumePct:    settings ? settings.volume_pct   : null,
    triggerName:  triggerName || null,
  });
  // Kick the drain; if one is already running, the queue push above is enough.
  _drainQueue(guildClient, guildId).catch(err => console.warn('[voice] drain error:', err.message));
  return true;
}

// Manually leave (used by /voiceleave + idle timer). reason is logged only.
function leaveVoice(guildId, reason) {
  const s = _state.get(guildId);
  if (!s) return false;
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  if (s.player) { try { s.player.stop(true); } catch { /* gone */ } s.player = null; }
  if (s.connection) {
    try { s.connection.destroy(); } catch { /* gone */ }
    s.connection = null;
  }
  s.channelId = null;
  s.queue.length = 0;
  console.log('[voice] left voice', reason ? '(' + reason + ')' : '');
  return true;
}

// Diagnostic for /voicetest and dashboard surfaces.
function getStatus(guildId) {
  const s = _state.get(guildId);
  if (!s || !s.connection) return { connected: false, channelId: null, queueLen: 0 };
  return {
    connected: true,
    channelId: s.channelId,
    queueLen:  s.queue.length,
    draining:  s.draining,
  };
}

module.exports = {
  playInVoice,
  leaveVoice,
  getStatus,
  IDLE_DISCONNECT_MS,
  TTS_VOICE_DEFAULT,
};
