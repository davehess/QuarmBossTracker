// /admin/links — "Staged by their owner, not in OpenDKP yet".
//
// A character filed from Mimic's first sign-in has a row, an owner (discord_id) and a
// registered_via_web_at stamp, but no opendkp_id. It used to sit in NEITHER review list
// ("Not in OpenDKP" wants no row; "awaiting claim" wants no owner). These assertions run on
// the comment-stripped source, so a comment cannot satisfy them.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const read = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const page = read('web/app/admin/links/page.tsx');
const queue = read('web/lib/admin-queue.ts');

// The staged read: from its .select(...) to the end of the chain (.order(...)).
const stagedQuery = (() => {
  const at = page.indexOf(".select('name, rank, class, discord_id, registered_via_web_at')");
  expect(at, 'staged query select not found').toBeGreaterThan(-1);
  const end = page.indexOf(".order('registered_via_web_at'", at);
  expect(end, 'staged query order not found').toBeGreaterThan(at);
  return page.slice(at, end + 80);
})();

describe('/admin/links staged-by-owner queue', () => {
  it('reads characters for the guild with the three-part predicate', () => {
    expect(stagedQuery).toContain(".eq('guild_id', GUILD_TAG)");
    expect(stagedQuery).toContain(".not('registered_via_web_at', 'is', null)");
    expect(stagedQuery).toContain(".is('opendkp_id', null)");
    expect(stagedQuery).toContain(".not('discord_id', 'is', null)");
  });

  it('drops an ignored row, so the Ignore button actually removes it', () => {
    expect(stagedQuery).toContain(".eq('link_ignored', false)");
  });

  it('is newest first and selects only the columns the table shows', () => {
    expect(stagedQuery).toContain(".order('registered_via_web_at', { ascending: false })");
    const select = stagedQuery.match(/\.select\('([^']+)'\)/)[1];
    expect(select.split(',').map(s => s.trim())).toEqual(['name', 'rank', 'class', 'discord_id', 'registered_via_web_at']);
  });

  it('shows name, owner, rank, class (or a dash) and when it was staged, with the shared Register row', () => {
    expect(page).toContain('Staged by their owner, not in OpenDKP yet');
    expect(page).toMatch(/\{s\.rank \|\| '—'\} · \{s\.cls \|\| '—'\}/);
    expect(page).toContain('{s.ownerLabel}');
    expect(page).toContain('new Date(s.stagedAt).toLocaleString()');
    expect(page).toMatch(/<OpenDkpRegisterRow\s+name=\{s\.name\}/);
  });

  it('carries a count badge like the other queues', () => {
    expect(page).toMatch(/Staged by their owner, not in OpenDKP yet \{stagedView\.length > 0 && <span className="text-gold">\(\{stagedView\.length\}\)<\/span>\}/);
  });

  it('never lists a row that "awaiting claim" also lists (discord_id NULL vs NOT NULL)', () => {
    // "awaiting claim" in the officer queue wants NO owner...
    const awaiting = queue.slice(queue.indexOf('async function loadAwaitingOpenDKPClaim'));
    expect(awaiting.slice(0, awaiting.indexOf('return {'))).toContain(".is('discord_id', null)");
    // ...the page's own unlinked list wants no owner...
    expect(page).toMatch(/unlinkedActive\s*=\s*allChars\.filter\(c => +c\.active && !c\.discord_id/);
    // ...and the staged queue requires one.
    expect(stagedQuery).not.toContain(".is('discord_id', null)");
    expect(stagedQuery).toContain(".not('discord_id', 'is', null)");
  });

  it('lives in the same Promise.all as the other reads and is rendered between Not in OpenDKP and the toggles', () => {
    expect(page).toContain('{ data: stagedRaw }] = await Promise.all([');
    const notIn = page.indexOf('🆕 Not in OpenDKP');
    const staged = page.indexOf('🌱 Staged by their owner');
    const toggles = page.indexOf('<nav className="text-xs flex items-center gap-2 flex-wrap">');
    expect(notIn).toBeGreaterThan(-1);
    expect(staged).toBeGreaterThan(notIn);
    expect(toggles).toBeGreaterThan(staged);
  });

  it('does not file a recruit that is its own family root as an alt of itself', () => {
    expect(page).toMatch(/selfRoot \? null : parent\.name/);
    expect(page).toMatch(/selfRoot \? null : parent\.opendkpId/);
  });
});
