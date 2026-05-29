// utils/raidhelper.js — pull tonight's RaidHelper event and extract the
// boss target list so /raidnight can auto-populate session.targets.
//
// RaidHelper posts events as rich embeds in a configured channel. Its
// Description field has free-form text but officers consistently use
// the same labels:
//   Target - <name>
//   Potential Additional Targets - <name1> / <name2> / <name3>
//   Muster Point - <zone>          (informational; not parsed yet)
//
// We grab the most recent RaidHelper-authored embed whose event time
// falls within ±18 hours of "now" (covers Sun/Wed/Thu 8:30 PM ET raid
// windows from the morning-of through the early hours after), extract
// both Target lines, and fuzzy-match each name against bosses.json.
//
// Configuration:
//   RAIDHELPER_CHANNEL_ID — Discord channel where RaidHelper events post.
//                           Falls back to nothing if unset.
//   RAIDHELPER_BOT_ID     — optional override; without it we identify
//                           the event author by username matching
//                           /raid.?helper/i.
//
// Returns { targets: [bossId, ...], primary, additional, eventUrl } or
// null when no event is found or nothing matched.

const TARGET_RX        = /^\s*Target\s*[-—:]\s*(.+?)\s*$/im;
const ADDITIONAL_RX    = /^\s*Potential\s+Additional\s+Targets?\s*[-—:]\s*(.+?)\s*$/im;
const NAME_SEPARATOR   = /\s*[\/,]\s*/;     // accept "A / B" and "A, B"
const RAIDHELPER_NAMES = /raid.?helper/i;

function splitNames(line) {
  if (!line) return [];
  return line.split(NAME_SEPARATOR).map(s => s.trim()).filter(Boolean);
}

// Pull the description from a RaidHelper embed. Description lives at
// embed.description on standard embeds; older RaidHelper variants put
// it under fields[name=Description].value. Handle both.
function extractDescription(embed) {
  if (!embed) return null;
  if (embed.description) return embed.description;
  const f = (embed.fields || []).find(f =>
    /description/i.test(f?.name || ''),
  );
  return f?.value || null;
}

// Was this message authored by RaidHelper? Match by env-configured ID
// if set, else by username pattern.
function isRaidHelper(msg) {
  const expected = process.env.RAIDHELPER_BOT_ID;
  if (expected) return msg.author?.id === expected;
  return !!msg.author?.bot && RAIDHELPER_NAMES.test(msg.author?.username || '');
}

// Walks the channel for the most recent RaidHelper event whose scheduled
// time is "near now" — defined as within an 18-hour window centered on
// the current time. RaidHelper embeds carry the event time as a Discord
// timestamp in the description ("<t:1234567890:F>") or as embed.timestamp.
async function loadTonightsEvent(client) {
  const channelId = process.env.RAIDHELPER_CHANNEL_ID;
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.messages?.fetch !== 'function') return null;

  let batch;
  try { batch = await channel.messages.fetch({ limit: 30 }); }
  catch { return null; }

  const now = Date.now();
  const windowMs = 18 * 60 * 60 * 1000;

  // newest first — RaidHelper posts a new event message per event
  const sorted = [...batch.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);

  for (const msg of sorted) {
    if (!isRaidHelper(msg)) continue;
    const embed = msg.embeds?.[0];
    if (!embed) continue;

    // Best-effort event-time detection. RaidHelper events embed the start
    // time as a Discord-formatted timestamp inside the description:
    //   `<t:1234567890:F>` or `<t:1234567890:R>`
    // Falling back to embed.timestamp or the message createdTimestamp lets
    // us still pick a candidate even when the format changes.
    let eventMs = null;
    const tsMatch = (embed.description || '').match(/<t:(\d+):[a-z]>/i);
    if (tsMatch) eventMs = parseInt(tsMatch[1], 10) * 1000;
    if (!eventMs && embed.timestamp) eventMs = new Date(embed.timestamp).getTime();
    if (!eventMs) eventMs = msg.createdTimestamp;

    if (Math.abs(eventMs - now) > windowMs) continue;

    return { msg, embed, eventMs };
  }
  return null;
}

// Parse the description for primary + additional targets, then fuzzy-
// match each candidate against bosses.json. Returns { bossIds, primary,
// additional, unmatched } so callers can surface what didn't resolve.
function extractTargets(description, bosses, findBossFromName) {
  const out = { bossIds: [], primary: null, additional: [], unmatched: [] };
  if (!description) return out;

  const primaryMatch = TARGET_RX.exec(description);
  const additionalMatch = ADDITIONAL_RX.exec(description);

  const primaryNames    = splitNames(primaryMatch?.[1]);
  const additionalNames = splitNames(additionalMatch?.[1]);

  if (primaryNames[0]) out.primary = primaryNames[0];
  out.additional = additionalNames;

  const seen = new Set();
  for (const name of [...primaryNames, ...additionalNames]) {
    const boss = findBossFromName(name, bosses);
    if (boss && !seen.has(boss.id)) {
      out.bossIds.push(boss.id);
      seen.add(boss.id);
    } else if (!boss) {
      out.unmatched.push(name);
    }
  }
  return out;
}

// Top-level helper called from /raidnight on open. Returns the same
// shape as extractTargets plus the source message URL for surfacing in
// the reply.
async function loadTonightsTargets(client, bosses, findBossFromName) {
  const event = await loadTonightsEvent(client);
  if (!event) return null;
  const desc = extractDescription(event.embed);
  if (!desc) return null;
  const parsed = extractTargets(desc, bosses, findBossFromName);
  return {
    ...parsed,
    eventUrl: event.msg.url,
    eventTitle: event.embed.title || null,
  };
}

module.exports = { loadTonightsTargets, loadTonightsEvent, extractTargets, extractDescription };
