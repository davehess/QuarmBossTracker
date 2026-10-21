// test/postrelease.test.js — /postrelease (the guild lead, 2026-10-21: "have the bot post them for me").
// The release posts must each fit one Discord message, name their pictures that exist, and the command is officers-only.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { loadPosts } = require('../commands/postrelease.js');

describe('/postrelease', () => {
  const posts = loadPosts();

  it('carries four posts, in order, each under Discord\'s 2000-character limit', () => {
    expect(posts.map(p => p.part)).toEqual([1, 2, 3, 4]);
    for (const p of posts) {
      expect(p.text.length).toBeGreaterThan(200);
      expect(p.text.length).toBeLessThanOrEqual(2000);
    }
  });

  it('every picture a post names is on disk', () => {
    for (const p of posts) if (p.image) expect(fs.existsSync(p.imagePath)).toBe(true);
    expect(posts.filter(p => p.image).length).toBe(3);   // post 3 gets the guild lead's own picture
  });

  it('is officers-only and posts in the channel it was run in', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'commands', 'postrelease.js'), 'utf8'));
    expect(src.indexOf('hasOfficerRole(interaction.member)')).toBeGreaterThan(-1);
    expect(src.indexOf('hasOfficerRole(interaction.member)')).toBeLessThan(src.indexOf('interaction.channel.send'));
  });
});
