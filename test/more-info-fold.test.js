// Long instruction text folds in place behind "Click here for more info" (the guild lead picked A on the
// Decision Desk, 2026-10-19; DECISIONS §168 / §383). The first sentence stays; the rest folds.
//
// What this guards:
//  - the splitter keeps the first sentence and does not cut inside "3.3.85" or "e.g. agent";
//  - the swept pages still use the shared component (a revert to a wall of text would pass type-check);
//  - the warnings that must stay in view were NOT folded.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { splitFirstSentence, FOLD_MIN_WORDS } from '../web/lib/foldText.ts';
import { stripJs } from './_source-slice.js';

const WEB = path.join(__dirname, '..', 'web');
const read = rel => fs.readFileSync(path.join(WEB, rel), 'utf8');

describe('splitFirstSentence', () => {
  const long = 'Fleet-wide dormancy is on. ' + 'Every agent stops its uploads and goes quiet until you clear it, '
    + 'keeping only its heartbeat, so recovery is instant when the switch comes off again. '
    + 'The durable queue holds and nothing is dropped.';

  it('keeps the first sentence and folds the rest', () => {
    const { first, rest } = splitFirstSentence(long);
    expect(first).toBe('Fleet-wide dormancy is on.');
    expect(rest).toMatch(/^Every agent stops/);
    expect(rest).toMatch(/nothing is dropped\.$/);
  });

  it('leaves short text whole', () => {
    const short = 'One sentence. Another one, both short.';
    expect(short.split(/\s+/).length).toBeLessThan(FOLD_MIN_WORDS);
    expect(splitFirstSentence(short)).toEqual({ first: short, rest: null });
  });

  it('does not cut inside a version number or "e.g."', () => {
    const t = 'Enter the numeric form of a version, e.g. agent 3.3.85 becomes 30385 for the floor field on this page. '
      + 'Any agent below the floor pauses its uploads exactly like the kill switch does, and shows an update nudge '
      + 'on its dashboard until it has been updated.';
    const { first, rest } = splitFirstSentence(t);
    expect(first).toBe('Enter the numeric form of a version, e.g. agent 3.3.85 becomes 30385 for the floor field on this page.');
    expect(rest).toMatch(/^Any agent below the floor/);
  });

  it('a long single sentence stays whole (nothing to fold)', () => {
    const one = Array(40).fill('word').join(' ') + '.';
    expect(splitFirstSentence(one).rest).toBeNull();
  });
});

describe('the swept pages fold their instruction text', () => {
  const FOLDED = [
    'app/admin/page.tsx', 'app/admin/overlays/page.tsx', 'app/admin/signups/page.tsx', 'app/admin/queue/page.tsx',
    'app/admin/agents/page.tsx', 'app/admin/lockouts/page.tsx', 'app/admin/readiness/page.tsx',
    'app/admin/anomalies/page.tsx', 'app/admin/attendance/page.tsx', 'app/admin/comp/page.tsx',
    'app/admin/extra-spells/page.tsx', 'app/admin/rules/page.tsx', 'app/admin/adoption/page.tsx',
    'app/admin/links/page.tsx', 'app/admin/console/page.tsx', 'app/admin/triggers/page.tsx',
    'app/raid/RaidView.tsx', 'app/roadmap/page.tsx', 'components/RoadmapQueue.tsx', 'app/start/page.tsx',
    'app/ai/page.tsx', 'app/buffs/BuffsGrid.tsx', 'app/opendkp/page.tsx', 'app/quartermaster/page.tsx',
    'app/rolls/page.tsx', 'app/planner/page.tsx', 'app/pop/page.tsx', 'app/roster/page.tsx', 'app/parses/page.tsx',
    'app/pvp/server/page.tsx', 'app/me/inventory/page.tsx', 'app/me/ui/page.tsx', 'app/me/ui/UiStudioClient.tsx',
    'app/character/[name]/gear/page.tsx', 'app/character/[name]/factions/page.tsx',
    'app/character/[name]/spells/page.tsx',
  ];

  it.each(FOLDED)('%s imports and renders the shared fold', rel => {
    const src = stripJs(read(rel));
    expect(src).toMatch(/from '@\/components\/MoreInfo'/);
    expect(src).toMatch(/<(MoreInfo|FoldText)\b/);
  });

  it('the component is a plain <details> with the pattern /pop already uses', () => {
    const src = stripJs(read('components/MoreInfo.tsx'));
    expect(src).toMatch(/<details\b/);
    expect(src).toMatch(/Click here for more info/);
  });
});

describe('warnings that must be seen are not folded', () => {
  it('the /buffs accuracy banner is plain text', () => {
    const src = stripJs(read('app/buffs/BuffsGrid.tsx'));
    const i = src.indexOf('Read this before trusting any of these rows');
    expect(i).toBeGreaterThan(0);
    const banner = src.slice(i - 400, i + 900);   // the whole red box, before and after its heading
    expect(banner).not.toMatch(/MoreInfo|<details/);
  });

  it('a /admin/overlays danger switch keeps its caution in view', () => {
    const src = stripJs(read('app/admin/overlays/page.tsx'));
    expect(src).toMatch(/f\.danger\s*\?\s*<p\b/);
  });

  it('the /admin/console pause-the-fleet warning is not inside a fold', () => {
    const src = stripJs(read('app/admin/console/ConsoleControls.tsx'));
    expect(src).not.toMatch(/MoreInfo|<details/);
  });
});
