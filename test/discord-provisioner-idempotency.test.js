// test/discord-provisioner-idempotency.test.js — a second run changes nothing.
//
// The provisioner posts into a guild people live in, on a host (Railway) whose
// disk does not persist, from a process that restarts mid-run. So the property
// that matters is not "it builds the layout" but "run it again, or run it half
// way, or run it twice at once, and still exactly one of everything". Each case
// below is a way that has gone wrong elsewhere on this platform (duplicate
// posts from a lost id, a bare catch that turned a failed edit into a repost,
// null read as absence). All against a fake Discord and a fake bot_kv: no network.
//
// Run: npx vitest run test/discord-provisioner-idempotency.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './_source-slice.js';
import { makeWorld, makeSupabase, apiError, quiet } from './_fake-discord-world.js';

const require = createRequire(import.meta.url);
const prov = require(path.join(ROOT, 'utils', 'discordProvisioner.js'));
const { buildExpansionPanels } = require(path.join(ROOT, 'utils', 'board.js'));

const bosses = prov.loadBosses();
const expanded = prov.expandLayout(prov.loadLayout(), { bosses });
const ANCHOR_KEYS = expanded.items.map(i => i.key);
const ERA_PANELS = prov.listEras(bosses).map(e => ({ era: e, n: buildExpansionPanels(e, bosses, {}).length }));

const fresh = (world, extra = {}) => ({ DISCORD_GUILD_ID: world.guildId, ...extra });
const run = (world, sb, env, over = {}) =>
  prov.provisionLayout({ client: world.client, supabase: sb, env, mode: 'create', log: quiet, ...over });
// Reads are free; what must not move on a re-run is every WRITE.
const snapshot = (world) => { const { fetches, archivedFetches, pageFetches, ...rest } = world.stats; void fetches; void archivedFetches; void pageFetches; return rest; };
const writes = (s) => s.sends + s.channelCreates + s.threadCreates + s.edits + s.deletes + s.unarchives + s.pins;
const anchors = (env) => Object.fromEntries(ANCHOR_KEYS.filter(k => env[k] != null).map(k => [k, env[k]]));

describe('the second run', () => {
  it('performs zero creates, zero sends and zero edits, with the same ids', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const env1 = fresh(world);
    await run(world, sb, env1);
    expect(Object.keys(anchors(env1)).length).toBeGreaterThanOrEqual(21);   // hub, 4 slots, historic, 5 eras x (thread+cooldown+boards)
    const before = snapshot(world);
    const env2 = fresh(world);                                              // a restart: env is empty again
    const r2 = await run(world, sb, env2);
    expect(snapshot(world)).toEqual(before);
    expect(anchors(env2)).toEqual(anchors(env1));
    expect(r2.created).toEqual([]);
    expect(r2.errors).toEqual([]);
  });

  it('with the kv wiped between runs still creates nothing and lands on the same ids', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const env1 = fresh(world);
    await run(world, sb, env1);
    sb.rows.clear();
    const before = snapshot(world);
    const env2 = fresh(world);
    const r2 = await run(world, sb, env2);
    expect(snapshot(world)).toEqual(before);
    expect(anchors(env2)).toEqual(anchors(env1));
    expect(r2.created).toEqual([]);
    expect(r2.adopted).toEqual(expect.arrayContaining(['TIMER_CHANNEL_ID', 'SUMMARY_MESSAGE_ID', 'THREAD_LINKS_MESSAGE_ID', 'CLASSIC_THREAD_ID', 'CLASSIC_COOLDOWN_ID', 'CLASSIC_BOARD_IDS']));
    // and it rebuilt the record it lost
    expect(Object.keys(sb.record().anchors)).toEqual(expect.arrayContaining(['TIMER_CHANNEL_ID', 'CLASSIC_BOARD_IDS']));
  });

  it('with no database at all, a restart adopts instead of rebuilding', async () => {
    const world = makeWorld();
    const env1 = fresh(world);
    await run(world, null, env1);
    const before = snapshot(world);
    const env2 = fresh(world);
    const r2 = await run(world, null, env2);
    expect(snapshot(world)).toEqual(before);
    expect(anchors(env2)).toEqual(anchors(env1));
    expect(r2.kv).toBe('disabled');
  });

  it('still finds the cards after the bot has edited them (footer gone, title kept)', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const env1 = fresh(world);
    await run(world, sb, env1);
    // what /board does to a placeholder: replace its embed with the real card (no marker footer)
    for (const m of world.messagesIn(env1.TIMER_CHANNEL_ID).filter(x => x.embeds.length)) {
      await m.edit({ embeds: [{ data: { title: m.embeds[0].title, description: 'real card' } }] });
    }
    for (const t of ['CLASSIC_THREAD_ID', 'POP_THREAD_ID']) {
      for (const m of world.messagesIn(env1[t])) await m.edit({ embeds: [{ data: { title: m.embeds[0].title, description: 'real card' } }] });
    }
    sb.rows.clear();
    const before = snapshot(world);
    const env2 = fresh(world);
    const r2 = await run(world, sb, env2);
    expect(snapshot(world).sends).toBe(before.sends);
    expect(snapshot(world).threadCreates).toBe(before.threadCreates);
    expect(anchors(env2)).toEqual(anchors(env1));
    expect(r2.created).toEqual([]);
  });
});

