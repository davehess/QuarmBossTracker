// test/discord-provisioner-plan.test.js — what the Discord provisioner PLANS.
//
// Guild kit slice 3 (docs/DESIGN-guild-kit.md §7). The pure half of
// utils/discordProvisioner.js: which eras exist, what each anchor may do in each
// mode, how auto resolves, how names match, in what order steps run. No network:
// a fake Discord world (test/_fake-discord-world.js) stands in for the client.
//
// Run: npx vitest run test/discord-provisioner-plan.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_source-slice.js';
import { makeWorld, makeSupabase, quiet } from './_fake-discord-world.js';

const require = createRequire(import.meta.url);
const prov = require(path.join(ROOT, 'utils', 'discordProvisioner.js'));
const { buildExpansionPanels } = require(path.join(ROOT, 'utils', 'board.js'));
const { EXPANSION_META } = require(path.join(ROOT, 'utils', 'config.js'));

const layout = prov.loadLayout();
const bosses = prov.loadBosses();
const expanded = prov.expandLayout(layout, { bosses });
const byKey = (k) => expanded.items.find(i => i.key === k);

describe('eras', () => {
  it('come from data/bosses.json, in EXPANSION_ORDER, and every shipped era has bosses', () => {
    expect(bosses.length).toBeGreaterThan(100);
    expect(prov.listEras(bosses)).toEqual(['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP']);
  });

  it('drops an era with no bosses, and counts a boss with no expansion as Luclin', () => {
    expect(prov.listEras([{ expansion: 'Kunark' }, { expansion: 'Classic' }])).toEqual(['Classic', 'Kunark']);
    expect(prov.listEras([{ name: 'no expansion field' }])).toEqual(['Luclin']);
    expect(prov.listEras([])).toEqual([]);
    // and the expansion keys follow: no PoP bosses, no PoP anchors
    const small = prov.expandLayout(layout, { bosses: [{ expansion: 'Kunark' }] });
    expect(small.items.some(i => i.key === 'POP_THREAD_ID')).toBe(false);
    expect(small.items.some(i => i.key === 'KUNARK_THREAD_ID')).toBe(true);
  });

  it('give every era a thread, a cooldown card and a board set named like the code reads them', () => {
    for (const era of prov.listEras(bosses)) {
      const E = era.toUpperCase();
      expect(byKey(`${E}_THREAD_ID`).kind).toBe('thread');
      expect(byKey(`${E}_COOLDOWN_ID`).kind).toBe('message');
      expect(byKey(`${E}_BOARD_IDS`).kind).toBe('boardSet');
      // the thread env key is the one utils/config.js reads
      expect(`${E}_THREAD_ID`).toBe(EXPANSION_META[era].envKey);
    }
  });

  it('size each board set to the real panel count, and at least one era needs more than one panel', () => {
    let multi = 0;
    for (const era of prov.listEras(bosses)) {
      const want = buildExpansionPanels(era, bosses, {}).length;
      const it = byKey(`${era.toUpperCase()}_BOARD_IDS`);
      expect(it.count).toBe(want);
      expect(it.titles).toHaveLength(want);
      if (want > 1) multi++;
    }
    expect(multi).toBeGreaterThan(0);   // a corpus of one-panel eras would prove nothing about the count
  });

  it('name the thread the way the board cards already say it, and adopt the bare era and the plain label', () => {
    const t = byKey('KUNARK_THREAD_ID');
    expect(t.createName).toBe(EXPANSION_META.Kunark.label);
    expect(t.names).toEqual([EXPANSION_META.Kunark.label, 'Kunark', 'Ruins of Kunark']);
    expect(byKey('CLASSIC_THREAD_ID').names).toContain('Classic EverQuest');
  });
});

