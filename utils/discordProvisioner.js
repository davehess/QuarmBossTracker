// utils/discordProvisioner.js — the bot builds its own Discord layout.
//
// The guild lead, 2026-10-07: "find ways to avoid manual keying. For example find
// ways to have the bot create its own /board threads for the different expansion
// bosses and lock down its own reserved spaces in those threads."
//
// Design: docs/DESIGN-guild-kit.md §2 and §7 slice 3, and option C of
// docs/DESIGN-discord-setup-page.md. Layout data: data/discord-layout.json.
//
// THE SHAPE
//   Env is the transport. The bot reads every Discord anchor straight from
//   process.env at ~54 sites, so this module fills UNSET env keys at ClientReady
//   (exactly like guild/discord.json does at boot) and every existing lazy read
//   picks the ids up with zero call-site edits. It never overwrites a set value,
//   never writes state.json (which does not persist on Railway) and only ever
//   assigns strings.
//
// RESOLUTION PER ANCHOR, first hit wins
//   1. env — set by the operator or filled from guild/discord.json. Both are
//      operator-owned and are never overridden (the file is re-read here only to
//      LABEL the source). A repair run is the one explicit exception.
//   2. a provisioner-owned record in bot_kv (key `discord_anchors`), verified
//      with a fetch. 10003 / 10008 / 404 means gone; any other error means
//      unknown, and an unknown id is left alone: kept in the record, never
//      replaced, never recreated. Records whose source is env or file are
//      MIRRORS for export and recovery and never fill env: removing a Railway
//      variable to switch a feature off must stay effective.
//   3. adopt/create modes: find by IDENTITY — a channel by name against the
//      manifest aliases, a thread by name inside its parent (active AND archived
//      pages; an adopted archived thread is unarchived), a message slot by bot
//      author + the real builder title (earliest wins, the rule /cleanup uses),
//      with a footer marker `wp:slot:<key>` on the placeholders this module posts.
//   4. create mode, tier allowing: look once MORE immediately before creating,
//      then create.
//   5. otherwise leave unset and report.
//
// WHAT NEVER CHANGES
//   Wolf Pack sets everything in env, so its run resolves to `report` and fills
//   nothing. The kv rows it writes are mirrors of values it already has.
//
// This module must NOT require utils/state.js (state.json is exactly what a
// provisioner exists to stop depending on) and never touches channelSlots.

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const {
  PermissionFlagsBits: P, ChannelType: CT, EmbedBuilder, OverwriteType, MessageType,
} = require('discord.js');
const { _isGone, unarchiveIfNeeded } = require('./threadAnchor');
const { EXPANSION_ORDER, EXPANSION_META } = require('./config');
const embeds = require('./embeds');
const { buildExpansionPanels } = require('./board');

const LAYOUT_PATH   = path.join(__dirname, '..', 'data', 'discord-layout.json');
const BOSSES_PATH   = path.join(__dirname, '..', 'data', 'bosses.json');
const GUILD_DIR     = path.join(__dirname, '..', 'guild');

const KV_KEY        = 'discord_anchors';
const LOCK_KEY      = 'discord_provision_lock';
const LOCK_TTL_MS   = 120 * 1000;
const BOOT_BOUND_MS = 25 * 1000;
const MARKER_PREFIX = 'wp:slot:';
const ARCHIVED_PAGES = 5;          // pages of 100 archived threads an adopt scan will read
const MODES         = ['off', 'report', 'adopt', 'create'];

// The loader in index.js (_loadGuildDiscordJson) refuses keys matching this. The
// export here refuses the same set, and test/provisioner-env-parity.test.js
// proves the two source strings are identical.
const SECRET_KEY_RE = /SPEC|TOKEN|KEY|SECRET|PASSWORD/;

// ── Permissions ──────────────────────────────────────────────────────────────
const PERM_BITS = {
  'View Channel':             P.ViewChannel,
  'Send Messages':            P.SendMessages,
  'Send Messages in Threads': P.SendMessagesInThreads,
  'Embed Links':              P.EmbedLinks,
  'Read Message History':     P.ReadMessageHistory,
  'Create Public Threads':    P.CreatePublicThreads,
  'Manage Threads':           P.ManageThreads,
  'Manage Messages':          P.ManageMessages,
  'Pin Messages':             P.PinMessages,
  'Manage Channels':          P.ManageChannels,
};
const BASE_NEEDS = ['View Channel', 'Send Messages', 'Send Messages in Threads', 'Embed Links',
  'Read Message History', 'Create Public Threads', 'Manage Threads', 'Manage Messages'];

/**
 * Which of `needs` (names from PERM_BITS) the bot lacks in `channel`.
 * Fails OPEN — same contract as raidNight._canOpenThreadIn: when the permission
 * model cannot be evaluated (no permissionsFor, no member) the answer is ok,
 * because a refused write will say so loudly and a false alarm here would block
 * a working deployment.
 */
function checkPerms(channel, me, needs) {
  if (!me || typeof channel?.permissionsFor !== 'function') return { ok: true, missing: [], skipped: true };
  let perms;
  try { perms = channel.permissionsFor(me); } catch { return { ok: true, missing: [], skipped: true }; }
  if (!perms) return { ok: true, missing: [], skipped: true };
  const missing = (needs || BASE_NEEDS).filter(n => PERM_BITS[n] != null && !perms.has(PERM_BITS[n]));
  return { ok: missing.length === 0, missing };
}

function baseNeeds(pin) { return pin ? [...BASE_NEEDS, 'Pin Messages'] : BASE_NEEDS.slice(); }

// The README's invite permissions, built from bits so the integer cannot drift
// from the list. Manage Roles stays in only because /pvprole already needs it;
// the provisioner itself never creates a role.
const INVITE_BASE_NAMES = ['ViewChannel', 'SendMessages', 'ManageMessages', 'EmbedLinks', 'AttachFiles',
  'ReadMessageHistory', 'Connect', 'Speak', 'UseVAD', 'ChangeNickname', 'ManageRoles', 'ManageEvents',
  'ManageThreads', 'CreatePublicThreads', 'SendMessagesInThreads', 'PinMessages'];
