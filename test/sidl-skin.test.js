// UI Studio's real-window preview: the SIDL skin reader (apps/mimic/sidlSkin.js) and the layout rules in
// apps/mimic/sidlRender.js. Every fixture is SYNTHETIC — XML strings and TGA/PNG buffers built here. This repo is public;
// EverQuest / Daybreak / community skin art and XML never go in it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const skin = require('../apps/mimic/sidlSkin.js');
const R = require('../apps/mimic/sidlRender.js');

// ---------------------------------------------------------------------------------------------------------------------
// fixture builders
// ---------------------------------------------------------------------------------------------------------------------
// px: rows TOP-first, each row an array of [r,g,b,a]. opts: bpp 24|32, topLeft (origin bit), rle.
function buildTga(px, opts) {
  const o = Object.assign({ bpp: 32, topLeft: false, rle: false }, opts);
  const h = px.length, w = px[0].length, bytes = o.bpp / 8;
  const head = Buffer.alloc(18);
  head[2] = o.rle ? 10 : 2;
  head.writeUInt16LE(w, 12); head.writeUInt16LE(h, 14);
  head[16] = o.bpp;
  head[17] = (o.topLeft ? 0x20 : 0) | (o.bpp === 32 ? 8 : 0);
  const rows = o.topLeft ? px : px.slice().reverse();      // file order
  const flat = [];
  for (const row of rows) for (const [r, g, b, a] of row) { flat.push(b, g, r); if (bytes === 4) flat.push(a); }
  const pixels = [];
  for (let i = 0; i < flat.length; i += bytes) pixels.push(flat.slice(i, i + bytes));
  if (!o.rle) return Buffer.concat([head, Buffer.from(flat)]);
  // RLE over the whole pixel stream (packets run across scanlines): a run packet for each repeat, raw packets otherwise
  const out = [];
  let i = 0;
  while (i < pixels.length) {
    let run = 1;
    while (i + run < pixels.length && run < 128 && pixels[i + run].join() === pixels[i].join()) run++;
    if (run > 1) { out.push(0x80 | (run - 1), ...pixels[i]); i += run; continue; }
    let raw = 1;
    while (i + raw < pixels.length && raw < 128 && (i + raw + 1 >= pixels.length || pixels[i + raw].join() !== pixels[i + raw + 1].join())) raw++;
    out.push(raw - 1);
    for (let k = 0; k < raw; k++) out.push(...pixels[i + k]);
    i += raw;
  }
  return Buffer.concat([head, Buffer.from(out)]);
}
const RED = [255, 0, 0, 255], GRN = [0, 255, 0, 255], BLU = [0, 0, 255, 255], WHT = [255, 255, 255, 128];
// 3 wide x 2 tall; top row R G B, bottom row W W R  (top-first)
const IMG = [[RED, GRN, BLU], [WHT, WHT, RED]];
const rgbaOf = (px) => Uint8Array.from(px.flat().flatMap((p) => p));