describe('tier x mode matrix (allowedAction)', () => {
  const base = { optional: new Set(), skip: new Set(), createChannels: false, only: null };
  const act = (key, over) => prov.allowedAction(byKey(key), { mode: 'create', ...base, ...over });

  it('report is read-only for every tier', () => {
    for (const key of ['TIMER_CHANNEL_ID', 'RAID_CHAT_CHANNEL_ID', 'PVP_CHANNEL_ID', 'CLASSIC_THREAD_ID', 'SUMMARY_MESSAGE_ID']) {
      expect(act(key, { mode: 'report', optional: new Set(['pvp']) })).toBe('report');
    }
  });

  it('adopt finds required and platform anchors, and an optional one only when its group is named', () => {
    expect(act('TIMER_CHANNEL_ID', { mode: 'adopt' })).toBe('adopt');
    expect(act('RAID_CHAT_CHANNEL_ID', { mode: 'adopt' })).toBe('adopt');
    expect(act('PARSES_LOG_THREAD_ID', { mode: 'adopt' })).toBe('adopt');
    expect(act('PVP_CHANNEL_ID', { mode: 'adopt' })).toBe('report');
    expect(act('PVP_CHANNEL_ID', { mode: 'adopt', optional: new Set(['pvp']) })).toBe('adopt');
    expect(act('PVP_CHANNEL_ID', { mode: 'adopt', optional: new Set(['voice']) })).toBe('report');
  });

  it('create makes threads and cards, but a channel only with the channel switch', () => {
    expect(act('CLASSIC_THREAD_ID')).toBe('create');
    expect(act('SUMMARY_MESSAGE_ID')).toBe('create');
    expect(act('CLASSIC_BOARD_IDS')).toBe('create');
    expect(act('PARSES_LOG_THREAD_ID')).toBe('create');
    expect(act('RAID_CHAT_CHANNEL_ID')).toBe('adopt');
    expect(act('RAID_CHAT_CHANNEL_ID', { createChannels: true })).toBe('create');
  });

  it('the hub is the one channel create makes without the channel switch', () => {
    expect(byKey('TIMER_CHANNEL_ID').hub).toBe(true);
    expect(act('TIMER_CHANNEL_ID')).toBe('create');
    expect(act('RAID_MOBS_ARCHIVE_CHANNEL_ID')).toBe('adopt');
  });

  it('the officer channel is adopt-only even with every switch on', () => {
    expect(act('OFFICER_CHAT_CHANNEL_ID', { createChannels: true })).toBe('adopt');
  });

  it('an optional anchor is never created unless its group is named', () => {
    expect(act('PVP_KILLS_THREAD_ID')).toBe('report');
    expect(act('PVP_KILLS_THREAD_ID', { optional: new Set(['pvp']) })).toBe('create');
    expect(act('HATE_THREAD_ID', { optional: new Set(['pvp']) })).toBe('report');
    expect(act('HATE_THREAD_ID', { optional: new Set(['hate']) })).toBe('create');
    expect(act('PVP_CHANNEL_ID', { optional: new Set(['pvp']) })).toBe('adopt');
    expect(act('PVP_CHANNEL_ID', { optional: new Set(['pvp']), createChannels: true })).toBe('create');
  });

  it('skip wins over every mode, tier and switch', () => {
    const skip = new Set(['TIMER_CHANNEL_ID', 'CLASSIC_THREAD_ID', 'PVP_CHANNEL_ID']);
    for (const mode of ['report', 'adopt', 'create']) {
      for (const key of skip) {
        expect(act(key, { mode, skip, createChannels: true, optional: new Set(['pvp']) })).toBe('skip');
      }
    }
  });

  it('only: a key not named is passive (resolved for its children, never written)', () => {
    const only = new Set(['HISTORIC_KILLS_THREAD_ID']);
    expect(act('HISTORIC_KILLS_THREAD_ID', { only })).toBe('create');
    expect(act('TIMER_CHANNEL_ID', { only })).toBe('passive');
    expect(act('SUMMARY_MESSAGE_ID', { only })).toBe('passive');
  });

  it('every item in the layout has a tier the matrix understands', () => {
    for (const i of expanded.items) expect(['required', 'platform', 'optional']).toContain(i.tier);
    expect(expanded.items.filter(i => i.tier === 'optional').every(i => expanded.groups.includes(i.group))).toBe(true);
  });
});