function invitePermissions({ channels = false, clientId = null } = {}) {
  let bits = 0n;
  for (const n of INVITE_BASE_NAMES) bits |= P[n];
  if (channels) bits |= P.ManageChannels;
  const permissions = bits.toString();
  const url = clientId
    ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=${permissions}`
    : null;
  return { permissions, url };
}

// ── Layout loading and expansion ─────────────────────────────────────────────
function loadLayout(file) {
  const layout = JSON.parse(fs.readFileSync(file || LAYOUT_PATH, 'utf8'));
  if (!layout || !Array.isArray(layout.parents) || !Array.isArray(layout.threads) || !layout.slots) {
    throw new Error('discord layout is malformed');
  }
  return layout;
}

function loadBosses() {
  try { return JSON.parse(fs.readFileSync(BOSSES_PATH, 'utf8')); } catch { return []; }
}

/** Era list = EXPANSION_ORDER filtered to eras that have bosses. A boss with no
 *  expansion field counts as Luclin, exactly like utils/config.getBossExpansion. */
function listEras(bosses) {
  const present = new Set((bosses || []).map(b => (b && b.expansion) || 'Luclin'));
  return EXPANSION_ORDER.filter(e => present.has(e) && EXPANSION_META[e]);
}

function eraInfo(era) {
  const meta  = EXPANSION_META[era];
  const label = meta.label;
  return { era, ERA: era.toUpperCase(), label, labelPlain: label.replace(/^[^\p{L}\p{N}]+/u, '').trim(), color: meta.color };
}

// Real card titles, read from the builders at run time. Never retyped: a drift
// between a placeholder and its card would orphan the slot on the first /board.
function slotInfo(builder, era, bosses) {
  const one = (e) => ({ title: e.data.title, color: e.data.color });
  switch (builder) {
    case 'summaryCard':      return [one(embeds.buildSummaryCard([], {}))];
    case 'spawningCard':     return [one(embeds.buildSpawningTomorrowCard([], {}))];
    case 'dailySummaryCard': return [one(embeds.buildDailySummaryEmbed([], [], []))];
    case 'eraCooldown':      return [one(embeds.buildExpansionCooldownCard(era, [], {}))];
    case 'eraBoards':        return buildExpansionPanels(era, bosses, {}).map(p => one(p.payload.embeds[0]));
    default: throw new Error(`unknown slot builder ${builder}`);
  }
}

function fillTokens(str, info) {
  return String(str)
    .replace(/\{ERA\}/g, info.ERA).replace(/\{era\}/g, info.era)
    .replace(/\{labelPlain\}/g, info.labelPlain).replace(/\{label\}/g, info.label);
}

/**
 * Expand the manifest into the flat list of anchors this deployment can have.
 * Every item: { key, id, kind: channel|thread|message|text|boardSet, phase:
 * parent|slot|thread|eraSlot, tier, group, parentKey, names, createName, type,
 * adoptOnly, botOwned, hub, pin, label, era, titles, prev }.
 */
function expandLayout(layout, { bosses } = {}) {
  const bs   = bosses || loadBosses();
  const eras = listEras(bs).map(eraInfo);
  const items = [];
  const keyOfParent = new Map();

  for (const p of layout.parents) {
    keyOfParent.set(p.id, p.env);
    items.push({
      key: p.env, id: p.id, kind: 'channel', phase: 'parent', tier: p.tier, group: p.group || null,
      parentKey: null, names: p.names || [], createName: (p.names || [])[0], type: p.type || 'text',
      adoptOnly: !!p.adoptOnly, botOwned: !!p.botOwned, hub: !!p.hub, label: p.label || p.id,
    });
  }
  const hub = layout.parents.find(p => p.hub);
  const hubKey = hub ? hub.env : null;

  // Main slots live in the hub channel, in manifest order; each waits for the one before.
  let prev = null;
  for (const s of layout.slots.main || []) {
    const info = s.builder ? slotInfo(s.builder, null, bs) : null;
    const it = {
      key: s.env, id: s.id, kind: s.kind === 'text' ? 'text' : 'message', phase: 'slot', tier: s.tier,
      group: s.group || null, parentKey: hubKey, names: [], titles: info ? info.map(i => i.title) : [],
      colors: info ? info.map(i => i.color) : [], pin: !!s.pin, label: s.label || s.id, prev,
    };
    items.push(it); prev = it.key;
  }

  const eraThreadItems = [];
  for (const t of layout.threads) {
    if (t.forEach === 'era') {
      for (const info of eras) {
        const it = {
          key: fillTokens(t.env, info), id: `${t.id}:${info.era}`, kind: 'thread', phase: 'thread', tier: t.tier,
          group: t.group || null, parentKey: keyOfParent.get(t.parent),
          names: (t.names || []).map(n => fillTokens(n, info)), createName: fillTokens(t.createName || t.names[0], info),
          label: fillTokens(t.label || t.id, info), era: info.era,
        };
        items.push(it); eraThreadItems.push(it);
      }
    } else {
      items.push({
        key: t.env, id: t.id, kind: 'thread', phase: 'thread', tier: t.tier, group: t.group || null,
        parentKey: keyOfParent.get(t.parent), names: t.names || [], createName: (t.names || [])[0], label: t.label || t.id,
      });
    }
  }

  for (const it of eraThreadItems) {
    const info = eraInfo(it.era);
    let before = null;
    for (const s of layout.slots.perEra || []) {
      const slot = slotInfo(s.builder, info.era, bs);
      items.push({
        key: fillTokens(s.env, info), id: `${s.id}:${info.era}`, kind: s.kind, phase: 'eraSlot', tier: s.tier,
        group: s.group || null, parentKey: it.key, names: [], titles: slot.map(i => i.title), colors: slot.map(i => i.color),
        count: slot.length, label: fillTokens(s.label || s.id, info), era: info.era, prev: before,
      });
      before = fillTokens(s.env, info);
    }
  }
  return {
    eras, items, hubKey,
    selfHealing: layout.selfHealing || [], external: layout.external || [], derived: layout.derived || [],
    groups: layout.groups || [],
  };
}

const PHASE_ORDER = ['parent', 'slot', 'thread', 'fill', 'eraSlot'];

/** The ordered steps a run executes: parents, main slots, threads, the
 *  thread-links fill, then each era thread's own slots. A thread created in a
 *  text channel posts a "started a thread" notice into the parent timeline, so
 *  the slots have to be there first. */
function planSteps(expanded) {
  const steps = [];
  for (const phase of PHASE_ORDER) {
    if (phase === 'fill') { steps.push({ phase, key: 'THREAD_LINKS_FILL', kind: 'fill' }); continue; }
    for (const it of expanded.items.filter(i => i.phase === phase)) {
      steps.push({ phase, key: it.key, kind: it.kind, tier: it.tier, parent: it.parentKey });
    }
  }
  return steps;
}

// ── Mode and scope ───────────────────────────────────────────────────────────
function parseList(v) {
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

function optionsFromEnv(env) {
  const lock = String(env.GUILD_PROVISION_LOCK || 'none').toLowerCase();
  return {
    mode: String(env.GUILD_PROVISION || 'auto').trim().toLowerCase() || 'auto',
    optional: new Set(parseList(env.GUILD_PROVISION_OPTIONAL).map(s => s.toLowerCase())),
    skip: new Set(parseList(env.GUILD_PROVISION_SKIP)),
    createChannels: String(env.GUILD_PROVISION_CREATE_CHANNELS || '') === '1',
    lock: lock === 'readonly' ? 'readonly' : 'none',
    pin: String(env.GUILD_PROVISION_PIN || '0') === '1',
  };
}

const isSet = (v) => v != null && String(v).trim() !== '';

/**
 * Resolve a requested mode. `auto` is `report` for a configured deployment
 * (TIMER_CHANNEL_ID set — Wolf Pack) and `create` only for a provably virgin
 * one: the hub, every era thread and every main slot unset in env AND in the
 * kv record. A kv that could not be read is not proof of anything, so it is
 * never virgin. `kvKeys` is the Set of anchor keys the kv record holds, or
 * null when the record is unknown.
 *
 * One more way into `create`: an UNFINISHED BUILD of our own. The kv record
 * (`kvRecord`) says its last run was a create run, it holds at least one anchor
 * this module created, and a required anchor is still unset in env and kv (a
 * first boot that hit its time bound, or died on a failed send). Without this the
 * second boot would see the hub in kv, call the guild configured, and finish
 * nothing. `skip` keys are not "unfinished": the operator excluded them.
 */
function resolveMode(raw, env, { kvKeys = null, expanded = null, kvRecord = null, skip = null } = {}) {
  const v = String(raw || 'auto').trim().toLowerCase();
  if (MODES.includes(v)) return { mode: v, reason: 'requested' };
  if (isSet(env.TIMER_CHANNEL_ID)) return { mode: 'report', reason: 'auto: TIMER_CHANNEL_ID is set (a configured deployment)' };
  if (!kvKeys) return { mode: 'report', reason: 'auto: the kv record could not be read, so a virgin guild is unproven' };
  const keys = expanded
    ? expanded.items.filter(i => i.phase === 'slot' || (i.phase === 'thread' && i.era) || i.hub).map(i => i.key)
    : ['TIMER_CHANNEL_ID'];
  const anySet = keys.some(k => isSet(env[k]) || kvKeys.has(k));
  if (!anySet) return { mode: 'create', reason: 'auto: a virgin deployment (nothing set in env or kv)' };
  const builtByUs = !!(kvRecord && kvRecord.last_run && kvRecord.last_run.mode === 'create'
    && Object.values(kvRecord.anchors || {}).some(a => a && a.source === 'created'));
  const unfinished = builtByUs && !!expanded && expanded.items.some(i =>
    i.tier === 'required' && !(skip && skip.has(i.key)) && !isSet(env[i.key]) && !kvKeys.has(i.key));
  return unfinished
    ? { mode: 'create', reason: 'auto: resuming an unfinished build' }
    : { mode: 'report', reason: 'auto: some anchors already exist' };
}

/**
 * The most an anchor may do in this run: skip | passive | report | adopt | create.
 * Pure, so the tier x mode matrix is testable without a Discord client.
 *   skip     GUILD_PROVISION_SKIP — never touched, wins over everything
 *   passive  `only` named other keys — resolved from env/kv for its children, no writes
 *   report   read-only: keep env, fill from provisioner-owned kv rows, mirror
 *   adopt    + find by identity (required and platform tiers; an optional tier
 *            only when its group is named in GUILD_PROVISION_OPTIONAL)
 *   create   + create what is missing (threads and slots; a channel only with
 *            GUILD_PROVISION_CREATE_CHANNELS=1 — except the hub, the one channel
 *            a virgin guild cannot do without; an adopt-only anchor never)
 */
function allowedAction(item, { mode, optional = new Set(), skip = new Set(), createChannels = false, only = null } = {}) {
  if (skip.has(item.key)) return 'skip';
  if (only && !only.has(item.key)) return 'passive';
  if (mode === 'off') return 'passive';
  const inScope = item.tier !== 'optional' || optional.has(String(item.group || '').toLowerCase());
  if (mode === 'report' || !inScope) return 'report';
  if (mode === 'adopt') return 'adopt';
  if (item.adoptOnly) return 'adopt';
  if (item.kind === 'channel' && !createChannels && !item.hub) return 'adopt';
  return 'create';
}

// ── Name matching ────────────────────────────────────────────────────────────
function norm(s) {
  return String(s == null ? '' : s).normalize('NFKD').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

function cmpId(a, b) {
  try { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; }
  catch { return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; }
}

/**
 * Match candidates against aliases in priority order. The first alias that
 * matches anything decides: one candidate wins; several are `ambiguous` —
 * unless `lowestWins`, which is what a thread wants (same-name duplicates
 * adopt the lowest id and delete nothing).
 */
function matchByName(candidates, names, { lowestWins = false } = {}) {
  for (const alias of names || []) {
    const a = norm(alias);
    if (!a) continue;
    const hits = candidates.filter(c => norm(c.name) === a).sort((x, y) => cmpId(x.id, y.id));
    if (hits.length === 1) return { winner: hits[0], ambiguous: null, alias };
    if (hits.length > 1) {
      return lowestWins
        ? { winner: hits[0], ambiguous: null, alias, duplicates: hits.slice(1).map(h => h.id) }
        : { winner: null, ambiguous: hits.map(h => h.id), alias };
    }
  }
  return { winner: null, ambiguous: null, alias: null };
}

// ── Markers ──────────────────────────────────────────────────────────────────
function markerFor(key, idx) { return MARKER_PREFIX + key + (idx == null ? '' : ':' + idx); }
function parseMarker(text) {
  const m = /^wp:slot:([A-Z0-9_]+)(?::(\d+))?$/.exec(String(text || ''));
  return m ? { key: m[1], idx: m[2] == null ? null : Number(m[2]) } : null;
}

// Same test commands/cleanup.js uses for the thread-links slot. Copied, not
// required: cleanup.js pulls in utils/state.js, which this module must not touch.
// test/discord-provisioner-markers.test.js proves the two stay identical.
function isThreadLinksMsg(msg) {
  if ((msg.embeds && msg.embeds.length) || (msg.components && msg.components.length)) return false;
  const c = msg.content || '';
  return c.includes('→') && (
    c.includes('Classic') || c.includes('Kunark') || c.includes('Velious') ||
    c.includes('Luclin')  || c.includes('Power')
  );
}

function threadLinksContent(eras, idFor) {
  return eras.map(e => {
    const id = idFor(e.era);
    return id ? `${e.label} → <#${id}>` : `${e.label} → *(no thread)*`;
  }).join('\n');
}