describe('the kv', () => {
  it('records every id in the documented shape', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const env = fresh(world);
    await run(world, sb, env);
    const rec = sb.record();
    expect(rec.v).toBe(1);
    expect(rec.discord_guild_id).toBe(world.guildId);
    expect(Date.parse(rec.saved_at)).not.toBeNaN();
    expect(rec.last_run.mode).toBe('create');
    expect(rec.last_run.counts.created).toBeGreaterThan(20);
    expect(rec.anchors.TIMER_CHANNEL_ID).toMatchObject({ id: env.TIMER_CHANNEL_ID, kind: 'channel', source: 'created', name: 'raid-mobs', parent: null });
    expect(rec.anchors.CLASSIC_THREAD_ID).toMatchObject({ kind: 'thread', source: 'created', parent: 'TIMER_CHANNEL_ID' });
    expect(rec.anchors.SUMMARY_MESSAGE_ID).toMatchObject({ kind: 'message', source: 'created', parent: 'TIMER_CHANNEL_ID' });
    expect(rec.anchors.CLASSIC_BOARD_IDS.ids).toEqual(env.CLASSIC_BOARD_IDS.split(','));
    expect(rec.anchors.CLASSIC_BOARD_IDS.kind).toBe('messages');
    expect(Date.parse(rec.anchors.CLASSIC_THREAD_ID.at)).not.toBeNaN();
    // and env got the same strings
    expect(env.CLASSIC_THREAD_ID).toBe(rec.anchors.CLASSIC_THREAD_ID.id);
  });

  it('writes each id right after it succeeds, so a crash loses at most the one in flight', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    world.failSendOn = 3;   // dies creating the third slot
    await run(world, sb, fresh(world));
    const keys = Object.keys(sb.record().anchors);
    expect(keys).toEqual(expect.arrayContaining(['TIMER_CHANNEL_ID', 'SUMMARY_MESSAGE_ID', 'SPAWNING_TOMORROW_MESSAGE_ID']));
    expect(keys).not.toContain('DAILY_SUMMARY_MESSAGE_ID');
  });

  it('retries a failed write three times, then says so and carries on', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const real = sb.upsert; let calls = 0;
    sb.upsert = async (...a) => (++calls <= 2 ? null : real(...a));
    const env = fresh(world);
    await run(world, sb, env, { only: new Set(['TIMER_CHANNEL_ID']) });
    expect(sb.record().anchors.TIMER_CHANNEL_ID.id).toBe(env.TIMER_CHANNEL_ID);   // third try landed

    const w2 = makeWorld(); const sb2 = makeSupabase();
    let n = 0; sb2.upsert = async () => { n++; return null; };
    const env2 = fresh(w2);
    const r2 = await run(w2, sb2, env2, { only: new Set(['TIMER_CHANNEL_ID']) });
    expect(n).toBeGreaterThanOrEqual(3);
    expect(env2.TIMER_CHANNEL_ID).toBeTruthy();                                    // env is set first, kv failing does not undo it
    expect(r2.notes.join(' ')).toMatch(/kv write failed/);
  });

  it('an unreadable kv: report and adopt create nothing, and nothing is written to it', async () => {
    for (const mode of ['report', 'adopt']) {
      const world = makeWorld(); const sb = makeSupabase(); sb.down = true;
      const env = fresh(world);
      const r = await run(world, sb, env, { mode });
      expect(writes(world.stats)).toBe(0);
      expect(sb.rows.size).toBe(0);
      expect(r.kv).toBe('unknown');
    }
  });

  it('an unreadable kv in create mode still creates once, because Discord is the proof of absence', async () => {
    const world = makeWorld(); const sb = makeSupabase(); sb.down = true;
    const env1 = fresh(world);
    const r1 = await run(world, sb, env1);
    expect(world.stats.channelCreates).toBe(1);
    expect(world.stats.threadCreates).toBe(6);
    expect(r1.kv).toBe('unknown');
    expect(sb.rows.size).toBe(0);                   // never writes what it could not read
    const before = snapshot(world);
    await run(world, sb, fresh(world));
    expect(snapshot(world)).toEqual(before);        // and the second outage run adopts
  });

  it('create mode with Supabase disabled creates once, and the second boot adopts', async () => {
    const world = makeWorld(); const sb = makeSupabase({ enabled: false });
    const env1 = fresh(world);
    await run(world, sb, env1);
    expect(world.stats.channelCreates).toBe(1);
    expect(sb.writes).toBe(0);
    const before = snapshot(world);
    const env2 = fresh(world);
    await run(world, sb, env2);
    expect(snapshot(world)).toEqual(before);
    expect(anchors(env2)).toEqual(anchors(env1));
  });

  it('an unreadable kv makes auto resolve to report, never create', async () => {
    const world = makeWorld(); const sb = makeSupabase(); sb.down = true;
    const r = await prov.provisionLayout({ client: world.client, supabase: sb, env: fresh(world), log: quiet });   // mode: auto
    expect(r.mode).toBe('report');
    expect(writes(world.stats)).toBe(0);
  });
});

