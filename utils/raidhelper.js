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

// ── Sign-up extraction ─────────────────────────────────────────────────────
// RaidHelper embeds put sign-ups in embed.fields. Each field is a class /
// role / status bucket (Tank, Healer, Melee, Ranged, Caster, Tentative,
// Absence, Bench, Late). The value is a newline-separated list, each line
// looks like "1. <@discord_id> <Class>" or sometimes just "<@id>".
//
// We don't try to identify which RaidHelper template was used — we just
// capture every <@id> mention under each field and call the field name
// the status. The web UI buckets by status (going / tentative / etc).
const MENTION_RX = /<@!?(\d+)>/g;

// Bucket common RaidHelper field names. Anything that doesn't look like
// a known opt-out category becomes "going" — RH lets officers create
// custom class fields (Druid / Necro / Shaman / etc) and any role-based
// signup is a "yes" commitment.
function _statusFromFieldName(name) {
  const n = (name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!n) return null;
  if (n.includes('tent'))    return 'tentative';
  if (n.includes('absen') || n.includes('decline') || n.includes('out')) return 'absence';
  if (n.includes('bench'))   return 'bench';
  if (n.includes('late') || n.includes('back')) return 'late';
  return 'going';
}

function extractSignups(embed) {
  if (!embed || !Array.isArray(embed.fields)) return [];
  const out = [];
  let index = 0;
  for (const f of embed.fields) {
    const status = _statusFromFieldName(f?.name);
    if (!status) continue;
    const value = String(f?.value || '');
    // Pull every Discord mention out of the field. We don't try to parse
    // the class/spec label per row — too template-specific. Future
    // enhancement: capture the role name from the field title (the
    // RH-canonical class) as the role_or_class.
    const className = f.name?.replace(/[^A-Za-z0-9 ]/g, '').trim() || null;
    let m;
    while ((m = MENTION_RX.exec(value)) !== null) {
      out.push({
        discord_id:   m[1],
        status,
        class_name:   className,
        signup_index: index++,
      });
    }
  }
  return out;
}

// One-shot: scan a Discord channel for the last N RaidHelper-authored
// messages and produce { event, signups } tuples ready for upsert to
// rh_events + rh_signups. Used by /scanraidhelper to seed historical
// data without needing the RH REST API.
//
// We use msg.id as the synthetic event id (RH posts one event per
// message, no embedded event-id field in v1 embeds). This keeps the
// later API-backed sync from colliding because the API uses RH's own
// numeric ids which are wildly different from Discord snowflakes.
async function scanChannel(channel, { limit = 100 } = {}) {
  const out = [];
  if (!channel || typeof channel.messages?.fetch !== 'function') return out;
  let lastId = null;
  let fetched = 0;
  while (fetched < limit) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, limit - fetched),
      ...(lastId ? { before: lastId } : {}),
    }).catch(() => null);
    if (!batch || batch.size === 0) break;
    for (const msg of batch.values()) {
      lastId = msg.id;
      fetched++;
      if (!isRaidHelper(msg)) continue;
      const embed = msg.embeds?.[0];
      if (!embed) continue;

      // Best-effort time extraction (same approach as loadTonightsEvent)
      let eventMs = null;
      const tsMatch = (embed.description || '').match(/<t:(\d+):[a-z]>/i);
      if (tsMatch) eventMs = parseInt(tsMatch[1], 10) * 1000;
      if (!eventMs && embed.timestamp) eventMs = new Date(embed.timestamp).getTime();
      if (!eventMs) eventMs = msg.createdTimestamp;

      out.push({
        event: {
          id:                msg.id,
          server_id:         msg.guildId  || null,
          channel_id:        channel.id   || null,
          title:             embed.title  || null,
          description:       (embed.description || '').slice(0, 4000),
          start_time:        new Date(eventMs).toISOString(),
          end_time:          null,
          leader_discord_id: null,
          template:          'discord_embed_scrape',
          raw:               {
            embed,
            url:       msg.url,
            createdAt: new Date(msg.createdTimestamp).toISOString(),
          },
        },
        signups: extractSignups(embed),
      });
    }
    if (batch.size < 100) break;  // exhausted
  }
  return out;
}

module.exports = { loadTonightsTargets, loadTonightsEvent, extractTargets, extractDescription, extractSignups, scanChannel };