function placeholderEmbed(title, color, marker) {
  return new EmbedBuilder()
    .setColor(color != null ? color : 0x2b2d31)
    .setTitle(title)
    .setDescription('Reserved. The bot fills this card in at its next /board.')
    .setFooter({ text: marker });
}

function sortOldestFirst(msgs) {
  return msgs.slice().sort((a, b) => ((a.createdTimestamp || 0) - (b.createdTimestamp || 0)) || cmpId(a.id, b.id));
}

async function fetchBotMessages(channel, botId, maxPages = 10) {
  const all = [];
  let before = null;
  for (let i = 0; i < maxPages; i++) {
    const opts = { limit: 100 };
    if (before) opts.before = before;
    const batch = await channel.messages.fetch(opts);
    if (!batch || batch.size === 0) break;
    const arr = [...batch.values()];
    all.push(...arr);
    before = arr[arr.length - 1].id;
    if (batch.size < 100) break;
  }
  return sortOldestFirst(all.filter(m => m.author && m.author.id === botId));
}

/**
 * Find the message for a slot among the bot's own messages in `container`.
 * Footer marker first (what the placeholder carried), then the real builder
 * title (what the card still carries once the bot has edited it), then — for
 * the text-only thread-links slot — the heuristic /cleanup uses. Earliest wins,
 * the same keep-earliest rule as /cleanup, so a duplicate never steals the slot.
 */
function pickSlotMessage(botMsgs, item, idx) {
  const marker = markerFor(item.key, item.kind === 'boardSet' ? idx : null);
  const firstEmbed = (m) => (m.embeds && m.embeds[0]) || null;
  const byMarker = botMsgs.filter(m => { const e = firstEmbed(m); return e && e.footer && e.footer.text === marker; });
  if (byMarker.length) return { msg: byMarker[0], duplicates: byMarker.length - 1, by: 'marker' };
  if (item.kind === 'text') {
    const hits = botMsgs.filter(isThreadLinksMsg);
    return hits.length ? { msg: hits[0], duplicates: hits.length - 1, by: 'heuristic' } : null;
  }
  const title = item.titles[item.kind === 'boardSet' ? idx : 0];
  const byTitle = botMsgs.filter(m => { const e = firstEmbed(m); return e && e.title === title; });
  return byTitle.length ? { msg: byTitle[0], duplicates: byTitle.length - 1, by: 'title' } : null;
}

// ── The run context ──────────────────────────────────────────────────────────
function readGuildFile(dir) {
  const out = { obj: null, keys: new Set() };
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(dir || GUILD_DIR, 'discord.json'), 'utf8'));
    if (obj && typeof obj === 'object') {
      out.obj = obj;
      for (const [k, v] of Object.entries(obj)) {
        if (!k.startsWith('_') && v != null && !SECRET_KEY_RE.test(k)) out.keys.add(k);
      }
    }
  } catch { /* no file, or not JSON: index.js already said so */ }
  return out;
}

const joinIds = (v) => (Array.isArray(v) ? v.join(',') : String(v));
const idsOf   = (v) => String(v).split(',').map(s => s.trim()).filter(Boolean);

function supabaseUsable(sb) {
  try { return !!(sb && (typeof sb.isEnabled !== 'function' || sb.isEnabled())); } catch { return false; }
}

function makeCtx(opts) {
  const env  = opts.env || process.env;
  const base = optionsFromEnv(env);
  const layout   = opts.layout || loadLayout();
  const expanded = opts.expanded || expandLayout(layout, { bosses: opts.bosses });
  const file = readGuildFile(opts.guildDir);
  const sb   = opts.supabase === undefined ? null : opts.supabase;
  return {
    client: opts.client || null, env, layout, expanded,
    supabase: supabaseUsable(sb) ? sb : null,
    tag: opts.guildTag || env.SUPABASE_GUILD_ID || 'wolfpack',
    requestedMode: opts.mode != null ? String(opts.mode).toLowerCase() : base.mode,
    mode: 'report', modeReason: '',
    dry: !!opts.dryRun,
    only: opts.only && opts.only.size ? opts.only : (Array.isArray(opts.only) && opts.only.length ? new Set(opts.only) : null),
    skip: opts.skip || base.skip,
    optional: opts.optional || base.optional,
    createChannels: opts.createChannels != null ? !!opts.createChannels : base.createChannels,
    lock: opts.lock || base.lock,
    pin: opts.pin != null ? !!opts.pin : base.pin,
    repair: !!opts.repair,
    fileObj: file.obj, fileKeys: file.keys,
    abort: opts.abort || { aborted: false },
    log: opts.log || ((m) => console.log(m)),
    kv: { state: 'disabled', record: null },
    anchors: {}, results: new Map(), chCache: new Map(), msgCache: new Map(),
    // Boot runs share the bot's Supabase circuit breaker (5 straight failures open
    // it), so a boot-path kv write tries twice; /setup and the CLI keep three.
    persistTries: opts.boot ? 2 : 3,
    blockedParents: new Set(), leaseHeld: false, holder: null,
    notes: [], errors: [], guild: null,
    nowMs: opts.now || (() => Date.now()),
    report: null,
  };
}

const note = (ctx, m) => { ctx.notes.push(m); };

async function getGuild(ctx) {
  if (ctx.guild) return ctx.guild;
  const c = ctx.client;
  if (!c || !c.guilds) return null;
  const id = ctx.env.DISCORD_GUILD_ID;
  let g = null;
  if (isSet(id)) {
    g = (c.guilds.cache && c.guilds.cache.get(id)) || null;
    if (!g && typeof c.guilds.fetch === 'function') g = await c.guilds.fetch(id).catch(() => null);
  } else if (c.guilds.cache && c.guilds.cache.size === 1) {
    g = [...c.guilds.cache.values()][0];
  }
  ctx.guild = g || null;
  return ctx.guild;
}

function botMember(ctx) {
  return (ctx.guild && ctx.guild.members && ctx.guild.members.me) || (ctx.client && ctx.client.user) || null;
}
const botId = (ctx) => (ctx.client && ctx.client.user && ctx.client.user.id) || null;

async function channelState(ctx, id) {
  if (ctx.chCache.has(id)) return { state: 'ok', ch: ctx.chCache.get(id) };
  if (String(id).startsWith('dry:')) return { state: 'unknown' };
  try {
    const ch = await ctx.client.channels.fetch(id);
    if (ch) { ctx.chCache.set(id, ch); return { state: 'ok', ch }; }
    return { state: 'unknown' };
  } catch (e) {
    return _isGone(e) ? { state: 'gone' } : { state: 'unknown', err: e };
  }
}

async function containerFor(ctx, item) {
  const parent = ctx.results.get(item.parentKey);
  if (!parent || !parent.id) return { state: 'unknown' };
  if (parent.simulated) return { state: 'dry' };
  return channelState(ctx, parent.id);
}

// Verify what we hold for an anchor. ok / gone / unknown — and unknown is never
// treated as gone, which is the whole point (null is UNKNOWN, never "absent").
async function verifyValue(ctx, item, value) {
  if (!ctx.client) return { state: 'unknown' };
  if (item.kind === 'channel' || item.kind === 'thread') return channelState(ctx, String(value));
  const c = await containerFor(ctx, item);
  if (c.state !== 'ok') return { state: 'unknown' };   // no container to ask is not evidence of anything
  let sawUnknown = false;
  for (const id of idsOf(value)) {
    try { await c.ch.messages.fetch(id); }
    catch (e) { if (_isGone(e)) return { state: 'gone' }; sawUnknown = true; }
  }
  return { state: sawUnknown ? 'unknown' : 'ok' };
}

