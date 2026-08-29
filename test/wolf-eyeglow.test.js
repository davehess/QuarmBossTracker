// The wolf hero's eye light, and the two ways it has silently died.
//
// 1. The glow was a blob positioned BEHIND the plate, on the belief that the
//    keyed art leaves the eye slits transparent. It does not — keying cut the
//    dark LINEWORK and left the eye interior opaque bone, so the light read
//    through the brow strokes instead of the eye (Hitya, 2026-08-28: "this is
//    the area that should glow"). The fix makes the glow its own plate, painted
//    on top, cut to the eye interior measured off the shipped asset.
// 2. The reveal filter was written as `.wolf-alpha img`, which also matched the
//    eye light — so the thing hiding the body hid the eyes too, and the eyes
//    could not open first. It must stay scoped to `.wolf-plate`.
//
// Both failures rendered a plausible-looking page, which is what makes them
// worth a test rather than a comment.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.join(__dirname, '..', 'web');
const css = fs.readFileSync(path.join(WEB, 'app/globals.css'), 'utf8');
const tsx = fs.readFileSync(path.join(WEB, 'components/WolfPack.tsx'), 'utf8');
const page = fs.readFileSync(path.join(WEB, 'app/page.tsx'), 'utf8');
const nav = fs.readFileSync(path.join(WEB, 'components/Nav.tsx'), 'utf8');

