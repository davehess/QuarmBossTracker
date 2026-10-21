// The per-boss parse card in the raid thread links back to its wolfpack.quest parse page
// (the guild lead, 2026-10-21). Behaviour on the real builder + a comment-stripped guard that
// the upload handler still applies it with the encounter id.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { BOT_INDEX, readSource, stripJs, sliceBlock } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { buildParseEmbed, withParseWebLink } = require('../commands/parse');

const ID = '3f2b8c1e-0000-4000-8000-000000000001';
const parsed = { duration: 60, totalDamage: 1000, totalDps: 16, players: [
  { name: 'Aldenmar', class: 'Wizard', damage: 1000, dps: 16, duration: 60 },
] };

describe('parse card web link', () => {
  it('sets the title url and a visible line to /parses/<encounter id>', () => {
    const card = withParseWebLink(buildParseEmbed('a Boss', parsed, '🤖', {}), ID);
    const json = card.toJSON();
    expect(json.url).toBe(`https://wolfpack.quest/parses/${ID}`);
    expect(json.description).toContain(`[Full parse on wolfpack.quest](https://wolfpack.quest/parses/${ID})`);
    expect(json.description).toContain('Fight:'); // original description kept
  });

  it('leaves the card untouched while the encounter id is unknown', () => {
    // Two builds a millisecond apart carry different setTimestamp() values; compare without it.
    const noTs = ({ timestamp, ...rest }) => rest;   // eslint-disable-line no-unused-vars
    const before = noTs(buildParseEmbed('a Boss', parsed, '🤖', {}).toJSON());
    const card = withParseWebLink(buildParseEmbed('a Boss', parsed, '🤖', {}), null);
    expect(noTs(card.toJSON())).toEqual(before);
    expect(card.toJSON().url).toBeUndefined();
  });

  it('a 47-player kill says how many raiders and how much damage did not fit', () => {
    const players = Array.from({ length: 47 }, (_, i) => ({
      name: 'Raider' + i, rank: i + 1, damage: 10000, dps: 100, duration: 171,
    }));
    const json = buildParseEmbed('a Boss', { duration: 171, totalDamage: 470000, totalDps: 2748, players }, '🤖', {}).toJSON();
    const field = json.fields.find(f => /^DPS Rankings/.test(f.name));
    expect(field.name).toBe('DPS Rankings (47)');
    expect(field.value.length).toBeLessThanOrEqual(1024);
    const shown = field.value.split('\n').filter(l => /^\s*\d+\.\s/.test(l)).length;
    expect(shown).toBeLessThan(47);
    expect(field.value).toContain(`+${47 - shown} more · `);
  });

  it('is applied to the raid-thread card in the upload handler', () => {
    const src = readSource(BOT_INDEX);
    const handler = stripJs(sliceBlock(src, 'async function _handleAgentUpload(req, res) {', '\nconst httpServer = http.createServer('));
    expect(handler).toContain("require('./commands/parse').withParseWebLink(card, _encIdForLink)");
  });
});
