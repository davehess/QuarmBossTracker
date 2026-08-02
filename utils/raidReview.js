// utils/raidReview.js — [#80] the Raid Night Review.
//
// The morning-after writeup of a raid night, generated instead of hand-built,
// posted into THAT NIGHT'S Discord thread and linked to the /raid/review page
// that already exists on the website.
//
// Design + the content decisions (what's in, what's deliberately cut, and why):
// docs/DESIGN-80-raid-night-review.md. Two rules from that doc are load-bearing
// and easy to break by accident:
//
//  1. THE THREAD IS RESOLVED BY THE NIGHT'S FIRST-ENCOUNTER TIMESTAMP, never by
//     Date.now(). utils/raidNight.js keys a thread off the scheduled-event
//     window that was open when the fight happened; by the time the review runs
//     (≈00:45) that window has closed, so "now" can plan a DIFFERENT key and
//     mint a second thread. The first encounter's start is by construction
//     inside the window that opened the thread, so planFor returns the same key
//     and _resolve hits its cache / by-name adoption path.
//
//  2. NOTHING HERE MAY BREAK THE MIDNIGHT CHAIN. scheduleRaidNightReview() and
//     catchUpRaidNightReview() are synchronous, swallow everything, and never
//     await the network — they hand the actual work to a timer. A failed review
//     must never stop archives, parse consolidation, or the nightly resets.
//
// Layers (kept separate so the whole review is unit-testable with no Discord
// and no network — see test/raid-review-post.test.js):
//     pure   nightWindowFor / mostRecentReviewableNight / summarizeNight /
//            renderReviewEmbeds
//     fetch  collectNightData        (bounded, best-effort Supabase selects)
//     post   postRaidNightReview / scheduleRaidNightReview / catchUpRaidNightReview
//
// Env:
//   RAID_REVIEW=0             disable the automatic post (the /raidreview
//                             command still works) — the kill switch
//   RAID_REVIEW_DELAY_MIN     minutes after midnight to post; default 45, which
//                             clears the 00:30 raid tail
//   RAID_REVIEW_CATCHUP_HOURS how stale a night the boot catch-up still posts
//                             (default 36)
//   RAID_REVIEW_MIN_KILLS     below this many confirmed kills, no review (1)

const { EmbedBuilder } = require('discord.js');
const { getDefaultTz, partsInTzAt, localToUTC } = require('./timezone');
const raidNight = require('./raidNight');
const { dedupParseDeaths } = require('./parseDeaths');

// Same thresholds web/lib/anomalies.ts uses to auto-hide a foreign raid from
// /parses. Duplicated (not imported — that's a .ts ESM module) so the review and
// the site agree on which encounters are ours; keep the two in sync.
const AUTO_FOREIGN_MAX_MEMBER_FRAC = 0.34;
const AUTO_FOREIGN_MIN_PLAYERS     = 10;

// Cross-encounter death collapse. find_or_create_encounter's ±30min window means
// adds and boss pulls OVERLAP, so one death lands in two encounters'
// contributions. Guild lead's rule: "assume people can't die twice in the same
// minute." Mirrors dedupNightDeaths in web/lib/raidReview.ts.
const NIGHT_DEATH_DEDUP_MS = 60_000;

function _int(name, dflt, min = 0) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= min ? n : dflt;
}
function reviewEnabled()   { return String(process.env.RAID_REVIEW ?? '1') !== '0'; }
function reviewDelayMin()  { return _int('RAID_REVIEW_DELAY_MIN', 45); }
function catchupHours()    { return _int('RAID_REVIEW_CATCHUP_HOURS', 36); }
function minKills()        { return _int('RAID_REVIEW_MIN_KILLS', 1, 0); }

// ── Pure: the night window ───────────────────────────────────────────────────

/** ms since epoch for `hour:00` local on the calendar day containing `ms`.
 *  Uses timezone.localToUTC (the same DST-corrected conversion /announce and
 *  the raid-window math use) rather than arithmetic on the wall clock. */
function _localHourMs(ms, hour) {
  const tz = getDefaultTz();
  const p  = partsInTzAt(ms, tz);
  return localToUTC(p.year, p.month, p.day, hour, 0, tz).getTime();
}

/**
 * The [from, to) window of the raid night that `ts` belongs to, plus the keys
 * every surface needs. A night runs rollover→rollover (06:00 → 06:00 by
 * default), which is exactly the set of fights that landed in its thread.
 */
