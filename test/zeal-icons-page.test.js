// /zeal-icons: the public gallery of Zeal tag icons and the picture files we host.
//
// Three promises the page makes that nothing else checks:
//  - it stays public and inert (other guilds have no account; the 2026-09-26 audit cleared a page
//    that reads no user and no database);
//  - every image the data names is really in public/ (a guild added to the list without re-running
//    the export would show broken images);
//  - every picture file we hand out passes Zeal's own checks, or a guild downloads a file that the
//    game refuses with "Tag picture skipped".
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GUILDS, SYMBOLS, BADGES, PAW_GLYPHS, PICTURE_RULES, markSrc, guildByCode } from '../web/lib/zealIcons.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';
import { stripJs } from './_source-slice.js';

const WEB = path.join(__dirname, '..', 'web');
const pub = src => path.join(WEB, 'public', src);
const pageFiles = ['page.tsx', 'parts.tsx', 'CopyKey.tsx', '[code]/page.tsx']
  .map(f => path.join(WEB, 'app', 'zeal-icons', f));

// Zeal's header check (tag_arrows.cpp ReadImageSize): a PNG's IHDR, or a true-colour TGA (type 2/10).
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24) return null;
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b[2] !== 2 && b[2] !== 10) return null;
  return { width: b.readUInt16LE(12), height: b.readUInt16LE(14) };
}

describe('/zeal-icons stays public and inert', () => {
  it.each(pageFiles)('%s reads no user, no database, and never redirects to sign-in', file => {
    const src = stripJs(fs.readFileSync(file, 'utf8'));
    expect(src).not.toMatch(/redirect\(\s*['"`]\/auth\/signin/);
    expect(src).not.toMatch(/getSessionUser|supabaseServer|supabaseAdmin|createClient/);
    expect(src).not.toMatch(/<form|type="file"|formData/);
  });
});

describe('every image the data names exists', () => {
  it('guild banners and icons', () => {
    for (const g of GUILDS) {
      expect(fs.existsSync(pub(markSrc.banner(g.code))), `banner ${g.code}`).toBe(true);
      expect(fs.existsSync(pub(markSrc.guild(g.code))), `icon ${g.code}`).toBe(true);
    }
  });
  it('symbols, badges and paws', () => {
    for (const s of SYMBOLS) expect(fs.existsSync(pub(markSrc.symbol(s.image))), s.name).toBe(true);
    for (const n of BADGES) expect(fs.existsSync(pub(markSrc.badge(n))), `badge ${n}`).toBe(true);
    for (const c of PAW_GLYPHS) expect(fs.existsSync(pub(markSrc.paw(c))), `paw ${c}`).toBe(true);
  });
  it('guild codes are unique and fit a tag key', () => {
    const codes = GUILDS.map(g => g.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[A-Z]{2,3}$/);
  });
});

describe('hosted picture files pass Zeal\'s checks', () => {
  const pictures = GUILDS.flatMap(g => (g.pictures || []).map(p => ({ guild: g, ...p })));

  it('there is at least one, so these checks are not vacuous', () => {
    expect(pictures.length).toBeGreaterThan(0);
  });

  it.each(pictures.map(p => [p.file, p]))('%s', (_, p) => {
    const file = pub(markSrc.picture(p.file));
    const bytes = fs.statSync(file).size;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(PICTURE_RULES.maxBytes);
    const size = imageSize(file);
    expect(size, 'a PNG or true-colour TGA header').not.toBeNull();
    expect(size.width).toBeLessThanOrEqual(PICTURE_RULES.maxPixels);
    expect(size.height).toBeLessThanOrEqual(PICTURE_RULES.maxPixels);
    expect({ width: p.width, height: p.height }).toEqual(size);  // The page shows these numbers.
    const [stem, ext] = p.file.split('.');
    expect(['png', 'tga']).toContain(ext.toLowerCase());
    expect(stem).toMatch(new RegExp(`^[A-Za-z0-9]{1,${PICTURE_RULES.maxNameLength}}$`));
    expect(stem.toUpperCase()).toBe(p.guild.code);  // The file name is the key: EUR.png is ^IEUR^.
  });

  it('the header check refuses what Zeal refuses', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zi-'));
    const jpg = path.join(tmp, 'x.png');
    fs.writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]));
    expect(imageSize(jpg)).toBeNull();
    const mapped = path.join(tmp, 'y.tga');
    const tga = Buffer.alloc(40); tga[2] = 1;
    fs.writeFileSync(mapped, tga);
    expect(imageSize(mapped)).toBeNull();
    fs.rmSync(tmp, { recursive: true });
  });
});

describe('link previews', () => {
  it('the gallery and each guild page unfurl with their own title', () => {
    expect(metaForPath('/zeal-icons').title).toBe('Zeal tag icons');
    expect(metaForPath('/zeal-icons/eur').title).toBe('Europa — Zeal tag icon');
    expect(metaForPath('/zeal-icons/nope').title).toBe('WolfPack.quest');
    expect(guildByCode('eur')?.code).toBe('EUR');
  });
});