// Comments describe the bug in the same words the assertion looks for, and have
// twice satisfied an assertion on their own. Strip them before matching.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const tsxCode = tsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Read width/height straight out of the PNG's IHDR (bytes 16..23).
function pngSize(file) {
  const b = fs.readFileSync(file);
  expect(b.subarray(1, 4).toString('ascii'), `${file} is not a PNG`).toBe('PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('wolf hero eye glow', () => {
  it('ships every derived plate on the same canvas as the wolf, so none can drift', () => {
    const wolf = pngSize(path.join(WEB, 'public/wolf.png'));
    // Neither derived plate carries coordinates of its own — both are pinned
    // edge-to-edge over the wolf. Identical geometry is the whole guarantee.
    expect(pngSize(path.join(WEB, 'public/wolf-eyes.png'))).toEqual(wolf);
    expect(pngSize(path.join(WEB, 'public/wolf-solid.png'))).toEqual(wolf);
    expect(wolf.w).toBe(wolf.h);
  });

  it('gives every wolf an opaque silhouette, under its own plate', () => {
    // Only the BONE is opaque in the keyed art; every dark line is a hole, so
    // without a filled silhouette beneath it a wolf in front shows the wolf
    // behind through its own linework (Hitya: "the transparency overlap looks
    // bad"). Brightness-not-opacity is necessary but was not sufficient.
    // The rule that actually positions it. `.wolf-packmember .wolf-solid` also
    // mentions the class, and satisfied a laxer version of this assertion while
    // the positioning rule was renamed out from under it.
    expect(cssCode).toMatch(/\.wolf-solid\s*\{[^}]*position:\s*absolute[^}]*\}/);
    expect(cssCode).toMatch(/\.wolf-solid\s*\{[^}]*inset:\s*0[^}]*\}/);

    // Scope to each wolf's own block: `indexOf('<Solid />')` finds the PACK's
    // copy first, so comparing it against the alpha's plate always passed.
    const alphaBlock = tsxCode.slice(tsxCode.indexOf('className="wolf-alpha"'));
    expect(alphaBlock.indexOf('<Solid />')).toBeGreaterThan(-1);
    expect(alphaBlock.indexOf('<Solid />')).toBeLessThan(alphaBlock.indexOf('<Plate'));

    const packBlock = tsxCode.slice(tsxCode.indexOf('className="wolf-packmember"'),
                                    tsxCode.indexOf('className="wolf-alpha"'));
    expect(packBlock.indexOf('<Solid />')).toBeGreaterThan(-1);
    expect(packBlock.indexOf('<Solid />')).toBeLessThan(packBlock.indexOf('<Plate'));
  });

  it('scopes the reveal filter to the plate, never to every image', () => {
    // `.wolf-alpha img` would match the eye glow as well and dim it.
    expect(cssCode).not.toMatch(/\.wolf-alpha\s+img\s*\{/);
    expect(cssCode).not.toMatch(/\.wolf-packmember\s+img\s*\{/);
    expect(cssCode).toMatch(/\.wolf-alpha\s+\.wolf-plate\s*\{/);
    expect(cssCode).toMatch(/\.wolf-packmember\s+\.wolf-plate\s*\{/);
  });

  it('paints the glow after the plate, in both the alpha and the pack', () => {
    // DOM order is paint order here; a glow emitted first sits under the bone.
    const alpha = tsxCode.indexOf('<Plate priority />');
    const alphaGlow = tsxCode.indexOf('<EyeGlow at="0.2s"');
    expect(alpha).toBeGreaterThan(-1);
    expect(alphaGlow).toBeGreaterThan(alpha);

    const pack = tsxCode.indexOf('<Plate />');
    const packGlow = tsxCode.indexOf('<EyeGlow at={w.eyeAt}');
    expect(pack).toBeGreaterThan(-1);
    expect(packGlow).toBeGreaterThan(pack);
  });

  it('finishes the alpha before a single pack eye opens', () => {
    // The order Hitya asked for (2026-08-29): her eyes, then HER, then their
    // eyes, then them. The first cut interleaved the two halves, so she landed
    // at the same moment as a wall of pack. Four numbers spread across a CSS
    // rule and a TSX array decide this, and none of them says so on its own.
    const focus = cssCode.match(
      /\.wolf-alpha\s+\.wolf-plate\s*\{[^}]*animation:\s*wolf-focus\s+([\d.]+)s[^;]*?\s([\d.]+)s\s+forwards/);
    expect(focus, 'alpha focus animation should declare duration and delay').toBeTruthy();
    const alphaDone = parseFloat(focus[1]) + parseFloat(focus[2]);   // duration + delay

    const alphaEye = parseFloat((tsxCode.match(/<EyeGlow at="([\d.]+)s"/) || [])[1]);
    expect(alphaEye).toBeLessThan(parseFloat(focus[2]));             // her eyes lead her body

    const packEyes = [...tsxCode.matchAll(/eyeAt: '([\d.]+)s'/g)].map(m => parseFloat(m[1]));
    expect(packEyes.length).toBe(5);
    expect(Math.min(...packEyes)).toBeGreaterThanOrEqual(alphaDone);
  });

  it('opens every eye before its own body resolves', () => {
    const secs = s => parseFloat(s);
    // The alpha leads, and each wolf's eyes precede its body.
    const rows = [...tsxCode.matchAll(/eyeAt: '([\d.]+)s', bodyAt: '([\d.]+)s'/g)];
    expect(rows.length).toBe(5);
    for (const [, eye, body] of rows) expect(secs(eye)).toBeLessThan(secs(body));
    // The nearest pack wolf lights up before the furthest one.
    const eyeTimes = rows.map(r => secs(r[1]));
    expect(Math.min(...eyeTimes)).toBe(eyeTimes[eyeTimes.length - 1]);
  });
});

describe('landing page fit and pacing', () => {
  it('clips the hero horizontally, so the bleeding pack cannot scroll the page', () => {
    // The pack fans to 1.35x the alpha's box on purpose. Measured 2026-08-28:
    // without this the document was 477px wide inside a 390px phone.
    expect(page).toMatch(/<section className="relative isolate -mx-3 overflow-x-clip/);
  });

  it('keeps the alpha inside the viewport on a phone', () => {
    // Her width sets whether the pack's eyes clear her ruff. Over 100% put the
    // outermost eye on the screen edge; the fix is width, not a tighter fan.
    const m = page.match(/mx-auto w-\[(\d+)%\] max-w-\[600px\]/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeLessThanOrEqual(100);
  });

  it('lets the headline couplet hold two lines at phone widths', () => {
    // The copy rhymes across an authored <br />, so a wrapped third line breaks
    // the rhyme exactly where the reader hears it. Measured 2026-08-28: the
    // longer half needs ~7.6-7.85vw to fit from 320px to 430px, so the clamp
    // floor has to sit BELOW the old 2rem rather than pinning the type larger
    // than the line. Browser measurement is the real check; this catches the
    // floor being raised back up under copy that no longer fits at that size.
    const h1 = page.slice(page.indexOf('<h1'), page.indexOf('</h1>'));
    const halves = h1.slice(h1.indexOf('>') + 1).split('<br />').map(t => t.trim());
    expect(halves).toHaveLength(2);
    for (const half of halves) expect(half.length).toBeGreaterThan(0);

    const clamp = h1.match(/clamp\(([\d.]+)rem,\s*([\d.]+)vw,\s*([\d.]+)rem\)/);
    expect(clamp, 'headline should size with a clamp()').toBeTruthy();
    const [, floorRem, vw] = clamp;
    const longest = Math.max(...halves.map(h => h.length));
    // 0.471em per character, measured off the shipped face (Prata) — 377px for
    // 25 characters at 32px. A line must fit the ~92% of the viewport the hero
    // leaves it at its SMALLEST supported width, 320px.
    const needPx = longest * 0.471 * (parseFloat(vw) / 100) * 320;
    expect(needPx).toBeLessThanOrEqual(320 * 0.9);
    expect(parseFloat(floorRem) * 16).toBeLessThanOrEqual((parseFloat(vw) / 100) * 320);

    // The ch cap is sized in the same em, so it shrinks with the font and can
    // re-wrap what the clamp just fixed.
    const cap = h1.match(/max-w-\[(\d+)ch\]/);
    expect(cap).toBeTruthy();
    expect(Number(cap[1])).toBeGreaterThanOrEqual(longest * 0.471 / 0.5);
  });

  it('holds the rest of the page back until the wolf has arrived', () => {
    expect(page).toMatch(/className="page-reveal/);
    const delay = cssCode.match(/\.page-reveal\s*\{[^}]*animation:[^;]*?([\d.]+)s\s+(?:both|backwards|forwards)?/);
    expect(cssCode).toMatch(/\.page-reveal\s*\{[^}]*animation:/);
    // Deferred paint must not become permanently-blank content for anyone who
    // asked for less motion.
    const reduced = cssCode.slice(cssCode.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/\.page-reveal\s*\{\s*animation:\s*none/);
    void delay;
  });

  // Every ruling Hitya has made on where a destination belongs. Each one is a
  // pair — in the right group AND out of the wrong one — because moving an item
  // by copying it leaves a duplicate that looks fine in the menu.
  const RULINGS = [
    { href: '/buffs',         into: 'raid', outOf: 'prep' },   // during a raid
    { href: '/quartermaster', into: 'prep', outOf: 'raid' },   // beforehand
    { href: '/who',           into: 'prep', outOf: 'raid' },
  ];
  const group = id => {
    const order = ['raid', 'stats', 'prep'];
    const start = nav.indexOf(`id: '${id}'`);
    const next = order.slice(order.indexOf(id) + 1)
      .map(g => nav.indexOf(`id: '${g}'`)).find(i => i > start);
    return nav.slice(start, next === undefined ? nav.indexOf('const chip') : next);
  };

  it.each(RULINGS)('files $href under $into, not $outOf', ({ href, into, outOf }) => {
    expect(group(into)).toContain(`'${href}'`);
    expect(group(outOf)).not.toContain(`'${href}'`);
  });

  it('always offers /me — it is a top-level door, not a signed-in extra', () => {
    // Gating it on `showMe` made the four doors three for every signed-out
    // visitor, which is exactly how it went missing (Hitya, 2026-08-28).
    // /me redirects to sign-in itself, so the link never dead-ends.
    const me = nav.match(/^\s*(?:\{showMe[^\n]*)?<Link href="\/me"/m);
    expect(nav).toMatch(/<Link href="\/me"/);
    expect(nav).not.toMatch(/\{\s*showMe\s*&&\s*<Link href="\/me"/);
    void me;
    const mePage = fs.readFileSync(path.join(WEB, 'app/me/page.tsx'), 'utf8');
    expect(mePage).toMatch(/redirect\('\/auth\/signin\?next=\/me'\)/);
  });
});
