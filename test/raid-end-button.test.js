// test/raid-end-button.test.js — "End raid" on the raid-night thread.
//
// "We need a button on the raid night thread for officers and leaders to be
// able to click to end the raid." (Hitya, 2026-08-30)
//
// What it does is stop the automatic attendance ticks for the rest of the
// night. The four slots fire on the clock (20:30 / 21:30 / 22:30 / 23:30 ET),
// and since 2026-08-16 alt raids and Seru/misc nights deliberately run THREE
// ticks over two hours — so slot 4 on those nights records people as present
// at 23:30 when the raid ended at 22:00. The MIN_NAMES floor was the only
// defence and it is a guess about stragglers, not a statement that the raid is
// over.
//
// BEHAVIOURAL where it can be: the kv helpers and the button row are sliced out
// of index.js and RUN. The wiring that cannot be run without a Discord client
// is asserted on COMMENT-STRIPPED source.
//
// Run: npx vitest run test/raid-end-button.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
// ⚠ sliceBlock INCLUDES its end marker, so the block must end on something
// complete — ending on the next function's opening brace yields unbalanced
// source and the whole harness throws.
const block = sliceBlock(src, "const _raidEndedKey = (nightKey) =>",
  '      : new ButtonBuilder().setCustomId(`raid_end:${nightKey}`)\n'
  + "          .setLabel('End raid').setEmoji('🏁').setStyle(ButtonStyle.Secondary),\n"
  + '  )];\n}');

// Fake Supabase + discord.js builders, so the real helpers can be exercised.
function build({ rows = [], failRead = false, failWrite = false } = {}) {
  const calls = { selects: 0, upserts: [] };
  const harness = `
    var __calls = { selects: 0, upserts: [] };
    var __rows = ${JSON.stringify(rows)};
    var __failRead = ${failRead}, __failWrite = ${failWrite};
    var console = { warn(){}, log(){} };
    var process = { env: {} };
    function require(m){
      if (m === './utils/supabase') return {
        isEnabled: () => true,
        select: async () => { __calls.selects++; if (__failRead) throw new Error('read down'); return __rows; },
        upsert: async (t, r) => { if (__failWrite) throw new Error('write down'); __calls.upserts.push(r[0]); },
      };
      if (m === 'discord.js') return {
        ActionRowBuilder: class { addComponents(c){ this.c = c; return this; } },
        ButtonBuilder: class {
          setCustomId(v){ this.customId = v; return this; }
          setLabel(v){ this.label = v; return this; }
          setEmoji(v){ this.emoji = v; return this; }
          setStyle(v){ this.style = v; return this; }
        },
        ButtonStyle: { Secondary: 2, Danger: 4 },
      };
      throw new Error('unexpected require: ' + m);
    }
  `;
  const api = evalBlock(harness + block + `
    function calls(){ return __calls; }
    function setRows(r){ __rows = r; }
  `, ['_raidEndedKey', '_raidEndedInfo', '_setRaidEnded', '_raidEndComponents', 'calls', 'setRows']);
  return api;
}

const KV = (v) => [{ value: v }];

describe('the end marker', () => {
  it('is keyed per NIGHT, so ending Sunday does not end Wednesday', () => {
    const h = build();
    expect(h._raidEndedKey('2026-08-30')).toBe('raid_ended_2026-08-30');
    expect(h._raidEndedKey('2026-09-02')).not.toBe(h._raidEndedKey('2026-08-30'));
  });

  it('reads an ended night', async () => {
    const h = build({ rows: KV({ ended: true, by: 'Hitya', at: '2026-08-31T02:00:00Z' }) });
    const v = await h._raidEndedInfo('2026-08-30');
    expect(v.by).toBe('Hitya');
  });

  it('treats a REOPENED night as not ended', async () => {
    const h = build({ rows: KV({ ended: false, by: 'Hitya', at: '2026-08-31T02:00:00Z' }) });
    expect(await h._raidEndedInfo('2026-08-30')).toBe(null);
  });

  it('treats a night with no row as not ended', async () => {
    const h = build({ rows: [] });
    expect(await h._raidEndedInfo('2026-08-30')).toBe(null);
  });

  // ⚠ The asymmetry that decides this: raid_roster is a LIVE view pruned
  // hourly, so a tick that is not captured is unrecoverable, while an extra
  // one is a visible row an officer can ignore.
  it('FAILS OPEN — a broken read must not silently stop attendance capture', async () => {
    const h = build({ failRead: true });
    expect(await h._raidEndedInfo('2026-08-30')).toBe(null);
  });

  it('caches, so the 60s tick checker is not a Supabase read a minute', async () => {
    const h = build({ rows: KV({ ended: true, by: 'Hitya', at: '2026-08-31T02:00:00Z' }) });
    await h._raidEndedInfo('2026-08-30');
    await h._raidEndedInfo('2026-08-30');
    await h._raidEndedInfo('2026-08-30');
    expect(h.calls().selects).toBe(1);
  });

  it('...but never serves one night’s answer for another', async () => {
    const h = build({ rows: KV({ ended: true, by: 'Hitya', at: '2026-08-31T02:00:00Z' }) });
    await h._raidEndedInfo('2026-08-30');
    h.setRows([]);
    expect(await h._raidEndedInfo('2026-09-02')).toBe(null);
    expect(h.calls().selects).toBe(2);
  });
});

