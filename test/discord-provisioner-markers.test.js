// test/discord-provisioner-markers.test.js — how a slot message is recognised.
//
// A slot (the pinned Active Cooldowns card, an expansion's board panels, the
// thread-links line) is a MESSAGE, and the only durable way to find one again
// after a restart that lost every id is to recognise it. Three recognisers, in
// order, and each one has to be right in the way that matters:
//
//   1. the footer marker `wp:slot:<KEY>` the provisioner puts on its placeholders
//   2. the bot's own author + the REAL builder title, once /board has edited the
//      placeholder into the real card and the footer is gone
//   3. for the text-only thread-links line, the heuristic /cleanup already uses
//
// And a placeholder whose title drifted from its card's would orphan the slot on
// the first /board, so the titles are proved equal to what the builders emit
// rather than retyped here.
//
// Run: npx vitest run test/discord-provisioner-markers.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';
import { makeWorld, quiet } from './_fake-discord-world.js';

const require = createRequire(import.meta.url);
const prov = require(path.join(ROOT, 'utils', 'discordProvisioner.js'));
const embeds = require(path.join(ROOT, 'utils', 'embeds.js'));
const { buildExpansionPanels } = require(path.join(ROOT, 'utils', 'board.js'));
const { EXPANSION_META } = require(path.join(ROOT, 'utils', 'config.js'));

const bosses = prov.loadBosses();
const expanded = prov.expandLayout(prov.loadLayout(), { bosses });
const item = (k) => expanded.items.find(i => i.key === k);
const BOT = 'bot-1';

// A message as discord.js hands it back: oldest has the smallest timestamp.
let ts = 0;
const msg = (id, { author = BOT, title, footer, content = '', components = [] } = {}) => ({
  id, author: { id: author }, createdTimestamp: ++ts, content, components,
  embeds: title !== undefined || footer ? [{ title, footer: footer ? { text: footer } : null }] : [],
});

describe('finding a slot by marker', () => {
  it('finds a placeholder by its footer, even if the title is something else', () => {
    const msgs = [msg('1', { title: 'unrelated' }), msg('2', { title: 'whatever', footer: 'wp:slot:SUMMARY_MESSAGE_ID' })];
    const hit = prov.pickSlotMessage(msgs, item('SUMMARY_MESSAGE_ID'), 0);
    expect(hit.msg.id).toBe('2');
    expect(hit.by).toBe('marker');
  });

  it('a board panel is found by its own index, not by its neighbour\'s', () => {
    const it = item('CLASSIC_BOARD_IDS');
    const msgs = [msg('10', { title: 'x', footer: 'wp:slot:CLASSIC_BOARD_IDS:1' }), msg('11', { title: 'y', footer: 'wp:slot:CLASSIC_BOARD_IDS:0' })];
    expect(prov.pickSlotMessage(msgs, it, 0).msg.id).toBe('11');
    expect(prov.pickSlotMessage(msgs, it, 1).msg.id).toBe('10');
  });

  it('a marker for another key is not mistaken for this one', () => {
    const msgs = [msg('1', { title: '📊 Active Cooldowns', footer: 'wp:slot:SPAWNING_TOMORROW_MESSAGE_ID' })];
    // the title matches SUMMARY's builder title, so it is found by title, not by marker
    expect(prov.pickSlotMessage(msgs, item('SUMMARY_MESSAGE_ID'), 0).by).toBe('title');
    expect(prov.pickSlotMessage(msgs, item('SPAWNING_TOMORROW_MESSAGE_ID'), 0).by).toBe('marker');
  });
});

