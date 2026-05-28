// Guild + raid chat log. Officer-only (gated by /admin/layout.tsx).
//
// Pulls from chat_messages — populated by the bot's /api/agent/chat (live)
// and /api/agent/historical_chat (--since backfill). Defaults to today;
// supports date / channel / speaker filters via URL query params so the
// rendering is pure server-side, no client-side state.
//
// EQ chat emulation goals:
//   - Tight, monospace lines (mimics in-game scrollback)
//   - Channel color tags ("[gu]" green for guild, "[rs]" orange for raid)
//   - Hover row highlight
//   - Per-day section headers when the filter spans multiple days
//   - Speakers link to /character/[name] for cross-reference
//   - Item links from the agent's PQDI linkify stay clickable

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { dayKey, dayLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

type ChatRow = {
  id: number;
  ts: string;
  channel: string;
  speaker: string;
  text: string;
  who: { name?: string; level?: number; class?: string; race?: string } | null;
  uploaded_by: string | null;
};

const ROW_LIMIT = 1000;

async function load(params: { date?: string; channel?: string; speaker?: string; search?: string }) {
  const sb = supabaseAdmin();

  let q = sb.from('chat_messages')
    .select('id, ts, channel, speaker, text, who, uploaded_by')
    .order('ts', { ascending: false })
    .limit(ROW_LIMIT);

  if (params.date) {
    const start = `${params.date}T00:00:00Z`;
    const end   = `${params.date}T23:59:59.999Z`;
    q = q.gte('ts', start).lte('ts', end);
  }
  if (params.channel && params.channel !== 'all') {
    q = q.eq('channel', params.channel);
  }
  if (params.speaker) {
    q = q.ilike('speaker', `%${params.speaker.replace(/[%_]/g, '\\$&')}%`);
  }
  if (params.search) {
    q = q.ilike('text', `%${params.search.replace(/[%_]/g, '\\$&')}%`);
  }

  const { data, error } = await q;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as ChatRow[], error: null as string | null };
}

