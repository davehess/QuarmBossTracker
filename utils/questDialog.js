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
// that is not the player's name becomes "…". A line read out of a table of strings
// (RESPONSES[11]) is looked up in `tables` (from _stringTables).
function _exprText(expr, tables) {
  return _splitTop(expr, '..').map((p) => {
    const t = p.trim();
    if (t[0] === '"' || t[0] === "'") return _readString(t, 0).text;
    if (/Get(?:Clean)?Name\s*\(/.test(t)) return '<you>';
    const ref = /^([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]$/.exec(t);
    if (ref && tables && tables[ref[1]] && tables[ref[1]][Number(ref[2]) - 1]) return tables[ref[1]][Number(ref[2]) - 1];
    return '…';
  }).join('').replace(/\s+/g, ' ').trim();
}

// Top-level `local NAME = { "…", "…", … }` lists of plain strings, by name (Lua indexes from 1).
// Askr the Lost keeps every line in RESPONSES and says e.other:Message(0, RESPONSES[11]); without
// this his Quest tab showed only the hand-ins (the guild lead, 2026-10-01: "This is missing the
// actual instructions"). A table holding anything but strings (the Seer's checklist) is skipped.
function _stringTables(src) {
  const out = {};
  for (const m of String(src || '').matchAll(/(?:^|\n)\s*local\s+([A-Za-z_]\w*)\s*=\s*\{/g)) {
    const items = [];
    let j = m.index + m[0].length, ok = false;
    while (j < src.length) {
      const c = src[j];
      if (c === '"' || c === "'") { const r = _readString(src, j); items.push(r.text); j = r.end; continue; }
      if (src.startsWith('--', j)) { const nl = src.indexOf('\n', j); j = nl < 0 ? src.length : nl; continue; }
      if (c === '}') { ok = true; break; }
      if (c === ',' || /\s/.test(c)) { j++; continue; }
      break;   // a number, a nested table, a variable: not a list of lines
    }
    if (ok && items.length) out[m[1]] = items;
  }
  return out;
}

// RESPONSES[state]: which values `state` can hold here, read off the if/elseif just above the call
// (state == 6 · state == 8 or state == 9 · state <= 3). Unbounded tests (state > 9) give nothing.
function _guardValues(seg, pos, ident) {
  let cond = null;
  for (const m of seg.slice(0, pos).matchAll(/\b(?:if|elseif)\b([^\n]*?)\bthen\b/g)) cond = m[1];
  // null = nothing here guards this index (the Tribunal's "prepared" emote is PREPARED_TEXT[trialNum],
  // chosen by which Tribunal you stand at): every line of the list may be said.
  if (!cond) return null;
  const vals = new Set();
  const id = ident.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`\\b${id}\\b`).test(cond)) return null;
  for (const m of cond.matchAll(new RegExp(`\\b${id}\\s*(==|<=|<)\\s*(\\d+)`, 'g'))) {
    const n = Number(m[2]);
    if (m[1] === '==') vals.add(n);
    else for (let k = 1; k <= (m[1] === '<=' ? n : n - 1) && k <= 30; k++) vals.add(k);
  }
  return [...vals].sort((a, b) => a - b);
}

// Lua e.self:Say(…), and the Perl the turn-in snippets are in: quest::say("… $name …").
const REPLY_RX = /e\.self:(Say|Emote|Shout)\s*\(|quest::(say|emote|shout)\s*\(|e\.other:Message\s*\(/g;

// Every NPC line in a stretch of script, in order. `tables` resolves lines kept in a list
// (RESPONSES[11]); a list indexed by a variable gives one line per value its guard allows.
function _replies(seg, tables) {
  const out = [];
  const push = (kind, raw) => {
    let text = String(raw || '').replace(/\$name\b/g, '<you>');
    // Scripts that print their own tell: "Maelin tells you, '...'" → the words inside.
    const tell = /^[A-Za-z`' ]+? tells you, '([\s\S]*)'$/.exec(text);
    if (tell) text = tell[1];
    if (text && text !== '…') out.push({ kind, text });
  };
  REPLY_RX.lastIndex = 0;
  let m;
  while ((m = REPLY_RX.exec(seg))) {
    const open = m.index + m[0].length - 1;
    let args = _callArgs(seg, open);
    const kind = (m[1] || m[2]) ? (m[1] || m[2]).toLowerCase() : 'message';
    if (kind === 'message') {
      const parts = _splitTop(args, ',');
      if (parts.length < 2) continue;
      // Message(15, "You have received a character flag!") is system text, not the NPC talking.
      if (Number(parts[0].trim()) === 15) continue;
      args = parts.slice(1).join(',');
    }
    const byVar = /^\s*([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\]\s*$/.exec(args);
    if (byVar && tables && tables[byVar[1]]) {
      const list = tables[byVar[1]];
      // An unguarded index gives every line of a SHORT list (the Tribunal's six); a long one is a
      // conversation state machine (Bittrik's 30) where the lines belong to different moments.
      const guard = _guardValues(seg, m.index, byVar[2]) || (list.length <= 8 ? list.map((_, i) => i + 1) : []);
      for (const n of guard) push(kind, list[n - 1]);
      continue;
    }
    push(kind, _exprText(args, tables));
  }
  return out;
}

const GATE_RX = /\bqglobals\b|:HasItem\s*\(|:GetFaction|:GetLevel\s*\(|:GetClass\s*\(|:GetRace\s*\(|:GetDeity\s*\(|FactionValue/;

// What a stretch of script does besides talking, for the Quest tab's warnings and item labels (the
// guild lead, 2026-09-29: "put a warning on anything that despawns a mob or spawns something else,
// or causes negative faction. If there are turn-in requirements or you get an item as output from a
// quest we should denote that"). Reads the Lua scripts and the Perl the turn-in snippets are in.
// Ids only; the bot names them.
//   depopSelf  the NPC itself leaves (eq.depop(), quest::depop_withtimer(), e.self:Depop())
//   depops     NPC type ids it removes (eq.depop(12345), quest::depopall(12345))
//   spawns     NPC type ids it puts up; spawnOther = a spawn whose id the script computes
//   faction    [{ id, delta }] in script order, gains and losses
//   gives      item ids you can get; givesRandom = one of them, picked at random
function effects(code) {
  const s = String(code || '');
  const out = { depopSelf: false, depops: [], spawns: [], spawnOther: false, faction: [], gives: [], givesRandom: false, exp: 0 };
  const add = (list, n) => { if (n > 0 && !list.includes(n)) list.push(n); };
  for (const m of s.matchAll(/(?:\beq\.|quest::)depop(?:_?all|_with_?timer)?\s*\(\s*(\d*)\s*[,)]/gi)) {
    if (m[1]) add(out.depops, Number(m[1])); else out.depopSelf = true;
  }
  if (/e\.self:Depop(?:WithTimer)?\s*\(/.test(s)) out.depopSelf = true;
  for (const m of s.matchAll(/(?:\beq\.|quest::)(?:spawn2|unique_spawn|spawn)\s*\(\s*([^,)]*)/gi)) {
    if (/^\d+$/.test(m[1].trim())) add(out.spawns, Number(m[1].trim())); else out.spawnOther = true;
  }
  if (/(?:\beq\.|quest::)spawn_from_spawn2\s*\(/i.test(s)) out.spawnOther = true;   // Takes a spawn point, not an NPC id.
  // Lua e.other:Faction(e.self, 262, -1, 0) or e.other:Faction(262, -50, 0); Perl quest::faction(291, -20).
  for (const m of s.matchAll(/(?::Faction|quest::faction)\s*\(\s*(?:e\.self\s*,\s*)?(\d+)\s*,\s*(-?\d+)/g)) {
    if (Number(m[2]) !== 0) out.faction.push({ id: Number(m[1]), delta: Number(m[2]) });
  }
  // Items: SummonItem(id) / SummonCursorItem(id) (Askr's bag) / quest::summonitem(id); QuestReward's
  // item slot, written positionally (e.self, copper, silver, gold, platinum, item, exp) or as a table
  // ({itemid = id, items = {…}}); eq.ChooseRandom(a, b, c) / quest::ChooseRandom(…) in either means
  // one of them. QuestReward's exp slot is kept too, so a hand-in that pays only exp says so.
  for (const m of s.matchAll(/(?::SummonItem|:SummonCursorItem|quest::summonitem|QuestReward)\s*\(/g)) {
    const args = _callArgs(s, m.index + m[0].length - 1);
    if (/QuestReward/.test(m[0])) {
      const ex = /\bexp\s*=\s*(\d+)/.exec(args);
      const pos = _splitTop(args, ',');
      const n = ex ? Number(ex[1]) : (pos.length >= 7 && /^\s*\d+\s*$/.test(pos[6]) ? Number(pos[6]) : 0);
      if (n > out.exp) out.exp = n;
    }
    const rnd = /ChooseRandom\s*\(([^)]*)\)/.exec(args);
    if (rnd) {
      out.givesRandom = true;
      for (const n of rnd[1].match(/\d+/g) || []) add(out.gives, Number(n));
      continue;
    }
    if (!/QuestReward/.test(m[0])) {
      const first = /^\s*(\d+)/.exec(args);
      if (first) add(out.gives, Number(first[1]));
      continue;
    }
    const one = /\bitemid\s*=\s*(\d+)/.exec(args);
    if (one) add(out.gives, Number(one[1]));
    const many = /\bitems\s*=\s*\{([^}]*)\}/.exec(args);
    if (many) for (const n of many[1].match(/\d+/g) || []) add(out.gives, Number(n));
    if (!one && !many) {
      const parts = _splitTop(args, ',');
      if (parts.length >= 6 && /^\s*\d+\s*$/.test(parts[5])) add(out.gives, Number(parts[5]));
    }
  }
  return out;
}

// Items the NPC checks you carry before a branch answers at all: HasItem(id) in the branch's own
// condition, not negated. (A HasItem deeper in the branch only picks which reply you get; that is
// the "depends on you" tag.)
function needsItems(cond) {
  const c = String(cond || '');
  const out = [];
  for (const m of c.matchAll(/:HasItem\s*\(\s*(\d+)\s*\)/g)) {
    if (/\bnot\s*\(?\s*[\w.]*$/.test(c.slice(0, m.index))) continue;
    if (!out.includes(Number(m[1]))) out.push(Number(m[1]));
  }
  return out;
}

// One entry per findi branch of event_say, in script order:
//   { keywords, replies: [{kind, text}], gated, flag, clears, hints }
// sit = the NPC only answers while you are seated;
// gated = the reply depends on the player's flags, items, faction, level, class or race;
// flag = this branch gives a character flag; clears = it deletes flags (the Seer's "delete").
function parseDialog(body) {
  const src = String(body || '');
  const tables = _stringTables(src);
  const start = src.search(/function\s+event_say\s*\(/);
  if (start < 0) return [];
  const next = src.indexOf('\nfunction ', start + 10);
  const say = src.slice(start, next < 0 ? src.length : next);
  const COND_RX = /\b(?:if|elseif)\b([^\n]*?)\bthen\b/g;
  const branches = [];
  let m;
  while ((m = COND_RX.exec(say))) {
    // findi("literal") or findi("literal" .. TABLE[n]): the Tribunal listens for "ready to begin the "
    // .. TRIAL_TEXT[trialNum], which is one phrase per trial, so a table lookup there gives every value.
    const hits = [...m[1].matchAll(/findi\(\s*(["'])(.+?)\1\s*(?:\)|\.\.\s*([A-Za-z_]\w*)\s*\[[^\]]*\]\s*\))/g)]
      .filter((k) => !/\bnot\s+[\w.:]*$/.test(m[1].slice(0, k.index)));
    const spread = hits.length === 1 && hits[0][3] && tables[hits[0][3]] ? tables[hits[0][3]].map((t) => hits[0][2] + t) : null;
    if (spread) {
      for (const phrase of spread) branches.push({ start: m.index, at: m.index + m[0].length, cond: m[1], keywords: [phrase], sayText: phrase });
      continue;
    }
    const kws = hits.filter((k) => !k[3]).map((k) => k[2].trim()).filter(Boolean);
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
  return branches.map((b) => {
    // (The first branch that starts later: a phrase spread over a table shares one condition.)
    const after = branches.find((o) => o.start > b.start);
    const seg = say.slice(b.at, after ? after.start : say.length);
    const replies = _replies(seg, tables);
    const fx = effects(seg);
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
      fx,                            // despawns, spawns, faction, items you get
      needs: needsItems(b.cond),     // items it checks you carry before answering
      // Says nothing and sets no flag but still does something to you or the zone: Askr's "transport"
      // moves you, Tylis's "ready to return" casts the spell that carries you out, Trydan's "ready"
      // spawns the custodian, an Essence's "hail" hands over the item. Those are the steps a raider
      // needs the phrase for (FB-72, a member, 2026-10-10: a step missing from the Quest tab).
      acts: fx.gives.length > 0 || fx.spawns.length > 0 || fx.spawnOther || fx.depopSelf || fx.depops.length > 0
        || /:MovePC\s*\(|:CastSpell\s*\(|\beq\.zone\s*\(/.test(seg),
    };
  }).filter((b) => !b.gm && (b.replies.length || b.flag || b.clears || b.acts)).map(({ gm, acts, ...b }) => b);
}

// What the NPC says when you hand something in (event_trade), in order. The "who's next"
// names often live here: Tarerd Gahar takes the Sarnak blood and sends you to Thiran.
function tradeReplies(body) {
  const src = String(body || '');
  const start = src.search(/function\s+event_trade\s*\(/);
  if (start < 0) return [];
  const next = src.indexOf('\nfunction ', start + 10);
  return _replies(src.slice(start, next < 0 ? src.length : next), _stringTables(src));
}

// event_trade split into one entry per hand-in: the item ids check_turn_in wants (a repeat means
// that many), what the NPC says, what the hand-in does (effects) and whether it gives a character
// flag. A branch runs until the next check_turn_in, the same way a say branch runs until the next
// keyword. Hand-ins joined by `or` in one condition (Askr takes any of three giant heads) share the
// code after its `then`, so each gets that code, and the same `group`.
function tradeBranches(body) {
  const src = String(body || '');
  const tables = _stringTables(src);
  const start = src.search(/function\s+event_trade\s*\(/);
  if (start < 0) return [];
  const next = src.indexOf('\nfunction ', start + 10);
  const tr = src.slice(start, next < 0 ? src.length : next);
  const heads = [];
  for (const m of tr.matchAll(/check_turn_in\s*\(/g)) {
    const args = _callArgs(tr, m.index + m[0].length - 1);
    heads.push({ at: m.index, items: [...args.matchAll(/\bitem\d+\s*=\s*(\d+)/g)].map((x) => Number(x[1])) });
  }
  const live = heads.filter((h) => h.items.length);
  // Group: a head whose stretch up to the next head holds no `then` is still inside one condition.
  const groups = [];
  for (let n = 0; n < live.length; n++) {
    const upTo = n + 1 < live.length ? live[n + 1].at : tr.length;
    const cur = groups[groups.length - 1];
    if (cur && cur.open) cur.heads.push(live[n]); else groups.push({ heads: [live[n]], open: false });
    groups[groups.length - 1].open = !/\bthen\b/.test(tr.slice(live[n].at, upTo));
  }
  const out = [];
  groups.forEach((g, gi) => {
    const last = g.heads[g.heads.length - 1];
    const nextGroup = groups[gi + 1];
    const seg = tr.slice(last.at, nextGroup ? nextGroup.heads[0].at : tr.length);
    const replies = _replies(seg, tables);
    const fx = effects(seg);
    const flag = /set_global\s*\(|received a character flag/i.test(seg);
    for (const h of g.heads) out.push({ items: h.items, replies, fx, flag, group: gi });
  });
  return out;
}

// Index just past the `end` that closes the Lua `function` at s[from]. Strings and comments are
// skipped; `function`, `if` and `do` (which `for` and `while` carry) each open a block, `end`
// closes one. `elseif` is its own word and `repeat…until` has no `end`, so neither counts.
function _blockEnd(s, from) {
  let depth = 0;
  for (let j = from; j < s.length;) {
    const c = s[j];
    if (c === '"' || c === "'") { j = _readString(s, j).end; continue; }
    const long = (c === '-' && s[j + 1] === '-' ? /--\[(=*)\[/y : c === '[' ? /\[(=*)\[/y : null);
    if (long) {
      long.lastIndex = j;
      const lm = long.exec(s);
      if (lm) { const close = s.indexOf(']' + lm[1] + ']', j + lm[0].length); j = close < 0 ? s.length : close + lm[1].length + 2; continue; }
    }
    if (c === '-' && s[j + 1] === '-') { const nl = s.indexOf('\n', j); j = nl < 0 ? s.length : nl; continue; }
    if (/[A-Za-z_]/.test(c)) {
      const w = /\w+/y;
      w.lastIndex = j;
      const word = w.exec(s)[0];
      j += word.length;
      if (word === 'function' || word === 'if' || word === 'do') depth++;
      else if (word === 'end' && --depth === 0) return j;
      continue;
    }
    j++;
  }
  return s.length;
}

// An NPC with no script of its own can be scripted by a zone ENCOUNTER file instead: the hedge maze's
// Thelin Poxbourne (ponightmare/encounters/Maze.lua, the guild lead, 2026-10-08) says nothing in a
// file named for him, but Maze.lua registers his handlers by npc id:
//   local THELIN_INSIDE_TYPE = 204486;
//   eq.register_npc_event("Maze", Event.say, THELIN_INSIDE_TYPE, ThelinInsideSayEvent);
// The id is a literal or a `local NAME = <digits>` constant. Returns the file's say and trade
// handlers for npcId renamed to event_say / event_trade, so parseDialog and tradeReplies read them
// as they read any NPC's own script; null when the file registers neither for this id.
function encounterHandlers(body, npcId) {
  const src = String(body || '');
  const id = Number(npcId);
  const consts = {};
  for (const m of src.matchAll(/^[ \t]*local\s+([A-Za-z_]\w*)\s*=\s*(\d+)\s*(?:;|--|$)/gm)) consts[m[1]] = Number(m[2]);
  const found = {};
  for (const m of src.matchAll(/\bregister_npc_event\s*\(/g)) {
    const args = _splitTop(_callArgs(src, m.index + m[0].length - 1), ',').map((a) => a.trim());
    const k = args.findIndex((a) => /^Event\.(?:say|trade)$/.test(a));
    if (k < 0 || args.length < k + 3) continue;
    const kind = args[k].slice(6);
    const who = /^\d+$/.test(args[k + 1]) ? Number(args[k + 1]) : consts[args[k + 1]];
    if (who === id && /^[A-Za-z_]\w*$/.test(args[k + 2]) && !found[kind]) found[kind] = args[k + 2];
  }
  const parts = [];
  for (const kind of ['say', 'trade']) {
    if (!found[kind]) continue;
    const h = new RegExp(`(?:^|\\n)[ \\t]*(?:local\\s+)?function\\s+${found[kind]}\\s*\\(([^)]*)\\)`).exec(src);
    if (!h) continue;
    const headEnd = h.index + h[0].length;
    parts.push(`function event_${kind}(${h[1]})${src.slice(headEnd, _blockEnd(src, src.indexOf('function', h.index)))}`);
  }
  return parts.length ? parts.join('\n') : null;
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

module.exports = { parseDialog, tradeReplies, tradeBranches, encounterHandlers, effects, needsItems, nameCandidates, sentenceStartOnly, displayName, scriptPath, _exprText, _replies, _stringTables };