describe('finding a slot by author + title once the footer is gone', () => {
  it('finds the real card by the builder title', () => {
    const title = embeds.buildSummaryCard([], {}).data.title;
    const msgs = [msg('5', { title: 'something else' }), msg('6', { title })];
    const hit = prov.pickSlotMessage(msgs, item('SUMMARY_MESSAGE_ID'), 0);
    expect(hit.msg.id).toBe('6');
    expect(hit.by).toBe('title');
  });

  it('ignores a human message with the same title', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const title = embeds.buildSummaryCard([], {}).data.title;
    world.addHumanMessage(hub.id, { embeds: [{ data: { title } }] });
    const env = { DISCORD_GUILD_ID: world.guildId };
    const r = await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'adopt', log: quiet });
    expect(env.SUMMARY_MESSAGE_ID).toBeUndefined();
    expect(r.items.find(i => i.key === 'SUMMARY_MESSAGE_ID').action).toBe('missing');
    // the bot's own card with that title IS adopted, and the human's stays untouched
    const mine = world.addBotMessage(hub.id, { embeds: [{ data: { title } }] });
    const env2 = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env: env2, mode: 'adopt', log: quiet });
    expect(env2.SUMMARY_MESSAGE_ID).toBe(mine.id);
    expect(world.stats.deletes).toBe(0);
  });

  it('a different bot\'s message with the same title is not ours either', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const title = embeds.buildSummaryCard([], {}).data.title;
    const other = world.addBotMessage(hub.id, { embeds: [{ data: { title } }] });
    other.author.id = 'some-other-bot';
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'adopt', log: quiet });
    expect(env.SUMMARY_MESSAGE_ID).toBeUndefined();
  });

  it('the earliest wins among duplicates, by marker and by title', () => {
    const title = embeds.buildSummaryCard([], {}).data.title;
    const byTitle = [msg('9', { title }), msg('7', { title })];
    byTitle[1].createdTimestamp = 1;   // '7' is older although listed second
    const a = prov.pickSlotMessage([...byTitle].sort((x, y) => x.createdTimestamp - y.createdTimestamp), item('SUMMARY_MESSAGE_ID'), 0);
    expect(a.msg.id).toBe('7');
    expect(a.duplicates).toBe(1);
    const byMarker = [msg('21', { title: 'a', footer: 'wp:slot:SUMMARY_MESSAGE_ID' }), msg('20', { title: 'a', footer: 'wp:slot:SUMMARY_MESSAGE_ID' })];
    expect(prov.pickSlotMessage(byMarker, item('SUMMARY_MESSAGE_ID'), 0).msg.id).toBe('21');   // the list is already oldest-first
  });

  it('fetchBotMessages hands them over oldest first, and only the bot\'s', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'x' });
    const a = world.addBotMessage(hub.id, { content: 'a' });
    world.addHumanMessage(hub.id, { content: 'h' });
    const b = world.addBotMessage(hub.id, { content: 'b' });
    const got = await prov.fetchBotMessages(hub, BOT);
    expect(got.map(m => m.id)).toEqual([a.id, b.id]);
  });

  it('a board set is adopted only when every panel is there, in order', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const t = world.addThread(hub.id, { name: 'Velious' });
    const panels = buildExpansionPanels('Velious', bosses, {});
    expect(panels.length).toBeGreaterThan(1);
    const posted = panels.map(p => world.addBotMessage(t.id, { embeds: [{ data: { title: p.payload.embeds[0].data.title } }] }));
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'adopt', log: quiet });
    expect(env.VELIOUS_BOARD_IDS).toBe(posted.map(m => m.id).join(','));

    // one panel missing: not a board set, not adopted (a partial set cannot be edited in place)
    world.removeMessage(t.id, posted[1].id);
    const env2 = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env: env2, mode: 'adopt', log: quiet });
    expect(env2.VELIOUS_BOARD_IDS).toBeUndefined();
  });
});

