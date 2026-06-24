// /admin/analytics — which pages are getting the most use (Uilnayar
// 2026-06-24). Sourced from page_views, logged by middleware.ts on every
// authenticated GET (admin pages skipped so officer scrolling doesn't dominate
// the numbers). Officer-only via the parent admin/layout.tsx gate.
//
// Three views:
//   1. Top normalized routes (e.g. /character/[name]/quests = all chars)
//   2. Top concrete paths (which character is viewed most)
//   3. Top viewers (which officers/members open the most pages)
// All capped to the selected time range (default 7d).

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const RANGES: { label: string; days: number }[] = [
  { label: '24h',   days: 1 },
  { label: '7d',    days: 7 },
  { label: '30d',   days: 30 },
  { label: '90d',   days: 90 },
];

type ViewRow = {
  user_id: string; path: string; route: string; viewed_at: string;
};

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  const chosen = RANGES.find(r => r.label === range) ?? RANGES[1];   // default 7d
  const sinceIso = new Date(Date.now() - chosen.days * 24 * 60 * 60 * 1000).toISOString();

  const admin = supabaseAdmin();
  const { data: rows } = await admin
    .from('page_views')
    .select('user_id, path, route, viewed_at')
    .gte('viewed_at', sinceIso)
    .limit(50000);
  const views = (rows ?? []) as ViewRow[];

  // Resolve user ids → discord nickname (for the viewer table). We only need
  // ids that appear in this window. wolfpack_members.user_id is the join key.
  const userIds = Array.from(new Set(views.map(v => v.user_id)));
  const nameByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: members } = await admin
      .from('wolfpack_members')
      .select('user_id, nickname, global_name')
      .in('user_id', userIds);
    for (const m of (members ?? []) as { user_id: string; nickname: string | null; global_name: string | null }[]) {
      nameByUser.set(m.user_id, m.nickname || m.global_name || m.user_id.slice(0, 8));
    }
  }

  // Aggregate: by route, by path, by user. Also per-day for the sparkline.
  const byRoute = new Map<string, { count: number; uniqueUsers: Set<string> }>();
  const byPath  = new Map<string, { count: number; uniqueUsers: Set<string> }>();
  const byUser  = new Map<string, { count: number; lastSeen: string }>();
  const byDay   = new Map<string, number>();   // YYYY-MM-DD → count
  for (const v of views) {
    const r = byRoute.get(v.route) ?? { count: 0, uniqueUsers: new Set<string>() };
    r.count++; r.uniqueUsers.add(v.user_id); byRoute.set(v.route, r);
    const p = byPath.get(v.path) ?? { count: 0, uniqueUsers: new Set<string>() };
    p.count++; p.uniqueUsers.add(v.user_id); byPath.set(v.path, p);
    const u = byUser.get(v.user_id) ?? { count: 0, lastSeen: v.viewed_at };
    u.count++; if (v.viewed_at > u.lastSeen) u.lastSeen = v.viewed_at;
    byUser.set(v.user_id, u);
    const day = v.viewed_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const topRoutes = [...byRoute.entries()]
    .map(([route, v]) => ({ route, count: v.count, uniques: v.uniqueUsers.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
  const topPaths = [...byPath.entries()]
    .map(([path, v]) => ({ path, count: v.count, uniques: v.uniqueUsers.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
  const topUsers = [...byUser.entries()]
    .map(([uid, v]) => ({ name: nameByUser.get(uid) ?? uid.slice(0, 8), count: v.count, lastSeen: v.lastSeen }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
  const uniqueViewers = new Set(views.map(v => v.user_id)).size;

  // Sparkline data — count per day across the range, filling in zeros.
  const days: { day: string; count: number }[] = [];
  for (let i = chosen.days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    days.push({ day: d, count: byDay.get(d) ?? 0 });
  }
  const dayMax = Math.max(1, ...days.map(d => d.count));

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin" className="text-blue hover:underline">← admin</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-baseline justify-between gap-4 flex-wrap mb-2">
          <h1 className="text-2xl text-gold">📊 Page analytics</h1>
          <div className="flex items-center gap-1 text-xs">
            {RANGES.map(r => (
              <Link key={r.label}
                href={`/admin/analytics?range=${r.label}`}
                className={`px-2 py-0.5 rounded border ${r.label === chosen.label ? 'border-blue text-blue bg-blue/10' : 'border-border text-dim hover:text-text'}`}>
                {r.label}
              </Link>
            ))}
          </div>
        </div>
        <p className="text-xs text-dim leading-5">
          Page views over the last <span className="text-text">{chosen.label}</span>.
          Logged from middleware on every authenticated GET — anonymous traffic + bots are excluded,
          and so are admin pages so officer browsing doesn&apos;t dominate the numbers.
        </p>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Total views" value={views.length} />
          <Stat label="Unique viewers" value={uniqueViewers} />
          <Stat label="Routes seen" value={byRoute.size} />
          <Stat label="Paths seen" value={byPath.size} />
        </div>
      </section>

      {/* Daily sparkline */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h3 className="text-lg text-orange mb-3">Daily volume</h3>
        {views.length === 0 ? (
          <p className="text-sm text-dim italic">No views in this range yet. Logging started when this feature shipped — check back tomorrow.</p>
        ) : (
          <div className="flex items-end gap-1 h-24">
            {days.map(d => (
              <div key={d.day} className="flex-1 flex flex-col items-center justify-end" title={`${d.day}: ${d.count.toLocaleString()} views`}>
                <div className="w-full bg-blue/70 hover:bg-blue rounded-t" style={{ height: `${(d.count / dayMax) * 100}%`, minHeight: d.count > 0 ? 2 : 0 }} />
                <div className="text-[8px] text-dim/70 mt-1 truncate w-full text-center">{d.day.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top routes — grouped */}
        <section className="bg-panel border border-border rounded-lg p-5">
          <h3 className="text-lg text-orange mb-1">Top routes</h3>
          <p className="text-[11px] text-dim mb-3">Dynamic segments collapsed — <code>/character/[name]/quests</code> sums every character&apos;s quest page.</p>
          {topRoutes.length === 0 ? (
            <p className="text-sm text-dim italic">No data.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dim text-xs text-left">
                  <th className="py-1 pr-3">Route</th>
                  <th className="py-1 pr-3 text-right">Views</th>
                  <th className="py-1 text-right">Unique</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {topRoutes.map(r => (
                  <tr key={r.route}>
                    <td className="py-1.5 pr-3"><code className="text-text">{r.route}</code></td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-blue">{r.count.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums text-dim">{r.uniques}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Top concrete paths */}
        <section className="bg-panel border border-border rounded-lg p-5">
          <h3 className="text-lg text-orange mb-1">Top pages</h3>
          <p className="text-[11px] text-dim mb-3">Exact URLs — which specific character / parse / boss pages are getting traffic.</p>
          {topPaths.length === 0 ? (
            <p className="text-sm text-dim italic">No data.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-dim text-xs text-left">
                  <th className="py-1 pr-3">Path</th>
                  <th className="py-1 pr-3 text-right">Views</th>
                  <th className="py-1 text-right">Unique</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {topPaths.map(r => (
                  <tr key={r.path}>
                    <td className="py-1.5 pr-3"><Link href={r.path} className="text-text hover:text-blue hover:underline">{r.path}</Link></td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-blue">{r.count.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums text-dim">{r.uniques}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Top viewers */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h3 className="text-lg text-orange mb-1">Top viewers</h3>
        <p className="text-[11px] text-dim mb-3">Who&apos;s using the site most. Last seen = most recent page view.</p>
        {topUsers.length === 0 ? (
          <p className="text-sm text-dim italic">No data.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-dim text-xs text-left">
                <th className="py-1 pr-3">Member</th>
                <th className="py-1 pr-3 text-right">Views</th>
                <th className="py-1">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {topUsers.map(u => (
                <tr key={u.name + u.lastSeen}>
                  <td className="py-1.5 pr-3 text-text">{u.name}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-blue">{u.count.toLocaleString()}</td>
                  <td className="py-1.5 text-dim text-xs">{new Date(u.lastSeen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className="text-xs text-dim">{label}</div>
      <div className="text-xl text-text tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
