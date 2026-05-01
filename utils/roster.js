// utils/roster.js — Character roster loaded from OpenDKP export.
// Stored as compact JSON in ROSTER_ACTIVE_THREAD_ID / ROSTER_INACTIVE_THREAD_ID.
// Main data model: { n, r, c, a: [{n,r,c}] }
// Standalone alt model: { n, r, c, a: [], _alt: true }

const { EmbedBuilder } = require('discord.js');

const ACTIVE_TITLE   = '📋 Active Roster';
const INACTIVE_TITLE = '📋 Inactive Roster';

const ACTIVE_MEMBERS_TITLE   = '📋 Active Roster — Members';
const INACTIVE_MEMBERS_TITLE = '📋 Inactive Roster — Members';

const ACTIVE_DATA_TITLE   = '📋 Active Roster — Data';
const INACTIVE_DATA_TITLE = '📋 Inactive Roster — Data';

const CHUNK_LIMIT = 3500;

let _active   = [];
let _inactive = [];
let _lookup   = new Map();

function _buildLookup() {
  _lookup = new Map();
  const index = (char, isAlt, mainName, active) => {
    _lookup.set(char.n.toLowerCase(), {
      name: char.n, race: char.r, class: char.c,
      isAlt, mainName, active,
      alts: isAlt ? [] : (char.a || []).map(a => ({ name: a.n, race: a.r, class: a.c })),
    });
  };
  for (const m of _active) {
    index(m, !!m._alt, null, true);
    if (!m._alt) for (const a of (m.a || [])) index(a, true, m.n, true);
  }
  for (const m of _inactive) {
    index(m, !!m._alt, null, false);
    if (!m._alt) for (const a of (m.a || [])) index(a, true, m.n, false);
  }
}

// ── Public accessors ──────────────────────────────────────────────────────────
function getCharacter(name) { return _lookup.get(name.toLowerCase()) || null; }

function getFamily(name) {
  const char = getCharacter(name);
  if (!char) return null;
  const mainName = char.isAlt ? char.mainName : char.name;
  if (!mainName) return null;
  const main = getCharacter(mainName);
  if (!main) return null;
  return { main, alts: main.alts };
}

function getAllNames()        { return [..._lookup.keys()]; }
function getActiveRoster()   { return _active; }
function getInactiveRoster() { return _inactive; }

// ── OpenDKP import ────────────────────────────────────────────────────────────
// Alt detection: checks Rank, Status, Type, MemberType fields for 'Raid Alts'.
// AssociatedId used as secondary: non-(-1/0/null) value pointing to a main's CharacterId.
// Standalone alts (status-based, no AssociatedId link) stored with _alt: true.
function processOpenDkpExport(rawArray) {
  const all = rawArray.filter(c => !c.Deleted);

  const ALT_VALUES  = new Set(['Raid Alts', 'Raid Alt', 'Alt', 'Alts']);
  const getAltField = c => c.Rank ?? c.Status ?? c.Type ?? c.MemberType ?? '';
  const isByStatus  = c => ALT_VALUES.has(getAltField(c));

  const statusMains = all.filter(c => !isByStatus(c));
  const statusAlts  = all.filter(c =>  isByStatus(c));

  // Also treat as alt if AssociatedId points to a non-alt character
  const mainById = new Map(statusMains.map(m => [m.CharacterId, m]));
  const isLinkedAlt = c => {
    const pid = c.AssociatedId;
    return pid != null && pid !== -1 && pid !== 0 && mainById.has(pid);
  };

  const linkedNonStatusAlts = statusMains.filter(isLinkedAlt);
  const finalMains    = statusMains.filter(m => !isLinkedAlt(m));
  const finalMainById = new Map(finalMains.map(m => [m.CharacterId, m]));
  const finalAlts     = [...statusAlts, ...linkedNonStatusAlts];

  // Group alts under their mains via AssociatedId
  const byParent    = new Map();
  const standalone  = [];
  for (const a of finalAlts) {
    const pid = a.AssociatedId;
    if (pid != null && pid !== -1 && pid !== 0 && finalMainById.has(pid)) {
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(a);
    } else {
      standalone.push(a);
    }
  }

  const active = [], inactive = [];
  for (const m of finalMains) {
    const entry = {
      n: m.Name, r: m.Race, c: m.Class,
      a: (byParent.get(m.CharacterId) || []).map(a => ({ n: a.Name, r: a.Race, c: a.Class })),
    };
    (m.Active === 1 ? active : inactive).push(entry);
  }
  for (const a of standalone) {
    const entry = { n: a.Name, r: a.Race, c: a.Class, a: [], _alt: true };
    (a.Active === 1 ? active : inactive).push(entry);
  }

  return { active, inactive };
}

