// utils/guildInterestNotice.js — the officers' card for a new raidmimic.com guild registration.
//
// Pure: no I/O, no clock, no logging. The bot job (index.js _guildInterestNotice) does the reading and posting.
// A registration (public.guild_interest) is typed by a stranger, so every free-text value is UNTRUSTED DATA
// (the AFB rule, DECISIONS 192): it goes through clean() below before it can reach a Discord card, and the
// coded fields are printed only as the labels in the closed lists here, never raw. Nothing on the card is
// actionable: no buttons, no auto-reply.

const ADMIN_URL = 'https://wolfpack.quest/admin/interest';
const FIELD_MAX = 200;       // per free-text value; a Discord field value allows 1024
const MAX_CARDS = 5;         // per tick
const GOLD = 0xd4a017;

// Same vocabularies as web/lib/guildInterestFields.ts and the labels on web/app/admin/interest/page.tsx.
const GAME = { quarm: 'Project Quarm', 'eq-live': 'EverQuest live', other: 'Other' };
const DKP = { opendkp: 'OpenDKP', eqdkp: 'EQDKP', other: 'Other', none: 'None' };
const TZ = { et: 'ET', ct: 'CT', mt: 'MT', pt: 'PT', 'gmt-uk': 'UK/GMT', 'eu-central': 'CET', oceania: 'Oceania', other: 'other TZ' };
const BID = {
  'dkp-open': 'Open bid DKP', 'dkp-sealed': 'Sealed bid DKP', 'dkp-timer': 'Timed auction DKP', epgp: 'EPGP',
  rolls: 'Rolls / tiers', council: 'Loot council', picks: 'Ranked picks', other: 'Other', none: 'None yet',
};
const NIGHTS = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
const NIGHT_ORDER = Object.keys(NIGHTS);

const own = (map, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null);

// Make one stranger-typed value safe to print: links come out (a masked link keeps only its visible text, a bare
// URL becomes "(link removed)"), mentions come out, control/zero-width characters go, whitespace collapses, the
// length is capped, and Markdown characters are backslash-escaped so the text cannot bold, quote, spoil or break
// the card. Returns '' when nothing is left.
function clean(raw, max = FIELD_MAX) {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, max * 4)
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                       // masked link: keep the text only
    .replace(/<?\b(?:https?|ftp|discord):\/\/[^\s>)]*>?/gi, '(link removed)')
    .replace(/<(?:@[!&]?|#|\/|:)[^>\s]*>/g, '')                    // <@1> <@!1> <@&1> <#1> </cmd> <:emoji:1>
    .replace(/@(everyone|here)/gi, '(mention removed)')
    .replace(/@/g, '＠');                                      // a lone @name is inert too
  s = s.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return s.replace(/[\\*_~|`>#<\[\]()]/g, c => '\\' + c);
}

// Card fields for one row, each only when present.
function cardFields(row) {
  const r = row || {};
  const out = [];
  const add = (name, value, inline) => { if (value) out.push({ name, value, inline: !!inline }); };

  add('Guild', clean(r.guild_name, 60));
  const game = own(GAME, r.game);
  const server = clean(r.server, 40);
  add('Game', game ? (server ? `${game} (${server})` : game) : '', true);
  add('Raiders', Number.isInteger(r.raiders) ? String(r.raiders) : '', true);

  const nights = Array.isArray(r.nights) ? NIGHT_ORDER.filter(n => r.nights.includes(n)).map(n => NIGHTS[n]).join(', ') : '';
  const hhmm = v => (typeof v === 'string' && /^([01]\d|2[0-3]):(00|30)$/.test(v) ? v : '');
  const a = hhmm(r.raid_start), b = hhmm(r.raid_end);
  const window = a && b ? `${a}–${b}` : (a || b);
  const sched = [nights, [window, own(TZ, r.tz)].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  add('Nights', sched);

  add('Loot', [own(BID, r.bid_mode), own(DKP, r.dkp) && `DKP tool: ${own(DKP, r.dkp)}`].filter(Boolean).join(' · '));
  add('How they heard', clean(r.heard));
  add('Reply to', clean(r.discord_contact, 60));
  out.push({ name: '​', value: `[Open on wolfpack.quest/admin/interest](${ADMIN_URL})`, inline: false });
  return out;
}

function card(row) {
  return { title: '📝 New guild registration', color: GOLD, fields: cardFields(row) };
}

// created_at strings come back from PostgREST with microseconds; Date.parse keeps milliseconds, so ties fall
// back to the string so two rows inside one millisecond still order.
function cmp(a, b) {
  const d = Date.parse(a) - Date.parse(b);
  if (d) return d < 0 ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Which rows to post this tick. rows: any order. watermark: newest created_at already handled, or null.
// First run (no watermark): post nothing and start from `now`. Otherwise the oldest `max` newer rows post,
// the rest are a count for the "and N more" line, and the watermark moves past ALL pending rows.
function plan({ rows, watermark, now, max = MAX_CARDS }) {
  const nowIso = now instanceof Date ? now.toISOString() : String(now);
  if (!watermark) return { toPost: [], more: 0, nextWatermark: nowIso, first: true };
  const pending = (Array.isArray(rows) ? rows : [])
    .filter(r => r && typeof r.created_at === 'string' && cmp(r.created_at, watermark) > 0)
    .sort((x, y) => cmp(x.created_at, y.created_at));
  if (!pending.length) return { toPost: [], more: 0, nextWatermark: watermark, first: false };
  return {
    toPost: pending.slice(0, max),
    more: Math.max(0, pending.length - max),
    nextWatermark: pending[pending.length - 1].created_at,
    first: false,
  };
}

const moreLine = n => `…and ${n} more on the admin page: ${ADMIN_URL}`;

module.exports = { clean, cardFields, card, plan, cmp, moreLine, ADMIN_URL, MAX_CARDS, FIELD_MAX };
