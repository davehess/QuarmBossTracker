// test/_fake-discord-world.js — a small in-memory Discord + Supabase for the
// provisioner tests. NOT a spec file (no `.test.`), so vitest never collects it.
//
// It models only what utils/discordProvisioner.js touches: one guild, channels
// with a thread manager and a message list, bot-authored messages with embeds,
// the permission model, the error codes Discord answers with (10003 / 10008),
// and a bot_kv table behind the supabase helper shape (select / upsert /
// insertIgnoreDuplicates / update / del). Every async call yields once so two
// concurrent runs genuinely interleave.
//
// Counters (world.stats) are what the idempotency tests assert on: a re-run
// must leave `sends`, `channelCreates`, `threadCreates` untouched.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PermissionFlagsBits: P, ChannelType: CT, MessageType } = require('discord.js');

export const BOT_ID = 'bot-1';
const tick = () => Promise.resolve();

export function apiError(code, message, status) {
  return Object.assign(new Error(message), { code, status: status || (code === 10003 || code === 10008 ? 404 : 500) });
}

export function makeWorld({ guildId = 'guild-1', guildName = 'Test Guild' } = {}) {
  let nextId = 1000;
  let nextTs = 1_000_000;
  const newId = () => String(++nextId);
  const world = {
    guildId,
    stats: { sends: 0, edits: 0, deletes: 0, channelCreates: 0, threadCreates: 0, unarchives: 0, pins: 0, fetches: 0 },
    created: { channels: [], threads: [] },
    channels: new Map(),        // id -> channel or thread
    denied: new Set(),          // PermissionFlagsBits names the bot lacks everywhere
    manageChannels: true,
    failSendOn: null,           // the Nth send (1-based, global) throws
    rejectLongArchive: false,   // threads.create with 10080 answers 400
    fetchErrors: new Map(),     // id -> error to throw from channels.fetch(id)
    messageFetchErrors: new Map(),
  };

  function perms() {
    return { has: (bit) => ![...world.denied].some(n => P[n] === bit) };
  }

  function makeMessages(container) {
    const list = [];   // oldest first
    container._list = list;
    return {
      async fetch(arg) {
        await tick(); world.stats.fetches++;
        if (typeof arg === 'string') {
          if (world.messageFetchErrors.has(arg)) throw world.messageFetchErrors.get(arg);
          const m = list.find(x => x.id === arg);
          if (!m) throw apiError(10008, 'Unknown Message');
          return m;
        }
        const { limit = 50, before } = arg || {};
        let rows = list.slice().reverse();               // newest first
        if (before) { const i = rows.findIndex(m => m.id === before); rows = i >= 0 ? rows.slice(i + 1) : rows; }
        return new Map(rows.slice(0, limit).map(m => [m.id, m]));
      },
    };
  }

  function mkMessage(container, payload, { authorId = BOT_ID, type = 0 } = {}) {
    const embeds = (payload.embeds || []).map(e => {
      const d = e.data || e;
      return { title: d.title, description: d.description, color: d.color, footer: d.footer ? { text: d.footer.text } : null };
    });
    const m = {
      id: newId(), author: { id: authorId }, embeds, content: payload.content || '', components: payload.components || [],
      createdTimestamp: ++nextTs, type, channelId: container.id,
      async edit(p) {
        await tick(); world.stats.edits++;
        if (container.archived) throw apiError(50083, 'Thread is archived', 400);
        if (p.embeds) m.embeds = p.embeds.map(e => { const d = e.data || e; return { title: d.title, description: d.description, color: d.color, footer: d.footer ? { text: d.footer.text } : null }; });
        if (p.content !== undefined) m.content = p.content;
        if (p.components !== undefined) m.components = p.components;
        return m;
      },
      async delete() {
        await tick(); world.stats.deletes++;
        const i = container._list.indexOf(m); if (i >= 0) container._list.splice(i, 1);
      },
      async pin() { await tick(); world.stats.pins++; mkMessage(container, {}, { authorId: BOT_ID, type: MessageType.ChannelPinnedMessage }); },
    };
    container._list.push(m);
    return m;
  }

  function attachSender(ch) {
    ch.send = async (payload) => {
      await tick();
      world.stats.sends++;
      if (world.failSendOn != null && world.stats.sends === world.failSendOn) throw apiError(50013, 'Missing Permissions', 403);
      if (ch.archived) ch.archived = false;
      return mkMessage(ch, payload);
    };
    ch.permissionsFor = () => perms();
  }

  function addThread(parent, { name, archived = false, id } = {}) {
    const t = {
      id: id || newId(), name, type: CT.PublicThread, parentId: parent.id, archived, locked: false, guildId,
      isThread: () => true,
      async setArchived(v) { await tick(); if (v === false) { t.archived = false; world.stats.unarchives++; } },
    };
    t.messages = makeMessages(t); attachSender(t);
    world.channels.set(t.id, t);
    parent._threads.push(t);
    return t;
  }

  function addChannel({ name, type = CT.GuildText, id } = {}) {
    const ch = { id: id || newId(), name, type, parentId: null, guildId, isThread: () => false, _threads: [] };
    ch.messages = makeMessages(ch); attachSender(ch);
    ch.threads = {
      async fetchActive() { await tick(); return { threads: new Map(ch._threads.filter(t => !t.archived).map(t => [t.id, t])) }; },
      async fetchArchived() { await tick(); return { threads: new Map(ch._threads.filter(t => t.archived).map(t => [t.id, t])), hasMore: false }; },
      async create(opts) {
        await tick();
        if (world.rejectLongArchive && opts.autoArchiveDuration === 10080) throw apiError(50035, 'Invalid Form Body', 400);
        world.stats.threadCreates++;
        const t = addThread(ch, { name: opts.name });
        t.createOpts = opts;
        world.created.threads.push(t);
        mkMessage(ch, {}, { authorId: BOT_ID, type: MessageType.ThreadCreated });   // the "started a thread" notice
        return t;
      },
    };
    world.channels.set(ch.id, ch);
    return ch;
  }

  const guild = {
    id: guildId, name: guildName,
    roles: { everyone: { id: guildId }, cache: new Map() },
    members: { me: { id: BOT_ID, permissions: { has: (bit) => (bit === P.ManageChannels ? world.manageChannels : true) } } },
    channels: {
      async fetch() { await tick(); return new Map([...world.channels.values()].filter(c => !c.isThread()).map(c => [c.id, c])); },
      async create(opts) {
        await tick();
        if (!world.manageChannels) throw apiError(50013, 'Missing Permissions', 403);
        world.stats.channelCreates++;
        const ch = addChannel({ name: opts.name, type: opts.type });
        ch.createOpts = opts;
        world.created.channels.push(ch);
        return ch;
      },
    },
  };
  world.guild = guild;
  world.client = {
    user: { id: BOT_ID }, application: { id: 'app-1' },
    guilds: { cache: new Map([[guildId, guild]]), async fetch(id) { await tick(); return id === guildId ? guild : null; } },
    channels: {
      async fetch(id) {
        await tick();
        if (world.fetchErrors.has(id)) throw world.fetchErrors.get(id);
        const c = world.channels.get(id);
        if (!c) throw apiError(10003, 'Unknown Channel');
        return c;
      },
    },
  };

  world.addChannel = addChannel;
  world.addThread = (parentId, opts) => addThread(world.channels.get(parentId), opts);
  world.addBotMessage = (containerId, payload) => mkMessage(world.channels.get(containerId), payload);
  world.addHumanMessage = (containerId, payload) => mkMessage(world.channels.get(containerId), payload, { authorId: 'human-1' });
  world.deleteChannel = (id) => {
    const c = world.channels.get(id);
    world.channels.delete(id);
    if (c && c.parentId && world.channels.get(c.parentId)) {
      const p = world.channels.get(c.parentId);
      p._threads = p._threads.filter(t => t.id !== id);
    }
  };
  world.messagesIn = (containerId) => world.channels.get(containerId)._list.slice();
  world.removeMessage = (containerId, mid) => { const l = world.channels.get(containerId)._list; const i = l.findIndex(m => m.id === mid); if (i >= 0) l.splice(i, 1); };
  world.byName = (name) => [...world.channels.values()].filter(c => c.name === name);
  world.stat = () => JSON.stringify(world.stats);
  return world;
}

