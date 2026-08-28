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
  it('ships an eye plate on the same canvas as the wolf, so it cannot drift', () => {
    const wolf = pngSize(path.join(WEB, 'public/wolf.png'));
    const eyes = pngSize(path.join(WEB, 'public/wolf-eyes.png'));
    // The glow carries no coordinates of its own — it is pinned edge-to-edge
    // over the plate. Identical geometry is the whole alignment guarantee.
    expect(eyes).toEqual(wolf);
    expect(wolf.w).toBe(wolf.h);
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