describe('the thread-links line', () => {
  // The heuristic in commands/cleanup.js, read from the source so it cannot drift.
  const cleanupSrc = fs.readFileSync(path.join(ROOT, 'commands', 'cleanup.js'), 'utf8');
  const { isThreadLinksMsg: cleanupFn } = evalBlock(sliceBlock(cleanupSrc, 'function isThreadLinksMsg(msg) {', '\n}'), ['isThreadLinksMsg']);

  const corpus = [
    { embeds: [], components: [], content: '⚔️ Classic → <#1>' },
    { embeds: [], components: [], content: '🔥 Planes of Power → *(no thread)*' },
    { embeds: [], components: [], content: 'Kunark → <#2>' },
    { embeds: [], components: [], content: 'Luclin and Velious but no arrow' },
    { embeds: [], components: [], content: 'an arrow → but no expansion name' },
    { embeds: [{ title: 'x' }], components: [], content: 'Classic → <#1>' },
    { embeds: [], components: [{}], content: 'Classic → <#1>' },
    { embeds: [], components: [], content: '' },
    { embeds: [], components: [] },
    { embeds: [], components: [], content: 'Velious → <#9>' },
  ];

  it('is the same test /cleanup applies, over a corpus that includes the near misses', () => {
    expect(corpus.filter(cleanupFn).length).toBeGreaterThan(2);
    expect(corpus.filter(cleanupFn).length).toBeLessThan(corpus.length - 2);
    for (const m of corpus) expect(prov.isThreadLinksMsg(m), JSON.stringify(m)).toBe(!!cleanupFn(m));
  });

  it('is what the provisioner\'s own placeholder looks like, so /cleanup keeps it', () => {
    const text = prov.threadLinksContent(expanded.eras, () => null);
    const m = { embeds: [], components: [], content: text };
    expect(cleanupFn(m)).toBe(true);
    expect(prov.isThreadLinksMsg(m)).toBe(true);
    expect(text.split('\n')).toHaveLength(expanded.eras.length);
    expect(text).toMatch(/\*\(no thread\)\*/);
  });

  it('is found by the heuristic, earliest wins, and an embed card or a human line is ignored', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    world.addHumanMessage(hub.id, { content: '⚔️ Classic → <#1>' });
    world.addBotMessage(hub.id, { embeds: [{ data: { title: 'x', description: 'Classic →' } }], content: 'Classic → <#1>' });
    const mine = world.addBotMessage(hub.id, { content: '⚔️ Classic EverQuest → <#5>' });
    world.addBotMessage(hub.id, { content: '🦎 Ruins of Kunark → <#6>' });
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'adopt', log: quiet });
    expect(env.THREAD_LINKS_MESSAGE_ID).toBe(mine.id);
  });

  it('is filled with the real links once the threads exist, and left alone after that', async () => {
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    const links = world.messagesIn(env.TIMER_CHANNEL_ID).find(m => m.id === env.THREAD_LINKS_MESSAGE_ID);
    for (const era of prov.listEras(bosses)) {
      expect(links.content).toContain(`${EXPANSION_META[era].label} → <#${env[`${era.toUpperCase()}_THREAD_ID`]}>`);
    }
    expect(links.content).not.toMatch(/no thread/);
    const edits = world.stats.edits;
    await prov.provisionLayout({ client: world.client, supabase: null, env: { DISCORD_GUILD_ID: world.guildId }, mode: 'create', log: quiet });
    expect(world.stats.edits).toBe(edits);
  });

  it('is never rewritten when the operator owns its id', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const mine = world.addBotMessage(hub.id, { content: '⚔️ Classic → *(no thread)*' });
    const env = { DISCORD_GUILD_ID: world.guildId, TIMER_CHANNEL_ID: hub.id, THREAD_LINKS_MESSAGE_ID: mine.id };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    expect(mine.content).toBe('⚔️ Classic → *(no thread)*');
  });
});