describe('auto resolves from what exists', () => {
  const none = new Set();
  it('is report for a configured deployment (TIMER_CHANNEL_ID set), whatever the kv says', () => {
    expect(prov.resolveMode('auto', { TIMER_CHANNEL_ID: '1' }, { kvKeys: none, expanded }).mode).toBe('report');
    expect(prov.resolveMode(undefined, { TIMER_CHANNEL_ID: '1' }, { kvKeys: none, expanded }).mode).toBe('report');
    expect(prov.resolveMode('', { TIMER_CHANNEL_ID: '1' }, { kvKeys: null, expanded }).mode).toBe('report');
  });

  it('is create only for a provably virgin deployment', () => {
    expect(prov.resolveMode('auto', {}, { kvKeys: none, expanded }).mode).toBe('create');
    expect(prov.resolveMode('auto', { TIMER_CHANNEL_ID: '   ' }, { kvKeys: none, expanded }).mode).toBe('create');
  });

  it('is report when any era thread, main slot or the hub is set in env', () => {
    for (const key of ['CLASSIC_THREAD_ID', 'POP_THREAD_ID', 'SUMMARY_MESSAGE_ID', 'THREAD_LINKS_MESSAGE_ID']) {
      expect(prov.resolveMode('auto', { [key]: '9' }, { kvKeys: none, expanded }).mode, key).toBe('report');
    }
    // the Historic Kills thread is not one of the three the design names
    expect(prov.resolveMode('auto', { HISTORIC_KILLS_THREAD_ID: '9' }, { kvKeys: none, expanded }).mode).toBe('create');
  });

  it('is report when the kv already holds any of them', () => {
    expect(prov.resolveMode('auto', {}, { kvKeys: new Set(['LUCLIN_THREAD_ID']), expanded }).mode).toBe('report');
    expect(prov.resolveMode('auto', {}, { kvKeys: new Set(['TIMER_CHANNEL_ID']), expanded }).mode).toBe('report');
    // an anchor that is not one of those does not make a deployment non-virgin
    expect(prov.resolveMode('auto', {}, { kvKeys: new Set(['PVP_CHANNEL_ID']), expanded }).mode).toBe('create');
  });

  it('an unreadable kv is not proof of a virgin guild', () => {
    expect(prov.resolveMode('auto', {}, { kvKeys: null, expanded }).mode).toBe('report');
  });

  it('an explicit mode is taken as given, and off stays off', () => {
    for (const m of ['off', 'report', 'adopt', 'create']) expect(prov.resolveMode(m, { TIMER_CHANNEL_ID: '1' }, { expanded }).mode).toBe(m);
    expect(prov.resolveMode('CREATE', {}, { kvKeys: none, expanded }).mode).toBe('create');
    expect(prov.resolveMode('nonsense', { TIMER_CHANNEL_ID: '1' }, { expanded }).mode).toBe('report');
  });

  it('is what a real run does: a configured deployment writes nothing to Discord', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const env = { DISCORD_GUILD_ID: world.guildId, TIMER_CHANNEL_ID: hub.id };
    const r = await prov.provisionLayout({ client: world.client, supabase: null, env, log: quiet });
    expect(r.mode).toBe('report');
    expect(world.stats.sends + world.stats.channelCreates + world.stats.threadCreates + world.stats.edits).toBe(0);
    expect(env.CLASSIC_THREAD_ID).toBeUndefined();
  });

  it('is what a real run does: a virgin guild gets the hub, the cards and the threads', async () => {
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    const r = await prov.provisionLayout({ client: world.client, supabase: null, env, log: quiet });
    expect(r.mode).toBe('create');
    expect(world.stats.channelCreates).toBe(1);
    expect(world.stats.threadCreates).toBe(6);   // Historic Kills + five eras
    expect(env.TIMER_CHANNEL_ID).toBeTruthy();
  });
});