function nightWindowFor(ts) {
  const at     = Number.isFinite(ts) ? ts : Date.now();
  const anchor = raidNight.nightAnchorMs(at);         // pulled back over rollover
  const roll   = raidNight.rolloverHour();
  const fromMs = _localHourMs(anchor, roll);
  return {
    fromMs,
    toMs:     fromMs + 24 * 3_600_000,
    nightKey: raidNight.nightKey(at),                 // MM/DD/YYYY (thread key)
    label:    raidNight.nightLabel(at),               // "Thursday, July 30, 2026"
    dateKey:  isoDateKey(anchor),                     // YYYY-MM-DD (web + OpenDKP)
  };
}

/** YYYY-MM-DD in the default tz — the key /raid/review and opendkp_raids use. */
function isoDateKey(ms) {
  const p = partsInTzAt(ms, getDefaultTz());
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The most recent night that is OVER and therefore reviewable at `nowMs`.
 *
 * A night's review is due at (the midnight that ends it) + delay. If `now` is
 * still before that, the current night key isn't reviewable yet and we step
 * back one day. Returns null when even that night is older than the catch-up
 * horizon — a bot that was down for a week must not post an ancient review.
 */
function mostRecentReviewableNight(nowMs = Date.now(), { horizonHours = catchupHours() } = {}) {
  const w      = nightWindowFor(nowMs);
  // The night ends at its own rollover; its review is due `delay` past the
  // MIDNIGHT inside that window (rollover 6 ⇒ midnight is 18h into the window).
  const dueMs  = w.fromMs + (24 - raidNight.rolloverHour()) * 3_600_000 + reviewDelayMin() * 60_000;
  const target = nowMs >= dueMs ? w : nightWindowFor(w.fromMs - 3_600_000);
  const endedMs = target.fromMs + (24 - raidNight.rolloverHour()) * 3_600_000;   // its midnight
  if (horizonHours > 0 && (nowMs - endedMs) > horizonHours * 3_600_000) return null;
  return target;
}

// ── Pure: formatting helpers ─────────────────────────────────────────────────

function cleanBossName(raw) {
  if (!raw) return 'Unknown';
  return String(raw).replace(/^#/, '').replace(/_/g, ' ').trim() || 'Unknown';
}
function fmtDmg(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}
function fmtDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
function fmtClock(ms) {
  const p = partsInTzAt(ms, getDefaultTz());
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, '0')}${p.hour < 12 ? 'a' : 'p'}`;
}
/** Discord field values cap at 1024 — trim on a line boundary, never mid-word. */
function clampLines(lines, max = 1024, moreLabel = 'more') {
  const out = [];
  let len = 0, dropped = 0;
  for (const l of lines) {
    if (len + l.length + 1 > max - 24) { dropped++; continue; }
    out.push(l); len += l.length + 1;
  }
  if (dropped) out.push(`_…and ${dropped} ${moreLabel}_`);
  return out.join('\n');
}

// ── Pure: composition ────────────────────────────────────────────────────────

function _isPlayerName(n) { return !!n && /^[A-Za-z]{2,}$/.test(n); }

/**
 * Is this encounter a foreign raid (a guildie pugging someone else's raid)?
 * Same rule /parses auto-hides on, so the review and the site agree.
 */
function _isForeign(enc, roster) {
  if (enc.classification === 'foreign') return true;
  if (enc.classification != null) return false;
  const real = (enc.encounter_players || []).filter(p => _isPlayerName(p.character_name));
  if (real.length < AUTO_FOREIGN_MIN_PLAYERS) return false;
  const members = real.filter(p => roster.has(String(p.character_name).toLowerCase())).length;
  return (members / real.length) < AUTO_FOREIGN_MAX_MEMBER_FRAC;
}

function _ms(v) { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : 0; }

/**
 * Everything the review says, derived from plain rows. No I/O, no Discord.
 *
 * data = { window, encounters, deathContribs, characters, loot, ticks,
 *          funEvents, history, uploaders }
 * Returns null when the night has nothing worth posting.
 */
function summarizeNight(data) {
  const win     = data?.window || nightWindowFor(Date.now());
  const chars   = Array.isArray(data?.characters) ? data.characters : [];
  const roster  = new Set(chars.map(c => String(c.name || '').toLowerCase()).filter(Boolean));
  const excluded = new Set(chars.filter(c => c.exclude_from_stats)
    .map(c => String(c.name || '').toLowerCase()).filter(Boolean));
  const classBy = new Map(chars.map(c => [String(c.name || '').toLowerCase(), c.class || null]));
  const zoneBy  = new Map((data?.zones || []).map(z => [z.short_name, z.long_name]));

  const all = (Array.isArray(data?.encounters) ? data.encounters : [])
    .filter(e => e && !_isForeign(e, roster));

  const killAt = e => _ms(e.started_at) + (e.duration_sec || 0) * 1000;
  const nameOf = e => cleanBossName(e.eqemu_npc_types?.name || e.npc_name);
  const zoneOf = e => {
    const short = e.zone_short || e.eqemu_npc_types?.zone_short || null;
    return short ? (zoneBy.get(short) || short) : null;
  };

  // A "kill" is a CONFIRMED kill: find_or_create_encounter only sets ended_at
  // when a death line was seen. Everything else was engaged but not confirmed
  // down — a wipe, a reset, or an upload that stopped early.
  const kills   = all.filter(e => e.ended_at != null).sort((a, b) => killAt(a) - killAt(b));
  const engaged = all.filter(e => e.ended_at == null);

  if (kills.length === 0) return null;

  // ── Deaths: the SAME algorithm as the parse card and the web page (#134),
  // per-encounter, then the 60s cross-encounter collapse. Never a 4th count.
  const contribsByEnc = new Map();
  for (const c of (data?.deathContribs || [])) {
    if (!c?.encounter_id) continue;
    const arr = contribsByEnc.get(c.encounter_id) || [];
    arr.push(Array.isArray(c.deaths) ? c.deaths : []);
    contribsByEnc.set(c.encounter_id, arr);
  }
  const rawDeaths = [];
  for (const e of all) {
    for (const d of dedupParseDeaths(contribsByEnc.get(e.id) || [])) {
      if (excluded.has(String(d.name).toLowerCase())) continue;
      const t = _ms(d.ts);
      if (!t) continue;
      const klass = d.class || classBy.get(String(d.name).toLowerCase()) || null;
      for (let i = 0; i < Math.max(1, d.count); i++) {
        rawDeaths.push({ name: d.name, ts: t, class: klass, boss: nameOf(e), encId: e.id });
      }
    }
  }
  rawDeaths.sort((a, b) => a.ts - b.ts);
  const deaths = [];
  const lastByName = new Map();
  for (const d of rawDeaths) {
    const k = d.name.toLowerCase();
    const prev = lastByName.get(k);
    if (prev != null && Math.abs(d.ts - prev) <= NIGHT_DEATH_DEDUP_MS) continue;
    lastByName.set(k, d.ts);
    deaths.push(d);
  }
  // Class-less rows are pets / untracked entities (web/lib/raidReview.ts
  // partitionDeaths). They're noise on a raider-facing list.
  const playerDeaths = deaths.filter(d => d.class);

  // ── Roll-up numbers + standouts.
  // Only ROSTER names are counted or named. encounter_players carries pets and
  // the odd pug alongside raiders (77 "players" on a 44-raider night before
  // this filter), and the review must not hand a pet the top-damage crown.
  // Falls back to "any single-word name" when the roster fetch failed, so a
  // Supabase blip degrades to the old, looser count rather than an empty card.
  const isRaider = n => (roster.size ? roster.has(String(n).toLowerCase()) : _isPlayerName(n));
  let totalDamage = 0, totalDuration = 0;
  const byChar = new Map();          // name → { name, damage, fights }
  let bestFight = null;              // { name, dps, boss }
  for (const e of kills) {
    totalDamage   += e.total_damage || 0;
    totalDuration += e.duration_sec || 0;
    for (const p of (e.encounter_players || [])) {
      const n = p.character_name;
      if (!_isPlayerName(n) || !isRaider(n) || excluded.has(n.toLowerCase())) continue;
      const cur = byChar.get(n) || { name: n, damage: 0, fights: 0 };
      cur.damage += p.total_damage || 0;
      cur.fights += 1;
      byChar.set(n, cur);
      if ((p.dps || 0) > (bestFight?.dps || 0)) bestFight = { name: n, dps: p.dps || 0, boss: nameOf(e) };
    }
  }
  const topDamage = [...byChar.values()].sort((a, b) => b.damage - a.damage)[0] || null;
  const hardest   = [...kills].sort((a, b) => (b.duration_sec || 0) - (a.duration_sec || 0))[0] || null;

  // ── "Slower than our own history" — median duration for the same npc over
  // the trailing window, from OUR kills. Never an invented target time.
  const histBy = new Map();
  for (const h of (data?.history || [])) {
    if (!h?.npc_id || !(h.duration_sec > 0)) continue;
    const arr = histBy.get(h.npc_id) || [];
    arr.push(h.duration_sec);
    histBy.set(h.npc_id, arr);
  }
  const slowFights = [], fastFights = [];
  for (const e of kills) {
    const arr = histBy.get(e.npc_id);
    if (!arr || arr.length < 4) continue;                      // need a real baseline
    const s = [...arr].sort((a, b) => a - b);
    const med = s[Math.floor(s.length / 2)];
    const d = e.duration_sec || 0;
    if (!(med > 0) || !(d > 0)) continue;
    // Both a RELATIVE and an ABSOLUTE floor in each direction: 25% off the
    // median is only worth saying when it's also a minute of real time, so a
    // 40s trash mob at 30s median never shows up as a problem OR a triumph.
    if (d > med * 1.25 && (d - med) >= 60) {
      slowFights.push({ boss: nameOf(e), duration_sec: d, median_sec: med, pct: Math.round((d / med - 1) * 100) });
    } else if (d < med * 0.75 && (med - d) >= 60) {
      fastFights.push({ boss: nameOf(e), duration_sec: d, median_sec: med, pct: Math.round((1 - d / med) * 100) });
    }
  }
  slowFights.sort((a, b) => b.pct - a.pct);
  fastFights.sort((a, b) => b.pct - a.pct);

  // ── Deaths by fight (top 3).
  const deathsByBoss = new Map();
  for (const d of playerDeaths) deathsByBoss.set(d.boss, (deathsByBoss.get(d.boss) || 0) + 1);
  const worstFights = [...deathsByBoss.entries()]
    .map(([boss, n]) => ({ boss, deaths: n }))
    .sort((a, b) => b.deaths - a.deaths)
    .slice(0, 3);

  // ── Loot (OpenDKP awards for the night).
  const loot = (Array.isArray(data?.loot) ? data.loot : [])
    .filter(l => l && l.item_name)
    .map(l => ({ item: l.item_name, winner: l.character_name || '—', dkp: Number(l.dkp) || 0 }))
    .sort((a, b) => b.dkp - a.dkp);
  const dkpSpent = loot.reduce((s, l) => s + l.dkp, 0);

  // ── Attendance from the OpenDKP ticks (authoritative — raid_roster is swept
  // hourly, so it is NOT available the morning after).
  const ticks = (Array.isArray(data?.ticks) ? data.ticks : [])
    .map(t => ({
      id: t.tick_id, value: Number(t.value) || 0,
      attendees: Array.isArray(t.attendees) ? t.attendees : [],
      description: t.description || '',
    }))
    .sort((a, b) => a.id - b.id);
  const everAttended = new Set();
  for (const t of ticks) for (const a of t.attendees) everAttended.add(String(a));
  const firstTick = ticks[0] || null;
  const lastTick  = ticks[ticks.length - 1] || null;
  const leftEarly = (firstTick && lastTick && firstTick !== lastTick)
    ? firstTick.attendees.filter(a => !lastTick.attendees.includes(a))
    : [];
  const dkpAwarded = ticks.reduce((s, t) => s + t.value, 0);

  // ── One fun line, capped. Drops out on a quiet night.
  const funBy = new Map();
  for (const f of (data?.funEvents || [])) {
    if (!f?.event_type) continue;
    funBy.set(f.event_type, (funBy.get(f.event_type) || 0) + 1);
  }
  const fun = [...funBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([type, n]) => ({ type, n }));

  const zones = [...new Set(kills.map(zoneOf).filter(Boolean))];
  const startMs = Math.min(...kills.map(e => _ms(e.started_at)));
  const endMs   = Math.max(...kills.map(killAt));

  return {
    window: win,
    startMs, endMs,
    zones,
    kills: kills.map(e => ({
      id: e.id, boss: nameOf(e), zone: zoneOf(e),
      atMs: killAt(e), duration_sec: e.duration_sec || 0, damage: e.total_damage || 0,
      // A confirmed kill with almost nobody on the parse is a real kill with a
      // thin UPLOAD (one agent caught a stray hit) — "Ashenbone Broodmaster ·
      // 2s · 93" on 2026-07-30. We keep the kill (a death line confirmed it)
      // and flag the data instead of silently dropping a boss or silently
      // publishing a nonsense duration.
      thin: (e.encounter_players || []).filter(p => _isPlayerName(p.character_name)).length < 3,
    })),
    engaged: engaged.map(e => ({ boss: nameOf(e), atMs: _ms(e.started_at) })),
    raiders: byChar.size,
    totalDamage, totalDuration,
    topDamage, bestFight,
    hardest: hardest ? { boss: nameOf(hardest), duration_sec: hardest.duration_sec || 0, damage: hardest.total_damage || 0 } : null,
    deaths: playerDeaths,
    worstFights, slowFights,
    fastFights,
    loot, dkpSpent,
    attendance: {
      total: everAttended.size,
      ticks: ticks.map(t => ({ n: t.attendees.length, value: t.value })),
      dkpAwarded, leftEarly,
    },
    fun,
    uploaders: Number(data?.uploaders) || 0,
    deathsAvailable: (data?.deathContribs || []).length > 0,
  };
}

const FUN_LABELS = {
  drunkard:              'drunken stumbles',
  dragon_punch:          'dragon punches',
  mana_twitch_received:  'mana twitches',
  malthur_food_received: 'servings of Malthur\'s finest',
  malthur_water_received:'rounds of water',
  summon_food:           'summoned meals',
  mind_wrack_recourse:   'mind wracks',
};

/** The Discord embeds. Pure — takes a summary, returns EmbedBuilder[]. */
function renderReviewEmbeds(sum, { webBase } = {}) {
  if (!sum) return [];
  const base = webBase || process.env.WEB_BASE_URL || 'https://wolfpack.quest';
  const url  = `${base}/raid/review/${sum.window.dateKey}`;

  const elapsedMin = Math.max(1, Math.round((sum.endMs - sum.startMs) / 60_000));
  const elapsed    = `${Math.floor(elapsedMin / 60)}h ${elapsedMin % 60}m`;

  const head = [
    `**${sum.zones.length ? sum.zones.join(' · ') : 'Norrath'}** — ${fmtClock(sum.startMs)} → ${fmtClock(sum.endMs)} (${elapsed})`,
    `**${sum.kills.length}** down · **${fmtDmg(sum.totalDamage)}** damage · **${sum.raiders}** on the parse` +
      (sum.deathsAvailable ? ` · **${sum.deaths.length}** deaths` : ''),
  ];

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`📓 Raid Night Review — ${sum.window.label}`)
    .setURL(url)
    .setDescription(head.join('\n'));

  // 🏆 Kills — in kill order, zone-headed when the night moved zones.
  {
    const lines = [];
    let lastZone = null, anyThin = false;
    const multiZone = sum.zones.length > 1;
    for (const k of sum.kills) {
      if (multiZone && k.zone && k.zone !== lastZone) { lines.push(`*— ${k.zone} —*`); lastZone = k.zone; }
      if (k.thin) anyThin = true;
      lines.push(`\`${fmtClock(k.atMs).padStart(6)}\` **${k.boss}** · ${fmtDur(k.duration_sec)} · ${fmtDmg(k.damage)}${k.thin ? ' \\*' : ''}`);
    }
    if (anyThin) lines.push('_\\* only a partial parse reached us for this one_');
    embed.addFields({ name: `🏆 Kills (${sum.kills.length})`, value: clampLines(lines, 1024, 'more kills'), inline: false });
  }

  // ⭐ Standouts — three named lines. The reason people read a review.
  {
    const lines = [];
    if (sum.topDamage) lines.push(`🥇 **${sum.topDamage.name}** — ${fmtDmg(sum.topDamage.damage)} across ${sum.topDamage.fights} fights`);
    if (sum.bestFight && sum.bestFight.dps > 0) lines.push(`⚡ Best single fight — **${sum.bestFight.name}**, ${sum.bestFight.dps.toLocaleString('en-US')} dps on ${sum.bestFight.boss}`);
    if (sum.hardest && sum.hardest.duration_sec > 0) lines.push(`💪 Hardest pull — **${sum.hardest.boss}**, ${fmtDur(sum.hardest.duration_sec)} and ${fmtDmg(sum.hardest.damage)}`);
    const pb = sum.fastFights?.[0];
    if (pb) lines.push(`⏱️ **${pb.boss}** went down in ${fmtDur(pb.duration_sec)} — ${pb.pct}% faster than our own median (${fmtDur(pb.median_sec)})`);
    if (lines.length) embed.addFields({ name: '⭐ Standouts', value: clampLines(lines), inline: false });
  }

  // 💰 Loot — top 8 by price, plus the total.
  if (sum.loot.length) {
    const lines = sum.loot.slice(0, 8).map(l => `**${l.item}** → ${l.winner} · ${l.dkp} DKP`);
    if (sum.loot.length > 8) lines.push(`_…and ${sum.loot.length - 8} more_`);
    embed.addFields({
      name: `💰 Loot (${sum.loot.length} · ${sum.dkpSpent} DKP spent)`,
      value: clampLines(lines, 1024, 'more items'), inline: false,
    });
  }

  // 🫂 Attendance — from the DKP ticks, which is the record that pays people.
  if (sum.attendance.total > 0) {
    const lines = [`${sum.attendance.ticks.map(t => t.n).join(' → ')} on ${sum.attendance.ticks.length} ticks · **${sum.attendance.dkpAwarded} DKP** awarded`];
    if (sum.attendance.leftEarly.length) {
      const names = sum.attendance.leftEarly.slice(0, 8).join(', ');
      lines.push(`On the first tick but not the last: ${names}${sum.attendance.leftEarly.length > 8 ? ` +${sum.attendance.leftEarly.length - 8}` : ''}`);
    }
    embed.addFields({ name: `🫂 Attendance (${sum.attendance.total})`, value: clampLines(lines), inline: false });
  }

  // 🩹 What to work on — grounded: our deaths, our own history, our resets.
  {
    const lines = [];
    for (const w of sum.worstFights) lines.push(`💀 **${w.boss}** — ${w.deaths} death${w.deaths === 1 ? '' : 's'}`);
    for (const s of sum.slowFights.slice(0, 2)) {
      lines.push(`🐢 **${s.boss}** took ${fmtDur(s.duration_sec)} — ${s.pct}% over our own median (${fmtDur(s.median_sec)})`);
    }
    if (sum.engaged.length) {
      const names = [...new Set(sum.engaged.map(e => e.boss))].slice(0, 4).join(', ');
      lines.push(`↩️ Engaged but never confirmed down: ${names}`);
    }
    if (lines.length) embed.addFields({ name: '🩹 What to work on', value: clampLines(lines, 1024, 'more notes'), inline: false });
  }

  // 🎪 One fun line. Drops out entirely on a quiet night.
  if (sum.fun.length) {
    const parts = sum.fun.map(f => `${f.n} ${FUN_LABELS[f.type] || String(f.type).replace(/_/g, ' ')}`);
    embed.addFields({ name: '🎪 Around the campfire', value: parts.join(' · '), inline: false });
  }

  const foot = [`${sum.uploaders || 0} agent upload${sum.uploaders === 1 ? '' : 's'} built this`];
  if (!sum.deathsAvailable) foot.push('death detail expires after 7 days');
  foot.push('/raidreview to refresh');
  embed.setFooter({ text: foot.join(' · ') });

  return [embed];
}