// Stats over the loaded window — message counts per channel + per top speakers.
function stats(rows: ChatRow[]) {
  const channelCounts = new Map<string, number>();
  const speakerCounts = new Map<string, number>();
  for (const r of rows) {
    channelCounts.set(r.channel, (channelCounts.get(r.channel) || 0) + 1);
    speakerCounts.set(r.speaker, (speakerCounts.get(r.speaker) || 0) + 1);
  }
  return {
    total: rows.length,
    perChannel: [...channelCounts.entries()].sort((a, b) => b[1] - a[1]),
    topSpeakers: [...speakerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

// Today's YYYY-MM-DD for the default filter.
function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}

// Channel tag color
function channelChip(ch: string) {
  if (ch === 'guild') return { label: 'gu', color: 'text-green' };
  if (ch === 'raid')  return { label: 'rs', color: 'text-orange' };
  return { label: ch.slice(0, 3), color: 'text-dim' };
}

// Linkify URLs that the agent's PQDI helper already emitted as bare URLs
// surrounded by < > (e.g. "Lucid Shard <https://www.pqdi.cc/item/12345>").
function renderText(text: string) {
  // Split on URL patterns; render bare URLs as anchor tags.
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

export default async function AdminChatPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; channel?: string; speaker?: string; search?: string }>;
}) {
  const sp = await searchParams;
  const filter = {
    date:    sp.date    ?? todayKey(),
    channel: sp.channel ?? 'all',
    speaker: sp.speaker ?? '',
    search:  sp.search  ?? '',
  };

  const { rows, error } = await load(filter);
  const s = stats(rows);

  // Reverse rows to render chronologically (oldest at top, newest at bottom —
  // matches in-game scrollback order).
  const chronological = [...rows].reverse();

  // Group by day so multi-day filters render with day separators.
  const byDay = new Map<string, ChatRow[]>();
  for (const r of chronological) {
    const k = dayKey(r.ts);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(r);
  }

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">💬 Guild Chat Log</h2>
        <p className="text-sm text-dim mb-4">
          Live + historical <code>/gu</code> and <code>/rs</code> traffic. Officers
          can browse and search. Limited to {ROW_LIMIT} rows per query — narrow
          the filter for older windows.
        </p>

        <form className="grid grid-cols-2 sm:grid-cols-4 gap-3" method="GET">
          <label className="text-xs">
            <span className="text-dim block mb-1">Date</span>
            <input type="date" name="date" defaultValue={filter.date}
              className="w-full bg-bg border border-border rounded px-2 py-1 text-sm" />
          </label>
          <label className="text-xs">
            <span className="text-dim block mb-1">Channel</span>
            <select name="channel" defaultValue={filter.channel}
              className="w-full bg-bg border border-border rounded px-2 py-1 text-sm">
              <option value="all">All</option>
              <option value="guild">Guild</option>
              <option value="raid">Raid</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="text-dim block mb-1">Speaker</span>
            <input type="text" name="speaker" defaultValue={filter.speaker}
              placeholder="(any)" className="w-full bg-bg border border-border rounded px-2 py-1 text-sm" />
          </label>
          <label className="text-xs">
            <span className="text-dim block mb-1">Text contains</span>
            <input type="text" name="search" defaultValue={filter.search}
              placeholder="(any)" className="w-full bg-bg border border-border rounded px-2 py-1 text-sm" />
          </label>
          <div className="col-span-2 sm:col-span-4 flex gap-2 mt-1">
            <button type="submit" className="px-4 py-1.5 rounded border border-blue bg-[#1f6feb] text-white text-sm">Apply</button>
            <Link href="/admin/chat" className="px-4 py-1.5 rounded border border-border bg-panel text-text text-sm">Reset</Link>
          </div>
        </form>
      </section>

      {error && (
        <section className="bg-panel border border-red rounded-lg p-4 text-red text-sm font-mono">
          Error: {error}
        </section>
      )}

      {/* Window stats */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Messages in window" value={String(s.total)} />
        <Stat label="Distinct speakers" value={String(s.topSpeakers.length > 0 ? new Set(rows.map(r => r.speaker)).size : 0)} />
        <Stat label="Guild" value={String(s.perChannel.find(c => c[0] === 'guild')?.[1] ?? 0)} accent="text-green" />
        <Stat label="Raid"  value={String(s.perChannel.find(c => c[0] === 'raid')?.[1] ?? 0)}  accent="text-orange" />
      </section>

      {/* Top speakers in window */}
      {s.topSpeakers.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-3">
          <div className="text-xs text-dim mb-2">Top speakers in this window:</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {s.topSpeakers.map(([name, n]) => (
              <span key={name}>
                <Link href={`/character/${encodeURIComponent(name)}`} className="text-text hover:text-blue">
                  {name}
                </Link>
                <span className="text-dim ml-1">· {n}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Chat log */}
      <section className="bg-panel border border-border rounded-lg p-3 font-mono text-xs">
        {rows.length === 0 && (
          <div className="text-dim italic p-2">
            No messages in this window. Try widening the date range, or check
            that the agent is actively uploading chat (chat_messages should
            accrue rows live during raids).
          </div>
        )}
        {[...byDay.entries()].map(([day, list]) => (
          <div key={day} className="mb-4 last:mb-0">
            {byDay.size > 1 && (
              <div className="text-orange text-sm border-b border-border pb-1 mb-2">
                {dayLabel(day)} — {day} <span className="text-dim text-xs">({list.length})</span>
              </div>
            )}
            <ol className="space-y-0.5">
              {list.map((r) => {
                const chip = channelChip(r.channel);
                return (
                  <li key={r.id} className="flex gap-2 hover:bg-[#1a212c] -mx-1 px-1 rounded leading-5">
                    <span className="text-dim shrink-0 w-16">{fmtTime(r.ts)}</span>
                    <span className={`shrink-0 w-6 ${chip.color}`}>[{chip.label}]</span>
                    <span className="shrink-0">
                      <Link href={`/character/${encodeURIComponent(r.speaker)}`} className="text-text hover:text-blue">
                        {r.speaker}
                      </Link>
                      {r.who?.class && (
                        <span className="text-dim ml-1 text-[10px]">({r.who.class})</span>
                      )}
                    </span>
                    <span className="text-text break-words whitespace-pre-wrap">
                      {renderText(r.text)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-bg border border-border/60 rounded p-2">
      <div className="text-[10px] text-dim uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-medium ${accent || 'text-text'}`}>{value}</div>
    </div>
  );
}