describe('placeholder titles are the builders\' titles', () => {
  const cleanupSrc = fs.readFileSync(path.join(ROOT, 'commands', 'cleanup.js'), 'utf8');
  const { MAIN_SLOT_TITLES } = evalBlock(sliceBlock(cleanupSrc, 'const MAIN_SLOT_TITLES = new Set([', ']);'), ['MAIN_SLOT_TITLES']);

  async function built() {
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', log: quiet });
    return { world, env };
  }

  it('the three main cards carry exactly what the card builders emit, and what /cleanup treats as canonical', async () => {
    const { world, env } = await built();
    const want = {
      SUMMARY_MESSAGE_ID: embeds.buildSummaryCard(bosses, {}).data.title,
      SPAWNING_TOMORROW_MESSAGE_ID: embeds.buildSpawningTomorrowCard(bosses, {}).data.title,
      DAILY_SUMMARY_MESSAGE_ID: embeds.buildDailySummaryEmbed([], [], bosses).data.title,
    };
    for (const [key, title] of Object.entries(want)) {
      const m = world.messagesIn(env.TIMER_CHANNEL_ID).find(x => x.id === env[key]);
      expect(m.embeds[0].title, key).toBe(title);
      expect(MAIN_SLOT_TITLES.has(title), `${title} is not one of /cleanup's canonical slot titles`).toBe(true);
    }
    expect(MAIN_SLOT_TITLES.size).toBe(3);
  });

  it('every era\'s cooldown card carries the title its builder emits (with real kill state too)', async () => {
    const { world, env } = await built();
    for (const era of prov.listEras(bosses)) {
      const E = era.toUpperCase();
      const real = embeds.buildExpansionCooldownCard(era, bosses, { someBoss: { nextSpawn: Date.now() + 1e6 } }).data.title;
      const m = world.messagesIn(env[`${E}_THREAD_ID`]).find(x => x.id === env[`${E}_COOLDOWN_ID`]);
      expect(m.embeds[0].title, era).toBe(real);
      expect(real.endsWith('— Active Cooldowns')).toBe(true);
    }
  });

  it('every board panel carries its panel\'s title, in order, and killops\' scan would find the set', async () => {
    const { world, env } = await built();
    for (const era of prov.listEras(bosses)) {
      const E = era.toUpperCase();
      const panels = buildExpansionPanels(era, bosses, {});
      const ids = env[`${E}_BOARD_IDS`].split(',');
      expect(ids).toHaveLength(panels.length);
      const thread = world.messagesIn(env[`${E}_THREAD_ID`]);
      ids.forEach((id, i) => {
        const m = thread.find(x => x.id === id);
        expect(m.embeds[0].title).toBe(panels[i].payload.embeds[0].data.title);
        // utils/killops.js scanThreadForBoard anchors on the label as a title prefix
        expect(m.embeds[0].title.startsWith(EXPANSION_META[era].label)).toBe(true);
      });
      // the cooldown card sits above the set and does NOT start with the label, or the scan would anchor on it
      const cd = thread.find(x => x.id === env[`${E}_COOLDOWN_ID`]);
      expect(cd.embeds[0].title.startsWith(EXPANSION_META[era].label)).toBe(false);
      expect(thread.indexOf(cd)).toBeLessThan(thread.findIndex(x => x.id === ids[0]));
    }
  });

  it('carries the builders\' colours, so the placeholder does not flash another one', async () => {
    const { world, env } = await built();
    const m = world.messagesIn(env.TIMER_CHANNEL_ID).find(x => x.id === env.SUMMARY_MESSAGE_ID);
    expect(m.embeds[0].color).toBe(embeds.buildSummaryCard([], {}).data.color);
    const v = world.messagesIn(env.VELIOUS_THREAD_ID)[0];
    expect(v.embeds[0].color).toBe(embeds.buildExpansionCooldownCard('Velious', [], {}).data.color);
  });

  it('is read from the builders at run time, not typed into the provisioner', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'utils', 'discordProvisioner.js'), 'utf8'));
    for (const t of ['Active Cooldowns', 'Spawning in the Next 24 Hours', 'Daily Raid Summary']) {
      expect(src.includes(t), `"${t}" is retyped in utils/discordProvisioner.js`).toBe(false);
    }
    for (const b of ['buildSummaryCard', 'buildSpawningTomorrowCard', 'buildDailySummaryEmbed', 'buildExpansionCooldownCard', 'buildExpansionPanels']) {
      expect(src.includes(b), b).toBe(true);
    }
  });

  it('every placeholder carries a footer marker that parses back to its own key', async () => {
    const { world, env } = await built();
    const hubMsgs = world.messagesIn(env.TIMER_CHANNEL_ID).filter(m => m.embeds[0]);
    expect(hubMsgs).toHaveLength(3);   // the thread-links line is text and has no footer
    for (const m of hubMsgs) expect(prov.parseMarker(m.embeds[0].footer.text).key).toMatch(/_MESSAGE_ID$/);
    for (const era of prov.listEras(bosses)) {
      const E = era.toUpperCase();
      for (const m of world.messagesIn(env[`${E}_THREAD_ID`])) {
        const p = prov.parseMarker(m.embeds[0].footer.text);
        expect([`${E}_COOLDOWN_ID`, `${E}_BOARD_IDS`]).toContain(p.key);
      }
    }
  });
});

