// test/local-icons.test.js — item icons cut from the player's OWN EverQuest files (local-first slice 2).
//
// The agent decodes the client's dragitem<N>.tga/.dds sheets and serves one 40px cell per icon number at
// GET /api/local/icon/<n>.png. No EQ art is committed: every sheet below is synthesized in the test, each cell
// painted a colour that encodes its own (col,row), so a wrong mapping cannot pass by accident.
//
// GROUND TRUTH. The website's atlas drew a shovel for icon 633 (183 items, all boots) because it read the sheets
// row-major. The sheets are COLUMN-MAJOR. Checked by eye on 2026-10-21 against A:\EQ\uifiles\default (34 TGA sheets,
// Titanium-era client): each icon below was cut from the real files and compared with the names of the items that
// share it in eqemu_items. `fp` is a sha1 prefix of the cut 40x40 RGBA, a fingerprint of the art, not the art. The
// last describe block re-cuts them when an EQ folder is present (WP_TEST_EQ_DIR, or A:\EQ) and skips otherwise.
// Run: npx vitest run test/local-icons.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');

// icon -> what the items sharing it are called (catalog), what the cut cell shows (by eye), fingerprint.
const VERIFIED = {
  500: ['Cloth Choker ×22', 'bead necklace', '47c42630ed3223a1'],
  501: ['Choker of the Wretched, Bone Studded Bracelet ×27', 'chain loop', '4bedd188b111081e'],
  502: ['Snake Fang Necklace ×17', 'chain necklace', '0f13cb87493ee2a4'],
  504: ['Spell: … ×2177', 'scroll', 'f6584b7a073dbd26'],
  505: ['Clay Bracelet, Bracer of Power ×26', 'silver bracelet', 'e8b7db2f10fa2a86'],
  506: ['Grotesque Mask, Black Wolf Mask ×27', 'silver mask-helm', '22967131ca3ea5c2'],
  511: ['Crown of Hatred, Beaded Circlet ×37', 'jeweled gold crown', 'c4648c040e7df092'],
  516: ['… Bracer ×310', 'plate bracer', '6cb6930e297d49f0'],
  520: ['Threaded Platinum Bracelet ×9', 'green and gold band', '5155f9bed4c31c2b'],
  524: ['… Plate Boots ×276', 'gold plate boots', 'db218f4a68a6b614'],
  530: ["Wu's Fighting Gauntlets ×24", 'black gauntlets', 'fc599f7d3e3c01d9'],
  531: ['… Gauntlets ×313', 'green plate gauntlets', '9c1d87c88b3bfc5e'],
  540: ['… Greaves ×363', 'plate greaves', '8044d3c715a821d3'],
  545: ['… Chain Boots ×153', 'chain boots', '98d457e73b1e2b04'],
  598: ['… Arrow ×246', 'arrow', '9dff2c7cb3231f51'],
  620: ['… Chain Bracer ×175', 'chain bracer', '23bd8416debb351b'],
  622: ['… Vambraces ×266', 'plate vambraces', '2f6798a4bb4a57ed'],
  624: ['… Breastplate ×351', 'breastplate', '4505385c3b2ac974'],
  632: ['… Tunic ×156', 'leather tunic', '8609620e14b08db3'],
  633: ['Kunzar Boots, Moldering Work Boots ×183', 'leather boots', '13471252b7f2d8e8'],
  634: ['… Sleeves ×201', 'leather sleeve', '104141a262ee7b5b'],
  635: ['… Leggings ×212', 'leather leggings', '182c6faa56632da1'],
  636: ['… Gloves ×250', 'leather gloves', 'e4755afa494133f5'],
  637: ['… Wristbands ×212', 'wristband', '2a194267690f0f58'],
  639: ['Cloth Cap ×52', 'cloth cap', '4cf66efde8d95171'],
  640: ['… Skullcap ×162', 'leather cap', '2a536e393f6d5993'],
  644: ["Klok's Seal, A Heavy Coin ×47", 'seal coin', '33e0ea126b665039'],
  746: ['Ceremonial Battle Helm ×89', 'plate helm', 'dd8187bc16016fd9'],
  771: ['Mask of the Deceiver ×118', 'mask', '1fb7461997f3c3ca'],
  778: ['Tome, Volume ×210', 'book', '403af7ff3d6c21a8'],
  798: ['… Pauldrons ×160', 'pauldron', '97724247d3566462'],
  800: ['Wolf Fang Earring ×52', 'fang', 'c8d1fd7257ce4d60'],
  864: ['Tattered Note, Page ×159', 'parchment', 'b8a7178e694b4d48'],
  869: ['Words of … ×168', 'parchment', '57a73b4d550b92af'],
  967: ['Etched Rune, Mark ×331', 'rune stone', '555e3a152e7d37d2'],
  1000: ['Kiola Nut, Timorous Coconut ×11', 'nut', 'dab5a3fcc236ff8b'],
  1036: ['… Material, Sheet ×251', 'sheet of material', 'f5e18bf3c03d51f1'],
  1050: ['Electrum Jasper Earring ×19', 'jeweled earring', 'd118567aa641a92e'],
  1100: ['… Arrowheads ×6', 'arrowheads', 'de0b28e669057101'],
  1151: ['… Mold ×194', 'mold', 'b485604e2893035d'],
  1200: ['Herb of Recovery, Birthwart ×14', 'herb', '5514a248e5c98fa0'],
};

