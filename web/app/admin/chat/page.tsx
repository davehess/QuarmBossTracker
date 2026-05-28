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
};

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

// Apply the orthogonal filters (speaker / channel / search / era) to a query.
function applyFilters<T extends { gte: Function; lt: Function; eq: Function; ilike: Function }>(q: T, p: Params): T {
  let r = q;
  if (p.channel && p.channel !== 'all') r = (r as any).eq('channel', p.channel);
  if (p.speaker) r = (r as any).ilike('speaker', `%${p.speaker.replace(/[%_]/g, '\\$&')}%`);
  if (p.search)  r = (r as any).ilike('text',    `%${p.search.replace(/[%_]/g, '\\$&')}%`);
  const era = eraByName(p.era);
  if (era) r = (r as any).gte('ts', era.start).lt('ts', era.end);
  return r;
}

// Year buckets — counts grouped by extract(year from ts). Postgrest doesn't
// support GROUP BY directly; we pull the raw rows for the filtered set and
// bucket in JS. The select is just (ts) which is cheap.
async function yearBuckets(p: Params) {
  const sb = supabaseAdmin();
  let q = sb.from('chat_messages').select('ts', { count: 'exact', head: false }).limit(50000);
  q = applyFilters(q as any, p) as typeof q;
  const { data } = await q;
  const map = new Map<number, number>();
  for (const r of (data ?? []) as { ts: string }[]) {
    const y = new Date(r.ts).getUTCFullYear();
    map.set(y, (map.get(y) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]);
}

async function monthBuckets(p: Params, year: number) {
  const sb = supabaseAdmin();
  const start = `${year}-01-01T00:00:00Z`;
  const end   = `${year + 1}-01-01T00:00:00Z`;
  let q = sb.from('chat_messages').select('ts').gte('ts', start).lt('ts', end).limit(50000);
  q = applyFilters(q as any, p) as typeof q;
  const { data } = await q;
  const map = new Map<number, number>();
  for (const r of (data ?? []) as { ts: string }[]) {
    const m = new Date(r.ts).getUTCMonth() + 1;
    map.set(m, (map.get(m) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

async function dayBuckets(p: Params, year: number, month: number) {
  const sb = supabaseAdmin();
  const start = `${year}-${String(month).padStart(2,'0')}-01T00:00:00Z`;
  const nextYear  = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = `${nextYear}-${String(nextMonth).padStart(2,'0')}-01T00:00:00Z`;
  let q = sb.from('chat_messages').select('ts').gte('ts', start).lt('ts', end).limit(50000);
  q = applyFilters(q as any, p) as typeof q;
  const { data } = await q;
  const map = new Map<number, number>();
  for (const r of (data ?? []) as { ts: string }[]) {
    const d = new Date(r.ts).getUTCDate();
    map.set(d, (map.get(d) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
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

// Per-era message counts, respecting the active speaker / channel / search
// filter (but NOT the era filter itself — we want each chip to show its own
// count). Single query pulls ts for the filtered set, JS buckets by era.
async function eraCounts(p: Omit<Params, 'era' | 'year' | 'month' | 'day'>) {
  const sb = supabaseAdmin();
  let q = sb.from('chat_messages').select('ts').limit(50000);
  if (p.channel && p.channel !== 'all') q = q.eq('channel', p.channel);
  if (p.speaker) q = q.ilike('speaker', `%${p.speaker.replace(/[%_]/g, '\\$&')}%`);
  if (p.search)  q = q.ilike('text',    `%${p.search.replace(/[%_]/g, '\\$&')}%`);
  const { data } = await q;
  const counts = new Map<string, number>(ERAS.map(e => [e.name, 0]));
  for (const r of (data ?? []) as { ts: string }[]) {
    const t = r.ts;
    for (const e of ERAS) {
      if (t >= e.start && t < e.end) {
        counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
        break;
      }
    }
  }
  return ERAS.map(e => ({ name: e.name, count: counts.get(e.name) ?? 0 }));
}

// Top speakers under the current filter scope (excluding speaker filter, so
// you can SWAP speakers in one click without losing year/month/day context).
async function topSpeakers(p: Omit<Params, 'speaker'>, scope: { start: string; end: string } | null) {
  const sb = supabaseAdmin();
  let q = sb.from('chat_messages').select('speaker').limit(50000);
  if (scope) q = q.gte('ts', scope.start).lt('ts', scope.end);
  if (p.channel && p.channel !== 'all') q = q.eq('channel', p.channel);
  if (p.search) q = q.ilike('text', `%${p.search.replace(/[%_]/g, '\\$&')}%`);
  const { data } = await q;
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { speaker: string }[]) {
    counts.set(r.speaker, (counts.get(r.speaker) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
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
  const qs = u.toString();
  return qs ? `?${qs}` : '';
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function channelChip(ch: string) {
  if (ch === 'guild') return { label: 'gu', color: 'text-green' };
  if (ch === 'raid')  return { label: 'rs', color: 'text-orange' };
  return { label: ch.slice(0, 3), color: 'text-dim' };
}

function renderText(text: string) {
  const parts: (string | { url: string; label: string })[] = [];
  const rx = /<(https?:\/\/[^>]+)>/g;
  let last = 0;
  let m;
  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ url: m[1], label: m[1].includes('pqdi.cc/item/') ? '🔗' : m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((p, i) => typeof p === 'string'
    ? <span key={i}>{p}</span>
    : <a key={i} href={p.url} target="_blank" rel="noreferrer" className="text-blue hover:underline">{p.label}</a>);
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default async function AdminChatPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const p = await searchParams;
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

  // Mode: log if a full date is selected; browse otherwise.
  const inLogMode = year && month && day;

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
  let months: [number, number][] = [];
  let days: [number, number][] = [];
  let log: ChatRow[] = [];

  if (inLogMode) {
    log = await loadDay(p, year!, month!, day!);
  } else if (year && month) {
    days = await dayBuckets(p, year, month);
  } else if (year) {
    months = await monthBuckets(p, year);
  } else {
    years = await yearBuckets(p);
  }

  // Speaker swap menu — independent of the speaker filter so you can swap
  // speakers without losing the time scope.
  const speakerList = await topSpeakers({ channel: p.channel, search: p.search }, scope);

  // Per-era counts for the chips row.
  const eras = await eraCounts({ speaker: p.speaker, channel: p.channel, search: p.search });
  const activeEra = eraByName(p.era);

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
            <span className="text-dim block mb-1">Speaker</span>
            <input type="text" name="speaker" defaultValue={p.speaker ?? ''}
              placeholder="(any)" className="w-full bg-bg border border-border rounded px-2 py-1 text-sm" />
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
          {p.speaker && (
            <span className="text-dim">
              speaker: <span className="text-orange">{p.speaker}</span>
              <Link href={`/admin/chat${paramsToQuery({ ...p, speaker: undefined })}`} className="ml-1 text-dim hover:text-blue">×</Link>
            </span>
          )}
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-6">
        {/* Main content */}
        <div className="space-y-4">
          {!inLogMode && years.length === 0 && months.length === 0 && days.length === 0 && (
            <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
              No messages match the current filter. Try widening — drop the
              speaker filter or pop up a level via the breadcrumb.
            </section>
          )}

          {/* Year grid */}
          {years.length > 0 && (
            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-sm text-orange mb-3">📅 Years with traffic</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {years.map(([y, n]) => (
                  <Link
                    key={y}
                    href={`/admin/chat${paramsToQuery({ ...p, year: String(y) })}`}
                    className="bg-bg border border-border rounded p-3 hover:border-blue transition-colors no-underline"
                  >
                    <div className="text-lg text-text">{y}</div>
                    <div className="text-xs text-dim">{n.toLocaleString()} msgs</div>
                  </Link>
                ))}
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

          {/* Chat log */}
          {inLogMode && (
            <section className="bg-panel border border-border rounded-lg p-3 font-mono text-xs">
              {log.length === 0 && (
                <div className="text-dim italic p-2">No messages on this day with the current filters.</div>
              )}
              {log.length > 0 && (
                <ol className="space-y-0.5">
                  {log.map((r) => {
                    const chip = channelChip(r.channel);
                    return (
                      <li key={r.id} className="flex gap-2 hover:bg-[#1a212c] -mx-1 px-1 rounded leading-5">
                        <span className="text-dim shrink-0 w-16">{fmtTime(r.ts)}</span>
                        <span className={`shrink-0 w-6 ${chip.color}`}>[{chip.label}]</span>
                        <span className="shrink-0">
                          <Link href={`/character/${encodeURIComponent(r.speaker)}`} className="text-text hover:text-blue">
                            {r.speaker}
                          </Link>
                          {r.who?.class && <span className="text-dim ml-1 text-[10px]">({r.who.class})</span>}
                        </span>
                        <span className="text-text break-words whitespace-pre-wrap">{renderText(r.text)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {log.length === ROW_LIMIT && (
                <div className="mt-2 text-dim text-[11px] italic">
                  Showing the first {ROW_LIMIT} lines for this day. Narrow the filter to see more.
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
                  const isActive = p.speaker?.toLowerCase() === name.toLowerCase();
                  return (
                    <li key={name}>
                      <Link
                        href={`/admin/chat${paramsToQuery({ ...p, speaker: isActive ? undefined : name })}`}
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
