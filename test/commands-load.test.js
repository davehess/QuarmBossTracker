// Every slash command must build. discord.js validates a SlashCommandBuilder when
// toJSON() runs (description <= 100 chars, name pattern, option limits), and index.js
// swallows a throw at require/boot as "Failed to load <file>" — so one bad description
// silently un-registered /enragedeath for four months. This walks commands/ and fails
// with the file name.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const dir = path.join(ROOT, 'commands');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

describe('commands/ all load and build', () => {
  it('finds the command files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const file of files) {
    it(`${file} requires and its data builds`, () => {
      const cmd = require(path.join(dir, file));
      // Helper modules in commands/ (no .data) are skipped by index.js too.
      if (!cmd.data) return;
      expect(() => cmd.data.toJSON(), file).not.toThrow();
    });
  }
});
