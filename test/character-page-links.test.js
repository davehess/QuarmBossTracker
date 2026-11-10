// 2026-11-10, the guild lead: "character page is missing spells link". The header row under a character's name links
// every per-character page that exists under web/app/character/[name]/, Spells included.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const dir = path.join(ROOT, 'web', 'app', 'character', '[name]');
const page = stripJs(readSource(path.join(dir, 'page.tsx')));

describe('the character page header links', () => {
  it('links every per-character page folder', () => {
    const subpages = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'page.tsx')))
      .map(d => d.name).sort();
    expect(subpages).toContain('spells');
    for (const sub of subpages) {
      expect(page, sub).toContain(`href={\`/character/\${encodeURIComponent(displayName)}/${sub}\`}`);
    }
  });
});