describe('what already exists', () => {
  it('an archived thread is unarchived and adopted', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const t = world.addThread(hub.id, { name: 'Ruins of Kunark', archived: true });
    const env = fresh(world);
    const r = await run(world, null, env, { mode: 'adopt' });
    expect(env.KUNARK_THREAD_ID).toBe(t.id);
    expect(t.archived).toBe(false);
    expect(world.stats.unarchives).toBe(1);
    expect(r.adopted).toContain('KUNARK_THREAD_ID');
    expect(world.stats.threadCreates).toBe(0);
  });

  it('a dry run leaves an archived thread archived', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const t = world.addThread(hub.id, { name: 'Kunark', archived: true });
    await run(world, null, fresh(world), { mode: 'adopt', dryRun: true });
    expect(t.archived).toBe(true);
    expect(world.stats.unarchives).toBe(0);
  });

  it('duplicate same-name threads adopt the lowest id and delete nothing', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const first = world.addThread(hub.id, { name: 'Classic' });
    world.addThread(hub.id, { name: 'Classic' });
    world.addThread(hub.id, { name: 'classic' });
    const env = fresh(world);
    const r = await run(world, null, env, { mode: 'adopt' });
    expect(env.CLASSIC_THREAD_ID).toBe(first.id);
    expect(world.stats.deletes).toBe(0);
    expect(r.items.find(i => i.key === 'CLASSIC_THREAD_ID').note).toMatch(/duplicate/);
  });

  it('duplicate cards: the earliest wins and none is deleted', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const title = '📊 Active Cooldowns';
    const a = world.addBotMessage(hub.id, { embeds: [{ data: { title } }] });
    world.addBotMessage(hub.id, { embeds: [{ data: { title } }] });
    const env = fresh(world);
    await run(world, null, env, { mode: 'adopt' });
    expect(env.SUMMARY_MESSAGE_ID).toBe(a.id);
    expect(world.stats.deletes).toBe(0);
  });

  it('a populated thread cannot have slots inserted above its history: adopted, reported, left alone', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const t = world.addThread(hub.id, { name: 'Classic' });
    world.addHumanMessage(t.id, { content: 'chatter' });
    const env = fresh(world);
    const r = await run(world, null, env);
    expect(env.CLASSIC_THREAD_ID).toBe(t.id);
    const cd = r.items.find(i => i.key === 'CLASSIC_COOLDOWN_ID');
    expect(cd.action).toBe('blocked');
    expect(cd.note).toMatch(/not at top/);
    expect(world.messagesIn(t.id)).toHaveLength(1);   // nothing was posted under the chatter
    expect(env.CLASSIC_COOLDOWN_ID).toBeUndefined();
    expect(env.KUNARK_COOLDOWN_ID).toBeTruthy();       // a fresh thread beside it is unaffected
  });

  it('an existing hub with chatter in it: slots are not posted under the chatter either', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    world.addHumanMessage(hub.id, { content: 'hello' });
    const env = fresh(world);
    const r = await run(world, null, env);
    expect(r.items.find(i => i.key === 'SUMMARY_MESSAGE_ID').note).toMatch(/not at top/);
    expect(world.messagesIn(hub.id).filter(m => m.author.id === 'bot-1' && m.type === 0)).toHaveLength(0);
    expect(env.CLASSIC_THREAD_ID).toBeTruthy();       // the threads themselves still get made
  });
});