async function listGuildChannels(ctx) {
  if (ctx.guildChannels) return ctx.guildChannels;
  const guild = await getGuild(ctx);
  if (!guild || !guild.channels) return [];
  let col;
  try { col = await guild.channels.fetch(); } catch { col = guild.channels.cache; }
  ctx.guildChannels = col ? [...col.values()].filter(Boolean) : [];
  return ctx.guildChannels;
}

async function listThreads(parent) {
  const out = [];
  if (!parent || !parent.threads) return out;
  try {
    const active = await parent.threads.fetchActive();
    out.push(...[...(active.threads || active).values()]);
  } catch { /* cannot list: the caller sees an empty set and falls back to create */ }
  // A few pages of the newest archived threads, not the whole archive: a layout
  // thread archived long ago and buried under a busy channel's history is
  // recreated rather than found, which beats walking every archived thread.
  let before;
  for (let page = 0; page < ARCHIVED_PAGES; page++) {
    try {
      const arch = await parent.threads.fetchArchived({ type: 'public', limit: 100, ...(before ? { before } : {}) });
      const got = [...(arch.threads || arch).values()];
      out.push(...got);
      if (!arch.hasMore || got.length === 0) break;
      before = got[got.length - 1];
    } catch { break; /* private archive or no permission: fine */ }
  }
  const seen = new Set();
  return out.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

// ── kv ───────────────────────────────────────────────────────────────────────
const enc = encodeURIComponent;
const kvQuery = (ctx, key) => `guild_id=eq.${enc(ctx.tag)}&key=eq.${key}&select=value&limit=1`;

async function loadKv(ctx) {
  if (!ctx.supabase) { ctx.kv = { state: 'disabled', record: null }; return; }
  let rows = null;
  try { rows = await ctx.supabase.select('bot_kv', kvQuery(ctx, KV_KEY)); } catch { rows = null; }
  if (!Array.isArray(rows)) { ctx.kv = { state: 'unknown', record: null }; note(ctx, 'kv unreadable: nothing is written to it this run'); return; }
  const rec = rows[0] && rows[0].value;
  if (!rec) { ctx.kv = { state: 'known', record: null }; return; }
  if (rec.v !== 1 || !rec.anchors || typeof rec.anchors !== 'object') {
    ctx.kv = { state: 'unknown', record: null };
    note(ctx, 'kv record has an unknown version: left alone');
    return;
  }
  if (rec.discord_guild_id && isSet(ctx.env.DISCORD_GUILD_ID) && String(rec.discord_guild_id) !== String(ctx.env.DISCORD_GUILD_ID)) {
    ctx.kv = { state: 'known', record: null };
    note(ctx, 'kv record belongs to another Discord server: ignored');
    return;
  }
  ctx.kv = { state: 'known', record: rec };
  ctx.anchors = JSON.parse(JSON.stringify(rec.anchors));
}

const canonAnchors = (a) => JSON.stringify(Object.keys(a || {}).sort().map(k => {
  const { at, ...rest } = a[k] || {}; void at;
  return [k, rest];
}));

async function persist(ctx, { force = false } = {}) {
  if (ctx.dry || !ctx.supabase || ctx.kv.state !== 'known') return false;
  const before = ctx.kv.record ? canonAnchors(ctx.kv.record.anchors) : canonAnchors({});
  if (!force && before === canonAnchors(ctx.anchors)) return true;   // unchanged: no write
  const record = {
    v: 1,
    discord_guild_id: isSet(ctx.env.DISCORD_GUILD_ID) ? String(ctx.env.DISCORD_GUILD_ID) : null,
    saved_at: new Date(ctx.nowMs()).toISOString(),
    last_run: { at: new Date(ctx.nowMs()).toISOString(), mode: ctx.mode, counts: ctx.counts ? { ...ctx.counts } : {} },
    anchors: ctx.anchors,
  };
  for (let i = 0; i < ctx.persistTries; i++) {
    let r = null;
    try {
      r = await ctx.supabase.upsert('bot_kv', [{
        guild_id: ctx.tag, key: KV_KEY, value: record, updated_at: new Date(ctx.nowMs()).toISOString(),
      }], 'guild_id,key');
    } catch { r = null; }
    // A COPY: the record's anchors would otherwise be the live working map, and
    // the next "did anything change" comparison would be the map against itself.
    if (r != null) { ctx.kv.record = JSON.parse(JSON.stringify(record)); return true; }
  }
  note(ctx, `kv write failed after ${ctx.persistTries} tries: anchors live in env and the export only`);
  return false;
}

async function acquireLease(ctx) {
  if (ctx.dry || !ctx.supabase || ctx.mode !== 'create') return true;
  ctx.holder = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const row = (holder) => ({ guild_id: ctx.tag, key: LOCK_KEY,
    value: { holder, expires_at: new Date(ctx.nowMs() + LOCK_TTL_MS).toISOString() }, updated_at: new Date(ctx.nowMs()).toISOString() });
  let got = null;
  try { got = await ctx.supabase.insertIgnoreDuplicates('bot_kv', [row(ctx.holder)], { representation: true }); } catch { got = null; }
  if (got == null) { note(ctx, 'lease unavailable (kv unreachable): the re-find before each create is the only guard'); ctx.holder = null; return true; }
  if (Array.isArray(got) && got.length) return true;
  // Held. A stale row (expires_at in the past) is taken over; a live one means someone else is provisioning.
  let rows = null;
  try { rows = await ctx.supabase.select('bot_kv', kvQuery(ctx, LOCK_KEY)); } catch { rows = null; }
  const cur = Array.isArray(rows) && rows[0] && rows[0].value;
  if (cur && cur.expires_at && Date.parse(cur.expires_at) < ctx.nowMs()) {
    let upd = null;
    try {
      upd = await ctx.supabase.update('bot_kv',
        `guild_id=eq.${enc(ctx.tag)}&key=eq.${LOCK_KEY}&value->>holder=eq.${enc(cur.holder)}`, row(ctx.holder));
    } catch { upd = null; }
    if (Array.isArray(upd) && upd.length) return true;
  }
  ctx.leaseHeld = true; ctx.holder = null;
  note(ctx, 'another provisioner run holds the lease: nothing was changed');
  return false;
}

async function releaseLease(ctx) {
  if (!ctx.holder || !ctx.supabase) return;
  try { await ctx.supabase.del('bot_kv', `guild_id=eq.${enc(ctx.tag)}&key=eq.${LOCK_KEY}&value->>holder=eq.${enc(ctx.holder)}`); }
  catch { /* the TTL expires it */ }
}

// ── Recording what resolved ──────────────────────────────────────────────────
function setEnv(ctx, key, value, { force = false } = {}) {
  const v = joinIds(value);
  if (typeof v !== 'string' || v === '' || v === 'undefined') return false;
  if (!force && isSet(ctx.env[key])) return false;
  ctx.env[key] = v;
  return true;
}

const kindOf = (item) => (item.kind === 'boardSet' ? 'messages' : item.kind === 'text' ? 'message' : item.kind);

function anchorEntry(ctx, item, value, source, name) {
  const old = ctx.anchors[item.key];
  const same = old && joinIds(old.ids || old.id) === joinIds(value) && old.source === source;
  const e = { kind: kindOf(item), source, name: name || null, parent: item.parentKey || null,
    at: same ? old.at : new Date(ctx.nowMs()).toISOString() };
  if (item.kind === 'boardSet') e.ids = idsOf(joinIds(value)); else e.id = String(value);
  return e;
}

// Record one resolution: env first, then the kv row (so a crash between them
// leaves env ahead of kv, which the next run re-derives by identity).
async function commit(ctx, item, rep, value, source, name, { force = false } = {}) {
  if (item.kind === 'boardSet') rep.ids = idsOf(joinIds(value)); else rep.id = String(value);
  rep.source = source;
  if (ctx.dry) {
    // A dry run changes nothing. A create gets a stand-in id so its children can
    // be planned; a real thing that was merely found keeps its real id.
    if (String(joinIds(value)).startsWith('dry:')) rep.simulated = true;
    return;
  }
  if (!ctx.only || ctx.only.has(item.key)) setEnv(ctx, item.key, value, { force });
  ctx.anchors[item.key] = anchorEntry(ctx, item, value, source, name);
  await persist(ctx);
}

// ── Per-item resolution ──────────────────────────────────────────────────────
function resolvedOk(rep) {
  return !!rep && ['keep', 'fill', 'fill-unverified', 'adopt', 'create', 'skip', 'passive-found'].includes(rep.action);
}

function sourceOfEnv(ctx, key, cur) {
  if (ctx.fileKeys.has(key) && ctx.fileObj) {
    const v = ctx.fileObj[key];
    if (joinIds(v) === cur) return 'file';
  }
  return 'env';
}

async function findChannelByIdentity(ctx, item) {
  const guild = await getGuild(ctx);
  if (!guild) return { state: 'noguild' };
  const chans = await listGuildChannels(ctx);
  const typeOk = (t) => (item.type === 'voice' ? (t === CT.GuildVoice || t === CT.GuildStageVoice) : (t === CT.GuildText || t === CT.GuildAnnouncement));
  const m = matchByName(chans.filter(c => typeOk(c.type)), item.names);
  if (m.ambiguous) return { state: 'ambiguous', candidates: m.ambiguous };
  return m.winner ? { state: 'found', ch: m.winner } : { state: 'none' };
}

async function findThreadByIdentity(ctx, item, parentCh) {
  const threads = await listThreads(parentCh);
  const m = matchByName(threads.filter(t => t.parentId == null || t.parentId === parentCh.id), item.names, { lowestWins: true });
  return m.winner ? { state: 'found', ch: m.winner, duplicates: m.duplicates || [] } : { state: 'none' };
}

// The bot's own messages in a container, paged once per container per run. A
// send into the container drops its entry (createSlot); `fresh` is the re-find
// right before a create, which exists to catch a message another run just
// posted and so must never read a stale scan.
async function botMessages(ctx, container, { fresh = false } = {}) {
  if (fresh) ctx.msgCache.delete(container.id);
  if (!ctx.msgCache.has(container.id)) ctx.msgCache.set(container.id, await fetchBotMessages(container, botId(ctx)));
  return ctx.msgCache.get(container.id);
}

async function findSlotByIdentity(ctx, item, container, { fresh = false } = {}) {
  const msgs = await botMessages(ctx, container, { fresh });
  if (item.kind === 'boardSet') {
    const ids = []; let lastTs = -1; let dup = 0;
    for (let i = 0; i < item.count; i++) {
      const hit = pickSlotMessage(msgs, item, i);
      if (!hit) return { state: 'none', partial: ids.length };
      if ((hit.msg.createdTimestamp || 0) < lastTs) return { state: 'none', partial: ids.length };
      lastTs = hit.msg.createdTimestamp || 0; ids.push(hit.msg.id); dup += hit.duplicates;
    }
    return { state: 'found', ids, duplicates: dup };
  }
  const hit = pickSlotMessage(msgs, item, 0);
  return hit ? { state: 'found', id: hit.msg.id, duplicates: hit.duplicates, by: hit.by } : { state: 'none' };
}

// Report what the bot lacks BY NAME before any write, instead of letting Discord
// answer 50013 halfway through a layout.
function permProblem(ctx, ch) {
  const r = checkPerms(ch, botMember(ctx), baseNeeds(ctx.pin));
  return r.ok ? null : `missing permission: ${r.missing.join(', ')}`;
}

async function guildCanManageChannels(ctx) {
  const guild = await getGuild(ctx);
  const me = guild && guild.members && guild.members.me;
  if (!me || !me.permissions || typeof me.permissions.has !== 'function') return true;   // fail open
  try { return !!me.permissions.has(P.ManageChannels); } catch { return true; }
}

async function createChannel(ctx, item) {
  const guild = await getGuild(ctx);
  const opts = {
    name: String(item.createName).slice(0, 100),
    type: item.type === 'voice' ? CT.GuildVoice : CT.GuildText,
    reason: `${ctx.tag}: guild provisioner`,
  };
  if (ctx.lock === 'readonly' && item.botOwned && item.type !== 'voice') {
    opts.permissionOverwrites = [
      { id: guild.roles.everyone.id, type: OverwriteType.Role,
        deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] },
      { id: botId(ctx), type: OverwriteType.Member,
        allow: [P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.ManageThreads,
          P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages] },
    ];
  }
  const ch = await guild.channels.create(opts);
  ctx.chCache.set(ch.id, ch);
  if (ctx.guildChannels) ctx.guildChannels.push(ch);
  return ch;
}

