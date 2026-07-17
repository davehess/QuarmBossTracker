// Landing page — public marketing copy + cards. The Recent Kills widget is
// data and only renders for signed-in users (guild members), matching the
// rest of the site's gate. Cards link to gated pages, which redirect
// unauthenticated visitors to /auth/signin?next=...
import Link from 'next/link';
import { PlatformMap, PlatformStats } from '@/components/PlatformMap';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { fmtDmg, fmtTime, dayKey, dayLabel, cleanBossName } from '@/lib/format';
import { userTz } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

type RecentRow = {
  id: string;
  started_at: string;
  total_damage: number;
  eqemu_npc_types: { name: string } | null;
};

async function loadRecent() {
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from('encounters')
      .select('id, started_at, total_damage, eqemu_npc_types ( name )')
      .gt('total_damage', 0)
      .order('started_at', { ascending: false })
      .limit(6);
    return (data as unknown as RecentRow[]) ?? [];
  } catch { return []; }
}

// Auto-raid-invite (ARI) banner was removed: invites are coordinated
// in-game via /who, so the website doesn't need to mirror that state.
// Bot-side ari_state mirror is kept (utils/state.js) since it's
// internal data.

export default async function HomePage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const recent = user ? await loadRecent() : [] as RecentRow[];
  const tz = await userTz();   // viewer's chosen zone (wp_tz cookie) → all times below

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-3">Welcome to <span className="text-blue">wolfpack.quest</span></h2>
        <p className="text-sm leading-6">
          The guild-wide companion to the Wolf Pack Discord bot. Shared parses,
          per-character history, raid attendance, loot, leaderboards.
          The local agent dashboard at <code>http://localhost:7779</code> still
          runs your in-raid HUD; this site is where you compare against the rest
          of the pack between fights.
        </p>
        <p className="text-sm mt-3">
          <Link href="/platform" className="text-blue hover:underline">
            🗺 New here? See the whole platform on one page →
          </Link>
        </p>
      </section>

      {/* Signed-out visitors get the platform map right here on the front page —
          the "what IS all of this?" answer without needing to find /platform.
          Node clicks land on the full page's drill-down cards. Members skip it
          (their homepage is the daily dashboard; the link above suffices). */}
      {!user && (
        <section className="bg-panel border border-border rounded-lg p-2 md:p-6 overflow-x-auto">
          <div className="min-w-[760px]">
            <PlatformMap anchorBase="/platform" />
          </div>
          <div className="px-4 pb-3">
            <PlatformStats />
            <p className="text-center text-xs mt-4">
              <Link href="/platform" className="text-blue hover:underline">
                explore every branch, the evolution, and the privacy story →
              </Link>
            </p>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-orange mb-2">🔥 Recent kills</h3>
          <ul className="text-xs space-y-0.5">
            {recent.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 border-b border-border/30 py-0.5">
                <Link href={`/parses/${r.id}`} className="text-text hover:text-blue truncate">
                  <span className="text-gold">{cleanBossName(r.eqemu_npc_types?.name)}</span>
                  <span className="text-dim"> · {dayLabel(dayKey(r.started_at, tz), tz)} {fmtTime(r.started_at, tz)}</span>
                </Link>
                <span className="text-dim whitespace-nowrap">{fmtDmg(r.total_damage)}</span>
              </li>
            ))}
          </ul>
          <Link href="/parses" className="text-xs text-blue hover:underline mt-2 inline-block">
            See all parses →
          </Link>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          title="📊 Parses"
          body="Every kill grouped by night and zone. Click any to see the full damage breakdown, deaths, loot for the night."
          href="/parses"
        />
        <Card
          title="🗺️ Boards"
          body="Live raid-boss spawn timers across every expansion — what's up now and what's coming in the next 24 hours."
          href="/boards"
        />
        <Card
          title="⚔️ PvP"
          body="Wolf Pack PvP kill leaderboard, per-character records + assists, and PvP-server boss spawn windows."
          href="/pvp"
        />
        <Card
          title="🏆 Ranks"
          body="Top damage parses, raid attendance, and DKP spenders over the last 30 days."
          href="/leaderboards"
        />
      </section>

      {!user && (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          <p>
            Parses, leaderboards, and per-character history require a Wolf Pack
            EQ Discord sign-in.{' '}
            <Link href="/auth/signin" className="text-blue hover:underline">
              Sign in
            </Link>{' '}
            to see them.
          </p>
        </section>
      )}
    </div>
  );
}

function Card({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <Link href={href} className="block bg-panel border border-border rounded-lg p-4 hover:border-blue transition-colors no-underline">
      <h3 className="text-base text-orange mb-1">{title}</h3>
      <p className="text-xs text-dim leading-5">{body}</p>
    </Link>
  );
}
