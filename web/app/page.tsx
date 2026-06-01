// Landing page — public marketing copy + cards. The Recent Kills widget is
// data and only renders for signed-in users (guild members), matching the
// rest of the site's gate. Cards link to gated pages, which redirect
// unauthenticated visitors to /auth/signin?next=...
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { fmtDmg, fmtTime, dayKey, dayLabel, cleanBossName } from '@/lib/format';

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

// Current MIC (auto-raid-invite) + the discord_id of the named character's
// owner so the banner can deep-link a DM. When the named MIC's owner isn't
// linked, fall back to the officer who SET the ARI (always has a discord_id).
type AriRow = {
  character: string | null; password: string | null;
  set_by_id: string | null; set_by_name: string | null; set_at: string | null;
};
async function loadAri() {
  try {
    const sb = supabaseAdmin();
    const { data: ari } = await sb
      .from('ari_state')
      .select('character, password, set_by_id, set_by_name, set_at')
      .eq('guild_id', 'wolfpack')
      .maybeSingle();
    const a = ari as AriRow | null;
    if (!a || !a.character) return { ari: null, micDiscordId: null, backups: [] as { name: string; discord_id: string }[] };
    // Resolve the named MIC character → their owner's discord_id via OpenDKP
    // family (matches /me's loadOwnedCharacters logic — main_name root).
    const { data: charRow } = await sb
      .from('characters')
      .select('main_name, discord_id')
      .ilike('name', a.character)
      .eq('guild_id', 'wolfpack')
      .maybeSingle();
    let micDiscordId: string | null = charRow?.discord_id ?? null;
    if (!micDiscordId && charRow?.main_name) {
      // Try the family root
      const { data: rootRow } = await sb
        .from('characters')
        .select('discord_id')
        .ilike('name', charRow.main_name)
        .eq('guild_id', 'wolfpack')
        .maybeSingle();
      micDiscordId = rootRow?.discord_id ?? null;
    }
    // Backup officers: any character ranked Officer / Pack Leader with a
    // discord_id link, excluding the named MIC's owner. Banner lists these
    // so a member can ping a different officer if the MIC isn't responding.
    const { data: officers } = await sb
      .from('characters')
      .select('name, discord_id')
      .eq('guild_id', 'wolfpack')
      .in('rank', ['Officer', 'Pack Leader'])
      .not('discord_id', 'is', null)
      .limit(20);
    const backups = ((officers ?? []) as { name: string; discord_id: string }[])
      .filter(o => o.discord_id !== micDiscordId)
      // Stable order; dedupe by discord_id (one person may have many officer chars)
      .reduce<{ name: string; discord_id: string }[]>((acc, o) => {
        if (!acc.find(x => x.discord_id === o.discord_id)) acc.push(o);
        return acc;
      }, [])
      .slice(0, 5);
    return { ari: a, micDiscordId, backups };
  } catch { return { ari: null, micDiscordId: null, backups: [] as { name: string; discord_id: string }[] }; }
}

export default async function HomePage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const [recent, ariInfo] = await Promise.all([
    user ? loadRecent() : Promise.resolve([] as RecentRow[]),
    user ? loadAri()    : Promise.resolve({ ari: null, micDiscordId: null, backups: [] as { name: string; discord_id: string }[] }),
  ]);
  const { ari, micDiscordId, backups } = ariInfo;

  return (
    <div className="space-y-6">
      {user && ari && ari.character && (
        <section className="bg-panel border border-blue/60 rounded-lg p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-xs text-blue uppercase tracking-wide font-semibold">🎟️ Active MIC</div>
              <div className="text-lg text-text mt-1">
                <code className="text-gold">/who {ari.character}</code>
                <span className="text-dim mx-2">·</span>
                send tell with password{' '}
                <code className="text-gold">{ari.password}</code>
              </div>
              <div className="text-[11px] text-dim mt-1">
                Set by <span className="text-text">{ari.set_by_name || 'an officer'}</span>
                {ari.set_at && <> · <time dateTime={ari.set_at}>{new Date(ari.set_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time></>}
              </div>
            </div>
            {micDiscordId && (
              <a
                href={`discord://-/users/${micDiscordId}`}
                className="text-xs text-blue hover:underline whitespace-nowrap border border-blue/40 rounded px-2 py-1 bg-blue/10"
                title="Open a Discord DM with the MIC officer"
              >
                💬 DM {ari.character}
              </a>
            )}
          </div>
          {backups.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-dim hover:text-text">
                MIC not responding? Ping another officer →
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {backups.map(o => (
                  <a
                    key={o.discord_id}
                    href={`discord://-/users/${o.discord_id}`}
                    className="text-[11px] border border-border rounded px-2 py-1 bg-bg text-text hover:border-blue hover:text-blue"
                    title={`Open Discord DM with ${o.name}`}
                  >
                    💬 {o.name}
                  </a>
                ))}
              </div>
              <div className="text-[10px] text-dim/70 mt-2">
                Officers with linked Discord. If none of them respond, ask in <code>#raid-mobs</code>.
              </div>
            </details>
          )}
        </section>
      )}
      {user && !ari && (
        <section className="bg-panel border border-orange/40 rounded-lg p-4">
          <div className="text-xs text-orange uppercase tracking-wide font-semibold">🎟️ No MIC set</div>
          <div className="text-sm text-dim mt-1">
            No auto-raid invite is active right now. Officers: set one with <code className="text-text">/ari &lt;character&gt;</code> in Discord. Members: ping any officer in <code>#raid-mobs</code> for a manual invite.
          </div>
        </section>
      )}
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-3">Welcome to <span className="text-blue">wolfpack.quest</span></h2>
        <p className="text-sm leading-6">
          The guild-wide companion to the Wolf Pack Discord bot. Shared parses,
          per-character history, raid attendance, loot, leaderboards.
          The local agent dashboard at <code>http://localhost:7777</code> still
          runs your in-raid HUD; this site is where you compare against the rest
          of the pack between fights.
        </p>
      </section>

      {recent.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-orange mb-2">🔥 Recent kills</h3>
          <ul className="text-xs space-y-0.5">
            {recent.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 border-b border-border/30 py-0.5">
                <Link href={`/parses/${r.id}`} className="text-text hover:text-blue truncate">
                  <span className="text-gold">{cleanBossName(r.eqemu_npc_types?.name)}</span>
                  <span className="text-dim"> · {dayLabel(dayKey(r.started_at))} {fmtTime(r.started_at)}</span>
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
          title="🏆 Boards"
          body="Top damage parses, raid attendance, and DKP spenders over the last 30 days."
          href="/leaderboards"
        />
        <Card
          title="🗡️ Loadouts"
          body="Every tank's bandolier sets. See who's running what weapons + procs, click through to PQDI."
          href="/loadouts"
        />
        <Card
          title="🧮 Planner"
          body="Build a theoretical loadout from the item database. Estimate hate-per-minute from procs + swings."
          href="/planner"
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