describe('a run that dies half way', () => {
  it('a throw on the third send leaves two cards, no threads, and the re-run resumes in order', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    world.failSendOn = 3;
    const env1 = fresh(world);
    const r1 = await run(world, sb, env1);
    const hubId = env1.TIMER_CHANNEL_ID;
    expect(r1.errors).toHaveLength(1);
    expect(r1.errors[0].key).toBe('DAILY_SUMMARY_MESSAGE_ID');
    expect(world.messagesIn(hubId).map(m => m.embeds[0].title)).toEqual(['📊 Active Cooldowns', '🌅 Spawning in the Next 24 Hours']);
    expect(world.stats.threadCreates).toBe(0);   // no thread notice may land above a missing card
    expect(r1.items.find(i => i.key === 'THREAD_LINKS_MESSAGE_ID').action).toBe('blocked');
    expect(r1.items.find(i => i.key === 'CLASSIC_THREAD_ID').action).toBe('blocked');

    world.failSendOn = null;
    const env2 = fresh(world);
    const r2 = await run(world, sb, env2);
    expect(r2.errors).toEqual([]);
    const msgs = world.messagesIn(hubId);
    expect(msgs.slice(0, 4).map(m => m.embeds[0] ? m.embeds[0].title : 'links')).toEqual(
      ['📊 Active Cooldowns', '🌅 Spawning in the Next 24 Hours', '📅 Daily Raid Summary', 'links']);
    expect(msgs.slice(4).every(m => m.type === 18)).toBe(true);
    expect(msgs.filter(m => m.type === 0)).toHaveLength(4);   // exactly one of each, none twice
    expect(world.stats.channelCreates).toBe(1);
    expect(env2.SUMMARY_MESSAGE_ID).toBe(env1.SUMMARY_MESSAGE_ID);
  });

  it('a throw part-way through a board set is resumed without posting any panel twice', async () => {
    const first = ERA_PANELS.findIndex(e => e.n >= 2);
    expect(first).toBeGreaterThanOrEqual(0);
    // sends: 4 main slots, then per era a cooldown card and its panels
    const before = ERA_PANELS.slice(0, first).reduce((a, e) => a + 1 + e.n, 0);
    const world = makeWorld(); const sb = makeSupabase();
    world.failSendOn = 4 + before + 1 + 2;   // the second panel of the first multi-panel era
    const env1 = fresh(world);
    const r1 = await run(world, sb, env1);
    const E = ERA_PANELS[first].era.toUpperCase();
    expect(r1.errors.map(e => e.key)).toEqual([`${E}_BOARD_IDS`]);
    expect(env1[`${E}_BOARD_IDS`]).toBeUndefined();   // a half set is not an anchor

    world.failSendOn = null;
    const env2 = fresh(world);
    const r2 = await run(world, sb, env2);
    expect(r2.errors).toEqual([]);
    const thread = world.messagesIn(env2[`${E}_THREAD_ID`]);
    expect(thread).toHaveLength(1 + ERA_PANELS[first].n);
    const feet = thread.map(m => m.embeds[0].footer.text);
    expect(new Set(feet).size).toBe(feet.length);      // no panel twice
    expect(env2[`${E}_BOARD_IDS`].split(',')).toHaveLength(ERA_PANELS[first].n);
  });
});