describe('GUILD_PROVISION_* env', () => {
  it('parses every switch', () => {
    const o = prov.optionsFromEnv({
      GUILD_PROVISION: 'Adopt', GUILD_PROVISION_OPTIONAL: 'pvp, Voice,,', GUILD_PROVISION_SKIP: 'LOOT_CHANNEL_ID, SLOP_CHANNEL_ID',
      GUILD_PROVISION_CREATE_CHANNELS: '1', GUILD_PROVISION_LOCK: 'readonly', GUILD_PROVISION_PIN: '1',
    });
    expect(o.mode).toBe('adopt');
    expect([...o.optional]).toEqual(['pvp', 'voice']);
    expect([...o.skip]).toEqual(['LOOT_CHANNEL_ID', 'SLOP_CHANNEL_ID']);
    expect(o.createChannels).toBe(true);
    expect(o.lock).toBe('readonly');
    expect(o.pin).toBe(true);
  });

  it('defaults are auto, nothing optional, no channels, no lock, no pin', () => {
    const o = prov.optionsFromEnv({});
    expect(o).toMatchObject({ mode: 'auto', createChannels: false, lock: 'none', pin: false });
    expect(o.optional.size).toBe(0);
    expect(o.skip.size).toBe(0);
    expect(prov.optionsFromEnv({ GUILD_PROVISION_LOCK: 'whatever' }).lock).toBe('none');
  });
});

describe('skip wins in a real run', () => {
  it('never fills, adopts or creates a skipped key', async () => {
    const world = makeWorld();
    world.addChannel({ name: 'raid-mobs' });
    const env = { DISCORD_GUILD_ID: world.guildId };
    const r = await prov.provisionLayout({
      client: world.client, supabase: null, env, mode: 'create', log: quiet,
      skip: new Set(['CLASSIC_THREAD_ID', 'SUMMARY_MESSAGE_ID']),
    });
    expect(env.CLASSIC_THREAD_ID).toBeUndefined();
    expect(env.SUMMARY_MESSAGE_ID).toBeUndefined();
    expect(r.skipped).toEqual(expect.arrayContaining(['CLASSIC_THREAD_ID', 'SUMMARY_MESSAGE_ID']));
    expect(world.byName('⚔️ Classic EverQuest')).toHaveLength(0);
    expect(env.KUNARK_THREAD_ID).toBeTruthy();   // the rest of the layout is unaffected
  });
});

describe('optional anchors in a real run', () => {
  it('are ignored unless named, and adopted when named', async () => {
    const world = makeWorld();
    world.addChannel({ name: 'raid-mobs' });
    const pvp = world.addChannel({ name: 'pvp' });
    const env1 = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env: env1, mode: 'adopt', log: quiet });
    expect(env1.PVP_CHANNEL_ID).toBeUndefined();
    const env2 = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env: env2, mode: 'adopt', optional: new Set(['pvp']), log: quiet });
    expect(env2.PVP_CHANNEL_ID).toBe(pvp.id);
  });

  it('are not created even in create mode with channels on, until named', async () => {
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', createChannels: true, log: quiet });
    expect(world.byName('pvp')).toHaveLength(0);
    expect(world.byName('raid-chat')).toHaveLength(1);   // platform tier: created with the channel switch
  });
});

