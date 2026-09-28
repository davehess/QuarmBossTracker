// utils/questDialog.js — what to say to an NPC, read from its own quest script (the guild lead,
// 2026-09-28: "lets make a quest tab on target info that has the quest details for what to say
// and copyable /say and /map items for who to talk to next").
//
// Input is a Lua body from eqemu_quest_scripts (all 5,719 mirrored scripts are Lua). Keywords are
// found the way the server finds them, e.message:findi("..."), because the [bracketed] words in
// replies are not reliable: Tarerd Gahar says "[from you]" and listens for "from me". Pure;
// test/quest-dialog.test.js runs it on real script shapes.

// A Lua string literal starting at s[i] (" or '), returned with where it ends.
function _readString(s, i) {
  const q = s[i];
  let out = '';
  let j = i + 1;
  while (j < s.length && s[j] !== q) {
    if (s[j] === '\\' && j + 1 < s.length) { out += s[j + 1] === 'n' ? ' ' : s[j + 1]; j += 2; continue; }
    out += s[j++];
  }
  return { text: out, end: j + 1 };
}

// The argument list of a call whose "(" is at s[open], up to its matching ")".
function _callArgs(s, open) {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'") { j = _readString(s, j).end - 1; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return s.slice(open + 1, j);
  }
  return s.slice(open + 1);
}

