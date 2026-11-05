'use strict';
// sidlSkin.js — main-process reader for an EverQuest UI skin (UI Studio's "show what the windows really look like").
//
// EQ's UI is described in "SIDL" XML: uifiles/<skin>/EQUI_*.xml plus .tga/.png textures. The client loads the active
// skin's files and falls back to uifiles/default for anything the skin does not define, merged per item name. This
// module does the same and hands the renderer (sidlRender.js, browser side) a JSON-serialisable model, plus decoded
// pixels for textures. Zero npm deps: Node built-ins only (fs, path, zlib).
//
//   loadSkinModel(eqDir, skinName)        -> model (see buildModel)
//   readSkinTexture(eqDir, skinName, f)   -> { width, height, rgba: Uint8Array } | null
//   parseXml / buildModel / decodeTga / decodePng are exported for tests.
//
// The skin files are the raider's own (or Daybreak's): this module only READS them at runtime. Nothing here ships art.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------------------------------------------------------------
// Tolerant XML parser. EQ's XML is simple (elements, item="…" attributes, text, comments) but hand-edited skins carry
// stray '&', mismatched close tags, odd casing and a BOM, so this never throws: it builds the best tree it can.
// Node: { name, attrs, children, text }.
// ---------------------------------------------------------------------------------------------------------------------
const _ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function _decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const v = _ENT[g.toLowerCase()];
    return v === undefined ? m : v;   // an unknown entity, or a bare '&' with no ';', stays literal
  });
}

function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let s = String(src == null ? '' : src);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const n = s.length;
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { top().text += _decodeEntities(s.slice(i)); break; }
    if (lt > i) top().text += _decodeEntities(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt + 9);
      top().text += s.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    const c1 = s[lt + 1];
    if (c1 === '?' || c1 === '!') {
      const e = s.indexOf('>', lt + 2);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (c1 === '/') {
      const e = s.indexOf('>', lt + 2);
      const nm = s.slice(lt + 2, e < 0 ? n : e).trim().toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name.toLowerCase() === nm) { stack.length = k; break; }
      }   // a close tag that matches nothing open is ignored
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (!c1 || !/[A-Za-z_]/.test(c1)) {   // a stray '<' in text ("a < b")
      top().text += '<';
      i = lt + 1;
      continue;
    }
    // Open tag: find its '>' honouring quotes.
    let j = lt + 1, q = '';
    while (j < n) {
      const ch = s[j];
      if (q) { if (ch === q) q = ''; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '>') break;
      j++;
    }
    let inner = s.slice(lt + 1, Math.min(j, n));
    const selfClose = /\/\s*$/.test(inner);
    if (selfClose) inner = inner.replace(/\/\s*$/, '');
    const m = /^([^\s/>]+)/.exec(inner);
    const node = { name: m ? m[1] : '?', attrs: {}, children: [], text: '' };
    const rest = m ? inner.slice(m[0].length) : '';
    const rxA = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let am;
    while ((am = rxA.exec(rest)) !== null) {
      node.attrs[am[1]] = _decodeEntities(am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4]);
    }
    top().children.push(node);
    if (!selfClose) stack.push(node);
    i = j + 1;
  }
  return root;
}

// ---------------------------------------------------------------------------------------------------------------------
// Node -> plain JSON value. A leaf becomes a bool / number / string; an element with children becomes an object keyed
// by child name (original casing kept); a repeated child becomes an array. Pieces / Frames / Columns are ALWAYS arrays
// (a Screen with one <Pieces> must still read as a list). Nothing is dropped: an element this module has never heard of
// is just another key.
// ---------------------------------------------------------------------------------------------------------------------
const ALWAYS_ARRAY = { pieces: 1, frames: 1, columns: 1 };

function _coerce(t) {
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?(\d+\.\d*|\.\d+)$/.test(t)) return parseFloat(t);
  return t;
}
function _coerceAttrs(attrs) {
  const o = {};
  for (const k of Object.keys(attrs)) o[k] = _coerce(String(attrs[k]).trim());
  return o;
}
function nodeToValue(node) {
  if (!node.children.length) {
    const t = node.text.trim();
    if (Object.keys(node.attrs).length) {   // the lowercase-schema variant: <Size width="800" height="600"/>
      const o = _coerceAttrs(node.attrs);
      if (t) o.$text = t;
      return o;
    }
    return _coerce(t);
  }
  const o = {};
  for (const ch of node.children) {
    const key = ch.name;
    const v = nodeToValue(ch);
    if (Object.prototype.hasOwnProperty.call(o, key)) {
      if (Array.isArray(o[key]) && (ALWAYS_ARRAY[key.toLowerCase()] || o[key].$multi)) o[key].push(v);
      else { o[key] = [o[key], v]; Object.defineProperty(o[key], '$multi', { value: true, enumerable: false }); }
    } else {
      o[key] = ALWAYS_ARRAY[key.toLowerCase()] ? [v] : v;
    }
  }
  return o;
}