describe('names, aliases and ambiguity', () => {
  const ch = (id, name) => ({ id, name });

  it('normalises case, punctuation and emoji decoration', () => {
    expect(prov.norm('🗡️│Raid-Mobs')).toBe('raid-mobs');
    expect(prov.norm('  raid mobs ')).toBe('raid-mobs');
    expect(prov.norm('⚔️ Classic EverQuest')).toBe('classic-everquest');
    expect(prov.norm('Roster - Active')).toBe('roster-active');
  });

  it('the first alias that matches anything wins, even over a later alias with a lower id', () => {
    const m = prov.matchByName([ch('1', 'boss-timers'), ch('2', 'raid-mobs')], ['raid-mobs', 'raid-timers', 'boss-timers']);
    expect(m.winner.id).toBe('2');
    expect(m.alias).toBe('raid-mobs');
  });

  it('two channels with the same name are ambiguous, never guessed', () => {
    const m = prov.matchByName([ch('10', 'raid-mobs'), ch('11', 'Raid-Mobs')], ['raid-mobs']);
    expect(m.winner).toBe(null);
    expect(m.ambiguous).toEqual(['10', '11']);
  });

  it('threads adopt the lowest id and report the others as duplicates', () => {
    const m = prov.matchByName([ch('30', 'Classic'), ch('20', 'Classic'), ch('25', 'classic')], ['Classic'], { lowestWins: true });
    expect(m.winner.id).toBe('20');
    expect(m.duplicates).toEqual(['25', '30']);
  });

  it('lowest id compares as a number, not as text', () => {
    const m = prov.matchByName([ch('9', 'x'), ch('10', 'x')], ['x'], { lowestWins: true });
    expect(m.winner.id).toBe('9');
  });

  it('finds nothing when nothing matches, and ignores empty aliases', () => {
    expect(prov.matchByName([ch('1', 'general')], ['raid-mobs', ''])).toMatchObject({ winner: null, ambiguous: null });
  });

  it('an era thread is adopted under its label, its bare era name or its plain label', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    world.addThread(hub.id, { name: 'Classic' });
    world.addThread(hub.id, { name: 'Ruins of Kunark' });
    world.addThread(hub.id, { name: EXPANSION_META.Velious.label });
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'adopt', log: quiet });
    expect(env.CLASSIC_THREAD_ID).toBeTruthy();
    expect(env.KUNARK_THREAD_ID).toBeTruthy();
    expect(env.VELIOUS_THREAD_ID).toBeTruthy();
    expect(env.LUCLIN_THREAD_ID).toBeUndefined();
  });

  it('two channels that both match the hub leave it unset and say why', async () => {
    const world = makeWorld();
    world.addChannel({ name: 'raid-mobs' });
    world.addChannel({ name: 'raid-mobs' });
    const env = { DISCORD_GUILD_ID: world.guildId };
    const r = await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    expect(env.TIMER_CHANNEL_ID).toBeUndefined();
    expect(r.items.find(i => i.key === 'TIMER_CHANNEL_ID').action).toBe('ambiguous');
    expect(world.stats.channelCreates).toBe(0);   // an ambiguous match is not a reason to make a third
    expect(r.missing).toContain('TIMER_CHANNEL_ID');
  });

  it('adopts a channel under a lower-priority alias rather than creating a new hub', async () => {
    const world = makeWorld();
    const t = world.addChannel({ name: 'raid-timers' });
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    expect(env.TIMER_CHANNEL_ID).toBe(t.id);
    expect(world.stats.channelCreates).toBe(0);
  });

  it('a voice channel is never adopted as a text anchor', async () => {
    const world = makeWorld();
    world.addChannel({ name: 'raid-mobs', type: 2 });
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'adopt', log: quiet });
    expect(env.TIMER_CHANNEL_ID).toBeUndefined();
  });
});

describe('markers', () => {
  it('round-trip, with and without a board index', () => {
    expect(prov.markerFor('SUMMARY_MESSAGE_ID')).toBe('wp:slot:SUMMARY_MESSAGE_ID');
    expect(prov.markerFor('CLASSIC_BOARD_IDS', 2)).toBe('wp:slot:CLASSIC_BOARD_IDS:2');
    expect(prov.parseMarker(prov.markerFor('SUMMARY_MESSAGE_ID'))).toEqual({ key: 'SUMMARY_MESSAGE_ID', idx: null });
    expect(prov.parseMarker(prov.markerFor('POP_BOARD_IDS', 0))).toEqual({ key: 'POP_BOARD_IDS', idx: 0 });
    expect(prov.parseMarker('Updated automatically')).toBe(null);
    expect(prov.parseMarker('wp:slot:')).toBe(null);
    expect(prov.parseMarker(null)).toBe(null);
  });

  it('every key in the layout survives the round trip', () => {
    for (const i of expanded.items.filter(x => x.phase === 'slot' || x.phase === 'eraSlot')) {
      expect(prov.parseMarker(prov.markerFor(i.key, i.kind === 'boardSet' ? 0 : null)).key).toBe(i.key);
    }
  });
});