// ── Synthetic sheets ─────────────────────────────────────────────────────────────────────────────────────
// Cell (col,row) is filled with RGBA [10+col*30, 10+row*30, sheet*7, 255]; cells listed in `blank` stay transparent.
function sheetRgba(sheet, blank = []) {
  const w = 256, h = 256, out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < 240; y++) for (let x = 0; x < 240; x++) {
    const col = Math.floor(x / 40), row = Math.floor(y / 40);
    if (blank.some(b => b[0] === col && b[1] === row)) continue;
    out.set([10 + col * 30, 10 + row * 30, sheet * 7, 255], (y * w + x) * 4);
  }
  return { w, h, data: out };
}
// Top-down RGBA -> TGA (type 2 raw or type 10 RLE, 32-bit BGRA, bottom-up as the client ships them).
function tga(img, rle) {
  const { w, h, data } = img;
  const hdr = Buffer.alloc(18);
  hdr[2] = rle ? 10 : 2; hdr.writeUInt16LE(w, 12); hdr.writeUInt16LE(h, 14); hdr[16] = 32; hdr[17] = 8;
  const px = [];
  for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    px.push([data[o + 2], data[o + 1], data[o], data[o + 3]]);
  }
  if (!rle) return Buffer.concat([hdr, Buffer.from(px.flat())]);
  const body = [];
  for (let i = 0; i < px.length;) {
    let n = 1;
    while (n < 128 && i + n < px.length && px[i + n].join() === px[i].join()) n++;
    if (n > 1) { body.push(0x80 | (n - 1), ...px[i]); i += n; continue; }
    let m = 1;
    while (m < 128 && i + m < px.length && (i + m + 1 >= px.length || px[i + m].join() !== px[i + m + 1].join())) m++;
    body.push(m - 1); for (let k = 0; k < m; k++) body.push(...px[i + k]);
    i += m;
  }
  return Buffer.concat([hdr, Buffer.from(body)]);
}
// PNG -> { w, h, rgba } (filter 0 only, which is all the agent writes).
function unpng(buf) {
  expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) { expect(raw[y * (w * 4 + 1)]).toBe(0); raw.copy(rgba, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)); }
  return { w, h, rgba };
}
const pixel = (rgba, x, y, w = 40) => [...rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];

let eq, local;
beforeEach(() => {
  eq = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-eq-'));
  local = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-local-'));
  fs.mkdirSync(path.join(eq, 'uifiles', 'default'), { recursive: true });
});
afterEach(() => { for (const d of [eq, local]) fs.rmSync(d, { recursive: true, force: true }); });
const writeSheet = (n, buf, ext = '.tga') => fs.writeFileSync(path.join(eq, 'uifiles', 'default', 'dragitem' + n + ext), buf);

describe('icon number -> sheet and cell (column-major)', () => {
  it('maps the boots icon 633 to sheet 4, column 4, row 1', () => {
    expect(agent._iconCellOf(633)).toEqual({ sheet: 4, cell: 25, col: 4, row: 1 });
  });
  it('fills down a column before moving right, 36 to a sheet', () => {
    expect(agent._iconCellOf(500)).toEqual({ sheet: 1, cell: 0, col: 0, row: 0 });
    expect(agent._iconCellOf(501)).toMatchObject({ col: 0, row: 1 });
    expect(agent._iconCellOf(505)).toMatchObject({ col: 0, row: 5 });
    expect(agent._iconCellOf(506)).toMatchObject({ col: 1, row: 0 });
    expect(agent._iconCellOf(535)).toMatchObject({ sheet: 1, col: 5, row: 5 });
    expect(agent._iconCellOf(536)).toMatchObject({ sheet: 2, col: 0, row: 0 });
  });
  it('has no cell below 500 or for junk', () => {
    for (const v of [0, 499, -1, NaN, 'x', null]) expect(agent._iconCellOf(v)).toBe(null);
  });
});

