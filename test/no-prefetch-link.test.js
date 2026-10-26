// test/no-prefetch-link.test.js — automatic link prefetching is off site-wide (the guild lead, 2026-10-25, on Vercel's
// "75% of your free CPU" warning: prefetches were ~80% of the signed-in requests). next.config.js points `next/link` at
// web/components/NoPrefetchLink.tsx, both in the top-level alias and in Next's own per-layer rule aliases, which Next
// keys by the resolved file path (<next>/link.js) and which would otherwise win. The config's webpack() is RUN here
// against a stand-in config shaped like Next 14.2's, so a comment cannot satisfy it.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { ROOT, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const nextConfig = require(path.join(ROOT, 'web/next.config.js'));
const WRAPPER = path.join(ROOT, 'web/components/NoPrefetchLink.tsx');

describe('automatic link prefetching is off', () => {
  it("webpack() swaps Next's rule-level `<next>/link.js` alias and sets the top-level one, and touches nothing else", () => {
    const linkKey = path.join('/x/node_modules/next', 'link.js');
    const imageKey = path.join('/x/node_modules/next', 'image.js');
    const config = {
      resolve: { alias: {} },
      module: { rules: [{ oneOf: [{ resolve: { alias: { [linkKey]: 'next/dist/api/link', [imageKey]: 'next/dist/api/image' } } }] }, null] },
    };
    const out = nextConfig.webpack(config, {});
    expect(out.resolve.alias['next/link$']).toBe(WRAPPER);
    expect(out.module.rules[0].oneOf[0].resolve.alias[linkKey]).toBe(WRAPPER);
    expect(out.module.rules[0].oneOf[0].resolve.alias[imageKey]).toBe('next/dist/api/image');
  });

  it('the wrapper defaults prefetch to false, lets a caller opt in, and imports the link the aliases do not touch', () => {
    const src = stripJs(fs.readFileSync(WRAPPER, 'utf8'));
    expect(src).toMatch(/^'use client';/);
    expect(src).toMatch(/import NextLink from 'next\/dist\/api\/link';/);
    expect(src).toMatch(/\{ prefetch = false, \.\.\.rest \}/);
    expect(src).toMatch(/<NextLink ref=\{ref\} prefetch=\{prefetch\} \{\.\.\.rest\} \/>/);
    expect(src).not.toMatch(/from 'next\/link'/);
  });
});
