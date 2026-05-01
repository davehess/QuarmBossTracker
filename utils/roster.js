// utils/roster.js — Character roster loaded from OpenDKP export.
// Family grouping: ParentId===0 → family root; ParentId===X → member of X's family.
// Main within a family: highest rank in RANK_PRIORITY (Officer > Pack Leader > ...).
// Alts: Rank==='Raid Alt' members of a family that are not the main.
// Standalone alts: Raid Alt with ParentId===0 and no family members, or orphaned alts.
// Data model: main entry { n, r, c, a: [{n,r,c}] }; standalone alt { n,r,c,a:[],_alt:true }

const { EmbedBuilder } = require('discord.js');

const ACTIVE_TITLE           = '📋 Active Roster';
const INACTIVE_TITLE         = '📋 Inactive Roster';
const ACTIVE_MEMBERS_TITLE   = '📋 Active Roster — Members';
const INACTIVE_MEMBERS_TITLE = '📋 Inactive Roster — Members';
const ACTIVE_DATA_TITLE      = '📋 Active Roster — Data';
const INACTIVE_DATA_TITLE    = '📋 Inactive Roster — Data';

const CHUNK_LIMIT = 3500;

const RANK_PRIORITY = ['Officer', 'Pack Leader', 'Raid Pack', 'Recruit', 'Member', 'Inactive'];
const ALT_RANK      = 'Raid Alt';

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
// Groups characters into families via ParentId. Main = highest-priority rank in family.
// Returns { active, inactive, unknowns } where unknowns = active chars with UNKNOWN fields.
function processOpenDkpExport(rawArray) {
  const all = rawArray.filter(c => !c.Deleted);

  // Active chars with UNKNOWN Race, Class, or Rank — report to officer after import
  const unknowns = all.filter(c =>
    c.Active === 1 && (c.Race === 'UNKNOWN' || c.Class === 'UNKNOWN' || c.Rank === 'UNKNOWN')
  );

  // Build families: rootId (CharacterId with ParentId===0) → [all members including root]
  const families = new Map();
  const orphans  = []; // ParentId points to a char not in the export

  for (const c of all) {
    if (c.ParentId === 0) {
      if (!families.has(c.CharacterId)) families.set(c.CharacterId, []);
      families.get(c.CharacterId).push(c);
    }
  }
  for (const c of all) {
    if (c.ParentId === 0) continue;
    if (families.has(c.ParentId)) {
      families.get(c.ParentId).push(c);
    } else {
      orphans.push(c); // parent not in export
    }
  }

  const active = [], inactive = [];
  const addTo = (entry, isActive) => (isActive ? active : inactive).push(entry);

  for (const [, members] of families) {
    // Find main by rank priority (skip UNKNOWN rank)
    let main = null;
    for (const rank of RANK_PRIORITY) {
      main = members.find(m => m.Rank === rank);
      if (main) break;
    }

    if (!main) {
      // No main found — all Raid Alts, store as standalone
      for (const c of members) {
        if (c.Rank === ALT_RANK) addTo({ n: c.Name, r: c.Race, c: c.Class, a: [], _alt: true }, c.Active === 1);
      }
      continue;
    }

    const alts = members.filter(m => m !== main && m.Rank === ALT_RANK);
    addTo(
      { n: main.Name, r: main.Race, c: main.Class, a: alts.map(a => ({ n: a.Name, r: a.Race, c: a.Class })) },
      main.Active === 1
    );
  }

  // Orphaned characters (parent not found in export)
  for (const c of orphans) {
    if (c.Rank === ALT_RANK) {
      addTo({ n: c.Name, r: c.Race, c: c.Class, a: [], _alt: true }, c.Active === 1);
    } else if (RANK_PRIORITY.includes(c.Rank)) {
      addTo({ n: c.Name, r: c.Race, c: c.Class, a: [] }, c.Active === 1);
    }
    // UNKNOWN rank orphans: already in unknowns list, skip display
  }

  return { active, inactive, unknowns };
}

// ── Display helpers ───────────────────────────────────────────────────────────
function _groupByClass(chars) {
  const map = new Map();
  for (const c of chars) {
    const cls = c.c || 'Unknown';
    if (!map.has(cls)) map.set(cls, []);
    map.get(cls).push(c);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function _rosterCounts(roster) {
  const mainCount = roster.filter(m => !m._alt).length;
  const altCount  = roster.reduce((s, m) => s + (m._alt ? 1 : (m.a?.length || 0)), 0);
  return { mainCount, altCount };
}

// One description string per class. Mains classes then Alts classes.
// Each string becomes its own Discord message.
function _buildMemberEmbeds(roster) {
  const mains = roster
    .filter(m => !m._alt)
    .sort((a, b) => (a.c || '').localeCompare(b.c || '') || a.n.localeCompare(b.n));

  const linkedAlts = [];
  for (const m of mains) {
    for (const a of (m.a || [])) linkedAlts.push({ n: a.n, r: a.r, c: a.c, _main: m.n });
  }
  const standaloneAlts = roster
    .filter(m => m._alt)
    .map(a => ({ n: a.n, r: a.r, c: a.c, _main: null }));
  const allAlts = [...linkedAlts, ...standaloneAlts]
    .sort((a, b) => (a.c || '').localeCompare(b.c || '') || a.n.localeCompare(b.n));

  const descs = [];

  for (const [cls, chars] of _groupByClass(mains)) {
    const lines = [`**— Mains: ${cls} (${chars.length}) —**`];
    for (const m of chars) lines.push(`${m.n} *(${m.r})*`);
    descs.push(lines.join('\n'));
  }

  for (const [cls, chars] of _groupByClass(allAlts)) {
    const lines = [`**— Alts: ${cls} (${chars.length}) —**`];
    for (const a of chars) {
      lines.push(`${a.n} *(${a.r})*${a._main ? ` · *${a._main}*` : ''}`);
    }
    descs.push(lines.join('\n'));
  }

  return descs;
}

// ── JSON storage helpers ──────────────────────────────────────────────────────
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

// ── Discord persistence ───────────────────────────────────────────────────────
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

    // 1. Header
    await thread.send({ embeds: [
      new EmbedBuilder()
        .setTitle(headerTitle)
        .setColor(0x5865f2)
        .setDescription('Character roster for Wolf Pack EQ. Imported from OpenDKP.')
        .addFields(
          { name: 'Mains', value: String(mainCount), inline: true },
          { name: 'Alts',  value: String(altCount),  inline: true },
          { name: 'Last Imported', value: `By **${importerName || 'unknown'}** on ${importTs}`, inline: false },
        )
        .setTimestamp(importedAt || undefined),
    ]});

    // 2. One message per class (mains then alts)
    const classDescs = _buildMemberEmbeds(roster);
    for (let i = 0; i < classDescs.length; i++) {
      await thread.send({ embeds: [
        new EmbedBuilder()
          .setTitle(membersTitle)
          .setColor(0x5865f2)
          .setDescription(classDescs[i])
          .setFooter({ text: `${i + 1}/${classDescs.length}` }),
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

  const { mainCount, altCount } = _rosterCounts([..._active, ..._inactive]);
  console.log(`[roster] Loaded ${mainCount} mains, ${altCount} alts`);
}

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