describe('extracting a cell from the player\'s sheets', () => {
  for (const rle of [false, true]) {
    it(`cuts the right cell from a ${rle ? 'RLE' : 'raw'} bottom-up TGA`, () => {
      writeSheet(4, tga(sheetRgba(4), rle));
      const { w, h, rgba } = unpng(agent._localIconPng(633, { eqDirs: [eq], localDir: local }));
      expect([w, h]).toEqual([40, 40]);
      expect(pixel(rgba, 0, 0)).toEqual([10 + 4 * 30, 10 + 1 * 30, 28, 255]);
      expect(pixel(rgba, 39, 39)).toEqual([10 + 4 * 30, 10 + 1 * 30, 28, 255]);
    });
  }
  it('every icon on a sheet lands on its own column-major cell', () => {
    writeSheet(2, tga(sheetRgba(2), true));
    for (let icon = 536; icon < 572; icon++) {
      const k = icon - 536, col = Math.floor(k / 6), row = k % 6;   // independent of the agent's own maths
      const { rgba } = unpng(agent._localIconPng(icon, { eqDirs: [eq], localDir: local }));
      expect(pixel(rgba, 20, 20), 'icon ' + icon).toEqual([10 + col * 30, 10 + row * 30, 14, 255]);
    }
  });
  it('finds the sheet in the install root and zero-padded names too', () => {
    fs.writeFileSync(path.join(eq, 'dragitem01.tga'), tga(sheetRgba(1), false));
    expect(agent._localIconPng(500, { eqDirs: [eq], localDir: local })).toBeTruthy();
  });
  it('answers null for a blank cell, a missing sheet, and no EQ folder', () => {
    writeSheet(1, tga(sheetRgba(1, [[5, 5]]), true));
    expect(agent._localIconPng(535, { eqDirs: [eq], localDir: local })).toBe(null);
    expect(agent._localIconPng(600, { eqDirs: [eq], localDir: local })).toBe(null);
    expect(agent._localIconPng(500, { eqDirs: [], localDir: local })).toBe(null);
  });
  it('caches under local/icons and re-cuts when the sheet changes', () => {
    writeSheet(1, tga(sheetRgba(1), false));
    agent._localIconPng(500, { eqDirs: [eq], localDir: local });
    const cached = path.join(local, 'icons', '500.png');
    expect(fs.existsSync(cached)).toBe(true);
    const later = new Date(Date.now() + 60_000);
    const swapped = sheetRgba(1); swapped.data.fill(200, 0, 4 * 256 * 40);   // a "UI skin" repaint of the top band
    writeSheet(1, tga(swapped, false));
    fs.utimesSync(path.join(eq, 'uifiles', 'default', 'dragitem1.tga'), later, later);
    const { rgba } = unpng(agent._localIconPng(500, { eqDirs: [eq], localDir: local }));
    expect(pixel(rgba, 0, 0)).toEqual([200, 200, 200, 200]);
  });
  it('a per-item file in local/icons-custom wins over the extracted icon', () => {
    writeSheet(4, tga(sheetRgba(4), false));
    fs.mkdirSync(path.join(local, 'icons-custom'));
    const mine = agent._iconPng(40, 40, Buffer.alloc(40 * 40 * 4, 77));
    fs.writeFileSync(path.join(local, 'icons-custom', '2463.png'), mine);
    expect(agent._localIconPng(633, { eqDirs: [eq], localDir: local, item: '2463' }).equals(mine)).toBe(true);
    expect(agent._localIconPng(633, { eqDirs: [eq], localDir: local, item: '9999' }).equals(mine)).toBe(false);
    expect(agent._localIconPng(633, { eqDirs: [eq], localDir: local, item: '../icons-custom/2463' }).equals(mine)).toBe(false);
  });
});