async function createThread(ctx, item, parentCh) {
  const base = { name: String(item.createName).slice(0, 100), reason: `${ctx.tag}: guild provisioner` };
  if (parentCh.type === CT.GuildText) base.type = CT.PublicThread;
  try {
    return await parentCh.threads.create({ ...base, autoArchiveDuration: 10080 });
  } catch (e) {
    // Seven-day auto-archive needs a boosted server; a 400 means retry with one day.
    if (e && (e.status === 400 || e.code === 50035)) return parentCh.threads.create({ ...base, autoArchiveDuration: 1440 });
    throw e;
  }
}

async function newestMessage(container) {
  const col = await container.messages.fetch({ limit: 1 });
  return col && col.size ? [...col.values()][0] : null;
}

// May slot `item` be created now? Slot k only after slots < k are present, and
// only at the bottom of a container that holds nothing but our own earlier
// slots: a populated one cannot have slots inserted at the top.
async function slotEligibility(ctx, item, container) {
  if (item.prev) {
    const before = ctx.results.get(item.prev);
    if (!resolvedOk(before)) return { ok: false, why: `blocked: the slot before it (${item.prev}) is not present` };
  }
  const newest = await newestMessage(container);
  if (!newest) return { ok: true };
  // A placeholder an interrupted run left behind carries our marker: it is ours
  // even though no record names it yet (a half-posted board set).
  const nf = newest.embeds && newest.embeds[0] && newest.embeds[0].footer && newest.embeds[0].footer.text;
  if (newest.author && newest.author.id === botId(ctx) && parseMarker(nf)) return { ok: true };
  const known = new Set();
  for (const [k, r] of ctx.results) {
    const it = ctx.expanded.items.find(i => i.key === k);
    if (it && it.parentKey === item.parentKey && (it.kind === 'message' || it.kind === 'text' || it.kind === 'boardSet')) {
      if (r.id) known.add(String(r.id));
      if (r.ids) r.ids.forEach(x => known.add(String(x)));
    }
  }
  return known.has(String(newest.id))
    ? { ok: true }
    : { ok: false, why: 'not at top: the container already holds other messages, so /board posts the cards' };
}

async function pinIfWanted(ctx, item, container, msg) {
  if (!ctx.pin || !item.pin || !msg || typeof msg.pin !== 'function') return;
  try {
    await msg.pin();
    // A pin posts a system notice; delete the one for THIS pin and nobody else's.
    // It references the pinned message; failing that it is the bot's own and newer
    // than that message (a person's pin, or the bot's pin of another message, is not).
    const recent = await container.messages.fetch({ limit: 3 });
    for (const m of recent.values()) {
      if (m.type !== MessageType.ChannelPinnedMessage || typeof m.delete !== 'function') continue;
      const refId = m.reference && m.reference.messageId;
      const ours = refId != null
        ? String(refId) === String(msg.id)
        : !!(m.author && m.author.id === botId(ctx)) && cmpId(m.id, msg.id) > 0;
      if (ours) await m.delete().catch(() => {});
    }
  } catch (e) { note(ctx, `pin of ${item.key} failed: ${e && e.message}`); }
}

function eraThreadIdFor(ctx) {
  return (era) => {
    const key = `${era.toUpperCase()}_THREAD_ID`;
    const r = ctx.results.get(key);
    if (r && r.id && !r.simulated) return r.id;
    return isSet(ctx.env[key]) ? String(ctx.env[key]).trim() : null;
  };
}

async function createSlot(ctx, item, container) {
  if (item.kind === 'text') {
    const msg = await container.send({ content: threadLinksContent(ctx.expanded.eras, eraThreadIdFor(ctx)) });
    ctx.msgCache.delete(container.id);
    await pinIfWanted(ctx, item, container, msg);
    return [msg.id];
  }
  const ids = [];
  const n = item.kind === 'boardSet' ? item.count : 1;
  // A board set is several messages and a run can die between them. Reuse any
  // panel an earlier run already posted (by marker) instead of posting it twice.
  const have = n > 1 ? await botMessages(ctx, container) : [];
  for (let i = 0; i < n; i++) {
    const marker = markerFor(item.key, item.kind === 'boardSet' ? i : null);
    const prior = have.find(m => m.embeds && m.embeds[0] && m.embeds[0].footer && m.embeds[0].footer.text === marker);
    if (prior) { ids.push(prior.id); continue; }
    const msg = await container.send({ embeds: [placeholderEmbed(item.titles[i], item.colors[i], marker)] });
    ctx.msgCache.delete(container.id);
    ids.push(msg.id);
    await pinIfWanted(ctx, item, container, msg);
  }
  return ids;
}

