// Guild + raid chat browser. Officer-only.
//
// Two view modes driven entirely by URL params (server-side rendering, no
// client state):
//
//   - **Browse mode**: when no specific day is picked, render bucket counts
//     at the current granularity (years → months → days). Each bucket links
//     deeper. Speaker / channel / text-contains filters apply to all buckets.
//
//   - **Log mode**: when a day is selected, render the chat scrollback for
//     that day with the active filters. Up to ROW_LIMIT lines.
//
// Filters can stack: ?speaker=Hitya&year=2025&month=8 will show Hitya's
// August 2025 days with message counts; ?speaker=Hitya alone shows which
// years they were active. Date input is replaced by the breadcrumb +
// drilldown — quicker than guessing at a date.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { dayLabel } from '@/lib/format';
import { loadItemCatalog, linkifyItems, type ItemCatalog } from '@/lib/item-link';
import { userTz } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

type ChatRow = {
  id: number;
  ts: string;
  channel: string;
  speaker: string;
  text: string;
  who: { name?: string; level?: number; class?: string; race?: string } | null;
};

type Params = {
  speaker?: string;
  channel?: string;
  search?: string;
  year?: string;
  month?: string;
  day?: string;
  era?: string;
  alldates?: string;  // "1" → flatten to every message across all dates (for infrequent speakers)
  nospam?: string;    // "1" → hide mechanical raid callouts (DA up/down, CH/heal chains) from the log
  raw?: string;       // "1" → show every captured perspective (skip clock-skew comingling)
};

// Comingle clock-skew duplicates. The same in-game line captured by several
// uploaders lands as multiple rows with slightly different `ts` (each box logs
// off its own system clock), so the dedup index — which keys on exact ts —
// keeps them all. For READING, collapse repeats of the same channel+speaker+
// text within a window down to the earliest one. People don't retype an
// identical line within a minute, so this is safe; a genuine re-say after the
// window still shows. Rows must be ts-ascending.
function comingleLog(rows: ChatRow[]): { rows: ChatRow[]; merged: number } {
  const WINDOW_MS = 60_000;
  const firstSeen = new Map<string, number>();
  const out: ChatRow[] = [];
  let merged = 0;
  for (const r of rows) {
    const norm = r.text.toLowerCase().replace(/\s+/g, ' ').trim();
    const key  = `${r.channel}|${r.speaker.toLowerCase()}|${norm}`;
    const tms  = new Date(r.ts).getTime();
    const prev = firstSeen.get(key);
    if (prev !== undefined && tms - prev <= WINDOW_MS) { merged++; continue; }
    firstSeen.set(key, tms);
    out.push(r);
  }
  return { rows: out, merged };
}

// Heuristic classifier for mechanical raid callouts — defensive-disc timers
// ("DA up" / ">>DA DOWN<<" / "6 SECONDS DA"), CH/heal chains, and mana
// announcements — as opposed to actual conversation. Used by the opt-in
// "hide callouts" toggle. It's deliberately conservative-ish but a false
// positive only hides a line the user can re-reveal by toggling off.
function isCombatCallout(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (/[<>]{2}/.test(t)) return true;                                  // >>...<< wrappers
  if (/\bda\b/.test(lower) && /(\bup\b|\bdown\b|\bsec)/.test(lower)) return true; // DA up/down/seconds
  if (/\bch\s*\d|\bch up\b|complete heal/.test(lower)) return true;   // CH chain / complete heal
  if (/\bremedy on\b|celestial elixir|ethereal light/.test(lower)) return true;  // heal-target callouts
  if (/\bmana[:\s]+\d{1,3}\s*%/.test(lower)) return true;             // "Mana: 96%" / "Mana 100%"
  if (/^\s*(?:ch\s*)?\d{1,3}\s*$/.test(lower)) return true;           // bare CH-chain numbers
  if (/\binc\b.*\bmana\b/.test(lower)) return true;                   // "Elixir INC ... Mana"
  return false;
}

// RPC arg helpers — shared by the bucket-count + top-speaker helpers below.
function rpcChannel(p: Params): string | null {
  return p.channel && p.channel !== 'all' ? p.channel : null;
}
function rpcSpeakers(p: Params): string[] | null {
  const s = parseSpeakers(p.speaker);
  return s.length ? s : null;
}
// Intersect an optional [from,to) window with the active era's bounds. All
// inputs are canonical `…T00:00:00Z` ISO strings, so lexicographic min/max is
// correct. Returns nulls (= unbounded) when neither side constrains.
function clampToEra(p: Params, from: string | null, to: string | null): { from: string | null; to: string | null } {
  const era = eraByName(p.era);
  if (!era) return { from, to };
  return {
    from: from && from > era.start ? from : era.start,
    to:   to   && to   < era.end   ? to   : era.end,
  };
}