// ── Fetch: the night's rows ──────────────────────────────────────────────────

/**
 * Every read the review needs, bounded to one night. Best-effort throughout:
 * utils/supabase already returns null on failure/timeout/breaker-open, so a
 * review missing loot still ships the kills.
 */
async function collectNightData(win) {
  const supabase = require('./supabase');
  if (!supabase.isEnabled()) return null;

  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const fromIso = new Date(win.fromMs).toISOString();
  const toIso   = new Date(win.toMs).toISOString();

  const encounters = await supabase.select('encounters',
    'select=id,started_at,ended_at,duration_sec,total_damage,total_dps,zone_short,npc_id,classification,' +
    'eqemu_npc_types(name,zone_short),encounter_players(character_name,total_damage,dps,rank)' +
    `&guild_id=eq.${encodeURIComponent(guildId)}` +
    `&started_at=gte.${encodeURIComponent(fromIso)}&started_at=lt.${encodeURIComponent(toIso)}` +
    '&order=started_at.asc&limit=400') || [];

  const ids = encounters.map(e => e.id).filter(Boolean);
  const npcIds = [...new Set(encounters.map(e => e.npc_id).filter(n => Number.isFinite(n)))];
  const shorts = [...new Set(encounters.map(e => e.zone_short || e.eqemu_npc_types?.zone_short).filter(Boolean))];

  // Deaths live in contributions.raw_parse — nulled by the midnight compaction
  // after 7 days, so an old night renders without the deaths section.
  // PostgREST `in.(a,b)`. Values are UUIDs and zone short-names, so a strict
  // whitelist keeps them quote-free (a quoted list would need its separating
  // commas percent-encoded) and makes injection structurally impossible.
  const inList = arr => `(${arr.map(v => String(v).replace(/[^A-Za-z0-9_-]/g, '')).join(',')})`;
  const [deathContribs, characters, zones, loot, raids, funEvents, history] = await Promise.all([
    ids.length ? supabase.select('contributions',
      `select=encounter_id,contributor_character,deaths:raw_parse->deaths&encounter_id=in.${inList(ids)}&limit=4000`) : [],
    supabase.select('characters',
      `select=name,class,exclude_from_stats&guild_id=eq.${encodeURIComponent(guildId)}&limit=3000`),
    shorts.length ? supabase.select('eqemu_zone',
      `select=short_name,long_name&short_name=in.${inList(shorts)}`) : [],
    supabase.select('opendkp_loot_recent',
      `select=item_name,character_name,dkp&raid_date=eq.${win.dateKey}&order=dkp.desc&limit=200`),
    supabase.select('opendkp_raids',
      // opendkp_raids.ts is midday UTC on the raid's own date, and the
      // opendkp_loot_recent view keys `raid_date` off that same ts::date — so
      // both join on the night's ET dateKey without a timezone dance.
      `select=raid_id,name&ts=gte.${win.dateKey}T00%3A00%3A00Z&ts=lt.${win.dateKey}T23%3A59%3A59Z&limit=10`),
    supabase.select('fun_events',
      `select=event_type&guild_id=eq.${encodeURIComponent(guildId)}` +
      `&event_ts=gte.${encodeURIComponent(fromIso)}&event_ts=lt.${encodeURIComponent(toIso)}&limit=3000`),
    npcIds.length ? supabase.select('encounters',
      `select=npc_id,duration_sec&guild_id=eq.${encodeURIComponent(guildId)}` +
      `&npc_id=in.(${npcIds.join(',')})&ended_at=not.is.null` +
      `&started_at=gte.${encodeURIComponent(new Date(win.fromMs - 90 * 86_400_000).toISOString())}` +
      `&started_at=lt.${encodeURIComponent(fromIso)}&limit=3000`) : [],
  ]);

  const raidIds = (raids || []).map(r => r.raid_id).filter(n => Number.isFinite(n));
  const ticks = raidIds.length
    ? (await supabase.select('opendkp_ticks',
        `select=tick_id,description,value,attendees,raid_id&raid_id=in.(${raidIds.join(',')})&order=tick_id.asc&limit=50`)) || []
    : [];

  const uploaders = new Set((deathContribs || []).map(c => c.contributor_character).filter(Boolean)).size;

  return {
    window: win,
    encounters,
    deathContribs: (deathContribs || []).filter(c => Array.isArray(c.deaths)),
    characters: characters || [],
    zones: zones || [],
    loot: loot || [],
    ticks,
    funEvents: funEvents || [],
    history: history || [],
    uploaders,
  };
}