describe('step order', () => {
  const steps = prov.planSteps(expanded);
  const idx = (pred) => steps.map((s, i) => (pred(s) ? i : -1)).filter(i => i >= 0);

  it('is parents, then main slots, then threads, then the links fill, then each thread\'s own slots', () => {
    const parents = idx(s => s.phase === 'parent');
    const slots   = idx(s => s.phase === 'slot');
    const threads = idx(s => s.phase === 'thread');
    const fill    = idx(s => s.phase === 'fill');
    const eraSlot = idx(s => s.phase === 'eraSlot');
    for (const [a, b] of [[parents, slots], [slots, threads], [threads, fill], [fill, eraSlot]]) {
      expect(a.length).toBeGreaterThan(0);
      expect(Math.max(...a)).toBeLessThan(Math.min(...b));
    }
  });

  it('puts the four main slots in the order the board posts them', () => {
    expect(steps.filter(s => s.phase === 'slot').map(s => s.key)).toEqual([
      'SUMMARY_MESSAGE_ID', 'SPAWNING_TOMORROW_MESSAGE_ID', 'DAILY_SUMMARY_MESSAGE_ID', 'THREAD_LINKS_MESSAGE_ID']);
  });

  it('puts each era\'s cooldown card before its boards', () => {
    for (const era of prov.listEras(bosses)) {
      const E = era.toUpperCase();
      expect(steps.findIndex(s => s.key === `${E}_COOLDOWN_ID`)).toBeLessThan(steps.findIndex(s => s.key === `${E}_BOARD_IDS`));
    }
  });

  it('is the order a real run executes', async () => {
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    const r = await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    expect(r.steps).toEqual(steps.map(s => s.key));
  });

  it('lands the thread-created notices BELOW the four slot cards in the hub', async () => {
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    const msgs = world.messagesIn(env.TIMER_CHANNEL_ID);
    expect(msgs).toHaveLength(4 + 6);
    expect(msgs.slice(0, 4).every(m => m.type === 0)).toBe(true);
    expect(msgs.slice(4).every(m => m.type === 18)).toBe(true);
  });

  it('creates the cooldown placeholder first, then the board panels, inside an era thread', async () => {
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    const msgs = world.messagesIn(env.VELIOUS_THREAD_ID);
    const panels = buildExpansionPanels('Velious', bosses, {});
    expect(msgs).toHaveLength(1 + panels.length);
    expect(msgs[0].embeds[0].footer.text).toBe('wp:slot:VELIOUS_COOLDOWN_ID');
    msgs.slice(1).forEach((m, i) => {
      expect(m.embeds[0].footer.text).toBe(`wp:slot:VELIOUS_BOARD_IDS:${i}`);
      expect(m.embeds[0].title).toBe(panels[i].payload.embeds[0].data.title);
    });
  });
});

describe('creating a thread', () => {
  it('asks for a seven-day auto-archive, and a 400 from Discord means try one day instead', async () => {
    const w1 = makeWorld();
    await prov.provisionLayout({ client: w1.client, supabase: null, env: { DISCORD_GUILD_ID: w1.guildId }, mode: 'create', log: quiet });
    expect(w1.created.threads.every(t => t.createOpts.autoArchiveDuration === 10080)).toBe(true);

    const w2 = makeWorld();
    w2.rejectLongArchive = true;
    const env2 = { DISCORD_GUILD_ID: w2.guildId };
    const r = await prov.provisionLayout({ client: w2.client, supabase: null, env: env2, mode: 'create', log: quiet });
    expect(r.errors).toEqual([]);
    expect(w2.created.threads).toHaveLength(6);
    expect(w2.created.threads.every(t => t.createOpts.autoArchiveDuration === 1440)).toBe(true);
    expect(env2.CLASSIC_THREAD_ID).toBeTruthy();
  });

  it('makes a public thread, named like the card says, clipped to Discord\'s 100 characters', async () => {
    const long = JSON.parse(JSON.stringify(layout));
    long.threads.find(t => t.id === 'historicKills').names = ['H'.repeat(150)];
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', layout: long, log: quiet });
    const t = world.channels.get(env.HISTORIC_KILLS_THREAD_ID);
    expect(t.name).toBe('H'.repeat(100));
    expect(t.createOpts.type).toBe(11);   // PublicThread
    const classic = world.channels.get(env.CLASSIC_THREAD_ID);
    expect(classic.name).toBe(EXPANSION_META.Classic.label);
  });
});

