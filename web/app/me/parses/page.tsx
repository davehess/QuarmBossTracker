// /me/parses: the signed-in raider's own parses on a chart, over a window they pick.
//
// A member asked on 2026-10-06 for "a page that'll graph out my parses over a variable time window (1 day,
// 1 week, etc.)"; the guild lead picked a Mimic tab plus this page. Both read the same database function,
// my_parse_series (20261006200000_my_parse_series.sql), so they show the same numbers. New page, so it goes
// live with the [beta] tag (DECISIONS §135).
//
// The function is service-role only and resolves the person's characters itself from a Discord id, so the id
// here comes from the signed-in session (auth user -> wolfpack_members) and never from the URL. The URL
// carries only the window (?w=), the scope (?scope=all) and one character (?char=), and the last is checked
// against the person's own list before it is used.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import NewPageTag from '@/components/NewPageTag';
import WindowPicker from '@/components/WindowPicker';
import ParseTrendChart from '@/components/ParseTrendChart';
import { resolveWindow, type WindowKey } from '@/lib/timeWindow';
import { userTz, tzShortLabel } from '@/lib/timezone';
import { cleanBossName } from '@/lib/format';
import { readParseSeries, fmtWhen, fmtInt, vsUsualPct, type ParseSeries } from '@/lib/parseTrend';

export const metadata: Metadata = {
  title: '[beta] My parses',
  description: 'Your own parses on a chart over a day, a week or a month, with your average for each raid night.',
};

export const dynamic = 'force-dynamic';

const WINDOWS: WindowKey[] = ['1d', '7d', '30d', '90d', 'exp', 'life'];
const FETCH_CAP = 400;   // fights drawn; the per-night averages always cover the whole window
const TABLE_ROWS = 50;