async function processItem(ctx, item) {
  const rep = { key: item.key, tier: item.tier, group: item.group || null, kind: item.kind, phase: item.phase,
    label: item.label || item.id, action: 'missing' };
  ctx.results.set(item.key, rep);
  const level = allowedAction(item, { mode: ctx.mode, optional: ctx.optional, skip: ctx.skip, createChannels: ctx.createChannels, only: ctx.only });
  rep.level = level;
  if (level === 'skip') { rep.action = 'skip'; return rep; }

  const inScope = item.tier !== 'optional' || ctx.optional.has(String(item.group || '').toLowerCase());
  rep.inScope = inScope;
  let forced = false;

  // 1. env (operator-owned, or filled from guild/discord.json by index.js).
  const cur = isSet(ctx.env[item.key]) ? String(ctx.env[item.key]).trim() : '';
  if (cur) {
    const src = sourceOfEnv(ctx, item.key, cur);
    let dead = false;
    if (ctx.repair && level !== 'passive' && ctx.client) {
      const v = await verifyValue(ctx, item, cur);
      if (v.state === 'gone') { dead = true; rep.dead = true; rep.note = `the ${src} value ${cur} no longer exists`; }
    }
    if (!dead) {
      rep.action = level === 'passive' ? 'passive-found' : 'keep';
      rep.source = src;
      if (item.kind === 'boardSet') rep.ids = idsOf(cur); else rep.id = cur;
      if (level !== 'passive' && !ctx.dry) ctx.anchors[item.key] = anchorEntry(ctx, item, cur, src, null);
      return rep;
    }
    forced = true;
  } else if (ctx.anchors[item.key] && (ctx.anchors[item.key].source === 'env' || ctx.anchors[item.key].source === 'file') && level !== 'passive') {
    // A mirror whose variable has been removed: the operator switched it off. It
    // never fills env, and the stale mirror row is dropped.
    if (!ctx.dry) delete ctx.anchors[item.key];
  }

  // 2. The provisioner's own record, verified.
  const rec = ctx.anchors[item.key];
  if (rec && (rec.source === 'created' || rec.source === 'adopted')) {
    const val = rec.ids || rec.id;
    const v = await verifyValue(ctx, item, joinIds(val));
    if (v.state === 'ok' || v.state === 'unknown') {
      rep.action = level === 'passive' ? 'passive-found' : (v.state === 'ok' ? 'fill' : 'fill-unverified');
      rep.source = rec.source === 'created' ? 'kv-created' : 'kv-adopted';
      if (item.kind === 'boardSet') rep.ids = idsOf(joinIds(val)); else rep.id = String(val);
      if (v.state === 'unknown') rep.note = 'could not be verified (Discord did not answer); kept as recorded';
      if (level !== 'passive' && !ctx.dry) setEnv(ctx, item.key, val, { force: forced });
      return rep;
    }
    rep.dead = true; rep.note = 'the recorded id no longer exists';
    if (!ctx.dry && level !== 'passive') delete ctx.anchors[item.key];
  }

  if (level === 'passive' || level === 'report') { rep.action = 'missing'; return rep; }

  // From here: adopt or create.
  const parentRep = item.parentKey ? ctx.results.get(item.parentKey) : null;
  if (item.parentKey && !(parentRep && parentRep.id)) {
    rep.action = 'blocked'; rep.note = `its parent (${item.parentKey}) is not resolved`;
    return rep;
  }
  const parentIsDry = !!(parentRep && parentRep.simulated);

  let container = null, parentCh = null;
  if (item.parentKey && !parentIsDry) {
    const c = await channelState(ctx, parentRep.id);
    if (c.state !== 'ok') { rep.action = 'blocked'; rep.note = `its parent (${item.parentKey}) could not be fetched`; return rep; }
    parentCh = c.ch; container = c.ch;
  }

  // 3. Adopt by identity.
  const find = async ({ fresh = false } = {}) => {
    if (parentIsDry) return { state: 'none' };
    if (item.kind === 'channel') return findChannelByIdentity(ctx, item);
    if (item.kind === 'thread') return findThreadByIdentity(ctx, item, parentCh);
    return findSlotByIdentity(ctx, item, container, { fresh });
  };
  const adoptFound = async (f) => {
    rep.action = 'adopt';
    if (f.duplicates && (Array.isArray(f.duplicates) ? f.duplicates.length : f.duplicates)) {
      rep.note = `duplicates found (${Array.isArray(f.duplicates) ? f.duplicates.length : f.duplicates}); the earliest was adopted and none deleted`;
    }
    if (item.kind === 'thread' && f.ch.archived) {
      if (ctx.dry) rep.note = 'archived; would be unarchived';
      else if (!(await unarchiveIfNeeded(f.ch, (m) => ctx.log(`[provision] ${m}`)))) {
        rep.action = 'blocked'; rep.note = 'the thread is archived and could not be unarchived'; return rep;
      }
    }
    const value = f.ch ? f.ch.id : (f.ids || f.id);
    await commit(ctx, item, rep, value, 'adopted', f.ch ? f.ch.name : (item.titles && item.titles[0]), { force: forced });
    return rep;
  };

  const f1 = await find();
  if (f1.state === 'ambiguous') { rep.action = 'ambiguous'; rep.note = `several channels match: ${f1.candidates.join(', ')}`; rep.candidates = f1.candidates; return rep; }
  if (f1.state === 'found') return adoptFound(f1);
  if (f1.state === 'noguild') { rep.action = 'blocked'; rep.note = 'the Discord server is not known (set DISCORD_GUILD_ID)'; return rep; }
  if (level !== 'create') { rep.action = 'missing'; return rep; }

  // 4. Create.
  if (item.kind === 'channel') {
    if (!item.hub && !ctx.createChannels) { rep.action = 'missing'; return rep; }
    if (!ctx.dry && !(await guildCanManageChannels(ctx))) {
      rep.action = 'blocked'; rep.note = 'missing permission: Manage Channels (create the channel by hand, or grant it and re-run)'; return rep;
    }
    if (ctx.dry) { rep.action = 'create'; await commit(ctx, item, rep, `dry:${item.key}`, 'created', item.createName); return rep; }
    const f2 = await find();
    if (f2.state === 'ambiguous') { rep.action = 'ambiguous'; rep.candidates = f2.candidates; return rep; }
    if (f2.state === 'found') return adoptFound(f2);
    ctx.guildChannels = null;   // the scan above is stale the moment we create
    const ch = await createChannel(ctx, item);
    rep.action = 'create';
    await commit(ctx, item, rep, ch.id, 'created', ch.name, { force: forced });
    return rep;
  }

  if (item.kind === 'thread') {
    if (ctx.blockedParents.has(item.parentKey)) {
      rep.action = 'blocked'; rep.note = 'an earlier slot in its parent failed, so no thread is created above it'; return rep;
    }
    if (!parentIsDry) {
      const problem = permProblem(ctx, parentCh);
      if (problem) { rep.action = 'blocked'; rep.note = problem; return rep; }
      if (!parentCh.threads || typeof parentCh.threads.create !== 'function') { rep.action = 'blocked'; rep.note = 'its parent cannot host threads'; return rep; }
    }
    if (ctx.dry) { rep.action = 'create'; await commit(ctx, item, rep, `dry:${item.key}`, 'created', item.createName); return rep; }
    const f2 = await find();
    if (f2.state === 'found') return adoptFound(f2);
    const thread = await createThread(ctx, item, parentCh);
    ctx.chCache.set(thread.id, thread);
    rep.action = 'create';
    await commit(ctx, item, rep, thread.id, 'created', thread.name, { force: forced });
    return rep;
  }

  // message / text / boardSet
  if (!parentIsDry) {
    const problem = permProblem(ctx, container);
    if (problem) { rep.action = 'blocked'; rep.note = problem; return rep; }
    const elig = await slotEligibility(ctx, item, container);
    if (!elig.ok) { rep.action = 'blocked'; rep.note = elig.why; return rep; }
  } else if (item.prev && !resolvedOk(ctx.results.get(item.prev))) {
    rep.action = 'blocked'; rep.note = `blocked: the slot before it (${item.prev}) is not present`; return rep;
  }
  if (ctx.dry) { rep.action = 'create'; await commit(ctx, item, rep, item.kind === 'boardSet' ? Array.from({ length: item.count }, (_, i) => `dry:${item.key}:${i}`) : `dry:${item.key}`, 'created', item.titles && item.titles[0]); return rep; }
  const f2 = await find({ fresh: true });
  if (f2.state === 'found') return adoptFound(f2);
  const ids = await createSlot(ctx, item, container);
  rep.action = 'create';
  await commit(ctx, item, rep, item.kind === 'boardSet' ? ids : ids[0], 'created', item.titles && item.titles[0], { force: forced });
  return rep;
}

async function guardedItem(ctx, item) {
  try { return await processItem(ctx, item); }
  catch (e) {
    const rep = ctx.results.get(item.key) || { key: item.key, tier: item.tier };
    rep.action = 'error'; rep.note = (e && e.message) || String(e);
    ctx.results.set(item.key, rep);
    ctx.errors.push({ key: item.key, error: rep.note });
    if (item.phase === 'slot') ctx.blockedParents.add(item.parentKey);
    return rep;
  }
}

// Replace the thread-links placeholder with the real links once the threads exist.
async function fillThreadLinks(ctx) {
  const it = ctx.expanded.items.find(i => i.kind === 'text');
  if (!it || ctx.dry) return;
  const rep = ctx.results.get(it.key);
  if (!rep || !rep.id || rep.simulated || !['create', 'adopt', 'fill', 'fill-unverified'].includes(rep.action)) return;
  const c = await containerFor(ctx, it);
  if (c.state !== 'ok') return;
  try {
    const msg = await c.ch.messages.fetch(rep.id);
    const desired = threadLinksContent(ctx.expanded.eras, eraThreadIdFor(ctx));
    const cur = msg.content || '';
    if (cur === desired) return;
    if (!(rep.action === 'create' || cur.includes('(no thread)'))) return;
    await msg.edit({ content: desired, embeds: [], components: [] });
  } catch (e) { note(ctx, `thread-links fill failed: ${e && e.message}`); }
}