describe('the hub channel', () => {
  it('is only created when the bot may manage channels, and the refusal names the permission', async () => {
    const world = makeWorld();
    world.manageChannels = false;
    const env = { DISCORD_GUILD_ID: world.guildId };
    const r = await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    expect(world.stats.channelCreates).toBe(0);
    const hub = r.items.find(i => i.key === 'TIMER_CHANNEL_ID');
    expect(hub.action).toBe('blocked');
    expect(hub.note).toMatch(/Manage Channels/);
    expect(env.TIMER_CHANNEL_ID).toBeUndefined();
    expect(world.stats.sends).toBe(0);
  });

  it('is locked read-only only when asked, and only a channel the bot owns', async () => {
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', lock: 'readonly', createChannels: true, log: quiet });
    const hub = world.byName('raid-mobs')[0];
    expect(hub.createOpts.permissionOverwrites).toBeTruthy();
    const { PermissionFlagsBits: P } = require('discord.js');
    const everyone = hub.createOpts.permissionOverwrites.find(o => o.id === world.guildId);
    expect(everyone.deny).toEqual(expect.arrayContaining([P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads]));
    expect(hub.createOpts.permissionOverwrites.find(o => o.id === 'bot-1').allow).toEqual(expect.arrayContaining([P.SendMessages, P.CreatePublicThreads]));
    // members' conversation channels are never locked
    expect(world.byName('raid-chat')[0].createOpts.permissionOverwrites).toBeUndefined();

    const w2 = makeWorld();
    await prov.provisionLayout({ client: w2.client, supabase: null, env: { DISCORD_GUILD_ID: w2.guildId }, mode: 'create', log: quiet });
    expect(w2.byName('raid-mobs')[0].createOpts.permissionOverwrites).toBeUndefined();
  });

  it('is never locked when it was adopted rather than created', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    await prov.provisionLayout({ client: world.client, supabase: null, env: { DISCORD_GUILD_ID: world.guildId }, mode: 'create', lock: 'readonly', log: quiet });
    expect(hub.createOpts).toBeUndefined();
  });
});

describe('identity and permissions', () => {
  it('derives the client id and, for exactly one server, the guild id, and never overwrites', () => {
    const world = makeWorld();
    const env = {};
    expect(prov.deriveIdentity(world.client, env).set.sort()).toEqual(['DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID']);
    expect(env).toEqual({ DISCORD_CLIENT_ID: 'app-1', DISCORD_GUILD_ID: world.guildId });
    const set = { DISCORD_CLIENT_ID: 'mine', DISCORD_GUILD_ID: 'mine' };
    expect(prov.deriveIdentity(world.client, set).set).toEqual([]);
    expect(set).toEqual({ DISCORD_CLIENT_ID: 'mine', DISCORD_GUILD_ID: 'mine' });
  });

  it('reports the choice instead of guessing when the bot is in several servers', () => {
    const world = makeWorld();
    world.client.guilds.cache.set('other', { id: 'other' });
    const env = {};
    const r = prov.deriveIdentity(world.client, env);
    expect(env.DISCORD_GUILD_ID).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/2 servers/);
  });

  it('checkPerms names what is missing and fails open when it cannot tell', () => {
    const { PermissionFlagsBits: P } = require('discord.js');
    const chan = { permissionsFor: () => ({ has: (b) => b !== P.ManageThreads && b !== P.CreatePublicThreads }) };
    const r = prov.checkPerms(chan, { id: 'me' }, prov.baseNeeds(false));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['Create Public Threads', 'Manage Threads']);
    expect(prov.checkPerms({}, { id: 'me' }, prov.baseNeeds(false)).ok).toBe(true);
    expect(prov.checkPerms(chan, null, prov.baseNeeds(false)).ok).toBe(true);
    expect(prov.checkPerms({ permissionsFor: () => null }, { id: 'me' }, prov.baseNeeds(false)).ok).toBe(true);
    expect(prov.checkPerms({ permissionsFor: () => { throw new Error('x'); } }, { id: 'me' }, prov.baseNeeds(false)).ok).toBe(true);
  });

  it('asks for Pin Messages only when pinning, Manage Channels never as a channel permission, Manage Roles never', () => {
    expect(prov.baseNeeds(false)).not.toContain('Pin Messages');
    expect(prov.baseNeeds(true)).toContain('Pin Messages');
    expect(prov.baseNeeds(true)).not.toContain('Manage Channels');
    expect(prov.baseNeeds(true)).not.toContain('Manage Roles');
    for (const n of ['View Channel', 'Send Messages', 'Send Messages in Threads', 'Embed Links', 'Read Message History',
      'Create Public Threads', 'Manage Threads', 'Manage Messages']) expect(prov.baseNeeds(false)).toContain(n);
  });

  it('reports a missing permission by name BEFORE writing anything', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    world.denied.add('CreatePublicThreads');
    world.denied.add('ManageThreads');
    const env = { DISCORD_GUILD_ID: world.guildId };
    const r = await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    expect(world.stats.sends + world.stats.threadCreates).toBe(0);
    const it = r.items.find(i => i.key === 'SUMMARY_MESSAGE_ID');
    expect(it.action).toBe('blocked');
    expect(it.note).toMatch(/Create Public Threads, Manage Threads/);
    expect(r.perms).toEqual([{ key: 'TIMER_CHANNEL_ID', id: hub.id, missing: ['Create Public Threads', 'Manage Threads'] }]);
  });

  it('builds the invite permission integer from bits: the README value, plus Manage Channels on request', () => {
    expect(prov.invitePermissions().permissions).toBe('2252135193504768');
    expect(prov.invitePermissions({ channels: true }).permissions).toBe('2252135193504784');
    const u = prov.invitePermissions({ clientId: '42' });
    expect(u.url).toBe('https://discord.com/oauth2/authorize?client_id=42&scope=bot+applications.commands&permissions=2252135193504768');
    expect(prov.invitePermissions().url).toBe(null);
  });
});

