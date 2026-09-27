// Acknowledging Mimic feedback from Discord (the guild lead, 2026-09-27: "these feedback have
// no acknowledgement in discord"). Mimic's reports were plain posts with no buttons; they now
// carry the same Acknowledge / Not Implementing pair as web reports, the button handlers work on
// plain posts (submitter + category from the feedback row), every button moves the row's status
// on, and the reports already posted get the buttons once. Runs the bot's REAL functions.
//
// Run: npx vitest run test/feedback-ack.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const handlers = sliceBlock(bot, 'const { EmbedBuilder: _EB2, ActionRowBuilder: _ARB2,', '\n// ── Cancel event from announce thread button');
const backfill = sliceBlock(bot, "const _FB_BUTTONS_BACKFILL_KEY = 'feedback_mimic_buttons_backfill';", "  return 'done';\n}");
const kvLatch = require('../utils/kvLatch');

class Btn { constructor() { this.d = {}; } setCustomId(v) { this.d.id = v; return this; } setLabel(v) { this.d.label = v; return this; } setStyle(v) { this.d.style = v; return this; } }
class Row { constructor() { this.components = []; } addComponents(...c) { this.components.push(...c); return this; } }
const ids = (row) => row.components.map(b => b.d.id);

function harness({ feedbackRow = { id: 'f1', submitter_discord_id: '42', category: 'bug' }, latch = [], openRows = [], messages = {} } = {}) {
  const log = { dms: [], edits: [], updates: [], upserts: [], selects: [] };
  const supabase = {
    isEnabled: () => true,
    select: async (table, q) => {
      log.selects.push([table, q]);
      if (table === 'bot_kv') return latch;
      if (table === 'feedback' && q.startsWith('discord_msg_id=eq.')) return feedbackRow ? [feedbackRow] : [];
      if (table === 'feedback') return openRows;
      return [];
    },
    update: async (table, filter, patch) => { log.updates.push([table, filter, patch]); },
    upsert: async (table, rows) => { log.upserts.push([table, rows]); },
  };
  const fakes = {
    'discord.js': { EmbedBuilder: class {}, ActionRowBuilder: Row, ButtonBuilder: Btn, ButtonStyle: { Success: 3, Danger: 4, Primary: 1 } },
    './utils/supabase': supabase,
    './utils/roles': { hasOfficerRole: () => true, officerRolesList: () => 'Officer' },
  };
  const req = (m) => fakes[m];
  const process = { env: { FEEDBACK_THREAD_ID: 'T' } };
  // eslint-disable-next-line no-new-func
  const fns = new Function('require', 'MessageFlags', 'kvLatch', 'process',
    handlers + '\n' + backfill + '\nreturn { handleFeedbackRecv, handleFeedbackClose, _feedbackStatusContent, _backfillMimicFeedbackButtonsOnce };')(
    req, { Ephemeral: 64 }, kvLatch, process);
  const message = {
    id: 'm1', embeds: [],
    content: '\u{1F41E} Bug from **Aldenmar** via mimic 2.7.3-beta.2\n>>> The charm break call is late',
    edit: async (o) => { log.edits.push(o); },
  };
  const interaction = {
    member: { displayName: 'Brackwyn' }, user: { username: 'brackwyn' },
    client: { users: { fetch: async (id) => ({ send: async (t) => { log.dms.push([id, t]); } }) } },
    message, deferUpdate: async () => {}, reply: async () => {},
  };
  const thread = { messages: { fetch: async (id) => messages[id] || null } };
  const readyClient = { channels: { fetch: async () => thread } };
  return { ...fns, interaction, readyClient, log };
}

describe('Mimic reports carry buttons', () => {
  it('the Mimic route posts the Acknowledge / Not Implementing pair', () => {
    const fn = stripJs(sliceBlock(bot, 'async function _handleAgentFeedback(req, res) {', '\nasync function _handleTriggerRelayPost'));
    expect(fn).toMatch(/files: shotsMod\.discordFiles\(shots\),\s*components: \[_feedbackRecvRow\(\)\],/);
  });
});