// ── Post ─────────────────────────────────────────────────────────────────────

// Test seams for the two impure edges. vitest's ESM import and this file's
// require() resolve to DIFFERENT module instances (the same reason
// raidNight._setEventsModule exists), so a spy can't reach them from a test —
// they have to be injectable.
let _collector = null;
let _stateMod  = null;
let _nightMod  = null;
function _setDeps({ collect, state, raidNight: rn } = {}) {
  _collector = collect || null;
  _stateMod  = state   || null;
  _nightMod  = rn      || null;
}
function _collect(win) { return (_collector || collectNightData)(win); }
function _state()      { return _stateMod || require('./state'); }
function _night()      { return _nightMod || raidNight; }

/**
 * Build and post (or edit) the review for the night containing `atMs`.
 * NEVER throws — returns { ok, reason, messageId?, summary? }.
 *
 * `dryRun` builds everything and returns the embeds without touching Discord;
 * that's what /raidreview preview and the test suite use.
 */
async function postRaidNightReview(client, { atMs = Date.now(), dryRun = false, force = false } = {}) {
  try {
    const win = nightWindowFor(atMs);
    const data = await _collect(win);
    if (!data) return { ok: false, reason: 'supabase-disabled', window: win };

    const summary = summarizeNight(data);
    if (!summary) return { ok: false, reason: 'no-kills', window: win };
    if (summary.kills.length < minKills()) return { ok: false, reason: 'below-min-kills', window: win, summary };

    const embeds = renderReviewEmbeds(summary);
    if (dryRun) return { ok: true, reason: 'dry-run', window: win, summary, embeds };

    // The thread the night's parse cards used. Anchor on the FIRST ENCOUNTER,
    // never on now — see the header note.
    //
    // planFor FIRST, so an off-night guild event bails BEFORE getRaidNightTarget
    // would open a 🎲 event thread as a side effect. A roll-loot night already
    // has its own live card (utils/rollLoot.js); it gets no review.
    const plan = await _night().planFor(client, summary.startMs).catch(() => null);
    if (plan?.kind === 'event' && !force) return { ok: false, reason: 'event-night', window: win, summary, embeds };

    const target = await _night().getRaidNightTarget(client, summary.startMs);
    if (!target.thread) return { ok: false, reason: 'no-thread', window: win, summary, embeds };
    if (target.kind === 'event' && !force) return { ok: false, reason: 'event-night', window: win, summary, embeds };

    const state = _state();
    const existingId = state.getRaidReviewMessageId(win.nightKey);
    if (existingId) {
      const msg = await target.thread.messages.fetch(existingId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds });
        return { ok: true, reason: 'edited', window: win, summary, messageId: msg.id, threadId: target.thread.id };
      }
    }
    const sent = await target.thread.send({ embeds });
    try { state.setRaidReviewMessageId(win.nightKey, sent.id); } catch { /* volume issue — a re-run reposts, not a crash */ }
    console.log(`[raid-review] posted ${win.label} → thread ${target.thread.id} (${summary.kills.length} kills)`);
    return { ok: true, reason: 'posted', window: win, summary, messageId: sent.id, threadId: target.thread.id };
  } catch (err) {
    console.warn('[raid-review] post failed:', err?.message);
    return { ok: false, reason: 'error', error: err?.message };
  }
}

