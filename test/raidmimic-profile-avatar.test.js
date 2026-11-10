// 2026-11-10, the guild lead: "looks like the discord picture is missing" — the welcome card on raidmimic.com showed a
// broken-image icon. A Discord picture that fails to load must fall back to the name's initial, never a broken image.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const dir = path.join(ROOT, 'web', 'app', 'raidmimic', '_landing');
const avatar = stripJs(readSource(path.join(ROOT, 'web', 'components', 'ProfileAvatar.tsx')));
const dash = stripJs(readSource(path.join(dir, 'HomeDashboard.tsx')));

describe('the welcome card picture', () => {
  it('a failed load switches to the initial', () => {
    expect(avatar).toMatch(/^'use client';/);
    expect(avatar).toContain('onError={() => setFailed(true)}');
    expect(avatar).toMatch(/if \(src && !failed\)/);
    expect(avatar).toContain('data-avatar-fallback');
    expect(avatar).toMatch(/charAt\(0\)\.toUpperCase\(\) \|\| '\?'/);
  });
  it('the dashboard uses it instead of a bare img', () => {
    expect(dash).toContain('<ProfileAvatar src={avatarUrl} name={name} />');
    expect(dash).not.toMatch(/<img src=\{avatarUrl\}/);
  });
});
