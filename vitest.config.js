import { defineConfig } from 'vitest/config';

// Test discovery excludes.
//
// `.claude/worktrees/` holds transient git worktrees for parallel subagents —
// each is a FULL checkout of this repo, so without this exclude vitest
// discovers every worker's copy of every test file. Observed 2026-08-02 with a
// 5-agent fleet running: 32 files / 375 tests became 191 files / 2223 tests,
// which (a) makes any "the suite passes" claim meaningless, (b) runs each
// agent's in-progress edits as if they were ours, and (c) can fail the suite
// for the coordinator because of a worker's half-finished work.
//
// Everything else here is vitest's default exclude set — spelled out because
// setting `exclude` replaces the defaults rather than extending them.
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/.claude/worktrees/**',
    ],
  },
});