// Split on a top-level separator (outside strings and brackets).
function _splitTop(expr, sep) {
  const parts = [];
  let depth = 0, cur = '';
  for (let j = 0; j < expr.length; j++) {
    const c = expr[j];
    if (c === '"' || c === "'") { const r = _readString(expr, j); cur += expr.slice(j, r.end); j = r.end - 1; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    if (c === ')' || c === '}' || c === ']') depth--;
    if (depth === 0 && expr.startsWith(sep, j)) { parts.push(cur); cur = ''; j += sep.length - 1; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

// "Hello " .. e.other:GetCleanName() .. ", friend" → "Hello <you>, friend". Anything computed
// that is not the player's name becomes "…".
function _exprText(expr) {
  return _splitTop(expr, '..').map((p) => {
    const t = p.trim();
    if (t[0] === '"' || t[0] === "'") return _readString(t, 0).text;
    if (/Get(?:Clean)?Name\s*\(/.test(t)) return '<you>';
    return '…';
  }).join('').replace(/\s+/g, ' ').trim();
}

const REPLY_RX = /e\.self:(Say|Emote|Shout)\s*\(|e\.other:Message\s*\(/g;

// Every NPC line in a stretch of script, in order.
function _replies(seg) {
  const out = [];
  REPLY_RX.lastIndex = 0;
  let m;
  while ((m = REPLY_RX.exec(seg))) {
    const open = m.index + m[0].length - 1;
    let args = _callArgs(seg, open);
    const kind = m[1] ? m[1].toLowerCase() : 'message';
    if (kind === 'message') {
      const parts = _splitTop(args, ',');
      if (parts.length < 2) continue;
      // Message(15, "You have received a character flag!") is system text, not the NPC talking.
      if (Number(parts[0].trim()) === 15) continue;
      args = parts.slice(1).join(',');
    }
    let text = _exprText(args);
    // Scripts that print their own tell: "Maelin tells you, '...'" → the words inside.
    const tell = /^[A-Za-z`' ]+? tells you, '([\s\S]*)'$/.exec(text);
    if (tell) text = tell[1];
    if (text && text !== '…') out.push({ kind, text });
  }
  return out;
}

const GATE_RX = /\bqglobals\b|:HasItem\s*\(|:GetFaction|:GetLevel\s*\(|:GetClass\s*\(|:GetRace\s*\(|:GetDeity\s*\(|FactionValue/;

// One entry per findi branch of event_say, in script order:
//   { keywords, replies: [{kind, text}], gated, flag, clears, hints }
// sit = the NPC only answers while you are seated;
// gated = the reply depends on the player's flags, items, faction, level, class or race;
// flag = this branch gives a character flag; clears = it deletes flags (the Seer's "delete").
function parseDialog(body) {
  const src = String(body || '');
  const start = src.search(/function\s+event_say\s*\(/);
  if (start < 0) return [];
  const next = src.indexOf('\nfunction ', start + 10);
  const say = src.slice(start, next < 0 ? src.length : next);
  const COND_RX = /\b(?:if|elseif)\b([^\n]*?)\bthen\b/g;
  const branches = [];
  let m;
  while ((m = COND_RX.exec(say))) {
    const hits = [...m[1].matchAll(/findi\(\s*(["'])(.+?)\1\s*\)/g)]
      .filter((k) => !/\bnot\s+[\w.:]*$/.test(m[1].slice(0, k.index)));
    const kws = hits.map((k) => k[2].trim()).filter(Boolean);
    // "and" between two findi calls means the line must hold every word: the Seer's
    // findi("unlock") and findi("memories") ignores a bare "unlock".
    const needsAll = hits.some((k, i) => i > 0 && /\band\b/.test(m[1].slice(hits[i - 1].index + hits[i - 1][0].length, k.index)));
    if (kws.length) {
      const keywords = [...new Set(kws)];
      branches.push({ start: m.index, at: m.index + m[0].length, cond: m[1], keywords, sayText: needsAll ? keywords.join(' ') : keywords[0] });
    }
  }
  // GM-only branches (the Seer's "delete" wipes every PoP flag, gated on GetGM() and
  // Admin() >= 80) are not something a player can say.
  const GM_RX = /:GetGM\s*\(|:Admin\s*\(/;
  // A branch runs until the next keyword branch; nested conditions inside it (flag checks)
  // stay part of it.
  return branches.map((b, n) => {
    const seg = say.slice(b.at, n + 1 < branches.length ? branches[n + 1].start : say.length);
    const replies = _replies(seg);
    const hints = [...new Set(replies.flatMap((r) => [...r.text.matchAll(/\[([^\]]{1,40})\]/g)].map((h) => h[1].trim())))];
    return {
      keywords: b.keywords,
      say: b.sayText,        // what to put after /say: one keyword, or all of them when all are needed
      replies,
      // Only answers while you sit (the Seer's meditation and "unlock my memories"; the guild
      // lead, 2026-09-28: "i had to sit down first").
      sit: /:IsSitting\s*\(/.test(b.cond) || /:IsSitting\s*\(/.test(seg),
      gm: GM_RX.test(b.cond),
      gated: GATE_RX.test(b.cond) || GATE_RX.test(seg),
      flag: /set_global\s*\(|received a character flag/i.test(seg),
      clears: /delete_global\s*\(/.test(seg) && !/set_global\s*\(/.test(seg),
      hints,
    };
  }).filter((b) => !b.gm && (b.replies.length || b.flag || b.clears)).map(({ gm, ...b }) => b);
}

// What the NPC says when you hand something in (event_trade), in order. The "who's next"
// names often live here: Tarerd Gahar takes the Sarnak blood and sends you to Thiran.
function tradeReplies(body) {
  const src = String(body || '');
  const start = src.search(/function\s+event_trade\s*\(/);
  if (start < 0) return [];
  const next = src.indexOf('\nfunction ', start + 10);
  return _replies(src.slice(start, next < 0 ? src.length : next));
}

// Names worth looking up as "who to talk to next": runs of Capitalised words (with the
// `'- joiners EQ names use, and "of"/"the" inside a run), plus every shorter run inside
// them. The catalog decides which are NPCs.
const NAME_STOP = new Set(['I', 'You', 'We', 'The', 'A', 'An', 'My', 'Your', 'If', 'It', 'This', 'That', 'Go', 'Now',
  'Welcome', 'Hail', 'Yes', 'No', 'Oh', 'Ah', 'Well', 'But', 'And', 'Please', 'Thank', 'Thanks', 'Greetings', 'Be',
  'Come', 'Bring', 'Take', 'Find', 'Seek', 'Speak', 'Talk', 'Return', 'Let', 'What', 'When', 'Where', 'Why', 'How',
  'Farewell', 'Good', 'Very', 'Here', 'There', 'He', 'She', 'They', 'Our', 'His', 'Her', 'Their', 'Is', 'Are', 'Do']);
function nameCandidates(texts) {
  const out = new Set();
  const RUN = /[A-Z][A-Za-z`'’-]+(?:\s+(?:(?:of|the)\s+)?[A-Z][A-Za-z`'’-]+)*/g;
  for (const t of texts) {
    for (const m of String(t || '').matchAll(RUN)) {
      const words = m[0].split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j <= Math.min(words.length, i + 5); j++) {
          const w = words.slice(i, j);
          if (/^(of|the)$/.test(w[0]) || /^(of|the)$/.test(w[w.length - 1])) continue;
          if (w.length === 1 && (NAME_STOP.has(w[0]) || w[0].length < 3)) continue;
          out.add(w.join(' ').replace(/[’]/g, "'").replace(/'s$/, ''));
        }
      }
    }
  }
  return [...out];
}

// Single words the replies only ever capitalise because they start a sentence. The catalog has
// NPCs named "Some", "One" and "Perhaps", so Willamina's "Some are not even aware…" sent people
// to Grieg's End (the guild lead, 2026-09-28: "Why does this mention Grief's end?"). Such a word
// may still match an NPC in the same zone by surname ("Thiran will give you the book" → Vicar
// Thiran), but never an NPC anywhere by that bare name. Lower-cased.
function sentenceStartOnly(texts) {
  const atStart = new Set(), midSentence = new Set();
  for (const t of texts) {
    for (const m of String(t || '').matchAll(/[A-Z][A-Za-z`'’-]+/g)) {
      const before = String(t).slice(0, m.index).replace(/["'‘“(\s]+$/, '');
      const w = m[0].toLowerCase().replace(/[’]/g, "'").replace(/'s$/, '');
      (before === '' || /[.!?:]$/.test(before) ? atStart : midSentence).add(w);
    }
  }
  return new Set([...atStart].filter((w) => !midSentence.has(w)));
}

// A catalog name ("#Chronographer_Muon") as players see it ("Chronographer Muon").
const displayName = (n) => String(n || '').replace(/^#+/, '').replace(/_/g, ' ').trim();

// The script file for a catalog NPC: zone folder + the catalog name, with the backtick that
// filenames cannot hold written as "-" (Seer_Mal_Nae`Shi → Seer_Mal_Nae-Shi.lua).
const scriptPath = (zoneShort, npcName) => `${zoneShort}/${String(npcName).replace(/`/g, '-')}.lua`;

module.exports = { parseDialog, tradeReplies, nameCandidates, sentenceStartOnly, displayName, scriptPath, _exprText, _replies };