// One pending timer at a time — a redeploy plus a catch-up must not stack two.
let _timer = null;

/**
 * The midnight-chain link. SYNCHRONOUS, never throws, never awaits the network:
 * it only arms a timer. The chain's existing steps and their order are
 * untouched, and a broken review cannot stop archives or resets.
 *
 * Posting is deferred RAID_REVIEW_DELAY_MIN (45) past midnight because raids
 * run to 00:30 — a review built at 00:00 would miss the last half hour.
 */
function scheduleRaidNightReview(client, { nowMs = Date.now() } = {}) {
  try {
    if (!reviewEnabled()) return { scheduled: false, reason: 'disabled' };
    if (!client) return { scheduled: false, reason: 'no-client' };
    const delayMs = reviewDelayMin() * 60_000;
    const win = nightWindowFor(nowMs);
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _timer = setTimeout(() => {
      _timer = null;
      postRaidNightReview(client, { atMs: win.fromMs + 3_600_000 })
        .catch(err => console.warn('[raid-review] deferred post failed:', err?.message));
    }, delayMs);
    if (typeof _timer.unref === 'function') _timer.unref();
    console.log(`[raid-review] ${win.label} review scheduled in ${reviewDelayMin()} min`);
    return { scheduled: true, delayMs, window: win };
  } catch (err) {
    console.warn('[raid-review] schedule failed:', err?.message);
    return { scheduled: false, reason: 'error' };
  }
}

