// Two small guards from 2026-11-02:
//  - the bot posted a parse card for a "boss" named "mephit hits YOU" (a mangled log line read as attacker "A");
//    an encounter whose boss name is a fragment of a combat line is now skipped;
//  - a feedback reply reached Discord three times because the slow form was submitted three times; the same reply
//    by the same person within two minutes is now stored once.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, stripJs, BOT_INDEX, ROOT } from './_source-slice.js';

const bot = stripJs(readSource(BOT_INDEX));
const condAt = bot.indexOf('if (/\\bYOU\\b/.test(bossNameRaw)');
const cond = bot.slice(condAt + 3, bot.indexOf(') {\n', condAt) + 1);
// eslint-disable-next-line no-new-func
const isFragment = new Function('bossNameRaw', `return ${cond};`);

describe('a boss name that is a fragment of a combat line', () => {
  it('is skipped before any card or parse', () => {
    expect(condAt).toBeGreaterThan(-1);
    expect(bot.slice(condAt, condAt + 600)).toMatch(/skipped: 'fragment boss'/);
    expect(condAt).toBeLessThan(bot.indexOf('[agent] upload from'));
  });
  it('catches the shapes seen, and leaves real mob names alone', () => {
    for (const n of ['mephit hits YOU', 'a mephit hits YOU', 'Aldenmar slashes you', 'a wolf bites him']) expect(isFragment(n)).toBe(true);
    for (const n of ['a mephit retainer', 'Vallon Zek', 'Youthful Brackwyn', 'A Planar Projection', 'a hitsuji guard']) expect(isFragment(n)).toBe(false);
  });
});

describe('a feedback reply sent twice in a row', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/feedback/[ref]/actions.ts'), 'utf8'));
  const fn = src.slice(src.indexOf('export async function postReply'));
  it('is looked up by the same author and text within two minutes before inserting', () => {
    const dedupe = fn.indexOf("eq('author_discord_id', viewer.discordId)");
    expect(dedupe).toBeGreaterThan(-1);
    expect(fn).toMatch(/prev\.body === clean\.body && Date\.now\(\) - Date\.parse\(prev\.created_at\) < 2 \* 60_000/);
    expect(dedupe).toBeLessThan(fn.indexOf(".insert([{"));
  });
});
