// Every GitHub Actions workflow must actually PARSE.
//
// Why this exists (2026-08-03): golden-log.yml — the parser regression net from
// #75 — carried its drill step as a one-line `run:` whose script contained
// "drill: golden digest mismatch". A colon-space inside a PLAIN yaml scalar is a
// mapping indicator, so the file was invalid yaml and GitHub could not parse it.
// The failure is nearly silent: the run reports `failure` with ZERO jobs and is
// listed under the file path (".github/workflows/golden-log.yml") instead of the
// workflow's `name:`. It looked like a workflow that ran and failed. In fact it
// never ran once between landing and being fixed, so a check we believed was
// guarding the parser was guarding nothing.
//
// A red workflow gets investigated; a workflow that cannot start does not. Hence
// this test: cheap, dependency-light, and it fails LOCALLY before the push.
//
// Run: npx vitest run test/workflow-yaml.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// js-yaml v5 is ESM with NAMED exports and no default — `import yaml from` is
// undefined there, which silently turns every assertion below into a crash
// rather than a yaml verdict.
import { load as yamlLoad } from 'js-yaml';

const WF_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows',
);

const files = fs.existsSync(WF_DIR)
  ? fs.readdirSync(WF_DIR).filter(f => /\.ya?ml$/i.test(f)).sort()
  : [];

describe('.github/workflows — every file is valid, runnable yaml', () => {
  it('found workflow files to check', () => {
    expect(files.length, 'no workflows found — did the directory move?').toBeGreaterThan(0);
  });

  for (const f of files) {
    describe(f, () => {
      const raw = fs.readFileSync(path.join(WF_DIR, f), 'utf8');
      let doc, parseErr = null;
      try { doc = yamlLoad(raw); } catch (e) { parseErr = e; }

      it('parses as yaml', () => {
        // The exact failure mode that disabled golden-log: a ": " inside a plain
        // one-line `run:` scalar. Surface the message, it names line + column.
        expect(parseErr && parseErr.message, `${f} is not valid yaml — GitHub will fail the run with zero jobs`).toBeNull();
      });

      it('declares at least one job', () => {
        if (parseErr) return;   // already reported above
        expect(doc, `${f} parsed to nothing`).toBeTruthy();
        const jobs = doc.jobs && Object.keys(doc.jobs);
        expect(jobs && jobs.length, `${f} declares no jobs — the run would do nothing`).toBeGreaterThan(0);
      });

      it('has a trigger and a name', () => {
        if (parseErr) return;
        // yaml 1.1 parses a bare `on:` key as boolean true — accept either, since
        // both are what GitHub actually reads.
        const trigger = doc && (doc.on !== undefined ? doc.on : doc[true]);
        expect(trigger, `${f} has no 'on:' trigger`).toBeTruthy();
        expect(typeof doc.name, `${f} has no 'name:' — runs list under the file path, which hides parse failures`).toBe('string');
      });
    });
  }
});
