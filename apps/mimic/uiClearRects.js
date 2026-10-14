// uiClearRects.js — which EverQuest windows are OPEN, and where, read from a UI ini.
//
// The Map's Full mode keeps its drawing off EverQuest's own windows (the guild lead, 2026-10-14: "give map a toggle full
// vs window mode, and have it avoid drawing over UI elements when see through maps are in position"). This is the
// read half: given the text of UI_<Char>_pq.proj.ini, return the rectangle of every window that is shown, in EverQuest's
// own pixels. Converting them to the Map's window is map.html's uiRectsToMap. Read-only: Mimic never writes these files
// from here (EQ rewrites them on camp / zone / quit, so a window moved since then is where the ini does not say).
//
// What a UI ini section looks like (the keys UI Studio and auto-arrange already read):
//   [PlayerWindow]
//   Show=1
//   XPos1920x1080=24        <- position is stored PER RESOLUTION; a bare XPos is the older form
//   YPos1920x1080=30
//   Width=260               <- size is bare; absent for a window that takes its skin's own size
//   Height=130
//
// Choices a reader should know:
//  - Only Show=1 (or true/yes/on) counts. A section with no Show key is NOT shown: EQ writes Show for the windows it
//    opens and closes, and a closed window is the common case, so leaving it out is the quieter mistake.
//  - The live resolution is the XPos<W>x<H> block with the most keys, as auto-arrange assumes.
//  - A shown window with no Width/Height is given a 200 x 100 stand-in and marked `guess: true`: its real size lives in
//    the skin's XML, which this does not read. The user's own keep-clear boxes cover what a guess misses.
//  - A guess is listed in the Map's settings as "size unknown" / "saved for <res>" and is NOT kept clear until the raider
//    ticks it (applyPicks): drawing over a window by mistake costs a glance, cutting a hole where nothing is costs the map.
//  - Nothing here reads a "minimised" or "collapsed" key: no such key is confirmed in any UI ini the repo has seen, and
//    one is not invented. A window EverQuest keeps Show=1 while it is collapsed to its title bar is cut out at its
//    full stored size; the raider unticks it in the Map's list.
//  - `skip` is an optional RegExp of section names to ignore (login-screen and pop-up windows that never sit on the HUD).
'use strict';

const SEC_RE = /^\s*\[([^\]]+)\]\s*$/;
const KV_RE = /^\s*([\w.]+)\s*=\s*(.*?)\s*$/;
const SHOWN_RE = /^(1|true|yes|on)$/i;

// Sections as { name, props } with lower-cased keys (the Windows profile API EQ writes these with ignores case).
function parseSections(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const m = SEC_RE.exec(raw);
    if (m) { cur = { name: m[1].trim(), props: {} }; out.push(cur); continue; }
    if (!cur) continue;
    const kv = KV_RE.exec(raw);
    if (kv) cur.props[kv[1].toLowerCase()] = kv[2];
  }
  return out;
}

// The resolution block the file was last laid out for: the "<W>x<H>" suffix with the most XPos keys, or null.
function dominantResolution(sections) {
  const counts = new Map();
  for (const s of sections) {
    for (const k of Object.keys(s.props)) {
      const m = /^xpos(\d+)x(\d+)$/.exec(k);
      if (m) counts.set(m[1] + 'x' + m[2], (counts.get(m[1] + 'x' + m[2]) || 0) + 1);
    }
  }
  let best = null, n = 0;
  for (const [k, c] of counts) if (c > n) { n = c; best = k; }
  if (!best) return null;
  const [w, h] = best.split('x').map(Number);
  return { w, h, key: best };
}

// Which resolution block to read. Without a client size it is the dominant one (as before). With one (EverQuest's window,
// in physical pixels) a block within 3% of it on both sides wins - that is the layout EverQuest is drawing right now -
// and when none is that close the dominant block is read but `match: false` says the file was last saved for another size.
function chooseResolution(sections, client) {
  const dom = dominantResolution(sections);
  if (!dom || !client || !(client.w > 0) || !(client.h > 0)) return dom;
  const seen = new Set();
  let best = null, bestD = Infinity;
  for (const s of sections) {
    for (const k of Object.keys(s.props)) {
      const m = /^xpos(\d+)x(\d+)$/.exec(k);
      if (!m || seen.has(k)) continue;
      seen.add(k);
      const w = Number(m[1]), h = Number(m[2]);
      const dw = Math.abs(w - client.w) / client.w, dh = Math.abs(h - client.h) / client.h;
      if (dw <= 0.03 && dh <= 0.03 && dw + dh < bestD) { bestD = dw + dh; best = { w, h, key: m[1] + 'x' + m[2] }; }
    }
  }
  return best ? Object.assign(best, { match: true }) : Object.assign({}, dom, { match: false });
}