const ROW_LIMIT = 1000;

// Quarm expansion launch dates. Each era runs from its launch to the next
// one's launch. PoP's end date is left open (it's the current/future tier).
// Source: server announcements as of 2026-05-28.
const ERAS = [
  { name: 'Classic', start: '2023-10-01T00:00:00Z', end: '2024-07-01T00:00:00Z' },
  { name: 'Kunark',  start: '2024-07-01T00:00:00Z', end: '2025-04-01T00:00:00Z' },
  { name: 'Velious', start: '2025-04-01T00:00:00Z', end: '2025-10-01T00:00:00Z' },
  { name: 'Luclin',  start: '2025-10-01T00:00:00Z', end: '2026-10-01T00:00:00Z' },
  { name: 'PoP',     start: '2026-10-01T00:00:00Z', end: '2099-01-01T00:00:00Z' },
] as const;

function eraByName(name: string | undefined) {
  if (!name) return null;
  return ERAS.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
}

// Parse the speaker param. Comma-separated → list of speakers; everything else
// is treated as a single substring match (preserves the v1 behavior). Trim
// whitespace and drop empties so trailing commas don't accidentally widen the
// scope.
function parseSpeakers(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

// Add or remove a speaker from the active list (clicking from the sidebar).
// Case-insensitive match for dedup so capitalization quirks in the URL don't
// matter.
function toggleSpeakerList(current: string | undefined, name: string): string | undefined {
  const list = parseSpeakers(current);
  const idx = list.findIndex(s => s.toLowerCase() === name.toLowerCase());
  if (idx >= 0) list.splice(idx, 1);
  else list.push(name);
  return list.length > 0 ? list.join(',') : undefined;
}

function removeSpeaker(current: string | undefined, name: string): string | undefined {
  const list = parseSpeakers(current).filter(s => s.toLowerCase() !== name.toLowerCase());
  return list.length > 0 ? list.join(',') : undefined;
}

// Apply the orthogonal filters (speaker / channel / search / era) to a query.
function applyFilters<T extends { gte: Function; lt: Function; eq: Function; ilike: Function; or: Function }>(q: T, p: Params): T {
  let r = q;
  if (p.channel && p.channel !== 'all') r = (r as any).eq('channel', p.channel);
  const speakers = parseSpeakers(p.speaker);
  if (speakers.length === 1) {
    r = (r as any).ilike('speaker', `%${speakers[0].replace(/[%_]/g, '\\$&')}%`);
  } else if (speakers.length > 1) {
    // PostgREST .or() syntax: speaker.ilike.%X%,speaker.ilike.%Y% — names
    // contain no commas/parens so escaping the percent/underscore chars is
    // enough. Wrap each pattern explicitly to keep ilike's wildcard meaning.
    const clauses = speakers
      .map(s => `speaker.ilike.%${s.replace(/[%_]/g, '\\$&')}%`)
      .join(',');
    r = (r as any).or(clauses);
  }
  if (p.search)  r = (r as any).ilike('text',    `%${p.search.replace(/[%_]/g, '\\$&')}%`);
  const era = eraByName(p.era);
  if (era) r = (r as any).gte('ts', era.start).lt('ts', era.end);
  return r;
}

// Bucket counts come from the chat_bucket_counts RPC (server-side GROUP BY).
// The old approach fetched raw ts rows and counted in JS, but PostgREST's
// 1000-row response cap silently truncated the fetch — so the counts were wrong
// for any scope over ~1000 messages (the "Luclin shows 0" bug). The RPC returns
// one small row per bucket, exact regardless of corpus size.
type BucketRow = { bucket: number; n: number };

async function bucketCounts(p: Params, group: 'year' | 'month' | 'day', from: string | null, to: string | null) {
  const sb = supabaseAdmin();
  const { data } = await sb.rpc('chat_bucket_counts', {
    p_channel:  rpcChannel(p),
    p_speakers: rpcSpeakers(p),
    p_search:   p.search || null,
    p_from:     from,
    p_to:       to,
    p_group:    group,
  });
  return ((data ?? []) as BucketRow[]).map(r => [r.bucket, Number(r.n)] as [number, number]);
}

async function yearBuckets(p: Params) {
  const era = eraByName(p.era);
  const rows = await bucketCounts(p, 'year', era?.start ?? null, era?.end ?? null);
  return rows.sort((a, b) => b[0] - a[0]);
}

async function monthBuckets(p: Params, year: number) {
  const { from, to } = clampToEra(p, `${year}-01-01T00:00:00Z`, `${year + 1}-01-01T00:00:00Z`);
  const rows = await bucketCounts(p, 'month', from, to);
  return rows.sort((a, b) => a[0] - b[0]);
}

async function dayBuckets(p: Params, year: number, month: number) {
  const start = `${year}-${String(month).padStart(2,'0')}-01T00:00:00Z`;
  const nextYear  = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = `${nextYear}-${String(nextMonth).padStart(2,'0')}-01T00:00:00Z`;
  const { from, to } = clampToEra(p, start, end);
  const rows = await bucketCounts(p, 'day', from, to);
  return rows.sort((a, b) => a[0] - b[0]);
}

async function loadDay(p: Params, year: number, month: number, day: number): Promise<ChatRow[]> {
  const sb = supabaseAdmin();
  const start = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00Z`;
  const dayDate = new Date(Date.UTC(year, month - 1, day));
  dayDate.setUTCDate(dayDate.getUTCDate() + 1);
  const end = dayDate.toISOString();
  let q = sb.from('chat_messages')
    .select('id, ts, channel, speaker, text, who')
    .gte('ts', start).lt('ts', end)
    .order('ts', { ascending: true })
    .limit(ROW_LIMIT);
  q = applyFilters(q as any, p) as typeof q;
  const { data } = await q;
  return (data ?? []) as ChatRow[];
}

// All-dates view — every message matching the speaker/channel/search filter,
// across the entire timeline (ignores year/month/day/era). Built for chasing
// down the full history of someone who rarely talks. Still bounded by ROW_LIMIT
// (and PostgREST's row cap), which is plenty for an infrequent speaker; a note
// renders if it's hit.
async function loadAllDates(p: Params): Promise<ChatRow[]> {
  const sb = supabaseAdmin();
  let q = sb.from('chat_messages')
    .select('id, ts, channel, speaker, text, who')
    .order('ts', { ascending: true })
    .limit(ROW_LIMIT);
  q = applyFilters(q as any, { speaker: p.speaker, channel: p.channel, search: p.search }) as typeof q;
  const { data } = await q;
  return (data ?? []) as ChatRow[];
}

// Per-era message counts, respecting the active speaker / channel / search
// filter (but NOT the era filter itself — each chip shows its own count).
// One chat_bucket_counts RPC per era (server-side; cap-immune).
async function eraCounts(p: Omit<Params, 'era' | 'year' | 'month' | 'day'>) {
  const sb = supabaseAdmin();
  const base = { p_channel: rpcChannel(p as Params), p_speakers: rpcSpeakers(p as Params), p_search: p.search || null };
  const out = await Promise.all(ERAS.map(async (e) => {
    const { data } = await sb.rpc('chat_bucket_counts', { ...base, p_from: e.start, p_to: e.end, p_group: 'total' });
    const n = Array.isArray(data) && data[0] ? Number((data[0] as BucketRow).n) : 0;
    return { name: e.name, count: n };
  }));
  return out;
}

// Top speakers in the current scope. EXCLUDES the speaker filter so the sidebar
// shows every voice in range — clicking adds/removes a name without losing
// scope. chat_top_speakers does the GROUP BY server-side (was capped before).
async function topSpeakers(p: Omit<Params, 'speaker'>, scope: { start: string; end: string } | null) {
  const sb = supabaseAdmin();
  const { from, to } = clampToEra(p as Params, scope?.start ?? null, scope?.end ?? null);
  const { data } = await sb.rpc('chat_top_speakers', {
    p_channel: rpcChannel(p as Params),
    p_search:  p.search || null,
    p_from:    from,
    p_to:      to,
    p_limit:   30,
  });
  return ((data ?? []) as { speaker: string; n: number }[]).map(r => [r.speaker, Number(r.n)] as [string, number]);
}

// "Years that exist in the chat_messages table at all" — used to render the
// year axis even when the active filter has no matches that year. Without
// this, drilling into a narrow filter would hide the rest of the timeline.
// Cheap: two single-row queries for min/max ts.
async function allYearsAxis(): Promise<number[]> {
  const sb = supabaseAdmin();
  const [minRes, maxRes] = await Promise.all([
    sb.from('chat_messages').select('ts').order('ts', { ascending: true }).limit(1).maybeSingle(),
    sb.from('chat_messages').select('ts').order('ts', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const minTs = (minRes.data as { ts?: string } | null)?.ts;
  const maxTs = (maxRes.data as { ts?: string } | null)?.ts;
  if (!minTs || !maxTs) return [];
  const minYear = new Date(minTs).getUTCFullYear();
  const maxYear = new Date(maxTs).getUTCFullYear();
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);
  return years;
}

function paramsToQuery(p: Params): string {
  const u = new URLSearchParams();
  if (p.speaker) u.set('speaker', p.speaker);
  if (p.channel && p.channel !== 'all') u.set('channel', p.channel);
  if (p.search)  u.set('search',  p.search);
  if (p.year)    u.set('year',    p.year);
  if (p.month)   u.set('month',   p.month);
  if (p.day)     u.set('day',     p.day);
  if (p.era)     u.set('era',     p.era);
  if (p.alldates) u.set('alldates', p.alldates);
  if (p.nospam)  u.set('nospam',  p.nospam);
  if (p.raw)     u.set('raw',     p.raw);
  const qs = u.toString();
  return qs ? `?${qs}` : '';
}

function fmtTime(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: tz,
  });
}

// Date + time — used in the all-dates flat view where rows span many days.
function fmtDateTime(iso: string, tz: string) {
  return new Date(iso).toLocaleString('en-US', {
    year: '2-digit', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: tz,
  });
}

function channelChip(ch: string) {
  if (ch === 'guild') return { label: 'gu', color: 'text-green' };
  if (ch === 'raid')  return { label: 'rs', color: 'text-orange' };
  return { label: ch.slice(0, 3), color: 'text-dim' };
}

function renderText(text: string, catalog: ItemCatalog) {
  // First pass: split on agent-injected URL placeholders <https://…>
  // (already extracted as clickable PQDI links by the agent when the line
  // contained \x12 item-link metadata). Second pass: scan the remaining
  // plain segments for item-name matches from the eqemu_items catalog so
  // bare-text item mentions ("Trochilic's Skean") get the same treatment.
  const segments: ({ kind: 'url'; url: string; label: string } | { kind: 'text'; value: string })[] = [];
  const rx = /<(https?:\/\/[^>]+)>/g;
  let last = 0;
  let m;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) segments.push({ kind: 'text', value: text.slice(last, m.index) });
    segments.push({ kind: 'url', url: m[1], label: m[1].includes('pqdi.cc/item/') ? '🔗' : m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) });

  const out: React.ReactNode[] = [];
  let k = 0;
  for (const seg of segments) {
    if (seg.kind === 'url') {
      out.push(
        <a key={k++} href={seg.url} target="_blank" rel="noreferrer" className="text-blue hover:underline">
          {seg.label}
        </a>,
      );
      continue;
    }
    const nodes = linkifyItems(seg.value, catalog);
    for (const n of nodes) {
      if (n.type === 'text') {
        out.push(<span key={k++}>{n.value}</span>);
      } else {
        const href = `https://www.pqdi.cc/item/${n.id}`;
        out.push(
          <a
            key={k++}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-purple hover:underline"
            title={`PQDI · item ${n.id}`}
          >
            {n.name}
          </a>,
        );
      }
    }
  }
  return out;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default async function AdminChatPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const p = await searchParams;
  const tz = await userTz();
  const year  = p.year  ? parseInt(p.year,  10) : null;
  const month = p.month ? parseInt(p.month, 10) : null;
  const day   = p.day   ? parseInt(p.day,   10) : null;

  // Build breadcrumb levels — used both for navigation and to compute the
  // scope's start/end for the swap-speaker sidebar.
  const crumbs: { label: string; href: string }[] = [
    { label: 'All time', href: `/admin/chat${paramsToQuery({ speaker: p.speaker, channel: p.channel, search: p.search })}` },
  ];
  if (year) {
    crumbs.push({
      label: String(year),
      href: `/admin/chat${paramsToQuery({ speaker: p.speaker, channel: p.channel, search: p.search, year: String(year) })}`,
    });
  }
  if (year && month) {
    crumbs.push({
      label: MONTH_NAMES[month - 1],
      href: `/admin/chat${paramsToQuery({ speaker: p.speaker, channel: p.channel, search: p.search, year: String(year), month: String(month) })}`,
    });
  }
  if (year && month && day) {
    crumbs.push({
      label: String(day),
      href: `/admin/chat${paramsToQuery({ speaker: p.speaker, channel: p.channel, search: p.search, year: String(year), month: String(month), day: String(day) })}`,
    });
  }

  // Mode: all-dates flat view > log (a full date) > browse buckets.
  const inAllDates = p.alldates === '1';
  const inLogMode  = !inAllDates && year && month && day;

  // For the swap-speaker sidebar — scope dates based on what's selected.
  let scope: { start: string; end: string } | null = null;
  if (year && month && day) {
    const s = new Date(Date.UTC(year, month - 1, day));
    const e = new Date(s); e.setUTCDate(e.getUTCDate() + 1);
    scope = { start: s.toISOString(), end: e.toISOString() };
  } else if (year && month) {
    const s = new Date(Date.UTC(year, month - 1, 1));
    const e = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
    scope = { start: s.toISOString(), end: e.toISOString() };
  } else if (year) {
    scope = { start: `${year}-01-01T00:00:00Z`, end: `${year + 1}-01-01T00:00:00Z` };
  }

  // Browser / log content
  let years: [number, number][] = [];
  let yearAxis: number[] = [];
  let months: [number, number][] = [];
  let days: [number, number][] = [];
  let log: ChatRow[] = [];

  let hiddenCallouts = 0;
  if (inAllDates) {
    log = await loadAllDates(p);
  } else if (inLogMode) {
    log = await loadDay(p, year!, month!, day!);
  } else if (year && month) {
    days = await dayBuckets(p, year, month);
  } else if (year) {
    months = await monthBuckets(p, year);
  } else {
    // At the year level, show ALL years that exist in chat_messages — even
    // ones with 0 matches for the active filter. Otherwise narrowing the
    // filter would hide the rest of the timeline.
    [years, yearAxis] = await Promise.all([yearBuckets(p), allYearsAxis()]);
  }

  // Opt-in: strip mechanical raid callouts from the rendered log so actual
  // conversation is readable. Applied after load (the filter is in JS), so the
  // hidden count is informational.
  if (p.nospam === '1' && (inLogMode || inAllDates)) {
    const before = log.length;
    log = log.filter(r => !isCombatCallout(r.text));
    hiddenCallouts = before - log.length;
  }

  // Comingle clock-skew duplicates (on by default; ?raw=1 shows every capture).
  let mergedDupes = 0;
  if (p.raw !== '1' && (inLogMode || inAllDates)) {
    const res = comingleLog(log);
    log = res.rows;
    mergedDupes = res.merged;
  }

  // Speaker swap menu — independent of the speaker filter so you can swap
  // speakers without losing the time scope.
  const speakerList = await topSpeakers({ channel: p.channel, search: p.search }, scope);

  // Per-era counts for the chips row.
  const eras = await eraCounts({ speaker: p.speaker, channel: p.channel, search: p.search });
  const activeEra = eraByName(p.era);

  // Item catalog — only fetched (and cached for an hour) when we're about to
  // render an actual chat log. Browse/bucket views don't need it.
  const itemCatalog: ItemCatalog = inLogMode
    ? await loadItemCatalog(supabaseAdmin())
    : new Map();

  // Group log by speaker for the "by speaker" toggle? Future. For v1, just
  // render chronologically with channel chip + speaker.

  return (
    <div className="space-y-6">
      <div className="text-sm flex items-center gap-2">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">💬 Guild Chat Browser</h2>
        <p className="text-sm text-dim">
          Drill from year → month → day to find a conversation. Stack a
          speaker / channel / text filter at any level — buckets recompute.
        </p>
        <form className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4" method="GET">
          {/* Preserve drilldown level when filters change. */}
          {year  && <input type="hidden" name="year"  value={year}  />}
          {month && <input type="hidden" name="month" value={month} />}
          {day   && <input type="hidden" name="day"   value={day}   />}
          <label className="text-xs">
            <span className="text-dim block mb-1">Channel</span>
            <select name="channel" defaultValue={p.channel ?? 'all'}
              className="w-full bg-bg border border-border rounded px-2 py-1 text-sm">
              <option value="all">All</option>
              <option value="guild">Guild</option>
              <option value="raid">Raid</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="text-dim block mb-1">
              Speaker <span className="text-dim/70">(comma-separated for multi-select)</span>
            </span>
            <input type="text" name="speaker" defaultValue={p.speaker ?? ''}
              placeholder="(any) — e.g. Hitya, Aimey, Halocke"
              className="w-full bg-bg border border-border rounded px-2 py-1 text-sm" />
          </label>
          <label className="text-xs">
            <span className="text-dim block mb-1">Text contains</span>
            <input type="text" name="search" defaultValue={p.search ?? ''}
              placeholder="(any)" className="w-full bg-bg border border-border rounded px-2 py-1 text-sm" />
          </label>
          <div className="col-span-full flex gap-2">
            <button type="submit" className="px-4 py-1.5 rounded border border-blue bg-[#1f6feb] text-white text-sm">Apply</button>
            <Link href="/admin/chat" className="px-4 py-1.5 rounded border border-border bg-panel text-text text-sm">Reset all</Link>
          </div>
        </form>
      </section>

      {/* Breadcrumb + active-filter chips */}
      <nav className="text-xs flex items-center gap-2 flex-wrap">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-dim">›</span>}
            {i < crumbs.length - 1 ? (
              <Link href={c.href} className="text-blue hover:underline">{c.label}</Link>
            ) : (
              <span className="text-text">{c.label}</span>
            )}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3 flex-wrap">
          {parseSpeakers(p.speaker).map(name => (
            <span key={name} className="text-dim">
              speaker: <span className="text-orange">{name}</span>
              <Link
                href={`/admin/chat${paramsToQuery({ ...p, speaker: removeSpeaker(p.speaker, name) })}`}
                className="ml-1 text-dim hover:text-blue"
                aria-label={`Remove speaker ${name}`}
              >
                ×
              </Link>
            </span>
          ))}
          {activeEra && (
            <span className="text-dim">
              era: <span className="text-blue">{activeEra.name}</span>
              <Link href={`/admin/chat${paramsToQuery({ ...p, era: undefined, year: undefined, month: undefined, day: undefined })}`} className="ml-1 text-dim hover:text-blue">×</Link>
            </span>
          )}
        </span>
      </nav>

      {/* Expansion era chips — jump to any era in one click. Counts respect
          the active speaker/channel/search filter so you can see how much
          a single character talked in each era. */}
      <section className="bg-panel border border-border rounded-lg p-3">
        <div className="text-xs text-dim mb-2">Expansion era</div>
        <div className="flex flex-wrap gap-2">
          {/* "All" clears the era filter — browse the entire corpus. */}
          <Link
            href={`/admin/chat${paramsToQuery({ speaker: p.speaker, channel: p.channel, search: p.search })}`}
            className={[
              'px-3 py-1 rounded border text-xs transition-colors no-underline',
              !activeEra ? 'border-blue bg-[#1f6feb33] text-blue' : 'border-border bg-bg text-text hover:border-blue',
            ].join(' ')}
          >
            <span>All</span>
            <span className="text-dim ml-1.5 text-[10px]">{eras.reduce((s, e) => s + e.count, 0).toLocaleString()}</span>
          </Link>
          {eras.map(e => {
            const isActive = activeEra?.name === e.name;
            // Clicking an era CLEARS year/month/day so the era constrains the
            // browser — you then drill back down via the new buckets.
            const href = `/admin/chat${paramsToQuery({
              speaker: p.speaker, channel: p.channel, search: p.search,
              era: isActive ? undefined : e.name,
            })}`;
            return (
              <Link
                key={e.name}
                href={href}
                className={[
                  'px-3 py-1 rounded border text-xs transition-colors no-underline',
                  isActive
                    ? 'border-blue bg-[#1f6feb33] text-blue'
                    : e.count === 0
                      ? 'border-border bg-bg/50 text-dim opacity-50'
                      : 'border-border bg-bg text-text hover:border-blue',
                ].join(' ')}
              >
                <span>{e.name}</span>
                <span className="text-dim ml-1.5 text-[10px]">{e.count.toLocaleString()}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* All-dates entry/exit — for pulling a rarely-heard speaker's entire
          history without hunting through year/month/day buckets. */}
      {(parseSpeakers(p.speaker).length > 0 || inAllDates) && (
        <div className="text-xs">
          {inAllDates ? (
            <Link
              href={`/admin/chat${paramsToQuery({ speaker: p.speaker, channel: p.channel, search: p.search })}`}
              className="text-blue hover:underline"
            >
              ← Back to date browser
            </Link>
          ) : (
            <Link
              href={`/admin/chat${paramsToQuery({ speaker: p.speaker, channel: p.channel, search: p.search, alldates: '1' })}`}
              className="px-3 py-1 rounded border border-border bg-bg text-text hover:border-blue no-underline"
            >
              📜 View all messages (all dates)
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-6">
        {/* Main content */}
        <div className="space-y-4">
          {!inLogMode && !inAllDates && years.length === 0 && months.length === 0 && days.length === 0 && (
            <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
              No messages match the current filter. Try widening — drop the
              speaker filter or pop up a level via the breadcrumb.
            </section>
          )}

          {/* Year grid — always shows every year that exists in chat_messages,
              even when the active filter has 0 matches there. Grayed cells
              are still clickable so you can hop into an empty year and broaden
              the filter from inside it. */}
          {yearAxis.length > 0 && (
            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-sm text-orange mb-3">📅 Years</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {yearAxis.map((y) => {
                  const found = years.find(([yy]) => yy === y);
                  const n = found ? found[1] : 0;
                  const cellClass = n === 0
                    ? 'bg-bg/50 border border-border/40 rounded p-3 hover:border-blue transition-colors no-underline opacity-50'
                    : 'bg-bg border border-border rounded p-3 hover:border-blue transition-colors no-underline';
                  return (
                    <Link
                      key={y}
                      href={`/admin/chat${paramsToQuery({ ...p, year: String(y) })}`}
                      className={cellClass}
                    >
                      <div className="text-lg text-text">{y}</div>
                      <div className="text-xs text-dim">{n > 0 ? `${n.toLocaleString()} msgs` : 'no matches'}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* Month grid */}
          {months.length > 0 && (
            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-sm text-orange mb-3">📅 Months in {year}</h3>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                  const found = months.find(([mm]) => mm === m);
                  const n = found ? found[1] : 0;
                  if (n === 0) {
                    return <div key={m} className="bg-bg/50 border border-border/40 rounded p-2 text-center opacity-40">
                      <div className="text-sm text-dim">{MONTH_NAMES[m-1]}</div>
                      <div className="text-[10px] text-dim">—</div>
                    </div>;
                  }
                  return (
                    <Link
                      key={m}
                      href={`/admin/chat${paramsToQuery({ ...p, year: String(year), month: String(m) })}`}
                      className="bg-bg border border-border rounded p-2 hover:border-blue transition-colors text-center no-underline"
                    >
                      <div className="text-sm text-text">{MONTH_NAMES[m-1]}</div>
                      <div className="text-[10px] text-dim">{n.toLocaleString()}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* Day grid */}
          {days.length > 0 && (
            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-sm text-orange mb-3">📅 Days in {MONTH_NAMES[month! - 1]} {year}</h3>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
                  const found = days.find(([dd]) => dd === d);
                  const n = found ? found[1] : 0;
                  if (n === 0) {
                    return <div key={d} className="bg-bg/50 border border-border/40 rounded p-1.5 text-center opacity-40">
                      <div className="text-xs text-dim">{d}</div>
                    </div>;
                  }
                  return (
                    <Link
                      key={d}
                      href={`/admin/chat${paramsToQuery({ ...p, year: String(year), month: String(month), day: String(d) })}`}
                      className="bg-bg border border-border rounded p-1.5 hover:border-blue transition-colors text-center no-underline"
                    >
                      <div className="text-xs text-text">{d}</div>
                      <div className="text-[9px] text-dim">{n}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* Chat log — a single day (log mode) or the full flattened history
              (all-dates mode). */}
          {(inLogMode || inAllDates) && (
            <section className="bg-panel border border-border rounded-lg p-3 font-mono text-xs">
              <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-border flex-wrap">
                <span className="text-dim text-[11px]">
                  {inAllDates ? '📜 All messages across every date (oldest first).' : 'Chat log.'}
                  {p.nospam === '1' && hiddenCallouts > 0 && (
                    <span className="ml-1 text-orange">{hiddenCallouts} callout{hiddenCallouts === 1 ? '' : 's'} hidden.</span>
                  )}
                  {p.raw !== '1' && mergedDupes > 0 && (
                    <span className="ml-1 text-blue">{mergedDupes} skew-duplicate{mergedDupes === 1 ? '' : 's'} merged.</span>
                  )}
                </span>
                <div className="flex items-center gap-1.5 shrink-0 font-sans">
                  <Link
                    href={`/admin/chat${paramsToQuery({ ...p, raw: p.raw === '1' ? undefined : '1' })}`}
                    className={[
                      'px-2 py-0.5 rounded border text-[11px] no-underline',
                      p.raw === '1' ? 'border-blue bg-[#1f6feb33] text-blue' : 'border-border bg-bg text-dim hover:border-blue',
                    ].join(' ')}
                    title="Show every uploader's capture of each line (skip clock-skew merging)"
                  >
                    {p.raw === '1' ? '✓ Showing all captures' : 'Show all captures'}
                  </Link>
                  <Link
                    href={`/admin/chat${paramsToQuery({ ...p, nospam: p.nospam === '1' ? undefined : '1' })}`}
                    className={[
                      'px-2 py-0.5 rounded border text-[11px] no-underline',
                      p.nospam === '1' ? 'border-blue bg-[#1f6feb33] text-blue' : 'border-border bg-bg text-dim hover:border-blue',
                    ].join(' ')}
                    title="Hide defensive-disc timers, CH/heal chains, and mana callouts"
                  >
                    {p.nospam === '1' ? '✓ Callouts hidden' : 'Hide combat callouts'}
                  </Link>
                </div>
              </div>
              {log.length === 0 && (
                <div className="text-dim italic p-2">
                  {inAllDates ? 'No messages anywhere for the current filter.' : 'No messages on this day with the current filters.'}
                </div>
              )}
              {log.length > 0 && (
                <ol className="space-y-0.5">
                  {log.map((r) => {
                    const chip = channelChip(r.channel);
                    return (
                      <li key={r.id} className="flex gap-2 hover:bg-[#1a212c] -mx-1 px-1 rounded leading-5">
                        <span className={`text-dim shrink-0 ${inAllDates ? 'w-28' : 'w-16'}`}>{inAllDates ? fmtDateTime(r.ts, tz) : fmtTime(r.ts, tz)}</span>
                        <span className={`shrink-0 w-6 ${chip.color}`}>[{chip.label}]</span>
                        <span className="shrink-0">
                          <Link href={`/character/${encodeURIComponent(r.speaker)}`} className="text-text hover:text-blue">
                            {r.speaker}
                          </Link>
                          {r.who?.class && <span className="text-dim ml-1 text-[10px]">({r.who.class})</span>}
                        </span>
                        <span className="text-text break-words whitespace-pre-wrap">{renderText(r.text, itemCatalog)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {log.length === ROW_LIMIT && (
                <div className="mt-2 text-dim text-[11px] italic">
                  Showing the first {ROW_LIMIT} lines{inAllDates ? ' across all dates' : ' for this day'}.
                  {inAllDates ? ' Add a channel/text filter to narrow a chatty speaker.' : ' Narrow the filter to see more.'}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Sidebar — speakers in the current scope */}
        <aside className="space-y-3">
          <section className="bg-panel border border-border rounded-lg p-3">
            <div className="text-xs text-dim mb-2">
              {scope ? 'Speakers in this scope' : 'All-time top speakers'}
              <span className="text-[10px] block mt-0.5">click to filter / clear via ×</span>
            </div>
            {speakerList.length === 0 ? (
              <div className="text-xs text-dim italic">No speakers in scope.</div>
            ) : (
              <ul className="text-xs space-y-0.5 max-h-[60vh] overflow-y-auto">
                {speakerList.map(([name, n]) => {
                  // Sidebar clicks ADD to or REMOVE FROM the multi-speaker
                  // list; never wipe other selections. Active = the speaker
                  // is currently in the list.
                  const activeSpeakers = parseSpeakers(p.speaker);
                  const isActive = activeSpeakers.some(s => s.toLowerCase() === name.toLowerCase());
                  return (
                    <li key={name}>
                      <Link
                        href={`/admin/chat${paramsToQuery({ ...p, speaker: toggleSpeakerList(p.speaker, name) })}`}
                        className={`flex justify-between gap-2 px-1 py-0.5 rounded ${
                          isActive ? 'bg-[#1f6feb33] text-blue' : 'hover:bg-[#1a212c] text-text'
                        }`}
                      >
                        <span className="truncate">{name}</span>
                        <span className="text-dim shrink-0">{n}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