function _num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function _frame(f) {
  const o = f && typeof f === 'object' ? f : {};
  const loc = o.Location || {}, sz = o.Size || {}, hs = o.Hotspot || {};
  return {
    texture: typeof o.Texture === 'string' ? o.Texture : '',
    x: _num(loc.X, 0), y: _num(loc.Y, 0),
    w: _num(sz.CX, 0), h: _num(sz.CY, 0),
    hx: _num(hs.X, 0), hy: _num(hs.Y, 0),
    duration: _num(o.Duration, 0),
  };
}

// Which top-level elements are which. Anything else carrying an item="…" is a ScreenPiece (Button, Label, Gauge,
// StaticAnimation, StaticText, StaticFrame, InvSlot, SpellGem, Listbox, Editbox, Slider, Combobox, Page, TabBox,
// STMLbox, HotButton…) and lands in model.pieces with its element name as `type`; anything with no item goes to `other`.
const TEMPLATE_RX = /^(?:\w*DrawTemplate|FrameTemplate|\w*Template)$/i;

// files: [{ dir: 'label', name: 'EQUI_x.xml', xml: '<…>' }] in PRIORITY order (the skin's before default's); the first
// definition of an item name wins, which is the client's skin-over-default merge.
function buildModel(files, meta) {
  const model = {
    skin: (meta && meta.skin) || '',
    dirs: (meta && meta.dirs) || [],
    textures: {}, animations: {}, templates: {}, pieces: {}, screens: {}, other: [],
  };
  let parsed = 0;
  for (const f of files) {
    const root = parseXml(f.xml);
    parsed++;
    // <XML ID="EQInterfaceDefinitionLanguage"> wraps everything; a tolerant reader also accepts items at the top.
    const holders = [];
    for (const ch of root.children) {
      if (/^xml$/i.test(ch.name)) holders.push(ch); else holders.push({ children: [ch] });
    }
    for (const h of holders) {
      for (const el of h.children) {
        const name = String(el.attrs.item != null ? el.attrs.item : (el.attrs.Item != null ? el.attrs.Item : '')).trim();
        const kind = el.name;
        const lk = kind.toLowerCase();
        if (lk === 'schema') continue;
        if (!name) { model.other.push({ type: kind, file: f.name, dir: f.dir, props: nodeToValue(el) }); continue; }
        const props = nodeToValue(el);
        const base = { type: kind, name, file: f.name, dir: f.dir };
        if (lk === 'textureinfo') {
          if (model.textures[name]) continue;
          const sz = (props && props.Size) || {};
          model.textures[name] = Object.assign(base, { w: _num(sz.CX, 0), h: _num(sz.CY, 0) });
        } else if (lk === 'ui2danimation') {
          if (model.animations[name]) continue;
          const p = props && typeof props === 'object' ? props : {};
          const rawFrames = Array.isArray(p.Frames) ? p.Frames : [];
          const rest = Object.assign({}, p); delete rest.Frames;
          model.animations[name] = Object.assign(base, {
            cycle: p.Cycle === true,
            vertical: p.Vertical === true,
            grid: p.Grid === true,
            frames: rawFrames.map(_frame),
            props: rest,
          });
        } else if (lk === 'screen') {
          if (model.screens[name]) continue;
          model.screens[name] = Object.assign(base, { props });
        } else if (TEMPLATE_RX.test(kind)) {
          const bucket = model.templates[kind] || (model.templates[kind] = {});
          if (bucket[name]) continue;
          bucket[name] = Object.assign(base, { props });
        } else {
          if (model.pieces[name]) continue;
          model.pieces[name] = Object.assign(base, { props });
        }
      }
    }
  }
  model.stats = {
    files: parsed,
    textures: Object.keys(model.textures).length,
    animations: Object.keys(model.animations).length,
    pieces: Object.keys(model.pieces).length,
    screens: Object.keys(model.screens).length,
  };
  return model;
}

// ---------------------------------------------------------------------------------------------------------------------
// Filesystem side.
// ---------------------------------------------------------------------------------------------------------------------
function _safeSkinName(skinName) {
  const s = String(skinName == null || skinName === '' ? 'default' : skinName).trim();
  if (!s || s.indexOf('/') >= 0 || s.indexOf('\\') >= 0 || s.indexOf('\0') >= 0 || s === '.' || s === '..') return null;
  return s;
}
function _isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function _skinDirs(eqDir, skinName) {
  const s = _safeSkinName(skinName);
  if (!s) return null;
  const ui = path.join(String(eqDir || ''), 'uifiles');
  const out = [{ name: s, dir: path.join(ui, s) }];
  if (s.toLowerCase() !== 'default') out.push({ name: 'default', dir: path.join(ui, 'default') });
  return { ui, dirs: out };
}

