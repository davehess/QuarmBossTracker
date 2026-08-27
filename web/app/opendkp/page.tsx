// /opendkp — a PUBLIC live counter of every request Wolf Pack sends OpenDKP.
//
// WHY THIS IS OPEN ACCESS (Hitya, 2026-08-26): "moncs is ready to unblock us,
// so I need a live counter site that's open access." On 2026-08-25 our traffic
// cost OpenDKP's owner real money and got our IP blocked at his WAF. He is
// about to lift that on our word. "Trust us, it's fixed" is not a reasonable
// thing to ask of someone who is paying the bill, and he is not in our Discord,
// so any page behind our sign-in is useless to the one person who needs it.
//
// This page therefore has NO auth check — deliberately, and it is the only
// member-facing surface that doesn't. What it exposes is exactly and only:
// endpoint shapes, call counts, byte totals, and whether we are currently
// halted. No character names, no member names, no DKP, no credentials. The
// underlying table (opendkp_call_stats) is the single anon-readable table in
// the schema for the same reason.
//
// Endpoint names are normalized to the shape OpenDKP's own API Gateway log
// groups by (`/clients/{client}/auctions`), so this can be read straight across
// against his table with no translation step.

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import AutoRefresh from './AutoRefresh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = {
  title: 'OpenDKP traffic — Wolf Pack',
  description: 'Live count of every API request Wolf Pack sends to OpenDKP.',
};

const fmt = (n: number) => n.toLocaleString('en-US');
function fmtBytes(n: number) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

// Series colors — the validated categorical order from the writeup, so the
// graphs here and the ones Moncs was shown read as the same system.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#8b949e'];

type Summary = {
  calls_1h: number; bytes_1h: number; blocked_1h: number;
  calls_24h: number; bytes_24h: number; errors_24h: number;
  auth_calls_1h: number; auth_blocked_1h: number; ever_seen: boolean;
  endpoints: { endpoint: string; calls: number; bytes: number; errors: number }[];
  hours: { at: string; calls: number; blocked: number }[];
};