function crc32(b) {
  let c, crc = ~0;
  for (let i = 0; i < b.length; i++) { c = (crc ^ b[i]) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// RGBA PNG, filter type 1 (Sub) on every row so the un-filter code runs
function buildPng(px) {
  const h = px.length, w = px[0].length;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = [];
  for (const row of px) {
    raw.push(1);
    const bytes = row.flatMap((p) => p);
    for (let i = 0; i < bytes.length; i++) raw.push((bytes[i] - (i >= 4 ? bytes[i - 4] : 0) + 256) & 255);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
}

// A tiny skin. Note the deliberate mess: a comment, a stray '&', odd casing, a single <Pieces>, an unknown element.
const ANIMS = `<?xml version="1.0" encoding="us-ascii"?>
<XML ID="EQInterfaceDefinitionLanguage">
  <Schema xmlns="EverQuestData" xmlns:dt="EverQuestDataTypes" />
  <!-- a comment that mentions <Screen item="Ghost"> must not define one -->
  <TextureInfo item="sheet.tga"><Size><CX>64</CX><CY>32</CY></Size></TextureInfo>
  <Ui2DAnimation item="A_Fill">
    <Cycle>true</Cycle>
    <Frames>
      <Texture>sheet.tga</Texture>
      <Location><X>8</X><Y>4</Y></Location>
      <Size><CX>16</CX><CY>8</CY></Size>
      <Hotspot><X>1</X><Y>2</Y></Hotspot>
      <Duration>500</Duration>
    </Frames>
    <Frames>
      <Texture>sheet.tga</Texture>
      <Location><X>24</X><Y>4</Y></Location>
      <Size><CX>16</CX><CY>8</CY></Size>
    </Frames>
  </Ui2DAnimation>
  <Ui2DAnimation item="A_Grid"><Vertical>true</Vertical><Grid>true</Grid>
    <Frames><Texture>sheet.tga</Texture><Location><X>0</X><Y>0</Y></Location><Size><CX>8</CX><CY>8</CY></Size></Frames>
  </Ui2DAnimation>
  <Ui2DAnimation item="A_BtnN"><Frames><Texture>sheet.tga</Texture><Location><X>0</X><Y>16</Y></Location><Size><CX>48</CX><CY>16</CY></Size></Frames></Ui2DAnimation>
  <Ui2DAnimation item="A_TL"><Frames><Texture>sheet.tga</Texture><Location><X>0</X><Y>0</Y></Location><Size><CX>10</CX><CY>4</CY></Size></Frames></Ui2DAnimation>
  <Ui2DAnimation item="A_T"><Frames><Texture>sheet.tga</Texture><Location><X>10</X><Y>0</Y></Location><Size><CX>4</CX><CY>4</CY></Size></Frames></Ui2DAnimation>
  <Ui2DAnimation item="A_TR"><Frames><Texture>sheet.tga</Texture><Location><X>14</X><Y>0</Y></Location><Size><CX>10</CX><CY>4</CY></Size></Frames></Ui2DAnimation>
  <Ui2DAnimation item="A_L"><Frames><Texture>sheet.tga</Texture><Location><X>0</X><Y>4</Y></Location><Size><CX>4</CX><CY>4</CY></Size></Frames></Ui2DAnimation>
  <Ui2DAnimation item="A_R"><Frames><Texture>sheet.tga</Texture><Location><X>4</X><Y>4</Y></Location><Size><CX>4</CX><CY>4</CY></Size></Frames></Ui2DAnimation>
  <Ui2DAnimation item="A_B"><Frames><Texture>sheet.tga</Texture><Location><X>8</X><Y>4</Y></Location><Size><CX>4</CX><CY>4</CY></Size></Frames></Ui2DAnimation>
  <Ui2DAnimation item="A_TitleM"><Frames><Texture>sheet.tga</Texture><Location><X>12</X><Y>4</Y></Location><Size><CX>2</CX><CY>16</CY></Size></Frames></Ui2DAnimation>
</XML>`;
const TEMPLATES = `<XML ID="EQInterfaceDefinitionLanguage">
  <WindowDrawTemplate item="WDT_Test">
    <Background>bg.tga</Background>
    <Border>
      <TopLeft>A_TL</TopLeft><Top>A_T</Top><TopRight>A_TR</TopRight>
      <Left>A_L</Left><Right>A_R</Right><Bottom>A_B</Bottom>
    </Border>
    <Titlebar><Middle>A_TitleM</Middle></Titlebar>
  </WindowDrawTemplate>
  <ButtonDrawTemplate item="BDT_Test"><Normal>A_BtnN</Normal></ButtonDrawTemplate>
</XML>`;
const WND = `<XML ID="EQInterfaceDefinitionLanguage">
  <Label item="TW_Title"><Location><X>5</X><Y>6</Y></Location><Size><CX>60</CX><CY>12</CY></Size><Text>R&D lab</Text><TextColor><R>10</R><G>20</G><B>30</B></TextColor></Label>
  <STMLbox item="TW_Out"><DrawTemplate>WDT_Test</DrawTemplate><AutoStretch>true</AutoStretch>
    <LeftAnchorOffset>1</LeftAnchorOffset><TopAnchorOffset>1</TopAnchorOffset><RightAnchorOffset>1</RightAnchorOffset><BottomAnchorOffset>22</BottomAnchorOffset>
    <RightAnchorToLeft>false</RightAnchorToLeft><BottomAnchorToTop>false</BottomAnchorToTop></STMLbox>
  <Button item="TW_Btn"><Location><X>3</X><Y>4</Y></Location><Size><CX>40</CX><CY>20</CY></Size><ButtonDrawTemplate>BDT_Test</ButtonDrawTemplate><Text>Go</Text></Button>
  <Gizmo item="TW_Odd"><Frobnicate>7</Frobnicate></Gizmo>
  <Screen item="TestWnd">
    <Location><X>100</X><Y>50</Y></Location><Size><CX>200</CX><CY>120</CY></Size>
    <DrawTemplate>WDT_Test</DrawTemplate>
    <STYLE_Titlebar>true</STYLE_Titlebar><Style_Border>true</Style_Border><Style_Closebox>false</Style_Closebox>
    <Pieces>TW_Out</Pieces><Pieces>TW_Btn</Pieces><Pieces>TW_Title</Pieces>
  </Screen>
  <Screen item="OneWnd"><Size><CX>10</CX><CY>10</CY></Size><Pieces>TW_Btn</Pieces></Screen>
</XML>`;
const files = (dir) => [
  { dir, name: 'EQUI_Animations.xml', xml: ANIMS },
  { dir, name: 'EQUI_Templates.xml', xml: TEMPLATES },
  { dir, name: 'EQUI_TestWnd.xml', xml: WND },
];

// ---------------------------------------------------------------------------------------------------------------------
describe('parseXml', () => {
  it('survives stray ampersands, comments, CDATA, mismatched and unquoted attributes', () => {
    const t = skin.parseXml('<A item=x><!-- <B> --><C>1 &amp; 2 & 3</C><D><![CDATA[<raw>]]></D></E><F/></A>');
    const a = t.children[0];
    expect(a.attrs.item).toBe('x');
    expect(a.children.map((c) => c.name)).toEqual(['C', 'D', 'F']);   // the comment's <B> is not an element; </E> is ignored
    expect(a.children[0].text).toBe('1 & 2 & 3');
    expect(a.children[1].text).toBe('<raw>');
  });
  it('never throws on truncated or empty input', () => {
    expect(() => skin.parseXml('<Screen item="a"><Size><CX>1')).not.toThrow();
    expect(skin.parseXml('').children).toEqual([]);
    expect(() => skin.parseXml(null)).not.toThrow();
  });
});

describe('buildModel', () => {
  const model = skin.buildModel(files('myskin'), { skin: 'myskin' });

  it('reads a Screen with its pieces in order, a single <Pieces> still being a list', () => {
    const s = model.screens.TestWnd;
    expect(s.props.Pieces).toEqual(['TW_Out', 'TW_Btn', 'TW_Title']);
    expect(s.props.Size).toEqual({ CX: 200, CY: 120 });
    expect(s.props.Location).toEqual({ X: 100, Y: 50 });
    expect(s.props.DrawTemplate).toBe('WDT_Test');
    expect(s.props.Style_Border).toBe(true);
    expect(s.props.STYLE_Titlebar).toBe(true);            // original casing kept; the renderer reads it case-insensitively
    expect(s.file).toBe('EQUI_TestWnd.xml');
    expect(s.dir).toBe('myskin');
    expect(model.screens.OneWnd.props.Pieces).toEqual(['TW_Btn']);
    expect(model.screens.Ghost).toBeUndefined();          // the commented-out Screen
  });

  it('reads a WindowDrawTemplate and a ButtonDrawTemplate', () => {
    const w = model.templates.WindowDrawTemplate.WDT_Test.props;
    expect(w.Background).toBe('bg.tga');
    expect(w.Border.TopLeft).toBe('A_TL');
    expect(w.Titlebar.Middle).toBe('A_TitleM');
    expect(model.templates.ButtonDrawTemplate.BDT_Test.props.Normal).toBe('A_BtnN');
  });

  it('reads an Ui2DAnimation: frames, hotspot, duration, cycle, grid/vertical', () => {
    const a = model.animations.A_Fill;
    expect(a.cycle).toBe(true);
    expect(a.frames).toHaveLength(2);
    expect(a.frames[0]).toEqual({ texture: 'sheet.tga', x: 8, y: 4, w: 16, h: 8, hx: 1, hy: 2, duration: 500 });
    expect(a.frames[1].x).toBe(24);
    expect(model.animations.A_Grid.grid).toBe(true);
    expect(model.animations.A_Grid.vertical).toBe(true);
    expect(model.textures['sheet.tga']).toMatchObject({ w: 64, h: 32 });
  });

  it('keeps piece types, decoded entities and unknown elements', () => {
    expect(model.pieces.TW_Btn.type).toBe('Button');
    expect(model.pieces.TW_Title.props.Text).toBe('R&D lab');
    expect(model.pieces.TW_Title.props.TextColor).toEqual({ R: 10, G: 20, B: 30 });
    expect(model.pieces.TW_Odd).toMatchObject({ type: 'Gizmo', props: { Frobnicate: 7 } });
  });

  it('the skin defines an item before default does: first definition wins', () => {
    const over = `<XML><Screen item="TestWnd"><Size><CX>999</CX><CY>1</CY></Size></Screen></XML>`;
    const m = skin.buildModel([{ dir: 'myskin', name: 'EQUI_TestWnd.xml', xml: over }, ...files('default')], {});
    expect(m.screens.TestWnd.props.Size.CX).toBe(999);
    expect(m.screens.TestWnd.dir).toBe('myskin');
    expect(m.pieces.TW_Btn.dir).toBe('default');           // untouched items still come from default
  });

  it('is JSON-serialisable', () => {
    expect(() => JSON.parse(JSON.stringify(model))).not.toThrow();
    expect(JSON.parse(JSON.stringify(model)).screens.TestWnd.props.Pieces).toHaveLength(3);
  });
});

describe('TGA decode', () => {
  it('24-bit uncompressed, bottom-left origin (the TGA default): rows are flipped to top-first', () => {
    const t = skin.decodeTga(buildTga(IMG.map((r) => r.map((p) => [p[0], p[1], p[2], 255])), { bpp: 24 }));
    expect(t.width).toBe(3); expect(t.height).toBe(2);
    expect(Array.from(t.rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);               // top-left pixel is RED
    expect(Array.from(t.rgba.slice(4 * 3, 4 * 3 + 4))).toEqual([255, 255, 255, 255]); // second row starts WHITE
  });
  it('32-bit uncompressed, top-left origin bit set: no flip, alpha kept', () => {
    const t = skin.decodeTga(buildTga(IMG, { bpp: 32, topLeft: true }));
    expect(Array.from(t.rgba)).toEqual(Array.from(rgbaOf(IMG)));
  });
  it('the same pixels come out whichever origin the file used', () => {
    const a = skin.decodeTga(buildTga(IMG, { topLeft: true }));
    const b = skin.decodeTga(buildTga(IMG, { topLeft: false }));
    expect(Array.from(b.rgba)).toEqual(Array.from(a.rgba));
    expect(Array.from(b.rgba)).toEqual(Array.from(rgbaOf(IMG)));
  });
  it('RLE (type 10), 24 and 32 bit, packets running across scanlines', () => {
    const big = [[RED, RED, RED, GRN], [GRN, BLU, BLU, BLU], [WHT, RED, GRN, GRN]];   // runs straddle rows
    for (const bpp of [24, 32]) {
      for (const topLeft of [false, true]) {
        const src = bpp === 24 ? big.map((r) => r.map((p) => [p[0], p[1], p[2], 255])) : big;
        const t = skin.decodeTga(buildTga(src, { bpp, rle: true, topLeft }));
        expect(t, `bpp ${bpp} topLeft ${topLeft}`).not.toBeNull();
        expect(Array.from(t.rgba), `bpp ${bpp} topLeft ${topLeft}`).toEqual(Array.from(rgbaOf(src)));
      }
    }
  });
  it('declines what it cannot decode, and tolerates a truncated file', () => {
    const grey = buildTga(IMG); grey[2] = 3;
    expect(skin.decodeTga(grey)).toBeNull();
    const eight = buildTga(IMG); eight[16] = 8;
    expect(skin.decodeTga(eight)).toBeNull();
    expect(skin.decodeTga(Buffer.alloc(5))).toBeNull();
    const cut = buildTga(IMG, { topLeft: true }).subarray(0, 18 + 6);
    expect(skin.decodeTga(cut)).toMatchObject({ width: 3, height: 2 });
  });
});

describe('PNG decode (community skins ship some art as PNG)', () => {
  it('RGBA with Sub-filtered rows', () => {
    const t = skin.decodePng(buildPng(IMG));
    expect(t.width).toBe(3);
    expect(Array.from(t.rgba)).toEqual(Array.from(rgbaOf(IMG)));
  });
});

describe('loadSkinModel / readSkinTexture on a real directory tree', () => {
  const eq = fs.mkdtempSync(path.join(os.tmpdir(), 'sidl-test-'));
  const ui = path.join(eq, 'uifiles');
  fs.mkdirSync(path.join(ui, 'myskin'), { recursive: true });
  fs.mkdirSync(path.join(ui, 'default'), { recursive: true });
  fs.writeFileSync(path.join(ui, 'default', 'EQUI_Animations.xml'), ANIMS);
  fs.writeFileSync(path.join(ui, 'default', 'EQUI_Templates.xml'), TEMPLATES);
  fs.writeFileSync(path.join(ui, 'default', 'SIDL.xml'), '<XML><Screen item="NotMe"/></XML>');
  fs.writeFileSync(path.join(ui, 'myskin', 'EQUI_TestWnd.xml'), WND);
  fs.writeFileSync(path.join(ui, 'myskin', 'Sheet.TGA'), buildTga(IMG));
  fs.writeFileSync(path.join(ui, 'default', 'only_default.tga'), buildTga(IMG, { topLeft: true }));
  fs.writeFileSync(path.join(ui, 'default', 'broken.tga'), Buffer.from('not a tga at all, really'));
  fs.writeFileSync(path.join(eq, 'secret.tga'), buildTga(IMG));

  it('merges the skin over default, EQUI_ files only', () => {
    const m = skin.loadSkinModel(eq, 'myskin');
    expect(m.ok).toBe(true);
    expect(m.dirs.map((d) => d.name)).toEqual(['myskin', 'default']);
    expect(m.screens.TestWnd.dir).toBe('myskin');
    expect(m.animations.A_Fill.dir).toBe('default');       // only default has the animations
    expect(m.screens.NotMe).toBeUndefined();               // SIDL.xml is the schema, not a window
  });
  it('a missing skin directory is not an error (default still loads)', () => {
    const m = skin.loadSkinModel(eq, 'nosuchskin');
    expect(m.dirs[0].exists).toBe(false);
    expect(Object.keys(m.animations).length).toBeGreaterThan(0);
  });
  it('rejects a skin name that is a path', () => {
    expect(skin.loadSkinModel(eq, '../x').ok).toBe(false);
    expect(skin.readSkinTexture(eq, '..', 'x.tga')).toBeNull();
  });
  it('finds a texture case-insensitively in the skin dir, then falls back to default', () => {
    expect(skin.readSkinTexture(eq, 'myskin', 'sheet.tga')).toMatchObject({ width: 3, height: 2 });
    expect(skin.readSkinTexture(eq, 'myskin', 'only_default.tga')).toMatchObject({ width: 3, height: 2 });
  });
  it('is path-guarded: basename only, nothing outside uifiles', () => {
    for (const bad of ['../../secret.tga', '../secret.tga', 'default/only_default.tga', 'default\\only_default.tga', '/etc/passwd', '..', '', 'a\0b.tga']) {
      expect(skin.readSkinTexture(eq, 'myskin', bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it('undecodable or missing files give null, never a throw', () => {
    expect(skin.readSkinTexture(eq, 'myskin', 'broken.tga')).toBeNull();
    expect(skin.readSkinTexture(eq, 'myskin', 'nope.tga')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('anchors and AutoStretch (the point of rendering at the ini size, not the XML size)', () => {
  // the shape the chat window uses: output pinned top, with a 22px band left under it
  const out = { LeftAnchorOffset: 1, TopAnchorOffset: 1, RightAnchorOffset: 1, BottomAnchorOffset: 22, RightAnchorToLeft: false, BottomAnchorToTop: false };
  it('the chat output keeps a 1px margin and a 22px bottom band at the design size', () => {
    expect(R.anchorRect(out, 421, 200)).toEqual({ x: 1, y: 1, w: 419, h: 177 });
  });
  it('grows with the window when it is resized in game', () => {
    expect(R.anchorRect(out, 700, 320)).toEqual({ x: 1, y: 1, w: 698, h: 297 });
  });
  it('an edge anchored to the far side follows that side (input line under the output)', () => {
    const input = { LeftAnchorOffset: 1, TopAnchorOffset: 25, RightAnchorOffset: 1, BottomAnchorOffset: 1, TopAnchorToTop: false, RightAnchorToLeft: false, BottomAnchorToTop: false };
    expect(R.anchorRect(input, 421, 200)).toEqual({ x: 1, y: 175, w: 419, h: 24 });
    expect(R.anchorRect(input, 421, 400)).toEqual({ x: 1, y: 375, w: 419, h: 24 });   // pinned to the bottom, same height
  });
  it('a left edge anchored to the RIGHT side moves right with the window', () => {
    const p = { LeftAnchorToLeft: false, LeftAnchorOffset: 100, RightAnchorOffset: 10 };
    expect(R.anchorRect(p, 300, 50)).toMatchObject({ x: 200, w: 90 });
    expect(R.anchorRect(p, 500, 50)).toMatchObject({ x: 400, w: 90 });
  });

  const model = skin.buildModel(files('s'), {});
  it('layoutScreen: AutoStretch child follows the window, a plain child keeps its Location', () => {
    const at = (w, h) => R.layoutScreen(model, 'TestWnd', w, h, {});
    const textOf = (l) => l.cmds.find((c) => c.t === 'text' && c.text === 'R&D lab');
    const small = at(200, 120), big = at(480, 300);
    // plain label: same place at any size
    expect(textOf(small)).toMatchObject({ x: small.client.x + 5, y: small.client.y + 6 });
    expect(textOf(big)).toMatchObject({ x: big.client.x + 5, y: big.client.y + 6 });
    // the stretched box (a bordered STMLbox) grows: its top-right border corner sits further right in the big window
    const corner = (l) => l.cmds.filter((c) => c.t === 'img' && c.sx === 14 && c.sy === 0 && c.sw === 10);   // A_TR
    const innerTR = (l) => corner(l).find((c) => c.x !== l.width - 10);   // not the outer window's own corner
    expect(innerTR(big).x).toBeGreaterThan(innerTR(small).x + 250);
    expect(innerTR(small).x).toBe(small.client.x + 1 + (200 - 2) - 10);
  });
  it('the ini size wins over the XML design size', () => {
    expect(R.layoutScreen(model, 'TestWnd', 333, 77, {})).toMatchObject({ width: 333, height: 77 });
    expect(R.layoutScreen(model, 'TestWnd', 0, 0, {})).toMatchObject({ width: 200, height: 120 });   // no size given: design size
  });
});

describe('window frame layout', () => {
  const model = skin.buildModel(files('s'), {});
  const l = R.layoutScreen(model, 'TestWnd', 200, 120, {});
  it('tiles the background over the whole window and asks for its texture', () => {
    expect(l.cmds[0]).toMatchObject({ t: 'bgtile', tex: 'bg.tga', x: 0, y: 0, w: 200, h: 120 });
    expect(l.textures).toContain('bg.tga');
    expect(l.textures).toContain('sheet.tga');
  });
  it('puts corners at the corners and tiles the edges between them', () => {
    const imgs = l.cmds.filter((c) => c.t === 'img');
    const tl = imgs.find((c) => c.sx === 0 && c.sy === 0 && c.sw === 10 && c.x === 0 && c.y === 0);
    const tr = imgs.find((c) => c.sx === 14 && c.sy === 0 && c.sw === 10 && c.x === 200 - 10 && c.y === 0);
    const top = imgs.find((c) => c.sx === 10 && c.sw === 4 && c.sh === 4 && c.tile && c.y === 0);
    expect(tl).toBeTruthy(); expect(tr).toBeTruthy();
    expect(top).toMatchObject({ x: 10, w: 180, tile: true });
  });
  it('a title bar pushes the client area down to its bottom edge; the border does not inset it', () => {
    expect(l.client).toEqual({ x: 0, y: 4 + 16, w: 200, h: 120 - 20 });
    const inset = R.layoutScreen(model, 'TestWnd', 200, 120, { insetClientByBorder: true });
    expect(inset.client).toEqual({ x: 4, y: 20, w: 192, h: 120 - 20 - 4 });
  });
  it('unknown screens and missing textures do not throw', () => {
    expect(R.layoutScreen(model, 'NoSuchWindow', 10, 10, {}).missing).toBe(true);
    expect(() => R.neededTextures(model, 'TestWnd', 50, 50)).not.toThrow();
  });
});

// UI Studio's "Real look" (apps/mimic/ui-studio.html): which skin screen draws a window, and the wiring to main.
describe('UI Studio real look: window → skin screen, and the wiring', () => {
  const studio = readSource(path.join(ROOT, 'apps', 'mimic', 'ui-studio.html'));
  const block = sliceBlock(studio, '  function _lookScreen(w){', '\n    return null;\n  }');
  const lookScreen = (screens, w) => new Function('STATE', block + '\nreturn _lookScreen;')({ lookModel: { screens } })(w);
  const sc = { PlayerWindow: {}, BankWnd: {}, HotButtonWnd: {}, ChatWindow: {}, TargetWindow: {} };
  it('finds the screen by the size scan\'s name rules', () => {
    expect(lookScreen(sc, { section: 'PlayerWindow' })).toBe('PlayerWindow');
    expect(lookScreen(sc, { section: 'Bank' })).toBe('BankWnd');
    expect(lookScreen(sc, { section: 'HotButtonWnd_2' })).toBe('HotButtonWnd');
    expect(lookScreen(sc, { section: 'Chat 3' })).toBe('ChatWindow');
    expect(lookScreen(sc, { section: 'MainChat', kind: 'chat' })).toBe('ChatWindow');
  });
  it('Zeal bars and windows the skin does not define stay boxes', () => {
    expect(lookScreen(sc, { section: 'RaidBars', zealBar: 'raidbars' })).toBe(null);
    expect(lookScreen(sc, { section: 'SomethingElse' })).toBe(null);
    expect(lookScreen(null, { section: 'PlayerWindow' })).toBe(null);
  });
  it('is wired: renderer script loaded, both IPCs bridged and handled, the cached image painted as the background', () => {
    const code = stripJs(studio);
    expect(studio).toContain('<script src="sidlRender.js"></script>');
    expect(code).toContain("(look ? 'background-image:url(' + look + ');' : '')");
    expect(code).toContain('window.mimic.uiStudioSkinModel(STATE.eqDir)');
    expect(code).toContain('window.mimic.uiStudioSkinTextures(STATE.eqDir, m.skin, files)');
    const preload = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
    expect(preload).toContain("ipcRenderer.invoke('ui-studio-skin-model', eqDir)");
    expect(preload).toContain("ipcRenderer.invoke('ui-studio-skin-textures', eqDir, skin, files)");
    const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
    expect(main).toContain("ipcMain.handle('ui-studio-skin-model'");
    expect(main).toContain('sidlSkin.readSkinTexture(d, skin, f)');
  });
});