describe('two runs at once', () => {
  it('create once under the lease', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const envA = fresh(world), envB = fresh(world);
    const [a, b] = await Promise.all([run(world, sb, envA), run(world, sb, envB)]);
    expect(world.stats.channelCreates).toBe(1);
    expect(world.stats.threadCreates).toBe(6);
    expect([a.leaseHeld, b.leaseHeld].filter(Boolean)).toHaveLength(1);
    const hub = world.byName('raid-mobs');
    expect(hub).toHaveLength(1);
    expect(world.messagesIn(hub[0].id).filter(m => m.type === 0)).toHaveLength(4);
    // the loser changed nothing, so it holds no ids it invented
    const loser = a.leaseHeld ? envA : envB;
    expect(loser.TIMER_CHANNEL_ID).toBeUndefined();
  });

  it('release the lease when they finish, so the next run is not locked out', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    await run(world, sb, fresh(world));
    expect(sb.rows.has('wolfpack|discord_provision_lock')).toBe(false);
    const r = await run(world, sb, fresh(world));
    expect(r.leaseHeld).toBe(false);
  });

  it('stand down for a live lease and change nothing', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    sb.rows.set('wolfpack|discord_provision_lock', { guild_id: 'wolfpack', key: 'discord_provision_lock',
      value: { holder: 'someone-else', expires_at: new Date(Date.now() + 60_000).toISOString() } });
    const r = await run(world, sb, fresh(world));
    expect(r.leaseHeld).toBe(true);
    expect(writes(world.stats)).toBe(0);
    expect(sb.rows.get('wolfpack|discord_provision_lock').value.holder).toBe('someone-else');
  });

  it('take over a stale lease (a crashed run) and carry on', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    sb.rows.set('wolfpack|discord_provision_lock', { guild_id: 'wolfpack', key: 'discord_provision_lock',
      value: { holder: 'crashed', expires_at: new Date(Date.now() - 1000).toISOString() } });
    const r = await run(world, sb, fresh(world));
    expect(r.leaseHeld).toBe(false);
    expect(world.stats.channelCreates).toBe(1);
    expect(sb.rows.has('wolfpack|discord_provision_lock')).toBe(false);
  });

  it('use the guild tag it is given for the kv rows', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    await run(world, sb, fresh(world), { guildTag: 'otherguild' });
    expect(sb.record('otherguild')).toBeTruthy();
    expect(sb.record('wolfpack')).toBe(null);
  });
});