describe('DDS sheets', () => {
  const ddsHeader = (w, h, flags, four, bits, masks) => {
    const b = Buffer.alloc(128);
    b.writeUInt32LE(0x20534444, 0); b.writeUInt32LE(124, 4); b.writeUInt32LE(h, 12); b.writeUInt32LE(w, 16);
    b.writeUInt32LE(32, 76); b.writeUInt32LE(flags, 80); b.write(four, 84, 'latin1'); b.writeUInt32LE(bits, 88);
    masks.forEach((m, i) => b.writeUInt32LE(m >>> 0, 92 + i * 4));
    return b;
  };
  it('decodes DXT1 blocks', () => {
    // one 4x4 block: c0 pure red, c1 pure blue, every texel index 0 except texel 15 = 1
    const blk = Buffer.alloc(8); blk.writeUInt16LE(0xF800, 0); blk.writeUInt16LE(0x001F, 2); blk.writeUInt32LE(1 << 30, 4);
    const img = agent._iconDecodeDds(Buffer.concat([ddsHeader(4, 4, 4, 'DXT1', 0, [0, 0, 0, 0]), blk]));
    expect([...img.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...img.data.subarray(60, 64)]).toEqual([0, 0, 255, 255]);
  });
  it('decodes uncompressed A8R8G8B8 and serves a cell from a .dds sheet', () => {
    const { w, h, data } = sheetRgba(4);
    const px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) px.writeUInt32LE(((data[i * 4 + 3] << 24) | (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]) >>> 0, i * 4);
    writeSheet(4, Buffer.concat([ddsHeader(w, h, 0x41, '', 32, [0xFF0000, 0xFF00, 0xFF, 0xFF000000]), px]), '.dds');
    const { rgba } = unpng(agent._localIconPng(633, { eqDirs: [eq], localDir: local }));
    expect(pixel(rgba, 5, 5)).toEqual([130, 40, 28, 255]);
  });
  it('rejects junk rather than serving garbage', () => {
    expect(() => agent._iconDecodeDds(Buffer.alloc(200))).toThrow();
    expect(() => agent._iconDecodeTga(Buffer.alloc(10))).toThrow();
  });
});

describe('GET /api/local/icon/<n>.png', () => {
  const call = (url, o) => {
    const res = { status: 0, headers: null, body: null, writeHead(s, hd) { this.status = s; this.headers = hd; }, end(b) { this.body = b; } };
    const handled = agent._localIconRoute({ method: 'GET', url }, res, o);
    return { handled, ...res };
  };
  it('serves a PNG, a 404 for no art, and leaves other paths alone', () => {
    writeSheet(4, tga(sheetRgba(4), true));
    const ok = call('/api/local/icon/633.png', { eqDirs: [eq], localDir: local });
    expect(ok.handled).toBe(true);
    expect(ok.status).toBe(200);
    expect(ok.headers['Content-Type']).toBe('image/png');
    expect(unpng(ok.body).w).toBe(40);
    expect(call('/api/local/icon/1700.png', { eqDirs: [eq], localDir: local }).status).toBe(404);
    expect(call('/api/local/icon/abc.png', { eqDirs: [eq], localDir: local }).handled).toBe(false);
    expect(call('/api/local/track', { eqDirs: [eq], localDir: local }).handled).toBe(false);
  });
  it('is wired into the dashboard router and reaches nothing on the network', () => {
    const src = readSource(AGENT_INDEX);
    expect(stripJs(src)).toMatch(/if \(_localIconRoute\(req, res\)\) return;/);
    const block = stripJs(sliceBlock(src, 'const ICON_FIRST = 500', '\n// Export internals'));
    expect(block).not.toMatch(/https?\.|fetch\(|_enqueue|uploadQueue|postJson/);
  });
});

// The 41 hand-checked icons, re-cut from a real install when one is on this machine. CI has none and skips.
const REAL_EQ = [process.env.WP_TEST_EQ_DIR, 'A:\\EQ'].find(d => d && fs.existsSync(path.join(d, 'uifiles', 'default', 'dragitem1.tga')));
describe.skipIf(!REAL_EQ)('ground truth against the real client sheets', () => {
  it('every hand-checked icon cuts to the cell that was looked at', () => {
    for (const [icon, [, , fp]] of Object.entries(VERIFIED)) {
      const at = agent._iconCellOf(Number(icon));
      const img = agent._iconDecodeTga(fs.readFileSync(path.join(REAL_EQ, 'uifiles', 'default', 'dragitem' + at.sheet + '.tga')));
      const cell = agent._iconCut(img, at.col, at.row);
      expect(crypto.createHash('sha1').update(cell).digest('hex').slice(0, 16), 'icon ' + icon).toBe(fp);
    }
  });
});
