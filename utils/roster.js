// utils/roster.js — Character roster loaded from OpenDKP export.
// Stored as compact JSON in ROSTER_ACTIVE_THREAD_ID / ROSTER_INACTIVE_THREAD_ID.
// Data model: { n: name, r: race, c: class, a: [{n,r,c}, ...] }
// Mains and their alts are grouped together; active/inactive are separate threads.

const { EmbedBuilder } = require('discord.js');

const ACTIVE_TITLE   = '📋 Active Roster';
const INACTIVE_TITLE = '📋 Inactive Roster';
const CHUNK_LIMIT    = 3500; // chars per embed description

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

function getAllNames() {
  return [..._lookup.keys()];
}

function getActiveRoster()   { return _active; }
function getInactiveRoster() { return _inactive; }

// ── OpenDKP import ────────────────────────────────────────────────────────────
// Accepts the raw OpenDKP JSON array. Returns { active, inactive } in compact format.
// Relationship: AssociatedId === -1 → main; AssociatedId = main's CharacterId → alt.
function processOpenDkpExport(rawArray) {
  const all   = rawArray.filter(c => !c.Deleted);
  const mains = all.filter(c => c.AssociatedId === -1);
  const byParent = new Map();
  for (const a of all.filter(c => c.AssociatedId !== -1)) {
    if (!byParent.has(a.AssociatedId)) byParent.set(a.AssociatedId, []);
    byParent.get(a.AssociatedId).push(a);
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

async function saveRosterToThread(client, roster, threadId, title) {
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);

    // Delete previous roster messages from this bot
    const msgs = await thread.messages.fetch({ limit: 100 });
    for (const msg of msgs.values()) {
      if (msg.author.id === client.user.id && msg.embeds[0]?.title === title) {
        await msg.delete().catch(() => {});
      }
    }

    const chunks = _chunk(roster);
    for (let i = 0; i < chunks.length; i++) {
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0x2b2d31)
        .setDescription(JSON.stringify(chunks[i]))
        .setTimestamp()
        .setFooter({ text: `${roster.length} mains · chunk ${i + 1}/${chunks.length}` });
      await thread.send({ embeds: [embed] });
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

  async function loadThread(threadId, title) {
    if (!threadId) return [];
    try {
      const thread = await client.channels.fetch(threadId);
      const msgs   = await thread.messages.fetch({ limit: 100 });
      const entries = [];
      for (const msg of msgs.values()) {
        if (msg.author.id !== client.user.id) continue;
        if (msg.embeds[0]?.title !== title) continue;
        try { entries.push(...JSON.parse(msg.embeds[0].description)); } catch {}
      }
      return entries;
    } catch (err) {
      console.warn('[roster] Could not load thread:', err?.message);
      return [];
    }
  }

  _active   = await loadThread(activeId,   ACTIVE_TITLE);
  _inactive = await loadThread(inactiveId, INACTIVE_TITLE);
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
};