async function loadSeries(
  discordId: string, sinceIso: string | null, bossesOnly: boolean, character: string | null,
): Promise<ParseSeries> {
  const { data, error } = await supabaseAdmin().rpc('my_parse_series', {
    p_discord_id: discordId,
    p_since: sinceIso,
    p_until: null,
    p_bosses_only: bossesOnly,
    p_character: character,
    p_cap: FETCH_CAP,
  });
  if (error) throw new Error(error.message);
  return readParseSeries(data);
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href} prefetch={false} aria-current={active ? 'true' : undefined}
      className={[
        'px-2.5 py-1 rounded border text-xs transition-colors',
        active ? 'border-gold text-gold' : 'border-border text-dim hover:text-text hover:no-underline',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}

export default async function MyParsesPage(
  { searchParams }: { searchParams: Promise<{ w?: string; scope?: string; char?: string }> },
) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/me/parses');

  const { w: wParam, scope: scopeParam, char: charParam } = await searchParams;
  let w = resolveWindow(wParam, '7d');
  if (!WINDOWS.includes(w.key)) w = resolveWindow(undefined, '7d');   // 60d is a real window elsewhere, not a chip here
  const everything = scopeParam === 'all';
  const wantChar = (charParam ?? '').trim().slice(0, 40) || null;
  const tz = await userTz();
  const nowMs = Date.now();

  // Who is signed in -> their Discord id. The function takes it from here.
  const { data: pack } = await supabaseAdmin()
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const discordId = (pack?.discord_id as string | undefined) ?? null;

  let series: ParseSeries | null = null;
  let failed = false;
  if (discordId) {
    try {
      series = await loadSeries(discordId, w.sinceIso, !everything, wantChar);
      // A ?char= that is not one of theirs gets nothing back; show all of their characters instead.
      if (wantChar && !series.characters.some(c => c.name.toLowerCase() === wantChar.toLowerCase())) {
        series = await loadSeries(discordId, w.sinceIso, !everything, null);
      }
    } catch (e) {
      console.error('[me/parses] my_parse_series failed:', e instanceof Error ? e.message : e);
      failed = true;
    }
  }

  const activeChar = series?.characters.find(c => c.name.toLowerCase() === (wantChar ?? '').toLowerCase())?.name ?? null;

  // Links keep the other choices: a link changes one of window / scope / character and carries the rest.
  const href = (over: { scope?: string | null; char?: string | null }) => {
    const cur: Record<string, string | null | undefined> = {
      w: wParam === w.key ? w.key : undefined,
      scope: everything ? 'all' : undefined,
      char: activeChar,
      ...over,
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/me/parses?${s}` : '/me/parses';
  };

  const noCharacters = !discordId || (series != null && series.characters.length === 0);
  const fights = series?.fights ?? [];
  const multiChar = new Set(fights.map(f => f.char)).size > 1;
  const showChips = (series?.characters.length ?? 0) > 1;
  const bestDps = series && series.nights.length ? Math.max(...series.nights.map(n => n.best_dps)) : 0;
  const rows = [...fights].reverse().slice(0, TABLE_ROWS);

  return (
    <div className="mx-auto max-w-4xl py-2 space-y-4">
      <NewPageTag note="New page: your own parses on a chart." />

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl text-gold">My parses</h1>
          <WindowPicker page="me-parses" current={w.key} options={WINDOWS} />
        </div>
        <p className="text-sm text-dim">Numbers start 14 July 2026, when parse merging was fixed.</p>
      </header>

      {noCharacters && !failed && (
        <section className="bg-panel border border-border rounded-lg p-4 text-sm text-dim">
          None of your characters are linked to your account yet, so there is nothing to graph. Your{' '}
          <Link href="/me" className="text-blue hover:underline">My Stats</Link> page shows how to get them linked.
        </section>
      )}

      {failed && (
        <section role="alert" className="bg-panel border border-border rounded-lg p-4 text-sm text-orange">
          Your parses could not be loaded just now. Try again in a minute.
        </section>
      )}

      {series && !noCharacters && (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 text-xs text-dim">Show</span>
              <Chip href={href({ scope: null })} active={!everything}>Bosses</Chip>
              <Chip href={href({ scope: 'all' })} active={everything}>Everything</Chip>
            </div>
            {showChips && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-20 text-xs text-dim">Character</span>
                <Chip href={href({ char: null })} active={!activeChar}>All</Chip>
                {series.characters.map(c => (
                  <Chip key={c.name} href={href({ char: c.name })} active={activeChar === c.name}>{c.name}</Chip>
                ))}
              </div>
            )}
          </div>

          {series.total === 0 ? (
            <section className="bg-panel border border-border rounded-lg p-4 text-sm text-dim">
              {everything ? (
                'No parses in this window yet.'
              ) : (
                <>
                  No boss fights in this window. Most Planes of Power bosses aren&apos;t on the boss list yet, so try{' '}
                  <Link href={href({ scope: 'all' })} className="text-blue hover:underline">Everything</Link>.
                </>
              )}
            </section>
          ) : (
            <>
              <p className="text-sm text-text">
                {fmtInt(series.total)} {series.total === 1 ? 'fight' : 'fights'} over {series.nights.length}{' '}
                {series.nights.length === 1 ? 'night' : 'nights'}
                <span className="text-dim"> · best {fmtInt(bestDps)} dps</span>
              </p>

              <ParseTrendChart
                series={series} sinceMs={w.sinceIso ? Date.parse(w.sinceIso) : null}
                nowMs={nowMs} tz={tz} multiChar={multiChar}
              />
              {series.truncated && (
                <p className="text-xs text-dim">
                  Showing the newest {fights.length} of {fmtInt(series.total)} fights. The average line still counts all of them.
                </p>
              )}

              <section className="bg-panel border border-border rounded-lg p-3 sm:p-4">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-xs">
                    <thead className="text-dim text-left">
                      <tr className="border-b border-border">
                        <th className="py-1 pr-3 font-normal">When ({tzShortLabel(tz)})</th>
                        <th className="py-1 pr-3 font-normal">Fight</th>
                        {multiChar && <th className="py-1 pr-3 font-normal">Character</th>}
                        <th className="py-1 pr-3 text-right font-normal">DPS</th>
                        <th className="py-1 pr-3 text-right font-normal">vs your usual</th>
                        <th className="py-1 text-right font-normal" title="Where you placed on damage in that fight">Rank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(f => {
                        const pct = vsUsualPct(f.dps, f.usual);
                        return (
                          <tr key={`${f.eid}-${f.char}`} className="border-b border-border/30 hover:bg-[#1a212c]">
                            <td className="py-1 pr-3 whitespace-nowrap text-dim">{fmtWhen(Date.parse(f.t), tz)}</td>
                            <td className="py-1 pr-3 text-text">
                              {everything && (
                                <span
                                  aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                                  style={{ background: f.boss ? '#4493e8' : '#4a5568' }}
                                  title={f.boss ? 'Boss fight' : 'Other fight'}
                                />
                              )}
                              <Link href={`/parses/${f.eid}`} className="hover:text-blue hover:underline">
                                {cleanBossName(f.name)}
                              </Link>
                            </td>
                            {multiChar && (
                              <td className="py-1 pr-3 text-dim">
                                <Link href={`/character/${encodeURIComponent(f.char)}`} className="hover:text-blue hover:underline">
                                  {f.char}
                                </Link>
                              </td>
                            )}
                            <td className="py-1 pr-3 text-right text-gold">{fmtInt(f.dps)}</td>
                            <td
                              className={`py-1 pr-3 text-right ${pct == null ? 'text-dim' : pct > 0 ? 'text-green' : pct < 0 ? 'text-gold' : 'text-dim'}`}
                              title={f.usual != null ? `Your usual on this boss: ${fmtInt(f.usual)} dps` : undefined}
                            >
                              {pct == null ? '—' : `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`}
                            </td>
                            <td className="py-1 text-right text-dim">{f.rank != null ? `#${f.rank}` : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-[11px] text-dim">
                  {series.total > rows.length && <>The newest {rows.length} of {fmtInt(series.total)} fights. </>}
                  &ldquo;vs your usual&rdquo; compares a fight with your typical DPS on that same boss since 14 July,
                  once you have three or more fights on it.
                </p>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