/**
 * Boot link. A setTimeout dies with the process and 00:45 ET is exactly when a
 * deploy is most likely (the raid freeze lifts at 00:30). This posts the most
 * recent COMPLETED night's review if one isn't already stored. Idempotent —
 * the stored message id means a duplicate run edits instead of reposting.
 *
 * Synchronous + never throws, like scheduleRaidNightReview.
 */
function catchUpRaidNightReview(client, { nowMs = Date.now(), delayMs = 60_000 } = {}) {
  try {
    if (!reviewEnabled() || !client) return { scheduled: false, reason: 'disabled' };
    const win = mostRecentReviewableNight(nowMs);
    if (!win) return { scheduled: false, reason: 'no-recent-night' };
    let already = null;
    try { already = _state().getRaidReviewMessageId(win.nightKey); } catch { /* fall through */ }
    if (already) return { scheduled: false, reason: 'already-posted', window: win };
    const t = setTimeout(() => {
      postRaidNightReview(client, { atMs: win.fromMs + 3_600_000 })
        .catch(err => console.warn('[raid-review] catch-up post failed:', err?.message));
    }, delayMs);
    if (typeof t.unref === 'function') t.unref();
    return { scheduled: true, window: win };
  } catch (err) {
    console.warn('[raid-review] catch-up failed:', err?.message);
    return { scheduled: false, reason: 'error' };
  }
}

/** Test seam — drops the pending timer. */
function _clearTimer() { if (_timer) { clearTimeout(_timer); _timer = null; } }

module.exports = {
  // pure
  nightWindowFor, isoDateKey, mostRecentReviewableNight,
  summarizeNight, renderReviewEmbeds,
  cleanBossName, fmtDmg, fmtDur, fmtClock, clampLines,
  NIGHT_DEATH_DEDUP_MS, AUTO_FOREIGN_MAX_MEMBER_FRAC, AUTO_FOREIGN_MIN_PLAYERS,
  // fetch
  collectNightData,
  // post
  postRaidNightReview, scheduleRaidNightReview, catchUpRaidNightReview,
  reviewEnabled, reviewDelayMin, minKills,
  _clearTimer, _setDeps,
};