describe('ids that stopped being true', () => {
  it('a dead recorded thread is re-found by name when a replacement exists', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const env1 = fresh(world);
    await run(world, sb, env1);
    world.deleteChannel(env1.CLASSIC_THREAD_ID);
    const replacement = world.addThread(env1.TIMER_CHANNEL_ID, { name: 'Classic' });
    const before = snapshot(world);
    const env2 = fresh(world);
    const r2 = await run(world, sb, env2);
    expect(env2.CLASSIC_THREAD_ID).toBe(replacement.id);
    expect(world.stats.threadCreates).toBe(before.threadCreates);
    expect(r2.dead).toContain('CLASSIC_THREAD_ID');
    expect(sb.record().anchors.CLASSIC_THREAD_ID).toMatchObject({ id: replacement.id, source: 'adopted' });
    // its cards lived in the deleted thread, so they are made again in the empty replacement
    expect(world.messagesIn(replacement.id).length).toBeGreaterThanOrEqual(2);
    expect(env2.KUNARK_THREAD_ID).toBe(env1.KUNARK_THREAD_ID);
  });

  it('a dead recorded thread with no replacement is created again, once', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const env1 = fresh(world);
    await run(world, sb, env1);
    world.deleteChannel(env1.LUCLIN_THREAD_ID);
    const env2 = fresh(world);
    await run(world, sb, env2);
    expect(world.stats.threadCreates).toBe(7);
    expect(env2.LUCLIN_THREAD_ID).not.toBe(env1.LUCLIN_THREAD_ID);
    const env3 = fresh(world);
    const before = snapshot(world);
    await run(world, sb, env3);
    expect(snapshot(world)).toEqual(before);
    expect(env3.LUCLIN_THREAD_ID).toBe(env2.LUCLIN_THREAD_ID);
  });

  it('a 500 on the fetch is unknown, never gone: the id is kept and nothing is recreated', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const env1 = fresh(world);
    await run(world, sb, env1);
    const recBefore = JSON.stringify(sb.record().anchors);
    world.fetchErrors.set(env1.CLASSIC_THREAD_ID, apiError(0, 'Internal Server Error', 500));
    world.messageFetchErrors.set(env1.SUMMARY_MESSAGE_ID, apiError(0, 'Service Unavailable', 503));
    const before = snapshot(world);
    const env2 = fresh(world);
    const r2 = await run(world, sb, env2);
    expect(writes(world.stats)).toBe(writes(before));
    expect(world.stats.threadCreates).toBe(before.threadCreates);
    expect(r2.items.find(i => i.key === 'CLASSIC_THREAD_ID').action).toBe('fill-unverified');
    expect(r2.items.find(i => i.key === 'SUMMARY_MESSAGE_ID').action).toBe('fill-unverified');
    expect(env2.CLASSIC_THREAD_ID).toBe(env1.CLASSIC_THREAD_ID);   // the record is the best truth there is
    expect(JSON.stringify(sb.record().anchors)).toBe(recBefore);   // and it is not rewritten
    expect(r2.dead).toEqual([]);
  });
});

