// utils/roster.js — Character roster loaded from OpenDKP export.
// Stored as compact JSON in ROSTER_ACTIVE_THREAD_ID / ROSTER_INACTIVE_THREAD_ID.
// Data model: { n: name, r: race, c: class, a: [{n,r,c}, ...] }
// Mains and their alts are grouped together; active/inactive are separate threads.

const { EmbedBuilder } = require('discord.js');

// Header embed titles (human-readable, first message in each thread)
const ACTIVE_TITLE   = '📋 Active Roster';
const INACTIVE_TITLE = '📋 Inactive Roster';

// Member list embed titles (one per page, human-readable)
const ACTIVE_MEMBERS_TITLE   = '📋 Active Roster — Members';
const INACTIVE_MEMBERS_TITLE = '📋 Inactive Roster — Members';

// Data embed titles (compact JSON chunks — not meant to be read directly)
const ACTIVE_DATA_TITLE   = '📋 Active Roster — Data';
const INACTIVE_DATA_TITLE = '📋 Inactive Roster — Data';

const CHUNK_LIMIT = 3500; // chars per embed description

// In-memory state
let _active   = []; // [{ n, r, c, a: [{n,r,c}] }]
let _inactive = [];
let _lookup   = new Map(); // name.toLowerCase() → { name, race, class, isAlt, mainName, active, alts }

function _buildLookup() {
  _lookup = new Map();
  const index = (char, isAlt, mainName, active) => {
    _lookup.set(char.n.toLowerCase(), {
      name: char.n, race: char.r, class: char.c,
      isAlt, mainName, active,
      alts: isAlt ? [] : (char.a || []).map(a => ({ name: a.n, race: a.r, class: a.c })),
    });
  };
  for (const m of _active)   { index(m, false, null, true);  for (const a of (m.a || [])) index(a, true, m.n, true);  }
  for (const m of _inactive) { index(m, false, null, false); for (const a of (m.a || [])) index(a, true, m.n, false); }
}

// ── Public accessors ──────────────────────────────────────────────────────────
function getCharacter(name) { return _lookup.get(name.toLowerCase()) || null; }

function getFamily(name) {
  const char = getCharacter(name);
  if (!char) return null;
  const mainName = char.isAlt ? char.mainName : char.name;
  const main     = getCharacter(mainName);
  if (!main) return null;
  return { main, alts: main.alts };
}

function getAllNames()        { return [..._lookup.keys()]; }
function getActiveRoster()   { return _active; }
function getInactiveRoster() { return _inactive; }

// ── OpenDKP import ────────────────────────────────────────────────────────────
// Accepts the raw OpenDKP JSON array. Returns { active, inactive } in compact format.
// Status classification: "Raid Alts" → alt; Officer/Raid Pack/Recruit/Pack Leader → main.
// Alts are grouped under their main via AssociatedId → main's CharacterId.
function processOpenDkpExport(rawArray) {
  const all   = rawArray.filter(c => !c.Deleted);
  const isAlt = c => c.Status === 'Raid Alts';
  const mains = all.filter(c => !isAlt(c));
  const alts  = all.filter(c => isAlt(c));

  const byParent = new Map();
  for (const a of alts) {
    const parentId = a.AssociatedId;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(a);
  }

  const active = [], inactive = [];
  for (const m of mains) {
    const entry = {
      n: m.Name, r: m.Race, c: m.Class,
      a: (byParent.get(m.CharacterId) || []).map(a => ({ n: a.Name, r: a.Race, c: a.Class })),
    };
    (m.Active === 1 ? active : inactive).push(entry);
  }
  return { active, inactive };
}

// ── Human-readable member list helpers ───────────────────────────────────────
function _memberLines(roster) {
  return roster.map(m => {
    const base = `**${m.n}** *(${m.r} ${m.c})*`;
    if (!m.a || m.a.length === 0) return base;
    return base + '\n' + m.a.map(a => `  \\| ${a.n}`).join('\n');
  });
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
function _chunk(roster) {
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

// importerName: display name of the Discord user who ran /rosterimport
// importedAt: Date object
async function saveRosterToThread(client, roster, threadId, headerTitle, membersTitle, dataTitle, importerName, importedAt) {
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);

    // Delete all previous bot messages (header, member pages, data chunks)
    const msgs = await thread.messages.fetch({ limit: 100 });
    for (const msg of msgs.values()) {
      if (msg.author.id !== client.user.id) continue;
      const t = msg.embeds[0]?.title;
      if (t === headerTitle || t === membersTitle || t === dataTitle) await msg.delete().catch(() => {});
    }

    const totalMains = roster.length;
    const totalAlts  = roster.reduce((s, m) => s + (m.a?.length || 0), 0);
    const importTs   = importedAt
      ? `<t:${Math.floor(importedAt.getTime() / 1000)}:F>`
      : 'unknown';

    // 1. Header embed — metadata only
    const header = new EmbedBuilder()
      .setTitle(headerTitle)
      .setColor(0x5865f2)
      .setDescription('Character roster for Wolf Pack EQ. Imported from OpenDKP.')
      .addFields(
        { name: 'Mains',         value: String(totalMains), inline: true },
        { name: 'Alts',          value: String(totalAlts),  inline: true },
        { name: 'Last Imported', value: `By **${importerName || 'unknown'}** on ${importTs}`, inline: false },
      )
      .setTimestamp(importedAt || undefined);
    await thread.send({ embeds: [header] });

    // 2. Human-readable member pages
    const lines  = _memberLines(roster);
    const pages  = _chunkText(lines);
    for (let i = 0; i < pages.length; i++) {
      await thread.send({ embeds: [
        new EmbedBuilder()
          .setTitle(membersTitle)
          .setColor(0x5865f2)
          .setDescription(pages[i])
          .setFooter({ text: `page ${i + 1}/${pages.length}` }),
      ]});
    }

    // 3. JSON data chunks — for bot reload
    const dataChunks = _chunk(roster);
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

  const totalAlts = [..._active, ..._inactive].reduce((s, m) => s + (m.a?.length || 0), 0);
  console.log(`[roster] Loaded ${_active.length} active mains, ${_inactive.length} inactive mains, ${totalAlts} alts`);
}

module.exports = {
  processOpenDkpExport,
  loadRosterFromDiscord,
  saveRosterToThread,
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
