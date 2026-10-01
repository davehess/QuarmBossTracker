// test/install-no-identical-backups.test.js — Mimic's Zeal and UI-pack installs stop
// backing up files they are not changing.
//
// The guild lead, 2026-10-01, on uifiles/zeal/targetrings: every Zeal update left one more
// `<ring>.tga.zealbak-<stamp>` beside each ring, "even though they're byte-identical". Runs the
// real backupAndWriteBinary (shared by zealUpdater.js and uiPacks.js) against a temp folder.
//
// Run: npx vitest run test/install-no-identical-backups.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { backupAndWriteBinary } = createRequire(import.meta.url)('../apps/mimic/ghDownload.js');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-bak-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const ring = () => path.join(dir, 'uifiles', 'zeal', 'targetrings', 'WolfPack.tga');
const copies = () => fs.readdirSync(path.dirname(ring())).filter(n => n.startsWith('WolfPack.tga.zealbak-'));
const A = Buffer.from([0, 0, 2, 0, 1, 2, 3, 4]);
const B = Buffer.from([0, 0, 2, 0, 9, 9, 9, 9]);

describe('installing a file that is already there', () => {
  it('the same bytes: no backup, nothing written', () => {
    backupAndWriteBinary(ring(), A, 'zeal');
    const before = fs.statSync(ring()).mtimeMs;
    expect(backupAndWriteBinary(ring(), A, 'zeal')).toBeNull();
    expect(backupAndWriteBinary(ring(), A, 'zeal')).toBeNull();
    expect(copies()).toEqual([]);
    expect(fs.statSync(ring()).mtimeMs).toBe(before);
  });

  it('different bytes: one backup of the old file, the new one written', () => {
    backupAndWriteBinary(ring(), A, 'zeal');
    const bak = backupAndWriteBinary(ring(), B, 'zeal');
    expect(bak).toMatch(/WolfPack\.tga\.zealbak-/);
    expect(fs.readFileSync(bak).equals(A)).toBe(true);
    expect(fs.readFileSync(ring()).equals(B)).toBe(true);
  });

  it('the pile from earlier installs: copies identical to the file go, a different one stays', () => {
    fs.mkdirSync(path.dirname(ring()), { recursive: true });
    fs.writeFileSync(ring(), A);
    for (const s of ['1785872006743-160', '1788828523074-160', '1790341877513-160']) {
      fs.writeFileSync(`${ring()}.zealbak-${s}`, A);
    }
    fs.writeFileSync(`${ring()}.zealbak-1700000000000-1`, B);   // an older ring, really different
    fs.writeFileSync(`${ring()}.uibak-1790000000000-2`, A);      // another installer's copy
    expect(backupAndWriteBinary(ring(), A, 'zeal')).toBeNull();
    expect(copies()).toEqual(['WolfPack.tga.zealbak-1700000000000-1']);
    expect(fs.existsSync(`${ring()}.uibak-1790000000000-2`)).toBe(true);
  });

  it('a string payload is compared as bytes too', () => {
    const p = path.join(dir, 'uifiles', 'pack', 'EQUI.xml');
    backupAndWriteBinary(p, '<x/>', 'ui');
    expect(backupAndWriteBinary(p, '<x/>', 'ui')).toBeNull();
    expect(fs.readdirSync(path.dirname(p)).filter(n => n.includes('uibak'))).toEqual([]);
  });
});
