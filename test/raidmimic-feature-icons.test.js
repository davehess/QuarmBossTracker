// test/raidmimic-feature-icons.test.js — the eight feature icons and their grid on raidmimic.com (the guild lead, 2026-10-23:
// the feature icon set, "the second set looks best"). Pins: eight hand-drawn inline SVGs on one 48 x 48 box, gold by
// `currentColor`, no raster or request, decorative (aria-hidden) with the label as the text; the story stage draws four of them as its marks (the card grid was
// retired with the "Pick your path" page, 2026-11-01); the copy module is plain, public-safe and honest about what needs a hub.
//
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// Run: npx vitest run test/raidmimic-feature-icons.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import * as F from '../web/lib/raidmimicFeatures.ts';
import * as PL from '../web/lib/raidmimicPlayer.ts';
import * as S from '../web/lib/raidmimicStory.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel) => stripJs(read(rel));
const L = 'web/app/raidmimic/_landing/';
const icons = code(L + 'FeatureIcons.tsx');
const stage = code(L + 'StoryStage.tsx');

// The text of each icon function, by exported name.
const iconBodies = () => [...icons.matchAll(/export function (\w+Icon)\(\) \{([\s\S]*?)\n\}/g)].map(m => [m[1], m[2]]);

describe('the eight icons', () => {
  it('are eight, one per feature, in the order of the content module', () => {
    expect(F.FEATURES.map(f => f.id)).toEqual(['timers', 'map', 'target', 'damage', 'loot', 'hail', 'ch', 'code']);
    expect(iconBodies().map(([n]) => n)).toEqual([
      'TimersIcon', 'MapIcon', 'TargetIcon', 'DamageIcon', 'LootIcon', 'HailIcon', 'ChIcon', 'CodeIcon',
    ]);
    expect(icons).toMatch(/ICONS: Record<FeatureId, \(\) => ReactNode> = \{\s*timers: TimersIcon, map: MapIcon, target: TargetIcon, damage: DamageIcon,\s*loot: LootIcon, hail: HailIcon, ch: ChIcon, code: CodeIcon,/);
  });
  it('each is drawn in the one shared svg: a 48 x 48 viewBox, gold by currentColor, one stroke weight, round caps and joins', () => {
    const svg = icons.match(/<svg [\s\S]*?>/)[0];
    expect(icons.match(/<svg\b/g)).toHaveLength(1);                    // every icon goes through the one wrapper
    expect(svg).toMatch(/viewBox="0 0 48 48"/);
    expect(svg).toMatch(/stroke="currentColor"/);
    expect(svg).toMatch(/fill="none"/);
    expect(svg).toMatch(/strokeWidth=\{2\.25\}/);
    expect(svg).toMatch(/strokeLinecap="round"/);
    expect(svg).toMatch(/strokeLinejoin="round"/);
    for (const [name, body] of iconBodies()) expect(body, name).toMatch(/^\s*return \(\s*<Ico>/);
  });
  it('are decorative: aria-hidden on the drawing and on its box, the label is the text', () => {
    expect(icons.match(/aria-hidden="true"/g)).toHaveLength(1);        // the one drawing wrapper
    expect(icons).toMatch(/focusable="false"/);
    expect(stage).toMatch(/<span aria-hidden="true" className="block h-7 w-7 text-\[#e0a92c\] sm:h-8 sm:w-8"><Icon \/><\/span>/);   // its box
    expect(stage).toMatch(/<span className="text-\[11px\][^"]*">\{m\.label\}<\/span>/);   // the label is the text
    expect(icons).not.toMatch(/<title>|aria-label=/);              // no second name for a screen reader to read
  });
  it('are inline paths only: no raster, no image, no external address, no data URI, no script', () => {
    expect(icons).not.toMatch(/<image\b|<img\b|<foreignObject|<use\b|<script|href=|xlink|url\(|data:|https?:|\.png|\.jpg|\.webp|\.svg/i);
    const from = [...icons.matchAll(/from '([^']+)'/g)].map(m => m[1]);
    expect(from).toEqual(['react', '@/lib/raidmimicFeatures']);   // React's types and our own modules only
  });
  it('draw something: every icon has at least two shapes, and the accents are the platform’s green and red only', () => {
    for (const [name, body] of iconBodies()) {
      expect((body.match(/<(path|rect|circle)\b/g) || []).length, name).toBeGreaterThanOrEqual(2);
    }
    const bodyOf = (n) => iconBodies().find(([x]) => x === n)[1];
    expect(bodyOf('MapIcon')).toMatch(/stroke-green/);
    expect(bodyOf('HailIcon')).toMatch(/stroke-green/);
    expect(bodyOf('ChIcon')).toMatch(/stroke-red/);
    const accents = [...icons.matchAll(/\bstroke-(\w+)\b/g)].map(m => m[1]);
    expect([...new Set(accents)].sort()).toEqual(['green', 'panel', 'red']);   // panel only cuts a line behind a shape
    expect(icons).not.toMatch(/stroke="#|fill="#/i);
  });
  it('gold is the page’s own gold (#e0a92c, the hover gold) set once on the mark’s box (the stage), not inside the drawings', () => {
    expect(stage.match(/text-\[#e0a92c\]/g)).toHaveLength(1);
    expect(icons).not.toMatch(/#e0a92c/);
    for (const [name, body] of iconBodies()) expect(body, name).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe('the story stage’s marks (the card grid is retired)', () => {
  it('the icons file draws icons only: no grid, no section, no card, no default export', () => {
    expect(icons).not.toMatch(/FeatureGrid|<section\b|grid-cols|bg-panel p-|export default/);
  });
  it('the stage draws each mark with the icon its module row names, from the one ICONS map', () => {
    expect(stage).toMatch(/import \{ ICONS \} from '\.\/FeatureIcons';/);
    expect(stage).toMatch(/const Icon = ICONS\[m\.icon\];/);
    for (const m of S.MARKS) expect(F.FEATURES.map(f => f.id), m.id).toContain(m.icon);
  });
});

describe('the words', () => {
  const all = JSON.stringify([F.FEATURES_HEAD, F.FEATURES]);
  it('eight labels and eight lines, each short and plain, none repeated', () => {
    expect(F.FEATURES).toHaveLength(8);
    expect(new Set(F.FEATURES.map(f => f.label)).size).toBe(8);
    expect(new Set(F.FEATURES.map(f => f.line)).size).toBe(8);
    for (const f of F.FEATURES) {
      expect(f.label.length, f.id).toBeGreaterThan(2);
      expect(f.label.length, f.id).toBeLessThanOrEqual(20);
      expect(f.line.length, f.id).toBeGreaterThan(30);
      expect(f.line.length, f.id).toBeLessThanOrEqual(100);
      expect(f.line, f.id).toMatch(/[.]$/);
    }
    expect(F.FEATURES.map(f => f.label)).toEqual([
      'Timers', 'Map', 'Target Info', 'Damage meter', 'Loot rolls', 'Hail board', 'CH chain', 'Join with a code',
    ]);
  });
  it('says what needs a guild hub: the hail board and the CH chain carry the page’s own chip, DKP bids say so in their line', () => {
    expect(F.FEATURES.filter(f => f.hub).map(f => f.id)).toEqual(['hail', 'ch']);
    expect(PL.TAG.hub).toBe('Needs your guild’s server');
    expect(F.FEATURES.find(f => f.id === 'loot').line).toMatch(/DKP bids need a guild hub/);
    expect(F.FEATURES.find(f => f.id === 'code').line).toMatch(/No guild account needed/);
  });
  it('matches the page’s other facts: the code works without a guild, the Guild door lists the CH chain and Command Center', () => {
    const guild = PL.DOORS.find(d => d.id === 'guild').points.join(' ');
    expect(guild).toMatch(/CH chain and Command Center/);
    expect(read('web/lib/raidmimicSetup.ts')).toMatch(/Join a raid with a code/);
    expect(read('web/lib/raidmimicSetup.ts')).toMatch(/No guild account needed/);
  });
  it('invents no price, count, testimonial or promise, and names no person, id or address', () => {
    expect(all).not.toMatch(/\$|£|€|\bper (?:month|year|seat|user|raider)\b|% off|money-back/i);
    expect(all).not.toMatch(/\b\d[\d,]*\+? (?:guilds|customers|raiders|users|teams)\b/i);
    expect(all).not.toMatch(/testimonial|trusted by|loved by|\bsaid\b|uptime|SLA\b|guaranteed|coming soon/i);
    expect(all).not.toMatch(/sign up|contact sales|as a service|orchestration|enterprise/i);
    expect(all).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|zhtoekwakucbckvatfky|service_role|SUPABASE_|Bearer |mailto:|\b[a-z0-9]{32,}\b/i);
    expect(code('web/lib/raidmimicFeatures.ts')).not.toMatch(/Aldenmar|Brackwyn|Corvale|Rethlan|Nyssara|Theodric|Velmira|Zarrin/);
  });
});