describe('boot wrapper', () => {
  it('never throws, and logs exactly one summary line', async () => {
    const world = makeWorld();
    world.addChannel({ name: 'raid-mobs' });
    const lines = [];
    const env = { DISCORD_GUILD_ID: world.guildId };
    const r = await prov.bootProvision(world.client, { env, supabase: null, log: (m) => lines.push(m), mode: 'adopt' });
    expect(r.mode).toBe('adopt');
    const summary = lines.filter(l => l.startsWith('[provision] mode='));
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatch(/^\[provision\] mode=adopt filled=\d+ adopted=\d+ created=\d+ missing=/);
  });

  it('does nothing at all when off, not even identity', async () => {
    const world = makeWorld();
    const env = { GUILD_PROVISION: 'off' };
    const r = await prov.bootProvision(world.client, { env, supabase: null, log: quiet });
    expect(r.mode).toBe('off');
    expect(env).toEqual({ GUILD_PROVISION: 'off' });
    expect(world.stats.fetches).toBe(0);
  });

  it('survives a client that throws at every turn', async () => {
    const boom = { user: { id: 'b' }, guilds: { cache: new Map([['g', { id: 'g', get channels() { throw new Error('boom'); } }]]) },
      channels: { fetch: async () => { throw new Error('boom'); } } };
    await expect(prov.bootProvision(boom, { env: { DISCORD_GUILD_ID: 'g' }, supabase: null, log: quiet, mode: 'create' })).resolves.toBeTruthy();
  });

  it('stops at its time bound and says so, leaving the rest for the next boot', async () => {
    const world = makeWorld();
    // the first look at the server is slow, so the 25 s bound (here 30 ms) fires mid-run
    const slow = world.guild.channels.fetch;
    world.guild.channels.fetch = async () => { await new Promise(r => setTimeout(r, 120)); return slow(); };
    const lines = [];
    const r = await prov.bootProvision(world.client, { env: { DISCORD_GUILD_ID: world.guildId }, supabase: null, log: (m) => lines.push(m), mode: 'create', timeoutMs: 30 });
    expect(r.timedOut).toBe(true);
    expect(lines.join('\n')).toMatch(/stopped at the/);
    // the run notices the bound at its next step and stops: it does not carry on to build the layout
    await new Promise(r2 => setTimeout(r2, 300));
    expect(world.stats.threadCreates).toBe(0);
    expect(world.stats.sends).toBe(0);
  });
});