describe('acknowledging a plain (Mimic) post', () => {
  it('DMs the reporter from the feedback row, marks the post, swaps to the closing pair, and moves the row to acked', async () => {
    const h = harness();
    await h.handleFeedbackRecv(h.interaction);
    expect(h.log.dms).toEqual([['42', expect.stringMatching(/bug report from Mimic has been received/)]]);
    expect(h.log.edits).toHaveLength(1);
    const e = h.log.edits[0];
    expect(e.content.split('\n')[0]).toBe('\u{1F41E} Bug from **Aldenmar** via mimic 2.7.3-beta.2 · \u{1F4EC} Acknowledged by Brackwyn');
    expect(e.content.split('\n')[1]).toBe('>>> The charm break call is late');
    expect(ids(e.components[0])).toEqual(['fb_impl', 'fb_nope']);
    expect(h.log.updates).toEqual([['feedback', 'id=eq.f1', expect.objectContaining({ status: 'acked', acked_by: 'Brackwyn' })]]);
  });

  it('closing replaces the status on the first line, removes the buttons, and moves the row to addressed', async () => {
    const h = harness();
    h.interaction.message.content = h._feedbackStatusContent(h.interaction.message.content, '\u{1F4EC} Acknowledged by Brackwyn');
    await h.handleFeedbackClose(h.interaction, true);
    const e = h.log.edits[0];
    expect(e.content.split('\n')[0]).toBe('\u{1F41E} Bug from **Aldenmar** via mimic 2.7.3-beta.2 · ✅ Implemented by Brackwyn');
    expect(e.components).toEqual([]);
    expect(h.log.updates[0][2]).toEqual(expect.objectContaining({ status: 'addressed', addressed_by: 'Brackwyn' }));
    const h2 = harness();
    await h2.handleFeedbackClose(h2.interaction, false);
    expect(h2.log.edits[0].content.split('\n')[0]).toMatch(/ · ❌ Not implementing \(Brackwyn\)$/);
  });

  it('a post with no feedback row still gets marked, with no DM and no row write', async () => {
    const h = harness({ feedbackRow: null });
    await h.handleFeedbackRecv(h.interaction);
    expect(h.log.dms).toHaveLength(0);
    expect(h.log.updates).toHaveLength(0);
    expect(h.log.edits[0].content.split('\n')[0]).toMatch(/Acknowledged by Brackwyn$/);
  });
});

describe('the one-time backfill of posts that went out with no buttons', () => {
  const bare = () => { const m = { components: [], edits: [], edit: async (o) => { m.edits.push(o); } }; return m; };

  it('adds the pair only to posts that have none, then latches', async () => {
    const a = bare(), b = bare(), c = { components: [{}], edits: [], edit: async (o) => { c.edits.push(o); } };
    const h = harness({ openRows: [{ discord_msg_id: 'a' }, { discord_msg_id: 'b' }, { discord_msg_id: 'c' }, { discord_msg_id: 'gone' }], messages: { a, b, c } });
    expect(await h._backfillMimicFeedbackButtonsOnce(h.readyClient)).toBe('done');
    expect(a.edits).toHaveLength(1);
    expect(ids(a.edits[0].components[0])).toEqual(['fb_recv', 'fb_nope']);
    expect(b.edits).toHaveLength(1);
    expect(c.edits).toHaveLength(0);
    expect(h.log.upserts).toEqual([['bot_kv', [expect.objectContaining({ key: 'feedback_mimic_buttons_backfill', value: expect.objectContaining({ added: 2 }) })]]]);
    expect(h.log.selects.find(s => s[0] === 'feedback')[1]).toMatch(/client=eq\.mimic&status=eq\.new&discord_msg_id=not\.is\.null/);
  });

  it('never runs twice, and never on an unreadable latch', async () => {
    const a = bare();
    const done = harness({ latch: [{ value: { ran_at: 'x' } }], openRows: [{ discord_msg_id: 'a' }], messages: { a } });
    expect(await done._backfillMimicFeedbackButtonsOnce(done.readyClient)).toBe('latched');
    const unknown = harness({ latch: null, openRows: [{ discord_msg_id: 'a' }], messages: { a } });
    expect(await unknown._backfillMimicFeedbackButtonsOnce(unknown.readyClient)).toBe('unknown');
    expect(a.edits).toHaveLength(0);
  });

  it('is started once from ClientReady', () => {
    expect(stripJs(bot)).toMatch(/setTimeout\(\(\) => _backfillMimicFeedbackButtonsOnce\(readyClient\)/);
  });
});
