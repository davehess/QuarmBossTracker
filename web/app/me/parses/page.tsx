// /me/parses: the signed-in raider's own parses on a chart, over a window they pick.
//
// A member asked on 2026-10-06 for "a page that'll graph out my parses over a variable time window (1 day,
// 1 week, etc.)"; the guild lead picked a Mimic tab plus this page. Both read the same database function,
// my_parse_series_v2 (20261007000000_my_parse_series_v2.sql), so they show the same numbers. New page, so it
// goes live with the [beta] tag (DECISIONS §135).
//
// The function is service-role only and resolves the person's characters itself from a Discord id, so the id
// here comes from the signed-in session (auth user -> wolfpack_members) and never from the URL. The URL
// carries only the window (?w=), the scope (?scope=all), one character (?char=), whether the folded
// character chips are open (?allchars=1), a zone (?zone=<id>), a mob search (?q=) and the By day grouping
// (?byday=1). The character is checked against the person's own list before it is used; the zone and the
// search are checked for shape (cleanZoneParam / cleanSearchParam, the same rules as the bot's route) and
// the function only ever filters the person's own fights with them.
//
// Exploring the fights (the guild lead, 2026-10-06: "chop it up by days, zones, mobs, search bar", option A):
// a GET form (search box with the mob suggestions, Zone picker) that works without JS, a By day link and a
// Clear filters link. The chart, the totals and the list all follow the filters, because the function
// applies them before it builds any of them. The pickers list what the window and scope hold BEFORE the
// zone and search are applied, so a picker never empties itself.
//
// The Character row is for mains and real alts (the guild lead, 2026-10-06, after seeing ~50 chips): a
// character with no fights in the window or the last 30 days, or one hidden on My Stats, sits behind
// "+N more" (splitCharChips). The ?char= check below still runs against the FULL list.
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
import {
  readParseSeries, splitCharChips, fmtWhen, fmtInt, vsUsualPct, cleanZoneParam, cleanSearchParam,
  groupByNight, nightHeading, SEARCH_MAX_LEN, type ParseFight, type ParseSeries,
} from '@/lib/parseTrend';

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
  zone: number | null, search: string | null,
): Promise<ParseSeries> {
  const { data, error } = await supabaseAdmin().rpc('my_parse_series_v2', {
    p_discord_id: discordId,
    p_since: sinceIso,
    p_until: null,
    p_bosses_only: bossesOnly,
    p_character: character,
    p_cap: FETCH_CAP,
    p_zone: zone,
    p_search: search,
  });
  if (error) throw new Error(error.message);
  return readParseSeries(data);
}