describe('writing the marker', () => {
  it('records who ended it and when', async () => {
    const h = build();
    expect(await h._setRaidEnded('2026-08-30', { ended: true, by: 'Hitya', byId: '42' })).toBe(true);
    const row = h.calls().upserts[0];
    expect(row.key).toBe('raid_ended_2026-08-30');
    expect(row.value).toMatchObject({ ended: true, by: 'Hitya', by_id: '42' });
    expect(Number.isFinite(Date.parse(row.value.at))).toBe(true);
  });

  it('a write refreshes the cache, so the next tick sees it immediately', async () => {
    const h = build({ rows: [] });
    expect(await h._raidEndedInfo('2026-08-30')).toBe(null);
    await h._setRaidEnded('2026-08-30', { ended: true, by: 'Hitya', byId: '42' });
    const v = await h._raidEndedInfo('2026-08-30');
    expect(v && v.ended).toBe(true);
    expect(h.calls().selects).toBe(1);          // served from cache, not re-read
  });

  it('reopening clears it for the same night', async () => {
    const h = build({ rows: [] });
    await h._setRaidEnded('2026-08-30', { ended: true, by: 'Hitya', byId: '42' });
    await h._setRaidEnded('2026-08-30', { ended: false, by: 'Hitya', byId: '42' });
    expect(await h._raidEndedInfo('2026-08-30')).toBe(null);
  });

  it('reports failure rather than pretending the raid ended', async () => {
    const h = build({ failWrite: true });
    expect(await h._setRaidEnded('2026-08-30', { ended: true, by: 'Hitya', byId: '42' })).toBe(false);
  });
});

describe('the button itself', () => {
  it('offers "End raid" while the night is running', () => {
    const h = build();
    const btn = h._raidEndComponents('2026-08-30', false)[0].c;
    expect(btn.customId).toBe('raid_end:2026-08-30');
    expect(btn.label).toBe('End raid');
  });

  it('offers the way back once ended — an early click must be undoable', () => {
    const h = build();
    const btn = h._raidEndComponents('2026-08-30', true)[0].c;
    expect(btn.customId).toBe('raid_reopen:2026-08-30');
    expect(btn.label).toBe('Reopen the raid');
  });

  it('carries the night in the id, so a card from an old night cannot end tonight', () => {
    const h = build();
    expect(h._raidEndComponents('2026-08-23', false)[0].c.customId).toBe('raid_end:2026-08-23');
  });
});

describe('wiring (comment-stripped source)', () => {
  const clean = stripJs(src);

  it('rides the attendance tick cards, which live in the raid-night thread', () => {
    const card = sliceBlock(clean, 'async function _postRaidTickCard(', '\n}\n');
    expect(card).toContain('_raidEndComponents(nightKey, false)');
    expect(card).toContain('components });');        // the fallback send carries it too
  });

  it('actually stops the capture, and before the expensive roster paging', () => {
    const cap = sliceBlock(clean, 'async function _captureRaidTickIfDue()', '\n}\n');
    const gate = cap.indexOf('_raidEndedInfo(nightKey)');
    const pages = cap.indexOf('_fetchFreshRosterRows');
    expect(gate).toBeGreaterThan(-1);
    expect(pages).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(pages);
  });

  it('is officer-gated', () => {
    const h = sliceBlock(clean, 'async function handleRaidEndButton(', '\n}\n');
    expect(h).toContain('hasOfficerRole(interaction.member)');
    expect(h).toContain('ephemeral: true');
  });

  it('routes both directions', () => {
    expect(clean).toContain("customId.startsWith('raid_end:')");
    expect(clean).toContain("customId.startsWith('raid_reopen:')");
    expect(clean).toContain('handleRaidEndButton(interaction, true)');
    expect(clean).toContain('handleRaidEndButton(interaction, false)');
  });

  it('stores the marker in bot_kv, never in state.json', () => {
    const b = sliceBlock(clean, 'async function _setRaidEnded(', '\n}\n');
    expect(b).toContain("upsert('bot_kv'");
    expect(b).not.toContain('state.json');
    expect(b).not.toContain('saveState');
  });
});
