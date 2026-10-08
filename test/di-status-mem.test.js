// test/di-status-mem.test.js — the bot relays "is DI on the cleric's spell bar" (FB-62).
//
// FB-62 (a member, 2026-10-07): the CH chain showed every cleric as having Divine Intervention
// available unless a DI cast had been seen. Agent 3.7.98+ sends `di_mem` (true / false / null) on
// its live-state row; the bot stores it in character_live_state.di_mem (migration
// 20261007230000_live_state_di_mem) and relays it as `mem` on /api/agent/di-status, where the
// CH chain shows a tick only for mem === true and off recast.
//
// Text assertions run on comment-stripped source (CLAUDE.md: comments satisfy text assertions).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const bot = readSource(path.join(ROOT, 'index.js'));

describe('di_mem: stored on the live-state row, relayed as mem on di-status', () => {
  it('the live-state handler keeps only a real boolean and writes it beside di_ready_at', () => {
    const code = stripJs(bot);
    expect(code).toMatch(/const diMem = typeof st\?\.di_mem === 'boolean' \? st\.di_mem : null;/);
    expect(code).toMatch(/di_ready_at: diReadyAt,\s*di_mem:\s*diMem,/);
  });

  it('di-status selects di_mem and relays it as mem, null when unknown', () => {
    const block = stripJs(sliceBlock(bot, "      `&select=character,di_ready_at", "    if (typeof r.self_mana_pct === 'number') {"));
    expect(block).toMatch(/select=character,di_ready_at,di_mem,/);
    expect(block).toMatch(/mem: typeof r\.di_mem === 'boolean' \? r\.di_mem : null/);
  });

  it('the column exists in a committed migration, additive and idempotent', () => {
    const dir = path.join(ROOT, 'supabase', 'migrations');
    const f = fs.readdirSync(dir).find(n => /live_state_di_mem\.sql$/.test(n));
    expect(f).toBeTruthy();
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    expect(sql).toMatch(/alter table public\.character_live_state add column if not exists di_mem boolean;/i);
  });
});