async function permissionPass(ctx) {
  const out = [];
  if (!ctx.client) return out;
  for (const it of ctx.expanded.items) {
    if (it.kind !== 'channel' || it.type === 'voice') continue;
    const r = ctx.results.get(it.key);
    if (!r || !r.id || r.simulated || r.action === 'skip') continue;
    const c = await channelState(ctx, r.id);
    if (c.state !== 'ok') continue;
    const p = checkPerms(c.ch, botMember(ctx), baseNeeds(ctx.pin));
    if (!p.ok) out.push({ key: it.key, id: r.id, missing: p.missing });
  }
  return out;
}

function finalize(ctx) {
  const items = [...ctx.results.values()];
  const keys = (pred) => items.filter(pred).map(r => r.key);
  const scoped = (r) => r.inScope === true && r.level !== 'skip' && r.level !== 'passive';
  const r = ctx.report;
  r.mode = ctx.mode; r.modeReason = ctx.modeReason; r.dryRun = ctx.dry; r.leaseHeld = ctx.leaseHeld;
  r.kv = ctx.kv.state;
  r.filled  = keys(i => i.action === 'fill' || i.action === 'fill-unverified');
  r.adopted = keys(i => i.action === 'adopt');
  r.created = keys(i => i.action === 'create');
  r.kept    = keys(i => i.action === 'keep');
  r.skipped = keys(i => i.action === 'skip');
  r.missing = keys(i => ['missing', 'blocked', 'ambiguous', 'error'].includes(i.action) && scoped(i));
  r.dead    = keys(i => i.dead);
  r.items = items;
  r.notes = ctx.notes; r.errors = ctx.errors;
  r.anchors = JSON.parse(JSON.stringify(ctx.anchors));
  r.external = ctx.expanded.external.map(e => ({ env: e.env, step: e.step, set: isSet(ctx.env[e.env]) }));
  return r;
}

/**
 * The engine. `opts`: { client, supabase|null, env, mode, dryRun, only, skip,
 * optional, createChannels, lock, pin, repair, layout, bosses, guildTag,
 * guildDir, abort, log, now }. Never throws for a Discord or kv failure: those
 * land in the report. Returns the report.
 */
async function provisionLayout(opts = {}) {
  const ctx = makeCtx(opts);
  ctx.report = { steps: [], perms: [] };
  ctx.counts = { filled: 0, adopted: 0, created: 0 };
  try {
    await loadKv(ctx);
    const kvKeys = ctx.kv.state === 'disabled' ? new Set()
      : ctx.kv.state === 'known' ? new Set(Object.keys(ctx.anchors)) : null;
    const m = resolveMode(ctx.requestedMode, ctx.env, { kvKeys, expanded: ctx.expanded, kvRecord: ctx.kv.record, skip: ctx.skip });
    ctx.mode = m.mode; ctx.modeReason = m.reason;
    if (ctx.mode === 'off') return finalize(ctx);

    if (!(await acquireLease(ctx))) return finalize(ctx);
    try {
      for (const phase of PHASE_ORDER) {
        if (ctx.abort.aborted) { note(ctx, 'stopped at the time bound; the next run picks up where it stopped'); break; }
        if (phase === 'fill') { ctx.report.steps.push('THREAD_LINKS_FILL'); await fillThreadLinks(ctx); continue; }
        for (const it of ctx.expanded.items.filter(i => i.phase === phase)) {
          if (ctx.abort.aborted) break;
          ctx.report.steps.push(it.key);
          await guardedItem(ctx, it);
        }
      }
      ctx.counts = {
        filled: [...ctx.results.values()].filter(r => r.action === 'fill' || r.action === 'fill-unverified').length,
        adopted: [...ctx.results.values()].filter(r => r.action === 'adopt').length,
        created: [...ctx.results.values()].filter(r => r.action === 'create').length,
      };
      ctx.report.perms = await permissionPass(ctx);
      // Mirrors of env/file anchors go in only when something changed. A run that
      // created or adopted something also stamps last_run with its final counts.
      await persist(ctx, { force: ctx.counts.created + ctx.counts.adopted > 0 });
    } finally { await releaseLease(ctx); }
  } catch (e) {
    ctx.errors.push({ key: '*', error: (e && e.message) || String(e) });
  }
  return finalize(ctx);
}

// ── Identity ─────────────────────────────────────────────────────────────────
/** Fill DISCORD_CLIENT_ID from the application and DISCORD_GUILD_ID when the bot
 *  is in exactly one server. Never overwrites. */
function deriveIdentity(client, env = process.env) {
  const out = { set: [], notes: [], guildId: null };
  const appId = client && client.application && client.application.id;
  if (!isSet(env.DISCORD_CLIENT_ID) && appId) { env.DISCORD_CLIENT_ID = String(appId); out.set.push('DISCORD_CLIENT_ID'); }
  const cache = client && client.guilds && client.guilds.cache;
  if (!isSet(env.DISCORD_GUILD_ID) && cache) {
    if (cache.size === 1) { env.DISCORD_GUILD_ID = String([...cache.values()][0].id); out.set.push('DISCORD_GUILD_ID'); }
    else if (cache.size > 1) out.notes.push(`the bot is in ${cache.size} servers: set DISCORD_GUILD_ID to choose one`);
    else out.notes.push('the bot is in no server yet: invite it first');
  }
  out.guildId = isSet(env.DISCORD_GUILD_ID) ? String(env.DISCORD_GUILD_ID) : null;
  return out;
}

function summaryLine(r, extra) {
  const miss = r.missing && r.missing.length ? r.missing.join(',') : '-';
  const perm = r.perms && r.perms.length ? r.perms.map(p => `${p.key}[${p.missing.join('+')}]`).join(',') : 'ok';
  return `[provision] mode=${r.mode} filled=${r.filled.length} adopted=${r.adopted.length} created=${r.created.length}`
    + ` missing=${miss} errors=${r.errors.length} kv=${r.kv} perms=${perm}${r.dryRun ? ' dry-run' : ''}${extra ? ' ' + extra : ''}`;
}

/**
 * ClientReady entry point. Derives identity, runs the mode's work bounded by a
 * 25 s race, logs ONE summary line, catches everything and never throws.
 */
async function bootProvision(client, opts = {}) {
  const env = opts.env || process.env;
  const log = opts.log || ((m) => console.log(m));
  try {
    const requested = String(opts.mode != null ? opts.mode : (env.GUILD_PROVISION || 'auto')).trim().toLowerCase();
    if (requested === 'off') return { mode: 'off' };
    const id = deriveIdentity(client, env);
    const abort = { aborted: false };
    const sb = opts.supabase !== undefined ? opts.supabase : require('./supabase');
    let timer;
    const bound = new Promise((resolve) => {
      timer = setTimeout(() => { abort.aborted = true; resolve({ timedOut: true }); }, opts.timeoutMs || BOOT_BOUND_MS);
      if (timer.unref) timer.unref();
    });
    const work = provisionLayout({ ...opts, client, env, supabase: sb, abort, mode: requested, log, boot: true });
    const out = await Promise.race([work, bound]);
    clearTimeout(timer);
    if (out && out.timedOut) { log(`[provision] stopped at the ${(opts.timeoutMs || BOOT_BOUND_MS) / 1000}s bound; the next boot picks up where it stopped (auto mode resumes an unfinished build)`); return { mode: requested, timedOut: true }; }
    log(summaryLine(out, id.set.length ? `identity=${id.set.join('+')}` : ''));
    for (const n of id.notes) log(`[provision] ${n}`);
    return out;
  } catch (e) {
    try { console.warn('[provision] failed:', e && e.message); } catch { /* nothing left to say */ }
    return { mode: 'error', error: e && e.message };
  }
}

// ── Status (read-only) ───────────────────────────────────────────────────────
/**
 * What is wired, where each id came from, which are dead, what the bot may not
 * do, and what a human still has to do. Reads only: no fill, no write.
 */