describe('what the operator owns', () => {
  it('env is never overwritten, in any mode', async () => {
    for (const mode of ['report', 'adopt', 'create']) {
      const world = makeWorld(); const sb = makeSupabase();
      const hub = world.addChannel({ name: 'raid-mobs' });
      world.addThread(hub.id, { name: 'Classic' });
      const env = fresh(world, { TIMER_CHANNEL_ID: hub.id, CLASSIC_THREAD_ID: 'operator-thread', SUMMARY_MESSAGE_ID: 'operator-card' });
      await run(world, sb, env, { mode });
      expect(env.CLASSIC_THREAD_ID).toBe('operator-thread');
      expect(env.SUMMARY_MESSAGE_ID).toBe('operator-card');
      expect(env.TIMER_CHANNEL_ID).toBe(hub.id);
    }
  });

  it('an env value is not even checked unless repair is asked for', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const before = world.stats.fetches;
    const env = fresh(world, { TIMER_CHANNEL_ID: hub.id, KUNARK_THREAD_ID: 'dead-thread' });
    const r = await run(world, null, env, { only: new Set(['KUNARK_THREAD_ID']) });
    expect(r.items.find(i => i.key === 'KUNARK_THREAD_ID')).toMatchObject({ action: 'keep', source: 'env' });
    expect(env.KUNARK_THREAD_ID).toBe('dead-thread');
    void before;
  });

  it('a file value is labelled file, and equally untouchable', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-guild-'));
    fs.writeFileSync(path.join(dir, 'discord.json'), JSON.stringify({ CLASSIC_THREAD_ID: 'file-thread', KUNARK_THREAD_ID: ['a', 'b'] }));
    const world = makeWorld();
    world.addChannel({ name: 'raid-mobs' });
    // index.js has already filled env from the file by the time the provisioner runs
    const env = fresh(world, { CLASSIC_THREAD_ID: 'file-thread', KUNARK_THREAD_ID: 'a,b', LUCLIN_THREAD_ID: 'by-hand' });
    const r = await run(world, null, env, { guildDir: dir });
    expect(r.items.find(i => i.key === 'CLASSIC_THREAD_ID')).toMatchObject({ action: 'keep', source: 'file' });
    expect(r.items.find(i => i.key === 'KUNARK_THREAD_ID').source).toBe('file');
    expect(r.items.find(i => i.key === 'LUCLIN_THREAD_ID').source).toBe('env');
    expect(env.CLASSIC_THREAD_ID).toBe('file-thread');
  });

  it('repair replaces a dead env id only when asked, and says the host still holds the old one', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const env1 = fresh(world, { TIMER_CHANNEL_ID: hub.id, VELIOUS_THREAD_ID: 'dead-thread' });
    await run(world, sb, env1);
    expect(env1.VELIOUS_THREAD_ID).toBe('dead-thread');

    const env2 = fresh(world, { TIMER_CHANNEL_ID: hub.id, VELIOUS_THREAD_ID: 'dead-thread' });
    const r2 = await run(world, sb, env2, { repair: true });
    expect(env2.VELIOUS_THREAD_ID).not.toBe('dead-thread');
    expect(world.channels.get(env2.VELIOUS_THREAD_ID).name).toBe('❄️ Scars of Velious');
    expect(r2.dead).toContain('VELIOUS_THREAD_ID');
    expect(r2.items.find(i => i.key === 'VELIOUS_THREAD_ID').note).toMatch(/no longer exists/);
  });

  it('a mirror row (env or file) never fills env: removing a variable to switch a feature off stays effective', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const t = world.addThread(hub.id, { name: 'Classic' });
    sb.rows.set('wolfpack|discord_anchors', { guild_id: 'wolfpack', key: 'discord_anchors', value: {
      v: 1, discord_guild_id: world.guildId, saved_at: new Date().toISOString(), last_run: { at: '', mode: 'report', counts: {} },
      anchors: {
        TIMER_CHANNEL_ID: { id: hub.id, kind: 'channel', source: 'env', at: 'x' },
        CLASSIC_THREAD_ID: { id: t.id, kind: 'thread', source: 'env', parent: 'TIMER_CHANNEL_ID', at: 'x' },
        KUNARK_THREAD_ID: { id: t.id, kind: 'thread', source: 'file', parent: 'TIMER_CHANNEL_ID', at: 'x' },
      } } });
    const env = fresh(world);
    const r = await run(world, sb, env, { mode: 'report' });
    expect(env.CLASSIC_THREAD_ID).toBeUndefined();
    expect(env.KUNARK_THREAD_ID).toBeUndefined();
    expect(env.TIMER_CHANNEL_ID).toBeUndefined();
    expect(r.filled).toEqual([]);
    // the stale mirrors are dropped from the record, not resurrected
    expect(Object.keys(sb.record().anchors)).toEqual([]);
  });

  it('a provisioner-owned row DOES fill an unset env in report mode', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const env1 = fresh(world);
    await run(world, sb, env1);
    const before = snapshot(world);
    const env2 = fresh(world);
    const r = await run(world, sb, env2, { mode: 'report' });
    expect(env2.CLASSIC_THREAD_ID).toBe(env1.CLASSIC_THREAD_ID);
    expect(env2.CLASSIC_BOARD_IDS).toBe(env1.CLASSIC_BOARD_IDS);
    expect(r.filled).toContain('TIMER_CHANNEL_ID');
    expect(snapshot(world)).toEqual(before);   // report fills from the record, never writes to Discord
  });

  it('mirrors env anchors into the kv, and writes again only when they change', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const mk = () => fresh(world, { TIMER_CHANNEL_ID: hub.id, CLASSIC_THREAD_ID: 'c-1' });
    await run(world, sb, mk(), { mode: 'report' });
    expect(sb.record().anchors.CLASSIC_THREAD_ID).toMatchObject({ id: 'c-1', source: 'env' });
    const w = sb.writes;
    await run(world, sb, mk(), { mode: 'report' });
    expect(sb.writes).toBe(w);                           // same hash, no write
    await run(world, sb, fresh(world, { TIMER_CHANNEL_ID: hub.id, CLASSIC_THREAD_ID: 'c-2' }), { mode: 'report' });
    expect(sb.writes).toBe(w + 1);
    expect(sb.record().anchors.CLASSIC_THREAD_ID.id).toBe('c-2');
  });

  it('a mirror whose variable was removed never fills env, but a created id on the same key still would', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const env1 = fresh(world);
    await run(world, sb, env1);
    const rec = sb.record();
    rec.anchors.POP_THREAD_ID.source = 'env';             // pretend this one was only ever an env mirror
    sb.rows.set('wolfpack|discord_anchors', { guild_id: 'wolfpack', key: 'discord_anchors', value: rec });
    const env2 = fresh(world);
    await run(world, sb, env2, { mode: 'report' });
    expect(env2.POP_THREAD_ID).toBeUndefined();
    expect(env2.LUCLIN_THREAD_ID).toBe(env1.LUCLIN_THREAD_ID);
  });
});

