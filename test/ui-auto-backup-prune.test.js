// Mimic's "Keep in sync" backs up after every camp; the bot keeps only the newest few of those per character and
// computer (the guild lead, 2026-11-01), so they never push hand-made backups out of the list. Behaviour test of
// _pruneAutoUiSnapshots against a stub Supabase.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { sliceBlock, stripJs } from './_source-slice.js';

const main = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const block = sliceBlock(main, "const _UI_AUTO_LABEL = 'Auto: after camp';", '\n}\n');

function harness(ids) {
  const calls = [];
  const supabase = {
    select: async (table, q) => { calls.push(['select', table, q]); return ids.map(id => ({ id })); },
    del: async (table, q) => { calls.push(['del', table, q]); },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('require', block + '\nreturn _pruneAutoUiSnapshots;')(() => supabase);
  return { fn, calls };
}
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

describe('pruning automatic UI backups', () => {
  it('deletes all but the newest five, only automatic ones of that character and computer', async () => {
    const { fn, calls } = harness([1, 2, 3, 4, 5, 6, 7].map(uuid));
    await fn('111', 'Aldenmar', 'GAMING-PC');
    const [sel, del] = calls;
    expect(sel[2]).toMatch(/label=eq\.Auto%3A%20after%20camp/);
    expect(sel[2]).toMatch(/machine_name=eq\.GAMING-PC/);
    expect(sel[2]).toMatch(/order=created_at\.desc/);
    expect(del[1]).toBe('ui_snapshots');
    expect(del[2]).toMatch(/label=eq\.Auto%3A%20after%20camp/);
    expect(del[2]).toMatch(new RegExp(`id=in\\.\\(${uuid(6)},${uuid(7)}\\)$`));
  });
  it('deletes nothing at five or fewer, and matches a nameless computer with is.null', async () => {
    const { fn, calls } = harness([1, 2, 3, 4, 5].map(uuid));
    await fn('111', 'Aldenmar', null);
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatch(/machine_name=is\.null/);
  });
  it('runs only for an automatic backup', () => {
    const upload = stripJs(sliceBlock(main, 'async function _handleAgentUiLayoutUpload', 'async function _handleAgentUiLayoutList'));
    expect(upload).toMatch(/if \(label === _UI_AUTO_LABEL\) \{\s*_pruneAutoUiSnapshots\(/);
  });
});
