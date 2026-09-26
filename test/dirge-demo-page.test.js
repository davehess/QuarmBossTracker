// wolfpack.quest/mimic/dirge: the Dirge Tactical Nuke demo, for posting in Discord (the guild lead,
// 2026-09-26: "throw this up on wolfpack.quest and i'll use it. I want to place it in Discord").
//
// Run: npx vitest run test/dirge-demo-page.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { metaForPath } from '../web/lib/pageMeta.ts';
import { ROOT, stripJs } from './_source-slice.js';

const WEB = path.join(ROOT, 'web');
const page = fs.readFileSync(path.join(WEB, 'public', 'mimic', 'dirge.html'), 'utf8');

describe('the page', () => {
  it('is a whole document that runs the real board on the scripted fight, not the local agent', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<title>Dirge Tactical Nuke — Wolf Pack Mimic</title>');
    for (const bit of ['id="dirge-btns"', 'id="dirge-key"', 'id="dirge-disc"', 'Dirge Team 6 · Tactical Nuke', 'function paintDirge(']) {
      expect(page, bit).toContain(bit);
    }
    // The fetch stand-in comes before the overlay script, or the overlay asks 127.0.0.1 for its state.
    expect(page.indexOf('window.fetch = function')).toBeGreaterThan(-1);
    expect(page.indexOf('window.fetch = function')).toBeLessThan(page.indexOf('function paintDirge('));
  });

  it('is served at /mimic/dirge', () => {
    const cfg = stripJs(fs.readFileSync(path.join(WEB, 'next.config.js'), 'utf8'));
    expect(cfg).toContain("{ source: '/mimic/dirge', destination: '/mimic/dirge.html' }");
  });
});

describe('the Discord card', () => {
  it('the link preview names the page and carries its picture, a 1200×630 PNG that exists', () => {
    const m = metaForPath('/mimic/dirge');
    expect(m).toMatchObject({ title: 'Dirge Tactical Nuke', image: '/mimic/dirge-card.png' });
    const png = fs.readFileSync(path.join(WEB, 'public', m.image));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(metaForPath('/mimic').image).toBeUndefined();          // other pages keep the small card
  });

  it('the preview endpoint sends the big card only when a page has a picture', () => {
    const route = stripJs(fs.readFileSync(path.join(WEB, 'app', 'api', 'embed-meta', 'route.ts'), 'utf8'));
    expect(route).toContain('<meta property="og:image" content="${escHtml(img)}">');
    expect(route).toContain("<meta name=\"twitter:card\" content=\"${img ? 'summary_large_image' : 'summary'}\">");
  });
});

describe('the generator', () => {
  it('refuses a melody.html without the board, so it never publishes a page with nothing on it', () => {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dirge-')), 'melody.html');
    fs.writeFileSync(tmp, '<html><head><style></style></head><body><script></script></body></html>');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-dirge-demo.js'), tmp], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/has no dirge-board:css:start/);
  });
});