function loadSkinModel(eqDir, skinName) {
  const sd = _skinDirs(eqDir, skinName);
  if (!sd) return { ok: false, error: 'bad skin name' };
  const files = [];
  const dirsInfo = [];
  for (const d of sd.dirs) {
    const exists = _isDir(d.dir);
    let count = 0;
    if (exists) {
      let names = [];
      try { names = fs.readdirSync(d.dir); } catch { /* unreadable dir: counts as empty */ }
      names = names.filter((f) => /^EQUI_.*\.xml$/i.test(f)).sort();   // EQUI_ files only; SIDL.xml (the schema) is skipped
      for (const f of names) {
        let xml;
        try { xml = fs.readFileSync(path.join(d.dir, f), 'utf8'); } catch { continue; }
        files.push({ dir: d.name, name: f, xml });
        count++;
      }
    }
    dirsInfo.push({ name: d.name, exists, files: count });
  }
  const model = buildModel(files, { skin: sd.dirs[0].name, dirs: dirsInfo });
  model.ok = true;
  return model;
}

// ---------------------------------------------------------------------------------------------------------------------
// Texture decoders. All return { width, height, rgba: Uint8Array } (straight RGBA, top row first) or null.
// ---------------------------------------------------------------------------------------------------------------------
const MAX_PIXELS = 64 * 1024 * 1024;

function decodeTga(buf) {
  if (!buf || buf.length < 18) return null;
  const idLen = buf[0], cmapType = buf[1], type = buf[2];
  const cmapLen = buf.readUInt16LE(5), cmapBits = buf[7];
  const w = buf.readUInt16LE(12), h = buf.readUInt16LE(14), bpp = buf[16], desc = buf[17];
  if (type !== 2 && type !== 10) return null;      // 8-bit / colour-mapped / greyscale: not decoded
  if (bpp !== 24 && bpp !== 32) return null;
  if (!w || !h || w * h > MAX_PIXELS) return null;
  const bytes = bpp >> 3;
  let off = 18 + idLen + (cmapType ? cmapLen * Math.ceil(cmapBits / 8) : 0);
  const total = w * h;
  const px = new Uint8Array(total * bytes);
  if (type === 2) {
    px.set(buf.subarray(off, Math.min(buf.length, off + px.length)));
  } else {   // RLE: packets may run across scanlines, so decode as one stream
    let o = 0;
    while (o < px.length && off < buf.length) {
      const hd = buf[off++];
      const cnt = (hd & 0x7f) + 1;
      if (hd & 0x80) {
        if (off + bytes > buf.length) break;
        for (let k = 0; k < cnt && o < px.length; k++) for (let b = 0; b < bytes; b++) px[o++] = buf[off + b];
        off += bytes;
      } else {
        const len = Math.min(cnt * bytes, px.length - o, buf.length - off);
        px.set(buf.subarray(off, off + len), o);
        o += len; off += cnt * bytes;
      }
    }
  }
  const topLeft = (desc & 0x20) !== 0;   // origin bit: set = first row is the TOP row; clear = bottom-up (the TGA default)
  const rightToLeft = (desc & 0x10) !== 0;
  const rgba = new Uint8Array(total * 4);
  for (let y = 0; y < h; y++) {
    const sy = topLeft ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const sx = rightToLeft ? w - 1 - x : x;
      const s = (sy * w + sx) * bytes, d = (y * w + x) * 4;
      rgba[d] = px[s + 2]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s];
      rgba[d + 3] = bytes === 4 ? px[s + 3] : 255;
    }
  }
  return { width: w, height: h, rgba };
}