// ── Human-readable member pages ───────────────────────────────────────────────
function _groupByClass(chars) {
  const map = new Map();
  for (const c of chars) {
    if (!map.has(c.c)) map.set(c.c, []);
    map.get(c.c).push(c);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function _rosterCounts(roster) {
  const mainCount = roster.filter(m => !m._alt).length;
  const altCount  = roster.reduce((s, m) => s + (m._alt ? 1 : (m.a?.length || 0)), 0);
  return { mainCount, altCount };
}

// Returns array of line strings for chunking into Discord embeds.
// Format: Mains section (sorted by class), then Alts section (sorted by class + main ref).
function _memberLines(roster) {
  const mains = roster
    .filter(m => !m._alt)
    .sort((a, b) => a.c.localeCompare(b.c) || a.n.localeCompare(b.n));

  // Linked alts (embedded in mains' a:[])
  const linkedAlts = [];
  for (const m of mains) {
    for (const a of (m.a || [])) linkedAlts.push({ n: a.n, r: a.r, c: a.c, _main: m.n });
  }
  // Standalone alts (_alt: true, no known main)
  const standaloneAlts = roster
    .filter(m => m._alt)
    .map(a => ({ n: a.n, r: a.r, c: a.c, _main: null }));

  const allAlts = [...linkedAlts, ...standaloneAlts]
    .sort((a, b) => a.c.localeCompare(b.c) || a.n.localeCompare(b.n));

  const lines = [];

  // Mains
  lines.push(`**— Mains (${mains.length}) —**`);
  for (const [cls, chars] of _groupByClass(mains)) {
    lines.push(`**${cls}**`);
    for (const m of chars) lines.push(`${m.n} *(${m.r})*`);
  }

  // Alts
  if (allAlts.length > 0) {
    lines.push('');
    lines.push(`**— Alts (${allAlts.length}) —**`);
    for (const [cls, chars] of _groupByClass(allAlts)) {
      lines.push(`**${cls}**`);
      for (const a of chars) {
        const ref = a._main ? ` · *${a._main}*` : '';
        lines.push(`${a.n} *(${a.r})*${ref}`);
      }
    }
  }

  return lines;
}

function _chunkText(lines, limit = 3500) {
  const chunks = [];
  let cur = [], curLen = 0;
  for (const line of lines) {
    const len = line.length + 1;
    if (curLen + len > limit && cur.length > 0) {
      chunks.push(cur.join('\n')); cur = [line]; curLen = len;
    } else {
      cur.push(line); curLen += len;
    }
  }
  if (cur.length > 0) chunks.push(cur.join('\n'));
  return chunks;
}

// ── Discord persistence ───────────────────────────────────────────────────────
function _chunkJson(roster) {
  const chunks = [];
  let cur = [], curLen = 2;
  for (const entry of roster) {
    const s = JSON.stringify(entry);
    if (curLen + s.length + 1 > CHUNK_LIMIT && cur.length > 0) {
      chunks.push(cur); cur = [entry]; curLen = 2 + s.length + 1;
    } else {
      cur.push(entry); curLen += s.length + 1;
    }
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

async function saveRosterToThread(client, roster, threadId, headerTitle, membersTitle, dataTitle, importerName, importedAt) {
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);

    // Delete all previous bot messages
    const msgs = await thread.messages.fetch({ limit: 100 });
    for (const msg of msgs.values()) {
      if (msg.author.id !== client.user.id) continue;
      const t = msg.embeds[0]?.title;
      if (t === headerTitle || t === membersTitle || t === dataTitle) await msg.delete().catch(() => {});
    }

    const { mainCount, altCount } = _rosterCounts(roster);
    const importTs = importedAt ? `<t:${Math.floor(importedAt.getTime() / 1000)}:F>` : 'unknown';

    // 1. Header embed
    await thread.send({ embeds: [
      new EmbedBuilder()
        .setTitle(headerTitle)
        .setColor(0x5865f2)
        .setDescription('Character roster for Wolf Pack EQ. Imported from OpenDKP.')
        .addFields(
          { name: 'Mains',         value: String(mainCount), inline: true },
          { name: 'Alts',          value: String(altCount),  inline: true },
          { name: 'Last Imported', value: `By **${importerName || 'unknown'}** on ${importTs}`, inline: false },
        )
        .setTimestamp(importedAt || undefined),
    ]});

    // 2. Human-readable member pages
    const pages = _chunkText(_memberLines(roster));
    for (let i = 0; i < pages.length; i++) {
      await thread.send({ embeds: [
        new EmbedBuilder()
          .setTitle(membersTitle)
          .setColor(0x5865f2)
          .setDescription(pages[i])
          .setFooter({ text: `page ${i + 1}/${pages.length}` }),
      ]});
    }

    // 3. JSON data chunks (for bot reload)
    const dataChunks = _chunkJson(roster);
    for (let i = 0; i < dataChunks.length; i++) {
      await thread.send({ embeds: [
        new EmbedBuilder()
          .setTitle(dataTitle)
          .setColor(0x2b2d31)
          .setDescription(JSON.stringify(dataChunks[i]))
          .setFooter({ text: `chunk ${i + 1}/${dataChunks.length} · imported by ${importerName || 'unknown'}` })
          .setTimestamp(importedAt || undefined),
      ]});
    }
  } catch (err) {
    console.warn('[roster] Could not save to thread:', err?.message);
  }
}

async function loadRosterFromDiscord(client) {
  const activeId   = process.env.ROSTER_ACTIVE_THREAD_ID;
  const inactiveId = process.env.ROSTER_INACTIVE_THREAD_ID;

  if (!activeId && !inactiveId) {
    console.warn('[roster] ROSTER_ACTIVE_THREAD_ID / ROSTER_INACTIVE_THREAD_ID not set — roster disabled');
    return;
  }

  async function loadThread(threadId, dataTitle) {
    if (!threadId) return [];
    try {
      const thread  = await client.channels.fetch(threadId);
      const msgs    = await thread.messages.fetch({ limit: 100 });
      const entries = [];
      for (const msg of msgs.values()) {
        if (msg.author.id !== client.user.id) continue;
        if (msg.embeds[0]?.title !== dataTitle) continue;
        try { entries.push(...JSON.parse(msg.embeds[0].description)); } catch {}
      }
      return entries;
    } catch (err) {
      console.warn('[roster] Could not load thread:', err?.message);
      return [];
    }
  }

  _active   = await loadThread(activeId,   ACTIVE_DATA_TITLE);
  _inactive = await loadThread(inactiveId, INACTIVE_DATA_TITLE);
  _buildLookup();

  const all = [..._active, ..._inactive];
  const { mainCount, altCount } = _rosterCounts(all);
  console.log(`[roster] Loaded ${mainCount} mains, ${altCount} alts`);
}

// Exported for use in rosterimport.js confirmation message
function rosterCounts(roster) { return _rosterCounts(roster); }

module.exports = {
  processOpenDkpExport,
  loadRosterFromDiscord,
  saveRosterToThread,
  rosterCounts,
  getCharacter,
  getFamily,
  getAllNames,
  getActiveRoster,
  getInactiveRoster,
  ACTIVE_TITLE,
  INACTIVE_TITLE,
  ACTIVE_MEMBERS_TITLE,
  INACTIVE_MEMBERS_TITLE,
  ACTIVE_DATA_TITLE,
  INACTIVE_DATA_TITLE,
};