async function inspectLayout(opts = {}) {
  const ctx = makeCtx({ ...opts, mode: 'report', dryRun: true });
  await loadKv(ctx);
  const out = { identity: {}, items: [], missingRequired: [], missingPlatform: [], dead: [], perms: [], external: [],
    roles: { allowed: [], officer: [] }, invite: {}, kv: ctx.kv.state, notes: ctx.notes };
  const guild = await getGuild(ctx);
  out.identity = {
    guildId: isSet(ctx.env.DISCORD_GUILD_ID) ? String(ctx.env.DISCORD_GUILD_ID) : null,
    clientId: isSet(ctx.env.DISCORD_CLIENT_ID) ? String(ctx.env.DISCORD_CLIENT_ID) : null,
    guildName: guild ? guild.name : null,
  };
  for (const it of ctx.expanded.items) {
    const row = { key: it.key, tier: it.tier, group: it.group || null, kind: it.kind, label: it.label || it.id, source: 'missing', dead: null };
    const cur = isSet(ctx.env[it.key]) ? String(ctx.env[it.key]).trim() : '';
    const rec = ctx.anchors[it.key];
    let val = null;
    if (cur) { row.source = sourceOfEnv(ctx, it.key, cur); val = cur; }
    else if (rec && (rec.source === 'created' || rec.source === 'adopted')) { row.source = rec.source === 'created' ? 'kv-created' : 'kv-adopted'; val = joinIds(rec.ids || rec.id); }
    else if (rec) { row.source = 'kv-mirror'; }
    if (val != null) {
      if (it.kind === 'boardSet') row.ids = idsOf(val); else row.id = val;
      row.dead = ctx.client ? ((await verifyValue(ctx, it, val)).state === 'gone') : null;
      if (row.dead) out.dead.push(it.key);
      row.id = row.id || null;
      // a resolved id lets this item's children be verified
      ctx.results.set(it.key, { ...row, action: 'keep' });
    }
    out.items.push(row);
    if (row.source === 'missing' || row.dead) {
      if (it.tier === 'required') out.missingRequired.push(it.key);
      else if (it.tier === 'platform') out.missingPlatform.push(it.key);
    }
  }
  out.perms = await permissionPass(ctx);
  out.external = ctx.expanded.external.map(e => ({ env: e.env, step: e.step, set: isSet(ctx.env[e.env]) }));
  const roleNames = (list) => list.map(n => ({ name: n, exists: !!(guild && guild.roles && guild.roles.cache && [...guild.roles.cache.values()].some(r => r.name === n)) }));
  try {
    const roles = require('./roles');
    out.roles = { allowed: roleNames(roles.getAllowedRoles()), officer: roleNames(roles.getOfficerRoles()) };
  } catch { /* roles unavailable */ }
  out.invite = {
    standard: invitePermissions({ clientId: out.identity.clientId }),
    withChannels: invitePermissions({ channels: true, clientId: out.identity.clientId }),
  };
  return out;
}

function formatStatus(st) {
  const L = [];
  L.push(`Server: ${st.identity.guildName || st.identity.guildId || 'unknown'} · kv: ${st.kv}`);
  const by = (s) => st.items.filter(i => i.source === s).length;
  L.push(`Provenance: env ${by('env')}, file ${by('file')}, kv-adopted ${by('kv-adopted')}, kv-created ${by('kv-created')}, missing ${by('missing')}`);
  if (st.dead.length) L.push(`Dead ids (the thing was deleted): ${st.dead.join(', ')}`);
  if (st.missingRequired.length) L.push(`Missing, required: ${st.missingRequired.join(', ')}`);
  if (st.missingPlatform.length) L.push(`Missing, platform: ${st.missingPlatform.join(', ')}`);
  if (!st.missingRequired.length && !st.missingPlatform.length && !st.dead.length) L.push('Every required and platform anchor is wired.');
  for (const p of st.perms) L.push(`Permission gap in ${p.key}: ${p.missing.join(', ')}`);
  const roleLine = (name, rs) => rs.length ? `${name}: ${rs.map(r => `${r.name}${r.exists ? '' : ' (MISSING)'}`).join(', ')}` : null;
  for (const l of [roleLine('Roles that open the commands', st.roles.allowed), roleLine('Officer roles', st.roles.officer)]) if (l) L.push(l);
  for (const e of st.external.filter(x => !x.set)) L.push(`By hand: ${e.env}. ${e.step}`);
  if (st.invite.standard && st.invite.standard.url) {
    L.push(`Invite (permissions ${st.invite.standard.permissions}): ${st.invite.standard.url}`);
    L.push(`With Manage Channels (${st.invite.withChannels.permissions}) if the bot should create channels.`);
  } else if (st.invite.standard) {
    L.push(`Invite permission integer: ${st.invite.standard.permissions} (${st.invite.withChannels.permissions} with Manage Channels)`);
  }
  // Per-anchor provenance. An optional anchor nobody set is left out: it is not a gap.
  L.push('', 'Anchors (where each id came from):');
  for (const i of st.items.filter(x => x.source !== 'missing' || x.tier !== 'optional')) {
    const id = i.ids ? i.ids.join(',') : (i.id || '');
    L.push(`${i.key} [${i.tier}]: ${i.source}${i.dead ? ' (DEAD)' : ''}${id ? ' ' + id : ''}`);
  }
  return L.join('\n');
}

function formatReport(r) {
  const L = [`Mode: ${r.mode}${r.dryRun ? ' (dry run: nothing was changed)' : ''} · ${r.modeReason || ''}`.trim()];
  const row = (a, keys) => { if (keys && keys.length) L.push(`${a}: ${keys.join(', ')}`); };
  const verb = r.dryRun ? ['Would fill', 'Would adopt', 'Would create'] : ['Filled', 'Adopted', 'Created'];
  row(verb[0], r.filled); row(verb[1], r.adopted); row(verb[2], r.created);
  row('Kept (already set)', r.kept); row('Skipped', r.skipped);
  row('Still missing', r.missing); row('Dead ids', r.dead);
  for (const i of r.items.filter(x => x.note && ['blocked', 'ambiguous', 'error', 'missing'].includes(x.action))) L.push(`  ${i.key}: ${i.note}`);
  for (const p of r.perms) L.push(`Permission gap in ${p.key}: ${p.missing.join(', ')}`);
  for (const n of r.notes) L.push(`Note: ${n}`);
  for (const e of r.external.filter(x => !x.set)) L.push(`By hand: ${e.env}. ${e.step}`);
  return L.join('\n');
}

// ── Export ───────────────────────────────────────────────────────────────────
/** Every anchor key the layout knows, in one stable list. */
function allKeys(expanded) {
  return [
    ...expanded.items.map(i => i.key),
    ...expanded.selfHealing.map(s => s.env),
    ...expanded.external.map(e => e.env),
    ...expanded.derived.map(d => d.env),
  ].filter((k, i, a) => a.indexOf(k) === i);
}

/**
 * guild/discord.json and an env block. `values` is a { KEY: id|[ids] } map (a
 * report's anchors, or live env). Every layout key is present, null where
 * unprovisioned, and a secret-shaped key is dropped — the same refusal the
 * boot loader applies, so an export always round-trips through it.
 */
function buildExport(expanded, values = {}) {
  const json = { _comment: 'Discord anchors for this guild. Generated by the Discord provisioner; ids are not secrets. Keys the bot already has in env are left alone (env wins). Secret-shaped keys are refused by the loader on purpose.' };
  const lines = [];
  const unprovisioned = [];
  for (const key of allKeys(expanded).sort()) {
    if (SECRET_KEY_RE.test(key)) continue;
    const v = values[key];
    const has = v != null && (Array.isArray(v) ? v.length > 0 : isSet(v));
    if (has) { json[key] = Array.isArray(v) ? v.map(String) : String(v); lines.push(`${key}=${joinIds(v)}`); }
    else { json[key] = null; unprovisioned.push(key); }
  }
  if (unprovisioned.length) lines.push('', '# not provisioned: ' + unprovisioned.join(' '));
  return { json, jsonText: JSON.stringify(json, null, 2) + '\n', envText: lines.join('\n') + '\n' };
}

/** Value map from a report (anchors) overlaid on live env for non-anchor keys. */
function exportValues(expanded, report, env) {
  const values = {};
  for (const k of allKeys(expanded)) {
    const a = report && report.anchors && report.anchors[k];
    if (a) values[k] = a.ids || a.id;
    else if (isSet(env && env[k])) values[k] = String(env[k]).trim();
  }
  return values;
}

/**
 * What an export should carry right now: live env first, then whatever the kv
 * record holds (including mirrors of env/file values, which exist exactly so a
 * lost Railway variable can be recovered). Read-only.
 */
async function collectExportValues(opts = {}) {
  const ctx = makeCtx({ ...opts, mode: 'report', dryRun: true });
  await loadKv(ctx);
  const values = {};
  for (const k of allKeys(ctx.expanded)) {
    if (isSet(ctx.env[k])) values[k] = String(ctx.env[k]).trim();
    else if (ctx.anchors[k]) values[k] = ctx.anchors[k].ids || ctx.anchors[k].id;
  }
  return { expanded: ctx.expanded, values, kv: ctx.kv.state };
}

module.exports = {
  // engine
  provisionLayout, bootProvision, deriveIdentity, inspectLayout, collectExportValues,
  // layout + planning (pure)
  loadLayout, loadBosses, listEras, eraInfo, expandLayout, planSteps, resolveMode, allowedAction,
  optionsFromEnv, matchByName, norm, slotInfo, allKeys,
  // markers + placeholders
  markerFor, parseMarker, isThreadLinksMsg, threadLinksContent, placeholderEmbed, pickSlotMessage, fetchBotMessages,
  // permissions
  checkPerms, invitePermissions, baseNeeds,
  // output
  formatReport, formatStatus, buildExport, exportValues, summaryLine,
  // constants
  SECRET_KEY_RE, KV_KEY, LOCK_KEY, LOCK_TTL_MS, BOOT_BOUND_MS, MARKER_PREFIX, PHASE_ORDER,
};