describe('a dry run', () => {
  it('performs no Discord write and no kv write, and does not touch env', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const hub = world.addChannel({ name: 'raid-mobs' });
    world.addThread(hub.id, { name: 'Classic', archived: true });
    const env = fresh(world);
    const r = await run(world, sb, env, { dryRun: true });
    expect(writes(world.stats)).toBe(0);
    expect(sb.writes).toBe(0);
    expect(sb.rows.size).toBe(0);
    expect(env).toEqual({ DISCORD_GUILD_ID: world.guildId });
    expect(r.dryRun).toBe(true);
    // but it says what it would do, children of a would-be-created parent included
    expect(r.adopted).toContain('TIMER_CHANNEL_ID');
    expect(r.adopted).toContain('CLASSIC_THREAD_ID');
    expect(r.created).toEqual(expect.arrayContaining(['SUMMARY_MESSAGE_ID', 'KUNARK_THREAD_ID', 'KUNARK_COOLDOWN_ID', 'KUNARK_BOARD_IDS']));
  });

  it('on a virgin guild plans the whole layout and writes nothing', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const r = await run(world, sb, fresh(world), { dryRun: true });
    expect(writes(world.stats)).toBe(0);
    expect(sb.writes).toBe(0);
    expect(r.created).toEqual(expect.arrayContaining(['TIMER_CHANNEL_ID', 'SUMMARY_MESSAGE_ID', 'CLASSIC_THREAD_ID', 'CLASSIC_COOLDOWN_ID', 'POP_BOARD_IDS']));
    expect(r.created.length).toBeGreaterThanOrEqual(21);
    // and does not hold the lease
    expect(sb.rows.size).toBe(0);
  });

  it('a real run after the dry run does what the dry run said', async () => {
    const world = makeWorld(); const sb = makeSupabase();
    const dry = await run(world, sb, fresh(world), { dryRun: true });
    const env = fresh(world);
    const real = await run(world, sb, env);
    expect(real.created.sort()).toEqual(dry.created.sort());
  });
});

describe('the summary', () => {
  it('lists what is still missing by key, and the steps a human has to take', async () => {
    const world = makeWorld();
    const r = await run(world, null, fresh(world));
    expect(r.missing).toEqual(expect.arrayContaining(['RAID_CHAT_CHANNEL_ID', 'OFFICER_CHAT_CHANNEL_ID', 'PARSES_LOG_THREAD_ID']));
    expect(r.missing).not.toContain('PVP_CHANNEL_ID');   // optional, not asked for
    expect(r.external.map(e => e.env)).toEqual(expect.arrayContaining(['FORUM_CHANNEL_ID', 'RAIDHELPER_BOT_ID']));
    expect(prov.formatReport(r)).toMatch(/By hand: FORUM_CHANNEL_ID/);
  });
});