// Community skins (Nillipuss among them) ship some art as PNG, so this is not optional.
function decodePng(buf) {
  if (!buf || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  let plte = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), tp = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (tp === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (tp === 'PLTE') plte = data;
    else if (tp === 'tRNS') trns = data;
    else if (tp === 'IDAT') idat.push(data);
    else if (tp === 'IEND') break;
    off += 12 + len;
  }
  if (!w || !h || w * h > MAX_PIXELS || interlace) return null;
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!chans || ![1, 2, 4, 8, 16].includes(depth)) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const bpp = Math.max(1, (chans * depth) >> 3);               // bytes per pixel for the filter (>=1)
  const stride = Math.ceil((w * chans * depth) / 8);
  if (raw.length < (stride + 1) * h) return null;
  const img = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? img[dst + x - bpp] : 0;
      const b = y > 0 ? img[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? img[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (ft !== 0) return null;
      img[dst + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  const sample = (y, idx) => {   // idx-th sample of row y, as a raw integer of `depth` bits
    const row = y * stride;
    if (depth === 8) return img[row + idx];
    if (depth === 16) return img[row + idx * 2];   // keep the high byte
    const bit = idx * depth;
    return (img[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const scale = depth < 8 && ctype !== 3 ? 255 / ((1 << depth) - 1) : 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      if (ctype === 6) { for (let k = 0; k < 4; k++) rgba[d + k] = sample(y, x * 4 + k); }
      else if (ctype === 2) { for (let k = 0; k < 3; k++) rgba[d + k] = sample(y, x * 3 + k); rgba[d + 3] = 255; }
      else if (ctype === 0) { const g = Math.round(sample(y, x) * scale); rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = 255; }
      else if (ctype === 4) { const g = sample(y, x * 2); rgba[d] = rgba[d + 1] = rgba[d + 2] = g; rgba[d + 3] = sample(y, x * 2 + 1); }
      else {   // palette
        const ix = sample(y, x);
        if (!plte || ix * 3 + 2 >= plte.length) return null;
        rgba[d] = plte[ix * 3]; rgba[d + 1] = plte[ix * 3 + 1]; rgba[d + 2] = plte[ix * 3 + 2];
        rgba[d + 3] = trns && ix < trns.length ? trns[ix] : 255;
      }
    }
  }
  return { width: w, height: h, rgba };
}

// Uncompressed BMP (8-bit paletted, 24, 32). EQ's UI art uses pure magenta (255,0,255) as the colour key in bitmaps
// (assumption from convention; no sample in our fixtures proves it), so that colour becomes transparent.
function decodeBmp(buf) {
  if (!buf || buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
  const dataOff = buf.readUInt32LE(10), hdr = buf.readUInt32LE(14);
  if (hdr < 40) return null;
  const w = buf.readInt32LE(18); let h = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28), comp = buf.readUInt32LE(30);
  const topDown = h < 0; if (topDown) h = -h;
  if (comp !== 0 && !(comp === 3 && bpp === 32)) return null;
  if (!w || w < 0 || !h || w * h > MAX_PIXELS || ![8, 24, 32].includes(bpp)) return null;
  let pal = null;
  if (bpp === 8) {
    const n = buf.readUInt32LE(46) || 256;
    pal = buf.subarray(14 + hdr, 14 + hdr + n * 4);
  }
  const stride = ((w * bpp + 31) >> 5) << 2;
  if (dataOff + stride * h > buf.length) return null;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = topDown ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      let r, g, b, a = 255;
      if (bpp === 8) { const i = buf[dataOff + sy * stride + x] * 4; b = pal[i]; g = pal[i + 1]; r = pal[i + 2]; }
      else { const s = dataOff + sy * stride + x * (bpp >> 3); b = buf[s]; g = buf[s + 1]; r = buf[s + 2]; if (bpp === 32) a = buf[s + 3]; }
      if (r === 255 && g === 0 && b === 255) a = 0;
      rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a;
    }
  }
  return { width: w, height: h, rgba };
}

// TODO(DDS): neither fixture skin we developed against (Zeal's, Nillipuss) contains a .dds, so DXT1/3/5 is not decoded.
function decodeTexture(buf, file) {
  const ext = path.extname(String(file)).toLowerCase();
  try {
    if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return decodePng(buf);
    if (ext === '.bmp') return decodeBmp(buf);
    if (ext === '.tga') return decodeTga(buf);
  } catch { /* corrupt file: a missing texture, never a crash */ }
  return null;
}

// Basename only, then a case-insensitive lookup (the client runs on Windows; the XML's casing is not the disk's) in the
// skin dir, then default. The resolved path must stay under <eqDir>/uifiles.
function readSkinTexture(eqDir, skinName, file) {
  try {
    const name = String(file == null ? '' : file);
    if (!name || name !== path.basename(name) || name.indexOf('\\') >= 0 || name.indexOf('/') >= 0 || name.indexOf('\0') >= 0 || name === '.' || name === '..') return null;
    const sd = _skinDirs(eqDir, skinName);
    if (!sd) return null;
    const root = path.resolve(sd.ui) + path.sep;
    const want = name.toLowerCase();
    for (const d of sd.dirs) {
      let names;
      try { names = fs.readdirSync(d.dir); } catch { continue; }
      const hit = names.find((f) => f.toLowerCase() === want);
      if (!hit) continue;
      const full = path.resolve(d.dir, hit);
      if (!full.startsWith(root)) continue;
      let buf;
      try { buf = fs.readFileSync(full); } catch { continue; }
      const t = decodeTexture(buf, hit);
      if (t) return t;   // a skin file that will not decode falls through to default's copy
    }
  } catch { /* fall through */ }
  return null;
}

module.exports = { loadSkinModel, readSkinTexture, parseXml, nodeToValue, buildModel, decodeTga, decodePng, decodeBmp, decodeTexture };
