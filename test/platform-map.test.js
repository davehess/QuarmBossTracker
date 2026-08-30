// The platform map: wolfpack.quest on top, everything else feeding it in
// columns, hover to list a column's elements (Hitya, 2026-08-28).
//
// ⚠ The assertion that matters most is the module split. Making the map a
// client component marked EVERY export in its file client-side — including the
// plain BRANCHES array that /platform and / (server components) map over to
// build their drill-down cards. That fails at RUNTIME with "Attempted to call
// map() from the server but map is on the client": it type-checks, it builds,
// and the page 500s. Only loading it shows the problem, so it gets a test.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.join(__dirname, '..', 'web');
const read = f => fs.readFileSync(path.join(WEB, f), 'utf8');
import { stripJs as strip } from './_source-slice.js';

const map = strip(read('components/PlatformMap.tsx'));
// ⚠ Stripped like the rest. This file's own header explains why it must not
// carry `'use client'`, and that explanation failed the assertion looking for
// its absence. Fourth time a comment has stood in for the code in this repo —
// negative assertions are just as vulnerable as positive ones.
const data = strip(read('components/platformData.ts'));
const platformPage = strip(read('app/platform/page.tsx'));
const landing = strip(read('app/page.tsx'));

describe('platform map', () => {
  it('keeps the branch data OUT of the client module', () => {
    // `'use client'` applies to the whole module, not to one export.
    expect(read('components/PlatformMap.tsx')).toMatch(/^'use client';/);
    expect(data).not.toMatch(/use client/);
    expect(data).toMatch(/export const BRANCHES/);
    expect(map).not.toMatch(/export const BRANCHES/);
  });

  it.each([['app/platform/page.tsx', platformPage], ['app/page.tsx', landing]])(
    '%s imports data from the data module, never through the client one',
    (_name, src) => {
      const importsBranchData = /BRANCHES|TINT|STATS/.test(src);
      if (!importsBranchData) return;                     // page uses only the components
      const fromClient = src.match(/import \{([^}]*)\} from '@\/components\/PlatformMap'/);
      if (fromClient) {
        expect(fromClient[1]).not.toMatch(/BRANCHES|TINT|STATS/);
      }
      expect(src).toMatch(/from '@\/components\/platformData'/);
    },
  );

  it('puts wolfpack.quest on top and everything else underneath', () => {
    expect(map).toMatch(/const ROOT_ID = 'web'/);
    // The root is lifted OUT of the columns, not drawn twice.
    expect(map).toMatch(/BRANCHES\.filter\(b => b\.id !== ROOT_ID\)/);
    expect(map).toMatch(/BRANCHES\.find\(b => b\.id === ROOT_ID\)/);
  });

  it('lists a column\'s elements on hover, and always on touch', () => {
    // There is no hover to discover on a phone, and a tap-toggle would fight
    // the card's own link — the exact bug the nav disclosure took four tries
    // to kill. So `canHover` decides and nothing else does.
    expect(map).toMatch(/const open = canHover \? hovered : true/);
    expect(map).toMatch(/hover: hover\) and \(pointer: fine/);
    expect(map).toMatch(/onMouseEnter=\{\(\) => canHover && setHovered\(true\)\}/);
    expect(map).toMatch(/onMouseLeave=\{\(\) => canHover && setHovered\(false\)\}/);
    // The list is the branch's own detail names, not a second hand-written set.
    expect(map).toMatch(/b\.details\.map/);
  });

  it('reflows instead of demanding a width floor', () => {
    // The radial SVG it replaced was laid out on a 1200x780 viewBox with labels
    // in user units, so it could not shrink and needed a sideways drag.
    for (const src of [platformPage, landing]) {
      expect(src).not.toMatch(/min-w-\[\d+px\]/);
    }
    expect(map).not.toMatch(/viewBox/);
  });

  it('does not underline its own card text on hover', () => {
    // globals.css sets `a:hover { text-decoration: underline }` and these cards
    // are anchors, so hovering underlined the whole column, list included.
    expect(map).toMatch(/hover:no-underline/);
  });
});
