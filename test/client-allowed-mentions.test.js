// The Discord clients set a default mention policy so message text can never resolve @everyone/@here.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, BOT_INDEX, readSource, stripJs } from './_source-slice.js';

describe('client default allowedMentions', () => {
  it('bot client never parses everyone', () => {
    const src = stripJs(readSource(BOT_INDEX));
    const m = src.match(/new Client\(\{[^\n]*allowedMentions:\s*\{\s*parse:\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    expect(m[1]).not.toMatch(/everyone/);
  });
  it('bristlebane client parses no mentions', () => {
    const src = stripJs(readSource(path.join(ROOT, 'apps', 'bristlebane', 'index.js')));
    expect(src).toMatch(/new Client\(\{[^\n]*allowedMentions:\s*\{\s*parse:\s*\[\s*\]/);
  });
});