// What the window's name (the UI ini section) is called in lists and on the outline: "TargetWindow", "Zeal RaidBars".
// The id is the same name lower-cased, so a pick survives EverQuest rewriting the file.
function areaId(kind, name) { return kind + ':' + String(name == null ? '' : name).trim().toLowerCase(); }
function areaText(name, notes) { return notes && notes.length ? name + ' (' + notes.join(', ') + ')' : name; }

// → { res: { w, h, match? } | null, rects: [{ name, id, text, x, y, w, h, guess, notes }] }, every rect in EverQuest pixels.
// `opts.client` = { w, h }: EverQuest's client size now, to choose the block by (see chooseResolution). A rect is `guess`
// when its size or place is not stated by the file: no Width/Height (a 200 x 100 stand-in), or the file was last saved for
// another resolution than EverQuest is running at. A guess is not kept clear unless the raider ticks it (applyPicks).
function visibleUiRects(text, opts) {
  const skip = opts && opts.skip instanceof RegExp ? opts.skip : null;
  const sections = parseSections(text);
  const chosen = chooseResolution(sections, opts && opts.client);
  const res = chosen;
  const savedFor = chosen && chosen.match === false ? chosen.w + 'x' + chosen.h : null;
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const rects = [];
  for (const s of sections) {
    const p = s.props;
    if (!SHOWN_RE.test(String(p.show == null ? '' : p.show).trim())) continue;
    if (skip && skip.test(s.name)) continue;
    const gx = res && p['xpos' + res.key] != null ? p['xpos' + res.key] : p.xpos;
    const gy = res && p['ypos' + res.key] != null ? p['ypos' + res.key] : p.ypos;
    const x = num(gx), y = num(gy);
    if (x == null || y == null) continue;
    const rw = num(p.width != null ? p.width : p['size.cx']);
    const rh = num(p.height != null ? p.height : p['size.cy']);
    const sizeGuess = rw == null || rh == null;
    const w = sizeGuess ? 200 : rw, h = sizeGuess ? 100 : rh;
    if (w <= 0 || h <= 0 || x < -50 || y < -50) continue;
    const notes = [];
    if (sizeGuess) notes.push('size guessed');
    if (savedFor) notes.push('saved for ' + savedFor);
    rects.push({ name: s.name, id: areaId('ui', s.name), text: areaText(s.name, notes), x, y, w, h, guess: notes.length > 0, notes });
  }
  const out = res ? { w: res.w, h: res.h } : null;
  if (out && res.match !== undefined) out.match = res.match;
  return { res: out, rects };
}

// Zeal's own bars (from main.js _zealBarRects, in EverQuest pixels) in the same shape. The raid bars' box runs to the
// screen's edge when zeal.ini's Right / Bottom are 0 - that is a limit, not the size of what is drawn, and the list of
// raid members inside it is usually a narrow strip - so a box that reaches the edge counts as a guess.
function zealAreas(bars, res) {
  const out = [];
  for (const z of Array.isArray(bars) ? bars : []) {
    if (!z || ![z.x, z.y, z.w, z.h].every(Number.isFinite)) continue;
    const toEdge = !!(/raidbars/i.test(z.name) && res && (z.x + z.w >= res.w || z.y + z.h >= res.h));
    const notes = toEdge ? ['runs to the screen edge'] : [];
    out.push({ name: z.name, id: areaId('zeal', z.name), text: areaText(z.name, notes), x: z.x, y: z.y, w: z.w, h: z.h, guess: toEdge, notes });
  }
  return out;
}

// The raider's picks, { id: true | false }: true = keep this one clear, false = draw over it. An id with no pick follows
// the default, which is "keep clear unless it is a guess". → every rect with `keep` set.
function applyPicks(rects, picks) {
  const p = picks && typeof picks === 'object' ? picks : {};
  return (rects || []).map((r) => Object.assign({}, r, { keep: typeof p[r.id] === 'boolean' ? p[r.id] : !r.guess }));
}
// Picks as they are saved: ids of the shape areaId makes, booleans only, at most 80.
const PICK_ID_RE = /^(ui|zeal):[^\r\n]{1,60}$/;
function cleanPicks(picks) {
  const out = {};
  if (!picks || typeof picks !== 'object') return out;
  for (const k of Object.keys(picks)) {
    if (Object.keys(out).length >= 80) break;
    if (PICK_ID_RE.test(k) && typeof picks[k] === 'boolean') out[k] = picks[k];
  }
  return out;
}

module.exports = { visibleUiRects, parseSections, dominantResolution, chooseResolution, zealAreas, applyPicks, cleanPicks, areaId };