describe('pinning', () => {
  it('is off by default', async () => {
    const world = makeWorld();
    await prov.provisionLayout({ client: world.client, supabase: null, env: { DISCORD_GUILD_ID: world.guildId }, mode: 'create', log: quiet });
    expect(world.stats.pins).toBe(0);
  });

  it('when on pins the four main slots and deletes the notice Discord posts for it', async () => {
    const world = makeWorld();
    const env = { DISCORD_GUILD_ID: world.guildId };
    await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', pin: true, log: quiet });
    expect(world.stats.pins).toBe(4);
    expect(world.messagesIn(env.TIMER_CHANNEL_ID).filter(m => m.type === 6)).toHaveLength(0);   // the pin notices are gone
    expect(world.stats.deletes).toBe(4);
  });

  // A person pins something in the hub while the bot is pinning its card. Their
  // notice is among the three newest messages and must survive; ours must not.
  const hubWithRacingPin = (world, racer) => {
    const hub = world.addChannel({ name: 'raid-mobs' });
    const send = hub.send;
    hub.send = async (payload) => {
      const msg = await send(payload);
      const pin = msg.pin;
      msg.pin = async () => { await pin(); racer(hub, msg); };
      return msg;
    };
    return hub;
  };
  const run = (world, hub) => prov.provisionLayout({ client: world.client, supabase: null, env: { DISCORD_GUILD_ID: world.guildId, TIMER_CHANNEL_ID: hub.id }, mode: 'create', pin: true, log: quiet });

  it('deletes the bot\'s own pin notice and leaves a person\'s alone (no reference on the notice)', async () => {
    const world = makeWorld();
    const hub = hubWithRacingPin(world, (h) => world.addPinNotice(h.id, { authorId: 'human-1' }));
    await run(world, hub);
    const notices = world.messagesIn(hub.id).filter(m => m.type === 6);
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices.every(m => m.author.id === 'human-1')).toBe(true);
    expect(world.stats.pins).toBeGreaterThanOrEqual(1);
  });

  it('with a reference, deletes the notice that points at the message it pinned and no other', async () => {
    const world = makeWorld();
    world.pinReferences = true;
    const hub = hubWithRacingPin(world, (h) => world.addPinNotice(h.id, { authorId: 'bot-1', reference: { messageId: 'somebody-elses-message' } }));
    await run(world, hub);
    const notices = world.messagesIn(hub.id).filter(m => m.type === 6);
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices.every(m => m.reference && m.reference.messageId === 'somebody-elses-message')).toBe(true);
  });

  it('when on, asks for the Pin Messages permission first', async () => {
    const world = makeWorld();
    world.addChannel({ name: 'raid-mobs' });
    world.denied.add('PinMessages');
    const env = { DISCORD_GUILD_ID: world.guildId };
    const r = await prov.provisionLayout({ client: world.client, supabase: null, env, mode: 'create', pin: true, log: quiet });
    expect(r.items.find(i => i.key === 'SUMMARY_MESSAGE_ID').note).toMatch(/Pin Messages/);
    expect(world.stats.sends).toBe(0);
  });
});