export default async function OpenDkpPage() {
  const sb = supabaseAdmin();

  // ⚠ Aggregated in Postgres, NOT by selecting rows and summing them here.
  // This used to be `.order('minute', { ascending: true }).limit(1000)` — the
  // oldest 1000 rows of the 48h window, silently discarding everything newer.
  // Once volume passed 1000 rows/48h the newest data fell off the end, starting
  // with the last hour. Caught 2026-08-27 at 1,440 rows: the page read "0 calls
  // in the last hour" against a true 49, and 1,330 calls / 91.3 MB over 24h
  // against a true 2,074 / 115.9 MB.
  //
  // It under-reported by ~36%, IN OUR FAVOUR, on the one page whose whole
  // purpose is that OpenDKP's operator need not take our word for our traffic.
  // Wrong in the flattering direction is worse here than being down. Raising
  // the limit would only move the cliff; the RPC removes it.
  const [{ data: summaryRaw, error: summaryErr }, { data: tuneRows }] = await Promise.all([
    sb.rpc('opendkp_traffic_summary'),
    sb.from('overlay_tuning').select('tuning').eq('guild_id', 'wolfpack').limit(1),
  ]);
  const tuning = (tuneRows?.[0]?.tuning ?? {}) as Record<string, unknown>;
  const haltFlag = Number(tuning.flag_opendkp_halt) >= 1;

  const S = (summaryRaw ?? null) as Summary | null;
  const num = (v: unknown) => Number(v) || 0;

  const callsNow   = num(S?.calls_1h);
  const bytesNow   = num(S?.bytes_1h);
  const blockedNow = num(S?.blocked_1h);
  const calls24    = num(S?.calls_24h);
  const bytes24    = num(S?.bytes_24h);
  const errors24   = num(S?.errors_24h);
  const authCalls  = num(S?.auth_calls_1h);
  const authBlocked = num(S?.auth_blocked_1h);
  const everSeen   = !!S?.ever_seen;

  const endpoints = (S?.endpoints ?? []).map(e => [e.endpoint, {
    calls: num(e.calls), bytes: num(e.bytes), errors: num(e.errors),
  }] as const);
  const maxCalls = Math.max(1, ...endpoints.map(([, v]) => v.calls));

  const hours = (S?.hours ?? []).map(h => ({
    at: Date.parse(h.at), calls: num(h.calls), blocked: num(h.blocked),
  }));
  const maxHour = Math.max(1, ...hours.map(h => h.calls));

  // A failed summary must NOT render as zeros. Zeros on this page say "we sent
  // nothing", which is a claim — and the wrong one to make by accident.
  const broken = !!summaryErr || !S;

  const state = broken ? 'broken' : haltFlag ? 'halted' : (callsNow > 0 ? 'live' : (everSeen ? 'quiet' : 'nodata'));
  const STATE = {
    halted: { label: 'HALTED', color: '#d29922', note: 'Wolf Pack is not sending anything to OpenDKP. Every call is being refused before it leaves our server.' },
    live:   { label: 'LIVE',   color: '#3fae74', note: 'Sending normally, within the limits below.' },
    quiet:  { label: 'IDLE',   color: '#8b949e', note: 'Running, but nothing has needed to be sent in the last hour.' },
    nodata: { label: 'NO DATA', color: '#8b949e', note: 'No calls recorded yet in the last 48 hours.' },
    // Explicit, because the alternative is rendering zeros — and a zero here
    // reads as "we sent nothing", which is a claim this page must never make
    // by accident.
    broken: { label: 'UNAVAILABLE', color: '#d29922', note: 'The counter could not be read just now, so these figures are not current. This is a fault on our side, not a claim that nothing was sent.' },
  }[state];

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="bg-panel border border-border rounded-lg p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl text-gold mb-1">OpenDKP traffic — live</h1>
            <p className="text-sm text-dim leading-6 max-w-2xl">
              Every request Wolf Pack&apos;s bot sends to the OpenDKP API, counted as it happens.
              This page is <b className="text-text">open to anyone</b> — no sign-in — because the
              person who most needs to see it is the one paying for the API.
              Endpoint names match the shape OpenDKP&apos;s own API Gateway logs use, so this can be
              read side by side with them.
            </p>
            <p className="text-sm text-dim leading-6 max-w-2xl mt-2">
              This counts what our <b className="text-text">server</b> sends. Since 27 Aug 2026 that
              is everything: the desktop app no longer contacts the OpenDKP API at all — the call it
              used to make from each player&apos;s PC was removed, not just slowed down.
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs tracking-widest font-bold px-3 py-1 rounded border inline-block"
                 style={{ color: STATE.color, borderColor: STATE.color }}>
              {STATE.label}
            </div>
            <div className="mt-2"><AutoRefresh seconds={30} /></div>
          </div>
        </div>
        <p className="text-sm mt-3" style={{ color: STATE.color }}>{STATE.note}</p>
      </section>

      <section className="grid sm:grid-cols-4 gap-3">
        {[
          { k: 'Calls, last hour', v: broken ? '—' : fmt(callsNow), n: broken ? 'counter unavailable' : `${fmtBytes(bytesNow)} returned` },
          { k: 'Calls, last 24h', v: broken ? '—' : fmt(calls24), n: broken ? 'counter unavailable' : `${fmtBytes(bytes24)} returned` },
          { k: 'Refused by us', v: broken ? '—' : fmt(blockedNow), n: 'last hour — stopped before reaching OpenDKP' },
          { k: 'Errors, last 24h', v: broken ? '—' : fmt(errors24), n: 'HTTP 4xx/5xx from OpenDKP' },
        ].map(s => (
          <div key={s.k} className="bg-panel border border-border rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-dim">{s.k}</div>
            <div className="text-2xl text-text font-semibold tabular-nums mt-1">{s.v}</div>
            <div className="text-[11px] text-dim mt-1">{s.n}</div>
          </div>
        ))}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-base text-orange mb-1">Calls by endpoint — last 24 hours</h2>
        <p className="text-xs text-dim mb-3">
          The same breakdown as the write-up, live. <code>/clients/&#123;client&#125;/auctions</code> is
          the one that caused the incident; it should now be a small, flat number no matter how many
          people have the app open.
        </p>
        {endpoints.length === 0 ? (
          <p className="text-sm text-dim">Nothing sent in the last 24 hours.</p>
        ) : (
          <div className="space-y-1">
            {endpoints.map(([name, v], i) => (
              <div key={name} className="flex items-center gap-3 text-sm py-1">
                <code className="text-xs text-text w-[280px] shrink-0 truncate" title={name}>{name}</code>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <div className="h-5 rounded-r"
                       style={{ width: `${Math.max(0.5, (v.calls / maxCalls) * 100)}%`, background: SERIES[i % SERIES.length] }} />
                  <span className="text-xs text-text tabular-nums whitespace-nowrap">
                    {fmt(v.calls)}
                    <span className="text-dim ml-2">{fmtBytes(v.bytes)}</span>
                    {v.errors > 0 && <span className="text-red ml-2">{fmt(v.errors)} err</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-base text-orange mb-1">Last 48 hours, hour by hour</h2>
        <p className="text-xs text-dim mb-3">
          Each bar is one hour. A raid night should be the tallest thing here and still small;
          a flat line at zero means we are halted.
        </p>
        <div className="flex items-end gap-[2px] h-28">
          {hours.map((h, i) => (
            <div key={i} className="flex-1 min-w-0 rounded-t"
                 title={`${new Date(h.at).toLocaleString()} — ${fmt(h.calls)} calls${h.blocked ? `, ${fmt(h.blocked)} refused` : ''}`}
                 style={{
                   height: `${Math.max(h.calls ? 3 : 1, (h.calls / maxHour) * 100)}%`,
                   background: h.calls ? '#3987e5' : (h.blocked ? '#d29922' : '#2a2f38'),
                 }} />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-dim mt-1">
          <span>48h ago</span><span>24h ago</span><span>now</span>
        </div>
      </section>

      {(authCalls > 0 || authBlocked > 0) && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-base text-orange mb-1">Sign-in traffic (not OpenDKP)</h2>
          <p className="text-xs text-dim">
            Counted separately and on purpose: these go to <b className="text-text">Amazon Cognito</b>,
            the sign-in service, and never touch OpenDKP&apos;s own API. They are shown because a
            burst of them is still a bug worth seeing on our side — not because they cost OpenDKP
            anything. Last hour: <b className="text-text">{fmt(authCalls)}</b> sign-in
            {authCalls === 1 ? '' : 's'}
            {authBlocked > 0 && <> · <b className="text-text">{fmt(authBlocked)}</b> refused by us before sending</>}.
          </p>
        </section>
      )}

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim leading-6">
        <b className="text-text">What changed after the incident.</b> The live-bidding panel used to
        poll <code>/auctions</code> every 7 seconds per open dashboard, uncached — that is what put
        1,678 calls and 1.1 GB on the API in one afternoon. It now reads OpenDKP&apos;s own
        <code> /auctions/active</code> endpoint through a single shared cache, so the whole guild
        costs one call per interval no matter how many people are playing, and a hard ceiling of
        60 calls/minute sits below every request path we have. Full write-up:{' '}
        <Link href="/ai" className="underline">how we work</Link>.
        <br /><br />
        <b className="text-text">Counts are per minute</b>, aggregated in memory and written once —
        recording a row per call would repeat the exact mistake this page exists to answer for.
        &ldquo;Refused by us&rdquo; are calls stopped before they left our server, so they never
        reached OpenDKP at all.
      </section>
    </div>
  );
}