// ── a bot_kv behind the supabase helper's shape ──────────────────────────────
function parseQs(qs) {
  const out = {};
  for (const part of String(qs || '').split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

export function makeSupabase({ enabled = true } = {}) {
  const rows = new Map();   // `${guild_id}|${key}` -> row
  const sb = {
    rows, down: false, enabled,
    writes: 0, reads: 0,
    isEnabled: () => sb.enabled,
    async select(table, qs) {
      await tick(); sb.reads++;
      if (sb.down) return null;
      const q = parseQs(qs);
      const r = rows.get(`${(q.guild_id || '').replace(/^eq\./, '')}|${(q.key || '').replace(/^eq\./, '')}`);
      return r ? [{ value: r.value }] : [];
    },
    async upsert(table, list) {
      await tick();
      if (sb.down) return null;
      sb.writes++;
      for (const r of list) rows.set(`${r.guild_id}|${r.key}`, JSON.parse(JSON.stringify(r)));
      return list;
    },
    async insertIgnoreDuplicates(table, list) {
      await tick();
      if (sb.down) return null;
      const out = [];
      for (const r of list) {
        const k = `${r.guild_id}|${r.key}`;
        if (rows.has(k)) continue;
        sb.writes++; rows.set(k, JSON.parse(JSON.stringify(r))); out.push(r);
      }
      return out;
    },
    async update(table, qs, body) {
      await tick();
      if (sb.down) return null;
      const q = parseQs(qs);
      const k = `${q.guild_id.replace(/^eq\./, '')}|${q.key.replace(/^eq\./, '')}`;
      const cur = rows.get(k);
      if (!cur) return [];
      const want = q['value->>holder'];
      if (want && cur.value.holder !== want.replace(/^eq\./, '')) return [];
      sb.writes++; rows.set(k, JSON.parse(JSON.stringify(body)));
      return [body];
    },
    async del(table, qs) {
      await tick();
      if (sb.down) return null;
      const q = parseQs(qs);
      const k = `${q.guild_id.replace(/^eq\./, '')}|${q.key.replace(/^eq\./, '')}`;
      const cur = rows.get(k);
      const want = q['value->>holder'];
      if (cur && (!want || cur.value.holder === want.replace(/^eq\./, ''))) { sb.writes++; rows.delete(k); }
      return null;
    },
    record(tag = 'wolfpack', key = 'discord_anchors') {
      const r = rows.get(`${tag}|${key}`);
      return r ? r.value : null;
    },
  };
  return sb;
}

export const quiet = () => {};