function Chip(
  { href, active, dim, title, children }:
  { href: string; active: boolean; dim?: boolean; title?: string; children: ReactNode },
) {
  return (
    <Link
      href={href} prefetch={false} aria-current={active ? 'true' : undefined} title={title}
      className={[
        'px-2.5 py-1 rounded border text-xs transition-colors',
        active ? 'border-gold text-gold' : 'border-border text-dim hover:text-text hover:no-underline',
        dim && !active ? 'opacity-60' : '',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}

const FIELD = 'bg-bg border border-border rounded px-2 py-1 text-xs text-text placeholder:text-dim';

export default async function MyParsesPage(
  { searchParams }: {
    searchParams: Promise<{
      w?: string; scope?: string; char?: string; allchars?: string; zone?: string; q?: string; byday?: string;
    }>;
  },
) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/me/parses');

  const {
    w: wParam, scope: scopeParam, char: charParam, allchars: allcharsParam,
    zone: zoneParam, q: qParam, byday: bydayParam,
  } = await searchParams;
  let w = resolveWindow(wParam, '7d');
  if (!WINDOWS.includes(w.key)) w = resolveWindow(undefined, '7d');   // 60d is a real window elsewhere, not a chip here
  const everything = scopeParam === 'all';
  const allChars = allcharsParam === '1';
  const byDay = bydayParam === '1';
  const wantChar = (charParam ?? '').trim().slice(0, 40) || null;
  const zone = cleanZoneParam(zoneParam);
  const search = cleanSearchParam(qParam);
  const filtered = zone != null || search != null;
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
      series = await loadSeries(discordId, w.sinceIso, !everything, wantChar, zone, search);
      // A ?char= that is not one of theirs gets nothing back; show all of their characters instead.
      if (wantChar && !series.characters.some(c => c.name.toLowerCase() === wantChar.toLowerCase())) {
        series = await loadSeries(discordId, w.sinceIso, !everything, null, zone, search);
      }
    } catch (e) {
      console.error('[me/parses] my_parse_series_v2 failed:', e instanceof Error ? e.message : e);
      failed = true;
    }
  }

  const activeChar = series?.characters.find(c => c.name.toLowerCase() === (wantChar ?? '').toLowerCase())?.name ?? null;

  // Links keep the other choices: a link changes one of window / scope / character / the folded chips / zone /
  // search / By day and carries the rest.
  type Over = {
    scope?: string | null; char?: string | null; allchars?: string | null;
    zone?: string | null; q?: string | null; byday?: string | null;
  };
  const current = (): Record<string, string | null | undefined> => ({
    w: wParam === w.key ? w.key : undefined,
    scope: everything ? 'all' : undefined,
    char: activeChar,
    allchars: allChars ? '1' : undefined,
    zone: zone != null ? String(zone) : undefined,
    q: search,
    byday: byDay ? '1' : undefined,
  });
  const href = (over: Over) => {
    const cur = { ...current(), ...over };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/me/parses?${s}` : '/me/parses';
  };
  // The filter form is a plain GET, so it re-sends whatever else is chosen as hidden fields (zone and q are
  // its own inputs).
  const carried = Object.entries(current()).filter(([k, v]) => v && k !== 'zone' && k !== 'q');

  const noCharacters = !discordId || (series != null && series.characters.length === 0);
  const fights = series?.fights ?? [];
  const multiChar = new Set(fights.map(f => f.char)).size > 1;
  const { shown, folded } = splitCharChips(series?.characters ?? [], activeChar);
  const showChips = shown.length > 1 || folded.length > 0;
  const bestDps = series && series.nights.length ? Math.max(...series.nights.map(n => n.best_dps)) : 0;
  // Flat: the newest TABLE_ROWS fights. By day: every fight that came back (FETCH_CAP at most), under its
  // night's heading, so a night is never cut halfway to fit a row count.
  const groups = byDay && series ? groupByNight(fights, series.nights) : null;
  const rows = groups ? groups.flatMap(g => g.fights) : [...fights].reverse().slice(0, TABLE_ROWS);

  // The pickers. A ?zone= with no fights in this window and scope is not in the list, so it gets an entry of
  // its own and the Zone box keeps saying what is applied. Only mob names the search box would accept are
  // suggested, so picking one always filters (a name with a comma or a full stop would be ignored).
  const zoneOptions = series
    ? (zone != null && !series.zones.some(z => z.id === zone)
      ? [...series.zones, { id: zone, name: `Zone ${zone}`, fights: 0 }]
      : series.zones)
    : [];
  const mobSuggestions = series ? series.mobs.filter(m => cleanSearchParam(m.name) != null) : [];

  const fightRow = (f: ParseFight) => {
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
        <td className="py-1 pr-3 text-dim">{f.zone ?? '—'}</td>
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
  };
  const columns = 6 + (multiChar ? 1 : 0);

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
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-20 text-xs text-dim">Character</span>
                  <Chip href={href({ char: null })} active={!activeChar}>All</Chip>
                  {shown.map(c => (
                    <Chip key={c.name} href={href({ char: c.name })} active={activeChar === c.name}>{c.name}</Chip>
                  ))}
                  {allChars && folded.map(c => (
                    <Chip
                      key={c.name} href={href({ char: c.name })} active={activeChar === c.name}
                      dim={c.hidden} title={c.hidden ? 'Hidden on My Stats (Hide from lists)' : undefined}
                    >
                      {c.name}
                    </Chip>
                  ))}
                  {folded.length > 0 && (
                    <Chip href={href({ allchars: allChars ? null : '1' })} active={false}>
                      {allChars ? 'fewer' : `+${folded.length} more`}
                    </Chip>
                  )}
                </div>
                {folded.length > 0 && (
                  <p className="text-xs text-dim">
                    Characters with no fights in 30 days, and ones you hid on{' '}
                    <Link href="/me" className="text-blue hover:underline">My Stats</Link>, are tucked away.
                  </p>
                )}
              </>
            )}

            {(filtered || series.total > 0) && (
              <form method="GET" action="/me/parses" className="flex flex-wrap items-center gap-1.5">
                <span className="w-20 text-xs text-dim">Find</span>
                {carried.map(([k, v]) => <input key={k} type="hidden" name={k} value={v as string} />)}
                <input
                  type="search" name="q" list="parse-mobs" defaultValue={search ?? ''} aria-label="Search by mob name"
                  placeholder="Mob name" maxLength={SEARCH_MAX_LEN} autoComplete="off"
                  className={`${FIELD} w-44`}
                />
                <datalist id="parse-mobs">
                  {mobSuggestions.map(m => (
                    <option key={m.name} value={m.name}>
                      {`${m.name} — ${m.fights} ${m.fights === 1 ? 'fight' : 'fights'}`}
                    </option>
                  ))}
                </datalist>
                <select
                  name="zone" defaultValue={zone != null ? String(zone) : ''} aria-label="Zone"
                  className={`${FIELD} max-w-[14rem]`}
                >
                  <option value="">All zones</option>
                  {zoneOptions.map(z => (
                    <option key={z.id} value={z.id}>{`${z.name} (${z.fights})`}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded border border-border text-xs text-dim hover:text-text transition-colors"
                >
                  Apply
                </button>
                <Chip href={href({ byday: byDay ? null : '1' })} active={byDay} title="Group the list under each raid night">
                  <span
                    aria-hidden
                    className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-sm border align-middle ${byDay ? 'border-gold bg-gold' : 'border-dim'}`}
                  />
                  By day
                </Chip>
                {filtered && (
                  <Link
                    href={href({ zone: null, q: null })} prefetch={false}
                    className="text-xs text-blue hover:underline"
                  >
                    Clear filters
                  </Link>
                )}
              </form>
            )}
          </div>

          {series.total === 0 ? (
            <section className="bg-panel border border-border rounded-lg p-4 text-sm text-dim">
              {filtered ? (
                <>
                  No {everything ? 'fights' : 'boss fights'} match these filters in this window. Try{' '}
                  {!everything && (
                    <>
                      <Link href={href({ scope: 'all' })} className="text-blue hover:underline">Everything</Link> or{' '}
                    </>
                  )}
                  <Link href={href({ zone: null, q: null })} className="text-blue hover:underline">clearing the filters</Link>.
                </>
              ) : everything ? (
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
                  <table className="w-full min-w-[40rem] text-xs">
                    <thead className="text-dim text-left">
                      <tr className="border-b border-border">
                        <th className="py-1 pr-3 font-normal">When ({tzShortLabel(tz)})</th>
                        <th className="py-1 pr-3 font-normal">Fight</th>
                        <th className="py-1 pr-3 font-normal">Zone</th>
                        {multiChar && <th className="py-1 pr-3 font-normal">Character</th>}
                        <th className="py-1 pr-3 text-right font-normal">DPS</th>
                        <th className="py-1 pr-3 text-right font-normal">vs your usual</th>
                        <th className="py-1 text-right font-normal" title="Where you placed on damage in that fight">Rank</th>
                      </tr>
                    </thead>
                    {groups ? groups.map(g => (
                      <tbody key={g.night}>
                        <tr className="border-b border-border">
                          <th colSpan={columns} scope="rowgroup" className="pt-3 pb-1 text-left text-xs font-normal text-text">
                            {nightHeading(g.summary)}
                            {g.fights.length < g.summary.fights && (
                              <span className="text-dim"> · newest {g.fights.length} shown</span>
                            )}
                          </th>
                        </tr>
                        {g.fights.map(fightRow)}
                      </tbody>
                    )) : (
                      <tbody>{rows.map(fightRow)}</tbody>
                    )}
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
